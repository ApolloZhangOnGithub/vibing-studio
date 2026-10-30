// System.swift —— 给页面的几样这台 Mac 上的真实情况（macOS 风格的菜单栏、访达用）：
//   fs.thumb { path, size } → 缩略图（Quick Look 生成：图片、PDF、视频、文稿；App、文件夹是它们自己的图标）的 PNG data URL
//   system.status → { battery: { level 0–100, charging, plugged } | null, wifi: { on, ssid? } | null, input: 输入法的短名字 }
//   system.load → { cpu %, gpu %, memUsed, memTotal, diskFree, diskTotal }（状态栏右边那几个；很便宜：不起进程，同活动监视器的算法）
import AppKit
import IOKit
import CoreWLAN
import IOKit.ps
import QuickLookThumbnailing
import Carbon
import UniformTypeIdentifiers

@MainActor
enum SystemInfo {
  static let commands = ["fs.thumb", "system.status", "system.load", "fs.apps", "fs.openWith", "fs.trash", "fs.tags", "fs.share", "fs.chooseApp", "fs.chooseFolder", "fs.chooseFiles"]
  private static var thumbs: [String: String] = [:] // path|size|mtime → data URL
  private static var sharing: NSSharingServicePicker?

  static func run(_ cmd: String, _ a: [String: Any]) async throws -> Any? {
    switch cmd {
    case "fs.thumb":
      guard let p = a["path"] as? String, !p.isEmpty else { throw BridgeError.args("fs.thumb { path, size? }") }
      let size = CGFloat((a["size"] as? NSNumber)?.doubleValue ?? 64)
      let url = URL(fileURLWithPath: (p as NSString).expandingTildeInPath)
      let mtime = ((try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate?.timeIntervalSince1970 ?? 0)
      let key = "\(url.path)|\(Int(size))|\(Int(mtime))"
      if let hit = thumbs[key] { return hit }
      let rv = try? url.resourceValues(forKeys: [.isDirectoryKey, .isPackageKey])
      var img: NSImage?
      // 文件夹、App：用它们自己的图标（App 的 logo、「下载」那种带图案的文件夹）；别的：Quick Look 的缩略图，没有就用图标
      if rv?.isDirectory == true || rv?.isPackage == true { img = NSWorkspace.shared.icon(forFile: url.path) }
      else {
        let scale = NSScreen.main?.backingScaleFactor ?? 2
        let req = QLThumbnailGenerator.Request(fileAt: url, size: CGSize(width: size, height: size), scale: scale, representationTypes: .thumbnail)
        if let rep = try? await QLThumbnailGenerator.shared.generateBestRepresentation(for: req) { img = rep.nsImage }
        if img == nil { img = NSWorkspace.shared.icon(forFile: url.path) }
      }
      guard let img else { return nil }
      let px = Int(size * 2)
      let out = NSImage(size: NSSize(width: px, height: px))
      out.lockFocus()
      let r = img.size.width > 0 && img.size.height > 0 ? min(CGFloat(px) / img.size.width, CGFloat(px) / img.size.height) : 1
      let w = img.size.width * r, h = img.size.height * r
      img.draw(in: NSRect(x: (CGFloat(px) - w) / 2, y: (CGFloat(px) - h) / 2, width: w, height: h))
      out.unlockFocus()
      guard let tiff = out.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) else { return nil }
      let s = "data:image/png;base64," + png.base64EncodedString()
      if thumbs.count > 800 { thumbs.removeAll() }
      thumbs[key] = s
      return s
    case "system.status":
      var out: [String: Any] = ["battery": NSNull(), "wifi": NSNull(), "input": inputSource()]
      if let b = battery() { out["battery"] = b }
      if let iface = CWWiFiClient.shared().interface() {
        var w: [String: Any] = ["on": iface.powerOn()]
        if let ssid = iface.ssid() { w["ssid"] = ssid } // 没有定位权限时拿不到名字：只知道开没开、连没连
        w["connected"] = iface.rssiValue() != 0
        w["rssi"] = iface.rssiValue()
        out["wifi"] = w
      }
      return out
    case "system.load":
      return SystemLoad.sample()
    case "fs.apps":
      // 能打开这个文件的 App（「打开方式」）：默认的在前；[{ name, path, default }]
      guard let p = a["path"] as? String else { throw BridgeError.args("fs.apps { path }") }
      let url = URL(fileURLWithPath: (p as NSString).expandingTildeInPath)
      let def = NSWorkspace.shared.urlForApplication(toOpen: url)
      var seen = Set<String>(), out: [[String: Any]] = []
      for app in ([def].compactMap { $0 } + NSWorkspace.shared.urlsForApplications(toOpen: url)) where !seen.contains(app.path) {
        seen.insert(app.path)
        let name = FileManager.default.displayName(atPath: app.path)
        out.append(["name": name, "path": app.path, "default": app == def])
        if out.count >= 40 { break }
      }
      return out
    case "fs.openWith":
      // 用某个 App 打开（没给就用默认的）
      guard let p = a["path"] as? String else { throw BridgeError.args("fs.openWith { path, app? }") }
      let url = URL(fileURLWithPath: (p as NSString).expandingTildeInPath)
      if let app = a["app"] as? String, !app.isEmpty {
        _ = try await NSWorkspace.shared.open([url], withApplicationAt: URL(fileURLWithPath: app), configuration: NSWorkspace.OpenConfiguration())
      } else { NSWorkspace.shared.open(url) }
      return nil
    case "fs.trash":
      // 移到废纸篓（能从废纸篓放回去，不是删掉）
      guard let p = a["path"] as? String else { throw BridgeError.args("fs.trash { path }") }
      var res: NSURL?
      try FileManager.default.trashItem(at: URL(fileURLWithPath: (p as NSString).expandingTildeInPath), resultingItemURL: &res)
      return res?.path ?? NSNull()
    case "fs.tags":
      // 访达的标签（红、橙、黄……）：给了 tags 就写，不给就读
      guard let p = a["path"] as? String else { throw BridgeError.args("fs.tags { path, tags? }") }
      let url = URL(fileURLWithPath: (p as NSString).expandingTildeInPath)
      if let tags = a["tags"] as? [String] { try (url as NSURL).setResourceValue(tags, forKey: .tagNamesKey) } // 老系统上也能写（URLResourceValues 的写法要 macOS 26）
      return (try? url.resourceValues(forKeys: [.tagNamesKey]))?.tagNames ?? []
    case "fs.share":
      // 访达右键的「共享…」：系统的共享菜单（隔空投送、信息、邮件……），开在页面上 (x, y) 那一点
      let paths = (a["paths"] as? [String]) ?? [(a["path"] as? String) ?? ""].filter { !$0.isEmpty }
      guard !paths.isEmpty, let v = NSApp.keyWindow?.contentView else { return nil }
      let x = CGFloat((a["x"] as? NSNumber)?.doubleValue ?? 0), y = CGFloat((a["y"] as? NSNumber)?.doubleValue ?? 0)
      let picker = NSSharingServicePicker(items: paths.map { URL(fileURLWithPath: ($0 as NSString).expandingTildeInPath) })
      sharing = picker // 开着的时候要有人拿着
      picker.show(relativeTo: NSRect(x: x, y: v.isFlipped ? y : v.bounds.height - y, width: 1, height: 1), of: v, preferredEdge: .maxY)
      return nil
    case "fs.chooseFolder":
      // 选一个文件夹（新会话在哪干活、打开文件夹……）：系统的「打开」面板，只能选文件夹；从给的地方开始；取消了是 null（用户 2026-10-28：不要让人打路径）
      let panel = NSOpenPanel()
      panel.canChooseDirectories = true
      panel.canChooseFiles = false
      panel.canCreateDirectories = true
      panel.allowsMultipleSelection = false
      if let d = a["dir"] as? String, !d.isEmpty { panel.directoryURL = URL(fileURLWithPath: (d as NSString).expandingTildeInPath) }
      if let m = a["message"] as? String { panel.message = m }
      panel.prompt = (a["prompt"] as? String) ?? "选择"
      let r: NSApplication.ModalResponse
      if let win = NSApp.keyWindow { r = await panel.beginSheetModal(for: win) } else { r = panel.runModal() }
      return r == .OK ? (panel.url?.path ?? NSNull()) : NSNull()
    case "fs.chooseFiles":
      // 选文件（输入框 ··· 里的「添加图片…」……）：系统的「打开」面板 → 选中的路径。
      //   页面自己的 <input type=file> 只在点按的那一下里才开得出来；菜单是系统的菜单时，选完那一项已经不算「点按的那一下」，什么都不出来
      let panel = NSOpenPanel()
      panel.canChooseDirectories = false
      panel.canChooseFiles = true
      panel.allowsMultipleSelection = (a["multiple"] as? Bool) ?? true
      let types = ((a["types"] as? [String]) ?? []).compactMap { UTType($0) }
      if !types.isEmpty { panel.allowedContentTypes = types }
      if let d = a["dir"] as? String, !d.isEmpty { panel.directoryURL = URL(fileURLWithPath: (d as NSString).expandingTildeInPath) }
      panel.prompt = (a["prompt"] as? String) ?? "打开"
      let r: NSApplication.ModalResponse
      if let win = NSApp.keyWindow { r = await panel.beginSheetModal(for: win) } else { r = panel.runModal() }
      return r == .OK ? panel.urls.map { $0.path } : []
    case "fs.chooseApp":
      // 「打开方式 › 其他…」：系统的「选取应用程序」（从「应用程序」文件夹开始）→ 选中的 App 的路径；取消了是 null
      let panel = NSOpenPanel()
      panel.allowedContentTypes = [.application]
      panel.directoryURL = URL(fileURLWithPath: "/Applications")
      panel.canChooseDirectories = false
      panel.allowsMultipleSelection = false
      panel.treatsFilePackagesAsDirectories = false
      if let m = a["message"] as? String { panel.message = m }
      panel.prompt = (a["prompt"] as? String) ?? "打开"
      let r: NSApplication.ModalResponse
      if let win = NSApp.keyWindow { r = await panel.beginSheetModal(for: win) } else { r = panel.runModal() }
      return r == .OK ? (panel.url?.path ?? NSNull()) : NSNull()
    default:
      return nil
    }
  }

  private static func battery() -> [String: Any]? {
    guard let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(), let list = IOPSCopyPowerSourcesList(info)?.takeRetainedValue() as? [CFTypeRef] else { return nil }
    for ps in list {
      guard let d = IOPSGetPowerSourceDescription(info, ps)?.takeUnretainedValue() as? [String: Any], (d[kIOPSTypeKey] as? String) == kIOPSInternalBatteryType else { continue }
      let cur = d[kIOPSCurrentCapacityKey] as? Int ?? 0, max = d[kIOPSMaxCapacityKey] as? Int ?? 100
      return ["level": max > 0 ? Int((Double(cur) / Double(max) * 100).rounded()) : cur,
              "charging": d[kIOPSIsChargingKey] as? Bool ?? false,
              "plugged": (d[kIOPSPowerSourceStateKey] as? String) == kIOPSACPowerValue]
    }
    return nil
  }

  // 现在的输入法：菜单栏上那个字（拼 / A / あ……）
  private static func inputSource() -> String {
    guard let src = TISCopyCurrentKeyboardInputSource()?.takeRetainedValue() else { return "" }
    func prop(_ k: CFString) -> String? { guard let p = TISGetInputSourceProperty(src, k) else { return nil }; return Unmanaged<CFString>.fromOpaque(p).takeUnretainedValue() as String }
    let id = prop(kTISPropertyInputSourceID) ?? "", name = prop(kTISPropertyLocalizedName) ?? ""
    if id.contains("Pinyin") || id.contains("SCIM") || name.contains("拼音") { return "拼" }
    if id.contains("Wubi") { return "五" }
    if id.contains("Japanese") || id.contains("Kotoeri") { return "あ" }
    if id.contains("Korean") { return "한" }
    if id.contains("ABC") || id.contains("US") || id.hasSuffix(".US") { return "A" }
    return String(name.prefix(1))
  }
}

// 整机的负载（状态栏右边：CPU、GPU、内存、磁盘）：都从内核 / IOKit 直接读，不起进程
//   CPU：两次之间的 tick 差（user + system + nice）/ 总；内存：同活动监视器的「已使用内存」= App 内存 + 联动 + 被压缩；
//   GPU：IOAccelerator 的「Device Utilization %」；磁盘：启动盘「重要用途」可用的空间（同访达显示的）
@MainActor
enum SystemLoad {
  private static var prev: [UInt64]?
  static func sample() -> [String: Any] {
    var out: [String: Any] = [:]
    var info = host_cpu_load_info()
    var count = mach_msg_type_number_t(MemoryLayout<host_cpu_load_info_data_t>.size / MemoryLayout<integer_t>.size)
    let kr = withUnsafeMutablePointer(to: &info) { p in p.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { host_statistics(mach_host_self(), HOST_CPU_LOAD_INFO, $0, &count) } }
    if kr == KERN_SUCCESS {
      let t = [UInt64(info.cpu_ticks.0), UInt64(info.cpu_ticks.1), UInt64(info.cpu_ticks.2), UInt64(info.cpu_ticks.3)] // user, system, idle, nice
      if let p = prev, t[2] >= p[2] {
        let du = t[0] &- p[0], ds = t[1] &- p[1], di = t[2] &- p[2], dn = t[3] &- p[3], tot = du &+ ds &+ di &+ dn
        if tot > 0 { out["cpu"] = (Double(du + ds + dn) / Double(tot) * 1000).rounded() / 10 }
      }
      prev = t
    }
    var vm = vm_statistics64()
    var vc = mach_msg_type_number_t(MemoryLayout<vm_statistics64_data_t>.size / MemoryLayout<integer_t>.size)
    let kr2 = withUnsafeMutablePointer(to: &vm) { p in p.withMemoryRebound(to: integer_t.self, capacity: Int(vc)) { host_statistics64(mach_host_self(), HOST_VM_INFO64, $0, &vc) } }
    if kr2 == KERN_SUCCESS {
      let page = UInt64(vm_kernel_page_size)
      let app = UInt64(vm.internal_page_count) > UInt64(vm.purgeable_count) ? UInt64(vm.internal_page_count) - UInt64(vm.purgeable_count) : 0
      out["memUsed"] = (app + UInt64(vm.wire_count) + UInt64(vm.compressor_page_count)) * page
    }
    out["memTotal"] = ProcessInfo.processInfo.physicalMemory
    if let v = try? URL(fileURLWithPath: "/").resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey, .volumeTotalCapacityKey]) {
      if let f = v.volumeAvailableCapacityForImportantUsage { out["diskFree"] = f }
      if let t = v.volumeTotalCapacity { out["diskTotal"] = t }
    }
    if let g = gpu() { out["gpu"] = g }
    return out
  }
  private static func gpu() -> Int? {
    var it: io_iterator_t = 0
    guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IOAccelerator"), &it) == KERN_SUCCESS else { return nil }
    defer { IOObjectRelease(it) }
    var best: Int?
    while true {
      let svc = IOIteratorNext(it)
      if svc == 0 { break }
      var props: Unmanaged<CFMutableDictionary>?
      if IORegistryEntryCreateCFProperties(svc, &props, kCFAllocatorDefault, 0) == KERN_SUCCESS, let d = props?.takeRetainedValue() as? [String: Any],
         let ps = d["PerformanceStatistics"] as? [String: Any], let u = (ps["Device Utilization %"] as? NSNumber)?.intValue { best = max(best ?? 0, u) }
      IOObjectRelease(svc)
    }
    return best
  }
}
