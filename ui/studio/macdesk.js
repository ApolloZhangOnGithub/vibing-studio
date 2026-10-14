// macdesk.js —— 用另一台 Mac 的屏幕（Mac 对 Mac 的远程桌面，同 TeamViewer；原生在 app/Sources/ScreenShare.swift）：
//   「设备」里一台在线的 Mac 连按两下（或「远程桌面」）→ 一个标签页。经 Vibing Studio 自己的连接（rlink.js，同「在新窗口中打开」，认设备、那台允许过）
//   叫那台开始截屏（screen.start）；那台一帧一条 screen.frame 送过来，这里交给原生解码、画（scr.data）；原生收到的键盘鼠标（scr.input）经同一条连接送过去。
//   不用系统的「屏幕共享」、不用那台的开机密码；那台要允许 Vibing Studio「屏幕录制」「辅助功能」（第一次用时那台上弹系统的框）。
//   标签栏右边：暂停 / 继续（那台停止截屏、编码）、单独的窗口、全屏、连接选项（帧率、画质、清晰度、画面上显示统计）；状态栏一行统计
(function () {
  "use strict";
  var S = window.STUDIO, N = window.nadosNative;
  if (!S || !S.pages || !S.openPage) return;
  var I18N = window.TSU_I18N;
  var t = function (zh, en) { return I18N && I18N.lang && I18N.lang() === "en" ? en : zh; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var cmds = [];
  var ready = N && N.call ? N.call("info").then(function (i) { cmds = (i && i.commands) || []; }).catch(function () {}) : Promise.resolve();
  var native = function () { return cmds.indexOf("scr.open") >= 0 && !!window.TSU_RLINK; };

  var LOGO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.75" y="4" width="18.5" height="12.5" rx="2"/><path d="M8.5 20h7M12 16.5V20"/><path d="M10.1 7.4l4.9 2-2.1.8-.8 2.1z"/></svg>';
  var IC = {
    pause: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M5.6 3.4v9.2M10.4 3.4v9.2"/></svg>',
    play: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M5 3.2v9.6l7.6-4.8z"/></svg>',
    pop: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="1.8" y="4.4" width="9.6" height="9.6" rx="1.5"/><path d="M8.8 1.8h5.4v5.4M14.2 1.8L8.2 7.8"/></svg>',
    full: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9.6 2.2h4.2v4.2M13.8 2.2L9.2 6.8M6.4 13.8H2.2V9.6M2.2 13.8l4.6-4.6"/></svg>',
    opts: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6"/><circle cx="10" cy="4.5" r="1.5"/><circle cx="6" cy="11.5" r="1.5"/></svg>',
    reload: '<svg viewBox="0 0 16 16"><path d="M12.5 7.5A4.5 4.5 0 1 1 11 4.3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M11.5 2v2.8H8.7" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  // 每台的选项（记在这台上）：帧率、画质（码率）、清晰度（宽最多多少像素）、画面上显示统计
  var QUAL = [["high", "高", "High", 20000000], ["std", "标准", "Standard", 8000000], ["low", "省流量", "Light", 3000000]];
  var WIDTHS = [[0, "原始", "Original"], [2560], [1920], [1280]];
  var FPS = [60, 30, 15];
  var optKey = function (dev) { return "vs-macdesk:" + dev; };
  var optsOf = function (dev) { var o = {}; try { o = JSON.parse(localStorage.getItem(optKey(dev)) || "{}") || {}; } catch (e) { o = {}; } return { fps: +o.fps || 30, q: o.q || "std", maxW: o.maxW == null ? 0 : +o.maxW, hud: !!o.hud }; };
  var saveOpts = function (dev, o) { try { localStorage.setItem(optKey(dev), JSON.stringify(o)); } catch (e) { /* 满了 */ } };
  var bitrateOf = function (q) { var x = QUAL.filter(function (z) { return z[0] === q; })[0]; return x ? x[3] : 8000000; };
  var names = {}; // 设备号 → 名字（标签页上写）
  try { names = JSON.parse(localStorage.getItem("vs-macdesk-names") || "{}") || {}; } catch (e) { names = {}; }
  var setName = function (dev, nm) { if (!nm || names[dev] === nm) return; names[dev] = nm; try { localStorage.setItem("vs-macdesk-names", JSON.stringify(names)); } catch (e) { /* 满了 */ } };

  var views = {}; // V.id → V
  var byId = function (id) { return views[id] || null; };
  if (N && N.on) {
    N.on("scr.input", function (d) { var V = d && byId(d.id); if (V && V.L && V.up) V.L.call("screen.input", { id: V.id, ev: d.ev }, 10000).then(function (r) { if (r && r.ax === false && !V.axWarn) { V.axWarn = true; paint(V); } }, function () {}); });
    N.on("scr.needkey", function (d) { var V = d && byId(d.id); if (V && V.L && V.up) V.L.call("screen.key", { id: V.id }, 10000).catch(function () {}); });
    N.on("scr.resume", function (d) { var V = d && byId(d.id); if (V) pause(V, false); });
    N.on("scr.state", function (d) { var V = d && byId(d.id); if (V) { V.popped = !!d.popped; paint(V); } });
    N.on("scr.stats", function (d) { var V = d && byId(d.id); if (!V) return; V.stats = d; if (S.statusSoon && V.P && V.P.win) S.statusSoon(V.P.win); });
  }
  var mbps = function (b, ms) { var v = b * 8 / Math.max(1, ms) / 1000; return (v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2)) + " Mbps"; };
  function statsLine(V) {
    var d = V && V.stats;
    if (!V || !V.up || !d) return "";
    if (V.paused) return t("已暂停", "Paused") + (d.w ? " · " + d.w + "×" + d.h : "");
    var bits = [d.w ? d.w + "×" + d.h : "", Math.round(d.frames * 1000 / Math.max(1, d.ms)) + " fps", mbps(d.bytes, d.ms), d.codec === "hevc" ? "H.265" : "H.264"];
    if (V.rtt) bits.push(V.rtt + " ms");
    return bits.filter(Boolean).join(" · ");
  }

  // ---- 连：那台开始截屏 ----
  function start(V) {
    var o = optsOf(V.dev);
    V.err = null; V.perm = ""; V.up = false; V.paused = false;
    paint(V);
    if (!V.L) {
      V.L = TSU_RLINK.open(V.dev);
      V.offF = V.L.on("screen.frame", function (d) { if (d && d.id === V.id && !V.closed) N.call("scr.data", d).catch(function () {}); });
      V.offE = V.L.on("screen.end", function (d) { if (d && d.id === V.id) { V.up = false; V.err = t("此 Mac 停止了屏幕共享", "This Mac stopped sharing its screen") + (d.msg ? "：" + d.msg : ""); V.errTitle = t("屏幕共享已停止", "Screen Sharing Stopped"); paint(V); } });
      V.offS = V.L.on("state", function (s) { if (s === "open" && V.wantUp && !V.up && !V.starting) start(V); if (s === "offline") { V.up = false; paint(V); } });
    }
    V.wantUp = true; V.starting = true;
    // 这台能硬件解哪几种：能解 H.265 就请那台用 H.265（同样清楚码率少三成左右）；老版本的 App 没有 scr.codecs：照旧 H.264
    var codecsP = V.codecs ? Promise.resolve(V.codecs) : N.call("scr.codecs").then(function (c) { V.codecs = Array.isArray(c) ? c : ["h264"]; return V.codecs; }, function () { V.codecs = ["h264"]; return V.codecs; });
    codecsP.then(function (codecs) { return V.L.call("screen.start", { id: V.id, fps: o.fps, bitrate: bitrateOf(o.q), maxW: o.maxW || 7680, codecs: codecs }, 25000); }).then(function (info) {
      V.starting = false;
      if (V.closed) return;
      V.info = info || {}; V.up = true; V.axWarn = info && info.ax === false;
      N.call("scr.opts", { id: V.id, hud: o.hud }).catch(function () {});
      paint(V);
      if (V.shown()) N.call("scr.focus", { id: V.id }).catch(function () {});
    }, function (e) {
      V.starting = false;
      if (V.closed) return;
      var code = (e && e.code) || "";
      if (code === "E_PERM_SCREEN") V.perm = "screen";
      else {
        var msg = String((e && e.message) || e || "");
        // 那台的 App 太旧（没有截屏这一套：它回「不允许使用 screen.start」）、没回话、不在线、没允许——各写各的
        V.errTitle = "";
        V.err = code === "E_OFFLINE" || V.L.state === "offline" ? t("此 Mac 上的 Vibing Studio 未打开", "Vibing Studio isn’t open on this Mac") :
          code === "E_DENIED" && /screen\./.test(msg) ? t("此 Mac 上的 Vibing Studio 需要更新", "Vibing Studio on this Mac needs updating") :
          code === "E_DENIED" ? t("此 Mac 未授权这台设备", "This Mac hasn’t authorized this device") :
          code === "E_TIMEOUT" ? t("此 Mac 没有响应", "This Mac isn’t responding") : msg;
      }
      paint(V);
    });
    // 往返时间：5 秒量一次（问它一个很小的东西）
    clearInterval(V.rttT);
    V.rttT = setInterval(function () {
      if (!V.up || !V.shown()) return;
      var t0 = performance.now();
      V.L.call("local.info", {}, 10000).then(function () { V.rtt = Math.round(performance.now() - t0); }, function () {});
    }, 5000);
  }
  function stop(V) {
    V.wantUp = false;
    clearInterval(V.rttT);
    if (V.L && V.up) V.L.call("screen.stop", { id: V.id }, 10000).catch(function () {});
    V.up = false;
  }
  function pause(V, on) {
    if (!V.up) return;
    on = on === undefined ? !V.paused : on;
    V.paused = on;
    V.L.call("screen.pause", { id: V.id, on: on }, 10000).catch(function () {});
    N.call("scr.pause", { id: V.id, on: on }).catch(function () {});
    paint(V);
    if (S.statusSoon && V.P && V.P.win) S.statusSoon(V.P.win);
  }
  function popOut(V, mode) { N.call("scr.window", { id: V.id, mode: mode }).then(function (d) { V.popped = !!(d && d.popped); paint(V); }).catch(function () {}); }
  function setOpt(V, k, v) {
    var o = optsOf(V.dev);
    o[k] = v;
    saveOpts(V.dev, o);
    if (k === "hud") return N.call("scr.opts", { id: V.id, hud: v }).catch(function () {});
    if (V.up) V.L.call("screen.opts", { id: V.id, fps: o.fps, bitrate: bitrateOf(o.q), maxW: o.maxW || 7680, codecs: V.codecs || ["h264"] }, 20000).catch(function () {});
  }

  // ---- 卡片（连上以前、出错、分出去了）：画在那一块中间；连着时原生的画面盖住整块 ----
  function cardHtml(V) {
    var nm = esc(names[V.dev] || "Mac"), head = '<div class="rd-cic">' + LOGO + '</div><h2 class="rd-ct">' + nm + "</h2>";
    var btn = function (act, label, primary) { return '<button type="button" data-act="' + act + '"' + (primary ? ' class="rd-primary"' : "") + ">" + esc(label) + "</button>"; };
    if (!native()) return head + '<div class="rd-msg">' + esc(t("需要新版 App", "Requires the latest app")) + "</div>";
    if (V.popped) return head + '<div class="rd-msg">' + esc(t("在单独的窗口中", "In a separate window")) + '</div><div class="rd-cbtns">' + btn("front", t("显示窗口", "Show Window")) + btn("dock", t("放回这里", "Move Back Here"), true) + "</div>";
    if (V.perm === "screen") return head + '<div class="rd-err">' + esc(t("此 Mac 尚未允许屏幕录制", "This Mac hasn’t allowed screen recording")) + '</div><div class="rd-msg">' + esc(t("在此 Mac 的「系统设置 › 隐私与安全性 › 屏幕与系统录音」中允许 Vibing Studio，然后重试。", "On this Mac, allow Vibing Studio in System Settings › Privacy & Security › Screen & System Audio Recording, then try again.")) + '</div><div class="rd-cbtns">' + btn("retry", t("重试", "Try Again"), true) + "</div>";
    if (V.err) return head + '<div class="rd-err">' + esc(V.errTitle || t("无法连接到此 Mac", "Can’t Connect to This Mac")) + '</div><div class="rd-msg">' + esc(V.err) + '</div><div class="rd-cbtns">' + btn("retry", t("重试", "Try Again"), true) + "</div>";
    if (!V.up) return head + '<div class="rd-wait"><i class="rd-spin"></i>' + esc(t("正在连接…", "Connecting…")) + "</div>";
    return "";
  }
  function paint(V) {
    if (!V.card) return;
    var html = cardHtml(V);
    if (V.card.dataset.h !== html) { V.card.dataset.h = html; V.card.innerHTML = html; }
    V.card.hidden = !html;
    V.box.classList.toggle("on", !html);
    if (V.axWarn && V.up && !V.popped) toastOnce(V, t("此 Mac 尚未允许 Vibing Studio 使用辅助功能，暂时无法控制键盘和鼠标", "This Mac hasn’t allowed Vibing Studio to use Accessibility, so keyboard and mouse control isn’t available yet"));
    if (window.TSU_WEB && TSU_WEB.placeNow) TSU_WEB.placeNow(V);
    if (V.P && V.P.win) V.P.win.syncTitles();
  }
  function toastOnce(V, msg) { if (V.toasted === msg) return; V.toasted = msg; if (S.toast) S.toast(msg); }

  // ---- 页面 ----
  function render(host, P, arg, V) {
    host.classList.add("st-pg-rdp");
    if (!cmds.length && N && N.call) ready.then(function () { if (V.redraw) V.redraw(); });
    if (V.id) return paint(V);
    V.dev = arg;
    V.id = "scr:" + arg;
    V.P = P;
    views[V.id] = V;
    host.innerHTML = '<div class="rd"><div class="rd-box"></div><div class="rd-card" hidden></div></div>';
    V.box = host.querySelector(".rd-box");
    V.card = host.querySelector(".rd-card");
    V.frameCmd = "scr.place";
    V.closeCmd = "scr.close";
    V.want = function () { return !!V.up && !V.popped; };
    V.gone = function () { return P.closed; };
    host.addEventListener("click", function (e) {
      var b = e.target.closest("[data-act]");
      if (!b) return;
      var a = b.dataset.act;
      if (a === "retry") return start(V);
      if (a === "front") return popOut(V, "window");
      if (a === "dock") return popOut(V, "tab");
    });
    V.box.addEventListener("mousedown", function () { if (V.want()) N.call("scr.focus", { id: V.id }).catch(function () {}); });
    ready.then(function () {
      if (!native()) return paint(V);
      N.call("scr.open", { id: V.id }).then(function () { if (window.TSU_WEB && TSU_WEB.track) TSU_WEB.track(V); start(V); }, function (e) { V.err = String((e && e.message) || e); paint(V); });
    });
    paint(V);
  }
  // 标签页关了：那台停止截屏，原生那一块收掉（TSU_WEB 也会关）
  setInterval(function () { Object.keys(views).forEach(function (id) { var V = views[id]; if (V.P && V.P.closed) { V.closed = true; stop(V); if (V.offF) V.offF(); if (V.offE) V.offE(); if (V.offS) V.offS(); delete views[id]; N.call("scr.close", { id: id }).catch(function () {}); } }); }, 2000);

  function optsMenu(V) {
    var o = optsOf(V.dev), sl = statsLine(V), at = lastBtn && lastBtn.isConnected ? { el: lastBtn, side: "below-end" } : undefined;
    S.menu([
      sl ? { header: true, label: sl } : null,
      sl ? { sep: true } : null,
      { label: t("帧率", "Frame Rate"), value: o.fps + " fps", items: FPS.map(function (f) { return { label: f + " fps", checked: o.fps === f, run: function () { setOpt(V, "fps", f); } }; }) },
      { label: t("画质", "Quality"), value: t(QUAL.filter(function (q) { return q[0] === o.q; })[0][1], QUAL.filter(function (q) { return q[0] === o.q; })[0][2]), items: QUAL.map(function (q) { return { label: t(q[1], q[2]) + " · " + Math.round(q[3] / 1e6) + " Mbps", checked: o.q === q[0], run: function () { setOpt(V, "q", q[0]); } }; }) },
      { label: t("清晰度", "Resolution"), value: o.maxW ? o.maxW + "" : t("原始", "Original"), items: WIDTHS.map(function (w) { return { label: w[1] ? t(w[1], w[2]) : t("最宽 ", "Up to ") + w[0], checked: (o.maxW || 0) === w[0], run: function () { setOpt(V, "maxW", w[0]); } }; }) },
      { label: t("画面上显示统计", "Show Stats on Picture"), checked: o.hud, run: function () { setOpt(V, "hud", !o.hud); } },
      { sep: true },
      V.up ? { label: V.paused ? t("继续", "Resume") : t("暂停", "Pause"), run: function () { pause(V); } } : null,
      V.up ? { label: t("在单独的窗口中打开", "Open in Separate Window"), run: function () { popOut(V, "window"); } } : null,
      V.up ? { label: t("全屏", "Full Screen"), run: function () { popOut(V, "fullscreen"); } } : null,
      { label: t("重新连接", "Reconnect"), run: function () { stop(V); start(V); } },
    ].filter(Boolean), at);
  }
  var lastBtn = null;
  document.addEventListener("mousedown", function (e) { var b = e.target.closest && e.target.closest(".st-tacts button, .st-facts button"); if (b) lastBtn = b; }, true);

  S.pages.macdesk = {
    title: function (arg) { return names[arg] || "Mac"; },
    address: function (arg) { return "screen://" + (names[arg] || arg); },
    icon: function () { return LOGO; },
    render: render,
    detach: function (host, P, arg, V) { if (V && V.id && native()) N.call("scr.place", { id: V.id, x: 0, y: 0, w: 0, h: 0, visible: false }).catch(function () {}); },
    focus: function (host, P, arg, V) { if (V && V.id && V.want && V.want()) N.call("scr.focus", { id: V.id }).catch(function () {}); },
    tabActions: function (host, P, arg, V) {
      if (!V || !V.id || !native()) return [];
      var acts = [{ icon: IC.reload, title: t("重新连接", "Reconnect"), run: function () { stop(V); start(V); } }];
      if (V.up) acts.push(
        { icon: V.paused ? IC.play : IC.pause, title: V.paused ? t("继续", "Resume") : t("暂停", "Pause"), run: function () { pause(V); } },
        { icon: IC.pop, title: t("在单独的窗口中打开", "Open in Separate Window"), run: function () { popOut(V, "window"); } },
        { icon: IC.full, title: t("全屏", "Full Screen"), run: function () { popOut(V, "fullscreen"); } });
      acts.push({ icon: IC.opts, title: t("连接选项", "Connection Options"), run: function () { optsMenu(V); } });
      return acts;
    },
  };
  // 「设备」用：开一台 Mac 的屏幕；状态栏用：这一页的统计、点了出选项
  var progV = function (prog) { return prog && prog.page === "macdesk" ? byId("scr:" + prog.arg) : null; };
  window.TSU_MACDESK = {
    open: function (dev, name, tw) { setName(dev, name); return S.openPage(tw || (window.TSU_TERM && TSU_TERM.front ? TSU_TERM.front() : null), "macdesk", dev); },
    native: function () { return native(); },
    statusLine: function (prog) { return statsLine(progV(prog)); },
    options: function (prog) { var V = progV(prog); if (V) optsMenu(V); },
  };
})();
