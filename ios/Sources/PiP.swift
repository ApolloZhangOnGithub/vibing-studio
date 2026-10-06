// PiP.swift —— 画中画：把会话的状态做成一小块画面浮在别的 App 上面（同视频的画中画）。
//   画面是这里自己画的（不是网页）：最要紧的那个会话（等你的优先，其次最近开始跑的）叫什么、在跑还是在等你、在干什么、用时、一共几个在跑几个在等你；
//   每秒重画一张交给 AVSampleBufferDisplayLayer。状态由页面报（vsisland.js，同灵动岛那一份）；切到别的 App 时自动浮出来
import AVKit
import UIKit

@MainActor
final class PiPController: NSObject, AVPictureInPictureControllerDelegate, AVPictureInPictureSampleBufferPlaybackDelegate {
  static let shared = PiPController()
  private let host = UIView(frame: CGRect(x: 0, y: 0, width: 4, height: 4))
  private let display = AVSampleBufferDisplayLayer()
  private var pip: AVPictureInPictureController?
  private var timer: Timer?
  private var st: [String: Any] = [:]
  private let size = CGSize(width: 1600, height: 900) // 画中画窗口（3 倍屏）多大都不糊：按 1600×900 画

  // 窗口里放一块几乎看不见的小画面（画中画要有一块在屏幕上的源）
  func attach(to view: UIView) {
    guard AVPictureInPictureController.isPictureInPictureSupported(), host.superview == nil else { return }
    host.isUserInteractionEnabled = false
    host.alpha = 0.02
    view.addSubview(host)
    display.frame = host.bounds
    display.videoGravity = .resizeAspect
    host.layer.addSublayer(display)
    try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers]) // 不打断你正在放的音乐
    try? AVAudioSession.sharedInstance().setActive(true)
    let c = AVPictureInPictureController(contentSource: .init(sampleBufferDisplayLayer: display, playbackDelegate: self))
    c.delegate = self
    c.canStartPictureInPictureAutomaticallyFromInline = true // 切到别的 App 时自动浮出来
    pip = c
    render()
    timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.render() } }
  }

  func update(_ m: [String: Any]) { st = m; render() }
  func toggle() { guard let c = pip else { return }; if c.isPictureInPictureActive { c.stopPictureInPicture() } else { c.startPictureInPicture() } }

  // ---- 画一张 ----
  private func render() {
    guard host.superview != nil else { return }
    let state = (st["state"] as? String) ?? "idle", name = (st["name"] as? String) ?? "", detail = (st["detail"] as? String) ?? ""
    let working = (st["working"] as? NSNumber)?.intValue ?? 0, waiting = (st["waiting"] as? NSNumber)?.intValue ?? 0
    let since = Date(timeIntervalSince1970: ((st["since"] as? NSNumber)?.doubleValue ?? Date().timeIntervalSince1970 * 1000) / 1000)
    let tint = state == "waiting" ? UIColor(red: 0.039, green: 0.518, blue: 1, alpha: 1) : state == "working" ? UIColor(red: 0.851, green: 0.467, blue: 0.341, alpha: 1) : UIColor(white: 0.6, alpha: 1)
    let k: CGFloat = size.width / 640 // 下面按 640 宽排的，整体放大
    let img = UIGraphicsImageRenderer(size: size, format: { let f = UIGraphicsImageRendererFormat(); f.scale = 1; f.opaque = true; return f }()).image { ctx in
      ctx.cgContext.scaleBy(x: k, y: k)
      UIColor(red: 0.11, green: 0.11, blue: 0.12, alpha: 1).setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 640, height: 360))
      if let logo = UIImage(named: "ClaudeLogo")?.withTintColor(tint, renderingMode: .alwaysOriginal) { logo.draw(in: CGRect(x: 40, y: 40, width: 56, height: 56)) }
      let stateText = state == "waiting" ? "等你选择" : state == "working" ? "工作中" : "空闲"
      let draw = { (s: String, font: UIFont, color: UIColor, rect: CGRect) in
        let p = NSMutableParagraphStyle(); p.lineBreakMode = .byTruncatingTail
        (s as NSString).draw(with: rect, options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine], attributes: [.font: font, .foregroundColor: color, .paragraphStyle: p], context: nil)
      }
      draw(stateText, .systemFont(ofSize: 34, weight: .semibold), tint, CGRect(x: 116, y: 44, width: 300, height: 46))
      if state != "idle" {
        let secs = max(0, Int(Date().timeIntervalSince(since))), t = secs >= 3600 ? String(format: "%d:%02d:%02d", secs / 3600, secs / 60 % 60, secs % 60) : String(format: "%d:%02d", secs / 60, secs % 60)
        draw(t, .monospacedDigitSystemFont(ofSize: 34, weight: .medium), .white, CGRect(x: 440, y: 44, width: 160, height: 46))
      }
      // 名字一行小字，下面是内容：它最近说的话、在跑的命令（最新的那行最亮）
      draw(name.isEmpty ? "Vibing Studio" : name, .systemFont(ofSize: 26, weight: .semibold), UIColor(white: 0.85, alpha: 1), CGRect(x: 116, y: 92, width: 480, height: 34))
      let lines = (st["lines"] as? [String]) ?? (detail.isEmpty ? [] : [detail])
      if lines.isEmpty { draw(state == "idle" ? "没有会话在跑" : "", .systemFont(ofSize: 28), UIColor(white: 0.72, alpha: 1), CGRect(x: 40, y: 150, width: 560, height: 40)) }
      var y: CGFloat = 140
      for (i, l) in lines.prefix(3).enumerated() { // 最新的在最上面、最大最亮
        let first = i == 0, h: CGFloat = first ? 80 : 36
        draw(l, .systemFont(ofSize: first ? 30 : 22, weight: first ? .medium : .regular), first ? .white : UIColor(white: 0.6, alpha: 1), CGRect(x: 40, y: y, width: 560, height: h))
        y += h + 6
      }
      var c: [String] = []
      if working > 0 { c.append("\(working) 个在跑") }
      if waiting > 0 { c.append("\(waiting) 个等你") }
      draw(c.joined(separator: " · "), .systemFont(ofSize: 22), UIColor(white: 0.55, alpha: 1), CGRect(x: 40, y: 322, width: 560, height: 30))
    }
    if let sb = Self.sampleBuffer(img) { if display.status == .failed { display.flush() }; display.enqueue(sb) }
  }

  private static func sampleBuffer(_ img: UIImage) -> CMSampleBuffer? {
    guard let cg = img.cgImage else { return nil }
    let w = cg.width, h = cg.height
    var pb: CVPixelBuffer?
    let attrs = [kCVPixelBufferCGImageCompatibilityKey: true, kCVPixelBufferCGBitmapContextCompatibilityKey: true, kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary] as CFDictionary
    guard CVPixelBufferCreate(kCFAllocatorDefault, w, h, kCVPixelFormatType_32BGRA, attrs, &pb) == kCVReturnSuccess, let buf = pb else { return nil }
    CVPixelBufferLockBaseAddress(buf, [])
    if let ctx = CGContext(data: CVPixelBufferGetBaseAddress(buf), width: w, height: h, bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buf), space: CGColorSpaceCreateDeviceRGB(),
                           bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue) {
      ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
    }
    CVPixelBufferUnlockBaseAddress(buf, [])
    var fmt: CMVideoFormatDescription?
    guard CMVideoFormatDescriptionCreateForImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: buf, formatDescriptionOut: &fmt) == noErr, let f = fmt else { return nil }
    var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 1), presentationTimeStamp: CMClockGetTime(CMClockGetHostTimeClock()), decodeTimeStamp: .invalid)
    var out: CMSampleBuffer?
    guard CMSampleBufferCreateReadyWithImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: buf, formatDescription: f, sampleTiming: &timing, sampleBufferOut: &out) == noErr, let sb = out else { return nil }
    if let arr = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: true), CFArrayGetCount(arr) > 0 {
      let d = unsafeBitCast(CFArrayGetValueAtIndex(arr, 0), to: CFMutableDictionary.self)
      CFDictionarySetValue(d, Unmanaged.passUnretained(kCMSampleAttachmentKey_DisplayImmediately).toOpaque(), Unmanaged.passUnretained(kCFBooleanTrue).toOpaque())
    }
    return sb
  }

  // ---- 画中画要的「播放」那几样：一直在播、没有总长、不能快进 ----
  nonisolated func pictureInPictureController(_ c: AVPictureInPictureController, setPlaying playing: Bool) {}
  nonisolated func pictureInPictureControllerTimeRangeForPlayback(_ c: AVPictureInPictureController) -> CMTimeRange { CMTimeRange(start: .negativeInfinity, duration: .positiveInfinity) }
  nonisolated func pictureInPictureControllerIsPlaybackPaused(_ c: AVPictureInPictureController) -> Bool { false }
  nonisolated func pictureInPictureController(_ c: AVPictureInPictureController, didTransitionToRenderSize newRenderSize: CMVideoDimensions) {}
  nonisolated func pictureInPictureController(_ c: AVPictureInPictureController, skipByInterval skipInterval: CMTime, completion completionHandler: @escaping () -> Void) { completionHandler() }
}
