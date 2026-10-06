// BootView.swift —— 打开 App 到能用之前浮在中间的一张玻璃卡片（不盖满整屏、不挡下面）：只写真的在发生的事，不放装样子的动画——
//   载入页面：进度条就是 WebKit 报的载入进度（estimatedProgress）；之后是页面报上来的每一步（remote.js 的 boot）：
//   找 Mac、连 Mac（哪一台、等了几秒）、读会话；出错写出错在哪（打不开站点、Mac 不在线、Mac 没授权、页面脚本出错）和「重试」。
//   页面说能用了（ready）就收起；页面自己弹了选择 / 说明（选哪台 Mac）也收起，交给页面
import UIKit

struct BootState: Equatable {
  var progress: Double = 0      // 页面载入进度（WebKit 的），0…1
  var loading = true            // 页面还在载入
  var step = "page"             // page / finding / connecting / waiting / sessions / ready / veil / login / offline / nomac / denied / failed
  var mac = ""                  // 连的是哪台 Mac
  var since = Date()            // 这一步从什么时候开始
  var error = ""                // 出错的说明（页面打不开、脚本出错……）
}

@MainActor
final class BootView: UIView {
  // 不再是盖满整屏的一块黑：只有中间一张玻璃卡片（iOS 26 起是液态玻璃，以前的系统是毛玻璃），卡片以外的地方点得到下面
  private let card: UIVisualEffectView
  private let bar = UIProgressView(progressViewStyle: .default)
  private let title = UILabel()
  private let detail = UILabel()
  private let spinner = UIActivityIndicatorView(style: .medium)
  private let retry = UIButton(type: .system)
  private var timer: Timer?
  private var state = BootState()
  var onRetry: () -> Void = {}

  override init(frame: CGRect) {
    if #available(iOS 26.0, *) {
      card = UIVisualEffectView(effect: UIGlassEffect(style: .regular))
      card.cornerConfiguration = .capsule(maximumRadius: 26)
    } else {
      card = UIVisualEffectView(effect: UIBlurEffect(style: .systemThinMaterial))
      card.layer.cornerRadius = 22
      card.layer.cornerCurve = .continuous
      card.clipsToBounds = true
    }
    super.init(frame: frame)
    backgroundColor = .clear
    bar.trackTintColor = UIColor.label.withAlphaComponent(0.1)
    bar.progressTintColor = UIColor.label.withAlphaComponent(0.7)
    title.textColor = .label
    title.font = .systemFont(ofSize: 16, weight: .semibold)
    title.textAlignment = .center
    title.numberOfLines = 0
    detail.textColor = .secondaryLabel
    detail.font = .systemFont(ofSize: 13)
    detail.textAlignment = .center
    detail.numberOfLines = 0
    spinner.hidesWhenStopped = true
    retry.setTitle("重试", for: .normal)
    retry.titleLabel?.font = .systemFont(ofSize: 15, weight: .medium)
    retry.addAction(UIAction { [weak self] _ in self?.onRetry() }, for: .touchUpInside)
    let stack = UIStackView(arrangedSubviews: [spinner, title, detail, retry, bar])
    stack.axis = .vertical
    stack.alignment = .center
    stack.spacing = 8
    stack.translatesAutoresizingMaskIntoConstraints = false
    card.translatesAutoresizingMaskIntoConstraints = false
    card.contentView.addSubview(stack)
    addSubview(card)
    NSLayoutConstraint.activate([
      card.centerXAnchor.constraint(equalTo: centerXAnchor),
      card.centerYAnchor.constraint(equalTo: centerYAnchor),
      card.widthAnchor.constraint(lessThanOrEqualTo: widthAnchor, multiplier: 0.84),
      card.widthAnchor.constraint(greaterThanOrEqualToConstant: 220),
      stack.topAnchor.constraint(equalTo: card.contentView.topAnchor, constant: 18),
      stack.bottomAnchor.constraint(equalTo: card.contentView.bottomAnchor, constant: -18),
      stack.leadingAnchor.constraint(equalTo: card.contentView.leadingAnchor, constant: 22),
      stack.trailingAnchor.constraint(equalTo: card.contentView.trailingAnchor, constant: -22),
      bar.widthAnchor.constraint(equalTo: stack.widthAnchor),
    ])
    timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.render() } } // 等了几秒：每秒写一次
  }
  required init?(coder: NSCoder) { fatalError("init(coder:)") }

  // 卡片以外：不拦（下面的登录页、会话列表照样点得到）
  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    let v = super.hitTest(point, with: event)
    return v === self ? nil : v
  }

  func update(_ s: BootState) { state = s; render() }

  private func render() {
    let s = state, secs = Int(Date().timeIntervalSince(s.since))
    let wait = secs >= 3 ? "（\(secs) 秒）" : ""
    bar.isHidden = !s.loading
    bar.setProgress(Float(s.progress), animated: true)
    var t = "", d = "", busy = true, canRetry = false
    switch s.step {
    case "failed": t = "无法打开 Vibing Studio"; d = s.error; busy = false; canRetry = true
    case "offline": t = "Mac 不在线" + wait; d = "正在重新连接\(s.mac.isEmpty ? "" : "「\(s.mac)」")。请确认 Mac 上的 Vibing Studio 已打开，并启用了「设置 › 通用 › 其他设备使用这台 Mac」。"; canRetry = secs >= 10
    case "nomac": t = "没有可连接的 Mac"; d = "请在 Mac 上打开 Vibing Studio，并启用「设置 › 通用 › 其他设备使用这台 Mac」。"; busy = false; canRetry = true
    case "denied": t = "这台 Mac 未授权此 iPad"; d = "请在 Mac 上的 Vibing Studio 中允许此设备，然后重试。"; busy = false; canRetry = true
    case "finding": t = "正在查找你的 Mac" + wait
    case "connecting": t = "正在连接 Mac" + (s.mac.isEmpty ? "" : "「\(s.mac)」") + wait; canRetry = secs >= 15
    case "waiting": t = "正在等待 Mac 响应" + (s.mac.isEmpty ? "" : "「\(s.mac)」") + wait; canRetry = secs >= 15
    case "sessions": t = "正在读取会话" + wait
    default: t = s.loading ? "正在载入界面 \(Int((s.progress * 100).rounded()))%" : "正在启动界面" + wait; canRetry = !s.loading && secs >= 15
    }
    if !s.error.isEmpty && s.step != "failed" { d = (d.isEmpty ? "" : d + "\n") + "页面出错：" + s.error }
    title.text = t
    detail.text = d
    detail.isHidden = d.isEmpty
    retry.isHidden = !canRetry
    if busy { spinner.startAnimating() } else { spinner.stopAnimating() }
  }
}
