// DesktopWindow.swift —— 装网页桌面的那个窗口：没有标题栏（网页自己画了菜单栏），菜单栏里空着的地方当标题栏用；⌘Q / ⌘H 归原生，别的 ⌘ 组合都给网页
import AppKit

final class DesktopWindow: NSWindow {
  // 网页报上来的拖动区（CSS 像素，左上角为原点；页面不缩放时 = 窗口里的点）
  var dragRegions: [NSRect] = []

  override func sendEvent(_ event: NSEvent) {
    if event.type == .leftMouseDown, !styleMask.contains(.fullScreen), let cv = contentView, !dragRegions.isEmpty {
      let p = event.locationInWindow, top = NSPoint(x: p.x, y: cv.bounds.height - p.y)
      if dragRegions.contains(where: { $0.contains(top) }) {
        if event.clickCount == 2 { titlebarDoubleClick() } else { performDrag(with: event) }
        return
      }
    }
    super.sendEvent(event)
  }

  // 同 macOS：双击标题栏按「系统设置 › 桌面与程序坞」里选的来（缩放 / 最小化 / 不动）
  private func titlebarDoubleClick() {
    switch UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") ?? "Maximize" {
    case "Minimize": miniaturize(nil)
    case "None": break
    default: zoom(nil)
    }
  }

  // 网页先拿到按键（WKWebView 会把没用掉的再交给菜单）；只有退出、隐藏不让网页拦
  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    let m = event.modifierFlags.intersection(.deviceIndependentFlagsMask).subtracting([.capsLock, .numericPad, .function])
    switch (event.charactersIgnoringModifiers?.lowercased() ?? "", m) {
    case ("q", [.command]): NSApp.terminate(nil); return true
    case ("h", [.command]): NSApp.hide(nil); return true
    case ("h", [.command, .option]): NSApp.hideOtherApplications(nil); return true
    default: return super.performKeyEquivalent(with: event)
    }
  }
}
