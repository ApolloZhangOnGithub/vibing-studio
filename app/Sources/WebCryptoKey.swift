// WebCryptoKey.swift —— 网页里存起来的密钥（WebCrypto，比如连别的设备用的设备密钥）用的主密钥，由 App 自己给 WebKit
//   （WKNavigationDelegate 的 _webCryptoMasterKeyForWebView:completionHandler:，WebController、WebPanes 里接上）。
//   不给的话 WebKit 自己把它放进登录钥匙串，那一项只认建它的那一版 App：每次更新都弹「想要访问你的钥匙串中的密钥“… WebCrypto 主密钥”」。
//   放在 App 自己的目录里一个只有你能读的文件（0600），一点都不碰钥匙串：
//   WebKit 等这把钥匙时整个页面是停住的——304 先问钥匙串，系统弹「允许」框没人点，整个 App 就卡死了（用户 2026-10-14）。
//   读不到、写不了也马上给一把（这一次在内存里），页面永远不等。WebKit 以前那一把不拿了：网页里存的设备密钥重新生成一把，
//   同一账号的设备默认直接允许，连别的设备不受影响
import Foundation
import Security

@MainActor
enum WebCryptoKey {
  private static var cached: Data?

  static func get(_ done: @escaping (Data?) -> Void) { done(key()) }

  static func key() -> Data {
    if let k = cached { return k }
    let home = ProcessInfo.processInfo.environment["NADOS_HOME"] ?? NSHomeDirectory() // 自动测试：假的家目录
    let dir = home + "/Library/Application Support/Vibing Studio", p = dir + "/webcrypto.key"
    if let d = FileManager.default.contents(atPath: p), d.count == 16 { cached = d; return d }
    var b = [UInt8](repeating: 0, count: 16)
    _ = SecRandomCopyBytes(kSecRandomDefault, 16, &b)
    let k = Data(b)
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    FileManager.default.createFile(atPath: p, contents: k, attributes: [.posixPermissions: 0o600])
    cached = k
    return k
  }
}
