// VSActivity.swift —— 灵动岛 / 锁屏上的实时活动的数据（App 和小组件扩展共用）：
//   最要紧的那个会话（等你的优先，其次最近开始跑的）叫什么、是在跑还是在等你、在干什么、从什么时候开始；一共几个在跑、几个在等你
import ActivityKit
import Foundation

struct VSActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var name: String
    var state: String   // working / waiting
    var detail: String
    var lines: [String] // 要看的内容：它最近说的话、在跑的命令（最多 3 行，最新的在最后）
    var since: Date
    var working: Int
    var waiting: Int
  }
  var title: String
}
