// App.swift —— Vibing Studio 的 iPad 版：一个窗口，两种界面（记住选的那种，默认 iPad Native）——
//   iPad Native：SwiftUI 画会话列表、输入框、顶栏，网页只画当前这段对话（NativeViews.swift）
//   Classic：整屏就是网页版的完整工作台（WebViewController.swift 的 ClassicViewController）
//   两种共用同一个网页（WebHost）：换界面时页面按新的样子重新载入
import UIKit
import SwiftUI

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
  func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool { true }

  func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
    let c = UISceneConfiguration(name: "Default", sessionRole: connectingSceneSession.role)
    c.delegateClass = SceneDelegate.self
    return c
  }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?
  private var host: WebHost!
  private var model: AppModel!
  private var bootView: BootView?

  private static let modeKey = "uiMode"
  // 先把完整的工作台（Classic，同 Mac 版的界面）做好：iPhone 只用它；iPad 默认也是它（选过 Native 的照旧）
  private var mode: String {
    if UIDevice.current.userInterfaceIdiom == .phone { return "classic" }
    return UserDefaults.standard.string(forKey: Self.modeKey) == "native" ? "native" : "classic"
  }

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    guard let ws = scene as? UIWindowScene else { return }
    MainActor.assumeIsolated {
      let w = UIWindow(windowScene: ws)
      w.backgroundColor = .black
      window = w
      host = WebHost(shell: mode)
      model = AppModel(host: host)
      model.onModeChange = { [weak self] m in self?.setMode(m) }
      host.presenter = { [weak w] in w?.rootViewController }
      w.rootViewController = rootFor(mode)
      w.makeKeyAndVisible()
      // 画中画先不要了（用户：做灵动岛）：PiPController 的代码留着，不挂上去
      // 打开到能用之前：盖一层写着真的在做什么（BootView）；页面说能用了（ready）、或者页面自己弹出选择 / 说明（veil）就收起
      let bv = BootView(frame: w.bounds)
      bv.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      bv.onRetry = { [weak self] in self?.host.start() }
      w.addSubview(bv)
      bootView = bv
      host.onBoot = { [weak self] b in self?.showBoot(b) }
      host.start()
    }
  }

  @MainActor private func rootFor(_ m: String) -> UIViewController {
    if m == "classic" { return ClassicViewController(host: host) }
    let vc = NativeHostingController(rootView: NativeRoot(m: model))
    vc.view.backgroundColor = .systemBackground
    return vc
  }

  private func showBoot(_ b: BootState) {
    guard let bv = bootView, let w = window else { return }
    let done = b.step == "ready" || b.step == "veil" || b.step == "login" // 登录页：卡片收起，登录按钮露出来
    if done {
      if bv.superview != nil && bv.alpha > 0 { UIView.animate(withDuration: 0.2, animations: { bv.alpha = 0 }) { _ in if bv.alpha == 0 { bv.isHidden = true } } }
      return
    }
    bv.update(b)
    if bv.superview !== w { w.addSubview(bv) }
    w.bringSubviewToFront(bv)
    if bv.isHidden || bv.alpha < 1 { bv.isHidden = false; bv.alpha = 1 }
  }

  // 换界面：记下来，换掉窗口里的那一层，页面按新的样子重新载入
  @MainActor private func setMode(_ m: String) {
    let mm = m == "classic" || UIDevice.current.userInterfaceIdiom == .phone ? "classic" : "native" // iPhone 只用 Classic
    guard mm != mode || window?.rootViewController == nil else { return }
    UserDefaults.standard.set(mm, forKey: Self.modeKey)
    window?.rootViewController = rootFor(mm)
    host.setShell(mm)
    if let bv = bootView { window?.bringSubviewToFront(bv) }
  }
}

// iPad Native：不要最上面那行时间、电量（同 Classic），屏幕都给对话
final class NativeHostingController: UIHostingController<NativeRoot> {
  override var prefersStatusBarHidden: Bool { true }
  override var prefersHomeIndicatorAutoHidden: Bool { true }
}
