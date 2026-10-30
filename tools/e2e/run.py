#!/usr/bin/env python3
# Vibing Studio 的回归测试（端到端）：用测试 App（单独的 bundle id beer.paimon.terminal.rdptest、假的家目录、本机的网页服务）跑 tests/ 里的用例，
#   每个用例是一段在 App 页面里跑的 JS（返回一个结果对象），这里按 CHECKS 判过没过。
#     python3 tools/e2e/run.py                 全部
#     python3 tools/e2e/run.py rdp_static fav_ui
#     python3 tools/e2e/run.py --build ...     先重编测试 App（改了 app/ 里的原生代码时）
#   产物（家目录、结果、截图、日志）在 ~/Library/Caches/VibingStudio/e2e/<时间>/，不进 iCloud。
#   不碰用户自己的东西：测试 App 的 bundle id 不一样、家目录是假的、钥匙串用「Vibing Studio RDP Test」那一项；跑完把测试 App 从系统的 App 列表里拿掉
import base64, json, os, queue, shutil, subprocess, sys, tempfile, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CACHE = os.path.expanduser("~/Library/Caches/VibingStudio")
APP_DIR = os.path.join(CACHE, "rdptest.noindex", "Vibing Studio RDPTest.app")
APP = os.path.join(APP_DIR, "Contents", "MacOS", "Paimon")
LSR = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
URL = "http://localhost:8787/auth/login?dev=1&next=/terminal.html"

# 每个用例：fixture（tests 用的假家目录，fixtures/ 下），needs（要先起的服务），timeout（秒），check（结果 → 没过的原因，过了是空的）
def chk_rdp_static(o):
    v = o.get("view") or {}
    if not (v.get("frames", 0) >= 1 and v.get("presents", 0) >= 1): return "no picture: %s" % json.dumps(v)[:200]
    a = o.get("avail") or {}
    if not (isinstance(a, dict) and a.get("ok") and "/Contents/Resources/bin/vs-rdp" in str(a.get("path", ""))): return "helper not the bundled one: %s" % a
def chk_rdp_timeout(o):
    st = " ".join(o.get("states") or [])
    if "error:timeout" not in st: return "no timeout state: " + st
    if "没有响应" not in (o.get("finalCard") or ""): return "card: %s" % o.get("finalCard")
def chk_fav_ui(o):
    if (o.get("favReply") or {}).get("type") != "msg": return "reply not saved as a whole message"
    if (o.get("menuReply2") or [""])[0] != "取消收藏": return "second right-click isn't 取消收藏: %s" % o.get("menuReply2")
    if (o.get("cards") or 0) < 3: return "cards: %s" % o.get("cards")
    if not o.get("jumped"): return "jump failed"
def chk_eco_embed(o):
    if o.get("appTile"): return "Agent Extensions still a separate app"
    if not o.get("embed") or not any("钩子" in s for s in o.get("sections") or []): return "no extensions on the connector page: %s" % o.get("sections")
def chk_mac(o):
    if "hevc" not in (o.get("codecs") or []) and "H.264" not in (o.get("statusLine") or ""): return "codecs: %s" % o.get("codecs")
    if not (o.get("firstFrames") or {}).get("frames"): return "no frames"
    p = o.get("pause") or {}
    if not (p.get("stoppedWhilePaused") and p.get("resumedGrows")): return "pause/resume: %s" % p
    if o.get("input") != "ok": return "input: %s" % o.get("input")
    if o.get("closedList"): return "capture not stopped after closing: %s" % o.get("closedList")
# 往上快速滚动长会话：看得见的地方不能有没画的块（黑的），不能停在已读进来的最顶上等更早的那段
def chk_scroll(o):
    if not o.get("ok"): return "scroll test failed: %s" % o.get("error")
    for k in ("up1", "down", "up2"):
        p = o.get(k) or {}
        if p.get("blankFrames"): return "%s: %s frames showed undrawn (black) blocks (max %s)" % (k, p.get("blankFrames"), p.get("maxBlank"))
    for k in ("up1", "up2"):
        p = o.get(k) or {}
        if p.get("edgeFrames"): return "%s: stopped at the top of what was drawn for %s frames while older parts were still loading" % (k, p["edgeFrames"])
        if p.get("over100", 0) > 3: return "%s: %s frames took over 100 ms (max %s ms)" % (k, p["over100"], p.get("maxGap"))

def chk_idle(o):
    if (o.get("longTasks") or 0) > 0: return "long tasks while idle: %s (%s ms)" % (o.get("longTasks"), o.get("longTaskMs"))
    # 窗口看不见（显示器睡了、锁屏、被挡住）：系统把定时器压到一秒一次，量出来的「延迟」是这个，不是页面忙——只看长任务（2026-10-28 凌晨跑出 131 ms，hidden 为真）
    if o.get("hidden"): print("  (window hidden: lag not measured)", end=" ", flush=True); return None
    if (o.get("lagAvgMs") or 0) > 20: return "main thread busy while idle: lag %s ms" % o.get("lagAvgMs")

TESTS = {
    "rdp_static": {"needs": ["rdp_sample"], "timeout": 150, "check": chk_rdp_static},
    "rdp_timeout": {"needs": ["silent"], "timeout": 260, "check": chk_rdp_timeout},
    "fav_ui": {"fixture": "ty", "timeout": 180, "check": chk_fav_ui},
    "eco_embed": {"fixture": "eco", "timeout": 150, "check": chk_eco_embed},
    "mac2mac": {"timeout": 240, "check": chk_mac},
    "idle": {"fixture": "ty", "timeout": 150, "check": chk_idle},
    "scroll": {"gen": "cc", "timeout": 400, "check": chk_scroll},
    "screens": {"gen": "ccdiff", "timeout": 180, "check": lambda o: None if o.get("ok") else "screens failed: %s" % o.get("error"), "manual": True}, # 截 README 用的图（tui/gui/dash/ca）
    "seldiff": {"gen": "ccdiff", "timeout": 120, "check": lambda o: None if o.get("ok") else "selection probe failed: %s" % o.get("error"), "manual": True}, # 选中 diff 的几行：截图看选区盖不盖得住红绿底
    "energy": {"fixture": "ty", "timeout": 150, "check": lambda o: None if o.get("ok") else "energy probe failed: %s" % o.get("error"), "manual": True},
}

class Proc:
    """后台起一个服务；stop() 时结束它"""
    def __init__(self, args, cwd=None, log=None, env=None, ready=None, wait_s=90):
        self.p = subprocess.Popen(args, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        self.q = queue.Queue()
        self.log = open(log, "w") if log else None
        threading.Thread(target=self._pump, daemon=True).start()
        if ready:  # 等它打出「好了」那一行
            end = time.monotonic() + wait_s
            while True:
                left = end - time.monotonic()
                if left <= 0: raise RuntimeError("%s not ready" % args[0])
                try: line = self.q.get(timeout=left)
                except queue.Empty: raise RuntimeError("%s not ready" % args[0])
                if line is None: raise RuntimeError("%s exited" % args[0])
                if ready in line: break
    def _pump(self):
        for line in self.p.stdout:
            if self.log: self.log.write(line); self.log.flush()
            self.q.put(line)
        self.q.put(None)
    def stop(self):
        if self.p.poll() is None:
            self.p.terminate()
            try: self.p.wait(timeout=10)
            except subprocess.TimeoutExpired: self.p.kill()

def build_app():
    print("building the test app…", flush=True)
    r = subprocess.run(["bash", os.path.join(HERE, "mk-test-app.sh")], cwd=ROOT, capture_output=True, text=True)
    sys.stdout.write(r.stdout[-2000:]); sys.stderr.write(r.stderr[-2000:])
    if r.returncode != 0 or "error:" in r.stdout: sys.exit("test app build failed")

def make_home(work, name, fixture):
    home = os.path.join(work, "home-" + name)
    # 只拷普通文件（测试跑的时候 genshin 会在家目录里建命名管道之类的：那些不是 fixture 的一部分）
    if fixture: shutil.copytree(os.path.join(HERE, "fixtures", fixture), home, symlinks=True, ignore=lambda d, names: [n for n in names if not (os.path.isfile(os.path.join(d, n)) or os.path.isdir(os.path.join(d, n)))])
    else: os.makedirs(home, exist_ok=True)
    return home

def gen_home(home, gen):
    if gen == "cc": subprocess.run([sys.executable, os.path.join(HERE, "gen_cc.py"), home], check=True, capture_output=True) # 很长的 Claude Code 会话（滚动测试）
    if gen == "ccdiff": subprocess.run([sys.executable, os.path.join(HERE, "gen_ccdiff.py"), home], check=True, capture_output=True) # 有一次 Edit 的短会话（选区测试）

def run_app(work, name, js, home, timeout, extra_env=None, background=False):
    out = os.path.join(work, name + ".json")
    env = dict(os.environ, NADOS_TEST_FLOAT="1", NADOS_HOME=home, NADOS_TESTJS=js, NADOS_TESTJS_OUT=out, NADOS_SELFTEST_WAIT="2", NADOS_RDP_KEYCHAIN="Vibing Studio RDP Test")
    env.update(extra_env or {})
    log = open(os.path.join(work, name + ".applog"), "w")
    if background: return subprocess.Popen([APP, "--url", URL], env=env, stdout=log, stderr=subprocess.STDOUT), out
    try: subprocess.run([APP, "--url", URL], env=env, stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
    except subprocess.TimeoutExpired: return {"error": "timed out after %ds" % timeout}
    try: d = json.load(open(out))
    except Exception as e: return {"error": "no result: %s" % e}
    return d.get("page") if isinstance(d.get("page"), dict) else {"error": d.get("error") or d.get("pageError") or "no page result"}

def save_shots(work, name, o, path=""):
    if isinstance(o, dict):
        for k, v in list(o.items()):
            if isinstance(v, str) and v.startswith("data:image"):
                ext = "jpg" if "jpeg" in v[:30] else "png"
                fn = os.path.join(work, "%s_%s%s.%s" % (name, path, k, ext))
                open(fn, "wb").write(base64.b64decode(v.split(",", 1)[1])); o[k] = "<%s>" % os.path.basename(fn)
            else: save_shots(work, name, v, path + k + "_")
    elif isinstance(o, list):
        for i, v in enumerate(o): save_shots(work, name, v, path + str(i) + "_")

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if "--build" in sys.argv or not os.path.exists(APP): build_app()
    names = args or [n for n in TESTS if not TESTS[n].get("manual")] # manual：只在点名时跑（测量用的，不算回归）
    bad = [n for n in names if n not in TESTS]
    if bad: sys.exit("unknown tests: %s (have: %s)" % (", ".join(bad), ", ".join(TESTS)))
    work = os.path.join(CACHE, "e2e", time.strftime("%Y%m%d-%H%M%S")); os.makedirs(work)
    print("results:", work, flush=True)
    procs = []
    try:
        # 本机的网页服务（wrangler dev）：数据库（账号、开发用的登录）放在 e2e/wrangler-state，每次先把表建好（schema.sql 全是 IF NOT EXISTS）
        state = os.path.join(CACHE, "e2e", "wrangler-state")
        r = subprocess.run(["npx", "wrangler", "d1", "execute", "native-agent-desktop-os-web", "--local", "--persist-to", state, "--file", "schema.sql", "--yes"],
                           cwd=os.path.join(ROOT, "web"), capture_output=True, text=True, timeout=180)
        if r.returncode != 0: raise RuntimeError("schema: " + (r.stderr or r.stdout)[-500:])
        procs.append(Proc(["npx", "wrangler", "dev", "--port", "8787", "--local", "--persist-to", state], cwd=os.path.join(ROOT, "web"),
                          log=os.path.join(work, "wrangler.log"), ready="Ready on"))
        needs = set(x for n in names for x in TESTS[n].get("needs", []))
        if "rdp_sample" in needs:  # FreeRDP 自带的示例服务器（只在 unix socket 上听）+ 转到 127.0.0.1:33899
            srv = os.path.join(work, "srv"); os.makedirs(srv)
            subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=vs-e2e", "-keyout", os.path.join(srv, "server.key"), "-out", os.path.join(srv, "server.crt")], capture_output=True, check=True)
            procs.append(Proc(["/opt/homebrew/opt/freerdp/bin/sfreerdp-server", "--cert=server.crt", "--key=server.key", "--port=33891", "--local-only"], cwd=srv, log=os.path.join(work, "sample-server.log")))
            procs.append(Proc([sys.executable, os.path.join(HERE, "servers", "fwd.py"), os.path.join(tempfile.gettempdir(), "tfreerdp-server.33891"), "33899"], log=os.path.join(work, "fwd.log"), ready="listening"))
        if "silent" in needs:
            procs.append(Proc([sys.executable, os.path.join(HERE, "servers", "silent.py")], log=os.path.join(work, "silent.log")))
        results = {}
        for n in names:
            t = TESTS[n]
            print("· %s …" % n, end=" ", flush=True)
            t0 = time.monotonic()
            if n == "mac2mac":  # 两个测试 App：一个当被看的 Mac（画测试图、键盘鼠标只记下来），一个当看的
                host, _ = run_app(work, "mac_host", os.path.join(HERE, "tests", "mac_host.js"), make_home(work, "mac_host", None), t["timeout"],
                                  {"NADOS_SELFTEST_STAY": "1", "NADOS_SCREEN_FAKE": "1", "NADOS_SCREEN_INPUT_LOG": os.path.join(work, "mac_input.log")}, background=True)
                try: o = run_app(work, "mac_client", os.path.join(HERE, "tests", "mac_client.js"), make_home(work, "mac_client", None), t["timeout"], {"NADOS_REMOTE_HOST": "0"})
                finally:
                    host.terminate()
                    try: host.wait(timeout=10)
                    except subprocess.TimeoutExpired: host.kill()
            else:
                hm = make_home(work, n, t.get("fixture"))
                if t.get("gen"): gen_home(hm, t["gen"])
                o = run_app(work, n, os.path.join(HERE, "tests", n + ".js"), hm, t["timeout"])
            save_shots(work, n, o)
            why = o.get("error") or t["check"](o)
            results[n] = {"ok": not why, "why": why or "", "s": round(time.monotonic() - t0)}
            print(("ok" if not why else "FAILED: " + str(why)[:300]) + " (%ds)" % results[n]["s"], flush=True)
            json.dump(o, open(os.path.join(work, n + ".result.json"), "w"), ensure_ascii=False, indent=1)
        json.dump(results, open(os.path.join(work, "summary.json"), "w"), ensure_ascii=False, indent=1)
        failed = [n for n in results if not results[n]["ok"]]
        print("e2e: %d passed, %d failed%s" % (len(results) - len(failed), len(failed), (": " + ", ".join(failed)) if failed else ""))
        return 1 if failed else 0
    finally:
        for p in reversed(procs): p.stop()
        subprocess.run([LSR, "-u", APP_DIR], capture_output=True)  # 测试 App 不留在「打开方式」里

if __name__ == "__main__":
    sys.exit(main())
