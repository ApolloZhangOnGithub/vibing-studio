// AuthKey.swift —— 用 Touch ID 登录 Vibing Studio（不开浏览器）：这台 Mac 的 Secure Enclave 里生成一把钥匙——拿不出来，每次用都要按指纹
//   （没有指纹就输开机密码，系统自己的那个框）。App 存的只是 Secure Enclave 加密过的那一段（只有这台 Mac 的这块芯片用得了）和网站给它的编号；
//   网站只存公钥（web/src/passkey.js 的 devicekeys）。
//   开（设置 › 账号）：生成 → 按一下指纹确认 → 页面把公钥登记上去（登录着）→ 记下编号。
//   登（WebController 要去登录页时）：要一个随机数（带着这次的 PKCE challenge）→ 按指纹签「vs-devicekey-v1\n随机数」→ 换一个一次性的 code
//   → 在 App 的网页里用 code + verifier 换会话（同浏览器那条路的最后一步）。取消了、钥匙在网站上被移除了、连不上：照旧走浏览器
import AppKit
import CryptoKit
import LocalAuthentication

@MainActor
enum AuthKey {
  static var dir: String { (ProcessInfo.processInfo.environment["NADOS_HOME"] ?? NSHomeDirectory()) + "/Library/Application Support/Vibing Studio/auth" }
  static var keyPath: String { dir + "/touchid.key" }
  static var metaPath: String { dir + "/touchid.json" }
  static func meta() -> [String: Any] { (try? JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: metaPath)))) as? [String: Any] ?? [:] }
  static func enrolled(origin: String) -> Bool {
    let m = meta()
    return !(m["id"] as? String ?? "").isEmpty && (m["origin"] as? String ?? "") == origin && FileManager.default.fileExists(atPath: keyPath)
  }
  // 这台 Mac 能不能用：有没有 Secure Enclave、指纹（Touch ID）设好了没有、至少能输开机密码
  static func biometry() -> String {
    let c = LAContext()
    var e: NSError?
    let ok = c.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &e)
    switch c.biometryType {
    case .touchID: return ok ? "touchID" : "touchID-off"
    case .faceID: return ok ? "faceID" : "faceID-off"
    default: return "none"
    }
  }
  static func info() -> [String: Any] {
    let m = meta()
    return ["se": SecureEnclave.isAvailable, "biometry": biometry(), "owner": LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil),
            "enrolled": FileManager.default.fileExists(atPath: keyPath) && !(m["id"] as? String ?? "").isEmpty,
            "id": m["id"] ?? "", "origin": m["origin"] ?? "", "pub": m["pub"] ?? "", "created": m["created"] ?? 0]
  }
  // 生成一把新的（原来的挪到一边，不删）：回公钥（base64url，未压缩的 65 字节）
  static func create() throws -> String {
    guard SecureEnclave.isAvailable else { throw BridgeError.failed("这台 Mac 没有 Secure Enclave") }
    var err: Unmanaged<CFError>?
    guard let ac = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [.privateKeyUsage, .userPresence], &err) else { throw BridgeError.failed("SecAccessControl") }
    let k = try SecureEnclave.P256.Signing.PrivateKey(accessControl: ac)
    try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    setAside()
    try k.dataRepresentation.write(to: URL(fileURLWithPath: keyPath), options: [.atomic])
    chmod(keyPath, 0o600)
    let pub = BrowserAuth.b64url(k.publicKey.x963Representation)
    writeMeta(["pub": pub, "created": Date().timeIntervalSince1970])
    return pub
  }
  static func setId(_ id: String, origin: String) { var m = meta(); m["id"] = id; m["origin"] = origin; writeMeta(m) }
  // 不用了（关掉、换一把）：两个文件挪到一边（不删）
  static func setAside() {
    let fm = FileManager.default, ts = Int(Date().timeIntervalSince1970)
    for p in [keyPath, metaPath] where fm.fileExists(atPath: p) { try? fm.moveItem(atPath: p, toPath: p + ".old-\(ts)") }
  }
  private static func writeMeta(_ m: [String: Any]) {
    guard let d = try? JSONSerialization.data(withJSONObject: m) else { return }
    try? d.write(to: URL(fileURLWithPath: metaPath), options: [.atomic])
    chmod(metaPath, 0o600)
  }
  // 按指纹签名：系统的框（写着 reason）；在后台线程上等人按
  nonisolated static func sign(blob: Data, message: Data, reason: String) async throws -> Data {
    try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Data, Error>) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let ctx = LAContext()
          ctx.localizedReason = reason
          let k = try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: blob, authenticationContext: ctx)
          cont.resume(returning: try k.signature(for: message).derRepresentation)
        } catch { cont.resume(throwing: error) }
      }
    }
  }
  // 开的时候：按一下指纹确认（是本人、这台 Mac 上用得了）
  static func verify(reason: String) async -> Bool {
    guard let blob = try? Data(contentsOf: URL(fileURLWithPath: keyPath)) else { return false }
    var nonce = [UInt8](repeating: 0, count: 16)
    _ = SecRandomCopyBytes(kSecRandomDefault, nonce.count, &nonce)
    return (try? await sign(blob: blob, message: Data(nonce), reason: reason)) != nil
  }
  // 整个登录：成了回换会话的网址（在 App 的网页里打开）；不成（取消、网络、钥匙被移除）回 nil，照旧走浏览器
  static func login(origin: String, next: String) async -> URL? {
    let m = meta()
    guard let id = m["id"] as? String, !id.isEmpty, let blob = try? Data(contentsOf: URL(fileURLWithPath: keyPath)) else { return nil }
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { return nil }
    let verifier = BrowserAuth.b64url(Data(bytes)), challenge = BrowserAuth.b64url(Data(SHA256.hash(data: Data(verifier.utf8))))
    guard let o = await post(origin + "/auth/devicekey/options", ["id": id, "app": challenge]), let nonce = o["challenge"] as? String else { return nil }
    guard let der = try? await sign(blob: blob, message: Data(("vs-devicekey-v1\n" + nonce).utf8), reason: "登录 Vibing Studio") else { return nil }
    guard let r = await post(origin + "/auth/devicekey/login", ["id": id, "challenge": nonce, "sig": BrowserAuth.b64url(der)]), r["ok"] as? Bool == true,
          let code = r["code"] as? String, !code.isEmpty else { return nil }
    let nx = next.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "/"
    return URL(string: origin + "/auth/app?code=" + code + "&verifier=" + verifier + "&next=" + nx)
  }
  private static func post(_ url: String, _ body: [String: Any]) async -> [String: Any]? {
    guard let u = URL(string: url), let d = try? JSONSerialization.data(withJSONObject: body) else { return nil }
    var rq = URLRequest(url: u)
    rq.httpMethod = "POST"; rq.httpBody = d; rq.timeoutInterval = 20
    rq.setValue("application/json", forHTTPHeaderField: "content-type")
    guard let (data, _) = try? await URLSession.shared.data(for: rq) else { return nil }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
  }
}
