// Local.swift —— Paimon Terminal（PaimonMode = terminal）：这台 Mac 本身，不经过服务器的沙盒。
//   · 真终端：伪终端（forkpty）里跑你的登录 shell，在你的家目录；输出成块推给页面（pty.data），页面敲的字写进去
//   · 命令（agent 的 Bash、人的 ! 命令）：zsh -f -c 跑。agent 按档位套 macOS 自带的 Seatbelt——
//       none：只能读写工作目录（启动 agent 的那个目录）；read：哪都能读、只能写工作目录；rw：跟你一样，不限
//     档位不是 rw 时也不能发 Apple Events、不能经 LaunchServices 另起不受限的进程、不能给沙盒外的进程发信号
//   · 文件（agent 的 Read / Write / Edit / Glob）：同样按档位查路径
// 事件：pty.data { id, b64 } · pty.exit { id, code } · exec.data { id, o | e } · exec.exit { id, code, cwd }。id 由页面给（事件不会比回复先到而丢）
import AppKit
import Darwin

@MainActor
final class Local {
  weak var controller: WebController?
  // 事件送到哪：没设就给这个窗口的页面；替 iPad 干活的那一份（RemoteHost.swift）设成送回中转
  var sink: ((String, [String: Any]) -> Void)?
  private func out(_ type: String, _ detail: [String: Any]) { if let sink { sink(type, detail) } else { controller?.emit(type, detail) } }
  let home = NSHomeDirectory()
  let user = NSUserName()
  let shell: String
  let binDir: String
  let tmp: String
  private(set) var loginPath = Local.withCommonDirs("/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")
  private var ptys: [String: PTY] = [:]
  private var jobs: [String: Job] = [:]
  private var procs: [String: Proc] = [:] // 长着跑、要往 stdin 里写的程序（Studio 驱动 Claude Code：claude -p --input-format stream-json …）
  private var pending: [String: Data] = [:] // 伪终端的输出：攒一小会儿（8ms）一起推，大段输出时不至于每块都调一次页面
  private var screens: [String: Screen] = [:] // 每个伪终端最近的输出 + 打开着的终端模式：页面刷新后接回来（pty.attach）

  static let commands = ["local.info", "pty.open", "pty.attach", "pty.list", "pty.gc", "pty.write", "pty.resize", "pty.pause", "pty.resume", "pty.close", "pty.cwd",
                         "exec.start", "exec.kill", "proc.start", "proc.write", "proc.close", "proc.kill", "fs.read", "fs.write", "fs.stat", "fs.glob", "fs.list", "cc.sessions", "cc.find", "cc.search"]
  let cc = ClaudeCodeIndex() // 侧栏的 Claude Code 会话（ClaudeCode.swift）

  // 慢的（扫 Claude Code 的会话文件）放到后台线程；别的照旧
  func runAsync(_ cmd: String, _ a: [String: Any]) async throws -> Any? {
    if cmd == "cc.sessions" {
      let limit = int(a["limit"], 40), idx = cc
      return await withCheckedContinuation { (k: CheckedContinuation<Any?, Never>) in DispatchQueue.global(qos: .utility).async { k.resume(returning: idx.sessions(limit: limit)) } }
    }
    if cmd == "cc.find" {
      let id = (a["id"] as? String) ?? "", idx = cc
      return await withCheckedContinuation { (k: CheckedContinuation<Any?, Never>) in DispatchQueue.global(qos: .utility).async { k.resume(returning: idx.find(id)) } }
    }
    if cmd == "cc.search" {
      let q = (a["q"] as? String) ?? "", limit = int(a["limit"], 60), per = int(a["per"], 30), idx = cc
      let cs = a["cs"] as? Bool ?? false, word = a["word"] as? Bool ?? false, re = a["re"] as? Bool ?? false
      return await withCheckedContinuation { (k: CheckedContinuation<Any?, Never>) in DispatchQueue.global(qos: .userInitiated).async { k.resume(returning: idx.search(q, files: limit, per: per, cs: cs, word: word, re: re)) } }
    }
    return try run(cmd, a)
  }

  init() {
    var sh = "/bin/zsh"
    if let pw = getpwuid(getuid()), let s = pw.pointee.pw_shell { let v = String(cString: s); if !v.isEmpty { sh = v } }
    shell = sh
    binDir = (Bundle.main.resourcePath ?? "") + "/bin"
    tmp = Local.real(NSTemporaryDirectory())
    // 你的登录 shell 里的 PATH（Homebrew、nvm……）：agent 的命令用它（zsh -f 不读你的配置文件）
    let sh0 = sh
    DispatchQueue.global().async {
      let p = Process()
      p.executableURL = URL(fileURLWithPath: sh0)
      p.arguments = ["-l", "-c", "printf '\\036%s' \"$PATH\""]
      let out = Pipe()
      p.standardOutput = out
      p.standardError = FileHandle.nullDevice
      p.standardInput = FileHandle.nullDevice
      guard (try? p.run()) != nil else { return }
      let killer = DispatchWorkItem { if p.isRunning { p.terminate() } }
      DispatchQueue.global().asyncAfter(deadline: .now() + 6, execute: killer)
      let d = out.fileHandleForReading.readDataToEndOfFile()
      p.waitUntilExit()
      killer.cancel()
      if let s = String(data: d, encoding: .utf8), let r = s.range(of: "\u{1e}", options: .backwards) {
        let path = String(s[r.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
        if path.contains("/") { let full = Local.withCommonDirs(path); DispatchQueue.main.async { MainActor.assumeIsolated { self.loginPath = full } } }
      }
    }
  }

  func run(_ cmd: String, _ a: [String: Any]) throws -> Any? {
    switch cmd {
    case "local.info":
      let v = ProcessInfo.processInfo.operatingSystemVersion
      return ["home": home, "user": user, "shell": shell, "tmp": tmp, "host": Host.current().localizedName ?? "Mac",
              "os": "macOS \(v.majorVersion).\(v.minorVersion)" + (v.patchVersion > 0 ? ".\(v.patchVersion)" : ""),
              "caps": ["pty.argv"], "path": loginPath] as [String: Any] // caps：页面按它判断这一版原生能做什么（pty.argv：终端里直接跑一个程序，tmux 用）
    case "pty.open":
      let id = try idArg(a)
      let cwd = dirOr(a["cwd"] as? String, home)
      var env = ProcessInfo.processInfo.environment
      for k in env.keys where k.hasPrefix("__CF") || k.hasPrefix("XPC_") || k == "PaimonLaunched" { env.removeValue(forKey: k) }
      env["TERM"] = "xterm-256color"
      env["COLORTERM"] = "truecolor"
      env["TERM_PROGRAM"] = "PaimonTerminal"
      env["TERM_PROGRAM_VERSION"] = Config.version
      env["TCB"] = "1" // Terminal-Coding-Browser：程序可以用 OSC 7700 交出元素（任务、状态、设置……），见 Resources/bin/tcb
      env["PATH"] = binDir + ":" + (env["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin") // paimon 命令在这里（登录 shell 的 path_helper 会把系统目录挪前面，这一项还在）
      env["HOME"] = home
      env["USER"] = user
      env["SHELL"] = shell
      if env["LANG"] == nil { env["LANG"] = Local.lang() }
      // argv：直接跑这个程序（tmux 的终端），不跑登录 shell；程序名不带路径的在登录 shell 的 PATH 里找
      var argv: [String]? = nil
      if let v = a["argv"] as? [String], let first = v.first, !first.isEmpty {
        var exe = first
        if !exe.contains("/") { for d in (loginPath + ":" + (env["PATH"] ?? "")).split(separator: ":") where FileManager.default.isExecutableFile(atPath: String(d) + "/" + exe) { exe = String(d) + "/" + exe; break } }
        guard exe.hasPrefix("/") else { throw BridgeError.failed("找不到程序：" + first) }
        argv = [exe] + v.dropFirst()
      }
      let pty = try PTY(shell: shell, argv: argv, cwd: cwd, env: env, cols: int(a["cols"], 80), rows: int(a["rows"], 24),
        onData: { [weak self] d in DispatchQueue.main.async { MainActor.assumeIsolated { self?.queue(id, d) } } },
        onExit: { [weak self] code in DispatchQueue.main.async { MainActor.assumeIsolated { self?.flush(id); self?.ptys[id] = nil; self?.screens[id] = nil; self?.out("pty.exit", ["id": id, "code": Int(code)]) } } })
      ptys[id] = pty
      screens[id] = Screen()
      return ["id": id, "pid": Int(pty.pid)]
    case "pty.attach":
      // 页面刷新了（或换了一版）：接回原来的 shell——把留着的输出写回去，之后照常收 pty.data。shell、Claude Code 都不知道页面换过
      let id = try idArg(a)
      guard let p = ptys[id] else { throw BridgeError.failed("no such terminal") }
      flush(id) // 还没推给页面的先并进去：之后来的 pty.data 都是新的
      p.resume() // 上一个页面叫停了（流控）还没放开就刷新了：接回来的这个页面从头算
      if a["cols"] != nil { p.resize(cols: int(a["cols"], 80), rows: int(a["rows"], 24)) }
      return ["id": id, "pid": Int(p.pid), "b64": (screens[id]?.replay() ?? Data()).base64EncodedString()]
    case "pty.list":
      return ptys.map { ["id": $0.key, "pid": Int($0.value.pid)] as [String: Any] }
    case "pty.gc":
      // 页面恢复完布局后报上它要的：别的（上一个页面开的、这一版页面不认了的）关掉，不留看不见的 shell
      let keep = Set((a["keep"] as? [String]) ?? [])
      var closed: [String] = []
      for (id, p) in ptys where !keep.contains(id) { p.close(); ptys[id] = nil; screens[id] = nil; closed.append(id) }
      return ["closed": closed]
    case "pty.write":
      guard let p = ptys[try idArg(a)] else { throw BridgeError.failed("no such terminal") }
      if let s = a["data"] as? String { p.write(Data(s.utf8)) }
      return nil
    case "pty.resize":
      guard let p = ptys[try idArg(a)] else { throw BridgeError.failed("no such terminal") }
      p.resize(cols: int(a["cols"], 80), rows: int(a["rows"], 24))
      return nil
    case "pty.pause":
      // 流控：页面里 xterm 还没解析完的太多了，先别读——伪终端的缓冲满了，shell 自然停在 write 上（同 Terminal、iTerm）。见 local.js 的 feed
      guard let p = ptys[try idArg(a)] else { throw BridgeError.failed("no such terminal") }
      p.pause()
      return nil
    case "pty.resume":
      guard let p = ptys[try idArg(a)] else { throw BridgeError.failed("no such terminal") }
      p.resume()
      return nil
    case "pty.close":
      let id = try idArg(a)
      ptys[id]?.close()
      ptys[id] = nil
      return nil
    case "pty.cwd":
      // shell 在哪个目录；前台跑着的是什么（claude？）、它在哪个目录——侧栏据此标出哪个标签页在跑 Claude Code
      guard let p = ptys[try idArg(a)] else { return nil }
      var out: [String: Any] = ["cwd": (Local.cwdOf(p.pid) as Any?) ?? NSNull()]
      let fg = tcgetpgrp(p.fd)
      if fg > 0 && fg != p.pid {
        out["fg"] = ["pid": Int(fg), "name": Local.procLabel(fg), "cwd": (Local.cwdOf(fg) as Any?) ?? NSNull()] as [String: Any]
      }
      return out
    case "exec.start":
      let id = try idArg(a)
      guard let cmd = a["cmd"] as? String else { throw BridgeError.args("exec.start { id, cmd, cwd?, access?, workdir? }") }
      let access = (a["access"] as? String) ?? "user"
      let workdir = dirOr(a["workdir"] as? String, home)
      let cwd = dirOr(a["cwd"] as? String, workdir)
      let job = try Job(id: id, cmd: cmd, cwd: cwd, env: execEnv(), profile: access == "none" || access == "read" ? profile(access, workdir, extraArg(a)) : nil, tmp: tmp,
        onOut: { [weak self] o, e in DispatchQueue.main.async { MainActor.assumeIsolated { self?.queueExec(id, o, e) } } },
        onExit: { [weak self] code, dir in DispatchQueue.main.async { MainActor.assumeIsolated { self?.flushExec(id); self?.jobs[id] = nil; self?.out("exec.exit", ["id": id, "code": Int(code), "cwd": (dir as Any?) ?? NSNull()]) } } })
      jobs[id] = job
      return ["id": id]
    case "exec.kill":
      jobs[try idArg(a)]?.kill()
      return nil
    case "proc.start":
      // 一个长着跑的程序（跟你一样的权限）：argv 直接执行（PATH 是你登录 shell 的），stdin 留着给 proc.write；输出推 proc.data { id, o | e }，退出 proc.exit { id, code }
      let id = try idArg(a)
      guard let argv = a["argv"] as? [String], let first = argv.first, !first.isEmpty else { throw BridgeError.args("proc.start { id, argv: [程序, 参数…], cwd?, env? }") }
      var env = execEnv()
      env["TERM"] = "xterm-256color"; env.removeValue(forKey: "NO_COLOR"); env.removeValue(forKey: "PAGER"); env.removeValue(forKey: "GIT_PAGER")
      for (k, v) in (a["env"] as? [String: String]) ?? [:] { env[k] = v }
      let cwd = dirOr(a["cwd"] as? String, home)
      let pr = try Proc(argv: argv, cwd: cwd, env: env,
        onOut: { [weak self] o, e in DispatchQueue.main.async { MainActor.assumeIsolated { self?.out("proc.data", e ? ["id": id, "e": o] : ["id": id, "o": o]) } } },
        onExit: { [weak self] code in DispatchQueue.main.async { MainActor.assumeIsolated { self?.procs[id] = nil; self?.out("proc.exit", ["id": id, "code": Int(code)]) } } })
      procs[id] = pr
      return ["id": id, "pid": Int(pr.pid)]
    case "proc.write":
      guard let pr = procs[try idArg(a)] else { throw BridgeError.failed("no such process") }
      if let s = a["data"] as? String { pr.write(Data(s.utf8)) }
      return nil
    case "proc.close":
      procs[try idArg(a)]?.closeInput()
      return nil
    case "proc.kill":
      procs[try idArg(a)]?.kill()
      return nil
    case "fs.list":
      // 一个目录里的东西（资源管理器）：[{ name, dir, size, mtime }]，文件夹在前、按名字
      let p = try pathArg(a)
      let fm = FileManager.default
      guard let names = try? fm.contentsOfDirectory(atPath: p) else { throw BridgeError.failed("Can't list \(p)") }
      var out: [[String: Any]] = []
      for n in names.prefix(5000) {
        var isDir: ObjCBool = false
        let full = (p as NSString).appendingPathComponent(n)
        guard fm.fileExists(atPath: full, isDirectory: &isDir) else { continue }
        let at = try? fm.attributesOfItem(atPath: full)
        // 访达藏起来的（同访达）：点开头的、带 hidden 标记的（~/Library、/bin、/usr……）、.hidden 里列的
        let rv = try? URL(fileURLWithPath: full).resourceValues(forKeys: [.isHiddenKey, .isPackageKey, .creationDateKey])
        out.append(["name": n, "dir": isDir.boolValue, "size": (at?[.size] as? NSNumber)?.intValue ?? 0, "mtime": ((at?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0) * 1000,
                    "hidden": rv?.isHidden ?? n.hasPrefix("."), "package": rv?.isPackage ?? false])
      }
      out.sort { a, b in
        let da = a["dir"] as? Bool ?? false, db = b["dir"] as? Bool ?? false
        if da != db { return da }
        return ((a["name"] as? String) ?? "").localizedStandardCompare((b["name"] as? String) ?? "") == .orderedAscending
      }
      return out
    case "fs.read":
      let p = try pathArg(a), acc = accessArgs(a)
      guard allowed(p, write: false, acc.access, acc.workdir, extraArg(a)) else { throw BridgeError.permission("Permission denied: \(p) (access: \(acc.access))") }
      let max = int(a["max"], 20_000_000), off = int(a["offset"], 0)
      guard let h = FileHandle(forReadingAtPath: p) else { throw BridgeError.failed(FileManager.default.fileExists(atPath: p) ? "Can't read \(p)" : "No such file: \(p)") }
      defer { try? h.close() }
      if off > 0 { try? h.seek(toOffset: UInt64(off)) } // 从中间读（会话记录很大：只读后面一段、只读新追加的）
      let d = (try? h.read(upToCount: max)) ?? Data()
      return ["b64": d.base64EncodedString(), "size": d.count]
    case "fs.write":
      let p = try pathArg(a), acc = accessArgs(a)
      guard allowed(p, write: true, acc.access, acc.workdir, extraArg(a)) else { throw BridgeError.permission("Permission denied: \(p) (access: \(acc.access))") }
      let d: Data
      if let b = a["b64"] as? String, let x = Data(base64Encoded: b) { d = x } else { d = Data(((a["text"] as? String) ?? "").utf8) }
      try FileManager.default.createDirectory(atPath: (p as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
      try d.write(to: URL(fileURLWithPath: p), options: .atomic)
      return ["bytes": d.count]
    case "fs.stat":
      let p = try pathArg(a)
      guard let at = try? FileManager.default.attributesOfItem(atPath: p) else { return nil }
      let dir = (at[.type] as? FileAttributeType) == .typeDirectory
      return ["type": dir ? "dir" : "file", "size": (at[.size] as? NSNumber)?.intValue ?? 0, "mtime": ((at[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0) * 1000,
              "mode": (at[.posixPermissions] as? NSNumber)?.intValue ?? 0] as [String: Any]
    case "fs.glob":
      guard let pattern = a["pattern"] as? String, !pattern.isEmpty else { throw BridgeError.args("fs.glob { pattern, cwd }") }
      let acc = accessArgs(a), cwd = dirOr(a["cwd"] as? String, acc.workdir)
      let ex = extraArg(a)
      return Local.glob(pattern, cwd: cwd, limit: int(a["limit"], 500)).filter { allowed($0, write: false, acc.access, acc.workdir, ex) }
    default:
      throw BridgeError(code: "E_UNKNOWN_CMD", message: "unknown command \"\(cmd)\"")
    }
  }

  // ---- 命令的输出：同伪终端，攒一小会儿（16ms）一起推——长跑的流（看 Claude Code 的屏幕这种）一秒几十块，每块都调一次页面，页面的主线程就耗在收推送上 ----
  private var execPend: [String: (o: String, e: String)] = [:]
  private func queueExec(_ id: String, _ s: String, _ isErr: Bool) {
    if execPend[id] == nil {
      execPend[id] = (o: "", e: "")
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.016) { MainActor.assumeIsolated { self.flushExec(id) } }
    }
    if isErr { execPend[id]!.e += s } else { execPend[id]!.o += s }
  }
  private func flushExec(_ id: String) {
    guard let p = execPend.removeValue(forKey: id) else { return }
    if !p.o.isEmpty { out("exec.data", ["id": id, "o": p.o]) }
    if !p.e.isEmpty { out("exec.data", ["id": id, "e": p.e]) }
  }
  // ---- 伪终端的输出：攒 8ms 一起推 ----
  private func queue(_ id: String, _ d: Data) {
    if pending[id] == nil {
      pending[id] = d
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.008) { MainActor.assumeIsolated { self.flush(id) } }
    } else { pending[id]!.append(d) }
  }
  private func flush(_ id: String) {
    guard let d = pending.removeValue(forKey: id), !d.isEmpty else { return }
    screens[id]?.add(d)
    out("pty.data", ["id": id, "b64": d.base64EncodedString()])
  }

  // 前台在跑的程序（退出前问一声，同「终端」）：shell 自己不算
  func running() -> [String] {
    ptys.values.compactMap { p in
      let fg = tcgetpgrp(p.fd)
      return fg > 0 && fg != p.pid ? Local.procLabel(fg) : nil
    }
  }
  // 进程叫什么：Claude Code 的原生版可执行文件名是版本号（~/.local/share/claude/versions/2.1.x），按路径认成 claude
  static func procLabel(_ pid: pid_t) -> String {
    var path = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
    if proc_pidpath(pid, &path, UInt32(path.count)) > 0 {
      let s = String(cString: path)
      if s.contains("/claude/versions/") || s.hasSuffix("/claude") { return "claude" }
    }
    var name = [CChar](repeating: 0, count: 256)
    _ = proc_name(pid, &name, UInt32(name.count))
    return String(cString: name)
  }

  // ---- 档位 ----
  // agent 自己的笔记目录（~/.paimon/MemoryData/<id>）等：档位不是 rw 也能写。只认 ~/.paimon 下面的
  private func extraArg(_ a: [String: Any]) -> [String] {
    ((a["extra"] as? [String]) ?? []).map { ($0 as NSString).standardizingPath }.filter { Local.inside($0, home + "/.paimon") && !$0.contains("/../") }
  }
  private func accessArgs(_ a: [String: Any]) -> (access: String, workdir: String) {
    ((a["access"] as? String) ?? "user", dirOr(a["workdir"] as? String, home))
  }
  private static func inside(_ p: String, _ d: String) -> Bool { p == d || p.hasPrefix(d.hasSuffix("/") ? d : d + "/") }
  // 真路径（内核眼里的：/var → /private/var，Seatbelt 按这个比；还不存在的文件看它所在的目录）。
  // 不用 URL.resolvingSymlinksInPath：它反而会把 /private 去掉
  static func real(_ p: String) -> String {
    let s = (p as NSString).standardizingPath
    if let r = realpath(s, nil) { defer { free(r) }; return String(cString: r) }
    let dir = (s as NSString).deletingLastPathComponent, name = (s as NSString).lastPathComponent
    if dir == s || dir.isEmpty { return s }
    return (real(dir) as NSString).appendingPathComponent(name)
  }
  func allowed(_ p: String, write: Bool, _ access: String, _ workdir: String, _ extra: [String] = []) -> Bool {
    if access == "user" || access == "rw" { return true }
    let r = Local.real(p), w = Local.real(workdir)
    let scratch = [w, tmp, "/private/tmp", home + "/.cache", home + "/.npm", home + "/Library/Caches"] + extra
    if write { return scratch.contains { Local.inside(r, $0) } || r == "/dev/null" }
    if access == "read" { return true }
    return scratch.contains { Local.inside(r, $0) } || !(Local.inside(r, "/Users") || Local.inside(r, "/Volumes")) // none：你的文件（/Users、外接盘）只有工作目录能读
  }
  private static let MACH = ["com.apple.system.opendirectoryd.libinfo", "com.apple.system.opendirectoryd.membership", "com.apple.system.DirectoryService.libinfo_v1",
    "com.apple.system.notification_center", "com.apple.system.logger", "com.apple.logd", "com.apple.diagnosticd", "com.apple.analyticsd",
    "com.apple.trustd", "com.apple.trustd.agent", "com.apple.SecurityServer", "com.apple.securityd.xpc",
    "com.apple.cfprefsd.daemon", "com.apple.cfprefsd.agent", "com.apple.dnssd.service", "com.apple.mDNSResponder"]
  // Seatbelt 规则（同 sandbox/drivers/seatbelt.mjs 的写法：后写的规则优先）
  func profile(_ access: String, _ workdir: String, _ extra: [String] = []) -> String {
    let lit = { (s: String) in "\"" + s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\"" }
    let w = Local.real(workdir)
    let writable = [w, tmp, "/private/tmp", home + "/.cache", home + "/.npm", home + "/Library/Caches"] + extra
    var r = ["(version 1)", "(allow default)",
             "(deny mach-lookup)", "(allow mach-lookup " + Local.MACH.map { "(global-name \(lit($0)))" }.joined(separator: " ") + ")",
             "(deny appleevent-send)"]
    if access == "none" {
      var ups: [String] = []
      var d = (w as NSString).deletingLastPathComponent
      while d != "/" && !d.isEmpty { ups.append(d); d = (d as NSString).deletingLastPathComponent }
      r.append("(deny file-read* (subpath \"/Users\") (subpath \"/Volumes\"))")
      r.append("(allow file-read* " + writable.map { "(subpath \(lit($0)))" }.joined(separator: " ") + " (subpath \(lit(binDir))))")
      if !ups.isEmpty { r.append("(allow file-read-metadata " + ups.map { "(literal \(lit($0)))" }.joined(separator: " ") + ")") }
    }
    r.append("(deny file-write* (subpath \"/\"))")
    r.append("(allow file-write* " + writable.map { "(subpath \(lit($0)))" }.joined(separator: " ") +
             " (literal \"/dev/null\") (literal \"/dev/zero\") (literal \"/dev/tty\") (literal \"/dev/dtracehelper\") (regex #\"^/dev/ttys[0-9]+$\"))")
    r.append("(deny signal)")
    r.append("(allow signal (target same-sandbox))")
    return r.joined(separator: "\n")
  }
  private func execEnv() -> [String: String] {
    var env: [String: String] = ["HOME": home, "USER": user, "LOGNAME": user, "SHELL": shell, "PATH": loginPath, "TMPDIR": tmp + "/", "LANG": ProcessInfo.processInfo.environment["LANG"] ?? Local.lang(),
                                 "TERM": "dumb", "NO_COLOR": "1", "PAGER": "cat", "GIT_PAGER": "cat"]
    if let s = ProcessInfo.processInfo.environment["SSH_AUTH_SOCK"] { env["SSH_AUTH_SOCK"] = s }
    return env
  }
  // 常装在登录 shell 的 PATH 之外的几个位置（Claude Code 的原生版在 ~/.local/bin，写在 ~/.zshrc 里——这里读 PATH 用的非交互登录 shell 读不到它）：有就补在后面
  static func withCommonDirs(_ path: String) -> String {
    let home = NSHomeDirectory(), have = Set(path.split(separator: ":").map(String.init))
    let extra = [home + "/.local/bin", home + "/.claude/local", home + "/.npm-global/bin", home + "/.bun/bin", home + "/.cargo/bin", home + "/.volta/bin", "/opt/homebrew/bin", "/usr/local/bin"]
      .filter { !have.contains($0) && FileManager.default.fileExists(atPath: $0) }
    return extra.isEmpty ? path : path + ":" + extra.joined(separator: ":")
  }
  static func lang() -> String {
    let id = Locale.current.identifier.replacingOccurrences(of: "-", with: "_")
    return (id.contains("_") ? id.components(separatedBy: "@")[0] : "en_US") + ".UTF-8"
  }

  // ---- 小工具 ----
  private func idArg(_ a: [String: Any]) throws -> String {
    guard let s = a["id"] as? String, s.range(of: "^[A-Za-z0-9_-]{1,40}$", options: .regularExpression) != nil else { throw BridgeError.args("missing id") }
    return s
  }
  private func pathArg(_ a: [String: Any]) throws -> String {
    guard let s = a["path"] as? String, s.hasPrefix("/") else { throw BridgeError.args("path must be absolute") }
    return (s as NSString).standardizingPath
  }
  private func dirOr(_ s: String?, _ d: String) -> String {
    var isDir: ObjCBool = false
    if let s, s.hasPrefix("/"), FileManager.default.fileExists(atPath: s, isDirectory: &isDir), isDir.boolValue { return s }
    return d
  }
  private func int(_ v: Any?, _ d: Int) -> Int { (v as? Int) ?? (v as? Double).map { Int($0) } ?? d }

  // 进程现在在哪个目录（新标签页、分屏从这里开）
  static func cwdOf(_ pid: pid_t) -> String? {
    var info = proc_vnodepathinfo()
    let n = proc_pidinfo(pid, PROC_PIDVNODEPATHINFO, 0, &info, Int32(MemoryLayout<proc_vnodepathinfo>.size))
    guard n > 0 else { return nil }
    return withUnsafePointer(to: &info.pvi_cdir.vip_path) { p in p.withMemoryRebound(to: CChar.self, capacity: Int(MAXPATHLEN)) { String(cString: $0) } }
  }

  // glob：* ? [..] 在一段里，** 跨目录；.git、node_modules 不进（除非模式里写了）
  static func glob(_ pattern: String, cwd: String, limit: Int) -> [String] {
    let abs = pattern.hasPrefix("/") ? pattern : (cwd as NSString).appendingPathComponent(pattern)
    var parts = abs.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
    var base = "/"
    while let f = parts.first, !f.contains(where: { "*?[".contains($0) }) { base = (base as NSString).appendingPathComponent(f); parts.removeFirst() }
    if parts.isEmpty { return FileManager.default.fileExists(atPath: base) ? [base] : [] }
    base = real(base) // 遍历出来的是真路径（/private/var/…），模式也按真路径拼
    var re = "^" + NSRegularExpression.escapedPattern(for: base == "/" ? "" : base)
    for (i, seg) in parts.enumerated() {
      if seg == "**" { re += i == parts.count - 1 ? "(?:/.*)?" : "(?:/[^/]+)*"; continue }
      re += "/"
      var cls = false
      for ch in seg {
        if cls { re += ch == "]" ? "]" : String(ch); if ch == "]" { cls = false }; continue }
        switch ch {
        case "*": re += "[^/]*"
        case "?": re += "[^/]"
        case "[": re += "["; cls = true
        default: re += NSRegularExpression.escapedPattern(for: String(ch))
        }
      }
    }
    re += "$"
    guard let rx = try? NSRegularExpression(pattern: re) else { return [] }
    let skipGit = !pattern.contains(".git"), skipNM = !pattern.contains("node_modules")
    var out: [(String, Double)] = []
    guard let en = FileManager.default.enumerator(at: URL(fileURLWithPath: base), includingPropertiesForKeys: [.contentModificationDateKey, .isDirectoryKey], options: []) else { return [] }
    var seen = 0
    for case let u as URL in en {
      seen += 1
      if seen > 200_000 { break }
      let name = u.lastPathComponent
      if (skipGit && name == ".git") || (skipNM && name == "node_modules") { en.skipDescendants(); continue }
      let p = u.path
      if rx.firstMatch(in: p, range: NSRange(p.startIndex..., in: p)) != nil {
        out.append((p, (try? u.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate?.timeIntervalSince1970) ?? 0))
        if out.count >= limit * 4 { break }
      }
    }
    return out.sorted { $0.1 > $1.1 }.prefix(limit).map { $0.0 } // 最近改过的在前（同 Claude Code 的 Glob）
  }
}

// ======== 伪终端最近的输出：页面刷新后接回来先写回去 ========
// 只留最后 2 MB（从一行开头起）；另外一直记着程序打开了哪些终端模式（括号粘贴、应用光标键、备用屏幕、鼠标……）——
// 打开它们的那一下可能早就不在留着的这段里了，接回来时补上（不补的话 Claude Code 里粘贴多行会被当成一行行回车）
struct Screen {
  static let cap = 2 << 20
  static let restore = [1, 25, 47, 1047, 1049, 1000, 1002, 1003, 1004, 1005, 1006, 1015, 2004]
  static let defaults: [Int: Bool] = [25: true]
  private var buf = Data(), trimmed = false, carry = Data()
  private var modes: [Int: Bool] = [:], keypad = false

  mutating func add(_ d: Data) {
    buf.append(d)
    if buf.count > Screen.cap + Screen.cap / 4 { buf = Data(buf.suffix(Screen.cap)); trimmed = true }
    Screen.track(carry + d, &modes, &keypad, &carry)
  }
  func replay() -> Data {
    var out = buf
    if trimmed, let nl = out.firstIndex(of: 0x0A) { out = Data(out[(nl + 1)...]) }
    var m: [Int: Bool] = [:], kp = false, c = Data()
    Screen.track(out, &m, &kp, &c)
    var fix = ""
    for k in Screen.restore {
      let want = modes[k] ?? Screen.defaults[k] ?? false, got = m[k] ?? Screen.defaults[k] ?? false
      if want != got { fix += "\u{1b}[?\(k)" + (want ? "h" : "l") }
    }
    if keypad != kp { fix += keypad ? "\u{1b}=" : "\u{1b}>" }
    out.append(Data(fix.utf8))
    return out
  }
  // ESC [ ? Pm h / l（DEC 私有模式）和 ESC = / ESC >（小键盘）；切在两块中间的留到下一块（carry）
  static func track(_ d: Data, _ modes: inout [Int: Bool], _ keypad: inout Bool, _ carry: inout Data) {
    carry = Data()
    var i = d.startIndex
    while i < d.endIndex, let e = d[i...].firstIndex(of: 0x1B) {
      guard e + 2 < d.endIndex else { carry = Data(d[e...]); return }
      let n = d[e + 1]
      if n == 0x3D || n == 0x3E { keypad = n == 0x3D; i = e + 2; continue }
      guard n == 0x5B, d[e + 2] == 0x3F else { i = e + 1; continue }
      var j = e + 3, params: [Int] = [], cur = 0
      while j < d.endIndex, j - e < 64 {
        let b = d[j]
        if b >= 0x30 && b <= 0x39 { cur = min(cur * 10 + Int(b - 0x30), 99999) } else if b == 0x3B { params.append(cur); cur = 0 } else { break }
        j += 1
      }
      if j >= d.endIndex { carry = Data(d[e...]); return }
      params.append(cur)
      if d[j] == 0x68 || d[j] == 0x6C { for p in params { modes[p] = d[j] == 0x68 } }
      i = j + 1
    }
  }
}

// ======== 伪终端 ========
final class PTY: @unchecked Sendable {
  let pid: pid_t
  let fd: Int32
  private var readSrc: DispatchSourceRead?
  private var procSrc: DispatchSourceProcess?
  private let q: DispatchQueue
  private var paused = false // 页面叫停了（流控）：读的 source 挂起着。只在 q 上读写

  init(shell: String, argv: [String]? = nil, cwd: String, env: [String: String], cols: Int, rows: Int, onData: @escaping (Data) -> Void, onExit: @escaping (Int32) -> Void) throws {
    // fork 以后子进程里只做 chdir、execve：要用的 C 字符串都先备好
    let argv0 = "-" + (shell as NSString).lastPathComponent // 登录 shell（同 Terminal、iTerm）
    let cArgs: [UnsafeMutablePointer<CChar>?] = (argv.map { [((($0.first ?? "") as NSString).lastPathComponent)] + $0.dropFirst() } ?? [argv0]).map { strdup($0) } + [nil] // argv：给了就跑它（程序名写短名）
    let cEnv: [UnsafeMutablePointer<CChar>?] = env.map { strdup($0.key + "=" + $0.value) } + [nil]
    let cShell = strdup(argv?.first ?? shell)!, cCwd = strdup(cwd)!
    defer { cArgs.forEach { free($0) }; cEnv.forEach { free($0) }; free(cShell); free(cCwd) }
    var ws = winsize(ws_row: UInt16(clamping: rows), ws_col: UInt16(clamping: cols), ws_xpixel: 0, ws_ypixel: 0)
    var master: Int32 = -1
    let p = forkpty(&master, nil, nil, &ws)
    if p < 0 { throw BridgeError.failed("forkpty: " + String(cString: strerror(errno))) }
    if p == 0 {
      if chdir(cCwd) != 0 { _ = chdir("/") }
      cArgs.withUnsafeBufferPointer { a in cEnv.withUnsafeBufferPointer { e in _ = execve(cShell, a.baseAddress, e.baseAddress) } }
      _exit(127)
    }
    pid = p
    fd = master
    q = DispatchQueue(label: "pty.\(p)")
    _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK)
    let rs = DispatchSource.makeReadSource(fileDescriptor: fd, queue: q)
    let fd0 = fd
    rs.setEventHandler { [weak self] in
      var buf = [UInt8](repeating: 0, count: 65536)
      let n = read(fd0, &buf, buf.count)
      if n > 0 { onData(Data(buf[0..<n])) } else if n == 0 || (errno != EAGAIN && errno != EINTR) { self?.readSrc?.cancel() }
    }
    rs.resume()
    readSrc = rs
    let ps = DispatchSource.makeProcessSource(identifier: p, eventMask: .exit, queue: q)
    ps.setEventHandler { [weak self] in
      var st: Int32 = 0
      _ = waitpid(p, &st, 0)
      onExit((st & 0x7f) == 0 ? (st >> 8) & 0xff : 128 + (st & 0x7f))
      self?.procSrc?.cancel()
    }
    ps.resume()
    procSrc = ps
  }
  func write(_ d: Data) {
    d.withUnsafeBytes { (p: UnsafeRawBufferPointer) in
      guard let base = p.baseAddress else { return }
      var off = 0, tries = 0
      while off < d.count && tries < 2000 {
        let n = Darwin.write(fd, base + off, d.count - off)
        if n > 0 { off += n; continue }
        if errno == EAGAIN || errno == EINTR { tries += 1; usleep(500); continue }
        break
      }
    }
  }
  func resize(cols: Int, rows: Int) {
    var ws = winsize(ws_row: UInt16(clamping: rows), ws_col: UInt16(clamping: cols), ws_xpixel: 0, ws_ypixel: 0)
    _ = ioctl(fd, TIOCSWINSZ, &ws)
  }
  // 流控：挂起 / 恢复读的 source（成对：挂起几次就得恢复几次，所以用 paused 记着，都在 q 上做）
  func pause() { q.async { [self] in if !paused, let rs = readSrc { rs.suspend(); paused = true } } }
  func resume() { q.async { [self] in unpause() } }
  private func unpause() { if paused, let rs = readSrc { rs.resume(); paused = false } } // 在 q 上调
  func close() {
    Darwin.kill(-pid, SIGHUP)
    Darwin.kill(pid, SIGHUP)
    q.sync { unpause() } // 挂起着的 source 不能直接 cancel、放掉（libdispatch 会崩）
    readSrc?.cancel()
    Darwin.close(fd)
  }
  // shell 自己退了（没走 close）时页面还叫停着：同上，先恢复再 cancel（剩下没读的输出不要了——shell 已经没了）
  deinit { if paused { readSrc?.resume(); readSrc?.cancel() } }
}

// ======== 一条命令（非交互）：zsh -f -c；自己一个进程组（中断时整组停）；stdout / stderr 边读边给；退出时报最后在哪个目录 ========
// ======== 长着跑的程序：stdin 能写（一行一行的 JSON 进、出），stdout / stderr 边读边给 ========
final class Proc: @unchecked Sendable {
  let pid: pid_t
  private let inFD: Int32
  private var srcs: [DispatchSourceRead] = []
  private var procSrc: DispatchSourceProcess?
  private let q: DispatchQueue
  private var open = 2, exited: Int32? = nil, inClosed = false
  private let onExit: (Int32) -> Void

  init(argv: [String], cwd: String, env: [String: String], onOut: @escaping (String, Bool) -> Void, onExit: @escaping (Int32) -> Void) throws {
    self.onExit = onExit
    var inP: [Int32] = [0, 0], outP: [Int32] = [0, 0], errP: [Int32] = [0, 0]
    guard pipe(&inP) == 0, pipe(&outP) == 0, pipe(&errP) == 0 else { throw BridgeError.failed("pipe: " + String(cString: strerror(errno))) }
    var fa = posix_spawn_file_actions_t(nil as OpaquePointer?)
    posix_spawn_file_actions_init(&fa)
    defer { posix_spawn_file_actions_destroy(&fa) }
    posix_spawn_file_actions_adddup2(&fa, inP[0], 0)
    posix_spawn_file_actions_adddup2(&fa, outP[1], 1)
    posix_spawn_file_actions_adddup2(&fa, errP[1], 2)
    posix_spawn_file_actions_addchdir_np(&fa, cwd)
    var attr = posix_spawnattr_t(nil as OpaquePointer?)
    posix_spawnattr_init(&attr)
    defer { posix_spawnattr_destroy(&attr) }
    posix_spawnattr_setflags(&attr, Int16(POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_CLOEXEC_DEFAULT))
    posix_spawnattr_setpgroup(&attr, 0)
    // 程序名不带路径：在（登录 shell 的）PATH 里找
    var exe = argv[0]
    if !exe.contains("/") {
      for d in (env["PATH"] ?? "").split(separator: ":") where FileManager.default.isExecutableFile(atPath: String(d) + "/" + exe) { exe = String(d) + "/" + exe; break }
    }
    let cArgs: [UnsafeMutablePointer<CChar>?] = argv.map { strdup($0) } + [nil]
    let cEnv: [UnsafeMutablePointer<CChar>?] = env.map { strdup($0.key + "=" + $0.value) } + [nil]
    defer { cArgs.forEach { free($0) }; cEnv.forEach { free($0) } }
    var p: pid_t = 0
    let rc = cArgs.withUnsafeBufferPointer { a in cEnv.withUnsafeBufferPointer { e in posix_spawn(&p, exe, &fa, &attr, a.baseAddress, e.baseAddress) } }
    Darwin.close(inP[0]); Darwin.close(outP[1]); Darwin.close(errP[1])
    if rc != 0 { Darwin.close(inP[1]); Darwin.close(outP[0]); Darwin.close(errP[0]); throw BridgeError.failed("spawn \(argv[0]): " + String(cString: strerror(rc))) }
    pid = p
    inFD = inP[1]
    q = DispatchQueue(label: "proc.\(p)")
    for (fd, isErr) in [(outP[0], false), (errP[0], true)] {
      _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK)
      let src = DispatchSource.makeReadSource(fileDescriptor: fd, queue: q)
      var rest = Data()
      src.setEventHandler { [weak self] in
        var buf = [UInt8](repeating: 0, count: 65536)
        let n = read(fd, &buf, buf.count)
        if n > 0 {
          rest.append(contentsOf: buf[0..<n])
          let (s, left) = Job.utf8Prefix(rest)
          rest = left
          if !s.isEmpty { onOut(s, isErr) }
        } else if n == 0 || (errno != EAGAIN && errno != EINTR) {
          if !rest.isEmpty { onOut(String(decoding: rest, as: UTF8.self), isErr); rest = Data() }
          src.cancel()
          Darwin.close(fd)
          self?.closed()
        }
      }
      src.resume()
      srcs.append(src)
    }
    let ps = DispatchSource.makeProcessSource(identifier: p, eventMask: .exit, queue: q)
    ps.setEventHandler { [weak self] in
      var st: Int32 = 0
      _ = waitpid(p, &st, 0)
      self?.exited = (st & 0x7f) == 0 ? (st >> 8) & 0xff : 128 + (st & 0x7f)
      self?.procSrc?.cancel()
      self?.finishIfDone()
    }
    ps.resume()
    procSrc = ps
  }
  func write(_ d: Data) {
    guard !inClosed else { return }
    d.withUnsafeBytes { (p: UnsafeRawBufferPointer) in
      guard let base = p.baseAddress else { return }
      var off = 0
      while off < d.count { let n = Darwin.write(inFD, base + off, d.count - off); if n <= 0 { if errno == EINTR { continue }; break }; off += n }
    }
  }
  func closeInput() { if !inClosed { inClosed = true; Darwin.close(inFD) } }
  private func closed() { open -= 1; finishIfDone() }
  private func finishIfDone() { guard open <= 0, let code = exited else { return }; exited = nil; closeInput(); onExit(code) }
  func kill() {
    Darwin.kill(-pid, SIGTERM)
    let p = pid
    DispatchQueue.global().asyncAfter(deadline: .now() + 3) { Darwin.kill(-p, SIGKILL) }
  }
}

final class Job: @unchecked Sendable {
  let pid: pid_t
  private var srcs: [DispatchSourceRead] = []
  private var procSrc: DispatchSourceProcess?
  private let q: DispatchQueue
  private var open = 3, exited: Int32? = nil, dir = Data()
  private let onExit: (Int32, String?) -> Void

  init(id: String, cmd: String, cwd: String, env: [String: String], profile: String?, tmp: String, onOut: @escaping (String, Bool) -> Void, onExit: @escaping (Int32, String?) -> Void) throws {
    self.onExit = onExit
    // 退出时从第 3 号描述符报最后在哪个目录（命令里 cd 过，下一条接着在那里；命令自己 exit 也会报）
    let script = "trap 'builtin print -rn -- \"$PWD\" >&3 2>/dev/null' EXIT\n" + cmd
    var argv = ["/bin/zsh", "-f", "-c", script]
    if let profile { argv = ["/usr/bin/sandbox-exec", "-p", profile] + argv }
    var outFD: [Int32] = [0, 0], errFD: [Int32] = [0, 0], dirFD: [Int32] = [0, 0]
    guard pipe(&outFD) == 0, pipe(&errFD) == 0, pipe(&dirFD) == 0 else { throw BridgeError.failed("pipe: " + String(cString: strerror(errno))) }
    var fa = posix_spawn_file_actions_t(nil as OpaquePointer?)
    posix_spawn_file_actions_init(&fa)
    defer { posix_spawn_file_actions_destroy(&fa) }
    posix_spawn_file_actions_addopen(&fa, 0, "/dev/null", O_RDONLY, 0)
    posix_spawn_file_actions_adddup2(&fa, outFD[1], 1)
    posix_spawn_file_actions_adddup2(&fa, errFD[1], 2)
    posix_spawn_file_actions_adddup2(&fa, dirFD[1], 3)
    posix_spawn_file_actions_addchdir_np(&fa, cwd)
    var attr = posix_spawnattr_t(nil as OpaquePointer?)
    posix_spawnattr_init(&attr)
    defer { posix_spawnattr_destroy(&attr) }
    posix_spawnattr_setflags(&attr, Int16(POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_CLOEXEC_DEFAULT))
    posix_spawnattr_setpgroup(&attr, 0)
    let cArgs: [UnsafeMutablePointer<CChar>?] = argv.map { strdup($0) } + [nil]
    let cEnv: [UnsafeMutablePointer<CChar>?] = env.map { strdup($0.key + "=" + $0.value) } + [nil]
    defer { cArgs.forEach { free($0) }; cEnv.forEach { free($0) } }
    var p: pid_t = 0
    let rc = cArgs.withUnsafeBufferPointer { a in cEnv.withUnsafeBufferPointer { e in posix_spawn(&p, argv[0], &fa, &attr, a.baseAddress, e.baseAddress) } }
    Darwin.close(outFD[1])
    Darwin.close(errFD[1])
    Darwin.close(dirFD[1])
    if rc != 0 { Darwin.close(outFD[0]); Darwin.close(errFD[0]); Darwin.close(dirFD[0]); throw BridgeError.failed("spawn: " + String(cString: strerror(rc))) }
    pid = p
    q = DispatchQueue(label: "job.\(p)")
    let dfd = dirFD[0]
    _ = fcntl(dfd, F_SETFL, fcntl(dfd, F_GETFL) | O_NONBLOCK)
    let ds = DispatchSource.makeReadSource(fileDescriptor: dfd, queue: q)
    ds.setEventHandler { [weak self] in
      var buf = [UInt8](repeating: 0, count: 4096)
      let n = read(dfd, &buf, buf.count)
      if n > 0 { self?.dir.append(contentsOf: buf[0..<n]) } else if n == 0 || (errno != EAGAIN && errno != EINTR) { ds.cancel(); Darwin.close(dfd); self?.closed() }
    }
    ds.resume()
    srcs.append(ds)
    for (fd, isErr) in [(outFD[0], false), (errFD[0], true)] {
      _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK)
      let src = DispatchSource.makeReadSource(fileDescriptor: fd, queue: q)
      var rest = Data()
      src.setEventHandler { [weak self] in
        var buf = [UInt8](repeating: 0, count: 65536)
        let n = read(fd, &buf, buf.count)
        if n > 0 {
          rest.append(contentsOf: buf[0..<n])
          let (s, left) = Job.utf8Prefix(rest)
          rest = left
          if !s.isEmpty { onOut(s, isErr) }
        } else if n == 0 || (errno != EAGAIN && errno != EINTR) {
          if !rest.isEmpty { onOut(String(decoding: rest, as: UTF8.self), isErr); rest = Data() }
          src.cancel()
          Darwin.close(fd)
          self?.closed()
        }
      }
      src.resume()
      srcs.append(src)
    }
    let ps = DispatchSource.makeProcessSource(identifier: p, eventMask: .exit, queue: q)
    ps.setEventHandler { [weak self] in
      var st: Int32 = 0
      _ = waitpid(p, &st, 0)
      self?.exited = (st & 0x7f) == 0 ? (st >> 8) & 0xff : 128 + (st & 0x7f)
      self?.procSrc?.cancel()
      self?.finishIfDone()
    }
    ps.resume()
    procSrc = ps
  }
  private func closed() { open -= 1; finishIfDone() }
  // 进程退了、两根管子都读完了才报结束（输出不丢）
  private func finishIfDone() {
    guard open <= 0, let code = exited else { return }
    exited = nil
    let d = String(decoding: dir, as: UTF8.self)
    onExit(code, d.hasPrefix("/") ? d : nil)
  }
  func kill() {
    Darwin.kill(-pid, SIGTERM)
    let p = pid
    DispatchQueue.global().asyncAfter(deadline: .now() + 2) { Darwin.kill(-p, SIGKILL) }
  }
  static func sq(_ s: String) -> String { "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'" }
  // 最长的合法 UTF-8 前缀；最后半个字留到下一块
  static func utf8Prefix(_ d: Data) -> (String, Data) {
    var end = d.count
    for back in 1...min(3, d.count) {
      let b = d[d.startIndex + d.count - back]
      if b & 0xC0 == 0x80 { continue } // 续字节
      let need = b >= 0xF0 ? 4 : b >= 0xE0 ? 3 : b >= 0xC0 ? 2 : 1
      if need > back { end = d.count - back }
      break
    }
    return (String(decoding: d.prefix(end), as: UTF8.self), Data(d.suffix(from: d.startIndex + end)))
  }
}
