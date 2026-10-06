// safari.js —— 桌面里的「Safari浏览器」：链接不再把人带离这个页面，而是在一个窗口里用 <iframe> 打开。
// 标签页、自己维护的前进 / 后退（跨源的 iframe 拿不到它的 history 和网址）、起始页（个人收藏 + 最近访问）、
// 搜索用 Google（带 igu=1 是 Google 自己允许被嵌入的模式：首页、搜索结果都能直接在标签页里用），
// 不允许嵌入的网站给一张说明卡片（到浏览器新标签页打开，或用阅读模式——经 r.jina.ai 取正文），
// 以及全局接管桌面里的外链点击。对外：window.TSU_SAFARI.open(url, { newTab })
(function () {
  "use strict";
  var D = window.TSU_DESK;
  if (!D) return;
  var mobile = function () { return !document.documentElement.classList.contains("ios") && matchMedia("(max-width: 600px)").matches; }; // 手机版（html.ios）有自己的 Safari：链接留在里面开

  // ---- 常量 ----
  var SEARCH = "https://www.google.com/search?igu=1&q="; // 同 Safari 的默认搜索引擎；igu=1：Google 允许嵌入的模式（不带就是 X-Frame-Options: SAMEORIGIN）
  var READER = "https://r.jina.ai/"; // 阅读模式：把网页转成 Markdown（带 CORS，可直接 fetch）
  var SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox";
  var FAVS = [
    { name: "Google", url: "https://www.google.com/webhp?igu=1" },
    { name: "terminal-style-ui", url: "https://github.com/ApolloZhangOnGithub/terminal-style-ui" },
    { name: "维基百科", url: "https://zh.wikipedia.org/" },
    { name: "MDN", url: "https://developer.mozilla.org/zh-CN/" },
    { name: "Hacker News", url: "https://news.ycombinator.com/" },
    { name: "DuckDuckGo", url: "https://duckduckgo.com/" },
  ];
  // 已知会拒绝被嵌入（X-Frame-Options / CSP frame-ancestors）的网站：直接给卡片，不白等一片空白
  var BLOCKED = ["github.com", "githubusercontent.com", "youtube.com", "x.com", "twitter.com", "facebook.com", "instagram.com", "linkedin.com",
    "reddit.com", "stackoverflow.com", "stackexchange.com", "superuser.com", "developer.mozilla.org", "news.ycombinator.com", "duckduckgo.com",
    "npmjs.com", "medium.com", "apple.com", "zhihu.com", "douban.com", "weibo.com", "openai.com", "chatgpt.com", "claude.ai", "anthropic.com",
    "huggingface.co", "pypi.org", "arxiv.org", "cloudflare.com", "w3.org", "web.dev", "search.brave.com", "startpage.com", "mojeek.com",
    "baidu.com", "notion.so", "figma.com", "discord.com", "slack.com", "amazon.com", "netflix.com", "gist.github.com"];
  var SLOW_MS = 6000;

  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var parse = function (u) { try { return new URL(u); } catch (e) { return null; } };
  var hostOf = function (u) { var p = parse(u); return p ? p.hostname.replace(/^www\./, "") : ""; };
  // Google：首页（/、/webhp）和搜索（/search）带上 igu=1 就能嵌入；别的（地图、邮箱、账号……）照旧不许
  var isGoogle = function (h) { return /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(h); };
  var googleEmbeddable = function (p) { return /^\/(webhp|search)?$/.test(p.pathname); };
  function embedURL(u) {
    var p = parse(u);
    if (!p || !isGoogle(p.hostname.toLowerCase()) || !googleEmbeddable(p)) return u;
    if (p.pathname === "/") p.pathname = "/webhp";
    if (p.searchParams.get("igu") !== "1") p.searchParams.set("igu", "1");
    return p.href;
  }
  // 给人看的网址：去掉 igu=1（同参考实现：地址栏、复制、到浏览器打开都用它）
  function plainURL(u) {
    var p = parse(u);
    if (!p || !isGoogle(p.hostname.toLowerCase()) || !p.searchParams.has("igu")) return u;
    p.searchParams.delete("igu");
    return p.href.replace(/\?$/, "");
  }
  function isBlocked(u) {
    var p = parse(u);
    if (!p) return false;
    var h = p.hostname.toLowerCase();
    if (isGoogle(h)) return !googleEmbeddable(p);
    return BLOCKED.some(function (b) { return h === b || h.slice(-b.length - 1) === "." + b; });
  }
  // 到浏览器里打开（不许嵌入的网站、「在浏览器的新标签页打开」）：Paimon App 里交给 Mac 的默认浏览器，网页里开一个新标签页
  var OUT_LABEL = window.nadosNative ? "在默认浏览器中打开" : "在新的浏览器标签页打开";
  function openOut(u) {
    u = plainURL(u);
    var N = window.nadosNative;
    if (N && N.call) N.call("openExternal", { url: u }).catch(function () { window.open(u, "_blank", "noopener"); });
    else window.open(u, "_blank", "noopener");
  }
  // 地址栏的输入：像网址就打开，否则当搜索词
  function toURL(text) {
    var t = String(text || "").trim();
    if (!t) return "";
    if (/^https?:\/\//i.test(t)) return t;
    if (/^localhost(:\d+)?(\/.*)?$/i.test(t) || /^\d+\.\d+\.\d+\.\d+(:\d+)?(\/.*)?$/.test(t)) return "http://" + t;
    if (!/\s/.test(t) && /^[\w-]+(\.[\w-]+)*\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(t)) return "https://" + t;
    return SEARCH + encodeURIComponent(t);
  }
  // 标签页标题：跨源拿不到 document.title，只能从网址猜
  function guessTitle(u) {
    if (!u) return "起始页";
    var fav = FAVS.find(function (f) { return f.url === u; });
    if (fav) return fav.name;
    var p = parse(u);
    if (!p) return u;
    if (isGoogle(p.hostname.toLowerCase())) return p.pathname === "/search" && p.searchParams.get("q") ? p.searchParams.get("q") + " - Google 搜索" : "Google";
    if (/bing\.com$/.test(p.hostname) && p.searchParams.get("q")) return p.searchParams.get("q") + " - 搜索";
    if (/wikipedia\.org$/.test(p.hostname) && /^\/wiki\/./.test(p.pathname)) {
      try { return decodeURIComponent(p.pathname.slice(6)).replace(/_/g, " "); } catch (e) {}
    }
    return p.hostname.replace(/^www\./, "");
  }
  var favicon = function (u) { return "https://icons.duckduckgo.com/ip3/" + (parse(u) ? parse(u).hostname : "") + ".ico"; };

  // ---- 图标（SVG，currentColor）----
  var ICON = {
    back: '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    fwd: '<svg viewBox="0 0 16 16" width="16" height="16"><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    lock: '<svg viewBox="0 0 12 14" width="10" height="12"><rect x="1.5" y="6" width="9" height="7" rx="1.6" fill="currentColor"/><path d="M3.5 6V4.4a2.5 2.5 0 0 1 5 0V6" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
    reload: '<svg viewBox="0 0 16 16" width="13" height="13"><path d="M13 8a5 5 0 1 1-1.6-3.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M12.2 1.8v3.1H9.1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plus: '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M8 2.5v11M2.5 8h11" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    out: '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    reader: '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M3 3.5h10M3 6.5h10M3 9.5h10M3 12.5h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    search: '<svg viewBox="0 0 16 16" width="15" height="15"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m10.5 10.5 3.2 3.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    close: '<svg viewBox="0 0 10 10" width="8" height="8"><path d="m1.5 1.5 7 7m0-7-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    shield: '<svg viewBox="0 0 48 48" width="44" height="44"><rect x="5" y="9" width="38" height="30" rx="5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M5 16h38" stroke="currentColor" stroke-width="2.4"/><circle cx="10" cy="12.5" r="1.3" fill="currentColor"/><circle cx="14.5" cy="12.5" r="1.3" fill="currentColor"/><path d="m18 22 12 12m0-12L18 34" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  };

  // ---- 标签页的状态 ----
  // tab: { stack: [{ url, reader, title }], idx, inner（iframe 里自己跳了几次页——跨源看不到网址）, view, frame, loading, zoom }
  var tabs = [], active = null, seq = 0;
  var cur = function () { return active; };
  var entry = function (t) { return t.stack[t.idx] || { url: "" }; };
  var tabTitle = function (t) { var e = entry(t); return e.title || guessTitle(e.url); };

  // ---- 窗口骨架 ----
  var content = document.createElement("div");
  content.className = "sf-main";
  content.innerHTML = '<div class="sf-tabs" hidden></div><div class="sf-views"></div>' +
    '<i class="sf-edge sf-edge-l"></i><i class="sf-edge sf-edge-r"></i><i class="sf-edge sf-edge-b"></i>';
  var win = D.createWindow({
    id: "safari", name: "Safari浏览器", className: "sf-win", content: content, width: 1120, height: 740,
    title: function () { var t = cur(); return t ? tabTitle(t) : "Safari浏览器"; },
    menus: menus,
    appMenu: function () { return [{ label: "关于 Safari浏览器", keys: "", run: function () { openURL("https://en.wikipedia.org/wiki/Safari_(web_browser)", { newTab: true }); } }, { sep: true }, { label: "清除历史记录…", keys: "", run: clearHistory }]; },
    onClose: function () { tabs.slice().forEach(function (t) { dropTab(t); }); tabs = []; active = null; renderTabs(); },
  });
  var el = win.el, bar = el.querySelector(".bar"), tabsEl = content.querySelector(".sf-tabs"), views = content.querySelector(".sf-views");
  // 工具栏放进标题栏（同 Safari 的紧凑统一工具栏）：左边前进后退，中间地址栏，右边新建标签页
  var tools = document.createElement("div");
  tools.className = "sf-tools";
  tools.innerHTML = '<div class="sf-nav"><button class="sf-btn" data-sf="back" title="后退">' + ICON.back + '</button><button class="sf-btn" data-sf="fwd" title="前进">' + ICON.fwd + "</button></div>" +
    '<label class="sf-addr"><span class="sf-show"></span><input spellcheck="false" autocomplete="off" placeholder="搜索或输入网站名称"><button class="sf-reload" data-sf="reload" title="重新载入此页面">' + ICON.reload + '</button><i class="sf-prog"></i></label>' +
    '<div class="sf-right"><button class="sf-btn" data-sf="reader" title="阅读模式">' + ICON.reader + '</button><button class="sf-btn" data-sf="out" title="' + OUT_LABEL + '">' + ICON.out + '</button><button class="sf-btn" data-sf="new" title="新建标签页">' + ICON.plus + "</button></div>";
  bar.appendChild(tools);
  var addr = tools.querySelector(".sf-addr"), input = addr.querySelector("input"), show = addr.querySelector(".sf-show"), prog = addr.querySelector(".sf-prog");
  var btn = function (k) { return tools.querySelector('[data-sf="' + k + '"]'); };
  // 标题栏按下会被拿去拖窗口（并 preventDefault，输入框就点不进去）：工具栏里的控件自己吃掉按下
  tools.addEventListener("pointerdown", function (e) { if (e.target.closest("button, input, .sf-addr")) e.stopPropagation(); });
  tools.addEventListener("dblclick", function (e) { if (e.target.closest("button, input, .sf-addr")) e.stopPropagation(); });
  tools.addEventListener("click", function (e) {
    var b = e.target.closest("[data-sf]");
    if (!b || b.disabled) return;
    e.preventDefault();
    var k = b.dataset.sf, t = cur();
    if (k === "back") goBack();
    else if (k === "fwd") goForward();
    else if (k === "reload") reload();
    else if (k === "new") newTab("", true);
    else if (k === "out" && t && entry(t).url) openOut(entry(t).url);
    else if (k === "reader" && t && entry(t).url) navigate(t, entry(t).url, { reader: !entry(t).reader });
  });
  input.addEventListener("focus", function () { addr.classList.add("editing"); var e = cur() && entry(cur()); input.value = e && e.url ? plainURL(e.url) : ""; setTimeout(function () { input.select(); }, 0); });
  input.addEventListener("blur", function () { addr.classList.remove("editing"); syncBar(); });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); var u = toURL(input.value); if (!u) return; var t = cur() || newTab(""); input.blur(); navigate(t, u); }
    if (e.key === "Escape") { e.preventDefault(); input.blur(); }
  });

  // ---- 标签页 ----

  function newTab(url, focus) {
    var t = { id: ++seq, stack: [{ url: "" }], idx: 0, inner: 0, view: document.createElement("div"), frame: null, loading: false, zoom: 1 };
    t.view.className = "sf-view";
    views.appendChild(t.view);
    tabs.push(t);
    select(t);
    if (url) navigate(t, url, { replace: true }); else render(t);
    if (focus && !url) setTimeout(function () { var s = t.view.querySelector(".sf-start input"); if (s) s.focus(); }, 30);
    return t;
  }
  function select(t) {
    active = t;
    if (t.stale) { t.stale = false; render(t); } // 刷新后恢复的标签页：选到它才载入
    tabs.forEach(function (x) { x.view.classList.toggle("on", x === t); });
    renderTabs();
    syncBar();
  }
  function dropTab(t) {
    clearTimeout(t.timer);
    if (t.frame) t.frame.src = "about:blank";
    t.view.remove();
  }
  function closeTab(t) {
    t = t || cur();
    if (!t) return;
    var i = tabs.indexOf(t);
    dropTab(t);
    tabs.splice(i, 1);
    if (!tabs.length) { active = null; win.hide("closed"); return; } // 关掉最后一个标签页 = 关窗口（同 Safari）
    if (active === t) select(tabs[Math.min(i, tabs.length - 1)]); else renderTabs();
  }
  function cycle(d) { if (tabs.length < 2) return; select(tabs[(tabs.indexOf(cur()) + d + tabs.length) % tabs.length]); }

  // 在标签页里打开：截掉前进的部分再压栈（同浏览器）
  function navigate(t, url, opts) {
    opts = opts || {};
    url = url ? embedURL(url) : url;
    var e = { url: url, reader: !!opts.reader };
    t.inner = 0; // 换了一页：之前在页面里点过的链接不算了（不然第一下「后退」只是重载当前页）
    if (opts.replace) t.stack[t.idx] = e;
    else { t.stack = t.stack.slice(0, t.idx + 1).concat([e]); t.idx = t.stack.length - 1; }
    if (url) remember(url, guessTitle(url));
    render(t);
  }
  function goBack() {
    var t = cur();
    if (!t) return;
    if (t.inner > 0) { t.inner = 0; return render(t); } // 页面里点过链接：回到我们知道网址的那一页
    if (t.idx > 0) { t.idx--; render(t); }
  }
  function goForward() { var t = cur(); if (t && t.idx < t.stack.length - 1) { t.idx++; render(t); } }
  function reload() { var t = cur(); if (t) { t.inner = 0; render(t); } }

  // 画一个标签页的当前页：起始页 / 阅读模式 / 不许嵌入的卡片 / iframe。每次导航都换一个新的 iframe——
  // 改 src 会往顶层页面的会话历史里塞记录（浏览器的后退键就会先退 iframe），新建的 iframe 不会
  function render(t) {
    clearTimeout(t.timer);
    if (t.frame) { t.frame.src = "about:blank"; t.frame = null; }
    t.view.textContent = "";
    t.loading = false;
    var e = entry(t);
    if (!e.url) startPage(t);
    else if (e.reader) readerView(t, e);
    else if (isBlocked(e.url)) card(t, e.url, false);
    else frame(t, e.url);
    renderTabs();
    syncBar();
  }
  function frame(t, url) {
    var f = document.createElement("iframe"), loads = 0;
    f.setAttribute("sandbox", SANDBOX);
    f.setAttribute("referrerpolicy", "no-referrer");
    f.setAttribute("allow", "fullscreen; clipboard-write");
    f.className = "sf-frame";
    f.src = url;
    t.frame = f;
    t.loading = true;
    applyZoom(t);
    f.addEventListener("load", function () {
      if (t.frame !== f) return;
      if (++loads > 1) t.inner++; // 之后的每次 load 都是页面里自己跳转
      t.loading = false;
      clearTimeout(t.timer);
      var slow = t.view.querySelector(".sf-card.slow");
      if (slow) slow.remove();
      syncBar();
      renderTabs();
    });
    f.addEventListener("error", function () { if (t.frame === f) { t.loading = false; syncBar(); } });
    t.view.appendChild(f);
    // 迟迟不 load：多半是被拒绝嵌入（或者网很慢）——给张卡片，但可以继续等
    t.timer = setTimeout(function () { if (t.frame === f && t.loading) card(t, url, true); }, SLOW_MS);
  }
  function applyZoom(t) {
    var f = t.frame, z = t.zoom;
    if (!f) return;
    f.style.width = z === 1 ? "" : 100 / z + "%";
    f.style.height = z === 1 ? "" : 100 / z + "%";
    f.style.transform = z === 1 ? "" : "scale(" + z + ")";
  }
  function zoom(d) {
    var t = cur(), Z = [0.5, 0.67, 0.75, 0.85, 1, 1.15, 1.25, 1.5, 1.75, 2];
    if (!t) return;
    var i = Z.indexOf(t.zoom);
    t.zoom = d === 0 ? 1 : Z[Math.max(0, Math.min(Z.length - 1, (i < 0 ? 4 : i) + d))];
    applyZoom(t);
    var r = t.view.querySelector(".sf-reader");
    if (r) r.style.fontSize = 18 * t.zoom + "px";
    saveTabs();
  }

  // ---- 不许嵌入：说明卡片 ----
  function card(t, url, slow) {
    var old = t.view.querySelector(".sf-card");
    if (old) old.remove();
    var c = document.createElement("div");
    c.className = "sf-card" + (slow ? " slow" : "");
    c.innerHTML = '<div class="sf-card-in"><div class="sf-card-ico">' + ICON.shield + "</div>" +
      "<h2>" + (slow ? "这个网站可能不允许嵌入到别的页面里" : "这个网站不允许嵌入到别的页面里") + "</h2>" +
      '<p><b>' + esc(hostOf(url)) + "</b> " + (slow ? "迟迟没有显示出来——它也可能只是慢。" : "要求只在它自己的浏览器标签页里显示。") + "</p>" +
      '<div class="sf-card-btns"><button class="sf-primary" data-c="out">' + OUT_LABEL + '</button><button data-c="reader">用阅读模式打开</button>' +
      (slow ? '<button data-c="wait">继续等待</button>' : "") + "</div></div>";
    c.addEventListener("click", function (e) {
      var b = e.target.closest("[data-c]");
      if (!b) return;
      if (b.dataset.c === "out") openOut(url);
      if (b.dataset.c === "reader") navigate(t, url, { reader: true });
      if (b.dataset.c === "wait") c.remove();
    });
    t.view.appendChild(c);
  }

  // ---- 起始页：大搜索框、个人收藏、最近访问 ----
  function tile(u, name) {
    return '<a class="sf-fav" data-go="' + esc(u) + '" title="' + esc(u) + '"><span class="sf-fav-ico"><img alt="" referrerpolicy="no-referrer" src="' + esc(favicon(u)) + '"><b>' +
      esc((name || hostOf(u) || "?").charAt(0).toUpperCase()) + "</b></span><span class=\"sf-fav-name\">" + esc(name || guessTitle(u)) + "</span></a>";
  }
  function startPage(t) {
    var recent = history().slice(0, 8);
    var s = document.createElement("div");
    s.className = "sf-start";
    s.innerHTML = '<div class="sf-start-in"><form class="sf-search">' + ICON.search + '<input spellcheck="false" autocomplete="off" placeholder="搜索或输入网站名称"></form>' +
      "<h3>个人收藏</h3><div class=\"sf-grid\">" + FAVS.map(function (f) { return tile(f.url, f.name); }).join("") + "</div>" +
      (recent.length ? "<h3>最近访问</h3><div class=\"sf-grid\">" + recent.map(function (h) { return tile(h.url, h.title); }).join("") + "</div>" : "") + "</div>";
    s.querySelector("form").addEventListener("submit", function (e) { e.preventDefault(); var u = toURL(s.querySelector("input").value); if (u) navigate(t, u); });
    s.addEventListener("click", function (e) { var a = e.target.closest("[data-go]"); if (a) { e.preventDefault(); navigate(t, a.dataset.go); } });
    // 取不到的小图标换成首字母
    Array.prototype.forEach.call(s.querySelectorAll("img"), function (img) { img.onerror = function () { img.remove(); }; img.onload = function () { if (img.naturalWidth > 1) img.parentNode.classList.add("has"); else img.remove(); }; });
    t.view.appendChild(s);
  }

  // ---- 阅读模式：r.jina.ai 把网页转成 Markdown，这里排成 Safari 阅读器的样子 ----
  function readerView(t, e) {
    var r = document.createElement("div");
    r.className = "sf-reader";
    r.style.fontSize = 18 * t.zoom + "px";
    r.innerHTML = '<article><p class="sf-reader-meta">' + esc(hostOf(e.url)) + " · 阅读模式</p><p class=\"sf-reader-wait\">正在取正文…</p></article>";
    t.view.appendChild(r);
    t.loading = true;
    fetch(READER + plainURL(e.url), { referrerPolicy: "no-referrer" }).then(function (res) {
      if (!res.ok) throw new Error(res.status === 429 ? "阅读模式用得太频繁了，过一分钟再试" : "取不到正文（" + res.status + "）");
      return res.text();
    }).then(function (txt) {
      if (entry(t) !== e) return;
      var m = /^Title:\s*(.*)$/m.exec(txt), body = txt.split(/^Markdown Content:\s*$/m)[1];
      e.title = m && m[1].trim() || guessTitle(e.url);
      remember(e.url, e.title);
      r.querySelector("article").innerHTML = '<p class="sf-reader-meta">' + esc(hostOf(e.url)) + ' · 阅读模式</p><h1>' + esc(e.title) + "</h1>" + md(body == null ? txt : body, e.url);
    }).catch(function (err) {
      if (entry(t) !== e) return;
      r.querySelector(".sf-reader-wait").textContent = err.message || "取不到正文";
    }).then(function () { if (entry(t) === e) { t.loading = false; syncBar(); renderTabs(); } });
    // 正文里的链接：留在这个标签页里；不许嵌入的网站继续用阅读模式
    r.addEventListener("click", function (ev) {
      var a = ev.target.closest("a[data-href]");
      if (!a) return;
      ev.preventDefault();
      if (ev.metaKey) return newTab(a.dataset.href);
      navigate(t, a.dataset.href, { reader: isBlocked(a.dataset.href) });
    });
  }
  // 小小的 Markdown 排版（标题、段落、列表、引用、代码块、表格、图片、链接）；一律先转义，网址只收 http(s)
  function md(src, base) {
    var safe = function (u) { try { var p = new URL(u.replace(/&amp;/g, "&"), base); return /^https?:$/.test(p.protocol) ? p.href : ""; } catch (e) { return ""; } };
    var inline = function (s) {
      s = esc(s);
      s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
      s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g, function (_, alt, u) { u = safe(u); return u ? '<img alt="' + alt + '" src="' + esc(u) + '" referrerpolicy="no-referrer" loading="lazy">' : ""; });
      s = s.replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g, function (_, txt, u) { u = safe(u); return u ? '<a href="' + esc(u) + '" data-href="' + esc(u) + '">' + txt + "</a>" : txt; });
      s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
      return s;
    };
    var lines = String(src).replace(/\r/g, "").split("\n"), out = [], i = 0, para = [];
    var flush = function () { if (para.length) { out.push("<p>" + inline(para.join(" ")) + "</p>"); para = []; } };
    while (i < lines.length) {
      var l = lines[i], m;
      if (/^```/.test(l)) {
        flush();
        var code = [];
        for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
        out.push("<pre><code>" + esc(code.join("\n")) + "</code></pre>");
        i++;
        continue;
      }
      if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) { flush(); var n = Math.min(6, m[1].length + 1); out.push("<h" + n + ">" + inline(m[2].replace(/#+\s*$/, "")) + "</h" + n + ">"); i++; continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { flush(); out.push("<hr>"); i++; continue; }
      if (/^[=-]{3,}\s*$/.test(lines[i + 1] || "") && l.trim() && !para.length) { out.push("<h2>" + inline(l) + "</h2>"); i += 2; continue; }
      if (/^\s*>/.test(l)) {
        flush();
        var q = [];
        for (; i < lines.length && /^\s*>/.test(lines[i]); i++) q.push(lines[i].replace(/^\s*>\s?/, ""));
        out.push("<blockquote>" + md(q.join("\n"), base) + "</blockquote>");
        continue;
      }
      if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || "")) {
        flush();
        var cells = function (row) { return row.trim().replace(/^\||\|$/g, "").split("|"); };
        var head = cells(l), rows = [];
        for (i += 2; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) rows.push(cells(lines[i]));
        out.push("<div class=\"sf-table\"><table><thead><tr>" + head.map(function (c) { return "<th>" + inline(c.trim()) + "</th>"; }).join("") + "</tr></thead><tbody>" +
          rows.map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + inline(c.trim()) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>");
        continue;
      }
      if ((m = /^\s*([-*+]|\d+[.)])\s+/.exec(l))) {
        flush();
        var ol = /\d/.test(m[1]), items = [];
        for (; i < lines.length && (m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i])); i++) items.push("<li>" + inline(m[2]) + "</li>");
        out.push((ol ? "<ol>" : "<ul>") + items.join("") + (ol ? "</ol>" : "</ul>"));
        continue;
      }
      if (!l.trim()) { flush(); i++; continue; }
      para.push(l.trim());
      i++;
    }
    flush();
    return out.join("");
  }

  // ---- 界面同步：标签条、地址栏、按钮 ----
  function renderTabs() {
    tabsEl.hidden = tabs.length < 2;
    el.classList.toggle("sf-multi", tabs.length > 1);
    tabsEl.textContent = "";
    tabs.forEach(function (t) {
      var b = document.createElement("div"), u = entry(t).url;
      b.className = "sf-tb" + (t === active ? " on" : "") + (t.loading ? " loading" : "");
      b.title = tabTitle(t);
      b.innerHTML = '<button class="sf-tb-x" title="关闭标签页">' + ICON.close + '</button><span class="sf-tb-ico">' + (u ? '<img alt="" referrerpolicy="no-referrer" src="' + esc(favicon(u)) + '">' : "") + '</span><span class="sf-tb-t"></span>';
      b.querySelector(".sf-tb-t").textContent = tabTitle(t);
      var img = b.querySelector("img");
      if (img) img.onerror = function () { img.remove(); };
      b.addEventListener("mousedown", function (e) { if (e.button === 1) { e.preventDefault(); closeTab(t); } });
      b.addEventListener("click", function (e) { if (e.target.closest(".sf-tb-x")) closeTab(t); else select(t); });
      tabsEl.appendChild(b);
    });
    var add = document.createElement("button");
    add.className = "sf-tb-add";
    add.title = "新建标签页";
    add.innerHTML = ICON.plus;
    add.addEventListener("click", function () { newTab("", true); });
    tabsEl.appendChild(add);
    win.setTitle(active ? tabTitle(active) : "Safari浏览器");
    saveTabs();
  }

  // ---- 刷新不丢：开着的标签页（各自的前进 / 后退、阅读模式、缩放）记在 tsu-safari-tabs；关掉窗口 = 标签页都没了 ----
  var TKEY = "tsu-safari-tabs", tabsRestored = false;
  function saveTabs() {
    if (!tabsRestored) return; // 还没接回上次的：别拿空的盖掉
    var o = { cur: tabs.indexOf(active), tabs: tabs.map(function (t) {
      return { stack: t.stack.map(function (e) { return { url: e.url, reader: e.reader || undefined, title: e.title || undefined }; }), idx: t.idx, zoom: t.zoom !== 1 ? t.zoom : undefined };
    }) };
    try { localStorage.setItem(TKEY, JSON.stringify(o)); } catch (e) { /* 满了就算了 */ }
  }
  // 接回上次的标签页（只在第一次打开窗口时）：当前那页马上载入，别的选到才载入
  function restoreTabs() {
    if (tabsRestored) return false;
    tabsRestored = true;
    var o = null;
    try { o = JSON.parse(localStorage.getItem(TKEY) || "null"); } catch (e) { o = null; }
    if (!o || !Array.isArray(o.tabs) || !o.tabs.length) return false;
    o.tabs.forEach(function (x) {
      if (!x || !Array.isArray(x.stack) || !x.stack.length) return;
      var t = { id: ++seq, stack: x.stack.map(function (e) { return { url: String(e.url || ""), reader: !!e.reader, title: e.title }; }), idx: Math.max(0, Math.min(x.stack.length - 1, x.idx | 0)), inner: 0,
        view: document.createElement("div"), frame: null, loading: false, zoom: +x.zoom || 1, stale: true };
      t.view.className = "sf-view";
      views.appendChild(t.view);
      tabs.push(t);
    });
    if (!tabs.length) return false;
    select(tabs[o.cur] || tabs[0]);
    return true;
  }
  function syncBar() {
    var t = cur(), e = t ? entry(t) : { url: "" }, p = parse(e.url);
    btn("back").disabled = !t || !(t.idx > 0 || t.inner > 0);
    btn("fwd").disabled = !t || t.idx >= t.stack.length - 1;
    btn("reader").disabled = btn("out").disabled = !e.url;
    btn("reader").classList.toggle("on", !!e.reader);
    addr.classList.toggle("blank", !e.url);
    if (document.activeElement !== input) input.value = "";
    show.innerHTML = e.url ? (p && p.protocol === "https:" ? '<span class="sf-lock">' + ICON.lock + "</span>" : "") + "<span></span>" : "<span class=\"sf-ph\">搜索或输入网站名称</span>";
    if (e.url) show.lastChild.textContent = hostOf(e.url) || e.url;
    addr.classList.toggle("loading", !!(t && t.loading));
    prog.style.width = t && t.loading ? "70%" : "0";
  }

  // ---- 历史记录（存在本地，最多 40 条）----
  var HKEY = "tsu-safari-history";
  function history() { try { return JSON.parse(localStorage.getItem(HKEY)) || []; } catch (e) { return []; } }
  function remember(url, title) {
    var h = history().filter(function (x) { return x.url !== url; });
    h.unshift({ url: url, title: title, t: Date.now() });
    try { localStorage.setItem(HKEY, JSON.stringify(h.slice(0, 40))); } catch (e) {}
  }
  function clearHistory() { if (confirm("清除 Safari浏览器 的全部历史记录？")) localStorage.removeItem(HKEY); }

  // ---- 菜单 ----
  function menus() {
    var t = cur(), e = t ? entry(t) : { url: "" }, it = function (label, keys, run, o) { return Object.assign({ label: label, keys: keys || "", run: run }, o || {}); }, SEP = { sep: true };
    var go = function (u) { return function () { var x = cur() || newTab(""); if (entry(x).url) newTab(u); else navigate(x, u); }; };
    return [
      { title: "文件", items: [
        it("新建标签页", "", function () { newTab("", true); }),
        it("打开位置…", "⌘L", focusAddr),
        SEP,
        it(OUT_LABEL, "", function () { openOut(e.url); }, { disabled: !e.url }),
        SEP,
        it("关闭标签页", "", function () { closeTab(); }, { disabled: !t }),
      ] },
      { title: "显示", items: [
        it("重新载入页面", "⌘R", reload, { disabled: !e.url }),
        it(e.reader ? "退出阅读模式" : "显示阅读模式", "", function () { navigate(t, e.url, { reader: !e.reader }); }, { disabled: !e.url }),
        SEP,
        it("实际大小", "⌘0", function () { zoom(0); }, { disabled: !t || t.zoom === 1 }),
        it("放大", "⌘+", function () { zoom(1); }, { disabled: !t }),
        it("缩小", "⌘−", function () { zoom(-1); }, { disabled: !t }),
        SEP,
        it("显示上一个标签页", "⇧⌘[", function () { cycle(-1); }, { disabled: tabs.length < 2 }),
        it("显示下一个标签页", "⇧⌘]", function () { cycle(1); }, { disabled: tabs.length < 2 }),
      ] },
      { title: "历史记录", items: [
        it("后退", "⌘[", goBack, { disabled: !t || !(t.idx > 0 || t.inner > 0) }),
        it("前进", "⌘]", goForward, { disabled: !t || t.idx >= t.stack.length - 1 }),
        it("起始页", "", function () { navigate(cur() || newTab(""), ""); }),
        SEP,
      ].concat(history().slice(0, 12).map(function (h) { return it(h.title || h.url, "", go(h.url)); }), [SEP, it("清除历史记录…", "", clearHistory)]) },
      { title: "书签", items: FAVS.map(function (f) { return it(f.name, "", go(f.url)); }) },
    ];
  }
  function focusAddr() { input.focus(); }

  // 快捷键：只在 Safari 在最前、焦点不在网页里时生效（焦点进了跨源 iframe，键盘事件就到不了这里）
  window.addEventListener("keydown", function (e) {
    if (!e.metaKey || e.ctrlKey || e.altKey || D.front() !== win || win.state === "closed" || win.state === "min") return;
    var hit = null;
    if (e.code === "BracketLeft") hit = e.shiftKey ? function () { cycle(-1); } : goBack;
    else if (e.code === "BracketRight") hit = e.shiftKey ? function () { cycle(1); } : goForward;
    else if (e.code === "KeyL" && !e.shiftKey) hit = focusAddr;
    else if (e.code === "KeyR" && !e.shiftKey) hit = reload;
    else if (e.key === "0") hit = function () { zoom(0); };
    else if (e.key === "=" || e.key === "+") hit = function () { zoom(1); };
    else if (e.key === "-") hit = function () { zoom(-1); };
    if (hit) { e.preventDefault(); e.stopPropagation(); hit(); }
  }, true);
  // 点进 iframe 时 pointerdown 到不了窗口：看焦点落到了哪个 iframe 上，把 Safari 提到最前
  window.addEventListener("blur", function () {
    setTimeout(function () { var a = document.activeElement; if (a && a.tagName === "IFRAME" && el.contains(a) && D.front() !== win) win.front(); }, 0);
  });

  // 打开窗口时至少有一个标签页（Dock 点开也走这里）；关窗口 = 关掉所有标签页
  var show0 = win.show;
  win.show = function () {
    var first = !tabs.length && !restoreTabs();
    if (first) newTab("");
    tabsRestored = true;
    show0.call(win);
    if (first) setTimeout(function () { var s = cur() && cur().view.querySelector(".sf-start input"); if (s) s.focus(); }, 60);
  };

  // ---- 对外：TSU_SAFARI.open(url, { newTab }) ----
  function openURL(url, opts) {
    opts = opts || {};
    if (mobile()) return window.open(url, "_blank", "noopener"); // 手机上没有桌面
    var hidden = win.state === "closed" || win.state === "min";
    if (!tabs.length) restoreTabs();
    tabsRestored = true;
    if (!tabs.length) newTab(url); else place(url, opts);
    if (hidden) show0.call(win); else win.front();
  }
  // 放进哪个标签页：当前是空白起始页就用它，否则默认开新标签页（newTab: false 则在当前页打开）
  function place(url, opts) {
    var t = cur();
    if (t && !entry(t).url && t.stack.length === 1) return navigate(t, url, { replace: true });
    if (!t || opts.newTab !== false) return newTab(url);
    navigate(t, url);
  }
  window.TSU_SAFARI = { open: openURL, close: function () { win.hide("closed"); }, win: win };

  // ---- Dock：指南针图标，放在最后 ----
  D.addDockApp({ app: "safari", title: "Safari浏览器", className: "ico-safari", icon:
    '<svg viewBox="0 0 64 64" width="44" height="44"><defs><linearGradient id="sf-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1fc8ff"/><stop offset="1" stop-color="#1167e8"/></linearGradient></defs>' +
    '<circle cx="32" cy="32" r="29" fill="url(#sf-g)"/><circle cx="32" cy="32" r="25.5" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="1.2" stroke-dasharray="1 3.45"/>' +
    '<g transform="rotate(45 32 32)"><path d="M32 8 36.2 32H27.8z" fill="#ff3b30"/><path d="M32 56 27.8 32h8.4z" fill="#fff"/></g><circle cx="32" cy="32" r="2.2" fill="#fff"/></svg>' });

  // ---- 全局接管外链：桌面里点 target=_blank 或别的网站的链接，改在 Safari 里开 ----
  // 不管：Safari 窗口里的链接、带 data-external 的、下载链接、/auth/*、按着修饰键的（留给浏览器本身）、手机
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || mobile()) return;
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a || el.contains(a) || a.hasAttribute("data-external") || a.hasAttribute("download")) return;
    var p = parse(a.href);
    if (!p || !/^https?:$/.test(p.protocol)) return;
    var same = p.origin === location.origin;
    if (same && (/^\/auth\//.test(p.pathname) || a.target !== "_blank")) return;
    e.preventDefault();
    e.stopPropagation();
    openURL(p.href, { newTab: true });
  }, true);
})();
