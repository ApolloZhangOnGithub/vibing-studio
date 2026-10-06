// Screenshot.swift —— 截真的屏幕（ScreenCaptureKit）：整块显示器，可以不带 Paimon 自己的窗口；没有屏幕录制权限就报清楚的错（不偷偷弹框）
import AppKit
import ScreenCaptureKit

enum Screenshot {
  // args：display（第几块屏，0 起，默认主屏）、maxWidth（像素，超过就等比缩小）、format（png | jpeg）、quality（jpeg 0–1）、excludeSelf（不拍 Paimon 自己的窗口）
  static func capture(_ args: [String: Any]) async throws -> [String: Any] {
    guard CGPreflightScreenCaptureAccess() else {
      throw BridgeError.permission("Screen Recording isn't allowed for Paimon yet — run `native request screen` (System Settings › Privacy & Security › Screen & System Audio Recording), then reopen Paimon")
    }
    let content: SCShareableContent
    do { content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true) }
    catch { throw BridgeError.permission("Screen Recording is blocked: \(error.localizedDescription)") }
    let displays = content.displays.filter { $0.displayID == CGMainDisplayID() } + content.displays.filter { $0.displayID != CGMainDisplayID() } // 主屏排第一
    guard !displays.isEmpty else { throw BridgeError.failed("no display to capture") }
    var idx = 0
    if let d = args["display"] as? Int { idx = d } else if let d = args["display"] as? Double { idx = Int(d) }
    guard idx >= 0 && idx < displays.count else { throw BridgeError.args("display \(idx) doesn't exist (there \(displays.count == 1 ? "is 1 display" : "are \(displays.count) displays"), 0 is the main one)") }
    let display = displays[idx]
    let format = (args["format"] as? String ?? "png").lowercased()
    guard format == "png" || format == "jpeg" || format == "jpg" else { throw BridgeError.args("format is png or jpeg") }

    var excluded: [SCRunningApplication] = []
    if args["excludeSelf"] as? Bool == true { excluded = content.applications.filter { $0.processID == ProcessInfo.processInfo.processIdentifier } }
    let filter = SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: [])
    let scale = NSScreen.screens.first { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == display.displayID }?.backingScaleFactor ?? 2
    var w = Double(display.width) * scale, h = Double(display.height) * scale
    if let mw = (args["maxWidth"] as? Double) ?? (args["maxWidth"] as? Int).map(Double.init), mw >= 16, w > mw { h = h * mw / w; w = mw }
    let cfg = SCStreamConfiguration()
    cfg.width = Int(w.rounded())
    cfg.height = Int(h.rounded())
    cfg.showsCursor = false
    let img: CGImage
    do { img = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: cfg) }
    catch { throw BridgeError.failed("capture failed: \(error.localizedDescription)") }

    let rep = NSBitmapImageRep(cgImage: img)
    let jpeg = format != "png"
    let q = (args["quality"] as? Double) ?? 0.85
    guard let data = rep.representation(using: jpeg ? .jpeg : .png, properties: jpeg ? [.compressionFactor: max(0.1, min(1, q))] : [:]) else { throw BridgeError.failed("couldn't encode the picture") }
    return [
      "dataURL": "data:image/\(jpeg ? "jpeg" : "png");base64," + data.base64EncodedString(),
      "width": img.width, "height": img.height,
      "points": ["width": display.width, "height": display.height],
      "display": idx, "displays": displays.count,
    ]
  }
}
