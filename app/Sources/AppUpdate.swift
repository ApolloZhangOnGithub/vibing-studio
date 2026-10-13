// AppUpdate.swift —— 退出时换上「待更新」里放好的新版（~/Library/Application Support/Vibing Studio/update/：页面下载的、tools/stage-app.sh 放的）。
//   同 Chrome、VS Code：只改了带的小工具、界面的新版不用专门重启——哪次退出就哪次换上，下次打开就是新的；
//   页面点了「重启以更新」（app.restartToUpdate）的换好再打开。换的是一个独立的小脚本：等这个进程退出、查过新版的签名再换。
//   原地换（2026-10-14 起）：「应用程序」里那一份的文件夹不动，里面的东西换成新的。以前是把旧的整个挪进 previous/、新的挪进来——
//   程序坞上的图标、系统设置里的权限都跟着挪走的那一份走：iMac 上点程序坞一直打开的是 10 月 9 日那份旧的（权限开着也一直要，用户 2026-10-14）。
//   换下来的旧版打成 zip 放在 previous/rollback.noindex（回退用；不是 .app，系统不会把它当成 App）。
//   打开时发现自己是备份里、废纸篓里的那一份：改去打开「应用程序」里的那一份（程序坞上指着旧的那个图标也改过来）
import AppKit

@MainActor
enum AppUpdate {
  static var relaunch = false // 这一次退出是「重启以更新」：换好再打开
  static var home: String { ProcessInfo.processInfo.environment["NADOS_HOME"] ?? NSHomeDirectory() }
  static var dir: String { home + "/Library/Application Support/Vibing Studio/update" }
  static let canonical = "/Applications/Vibing Studio.app"
  static var testing: Bool { ProcessInfo.processInfo.environment["NADOS_HOME"] != nil }

  static func build(ofApp path: String) -> Int {
    guard let d = NSDictionary(contentsOfFile: path + "/Contents/Info.plist"), let v = d["CFBundleVersion"] as? String else { return 0 }
    return Int(v) ?? 0
  }
  static var currentBuild: Int { Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "") ?? 0 }
  // 放好的新版比现在跑的新：页面问（info 里写着）
  static var staged: Int {
    let b = build(ofApp: dir + "/Vibing Studio.app")
    return b > currentBuild ? b : 0
  }
  // 换到哪：「应用程序」里那一份；没有的话（装在别处）才用正在跑的这一份——但备份里、废纸篓里的不算
  static var target: String {
    let me = Bundle.main.bundlePath
    if FileManager.default.fileExists(atPath: canonical) || stray(me) { return canonical }
    return me
  }
  // 备份里（previous/、待更新）、废纸篓里的那一份
  static func stray(_ p: String) -> Bool { p.contains("/Library/Application Support/Vibing Studio/") || p.contains("/.Trash/") }

  private static func q(_ s: String) -> String { "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'" }
  // 换的那几步（同页面 studio.js 的 installSh）：APP、NEW、R（回退用的 zip 放哪）、T（废纸篓）已经设好
  static let installLines = [
    "LSR=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
    "mkdir -p \"$R\"",
    "OLDV=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \"$APP/Contents/Info.plist\" 2>/dev/null || echo old)",
    // 回退用：现在这一份打成 zip（不是 .app，点不开、「打开方式」里没有、程序坞指不过去）
    "[ -d \"$APP\" ] && /usr/bin/ditto -c -k --keepParent \"$APP\" \"$R/Vibing Studio $OLDV $(date +%Y%m%d-%H%M%S).zip\"",
    // 原地换：文件夹不动，里面换成新的
    "if [ -d \"$APP\" ]; then /usr/bin/rsync -a --delete \"$NEW/\" \"$APP/\"; else /usr/bin/ditto \"$NEW\" \"$APP\"; fi",
    // 换坏了（签名不对）：用刚打的 zip 放回去
    "if ! /usr/bin/codesign --verify --strict \"$APP\" >/dev/null 2>&1; then Z=$(ls -1t \"$R\"/*.zip 2>/dev/null | head -1); if [ -n \"$Z\" ]; then mv \"$APP\" \"$T/Vibing Studio broken $(date +%H%M%S).app\"; /usr/bin/ditto -x -k \"$Z\" \"$(dirname \"$APP\")\"; fi; fi",
    // 放好的那份已经换上了：它自己不再留着当一个 App
    "\"$LSR\" -u \"$NEW\" >/dev/null 2>&1; [ -d \"$NEW\" ] && mv \"$NEW\" \"$T/Vibing Studio update $(date +%Y%m%d-%H%M%S).app\"",
    "\"$LSR\" -f \"$APP\" >/dev/null 2>&1",
  ]
  // 以前留下的一份份旧版 .app（previous/、rollback.noindex）：打成 zip，.app 挪进废纸篓；程序坞上指着它们的图标改指「应用程序」里那一份
  static let tidyLines = [
    "LSR=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
    "for d in \"$P\" \"$P/rollback.noindex\"; do [ -d \"$d\" ] || continue; ls -1 \"$d\" | grep -E '\\.app$' | while IFS= read -r f; do a=\"$d/$f\"; \"$LSR\" -u \"$a\" >/dev/null 2>&1; mkdir -p \"$P/rollback.noindex\"; [ -e \"$P/rollback.noindex/${f%.app}.zip\" ] || /usr/bin/ditto -c -k --keepParent \"$a\" \"$P/rollback.noindex/${f%.app}.zip\"; mv \"$a\" \"$T/${f%.app} $(date +%H%M%S)-$$.app\"; done; done",
    // 程序坞：指着备份、废纸篓里那一份的图标改指「应用程序」里那一份（已经有一个指着它的：去掉指错的那个）。先导出一份留着
    "DB=\"$P/../dock-backup\"; mkdir -p \"$DB\"; F=\"$DB/dock-$(date +%Y%m%d-%H%M%S).plist\"; W=\"${F%.plist}-fixed.plist\"",
    "if /usr/bin/defaults export com.apple.dock \"$F\" 2>/dev/null && cp \"$F\" \"$W\"; then",
    "  PB=/usr/libexec/PlistBuddy; i=0; ok=0; ch=0",
    "  while $PB -c \"Print :persistent-apps:$i\" \"$W\" >/dev/null 2>&1; do u=$($PB -c \"Print :persistent-apps:$i:tile-data:file-data:_CFURLString\" \"$W\" 2>/dev/null); case \"$u\" in *'/Applications/Vibing%20Studio.app'*) ok=1;; esac; i=$((i+1)); done",
    "  i=0; while $PB -c \"Print :persistent-apps:$i\" \"$W\" >/dev/null 2>&1; do u=$($PB -c \"Print :persistent-apps:$i:tile-data:file-data:_CFURLString\" \"$W\" 2>/dev/null)",
    "    case \"$u\" in *'Application%20Support/Vibing%20Studio/'*|*'/.Trash/Vibing%20Studio'*)",
    "      if [ $ok = 1 ]; then $PB -c \"Delete :persistent-apps:$i\" \"$W\"; ch=1; continue; fi",
    "      $PB -c \"Set :persistent-apps:$i:tile-data:file-data:_CFURLString file:///Applications/Vibing%20Studio.app/\" \"$W\"; $PB -c \"Delete :persistent-apps:$i:tile-data:book\" \"$W\" 2>/dev/null; ok=1; ch=1;;",
    "    esac; i=$((i+1)); done",
    "  if [ $ch = 1 ]; then /usr/bin/defaults import com.apple.dock \"$W\" && /usr/bin/killall Dock; fi",
    "fi",
  ]

  // 退出时（applicationWillTerminate）：有比现在新的就起脚本换
  static func swapAtQuit() {
    let new = dir + "/Vibing Studio.app", app = target
    guard build(ofApp: new) > currentBuild else { return }
    let pf = dir + "/swap.pid"
    if let s = try? String(contentsOfFile: pf, encoding: .utf8), let p = Int32(s.trimmingCharacters(in: .whitespacesAndNewlines)), p > 0, kill(p, 0) == 0 { return } // 页面的脚本在等
    let prev = (dir as NSString).deletingLastPathComponent + "/previous"
    // 自动测试（假的家目录）：不真的打开 App（打开的会是没有测试环境变量的那一份），记一笔；也不动程序坞
    let open = testing ? "echo \"$APP\" > \(q(dir + "/relaunched.txt"))" : "open \"$APP\""
    let sh = [
      "trap '' TERM HUP INT", // 注销、关机时也把这一换做完
      "PF=\(q(pf)); echo $$ > \"$PF\"",
      "APP=\(q(app)); NEW=\(q(new)); P=\(q(prev)); R=\"$P/rollback.noindex\"; T=\(q(home + "/.Trash")); PID=\(getpid()); RELAUNCH=\(relaunch ? 1 : 0)",
      "i=0; while kill -0 $PID 2>/dev/null && [ $i -lt 600 ]; do sleep 0.1; i=$((i+1)); done", // 等这个进程退出：最多 1 分钟
      "kill -0 $PID 2>/dev/null && exit 0",
      "[ -d \"$NEW\" ] || exit 0",
      "if ! /usr/bin/codesign --verify --strict \"$NEW\" >/dev/null 2>&1 || /usr/sbin/spctl -a -t exec -vv \"$NEW\" 2>&1 | grep -q REVOKED; then mkdir -p \"$P\" && mv \"$NEW\" \"$T/Vibing Studio rejected $(date +%Y%m%d-%H%M%S).app\"; [ $RELAUNCH = 1 ] && \(open); exit 0; fi",
    ] + installLines + (testing ? [] : tidyLines) + [
      "[ $RELAUNCH = 1 ] || exit 0",
      open,
    ]
    run(sh.joined(separator: "\n") + "\n", name: "swap-at-quit.sh")
  }

  // 打开时：自己是备份里、废纸篓里的那一份（程序坞上的图标跟着旧的走了）——「应用程序」里那一份比这份新或一样：退出这份、打开那份（顺手把程序坞改过来）；
  //   这份更新（换反了）：先原地装进「应用程序」，再打开那份。返回 true = 这份马上要退出
  static func relocateIfStray() -> Bool {
    let me = Bundle.main.bundlePath
    guard !testing, stray(me), me != canonical else { return false }
    let mine = currentBuild, there = build(ofApp: canonical)
    let prev = (dir as NSString).deletingLastPathComponent + "/previous"
    var sh = [
      "trap '' TERM HUP INT",
      "APP=\(q(canonical)); NEW=\(q(me)); P=\(q(prev)); R=\"$P/rollback.noindex\"; T=\(q(home + "/.Trash")); PID=\(getpid())",
      "i=0; while kill -0 $PID 2>/dev/null && [ $i -lt 600 ]; do sleep 0.1; i=$((i+1)); done",
      "kill -0 $PID 2>/dev/null && exit 0",
    ]
    if mine > there { sh += installLines.filter { !$0.contains("mv \"$NEW\"") } } // 这份更新：装进去（这份本身留着，下面一起收拾）
    sh += tidyLines + ["open \"$APP\""]
    run(sh.joined(separator: "\n") + "\n", name: "relocate.sh")
    return true
  }

  // 脚本单独起一个会话（setsid）：App 退了它还在
  private static func run(_ sh: String, name: String) {
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    let script = dir + "/" + name
    guard (try? sh.write(toFile: script, atomically: true, encoding: .utf8)) != nil else { return }
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/perl")
    p.arguments = ["-e", "use POSIX qw(setsid); exit 0 if fork; setsid(); open STDIN, '</dev/null'; open STDOUT, '>/dev/null'; open STDERR, '>&STDOUT'; exec '/bin/sh', $ARGV[0]", script]
    do { try p.run(); p.waitUntilExit() } catch { return }
  }
}
