// Config.swift —— 连哪个站点：默认 code.paimon.beer；本地开发 / 测试用启动参数改（-serviceURL http://localhost:8787 -devLogin YES，见 build.sh）
import Foundation

enum Config {
  static let defaultOrigin = "https://code.paimon.beer"

  static var origin: String {
    let s = (UserDefaults.standard.string(forKey: "serviceURL") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    return s.isEmpty ? defaultOrigin : (s.hasSuffix("/") ? String(s.dropLast()) : s)
  }

  // 本地开发服务器：页面里的测试登录（dev=2，不经 GitHub）；正式站点：直接开终端界面（没登录时站点给登录页）
  //   -startPath：开哪一页（测试用，如 /terminal.html?open=cc:<会话>），默认 /terminal.html
  static var startURL: URL {
    var path = (UserDefaults.standard.string(forKey: "startPath") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if !path.hasPrefix("/") { path = "/terminal.html" }
    if UserDefaults.standard.bool(forKey: "devLogin") {
      let nx = path.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "%2Fterminal.html"
      return URL(string: origin + "/auth/login?dev=2&next=" + nx)!
    }
    return URL(string: origin + path) ?? URL(string: origin + "/terminal.html")!
  }

  static func isSite(_ u: URL) -> Bool {
    guard let o = URL(string: origin) else { return false }
    return u.scheme?.lowercased() == o.scheme?.lowercased() && u.host?.lowercased() == o.host?.lowercased() && (u.port ?? defaultPort(u)) == (o.port ?? defaultPort(o))
  }

  private static func defaultPort(_ u: URL) -> Int { u.scheme?.lowercased() == "http" ? 80 : 443 }

  static var version: String { (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0") + "." + (Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0") }
}
