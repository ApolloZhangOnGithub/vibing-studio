// ScreenShare.swift —— 用另一台 Mac 的屏幕（Mac 对 Mac 的远程桌面，同 TeamViewer）：两边都是 Vibing Studio，不用系统的「屏幕共享」、不用那台的开机密码。
//   那台（ScreenHost，RemoteHost 收到 screen.* 调用交给这里）：ScreenCaptureKit 截屏（屏幕不动就不出新帧）→ VideoToolbox 硬件编码 H.264
//     （低延迟码率控制、不带 B 帧）→ 一帧一条 screen.frame 事件经中转送给开它的那台设备（路上压着的多了就先不编，不攒延迟）；
//     那边送来的键盘鼠标（screen.input，屏幕上的位置是 0~1）用 CGEvent 发进这台的系统。
//     要这台 Mac 允许「屏幕录制」「辅助功能」：第一次用时这台上弹系统的框（签名固定，更新以后不用再给）
//   这台（ScreenPanes / ScreenView，页面在 ui/studio/macdesk.js）：页面给位置，这边叠一个视图——AVSampleBufferDisplayLayer 硬件解码、画出来；
//     键盘鼠标按那台屏幕上的位置送回页面，页面经中转送过去。能分到单独的窗口、全屏，能暂停（那台停止截屏、编码）
//   自动测试：NADOS_SCREEN_FAKE=1 不截屏，画一张会动的测试图；NADOS_SCREEN_INPUT_LOG=<文件> 不真发键盘鼠标，记进文件
import AppKit
import AVFoundation
import CoreMedia
import ScreenCaptureKit
import VideoToolbox

// MARK: - 那台：截屏、编码、送出去；收键盘鼠标
@MainActor
final class ScreenHost {
  static let shared = ScreenHost()
  static let commands: Set<String> = ["screen.start", "screen.stop", "screen.input", "screen.pause", "screen.opts", "screen.key"]
  private var caps: [String: ScreenCap] = [:] // 页面给的编号 → 一路截屏
  // RemoteHost 给：把一条事件送给那台设备（送完回调——数在路上的帧）
  var send: ((_ to: String, _ msg: [String: Any], _ done: @escaping @Sendable () -> Void) -> Void)?

  func run(_ cmd: String, _ a: [String: Any], from: String) async throws -> Any? {
    let id = a["id"] as? String ?? ""
    guard !id.isEmpty, id.count <= 64 else { throw BridgeError.args("\(cmd) { id }") }
    switch cmd {
    case "screen.start":
      caps.removeValue(forKey: id)?.stop()
      let env = ProcessInfo.processInfo.environment
      let fake = env["NADOS_SCREEN_FAKE"] == "1"
      if !fake && !CGPreflightScreenCaptureAccess() {
        _ = CGRequestScreenCaptureAccess() // 这台上弹系统的框（拒绝过的话打开系统设置那一页）
        throw BridgeError(code: "E_PERM_SCREEN", message: "那台 Mac 还没允许 Vibing Studio「屏幕录制」")
      }
      let c = ScreenCap(id: id, to: from, fake: fake, inputLog: env["NADOS_SCREEN_INPUT_LOG"])
      c.apply(a)
      caps[id] = c
      do { return try await c.start { [weak self] to, msg, done in self?.send?(to, msg, done) } }
      catch { caps[id] = nil; throw BridgeError(code: "E_SCREEN", message: "截屏没能开始：\(error.localizedDescription)") }
    case "screen.stop":
      caps.removeValue(forKey: id)?.stop()
      return nil
    case "screen.pause":
      caps[id]?.setPaused(a["on"] as? Bool ?? true)
      return nil
    case "screen.opts":
      guard let c = caps[id] else { return nil }
      c.apply(a)
      try await c.reconfigure()
      return c.info
    case "screen.key":
      caps[id]?.forceKey()
      return nil
    case "screen.input":
      return caps[id]?.input(a["ev"] as? [[String: Any]] ?? [])
    default:
      return nil
    }
  }
  // 那台设备走了（关了窗口、断了）：它开的截屏都停
  func stopAll(for cid: String) { for (k, c) in caps where c.to == cid { c.stop(); caps[k] = nil } }
}

final class ScreenCap: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
  let id: String, to: String, fake: Bool, inputLog: String?
  private let q = DispatchQueue(label: "vibing.screen.cap", qos: .userInteractive)
  private let lock = NSLock()
  private var stream: SCStream?
  private var vt: VTCompressionSession?
  private var fakeTimer: DispatchSourceTimer?
  private var sender: ((String, [String: Any], @escaping @Sendable () -> Void) -> Void)?
  // 下面这些改的时候都拿着 lock
  private var inflight = 0, needKey = true, paused = false, stopped = false
  private(set) var fps = 30, bitrate = 8_000_000, maxW = 2560
  private(set) var w = 0, h = 0
  private var disp = CGRect(x: 0, y: 0, width: 1440, height: 900) // 截的那块屏幕在全局坐标里（点）：键盘鼠标按它换算
  private var dispID: CGDirectDisplayID = CGMainDisplayID()
  private var frameNo: Int64 = 0
  // 键盘鼠标
  private var downButtons = Set<Int>()
  private var axAsked = false
  private var last = CGPoint.zero

  init(id: String, to: String, fake: Bool, inputLog: String?) { self.id = id; self.to = to; self.fake = fake; self.inputLog = inputLog }

  var info: [String: Any] { ["w": w, "h": h, "dw": disp.width, "dh": disp.height, "fps": fps, "bitrate": bitrate, "ax": inputLog != nil || AXIsProcessTrusted(), "fake": fake] }

  func apply(_ a: [String: Any]) {
    lock.lock(); defer { lock.unlock() }
    if let f = (a["fps"] as? NSNumber)?.intValue, (1...120).contains(f) { fps = f }
    if let b = (a["bitrate"] as? NSNumber)?.intValue, (500_000...80_000_000).contains(b) { bitrate = b }
    if let m = (a["maxW"] as? NSNumber)?.intValue, (320...7680).contains(m) { maxW = m }
  }

  func start(_ send: @escaping (String, [String: Any], @escaping @Sendable () -> Void) -> Void) async throws -> [String: Any] {
    sender = send
    if fake {
      w = min(maxW, 640) & ~1; h = (w * 9 / 16) & ~1
      makeEncoder()
      startFake()
      return info
    }
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    guard let d = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) ?? content.displays.first else { throw BridgeError(code: "E_SCREEN", message: "没有显示器") }
    dispID = d.displayID
    disp = CGDisplayBounds(dispID)
    // 像素大小（视网膜屏是点的两倍），宽过上限就等比缩小
    var pw = CGDisplayCopyDisplayMode(dispID).map { $0.pixelWidth } ?? Int(disp.width * 2), ph = CGDisplayCopyDisplayMode(dispID).map { $0.pixelHeight } ?? Int(disp.height * 2)
    if pw > maxW { ph = ph * maxW / pw; pw = maxW }
    w = pw & ~1; h = ph & ~1
    makeEncoder()
    let s = SCStream(filter: SCContentFilter(display: d, excludingApplications: [], exceptingWindows: []), configuration: streamConfig(), delegate: self)
    try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: q)
    try await s.startCapture()
    stream = s
    return info
  }
  private func streamConfig() -> SCStreamConfiguration {
    let c = SCStreamConfiguration()
    c.width = w; c.height = h
    c.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
    c.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
    c.showsCursor = true
    c.queueDepth = 4
    return c
  }
  // 改了帧率、码率、清晰度：截屏、编码器按新的来，下一帧是关键帧
  func reconfigure() async throws {
    if fake { lock.lock(); let ow = w; lock.unlock(); let nw = min(maxW, 640) & ~1; if nw != ow { w = nw; h = (nw * 9 / 16) & ~1 }; makeEncoder(); startFake(); return }
    var pw = CGDisplayCopyDisplayMode(dispID).map { $0.pixelWidth } ?? w, ph = CGDisplayCopyDisplayMode(dispID).map { $0.pixelHeight } ?? h
    if pw > maxW { ph = ph * maxW / pw; pw = maxW }
    w = pw & ~1; h = ph & ~1
    makeEncoder()
    try await stream?.updateConfiguration(streamConfig())
  }

  func stop() {
    lock.lock(); stopped = true; lock.unlock()
    fakeTimer?.cancel(); fakeTimer = nil
    if let s = stream { stream = nil; s.stopCapture { _ in } }
    if let v = vt { vt = nil; VTCompressionSessionInvalidate(v) }
    releaseButtons()
  }
  // 暂停：不截、不编、不发（连接留着）；继续时先来一个关键帧
  func setPaused(_ on: Bool) {
    lock.lock(); paused = on; if !on { needKey = true }; lock.unlock()
    if fake { return }
    if on { stream?.stopCapture { _ in } } else { stream?.startCapture { _ in } }
    if on { releaseButtons() }
  }
  func forceKey() { lock.lock(); needKey = true; lock.unlock() }

  private func makeEncoder() {
    if let v = vt { VTCompressionSessionInvalidate(v); vt = nil }
    var s: VTCompressionSession?
    let spec = [kVTVideoEncoderSpecification_EnableLowLatencyRateControl: kCFBooleanTrue!] as CFDictionary
    guard VTCompressionSessionCreate(allocator: nil, width: Int32(w), height: Int32(h), codecType: kCMVideoCodecType_H264, encoderSpecification: spec, imageBufferAttributes: nil,
                                     compressedDataAllocator: nil, outputCallback: nil, refcon: nil, compressionSessionOut: &s) == noErr, let s else { return }
    VTSessionSetProperty(s, key: kVTCompressionPropertyKey_RealTime, value: kCFBooleanTrue)
    VTSessionSetProperty(s, key: kVTCompressionPropertyKey_AllowFrameReordering, value: kCFBooleanFalse)
    VTSessionSetProperty(s, key: kVTCompressionPropertyKey_ProfileLevel, value: kVTProfileLevel_H264_High_AutoLevel)
    VTSessionSetProperty(s, key: kVTCompressionPropertyKey_AverageBitRate, value: bitrate as CFNumber)
    VTSessionSetProperty(s, key: kVTCompressionPropertyKey_ExpectedFrameRate, value: fps as CFNumber)
    VTSessionSetProperty(s, key: kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, value: 10 as CFNumber)
    VTCompressionSessionPrepareToEncodeFrames(s)
    vt = s
    lock.lock(); needKey = true; lock.unlock()
  }

  // 截到的一帧（屏幕没变的不出完整帧）
  func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .screen, sb.isValid, let px = CMSampleBufferGetImageBuffer(sb),
          let atts = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
          let raw = atts.first?[.status] as? Int, SCFrameStatus(rawValue: raw) == .complete else { return }
    encode(px, pts: CMSampleBufferGetPresentationTimeStamp(sb))
  }
  func stream(_ stream: SCStream, didStopWithError error: Error) {
    let msg: [String: Any] = ["ev": "screen.end", "detail": ["id": id, "msg": error.localizedDescription]]
    let to = self.to
    DispatchQueue.main.async { MainActor.assumeIsolated { ScreenHost.shared.send?(to, msg) {} } }
  }

  private func encode(_ px: CVPixelBuffer, pts: CMTime) {
    lock.lock()
    let skip = paused || stopped || inflight > 3, key = needKey && !skip
    if key { needKey = false }
    lock.unlock()
    guard !skip, let vt else { return } // 路上压着的帧多了：这一帧不编（不攒延迟；编出来的帧一帧不丢，解码接得上）
    let props: CFDictionary? = key ? [kVTEncodeFrameOptionKey_ForceKeyFrame: kCFBooleanTrue!] as CFDictionary : nil
    VTCompressionSessionEncodeFrame(vt, imageBuffer: px, presentationTimeStamp: pts, duration: .invalid, frameProperties: props, infoFlagsOut: nil) { [weak self] status, _, out in
      guard status == noErr, let out, let self else { return }
      self.emit(out)
    }
  }

  // 编好的一帧：AVCC（每个 NAL 前面 4 字节长度）；关键帧带上 SPS、PPS
  private func emit(_ sb: CMSampleBuffer) {
    guard let bb = CMSampleBufferGetDataBuffer(sb) else { return }
    var total = 0
    var ptr: UnsafeMutablePointer<CChar>?
    guard CMBlockBufferGetDataPointer(bb, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &total, dataPointerOut: &ptr) == kCMBlockBufferNoErr, let ptr, total > 0 else { return }
    let data = Data(bytes: ptr, count: total)
    let atts = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false) as? [[CFString: Any]]
    let isKey = !((atts?.first?[kCMSampleAttachmentKey_NotSync] as? Bool) ?? false)
    var d: [String: Any] = ["id": id, "b64": data.base64EncodedString(), "k": isKey, "w": w, "h": h]
    if isKey, let fd = CMSampleBufferGetFormatDescription(sb) {
      var n = 0
      CMVideoFormatDescriptionGetH264ParameterSetAtIndex(fd, parameterSetIndex: 0, parameterSetPointerOut: nil, parameterSetSizeOut: nil, parameterSetCountOut: &n, nalUnitHeaderLengthOut: nil)
      var sets: [String] = []
      for i in 0..<n {
        var p: UnsafePointer<UInt8>?
        var len = 0
        if CMVideoFormatDescriptionGetH264ParameterSetAtIndex(fd, parameterSetIndex: i, parameterSetPointerOut: &p, parameterSetSizeOut: &len, parameterSetCountOut: nil, nalUnitHeaderLengthOut: nil) == noErr, let p { sets.append(Data(bytes: p, count: len).base64EncodedString()) }
      }
      d["ps"] = sets
    }
    lock.lock(); inflight += 1; lock.unlock()
    let msg: [String: Any] = ["ev": "screen.frame", "detail": d]
    nonisolated(unsafe) let m = msg
    let to = self.to, send = sender
    DispatchQueue.main.async { send?(to, m) { [weak self] in self?.sent() } }
  }
  private func sent() { lock.lock(); inflight = max(0, inflight - 1); lock.unlock() }

  // ---- 测试图：一条竖着的亮条从左往右走 ----
  private func startFake() {
    fakeTimer?.cancel()
    let t = DispatchSource.makeTimerSource(queue: q)
    t.schedule(deadline: .now(), repeating: .milliseconds(1000 / max(1, fps)))
    t.setEventHandler { [weak self] in self?.fakeFrame() }
    fakeTimer = t
    t.resume()
  }
  private func fakeFrame() {
    var px: CVPixelBuffer?
    CVPixelBufferCreate(nil, w, h, kCVPixelFormatType_32BGRA, [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &px)
    guard let px else { return }
    CVPixelBufferLockBaseAddress(px, [])
    if let base = CVPixelBufferGetBaseAddress(px)?.assumingMemoryBound(to: UInt8.self) {
      let bpr = CVPixelBufferGetBytesPerRow(px), bar = Int(frameNo * 6) % max(1, w)
      for y in 0..<h {
        let row = base + y * bpr
        for x in 0..<w { let p = row + x * 4, on = abs(x - bar) < 16; p[0] = on ? 255 : UInt8(x * 200 / max(1, w)); p[1] = on ? 255 : UInt8(y * 200 / max(1, h)); p[2] = on ? 255 : 60; p[3] = 255 }
      }
    }
    CVPixelBufferUnlockBaseAddress(px, [])
    frameNo += 1
    encode(px, pts: CMTime(value: frameNo, timescale: CMTimeScale(fps)))
  }

  // ---- 键盘鼠标：t = m 移动 / d 按下 / u 松开 / w 滚动 / k 键；x、y 是屏幕上的位置（0~1）；b 按键（0 左 1 右 2 中）；c 点了几下；f 修饰键 ----
  func input(_ evs: [[String: Any]]) -> Any? {
    if let p = inputLog {
      if let d = try? JSONSerialization.data(withJSONObject: ["id": id, "ev": evs]), let h = FileHandle(forWritingAtPath: p) ?? { FileManager.default.createFile(atPath: p, contents: nil); return FileHandle(forWritingAtPath: p) }() {
        h.seekToEndOfFile(); h.write(d); h.write(Data("\n".utf8)); try? h.close()
      }
      return nil
    }
    guard AXIsProcessTrusted() else {
      if !axAsked { axAsked = true; _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary) }
      return ["ax": false]
    }
    let src = CGEventSource(stateID: .hidSystemState)
    for e in evs {
      let t = e["t"] as? String ?? ""
      if let x = (e["x"] as? NSNumber)?.doubleValue, let y = (e["y"] as? NSNumber)?.doubleValue {
        last = CGPoint(x: disp.minX + min(1, max(0, x)) * disp.width, y: disp.minY + min(1, max(0, y)) * disp.height)
      }
      let flags = CGEventFlags(rawValue: UInt64((e["f"] as? NSNumber)?.uint64Value ?? 0) & 0x00FF_0000)
      switch t {
      case "m":
        let type: CGEventType = downButtons.contains(0) ? .leftMouseDragged : downButtons.contains(1) ? .rightMouseDragged : downButtons.contains(2) ? .otherMouseDragged : .mouseMoved
        let ev = CGEvent(mouseEventSource: src, mouseType: type, mouseCursorPosition: last, mouseButton: downButtons.contains(1) ? .right : downButtons.contains(2) ? .center : .left)
        ev?.flags = flags
        ev?.post(tap: .cghidEventTap)
      case "d", "u":
        let b = (e["b"] as? NSNumber)?.intValue ?? 0, down = t == "d"
        if down { downButtons.insert(b) } else { downButtons.remove(b) }
        let type: CGEventType = b == 0 ? (down ? .leftMouseDown : .leftMouseUp) : b == 1 ? (down ? .rightMouseDown : .rightMouseUp) : (down ? .otherMouseDown : .otherMouseUp)
        let ev = CGEvent(mouseEventSource: src, mouseType: type, mouseCursorPosition: last, mouseButton: b == 0 ? .left : b == 1 ? .right : .center)
        ev?.setIntegerValueField(.mouseEventClickState, value: Int64((e["c"] as? NSNumber)?.intValue ?? 1))
        ev?.flags = flags
        ev?.post(tap: .cghidEventTap)
      case "w":
        let dx = Int32((e["dx"] as? NSNumber)?.doubleValue ?? 0), dy = Int32((e["dy"] as? NSNumber)?.doubleValue ?? 0)
        let ev = CGEvent(scrollWheelEvent2Source: src, units: .pixel, wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0)
        ev?.post(tap: .cghidEventTap)
      case "k":
        let code = CGKeyCode((e["c"] as? NSNumber)?.uint16Value ?? 0), down = e["d"] as? Bool ?? true
        let ev = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: down)
        ev?.flags = flags
        ev?.post(tap: .cghidEventTap)
      default:
        break
      }
    }
    return nil
  }
  // 停下、暂停时：按着的鼠标键都松开（不然那台以为一直按着）
  private func releaseButtons() {
    guard inputLog == nil, !downButtons.isEmpty, AXIsProcessTrusted() else { downButtons.removeAll(); return }
    let src = CGEventSource(stateID: .hidSystemState)
    for b in downButtons {
      let type: CGEventType = b == 0 ? .leftMouseUp : b == 1 ? .rightMouseUp : .otherMouseUp
      CGEvent(mouseEventSource: src, mouseType: type, mouseCursorPosition: last, mouseButton: b == 0 ? .left : b == 1 ? .right : .center)?.post(tap: .cghidEventTap)
    }
    downButtons.removeAll()
  }
}

// MARK: - 这台：画那台的屏幕，送键盘鼠标
@MainActor
final class ScreenPanes {
  static let commands = ["scr.open", "scr.data", "scr.place", "scr.close", "scr.focus", "scr.window", "scr.pause", "scr.opts", "scr.snapshot", "scr.list"]
  weak var controller: WebController?
  private var views: [String: ScreenView] = [:]

  func run(_ cmd: String, _ a: [String: Any]) async throws -> Any? {
    if cmd == "scr.list" { return views.map { ["id": $0.key, "info": $0.value.debugInfo] as [String: Any] } }
    guard let id = a["id"] as? String, !id.isEmpty else { throw BridgeError.args("\(cmd) { id, … }") }
    switch cmd {
    case "scr.open":
      if let v = views[id] { return v.state }
      guard let web = controller?.webView else { return nil }
      let v = ScreenView(frame: .zero)
      v.sid = id
      v.panes = self
      v.isHidden = true
      web.addSubview(v)
      views[id] = v
      return v.state
    case "scr.data":
      views[id]?.enqueue(a)
      return nil
    case "scr.place":
      views[id]?.place(a)
      return nil
    case "scr.close":
      views.removeValue(forKey: id)?.close()
      return nil
    case "scr.focus":
      views[id]?.focusIn()
      return nil
    case "scr.window":
      guard let v = views[id] else { return nil }
      if a["mode"] as? String == "tab" { v.dockBack() } else { v.popOut(fullscreen: a["mode"] as? String == "fullscreen") }
      return v.state
    case "scr.pause":
      views[id]?.setPaused(a["on"] as? Bool ?? true)
      return views[id]?.state
    case "scr.opts":
      views[id]?.setOptions(a)
      return nil
    case "scr.snapshot":
      return views[id]?.snapshot()
    default:
      return nil
    }
  }
  func emit(_ type: String, _ d: [String: Any]) { controller?.emit(type, d) }
  var webView: NSView? { controller?.webView }
  var mainWindow: NSWindow? { controller?.window }
  func closeAll() { views.values.forEach { $0.close() }; views.removeAll() }
}

@MainActor
final class ScreenView: NSView {
  var sid = ""
  weak var panes: ScreenPanes?
  private let video = AVSampleBufferDisplayLayer()
  private let hud = CATextLayer()
  private var fmt: CMVideoFormatDescription?
  private var lastKey: CMSampleBuffer? // 最近的关键帧：截图（标签页概览、测试）时自己解一帧
  private(set) var vw = 0, vh = 0
  private var paused = false
  private var hudOn = false
  // 统计（一秒报一次）：收到几帧、多少字节
  private var nFrames = 0, nBytes = 0, statAt = Date()
  private var statTimer: Timer?
  // 键盘鼠标：攒一帧的量一起送（鼠标移动一帧只送最后一个位置）
  private var queued: [[String: Any]] = []
  private var flushQueued = false
  private var monitor: Any?
  private var pressedKeys = Set<UInt16>()
  private var buttons = Set<Int>()
  private var wheel = (x: CGFloat(0), y: CGFloat(0))
  private static let blank: NSCursor = { let i = NSImage(size: NSSize(width: 1, height: 1)); return NSCursor(image: i, hotSpot: .zero) }()
  // 分出去的窗口
  private var popWin: NSWindow?
  private var popDelegate: RdpWindowDelegate?

  override init(frame: NSRect) {
    super.init(frame: frame)
    wantsLayer = true
    layer?.backgroundColor = NSColor.black.cgColor
    video.videoGravity = .resizeAspect
    video.backgroundColor = NSColor.black.cgColor
    video.actions = ["bounds": NSNull(), "position": NSNull(), "frame": NSNull(), "opacity": NSNull()]
    layer?.addSublayer(video)
    hud.isHidden = true
    hud.font = NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .medium)
    hud.fontSize = 11
    hud.foregroundColor = NSColor.white.cgColor
    hud.backgroundColor = NSColor.black.withAlphaComponent(0.55).cgColor
    hud.cornerRadius = 6
    hud.alignmentMode = .center
    hud.actions = ["contents": NSNull(), "bounds": NSNull(), "position": NSNull(), "frame": NSNull(), "hidden": NSNull()]
    layer?.addSublayer(hud)
    addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .activeAlways, .inVisibleRect, .cursorUpdate], owner: self))
    statTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.tickStats() } }
  }
  required init?(coder: NSCoder) { fatalError() }
  override var isFlipped: Bool { true }
  override var acceptsFirstResponder: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func layout() { super.layout(); placeLayers() }
  override func setFrameSize(_ s: NSSize) { super.setFrameSize(s); placeLayers() }
  private func placeLayers() {
    CATransaction.begin(); CATransaction.setDisableActions(true)
    video.frame = bounds
    CATransaction.commit()
  }

  var state: [String: Any] { ["id": sid, "w": vw, "h": vh, "popped": popWin != nil, "paused": paused] }
  var debugInfo: [String: Any] { ["frames": totalFrames, "w": vw, "h": vh, "hidden": isHidden, "popped": popWin != nil, "paused": paused, "status": video.sampleBufferRenderer.status.rawValue, "first": window?.firstResponder === self] }
  private var totalFrames = 0

  // 一帧（页面从中转收到的 screen.frame）：关键帧带 SPS、PPS——用它建格式；还没有格式（没等到关键帧）的先不画
  func enqueue(_ a: [String: Any]) {
    if let ps = a["ps"] as? [String], ps.count >= 2 {
      let sets = ps.compactMap { Data(base64Encoded: $0) }
      if sets.count >= 2 {
        var nf: CMFormatDescription?
        let ptrs = sets.map { d -> UnsafePointer<UInt8> in let p = UnsafeMutablePointer<UInt8>.allocate(capacity: d.count); d.copyBytes(to: p, count: d.count); return UnsafePointer(p) }
        let sizes = sets.map { $0.count }
        CMVideoFormatDescriptionCreateFromH264ParameterSets(allocator: nil, parameterSetCount: sets.count, parameterSetPointers: ptrs, parameterSetSizes: sizes, nalUnitHeaderLength: 4, formatDescriptionOut: &nf)
        ptrs.forEach { UnsafeMutablePointer(mutating: $0).deallocate() }
        if let nf { fmt = nf }
      }
    }
    if let w = (a["w"] as? NSNumber)?.intValue, let h = (a["h"] as? NSNumber)?.intValue { vw = w; vh = h }
    guard let fmt, let b64 = a["b64"] as? String, let data = Data(base64Encoded: b64), !data.isEmpty else { return }
    nBytes += b64.count * 3 / 4
    var bb: CMBlockBuffer?
    guard CMBlockBufferCreateWithMemoryBlock(allocator: nil, memoryBlock: nil, blockLength: data.count, blockAllocator: nil, customBlockSource: nil, offsetToData: 0, dataLength: data.count, flags: kCMBlockBufferAssureMemoryNowFlag, blockBufferOut: &bb) == kCMBlockBufferNoErr, let bb else { return }
    _ = data.withUnsafeBytes { CMBlockBufferReplaceDataBytes(with: $0.baseAddress!, blockBuffer: bb, offsetIntoDestination: 0, dataLength: data.count) }
    var sb: CMSampleBuffer?
    var size = data.count
    guard CMSampleBufferCreateReady(allocator: nil, dataBuffer: bb, formatDescription: fmt, sampleCount: 1, sampleTimingEntryCount: 0, sampleTimingArray: nil, sampleSizeEntryCount: 1, sampleSizeArray: &size, sampleBufferOut: &sb) == noErr, let sb else { return }
    if let atts = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: true), CFArrayGetCount(atts) > 0 {
      let d = unsafeBitCast(CFArrayGetValueAtIndex(atts, 0), to: CFMutableDictionary.self)
      CFDictionarySetValue(d, Unmanaged.passUnretained(kCMSampleAttachmentKey_DisplayImmediately).toOpaque(), Unmanaged.passUnretained(kCFBooleanTrue).toOpaque())
    }
    if a["k"] as? Bool == true { lastKey = sb }
    let r = video.sampleBufferRenderer
    if r.status == .failed { r.flush(); panes?.emit("scr.needkey", ["id": sid]) } // 解坏了：清掉，请那边来一个关键帧
    r.enqueue(sb)
    nFrames += 1
    totalFrames += 1
  }

  private func tickStats() {
    let ms = max(1, Date().timeIntervalSince(statAt) * 1000)
    panes?.emit("scr.stats", ["id": sid, "ms": ms, "frames": nFrames, "bytes": nBytes, "w": vw, "h": vh, "paused": paused, "popped": popWin != nil])
    if hudOn {
      let mb = Double(nBytes) * 8 / ms / 1000
      setHud(paused ? "\(vw)×\(vh)" : "\(vw)×\(vh)  ·  \(Int((Double(nFrames) * 1000 / ms).rounded())) fps  ·  " + String(format: mb >= 10 ? "%.0f Mbps" : mb >= 1 ? "%.1f Mbps" : "%.2f Mbps", mb) + "  ·  H.264")
    }
    nFrames = 0; nBytes = 0; statAt = Date()
  }
  func setOptions(_ a: [String: Any]) {
    if let v = a["hud"] as? Bool { hudOn = v; hud.isHidden = !v }
  }
  private func setHud(_ t: String) {
    let w = ceil((t as NSString).size(withAttributes: [.font: NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .medium)]).width) + 18
    CATransaction.begin(); CATransaction.setDisableActions(true)
    hud.string = t
    hud.contentsScale = window?.backingScaleFactor ?? 2
    hud.frame = CGRect(x: max(8, bounds.width - w - 10), y: 10, width: w, height: 20)
    hud.isHidden = false
    CATransaction.commit()
  }

  func place(_ a: [String: Any]) {
    guard popWin == nil, let host = panes?.webView else { return }
    let n = { (x: Any?) in CGFloat((x as? NSNumber)?.doubleValue ?? 0) }
    let x = n(a["x"]), y = n(a["y"]), w = max(0, n(a["w"])), h = max(0, n(a["h"]))
    frame = NSRect(x: x, y: host.isFlipped ? y : host.bounds.height - y - h, width: w, height: h)
    let vis = (a["visible"] as? Bool ?? true) && w >= 4 && h >= 4
    isHidden = !vis
    if !vis, window?.firstResponder === self { window?.makeFirstResponder(superview) }
  }
  func focusIn() { if let w = popWin { w.makeKeyAndOrderFront(nil) }; window?.makeFirstResponder(self) }
  func setPaused(_ on: Bool) {
    if on { releaseAll() }
    paused = on
    CATransaction.begin(); CATransaction.setDisableActions(true)
    video.opacity = on ? 0.35 : 1
    CATransaction.commit()
  }
  func close() {
    if popWin != nil { dockBack(emit: false) }
    statTimer?.invalidate()
    if let m = monitor { NSEvent.removeMonitor(m); monitor = nil }
    video.sampleBufferRenderer.flush()
    removeFromSuperview()
  }
  func snapshot() -> String? {
    // 视频层画不进 CALayer.render：把最近的关键帧自己解一帧
    guard let sb = lastKey, let fd = CMSampleBufferGetFormatDescription(sb) else { return nil }
    var dec: VTDecompressionSession?
    guard VTDecompressionSessionCreate(allocator: nil, formatDescription: fd, decoderSpecification: nil, imageBufferAttributes: [kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA] as CFDictionary,
                                       outputCallback: nil, decompressionSessionOut: &dec) == noErr, let dec else { return nil }
    defer { VTDecompressionSessionInvalidate(dec) }
    nonisolated(unsafe) var img: CVImageBuffer?
    VTDecompressionSessionDecodeFrame(dec, sampleBuffer: sb, flags: [], infoFlagsOut: nil) { _, _, ib, _, _ in img = ib }
    VTDecompressionSessionWaitForAsynchronousFrames(dec)
    guard let img else { return nil }
    let ci = CIImage(cvPixelBuffer: img)
    guard let cg = CIContext().createCGImage(ci, from: ci.extent), let png = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:]) else { return nil }
    return "data:image/png;base64," + png.base64EncodedString()
  }

  // ---- 分出去：单独的窗口（能全屏，单独一个桌面空间）；关窗口 = 放回标签页 ----
  func popOut(fullscreen: Bool) {
    if let w = popWin { w.makeKeyAndOrderFront(nil); if fullscreen && !w.styleMask.contains(.fullScreen) { w.toggleFullScreen(nil) }; return }
    let vis = (panes?.mainWindow?.screen ?? NSScreen.main)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
    let aspect: CGFloat = vw > 0 && vh > 0 ? CGFloat(vh) / CGFloat(vw) : 10.0 / 16.0
    var w = min(vis.width * 0.82, 1680), h = w * aspect
    if h > vis.height * 0.86 { h = vis.height * 0.86; w = h / aspect }
    let win = NSWindow(contentRect: NSRect(x: vis.midX - w / 2, y: vis.midY - h / 2, width: w, height: h), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    win.title = panes?.mainWindow?.title ?? "Vibing Studio"
    win.isReleasedWhenClosed = false
    win.collectionBehavior = [.fullScreenPrimary, .managed]
    win.tabbingMode = .disallowed
    win.backgroundColor = .black
    let content = NSView(frame: NSRect(origin: .zero, size: win.contentLayoutRect.size))
    content.wantsLayer = true
    content.layer?.backgroundColor = NSColor.black.cgColor
    win.contentView = content
    let del = RdpWindowDelegate()
    del.onClose = { [weak self] in self?.dockBack() }
    win.delegate = del
    popDelegate = del
    removeFromSuperview()
    frame = content.bounds
    autoresizingMask = [.width, .height]
    content.addSubview(self)
    isHidden = false
    popWin = win
    win.makeKeyAndOrderFront(nil)
    if ProcessInfo.processInfo.environment["NADOS_TESTJS"] == nil { NSApp.activate(ignoringOtherApps: true) }
    win.makeFirstResponder(self)
    if fullscreen { win.toggleFullScreen(nil) }
    panes?.emit("scr.state", state)
  }
  func dockBack(emit: Bool = true) {
    guard let win = popWin else { return }
    popWin = nil
    win.delegate = nil
    popDelegate = nil
    removeFromSuperview()
    autoresizingMask = []
    isHidden = true
    panes?.webView?.addSubview(self)
    win.orderOut(nil)
    win.close()
    panes?.mainWindow?.makeKeyAndOrderFront(nil)
    if emit { panes?.emit("scr.state", state) }
  }

  // ---- 键盘鼠标 → 那台（屏幕上的位置按画面那一块算，0~1）----
  private var videoRect: CGRect {
    guard vw > 0, vh > 0, bounds.width > 0, bounds.height > 0 else { return bounds }
    let k = min(bounds.width / CGFloat(vw), bounds.height / CGFloat(vh)), w = CGFloat(vw) * k, h = CGFloat(vh) * k
    return CGRect(x: (bounds.width - w) / 2, y: (bounds.height - h) / 2, width: w, height: h)
  }
  private func pos(_ e: NSEvent) -> (x: Double, y: Double) {
    let p = convert(e.locationInWindow, from: nil), r = videoRect
    return (Double(min(1, max(0, (p.x - r.minX) / max(1, r.width)))), Double(min(1, max(0, (p.y - r.minY) / max(1, r.height)))))
  }
  private func push(_ ev: [String: Any], now: Bool = false) {
    guard !paused else { return }
    if ev["t"] as? String == "m", let i = queued.lastIndex(where: { $0["t"] as? String == "m" }), i == queued.count - 1 { queued[i] = ev } else { queued.append(ev) }
    if now { flush(); return }
    if !flushQueued { flushQueued = true; DispatchQueue.main.async { [weak self] in MainActor.assumeIsolated { self?.flush() } } }
  }
  private func flush() {
    flushQueued = false
    guard !queued.isEmpty else { return }
    let l = queued
    queued = []
    nonisolated(unsafe) let ll = l
    panes?.emit("scr.input", ["id": sid, "ev": ll])
  }
  private func flagsOf(_ e: NSEvent) -> UInt { e.modifierFlags.intersection(.deviceIndependentFlagsMask).rawValue }
  private func mouse(_ t: String, _ e: NSEvent, b: Int = 0) {
    let p = pos(e)
    var ev: [String: Any] = ["t": t, "x": p.x, "y": p.y, "f": flagsOf(e)]
    if t != "m" { ev["b"] = b; ev["c"] = e.clickCount }
    push(ev, now: t != "m")
  }
  override func mouseMoved(with e: NSEvent) { ScreenView.blank.set(); mouse("m", e) }
  override func mouseDragged(with e: NSEvent) { mouse("m", e) }
  override func rightMouseDragged(with e: NSEvent) { mouse("m", e) }
  override func otherMouseDragged(with e: NSEvent) { mouse("m", e) }
  override func mouseDown(with e: NSEvent) {
    if paused { panes?.emit("scr.resume", ["id": sid]); return } // 暂停着：点一下是「继续」
    window?.makeFirstResponder(self); buttons.insert(0); mouse("d", e, b: 0)
  }
  override func mouseUp(with e: NSEvent) { buttons.remove(0); mouse("u", e, b: 0) }
  override func rightMouseDown(with e: NSEvent) { window?.makeFirstResponder(self); buttons.insert(1); mouse("d", e, b: 1) }
  override func rightMouseUp(with e: NSEvent) { buttons.remove(1); mouse("u", e, b: 1) }
  override func otherMouseDown(with e: NSEvent) { buttons.insert(2); mouse("d", e, b: 2) }
  override func otherMouseUp(with e: NSEvent) { buttons.remove(2); mouse("u", e, b: 2) }
  override func scrollWheel(with e: NSEvent) {
    let k: CGFloat = e.hasPreciseScrollingDeltas ? 1 : 10
    wheel.x += e.scrollingDeltaX * k; wheel.y += e.scrollingDeltaY * k
    let dx = wheel.x.rounded(.towardZero), dy = wheel.y.rounded(.towardZero)
    guard dx != 0 || dy != 0 else { return }
    wheel.x -= dx; wheel.y -= dy
    push(["t": "w", "dx": Double(dx), "dy": Double(dy)])
  }
  override func cursorUpdate(with event: NSEvent) { ScreenView.blank.set() } // 那台的指针画在画面里：这台的藏起来
  override func mouseExited(with event: NSEvent) { NSCursor.arrow.set() }

  // 键：成了第一响应者就接管这个窗口的键（带 ⌘ 的也送过去——Mac 对 Mac，⌘ 还是 ⌘）；留给这台的：⌘Q、⌘H、⌘M、⌘`、⌃⌘F、⌘⌥Esc、⌘Tab（系统的）
  override func becomeFirstResponder() -> Bool {
    if monitor == nil {
      monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .keyUp, .flagsChanged]) { [weak self] ev in
        nonisolated(unsafe) let e = ev
        let eat: Bool = MainActor.assumeIsolated {
          guard let self, e.window === self.window, self.window?.firstResponder === self else { return false }
          if self.keepLocal(e) { return false }
          self.key(e)
          return true
        }
        return eat ? nil : ev
      }
    }
    return true
  }
  override func resignFirstResponder() -> Bool {
    if let m = monitor { NSEvent.removeMonitor(m); monitor = nil }
    releaseAll()
    return true
  }
  private func keepLocal(_ e: NSEvent) -> Bool {
    guard e.type == .keyDown || e.type == .keyUp else { return false }
    let f = e.modifierFlags.intersection(.deviceIndependentFlagsMask)
    guard f.contains(.command) else { return false }
    let k = e.keyCode
    if f.contains(.control) && k == 0x03 { return true } // ⌃⌘F
    if f.contains(.option) && k == 0x35 { return true } // ⌘⌥Esc
    return [0x0C, 0x04, 0x2E, 0x32].contains(k) // Q H M `
  }
  private func key(_ e: NSEvent) {
    switch e.type {
    case .keyDown: pressedKeys.insert(e.keyCode); push(["t": "k", "c": Int(e.keyCode), "d": true, "f": flagsOf(e)], now: true)
    case .keyUp: pressedKeys.remove(e.keyCode); push(["t": "k", "c": Int(e.keyCode), "d": false, "f": flagsOf(e)], now: true)
    case .flagsChanged:
      // 修饰键：按下还是松开看它那一位还在不在
      let mask: [UInt16: NSEvent.ModifierFlags] = [0x37: .command, 0x36: .command, 0x38: .shift, 0x3C: .shift, 0x3A: .option, 0x3D: .option, 0x3B: .control, 0x3E: .control, 0x39: .capsLock, 0x3F: .function]
      guard let m = mask[e.keyCode] else { return }
      let down = e.modifierFlags.contains(m)
      if down { pressedKeys.insert(e.keyCode) } else { pressedKeys.remove(e.keyCode) }
      push(["t": "k", "c": Int(e.keyCode), "d": down, "f": flagsOf(e)], now: true)
    default: break
    }
  }
  // 离开、暂停时：按着的键、鼠标都松开
  private func releaseAll() {
    let keys = pressedKeys, bs = buttons
    pressedKeys.removeAll(); buttons.removeAll()
    guard !paused else { return }
    for k in keys { queued.append(["t": "k", "c": Int(k), "d": false, "f": 0]) }
    for b in bs { queued.append(["t": "u", "b": b, "c": 1]) }
    flush()
  }
}
