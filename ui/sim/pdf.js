// pdf.js —— 导出真的 PDF 文件（同 macOS 的「导出为 PDF」），文稿、表格、讲演、备忘录共用。各 App 给出要印的 HTML + CSS：
//   TSU_PDF.render({ title, html, css, page, landscape, margin }) → Promise<Uint8Array>
//     在 Paimon App 里交给原生（nadosNative 的 pdf.render：看不见的 WebKit 排版，macOS 的打印存成 PDF——分页、矢量、文字能选能搜）
//     浏览器里出不了文件：打开打印对话框（只印这份文稿，不是整个桌面），在里面选「存储为 PDF」；这时给 null
//   page：纸 "A4" | "Letter" | "A3" | "A5" | "B5" | "Legal" | [宽, 高]（点，1/72 英寸）；不给就用 CSS 里 @page 的 size，再没有就是 A4。landscape：横过来
//   margin：页边距（点：一个数或 [上, 右, 下, 左]）；不给就用 @page 的 margin，再没有就是 0。CSS 里 1px = 0.75pt（同浏览器的打印）
//   TSU_PDF.save(o)：render 完存成文件 o.path（已经有了就加个号；o.replace 直接替换）、发通知（点一下在访达里显示）→ Promise<存到的路径 | null>
//   TSU_PDF.print(o)：打印——App 里弹 macOS 的打印对话框，浏览器里弹浏览器的
//   TSU_PDF.native：能直接出文件（在 Paimon App 里）
(function () {
  "use strict";
  var N = window.nadosNative && window.nadosNative.call ? window.nadosNative : null;
  var PAPER = { A3: [841.89, 1190.55], A4: [595.28, 841.89], A5: [419.53, 595.28], B5: [498.9, 708.66], LETTER: [612, 792], LEGAL: [612, 1008] };
  var UNIT = { pt: 1, px: 0.75, in: 72, mm: 72 / 25.4, cm: 720 / 25.4, pc: 12, q: 18 / 25.4 };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };

  // ---- 纸和页边距：参数优先，其次 CSS 的 @page（把 @page 拿掉，由这里统一给）----
  function len(v) {
    var m = /^(-?[\d.]+)(px|pt|in|mm|cm|pc|q)?$/i.exec(String(v).trim());
    return m ? parseFloat(m[1]) * UNIT[(m[2] || "px").toLowerCase()] : null;
  }
  function box(v) {
    var a = String(v).trim().split(/\s+/).map(len);
    if (a.some(function (x) { return x == null; })) return null;
    return a.length === 1 ? [a[0], a[0], a[0], a[0]] : a.length === 2 ? [a[0], a[1], a[0], a[1]] : a.length === 3 ? [a[0], a[1], a[2], a[1]] : a.slice(0, 4);
  }
  function sizeOf(v) {
    var dims = [], name = null, orient = null;
    String(v).trim().split(/\s+/).forEach(function (p) {
      var L = len(p);
      if (L != null) dims.push(L);
      else if (/^(portrait|landscape)$/i.test(p)) orient = p.toLowerCase();
      else if (PAPER[p.toUpperCase()]) name = p.toUpperCase();
    });
    var wh = dims.length === 2 ? dims : dims.length === 1 ? [dims[0], dims[0]] : name ? PAPER[name].slice() : orient ? PAPER.A4.slice() : null;
    if (wh && orient && (orient === "landscape") !== (wh[0] > wh[1])) wh.reverse();
    return wh;
  }
  // 找出 @page { … }（里面可以套 @top-center 这种页边框），拿走；没有伪类的那个里的 size、margin 记下来
  function pageRules(css) {
    var out = { css: "", size: null, margin: null }, re = /@page\b/gi, m, last = 0;
    css = String(css || "");
    while ((m = re.exec(css))) {
      var open = css.indexOf("{", m.index), depth = 0, j = open;
      if (open < 0) break;
      for (; j < css.length; j++) { if (css[j] === "{") depth++; else if (css[j] === "}" && --depth === 0) break; }
      if (!css.slice(m.index + 5, open).trim()) {
        css.slice(open + 1, j).replace(/@[\w-]+\s*\{[^{}]*\}/g, "").split(";").forEach(function (d) {
          var i = d.indexOf(":"), k = d.slice(0, i).trim().toLowerCase(), v = d.slice(i + 1).trim();
          if (i < 0) return;
          if (k === "size") out.size = sizeOf(v) || out.size;
          else if (k === "margin") out.margin = box(v) || out.margin;
          else if (/^margin-(top|right|bottom|left)$/.test(k) && len(v) != null) { out.margin = out.margin || [0, 0, 0, 0]; out.margin[["top", "right", "bottom", "left"].indexOf(k.slice(7))] = len(v); }
        });
      }
      out.css += css.slice(last, m.index);
      last = j + 1;
      re.lastIndex = last;
    }
    out.css += css.slice(last);
    return out;
  }
  function layout(o) {
    var r = pageRules(o.css), wh;
    if (Array.isArray(o.page)) wh = o.page.slice(0, 2);
    else if (o.page) wh = sizeOf(o.page);
    wh = (wh || r.size || PAPER.A4).slice();
    if (o.landscape != null && !!o.landscape !== (wh[0] > wh[1])) wh.reverse();
    var m = o.margin != null ? (Array.isArray(o.margin) ? o.margin.slice(0, 4) : [o.margin, o.margin, o.margin, o.margin]) : r.margin || [0, 0, 0, 0];
    m = m.map(function (x) { return Math.max(0, +x || 0); });
    var pt = function (x) { return (+x).toFixed(2) + "pt"; };
    return { w: wh[0], h: wh[1], m: m, css: r.css, rule: "@page{size:" + pt(wh[0]) + " " + pt(wh[1]) + ";margin:" + m.map(pt).join(" ") + "}" };
  }

  // ---- blob: 地址（App 里的图片）只在这个页面里有效：换成 data: 再交出去 ----
  function inline(s) {
    var urls = {};
    String(s).replace(/blob:[^"'()\s<>]+/g, function (u) { urls[u] = 1; return u; });
    var list = Object.keys(urls);
    if (!list.length) return Promise.resolve(s);
    return Promise.all(list.map(function (u) {
      return fetch(u).then(function (r) { return r.blob(); }).then(function (b) {
        return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res([u, fr.result]); }; fr.onerror = function () { res([u, ""]); }; fr.readAsDataURL(b); });
      }, function () { return [u, ""]; });
    })).then(function (pairs) { pairs.forEach(function (p) { s = s.split(p[0]).join(p[1]); }); return s; });
  }
  function bytes(b64) { var s = atob(b64 || ""), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  function unsupported(e) {
    if (e && e.code === "E_UNKNOWN_CMD") { var x = new Error("这个版本的 Paimon 还不能导出 PDF，更新 App 后再试"); x.code = "E_UNSUPPORTED"; throw x; }
    throw e;
  }

  function render(o) {
    o = o || {};
    var L = layout(o);
    if (!N) return printDialog(o, L).then(function () { return null; });
    return Promise.all([inline(o.html || ""), inline(L.css)]).then(function (x) {
      return N.call("pdf.render", { title: o.title || "", html: x[0], css: x[1], width: L.w, height: L.h, margin: L.m });
    }).then(function (r) { return bytes(r && r.b64); }, unsupported);
  }
  function print(o) {
    o = o || {};
    var L = layout(o);
    if (!N) return printDialog(o, L);
    return Promise.all([inline(o.html || ""), inline(L.css)]).then(function (x) {
      return N.call("pdf.render", { title: o.title || "", html: x[0], css: x[1], width: L.w, height: L.h, margin: L.m, print: true });
    }).then(function (r) { return !!(r && r.printed); }, unsupported);
  }

  // ---- 浏览器：藏在屏幕外的 iframe 里只放这份文稿，印它（Safari 的 contentWindow.print() 会印整个页面，用 execCommand）----
  function printDialog(o, L) {
    return new Promise(function (resolve) {
      var fr = document.createElement("iframe");
      fr.setAttribute("aria-hidden", "true");
      fr.tabIndex = -1;
      fr.style.cssText = "position:fixed;left:-12000px;top:0;width:" + Math.round((L.w - L.m[1] - L.m[3]) / 0.75) + "px;height:600px;border:0;opacity:0;pointer-events:none";
      document.body.appendChild(fr);
      var d = fr.contentDocument, w = fr.contentWindow;
      d.open();
      d.write('<!doctype html><html><head><meta charset="utf-8"><title>' + esc(o.title) + "</title><style>" + L.css + L.rule +
        "html{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>" + (o.html || "") + "</body></html>");
      d.close();
      var gone = false;
      var done = function () { if (gone) return; gone = true; setTimeout(function () { fr.remove(); }, 500); resolve(true); };
      var go = function () {
        w.addEventListener("afterprint", done);
        try { w.focus(); } catch (e) { /* 没关系 */ }
        var safari = /Safari\//.test(navigator.userAgent) && !/Chrome\/|Chromium\/|Edg\//.test(navigator.userAgent);
        try { if (!(safari && d.execCommand("print", false, null))) w.print(); } catch (e) { try { w.print(); } catch (e2) { /* 印不了 */ } }
        setTimeout(done, 120000); // 没有 afterprint 的浏览器：两分钟后收走
      };
      var imgs = Array.prototype.slice.call(d.images), left = imgs.length;
      var fonts = d.fonts && d.fonts.ready ? d.fonts.ready : Promise.resolve();
      var ready = function () { fonts.then(function () { setTimeout(go, 60); }, function () { setTimeout(go, 60); }); };
      if (!left) return ready();
      var one = function () { if (--left === 0) ready(); };
      imgs.forEach(function (im) { if (im.complete) one(); else { im.onload = im.onerror = one; } });
    });
  }

  // ---- 存成文件 + 通知 ----
  function save(o) {
    var FS = window.SANDBOX;
    return render(o).then(function (u8) {
      if (!u8) return null;
      if (!u8.length) throw new Error("没有生成 PDF");
      var p = o.path, dir = p.slice(0, p.lastIndexOf("/")) || "/";
      if (!o.replace && FS.exists(p)) {
        var stem = p.slice(dir.length + 1).replace(/\.pdf$/i, ""), n = 2;
        while (FS.exists(dir + "/" + stem + " " + n + ".pdf")) n++;
        p = dir + "/" + stem + " " + n + ".pdf";
      }
      FS.mkdirp(dir);
      FS.writeBinary(p, u8);
      return Promise.resolve(FS.mirrorFlush && FS.mirrorFlush()).catch(function () {}).then(function () {
        if (o.notify !== false) notify(o.app, p);
        return p;
      });
    });
  }
  function tilde(p) { var H = (window.SANDBOX && SANDBOX.HOME) || "/home/user"; return p === H ? "~" : p.indexOf(H + "/") === 0 ? "~" + p.slice(H.length) : p; }
  // 点通知 → 在访达中显示。桌面（desk.js）里点横幅、通知中心那一条现在到不了 onClick（有两个同名的 activate，后一个盖掉了前一个）：
  // 这里在它们冒泡上来时也接一下（等桌面自己的处理完再做）；只做一次，桌面修好以后两边都来也不会开两次。macOS 的系统通知不受影响（native.js 直接调 onClick）
  var reveals = {};
  document.addEventListener("click", function (e) {
    var c = e.target.closest && e.target.closest("#banners .banner[data-note], .nc-card[data-id]");
    var fn = c && !e.target.closest(".n-x") && reveals[c.dataset.note || c.dataset.id];
    if (fn) setTimeout(fn, 0);
  });
  function notify(app, p) {
    var D = window.TSU_DESK, name = p.slice(p.lastIndexOf("/") + 1), id = null, shown = false;
    if (!D || !D.notify) return;
    var reveal = function () {
      if (shown) return;
      shown = true;
      delete reveals[id];
      var F = window.TSU_FINDER;
      if (F && F.reveal) F.reveal(p);
    };
    var h = D.notify({ app: app || "访达", title: "已导出 PDF", body: "「" + name + "」存到了 " + tilde(p.slice(0, p.lastIndexOf("/")) || "/") + "，点按在访达中显示", onClick: reveal });
    if (h && h.id) reveals[id = String(h.id)] = reveal;
  }

  window.TSU_PDF = { native: !!N, render: render, print: print, save: save, layout: layout };
})();
