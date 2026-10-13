// WebController.swift —— 窗口 + WKWebView：登录状态留着（默认的持久存储）、站内留在 App 里、登录交给系统浏览器（BrowserAuth）、外链交给默认浏览器、
// 下载存到「下载」、选文件、摄像头麦克风、JS 的 alert / confirm / prompt；原生这边的事（窗口到前台、全屏、通知被点）告诉页面
import AppKit
import WebKit

// 本地界面和网站上的版本号一起等（loadLocal）：两个请求谁先回来都行，只在主线程里读写
final class VerJoin: @unchecked Sendable { var site: Int? = nil; var go: (() -> Void)? = nil }

@MainActor
final class WebController: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, NSWindowDelegate {
  let window: DesktopWindow
  let webView: WebView
  let bridge = Bridge()
  let menus = PageMenus() // 页面定的菜单（menu.set）
  private var downloads: [ObjectIdentifier: URL] = [:]
  private lazy var auth = BrowserAuth(window: window)

  var isActive: Bool { NSApp.isActive && window.isKeyWindow }
  var isFullScreen: Bool { window.styleMask.contains(.fullScreen) }
  // 红黄绿三个按钮右边到哪（页面的菜单栏左边要让出来）
  var buttonsInset: Double {
    guard let b = window.standardWindowButton(.zoomButton), let sv = b.superview else { return 0 }
    return Double(sv.convert(b.frame, to: nil).maxX.rounded(.up))
  }

  let startURL: URL
  // 本地界面（LocalUI.swift）：界面文件从这台 Mac 上读，账号那些照旧走网站；simulatedAt：刚交给 WKWebView 的那一页（它自己的这次导航放行）；
  // bypassOnce：没登录时照旧打开网站那一页（登录页）一次
  let localOn: Bool
  private var simulatedAt: Date? = nil, bypassOnce = false
  let winId: Int // 1 = 主窗口（红色按钮只是收起来）；2、3… = 新建的窗口（关了就关）
  let remoteMac: String? // 连着另一台 Mac 的窗口：那台的设备号（关了窗口就断开）
  init(url: URL = Config.startURL, winId: Int = 1, remoteMac: String? = nil) {
    startURL = url
    self.winId = winId
    self.remoteMac = remoteMac
    let cfg = WKWebViewConfiguration()
    cfg.websiteDataStore = .default() // Cookie、localStorage、IndexedDB 都在磁盘上，关了再开还是登录着
    cfg.preferences.javaScriptCanOpenWindowsAutomatically = true
    cfg.preferences.isElementFullscreenEnabled = true
    cfg.preferences.inactiveSchedulingPolicy = .none // 窗口藏起来、被挡住时页面照常跑（agent 在后台干活）
    cfg.mediaTypesRequiringUserActionForPlayback = []
    cfg.applicationNameForUserAgent = "Version/26.0 Safari/605.1.15 Paimon/" + Config.version
    cfg.setURLSchemeHandler(LocalUISchemeHandler(), forURLScheme: LocalUI.scheme) // 本地界面文件（LocalUI.swift）
    // https 的页面里引用 vibing-ui:// 的脚本：WebKit 默认当它是「不安全的」混合内容、不给跑——这里把它登记成安全的协议（WebKit 的 SPI，找不到就算了，退回内联）
    let secSel = NSSelectorFromString("_registerURLSchemeAsSecure:")
    if cfg.processPool.responds(to: secSel) { cfg.processPool.perform(secSel, with: LocalUI.scheme as NSString); LocalUI.secureScheme = true }
    localOn = LocalUI.enabled(for: url)
    webView = WebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 800), configuration: cfg)
    window = DesktopWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 800), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
    super.init()

    let ucc = cfg.userContentController
    ucc.addUserScript(WKUserScript(source: WebController.bridgeSource(), injectionTime: .atDocumentStart, forMainFrameOnly: true))
    // 自动测试（量启动）：NADOS_PROBE_JS=<文件> 在页面最开头跑一段（记时间点）；NADOS_APPEARANCE=light|dark 让整个 App 当成系统是浅色 / 深色（不动系统设置）
    let env = ProcessInfo.processInfo.environment
    if let p = env["NADOS_PROBE_JS"], let src = try? String(contentsOfFile: p, encoding: .utf8) {
      ucc.addUserScript(WKUserScript(source: src, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }
    if let a = env["NADOS_APPEARANCE"] { NSApp.appearance = NSAppearance(named: a == "light" ? .aqua : .darkAqua) }
    ucc.addScriptMessageHandler(bridge, contentWorld: .page, name: "nados")
    bridge.controller = self
    menus.controller = self

    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsBackForwardNavigationGestures = false // 两指左右滑是网页桌面自己的手势，不是「后退」
    webView.allowsMagnification = false
    webView.isInspectable = Config.debug
    // 启动时的底色：页面上次记下的（见 bootLook）。WKWebView 不画它自己的白底：页面画出来之前露出来的就是窗口的底色——一开窗就是 App 的深 / 浅色，不闪白
    let look = WebController.bootLook()
    if ["setDrawsBackground:", "_setDrawsBackground:"].contains(where: { webView.responds(to: NSSelectorFromString($0)) }) { webView.setValue(false, forKey: "drawsBackground") } // KVC 找得到才设（找不到会抛异常）
    webView.underPageBackgroundColor = look.bg

    window.title = remoteMac.flatMap { UserDefaults.standard.string(forKey: "remote.name." + $0) } ?? Config.appName
    window.titleVisibility = .hidden
    window.titlebarAppearsTransparent = true
    window.tabbingMode = .disallowed
    window.collectionBehavior.insert(.fullScreenPrimary)
    window.minSize = NSSize(width: 720, height: 480)
    window.backgroundColor = look.bg
    if let ap = look.appearance { window.appearance = ap } // 页面定死了深 / 浅（不跟系统）：红黄绿、标题栏一开始就对
    window.isReleasedWhenClosed = false
    window.contentView = webView
    window.delegate = self
    let frameName = remoteMac.map { "PaimonRemote-" + $0 } ?? (Config.terminal ? "PaimonTerminalMain" : "PaimonMain") + (winId > 1 ? "-\(winId)" : "") // 连另一台 Mac 的窗口：按那台记大小、位置
    if !window.setFrameUsingName(frameName) {
      let vf = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
      window.setFrame(vf.insetBy(dx: vf.width * 0.06, dy: vf.height * 0.06), display: false)
    }
    window.setFrameAutosaveName(frameName) // 记住大小、位置（下次开还在那）
    // Paimon Terminal：拖进来的文件交给页面（贴路径），窗口到前面好接着打字
    if Config.terminal {
      webView.onFiles = { [weak self] paths, at in
        MainActor.assumeIsolated {
          guard let self else { return }
          NSApp.activate()
          self.window.makeKeyAndOrderFront(nil)
          self.emit("drop.paths", ["paths": paths, "x": at.x, "y": at.y])
        }
      }
    }

    let nc = NotificationCenter.default
    for n in [NSApplication.didBecomeActiveNotification, NSApplication.didResignActiveNotification] {
      nc.addObserver(forName: n, object: nil, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.emitActive() } }
    }
  }

  // 启动时窗口的底色、深浅：页面记下的（window.appearance 带的 boot：mode = auto 跟系统 / dark / light，深、浅各一个颜色，存在 UserDefaults），
  // 没记过：跟系统，纯黑 / 纯白
  static func bootLook() -> (bg: NSColor, appearance: NSAppearance?, dark: Bool) {
    let d = UserDefaults.standard, mode = d.string(forKey: "boot.mode") ?? "auto"
    let dark = mode == "dark" ? true : mode == "light" ? false : NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    let bg = d.string(forKey: dark ? "boot.bg.dark" : "boot.bg.light").flatMap(color(hex:)) ?? (dark ? .black : .white)
    return (bg, mode == "auto" ? nil : NSAppearance(named: dark ? .darkAqua : .aqua), dark)
  }
  // "#rrggbb" → NSColor（别的写法不认）
  static func color(hex: String) -> NSColor? {
    var s = hex.trimmingCharacters(in: .whitespaces)
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
    return NSColor(srgbRed: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1)
  }

  static func bridgeSource() -> String {
    let url = Bundle.main.url(forResource: "bridge", withExtension: "js")
    let src = url.flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""
    let allowed = (try? JSONSerialization.data(withJSONObject: Config.bridgeOrigins)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
    let info = (try? JSONSerialization.data(withJSONObject: ["platform": "macos", "app": Config.appName, "version": Config.version, "protocol": Bridge.protocolVersion, "local": Config.terminal] as [String: Any]))
      .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    return src.replacingOccurrences(of: "__ALLOWED__", with: allowed).replacingOccurrences(of: "__INFO__", with: info)
  }

  // 载入桌面。连不上（断网、服务器在重启）就显示一行字、隔几秒再试；15 秒还没有回应也重来一次
  private var loadGen = 0, committed = false, retries = 0
  func load() {
    loadGen += 1
    let gen = loadGen
    committed = false
    trace("load " + startURL.absoluteString)
    // 自动测试：NADOS_LOCAL_UI_SIMULATE=<网址> 直接把本地界面当成那个网址的页面打开（不去网站取账号那一段；量 https 源下本地脚本能不能用）
    if let sim = ProcessInfo.processInfo.environment["NADOS_LOCAL_UI_SIMULATE"], let su = URL(string: sim) { showLocal(su, "<script>window.TSU_UID = 0; window.TSU_SBX = false;</script>"); return }
    if localOn && LocalUI.isPage(startURL) { loadLocal(startURL) } else { webView.load(URLRequest(url: startURL)) }
    DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
      MainActor.assumeIsolated { if let self, gen == self.loadGen, !self.committed { self.trace("no response in 15s"); self.load() } }
    }
  }
  // 本地界面：带着这个站的 Cookie 去网站取一次页面，只为那一段账号信息（window.TSU_UID …）；拿到了就用本地的界面文件拼好这一页交给 WKWebView。
  //   没登录（网站给的是登录页）：照旧打开网站（登录流程不变，登好了回到这一页时再换成本地的）；断网：用上次拿到的那一段，照样打开本地界面
  func loadLocal(_ page: URL) {
    let key = "localUI.inject." + (Config.origin(page) ?? "")
    webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
      MainActor.assumeIsolated {
        guard let self else { return }
        let host = (page.host ?? "").lowercased()
        let jar = cookies.filter { c in
          let d = (c.domain.hasPrefix(".") ? String(c.domain.dropFirst()) : c.domain).lowercased()
          return (host == d || host.hasSuffix("." + d)) && page.path.hasPrefix(c.path.isEmpty ? "/" : c.path)
        }
        var req = URLRequest(url: page, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 8)
        req.httpShouldHandleCookies = false
        let cookie = jar.map { $0.name + "=" + $0.value }.joined(separator: "; ")
        if !jar.isEmpty { req.setValue(cookie, forHTTPHeaderField: "Cookie") }
        req.setValue("text/html", forHTTPHeaderField: "Accept")
        // 界面来源是 auto（默认）、用的不是 App 带的那份：同时问一下网站上的界面是第几版——本机那份比它旧（iCloud 没同步过来、以前装的一份）就用网站上的，
        //   不再一直停在旧的那一版（别的 Mac 上以前就是这样：一直是几天前的界面，也不提示更新）
        let join = VerJoin()
        var verReq: URLRequest? = nil
        if LocalUI.source == "auto" && !LocalUI.bundledOnly, var vc = URLComponents(url: page, resolvingAgainstBaseURL: false) {
          vc.path = "/version.json"; vc.query = nil; vc.fragment = nil
          if let vu = vc.url {
            var vr = URLRequest(url: vu, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 5)
            vr.httpShouldHandleCookies = false
            if !jar.isEmpty { vr.setValue(cookie, forHTTPHeaderField: "Cookie") }
            verReq = vr
          }
        }
        let wantVer = verReq != nil // 真的问了才等它
        if let vr = verReq {
          URLSession.shared.dataTask(with: vr) { d, resp, _ in
            let b = (resp as? HTTPURLResponse)?.statusCode == 200 ? LocalUI.build(of: d) : 0
            DispatchQueue.main.async { MainActor.assumeIsolated { join.site = b; join.go?(); join.go = nil } }
          }.resume()
        }
        URLSession.shared.dataTask(with: req) { data, _, err in
          let inj = LocalUI.injection(in: data.flatMap { String(data: $0, encoding: .utf8) } ?? "")
          let failed = err != nil
          DispatchQueue.main.async {
            MainActor.assumeIsolated {
              if let inj {
                UserDefaults.standard.set(inj, forKey: key)
                if LocalUI.bundledOnly { self.trace("online, bundled UI only: load the site (latest UI)"); self.bypassOnce = true; self.webView.load(URLRequest(url: page)); return } // 别的 Mac：界面跟网站走，不停在打包时的那一版
                if LocalUI.source == "site" { self.trace("ui source: site"); self.bypassOnce = true; self.webView.load(URLRequest(url: page)); return }
                let go = {
                  let lb = LocalUI.localBuild(), sb = join.site ?? 0
                  if wantVer && sb > lb { self.trace("local UI build \(lb) is older than the site's \(sb): load the site"); self.bypassOnce = true; self.webView.load(URLRequest(url: page)); return }
                  self.showLocal(page, inj)
                }
                if wantVer && join.site == nil { join.go = go } else { go() } // 网站的版本号还没回来：等它（最多 5 秒）
                return
              }
              if failed, let old = UserDefaults.standard.string(forKey: key) { self.trace("offline: local UI with the last account"); self.showLocal(page, old); return }
              self.trace("not signed in (or site error): load the site page")
              self.bypassOnce = true
              self.webView.load(URLRequest(url: page))
            }
          }
        }.resume()
      }
    }
  }
  private func showLocal(_ page: URL, _ inj: String) {
    guard let html = LocalUI.page(injection: inj, inline: ProcessInfo.processInfo.environment["NADOS_LOCAL_UI_INLINE"] == "1" || (!LocalUI.secureScheme && page.scheme == "https")) else { bypassOnce = true; webView.load(URLRequest(url: page)); return }
    let resp = HTTPURLResponse(url: page, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store"])!
    trace("local UI from " + (LocalUI.dir?.path ?? "?"))
    simulatedAt = Date()
    webView.loadSimulatedRequest(URLRequest(url: page), response: resp, responseData: Data(html.utf8))
  }
  private func offline(_ error: NSError) {
    let esc = { (s: String) in s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;") }
    let wait = min(30, 3 << min(retries, 3))
    retries += 1
    loadGen += 1
    let gen = loadGen
    let look = WebController.bootLook(), hi = look.dark ? "#e5e5ea" : "#1d1d1f", lo = look.dark ? "#8e8e93" : "#6e6e73" // 同启动的底色：深就深、浅就浅
    webView.loadHTMLString("<!doctype html><meta charset=\"utf-8\"><body style=\"margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:transparent;color:\(lo);" +
      "font:14px -apple-system,'PingFang SC',sans-serif;text-align:center;-webkit-user-select:none\"><div><div style=\"font-size:17px;color:\(hi);margin-bottom:8px\">无法连接到 " +
      esc(Config.startURL.host ?? "") + "</div><div>" + esc(error.localizedDescription) + "</div><div style=\"margin-top:14px\">\(wait) 秒后重试</div></div>", baseURL: nil)
    DispatchQueue.main.asyncAfter(deadline: .now() + .seconds(wait)) { [weak self] in MainActor.assumeIsolated { if let self, gen == self.loadGen { self.load() } } }
  }

  // ---- 原生 → 页面 ----
  func emit(_ type: String, _ detail: [String: Any]) {
    webView.callAsyncJavaScript("if (window.nadosNative && window.nadosNative._emit) window.nadosNative._emit(type, detail)", arguments: ["type": type, "detail": detail], in: nil, in: .page) { _ in }
  }
  private var lastActive: Bool?
  func emitActive() {
    let a = isActive
    if a == lastActive { return }
    lastActive = a
    emit("active", ["active": a])
  }

  // ---- 窗口 ----
  func windowDidBecomeKey(_ notification: Notification) { emitActive(); menus.reapply() } // 菜单栏跟着前面那个窗口
  func windowWillClose(_ notification: Notification) { bridge.rdp?.closeAll(); if winId > 1 { (NSApp.delegate as? AppDelegate)?.closed(self) } } // 关窗口：这个窗口里的远程桌面都断开
  func windowDidResignKey(_ notification: Notification) { emitActive() }
  func windowDidEnterFullScreen(_ notification: Notification) { emit("fullscreen", ["on": true, "inset": 0]) }
  func windowDidExitFullScreen(_ notification: Notification) { emit("fullscreen", ["on": false, "inset": buttonsInset]) }
  // 点红色按钮：窗口收起来但页面不关（agent 还在跑）；点 Dock 图标再出来
  func windowShouldClose(_ sender: NSWindow) -> Bool {
    if remoteMac != nil { return true } // 连着另一台 Mac 的窗口：关了就是断开（终端、程序在那台 Mac 上照常跑，下次打开接回来）
    if winId > 1, (bridge.local?.running() ?? []).isEmpty { return true } // 新建的窗口：里面没有程序在跑才真关掉
    sender.orderOut(nil) // 主窗口、有程序在跑的窗口：只收起来（不小心点了红色按钮也不影响 Agent、命令）；菜单栏图标、程序坞叫回来
    return false
  }

  // ---- 导航：站内留在 App 里；登录（/auth/login）交给系统浏览器，做完回到 App；别的交给默认浏览器 ----
  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
    if action.shouldPerformDownload { return decisionHandler(.download) }
    guard let url = action.request.url, let scheme = url.scheme?.lowercased() else { return decisionHandler(.cancel) }
    if !(action.targetFrame?.isMainFrame ?? true) { return decisionHandler(.allow) } // 页面里的 iframe（Safari 里开的网页等）不管
    // 本地界面：要打开（刷新、登好了回来、location.href）的是这一页 → 换成本地拼的那一页；本地拼好交给 WebKit 的那一次放行
    if localOn, LocalUI.isPage(url), Config.origin(url) == Config.origin(startURL) {
      if let t = simulatedAt, Date().timeIntervalSince(t) < 5 { simulatedAt = nil; return decisionHandler(.allow) }
      if bypassOnce { bypassOnce = false; return decisionHandler(.allow) }
      decisionHandler(.cancel)
      loadLocal(url)
      return
    }
    if url.path == "/auth/login", !(url.query ?? "").contains("dev="), let o = Config.origin(url), o == Config.origin(Config.startURL) || Config.bridgeAllowed(o) { // ?dev=：本地开发的测试登录，照常在页面里
      let next = Config.startURL.path.isEmpty ? "/" : Config.startURL.path
      let browser = { [weak self] in
        guard let self else { return }
        self.trace("login in the browser: " + o)
        self.auth.start(origin: o, next: next) { [weak self] back in self?.webView.load(URLRequest(url: back)) }
      }
      // 这台 Mac 开了「用 Touch ID 登录」：先按指纹（系统的框），不开浏览器；取消了、不成再走浏览器
      if AuthKey.enrolled(origin: o) {
        trace("login with Touch ID: " + o)
        Task { @MainActor [weak self] in
          if let back = await AuthKey.login(origin: o, next: next) { self?.webView.load(URLRequest(url: back)) } else { browser() }
        }
      } else { browser() }
      return decisionHandler(.cancel)
    }
    if ["about", "blob", "data"].contains(scheme) || Config.inApp(url) { return decisionHandler(.allow) }
    if ["http", "https", "mailto", "tel", "facetime"].contains(scheme) { NSWorkspace.shared.open(url) }
    decisionHandler(.cancel)
  }
  func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping @MainActor @Sendable (WKNavigationResponsePolicy) -> Void) {
    let cd = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
    decisionHandler(!response.canShowMIMEType || cd.lowercased().hasPrefix("attachment") ? .download : .allow)
  }
  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
  // 网页进程崩了（内存等）：重新载入，同刷新
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { trace("web content process terminated"); if localOn { load() } else { webView.reload() } }
  // 载入过程记一笔（自测时写进结果，查「页面一直白着」这类问题）
  var events: [String] = []
  func trace(_ s: String) { if events.count < 200 { events.append(String(format: "%.1f ", Date().timeIntervalSince(started)) + s) } }
  private let started = Date()
  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { trace("start " + (webView.url?.absoluteString ?? "")) }
  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
    trace("commit " + (webView.url?.absoluteString ?? ""))
    if webView.url?.scheme != "about" { committed = true; retries = 0 }
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { trace("finish " + (webView.url?.absoluteString ?? "")) }
  // 网页里存起来的密钥（WebCrypto）用的主密钥：App 自己给（WebCryptoKey.swift）——不让 WebKit 放进钥匙串（那一项每次更新都要输开机密码）
  @objc(_webCryptoMasterKeyForWebView:completionHandler:)
  func webCryptoMasterKey(_ webView: WKWebView, completionHandler: @escaping (Data?) -> Void) { WebCryptoKey.get(completionHandler) }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    let e = error as NSError
    trace("fail provisional: \(e.domain) \(e.code) " + e.localizedDescription)
    // 取消（点了别的链接）、转成下载（WebKit 的 102）不算；网络上的错：显示一行字、过一会儿重试
    if e.domain == NSURLErrorDomain && e.code != NSURLErrorCancelled { committed = true; offline(e) }
  }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { trace("fail: " + error.localizedDescription) }

  // ---- 新窗口（target=_blank、window.open）：交给默认浏览器 ----
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let u = action.request.url, let s = u.scheme?.lowercased(), ["http", "https", "mailto"].contains(s) { NSWorkspace.shared.open(u) }
    return nil
  }

  // ---- alert / confirm / prompt ----
  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable () -> Void) {
    let a = NSAlert()
    a.messageText = message
    a.addButton(withTitle: "好")
    a.beginSheetModal(for: window) { _ in completionHandler() }
  }
  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable (Bool) -> Void) {
    let a = NSAlert()
    a.messageText = message
    a.addButton(withTitle: "好")
    a.addButton(withTitle: "取消")
    a.beginSheetModal(for: window) { r in completionHandler(r == .alertFirstButtonReturn) }
  }
  func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable (String?) -> Void) {
    let a = NSAlert()
    a.messageText = prompt
    let f = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24))
    f.stringValue = defaultText ?? ""
    a.accessoryView = f
    a.addButton(withTitle: "好")
    a.addButton(withTitle: "取消")
    a.window.initialFirstResponder = f
    a.beginSheetModal(for: window) { r in completionHandler(r == .alertFirstButtonReturn ? f.stringValue : nil) }
  }

  // ---- <input type=file> ----
  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable ([URL]?) -> Void) {
    let p = NSOpenPanel()
    p.allowsMultipleSelection = parameters.allowsMultipleSelection
    p.canChooseDirectories = parameters.allowsDirectories
    p.canChooseFiles = true
    p.beginSheetModal(for: window) { r in completionHandler(r == .OK ? p.urls : nil) }
  }

  // ---- 摄像头、麦克风：本站直接给（系统那一层的授权另外由 macOS 问）；别的网页照常问 ----
  func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void) {
    decisionHandler(Config.bridgeAllowed(Config.origin(origin)) ? .grant : .prompt)
  }

  // ---- 下载：存进「下载」文件夹（重名加 (1)、(2)），完成后 Dock 里的下载堆栈跳一下 ----
  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping @MainActor @Sendable (URL?) -> Void) {
    let dir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
    let name = suggestedFilename.isEmpty ? "download" : suggestedFilename
    var url = dir.appendingPathComponent(name), n = 1
    let base = (name as NSString).deletingPathExtension, ext = (name as NSString).pathExtension
    while FileManager.default.fileExists(atPath: url.path) {
      url = dir.appendingPathComponent(base + " (\(n))" + (ext.isEmpty ? "" : "." + ext))
      n += 1
    }
    downloads[ObjectIdentifier(download)] = url
    completionHandler(url)
  }
  func downloadDidFinish(_ download: WKDownload) {
    guard let url = downloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
    DistributedNotificationCenter.default().post(name: Notification.Name("com.apple.DownloadFileFinished"), object: url.path)
  }
  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    downloads.removeValue(forKey: ObjectIdentifier(download))
    NSLog("Paimon: download failed: %@", error.localizedDescription)
  }
}
