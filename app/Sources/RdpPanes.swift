// RdpPanes.swift —— 远程桌面（「远程桌面」标签页，页面在 ui/studio/rdp.js）：页面给一块位置，原生在那里叠一个视图——
//   画远端的画面、把这台 Mac 的键盘鼠标送过去、两边复制的文字互通。一个连接一个助手进程（Helpers/vs-rdp.c，FreeRDP 3）：
//   画面在共享内存里（助手画进去，这边把变了的那块拷到 IOSurface 上显示），别的走管道（一行一条）。
//   连接（地址、用户名、选项）记在 UserDefaults（rdp.hosts）；密码在钥匙串里（经 /usr/bin/security 存取：App 更新后签名变了也不用再允许一次）；
//   证书按指纹认：第一次连上时记下，以后变了先不连，问过人（rdp.trust）再连
import AppKit
import IOSurface
import QuartzCore

// MARK: - 助手（vs-rdp）：App 里带的那个；在这台 Mac 上跑不起来（FreeRDP 的版本不同、Intel 芯片）就用这台 Mac 上的 FreeRDP 现编一个
@MainActor
enum RdpHelper {
  static let protocolVersion = 1
  static var home: String { ProcessInfo.processInfo.environment["NADOS_HOME"] ?? NSHomeDirectory() }
  static var supportDir: String { home + "/Library/Application Support/Vibing Studio/rdp" }
  static let prefixes = ["/opt/homebrew/opt/freerdp", "/usr/local/opt/freerdp"]
  static func freerdpPrefix() -> String? { prefixes.first { FileManager.default.fileExists(atPath: $0 + "/lib/libfreerdp3.dylib") } }
  private(set) static var path: String?
  private static var status: [String: Any]?
  private static var resolving: Task<[String: Any], Never>?

  // { ok: true, path, freerdp } 或 { ok: false, need: "freerdp" | "clt" | "build", detail }
  static func resolve(rebuild: Bool = false) async -> [String: Any] {
    if let s = status, !rebuild, s["ok"] as? Bool == true { return s }
    if let t = resolving { return await t.value }
    let t = Task { @MainActor () -> [String: Any] in
      let s = await find(rebuild: rebuild)
      status = s
      path = s["ok"] as? Bool == true ? s["path"] as? String : nil
      resolving = nil
      return s
    }
    resolving = t
    return await t.value
  }

  private static func find(rebuild: Bool) async -> [String: Any] {
    guard let prefix = freerdpPrefix() else { return ["ok": false, "need": "freerdp"] }
    var cands: [String] = []
    if !rebuild, let r = Bundle.main.resourcePath { cands.append(r + "/bin/vs-rdp") }
    cands.append(supportDir + "/vs-rdp")
    if !rebuild {
      for c in cands where FileManager.default.isExecutableFile(atPath: c) {
        if let v = await version(c) { return ["ok": true, "path": c, "freerdp": v] }
      }
    }
    // 现编：要命令行工具（Xcode Command Line Tools；装 Homebrew 时一般已经装了）
    let clt = await RdpProc.run("/usr/bin/xcode-select", ["-p"], timeout: 5)
    guard clt.status == 0 else { return ["ok": false, "need": "clt"] }
    guard let src = Bundle.main.resourcePath.map({ $0 + "/vs-rdp.c" }), FileManager.default.fileExists(atPath: src) else { return ["ok": false, "need": "build", "detail": "vs-rdp.c not in the app"] }
    try? FileManager.default.createDirectory(atPath: supportDir, withIntermediateDirectories: true)
    let out = supportDir + "/vs-rdp", tmp = out + ".new"
    let cc = await RdpProc.run("/usr/bin/xcrun", ["clang", "-O2", "-w", src, "-I" + prefix + "/include/freerdp3", "-I" + prefix + "/include/winpr3", "-L" + prefix + "/lib",
                                                  "-lfreerdp3", "-lfreerdp-client3", "-lwinpr3", "-o", tmp], timeout: 120)
    guard cc.status == 0 else { return ["ok": false, "need": "build", "detail": String((cc.err + cc.out).suffix(2000))] }
    _ = try? FileManager.default.replaceItemAt(URL(fileURLWithPath: out), withItemAt: URL(fileURLWithPath: tmp))
    if !FileManager.default.fileExists(atPath: out) { try? FileManager.default.moveItem(atPath: tmp, toPath: out) }
    guard let v = await version(out) else { return ["ok": false, "need": "build", "detail": "built helper does not start"] }
    return ["ok": true, "path": out, "freerdp": v, "built": true]
  }

  // 跑得起来、协议对得上：回 FreeRDP 的版本
  private static func version(_ p: String) async -> String? {
    let r = await RdpProc.run(p, ["--version"], timeout: 5)
    guard r.status == 0, let d = r.out.data(using: .utf8), let j = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
          j["protocol"] as? Int == protocolVersion else { return nil }
    return j["freerdp"] as? String ?? "?"
  }
}

// 跑一个命令（不经 shell），等它结束或超时；input 写进它的标准输入
enum RdpProc {
  struct Result { var status: Int32; var out: String; var err: String }
  static func run(_ path: String, _ args: [String], input: String? = nil, timeout: Double) async -> Result {
    await withCheckedContinuation { (cont: CheckedContinuation<Result, Never>) in
      DispatchQueue.global(qos: .userInitiated).async {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: path)
        p.arguments = args
        let o = Pipe(), e = Pipe(), i = Pipe()
        p.standardOutput = o; p.standardError = e; p.standardInput = i
        do { try p.run() } catch { cont.resume(returning: Result(status: -1, out: "", err: error.localizedDescription)); return }
        if let input { i.fileHandleForWriting.write(input.data(using: .utf8) ?? Data()) }
        try? i.fileHandleForWriting.close()
        let timer = DispatchWorkItem { if p.isRunning { p.terminate() } }
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: timer)
        let od = o.fileHandleForReading.readDataToEndOfFile(), ed = e.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        timer.cancel()
        cont.resume(returning: Result(status: p.terminationStatus, out: String(decoding: od, as: UTF8.self), err: String(decoding: ed, as: UTF8.self)))
      }
    }
  }
}

// MARK: - 密码：钥匙串（登录钥匙串里的「Vibing Studio Remote Desktop」，按「用户名@地址:端口」分）。
//   经 /usr/bin/security 存取（它是系统签名的、一直不变）：App 自己的签名每次更新都会变（尤其是 ad-hoc 签名时），用自己的身份存的话每次更新都要再允许一次。
//   存的时候密码从标准输入进去（十六进制），不出现在命令行参数里
enum RdpKeychain {
  static let service = ProcessInfo.processInfo.environment["NADOS_RDP_KEYCHAIN"] ?? "Vibing Studio Remote Desktop"
  static func get(_ account: String) async -> String? {
    let r = await RdpProc.run("/usr/bin/security", ["find-generic-password", "-s", service, "-a", account, "-g"], timeout: 20)
    guard r.status == 0 else { return nil }
    for line in r.err.split(separator: "\n") where line.hasPrefix("password: ") {
      let v = line.dropFirst("password: ".count)
      if v.hasPrefix("0x") { // 有不可打印的字节（中文……）：给的是十六进制
        let hex = v.dropFirst(2).prefix { $0.isHexDigit }
        var bytes = [UInt8](), it = hex.makeIterator()
        while let a = it.next(), let b = it.next(), let x = UInt8(String([a, b]), radix: 16) { bytes.append(x) }
        return String(decoding: bytes, as: UTF8.self)
      }
      if v.hasPrefix("\""), v.hasSuffix("\""), v.count >= 2 { return String(v.dropFirst().dropLast()) }
      return v.isEmpty ? nil : String(v)
    }
    return nil
  }
  static func set(_ account: String, _ pw: String) async -> Bool {
    let hex = pw.utf8.map { String(format: "%02x", $0) }.joined()
    let line = "add-generic-password -U -s \"\(service)\" -a \"\(account)\" -l \"\(service) (\(account))\" -X \(hex)\n"
    let r = await RdpProc.run("/usr/bin/security", ["-i"], input: line, timeout: 20)
    return r.status == 0 && !r.err.contains("rror")
  }
  static func has(_ account: String) async -> Bool {
    await RdpProc.run("/usr/bin/security", ["find-generic-password", "-s", service, "-a", account], timeout: 20).status == 0
  }
  // 用户点了「忘记密码」/ 删了这个连接
  static func remove(_ account: String) async {
    _ = await RdpProc.run("/usr/bin/security", ["delete-generic-password", "-s", service, "-a", account], timeout: 20)
  }
}

// MARK: - 连接（UserDefaults 里的 rdp.hosts）：{ id, name, host, port, user, domain, clip, audio, avc444, cmd, scale, dynres, pin }
@MainActor
enum RdpStore {
  static let key = "rdp.hosts"
  static func all() -> [[String: Any]] { UserDefaults.standard.array(forKey: key) as? [[String: Any]] ?? [] }
  static func get(_ id: String) -> [String: Any]? { all().first { $0["id"] as? String == id } }
  static func account(_ h: [String: Any]) -> String { "\(h["user"] as? String ?? "")@\(h["host"] as? String ?? ""):\(h["port"] as? Int ?? 3389)" }
  static func clean(_ s: Any?, _ max: Int = 200) -> String { String((s as? String ?? "").filter { $0 != "\"" && !$0.isNewline && $0 != "\\" }.prefix(max)).trimmingCharacters(in: .whitespaces) }
  // 页面给的：只收认识的项，地址、用户名里不许有引号、换行（它们要放进钥匙串的命令里）
  static func save(_ a: [String: Any]) throws -> [String: Any] {
    var id = clean(a["id"], 40)
    if id.isEmpty || !id.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" }) { id = "h" + UUID().uuidString.prefix(8).lowercased() }
    var host = clean(a["host"]), port = (a["port"] as? NSNumber)?.intValue ?? 3389
    // 「地址:端口」写在一起的：拆开（IPv6 写成 [::1]:3389）
    if host.hasPrefix("["), let close = host.firstIndex(of: "]") {
      let rest = host[host.index(after: close)...]
      if rest.hasPrefix(":"), let p = Int(rest.dropFirst()) { port = p }
      host = String(host[host.index(after: host.startIndex)..<close])
    } else if host.filter({ $0 == ":" }).count == 1, let i = host.lastIndex(of: ":"), let p = Int(host[host.index(after: i)...]) { port = p; host = String(host[..<i]) }
    guard !host.isEmpty, !host.contains(" ") else { throw BridgeError.args("rdp.saveHost: host") }
    guard (1...65535).contains(port) else { throw BridgeError.args("rdp.saveHost: port") }
    let old = get(id) ?? [:]
    var h: [String: Any] = ["id": id, "host": host, "port": port, "user": clean(a["user"]), "domain": clean(a["domain"]),
                            "name": clean(a["name"], 80).isEmpty ? host : clean(a["name"], 80),
                            "clip": a["clip"] as? Bool ?? old["clip"] as? Bool ?? true, "audio": a["audio"] as? Bool ?? old["audio"] as? Bool ?? false,
                            "avc444": a["avc444"] as? Bool ?? old["avc444"] as? Bool ?? true, "dynres": a["dynres"] as? Bool ?? old["dynres"] as? Bool ?? true,
                            "cmd": ["ctrl", "super"].contains(a["cmd"] as? String ?? "") ? a["cmd"] as! String : old["cmd"] as? String ?? "ctrl",
                            "scale": ["fit", "1:1"].contains(a["scale"] as? String ?? "") ? a["scale"] as! String : old["scale"] as? String ?? "fit"]
    // 证书指纹：地址没变就留着（换了地址就是另一台，重新认）
    if let pin = old["pin"] as? String, old["host"] as? String == host, old["port"] as? Int == port { h["pin"] = pin }
    if let t = old["created"] { h["created"] = t } else { h["created"] = Date().timeIntervalSince1970 }
    if let t = old["lastAt"] { h["lastAt"] = t }
    put(h)
    return h
  }
  static func put(_ h: [String: Any]) {
    var l = all()
    if let i = l.firstIndex(where: { $0["id"] as? String == h["id"] as? String }) { l[i] = h } else { l.append(h) }
    UserDefaults.standard.set(l, forKey: key)
  }
  static func update(_ id: String, _ f: (inout [String: Any]) -> Void) {
    guard var h = get(id) else { return }
    f(&h)
    put(h)
  }
  static func remove(_ id: String) { UserDefaults.standard.set(all().filter { $0["id"] as? String != id }, forKey: key) }

  // .rdp 文件（Windows App / 远程桌面连接存的那种）：「full address:s:localhost:17144」「username:s:…」「redirectclipboard:i:1」「audiomode:i:2」
  static func parseRdpFile(_ text: String, name: String) -> [String: Any] {
    var h: [String: Any] = ["name": name]
    for raw in text.split(whereSeparator: \.isNewline) {
      let parts = raw.split(separator: ":", maxSplits: 2, omittingEmptySubsequences: false)
      guard parts.count == 3 else { continue }
      let k = parts[0].trimmingCharacters(in: .whitespaces).lowercased(), v = String(parts[2]).trimmingCharacters(in: .whitespaces)
      switch k {
      case "full address": h["host"] = v
      case "server port": if let p = Int(v) { h["port"] = p }
      case "username":
        if let i = v.firstIndex(of: "\\") { h["domain"] = String(v[..<i]); h["user"] = String(v[v.index(after: i)...]) } else { h["user"] = v }
      case "domain": h["domain"] = v
      case "redirectclipboard": h["clip"] = v != "0"
      case "audiomode": h["audio"] = v == "0" // 0：在这台电脑上播放；1：留在远端；2：不播放
      case "smart sizing": h["scale"] = v == "0" ? "1:1" : "fit"
      case "dynamic resolution": h["dynres"] = v != "0"
      default: break
      }
    }
    return h
  }
}

// MARK: - 页面的命令
@MainActor
final class RdpPanes: NSObject {
  static let commands = ["rdp.available", "rdp.hosts", "rdp.saveHost", "rdp.removeHost", "rdp.import", "rdp.open", "rdp.frame", "rdp.close", "rdp.list",
                         "rdp.focus", "rdp.opts", "rdp.keys", "rdp.trust", "rdp.forget", "rdp.snapshot", "rdp.refresh"]
  weak var controller: WebController?
  private var sessions: [String: RdpSession] = [:]

  func run(_ cmd: String, _ a: [String: Any]) async throws -> Any? {
    switch cmd {
    case "rdp.available":
      return await RdpHelper.resolve(rebuild: a["rebuild"] as? Bool ?? false)
    case "rdp.hosts":
      var out: [[String: Any]] = []
      for h in RdpStore.all() {
        var x = h
        x["hasPass"] = await RdpKeychain.has(RdpStore.account(h))
        x["open"] = sessions.values.contains { $0.hostId == h["id"] as? String && $0.alive }
        out.append(x)
      }
      return out
    case "rdp.saveHost":
      let h = try RdpStore.save(a)
      for s in sessions.values where s.hostId == h["id"] as? String { s.apply(h) } // 开着的：⌘ 键、缩放马上换
      return h
    case "rdp.removeHost":
      guard let id = a["id"] as? String, let h = RdpStore.get(id) else { return nil }
      for (k, s) in sessions where s.hostId == id { s.close(); sessions[k] = nil }
      await RdpKeychain.remove(RdpStore.account(h))
      RdpStore.remove(id)
      return nil
    case "rdp.import":
      // 从 .rdp 文件导入：选一个文件，读出地址、用户名、选项（不存：页面拿去填表，确认了再 rdp.saveHost）
      let panel = NSOpenPanel()
      panel.allowedContentTypes = [.init(filenameExtension: "rdp") ?? .data]
      panel.allowsMultipleSelection = false
      panel.directoryURL = URL(fileURLWithPath: NSHomeDirectory() + "/Desktop")
      panel.message = "选择一个远程桌面连接文件（.rdp）"
      guard let w = controller?.window, await panel.beginSheetModal(for: w) == .OK, let u = panel.url,
            let d = try? Data(contentsOf: u), d.count < 1 << 20 else { return nil }
      let text = String(data: d, encoding: .utf16) ?? String(decoding: d, as: UTF8.self) // Windows 存的常是 UTF-16
      return RdpStore.parseRdpFile(text.contains("full address") ? text : String(decoding: d, as: UTF8.self), name: u.deletingPathExtension().lastPathComponent)
    case "rdp.list":
      return sessions.map { ["id": $0.key, "host": $0.value.hostId, "state": $0.value.state] }
    default:
      break
    }
    guard let id = a["id"] as? String, !id.isEmpty else { throw BridgeError.args("\(cmd) { id, … }") }
    switch cmd {
    case "rdp.open":
      // 开（已经开着、连着的：接着用——页面重新载入后认回来）；没有密码 → { needPass: true }，页面让人输
      guard let hid = a["host"] as? String, let h = RdpStore.get(hid) else { throw BridgeError.args("rdp.open { id, host: <rdp.hosts 里的 id>, password?, remember? }") }
      if let s = sessions[id], s.hostId == hid, s.alive, a["password"] == nil, a["again"] as? Bool != true { return s.snapshotState() }
      sessions[id]?.close()
      let s = sessions[id] ?? RdpSession(id: id, panes: self)
      sessions[id] = s
      return await s.connect(h, password: a["password"] as? String, remember: a["remember"] as? Bool ?? true)
    case "rdp.frame":
      sessions[id]?.place(a)
      return nil
    case "rdp.close":
      sessions.removeValue(forKey: id)?.close(remove: true)
      return nil
    case "rdp.focus":
      sessions[id]?.focus()
      return nil
    case "rdp.opts":
      sessions[id]?.view.setOptions(a)
      return nil
    case "rdp.keys":
      sessions[id]?.view.sendCombo(a["combo"] as? String ?? "")
      return nil
    case "rdp.refresh":
      sessions[id]?.send("R")
      return nil
    case "rdp.trust":
      // 证书变了，用户确认是自己的那台：记下新的指纹，重新连
      guard let s = sessions[id], let fp = s.pendingCert, let h = RdpStore.get(s.hostId) else { return nil }
      RdpStore.update(s.hostId) { $0["pin"] = fp }
      return await s.connect(RdpStore.get(s.hostId) ?? h, password: nil, remember: true)
    case "rdp.forget":
      if let h = RdpStore.get(sessions[id]?.hostId ?? id) { await RdpKeychain.remove(RdpStore.account(h)) }
      return nil
    case "rdp.snapshot":
      return sessions[id]?.view.snapshot(width: (a["width"] as? NSNumber)?.doubleValue ?? 0)
    default:
      return nil
    }
  }

  func emit(_ detail: [String: Any]) { controller?.emit("rdp.state", detail) }
  func closeAll() { sessions.values.forEach { $0.close(remove: true) }; sessions.removeAll() }
}

// MARK: - 一个连接：助手进程、共享内存、状态
@MainActor
final class RdpSession {
  static let fbMax = 8192 * 8192 * 4 // 共享内存的大小（FreeRDP 最大 8192×8192；只有画到的部分才真占内存）
  private static var seq = 0
  let id: String
  private weak var panes: RdpPanes?
  let view: RdpView
  private(set) var hostId = ""
  private(set) var state = "idle"
  private var extra: [String: Any] = [:]
  private var pid: pid_t = 0
  private var stdinFD: Int32 = -1
  private var outFH: FileHandle?
  private var errFH: FileHandle?
  private var exitSrc: DispatchSourceProcess?
  private var shmFD: Int32 = -1
  private var fb: UnsafeMutableRawPointer?
  private var savePass: String?
  private(set) var pendingCert: String?
  private var tail: [String] = []
  private var gen = 0
  private var retries = 0
  private var retryItem: DispatchWorkItem?
  private var closing = false
  private let writeQ = DispatchQueue(label: "beer.paimon.rdp.write")
  var alive: Bool { pid > 0 }

  init(id: String, panes: RdpPanes) {
    self.id = id
    self.panes = panes
    view = RdpView(frame: .zero)
    view.session = self
    view.isHidden = true
    panes.controller?.webView.addSubview(view)
  }

  func snapshotState() -> [String: Any] { var d = extra; d["id"] = id; d["state"] = state; d["host"] = hostId; return d }
  private func setState(_ s: String, _ more: [String: Any] = [:]) {
    state = s
    extra = more
    if s == "connected" { extra["w"] = view.fbW; extra["h"] = view.fbH; extra["disp"] = view.dispOK }
    panes?.emit(snapshotState())
  }

  func apply(_ h: [String: Any]) { view.setOptions(["cmd": h["cmd"] as Any, "scale": h["scale"] as Any, "dynres": h["dynres"] as Any, "clip": h["clip"] as Any]) }

  // 连：密码（给了的、钥匙串里的）→ 起助手 → 把参数写进去
  func connect(_ h: [String: Any], password given: String?, remember: Bool) async -> [String: Any] {
    stop()
    retryItem?.cancel()
    hostId = h["id"] as? String ?? ""
    apply(h)
    let account = RdpStore.account(h)
    var pw = given
    if pw == nil { pw = await RdpKeychain.get(account) }
    guard let pw, !pw.isEmpty || (h["user"] as? String ?? "").isEmpty else {
      setState("needpass", ["user": h["user"] as? String ?? "", "account": account])
      return snapshotState()
    }
    savePass = given != nil && remember ? pw : nil
    let avail = await RdpHelper.resolve()
    guard avail["ok"] as? Bool == true, let helper = RdpHelper.path else { setState("unavailable", avail); return snapshotState() }
    guard spawn(helper) else { setState("error", ["kind": "start", "msg": "无法启动远程桌面组件"]); return snapshotState() }
    gen += 1
    closing = false
    let px = view.wantedPixels()
    var cfg = ""
    func line(_ k: String, _ v: String) { cfg += k + " " + RdpSession.pct(v) + "\n" }
    line("host", h["host"] as? String ?? "")
    line("port", String(h["port"] as? Int ?? 3389))
    line("user", h["user"] as? String ?? "")
    line("pass", pw)
    line("domain", h["domain"] as? String ?? "")
    line("w", String(px.w)); line("h", String(px.h)); line("scale", String(px.scale))
    line("clip", (h["clip"] as? Bool ?? true) ? "1" : "0")
    line("audio", (h["audio"] as? Bool ?? false) ? "1" : "0")
    line("avc444", (h["avc444"] as? Bool ?? true) ? "1" : "0")
    line("pin", h["pin"] as? String ?? "")
    line("cfg", RdpHelper.supportDir + "/freerdp")
    cfg += "connect\n"
    try? FileManager.default.createDirectory(atPath: RdpHelper.supportDir + "/freerdp", withIntermediateDirectories: true)
    send(cfg, raw: true)
    setState("connecting", ["attempt": retries])
    return snapshotState()
  }

  static func pct(_ s: String) -> String {
    var o = ""
    for b in s.utf8 {
      if (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5A) || (b >= 0x61 && b <= 0x7A) || b == 0x2E || b == 0x2D || b == 0x5F || b == 0x40 || b == 0x3A { o.append(Character(UnicodeScalar(b))) }
      else { o += String(format: "%%%02X", b) }
    }
    return o
  }

  private func spawn(_ helper: String) -> Bool {
    RdpSession.seq += 1
    let name = "/vsrdp.\(getpid()).\(RdpSession.seq)"
    let fd = vs_shm_open(name, O_RDWR | O_CREAT | O_EXCL, 0o600)
    guard fd >= 0 else { return false }
    shm_unlink(name) // 名字马上去掉：两边都开着就一直在，都关了系统自己收回（App、助手崩了也不留下）
    guard ftruncate(fd, off_t(RdpSession.fbMax)) == 0, let p = mmap(nil, RdpSession.fbMax, PROT_READ, MAP_SHARED, fd, 0), p != MAP_FAILED else { close(fd); return false }
    var inP: [Int32] = [0, 0], outP: [Int32] = [0, 0], errP: [Int32] = [0, 0]
    guard pipe(&inP) == 0, pipe(&outP) == 0, pipe(&errP) == 0 else { munmap(p, RdpSession.fbMax); close(fd); return false }
    var fa: posix_spawn_file_actions_t?
    posix_spawn_file_actions_init(&fa)
    posix_spawn_file_actions_adddup2(&fa, inP[0], 0)
    posix_spawn_file_actions_adddup2(&fa, outP[1], 1)
    posix_spawn_file_actions_adddup2(&fa, errP[1], 2)
    posix_spawn_file_actions_adddup2(&fa, fd, 3)
    var attr: posix_spawnattr_t?
    posix_spawnattr_init(&attr)
    posix_spawnattr_setflags(&attr, Int16(POSIX_SPAWN_CLOEXEC_DEFAULT)) // 只给它这四个，App 别的文件、端口一个都不带过去
    let argv: [UnsafeMutablePointer<CChar>?] = [strdup(helper), nil]
    let envs = ["HOME=" + NSHomeDirectory(), "PATH=/usr/bin:/bin", "LANG=en_US.UTF-8", "WLOG_LEVEL=WARN"]
    let envp: [UnsafeMutablePointer<CChar>?] = envs.map { strdup($0) } + [nil]
    var child: pid_t = 0
    let rc = posix_spawn(&child, helper, &fa, &attr, argv, envp)
    argv.forEach { free($0) }; envp.forEach { free($0) }
    posix_spawn_file_actions_destroy(&fa); posix_spawnattr_destroy(&attr)
    close(inP[0]); close(outP[1]); close(errP[1])
    guard rc == 0 else { close(inP[1]); close(outP[0]); close(errP[0]); munmap(p, RdpSession.fbMax); close(fd); return false }
    pid = child
    stdinFD = inP[1]
    shmFD = fd
    fb = p
    view.attach(UnsafeRawPointer(p))
    let myGen = gen + 1
    var buf = Data()
    let out = FileHandle(fileDescriptor: outP[0], closeOnDealloc: true)
    out.readabilityHandler = { [weak self] fh in
      let d = fh.availableData
      if d.isEmpty { fh.readabilityHandler = nil; return }
      buf.append(d)
      var evs: [[String: Any]] = []
      while let nl = buf.firstIndex(of: 0x0A) {
        let line = buf[buf.startIndex..<nl]
        buf.removeSubrange(buf.startIndex...nl)
        if let j = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any] { evs.append(j) }
      }
      if !evs.isEmpty { DispatchQueue.main.async { MainActor.assumeIsolated { self?.handle(evs, gen: myGen) } } }
    }
    outFH = out
    let err = FileHandle(fileDescriptor: errP[0], closeOnDealloc: true)
    err.readabilityHandler = { [weak self] fh in
      let d = fh.availableData
      if d.isEmpty { fh.readabilityHandler = nil; return }
      let s = String(decoding: d, as: UTF8.self)
      DispatchQueue.main.async { MainActor.assumeIsolated { self?.log(s) } }
    }
    errFH = err
    let src = DispatchSource.makeProcessSource(identifier: child, eventMask: .exit, queue: .main)
    src.setEventHandler { [weak self] in MainActor.assumeIsolated { self?.exited(child, gen: myGen) } }
    src.resume()
    exitSrc = src
    return true
  }

  private func log(_ s: String) {
    for l in s.split(separator: "\n") where !l.contains("log_build_warn") && !l.contains("keep_alive") { tail.append(String(l.suffix(400))) }
    if tail.count > 80 { tail.removeFirst(tail.count - 80) }
  }

  func send(_ s: String, raw: Bool = false) {
    let fd = stdinFD
    guard fd >= 0 else { return }
    let d = Array((raw ? s : s + "\n").utf8)
    writeQ.async { d.withUnsafeBufferPointer { b in var off = 0; while off < b.count { let n = write(fd, b.baseAddress! + off, b.count - off); if n <= 0 { if errno == EINTR { continue }; break }; off += n } } }
  }

  private func handle(_ evs: [[String: Any]], gen g: Int) {
    guard g == gen else { return }
    for e in evs {
      switch e["ev"] as? String ?? "" {
      case "frame":
        view.damage(CGRect(x: num(e["x"]), y: num(e["y"]), width: num(e["w"]), height: num(e["h"])))
      case "size":
        view.setSize(Int(num(e["w"])), Int(num(e["h"])), Int(num(e["stride"])))
        if state == "connected" { setState("connected") }
      case "cursor":
        view.cursorEvent(e)
      case "clip":
        view.remoteClipboard(e["text"] as? String ?? "")
      case "disp":
        view.dispOK = true
        view.requestResize(force: true)
        if state == "connected" { setState("connected") }
      case "cert":
        let fp = e["fp"] as? String ?? ""
        if e["ok"] as? Bool == true {
          if RdpStore.get(hostId)?["pin"] as? String ?? "" == "" { RdpStore.update(hostId) { $0["pin"] = fp } } // 第一次：记下
        } else {
          pendingCert = fp
          setState("cert", ["fp": fp, "old": RdpStore.get(hostId)?["pin"] as? String ?? "", "subject": e["subject"] as? String ?? ""])
        }
      case "needpass":
        if let h = RdpStore.get(hostId) { setState("needpass", ["user": h["user"] as? String ?? "", "account": RdpStore.account(h)]) }
      case "state":
        let s = e["s"] as? String ?? ""
        if s == "connected" {
          retries = 0
          RdpStore.update(hostId) { $0["lastAt"] = Date().timeIntervalSince1970 }
          if let pw = savePass, let h = RdpStore.get(hostId) { savePass = nil; Task { _ = await RdpKeychain.set(RdpStore.account(h), pw) } }
          setState("connected")
          view.connected()
        } else if s == "closed" {
          if state == "error" || state == "needpass" || state == "cert" || state == "reconnecting" { break }
          if e["by"] as? String == "app" { setState("closed", ["by": "app"]) } else { remoteClosed(code: Int(num(e["code"]))) }
        }
      case "error":
        failed(e)
      case "logon":
        extra["logon"] = e["what"] as? String ?? ""
      case "beep":
        NSSound.beep()
      default:
        break
      }
    }
  }

  // 连不上 / 断了：分类（密码不对、网络、远端注销……），网络的自己重连几次（隧道一会儿就回来）
  private func failed(_ e: [String: Any]) {
    let name = e["name"] as? String ?? "", msg = e["msg"] as? String ?? ""
    let wasUp = state == "connected"
    var kind = "other"
    if ["AUTHENTICATION_FAILED", "LOGON_FAILURE", "WRONG_PASSWORD", "NO_OR_MISSING_CREDENTIALS", "ACCESS_DENIED", "ACCOUNT_", "PASSWORD_"].contains(where: { name.contains($0) }) { kind = "auth" }
    else if ["CONNECT_FAILED", "DNS_NAME_NOT_FOUND", "TRANSPORT_FAILED", "CONNECT_CANCELLED", "TLS_CONNECT_FAILED", "MCS_", "INSUFFICIENT_PRIVILEGES"].contains(where: { name.contains($0) }) || name.hasPrefix("ERRCONNECT") { kind = "net" }
    if name.contains("LOGOFF") || name.contains("DISCONNECTED_BY_OTHER") || name.contains("RPC_INITIATED_DISCONNECT") || name.contains("REPLACED") { kind = "ended" }
    if state == "cert" { return }
    if kind == "net", wasUp || retries > 0, retries < 8 { reconnectLater(); return }
    setState("error", ["kind": kind, "name": name, "msg": msg, "code": e["code"] ?? 0, "log": tail.suffix(12).joined(separator: "\n")])
  }
  private func remoteClosed(code: Int) {
    if state == "connected", retries < 8 { reconnectLater(); return }
    setState("closed", ["by": "remote", "code": code])
  }
  private func reconnectLater() {
    retries += 1
    let delay = min(30.0, pow(2.0, Double(retries)))
    setState("reconnecting", ["attempt": retries, "in": delay])
    let item = DispatchWorkItem { [weak self] in
      MainActor.assumeIsolated {
        guard let self, self.state == "reconnecting", let h = RdpStore.get(self.hostId) else { return }
        Task { _ = await self.connect(h, password: nil, remember: true) }
      }
    }
    retryItem = item
    DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
  }

  private func exited(_ child: pid_t, gen g: Int) {
    var st: Int32 = 0
    waitpid(child, &st, WNOHANG)
    if child == pid { cleanup() }
    guard g == gen, !closing else { return }
    if state == "connecting" || state == "connected" {
      // 没说一声就没了（崩了）：把最后几行日志带上
      setState("error", ["kind": "crash", "msg": "远程桌面组件意外退出", "log": tail.suffix(12).joined(separator: "\n")])
    }
  }
  private func cleanup() {
    exitSrc?.cancel(); exitSrc = nil
    outFH?.readabilityHandler = nil; errFH?.readabilityHandler = nil
    outFH = nil; errFH = nil
    if stdinFD >= 0 { let fd = stdinFD; writeQ.async { close(fd) }; stdinFD = -1 }
    view.detachFramebuffer()
    if let fb { munmap(fb, RdpSession.fbMax) }
    fb = nil
    if shmFD >= 0 { close(shmFD); shmFD = -1 }
    pid = 0
  }
  // 断开助手（换密码重连、关标签页）：先请它体面地断开，3 秒不走就结束它
  private func stop() {
    guard pid > 0 else { return }
    closing = true
    gen += 1
    let p = pid
    send("q")
    if stdinFD >= 0 { let fd = stdinFD; writeQ.async { close(fd) }; stdinFD = -1 }
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { if kill(p, 0) == 0 { kill(p, SIGTERM) } }
  }
  func close(remove: Bool = false) {
    retryItem?.cancel()
    stop()
    if remove { view.removeFromSuperview(); view.session = nil }
    if state != "idle" { setState("closed", ["by": "app"]) }
  }

  func place(_ a: [String: Any]) {
    guard let host = panes?.controller?.webView else { return }
    let x = num(a["x"]), y = num(a["y"]), w = max(0, num(a["w"])), h = max(0, num(a["h"]))
    view.frame = NSRect(x: x, y: host.isFlipped ? y : host.bounds.height - y - h, width: w, height: h)
    let vis = (a["visible"] as? Bool ?? true) && w >= 4 && h >= 4
    view.setVisible(vis)
  }
  func focus() { view.window?.makeFirstResponder(view) }
  private func num(_ x: Any?) -> CGFloat { CGFloat((x as? NSNumber)?.doubleValue ?? 0) }
}

// MARK: - 键：Mac 的键码 → PC 键盘的扫描码（set 1；扩展键带 0x100）
enum RdpKeys {
  static let map: [UInt16: UInt32] = [
    0x00: 0x1E, 0x01: 0x1F, 0x02: 0x20, 0x03: 0x21, 0x04: 0x23, 0x05: 0x22, 0x06: 0x2C, 0x07: 0x2D, 0x08: 0x2E, 0x09: 0x2F, // A S D F H G Z X C V
    0x0A: 0x56, 0x0B: 0x30, 0x0C: 0x10, 0x0D: 0x11, 0x0E: 0x12, 0x0F: 0x13, 0x10: 0x15, 0x11: 0x14, // § B Q W E R Y T
    0x12: 0x02, 0x13: 0x03, 0x14: 0x04, 0x15: 0x05, 0x16: 0x07, 0x17: 0x06, 0x18: 0x0D, 0x19: 0x0A, 0x1A: 0x08, 0x1B: 0x0C, 0x1C: 0x09, 0x1D: 0x0B, // 1 2 3 4 6 5 = 9 7 - 8 0
    0x1E: 0x1B, 0x1F: 0x18, 0x20: 0x16, 0x21: 0x1A, 0x22: 0x17, 0x23: 0x19, 0x24: 0x1C, 0x25: 0x26, 0x26: 0x24, 0x27: 0x28, 0x28: 0x25, 0x29: 0x27, // ] O U [ I P Return L J ' K ;
    0x2A: 0x2B, 0x2B: 0x33, 0x2C: 0x35, 0x2D: 0x31, 0x2E: 0x32, 0x2F: 0x34, 0x30: 0x0F, 0x31: 0x39, 0x32: 0x29, 0x33: 0x0E, 0x35: 0x01, // \ , / N M . Tab Space ` Delete Esc
    0x40: 0x68, 0x41: 0x53, 0x43: 0x37, 0x45: 0x4E, 0x47: 0x45, 0x4B: 0x135, 0x4C: 0x11C, 0x4E: 0x4A, 0x4F: 0x69, 0x50: 0x6A, 0x51: 0x59, // F17 KP. KP* KP+ Clear KP/ KPEnter KP- F18 F19 KP=
    0x52: 0x52, 0x53: 0x4F, 0x54: 0x50, 0x55: 0x51, 0x56: 0x4B, 0x57: 0x4C, 0x58: 0x4D, 0x59: 0x47, 0x5B: 0x48, 0x5C: 0x49, // KP0–KP9
    0x5D: 0x7D, 0x5E: 0x73, 0x5F: 0x7E, 0x66: 0x7B, 0x68: 0x70, // JIS：¥ _ KP, 英数 かな
    0x60: 0x3F, 0x61: 0x40, 0x62: 0x41, 0x63: 0x3D, 0x64: 0x42, 0x65: 0x43, 0x67: 0x57, 0x69: 0x64, 0x6A: 0x67, 0x6B: 0x65, 0x6D: 0x44, 0x6E: 0x15D, 0x6F: 0x58, // F5 F6 F7 F3 F8 F9 F11 F13 F16 F14 F10 Menu F12
    0x71: 0x66, 0x72: 0x152, 0x73: 0x147, 0x74: 0x149, 0x75: 0x153, 0x76: 0x3E, 0x77: 0x14F, 0x78: 0x3C, 0x79: 0x151, 0x7A: 0x3B, // F15 Help/Insert Home PgUp FwdDel F4 End F2 PgDn F1
    0x7B: 0x14B, 0x7C: 0x14D, 0x7D: 0x150, 0x7E: 0x148, // ← → ↓ ↑
  ]
  // 修饰键：Mac 键码 → (扫描码, 这个键自己的那一位——左右分开)
  static let mods: [UInt16: (UInt32, UInt)] = [
    0x38: (0x2A, 0x02), 0x3C: (0x36, 0x04), // Shift 左 右
    0x3B: (0x1D, 0x01), 0x3E: (0x11D, 0x2000), // Control
    0x3A: (0x38, 0x20), 0x3D: (0x138, 0x40), // Option → Alt（右边是 AltGr）
    0x37: (0x15B, 0x08), 0x36: (0x15C, 0x10), // ⌘ → Super（「⌘ 当 Ctrl」时另算）
  ]
  static let ctrl: UInt32 = 0x1D, alt: UInt32 = 0x38, shift: UInt32 = 0x2A, superL: UInt32 = 0x15B, del: UInt32 = 0x153, tab: UInt32 = 0x0F, caps: UInt32 = 0x3A
  // 组合键（工具栏「发送按键」）：「Ctrl+Alt+Delete」「Super」「Alt+Tab」「Print」……
  static func combo(_ s: String) -> [UInt32] {
    let names: [String: UInt32] = ["ctrl": 0x1D, "control": 0x1D, "alt": 0x38, "shift": 0x2A, "super": 0x15B, "win": 0x15B, "meta": 0x15B, "delete": 0x153, "del": 0x153,
                                   "tab": 0x0F, "esc": 0x01, "escape": 0x01, "print": 0x137, "printscreen": 0x137, "enter": 0x1C, "space": 0x39, "backspace": 0x0E,
                                   "f1": 0x3B, "f2": 0x3C, "f3": 0x3D, "f4": 0x3E, "f5": 0x3F, "f6": 0x40, "f7": 0x41, "f8": 0x42, "f9": 0x43, "f10": 0x44, "f11": 0x57, "f12": 0x58,
                                   "left": 0x14B, "right": 0x14D, "up": 0x148, "down": 0x150, "home": 0x147, "end": 0x14F, "pageup": 0x149, "pagedown": 0x151, "t": 0x14, "l": 0x26, "d": 0x20]
    return s.lowercased().split(separator: "+").compactMap { names[$0.trimmingCharacters(in: .whitespaces)] }
  }
}

// MARK: - 视图：画面、键盘、鼠标、指针、剪贴板
@MainActor
final class RdpView: NSView {
  weak var session: RdpSession?
  private(set) var fbW = 0, fbH = 0
  private var stride = 0
  private var fb: UnsafeRawPointer?
  private let img = CALayer()
  private var surfaces: [IOSurface] = []
  private var dirty: [CGRect] = []
  private var cur = 0
  private var presentQueued = false
  var dispOK = false
  // 选项（连接里记着的，工具栏能改）
  private var cmdAsCtrl = true
  private var oneToOne = false
  private var dynres = true
  private var clipOn = true
  // 键盘鼠标的状态：松手时要补发的
  private var pressed = Set<UInt32>()
  private var buttons: UInt16 = 0
  private var xbuttons: UInt16 = 0
  private var cmdHeld = Set<UInt16>()
  private var cmdCommitted = false, cmdUsed = false
  private var cmdDownAt = Date.distantPast
  private var monitor: Any?
  private var lastPos = (x: 0, y: 0)
  private var wheelAcc = (x: CGFloat(0), y: CGFloat(0))
  // 指针
  private var cursors: [Int: NSCursor] = [:]
  private var cursorNow: NSCursor = .arrow
  private static let blank: NSCursor = { let i = NSImage(size: NSSize(width: 1, height: 1)); return NSCursor(image: i, hotSpot: .zero) }()
  // 剪贴板
  private var pbCount = NSPasteboard.general.changeCount
  private var pbTimer: Timer?
  private var pbPending = false
  // 改分辨率
  private var resizeItem: DispatchWorkItem?
  private var lastAsked = (w: 0, h: 0)
  private var suppressItem: DispatchWorkItem?
  private var visibleNow = false

  override init(frame: NSRect) {
    super.init(frame: frame)
    wantsLayer = true
    layer?.backgroundColor = NSColor.black.cgColor
    img.isOpaque = true
    img.contentsGravity = .resize
    img.magnificationFilter = .linear
    img.minificationFilter = .linear
    img.actions = ["contents": NSNull(), "bounds": NSNull(), "position": NSNull(), "frame": NSNull()]
    layer?.addSublayer(img)
    addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .activeAlways, .inVisibleRect, .cursorUpdate], owner: self))
    NotificationCenter.default.addObserver(self, selector: #selector(winResign), name: NSWindow.didResignKeyNotification, object: nil)
  }
  required init?(coder: NSCoder) { fatalError() }

  override var isFlipped: Bool { true }
  override var acceptsFirstResponder: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  func setOptions(_ a: [String: Any]) {
    if let c = a["cmd"] as? String { cmdAsCtrl = c != "super" }
    if let s = a["scale"] as? String { oneToOne = s == "1:1"; needsLayout = true }
    if let d = a["dynres"] as? Bool { dynres = d; if d { requestResize(force: true) } }
    if let c = a["clip"] as? Bool { clipOn = c }
  }

  // ---- 画面 ----
  func attach(_ p: UnsafeRawPointer) { fb = p }
  func detachFramebuffer() { fb = nil }
  func setSize(_ w: Int, _ h: Int, _ s: Int) {
    guard w > 0, h > 0 else { return }
    fbW = w; fbH = h; stride = s
    surfaces = (0..<3).compactMap { _ in
      IOSurface(properties: [.width: w, .height: h, .bytesPerElement: 4, .pixelFormat: 0x4247_5241 /* 'BGRA' */, .bytesPerRow: IOSurfaceAlignProperty(kIOSurfacePlaneBytesPerRow, w * 4)])
    }
    for s in surfaces { IOSurfaceSetValue(s, kIOSurfaceColorSpace, CGColorSpace(name: CGColorSpace.sRGB)!.copyPropertyList()!) }
    dirty = Array(repeating: CGRect(x: 0, y: 0, width: w, height: h), count: surfaces.count)
    needsLayout = true
    schedulePresent()
  }
  func damage(_ r: CGRect) {
    for i in dirty.indices { dirty[i] = dirty[i].union(r) }
    schedulePresent()
  }
  private func schedulePresent() {
    if presentQueued { return }
    presentQueued = true
    DispatchQueue.main.async { [weak self] in MainActor.assumeIsolated { self?.presentQueued = false; self?.present() } }
  }
  private func present() {
    guard !isHidden, !surfaces.isEmpty, let fb else { return }
    let i = (cur + 1) % surfaces.count
    let r = dirty[i].intersection(CGRect(x: 0, y: 0, width: fbW, height: fbH)).integral
    let s = surfaces[i]
    if !r.isNull, r.width > 0, r.height > 0 {
      s.lock(options: [], seed: nil)
      let dst = s.baseAddress, ds = s.bytesPerRow
      let x0 = Int(r.minX), y0 = Int(r.minY), rw = Int(r.width) * 4
      for y in y0..<Int(r.maxY) { memcpy(dst + y * ds + x0 * 4, fb + y * stride + x0 * 4, rw) }
      s.unlock(options: [], seed: nil)
    }
    dirty[i] = .null
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    img.contents = s
    CATransaction.commit()
    cur = i
  }

  // 画面放在哪：适应窗口（等比缩放、居中）/ 1:1（一个远端像素一个屏幕像素；比视图大时跟着鼠标平移）
  private var imgRect: CGRect {
    guard fbW > 0, fbH > 0, bounds.width > 0, bounds.height > 0 else { return bounds }
    let W = CGFloat(fbW), H = CGFloat(fbH)
    if oneToOne {
      let s = 1 / (window?.backingScaleFactor ?? 2), w = W * s, h = H * s
      let px = w > bounds.width ? (bounds.width - w) * panX : (bounds.width - w) / 2, py = h > bounds.height ? (bounds.height - h) * panY : (bounds.height - h) / 2
      return CGRect(x: px.rounded(), y: py.rounded(), width: w, height: h)
    }
    let k = min(bounds.width / W, bounds.height / H), w = W * k, h = H * k
    return CGRect(x: ((bounds.width - w) / 2).rounded(), y: ((bounds.height - h) / 2).rounded(), width: w, height: h)
  }
  private var panX: CGFloat = 0.5, panY: CGFloat = 0.5
  override func layout() {
    super.layout()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    img.frame = imgRect
    img.contentsScale = window?.backingScaleFactor ?? 2
    CATransaction.commit()
    requestResize()
  }
  override func viewDidChangeBackingProperties() { super.viewDidChangeBackingProperties(); needsLayout = true }

  // 远端要多大（连上时、视图大小变了时；远端支持「显示控制」才改得了）：视图的像素大小，缩放跟着屏幕（视网膜屏 200%）
  func wantedPixels() -> (w: Int, h: Int, scale: Int) {
    let s = window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2
    var w = Int(bounds.width * s), h = Int(bounds.height * s)
    if w < 400 || h < 300 { w = Int((NSScreen.main?.frame.width ?? 1440) * s); h = Int((NSScreen.main?.frame.height ?? 900) * s) }
    return (min(w, 8192) & ~1, min(h, 8192), Int(s * 100))
  }
  func requestResize(force: Bool = false) {
    guard dispOK, dynres, !isHidden, bounds.width >= 200, bounds.height >= 150 else { return }
    resizeItem?.cancel()
    let item = DispatchWorkItem { [weak self] in
      MainActor.assumeIsolated {
        guard let self else { return }
        let px = self.wantedPixels()
        if !force && px.w == self.lastAsked.w && px.h == self.lastAsked.h { return }
        if px.w == self.fbW && px.h == self.fbH { self.lastAsked = (px.w, px.h); return }
        self.lastAsked = (px.w, px.h)
        self.session?.send("r \(px.w) \(px.h) \(px.scale)")
      }
    }
    resizeItem = item
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: item)
  }

  // 看不看得见：藏起来 3 秒以上让远端先别发画面（省流量）；露出来马上接着发
  func setVisible(_ v: Bool) {
    let was = !isHidden
    isHidden = !v
    if v && !was { schedulePresent(); needsLayout = true }
    if !v, window?.firstResponder === self { window?.makeFirstResponder(superview) }
    suppressItem?.cancel()
    if v != visibleNow {
      if v { visibleNow = true; session?.send("v 1"); flushClipboardIfPending() }
      else {
        let item = DispatchWorkItem { [weak self] in MainActor.assumeIsolated { guard let self, self.isHidden else { return }; self.visibleNow = false; self.session?.send("v 0") } }
        suppressItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: item)
      }
    }
  }
  func connected() {
    visibleNow = true
    if isHidden { setVisible(false) }
    pbCount = -1 // 连上时把这台 Mac 上复制着的文字告诉远端
    startClipboard()
  }

  // 标签页概览的缩略图
  func snapshot(width: Double) -> String? {
    guard let fb, fbW > 0, fbH > 0 else { return nil }
    let cs = CGColorSpace(name: CGColorSpace.sRGB)!
    guard let provider = CGDataProvider(dataInfo: nil, data: fb, size: stride * fbH, releaseData: { _, _, _ in }),
          let cg = CGImage(width: fbW, height: fbH, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: stride, space: cs,
                           bitmapInfo: CGBitmapInfo(rawValue: CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.noneSkipFirst.rawValue),
                           provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent) else { return nil }
    let tw = width > 0 ? min(Double(fbW), width) : Double(fbW), th = tw * Double(fbH) / Double(fbW)
    guard let ctx = CGContext(data: nil, width: Int(tw), height: Int(th), bitsPerComponent: 8, bytesPerRow: 0, space: cs, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
    ctx.interpolationQuality = .high
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: tw, height: th))
    guard let small = ctx.makeImage(), let jpg = NSBitmapImageRep(cgImage: small).representation(using: .jpeg, properties: [.compressionFactor: 0.75]) else { return nil }
    return "data:image/jpeg;base64," + jpg.base64EncodedString()
  }

  // ---- 指针（远端给的样子） ----
  func cursorEvent(_ e: [String: Any]) {
    if let id = e["id"] as? Int, let b64 = e["data"] as? String, let data = Data(base64Encoded: b64) {
      let w = e["w"] as? Int ?? 0, h = e["h"] as? Int ?? 0
      guard w > 0, h > 0, data.count >= w * h * 4, let provider = CGDataProvider(data: data as CFData),
            let cg = CGImage(width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: w * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                             bitmapInfo: CGBitmapInfo(rawValue: CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.first.rawValue), provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)
      else { return }
      // 跟着画面缩放：远端 1 像素在这里是多大
      let k = fbW > 0 ? imgRect.width / CGFloat(fbW) : 0.5
      let size = NSSize(width: max(8, CGFloat(w) * k), height: max(8, CGFloat(h) * k))
      let hs = NSPoint(x: CGFloat(e["hx"] as? Int ?? 0) * k, y: CGFloat(e["hy"] as? Int ?? 0) * k)
      cursors[id] = NSCursor(image: NSImage(cgImage: cg, size: size), hotSpot: hs)
      return
    }
    if let id = e["free"] as? Int { cursors[id] = nil; return }
    if e["hide"] as? Bool == true { cursorNow = RdpView.blank }
    else if let id = e["set"] as? Int { cursorNow = id == 0 ? .arrow : cursors[id] ?? .arrow }
    window?.invalidateCursorRects(for: self)
    if let w = window, frame.contains(superview?.convert(w.mouseLocationOutsideOfEventStream, from: nil) ?? .zero) { cursorNow.set() }
  }
  override func resetCursorRects() { addCursorRect(visibleRect, cursor: cursorNow) }
  override func cursorUpdate(with event: NSEvent) { cursorNow.set() }

  // ---- 鼠标 ----
  private func remote(_ e: NSEvent) -> (x: Int, y: Int) {
    let p = convert(e.locationInWindow, from: nil), r = imgRect
    if oneToOne && (r.width > bounds.width || r.height > bounds.height) {
      panX = min(1, max(0, p.x / max(1, bounds.width))); panY = min(1, max(0, p.y / max(1, bounds.height)))
      needsLayout = true
    }
    guard r.width > 0, r.height > 0, fbW > 0 else { return (0, 0) }
    let x = Int(((p.x - r.minX) / r.width * CGFloat(fbW)).rounded(.down)), y = Int(((p.y - r.minY) / r.height * CGFloat(fbH)).rounded(.down))
    return (min(max(0, x), fbW - 1), min(max(0, y), fbH - 1))
  }
  private func mouse(_ flags: UInt16, _ e: NSEvent) {
    let p = remote(e)
    lastPos = p
    session?.send("m \(flags) \(p.x) \(p.y)")
  }
  private static let MOVE: UInt16 = 0x0800, DOWN: UInt16 = 0x8000, B1: UInt16 = 0x1000, B2: UInt16 = 0x2000, B3: UInt16 = 0x4000
  override func mouseMoved(with e: NSEvent) { cursorNow.set(); if fbW > 0 { mouse(RdpView.MOVE, e) } }
  override func mouseDragged(with e: NSEvent) { mouse(RdpView.MOVE, e) }
  override func rightMouseDragged(with e: NSEvent) { mouse(RdpView.MOVE, e) }
  override func otherMouseDragged(with e: NSEvent) { mouse(RdpView.MOVE, e) }
  override func mouseEntered(with e: NSEvent) { cursorNow.set() }
  override func mouseDown(with e: NSEvent) { window?.makeFirstResponder(self); beforeInput(); buttons |= RdpView.B1; mouse(RdpView.DOWN | RdpView.B1, e) }
  override func mouseUp(with e: NSEvent) { buttons &= ~RdpView.B1; mouse(RdpView.B1, e) }
  override func rightMouseDown(with e: NSEvent) { window?.makeFirstResponder(self); beforeInput(); buttons |= RdpView.B2; mouse(RdpView.DOWN | RdpView.B2, e) }
  override func rightMouseUp(with e: NSEvent) { buttons &= ~RdpView.B2; mouse(RdpView.B2, e) }
  override func otherMouseDown(with e: NSEvent) {
    window?.makeFirstResponder(self); beforeInput()
    if e.buttonNumber == 2 { buttons |= RdpView.B3; mouse(RdpView.DOWN | RdpView.B3, e) }
    else if e.buttonNumber == 3 || e.buttonNumber == 4 { let b: UInt16 = e.buttonNumber == 3 ? 1 : 2; xbuttons |= b; let p = remote(e); session?.send("x \(0x8000 | b) \(p.x) \(p.y)") } // 侧键：后退 / 前进
  }
  override func otherMouseUp(with e: NSEvent) {
    if e.buttonNumber == 2 { buttons &= ~RdpView.B3; mouse(RdpView.B3, e) }
    else if e.buttonNumber == 3 || e.buttonNumber == 4 { let b: UInt16 = e.buttonNumber == 3 ? 1 : 2; xbuttons &= ~b; let p = remote(e); session?.send("x \(b) \(p.x) \(p.y)") }
  }
  // 滚轮 / 触控板：120 = 鼠标滚轮的一格；触控板按点数累计（方向跟这台 Mac 的设置走——系统给的已经是「自然」之后的）
  override func scrollWheel(with e: NSEvent) {
    guard fbW > 0 else { return }
    let p = remote(e)
    if e.hasPreciseScrollingDeltas { wheelAcc.y += e.scrollingDeltaY * 3; wheelAcc.x -= e.scrollingDeltaX * 3 }
    else { wheelAcc.y += e.scrollingDeltaY * 120; wheelAcc.x -= e.scrollingDeltaX * 120 }
    let step: CGFloat = e.hasPreciseScrollingDeltas ? 24 : 1
    for horiz in [false, true] {
      let acc = horiz ? wheelAcc.x : wheelAcc.y
      guard abs(acc) >= step else { continue }
      let units = Int((acc / step).rounded(.towardZero)) * Int(step)
      session?.send("w \(horiz ? 1 : 0) \(units) \(p.x) \(p.y)")
      if horiz { wheelAcc.x -= CGFloat(units) } else { wheelAcc.y -= CGFloat(units) }
    }
  }

  // ---- 键盘：成了第一响应者就接管这个窗口的键（本地事件监视器——带 ⌘ 的键、⌘ 松开都拿得到）；
  //   留给 Mac 的：⌘Q、⌘H、⌘M、⌘`、⌃⌘F（全屏）、⌘⌥Esc
  override func becomeFirstResponder() -> Bool {
    if monitor == nil {
      monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .keyUp, .flagsChanged]) { [weak self] e in
        MainActor.assumeIsolated {
          guard let self, e.window === self.window, self.window?.firstResponder === self else { return e }
          if self.keepForMac(e) { return e }
          self.key(e)
          return nil
        }
      }
    }
    syncLocks()
    flushClipboardIfPending()
    session.map { panesEmitFocus($0, true) }
    return true
  }
  override func resignFirstResponder() -> Bool {
    if let m = monitor { NSEvent.removeMonitor(m); monitor = nil }
    releaseAll()
    session.map { panesEmitFocus($0, false) }
    return true
  }
  private func panesEmitFocus(_ s: RdpSession, _ on: Bool) { window.flatMap { _ in s }?.view === self ? NotificationCenter.default.post(name: .init("vsRdpFocus"), object: s, userInfo: ["on": on]) : () }
  @objc private func winResign(_ n: Notification) { if (n.object as? NSWindow) === window { releaseAll() } }

  private func keepForMac(_ e: NSEvent) -> Bool {
    guard e.type == .keyDown || e.type == .keyUp else { return false }
    let f = e.modifierFlags.intersection(.deviceIndependentFlagsMask)
    guard f.contains(.command) else { return false }
    let k = e.keyCode
    if f.contains(.control) && k == 0x03 { return true } // ⌃⌘F
    if f.contains(.option) && k == 0x35 { return true } // ⌘⌥Esc
    return [0x0C, 0x04, 0x2E, 0x32].contains(k) // Q H M `
  }

  private func key(_ e: NSEvent) {
    switch e.type {
    case .flagsChanged: modifier(e)
    case .keyDown:
      guard let sc = RdpKeys.map[e.keyCode] else { return }
      beforeInput()
      pressed.insert(sc)
      session?.send(String(format: "k %d %x", e.isARepeat ? 2 : 1, sc))
    case .keyUp:
      guard let sc = RdpKeys.map[e.keyCode] else { return }
      pressed.remove(sc)
      session?.send(String(format: "k 0 %x", sc))
    default: break
    }
  }
  private func sendKey(_ sc: UInt32, _ down: Bool) {
    if down { pressed.insert(sc) } else { pressed.remove(sc) }
    session?.send(String(format: "k %d %x", down ? 1 : 0, sc))
  }
  private func modifier(_ e: NSEvent) {
    let k = e.keyCode, raw = e.modifierFlags.rawValue
    if k == 0x39 { sendKey(RdpKeys.caps, true); sendKey(RdpKeys.caps, false); return } // 大写锁定：按一下切一下
    guard let (sc, bit) = RdpKeys.mods[k] else { return }
    let down = raw & bit != 0
    if k == 0x37 || k == 0x36, cmdAsCtrl {
      // ⌘ 当 Ctrl：按下先不发；接着按了别的键 / 点了鼠标才算 Ctrl；单按一下松开 = Super（GNOME 的「活动」）
      if down {
        if cmdHeld.isEmpty { cmdCommitted = false; cmdUsed = false; cmdDownAt = Date() }
        cmdHeld.insert(k)
      } else {
        cmdHeld.remove(k)
        if cmdHeld.isEmpty {
          if cmdCommitted { sendKey(RdpKeys.ctrl, false) }
          else if !cmdUsed && Date().timeIntervalSince(cmdDownAt) < 0.6 { sendKey(RdpKeys.superL, true); sendKey(RdpKeys.superL, false) }
          cmdCommitted = false
        }
      }
      return
    }
    if down != pressed.contains(sc) { sendKey(sc, down) }
  }
  // 别的键 / 鼠标按下之前：按着的 ⌘ 当 Ctrl 发出去
  private func beforeInput() {
    guard cmdAsCtrl, !cmdHeld.isEmpty else { return }
    cmdUsed = true
    if !cmdCommitted { cmdCommitted = true; sendKey(RdpKeys.ctrl, true) }
  }
  // 松开所有按着的（失去焦点、切走标签页、窗口不在前面）：远端不会以为键一直按着
  private func releaseAll() {
    for sc in pressed { session?.send(String(format: "k 0 %x", sc)) }
    pressed.removeAll()
    cmdHeld.removeAll(); cmdCommitted = false
    for b in [RdpView.B1, RdpView.B2, RdpView.B3] where buttons & b != 0 { session?.send("m \(b) \(lastPos.x) \(lastPos.y)") }
    buttons = 0
    for b: UInt16 in [1, 2] where xbuttons & b != 0 { session?.send("x \(b) \(lastPos.x) \(lastPos.y)") }
    xbuttons = 0
  }
  // 锁定键对齐这台 Mac（大写锁定）
  private func syncLocks() {
    let caps = NSEvent.modifierFlags.contains(.capsLock)
    session?.send("s \(caps ? 4 : 0)")
  }
  func sendCombo(_ s: String) {
    let keys = RdpKeys.combo(s)
    guard !keys.isEmpty else { return }
    keys.forEach { session?.send(String(format: "k 1 %x", $0)) }
    keys.reversed().forEach { session?.send(String(format: "k 0 %x", $0)) }
  }

  // ---- 剪贴板（只同步文字）：这台 Mac 上复制的 → 远端（看得见这个标签页、或它有焦点时才告诉远端；别的时候记着，回来再说）；远端复制的 → 这台 Mac ----
  private func startClipboard() {
    pbTimer?.invalidate()
    pbTimer = Timer.scheduledTimer(withTimeInterval: 0.8, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.pollClipboard() } }
    pollClipboard()
  }
  private func pollClipboard() {
    guard clipOn, session?.alive == true else { return }
    let pb = NSPasteboard.general
    guard pb.changeCount != pbCount else { return }
    pbCount = pb.changeCount
    pbPending = true
    if !isHidden || window?.firstResponder === self { flushClipboardIfPending() }
  }
  private func flushClipboardIfPending() {
    guard pbPending, clipOn else { return }
    pbPending = false
    if let s = NSPasteboard.general.string(forType: .string), s.utf8.count < 4 << 20 {
      let crlf = s.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\n", with: "\r\n")
      session?.send("c " + RdpSession.pct(crlf))
    } else { session?.send("C") }
  }
  func remoteClipboard(_ text: String) {
    guard clipOn else { return }
    let pb = NSPasteboard.general
    pb.clearContents()
    pb.setString(text.replacingOccurrences(of: "\r\n", with: "\n"), forType: .string)
    pbCount = pb.changeCount
  }

  override func removeFromSuperview() {
    pbTimer?.invalidate(); pbTimer = nil
    if let m = monitor { NSEvent.removeMonitor(m); monitor = nil }
    super.removeFromSuperview()
  }
}
