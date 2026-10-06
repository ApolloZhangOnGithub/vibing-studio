// WebView.swift —— WKWebView 多一样：Paimon Terminal 里从访达、截图的缩略图拖文件进来 = 把路径交给页面，贴进鼠标下面那个终端（同「终端」、iTerm；
// Claude Code 认图片路径：拖张截图进来就是附图）。页面自己里面的拖（标签页、窗格）、网页桌面里的拖都照旧交给 WebKit
import AppKit
import WebKit

final class WebView: WKWebView {
  var onFiles: (([String], NSPoint) -> Void)? // 路径；落点（页面坐标：左上角为原点）
  private var mine = false

  private func files(_ info: NSDraggingInfo) -> [String]? {
    guard onFiles != nil, info.draggingSource == nil else { return nil } // 别的 App 拖来的才管
    let urls = info.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL] ?? []
    return urls.isEmpty ? nil : urls.map { $0.path }
  }
  override func draggingEntered(_ info: NSDraggingInfo) -> NSDragOperation {
    mine = files(info) != nil
    return mine ? .copy : super.draggingEntered(info)
  }
  override func draggingUpdated(_ info: NSDraggingInfo) -> NSDragOperation { mine ? .copy : super.draggingUpdated(info) }
  override func draggingExited(_ info: NSDraggingInfo?) { if mine { mine = false } else { super.draggingExited(info) } }
  override func prepareForDragOperation(_ info: NSDraggingInfo) -> Bool { mine || super.prepareForDragOperation(info) }
  override func performDragOperation(_ info: NSDraggingInfo) -> Bool {
    guard mine, let paths = files(info) else { return super.performDragOperation(info) }
    let p = convert(info.draggingLocation, from: nil)
    onFiles?(paths, NSPoint(x: p.x, y: isFlipped ? p.y : bounds.height - p.y))
    return true
  }
  override func concludeDragOperation(_ info: NSDraggingInfo?) { if mine { mine = false } else { super.concludeDragOperation(info) } }
}
