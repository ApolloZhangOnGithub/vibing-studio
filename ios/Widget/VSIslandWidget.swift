// VSIslandWidget.swift —— 灵动岛和锁屏：只放内容（会话最近说的话、正在执行的命令，最新的在最上面），不写「在跑」「工作中」「N 个……」这些字。
//   紧凑的灵动岛：左边 Claude 标志（忙时橙色、等你时蓝色），右边用时（等你时一个蓝点）；长按展开、锁屏卡片：会话名 + 最新的几行内容
import ActivityKit
import SwiftUI
import WidgetKit

private let orange = Color(red: 0.851, green: 0.467, blue: 0.341)
private let blue = Color(red: 0.039, green: 0.518, blue: 1.0)

private func tint(_ s: VSActivityAttributes.ContentState) -> Color { s.state == "waiting" ? blue : orange }
private func content(_ s: VSActivityAttributes.ContentState) -> [String] {
  let l = s.lines.filter { !$0.isEmpty }
  return l.isEmpty ? (s.detail.isEmpty ? [] : [s.detail]) : l
}

private struct Logo: View {
  let color: Color
  var size: CGFloat = 16
  var body: some View { Image("ClaudeLogo").resizable().renderingMode(.template).scaledToFit().frame(width: size, height: size).foregroundStyle(color) }
}

private struct Elapsed: View {
  let since: Date
  var body: some View { Text(timerInterval: since...Date.distantFuture, countsDown: false).monospacedDigit() }
}

private struct Lines: View {
  let lines: [String]
  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      ForEach(Array(lines.prefix(3).enumerated()), id: \.offset) { i, l in
        Text(l).font(i == 0 ? .callout.weight(.medium) : .footnote).foregroundStyle(i == 0 ? .primary : .secondary).lineLimit(i == 0 ? 3 : 1)
      }
    }
  }
}

struct VSIslandLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: VSActivityAttributes.self) { ctx in
      // 锁屏：会话名一行小字，下面是内容
      let s = ctx.state
      VStack(alignment: .leading, spacing: 6) {
        HStack(spacing: 6) {
          Logo(color: tint(s), size: 14)
          Text(s.name.isEmpty ? "Vibing Studio" : s.name).font(.caption.weight(.semibold)).lineLimit(1)
        }
        Lines(lines: content(s))
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(14)
      .activityBackgroundTint(nil)
    } dynamicIsland: { ctx in
      let s = ctx.state
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) { Logo(color: tint(s), size: 18) }
        DynamicIslandExpandedRegion(.center) { Text(s.name.isEmpty ? "Vibing Studio" : s.name).font(.subheadline.weight(.semibold)).lineLimit(1) }
        DynamicIslandExpandedRegion(.bottom) { Lines(lines: content(s)).frame(maxWidth: .infinity, alignment: .leading) }
      } compactLeading: {
        Logo(color: tint(s), size: 14)
      } compactTrailing: {
        if s.state == "waiting" { Circle().fill(blue).frame(width: 8, height: 8) }
        else { Elapsed(since: s.since).font(.caption2).frame(maxWidth: 44) }
      } minimal: {
        Logo(color: tint(s), size: 14)
      }
    }
  }
}

@main
struct VSWidgets: WidgetBundle {
  var body: some Widget { VSIslandLiveActivity() }
}
