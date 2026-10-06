// xterm-gl.js —— 终端用 GPU（WebGL）画：挂、摘、丢了再挂，都在这一处（live.js、studio.js 的终端都走这里）
// 为什么要管：WebKit 一个页面最多 16 个活着的 WebGL 上下文（WebGLRenderingContextBase.cpp 的 maxActiveContexts），超了就回收最久没用的那个，
//   而且不给恢复；xterm 的 WebGL 插件等 3 秒没恢复就报 onContextLoss。以前在那里 dispose 掉，这个终端就一直用 DOM 画
//   （方块、框线字之间有缝，Claude Code 的标志会碎；也慢）。终端开到第 17 个就会发生（实测，见 docs/terminal-webgl-budget-and-flow-control.md）
// 现在：看得见的挂 WebGL；藏起来的留最近的 SOFT 个以内（切回来不用重建字形图集），多了先摘最久没露面的——摘插件马上还名额（实测）；
//   一共不超过 HARD 个，碰不到 16；丢了的（显卡重置、睡眠唤醒）过一会儿再挂，一分钟里连丢 3 次就不再试
//   看不看得见用 IntersectionObserver：同一组后面的（studio.css 的 .tpoff，移到屏幕外）、display:none、摘下来的，它都当场报（实测）
// localStorage["tsu-xgl"] = "off"：照旧（每个终端挂一次、丢了就退回 DOM）——对比、回滚用
(function () {
  "use strict";
  var SOFT = 8, HARD = 14, RETRY = 5000;
  var off = localStorage.getItem("tsu-xgl") === "off";
  var list = []; // { term, host, gl, shown, seen, lostAt, losses, failed }
  var io = !off && window.IntersectionObserver ? new IntersectionObserver(function (es) {
    es.forEach(function (x) {
      var e = byHost(x.target);
      if (!e) return;
      e.shown = x.isIntersecting;
      e.seen = Date.now(); // 露出来、藏起来都记：藏着的按这个排谁最久没露面
      if (e.shown) want(e);
    });
    trim();
  }) : null;
  function byHost(h) { for (var i = 0; i < list.length; i++) if (list[i].host === h) return list[i]; return null; }
  function used() { var n = 0; list.forEach(function (e) { if (e.gl) n++; }); return n; }
  function oldestHidden() { var b = null; list.forEach(function (e) { if (e.gl && !e.shown && (!b || e.seen < b.seen)) b = e; }); return b; }
  function drop(e) { var gl = e.gl; if (!gl) return; e.gl = null; try { gl.dispose(); } catch (x) { /* 已经没了 */ } } // 退回 DOM 画，名额马上还
  function want(e) {
    if (e.gl || e.failed || !window.WebglAddon) return;
    var now = Date.now();
    e.losses = e.losses.filter(function (t) { return now - t < 60000; });
    if (e.losses.length >= 3 || now - e.lostAt < RETRY) return;
    if (!off && used() >= HARD) { var v = oldestHidden(); if (!v) return; drop(v); } // 满了：先让一个藏着的；全都看得见就这个先用 DOM 画
    var gl;
    try { gl = new WebglAddon.WebglAddon(); } catch (x) { e.failed = true; return; }
    gl.onContextLoss(function () {
      if (e.gl !== gl) return;
      e.gl = null; e.lostAt = Date.now(); e.losses.push(e.lostAt);
      try { gl.dispose(); } catch (x) { /* 已经没了 */ }
      if (!off) setTimeout(function () { if (e.shown && list.indexOf(e) >= 0) want(e); }, RETRY + 100); // 一直露着的：过一会儿自己再挂
    });
    try { e.term.loadAddon(gl); e.gl = gl; } catch (x) { e.failed = true; try { gl.dispose(); } catch (y) { /* 没挂上 */ } } // 没有 WebGL2：一直用 DOM
  }
  function trim() { var v; while (used() > SOFT && (v = oldestHidden())) drop(v); }
  window.TSU_XGL = {
    // term 已经 open(host)。返回 { dispose }：关终端前调（先摘 WebGL，也不再盯着它）
    attach: function (term, host) {
      var e = { term: term, host: host, gl: null, shown: true, seen: Date.now(), lostAt: 0, losses: [], failed: false };
      list.push(e);
      want(e); // 刚开的一般就在眼前：先挂上；其实藏着的，IntersectionObserver 第一次回调会报，多了就摘
      if (io) { io.observe(host); trim(); }
      return {
        dispose: function () { if (io) io.unobserve(host); drop(e); var i = list.indexOf(e); if (i >= 0) list.splice(i, 1); },
        webgl: function () { return !!e.gl; }, // 测试、调试用
      };
    },
    stats: function () { return { terminals: list.length, webgl: used(), soft: SOFT, hard: HARD, off: off }; }, // 测试、调试用
  };
})();
