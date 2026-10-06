// office/keynote.js —— 讲演：Keynote 的样子，PowerPoint 的文件
// · 左边幻灯片导航（缩略图，拖动换顺序，右键新建 / 复制 / 删除 / 跳过）；中间是幻灯片，下面可以打开演讲者注释
// · 文本框、形状（15 种）、图片：点选、⇧ / ⌘ 多选、框选；拖动（对齐参考线：幻灯片中线、边缘、别的对象）、八个把手改大小（⇧ 等比）、旋转把手（⇧ 每 15°）；
//   双击编辑文字（粗体、斜体、颜色、列表）；方向键微移、⌘D 复制、⌘C / ⌘V、删除、层次、对齐
// · 主题（6 套）、版式（7 种）、背景、切换效果；全屏放映（点、方向键、空格翻页，B / W 黑白屏，数字 + 回车跳页，P 演讲者视图：当前 / 下一张 / 注释 / 计时）
(function () {
  "use strict";
  var O = window.TSU_OFFICE, KN = O.kn, D = window.TSU_DESK;
  if (!O || !KN) return;
  var ui = O.ui, el = O.el, esc = O.esc, it = O.item, SEP = O.SEP;
  var PT = KN.PT;
  var FONTS = [["", "主题字体"], ["PingFang SC", "苹方"], ["Songti SC", "宋体"], ["Kaiti SC", "楷体"], ["Heiti SC", "黑体"], ["Helvetica Neue", "Helvetica Neue"], ["Avenir Next", "Avenir Next"], ["Futura", "Futura"], ["Georgia", "Georgia"], ["Times New Roman", "Times New Roman"], ["Gill Sans", "Gill Sans"], ["Menlo", "Menlo"]];
  var TRANS = [{ v: "none", label: "无" }, { v: "fade", label: "淡入淡出" }, { v: "dissolve", label: "溶解" }, { v: "push", label: "推移" }, { v: "move", label: "移入" }, { v: "wipe", label: "擦除" }, { v: "zoom", label: "缩放" }];

  // ======== 画一张幻灯片（编辑、缩略图、放映、打印共用）========
  function slideBg(deck, slide) {
    var t = KN.theme(deck.theme), bg = slide.bg;
    if (bg && bg.image) return "center / cover no-repeat url(" + bg.image + ")";
    if (bg && bg.grad) return "linear-gradient(135deg, " + bg.grad[0] + ", " + bg.grad[1] + ")";
    if (bg && bg.color) return bg.color;
    return t.bg2 ? "linear-gradient(135deg, " + t.bg + ", " + t.bg2 + ")" : t.bg;
  }
  function renderSlide(deck, slide, opts) {
    opts = opts || {};
    var box = el("div", "kn-sl");
    box.style.width = deck.w + "px";
    box.style.height = deck.h + "px";
    box.style.background = slideBg(deck, slide);
    slide.items.forEach(function (item) { box.appendChild(itemEl(deck, item, opts)); });
    return box;
  }
  KN.renderSlide = renderSlide; // 访达的快速查看、缩略图（office/preview.js）也用这一份
  function itemEl(deck, item, opts) {
    var t = KN.theme(deck.theme), e = el("div", "kn-it kn-" + item.type);
    e.dataset.id = item.id;
    e.style.left = item.x + "px";
    e.style.top = item.y + "px";
    e.style.width = Math.max(1, item.w) + "px";
    e.style.height = Math.max(1, item.h) + "px";
    if (item.rot) e.style.transform = "rotate(" + item.rot + "deg)";
    if (item.opacity != null && item.opacity < 1) e.style.opacity = item.opacity;
    if (item.type === "image") {
      var im = document.createElement("img");
      im.src = item.src || "";
      im.draggable = false;
      e.appendChild(im);
      return e;
    }
    if (item.type === "shape") {
      var line = item.shape === "line" || item.shape === "arrowLine", sw = item.strokeW || (line ? 4 : 0);
      var svg = '<svg class="kn-svg" viewBox="0 0 ' + item.w + " " + Math.max(1, item.h) + '" preserveAspectRatio="none" width="' + item.w + '" height="' + Math.max(1, item.h) + '">';
      if (item.shape === "arrowLine") svg += '<defs><marker id="ah-' + item.id + '" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L4,2 L0,4Z" fill="' + (item.stroke || t.shape) + '"/></marker></defs>';
      svg += '<path d="' + KN.shapePath(item.shape, item.w, Math.max(1, item.h), item.radius) + '" fill="' + (line ? "none" : item.fill || "none") + '" stroke="' + (line ? item.stroke || t.shape : item.stroke || "none") + '" stroke-width="' + sw + '"' + (item.shape === "arrowLine" ? ' marker-end="url(#ah-' + item.id + ')"' : "") + ' vector-effect="non-scaling-stroke"/></svg>';
      e.insertAdjacentHTML("beforeend", svg);
    }
    if (item.type === "text" || item.type === "shape" && item.shape !== "line" && item.shape !== "arrowLine") e.appendChild(textEl(deck, item, opts));
    return e;
  }
  function textEl(deck, item, opts) {
    var t = KN.theme(deck.theme), f = item.font || {}, tx = el("div", "kn-txt");
    tx.style.justifyContent = f.valign === "middle" ? "center" : f.valign === "bottom" ? "flex-end" : "flex-start";
    tx.style.textAlign = f.align || (item.type === "shape" ? "center" : "left");
    tx.style.fontSize = (f.size || 24) * PT + "px";
    tx.style.fontFamily = '"' + (f.family || (item.ph === "title" ? t.headFont : t.font)) + '", -apple-system, "PingFang SC", sans-serif';
    tx.style.color = f.color || (item.type === "shape" ? (item.fill && KN.lum(item.fill) < 0.6 ? "#ffffff" : "#1d1d1f") : item.ph === "title" ? t.title : t.body);
    if (f.bold) tx.style.fontWeight = "700";
    if (f.italic) tx.style.fontStyle = "italic";
    tx.style.lineHeight = f.line || (item.ph === "title" ? 1.1 : 1.25);
    if (item.type === "shape") tx.style.justifyContent = f.valign === "top" ? "flex-start" : f.valign === "bottom" ? "flex-end" : "center";
    var inner = el("div", "kn-tin" + (item.list ? " kn-list-" + item.list : ""));
    var html = item.html || "";
    if (!html.replace(/<[^>]+>/g, "").replace(/​/g, "").trim() && !/<img/.test(html)) {
      if (opts.edit && item.ph) { inner.innerHTML = '<p class="kn-prompt">' + esc(KN.PROMPT[item.ph] || "双击以编辑") + "</p>"; tx.classList.add("empty"); }
      else inner.innerHTML = html || "<p><br></p>";
    } else inner.innerHTML = html;
    tx.appendChild(inner);
    return tx;
  }
  // 编辑后的文字只留白名单里的标签和样式
  function cleanHTML(node) {
    var out = document.createElement("div");
    (function walk(src, dst) {
      Array.prototype.forEach.call(src.childNodes, function (c) {
        if (c.nodeType === 3) { dst.appendChild(document.createTextNode(c.nodeValue)); return; }
        if (c.nodeType !== 1 || c.classList.contains("kn-prompt")) return;
        var tag = c.tagName, map = { P: "p", DIV: "p", UL: "ul", OL: "ol", LI: "li", BR: "br", B: "b", STRONG: "b", I: "i", EM: "i", U: "u", S: "s", STRIKE: "s", SPAN: "span", FONT: "span" }[tag];
        if (!map) { walk(c, dst); return; }
        var n = document.createElement(map);
        if (map === "span" || map === "p" || map === "li") {
          var st = c.style, css = [];
          if (st && st.color) css.push("color:" + st.color);
          if (st && st.fontSize) css.push("font-size:" + st.fontSize);
          if (st && st.fontFamily) css.push("font-family:" + st.fontFamily);
          if (st && (st.fontWeight === "bold" || +st.fontWeight >= 600)) css.push("font-weight:bold");
          if (st && st.fontStyle === "italic") css.push("font-style:italic");
          if (st && st.textDecorationLine && st.textDecorationLine !== "none") css.push("text-decoration:" + st.textDecorationLine);
          if (st && st.textAlign && map !== "span") css.push("text-align:" + st.textAlign);
          if (tag === "FONT" && c.color) css.push("color:" + c.color);
          if (css.length) n.setAttribute("style", css.join(";"));
        }
        walk(c, n);
        if (map === "span" && !n.getAttribute("style")) { while (n.firstChild) dst.appendChild(n.firstChild); return; }
        dst.appendChild(n);
      });
    })(node, out);
    // 顶层的零散文字包成段落
    var fixed = document.createElement("div"), cur = null;
    Array.prototype.slice.call(out.childNodes).forEach(function (n) {
      if (n.nodeType === 1 && /^(P|UL|OL)$/.test(n.tagName)) { cur = null; fixed.appendChild(n); return; }
      if (!cur) { cur = document.createElement("p"); fixed.appendChild(cur); }
      cur.appendChild(n);
    });
    return fixed.innerHTML;
  }

  function createView(doc, deck) {
    deck.images = deck.images || new KN.Images();
    if (!deck.slides.length) deck.slides.push(KN.newSlide(deck, "title"));
    var cur = 0, sel = [], navSel = new Set(), editing = null, zoom = 1, autoZoom = true, showNav = true, showNotes = localStorage.getItem("tsu-keynote-notes") === "on", inspMode = "format", inspTab = null;
    var hist = { stack: [], idx: -1, timer: 0 };
    var slide = function () { return deck.slides[cur]; };
    var findItem = function (id) { return slide().items.find(function (x) { return x.id === id; }); };

    var root = el("div", "kn");
    root.innerHTML =
      '<div class="kn-body"><div class="kn-nav" tabindex="0"></div>' +
      '<div class="kn-main"><div class="kn-stage" tabindex="0"><div class="kn-canvas"><div class="kn-scale"></div><div class="kn-ov"></div></div></div>' +
      '<div class="kn-notes" hidden><textarea placeholder="点按以添加演讲者注释" spellcheck="false"></textarea></div></div></div>';
    var $ = function (s) { return root.querySelector(s); };
    var nav = $(".kn-nav"), stage = $(".kn-stage"), canvas = $(".kn-canvas"), scaleEl = $(".kn-scale"), ov = $(".kn-ov"), notesBox = $(".kn-notes"), notesTa = $(".kn-notes textarea");

    // ======== 撤销（整个幻灯片列表的快照；图片是 blob 地址，不复制字节）========
    var snap = function () { return JSON.stringify({ slides: deck.slides, theme: deck.theme, w: deck.w, h: deck.h }); };
    function record() {
      clearTimeout(hist.timer);
      hist.timer = 0;
      var s = snap(), top = hist.stack[hist.idx];
      if (top && top.s === s) return;
      hist.stack.splice(hist.idx + 1);
      hist.stack.push({ s: s, cur: cur, sel: sel.slice() });
      if (hist.stack.length > 150) hist.stack.shift();
      hist.idx = hist.stack.length - 1;
    }
    function recordSoon() { clearTimeout(hist.timer); hist.timer = setTimeout(record, 500); }
    function restore(h) {
      var o = JSON.parse(h.s);
      deck.slides = o.slides;
      deck.theme = o.theme;
      deck.w = o.w;
      deck.h = o.h;
      cur = Math.min(h.cur, deck.slides.length - 1);
      sel = h.sel.filter(function (id) { return !!findItem(id); });
      renderAll();
      doc.changed();
    }
    function undo() { if (editing) return; if (hist.timer) record(); if (hist.idx <= 0) return; hist.idx--; restore(hist.stack[hist.idx]); }
    function redo() { if (editing) return; if (hist.idx >= hist.stack.length - 1) return; hist.idx++; restore(hist.stack[hist.idx]); }
    function changed(soon) { if (soon) recordSoon(); else record(); doc.changed(); thumbSoon(); syncSoon(); }

    // ======== 画 ========
    function fit() {
      if (!autoZoom) return;
      var pad = stage.clientWidth < 600 ? 20 : 60, W = stage.clientWidth - pad, H = stage.clientHeight - pad; // 手机上边上少留点
      if (W <= 0 || H <= 0) return;
      zoom = Math.max(0.1, Math.min(W / deck.w, H / deck.h));
    }
    function layout() {
      fit();
      canvas.style.width = deck.w * zoom + "px";
      canvas.style.height = deck.h * zoom + "px";
      scaleEl.style.transform = "scale(" + zoom + ")";
      scaleEl.style.width = deck.w + "px";
      scaleEl.style.height = deck.h + "px";
      drawOverlay();
    }
    function renderCanvas() {
      scaleEl.textContent = "";
      scaleEl.appendChild(renderSlide(deck, slide(), { edit: true }));
      if (editing) { var e = scaleEl.querySelector('[data-id="' + editing + '"]'); if (!e) editing = null; }
      layout();
    }
    function renderAll() { renderNav(); renderCanvas(); notesTa.value = slide().notes || ""; syncSoon(); doc.refresh(); }
    // 导航里的缩略图
    var TW = 168;
    function thumb(s, i) {
      var t = el("div", "kn-th" + (i === cur ? " on" : "") + (navSel.has(i) ? " sel" : "") + (s.hidden ? " skip" : ""));
      t.dataset.i = i;
      var frame = el("div", "kn-thf"), sc = TW / deck.w, r = renderSlide(deck, s, {});
      frame.style.width = TW + "px";
      frame.style.height = Math.round(deck.h * sc) + "px";
      r.style.transform = "scale(" + sc + ")";
      frame.appendChild(r);
      t.appendChild(el("span", "kn-thn", String(i + 1)));
      t.appendChild(frame);
      return t;
    }
    function renderNav() {
      nav.textContent = "";
      deck.slides.forEach(function (s, i) { nav.appendChild(thumb(s, i)); });
      var on = nav.querySelector(".kn-th.on");
      if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest" });
    }
    var thumbT = 0;
    function thumbSoon() { clearTimeout(thumbT); thumbT = setTimeout(function () { var old = nav.querySelector('.kn-th[data-i="' + cur + '"]'); if (old) old.replaceWith(thumb(slide(), cur)); else renderNav(); }, 150); }

    // ======== 选中框、把手、参考线 ========
    var guides = [];
    function boxOf(item) { return { x: item.x, y: item.y, w: item.w, h: item.h }; }
    function drawOverlay() {
      ov.textContent = "";
      var z = zoom;
      sel.forEach(function (id) {
        var item = findItem(id);
        if (!item) return;
        var b = el("div", "kn-selbox" + (editing === id ? " editing" : ""));
        b.style.left = item.x * z + "px";
        b.style.top = item.y * z + "px";
        b.style.width = item.w * z + "px";
        b.style.height = item.h * z + "px";
        if (item.rot) b.style.transform = "rotate(" + item.rot + "deg)";
        if (sel.length === 1 && editing !== id) {
          var line = item.type === "shape" && (item.shape === "line" || item.shape === "arrowLine");
          (line ? ["w", "e"] : ["nw", "n", "ne", "e", "se", "s", "sw", "w"]).forEach(function (h) { var hd = el("b", "kn-h kn-h-" + h); hd.dataset.h = h; b.appendChild(hd); });
          if (!line) { var rh = el("b", "kn-rot"); rh.dataset.h = "rot"; b.appendChild(rh); }
        }
        ov.appendChild(b);
      });
      guides.forEach(function (g) {
        var gl = el("div", "kn-guide " + g.axis);
        if (g.axis === "v") { gl.style.left = g.at * z + "px"; gl.style.top = 0; gl.style.height = deck.h * z + "px"; }
        else { gl.style.top = g.at * z + "px"; gl.style.left = 0; gl.style.width = deck.w * z + "px"; }
        ov.appendChild(gl);
      });
      if (marquee) { var m = el("div", "kn-marq"); m.style.left = marquee.x * z + "px"; m.style.top = marquee.y * z + "px"; m.style.width = marquee.w * z + "px"; m.style.height = marquee.h * z + "px"; ov.appendChild(m); }
    }
    var marquee = null;
    function toSlide(e) { var r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom }; }
    function setSel(ids) { sel = ids; drawOverlay(); syncSoon(); }

    // ======== 鼠标：选、拖、改大小、旋转、框选 ========
    stage.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      var h = e.target.closest && e.target.closest(".kn-h, .kn-rot");
      if (editing) {
        var ed = scaleEl.querySelector('[data-id="' + editing + '"]');
        if (ed && ed.contains(e.target)) return; // 编辑中的文字里点：交给浏览器放光标
        endEdit();
      }
      stage.focus({ preventScroll: true });
      var p = toSlide(e);
      if (h && sel.length === 1) { e.preventDefault(); return startHandle(e, findItem(sel[0]), h.dataset.h, p); }
      var ie = e.target.closest && e.target.closest(".kn-it");
      if (ie && scaleEl.contains(ie)) {
        e.preventDefault();
        var id = ie.dataset.id;
        if (e.shiftKey || e.metaKey || e.ctrlKey) { setSel(sel.indexOf(id) >= 0 ? sel.filter(function (x) { return x !== id; }) : sel.concat([id])); return; }
        if (sel.indexOf(id) < 0) setSel([id]);
        return startMove(e, p);
      }
      // 空白处：框选
      e.preventDefault();
      if (!e.shiftKey) setSel([]);
      var base = e.shiftKey ? sel.slice() : [];
      marquee = { x: p.x, y: p.y, w: 0, h: 0 };
      capture(e, function (ev) {
        var q = toSlide(ev);
        marquee = { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y) };
        var hit = slide().items.filter(function (x) { return x.x < marquee.x + marquee.w && x.x + x.w > marquee.x && x.y < marquee.y + marquee.h && x.y + x.h > marquee.y; }).map(function (x) { return x.id; });
        sel = base.concat(hit.filter(function (id) { return base.indexOf(id) < 0; }));
        drawOverlay();
      }, function () { marquee = null; drawOverlay(); syncSoon(); });
    });
    // 拖动时指针被画布捕获了，双击事件的目标是画布本身：按坐标找对象
    function itemAtPoint(x, y) { var hit = document.elementsFromPoint(x, y).find(function (n) { return n.classList && n.classList.contains("kn-it") && scaleEl.contains(n); }); return hit || null; }
    stage.addEventListener("dblclick", function (e) {
      var ie = itemAtPoint(e.clientX, e.clientY);
      if (!ie) return;
      var item = findItem(ie.dataset.id);
      if (!item) return;
      if (item.type === "text" || item.type === "shape" && item.shape !== "line" && item.shape !== "arrowLine") beginEdit(item, e);
      else if (item.type === "image") replaceImage(item);
    });
    function capture(e, move, end) {
      var tgt = stage;
      try { tgt.setPointerCapture(e.pointerId); } catch (x) { /* 没关系 */ }
      var mv = function (ev) { move(ev); }, up = function (ev) { tgt.removeEventListener("pointermove", mv); tgt.removeEventListener("pointerup", up); tgt.removeEventListener("pointercancel", up); end(ev); };
      tgt.addEventListener("pointermove", mv);
      tgt.addEventListener("pointerup", up);
      tgt.addEventListener("pointercancel", up);
    }
    // 拖动：吸附到幻灯片中线 / 边、别的对象的边和中线
    function snapTargets(ignore) {
      var xs = [0, deck.w / 2, deck.w], ys = [0, deck.h / 2, deck.h];
      slide().items.forEach(function (x) { if (ignore.indexOf(x.id) >= 0 || x.rot) return; xs.push(x.x, x.x + x.w / 2, x.x + x.w); ys.push(x.y, x.y + x.h / 2, x.y + x.h); });
      return { xs: xs, ys: ys };
    }
    function startMove(e, p0) {
      var items = sel.map(findItem).filter(Boolean), start = items.map(function (x) { return { x: x.x, y: x.y }; }), moved = false, tg = snapTargets(sel);
      var bb = bounds(items);
      capture(e, function (ev) {
        var p = toSlide(ev), dx = p.x - p0.x, dy = p.y - p0.y;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 3 / zoom) return;
        moved = true;
        guides = [];
        if (!ev.metaKey) {
          var th = 6 / zoom, nb = { x: bb.x + dx, y: bb.y + dy, w: bb.w, h: bb.h }, best;
          best = snap1([nb.x, nb.x + nb.w / 2, nb.x + nb.w], tg.xs, th);
          if (best) { dx += best.d; guides.push({ axis: "v", at: best.at }); }
          best = snap1([nb.y, nb.y + nb.h / 2, nb.y + nb.h], tg.ys, th);
          if (best) { dy += best.d; guides.push({ axis: "h", at: best.at }); }
        }
        if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        items.forEach(function (x, i) { x.x = Math.round(start[i].x + dx); x.y = Math.round(start[i].y + dy); var ne = scaleEl.querySelector('[data-id="' + x.id + '"]'); if (ne) { ne.style.left = x.x + "px"; ne.style.top = x.y + "px"; } });
        drawOverlay();
      }, function () { guides = []; drawOverlay(); if (moved) changed(); });
    }
    function snap1(vals, targets, th) {
      var best = null;
      vals.forEach(function (v) { targets.forEach(function (t) { var d = t - v; if (Math.abs(d) <= th && (!best || Math.abs(d) < Math.abs(best.d))) best = { d: d, at: t }; }); });
      return best;
    }
    function bounds(items) {
      var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      items.forEach(function (x) { x1 = Math.min(x1, x.x); y1 = Math.min(y1, x.y); x2 = Math.max(x2, x.x + x.w); y2 = Math.max(y2, x.y + x.h); });
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
    function startHandle(e, item, h, p0) {
      var s = { x: item.x, y: item.y, w: item.w, h: item.h, rot: item.rot || 0 }, ratio = s.w / Math.max(1, s.h);
      var keep = item.type === "image";
      capture(e, function (ev) {
        var p = toSlide(ev);
        if (h === "rot") {
          var cx = s.x + s.w / 2, cy = s.y + s.h / 2, ang = Math.atan2(p.y - cy, p.x - cx) * 180 / Math.PI + 90;
          if (ev.shiftKey) ang = Math.round(ang / 15) * 15;
          else if (Math.abs(((ang % 90) + 90) % 90) < 3 || Math.abs(((ang % 90) + 90) % 90) > 87) ang = Math.round(ang / 90) * 90;
          item.rot = Math.round(((ang % 360) + 360) % 360);
          if (item.rot === 360) item.rot = 0;
        } else {
          // 在对象自己的坐标里算（旋转过的也行）
          var rad = s.rot * Math.PI / 180, cos = Math.cos(-rad), sin = Math.sin(-rad), dx0 = p.x - p0.x, dy0 = p.y - p0.y;
          var dx = dx0 * cos - dy0 * sin, dy = dx0 * sin + dy0 * cos;
          var x = 0, y = 0, w = s.w, hh = s.h;
          if (/e/.test(h)) w = s.w + dx;
          if (/w/.test(h)) { w = s.w - dx; x = dx; }
          if (/s/.test(h)) hh = s.h + dy;
          if (/n/.test(h)) { hh = s.h - dy; y = dy; }
          if ((keep !== ev.shiftKey) && h.length === 2) { var nh = w / ratio; if (/n/.test(h)) y += hh - nh; hh = nh; }
          w = Math.max(8, w);
          hh = Math.max(item.type === "shape" && (item.shape === "line" || item.shape === "arrowLine") ? 1 : 8, hh);
          // 旋转过的：换回幻灯片坐标（保持对边不动）
          var cx0 = s.x + s.w / 2, cy0 = s.y + s.h / 2, lx = x + w / 2 - s.w / 2, ly = y + hh / 2 - s.h / 2, r2 = s.rot * Math.PI / 180;
          var ncx = cx0 + lx * Math.cos(r2) - ly * Math.sin(r2), ncy = cy0 + lx * Math.sin(r2) + ly * Math.cos(r2);
          item.w = Math.round(w);
          item.h = Math.round(hh);
          item.x = Math.round(ncx - w / 2);
          item.y = Math.round(ncy - hh / 2);
        }
        var ne = scaleEl.querySelector('[data-id="' + item.id + '"]');
        if (ne) ne.replaceWith(itemEl(deck, item, { edit: true }));
        drawOverlay();
      }, function () { changed(); syncSoon(); });
    }

    // ======== 编辑文字 ========
    function beginEdit(item, e) {
      if (editing === item.id) return;
      endEdit();
      record();
      editing = item.id;
      sel = [item.id];
      var ne = scaleEl.querySelector('[data-id="' + item.id + '"]');
      if (!ne) return;
      var tx = ne.querySelector(".kn-txt"), inner = tx.querySelector(".kn-tin");
      if (tx.classList.contains("empty")) { inner.innerHTML = item.list ? "<ul><li><br></li></ul>" : "<p><br></p>"; tx.classList.remove("empty"); }
      inner.contentEditable = "true";
      inner.spellcheck = false;
      ne.classList.add("editing");
      inner.focus();
      var r = e && document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null, s = window.getSelection();
      if (!r || !inner.contains(r.startContainer)) { r = document.createRange(); r.selectNodeContents(inner); if (!e) { /* 键盘进来：全选 */ } else r.collapse(false); }
      s.removeAllRanges();
      s.addRange(r);
      inner.addEventListener("input", onEditInput);
      inner.addEventListener("keydown", onEditKey);
      drawOverlay();
      syncSoon();
    }
    function onEditInput() {
      var item = findItem(editing);
      if (!item) return;
      var ne = scaleEl.querySelector('[data-id="' + editing + '"]'), inner = ne && ne.querySelector(".kn-tin");
      // 文本框跟着字长高（形状不变）
      if (item.type === "text" && inner) { var need = inner.scrollHeight + 8; if (need > item.h) { item.h = Math.ceil(need); ne.style.height = item.h + "px"; drawOverlay(); } }
      doc.changed();
      thumbSoon();
    }
    function onEditKey(e) {
      var mod = e.metaKey || e.ctrlKey;
      if (e.key === "Escape") { e.preventDefault(); var id = editing; endEdit(); setSel([id]); stage.focus({ preventScroll: true }); return; }
      if (mod && !e.altKey && (e.code === "KeyB" || e.code === "KeyI" || e.code === "KeyU")) { e.preventDefault(); document.execCommand("styleWithCSS", false, false); document.execCommand({ KeyB: "bold", KeyI: "italic", KeyU: "underline" }[e.code]); onEditInput(); return; }
      if (mod && e.code === "KeyZ") { e.stopPropagation(); return; } // 编辑中用浏览器自己的撤销
      if (e.key === "Tab") {
        e.preventDefault();
        var s = window.getSelection(), li = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentNode).closest("li");
        if (li) document.execCommand(e.shiftKey ? "outdent" : "indent");
        else document.execCommand("insertText", false, "\t");
      }
      e.stopPropagation();
    }
    function endEdit() {
      if (!editing) return;
      var id = editing, item = findItem(id), ne = scaleEl.querySelector('[data-id="' + id + '"]');
      editing = null;
      if (item && ne) {
        var inner = ne.querySelector(".kn-tin");
        inner.removeEventListener("input", onEditInput);
        inner.removeEventListener("keydown", onEditKey);
        var html = cleanHTML(inner);
        if (!html.replace(/<[^>]+>/g, "").trim()) html = "";
        item.html = html;
        // 空的普通文本框就删掉（同 Keynote）
        if (!html && item.type === "text" && !item.ph) { slide().items = slide().items.filter(function (x) { return x !== item; }); sel = []; }
      }
      window.getSelection().removeAllRanges();
      renderCanvas();
      changed();
    }

    // ======== 对象的增删改 ========
    function addItem(item, select) {
      endEdit();
      slide().items.push(Object.assign({ id: KN.newId(), rot: 0 }, item));
      renderCanvas();
      if (select !== false) setSel([slide().items[slide().items.length - 1].id]);
      changed();
      return slide().items[slide().items.length - 1];
    }
    function addText() {
      var t = addItem({ type: "text", x: deck.w / 2 - 300, y: deck.h / 2 - 50, w: 600, h: 100, html: "", font: { size: 32, align: "center", valign: "top" } });
      beginEdit(t, null);
      var inner = scaleEl.querySelector('[data-id="' + t.id + '"] .kn-tin');
      if (inner) { inner.innerHTML = "<p>文本</p>"; var r = document.createRange(); r.selectNodeContents(inner); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
    }
    function addShape(kind) {
      var t = KN.theme(deck.theme), line = kind === "line" || kind === "arrowLine";
      addItem({ type: "shape", shape: kind, x: deck.w / 2 - 180, y: deck.h / 2 - (line ? 2 : 130), w: 360, h: line ? 4 : 260, fill: line ? null : t.shape, stroke: line ? t.shape : null, strokeW: line ? 6 : 0, html: "", font: { size: 28, align: "center", valign: "middle" } });
    }
    function addImageBytes(bytes, mime) {
      var url = deck.images.add(bytes, mime);
      var im = new Image();
      im.onload = function () {
        var w = im.naturalWidth, h = im.naturalHeight, maxW = deck.w * 0.6, maxH = deck.h * 0.6, sc = Math.min(1, maxW / w, maxH / h);
        addItem({ type: "image", src: url, x: Math.round((deck.w - w * sc) / 2), y: Math.round((deck.h - h * sc) / 2), w: Math.round(w * sc), h: Math.round(h * sc) });
      };
      im.onerror = function () { doc.alert({ title: "这张图片打不开", icon: "caution" }); };
      im.src = url;
    }
    function replaceImage(item) {
      O.upload("image/*").then(function (f) {
        if (!f) return;
        record();
        item.src = deck.images.add(f.bytes, KN.mimeOf(f.name));
        renderCanvas();
        changed();
      });
    }
    function sandboxImages() {
      var FS = window.SANDBOX, files = [];
      [O.DOCS, O.HOME + "/Desktop", O.HOME + "/Downloads", O.HOME + "/Pictures"].forEach(function (d) { try { FS.list(d).forEach(function (p) { if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(p)) files.push(p); }); } catch (e) { /* 没有这个文件夹 */ } });
      var items = files.slice(0, 40).map(function (p) { return it(O.tilde(p), "", function () { O.readBytes(p).then(function (b) { addImageBytes(b, KN.mimeOf(p)); }); }); });
      return items.length ? items : [it("（文稿、桌面、下载、图片里没有图片）", "", null, { disabled: true })];
    }
    function mediaItems() { return [it("从电脑选取图片…", "", function () { O.upload("image/*").then(function (f) { if (f) addImageBytes(f.bytes, KN.mimeOf(f.name)); }); }), SEP].concat(sandboxImages()); }
    function deleteSel() { if (!sel.length) return; slide().items = slide().items.filter(function (x) { return sel.indexOf(x.id) < 0; }); sel = []; renderCanvas(); changed(); }
    function duplicateSel() {
      if (!sel.length) return duplicateSlides();
      var copies = sel.map(findItem).filter(Boolean).map(function (x) { var c = JSON.parse(JSON.stringify(x)); c.id = KN.newId(); c.x += 30; c.y += 30; delete c.ph; return c; });
      copies.forEach(function (c) { slide().items.push(c); });
      renderCanvas();
      setSel(copies.map(function (c) { return c.id; }));
      changed();
    }
    function order(where) {
      var items = slide().items, picked = items.filter(function (x) { return sel.indexOf(x.id) >= 0; });
      if (!picked.length) return;
      var rest = items.filter(function (x) { return sel.indexOf(x.id) < 0; });
      if (where === "front") slide().items = rest.concat(picked);
      else if (where === "back") slide().items = picked.concat(rest);
      else {
        var arr = items.slice(), idxs = picked.map(function (x) { return arr.indexOf(x); }).sort(function (a, b) { return where === "up" ? b - a : a - b; });
        idxs.forEach(function (i) { var j = where === "up" ? i + 1 : i - 1; if (j < 0 || j >= arr.length || sel.indexOf(arr[j].id) >= 0) return; var t = arr[i]; arr[i] = arr[j]; arr[j] = t; });
        slide().items = arr;
      }
      renderCanvas();
      changed();
    }
    function alignSel(how) {
      var items = sel.map(findItem).filter(Boolean);
      if (!items.length) return;
      var b = items.length > 1 ? bounds(items) : { x: 0, y: 0, w: deck.w, h: deck.h };
      items.forEach(function (x) {
        if (how === "left") x.x = b.x; if (how === "hcenter") x.x = Math.round(b.x + b.w / 2 - x.w / 2); if (how === "right") x.x = b.x + b.w - x.w;
        if (how === "top") x.y = b.y; if (how === "vcenter") x.y = Math.round(b.y + b.h / 2 - x.h / 2); if (how === "bottom") x.y = b.y + b.h - x.h;
      });
      if ((how === "hdist" || how === "vdist") && items.length > 2) {
        var k = how === "hdist" ? "x" : "y", s = how === "hdist" ? "w" : "h", sorted = items.slice().sort(function (a, c) { return a[k] - c[k]; });
        var total = sorted.reduce(function (a, x) { return a + x[s]; }, 0), span = sorted[sorted.length - 1][k] + sorted[sorted.length - 1][s] - sorted[0][k], gap = (span - total) / (sorted.length - 1), pos = sorted[0][k];
        sorted.forEach(function (x) { x[k] = Math.round(pos); pos += x[s] + gap; });
      }
      renderCanvas();
      changed();
    }
    function nudge(dx, dy) { sel.map(findItem).filter(Boolean).forEach(function (x) { x.x += dx; x.y += dy; }); renderCanvas(); changed(true); }
    function setFont(patch, whole) {
      // 编辑中且有选中的文字：只改选中的；否则改整个对象
      var s = window.getSelection();
      if (editing && s.rangeCount && !s.isCollapsed && !whole) {
        document.execCommand("styleWithCSS", false, true);
        if (patch.color) document.execCommand("foreColor", false, patch.color);
        if (patch.family) document.execCommand("fontName", false, patch.family);
        if (patch.bold != null) document.execCommand("bold");
        if (patch.italic != null) document.execCommand("italic");
        if (patch.size) { document.execCommand("styleWithCSS", false, false); document.execCommand("fontSize", false, "7"); scaleEl.querySelectorAll('font[size="7"]').forEach(function (f) { var sp = document.createElement("span"); sp.style.fontSize = patch.size * PT + "px"; while (f.firstChild) sp.appendChild(f.firstChild); f.replaceWith(sp); }); }
        document.execCommand("styleWithCSS", false, false);
        onEditInput();
        return;
      }
      var wasEditing = editing;
      if (editing) endEdit();
      var items = sel.map(findItem).filter(function (x) { return x && x.type !== "image"; });
      if (!items.length) return;
      items.forEach(function (x) { x.font = Object.assign({}, x.font || {}, patch); if (patch.list !== undefined) { x.list = patch.list; delete x.font.list; x.html = relist(x.html, patch.list); } });
      renderCanvas();
      changed();
      if (wasEditing) { /* 保持选中 */ }
    }
    // 段落 ↔ 列表
    function relist(html, list) {
      var box = document.createElement("div");
      box.innerHTML = html || "";
      var lines = [];
      box.querySelectorAll("p, li").forEach(function (n) { if (!n.querySelector("p, li")) lines.push(n.innerHTML); });
      if (!lines.length && box.textContent) lines.push(esc(box.textContent));
      if (!lines.length) return "";
      if (list === "bullet") return "<ul>" + lines.map(function (l) { return "<li>" + l + "</li>"; }).join("") + "</ul>";
      if (list === "number") return "<ol>" + lines.map(function (l) { return "<li>" + l + "</li>"; }).join("") + "</ol>";
      return lines.map(function (l) { return "<p>" + l + "</p>"; }).join("");
    }
    function setProp(patch) {
      var items = sel.map(findItem).filter(Boolean);
      if (!items.length) return;
      items.forEach(function (x) { Object.assign(x, patch); });
      renderCanvas();
      changed(true);
    }

    // ======== 幻灯片 ========
    function goto(i) {
      endEdit();
      i = Math.max(0, Math.min(deck.slides.length - 1, i));
      if (i === cur) return;
      cur = i;
      sel = [];
      navSel = new Set([i]);
      renderNav();
      renderCanvas();
      notesTa.value = slide().notes || "";
      syncSoon();
      doc.refresh();
    }
    function addSlide(layoutId) {
      endEdit();
      var s = KN.newSlide(deck, layoutId || (cur === 0 && deck.slides.length === 1 ? "titleBody" : slide().layout === "title" ? "titleBody" : slide().layout || "titleBody"));
      deck.slides.splice(cur + 1, 0, s);
      cur++;
      navSel = new Set([cur]);
      sel = [];
      renderAll();
      changed();
    }
    function navIndexes() { var arr = Array.from(navSel).filter(function (i) { return i < deck.slides.length; }); if (!arr.length) arr = [cur]; return arr.sort(function (a, b) { return a - b; }); }
    function duplicateSlides() {
      var idx = navIndexes(), copies = idx.map(function (i) { var c = JSON.parse(JSON.stringify(deck.slides[i])); c.id = KN.newId(); c.items.forEach(function (x) { x.id = KN.newId(); }); return c; });
      var at = idx[idx.length - 1] + 1;
      Array.prototype.splice.apply(deck.slides, [at, 0].concat(copies));
      cur = at;
      navSel = new Set(copies.map(function (c, k) { return at + k; }));
      renderAll();
      changed();
    }
    function deleteSlides() {
      var idx = navIndexes();
      if (idx.length >= deck.slides.length) { deck.slides = [KN.newSlide(deck, "title")]; cur = 0; }
      else { idx.slice().reverse().forEach(function (i) { deck.slides.splice(i, 1); }); cur = Math.min(idx[0], deck.slides.length - 1); }
      navSel = new Set([cur]);
      sel = [];
      renderAll();
      changed();
    }
    function toggleSkip() { var idx = navIndexes(), on = !deck.slides[idx[0]].hidden; idx.forEach(function (i) { deck.slides[i].hidden = on; }); renderNav(); changed(); }
    function moveSlides(to) {
      var idx = navIndexes(), picked = idx.map(function (i) { return deck.slides[i]; }), rest = deck.slides.filter(function (s, i) { return idx.indexOf(i) < 0; });
      var before = idx.filter(function (i) { return i < to; }).length, at = Math.max(0, Math.min(rest.length, to - before));
      Array.prototype.splice.apply(rest, [at, 0].concat(picked));
      deck.slides = rest;
      cur = at + picked.indexOf(slide() || picked[0]);
      cur = Math.max(0, Math.min(deck.slides.length - 1, at));
      navSel = new Set(picked.map(function (p, k) { return at + k; }));
      renderAll();
      changed();
    }
    function applyLayout(id) {
      var s = slide(), L = KN.LAYOUTS.find(function (l) { return l.id === id; });
      if (!L) return;
      var fresh = L.make(deck.w, deck.h), keep = [];
      fresh.forEach(function (f) {
        var old = s.items.find(function (x) { return x.ph === f.ph; });
        if (old) { Object.assign(old, { x: f.x, y: f.y, w: f.w, h: f.h }); old.font = Object.assign({}, f.font, { color: old.font && old.font.color, family: old.font && old.font.family }); keep.push(old); }
        else keep.push(Object.assign({ id: KN.newId(), rot: 0 }, f));
      });
      // 新版式里没有、而且是空的占位符：去掉；有内容的留着变成普通文本框
      s.items = s.items.filter(function (x) { return !x.ph || keep.indexOf(x) >= 0 || (x.html && x.html.replace(/<[^>]+>/g, "").trim() && (delete x.ph, true)); });
      keep.forEach(function (k) { if (s.items.indexOf(k) < 0) s.items.push(k); });
      s.layout = id;
      renderAll();
      changed();
    }
    function applyTheme(id) {
      deck.theme = id;
      deck.slides.forEach(function (s) { s.bg = null; s.items.forEach(function (x) { if (x.font && x.type === "text") x.font.color = null; }); });
      renderAll();
      changed();
      buildInsp();
    }
    function setRatio(r) {
      var nw = r === "4:3" ? 1440 : 1920;
      if (nw === deck.w) return;
      var k = nw / deck.w;
      deck.slides.forEach(function (s) { s.items.forEach(function (x) { x.x = Math.round(x.x * k); x.w = Math.round(x.w * k); }); });
      deck.w = nw;
      renderAll();
      changed();
      buildInsp();
    }

    // ======== 导航：点、⇧ / ⌘ 多选、拖动换位置、右键 ========
    nav.addEventListener("pointerdown", function (e) {
      var t = e.target.closest(".kn-th");
      if (!t || e.button !== 0) return;
      var i = +t.dataset.i;
      if (e.shiftKey) { var a = Math.min(cur, i), b = Math.max(cur, i); navSel = new Set(); for (var k = a; k <= b; k++) navSel.add(k); renderNav(); return; }
      if (e.metaKey || e.ctrlKey) { if (navSel.has(i)) navSel.delete(i); else navSel.add(i); renderNav(); return; }
      if (!navSel.has(i) || navSel.size <= 1) { navSel = new Set([i]); goto(i); if (i === cur) renderNav(); }
      nav.focus({ preventScroll: true });
      // 拖动
      var y0 = e.clientY, dragging = false, ghost = null, drop = null;
      var mv = function (ev) {
        if (!dragging && Math.abs(ev.clientY - y0) < 6) return;
        if (!dragging) { dragging = true; ghost = el("div", "kn-drop"); nav.appendChild(ghost); }
        var ths = Array.prototype.slice.call(nav.querySelectorAll(".kn-th")), to = ths.length;
        for (var k = 0; k < ths.length; k++) { var r = ths[k].getBoundingClientRect(); if (ev.clientY < r.top + r.height / 2) { to = k; break; } }
        drop = to;
        var ref = ths[to] ? ths[to].getBoundingClientRect() : ths[ths.length - 1].getBoundingClientRect(), nr = nav.getBoundingClientRect();
        ghost.style.top = (ths[to] ? ref.top - 4 : ref.bottom + 2) - nr.top + nav.scrollTop + "px";
      };
      var up = function () {
        document.removeEventListener("pointermove", mv);
        document.removeEventListener("pointerup", up);
        if (ghost) ghost.remove();
        if (dragging && drop != null) moveSlides(drop);
      };
      document.addEventListener("pointermove", mv);
      document.addEventListener("pointerup", up);
    });
    nav.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      var t = e.target.closest(".kn-th");
      if (t && !navSel.has(+t.dataset.i)) { navSel = new Set([+t.dataset.i]); goto(+t.dataset.i); }
      ui.menuAt(slideMenuItems(), e.clientX, e.clientY);
    });
    nav.addEventListener("keydown", function (e) {
      var mod = e.metaKey || e.ctrlKey;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); goto(cur + (e.key === "ArrowDown" ? 1 : -1)); navSel = new Set([cur]); renderNav(); }
      else if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); deleteSlides(); }
      else if (mod && e.code === "KeyD") { e.preventDefault(); duplicateSlides(); }
      else if (e.key === "Enter") { e.preventDefault(); addSlide(); }
      else if (mod && e.code === "KeyZ") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    });
    function slideMenuItems() {
      var s = slide();
      return [
        it("新建幻灯片", "⇧⌘N", function () { addSlide(); }),
        it("复制幻灯片", "⌘D", duplicateSlides),
        it("删除幻灯片", "⌫", deleteSlides),
        SEP,
        it(s.hidden ? "不跳过幻灯片" : "跳过幻灯片", "", toggleSkip),
        it("版式", "", null, { items: KN.LAYOUTS.map(function (l) { return it(l.name, "", function () { applyLayout(l.id); }, { checked: s.layout === l.id }); }) }),
        SEP,
        it("从这张开始放映", "", function () { play(cur); }),
      ];
    }

    // ======== 键盘（画布）========
    stage.addEventListener("keydown", function (e) {
      if (editing || e.isComposing) return;
      var mod = e.metaKey || e.ctrlKey, k = e.key, step = e.shiftKey ? 10 : 1;
      var handled = true;
      if (k === "ArrowLeft" && sel.length) nudge(-step, 0);
      else if (k === "ArrowRight" && sel.length) nudge(step, 0);
      else if (k === "ArrowUp" && sel.length) nudge(0, -step);
      else if (k === "ArrowDown" && sel.length) nudge(0, step);
      else if ((k === "ArrowRight" || k === "ArrowDown" || k === "PageDown") && !sel.length) goto(cur + 1);
      else if ((k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp") && !sel.length) goto(cur - 1);
      else if ((k === "Backspace" || k === "Delete") && sel.length) deleteSel();
      else if (k === "Escape") setSel([]);
      else if ((k === "Enter" || k === "F2") && sel.length === 1) { var item = findItem(sel[0]); if (item && item.type !== "image") beginEdit(item, null); }
      else if (mod && !e.altKey && e.code === "KeyZ") { if (e.shiftKey) redo(); else undo(); }
      else if (mod && e.code === "KeyA") setSel(slide().items.map(function (x) { return x.id; }));
      else if (mod && e.code === "KeyD") duplicateSel();
      else if (mod && e.altKey && e.code === "KeyP") play(cur);
      else if (mod && e.shiftKey && e.code === "KeyN") addSlide();
      else if (mod && e.altKey && e.code === "KeyI") doc.showInspector();
      else if (!mod && sel.length === 1 && k.length === 1 && !e.altKey) { var it0 = findItem(sel[0]); if (it0 && it0.type !== "image" && it0.shape !== "line" && it0.shape !== "arrowLine") { beginEdit(it0, null); var inner = scaleEl.querySelector('[data-id="' + it0.id + '"] .kn-tin'); if (inner) { var r = document.createRange(); r.selectNodeContents(inner); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } handled = false; } else handled = false; }
      else handled = false;
      if (handled) e.preventDefault();
    });
    // 拷贝 / 粘贴对象（窗口之间共用；也往系统剪贴板放文字）
    stage.addEventListener("copy", function (e) { if (editing || !sel.length) return; putClip(e, false); });
    stage.addEventListener("cut", function (e) { if (editing || !sel.length) return; putClip(e, true); });
    stage.addEventListener("paste", function (e) {
      if (editing) return;
      var dt = e.clipboardData;
      e.preventDefault();
      var files = Array.prototype.filter.call(dt.files || [], function (f) { return /^image\//.test(f.type); });
      if (files.length) { files.forEach(function (f) { f.arrayBuffer().then(function (b) { addImageBytes(new Uint8Array(b), f.type); }); }); return; }
      var text = dt.getData("text/plain");
      if (window.__knClip && text === window.__knClip.text) {
        var copies = window.__knClip.items.map(function (x) { var c = JSON.parse(JSON.stringify(x)); c.id = KN.newId(); c.x += window.__knClip.deck === deck && !window.__knClip.cut ? 30 : 0; c.y += window.__knClip.deck === deck && !window.__knClip.cut ? 30 : 0; delete c.ph; if (c.src && window.__knClip.deck !== deck) { var im = window.__knClip.deck.images.get(c.src); if (im) c.src = deck.images.add(im.bytes, im.mime); } return c; });
        copies.forEach(function (c) { slide().items.push(c); });
        window.__knClip.cut = false;
        renderCanvas();
        setSel(copies.map(function (c) { return c.id; }));
        changed();
        return;
      }
      if (text) { var t = addItem({ type: "text", x: deck.w / 2 - 400, y: deck.h / 2 - 60, w: 800, h: 120, html: text.split(/\r?\n/).map(function (l) { return "<p>" + (esc(l) || "<br>") + "</p>"; }).join(""), font: { size: 28, align: "left", valign: "top" } }); }
    });
    function putClip(e, cut) {
      var items = sel.map(findItem).filter(Boolean), text = items.map(function (x) { var b = document.createElement("div"); b.innerHTML = x.html || ""; return b.textContent; }).filter(Boolean).join("\n") || "［" + items.length + " 个对象］";
      window.__knClip = { items: JSON.parse(JSON.stringify(items)), text: text, deck: deck, cut: cut };
      e.clipboardData.setData("text/plain", text);
      e.preventDefault();
      if (cut) deleteSel();
    }
    stage.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      var ie = e.target.closest && e.target.closest(".kn-it");
      if (ie && sel.indexOf(ie.dataset.id) < 0) setSel([ie.dataset.id]);
      var items = sel.length ? [
        it("剪切", "⌘X", function () { stage.focus(); document.execCommand("cut"); }), it("拷贝", "⌘C", function () { stage.focus(); document.execCommand("copy"); }), it("复制", "⌘D", duplicateSel), it("删除", "⌫", deleteSel),
        SEP, it("置于顶层", "", function () { order("front"); }), it("上移一层", "", function () { order("up"); }), it("下移一层", "", function () { order("down"); }), it("置于底层", "", function () { order("back"); }),
      ] : [it("粘贴", "⌘V", function () { stage.focus(); if (window.__knClip) { var ev = new ClipboardEvent("paste", { clipboardData: new DataTransfer() }); try { ev.clipboardData.setData("text/plain", window.__knClip.text); } catch (x) { /* 旧浏览器 */ } stage.dispatchEvent(ev); } }), SEP, it("新建幻灯片", "", function () { addSlide(); }), it("版式", "", null, { items: KN.LAYOUTS.map(function (l) { return it(l.name, "", function () { applyLayout(l.id); }); }) })];
      ui.menuAt(items, e.clientX, e.clientY);
    });
    stage.addEventListener("dragover", function (e) { if (e.dataTransfer && Array.prototype.some.call(e.dataTransfer.items || [], function (x) { return x.kind === "file"; })) e.preventDefault(); });
    stage.addEventListener("drop", function (e) {
      var files = Array.prototype.filter.call(e.dataTransfer && e.dataTransfer.files || [], function (f) { return /^image\//.test(f.type); });
      if (!files.length) return;
      e.preventDefault();
      files.forEach(function (f) { f.arrayBuffer().then(function (b) { addImageBytes(new Uint8Array(b), f.type); }); });
    });
    notesTa.addEventListener("input", function () { slide().notes = notesTa.value; changed(true); });
    notesTa.addEventListener("keydown", function (e) { e.stopPropagation(); });

    // ======== 放映 ========
    function play(from, presenter) {
      endEdit();
      var order = deck.slides.map(function (s, i) { return i; }).filter(function (i) { return !deck.slides[i].hidden; });
      if (!order.length) return;
      var pos = Math.max(0, order.indexOf(from)), started = Date.now(), typed = "", blank = null, cursorT = 0, pres = !!presenter;
      var pv = el("div", "kn-play");
      pv.innerHTML = '<div class="kn-pstage"></div><div class="kn-pres" hidden><div class="kn-pres-top"><span class="kn-clock"></span><span class="kn-timer"></span><span class="kn-pnum"></span></div><div class="kn-pres-cur"></div><div class="kn-pres-side"><div class="kn-pres-next"></div><div class="kn-pres-notes"></div></div></div><div class="kn-blank" hidden></div><div class="kn-phint"></div>';
      document.body.appendChild(pv);
      var pstage = pv.querySelector(".kn-pstage"), presEl = pv.querySelector(".kn-pres"), blankEl = pv.querySelector(".kn-blank");
      // 手机上（html.ios）没有键盘：轻点 / 往左划下一张，往右划上一张，往下划结束
      var touchUI = document.documentElement.classList.contains("ios");
      pv.querySelector(".kn-phint").textContent = touchUI ? "轻点或往左划：下一张 · 往右划：上一张 · 往下划：结束" : "← → 翻页 · B 黑屏 · W 白屏 · P 演讲者视图 · Esc 结束";
      pv.style.touchAction = "none";
      if (pv.requestFullscreen) pv.requestFullscreen().catch(function () {});
      var fitSlide = function (box, w, h) { var s = Math.min(w / deck.w, h / deck.h), r = renderSlide(deck, deck.slides[box.i], {}); r.style.transform = "scale(" + s + ")"; r.style.transformOrigin = "0 0"; var f = el("div", "kn-pframe"); f.style.width = deck.w * s + "px"; f.style.height = deck.h * s + "px"; f.appendChild(r); return f; };
      function show(dir) {
        var i = order[pos], s = deck.slides[i];
        if (pres) { renderPresenter(); return; }
        var f = fitSlide({ i: i }, window.innerWidth, window.innerHeight), tr = dir ? s.trans || { type: "none" } : { type: "none" };
        if (dir < 0) tr = { type: tr.type === "push" || tr.type === "move" ? tr.type : tr.type, dur: tr.dur, back: true };
        f.style.animationDuration = (tr.dur || 0.6) + "s";
        if (tr.type && tr.type !== "none") f.classList.add("kn-t-" + tr.type + (dir < 0 ? "-back" : ""));
        var olds = Array.prototype.slice.call(pstage.children);
        pstage.appendChild(f);
        setTimeout(function () { olds.forEach(function (o) { o.remove(); }); }, tr.type && tr.type !== "none" ? (tr.dur || 0.6) * 1000 + 50 : 0);
      }
      function renderPresenter() {
        presEl.hidden = false;
        pstage.hidden = true;
        var curBox = presEl.querySelector(".kn-pres-cur"), nextBox = presEl.querySelector(".kn-pres-next"), notes = presEl.querySelector(".kn-pres-notes");
        curBox.textContent = "";
        nextBox.textContent = "";
        curBox.appendChild(fitSlide({ i: order[pos] }, curBox.clientWidth || window.innerWidth * 0.62, curBox.clientHeight || window.innerHeight * 0.7));
        if (pos + 1 < order.length) nextBox.appendChild(fitSlide({ i: order[pos + 1] }, nextBox.clientWidth || window.innerWidth * 0.3, nextBox.clientHeight || window.innerHeight * 0.3));
        else nextBox.appendChild(el("div", "kn-pend", "放映结束"));
        notes.textContent = deck.slides[order[pos]].notes || "（这张幻灯片没有注释）";
        presEl.querySelector(".kn-pnum").textContent = (pos + 1) + " / " + order.length;
      }
      var tick = setInterval(function () {
        var d = new Date(), el2 = Math.floor((Date.now() - started) / 1000);
        var two = function (x) { return (x < 10 ? "0" : "") + x; };
        pv.querySelector(".kn-clock").textContent = two(d.getHours()) + ":" + two(d.getMinutes());
        pv.querySelector(".kn-timer").textContent = two(Math.floor(el2 / 3600)) + ":" + two(Math.floor(el2 / 60) % 60) + ":" + two(el2 % 60);
      }, 500);
      function go(d) {
        if (blank) { blank = null; blankEl.hidden = true; return; }
        var n = pos + d;
        if (n >= order.length) { if (pres) return; end(); return; }
        if (n < 0) return;
        pos = n;
        show(d);
      }
      function key(e) {
        e.preventDefault();
        e.stopPropagation();
        var k = e.key;
        if (k === "Escape") return end();
        if (/^[0-9]$/.test(k)) { typed += k; return; }
        if (k === "Enter" && typed) { var n = Math.max(1, Math.min(order.length, +typed)) - 1; typed = ""; pos = n; show(0); return; }
        typed = "";
        if (k === "ArrowRight" || k === "ArrowDown" || k === " " || k === "PageDown" || k === "Enter" || k === "n") go(1);
        else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp" || k === "Backspace" || k === "p" && false) go(-1);
        else if (k === "Home") { pos = 0; show(0); }
        else if (k === "End") { pos = order.length - 1; show(0); }
        else if (k === "b" || k === "B" || k === "w" || k === "W") { var c = /b/i.test(k) ? "#000" : "#fff"; if (blank === c) { blank = null; blankEl.hidden = true; } else { blank = c; blankEl.style.background = c; blankEl.hidden = false; } }
        else if (k === "p" || k === "P") { pres = !pres; if (pres) renderPresenter(); else { presEl.hidden = true; pstage.hidden = false; show(0); } }
      }
      var swipe0 = null, swiped = 0;
      pv.addEventListener("pointerdown", function (e) { swipe0 = e.pointerType === "touch" ? { x: e.clientX, y: e.clientY } : null; });
      pv.addEventListener("pointerup", function (e) {
        if (!swipe0) return;
        var dx = e.clientX - swipe0.x, dy = e.clientY - swipe0.y;
        swipe0 = null;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 40) return;
        swiped = Date.now();
        if (Math.abs(dy) > Math.abs(dx)) { if (dy > 0) end(); } else go(dx < 0 ? 1 : -1);
      });
      function click(e) { if (Date.now() - swiped < 500) return; if (e.button === 0 && !pres) go(1); }
      function ctx(e) { e.preventDefault(); go(-1); }
      function moved() { pv.classList.remove("nocursor"); clearTimeout(cursorT); cursorT = setTimeout(function () { pv.classList.add("nocursor"); }, 2000); }
      function fsChange() { if (!document.fullscreenElement && pv.isConnected && pv.dataset.fs) end(); if (document.fullscreenElement === pv) pv.dataset.fs = "1"; }
      function resize() { if (pres) renderPresenter(); else show(0); }
      function end() {
        clearInterval(tick);
        clearTimeout(cursorT);
        document.removeEventListener("keydown", key, true);
        document.removeEventListener("fullscreenchange", fsChange);
        window.removeEventListener("resize", resize);
        if (document.fullscreenElement === pv && document.exitFullscreen) document.exitFullscreen().catch(function () {});
        pv.remove();
        goto(order[pos]);
        stage.focus({ preventScroll: true });
        view._playing = null;
      }
      document.addEventListener("keydown", key, true);
      document.addEventListener("fullscreenchange", fsChange);
      window.addEventListener("resize", resize);
      pv.addEventListener("click", click);
      pv.addEventListener("contextmenu", ctx);
      pv.addEventListener("mousemove", moved);
      moved();
      if (pres) renderPresenter(); else show(0);
      view._playing = { next: function () { go(1); }, prev: function () { go(-1); }, end: end, pos: function () { return order[pos]; }, el: pv };
    }

    // ======== 检查器 ========
    var insp = el("div", "kn-insp"), tabs = el("div", "ofc-tabs"), body = el("div", "ofc-insp-body"), C = {};
    insp.appendChild(tabs);
    insp.appendChild(body);
    tabs.addEventListener("mousedown", function (e) { e.preventDefault(); });
    tabs.addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) { inspTab = b.dataset.t; buildInsp(); } });
    function showInsp(mode) {
      if (doc.inspectorOn() && inspMode === mode) { doc.showInspector(false); return; }
      inspMode = mode;
      inspTab = null;
      buildInsp();
      doc.showInspector(true);
    }
    function tabList() {
      if (inspMode === "doc") return [["theme", "主题"], ["deck", "设置"]];
      var items = sel.map(findItem).filter(Boolean);
      if (!items.length) return [["slide", "幻灯片"]];
      if (items.length > 1) return [["arrange", "排列"]].concat(items.every(function (x) { return x.type !== "image"; }) ? [["text", "文本"]] : []);
      var x = items[0];
      if (x.type === "image") return [["image", "图像"], ["arrange", "排列"]];
      if (x.type === "shape") return x.shape === "line" || x.shape === "arrowLine" ? [["style", "样式"], ["arrange", "排列"]] : [["style", "样式"], ["text", "文本"], ["arrange", "排列"]];
      return [["text", "文本"], ["arrange", "排列"]];
    }
    var lastTabsSig = "";
    function buildInsp() {
      var list = tabList();
      if (!inspTab || !list.some(function (x) { return x[0] === inspTab; })) inspTab = list[0][0];
      lastTabsSig = list.map(function (x) { return x[0]; }).join(",");
      tabs.innerHTML = list.map(function (x) { return '<button type="button" data-t="' + x[0] + '" class="' + (x[0] === inspTab ? "on" : "") + '">' + x[1] + "</button>"; }).join("");
      body.textContent = "";
      C = {};
      var Sx = ui.section, R = ui.row, s = slide();
      if (inspTab === "slide") {
        var a = Sx("版式");
        C.layout = ui.select(KN.LAYOUTS.map(function (l) { return { v: l.id, label: l.name }; }), s.layout, function (v) { applyLayout(v); });
        a.appendChild(C.layout);
        body.appendChild(a);
        var b = Sx("背景");
        var bgKind = s.bg ? (s.bg.image ? "image" : s.bg.grad ? "grad" : "color") : "theme";
        C.bgKind = ui.select([{ v: "theme", label: "主题背景" }, { v: "color", label: "颜色填充" }, { v: "grad", label: "渐变填充" }, { v: "image", label: "图片" }], bgKind, function (v) {
          var t = KN.theme(deck.theme);
          if (v === "theme") s.bg = null;
          else if (v === "color") s.bg = { color: s.bg && s.bg.color || t.bg };
          else if (v === "grad") s.bg = { grad: s.bg && s.bg.grad || [t.bg, t.bg2 || "#d0d0d0"] };
          else { O.upload("image/*").then(function (f) { if (!f) return; s.bg = { image: deck.images.add(f.bytes, KN.mimeOf(f.name)) }; renderAll(); changed(); buildInsp(); }); return; }
          renderAll(); changed(); buildInsp();
        });
        b.appendChild(C.bgKind);
        if (bgKind === "color") b.appendChild(R("颜色", ui.color(s.bg.color, function (v) { s.bg = { color: v || "#ffffff" }; renderAll(); changed(); })));
        if (bgKind === "grad") {
          b.appendChild(R("起始", ui.color(s.bg.grad[0], function (v) { s.bg = { grad: [v || "#ffffff", s.bg.grad[1]] }; renderAll(); changed(); })));
          b.appendChild(R("结束", ui.color(s.bg.grad[1], function (v) { s.bg = { grad: [s.bg.grad[0], v || "#ffffff"] }; renderAll(); changed(); })));
        }
        body.appendChild(b);
        var c = Sx("切换效果");
        C.trans = ui.select(TRANS, (s.trans || {}).type || "none", function (v) { s.trans = Object.assign({ dur: 0.6 }, s.trans || {}, { type: v }); changed(); });
        c.appendChild(C.trans);
        C.dur = ui.stepper((s.trans || {}).dur || 0.6, { min: 0.1, max: 5, step: 0.1, digits: 1, unit: " 秒", width: 88 }, function (v) { s.trans = Object.assign({ type: "fade" }, s.trans || {}, { dur: v }); changed(true); });
        c.appendChild(R("时长", C.dur));
        var row = el("div", "ofc-btnrow");
        row.appendChild(ui.button("应用到所有幻灯片", function () { var tr = Object.assign({}, s.trans); deck.slides.forEach(function (x) { x.trans = Object.assign({}, tr); }); changed(); O.toast(doc, "已应用到 " + deck.slides.length + " 张幻灯片"); }));
        row.appendChild(ui.button("预览", function () { play(cur); }));
        c.appendChild(row);
        body.appendChild(c);
        var d = Sx("放映");
        d.appendChild(ui.check("跳过这张幻灯片", !!s.hidden, function (v) { s.hidden = v; renderNav(); changed(); }));
        body.appendChild(d);
      } else if (inspTab === "text") {
        var items = sel.map(findItem).filter(Boolean), x = items[0], f = x.font || {}, t = KN.theme(deck.theme);
        var s1 = Sx("字体");
        C.family = ui.select(FONTS.map(function (q) { return { v: q[0], label: q[1] }; }), f.family || "", function (v) { setFont({ family: v || null }, true); });
        s1.appendChild(C.family);
        C.size = ui.stepper(f.size || 24, { min: 6, max: 400, step: 2, digits: 0, unit: " 磅", width: 88 }, function (v) { setFont({ size: v }); });
        C.bi = ui.seg([{ v: "bold", label: "B", tip: "粗体", style: "font-weight:700" }, { v: "italic", label: "I", tip: "斜体", style: "font-style:italic;font-family:Georgia,serif" }], { bold: f.bold, italic: f.italic }, function (v, on) { var p = {}; p[v] = on; setFont(p, true); }, { multi: true });
        s1.appendChild(R(null, C.bi, C.size));
        C.color = ui.color(f.color || null, function (v) { setFont({ color: v }); }, { auto: "主题颜色" });
        s1.appendChild(R("颜色", C.color));
        body.appendChild(s1);
        var s2 = Sx("对齐");
        var aIcon = function (lines) { return '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">' + lines + "</svg>"; };
        C.align = ui.seg([{ v: "left", icon: aIcon('<path d="M3 5h14M3 9h9M3 13h14M3 17h9"/>'), tip: "靠左" }, { v: "center", icon: aIcon('<path d="M3 5h14M5.5 9h9M3 13h14M5.5 17h9"/>'), tip: "居中" }, { v: "right", icon: aIcon('<path d="M3 5h14M8 9h9M3 13h14M8 17h9"/>'), tip: "靠右" }, { v: "justify", icon: aIcon('<path d="M3 5h14M3 9h14M3 13h14M3 17h14"/>'), tip: "两端对齐" }], f.align || (x.type === "shape" ? "center" : "left"), function (v) { setFont({ align: v }, true); });
        s2.appendChild(C.align);
        C.valign = ui.seg([{ v: "top", label: "顶部" }, { v: "middle", label: "居中" }, { v: "bottom", label: "底部" }], f.valign || (x.type === "shape" ? "middle" : "top"), function (v) { setFont({ valign: v }, true); });
        s2.appendChild(R("垂直", C.valign));
        C.line = ui.stepper(f.line || (x.ph === "title" ? 1.1 : 1.25), { min: 0.8, max: 3, step: 0.05, digits: 2, unit: " 倍", width: 88 }, function (v) { setFont({ line: v }, true); });
        s2.appendChild(R("行距", C.line));
        body.appendChild(s2);
        var s3 = Sx("项目符号与编号");
        C.list = ui.select([{ v: "", label: "无" }, { v: "bullet", label: "• 项目符号" }, { v: "number", label: "1. 编号" }], x.list || "", function (v) { setFont({ list: v || null }, true); });
        s3.appendChild(C.list);
        body.appendChild(s3);
      } else if (inspTab === "style") {
        var sh = findItem(sel[0]), line = sh.shape === "line" || sh.shape === "arrowLine";
        var st = Sx(line ? "线条" : "填充与边框");
        if (!line) st.appendChild(R("填充", ui.color(sh.fill || null, function (v) { setProp({ fill: v }); }, { none: "无填充" })));
        st.appendChild(R(line ? "颜色" : "边框", ui.color(sh.stroke || null, function (v) { setProp({ stroke: v, strokeW: v ? sh.strokeW || 4 : 0 }); }, line ? {} : { none: "无边框" })));
        st.appendChild(R("粗细", ui.stepper(sh.strokeW || 0, { min: 0, max: 60, step: 1, digits: 0, unit: " 点", width: 88 }, function (v) { setProp({ strokeW: v }); })));
        if (sh.shape === "roundRect") st.appendChild(R("圆角", ui.stepper(sh.radius || Math.round(Math.min(sh.w, sh.h) * 0.18), { min: 0, max: 500, step: 4, digits: 0, width: 88 }, function (v) { setProp({ radius: v }); })));
        st.appendChild(R("不透明度", ui.stepper(Math.round((sh.opacity == null ? 1 : sh.opacity) * 100), { min: 0, max: 100, step: 5, digits: 0, unit: "%", width: 88 }, function (v) { setProp({ opacity: v / 100 }); })));
        body.appendChild(st);
        var kinds = Sx("形状");
        kinds.appendChild(ui.select(KN.SHAPES.map(function (q) { return { v: q.id, label: q.name }; }), sh.shape, function (v) { setProp({ shape: v }); }));
        body.appendChild(kinds);
      } else if (inspTab === "image") {
        var im = findItem(sel[0]), si = Sx("图像");
        si.appendChild(R("不透明度", ui.stepper(Math.round((im.opacity == null ? 1 : im.opacity) * 100), { min: 0, max: 100, step: 5, digits: 0, unit: "%", width: 88 }, function (v) { setProp({ opacity: v / 100 }); })));
        var rw = el("div", "ofc-btnrow");
        rw.appendChild(ui.button("替换…", function () { replaceImage(im); }));
        rw.appendChild(ui.button("原始比例", function () { var i2 = new Image(); i2.onload = function () { var r = i2.naturalHeight / i2.naturalWidth; im.h = Math.round(im.w * r); renderCanvas(); changed(); }; i2.src = im.src; }));
        si.appendChild(rw);
        body.appendChild(si);
      } else if (inspTab === "arrange") {
        var items2 = sel.map(findItem).filter(Boolean), one = items2.length === 1 ? items2[0] : null, ar = Sx(one ? "位置与大小" : "对齐");
        if (one) {
          [["x", "X"], ["y", "Y"], ["w", "宽"], ["h", "高"]].forEach(function (q) { ar.appendChild(R(q[1], ui.stepper(Math.round(one[q[0]]), { min: q[0] === "w" || q[0] === "h" ? 1 : -5000, max: 10000, step: 1, digits: 0, unit: " 点", width: 96 }, function (v) { var p = {}; p[q[0]] = v; setProp(p); }))); });
          ar.appendChild(R("旋转", ui.stepper(Math.round(one.rot || 0), { min: 0, max: 359, step: 1, digits: 0, unit: "°", width: 96 }, function (v) { setProp({ rot: ((v % 360) + 360) % 360 }); })));
        }
        body.appendChild(ar);
        var al = Sx(one ? "在幻灯片上对齐" : "对齐与分布");
        var b1 = el("div", "ofc-btnrow");
        [["left", "左"], ["hcenter", "水平居中"], ["right", "右"], ["top", "上"], ["vcenter", "垂直居中"], ["bottom", "下"]].forEach(function (q) { b1.appendChild(ui.button(q[1], function () { alignSel(q[0]); })); });
        if (!one) { b1.appendChild(ui.button("水平分布", function () { alignSel("hdist"); })); b1.appendChild(ui.button("垂直分布", function () { alignSel("vdist"); })); }
        al.appendChild(b1);
        body.appendChild(al);
        var od = Sx("层次");
        var b2 = el("div", "ofc-btnrow");
        [["front", "置于顶层"], ["up", "上移一层"], ["down", "下移一层"], ["back", "置于底层"]].forEach(function (q) { b2.appendChild(ui.button(q[1], function () { order(q[0]); })); });
        od.appendChild(b2);
        body.appendChild(od);
      } else if (inspTab === "theme") {
        var th = Sx("主题（会改掉所有幻灯片的背景和文字颜色）");
        var grid = el("div", "kn-themes");
        KN.THEMES.forEach(function (tt) {
          var card = el("button", "kn-themecard" + (tt.id === deck.theme ? " on" : ""), '<span class="kn-tprev" style="background:' + (tt.bg2 ? "linear-gradient(135deg," + tt.bg + "," + tt.bg2 + ")" : tt.bg) + '"><b style="color:' + tt.title + '">标题</b><i style="background:' + tt.accent + '"></i></span><span>' + esc(tt.name) + "</span>");
          card.type = "button";
          card.addEventListener("click", function () { applyTheme(tt.id); });
          grid.appendChild(card);
        });
        th.appendChild(grid);
        body.appendChild(th);
      } else if (inspTab === "deck") {
        var sz = Sx("幻灯片大小");
        sz.appendChild(ui.seg([{ v: "16:9", label: "宽屏 16:9" }, { v: "4:3", label: "标准 4:3" }], deck.w === 1440 ? "4:3" : "16:9", function (v) { setRatio(v); }));
        body.appendChild(sz);
        var inf = Sx("统计");
        inf.appendChild(el("div", "ofc-note", deck.slides.length + " 张幻灯片" + (deck.slides.some(function (s2) { return s2.hidden; }) ? "（跳过 " + deck.slides.filter(function (s2) { return s2.hidden; }).length + " 张）" : "") + "；放映快捷键：⌥⌘P"));
        body.appendChild(inf);
      }
    }
    var syncT = 0;
    function syncSoon() { clearTimeout(syncT); syncT = setTimeout(function () { if (doc.inspectorOn()) { var sig = tabList().map(function (x) { return x[0]; }).join(","); buildInsp(); } doc.refresh(); }, 60); }

    // ======== 工具栏、菜单 ========
    function layoutItems() { return KN.LAYOUTS.map(function (l) { return it(l.name, "", function () { addSlide(l.id); }); }); }
    function shapeItems() { return KN.SHAPES.map(function (s) { return it(s.name, "", function () { addShape(s.id); }); }); }
    function zoomItems() {
      return [it("适合窗口", "", function () { autoZoom = true; layout(); doc.refresh(); }, { checked: autoZoom })].concat([0.25, 0.5, 0.75, 1].map(function (z) { return it(Math.round(z * 100) + "%", "", function () { autoZoom = false; zoom = z; layout(); doc.refresh(); }, { checked: !autoZoom && Math.abs(zoom - z) < 0.001 }); }));
    }
    function viewItems() {
      return [
        it("导航器", "", function () { showNav = !showNav; nav.hidden = !showNav; layout(); doc.refresh(); }, { checked: showNav }),
        it("演讲者注释", "", function () { showNotes = !showNotes; localStorage.setItem("tsu-keynote-notes", showNotes ? "on" : "off"); notesBox.hidden = !showNotes; layout(); doc.refresh(); }, { checked: showNotes }),
        SEP,
        it("放映", "⌥⌘P", function () { play(cur); }), it("从头放映", "", function () { play(0); }), it("演讲者视图", "", function () { play(cur, true); }),
        SEP,
        it(doc.inspectorOn() && inspMode === "format" ? "隐藏格式检查器" : "显示格式检查器", "⌥⌘I", function () { showInsp("format"); }),
        it(doc.inspectorOn() && inspMode === "doc" ? "隐藏文稿设置" : "显示文稿设置", "", function () { showInsp("doc"); }),
      ];
    }
    var view = {
      el: root,
      inspector: insp,
      toolbar: [
        { id: "view", label: "显示", icon: "sidebar", menu: viewItems },
        { id: "zoom", label: "缩放", text: function () { return Math.round(zoom * 100) + "%"; }, menu: zoomItems },
        { id: "addslide", label: "添加幻灯片", icon: "addSlide", menu: layoutItems },
        "sep",
        { id: "play", label: "播放", icon: "play", cls: "play", run: function () { play(cur); }, tip: "从这张开始放映（⌥⌘P）" },
        "flex",
        { id: "text", label: "文本", icon: "text", run: addText },
        { id: "shape", label: "形状", icon: "shape", menu: shapeItems },
        { id: "media", label: "媒体", icon: "media", menu: mediaItems },
        "flex",
        { id: "format", label: "格式", icon: "brush", run: function () { showInsp("format"); }, on: function () { return doc.inspectorOn() && inspMode === "format"; } },
        { id: "doc", label: "文稿", icon: "doc", run: function () { showInsp("doc"); }, on: function () { return doc.inspectorOn() && inspMode === "doc"; } },
      ],
      menus: function () {
        return [
          { title: "编辑", items: [
            it("撤销", "⌘Z", undo, { disabled: hist.idx <= 0 }), it("重做", "⇧⌘Z", redo, { disabled: hist.idx >= hist.stack.length - 1 }), SEP,
            it("剪切", "⌘X", function () { stage.focus(); document.execCommand("cut"); }, { disabled: !sel.length }), it("拷贝", "⌘C", function () { stage.focus(); document.execCommand("copy"); }, { disabled: !sel.length }),
            it("复制", "⌘D", duplicateSel), it("删除", "⌫", deleteSel, { disabled: !sel.length }), it("全选", "⌘A", function () { setSel(slide().items.map(function (x) { return x.id; })); }),
          ] },
          { title: "插入", items: [it("文本框", "", addText), it("形状", "", null, { items: shapeItems() }), it("图片", "", null, { items: mediaItems() }), SEP, it("新建幻灯片", "⇧⌘N", null, { items: layoutItems() })] },
          { title: "幻灯片", items: slideMenuItems().concat([SEP, it("放映", "⌥⌘P", function () { play(cur); }), it("从头放映", "", function () { play(0); }), it("演讲者视图", "", function () { play(cur, true); })]) },
          { title: "排列", items: [
            it("置于顶层", "", function () { order("front"); }, { disabled: !sel.length }), it("上移一层", "", function () { order("up"); }, { disabled: !sel.length }), it("下移一层", "", function () { order("down"); }, { disabled: !sel.length }), it("置于底层", "", function () { order("back"); }, { disabled: !sel.length }),
            SEP,
            it("对齐", "", null, { items: [["left", "左对齐"], ["hcenter", "水平居中"], ["right", "右对齐"], ["top", "顶端对齐"], ["vcenter", "垂直居中"], ["bottom", "底端对齐"]].map(function (q) { return it(q[1], "", function () { alignSel(q[0]); }); }) }),
            it("分布", "", null, { items: [it("水平分布", "", function () { alignSel("hdist"); }), it("垂直分布", "", function () { alignSel("vdist"); })] }),
          ] },
          { title: "显示", items: viewItems() },
        ];
      },
      serialize: function (fmt) { endEdit(); if (fmt !== "pptx") throw new Error("讲演只能存成 .pptx"); return KN.writePptx(deck); },
      replace: function (nd) {
        endEdit();
        deck.images.dispose();
        deck = nd;
        deck.images = deck.images || new KN.Images();
        if (!deck.slides.length) deck.slides.push(KN.newSlide(deck, "title"));
        cur = Math.min(cur, deck.slides.length - 1);
        sel = [];
        hist = { stack: [], idx: -1, timer: 0 };
        record();
        renderAll();
        buildInsp();
      },
      // 打印 / 导出 PDF：一张幻灯片一页（横的，7.5 英寸高、宽按幻灯片的比例），跳过的幻灯片不印（同 Keynote 默认）
      printable: function () {
        var list = deck.slides.filter(function (s) { return !s.hidden; });
        if (!list.length) list = deck.slides;
        var H = 720, W = Math.round(H * deck.w / deck.h * 1000) / 1000, k = W / deck.w;
        var pages = list.map(function (s) {
          return '<section class="pp"><div class="pp-c"><div class="pp-s">' + renderSlide(deck, s, {}).outerHTML + "</div></div></section>";
        }).join("");
        // 一页比纸矮 1px（纸的高度换算后可能被取整小一点，免得多出空白页），里面照整张纸画。
        // 缩放用 zoom 不用 transform：分页是按排版的坐标算的，transform 缩小了看着在一页里，排版上还是那么大，跨过页边的图片会被 WebKit 挪到下一页去
        var css = "@page{size:" + W + "px " + H + "px;margin:0}html,body{margin:0;padding:0}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
          ".pp{position:relative;width:" + W + "px;height:" + (H - 1) + "px;break-after:page;page-break-after:always}.pp:last-child{break-after:auto;page-break-after:auto}" +
          ".pp-c{position:absolute;left:0;top:0;width:" + W + "px;height:" + H + "px;overflow:hidden}" +
          ".pp-s{width:" + deck.w + "px;height:" + deck.h + "px;zoom:" + k.toFixed(6) + "}" + slideCSS();
        return { html: pages, css: css, page: [W * 0.75, H * 0.75], margin: 0 };
      },
      focus: function () { stage.focus({ preventScroll: true }); },
      resize: function () { layout(); },
      mounted: function () { renderAll(); record(); notesBox.hidden = !showNotes; buildInsp(); },
      destroy: function () { if (view._playing) view._playing.end(); deck.images.dispose(); ro.disconnect(); },
    };
    // ======== App 的动作（系统命令 numbers / pages / keynote 用）：列幻灯片、加一张、改一张（标题 / 正文 / 备注）；能撤销，界面跟着刷新、跳到那一张 ========
    var plainOf = function (html) { var b = document.createElement("div"); b.innerHTML = html || ""; Array.prototype.forEach.call(b.querySelectorAll("li, p, div, br"), function (x) { x.appendChild(document.createTextNode("\n")); }); return b.textContent.replace(/\n{2,}/g, "\n").trim(); };
    var escT = function (t) { return String(t).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); };
    // 文字 → 文本框里的 HTML：一行一段；正文是项目符号的，一行一条（行首的 - / * / • 去掉）
    function textHtml(item, text) {
      var lines = String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n").filter(function (l, i, a) { return l.trim() || (i > 0 && i < a.length - 1); });
      if (item.list === "bullet" || item.list === "number") { var tag = item.list === "number" ? "ol" : "ul"; return lines.length ? "<" + tag + ">" + lines.map(function (l) { return "<li>" + escT(l.replace(/^\s*([-*•]|\d+[.)])\s+/, "")) + "</li>"; }).join("") + "</" + tag + ">" : ""; }
      return lines.map(function (l) { return "<p>" + escT(l) + "</p>"; }).join("");
    }
    var phOf = function (sl, name) { return sl.items.find(function (x) { return x.ph === name; }); };
    function fill(sl, o) {
      [["title", "title"], ["subtitle", "subtitle"], ["body", "body"], ["body2", "body2"]].forEach(function (k) {
        if (o[k[0]] === undefined) return;
        var it0 = phOf(sl, k[1]);
        if (!it0) throw new Error("this slide's layout (" + sl.layout + ") has no " + k[1] + " box");
        it0.html = textHtml(it0, o[k[0]]);
      });
      if (o.notes !== undefined) sl.notes = String(o.notes);
    }
    view.api = {
      layouts: function () { return KN.LAYOUTS.map(function (l) { return l.id; }); },
      slides: function () {
        return deck.slides.map(function (sl, i) {
          var o = { index: i + 1, layout: sl.layout };
          ["title", "subtitle", "body", "body2"].forEach(function (k) { var it0 = phOf(sl, k); if (it0 && it0.html) o[k] = plainOf(it0.html); });
          if (sl.notes) o.notes = sl.notes;
          if (sl.hidden) o.hidden = true;
          return o;
        });
      },
      // o：{ layout, title, subtitle, body, body2, notes, at（放在第几张，默认最后）}
      addSlide: function (o) {
        endEdit();
        var sl = KN.newSlide(deck, o.layout || "titleBody"), at = o.at ? Math.max(1, Math.min(deck.slides.length + 1, o.at | 0)) : deck.slides.length + 1;
        fill(sl, o);
        deck.slides.splice(at - 1, 0, sl);
        cur = at - 1;
        navSel = new Set([cur]);
        sel = [];
        renderAll();
        changed();
        return at;
      },
      updateSlide: function (index, o) {
        endEdit();
        var sl = deck.slides[(index | 0) - 1];
        if (!sl) throw new Error("no slide " + index + " (the deck has " + deck.slides.length + ")");
        fill(sl, o);
        cur = (index | 0) - 1;
        navSel = new Set([cur]);
        sel = [];
        renderAll();
        changed();
        return index;
      },
    };
    var ro = new ResizeObserver(function () { layout(); });
    ro.observe(stage);
    view._debug = { deck: function () { return deck; }, cur: function () { return cur; }, sel: function () { return sel; }, setSel: setSel, goto: goto, addSlide: addSlide, addText: addText, addShape: addShape, addImageBytes: addImageBytes, beginEdit: beginEdit, endEdit: endEdit, play: play, applyTheme: applyTheme, applyLayout: applyLayout, undo: undo, redo: redo, alignSel: alignSel, order: order, zoom: function () { return zoom; }, findItem: findItem, renderAll: renderAll };
    return view;
  }
  // 印的时候幻灯片内容的 CSS：用编辑器同一套（office.css 里「幻灯片内容」那些规则），读不到就用下面这份
  function slideCSS() {
    var out = "";
    Array.prototype.forEach.call(document.styleSheets, function (sh) {
      var rules = null;
      try { rules = /office\/office\.css/.test(sh.href || "") ? sh.cssRules : null; } catch (e) { rules = null; }
      Array.prototype.forEach.call(rules || [], function (r) { if (r.selectorText && /^\.kn-(sl|it|svg|txt|tin)\b/.test(r.selectorText) && !/editing|stage|sel|prompt/.test(r.selectorText)) out += r.cssText + "\n"; });
    });
    return out || PRINT_CSS;
  }
  // 打印时 .kn-sl 等的样式（iframe 里没有 office.css）
  var PRINT_CSS = ".kn-sl{position:relative;overflow:hidden}.kn-it{position:absolute;box-sizing:border-box}.kn-it img{width:100%;height:100%;display:block}.kn-svg{position:absolute;left:0;top:0;overflow:visible}.kn-txt{position:absolute;inset:0;display:flex;flex-direction:column;padding:6px 12px;box-sizing:border-box;white-space:pre-wrap;overflow-wrap:anywhere}.kn-tin p{margin:0}.kn-tin ul,.kn-tin ol{margin:0;padding-left:1.2em}.kn-list-bullet ul{list-style:disc}";

  // ======== 模板：每个主题一个 ========
  function tplDeck(themeId) {
    var deck = KN.newDeck(themeId, "16:9"), t = KN.theme(themeId);
    deck.images = new KN.Images();
    var s1 = KN.newSlide(deck, "title");
    s1.items[0].html = "<p>演示文稿标题</p>";
    s1.items[1].html = "<p>副标题 · " + new Date().getFullYear() + "</p>";
    var s2 = KN.newSlide(deck, "titleBody");
    s2.items[0].html = "<p>要点</p>";
    s2.items[1].html = "<ul><li>第一点：一句话说清楚</li><li>第二点：给出例子或数据</li><li>第三点：下一步做什么</li></ul>";
    deck.slides = [s1, s2];
    return deck;
  }
  function thumbFor(themeId) {
    var t = KN.theme(themeId);
    return '<div class="knt" style="background:' + (t.bg2 ? "linear-gradient(135deg," + t.bg + "," + t.bg2 + ")" : t.bg) + '"><b style="color:' + t.title + '">演示文稿标题</b><span style="color:' + t.body + '">副标题</span><i style="background:' + t.accent + '"></i></div>';
  }

  O.defineApp({
    id: "keynote", name: "讲演", native: "pptx",
    opens: ["pptx"],
    writes: { pptx: "lossless" },
    saveFormats: [{ ext: "pptx", label: "PowerPoint 演示文稿" }],
    exportFormats: [{ ext: "pptx", label: "PowerPoint" }, { ext: "pdf", label: "PDF" }],
    about: "讲演文件是标准的 PowerPoint 演示文稿（.pptx），可以用 Microsoft PowerPoint、WPS、Keynote 打开。打开别处做的 .pptx 时尽量还原（文字、形状、图片、背景、备注、切换效果），图表、动画、SmartArt 暂时不能显示。agent 可以用 python-pptx 读写同一个文件（标题、正文是真的占位符，slide.shapes.title 能找到）。",
    width: 1180, height: 760,
    templates: KN.THEMES.map(function (t) { return { id: t.id, name: t.name, thumb: thumbFor(t.id) }; }),
    newState: function (tpl) { return tplDeck(tpl || "white"); },
    read: function (u8, ext) { return KN.read(u8, ext); },
    createView: createView,
    // App 的动作（系统命令用，参数说明在 office.js）
    actions: {
      slides: function (doc) {
        var l = doc.view.api.slides(), one = function (x) { return String(x || "").replace(/\s+/g, " ").trim(); };
        return { data: l, text: l.map(function (x) { return x.index + ". [" + x.layout + "]" + (x.hidden ? " (hidden)" : "") + " " + one(x.title || x.subtitle || "(no title)") + (x.body ? " — " + one(x.body).slice(0, 160) : "") + (x.notes ? "  · notes: " + one(x.notes).slice(0, 80) : ""); }).join("\n") || "(no slides)", summary: l.length + " slide" + (l.length > 1 ? "s" : "") };
      },
      addSlide: function (doc, a, h) { h.check(); var i = doc.view.api.addSlide(a); return h.settle().then(function (sv) { return { text: "Added slide " + i + " to " + h.label + sv + ".", summary: "Added slide " + i }; }); },
      updateSlide: function (doc, a, h) { h.check(); var i = doc.view.api.updateSlide(a.index, a); return h.settle().then(function (sv) { return { text: "Updated slide " + i + " of " + h.label + sv + ".", summary: "Updated slide " + i }; }); },
    },
  });
})();
