// AppModel.swift —— iPad Native 界面的数据：会话列表、当前这段（标题、在不在忙、底部那一行）、Mac 连没连上、输入框里的字。
//   都是页面（ui/studio/vsnative.js）报上来的；打开 / 发话 / 停 / 新建叫页面去做（window.VSN）
import SwiftUI

struct SessionItem: Identifiable, Equatable {
  let id: String
  let kind: String
  let title: String
  let last: String
  let at: Double
  let busy: Bool
  let live: Bool
  let cwd: String
}

@MainActor
final class AppModel: ObservableObject {
  @Published var sessions: [SessionItem] = []
  @Published var activeId = ""
  @Published var activeTitle = ""
  @Published var busy = false
  @Published var status = ""
  @Published var asking = false
  @Published var macState = "connecting"
  @Published var macName = ""
  @Published var draft = ""
  @Published var query = ""
  @Published var selection: String?
  @Published var needLogin = false // 还没登录（站点给的是登录页）：Native 界面整屏换成「用 GitHub 登录」
  var listShown = false // iPhone 上点「会话」回到了列表：页面那边的状态更新不再把对话推回来（点了一段才进去）
  let host: WebHost
  var onModeChange: (String) -> Void = { _ in }

  init(host: WebHost) {
    self.host = host
    host.onMessage = { [weak self] m in self?.handle(m) }
    host.onLogin = { [weak self] v in self?.needLogin = v }
  }

  private func handle(_ m: [String: Any]) {
    #if DEBUG
    // 测试用：页面最近报上来的每种消息记一份（模拟器里 simctl spawn … defaults read beer.paimon.vibingstudio 能看）
    if let t = m["type"] as? String, let d = try? JSONSerialization.data(withJSONObject: m), let s = String(data: d, encoding: .utf8) { UserDefaults.standard.set(String(s.prefix(4000)), forKey: "debug." + t) }
    #endif
    switch m["type"] as? String {
    case "ready":
      // 测试用：-openSession cc:<会话>（同在列表里点那一行）
      if let s = UserDefaults.standard.string(forKey: "openSession"), !s.isEmpty { DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in self?.selection = s; self?.open(s) } }
    case "sessions":
      let items = (m["items"] as? [[String: Any]]) ?? []
      sessions = items.compactMap { x in
        guard let id = x["id"] as? String else { return nil }
        return SessionItem(id: id, kind: x["kind"] as? String ?? "claude", title: x["title"] as? String ?? "", last: x["last"] as? String ?? "",
                           at: (x["at"] as? NSNumber)?.doubleValue ?? 0, busy: x["busy"] as? Bool ?? false, live: x["live"] as? Bool ?? false, cwd: x["cwd"] as? String ?? "")
      }.sorted { a, b in a.busy != b.busy ? a.busy : a.at > b.at }
    case "state":
      activeId = m["id"] as? String ?? ""
      activeTitle = m["title"] as? String ?? ""
      busy = m["busy"] as? Bool ?? false
      status = m["status"] as? String ?? ""
      asking = m["asking"] as? Bool ?? false
      if !activeId.isEmpty && selection != activeId && !listShown { selection = activeId }
    case "mac":
      macState = m["state"] as? String ?? "none"
      macName = m["name"] as? String ?? ""
    case "setMode":
      onModeChange(m["mode"] as? String ?? "native")
    default:
      break
    }
  }

  var filtered: [SessionItem] {
    let q = query.trimmingCharacters(in: .whitespaces)
    return q.isEmpty ? sessions : sessions.filter { $0.title.localizedCaseInsensitiveContains(q) || $0.last.localizedCaseInsensitiveContains(q) || $0.cwd.localizedCaseInsensitiveContains(q) }
  }
  var running: [SessionItem] { filtered.filter { $0.busy } }
  var recent: [SessionItem] { filtered.filter { !$0.busy } }

  func open(_ id: String) { if id != activeId { host.js("window.VSN && VSN.open(\(Self.jsString(id)))") } }
  func send() {
    let t = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !t.isEmpty, !activeId.isEmpty else { return }
    host.js("window.VSN && VSN.send(\(Self.jsString(t)))")
    draft = ""
  }
  func stop() { host.js("window.VSN && VSN.stop()") }
  func newSession() { host.js("window.VSN && VSN.newSession()") }
  func refresh() { host.js("window.VSN && VSN.refresh()") }

  // 一段字写成 JS 的字符串字面量（JSON 编码：引号、换行、反斜杠都转义好）
  static func jsString(_ s: String) -> String {
    guard let d = try? JSONSerialization.data(withJSONObject: [s]), let a = String(data: d, encoding: .utf8) else { return "\"\"" }
    return String(a.dropFirst().dropLast())
  }
}
