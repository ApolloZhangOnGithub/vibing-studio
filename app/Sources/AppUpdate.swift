// AppUpdate.swift —— 退出时换上「待更新」里放好的新版（~/Library/Application Support/Vibing Studio/update/：页面下载的、tools/stage-app.sh 放的）。
//   同 Chrome、VS Code：只改了带的小工具、界面的新版不用专门重启——哪次退出就哪次换上，下次打开就是新的；
//   页面点了「重启以更新」（app.restartToUpdate）的换好再打开。换的是一个独立的小脚本：等这个进程退出、查过新版的签名
//   （证书被吊销的 macOS 会当恶意软件扔掉）再换；旧版挪进 previous/（不删）。页面的老办法（swap.sh）已经在等的，交给它
import AppKit

@MainActor
enum AppUpdate {
  static var relaunch = false // 这一次退出是「重启以更新」：换好再打开
  static var home: String { ProcessInfo.processInfo.environment["NADOS_HOME"] ?? NSHomeDirectory() }
  static var dir: String { home + "/Library/Application Support/Vibing Studio/update" }

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

  // 退出时（applicationWillTerminate）：有比现在新的就起脚本换
  static func swapAtQuit() {
    let new = dir + "/Vibing Studio.app", app = Bundle.main.bundlePath
    guard build(ofApp: new) > currentBuild else { return }
    let pf = dir + "/swap.pid"
    if let s = try? String(contentsOfFile: pf, encoding: .utf8), let p = Int32(s.trimmingCharacters(in: .whitespacesAndNewlines)), p > 0, kill(p, 0) == 0 { return } // 页面的脚本在等
    let prev = (dir as NSString).deletingLastPathComponent + "/previous"
    let q = { (s: String) in "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'" }
    // 自动测试（假的家目录）：不真的打开 App（打开的会是没有测试环境变量的那一份），记一笔
    let open = ProcessInfo.processInfo.environment["NADOS_HOME"] != nil ? "echo \"$APP\" > \(q(dir + "/relaunched.txt"))" : "open \"$APP\""
    let sh = [
      "trap '' TERM HUP INT", // 注销、关机时也把这一换做完（两次 mv 之间断了会留下一个没有 App 的「应用程序」）
      "PF=\(q(pf)); echo $$ > \"$PF\"",
      "APP=\(q(app)); NEW=\(q(new)); PREV=\(q(prev)); PID=\(getpid()); RELAUNCH=\(relaunch ? 1 : 0)",
      "i=0; while kill -0 $PID 2>/dev/null && [ $i -lt 600 ]; do sleep 0.1; i=$((i+1)); done", // 等这个进程退出：最多 1 分钟
      "kill -0 $PID 2>/dev/null && exit 0",
      "[ -d \"$NEW\" ] || exit 0",
      "if ! /usr/bin/codesign --verify --strict \"$NEW\" >/dev/null 2>&1 || /usr/sbin/spctl -a -t exec -vv \"$NEW\" 2>&1 | grep -q REVOKED; then mkdir -p \"$PREV\" && mv \"$NEW\" \"$PREV/rejected-$(date +%Y%m%d-%H%M%S).app\"; [ $RELAUNCH = 1 ] && \(open); exit 0; fi",
      "OLDV=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \"$APP/Contents/Info.plist\" 2>/dev/null || echo old)",
      "OLD=\"$PREV/Vibing Studio $OLDV $(date +%Y%m%d-%H%M%S).app\"",
      "mkdir -p \"$PREV\" && mv \"$APP\" \"$OLD\" || { [ $RELAUNCH = 1 ] && \(open); exit 0; }",
      "mv \"$NEW\" \"$APP\" || { mv \"$OLD\" \"$APP\"; [ $RELAUNCH = 1 ] && \(open); exit 0; }",
      "[ $RELAUNCH = 1 ] || exit 0",
      open,
      // 打开以后它要是被系统拿走了（不在原处了）：把原来那一份放回去、打开它（不留下一个没有 App 的「应用程序」）
      "i=0; while [ $i -lt 50 ]; do sleep 0.2; i=$((i+1)); done",
      "if [ ! -d \"$APP\" ] && [ -d \"$OLD\" ]; then mv \"$OLD\" \"$APP\" && \(open); fi",
    ].joined(separator: "\n") + "\n"
    let script = dir + "/swap-at-quit.sh"
    guard (try? sh.write(toFile: script, atomically: true, encoding: .utf8)) != nil else { return }
    // 单独起一个会话（setsid）：App 退了它还在
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/perl")
    p.arguments = ["-e", "use POSIX qw(setsid); exit 0 if fork; setsid(); open STDIN, '</dev/null'; open STDOUT, '>/dev/null'; open STDERR, '>&STDOUT'; exec '/bin/sh', $ARGV[0]", script]
    do { try p.run(); p.waitUntilExit() } catch { return }
  }
}
