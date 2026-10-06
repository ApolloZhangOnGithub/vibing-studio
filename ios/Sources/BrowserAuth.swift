// BrowserAuth.swift —— 登录交给系统浏览器（ASWebAuthenticationSession：用 Safari 里已经登录着的 GitHub，通行密钥也能用），做完回到 App。
// 同 Mac 版（app/Sources/BrowserAuth.swift）：App 生成一段随机的 verifier，只把它的 sha256（challenge）交给站点；站点回调 paimon://auth?code=…，
// App 再带着 code + verifier 在自己的网页里打开 /auth/app 换会话（会话 Cookie 设在 App 自己的存储里）
import UIKit
import AuthenticationServices
import CryptoKit

@MainActor
final class BrowserAuth: NSObject, ASWebAuthenticationPresentationContextProviding {
  private var session: ASWebAuthenticationSession?
  private let anchor: () -> UIWindow?

  init(anchor: @escaping () -> UIWindow?) { self.anchor = anchor }

  nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    MainActor.assumeIsolated { anchor() ?? UIWindow() }
  }

  // origin：站点；next：登好了回到哪一页；done(换会话的网址)
  func start(origin: String, next: String, done: @escaping @MainActor (URL) -> Void) {
    if session != nil { return }
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { return }
    let verifier = Self.b64url(Data(bytes))
    let challenge = Self.b64url(Data(SHA256.hash(data: Data(verifier.utf8))))
    guard let url = URL(string: origin + "/auth/login?app=" + challenge) else { return }
    let s = ASWebAuthenticationSession(url: url, callbackURLScheme: "paimon") { callback, _ in
      let code = callback.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "code" })?.value }
      Task { @MainActor in
        self.session = nil
        let nx = next.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "%2F"
        guard let code, let back = URL(string: origin + "/auth/app?code=" + code + "&verifier=" + verifier + "&next=" + nx) else { return } // 取消了：留在登录页
        done(back)
      }
    }
    s.presentationContextProvider = self
    s.prefersEphemeralWebBrowserSession = false
    session = s
    if !s.start() { session = nil }
  }

  static func b64url(_ d: Data) -> String {
    d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
  }
}
