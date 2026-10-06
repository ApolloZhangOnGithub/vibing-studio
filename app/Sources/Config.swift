// Config.swift —— 打开哪个网址、哪些源能用桥、哪些页面留在 App 里
import Foundation
import WebKit

enum Config {
  static let bundleID = Bundle.main.bundleIdentifier ?? "beer.paimon.desktop"
  // 同一套代码两个 App：Paimon（网页桌面）、Paimon Terminal（PaimonMode = terminal：只有终端，shell 和 agent 的工具跑在这台 Mac 上，见 Local.swift）
  static let terminal = (Bundle.main.object(forInfoDictionaryKey: "PaimonMode") as? String) == "terminal"
  static let appName = terminal ? "Vibing Studio" : "macOS Simulator"
  // 服务端（登录、同步、Paimon、翻译）：默认 code.paimon.beer；自己部署的换成自己的——
  //   defaults write beer.paimon.terminal serviceURL https://example.com，或者编的时候在 Info.plist 里写 VibingServiceURL
  static let service: String = {
    let pick = UserDefaults.standard.string(forKey: "serviceURL") ?? (Bundle.main.object(forInfoDictionaryKey: "VibingServiceURL") as? String) ?? "https://code.paimon.beer"
    return pick.hasSuffix("/") ? String(pick.dropLast()) : pick
  }()
  static let serviceHost = URL(string: service)?.host?.lowercased() ?? "code.paimon.beer"
  static let defaultURL = URL(string: service + (terminal ? "/terminal.html" : "/"))!
  // 桥只给这两个源（线上、本地开发）；换了 --url 也不会把桥交给别的网站
  static let bridgeOrigins = [service, "http://localhost:8787"]

  // 起始网址：启动参数 --url 优先，其次 defaults write beer.paimon.desktop url …，都没有就是线上
  static let startURL: URL = {
    let args = CommandLine.arguments
    if let i = args.firstIndex(of: "--url"), i + 1 < args.count, let u = URL(string: args[i + 1]), u.scheme == "https" || u.scheme == "http" { return u }
    if let s = UserDefaults.standard.string(forKey: "url"), let u = URL(string: s), u.scheme == "https" || u.scheme == "http" { return u }
    return defaultURL
  }()

  static let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
  static let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
  static let debug: Bool = {
    #if DEBUG
    return true
    #else
    return UserDefaults.standard.bool(forKey: "inspectable")
    #endif
  }()

  // WKSecurityOrigin → "https://code.paimon.beer"（默认端口不写）
  static func origin(_ o: WKSecurityOrigin) -> String {
    let def = (o.protocol == "https" && o.port == 443) || (o.protocol == "http" && o.port == 80) || o.port == 0
    return o.protocol + "://" + o.host + (def ? "" : ":\(o.port)")
  }
  static func origin(_ u: URL) -> String? {
    guard let s = u.scheme, let h = u.host else { return nil }
    let def = u.port == nil || (s == "https" && u.port == 443) || (s == "http" && u.port == 80)
    return s + "://" + h + (def ? "" : ":\(u.port!)")
  }
  static func bridgeAllowed(_ o: String) -> Bool { bridgeOrigins.contains(o) }

  // 留在 App 里打开的页面：起始网址那个站、线上站、本机开发。GitHub 登录不在 App 里（交给系统浏览器，见 BrowserAuth），别的主框架跳转交给默认浏览器
  static func inApp(_ u: URL) -> Bool {
    guard let host = u.host?.lowercased(), u.scheme == "https" || u.scheme == "http" else { return false }
    if let o = origin(u), o == origin(startURL) { return true }
    return host == serviceHost || host == "localhost" || host == "127.0.0.1"
  }
}
