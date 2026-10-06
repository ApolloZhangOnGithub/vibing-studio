// RemoteHost.swift —— 让 iPad（以后也包括别的 Mac）借这台 Mac 用：原生这边连中转（/api/relay/host），收到的调用在这台 Mac 上照原样执行（自己的一份 Local），
//   回复、终端和命令的输出、盯着的会话记录（tail）推回那台设备。另一头是 remote.js，中间是服务端的 src/relay.js。
//   以前这一段在网页里（studio/remote-host.js）：窗口被挡住、最小化、锁屏时网页的计时器被 WebKit 放慢到一秒一次，iPad 上时快时慢；页面一刷新就断一下。
//   放在原生这边：App 开着（窗口关了也算）就一直按时工作；开着时关掉 App Nap。网页那边只剩设置页的开关和设备列表（调这里的 remote.*）
//   安全同以前：只有你自己的账号连得上中转；每台新设备第一次来问一次「允许」（记住；设置里能撤销）；只放行 allow 里的命令
import AppKit
import WebKit
import Security

@MainActor
final class RemoteHost: NSObject {
  static let shared = RemoteHost()
  static let commands = ["remote.state", "remote.set", "remote.revoke", "remote.import", "remote.cfg"]
  private static let allow: Set<String> = ["local.info", "pty.open", "pty.attach", "pty.list", "pty.write", "pty.resize", "pty.pause", "pty.resume", "pty.close", "pty.cwd",
                                           "exec.start", "exec.kill", "proc.start", "proc.write", "proc.close", "proc.kill", "fs.read", "fs.write", "fs.stat", "fs.glob", "fs.list",
                                           "cc.sessions", "cc.find", "cc.search"]
  private static let owns: Set<String> = ["exec.start", "pty.open", "pty.attach", "proc.start"] // 这几条开出来的（终端、命令）：输出只送回开它的那台
  private static let events: Set<String> = ["exec.data", "exec.exit", "proc.data", "proc.exit", "pty.data", "pty.exit"]
  nonisolated private static let tailMax = 600 << 10 // 一次最多推这么多（中转一条消息不能过 1MB；剩下的下一趟接着推）

  private let ud = UserDefaults.standard
  private var localImpl: Local?
  private var local: Local { // 替 iPad 干活的这一份：终端、命令、文件、会话（同窗口里的那份是分开的）
    if let l = localImpl { return l }
    let l = Local()
    l.sink = { [weak self] t, x in self?.event(t, x) }
    localImpl = l
    return l
  }
  private lazy var session = URLSession(configuration: .default, delegate: self, delegateQueue: .main)
  private var task: URLSessionWebSocketTask?
  private var connecting = false
  private(set) var up = false
  private var retry = 0
  private var gen = 0
  private var pingTimer: Timer?
  private var activity: NSObjectProtocol?
  private var owner: [String: String] = [:]
  private var clients: [String: String] = [:]
  private var denied: Set<String> = []
  private var asking: Set<String> = []
  private var locs: [String: String] = [:] // 设备的大致位置（中转按网络给的：城市、地区、国家），问「允许」时写上
  private struct Pending { var code: String; var until: Date; var tries: Int; var name: String }
  private var codes: [String: Pending] = [:] // 点了「允许」、等那台设备输入验证码的（同 Apple 账户登录新设备）
  private var codeWins: [String: NSWindow] = [:]
  private var waiting: [String: [[String: Any]]] = [:]
  private var cfg: [String: Any] = [:] // 这台 Mac 上对话的翻译设置（页面送来的）：iPad 连上时照着用
  private var tails: [String: Tail] = [:]
  private let macName = (Host.current().localizedName ?? "Mac").replacingOccurrences(of: ".local", with: "")
  var changed: (([String: Any]) -> Void)? // 状态变了（连上、断开、有设备来、允许 / 撤销）：告诉各个窗口的设置页

  var isOn: Bool { ud.bool(forKey: "remoteHost.on") }
  var device: String {
    if let s = ud.string(forKey: "remoteHost.device"), !s.isEmpty { return s }
    let s = "mac-" + String(UUID().uuidString.lowercased().replacingOccurrences(of: "-", with: "").prefix(12))
    ud.set(s, forKey: "remoteHost.device")
    return s
  }
  private var approved: [String: [String: Any]] {
    get { (ud.dictionary(forKey: "remoteHost.ok") as? [String: [String: Any]]) ?? [:] }
    set { ud.set(newValue, forKey: "remoteHost.ok") }
  }

  // 测试用：NADOS_REMOTE_HOST=0 这一个进程不当主机（同一个测试 App 开两份时，当 iPad 的那份）；NADOS_REMOTE_AUTOALLOW=1 新设备不问直接允许
  private var disabled: Bool { ProcessInfo.processInfo.environment["NADOS_REMOTE_HOST"] == "0" }
  private var autoAllow: Bool { ProcessInfo.processInfo.environment["NADOS_REMOTE_AUTOALLOW"] == "1" }

  func start() { if isOn && !disabled { connect() } }

  // ---- 设置页（remote-host.js）来调的 ----
  func handle(_ cmd: String, _ a: [String: Any]) -> Any? {
    switch cmd {
    case "remote.state":
      return state()
    case "remote.set":
      set(a["on"] as? Bool ?? false)
      return state()
    case "remote.revoke":
      if let id = a["id"] as? String { var o = approved; o[id] = nil; approved = o; denied.insert(id) }
      notify()
      return state()
    case "remote.import":
      // 网页版主机用过的：设备号、允许过的设备、开没开——第一次交给这边（iPad 记着的是这个设备号；允许过的不用再问）
      if ud.string(forKey: "remoteHost.device") == nil, let dv = a["device"] as? String, !dv.isEmpty { ud.set(dv, forKey: "remoteHost.device") }
      if let o2 = a["ok"] as? [String: [String: Any]] { var o = approved; for (k, v) in o2 where o[k] == nil { o[k] = v }; approved = o }
      if ud.object(forKey: "remoteHost.on") == nil, let on = a["on"] as? Bool { ud.set(on, forKey: "remoteHost.on"); if on { start() } }
      notify()
      return state()
    case "remote.cfg":
      if let c = a["cfg"] as? [String: Any] { cfg = c }
      return nil
    default:
      return nil
    }
  }

  func state() -> [String: Any] {
    ["on": isOn, "up": up, "device": device,
     "clients": clients.map { ["id": $0.key, "name": $0.value] },
     "approved": approved.filter { ($0.value["verified"] as? Bool) == true }.map { ["id": $0.key, "name": $0.value["name"] ?? "", "at": $0.value["at"] ?? 0, "loc": $0.value["loc"] ?? ""] }]
  }
  private func notify() { changed?(state()) }

  private func set(_ on: Bool) {
    ud.set(on, forKey: "remoteHost.on")
    if on { start() } else { disconnect() }
    notify()
  }

  // ---- 连中转 ----
  private var base: String { Config.origin(Config.startURL) ?? Config.service }

  private func connect() {
    guard isOn, !disabled, task == nil, !connecting else { return }
    connecting = true
    let g = gen
    // 用页面登录用的那份 Cookie（WKWebView 自己存的）：中转只认你的账号
    WKWebsiteDataStore.default().httpCookieStore.getAllCookies { [weak self] cookies in
      MainActor.assumeIsolated {
        guard let self else { return }
        self.connecting = false
        guard g == self.gen, self.isOn, self.task == nil, var comps = URLComponents(string: self.base) else { return }
        let host = comps.host ?? ""
        comps.scheme = comps.scheme == "https" ? "wss" : "ws"
        comps.path = "/api/relay/host"
        comps.queryItems = [URLQueryItem(name: "device", value: self.device), URLQueryItem(name: "name", value: self.macName)]
        guard let url = comps.url else { return }
        var req = URLRequest(url: url)
        let mine = cookies.filter { c in let d = c.domain.hasPrefix(".") ? String(c.domain.dropFirst()) : c.domain; return host == d || host.hasSuffix("." + d) }
        if !mine.isEmpty { req.setValue(mine.map { "\($0.name)=\($0.value)" }.joined(separator: "; "), forHTTPHeaderField: "Cookie") }
        req.setValue(self.base, forHTTPHeaderField: "Origin")
        let t = self.session.webSocketTask(with: req)
        t.maximumMessageSize = 16 << 20
        self.task = t
        t.resume()
        self.receive(t)
      }
    }
  }

  private func disconnect() {
    gen += 1
    retry = 0
    if let t = task { task = nil; t.cancel(with: .normalClosure, reason: nil) }
    closedCleanup()
  }

  private func closedCleanup() {
    up = false
    clients = [:]
    tails.values.forEach { $0.stop() }
    tails = [:]
    pingTimer?.invalidate()
    pingTimer = nil
    if let a = activity { ProcessInfo.processInfo.endActivity(a); activity = nil }
  }

  fileprivate func opened(_ t: URLSessionWebSocketTask) {
    guard t === task else { return }
    up = true
    retry = 0
    // App Nap：你在用 iPad 时这台 Mac 的窗口常是挡住、最小化、锁屏的——系统会把 App 放慢；开着「iPad 使用这台 Mac」时不让它睡
    if activity == nil { activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiatedAllowingIdleSystemSleep], reason: "iPad 使用这台 Mac") }
    pingTimer?.invalidate()
    pingTimer = Timer.scheduledTimer(withTimeInterval: 25, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.sendJSON(["sys": "ping"]) } } // 中转不把空闲的连接断掉
    notify()
  }

  fileprivate func closed(_ t: URLSessionWebSocketTask, code: Int = 0) {
    guard t === task else { return }
    task = nil
    closedCleanup()
    notify()
    if code == 4000 { return } // 中转说同一个设备号有了新的连接：不抢
    guard isOn, !disabled else { return }
    retry = min(retry + 1, 6)
    let g = gen
    DispatchQueue.main.asyncAfter(deadline: .now() + .seconds(1 << (retry - 1))) { [weak self] in MainActor.assumeIsolated { if let self, g == self.gen { self.connect() } } }
  }

  private func receive(_ t: URLSessionWebSocketTask) {
    t.receive { [weak self] r in
      MainActor.assumeIsolated {
        guard let self, self.task === t else { return }
        switch r {
        case .failure:
          self.closed(t)
        case .success(let m):
          var s: String?
          switch m {
          case .string(let x): s = x
          case .data(let d): s = String(data: d, encoding: .utf8)
          @unknown default: s = nil
          }
          if let s, let d = s.data(using: .utf8), let j = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] { self.message(j) }
          self.receive(t)
        }
      }
    }
  }

  // ---- 中转送来的 ----
  private func message(_ m: [String: Any]) {
    if let sys = m["sys"] as? String {
      let from = m["from"] as? String ?? ""
      if sys == "client-join" {
        clients[from] = (m["cname"] as? String) ?? "iPad"
        if let l = m["loc"] as? String, !l.isEmpty { locs[from] = l }
        notify()
        if let p = codes[from], p.until > Date() { authState(from, "code") } else if asking.contains(from) { authState(from, "asking") } // 那边刷新了页面：接着等它
      }
      else if sys == "client-leave" {
        clients[from] = nil
        owner = owner.filter { $0.value != from }
        tails.filter { $0.value.from == from }.forEach { $0.value.stop(); tails[$0.key] = nil }
        notify()
      }
      return
    }
    guard let cmd = m["cmd"] as? String, let from = m["from"] as? String else { return }
    if let cn = m["cname"] as? String, !cn.isEmpty { clients[from] = cn } else if clients[from] == nil { clients[from] = "iPad" }
    if let l = m["loc"] as? String, !l.isEmpty { locs[from] = l }
    if cmd == "auth.code" { return verifyCode(from, m) }
    if cmd == "auth.retry" { // 被拒绝过、想再请求一次
      denied.remove(from)
      if (approved[from]?["verified"] as? Bool) != true && !asking.contains(from) && codes[from] == nil { ask(from, clients[from] ?? "iPad") }
      return reply(from, m["id"], true, NSNull())
    }
    gate(m)
  }

  // 新设备（同 Apple 账户登录新设备）：这台 Mac 上先问「允许」（写着是哪台设备、大致在哪），允许了显示一个 6 位验证码，
  //   在那台设备上输入对了才放行。等待期间它发来的调用先排着，放行后一起处理；那边一直知道现在在等什么（sys: auth）
  private func gate(_ m: [String: Any]) {
    let cid = m["from"] as? String ?? "", nm = (m["cname"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "iPad"
    // 只认输过验证码的（verified）：以前只点了「允许」就放行的设备，换成这一版以后要再验证一次
    if var e = approved[cid], (e["verified"] as? Bool) == true {
      if (e["name"] as? String) != nm { e["name"] = nm; var o = approved; o[cid] = e; approved = o; notify() }
      return run(m)
    }
    if denied.contains(cid) { authState(cid, "denied"); return reply(cid, m["id"], false, err("E_DENIED", "这台 Mac 未授权此设备")) }
    waiting[cid, default: []].append(m)
    if let p = codes[cid], p.until > Date() { return authState(cid, "code") }
    if asking.contains(cid) { return authState(cid, "asking") }
    ask(cid, nm)
  }

  private func authState(_ cid: String, _ st: String) { sendJSON(["to": cid, "sys": "auth", "state": st, "host": macName]) }

  private func ask(_ cid: String, _ nm: String) {
    asking.insert(cid)
    authState(cid, "asking")
    if autoAllow { asking.remove(cid); return approve(cid, nm) }
    DispatchQueue.main.async {
      MainActor.assumeIsolated {
        NSApp.activate()
        let al = NSAlert()
        al.messageText = "「\(nm)」正在请求使用这台 Mac"
        al.icon = NSImage(systemSymbolName: "lock.shield", accessibilityDescription: nil) ?? al.icon
        let loc = self.locs[cid].map { "位置：\($0)（按网络估计的大致位置）\n\n" } ?? ""
        al.informativeText = loc + "允许后，这台 Mac 上会显示一个 6 位验证码。在「\(nm)」上输入它，那台设备就能在这台 Mac 上打开终端、读写文件，并查看和继续 Claude Code / Codex 的会话。可随时在「设置 › 通用」中撤销。"
        al.addButton(withTitle: "允许")
        al.addButton(withTitle: "不允许")
        if al.runModal() == .alertFirstButtonReturn { self.showCode(cid, nm) } else { self.deny(cid) }
      }
    }
  }

  private func showCode(_ cid: String, _ nm: String) {
    asking.remove(cid)
    var b = [UInt8](repeating: 0, count: 4)
    _ = SecRandomCopyBytes(kSecRandomDefault, b.count, &b)
    let n = (UInt32(b[0]) << 24 | UInt32(b[1]) << 16 | UInt32(b[2]) << 8 | UInt32(b[3])) % 1_000_000
    let code = String(format: "%06d", n)
    codes[cid] = Pending(code: code, until: Date().addingTimeInterval(300), tries: 0, name: nm)
    authState(cid, "code")
    // 一个小窗口（不挡这台 Mac 上别的事）：大大的 6 位数字；输对了、过期了、点了「取消」都会自己关
    let w = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 380, height: 200), styleMask: [.titled, .closable], backing: .buffered, defer: false)
    w.title = "Vibing Studio"
    w.isReleasedWhenClosed = false
    w.level = .floating
    let title = NSTextField(labelWithString: "在「\(nm)」上输入这个验证码")
    title.font = .boldSystemFont(ofSize: 14)
    let digits = NSTextField(labelWithString: String(code.prefix(3)) + " " + String(code.suffix(3)))
    digits.font = .monospacedDigitSystemFont(ofSize: 42, weight: .semibold)
    let note = NSTextField(wrappingLabelWithString: "验证码 5 分钟内有效。输入后，「\(nm)」就能使用这台 Mac。")
    note.font = .systemFont(ofSize: 12)
    note.textColor = .secondaryLabelColor
    let cancel = NSButton(title: "取消", target: self, action: #selector(cancelCode(_:)))
    cancel.identifier = NSUserInterfaceItemIdentifier(cid)
    let stack = NSStackView(views: [title, digits, note, cancel])
    stack.orientation = .vertical
    stack.alignment = .centerX
    stack.spacing = 10
    stack.edgeInsets = NSEdgeInsets(top: 18, left: 20, bottom: 16, right: 20)
    w.contentView = stack
    w.center()
    NSApp.activate()
    w.makeKeyAndOrderFront(nil)
    codeWins[cid]?.close()
    codeWins[cid] = w
    DispatchQueue.main.asyncAfter(deadline: .now() + 301) { [weak self] in
      MainActor.assumeIsolated { guard let self, self.codes[cid]?.code == code else { return }; self.codes[cid] = nil; self.closeCode(cid); self.authState(cid, "expired") }
    }
  }

  @objc private func cancelCode(_ sender: NSButton) {
    let cid = sender.identifier?.rawValue ?? ""
    codes[cid] = nil
    closeCode(cid)
    deny(cid)
  }

  private func closeCode(_ cid: String) { codeWins[cid]?.close(); codeWins[cid] = nil }

  private func verifyCode(_ from: String, _ m: [String: Any]) {
    let id = m["id"], typed = (((m["args"] as? [String: Any])?["code"] as? String) ?? "").filter { $0.isNumber }
    if (approved[from]?["verified"] as? Bool) == true { return reply(from, id, true, NSNull()) }
    guard var p = codes[from] else { return reply(from, id, false, err("E_NOCODE", "这台 Mac 还没有给出验证码")) }
    if p.until < Date() { codes[from] = nil; closeCode(from); authState(from, "expired"); return reply(from, id, false, err("E_EXPIRED", "验证码已过期")) }
    if typed == p.code { codes[from] = nil; closeCode(from); approve(from, p.name); return reply(from, id, true, NSNull()) }
    p.tries += 1
    codes[from] = p
    if p.tries >= 5 { codes[from] = nil; closeCode(from); deny(from); return reply(from, id, false, err("E_DENIED", "验证码输错次数太多")) }
    reply(from, id, false, err("E_CODE", "验证码不正确"))
  }

  private func approve(_ cid: String, _ nm: String) {
    var o = approved; o[cid] = ["name": nm, "at": Date().timeIntervalSince1970 * 1000, "verified": true, "loc": locs[cid] ?? ""]; approved = o
    notify()
    authState(cid, "ok")
    let l = waiting[cid] ?? []
    waiting[cid] = nil
    l.forEach { run($0) }
  }

  private func deny(_ cid: String) {
    asking.remove(cid)
    denied.insert(cid)
    let l = waiting[cid] ?? []
    waiting[cid] = nil
    l.forEach { reply(cid, $0["id"], false, err("E_DENIED", "这台 Mac 未授权此设备")) }
    authState(cid, "denied")
  }

  private func run(_ m: [String: Any]) {
    let from = m["from"] as? String ?? "", id = m["id"], cmd = m["cmd"] as? String ?? "", a = m["args"] as? [String: Any] ?? [:]
    switch cmd {
    case "info": // 告诉 iPad 能用哪些命令（菜单、内嵌浏览器这些它自己画网页版的）
      return reply(from, id, true, ["platform": "remote", "app": Config.appName, "version": Config.version, "host": macName, "active": true, "fullscreen": false, "inset": 0,
                                    "commands": Array(RemoteHost.allow).sorted() + ["tail.watch", "tail.unwatch"]] as [String: Any])
    case "agents.cfg":
      return reply(from, id, true, cfg)
    case "tail.watch":
      if let p = a["path"] as? String, !p.isEmpty { tailWatch(from, p, off: (a["offset"] as? NSNumber)?.uint64Value ?? 0) }
      return reply(from, id, true, NSNull())
    case "tail.unwatch":
      if let p = a["path"] as? String { let k = from + "\n" + p; tails[k]?.stop(); tails[k] = nil }
      return reply(from, id, true, NSNull())
    default:
      break
    }
    guard RemoteHost.allow.contains(cmd) else { return reply(from, id, false, err("E_DENIED", "这台 Mac 不允许 iPad 使用「\(cmd)」")) }
    if RemoteHost.owns.contains(cmd), let eid = a["id"] as? String { owner[eid] = from }
    let l = local
    // 读文件（会话记录动辄几 MB）：那边说能解压（z）就压一下再送——文字压完只剩一成多，经中转送到浏览器、iPhone 快得多
    let wantZ = cmd == "fs.read" && ((a["z"] as? Bool) ?? false)
    Task { @MainActor in
      do {
        var v: Any = try await l.runAsync(cmd, a) ?? NSNull()
        if wantZ, let d = v as? [String: Any], let b = d["b64"] as? String, b.count > 65_536, let raw = Data(base64Encoded: b),
           let z = try? (raw as NSData).compressed(using: .zlib) as Data, z.count < raw.count * 9 / 10 {
          v = ["z64": z.base64EncodedString(), "size": raw.count, "enc": "deflate-raw"]
        }
        self.reply(from, id, true, v)
      }
      catch let e as BridgeError { self.reply(from, id, false, self.err(e.code, e.message)) }
      catch { self.reply(from, id, false, self.err("E_FAILED", error.localizedDescription)) }
    }
  }

  private func err(_ code: String, _ message: String) -> [String: Any] { ["code": code, "message": message] }

  // 回复：太大（读一个大文件）的分成 512K 字一块送，iPad 那边按 id 拼回去（同 remote.js）
  private func reply(_ to: String, _ id: Any?, _ ok: Bool, _ v: Any) {
    var body: [String: Any] = ["id": id ?? NSNull(), "ok": ok]
    if ok { body["value"] = v } else { body["error"] = v }
    guard JSONSerialization.isValidJSONObject(body), let d = try? JSONSerialization.data(withJSONObject: body), let s = String(data: d, encoding: .utf8) else {
      return sendJSON(["to": to, "id": id ?? NSNull(), "ok": false, "error": err("E_FAILED", "回复无法编码")])
    }
    if s.utf8.count <= 900_000 { body["to"] = to; return sendJSON(body) }
    var parts: [String] = [], i = s.startIndex
    while i < s.endIndex { let j = s.index(i, offsetBy: 524_288, limitedBy: s.endIndex) ?? s.endIndex; parts.append(String(s[i..<j])); i = j }
    for (k, p) in parts.enumerated() { sendJSON(["to": to, "id": id ?? NSNull(), "part": k, "parts": parts.count, "s": p]) }
  }

  // 终端、命令的输出：是哪台设备开的就送给哪台
  private func event(_ t: String, _ x: [String: Any]) {
    guard RemoteHost.events.contains(t), let eid = x["id"] as? String, let to = owner[eid] else { return }
    sendJSON(["to": to, "ev": t, "detail": x])
    if t.hasSuffix(".exit") { owner[eid] = nil }
  }

  fileprivate func sendJSON(_ o: [String: Any]) {
    guard let t = task, up, JSONSerialization.isValidJSONObject(o), let d = try? JSONSerialization.data(withJSONObject: o), let s = String(data: d, encoding: .utf8) else { return }
    t.send(.string(s)) { _ in }
  }

  // ---- 盯着的会话记录（tail.watch）：本机读很快——每 0.2 秒看一眼长了没有，长了就把新写的整行直接推给那台设备（tail.data）----
  //   iPad 不用自己隔一会儿经中转问一次多大、再来回读一趟（慢，中转一忙就更慢）
  private func tailWatch(_ from: String, _ path: String, off: UInt64) {
    let k = from + "\n" + path
    tails[k]?.stop()
    let t = Tail(from: from, path: path, off: off)
    tails[k] = t
    t.begin()
  }

  final class Tail: @unchecked Sendable {
    let from: String, path: String
    private var off: UInt64 // 只在 q 上改
    private let q = DispatchQueue(label: "vibing.tail", qos: .userInitiated)
    private var timer: DispatchSourceTimer?
    init(from: String, path: String, off: UInt64) { self.from = from; self.path = path; self.off = off }
    func begin() {
      let tm = DispatchSource.makeTimerSource(queue: q)
      tm.schedule(deadline: .now() + .milliseconds(200), repeating: .milliseconds(200), leeway: .milliseconds(20))
      tm.setEventHandler { [weak self] in self?.tick() }
      timer = tm
      tm.resume()
    }
    func stop() { timer?.cancel(); timer = nil }
    private func post(_ detail: [String: Any]) {
      let msg: [String: Any] = ["to": from, "ev": "tail.data", "detail": detail]
      DispatchQueue.main.async { MainActor.assumeIsolated { RemoteHost.shared.sendJSON(msg) } }
    }
    private func tick() {
      guard let at = try? FileManager.default.attributesOfItem(atPath: path), let size = (at[.size] as? NSNumber)?.uint64Value, size != off else { return }
      if size < off { off = size; return post(["path": path, "offset": -1]) } // 变短了（被改写）：那边从头读
      guard let fh = FileHandle(forReadingAtPath: path) else { return }
      defer { try? fh.close() }
      do { try fh.seek(toOffset: off) } catch { return }
      guard let d = try? fh.read(upToCount: Int(min(size - off, UInt64(RemoteHost.tailMax)))), !d.isEmpty else { return }
      let bytes = [UInt8](d)
      guard let nl = bytes.lastIndex(of: 10) else { // 一行比一次能推的还长：这边跳过，那边自己去读（它会发现接不上）
        if bytes.count >= RemoteHost.tailMax { off += UInt64(bytes.count) }
        return
      }
      let chunk = Data(bytes[0...nl]), at0 = off // 只推整行：最后一行还没写完的，下一趟连着推
      off = at0 + UInt64(chunk.count)
      let mtime = ((at[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0) * 1000
      post(["path": path, "offset": NSNumber(value: at0), "b64": chunk.base64EncodedString(), "mtime": mtime])
    }
  }
}

extension RemoteHost: URLSessionWebSocketDelegate {
  nonisolated func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
    MainActor.assumeIsolated { self.opened(webSocketTask) }
  }
  nonisolated func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
    MainActor.assumeIsolated { self.closed(webSocketTask, code: closeCode.rawValue) }
  }
  nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    MainActor.assumeIsolated { if let t = task as? URLSessionWebSocketTask { self.closed(t) } }
  }
}
