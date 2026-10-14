// 闲着的时候页面在忙什么：数 20 秒里每个计时器回调跑了几次、花了多少毫秒（包一层 setInterval / setTimeout / requestAnimationFrame，按调用的地方分）
var out = {};
var wait = function (ms) { return new Promise(function (r) { window["set" + "Timeout"](r, ms); }); };
var end0 = performance.now() + 60000;
while (!(window.STUDIO && window.TSU_TERM && TSU_TERM.front()) && performance.now() < end0) await wait(200);
await wait(8000); // 启动时的一阵忙过去
var stats = {}, origSI = window.setInterval, origST = window.setTimeout, origRAF = window.requestAnimationFrame;
var where = function () { var s = String(new Error().stack || "").split("\n"); for (var i = 2; i < s.length; i++) { var m = /(\w[\w.-]*\.js):(\d+)/.exec(s[i]); if (m && !/idle_probe/.test(s[i])) return m[1] + ":" + m[2]; } return "?"; };
var wrap = function (kind, fn, at) {
  return function () {
    var t0 = performance.now();
    try { return fn.apply(this, arguments); } finally {
      var k = kind + " " + at, e = stats[k] || (stats[k] = { n: 0, ms: 0 });
      e.n++; e.ms += performance.now() - t0;
    }
  };
};
// 已经在跑的 setInterval 包不到：数新的；已有的用全局的 long task 观察补上
window.setTimeout = function (fn, ms) { if (typeof fn !== "function") return origST.apply(window, arguments); var a = Array.prototype.slice.call(arguments); a[0] = wrap("timeout", fn, where()); return origST.apply(window, a); };
window.requestAnimationFrame = function (fn) { return origRAF.call(window, wrap("raf", fn, where())); };
var longs = 0, longMs = 0;
try { new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { longs++; longMs += e.duration; }); }).observe({ entryTypes: ["longtask"] }); } catch (e) { /* 没有 */ }
var cpu0 = performance.now();
// 20 秒：期间量一下主线程空不空——每 100 ms 记一次和期望的差（主线程被占的时候会晚到）
var lag = 0, lagMax = 0, n = 0, last = performance.now();
var probe = origSI.call(window, function () { var now = performance.now(), d = now - last - 100; last = now; n++; if (d > 0) { lag += d; if (d > lagMax) lagMax = d; } }, 100);
await new Promise(function (r) { origST.call(window, r, 20000); });
clearInterval(probe);
window.setTimeout = origST; window.requestAnimationFrame = origRAF;
var top = Object.keys(stats).map(function (k) { return [k, stats[k].n, Math.round(stats[k].ms * 10) / 10]; }).sort(function (a, b) { return b[2] - a[2] || b[1] - a[1]; }).slice(0, 25);
out.top = top; out.lagAvgMs = Math.round(lag / Math.max(1, n) * 10) / 10; out.lagMaxMs = Math.round(lagMax); out.longTasks = longs; out.longTaskMs = Math.round(longMs);
out.hidden = document.hidden;
return out;
