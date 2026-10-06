// BrowserAuth.swift —— 登录交给系统浏览器（ASWebAuthenticationSession：用浏览器里已经登录着的 GitHub，通行密钥、Google / Apple 登录都能用），做完回到 App。
// 同 PKCE：App 生成一段随机的 verifier，只把它的 sha256（challenge）交给网站；网站回调 paimon://auth?code=…，
// App 再带着 code + verifier 去换会话——别的 App 就算截到这个回调，没有 verifier 也换不了
import AppKit
import AuthenticationServices
import CryptoKit

@MainActor
final class BrowserAuth: NSObject, ASWebAuthenticationPresentationContextProviding {
  private var session: ASWebAuthenticationSession?
  private weak var window: NSWindow?

  init(window: NSWindow) { self.window = window }

  nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    MainActor.assumeIsolated { window ?? NSApp.keyWindow ?? NSWindow() }
  }

  // origin：站点（如 https://code.paimon.beer）；登录成功 → done(换会话的网址)，在 App 的网页里打开它（会话 Cookie 设在 App 自己的存储里）
  // next：登好了回到哪一页（Paimon Terminal 是 /terminal.html）
  func start(origin: String, next: String = "/", done: @escaping @MainActor (URL) -> Void) {
    if session != nil { return } // 已经开着一个
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { return }
    let verifier = Self.b64url(Data(bytes))
    let challenge = Self.b64url(Data(SHA256.hash(data: Data(verifier.utf8))))
    guard let url = URL(string: origin + "/auth/login?app=" + challenge) else { return }
    let s = ASWebAuthenticationSession(url: url, callbackURLScheme: "paimon") { callback, _ in
      let code = callback.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "code" })?.value }
      Task { @MainActor in
        self.session = nil
        let nx = next.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "/"
        guard let code, let back = URL(string: origin + "/auth/app?code=" + code + "&verifier=" + verifier + "&next=" + nx) else { return } // 取消了：留在登录页
        done(back)
      }
    }
    s.presentationContextProvider = self
    s.prefersEphemeralWebBrowserSession = false // 用浏览器里已有的登录
    session = s
    if !s.start() { session = nil }
  }

  static func b64url(_ d: Data) -> String {
    d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
  }
}
