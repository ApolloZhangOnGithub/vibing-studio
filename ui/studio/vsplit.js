// vsplit.js —— 一个 agent 的标签页里拆成几格（不再开一组编辑器）：每格都是同一个对话，各看各的——自己的筛选。
//   预设为主：默认（跟设置）、只看对话、只看工具、调试、精简，加上自己存的；「编辑…」在右边展开一栏细调，改过就是「自定义」，能存成预设、改名、删掉。
//   每一种筛选都能反选（显示着的藏起来，藏着的按默认的一档显示）。输入框只有一个：标签页最下面那个（拆出来的格没有）。
//   终端界面、图形界面都行（每格用标签页现在的外壳），Paimon 的 agent、Claude Code / Codex 的会话一样（都是 agent 的标签页）。
//   入口：编辑区 ··· ›「视图预设」「拆分视图」；拆分按钮、⌘D / ⇧⌘D、标签页右键的「向上 / 下 / 左 / 右拆分」在 agent 的标签页上都是这个（live.js 的 ws.split）。
//   每格的标题行：预设名 ⌄（点开换，指着就预览）· 反选 · 编辑 · 关掉这一格；格与格之间的线能拖。拆成什么样、每格的筛选跟着标签页记下来（P.spec().vs）。
(function () {
  "use strict";
  if (window.TSU_VSPLIT) return;
  var T = function () { return window.TSU_TERM; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); };
  var GAP = 5, ED_W = 320, MIN_W = 160, MIN_H = 60, MAX_CELLS = 6; // 格之间（一条线，两边好拖）、右边编辑栏多宽、一格最窄 / 最矮、最多几格
  var ICON = {
    down: '<svg viewBox="0 0 16 16"><path d="M4.5 6.5 8 10l3.5-3.5"/></svg>',
    invert: '<svg viewBox="0 0 16 16"><path d="M2.5 5.5h10M10 3l2.5 2.5L10 8M13.5 10.5h-10M6 8l-2.5 2.5L6 13"/></svg>',
    edit: '<svg viewBox="0 0 16 16"><path d="M3 13h2.5L13 5.5 10.5 3 3 10.5zM9 4.5 11.5 7"/></svg>',
    close: '<svg viewBox="0 0 16 16"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg>',
  };
  var gui = function (P) { return !!(P.program && P.program.gui); };
  var headH = function () { return 0; }; // 拆开的每一格就是一模一样的一份：不要标题行（预设、反选、编辑那一排都不要）
  var can = function (P) { return !!(P && !P.side && !P.closed && P.program && P.program.agentId && !P.program.pty && !P.program.page); };
  var DEF = function () { return { vals: {}, preset: "default" }; }; // 默认：跟设置（空的一套）
  // 记下来的一格：还是某个预设（没改过、没反选）的，按预设现在的样子重新套（预设后来加了、改了的项跟着变——比如「Claude Code 原样」）；改过的照原样
  var clean = function (v) {
    if (!v || !v.vals || typeof v.vals !== "object") return null;
    var fresh = typeof v.preset === "string" && v.preset !== "default" && !v.inv && T() && T().presets && T().presets.view ? T().presets.view(v.preset) : null;
    if (fresh && fresh.vals) return fresh;
    return { vals: JSON.parse(JSON.stringify(v.vals)), preset: typeof v.preset === "string" ? v.preset : null, base: typeof v.base === "string" ? v.base : null, inv: !!v.inv };
  };
  var norm = function (a) { var s = a.reduce(function (x, y) { return x + y; }, 0) || 1; return a.map(function (x) { return x / s; }); };
  var menuIcons = function () { return window.STUDIO && STUDIO.menuIcons ? STUDIO.menuIcons() : {}; };
  var persist = function (S) { try { if (S.P.win && S.P.win.persist) S.P.win.persist(); } catch (e) { /* 窗口关了 */ } };

  // ======== 一个标签页的几格 ========
  function S_of(P) { return P.vs || (P.vs = make(P)); }
  function make(P) {
    var S = { P: P, agentId: P.program.agentId, dir: "cols", cells: [{ main: true, pane: P, real: P.view || null, head: null, box: null }], sizes: [1], active: 0, edit: false, ed: null, name: null };
    S.panes = function () { return S.cells.slice(1).map(function (c) { return c.pane; }); };
    S.on = function () { return S.cells.length > 1 || S.edit; };
    S.fit = function (avail) { return S.on() && !gui(P) ? geo(S, avail) : null; }; // 终端界面：P.fit 问这一格（主视图）多高
    S.state = function () {
      var views = S.cells.map(function (c) { return clean(c.real); });
      if (S.cells.length === 1 && !views[0]) return P.follow ? { views: [null], follow: true } : null;
      return { dir: S.dir, sizes: S.sizes.map(function (x) { return Math.round(x * 1000) / 1000; }), views: views, active: S.active };
    };
    S.close = function () { S.cells.slice(1).forEach(dropCell); S.cells.length = 1; };
    // 标签页换了程序：还是 agent（换了外壳 TUI ↔ GUI，或者连接器换了会话 id、换了一个 agent）——每格跟着换，各自的筛选不变；
    // 不是 agent 了（退回 shell、换成页面）——合回一格，筛选回到默认
    S.onRun = function (prog) {
      if (prog && prog.agentId && !prog.pty && !prog.page) { S.agentId = prog.agentId; setTimeout(function () { if (P.vs === S) rewrap(S); }, 0); return; }
      teardown(S);
    };
    // 点到哪一格：哪一格就是「当前这一格」（··· 菜单改它、⌘D 从它拆）
    P.el.addEventListener("pointerdown", function (e) {
      if (P.vs !== S || !S.on()) return;
      var t = e.target, i = 0;
      if (S.ed && S.ed.contains(t)) return;
      S.cells.forEach(function (c, j) { if (c.box && c.box.contains(t)) i = j; });
      if (i !== S.active) { S.active = i; heads(S); if (S.edit) edRender(S); }
    }, true);
    // 图形界面：对话区、输入框的大小变了就重排（终端界面走 P.fit）
    S.ro = new ResizeObserver(function () { if (P.vs === S && S.on() && gui(P)) soon(S); });
    S.ro.observe(P.el);
    return S;
  }
  var soon = function (S) { if (S.raf) return; S.raf = setTimeout(function () { S.raf = 0; if (S.P.vs === S) relayout(S); }, 16); }; // 不用 rAF：窗口在后台、屏幕外时 rAF 可能很久不来（同 live.js 的 check）
  // 摆一遍：终端界面让 P.fit 算（它问 S.fit）；图形界面按对话区的大小算
  function relayout(S) {
    var P = S.P;
    P.el.classList.toggle("vs-on", S.on());
    P.el.classList.toggle("vs-cols", S.on() && S.dir === "cols");
    P.el.classList.toggle("vs-rows", S.on() && S.dir === "rows");
    if (!S.on()) { clearGeo(S); return; }
    if (gui(P)) geoGui(S); else if (P.fit) { P.fit(); if (P.check) P.check(); }
    S.panes().forEach(function (p) { if (p.check) p.check(); });
  }
  function clearGeo(S) {
    var st = S.P.el.style;
    ["--vs-a", "--vs-top", "--vs-mh", "--vs-rest"].forEach(function (k) { st.removeProperty(k); });
    if (S.cells[0].head) { S.cells[0].head.remove(); S.cells[0].head = null; }
    if (S.ed) { S.ed.remove(); S.ed = null; }
    S.divs && S.divs.forEach(function (d) { d.remove(); });
    S.divs = [];
    if (S.P.fit && !gui(S.P)) S.P.fit();
  }

  // ---- 算位置：cols 左右排，rows 上下排；主视图（标签页自己的那块）总在第一格（左 / 上），编辑栏在最右 ----
  // 终端界面：高度取整到行（同终端）；返回给 P.fit：主视图上面让出标题行（top）、多高（h）、下面让给别的格（bottom）
  function geo(S, avail) {
    if (!S.P.el.clientWidth || avail <= 0) return null; // 还没放进窗口 / 藏着：等量得出大小再摆
    var P = S.P, rowH = P.rowH || 17, n = S.cells.length, hh = n > 1 ? headH(P) : 0, W = P.el.clientWidth, Wc = Math.max(MIN_W, W - (S.edit ? ED_W : 0));
    var g = plan(S, Wc, avail, hh, function (h) { return Math.max(rowH * 2, Math.floor(h / rowH) * rowH); });
    place(S, g, 0);
    return { top: hh, h: g.mainH, bottom: S.dir === "rows" ? Math.max(0, avail - hh - g.mainH) : 0 };
  }
  function geoGui(S) {
    var P = S.P, host = P.program && P.program.host, bot = host && host.querySelector(":scope > .gv-bottom");
    if (!host || !host.clientHeight) return;
    var n = S.cells.length, hh = n > 1 ? headH(P) : 0, avail = host.clientHeight - (bot ? bot.offsetHeight : 0), W = P.el.clientWidth, Wc = Math.max(MIN_W, W - (S.edit ? ED_W : 0));
    var g = plan(S, Wc, avail, hh, function (h) { return Math.max(MIN_H, Math.round(h)); });
    var st = P.el.style;
    st.setProperty("--vs-top", hh + "px");
    if (S.dir === "rows") { st.setProperty("--vs-mh", g.mainH + "px"); st.setProperty("--vs-rest", Math.max(0, avail - hh - g.mainH) + "px"); }
    place(S, g, host.offsetTop);
    if (bot && S.botRo !== bot) { S.botRo = bot; S.ro.observe(bot); } // 输入框长高了（多行）：也重排
  }
  // 每格的矩形（相对这一块对话区的左上角）
  function plan(S, Wc, avail, hh, round) {
    var n = S.cells.length, cells = [], divs = [], mainH;
    if (S.dir === "cols") {
      var room = Wc - (n - 1) * GAP, x = 0;
      mainH = round(avail - hh);
      S.cells.forEach(function (c, i) { var w = i === n - 1 ? Wc - x : Math.max(MIN_W, Math.round(room * S.sizes[i])); cells.push({ x: x, y: 0, w: w, h: hh + mainH }); if (i) divs.push({ x: x - GAP, y: 0, w: GAP, h: hh + mainH }); x += w + GAP; });
    } else {
      var roomH = avail - n * hh - (n - 1) * GAP, y = 0;
      mainH = round(roomH * S.sizes[0]);
      S.cells.forEach(function (c, i) {
        var h = i === 0 ? hh + mainH : i === n - 1 ? avail - y : hh + Math.max(MIN_H, Math.round(roomH * S.sizes[i]));
        cells.push({ x: 0, y: y, w: Wc, h: h });
        if (i) divs.push({ x: 0, y: y - GAP, w: Wc, h: GAP });
        y += h + GAP;
      });
    }
    return { cells: cells, divs: divs, mainH: mainH, hh: hh, Wc: Wc, H: S.dir === "cols" ? hh + mainH : avail };
  }
  function place(S, g, y0) {
    var P = S.P, px = function (v) { return Math.round(v) + "px"; };
    P.el.style.setProperty("--vs-a", px(g.cells[0].w));
    P.el.style.setProperty("--vs-hh", px(g.hh));
    S.cells.forEach(function (c, i) {
      var r = g.cells[i];
      if (g.hh) {
        if (!c.head) mkHead(S, c);
        if (i === 0) { var h0 = c.head.style; h0.left = "0px"; h0.top = px(y0 + r.y); h0.width = px(r.w); h0.height = px(g.hh); }
      } else if (c.head && i === 0) { c.head.remove(); c.head = null; }
      if (!c.box) return;
      var b = c.box.style; b.left = px(r.x); b.top = px(y0 + r.y); b.width = px(r.w); b.height = px(r.h);
    });
    S.divs = S.divs || [];
    while (S.divs.length > g.divs.length) S.divs.pop().remove();
    g.divs.forEach(function (d, i) {
      var el = S.divs[i];
      if (!el) { el = S.divs[i] = document.createElement("div"); el.className = "vs-div"; P.el.appendChild(el); drag(S, el); }
      el.dataset.i = i + 1;
      el.classList.toggle("rows", S.dir === "rows");
      el.style.left = px(d.x); el.style.top = px(y0 + d.y); el.style.width = px(d.w); el.style.height = px(d.h);
    });
    if (S.edit) {
      if (!S.ed) mkEd(S);
      var e = S.ed.style; e.left = px(g.Wc); e.top = px(y0); e.width = px(P.el.clientWidth - g.Wc); e.height = px(g.H);
    } else if (S.ed) { S.ed.remove(); S.ed = null; }
    heads(S);
  }
  // 拖格与格之间的线：相邻两格按比例分
  function drag(S, el) {
    el.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch (x) { /* 测试里不是真的指针 */ }
      var i = +el.dataset.i, rows = S.dir === "rows", start = rows ? e.clientY : e.clientX, a0 = S.sizes[i - 1], b0 = S.sizes[i];
      var span = rows ? Math.max(1, S.P.el.clientHeight - 80) : Math.max(1, S.P.el.clientWidth - (S.edit ? ED_W : 0));
      var mv = function (ev) {
        var d = ((rows ? ev.clientY : ev.clientX) - start) / span, lo = (rows ? MIN_H : MIN_W) / span;
        var a = Math.max(lo, Math.min(a0 + b0 - lo, a0 + d));
        S.sizes[i - 1] = a; S.sizes[i] = a0 + b0 - a;
        soon(S);
      };
      var up = function () { el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); el.classList.remove("on"); persist(S); };
      el.classList.add("on");
      el.addEventListener("pointermove", mv);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    });
  }

  // ---- 拆出来的一格：一个不带输入框的面板，跑同一个 agent（同标签页的外壳）----
  function addCell(S, view, at) {
    var P = S.P, P2 = T().mirrorPane(P), box = document.createElement("div");
    P2.mirror = P;
    P2.view = view;
    P2.el.classList.add("nofoot", "vs-pane");
    P2.focus = function () { P.focus(); }; // 点到这一格：焦点还是给标签页的输入框（只有一个）
    box.className = "vs-cell";
    box.appendChild(P2.el);
    P.el.appendChild(box);
    var c = { pane: P2, real: view, head: null, box: box };
    S.cells.splice(at, 0, c);
    mkHead(S, c);
    return c;
  }
  function runCell(S, c) {
    var P2 = c.pane;
    P2.onRun = null;
    P2.run(T().makeView(P2, S.agentId), true);
    P2.onRun = function () { return true; }; // 这一格里换不了程序（/exit、换 agent 都在标签页那格做）
  }
  function dropCell(c) {
    if (!c || c.main) return;
    c.pane.onRun = null;
    try { c.pane.close(); } catch (e) { /* 已经关了 */ }
    c.box.remove();
  }
  function rewrap(S) {
    S.cells.slice(1).forEach(function (c) { runCell(S, c); });
    S.cells.forEach(function (c) { if (c.head) { c.head.remove(); c.head = null; } });
    relayout(S);
  }
  function teardown(S) {
    var P = S.P;
    S.close();
    S.edit = false;
    S.cells[0].real = null;
    P.view = null;
    clearGeo(S);
    S.ro.disconnect();
    ["vs-on", "vs-cols", "vs-rows"].forEach(function (k) { P.el.classList.remove(k); });
    P.vs = null;
  }

  // ======== 拆 / 合 ========
  // o: { dir: "cols" | "rows", how: "copy" | "invert", preset: id, view: {...}, before: true（放到当前这一格前面）}
  function split(P, o) {
    if (!can(P)) return false;
    o = o || {};
    var S = S_of(P);
    if (S.cells.length >= MAX_CELLS) { if (P.flash) P.flash("最多拆成 " + MAX_CELLS + " 格"); return false; }
    if (o.dir && (S.cells.length === 1 || o.dir !== S.dir)) S.dir = o.dir;
    var srcI = Math.min(S.active, S.cells.length - 1), src = S.cells[srcI], base = src.real || DEF(), TT = T(), half = (S.sizes[srcI] || 1 / S.cells.length) / 2;
    var view = o.view ? clean(o.view) : o.preset ? TT.presets.view(o.preset) || DEF() : o.how === "invert" ? TT.presets.invert(base) : clean(base) || DEF();
    var c, act;
    if (o.before && srcI === 0) { c = addCell(S, clean(base) || DEF(), 1); act = 0; } // 放到主视图前面：主视图换上新的筛选，原来的挪到它后面一格（主视图总在第一格）
    else { c = addCell(S, view, o.before ? srcI : srcI + 1); act = S.cells.indexOf(c); }
    var ni = S.cells.indexOf(c), srcNew = ni <= srcI ? srcI + 1 : srcI;
    S.sizes.splice(ni, 0, half);
    S.sizes[srcNew] = half;
    S.sizes = norm(S.sizes);
    if (o.before && srcI === 0) setView(S, 0, view, true);
    else if (!src.real) setView(S, srcI, DEF(), true); // 拆开了：每格都有自己的一套（默认 = 跟设置）
    S.active = act;
    relayout(S);
    runCell(S, c);
    relayout(S);
    persist(S);
    return true;
  }
  // 关掉第 i 格；关主视图（第一格）：第二格的筛选挪到主视图，第二格关掉
  function closeCell(S, i) {
    if (S.cells.length < 2) return;
    if (i === 0) { setView(S, 0, S.cells[1].real, true); i = 1; }
    var c = S.cells[i];
    S.cells.splice(i, 1);
    var gone = S.sizes.splice(i, 1)[0] || 0;
    S.sizes[Math.max(0, i - 1)] += gone;
    S.sizes = norm(S.sizes);
    dropCell(c);
    S.active = Math.min(S.active, S.cells.length - 1);
    relayout(S); // 先排好（主视图变宽），再按最后的宽度画一次——不先按窄的画一遍、变宽了再画一遍
    if (S.cells.length === 1) setView(S, 0, S.cells[0].real, true); // 合回一格：还是「默认」的就回到跟设置
    persist(S);
  }
  function unsplit(P) { var S = P.vs; if (!S) return; while (S.cells.length > 1) closeCell(S, S.cells.length - 1); }
  function setDir(P, d) { var S = S_of(P); S.dir = d; relayout(S); persist(S); }

  // ======== 每格的筛选 ========
  // 换一格的筛选（view：null / 默认 = 跟设置）；quiet：不存
  function setView(S, i, view, quiet) {
    var c = S.cells[i], plain = !view || (view.preset === "default" && !Object.keys(view.vals || {}).length);
    if (plain) view = S.cells.length > 1 ? DEF() : null; // 「默认」：拆开时每格一份空的（··· 改的是这一格），没拆开就是跟设置（··· 改设置）
    c.real = view;
    c.pane.view = view;
    if (i === 0) S.P.follow = !view && !!(T().presets.defaultFor && T().presets.defaultFor(S.agentId)); // 默认有预设的标签页（Claude Code 的会话）选了「跟随设置」：记着，重开不再套默认的
    c.pane.renderNow();
    heads(S);
    if (S.edit && S.active === i) edRender(S);
    if (!quiet) persist(S);
  }
  // 预览（菜单里指着）：只换显示，不记
  function preview(S, i, view) { var c = S.cells[i]; c.pane.view = view === undefined ? c.real : view; c.pane.renderNow(); }
  // 这一格筛选的改法（给 live.js 的 ··· 菜单、右边的编辑栏）：改完重画这一格，定下来的存起来
  function accOf(S, i) {
    var c = S.cells[i];
    if (!c.real) { c.real = DEF(); c.pane.view = c.real; } // 跟着设置的那一格要改了：先给它一份自己的（空的：看起来一样）
    var v = c.real;
    return T().viewAcc(v, function (prev) {
      c.pane.view = v;
      c.pane.renderNow();
      if (prev) return;
      c.real = v;
      heads(S);
      if (S.edit) edRender(S);
      persist(S);
    });
  }
  function invert(S, i) { var c = S.cells[i]; setView(S, i, T().presets.invert(c.real || DEF())); }

  // ---- 预设菜单（标题行的名字 ⌄、··· ›「视图预设」）----
  function presetItems(S, i) {
    var TT = T(), c = S.cells[i], cur = c.real, curId = cur ? cur.preset || null : "default", MI = menuIcons();
    var item = function (p) { return { label: p.name, value: p.desc || "", radio: true, checked: curId === p.id, run: function () { setView(S, i, TT.presets.view(p.id) || DEF()); }, preview: function (on) { preview(S, i, on ? TT.presets.view(p.id) || (i === 0 && !S.on() ? null : DEF()) : undefined); } }; };
    var user = TT.presets.user(), fol = TT.presets.follow, out = (fol ? [item(fol), { sep: true }] : []).concat(TT.presets.builtin.map(item)); // 跟随设置（这一格没有自己的）；几套预设
    if (user.length) out = out.concat([{ sep: true }], user.map(function (p) { return item({ id: p.id, name: p.name, desc: "" }); }));
    out = out.concat([{ sep: true },
      { label: "反选当前筛选", icon: MI.invert || MI.swap, run: function () { invert(S, i); } },
      { label: "编辑…", icon: MI.edit || MI.pen, run: function () { openEd(S, i); } },
      { label: "保存为预设…", icon: MI.save, run: function () { openEd(S, i, "save"); } }]);
    if (user.length) out.push({ label: "管理预设", items: function () {
      return TT.presets.user().map(function (p) { return { label: p.name, items: [
        { label: "重命名…", run: function () { openEd(S, i, "rename", p.id); } },
        { label: "删除", run: function () { delPreset(p.id); } }] }; });
    } });
    return out;
  }
  function splitItems(P) {
    var S = P.vs, n = S ? S.cells.length : 1, dir = S ? S.dir : "cols", MI = menuIcons();
    // 拆分就是一模一样再来一份（同 VS Code 的拆分编辑器，最早的那种）：旁边新的一组、一个自己的标签页——各滚各的、各自能关
    var ws = P.win && P.win.ws, to = function (side) { return function () { if (!ws) return; if (ws.show) ws.show(P); if (ws.splitTo) ws.splitTo(side); else if (ws.split) ws.split(side === "bottom" ? "col" : "row"); }; };
    var out = [
      { label: "向右拆分", icon: MI.splitR, keys: "⌘D", run: to("right") },
      { label: "向下拆分", icon: MI.splitD || MI.splitR, keys: "⇧⌘D", run: to("bottom") },
    ];
    // 以前在一个标签页里拆开的几格（还记着的）：能排、能合回一格
    if (n > 1) out.push({ sep: true },
      { label: "左右排列", radio: true, checked: dir === "cols", run: function () { setDir(P, "cols"); } },
      { label: "上下排列", radio: true, checked: dir === "rows", run: function () { setDir(P, "rows"); } },
      { sep: true }, { label: "合并为单个视图", icon: MI.close, run: function () { unsplit(P); } });
    return out;
  }
  // 给 live.js 的 convMenu：前面加的两项，和显示那几项该改谁（当前这一格有自己的筛选就改它的）
  function menu(MI, agentId, P) {
    if (!P) { var tw = T() && T().front ? T().front() : null, a = tw && tw.ws && tw.ws.active; P = a && a.program && a.program.agentId === agentId ? a : null; }
    if (!can(P)) return null;
    var S = P.vs, i = S ? S.active : 0, cur = S ? S.cells[i].real : P.view, name = T().presets.name(cur);
    var items = [
      { label: "视图预设", icon: MI.preset || MI.filter || MI.eye, value: name, items: function () { return presetItems(S_of(P), S ? i : 0); } },
      { label: "拆分视图", icon: MI.splitR, items: function () { return splitItems(P); } },
    ];
    return { items: items, acc: cur && cur.vals ? accOf(S_of(P), i) : null, preset: cur && cur.preset ? cur.preset : null }; // preset：用着一套预设（不是跟随设置、不是自己调的）
  }

  // ---- 标题行 ----
  function mkHead(S, c) {
    var h = document.createElement("div");
    h.className = "vs-head";
    h.addEventListener("click", function (e) {
      var b = e.target.closest("[data-vs]");
      if (!b) return;
      var i = S.cells.indexOf(c), what = b.dataset.vs;
      if (i < 0) return;
      S.active = i;
      if (what === "pick" && window.STUDIO && STUDIO.menu) STUDIO.menu(function () { return presetItems(S, S.cells.indexOf(c)); }, { el: b, side: "below-end" });
      else if (what === "invert") invert(S, i);
      else if (what === "edit") { if (S.edit && S.active === i) closeEd(S); else openEd(S, i); }
      else if (what === "close") closeCell(S, i);
      heads(S);
    });
    if (c.main) S.P.el.appendChild(h); else c.box.insertBefore(h, c.box.firstChild);
    c.head = h;
  }
  function heads(S) {
    var TT = T(), g = gui(S.P);
    S.cells.forEach(function (c, i) {
      if (!c.head) return;
      var v = c.real, p = v && v.preset && TT.presets.of(v.preset), html = '<button class="vs-pick" data-vs="pick" title="切换预设">' + esc(TT.presets.name(v)) + ICON.down + "</button>" +
        (p && p.desc ? '<span class="vs-desc">' + esc(p.desc) + "</span>" : "") + '<span class="vs-fill"></span>' +
        '<button class="vs-ib" data-vs="invert" title="反选">' + ICON.invert + '</button><button class="vs-ib' + (S.edit && S.active === i ? " on" : "") + '" data-vs="edit" title="编辑…">' + ICON.edit + "</button>" +
        '<button class="vs-ib" data-vs="close" title="关闭此视图">' + ICON.close + "</button>";
      if (c.head.dataset.h !== html) { c.head.innerHTML = html; c.head.dataset.h = html; }
      c.head.classList.toggle("on", i === S.active && S.cells.length > 1);
      c.head.classList.toggle("gui", g);
    });
  }

  // ======== 右边的编辑栏：这一格的每一项（同 设置 › 对话），反选、存成预设、改名、删 ========
  function openEd(S, i, mode, pid) {
    S.active = i;
    S.edit = true;
    S.edMode = mode || "";
    S.edPid = pid || null;
    relayout(S);
    edRender(S);
    if (mode) setTimeout(function () { var inp = S.ed && S.ed.querySelector(".vs-name input"); if (inp) { inp.focus(); inp.select(); } }, 30);
  }
  function closeEd(S) { S.edit = false; S.edMode = ""; relayout(S); if (!S.on()) heads(S); }
  function mkEd(S) {
    var ed = document.createElement("div");
    ed.className = "vs-ed";
    S.P.el.appendChild(ed);
    S.ed = ed;
    ed.addEventListener("click", function (e) {
      var t = e.target, o = t.closest(".vs-opt"), b = t.closest("[data-vs]");
      var i = S.active, acc;
      if (o && !o.classList.contains("on")) { acc = accOf(S, i); var v; try { v = JSON.parse(o.dataset.v); } catch (x) { v = o.dataset.v; } acc.setMode(o.dataset.k, v); return; }
      if (!b) return;
      var what = b.dataset.vs;
      if (what === "ed-close") closeEd(S);
      else if (what === "invert") invert(S, i);
      else if (what === "save" || what === "rename") { S.edMode = what; S.edPid = what === "rename" ? (S.cells[i].real || {}).preset : null; edRender(S); var inp = ed.querySelector(".vs-name input"); if (inp) { inp.focus(); inp.select(); } }
      else if (what === "name-ok") nameOk(S);
      else if (what === "name-cancel") { S.edMode = ""; edRender(S); }
      else if (what === "delete") { var pid = (S.cells[i].real || {}).preset; if (pid) delPreset(pid); }
      else if (what === "bytool" && window.STUDIO && STUDIO.menu) { acc = accOf(S, i); STUDIO.menu(function () { return T().byToolItems(S.agentId, acc); }, { el: b, side: "below-end" }); }
    });
    ed.addEventListener("keydown", function (e) {
      if (!e.target.closest(".vs-name")) return;
      e.stopPropagation();
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Enter") { e.preventDefault(); nameOk(S); }
      else if (e.key === "Escape") { e.preventDefault(); S.edMode = ""; edRender(S); }
    });
  }
  function edRender(S) {
    if (!S.ed) return;
    var TT = T(), i = S.active, c = S.cells[i], v = c.real, acc = accOf(S, i), g = gui(S.P), user = v && v.preset && /^u/.test(v.preset) && TT.presets.of(v.preset);
    var rows = TT.filterFields(acc).map(function (f) {
      if (f.head) return '<div class="vs-fh">' + esc(f.head) + "</div>";
      if (f.kind === "button") return f.key === "$invert" ? "" : '<div class="vs-fr"><span class="vs-fl" title="' + esc(f.desc || f.label) + '">' + esc(f.label) + '</span><button class="vs-btn" data-vs="' + esc(f.act) + '">' + esc(f.text || f.label) + "</button></div>";
      var opts = f.kind === "toggle" ? [[true, "开"], [false, "关"]] : f.options || [];
      return '<div class="vs-fr"><span class="vs-fl" title="' + esc(f.desc || f.label) + '">' + esc(f.label) + '</span><span class="vs-fo">' +
        opts.map(function (o) { return '<span class="vs-opt' + (o[0] === f.value ? " on" : "") + '" data-k="' + esc(f.key) + '" data-v="' + esc(JSON.stringify(o[0])) + '">' + esc(o[1]) + "</span>"; }).join("") + "</span></div>";
    }).join("");
    var nm = S.edMode === "save" || S.edMode === "rename" ? '<div class="vs-name"><input spellcheck="false" placeholder="预设名称" value="' + esc(S.edMode === "rename" && S.edPid ? (TT.presets.of(S.edPid) || {}).name || "" : "") + '"><button class="vs-btn pri" data-vs="name-ok">' + (S.edMode === "rename" ? "改名" : "保存") + '</button><button class="vs-btn" data-vs="name-cancel">取消</button></div>' : "";
    var html = '<div class="vs-eh"><b>筛选</b><span class="vs-en">' + esc(TT.presets.name(v)) + (S.cells.length > 1 ? " · 第 " + (i + 1) + " 格" : "") + '</span><span class="vs-fill"></span><button class="vs-ib" data-vs="ed-close" title="关闭">' + ICON.close + "</button></div>" +
      '<div class="vs-acts"><button class="vs-btn" data-vs="invert">反选</button><button class="vs-btn" data-vs="save">保存为预设…</button>' + (user ? '<button class="vs-btn" data-vs="rename">重命名…</button><button class="vs-btn" data-vs="delete">删除预设</button>' : "") + "</div>" + nm +
      '<div class="vs-rows">' + rows + "</div>";
    var keep = S.ed.querySelector(".vs-rows"), st = keep ? keep.scrollTop : 0, inp = S.ed.querySelector(".vs-name input"), typed = inp ? inp.value : null;
    if (S.ed.dataset.h === html) return;
    S.ed.innerHTML = html;
    S.ed.dataset.h = html;
    S.ed.classList.toggle("gui", g);
    var rs = S.ed.querySelector(".vs-rows"); if (rs) rs.scrollTop = st;
    var inp2 = S.ed.querySelector(".vs-name input"); if (inp2 && typed !== null) inp2.value = typed;
  }
  // 存成预设 / 改名（名字输在编辑栏上面那一行）
  function nameOk(S) {
    var inp = S.ed && S.ed.querySelector(".vs-name input"), name = inp ? inp.value.trim() : "", TT = T(), i = S.active, c = S.cells[i];
    if (!name) { if (inp) inp.focus(); return; }
    var list = TT.presets.user().slice();
    if (S.edMode === "rename" && S.edPid) list = list.map(function (p) { return p.id === S.edPid ? { id: p.id, name: name, vals: p.vals } : p; });
    else {
      var p = { id: "u" + Date.now().toString(36), name: name, vals: TT.presets.snap(c.real || DEF()) };
      list.push(p);
      c.real = { vals: JSON.parse(JSON.stringify(p.vals)), preset: p.id };
    }
    S.edMode = "";
    TT.presets.save(list);
    setView(S, i, c.real);
    everyHead();
  }
  function delPreset(id) {
    var TT = T();
    TT.presets.save(TT.presets.user().filter(function (p) { return p.id !== id; }));
    // 用着它的格：筛选不变，变成「自定义」
    TT.panes().forEach(function (P) { if (!P.vs) return; P.vs.cells.forEach(function (c) { if (c.real && c.real.preset === id) { c.real.preset = null; c.real.base = null; } }); heads(P.vs); if (P.vs.edit) edRender(P.vs); persist(P.vs); });
  }
  function everyHead() { var TT = T(); TT.panes().forEach(function (P) { if (P.vs) { heads(P.vs); if (P.vs.edit) edRender(P.vs); } }); }

  // ---- 恢复（标签页从记下的样子建回来：Pane() 里）----
  function restore(P, st) {
    if (!st || !Array.isArray(st.views) || !st.views.length || !can(P)) return;
    var S = S_of(P);
    S.dir = st.dir === "rows" ? "rows" : "cols";
    var v0 = clean(st.views[0]);
    S.cells[0].real = v0; P.view = v0;
    P.follow = !!st.follow && !v0;
    // 以前在一个标签页里拆开的几格不再建回来（那种拆了关不掉）：只要主视图这一格；要并排看就用拆分（旁边一组、自己的标签页）
    if (st.views.length > 1) setTimeout(function () { persist(S); }, 0);
    S.sizes = Array.isArray(st.sizes) && st.sizes.length === S.cells.length ? norm(st.sizes.map(function (x) { return Math.max(0.05, +x || 0); })) : S.cells.map(function () { return 1 / S.cells.length; });
    S.active = Math.min(S.cells.length - 1, Math.max(0, st.active | 0));
    relayout(S);
    S.cells.slice(1).forEach(function (c) { runCell(S, c); });
  }

  window.TSU_VSPLIT = { can: can, split: split, unsplit: unsplit, restore: restore, menu: menu, closeCell: function (P, i) { if (P.vs) closeCell(P.vs, i); }, setView: function (P, i, v) { setView(S_of(P), i, v); },
    openEditor: function (P, i, mode) { if (can(P)) openEd(S_of(P), i || 0, mode); }, closeEditor: function (P) { if (P.vs) closeEd(P.vs); }, invert: function (P, i) { if (can(P)) invert(S_of(P), i || 0); }, setDir: setDir };
})();
