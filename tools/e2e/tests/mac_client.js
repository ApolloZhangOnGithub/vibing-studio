// Mac 对 Mac（看的这一台）：开另一台（测试主机，画测试图）的屏幕——收到画面、解码画出来、统计、键盘鼠标送过去（主机记进文件）、暂停 / 继续、改帧率、分出去再放回来、关掉
var N = nadosNative, out = {};
var tick = function (r) { setTimeout(r, 50); };
var frame = function () { return new Promise(function (r) { tick(r); }); }; // 计时器（屏幕睡着时 requestAnimationFrame 不走）
var waitMs = async function (ms) { var end = performance.now() + ms; while (performance.now() < end) await frame(); };
var until = async function (fn, ms) { var end = performance.now() + (ms || 20000); while (performance.now() < end) { var v; try { v = await fn(); } catch (e) { v = null; } if (v) return v; await frame(); } return null; };
var stats = [];
N.on("scr.stats", function (d) { stats.push(d); });
var tmo = function (p, ms, tag) { return Promise.race([p, new Promise(function (r) { setTimeout(function () { r("TIMEOUT " + tag); }, ms); })]); };
var info = async function (id) { var l = await N.call("scr.list"); return ((l || []).filter(function (x) { return x.id === id; })[0] || {}).info || null; };
try {
  await until(function () { return window.STUDIO && window.TSU_TERM && TSU_TERM.front() && window.TSU_MACDESK && window.TSU_RLINK; }, 60000);
  out.native = TSU_MACDESK.native();
  // 主机（另一个测试 App，tools/e2e/run.py 先起的）：中转里最新上线的那一台
  var hostDev = await until(async function () { var l = await fetch("/api/relay/hosts", { credentials: "same-origin", cache: "no-store" }).then(function (r) { return r.json(); }); l = (l || []).filter(function (h) { return h && h.device; }).sort(function (a, b) { return (b.since || 0) - (a.since || 0); }); return l[0] ? l[0].device : null; }, 60000);
  var tw = TSU_TERM.front(), dev = hostDev, id = "scr:" + dev;
  out.host = dev;
  TSU_MACDESK.open(dev, "测试 Mac", tw);
  var first = await until(async function () { var x = await info(id); return x && x.frames > 3 ? x : null; }, 45000);
  out.firstFrames = first;
  var P = (tw.ws.all ? tw.ws.all() : []).filter(function (p) { return p.program && p.program.page === "macdesk"; })[0];
  await waitMs(2500);
  out.statusLine = TSU_MACDESK.statusLine(P && P.program);
  out.codecs = await N.call("scr.codecs").catch(function (e) { return "ERR " + e.message; });
  out.stats = stats.slice(-2);
  out.shot1 = await tmo(N.call("scr.snapshot", { id: id }), 8000, "snapshot");
  // 键盘鼠标：直接经同一条连接送一串（同原生攒好的样子）
  var L = TSU_RLINK.open(dev);
  out.input = await L.call("screen.input", { id: id, ev: [{ t: "m", x: 0.5, y: 0.25, f: 0 }, { t: "d", b: 0, x: 0.5, y: 0.25, c: 1, f: 0 }, { t: "u", b: 0, x: 0.5, y: 0.25, c: 1, f: 0 }, { t: "k", c: 0, d: true, f: 1048576 }, { t: "k", c: 0, d: false, f: 1048576 }, { t: "w", dx: 0, dy: -12 }] }, 10000).then(function (r) { return r === null ? "ok" : r; }, function (e) { return "ERR " + e.message; });
  // 暂停：画面不再来
  var before = (await info(id)).frames;
  await tmo(L.call("screen.pause", { id: id, on: true }, 10000), 12000, "pause");
  await N.call("scr.pause", { id: id, on: true });
  await waitMs(1500);
  var mid = (await info(id)).frames;
  await waitMs(1500);
  var mid2 = (await info(id)).frames;
  await tmo(L.call("screen.pause", { id: id, on: false }, 10000), 12000, "resume");
  await N.call("scr.pause", { id: id, on: false });
  await waitMs(1500);
  var after = (await info(id)).frames;
  out.pause = { before: before, pausedA: mid, pausedB: mid2, resumed: after, stoppedWhilePaused: mid2 - mid <= 1, resumedGrows: after > mid2 };
  // 改帧率 10
  out.opts = await L.call("screen.opts", { id: id, fps: 10 }, 10000).then(function (v) { return v; }, function (e) { return "ERR " + e.message; });
  // 分出去、放回来
  var w1 = await tmo(N.call("scr.window", { id: id, mode: "window" }), 8000, "popout");
  await waitMs(800);
  out.popped = { state: w1, info: await info(id) };
  out.shot2 = await tmo(N.call("scr.snapshot", { id: id }), 8000, "snapshot");
  var w2 = await tmo(N.call("scr.window", { id: id, mode: "tab" }), 8000, "dock");
  out.docked = w2 && w2.popped === false;
  // 关掉标签页：那台停止截屏
  if (P) tw.ws.closePane(P);
  await waitMs(3000);
  out.closedList = await N.call("scr.list");
} catch (e) { out.error = String(e && e.stack || e); }
return out;
