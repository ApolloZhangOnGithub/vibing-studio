// guimap.js —— 图形界面（GUI）对话的缩略图：同终端界面右边那条（studio.js 的 mini()；那条每一格的颜色也是这里的 richRows 读出来的）。
//   跟着设置「缩略图」：始终显示 / 仅滚动时显示（手动滚的时候浮出来，停下收回）/ 透明 / 隐藏；只盖对话滚动的那块的右边（输入框不让），面板太窄不放。
//   画的是屏幕上真实的样子缩小（横竖同一个比例，同 VS Code 的缩略图）：每个元素自己的底色、边框，就是它在屏幕上的颜色（你的气泡、卡片、代码块、
//   diff 的红绿行、出错的条）；字一段一行一条，颜色就是那段字的颜色（链接、行内代码、高亮的代码都照着）；图片就画那张图。
//   内容筛选藏起来的、收起来的本来就不显示，也就不画。深浅色、配色方案换了：重新读。
//   便宜：每一问量一次、缓存（这一问变了——内容、高度、宽度——才重量），只量缩略图看得到的那几问；滚动只按位置重画（每帧最多一次）。
//   操作同终端界面那条：灰块是看得见的那段，按住拖 = 连续地滚；点灰块外面 = 那里放到中间（接着还能拖）；指着灰块深一点
(function () {
  "use strict";
  if (window.TSU_GUIMAP) return;
  var root = document.documentElement, MAPW = 70, PAD = 4;
  var mode = function () { var st = window.STUDIO, m = st && st.get ? st.get("minimap") : "scroll"; return m === true ? "show" : m || "scroll"; };
  var states = [];
  // 颜色：算出来的颜色交给画布（color-mix 算出来的 color(srgb …) 旧的画布不认：认不得的不画）
  var px = document.createElement("canvas").getContext("2d"), CC = {};
  function cc(c) {
    var v = CC[c];
    if (v === undefined) { px.fillStyle = "#010203"; px.fillStyle = c; v = CC[c] = px.fillStyle === "#010203" && !/^#010203$/i.test(c) ? null : px.fillStyle; }
    return v;
  }
  var clear = function (c) { return !c || c === "transparent" || /^rgba\(.*,\s*0\)$/.test(c) || /\/\s*0\)$/.test(c); };

  // ---- 一问里画什么：按结构（不是把屏幕缩小——以前逐个元素读颜色、逐行量字，一问几百次调用时量一次就卡，远处的还被逼着排版）：
  //   你的话一块（在气泡的位置，蓝）；回答是几道灰的细线；工具、一组是一条按类上色的短条（命令绿、读取 / 搜索蓝、编辑橙、网页青、子 Agent 紫、MCP 粉），
  //   在跑的橙、出错的红；压缩上下文一道虚线。只量每一块自己的框（getBoundingClientRect），不往里走；每一块记下一句话（指着缩略图时浮出来）
  var SEL = ":scope > .gv-user, :scope > .gv-day, :scope > .gv-compact, :scope > .gv-syserr, :scope > .gv-note, :scope > .gv-tsb > *, :scope > .gv-ai > *, :scope > .gv-ai > .gv-tsb > *";
  function shapesOf(t, left, top) {
    var out = [];
    t.querySelectorAll(SEL).forEach(function (el) {
      var cl = el.classList;
      if (cl.contains("gv-tsb") || cl.contains("gv-ts") || el.tagName === "TIME") return;
      var r = el.getBoundingClientRect();
      if (r.height < 1 || r.width < 1) return;
      var k, lab = "";
      var st = function () { var x = el.querySelector(":scope > .gv-sum .gv-st, :scope > .gv-sum"); return x ? x.textContent : ""; };
      if (cl.contains("gv-user")) { k = "user"; var bb = el.querySelector(".gv-bubble"); if (bb) r = bb.getBoundingClientRect(); lab = (bb || el).textContent; }
      else if (cl.contains("gv-tool") || cl.contains("gv-group")) { k = cl.contains("err") || cl.contains("bad") ? "err" : cl.contains("run") ? "run" : "k:" + (el.dataset.kind || "other"); lab = st(); }
      else if (cl.contains("gv-syserr")) { k = cl.contains("bad") ? "err" : "note"; lab = el.textContent; }
      else if (cl.contains("gv-compact")) { k = "compact"; lab = st(); }
      else if (cl.contains("gv-day")) { k = "day"; lab = el.textContent; }
      else if (cl.contains("gv-think") || cl.contains("gv-progl") || cl.contains("gv-note") || cl.contains("gv-cmdrec")) { k = "note"; lab = st() || el.textContent; }
      else { k = "text"; lab = el.textContent; }
      out.push({ k: k, x: r.left - left, y: r.top - top, w: r.width, h: r.height, lab: String(lab || "").replace(/\s+/g, " ").trim().slice(0, 160) });
    });
    return out;
  }
  var KC = { bash: "#3fb950", read: "#4c8dff", search: "#4c8dff", edit: "#f0883e", web: "#1fb8c9", agent: "#a371f7", task: "#8b949e", mcp: "#db61a2", other: "#8b949e" };
  var themeC = null;
  function colors() {
    if (themeC) return themeC;
    var cs = getComputedStyle(root);
    themeC = { fg: cc(cs.getPropertyValue("--st-fg").trim() || "#888") || "#888", dim: cc(cs.getPropertyValue("--st-dim").trim() || "#999") || "#999", red: cc(cs.getPropertyValue("--st-red").trim() || "#e5484d") || "#e5484d",
      orange: cc(cs.getPropertyValue("--st-orange").trim() || "#d97757") || "#d97757", line: cc(cs.getPropertyValue("--st-line").trim() || "#ccc") || "#ccc", user: "#4c8dff" };
    return themeC;
  }
  // ---- 量：每一问在滚动内容里的位置；缩略图看得到的那几问量出形状（缓存）----
  function layout(st, k, off, H) {
    var sc = st.sc, sr = sc.getBoundingClientRect(), y0 = sr.top - sc.scrollTop, w = sc.clientWidth;
    var lo = off / k - 300, hi = (off + H) / k + 300, blocks = [];
    sc.querySelectorAll(":scope > .gv-list > .gv-turn, :scope > .gv-live").forEach(function (t) {
      if (t.hidden) return;
      var rt = t.getBoundingClientRect();
      if (!rt.height) return;
      var ty = rt.top - y0, c = st.cache.get(t), fresh = c && c.w === w && c.h === Math.round(rt.height) && !st.dirty.has(t);
      var far = t.classList.contains("gv-far"); // 离得远、没画的那几问：不量（一量就逼着它排版）——有量过的就用上次的，没有的先画一块淡的
      if (!fresh && !far && ty + rt.height >= lo && ty <= hi) { c = { w: w, h: Math.round(rt.height), s: shapesOf(t, sr.left, rt.top) }; st.cache.set(t, c); st.dirty.delete(t); fresh = true; }
      blocks.push({ y: ty, h: rt.height, s: fresh ? c.s : c && c.s ? c.s : null, far: far });
    });
    st.laid = blocks;
    st.laidK = k;
  }

  // 画：full = 重新量（内容、宽度变了、定时的那次）；否则只按滚到哪重画
  function paint(st, full) {
    var sc = st.sc, m = st.m, H = sc.clientHeight;
    if (!st.on || !H) return;
    var top = sc.offsetTop + "px", ht = H + "px";
    if (m.style.top !== top) m.style.top = top;
    if (m.style.height !== ht) m.style.height = ht;
    var W = m.clientWidth || MAPW, dpr = window.devicePixelRatio || 1, k = (W - PAD * 2) / Math.max(1, sc.clientWidth);
    var span = Math.max(1, sc.scrollHeight - H), total = sc.scrollHeight * k, off = total > H ? Math.round(Math.min(1, sc.scrollTop / span) * (total - H)) : 0;
    if (full || !st.laid || st.laidK !== k) layout(st, k, off, H);
    var cv = st.cv, g = cv.getContext("2d");
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + "px"; cv.style.height = H + "px"; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    var missing = false, C = colors(), hits = [];
    st.laid.forEach(function (b) {
      var by = b.y * k - off;
      if (by > H || by + b.h * k < 0) return;
      if (!b.s) { if (!b.far) missing = true; g.globalAlpha = 0.18; g.fillStyle = C.dim; g.fillRect(PAD, by, W - PAD * 2, Math.max(1, b.h * k)); return; } // 还没量过的：一块淡的
      b.s.forEach(function (sh) {
        var y = (b.y + sh.y) * k - off, h = Math.max(1, sh.h * k), x = PAD + sh.x * k, w = Math.max(2, Math.min(sh.w * k, W - PAD - x));
        if (y > H || y + h < 0 || w <= 0) return;
        if (sh.k === "user") { g.globalAlpha = 0.9; g.fillStyle = C.user; g.fillRect(x, y, w, Math.max(2.5, h)); if (sh.lab) hits.push({ y0: y - 1, y1: y + Math.max(3, h) + 1, lab: sh.lab, k: "user" }); return; }
        if (sh.k === "text") { g.globalAlpha = 0.42; g.fillStyle = C.dim; var step = Math.max(2.2, 22 * k), th = Math.max(0.9, Math.min(1.6, 9 * k)); for (var yy = y + step * 0.3; yy < y + h; yy += step) g.fillRect(x, yy, w * (0.72 + 0.26 * ((Math.floor(yy) * 7) % 10) / 10), th); return; }
        if (sh.k === "compact") { g.globalAlpha = 0.7; g.fillStyle = C.dim; for (var xx = PAD; xx < W - PAD; xx += 4) g.fillRect(xx, y + h / 2, 2, 1); hits.push({ y0: y - 2, y1: y + h + 2, lab: sh.lab, k: "compact" }); return; }
        if (sh.k === "day") { g.globalAlpha = 0.5; g.fillStyle = C.line; g.fillRect(PAD, y + h / 2, W - PAD * 2, 1); return; }
        if (sh.k === "note") { g.globalAlpha = 0.3; g.fillStyle = C.dim; g.fillRect(x, y + h / 2 - 0.6, w * 0.6, 1.2); return; }
        var col = sh.k === "err" ? C.red : sh.k === "run" ? C.orange : KC[sh.k.slice(2)] || C.dim; // 工具、一组：左边一道实的、后面一条淡的
        g.globalAlpha = 1; g.fillStyle = col; g.fillRect(x, y, 2.5, Math.max(1.6, h));
        g.globalAlpha = sh.k === "err" || sh.k === "run" ? 0.55 : 0.32; g.fillRect(x + 3.5, y, Math.max(2, w - 3.5), Math.max(1.6, h));
        if (sh.lab) hits.push({ y0: y - 1, y1: y + Math.max(2, h) + 1, lab: sh.lab, k: sh.k });
      });
    });
    st.hits = hits;
    g.globalAlpha = 1;
    if (missing) soon(st, 90); // 滚到了还没量过的那几问：一会儿补上
    var vt = sc.scrollTop * k - off, vh = Math.max(8, H * k);
    st.view.style.top = vt + "px";
    st.view.style.height = vh + "px";
    st.geo = { off: off, total: total, top: vt, h: vh, H: H, k: k };
  }
  function soon(st, ms) { if (st.t) return; st.t = setTimeout(function () { st.t = 0; if (st.on) paint(st, true); }, ms); }

  // ---- 一个图形界面的对话：接上 ----
  function setup(host) {
    var sc = host.querySelector(":scope > .gv-scroll");
    if (!sc) return;
    var st = { host: host, sc: sc, cache: new WeakMap(), dirty: new Set(), on: false, mode: "" };
    host._gm = st;
    var m = st.m = document.createElement("div");
    m.className = "gv-map";
    m.hidden = true;
    m.innerHTML = '<canvas></canvas><div class="gv-view"></div>';
    host.appendChild(m);
    st.cv = m.querySelector("canvas");
    st.view = m.querySelector(".gv-view");
    // 内容变了：记下是哪一问（下一次画的时候重量它）；流式输出时最多 0.2 秒量一次
    st.mo = new MutationObserver(function (ms) {
      ms.forEach(function (r) { var el = r.target.nodeType === 1 ? r.target : r.target.parentNode, t = el && el.closest ? el.closest(".gv-turn, .gv-live") : null; if (t) st.dirty.add(t); });
      if (st.on) soon(st, 200);
    });
    st.mo.observe(sc, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "hidden"] });
    st.ro = new ResizeObserver(function () { if (st.on) soon(st, 60); });
    st.ro.observe(sc);
    var raf = 0;
    st.onScroll = function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; if (st.on) paint(st, false); }); };
    sc.addEventListener("scroll", st.onScroll, { passive: true });
    // 仅滚动时显示：手动滚（滚轮、触控板）的时候浮出来，停下 1.2 秒收回（指着、拖着不收）；跟着新输出自动滚到底的不算
    var hideT = 0;
    st.onWheel = function () {
      if (!st.on || st.mode !== "scroll") return;
      if (!m.classList.contains("show")) { m.classList.add("show"); paint(st, true); }
      clearTimeout(hideT);
      hideT = setTimeout(function hide() { if (m.matches(":hover") || m.dragging) { hideT = setTimeout(hide, 600); return; } m.classList.remove("show"); }, 1200);
    };
    host.addEventListener("wheel", st.onWheel, { passive: true });
    // 灰块外面点一下：那里放到中间；按住拖：连续地滚
    m.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      try { m.setPointerCapture(e.pointerId); } catch (x) { /* 不是真的指针（测试）*/ }
      var r = m.getBoundingClientRect(), y = e.clientY - r.top, g = st.geo || { off: 0, total: 1, top: 0, h: 0, H: r.height, k: 1 };
      if (y < g.top || y > g.top + g.h) { sc.scrollTop = (g.off + y) / g.k - sc.clientHeight / 2; paint(st, false); g = st.geo || g; }
      var y0 = e.clientY, s0 = sc.scrollTop, span = Math.max(1, sc.scrollHeight - sc.clientHeight), range = Math.max(1, Math.min(g.H, g.total) - g.h);
      var mv = function (ev) { sc.scrollTop = Math.max(0, Math.min(span, s0 + (ev.clientY - y0) / range * span)); };
      var up = function () { m.dragging = false; m.removeEventListener("pointermove", mv); m.removeEventListener("pointerup", up); m.removeEventListener("pointercancel", up); };
      m.dragging = true;
      m.addEventListener("pointermove", mv);
      m.addEventListener("pointerup", up);
      m.addEventListener("pointercancel", up);
    });
    // 指着缩略图：浮出那一块是什么（你的话、工具的标题、出错的那句）；点一下照旧是跳过去
    var tip = document.createElement("div");
    tip.className = "gv-mtip"; tip.hidden = true;
    m.appendChild(tip);
    m.addEventListener("pointermove", function (e) {
      if (m.dragging) { tip.hidden = true; return; }
      var r = m.getBoundingClientRect(), y = e.clientY - r.top, hit = null;
      (st.hits || []).forEach(function (h) { if (y >= h.y0 && y <= h.y1 && (!hit || h.k === "user" || (h.k === "err" && hit.k !== "user"))) hit = h; });
      if (!hit) { tip.hidden = true; return; }
      tip.textContent = (hit.k === "user" ? "❯ " : "") + hit.lab;
      tip.hidden = false;
      tip.style.top = Math.max(0, Math.min(r.height - 24, y - 10)) + "px";
    });
    m.addEventListener("pointerleave", function () { tip.hidden = true; });
    st.dispose = function () { st.mo.disconnect(); st.ro.disconnect(); sc.removeEventListener("scroll", st.onScroll); host.removeEventListener("wheel", st.onWheel); clearTimeout(st.t); m.remove(); host._gm = null; };
    states.push(st);
    update(st);
  }
  // 放不放、怎么放：设置的那一种、面板够不够宽（窄的不放：字更要紧）
  function update(st) {
    var md = mode(), w = st.host.clientWidth, on = md !== "hide" && root.classList.contains("termapp") && w >= (md === "scroll" ? 360 : 520);
    if (on !== st.on || md !== st.mode) {
      st.on = on; st.mode = md;
      st.host.classList.toggle("gv-hasmap", on && md !== "scroll"); // 浮着的不占地方
      st.host.classList.toggle("gv-mapclear", on && md === "transparent");
      st.host.classList.toggle("gv-mapfloat", on && md === "scroll");
      st.m.hidden = !on;
      if (!on) st.m.classList.remove("show");
    }
    if (on && (md !== "scroll" || st.m.classList.contains("show"))) paint(st, true);
  }
  function sync(force) {
    if (document.hidden && force !== true) return; // 看不见的窗口不画（测试里 sync(true) 硬画）
    document.querySelectorAll(".gv:not(.xp-gsnap)").forEach(function (h) { if (!h._gm) setup(h); });
    states = states.filter(function (st) { if (st.host.isConnected) { update(st); return true; } st.dispose(); return false; });
  }
  setInterval(sync, 1000);
  // 设置变了（缩略图的档位、菜单里指着预览）、主题换了：马上跟上
  var quick = 0;
  var again = function () { clearTimeout(quick); quick = setTimeout(function () { themeC = null; states.forEach(function (st) { st.cache = new WeakMap(); st.laid = null; }); sync(); }, 30); }; // 颜色都记在形状里：换了主题全部重量
  document.addEventListener("st-settings-changed", again);
  new MutationObserver(again).observe(root, { attributes: true, attributeFilter: ["class", "style"] });
  var lastMode = "";
  setInterval(function () { var md = mode(); if (md !== lastMode) { lastMode = md; sync(); } }, 250); // 菜单里指着「缩略图」的几档时预览
  // ======== 终端界面（TUI）、文件页、真终端的缩略图：照屏幕上真实的样子（studio.js 的 paintMini 用；以前是按每行开头的字猜颜色——
  //   「- 列表」「2026-…」都被当成 diff 的删除行画成红的）。每一格字画成一小格，颜色就是它在屏幕上的颜色；空格不画；
  //   有底色的地方先铺底色（灰底的问、展开的工具详情、diff 那一行、真终端里有背景色的格子）。按块缓存，块变了才重读 ========
  var WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꥠ-꥿가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\ud83c-\ud83e][\udc00-\udfff]/;
  var BLOCKCLS = /(^|\s)(blk|ask|grp|gdet|fig|ln|line)(\s|$)/, BLOCKTAG = /^(DIV|P|LI|UL|OL|PRE|TABLE|TR|H[1-6]|BLOCKQUOTE|SECTION|ARTICLE)$/;
  var epoch = "", colC = new WeakMap(), bgC = {};
  function themeKey() { var cs = getComputedStyle(root); return root.className + "|" + cs.getPropertyValue("--st-fg") + cs.getPropertyValue("--st-bg"); }
  var colorOf = function (el) { var c = colC.get(el); if (!c) { c = getComputedStyle(el).color; colC.set(el, c); } return c; };
  // 这个元素自己的底色：灰底的问 / 展开的详情（::before 画的）、diff 行（自己的背景）
  function bgOf(el) {
    var cl = el.classList;
    if (cl.contains("ask") || cl.contains("gdet")) { var k = cl.contains("ask") ? "ask" : "gdet"; if (!(k in bgC)) bgC[k] = getComputedStyle(el, "::before").backgroundColor; return bgC[k]; }
    if (cl.contains("drow")) return getComputedStyle(el).backgroundColor;
    return null;
  }
  var cellBoxW = function (el) { var st = el.getAttribute("style") || ""; if (!/inline-block/.test(st) || !/--ttu-cell/.test(st)) return 0; var m = /\*\s*(\d+)/.exec(st); return m ? +m[1] : 1; }; // TTU 给认不得宽度的字包的一格（或几格）宽的框
  // 一块里的每一行：{ bg, runs: [[列, 格数, 颜色]] }
  function rowsOf(node, rowH) {
    var rows = [], row = null, col = 0, bgs = [];
    var start = function () { row = { bg: bgs.length ? bgs[bgs.length - 1] : null, runs: [] }; rows.push(row); col = 0; };
    var put = function (w, color) { if (!row) start(); var rs = row.runs, last = rs[rs.length - 1]; if (last && last[2] === color && last[0] + last[1] === col) last[1] += w; else rs.push([col, w, color]); };
    function text(n) {
      var s = n.data, color = null;
      for (var i = 0; i < s.length; i++) {
        var ch = s.charAt(i);
        if (ch === "\n") { if (!row) start(); row = null; continue; }
        if (!row) start();
        var w = 1, c2 = s.charCodeAt(i);
        if (c2 >= 0xd800 && c2 < 0xdc00) { ch += s.charAt(++i); w = 2; } else if (WIDE.test(ch)) w = 2;
        if (ch === " " || ch === " " || ch === "\t" || (c2 >= 0xe000 && c2 <= 0xe0ff)) { col += w; continue; }
        put(w, color || (color = colorOf(n.parentNode)));
        col += w;
      }
    }
    function elem(el) {
      var cl = el.classList;
      if (cl.contains("tts") || el.tagName === "BR" && (row = null, true)) return;
      if (cl.contains("fig") || el.tagName === "IMG") { // 图片：按它占的行数铺一块
        row = null;
        var n = Math.max(1, Math.round(el.offsetHeight / (rowH || 17))), w = Math.max(2, Math.round(el.offsetWidth / 8));
        for (var k = 0; k < n; k++) { start(); row.runs.push([0, w, "rgba(128,128,128,0.55)"]); }
        row = null;
        return;
      }
      var bw = cellBoxW(el);
      if (bw) { if (el.querySelector(".tdot") || /\S/.test(el.textContent)) put(bw, colorOf(el.querySelector(".tdot") || el)); else if (!row) start(); col += bw; return; }
      if (cl.contains("tdot")) { put(1, colorOf(el)); col += 1; return; }
      var block = BLOCKCLS.test(el.className) || BLOCKTAG.test(el.tagName), bg = bgOf(el);
      if (block) row = null;
      if (bg && cl.contains("drow")) { if (!row) start(); row.bg = bg; }
      else if (bg) bgs.push(bg);
      for (var c = el.firstChild; c; c = c.nextSibling) { if (c.nodeType === 3) text(c); else if (c.nodeType === 1) elem(c); }
      if (bg && !cl.contains("drow")) bgs.pop();
      if (block) row = null;
    }
    if (node.nodeType === 3) text(node); else elem(node);
    return rows;
  }
  // 一整块区域：一个子元素一份缓存（变了——里面的字、样子——才重读）
  function blockRows(host, rowH) {
    var ek = themeKey();
    if (ek !== epoch) { epoch = ek; colC = new WeakMap(); bgC = {}; }
    var st = host._mmr;
    if (!st || st.epoch !== ek) {
      st = host._mmr = { epoch: ek, cache: new WeakMap() };
      if (host._mmo) host._mmo.disconnect();
      host._mmo = new MutationObserver(function (ms) { ms.forEach(function (r) { var n = r.target; while (n && n.parentNode !== host) n = n.parentNode; if (n) st.cache.delete(n); }); });
      host._mmo.observe(host, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "style"] });
    }
    var out = [];
    for (var c = host.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1 && (c.hidden || c.classList.contains("tts"))) continue;
      if (c.nodeType !== 1 && c.nodeType !== 3) continue;
      var e = c.nodeType === 1 ? st.cache.get(c) : null;
      if (!e) { e = rowsOf(c, rowH); if (c.nodeType === 1) st.cache.set(c, e); }
      out.push.apply(out, e);
    }
    return out;
  }
  // 真终端（xterm）：每一格的前景色、背景色照 xterm 自己的（调色板、256 色、真彩色）；只读缩略图看得到的那几行
  var ANSI = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white", "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite"];
  var DEF16 = ["#000000", "#cd3131", "#0dbc79", "#e5e510", "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5", "#666666", "#f14c4c", "#23d18b", "#f5f543", "#3b8eea", "#d670d6", "#29b8db", "#ffffff"];
  function xtermRows(x) {
    var b = x.buffer.active, th = (x.options && x.options.theme) || {}, cell = b.getNullCell ? b.getNullCell() : undefined, cache = {};
    var hex = function (v) { return "#" + ("00000" + (v >>> 0).toString(16)).slice(-6); };
    var pal = function (i) { if (i < 16) return th[ANSI[i]] || DEF16[i]; if (i < 232) { i -= 16; var f = function (c) { return c ? c * 40 + 55 : 0; }; return "rgb(" + f(Math.floor(i / 36)) + "," + f(Math.floor(i / 6) % 6) + "," + f(i % 6) + ")"; } var gr = (i - 232) * 10 + 8; return "rgb(" + gr + "," + gr + "," + gr + ")"; };
    var fgOf = function (c) { return c.isFgDefault() ? th.foreground || "#cccccc" : c.isFgPalette() ? pal(c.getFgColor()) : c.isFgRGB() ? hex(c.getFgColor()) : th.foreground || "#cccccc"; };
    var bgOf2 = function (c) { return c.isBgDefault() ? null : c.isBgPalette() ? pal(c.getBgColor()) : c.isBgRGB() ? hex(c.getBgColor()) : null; };
    return { length: b.length, get: function (i) {
      if (cache[i]) return cache[i];
      var line = b.getLine(i), row = { bg: null, runs: [], bgs: [] };
      if (line) for (var j = 0; j < line.length; j++) {
        var c = line.getCell(j, cell);
        if (!c) continue;
        var w = c.getWidth();
        if (!w) continue;
        var inv = c.isInverse && c.isInverse(), fg = fgOf(c), bgc = bgOf2(c);
        if (inv) { var t = fg; fg = bgc || th.background || "#000000"; bgc = t; }
        if (bgc) { var lb = row.bgs[row.bgs.length - 1]; if (lb && lb[2] === bgc && lb[0] + lb[1] === j) lb[1] += w; else row.bgs.push([j, w, bgc]); }
        var ch = c.getChars();
        if (!ch || ch === " ") continue;
        var lr = row.runs[row.runs.length - 1];
        if (lr && lr[2] === fg && lr[0] + lr[1] === j) lr[1] += w; else row.runs.push([j, w, fg]);
      }
      return (cache[i] = row);
    } };
  }
  // 给 studio.js 的缩略图：这一块现在的每一行（没有就 null：照旧按字画）
  function richRows(P) {
    var prog = P && P.program;
    if (!prog) return null;
    try {
      if (prog.pty && prog.xterm && prog.xterm()) return xtermRows(prog.xterm());
      if (prog.page === "file") { var fb = P.el.querySelector(".st-fbody"); return fb ? blockRows(fb, 17) : null; }
      if (prog.agentId && !prog.gui && P.out) return blockRows(P.out, P.rowH);
    } catch (e) { return null; }
    return null;
  }
  // 画一行：先底色（整行的、一段段的），再字（每格一小条）
  function drawRow(g, row, y, cw, W, lh) {
    if (!row) return;
    var a0 = g.globalAlpha;
    if (row.bg) { g.globalAlpha = 0.9; g.fillStyle = row.bg; g.fillRect(2, y, W - 4, lh); }
    if (row.bgs && row.bgs.length) { g.globalAlpha = 0.9; row.bgs.forEach(function (b) { g.fillStyle = b[2]; g.fillRect(4 + b[0] * cw, y, Math.max(1, b[1] * cw), lh); }); }
    g.globalAlpha = a0;
    row.runs.forEach(function (r) { var x = 4 + r[0] * cw; if (x >= W - 2) return; g.fillStyle = r[2]; g.fillRect(x, y, Math.max(0.8, Math.min(r[1] * cw, W - 2 - x)), lh * 0.7); });
  }
  window.TSU_GUIMAP = { sync: sync, states: function () { return states; }, richRows: richRows, drawRow: drawRow };
})();
