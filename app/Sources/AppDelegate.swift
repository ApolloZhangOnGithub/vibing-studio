// AppDelegate.swift —— 菜单（只留退出、隐藏、编辑；别的快捷键都给网页桌面）、系统通知、点 Dock 图标把窗口叫回来
import AppKit
import UserNotifications

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate, NSMenuDelegate {
  var web: WebController!
  var extra: [WebController] = [] // 新建的窗口（第二个起）
  private var nextWin = 2
  let selfTest = ProcessInfo.processInfo.environment["NADOS_SELFTEST"] == "1"
  let testJS = ProcessInfo.processInfo.environment["NADOS_TESTJS"] != nil // 自动测试：不抢前台、退出不问

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.mainMenu = makeMenu()
    if !selfTest && !testJS { setStatusItem(UserDefaults.standard.object(forKey: "statusItem.on") as? Bool ?? true) } // 默认显示；页面的设置载好后会再同步一次
    UNUserNotificationCenter.current().delegate = self
    web = WebController()
    if selfTest { SelfTest.arm(web) }
    if let js = ProcessInfo.processInfo.environment["NADOS_TESTJS"] { SelfTest.armScript(web, js) }
    web.load()
    if selfTest || testJS { web.window.orderFront(nil) } else { web.window.makeKeyAndOrderFront(nil); NSApp.activate() } // 自测：不抢前台
    // iPad 使用这台 Mac：开着的话一启动就连上中转（不等窗口、页面）；状态变了告诉每个窗口的设置页
    if Config.terminal {
      RemoteHost.shared.changed = { [weak self] st in guard let self else { return }; (([self.web] as [WebController?]).compactMap { $0 } + self.extra).forEach { $0.emit("remote.changed", st) } }
      RemoteHost.shared.start()
    }
    // 第一次打开：问一次能不能发系统通知（窗口在后台时桌面里的通知也发到系统的通知中心）
    if !selfTest && !UserDefaults.standard.bool(forKey: "asked.notifications") {
      UserDefaults.standard.set(true, forKey: "asked.notifications")
      UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }
  }

  // 点 Dock 图标：窗口收起来了（红色按钮）就放回来
  // 注意：这个事件可能比 applicationDidFinishLaunching 先到（刚启动时又点了一下 Dock 图标）——窗口还没建好就什么也不做
  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    guard let web else { return true }
    if !web.window.isVisible { web.window.makeKeyAndOrderFront(nil) }
    return true
  }
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

  // ---- 在访达里用它打开（「打开方式 › Vibing Studio」、拖到 Dock 图标上）：交给页面——文件在编辑区打开，文件夹在访达页里打开 ----
  //   以前没接这个：系统弹「“Vibing Studio”打不开格式为“JavaScript”的文件」。先记着（页面可能还没载完），再叫页面来取
  //   （open-files → 页面调 open.pending）；页面刚载完时自己也会来取一次
  var pendingOpen: [String] = []
  func application(_ application: NSApplication, open urls: [URL]) {
    let paths = urls.filter { $0.isFileURL }.map { $0.path }
    guard !paths.isEmpty else { return }
    pendingOpen.append(contentsOf: paths)
    guard let web else { return }
    if !web.window.isVisible { web.window.makeKeyAndOrderFront(nil) }
    NSApp.activate()
    web.emit("open-files", ["count": paths.count])
  }
  // Paimon Terminal：还有程序在跑（claude、npm run dev……）就先问一声再退（同「终端」）；只开着 shell 的直接退
  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    guard Config.terminal, !selfTest, !testJS, let names = web?.bridge.local?.running(), !names.isEmpty else { return flushThenQuit() }
    var uniq: [String] = []
    for n in names where !uniq.contains(n) { uniq.append(n) }
    let a = NSAlert()
    a.messageText = "要终止正在运行的进程吗？"
    a.informativeText = "退出 " + Config.appName + " 将终止以下进程：" + uniq.joined(separator: "、") + "。"
    a.addButton(withTitle: "终止")
    a.addButton(withTitle: "取消")
    if !web.window.isVisible { web.window.makeKeyAndOrderFront(nil) }
    NSApp.activate()
    return a.runModal() == .alertFirstButtonReturn ? flushThenQuit() : .terminateCancel
  }
  // 退出前让每个窗口的页面把手上的东西记下来（写了一半的话、正在送的那一句；live.js 的 TSU_FLUSH）——等它们回话，最多 0.6 秒
  private func flushThenQuit() -> NSApplication.TerminateReply {
    let views = ([web] as [WebController?]).compactMap { $0 } + extra
    if views.isEmpty { return .terminateNow }
    var left = views.count, done = false
    let finish = { if !done { done = true; NSApp.reply(toApplicationShouldTerminate: true) } }
    for v in views {
      v.webView.evaluateJavaScript("window.TSU_FLUSH ? (TSU_FLUSH(), 1) : 0") { _, _ in left -= 1; if left == 0 { finish() } }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { finish() }
    return .terminateLater
  }

  // ---- 系统通知 ----
  // App 在前台时也显示（页面主动发的；桌面自己的横幅只在 App 不在前台时才转成系统通知）
  nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    completionHandler([.banner, .list, .sound])
  }
  // 点了通知：窗口到前面，告诉页面是哪一条
  nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
    let info = response.notification.request.content.userInfo
    let id = info["id"] as? String ?? response.notification.request.identifier
    let data = info["data"]
    let payload: [String: Any] = data.map { ["id": id, "data": $0] } ?? ["id": id]
    DispatchQueue.main.async {
      MainActor.assumeIsolated {
        guard let web = self.web else { return }
        web.window.makeKeyAndOrderFront(nil)
        NSApp.activate()
        web.emit("notification-click", payload)
      }
      completionHandler()
    }
  }

  // ---- 菜单 ----
  private func makeMenu() -> NSMenu {
    let main = NSMenu()
    let appItem = NSMenuItem()
    main.addItem(appItem)
    let app = NSMenu()
    app.addItem(withTitle: "关于 " + Config.appName, action: #selector(showAbout(_:)), keyEquivalent: "").target = self
    app.addItem(.separator())
    let services = NSMenuItem(title: "服务", action: nil, keyEquivalent: "")
    services.submenu = NSMenu()
    NSApp.servicesMenu = services.submenu
    app.addItem(services)
    app.addItem(.separator())
    app.addItem(withTitle: "隐藏 " + Config.appName, action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    let others = app.addItem(withTitle: "隐藏其他", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
    others.keyEquivalentModifierMask = [.command, .option]
    app.addItem(withTitle: "全部显示", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
    app.addItem(.separator())
    app.addItem(withTitle: "退出 " + Config.appName, action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appItem.submenu = app

    // 编辑：WKWebView 里的 ⌘C / ⌘V 要靠这几项（网页先拿到按键，没用掉才到这里）
    let editItem = NSMenuItem()
    main.addItem(editItem)
    let edit = NSMenu(title: "编辑")
    edit.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
    let redo = edit.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "z")
    redo.keyEquivalentModifierMask = [.command, .shift]
    edit.addItem(.separator())
    edit.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    editItem.submenu = edit

    // 窗口：不带快捷键（⌘M、⌘W 是网页桌面自己的）
    let winItem = NSMenuItem()
    main.addItem(winItem)
    let win = NSMenu(title: "窗口")
    if Config.terminal {
      let nw = win.addItem(withTitle: "新建窗口", action: #selector(newWindowAction(_:)), keyEquivalent: "n")
      nw.keyEquivalentModifierMask = [.command, .shift]
      nw.target = self
      win.addItem(.separator())
    }
    win.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "")
    win.addItem(withTitle: "缩放", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
    let fs = win.addItem(withTitle: "进入全屏幕", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
    fs.keyEquivalentModifierMask = [.command, .control]
    win.addItem(.separator())
    win.addItem(withTitle: "重新载入页面", action: #selector(reloadPage(_:)), keyEquivalent: "")
    win.addItem(withTitle: "前置全部窗口", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")
    winItem.submenu = win
    NSApp.windowsMenu = win
    return main
  }

  // 新建一个窗口：同一个页面，带上窗口号（各窗口的布局各记各的）；open 是要放进去的那个标签页（拖出来的），没有就是空的新窗口；
  //   mac：连另一台 Mac 的窗口（页面上 ?mac=：bridge.js 把这台的桥交给 remote.js，它把终端、文件、会话那些转到那台 Mac 去）——布局按那台 Mac 记，下次开它还是那几个标签页
  @discardableResult
  func newWindow(open: String?, topLeft: NSPoint?, mac: String? = nil) -> Int {
    let id = nextWin
    nextWin += 1
    let base = web?.webView.url ?? Config.startURL
    var comps = URLComponents(url: base, resolvingAgainstBaseURL: false) ?? URLComponents(url: Config.startURL, resolvingAgainstBaseURL: false)!
    var q = (comps.queryItems ?? []).filter { !["win", "open", "fresh", "mac"].contains($0.name) }
    q.append(URLQueryItem(name: "win", value: String(id)))
    if let mac { q.append(URLQueryItem(name: "mac", value: mac)) }
    if let open, !open.isEmpty { q.append(URLQueryItem(name: "open", value: open)) } else if mac == nil { q.append(URLQueryItem(name: "fresh", value: "1")) }
    comps.queryItems = q
    let c = WebController(url: comps.url ?? Config.startURL, winId: id, remoteMac: mac)
    extra.append(c)
    c.load()
    if let topLeft { c.window.setFrameTopLeftPoint(topLeft) }
    else if let key = NSApp.keyWindow { c.window.setFrameTopLeftPoint(NSPoint(x: key.frame.minX + 30, y: key.frame.maxY - 30)) }
    c.window.makeKeyAndOrderFront(nil)
    NSApp.activate()
    return id
  }
  func closed(_ c: WebController) { extra.removeAll { $0 === c } }
  // 用另一台 Mac：它已经开着窗口就叫到前面（一台 Mac 一个窗口，同 VS Code 的远程窗口）；没有就开一个
  func openRemote(mac: String, name: String) -> Int {
    if let c = extra.first(where: { $0.remoteMac == mac }) {
      if c.window.isMiniaturized { c.window.deminiaturize(nil) }
      c.window.makeKeyAndOrderFront(nil)
      NSApp.activate()
      return c.winId
    }
    if !name.isEmpty { UserDefaults.standard.set(name, forKey: "remote.name." + mac) }
    return newWindow(open: nil, topLeft: nil, mac: mac)
  }

  // ---- 菜单栏图标（同 Claude 的 App）：默认显示；点按（左右键都行）出菜单：显示窗口、在后台的窗口、新建窗口、设置、退出 ----
  //   关掉窗口不退出：主窗口一直是收起来（页面不关）；别的窗口里有程序在跑也只收起来——从这里或程序坞叫回来；退出只在这里和 ⌘Q
  private var statusItem: NSStatusItem?
  private let statusMenu = NSMenu()
  func setStatusItem(_ on: Bool) {
    UserDefaults.standard.set(on, forKey: "statusItem.on")
    if on, statusItem == nil {
      let it = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
      if let b = it.button {
        let img = (NSApp.applicationIconImage.copy() as? NSImage) ?? NSImage()
        img.size = NSSize(width: 18, height: 18)
        b.image = img
        b.toolTip = Config.appName
      }
      statusMenu.delegate = self
      it.menu = statusMenu
      statusItem = it
    } else if !on, let it = statusItem {
      NSStatusBar.system.removeStatusItem(it)
      statusItem = nil
    }
  }
  private func allControllers() -> [WebController] { ([web] as [WebController?]).compactMap { $0 } + extra }
  // 标签页拖出窗口、在另一个窗口上松开（同 Safari / Chrome）：屏幕上那一点是哪个窗口（从前往后找），交给它的页面放进去（tab.dropin，坐标换成那个窗口里的）；
  //   落在自己窗口上、或者没有窗口：返回 false（页面就照旧开一个新窗口）
  func dropTab(spec: String, screenX: Double, screenY: Double, from: WebController?) -> Bool {
    guard let main = NSScreen.screens.first else { return false }
    let p = NSPoint(x: screenX, y: main.frame.maxY - screenY) // 页面的屏幕坐标（左上角为原点）→ macOS 的（左下角为原点）
    let ctrls = allControllers()
    for w in NSApp.orderedWindows where w.isVisible && w.frame.contains(p) {
      guard let c = ctrls.first(where: { $0.window === w }) else { continue }
      if c === from { return false }
      let wp = w.convertPoint(fromScreen: p), h = w.contentView?.bounds.height ?? w.frame.height
      c.emit("tab.dropin", ["spec": spec, "x": wp.x, "y": h - wp.y])
      w.makeKeyAndOrderFront(nil)
      NSApp.activate()
      return true
    }
    return false
  }
  func menuNeedsUpdate(_ menu: NSMenu) {
    guard menu === statusMenu else { return }
    menu.removeAllItems()
    let show = NSMenuItem(title: "显示 " + Config.appName, action: #selector(statusShow(_:)), keyEquivalent: "")
    show.target = self
    menu.addItem(show)
    for (i, c) in extra.enumerated() where !c.window.isVisible { // 收起来的别的窗口（里面有程序在跑）
      let w = NSMenuItem(title: c.remoteMac != nil ? c.window.title : "窗口 \(i + 2)（在后台运行）", action: #selector(statusShowWindow(_:)), keyEquivalent: "")
      w.target = self; w.tag = i
      menu.addItem(w)
    }
    if Config.terminal {
      let nw = NSMenuItem(title: "新建窗口", action: #selector(newWindowAction(_:)), keyEquivalent: "")
      nw.target = self
      menu.addItem(nw)
    }
    menu.addItem(.separator())
    let st = NSMenuItem(title: "设置…", action: #selector(statusSettings(_:)), keyEquivalent: "")
    st.target = self
    menu.addItem(st)
    menu.addItem(.separator())
    menu.addItem(NSMenuItem(title: "退出 " + Config.appName, action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
  }
  @objc func statusShow(_ sender: Any?) { if let web { web.window.makeKeyAndOrderFront(nil) }; NSApp.activate() }
  @objc func statusShowWindow(_ sender: NSMenuItem) { if sender.tag < extra.count { extra[sender.tag].window.makeKeyAndOrderFront(nil) }; NSApp.activate() }
  @objc func statusSettings(_ sender: Any?) { statusShow(nil); web?.emit("status.settings", [:]) }
  @objc func newWindowAction(_ sender: Any?) { newWindow(open: nil, topLeft: nil) }

  // 关于：设置 › 关于（版本号、界面从哪儿读、更新）；页面还没好、或是老的界面没有这一页：系统的「关于」面板
  @objc func showAbout(_ sender: Any?) {
    guard let c = allControllers().first(where: { $0.window.isKeyWindow }) ?? web else { NSApp.orderFrontStandardAboutPanel(nil); return }
    if !c.window.isVisible { c.window.makeKeyAndOrderFront(nil) }
    NSApp.activate()
    c.webView.evaluateJavaScript("window.STUDIO && STUDIO.about ? (STUDIO.about() ? 1 : 0) : 0") { r, _ in
      if (r as? Int ?? 0) != 1 { NSApp.orderFrontStandardAboutPanel(nil) }
    }
  }

  @objc func reloadPage(_ sender: Any?) {
    if !web.window.isVisible { web.window.makeKeyAndOrderFront(nil) }
    web.webView.reload()
  }
}
