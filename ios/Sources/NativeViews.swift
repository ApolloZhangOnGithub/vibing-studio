// NativeViews.swift —— iPad Native 界面（SwiftUI）：屏幕全给对话——上面什么都没有（没有状态栏、标题栏），
//   下面一排浮在对话上：「会话」（拉出会话列表）、输入框、「发送」、「更多」（新建会话、打断这一轮、切换到 Classic）。
//   在忙的时候发也是「发送」（同 Claude Code：排着，它下一步读到）；打断同 Claude Code 按 Esc（没键盘时在「更多」里）。
//   会话列表：竖着拿时平时收着、点了一段就收回；横着拿时一直在左边（窄的一栏）。
//   Mac 连没连上不一直写着：只有断了时输入框上面一行字。图标只用 Claude Code、Codex 自己的标志（同网页版的那两个）
import SwiftUI
import WebKit

private let claudeOrange = Color(red: 0.843, green: 0.467, blue: 0.341)

struct NativeRoot: View {
  @ObservedObject var m: AppModel
  @State private var vis: NavigationSplitViewVisibility = .automatic
  @State private var portrait = false
  @Environment(\.horizontalSizeClass) private var hsc
  // iPhone（窄）：一层一层——先是会话列表，点一段进去是对话；对话里点「会话」回到列表。iPad（宽）：列表在左边、对话在右边
  private var compact: Bool { hsc == .compact }

  var body: some View {
    if m.needLogin { LoginScreen(m: m) } else { main }
  }

  private var main: some View {
    GeometryReader { g in
      NavigationSplitView(columnVisibility: $vis) {
        SessionList(m: m)
          .navigationSplitViewColumnWidth(min: 240, ideal: 280, max: 320)
      } detail: {
        Conversation(m: m, compact: compact, showList: { if compact { m.listShown = true; m.selection = nil } else { withAnimation { vis = vis == .detailOnly ? .all : .detailOnly } } })
          .toolbar(.hidden, for: .navigationBar)
      }
      .onAppear { orient(g.size, first: true) }
      .onChange(of: g.size) { _, s in orient(s, first: false) }
      // 竖着拿时：点了一段对话，列表收回去（对话占满整个宽）
      .onChange(of: m.activeId) { _, id in if portrait && !compact && !id.isEmpty { withAnimation { vis = .detailOnly } } }
    }
    .statusBarHidden(!compact) // iPhone 上留着时间、电量那一行（对话不压到灵动岛下面）
  }

  private func orient(_ s: CGSize, first: Bool) {
    if compact { return }
    let p = s.width < s.height
    if !first && p == portrait { return }
    portrait = p
    vis = p ? (m.activeId.isEmpty ? .all : .detailOnly) : .all
  }
}

// ---- 还没登录：整屏一个「用 GitHub 登录」（系统的登录页，用 Safari 里登着的 GitHub），登好了回到会话列表 ----
struct LoginScreen: View {
  @ObservedObject var m: AppModel

  var body: some View {
    VStack(spacing: 14) {
      Spacer()
      Text("Vibing Studio").font(.largeTitle.weight(.bold))
      Text("登录后连接到你的 Mac，使用上面的会话、终端和文件。")
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
        .padding(.horizontal, 32)
      Spacer()
      login
        .padding(.bottom, 48)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color(uiColor: .systemBackground))
  }

  @ViewBuilder private var login: some View {
    let b = Button { m.host.login() } label: { Text("使用 GitHub 登录").font(.body.weight(.semibold)).padding(.horizontal, 22).padding(.vertical, 6) }
    if #available(iOS 26.0, *) { b.buttonStyle(.glassProminent) } else { b.buttonStyle(.borderedProminent).buttonBorderShape(.capsule) }
  }
}

// ---- 会话列表 ----
struct SessionList: View {
  @ObservedObject var m: AppModel

  var body: some View {
    List(selection: Binding(get: { m.selection }, set: { id in m.selection = id; if let id { m.listShown = false; m.open(id) } })) {
      if !m.running.isEmpty {
        Section("运行中") { ForEach(m.running) { SessionRow(s: $0).tag($0.id) } }
      }
      Section(m.running.isEmpty ? "会话" : "最近") {
        ForEach(m.recent) { SessionRow(s: $0).tag($0.id) }
      }
    }
    .listStyle(.sidebar)
    .environment(\.defaultMinListRowHeight, 34)
    .overlay {
      if m.sessions.isEmpty {
        ContentUnavailableView(m.macState == "open" ? "还没有会话" : "正在连接你的 Mac", systemImage: "laptopcomputer",
                               description: Text(m.macState == "open" ? "用右上角的「新建」开一个 Claude Code 会话。" : "Mac 上的 Vibing Studio 要开着，并在 设置 › 通用 里打开「其他设备使用这台 Mac」。"))
      }
    }
    .searchable(text: $m.query, placement: .sidebar, prompt: "搜索会话")
    .refreshable { m.refresh() }
    .navigationTitle("会话")
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) { Button("新建") { m.newSession() } }
    }
  }
}

struct SessionRow: View {
  let s: SessionItem

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      Image(s.kind == "codex" ? "OpenAILogo" : "ClaudeLogo")
        .resizable()
        .renderingMode(.template)
        .scaledToFit()
        .frame(width: 13, height: 13)
        .foregroundStyle(s.busy ? (s.kind == "codex" ? Color.primary : claudeOrange) : Color.secondary)
        .alignmentGuide(.firstTextBaseline) { d in d[.bottom] - 1 }
      VStack(alignment: .leading, spacing: 1) {
        HStack(alignment: .firstTextBaseline) {
          Text(s.title.isEmpty ? "未命名会话" : s.title).font(.subheadline.weight(.medium)).lineLimit(1)
          Spacer(minLength: 6)
          Text(Self.when(s.at)).font(.caption2).foregroundStyle(.secondary)
        }
        if !s.last.isEmpty {
          Text(s.last).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
      }
    }
    .padding(.vertical, 1)
  }

  static func when(_ ms: Double) -> String {
    guard ms > 0 else { return "" }
    let f = RelativeDateTimeFormatter()
    f.unitsStyle = .short
    return f.localizedString(for: Date(timeIntervalSince1970: ms / 1000), relativeTo: Date())
  }
}

// ---- 对话：整屏的网页（只画这一段对话），下面浮着一排 ----
struct Conversation: View {
  @ObservedObject var m: AppModel
  var compact = false
  let showList: () -> Void

  var body: some View {
    ZStack(alignment: .bottom) {
      WebHostView(web: m.host.web)
        .ignoresSafeArea(edges: compact ? .bottom : .all) // iPhone：上面让出灵动岛、时间那一行
      if m.activeId.isEmpty {
        ContentUnavailableView("选一个会话", systemImage: "text.bubble", description: Text("点下面的「会话」，从列表里选一个。"))
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .background(Color(uiColor: .systemBackground))
      }
      VStack(alignment: .leading, spacing: 6) {
        if m.macState == "offline" {
          Note(text: "Mac 暂时连不上，正在重连")
        } else if !m.activeId.isEmpty && !m.status.isEmpty {
          Note(text: Self.plain(m.status), tint: m.busy ? claudeOrange : .secondary)
        }
        BottomBar(m: m, showList: showList)
      }
      .padding(.horizontal, 10)
      .padding(.bottom, 8)
    }
  }

  // 底下那一行状态：去掉开头的转圈那个字（只要字）
  static func plain(_ s: String) -> String {
    var t = s.trimmingCharacters(in: .whitespaces)
    while let c = t.first, "·✢✳✶✻✽*\u{FE0E} ".contains(c) { t.removeFirst() }
    return t
  }
}

struct Note: View {
  let text: String
  var tint: Color = .secondary

  var body: some View {
    Text(text)
      .font(.caption.monospaced())
      .foregroundStyle(tint)
      .lineLimit(1)
      .padding(.horizontal, 10)
      .padding(.vertical, 4)
      .background(.ultraThinMaterial, in: Capsule())
  }
}

// 浮在最下面的一排：会话 · 输入框 · 发送 · 更多
struct BottomBar: View {
  @ObservedObject var m: AppModel
  let showList: () -> Void
  @FocusState private var focused: Bool

  private var empty: Bool { m.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

  var body: some View {
    HStack(alignment: .bottom, spacing: 8) {
      Button("会话", action: showList)
        .buttonStyle(.bordered)
      TextField(m.activeId.isEmpty ? "先选一个会话" : "回复", text: $m.draft, axis: .vertical)
        .lineLimit(1...8)
        .focused($focused)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color(uiColor: .secondarySystemBackground)))
        .onKeyPress(.return, phases: .down) { p in
          if p.modifiers.contains(.shift) { return .ignored } // Shift+回车：换行
          m.send()
          return .handled
        }
        .onKeyPress(.escape) { // 同 Claude Code：Esc 打断这一轮
          if m.busy { m.stop(); return .handled }
          return .ignored
        }
        .disabled(m.activeId.isEmpty)
      Button("发送") { m.send() }
        .buttonStyle(.bordered)
        .disabled(m.activeId.isEmpty || empty)
      Menu("更多") {
        Button("新建会话") { m.newSession() }
        if m.busy { Button("打断这一轮") { m.stop() } }
        Button("切换到 Classic 界面") { m.onModeChange("classic") }
      }
      .buttonStyle(.bordered)
    }
    .padding(8)
    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
  }
}

// 那一个 WKWebView 放进 SwiftUI（Classic 和 Native 共用它：换界面时从原来的地方拿过来）
struct WebHostView: UIViewRepresentable {
  let web: WKWebView

  func makeUIView(context: Context) -> UIView {
    let c = UIView()
    c.backgroundColor = .clear
    attach(to: c)
    return c
  }

  func updateUIView(_ v: UIView, context: Context) { if web.superview !== v { attach(to: v) } }

  private func attach(to c: UIView) {
    web.removeFromSuperview()
    web.translatesAutoresizingMaskIntoConstraints = false
    c.addSubview(web)
    NSLayoutConstraint.activate([
      web.topAnchor.constraint(equalTo: c.topAnchor),
      web.bottomAnchor.constraint(equalTo: c.bottomAnchor),
      web.leadingAnchor.constraint(equalTo: c.leadingAnchor),
      web.trailingAnchor.constraint(equalTo: c.trailingAnchor),
    ])
  }
}
