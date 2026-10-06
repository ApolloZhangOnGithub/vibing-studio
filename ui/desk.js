// desk.js —— 博客页的“桌面”：墙纸（太浩湖航拍 / The Lake）、菜单栏（App 菜单、子菜单、键盘操作）、控制中心、通知（横幅 + 通知中心）、
// 窗口（标题栏拖动、四边四角拉大小、双击标题栏缩放、红灯关、黄灯收进 Dock、绿灯全屏、点一下到最前）、Dock（拖动排序、拖出移除、右键菜单）、
// 应用注册表（访达的「应用程序」、启动台都从这里取）、启动台、调度中心与多个桌面（空间）、设置 App。
// 终端窗口里的内容归 live.js（它盯着屏幕尺寸，窗口一变就按新列数重排）。手机上没有桌面，终端窗口铺满
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var root = document.documentElement, desk = $("desktop"), menubar = $("menubar"), dock = $("dock"), clock = $("clock"), wall = $("wall");
  // 窗口都放在自己的一层（#wins，z-index 2，在菜单栏、Dock、调度中心下面）：层里按「最近点过的在最上面」排（同 macOS），见 restack
  var winLayer = document.createElement("div");
  winLayer.id = "wins";
  desk.insertBefore(winLayer, wall ? wall.nextSibling : desk.firstChild);
  Array.prototype.slice.call(desk.querySelectorAll(":scope > .win")).forEach(function (el) { winLayer.appendChild(el); });
  var mobile = function () { return root.classList.contains("ios") || matchMedia("(max-width: 600px)").matches; }; // 手机（ios/shell.js 在 <html> 上标 ios：横过来、?ios=1 也算）
  var store = { // localStorage 里的 JSON（取不到 / 坏了就用默认值）
    get: function (k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  // 进场动画放完就摘掉：最终样子不依赖动画真的跑完（后台标签页、屏幕外的 WebView 里动画可能停在第一帧）
  var settle = function (el, ms) { el.classList.remove("settled"); setTimeout(function () { el.classList.add("settled"); }, ms || 450); };
  // 液态玻璃的边缘折射要 backdrop-filter: url(#lg)，目前只有 Chromium 支持；其余浏览器只用模糊 + 高光
  if (window.chrome && CSS.supports("backdrop-filter", "url(#lg-bar)")) root.classList.add("refract");

  // ---- 菜单栏时钟：同 macOS 中文格式「9月25日 周五  22:50:07」（显示秒）----
  // 用对齐到整秒的 setTimeout 链而不是 setInterval：后者会慢慢漂，秒数偶尔跳一格；字没变就不写 DOM
  var DAYS = "日一二三四五六", two = function (n) { return String(n).padStart(2, "0"); }, lastClock = "";
  function tick() {
    var d = new Date(), s = (d.getMonth() + 1) + "月" + d.getDate() + "日 周" + DAYS[d.getDay()] + " " + two(d.getHours()) + ":" + two(d.getMinutes()) + ":" + two(d.getSeconds());
    if (s !== lastClock) clock.textContent = lastClock = s;
    setTimeout(tick, 1005 - Date.now() % 1000);
  }
  tick();

  // ---- 墙纸：单独的选择，不跟深浅外观走（同 macOS）。仓库里只放可以公开分发的图（CC0：翡翠湾、太浩湖黄昏）；
  // Apple 的墙纸（太浩湖航拍、The Lake）只在本地（.gitignore），能取到就多出这几个选项并默认用它们，线上取不到就只剩公开的
  var WALLS = { "pub-emerald": { still: "pub-emerald.webp" }, "pub-sunset": { still: "pub-sunset.webp" } };
  var LOCAL = { "tahoe-day": { still: "tahoe-day.jpg", video: "tahoe-day.mp4" }, "tahoe-night": { still: "tahoe-night.jpg", video: "tahoe-night.mp4" },
    "lake-day": { still: "lake-day.jpg" }, "lake-night": { still: "lake-night.jpg" } };
  var WALL_NAMES = { "tahoe-day": "太浩湖白天", "tahoe-night": "太浩湖夜晚", "lake-day": "The Lake 白天", "lake-night": "The Lake 夜晚", "pub-emerald": "翡翠湾", "pub-sunset": "太浩湖黄昏" };
  var prefs = { wall: localStorage.getItem("tsu-wall") || "tahoe-day", motion: localStorage.getItem("tsu-motion") !== "off" };
  if (matchMedia("(prefers-reduced-motion: reduce)").matches && !localStorage.getItem("tsu-motion")) prefs.motion = false;
  var curWall = function () { return WALLS[prefs.wall] ? prefs.wall : "pub-emerald"; }; // 选的是本地才有的墙纸而这里取不到时，实际用的是翡翠湾
  // 视频墙纸最费：解码 + 整屏合成 + 菜单栏 / Dock 的玻璃每帧重算。页面在后台、或有窗口全屏把桌面整个盖住时停下
  var wallCovered = function () { return document.hidden || Object.keys(apps).some(function (k) { return apps[k].state === "full"; }); };
  function applyWall() {
    if (mobile()) return;
    var w = WALLS[curWall()], bg = "url(" + w.still + ")";
    if (desk.style.backgroundImage.indexOf(w.still) < 0) desk.style.backgroundImage = bg;
    var video = w.video && prefs.motion ? w.video : "";
    if (!video) { wall.classList.remove("on"); if (!wall.paused) wall.pause(); return; }
    if (!wall.src.endsWith(video)) {
      wall.classList.remove("on");
      wall.poster = w.still;
      wall.src = video;
      wall.oncanplay = function () { wall.classList.add("on"); };
    }
    if (wallCovered()) { if (!wall.paused) wall.pause(); } else if (wall.paused) wall.play().catch(function () {});
  }
  document.addEventListener("visibilitychange", function () { applyWall(); });
  // 本地的 Apple 墙纸：探一下能不能取到，取到了就加进可选、显示对应的缩略图（Vibing Studio 的页面里没有这个桌面：不探，省得每次启动白发 4 个请求）
  if (!document.documentElement.classList.contains("termapp")) Object.keys(LOCAL).forEach(function (k) {
    var probe = new Image();
    probe.onload = function () {
      WALLS[k] = LOCAL[k];
      var b = document.querySelector('#settings [data-v="' + k + '"]');
      if (b) b.hidden = false;
      if (prefs.wall === k) applyWall();
      syncSettings();
    };
    probe.src = LOCAL[k].still;
  });

  // ---- 桌面设置（系统设置 →「桌面与程序坞」）：存在 localStorage 的 tsu-desk 里；对外 TSU_DESK.settings.get / set / on("change") ----
  var SET_DEFAULTS = { dockSize: 50, dockMagnify: 0, dockPosition: "bottom", minimizeEffect: "genie", titleDblClick: "zoom", minimizeToApp: false,
    dockAutohide: false, dockBounce: true, dockIndicators: true, dockRecents: false, clickWallpaper: "stage", stageManager: false, stageRecents: true, stageWindows: "all" };
  var SET_CHOICES = { dockPosition: ["left", "bottom", "right"], minimizeEffect: ["genie", "scale"], titleDblClick: ["zoom", "minimize", "none"], clickWallpaper: ["always", "stage"], stageWindows: ["all", "one"] };
  var SET_RANGE = { dockSize: [32, 80], dockMagnify: [0, 1] };
  var dset = Object.assign({}, SET_DEFAULTS, store.get("tsu-desk", {}));
  // 程序坞的样子可以被临时盖掉（不写进设置）：Vibing Studio 的 macOS 风格有自己的一套（macDock、macDockSize……），见 TSU_DESK.dockOverride
  var dockOv = null, dk = function (k) { return dockOv && k in dockOv ? dockOv[k] : dset[k]; };

  // ======== 窗口 ========
  // 能放窗口的地方：菜单栏以下，让开 Dock（Dock 在左 / 右 / 下；自动隐藏时不让）
  var area = function () {
    var vw = window.innerWidth, vh = window.innerHeight, top = menubar.offsetHeight, left = 0, right = vw, bottom = vh - 8;
    if (!dk("dockAutohide")) {
      if (dk("dockPosition") === "left") left = dock.offsetLeft + dock.offsetWidth + 8;
      else if (dk("dockPosition") === "right") right = dock.offsetLeft - 8;
      else bottom = vh - dock.offsetHeight - 16;
    }
    return { top: top, bottom: bottom, left: left, right: right, width: right - left, height: bottom - top };
  };
  var apps = {}, frontWin = null, order = [], winPanels = []; // winPanels：属于某个窗口的浮动面板 { el, owner }（访达的快速查看）
  // 刷新不丢窗口（同 macOS「重新登录时重新打开窗口」）：开着的窗口、位置大小、最小化 / 缩放、在哪个桌面、叠放先后都记在 tsu-session
  var SESSION_KEY = "tsu-session", lastSession = store.get(SESSION_KEY, null), restoring = true, sessSig = "", holds = [];
  // 多个桌面（空间）：每个窗口记着自己在第几个桌面；别的桌面的窗口藏起来（.elsewhere）。存 { n 桌面数, cur 当前, map 窗口 → 桌面 }
  var spaceSaved = store.get("tsu-spaces", {}) || {};
  var busyMsg = {}, closeHooks = {}; // setBusy：窗口里有活在跑（红灯中间一个点，关之前先问）；onBeforeClose：关之前 App 自己的处理（可以拦下）
  var spaceN = Math.max(1, Math.min(16, spaceSaved.n || 1)), curSpace = Math.max(0, Math.min(spaceN - 1, spaceSaved.cur || 0));
  var NO_DRAG = "i, button, input, label, select, textarea, [data-no-drag]";
  // Vibing Studio 的 macOS 风格（macos.js 的 TSU_MACOS，只在 html.st-macos 时）：App 的开 / 切换、菜单栏的 App 名和几个菜单交给它
  var mac = function () { var M = window.TSU_MACOS; return M && M.on && M.on() ? M : null; };
  function Win(el, name, initial) {
    var self = this;
    this.el = el;
    this.name = name;
    this.app = el.dataset.appId || el.id; // 属于哪个 App（= Dock 图标的 id）：一个 App 可以有好几个窗口（终端、访达）
    this.bar = el.querySelector(".bar");
    this.initial = initial;
    this.state = el.classList.contains("closed") ? "closed" : "normal"; // normal | zoom | full | min | closed
    this.saved = null;
    this.space = Math.min(spaceN - 1, +((spaceSaved.map || {})[el.id]) || 0);
    el.classList.toggle("elsewhere", this.space !== curSpace);
    el.classList.toggle("busy", !!busyMsg[el.id]);
    apps[el.id] = this;
    this.restoreRec = lastSession && lastSession.wins ? lastSession.wins[el.id] || null : null; // 上次开着：第一次 show 的时候照它摆
    // 页面里本来就开着的窗口（终端）：上次是关着的，这次也别开
    if (restoring && lastSession && lastSession.wins && !mobile() && this.state !== "closed" && !this.restoreRec) { this.state = "closed"; el.classList.add("closed"); }
    if (!mobile() && this.state !== "closed") this.place(this.restoreRec && this.restoreRec.r ? recRect(this.restoreRec) : initial());

    // 点一下到最前，菜单栏的 App 名跟着换（点进来的那一下自己会给焦点，不用再挪）
    el.addEventListener("pointerdown", function () { self.front(true); }, true);
    // 记住这个窗口里最后拿着键盘焦点的是谁：窗口再到前面时（Dock、切换、关掉上面的窗口）焦点回到这里
    el.addEventListener("focusin", function (e) { self.lastFocus = e.target; });
    // 标题栏拖动（不含三个灯和按钮）
    this.bar.addEventListener("pointerdown", function (e) {
      if (mobile() || e.button !== 0 || e.target.closest(NO_DRAG) || self.state === "full") return;
      e.preventDefault(); // 按下标题栏不清掉对话里的选区
      // 拖动只改 transform（交给合成器，跟屏幕刷新率走，不重排、不重绘窗口内容），松手再落到 left / top
      var r = self.rect(), x0 = e.clientX, y0 = e.clientY, a = area(), dx = 0, dy = 0, lastX = e.clientX, toStripNow = false;
      el.style.willChange = "transform";
      self.drag(e, self.bar, function (ev) {
        if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 3) return; // 双击时的轻微抖动不算拖动
        if (self.state === "zoom") self.state = "normal"; // 真拖动了才退出缩放（否则第二下双击会又放大一次）
        dx = Math.max(80 - r.width, Math.min(a.width - 80, r.left + ev.clientX - x0)) - r.left;
        dy = Math.max(a.top, Math.min(window.innerHeight - 60, r.top + ev.clientY - y0)) - r.top;
        el.style.transform = "translate3d(" + dx + "px," + dy + "px,0)";
        lastX = ev.clientX;
        // 台前调度：指针拖进左边条 → 条探出来；在这松手 = 把它从台上拿下来（同 macOS）
        var into = stageOn && !mc && self.onStage && lastX < stageGeom().right;
        if (into !== toStripNow) { toStripNow = into; el.classList.toggle("to-strip", into); if (into !== stripPeek) { stripPeek = into; layoutStage(true); } }
      }, function () {
        el.style.willChange = "";
        el.classList.remove("to-strip");
        if (stageOn && toStripNow) { // 下台：位置留在拖之前（以后回到台上还在原处），从松手的地方缩进条里
          el.style.transition = "none";
          void el.offsetWidth;
          return toStrip(self);
        }
        el.style.transform = "";
        el.style.left = r.left + dx + "px";
        el.style.top = r.top + dy + "px";
        if (stageOn) layoutStage(true); // 拖到左边条上 → 条让开
      });
    });
    // 连按标题栏：缩放 / 最小化 / 无操作（系统设置 → 桌面与程序坞）
    this.bar.addEventListener("dblclick", function (e) {
      if (e.target.closest(NO_DRAG)) return;
      if (dset.titleDblClick === "zoom") self.zoom(); else if (dset.titleDblClick === "minimize") self.hide("min");
    });
    // 四边四角拉大小：8 个透明的把手（光标由 CSS 给）。以前是窗口上的 pointermove 每次都 getBoundingClientRect——
    // 终端在流式输出时布局总是脏的，每动一下鼠标都逼浏览器同步重排一次
    ["n", "s", "e", "w", "ne", "nw", "se", "sw"].forEach(function (ed) {
      var h = document.createElement("b");
      h.className = "rs rs-" + ed;
      h.dataset.edge = ed;
      el.appendChild(h);
    });
    el.addEventListener("pointerdown", function (e) {
      var h = e.target.closest && e.target.closest(".rs");
      if (!h || h.parentElement !== el || e.button !== 0 || mobile() || self.state === "full") return;
      e.preventDefault();
      e.stopPropagation();
      if (self.state === "zoom") self.state = "normal";
      var r = self.rect(), x0 = e.clientX, y0 = e.clientY, ed = h.dataset.edge, top = area().top;
      var cs = getComputedStyle(el), minW = parseFloat(cs.minWidth) || 360, minH = parseFloat(cs.minHeight) || 240;
      self.resizing = true;
      self.drag(e, h, function (ev) {
        var dx = ev.clientX - x0, dy = ev.clientY - y0, n = { left: r.left, top: r.top, width: r.width, height: r.height };
        if (ed.indexOf("e") >= 0) n.width = Math.max(minW, r.width + dx);
        if (ed.indexOf("s") >= 0) n.height = Math.max(minH, r.height + dy);
        if (ed.indexOf("w") >= 0) { n.width = Math.max(minW, r.width - dx); n.left = r.left + r.width - n.width; }
        if (ed.indexOf("n") >= 0) { n.height = Math.max(minH, r.height - dy); n.top = Math.max(top, r.top + r.height - n.height); n.height = r.top + r.height - n.top; }
        self.place(n);
      }, function () { self.resizing = false; if (stageOn) layoutStage(true); });
    });
    // 三个灯
    this.bar.addEventListener("click", function (e) {
      var act = e.target.dataset && e.target.dataset.act;
      if (act === "full") return self.state === "full" ? self.exitFull() : self.enterFull();
      if (act === "min") self.hide("min");
      if (act === "close") requestClose(self); // 有活在跑 / App 要先问一句的，先问
    });
  }
  Win.prototype.rect = function () {
    var el = this.el, s = el.style;
    // 在别的桌面（display: none）量不出来：用写在 style 上的位置、大小
    if (!el.offsetWidth && s.width) return { left: parseFloat(s.left) || 0, top: parseFloat(s.top) || 0, width: parseFloat(s.width) || 0, height: parseFloat(s.height) || 0 };
    return { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
  };
  // 放窗口。animate：FLIP——尺寸一步到位（窗口里的内容只重排一次），再用 transform 从旧的位置、大小过渡过去，动画全在合成器上。
  // 以前是对 left/top/width/height 做 0.28s 过渡：每一帧都重排，终端还会跟着每帧按新列数重画整段对话（40 轮对话时一次缩放约 400ms 主线程）
  Win.prototype.place = function (r, animate) {
    var el = this.el, s = el.style, from = animate && !mobile() && this.state !== "closed" ? this.rect() : null;
    el.classList.remove("anim");
    s.left = r.left + "px";
    s.top = r.top + "px";
    s.width = r.width + "px";
    s.height = r.height + "px";
    if (!from || !from.width || !r.width || !r.height) return;
    clearTimeout(this.flipT);
    s.transition = "none";
    s.transformOrigin = "0 0";
    s.transform = "translate(" + (from.left - r.left) + "px," + (from.top - r.top) + "px) scale(" + from.width / r.width + "," + from.height / r.height + ")";
    void el.offsetWidth;
    s.transition = "transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)";
    s.transform = "";
    this.flipT = setTimeout(function () { s.transition = ""; s.transformOrigin = ""; }, 340);
  };
  Win.prototype.stopFlip = function () { var s = this.el.style; clearTimeout(this.flipT); s.transition = ""; s.transformOrigin = ""; s.transform = ""; };
  Win.prototype.drag = function (e, target, move, end) {
    this.el.classList.remove("anim");
    this.stopFlip();
    target.setPointerCapture(e.pointerId);
    function up() {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      if (end) end();
    }
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };
  Win.prototype.front = function (byPointer) {
    // 在别的桌面：先切过去（同 macOS 点 Dock 里别的桌面上的 App）
    if (this.space !== curSpace && this.state !== "closed" && this.state !== "min") switchSpace(this.space);
    if (deskAside) restoreDesk(); // 「显示桌面」挪开的窗口回来
    if (stageOn && !this.onStage && onScreen(this) && !mc) { // 台前调度：它（它那一组）上台，原来台上的进左边条
      var mate = this.stageNew && winsIn(curSpace).filter(function (x) { return x !== this && x.onStage && x.app === this.app; }, this)[0];
      if (mate) { this.stageSet = setOf(mate); this.onStage = true; layoutStage(true); } // 新开的窗口，它的 App 已经在台上：跟着上台
      else bringToStage(this);
    }
    this.stageNew = false;
    // 已经在最前就什么都不做：窗口里每点一下都会走到这里，以前每次都重建一遍菜单栏
    if (frontWin === this && this.el.classList.contains("front")) { if (!byPointer) this.focusIn(); return; }
    Object.keys(apps).forEach(function (k) { apps[k].el.classList.remove("front"); });
    this.el.classList.add("front");
    frontWin = this;
    order = order.filter(function (w) { return w !== this; }, this).concat([this]);
    restack();
    renderMenubar();
    if (!byPointer) this.focusIn();
  };
  // 键盘焦点跟着到前面的窗口走（同 macOS：到前台的 App 拿到键盘）——以前窗口到了前面，打字还进后面那个窗口的输入框
  Win.prototype.focusIn = function () {
    var el = this.el, a = document.activeElement;
    if (a && a !== document.body && el.contains(a)) return;
    if (mobile() || this.state === "min" || this.state === "closed") return;
    var t = this.lastFocus && document.contains(this.lastFocus) && el.contains(this.lastFocus) ? this.lastFocus : null;
    if (!t) t = el.querySelector("textarea:not([disabled]), input:not([disabled]):not([type=hidden]), [contenteditable='true'], [tabindex]:not([tabindex='-1'])");
    try { if (t) t.focus({ preventScroll: true }); else if (a && a.blur && a !== document.body) a.blur(); } catch (e) { /* 拿不到焦点就算了 */ }
  };
  // 窗口的上下：按 order（最近到前面的在最后）排 z-index，同 macOS——点哪个哪个就排到最上面，其余的保持它们原来的先后
  function restack() { order.forEach(function (w, i) { if (!w.inStrip) w.el.style.zIndex = String(10 + i); }); syncPanels(); }
  // 窗口的浮动面板（访达的快速查看）同 macOS：它的 App 在前台时浮在所有窗口上面；别的 App 到了前台先藏起来（不关），回到这个 App 再出来。
  // 什么窗口都没在前面时前台算访达（同菜单栏）。前台一变（front、renderMenubar）就对一遍
  function syncPanels() {
    var act = frontWin ? frontWin.app : "finder";
    winPanels.forEach(function (p, i) { p.el.classList.toggle("deact", p.owner.app !== act); p.el.style.zIndex = String(10 + order.length + i); });
  }
  // 缩放（双击标题栏）：铺满菜单栏与 Dock 之间，再来一次还原
  Win.prototype.zoom = function (quiet) {
    if (mobile()) return;
    if (this.state === "full") return this.exitFull();
    if (this.state === "zoom") { this.state = "normal"; return this.place(this.saved || this.initial(), !quiet); }
    this.saved = this.rect();
    this.state = "zoom";
    var a = area();
    this.place({ left: a.left, top: a.top, width: a.width, height: a.height + 8 }, !quiet);
  };
  // 两种全屏分开（同 macOS）：
  // · 窗口全屏（绿灯）：只在这个桌面里——菜单栏、Dock 让开，窗口铺满桌面；不碰浏览器
  // · 系统全屏（控制中心「全屏幕」、菜单栏「显示 → 进入全屏幕」或 ⌃⌘F）：整个桌面进浏览器的全屏，菜单栏、Dock、窗口照旧
  Win.prototype.enterFull = function () {
    if (this.state === "full") return;
    Object.keys(apps).forEach(function (k) { if (apps[k] !== this && apps[k].state === "full") apps[k].exitFull(); }, this); // 同一时间只有一个全屏窗口
    if (this.state !== "zoom") this.saved = this.rect();
    this.state = "full";
    this.el.classList.add("is-full");
    desk.classList.add("full");
    closeAll();
    this.front();
    this.place({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }, true);
    applyWall();
  };
  Win.prototype.exitFull = function () {
    if (this.state !== "full") return;
    this.state = "normal";
    this.el.classList.remove("is-full");
    desk.classList.remove("full");
    this.place(this.saved || this.initial(), true);
    applyWall();
  };
  Win.prototype.hide = function (how) {
    if (this.state === "full") this.exitFull();
    if (this.state === how) return;
    var el = this.el;
    if (this.inStrip) leaveStrip(this);
    if (how === "min") {
      // 最小化：缩进 Dock——「最小化至应用程序图标」开着就进 App 图标，否则进 Dock 右边自己的一格；效果是「神奇效果」或「缩放」
      this.state = how;
      renderDockExtras();
      var tgt = (!dset.minimizeToApp && dock.querySelector('.min-tile[data-min="' + el.id + '"]')) || dockIcon(this.app) || dock, tr = tgt.getBoundingClientRect(), r = this.rect();
      this.stopFlip();
      el.style.transformOrigin = (tr.left + tr.width / 2 - r.left) + "px " + (tr.top + tr.height / 2 - r.top) + "px";
      el.style.setProperty("--gx", Math.max(0, Math.min(100, (tr.left + tr.width / 2 - r.left) / r.width * 100)).toFixed(1) + "%");
      el.classList.remove("unmin-genie");
      el.classList.toggle("genie", dset.minimizeEffect === "genie");
      settle(el, 650);
    }
    el.classList.add("anim", how);
    this.state = how;
    if (how === "closed" && this.onClose) this.onClose();
    // 前台换成最近用过的、还开着的窗口
    var rest = order.filter(function (w) { return w.state !== "min" && w.state !== "closed" && w.space === curSpace; });
    var still = stageOn ? rest.filter(function (w) { return w.onStage; }) : [];
    if (still.length) rest = still; // 台前调度：台上还有别的窗口，就是它们接着在前面（不换一组上台）
    if (rest.length) rest[rest.length - 1].front(); else { this.el.classList.remove("front"); frontWin = null; renderMenubar(); }
    if (how === "closed") syncRunning(this.app); // 这个 App 还有别的窗口开着，Dock 上的小点就留着
    if (stageOn) layoutStage(true);
    renderDockExtras();
  };
  Win.prototype.show = function () {
    var el = this.el, dockApp = dockIcon(this.app);
    // 新打开 / 从 Dock 还原的窗口放到当前桌面
    if (this.state === "closed" || this.state === "min") { this.space = curSpace; el.classList.remove("elsewhere"); saveSpaces(); }
    el.querySelectorAll("img[data-src]").forEach(function (img) { img.src = img.dataset.src; img.removeAttribute("data-src"); }); // 缩略图打开时才取
    var rec = this.state === "closed" ? this.restoreRec : null;
    this.restoreRec = null;
    if (rec && rec.st === "min") return this.restoreMin(rec);
    if (this.state === "closed") this.place(rec && rec.r ? recRect(rec) : this.initial());
    if (rec && typeof rec.sp === "number" && rec.sp < spaceN) { this.space = rec.sp; el.classList.toggle("elsewhere", this.space !== curSpace); saveSpaces(); }
    if (this.state === "min") {
      // 从 Dock 里那一格（或 App 图标）长出来
      var tgt = (!dset.minimizeToApp && dock.querySelector('.min-tile[data-min="' + el.id + '"]')) || dockIcon(this.app) || dock, tr = tgt.getBoundingClientRect(), r = this.rect();
      el.style.transformOrigin = (tr.left + tr.width / 2 - r.left) + "px " + (tr.top + tr.height / 2 - r.top) + "px";
      if (el.classList.contains("genie")) { el.classList.remove("genie"); el.classList.add("unmin-genie"); settle(el, 520); }
      clearTimeout(this.unminT);
      this.unminT = setTimeout(function () { el.classList.remove("unmin-genie"); el.style.transformOrigin = ""; }, 520);
    }
    void el.offsetWidth;
    el.classList.add("anim");
    el.classList.remove("min", "closed");
    var wasClosed = this.state === "closed";
    this.state = "normal";
    this.stageNew = wasClosed;
    if (wasClosed && dockApp && dset.dockBounce) bounce(dockApp);
    if (dockApp) dockApp.classList.add("running");
    addRecent(this.app);
    if (!rec || rec.sp === undefined || rec.sp === curSpace) this.front();
    renderDockExtras();
    if (rec && rec.st === "zoom") this.zoom(true);
  };
  // 刷新前是最小化的：不开出来，直接在 Dock 里（同 macOS 重新打开窗口）
  Win.prototype.restoreMin = function (rec) {
    var el = this.el, dockApp = dockIcon(this.app);
    if (rec.r) this.place(recRect(rec));
    if (typeof rec.sp === "number" && rec.sp < spaceN) this.space = rec.sp;
    el.classList.toggle("elsewhere", this.space !== curSpace);
    saveSpaces();
    el.classList.remove("anim", "closed", "front", "genie", "unmin-genie");
    el.classList.add("min");
    this.state = "min";
    if (frontWin === this) frontWin = null;
    if (order.indexOf(this) < 0) order.unshift(this);
    if (dockApp) dockApp.classList.add("running");
    renderDockExtras();
    // 缩向 Dock 里自己那一格（同真的最小化）：刷新前后看不见的那个缩小框也在同一个地方
    var tgt = (!dset.minimizeToApp && dock.querySelector('.min-tile[data-min="' + el.id + '"]')) || dockApp || dock, tr = tgt.getBoundingClientRect(), r = this.rect();
    el.style.transformOrigin = (tr.left + tr.width / 2 - r.left) + "px " + (tr.top + tr.height / 2 - r.top) + "px";
  };
  function recRect(rec) { return { left: rec.r[0], top: rec.r[1], width: rec.r[2], height: rec.r[3] }; }
  function dockIcon(id) { return dock.querySelector('[data-app="' + id + '"]'); }
  // 一个 App 的所有窗口（按叠放次序：最后一个在最上面）；开着的 = 没关（最小化的也算）
  function appWins(app) {
    var all = Object.keys(apps).map(function (k) { return apps[k]; }).filter(function (w) { return w.app === app; });
    return all.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
  }
  var isOpenWin = function (w) { return w.state !== "closed"; };
  function syncRunning(app) { var a = dockIcon(app); if (a) a.classList.toggle("running", appWins(app).some(isOpenWin)); }
  // 最近打开的 App（✻ 菜单 →「最近使用的项目」）
  var recent = store.get("tsu-recent", []);
  function addRecent(id) {
    recent = [id].concat(recent.filter(function (x) { return x !== id; })).slice(0, 6);
    store.set("tsu-recent", recent);
  }

  // ======== 菜单：菜单栏下拉、子菜单、右键菜单共用一套 ========
  // 菜单项：{ label, keys, run, disabled, checked, icon（SVG，放在字前面）, items（子菜单：数组或返回数组的函数）, info（只是显示一行字）} 或 { sep: true }
  // 行为同 macOS：点标题打开、开着时指针滑到别的标题就切过去、再点标题或点外面关；按住标题拖到项上松手也能选；
  // ↑↓ 选项、→ 进子菜单 / 下一个菜单、← 退回、回车执行、Esc 关；点禁用的项菜单不关
  function item(label, keys, run, opts) { return Object.assign({ label: label, keys: keys || "", run: run }, opts || {}); }
  var SEP = { sep: true };
  var levels = [], openMenu = null, subTimer = 0, opened = { t: 0, x: 0, y: 0 };
  var TITLES = ".apple, #appname, .menus > span, #menubar .ti[data-m]";
  var usable = function (a) { return a && !a.sep && !a.disabled && !a.info && !a.swatches; };
  function menuBox(items) {
    var box = document.createElement("div");
    box.className = "menu";
    var lv = { el: box, items: items, act: -1, rows: [], parent: -1 };
    items.forEach(function (a, i) {
      var it = document.createElement("div");
      lv.rows.push(it);
      if (a.sep) { it.className = "sep"; box.appendChild(it); return; }
      // 一排色点（同 macOS 访达右键菜单里的标签）：{ swatches: [{ color, on, title, run }] }
      if (a.swatches) {
        it.className = "swatches";
        a.swatches.forEach(function (sw) {
          var b2 = document.createElement("button");
          b2.style.background = sw.color;
          b2.title = sw.title || "";
          if (sw.on) b2.classList.add("on");
          b2.addEventListener("mouseup", function (e) { e.stopPropagation(); closeAll(); if (sw.run) sw.run(); });
          it.appendChild(b2);
        });
        box.appendChild(it);
        return;
      }
      it.className = "item" + (a.disabled ? " disabled" : "") + (a.items ? " sub" : "") + (a.info ? " info" : "");
      it.innerHTML = "<i class=\"ck\"></i><span></span><kbd></kbd>";
      if (a.checked) it.firstChild.textContent = "✓";
      it.children[1].textContent = a.label;
      if (a.icon) { var ic = document.createElement("i"); ic.className = "mi"; ic.innerHTML = a.icon; it.insertBefore(ic, it.children[1]); } // 项前的小图标（同访达右键菜单的「移到废纸篓」「共享…」）
      it.lastChild.textContent = a.items ? "" : a.keys || "";
      it.addEventListener("mouseenter", function () { hover(lv, i); });
      it.addEventListener("mouseup", function (e) {
        // 右键菜单：弹出后同一下松开的那次 mouseup 不算选（菜单就弹在指针下面）
        if (Date.now() - opened.t < 300 && Math.abs(e.clientX - opened.x) + Math.abs(e.clientY - opened.y) < 6) return;
        pick(lv, i);
      });
      box.appendChild(it);
    });
    if (!items.length) { var none = document.createElement("div"); none.className = "item info"; none.innerHTML = "<i class=\"ck\"></i><span>（无）</span><kbd></kbd>"; box.appendChild(none); }
    box.addEventListener("mousedown", function (e) { e.preventDefault(); }); // 点菜单不抢走焦点（「粘贴」之类要回到原来的输入框）
    box.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    box.addEventListener("mouseleave", function () { if (levels[levels.indexOf(lv) + 1] === undefined) setAct(lv, -1); });
    document.body.appendChild(box);
    return lv;
  }
  // 放菜单：贴着屏幕边就往回收（右边放不下往左、下面放不下往上，太长就滚动）；flipX 是放不下时改贴在哪个 x 的左边
  function placeBox(box, x, y, flipX) {
    var w = box.offsetWidth, vw = window.innerWidth, vh = window.innerHeight;
    if (x + w > vw - 4) x = flipX != null ? flipX - w : vw - 4 - w;
    box.style.left = Math.max(4, x) + "px";
    box.style.maxHeight = vh - 8 + "px";
    var h = box.offsetHeight;
    box.style.top = Math.max(4, Math.min(y, vh - 4 - h)) + "px";
  }
  function setAct(lv, i) {
    if (lv.act === i) return;
    if (lv.rows[lv.act]) lv.rows[lv.act].classList.remove("act");
    lv.act = i;
    if (lv.rows[i]) lv.rows[i].classList.add("act");
  }
  function hover(lv, i) {
    var d = levels.indexOf(lv), a = lv.items[i];
    if (d < 0) return;
    clearTimeout(subTimer);
    setAct(lv, usable(a) ? i : -1);
    if (d > 0) setAct(levels[d - 1], lv.parent); // 在子菜单里：父菜单上挂它的那一项保持高亮
    if (levels[d + 1] && levels[d + 1].parent === i) return; // 指回已展开子菜单的那一项
    // 稍等一下再换子菜单：斜着把指针移进子菜单时会擦过别的项，不该一碰就收起
    subTimer = setTimeout(function () {
      closeFrom(d + 1);
      if (usable(a) && a.items) openSub(lv, i);
    }, levels[d + 1] ? 180 : 60);
  }
  function openSub(lv, i) {
    var a = lv.items[i], row = lv.rows[i], r = row.getBoundingClientRect();
    var sub = menuBox(typeof a.items === "function" ? a.items() : a.items);
    sub.parent = i;
    levels.push(sub);
    placeBox(sub.el, r.right + 3, r.top - 5, r.left - 3);
    return sub;
  }
  // 当前高亮项的子菜单：已经开着就用它，否则收起更深的再开
  function ensureSub(lv) {
    var d = levels.indexOf(lv);
    if (levels[d + 1] && levels[d + 1].parent === lv.act) return levels[d + 1];
    closeFrom(d + 1);
    return openSub(lv, lv.act);
  }
  function closeFrom(d) { levels.splice(d).forEach(function (lv) { lv.el.remove(); }); }
  function pick(lv, i) {
    var a = lv.items[i];
    if (!usable(a)) return;
    if (a.items) { clearTimeout(subTimer); setAct(lv, i); ensureSub(lv); return; }
    closeMenu();
    if (a.run) a.run();
  }
  function closeMenu() {
    clearTimeout(subTimer);
    closeFrom(0);
    if (openMenu) openMenu.classList.remove("open");
    openMenu = null;
  }
  function stamp(e) { opened = { t: Date.now(), x: e ? e.clientX : -99, y: e ? e.clientY : -99 }; }
  // 菜单栏上的标题打开下拉菜单
  function openBarMenu(anchor, e) {
    closeMenu();
    closePanel();
    var lv = menuBox(menuFor(anchor)), r = anchor.getBoundingClientRect();
    levels = [lv];
    placeBox(lv.el, anchor.closest(".tray") ? r.right - lv.el.offsetWidth + 6 : r.left - 8, r.bottom + 4);
    openMenu = anchor;
    anchor.classList.add("open");
    stamp(e);
  }
  // 右键菜单 / 别处用的弹出菜单：at = { x, y } 贴在指针处，或 { above: 元素 } 放在元素正上方居中（Dock 图标）
  function popup(items, at, e) {
    closeMenu();
    closePanel();
    var lv = menuBox(items);
    levels = [lv];
    if (at.above) { // Dock 图标的菜单：Dock 在下就放图标上方，在左 / 右就放旁边
      var r = at.above.getBoundingClientRect(), w = lv.el.offsetWidth, h = lv.el.offsetHeight, side = at.side || "bottom";
      if (side === "left") placeBox(lv.el, r.right + 12, r.top + r.height / 2 - h / 2);
      else if (side === "right") placeBox(lv.el, r.left - 12 - w, r.top + r.height / 2 - h / 2);
      else placeBox(lv.el, r.left + r.width / 2 - w / 2, r.top - h - 12);
    }
    else placeBox(lv.el, at.x + 1, at.y + 1);
    stamp(e);
    return lv;
  }
  function moveAct(lv, dir) {
    var n = lv.items.length, i = lv.act;
    for (var k = 0; k < n; k++) { i = (i + dir + n) % n; if (usable(lv.items[i])) return setAct(lv, i); }
  }
  function barTitles() { return Array.prototype.filter.call(menubar.querySelectorAll(".apple, #appname, .menus > span"), function (x) { return x.offsetWidth; }); }
  function switchBar(dir) {
    var list = barTitles(), i = list.indexOf(openMenu);
    if (i < 0) return;
    openBarMenu(list[(i + dir + list.length) % list.length]);
    moveAct(levels[0], 1);
  }
  function menuKey(e) {
    var lv = levels[levels.length - 1];
    e.preventDefault();
    e.stopPropagation(); // 菜单开着时按键不进终端的输入框
    var a = lv.items[lv.act];
    if (e.key === "Escape") closeMenu();
    else if (e.key === "ArrowDown") moveAct(lv, 1);
    else if (e.key === "ArrowUp") moveAct(lv, -1);
    else if (e.key === "ArrowRight") { if (usable(a) && a.items) moveAct(ensureSub(lv), 1); else if (openMenu) switchBar(1); }
    else if (e.key === "ArrowLeft") { if (levels.length > 1) closeFrom(levels.length - 1); else if (openMenu) switchBar(-1); }
    else if (e.key === "Enter" || e.key === " ") { if (usable(a)) { if (a.items) moveAct(ensureSub(lv), 1); else pick(lv, lv.act); } }
  }

  // ---- 菜单栏：跟着最前面的窗口变（每个窗口声明自己的菜单），左边是 ✻ 系统菜单，右边托盘（输入法、Wi‑Fi、电池、控制中心）与时钟 ----
  var menusEl = document.createElement("span");
  menusEl.className = "menus";
  var tray = menubar.querySelector(".tray");
  (function () {
    // 把 index.html 里写死的菜单名换成动态的
    Array.prototype.slice.call(menubar.children).forEach(function (c) { if (c.tagName === "SPAN" && !c.classList.contains("apple") && !c.classList.contains("sp") && !c.classList.contains("tray") && c.id !== "clock") c.remove(); });
    $("appname").after(menusEl);
    // 托盘里的图标各包一层，好高亮、好点：输入法、Wi‑Fi、电池是小菜单，最后一个是控制中心；时钟是通知中心
    var kinds = [["m", "ime", "输入法"], ["m", "wifi", "Wi‑Fi"], ["m", "battery", "电池"], ["panel", "cc", "控制中心"]];
    Array.prototype.slice.call(tray.children).forEach(function (c, i) {
      var k = kinds[i];
      if (!k) return;
      var w = document.createElement("span");
      w.className = "ti";
      w.dataset[k[0]] = k[1];
      w.title = k[2];
      c.before(w);
      w.appendChild(c);
    });
    clock.dataset.panel = "nc";
    clock.title = "通知中心";
  })();
  function systemMenu() {
    if (mac() && mac().systemMenu) return mac().systemMenu();
    return [
      item("关于本机", "", function () { about(); }),
      SEP,
      item("系统设置…", "⌘,", function () { apps.settings && apps.settings.show(); }),
      item("控制中心", "", function () { openPanel("cc"); }),
      SEP,
      item("最近使用的项目", "", null, { items: function () {
        var list = recent.filter(function (id) { return apps[id]; }).map(function (id) {
          return item(apps[id].name, "", function () { apps[id].show(); });
        });
        return (list.length ? list : [item("没有最近使用的项目", "", null, { disabled: true })])
          .concat([SEP, item("清除菜单", "", function () { recent = []; store.set("tsu-recent", recent); }, { disabled: !list.length })]);
      } }),
      SEP,
      item("强制退出…", "⌥⌘⎋", function () { if (window.TSU_APP && TSU_APP.forceQuit) TSU_APP.forceQuit(); }),
      SEP,
      item("睡眠", "", function () { power("sleep"); }),
      item("重启…", "", function () { if (confirm("重启：会重新载入页面（对话和文件都在本地存着，不会丢）。")) location.reload(); }),
      item("关机…", "", function () { power("off"); }),
      SEP,
      item("锁屏", "⌃⌘Q", function () { power("lock"); }),
      item("退出登录…", "⇧⌘Q", function () { if (confirm("退出登录？")) location.href = "/auth/logout"; }),
    ];
  }
  // 窗口通用的菜单项（每个 App 的菜单后面都有「窗口」「帮助」）
  function windowMenu() {
    if (mac() && mac().windowMenu) return mac().windowMenu();
    var list = order.filter(function (w) { return w.state !== "closed"; }).map(function (w) {
      return item(w.title ? w.title() : w.name, "", function () { if (w.state === "min") w.show(); else w.front(); }, { checked: w === frontWin });
    });
    return [
      item("最小化", "⌘M", function () { frontWin && frontWin.hide("min"); }, { disabled: !frontWin }),
      item("缩放", "", function () { frontWin && frontWin.zoom(); }, { disabled: !frontWin }),
      item(frontWin && frontWin.state === "full" ? "退出窗口全屏" : "窗口全屏", "", function () { if (!frontWin) return; if (frontWin.state === "full") frontWin.exitFull(); else frontWin.enterFull(); }, { disabled: !frontWin }),
      SEP,
      // 同 macOS：把这个 App 在这个桌面上开着的窗口都提到别的 App 的窗口前面（先后不变）；最小化的留在 Dock 里，别的桌面上的不搬过来
      item("前置全部窗口", "", function () {
        var f = frontWin, app = f && f.app;
        if (!app) return;
        order.filter(function (w) { return w.app === app && w.state !== "min" && w.state !== "closed" && w.space === curSpace && w !== f; }).forEach(function (w) { w.front(); });
        f.front();
      }, { disabled: !frontWin }),
      SEP,
      item("调度中心", "F3", function () { openMC(); }),
      item("台前调度", "", function () { setSetting("stageManager", !dset.stageManager); }, { checked: dset.stageManager }),
      item("应用程序窗口", "⌃↓", function () { openMC(frontWin && frontWin.name); }, { disabled: !frontWin }),
      item("移到", "", null, { disabled: !frontWin || spaceN < 2, items: function () {
        var w = frontWin, out = [];
        for (var i = 0; i < spaceN; i++) (function (i) { out.push(item("桌面 " + (i + 1), "", function () { sendToSpace(w, i); }, { disabled: !w || w.space === i, checked: !!w && w.space === i })); })(i);
        return out;
      } }),
    ].concat(list.length ? [SEP].concat(list) : []);
  }
  function viewMenuItems() {
    return [item(document.fullscreenElement ? "退出全屏幕" : "进入全屏幕", "⌃⌘F", osFullscreen)];
  }
  function helpMenu() {
    return [
      item("快捷键", "", function () { if (window.TSU_APP && TSU_APP.help) TSU_APP.help(); }),
      item("terminal-style-ui（GitHub）", "", function () { var u = "https://github.com/ApolloZhangOnGithub/terminal-style-ui"; if (window.TSU_SAFARI) TSU_SAFARI.open(u); else open(u, "_blank", "noopener"); }),
    ];
  }
  // 没有窗口在前台时同 macOS：前台是「访达」
  function finderMenus() {
    var f = apps.finder, F = window.TSU_FINDER;
    return f ? [{ title: "文件", items: [item("新建访达窗口", "", function () { if (F && F.newWindow) F.newWindow(); else f.show(); })] },
      { title: "前往", items: [item("个人", "", function () { if (F) F.open("/home/user"); else f.show(); })].concat(F && F.openTrash ? [item("废纸篓", "", function () { F.openTrash(); })] : [],
        F && F.gotoFolder ? [{ sep: true }, item("前往文件夹…", "⇧⌘G", function () { F.gotoFolder(); })] : []) }] : [];
  }
  var barSig = "";
  function renderMenubar() {
    var w = frontWin;
    syncPanels();
    $("appname").textContent = mac() && mac().appName ? mac().appName() : w ? w.name : "访达";
    var own = (w ? (w.menus ? w.menus() : []) : finderMenus()) || [];
    // 「显示」「窗口」「帮助」：App 自己没给就用通用的；App 给的「显示」后面补上全屏（拷一份，不改 App 返回的对象——它若每次返回同一份，就会越补越多）
    // App 自己给了「窗口」「帮助」：它的几项放在通用项前面（不再出现两个同名菜单）
    var hasView = false, winOwn = null, helpOwn = null;
    var all = own.filter(function (m) {
      if (m.title === "窗口") { winOwn = m.items || []; return false; }
      if (m.title === "帮助") { helpOwn = m.items || []; return false; }
      return true;
    }).map(function (m) {
      if (m.title !== "显示") return m;
      hasView = true;
      return { title: m.title, items: (m.items || []).concat([SEP], viewMenuItems()) };
    });
    if (!hasView) all.push({ title: "显示", items: viewMenuItems() });
    all.push({ title: "窗口", items: (winOwn && winOwn.length ? winOwn.concat([SEP]) : []).concat(windowMenu()) }, { title: "帮助", items: (helpOwn && helpOwn.length ? helpOwn.concat([SEP]) : []).concat(helpMenu()) });
    menusEl._menus = all;
    // 标题没变就不动 DOM（开着的菜单、高亮都留着）；变了才重建，开着的那个菜单按标题接回去
    var sig = all.map(function (m) { return m.title; }).join("\n");
    if (sig === barSig) return;
    barSig = sig;
    var was = openMenu && openMenu.parentNode === menusEl ? openMenu.dataset.menu : null;
    menusEl.textContent = "";
    all.forEach(function (m) {
      var el = document.createElement("span");
      el.textContent = m.title;
      el.dataset.menu = m.title;
      menusEl.appendChild(el);
    });
    if (was) {
      var again = menusEl.querySelector('[data-menu="' + CSS.escape(was) + '"]');
      if (again) { openMenu = again; again.classList.add("open"); } else closeMenu();
    }
  }
  function trayMenu(kind) {
    if (kind === "ime") return [item("简体拼音", "", null, { checked: true, info: true }), item("ABC", "", null, { info: true }), SEP, item("这里用的是你电脑自己的输入法", "", null, { disabled: true })];
    if (kind === "wifi") {
      var c = navigator.connection, on = navigator.onLine;
      return [item("Wi‑Fi", "", null, { info: true }), item(on ? "已连接" : "未连接互联网", "", null, { checked: on, info: true })]
        .concat(c && c.effectiveType ? [SEP, item("网络：" + c.effectiveType.toUpperCase() + (c.downlink ? " · 约 " + c.downlink + " Mbps" : ""), "", null, { info: true }),
          item("延迟：约 " + (c.rtt || 0) + " ms", "", null, { info: true })] : []);
    }
    if (kind === "battery") {
      var b = battery;
      return [item("电池", "", null, { info: true })].concat(b ? [
        item(Math.round(b.level * 100) + "%" + (b.charging ? "（正在充电）" : ""), "", null, { info: true }),
        item("电源：" + (b.charging ? "电源适配器" : "电池"), "", null, { info: true }),
      ] : [item("这个浏览器不给看电量", "", null, { info: true })]).concat([SEP, item("电池设置…", "", function () { apps.settings && apps.settings.show(); })]);
    }
    return [];
  }
  var battery = null;
  if (navigator.getBattery) navigator.getBattery().then(function (b) { battery = b; }, function () {});
  function menuFor(el) {
    if (el.classList.contains("apple")) return systemMenu();
    if (el.dataset.m) return trayMenu(el.dataset.m);
    if (el.id === "appname") {
      if (mac() && mac().appMenu) return mac().appMenu();
      var w = frontWin;
      if (!w) return [item("关于本机", "", about), SEP, item("系统设置…", "⌘,", function () { apps.settings && apps.settings.show(); })];
      var own = w.appMenu ? w.appMenu() || [] : [];
      return own.concat(own.length ? [SEP] : [], [
        item("隐藏" + w.name, "⌘H", function () { w.hide("min"); }),
        item("隐藏其他", "⌥⌘H", function () { order.forEach(function (x) { if (x !== w && x.state !== "closed") x.hide("min"); }); w.front(); },
          { disabled: !order.some(function (x) { return x !== w && x.state !== "closed" && x.state !== "min"; }) }),
        SEP,
        item("退出" + w.name, "⌘Q", function () { requestClose(w); }),
      ]);
    }
    var m = (menusEl._menus || []).find(function (x) { return x.title === el.dataset.menu; });
    return m ? m.items : [];
  }
  menubar.addEventListener("mousedown", function (e) {
    if (e.button !== 0) return;
    e.preventDefault(); // 点菜单栏不抢走焦点
    var el = e.target.closest(TITLES), p = e.target.closest("[data-panel]");
    if (el) {
      if (openMenu === el) return closeMenu(); // 再点一次关
      return openTitle(el, e);
    }
    if (p) return togglePanel(p.dataset.panel);
    closeAll(); // 点菜单栏空白处：菜单收起
  });
  // 菜单开着时，指针滑到别的菜单名上就切过去（同 macOS）
  menubar.addEventListener("mouseover", function (e) {
    if (!openMenu) return;
    var el = e.target.closest(TITLES);
    if (el && el !== openMenu) openTitle(el);
  });
  // 打开前先按当前前台窗口刷新一遍菜单；标题若因此重建，按名字找回新的那个
  function openTitle(el, e) {
    renderMenubar();
    if (el.dataset.menu && !el.isConnected) el = menusEl.querySelector('[data-menu="' + CSS.escape(el.dataset.menu) + '"]');
    if (el) openBarMenu(el, e);
  }
  document.addEventListener("mousedown", function (e) {
    if (levels.length && !levels.some(function (lv) { return lv.el.contains(e.target); }) && !menubar.contains(e.target)) closeMenu();
    if (panel && !panel.el.contains(e.target) && !menubar.contains(e.target)) closePanel();
  }, true);
  // 切到别的浏览器标签页 / 点进 Safari 里的 iframe（document 收不到它的 mousedown）/ 窗口大小变了：菜单都收起
  window.addEventListener("blur", function () { closeMenu(); });
  window.addEventListener("keydown", function (e) {
    if (alertKey(e)) return; // 提醒开着：回车 / Esc / ⌘⌫ 归它
    if (levels.length) { if (e.metaKey || e.ctrlKey) closeMenu(); else return menuKey(e); } // 快捷键照常，菜单收起
    var eat = function () { e.preventDefault(); e.stopPropagation(); };
    if (root.classList.contains("termapp")) { if (e.key === "Escape" && (lp || mc || panel)) { eat(); if (lp) closeLaunchpad(); else if (mc) closeMC(); else closePanel(); } return; } // 终端 App：没有调度中心、桌面、锁屏；⌃←→↑↓ 这些键都给终端
    if (e.key === "Escape" && mc) { eat(); closeMC(); return; }
    if (e.key === "Escape" && lp) { eat(); closeLaunchpad(); return; }
    if (e.key === "Escape" && panel) { eat(); closePanel(); return; }
    // 调度中心 F3 / ⌃↑，应用程序窗口 ⌃↓，切桌面 ⌃← ⌃→（macOS 自己常把这几个 ⌃ 键先拿走；拿不到时还有触控板手势、热角、Dock）。
    // 不是 Mac 时 ⌃← ⌃→ 是输入框里按词移动，输入框里就不抢
    var ctl = e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey, typing = /^(INPUT|TEXTAREA)$/.test((document.activeElement || {}).tagName || "") && !/Mac/.test(navigator.platform);
    if (e.key === "F3" || ctl && e.key === "ArrowUp" && !typing) { eat(); if (mc) closeMC(); else openMC(); return; }
    if (ctl && e.key === "ArrowDown" && !typing) { eat(); if (mc) closeMC(); else openMC(frontWin && frontWin.name); return; }
    if (ctl && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !typing) { eat(); closeMC(); switchSpace(curSpace + (e.key === "ArrowRight" ? 1 : -1)); return; }
    if (e.metaKey && e.key === ",") { e.preventDefault(); apps.settings && apps.settings.show(); }
    if (e.metaKey && e.ctrlKey && (e.key === "q" || e.key === "Q")) { e.preventDefault(); power("lock"); }
    if (e.ctrlKey && e.metaKey && (e.key === "f" || e.key === "F")) { e.preventDefault(); osFullscreen(); }
  }, true);
  function closeAll() { closeMenu(); closePanel(); }

  // ======== 右上角的面板：控制中心（托盘图标）、通知中心（时钟）——同一时间只开一个 ========
  var panel = null; // { name, el }
  var panels = {};
  function togglePanel(name) { if (panel && panel.name === name) closePanel(); else openPanel(name); }
  function openPanel(name) {
    closeMenu();
    closePanel();
    var el = panels[name] || (panels[name] = (name === "cc" ? buildCC : buildNC)());
    (name === "cc" ? syncCC : renderNC)();
    el.hidden = false;
    el.classList.remove("in");
    void el.offsetWidth;
    el.classList.add("in");
    settle(el, 300);
    panel = { name: name, el: el };
    var t = menubar.querySelector('[data-panel="' + name + '"]');
    if (t) t.classList.add("open");
    if (name === "nc") banners.hidden = true;
  }
  function closePanel() {
    if (!panel) return;
    panel.el.hidden = true;
    var t = menubar.querySelector('[data-panel="' + panel.name + '"]');
    if (t) t.classList.remove("open");
    if (panel.name === "nc") banners.hidden = false;
    panel = null;
  }
  function glass(cls) {
    var el = document.createElement("div");
    el.className = "glass-pane " + cls;
    el.hidden = true;
    el.addEventListener("mousedown", function (e) { if (!e.target.closest("input")) e.preventDefault(); }); // 不抢焦点（滑块除外）
    document.body.appendChild(el);
    return el;
  }

  // ---- 控制中心（macOS 26 Tahoe 的样子：一块玻璃，里面圆角小块）----
  var ICON = {
    moon: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill="currentColor"/></svg>',
    full: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    motion: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor"/></svg>',
    lock: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="10" rx="2.5" fill="currentColor" stroke="none"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    sleep: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M19 14A7.5 7.5 0 0 1 10 5a7.5 7.5 0 1 0 9 9z" fill="currentColor"/></svg>',
    gear: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>',
    stage: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="9" y="5" width="12" height="14" rx="2"/><rect x="3" y="6" width="3.5" height="3.5" rx="1"/><rect x="3" y="10.5" width="3.5" height="3.5" rx="1"/><rect x="3" y="15" width="3.5" height="3.5" rx="1"/></svg>',
    dock: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 16h10M9 9.5l3 3 3-3"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="18" height="18"><text x="12" y="17.5" text-anchor="middle" font-size="17" font-weight="700" fill="currentColor">✻</text></svg>',
  };
  var dnd = function () { return localStorage.getItem("tsu-dnd") === "on"; };
  function buildCC() {
    var el = glass("cc");
    el.innerHTML =
      '<div class="cc-tile cc-w2 cc-look"><div class="cc-h">外观</div><div class="cc-seg">' +
        '<button data-theme="dark"><i class="cc-sw dark"></i>深色</button><button data-theme="light"><i class="cc-sw light"></i>浅色</button><button data-theme="auto"><i class="cc-sw auto"></i>自动</button></div></div>' +
      '<button class="cc-tile cc-w2 cc-tog" data-cc="focus"><i class="cc-ic">' + ICON.moon + '</i><span><b>专注</b><small></small></span></button>' +
      '<button class="cc-tile cc-sq" data-cc="full"><i class="cc-ic">' + ICON.full + '</i><small>全屏幕</small></button>' +
      '<button class="cc-tile cc-sq" data-cc="stage"><i class="cc-ic">' + ICON.stage + '</i><small>台前调度</small></button>' +
      '<button class="cc-tile cc-sq" data-cc="motion"><i class="cc-ic">' + ICON.motion + '</i><small>动态墙纸</small></button>' +
      '<button class="cc-tile cc-sq" data-cc="autohide"><i class="cc-ic">' + ICON.dock + '</i><small>隐藏程序坞</small></button>' +
      '<button class="cc-tile cc-w4 cc-wall" data-cc="wall"><img alt=""><span><b>墙纸</b><small></small></span></button>' +
      '<div class="cc-tile cc-w4 cc-font"><div class="cc-h">文字大小<output></output></div><div class="cc-slider"><small>A</small><input type="range" min="11" max="18" step="1"><b>A</b></div></div>' +
      '<div class="cc-w4 cc-btns">' +
        '<button data-cc="lock"><i class="cc-ic">' + ICON.lock + '</i><small>锁屏</small></button>' +
        '<button data-cc="sleep"><i class="cc-ic">' + ICON.sleep + '</i><small>睡眠</small></button>' +
        '<button data-cc="settings"><i class="cc-ic">' + ICON.gear + '</i><small>系统设置</small></button>' +
        '<button data-cc="about"><i class="cc-ic">' + ICON.info + '</i><small>关于本机</small></button></div>';
    el.addEventListener("click", function (e) {
      var t = e.target.closest("[data-theme]");
      if (t) { if (window.TSU_APP) TSU_APP.setTheme(t.dataset.theme); syncCC(); syncSettings(); return; }
      var b = e.target.closest("[data-cc]");
      if (!b || b.disabled) return;
      var k = b.dataset.cc;
      if (k === "focus") { localStorage.setItem("tsu-dnd", dnd() ? "off" : "on"); syncCC(); }
      if (k === "full") osFullscreen();
      if (k === "motion") setMotion(!prefs.motion);
      if (k === "stage") setSetting("stageManager", !dset.stageManager);
      if (k === "autohide") setSetting("dockAutohide", !dk("dockAutohide"));
      if (k === "wall" || k === "settings") { closePanel(); apps.settings && apps.settings.show(); }
      if (k === "lock" || k === "sleep") { closePanel(); power(k); }
      if (k === "about") { closePanel(); about(); }
    });
    el.querySelector("input").addEventListener("input", function (e) { if (window.TSU_APP) TSU_APP.setFont(+e.target.value); syncCC(); syncSettings(); });
    return el;
  }
  function syncCC() {
    var el = panels.cc;
    if (!el) return;
    var mode = localStorage.getItem("tsu-theme") || "auto";
    el.querySelectorAll("[data-theme]").forEach(function (b) { b.classList.toggle("on", b.dataset.theme === mode); });
    var on = function (k, v) { el.querySelector('[data-cc="' + k + '"]').classList.toggle("on", !!v); };
    on("focus", dnd());
    on("stage", dset.stageManager);
    on("autohide", dk("dockAutohide"));
    el.querySelector('[data-cc="focus"] small').textContent = dnd() ? "勿扰模式 · 开" : "勿扰模式 · 关";
    on("full", document.fullscreenElement || document.webkitFullscreenElement);
    var hasVideo = !!WALLS[curWall()].video;
    on("motion", prefs.motion && hasVideo);
    el.querySelector('[data-cc="motion"]').disabled = !hasVideo;
    el.querySelector('[data-cc="motion"]').title = hasVideo ? "" : "这张墙纸没有动态版本";
    var img = el.querySelector(".cc-wall img"), src = "img/wall-" + curWall() + ".webp";
    if (img.getAttribute("src") !== src) img.src = src;
    el.querySelector(".cc-wall small").textContent = WALL_NAMES[curWall()] || "";
    var font = +(localStorage.getItem("tsu-font") || 13), range = el.querySelector("input");
    range.value = font;
    range.style.setProperty("--p", (font - 11) / 7 * 100 + "%");
    el.querySelector(".cc-font output").textContent = font + " px";
  }
  document.addEventListener("fullscreenchange", function () { syncCC(); });
  document.addEventListener("webkitfullscreenchange", function () { syncCC(); });

  // ======== 通知：右上角横幅（约 5 秒自己收起，指着不收）+ 通知中心（点时钟；按 App 分组，可单条清除、整组清除、全部清除）========
  // TSU_DESK.notify({ app（窗口 id 或 App 名，如 "win" / "终端"）, title, body, onClick }) —— 点横幅或通知中心里的那条：先把 App 叫到前台，再调 onClick
  var notes = store.get("tsu-notes", []), noteClicks = {}, noteSeq = Date.now();
  var banners = document.createElement("div");
  banners.id = "banners";
  document.body.appendChild(banners);
  // 通知是哪个 App 的：窗口 id / 窗口名，或者注册过的 App（id / 名字——还没建窗口的提醒事项、日历也认得）
  function appOf(key) {
    if (!key) return "";
    if (apps[key]) return apps[key].app || key;
    var w = Object.keys(apps).find(function (k) { return apps[k].name === key; });
    if (w) return apps[w].app || w;
    var ap = registry.find(function (x) { return x.id === key || x.name === key; });
    return ap ? ap.id : "";
  }
  function noteIcon(n) {
    var box = document.createElement("span");
    box.className = "n-ico ibox";
    box.style.setProperty("--s", "0.72");
    box.innerHTML = n.appId ? iconHTML(n.appId) : SYS_ICON;
    if (document.documentElement.classList.contains("termapp") && !n.appId) box.hidden = true; // Vibing Studio：没有自己图标的通知不挂「✻」
    return box;
  }
  function when(t) {
    var s = (Date.now() - t) / 1000, d = new Date(t);
    if (s < 60) return "现在";
    if (s < 3600) return Math.floor(s / 60) + " 分钟前";
    if (new Date().toDateString() === d.toDateString()) return two(d.getHours()) + ":" + two(d.getMinutes());
    return (d.getMonth() + 1) + "月" + d.getDate() + "日";
  }
  function saveNotes() { notes = notes.slice(0, 50); store.set("tsu-notes", notes.map(function (n) { return { id: n.id, app: n.app, appId: n.appId, name: n.name, title: n.title, body: n.body, t: n.t, key: n.key, data: n.data }; })); }
  function noteCard(n, cls) {
    var el = document.createElement("div");
    el.className = cls;
    el.innerHTML = '<div class="n-txt"><div class="n-top"><b></b><time></time></div><div class="n-title"></div><div class="n-body"></div></div><i class="n-x" title="清除">×</i>';
    el.prepend(noteIcon(n));
    el.querySelector(".n-top b").textContent = n.name;
    el.querySelector("time").textContent = when(n.t);
    el.querySelector(".n-title").textContent = n.title || "";
    el.querySelector(".n-body").textContent = n.body || "";
    if (!n.body) el.querySelector(".n-body").remove();
    return el;
  }
  // how：这台设备上怎么处理的（dismiss 关掉 / open 点开）。带 key 的通知（同一件事在所有设备上是同一条，见 sync.js）：处理经服务器，
  // 只生效一次，别的设备跟着收起；晚了一步（别的设备先处理了）这里也只是收起。会改数据的处理（完成、稍后提醒）要先等服务器说 ok 再做
  function dropNote(id, how) {
    var n = notes.find(function (x) { return x.id === id; });
    notes = notes.filter(function (x) { return x.id !== id; });
    delete noteClicks[id];
    saveNotes();
    Array.prototype.slice.call(banners.children).forEach(function (b) { if (b.dataset.note === String(id)) b.remove(); }); // 还在屏幕上的横幅一起收
    if (n && n.key && how && window.TSU_SYNC) TSU_SYNC.noticeAct(n.key, how).catch(function () {});
  }
  // 点了一条通知（横幅、通知中心）：那个 App 到前面，交给它自己的 onClick（同名的 activate(id) 是激活 App，别混）
  function openNote(n) {
    var id = appOf(n.appId || n.app), ws = id ? appWins(id) : [], w = ws.filter(isOpenWin).pop() || apps[id];
    var fn = noteClicks[n.id];
    if (!fn && n.data && n.data.agent && window.TSU_AGENTS) fn = function () { TSU_AGENTS.emit("open", n.data.agent); }; // 别的设备上来的：点开那个 agent
    if (w) { if (w.state === "min" || w.state === "closed") w.show(); else w.front(); }
    else if (id && !fn) launch(id); // 还没有窗口的 App：打开它
    dropNote(n.id, "open");
    if (fn) try { fn(); } catch (err) { console.error(err); }
  }
  function notify(o) {
    o = o || {};
    var appId = appOf(o.app), reg = appId && findApp(appId), n = { id: ++noteSeq, app: o.app || "", appId: appId, name: (reg && reg.name) || (apps[appId] && apps[appId].name) || o.app || "系统", title: String(o.title || ""), body: String(o.body || ""), t: Date.now() };
    var style = (appId && notifyPrefs[appId]) || "banner"; // 系统设置 › 通知：横幅 / 提醒（一直留着）/ 关
    if (style === "none") return { id: 0, close: function () {} };
    n.sticky = style === "alert";
    if (o.onClick) noteClicks[n.id] = o.onClick;
    var handle = { id: n.id, close: function () { dropNote(n.id, "dismiss"); if (panel && panel.name === "nc") renderNC(); } }; // 关掉 = 处理了（带 key 的：别的设备跟着收）
    if (o.key) { n.key = o.key; n.data = o.data || null; }
    if (o.remote) { n.t = o.remote.created_at || n.t; showNote(n, Date.now() - n.t < 120000); return handle; } // 别的设备上来的：刚发生的才弹横幅
    if (n.key && notes.some(function (x) { return x.key === n.key; })) return { id: 0, close: function () {} }; // 同一条已经在了
    showNote(n, true);
    // 带 key（同一件事在所有设备上是同一条）：记进账号，别的设备也会显示；要是已经在别的设备上处理过了，这里收回
    if (n.key && window.TSU_SYNC) TSU_SYNC.noticeAdd(n.key, { app: appId || o.app, title: n.title, body: n.body, data: n.data }).then(function (j) {
      var x = j && j.notice;
      if (x && (x.state === "done" || (x.state === "snoozed" && x.until > TSU_SYNC.now()))) retract(n.key);
    }, function () { /* 连不上服务器：这台照常显示 */ });
    return handle;
  }
  function showNote(n, withBanner) {
    notes.unshift(n);
    notes.sort(function (a, b) { return b.t - a.t; });
    saveNotes();
    if (panel && panel.name === "nc") renderNC();
    if (withBanner && !dnd() && !mobile()) banner(n); // 勿扰：不弹横幅，照样进通知中心
  }
  // 收起一条（别的设备上处理了）：通知中心、横幅里都去掉
  function retract(key) {
    var had = notes.filter(function (n) { return n.key === key; });
    if (!had.length) return;
    notes = notes.filter(function (n) { return n.key !== key; });
    had.forEach(function (n) { delete noteClicks[n.id]; });
    Array.prototype.slice.call(banners.children).forEach(function (b) { if (b.dataset.key === key) b.remove(); });
    saveNotes();
    if (panel && panel.name === "nc") renderNC();
    document.dispatchEvent(new CustomEvent("tsu-note-gone", { detail: { ids: had.map(function (n) { return n.id; }) } })); // iOS 的横幅、通知中心跟着收
  }
  // 账号里的通知变了（sync.js）：别的设备处理了的，这台收起；别的设备上新来的，这台也显示（经 TSU_DESK.notify，iOS、原生 App 的横幅照样有）
  if (window.TSU_SYNC) TSU_SYNC.on(function (type, list) {
    if (type !== "notices") return;
    list.forEach(function (x) {
      var live = x.state === "new" || (x.state === "snoozed" && x.until <= TSU_SYNC.now());
      if (!live) return retract(x.key);
      if (x.dev === TSU_SYNC.dev || notes.some(function (n) { return n.key === x.key; }) || TSU_SYNC.now() - x.created_at > 864e5) return;
      var data = null;
      try { data = x.data ? JSON.parse(x.data) : null; } catch (e) { data = null; }
      window.TSU_DESK.notify({ app: x.app, title: x.title, body: x.body, key: x.key, data: data, remote: x });
    });
  });
  function banner(n) {
    var b = noteCard(n, "banner glass-pane"), timer = 0;
    b.dataset.note = n.id;
    if (n.key) b.dataset.key = n.key;
    var dismiss = function () { clearTimeout(timer); if (b.classList.contains("out")) return; b.classList.remove("settled"); b.classList.add("out"); setTimeout(function () { b.remove(); }, 320); };
    var arm = function (ms) { clearTimeout(timer); timer = setTimeout(dismiss, ms); };
    b.addEventListener("mouseenter", function () { clearTimeout(timer); });
    b.addEventListener("mouseleave", function () { arm(2500); });
    b.addEventListener("mousedown", function (e) { e.preventDefault(); });
    b.addEventListener("click", function (e) {
      if (e.target.closest(".n-x")) { dismiss(); return; } // 横幅上的 × 只收起横幅，通知中心里还留着
      dismiss();
      openNote(n);
    });
    banners.prepend(b);
    settle(b, 500);
    Array.prototype.slice.call(banners.children, 3).forEach(function (x) { x.remove(); }); // 最多叠 3 条
    if (!n.sticky) arm(5000); // 「提醒」样式：一直留着，直到点它或点 ×
    else b.addEventListener("mouseleave", function () { clearTimeout(timer); });
  }
  function buildNC() {
    var el = glass("nc");
    el.innerHTML = '<div class="nc-date"><b></b><span></span></div><div class="nc-head"><span>通知</span><button data-nc="all">全部清除</button></div><div class="nc-list"></div>';
    el.addEventListener("click", function (e) {
      var t = e.target;
      if (t.closest('[data-nc="all"]')) { notes.slice().forEach(function (n) { dropNote(n.id, "dismiss"); }); noteClicks = {}; return renderNC(); }
      var g = t.closest(".nc-group"), c = t.closest(".nc-card");
      if (t.closest(".nc-gx") && g) { notes.filter(function (n) { return (n.appId || n.name) === g.dataset.key; }).forEach(function (n) { dropNote(n.id, "dismiss"); }); return renderNC(); }
      if (!c) return;
      var n = notes.find(function (x) { return String(x.id) === c.dataset.id; });
      if (!n) return;
      if (t.closest(".n-x")) { dropNote(n.id, "dismiss"); return renderNC(); }
      closePanel();
      openNote(n);
    });
    return el;
  }
  function renderNC() {
    var el = panels.nc;
    if (!el) return;
    var d = new Date();
    el.querySelector(".nc-date b").textContent = two(d.getHours()) + ":" + two(d.getMinutes());
    el.querySelector(".nc-date span").textContent = (d.getMonth() + 1) + "月" + d.getDate() + "日 星期" + DAYS[d.getDay()];
    var list = el.querySelector(".nc-list"), groups = [], byKey = {};
    list.textContent = "";
    notes.forEach(function (n) {
      var k = n.appId || n.name;
      if (!byKey[k]) groups.push(byKey[k] = { key: k, name: n.name, items: [] });
      byKey[k].items.push(n);
    });
    el.querySelector('[data-nc="all"]').hidden = !notes.length;
    if (!groups.length) { list.innerHTML = '<div class="nc-empty">没有通知</div>'; return; }
    groups.forEach(function (g) {
      var box = document.createElement("div");
      box.className = "nc-group";
      box.dataset.key = g.key;
      box.innerHTML = '<div class="nc-gh"><span></span><button class="nc-gx" title="清除这一组">×</button></div>';
      box.querySelector(".nc-gh span").textContent = g.name;
      g.items.forEach(function (n) { var c = noteCard(n, "nc-card"); c.dataset.id = n.id; box.appendChild(c); });
      list.appendChild(box);
    });
  }

  // ---- 关于本机、睡眠 / 关机 / 锁屏（盖一层；锁屏和睡眠点一下回来，关机要按电源键「开机」= 重新载入）----
  function about() {
    closeAll();
    var ov = overlay("about");
    ov.innerHTML = '<div class="about-card"><div class="about-logo"><img src="desk-logo.svg" alt="" width="72" height="72"></div><h2>macOS Simulator</h2><p>开在浏览器里的一台 macOS：访达、Safari、终端与 Agent、沙盒文件系统。</p>' +
      '<p class="dim">渲染：terminal-style-ui · 模型：按账号额度计费</p><button>好</button></div>';
    ov.querySelector("button").addEventListener("click", function () { ov.remove(); });
  }
  function overlay(kind) {
    var ov = document.createElement("div");
    ov.className = "overlay " + kind;
    document.body.appendChild(ov);
    return ov;
  }
  function power(kind) {
    closeAll();
    var ov = overlay(kind);
    wall.pause(); // 盖住了就不用放视频
    var back = function () { ov.remove(); applyWall(); };
    if (kind === "lock") {
      var tick2 = function () { var d = new Date(); ov.innerHTML = '<div class="lock-time">' + two(d.getHours()) + ":" + two(d.getMinutes()) + '</div><div class="lock-date">' + (d.getMonth() + 1) + "月" + d.getDate() + "日 星期" + DAYS[d.getDay()] + '</div><div class="lock-hint">点按或按任意键解锁</div>'; };
      tick2();
      var iv = setInterval(tick2, 10000);
      var unlock = function () { clearInterval(iv); back(); window.removeEventListener("keydown", unlock, true); };
      ov.addEventListener("click", unlock);
      setTimeout(function () { window.addEventListener("keydown", unlock, true); }, 300);
    } else if (kind === "sleep") {
      var wake = function () { back(); window.removeEventListener("keydown", wake, true); window.removeEventListener("pointermove", wake, true); };
      setTimeout(function () { window.addEventListener("keydown", wake, true); window.addEventListener("pointermove", wake, true); }, 800);
      ov.addEventListener("click", wake);
    } else {
      ov.innerHTML = '<button class="power" title="开机">⏻</button>';
      ov.querySelector("button").addEventListener("click", function () { location.reload(); });
    }
  }

  // ======== 浮动面板（快速查看这类「不是窗口」的东西）：按住 handle 拖、四边四角拉大小，手感同窗口 ========
  // floating(el, { handle, minW, minH, locked()（返回 true 时不让动，如全屏时）, onResize() })；el 要是 position: absolute
  var EDGES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
  function capture(e, target, move, end) {
    try { target.setPointerCapture(e.pointerId); } catch (x) {}
    function up() { target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up); target.removeEventListener("pointercancel", up); if (end) end(); }
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }
  function floating(el, o) {
    o = o || {};
    var locked = function () { return mobile() || (o.locked && o.locked()); };
    el.classList.add("floating");
    // owner：面板属于哪个窗口。放在它紧后面（CSS 靠这个让面板跟着窗口藏：别的桌面、台前调度的条里、「显示桌面」），叠放见 syncPanels
    if (o.owner) { o.owner.el.after(el); winPanels.push({ el: el, owner: o.owner }); syncPanels(); }
    EDGES.forEach(function (ed) { var h = document.createElement("b"); h.className = "rs rs-" + ed; h.dataset.edge = ed; el.appendChild(h); });
    el.addEventListener("pointerdown", function (e) {
      var h = e.target.closest && e.target.closest(".rs");
      if (!h || h.parentElement !== el || e.button !== 0 || locked()) return;
      e.preventDefault();
      e.stopPropagation();
      var r = { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight }, x0 = e.clientX, y0 = e.clientY, ed = h.dataset.edge, top = area().top;
      var minW = o.minW || 320, minH = o.minH || 200;
      capture(e, h, function (ev) {
        var dx = ev.clientX - x0, dy = ev.clientY - y0, n = { left: r.left, top: r.top, width: r.width, height: r.height };
        if (ed.indexOf("e") >= 0) n.width = Math.max(minW, r.width + dx);
        if (ed.indexOf("s") >= 0) n.height = Math.max(minH, r.height + dy);
        if (ed.indexOf("w") >= 0) { n.width = Math.max(minW, r.width - dx); n.left = r.left + r.width - n.width; }
        if (ed.indexOf("n") >= 0) { n.height = Math.max(minH, r.height - dy); n.top = Math.max(top, r.top + r.height - n.height); n.height = r.top + r.height - n.top; }
        el.style.left = n.left + "px";
        el.style.top = n.top + "px";
        el.style.width = n.width + "px";
        el.style.height = n.height + "px";
        if (o.onResize) o.onResize();
      });
    });
    if (o.handle) o.handle.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || e.target.closest(NO_DRAG) || locked()) return;
      e.preventDefault();
      var x0 = e.clientX, y0 = e.clientY, l0 = el.offsetLeft, t0 = el.offsetTop, w = el.offsetWidth, a = area();
      capture(e, o.handle, function (ev) {
        el.style.left = Math.max(80 - w, Math.min(a.width - 80, l0 + ev.clientX - x0)) + "px";
        el.style.top = Math.max(a.top, Math.min(window.innerHeight - 60, t0 + ev.clientY - y0)) + "px";
      });
    });
    return el;
  }

  // ======== 给 App 用的接口：新建窗口、Dock 图标、通知、菜单 ========
  window.TSU_DESK = {
    // opts: { id, app（属于哪个 App，默认同 id；同一个 App 的多个窗口共用 Dock 图标）, name（菜单栏 App 名）, title() , content（元素）, width, height, className, menus(), appMenu(), onClose() }
    createWindow: function (opts) {
      var el = document.createElement("div");
      el.className = "win closed " + (opts.className || "");
      el.id = opts.id;
      if (opts.app) el.dataset.appId = opts.app;
      el.innerHTML = '<div class="body"><div class="bar"><i data-act="close" title="关闭"></i><i data-act="min" title="最小化"></i><i data-act="full" title="全屏"></i><span></span></div></div>';
      el.querySelector(".bar span").textContent = opts.title ? opts.title() : opts.name;
      if (opts.content) el.querySelector(".body").appendChild(opts.content);
      winLayer.appendChild(el);
      var n = Object.keys(apps).length;
      var w = new Win(el, opts.name, opts.initial || function () {
        var a = area(), ww = Math.min(opts.width || 760, a.width - 40), hh = Math.min(opts.height || 520, a.height - 30);
        return { left: a.left + Math.round((a.width - ww) / 2) + (n % 6) * 26 - 60, top: a.top + 30 + (n % 6) * 26, width: ww, height: hh };
      });
      w.menus = opts.menus;
      w.appMenu = opts.appMenu;
      w.title = opts.title;
      w.onClose = opts.onClose;
      w.setTitle = function (t) { el.querySelector(".bar span").textContent = t; };
      return w;
    },
    // opts: { app（窗口 id）, title, icon（HTML）, className, before（放在哪个图标前）, onOpen() }
    addDockApp: function (opts) {
      var a = document.createElement("a");
      a.className = "app";
      a.dataset.app = opts.app;
      a.title = opts.title;
      a.innerHTML = '<span class="ico sq ' + (opts.className || "") + '">' + (opts.icon || "") + "</span>";
      if (opts.onOpen) a.addEventListener("click", function (e) { if (!apps[opts.app]) { e.stopPropagation(); opts.onOpen(); } }, true);
      dock.insertBefore(a, (opts.before && dock.querySelector(opts.before)) || dock.querySelector(":scope > .dock-extra")); // 默认加在 App 的最后（废纸篓那些前面）
      scheduleDock();
      registerApp({ id: opts.app, name: opts.title }); // Dock 里的 App 都算装了的 App（启动台、访达的「应用程序」里能看到）
      return a;
    },
    // 应用：registerApp({ id, name, icon（50×50 图标的 HTML，同 Dock 的 .ico）, open(), dock（要不要放进 Dock）, category（启动台的分类）})；
    // appList() → [{ id, name, icon, open }]；launch(id)；列表变了在 document 上发 "tsu-apps"
    registerApp: function (o) { var a = registerApp(o); return a && publicApp(a); },
    // 刷新恢复：App 自己建回窗口要等（数据、沙盒）就交一个 Promise，桌面等它好了再摆位置、排叠放；
    // lastState(id)：这个窗口上次记下的 sessionState()（窗口对象上挂 sessionState 函数就会记）
    holdRestore: function (p) { if (restoring) holds.push(Promise.resolve(p).catch(function () {})); },
    lastState: function (id) { var r = lastSession && lastSession.wins && lastSession.wins[id]; return r ? r.s : undefined; },
    restoring: function () { return restoring; },
    appList: function () { return appList(); },
    launch: function (id) { return launch(id); },
    missionControl: function (onlyApp) { if (mc) closeMC(); else openMC(onlyApp); },
    launchpad: function () { toggleLaunchpad(); },
    spaces: function () { return { count: spaceN, current: curSpace }; },
    stageManager: function (on) { setSetting("stageManager", on === undefined ? !dset.stageManager : !!on); },
    showDesktop: function () { if (deskAside) restoreDesk(); else showDesktop(); },
    // 提醒：alert({ window?, title, message?, icon?: "caution" | "app" | HTML, buttons: [{ label, role?: "default" | "cancel" | "destructive", run? }] }) → Promise<按钮文字>
    alert: function (o) { return desktopAlert(o); },
    setBusy: function (id, busy, message) { setBusy(id, busy, message); },
    onBeforeClose: function (id, fn) { if (typeof fn === "function") closeHooks[id] = fn; else delete closeHooks[id]; },
    close: function (id) { return requestClose(apps[id]); }, // 同点红灯（会先问）
    switchSpace: function (i) { switchSpace(i); },
    apps: apps,
    area: area,
    front: function () { return frontWin; },
    refreshMenus: function () { renderMenubar(); },
    notify: notify,
    notifications: function () { return notes.slice(); },
    // 系统命令 notifications clear（sys-cmds.js）：按 id 清掉几条，不给 id 就全清
    clearNotifications: function (ids) {
      var want = {};
      if (ids) ids.forEach(function (x) { want[String(x)] = 1; });
      notes.filter(function (n) { return !ids || want[String(n.id)]; }).forEach(function (n) { dropNote(n.id, "dismiss"); });
      if (panel && panel.name === "nc") renderNC();
    },
    // 系统命令 menubar：最前面那个 App 现在的菜单（同菜单栏上的）
    menus: function () { renderMenubar(); return { app: frontWin ? frontWin.name : "访达", menus: menusEl._menus || [] }; },
    popup: function (items, at) { return popup(items, at); }, // 右键菜单：at = { x, y } 或 { above: 元素 }
    floating: function (el, o) { return floating(el, o); }, // 浮动面板：拖动 + 四边四角拉大小
    appWindows: function (app) { return appWins(app); },
    setTrash: function (t) { trashP = t || null; renderDockExtras(); }, // 废纸篓：{ full(), open(), empty(), drop(paths) }
    trashChanged: function () { renderDockExtras(); }, // 满 / 空变了：重画 Dock 上的废纸篓
    trashIcon: function (full) { return trashSvg(!!full); }, // 废纸篓图标（SVG），访达的标题、预览里也用
    closeMenus: closeAll,
    // 程序坞的位置、大小、放大、自动隐藏：临时盖掉（{ dockPosition, dockSize, dockMagnify, dockAutohide }，null 还原），不写进桌面设置
    dockOverride: function (o) { dockOv = o || null; applyDockLook(); },
    controlCenter: function () { togglePanel("cc"); },
    notificationCenter: function () { togglePanel("nc"); },
  };
  // 对外的方法都包一层：桌面这边出了错只记日志，不让调用它的 App（访达、Safari、编辑器……）的脚本跟着中断
  Object.keys(window.TSU_DESK).forEach(function (k) {
    var fn = window.TSU_DESK[k];
    if (typeof fn !== "function") return;
    window.TSU_DESK[k] = function () { try { return fn.apply(this, arguments); } catch (err) { console.error("TSU_DESK." + k + " 出错：", err); } };
  });

  function osFullscreen() {
    var d = document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen || function () {}).call(document);
    else if (d.requestFullscreen) d.requestFullscreen().catch(function () {});
    else if (d.webkitRequestFullscreen) d.webkitRequestFullscreen();
  }

  var term = new Win($("win"), "终端", function () {
    var a = area(), w = Math.min(1000, a.width - 80);
    return { left: a.left + Math.round((a.width - w) / 2), top: a.top + 14, width: w, height: a.height - 28 };
  });
  var settingsWin = new Win($("settings"), "系统设置", function () {
    var a = area(), w = Math.min(820, a.width - 40), h = Math.min(620, a.height - 40);
    return { left: Math.round(a.left + a.width - w - 60), top: a.top + 40, width: w, height: h };
  });
  term.menus = function () { return window.TSU_APP && TSU_APP.menus ? TSU_APP.menus() : []; };
  term.appMenu = function () { return window.TSU_APP && TSU_APP.appMenu ? TSU_APP.appMenu() : []; };
  term.title = function () { return document.getElementById("title") ? document.getElementById("title").textContent : "终端"; };
  settingsWin.title = function () { return "系统设置"; };
  if (term.space === curSpace) term.front(); else renderMenubar(); // 终端在别的桌面：前台是访达
  applyWall();

  // ======== Dock：点开 / 到最前；拖动排序（别的图标让位）、拖出去松手移除（终端、访达除外）、右键菜单 ========
  var FIXED = { win: 1, finder: 1 };
  var dockOrder = store.get("tsu-dock", null), dockOff = store.get("tsu-dock-off", []), dockLogin = store.get("tsu-dock-login", []);
  var appName = function (a) { return a.title || (apps[a.dataset.app] && apps[a.dataset.app].name) || a.dataset.app; };
  var dockApps = function () { return Array.prototype.slice.call(dock.querySelectorAll(":scope > .app[data-app]")); };
  // 按存下的顺序排（不在记录里的新图标留在原位附近）；移出 Dock 的图标：没在运行就藏起来（CSS：.off:not(.running)）
  function applyDock() {
    var list = dockApps();
    if (dockOrder) {
      var known = dockOrder.map(function (id) { return list.find(function (a) { return a.dataset.app === id; }); }).filter(Boolean);
      var result = known.slice();
      list.forEach(function (a, i) { if (known.indexOf(a) < 0) result.splice(Math.min(i, result.length), 0, a); });
      var tail = dock.querySelector(":scope > .dock-extra"); // App 都排在分隔线、最近用过、最小化的窗口、废纸篓前面
      result.forEach(function (a) { dock.insertBefore(a, tail); });
    }
    list.forEach(function (a) { a.classList.toggle("off", dockOff.indexOf(a.dataset.app) >= 0 && !FIXED[a.dataset.app]); });
  }
  var dockTimer = 0;
  function scheduleDock() { clearTimeout(dockTimer); dockTimer = setTimeout(applyDock, 0); } // 别的 App 加完图标、自己挪完位置之后再排
  scheduleDock();
  function saveDock() { dockOrder = dockApps().map(function (a) { return a.dataset.app; }); store.set("tsu-dock", dockOrder); }
  function setPinned(id, keep) {
    dockOff = dockOff.filter(function (x) { return x !== id; }).concat(keep ? [] : [id]);
    store.set("tsu-dock-off", dockOff);
    applyDock();
  }
  function openApp(a) { a.click(); } // 走 Dock 的点击：还没建窗口的 App 由它自己的 onOpen 接着
  var dockDragged = false;
  dock.addEventListener("click", function (e) {
    if (dockDragged) return;
    var tile = e.target.closest("[data-min], [data-recent], [data-trash]");
    if (tile) { if (tile.dataset.trash) { if (trashP) trashP.open(); } else if (tile.dataset.min && apps[tile.dataset.min]) apps[tile.dataset.min].show(); else if (tile.dataset.recent) launch(tile.dataset.recent); return; }
    var a = e.target.closest("[data-app]");
    if (!a) return;
    if (mac() && mac().launch && mac().launch(a.dataset.app)) { closeMC(); closeLaunchpad(); return; }
    var id = a.dataset.app, ap = findApp(id), wins = appWins(id);
    if (!wins.length) { if (ap && ap.open) launch(id); return; } // 启动台、调度中心这类没有窗口的 App
    closeMC();
    closeLaunchpad();
    activate(id);
  });
  // 激活一个 App（同 macOS 点 Dock 图标、启动台、访达里双击 App）：这个桌面上它开着的窗口都提到前面（先后不变，最近用的在最上面）；
  // 这个桌面上没有、别的桌面上有 → 切到那个桌面；全最小化了 → 还原最近那个；一个窗口都没开 → App 自己开一个
  function activate(id) {
    var ap = findApp(id), wins = appWins(id), open = wins.filter(isOpenWin);
    if (!open.length) { if (ap && ap.open) return ap.open(); if (wins.length) return wins[wins.length - 1].show(); return; }
    var shown = open.filter(function (w) { return w.state !== "min"; });
    if (!shown.length) return open[open.length - 1].show();
    var here = shown.filter(function (w) { return w.space === curSpace; });
    if (!here.length) return shown[shown.length - 1].front(); // front 会先切到它的桌面
    here.forEach(function (w) { w.front(); });
  }
  // 「弹跳打开应用程序」：从 Dock 打开还没运行的 App 时图标跳几下（捕获阶段，先于各 App 自己的 onOpen）
  dock.addEventListener("click", function (e) {
    var a = e.target.closest(".app[data-app]");
    if (a && !dockDragged && dset.dockBounce && !a.classList.contains("running") && apps[a.dataset.app] !== undefined) bounce(a);
  }, true);
  function bounce(a) {
    a.classList.remove("bounce");
    void a.offsetWidth;
    a.classList.add("bounce");
    setTimeout(function () { a.classList.remove("bounce"); }, 650);
  }
  // 拖动：指针按住图标移过 5px 算拖。还在 Dock 那一条里：图标跟着指针，别的图标滑开让位，松手落在新位置；
  // 往上拖出 Dock 一段：别的图标合拢，松手“噗”一下移除（在运行的等它退出后才消失）。终端的图标拖到窗口里是 live.js 的「新面板」，这里让开
  dock.addEventListener("pointerdown", function (e) {
    var a = e.target.closest(".app[data-app]");
    if (!a || e.button !== 0 || mobile()) return;
    // Dock 竖着放（左 / 右）时沿 y 排；Dock 有 zoom（大小设置），往里写的 transform 要除回去
    var x0 = e.clientX, y0 = e.clientY, list, i0, centers, slot, dr, dragging = false, out = false, t = 0, id = a.dataset.app;
    var pos = dk("dockPosition"), vert = pos !== "bottom", z = dk("dockSize") / 50, axis = vert ? "translateY(" : "translateX(";
    var move = function (ev) {
      var dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (!dragging) {
        if (Math.abs(dx) + Math.abs(dy) < 5) return;
        dragging = true;
        closeAll();
        resetMag(true);
        list = dockApps().filter(function (x) { return x.offsetWidth; });
        i0 = list.indexOf(a);
        centers = list.map(function (x) { var r = x.getBoundingClientRect(); return vert ? r.top + r.height / 2 : r.left + r.width / 2; });
        slot = list.length > 1 ? (centers[list.length - 1] - centers[0]) / (list.length - 1) : (vert ? a.offsetHeight : a.offsetWidth) * z + 10;
        dr = dock.getBoundingClientRect();
        a.classList.add("drag");
        dock.classList.add("sorting");
        document.body.classList.add("dock-sort");
      }
      ev.preventDefault();
      var nowOut = pos === "left" ? ev.clientX > dr.right + 60 : pos === "right" ? ev.clientX < dr.left - 60 : ev.clientY < dr.top - 60;
      if (nowOut !== out) {
        out = nowOut;
        a.classList.toggle("leaving", out && !FIXED[id]);
        document.body.classList.toggle("dock-sort", !out || !FIXED[id]); // 终端拖出去：交给 live.js 的「新面板」提示
      }
      if (out && FIXED[id]) { a.style.transform = ""; list.forEach(function (x) { if (x !== a) x.style.transform = ""; }); return; }
      a.style.transform = "translate(" + dx / z + "px," + dy / z + "px)";
      t = out ? i0 : Math.max(0, Math.min(list.length - 1, Math.round((centers[i0] + (vert ? dy : dx) - centers[0]) / slot)));
      list.forEach(function (x, j) {
        if (x === a) return;
        var s = out ? (j > i0 ? -slot : 0) : i0 < j && j <= t ? -slot : t <= j && j < i0 ? slot : 0; // 拖出去时后面的图标合拢
        x.style.transform = s ? axis + s / z + "px)" : "";
      });
    };
    var up = function () {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      if (!dragging) return;
      // 拖过就不再触发点击
      dockDragged = true;
      setTimeout(function () { dockDragged = false; }, 0);
      var stop = function (ce) { ce.stopPropagation(); ce.preventDefault(); window.removeEventListener("click", stop, true); };
      window.addEventListener("click", stop, true);
      setTimeout(function () { window.removeEventListener("click", stop, true); }, 0);
      var before = a.getBoundingClientRect();
      document.body.classList.remove("dock-sort");
      dock.classList.add("snap"); // 先不带动画地归位，再把拖着的那个从松手处滑进空位（FLIP）
      list.forEach(function (x) { x.style.transform = ""; });
      a.classList.remove("drag", "leaving");
      if (out && !FIXED[id]) {
        poof(before.left + before.width / 2, before.top + before.height / 2);
        setPinned(id, false);
      } else if (!out && t !== i0) {
        if (t > i0) list[t].after(a); else list[t].before(a);
        saveDock();
      }
      var after = a.getBoundingClientRect();
      if (!(out && !FIXED[id]) || a.offsetWidth) a.style.transform = "translate(" + (before.left - after.left) / z + "px," + (before.top - after.top) / z + "px)";
      void a.offsetWidth;
      dock.classList.remove("snap", "sorting");
      a.style.transform = "";
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
  });
  // 「噗」：一团烟，散开就没了
  function poof(x, y) {
    var p = document.createElement("div");
    p.className = "poof";
    p.style.left = x + "px";
    p.style.top = y + "px";
    for (var i = 0; i < 7; i++) {
      var s = document.createElement("i"), ang = i / 7 * Math.PI * 2;
      s.style.setProperty("--dx", Math.cos(ang) * 26 + "px");
      s.style.setProperty("--dy", Math.sin(ang) * 26 + "px");
      p.appendChild(s);
    }
    document.body.appendChild(p);
    setTimeout(function () { p.remove(); }, 600);
  }
  // 「新建窗口」：取 App 自己菜单里第一个「新建…」（终端：新建标签页；访达：新建访达窗口）
  function newItemFor(id) {
    var w = apps[id], found = null;
    if (id === "finder" && window.TSU_FINDER && TSU_FINDER.newWindow) return item("新建访达窗口", "", function () { TSU_FINDER.newWindow(); });
    if (id === "finder" && w) return item("新建访达窗口", "", function () { w.show(); });
    (w && w.menus ? w.menus() || [] : []).some(function (m) {
      return (m.items || []).some(function (x) { if (x.label && /^新建/.test(x.label) && !x.disabled && x.run) { found = x; return true; } return false; });
    });
    return found && item(found.label, "", function () { if (w.state === "min" || w.state === "closed") w.show(); else w.front(); found.run(); });
  }
  function dockMenu(a) {
    var id = a.dataset.app, open = appWins(id).filter(isOpenWin), w = open[open.length - 1], isOpen = !!w, items = [];
    // 开着的窗口一个一行（同 macOS：点哪个就到哪个），当前窗口打勾
    if (isOpen) items = open.map(function (x) { return item(x.title ? x.title() : x.name, "", function () { if (x.state === "min") x.show(); else x.front(); }, { checked: x === frontWin }); }).concat([SEP]);
    var nw = newItemFor(id);
    if (nw) items.push(nw, SEP);
    items.push(item("选项", "", null, { items: [
      item("在 Dock 中保留", "", function () { setPinned(id, dockOff.indexOf(id) >= 0); }, { checked: dockOff.indexOf(id) < 0, disabled: !!FIXED[id] }),
      item("登录时打开", "", function () { setLoginItem(id, dockLogin.indexOf(id) < 0); }, { checked: dockLogin.indexOf(id) >= 0 }),
    ] }), SEP);
    if (isOpen) {
      var allMin = open.every(function (x) { return x.state === "min"; });
      items.push(item("显示所有窗口", "", function () { if (allMin) w.show(); openMC(w.name); }),
        item(allMin ? "显示" : "隐藏", "", function () { open.forEach(function (x) { if (allMin) x.show(); else if (x.state !== "min") x.hide("min"); }); }),
        SEP, item("退出", "", function () { open.reduce(function (p, x) { return p.then(function (ok) { return ok === false ? false : requestClose(x); }); }, Promise.resolve(true)); }));
    } else items.push(item("打开", "", function () { openApp(a); }));
    return items;
  }
  function dockBgMenu() {
    var gone = dockApps().filter(function (a) { return a.classList.contains("off"); });
    return gone.map(function (a) { return item("在 Dock 中保留「" + appName(a) + "」", "", function () { setPinned(a.dataset.app, true); }); })
      .concat(gone.length ? [SEP] : [], [item("还原默认 Dock", "", function () {
        dockOff = []; dockOrder = null; store.set("tsu-dock-off", []); localStorage.removeItem("tsu-dock"); location.reload();
      }, { disabled: !dockOrder && !dockOff.length })]);
  }
  dock.addEventListener("contextmenu", function (e) {
    e.preventDefault();
    var tr = e.target.closest(".dock-trash");
    if (tr && trashP) return popup([item("打开", "", function () { trashP.open(); }), SEP, item("清倒废纸篓", "", function () { trashP.empty(); }, { disabled: !trashP.full() })], { above: tr, side: dk("dockPosition") }, e);
    var a = e.target.closest(".app[data-app]");
    if (a) popup(dockMenu(a), { above: a, side: dk("dockPosition") }, e); else popup(dockBgMenu(), { x: e.clientX, y: e.clientY }, e);
  });
  // 「登录时打开」：页面载入后把勾了的 App 打开
  window.addEventListener("load", function () {
    dockLogin.forEach(function (id) { var a = dockIcon(id); if (a && !appWins(id).some(isOpenWin)) openApp(a); });
    // 各 App 先按自己记的把窗口建回来（终端要等 agent 数据、访达要等沙盒：holdRestore），再照记下的打开、摆好、叠好；最多等 8 秒
    var cap = new Promise(function (r) { setTimeout(r, 8000); });
    Promise.race([Promise.all(holds), cap]).then(function () { setTimeout(restoreSession, 30); });
  });
  function snapshotSession() {
    var wins = {}, list = order.slice();
    Object.keys(apps).forEach(function (k) { if (list.indexOf(apps[k]) < 0) list.unshift(apps[k]); });
    list.forEach(function (w) {
      if (!w || w.state === "closed" || !w.el.id || w.el.classList.contains("fd-infowin")) return;
      var r = (w.state === "zoom" || w.state === "full") && w.saved ? w.saved : w.rect();
      wins[w.el.id] = { app: w.app, r: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], st: w.state === "full" ? "normal" : w.state, sp: w.space };
      if (typeof w.sessionState === "function") { try { var st = w.sessionState(); if (st != null) wins[w.el.id].s = st; } catch (e) { /* 取不到就不记 */ } }
    });
    return { wins: wins, order: list.filter(function (w) { return w.state !== "closed" && wins[w.el.id]; }).map(function (w) { return w.el.id; }), front: frontWin && frontWin.state !== "closed" ? frontWin.el.id : null };
  }
  function saveSession() {
    if (restoring || mobile()) return;
    var snap = snapshotSession(), sig = JSON.stringify(snap);
    if (sig !== sessSig) { sessSig = sig; store.set(SESSION_KEY, snap); }
  }
  setInterval(saveSession, 1500);
  window.addEventListener("pagehide", saveSession);
  document.addEventListener("visibilitychange", function () { if (document.hidden) saveSession(); });
  function applyRec(w, rec) {
    w.restoreRec = null;
    if (rec.st === "min") return w.restoreMin(rec);
    if (rec.r) w.place(recRect(rec));
    if (typeof rec.sp === "number" && rec.sp < spaceN && rec.sp !== w.space) { w.space = rec.sp; w.el.classList.toggle("elsewhere", w.space !== curSpace); saveSpaces(); }
    if (rec.st === "zoom" && w.state !== "zoom") w.zoom(true);
  }
  function restoreSession() {
    var s0 = lastSession;
    if (!s0 || !s0.wins || mobile()) { restoring = false; return; }
    var ids = (s0.order || []).concat(Object.keys(s0.wins).filter(function (id) { return (s0.order || []).indexOf(id) < 0; }));
    var asked = {}, later = []; // later：App 自己异步建回来的窗口（文稿要先读文件）
    ids.forEach(function (id) {
      var rec = s0.wins[id], w = apps[id];
      if (!rec) return;
      if (w) {
        if (w.state === "closed") { if (w.restoreRec === null) w.restoreRec = rec; w.show(); }
        else if (w.restoreRec) applyRec(w, rec); // 页面里本来就开着的（终端）：照记下的摆
        return;
      }
      // 窗口是用的时候才建的 App（提醒事项、日历、文稿……）：它有 restore 就把它上次的窗口（带着各自记的状态）交给它建；
      // 没有就请它打开一次（建窗口时同一个 id 会认领上次的记录）。已经有窗口的 App（访达、终端）自己会建回来，不去请
      if (asked[rec.app] || appWins(rec.app).length) return;
      asked[rec.app] = 1;
      var ap = findApp(rec.app);
      try {
        if (ap && ap.restore) later.push(Promise.resolve(ap.restore(ids.filter(function (k) { return s0.wins[k].app === rec.app && !apps[k]; }).map(function (k) { return { id: k, state: s0.wins[k].s }; }))).catch(function () {}));
        else launch(rec.app);
      } catch (e) { console.error("恢复窗口失败：", rec.app, e); }
    });
    // 叠放：按记下的先后逐个到前面，最后是当时最前面的那个。异步建回来的窗口（文稿）到了以后再排一次，不然它们会压在最上面
    var stack = function () {
      ids.forEach(function (id) { var w = apps[id]; if (w && w.state !== "min" && w.state !== "closed" && w.space === curSpace) w.front(); });
      var f = s0.front && apps[s0.front];
      if (f && f.state !== "min" && f.state !== "closed" && f.space === curSpace) f.front();
    };
    stack();
    var cap = new Promise(function (r) { setTimeout(r, 6000); });
    Promise.race([Promise.all(later), cap]).then(function () {
      if (later.length) stack();
      setTimeout(function () { restoring = false; saveSession(); }, 1500); // 晚一点再开始记（访达这种要等沙盒好了才建窗口）
    });
  }

  // 浏览器窗口变了：全屏 / 缩放状态跟着铺满，普通状态保证窗口不跑出屏幕。
  // 合并到一次（拖浏览器边框时 resize 一秒几十次），并且先把尺寸都读完再统一写，避免读写交替逼出多次重排
  var fitTimer = 0;
  window.addEventListener("resize", function () {
    closeMenu();
    clearTimeout(fitTimer);
    fitTimer = setTimeout(function () { fit(); if (mc) { renderStrip(); layoutMC(); } }, 50);
  });
  // 一个位置收进当前屏幕（不比屏幕大、不跑出去）
  function inView(r, a, vw, vh) {
    var w = Math.min(r.width, vw), h = Math.min(r.height, vh - a.top);
    return { left: Math.max(0, Math.min(r.left, vw - w)), top: Math.max(a.top, Math.min(r.top, vh - 60)), width: w, height: h };
  }
  function fit() {
    if (mobile()) return;
    applyWall();
    var a = area(), vw = window.innerWidth, vh = window.innerHeight;
    var plan = Object.keys(apps).map(function (k) {
      var w = apps[k];
      if (w.state === "closed") return null;
      if (w.state === "full") return [w, { left: 0, top: 0, width: vw, height: vh }];
      if (w.state === "zoom") { if (w.saved) w.saved = inView(w.saved, a, vw, vh); return [w, { left: a.left, top: a.top, width: a.width, height: a.height + 8 }]; } // 缩放前的位置也跟着收进屏幕（取消缩放时不落到屏幕外）
      if (!w.el.style.left) return [w, w.initial()];
      var r = w.rect();
      return [w, { left: Math.max(0, Math.min(r.left, vw - Math.min(r.width, vw))), top: Math.max(a.top, r.top),
        width: Math.min(r.width, vw), height: Math.min(r.height, vh - a.top) }];
    });
    plan.forEach(function (p) { if (p) p[0].place(p[1]); });
    if (stageOn) layoutStage(false);
  }

  // ======== 应用：注册表（启动台、访达的「应用程序」都从这里取；Dock 里的图标自动算进来）========
  var registry = [], appsTimer = 0;
  var SYS_ICON = '<span class="ico sq n-sys">✻</span>';
  var LP_ICON = '<span class="ico sq ico-lp"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>';
  var MC_ICON = '<span class="ico sq ico-mc"><svg viewBox="0 0 50 50" width="50" height="50"><rect x="8" y="10" width="15" height="11" rx="2.5" fill="#64d2ff"/><rect x="27" y="10" width="15" height="11" rx="2.5" fill="#ffd60a"/>' +
    '<rect x="12" y="25" width="26" height="16" rx="3" fill="#fff"/><rect x="12" y="25" width="26" height="4" rx="2" fill="#30d158"/></svg></span>';
  function findApp(id) { return registry.find(function (x) { return x.id === id; }); }
  function appsChanged() { clearTimeout(appsTimer); appsTimer = setTimeout(function () { document.dispatchEvent(new Event("tsu-apps")); }, 0); }
  var icoMarkup = function (html) { return /class="[^"]*\bico\b/.test(html || "") ? html : '<span class="ico sq">' + (html || "") + "</span>"; };
  function iconHTML(id) {
    var ap = findApp(id), d = dockIcon(id), ico = d && d.querySelector(".ico");
    return ap && ap.icon ? ap.icon : ico ? ico.outerHTML : SYS_ICON;
  }
  var showOrFront = function (w) { if (w.state === "min" || w.state === "closed") w.show(); else w.front(); };
  function registerApp(o) {
    if (!o || !o.id) return null;
    var ap = findApp(o.id);
    if (!ap) registry.push(ap = { id: o.id });
    ap.name = o.name || ap.name || (apps[o.id] && apps[o.id].name) || o.id;
    if (o.icon) ap.icon = icoMarkup(o.icon);
    if (typeof o.open === "function") ap.open = o.open;
    if (typeof o.restore === "function") ap.restore = o.restore; // 刷新后把上次的窗口建回来：restore([{ id, state }])
    if (o.category) ap.category = String(o.category); // 启动台里的分类（「效率」「工具」……）
    if ("hidden" in o) ap.hidden = !!o.hidden; // 不是 App 的（Vibing Studio 的 macOS 风格里「系统设置」那个窗口）：启动台、访达里都不列
    if (o.dock && !dockIcon(o.id)) {
      var a = document.createElement("a");
      a.className = "app";
      a.dataset.app = o.id;
      a.title = ap.name;
      a.innerHTML = iconHTML(o.id);
      dock.appendChild(a);
      scheduleDock();
    }
    appsChanged();
    return ap;
  }
  function publicApp(ap) { return { id: ap.id, name: ap.name, icon: iconHTML(ap.id), open: function () { launch(ap.id); } }; }
  function appList() { return registry.filter(function (x) { return !x.hidden && (x.open || apps[x.id] || dockIcon(x.id)); }).map(publicApp); }
  // 打开一个 App：有自己的 open 就用；否则走 Dock 图标的点击（还没建窗口的 App 由它自己的 onOpen 接着）；再不然直接开窗口
  function launch(id) {
    var ap = findApp(id), w = apps[id], a = dockIcon(id);
    closeAll();
    if (id !== "missioncontrol") closeMC();
    if (id !== "launchpad") closeLaunchpad();
    if (mac() && mac().launch && mac().launch(id)) return;
    if (appWins(id).some(isOpenWin)) return activate(id); // 已经开着窗口：同点 Dock 图标，整个 App 到前面（不另开一个）
    if (ap && ap.open) return ap.open();
    if (a) return a.click();
    if (w) showOrFront(w);
  }
  registerApp({ id: "win", name: "终端", open: function () { showOrFront(apps.win); } });
  registerApp({ id: "settings", name: "系统设置", open: function () { showOrFront(apps.settings); } });
  registerApp({ id: "launchpad", name: "启动台", icon: LP_ICON, open: function () { toggleLaunchpad(); }, dock: true });
  registerApp({ id: "missioncontrol", name: "调度中心", icon: MC_ICON, open: function () { if (mc) closeMC(); else openMC(); }, dock: true });
  // 访达、Safari、编辑器在 desk.js 之后加载：页面脚本都跑完后，把 Dock 里有、注册表里还没有的补上；启动台、调度中心默认排在访达后面
  document.addEventListener("DOMContentLoaded", function () {
    dockApps().forEach(function (a) { if (!findApp(a.dataset.app)) registerApp({ id: a.dataset.app, name: a.title }); });
    var f = dockIcon("finder");
    if (f && !dockOrder) f.after(dockIcon("launchpad"), dockIcon("missioncontrol"));
    appsChanged();
  });

  // ======== 启动台（同 macOS 26 的「应用程序」）：不再整屏——屏幕中间一块圆角的毛玻璃面板：顶上大字搜索，一排分类，
  // 第一行是最近用过的，分隔线下面是全部 App。打字就筛，↑↓←→ 选，回车打开，Esc / 点面板外面收起 ========
  var lp = null;
  var LP_CATS = { win: "开发者工具", ide: "开发者工具", finder: "工具", "export": "工具", settings: "工具", safari: "信息与阅读", missioncontrol: "效率" };
  function toggleLaunchpad() { if (lp) closeLaunchpad(); else openLaunchpad(); }
  function openLaunchpad() {
    if (lp || mobile()) return;
    closeAll();
    closeMC();
    var el = document.createElement("div");
    el.id = "launchpad";
    el.innerHTML = '<div class="lp-panel"><div class="lp-head"><svg class="lp-glyph" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M16 5 7 25M16 5l9 20M9.5 19h13M5 25h4M23 25h4"/></svg>' +
      '<input placeholder="搜索 App" spellcheck="false" autocomplete="off"><span class="lp-more" title="更多">•••</span></div><div class="lp-sep"></div>' +
      '<div class="lp-cats"></div><div class="lp-body"></div></div>';
    desk.insertBefore(el, dock);
    desk.classList.add("lp");
    lp = { el: el, input: el.querySelector("input"), cats: el.querySelector(".lp-cats"), body: el.querySelector(".lp-body"), cat: "", sel: 0, focus: document.activeElement };
    renderLP();
    settle(el, 400);
    lp.input.addEventListener("input", function () { lp.sel = 0; renderLP(); });
    lp.input.addEventListener("keydown", function (e) {
      var items = lp.body.querySelectorAll(".lp-app");
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (lp.input.value || lp.cat) { lp.input.value = ""; lp.cat = ""; lp.sel = 0; renderLP(); } else closeLaunchpad(); return; }
      if (e.key === "Enter") { var it = items[lp.sel] || items[0]; if (it) launch(it.dataset.id); return; }
      var dir = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: "down", ArrowUp: "up" }[e.key];
      if (!dir || !items.length) return;
      e.preventDefault();
      if (dir === 1 || dir === -1) lp.sel = Math.max(0, Math.min(items.length - 1, lp.sel + dir));
      else {
        // 上下：找同一列、上一行 / 下一行里最近的那个
        var cur = items[lp.sel] || items[0], r0 = cur.getBoundingClientRect(), best = -1, bestD = Infinity;
        Array.prototype.forEach.call(items, function (x, i) {
          var r = x.getBoundingClientRect(), dy = r.top - r0.top;
          if (dir === "down" ? dy <= 4 : dy >= -4) return;
          var d = Math.abs(dy) * 4 + Math.abs(r.left - r0.left);
          if (d < bestD) { bestD = d; best = i; }
        });
        if (best >= 0) lp.sel = best;
      }
      markLP();
    });
    el.addEventListener("mousedown", function (e) { if (!e.target.closest("input")) e.preventDefault(); });
    el.addEventListener("click", function (e) {
      var a = e.target.closest(".lp-app"), c = e.target.closest(".lp-cat");
      if (a) return launch(a.dataset.id);
      if (c) { lp.cat = lp.cat === c.dataset.cat ? "" : c.dataset.cat; lp.sel = 0; renderLP(); lp.input.focus({ preventScroll: true }); return; }
      if (!e.target.closest(".lp-panel")) closeLaunchpad();
    });
    setTimeout(function () { if (lp) lp.input.focus({ preventScroll: true }); }, 0);
  }
  function lpButton(a) {
    var b = document.createElement("button");
    b.className = "lp-app";
    b.dataset.id = a.id;
    b.innerHTML = '<span class="ibox" style="--s:1.5">' + a.icon + '</span><span class="lp-name"></span>';
    b.lastChild.textContent = a.name;
    return b;
  }
  function markLP() {
    var items = lp.body.querySelectorAll(".lp-app");
    Array.prototype.forEach.call(items, function (x, i) { x.classList.toggle("sel", i === lp.sel); });
    var s0 = items[lp.sel];
    if (s0) { var r = s0.getBoundingClientRect(), br = lp.body.getBoundingClientRect(); if (r.top < br.top) lp.body.scrollTop -= br.top - r.top + 8; else if (r.bottom > br.bottom) lp.body.scrollTop += r.bottom - br.bottom + 8; }
  }
  function renderLP() {
    var q = lp.input.value.trim().toLowerCase(), all = appList().filter(function (a) { return a.id !== "launchpad"; });
    // 分类：有 App 的才出现
    var cats = [];
    var catOf = function (a) { var ap = findApp(a.id); return (ap && ap.category) || LP_CATS[a.id] || "其他"; };
    all.forEach(function (a) { var c = catOf(a); if (cats.indexOf(c) < 0) cats.push(c); });
    var ORDER = ["效率", "工具", "开发者工具", "娱乐", "社交", "信息与阅读", "创意", "其他"];
    cats.sort(function (x, y) { return ORDER.indexOf(x) - ORDER.indexOf(y); });
    lp.cats.innerHTML = cats.map(function (c) { return '<button class="lp-cat' + (c === lp.cat ? " on" : "") + '" data-cat="' + c + '">' + c + "</button>"; }).join("");
    var hit = all.filter(function (a) { return (!q || a.name.toLowerCase().indexOf(q) >= 0 || a.id.toLowerCase().indexOf(q) >= 0) && (!lp.cat || catOf(a) === lp.cat); });
    lp.body.textContent = "";
    // 最近用过的（前台过的窗口的 App，新的在前）：只在没在搜、没选分类时出现
    if (!q && !lp.cat) {
      var recent = [];
      order.slice().reverse().forEach(function (w) { var id = w.el.id.replace(/^term-\d+$/, "win"); if (recent.indexOf(id) < 0 && all.some(function (a) { return a.id === id; })) recent.push(id); });
      if (recent.length) {
        var row = document.createElement("div");
        row.className = "lp-grid lp-recent";
        recent.slice(0, 7).forEach(function (id) { row.appendChild(lpButton(all.filter(function (a) { return a.id === id; })[0])); });
        lp.body.appendChild(row);
        var sep = document.createElement("div");
        sep.className = "lp-sep";
        lp.body.appendChild(sep);
      }
    }
    var grid = document.createElement("div");
    grid.className = "lp-grid";
    hit.forEach(function (a) { grid.appendChild(lpButton(a)); });
    lp.body.appendChild(grid);
    if (!hit.length) { var p = document.createElement("p"); p.className = "lp-none"; p.textContent = "没有找到「" + lp.input.value.trim() + "」"; lp.body.appendChild(p); }
    markLP();
  }
  function closeLaunchpad() {
    if (!lp) return;
    var l = lp;
    lp = null;
    desk.classList.remove("lp");
    l.el.classList.add("out");
    if (document.activeElement === l.input && l.focus && l.focus.focus) l.focus.focus({ preventScroll: true }); // 没打开别的 App 就把焦点还回去
    setTimeout(function () { l.el.remove(); }, 220);
  }
  document.addEventListener("tsu-apps", function () { if (lp) renderLP(); });

  // ======== 多个桌面（空间）========
  function saveSpaces() {
    var map = {};
    Object.keys(apps).forEach(function (k) { if (apps[k].space) map[k] = apps[k].space; });
    store.set("tsu-spaces", { n: spaceN, cur: curSpace, map: map });
  }
  function applySpaces() { Object.keys(apps).forEach(function (k) { apps[k].el.classList.toggle("elsewhere", apps[k].space !== curSpace); }); }
  var onScreen = function (w) { return w.state !== "closed" && w.state !== "min"; };
  var winsIn = function (s) { return Object.keys(apps).map(function (k) { return apps[k]; }).filter(function (w) { return w.space === s && onScreen(w); }); };
  var slideDone = null;
  // 切桌面：整页往一边滑（旧桌面的窗口滑出去，新桌面的从另一边滑进来），只动 transform
  function switchSpace(to, animate) {
    to = Math.max(0, Math.min(spaceN - 1, to));
    if (to === curSpace) return spaceHud();
    if (slideDone) slideDone();
    if (deskAside) restoreDesk();
    var dir = to > curSpace ? 1 : -1, vw = window.innerWidth, outs = winsIn(curSpace), ins = winsIn(to);
    var SLIDE = "transform 0.42s cubic-bezier(0.25, 0.8, 0.25, 1)";
    curSpace = to;
    saveSpaces();
    closeAll();
    desk.classList.toggle("full", ins.some(function (w) { return w.state === "full"; })); // 全屏的窗口在别的桌面：这边的菜单栏、Dock 要回来（同 macOS）
    if (animate !== false && !mobile()) {
      // 窗口的浮动面板（快速查看）跟着它的窗口一起滑
      var pOf = function (ws) { return winPanels.filter(function (p) { return ws.indexOf(p.owner) >= 0; }).map(function (p) { return p.el; }); }, pIn = pOf(ins), pOut = pOf(outs);
      ins.forEach(function (w) { w.stopFlip(); w.el.classList.remove("elsewhere"); w.el.style.transition = "none"; w.el.style.transform = "translate3d(" + dir * vw + "px,0,0)"; });
      pIn.forEach(function (el) { el.style.transition = "none"; el.style.transform = "translate3d(" + dir * vw + "px,0,0)"; });
      void desk.offsetWidth;
      outs.forEach(function (w) { w.stopFlip(); w.el.style.transition = SLIDE; w.el.style.transform = "translate3d(" + -dir * vw + "px,0,0)"; });
      pOut.forEach(function (el) { el.style.transition = SLIDE; el.style.transform = "translate3d(" + -dir * vw + "px,0,0)"; });
      ins.forEach(function (w) { w.el.style.transition = SLIDE; w.el.style.transform = ""; });
      pIn.forEach(function (el) { el.style.transition = SLIDE; el.style.transform = ""; });
      var t = setTimeout(function () { slideDone(); }, 440);
      slideDone = function () {
        clearTimeout(t);
        slideDone = null;
        outs.concat(ins).forEach(function (w) { w.el.style.transition = ""; w.el.style.transform = ""; w.inStrip = false; w.el.classList.remove("in-strip"); });
        pIn.concat(pOut).forEach(function (el) { el.style.transition = ""; el.style.transform = ""; });
        applySpaces();
        if (stageOn) layoutStage(false);
      };
    } else { applySpaces(); if (stageOn) layoutStage(false); }
    // 前台：新桌面里最近用过的窗口；空桌面就是访达
    var top = order.filter(function (w) { return ins.indexOf(w) >= 0; }).pop();
    if (top) top.front();
    else { if (frontWin) frontWin.el.classList.remove("front"); frontWin = null; renderMenubar(); }
    spaceHud();
  }
  function addSpace() { if (spaceN < 16) { spaceN++; saveSpaces(); } return spaceN - 1; }
  function removeSpace(i) {
    if (spaceN <= 1) return;
    // 这个桌面上的窗口并到旁边的桌面（同 macOS）
    Object.keys(apps).forEach(function (k) { var w = apps[k]; if (w.space === i) w.space = Math.max(0, i - 1); else if (w.space > i) w.space--; });
    if (curSpace > i || curSpace === i && i > 0) curSpace--;
    spaceN--;
    applySpaces();
    saveSpaces();
  }
  // 把窗口挪到别的桌面（菜单「窗口 → 移到」；调度中心里拖到桌面缩略图上走 mcMove）
  function sendToSpace(w, i) {
    if (!w || i === w.space || i < 0 || i >= spaceN) return;
    if (mc) return mcMove(w, i);
    w.space = i;
    applySpaces();
    saveSpaces();
    if (frontWin === w) {
      w.el.classList.remove("front");
      var rest = order.filter(function (x) { return x !== w && onScreen(x) && x.space === curSpace; });
      frontWin = null;
      if (rest.length) rest[rest.length - 1].front(); else renderMenubar();
    }
  }
  // 切桌面时屏幕上方闪一下：第几个桌面
  var hud = null, hudT = 0;
  function spaceHud() {
    if (spaceN < 2) return;
    if (!hud) { hud = document.createElement("div"); hud.id = "space-hud"; document.body.appendChild(hud); }
    var dots = "";
    for (var i = 0; i < spaceN; i++) dots += '<i class="' + (i === curSpace ? "on" : "") + '"></i>';
    hud.innerHTML = "<span>桌面 " + (curSpace + 1) + "</span>" + dots;
    hud.classList.add("show");
    clearTimeout(hudT);
    hudT = setTimeout(function () { hud.classList.remove("show"); }, 900);
  }

  // ======== 调度中心：当前桌面的窗口缩小铺开（不重叠，下面写标题），顶上一排桌面缩略图（+ 添加，拖窗口上去就挪过去）========
  // 窗口只加 transform（translate + scale），里面的内容不重排、不重画；点一个窗口 = 到前台并退出，Esc / 点空白退出
  var mc = null;
  function openMC(onlyApp) {
    if (mc || mobile()) return;
    closeAll();
    closeLaunchpad();
    if (deskAside) restoreDesk();
    if (slideDone) slideDone();
    var layer = document.createElement("div");
    layer.id = "mc";
    layer.innerHTML = '<div class="mc-strip"></div>';
    desk.insertBefore(layer, dock);
    mc = { el: layer, strip: layer.firstChild, only: onlyApp || null, wins: [], labels: [] };
    Object.keys(apps).forEach(function (k) { apps[k].stopFlip(); });
    desk.classList.remove("mc-out");
    desk.classList.add("mc");
    mc.strip.addEventListener("click", function (e) {
      var sp = e.target.closest(".mc-space");
      if (e.target.closest(".mc-x") && sp) { removeSpace(+sp.dataset.i); renderStrip(); layoutMC(); return; }
      if (e.target.closest(".mc-add")) { addSpace(); renderStrip(); return; }
      if (sp) { var i = +sp.dataset.i; closeMC(); switchSpace(i); }
    });
    renderStrip();
    layoutMC();
    settle(layer, 500);
    settle(mc.strip, 500);
  }
  var mcWins = function () { return winsIn(curSpace).filter(function (w) { return !mc.only || w.name === mc.only; }); };
  function renderStrip() {
    var s = mc.strip, vw = window.innerWidth, vh = window.innerHeight, tw = spaceN > 6 ? 128 : 168, th = Math.round(tw * vh / vw), k = tw / vw;
    s.textContent = "";
    for (var i = 0; i < spaceN; i++) {
      var d = document.createElement("div"), t = document.createElement("div");
      d.className = "mc-space" + (i === curSpace ? " cur" : "");
      d.dataset.i = i;
      t.className = "mc-thumb";
      t.style.width = tw + "px";
      t.style.height = th + "px";
      t.style.backgroundImage = "url(img/wall-" + curWall() + ".webp)";
      // 缩略图里画出这个桌面上的窗口（按比例的小方块）
      winsIn(i).forEach(function (w) {
        var r = w.rect(), m = document.createElement("i");
        m.className = "mc-mini";
        m.style.cssText = "left:" + r.left * k + "px;top:" + r.top * k + "px;width:" + r.width * k + "px;height:" + r.height * k + "px";
        t.appendChild(m);
      });
      d.appendChild(t);
      d.insertAdjacentHTML("beforeend", "<span>桌面 " + (i + 1) + "</span>" + (spaceN > 1 ? '<i class="mc-x" title="移除这个桌面">×</i>' : ""));
      s.appendChild(d);
    }
    if (spaceN < 16) s.insertAdjacentHTML("beforeend", '<button class="mc-add" title="添加桌面">+</button>');
  }
  // 排版：试 1..n 列，每个窗口在格子里等比缩小（不放大），取缩小后总面积最大的列数；先按原来的上下分行、行内按左右，窗口大致留在原来那一侧
  function layoutMC() {
    var ws = mcWins(), vw = window.innerWidth, vh = window.innerHeight;
    mc.labels.forEach(function (l) { l.remove(); });
    mc.labels = [];
    mc.wins.forEach(function (w) { if (ws.indexOf(w) < 0 && !w.mcLeaving) { w.el.style.transform = ""; w.el.classList.remove("mc-hot"); } });
    mc.wins = ws;
    if (!ws.length) return;
    // 用 offset 量（不受桌面条滑入动画的 transform 影响）
    var ar = area(), top = mc.strip.offsetTop + mc.strip.offsetHeight + 30, bottom = (desk.classList.contains("full") ? vh : ar.bottom + 16) - 34;
    var left = ar.left + 56, W = ar.width - 112, H = Math.max(120, bottom - top), GAP = 36, LABEL = 30;
    var rs = ws.map(function (w) { return w.rect(); }), n = ws.length, best = null;
    for (var c = 1; c <= n; c++) {
      var rows = Math.ceil(n / c), cw = (W - GAP * (c - 1)) / c, ch = (H - (GAP + LABEL) * rows + GAP) / rows, area = 0;
      if (cw < 40 || ch < 30) continue;
      rs.forEach(function (r) { var s = Math.min(1, cw / r.width, ch / r.height); area += r.width * r.height * s * s; });
      if (!best || area > best.area * 1.02) best = { c: c, rows: rows, cw: cw, ch: ch, area: area };
    }
    if (!best) best = { c: n, rows: 1, cw: W / n, ch: H - LABEL };
    var cx = function (i) { return rs[i].left + rs[i].width / 2; }, cy = function (i) { return rs[i].top + rs[i].height / 2; };
    var idx = ws.map(function (w, i) { return i; }).sort(function (a, b) { return cy(a) - cy(b); }), lines = [];
    for (var j = 0; j < n; j += best.c) lines.push(idx.slice(j, j + best.c).sort(function (a, b) { return cx(a) - cx(b); }));
    var y0 = top + (H - (best.rows * (best.ch + LABEL) + (best.rows - 1) * GAP)) / 2;
    lines.forEach(function (line, ri) {
      var sz = line.map(function (i) { var r = rs[i], s = Math.min(1, best.cw / r.width, best.ch / r.height); return { i: i, s: s, w: r.width * s, h: r.height * s }; });
      var x = left + (W - sz.reduce(function (t, z) { return t + z.w; }, 0) - GAP * (line.length - 1)) / 2, rowY = y0 + ri * (best.ch + LABEL + GAP);
      sz.forEach(function (z) {
        var w = ws[z.i], r = rs[z.i], tx = x, ty = rowY + (best.ch - z.h) / 2;
        w.mcPos = { x: tx, y: ty, s: z.s, r: r };
        w.el.style.setProperty("--mcs", z.s);
        w.el.style.transformOrigin = "0 0";
        w.el.style.transform = "translate3d(" + (tx - r.left) + "px," + (ty - r.top) + "px,0) scale(" + z.s + ")";
        var lab = document.createElement("div");
        lab.className = "mc-label";
        lab.innerHTML = '<span class="ibox" style="--s:0.36">' + iconHTML(w.app) + "</span><span></span>";
        lab.lastChild.textContent = w.title ? w.title() : w.name;
        lab.style.left = tx + z.w / 2 + "px";
        lab.style.top = ty + z.h + 10 + "px";
        lab.style.maxWidth = Math.max(120, z.w + GAP - 8) + "px";
        mc.el.appendChild(lab);
        mc.labels.push(lab);
        settle(lab, 600);
        x += z.w + GAP;
      });
    });
  }
  function closeMC(pick) {
    if (!mc) return;
    var m = mc;
    mc = null;
    m.wins.forEach(function (w) { w.el.style.transform = ""; w.el.classList.remove("mc-hot", "mc-drag"); });
    desk.classList.add("mc-out");
    desk.classList.remove("mc");
    m.el.classList.add("out");
    if (pick) pick.front();
    if (stageOn) layoutStage(true); // 台前调度：没上台的窗口从网格直接回左边条
    setTimeout(function () {
      m.el.remove();
      if (mc) return; // 又打开了
      desk.classList.remove("mc-out");
      m.wins.forEach(function (w) { if (!w.inStrip) w.el.style.transformOrigin = ""; w.el.style.removeProperty("--mcs"); });
    }, 420);
  }
  // 调度中心里：指上去的窗口描一圈蓝边；按下拖到桌面缩略图上 = 挪过去，没拖就是选中它
  desk.addEventListener("pointerover", function (e) {
    if (!mc) return;
    var el = e.target.closest && e.target.closest(".win");
    mc.wins.forEach(function (w) { w.el.classList.toggle("mc-hot", w.el === el); });
  });
  document.addEventListener("pointerdown", function (e) {
    if (!mc || e.button !== 0 || dock.contains(e.target) || e.target.closest(".mc-strip")) return;
    e.preventDefault();
    e.stopPropagation(); // 不让窗口自己的处理（拖标题栏、到前台、终端点选）收到
    var el = e.target.closest(".win"), w = el && apps[el.id];
    if (!w || mc.wins.indexOf(w) < 0) return closeMC();
    mcDrag(e, w);
  }, true);
  function spaceAt(x, y) {
    var hit = null;
    mc.strip.querySelectorAll(".mc-space, .mc-add").forEach(function (d) {
      var r = (d.querySelector(".mc-thumb") || d).getBoundingClientRect();
      if (x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8) hit = d;
    });
    return hit;
  }
  function mcDrag(e, w) {
    var p = w.mcPos, x0 = e.clientX, y0 = e.clientY, dragging = false, over = null, el = w.el;
    var fx = (x0 - p.x) / (p.r.width * p.s), fy = (y0 - p.y) / (p.r.height * p.s); // 按下的点在窗口里的相对位置，拖动时保持在指针下
    var move = function (ev) {
      if (!dragging && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 5) return;
      if (!dragging) { dragging = true; el.classList.add("mc-drag"); }
      var hit = spaceAt(ev.clientX, ev.clientY);
      if (hit !== over) { if (over) over.classList.remove("drop"); over = hit; if (over) over.classList.add("drop"); }
      var s = over ? Math.min(p.s, 0.18) : p.s, nx = ev.clientX - fx * p.r.width * s, ny = ev.clientY - fy * p.r.height * s; // 移到缩略图上时缩小，看得清往哪放
      el.style.transform = "translate3d(" + (nx - p.r.left) + "px," + (ny - p.r.top) + "px,0) scale(" + s + ")";
    };
    var up = function () {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      el.classList.remove("mc-drag");
      if (over) over.classList.remove("drop");
      if (!mc) return;
      if (!dragging) return closeMC(w); // 点一下：到前台并退出
      var to = over ? (over.classList.contains("mc-add") ? addSpace() : +over.dataset.i) : curSpace;
      if (to !== curSpace) mcMove(w, to); else layoutMC(); // 放回格子里
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
  }
  // 调度中心里把窗口挪到别的桌面：缩进那个桌面的缩略图里消失，剩下的窗口重新排
  function mcMove(w, to) {
    w.space = to;
    saveSpaces();
    renderStrip();
    var thumb = mc.strip.querySelector('.mc-space[data-i="' + to + '"] .mc-thumb'), r = w.rect();
    w.mcLeaving = true;
    if (thumb) {
      var t = thumb.getBoundingClientRect(), k = t.width / window.innerWidth;
      w.el.style.transform = "translate3d(" + (t.left + r.left * k - r.left) + "px," + (t.top + r.top * k - r.top) + "px,0) scale(" + k + ")";
      w.el.style.opacity = "0";
    }
    setTimeout(function () {
      w.mcLeaving = false;
      w.el.style.opacity = "";
      if (w.space !== curSpace) { w.el.classList.add("elsewhere"); w.el.style.transform = ""; w.el.style.transformOrigin = ""; }
    }, 420);
    if (frontWin === w) {
      w.el.classList.remove("front");
      var rest = order.filter(function (x) { return x !== w && onScreen(x) && x.space === curSpace; });
      frontWin = null;
      if (rest.length) rest[rest.length - 1].front(); else renderMenubar();
    }
    layoutMC();
  }

  // ---- 触控板：在桌面空白处两指捏合 = 调度中心（浏览器把捏合当成按着 Ctrl 的滚轮，这里拦下不让页面缩放），张开 = 退出；
  // 两指左右滑 = 切桌面（html 上 overscroll-behavior 已是 none，Chrome 不会当成前进后退）。三、四指手势 macOS 自己拿走了，网页收不到 ----
  var wheel = { pinch: 0, x: 0, done: false, t: 0 };
  desk.addEventListener("wheel", function (e) {
    var bare = e.target === desk || e.target === wall || !!mc && !e.target.closest("#dock");
    if (e.ctrlKey) {
      if (!bare) return;
      e.preventDefault();
      wheel.pinch += e.deltaY;
      if (!wheel.done && wheel.pinch > 24 && !mc) { wheel.done = true; openMC(); }
      if (!wheel.done && wheel.pinch < -24 && mc) { wheel.done = true; closeMC(); }
    } else if (bare && !mc && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      wheel.x += e.deltaX;
      if (!wheel.done && Math.abs(wheel.x) > 120) { wheel.done = true; switchSpace(curSpace + (wheel.x > 0 ? 1 : -1)); }
    }
    clearTimeout(wheel.t);
    wheel.t = setTimeout(function () { wheel.pinch = wheel.x = 0; wheel.done = false; }, 240); // 一次手势只触发一次
  }, { passive: false });
  // ---- 热角：指针在左上角停 0.3 秒 = 调度中心（指针移出页面就作罢）----
  var hotT = 0;
  document.addEventListener("pointermove", function (e) {
    var corner = e.clientX <= 3 && e.clientY <= 3 && e.pointerType === "mouse";
    if (corner && !hotT && !mc) hotT = setTimeout(function () { hotT = 0; openMC(); }, 300);
    else if (!corner && hotT) { clearTimeout(hotT); hotT = 0; }
  }, { passive: true });
  document.documentElement.addEventListener("mouseleave", function () { clearTimeout(hotT); hotT = 0; });

  // ======== 提醒：挂在窗口上的表单（从标题栏下面滑出来，挡住这个窗口）或屏幕正中的提醒框（背后压暗、挡住整个桌面）========
  // 样式同 macOS 26：圆角卡片，上面 App 图标，粗体标题、小字说明，按钮是胶囊；默认按钮蓝底（回车），取消（Esc），破坏性的红字（⌘⌫）
  var alerts = [], sheetBusy = {};
  var BUSY_DEFAULT = "这个窗口里还有正在运行的任务，关闭会终止它们。";
  var CAUTION = '<svg viewBox="0 0 64 58" width="64" height="58"><path d="M28.5 4.2a4 4 0 0 1 7 0l26 45.8a4 4 0 0 1-3.5 6H6a4 4 0 0 1-3.5-6z" fill="#ffcc00" stroke="#e0a800" stroke-width="1"/>' +
    '<rect x="29" y="18" width="6" height="22" rx="3" fill="#3a3a3c"/><circle cx="32" cy="47" r="3.4" fill="#3a3a3c"/></svg>';
  function desktopAlert(o) {
    o = o || {};
    var id = o.window, w = id && apps[id];
    if (w && sheetBusy[id]) return sheetBusy[id].then(function () { return desktopAlert(o); }); // 同一个窗口一次只挂一个表单，后来的排队
    var p = new Promise(function (resolve) {
      var btns = (o.buttons && o.buttons.length ? o.buttons : [{ label: "好", role: "default" }]).map(function (b) { return typeof b === "string" ? { label: b } : b; });
      if (btns.length === 1 && !btns[0].role) btns[0].role = "default";
      var asSheet = !!(w && onScreen(w) && w.space === curSpace && !mobile());
      var card = document.createElement("div"), appIcon = w ? iconHTML(w.app) : SYS_ICON, icon;
      if (document.documentElement.classList.contains("termapp")) icon = ""; // Vibing Studio：提示框只有字和按钮（不要黄色三角、不要「✻」那个图标）
      else if (o.icon === "caution") icon = '<span class="al-caution">' + CAUTION + '<span class="ibox" style="--s:0.5">' + appIcon + "</span></span>";
      else if (o.icon === "none") icon = ""; // 不要图标：只有一句话 + 按钮（同 VS Code 的「当前没有可用的更新」）
      else if (!o.icon || o.icon === "app") icon = '<span class="ibox" style="--s:1.1">' + appIcon + "</span>";
      else icon = /class="[^"]*\bico\b/.test(o.icon) ? '<span class="ibox" style="--s:1.1">' + o.icon + "</span>" : o.icon;
      card.className = "alert-card";
      card.setAttribute("role", "alertdialog");
      card.innerHTML = (icon ? '<div class="al-icon">' + icon + "</div>" : "") + '<div class="al-title"></div><div class="al-msg"></div><div class="al-btns"></div>';
      if (!icon) card.classList.add("al-noicon");
      card.querySelector(".al-title").textContent = o.title || "";
      if (o.message) card.querySelector(".al-msg").textContent = o.message; else card.querySelector(".al-msg").remove();
      // 两个短按钮并排（取消在左、默认在右）；再多就竖排（默认在上、取消在下）
      var row = btns.length <= 2 && btns.every(function (b) { return String(b.label).length <= 6; }), rank = function (b) { return b.role === "default" ? 2 : b.role === "cancel" ? 0 : 1; };
      var sorted = btns.slice().sort(function (a, b) { return row ? rank(a) - rank(b) : rank(b) - rank(a); }), box = card.querySelector(".al-btns");
      box.classList.toggle("col", !row);
      var a = { card: card, winId: asSheet ? id : null, buttons: btns, focus: document.activeElement };
      var choose = function (b) {
        if (a.done) return;
        a.done = true;
        alerts.splice(alerts.indexOf(a), 1);
        holder.classList.add("out");
        if (asSheet) w.el.classList.remove("has-sheet");
        if (w && sheetBusy[id] === p) delete sheetBusy[id]; // 不是挂在窗口上的（窗口不在这个桌面、手机上）也要清：不然下一个提醒排在一个早就完了的上面，无限地重排、页面卡死
        setTimeout(function () { holder.remove(); }, 240);
        if (a.focus && a.focus.focus && document.contains(a.focus)) a.focus.focus({ preventScroll: true });
        try { if (b.run) b.run(); } catch (err) { console.error(err); }
        resolve(b.label);
      };
      a.choose = choose;
      // o.signal：别处替它收掉（闹钟在另一台设备上停了）；结果是 o.signalLabel（默认空字符串）
      if (o.signal) o.signal.addEventListener("abort", function () { if (!a.done) choose({ label: o.signalLabel || "" }); });
      sorted.forEach(function (b) {
        var el = document.createElement("button");
        el.type = "button";
        el.className = b.role || "";
        el.textContent = b.label;
        el.addEventListener("click", function () { choose(b); });
        box.appendChild(el);
      });
      var holder = document.createElement("div");
      holder.addEventListener("mousedown", function (e) { if (!e.target.closest("button")) e.preventDefault(); });
      holder.appendChild(card);
      if (asSheet) {
        holder.className = "sheet-wrap";
        holder.style.top = (w.bar ? w.bar.offsetHeight : 0) + "px";
        w.el.querySelector(".body").appendChild(holder);
        w.el.classList.add("has-sheet");
        if (frontWin !== w) w.front();
      } else {
        closeAll();
        holder.className = "alert-ov";
        document.body.appendChild(holder);
      }
      alerts.push(a);
      settle(holder);
      settle(card);
      var def = box.querySelector("button.default") || box.querySelector("button");
      setTimeout(function () { if (!a.done && def) def.focus({ preventScroll: true }); }, 0); // 焦点给默认按钮：窗口里的输入框收不到按键
    });
    if (w) sheetBusy[id] = p;
    return p;
  }
  // 按键给哪个提醒：屏幕正中的优先，其次是前台窗口上的表单
  function topAlert() {
    for (var i = alerts.length - 1; i >= 0; i--) if (!alerts[i].winId) return alerts[i];
    return alerts.find(function (a) { return frontWin && a.winId === frontWin.el.id; }) || null;
  }
  function alertKey(e) {
    var a = topAlert();
    if (!a) return false;
    var find = function (role) { return a.buttons.find(function (b) { return b.role === role; }); }, b = null;
    if (e.key === "Enter") b = find("default");
    else if (e.key === "Escape") b = find("cancel");
    else if (e.metaKey && (e.key === "Backspace" || e.key === "Delete")) b = find("destructive");
    if (b) { e.preventDefault(); e.stopPropagation(); a.choose(b); return true; }
    if (e.key === "Tab" || e.key === " ") return true; // 按钮之间切换、空格按下有焦点的按钮：交给浏览器
    e.preventDefault(); // 别的键不往被挡住的窗口里送
    e.stopPropagation();
    return true;
  }
  function setBusy(id, on, message) {
    if (on) busyMsg[id] = message || BUSY_DEFAULT; else delete busyMsg[id];
    if (apps[id]) apps[id].el.classList.toggle("busy", !!on);
  }
  // 关窗口（红灯、「退出」）：App 注册了 onBeforeClose 就全交给它（返回 false 或 Promise<false> 就不关；出错照常关）；
  // 没注册、但标了忙（setBusy）的，桌面替它问一句「终止并关闭？」
  function requestClose(w) {
    if (!w || w.closing || w.state === "closed") return Promise.resolve(false);
    var id = w.el.id, msg = busyMsg[id];
    w.closing = true;
    var ask = msg && !closeHooks[id] ? desktopAlert({ window: id, title: msg, icon: "caution", buttons: [{ label: "取消", role: "cancel" }, { label: "终止并关闭", role: "default" }] })
      .then(function (l) { return l === "终止并关闭"; }) : Promise.resolve(true);
    return ask.then(function (ok) {
      var h = closeHooks[id];
      if (!ok || !h) return ok;
      return Promise.resolve().then(h).then(function (r) { return r !== false; }, function (err) { console.error(err); return true; });
    }).then(function (ok) {
      w.closing = false;
      if (ok) w.hide("closed");
      return ok;
    });
  }

  // ---- 设置 App ----
  var pane = $("settings");
  function setMotion(on) { prefs.motion = on; localStorage.setItem("tsu-motion", on ? "on" : "off"); applyWall(); syncSettings(); }
  function syncSettings() {
    if (!pane.querySelector('[data-set="motion"]')) return; // 终端 App（terminal.html）没有设置面板
    var mode = localStorage.getItem("tsu-theme") || "auto";
    pane.querySelectorAll('[data-set="theme"] button').forEach(function (b) { b.classList.toggle("on", b.dataset.v === mode); });
    var cur = curWall();
    pane.querySelectorAll('[data-set="wall"] button').forEach(function (b) { b.classList.toggle("on", b.dataset.v === cur); });
    pane.querySelector('[data-set="motion"]').checked = prefs.motion;
    pane.querySelector('[data-set="motion"]').disabled = !(WALLS[prefs.wall] && WALLS[prefs.wall].video);
    var font = localStorage.getItem("tsu-font") || 13, tps = window.TSU_APP ? window.TSU_APP.tps : 80;
    pane.querySelector('[data-set="font"]').value = font;
    pane.querySelector('[data-out="font"]').textContent = font + " px";
    pane.querySelector('[data-set="tps"]').value = tps;
    pane.querySelector('[data-out="tps"]').textContent = tps + " tokens/s";
    if (panel && panel.name === "cc") syncCC();
    if (typeof syncDockPage === "function") syncDockPage();
  }
  pane.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-v]");
    if (!b) return;
    var set = b.parentElement.dataset.set;
    if (set === "theme") window.TSU_APP.setTheme(b.dataset.v);
    if (set === "wall") { prefs.wall = b.dataset.v; localStorage.setItem("tsu-wall", prefs.wall); applyWall(); }
    syncSettings();
  });
  pane.addEventListener("input", function (e) {
    var set = e.target.dataset.set;
    if (set === "font") window.TSU_APP.setFont(+e.target.value);
    if (set === "tps") window.TSU_APP.setTps(+e.target.value);
    if (set === "motion") return setMotion(e.target.checked);
    syncSettings();
  });
  document.addEventListener("tsu-theme", syncSettings);
  // ======== 桌面设置：读写、应用（程序坞的大小 / 放大 / 位置 / 自动隐藏 / 指示灯 / 最近使用；台前调度；点墙纸显示桌面）========
  var setListeners = [];
  function getSetting(k) {
    if (k === "theme") return localStorage.getItem("tsu-theme") || "auto";
    if (k === "wallpaper") return curWall();
    if (k === "motion") return prefs.motion;
    if (k === "fontSize") return +(localStorage.getItem("tsu-font") || 13);
    if (k === "focus") return dnd();
    return dset[k];
  }
  function allSettings() { var o = { theme: getSetting("theme"), wallpaper: getSetting("wallpaper"), motion: prefs.motion, fontSize: getSetting("fontSize"), focus: dnd() }; return Object.assign(o, dset); }
  function setSetting(k, v) {
    if (k === "theme") { if (["auto", "light", "dark"].indexOf(v) < 0 || !window.TSU_APP) return false; TSU_APP.setTheme(v); }
    else if (k === "wallpaper") { if (!WALLS[v]) return false; prefs.wall = v; localStorage.setItem("tsu-wall", v); applyWall(); }
    else if (k === "motion") setMotion(!!v);
    else if (k === "fontSize") { if (!window.TSU_APP) return false; TSU_APP.setFont(Math.max(11, Math.min(18, Math.round(+v) || 13))); }
    else if (k === "focus") localStorage.setItem("tsu-dnd", v ? "on" : "off");
    else {
      if (!(k in SET_DEFAULTS)) return false;
      var d = SET_DEFAULTS[k];
      if (typeof d === "boolean") v = !!v;
      else if (typeof d === "number") { v = +v; if (isNaN(v)) return false; v = Math.max(SET_RANGE[k][0], Math.min(SET_RANGE[k][1], v)); }
      else if (SET_CHOICES[k].indexOf(v) < 0) return false;
      if (dset[k] === v) return true;
      dset[k] = v;
      store.set("tsu-desk", dset);
      applySetting(k);
    }
    var val = getSetting(k);
    setListeners.slice().forEach(function (fn) { try { fn(k, val); } catch (err) { console.error(err); } });
    document.dispatchEvent(new CustomEvent("tsu-settings", { detail: { key: k, value: val } }));
    syncSettings();
    if (!applyingDesk) writeDeskSoon();
    return true;
  }
  function applySetting(k) {
    if (/^dock|minimizeToApp/.test(k)) applyDockLook();
    if (k === "stageManager") setStage(dset.stageManager);
    if (k === "stageWindows") resetSets();
    if ((k === "stageRecents" || k === "stageWindows") && stageOn) { if (k === "stageWindows" && frontWin) { frontWin.onStage = false; bringToStage(frontWin); } else layoutStage(true); }
  }
  // ======== 设置就是 /.paimon/config/desktop.json（同 agent 的 settings.json）：本机 localStorage 只是开机先用的一份；
  // 人或 rw 档位的 agent 改了文件马上生效；写坏了（不是 JSON）就保留上一次好的；某一项不认就不管它；文件里没写的键回到默认 ========
  var DESK_JSON = "/.paimon/config/desktop.json", deskWriting = false, deskLoaded = false, applyingDesk = false, deskWriteT = 0, renderSettingsPages = null;
  var notifyPrefs = store.get("tsu-notify", {}) || {}; // App → "banner"（默认）| "alert"（一直留着，直到点掉）| "none"（关掉）
  var NOTIFY_STYLES = ["banner", "alert", "none"];
  var DESK_BASE = { theme: "auto", wallpaper: "tahoe-day", motion: true, fontSize: 13, focus: false };
  var DESK_ABOUT = {
    theme: "appearance: light, dark, or follow the system (auto)", wallpaper: "desktop picture", motion: "play the animated wallpaper (the Tahoe ones are aerial videos)",
    fontSize: "text size of the terminal and editor, 11–18", focus: "Do Not Disturb: notifications go to the Notification Center without banners",
    dockSize: "Dock icon size, 32–80", dockMagnify: "Dock magnification, 0 (off) – 1", dockPosition: "where the Dock is", minimizeEffect: "minimize animation",
    titleDblClick: "double-clicking a title bar", minimizeToApp: "minimize windows into their app icon", dockAutohide: "hide the Dock until the pointer reaches the edge",
    dockBounce: "bounce icons while apps open", dockIndicators: "dots under open apps", dockRecents: "show suggested and recent apps in the Dock",
    clickWallpaper: "clicking the wallpaper reveals the desktop: always, or only in Stage Manager", stageManager: "Stage Manager", stageRecents: "show recent apps in Stage Manager",
    stageWindows: "Stage Manager shows an app's windows all at once or one at a time", notifications: "per app: \"banner\" (default), \"alert\" (stays until dismissed) or \"none\"",
    loginItems: "apps opened when the desktop starts",
  };
  function deskSnapshot() {
    var o = { theme: getSetting("theme"), wallpaper: prefs.wall, motion: prefs.motion, fontSize: getSetting("fontSize"), focus: dnd() };
    Object.keys(SET_DEFAULTS).forEach(function (k) { o[k] = dset[k]; });
    o.notifications = Object.assign({}, notifyPrefs);
    o.loginItems = dockLogin.slice();
    return o;
  }
  function writeDeskJson() {
    deskWriteT = 0;
    if (!window.SANDBOX || !deskLoaded) return;
    var text = JSON.stringify(deskSnapshot(), null, 2) + "\n";
    deskWriting = true;
    try {
      SANDBOX.as(null, function () {
        if (SANDBOX.exists(DESK_JSON) && SANDBOX.read(DESK_JSON) === text) return;
        SANDBOX.mkdirp("/.paimon/config");
        SANDBOX.write(DESK_JSON, text);
        var st = SANDBOX.stat(DESK_JSON);
        if (st && st.mode !== 0o666) st.mode = 0o666; // 同 settings.json：大家读，rw 档位的 agent 能改（sandbox.js 另外按档位把关）
      });
    } catch (e) { /* 沙盒还没好 */ }
    deskWriting = false;
  }
  function writeDeskSoon() { clearTimeout(deskWriteT); deskWriteT = setTimeout(writeDeskJson, 150); }
  window.addEventListener("pagehide", function () { if (deskWriteT) { clearTimeout(deskWriteT); writeDeskJson(); } });
  function readDeskJson() {
    if (!window.SANDBOX) return;
    var text = null;
    try { text = SANDBOX.exists(DESK_JSON) ? SANDBOX.as(null, function () { return SANDBOX.read(DESK_JSON); }) : null; } catch (e) { return; } // 还没取回来（真沙盒的镜像）：等下一次
    if (text == null) { deskLoaded = true; writeDeskJson(); return; } // 第一次：把现在的（本机存的）写成文件
    var j;
    try { j = JSON.parse(text); } catch (e) { deskLoaded = true; return; } // 写坏了：不动
    deskLoaded = true;
    if (!j || typeof j !== "object" || Array.isArray(j)) return;
    applyingDesk = true;
    try {
      // Vibing Studio（termapp）：字号、深浅色归 Studio 的设置（studio.json；⌘+ / ⌘- 调的字号也在那里）——桌面这份文件里记着的旧值不能拿来盖掉
      //   （以前每次打开都把 ⌘+ 调大的字号改回这里记的 12 / 13：「缩放不记」就是它）
      var studio = document.documentElement.classList.contains("termapp");
      Object.keys(DESK_BASE).concat(Object.keys(SET_DEFAULTS)).forEach(function (k) {
        if (studio && (k === "fontSize" || k === "theme")) return;
        var v = k in j ? j[k] : k in SET_DEFAULTS ? SET_DEFAULTS[k] : DESK_BASE[k];
        var now = k === "wallpaper" ? prefs.wall : getSetting(k);
        if (JSON.stringify(now) !== JSON.stringify(v)) setSetting(k, v); // 不认的值 setSetting 自己不收
      });
      var np = {};
      if (j.notifications && typeof j.notifications === "object") Object.keys(j.notifications).forEach(function (id) { if (NOTIFY_STYLES.indexOf(j.notifications[id]) >= 0 && j.notifications[id] !== "banner") np[id] = j.notifications[id]; });
      notifyPrefs = np;
      store.set("tsu-notify", notifyPrefs);
      if (Array.isArray(j.loginItems)) { dockLogin = j.loginItems.filter(function (x, i, a) { return typeof x === "string" && a.indexOf(x) === i; }); store.set("tsu-dock-login", dockLogin); }
    } finally { applyingDesk = false; }
    syncSettings();
    if (typeof renderSettingsPages === "function") renderSettingsPages();
  }
  if (window.SANDBOX) {
    SANDBOX.ready().then(readDeskJson);
    SANDBOX.onChange(function (p) { if (p === DESK_JSON && !deskWriting) setTimeout(readDeskJson, 0); });
  }
  function setNotifyStyle(id, style) {
    if (NOTIFY_STYLES.indexOf(style) < 0) return false;
    if (style === "banner") delete notifyPrefs[id]; else notifyPrefs[id] = style;
    store.set("tsu-notify", notifyPrefs);
    writeDeskSoon();
    return true;
  }
  function setLoginItem(id, on) {
    dockLogin = dockLogin.filter(function (x) { return x !== id; }).concat(on ? [id] : []);
    store.set("tsu-dock-login", dockLogin);
    writeDeskSoon();
  }
  // help settings 用：每一项能取什么、默认、现在
  function deskSchema() {
    var kindOf = function (k) {
      if (k === "theme") return "\"auto\" | \"light\" | \"dark\"";
      if (k === "wallpaper") return Object.keys(WALLS).map(function (x) { return JSON.stringify(x); }).join(" | ");
      if (k === "fontSize") return "11–18";
      if (SET_CHOICES[k]) return SET_CHOICES[k].map(function (x) { return JSON.stringify(x); }).join(" | ");
      if (SET_RANGE[k]) return SET_RANGE[k][0] + "–" + SET_RANGE[k][1];
      return "true | false";
    };
    var snap = deskSnapshot();
    return Object.keys(DESK_BASE).concat(Object.keys(SET_DEFAULTS)).map(function (k) { return { key: k, kind: kindOf(k), about: DESK_ABOUT[k] || "", def: k in SET_DEFAULTS ? SET_DEFAULTS[k] : DESK_BASE[k], now: snap[k] }; })
      .concat([{ key: "notifications", kind: "object { appId: \"banner\" | \"alert\" | \"none\" }", about: DESK_ABOUT.notifications, def: {}, now: snap.notifications },
        { key: "loginItems", kind: "array of app ids", about: DESK_ABOUT.loginItems, def: [], now: snap.loginItems }]);
  }
  window.TSU_DESK.settings = {
    schema: deskSchema, file: DESK_JSON,
    notifyStyle: function (id) { return notifyPrefs[id] || "banner"; }, setNotifyStyle: setNotifyStyle,
    loginItems: function () { return dockLogin.slice(); }, setLoginItem: setLoginItem,
    get: function (k) { try { return k ? getSetting(k) : allSettings(); } catch (err) { console.error(err); } },
    set: function (k, v) { try { return setSetting(k, v); } catch (err) { console.error("TSU_DESK.settings.set 出错：", err); return false; } },
    on: function (ev, fn) { if (ev === "change" && typeof fn === "function") setListeners.push(fn); },
    off: function (ev, fn) { setListeners = setListeners.filter(function (x) { return x !== fn; }); },
    defaults: function () { return Object.assign({}, SET_DEFAULTS); },
  };

  // ---- 程序坞的样子：大小（整个 Dock 用 zoom 缩放，图标里的字和图都清楚）、位置、自动隐藏、指示灯 ----
  function applyDockLook() {
    ["left", "bottom", "right"].forEach(function (p) { dock.classList.toggle("pos-" + p, dk("dockPosition") === p); });
    dock.style.setProperty("--dz", dk("dockSize") / 50);
    dock.classList.toggle("autohide", dk("dockAutohide"));
    dock.classList.toggle("no-dots", !dset.dockIndicators);
    resetMag(true);
    renderDockExtras();
    clearTimeout(fitTimer);
    fitTimer = setTimeout(function () { fit(); if (mc) { renderStrip(); layoutMC(); } }, 30); // 能放窗口的地方变了：缩放 / 全屏的窗口跟着铺
  }
  // ---- 放大：指针在 Dock 上时，附近的图标按距离放大（余弦衰减），并把两边挤开；只动这几个图标的 transform 与外边距，Dock 很小，重排很便宜 ----
  var magOn = false, magT = 0;
  dock.addEventListener("pointermove", function (e) {
    if (!dk("dockMagnify") || e.pointerType !== "mouse" || dock.classList.contains("sorting") || mobile()) return;
    var list = dockApps().filter(function (x) { return x.offsetWidth; }).concat(Array.prototype.slice.call(dock.querySelectorAll(".dock-extra.app")));
    var vert = dk("dockPosition") !== "bottom", z = dk("dockSize") / 50, slot = 60 * z, n = list.length;
    // 以没放大时的位置算（按序号，Dock 始终居中），不会因为放大后图标挪动而来回抖
    var rel = vert ? e.clientY - window.innerHeight / 2 : e.clientX - window.innerWidth / 2, M = 1.25 + dk("dockMagnify") * 0.85, R = slot * 2.6;
    clearTimeout(magT);
    dock.classList.remove("mag-out");
    dock.classList.add("magnify");
    magOn = true;
    list.forEach(function (a, i) {
      var d = Math.abs(rel - (i - (n - 1) / 2) * slot), s = d >= R ? 1 : 1 + (M - 1) * (Math.cos(d / R * Math.PI) + 1) / 2, ext = (s - 1) * 25;
      a.style.margin = vert ? ext + "px 0" : "0 " + ext + "px";
      a.firstElementChild && (a.firstElementChild.style.transform = s > 1.001 ? "scale(" + s + ")" : "");
    });
  });
  dock.addEventListener("pointerleave", function () { resetMag(false); });
  function resetMag(now) {
    if (!magOn) return;
    magOn = false;
    dock.classList.toggle("mag-out", !now);
    dock.querySelectorAll(".app").forEach(function (a) { a.style.margin = ""; if (a.firstElementChild) a.firstElementChild.style.transform = ""; });
    clearTimeout(magT);
    magT = setTimeout(function () { dock.classList.remove("magnify", "mag-out"); }, now ? 0 : 220);
  }
  // ---- 自动隐藏：Dock 滑出屏幕，指针碰到那条屏幕边缘时滑回来，离开 Dock 一会儿再藏 ----
  var hideT = 0;
  document.addEventListener("pointermove", function (e) {
    if (!dk("dockAutohide") || dock.classList.contains("shown")) return;
    var p = dk("dockPosition"), edge = p === "bottom" ? e.clientY >= window.innerHeight - 4 : p === "left" ? e.clientX <= 4 : e.clientX >= window.innerWidth - 4;
    if (edge) { clearTimeout(hideT); dock.classList.add("shown"); }
  }, { passive: true });
  dock.addEventListener("pointerenter", function () { clearTimeout(hideT); });
  dock.addEventListener("pointerleave", function () { if (dk("dockAutohide")) hideDockSoon(); });
  function hideDockSoon() {
    clearTimeout(hideT);
    hideT = setTimeout(function () { if (levels.length || dock.classList.contains("sorting") || dock.matches(":hover")) return hideDockSoon(); dock.classList.remove("shown"); }, 500);
  }
  // ---- Dock 右边一段：最近使用的 App（没在 Dock 里的），最小化的窗口（「最小化至应用程序图标」关着时每个窗口一格）----
  function renderDockExtras() {
    dock.querySelectorAll(".dock-extra").forEach(function (x) { x.remove(); });
    var recents = dset.dockRecents ? recent.filter(function (id) {
      var a = dockIcon(id);
      return findApp(id) && a && a.classList.contains("off") && !a.classList.contains("running");
    }).slice(0, 3) : [];
    var mins = dset.minimizeToApp ? [] : order.filter(function (w) { return w.state === "min"; });
    var sep = function () { var i = document.createElement("i"); i.className = "dock-sep dock-extra"; dock.appendChild(i); };
    if (recents.length) {
      sep();
      recents.forEach(function (id) {
        var a = document.createElement("a");
        a.className = "app dock-extra recent";
        a.dataset.recent = id;
        a.title = findApp(id).name;
        a.innerHTML = iconHTML(id);
        dock.appendChild(a);
      });
    }
    if (mins.length) {
      sep();
      mins.forEach(function (w) {
        var a = document.createElement("a");
        a.className = "app dock-extra min-tile";
        a.dataset.min = w.el.id;
        a.title = w.title ? w.title() : w.name;
        a.innerHTML = '<span class="ico mt-win' + (w.app === "win" && !w.el.classList.contains("tl") ? " dark" : "") + '"><i></i></span><span class="ibox mt-badge" style="--s:0.44">' + iconHTML(w.app) + "</span>";
        dock.appendChild(a);
      });
    }
    // 废纸篓：永远在最右边（同 macOS），前面一条分隔线
    if (trashP) {
      sep();
      var t = document.createElement("a");
      t.className = "app dock-extra dock-trash";
      t.dataset.trash = "1";
      t.title = "废纸篓";
      t.innerHTML = '<span class="ico">' + trashSvg(!!trashP.full()) + "</span>";
      dock.appendChild(t);
    }
  }
  // ---- 废纸篓（访达用 TSU_DESK.setTrash({ full(), open(), empty(), drop(paths) }) 挂上来）----
  var trashP = null, trashSeq = 0;
  function trashSvg(full) {
    var ribs = "", gid = "tr-b" + (++trashSeq); // 每个图标自己的渐变 id：同一个 id 出现几次时，藏起来的那份会让别的也画不出来
    for (var i = 0; i < 9; i++) { var x = 19 + i * 3.25; ribs += '<path d="M' + x.toFixed(2) + " 17.5 " + (x + (x - 32) * -0.09).toFixed(2) + ' 55.5"/>'; }
    return '<svg viewBox="0 0 64 64"><defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7f8fa" stop-opacity=".92"/><stop offset="1" stop-color="#c3c7cf" stop-opacity=".92"/></linearGradient></defs>' +
      (full ? '<g stroke="rgba(0,0,0,.28)" stroke-width=".8"><path d="M20 17c1-5 6-8 10-6 3-4 9-3 11 1 4-1 6 3 4 6z" fill="#fdfdfd"/><path d="M26 16c2-3 6-3 8-1l-3 3z" fill="#e8ebf0"/><path d="M36 13c3-2 7 0 7 3l-5 2z" fill="#f2f4f7"/></g>' : "") +
      '<path d="M14.5 16h35l-3.4 40.4a4.2 4.2 0 0 1-4.2 3.8H22.1a4.2 4.2 0 0 1-4.2-3.8z" fill="url(#' + gid + ')" stroke="rgba(0,0,0,.3)" stroke-width=".8"/>' +
      '<g stroke="rgba(60,64,72,.32)" stroke-width="1.1" stroke-linecap="round">' + ribs + "</g>" +
      '<ellipse cx="32" cy="16" rx="17.8" ry="3.1" fill="' + (full ? "#dfe3e9" : "#6d7179") + '" stroke="rgba(0,0,0,.35)" stroke-width=".8"/>' +
      '<ellipse cx="32" cy="16" rx="17.8" ry="3.1" fill="none" stroke="rgba(255,255,255,.7)" stroke-width=".6" transform="translate(0 .7)"/></svg>';
  }
  var trashEl = function (e) { return e.target && e.target.closest ? e.target.closest(".dock-trash") : null; };
  var tsuPaths = function (e) { return Array.prototype.indexOf.call(e.dataTransfer.types || [], "application/x-tsu-paths") >= 0; };
  // 拖到 Dock 里某个 App 的图标上 = 用它打开（同 macOS）：访达那边决定能不能开（TSU_FINDER.openWith）；开不了的 App 图标就摇一下
  var appEl = function (e) { var a = e.target && e.target.closest ? e.target.closest("a.app[data-app]") : null; return a && window.TSU_FINDER && TSU_FINDER.openWith ? a : null; };
  dock.addEventListener("dragover", function (e) {
    if (!tsuPaths(e)) return;
    var t = trashEl(e) || appEl(e);
    if (!t || (t.classList.contains("dock-trash") && !trashP)) return;
    e.preventDefault();
    var a = e.dataTransfer.effectAllowed || "all";
    e.dataTransfer.dropEffect = t.classList.contains("dock-trash") ? "move" : /copy|all|uninitialized/i.test(a) ? "copy" : "move";
    t.classList.add("drop-on");
  });
  dock.addEventListener("dragleave", function (e) { var t = trashEl(e) || appEl(e); if (t && !t.contains(e.relatedTarget)) t.classList.remove("drop-on"); });
  dock.addEventListener("drop", function (e) {
    var t = trashEl(e) || appEl(e);
    if (!t) return;
    e.preventDefault();
    t.classList.remove("drop-on");
    var paths = null;
    try { paths = JSON.parse(e.dataTransfer.getData("application/x-tsu-paths") || "null"); } catch (x) { paths = null; }
    if (!paths || !paths.length) return;
    if (t.classList.contains("dock-trash")) { if (trashP) trashP.drop(paths); return; }
    if (!TSU_FINDER.openWith(t.dataset.app, paths)) { t.classList.remove("nope"); void t.offsetWidth; t.classList.add("nope"); }
  });

  // ======== 墙纸上右键：同 macOS 访达的桌面菜单（桌面上的文件放在 ~/Desktop；没有桌面图标，所以「叠放」几项是灰的）========
  desk.addEventListener("contextmenu", function (e) {
    if (e.target !== desk && e.target !== wall) return;
    e.preventDefault();
    var F = window.TSU_FINDER, FS = window.SANDBOX, DESKTOP = (FS ? FS.HOME : "/home/user") + "/Desktop", n = F && F.clipCount ? F.clipCount() : 0;
    var ensure = function () { try { if (FS && !FS.isDir(DESKTOP)) FS.mkdirp(DESKTOP); } catch (x) { /* 沙盒还没好 */ } };
    var pick = function () {
      var inp = document.createElement("input");
      inp.type = "file";
      inp.multiple = true;
      inp.addEventListener("change", function () { if (inp.files.length && window.TSU_TRANSFER && TSU_TRANSFER.upload) TSU_TRANSFER.upload(inp.files); });
      inp.click();
    };
    popup([
      item("新建文件夹", "", function () { if (F && F.newFolder) F.newFolder(DESKTOP); }, { disabled: !(F && F.newFolder) }),
      item(n > 1 ? "粘贴 " + n + " 项" : "粘贴项目", "", function () { F.pasteTo(DESKTOP); }, { disabled: !n }),
      SEP,
      item("显示简介", "", function () { ensure(); if (F && F.info) F.info([DESKTOP]); }, { disabled: !(F && F.info) }),
      item("更改墙纸…", "", function () { if (TSU_DESK.settingsPage) TSU_DESK.settingsPage("wall"); }),
      item("编辑小组件…", "", null, { disabled: true }),
      SEP,
      item("使用叠放", "", null, { disabled: true }),
      item("叠放分组方式", "", null, { disabled: true, items: [] }),
      item("查看显示选项", "", null, { disabled: true }),
      SEP,
      item("从这台电脑导入…", "", pick, { disabled: !window.TSU_TRANSFER }),
    ], { x: e.clientX, y: e.clientY });
  });

  // ======== 点按墙纸显示桌面：窗口往两边让开（只露一条边），再点墙纸或点露出来的窗口就回来 ========
  var deskAside = null, downOnWall = false;
  // 只有按下和松开都在墙纸上才算点墙纸：点台前调度左边条里的窗口时，窗口一上台，松手的地方就变成了墙纸，不能当成「点墙纸」
  desk.addEventListener("pointerdown", function (e) { downOnWall = e.target === desk || e.target === wall; }, true);
  desk.addEventListener("click", function (e) {
    if (e.target !== desk && e.target !== wall || !downOnWall || mc || lp || mobile()) return;
    if (deskAside) return restoreDesk();
    if (dset.clickWallpaper === "always" || dset.stageManager) showDesktop();
  });
  function showDesktop() {
    var vw = window.innerWidth, ws = winsIn(curSpace).filter(function (w) { return !w.inStrip && w.state !== "full"; });
    if (!ws.length) return;
    closeAll();
    deskAside = ws;
    ws.forEach(function (w) {
      var r = w.rect(), dx = r.left + r.width / 2 < vw / 2 ? -(r.left + r.width - 36) : vw - 36 - r.left;
      w.stopFlip();
      w.el.style.transition = "transform 0.45s cubic-bezier(0.2, 0.85, 0.25, 1)";
      w.el.style.transform = "translate3d(" + dx + "px,0,0)";
      w.el.classList.add("aside");
    });
  }
  function restoreDesk() {
    var ws = deskAside;
    deskAside = null;
    if (!ws) return;
    ws.forEach(function (w) {
      w.el.classList.remove("aside");
      w.el.style.transition = "transform 0.4s cubic-bezier(0.2, 0.85, 0.25, 1)";
      w.el.style.transform = "";
      clearTimeout(w.flipT);
      w.flipT = setTimeout(function () { w.el.style.transition = ""; }, 420);
    });
  }
  // 点露在边上的窗口：全部回来，它到前台（窗口自己的处理不收这一下）
  document.addEventListener("pointerdown", function (e) {
    if (!deskAside || mc || e.button !== 0) return;
    var el = e.target.closest && e.target.closest(".win.aside");
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    restoreDesk();
    if (apps[el.id]) apps[el.id].front();
  }, true);

  // ======== 台前调度：前台 App 的窗口在舞台中间；别的最近用过的 App 在左边竖着一列，是真窗口缩小、稍微转个角度（活的，不截图），
  // 同一个 App 的几个窗口叠在一起；点一个 → 它上台，台上的进左边条。全程只动 transform / opacity。台上的窗口挡住左边条时条先让开，指针碰到左边缘再出来 ========
  var stageOn = false, stripPeek = false, stageIcons = null;
  var STAGE_T = "transform 0.45s cubic-bezier(0.2, 0.85, 0.25, 1), opacity 0.3s";
  function stageGeom() {
    var a = area(), x = a.left + 14, w = 150;
    return { x: x, w: w, top: a.top + 12, h: a.height - 24, right: x + w + 26, a: a };
  }
  function setStage(on) {
    on = !!on && !mobile();
    if (on === stageOn) return;
    stageOn = on;
    desk.classList.toggle("stage", on);
    if (deskAside) restoreDesk();
    if (on) {
      stageIcons = document.createElement("div");
      stageIcons.id = "stage-icons";
      winLayer.appendChild(stageIcons); // 和窗口同一层：在条里的缩略图上面、台上的窗口下面
      var f = frontWin && onScreen(frontWin) && frontWin.space === curSpace ? frontWin : order.filter(function (w) { return onScreen(w) && w.space === curSpace; }).pop();
      if (f) bringToStage(f, true); else layoutStage(true);
    } else {
      Object.keys(apps).forEach(function (k) { var w = apps[k]; w.onStage = false; if (w.inStrip) leaveStrip(w, true); });
      resetSets();
      if (stageIcons) { stageIcons.remove(); stageIcons = null; }
    }
    syncCC();
  }
  // 一组：一起上台、在左边条里叠在一起的几个窗口。默认同一个 App 的窗口一组（「一次一个」时每个窗口自己一组）；
  // 把条里的拖到台上（或 ⇧ 点它）= 并进台上这一组；把台上的拖到条里 = 它自己成一组
  var setOf = function (w) { return w.stageSet || (dset.stageWindows === "all" ? "app:" + w.app : "win:" + w.el.id); };
  var resetSets = function () { Object.keys(apps).forEach(function (k) { delete apps[k].stageSet; }); };
  // 它这一组上台
  function bringToStage(w, center) {
    var sid = setOf(w);
    Object.keys(apps).forEach(function (k) {
      var x = apps[k];
      x.onStage = onScreen(x) && x.space === curSpace && setOf(x) === sid;
    });
    layoutStage(true, center);
  }
  // 它这一组并进台上这一组（台上没有就是上台）。drop：拖过来松手的地方，它就放在那
  function addToStage(w, drop) {
    var on = winsIn(curSpace).filter(function (x) { return x.onStage; });
    if (!on.length) { bringToStage(w); return w.front(); }
    var cur = setOf(on[0]), sid = setOf(w), g = stageGeom();
    winsIn(curSpace).forEach(function (x) { if (setOf(x) === sid) { x.stageSet = cur; x.onStage = true; } });
    if (drop && w.inStrip && w.state === "normal") {
      var r = w.rect(), nr = { left: Math.round(Math.max(g.right, Math.min(g.a.right - r.width, drop.x - r.width / 2))), top: Math.round(Math.max(g.a.top, Math.min(g.a.bottom - r.height, drop.y - 16))), width: r.width, height: r.height }; // 整个窗口尽量留在屏幕里
      w.el.style.transition = "none";
      w.place(nr);
      w.el.style.transform = thumbTf(w.thumb, nr); // 先在新位置上摆成缩略图的样子，再放开：从松手的地方长回去
      void w.el.offsetWidth;
    }
    stripPeek = false;
    layoutStage(true);
    w.front();
  }
  // 从台上拿下来：自己成一组，进左边条；台上还有别的就留着
  function toStrip(w) {
    w.stageSet = "win:" + w.el.id + ":" + Date.now();
    w.onStage = false;
    stripPeek = false;
    var rest = order.filter(function (x) { return x.onStage && onScreen(x) && x.space === curSpace; });
    if (rest.length) rest[rest.length - 1].front();
    else { w.el.classList.remove("front"); frontWin = null; renderMenubar(); }
    layoutStage(true);
  }
  var thumbTf = function (t, r) {
    return "translate3d(" + (t.x - r.left) + "px," + (t.cy - r.top - r.height / 2) + "px,0) perspective(800px) rotateY(" + (t.hot ? 7 : 22) + "deg) scale(" + (t.hot ? t.s * 1.06 : t.s) + ")";
  };
  function leaveStrip(w, animate) {
    w.inStrip = false;
    w.el.style.zIndex = "";
    restack();
    w.el.classList.remove("in-strip", "strip-hot");
    w.el.style.transition = animate ? STAGE_T : "";
    w.el.style.transform = "";
    clearTimeout(w.flipT);
    w.flipT = setTimeout(function () { if (!w.inStrip) { w.el.style.transition = ""; w.el.style.transformOrigin = ""; } }, 480);
  }
  function layoutStage(animate, center) {
    if (!stageOn || mc) return;
    var g = stageGeom(), ws = winsIn(curSpace);
    // 台上的：从条里回来；挡着左边条（或刚打开台前调度）就挪到舞台正中（先把位置换好、transform 按新位置重算，看起来不跳，再放掉）
    ws.filter(function (w) { return w.onStage; }).forEach(function (w) {
      var r = w.rect();
      if ((center || w.inStrip) && r.left < g.right && w.state === "normal") {
        var sw = g.a.right - g.right, nr = { left: Math.round(g.right + Math.max(0, (sw - r.width) / 2)), top: r.top, width: Math.min(r.width, sw - 20), height: r.height };
        if (w.inStrip) { w.el.style.transition = "none"; w.place(nr); w.el.style.transform = thumbTf(w.thumb, nr); void w.el.offsetWidth; }
        else w.place(nr, animate);
      }
      if (w.inStrip) leaveStrip(w, animate);
    });
    // 条里的：按最近用过的顺序、按 App 分组，最多 6 组；台上的窗口挡着条、又没在边缘探出时，整条往左藏起来
    var groups = [], by = {};
    order.slice().reverse().forEach(function (w) {
      var k = setOf(w);
      if (w.space !== curSpace || !onScreen(w) || w.onStage) return;
      if (!by[k]) groups.push(by[k] = { name: w.name, wins: [] });
      by[k].wins.push(w);
    });
    ws.forEach(function (w) { var k = setOf(w); if (!w.onStage && !by[k]) { groups.push(by[k] = { name: w.name, wins: [] }); } if (!w.onStage && by[k].wins.indexOf(w) < 0) by[k].wins.push(w); });
    var covered = ws.some(function (w) { return w.onStage && !w.el.classList.contains("aside") && w.rect().left < g.right - 6; });
    var show = stripPeek || dset.stageRecents && !covered, max = Math.max(1, Math.min(6, Math.floor(g.h / 96))), slotH = Math.min(150, g.h / Math.max(max, 4));
    var y0 = g.top + (g.h - slotH * Math.min(groups.length, max)) / 2;
    if (stageIcons) stageIcons.textContent = "";
    groups.forEach(function (gr, i) {
      var hidden = !show || i >= max, cy = y0 + slotH * (i + 0.5);
      gr.wins.forEach(function (w, j) {
        var r = w.rect(), s = Math.min(g.w / r.width, (slotH - 22) / r.height);
        w.thumb = { x: hidden ? -g.w - 80 : g.x + j * 7, cy: cy - j * 6, s: s, hot: w.thumb && w.thumb.hot && !hidden };
        w.stopFlip();
        w.inStrip = true;
        w.el.classList.add("in-strip");
        w.el.style.zIndex = j ? "0" : "1"; // 同一组叠着：第一个在上
        w.el.style.transformOrigin = "0 50%";
        w.el.style.transition = animate ? STAGE_T : "none";
        w.el.style.transform = thumbTf(w.thumb, r);
      });
      if (!hidden && stageIcons) {
        var w0 = gr.wins[0], r0 = w0.rect(), seen = [];
        gr.wins.forEach(function (w) {
          if (seen.indexOf(w.app) >= 0 || seen.length >= 4) return;
          var ic = document.createElement("button");
          ic.className = "stage-ic";
          ic.title = w.name;
          ic.dataset.win = w.el.id;
          ic.innerHTML = '<span class="ibox" style="--s:0.56">' + iconHTML(w.app) + "</span>";
          ic.style.left = g.x - 8 + seen.length * 24 + "px";
          ic.style.top = cy + r0.height * w0.thumb.s / 2 - 22 + "px";
          stageIcons.appendChild(ic);
          seen.push(w.app);
        });
      }
    });
    if (stageIcons) settle(stageIcons, 400);
  }
  // 条里的窗口：指上去转正一点，点一下上台（窗口里的东西收不到这一下）
  desk.addEventListener("pointerover", function (e) {
    if (!stageOn || mc) return;
    var el = e.target.closest && (e.target.closest(".win.in-strip") || e.target.closest(".stage-ic"));
    var id = el && (el.dataset.win || el.id), sid = id && apps[id] && setOf(apps[id]);
    Object.keys(apps).forEach(function (k) {
      var w = apps[k];
      if (!w.inStrip || !w.thumb || w.stripDrag) return;
      var hot = !!sid && setOf(w) === sid;
      if (hot !== !!w.thumb.hot) { w.thumb.hot = hot; w.el.classList.toggle("strip-hot", hot); w.el.style.transform = thumbTf(w.thumb, w.rect()); }
    });
  });
  document.addEventListener("pointerdown", function (e) {
    if (!stageOn || mc || e.button !== 0) return;
    var el = e.target.closest && (e.target.closest(".win.in-strip") || e.target.closest(".stage-ic"));
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    var w = apps[el.dataset.win || el.id];
    if (!w) return;
    var sid = setOf(w), grp = winsIn(curSpace).filter(function (x) { return x.inStrip && x.thumb && setOf(x) === sid; });
    var x0 = e.clientX, y0 = e.clientY, moved = false, shift = e.shiftKey, t0 = grp.map(function (x) { return Object.assign({}, x.thumb); });
    try { el.setPointerCapture(e.pointerId); } catch (x) { /* 已经松开 */ }
    function move(ev) {
      var dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 6) return;
      if (!moved) { moved = true; grp.forEach(function (x) { x.stripDrag = true; x.el.style.transition = "none"; x.el.classList.add("strip-drag"); }); }
      grp.forEach(function (x, i) { x.thumb = Object.assign({}, t0[i], { x: t0[i].x + dx, cy: t0[i].cy + dy, hot: true }); x.el.style.transform = thumbTf(x.thumb, x.rect()); });
    }
    function up(ev) {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      grp.forEach(function (x) { x.stripDrag = false; x.el.classList.remove("strip-drag"); });
      if (!moved) {
        if (w.thumb) w.thumb.hot = false;
        stripPeek = false;
        return shift || ev.shiftKey ? addToStage(w) : w.front();
      }
      if (ev.type === "pointerup" && ev.clientX > stageGeom().right + 8) addToStage(w, { x: ev.clientX, y: ev.clientY });
      else layoutStage(true); // 没拖出条：回原处
    }
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }, true);
  // 条藏起来时，指针碰到左边缘（Dock 在左就是 Dock 右边）探出来；离开条就再藏
  document.addEventListener("pointermove", function (e) {
    if (!stageOn || mc) return;
    var g = stageGeom();
    if (!stripPeek && e.clientX <= g.a.left + 4 && e.clientY > g.top) { stripPeek = true; layoutStage(true); }
    else if (stripPeek && e.clientX > g.right + 40) { stripPeek = false; layoutStage(true); }
  }, { passive: true });

  // ======== 系统设置：左边栏分页（外观 / 墙纸 / 桌面与程序坞），「桌面与程序坞」每一项都是真的 ========
  (function buildSettings() {
    var paneEl = pane.querySelector(".pane"), secs = paneEl.querySelectorAll(":scope > section");
    var SVG = function (d, vb) { return '<svg viewBox="' + (vb || "0 0 20 20") + '" width="14" height="14" fill="#fff">' + d + "</svg>"; };
    var ICONS = {
      general: ["#8e8e93", SVG('<path d="M10 6.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8zm7.1 4.4-1.6-.3a5.8 5.8 0 0 1-.6 1.5l.9 1.4-1.4 1.4-1.4-.9a5.8 5.8 0 0 1-1.5.6l-.3 1.6h-2l-.3-1.6a5.8 5.8 0 0 1-1.5-.6l-1.4.9-1.4-1.4.9-1.4a5.8 5.8 0 0 1-.6-1.5L2.9 11V9l1.6-.3c.1-.5.3-1 .6-1.5l-.9-1.4 1.4-1.4 1.4.9c.5-.3 1-.5 1.5-.6L8.8 3h2l.3 1.6c.5.1 1 .3 1.5.6l1.4-.9 1.4 1.4-.9 1.4c.3.5.5 1 .6 1.5l1.6.3z"/>')],
      look: ["#3a3a3c", "◐"], dock: ["#1c1c1e", "▭"], wall: ["#30a2ff", "❀"],
      notify: ["#ff3b30", SVG('<path d="M10 17.6c1 0 1.8-.7 1.9-1.6H8.1c.1.9.9 1.6 1.9 1.6zm5.7-4.1-1.2-1.4V8.6c0-2.3-1.6-4.2-3.7-4.6v-.6a.8.8 0 0 0-1.6 0V4c-2.1.4-3.7 2.3-3.7 4.6v3.5l-1.2 1.4c-.3.4 0 .9.5.9h10.4c.5 0 .8-.5.5-.9z"/>')],
      focus: ["#5e5ce6", "☾"], paimon: ["#d77757", "✻"],
    };
    var PAGES = [["general", "通用"], ["look", "外观"], ["dock", "桌面与程序坞"], ["wall", "墙纸"], ["notify", "通知"], ["focus", "专注模式"], ["paimon", "Paimon"]];
    var side = document.createElement("nav"), main = document.createElement("div");
    side.className = "st-side";
    main.className = "st-main";
    var pages = {};
    // 最上面是账户（同 macOS 的 Apple 账户）：GitHub 头像、名字；点开是余额、用量、退出登录
    var acct = document.createElement("button");
    acct.className = "st-acct";
    acct.dataset.page = "account";
    side.appendChild(acct);
    pages.account = document.createElement("div");
    pages.account.className = "st-page";
    pages.account.dataset.page = "account";
    main.appendChild(pages.account);
    PAGES.forEach(function (p) {
      var b = document.createElement("button");
      b.dataset.page = p[0];
      b.innerHTML = '<i style="background:' + ICONS[p[0]][0] + '">' + ICONS[p[0]][1] + "</i><span></span>";
      b.lastChild.textContent = p[1];
      if (p[0] === "paimon") side.appendChild(Object.assign(document.createElement("hr"), { className: "st-sep" })); // 第三方的设置排在最后（同 macOS）
      side.appendChild(b);
      var pg = document.createElement("div");
      pg.className = "st-page";
      pg.dataset.page = p[0];
      pg.innerHTML = "<h2></h2>";
      pg.firstChild.textContent = p[1];
      pages[p[0]] = pg;
      main.appendChild(pg);
    });
    // 原来的几块：外观 + 文字大小 → 外观页；墙纸 → 墙纸页；隐藏的 tps 留在外观页末尾
    if (secs[0]) pages.look.appendChild(secs[0]);
    if (secs[2]) pages.look.appendChild(secs[2]);
    if (secs[1]) pages.wall.appendChild(secs[1]);
    if (secs[3]) pages.look.appendChild(secs[3]);
    var row = function (label, ctl, note) { return '<div class="st-row"><span class="st-label">' + label + (note ? '<small>' + note + "</small>" : "") + "</span><span class=\"st-ctl\">" + ctl + "</span></div>"; };
    var toggle = function (k) { return '<label class="st-switch"><input type="checkbox" data-k="' + k + '"><i></i></label>'; };
    var popupSel = function (k, opts) { return '<span class="st-popup"><select data-k="' + k + '">' + opts.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + "</option>"; }).join("") + "</select></span>"; };
    var slider = function (k, min, max, step, ticks) { return '<span class="st-slider"><input type="range" data-k="' + k + '" min="' + min + '" max="' + max + '" step="' + step + '"><span class="st-ticks">' + ticks.map(function (t) { return "<span>" + t + "</span>"; }).join("") + "</span></span>"; };
    pages.dock.insertAdjacentHTML("beforeend",
      '<h3>程序坞</h3><div class="st-group">' +
        row("大小", slider("dockSize", 32, 80, 1, ["小", "大"])) +
        row("放大", slider("dockMagnify", 0, 1, 0.05, ["关闭", "小", "大"])) +
        row("置于屏幕上的程序坞位置", popupSel("dockPosition", [["left", "左侧"], ["bottom", "底部"], ["right", "右侧"]])) +
        row("最小化窗口动画", popupSel("minimizeEffect", [["genie", "神奇效果"], ["scale", "缩放"]])) +
        row("窗口标题栏连按操作", popupSel("titleDblClick", [["zoom", "缩放"], ["minimize", "最小化"], ["none", "无操作"]])) +
        row("将窗口最小化至应用程序图标", toggle("minimizeToApp")) +
        row("自动隐藏和显示程序坞", toggle("dockAutohide")) +
        row("弹跳打开应用程序", toggle("dockBounce")) +
        row("为打开的应用程序显示指示灯", toggle("dockIndicators")) +
        row("在程序坞中显示建议 App 和最近使用的 App", toggle("dockRecents")) +
      '</div><h3>桌面与台前调度</h3><div class="st-group">' +
        row("点按墙纸显示桌面", popupSel("clickWallpaper", [["always", "始终"], ["stage", "仅在台前调度中"]]), "点按墙纸会移开所有窗口，以便你访问桌面上的项目和小组件。") +
        row("台前调度", toggle("stageManager"), "台前调度会在屏幕左侧排列最近使用的 App，把当前 App 放在中间，保持桌面整洁、切换专注。") +
        row("在台前调度中显示最近使用的 App", toggle("stageRecents")) +
        row("显示应用程序窗口", popupSel("stageWindows", [["all", "一次全部"], ["one", "一次一个"]])) +
      "</div>");
    // ---- 每一页最下面：「在 JSON 中编辑…」（设置本来就是 /.paimon/config 里的 JSON；人和 rw 档位的 agent 都能直接改）----
    var jsonLink = function (file) { return '<p class="st-json"><button type="button" class="st-link" data-json="' + file + '">在 JSON 中编辑…</button><small>' + file + "</small></p>"; };
    ["look", "wall", "dock"].forEach(function (k) { pages[k].insertAdjacentHTML("beforeend", jsonLink(DESK_JSON)); });
    var A = window.TSU_AGENTS, esc = function (t) { return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
    var sel = function (k, opts, cur) { return '<span class="st-popup"><select data-x="' + k + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(cur) ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select></span>"; };
    var sw = function (k, on) { return '<label class="st-switch"><input type="checkbox" data-x="' + k + '"' + (on ? " checked" : "") + "><i></i></label>"; };
    var chips = function (k, all, labels, cur) { return '<span class="st-chips">' + all.map(function (f) { return '<label class="st-chip"><input type="checkbox" data-x="' + k + '" value="' + f + '"' + (cur.indexOf(f) >= 0 ? " checked" : "") + "><span>" + esc(labels[f] || f) + "</span></label>"; }).join("") + "</span>"; };
    var money = function (v) { return A && A.fmt ? A.fmt.money(v || 0) : "¥" + ((v || 0) / 1e6).toFixed(2); };

    // ---- 账户 ----
    var usage = null;
    function renderAccountCard() {
      var me = A && A.me && A.me();
      var name = me && me.loggedIn ? me.login : "未登录", av = me && me.avatar ? '<img src="' + esc(me.avatar) + '" alt="">' : "<b>" + esc(name.slice(0, 1).toUpperCase()) + "</b>";
      acct.innerHTML = '<span class="st-av">' + av + '</span><span class="st-acct-t"><b>' + esc(name) + "</b><small>" + (me && me.loggedIn ? "GitHub 账户、余额" : "用 GitHub 登录") + "</small></span>";
    }
    function renderAccount() {
      var me = A && A.me && A.me(), pg = pages.account;
      renderAccountCard();
      if (!me || !me.loggedIn) { pg.innerHTML = '<div class="st-hero"><span class="st-av big"><b>?</b></span><h2>未登录</h2><p>用 GitHub 登录以后，agent、额度、真沙盒都跟着账户走。</p><button type="button" class="st-btn primary" data-x="login">用 GitHub 登录…</button></div>'; return; }
      var u = usage;
      pg.innerHTML = '<div class="st-hero"><span class="st-av big">' + (me.avatar ? '<img src="' + esc(me.avatar) + '" alt="">' : "<b>" + esc(me.login.slice(0, 1).toUpperCase()) + "</b>") + "</span><h2>" + esc(me.login) + "</h2><p>GitHub 账户" + (me.admin ? " · 管理员" : "") + "</p></div>" +
        '<div class="st-group">' + row("余额", "<span class=\"st-val\">" + money(me.balance) + "</span>") + row("邀请", '<span class="st-val">' + (me.allowed ? "已放行" : "还没有被邀请") + "</span>") +
        row("最近 24 小时", '<span class="st-val">' + (u ? money(u.spentDay) : "…") + "</span>") + row("最近 7 天", '<span class="st-val">' + (u ? money(u.spentWeek) : "…") + "</span>") +
        row("价格", '<span class="st-val">' + esc(me.pricing ? (me.pricing.peak ? "现在是高峰价" : "现在是平时价（半价）") : "—") + "</span>", me.pricing ? "高峰：" + esc(me.pricing.peakHours || "") : "") + "</div>" +
        '<p class="st-foot"><button type="button" class="st-btn" data-x="logout">退出登录…</button></p>';
      if (!u) fetch("/api/usage").then(function (r) { return r.json(); }).then(function (j) { if (!j.error) { usage = j; if (!pg.hidden) renderAccount(); } }, function () {});
    }

    // ---- 通用：关于本机、登录项 ----
    var storageText = "…";
    function renderGeneral() {
      var lay = A && A.remote && A.remote() ? A.layout() : null, pg = pages.general;
      var box = lay ? (lay.driver === "seatbelt" ? "真沙盒 · macOS（" + (lay.os || "") + "）" : "真沙盒 · Linux 容器（" + (lay.os || "") + "）") : "浏览器里的沙盒";
      var login = TSU_DESK.settings.loginItems();
      pg.innerHTML = "<h2>通用</h2><h3>关于本机</h3><div class=\"st-group\">" +
        row("名称", '<span class="st-val">macOS Simulator</span>') + row("版本", '<span class="st-val">' + esc(A && A.SPIRIT ? "v" + A.SPIRIT.version : "—") + "</span>") +
        row("沙盒", '<span class="st-val">' + esc(box) + "</span>", lay ? esc(lay.home || "") : "文件存在这个浏览器里（IndexedDB）") + row("储存空间", '<span class="st-val" data-x="storage">' + esc(storageText) + "</span>") + "</div>" +
        "<h3>登录项</h3><p class=\"st-note\">打开桌面时自动打开这些 App。</p><div class=\"st-group st-list\">" +
        (login.length ? login.map(function (id) { var ap = findApp(id); return '<div class="st-row"><span class="st-label st-app"><span class="ibox" style="--s:0.36">' + iconHTML(id) + "</span>" + esc(ap ? ap.name : id) + '</span><span class="st-ctl"><button type="button" class="st-mini" data-x="unlogin" data-id="' + esc(id) + '" title="移除">−</button></span></div>'; }).join("") : '<div class="st-row"><span class="st-label st-dim">没有登录项</span></div>') +
        '<div class="st-row st-add"><button type="button" class="st-mini" data-x="addlogin" title="添加">＋</button></div></div>' + jsonLink(DESK_JSON);
      var usedFiles = 0, bytes = 0;
      try { window.SANDBOX.walk("/").forEach(function (k) { var st = SANDBOX.stat(k); if (st && !st.dir) { usedFiles++; bytes += st.size || 0; } }); } catch (e) { /* 还没好 */ }
      var fmt = function (b) { return b < 1e6 ? Math.max(1, Math.round(b / 1e3)) + " KB" : b < 1e9 ? (b / 1e6).toFixed(1) + " MB" : (b / 1e9).toFixed(1) + " GB"; };
      storageText = usedFiles + " 个文件，" + fmt(bytes);
      if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(function (e) { var el = pg.querySelector('[data-x="storage"]'); if (el && e && e.quota) el.textContent = storageText + " · 浏览器已用 " + fmt(e.usage || 0) + " / " + fmt(e.quota); });
      var el0 = pg.querySelector('[data-x="storage"]');
      if (el0) el0.textContent = storageText;
    }

    // ---- 通知：每个 App 的样式 ----
    function renderNotify() {
      var list = appList().filter(function (a) { return ["launchpad", "missioncontrol"].indexOf(a.id) < 0; }), pg = pages.notify;
      pg.innerHTML = "<h2>通知</h2><h3>应用程序通知</h3><p class=\"st-note\">横幅：几秒后自己收起；提醒：一直留着，直到你点掉；关：这个 App 的通知都不要。勿扰模式下只进通知中心。</p><div class=\"st-group st-list\">" +
        list.map(function (a) { return '<div class="st-row"><span class="st-label st-app"><span class="ibox" style="--s:0.36">' + a.icon + "</span>" + esc(a.name) + '</span><span class="st-ctl">' + sel("notify:" + a.id, [["banner", "横幅"], ["alert", "提醒"], ["none", "关"]], TSU_DESK.settings.notifyStyle(a.id)) + "</span></div>"; }).join("") + "</div>" + jsonLink(DESK_JSON);
    }
    // ---- 专注模式 ----
    function renderFocus() {
      pages.focus.innerHTML = "<h2>专注模式</h2><div class=\"st-group\">" + row("勿扰模式", sw("focus", dnd()), "打开时通知不弹横幅，照样进通知中心（控制中心里也能开关）。") + "</div>" + jsonLink(DESK_JSON);
    }

    // ---- Paimon：agent 的管理（同 paimon ls 的分组、编号、状态）+ 所有 agent 共用的设置（settings.json）----
    var GROUP = { f: "#3cb05b", b: "#718ef4", o: "" }, ACCESS_ZH = { none: "只有自己的文件夹", read: "只读", rw: "读写" }, EFFORT_ZH = { off: "关", low: "低", high: "高", max: "最高" };
    var STATUS_ZH = { balance: "余额", context: "上下文", cost: "花费", model: "模型", cwd: "当前目录", access: "权限" }, FOOTER_ZH = { duration: "用时", time: "完成时间", tokens: "token 数", cost: "花费" };
    var agentOpen = null, showArchived = false;
    function statusOf(a) {
      var r = A.runtime(a.id), st = r.state(), working = st === "working" || r.tasks.some(function (x) { return x.status === "running"; });
      var open = !!document.querySelector('.tpane'), openHere = false;
      try { openHere = Array.prototype.some.call(document.querySelectorAll(".tpane"), function (el) { return el.pane && el.pane.program && el.pane.program.agentId === a.id; }); } catch (e) { openHere = false; }
      var g = openHere ? "f" : st !== "idle" || working ? "b" : "o";
      return { g: g, tag: g === "o" ? "[O]" : (working ? "[W]" : "[NW]") + " [" + g.toUpperCase() + "]", tail: String(r.tail() || "").replace(/\s+/g, " "), open: open };
    }
    function renderPaimon() {
      var pg = pages.paimon;
      if (!A || !A.list) { pg.innerHTML = "<h2>Paimon</h2><p class=\"st-note\">agent 还没载入。</p>"; return; }
      if (agentOpen && A.get(agentOpen)) return renderAgent(A.get(agentOpen));
      agentOpen = null;
      var cfg = A.cfg, all = A.list(), st = {}, n = { f: 0, b: 0, o: 0 }, ms = A.models(), arch = A.archived();
      all.forEach(function (a) { st[a.id] = statusOf(a); });
      var order = ["f", "b", "o"].reduce(function (acc, g) { return acc.concat(all.filter(function (a) { return st[a.id].g === g; })); }, []);
      var modelName = function (id) { var m = A.modelOf(id); return m ? m.name : id || "—"; };
      pg.innerHTML = '<div class="st-hero small"><span class="st-pm">✻</span><div><h2>Paimon</h2><p>' + all.length + " 个 agent · v" + esc(A.SPIRIT.version) + '</p></div><button type="button" class="st-btn" data-x="newagent">新建 agent</button></div>' +
        '<h3>Agent</h3><div class="st-group st-list st-agents">' +
        (order.length ? order.map(function (a) {
          var s0 = st[a.id], num = ++n[s0.g] + ".";
          return '<div class="st-row st-ag" data-x="agent" data-id="' + a.id + '"><span class="st-label"><span class="st-num" style="color:' + (GROUP[s0.g] || "inherit") + '">' + num + "</span><b>" + esc(a.name) + '</b><span class="st-tag" style="color:' + (GROUP[s0.g] || "#888") + '">' + s0.tag + "</span><small>" + esc(modelName(a.model)) + " · " + esc(ACCESS_ZH[a.access || "read"]) + (s0.tail ? " · " + esc(s0.tail.slice(0, 80)) : "") + '</small></span><span class="st-ctl st-chev">›</span></div>';
        }).join("") : '<div class="st-row"><span class="st-label st-dim">还没有 agent。终端里敲 paimon，或者点「新建 agent」。</span></div>') + "</div>" +
        (arch.length ? '<p class="st-foot"><button type="button" class="st-link" data-x="toggleArch">' + (showArchived ? "收起已归档的" : "已归档 " + arch.length + " 个") + "</button></p>" +
          (showArchived ? '<div class="st-group st-list">' + arch.map(function (a) { return '<div class="st-row"><span class="st-label"><b>' + esc(a.name) + "</b><small>" + esc(a.id) + '</small></span><span class="st-ctl"><button type="button" class="st-btn" data-x="restore" data-id="' + a.id + '">恢复</button></span></div>'; }).join("") + "</div>" : "") : "") +
        "<h3>新 agent</h3><div class=\"st-group\">" + row("默认模型", sel("cfg:defaultModel", [["", "第一个（" + (ms[0] ? ms[0].name : "—") + "）"]].concat(ms.map(function (m) { return [m.id, m.name]; })), cfg.defaultModel || "")) + "</div>" +
        "<h3>终端</h3><div class=\"st-group\">" +
          row("状态栏显示", chips("cfgset:statusline", A.STATUS_FIELDS, STATUS_ZH, cfg.statusline || [])) +
          row("每一问结尾显示", chips("cfgset:footer", A.FOOTER_FIELDS, FOOTER_ZH, cfg.footer || [])) +
          row("思考过程", sel("cfg:thinking", [["hidden", "隐藏"], ["collapsed", "折叠（一行）"], ["expanded", "展开"]], cfg.thinking)) +
          row("长行（代码、改动、输出）", sel("cfg:wrap", [["wrap", "折行"], ["clip", "截断"]], cfg.wrap)) +
          row("时间格式", sel("cfg:time", [["12h", "12 小时"], ["24h", "24 小时"]], cfg.time)) +
          row("输入框里的提示", sw("cfg:tips", cfg.tips !== false)) + row("有新输出时滚到最下面", sw("cfg:autoscroll", cfg.autoscroll !== false)) + row("选中即拷贝", sw("cfg:copyOnSelect", !!cfg.copyOnSelect)) + "</div>" +
        "<h3>工具</h3><div class=\"st-group\">" +
          row("沙盒工具", sw("cfg:sandbox", cfg.sandbox !== false), "Bash、Read、Write、Edit、Glob、Grep") + row("网页搜索", sw("cfg:webSearch", cfg.webSearch !== false), "要服务器配了搜索的 Key") + row("读网页", sw("cfg:webFetch", cfg.webFetch !== false)) + "</div>" +
        "<h3>自定义指令</h3><p class=\"st-note\">写进每个 agent 的提示词里（同 Claude Code 的 CLAUDE.md）。</p><textarea class=\"st-ta\" data-x=\"cfg:instructions\" rows=\"5\" spellcheck=\"false\" placeholder=\"例如：回答用中文；改代码前先说计划。\">" + esc(cfg.instructions || "") + "</textarea>" +
        jsonLink("/.paimon/config/settings.json");
    }
    function renderAgent(a) {
      var pg = pages.paimon, r = A.runtime(a.id), s0 = statusOf(a), ms = A.models(), hist = A.history ? A.history(a.id) : 0;
      pg.innerHTML = '<p class="st-back"><button type="button" class="st-link" data-x="back">‹ Paimon</button></p>' +
        '<div class="st-hero small"><span class="st-pm" style="background:' + (GROUP[s0.g] || "#8e8e93") + '">' + esc(a.name.slice(0, 1).toUpperCase()) + "</span><div><h2>" + esc(a.name) + '</h2><p><span style="color:' + (GROUP[s0.g] || "#888") + '">' + s0.tag + "</span> · " + esc(a.id) + (s0.tail ? " · " + esc(s0.tail.slice(0, 60)) : "") + "</p></div></div>" +
        '<div class="st-group">' +
          row("名称", '<input class="st-in" data-x="name" value="' + esc(a.name) + '" spellcheck="false"><button type="button" class="st-btn" data-x="rename">重命名</button>', '<span data-x="nameErr"></span>') +
          row("模型", sel("ag:model", ms.map(function (m) { return [m.id, m.name]; }), a.model)) +
          row("思考强度", sel("ag:effort", A.EFFORTS.map(function (e) { return [e, EFFORT_ZH[e] || e]; }), a.effort || "high")) +
          row("出了自己文件夹的权限", sel("ag:access", [["none", ACCESS_ZH.none], ["read", ACCESS_ZH.read], ["rw", ACCESS_ZH.rw]], a.access || "read"), "终端里 shift+tab 也能切") + "</div>" +
        '<div class="st-group">' + row("家目录", '<span class="st-val">' + esc(r.home()) + "</span>") + row("履历", '<span class="st-val">' + (A.fmt ? A.fmt.k(hist) : hist) + " tokens</span>") +
          row("创建于", '<span class="st-val">' + esc(new Date(a.created).toLocaleString("zh-CN")) + "</span>") +
          row("身份卡", '<button type="button" class="st-link" data-x="identity">在编辑器中查看…</button>') + "</div>" +
        '<p class="st-foot"><button type="button" class="st-btn primary" data-x="openterm">在终端中打开</button> <button type="button" class="st-btn" data-x="archive">归档</button></p>';
    }

    // ---- 控件 → 设置 ----
    function onX(e) {
      var t = e.target.closest("[data-x]");
      if (!t) return;
      var x = t.dataset.x, id = t.dataset.id;
      if (e.type === "click") {
        if (x === "login") location.href = "/auth/login";
        else if (x === "logout") { if (confirm("退出登录？")) location.href = "/auth/logout"; }
        else if (x === "unlogin") { setLoginItem(id, false); renderGeneral(); }
        else if (x === "addlogin") {
          var cur = TSU_DESK.settings.loginItems();
          popup(appList().filter(function (a) { return cur.indexOf(a.id) < 0 && ["launchpad", "missioncontrol"].indexOf(a.id) < 0; }).map(function (a) { return item(a.name, "", function () { setLoginItem(a.id, true); renderGeneral(); }); }), { above: t });
        }
        else if (x === "newagent") { var na = A.create({}); agentOpen = na.id; renderPaimon(); }
        else if (x === "agent") { agentOpen = id; renderPaimon(); pages.paimon.scrollTop = 0; main.scrollTop = 0; }
        else if (x === "back") { agentOpen = null; renderPaimon(); }
        else if (x === "toggleArch") { showArchived = !showArchived; renderPaimon(); }
        else if (x === "restore") { A.unarchive(id); renderPaimon(); }
        else if (x === "rename") {
          var inp = pages.paimon.querySelector('[data-x="name"]'), err = A.runtime(agentOpen).rename(inp.value.trim());
          var el = pages.paimon.querySelector('[data-x="nameErr"]');
          if (err) { if (el) el.textContent = err; } else renderPaimon();
        }
        else if (x === "identity") { if (window.TSU_IDE) TSU_IDE.open((A.remote() && A.layout().paimon ? "/.paimon" : "/.paimon") + "/IdentityData/" + agentOpen + ".json"); }
        else if (x === "openterm") { if (window.TSU_TERM) TSU_TERM.agent(agentOpen); }
        else if (x === "archive") { A.archive(agentOpen); agentOpen = null; renderPaimon(); }
        return;
      }
      // change / input
      if (x.indexOf("notify:") === 0) { setNotifyStyle(x.slice(7), t.value); return; }
      if (x === "focus") { setSetting("focus", t.checked); syncCC && syncCC(); return; }
      if (x.indexOf("cfg:") === 0) {
        var k = x.slice(4), v = t.type === "checkbox" ? t.checked : t.value;
        if (k === "instructions" && e.type === "input") { clearTimeout(t._t); t._t = setTimeout(function () { A.setCfg("instructions", t.value); }, 500); return; }
        A.setCfg(k, v);
        return;
      }
      if (x.indexOf("cfgset:") === 0) {
        var key = x.slice(7), boxes = pages.paimon.querySelectorAll('[data-x="' + x + '"]'), vals = [];
        boxes.forEach(function (b) { if (b.checked) vals.push(b.value); });
        A.setCfg(key, vals);
        return;
      }
      if (x.indexOf("ag:") === 0 && agentOpen) {
        var rt0 = A.runtime(agentOpen), f = x.slice(3);
        if (f === "model") rt0.setModel(t.value);
        else if (f === "effort") rt0.setEffort(t.value);
        else if (f === "access") rt0.setAccess(t.value);
      }
    }
    main.addEventListener("click", function (e) {
      var j = e.target.closest("[data-json]");
      if (j) { if (window.TSU_IDE) { if (j.dataset.json === DESK_JSON) writeDeskJson(); TSU_IDE.open(j.dataset.json); } return; }
      onX(e);
    });
    main.addEventListener("change", onX);
    main.addEventListener("input", function (e) { var t = e.target; if (t && t.dataset && t.dataset.x === "cfg:instructions") onX(e); });
    main.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.dataset && e.target.dataset.x === "name") { e.preventDefault(); var b = pages.paimon.querySelector('[data-x="rename"]'); if (b) b.click(); } });
    var RENDER = { account: renderAccount, general: renderGeneral, notify: renderNotify, focus: renderFocus, paimon: renderPaimon };
    var curPage = null;
    renderSettingsPages = function () { renderAccountCard(); if (curPage && RENDER[curPage] && !pages[curPage].hidden) RENDER[curPage](); };
    // agent 变了、设置变了、登录状态回来：看得见的那一页跟着换；Paimon 页开着时每两秒刷一下状态（在跑的时长）
    if (A && A.on) A.on(function (type) {
      if (type === "me") { usage = null; renderAccountCard(); }
      if (settingsWin.state === "closed" || settingsWin.state === "min") return;
      if ((type === "agents" || type === "cfg") && curPage === "paimon") { var fe = document.activeElement; if (!(fe && pages.paimon.contains(fe) && /INPUT|TEXTAREA|SELECT/.test(fe.tagName))) renderPaimon(); }
      if (type === "me" && (curPage === "account" || curPage === "general")) RENDER[curPage]();
    });
    setInterval(function () {
      if (curPage !== "paimon" || agentOpen || settingsWin.state === "closed" || settingsWin.state === "min" || document.hidden) return;
      var fe = document.activeElement;
      if (fe && pages.paimon.contains(fe) && /INPUT|TEXTAREA|SELECT/.test(fe.tagName)) return;
      renderPaimon();
    }, 2000);
    paneEl.textContent = "";
    paneEl.classList.add("st");
    paneEl.appendChild(side);
    paneEl.appendChild(main);
    var show = function (id) {
      side.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b.dataset.page === id); });
      Object.keys(pages).forEach(function (k) { pages[k].hidden = k !== id; });
      localStorage.setItem("tsu-settings-page", id);
      curPage = id;
      if (RENDER[id]) RENDER[id]();
      main.scrollTop = 0;
    };
    side.addEventListener("click", function (e) { var b = e.target.closest("button[data-page]"); if (b) show(b.dataset.page); });
    renderAccountCard();
    show(pages[localStorage.getItem("tsu-settings-page")] ? localStorage.getItem("tsu-settings-page") : "general");
    // 「桌面与程序坞」页的控件：data-k 就是设置的名字
    var onCtl = function (e) {
      var t = e.target, k = t.dataset && t.dataset.k;
      if (!k) return;
      setSetting(k, t.type === "checkbox" ? t.checked : t.type === "range" ? +t.value : t.value);
    };
    pages.dock.addEventListener("input", onCtl);
    pages.dock.addEventListener("change", onCtl);
    TSU_DESK.settingsPage = function (id) { if (pages[id]) { show(id); apps.settings.show(); } };
  })();
  function syncDockPage() {
    pane.querySelectorAll("[data-k]").forEach(function (t) {
      var v = dset[t.dataset.k];
      if (t.type === "checkbox") t.checked = !!v; else if (String(t.value) !== String(v)) t.value = v;
      if (t.type === "range") t.style.setProperty("--p", (t.value - t.min) / (t.max - t.min) * 100 + "%");
    });
  }
  applyDockLook();
  // 台前调度：等别的 App 的窗口都建好再开
  if (dset.stageManager) document.addEventListener("DOMContentLoaded", function () { setStage(true); });

  // ======== Dock 图标的名字（同 macOS）：图标正上方一个小标签；不用浏览器自带的 title 提示（样子不对，还会出现在奇怪的地方）========
  // title 属性换成 data-name；a.title 照样能读能写（其余代码不用改）
  function detitle(a) {
    if (!a || !a.classList || !a.classList.contains("app") || !a.hasAttribute("title")) return;
    a.dataset.name = a.getAttribute("title");
    a.removeAttribute("title");
    if (!Object.getOwnPropertyDescriptor(a, "title")) Object.defineProperty(a, "title", { configurable: true, get: function () { return this.dataset.name || ""; }, set: function (v) { this.dataset.name = v; } });
  }
  dock.querySelectorAll(".app").forEach(detitle);
  new MutationObserver(function (ms) {
    ms.forEach(function (m) {
      if (m.type === "attributes") detitle(m.target);
      Array.prototype.forEach.call(m.addedNodes || [], function (n) { if (n.nodeType === 1) detitle(n); });
    });
  }).observe(dock, { childList: true, subtree: true, attributes: true, attributeFilter: ["title"] });
  var dockLabel = document.createElement("div");
  dockLabel.id = "dock-label";
  dockLabel.hidden = true;
  desk.appendChild(dockLabel);
  var labelFor = null;
  function placeLabel() {
    if (!labelFor || !labelFor.isConnected) { dockLabel.hidden = true; return; }
    var r = labelFor.getBoundingClientRect(), pos = dk("dockPosition");
    dockLabel.className = "at-" + pos;
    if (pos === "left") { dockLabel.style.left = r.right + 10 + "px"; dockLabel.style.top = r.top + r.height / 2 + "px"; }
    else if (pos === "right") { dockLabel.style.left = r.left - 10 + "px"; dockLabel.style.top = r.top + r.height / 2 + "px"; }
    else { dockLabel.style.left = r.left + r.width / 2 + "px"; dockLabel.style.top = r.top - 10 + "px"; }
  }
  dock.addEventListener("pointerover", function (e) {
    var a = e.target.closest && e.target.closest(".app");
    if (!a || document.body.classList.contains("dragging") || e.buttons) { dockLabel.hidden = true; labelFor = null; return; }
    labelFor = a;
    dockLabel.textContent = a.dataset.name || a.dataset.app || "";
    dockLabel.hidden = !dockLabel.textContent;
    placeLabel();
  });
  dock.addEventListener("pointermove", function () { if (labelFor) placeLabel(); }); // 放大效果会挪动图标
  dock.addEventListener("pointerleave", function () { dockLabel.hidden = true; labelFor = null; });
  dock.addEventListener("pointerdown", function () { dockLabel.hidden = true; });
  dock.addEventListener("dragstart", function () { dockLabel.hidden = true; });

  syncSettings();
})();
