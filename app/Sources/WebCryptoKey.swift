// WebCryptoKey.swift —— 网页里存起来的密钥（WebCrypto，比如连别的设备用的设备密钥）用的主密钥，由 App 自己给 WebKit
//   （WKNavigationDelegate 的 _webCryptoMasterKeyForWebView:completionHandler:，WebController、WebPanes 里接上）。
//   不给的话 WebKit 自己把它放进登录钥匙串，那一项只认建它的那一版 App：每次更新都弹「想要访问你的钥匙串中的密钥“… WebCrypto 主密钥”」要开机密码，
//   一次连接能弹好多个（2026-10-14 测试 App 弹了几百个）。
//   存在钥匙串里，经 /usr/bin/security 存取（同 RdpKeychain：它是系统签名的、一直不变，更新后不再问）。
//   第一次：WebKit 原来那一把不用问就拿得到的话拿过来（以前存的设备密钥接着能用），拿不到就新生成一把——不弹框。
//   自动测试（NADOS_HOME）：放在假的家目录里的一个文件，不碰钥匙串
import Foundation
import Security

@MainActor
enum WebCryptoKey {
  static let service = "Vibing Studio WebCrypto"
  private static var cached: Data?
  private static var waiting: [(Data?) -> Void] = []
  private static var loading = false
  private static var account: String { Bundle.main.bundleIdentifier ?? "beer.paimon.terminal" }

  static func get(_ done: @escaping (Data?) -> Void) {
    if let k = cached { return done(k) }
    waiting.append(done)
    if loading { return }
    loading = true
    Task { @MainActor in
      let k = await load()
      cached = k
      loading = false
      let w = waiting
      waiting = []
      w.forEach { $0(k) }
    }
  }

  private static func load() async -> Data? {
    if let home = ProcessInfo.processInfo.environment["NADOS_HOME"] {
      let dir = home + "/Library/Application Support/Vibing Studio", p = dir + "/webcrypto.key"
      if let d = FileManager.default.contents(atPath: p), d.count == 16 { return d }
      let k = random(16)
      try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
      FileManager.default.createFile(atPath: p, contents: k, attributes: [.posixPermissions: 0o600])
      return k
    }
    let r = await RdpProc.run("/usr/bin/security", ["find-generic-password", "-s", service, "-a", account, "-w"], timeout: 20)
    if r.status == 0, let k = fromHex(r.out.trimmingCharacters(in: .whitespacesAndNewlines)), k.count == 16 { return k }
    // 第一次：WebKit 原来那一把——只在不用问就拿得到时拿（不弹框：用户 2026-10-14 被这个框弹烦了）；拿不到就新的
    //   （网页里存的设备密钥重新生成一把；同一账号的设备默认直接允许，连别的电脑不受影响）
    let acct = "com.apple.WebKit.WebCrypto.master+" + account
    let old = await Task.detached { () -> Data? in
      let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: acct, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
      var out: CFTypeRef?
      SecKeychainSetUserInteractionAllowed(false)
      defer { SecKeychainSetUserInteractionAllowed(true) }
      guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data, d.count == 16 else { return nil }
      return d
    }.value
    let k = old ?? random(16)
    let hex = k.map { String(format: "%02x", $0) }.joined()
    _ = await RdpProc.run("/usr/bin/security", ["-i"], input: "add-generic-password -U -s \"\(service)\" -a \"\(account)\" -l \"\(service)\" -w \(hex)\n", timeout: 20)
    return k
  }

  private static func random(_ n: Int) -> Data {
    var b = [UInt8](repeating: 0, count: n)
    _ = SecRandomCopyBytes(kSecRandomDefault, n, &b)
    return Data(b)
  }
  private static func fromHex(_ s: String) -> Data? {
    guard s.count % 2 == 0, !s.isEmpty else { return nil }
    var d = Data(capacity: s.count / 2), i = s.startIndex
    while i < s.endIndex {
      let j = s.index(i, offsetBy: 2)
      guard let b = UInt8(s[i..<j], radix: 16) else { return nil }
      d.append(b)
      i = j
    }
    return d
  }
}
