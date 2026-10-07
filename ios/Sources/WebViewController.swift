// WebViewController.swift —— 网页那一层（同 Mac 版的 Vibing Studio，从站点载入 terminal.html）：
//   WebHost：唯一的一个 WKWebView 和它的那些事——登录状态留着（默认的持久存储）；站内留在 App 里；登录（/auth/login）交给系统浏览器（BrowserAuth），
//     做完回到 App；站外的链接交给 Safari；页面叫 App 做的事（webkit.messageHandlers.vsApp）。两种界面共用它：
//   ClassicViewController：Classic 界面——整屏就是这个网页（完整的工作台）；iPad Native 界面见 NativeViews.swift（网页只画当前这段对话）
//   页面上有 window.vsApp = { platform: "ipad", version, lang, shell }：remote.js 据此一打开就连上你的 Mac；shell 是 "classic" 或 "native"
import UIKit
import WebKit
import ObjectiveC
import SafariServices

@MainActor
final class WebHost: NSObject, WKNavigationDelegate, WKUIDelegate, UIScrollViewDelegate, WKScriptMessageHandler {
  let web: WKWebView
  private let ucc = WKUserContentController()
  private(set) var shell: String
  var presenter: () -> UIViewController? = { nil } // 弹提示框、Safari 视图从哪个控制器弹
  var onMessage: ([String: Any]) -> Void = { _ in } // 页面发来的别的消息（会话列表、状态……）交给 AppModel
  var onBoot: (BootState) -> Void = { _ in } // 打开到能用之前的每一步（BootView 照着写）
  var onLogin: (Bool) -> Void = { _ in } // 站点给的是登录页（还没登录）：Native 界面换成登录那一屏
  var onChrome: (UIColor, UIColor?) -> Void = { _, _ in } // 页面外框（标题栏、活动栏）的颜色、编辑区的底色：iPhone 上状态栏那条涂外框的，底部横条那条涂编辑区的（同输入框那一块）
  private(set) var chromeBottom: UIColor?
  var onStatusBar: (Bool) -> Void = { _ in } // 页面说：标签页那一行顶到最上面、绕开灵动岛了——状态栏收起来
  var onFullscreen: (Bool) -> Void = { _ in } // 页面说：全屏只看对话（铺到整屏）/ 退出
  private(set) var chrome: UIColor?
  private(set) var needLogin = false { didSet { if needLogin != oldValue { onLogin(needLogin) } } }
  private(set) var boot = BootState() { didSet { if boot != oldValue { onBoot(boot) } } }
  private var kvo: [NSKeyValueObservation] = []
  private lazy var auth = BrowserAuth(anchor: { [weak self] in self?.web.window })

  init(shell: String) {
    self.shell = shell
    let cfg = WKWebViewConfiguration()
    cfg.websiteDataStore = .default()
    cfg.allowsInlineMediaPlayback = true
    cfg.defaultWebpagePreferences.preferredContentMode = .mobile // 按页面自己的 viewport（设备宽、1 倍、不能缩放）排版；桌面模式会把页面缩着放、能捏着放大
    cfg.userContentController = ucc
    cfg.applicationNameForUserAgent = "VibingStudioiPad/" + Config.version
    web = WKWebView(frame: .zero, configuration: cfg)
    super.init()
    ucc.add(WeakHandler(self), name: "vsApp")
    installScript()
    web.navigationDelegate = self
    web.uiDelegate = self
    if #available(iOS 16.4, *) { web.isInspectable = true } // Mac 上 Safari 的「开发」菜单能看这个页面
    web.allowsBackForwardNavigationGestures = false
    web.allowsLinkPreview = false // 长按链接不弹网页预览
    web.isOpaque = false
    web.backgroundColor = .black
    // 整页不动：不能捏着缩放、不能双击放大、不能整页拖来拖去、到边上不回弹——只有页面里本来就能滚的那几块（对话、侧栏……）自己滚
    let sv = web.scrollView
    sv.isScrollEnabled = false
    sv.bounces = false
    sv.alwaysBounceVertical = false
    sv.alwaysBounceHorizontal = false
    sv.minimumZoomScale = 1
    sv.maximumZoomScale = 1
    sv.contentInsetAdjustmentBehavior = .never // 安全区由页面自己留（viewport-fit=cover + env(safe-area-inset-*)）
    sv.backgroundColor = .black
    sv.delegate = self
    // 载入进度：WebKit 自己报的（不是假的）
    kvo.append(web.observe(\.estimatedProgress, options: [.new]) { [weak self] w, _ in let p = w.estimatedProgress; DispatchQueue.main.async { MainActor.assumeIsolated { self?.boot.progress = p } } })
    kvo.append(web.observe(\.isLoading, options: [.new]) { [weak self] w, _ in let l = w.isLoading; DispatchQueue.main.async { MainActor.assumeIsolated { guard let self else { return }; if l != self.boot.loading { self.boot.loading = l; if !l && self.boot.step == "page" { self.boot.since = Date() } } } } })
  }

  // window.vsApp：lang 是 iPad 的系统语言（网页这边自己拿到的总是 en——「跟随显示语言」的翻译、界面语言都照它）
  private func installScript() {
    ucc.removeAllUserScripts()
    let clean = { (s: String) in s.replacingOccurrences(of: "'", with: "").replacingOccurrences(of: "\\", with: "") }
    // name：这台设备的名字（系统给的；iOS 16 起没有专门的权限时只给「iPhone」「iPad」）；model：精确的型号（「iPhone 15 Pro」，认不出的写型号代码 iPhone16,1）——设备列表里分清是哪一台
    let src = "window.vsApp = { platform: 'ipad', version: '\(clean(Config.version))', lang: '\(clean(Locale.preferredLanguages.first ?? "en"))', shell: '\(clean(shell))', name: '\(clean(UIDevice.current.name))', model: '\(clean(DeviceModel.name))', hw: '\(clean(UIDevice.current.identifierForVendor?.uuidString ?? ""))' };"
    ucc.addUserScript(WKUserScript(source: src, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    // 页面出错（脚本异常、没接住的 Promise、console.error）：交给 App——写在载入那一层上（不再是一块黑），也打到 App 的输出里（Xcode / devicectl --console 看得到）
    let errs = "(function(){var post=function(m){try{webkit.messageHandlers.vsApp.postMessage(m)}catch(e){}};" +
      "window.addEventListener('error',function(e){post({type:'log',level:'error',text:String(e.message||e.error)+' @'+String(e.filename||'').split('/').pop()+':'+e.lineno})});" +
      "window.addEventListener('unhandledrejection',function(e){var r=e.reason;post({type:'log',level:'warn',text:'unhandled: '+String(r&&(r.stack||r.message)||r).slice(0,600)})});" +
      "var ce=console.error;console.error=function(){try{post({type:'log',level:'error',text:Array.prototype.map.call(arguments,function(x){return x&&x.stack?x.stack:String(x)}).join(' ').slice(0,800)})}catch(e){}return ce.apply(console,arguments)};})();"
    ucc.addUserScript(WKUserScript(source: errs, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    // 外框的颜色（换深浅、换配色时跟着变）：交给 App，iPhone 的状态栏、底部横条那两块不再是一片白 / 黑
    let chromeJS = "(function(){var last='';var bgOf=function(e){var c=e?getComputedStyle(e).backgroundColor:'';return !c||/rgba\\(0, 0, 0, 0\\)|transparent/.test(c)?'':c;};function send(){try{var c=bgOf(document.querySelector('#win .bar'))||bgOf(document.querySelector('.st-act'))||bgOf(document.body);" +
      "var b=bgOf(document.querySelector('.tmain'))||bgOf(document.querySelector('.tpane'))||c;var k=c+'|'+b;if(c&&k!==last){last=k;webkit.messageHandlers.vsApp.postMessage({type:'chrome',bg:c,bottom:b});}}catch(x){}}" +
      "new MutationObserver(send).observe(document.documentElement,{attributes:true,attributeFilter:['class','style']});window.addEventListener('load',send);setTimeout(send,800);setInterval(send,4000);})();"
    ucc.addUserScript(WKUserScript(source: chromeJS, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
  }

  // 「rgb(242, 242, 242)」「rgba(19, 19, 19, 1)」→ UIColor
  static func cssColor(_ s: String) -> UIColor? {
    let n = s.components(separatedBy: CharacterSet(charactersIn: "0123456789.").inverted).filter { !$0.isEmpty }.compactMap { Double($0) }
    guard n.count >= 3 else { return nil }
    return UIColor(red: n[0] / 255, green: n[1] / 255, blue: n[2] / 255, alpha: n.count >= 4 ? n[3] : 1)
  }

  func start() { boot = BootState(); if UIDevice.current.userInterfaceIdiom == .phone { hideInputAccessory() }; web.load(URLRequest(url: Config.startURL)) }

  // 用 GitHub 登录：系统的登录页（ASWebAuthenticationSession），登好了回到工作台
  func login() {
    auth.start(origin: Config.origin, next: "/terminal.html") { [weak self] back in
      guard let self else { return }
      self.needLogin = false
      self.boot = BootState()
      self.web.load(URLRequest(url: back))
    }
  }

  // 换界面：页面按新的 shell 重新载入（Classic 是完整的工作台；Native 只画当前这段对话）
  func setShell(_ s: String) {
    guard s != shell else { return }
    shell = s
    installScript()
    boot = BootState()
    web.reload()
  }

  func js(_ code: String) { web.evaluateJavaScript(code, completionHandler: nil) }

  // 键盘上面那一条「⌃ ⌄ 完成」（网页输入框自带的上一项 / 下一项）：iPhone 上本来就挤，去掉（它的那一层换成一个不带这条的子类）
  func hideInputAccessory() {
    guard let content = web.scrollView.subviews.first(where: { String(describing: type(of: $0)).hasPrefix("WKContent") }) else { return }
    let base: AnyClass = type(of: content), name = "VSNoAccessory_" + NSStringFromClass(base)
    var cls: AnyClass? = NSClassFromString(name)
    if cls == nil, let c = objc_allocateClassPair(base, name, 0) {
      let block: @convention(block) (AnyObject) -> AnyObject? = { _ in nil }
      if let m = class_getInstanceMethod(UIView.self, #selector(getter: UIResponder.inputAccessoryView)) {
        class_addMethod(c, #selector(getter: UIResponder.inputAccessoryView), imp_implementationWithBlock(block), method_getTypeEncoding(m))
      }
      objc_registerClassPair(c)
      cls = c
    }
    if let c = cls { object_setClass(content, c) }
  }

  // ---- 页面发来的：{ type: "openURL", url } —— 内置浏览器在 iPad 上就是 App 里的 Safari 视图；别的交给 AppModel ----
  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
    if type == "log" { // 页面出错：打出来；出错的头一条写在载入那一层上
      let text = (body["text"] as? String) ?? "", level = (body["level"] as? String) ?? "error"
      print("[vs page \(level)] \(text)")
      if level == "error", boot.step != "ready", boot.error.isEmpty { boot.error = String(text.prefix(300)) }
      return
    }
    if type == "chrome", let c = (body["bg"] as? String).flatMap(Self.cssColor) { chrome = c; chromeBottom = (body["bottom"] as? String).flatMap(Self.cssColor); onChrome(c, chromeBottom); return }
    if type == "statusBar" { onStatusBar((body["hidden"] as? Bool) ?? false); return }
    if type == "island" { LiveActivity.shared.update(body); return } // 灵动岛 / 锁屏的实时活动（vsisland.js）
    if type == "fullscreen" { onFullscreen((body["on"] as? Bool) ?? false); return }
    if type == "boot" { // 打开到能用之前的每一步（remote.js）
      let step = (body["step"] as? String) ?? ""
      print("[vs boot] \(step) \(body["mac"] as? String ?? "")")
      var b = boot
      if step != b.step { b.step = step; b.since = Date() }
      if let m = body["mac"] as? String, !m.isEmpty { b.mac = m }
      boot = b
      return
    }
    if type == "openURL" {
      guard let s = body["url"] as? String, let u = URL(string: s), ["http", "https"].contains(u.scheme?.lowercased() ?? "") else { return }
      let sf = SFSafariViewController(url: u)
      sf.dismissButtonStyle = .close
      sf.modalPresentationStyle = .pageSheet
      present(sf)
      return
    }
    onMessage(body)
  }

  private func present(_ vc: UIViewController) {
    guard var top = presenter() else { return }
    while let p = top.presentedViewController { top = p }
    top.present(vc, animated: true)
  }

  // 整页不缩放、不挪：WebKit 想放大或者把整页挪开（比如把输入框挪进视野）时，放回原处
  func viewForZooming(in scrollView: UIScrollView) -> UIView? { nil }
  func scrollViewWillBeginZooming(_ scrollView: UIScrollView, with view: UIView?) { scrollView.pinchGestureRecognizer?.isEnabled = false }
  func scrollViewDidScroll(_ scrollView: UIScrollView) { if scrollView.contentOffset != .zero { scrollView.contentOffset = .zero } }

  // ---- 导航：站内留在 App 里；登录交给系统浏览器；别的交给 Safari ----
  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
    guard let url = action.request.url else { return decisionHandler(.allow) }
    if !(action.targetFrame?.isMainFrame ?? true) { return decisionHandler(.allow) } // 页面里的 iframe（内嵌的网页）不管
    let scheme = url.scheme?.lowercased() ?? ""
    if ["about", "data", "blob"].contains(scheme) { return decisionHandler(.allow) }
    if Config.isSite(url) {
      if url.path == "/auth/login", !(url.query ?? "").contains("dev=") { // ?dev=：本地开发的测试登录，照常在页面里
        decisionHandler(.cancel)
        let next = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "next" })?.value ?? "/terminal.html"
        auth.start(origin: Config.origin, next: next.isEmpty || next == "/" ? "/terminal.html" : next) { [weak self] back in self?.web.load(URLRequest(url: back)) }
        return
      }
      return decisionHandler(.allow)
    }
    if ["http", "https", "mailto", "tel", "facetime"].contains(scheme) { UIApplication.shared.open(url) }
    decisionHandler(.cancel)
  }

  // window.open / target=_blank：交给 Safari
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let u = navigationAction.request.url, ["http", "https", "mailto"].contains(u.scheme?.lowercased() ?? "") { UIApplication.shared.open(u) }
    return nil
  }

  // 页面的 alert / confirm / prompt（网页版的几处兜底用到）：系统的提示框
  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable () -> Void) {
    let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
    a.addAction(UIAlertAction(title: "好", style: .default) { _ in completionHandler() })
    present(a)
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable (Bool) -> Void) {
    let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
    a.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(false) })
    a.addAction(UIAlertAction(title: "好", style: .default) { _ in completionHandler(true) })
    present(a)
  }

  func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable (String?) -> Void) {
    let a = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
    a.addTextField { $0.text = defaultText }
    a.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(nil) })
    a.addAction(UIAlertAction(title: "好", style: .default) { _ in completionHandler(a.textFields?.first?.text) })
    present(a)
  }

  // 网页进程被系统收掉了（在后台太久、内存紧）：重新载入，不留一块白屏
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { print("[vs] web content process terminated; reloading"); boot = BootState(); webView.reload() }

  // 载完了：不是工作台那一页（说明页）——不盖着，让它直接显示；是工作台的，等页面自己报能用了（remote.js 的 boot）。
  //   没登录时站点在 /terminal.html 给的是登录页（没有 remote.js，不会报 boot）：以前卡片一直写着「正在启动界面」、把登录按钮挡着——
  //   认出登录页就收起卡片（step = login），Native 界面换成「用 GitHub 登录」那一屏
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    let path = webView.url?.path ?? ""
    print("[vs] loaded \(webView.url?.absoluteString ?? "")")
    if boot.step == "failed" { return }
    if !path.hasPrefix("/terminal") { var b = boot; b.step = "veil"; boot = b; return }
    webView.evaluateJavaScript("[!!window.TSU_REMOTE, !!document.querySelector('a[href*=\"/auth/login\"]')]") { [weak self] r, _ in
      MainActor.assumeIsolated {
        guard let self, let a = r as? [Bool], a.count == 2 else { return }
        let login = !a[0] && a[1]
        self.needLogin = login
        if login { var b = self.boot; b.step = "login"; self.boot = b }
      }
    }
  }

  // 没网 / 站点打不开：一页说明，点一下重试
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    let e = error as NSError
    if e.code == NSURLErrorCancelled { return }
    print("[vs] load failed: \(e.domain) \(e.code) \(e.localizedDescription)")
    var b = boot; b.step = "failed"; b.error = "无法连接到 \(Config.startURL.host ?? "")：\(e.localizedDescription)"; b.since = Date(); boot = b
    let msg = (e.localizedDescription).replacingOccurrences(of: "<", with: "&lt;")
    let html = "<html><head><meta name=viewport content='width=device-width,initial-scale=1'><style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#000;color:#ccc;font:16px -apple-system}div{text-align:center}b{display:block;color:#fff;font-size:20px;margin-bottom:10px}a{color:#6871ff}</style></head><body><div><b>连不上 Vibing Studio</b>" + msg + "<br><br><a href='" + Config.startURL.absoluteString + "'>重试</a></div></body></html>"
    webView.loadHTMLString(html, baseURL: URL(string: Config.origin))
  }
}

// ---- Classic 界面：整屏就是这个网页（完整的工作台）----
final class ClassicViewController: UIViewController {
  private let host: WebHost
  private var bottomC: NSLayoutConstraint!

  init(host: WebHost) { self.host = host; super.init(nibName: nil, bundle: nil) }
  required init?(coder: NSCoder) { fatalError("init(coder:)") }

  // iPhone：留着最上面的时间、电量（灵动岛下面不放东西），网页放在安全区里；iPad：整屏
  private let phone = UIDevice.current.userInterfaceIdiom == .phone
  private var islandHide = false
  private var safeCs: [NSLayoutConstraint] = [], fullCs: [NSLayoutConstraint] = []
  private var fullOn = false
  // 全屏只看对话（页面里点的）：iPhone 上网页铺到整屏、状态栏收起（上面让出灵动岛、输入框的底色铺到最下面，studio.css）；退出全屏回到安全区里
  private func fullscreen(_ on: Bool) {
    guard phone, on != fullOn else { return }
    fullOn = on
    NSLayoutConstraint.deactivate(on ? safeCs : fullCs)
    NSLayoutConstraint.activate(on ? fullCs : safeCs)
    let c = bottomC.constant
    bottomC = on ? fullCs[3] : safeCs[3]
    bottomC.constant = c
    setNeedsStatusBarAppearanceUpdate()
    UIView.animate(withDuration: 0.2) { self.view.layoutIfNeeded() }
  }
  override var prefersStatusBarHidden: Bool { !phone || islandHide || fullOn }
  // 有灵动岛、竖着拿：告诉页面（st-island），页面决定要不要把标签页那一行顶上去、绕开灵动岛
  private var islandWas: Bool?
  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    let isl = false // 绕开灵动岛要网页伸到整屏（会压到圆角）：先不用，标签页在灵动岛正下方
    if isl != islandWas { islandWas = isl; host.js("document.documentElement.classList.toggle('st-island'," + (isl ? "true" : "false") + ");window.STUDIO&&STUDIO.islandSync&&STUDIO.islandSync()") }
  }
  override var prefersHomeIndicatorAutoHidden: Bool { !phone }
  private var darkChrome = false
  override var preferredStatusBarStyle: UIStatusBarStyle { darkChrome ? .lightContent : .darkContent }
  private let bottomBand = UIView() // 底部横条那一块：同输入框那一块的底色（白的就白），不是外框的灰
  private func paint(_ c: UIColor, _ bottom: UIColor? = nil) {
    guard phone else { return }
    view.backgroundColor = c
    bottomBand.backgroundColor = bottom ?? c
    var w: CGFloat = 1; c.getWhite(&w, alpha: nil)
    let d = w < 0.5
    if d != darkChrome { darkChrome = d; setNeedsStatusBarAppearanceUpdate() }
  }

  override func loadView() {
    let root = UIView()
    root.backgroundColor = phone ? .systemBackground : .black
    let w = host.web
    w.removeFromSuperview()
    w.translatesAutoresizingMaskIntoConstraints = false
    root.addSubview(w)
    // iPhone：网页放在安全区里（状态栏、灵动岛、底部横条、横屏的圆角都让开——伸到整屏时内容压到圆角上），那几条涂成界面外框的颜色；iPad：整屏
    let g = root.safeAreaLayoutGuide
    safeCs = [w.topAnchor.constraint(equalTo: g.topAnchor), w.leadingAnchor.constraint(equalTo: g.leadingAnchor), w.trailingAnchor.constraint(equalTo: g.trailingAnchor), w.bottomAnchor.constraint(equalTo: g.bottomAnchor)]
    fullCs = [w.topAnchor.constraint(equalTo: root.topAnchor), w.leadingAnchor.constraint(equalTo: root.leadingAnchor), w.trailingAnchor.constraint(equalTo: root.trailingAnchor), w.bottomAnchor.constraint(equalTo: root.bottomAnchor)]
    let cs = phone ? safeCs : fullCs
    bottomC = cs[3]
    NSLayoutConstraint.activate(cs)
    view = root
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    if phone {
      bottomBand.translatesAutoresizingMaskIntoConstraints = false
      view.insertSubview(bottomBand, at: 0)
      NSLayoutConstraint.activate([
        bottomBand.leadingAnchor.constraint(equalTo: view.leadingAnchor), bottomBand.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        bottomBand.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor), bottomBand.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      ])
    }
    if let c = host.chrome { paint(c, host.chromeBottom) }
    host.onChrome = { [weak self] c, b in self?.paint(c, b) }
    host.onStatusBar = { [weak self] h in guard let self, self.phone, h != self.islandHide else { return }; self.islandHide = h; self.setNeedsStatusBarAppearanceUpdate() }
    host.onFullscreen = { [weak self] on in self?.fullscreen(on) }
    NotificationCenter.default.addObserver(self, selector: #selector(kbChange(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(kbChange(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
  }

  // 只给停靠在底部、整宽的屏幕键盘让位置（整个网页缩到键盘上沿）；接着实体键盘时右下角那个输入法小条（「拼」）、浮动的小键盘不算——
  //   以前它们也被当成键盘，整个 App 被缩上去，底下顶出一条黑
  @objc private func kbChange(_ n: Notification) {
    guard let info = n.userInfo, let end = (info[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue, let screen = view.window?.screen else { return }
    let f = view.convert(end, from: screen.coordinateSpace)
    var inset: CGFloat = 0
    if n.name != UIResponder.keyboardWillHideNotification, f.width >= view.bounds.width * 0.9, f.height > 150, f.minY < view.bounds.maxY {
      inset = view.bounds.maxY - f.minY
      if phone && !fullOn { inset = max(0, inset - view.safeAreaInsets.bottom) } // 网页的下沿本来就在安全区上面：只让出键盘多出来的那一截（全屏时下沿在最下面，整个让出）
    }
    host.js("document.documentElement.classList.toggle('st-kb'," + (inset > 0 ? "true" : "false") + ")") // 键盘开着：页面知道（横屏打字时输入框挪到上面，studio.css）
    if bottomC.constant == -inset { return }
    bottomC.constant = -inset
    let dur = (info[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double) ?? 0.25
    UIView.animate(withDuration: dur) { self.view.layoutIfNeeded() }
  }
}

// 消息处理器不让 WKUserContentController 一直拿着 WebHost（它会强引用 handler）
final class WeakHandler: NSObject, WKScriptMessageHandler {
  weak var target: WKScriptMessageHandler?
  init(_ t: WKScriptMessageHandler) { target = t }
  func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) { target?.userContentController(c, didReceive: m) }
}


// 精确的型号：sysctl 的 hw.machine（「iPhone16,1」）→ 市售名称（「iPhone 15 Pro」）；表里没有的原样写代码（照样能分清）
enum DeviceModel {
  static let id: String = {
    var u = utsname(); uname(&u)
    return withUnsafePointer(to: &u.machine) { $0.withMemoryRebound(to: CChar.self, capacity: 256) { String(cString: $0) } }
  }()
  static let table: [String: String] = [
    "iPhone14,4": "iPhone 13 mini", "iPhone14,5": "iPhone 13", "iPhone14,2": "iPhone 13 Pro", "iPhone14,3": "iPhone 13 Pro Max", "iPhone14,6": "iPhone SE (3rd generation)",
    "iPhone14,7": "iPhone 14", "iPhone14,8": "iPhone 14 Plus", "iPhone15,2": "iPhone 14 Pro", "iPhone15,3": "iPhone 14 Pro Max",
    "iPhone15,4": "iPhone 15", "iPhone15,5": "iPhone 15 Plus", "iPhone16,1": "iPhone 15 Pro", "iPhone16,2": "iPhone 15 Pro Max",
    "iPhone17,3": "iPhone 16", "iPhone17,4": "iPhone 16 Plus", "iPhone17,1": "iPhone 16 Pro", "iPhone17,2": "iPhone 16 Pro Max", "iPhone17,5": "iPhone 16e",
    "iPhone18,3": "iPhone 17", "iPhone18,1": "iPhone 17 Pro", "iPhone18,2": "iPhone 17 Pro Max", "iPhone18,4": "iPhone Air",
    "iPad13,18": "iPad (10th generation)", "iPad13,19": "iPad (10th generation)", "iPad15,7": "iPad (A16)", "iPad15,8": "iPad (A16)",
    "iPad14,1": "iPad mini (6th generation)", "iPad14,2": "iPad mini (6th generation)", "iPad16,1": "iPad mini (A17 Pro)", "iPad16,2": "iPad mini (A17 Pro)",
    "iPad13,16": "iPad Air (5th generation)", "iPad13,17": "iPad Air (5th generation)", "iPad14,8": "iPad Air 11-inch (M2)", "iPad14,9": "iPad Air 11-inch (M2)", "iPad14,10": "iPad Air 13-inch (M2)", "iPad14,11": "iPad Air 13-inch (M2)",
    "iPad15,3": "iPad Air 11-inch (M3)", "iPad15,4": "iPad Air 11-inch (M3)", "iPad15,5": "iPad Air 13-inch (M3)", "iPad15,6": "iPad Air 13-inch (M3)",
    "iPad14,3": "iPad Pro 11-inch (4th generation)", "iPad14,4": "iPad Pro 11-inch (4th generation)", "iPad14,5": "iPad Pro 12.9-inch (6th generation)", "iPad14,6": "iPad Pro 12.9-inch (6th generation)",
    "iPad16,3": "iPad Pro 11-inch (M4)", "iPad16,4": "iPad Pro 11-inch (M4)", "iPad16,5": "iPad Pro 13-inch (M4)", "iPad16,6": "iPad Pro 13-inch (M4)",
    "iPad17,1": "iPad Pro 11-inch (M5)", "iPad17,2": "iPad Pro 11-inch (M5)", "iPad17,3": "iPad Pro 13-inch (M5)", "iPad17,4": "iPad Pro 13-inch (M5)",
  ]
  static var name: String { table[id] ?? id }
}
