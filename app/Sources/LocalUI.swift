// LocalUI.swift —— 界面文件从这台 Mac 上读（改了按 ⌘R 就生效，不用部署网站）；账号那些（/api、/auth、WebSocket）照旧走网站。
//   页面还是网站那个源（https://code.paimon.beer）：登录、Cookie、localStorage、原生的桥都不变。做法：
//   1. App 带着 WKWebView 自己存的 Cookie 去网站取一次页面，只为拿网站写进去的那一小段（账号 id：window.TSU_UID …）——
//      没登录（给的是登录页）就照旧直接打开网站，登录流程一点不变；断网就用上次拿到的那一段，照样打开本地界面
//   2. 本地的 terminal.html 插上那一段，里面 <script src>、<link href> 改成 vibing-ui://ui/…（下面的 SchemeHandler 从本地读），
//      交给 WKWebView.loadSimulatedRequest：看上去就是网站给的页面（源不变）
//   界面文件在哪（先有先用）：defaults 里的 uiDir > 编译时记下的仓库 public/（Info.plist 的 VibingUIDir：这台 Mac 上有就用它，改了就生效）> App 里带的一份（Resources/web）
//   关掉：defaults write beer.paimon.terminal localUI -bool NO（就回到从网站加载）
import Foundation
import WebKit

enum LocalUI {
  static let scheme = "vibing-ui"
  static let base = scheme + "://ui/"
  static var secureScheme = false // 登记成安全的协议了（https 的页面里能引用它的脚本）

  // 界面文件所在的目录（里面要有 terminal.html）
  static var dir: URL? {
    let fm = FileManager.default
    var cands: [String] = []
    if let s = UserDefaults.standard.string(forKey: "uiDir"), !s.isEmpty { cands.append((s as NSString).expandingTildeInPath) }
    if let s = ProcessInfo.processInfo.environment["NADOS_UI_DIR"], !s.isEmpty { cands.append(s) }
    if let s = Bundle.main.object(forInfoDictionaryKey: "VibingUIDir") as? String, !s.isEmpty { cands.append(s) }
    if let r = Bundle.main.resourceURL?.appendingPathComponent("web").path { cands.append(r) }
    for c in cands where fm.fileExists(atPath: (c as NSString).appendingPathComponent("terminal.html")) { return URL(fileURLWithPath: c, isDirectory: true).standardizedFileURL }
    return nil
  }

  // 界面来源（设置 › 关于 里能换；defaults 的 uiSource）：auto（默认：本机那份不比网站上的旧才用它）/ site（一直用网站上的）/ local（一直用本机的：开发时）
  static var source: String { let s = UserDefaults.standard.string(forKey: "uiSource") ?? ""; return ["site", "local"].contains(s) ? s : "auto" }
  // 一份界面的构建号：version.json 里的 build（老的只有 version：最后一段就是构建号）；读不到是 0
  static func build(of data: Data?) -> Int {
    guard let data, let j = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return 0 }
    if let b = j["build"] as? Int { return b }
    return Int((j["version"] as? String ?? "").split(separator: ".").last ?? "") ?? 0
  }
  static func localBuild() -> Int { build(of: dir.flatMap { try? Data(contentsOf: $0.appendingPathComponent("version.json")) }) }

  // 只有 App 里带的那一份（别的 Mac 上：没有仓库、没有部署过的本地界面）：联网时用网站上的（总是最新的），断网才用带的这份
  static var bundledOnly: Bool {
    guard let d = dir, let r = Bundle.main.resourceURL?.appendingPathComponent("web") else { return false }
    return d.standardizedFileURL.path == r.standardizedFileURL.path
  }

  // 这一格要不要用本地界面：只给 Vibing Studio；起始网址是线上默认的那个（--url 换了别的就照旧，测试用的本地开发服务器不受影响），
  //   或者 NADOS_LOCAL_UI=1（测试：换了 --url 也用本地界面）；defaults 里 localUI = NO 就关掉
  static func enabled(for start: URL) -> Bool {
    guard Config.terminal, dir != nil else { return false }
    let env = ProcessInfo.processInfo.environment
    if env["NADOS_LOCAL_UI"] == "0" { return false }
    if env["NADOS_LOCAL_UI"] == "1" { return true }
    if UserDefaults.standard.object(forKey: "localUI") != nil && !UserDefaults.standard.bool(forKey: "localUI") { return false }
    return Config.origin(start) == Config.origin(Config.defaultURL)
  }

  // 哪些地址是「界面本身」（要换成本地的那一页）：/terminal.html、/terminal（Vibing Studio 只有这一页）
  static func isPage(_ u: URL) -> Bool { u.path == "/terminal.html" || u.path == "/terminal" }

  // 网站给的页面里那一段（账号 id、有没有真沙盒）：<script>window.TSU_UID = 1; window.TSU_SBX = false;</script>
  static func injection(in html: String) -> String? {
    guard let r = html.range(of: "<script>window.TSU_UID = [^<]*</script>", options: .regularExpression) else { return nil }
    return String(html[r])
  }

  // 本地的页面：插上网站那一段 + 本地界面的记号，站内的 .js / .css 指到 vibing-ui://ui/…（跨源的脚本要带 crossorigin，出错时页面才看得到文件名、行号）
  // inline：WebKit 不让 https 的页面引用 vibing-ui:// 的脚本时（登记成安全协议的 SPI 没了），把脚本、样式直接写进页面里（出错时的文件名靠 sourceURL）
  static func page(injection: String, inline: Bool = false) -> String? {
    guard let d = dir, var html = try? String(contentsOf: d.appendingPathComponent("terminal.html"), encoding: .utf8) else { return nil }
    let info = (try? JSONSerialization.data(withJSONObject: ["dir": d.path, "stamp": stamp()] as [String: Any])).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    html = html.replacingOccurrences(of: "<meta charset=\"utf-8\">", with: "<meta charset=\"utf-8\">\n" + injection + "\n<script>window.TSU_UI_LOCAL = \(info);</script>")
    if inline { return inlined(html, dir: d) }
    let re = try! NSRegularExpression(pattern: "<(script|link)\\b([^>]*?)\\s(src|href)=\"(?![a-z][\\w+.-]*:|//)([\\w./-]+\\.(?:js|css))\"", options: [.caseInsensitive])
    let ns = html as NSString
    var out = "", last = 0
    for m in re.matches(in: html, range: NSRange(location: 0, length: ns.length)) {
      out += ns.substring(with: NSRange(location: last, length: m.range.location - last))
      let tag = ns.substring(with: m.range(at: 1)), mid = ns.substring(with: m.range(at: 2)), attr = ns.substring(with: m.range(at: 3)), path = ns.substring(with: m.range(at: 4))
      out += "<" + tag + mid + " crossorigin=\"anonymous\" " + attr + "=\"" + base + path + "\""
      last = m.range.location + m.range.length
    }
    out += ns.substring(from: last)
    return out
  }

  private static func inlined(_ html: String, dir d: URL) -> String {
    let re = try! NSRegularExpression(pattern: "<script\\b[^>]*\\ssrc=\"(?![a-z][\\w+.-]*:|//)([\\w./-]+\\.js)\"[^>]*>\\s*</script>|<link\\b[^>]*\\shref=\"(?![a-z][\\w+.-]*:|//)([\\w./-]+\\.css)\"[^>]*>", options: [.caseInsensitive])
    let ns = html as NSString
    var out = "", last = 0
    for m in re.matches(in: html, range: NSRange(location: 0, length: ns.length)) {
      out += ns.substring(with: NSRange(location: last, length: m.range.location - last))
      let isJS = m.range(at: 1).location != NSNotFound, path = ns.substring(with: m.range(at: isJS ? 1 : 2))
      let body = (try? String(contentsOf: d.appendingPathComponent(path), encoding: .utf8)) ?? ""
      if isJS { out += "<script>" + body.replacingOccurrences(of: "</script", with: "<\\/script", options: .caseInsensitive) + "\n//# sourceURL=" + base + path + "\n</script>" }
      else { out += "<style>/* " + path + " */\n" + body.replacingOccurrences(of: "</style", with: "<\\/style", options: .caseInsensitive) + "\n</style>" }
      last = m.range.location + m.range.length
    }
    out += ns.substring(from: last)
    return out
  }

  // 界面文件最近一次改动的时间（毫秒）：页面拿它和载入时的比，变了就提示「重新载入以更新」
  static func stamp() -> Double {
    guard let d = dir else { return 0 }
    let fm = FileManager.default
    var t: Double = 0
    func scan(_ u: URL, deep: Bool) {
      guard let items = try? fm.contentsOfDirectory(at: u, includingPropertiesForKeys: [.contentModificationDateKey, .isDirectoryKey], options: [.skipsHiddenFiles]) else { return }
      for it in items {
        let rv = try? it.resourceValues(forKeys: [.contentModificationDateKey, .isDirectoryKey])
        if rv?.isDirectory == true { if deep { scan(it, deep: false) }; continue }
        let ext = it.pathExtension.lowercased()
        guard ["js", "css", "html"].contains(ext), let m = rv?.contentModificationDate else { continue }
        t = max(t, m.timeIntervalSince1970 * 1000)
      }
    }
    scan(d, deep: true) // studio/、sim/ 里的也算（以前只看最上面一层：只改了 studio/*.js 时不提示「重新载入以更新」）
    scan(d.appendingPathComponent("vendor/xterm"), deep: false)
    return t.rounded()
  }

  static func mime(_ ext: String) -> String {
    switch ext.lowercased() {
    case "js", "mjs": return "text/javascript; charset=utf-8"
    case "css": return "text/css; charset=utf-8"
    case "html", "htm": return "text/html; charset=utf-8"
    case "json", "map": return "application/json; charset=utf-8"
    case "svg": return "image/svg+xml"
    case "png": return "image/png"
    case "jpg", "jpeg": return "image/jpeg"
    case "webp": return "image/webp"
    case "gif": return "image/gif"
    case "woff2": return "font/woff2"
    case "woff": return "font/woff"
    case "ttf": return "font/ttf"
    case "wasm": return "application/wasm"
    default: return "application/octet-stream"
    }
  }
}

// vibing-ui://ui/<路径> → 本地界面目录里的那个文件（只读；不许跳出目录）
final class LocalUISchemeHandler: NSObject, WKURLSchemeHandler {
  func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
    guard let url = task.request.url, let d = LocalUI.dir else { return task.didFailWithError(URLError(.fileDoesNotExist)) }
    let rel = url.path.hasPrefix("/") ? String(url.path.dropFirst()) : url.path
    let file = d.appendingPathComponent(rel).standardizedFileURL
    guard file.path.hasPrefix(d.path + "/"), let data = try? Data(contentsOf: file) else {
      let r = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"])!
      task.didReceive(r); task.didReceive(Data("not found".utf8)); task.didFinish()
      return
    }
    // 图片、字体可以缓存（一小时）：以前一律 no-store，派蒙的头像这种每画一次就重新要一遍、一闪一闪；页面、脚本、样式照旧 no-store（改了马上生效）
    let ext = file.pathExtension.lowercased(), cacheable = ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "woff", "woff2", "ttf", "otf"].contains(ext)
    let r = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
      "Content-Type": LocalUI.mime(file.pathExtension), "Content-Length": String(data.count), "Cache-Control": cacheable ? "max-age=3600" : "no-store", "Access-Control-Allow-Origin": "*",
    ])!
    task.didReceive(r)
    task.didReceive(data)
    task.didFinish()
  }
  func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {}
}
