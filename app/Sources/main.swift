// main.swift —— Paimon（macOS）：把 code.paimon.beer 装进一个原生窗口（WKWebView），再给网页一座桥（window.nadosNative），
// 系统的权限（通知、屏幕录制、辅助功能、摄像头麦克风）由 App 申请、网页桌面和 agent 通过桥来用
import AppKit

MainActor.assumeIsolated {
  let app = NSApplication.shared
  let delegate = AppDelegate()
  app.delegate = delegate
  app.setActivationPolicy(.regular)
  app.run()
}
