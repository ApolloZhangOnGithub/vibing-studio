// ios/shell.js —— 手机上的 iOS 外壳（html.ios，由 index.html 头里的小脚本在首帧前定下）。desk.js 照常跑，这里在它上面包一层：
// · 窗口还是 desk.js 的 Win，一次只显示一个 App（.ios-fg），铺满整屏；打开从图标放大出来，回主屏幕缩回图标里
// · 主屏幕：图标页（左右翻）、Dock（终端、文件、Safari、备忘录）、最后一页是 App 资源库；Dock 上面的「搜索」
// · Home 指示条：点一下 / 往上滑回主屏幕；滑到一半停住、或连点两下是 App 切换器（卡片就是活的窗口，往上划掉 = 退出）
// · 右上角往下拉是控制中心（外观、专注、文字大小、墙纸……桌面上本来就有的那些），左上角往下拉是通知中心；通知是 iOS 的横幅
// · TSU_DESK 的接口照旧：popup → iOS 的菜单，notify → 横幅，alert → iOS 的提醒（样式），长按 = 右键（contextmenu）
// 对外：window.TSU_IOS（给终端、各 App 的手机排版用）
(function () {
  "use strict";
  var root = document.documentElement;
  if (!root.classList.contains("ios") || !window.TSU_DESK || !TSU_DESK.apps) return;
  var D = window.TSU_DESK, desk = document.getElementById("desktop"), winLayer = document.getElementById("wins");
  var sim = root.classList.contains("ios-sim"), reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var store = {
    get: function (k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 满了 */ } },
  };
  function h(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  var two = function (n) { return String(n).padStart(2, "0"); };
  var now = function () { return performance.now(); };
  var Wv = function () { return window.innerWidth; }, Hv = function () { return window.innerHeight; };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var listeners = {};
  function on(type, fn) { (listeners[type] = listeners[type] || []).push(fn); }
  function emit(type, a) { (listeners[type] || []).slice().forEach(function (fn) { try { fn(a); } catch (err) { console.error(err); } }); }

  // 状态栏、指示条让出多少：CSS 变量里可能是 env()，量一个探针拿到像素
  var probe = h("div");
  probe.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:var(--ios-top);padding-bottom:var(--ios-bottom)";
  document.body.appendChild(probe);
  function inset() { var cs = getComputedStyle(probe); return { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 }; }

  // ---- 图标（SF Symbols 的样子，手画）----
  var S = function (vb, attrs, body) { return '<svg viewBox="' + vb + '" ' + attrs + ' aria-hidden="true">' + body + "</svg>"; };
  var STROKE = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';
  var IC = {
    more: S("0 0 24 24", 'fill="currentColor"', '<circle cx="5.2" cy="12" r="1.85"/><circle cx="12" cy="12" r="1.85"/><circle cx="18.8" cy="12" r="1.85"/>'),
    search: S("0 0 24 24", STROKE + ' stroke-width="2.5"', '<circle cx="10.4" cy="10.4" r="6.4"/><path d="m15.3 15.3 5 5"/>'),
    chevR: S("0 0 10 17", STROKE + ' stroke-width="2.2"', '<path d="m2 2 6.5 6.5L2 15"/>'),
    chevL: S("0 0 10 17", STROKE + ' stroke-width="2.4"', '<path d="M8 2 1.5 8.5 8 15"/>'),
    check: S("0 0 20 20", STROKE + ' stroke-width="2.3"', '<path d="m4 10.5 4 4.2 8-9.2"/>'),
    moon: S("0 0 24 24", 'fill="currentColor"', '<path d="M19.6 15.2A8.3 8.3 0 0 1 8.8 4.4a8.3 8.3 0 1 0 10.8 10.8z"/>'),
    dark: S("0 0 30 30", 'fill="none"', '<circle cx="15" cy="15" r="10.5" stroke="currentColor" stroke-width="2.4"/><path d="M15 4.5a10.5 10.5 0 0 1 0 21z" fill="currentColor"/>'),
    gear: S("0 0 30 30", 'fill="currentColor"', '<path fill-rule="evenodd" d="M13.3 3.5h3.4l.6 3.2c.9.3 1.8.7 2.6 1.2l2.8-1.8 2.4 2.4-1.8 2.8c.5.8.9 1.7 1.2 2.6l3.2.6v3.4l-3.2.6c-.3.9-.7 1.8-1.2 2.6l1.8 2.8-2.4 2.4-2.8-1.8c-.8.5-1.7.9-2.6 1.2l-.6 3.2h-3.4l-.6-3.2a10 10 0 0 1-2.6-1.2l-2.8 1.8-2.4-2.4 1.8-2.8a10 10 0 0 1-1.2-2.6l-3.2-.6v-3.4l3.2-.6c.3-.9.7-1.8 1.2-2.6L6.3 8.5l2.4-2.4 2.8 1.8c.8-.5 1.7-.9 2.6-1.2zM15 19.6a4.6 4.6 0 1 0 0-9.2 4.6 4.6 0 0 0 0 9.2z"/>'),
    full: S("0 0 30 30", STROKE + ' stroke-width="2.4"', '<path d="M6 12V6h6M24 12V6h-6M6 18v6h6M24 18v6h-6"/>'),
    wifi: S("0 0 18 13", 'fill="currentColor"', '<path d="M9 2.4c2.7 0 5.2 1 7.1 2.8l1.2-1.3A11.9 11.9 0 0 0 9 .6C5.9.6 2.9 1.8.7 3.9l1.2 1.3A10.1 10.1 0 0 1 9 2.4z"/><path d="M9 5.9c1.8 0 3.4.7 4.7 1.9l1.2-1.3A8.6 8.6 0 0 0 9 4.1c-2.2 0-4.3.9-5.9 2.4l1.2 1.3C5.6 6.6 7.2 5.9 9 5.9z"/><path d="M9 9.4c.9 0 1.7.3 2.3.9L9 12.7l-2.3-2.4c.6-.6 1.4-.9 2.3-.9z"/>'),
    back: S("0 0 12 20", STROKE + ' stroke-width="2.6"', '<path d="M9.5 2.5 2.5 10l7 7.5"/>'),
    xmark: S("0 0 20 20", STROKE + ' stroke-width="2.4"', '<path d="m5 5 10 10M15 5 5 15"/>'),
  };

  // ---- App：主屏幕上的名字（iOS 的叫法）、不上主屏幕的（桌面才有的）、App 资源库的分类 ----
  var NAMES = { finder: "文件", settings: "设置" };
  var HIDE = { launchpad: 1, missioncontrol: 1 };
  var CATS = { win: "开发者工具", ide: "开发者工具", finder: "工具", "export": "工具", settings: "工具", safari: "信息与阅读" };
  var DOCK0 = ["win", "finder", "safari", "notes"];
  var SYS_ICON = '<span class="ico sq n-sys">✻</span>';
  function nameOf(id, fb) { return NAMES[id] || fb || id; }
  function homeApps() { return (D.appList() || []).filter(function (a) { return !HIDE[a.id]; }); }
  function iconOf(id) { var a = (D.appList() || []).find(function (x) { return x.id === id; }); return a ? a.icon : SYS_ICON; }

  // ======== 窗口 ========
  var W0 = D.apps.win || D.apps[Object.keys(D.apps)[0]];
  if (!W0) return;
  var Win = Object.getPrototypeOf(W0);
  function allWins() { return Object.keys(D.apps).map(function (k) { return D.apps[k]; }); }
  var isOpen = function (w) { return !!w && w.state !== "closed"; };
  var mru = []; // 最近到前台的在最后
  function touch(w) { mru = mru.filter(function (x) { return x !== w; }).concat([w]); }
  // 开着的窗口（App 切换器的卡片）：旧的在前，最近用的在最后
  function openList() {
    var list = allWins().filter(isOpen), z = function (w) { return parseInt(w.el.style.zIndex, 10) || 0; };
    return list.sort(function (a, b) { var ia = mru.indexOf(a), ib = mru.indexOf(b); return ia !== ib ? ia - ib : z(a) - z(b); });
  }
  allWins().filter(isOpen).sort(function (a, b) { return (parseInt(a.el.style.zIndex, 10) || 0) - (parseInt(b.el.style.zIndex, 10) || 0); }).forEach(touch);

  var fg = null, booting = true, suppress = 0, intent = null, swOn = false;
  function titleOf(w) {
    var t = "";
    try { t = w.title ? w.title() : ""; } catch (e) { t = ""; }
    if (!t) { var bs = w.el.querySelector(".bar span"); t = (bs && bs.textContent) || w.name || ""; }
    return t === w.name ? nameOf(w.app, t) : t;
  }
  // 前台是浅色的内容：状态栏、指示条用黑色（终端有自己的深浅：.tl）
  function lightContent() {
    if (!fg || swOn) return false;
    if (fg.el.classList.contains("termwin")) return fg.el.classList.contains("tl");
    return root.classList.contains("light");
  }
  var themeMeta = document.querySelector('meta[name="theme-color"]');
  if (!themeMeta) { themeMeta = document.createElement("meta"); themeMeta.name = "theme-color"; document.head.appendChild(themeMeta); }
  function syncChrome() {
    var light = lightContent();
    root.classList.toggle("ios-sb-dark", light);
    themeMeta.content = !fg ? "#000000" : light ? (fg === D.apps.settings ? "#f2f2f7" : "#ffffff") : "#000000";
  }
  function paint() {
    allWins().forEach(function (w) { w.el.classList.toggle("ios-fg", w === fg); });
    root.classList.toggle("ios-home", !fg);
    syncChrome();
  }
  document.addEventListener("tsu-theme", syncChrome);

  // ---- 动画：窗口（全屏）画成屏幕上一个矩形 r 的样子——等比缩到 r 的宽，上下用 clip-path 裁成 r 的高，圆角是屏幕上的 rad 像素 ----
  var SCREEN_R = sim ? 0 : 44;
  function frameAt(r, rad) {
    var W = Wv(), H = Hv(), k = Math.max(0.02, r.width / W), ins = Math.max(0, (H - r.height / k) / 2);
    return { translate: (r.left + r.width / 2 - W / 2).toFixed(2) + "px " + (r.top + r.height / 2 - H / 2).toFixed(2) + "px", scale: k.toFixed(4),
      clipPath: "inset(" + ins.toFixed(2) + "px 0px round " + (rad / k).toFixed(2) + "px)" };
  }
  function fullFrame(rad) { return { translate: "0px 0px", scale: "1", clipPath: "inset(0px 0px round " + (rad || 0) + "px)" }; }
  function centerRect() { var s = 64, W = Wv(), H = Hv(); return { left: W / 2 - s / 2, top: H / 2 - s / 2, width: s, height: s }; }
  function clearFrame(el) { el.style.translate = ""; el.style.scale = ""; el.style.clipPath = ""; el.style.opacity = ""; }
  var hs = null; // 主屏幕上图标那一层（开 App 时往外放大、变淡）
  function homeAnim(out) {
    if (!hs || reduced) return;
    hs.animate(out ? [{ scale: "1", opacity: 1 }, { scale: "1.14", opacity: 0 }] : [{ scale: "1.14", opacity: 0 }, { scale: "1", opacity: 1 }],
      { duration: out ? 360 : 480, easing: "cubic-bezier(0.2, 0.85, 0.25, 1)" });
  }
  // 图标的影子：跟着卡片放大、同时淡掉（开）；或者从淡到实、落回图标（关）
  function ghost(ibox, r, out) {
    if (!ibox || !r) return;
    var g = h("div", "ios-ghost"), W = Wv(), H = Hv(), s = W / r.width, dx = W / 2 - (r.left + r.width / 2), dy = H / 2 - (r.top + r.height / 2);
    g.style.cssText = "position:fixed;z-index:89;pointer-events:none;left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px";
    var c = ibox.cloneNode(true);
    c.style.margin = "0";
    g.appendChild(c);
    document.body.appendChild(g);
    var big = { translate: dx + "px " + dy + "px", scale: String(s) }, small = { translate: "0px 0px", scale: "1" };
    var a = g.animate(out ? [Object.assign({ opacity: 1 }, small), { opacity: 0, offset: 0.32 }, Object.assign({ opacity: 0 }, big)]
      : [Object.assign({ opacity: 0 }, big), { opacity: 0, offset: 0.55 }, Object.assign({ opacity: 1 }, small)],
      { duration: out ? 520 : 440, easing: out ? "cubic-bezier(0.18, 0.9, 0.22, 1)" : "cubic-bezier(0.3, 0.8, 0.25, 1)", fill: "forwards" });
    a.onfinish = function () { g.remove(); };
  }
  // 动画进行中（开 / 关 / 换 App）：键盘上面那条附加键这类贴着屏幕的东西先不出来
  var animT = 0;
  function animating(ms) { root.classList.add("ios-anim"); clearTimeout(animT); animT = setTimeout(function () { root.classList.remove("ios-anim"); }, ms); }
  function zoomIn(w, r, ibox) {
    if (reduced) return;
    animating(520);
    r = r || centerRect();
    w.el.animate([frameAt(r, r.width * 0.225), fullFrame(SCREEN_R)], { duration: 520, easing: "cubic-bezier(0.18, 0.9, 0.22, 1)" });
    homeAnim(true);
    ghost(ibox, r, true);
  }
  // 从 from（拖到一半的样子，不给就是全屏）缩回 r
  function zoomOut(w, r, ibox, from, done) {
    var el = w.el;
    el.classList.add("ios-out");
    if (reduced) { el.classList.remove("ios-out"); clearFrame(el); if (done) done(); return; }
    r = r || centerRect();
    animating(440);
    var end = frameAt(r, r.width * 0.225), a = el.animate([Object.assign({ opacity: 1 }, from || fullFrame(SCREEN_R)), { opacity: 1, offset: 0.7 }, Object.assign({ opacity: 0 }, end)],
      { duration: 440, easing: "cubic-bezier(0.3, 0.8, 0.25, 1)", fill: "forwards" });
    clearFrame(el);
    a.onfinish = function () { el.classList.remove("ios-out"); a.cancel(); if (done) done(); };
    homeAnim(false);
    ghost(ibox, r, false);
  }
  // App 换 App（链接打开别的 App、沿指示条左右滑）：新的从一边滑进来，旧的往另一边让开
  function slide(from, to, dir, fromX) {
    if (reduced || !from || !to) return;
    var W = Wv(), gap = 18;
    animating(400);
    from.el.classList.add("ios-out");
    var x0 = fromX || 0;
    to.el.animate([{ translate: (dir * (W + gap) + x0) + "px 0px" }, { translate: "0px 0px" }], { duration: 400, easing: "cubic-bezier(0.2, 0.85, 0.25, 1)" });
    var a = from.el.animate([{ translate: x0 + "px 0px" }, { translate: (-dir * (W + gap)) + "px 0px" }], { duration: 400, easing: "cubic-bezier(0.2, 0.85, 0.25, 1)", fill: "forwards" });
    clearFrame(from.el);
    a.onfinish = function () { from.el.classList.remove("ios-out"); a.cancel(); };
  }

  // ---- 前台：打开 / 换 App / 回主屏幕 ----
  function bringUp(w, o) {
    o = o || {};
    if (!isOpen(w)) return;
    if (w.state === "min") { suppress++; try { w.show(); } finally { suppress--; } }
    intent = null;
    closeMenu(true);
    closeSheets(true);
    if (swOn) closeSwitcher(null, { quiet: true });
    var prev = fg;
    decorate(w);
    if (prev === w) { paint(); return; }
    fg = w;
    touch(w);
    paint();
    store.set("tsu-ios-fg", w.el.id);
    if (o.anim !== false) { if (!prev) zoomIn(w, o.rect, o.icon); else slide(prev, w, o.dir || 1, o.fromX); }
    if (D.front() !== w) { suppress++; try { w.front(); } finally { suppress--; } } // desk.js 的「前台」也换成它（菜单、快捷键认这个）
    emit("fg", w);
    document.dispatchEvent(new CustomEvent("tsu-ios-fg", { detail: { id: w.el.id, app: w.app } }));
  }
  function blurInput() { var a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); }
  function iconFor(app) {
    var W = Wv(), list = homeEl.querySelectorAll('.ios-app[data-app="' + CSS.escape(app) + '"] .ibox');
    for (var i = 0; i < list.length; i++) { var r = list[i].getBoundingClientRect(); if (r.width && r.left > -4 && r.right < W + 4 && !list[i].closest(".ios-lib")) return list[i]; }
    return null;
  }
  function goHome(o) {
    o = o || {};
    if (swOn) return closeSwitcher(null);
    closeMenu(true);
    closeSheets(true);
    var w = o.from || fg, was = fg;
    fg = null;
    blurInput();
    paint();
    store.set("tsu-ios-fg", "");
    syncWall();
    if (was) { emit("fg", null); document.dispatchEvent(new CustomEvent("tsu-ios-fg", { detail: null })); }
    if (!w || o.anim === false) return;
    var ib = iconFor(w.app);
    zoomOut(w, ib ? ib.getBoundingClientRect() : null, ib, o.frame);
  }

  // ---- 接到 desk.js 的 Win 上：窗口开、到前面、关 ----
  var orig = { front: Win.front, show: Win.show, hide: Win.hide, place: Win.place, rect: Win.rect };
  Win.place = function (r) { return orig.place.call(this, r, false); }; // 位置大小由 CSS 定（铺满），不做 FLIP
  // 量出来的是铺满的样子：报 desk.js 摆的那个（横屏变宽时 desk.js 会记会话，别把整屏大小记成桌面上的窗口）
  Win.rect = function () { var st = this.el.style; return st.width && st.height ? { left: parseFloat(st.left) || 0, top: parseFloat(st.top) || 0, width: parseFloat(st.width), height: parseFloat(st.height) } : orig.rect.call(this); };
  Win.zoom = function () {};
  Win.enterFull = function () {};
  var intentFor = function (w) { return intent && now() - intent.t < 6000 && (w.app === intent.app || now() - intent.t < 1200 && !intent.strict) ? intent : null; };
  Win.front = function () {
    var r = orig.front.apply(this, arguments);
    if (!suppress) afterFront(this);
    return r;
  };
  function afterFront(w) {
    if (!isOpen(w) || w.state === "min") return;
    var it = intentFor(w);
    if (it) return bringUp(w, { rect: it.rect, icon: it.icon });
    if (booting || !fg || fg === w) return; // 在主屏幕上：别的 App 在后台把自己的窗口提前，不把人拉走
    bringUp(w);
  }
  Win.show = function () {
    var r;
    suppress++;
    try { r = orig.show.apply(this, arguments); } finally { suppress--; }
    decorate(this);
    var it = intentFor(this);
    if (it) bringUp(this, { rect: it.rect, icon: it.icon });
    else if (!booting) bringUp(this); // 打开一个窗口 = 要看它
    if (swOn) syncSwitcher();
    return r;
  };
  Win.hide = function (how) {
    var w = this, wasFg = w === fg, r;
    suppress++;
    try { r = orig.hide.apply(this, arguments); } finally { suppress--; }
    if (how === "closed") mru = mru.filter(function (x) { return x !== w; });
    if (wasFg && (how === "closed" || how === "min")) {
      // 同一个 App 还有别的窗口开着：换到它；不然回主屏幕（缩回图标）
      var mate = openList().filter(function (x) { return x !== w && x.app === w.app && x.state !== "min"; }).pop();
      if (mate) bringUp(mate, { anim: false }); else goHome({ from: w });
    }
    if (swOn) syncSwitcher();
    return r;
  };

  // ======== 导航栏：每个窗口的 .body 最前面一条；标题跟着窗口的标题走，右边 ⋯ 是这个 App 的菜单 ========
  var menuFilters = [];
  function decorate(w) {
    if (!w || !w.el || w.el.__ios) return;
    var body = w.el.querySelector(":scope > .body");
    if (!body) return;
    w.el.__ios = true;
    var nav = h("div", "ios-nav", '<div class="ios-nav-l"></div><div class="ios-nav-t"></div><div class="ios-nav-r"></div>');
    body.insertBefore(nav, body.firstChild);
    w.iosNav = nav;
    var more = navButton(w, { id: "more", icon: IC.more, label: "更多", run: function (b) { appMenu(w, b); } });
    var syncT = function () { nav.querySelector(".ios-nav-t").textContent = w.iosTitle ? w.iosTitle() : titleOf(w); more.hidden = !appMenuItems(w).length; };
    w.iosSyncTitle = syncT;
    syncT();
    var bar = w.el.querySelector(".bar");
    if (bar) new MutationObserver(syncT).observe(bar, { childList: true, subtree: true, characterData: true });
    new MutationObserver(function () { if (w === fg) syncChrome(); }).observe(w.el, { attributes: true, attributeFilter: ["class"] });
    emit("win", w);
  }
  // 导航栏上加一个圆按钮：o = { id, icon, label, run(按钮), side: "l" | "r", before: 另一个按钮的 id }
  function navButton(w, o) {
    var nav = w.iosNav;
    if (!nav) return null;
    var b = h("button", "ios-nb", o.icon || "");
    b.type = "button";
    if (o.id) b.dataset.nb = o.id;
    b.setAttribute("aria-label", o.label || "");
    if (o.text) b.textContent = o.text;
    b.addEventListener("click", function (e) { e.stopPropagation(); if (o.run) o.run(b); });
    var box = nav.querySelector(o.side === "l" ? ".ios-nav-l" : ".ios-nav-r"), ref = o.before && box.querySelector('[data-nb="' + o.before + '"]');
    box.insertBefore(b, ref || null);
    return b;
  }
  // 这个 App 的菜单：菜单栏的每个菜单是一行（点进去是它的项），App 菜单（关于……）放最后；各处可以加过滤（终端去掉分屏）
  function cleanItems(w, items) {
    var out = [];
    (items || []).forEach(function (a) {
      if (!a) return;
      if (menuFilters.some(function (f) { try { return f(w, a) === false; } catch (e) { return false; } })) return;
      if (a.sep) { if (out.length && !out[out.length - 1].sep) out.push(a); return; }
      if (a.items && typeof a.items !== "function") a = Object.assign({}, a, { items: cleanItems(w, a.items) });
      else if (a.items) { var fn = a.items; a = Object.assign({}, a, { items: function () { return cleanItems(w, fn()); } }); }
      out.push(a);
    });
    while (out.length && out[out.length - 1].sep) out.pop();
    return out;
  }
  function appMenuItems(w) {
    var menus = [], app = [];
    try { menus = (w.menus ? w.menus() : []) || []; } catch (e) { menus = []; }
    try { app = (w.appMenu ? w.appMenu() : []) || []; } catch (e) { app = []; }
    var items = menus.map(function (m) { return m && { label: m.title, items: cleanItems(w, m.items) }; }).filter(function (m) { return m && m.items.length; });
    app = cleanItems(w, app);
    return app.length ? items.concat(items.length ? [{ sep: true }] : [], app) : items;
  }
  function appMenu(w, anchor) { var items = appMenuItems(w); if (items.length) iosMenu(items, { el: anchor }); }

  // ======== 菜单：iOS 26 的菜单（大圆角玻璃、一行一项，勾在左、图标在右；分组之间一条宽缝；子菜单点进去，顶上一行返回）========
  var menuOv = null, RED = /^(删除|移到废纸篓|清倒废纸篓|全部删除|抹掉|永久删除|删除.*…$)/;
  function closeMenu(now) {
    if (!menuOv) return;
    var ov = menuOv, box = ov.firstChild;
    menuOv = null;
    if (now || reduced) { ov.remove(); return; }
    ov.style.pointerEvents = "none";
    box.classList.add("out");
    ov.classList.remove("dim");
    setTimeout(function () { ov.remove(); }, 170);
  }
  // at：{ x, y }（贴着这个点，长按 / 右键）、{ el }（挂在按钮下面）、{ above: el }（放在元素上方，Dock 图标那种）
  function iosMenu(items, at, o) {
    closeMenu(true);
    o = o || {};
    var ov = h("div", "ios-menu-ov" + (o.dim ? " dim" : "")), box = h("div", "ios-menu"), opened = now(), stack = [];
    ov.appendChild(box);
    document.body.appendChild(ov);
    menuOv = ov;
    function row(a, list, head) {
      if (a.swatches) {
        var sw = h("div", "ios-mi-sw");
        a.swatches.forEach(function (x) {
          var b0 = h("button");
          b0.type = "button";
          b0.style.background = x.color;
          if (x.on) b0.classList.add("on");
          b0.setAttribute("aria-label", x.title || "");
          b0.addEventListener("click", function () { closeMenu(); if (x.run) x.run(); });
          sw.appendChild(b0);
        });
        return sw;
      }
      var b = h("button", "ios-mi" + (a.disabled ? " dis" : "") + (a.info ? " info" : "") + (RED.test(a.label || "") ? " red" : ""));
      b.type = "button";
      b.innerHTML = (a.checked ? '<i class="ios-mi-ck">' + IC.check + "</i>" : "") + "<span></span>" + (a.items ? '<i class="ios-mi-chev">' + IC.chevR + "</i>" : a.icon ? '<i class="ios-mi-ic">' + a.icon + "</i>" : "");
      b.querySelector("span").textContent = a.label || "";
      b.addEventListener("click", function () {
        if (now() - opened < 300 || a.disabled || a.info) return; // 长按弹出菜单后松手的那一下不算
        if (a.items) { var sub = typeof a.items === "function" ? a.items() : a.items; stack.push({ list: list, head: head }); return render(sub || [], a.label); }
        closeMenu();
        if (a.run) { try { a.run(); } catch (err) { console.error(err); } }
      });
      return b;
    }
    function render(list, head) {
      box.textContent = "";
      box.classList.toggle("ck", (list || []).some(function (a) { return a && a.checked; })); // 有打勾的项才给左边留出勾的位置
      if (head) {
        var hb = h("button", "ios-mi head", '<i class="ios-mi-back">' + IC.back + "</i><span></span>");
        hb.type = "button";
        hb.querySelector("span").textContent = head;
        hb.addEventListener("click", function () { var p = stack.pop(); if (p) render(p.list, p.head); });
        box.appendChild(hb);
        box.appendChild(h("div", "ios-ms"));
      }
      var gap = true;
      (list || []).forEach(function (a) {
        if (!a) return;
        if (a.sep) { if (!gap) box.appendChild(h("div", "ios-ms")); gap = true; return; }
        gap = false;
        box.appendChild(row(a, list, head));
      });
      while (box.lastChild && box.lastChild.classList.contains("ios-ms")) box.lastChild.remove();
      if (!(list || []).some(function (a) { return a && !a.sep; })) { var none = h("div", "ios-mi info", "<span>（无）</span>"); box.appendChild(none); }
      box.scrollTop = 0;
      if (stack.length) place();
    }
    function place() {
      var W = Wv(), H = Hv(), ins = inset(), bw = box.offsetWidth, bh = box.offsetHeight, top = ins.top + 6, bottom = H - Math.max(ins.bottom, 12) - 6, x, y, ox, oy;
      if (at && at.above) {
        var ra = at.above.getBoundingClientRect();
        x = ra.left + ra.width / 2 - bw / 2;
        y = ra.top - bh - 10;
        if (y < top) y = ra.bottom + 10;
        ox = ra.left + ra.width / 2; oy = y < ra.top ? ra.top : ra.bottom;
      } else if (at && at.el) {
        var re = at.el.getBoundingClientRect(), rightSide = re.left + re.width / 2 > W / 2;
        x = rightSide ? re.right - bw : re.left;
        y = re.bottom + 8;
        if (y + bh > bottom) y = Math.max(top, re.top - 8 - bh);
        ox = rightSide ? re.right : re.left; oy = re.bottom;
      } else if (at && at.x != null) {
        x = at.x;
        y = at.y + 6;
        if (x + bw > W - 10) x = at.x - bw;
        if (y + bh > bottom) y = at.y - bh - 6;
        ox = at.x; oy = at.y;
      } else { x = (W - bw) / 2; y = (H - bh) / 2; ox = W / 2; oy = H / 2; }
      x = clamp(x, 10, W - bw - 10);
      y = clamp(y, top, Math.max(top, bottom - bh));
      box.style.left = x + "px";
      box.style.top = y + "px";
      box.style.setProperty("--ox", (ox - x) + "px");
      box.style.setProperty("--oy", (oy - y) + "px");
    }
    render(items, null);
    place();
    ov.addEventListener("pointerdown", function (e) { if (e.target === ov) { e.preventDefault(); closeMenu(); } });
    ov.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    return { el: box, items: items, close: function () { closeMenu(); } };
  }

  // ======== 长按 = 右键（iOS 不发 contextmenu）：访达、备忘录这些 App 的右键菜单照常弹（弹出来是上面的 iOS 菜单）========
  // 能选字的地方（输入框、终端的输出……）长按归系统（选字、放大镜）；我们自己的界面另有长按
  var NO_LP = "input, textarea, select, [contenteditable]:not([contenteditable='false']), .tpane, .xterm, .ios-nav, .selectable, .io-app"; // .io-app：各 App 的 iPhone 版式有自己的长按
  var lp = null, swallowUntil = 0, lastTouch = 0;
  document.addEventListener("pointerdown", function (e) {
    if (e.pointerType !== "touch") return;
    lastTouch = now();
    if (lp) { clearTimeout(lp.timer); lp = null; }
    if (!e.isPrimary || !e.target.closest || !e.target.closest("#wins") || e.target.closest(NO_LP)) return;
    var t = e.target, x = e.clientX, y = e.clientY;
    lp = { x: x, y: y, t: t, fired: false, timer: setTimeout(function () {
      if (!lp || lp.t !== t) return;
      lp.fired = true;
      swallowUntil = now() + 1500;
      t.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y, button: 2 }));
    }, 480) };
  }, true);
  document.addEventListener("pointermove", function (e) { if (lp && e.pointerType === "touch" && Math.abs(e.clientX - lp.x) + Math.abs(e.clientY - lp.y) > 10) { clearTimeout(lp.timer); if (!lp.fired) lp = null; } }, true);
  var lpEnd = function (e) { if (lp && e.pointerType === "touch") { clearTimeout(lp.timer); if (!lp.fired) lp = null; } };
  document.addEventListener("pointerup", lpEnd, true);
  document.addEventListener("pointercancel", lpEnd, true);
  // 浏览器自己也会在长按时发一次 contextmenu（Chrome 的触屏模拟、安卓）：同一下长按只弹一次
  document.addEventListener("contextmenu", function (e) {
    if (!e.isTrusted || now() - lastTouch > 1500) return;
    if (lp && lp.fired) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (lp) { clearTimeout(lp.timer); lp.fired = true; swallowUntil = now() + 1500; }
  }, true);
  document.addEventListener("click", function (e) { if (now() < swallowUntil && lp && lp.fired) { e.preventDefault(); e.stopPropagation(); lp = null; swallowUntil = 0; } }, true);

  // ======== 状态栏（电脑上看时才画；真手机上是系统的）========
  var sb = null;
  if (sim) {
    sb = h("div", null, '<span class="ios-sb-time"></span><i class="ios-island"></i><span class="ios-sb-tray">' + IC.wifi.replace("<svg", '<svg width="18" height="13"') + '<span class="ios-batt"><i></i></span></span>');
    sb.id = "ios-status";
    document.body.appendChild(sb);
    var sbTime = sb.querySelector(".ios-sb-time"), batt = sb.querySelector(".ios-batt");
    (function tick() {
      var d = new Date();
      sbTime.textContent = two(d.getHours()) + ":" + two(d.getMinutes());
      setTimeout(tick, 60000 - d.getSeconds() * 1000 - d.getMilliseconds() + 20);
    })();
    var syncBatt = function (b) { batt.style.setProperty("--lv", b.level); batt.classList.toggle("low", b.level <= 0.2 && !b.charging); };
    if (navigator.getBattery) navigator.getBattery().then(function (b) { syncBatt(b); b.addEventListener("levelchange", function () { syncBatt(b); }); b.addEventListener("chargingchange", function () { syncBatt(b); }); }, function () {});
  }

  // ======== 主屏幕 ========
  var homeEl = h("div", null, '<div class="ios-wall"></div><div class="ios-hs"><div class="ios-pages"></div>' +
    '<div class="ios-foot"><button class="ios-search" type="button">' + IC.search + '<span>搜索</span></button><div class="ios-dots"></div></div><div class="ios-dock"></div></div>');
  homeEl.id = "ios-home";
  desk.insertBefore(homeEl, winLayer);
  hs = homeEl.querySelector(".ios-hs");
  var wallEl = homeEl.querySelector(".ios-wall"), pagesEl = homeEl.querySelector(".ios-pages"), dockEl = homeEl.querySelector(".ios-dock");
  var footEl = homeEl.querySelector(".ios-foot"), dotsEl = homeEl.querySelector(".ios-dots");
  var WALL_FILES = { "pub-emerald": "pub-emerald.webp", "pub-sunset": "pub-sunset.webp", "tahoe-day": "tahoe-day.jpg", "tahoe-night": "tahoe-night.jpg", "lake-day": "lake-day.jpg", "lake-night": "lake-night.jpg" };
  var wallNow = "";
  function syncWall() {
    var id = "";
    try { id = D.settings && D.settings.get("wallpaper"); } catch (e) { id = ""; }
    var f = WALL_FILES[id] || WALL_FILES["pub-emerald"];
    if (f !== wallNow) { wallNow = f; wallEl.style.backgroundImage = 'url("' + f + '")'; }
  }
  syncWall();
  document.addEventListener("tsu-settings", function () { syncWall(); syncCC(); });
  var dockIds = store.get("tsu-ios-dock", null) || DOCK0.slice();
  var PER = 24, ICON_S = 1.22;
  function appButton(a, withLabel) {
    var b = h("button", "ios-app");
    b.type = "button";
    b.dataset.app = a.id;
    b.innerHTML = '<span class="ibox" style="--s:' + ICON_S + '">' + a.icon + "</span>" + (withLabel ? '<span class="ios-lbl"></span>' : "");
    if (withLabel) b.querySelector(".ios-lbl").textContent = nameOf(a.id, a.name);
    b.setAttribute("aria-label", nameOf(a.id, a.name));
    return b;
  }
  var homeSig = "";
  function renderHome() {
    var list = homeApps(), byId = {};
    list.forEach(function (a) { byId[a.id] = a; });
    var sig = list.map(function (a) { return a.id + ":" + a.name + ":" + a.icon.length; }).join("|") + "#" + dockIds.join(",");
    if (sig === homeSig) return;
    homeSig = sig;
    var keepPage = pagesEl.clientWidth ? Math.round(pagesEl.scrollLeft / pagesEl.clientWidth) : 0;
    dockEl.textContent = "";
    dockIds.filter(function (id) { return byId[id]; }).forEach(function (id) { dockEl.appendChild(appButton(byId[id], false)); });
    var rest = list.filter(function (a) { return dockIds.indexOf(a.id) < 0; });
    pagesEl.textContent = "";
    for (var i = 0; i === 0 || i < rest.length; i += PER) {
      var pg = h("div", "ios-page");
      rest.slice(i, i + PER).forEach(function (a) { pg.appendChild(appButton(a, true)); });
      pagesEl.appendChild(pg);
    }
    pagesEl.appendChild(libraryPage(list));
    var n = pagesEl.children.length - 1;
    dotsEl.innerHTML = new Array(n + 1).join("<i></i>");
    pagesEl.scrollLeft = keepPage * pagesEl.clientWidth;
    syncDots();
  }
  // App 资源库：「建议」（最近用过的）+ 按分类；每一格三个大图标 + 右下角四个小图标（点小图标打开这一类的全部）
  function libraryPage(list) {
    var pg = h("div", "ios-page ios-lib", '<div class="ios-lib-search">' + IC.search + '<span>App 资源库</span></div><div class="ios-lib-grid"></div>'), grid = pg.lastChild;
    var groups = [], by = {};
    var recent = mru.slice().reverse().map(function (w) { return list.find(function (a) { return a.id === w.app; }); }).filter(function (a, i, arr) { return a && arr.indexOf(a) === i; });
    if (recent.length) groups.push({ name: "建议", apps: recent });
    list.forEach(function (a) { var c = CATS[a.id] || "效率"; if (!by[c]) groups.push(by[c] = { name: c, apps: [] }); by[c].apps.push(a); });
    groups.forEach(function (g) {
      var f = h("div", "ios-fold", '<div class="ios-fold-box"></div><div class="ios-fold-name"></div>'), box = f.firstChild;
      f.lastChild.textContent = g.name;
      var big = g.apps.length > 4 ? g.apps.slice(0, 3) : g.apps.slice(0, 4);
      big.forEach(function (a) { var b = appButton(a, false); b.querySelector(".ibox").style.setProperty("--s", "1.08"); box.appendChild(b); });
      if (g.apps.length > 4) {
        var mini = h("button", "ios-fold-mini");
        mini.type = "button";
        mini.setAttribute("aria-label", g.name);
        g.apps.slice(3, 7).forEach(function (a) { mini.insertAdjacentHTML("beforeend", '<span class="ibox" style="--s:0.5">' + a.icon + "</span>"); });
        mini.addEventListener("click", function () { openFolder(g); });
        box.appendChild(mini);
      }
      grid.appendChild(f);
    });
    return pg;
  }
  function openFolder(g) {
    var ov = h("div", null, "<h2></h2><div class=\"ios-fold-all\"></div>");
    ov.id = "ios-folder";
    ov.firstChild.textContent = g.name;
    g.apps.forEach(function (a) { ov.lastChild.appendChild(appButton(a, true)); });
    ov.addEventListener("click", function (e) {
      var b = e.target.closest(".ios-app");
      if (b) { launchFrom(b.dataset.app, b.querySelector(".ibox")); }
      ov.remove();
    });
    document.body.appendChild(ov);
  }
  function syncDots() {
    var W = pagesEl.clientWidth || 1, p = Math.round(pagesEl.scrollLeft / W), dots = dotsEl.children;
    for (var i = 0; i < dots.length; i++) dots[i].classList.toggle("on", i === p);
  }
  var pagingT = 0;
  pagesEl.addEventListener("scroll", function () {
    footEl.classList.add("paging");
    syncDots();
    clearTimeout(pagingT);
    pagingT = setTimeout(function () { footEl.classList.remove("paging"); }, 900);
  }, { passive: true });
  document.addEventListener("tsu-apps", function () { renderHome(); });
  renderHome();

  // 点图标：记下「是从这个图标打开的」，App 自己的 open 开出窗口时（同步或稍后）就从图标放大出来
  function launchFrom(id, ibox) {
    var r = ibox ? ibox.getBoundingClientRect() : null;
    intent = { app: id, rect: r && r.width ? r : null, icon: ibox, t: now() };
    var w = D.apps[id];
    if (w && isOpen(w) && w.state !== "min" && w === fg) return;
    D.launch(id);
  }
  var pressT = 0, pressed = null, lpHome = null;
  homeEl.addEventListener("pointerdown", function (e) {
    var b = e.target.closest(".ios-app");
    if (!b) return;
    pressed = b;
    b.classList.add("pressed");
    var x = e.clientX, y = e.clientY;
    clearTimeout(pressT);
    lpHome = { x: x, y: y, fired: false };
    pressT = setTimeout(function () { if (pressed !== b) return; lpHome.fired = true; b.classList.remove("pressed"); iconMenu(b); }, 520);
  });
  homeEl.addEventListener("pointermove", function (e) { if (lpHome && Math.abs(e.clientX - lpHome.x) + Math.abs(e.clientY - lpHome.y) > 10) { clearTimeout(pressT); if (pressed) pressed.classList.remove("pressed"); pressed = null; } });
  var unpress = function () { clearTimeout(pressT); if (pressed) pressed.classList.remove("pressed"); pressed = null; };
  homeEl.addEventListener("pointerup", unpress);
  homeEl.addEventListener("pointercancel", unpress);
  homeEl.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  homeEl.addEventListener("mousedown", function (e) { e.preventDefault(); }); // 点图标不把焦点拿走（打开的 App 自己决定焦点给谁）
  homeEl.addEventListener("click", function (e) {
    if (lpHome && lpHome.fired) { lpHome = null; return; }
    var b = e.target.closest(".ios-app");
    if (b && !b.closest(".ios-fold-mini")) launchFrom(b.dataset.app, b.querySelector(".ibox"));
  });
  homeEl.querySelector(".ios-search").addEventListener("click", function () { openSpot(); });
  homeEl.querySelector(".ios-pages").addEventListener("click", function (e) { if (e.target.closest(".ios-lib-search")) openSpot(); });
  // 长按图标：这个 App 的快捷操作（开着的窗口、新建……）与 Dock 的增减
  function iconMenu(b) {
    var id = b.dataset.app, wins = (D.appWindows(id) || []).filter(isOpen), items = [];
    var w = wins[wins.length - 1] || D.apps[id], nw = null;
    (w && w.menus ? safe(function () { return w.menus(); }) || [] : []).some(function (m) {
      return (m.items || []).some(function (x) { if (x && x.label && /^新建/.test(x.label) && !x.disabled && x.run) { nw = x; return true; } return false; });
    });
    if (nw) items.push({ label: nw.label, run: function () { launchFrom(id, b.querySelector(".ibox")); setTimeout(function () { nw.run(); }, 60); } });
    if (wins.length > 1) {
      items.push({ sep: true });
      wins.forEach(function (x) { items.push({ label: titleOf(x), run: function () { intent = { app: id, rect: b.querySelector(".ibox").getBoundingClientRect(), icon: b.querySelector(".ibox"), t: now(), strict: true }; bringUp(x, { rect: intent.rect, icon: intent.icon }); } }); });
    }
    items.push({ sep: true });
    var inDock = dockIds.indexOf(id) >= 0;
    if (inDock || dockIds.length < 4) items.push({ label: inDock ? "从程序坞移除" : "添加到程序坞", run: function () {
      dockIds = inDock ? dockIds.filter(function (x) { return x !== id; }) : dockIds.concat([id]);
      store.set("tsu-ios-dock", dockIds);
      renderHome();
    } });
    if (!items.some(function (a) { return !a.sep; })) return;
    iosMenu(items, { above: b.querySelector(".ibox") }, { dim: true });
  }
  function safe(fn) { try { return fn(); } catch (e) { return null; } }

  // ======== Home 指示条 ========
  var hi = h("div", null, "<i></i>");
  hi.id = "ios-hi";
  document.body.appendChild(hi);
  var hg = null, lastTap = 0;
  // 拖着指示条：卡片的下沿跟着手指，越往上越小；左右跟着手指走
  function dragFrame(dx, dy) {
    var W = Wv(), H = Hv(), up = Math.max(0, dy), s = clamp(1 - up / (H * 0.8), 0.36, 1), cy = H - up - H * s / 2 + Math.min(0, dy) * -0.2;
    return { translate: (dx * 0.9).toFixed(1) + "px " + (cy - H / 2).toFixed(1) + "px", scale: s.toFixed(4), clipPath: "inset(0px round " + (Math.min(40, up / 3) / s).toFixed(1) + "px)", s: s };
  }
  hi.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    try { hi.setPointerCapture(e.pointerId); } catch (x) { /* 已经松开 */ }
    hg = { x0: e.clientX, y0: e.clientY, t0: now(), pts: [[e.clientX, e.clientY, now()]], w: swOn ? null : fg, moved: false };
  });
  hi.addEventListener("pointermove", function (e) {
    if (!hg) return;
    var dx = e.clientX - hg.x0, dy = hg.y0 - e.clientY, t = now();
    hg.pts.push([e.clientX, e.clientY, t]);
    if (hg.pts.length > 8) hg.pts.shift();
    if (!hg.moved && Math.abs(dx) + Math.abs(dy) > 7) {
      hg.moved = true;
      if (hg.w) { hg.w.el.getAnimations().forEach(function (a) { a.cancel(); }); root.classList.add("ios-anim"); }
    }
    if (!hg.moved) return;
    if (hg.w) {
      var f = dragFrame(dx, dy), st = hg.w.el.style;
      st.translate = f.translate; st.scale = f.scale; st.clipPath = f.clipPath;
      hs.style.opacity = String(clamp((1 - f.s) * 2.2, 0, 1));
      hs.style.scale = String(1.1 - 0.1 * clamp((1 - f.s) * 2.2, 0, 1));
      hg.frame = f;
    }
    // 停住（往上拖了一段、手指不再动）：直接进 App 切换器（手指还按着，同 iOS）。手指不动时不会再有 move，所以用计时器等
    if (!hg.anchor || Math.abs(e.clientX - hg.anchor[0]) + Math.abs(e.clientY - hg.anchor[1]) > 5) {
      hg.anchor = [e.clientX, e.clientY];
      clearTimeout(hg.holdTimer);
      var g0 = hg;
      hg.holdTimer = setTimeout(function () {
        if (hg !== g0 || g0.y0 - g0.anchor[1] < 60) return;
        hg = null;
        hs.style.opacity = "";
        hs.style.scale = "";
        animating(420);
        openSwitcher({ from: g0.w, frame: g0.frame });
      }, 190);
    }
  });
  function hiEnd(e) {
    if (!hg) return;
    var g = hg, dx = e.clientX - g.x0, dy = g.y0 - e.clientY, t = now(), p0 = g.pts[0], vy = (p0[1] - e.clientY) / Math.max(1, t - p0[2]), vx = (e.clientX - p0[0]) / Math.max(1, t - p0[2]);
    hg = null;
    clearTimeout(g.holdTimer);
    if (g.moved) animating(420);
    hs.style.opacity = "";
    hs.style.scale = "";
    if (swOn) { if (e.type !== "pointercancel" && (!g.moved || dy > 30)) closeSwitcher(null); return; } // 切换器里：点指示条 / 往上滑回主屏幕
    if (!g.moved) {
      // 点一下：回主屏幕；紧接着再点一下：App 切换器
      if (t - lastTap < 420) { lastTap = 0; return openSwitcher(); }
      lastTap = t;
      if (fg) goHome();
      return;
    }
    if (e.type === "pointercancel") { if (g.w) springBack(g.w); return; }
    if (!g.w) { if (dy > 60) openSwitcher(); return; }
    if (dy > 110 || vy > 0.55 && dy > 30) return goHome({ frame: g.frame && { translate: g.frame.translate, scale: g.frame.scale, clipPath: g.frame.clipPath } });
    // 沿着底边左右滑：换到上一个 / 下一个 App
    if (Math.abs(dx) > 70 && Math.abs(dx) > dy * 1.3 || Math.abs(vx) > 0.6 && Math.abs(dx) > 30) {
      var list = openList().filter(function (w) { return w.state !== "min"; }), i = list.indexOf(g.w), to = list[i + (dx > 0 ? -1 : 1)];
      if (to) { clearFrame(g.w.el); return bringUp(to, { dir: dx > 0 ? -1 : 1, fromX: dx * 0.9 }); }
    }
    springBack(g.w);
  }
  function springBack(w) {
    var el = w.el, from = { translate: el.style.translate || "0px 0px", scale: el.style.scale || "1", clipPath: el.style.clipPath || "inset(0px round 0px)" };
    clearFrame(el);
    if (!reduced) el.animate([from, { translate: "0px 0px", scale: "1", clipPath: "inset(0px round 0px)" }], { duration: 380, easing: "cubic-bezier(0.25, 1.1, 0.4, 1)" });
  }
  hi.addEventListener("pointerup", hiEnd);
  hi.addEventListener("pointercancel", hiEnd);

  // ======== App 切换器：窗口本身缩成卡片（活的），左右划着翻；往上划掉一张 = 退出那个 App；点卡片进去，点空白回主屏幕 ========
  var sw = null;
  function swGeo() {
    var W = Wv(), H = Hv(), k = clamp((H - 250) / H, 0.5, 0.7), cw = W * k, ch = H * k;
    return { W: W, H: H, k: k, cw: cw, ch: ch, cy: H / 2 + 14, fx: W / 2 + cw * 0.08, step: cw * 0.62 };
  }
  function cardX(d, g) { return d >= 0 ? g.fx + d * (g.cw + 20) : g.fx + d * g.cw * 0.46; }
  function cardFrame(c, i, g, pos) {
    var d = i - (pos == null ? sw.pos : pos), cx = cardX(d, g), cy = g.cy + c.lift;
    return { translate: (cx - g.W / 2).toFixed(1) + "px " + (cy - g.H / 2).toFixed(1) + "px", scale: g.k.toFixed(4), clipPath: "inset(0px round " + (34 / g.k).toFixed(1) + "px)", cx: cx, cy: cy };
  }
  function paintCards() {
    if (!sw) return;
    var g = swGeo();
    sw.cards.forEach(function (c, i) {
      var f = cardFrame(c, i, g), st = c.w.el.style;
      st.translate = f.translate; st.scale = f.scale; st.clipPath = f.clipPath;
      st.setProperty("--swz", String(100 + 2 * i));
      // 卡片的影子（窗口本身被 clip-path 裁着，画不出阴影）：同样大小的一块，排在它下面，落在左边那张卡片上
      c.sh.style.transform = "translate(" + (f.cx - g.cw / 2).toFixed(1) + "px," + (f.cy - g.ch / 2).toFixed(1) + "px)";
      c.sh.style.width = g.cw + "px";
      c.sh.style.height = g.ch + "px";
      c.sh.style.zIndex = String(99 + 2 * i);
      c.lab.style.transform = "translate(" + (f.cx - g.cw / 2 + 4).toFixed(1) + "px," + (f.cy - g.ch / 2 - 42).toFixed(1) + "px)";
      c.lab.style.opacity = String(clamp(1 + c.lift / 160, 0, 1));
    });
  }
  function label(w) {
    var l = h("div", "ios-sw-lab", '<span class="ibox" style="--s:0.62">' + iconOf(w.app) + "</span><span></span>");
    l.lastChild.textContent = nameOf(w.app, w.name);
    return l;
  }
  function openSwitcher(o) {
    o = o || {};
    if (swOn) return;
    var list = openList();
    if (!list.length) return;
    closeMenu(true);
    closeSheets(true);
    blurInput();
    swOn = true;
    var from = o.from || fg;
    var el = h("div");
    el.id = "ios-sw";
    document.body.appendChild(el);
    sw = { el: el, cards: [], pos: 0, from: from };
    list.forEach(function (w) {
      w.el.getAnimations().forEach(function (a) { a.cancel(); });
      w.el.classList.add("ios-card");
      var c = { w: w, lab: label(w), sh: h("div", "ios-sw-sh"), lift: 0 };
      el.appendChild(c.lab);
      winLayer.appendChild(c.sh);
      sw.cards.push(c);
    });
    var fi = sw.cards.findIndex(function (c) { return c.w === from; });
    sw.pos = fi >= 0 ? fi : sw.cards.length - 1;
    fg = null;
    root.classList.add("ios-switcher");
    paint();
    var g = swGeo();
    paintCards();
    if (!reduced) sw.cards.forEach(function (c, i) {
      var f = cardFrame(c, i, g), to = { translate: f.translate, scale: f.scale, clipPath: f.clipPath };
      if (c.w === from) c.w.el.animate([o.frame ? { translate: o.frame.translate, scale: o.frame.scale, clipPath: o.frame.clipPath } : fullFrame(SCREEN_R), to], { duration: 420, easing: "cubic-bezier(0.2, 0.9, 0.25, 1)" });
      else c.w.el.animate([{ translate: (f.cx - g.W / 2 - (from ? g.cw * 0.5 : 0)) + "px " + (f.cy - g.H / 2 + (from ? 0 : g.H * 0.25)) + "px", scale: f.scale, clipPath: f.clipPath, opacity: 0 }, Object.assign({ opacity: 1 }, to)],
        { duration: 420, easing: "cubic-bezier(0.2, 0.9, 0.25, 1)" });
      c.lab.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 120, fill: "backwards" });
    });
    swGestures(el);
    emit("switcher", true);
  }
  function syncSwitcher() {
    if (!sw) return;
    sw.cards = sw.cards.filter(function (c) { if (isOpen(c.w)) return true; c.lab.remove(); c.sh.remove(); c.w.el.classList.remove("ios-card"); clearFrame(c.w.el); return false; });
    if (!sw.cards.length) return closeSwitcher(null);
    sw.pos = clamp(sw.pos, 0, sw.cards.length - 1);
    paintCards();
  }
  function closeSwitcher(pick, o) {
    if (!sw) return;
    o = o || {};
    var s = sw, g = swGeo();
    sw = null;
    swOn = false;
    root.classList.remove("ios-switcher");
    s.el.remove();
    var finish = function () { s.cards.forEach(function (c) { c.sh.remove(); c.w.el.classList.remove("ios-card"); clearFrame(c.w.el); c.w.el.style.removeProperty("--swz"); }); };
    if (pick) {
      var c0 = s.cards.find(function (c) { return c.w === pick; });
      var fromF = c0 ? { translate: c0.w.el.style.translate, scale: c0.w.el.style.scale, clipPath: c0.w.el.style.clipPath } : null;
      finish();
      fg = null;
      bringUp(pick, { anim: false });
      if (fromF && !reduced) pick.el.animate([fromF, fullFrame(SCREEN_R)], { duration: 380, easing: "cubic-bezier(0.2, 0.9, 0.25, 1)" });
      return;
    }
    // 回主屏幕：卡片往下沉、淡掉
    if (o.quiet || reduced) { finish(); paint(); return; }
    s.cards.forEach(function (c, i) {
      var f = cardFrame(c, i, g, s.pos), el = c.w.el;
      el.classList.add("ios-out");
      var a = el.animate([{ translate: el.style.translate, scale: el.style.scale, clipPath: el.style.clipPath, opacity: 1 },
        { translate: (f.cx - g.W / 2) + "px " + (f.cy - g.H / 2 + 60) + "px", scale: String(g.k * 0.9), clipPath: el.style.clipPath, opacity: 0 }], { duration: 260, easing: "ease-in", fill: "forwards" });
      a.onfinish = function () { el.classList.remove("ios-out"); a.cancel(); };
    });
    finish();
    paint();
    homeAnim(false);
  }
  function tween(ms, step, done) {
    var t0 = now();
    (function frame() {
      var p = Math.min(1, (now() - t0) / ms), e = 1 - Math.pow(1 - p, 3);
      step(e);
      if (p < 1) requestAnimationFrame(frame); else if (done) done();
    })();
  }
  function swGestures(el) {
    var g = null;
    function hit(x, y) {
      var geo = swGeo();
      for (var i = sw.cards.length - 1; i >= 0; i--) {
        var f = cardFrame(sw.cards[i], i, geo);
        if (Math.abs(x - f.cx) <= geo.cw / 2 && Math.abs(y - f.cy) <= geo.ch / 2) return sw.cards[i];
      }
      return null;
    }
    el.addEventListener("pointerdown", function (e) {
      if (!sw || g) return;
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (x) { /* 已经松开 */ }
      g = { x0: e.clientX, y0: e.clientY, pos0: sw.pos, card: hit(e.clientX, e.clientY), mode: null, pts: [[e.clientX, e.clientY, now()]] };
    });
    el.addEventListener("pointermove", function (e) {
      if (!g || !sw) return;
      var dx = e.clientX - g.x0, dy = e.clientY - g.y0, geo = swGeo();
      g.pts.push([e.clientX, e.clientY, now()]);
      if (g.pts.length > 6) g.pts.shift();
      if (!g.mode && Math.abs(dx) + Math.abs(dy) > 8) g.mode = g.card && Math.abs(dy) > Math.abs(dx) ? "lift" : "pan";
      if (g.mode === "pan") {
        var p = g.pos0 - dx / geo.step, n = sw.cards.length - 1;
        sw.pos = p < 0 ? p * 0.3 : p > n ? n + (p - n) * 0.3 : p;
        paintCards();
      } else if (g.mode === "lift") { g.card.lift = dy < 0 ? dy : dy * 0.25; paintCards(); }
    });
    function end(e) {
      if (!g || !sw) { g = null; return; }
      var s = g, t = now(), p0 = s.pts[0], vx = (e.clientX - p0[0]) / Math.max(1, t - p0[2]), vy = (e.clientY - p0[1]) / Math.max(1, t - p0[2]), geo = swGeo();
      g = null;
      if (!s.mode) {
        if (e.type === "pointercancel") return;
        if (s.card) return closeSwitcher(s.card.w);
        return closeSwitcher(null);
      }
      if (s.mode === "pan") {
        var from = sw.pos, to = clamp(Math.round(sw.pos - vx * 160 / geo.step), 0, sw.cards.length - 1);
        return tween(360, function (k) { if (sw) { sw.pos = from + (to - from) * k; paintCards(); } });
      }
      var c = s.card, l0 = c.lift;
      if (c.lift < -geo.ch * 0.22 || vy < -0.7 && c.lift < -20) {
        tween(220, function (k) { c.lift = l0 + (-geo.H - l0) * k; paintCards(); }, function () {
          var p = D.close(c.w.el.id);
          Promise.resolve(p).then(function (ok) {
            if (!sw) return;
            if (ok === false || isOpen(c.w)) { var l1 = c.lift; tween(300, function (k) { c.lift = l1 * (1 - k); paintCards(); }); return; }
            syncSwitcher();
          });
        });
      } else tween(300, function (k) { c.lift = l0 * (1 - k); paintCards(); });
    }
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  // ======== 控制中心、通知中心：从屏幕上沿往下拉（右上角 = 控制中心，左边和中间 = 通知中心）========
  var tz = h("div");
  tz.id = "ios-topzone";
  document.body.appendChild(tz);
  var sheets = {}, sheetOpen = null;
  function sheet(kind) {
    if (sheets[kind]) return sheets[kind];
    var el = h("div", "ios-sheet ios-" + kind, '<div class="ios-sheet-bg"></div><div class="ios-sheet-in"></div>');
    el.hidden = true;
    document.body.appendChild(el);
    var inner = el.lastChild;
    if (kind === "cc") buildCC(inner); else buildNC(inner);
    // 往上划、点空白：收起
    var g = null;
    el.addEventListener("pointerdown", function (e) {
      if (e.target.closest(".ios-cc-slider, .ios-nc-list .ios-note, button")) return;
      g = { y0: e.clientY, x0: e.clientX, t0: now() };
    });
    el.addEventListener("pointermove", function (e) { if (g && g.y0 - e.clientY > 0) setSheetP(kind, clamp(1 - (g.y0 - e.clientY) / 320, 0, 1)); });
    el.addEventListener("pointercancel", function () { if (g) { g = null; setSheetP(kind, 1); } });
    el.addEventListener("pointerup", function (e) {
      if (!g) return;
      var up = g.y0 - e.clientY, dt = now() - g.t0;
      g = null;
      if (up > 50 || up > 20 && up / dt > 0.4) return closeSheets();
      if (Math.abs(up) < 8 && !e.target.closest(".ios-cc-m, .ios-note, .ios-nc-head")) return closeSheets();
      setSheetP(kind, 1);
    });
    sheets[kind] = el;
    return el;
  }
  function setSheetP(kind, p) {
    var el = sheets[kind];
    if (!el) return;
    el.style.transition = "none";
    el.firstChild.style.opacity = String(p);
    el.lastChild.style.opacity = String(p);
    el.lastChild.style.transform = kind === "cc" ? "translateY(" + (-40 * (1 - p)) + "px) scale(" + (0.9 + 0.1 * p) + ")" : "translateY(" + (-Hv() * 0.35 * (1 - p)) + "px)";
  }
  function openSheet(kind, p) {
    if (swOn) return;
    closeMenu(true);
    if (sheetOpen && sheetOpen !== kind) closeSheets(true);
    var el = sheet(kind);
    if (kind === "cc") syncCC(); else renderNC();
    el.hidden = false;
    sheetOpen = kind;
    blurInput();
    if (p != null) return setSheetP(kind, p);
    setSheetP(kind, sheetP(kind));
    void el.offsetWidth;
    animateSheet(kind, 1);
  }
  function sheetP(kind) { var el = sheets[kind]; return el && !el.hidden ? parseFloat(el.lastChild.style.opacity || "0") : 0; }
  function animateSheet(kind, to, done) {
    var from = sheetP(kind);
    if (reduced) { setSheetP(kind, to); if (done) done(); return; }
    tween(to ? 380 : 240, function (k) { setSheetP(kind, from + (to - from) * k); }, done);
  }
  function closeSheets(quick) {
    var kind = sheetOpen;
    if (!kind) return;
    sheetOpen = null;
    var el = sheets[kind];
    if (quick) { el.hidden = true; setSheetP(kind, 0); return; }
    animateSheet(kind, 0, function () { if (sheetOpen !== kind) el.hidden = true; });
  }
  var tg = null;
  tz.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    try { tz.setPointerCapture(e.pointerId); } catch (x) { /* 已经松开 */ }
    tg = { y0: e.clientY, t0: now(), kind: e.clientX > Wv() * 0.6 ? "cc" : "nc", moved: false };
  });
  tz.addEventListener("pointermove", function (e) {
    if (!tg) return;
    var dy = e.clientY - tg.y0;
    if (!tg.moved && dy > 6) { tg.moved = true; openSheet(tg.kind, 0); }
    if (tg.moved) setSheetP(tg.kind, clamp(dy / 300, 0, 1));
  });
  tz.addEventListener("pointerup", function (e) {
    if (!tg) return;
    var g = tg, dy = e.clientY - g.y0, v = dy / Math.max(1, now() - g.t0);
    tg = null;
    if (!g.moved) return openSheet(g.kind); // 点状态栏右边 / 左边也能打开（用鼠标时方便）
    if (dy > 90 || v > 0.45) animateSheet(g.kind, 1); else { sheetOpen = g.kind; closeSheets(); }
  });
  tz.addEventListener("pointercancel", function () { if (tg && tg.moved) { sheetOpen = tg.kind; closeSheets(); } tg = null; });

  // ---- 控制中心：外观（深色模式，长按选自动）、专注（勿扰）、设置、墙纸、文字大小、全屏幕（浏览器支持时）----
  var fsOK = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  function buildCC(inner) {
    inner.innerHTML = '<div class="ios-cc-grid">' +
      '<button class="ios-cc-m ios-cc-w2" data-cc="focus" type="button"><span class="ios-cc-ic">' + IC.moon + '</span><span><b>专注</b><small></small></span></button>' +
      '<button class="ios-cc-m ios-cc-c" data-cc="dark" type="button" aria-label="深色模式">' + IC.dark + "</button>" +
      '<button class="ios-cc-m ios-cc-c" data-cc="settings" type="button" aria-label="设置">' + IC.gear + "</button>" +
      '<button class="ios-cc-m ios-cc-wall" data-cc="wall" type="button"><b>墙纸</b><small></small></button>' +
      '<div class="ios-cc-m ios-cc-slider" data-cc="font" role="slider" aria-label="文字大小" aria-valuemin="11" aria-valuemax="18"><i></i><span><small>A</small>A</span></div>' +
      (fsOK ? '<button class="ios-cc-m ios-cc-c" data-cc="full" type="button" aria-label="全屏幕">' + IC.full + "</button>" : "") + "</div>";
    var darkBtn = inner.querySelector('[data-cc="dark"]'), dT = 0, dLong = false;
    darkBtn.addEventListener("pointerdown", function () { dLong = false; clearTimeout(dT); dT = setTimeout(function () { dLong = true; themeMenu(darkBtn); }, 480); });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (t) { darkBtn.addEventListener(t, function () { clearTimeout(dT); }); });
    inner.addEventListener("click", function (e) {
      var b = e.target.closest("[data-cc]");
      if (!b) return;
      var k = b.dataset.cc, set = D.settings;
      if (k === "focus") set.set("focus", !set.get("focus"));
      if (k === "dark" && !dLong) set.set("theme", root.classList.contains("light") ? "dark" : "light");
      if (k === "settings") { closeSheets(true); intent = { app: "settings", rect: null, t: now() }; D.launch("settings"); }
      if (k === "wall") wallMenu(b);
      if (k === "full") { var d = document; if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d); else (root.requestFullscreen || root.webkitRequestFullscreen).call(root); }
      syncCC();
    });
    // 文字大小：竖着的滑块，按住上下拖
    var sl = inner.querySelector(".ios-cc-slider"), sg = null;
    var setFrom = function (y) { var r = sl.getBoundingClientRect(), p = clamp((r.bottom - y) / r.height, 0, 1), v = Math.round(11 + p * 7); if (v !== D.settings.get("fontSize")) D.settings.set("fontSize", v); syncCC(); };
    sl.addEventListener("pointerdown", function (e) { e.preventDefault(); try { sl.setPointerCapture(e.pointerId); } catch (x) { /* 已经松开 */ } sg = true; setFrom(e.clientY); });
    sl.addEventListener("pointermove", function (e) { if (sg) setFrom(e.clientY); });
    sl.addEventListener("pointerup", function () { sg = null; });
    sl.addEventListener("pointercancel", function () { sg = null; });
  }
  function themeMenu(anchor) {
    var cur = D.settings.get("theme");
    iosMenu([["auto", "自动"], ["light", "浅色"], ["dark", "深色"]].map(function (x) { return { label: x[1], checked: cur === x[0], run: function () { D.settings.set("theme", x[0]); syncCC(); } }; }), { el: anchor });
  }
  function wallMenu(anchor) {
    var cur = D.settings.get("wallpaper"), btns = document.querySelectorAll('#settings [data-set="wall"] button');
    var items = Array.prototype.filter.call(btns, function (b) { return !b.hidden; }).map(function (b) {
      return { label: (b.querySelector("span") || b).textContent, checked: b.dataset.v === cur, run: function () { D.settings.set("wallpaper", b.dataset.v); syncWall(); syncCC(); } };
    });
    iosMenu(items, { el: anchor });
  }
  function syncCC() {
    var el = sheets.cc;
    if (!el) return;
    var set = D.settings, focus = !!set.get("focus"), font = +set.get("fontSize") || 13;
    var q = function (k) { return el.querySelector('[data-cc="' + k + '"]'); };
    q("focus").classList.toggle("on", focus);
    q("focus").querySelector("small").textContent = focus ? "勿扰模式" : "关闭";
    q("dark").classList.toggle("on", !root.classList.contains("light"));
    q("dark").setAttribute("aria-pressed", String(!root.classList.contains("light")));
    var sl = q("font");
    sl.style.setProperty("--p", ((font - 11) / 7 * 88 + 12) + "%");
    sl.setAttribute("aria-valuenow", String(font));
    var wid = set.get("wallpaper"), wb = document.querySelector('#settings [data-set="wall"] [data-v="' + wid + '"]');
    q("wall").style.backgroundImage = 'url("img/wall-' + wid + '.webp")';
    q("wall").querySelector("small").textContent = wb ? (wb.querySelector("span") || wb).textContent : "";
    if (q("full")) q("full").classList.toggle("on", !!(document.fullscreenElement || document.webkitFullscreenElement));
  }
  document.addEventListener("tsu-theme", syncCC);
  document.addEventListener("fullscreenchange", syncCC);

  // ======== 通知：横幅 + 通知中心。desk.js 照样记着（TSU_DESK.notifications()），这里只是换成 iOS 的样子 ========
  var bannersEl = h("div");
  bannersEl.id = "ios-banners";
  document.body.appendChild(bannersEl);
  var noteRec = {}, ncHidden = store.get("tsu-ios-nc-hidden", []);
  var when = function (t) {
    var s = (Date.now() - t) / 1000, d = new Date(t);
    if (s < 60) return "现在";
    if (s < 3600) return Math.floor(s / 60) + "分钟前";
    if (new Date().toDateString() === d.toDateString()) return two(d.getHours()) + ":" + two(d.getMinutes());
    return (d.getMonth() + 1) + "月" + d.getDate() + "日";
  };
  function noteCard(n) {
    var c = h("div", "ios-note", '<span class="ibox" style="--s:0.76">' + (n.appId ? iconOf(D.apps[n.appId] ? D.apps[n.appId].app : n.appId) : SYS_ICON) + "</span>" +
      '<div class="ios-note-txt"><div class="ios-note-top"><b></b><time></time></div><div class="ios-note-body"></div></div>');
    c.querySelector("b").textContent = n.title || n.name || "";
    c.querySelector("time").textContent = when(n.t);
    var body = n.title && n.body ? n.body : n.title ? "" : n.body;
    if (body) c.querySelector(".ios-note-body").textContent = body; else c.querySelector(".ios-note-body").remove();
    c.dataset.note = n.id;
    return c;
  }
  // 别的设备上处理了（desk.js 收回了那条）：横幅、通知中心里的也去掉
  document.addEventListener("tsu-note-gone", function (e) {
    var ids = (e.detail && e.detail.ids) || [];
    bannersEl.querySelectorAll(".ios-note").forEach(function (c) { if (ids.indexOf(+c.dataset.note) >= 0) c.remove(); });
    if (sheetOpen === "nc") renderNC();
  });
  function hideNote(id) { if (ncHidden.indexOf(id) < 0) { ncHidden = ncHidden.concat([id]).slice(-200); store.set("tsu-ios-nc-hidden", ncHidden); } }
  // 点一条通知：App 从这条通知放大出来，再做 App 自己要做的事（onClick）
  function activateNote(n, fromEl) {
    var rec = noteRec[n.id], w = D.apps[n.appId], r = fromEl ? fromEl.getBoundingClientRect() : null;
    closeSheets(true);
    if (w) {
      intent = { app: w.app, rect: r ? { left: r.left + 12, top: r.top + 12, width: 38, height: 38 } : null, t: now(), strict: true };
      if (w.state === "min" || w.state === "closed") w.show(); else if (w === fg) intent = null; else { bringUp(w, { rect: intent.rect }); }
    }
    if (rec) { if (rec.onClick) { try { rec.onClick(); } catch (err) { console.error(err); } } if (rec.close) rec.close(); }
    hideNote(n.id);
    if (sheetOpen === "nc") renderNC();
  }
  function banner(n) {
    var c = noteCard(n), timer = 0, g = null;
    var dismiss = function () { clearTimeout(timer); if (c.classList.contains("out")) return; c.classList.add("out"); setTimeout(function () { c.remove(); }, 300); };
    bannersEl.querySelectorAll(".ios-note").forEach(function (x) { x.remove(); }); // iOS 一次一条：新的顶掉旧的
    bannersEl.appendChild(c);
    if (!n.sticky) timer = setTimeout(dismiss, 5000); // 设置 › 通知里选了「提醒」的 App：横幅一直留着（同 iOS 的「持续」），上滑或点它才走
    c.addEventListener("pointerdown", function (e) { g = { y0: e.clientY, t0: now() }; clearTimeout(timer); try { c.setPointerCapture(e.pointerId); } catch (x) { /* 已经松开 */ } });
    c.addEventListener("pointermove", function (e) { if (g) c.style.transform = "translateY(" + Math.min(0, e.clientY - g.y0) + "px)"; });
    c.addEventListener("pointerup", function (e) {
      if (!g) return;
      var dy = e.clientY - g.y0;
      g = null;
      c.style.transform = "";
      if (dy < -24) return dismiss();
      if (Math.abs(dy) < 8) { dismiss(); return activateNote(n, c); }
      if (!n.sticky) timer = setTimeout(dismiss, 3000);
    });
  }
  function buildNC(inner) {
    inner.className += " ios-nc-in";
    inner.innerHTML = '<div class="ios-nc-date"></div><div class="ios-nc-time"></div><div class="ios-nc-head"><span>通知中心</span><button class="ios-nc-x" type="button" aria-label="清除">' + IC.xmark.replace("<svg", '<svg width="12" height="12"') + '</button></div><div class="ios-nc-list"></div>';
    var x = inner.querySelector(".ios-nc-x");
    x.addEventListener("click", function () {
      if (!x.classList.contains("arm")) { x.classList.add("arm"); x.textContent = "清除"; return; } // 同 iOS：先变成「清除」，再点一下才清
      D.notifications().forEach(function (n) { var rec = noteRec[n.id]; if (rec && rec.close) rec.close(); hideNote(n.id); });
      renderNC();
    });
    inner.querySelector(".ios-nc-list").addEventListener("click", function (e) {
      var c = e.target.closest(".ios-note");
      if (!c) return;
      var n = D.notifications().find(function (x2) { return String(x2.id) === c.dataset.id; });
      if (n) activateNote(n, c);
    });
  }
  var DAYS = "日一二三四五六";
  function renderNC() {
    var el = sheets.nc;
    if (!el) return;
    var d = new Date(), x = el.querySelector(".ios-nc-x");
    el.querySelector(".ios-nc-date").textContent = (d.getMonth() + 1) + "月" + d.getDate() + "日 星期" + DAYS[d.getDay()];
    el.querySelector(".ios-nc-time").textContent = two(d.getHours()) + ":" + two(d.getMinutes());
    x.classList.remove("arm");
    x.innerHTML = IC.xmark.replace("<svg", '<svg width="12" height="12"');
    var list = el.querySelector(".ios-nc-list"), notes = D.notifications().filter(function (n) { return ncHidden.indexOf(n.id) < 0; });
    list.textContent = "";
    x.hidden = !notes.length;
    if (!notes.length) { list.innerHTML = '<div class="ios-nc-empty">没有旧通知</div>'; list.style.touchAction = "none"; return; }
    notes.forEach(function (n) { var c = noteCard(n); c.dataset.id = n.id; list.appendChild(c); });
    list.style.touchAction = list.scrollHeight > list.clientHeight + 2 ? "pan-y" : "none"; // 放得下就不用滚：往上划 = 收起
  }

  // ======== 聚焦搜索：App（按名字）与 agent（在终端里接上它）========
  function openSpot() {
    if (document.getElementById("ios-spot")) return;
    var ov = h("div", null, '<div class="ios-spot-bar"><label class="ios-spot-field">' + IC.search + '<input type="search" placeholder="搜索" enterkeyhint="go" autocomplete="off" autocapitalize="off" spellcheck="false"></label>' +
      '<button class="ios-spot-cancel" type="button">取消</button></div><div class="ios-spot-list"></div>');
    ov.id = "ios-spot";
    document.body.appendChild(ov);
    var inp = ov.querySelector("input"), list = ov.querySelector(".ios-spot-list");
    var close = function () { ov.remove(); };
    ov.querySelector(".ios-spot-cancel").addEventListener("click", close);
    function render() {
      var q = inp.value.trim().toLowerCase(), apps = homeApps().filter(function (a) { return !q || nameOf(a.id, a.name).toLowerCase().indexOf(q) >= 0 || a.name.toLowerCase().indexOf(q) >= 0 || a.id.indexOf(q) >= 0; });
      var A = window.TSU_AGENTS, ags = A && A.list ? A.list().filter(function (a) { return q && a.name.toLowerCase().indexOf(q) >= 0; }).slice(0, 6) : [];
      list.textContent = "";
      if (apps.length) {
        list.appendChild(h("div", "ios-spot-h", q ? "App" : "Siri 建议"));
        var g = h("div", "ios-spot-apps");
        apps.slice(0, q ? 8 : 8).forEach(function (a) { g.appendChild(appButton(a, true)); });
        list.appendChild(g);
      }
      if (ags.length) {
        list.appendChild(h("div", "ios-spot-h", "Agent"));
        var rows = h("div", "ios-spot-rows");
        ags.forEach(function (a) {
          var b = h("button", "ios-spot-row", '<span class="ibox" style="--s:0.64">' + iconOf("win") + '</span><span><span class="ios-spot-name"></span><small>在终端中打开</small></span>');
          b.type = "button";
          b.querySelector(".ios-spot-name").textContent = a.name;
          b.addEventListener("click", function () { var r = b.querySelector(".ibox").getBoundingClientRect(); close(); intent = { app: "win", rect: r, icon: null, t: now(), strict: true }; if (window.TSU_TERM) TSU_TERM.agent(a.id); });
          rows.appendChild(b);
        });
        list.appendChild(rows);
      }
      if (!apps.length && !ags.length) list.innerHTML = '<div class="ios-spot-none">没有结果</div>';
    }
    inp.addEventListener("input", render);
    inp.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); if (e.key === "Enter") { var b = list.querySelector(".ios-app, .ios-spot-row"); if (b) b.click(); } });
    list.addEventListener("click", function (e) { var b = e.target.closest(".ios-app"); if (b) { var ib = b.querySelector(".ibox"), r = ib.getBoundingClientRect(); close(); intent = { app: b.dataset.app, rect: r, icon: ib, t: now() }; D.launch(b.dataset.app); } });
    render();
    setTimeout(function () { inp.focus(); }, 30);
  }

  // ======== 键盘：visualViewport 量出键盘多高，前台 App 缩到键盘上面（CSS 变量 --ios-vvh / --ios-vvt / --ios-kb）========
  var vv = window.visualViewport, kb = { up: false, height: 0 };
  function syncVV() {
    var H = Hv(), vh = vv ? vv.height : H, vt = vv ? vv.offsetTop : 0, k = Math.max(0, Math.round(H - vh - vt)), up = k > 90 && (!vv || vv.scale < 1.02);
    root.style.setProperty("--ios-vvh", vh + "px");
    root.style.setProperty("--ios-vvt", vt + "px");
    root.style.setProperty("--ios-kb", k + "px");
    if (up !== kb.up || k !== kb.height) { kb = { up: up, height: k, top: vt, vh: vh }; root.classList.toggle("ios-kb-up", up); emit("kb", kb); }
  }
  if (vv) { vv.addEventListener("resize", syncVV); vv.addEventListener("scroll", syncVV); }
  window.addEventListener("resize", function () { syncVV(); if (sw) paintCards(); });
  // iOS 把聚焦的输入框滚进视野时会挪整页：键盘收起后挪回来
  window.addEventListener("scroll", function () { if (!kb.up && (window.scrollX || window.scrollY)) window.scrollTo(0, 0); });
  syncVV();

  // ======== TSU_DESK：同名接口换成 iOS 的做法（照旧每个都包 try/catch：这边出错不连累调用的 App）========
  function wrap(name, fn) {
    var old = D[name];
    D[name] = function () { try { return fn.apply(this, [old].concat(Array.prototype.slice.call(arguments))); } catch (err) { console.error("TSU_DESK." + name + "（iOS）出错：", err); } };
  }
  wrap("popup", function (old, items, at) { return iosMenu(items || [], at || null, { dim: !!(at && (at.x != null || at.above)) }); });
  wrap("closeMenus", function (old) { closeMenu(); return old && old(); });
  wrap("notify", function (old, o) {
    o = o || {};
    var res = old(o);
    if (res && res.id != null) {
      noteRec[res.id] = { close: res.close, onClick: o.onClick };
      var n = (D.notifications() || []).find(function (x) { return x.id === res.id; });
      if (n && !D.settings.get("focus") && sheetOpen !== "nc") banner(n);
      if (sheetOpen === "nc") renderNC();
    }
    return res;
  });
  wrap("controlCenter", function () { if (sheetOpen === "cc") closeSheets(); else openSheet("cc"); });
  wrap("notificationCenter", function () { if (sheetOpen === "nc") closeSheets(); else openSheet("nc"); });
  wrap("missionControl", function () { if (swOn) closeSwitcher(null); else openSwitcher(); });
  wrap("launchpad", function () { goHome(); pagesEl.scrollTo({ left: pagesEl.scrollWidth, behavior: reduced ? "auto" : "smooth" }); });
  wrap("showDesktop", function () { goHome(); });
  wrap("stageManager", function () {});
  wrap("area", function () { var ins = inset(), W = Wv(), H = Hv(); return { top: ins.top, bottom: H - ins.bottom, left: 0, right: W, width: W, height: H - ins.top - ins.bottom }; });
  wrap("createWindow", function (old, opts) { var w = old(opts); if (w) decorate(w); return w; });

  // ======== 开机：窗口先都在后台；上次在哪个 App 就回到哪个（第一次来是主屏幕）========
  allWins().forEach(decorate);
  var saved = store.get("tsu-ios-fg", null);
  if (saved && D.apps[saved] && isOpen(D.apps[saved])) { fg = D.apps[saved]; touch(fg); }
  paint();
  function endBoot() {
    if (!booting) return;
    booting = false;
    var w = saved && D.apps[saved];
    if (!fg && w && isOpen(w) && w.state !== "min") bringUp(w, { anim: false });
    renderHome();
  }
  if (document.readyState === "complete") setTimeout(endBoot, 900); else window.addEventListener("load", function () { setTimeout(endBoot, 900); });

  window.TSU_IOS = {
    sim: sim,
    fg: function () { return fg; },
    home: function () { goHome(); },
    open: function (w, o) { bringUp(w, o); },
    switcher: function () { openSwitcher(); },
    menu: function (items, at, o) { return iosMenu(items, at, o); },
    closeMenu: function () { closeMenu(); },
    appMenu: function (w, anchor) { appMenu(w, anchor); },
    menuFilter: function (fn) { if (typeof fn === "function") menuFilters.push(fn); },
    navButton: function (w, o) { decorate(w); return navButton(w, o); },
    inset: inset,
    keyboard: function () { return kb; },
    on: on,
    icons: IC,
  };
})();
