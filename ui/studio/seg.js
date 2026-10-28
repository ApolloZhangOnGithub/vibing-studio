// seg.js —— 分段控件的滑块：class 里有 st-seg 的一排按钮（选中的那个是 .on），选中的底色不再「啪」地跳到另一格，
// 而是平平地滑过去（同 Claude App 的分段控件：略亮的实色块 + 细边，短、不回弹；样子见 seg.css）。
//   画法：容器的 ::before 就是那一块（seg.css），位置大小是容器上的 --seg-x/y/w/h；它的颜色、圆角、阴影照抄原来 .on 那一格的
//   （所以每种风格里还是原来的样子），.on 自己的底色去掉。
//   重画（innerHTML 整个换掉）也能滑：容器带 data-seg-key 的，记住上次那块在哪，新画出来的从那里滑到新位置。
//   什么时候动：.on 换了（MutationObserver 看 class）、新画出来的（看子节点增加）、大小变了（ResizeObserver，不带动画）。
(function () {
  "use strict";
  if (window.TSU_SEG) return;
  var LAST = {}; // data-seg-key → 上次那块的位置
  var reduce = function () { return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); };
  var onOf = function (c) { for (var i = 0; i < c.children.length; i++) if (c.children[i].classList.contains("on")) return c.children[i]; return null; };
  var clear = function (bg) { return !bg || bg === "transparent" || /rgba\([^)]*,\s*0\)$/.test(bg); };
  var ro = window.ResizeObserver ? new ResizeObserver(function (es) { es.forEach(function (e) { paint(e.target, true); }); }) : null;
  function put(c, r) {
    c.style.setProperty("--seg-x", r.x + "px");
    c.style.setProperty("--seg-y", r.y + "px");
    c.style.setProperty("--seg-w", r.w + "px");
    c.style.setProperty("--seg-h", r.h + "px");
  }
  // 第一次见到这个容器：抄下 .on 那一格原来的样子（还没去掉它的底色之前）
  function adopt(c, b) {
    c._seg = true;
    if (getComputedStyle(c).position === "static") c.style.position = "relative"; // 那块按容器定位（本来就定位了的不动它）
    var cs = getComputedStyle(b);
    if (!clear(cs.backgroundColor)) c.style.setProperty("--seg-bg", cs.backgroundColor);
    if (cs.backgroundImage && cs.backgroundImage !== "none") c.style.setProperty("--seg-img", cs.backgroundImage);
    c.style.setProperty("--seg-r", cs.borderRadius || "6px");
    if (cs.boxShadow && cs.boxShadow !== "none") c.style.setProperty("--seg-shadow", cs.boxShadow);
    if (ro) ro.observe(c);
  }
  // 换了深浅色、配色方案、应用风格：.on 那一格原来的样子变了，重新抄一遍（不然深色里还留着浅色时抄的白底）
  function readopt(c) {
    var b = onOf(c);
    if (!b || !c.isConnected) return;
    var had = c.classList.contains("seg-on");
    c.classList.remove("seg-on"); // .on 自己的底色露出来才量得到（同一帧里放回去，看不到闪）
    ["--seg-bg", "--seg-img", "--seg-shadow"].forEach(function (k) { c.style.removeProperty(k); });
    var cs = getComputedStyle(b);
    if (!clear(cs.backgroundColor)) c.style.setProperty("--seg-bg", cs.backgroundColor);
    if (cs.backgroundImage && cs.backgroundImage !== "none") c.style.setProperty("--seg-img", cs.backgroundImage);
    c.style.setProperty("--seg-r", cs.borderRadius || "6px");
    if (cs.boxShadow && cs.boxShadow !== "none") c.style.setProperty("--seg-shadow", cs.boxShadow);
    if (had) c.classList.add("seg-on");
  }
  var themeKey = function () { var r = document.documentElement; return r.className + "|" + getComputedStyle(r).getPropertyValue("--st-bg") + "|" + getComputedStyle(r).getPropertyValue("--st-hi"); };
  var lastTheme = "";
  function paint(c, still) {
    var b = onOf(c);
    if (!b || !c.isConnected || !b.offsetWidth) { c._segOn = b; return; }
    if (!c._seg) adopt(c, b);
    var r = { x: b.offsetLeft, y: b.offsetTop, w: b.offsetWidth, h: b.offsetHeight }, k = c.dataset.segKey, idx = Array.prototype.indexOf.call(c.children, b);
    var last = k ? LAST[k] : null, from = c._segR || (last && last.r) || null;
    // 只有「选中的是哪一格」真的换了才滑（点了另一格、重画出来的是新选的那格）；位置不一样但还是同一格（换页回来、宽度变了、字体刚载入）不滑——
    //   以前按像素比：每次切到设置那一页，滑块都从别处滑一遍，没点也动
    var prevI = c._segI !== undefined ? c._segI : last ? last.i : idx;
    var moved = from && prevI !== idx && (from.x !== r.x || from.y !== r.y || from.w !== r.w || from.h !== r.h);
    c._segOn = b;
    c._segR = r;
    c._segI = idx;
    if (k) LAST[k] = { r: r, i: idx };
    if (!moved || still || reduce() || !c.classList.contains("seg-on") && !(k && from)) { c.classList.remove("seg-anim"); put(c, r); c.classList.add("seg-on"); return; }
    // 从原来的位置滑到新的：先不带过渡放到起点，下一帧带过渡放到终点
    c.classList.remove("seg-anim");
    put(c, from);
    c.classList.add("seg-on");
    void c.offsetWidth;
    c.classList.add("seg-anim", "seg-moving");
    c.style.setProperty("--seg-dir", r.x >= from.x ? "1" : "-1");
    put(c, r);
    clearTimeout(c._segT);
    c._segT = setTimeout(function () { c.classList.remove("seg-moving"); }, 360);
  }
  // 扫一遍：新的、.on 换了的才动
  var dirty = [], scanAll = false, raf = 0, themeDirty = false;
  function flush() {
    raf = 0;
    var tk = themeKey();
    if (tk !== lastTheme) { var first = !lastTheme; lastTheme = tk; if (!first) { var ss = document.getElementsByClassName("st-seg"); for (var j = 0; j < ss.length; j++) if (ss[j]._seg) { readopt(ss[j]); paint(ss[j], true); } } }
    if (scanAll) {
      scanAll = false;
      var all = document.getElementsByClassName("st-seg");
      for (var i = 0; i < all.length; i++) if (!all[i]._seg || all[i]._segOn !== onOf(all[i])) dirty.push(all[i]);
    }
    var list = dirty;
    dirty = [];
    list.forEach(function (c, i) { if (list.indexOf(c) === i) paint(c); });
  }
  var soon = function () { if (!raf) raf = requestAnimationFrame(flush); };
  new MutationObserver(function (ms) {
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      if (m.type === "attributes" && m.target === document.documentElement) { themeDirty = true; continue; } // 根上的 class / style 变了：可能换了主题，flush 里比一下
      if (m.type === "attributes") { var p = m.target.parentElement; if (p && p.classList.contains("st-seg")) dirty.push(p); else if (m.target.classList && m.target.classList.contains("st-seg")) dirty.push(m.target); }
      // 加进来的节点：只看它自己和它里面有没有分段控件——以前一有节点加进来（对话每秒刷新的一行、状态栏……）就把整个页面扫一遍，
      //   长对话几万个元素，空闲时一直在扫（能耗：2026-10-28 采样里占了主线程的一成）
      else for (var j = 0; j < m.addedNodes.length; j++) {
        var nd = m.addedNodes[j];
        if (nd.nodeType !== 1) continue;
        if (nd.classList.contains("st-seg")) dirty.push(nd);
        if (nd.firstElementChild) { var inner = nd.getElementsByClassName("st-seg"); for (var q = 0; q < inner.length; q++) dirty.push(inner[q]); }
      }
    }
    if (dirty.length || scanAll || themeDirty) { themeDirty = false; soon(); }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  // 根上的 style（配色方案的变量都写在这里）：只看根自己，不看整棵树（树里的 style 变得太频繁）
  new MutationObserver(function () { themeDirty = false; soon(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
  // 字体、风格换了（按钮宽度变了）：跟着挪，不带动画
  window.addEventListener("resize", function () { var all = document.getElementsByClassName("st-seg"); for (var i = 0; i < all.length; i++) if (all[i]._seg) paint(all[i], true); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { scanAll = true; soon(); });
  scanAll = true;
  soon();
  window.TSU_SEG = { refresh: function (c) { if (c) paint(c, true); else { scanAll = true; soon(); } } };
})();
