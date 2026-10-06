// LiveActivity.swift —— 灵动岛 / 锁屏的实时活动：页面（ui/studio/vsisland.js）报上来几个在跑、几个在等你、最要紧的是哪个，这里起 / 改 / 收。
//   用时是系统自己走的（Text(timerInterval:)）；App 到了后台、页面不再报时，过一刻钟算过时（staleDate，系统会把它画淡）
import ActivityKit
import Foundation
import UIKit

@MainActor
final class LiveActivity {
  static let shared = LiveActivity()
  private var act: Activity<VSActivityAttributes>?
  private var lastSig = ""
  private var lastState = ""
  private var idleSince: Date?

  // 排查用：每一步记一行到 App 自己的 Documents/island.log（xcrun devicectl device copy from … 拿回来看），最多留最后 200 行
  private var logLines: [String] = []
  private func log(_ s: String) {
    let t = ISO8601DateFormatter().string(from: Date())
    logLines.append(t + " " + s)
    if logLines.count > 200 { logLines.removeFirst(logLines.count - 200) }
    if let d = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
      try? (logLines.joined(separator: "\n") + "\n").write(to: d.appendingPathComponent("island.log"), atomically: true, encoding: .utf8)
    }
  }

  func update(_ m: [String: Any]) {
    let en = ActivityAuthorizationInfo().areActivitiesEnabled
    if (m["state"] as? String) != lastState { lastState = (m["state"] as? String) ?? ""; log("msg state=\(lastState) working=\(m["working"] ?? 0) waiting=\(m["waiting"] ?? 0) enabled=\(en) existing=\(Activity<VSActivityAttributes>.activities.count)") }
    guard en else { return }
    let st = (m["state"] as? String) ?? "idle"
    // 没有在跑的了：不马上收——切到别的 App 时页面和 Mac 的连接一断，常常先报一下「空闲」，一收灵动岛就没了（偏偏是要看它的时候）。
    //   只在 App 在前台、连着空闲了 30 秒才收；在后台不收（过一刻钟系统会把它画成过时的）
    if st != "working" && st != "waiting" {
      if UIApplication.shared.applicationState != .active { return }
      if idleSince == nil { idleSince = Date() }
      if let t = idleSince, Date().timeIntervalSince(t) > 30 { log("idle 30s: end"); end() }
      return
    }
    idleSince = nil
    let ms = (m["since"] as? NSNumber)?.doubleValue ?? Date().timeIntervalSince1970 * 1000
    let lines = ((m["lines"] as? [String]) ?? []).suffix(3).map { String($0.prefix(140)) }
    let cs = VSActivityAttributes.ContentState(name: (m["name"] as? String) ?? "", state: st, detail: (m["detail"] as? String) ?? "", lines: Array(lines),
                                               since: Date(timeIntervalSince1970: ms / 1000),
                                               working: (m["working"] as? NSNumber)?.intValue ?? 0, waiting: (m["waiting"] as? NSNumber)?.intValue ?? 0)
    let sig = "\(cs.name)|\(cs.state)|\(cs.lines.joined(separator: "\n"))|\(Int(ms / 1000))|\(cs.working)|\(cs.waiting)"
    if sig == lastSig, act != nil { return }
    lastSig = sig
    let content = ActivityContent(state: cs, staleDate: Date().addingTimeInterval(15 * 60))
    if let a = act ?? Activity<VSActivityAttributes>.activities.first {
      act = a
      Task { await a.update(content) }
    } else {
      do { act = try Activity.request(attributes: VSActivityAttributes(title: "Vibing Studio"), content: content, pushType: nil); log("request ok id=\(act?.id ?? "")") }
      catch { log("request failed: \(error)") }
    }
  }

  func end() {
    lastSig = ""
    let all = Activity<VSActivityAttributes>.activities
    act = nil
    for a in all { Task { await a.end(nil, dismissalPolicy: .immediate) } }
  }
}
