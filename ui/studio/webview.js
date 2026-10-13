// webview.js —— 内嵌的浏览器（标签页里开网页，localhost 调试就在这里）：地址栏（顶上那个）输网址回车就在这个标签页里开；
// 标签栏右边是后退、前进、刷新、在默认浏览器中打开。
//   App 里：原生在这一块叠一个真的 WKWebView（WebPanes.swift）——哪个网站都能开、Safari 的「开发」菜单能连上看检查器；
//           页面上有东西盖在它上面（菜单、命令面板、浮层）时先把它藏起来（原生的那块总在网页上面，不藏就把菜单挡住了）
//   浏览器里（没有原生）：退回 iframe（有的网站不让被嵌，localhost 一般可以）
(function () {
  "use strict";
  var S = window.STUDIO, N = window.nadosNative;
  if (!S || !S.pages) return;
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var cmds = [];
  var native = function () { return !!N && cmds.indexOf("web.open") >= 0; };
  if (N) N.call("info").then(function (i) { cmds = (i && i.commands) || []; }).catch(function () {});
  var views = {}; // id → V
  var seq = 0;
  // 网址：没写协议的补上（localhost、127.0.0.1 用 http，别的 https）
  function normalize(u) {
    u = String(u || "").trim();
    if (!u) return "";
    if (/^[a-z][\w+.-]*:\/\//i.test(u) || /^(about|data|file):/i.test(u)) return u;
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(u) || /^[\w-]+\.local(:\d+)?(\/|$)/i.test(u)) return "http://" + u;
    // 不像网址的（没有点、有空格，比如「codex」「claude code 文档」）：用 Google 搜（同浏览器的地址栏）；像网址的补上 https
    if (/\s/.test(u) || !/^[^\s/]+\.[^\s/]{2,}(:\d+)?(\/|$|\?|#)/.test(u) && !/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(u)) return "https://www.google.com/search?q=" + encodeURIComponent(u);
    return "https://" + u;
  }
  var ICON = {
    back: '<svg viewBox="0 0 16 16"><path d="M10 3.5L5.5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    fwd: '<svg viewBox="0 0 16 16"><path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    reload: '<svg viewBox="0 0 16 16"><path d="M12.5 7.5A4.5 4.5 0 1 1 11 4.3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M11.5 2v2.8H8.7" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    stop: '<svg viewBox="0 0 16 16"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    ext: '<svg viewBox="0 0 16 16"><path d="M9.5 2.5h4v4M13.5 2.5L8 8M12 9.5v3.5H3V4h3.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  // 原生的那块跟着这一块走：位置、大小、看不看得见
  // 别的页面也用这一套（远程桌面 rdp.js：TSU_WEB.track）：V.frameCmd / V.closeCmd 换成它自己的命令，V.want() 为假时也藏（比如还没连上）
  function place(V) {
    if (!native() || !V.host || !V.id) return;
    var r = V.box ? V.box.getBoundingClientRect() : null, vis = !!(r && V.shown() && (!V.want || V.want()) && !covered(r) && V.box.offsetParent && !(window.TSU_MACOS && TSU_MACOS.covers && TSU_MACOS.covers(V.box, r))); // macOS 风格：被别的窗口、程序坞盖住也藏
    var k = r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height), vis].join(",") : "";
    if (k === V.lastFrame) return;
    V.lastFrame = k;
    N.call(V.frameCmd || "web.frame", { id: V.id, x: r ? r.left : 0, y: r ? r.top : 0, w: r ? r.width : 0, h: r ? r.height : 0, visible: vis }).catch(function () {});
  }
  // 页面上盖着的东西（菜单、命令面板、浮层、快速查看、设置的浮动窗口）和这一块重叠：原生的先藏起来
  var OVER = ".st-menu, .st-pop, .st-palette, .st-float, .st-modal, .xp-ql, .gv-pop, .ts-sug:not([hidden]), .drag-ghost:not([hidden]), .ov-wrap, .st-pv-drop, .ca-dlgdim"; // .st-modal：模态层盖住整个窗口——原生的网页都藏
  function covered(r) {
    var hit = false;
    document.querySelectorAll(OVER).forEach(function (o) {
      if (hit || !o.offsetParent && getComputedStyle(o).position !== "fixed") return;
      var q = o.getBoundingClientRect();
      if (q.width && q.height && q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top) hit = true;
    });
    return hit;
  }
  // 顶栏自己的地址栏看不看得见（顶栏右键把「地址栏」关了、这种风格根本没有顶栏地址栏）：看不见时这一页顶上自己带一条
  //   （后退、前进、刷新、网址、在默认浏览器中打开）——不然开了网页却没地方看网址、输网址
  function addrShown(V) {
    var w = V.P && V.P.win && V.P.win.el, a = w && w.querySelector(".bar > .ts-addr");
    if (!a || !a.offsetParent) return false;
    var cs = getComputedStyle(a);
    return cs.visibility !== "hidden" && cs.display !== "none" && a.getBoundingClientRect().width > 40;
  }
  function paintIbar(V) {
    var ib = V.host && V.host.querySelector(".wb-ibar");
    if (!ib) return;
    var need = !addrShown(V);
    if (ib.hidden === need) { ib.hidden = !need; V.lastFrame = ""; } // 条出来 / 收起：网页那块跟着挪
    if (!need) return;
    var st = V.state || {}, inp = ib.querySelector(".wb-iurl"), rl = ib.querySelector('[data-ib="reload"]');
    if (inp && document.activeElement !== inp) inp.value = st.url || V.arg || "";
    if (rl) { var ld = !!st.loading; if (rl.dataset.ld !== String(ld)) { rl.dataset.ld = String(ld); rl.innerHTML = ld ? ICON.stop : ICON.reload; rl.title = ld ? "停止" : "重新载入 (⌘R)"; } }
    var bk = ib.querySelector('[data-ib="back"]'), fw = ib.querySelector('[data-ib="forward"]');
    if (bk) bk.disabled = st.canBack === false; if (fw) fw.disabled = st.canForward === false;
  }
  var raf = 0;
  function placeAll() { if (raf) return; raf = requestAnimationFrame(function () { raf = 0; Object.keys(views).forEach(function (id) { paintIbar(views[id]); place(views[id]); }); }); }
  new MutationObserver(placeAll).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class", "style"] });
  window.addEventListener("resize", placeAll);
  setInterval(placeAll, 500);
  if (N && N.on) N.on("web.state", function (d) {
    var V = d && views[d.id];
    if (!V) return;
    V.state = d;
    if (d.url) V.arg = d.url;
    paintBar(V);
    if (V.P && V.P.win) { V.P.win.syncTitles(); if (window.TSU_BROWSER && TSU_BROWSER.sync) TSU_BROWSER.sync(V.P.win); }
  });
  function paintBar(V) {
    var st = V.state || {}, bar = V.host && V.host.querySelector(".wb-progress"), err = V.host && V.host.querySelector(".wb-err");
    if (bar) { bar.style.opacity = st.loading ? "1" : "0"; bar.style.width = Math.round((st.progress || 0.08) * 100) + "%"; }
    paintIbar(V);
    if (err) { err.hidden = !st.error; if (st.error) err.innerHTML = '<div class="wb-et">无法打开这一页</div><div class="wb-ed">' + esc(st.error) + '</div><div class="wb-eu">' + esc(V.arg || "") + '</div><button data-act="reload">重新载入</button>'; }
  }
  function nav(V, action) {
    if (native()) return N.call("web.nav", { id: V.id, action: action }).catch(function () {});
    var f = V.host && V.host.querySelector("iframe");
    try { if (action === "back") f.contentWindow.history.back(); else if (action === "forward") f.contentWindow.history.forward(); else if (action === "reload") f.contentWindow.location.reload(); } catch (e) { if (action === "reload" && f) f.src = f.src; } // 跨站的 iframe 碰不了它的历史：刷新就重新给一次地址
  }
  function open(V, url) {
    url = normalize(url);
    if (!url) return;
    var ios = window.vsApp && window.webkit && webkit.messageHandlers && webkit.messageHandlers.vsApp; // iPhone / iPad App：内嵌的网页大多不让被嵌，交给 App 自己的 Safari 视图（同 TSU_WEB.open）
    if (ios && /^https?:\/\//i.test(url)) { ios.postMessage({ type: "openURL", url: url }); return; }
    V.arg = url;
    V.state = Object.assign({}, V.state || {}, { url: url, error: "", loading: true });
    if (native()) N.call("web.open", { id: V.id, url: url }).catch(function () {});
    else { var f = V.host && V.host.querySelector("iframe"); if (f) f.src = url; }
    paintBar(V);
    if (V.P && V.P.win) { V.P.win.persist(); V.P.win.syncTitles(); }
  }

  S.pages.web = {
    title: function (arg, V) { var st = V && V.state; if (st && st.title) return st.title; var h = /^[a-z]+:\/\/([^/]+)/i.exec(arg || ""); return h ? h[1] : "新标签页"; },
    address: function (arg) { return arg || ""; },
    render: function (host, P, arg, V) {
      if (!V.id) {
        V.id = "wb" + (++seq) + "-" + Date.now().toString(36);
        V.P = P;
        views[V.id] = V;
        V.gone = function () { return P.closed; };
        V.web = true; // 地址栏：这一页的地址就是网址，回车在这里开
        V.open = function (u) { open(V, u); };
        host.innerHTML = '<div class="wb"><div class="wb-ibar" hidden>' +
          '<button type="button" class="wb-ib" data-ib="back" title="后退">' + ICON.back + '</button><button type="button" class="wb-ib" data-ib="forward" title="前进">' + ICON.fwd + '</button><button type="button" class="wb-ib" data-ib="reload" title="重新载入 (⌘R)">' + ICON.reload + "</button>" +
          '<input class="wb-iurl" type="text" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" placeholder="输入网址，例如 localhost:3000">' +
          '<button type="button" class="wb-ib" data-ib="ext" title="在默认浏览器中打开">' + ICON.ext + "</button></div>" +
          '<div class="wb-progress"></div><div class="wb-box">' + (native() ? "" : '<iframe class="wb-frame" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads" referrerpolicy="no-referrer-when-downgrade"></iframe>') + '<div class="wb-err" hidden></div>' + (arg ? "" : '<div class="wb-blank">在顶上的地址栏输入网址，例如 localhost:3000</div>') + "</div></div>";
        V.box = host.querySelector(".wb-box");
        var ib0 = host.querySelector(".wb-ibar"), iu = host.querySelector(".wb-iurl");
        ib0.addEventListener("click", function (e) {
          var b = e.target.closest("[data-ib]");
          if (!b) return;
          var a = b.dataset.ib, st = V.state || {};
          if (a === "ext") { if (V.arg && window.TSU_TERM && TSU_TERM.openLink) TSU_TERM.openLink(V.arg); return; }
          nav(V, a === "reload" && st.loading ? "stop" : a);
        });
        iu.addEventListener("focus", function () { iu.select(); });
        iu.addEventListener("keydown", function (e) {
          if (e.key === "Enter") { e.preventDefault(); if (iu.value.trim()) { open(V, iu.value); iu.blur(); } }
          else if (e.key === "Escape") { e.preventDefault(); iu.value = (V.state && V.state.url) || V.arg || ""; iu.blur(); }
        });
        new ResizeObserver(function () { place(V); }).observe(V.box);
        host.addEventListener("click", function (e) { var b = e.target.closest("[data-act]"); if (b && b.dataset.act === "reload") nav(V, "reload"); });
        // 原生的：开一个（第一次 render 时原生那边的命令表可能还没回来：等一下）
        var start = function () { if (native()) { N.call("web.open", { id: V.id, url: arg ? normalize(arg) : "" }).then(function () { place(V); }).catch(function () {}); } else if (arg) { var f = host.querySelector("iframe"); if (f) f.src = normalize(arg); } };
        if (N && !cmds.length) N.call("info").then(function (i) { cmds = (i && i.commands) || []; if (!host.querySelector("iframe") && !native()) host.querySelector(".wb-box").insertAdjacentHTML("afterbegin", '<iframe class="wb-frame" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"></iframe>'); start(); }).catch(start);
        else start();
      }
      var blank = host.querySelector(".wb-blank");
      if (blank) { blank.hidden = !!V.arg; blank.textContent = addrShown(V) ? "在顶上的地址栏输入网址，例如 localhost:3000" : "在上面输入网址，例如 localhost:3000"; }
      paintIbar(V);
      if (!V.arg && !addrShown(V)) setTimeout(function () { var u = host.querySelector(".wb-iurl"); if (u && !u.closest("[hidden]")) u.focus(); }, 60);
      placeAll();
    },
    detach: function (host, P, arg, V) { if (native() && V.id) N.call("web.frame", { id: V.id, x: 0, y: 0, w: 0, h: 0, visible: false }).catch(function () {}); V.lastFrame = ""; },
    focus: function () {},
    tabActions: function (host, P, arg, V) {
      var st = V.state || {};
      return [
        { icon: ICON.back, title: "后退", run: function () { nav(V, "back"); } },
        { icon: ICON.fwd, title: "前进", run: function () { nav(V, "forward"); } },
        { icon: st.loading ? ICON.stop : ICON.reload, title: st.loading ? "停止" : "重新载入 (⌘R)", run: function () { nav(V, st.loading ? "stop" : "reload"); } },
        { icon: ICON.ext, title: "在默认浏览器中打开", run: function () { if (V.arg && window.TSU_TERM && TSU_TERM.openLink) TSU_TERM.openLink(V.arg); } },
      ];
    },
  };
  // 关了标签页：原生的那块也关掉
  setInterval(function () { Object.keys(views).forEach(function (id) { var V = views[id]; if (V.gone()) { delete views[id]; if (native()) N.call(V.closeCmd || "web.close", { id: id }).catch(function () {}); } }); }, 2000);
  // 对外：开一个浏览器标签页（地址栏、命令面板、链接用）
  window.TSU_WEB = {
    // iPad App 里：网页交给 App 自己的 Safari 视图（这里的内嵌网页靠 Mac 版 App 的原生网页视图，iPad 上没有——什么都载不出来）
    open: function (tw, url) {
      var h = window.vsApp && window.webkit && webkit.messageHandlers && webkit.messageHandlers.vsApp, u = normalize(url) || "";
      if (h) { if (/^https?:\/\//i.test(u)) h.postMessage({ type: "openURL", url: u }); return null; }
      var p = S.openPage(tw, "web", u); return p;
    },
    normalize: normalize,
    native: native,
    // 别的页面叠的原生视图交给这里摆（位置、盖住时藏、标签页关了就关）：V = { id, host, box, shown(), gone(), want()?, frameCmd, closeCmd }
    track: function (V) { V.lastFrame = ""; views[V.id] = V; placeAll(); },
    placeNow: function (V) { if (views[V.id] === V) place(V); },
    covered: covered,
    // 别的页面也在一块地方叠一个原生的网页视图（文件：PDF、Office 的快速查看预览、很大的图片——原生直接读文件，不经过页面，几百 MB 也不卡）：
    //   位置跟着那一块、被菜单 / 浮层盖住时藏起来、那一块没了（标签页关了）就关掉释放，都同上。shown()：现在该不该露出来。没有原生 → null
    overlay: function (box, url, shown) {
      if (!native()) return null;
      var id = "wo" + (++seq).toString(36) + Date.now().toString(36), V = { id: id, host: box, box: box, lastFrame: "", arg: url };
      V.shown = shown || function () { return box.isConnected && !!box.offsetParent; };
      V.gone = function () { return !box.isConnected; };
      views[id] = V;
      N.call("web.open", { id: id, url: url }).then(function () { V.lastFrame = ""; place(V); }).catch(function () {});
      placeAll();
      return {
        id: id,
        state: function () { return V.state || {}; },
        place: function () { V.lastFrame = ""; place(V); },
        close: function () { if (!views[id]) return; delete views[id]; N.call("web.close", { id: id }).catch(function () {}); },
      };
    },
  };
  if (S.command) S.command("web.open", { title: "打开浏览器标签页", run: function (tw) { S.openPage(tw, "web", ""); } });
})();
