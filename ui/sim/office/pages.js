// office/pages.js —— 文稿：Pages 的样子，Word 的文件
// · 页面视图：一页一页的白纸（纸张、页边距、页码），正文在页与页之间真的断开——文字一行一行地排到下一页（不是整段挪），
//   表格按行、图片整块；手动分页符（⌘↩）。做法：正文是一个 contenteditable，排版后在跨页的那一行前面插一个不可编辑的「垫片」，
//   把后面的内容推到下一页的版心顶上；每次改动后重排（输入法组字时不动）
// · 段落样式（标题、副标题、标题 1–3、正文、引文、说明、代码）、字体字号、粗斜下划删除线、颜色、高亮、对齐、行距段距、缩进（首行缩进两字）、
//   项目符号 / 编号列表（Tab 缩进）、表格（Tab 走格子，右键插删行列）、图片（插入、粘贴、拖进来、拖角改大小）、链接、水平线
// · 撤销 / 重做自己管（快照 + 光标位置），查找替换（高亮所有结果），目录侧栏，字数统计，打印 / 存成 PDF
(function () {
  "use strict";
  var O = window.TSU_OFFICE, PG = O.pg, D = window.TSU_DESK;
  if (!O || !PG) return;
  var ui = O.ui, el = O.el, esc = O.esc, it = O.item, SEP = O.SEP;
  var GAP = 28;
  var FONTS = [
    ["", "默认（苹方 / Helvetica Neue）"], ["PingFang SC", "苹方"], ["Songti SC", "宋体"], ["Kaiti SC", "楷体"], ["Heiti SC", "黑体"], ["STFangsong", "仿宋"],
    ["Microsoft YaHei", "微软雅黑"], ["DengXian", "等线"], ["SimSun", "SimSun"], ["Helvetica Neue", "Helvetica Neue"], ["Arial", "Arial"], ["Times New Roman", "Times New Roman"],
    ["Georgia", "Georgia"], ["Palatino", "Palatino"], ["Avenir Next", "Avenir Next"], ["Futura", "Futura"], ["Menlo", "Menlo"], ["Courier New", "Courier New"],
  ];
  var SIZES_PT = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 48, 72];
  var CJK = /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]/g;

  function createView(doc, state) {
    var images = state.images || new PG.Images();
    var page = Object.assign(PG.defaultPage(), state.page || {});
    var docStyles = state.styles || {};
    var pageNumbers = state.pageNumbers != null ? !!state.pageNumbers : false;
    var props = Object.assign({ title: "", author: "" }, state.props || {});
    var zoomPref = localStorage.getItem("tsu-pages-zoom"), zoom = zoomPref && zoomPref !== "fit" ? +zoomPref || 1 : 1, autoZoom = !zoomPref || zoomPref === "fit", showCount = localStorage.getItem("tsu-pages-count") !== "off", showToc = false, inspMode = "format", inspTab = "style";
    var hist = { stack: [], idx: -1, timer: 0 }, composing = false, pages = 1, lastSelBlock = null;

    var root = el("div", "pg");
    root.innerHTML =
      '<div class="pg-find" hidden><input class="ofc-in pg-fq" placeholder="查找" spellcheck="false"><span class="pg-fn"></span><button type="button" class="ofc-btn" data-f="prev">‹</button><button type="button" class="ofc-btn" data-f="next">›</button>' +
      '<input class="ofc-in pg-fr" placeholder="替换为" spellcheck="false"><button type="button" class="ofc-btn" data-f="rep">替换</button><button type="button" class="ofc-btn" data-f="all">全部替换</button>' +
      '<label class="ofc-check"><input type="checkbox" data-f="case"><span>区分大小写</span></label><span class="pg-sp2"></span><button type="button" class="ofc-btn" data-f="done">完成</button></div>' +
      '<div class="pg-body"><div class="pg-side" hidden><div class="pg-side-h">目录</div><div class="pg-toc"></div></div>' +
      '<div class="pg-scroll"><div class="pg-canvas"><div class="pg-sizer"><div class="pg-zoom"><div class="pg-pages"></div><div class="pg-flow" contenteditable="true" spellcheck="false"></div>' +
      '<div class="pg-imgsel" hidden><b data-h="se"></b></div></div></div></div></div></div>' +
      '<div class="pg-count"></div>';
    var $ = function (s) { return root.querySelector(s); };
    var scroll = $(".pg-scroll"), canvas = $(".pg-canvas"), sizer = $(".pg-sizer"), zoomEl = $(".pg-zoom"), pagesEl = $(".pg-pages"), flow = $(".pg-flow"), imgSel = $(".pg-imgsel"), countEl = $(".pg-count"), findEl = $(".pg-find"), side = $(".pg-side"), toc = $(".pg-toc");
    flow.innerHTML = state.html || "<p><br></p>";
    flow.spellcheck = localStorage.getItem("tsu-pages-spell") === "on";
    normalizeFlow();

    // ======== 页面几何 ========
    var S = function () { return page.h + GAP; }, CH = function () { return page.h - page.mt - page.mb; };
    function applyPage() {
      zoomEl.style.width = page.w + "px";
      flow.style.left = page.ml + "px";
      flow.style.top = page.mt + "px";
      flow.style.width = (page.w - page.ml - page.mr) + "px";
      flow.style.minHeight = CH() + "px";
      applyStyles();
      paginate();
    }
    function applyStyles() {
      var st = PG.mergedStyles(docStyles);
      Object.keys(st).forEach(function (k) {
        var s = st[k], set = function (n, v) { if (v == null || v === "") flow.style.removeProperty("--" + k + "-" + n); else flow.style.setProperty("--" + k + "-" + n, v); };
        set("size", s.size + "pt");
        set("line", s.line);
        set("before", (s.before || 0) + "pt");
        set("after", (s.after || 0) + "pt");
        set("color", s.color || null);
        set("font", s.font ? '"' + s.font + '"' : null);
        set("weight", s.bold === false ? "400" : s.bold ? "700" : null);
        set("style", s.italic ? "italic" : null);
        set("align", s.align || null);
        set("indent", s.firstChars ? s.firstChars + "em" : null);
      });
    }
    function layoutCanvas() {
      if (autoZoom && scroll.clientWidth) { var sw = scroll.clientWidth, fz = Math.max(sw < 600 ? 0.25 : 0.5, Math.min(1.25, Math.floor((sw - (sw < 600 ? 20 : 48)) / page.w * 100) / 100)); if (Math.abs(fz - zoom) > 0.005) { zoom = fz; doc.refresh(); } } // 窄屏（手机）可以缩到一半以下
      var h = pages * S() - GAP, w = page.w;
      zoomEl.style.height = h + "px";
      zoomEl.style.transform = "scale(" + zoom + ")";
      sizer.style.width = Math.ceil(w * zoom) + "px";
      sizer.style.height = Math.ceil(h * zoom) + "px";
    }
    function renderPages() {
      var want = pages;
      while (pagesEl.children.length < want) pagesEl.appendChild(el("div", "pg-page", '<span class="pg-num"></span>'));
      while (pagesEl.children.length > want) pagesEl.lastChild.remove();
      Array.prototype.forEach.call(pagesEl.children, function (p, i) {
        p.style.top = i * S() + "px";
        p.style.height = page.h + "px";
        p.style.width = page.w + "px";
        var num = p.firstChild;
        num.textContent = pageNumbers ? String(i + 1) : "";
        num.style.bottom = Math.max(12, page.mb / 2 - 8) + "px";
      });
      layoutCanvas();
    }

    // ======== 分页：垫片 ========
    function spacer(h) { var s = document.createElement("div"); s.className = "pg-sp"; s.contentEditable = "false"; s.style.height = h + "px"; return s; }
    function spacerRow(h, cols) { var tr = document.createElement("tr"), td = document.createElement("td"); tr.className = "pg-sp"; tr.contentEditable = "false"; td.colSpan = Math.max(1, cols); td.style.height = h + "px"; tr.appendChild(td); return tr; }
    function isTextBlock(n) { return /^(P|H1|H2|H3|H4|H5|H6|BLOCKQUOTE|PRE|LI)$/.test(n.tagName); }
    function units() {
      var out = [];
      function walk(parent) {
        for (var n = parent.firstElementChild; n; n = n.nextElementSibling) {
          if (n.classList.contains("pg-sp")) continue;
          var t = n.tagName;
          if (t === "UL" || t === "OL") { list(n); continue; }
          if (t === "TABLE") { var cols = 0; n.querySelectorAll("tr").forEach(function (tr) { if (tr.closest("table") !== n || tr.classList.contains("pg-sp")) return; var c = 0; Array.prototype.forEach.call(tr.children, function (td) { c += td.colSpan || 1; }); cols = Math.max(cols, c); out.push({ kind: "row", el: tr, cols: cols }); }); continue; }
          if (t === "HR") { out.push({ kind: n.classList.contains("pg-break") ? "break" : "atom", el: n }); continue; }
          if (t === "DIV") { walk(n); continue; }
          out.push({ kind: "text", el: n, head: /^H[1-3]$/.test(t) });
        }
      }
      function list(l) {
        Array.prototype.forEach.call(l.children, function (li) {
          if (li.tagName === "UL" || li.tagName === "OL") { list(li); return; }
          if (li.tagName !== "LI") return;
          out.push({ kind: "text", el: li, li: true });
          Array.prototype.forEach.call(li.children, function (c) { if (c.tagName === "UL" || c.tagName === "OL") list(c); });
        });
      }
      walk(flow);
      return out;
    }
    // 文字块里（不含嵌套的列表、垫片）第一个下沿超过 limit 的字：{ node, offset, top } 或图片 / 换行元素
    function firstBelow(block, limit, toY, after) {
      var rng = document.createRange(), started = !after, res = null;
      (function walk(n) {
        for (var c = n.firstChild; c && !res; c = c.nextSibling) {
          if (c.nodeType === 1) {
            if (c.classList.contains("pg-sp") || c.tagName === "UL" || c.tagName === "OL") continue;
            if (after && c === after.node) { started = true; continue; }
            if (c.tagName === "IMG") { if (!started) continue; var r = c.getBoundingClientRect(); if (toY(r.bottom) > limit + 0.5) res = { el: c, top: toY(r.top) }; continue; }
            walk(c);
            continue;
          }
          if (c.nodeType !== 3 || !c.nodeValue.length) continue;
          var from = 0;
          if (after && c === after.node) { started = true; from = after.offset + 1; }
          if (!started) continue;
          rng.selectNodeContents(c);
          var rects = rng.getClientRects();
          if (!rects.length || toY(rects[rects.length - 1].bottom) <= limit + 0.5) continue;
          var lo = from, hi = c.nodeValue.length - 1, ans = -1, ansTop = 0;
          while (lo <= hi) {
            var mid = (lo + hi) >> 1;
            rng.setStart(c, mid);
            rng.setEnd(c, mid + 1);
            var rc = rng.getClientRects(), last = rc.length ? rc[rc.length - 1] : null;
            if (last && last.height > 0 && toY(last.bottom) > limit + 0.5) { ans = mid; ansTop = toY(last.top); hi = mid - 1; } else lo = mid + 1;
          }
          if (ans >= 0) res = { node: c, offset: ans, top: ansTop };
        }
      })(block);
      return res;
    }
    function firstLineTop(block, toY) {
      var rng = document.createRange(), top = null;
      (function walk(n) {
        for (var c = n.firstChild; c && top == null; c = c.nextSibling) {
          if (c.nodeType === 1) { if (c.classList.contains("pg-sp") || c.tagName === "UL" || c.tagName === "OL") continue; if (c.tagName === "IMG" || c.tagName === "BR") { var r = c.getBoundingClientRect(); if (r.height) top = toY(r.top); continue; } walk(c); continue; }
          if (c.nodeType === 3 && c.nodeValue.trim()) { rng.setStart(c, 0); rng.setEnd(c, Math.min(1, c.nodeValue.length)); var rc = rng.getClientRects(); if (rc.length && rc[0].height) top = toY(rc[0].top); }
        }
      })(block);
      return top;
    }
    function removeSpacers() {
      var parents = new Set();
      flow.querySelectorAll(".pg-sp").forEach(function (s) { parents.add(s.parentNode); s.remove(); });
      parents.forEach(function (p) { if (p && p.isConnected && p.nodeName !== "TBODY" && p.nodeName !== "TABLE") p.normalize(); });
      flow.querySelectorAll("hr.pg-break").forEach(function (b) { b.style.height = ""; });
    }
    function paginate() {
      if (composing || !flow.isConnected) return;
      removeSpacers();
      var s = S(), ch = CH(), fr = flow.getBoundingClientRect(), z = zoom, toY = function (y) { return (y - fr.top) / z; };
      var plans = [], off = 0, pg = 0, lastBottom = 0, prev = null;
      var list = units();
      for (var i = 0; i < list.length; i++) {
        var u = list[i], r = u.el.getBoundingClientRect(), top = toY(r.top), bot = toY(r.bottom);
        if (u.li) { var nested = u.el.querySelector(":scope > ul, :scope > ol"); if (nested) bot = toY(nested.getBoundingClientRect().top); }
        if (bot - top < 0.5 && u.kind !== "break") { continue; }
        lastBottom = Math.max(lastBottom, bot + off);
        while (top + off >= (pg + 1) * s - 0.5) pg++;
        if (u.kind === "break") {
          var need = (pg + 1) * s - (top + off);
          plans.push({ kind: "break", el: u.el, h: need });
          off += need - (bot - top);
          pg++;
          prev = null;
          continue;
        }
        var startOff = off, guard = 0, after = null, pushedWhole = false;
        while (guard++ < 200) {
          var pBottom = pg * s + ch;
          if (bot + off <= pBottom + 0.5) break;
          // 在页面下方的空白（下边距、页缝）里开始的：整个挪到下一页
          if (top + off > pBottom - 2 && !after) {
            var h0 = (pg + 1) * s - (top + off);
            plans.push({ kind: u.kind === "row" ? "row" : "start", el: u.el, h: h0, cols: u.cols });
            off += h0; pg++; pushedWhole = true;
            continue;
          }
          if (u.kind !== "text") {
            if (top + off - pg * s < 1 || bot - top > ch) break; // 已经在页首，或者比一页还高：放着
            var h1 = (pg + 1) * s - (top + off);
            // 标题跟着下一段走
            if (prev && prev.head && prev.page === pg && prev.top + prev.off - pg * s > 1) { plans.push({ kind: "start", el: prev.el, h: (pg + 1) * s - (prev.top + prev.off) }); off = prev.off + ((pg + 1) * s - (prev.top + prev.off)); pg++; prev = null; continue; }
            plans.push({ kind: u.kind === "row" ? "row" : "start", el: u.el, h: h1, cols: u.cols });
            off += h1; pg++; pushedWhole = true;
            continue;
          }
          var sp = firstBelow(u.el, pBottom - off, toY, after);
          if (!sp) break;
          var flt = firstLineTop(u.el, toY), spTop = sp.top;
          var atStart = flt == null || spTop - flt < 1;
          // 只有第一行留在这页（孤行）也整段挪
          var lh = parseFloat(getComputedStyle(u.el).lineHeight) || 20;
          if (!after && (atStart || spTop - flt < lh * 1.5)) {
            if (top + off - pg * s < 1) { if (atStart) break; }
            else {
              if (prev && prev.head && prev.page === pg && prev.top + prev.off - pg * s > 1) { plans.push({ kind: "start", el: prev.el, h: (pg + 1) * s - (prev.top + prev.off) }); off = prev.off + ((pg + 1) * s - (prev.top + prev.off)); pg++; prev = null; continue; }
              var h2 = (pg + 1) * s - ((flt != null ? flt : top) + off);
              plans.push({ kind: "start", el: u.el, h: h2 });
              off += h2; pg++; pushedWhole = true;
              continue;
            }
          }
          var h3 = (pg + 1) * s - (spTop + off);
          plans.push({ kind: "split", sp: sp, h: h3 });
          off += h3; pg++;
          after = sp.node ? { node: sp.node, offset: sp.offset } : { node: sp.el };
        }
        prev = u.kind === "text" ? { el: u.el, head: u.head, top: top, off: startOff, page: Math.floor((top + startOff) / s) } : null;
        if (pushedWhole && prev) prev.off = off - 0;
        lastBottom = Math.max(lastBottom, bot + off);
      }
      // 从后往前插（前面的偏移量不会被后面的插入打乱）
      for (var k = plans.length - 1; k >= 0; k--) {
        var p = plans[k];
        if (p.h < 0.5) continue;
        if (p.kind === "break") p.el.style.height = Math.max(8, p.h) + "px";
        else if (p.kind === "row") p.el.parentNode.insertBefore(spacerRow(p.h, p.cols), p.el);
        else if (p.kind === "start") p.el.insertBefore(spacer(p.h), p.el.firstChild);
        else if (p.kind === "split") {
          var spl = p.sp;
          if (spl.el) spl.el.parentNode.insertBefore(spacer(p.h), spl.el);
          else if (spl.offset === 0) spl.node.parentNode.insertBefore(spacer(p.h), spl.node);
          else { var tail = spl.node.splitText(spl.offset); tail.parentNode.insertBefore(spacer(p.h), tail); }
        }
      }
      var n = Math.max(1, Math.floor(Math.max(0, lastBottom - 1) / s) + 1);
      if (n !== pages) { pages = n; }
      renderPages();
      placeImgSel();
    }
    var pagT = 0;
    function paginateSoon() { if (!pagT) pagT = requestAnimationFrame(function () { pagT = 0; paginate(); }); }

    // ======== 规整：根下面只有块；空段落有 <br> ========
    function normalizeFlow() {
      var n = flow.firstChild, cur = null;
      while (n) {
        var next = n.nextSibling;
        var isBlock = n.nodeType === 1 && /^(P|H[1-6]|UL|OL|TABLE|BLOCKQUOTE|PRE|HR|DIV)$/.test(n.tagName);
        if (!isBlock && !(n.nodeType === 1 && n.classList.contains("pg-sp"))) {
          if (n.nodeType === 3 && !n.nodeValue.trim() && !cur) { n.remove(); n = next; continue; }
          if (!cur) { cur = document.createElement("p"); flow.insertBefore(cur, n); }
          cur.appendChild(n);
        } else cur = null;
        n = next;
      }
      flow.querySelectorAll("div:not(.pg-sp)").forEach(function (d) {
        if (d.closest(".pg-sp")) return;
        var p = document.createElement("p");
        Array.prototype.slice.call(d.attributes).forEach(function (a) { if (a.name === "style") p.setAttribute("style", a.value); });
        while (d.firstChild) p.appendChild(d.firstChild);
        d.replaceWith(p);
      });
      if (!flow.firstElementChild) flow.appendChild(el("p", null, "<br>"));
    }

    // ======== 撤销 ========
    function cleanHTML() {
      return flow.innerHTML.replace(/<div class="pg-sp"[^>]*><\/div>/g, "").replace(/<tr class="pg-sp"[^>]*>.*?<\/tr>/g, "").replace(/(<hr class="pg-break")\s+style="[^"]*"/g, "$1");
    }
    // 光标位置记成「第几个字」（块的开头也算一个位置），重建 DOM 后能放回去
    function bookmark() {
      var sel = window.getSelection();
      if (!sel.rangeCount || !flow.contains(sel.anchorNode)) return null;
      var r = sel.getRangeAt(0);
      return { s: offsetOf(r.startContainer, r.startOffset), e: offsetOf(r.endContainer, r.endOffset) };
    }
    function walkPositions(fn) {
      // 按文档顺序走：文字节点逐字；块元素开头、<br>、<img> 各占一个位置
      var pos = 0, stop = false;
      (function walk(n) {
        for (var c = n.firstChild; c && !stop; c = c.nextSibling) {
          if (c.nodeType === 1 && c.classList.contains("pg-sp")) continue;
          if (c.nodeType === 3) { if (fn(c, pos, c.nodeValue.length) === false) { stop = true; return; } pos += c.nodeValue.length; continue; }
          if (c.nodeType !== 1) continue;
          if (/^(BR|IMG|HR)$/.test(c.tagName)) { if (fn(c, pos, 1) === false) { stop = true; return; } pos += 1; continue; }
          if (/^(P|H[1-6]|LI|BLOCKQUOTE|PRE|TD)$/.test(c.tagName)) pos += 1; // 只数放文字的块：p 变成 li、li 挪进子列表，位置都不变
          if (fn(c, pos, -1) === false) { stop = true; return; }
          walk(c);
        }
      })(flow);
      return pos;
    }
    function offsetOf(node, off) {
      var target = null;
      if (node.nodeType === 1) { if (off < node.childNodes.length) { target = node.childNodes[off]; off = 0; } else { target = node; off = -1; } }
      var result = 0, found = false;
      walkPositions(function (c, pos, len) {
        if (found) return false;
        if (node.nodeType === 3 && c === node) { result = pos + off; found = true; return false; }
        if (target && c === target) { result = pos; found = true; return false; }
        result = pos + Math.max(0, len);
      });
      return result;
    }
    function nodeAt(pos) {
      var res = null;
      walkPositions(function (c, p, len) {
        if (c.nodeType === 3 && pos >= p && pos <= p + len) { res = { node: c, offset: pos - p }; return false; }
        if (c.nodeType === 1 && len === 1 && pos === p) { res = { node: c.parentNode, offset: Array.prototype.indexOf.call(c.parentNode.childNodes, c) }; return false; }
        if (c.nodeType === 1 && len === -1 && pos === p) { res = { node: c, offset: 0 }; }
      });
      return res;
    }
    // 结构变了但文字节点没换（挪位置、换外层标签）时：直接按节点记住光标，比按字数准
    function saveSel() {
      var s = window.getSelection();
      if (!s.rangeCount) return null;
      var r = s.getRangeAt(0);
      return { sc: r.startContainer, so: r.startOffset, ec: r.endContainer, eo: r.endOffset, bm: bookmark() };
    }
    var relinked = new Map(); // 换了外壳的元素：旧 → 新（光标原来落在旧元素上时用）
    function relink(a, b) { relinked.set(a, b); }
    function loadSel(x) {
      if (!x) return;
      if (relinked.size) { if (relinked.has(x.sc)) x.sc = relinked.get(x.sc); if (relinked.has(x.ec)) x.ec = relinked.get(x.ec); relinked.clear(); }
      var ok = function (n) { return n && n.isConnected && flow.contains(n) && !(n.nodeType === 1 && n.classList.contains("pg-sp")); };
      if (ok(x.sc) && ok(x.ec)) {
        try {
          var r = document.createRange();
          r.setStart(x.sc, Math.min(x.so, x.sc.nodeType === 3 ? x.sc.nodeValue.length : x.sc.childNodes.length));
          r.setEnd(x.ec, Math.min(x.eo, x.ec.nodeType === 3 ? x.ec.nodeValue.length : x.ec.childNodes.length));
          var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
          return;
        } catch (e) { /* 用字数位置 */ }
      }
      restoreBookmark(x.bm);
    }
    function restoreBookmark(bm) {
      if (!bm) return;
      var a = nodeAt(bm.s), b = nodeAt(bm.e);
      if (!a) return;
      var sel = window.getSelection(), r = document.createRange();
      try { r.setStart(a.node, a.offset); r.setEnd((b || a).node, (b || a).offset); sel.removeAllRanges(); sel.addRange(r); } catch (e) { /* 放不回去就算了 */ }
    }
    function record() {
      clearTimeout(hist.timer);
      hist.timer = 0;
      var html = cleanHTML(), cur = hist.stack[hist.idx];
      if (cur && cur.html === html) { cur.bm = bookmark() || cur.bm; return false; }
      hist.stack.splice(hist.idx + 1);
      hist.stack.push({ html: html, bm: bookmark() });
      if (hist.stack.length > 200) hist.stack.shift();
      hist.idx = hist.stack.length - 1;
      return true;
    }
    function recordSoon() { clearTimeout(hist.timer); hist.timer = setTimeout(record, 650); }
    function undo() {
      if (hist.timer) record();
      if (hist.idx <= 0) return;
      hist.idx--;
      restoreState(hist.stack[hist.idx]);
    }
    function redo() {
      if (hist.timer) record();
      if (hist.idx >= hist.stack.length - 1) return;
      hist.idx++;
      restoreState(hist.stack[hist.idx]);
    }
    function restoreState(st) {
      flow.innerHTML = st.html;
      normalizeFlow();
      paginate();
      flow.focus({ preventScroll: true });
      restoreBookmark(st.bm);
      scrollCaretIntoView();
      changed(true);
    }
    // 改动了：自动存储、字数、目录、检查器
    var infoT = 0;
    function changed(fromHistory) {
      doc.changed();
      if (!fromHistory) recordSoon();
      clearTimeout(infoT);
      infoT = setTimeout(function () { updateCount(); if (showToc) renderToc(); }, 250);
    }

    // ======== 输入 ========
    document.execCommand("defaultParagraphSeparator", false, "p");
    flow.addEventListener("beforeinput", function (e) {
      var t = e.inputType;
      if (t === "historyUndo") { e.preventDefault(); undo(); return; }
      if (t === "historyRedo") { e.preventDefault(); redo(); return; }
      if (t === "insertCompositionText" || e.isComposing) return;
      // 在垫片旁边删字：先把这一块里的垫片拿掉，让浏览器照常处理（删字、并段）
      if (/^delete/.test(t) || t === "insertParagraph" || t === "insertLineBreak") {
        var sel = window.getSelection(), n = sel.anchorNode, blk = n && (n.nodeType === 1 ? n : n.parentNode).closest && (n.nodeType === 1 ? n : n.parentNode).closest("p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, td");
        if (blk && flow.contains(blk)) {
          var near = [blk, blk.previousElementSibling, blk.nextElementSibling];
          near.forEach(function (b) { if (b) b.querySelectorAll(".pg-sp").forEach(function (s) { s.remove(); }); });
          if (blk.closest("tr")) { var tr = blk.closest("tr"); [tr.previousElementSibling, tr.nextElementSibling].forEach(function (x) { if (x && x.classList.contains("pg-sp")) x.remove(); }); }
        }
      }
    });
    flow.addEventListener("input", function (e) {
      if (e.isComposing || composing) return;
      fixFontSizes();
      paginate();
      changed();
    });
    flow.addEventListener("compositionstart", function () { composing = true; });
    flow.addEventListener("compositionend", function () { composing = false; paginate(); changed(); });
    flow.addEventListener("keydown", function (e) {
      if (e.isComposing || e.keyCode === 229) return;
      var mod = e.metaKey || e.ctrlKey, k = e.key, code = e.code;
      if (mod && !e.altKey && code === "KeyZ") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && !e.altKey && code === "KeyY") { e.preventDefault(); redo(); return; }
      if (mod && !e.altKey && !e.shiftKey && code === "KeyB") { e.preventDefault(); cmd("bold"); return; }
      if (mod && !e.altKey && !e.shiftKey && code === "KeyI") { e.preventDefault(); cmd("italic"); return; }
      if (mod && !e.altKey && !e.shiftKey && code === "KeyU") { e.preventDefault(); cmd("underline"); return; }
      if (mod && !e.altKey && code === "KeyK") { e.preventDefault(); linkUI(); return; }
      if (mod && !e.altKey && code === "KeyF") { e.preventDefault(); openFind(e.shiftKey); return; }
      if (mod && e.altKey && code === "KeyF") { e.preventDefault(); openFind(true); return; }
      if (mod && code === "Enter") { e.preventDefault(); insertPageBreak(); return; }
      if (mod && e.altKey && code === "KeyI") { e.preventDefault(); doc.showInspector(); return; }
      if (mod && (code === "Equal" || code === "Minus" || code === "Digit0") && !e.altKey) { e.preventDefault(); setZoom(code === "Digit0" ? 1 : code === "Equal" ? zoom + 0.1 : zoom - 0.1); return; }
      if (mod && e.shiftKey && (code === "Period" || code === "Comma")) { e.preventDefault(); stepSize(code === "Period" ? 1 : -1); return; }
      if (mod && e.altKey && /^Digit[0-6]$/.test(code)) { e.preventDefault(); setBlockStyle(["body", "h1", "h2", "h3", "title", "subtitle", "quote"][+code.slice(5)]); return; }
      if (mod && e.shiftKey && code === "Digit7") { e.preventDefault(); toggleList("ol"); return; }
      if (mod && e.shiftKey && code === "Digit8") { e.preventDefault(); toggleList("ul"); return; }
      if (mod && !e.shiftKey && (code === "BracketRight" || code === "BracketLeft")) { e.preventDefault(); indent(code === "BracketRight" ? 1 : -1); return; }
      if (k === "Tab" && !mod && !e.altKey) {
        e.preventDefault();
        var cell = selEl() && selEl().closest("td");
        if (cell && flow.contains(cell)) { tabCell(cell, e.shiftKey); return; }
        if (selEl() && selEl().closest("li")) { indent(e.shiftKey ? -1 : 1); return; }
        if (e.shiftKey) return;
        document.execCommand("insertText", false, "\t");
        return;
      }
      if ((k === "Backspace" || k === "Delete") && selectedImg) { e.preventDefault(); record(); selectedImg.remove(); selectImg(null); paginate(); changed(); return; }
      if (k === "Enter" && !e.shiftKey && !mod) {
        // 标题、说明里回车：下一段回到正文（同 Pages）
        var b = curBlock();
        if (b && /^(H1|H2|H3)$/.test(b.tagName) || b && b.tagName === "P" && (b.classList.contains("subtitle") || b.classList.contains("caption"))) {
          var sel = window.getSelection();
          if (sel.isCollapsed && atEndOf(b)) {
            e.preventDefault();
            record();
            var np = el("p", null, "<br>");
            b.parentNode.insertBefore(np, b.nextSibling);
            placeCaret(np, 0);
            paginate();
            changed();
            return;
          }
        }
      }
    });
    function atEndOf(b) {
      var sel = window.getSelection(), r = document.createRange();
      r.selectNodeContents(b);
      r.setStart(sel.focusNode, sel.focusOffset);
      return !r.toString().replace(/​/g, "").length && !r.cloneContents().querySelector("img");
    }
    function placeCaret(node, off) { var r = document.createRange(), sel = window.getSelection(); r.setStart(node, off); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); }
    function selEl() { var s = window.getSelection(); if (!s.rangeCount) return null; var n = s.anchorNode; if (!n || !flow.contains(n)) return null; return n.nodeType === 1 ? n : n.parentNode; }
    function curBlock() { var e0 = selEl(); return e0 ? e0.closest("p, h1, h2, h3, h4, h5, h6, li, blockquote, pre") : null; }
    function selectedBlocks() {
      var sel = window.getSelection();
      if (!sel.rangeCount) return [];
      var r = sel.getRangeAt(0), out = [];
      if (r.collapsed) { var b0 = curBlock(); return b0 ? [b0] : []; }
      units().forEach(function (u) {
        if (u.kind !== "text" || !r.intersectsNode(u.el)) return;
        if (u.li) {
          // 列表项只看它自己的文字（不含子列表）：光标在子项里时，父项不算选中
          var own = document.createRange(), sub = u.el.querySelector(":scope > ul, :scope > ol");
          own.selectNodeContents(u.el);
          if (sub) own.setEndBefore(sub);
          if (r.compareBoundaryPoints(Range.START_TO_END, own) <= 0 || r.compareBoundaryPoints(Range.END_TO_START, own) >= 0) return;
        }
        out.push(u.el);
      });
      if (!out.length) { var b = curBlock(); if (b) out.push(b); }
      return out;
    }
    function scrollCaretIntoView() {
      var sel = window.getSelection();
      if (!sel.rangeCount) return;
      var r = sel.getRangeAt(0).getBoundingClientRect(), sr = scroll.getBoundingClientRect();
      if (!r.height && !r.width) { var n = selEl(); if (n) r = n.getBoundingClientRect(); }
      if (r.bottom > sr.bottom - 30) scroll.scrollTop += r.bottom - sr.bottom + 60;
      else if (r.top < sr.top + 30) scroll.scrollTop -= sr.top - r.top + 60;
    }

    // ======== 格式命令 ========
    function cmd(name, value) {
      flow.focus({ preventScroll: true });
      record();
      var css = name === "foreColor" || name === "hiliteColor" || name === "fontName" || name === "backColor";
      document.execCommand("styleWithCSS", false, css);
      document.execCommand(name, false, value);
      document.execCommand("styleWithCSS", false, false);
      fixFontSizes();
      paginate();
      changed();
      syncSoon();
    }
    // 字号：浏览器只认 1–7 级，先用 7 级占位再换成磅值
    var pendingSize = null;
    function setFontSize(pt) {
      flow.focus({ preventScroll: true });
      record();
      pendingSize = pt;
      document.execCommand("styleWithCSS", false, false);
      document.execCommand("fontSize", false, "7");
      fixFontSizes();
      paginate();
      changed();
      syncSoon();
    }
    function fixFontSizes() {
      flow.querySelectorAll('font[size="7"], span[style*="xxx-large"]').forEach(function (f) {
        var sp = document.createElement("span");
        sp.style.fontSize = (pendingSize || 12) + "pt";
        if (f.tagName === "SPAN") { sp.setAttribute("style", f.getAttribute("style").replace(/font-size:\s*xxx-large;?/, "")); sp.style.fontSize = (pendingSize || 12) + "pt"; }
        while (f.firstChild) sp.appendChild(f.firstChild);
        f.replaceWith(sp);
        // 里面原来带的字号去掉（新字号要生效）
        sp.querySelectorAll("span").forEach(function (x) { x.style.fontSize = ""; if (!x.getAttribute("style")) { while (x.firstChild) x.parentNode.insertBefore(x.firstChild, x); x.remove(); } });
      });
      flow.querySelectorAll("font").forEach(function (f) {
        var sp = document.createElement("span");
        if (f.color) sp.style.color = f.color;
        if (f.face) sp.style.fontFamily = f.face;
        while (f.firstChild) sp.appendChild(f.firstChild);
        f.replaceWith(sp);
      });
    }
    function stepSize(d) {
      var cur = parseFloat(getComputedStyle(selEl() || flow).fontSize) * 0.75, i = SIZES_PT.findIndex(function (x) { return x >= cur - 0.1; });
      var next = d > 0 ? SIZES_PT[Math.min(SIZES_PT.length - 1, (SIZES_PT[i] > cur + 0.1 ? i : i + 1))] : SIZES_PT[Math.max(0, i - 1)];
      setFontSize(next);
    }
    // 段落样式：换标签（和类名），原来的对齐之类的留着
    function setBlockStyle(id) {
      var ps = PG.PSTYLES.find(function (x) { return x.id === id; });
      if (!ps) return;
      flow.focus({ preventScroll: true });
      record();
      removeSpacers();
      var saved = saveSel();
      selectedBlocks().forEach(function (b) {
        if (b.tagName === "LI") { if (id === "body") return; var list = b.parentNode; if (list.children.length === 1 && list.parentNode === flow) { b = unwrapList(list); } else return; }
        if (PG.styleOfBlock(b) === id) return;
        var nb = document.createElement(ps.tag.toLowerCase());
        if (ps.cls) nb.className = ps.cls;
        var st = b.getAttribute("style");
        if (st) nb.setAttribute("style", st);
        if (ps.tag === "PRE") nb.textContent = b.innerText;
        else if (b.tagName === "PRE") nb.innerHTML = esc(b.textContent).replace(/\n/g, "<br>");
        else while (b.firstChild) nb.appendChild(b.firstChild);
        if (!nb.firstChild) nb.appendChild(document.createElement("br"));
        b.replaceWith(nb);
        relink(b, nb);
      });
      loadSel(saved);
      paginate();
      changed();
      syncSoon();
    }
    function unwrapList(list) { var li = list.firstElementChild, p = document.createElement("p"); while (li.firstChild) p.appendChild(li.firstChild); list.replaceWith(p); return p; }
    // 段落属性：对齐、行距、段前段后、缩进
    function setBlockProp(prop, value) {
      flow.focus({ preventScroll: true });
      record();
      selectedBlocks().forEach(function (b) { if (value == null || value === "") b.style.removeProperty(prop); else b.style.setProperty(prop, value); if (!b.getAttribute("style")) b.removeAttribute("style"); });
      paginate();
      changed();
      syncSoon();
    }
    // ---- 列表：自己做（浏览器的 insertUnorderedList 会把列表塞进 <p> 里，indent 会生成 <ul><ul>）----
    function toggleList(type) {
      flow.focus({ preventScroll: true });
      record();
      removeSpacers();
      var saved = saveSel(), blocks = selectedBlocks(), tag = type.toUpperCase();
      var allIn = blocks.length && blocks.every(function (b) { return b.tagName === "LI" && b.parentNode.tagName === tag; });
      if (allIn) blocks.slice().reverse().forEach(function (li) { liToPara(li); });
      else {
        // 已经在别的列表里的：换列表类型；普通段落：连着的几段包成一个列表
        var lists = new Set(), run = [];
        var flush = function () {
          if (!run.length) return;
          var l = document.createElement(type);
          run[0].parentNode.insertBefore(l, run[0]);
          run.forEach(function (b) { var li = document.createElement("li"); if (b.style.textAlign) li.style.textAlign = b.style.textAlign; while (b.firstChild) li.appendChild(b.firstChild); if (!li.firstChild) li.appendChild(document.createElement("br")); l.appendChild(li); b.remove(); relink(b, li); });
          mergeAdjacentLists(l);
          run = [];
        };
        blocks.forEach(function (b) {
          if (b.tagName === "LI") { flush(); lists.add(b.parentNode); return; }
          if (b.parentNode !== flow && !b.parentNode.closest("td")) { flush(); return; }
          if (run.length && run[run.length - 1].nextElementSibling !== b) flush();
          run.push(b);
        });
        flush();
        lists.forEach(function (l) { if (l.tagName !== tag) { var nl = document.createElement(type); Array.prototype.slice.call(l.attributes).forEach(function (a) { if (a.name !== "start") nl.setAttribute(a.name, a.value); }); while (l.firstChild) nl.appendChild(l.firstChild); l.replaceWith(nl); } });
      }
      loadSel(saved);
      paginate();
      changed();
      syncSoon();
    }
    function mergeAdjacentLists(l) {
      var prev = l.previousElementSibling, next = l.nextElementSibling;
      if (next && next.tagName === l.tagName) { while (next.firstChild) l.appendChild(next.firstChild); next.remove(); }
      if (prev && prev.tagName === l.tagName) { while (l.firstChild) prev.appendChild(l.firstChild); l.remove(); return prev; }
      return l;
    }
    // 一个列表项变回段落：列表在它这里断开
    function liToPara(li) {
      var list = li.parentNode, p = document.createElement("p"), nested = [];
      Array.prototype.slice.call(li.childNodes).forEach(function (c) { if (c.nodeType === 1 && (c.tagName === "UL" || c.tagName === "OL")) nested.push(c); else p.appendChild(c); });
      if (!p.firstChild) p.appendChild(document.createElement("br"));
      if (li.style.textAlign) p.style.textAlign = li.style.textAlign;
      relink(li, p);
      var after = document.createElement(list.tagName), n = li.nextElementSibling;
      while (n) { var nx = n.nextElementSibling; after.appendChild(n); n = nx; }
      var host = list.parentNode.tagName === "LI" ? null : list;
      if (!host) {
        // 嵌套列表里的项：挪到外层列表去（相当于减少缩进）
        var outerLi = list.parentNode, outer = outerLi.parentNode, nli = document.createElement("li");
        while (p.firstChild) nli.appendChild(p.firstChild);
        relink(li, nli);
        nested.forEach(function (x) { nli.appendChild(x); });
        if (after.children.length) nli.appendChild(after);
        outer.insertBefore(nli, outerLi.nextSibling);
        li.remove();
        if (!list.children.length) list.remove();
        return nli;
      }
      list.parentNode.insertBefore(p, list.nextSibling);
      var ref = p;
      nested.forEach(function (x) { ref.parentNode.insertBefore(x, ref.nextSibling); ref = x; });
      if (after.children.length) ref.parentNode.insertBefore(after, ref.nextSibling);
      li.remove();
      if (!list.children.length) list.remove();
      return p;
    }
    function indentLi(li, d) {
      if (d > 0) {
        var prev = li.previousElementSibling;
        if (!prev || prev.tagName !== "LI") return;
        var sub = Array.prototype.slice.call(prev.children).reverse().find(function (c) { return c.tagName === "UL" || c.tagName === "OL"; });
        if (!sub) { sub = document.createElement(li.parentNode.tagName); prev.appendChild(sub); }
        sub.appendChild(li);
        // 它自己的子列表跟着并进来
        Array.prototype.slice.call(li.children).forEach(function (c) { if ((c.tagName === "UL" || c.tagName === "OL") && c.tagName === sub.tagName) { while (c.firstChild) sub.appendChild(c.firstChild); c.remove(); } });
      } else liToPara(li);
    }
    function indent(d) {
      var b = curBlock();
      if (b && b.tagName === "LI") {
        flow.focus({ preventScroll: true });
        record();
        removeSpacers();
        var saved = saveSel(), items = selectedBlocks().filter(function (x) { return x.tagName === "LI"; });
        (d > 0 ? items : items.slice().reverse()).forEach(function (li) { indentLi(li, d); });
        loadSel(saved);
        paginate();
        changed();
        syncSoon();
        return;
      }
      flow.focus({ preventScroll: true });
      record();
      selectedBlocks().forEach(function (x) { var cur = parseFloat(x.style.marginLeft) || 0, nv = Math.max(0, cur + d * 28); x.style.marginLeft = nv ? nv + "px" : ""; if (!x.getAttribute("style")) x.removeAttribute("style"); });
      paginate();
      changed();
      syncSoon();
    }
    function clearFormat() {
      record();
      document.execCommand("removeFormat");
      var sel = window.getSelection();
      if (sel.rangeCount && !sel.isCollapsed) {
        var r = sel.getRangeAt(0);
        flow.querySelectorAll("span[style], b, i, u, s, sup, sub").forEach(function (x) { if (r.intersectsNode(x) && !x.querySelector("img")) { var rr = document.createRange(); rr.selectNodeContents(x); if (r.compareBoundaryPoints(Range.START_TO_START, rr) <= 0 && r.compareBoundaryPoints(Range.END_TO_END, rr) >= 0) { while (x.firstChild) x.parentNode.insertBefore(x.firstChild, x); x.remove(); } } });
      }
      paginate();
      changed();
      syncSoon();
    }
    // 插入一段 HTML：行内的插在光标处；有块的在光标处把当前段落劈开，块放中间（不用浏览器的 insertHTML：它会塞进一堆 span、把块嵌进段落里）
    function insertHTML(html) {
      flow.focus({ preventScroll: true });
      record();
      removeSpacers();
      var box = document.createElement("div");
      box.innerHTML = html;
      var sel = window.getSelection();
      if (!sel.rangeCount || !flow.contains(sel.anchorNode)) { var rr = document.createRange(); rr.selectNodeContents(flow); rr.collapse(false); sel.removeAllRanges(); sel.addRange(rr); }
      var r = sel.getRangeAt(0);
      if (!r.collapsed) r.deleteContents();
      var hasBlock = Array.prototype.some.call(box.childNodes, function (n) { return n.nodeType === 1 && /^(P|H[1-6]|UL|OL|TABLE|BLOCKQUOTE|PRE|HR|DIV)$/.test(n.tagName); });
      var blk = curBlock(), inCell = blk && (blk.tagName === "LI" || blk.closest("td"));
      var last = null;
      if (!hasBlock || !blk || inCell && !box.querySelector("table")) {
        // 行内插入（在列表项、表格里的块内容压成行内：段与段之间换行）
        var frag = document.createDocumentFragment();
        Array.prototype.slice.call(box.childNodes).forEach(function (n, i) {
          if (n.nodeType === 1 && /^(P|H[1-6]|BLOCKQUOTE|PRE|DIV)$/.test(n.tagName)) { if (frag.childNodes.length) frag.appendChild(document.createElement("br")); while (n.firstChild) frag.appendChild(n.firstChild); }
          else frag.appendChild(n);
        });
        last = frag.lastChild;
        // 空段落里的 <br> 占位去掉
        if (blk && blk.childNodes.length === 1 && blk.firstChild.nodeName === "BR") blk.removeChild(blk.firstChild), r.selectNodeContents(blk);
        r.insertNode(frag);
        if (last) { var after = document.createRange(); after.setStartAfter(last); after.collapse(true); sel.removeAllRanges(); sel.addRange(after); }
      } else {
        var top = blk;
        while (top.parentNode !== flow) top = top.parentNode;
        // 把光标所在的顶层块在光标处劈开
        var tail = document.createRange();
        tail.setStart(r.startContainer, r.startOffset);
        tail.setEndAfter(top.lastChild || top);
        var tailFrag = top.contains(r.startContainer) ? tail.extractContents() : document.createDocumentFragment();
        var second = top.cloneNode(false);
        second.appendChild(tailFrag);
        var ref = top;
        Array.prototype.slice.call(box.childNodes).forEach(function (n) {
          if (n.nodeType === 3 && !n.nodeValue.trim()) return;
          if (n.nodeType !== 1 || !/^(P|H[1-6]|UL|OL|TABLE|BLOCKQUOTE|PRE|HR|DIV)$/.test(n.tagName)) { var p = document.createElement("p"); p.appendChild(n); n = p; }
          flow.insertBefore(n, ref.nextSibling);
          ref = n;
          last = n;
        });
        var emptyEl = function (x) { return !x.textContent.replace(/[\s​]/g, "") && !x.querySelector("img, table, hr"); };
        if (!emptyEl(second)) flow.insertBefore(second, ref.nextSibling);
        if (emptyEl(top)) top.remove();
        if (!last) last = second;
        var nextBlock = second.isConnected ? second : last.nextElementSibling;
        if (last.tagName === "TABLE" || last.tagName === "HR") { if (!nextBlock || nextBlock.tagName === "TABLE" || nextBlock.tagName === "HR") { var np = el("p", null, "<br>"); flow.insertBefore(np, last.nextSibling); nextBlock = np; } placeCaret(nextBlock, 0); }
        else { var rc = document.createRange(); rc.selectNodeContents(last.tagName === "UL" || last.tagName === "OL" ? last.lastElementChild || last : last); rc.collapse(false); sel.removeAllRanges(); sel.addRange(rc); }
      }
      normalizeFlow();
      paginate();
      changed();
    }
    function insertPageBreak() {
      flow.focus({ preventScroll: true });
      record();
      var b = curBlock(), hr = document.createElement("hr");
      hr.className = "pg-break";
      hr.contentEditable = "false";
      var top = b;
      while (top && top.parentNode !== flow) top = top.parentNode;
      var np = el("p", null, "<br>");
      if (top) {
        // 光标在段落中间：拆开，后半段放到分页符后面
        var sel = window.getSelection();
        if (sel.rangeCount && top === b && !atEndOf(b)) {
          var r = sel.getRangeAt(0).cloneRange();
          r.setEndAfter(b.lastChild);
          var tail = r.extractContents(), nb = b.cloneNode(false);
          nb.appendChild(tail);
          if (!nb.textContent && !nb.querySelector("img")) nb.appendChild(document.createElement("br"));
          if (!b.textContent && !b.querySelector("img")) b.appendChild(document.createElement("br"));
          np = nb;
        }
        flow.insertBefore(hr, top.nextSibling);
        flow.insertBefore(np, hr.nextSibling);
      } else { flow.appendChild(hr); flow.appendChild(np); }
      placeCaret(np, 0);
      paginate();
      changed();
      scrollCaretIntoView();
    }
    function linkUI() {
      var sel = window.getSelection(), a = selEl() && selEl().closest("a");
      var box = el("div", "pg-linkpop"), inp = el("input", "ofc-in");
      inp.placeholder = "https://";
      inp.value = a ? a.getAttribute("href") : "";
      box.appendChild(el("div", "pg-linkpop-h", a ? "编辑链接" : "添加链接"));
      box.appendChild(inp);
      var row = el("div", "ofc-btnrow");
      if (a) row.appendChild(ui.button("移除链接", function () { pop.close(); restore(); cmd("unlink"); }));
      row.appendChild(ui.button("好", function () { go(); }, "ofc-default"));
      box.appendChild(row);
      var saved = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
      var restore = function () { if (saved) { flow.focus({ preventScroll: true }); sel.removeAllRanges(); sel.addRange(saved); } };
      var anchor = selEl() || flow, rect = saved ? saved.getBoundingClientRect() : anchor.getBoundingClientRect();
      var dummy = el("div", "pg-anchor");
      dummy.style.cssText = "position:fixed;left:" + rect.left + "px;top:" + rect.top + "px;width:" + Math.max(2, rect.width) + "px;height:" + Math.max(2, rect.height) + "px";
      document.body.appendChild(dummy);
      var pop = ui.popover(dummy, box, { onClose: function () { dummy.remove(); } });
      function go() {
        var url = inp.value.trim();
        pop.close();
        restore();
        if (!url) return;
        if (!/^(https?:|mailto:|#)/i.test(url)) url = (/@/.test(url) && !/\//.test(url) ? "mailto:" : "https://") + url;
        if (saved && saved.collapsed && !a) { insertHTML('<a href="' + esc(url) + '">' + esc(url) + "</a>"); return; }
        cmd("createLink", url);
      }
      inp.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); go(); } if (e.key === "Escape") { pop.close(); restore(); } });
      setTimeout(function () { inp.focus(); inp.select(); }, 30);
    }

    // ======== 表格 ========
    function insertTable(rows, cols) {
      flow.focus({ preventScroll: true });
      record();
      var t = document.createElement("table"), tb = document.createElement("tbody");
      t.appendChild(tb);
      for (var r = 0; r < rows; r++) { var tr = document.createElement("tr"); for (var c = 0; c < cols; c++) { var td = document.createElement("td"); td.innerHTML = "<p><br></p>"; tr.appendChild(td); } tb.appendChild(tr); }
      // 放在光标所在的块后面（在空段落里就替换它）；后面留一个空段落，好接着打字
      var b = curBlock(), top = b;
      while (top && top.parentNode !== flow) top = top.parentNode;
      var after = el("p", null, "<br>");
      if (top && top.tagName === "P" && !top.textContent.trim() && !top.querySelector("img")) { top.replaceWith(t); }
      else if (top) flow.insertBefore(t, top.nextSibling);
      else flow.appendChild(t);
      if (!t.nextElementSibling || t.nextElementSibling.tagName === "TABLE") flow.insertBefore(after, t.nextSibling);
      placeCaret(t.querySelector("td p"), 0);
      paginate();
      changed();
    }
    function tableCtx() { var c = selEl() && selEl().closest("td"); if (!c || !flow.contains(c)) return null; var tr = c.parentNode, tb = tr.parentNode, table = tb.closest("table"); return { cell: c, tr: tr, table: table, ri: Array.prototype.indexOf.call(tb.children, tr), ci: Array.prototype.indexOf.call(tr.children, c) }; }
    function tabCell(cell, back) {
      var cells = Array.prototype.slice.call(cell.closest("table").querySelectorAll("td")).filter(function (x) { return !x.closest(".pg-sp"); }), i = cells.indexOf(cell), next = cells[i + (back ? -1 : 1)];
      if (!next && !back) { tableOp("rowBelow"); next = cell.closest("tr").nextElementSibling && cell.closest("tr").nextElementSibling.firstElementChild; }
      if (next) { var r = document.createRange(); r.selectNodeContents(next); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
    }
    function tableOp(op) {
      var t = tableCtx();
      if (!t) return;
      record();
      removeSpacers();
      var rows = Array.prototype.filter.call(t.table.querySelectorAll("tr"), function (x) { return x.closest("table") === t.table; }), cols = t.tr.children.length;
      var newCell = function () { var td = document.createElement("td"); td.innerHTML = "<p><br></p>"; return td; };
      if (op === "rowAbove" || op === "rowBelow") { var nr = document.createElement("tr"); for (var i = 0; i < cols; i++) nr.appendChild(newCell()); t.tr.parentNode.insertBefore(nr, op === "rowAbove" ? t.tr : t.tr.nextSibling); }
      else if (op === "colLeft" || op === "colRight") { rows.forEach(function (tr) { var ref = tr.children[t.ci]; var c = newCell(); if (ref) tr.insertBefore(c, op === "colLeft" ? ref : ref.nextSibling); else tr.appendChild(c); }); var cg = t.table.querySelector("colgroup"); if (cg) cg.remove(); }
      else if (op === "delRow") { if (rows.length <= 1) t.table.remove(); else t.tr.remove(); }
      else if (op === "delCol") { if (cols <= 1) t.table.remove(); else { rows.forEach(function (tr) { if (tr.children[t.ci]) tr.children[t.ci].remove(); }); var cg2 = t.table.querySelector("colgroup"); if (cg2) cg2.remove(); } }
      else if (op === "delTable") t.table.remove();
      else if (op === "border") t.table.classList.toggle("plain");
      normalizeFlow();
      paginate();
      changed();
    }
    function cellFill(color) { var t = tableCtx(); if (!t) return; record(); var cells = selectedCells(t); cells.forEach(function (c) { c.style.backgroundColor = color || ""; if (!c.getAttribute("style")) c.removeAttribute("style"); }); changed(); }
    function selectedCells(t) { var sel = window.getSelection(), r = sel.rangeCount ? sel.getRangeAt(0) : null; var cells = Array.prototype.filter.call(t.table.querySelectorAll("td"), function (c) { return r && r.intersectsNode(c); }); return cells.length ? cells : [t.cell]; }

    // ======== 图片 ========
    var selectedImg = null;
    function insertImages(files) {
      return Promise.all(files.map(function (f) { return f.arrayBuffer().then(function (b) { return { bytes: new Uint8Array(b), type: f.type || PG.mimeOf(f.name || "") }; }); })).then(function (list) {
        var html = list.filter(function (x) { return /^image\//.test(x.type); }).map(function (x) { return imgHTML(x.bytes, x.type); });
        return Promise.all(html).then(function (hs) { if (hs.length) insertHTML(hs.join("")); });
      });
    }
    function imgHTML(bytes, type) {
      var url = images.add(bytes, type);
      return new Promise(function (res) {
        var im = new Image();
        im.onload = function () {
          var maxW = page.w - page.ml - page.mr, w = im.naturalWidth, h = im.naturalHeight;
          if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
          res('<img src="' + url + '" width="' + w + '" height="' + h + '">');
        };
        im.onerror = function () { res('<img src="' + url + '">'); };
        im.src = url;
      });
    }
    function insertImageFromSandbox() {
      // 用存储面板一样的方式挑一个文件：这里简单地列出 ~/Documents、~/Desktop、~/Downloads 里的图片
      var FS = window.SANDBOX, dirs = [O.DOCS, O.HOME + "/Desktop", O.HOME + "/Downloads", O.HOME + "/Pictures"], files = [];
      dirs.forEach(function (d) { try { FS.list(d).forEach(function (p) { if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(p)) files.push(p); }); } catch (e) { /* 没有这个文件夹 */ } });
      var items = files.slice(0, 40).map(function (p) { return it(O.tilde(p), "", function () { O.readBytes(p).then(function (b) { return imgHTML(b, PG.mimeOf(p)); }).then(insertHTML).catch(function (e) { doc.alert({ title: "没能插入图片", message: e.message, icon: "caution" }); }); }); });
      return items.length ? items : [it("（~/Documents、桌面、下载、图片里没有图片）", "", null, { disabled: true })];
    }
    function selectImg(im) {
      selectedImg = im;
      imgSel.hidden = !im;
      placeImgSel();
      syncSoon();
    }
    function placeImgSel() {
      if (!selectedImg || !selectedImg.isConnected) { imgSel.hidden = true; selectedImg = null; return; }
      var zr = zoomEl.getBoundingClientRect(), r = selectedImg.getBoundingClientRect();
      imgSel.style.left = (r.left - zr.left) / zoom + "px";
      imgSel.style.top = (r.top - zr.top) / zoom + "px";
      imgSel.style.width = r.width / zoom + "px";
      imgSel.style.height = r.height / zoom + "px";
    }
    // ⌘ 点链接：在新标签页打开（直接点只是放光标，同 Pages）
    flow.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("a[href]");
      if (a && (e.metaKey || e.ctrlKey)) { e.preventDefault(); window.open(a.getAttribute("href"), "_blank", "noopener"); }
    });
    flow.addEventListener("mousedown", function (e) {
      if (e.target.tagName === "IMG") { selectImg(e.target); var r = document.createRange(); r.selectNode(e.target); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); e.preventDefault(); flow.focus({ preventScroll: true }); }
      else if (selectedImg) selectImg(null);
    });
    imgSel.addEventListener("pointerdown", function (e) {
      if (!selectedImg || e.target.dataset.h !== "se") return;
      e.preventDefault();
      e.stopPropagation();
      record();
      var im = selectedImg, x0 = e.clientX, w0 = im.getBoundingClientRect().width / zoom, h0 = im.getBoundingClientRect().height / zoom, ratio = h0 / w0 || 1, maxW = page.w - page.ml - page.mr;
      imgSel.setPointerCapture(e.pointerId);
      var mv = function (ev) { var w = Math.max(16, Math.min(maxW, w0 + (ev.clientX - x0) / zoom)); im.setAttribute("width", Math.round(w)); im.setAttribute("height", Math.round(w * ratio)); placeImgSel(); };
      var up = function () { imgSel.removeEventListener("pointermove", mv); imgSel.removeEventListener("pointerup", up); paginate(); changed(); };
      imgSel.addEventListener("pointermove", mv);
      imgSel.addEventListener("pointerup", up);
    });

    // ======== 粘贴、拖放、拷贝 ========
    flow.addEventListener("paste", function (e) {
      var dt = e.clipboardData;
      if (!dt) return;
      e.preventDefault();
      var files = Array.prototype.filter.call(dt.files || [], function (f) { return /^image\//.test(f.type); });
      if (files.length) { insertImages(files); return; }
      var html = dt.getData("text/html"), text = dt.getData("text/plain");
      if (html && !e.shiftKey && !pastePlain) {
        var box = document.createElement("div");
        box.appendChild(PG.sanitize(html));
        // 网上的图片先取回来变成本地的（取不到就不要了，免得文稿里挂着外链）
        var jobs = [];
        box.querySelectorAll("img").forEach(function (im) {
          var src = im.getAttribute("src");
          if (/^blob:/.test(src) && images.get(src)) return;
          jobs.push(images.bytesOf(src).then(function (b) { im.src = images.add(b.bytes, b.mime); }, function () { im.remove(); }));
        });
        Promise.all(jobs).then(function () {
          // 只有一段时，按行内粘贴（不要多出一个空段）
          var h = box.children.length === 1 && box.firstElementChild.tagName === "P" ? box.firstElementChild.innerHTML : box.innerHTML;
          insertHTML(h);
        });
        return;
      }
      pastePlain = false;
      if (text) {
        var lines = text.replace(/\r\n?/g, "\n").split("\n");
        if (lines.length === 1) { flow.focus({ preventScroll: true }); record(); document.execCommand("insertText", false, text); paginate(); changed(); }
        else insertHTML(lines.map(function (l) { return "<p>" + (l ? esc(l) : "<br>") + "</p>"; }).join(""));
      }
    });
    var pastePlain = false;
    flow.addEventListener("drop", function (e) {
      var files = Array.prototype.filter.call(e.dataTransfer && e.dataTransfer.files || [], function (f) { return /^image\//.test(f.type); });
      if (!files.length) { e.preventDefault(); return; } // 不在文稿里拖文字（垫片会跟着跑）
      e.preventDefault();
      var pos = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
      if (pos) { var s = window.getSelection(); s.removeAllRanges(); s.addRange(pos); }
      insertImages(files);
    });
    flow.addEventListener("dragstart", function (e) { if (e.target.tagName !== "IMG") e.preventDefault(); });
    flow.addEventListener("copy", function (e) { putClipboard(e, false); });
    flow.addEventListener("cut", function (e) { putClipboard(e, true); });
    function putClipboard(e, cut) {
      var sel = window.getSelection();
      if (!sel.rangeCount || sel.isCollapsed) return;
      var frag = sel.getRangeAt(0).cloneContents(), box = document.createElement("div");
      box.appendChild(frag);
      box.querySelectorAll(".pg-sp").forEach(function (x) { x.remove(); });
      e.clipboardData.setData("text/html", box.innerHTML);
      e.clipboardData.setData("text/plain", sel.toString().replace(/​/g, ""));
      e.preventDefault();
      if (cut) { record(); document.execCommand("delete"); paginate(); changed(); }
    }

    // ======== 点页面空白处：光标放到最近的地方 ========
    canvas.addEventListener("mousedown", function (e) {
      if (flow.contains(e.target) || imgSel.contains(e.target)) return;
      e.preventDefault();
      var fr = flow.getBoundingClientRect(), x = Math.max(fr.left + 2, Math.min(fr.right - 2, e.clientX)), y = Math.max(fr.top + 2, Math.min(fr.bottom - 2, e.clientY));
      var r = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
      flow.focus({ preventScroll: true });
      if (r && flow.contains(r.startContainer)) { var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
    });

    // ======== 选区变了：检查器、目录高亮 ========
    var syncT = 0;
    function syncSoon() { clearTimeout(syncT); syncT = setTimeout(function () { syncInspector(); doc.refresh(); }, 80); }
    var onSel = function () { if (document.activeElement === flow || flow.contains(document.activeElement)) syncSoon(); };
    document.addEventListener("selectionchange", onSel);

    // ======== 缩放 ========
    function setZoom(z, fit) {
      z = Math.max(fit ? 0.25 : 0.5, Math.min(3, Math.round(z * 100) / 100)); // 适合宽度：手机上一页要缩到一半以下
      var center = (scroll.scrollTop + scroll.clientHeight / 2) / (zoom || 1);
      zoom = z;
      autoZoom = !!fit;
      localStorage.setItem("tsu-pages-zoom", fit ? "fit" : z);
      layoutCanvas();
      scroll.scrollTop = center * zoom - scroll.clientHeight / 2;
      placeImgSel();
      doc.refresh();
    }
    function fitWidth() { var w = scroll.clientWidth, avail = w - (w < 600 ? 20 : 48); setZoom(Math.max(w < 600 ? 0.25 : 0.5, Math.min(1.25, Math.floor(avail / page.w * 100) / 100)), true); }

    // ======== 字数 ========
    function stats() {
      var text = flow.innerText.replace(/​/g, ""), cjk = (text.match(CJK) || []).length, words = (text.replace(CJK, " ").match(/[A-Za-z0-9À-ɏ]+(?:['’\-.][A-Za-z0-9À-ɏ]+)*/g) || []).length;
      var chars = text.replace(/\s/g, "").length, paras = Array.prototype.filter.call(flow.querySelectorAll("p, h1, h2, h3, li, blockquote, pre"), function (b) { return b.textContent.trim(); }).length;
      return { words: cjk + words, chars: chars, charsSp: text.replace(/\n/g, "").length, paras: paras, pages: pages };
    }
    var countMode = +(localStorage.getItem("tsu-pages-countmode") || 0);
    function updateCount() {
      countEl.hidden = !showCount;
      if (!showCount) return;
      var s = stats(), labels = [s.words.toLocaleString() + " 字", s.chars.toLocaleString() + " 个字符", s.paras + " 个段落", s.pages + " 页"];
      countEl.textContent = labels[countMode % 4];
      countEl.title = "字数 " + s.words + " · 字符（不含空格）" + s.chars + " · 字符（含空格）" + s.charsSp + " · 段落 " + s.paras + " · 页数 " + s.pages + "\n点一下换一种统计";
    }
    countEl.addEventListener("click", function () { countMode = (countMode + 1) % 4; localStorage.setItem("tsu-pages-countmode", countMode); updateCount(); });

    // ======== 目录 ========
    function renderToc() {
      toc.textContent = "";
      var hs = flow.querySelectorAll("h1, h2, h3");
      if (!hs.length) { toc.appendChild(el("div", "pg-toc-empty", "用「标题 1–3」样式的段落会出现在这里")); return; }
      hs.forEach(function (h) {
        var lv = h.classList.contains("title") ? 0 : +h.tagName[1], row = el("div", "pg-toc-it lv" + lv, esc(h.textContent.replace(/​/g, "").trim() || "（空标题）"));
        row.addEventListener("click", function () { var zr = zoomEl.getBoundingClientRect(), r = h.getBoundingClientRect(); scroll.scrollTop += r.top - scroll.getBoundingClientRect().top - 40; placeCaret(h, 0); flow.focus({ preventScroll: true }); });
        toc.appendChild(row);
      });
    }
    function toggleToc(on) { showToc = on == null ? !showToc : on; side.hidden = !showToc; if (showToc) renderToc(); doc.refresh(); }

    // ======== 查找与替换 ========
    var matches = [], matchIdx = -1, hlOK = typeof Highlight !== "undefined" && window.CSS && CSS.highlights;
    function openFind(rep) { findEl.hidden = false; findEl.classList.toggle("rep", !!rep); var q = findEl.querySelector(".pg-fq"); var s = window.getSelection(); if (s.rangeCount && !s.isCollapsed && s.toString().length < 80) q.value = s.toString(); q.focus(); q.select(); runFind(); }
    function closeFind() { findEl.hidden = true; matches = []; if (hlOK) { CSS.highlights.delete("pg-find"); CSS.highlights.delete("pg-find-cur"); } flow.focus({ preventScroll: true }); }
    function runFind() {
      var q = findEl.querySelector(".pg-fq").value, cs = findEl.querySelector('[data-f="case"]').checked;
      matches = [];
      matchIdx = -1;
      if (q) {
        var needle = cs ? q : q.toLowerCase(), walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT);
        // 跨文字节点的匹配也要找到：把一个块里的文字连起来找
        units().forEach(function (u) {
          if (u.kind !== "text" && u.kind !== "row") return;
          var nodes = [], text = "";
          var tw = document.createTreeWalker(u.el, NodeFilter.SHOW_TEXT, { acceptNode: function (n) { return n.parentNode.closest(".pg-sp") || (u.li && n.parentNode.closest("ul, ol") !== u.el.parentNode) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; } });
          for (var n = tw.nextNode(); n; n = tw.nextNode()) { nodes.push({ node: n, start: text.length }); text += n.nodeValue; }
          var hay = cs ? text : text.toLowerCase(), i = hay.indexOf(needle);
          while (i >= 0 && matches.length < 5000) {
            var a = locate(nodes, i), b = locate(nodes, i + needle.length);
            if (a && b) { var r = document.createRange(); r.setStart(a.node, a.offset); r.setEnd(b.node, b.offset); matches.push(r); }
            i = hay.indexOf(needle, i + Math.max(1, needle.length));
          }
        });
      }
      if (hlOK) { CSS.highlights.set("pg-find", new Highlight(...matches)); CSS.highlights.delete("pg-find-cur"); }
      findEl.querySelector(".pg-fn").textContent = q ? (matches.length ? matches.length + " 个" : "没有找到") : "";
    }
    function locate(nodes, pos) {
      for (var i = nodes.length - 1; i >= 0; i--) if (pos >= nodes[i].start) return { node: nodes[i].node, offset: Math.min(nodes[i].node.nodeValue.length, pos - nodes[i].start) };
      return null;
    }
    function findNext(d) {
      if (!matches.length) runFind();
      if (!matches.length) return;
      if (matchIdx < 0) {
        var sel = window.getSelection(), here = sel.rangeCount ? sel.getRangeAt(0) : null;
        matchIdx = here ? matches.findIndex(function (m) { return m.compareBoundaryPoints(Range.START_TO_START, here) >= 0; }) : 0;
        if (matchIdx < 0) matchIdx = 0;
        if (d < 0) matchIdx = (matchIdx - 1 + matches.length) % matches.length;
      } else matchIdx = (matchIdx + d + matches.length) % matches.length;
      var m = matches[matchIdx];
      if (hlOK) CSS.highlights.set("pg-find-cur", new Highlight(m));
      var s = window.getSelection();
      s.removeAllRanges();
      s.addRange(m.cloneRange());
      var r = m.getBoundingClientRect(), sr = scroll.getBoundingClientRect();
      if (r.top < sr.top + 40 || r.bottom > sr.bottom - 40) scroll.scrollTop += r.top - sr.top - sr.height / 3;
      findEl.querySelector(".pg-fn").textContent = (matchIdx + 1) + " / " + matches.length;
    }
    function doReplace(all) {
      var rep = findEl.querySelector(".pg-fr").value;
      if (!matches.length) runFind();
      if (!matches.length) return;
      record();
      var list = all ? matches.slice().reverse() : matchIdx >= 0 ? [matches[matchIdx]] : [];
      if (!list.length) { findNext(1); return; }
      removeSpacers();
      list.forEach(function (m) { try { m.deleteContents(); if (rep) m.insertNode(document.createTextNode(rep)); } catch (e) { /* 范围失效了 */ } });
      flow.normalize();
      paginate();
      changed();
      var n = list.length;
      runFind();
      if (all) O.toast(doc, "替换了 " + n + " 处"); else findNext(1);
    }
    findEl.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); closeFind(); }
      if (e.key === "Enter") { e.preventDefault(); if (e.target.classList.contains("pg-fr")) doReplace(false); else findNext(e.shiftKey ? -1 : 1); }
    });
    findEl.querySelector(".pg-fq").addEventListener("input", runFind);
    findEl.addEventListener("click", function (e) {
      var f = e.target.dataset && e.target.dataset.f;
      if (f === "next") findNext(1); else if (f === "prev") findNext(-1); else if (f === "rep") doReplace(false); else if (f === "all") doReplace(true); else if (f === "done") closeFind(); else if (f === "case") runFind();
    });

    // ======== 检查器 ========
    var insp = el("div", "pg-insp"), tabs = el("div", "ofc-tabs"), body = el("div", "ofc-insp-body"), C = {};
    insp.appendChild(tabs);
    insp.appendChild(body);
    tabs.addEventListener("mousedown", function (e) { e.preventDefault(); });
    tabs.addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) { inspTab = b.dataset.t; buildInsp(); } });
    function showInsp(mode) {
      if (doc.inspectorOn() && inspMode === mode) { doc.showInspector(false); return; }
      inspMode = mode;
      inspTab = mode === "doc" ? "doc" : inspTab === "doc" ? "style" : inspTab;
      buildInsp();
      doc.showInspector(true);
    }
    function buildInsp() {
      var list = inspMode === "doc" ? [["doc", "文稿"], ["info", "信息"]] : [["style", "样式"], ["layout", "布局"]].concat(tableCtx() ? [["table", "表格"]] : []).concat(selectedImg ? [["image", "图像"]] : []);
      if (!list.some(function (x) { return x[0] === inspTab; })) inspTab = list[0][0];
      tabs.innerHTML = list.map(function (x) { return '<button type="button" data-t="' + x[0] + '" class="' + (x[0] === inspTab ? "on" : "") + '">' + x[1] + "</button>"; }).join("");
      body.textContent = "";
      C = {};
      var Sx = ui.section, R = ui.row;
      if (inspTab === "style") {
        var s1 = Sx("段落样式");
        C.pstyle = ui.select(PG.PSTYLES.map(function (x) { return { v: x.id, label: x.name }; }), "body", function (v) { setBlockStyle(v); });
        C.pstyle.classList.add("pg-pstyle");
        s1.appendChild(C.pstyle);
        body.appendChild(s1);
        var s2 = Sx("字体");
        C.font = ui.select(FONTS.map(function (f) { return { v: f[0], label: f[1] }; }), "", function (v) { if (v) cmd("fontName", v); else cmd("fontName", "-apple-system"); });
        s2.appendChild(C.font);
        C.size = ui.stepper(11, { min: 5, max: 144, step: 1, digits: 1, unit: " 磅", width: 88 }, function (v) { setFontSize(v); });
        C.bius = ui.seg([{ v: "bold", label: "B", tip: "粗体 ⌘B", style: "font-weight:700" }, { v: "italic", label: "I", tip: "斜体 ⌘I", style: "font-style:italic;font-family:Georgia,serif" }, { v: "underline", label: "U", tip: "下划线 ⌘U", style: "text-decoration:underline" }, { v: "strikeThrough", label: "S", tip: "删除线", style: "text-decoration:line-through" }], {}, function (v) { cmd(v); }, { multi: true });
        s2.appendChild(R(null, C.bius, C.size));
        C.color = ui.color(null, function (v) { cmd("foreColor", v || "#1d1d1f"); }, { auto: "自动" });
        C.hl = ui.color(null, function (v) { cmd("hiliteColor", v || "transparent"); }, { none: "无" });
        s2.appendChild(R("文字颜色", C.color));
        s2.appendChild(R("高亮", C.hl));
        C.sup = ui.seg([{ v: "superscript", label: "x²", tip: "上标" }, { v: "subscript", label: "x₂", tip: "下标" }], {}, function (v) { cmd(v); }, { multi: true });
        s2.appendChild(R("基线", C.sup));
        body.appendChild(s2);
        var s3 = Sx("对齐");
        var aIcon = function (lines) { return '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">' + lines + "</svg>"; };
        C.align = ui.seg([
          { v: "left", icon: aIcon('<path d="M3 5h14M3 9h9M3 13h14M3 17h9"/>'), tip: "靠左" }, { v: "center", icon: aIcon('<path d="M3 5h14M5.5 9h9M3 13h14M5.5 17h9"/>'), tip: "居中" },
          { v: "right", icon: aIcon('<path d="M3 5h14M8 9h9M3 13h14M8 17h9"/>'), tip: "靠右" }, { v: "justify", icon: aIcon('<path d="M3 5h14M3 9h14M3 13h14M3 17h14"/>'), tip: "两端对齐" },
        ], "left", function (v) { setBlockProp("text-align", v === "left" ? null : v); });
        s3.appendChild(C.align);
        body.appendChild(s3);
        var s4 = Sx("列表");
        C.list = ui.select([{ v: "none", label: "无" }, { v: "ul", label: "• 项目符号" }, { v: "ol", label: "1. 编号" }], "none", function (v) { setList(v); });
        var ind = el("div", "ofc-btnrow");
        ind.appendChild(ui.button("减少缩进", function () { indent(-1); }));
        ind.appendChild(ui.button("增加缩进", function () { indent(1); }));
        s4.appendChild(C.list);
        s4.appendChild(ind);
        body.appendChild(s4);
      } else if (inspTab === "layout") {
        var l1 = Sx("间距");
        C.line = ui.select([{ v: "", label: "跟随样式" }, { v: "1.25", label: "单倍行距" }, { v: "1.45", label: "1.15 倍" }, { v: "1.9", label: "1.5 倍" }, { v: "2.5", label: "2 倍" }, { v: "3", label: "2.5 倍" }], "", function (v) { setBlockProp("line-height", v || null); });
        l1.appendChild(R("行距", C.line));
        C.before = ui.stepper(0, { min: 0, max: 200, step: 2, digits: 1, unit: " 磅", width: 90 }, function (v) { setBlockProp("margin-top", v + "pt"); });
        C.after = ui.stepper(0, { min: 0, max: 200, step: 2, digits: 1, unit: " 磅", width: 90 }, function (v) { setBlockProp("margin-bottom", v + "pt"); });
        l1.appendChild(R("段前", C.before));
        l1.appendChild(R("段后", C.after));
        body.appendChild(l1);
        var l2 = Sx("缩进");
        C.first = ui.check("首行缩进两个字", false, function (v) { setBlockProp("text-indent", v ? "2em" : null); });
        l2.appendChild(C.first);
        C.left = ui.stepper(0, { min: 0, max: 400, step: 7, digits: 0, unit: " 磅", width: 90 }, function (v) { setBlockProp("margin-left", v ? Math.round(v * 4 / 3) + "px" : null); });
        l2.appendChild(R("左缩进", C.left));
        body.appendChild(l2);
        var l3 = Sx("分页");
        var pb = el("div", "ofc-btnrow");
        pb.appendChild(ui.button("插入分页符 ⌘↩", function () { insertPageBreak(); }));
        l3.appendChild(pb);
        body.appendChild(l3);
      } else if (inspTab === "table") {
        var t1 = Sx("行与列");
        var r1 = el("div", "ofc-btnrow");
        [["rowAbove", "上方插入行"], ["rowBelow", "下方插入行"], ["colLeft", "左侧插入列"], ["colRight", "右侧插入列"], ["delRow", "删除行"], ["delCol", "删除列"]].forEach(function (x) { r1.appendChild(ui.button(x[1], function () { tableOp(x[0]); })); });
        t1.appendChild(r1);
        body.appendChild(t1);
        var t2 = Sx("外观");
        C.cellFill = ui.color(null, function (v) { cellFill(v); }, { none: "无填充" });
        t2.appendChild(R("格子填充", C.cellFill));
        C.tborder = ui.check("显示边框", true, function () { tableOp("border"); });
        t2.appendChild(C.tborder);
        var r2 = el("div", "ofc-btnrow");
        r2.appendChild(ui.button("删除表格", function () { tableOp("delTable"); }));
        t2.appendChild(r2);
        body.appendChild(t2);
      } else if (inspTab === "image") {
        var i1 = Sx("大小");
        C.iw = ui.stepper(0, { min: 16, max: 2000, step: 10, digits: 0, unit: " 像素", width: 100 }, function (v) { if (!selectedImg) return; record(); var ratio = (+selectedImg.getAttribute("height") || selectedImg.naturalHeight) / (+selectedImg.getAttribute("width") || selectedImg.naturalWidth) || 1; selectedImg.setAttribute("width", Math.round(v)); if (C.keep.querySelector("input").checked) selectedImg.setAttribute("height", Math.round(v * ratio)); paginate(); placeImgSel(); changed(); });
        C.ih = ui.stepper(0, { min: 16, max: 2000, step: 10, digits: 0, unit: " 像素", width: 100 }, function (v) { if (!selectedImg) return; record(); var ratio = (+selectedImg.getAttribute("width") || selectedImg.naturalWidth) / (+selectedImg.getAttribute("height") || selectedImg.naturalHeight) || 1; selectedImg.setAttribute("height", Math.round(v)); if (C.keep.querySelector("input").checked) selectedImg.setAttribute("width", Math.round(v * ratio)); paginate(); placeImgSel(); changed(); });
        C.keep = ui.check("保持比例", true, function () {});
        i1.appendChild(R("宽度", C.iw));
        i1.appendChild(R("高度", C.ih));
        i1.appendChild(C.keep);
        var ir = el("div", "ofc-btnrow");
        ir.appendChild(ui.button("原始大小", function () { if (!selectedImg) return; record(); var maxW = page.w - page.ml - page.mr, w = selectedImg.naturalWidth, h = selectedImg.naturalHeight; if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; } selectedImg.setAttribute("width", w); selectedImg.setAttribute("height", h); paginate(); placeImgSel(); changed(); syncSoon(); }));
        ir.appendChild(ui.button("删除图片", function () { if (!selectedImg) return; record(); selectedImg.remove(); selectImg(null); paginate(); changed(); }));
        i1.appendChild(ir);
        body.appendChild(i1);
        var i2 = Sx("位置");
        i2.appendChild(el("div", "ofc-note", "图片跟着文字走（嵌入在段落里）；用「样式」里的对齐让它居中或靠右。"));
        body.appendChild(i2);
      } else if (inspTab === "doc") {
        var d1 = Sx("纸张");
        C.paper = ui.select(Object.keys(PG.SIZES).map(function (k) { return { v: k, label: PG.SIZES[k][2] + "（" + Math.round(PG.SIZES[k][0] / PG.PX_PER_CM * 10) / 10 + " × " + Math.round(PG.SIZES[k][1] / PG.PX_PER_CM * 10) / 10 + " 厘米）" }; }).concat(page.size === "custom" ? [{ v: "custom", label: "自定（" + Math.round(page.w / PG.PX_PER_CM * 10) / 10 + " × " + Math.round(page.h / PG.PX_PER_CM * 10) / 10 + " 厘米）" }] : []), page.size, function (v) { var s = PG.SIZES[v]; if (!s) return; setPage({ size: v, w: page.orient === "landscape" ? s[1] : s[0], h: page.orient === "landscape" ? s[0] : s[1] }); });
        d1.appendChild(C.paper);
        C.orient = ui.seg([{ v: "portrait", label: "纵向" }, { v: "landscape", label: "横向" }], page.orient, function (v) { if (v === page.orient) return; setPage({ orient: v, w: page.h, h: page.w }); });
        d1.appendChild(R("方向", C.orient));
        body.appendChild(d1);
        var d2 = Sx("页边距");
        var cm = function (px) { return Math.round(px / PG.PX_PER_CM * 100) / 100; }, px = function (c) { return Math.round(c * PG.PX_PER_CM); };
        [["mt", "上"], ["mb", "下"], ["ml", "左"], ["mr", "右"]].forEach(function (x) {
          C[x[0]] = ui.stepper(cm(page[x[0]]), { min: 0, max: 10, step: 0.1, digits: 2, unit: " 厘米", width: 100 }, function (v) { var p = {}; p[x[0]] = px(v); setPage(p); });
          d2.appendChild(R(x[1], C[x[0]]));
        });
        body.appendChild(d2);
        var d3 = Sx("页眉与页脚");
        C.pnum = ui.check("在页脚显示页码", pageNumbers, function (v) { pageNumbers = v; renderPages(); changed(true); });
        d3.appendChild(C.pnum);
        body.appendChild(d3);
      } else if (inspTab === "info") {
        var n1 = Sx("文稿信息");
        var ti = el("input", "ofc-in"), au = el("input", "ofc-in");
        ti.value = props.title || "";
        au.value = props.author || "";
        [ti, au].forEach(function (x) { x.spellcheck = false; x.addEventListener("keydown", function (e) { e.stopPropagation(); }); });
        ti.addEventListener("change", function () { props.title = ti.value; changed(true); });
        au.addEventListener("change", function () { props.author = au.value; changed(true); });
        n1.appendChild(R("标题", ti));
        n1.appendChild(R("作者", au));
        body.appendChild(n1);
        var n2 = Sx("统计");
        var s = stats();
        n2.appendChild(el("div", "pg-stats", "<div><b>" + s.words.toLocaleString() + "</b><span>字</span></div><div><b>" + s.chars.toLocaleString() + "</b><span>字符（不含空格）</span></div><div><b>" + s.charsSp.toLocaleString() + "</b><span>字符（含空格）</span></div><div><b>" + s.paras + "</b><span>段落</span></div><div><b>" + s.pages + "</b><span>页</span></div>"));
        body.appendChild(n2);
      }
      syncInspector(true);
    }
    function setPage(p) { Object.assign(page, p); if (p.w || p.h) page.size = PG.matchSize(page.w, page.h); applyPage(); changed(true); buildInsp(); }
    function setList(v) {
      var b = curBlock(), l = b && b.tagName === "LI" ? b.parentNode.tagName : null;
      if (v === "ul" && l !== "UL") toggleList("ul");
      else if (v === "ol" && l !== "OL") toggleList("ol");
      else if (v === "none" && l) toggleList(l.toLowerCase());
    }
    function syncInspector(force) {
      if (!doc.inspectorOn() && !force) return;
      var b = curBlock(), e0 = selEl();
      var want = inspMode === "format" && ((tableCtx() ? 1 : 0) !== (tabs.querySelector('[data-t="table"]') ? 1 : 0) || (selectedImg ? 1 : 0) !== (tabs.querySelector('[data-t="image"]') ? 1 : 0));
      if (want && !force) { buildInsp(); return; }
      if (C.pstyle) C.pstyle.set(b ? (b.tagName === "LI" ? "body" : PG.styleOfBlock(b)) : "body");
      if (C.font && e0) {
        var cs = getComputedStyle(e0), fam = cs.fontFamily.split(",")[0].replace(/["']/g, "").trim();
        var known = FONTS.some(function (f) { return f[0] === fam; });
        C.font.set(known ? fam : "");
        C.size.set(Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2);
        var st = {};
        ["bold", "italic", "underline", "strikeThrough"].forEach(function (k) { try { st[k] = document.queryCommandState(k); } catch (x) { st[k] = false; } });
        C.bius.set(st);
        var sup = {};
        ["superscript", "subscript"].forEach(function (k) { try { sup[k] = document.queryCommandState(k); } catch (x) { sup[k] = false; } });
        C.sup.set(sup);
        C.color.set(null);
        var bc = b ? getComputedStyle(b).textAlign : "left";
        C.align.set(bc === "start" ? "left" : bc === "end" ? "right" : bc);
        C.list.set(b && b.closest("ul") ? "ul" : b && b.closest("ol") ? "ol" : "none");
      }
      if (C.line && b) {
        var lh = b.style.lineHeight;
        C.line.set(lh || "");
        var bs = getComputedStyle(b);
        C.before.set(Math.round(parseFloat(bs.marginTop) * 0.75 * 10) / 10);
        C.after.set(Math.round(parseFloat(bs.marginBottom) * 0.75 * 10) / 10);
        C.first.set(!!b.style.textIndent && parseFloat(b.style.textIndent) > 0);
        C.left.set(Math.round((parseFloat(b.style.marginLeft) || 0) * 0.75));
      }
      if (C.cellFill) { var t = tableCtx(); if (t) { C.cellFill.set(PG.cssColor(t.cell.style.backgroundColor)); C.tborder.set(!t.table.classList.contains("plain")); } }
      if (C.iw && selectedImg) { C.iw.set(+selectedImg.getAttribute("width") || selectedImg.naturalWidth); C.ih.set(+selectedImg.getAttribute("height") || selectedImg.naturalHeight); }
    }

    // ======== 菜单、工具栏 ========
    function zoomItems() {
      return [0.5, 0.75, 1, 1.25, 1.5, 2].map(function (z) { return it(Math.round(z * 100) + "%", "", function () { setZoom(z); }, { checked: Math.abs(zoom - z) < 0.001 }); })
        .concat([SEP, it("适合宽度", "", fitWidth, { checked: autoZoom }), it("放大", "⌘+", function () { setZoom(zoom + 0.1); }), it("缩小", "⌘−", function () { setZoom(zoom - 0.1); })]);
    }
    function viewItems() {
      return [
        it("目录", "", function () { toggleToc(); }, { checked: showToc }),
        it("显示字数", "", function () { showCount = !showCount; localStorage.setItem("tsu-pages-count", showCount ? "on" : "off"); updateCount(); }, { checked: showCount }),
        it("检查拼写", "", function () { var on = flow.spellcheck !== true; flow.spellcheck = on; localStorage.setItem("tsu-pages-spell", on ? "on" : "off"); doc.refresh(); }, { checked: flow.spellcheck === true }),
        SEP,
        it("实际大小", "⌘0", function () { setZoom(1); }), it("适合宽度", "", fitWidth), it("放大", "⌘+", function () { setZoom(zoom + 0.1); }), it("缩小", "⌘−", function () { setZoom(zoom - 0.1); }),
        SEP,
        it(doc.inspectorOn() && inspMode === "format" ? "隐藏格式检查器" : "显示格式检查器", "⌥⌘I", function () { showInsp("format"); }),
        it(doc.inspectorOn() && inspMode === "doc" ? "隐藏文稿设置" : "显示文稿设置", "", function () { showInsp("doc"); }),
      ];
    }
    function insertItems() {
      return [
        it("分页符", "⌘↩", insertPageBreak),
        it("链接…", "⌘K", linkUI),
        it("表格", "", null, { items: [[2, 2], [3, 3], [4, 3], [5, 4], [6, 5]].map(function (x) { return it(x[0] + " 行 × " + x[1] + " 列", "", function () { insertTable(x[0], x[1]); }); }) }),
        it("图片", "", null, { items: [it("从电脑选取…", "", function () { O.upload("image/*").then(function (f) { if (f) imgHTML(f.bytes, PG.mimeOf(f.name)).then(insertHTML); }); }), SEP].concat(insertImageFromSandbox()) }),
        it("水平线", "", function () { insertHTML("<hr><p><br></p>"); }),
        SEP,
        it("日期", "", function () { var d = new Date(); insertHTML(esc(d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日")); }),
        it("时间", "", function () { var d = new Date(); insertHTML(esc(("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2))); }),
      ];
    }
    function tableItems() {
      var t = tableCtx();
      return [
        it("在上方插入行", "", function () { tableOp("rowAbove"); }, { disabled: !t }), it("在下方插入行", "", function () { tableOp("rowBelow"); }, { disabled: !t }),
        it("在左侧插入列", "", function () { tableOp("colLeft"); }, { disabled: !t }), it("在右侧插入列", "", function () { tableOp("colRight"); }, { disabled: !t }),
        SEP,
        it("删除行", "", function () { tableOp("delRow"); }, { disabled: !t }), it("删除列", "", function () { tableOp("delCol"); }, { disabled: !t }), it("删除表格", "", function () { tableOp("delTable"); }, { disabled: !t }),
      ];
    }
    flow.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      var inTable = e.target.closest && e.target.closest("td");
      var items = [
        it("剪切", "⌘X", function () { document.execCommand("cut"); }), it("拷贝", "⌘C", function () { document.execCommand("copy"); }), it("粘贴", "⌘V", function () { pasteMenu(false); }), it("粘贴并匹配样式", "⌥⇧⌘V", function () { pasteMenu(true); }),
        SEP,
        it("链接…", "⌘K", linkUI),
      ];
      if (inTable) items = items.concat([SEP], tableItems());
      if (e.target.tagName === "IMG") items = items.concat([SEP, it("删除图片", "", function () { record(); e.target.remove(); selectImg(null); paginate(); changed(); })]);
      ui.menuAt(items, e.clientX, e.clientY);
    });
    function pasteMenu(plain) {
      if (!navigator.clipboard) return;
      flow.focus({ preventScroll: true });
      var go = function (text) { if (text == null) return; record(); var lines = text.replace(/\r\n?/g, "\n").split("\n"); if (lines.length === 1) document.execCommand("insertText", false, text); else document.execCommand("insertHTML", false, lines.map(function (l) { return "<p>" + (l ? esc(l) : "<br>") + "</p>"; }).join("")); normalizeFlow(); paginate(); changed(); };
      if (plain || !navigator.clipboard.read) return navigator.clipboard.readText().then(go, function () {});
      navigator.clipboard.read().then(function (items) {
        var item = items[0];
        if (!item) return;
        if (item.types.indexOf("text/html") >= 0) return item.getType("text/html").then(function (b) { return b.text(); }).then(function (h) { var box = document.createElement("div"); box.appendChild(PG.sanitize(h)); insertHTML(box.innerHTML); });
        var img = item.types.find(function (t) { return /^image\//.test(t); });
        if (img) return item.getType(img).then(function (b) { return b.arrayBuffer(); }).then(function (a) { return imgHTML(new Uint8Array(a), img); }).then(insertHTML);
        return item.getType("text/plain").then(function (b) { return b.text(); }).then(go);
      }, function () { navigator.clipboard.readText().then(go, function () {}); });
    }

    var view = {
      el: root,
      inspector: insp,
      toolbar: [
        { id: "view", label: "显示", icon: "sidebar", menu: viewItems },
        { id: "zoom", label: "缩放", text: function () { return Math.round(zoom * 100) + "%"; }, menu: zoomItems },
        { id: "addpage", label: "添加页面", icon: "addPage", run: function () { insertPageBreak(); }, tip: "在光标处分页（⌘↩）" },
        "sep",
        { id: "insert", label: "插入", icon: "plus", menu: insertItems },
        { id: "table", label: "表格", icon: "table", menu: function () { return [[2, 2], [3, 3], [4, 3], [5, 4], [6, 5]].map(function (x) { return it(x[0] + " 行 × " + x[1] + " 列", "", function () { insertTable(x[0], x[1]); }); }).concat(tableCtx() ? [SEP].concat(tableItems()) : []); } },
        { id: "media", label: "媒体", icon: "media", menu: function () { return [it("从电脑选取图片…", "", function () { O.upload("image/*").then(function (f) { if (f) imgHTML(f.bytes, PG.mimeOf(f.name)).then(insertHTML); }); }), SEP].concat(insertImageFromSandbox()); } },
        { id: "link", label: "链接", icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M10.5 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>', run: linkUI },
        "flex",
        { id: "format", label: "格式", icon: "brush", run: function () { showInsp("format"); }, on: function () { return doc.inspectorOn() && inspMode === "format"; } },
        { id: "doc", label: "文稿", icon: "doc", run: function () { showInsp("doc"); }, on: function () { return doc.inspectorOn() && inspMode === "doc"; } },
      ],
      menus: function () {
        return [
          { title: "编辑", items: [
            it("撤销", "⌘Z", undo, { disabled: hist.idx <= 0 && !hist.timer }), it("重做", "⇧⌘Z", redo, { disabled: hist.idx >= hist.stack.length - 1 }),
            SEP,
            it("剪切", "⌘X", function () { flow.focus(); document.execCommand("cut"); }), it("拷贝", "⌘C", function () { flow.focus(); document.execCommand("copy"); }), it("粘贴", "⌘V", function () { pasteMenu(false); }), it("粘贴并匹配样式", "⌥⇧⌘V", function () { pasteMenu(true); }),
            it("全选", "⌘A", function () { flow.focus(); document.execCommand("selectAll"); }),
            SEP,
            it("查找…", "⌘F", function () { openFind(false); }), it("查找与替换…", "⌥⌘F", function () { openFind(true); }),
          ] },
          { title: "插入", items: insertItems() },
          { title: "格式", items: [
            it("字体", "", null, { items: [it("粗体", "⌘B", function () { cmd("bold"); }), it("斜体", "⌘I", function () { cmd("italic"); }), it("下划线", "⌘U", function () { cmd("underline"); }), it("删除线", "", function () { cmd("strikeThrough"); }), SEP, it("更大", "⇧⌘.", function () { stepSize(1); }), it("更小", "⇧⌘,", function () { stepSize(-1); }), SEP, it("上标", "", function () { cmd("superscript"); }), it("下标", "", function () { cmd("subscript"); })] }),
            it("段落样式", "", null, { items: PG.PSTYLES.map(function (x, i) { return it(x.name, ["⌥⌘4", "⌥⌘5", "⌥⌘1", "⌥⌘2", "⌥⌘3", "⌥⌘0", "⌥⌘6", "", ""][i] || "", function () { setBlockStyle(x.id); }); }) }),
            it("对齐", "", null, { items: [it("靠左", "", function () { setBlockProp("text-align", null); }), it("居中", "", function () { setBlockProp("text-align", "center"); }), it("靠右", "", function () { setBlockProp("text-align", "right"); }), it("两端对齐", "", function () { setBlockProp("text-align", "justify"); })] }),
            it("列表", "", null, { items: [it("项目符号", "⇧⌘8", function () { toggleList("ul"); }), it("编号", "⇧⌘7", function () { toggleList("ol"); }), SEP, it("增加缩进", "⌘]", function () { indent(1); }), it("减少缩进", "⌘[", function () { indent(-1); })] }),
            it("首行缩进两个字", "", function () { var b = curBlock(); setBlockProp("text-indent", b && parseFloat(b.style.textIndent) > 0 ? null : "2em"); }),
            SEP,
            it("清除格式", "", clearFormat),
            it("显示检查器", "⌥⌘I", function () { showInsp("format"); }),
          ] },
          { title: "表格", items: [it("插入表格", "", null, { items: [[2, 2], [3, 3], [4, 3], [5, 4]].map(function (x) { return it(x[0] + " 行 × " + x[1] + " 列", "", function () { insertTable(x[0], x[1]); }); }) }), SEP].concat(tableItems()) },
          { title: "显示", items: viewItems() },
        ];
      },
      serialize: function (fmt) {
        if (hist.timer) record();
        var clone = flow.cloneNode(true);
        clone.querySelectorAll(".pg-sp").forEach(function (x) { x.remove(); });
        clone.querySelectorAll("hr.pg-break").forEach(function (x) { x.removeAttribute("style"); x.removeAttribute("contenteditable"); });
        clone.normalize();
        if (fmt === "docx") return PG.writeDocx({ flow: clone, page: page, styles: docStyles, pageNumbers: pageNumbers, props: props, images: images });
        if (fmt === "md") return mdWithImages(clone);
        if (fmt === "txt") return PG.htmlToText(clone);
        if (fmt === "html") return htmlDoc(clone, false);
        throw new Error("不支持的格式：" + fmt);
      },
      replace: function (st) {
        images.dispose();
        images = st.images || new PG.Images();
        page = Object.assign(PG.defaultPage(), st.page || {});
        docStyles = st.styles || {};
        pageNumbers = !!st.pageNumbers;
        props = Object.assign({ title: "", author: "" }, st.props || {});
        flow.innerHTML = st.html || "<p><br></p>";
        normalizeFlow();
        hist = { stack: [], idx: -1, timer: 0 };
        applyPage();
        record();
        updateCount();
        if (showToc) renderToc();
        buildInsp();
      },
      printable: function () { return printPages(); },
      focus: function () { flow.focus({ preventScroll: true }); },
      resize: function () { layoutCanvas(); placeImgSel(); },
      mounted: function () { applyPage(); record(); updateCount(); var s = window.getSelection(); if (flow.firstElementChild) placeCaret(flow.firstElementChild, 0); },
      destroy: function () { document.removeEventListener("selectionchange", onSel); images.dispose(); ro.disconnect(); },
    };
    // Markdown：图片存成旁边「<名字>.assets/」里的文件（agent 读 md 时能看到图）
    function mdWithImages(clone) {
      var imgs = Array.prototype.slice.call(clone.querySelectorAll("img"));
      if (!imgs.length || !doc.path) return PG.htmlToMd(clone, function (im) { return im.getAttribute("data-path") || "image.png"; });
      var dir = O.dirOf(doc.path), sub = O.stemOf(doc.path) + ".assets", n = 0, names = new Map();
      return Promise.all(imgs.map(function (im) {
        var src = im.getAttribute("src");
        if (im.getAttribute("data-path")) { names.set(im, im.getAttribute("data-path")); return null; }
        return images.bytesOf(src).then(function (b) {
          var ext = /png/.test(b.mime) ? "png" : /jpe?g/.test(b.mime) ? "jpg" : /gif/.test(b.mime) ? "gif" : /webp/.test(b.mime) ? "webp" : "png", name = "image" + ++n + "." + ext;
          names.set(im, encodeURI(sub) + "/" + name);
          im.setAttribute("data-path", sub + "/" + name);
          return O.writeFile(dir + "/" + sub + "/" + name, b.bytes);
        }).catch(function () { names.set(im, src); });
      })).then(function () { return PG.htmlToMd(clone, function (im) { return names.get(im) || im.getAttribute("src"); }); });
    }
    // 整份 HTML（导出网页 / 打印）：图片换成 data: 地址，页面大小、页边距、段落样式都写进 CSS
    function htmlDoc(clone, print) {
      var imgs = Array.prototype.slice.call(clone.querySelectorAll("img"));
      return Promise.all(imgs.map(function (im) { return images.bytesOf(im.getAttribute("src")).then(function (b) { im.src = "data:" + b.mime + ";base64," + PG.b64(b.bytes); }, function () {}); })).then(function () {
        var st = PG.mergedStyles(docStyles), css = styleCSS(st, "body");
        var pageCss = "@page{size:" + (page.w / 96 * 25.4).toFixed(1) + "mm " + (page.h / 96 * 25.4).toFixed(1) + "mm;margin:" + [page.mt, page.mr, page.mb, page.ml].map(function (x) { return (x / 96 * 25.4).toFixed(1) + "mm"; }).join(" ") + (pageNumbers ? ";@bottom-center{content:counter(page);font:9pt -apple-system,'PingFang SC',sans-serif;color:#888}" : "") + "}";
        var base = "body{margin:0;color:#1d1d1f;font-family:-apple-system,'PingFang SC','Helvetica Neue',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
          "hr.pg-break{break-after:page;border:0;height:0;margin:0}hr:not(.pg-break){border:0;border-top:1px solid #bbb;margin:12pt 0}table{border-collapse:collapse;width:100%;margin:6pt 0}td{border:1px solid #a0a0a0;padding:4px 7px;vertical-align:top}td>p{margin:0}table.plain td{border-color:transparent}" +
          "img{max-width:100%;height:auto;vertical-align:bottom}a{color:#0b62d6}blockquote{border-left:3px solid #d0d0d0;padding-left:12px;margin-left:0}pre{white-space:pre-wrap;background:#f5f5f7;padding:6px 8px;border-radius:4px}li{margin:2pt 0}p,li,h1,h2,h3,blockquote{white-space:pre-wrap}";
        var head = '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(props.title || doc.label()) + "</title>";
        var html = clone.innerHTML;
        if (print) return { html: html, css: pageCss + base + css };
        return '<!DOCTYPE html>\n<html lang="zh-CN"><head>' + head + "<style>" + pageCss + base + css + "body{max-width:" + (page.w - page.ml - page.mr) + "px;margin:40px auto;padding:0 20px}</style></head><body>\n" + html + "\n</body></html>\n";
      });
    }
    // 打印 / 导出 PDF：照编辑器的分页（垫片的位置）切成一页一页——每页一张纸（页边距当内边距），正文用编辑器同一套 CSS，页码印在页脚，
    // 所以印出来跟屏幕上看到的一样：段落在同一行断开，表格在同一行断开，手动分页符照样分页
    function printPages() {
      if (pagT) { cancelAnimationFrame(pagT); pagT = 0; paginate(); } // 还没重排的先排好
      var clone = flow.cloneNode(true), rng = document.createRange(), parts = [];
      clone.querySelectorAll("[contenteditable]").forEach(function (x) { x.removeAttribute("contenteditable"); });
      // 编号列表：每一项的号先写死，切到下一页也接着数
      clone.querySelectorAll("ol").forEach(function (ol) {
        var n = ol.hasAttribute("start") ? ol.start : 1;
        Array.prototype.forEach.call(ol.children, function (li) { if (li.tagName !== "LI") return; if (li.hasAttribute("value")) n = li.value; li.value = n++; });
      });
      var filled = function (x) { return x.textContent.replace(/[\s\u200b]/g, "") !== "" || !!x.querySelector("img, br, hr, table, svg, video, canvas"); };
      var shareCols = function (a, b) { // 表格切成两半：列宽（colgroup）两边都要有
        var ca = a.querySelector(":scope > colgroup"), cb = b.querySelector(":scope > colgroup");
        if (ca && !cb) b.insertBefore(ca.cloneNode(true), b.firstChild); else if (cb && !ca) a.insertBefore(cb.cloneNode(true), a.firstChild);
      };
      clone.querySelectorAll(".pg-sp, hr.pg-break").forEach(function (cut) {
        var anc = [];
        for (var a = cut.parentNode; a && a !== clone; a = a.parentNode) anc.push(a);
        rng.setStart(clone, 0);
        if (cut.tagName === "HR") rng.setEndAfter(cut); else rng.setEndBefore(cut);
        var frag = rng.extractContents();
        frag.querySelectorAll("hr.pg-break").forEach(function (x) { x.remove(); });
        cut.remove();
        // 被切开的块：前半截（克隆）在这一页，后半截（原来的）接着下一页；前半截是空的（整块挪到下一页）就不留空壳
        for (var i = anc.length - 1, node = frag.lastChild; i >= 0 && node && node.nodeType === 1 && node.tagName === anc[i].tagName; i--, node = node.lastChild) {
          if (!filled(node)) { node.remove(); break; }
          anc[i].classList.add("pg-cont");
          if (node.tagName === "TABLE") shareCols(node, anc[i]);
        }
        parts.push(frag);
      });
      var rest = document.createDocumentFragment();
      while (clone.firstChild) rest.appendChild(clone.firstChild);
      parts.push(rest);
      var box = document.createElement("div"), html = function (f) { box.textContent = ""; box.appendChild(f); return box.innerHTML; };
      var vars = Array.prototype.filter.call(flow.style, function (k) { return k.indexOf("--") === 0; }).map(function (k) { return k + ":" + flow.style.getPropertyValue(k); }).join(";");
      var W = page.w, H = page.h;
      var css = "@page{size:" + W + "px " + H + "px;margin:0}html,body{margin:0;padding:0;background:#fff}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
        // 一页比纸矮 1px（纸的高度换算后可能被取整小一点，免得多出空白页）；里面照纸的大小画、超出的裁掉
        ".pgp{position:relative;width:" + W + "px;height:" + (H - 1) + "px;break-after:page;page-break-after:always}.pgp:last-child{break-after:auto;page-break-after:auto}" +
        ".pgp-in{position:absolute;left:0;top:0;width:" + W + "px;height:" + H + "px;overflow:hidden;box-sizing:border-box;padding:" + page.mt + "px " + page.mr + "px 0 " + page.ml + "px}" +
        ".pgp-in>.pg-flow{position:relative;left:auto;top:auto;width:" + (W - page.ml - page.mr) + "px;outline:none}" +
        ".pgp-n{position:absolute;left:0;right:0;bottom:" + Math.max(12, page.mb / 2 - 8) + "px;text-align:center;font:9pt -apple-system,'PingFang SC',sans-serif;color:#8e8e93}" +
        ".pg-cont{text-indent:0!important}li.pg-cont{list-style-type:none}" + flowCSS();
      return {
        html: parts.map(function (f, i) { return '<section class="pgp"><div class="pgp-in"><div class="pg-flow" style="' + esc(vars) + '">' + html(f) + "</div>" + (pageNumbers ? '<span class="pgp-n">' + (i + 1) + "</span>" : "") + "</div></section>"; }).join(""),
        css: css, page: [W * 0.75, H * 0.75], margin: 0,
      };
    }
    // 编辑器里正文的那套 CSS（office.css 里 .pg-flow 开头的规则；垫片、分页符的记号、选中色不要）
    function flowCSS() {
      var out = "";
      Array.prototype.forEach.call(document.styleSheets, function (sh) {
        var rules = null;
        try { rules = /office\/office\.css/.test(sh.href || "") ? sh.cssRules : null; } catch (e) { rules = null; }
        Array.prototype.forEach.call(rules || [], function (r) { if (r.selectorText && /\.pg-flow/.test(r.selectorText) && !/::selection|hr\.pg-break|pg-sp/.test(r.selectorText)) out += r.cssText + "\n"; });
      });
      return out;
    }
    function styleCSS(st, scope) {
      var sel = { body: "p,li", title: "h1.title", subtitle: "p.subtitle", h1: "h1:not(.title)", h2: "h2", h3: "h3", quote: "blockquote", caption: "p.caption", code: "pre" }, out = "";
      Object.keys(sel).forEach(function (k) {
        var s = st[k], r = ["font-size:" + s.size + "pt", "line-height:" + (s.line || 1.4), "margin:" + (s.before || 0) + "pt 0 " + (s.after || 0) + "pt"];
        if (s.color) r.push("color:" + s.color);
        if (s.font) r.push("font-family:'" + s.font + "'");
        if (s.bold) r.push("font-weight:700");
        if (s.italic) r.push("font-style:italic");
        if (s.align) r.push("text-align:" + s.align);
        if (s.firstChars && k === "body") r.push("text-indent:" + s.firstChars + "em");
        out += sel[k] + "{" + r.join(";") + "}";
      });
      return out;
    }

    var ro = new ResizeObserver(function () { layoutCanvas(); placeImgSel(); });
    ro.observe(scroll);
    buildInsp();
    view._debug = { flow: flow, toggleList: toggleList, saveSel: saveSel, loadSel: loadSel, paginate: paginate, pages: function () { return pages; }, page: function () { return page; }, setBlockStyle: setBlockStyle, setBlockProp: setBlockProp, cmd: cmd, setFontSize: setFontSize, insertTable: insertTable, insertPageBreak: insertPageBreak, insertHTML: insertHTML, undo: undo, redo: redo, record: record, stats: stats, setPage: setPage, openFind: openFind, runFind: runFind, doReplace: doReplace, findNext: findNext, tableOp: tableOp, zoom: function () { return zoom; }, setZoom: setZoom, images: function () { return images; }, toggleToc: toggleToc };
    // ======== App 的动作（系统命令 numbers / pages / keynote 用）：读正文 / 大纲、插入 Markdown、查找替换；每次改都能撤销，界面跟着刷新 ========
    function afterApi() { normalizeFlow(); paginate(); record(); changed(true); if (showToc) renderToc(); }
    view.api = {
      text: function () { var clone = flow.cloneNode(true); clone.querySelectorAll(".pg-sp").forEach(function (x) { x.remove(); }); return PG.htmlToText(clone); },
      outline: function () { return Array.prototype.map.call(flow.querySelectorAll("h1, h2, h3"), function (h) { return { level: +h.tagName[1], text: h.textContent.trim() }; }); },
      // md：Markdown（# 标题、列表、表格、**粗体**…）；at："end"（默认）| "start" | 某个标题的文字（插在那一节的最后）
      insert: function (md, at) {
        if (hist.timer) record();
        var box = document.createElement("div");
        box.appendChild(PG.sanitize(PG.mdToHtml(String(md || "")))); // 同粘贴：只留文稿认得的格式
        var nodes = Array.prototype.slice.call(box.childNodes), where = null, where0 = String(at || "end");
        if (where0 === "start") where = flow.firstChild;
        else if (where0 !== "end") {
          var hs = Array.prototype.slice.call(flow.querySelectorAll("h1, h2, h3")), h = hs.find(function (x) { return x.textContent.trim() === where0.trim(); });
          if (!h) throw new Error("no heading \"" + where0 + "\" (headings: " + hs.map(function (x) { return x.textContent.trim(); }).join(" / ") + ")");
          var lv = +h.tagName[1], n = h.nextSibling;
          while (n && !(n.nodeType === 1 && /^H[1-3]$/.test(n.tagName) && +n.tagName[1] <= lv)) n = n.nextSibling;
          where = n;
        }
        // 文档只剩一个空段落：直接换掉它
        if (flow.childNodes.length === 1 && flow.firstChild.nodeType === 1 && !flow.firstChild.textContent.trim() && !flow.querySelector("img, table")) flow.textContent = "";
        nodes.forEach(function (x) { flow.insertBefore(x, where && where.parentNode === flow ? where : null); });
        afterApi();
        var first = nodes.find(function (x) { return x.nodeType === 1; });
        if (first && first.scrollIntoView) first.scrollIntoView({ block: "nearest" });
        return nodes.length;
      },
      // 正文里的文字替换（不跨格式）：all = false 时只换第一处
      replace: function (find, rep, all) {
        if (!find) throw new Error("find is empty");
        if (hist.timer) record();
        var n = 0, walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT), node, list = [];
        while ((node = walker.nextNode())) list.push(node);
        list.some(function (t) {
          var v = t.nodeValue, i = v.indexOf(find);
          if (i < 0) return false;
          var out = "", from = 0;
          while (i >= 0) { out += v.slice(from, i) + rep; from = i + find.length; n++; if (!all) break; i = v.indexOf(find, from); }
          t.nodeValue = out + v.slice(from);
          return !all;
        });
        if (n) afterApi();
        return n;
      },
    };
    return view;
  }

  // ======== 模板 ========
  function today() { var d = new Date(); return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日"; }
  var TEMPLATES = [
    { id: "blank", name: "空白", html: function () { return "<p><br></p>"; } },
    { id: "report", name: "报告", html: function () {
      return '<h1 class="title">项目报告</h1><p class="subtitle">副标题：一句话说明这份报告讲什么</p><p style="color:#6e6e73">作者　·　' + today() + "</p>" +
        "<h1>概述</h1><p>在这里写报告的背景和目的。用「标题 1」「标题 2」这样的段落样式组织结构，左边的「目录」会自动列出它们。</p>" +
        "<h2>主要发现</h2><ul><li>第一个发现，用一两句话说清楚</li><li>第二个发现</li><li>第三个发现</li></ul>" +
        "<h2>数据</h2><table><tbody><tr><td><p><b>指标</b></p></td><td><p><b>上期</b></p></td><td><p><b>本期</b></p></td><td><p><b>变化</b></p></td></tr><tr><td><p>用户数</p></td><td><p>12,400</p></td><td><p>15,800</p></td><td><p>+27%</p></td></tr><tr><td><p>留存率</p></td><td><p>41%</p></td><td><p>46%</p></td><td><p>+5 个百分点</p></td></tr></tbody></table>" +
        '<p class="caption">表 1　关键指标对比</p><h1>结论与下一步</h1><ol><li>第一步做什么</li><li>第二步做什么</li></ol><p><br></p>';
    } },
    { id: "note", name: "笔记", html: function () {
      return '<h1 class="title">笔记</h1><p style="color:#6e6e73">' + today() + "</p><h2>要点</h2><ul><li>☐ 待办一</li><li>☐ 待办二</li><li>☑ 已完成的事</li></ul><h2>记录</h2><p>在这里记下想法……</p><p><br></p>";
    } },
    { id: "letter", name: "信函", html: function () {
      return '<p style="text-align:right">张三<br>北京市朝阳区某某路 1 号<br>zhangsan@example.com</p><p style="text-align:right">' + today() + '</p><p><br></p><p>李四 先生／女士：</p><p style="text-indent:2em">您好！这里是信的正文。第一段说明来意。</p><p style="text-indent:2em">第二段展开具体的内容，可以分几段来写。</p><p style="text-indent:2em">此致</p><p>敬礼！</p><p><br></p><p style="text-align:right">张三</p>';
    } },
    { id: "essay", name: "中文公文", html: function () {
      return '<h1 class="title" style="text-align:center">关于某某事项的通知</h1><p style="text-align:center;color:#6e6e73">（二〇二六年九月）</p><p>各有关单位：</p><p style="text-indent:2em">为了……，现将有关事项通知如下：</p><h2>一、总体要求</h2><p style="text-indent:2em">正文内容。</p><h2>二、工作安排</h2><p style="text-indent:2em">正文内容。</p><p><br></p><p style="text-align:right">某某单位<br>' + today() + "</p>";
    } },
  ];
  function thumbFor(id) {
    var lines = function (n, w) { var h = ""; for (var i = 0; i < n; i++) h += '<i style="width:' + (i === n - 1 ? 60 : w || 100) + '%"></i>'; return '<span class="pgt-lines">' + h + "</span>"; };
    if (id === "blank") return '<div class="pgt"></div>';
    if (id === "report") return '<div class="pgt"><b class="pgt-t">项目报告</b><span class="pgt-s">副标题</span><b class="pgt-h">概述</b>' + lines(3) + '<b class="pgt-h">主要发现</b>' + lines(2) + "</div>";
    if (id === "note") return '<div class="pgt"><b class="pgt-t">笔记</b><b class="pgt-h">要点</b>' + lines(3, 70) + '<b class="pgt-h">记录</b>' + lines(3) + "</div>";
    if (id === "letter") return '<div class="pgt"><span class="pgt-r">' + lines(3, 40) + "</span>" + lines(1, 30) + lines(4) + "</div>";
    if (id === "essay") return '<div class="pgt"><b class="pgt-t" style="text-align:center;font-size:9px">关于某某事项的通知</b>' + lines(1, 40) + '<b class="pgt-h">一、总体要求</b>' + lines(3) + '<b class="pgt-h">二、工作安排</b>' + lines(2) + "</div>";
    return '<div class="pgt">' + lines(6) + "</div>";
  }

  O.defineApp({
    id: "pages", name: "文稿", native: "docx",
    opens: ["docx", "md", "markdown", "txt", "html", "htm"],
    writes: { docx: "lossless", md: "lossy", markdown: "lossy", txt: "lossy", html: "lossy", htm: "lossy" },
    saveFormats: [{ ext: "docx", label: "Word 文稿" }, { ext: "md", label: "Markdown" }, { ext: "txt", label: "纯文本" }, { ext: "html", label: "网页" }],
    exportFormats: [{ ext: "docx", label: "Word" }, { ext: "pdf", label: "PDF" }, { ext: "md", label: "Markdown" }, { ext: "txt", label: "纯文本" }, { ext: "html", label: "网页" }],
    lossyNote: function (ext) { return ext === "txt" ? "纯文本只存文字：字体、颜色、图片、表格格式都不会存。" : ext === "md" || ext === "markdown" ? "Markdown 存标题、粗斜体、列表、表格、链接和图片（图片放在旁边的 .assets 文件夹里）；字体、颜色、对齐、页面设置不会存。" : "网页会存下大部分格式，但页面设置（纸张、页边距）打开时不一定一样。"; },
    about: "文稿文件是标准的 Word 文稿（.docx），可以直接用 Microsoft Word、WPS、Pages 打开；也能打开和存储 Markdown、纯文本、网页，导出 PDF。agent 可以用 python-docx 读写同一个文件，打开着的文稿会提示重新载入。",
    width: 1100, height: 780,
    templates: TEMPLATES.map(function (t) { return { id: t.id, name: t.name, thumb: thumbFor(t.id) }; }),
    newState: function (tpl) { var t = TEMPLATES.find(function (x) { return x.id === tpl; }) || TEMPLATES[0]; return { html: t.html(), page: PG.defaultPage(), images: new PG.Images(), props: {}, pageNumbers: tpl === "report" || tpl === "essay" }; },
    read: function (u8, ext, path) { return PG.read(u8, ext, path); },
    createView: createView,
    // App 的动作（系统命令用，参数说明在 office.js）
    actions: {
      text: function (doc) {
        var t = doc.view.api.text(), o = doc.view.api.outline();
        return { text: (o.length ? "Outline:\n" + o.map(function (x) { return "  ".repeat(x.level - 1) + "- " + x.text; }).join("\n") + "\n\n" : "") + "Text:\n" + t, summary: t.length + " characters" + (o.length ? ", " + o.length + " headings" : "") };
      },
      insert: function (doc, a, h) {
        h.check();
        var n = doc.view.api.insert(a.markdown, a.at), where = !a.at || a.at === "end" ? "at the end" : a.at === "start" ? "at the start" : "at the end of section \"" + a.at + "\"";
        return h.settle().then(function (sv) { return { text: "Inserted " + n + " block" + (n > 1 ? "s" : "") + " " + where + " of " + h.label + sv + ".", summary: "Inserted " + n + " block" + (n > 1 ? "s" : "") }; });
      },
      replace: function (doc, a, h) {
        h.check();
        var n = doc.view.api.replace(a.find, a.replace, a.all);
        if (!n) return { text: "\"" + a.find + "\" was not found in " + h.label + ".", summary: "Not found" };
        return h.settle().then(function (sv) { return { text: "Replaced " + n + " occurrence" + (n > 1 ? "s" : "") + " in " + h.label + sv + ".", summary: "Replaced " + n }; });
      },
    },
  });
})();
