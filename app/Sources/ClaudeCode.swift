// ClaudeCode.swift —— Paimon Terminal 的侧栏兼容 Claude Code（同它自己的 /resume、claude agents）：
//   · 会话：~/.claude/projects/<项目>/<会话 id>.jsonl —— 标题（/rename 起的 > Claude Code 起的 > 第一句话）、最后一句、在哪个目录开的
//     （claude --resume 按目录找会话：续上要回到那个目录。目录以项目名为准——项目名就是那个目录把字母数字以外的字都换成 -）
//   · 在跑的：~/.claude/sessions/<pid>.json —— Claude Code 自己登记的（交互 / 后台、忙 / 闲、名字）；进程还在才算
//   · 后台会话（claude --bg）：~/.claude/jobs/<短 id> —— 用 claude attach <短 id> 打开，不另起一份 --resume
// 会话文件只往后追加、可能很大（几百 MB）：只读两头，之后只读新追加的
import Foundation
import Darwin

final class ClaudeCodeIndex: @unchecked Sendable {
  struct Session {
    var id = "", path = "", project = "", cwd = "", custom = "", ai = "", prompt = "", last = "", model = ""
    var cwdOK = false // cwd 跟项目名对得上
    var turnAt: Double = 0, ctx = 0 // 最后一句人说的话是什么时候（这一问从哪儿算起）；最后一条助手消息时上下文有多少 token
    var mtime: Double = 0, size: Int = 0, offset: Int = 0
  }
  struct Live { var pid: Int32 = 0, kind = "", status = "", name = "", named = false, job = "", cwd = "", started: Double = 0, statusAt: Double = 0 }
  private var cache: [String: Session] = [:]
  private var dirs: [String: String] = [:] // 项目名 → 按名字在磁盘上找到的目录（"" = 找不到）
  private let lock = NSLock()
  let base = NSHomeDirectory() + "/.claude"

  // 最近动过的会话（新的在前），最多 limit 个：没说过话的、只敲了个 / 命令的不要；同一个项目里标题一样的（续过、分叉过）只留最新的
  func sessions(limit: Int) -> [[String: Any]] {
    let fm = FileManager.default, root = base + "/projects"
    var files: [(String, Double, Int)] = []
    for dir in (try? fm.contentsOfDirectory(atPath: root)) ?? [] {
      let d = root + "/" + dir
      for f in (try? fm.contentsOfDirectory(atPath: d)) ?? [] where f.hasSuffix(".jsonl") && !f.hasPrefix("agent-") {
        let p = d + "/" + f
        guard let at = try? fm.attributesOfItem(atPath: p) else { continue }
        files.append((p, (at[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0, (at[.size] as? NSNumber)?.intValue ?? 0))
      }
    }
    files.sort { $0.1 > $1.1 }
    let live = liveSessions(), jobs = Set((try? fm.contentsOfDirectory(atPath: base + "/jobs")) ?? [])
    var out: [[String: Any]] = [], seen = Set<String>()
    for (p, mtime, size) in files where out.count < limit {
      lock.lock()
      var s = cache[p] ?? Session(id: ((p as NSString).lastPathComponent as NSString).deletingPathExtension, path: p,
                                  project: ((p as NSString).deletingLastPathComponent as NSString).lastPathComponent)
      lock.unlock()
      if s.size != size || s.offset == 0 { scan(&s, size: size) }
      s.mtime = mtime
      s.size = size
      lock.lock(); cache[p] = s; lock.unlock()
      let lv = live[s.id]
      let title = !s.custom.isEmpty ? s.custom : lv?.named == true ? lv!.name : !s.ai.isEmpty ? s.ai : s.prompt
      if title.isEmpty { continue } // 开了就退、一句没说的
      if s.custom.isEmpty && lv?.named != true && title.hasPrefix("/") { continue } // 只敲了个 /effort 之类
      if !seen.insert(s.project + "\u{0}" + title).inserted { continue }
      var dir = s.cwdOK ? s.cwd : ""
      if dir.isEmpty, let c = lv?.cwd, Self.sameProject(c, s.project) { dir = c }
      if dir.isEmpty, let r = resolve(s.project) { dir = r }
      if dir.isEmpty { dir = s.cwd.isEmpty ? lv?.cwd ?? "" : s.cwd }
      var isDir: ObjCBool = false
      let there = !dir.isEmpty && fm.fileExists(atPath: dir, isDirectory: &isDir) && isDir.boolValue
      let short = String(s.id.prefix(8))
      let job = lv.map { $0.kind == "bg" ? ($0.job.isEmpty ? short : $0.job) : "" } ?? (jobs.contains(short) ? short : "")
      var o: [String: Any] = ["id": s.id, "path": s.path, "cwd": dir, "missing": !there, "title": title, "custom": !s.custom.isEmpty, "last": s.last, "mtime": mtime * 1000, "size": size, "job": job,
                              "turnAt": s.turnAt, "ctx": s.ctx, "model": s.model]
      if let lv { o["live"] = ["pid": Int(lv.pid), "kind": lv.kind, "status": lv.status, "name": lv.name, "since": lv.started, "statusAt": lv.statusAt] as [String: Any] }
      out.append(o)
    }
    return out
  }

  // 一个会话（按 id 找，不管多久以前的）：同 sessions 里的一项
  func find(_ id: String) -> [String: Any]? {
    guard id.range(of: "^[0-9a-fA-F-]{8,40}$", options: .regularExpression) != nil else { return nil }
    let fm = FileManager.default, root = base + "/projects"
    for dir in (try? fm.contentsOfDirectory(atPath: root)) ?? [] {
      let d = root + "/" + dir
      for f in (try? fm.contentsOfDirectory(atPath: d)) ?? [] where f.hasSuffix(".jsonl") && f.hasPrefix(id) {
        let p = d + "/" + f
        guard let at = try? fm.attributesOfItem(atPath: p) else { continue }
        let mtime = (at[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0, size = (at[.size] as? NSNumber)?.intValue ?? 0
        lock.lock()
        var s = cache[p] ?? Session(id: (f as NSString).deletingPathExtension, path: p, project: dir)
        lock.unlock()
        if s.size != size || s.offset == 0 { scan(&s, size: size) }
        s.mtime = mtime; s.size = size
        lock.lock(); cache[p] = s; lock.unlock()
        let lv = liveSessions()[s.id]
        var cwd = s.cwdOK ? s.cwd : ""
        if cwd.isEmpty, let r = resolve(s.project) { cwd = r }
        if cwd.isEmpty { cwd = s.cwd }
        let title = !s.custom.isEmpty ? s.custom : lv?.named == true ? lv!.name : !s.ai.isEmpty ? s.ai : s.prompt
        var o: [String: Any] = ["id": s.id, "path": p, "cwd": cwd, "title": title.isEmpty ? String(s.id.prefix(8)) : title, "last": s.last, "mtime": mtime * 1000, "size": size,
                                "turnAt": s.turnAt, "ctx": s.ctx, "model": s.model, "job": jobOf(s.id, lv)]
        if let lv { o["live"] = ["pid": Int(lv.pid), "kind": lv.kind, "status": lv.status, "name": lv.name, "since": lv.started, "statusAt": lv.statusAt] as [String: Any] }
        return o
      }
    }
    return nil
  }

  // ---- 搜：最近动过的 files 个会话里找 q（不分大小写），每个会话最多 per 处；给出那一句的前后一段、是谁说的、在文件里的位置（跳过去时从那里读）----
  // 正则里一定会出现的一段纯字（找得到就先按字节在整个文件里找它，再细看那一行）：取最长的一段字母、数字、汉字；
  // 有顶层的 |（几选一）就没有一定会出现的字，返回空（只能一行行看）
  static func literalAnchor(_ re: String) -> String {
    var best = "", cur = "", depthClass = false, esc = false, hasAlt = false
    let chars = Array(re)
    for (i, c) in chars.enumerated() {
      if esc { esc = false; cur = ""; continue }
      if c == "\\" { esc = true; if cur.count > best.count { best = cur }; cur = ""; continue }
      if depthClass { if c == "]" { depthClass = false }; continue }
      if c == "[" { depthClass = true; if cur.count > best.count { best = cur }; cur = ""; continue }
      if c == "|" { hasAlt = true }
      if c.isLetter || c.isNumber || c == "_" || c == "-" || c == " " {
        // 后面跟着 ? * {…}：这个字可有可无，不算
        let next = i + 1 < chars.count ? chars[i + 1] : " "
        if next == "?" || next == "*" || next == "{" { if cur.count > best.count { best = cur }; cur = ""; continue }
        cur.append(c)
      } else { if cur.count > best.count { best = cur }; cur = "" }
    }
    if cur.count > best.count { best = cur }
    return hasAlt ? "" : best.trimmingCharacters(in: .whitespaces)
  }

  // cs：区分大小写；word：全字匹配；re：正则（同 VS Code 搜索框右边那三个）——统一成一个正则去认说的话里的每一处
  func search(_ q: String, files: Int, per: Int, cs: Bool = false, word: Bool = false, re: Bool = false) -> [[String: Any]] {
    let needle = re ? q : q.trimmingCharacters(in: .whitespaces)
    guard needle.count >= 1 else { return [] }
    var pattern = re ? needle : NSRegularExpression.escapedPattern(for: needle)
    if word { pattern = "(?<![\\p{L}\\p{N}_])(?:" + pattern + ")(?![\\p{L}\\p{N}_])" }
    guard let rx = try? NSRegularExpression(pattern: pattern, options: cs ? [] : [.caseInsensitive]) else { return [["error": "正则表达式无效"]] }
    let anchor = re ? Self.literalAnchor(needle) : needle
    let fm = FileManager.default, root = base + "/projects"
    var list: [(String, Double)] = []
    for dir in (try? fm.contentsOfDirectory(atPath: root)) ?? [] {
      let d = root + "/" + dir
      for f in (try? fm.contentsOfDirectory(atPath: d)) ?? [] where f.hasSuffix(".jsonl") && !f.hasPrefix("agent-") {
        let p = d + "/" + f
        list.append((p, ((try? fm.attributesOfItem(atPath: p))?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0))
      }
    }
    list.sort { $0.1 > $1.1 }
    var out: [[String: Any]] = []
    // 先按字节找的那段字（大小写的几种写法；区分大小写就只找它本身）
    let variants: [Data] = anchor.isEmpty ? [] : (cs ? [anchor] : Array(Set([anchor, anchor.lowercased(), anchor.uppercased(), anchor.prefix(1).uppercased() + anchor.dropFirst()]))).map { Data($0.utf8) }
    let t0 = Date()
    for (p, _) in list.prefix(files) {
      if Date().timeIntervalSince(t0) > 4 { break } // 太多了：先给这些
      guard let data = try? Data(contentsOf: URL(fileURLWithPath: p), options: .alwaysMapped) else { continue }
      var hits: [[String: Any]] = [], total = 0, seen = Set<Int>()
      // 整个文件里直接找这几个字（大小写的几种写法），找到了再取它所在的那一行——不逐行扫
      var lines: [Range<Int>] = []
      if variants.isEmpty { // 正则里没有一定会出现的字：一行一行看（慢，4 秒封顶）
        var ls = data.startIndex
        while ls < data.endIndex {
          var le = ls
          while le < data.endIndex && data[le] != 0x0A { le += 1 }
          if le > ls { lines.append(ls..<le) }
          ls = le + 1
          if lines.count > 200_000 || Date().timeIntervalSince(t0) > 4 { break }
        }
      }
      for v in variants {
        var from = data.startIndex
        while from < data.endIndex, let r = data.range(of: v, in: from..<data.endIndex) {
          var ls = r.lowerBound
          while ls > data.startIndex && data[ls - 1] != 0x0A { ls -= 1 }
          var le = r.upperBound
          while le < data.endIndex && data[le] != 0x0A { le += 1 }
          if seen.insert(ls).inserted { lines.append(ls..<le) }
          from = le
          if lines.count > 4000 { break }
        }
      }
      lines.sort { $0.lowerBound < $1.lowerBound }
      for r in lines {
        guard r.count > 20, r.count < 2_000_000 else { continue }
        let lineStart = r.lowerBound
        let chunk = data[r]
        guard let j = try? JSONSerialization.jsonObject(with: Data(chunk)) as? [String: Any], let type = j["type"] as? String, type == "user" || type == "assistant", j["isMeta"] as? Bool != true else { continue }
        // 只在说的话里找（不在工具的输入输出、JSON 的键里）
        var texts: [String] = []
        if let m = j["message"] as? [String: Any] {
          if let s = m["content"] as? String { texts.append(s) }
          if let arr = m["content"] as? [[String: Any]] { for b in arr where (b["type"] as? String) == "text" { if let t = b["text"] as? String { texts.append(t) } } }
        }
        for t in texts {
          let ns = t as NSString
          for m in rx.matches(in: t, range: NSRange(location: 0, length: ns.length)) where m.range.length > 0 {
            total += 1
            if hits.count < per {
              let a = max(0, m.range.location - 40), b = min(ns.length, m.range.location + m.range.length + 60)
              let snippet = ns.substring(with: NSRange(location: a, length: b - a)).replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
              let matched = ns.substring(with: m.range).replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
              hits.append(["role": type, "text": (a > 0 ? "…" : "") + snippet + (b < ns.length ? "…" : ""), "match": matched, "uuid": j["uuid"] as? String ?? "", "offset": lineStart - data.startIndex, "at": j["timestamp"] as? String ?? ""])
            }
          }
        }
      }
      if total > 0 {
        let id = ((p as NSString).lastPathComponent as NSString).deletingPathExtension
        lock.lock(); let s = cache[p]; lock.unlock()
        let title = s.map { !$0.custom.isEmpty ? $0.custom : !$0.ai.isEmpty ? $0.ai : $0.prompt } ?? ""
        out.append(["id": id, "path": p, "title": title.isEmpty ? String(id.prefix(8)) : title, "count": total, "hits": hits, "size": data.count])
      }
    }
    return out
  }

  // 后台会话的 job：登记文件里它自己写的 jobId（同 sessions 列表）——不能只按会话 id 的前 8 位找 ~/.claude/jobs/ 下的目录：
  //   job 里 /clear、换过会话以后会话 id 变了、job 还是原来那个，找不到就被当成「开在别的终端里」，话送不进去
  func jobOf(_ id: String, _ lv: Live?) -> String {
    let short = String(id.prefix(8))
    if let lv, lv.kind == "bg" { return lv.job.isEmpty ? short : lv.job }
    return FileManager.default.fileExists(atPath: base + "/jobs/" + short) ? short : "" // 不是 bg 的登记也给：页面问后台服务这个 job 在不在（多出来的一条 interactive 登记不算数）
  }
  // ---- 在跑的：Claude Code 登记的（~/.claude/sessions/<pid>.json）。备用进程（spare）不算；进程没了、pid 被别的进程重用了的旧登记不算 ----
  func liveSessions() -> [String: Live] {
    var out: [String: Live] = [:]
    let dir = base + "/sessions"
    for f in (try? FileManager.default.contentsOfDirectory(atPath: dir)) ?? [] where f.hasSuffix(".json") {
      guard let d = FileManager.default.contents(atPath: dir + "/" + f), let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
            let pid = (j["pid"] as? NSNumber)?.int32Value, pid > 0, let sid = j["sessionId"] as? String, j["spare"] as? Bool != true else { continue }
      let started = (j["startedAt"] as? NSNumber)?.doubleValue ?? 0
      guard Self.alive(pid, before: started / 1000) else { continue }
      var l = Live()
      l.pid = pid
      l.kind = j["kind"] as? String ?? ""
      l.status = j["status"] as? String ?? ""
      l.name = j["name"] as? String ?? ""
      l.named = (j["nameSource"] as? String) == "user"
      l.job = j["jobId"] as? String ?? ""
      l.cwd = j["cwd"] as? String ?? ""
      l.started = started
      l.statusAt = (j["statusUpdatedAt"] as? NSNumber)?.doubleValue ?? 0 // 忙 / 闲是什么时候变的（「在干活」从这里算起）
      // 同一个会话登记了两次：后台服务里跑着的（bg）优先——多出来的 interactive 那条（接上去看的、刚退出还没清掉的）不能把它盖掉；都一样就要后起来的
      if let old = out[sid], (old.kind == "bg" && l.kind != "bg") || (old.kind == l.kind || l.kind != "bg") && old.started > started { continue }
      out[sid] = l
    }
    return out
  }
  // 进程还在，而且在登记之前就起来了（登记之后才起来的是重用了这个 pid 的别的进程）
  static func alive(_ pid: Int32, before t: Double) -> Bool {
    var info = proc_bsdinfo()
    let size = Int32(MemoryLayout<proc_bsdinfo>.size)
    guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size else { return false }
    return t <= 0 || Double(info.pbi_start_tvsec) <= t + 5
  }

  // ---- 目录 ↔ 项目名：Claude Code 把目录里字母数字以外的字（按 UTF-16）都换成 -（早些的版本留着 _，比的时候也当 -）；太长的名字截断了加别的尾巴，比前面一段 ----
  static func norm(_ s: String) -> String {
    String(String.UnicodeScalarView(s.utf16.map { u -> Unicode.Scalar in
      (u >= 0x30 && u <= 0x39) || (u >= 0x41 && u <= 0x5A) || (u >= 0x61 && u <= 0x7A) ? Unicode.Scalar(UInt8(u)) : "-"
    }))
  }
  static func sameProject(_ dir: String, _ project: String) -> Bool {
    let a = norm(dir), b = norm(project)
    return b.count > 180 ? a.hasPrefix(String(b.prefix(180))) : a == b
  }
  // 会话里记的目录都对不上（老的会话、目录挪过）：照项目名在磁盘上一级一级找（名字里的 - 可能是 /、空格、. 或本来就是 -，走不通就退回来换一个）
  private func resolve(_ project: String) -> String? {
    lock.lock()
    let hit = dirs[project]
    lock.unlock()
    if let hit { return hit.isEmpty ? nil : hit }
    let fm = FileManager.default, target = Self.norm(project)
    var found: String?
    func walk(_ dir: String, _ rest: Substring, _ depth: Int) -> Bool {
      if rest.isEmpty { found = dir; return true }
      guard depth < 32, let items = try? fm.contentsOfDirectory(atPath: dir) else { return false }
      for it in items.sorted(by: { $0.utf16.count > $1.utf16.count }) { // 长的先试：「a-b」这个目录比「a」下面的「b」更可能
        let enc = "-" + Self.norm(it)
        guard rest.hasPrefix(enc) else { continue }
        let next = rest.dropFirst(enc.count)
        guard next.isEmpty || next.hasPrefix("-") else { continue }
        let path = (dir == "/" ? "" : dir) + "/" + it
        var isDir: ObjCBool = false
        guard fm.fileExists(atPath: path, isDirectory: &isDir), isDir.boolValue else { continue }
        if walk(path, next, depth + 1) { return true }
      }
      return false
    }
    _ = target.count <= 180 && walk("/", Substring(target), 0)
    lock.lock(); dirs[project] = found ?? ""; lock.unlock()
    return found
  }

  // ---- 读会话文件：开头 256 KB（目录、第一句话）+ 结尾 1 MB（Claude Code 每一轮都会重写一遍 custom-title / ai-title，最后一句话也在这儿）；
  // 之后文件长了只读新追加的（最多最后 1 MB）。几百 MB 的会话也只读一点点 ----
  private func scan(_ s: inout Session, size: Int) {
    guard let h = FileHandle(forReadingAtPath: s.path) else { return }
    defer { try? h.close() }
    let HEAD = 256 << 10, TAIL = 1 << 20
    if s.offset == 0 || size < s.offset {
      s = Session(id: s.id, path: s.path, project: s.project)
      lines(h, from: 0, to: min(size, HEAD), skipFirst: false, &s)
      if size > HEAD { lines(h, from: max(HEAD, size - TAIL), to: size, skipFirst: true, &s) }
    } else if size > s.offset {
      let from = max(s.offset, size - TAIL)
      lines(h, from: from, to: size, skipFirst: from != s.offset, &s)
    }
    s.offset = size
  }
  // 每行的种类看行首（助手那行的 "type" 在正文后面，可能几百 KB 以后，行首只有 "role"）
  private static let markers: [(Data, String)] = [("\"type\":\"custom-title\"", "custom"), ("\"type\":\"ai-title\"", "ai"), ("\"type\":\"user\"", "user"), ("\"role\":\"assistant\"", "assistant")].map { (Data($0.0.utf8), $0.1) }
  // [from, to) 里完整的行；skipFirst：从一行中间开始的，第一段不要。
  // 标题是短行，按字节取；目录（"cwd"）在每行的末尾（新版）或开头（老版），整行里找最后一个；
  // 用户的第一句话只解析前几条用户行；最后一句从后往前找第一条带文字的助手行（最多看 30 行：干活时最后几条常常只有工具调用）
  private func lines(_ h: FileHandle, from: Int, to: Int, skipFirst: Bool, _ s: inout Session) {
    guard to > from else { return }
    try? h.seek(toOffset: UInt64(from))
    guard let chunk = try? h.read(upToCount: to - from), !chunk.isEmpty else { return }
    var start = chunk.startIndex
    if skipFirst { guard let nl = chunk.firstIndex(of: 0x0A) else { return }; start = nl + 1 }
    var users: [Range<Data.Index>] = [], assistants: [Range<Data.Index>] = [], lastUsers: [Range<Data.Index>] = []
    while start < chunk.endIndex {
      guard let nl = chunk[start...].firstIndex(of: 0x0A) else { break } // 最后半行（还在写）不要
      let r = start..<nl
      start = nl + 1
      guard r.count > 20 else { continue }
      let head = r.lowerBound..<min(r.upperBound, r.lowerBound + 400)
      guard let kind = ClaudeCodeIndex.markers.first(where: { chunk.range(of: $0.0, in: head) != nil })?.1 else { continue }
      switch kind {
      case "custom": if let t = ClaudeCodeIndex.field(chunk, "customTitle", in: r), !t.isEmpty { s.custom = t }
      case "ai": if let t = ClaudeCodeIndex.field(chunk, "aiTitle", in: r), !t.isEmpty { s.ai = t }
      default:
        if !s.cwdOK, let c = ClaudeCodeIndex.field(chunk, "cwd", in: r, last: true), !c.isEmpty {
          if ClaudeCodeIndex.sameProject(c, s.project) { s.cwd = c; s.cwdOK = true } else if s.cwd.isEmpty { s.cwd = c }
        }
        if kind == "user" {
          if s.prompt.isEmpty && users.count < 12 { users.append(r) }
          lastUsers.append(r)
          if lastUsers.count > 60 { lastUsers.removeFirst(20) }
        } else { assistants.append(r) }
      }
    }
    for r in users where s.prompt.isEmpty {
      guard r.count < 400_000, let j = try? JSONSerialization.jsonObject(with: Data(chunk[r])) as? [String: Any] else { continue }
      if j["isMeta"] as? Bool != true, let t = ClaudeCodeIndex.text(j), ClaudeCodeIndex.spoken(t) { s.prompt = ClaudeCodeIndex.oneLine(t, 120) }
    }
    // 这一问从哪儿算起：最后一句人说的话（工具结果、Claude Code 自己塞的不算）的时间
    for r in lastUsers.reversed() {
      guard r.count < 400_000, let j = try? JSONSerialization.jsonObject(with: Data(chunk[r])) as? [String: Any] else { continue }
      guard j["isMeta"] as? Bool != true, let t = ClaudeCodeIndex.text(j), ClaudeCodeIndex.spoken(t), let ts = j["timestamp"] as? String, let at = ClaudeCodeIndex.iso.date(from: ts) else { continue }
      s.turnAt = max(s.turnAt, at.timeIntervalSince1970 * 1000)
      break
    }
    var gotText = false, gotUsage = false
    for r in assistants.reversed().prefix(30) {
      guard !(gotText && gotUsage), r.count < 400_000, let j = try? JSONSerialization.jsonObject(with: Data(chunk[r])) as? [String: Any] else { continue }
      // 上下文：最后一条带 usage 的助手消息（输入 + 缓存读写 + 输出）
      if !gotUsage, let m = j["message"] as? [String: Any], let u = m["usage"] as? [String: Any] {
        let n = ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"].reduce(0) { $0 + ((u[$1] as? NSNumber)?.intValue ?? 0) }
        if n > 0 { s.ctx = n; gotUsage = true }
        if let md = m["model"] as? String, !md.isEmpty, md != "<synthetic>" { s.model = md }
      }
      if !gotText, let t = ClaudeCodeIndex.text(j), !t.isEmpty { s.last = ClaudeCodeIndex.oneLine(t, 160); gotText = true }
    }
  }
  // 人说的话（不是 Claude Code 自己塞进来的：命令的包装 <command-name>、本地命令的输出、打断的提示……）
  static func spoken(_ t: String) -> Bool {
    let x = t.trimmingCharacters(in: .whitespacesAndNewlines)
    return !x.isEmpty && !x.hasPrefix("<") && !x.hasPrefix("Caveat:") && !x.hasPrefix("[Request interrupted")
  }
  // 这段里的 "key":"值"（last：最后一个），解开 JSON 转义
  static func field(_ d: Data, _ key: String, in r: Range<Data.Index>, last: Bool = false) -> String? {
    guard let k = d.range(of: Data(("\"" + key + "\":\"").utf8), options: last ? .backwards : [], in: r) else { return nil }
    var i = k.upperBound, esc = false
    while i < r.upperBound {
      let b = d[i]
      if esc { esc = false } else if b == 0x5C { esc = true } else if b == 0x22 { break }
      i += 1
    }
    guard i < r.upperBound else { return nil }
    return (try? JSONSerialization.jsonObject(with: Data(d[(k.upperBound - 1)...i]), options: .fragmentsAllowed)) as? String
  }

  static let iso: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }()
  // message.content：字符串，或 [{type: text, text}]（只要文字）
  static func text(_ j: [String: Any]) -> String? {
    guard let m = j["message"] as? [String: Any] else { return nil }
    if let s = m["content"] as? String { return s }
    if let a = m["content"] as? [[String: Any]] {
      let t = a.compactMap { ($0["type"] as? String) == "text" ? $0["text"] as? String : nil }.joined(separator: " ")
      return t.isEmpty ? nil : t
    }
    return nil
  }
  static func oneLine(_ s: String, _ n: Int) -> String {
    let t = s.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
    return t.count > n ? String(t.prefix(n)) + "…" : t
  }
}
