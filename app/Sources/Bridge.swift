// Bridge.swift —— 网页 ↔ 原生的桥：window.nadosNative.call(命令, 参数) 到这里。
// 回复一律是信封：{ ok: true, value } 或 { ok: false, error: { code, message } }（平台无关，iOS 照同一份协议实现）
import AppKit
import UserNotifications
import WebKit

struct BridgeError: Error {
  let code: String, message: String
  static func args(_ m: String) -> BridgeError { BridgeError(code: "E_ARGS", message: m) }
  static func permission(_ m: String) -> BridgeError { BridgeError(code: "E_PERMISSION", message: m) }
  static func failed(_ m: String) -> BridgeError { BridgeError(code: "E_FAILED", message: m) }
}

@MainActor
final class Bridge: NSObject, WKScriptMessageHandlerWithReply {
  static let protocolVersion = 1
  static let commands = ["info", "permissions", "request", "settings", "notify", "clipboard.read", "clipboard.write", "openExternal", "screenshot", "badge", "attention", "window.dragRegions", "window.fullscreen",
                         "window.title", "window.new", "menu.set", "menu.popup", "pdf.render", "page.snapshot", "window.appearance", "ui.stamp", "ui.source", "open.pending",
                         "window.tabDrop", "app.activate", "app.quit", "statusItem.set", "remote.open", "window.close"]
  weak var controller: WebController? { didSet { local?.controller = controller; web?.controller = controller; rdp?.controller = controller } }
  let local: Local? = Config.terminal ? Local() : nil // Paimon Terminal：这台 Mac 本身（真终端、命令、文件）
  let web: WebPanes? = Config.terminal ? WebPanes() : nil // Vibing Studio：内嵌的浏览器（页面给位置，这边叠一个真的 WKWebView）
  let rdp: RdpPanes? = Config.terminal ? RdpPanes() : nil // Vibing Studio：远程桌面（同上：页面给位置，这边叠一个画远端画面的视图）

  func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
    let origin = Config.origin(message.frameInfo.securityOrigin)
    guard message.frameInfo.isMainFrame, Config.bridgeAllowed(origin) else {
      replyHandler(Bridge.fail(BridgeError(code: "E_ORIGIN", message: "\(origin) may not use the native bridge")), nil)
      return
    }
    guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else {
      replyHandler(Bridge.fail(.args("expected { cmd, args }")), nil)
      return
    }
    let args = body["args"] as? [String: Any] ?? [:]
    Task { @MainActor in
      do { replyHandler(["ok": true, "value": try await self.run(cmd, args) ?? NSNull()], nil) }
      catch let e as BridgeError { replyHandler(Bridge.fail(e), nil) }
      catch { replyHandler(Bridge.fail(.failed(error.localizedDescription)), nil) }
    }
  }

  static func fail(_ e: BridgeError) -> [String: Any] { ["ok": false, "error": ["code": e.code, "message": e.message]] }

  func run(_ cmd: String, _ a: [String: Any]) async throws -> Any? {
    switch cmd {
    case "info":
      let v = ProcessInfo.processInfo.operatingSystemVersion
      #if arch(arm64)
      let arch = "arm64"
      #else
      let arch = "x86_64"
      #endif
      var cmds: [String] = Bridge.commands + SystemInfo.commands
      if local != nil { cmds += Local.commands + RemoteHost.commands }
      if web != nil { cmds += WebPanes.commands }
      if rdp != nil { cmds += RdpPanes.commands }
      return [
        "platform": "macos", "app": Config.appName, "version": Config.version, "build": Config.build, "protocol": Bridge.protocolVersion, "local": Config.terminal,
        "os": "\(v.majorVersion).\(v.minorVersion).\(v.patchVersion)", "arch": arch, "commands": cmds,
        "active": controller?.isActive ?? false, "fullscreen": controller?.isFullScreen ?? false, "inset": controller?.buttonsInset ?? 0,
      ] as [String: Any]
    case "permissions":
      return await Permissions.status()
    case "request":
      guard let k = a["kind"] as? String else { throw BridgeError.args("request { kind } — one of: \(Permissions.kinds.joined(separator: ", "))") }
      return try await Permissions.request(k)
    case "settings":
      guard let k = a["kind"] as? String, Permissions.kinds.contains(k) else { throw BridgeError.args("settings { kind } — one of: \(Permissions.kinds.joined(separator: ", "))") }
      return ["opened": Permissions.openSettings(k)]
    case "notify":
      return try await notify(a)
    case "clipboard.read":
      return ["text": NSPasteboard.general.string(forType: .string) ?? ""]
    case "clipboard.write":
      guard let t = a["text"] as? String else { throw BridgeError.args("clipboard.write { text }") }
      NSPasteboard.general.clearContents()
      NSPasteboard.general.setString(t, forType: .string)
      return ["chars": t.count]
    case "openExternal":
      guard let s = a["url"] as? String, let u = URL(string: s), let sc = u.scheme?.lowercased(), ["http", "https", "mailto"].contains(sc) else {
        throw BridgeError.args("openExternal { url } — http, https or mailto only")
      }
      return ["opened": NSWorkspace.shared.open(u)]
    case "screenshot":
      return try await Screenshot.capture(a)
    case "badge":
      let t = (a["text"] as? String) ?? (a["text"] as? Int).map(String.init) ?? ""
      NSApp.dockTile.badgeLabel = t.isEmpty ? nil : t
      return ["badge": t]
    case "attention":
      return ["request": NSApp.requestUserAttention(a["critical"] as? Bool == true ? .criticalRequest : .informationalRequest)]
    case "window.tabDrop":
      guard let app = NSApp.delegate as? AppDelegate, let x = (a["x"] as? NSNumber)?.doubleValue, let y = (a["y"] as? NSNumber)?.doubleValue, let spec = a["spec"] as? String else { return ["ok": false] }
      return ["ok": app.dropTab(spec: spec, screenX: x, screenY: y, from: controller)]
    case "app.activate":
      // 会话在问你、App 在后台：窗口叫到最前面（设置里能关）
      if let w = controller?.window { if w.isMiniaturized { w.deminiaturize(nil) }; w.makeKeyAndOrderFront(nil) }
      NSApp.activate()
      return ["ok": true]
    case "statusItem.set":
      (NSApp.delegate as? AppDelegate)?.setStatusItem((a["on"] as? Bool) ?? true)
      return ["ok": true]
    case "app.quit":
      // 「重启以更新」：同 ⌘Q（还有程序在跑会先问）；稍后再退，这一下的回话先送回页面
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { NSApp.terminate(nil) }
      return ["ok": true]
    case "window.dragRegions":
      // 网页的菜单栏里空着的地方：按下能拖窗口、双击同标题栏（macOS 自己的窗口没有标题栏，桌面的菜单栏就是它的标题栏）
      let rects = (a["rects"] as? [[String: Any]] ?? []).compactMap { r -> NSRect? in
        guard let x = r["x"] as? Double, let y = r["y"] as? Double, let w = r["w"] as? Double, let h = r["h"] as? Double, w > 0, h > 0 else { return nil }
        return NSRect(x: x, y: y, width: w, height: h)
      }
      controller?.window.dragRegions = Array(rects.prefix(16))
      return ["count": min(16, rects.count)]
    case "window.fullscreen":
      // 网页桌面的「全屏」（⌃⌘F、菜单）= 整个 App 窗口进 / 出 macOS 的全屏，而不是 WebKit 自己的元素全屏
      guard let w = controller?.window else { throw BridgeError.failed("no window") }
      let on = w.styleMask.contains(.fullScreen), want = (a["on"] as? Bool) ?? !on
      if want != on { w.toggleFullScreen(nil) }
      return ["on": want]
    case "window.new":
      guard Config.terminal, let app = NSApp.delegate as? AppDelegate else { return nil }
      var tl: NSPoint?
      if let x = (a["x"] as? NSNumber)?.doubleValue, let y = (a["y"] as? NSNumber)?.doubleValue, let scr = NSScreen.screens.first { tl = NSPoint(x: x - 40, y: scr.frame.maxY - y + 14) }
      return ["id": app.newWindow(open: a["open"] as? String, topLeft: tl)]
    case "remote.open":
      // 用另一台 Mac：开一个新窗口连它（终端、文件、会话都在那台 Mac 上；窗口、菜单、剪贴板是这台的）。那台已经开着窗口就把它叫到前面
      guard Config.terminal, let app = NSApp.delegate as? AppDelegate, let mac = a["mac"] as? String, mac.range(of: "^[\\w-]{4,64}$", options: .regularExpression) != nil else { throw BridgeError.args("remote.open { mac, name? }") }
      return ["id": app.openRemote(mac: mac, name: a["name"] as? String ?? "")]
    case "window.close":
      // 关掉这个窗口（连着另一台 Mac 的窗口里「断开连接」）；主窗口只是收起来
      guard let c = controller else { return nil }
      if c.winId > 1 { c.window.close() } else { c.window.orderOut(nil) }
      return nil
    case "window.appearance":
      // 窗口跟着页面的深浅色（不是系统的）：标题栏、红黄绿、原生右键菜单、对话框都一起变；auto = 跟系统
      let mode = a["mode"] as? String ?? "auto"
      controller?.window.appearance = mode == "dark" ? NSAppearance(named: .darkAqua) : mode == "light" ? NSAppearance(named: .aqua) : nil
      // bg：页面现在的底色（#rrggbb）——窗口的底色跟上（拉大窗口、页面还没画到的地方）；
      // boot：下次启动一开窗就用的（mode = auto / dark / light，dark、light 各一个颜色），见 WebController.bootLook
      if let hex = a["bg"] as? String, let c = WebController.color(hex: hex) { controller?.window.backgroundColor = c; controller?.webView.underPageBackgroundColor = c }
      if let b = a["boot"] as? [String: Any] {
        let d = UserDefaults.standard
        if let m = b["mode"] as? String, ["auto", "dark", "light"].contains(m) { d.set(m, forKey: "boot.mode") }
        for k in ["dark", "light"] { if let h = b[k] as? String, WebController.color(hex: h) != nil { d.set(h, forKey: "boot.bg." + k) } }
      }
      return nil
    case "window.title":
      // 窗口标题（「窗口」菜单、调度中心里显示的）：当前标签页的
      controller?.window.title = String(((a["title"] as? String) ?? Config.appName).prefix(200))
      return nil
    case "menu.set":
      // 页面定的菜单（见 Menus.swift）；native：原生那几份（App 菜单、编辑、窗口）的字，跟着页面的语言（按动作认）
      controller?.menus.set(a["menus"] as? [[String: Any]] ?? [], native: a["native"] as? [String: String])
      return nil
    case "menu.popup":
      // 右键菜单、··· 菜单：系统的菜单（见 Menus.swift）；回选中那一项的 id（没选是 null）
      guard let c = controller else { return nil }
      let x = (a["x"] as? NSNumber)?.doubleValue ?? 0, y = (a["y"] as? NSNumber)?.doubleValue ?? 0
      return c.menus.popup(a["items"] as? [[String: Any]] ?? [], at: NSPoint(x: x, y: y), up: a["up"] as? Bool ?? false, end: a["end"] as? Bool ?? false, x2: (a["x2"] as? NSNumber).map { CGFloat($0.doubleValue) }, in: c.webView) ?? NSNull()
    case "page.snapshot":
      // 页面自己的一块现在的样子（macOS 风格：程序坞里最小化窗口的缩略图）：{ x, y, w, h, width? }（网页的坐标）→ JPEG 的 data URL
      guard let v = controller?.webView else { return nil }
      let n = { (k: String) in CGFloat((a[k] as? NSNumber)?.doubleValue ?? 0) }
      let cfg = WKSnapshotConfiguration()
      if n("w") > 0, n("h") > 0 { cfg.rect = CGRect(x: n("x"), y: n("y"), width: n("w"), height: n("h")) }
      if n("width") > 0 { cfg.snapshotWidth = NSNumber(value: Double(n("width"))) }
      cfg.afterScreenUpdates = false
      let img = try await v.takeSnapshot(configuration: cfg)
      guard let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
            let jpg = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.8]) else { return nil }
      return "data:image/jpeg;base64," + jpg.base64EncodedString()
    case "ui.stamp": // 本地界面（LocalUI.swift）：界面文件最近一次改动的时间；页面拿它提示「重新载入以更新」
      return ["stamp": LocalUI.stamp(), "dir": LocalUI.dir?.path ?? "", "local": controller?.localOn ?? false] as [String: Any]
    case "ui.source": // 设置 › 关于：界面从哪儿读——auto（本机那份不比网站上的旧才用它）/ site / local；页面随后重新载入
      if let s = a["source"] as? String, ["auto", "site", "local"].contains(s) { UserDefaults.standard.set(s, forKey: "uiSource") }
      return ["source": LocalUI.source, "dir": LocalUI.dir?.path ?? "", "local": controller?.localOn ?? false, "localBuild": LocalUI.localBuild()] as [String: Any]
    case "open.pending": // 在访达里用这个 App 打开的文件、文件夹（AppDelegate 记着的）：给页面，给完就清
      guard let d = NSApp.delegate as? AppDelegate else { return [String]() }
      let l = d.pendingOpen
      d.pendingOpen = []
      return l
    case "pdf.render":
      // 真的 PDF：页面给的 HTML 在看不见的 WebKit 里排版，macOS 的打印存成文件（见 PDF.swift）；print: true 弹打印对话框
      return try await PDF.render(a, base: controller?.webView.url, window: controller?.window)
    default:
      if let local, Local.commands.contains(cmd) { return try await local.runAsync(cmd, a) }
      if local != nil, RemoteHost.commands.contains(cmd) { return RemoteHost.shared.handle(cmd, a) } // iPad 使用这台 Mac（RemoteHost.swift）：设置页的开关、设备列表
      if SystemInfo.commands.contains(cmd) { return try await SystemInfo.run(cmd, a) }
      if let web, cmd == "web.snapshot" { return try await web.snapshot(a) }
      if let web, WebPanes.commands.contains(cmd) { return try web.run(cmd, a) }
      if let rdp, RdpPanes.commands.contains(cmd) { return try await rdp.run(cmd, a) }
      throw BridgeError(code: "E_UNKNOWN_CMD", message: "unknown command \"\(cmd)\" (known: \(Bridge.commands.joined(separator: ", ")))")
    }
  }

  // 系统通知：还没问过就先问（第一次会弹系统的对话框）；点了通知 → App 到前台、页面收到 notification-click
  private func notify(_ a: [String: Any]) async throws -> Any? {
    let c = UNUserNotificationCenter.current()
    if await c.notificationSettings().authorizationStatus == .notDetermined { _ = try? await c.requestAuthorization(options: [.alert, .sound, .badge]) }
    let st = await c.notificationSettings().authorizationStatus
    guard st == .authorized || st == .provisional else {
      throw BridgeError.permission("notifications are off for Paimon — run `native request notifications` (System Settings › Notifications › Paimon)")
    }
    let title = (a["title"] as? String) ?? "", body = (a["body"] as? String) ?? ""
    guard !title.isEmpty || !body.isEmpty else { throw BridgeError.args("notify { title, body } — at least one of them") }
    let id = (a["id"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? UUID().uuidString
    let content = UNMutableNotificationContent()
    content.title = title
    if let s = a["subtitle"] as? String { content.subtitle = s }
    content.body = body
    if a["sound"] as? Bool != false { content.sound = .default }
    var info: [String: Any] = ["id": id]
    if let d = a["data"], JSONSerialization.isValidJSONObject(["d": d]) { info["data"] = d }
    content.userInfo = info
    try await c.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
    return ["id": id]
  }
}
