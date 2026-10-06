// Menus.swift —— 页面定的菜单（Paimon Terminal 的 文件 / 显示 / 历史记录 / 帮助……）：页面经桥给一份（menu.set），原生照着搭进 macOS 的菜单栏；
// 点了（或按了快捷键、页面自己没接住）→ 告诉页面 menu.action { id }。App 菜单、编辑、窗口还是原生的（拷贝粘贴、全屏要原生做）。
// 菜单改了只要更新网页，不用重装 App
import AppKit

@MainActor
final class PageMenus: NSObject {
  weak var controller: WebController?
  private static var tops: [NSMenuItem] = [] // 几个窗口共用一条菜单栏：插进去的只有一份，谁在前面换成谁的
  private static var appItems: [NSMenuItem] = [] // 放进 App 菜单里的（「设置…」）
  private var last: [[String: Any]]?
  private var lastNative: [String: String]? // 原生那几份菜单（App 菜单、编辑、窗口）的字：页面按它的语言给
  // 这个窗口到前面了：换成它的菜单
  func reapply() { if let last { apply(last) } }

  // menus：[{ title, place: file（App 菜单后面）| help（最后）| 其他（窗口前面）, items: [{ id, title, key?, mods?: "cmd,shift,alt,ctrl", enabled?, checked?, sep?, items? }] }]
  func set(_ menus: [[String: Any]], native: [String: String]? = nil) {
    last = menus
    if let native { lastNative = native }
    // 只有在前面的那个窗口（或者一个窗口都不在前面时）改菜单栏
    let key = NSApp.keyWindow
    if let key, key !== controller?.window, key.delegate is WebController { return }
    apply(menus)
  }
  // 原生那几份菜单的字（中文写死在 AppDelegate 里）换成页面给的：键是动作（undo:、terminate:……），「#edit」「#window」「#services」是那几个菜单本身
  private static func retitle(_ t: [String: String], _ main: NSMenu) {
    let undo = Selector(("undo:"))
    func walk(_ m: NSMenu) {
      for it in m.items {
        if let a = it.action, let s = t[NSStringFromSelector(a)] { it.title = s }
        guard let sub = it.submenu else { continue }
        if sub === NSApp.servicesMenu { if let s = t["#services"] { it.title = s }; continue } // 服务菜单里是系统的
        if sub === NSApp.windowsMenu, let s = t["#window"] { it.title = s; sub.title = s }
        else if sub.items.contains(where: { $0.action == undo }), let s = t["#edit"] { it.title = s; sub.title = s }
        walk(sub)
      }
    }
    walk(main)
  }
  private func apply(_ menus: [[String: Any]]) {
    guard let main = NSApp.mainMenu else { return }
    if let n = lastNative { PageMenus.retitle(n, main) }
    PageMenus.tops.forEach { main.removeItem($0) }
    PageMenus.tops = []
    let appMenu = main.items.first?.submenu
    PageMenus.appItems.forEach { appMenu?.removeItem($0) }
    PageMenus.appItems = []
    for m in menus {
      // place: app —— 几项放进 App 菜单（关于下面，同 macOS 的「设置…」）
      if (m["place"] as? String) == "app", let appMenu {
        let tmp = NSMenu()
        tmp.autoenablesItems = false
        build(tmp, m["items"] as? [[String: Any]] ?? [])
        let items = tmp.items
        tmp.removeAllItems()
        var at = min(2, appMenu.items.count)
        for it in items + [NSMenuItem.separator()] { appMenu.insertItem(it, at: at); PageMenus.appItems.append(it); at += 1 }
        continue
      }
      let title = m["title"] as? String ?? ""
      let top = NSMenuItem(title: title, action: nil, keyEquivalent: "")
      let sub = NSMenu(title: title)
      sub.autoenablesItems = false
      build(sub, m["items"] as? [[String: Any]] ?? [])
      top.submenu = sub
      let win = main.items.firstIndex { $0.submenu != nil && $0.submenu === NSApp.windowsMenu } ?? main.items.count
      switch m["place"] as? String ?? "" {
      case "file": main.insertItem(top, at: min(1, main.items.count))
      case "help": main.addItem(top); NSApp.helpMenu = sub
      default: main.insertItem(top, at: win)
      }
      PageMenus.tops.append(top)
    }
  }

  private func build(_ menu: NSMenu, _ list: [[String: Any]]) {
    for it in list.prefix(200) {
      if it["sep"] as? Bool == true { menu.addItem(.separator()); continue }
      let mi = NSMenuItem(title: it["title"] as? String ?? "", action: #selector(pick(_:)), keyEquivalent: (it["key"] as? String).map { String($0.prefix(1)) } ?? "")
      mi.target = self
      mi.representedObject = it["id"] as? String
      if !mi.keyEquivalent.isEmpty {
        var mods: NSEvent.ModifierFlags = []
        for c in ((it["mods"] as? String) ?? "cmd").split(separator: ",") {
          switch c { case "cmd": mods.insert(.command); case "shift": mods.insert(.shift); case "alt": mods.insert(.option); case "ctrl": mods.insert(.control); default: break }
        }
        mi.keyEquivalentModifierMask = mods
      }
      mi.isEnabled = it["enabled"] as? Bool ?? true
      mi.state = it["checked"] as? Bool == true ? .on : .off
      // 菜单栏的菜单也能带图标（「历史记录」里每一条前面的 Claude / Codex 标志、地球）：同右键菜单
      if let sym = it["symbol"] as? String, !sym.isEmpty, let img = NSImage(systemSymbolName: sym, accessibilityDescription: nil) { mi.image = img }
      if let sv = it["svg"] as? String, !sv.isEmpty, let img = svgImage(sv, template: it["svgColor"] as? Bool != true) { mi.image = img }
      if let sub = it["items"] as? [[String: Any]] {
        let m = NSMenu(title: mi.title)
        m.autoenablesItems = false
        build(m, sub)
        mi.submenu = m
        mi.action = nil
      }
      menu.addItem(mi)
    }
  }

  @objc func pick(_ sender: NSMenuItem) {
    guard let id = sender.representedObject as? String else { return }
    controller?.emit("menu.action", ["id": id])
  }

  // ---- 右键菜单、··· 菜单（menu.popup）：页面给一棵菜单，这里用系统的菜单画、在那个位置弹出来；选了哪一项的 id 回给页面（没选是 null）。
  // 指着哪一项告诉页面（menu.highlight，页面拿它预览）。items：[{ id, title, key?, mods?, checked?, enabled?, sep?, symbol?（SF Symbols 的名字）, svg?（SVG 原文，盖过 symbol；svgColor 保留颜色）, file?（用这个文件 / App 的图标：「打开方式」）,
  //   dot?（"#rrggbb"：前面一个颜色圆点）, value?（右边一段灰字：现在选的是什么，如「状态  进行中 ›」）, items? }]；还有一种一整行的：{ dots: [{ id, color, on?, title? }] }——一排颜色圆点（访达右键的标签），点一个就是选了它
  private var picked: String?
  private let hl = PopupHighlight()
  // up：往上开（菜单的底边在 p）；end：右边对齐 p（按钮下面靠右的那种 ··· 菜单）
  private weak var openMenu: NSMenu?
  func popup(_ items: [[String: Any]], at p0: NSPoint, up: Bool = false, end: Bool = false, x2: CGFloat? = nil, in view: NSView) -> String? {
    // 已经开着一个（连着点了几下，这一下在上一个菜单弹出来之后才到）：关掉开着的那个，不再叠一个——菜单里再弹菜单会把 App 卡住
    if let om = openMenu { om.cancelTracking(); return nil }
    let m = NSMenu()
    openMenu = m
    defer { openMenu = nil }
    m.autoenablesItems = false
    m.appearance = view.window?.appearance // 跟着窗口（页面的深浅色），不跟系统
    buildPopup(m, items)
    hl.controller = controller
    m.delegate = hl
    picked = nil
    var p = p0
    if !up && !end && x2 == nil { p.x += 2; p.y += 3 } // 右键菜单：开在指针右下一点，松开右键不会误点中第一项
    if up { p.y -= m.size.height }
    if end { p.x -= m.size.width }
    if let x2, p.x + m.size.width > view.bounds.width - 4 { p.x = max(4, x2 - m.size.width) } // 优先往右展开；窗口右边放不下：靠右对齐
    var pt = view.isFlipped ? p : NSPoint(x: p.x, y: view.bounds.height - p.y)
    // 整个菜单放进屏幕能用的范围（菜单栏以下、程序坞以上）：往上开放不下就往下挪，不出系统的滚动箭头（左下角 ⚙ 的菜单以前总是被截掉一半）
    if let win = view.window, let scr = win.screen ?? NSScreen.main {
      let vf = scr.visibleFrame, h = m.size.height
      var top = win.convertPoint(toScreen: view.convert(pt, to: nil)) // 菜单左上角（屏幕坐标，y 往上）
      if top.y > vf.maxY { top.y = vf.maxY }
      if top.y - h < vf.minY { top.y = min(vf.maxY, vf.minY + h) }
      pt = view.convert(win.convertPoint(fromScreen: top), from: nil)
    }
    selfTest(m)
    m.popUp(positioning: nil, at: pt, in: view) // 菜单开着时在这里等（系统的做法），关了才往下走
    controller?.emit("menu.highlight", ["id": NSNull()])
    return picked
  }
  private func buildPopup(_ menu: NSMenu, _ list: [[String: Any]]) {
    var valued: [(NSMenuItem, String)] = []
    defer { rightValues(valued) }
    for it in list.prefix(300) {
      if it["sep"] as? Bool == true { menu.addItem(.separator()); continue }
      if let dots = it["dots"] as? [[String: Any]] {
        let mi = NSMenuItem()
        mi.view = DotsRow(dots, hl: hl) { [weak self, weak menu] id in
          self?.picked = id
          var top = menu
          while let sup = top?.supermenu { top = sup }
          top?.cancelTracking()
        }
        menu.addItem(mi)
        continue
      }
      let key = (it["key"] as? String).map { String($0.prefix(1)).lowercased() } ?? ""
      let mi = NSMenuItem(title: it["title"] as? String ?? "", action: #selector(popPick(_:)), keyEquivalent: key)
      mi.target = self
      mi.representedObject = it["id"] as? String
      if !key.isEmpty {
        var mods: NSEvent.ModifierFlags = []
        for c in ((it["mods"] as? String) ?? "cmd").split(separator: ",") {
          switch c { case "cmd": mods.insert(.command); case "shift": mods.insert(.shift); case "alt": mods.insert(.option); case "ctrl": mods.insert(.control); default: break }
        }
        mi.keyEquivalentModifierMask = mods
      }
      mi.isEnabled = it["enabled"] as? Bool ?? true
      mi.state = it["checked"] as? Bool == true ? .on : .off
      if let sym = it["symbol"] as? String, !sym.isEmpty, let img = NSImage(systemSymbolName: sym, accessibilityDescription: nil) { mi.image = img }
      if let s = it["svg"] as? String, !s.isEmpty, let img = svgImage(s, template: it["svgColor"] as? Bool != true) { mi.image = img } // 系统图标里没有的（Claude 的标志、经典 Macintosh）：页面给 SVG 原文
      if let f = it["file"] as? String, !f.isEmpty {
        let img = NSWorkspace.shared.icon(forFile: (f as NSString).expandingTildeInPath)
        img.size = NSSize(width: 16, height: 16)
        mi.image = img
      }
      if let hex = it["dot"] as? String, let img = dotImage(hex) { mi.image = img }
      if mi.image != nil, #available(macOS 27.0, *) { mi.preferredImageVisibility = .visible } // macOS 27 起系统默认把菜单里的图标藏起来：这里要显示
      if let v = it["value"] as? String, !v.isEmpty { valued.append((mi, v)) }
      if let sub = it["items"] as? [[String: Any]] {
        let m = NSMenu(title: mi.title)
        m.autoenablesItems = false
        m.delegate = hl
        buildPopup(m, sub)
        mi.submenu = m
        mi.action = nil
      }
      menu.addItem(mi)
    }
  }
  // 带 value 的几项：名字在左、value（灰）靠右，同一个菜单里的 value 右边对齐成一列
  private func rightValues(_ list: [(NSMenuItem, String)]) {
    guard !list.isEmpty else { return }
    let font = NSFont.menuFont(ofSize: 0)
    let w = { (s: String) in (s as NSString).size(withAttributes: [.font: font]).width }
    let at = max(150, list.map { w($0.0.title) + w($0.1) + 36 }.max() ?? 0)
    let ps = NSMutableParagraphStyle()
    ps.tabStops = [NSTextTab(textAlignment: .right, location: at)]
    for (mi, v) in list {
      let s = NSMutableAttributedString(string: mi.title + "\t", attributes: [.font: font, .paragraphStyle: ps])
      s.append(NSAttributedString(string: v, attributes: [.font: font, .paragraphStyle: ps, .foregroundColor: NSColor.secondaryLabelColor]))
      mi.attributedTitle = s
    }
  }
  @objc func popPick(_ sender: NSMenuItem) { picked = sender.representedObject as? String }
  // 自测（NADOS_TESTJS 在跑时）：菜单过一会儿自己关——NADOS_MENU_HL 给了就先当指着那一项，NADOS_MENU_PICK 给了就当选了那一项
  private func selfTest(_ m: NSMenu) {
    let env = ProcessInfo.processInfo.environment
    guard !(env["NADOS_TESTJS"] ?? "").isEmpty else { return }
    let hold = Double(env["NADOS_MENU_HOLD"] ?? "") ?? 2.5
    func find(_ menu: NSMenu, _ id: String) -> NSMenuItem? {
      for it in menu.items {
        if it.representedObject as? String == id { return it }
        if let sub = it.submenu, let hit = find(sub, id) { return hit }
      }
      return nil
    }
    let later = { (dt: Double, fn: @escaping @MainActor () -> Void) in
      let t = Timer(timeInterval: dt, repeats: false) { _ in MainActor.assumeIsolated { fn() } }
      RunLoop.current.add(t, forMode: .common)
    }
    if let id = env["NADOS_MENU_HL"], let it = find(m, id) { later(hold * 0.4) { [weak self] in self?.hl.menu(m, willHighlight: it) } }
    later(hold) { [weak self] in
      if let id = env["NADOS_MENU_PICK"], find(m, id) != nil { self?.picked = id }
      m.cancelTracking()
    }
  }
}

// 页面给的 SVG 原文 → 菜单里的图标（16pt）。默认是模板图：同 SF Symbols，跟着菜单的深浅色、选中时变白；svgColor 的保留原来的颜色
@MainActor
func svgImage(_ s: String, template: Bool, size: CGFloat = 16) -> NSImage? {
  guard let d = s.data(using: .utf8), let img = NSImage(data: d), img.isValid else { return nil }
  img.size = NSSize(width: size, height: size)
  img.isTemplate = template
  return img
}

// "#rrggbb" → 一个实心的小圆点（标签的颜色）
@MainActor
func dotImage(_ hex: String, size: CGFloat = 12, ring: Bool = false) -> NSImage? {
  var s = hex.trimmingCharacters(in: .whitespaces)
  if s.hasPrefix("#") { s.removeFirst() }
  guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
  let c = NSColor(srgbRed: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1)
  return NSImage(size: NSSize(width: size, height: size), flipped: false) { r in
    c.setFill()
    NSBezierPath(ovalIn: r.insetBy(dx: 1, dy: 1)).fill()
    if ring { NSColor.white.withAlphaComponent(0.9).setStroke(); let p = NSBezierPath(ovalIn: r.insetBy(dx: 3.5, dy: 3.5)); p.lineWidth = 1.5; p.stroke() }
    return true
  }
}

// 一排颜色圆点（访达右键菜单里的标签）：指着的那个大一点、写出名字；已经打上的标签带白圈
@MainActor
final class DotsRow: NSView {
  private let dots: [[String: Any]]
  private let pick: (String) -> Void
  private weak var hl: PopupHighlight?
  private var hover = -1
  private let d: CGFloat = 16, gap: CGFloat = 7, pad: CGFloat = 14
  init(_ dots: [[String: Any]], hl: PopupHighlight?, pick: @escaping (String) -> Void) {
    self.dots = Array(dots.prefix(12))
    self.pick = pick
    self.hl = hl
    super.init(frame: NSRect(x: 0, y: 0, width: pad * 2 + CGFloat(max(1, dots.count)) * (16 + 7) - 7, height: 26))
    addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
  }
  required init?(coder: NSCoder) { fatalError() }
  private func rect(_ i: Int) -> NSRect { NSRect(x: pad + CGFloat(i) * (d + gap), y: (bounds.height - d) / 2, width: d, height: d) }
  private func index(_ e: NSEvent) -> Int { let p = convert(e.locationInWindow, from: nil); return (0..<dots.count).first { rect($0).insetBy(dx: -gap / 2, dy: -4).contains(p) } ?? -1 }
  override func mouseMoved(with e: NSEvent) { let i = index(e); if i != hover { hover = i; needsDisplay = true; hl?.controller?.emit("menu.highlight", ["id": i >= 0 ? (dots[i]["id"] as? String ?? "") : NSNull()]) } }
  override func mouseExited(with e: NSEvent) { hover = -1; needsDisplay = true }
  override func mouseUp(with e: NSEvent) { let i = index(e); if i >= 0, let id = dots[i]["id"] as? String { pick(id) } }
  override func draw(_ dirty: NSRect) {
    for (i, x) in dots.enumerated() {
      let r = rect(i).insetBy(dx: i == hover ? -1.5 : 0, dy: i == hover ? -1.5 : 0)
      if let img = dotImage(x["color"] as? String ?? "#8e8e93", size: r.width, ring: x["on"] as? Bool == true) { img.draw(in: r) }
    }
    toolTip = hover >= 0 ? dots[hover]["title"] as? String : nil
  }
}

// 右键菜单里指着哪一项：告诉页面（预览）
@MainActor
final class PopupHighlight: NSObject, NSMenuDelegate {
  weak var controller: WebController?
  func menu(_ menu: NSMenu, willHighlight item: NSMenuItem?) {
    controller?.emit("menu.highlight", ["id": (item?.representedObject as? String) ?? NSNull()])
  }
}
