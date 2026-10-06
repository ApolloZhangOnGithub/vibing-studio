// WebPanes.swift —— 内嵌的浏览器（Vibing Studio 的「浏览器」标签页）：页面给一块位置，原生在那里叠一个真的 WKWebView。
// 不受 iframe 的限制（哪个网站都能开、http://localhost 调试不算混合内容），Safari 的「开发」菜单能连上它看检查器（isInspectable）。
// 页面管地址栏、前进后退、放在哪；这边把状态（地址、标题、加载中、能不能前进后退、进度、出错）告诉页面（事件 web.state）
import AppKit
import WebKit

@MainActor
final class WebPanes: NSObject, WKNavigationDelegate, WKUIDelegate {
  static let commands = ["web.open", "web.frame", "web.nav", "web.close", "web.snapshot"]
  weak var controller: WebController?
  private var views: [String: WKWebView] = [:]
  private var kvo: [String: [NSKeyValueObservation]] = [:]
  private var errors: [String: String] = [:]

  func run(_ cmd: String, _ a: [String: Any]) throws -> Any? {
    guard let id = a["id"] as? String, !id.isEmpty else { throw BridgeError.args("\(cmd) { id, … }") }
    switch cmd {
    case "web.open":
      // 开一个（有了就复用）；给了地址就去那里
      let v = views[id] ?? make(id)
      if let s = a["url"] as? String, let u = URL(string: s), u.scheme != nil {
        errors[id] = nil
        v.load(URLRequest(url: u))
      }
      return nil
    case "web.frame":
      // 放在页面的哪一块（CSS 像素，相对窗口里的网页）；visible: false 或太小就藏起来
      guard let v = views[id], let host = controller?.webView else { return nil }
      let x = num(a["x"]), y = num(a["y"]), w = max(0, num(a["w"])), h = max(0, num(a["h"]))
      v.frame = NSRect(x: x, y: host.isFlipped ? y : host.bounds.height - y - h, width: w, height: h)
      v.isHidden = !((a["visible"] as? Bool) ?? true) || w < 4 || h < 4
      return nil
    case "web.nav":
      guard let v = views[id] else { return nil }
      switch a["action"] as? String ?? "" {
      case "back": v.goBack()
      case "forward": v.goForward()
      case "reload": errors[id] = nil; v.reload()
      case "stop": v.stopLoading()
      default: throw BridgeError.args("web.nav { id, action: back | forward | reload | stop }")
      }
      return nil
    case "web.close":
      kvo[id] = nil
      errors[id] = nil
      if let v = views.removeValue(forKey: id) { v.stopLoading(); v.removeFromSuperview() }
      return nil
    default:
      return nil
    }
  }

  private func num(_ x: Any?) -> CGFloat { CGFloat((x as? NSNumber)?.doubleValue ?? 0) }

  // 这一页现在的样子（标签页概览用）：{ id, width? } → JPEG 的 data URL；没有这一页返回 null
  func snapshot(_ a: [String: Any]) async throws -> Any? {
    guard let id = a["id"] as? String, let v = views[id] else { return nil }
    let cfg = WKSnapshotConfiguration()
    if let w = (a["width"] as? NSNumber)?.doubleValue, w > 0 { cfg.snapshotWidth = NSNumber(value: w) }
    let img = try await v.takeSnapshot(configuration: cfg)
    guard let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
          let jpg = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.72]) else { return nil }
    return "data:image/jpeg;base64," + jpg.base64EncodedString()
  }

  private func make(_ id: String) -> WKWebView {
    let cfg = WKWebViewConfiguration()
    cfg.websiteDataStore = .default() // 登录状态、Cookie 留着（同 Safari）
    cfg.preferences.isElementFullscreenEnabled = true
    cfg.preferences.javaScriptCanOpenWindowsAutomatically = true
    cfg.mediaTypesRequiringUserActionForPlayback = []
    // 网站按 Safari 待遇：不写「Version/… Safari/…」的 WKWebView 会被当成老古董或不认识的浏览器——Google 给的是十几年前的纯 HTML 版，
    //   有的站（learn.chatgpt.com）干脆一片白。版本号照这台 Mac 上的 Safari（读不到就 26.0）
    let sv = (Bundle(path: "/Applications/Safari.app")?.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "26.0"
    cfg.applicationNameForUserAgent = "Version/\(sv) Safari/605.1.15"
    let v = WKWebView(frame: .zero, configuration: cfg)
    v.isInspectable = true // Safari › 开发 › 这台 Mac › 这一页：检查器
    v.allowsBackForwardNavigationGestures = true
    v.allowsMagnification = true
    v.navigationDelegate = self
    v.uiDelegate = self
    v.isHidden = true
    v.identifier = NSUserInterfaceItemIdentifier(id)
    controller?.webView.addSubview(v)
    views[id] = v
    kvo[id] = [
      v.observe(\.url) { [weak self] _, _ in MainActor.assumeIsolated { self?.send(id) } },
      v.observe(\.title) { [weak self] _, _ in MainActor.assumeIsolated { self?.send(id) } },
      v.observe(\.isLoading) { [weak self] _, _ in MainActor.assumeIsolated { self?.send(id) } },
      v.observe(\.canGoBack) { [weak self] _, _ in MainActor.assumeIsolated { self?.send(id) } },
      v.observe(\.canGoForward) { [weak self] _, _ in MainActor.assumeIsolated { self?.send(id) } },
      v.observe(\.estimatedProgress) { [weak self] _, _ in MainActor.assumeIsolated { self?.send(id) } },
    ]
    return v
  }

  private func send(_ id: String) {
    guard let v = views[id] else { return }
    controller?.emit("web.state", ["id": id, "url": v.url?.absoluteString ?? "", "title": v.title ?? "", "loading": v.isLoading,
                                   "back": v.canGoBack, "forward": v.canGoForward, "progress": v.estimatedProgress, "error": errors[id] ?? ""])
  }
  private func idOf(_ v: WKWebView) -> String? { views.first { $0.value === v }?.key }

  // 新窗口（target=_blank、window.open）：就在这个视图里开
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let u = navigationAction.request.url { webView.load(URLRequest(url: u)) }
    return nil
  }
  // 打不开（连不上 localhost、证书不对……）：告诉页面，页面在那块上写出来
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(webView, error) }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(webView, error) }
  private func failed(_ v: WKWebView, _ error: Error) {
    let e = error as NSError
    if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return }
    guard let id = idOf(v) else { return }
    errors[id] = e.localizedDescription
    send(id)
  }
  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) { if let id = idOf(webView) { errors[id] = nil; send(id) } }
  // 网页里的 alert / confirm：用系统的对话框
  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable () -> Void) {
    let a = NSAlert(); a.messageText = message; a.runModal(); completionHandler()
  }
  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable (Bool) -> Void) {
    let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "好"); a.addButton(withTitle: "取消"); completionHandler(a.runModal() == .alertFirstButtonReturn)
  }
}
