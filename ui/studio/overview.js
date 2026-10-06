// overview.js —— 标签页概览（同 macOS 的调度中心）：⇧⌘\、标题栏的概览按钮、菜单里的「标签页概览」。
//   打开：当前标签页的内容从它原来的位置缩进它那一格，其余的淡入；主侧栏、编辑区、面板、辅助侧栏压暗模糊（标题栏不盖）。
//   每一格是这个标签页真实的样子：把它的面板（终端界面、图形界面、设置、资源管理器……）复制一份缩小放进去；
//     不在屏幕上的标签页先在屏幕外按编辑区的大小画一遍再复制；终端的画布写成文字；内嵌网页用原生截图（web.snapshot）。
//   排法同调度中心：一样大小，一排排铺满、居中，名字在下面；有分屏（多个编辑组）或多个窗口时，顶上一排「空间」缩略图，点一个只看那一组。
//   键盘：方向键在格子间走、回车打开、⌘W / ⌫ 关掉选中的、Esc 回去、直接打字是搜索；拖一格到别的位置换顺序（能换到别的编辑组）。
//   原来 browser.js 里那份（.ts-overview）不再用：一出现就拿掉、换成这里的。
(function () {
  "use strict";
  var root = document.documentElement, N = window.nadosNative;
  var T = function () { return window.TSU_TERM; };
  var front = function () { return T() && T().front ? T().front() : null; };
  var reduce = function () { return window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches; };
  var cmds = null;
  if (N && N.call) N.call("info").then(function (i) { cmds = (i && i.commands) || []; }).catch(function () { cmds = []; });
  var canSnap = function () { return !!(N && cmds && cmds.indexOf("web.snapshot") >= 0); };
  var ICON = {
    search: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="7" cy="7" r="4.6"/><path d="M10.4 10.4L14 14"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.7 2.7 3.9 5.7 3.9 9s-1.2 6.3-3.9 9M12 3C9.3 5.7 8.1 8.7 8.1 12s1.2 6.3 3.9 9"/></svg>',
  };
  var cur = null, lastToggle = 0, pending = null;
  // 内嵌网页（原生的 WKWebView 叠在页面上）：藏起来的截不到——看得见的时候隔一会儿截一张留着，概览里用
  var SNAP = new WeakMap();
  // 每个标签页上一次画对了的样子（复制好的一份）：概览收起时留下每一格的，下次打开先放它——只在大小没变时用（转了屏、改了窗口大小，旧的那份是按旧的大小排的：内容挤在上半截、下面一大块空）
  var LAST = new WeakMap();
  var scrollsIn = function (el) { var out = []; (function rec(e) { if (e.nodeType !== 1) return; if (e.scrollTop || e.scrollLeft) out.push([e, e.scrollTop, e.scrollLeft, false]); for (var i = 0; i < e.children.length; i++) rec(e.children[i]); })(el); return out; };
  var keepLast = function (P, el, sc, nat) { if (P && el) LAST.set(P, { el: el, scrolls: sc || scrollsIn(el), w: nat ? nat.w : 0, h: nat ? nat.h : 0 }); };
  var putLast = function (view, L) { view.appendChild(L.el); L.scrolls.forEach(function (s) { try { if (s[3]) s[0].scrollTop = s[0].scrollHeight; else s[0].scrollTop = s[1]; s[0].scrollLeft = s[2]; } catch (e) { /* 不能滚 */ } }); };
  var visibleWeb = function (P) { var V = P.program; return !!(V && V.page === "web" && V.id && !P.closed && P.el.isConnected && V.shown && V.shown()); };
  var snapWeb = function (P) { var V = P.program; return N.call("web.snapshot", { id: V.id, width: 640 }).then(function (u) { if (typeof u === "string" && u) SNAP.set(V, u); return u || null; }, function () { return null; }); };
  setInterval(function () {
    if (document.hidden || cur || pending || !canSnap() || !T() || !T().panes) return;
    if (document.querySelector(".ov-wrap, .st-menu, .st-palette, .xp-ql, .st-float")) return; // 盖着的时候它是藏起来的
    T().panes().forEach(function (P) { if (visibleWeb(P)) snapWeb(P); }); // （不再平时隔 5 秒复制看着的那个标签页：在跑的会话一直在变，每次复制都要排一遍版，点什么都卡一下）
  }, 5000);

  // ---- 两种编辑区：编辑组（Studio：每组一条标签条）/ 老的标签页（一个标签页里分屏）----
  function model(tw) {
    var ws = tw.ws;
    if (typeof ws.groups === "function") return {
      groups: function () { return ws.groups(); },
      panes: function () { return ws.all(); },
      groupOf: function (p) { return ws.groupOf(p); },
      active: function () { return ws.active; },
      show: function (p) { ws.show(p); },
      close: function (p) { ws.closePane(p); },
      // 换顺序：放到 before 前面（没有 before 就放到 after 后面）；可以换到别的组
      move: function (p, before, after) {
        var ref = before || after, tg = ws.groupOf(ref), sg = ws.groupOf(p);
        if (!tg || !sg || p === ref) return;
        var wasActive = ws.active === p;
        if (sg !== tg) { ws.detach(p); if (ws.groups().indexOf(tg) < 0) return; }
        else sg.editors.splice(sg.editors.indexOf(p), 1);
        var a = tg.editors, k = before ? a.indexOf(before) : a.indexOf(after) + 1;
        a.splice(k < 0 ? a.length : k, 0, p);
        if (sg !== tg) {
          if (wasActive) { tg.active = p; ws.group = tg; ws.active = p; }
          if (!ws.group || ws.groups().indexOf(ws.group) < 0) ws.group = ws.groupOf(ws.active) || ws.groups()[0] || null;
          if (ws.active && !ws.groupOf(ws.active)) ws.active = ws.group ? ws.group.active : null;
        }
        ws.layout();
      },
      moveTo: function (p, g) { var last = g.editors[g.editors.length - 1]; if (last && last !== p) this.move(p, null, last); },
    };
    var paneOf = function (t) { return t.active || ws.leaves(t.root)[0].pane; };
    var tabIx = function (p) { return ws.tabs.findIndex(function (t) { return ws.leaves(t.root).some(function (l) { return l.pane === p; }); }); };
    return {
      groups: function () { return []; },
      panes: function () { return ws.tabs.map(paneOf); },
      groupOf: function () { return null; },
      active: function () { return ws.active; },
      show: function (p) { var i = tabIx(p); if (i >= 0) { ws.select(i); if (ws.activate) ws.activate(p); } },
      close: function (p) { var i = tabIx(p); if (i >= 0) ws.closeTab(i); },
      move: function (p, before, after) {
        var i = tabIx(p), ref = before || after;
        if (i < 0 || !ref) return;
        var curTab = ws.tabs[ws.cur], t = ws.tabs.splice(i, 1)[0], j = tabIx(ref);
        if (j < 0) { ws.tabs.splice(i, 0, t); return; }
        ws.tabs.splice(before ? j : j + 1, 0, t);
        ws.cur = Math.max(0, ws.tabs.indexOf(curTab));
        ws.layout();
      },
      moveTo: function () {},
    };
  }
  var titleOf = function (P) { try { return P.title ? P.title() : ""; } catch (e) { return ""; } };
  // 这个标签页是哪一种「App」（App Exposé 按这个挑）：Claude Code、Codex、Paimon 的会话，代码（文件），网页，设置（设置、快捷键、扩展、更新说明…），文件（资源管理器），终端
  var KINDS = { claude: "Claude Code", codex: "Codex", paimon: "Paimon", code: "代码", web: "网页", settings: "设置", files: "文件", terminal: "终端", other: "其他" };
  function kindOf(P) {
    var pr = (P && P.program) || {}, aid = String(pr.agentId || ""), pg = String(pr.page || "");
    if (/^cc:/.test(aid) || pg === "claude") return "claude";
    if (/^cx:/.test(aid) || pg === "codex") return "codex";
    if (aid || pg === "paimon" || pg === "ca-new") return "paimon";
    if (pr.pty) return "terminal";
    if (pg === "file") return "code";
    if (pg === "web") return "web";
    if (pg === "explorer") return "files";
    if (/^(settings|keys|extension|changelog|account|advanced|translate|history)$/.test(pg)) return "settings";
    return "other";
  }
  var addrOf = function (P) { try { var a = window.TSU_BROWSER && TSU_BROWSER.address ? TSU_BROWSER.address(P) : null; return (a && a.url) || ""; } catch (e) { return ""; } };

  // ---- 复制一个面板：DOM 原样复制；滚动位置、输入框里的字、画布的像素跟过去；iframe、视频不复制（会重新加载），换成占位 ----
  function cloneEl(src) {
    // 大会话几千块：整个复制（再缩小）又慢又占内存——滚动的那一块里只复制看得见的那一段（上下各多一屏）：
    //   整块都在外面的不往里走；前面省掉的换成一样高的空块（滚动位置照原样对得上），后面的不要；整块都在里面的照旧整个复制
    var scrolls = [], swaps = [];
    var rec = function (s, d) { if (s.scrollTop || s.scrollLeft) scrolls.push([d, s.scrollTop, s.scrollLeft, s.scrollTop > 0 && s.scrollTop + s.clientHeight >= s.scrollHeight - 2]); };
    var walk = function (s, lo, hi, inside) {
      var d = s.cloneNode(false);
      if (s.nodeType !== 1) return d;
      var tag = s.tagName, kids = s.childNodes, i;
      rec(s, d);
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") { try { d.value = s.value; if (s.type === "checkbox" || s.type === "radio") d.checked = s.checked; } catch (e) { /* 只读的 */ } }
      else if (tag === "CANVAS") { try { if (s.width && s.height) { d.width = s.width; d.height = s.height; d.getContext("2d").drawImage(s, 0, 0); } } catch (e) { /* 跨域、WebGL 取不到 */ } }
      else if (tag === "VIDEO" || tag === "IFRAME" || tag === "EMBED" || tag === "OBJECT" || tag === "AUDIO") swaps.push([d, s]);
      if (!inside && s.clientHeight > 0 && s.scrollHeight > s.clientHeight + 2) { // 滚动的那一块：从这里往下按它看得见的范围
        var oy = getComputedStyle(s).overflowY;
        if (oy === "auto" || oy === "scroll") { var br = s.getBoundingClientRect(); lo = br.top - br.height; hi = br.bottom + br.height; }
      }
      if (lo != null && !inside && tag !== "SELECT") {
        var top0 = null, kept = false;
        for (i = 0; i < kids.length; i++) {
          var k = kids[i];
          if (k.nodeType !== 1) { if (kept || top0 === null) d.appendChild(k.cloneNode(true)); continue; }
          var r = k.getBoundingClientRect();
          if (!r.width && !r.height) { if (kept || top0 === null) d.appendChild(walk(k, lo, hi, false)); continue; }
          if (top0 === null) top0 = r.top;
          if (r.bottom < lo) continue;
          if (r.top > hi) break;
          if (!kept) { kept = true; if (r.top - top0 > 0.5) { var sp = document.createElement("div"); sp.style.height = (r.top - top0) + "px"; d.appendChild(sp); } }
          d.appendChild(walk(k, lo, hi, r.top >= lo && r.bottom <= hi));
        }
        return d;
      }
      if (!src.isConnected && s.childElementCount > 80) { // 不在页面上（量不了）：一长串的只要最后几十块（一般看的就是最后面）
        var el0 = [];
        for (i = kids.length - 1; i >= 0 && el0.length < 40; i--) if (kids[i].nodeType === 1) el0.unshift(kids[i]);
        el0.forEach(function (k) { d.appendChild(walk(k, lo, hi, inside)); });
        return d;
      }
      for (i = 0; i < kids.length; i++) d.appendChild(walk(kids[i], lo, hi, inside));
      return d;
    };
    var c = walk(src, null, null, false);
    swaps.forEach(function (x) {
      var d = x[0], s = x[1], ph;
      if (s.tagName === "VIDEO" && s.videoWidth) { ph = document.createElement("canvas"); ph.width = s.videoWidth; ph.height = s.videoHeight; try { ph.getContext("2d").drawImage(s, 0, 0); } catch (e) { /* 跨域 */ } }
      else { ph = document.createElement("div"); ph.className = "tov-ph"; }
      if (typeof d.className === "string" && d.className) ph.className += " " + d.className;
      ph.style.cssText = d.style.cssText;
      if (d.parentNode) d.parentNode.replaceChild(ph, d);
    });
    c.classList.remove("active");
    c.removeAttribute("id");
    c.querySelectorAll("[id]").forEach(function (e) { e.removeAttribute("id"); });
    c.setAttribute("inert", "");
    c.setAttribute("aria-hidden", "true");
    return { el: c, scrolls: scrolls };
  }

  function Overview(tw, opts) {
    var O = { tw: tw, closing: false }, M = model(tw), app = (opts && opts.app) || null;
    var gui = root.classList.contains("st-gui");
    var host = tw.el.querySelector(":scope > .body") || tw.el;
    var areaEl = tw.el.querySelector(".st-row0") || tw.el.querySelector(".tlab") || tw.panesEl;
    var ov = document.createElement("div");
    ov.className = "tov ov-wrap " + (gui ? "tov-gui" : "tov-tui"); // ov-wrap：webview.js 看到它盖着就先把原生的网页藏起来
    ov.tabIndex = -1;
    ov.innerHTML = '<div class="tov-bg"></div><div class="tov-top"><label class="tov-search">' + ICON.search + '<input class="tov-q" type="text" placeholder="搜索标签页" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off"></label><div class="tov-strip" hidden></div></div><div class="tov-grid"></div><div class="tov-empty" hidden></div>';
    var qi = ov.querySelector(".tov-q"), strip = ov.querySelector(".tov-strip"), grid = ov.querySelector(".tov-grid"), topEl = ov.querySelector(".tov-top"), empty = ov.querySelector(".tov-empty");
    O.qi = qi;
    var place = function () { var r = areaEl.getBoundingClientRect(); ov.style.left = r.left + "px"; ov.style.top = r.top + "px"; ov.style.width = r.width + "px"; ov.style.height = r.height + "px"; };
    place();

    // 编辑区一格的大小（每一格按它的比例、按它的大小排版再缩小）；转屏、改窗口大小时重新量
    function measureArea() {
      var pr = tw.panesEl.getBoundingClientRect(), a = M.active(), g = a && M.groupOf(a), chrome = 0;
      if (g && g.el && g.body) chrome = Math.max(0, g.el.getBoundingClientRect().height - g.body.getBoundingClientRect().height);
      else if (a && a.el.isConnected) chrome = Math.max(0, pr.height - a.el.getBoundingClientRect().height);
      O.W = Math.max(360, Math.round(pr.width));
      O.H = Math.max(220, Math.round(pr.height - chrome));
    }
    measureArea();
    // 一个标签页「本来」多大、在哪（它那个编辑组里放内容的那块；没有编辑组就是整个编辑区）——调度中心按这个比例、这个方位排
    function natural(P) {
      var pr = tw.panesEl.getBoundingClientRect(), g = M.groupOf(P), el = g && (g.body || g.el), r = el && el.isConnected ? el.getBoundingClientRect() : null;
      var w = r && r.width > 60 ? r.width : O.W, h = r && r.height > 60 ? r.height : O.H;
      return { w: Math.max(240, Math.round(w)), h: Math.max(160, Math.round(h)), cx: r ? r.left + r.width / 2 - pr.left : pr.width / 2, cy: r ? r.top + r.height / 2 - pr.top : pr.height / 2 };
    }
    var base = getComputedStyle(tw.panesEl);
    var cards = new Map(), vis = [], sel = null, filter = null, q = "", geo = null, stage = null, queue = [], staged = false;
    host.appendChild(ov);

    // ---- 一格 ----
    function makeCard(P) {
      var c = { P: P, at: 0, nat: natural(P) }, el = document.createElement("div");
      el.className = "tov-card";
      el.innerHTML = '<div class="tov-shot"><div class="tov-view"></div><i class="tov-dot" hidden></i></div><i class="tov-x" title="关闭标签页">×</i><div class="tov-cap"><span class="tov-pill"></span></div><div class="tov-u"></div>';
      c.el = el; c.shot = el.querySelector(".tov-shot"); c.view = el.querySelector(".tov-view");
      var v = c.view.style;
      v.fontFamily = base.fontFamily; v.fontSize = base.fontSize; v.lineHeight = base.lineHeight; v.color = base.color;
      el.card = c;
      caption(c);
      // 不在页面上的（要先放到屏幕外的台子上画）：这里先不复制——没排版的整页复制又慢又不准，轮到它时（pump）上台、只复制看得见的那段
      var last = LAST.get(P), same = last && (!last.w || (Math.abs(last.w - c.nat.w) < 3 && Math.abs(last.h - c.nat.h) < 3));
      if (last && same && !P.el.isConnected) { putLast(c.view, last); c.dirty = true; c.at = Date.now(); c.seeded = true; } // 先放上一次的样子（再由下面换成新画的）——不是黑的一块；大小变了的不放（按旧大小排的，错位）
      if (P.el.isConnected || !stageable(P)) fill(c, false);
      try { c.obs = new MutationObserver(function () { c.dirty = true; }); c.obs.observe(P.el, { childList: true, subtree: true, characterData: true }); } catch (e) { /* 没有就不刷新 */ }
      grid.appendChild(el);
      cards.set(P, c);
      return c;
    }
    // 名字：图标 + 名字（同标签页上的），分屏时后面带组号；地址在下面（指着、选中时出来）
    function caption(c) {
      var P = c.P, pill = c.el.querySelector(".tov-pill"), fake = document.createElement("div");
      fake.innerHTML = "<span></span>";
      fake.firstChild.textContent = titleOf(P);
      if (window.TSU_BROWSER && TSU_BROWSER.fav) try { TSU_BROWSER.fav(fake, P); } catch (e) { /* 没有图标 */ }
      pill.innerHTML = fake.innerHTML;
      var wk = false; try { wk = !!(P.program && P.program.working && P.program.working()); } catch (e) { wk = false; }
      c.el.classList.toggle("busy", wk); // 图标的颜色同标签页：在跑是它的颜色（Claude 的橙），闲着灰的
      var gs = M.groups(), gi = gs.length > 1 ? gs.indexOf(M.groupOf(P)) : -1;
      if (gi >= 0) pill.insertAdjacentHTML("beforeend", '<b class="tov-gi">' + (gi + 1) + "</b>");
      c.el.querySelector(".tov-u").textContent = addrOf(P);
    }
    // 屏幕外（编辑区大小）的台子：不在屏幕上的标签页放上去画（上次画的可能是旧的、或者从没画过）；概览开着时一直放着——
    // 读文件这种后来才画出来的、在跑的 agent 接着输出的，照样更新，变了再复制一份；收起时拿下来（选中的那个由编辑区接回去）
    var stageable = function (P) {
      var pr = P.program;
      return !!pr && !P.closed && (!P.el.parentNode || P.off) && pr.page !== "web" && !pr.pty && !P.el.querySelector("iframe, embed, object, video, audio"); // 藏在同一组后面的（挪到屏幕外的）也一样放上台子
    };
    function stageIn(P) {
      // 不在眼前的会话：不搬到台子上重排（几千行的会话量一遍、排一遍就是概览打开慢的大头）——卡片上是它最后两问的字（lazyCard）
      if (P.program && P.program.agentId) return false;
      if (!stage) { stage = document.createElement("div"); stage.className = "tov-stage"; host.appendChild(stage); }
      var nt = cards.get(P) ? cards.get(P).nat : { w: O.W, h: O.H };
      stage.style.width = nt.w + "px"; stage.style.height = nt.h + "px";
      stage.appendChild(P.el);
      P.el.classList.remove("tpoff"); P.off = false; staged = true; // 台子上要画出来；收起时编辑区再把它放回它那一组（ws.layout）
      // 画过、没变的：P.reshow 只量一下尺寸、回到原来看的位置；后来又有新内容（标脏了）的：也不整段重画，用上次画的那份（贴着底看）
      try {
        if (P.reshow && !P.dirty) P.reshow();
        else if (!(P.program && P.program.agentId) && P.renderNow) P.renderNow(); // 页面（历史记录、设置、访达……）：这次还没画过的先画一遍（不然复制出来是黑的一块），画页面不贵
        else if (P.fit) { P.fit(); if (P.screen) P.screen.scrollTop = P.screen.scrollHeight; }
        else P.renderNow();
      } catch (e) { /* 画不出来：用原来的 */ }
      return true;
    }
    function fill(c, fresh) {
      var P = c.P;
      if (P.closed) return;
      if (fresh && stageable(P) && stageIn(P) === false) { if (!c.seeded) lazyCard(c); return; } // 有上一次的样子就留着它，不换成图标
      var snap = cloneEl(P.el);
      c.view.textContent = "";
      c.view.appendChild(snap.el);
      snap.scrolls.forEach(function (s) { try { if (s[3]) s[0].scrollTop = s[0].scrollHeight; else s[0].scrollTop = s[1]; s[0].scrollLeft = s[2]; } catch (e) { /* 不能滚 */ } });
      special(c, snap.el);
      c.dirty = false;
      c.at = Date.now();
      dot(c);
    }
    // 还没画过的：卡片上一个大图标 + 名字 + 地址（同 Safari 还没载入的标签页），点它照常切过去
    // 会话的字：最后两问（❯ 你说的话、● 回答的头几行），同对话里的样子；拿不到就是 null
    function convText(P) {
      var id = P.program && P.program.agentId, A = window.TSU_AGENTS, rt = null;
      try { rt = id && A && A.runtime ? A.runtime(id) : null; } catch (e) { rt = null; }
      var ts = rt && rt.session ? (rt.session().turns || []) : [], out = [];
      var asks = ts.filter(function (t) { return t && t.ask !== undefined && !t.system; }).slice(-2);
      if (!asks.length) return null;
      asks.forEach(function (t) {
        if (out.length) out.push("");
        String(t.ask || "").split("\n").slice(0, 2).forEach(function (l, i) { out.push((i ? "  " : "❯ ") + l); });
        var ans = String(t.answer || (t.parts || []).filter(function (x) { return x.kind === "text"; }).map(function (x) { return x.text; }).join("\n") || "").replace(/\n{3,}/g, "\n\n").trim();
        if (ans) { out.push(""); ans.split("\n").slice(0, 14).forEach(function (l, i) { out.push((i ? "  " : "● ") + l); }); }
      });
      return out.slice(-40).join("\n");
    }
    function lazyCard(c) {
      var P = c.P, info = document.createElement("div"), fake = document.createElement("div");
      var tx = convText(P);
      if (tx) { // 有字：画成同终端预览那样的一块（底色同对话区）
        var pre = document.createElement("pre"), sc = getComputedStyle(P.el);
        pre.className = "tov-xtext tov-conv";
        pre.textContent = tx;
        if (sc.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(sc.backgroundColor)) pre.style.background = sc.backgroundColor;
        if (sc.color) pre.style.color = sc.color;
        c.view.textContent = "";
        c.view.appendChild(pre);
        c.dirty = false; c.at = Date.now(); c.lazy = true;
        dot(c);
        return;
      }
      fake.innerHTML = "<span></span>";
      if (window.TSU_BROWSER && TSU_BROWSER.fav) try { TSU_BROWSER.fav(fake, P); } catch (e) { /* 没有图标 */ }
      var ico = fake.querySelector(".bfav, svg, img");
      info.className = "tov-web tov-lazy";
      info.innerHTML = (ico ? ico.outerHTML : ICON.globe) + "<b></b><span></span>";
      info.querySelector("b").textContent = titleOf(P);
      info.querySelector("span").textContent = addrOf(P);
      c.view.textContent = "";
      c.view.appendChild(info);
      c.dirty = false; c.at = Date.now(); c.lazy = true;
      dot(c);
    }
    // 终端（xterm 画在画布上）：写成文字；内嵌网页：原生截图，截不到就是图标、名字、网址
    function special(c, cl) {
      var P = c.P, pr = P.program;
      if (pr && pr.pty) {
        var lines = [], x = null;
        try { x = pr.xterm && pr.xterm(); } catch (e) { x = null; }
        if (x && x.buffer) { var b = x.buffer.active; for (var i = b.viewportY; i < b.viewportY + x.rows && i < b.length; i++) { var l = b.getLine(i); lines.push(l ? l.translateToString(true) : ""); } }
        else if (P.shell && P.shell.spec) { try { lines = (P.shell.spec().sh.back || []).slice(-60); } catch (e) { lines = []; } }
        var th = (x && x.options && x.options.theme) || {}, pre = document.createElement("pre");
        pre.className = "tov-xtext";
        pre.textContent = lines.join("\n");
        if (th.background) pre.style.background = th.background;
        if (th.foreground) pre.style.color = th.foreground;
        var xt = cl.querySelector(".xt");
        if (xt) { xt.textContent = ""; xt.appendChild(pre); } else cl.appendChild(pre);
      }
      if (pr && pr.page === "web") {
        var box = cl.querySelector(".wb-box") || cl, st = pr.state || {}, url = pr.arg || st.url || "", info = document.createElement("div");
        box.style.position = "relative";
        info.className = "tov-web";
        info.innerHTML = ICON.globe + "<b></b><span></span>";
        info.querySelector("b").textContent = titleOf(P) || url;
        info.querySelector("span").textContent = url;
        box.appendChild(info);
        c.webInfo = info;
        var u0 = SNAP.get(pr);
        if (u0) showSnap(c, u0);
        webSnap(c);
      }
    }
    function showSnap(c, u) { var info = c.webInfo; if (!info || !info.isConnected && !c.view.contains(info)) return; var img = info.querySelector("img.snap") || document.createElement("img"); img.className = "snap"; img.alt = ""; if (img.src !== u) img.src = u; if (!img.parentNode) info.appendChild(img); }
    function webSnap(c) { var P = c.P; c.snapAt = Date.now(); if (!canSnap() || !P.program || !P.program.id) return; snapWeb(P).then(function (u) { if (u && !O.closing) showSnap(c, u); }); }
    // 在跑的：右上角一个会呼吸的点
    // 在跑的那个点一明一暗：每张卡片自己的快慢（1.8–2.6 秒）和相位（按 agent 算，按墙上的钟接着走）——一排一起同步呼吸很吓人
    function breath(d, id) {
      if (d.dataset.ph === id) return;
      d.dataset.ph = id;
      var h = 0; for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
      var dur = 1.8 + (h % 9) / 10, off = ((h >>> 4) % 997) / 997 * dur;
      d.style.animationDuration = dur.toFixed(2) + "s";
      d.style.animationDelay = (-((Date.now() / 1000 + off) % dur)).toFixed(2) + "s";
    }
    function dot(c) { var d = c.el.querySelector(".tov-dot"), busy = false, wk = false; try { busy = !!(c.P.busy && c.P.busy()); wk = !!(c.P.program && c.P.program.working && c.P.program.working()); } catch (e) { busy = false; } c.el.classList.toggle("busy", wk); d.hidden = !busy && !c.P.bell; d.classList.toggle("bell", !busy && !!c.P.bell); if (busy) breath(d, String((c.P.program && c.P.program.agentId) || c.P.id || "")); }

    // ---- 哪些格子、排在哪 ----
    function list() {
      var ps = M.panes().filter(function (p) { return !p.closed; });
      if (filter && M.groups().indexOf(filter) < 0) filter = null;
      if (filter) ps = ps.filter(function (p) { return M.groupOf(p) === filter; });
      if (app) ps = ps.filter(function (p) { return kindOf(p) === app; });
      if (q) {
        var byTitle = ps.filter(function (p) { return titleOf(p).toLowerCase().indexOf(q) >= 0; });
        ps = byTitle.length ? byTitle : ps.filter(function (p) { return addrOf(p).toLowerCase().indexOf(q) >= 0; });
      }
      return ps;
    }
    function geometry(ps, A) {
      var CAP = 44, GX = 34, GY = 26, items = ps.map(function (P, i) { var n = cards.get(P).nat; return { P: P, i: i, w: n.w, h: n.h, cx: n.cx, cy: n.cy }; });
      var rows = function (sc) {
        var out = [], row = null;
        items.slice().sort(function (a, b) { return a.cy - b.cy || a.cx - b.cx || a.i - b.i; }).forEach(function (it) {
          var w = it.w * sc;
          if (!row || row.items.length && row.w + GX + w > A.w) { row = { items: [], w: 0, h: 0 }; out.push(row); }
          row.w += (row.items.length ? GX : 0) + w; row.items.push(it); row.h = Math.max(row.h, it.h * sc + CAP);
        });
        out.forEach(function (r) { r.items.sort(function (a, b) { return a.cx - b.cx || a.i - b.i; }); });
        out.H = out.reduce(function (t, r) { return t + r.h; }, 0) + GY * Math.max(0, out.length - 1);
        return out;
      };
      // 放得下的最大缩放（不放大；只有一两个时也小一点，看得出是在概览里）
      var lo = 0.04, hi = 0.56;
      for (var it = 0; it < 22; it++) { var mid = (lo + hi) / 2, rr = rows(mid); if (rr.H <= A.h && items.every(function (x) { return x.w * mid <= A.w; })) lo = mid; else hi = mid; }
      var sc = lo, R = rows(sc), y = A.y + Math.max(0, (A.h - R.H) / 2), slots = new Array(items.length);
      R.forEach(function (r) {
        var x = A.x + (A.w - r.w) / 2;
        r.items.forEach(function (it) { var w = it.w * sc, h = it.h * sc; slots[it.i] = { x: x, y: y + (r.h - CAP - h) / 2, w: w, h: h }; x += w + GX; });
        y += r.h + GY;
      });
      return { s: sc, slots: slots, A: A };
    }
    function setCard(c, x, y, w, h) {
      c.x = x; c.y = y; c.w = w; c.h = h;
      if (c.dragging) return;
      var s = c.el.style;
      s.left = x + "px"; s.top = y + "px"; s.width = w + "px";
      c.shot.style.height = h + "px";
      c.view.style.width = c.nat.w + "px"; c.view.style.height = c.nat.h + "px";
      c.view.style.transform = "scale(" + (w / c.nat.w) + ")";
    }
    function layout() {
      var orr = ov.getBoundingClientRect(), tb = topEl.getBoundingClientRect().bottom - orr.top;
      geo = geometry(vis, { x: 44, y: tb + 26, w: Math.max(200, orr.width - 88), h: Math.max(160, orr.height - tb - 26 - 30) });
      vis.forEach(function (P, i) { var s = geo.slots[i]; setCard(cards.get(P), s.x, s.y, s.w, s.h); });
    }
    function sync() {
      var all = M.panes();
      cards.forEach(function (c, P) { if (all.indexOf(P) < 0 || P.closed) { if (c.obs) c.obs.disconnect(); c.el.remove(); cards.delete(P); } });
      vis = list();
      vis.forEach(function (P) { if (!cards.get(P)) { var c = makeCard(P); if (ov.classList.contains("ready")) { c.el.classList.add("enter"); requestAnimationFrame(function () { requestAnimationFrame(function () { c.el.classList.remove("enter"); }); }); } queue.push(c); } else caption(cards.get(P)); });
      cards.forEach(function (c, P) { c.hidden = vis.indexOf(P) < 0; c.el.classList.toggle("gone", c.hidden); });
      if (!sel || vis.indexOf(sel) < 0) sel = vis.indexOf(M.active()) >= 0 ? M.active() : vis[0] || null;
      paintStrip();
      layout();
      mark();
      empty.hidden = !!vis.length;
      empty.textContent = q ? "未找到标签页" : "没有打开的标签页";
      if (queue.length && !O.pumpT) O.pumpT = setTimeout(pump, 60);
    }
    function mark() { var a = M.active(); cards.forEach(function (c, P) { c.el.classList.toggle("sel", P === sel); c.el.classList.toggle("cur", P === a); }); }
    function setSel(P) { if (P && P !== sel) { sel = P; mark(); } }
    // 屏幕外那些一格一格补画（不一次画完：打开时的动画不卡）
    function pump() {
      O.pumpT = 0;
      if (O.closing) return;
      var c = queue.shift();
      if (c && cards.get(c.P) === c && stageable(c.P)) fill(c, true);
      if (queue.length) O.pumpT = setTimeout(pump, 16);
    }

    // ---- 顶上一排「空间」：全部 · 编辑组 1、2…（分屏时）· 别的窗口 ----
    function others() { var ws0 = T() && T().wins ? T().wins() : []; return ws0.filter(function (w) { return w !== tw && w.open !== false && w.el && document.contains(w.el) && w.el.offsetParent !== null; }); }
    // App Exposé：顶上一排「全部 · Claude Code · Codex · 代码 · 设置…」（有两种以上、或正在只看一种时）；点一个只看这一种（同 macOS 的 App Exposé）
    function appsHtml() {
      var cnt = {}, order = [];
      M.panes().forEach(function (p) { if (p.closed) return; var k = kindOf(p); if (!cnt[k]) { cnt[k] = 0; order.push(k); } cnt[k]++; });
      if (order.length < 2 && !app) return "";
      var pill = function (k, label, n) { return '<button type="button" class="tov-app' + ((k || null) === app ? " on" : "") + '" data-app="' + (k || "") + '"><span></span>' + (n ? "<b>" + n + "</b>" : "") + "</button>"; };
      O.appLabels = [["", "全部"]].concat(order.map(function (k) { return [k, KINDS[k] || k]; }));
      return '<div class="tov-apps">' + pill("", "全部", 0) + order.map(function (k) { return pill(k, KINDS[k] || k, cnt[k]); }).join("") + "</div>";
    }
    function paintApps() {
      var h = appsHtml(), el = topEl.querySelector(".tov-apps");
      if (!h) { if (el) el.remove(); return; }
      var tmp = document.createElement("div"); tmp.innerHTML = h;
      if (el) el.replaceWith(tmp.firstChild); else topEl.appendChild(tmp.firstChild);
      topEl.querySelectorAll(".tov-app > span").forEach(function (sp, i) { sp.textContent = (O.appLabels[i] || [])[1] || ""; });
    }
    topEl.addEventListener("click", function (e) { var b = e.target.closest(".tov-app"); if (!b) return; app = b.dataset.app || null; sync(); qi.focus({ preventScroll: true }); });
    O.setApp = function (k) { app = k || null; sync(); };
    O.appNow = function () { return app; };
    function paintStrip() {
      var gs = M.groups(), wins = others(), items = [];
      paintApps();
      if (gs.length < 2 && !wins.length) { strip.hidden = true; strip.textContent = ""; O.chips = []; return; }
      var pr = tw.panesEl.getBoundingClientRect(), tw0 = 92, th = Math.max(38, Math.min(60, Math.round(tw0 * pr.height / Math.max(1, pr.width))));
      var rects = gs.map(function (g) { var r = g.el ? g.el.getBoundingClientRect() : pr; return { x: (r.left - pr.left) / pr.width, y: (r.top - pr.top) / pr.height, w: r.width / pr.width, h: r.height / pr.height }; });
      var pct = function (v) { return (v * 100).toFixed(2) + "%"; };
      var mini = function (hl) { return rects.map(function (r, i) { return '<i class="tov-mini' + (hl < 0 || hl === i ? " hl" : "") + '" style="left:' + pct(0.05 + r.x * 0.9) + ";top:" + pct(0.07 + r.y * 0.86) + ";width:calc(" + pct(r.w * 0.9) + " - 3px);height:calc(" + pct(r.h * 0.86) + ' - 3px)"></i>'; }).join(""); };
      if (gs.length > 1) {
        items.push({ label: "全部", html: mini(-1), on: !filter });
        gs.forEach(function (g, i) { items.push({ g: g, label: "编辑组 " + (i + 1), html: mini(i), on: filter === g }); });
      }
      wins.forEach(function (w) { items.push({ w: w, label: w.ws && w.ws.active ? titleOf(w.ws.active) : "窗口", html: '<i class="tov-mini hl" style="left:6%;top:8%;width:88%;height:84%"></i>' }); });
      strip.hidden = false;
      strip.innerHTML = items.map(function (it, i) { return '<div class="tov-sp' + (it.on ? " on" : "") + (it.w ? " win" : "") + '" data-i="' + i + '"><div class="tov-spth" style="width:' + tw0 + "px;height:" + th + 'px">' + it.html + '</div><div class="tov-splab"></div></div>'; }).join("");
      strip.querySelectorAll(".tov-splab").forEach(function (el, i) { el.textContent = items[i].label; });
      O.chips = items;
    }
    strip.addEventListener("click", function (e) {
      var sp = e.target.closest(".tov-sp"), it = sp && O.chips[+sp.dataset.i];
      if (!it) return;
      if (it.w) { var w = it.w; O.close(null, true); if (w.dw && w.dw.focus) w.dw.focus(); setTimeout(function () { toggle(w, true); }, 0); return; }
      filter = it.g || null;
      sync();
    });
    var chipAt = function (x, y) { var el = document.elementFromPoint(x, y), sp = el && el.closest && el.closest(".tov-sp"); return sp && ov.contains(sp) ? { el: sp, it: O.chips[+sp.dataset.i] } : null; };

    // ---- 选、开、关 ----
    O.pick = function () { if (sel) O.close(sel); };
    O.pickN = function (n) { var P = vis[n === 9 ? vis.length - 1 : n - 1]; if (P) O.close(P); };
    O.step = function (d) { if (!vis.length) return; var i = vis.indexOf(sel); setSel(vis[(i + d + vis.length) % vis.length]); };
    O.nav = function (key) {
      var dx = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0, dy = key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0, c0 = sel && cards.get(sel);
      if (!c0 || c0.x === undefined) { setSel(vis[0]); return; }
      var cx = c0.x + c0.w / 2, cy = c0.y + c0.h / 2, best = null, bd = Infinity;
      vis.forEach(function (P) {
        if (P === sel) return;
        var c = cards.get(P), x = c.x + c.w / 2, y = c.y + c.h / 2;
        if (dx && (Math.sign(x - cx) !== dx || Math.abs(x - cx) < 2)) return;
        if (dy && (Math.sign(y - cy) !== dy || Math.abs(y - cy) < 2)) return;
        var d = Math.abs(x - cx) * (dx ? 1 : 3) + Math.abs(y - cy) * (dy ? 1 : 3);
        if (d < bd) { bd = d; best = P; }
      });
      if (!best && dx) best = vis[vis.indexOf(sel) + dx] || null; // 这一排走到头：接着下一排（同阅读顺序）
      if (best) setSel(best);
    };
    O.escape = function () { if (O.drag) return O.drag.cancel(); if (qi.value) { qi.value = ""; q = ""; sync(); return; } O.close(null); };
    O.closeSel = function () { if (sel) closeTab(sel); };
    function closeTab(P) {
      var go = function () {
        var i = vis.indexOf(P);
        try { M.close(P); } catch (e) { /* 已经关了 */ }
        if (sel === P) sel = vis[i + 1] || vis[i - 1] || null;
        setTimeout(function () { if (O.closing) return; sync(); qi.focus({ preventScroll: true }); }, 0);
      };
      var t = T();
      if (t && t.askClose) t.askClose([P], "标签页", go); else go();
    }

    // ---- 关（选了一个：缩回它的位置；没选：回到原来那个）----
    var finished = false;
    O.close = function (P, instant) {
      if (O.closing) return;
      O.closing = true;
      clearInterval(O.tick); clearTimeout(O.pumpT);
      cards.forEach(function (c) { if (c.obs) c.obs.disconnect(); });
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", onResize);
      var target = P || M.active();
      if (P && P !== M.active()) { try { M.show(P); } catch (e) { /* 已经没了 */ } }
      var c = target && cards.get(target), tr = target && target.el && target.el.isConnected ? target.el.getBoundingClientRect() : null;
      if (!instant && !reduce() && c && !c.hidden && tr && tr.width) {
        var orr = ov.getBoundingClientRect();
        c.el.classList.add("pick", "zoom");
        c.el.style.transform = "translate(" + (tr.left - orr.left - c.x) + "px," + (tr.top - orr.top - c.y) + "px) scale(" + tr.width / c.w + "," + tr.height / c.h + ")";
      }
      ov.classList.remove("in");
      ov.classList.add("out");
      if (instant) finish(); else setTimeout(finish, reduce() ? 140 : 310);
      function finish() {
        if (finished) return;
        finished = true;
        cards.forEach(function (c, P) { var v = c.view && c.view.firstChild; if (v && !c.lazy && !P.closed) keepLast(P, v, null, c.nat); });
        ov.remove();
        if (stage) { while (stage.firstChild) stage.removeChild(stage.firstChild); stage.remove(); }
        if (staged && tw.ws && tw.ws.layout) try { tw.ws.layout(); } catch (e) { /* 布局出错不挡关概览 */ } // 放上过台子的：回到它那一组里（藏着），不留在页面外
        if (cur === O) cur = null;
        if (target && !target.closed && target.focus) try { target.focus(); } catch (e) { /* 没了 */ }
      }
    };
    // 点到概览外面（标题栏、地址栏）：收起，点的那一下照常；点概览按钮本身交给它（它会收起）
    function outside(e) {
      if (ov.contains(e.target) || !e.target.closest) return;
      if (e.target.closest('[data-l="overview"], .ts-tb, .st-menu, .st-palette, .xp-ql')) return;
      O.close(null, true);
    }
    // 转屏、改窗口大小：先按新的格子排开；停下来后每一格按现在的大小重新量、重新复制（面板自己先按新大小排好——它们 16ms 后重排）。
    //   不重新复制的话，卡片里还是旧大小排的那一份：内容挤在上半截、下面一大块空，「Jump to bottom」飘在中间
    var reT = 0;
    function onResize() {
      if (O.closing) return;
      place(); layout();
      clearTimeout(reT);
      reT = setTimeout(function () {
        if (O.closing) return;
        measureArea();
        cards.forEach(function (c, P) {
          if (P.closed) return;
          var n = natural(P);
          if (Math.abs(n.w - c.nat.w) < 3 && Math.abs(n.h - c.nat.h) < 3) return;
          c.nat = n; c.seeded = false;
          if (P.program && P.program.page === "web") return; // 网页是截图，跟着大小走
          if (stage && P.el.parentNode === stage) { try { stageIn(P); } catch (e) { /* 画不出来：用原来的 */ } fill(c, false); }
          else if (stageable(P)) { if (queue.indexOf(c) < 0) queue.push(c); } // 藏着的、不在页面上的：上台子按新大小画
          else fill(c, false); // 看得见的：它自己已经按新大小排好
        });
        layout();
        if (queue.length && !O.pumpT) O.pumpT = setTimeout(pump, 16);
      }, 160);
    }
    setTimeout(function () { if (!O.closing) document.addEventListener("pointerdown", outside, true); }, 0);
    window.addEventListener("resize", onResize);
    // 点空白处：回到原来那个
    ov.addEventListener("pointerdown", function (e) { if (e.button !== 0 || e.target.closest(".tov-card, .tov-search, .tov-sp, .tov-apps")) return; e.preventDefault(); O.close(null); }); // 顶上那排「全部 · Claude Code · 网页…」也不算空白处（以前一按就收起，筛选按钮像是坏的）
    qi.addEventListener("input", function () { q = qi.value.trim().toLowerCase(); sync(); });
    grid.addEventListener("pointerover", function (e) { var el = e.target.closest(".tov-card"); if (el && el.card && !el.card.hidden && !O.drag) setSel(el.card.P); });

    // ---- 按住一格拖：换顺序（拖到顶上的「编辑组」上 = 挪进那一组）；没拖动就是点开 ----
    grid.addEventListener("pointerdown", function (e) {
      var el = e.target.closest(".tov-card"), c = el && el.card;
      if (!c || c.hidden || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.target.closest(".tov-x")) return closeTab(c.P);
      var x0 = e.clientX, y0 = e.clientY, orr = ov.getBoundingClientRect(), offX = x0 - orr.left - c.x, offY = y0 - orr.top - c.y;
      var from = vis.indexOf(c.P), to = from, moving = false, hot = null;
      var reflow = function () { var o = vis.filter(function (p) { return p !== c.P; }); o.splice(to, 0, c.P); var g2 = geometry(o, geo.A); o.forEach(function (P, i) { if (P !== c.P) { var s2 = g2.slots[i]; setCard(cards.get(P), s2.x, s2.y, s2.w, s2.h); } }); return o; };
      var end = function () {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        window.removeEventListener("pointercancel", cancel, true);
        if (hot) hot.el.classList.remove("drop");
        c.dragging = false; c.el.classList.remove("drag"); O.drag = null;
      };
      var move = function (ev) {
        if (!moving) {
          if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 6) return;
          moving = true; c.dragging = true; c.el.classList.add("drag");
          O.drag = { cancel: function () { end(); to = from; sync(); } };
        }
        c.el.style.left = ev.clientX - orr.left - offX + "px";
        c.el.style.top = ev.clientY - orr.top - offY + "px";
        var ch = chipAt(ev.clientX, ev.clientY);
        if (hot && (!ch || ch.el !== hot.el)) hot.el.classList.remove("drop");
        hot = ch && ch.it && ch.it.g && ch.it.g !== M.groupOf(c.P) ? ch : null;
        if (hot) { hot.el.classList.add("drop"); return; }
        var cx = ev.clientX - orr.left, cy = ev.clientY - orr.top, best = to, bd = Infinity;
        geo.slots.forEach(function (s, i) { var d = Math.hypot(s.x + s.w / 2 - cx, s.y + s.h / 2 - cy); if (d < bd) { bd = d; best = i; } });
        if (best !== to) { to = best; reflow(); }
      };
      var up = function () {
        var wasMoving = moving, hit = hot;
        end();
        if (!wasMoving) return O.close(c.P);
        if (hit) M.moveTo(c.P, hit.it.g);
        else if (to !== from) { var o = reflow(), before = o[to + 1] || null, after = before ? null : o[to - 1] || null; if (before || after) M.move(c.P, before, after); }
        sync();
        setSel(c.P);
      };
      var cancel = function () { end(); to = from; sync(); };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
      window.addEventListener("pointercancel", cancel, true);
    });

    // ---- 开：排好，当前那个从编辑区里原来的位置缩进它那一格 ----
    sync();
    var a0 = M.active(), c0 = a0 && cards.get(a0), pr0 = a0 && a0.el.isConnected ? a0.el.getBoundingClientRect() : null;
    cards.forEach(function (c) { if (c !== c0) c.el.classList.add("enter"); });
    if (c0 && pr0 && pr0.width && !reduce()) {
      var orr0 = ov.getBoundingClientRect();
      c0.el.classList.add("zoom");
      c0.el.style.transform = "translate(" + (pr0.left - orr0.left - c0.x) + "px," + (pr0.top - orr0.top - c0.y) + "px) scale(" + pr0.width / c0.w + "," + pr0.height / c0.h + ")";
    }
    void ov.offsetWidth;
    requestAnimationFrame(function () {
      if (O.closing) return;
      ov.classList.add("in", "ready");
      cards.forEach(function (c) { c.el.classList.remove("enter"); });
      if (c0) { c0.el.style.transform = ""; setTimeout(function () { c0.el.classList.remove("zoom"); }, 330); }
    });
    qi.focus({ preventScroll: true });
    // 开着时：变了的（在跑的 agent、有新内容的）隔一会儿重新复制一份；网页隔几秒重截
    O.tick = setInterval(function () {
      if (O.closing || O.drag) return;
      var now = Date.now(), gone = false;
      cards.forEach(function (c, P) {
        if (P.closed) { gone = true; return; }
        if (c.hidden) return;
        if (P.program && P.program.page === "web") { if (now - (c.snapAt || 0) > 4000) webSnap(c); }
        else if (c.dirty && now - c.at > 700 && P.el.isConnected) fill(c, false);
        dot(c);
      });
      if (gone || M.panes().length !== cards.size) sync();
    }, 500);
    return O;
  }

  // ---- 开 / 关（on：true 开、false 关、不给就切换）----
  function toggle(tw, on, opts) {
    tw = tw || front();
    if (!tw || !tw.ws || !tw.panesEl) return;
    lastToggle = performance.now();
    var isOpen = !!(cur && !cur.closing && cur.tw === tw);
    if (on === undefined) on = !isOpen;
    if (!on) { if (isOpen) cur.close(null); return; }
    if (isOpen && opts && "app" in opts && cur.setApp) { cur.setApp(opts.app); return; }
    if (isOpen || pending) return;
    if (cur && !cur.closing) cur.close(null, true);
    document.querySelectorAll(".ts-overview").forEach(function (x) { x.remove(); });
    var webs = canSnap() ? model(tw).panes().filter(visibleWeb) : [];
    if (!webs.length) { cur = Overview(tw, opts); return; }
    pending = tw;
    Promise.race([Promise.all(webs.map(snapWeb)), new Promise(function (r) { setTimeout(r, 150); })]).then(function () { pending = null; if (!cur) cur = Overview(tw, opts); });
  }

  // ---- 键盘：最早挂在 window 的捕获阶段（这个文件在 studio.js、browser.js、live.js 前面载入），开着时它们的 ⌘W、⌘1… 不会先动 ----
  window.addEventListener("keydown", function (e) {
    if (e.isComposing || e.keyCode === 229) return;
    var k = e.key, meta = e.metaKey && !e.ctrlKey && !e.altKey;
    if (e.metaKey && e.altKey && !e.ctrlKey && !e.shiftKey && e.code === "Backslash") {
      var tw2 = cur && !cur.closing ? cur.tw : front();
      if (!tw2) return;
      e.preventDefault(); e.stopImmediatePropagation();
      appExpose(tw2);
      return;
    }
    if (meta && e.shiftKey && e.code === "Backslash") {
      var tw = cur && !cur.closing ? cur.tw : front();
      if (!tw) return;
      e.preventDefault(); e.stopImmediatePropagation();
      toggle(tw);
      return;
    }
    var O = cur;
    if (!O || O.closing) return;
    var inQ = document.activeElement === O.qi, eat = function () { e.preventDefault(); e.stopImmediatePropagation(); };
    if (k === "Escape") { eat(); return O.escape(); }
    if (k === "Enter") { eat(); return O.pick(); }
    if (/^Arrow(Left|Right|Up|Down)$/.test(k)) { eat(); if (!e.metaKey && !e.altKey && !e.ctrlKey) O.nav(k); return; }
    if (k === "Tab") { eat(); return O.step(e.shiftKey ? -1 : 1); }
    if (meta && !e.shiftKey && e.code === "KeyW") { eat(); return O.closeSel(); }
    if (k === "Backspace" || k === "Delete") {
      if (inQ && O.qi.value) { O.lastEdit = performance.now(); return; } // 在删搜索的字
      eat();
      if (performance.now() - (O.lastEdit || 0) > 600) O.closeSel();
      return;
    }
    if (meta && /^Digit[1-9]$/.test(e.code)) { eat(); return O.pickN(+e.code.slice(5)); }
    if (meta && e.code === "KeyF") { eat(); O.qi.focus(); O.qi.select(); return; }
    if (e.metaKey || e.ctrlKey) {
      if (k === "Meta" || k === "Control" || k === "Shift" || k === "Alt") return;
      if (inQ && meta && /^Key[ACVXZ]$/.test(e.code)) return; // 搜索框里的编辑
      O.close(null, true); // 别的快捷键：概览先收起，快捷键照常
      return;
    }
    if (!inQ && k.length === 1) O.qi.focus(); // 直接打字：进搜索框
  }, true);

  // ---- 原来的那份（browser.js 的 .ts-overview：⇧⌘\ 在它那里、菜单栏里的「标签页概览」、它自己的按钮）：一出现就拿掉，换成这里的 ----
  new MutationObserver(function (recs) {
    for (var i = 0; i < recs.length; i++) {
      var add = recs[i].addedNodes;
      for (var j = 0; j < add.length; j++) {
        var n = add[j];
        if (n.nodeType !== 1 || !n.classList.contains("ts-overview")) continue;
        var tw = null;
        (T() && T().wins ? T().wins() : []).forEach(function (w) { if (!tw && w.el && w.el.contains(n)) tw = w; });
        n.remove();
        if (performance.now() - lastToggle > 350) toggle(tw || front());
      }
    }
  }).observe(root, { childList: true, subtree: true });
  // App Exposé（同 macOS）：只看跟当前标签页同一种的（Claude Code、Codex、代码、设置…）；开着时再按一次回到全部
  function appExpose(tw, kind) {
    tw = tw || front();
    if (!tw || !tw.ws) return;
    var k = kind || kindOf(tw.ws.active);
    if (cur && !cur.closing && cur.tw === tw) { cur.setApp(cur.appNow && cur.appNow() === k ? null : k); return; }
    toggle(tw, true, { app: k });
  }
  function install() { if (window.TSU_BROWSER && TSU_BROWSER.overview !== toggle) TSU_BROWSER.overview = toggle; }
  install();
  document.addEventListener("DOMContentLoaded", install);
  window.addEventListener("load", install);

  if (window.TSU_I18N && TSU_I18N.add) {
    var en = { "代码": "Code", "网页": "Web", "设置": "Settings", "文件": "Files", "终端": "Terminal", "其他": "Other", "App Exposé": "App Exposé", "搜索标签页": "Search Tabs", "全部": "All", "关闭标签页": "Close Tab", "未找到标签页": "No Matching Tabs", "没有打开的标签页": "No Open Tabs", "窗口": "Window", "标签页概览": "Tab Overview" };
    for (var gi = 1; gi <= 9; gi++) en["编辑组 " + gi] = "Group " + gi;
    TSU_I18N.add(en);
  }
  window.TSU_OVERVIEW = { toggle: toggle, appExpose: appExpose, kinds: KINDS, kindOf: kindOf, isOpen: function () { return !!(cur && !cur.closing); } };
})();
