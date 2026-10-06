// perf.js —— 卡的时候到底是谁在占着主线程：一个很轻的常驻记录（最先载入，包住计时器、动画帧、观察者、几种高频事件的回调，量每个回调花了多久）。
//   按「是谁」（函数名 + 源码开头一小段）累计时间；原生推过来的事件（exec.data、pty.data……）按种类数个数、字节；事件循环的延迟（该跑没跑上的毫秒数）。
//   每 30 秒一格，最近 40 格写进 ~/Library/Application Support/Vibing Studio/perf.json（App 里才写；只在这一格真的忙过时写）。
//   TSU_PERF.report() 看现在这一格；TSU_PERF.off() 关掉（包过的照样跑，只是不再量）
(function () {
  "use strict";
  if (window.TSU_PERF) return;
  var on = true, now = function () { return performance.now(); };
  var win = null, hist = [], WIN_MS = 30000;
  function fresh() { return { t0: Date.now(), busy: 0, sites: new Map(), ev: {}, lag: [], calls: 0 }; }
  win = fresh();
  // ---- 回调是谁：函数名 + 源码开头（去空白 60 字）；同一个函数只算一次（WeakMap）----
  var labels = new WeakMap();
  function labelOf(fn, kind) {
    var l = labels.get(fn);
    if (l) return l;
    var src = "";
    try { src = Function.prototype.toString.call(fn).replace(/\s+/g, " ").slice(0, 90); } catch (e) { src = "?"; }
    l = kind + ":" + (fn.name || "anon") + " " + src;
    labels.set(fn, l);
    return l;
  }
  function add(label, ms) {
    win.busy += ms; win.calls++;
    var s = win.sites.get(label);
    if (!s) { s = { ms: 0, n: 0, max: 0 }; win.sites.set(label, s); }
    s.ms += ms; s.n++; if (ms > s.max) s.max = ms;
  }
  function timed(fn, kind) {
    if (typeof fn !== "function") return fn;
    return function () {
      if (!on) return fn.apply(this, arguments);
      var t = now();
      try { return fn.apply(this, arguments); } finally { var d = now() - t; if (d > 0.3) add(labelOf(fn, kind), d); }
    };
  }
  // ---- 计时器、动画帧 ----
  var sT = window.setTimeout, sI = window.setInterval, rAF = window.requestAnimationFrame;
  window.setTimeout = function (fn, ms) { var a = Array.prototype.slice.call(arguments); a[0] = timed(fn, "timeout"); return sT.apply(window, a); };
  window.setInterval = function (fn, ms) { var a = Array.prototype.slice.call(arguments); a[0] = timed(fn, "interval"); return sI.apply(window, a); };
  if (rAF) window.requestAnimationFrame = function (fn) { return rAF.call(window, timed(fn, "raf")); };
  // ---- 观察者 ----
  ["MutationObserver", "ResizeObserver", "IntersectionObserver"].forEach(function (k) {
    var O = window[k];
    if (!O) return;
    var W = function (cb, opts) { return new O(timed(cb, k.replace("Observer", "Obs")), opts); };
    W.prototype = O.prototype;
    try { window[k] = W; } catch (e) { /* 不让改就算了 */ }
  });
  // ---- 高频事件的监听（滚动、滚轮、指针移动、按键、输入、缩放、消息）：量它们；别的事件不碰 ----
  var HOT = { scroll: 1, wheel: 1, mousemove: 1, pointermove: 1, keydown: 1, input: 1, resize: 1, message: 1 };
  var aEL = EventTarget.prototype.addEventListener, rEL = EventTarget.prototype.removeEventListener, wraps = new WeakMap();
  var capOf = function (o) { return !!(o === true || (o && typeof o === "object" && o.capture)); };
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (!HOT[type] || typeof fn !== "function") return aEL.call(this, type, fn, opts);
    var m = wraps.get(fn); if (!m) { m = {}; wraps.set(fn, m); }
    var key = type + (capOf(opts) ? "1" : "0"), w = m[key] || (m[key] = timed(fn, "on" + type));
    return aEL.call(this, type, w, opts);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    var m = typeof fn === "function" && HOT[type] ? wraps.get(fn) : null, w = m && m[type + (capOf(opts) ? "1" : "0")];
    return rEL.call(this, type, w || fn, opts);
  };
  // ---- 原生推过来的事件：个数、字节 ----
  aEL.call(window, "nados-native", function (e) {
    if (!on) return;
    var d = e.detail || {}, t = d.type || "?", x = d.detail || {}, b = 0;
    if (x.b64) b = x.b64.length; else if (typeof x.o === "string") b = x.o.length; else if (typeof x.e === "string") b = x.e.length;
    var c = win.ev[t] || (win.ev[t] = { n: 0, bytes: 0, ids: {} });
    c.n++; c.bytes += b;
    if (x.id != null && Object.keys(c.ids).length < 200) c.ids[x.id] = (c.ids[x.id] || 0) + 1;
  });
  // ---- 事件循环的延迟：每 100ms 该醒一次，晚了多少 ----
  var exp = now() + 100;
  sI.call(window, function () { var t = now(), lag = Math.max(0, t - exp); exp = t + 100; if (on && win.lag.length < 400) win.lag.push(Math.round(lag)); }, 100);
  // ---- 每 30 秒收一格；最近 40 格写文件 ----
  function summarize(w) {
    var sites = Array.from(w.sites.entries()).sort(function (a, b) { return b[1].ms - a[1].ms; }).slice(0, 25).map(function (x) { return { site: x[0], ms: Math.round(x[1].ms), n: x[1].n, max: Math.round(x[1].max) }; });
    var lag = w.lag.slice().sort(function (a, b) { return a - b; }), pick = function (q) { return lag.length ? lag[Math.min(lag.length - 1, Math.floor(lag.length * q))] : 0; };
    var ev = {};
    Object.keys(w.ev).forEach(function (k) { var c = w.ev[k], top = Object.keys(c.ids).sort(function (a, b) { return c.ids[b] - c.ids[a]; }).slice(0, 5).map(function (id) { return id + "×" + c.ids[id]; }); ev[k] = { n: c.n, kb: Math.round(c.bytes / 1024), topIds: top }; });
    return { at: new Date(w.t0).toISOString(), secs: Math.round((Date.now() - w.t0) / 1000), busyMs: Math.round(w.busy), calls: w.calls, lagP50: pick(0.5), lagP95: pick(0.95), lagMax: lag.length ? lag[lag.length - 1] : 0, native: ev, sites: sites,
      panes: (function () { try { return window.TSU_TERM && TSU_TERM.panes ? TSU_TERM.panes().length : -1; } catch (e) { return -1; } })(), hidden: document.hidden };
  }
  var dirty = false;
  sI.call(window, function () {
    if (!on) return;
    var s = summarize(win);
    win = fresh();
    if (s.busyMs < 1500 && s.lagMax < 400) return; // 这一格不忙：不记
    hist.push(s); if (hist.length > 40) hist.shift();
    dirty = true;
  }, WIN_MS);
  sI.call(window, function () {
    if (!dirty) return;
    var L = window.TSU_LOCAL;
    if (!L || !L.write || !L.info) return;
    dirty = false;
    try { L.write(L.info().home + "/Library/Application Support/Vibing Studio/perf.json", JSON.stringify({ app: (window.nadosNative && nadosNative.version) || "", windows: hist }, null, 1)); } catch (e) { /* 写不了就算了 */ }
  }, 60000);
  window.TSU_PERF = { report: function () { return summarize(win); }, history: function () { return hist.slice(); }, off: function () { on = false; }, on: function () { on = true; } };
})();
