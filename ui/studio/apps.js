// apps.js —— 「App」：活动栏上面那一组的最后一个按钮，点一下从旁边弹出一块（同「开始」菜单：按内容的高度，不是整条侧栏），再点一下、点别处、按 Esc 收起；一格一个 App
//   一份登记表，同连接器、扩展：id、名字、图标、find(tw)（开着的那一页，没有是 null）、open(tw, fresh)、ok()（这台设备上能不能用）；
//   内置的现在三个：访达（dash.js 的 explorer 页：「文件」「Agent」两边，记住上次那一边）、终端（新开一个 shell 标签页，不进任何 agent）、浏览器（webview.js）。
//   以后加的走 STUDIO.apps.add({ … })，弹出来的那块、命令面板跟着有。图标同活动栏上对应的那个（Agent Finder ↔ Agents 的 ✦，File Finder ↔ 文件）
(function () {
  "use strict";
  var S = window.STUDIO;
  if (!S || !S.addView || !S.openPage) return;
  var I18N = window.TSU_I18N;
  var t = function (zh, en) { return I18N && I18N.lang && I18N.lang() === "en" ? en : zh; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var T = function () { return window.TSU_TERM; };
  var front = function () { return T() && T().front ? T().front() : null; };
  var iosApp = function () { return !!(window.vsApp && window.webkit && webkit.messageHandlers && webkit.messageHandlers.vsApp); };

  // ---- 活动栏上的图标（24 格）：三行三列的点 ----
  var ICON24 = (function () {
    var d = "";
    [5.5, 12, 18.5].forEach(function (y) { [5.5, 12, 18.5].forEach(function (x) { d += '<circle cx="' + x + '" cy="' + y + '" r="1.8"/>'; }); });
    return '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none">' + d + "</svg>";
  })();

  // ---- App 的图标：同活动栏上对应的那个（24 格细线）——Agent Finder 用 Agents 的 ✦、File Finder 用「文件」的两张纸 ----
  var LI = function (b) { return function () { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + b + "</svg>"; }; };
  var LOGO = {
    // 访达：照 macOS 的访达图标——眼睛短、一样高（左 8.25、右 15.2，同它的位置），侧脸的额头、鼻子、下巴、笑的弧线照它的轮廓
    finder: function () { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M14.6 3.6C12.7 5.1 11.6 6.6 11.3 8.4L10.5 12.7l1.6.6c0 1.6.1 2.9.5 3.9.4 1.1.7 2.1 1 3.2"/><path d="M8.25 9.25v.7M15.2 9.25v.7"/><path d="M7.4 15c2.9 2.1 6 2.1 8.95-.1"/></svg>'; },
    agents: LI('<path d="M10 4.5C10.5 9.2 12.8 11.5 17.5 12C12.8 12.5 10.5 14.8 10 19.5C9.5 14.8 7.2 12.5 2.5 12C7.2 11.5 9.5 9.2 10 4.5Z"/><path d="M18.5 2.8C18.7 4.6 19.4 5.3 21.2 5.5C19.4 5.7 18.7 6.4 18.5 8.2C18.3 6.4 17.6 5.7 15.8 5.5C17.6 5.3 18.3 4.6 18.5 2.8Z"/>'),
    files: LI('<path d="M9.5 3.5h5.2l4.3 4.3v8.7a1.5 1.5 0 0 1-1.5 1.5h-8a1.5 1.5 0 0 1-1.5-1.5V5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M14.5 3.7v3.1a1 1 0 0 0 1 1h3.3"/><path d="M5 7.5v11.2a1.8 1.8 0 0 0 1.8 1.8H15"/>'),
    term: LI('<rect x="2.7" y="4.2" width="18.6" height="15.6" rx="2.7"/><path d="M7 9.3l3 2.7-3 2.7M12.6 15.2h4.5"/>'),
    web: LI('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.7 2.7 3.9 5.7 3.9 9s-1.2 6.3-3.9 9M12 3C9.3 5.7 8.1 8.7 8.1 12s1.2 6.3 3.9 9"/>'),
  };

  // ---- 登记表 ----
  var APPS = [];
  function paintAll() { if (pop && popFor) openPop(popTw, popFor); } // 登记表变了：开着的那块重画
  // 这个窗口里开着的、test(program) 为真的那一页（几组编辑器都找）
  function findTab(tw, test) {
    var hit = null;
    if (!tw || !tw.ws) return null;
    (tw.ws.all ? tw.ws.all() : []).forEach(function (p) { if (!hit && p.program && test(p.program)) hit = p; });
    return hit;
  }
  function reveal(tw, p) { if (tw.ws.show) tw.ws.show(p); else tw.ws.activate(p); p.focus(); return p; }
  function newTab(tw, page, arg) { var P = tw.ws.active; return tw.ws.newTab({ sh: { cwd: P && P.shell && P.shell.cwd ? P.shell.cwd() : "" }, page: page, arg: arg }); }
  // explorer 这一页是哪个 App：地址是 finder.local.paimon… 的是 File Finder，别的是 Agent Finder
  var finderKind = function (arg) { var ex = S.pages && S.pages.explorer; return ex && ex.address && /^finder\./.test(ex.address(arg || "")) ? "files" : "agents"; };
  function add(a) {
    if (!a || !a.id) return;
    APPS = APPS.filter(function (x) { return x.id !== a.id; }).concat([a]);
    if (S.command) S.command("app." + a.id, { title: function () { return t("打开 ", "Open ") + nameOf(a); }, run: function (tw) { openApp(a, tw || front()); } });
    paintAll();
  }
  var nameOf = function (a) { return typeof a.name === "function" ? a.name() : a.name; };
  var descOf = function (a) { return typeof a.desc === "function" ? a.desc() : a.desc || ""; };
  var okOf = function (a) { return !a.ok || a.ok(); };
  function openApp(a, tw, fresh) {
    tw = tw || front();
    if (!tw || !okOf(a)) return null;
    var p = !fresh && !a.always && a.find ? a.find(tw) : null; // always：每次都新开一个（终端）
    return p ? reveal(tw, p) : a.open(tw, !!fresh);
  }

  add({
    id: "finder", builtin: true, name: function () { return t("访达", "Finder"); }, logo: LOGO.finder,
    // 一个访达：左下角能在「文件」「Agent」两边切换，从上次停的那一边打开（这台设备没有 Mac 的文件时只有 Agent 那一边）
    find: function (tw) { return findTab(tw, function (pr) { return pr.page === "explorer"; }); },
    open: function (tw, fresh) {
      var side = ""; try { side = localStorage.getItem("st-finder-side") || ""; } catch (e) { side = ""; }
      var arg = side === "agents" || !window.TSU_LOCAL ? "agents" : "";
      return fresh ? newTab(tw, "explorer", arg) : S.openPage(tw, "explorer", arg);
    },
  });
  add({
    id: "terminal", builtin: true, always: true, name: function () { return t("终端", "Terminal"); }, logo: LOGO.term,
    desc: function () { return okOf(this) ? t("新的 shell 标签页", "A new shell tab") : t("连接 Mac 后可用", "Available after connecting a Mac"); },
    ok: function () { return !!window.TSU_LOCAL; },
    find: function (tw) { return findTab(tw, function (pr) { return !!pr.pty; }); },
    // 从当前这个终端的目录开（同 iTerm 的新标签页）；不是终端就从家目录
    open: function (tw) {
      var P = tw.ws.active, L = window.TSU_LOCAL, i = L && L.info && L.info();
      var cwd = P && P.program && P.program.pty && P.shell && P.shell.cwd ? P.shell.cwd() : (i && i.home) || "";
      return tw.ws.newTab({ sh: { cwd: cwd, pty: true } });
    },
  });
  add({
    id: "browser", builtin: true, name: function () { return t("浏览器", "Browser"); }, logo: LOGO.web,
    desc: function () { return t("在标签页中打开网页", "Web pages in a tab"); },
    find: function (tw) { return findTab(tw, function (pr) { return pr.page === "web"; }); },
    // iPhone / iPad App：先开一页带地址栏的空白页，输了网址交给 App 自己的 Safari 视图（webview.js）
    open: function (tw, fresh) { return fresh || iosApp() ? newTab(tw, "web", "") : S.openBrowser ? S.openBrowser(tw) : S.openPage(tw, "web", ""); },
  });

  // ======== 弹出来的那块（同「开始」菜单）：点活动栏上的按钮开 / 关（不是指上去就弹）；开在按钮旁边：
  //   活动栏竖着在左边——按钮右边、顶边对齐按钮；在右边（主侧栏移到右侧）——按钮左边；横着（顶部 / 底部 / 标题栏里）——按钮下面（底部时上面）
  var pop = null, popFor = null, popTw = null;
  var byId = function (id) { return APPS.filter(function (a) { return a.id === id; })[0] || null; };
  function closePop(back) { if (pop) { pop.remove(); pop = null; } if (popFor) { popFor.classList.remove("apv-on"); if (back) popFor.focus(); } popFor = null; }
  function place(el, anchor) {
    var r = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight, bar = anchor.parentNode && anchor.parentNode.getBoundingClientRect ? anchor.parentNode.getBoundingClientRect() : r;
    var flat = bar.width > bar.height * 1.5, x, y, cls = "";
    if (flat) { x = r.left; y = r.top > innerHeight / 2 ? r.top - h - 6 : r.bottom + 6; cls = y < r.top ? "up" : "down"; }
    else if (r.left + r.width / 2 > innerWidth / 2) { x = r.left - w - 8; y = r.top; cls = "left"; }
    else { x = r.right + 8; y = r.top; }
    el.style.left = Math.round(Math.max(8, Math.min(innerWidth - w - 8, x))) + "px";
    el.style.top = Math.round(Math.max(8, Math.min(innerHeight - h - 8, y))) + "px";
    if (cls) el.classList.add(cls);
  }
  function tiles() { return pop ? Array.prototype.slice.call(pop.querySelectorAll(".apv-tile")) : []; }
  function openPop(tw, anchor, kbd) {
    closePop();
    var el = pop = document.createElement("div");
    popFor = anchor; popTw = tw;
    anchor.classList.add("apv-on");
    el.className = "apv-pop";
    el.setAttribute("role", "menu");
    el.innerHTML = '<div class="apv-grid">' + APPS.map(function (a) {
      var ok = okOf(a), open = ok && a.find && a.find(tw);
      return '<button type="button" role="menuitem" class="apv-tile' + (ok ? "" : " off") + '" data-app="' + esc(a.id) + '"' + (ok ? "" : ' aria-disabled="true"') + ' title="' + esc(ok ? nameOf(a) : t("连接 Mac 后可用", "Available after connecting a Mac")) + '">' +
        '<span class="apv-tic">' + (typeof a.logo === "function" ? a.logo() : a.logo || "") + '</span><span class="apv-tn">' + esc(nameOf(a)) + "</span>" + (open ? '<i class="apv-dot"></i>' : "") + "</button>";
    }).join("") + "</div>";
    document.body.appendChild(el);
    place(el, anchor);
    el.addEventListener("click", function (e) {
      var b = e.target.closest(".apv-tile"), a = b && byId(b.dataset.app);
      if (!a || !okOf(a)) return;
      var tw0 = popTw;
      closePop();
      openApp(a, tw0, e.metaKey || e.ctrlKey); // ⌘ 点：新开一页
    });
    el.addEventListener("contextmenu", function (e) {
      var b = e.target.closest(".apv-tile"), a = b && byId(b.dataset.app);
      if (!a) return;
      e.preventDefault();
      var tw0 = popTw;
      S.menu([
        { label: t("打开", "Open"), disabled: !okOf(a), run: function () { closePop(); openApp(a, tw0); } },
        { label: t("在新标签页中打开", "Open in New Tab"), disabled: !okOf(a), run: function () { closePop(); openApp(a, tw0, true); } },
      ], { x: e.clientX, y: e.clientY });
    });
    // 键盘：方向键在格子里走（两列），回车 / 空格打开，Tab 不出这一块
    el.addEventListener("keydown", function (e) {
      var ts = tiles(), i = ts.indexOf(document.activeElement), k = e.key, step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -2, ArrowDown: 2 }[k];
      if (step === undefined && k !== "Tab" && k !== "Home" && k !== "End") return;
      e.preventDefault();
      var n = k === "Home" ? 0 : k === "End" ? ts.length - 1 : k === "Tab" ? (i + (e.shiftKey ? -1 : 1) + ts.length) % ts.length : Math.max(0, Math.min(ts.length - 1, (i < 0 ? 0 : i + step)));
      if (ts[n]) ts[n].focus();
    });
    if (kbd) { var f = el.querySelector(".apv-tile:not(.off)"); if (f) f.focus(); } // 用键盘开的：焦点到第一个
  }
  document.addEventListener("keydown", function (e) { if (pop && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closePop(pop.contains(document.activeElement)); } }, true);
  document.addEventListener("mousedown", function (e) { if (pop && !pop.contains(e.target) && !(popFor && popFor.contains(e.target)) && !(e.target.closest && e.target.closest(".st-menu"))) closePop(); }, true);
  window.addEventListener("blur", function () { if (!(S.menuOpen && S.menuOpen())) closePop(); });
  window.addEventListener("resize", function () { closePop(); });
  // 点按钮：开着就收起，没开就开（kbd：用键盘按的——焦点进到格子里）
  function popup(tw, anchor, kbd) { if (pop && popFor === anchor) return closePop(); openPop(tw || front(), anchor, kbd); }
  if (I18N && I18N.onChange) I18N.onChange(function () { if (pop && popFor) openPop(popTw, popFor); });

  S.apps = { add: add, popup: popup, close: closePop, icon: ICON24, list: function () { return APPS.slice(); }, open: function (id, tw, fresh) { var a = APPS.filter(function (x) { return x.id === id; })[0]; return a ? openApp(a, tw, fresh) : null; } };
})();
