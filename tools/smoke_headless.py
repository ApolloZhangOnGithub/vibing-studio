# smoke_headless.py —— 部署前的冒烟测试：不开任何窗口（以前开一个测试用的 App，本地开发服务器没开时一直弹「无法连接到 localhost」）。
#   起一个只在本机、随机端口的静态服务（就是要部署的 ui/），无界面的 Chromium 打开 terminal.html，等工作台起来（TSU_TERM、STUDIO），
#   页面有报错就失败。用法：python3 tools/smoke_headless.py <ui 目录>
import sys, threading, functools, http.server, socketserver

root = sys.argv[1] if len(sys.argv) > 1 else "ui"

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 256  # 浏览器一下子开很多连接：默认的 5 排不下，多出来的被重置（脚本没载到，页面就起不来）

srv = Server(("127.0.0.1", 0), functools.partial(Quiet, directory=root))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = "http://127.0.0.1:%d/terminal.html" % srv.server_address[1]
errs = []
try:
    from playwright.sync_api import sync_playwright
except Exception:
    print("smoke: SKIPPED (playwright not installed)"); srv.shutdown(); sys.exit(0)
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1280, "height": 800})
        pg.on("pageerror", lambda e: errs.append(str(e)[:300]))
        ok = False
        for attempt in range(2):  # 第一次偶尔被本地服务的连接重置拖住：再试一次
            try:
                pg.goto(url, wait_until="load", timeout=30000)
                pg.wait_for_function("() => !!(window.TSU_TERM && window.STUDIO)", timeout=30000)
                ok = True
                break
            except Exception as e:
                last = str(e)[:300]
        pg.wait_for_timeout(1500)
        b.close()
    errs = [e for e in errs if "stat is not a function" not in e]  # 没有原生的桥（浏览器里）时预期会有的
    if not ok: errs.append("workbench did not start: " + last)
finally:
    srv.shutdown()
print("smoke:", "OK" if not errs else errs)
sys.exit(1 if errs else 0)
