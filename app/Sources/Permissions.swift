// Permissions.swift —— 系统权限：查状态、申请、打开系统设置里对应的那一页
// 状态统一成：granted | denied | not-determined | restricted | not-granted（系统不告诉我们是没问过还是拒绝了：屏幕录制、辅助功能）
import AppKit
import ApplicationServices
import AVFoundation
import CoreGraphics
import UserNotifications

enum Permissions {
  static let kinds = ["notifications", "screen", "accessibility", "camera", "microphone"]

  static func status() async -> [String: String] {
    let n = await UNUserNotificationCenter.current().notificationSettings()
    return [
      "notifications": name(n.authorizationStatus),
      "screen": CGPreflightScreenCaptureAccess() ? "granted" : "not-granted",
      "accessibility": AXIsProcessTrusted() ? "granted" : "not-granted",
      "camera": name(AVCaptureDevice.authorizationStatus(for: .video)),
      "microphone": name(AVCaptureDevice.authorizationStatus(for: .audio)),
    ]
  }

  // 申请：第一次弹系统的对话框；系统不会再问了（拒绝过、或屏幕录制 / 辅助功能第二次申请）就直接打开系统设置里那一页
  static func request(_ kind: String) async throws -> [String: Any] {
    guard kinds.contains(kind) else { throw BridgeError.args("unknown permission \"\(kind)\" (one of: \(kinds.joined(separator: ", ")))") }
    let asked = "asked." + kind, before = UserDefaults.standard.bool(forKey: asked)
    UserDefaults.standard.set(true, forKey: asked)
    var opened = false
    switch kind {
    case "notifications":
      let c = UNUserNotificationCenter.current()
      if await c.notificationSettings().authorizationStatus == .notDetermined { _ = try? await c.requestAuthorization(options: [.alert, .sound, .badge]) }
      if await c.notificationSettings().authorizationStatus == .denied { opened = openSettings(kind) }
    case "screen":
      if !CGPreflightScreenCaptureAccess() {
        if before { opened = openSettings(kind) } else { _ = CGRequestScreenCaptureAccess() }
      }
    case "accessibility":
      if !AXIsProcessTrusted() {
        if before { opened = openSettings(kind) } else { _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary) }
      }
    case "camera", "microphone":
      let t: AVMediaType = kind == "camera" ? .video : .audio
      switch AVCaptureDevice.authorizationStatus(for: t) {
      case .notDetermined: _ = await AVCaptureDevice.requestAccess(for: t)
      case .denied, .restricted: opened = openSettings(kind)
      default: break
      }
    default: break
    }
    let now = await status()[kind] ?? "not-granted"
    var out: [String: Any] = ["kind": kind, "status": now, "openedSettings": opened]
    if now != "granted" {
      out["note"] = kind == "screen" || kind == "accessibility"
        ? "Turn Paimon on in System Settings › Privacy & Security › \(kind == "screen" ? "Screen & System Audio Recording" : "Accessibility"); screen recording may need Paimon to be reopened."
        : "Allow Paimon in System Settings › \(kind == "notifications" ? "Notifications" : "Privacy & Security › " + kind.capitalized)."
    }
    return out
  }

  @discardableResult
  static func openSettings(_ kind: String) -> Bool {
    let s: String
    switch kind {
    case "notifications": s = "x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=" + Config.bundleID
    case "screen": s = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
    case "accessibility": s = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
    case "camera": s = "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera"
    case "microphone": s = "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
    default: return false
    }
    guard let u = URL(string: s) else { return false }
    return NSWorkspace.shared.open(u)
  }

  private static func name(_ s: UNAuthorizationStatus) -> String {
    switch s {
    case .authorized, .provisional: return "granted"
    case .denied: return "denied"
    case .notDetermined: return "not-determined"
    @unknown default: return "not-granted"
    }
  }
  private static func name(_ s: AVAuthorizationStatus) -> String {
    switch s {
    case .authorized: return "granted"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "not-determined"
    @unknown default: return "not-granted"
    }
  }
}
