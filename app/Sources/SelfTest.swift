// SelfTest.swift —— NADOS_SELFTEST=1 时：桌面起来后等一会儿（NADOS_SELFTEST_WAIT 秒，默认 8），在页面里调一遍桥和 native 命令，
// 结果写到 NADOS_SELFTEST_OUT（默认临时目录下的 native-selftest.json），页面截图写在旁边（.png），然后退出（NADOS_SELFTEST_STAY=1 就不退）。
// 会动剪贴板：测之前把剪贴板里的东西（所有类型）存下来，测完原样放回去。不发系统通知、不弹权限框
import AppKit
import WebKit

@MainActor
enum SelfTest {
  static let env = ProcessInfo.processInfo.environment
  static var outURL: URL { URL(fileURLWithPath: env["NADOS_SELFTEST_OUT"] ?? (NSTemporaryDirectory() as NSString).appendingPathComponent("native-selftest.json")) }

  // 等页面真的是桌面（不是登录页）、脚本都跑起来了（不靠 load 事件：页面里有一直开着的请求时它可能迟迟不来），再等 wait 秒开测；90 秒还没好就照样写结果
  static func arm(_ web: WebController) {
    let wait = Double(env["NADOS_SELFTEST_WAIT"] ?? "") ?? 8, started = Date()
    func poll() {
      if Date().timeIntervalSince(started) > 90 { return finish(web, ["error": "the desktop never became ready", "url": web.webView.url?.absoluteString ?? ""]) }
      web.webView.evaluateJavaScript("[document.readyState, location.href, !!window.TSU_SYS]") { r, _ in
        MainActor.assumeIsolated {
          if let a = r as? [Any], a.count == 3, a[0] as? String != "loading", let u = URL(string: a[1] as? String ?? ""), Config.inApp(u), a[2] as? Bool == true {
            DispatchQueue.main.asyncAfter(deadline: .now() + wait) { MainActor.assumeIsolated { run(web) } }
          } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { MainActor.assumeIsolated { poll() } }
          }
        }
      }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { MainActor.assumeIsolated { poll() } }
  }

  static let script = """
  const N = window.nadosNative, out = { href: location.href, hasBridge: !!N, frozen: N ? Object.isFrozen(N) : null };
  if (!N) return out;
  const t = async (name, fn) => { try { out[name] = { ok: true, value: await fn() }; } catch (e) { out[name] = { ok: false, code: e.code || null, message: String(e.message || e) }; } };
  await t("info", () => N.call("info"));
  await t("permissions", () => N.call("permissions"));
  const mark = "nados-selftest-" + Date.now();
  await t("clipboardWrite", () => N.call("clipboard.write", { text: mark }));
  await t("clipboardRead", () => N.call("clipboard.read").then(r => ({ roundTrip: r.text === mark })));
  await t("badge", async () => { await N.call("badge", { text: "3" }); return N.call("badge", { text: "" }); });
  await t("attention", () => N.call("attention"));
  await t("screenshot", () => N.call("screenshot", { maxWidth: 640, excludeSelf: true }).then(r => ({ width: r.width, height: r.height, bytes: r.dataURL.length, head: r.dataURL.slice(0, 22) })));
  await t("badUrl", () => N.call("openExternal", { url: "javascript:alert(1)" }));
  await t("unknownCmd", () => N.call("nope"));
  await t("badRequest", () => N.call("request", { kind: "telepathy" }));
  await t("dragRegions", () => N.call("window.dragRegions", { rects: [{ x: 100, y: 0, w: 200, h: 32 }] }));
  const S = window.TSU_SYS;
  if (S) {
    await t("sysNative", () => S.exec("native", ["permissions"]));
    await t("sysNativeInfo", () => S.exec("native", ["info"]).then(r => ({ code: r.code, out: r.out.split("\\n").slice(0, 4) })));
    await t("sysNativeHelp", () => S.exec("native", ["--help"]).then(r => ({ code: r.code, head: r.out.split("\\n").slice(0, 4) })));
    await t("sysNativeAgentDenied", () => S.exec("native", ["clipboard"], { agent: { id: "deadbeef", name: "t", access: "read" } }).then(r => ({ code: r.code, err: r.err.trim() })));
    await t("pbcopy", async () => { const m2 = "nados-pb-" + Date.now(); const r = await S.exec("pbcopy", [], { stdin: m2 }); const back = await N.call("clipboard.read"); return { code: r.code, roundTrip: back.text === m2 }; });
    await t("pbpaste", async () => { const r = await S.exec("pbpaste", []); return { code: r.code, startsWith: r.out.slice(0, 9) }; });
  }
  out.htmlClass = document.documentElement.className;
  const mb = document.getElementById("menubar");
  out.menubarPaddingLeft = mb ? getComputedStyle(mb).paddingLeft : null;
  out.padVar = getComputedStyle(document.documentElement).getPropertyValue("--nados-pad");
  return out;
  """

  static func run(_ web: WebController) {
    let pb = NSPasteboard.general
    let saved: [NSPasteboardItem] = (pb.pasteboardItems ?? []).map { item in
      let copy = NSPasteboardItem()
      for t in item.types { if let d = item.data(forType: t) { copy.setData(d, forType: t) } }
      return copy
    }
    web.webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
      MainActor.assumeIsolated {
        pb.clearContents()
        if !saved.isEmpty { pb.writeObjects(saved) }
        var out: [String: Any] = [:]
        switch result {
        case .success(let v): out["page"] = v
        case .failure(let e): out["pageError"] = e.localizedDescription
        }
        finish(web, out)
      }
    }
  }

  static func finish(_ web: WebController, _ extra: [String: Any]) {
    var out = extra
    out["clipboardRestored"] = true
    out["windowNumber"] = web.window.windowNumber
    out["events"] = web.events
    out["buttonsInset"] = web.buttonsInset
    out["origins"] = [("https://code.paimon.beer", true), ("http://localhost:8787", true), ("http://localhost:8788", false), ("http://code.paimon.beer", false),
                      ("https://code.paimon.beer.evil.example", false), ("https://evil.example", false)]
      .map { ["origin": $0.0, "expected": $0.1, "pass": Config.bridgeAllowed($0.0) == $0.1] as [String: Any] }
    out["inApp"] = [("https://github.com/login/oauth/authorize?client_id=x", false), ("https://github.com/sessions/two-factor/app", false), ("https://github.com/login", false), // 登录交给系统浏览器
                    ("https://github.com/settings/profile", false), ("https://github.com/", false), ("https://example.com/", false), ("https://code.paimon.beer/auth/callback?code=1", true)]
      .map { ["url": $0.0, "expected": $0.1, "pass": Config.inApp(URL(string: $0.0)!) == $0.1] as [String: Any] }
    let url = outURL
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    if let data = try? JSONSerialization.data(withJSONObject: sanitize(out), options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: url) }
    web.webView.takeSnapshot(with: WKSnapshotConfiguration()) { img, _ in
      MainActor.assumeIsolated {
        if let img, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) {
          try? png.write(to: url.deletingPathExtension().appendingPathExtension("png"))
        }
        if env["NADOS_SELFTEST_STAY"] != "1" { NSApp.terminate(nil) }
      }
    }
  }

  // NADOS_TESTJS=<文件>：页面起来（有 TSU_AGENTS）以后把这个文件当成 async 函数体在页面里跑一遍，返回值写到 NADOS_TESTJS_OUT（默认同名 .json），
  // 旁边一张截图（.png），然后退出（NADOS_SELFTEST_STAY=1 不退）。自动测试用（Paimon Terminal 这种没有桌面的页面也行）
  static var remoteOpened = false
  static func armScript(_ web0: WebController, _ file: String) {
    // NADOS_TESTJS_REMOTE=<另一台 Mac 的设备号>：主窗口好了以后开一个连它的窗口，脚本在那个窗口里跑、截那个窗口
    if let mac = env["NADOS_TESTJS_REMOTE"], !mac.isEmpty, !remoteOpened {
      func waitMain(_ n: Int) {
        web0.webView.evaluateJavaScript("[document.readyState, !!window.TSU_AGENTS]") { r, _ in
          MainActor.assumeIsolated {
            if let a = r as? [Any], a.count == 2, a[0] as? String == "complete", a[1] as? Bool == true, let app = NSApp.delegate as? AppDelegate {
              let id = app.openRemote(mac: mac, name: env["NADOS_TESTJS_REMOTE_NAME"] ?? "")
              if let c = app.extra.first(where: { $0.winId == id }) { remoteOpened = true; armScript(c, file) }
            } else if n < 90 { DispatchQueue.main.asyncAfter(deadline: .now() + 1) { MainActor.assumeIsolated { waitMain(n + 1) } } }
          }
        }
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + 1) { MainActor.assumeIsolated { waitMain(0) } }
      return
    }
    let web = web0
    let started = Date(), wait = Double(env["NADOS_SELFTEST_WAIT"] ?? "") ?? 3
    let out = URL(fileURLWithPath: env["NADOS_TESTJS_OUT"] ?? (file as NSString).deletingPathExtension + ".json")
    func done(_ v: [String: Any]) {
      if let data = try? JSONSerialization.data(withJSONObject: sanitize(v), options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: out) }
      web.webView.takeSnapshot(with: WKSnapshotConfiguration()) { img, _ in
        MainActor.assumeIsolated {
          if let img, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) {
            try? png.write(to: out.deletingPathExtension().appendingPathExtension("png"))
          }
          if env["NADOS_SELFTEST_STAY"] != "1" { NSApp.terminate(nil) }
        }
      }
    }
    func poll() {
      if Date().timeIntervalSince(started) > 90 { return done(["error": "the page never became ready", "url": web.webView.url?.absoluteString ?? "", "events": web.events]) }
      web.webView.evaluateJavaScript("[document.readyState, location.href, !!window.TSU_AGENTS]") { r, _ in
        MainActor.assumeIsolated {
          if let a = r as? [Any], a.count == 3, a[0] as? String == "complete", a[2] as? Bool == true {
            DispatchQueue.main.asyncAfter(deadline: .now() + wait) {
              MainActor.assumeIsolated {
                let src = (try? String(contentsOfFile: file, encoding: .utf8)) ?? "return { error: 'no test file' };"
                web.webView.callAsyncJavaScript(src, arguments: [:], in: nil, in: .page) { result in
                  MainActor.assumeIsolated {
                    switch result {
                    case .success(let v): done(["page": v, "events": web.events])
                    case .failure(let e): done(["pageError": e.localizedDescription, "events": web.events])
                    }
                  }
                }
              }
            }
          } else { DispatchQueue.main.asyncAfter(deadline: .now() + 1) { MainActor.assumeIsolated { poll() } } }
        }
      }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { MainActor.assumeIsolated { poll() } }
  }

  // JSONSerialization 只认那几种类型：别的（NSDate 等）转成字符串
  static func sanitize(_ v: Any) -> Any {
    switch v {
    case let d as [String: Any]: return d.mapValues(sanitize)
    case let a as [Any]: return a.map(sanitize)
    case is String, is NSNumber, is NSNull: return v
    default: return String(describing: v)
    }
  }
}
