// macos.js —— 应用风格之三：macOS（设置里「应用风格」选 macOS，<html> 上是 st-macos）。
// 不是 VS Code 那样平铺：桌面（墙纸、小组件）、上面的菜单栏（App 名、菜单、控制中心、时钟）、下面的程序坞；
// 编辑区里的每个标签页是桌面上的一个窗口（不是真的 macOS 新窗口）：标题栏拖动、四边四角拉大小、红黄绿（关 / 收进程序坞 / 缩放）、
// 拖到左右边缘占半边、到顶上占满、到四个角占四分之一（同 macOS 的窗口平铺），双击标题栏缩放；点一下到最前，焦点（菜单、快捷键）跟着走。
// 「App」管这些窗口：访达（File Finder + Agent Finder，窗口里切换）、Agent IDE（agent 对话、文件、仪表盘）、设置、浏览器；
// 「应用程序」是启动台（打字就搜，也当 Spotlight 用：⌥空格）。
// 接在 live.js 的 ws.layout 上（TSU_MACOS.on() 为真时它调 TSU_MACOS.layout(tw, ws)）；desk.js 的菜单栏、程序坞、启动台照用，几个地方问 TSU_MACOS。
(function () {
  "use strict";
  var root = document.documentElement, D = window.TSU_DESK;
  if (!D) return;
  var desk = document.getElementById("desktop"), dock = document.getElementById("dock");
  var on = function () { return root.classList.contains("st-macos"); };
  var en = function () { return !!(window.TSU_I18N && TSU_I18N.lang && TSU_I18N.lang() === "en"); };
  var tr = function (zh, e) { return en() ? e : zh; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var LS = {
    get: function (k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 满了 */ } },
  };
  var T = function () { return window.TSU_TERM; }, S = function () { return window.STUDIO; };
  // 桌面上的窗口都在页面里原来那个终端窗口（#win）里：它在 macOS 风格下是铺满桌面的一层透明的底
  var mainTw = function () {
    var t = T();
    if (!t) return null;
    var w = (t.wins ? t.wins() : []).filter(function (x) { return x.el && x.el.id === "win"; })[0];
    return w || (t.front ? t.front() : null);
  };

  // ======== 图标（程序坞、启动台里 50×50 的一格）========
  var SV = function (body) { return '<svg viewBox="0 0 50 50" width="50" height="50">' + body + "</svg>"; };
  var ICON = {
    // 访达：蓝白两半的笑脸
    finder: '<span class="ico sq mac-ico mac-ico-finder">' + SV('<path d="M0 0h27c-3 6-5 14-5 25h6c0 10 1 18 4 25H0z" fill="#1e8bff"/><path d="M27 0h23v50H32c-3-7-4-15-4-25h-6c0-11 2-19 5-25z" fill="#e9f3fd"/>' +
      '<path d="M15 16v6M35 16v6" stroke="#10243d" stroke-width="2.6" stroke-linecap="round"/><path d="M12 33c8 6 18 6 26 0" fill="none" stroke="#10243d" stroke-width="2.4" stroke-linecap="round"/>') + "</span>",
    // Agent IDE：深色的窗口，一颗 ✦，下面一行代码
    ide: '<span class="ico sq mac-ico mac-ico-ide">' + SV('<rect x="8" y="10" width="34" height="30" rx="5" fill="#1c1c1f" stroke="rgba(255,255,255,.18)"/><circle cx="13" cy="15" r="1.5" fill="#ff5f57"/><circle cx="17.5" cy="15" r="1.5" fill="#febc2e"/><circle cx="22" cy="15" r="1.5" fill="#28c840"/>' +
      '<path d="M25 20.5c.6 4.3 2.7 6.4 7 7-4.3.6-6.4 2.7-7 7-.6-4.3-2.7-6.4-7-7 4.3-.6 6.4-2.7 7-7z" fill="#d77757"/>') + "</span>",
    // 设置：灰色的齿轮
    settings: '<span class="ico sq mac-ico mac-ico-settings">' + SV('<g transform="translate(25 25)"><g fill="#3a3a3e">' +
      [0, 45, 90, 135, 180, 225, 270, 315].map(function (a) { return '<rect x="-3.2" y="-17" width="6.4" height="8" rx="1.6" transform="rotate(' + a + ')"/>'; }).join("") +
      '</g><circle r="11.5" fill="#3a3a3e"/><circle r="5" fill="#d1d1d6"/></g>') + "</span>",
    // 浏览器：蓝色的罗盘
    browser: '<span class="ico sq mac-ico mac-ico-browser">' + SV('<circle cx="25" cy="25" r="17" fill="#fff"/><circle cx="25" cy="25" r="15" fill="#2d8cf0"/>' +
      '<g stroke="rgba(255,255,255,.7)" stroke-width="1">' + [0, 30, 60, 90, 120, 150].map(function (a) { return '<path d="M25 11v3" transform="rotate(' + a + ' 25 25)"/><path d="M25 36v3" transform="rotate(' + a + ' 25 25)"/>'; }).join("") + "</g>" +
      '<path d="M25 25l7-12-12 7z" fill="#ff453a"/><path d="M25 25l-7 12 12-7z" fill="#fff"/>') + "</span>",
    // 全局助手（globalagent.js）：深紫的底，中间一颗 ✦，四角四个小点（它看着的那些 agent）
    global: '<span class="ico sq mac-ico mac-ico-global">' + SV('<path d="M25 13c1.2 7.3 4.7 10.8 12 12-7.3 1.2-10.8 4.7-12 12-1.2-7.3-4.7-10.8-12-12 7.3-1.2 10.8-4.7 12-12z" fill="#fff"/>' +
      [[12, 12], [38, 12], [12, 38], [38, 38]].map(function (p) { return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="2.6" fill="rgba(255,255,255,.55)"/>'; }).join("")) + "</span>",
  };
  // 窗口标题栏、菜单里的小图标（16 格，线条）
  var MINI = {
    files: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.8 4.2c0-.6.4-1 1-1h3.1l1.4 1.5h5.9c.6 0 1 .4 1 1v6.6c0 .6-.4 1-1 1H2.8c-.6 0-1-.4-1-1z"/></svg>',
    agents: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="5" height="5" rx="1.4"/><rect x="9" y="2" width="5" height="5" rx="1.4"/><rect x="2" y="9" width="5" height="5" rx="1.4"/><path d="M11.5 9.2c.2 1.2.8 1.8 2 2-1.2.2-1.8.8-2 2-.2-1.2-.8-1.8-2-2 1.2-.2 1.8-.8 2-2z"/></svg>',
    back: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5L5.5 8l4.5 4.5"/></svg>',
    fwd: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5L10.5 8 6 12.5"/></svg>',
  };

  // ======== App：窗口归哪个 App（程序坞里的一格）========
  var APPS = {
    "st-finder": { name: ["访达", "Finder"], icon: ICON.finder, size: [940, 580], uni: true, cat: "工具" },
    win: { name: ["Agent", "Agent"], icon: ICON.ide, size: [860, 620], cat: "开发者工具" }, // 打开 agent 就像打开一个文件：每个 agent 一个窗口（没有 IDE 那些东西）
    "st-settings": { name: ["设置", "Settings"], icon: ICON.settings, size: [900, 640], uni: true, cat: "工具" },
    "st-browser": { name: ["浏览器", "Browser"], icon: ICON.browser, size: [1060, 720], cat: "信息与阅读" },
    "st-global": { name: ["全局助手", "Studio Assistant"], icon: ICON.global, size: [560, 720], cat: "开发者工具" }, // 管整个工作区的那个 agent：一个窗口
  };
  var APP_IDS = ["st-finder", "win", "st-global", "st-settings", "st-browser"];
  var nameOf = function (id) { var a = APPS[id]; return a ? tr(a.name[0], a.name[1]) : id; };
  function appOf(p) {
    var pr = p && p.program;
    if (!pr) return "win";
    if (pr.page === "explorer") return "st-finder";
    if (pr.page === "settings" || pr.page === "keys" || pr.page === "extension") return "st-settings";
    if (pr.page === "web") return "st-browser";
    if (pr.agentId && window.TSU_GLOBAL && pr.agentId === TSU_GLOBAL.id()) return "st-global";
    return "win"; // agent 对话、文件、仪表盘、历史记录、终端
  }
  // 访达里现在是哪一边：文件（整台 Mac）还是 Agent（agent 这种「包」）
  var finderSide = function (p) { var a = String((p && p.program && p.program.arg) || ""); return !a || a === "/" || a[0] === "~" || /^Users(\/|$)/.test(a) || /^(Applications|System|Library|Volumes|opt|usr|private|tmp|etc|var)(\/|$)/.test(a) ? "files" : "agents"; };

  // ======== 窗口 ========
  var RECTS = LS.get("st-mac-wins", {}); // 每个窗口（按它开着的是什么）上次的位置大小
  var Z = 10, ZMAX = 10;
  var cur = { tw: null, ws: null }; // 现在排的是哪个终端窗口（App 里只有 #win）
  var keyOf = function (p) { var sp = {}; try { sp = p.spec() || {}; } catch (e) { sp = {}; } return JSON.stringify([sp.agent || "", sp.page || "", sp.page === "web" ? "" : sp.arg || ""]); };
  var frameList = function () { var h = cur.tw && cur.tw.panesEl; return h ? Array.prototype.slice.call(h.querySelectorAll(":scope > .mw:not(.mw-closing)")) : []; };
  var framesOf = function (app) { return frameList().filter(function (f) { return f._app === app; }); };
  // 能放窗口的地方（相对这一层）：菜单栏下面，让开程序坞
  function area() {
    var h = cur.tw && cur.tw.panesEl;
    if (!h) return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 };
    var c = h.getBoundingClientRect(), a = D.area ? D.area() : { left: 0, top: c.top, right: c.right, bottom: c.bottom };
    var r = { left: Math.max(0, a.left - c.left), top: Math.max(0, a.top - c.top), right: Math.min(c.width, a.right - c.left), bottom: Math.min(c.height, a.bottom - c.top) };
    r.width = Math.max(200, r.right - r.left); r.height = Math.max(160, r.bottom - r.top);
    return r;
  }
  var clampR = function (r) {
    var a = area(), w = Math.max(380, Math.min(r.w, a.width)), h = Math.max(240, Math.min(r.h, a.height));
    return { x: Math.round(Math.max(a.left - w + 120, Math.min(r.x, a.right - 120))), y: Math.round(Math.max(a.top, Math.min(r.y, a.bottom - 40))), w: Math.round(w), h: Math.round(h) };
  };
  function place(f, r) {
    f._r = r;
    f.style.left = r.x + "px"; f.style.top = r.y + "px"; f.style.width = r.w + "px"; f.style.height = r.h + "px";
  }
  function initialRect(f) {
    var a = area(), app = APPS[f._app] || APPS.win, w = Math.min(app.size[0], a.width - 40), h = Math.min(app.size[1], a.height - 30);
    var n = frameList().filter(function (x) { return x !== f && !x.classList.contains("mw-min"); }).length % 8;
    return clampR({ x: a.left + (a.width - w) / 2 - 70 + n * 28, y: a.top + 26 + n * 26, w: w, h: h });
  }
  var saveT = 0, laidOut = false;
  function saveSoon() {
    clearTimeout(saveT);
    saveT = setTimeout(function () {
      // prev：平铺 / 缩放之前的大小（双击标题栏、「还原」回到它；重开 App 以后也还在）
      frameList().forEach(function (f) { if (f._p && f._r) RECTS[keyOf(f._p)] = { x: f._r.x, y: f._r.y, w: f._r.w, h: f._r.h, min: f.classList.contains("mw-min") ? 1 : 0, tile: f._tile || "", zoom: f._zoomed ? 1 : 0, prev: f._prev || null }; });
      var keys = Object.keys(RECTS);
      if (keys.length > 200) keys.slice(0, keys.length - 200).forEach(function (k) { delete RECTS[k]; });
      LS.set("st-mac-wins", RECTS);
    }, 300);
  }
  function raise(f) {
    if (!f) return;
    if (+f.style.zIndex !== ZMAX) { ZMAX += 1; f.style.zIndex = ZMAX; }
    frameList().forEach(function (x) { x.classList.toggle("mw-key", x === f); });
    D.refreshMenus && D.refreshMenus();
  }
  function topFrame(except) {
    var best = null;
    frameList().forEach(function (f) { if (f === except || f.classList.contains("mw-min")) return; if (!best || (+f.style.zIndex || 0) > (+best.style.zIndex || 0)) best = f; });
    return best;
  }
  // 焦点跟着窗口走：当前的 agent / 页面、菜单、快捷键
  function focusFrame(f, viaBar) {
    if (!f || !f._p || !cur.ws) return;
    raise(f);
    var ws = cur.ws, p = f._p;
    if (ws.active !== p) { if (viaBar) ws.show(p); else ws.activate(p); }
    else if (viaBar) p.focus();
  }

  // ---- 一个窗口：标题栏（红黄绿、标题、按钮）+ 内容（标签页原来那一块）+ 四边四角 ----
  var EDGES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
  function frameFor(p) {
    if (p._mw) return p._mw;
    var f = document.createElement("div");
    f.className = "mw";
    f.innerHTML = '<div class="mw-bar"><span class="mw-lights"><i data-a="close"></i><i data-a="min"></i><i data-a="zoom"></i></span><span class="mw-lead"></span>' +
      '<span class="mw-title"><span class="mw-ico"></span><span class="mw-t"></span></span><span class="mw-fill"></span><span class="mw-tools"></span></div><div class="mw-body"></div>' +
      EDGES.map(function (e) { return '<i class="mw-rs mw-rs-' + e + '" data-e="' + e + '"></i>'; }).join("");
    f._p = p;
    p._mw = f;
    bind(f);
    return f;
  }
  function bind(f) {
    var bar = f.querySelector(".mw-bar");
    f.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 && e.button !== 2) return;
      var viaBar = !!e.target.closest(".mw-bar") && !e.target.closest("input, button, [data-a], .mw-seg");
      focusFrame(f, viaBar);
    }, true);
    // 红黄绿
    bar.querySelector(".mw-lights").addEventListener("click", function (e) {
      var a = e.target.closest("[data-a]");
      if (!a) return;
      e.stopPropagation();
      if (a.dataset.a === "close") return closeFrame(f);
      if (a.dataset.a === "min") return minimize(f);
      if (a.dataset.a === "zoom") return zoom(f);
    });
    bar.addEventListener("dblclick", function (e) { if (e.target.closest("input, button, [data-a], .mw-seg")) return; zoom(f); });
    // 拖标题栏（统一工具栏的窗口：页面自己的工具栏空白处也能拖）
    f.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      if (e.target.closest(".mw-rs")) return resizeStart(f, e);
      if (!dragZone(f, e.target)) return;
      dragStart(f, e);
    });
    bar.addEventListener("contextmenu", function (e) { e.preventDefault(); frameMenu(f, e); });
  }
  // 能拖窗口的地方：标题栏的空白；访达、设置（统一工具栏）是它们工具栏的空白、侧边栏顶上那一截
  function dragZone(f, t) {
    if (t.closest("input, textarea, button, select, a, [data-a], .mw-seg, .mw-rs, .xp-cr, .xp-seg, .xp-q, [contenteditable]")) return false;
    if (t.closest(".mw-bar")) return true;
    if (!f.classList.contains("mw-uni")) return false;
    if (t.classList.contains("xp-tool") || t.classList.contains("xp-crumbs") || t.classList.contains("xp-fill")) return true;
    if (t.classList.contains("ss-top") || t.classList.contains("ss-h2")) return true;
    return false;
  }
  var snapEl = null;
  function snapPreview(r) {
    var h = cur.tw && cur.tw.panesEl;
    if (!h) return;
    if (!r) { if (snapEl) { snapEl.remove(); snapEl = null; } return; }
    if (!snapEl) { snapEl = document.createElement("div"); snapEl.className = "mw-snap"; h.appendChild(snapEl); }
    snapEl.style.cssText = "left:" + r.x + "px;top:" + r.y + "px;width:" + r.w + "px;height:" + r.h + "px;z-index:" + (ZMAX + 1);
  }
  // 平铺（同 macOS 15+ 的窗口平铺）：拖到左 / 右边缘占半边，顶上占满，四个角占四分之一；中间留一道缝
  var GAP = 6;
  function tileRect(kind) {
    var a = area(), g = GAP, x0 = a.left + g, y0 = a.top + g, W = a.width - 2 * g, H = a.height - 2 * g, hw = (W - g) / 2, hh = (H - g) / 2;
    var R = {
      fill: { x: x0, y: y0, w: W, h: H }, left: { x: x0, y: y0, w: hw, h: H }, right: { x: x0 + hw + g, y: y0, w: hw, h: H },
      tl: { x: x0, y: y0, w: hw, h: hh }, tr: { x: x0 + hw + g, y: y0, w: hw, h: hh }, bl: { x: x0, y: y0 + hh + g, w: hw, h: hh }, br: { x: x0 + hw + g, y: y0 + hh + g, w: hw, h: hh },
    }[kind];
    return R ? { x: Math.round(R.x), y: Math.round(R.y), w: Math.round(R.w), h: Math.round(R.h) } : null;
  }
  function snapKind(px, py) {
    var a = area(), c = 70;
    if (px <= a.left + 6) return py <= a.top + c ? "tl" : py >= a.bottom - c ? "bl" : "left";
    if (px >= a.right - 6) return py <= a.top + c ? "tr" : py >= a.bottom - c ? "br" : "right";
    if (py <= a.top + 2) return "fill";
    return "";
  }
  function dragStart(f, e) {
    e.preventDefault();
    var h = cur.tw.panesEl, c = h.getBoundingClientRect(), r0 = Object.assign({}, f._r), x0 = e.clientX, y0 = e.clientY, moved = false, kind = "";
    var id = e.pointerId;
    try { f.setPointerCapture(id); } catch (err) { /* 不是真指针 */ }
    root.classList.add("mw-dragging");
    var move = function (ev) {
      var dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      if (!moved) {
        moved = true;
        // 平铺着 / 缩放着的窗口一拖：回到原来的大小，指针还在标题栏上差不多的位置
        if ((f._tile || f._zoomed) && f._prev) {
          var fx = (x0 - c.left - r0.x) / Math.max(1, r0.w), w = f._prev.w;
          r0 = { x: Math.round(x0 - c.left - fx * w), y: r0.y, w: w, h: f._prev.h };
          f._tile = ""; f._zoomed = false; f._prev = null;
        }
      }
      place(f, { x: r0.x + dx, y: Math.max(area().top, r0.y + dy), w: r0.w, h: r0.h });
      kind = snapKind(ev.clientX - c.left, ev.clientY - c.top);
      snapPreview(kind ? tileRect(kind) : null);
    };
    var up = function () {
      f.removeEventListener("pointermove", move);
      f.removeEventListener("pointerup", up);
      f.removeEventListener("pointercancel", up);
      root.classList.remove("mw-dragging");
      snapPreview(null);
      if (moved && kind) { f._prev = { x: r0.x, y: r0.y, w: r0.w, h: r0.h }; f._tile = kind; place(f, tileRect(kind)); }
      else if (moved) place(f, clampR(f._r));
      if (moved) { saveSoon(); if (f._p && f._p.renderNow) f._p.renderNow(); }
    };
    f.addEventListener("pointermove", move);
    f.addEventListener("pointerup", up);
    f.addEventListener("pointercancel", up);
  }
  function resizeStart(f, e) {
    e.preventDefault();
    e.stopPropagation();
    var ed = e.target.dataset.e, r0 = Object.assign({}, f._r), x0 = e.clientX, y0 = e.clientY, a = area();
    try { f.setPointerCapture(e.pointerId); } catch (err) { /* 不是真指针 */ }
    root.classList.add("mw-dragging");
    var move = function (ev) {
      var dx = ev.clientX - x0, dy = ev.clientY - y0, r = Object.assign({}, r0);
      if (/e/.test(ed)) r.w = Math.max(380, r0.w + dx);
      if (/s/.test(ed)) r.h = Math.max(240, r0.h + dy);
      if (/w/.test(ed)) { r.w = Math.max(380, r0.w - dx); r.x = r0.x + r0.w - r.w; }
      if (/n/.test(ed)) { r.h = Math.max(240, r0.h - dy); r.y = Math.max(a.top, r0.y + r0.h - r.h); r.h = r0.y + r0.h - r.y; }
      f._tile = ""; f._zoomed = false;
      place(f, r);
    };
    var up = function () {
      f.removeEventListener("pointermove", move);
      f.removeEventListener("pointerup", up);
      f.removeEventListener("pointercancel", up);
      root.classList.remove("mw-dragging");
      saveSoon();
    };
    f.addEventListener("pointermove", move);
    f.addEventListener("pointerup", up);
    f.addEventListener("pointercancel", up);
  }
  // 差不多占满了（拖大的、以前存下来的）也算「缩放着」
  var filled = function (f) { var t = tileRect("fill"), r = f._r; return !!(t && r) && Math.abs(r.x - t.x) < 10 && Math.abs(r.y - t.y) < 10 && Math.abs(r.w - t.w) < 16 && Math.abs(r.h - t.h) < 16; };
  // 双击标题栏 / 绿灯 / 「填充」：缩放着、平铺着（半边、四分之一）→ 还原成之前的大小（没有记下来的：App 默认的大小）；否则占满
  function zoom(f) {
    if (f._zoomed || f._tile || filled(f)) { var pr = f._prev || initialRect(f); f._zoomed = false; f._tile = ""; f._prev = null; place(f, clampR(pr)); }
    else { f._prev = Object.assign({}, f._r); f._zoomed = true; f._tile = ""; place(f, tileRect("fill")); }
    raise(f);
    saveSoon();
  }
  function tile(f, kind) { if (!f._tile && !f._zoomed) f._prev = Object.assign({}, f._r); f._tile = kind; f._zoomed = false; place(f, tileRect(kind)); raise(f); saveSoon(); }
  // 原生能截页面的一块（page.snapshot）：最小化前给窗口拍一张，程序坞里那一格就是它真实的样子（同 macOS）
  var pageSnap = false;
  if (window.nadosNative) nadosNative.call("info").then(function (i) { pageSnap = ((i && i.commands) || []).indexOf("page.snapshot") >= 0; }).catch(function () {});
  function snapFrame(f) {
    if (!pageSnap) return Promise.resolve();
    var r = f.getBoundingClientRect();
    if (!r.width || !r.height) return Promise.resolve();
    var shot = nadosNative.call("page.snapshot", { x: r.left, y: r.top, w: r.width, h: r.height, width: 200 }).then(function (u) { if (typeof u === "string" && u) f._thumb = u; }, function () {});
    return Promise.race([shot, new Promise(function (res) { setTimeout(res, 300); })]); // 慢了就不等（缩略图晚一点换上）
  }
  function minimize(f) {
    if (f.classList.contains("mw-min") || f._going) return;
    f._going = true;
    snapFrame(f).then(function () { f._going = false; if (!f.classList.contains("mw-min")) minimizeNow(f); });
  }
  function minimizeNow(f) {
    // 缩向程序坞里它那个 App 的图标（先量好，再收起来）
    var icon = dock && dock.querySelector('[data-app="' + f._app + '"]'), fr = f.getBoundingClientRect(), ir = icon ? icon.getBoundingClientRect() : null;
    if (ir) f.style.transformOrigin = (ir.left + ir.width / 2 - fr.left) + "px " + (ir.top - fr.top) + "px";
    f.classList.add("mw-going");
    setTimeout(function () {
      f.classList.remove("mw-going");
      f.classList.add("mw-min");
      f.style.transformOrigin = "";
      var next = topFrame(f);
      if (next) focusFrame(next, true);
      syncDock();
      saveSoon();
    }, 260);
  }
  function unminimize(f) {
    f.classList.remove("mw-min");
    focusFrame(f, true);
    syncDock();
    saveSoon();
  }
  function closeFrame(f) {
    var p = f._p, ws = cur.ws;
    if (!p || !ws) return;
    var go = function () { ws.closePane(p); };
    if (T() && T().askClose) T().askClose([p], tr("窗口", "window"), go); else go();
  }
  // 标题栏右键：同 macOS 窗口的几个操作
  function frameMenu(f, e) {
    var M = S() && S().menu;
    if (!M) return;
    M([
      { label: tr("最小化", "Minimize"), keys: "⌘M", run: function () { minimize(f); } },
      { label: f._zoomed || f._tile || filled(f) ? tr("还原", "Restore") : tr("填充", "Fill"), run: function () { zoom(f); } },
      { sep: true },
      { label: tr("左半边", "Left Half"), run: function () { tile(f, "left"); } },
      { label: tr("右半边", "Right Half"), run: function () { tile(f, "right"); } },
      { label: tr("居中", "Center"), run: function () { var r = initialRect(f); f._tile = ""; f._zoomed = false; place(f, { x: area().left + (area().width - f._r.w) / 2, y: r.y, w: f._r.w, h: f._r.h }); saveSoon(); } },
      { sep: true },
      { label: tr("关闭", "Close"), keys: "⌘W", run: function () { closeFrame(f); } },
    ], { x: e.clientX, y: e.clientY });
  }

  // ---- 标题栏里放什么：普通的窗口是居中的标题（图标 + 名字）和右边这一页的按钮；
  //      访达、设置是统一工具栏（红黄绿落在侧边栏上，访达多一个「文件 | Agent」）；浏览器是前进后退和地址栏 ----
  function iconFor(p) {
    var tmp = document.createElement("div");
    tmp.innerHTML = "<span></span>";
    try { if (window.TSU_BROWSER && TSU_BROWSER.fav) TSU_BROWSER.fav(tmp, p); } catch (e) { /* 没有图标 */ }
    var ic = tmp.querySelector(".st-ico");
    return ic ? ic.outerHTML : "";
  }
  function updateBar(f) {
    var p = f._p;
    if (!p || !p.program) return;
    var app = appOf(p), uni = !!(APPS[app] && APPS[app].uni), title = "";
    try { title = p.title(); } catch (e) { title = ""; }
    if (f._app !== app) { f._app = app; f.dataset.app = app; }
    f.classList.toggle("mw-uni", uni);
    f.classList.toggle("mw-web", app === "st-browser");
    var lead = "", tools = "";
    var acts = [];
    try { acts = p.program.tabActions ? p.program.tabActions() || [] : []; } catch (e) { acts = []; }
    f._acts = acts;
    if (app === "st-finder") {
      lead = ""; // 「文件 | Agent」在访达侧边栏的左下角（dash.js），标题栏上只有红黄绿
    } else if (app === "st-browser") {
      var u = (p.program.arg || "");
      lead = acts.slice(0, 3).map(function (x, i) { return '<button class="mw-tb" data-x="' + i + '" title="' + esc(x.title) + '">' + x.icon + "</button>"; }).join("");
      tools = acts.slice(3).map(function (x, i) { return '<button class="mw-tb" data-x="' + (i + 3) + '" title="' + esc(x.title) + '">' + x.icon + "</button>"; }).join("");
      f._url = u;
    } else if (!uni) {
      tools = acts.map(function (x, i) { return '<button class="mw-tb" data-x="' + i + '" title="' + esc(x.title) + '">' + x.icon + "</button>"; }).join("");
    }
    var sig = [app, title, lead, tools].join("\u0001");
    if (f._sig === sig) return;
    f._sig = sig;
    var bar = f.querySelector(".mw-bar");
    bar.querySelector(".mw-lead").innerHTML = lead;
    bar.querySelector(".mw-tools").innerHTML = tools;
    var t = bar.querySelector(".mw-title");
    if (app === "st-browser") {
      if (!t.querySelector("input")) {
        t.innerHTML = '<input class="mw-url" spellcheck="false" autocomplete="off">';
        var inp = t.querySelector("input");
        inp.addEventListener("keydown", function (e) {
          if (e.key === "Enter") { e.preventDefault(); var v = inp.value.trim(); if (v && f._p && f._p.program && f._p.program.open) f._p.program.open(v); inp.blur(); }
          else if (e.key === "Escape") { inp.value = f._url || ""; inp.blur(); }
          e.stopPropagation();
        });
        inp.addEventListener("focus", function () { inp.select(); });
      }
      var inp2 = t.querySelector("input");
      if (document.activeElement !== inp2) inp2.value = f._url || "";
      inp2.placeholder = tr("搜索或输入网站名称", "Search or enter website name");
    } else {
      t.innerHTML = '<span class="mw-ico">' + iconFor(p) + '</span><span class="mw-t"></span>';
      t.querySelector(".mw-t").textContent = title;
    }
    f.title = "";
  }
  function barClicks(f) {
    f.querySelector(".mw-bar").addEventListener("click", function (e) {
      var b = e.target.closest("[data-x]");
      if (!b) return;
      e.stopPropagation();
      var x = f._acts && f._acts[+b.dataset.x];
      if (x && x.run) { x.run(); setTimeout(function () { f._sig = ""; updateBar(f); }, 60); }
    });
  }

  // ======== 排版：live.js 的 ws.layout 在 macOS 风格下交给这里 ========
  function layout(tw, ws) {
    if (!tw || tw.el.id !== "win") return plainLayout(tw, ws);
    setup();
    cur.tw = tw; cur.ws = ws;
    var h = tw.panesEl, panes = ws.all();
    // 平铺时留下的（网格、编辑区空着时的标志）先拿掉；每个标签页一个窗口
    Array.prototype.slice.call(h.children).forEach(function (c) { if (!c.classList.contains("mw") && c !== snapEl) c.remove(); });
    panes.forEach(function (p) {
      var f = frameFor(p), fresh = !f.isConnected;
      if (!f._bound) { f._bound = true; barClicks(f); }
      updateBar(f);
      if (fresh) {
        h.appendChild(f);
        // 新开的窗口：从中间长出来一点（同 macOS）；刚打开 App 时恢复的那一批不动
        if (laidOut && !f._r) { f.classList.add("mw-opening"); setTimeout(function () { f.classList.remove("mw-opening"); }, 260); }
        if (!f._r) {
          var saved = RECTS[keyOf(p)];
          if (saved) {
            place(f, clampR(saved));
            if (saved.tile && tileRect(saved.tile)) { f._tile = saved.tile; f._prev = saved.prev || null; place(f, tileRect(saved.tile)); }
            else if (saved.zoom) { f._zoomed = true; f._prev = saved.prev || null; }
            if (saved.min) f.classList.add("mw-min");
          }
          else place(f, initialRect(f));
          ZMAX += 1; f.style.zIndex = ZMAX;
        }
      }
      var body = f.querySelector(".mw-body");
      if (p.el.parentNode !== body) { body.textContent = ""; body.appendChild(p.el); if (p.renderNow) setTimeout(function () { p.renderNow(); }, 0); }
      p.el.classList.add("solo");
      p.el.classList.toggle("active", p === ws.active);
    });
    // 关掉的窗口：淡出、缩一点再拿掉
    frameList().forEach(function (f) { if (panes.indexOf(f._p) < 0) { if (f._p) f._p._mw = null; f._p = null; f.classList.add("mw-closing"); setTimeout(function () { f.remove(); }, 170); } });
    laidOut = true;
    // 当前那个（键盘、⌘1… 选到的）到最前；最小化着的先放出来
    var af = ws.active && ws.active._mw;
    if (af) { if (af.classList.contains("mw-min")) af.classList.remove("mw-min"); if (!af.classList.contains("mw-key") || +af.style.zIndex !== ZMAX) raise(af); }
    else frameList().forEach(function (x) { x.classList.remove("mw-key"); });
    syncDock();
    saveSoon();
  }
  // 不是 App 的那个窗口（网页里另开的终端窗口）：照原样平铺——交回 live.js 自己（它只在 on() 时才问这里）
  function plainLayout() { /* 网页桌面里另开的终端窗口：macOS 风格只管 App 的主窗口 */ }

  // ======== 程序坞：访达、Agent IDE、设置、浏览器、应用程序（启动台）；开着窗口的 App 下面一个点；最小化的窗口在右边 ========
  var didSetup = false;
  function setup() {
    if (didSetup) return;
    didSetup = true;
    var ide = dock && dock.querySelector('[data-app="win"]');
    if (ide) { ide.title = nameOf("win"); ide.innerHTML = ICON.ide; }
    [["st-finder", ICON.finder], ["st-global", ICON.global], ["st-settings", ICON.settings], ["st-browser", ICON.browser]].forEach(function (x, i) {
      if (x[0] === "st-global" && !window.TSU_GLOBAL) return; // 全局助手（globalagent.js）
      if (dock.querySelector('[data-app="' + x[0] + '"]')) return;
      var a = D.addDockApp({ app: x[0], title: nameOf(x[0]), icon: "", onOpen: function () { launch(x[0]); } });
      if (a) a.innerHTML = x[1];
      if (a && x[0] === "st-finder" && ide) ide.before(a); // 访达在最前（同 macOS）
      if (a && x[0] === "st-global" && ide) ide.after(a); // 全局助手紧跟在 Agent 后面
    });
    APP_IDS.forEach(function (id) { D.registerApp({ id: id, name: nameOf(id), icon: APPS[id].icon, category: APPS[id].cat, open: function () { launch(id); } }); });
    // 应用程序（启动台）排在这几个 App 后面
    var lpI = dock.querySelector('[data-app="launchpad"]'), mcI = dock.querySelector('[data-app="missioncontrol"]'), tail = dock.querySelector(":scope > .dock-extra");
    if (lpI) dock.insertBefore(lpI, tail);
    if (mcI) dock.insertBefore(mcI, tail);
    D.registerApp({ id: "launchpad", name: tr("应用程序", "Apps") });
    D.registerApp({ id: "settings", name: tr("桌面与程序坞", "Desktop & Dock"), hidden: true }); // 模拟器的那个设置窗口不是 App（Studio 的设置是「设置」）
    D.registerApp({ id: "missioncontrol", name: tr("调度中心", "Mission Control") });
    widgets();
    addKeys();
    applyLook(true);
  }
  var WALLS = ["pub-sunset", "pub-emerald", "graphite", "black"]; // 墙纸（设置里「墙纸」）：两张照片、石墨、纯黑
  var getS = function (k, d) { var st = S(); var v = st && st.get ? st.get(k) : undefined; return v === undefined || v === null ? d : v; };
  var lastLook = "";
  function applyLook(force) {
    if (!on()) return;
    var o = { dockPosition: ["left", "bottom", "right"].indexOf(getS("macDock", "bottom")) >= 0 ? getS("macDock", "bottom") : "bottom",
      dockSize: Math.max(32, Math.min(80, +getS("macDockSize", 52) || 52)), dockMagnify: getS("macMagnify", true) === false ? 0 : 0.6, dockAutohide: !!getS("macAutoHide", false) };
    var wg = getS("macWidgets", true) !== false, sig = JSON.stringify(o) + wg + getS("macWall", "");
    if (!force && sig === lastLook) return;
    lastLook = sig;
    if (D.dockOverride) D.dockOverride(o);
    if (wbox) wbox.hidden = !wg;
    root.dataset.macWall = WALLS.indexOf(getS("macWall", "pub-sunset")) >= 0 ? getS("macWall", "pub-sunset") : "pub-sunset";
    setTimeout(function () { frameList().forEach(function (f) { if (f._tile) place(f, tileRect(f._tile)); else if (f._zoomed) place(f, tileRect("fill")); }); }, 60); // 程序坞挪了：平铺、缩放着的窗口跟着
  }
  document.addEventListener("st-settings-changed", function () { applyLook(); });
  function syncDock() {
    if (!dock || !on()) return;
    APP_IDS.forEach(function (id) { var a = dock.querySelector('[data-app="' + id + '"]'); if (a) a.classList.toggle("running", framesOf(id).length > 0); });
    // 最小化的窗口：程序坞右边一格一个（分隔线后面，废纸篓前面）
    dock.querySelectorAll(":scope > .mac-min, :scope > .mac-sep").forEach(function (x) { x.remove(); });
    var mins = frameList().filter(function (f) { return f.classList.contains("mw-min"); });
    if (!mins.length) return;
    var before = dock.querySelector(":scope > .dock-extra");
    var sep = document.createElement("i");
    sep.className = "dock-sep mac-sep";
    dock.insertBefore(sep, before);
    mins.forEach(function (f) {
      var a = document.createElement("a");
      a.className = "app mac-min min-tile";
      a.title = (f._p && f._p.title ? f._p.title() : "") || nameOf(f._app);
      // 拍到了：窗口真实的样子（按比例放进这一格）；没拍到（浏览器里、老版本的 App）：画一个小窗口，颜色跟着这个窗口
      var body = f._thumb ? '<img src="' + f._thumb + '" alt="">' : '<i style="--mt-bg:' + esc(getComputedStyle(f).backgroundColor) + '"></i>';
      a.innerHTML = '<span class="ico mt-win' + (f._thumb ? " mt-shot" : "") + '">' + body + '</span><span class="ibox mt-badge" style="--s:0.44">' + (APPS[f._app] || APPS.win).icon + "</span>";
      a.addEventListener("click", function (e) { e.stopPropagation(); e.preventDefault(); unminimize(f); }, true);
      dock.insertBefore(a, before);
    });
  }
  // 开一个 App（程序坞、启动台）：有窗口就把它的窗口都提到前面（全最小化了就放出最近那个）；没有就开一个
  function launch(id) {
    if (!on()) return false;
    var tw = mainTw();
    if (!tw) return false;
    if (id === "missioncontrol") { missionControl(); return true; }
    if (!APPS[id]) return false;
    var fs = framesOf(id), shown = fs.filter(function (f) { return !f.classList.contains("mw-min"); });
    if (shown.length) { shown.sort(function (a, b) { return (+a.style.zIndex || 0) - (+b.style.zIndex || 0); }).forEach(function (f) { raise(f); }); focusFrame(shown[shown.length - 1], true); return true; }
    if (fs.length) { unminimize(fs[fs.length - 1]); return true; }
    var st = S();
    // Agent 一个窗口都没有：开最近用过的那个 agent（同终端 App 没有窗口时点它开一个）；一个 agent 都没有就新建一个
    if (id === "win") { var A = window.TSU_AGENTS, a = A && A.list ? A.list().filter(function (x) { return !x.archived; })[0] : null; if (!a && A && A.create) a = A.create({}); if (a && T() && T().agent) T().agent(a.id); }
    else if (id === "st-finder") { if (st && st.openPage) st.openPage(tw, "explorer", ""); }
    else if (id === "st-settings") { if (st && st.openPage) st.openPage(tw, "settings", null); }
    else if (id === "st-browser") { if (window.TSU_WEB) TSU_WEB.open(tw, ""); }
    else if (id === "st-global") { if (window.TSU_GLOBAL) TSU_GLOBAL.ensure().then(function (a) { if (a && T() && T().agent) T().agent(a.id); }); } // 全局助手：开它的窗口（它不在 agent 列表里）
    return true;
  }
  // 菜单栏上的 App 名：最前面那个窗口的 App
  function appNameNow() {
    var f = frameList().filter(function (x) { return x.classList.contains("mw-key") && !x.classList.contains("mw-min"); })[0];
    return f ? nameOf(f._app) : nameOf("st-finder");
  }
  var keyFrame = function () { return frameList().filter(function (x) { return x.classList.contains("mw-key") && !x.classList.contains("mw-min"); })[0] || null; };
  // ✻ 菜单（系统菜单）
  // ✻ 菜单（同 macOS 的苹果菜单）：只有关于本机、两种风格、重新启动、退出登录
  function about() {
    var show = function (i) {
      var v = i && i.version ? i.version : "";
      if (D.alert) D.alert({ title: tr("关于本机", "About This Mac"), message: "Vibing Studio" + (v ? " " + v : "") + (i && i.os ? "\nmacOS " + i.os + (i.arch ? " · " + i.arch : "") : "") + "\n© 2026 Vibing Studio", icon: "app", buttons: [{ label: tr("好", "OK"), role: "default" }] });
    };
    if (window.nadosNative) nadosNative.call("info").then(show, function () { show(null); }); else show(null);
  }
  function systemMenu() {
    return [
      { label: tr("关于本机", "About This Mac"), run: about },
      { sep: true },
      { label: tr("应用风格", "Application Style"), items: function () { return osModes().map(function (x, i) { return { label: x[1], keys: i < 9 ? "⌃⌘" + (i + 1) : "", checked: (getS("os", "vscode") || "vscode") === x[0], run: function () { var st = S(); if (st && st.setv) st.setv("os", x[0]); } }; }); } },
      { label: tr("Agent 显示风格", "Agent View Style"), items: function () { return [["tui", "TUI"], ["gui", "GUI"]].map(function (x) { return { label: x[1], checked: getS("ui", "tui") === x[0], run: function () { var st = S(); if (st && st.setv) st.setv("ui", x[0]); } }; }); } },
      { sep: true },
      { label: tr("重新启动…", "Restart…"), run: function () { location.reload(); } },
      { label: tr("退出登录…", "Log Out…"), run: function () { location.href = "/auth/logout"; } },
    ];
  }
  var osModes = function () { var st = S(); return (st && st.osModes) || [["vscode", "Visual Studio Code"], ["claude", "Claude App"], ["macos", "macOS"], ["terminal", "Pure Terminal"]]; };
  // App 名那一栏的菜单
  function appMenu() {
    var f = keyFrame(), app = f ? f._app : "st-finder", name = nameOf(app);
    return [
      { label: tr("关于 ", "About ") + name, run: function () { if (D.alert) D.alert({ title: name, message: "Vibing Studio", icon: "app", buttons: [{ label: tr("好", "OK"), role: "default" }] }); } },
      { sep: true },
      { label: tr("设置…", "Settings…"), keys: "⌘,", run: function () { launch("st-settings"); } },
      { label: tr("应用风格", "Application Style"), items: function () { return osModes().map(function (x, i) { return { label: x[1], keys: i < 9 ? "⌃⌘" + (i + 1) : "", checked: (getS("os", "vscode") || "vscode") === x[0], run: function () { var st = S(); if (st && st.setv) st.setv("os", x[0]); } }; }); } },
      { sep: true },
      { label: tr("隐藏 ", "Hide ") + name, keys: "⌘H", run: function () { framesOf(app).forEach(minimize); }, disabled: !framesOf(app).length },
      { label: tr("隐藏其他", "Hide Others"), keys: "⌥⌘H", run: function () { frameList().forEach(function (x) { if (x._app !== app) minimize(x); }); } },
      { sep: true },
      { label: tr("退出 ", "Quit ") + name, keys: "⌘Q", disabled: !framesOf(app).length, run: function () {
        var ps = framesOf(app).map(function (x) { return x._p; }).filter(Boolean), ws = cur.ws;
        if (!ws || !ps.length) return;
        var go = function () { ps.forEach(function (p) { ws.closePane(p); }); };
        if (T() && T().askClose) T().askClose(ps, tr("窗口", "window"), go); else go();
      } },
    ];
  }
  // 「窗口」菜单
  function windowMenu() {
    var f = keyFrame(), list = frameList().slice().sort(function (a, b) { return (+a.style.zIndex || 0) - (+b.style.zIndex || 0); });
    var items = [
      { label: tr("最小化", "Minimize"), keys: "⌘M", disabled: !f, run: function () { if (f) minimize(f); } },
      { label: tr("缩放", "Zoom"), disabled: !f, run: function () { if (f) zoom(f); } },
      { sep: true },
      { label: tr("左半边", "Left Half"), disabled: !f, run: function () { if (f) tile(f, "left"); } },
      { label: tr("右半边", "Right Half"), disabled: !f, run: function () { if (f) tile(f, "right"); } },
      { label: tr("填充", "Fill"), disabled: !f, run: function () { if (f) tile(f, "fill"); } },
      { sep: true },
      { label: tr("前置全部窗口", "Bring All to Front"), run: function () { list.forEach(function (x) { if (!x.classList.contains("mw-min")) raise(x); }); if (f) raise(f); } },
    ];
    if (list.length) items.push({ sep: true });
    list.forEach(function (x) { items.push({ label: (x._p && x._p.title ? x._p.title() : "") || nameOf(x._app), checked: x === f, run: function () { if (x.classList.contains("mw-min")) unminimize(x); else focusFrame(x, true); } }); });
    return items;
  }

  // ======== 桌面小组件：时钟、Agent、余额（拖动摆放，记住位置）========
  var WPOS = LS.get("st-mac-widgets", {});
  var wbox = null;
  function widgets() {
    if (wbox) return;
    wbox = document.createElement("div");
    wbox.id = "mac-widgets";
    var wins = document.getElementById("wins");
    desk.insertBefore(wbox, wins || desk.firstChild);
    wbox.innerHTML = '<div class="mwg" data-w="clock"><div class="mwg-time"></div><div class="mwg-date"></div></div>' +
      '<div class="mwg mwg-list" data-w="agents"><div class="mwg-h"></div><div class="mwg-rows"></div></div>' +
      '<div class="mwg" data-w="balance"><div class="mwg-h"></div><div class="mwg-big"></div><div class="mwg-sub"></div></div>';
    Array.prototype.forEach.call(wbox.querySelectorAll(".mwg"), function (w, i) {
      var p = WPOS[w.dataset.w];
      if (p) { w.style.left = p.x + "px"; w.style.top = p.y + "px"; } else { w.style.right = "24px"; w.style.top = (48 + i * 186) + "px"; }
      w.addEventListener("pointerdown", function (e) {
        if (e.button !== 0 || e.target.closest(".mwg-row")) return;
        e.preventDefault();
        var r = w.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY, moved = false;
        try { w.setPointerCapture(e.pointerId); } catch (err) { /* 不是真指针 */ }
        var move = function (ev) {
          var dx = ev.clientX - x0, dy = ev.clientY - y0;
          if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
          moved = true;
          w.style.right = "";
          w.style.left = Math.max(0, Math.min(innerWidth - r.width, r.left + dx)) + "px";
          w.style.top = Math.max(34, Math.min(innerHeight - r.height, r.top + dy)) + "px";
        };
        var up = function () {
          w.removeEventListener("pointermove", move); w.removeEventListener("pointerup", up); w.removeEventListener("pointercancel", up);
          if (moved) { WPOS[w.dataset.w] = { x: parseInt(w.style.left, 10) || 0, y: parseInt(w.style.top, 10) || 0 }; LS.set("st-mac-widgets", WPOS); }
        };
        w.addEventListener("pointermove", move); w.addEventListener("pointerup", up); w.addEventListener("pointercancel", up);
      });
    });
    wbox.addEventListener("click", function (e) {
      var r = e.target.closest(".mwg-row");
      if (!r || !r.dataset.agent || !T() || !T().agent) return;
      var tw = mainTw(), have = null;
      if (tw) tw.ws.all().forEach(function (p) { if (!have && p.program && p.program.agentId === r.dataset.agent) have = p; });
      if (have) { tw.ws.show(have); if (have._mw) { if (have._mw.classList.contains("mw-min")) unminimize(have._mw); else raise(have._mw); } }
      else T().agent(r.dataset.agent);
    });
    paintWidgets();
    setInterval(function () { if (on()) paintWidgets(); }, 1000);
    // 窗口变小了：摆过的小组件别跑到屏幕外面去（只挪显示的位置，记住的位置不改——窗口再变大就回去）
    var fit = function () {
      if (!on()) return;
      Array.prototype.forEach.call(wbox.querySelectorAll(".mwg"), function (w) {
        var p = WPOS[w.dataset.w];
        if (!p || w.hidden) return;
        w.style.left = Math.max(8, Math.min(innerWidth - w.offsetWidth - 8, p.x)) + "px";
        w.style.top = Math.max(40, Math.min(innerHeight - w.offsetHeight - 8, p.y)) + "px";
      });
    };
    window.addEventListener("resize", fit);
    fit();
  }
  var WEEK = ["日", "一", "二", "三", "四", "五", "六"], lastAgents = "";
  function paintWidgets() {
    if (!wbox) return;
    var d = new Date(), two = function (n) { return String(n).padStart(2, "0"); };
    wbox.querySelector(".mwg-time").textContent = two(d.getHours()) + ":" + two(d.getMinutes());
    wbox.querySelector(".mwg-date").textContent = en() ? d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : (d.getMonth() + 1) + "月" + d.getDate() + "日 星期" + WEEK[d.getDay()];
    // Agent：在跑的在前
    var A = window.TSU_AGENTS, rows = [];
    if (A && A.list) {
      A.list().forEach(function (a) {
        var st = "idle";
        try { var rt = A.runtime(a.id), s = rt.state ? rt.state() : ""; st = s === "working" || (rt.tasks || []).some(function (t) { return t.status === "running"; }) ? "working" : "idle"; } catch (e) { st = "idle"; }
        if (a.archived) return;
        rows.push({ id: a.id, name: a.name || a.id, st: st });
      });
    }
    rows.sort(function (x, y) { return (x.st === "working" ? 0 : 1) - (y.st === "working" ? 0 : 1); });
    var sig = JSON.stringify(rows.slice(0, 6)) + en();
    if (sig !== lastAgents) {
      lastAgents = sig;
      var live = rows.filter(function (x) { return x.st === "working"; }).length;
      wbox.querySelector('[data-w="agents"] .mwg-h').textContent = "Agent" + (live ? " · " + live + tr(" 个在运行", " running") : "");
      wbox.querySelector('[data-w="agents"] .mwg-rows').innerHTML = rows.slice(0, 6).map(function (x) {
        return '<div class="mwg-row" data-agent="' + esc(x.id) + '"><i class="mwg-dot ' + x.st + '"></i><span>' + esc(x.name) + '</span><em>' + (x.st === "working" ? tr("运行中", "Running") : tr("空闲", "Idle")) + "</em></div>";
      }).join("") || '<div class="mwg-sub">' + esc(tr("还没有 Agent", "No agents yet")) + "</div>";
    }
    var me = A && A.me ? A.me() : null, bal = me && me.balance != null ? me.balance : null, bw = wbox.querySelector('[data-w="balance"]');
    bw.hidden = bal == null;
    if (bal != null) {
      bw.querySelector(".mwg-h").textContent = tr("余额", "Balance");
      var y = (+bal || 0) / 1e6; // 账上记的是「微元」（百万分之一元）
      bw.querySelector(".mwg-big").textContent = (y < 0 ? "-¥" : "¥") + Math.abs(y).toFixed(2);
      bw.classList.toggle("neg", y < 0);
      bw.querySelector(".mwg-sub").textContent = me.login ? me.login : "";
    }
  }

  // ======== 键盘：⌥空格 应用程序（Spotlight）、⌘M 最小化、⌘` 在窗口间切换 ========
  var didKeys = false;
  function addKeys() {
    if (didKeys) return;
    didKeys = true;
    window.addEventListener("keydown", function (e) {
      if (!on()) return;
      // 调度中心：⌃↑、F3（⇧⌘\「标签页概览」也是它）；开着时 Esc 回去
      if (MC && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); mcExit(null); return; }
      if ((e.ctrlKey && !e.metaKey && !e.altKey && e.key === "ArrowUp") || e.key === "F3") { e.preventDefault(); e.stopPropagation(); missionControl(); return; } // ⇧⌘\ 由 browser.js 的「标签页概览」转过来
      if (MC) { e.preventDefault(); e.stopPropagation(); return; } // 开着调度中心时别的键不给窗口
      if ((e.altKey || e.metaKey) && !e.shiftKey && !e.ctrlKey && (e.code === "Space") && (e.altKey !== e.metaKey)) { e.preventDefault(); e.stopPropagation(); if (D.launchpad) D.launchpad(); return; }
      if (e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === "m" || e.key === "M")) { var f = keyFrame(); if (f) { e.preventDefault(); e.stopPropagation(); minimize(f); } return; }
      if (e.metaKey && !e.altKey && !e.ctrlKey && e.key === "`") {
        var list = frameList().filter(function (x) { return !x.classList.contains("mw-min"); }).sort(function (a, b) { return (+b.style.zIndex || 0) - (+a.style.zIndex || 0); });
        if (list.length > 1) { e.preventDefault(); e.stopPropagation(); focusFrame(e.shiftKey ? list[list.length - 1] : list[1], true); }
      }
    }, true);
  }

  // ======== 设置那种「浮在编辑区正中」的浮动页：macOS 风格里直接变成一个窗口 ========
  new MutationObserver(function (ms) {
    if (!on()) return;
    ms.forEach(function (m) {
      Array.prototype.forEach.call(m.addedNodes, function (n) {
        if (n.nodeType !== 1 || !n.classList.contains("st-float")) return;
        setTimeout(function () { var b = n.querySelector('[data-f="dock"]'); if (b && n.isConnected) b.click(); }, 0);
      });
    });
  }).observe(document.getElementById("win") || document.body, { childList: true, subtree: true });

  // ======== 调度中心（同 macOS）：是窗口，不是标签页——每个窗口保持自己的大小比例（大家同一个缩放），大致留在原来的方位、互不重叠；
  //   同一个 App 的几个窗口叠成一摞（设置里可关），下面是 App 图标和名字。动的是真的窗口（transform），内容是活的；
  //   指着一个窗口：蓝框；点它：回去并把它放到最前；点空白、Esc、再按一次 ⌃↑：原样回去。内嵌网页（原生那块）先藏起来，换成截图 ========
  var MC = null;
  var canWebSnap = false;
  if (window.nadosNative) nadosNative.call("info").then(function (i) { canWebSnap = ((i && i.commands) || []).indexOf("web.snapshot") >= 0; }).catch(function () {});
  function mcLayout(fs) {
    var group = getS("macGroupWindows", true) !== false, piles = [], by = {}, O = 22;
    fs.slice().sort(function (a, b) { return (+b.style.zIndex || 0) - (+a.style.zIndex || 0); }).forEach(function (f) { // 前面的窗口在一摞的最前
      var k = group ? f._app : "w" + piles.length, p = by[k];
      if (!p) { p = by[k] = { app: f._app, wins: [] }; piles.push(p); }
      p.wins.push(f);
    });
    piles.forEach(function (p) {
      var w = 0, h = 0, cx = 0, cy = 0, n = p.wins.length - 1;
      p.wins.forEach(function (f) { w = Math.max(w, f._r.w); h = Math.max(h, f._r.h); cx += f._r.x + f._r.w / 2; cy += f._r.y + f._r.h / 2; });
      p.w = w + n * O; p.h = h + n * O; p.cx = cx / p.wins.length; p.cy = cy / p.wins.length;
    });
    var A = area(), L = { x: A.left + 40, y: A.top + 56, w: A.width - 80, h: A.height - 56 - 26 }, GAP = 34, LAB = 34;
    // 按缩放 s 排成几行：先按原来的上下分行，行里按原来的左右
    var rows = function (s) {
      var out = [], row = null;
      piles.slice().sort(function (a, b) { return a.cy - b.cy || a.cx - b.cx; }).forEach(function (p) {
        var w = p.w * s;
        if (!row || row.items.length && row.w + GAP + w > L.w) { row = { items: [], w: 0, h: 0 }; out.push(row); }
        row.w += (row.items.length ? GAP : 0) + w;
        row.items.push(p);
        row.h = Math.max(row.h, p.h * s + LAB);
      });
      out.forEach(function (r) { r.items.sort(function (a, b) { return a.cx - b.cx; }); });
      out.H = out.reduce(function (t, r) { return t + r.h; }, 0) + GAP * Math.max(0, out.length - 1);
      return out;
    };
    // 同一个缩放：放得下的最大的那个（不放大；一个窗口时也小一点，看得出是在调度中心）
    var lo = 0.04, hi = 0.82;
    for (var it = 0; it < 20; it++) {
      var mid = (lo + hi) / 2, rr = rows(mid);
      if (rr.H <= L.h && piles.every(function (p) { return p.w * mid <= L.w; })) lo = mid; else hi = mid;
    }
    var s = lo, R = rows(s), y = L.y + Math.max(0, (L.h - R.H) / 2), out = [];
    R.forEach(function (r) {
      var x = L.x + (L.w - r.w) / 2;
      r.items.forEach(function (p) {
        var pw = p.w * s, ph = p.h * s, py = y + (r.h - LAB - ph) / 2, n = p.wins.length - 1;
        p.box = { x: x, y: py, w: pw, h: ph };
        // 一摞：最前的在左下，后面的依次往右上错开
        p.wins.forEach(function (f, k) { out.push({ f: f, x: x + k * O * s, y: py + (n - k) * O * s, s: s, z: 1000 + (n - k) }); });
        x += pw + GAP;
      });
      y += r.h + GAP;
    });
    return { piles: piles, wins: out, s: s };
  }
  function missionControl() {
    if (!on()) return false;
    if (MC) { mcExit(null); return true; }
    var h = cur.tw && cur.tw.panesEl;
    if (!h) return false;
    if (D.launchpadOpen && D.launchpadOpen()) return false;
    var fs = frameList().filter(function (f) { return !f.classList.contains("mw-min") && f._r && f.offsetParent; });
    MC = { h: h, fs: fs, shots: [] };
    // 内嵌网页：趁原生那块还看得见，先各拍一张（最多等 300ms）
    var webs = fs.filter(function (f) { return canWebSnap && f._p && f._p.program && f._p.program.page === "web" && f._p.program.id; });
    var snaps = webs.map(function (f) {
      var V = f._p.program;
      return Promise.race([nadosNative.call("web.snapshot", { id: V.id, width: 900 }).then(function (u) { return { f: f, u: u }; }, function () { return null; }), new Promise(function (res) { setTimeout(function () { res(null); }, 300); })]);
    });
    Promise.all(snaps).then(function (list) { if (MC && MC.fs === fs) mcEnter(list.filter(function (x) { return x && typeof x.u === "string" && x.u; })); });
    return true;
  }
  function mcEnter(shots) {
    var h = MC.h, lay = mcLayout(MC.fs);
    MC.lay = lay;
    shots.forEach(function (x) { var box = x.f.querySelector(".wb-box"); if (!box) return; var img = document.createElement("img"); img.className = "mc-shot"; img.alt = ""; img.src = x.u; box.appendChild(img); MC.shots.push(img); });
    var dim = document.createElement("div");
    dim.className = "mc-dim";
    h.appendChild(dim);
    var labs = document.createElement("div");
    labs.className = "mc-labels";
    labs.innerHTML = '<div class="mc-spaces"><span class="mc-sp on">' + esc(tr("桌面", "Desktop")) + "</span></div>" + lay.piles.map(function (p, i) {
      var one = p.wins.length === 1, t = one ? ((p.wins[0]._p && p.wins[0]._p.title ? p.wins[0]._p.title() : "") || nameOf(p.app)) : nameOf(p.app) + " · " + p.wins.length;
      return '<div class="mc-lab" data-p="' + i + '" style="left:' + (p.box.x + p.box.w / 2).toFixed(1) + "px;top:" + (p.box.y + p.box.h + 10).toFixed(1) + 'px"><span class="ibox" style="--s:0.4">' + (APPS[p.app] || APPS.win).icon + '</span><span class="mc-t">' + esc(t) + "</span></div>";
    }).join("");
    h.appendChild(labs);
    MC.dim = dim; MC.labs = labs;
    lay.wins.forEach(function (w) {
      var f = w.f, r = f._r;
      f._mcZ = f.style.zIndex;
      f.style.setProperty("--mcs", w.s);
      f.style.transformOrigin = "0 0";
      f.style.transition = "transform 0.4s cubic-bezier(0.2, 0.85, 0.25, 1)";
      f.style.zIndex = w.z;
    });
    void h.offsetWidth;
    root.classList.add("mc-on");
    lay.wins.forEach(function (w) { var r = w.f._r; w.f.style.transform = "translate(" + (w.x - r.x).toFixed(1) + "px," + (w.y - r.y).toFixed(1) + "px) scale(" + w.s.toFixed(4) + ")"; });
    MC.down = function (e) {
      if (!MC) return;
      var f = e.target.closest && e.target.closest(".mw");
      if (e.target.closest && e.target.closest("#dock, #menubar")) { mcExit(null); return; } // 程序坞、菜单栏：回去，点的照常生效
      e.preventDefault(); e.stopPropagation();
      var swallow = function (ev) { ev.preventDefault(); ev.stopPropagation(); window.removeEventListener("click", swallow, true); };
      window.addEventListener("click", swallow, true);
      setTimeout(function () { window.removeEventListener("click", swallow, true); }, 400);
      mcExit(f && MC.fs.indexOf(f) >= 0 ? f : null);
    };
    MC.over = function (e) {
      var f = e.target.closest && e.target.closest(".mw"), p = -1;
      MC.fs.forEach(function (x) { x.classList.toggle("mc-hot", x === f); });
      if (f) MC.lay.piles.forEach(function (q, i) { if (q.wins.indexOf(f) >= 0) p = i; });
      labs.querySelectorAll(".mc-lab").forEach(function (l) { l.classList.toggle("hot", +l.dataset.p === p); });
    };
    MC.resize = function () { mcExit(null); };
    window.addEventListener("pointerdown", MC.down, true);
    window.addEventListener("pointerover", MC.over, true);
    window.addEventListener("resize", MC.resize);
  }
  function mcExit(pick) {
    if (!MC) return;
    var m = MC;
    MC = null;
    window.removeEventListener("pointerdown", m.down, true);
    window.removeEventListener("pointerover", m.over, true);
    window.removeEventListener("resize", m.resize);
    if (!m.lay) return; // 还在拍截图就退了
    root.classList.remove("mc-on");
    m.fs.forEach(function (f) { f.classList.remove("mc-hot"); f.style.transform = ""; f.style.zIndex = f._mcZ || ""; });
    if (pick) { if (pick.classList.contains("mw-min")) unminimize(pick); else focusFrame(pick, true); }
    setTimeout(function () {
      m.fs.forEach(function (f) { if (!f.style.transform) { f.style.transition = ""; f.style.transformOrigin = ""; f.style.removeProperty("--mcs"); } });
      if (m.dim) m.dim.remove();
      if (m.labs) m.labs.remove();
      m.shots.forEach(function (img) { img.remove(); });
    }, 420);
  }

  // ======== 内嵌浏览器的原生那一块：被别的窗口、程序坞、菜单盖住时要藏起来（webview.js 问这里）========
  function covers(el, r) {
    if (!on() || !el) return false;
    var f = el.closest && el.closest(".mw");
    if (!f) return false;
    if (f.classList.contains("mw-min") || MC) return true; // 调度中心里窗口是缩小移开的：原生那块先藏（画的是截图）
    var z = +f.style.zIndex || 0, hit = false;
    var over = function (q) { return q.width && q.height && q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top; };
    frameList().forEach(function (x) { if (hit || x === f || x.classList.contains("mw-min") || (+x.style.zIndex || 0) < z) return; if (over(x.getBoundingClientRect())) hit = true; });
    if (hit) return true;
    return Array.prototype.some.call(document.querySelectorAll("#dock, #launchpad, #desktop > .menu, .menu, .mw-snap, .cc-panel, .nc-panel"), function (o) { return o.offsetParent !== null && over(o.getBoundingClientRect()); });
  }

  // ======== 切换应用风格：窗口重新排（进来时每个标签页变成一个窗口；出去时回到平铺）========
  var was = on();
  new MutationObserver(function () {
    var now = on();
    if (now === was) return;
    was = now;
    if (now) setup();
    var t = T();
    (t && t.wins ? t.wins() : []).forEach(function (w) { if (w.ws && w.ws.layout && w.el && w.el.id === "win") w.ws.layout(); });
    if (now) applyLook(true);
    if (!now) { if (dock) dock.querySelectorAll(":scope > .mac-min, :scope > .mac-sep").forEach(function (x) { x.remove(); }); snapPreview(null); if (D.dockOverride) D.dockOverride(null); lastLook = ""; }
    if (D.refreshMenus) D.refreshMenus();
  }).observe(root, { attributes: true, attributeFilter: ["class"] });
  // 标题（agent 改了名字、网页换了标题）跟着变
  setInterval(function () { if (on()) { frameList().forEach(updateBar); applyLook(); } }, 1000);
  if (window.TSU_I18N && TSU_I18N.onChange) TSU_I18N.onChange(function () { frameList().forEach(function (f) { f._sig = ""; updateBar(f); }); if (dock) APP_IDS.forEach(function (id) { var a = dock.querySelector('[data-app="' + id + '"]'); if (a) a.title = nameOf(id); D.registerApp({ id: id, name: nameOf(id) }); }); paintWidgets(); });
  if (window.TSU_I18N && TSU_I18N.add) TSU_I18N.add({ "访达": "Finder", "设置": "Settings", "浏览器": "Browser", "应用程序": "Apps", "桌面与程序坞": "Desktop & Dock" });

  window.TSU_MACOS = {
    on: on,
    layout: layout,
    launch: launch,
    appName: appNameNow,
    systemMenu: systemMenu,
    appMenu: appMenu,
    windowMenu: windowMenu,
    covers: covers,
    frames: frameList,
    tile: function (kind) { var f = keyFrame(); if (f) tile(f, kind); },
    mission: missionControl,
  };
})();

// ---- 菜单栏右边读真的：电量（百分比、在不在充电）、Wi‑Fi（开没开、连没连、名字）、输入法 ----
(function () {
  var N = window.nadosNative;
  if (!N) return;
  function paint(st) {
    var tray = document.querySelector("#menubar .tray");
    if (!tray || !st) return;
    var ime = tray.querySelector(".ime");
    if (ime && st.input) ime.textContent = st.input;
    var svgs = tray.querySelectorAll(":scope > svg"), wifi = svgs[0], bat = svgs[1];
    if (wifi) { var w = st.wifi; wifi.style.display = w ? "" : "none"; wifi.classList.toggle("wifi-off", !!w && (!w.on || !w.connected)); wifi.setAttribute("title", w ? (w.on ? (w.ssid || (w.connected ? "Wi‑Fi" : "未连接")) : "Wi‑Fi 已关闭") : ""); }
    if (bat) {
      var b = st.battery;
      bat.style.display = b ? "" : "none";
      if (b) {
        var fill = bat.querySelectorAll("rect")[1], bolt = bat.querySelector(".bolt");
        if (fill) { fill.setAttribute("width", String(Math.max(1, Math.round(18 * b.level / 100)))); fill.setAttribute("fill", b.level <= 10 && !b.plugged ? "#ff453a" : "currentColor"); }
        if (bolt) bolt.style.display = b.charging || b.plugged ? "" : "none";
        var pct = tray.querySelector(".bat-pct");
        if (!pct) { pct = document.createElement("span"); pct.className = "bat-pct"; bat.parentNode.insertBefore(pct, bat); }
        pct.textContent = b.level + "%";
        bat.setAttribute("title", b.level + "%" + (b.charging ? " · 正在充电" : b.plugged ? " · 已接通电源" : ""));
      }
    }
  }
  function poll() { if (!document.documentElement.classList.contains("st-macos") || document.hidden) return; N.call("system.status", {}).then(paint, function () {}); }
  setTimeout(poll, 800);
  setInterval(poll, 20000);
  document.addEventListener("visibilitychange", poll);
  document.addEventListener("st-settings-changed", function () { setTimeout(poll, 100); });
})();
