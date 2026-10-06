// sys-capture.js —— 把页面的一块（整个屏幕、一个窗口、一个区域）画成图：DOM → SVG <foreignObject> → canvas。screencapture 第一次用时才载入。
// · 每个元素的样式都算好了写在它身上（getComputedStyle；跟默认值 / 父元素一样的不写），伪元素 ::before / ::after 另起一条规则
// · SVG 当图片画的时候不许取外面的东西：图片、背景图、canvas、video 都换成 data: 地址；同源的 iframe 递归画进去，别的源画成一块灰底
// · 滚动过的容器：内容挪回滚动后的位置；完全在画面外的大块只留一个同样大小的空盒子（长长的对话记录不用整段抄一遍）
(function () {
  "use strict";
  var SVG_NS = "http://www.w3.org/2000/svg", XHTML = "http://www.w3.org/1999/xhtml";
  // 会继承的属性：跟父元素一样就不写（别的属性跟默认值一样才不写）
  var INHERITED = {};
  ("azimuth border-collapse border-spacing caption-side color cursor direction empty-cells font font-family font-feature-settings font-kerning font-language-override font-optical-sizing " +
    "font-palette font-size font-size-adjust font-stretch font-style font-synthesis font-synthesis-small-caps font-synthesis-style font-synthesis-weight font-variant font-variant-alternates " +
    "font-variant-caps font-variant-east-asian font-variant-emoji font-variant-ligatures font-variant-numeric font-variant-position font-variation-settings font-weight forced-color-adjust " +
    "hanging-punctuation hyphenate-character hyphenate-limit-chars hyphens image-orientation image-rendering letter-spacing line-break line-height list-style list-style-image " +
    "list-style-position list-style-type math-depth math-shift math-style orphans overflow-wrap paint-order pointer-events print-color-adjust quotes ruby-align ruby-position speak " +
    "tab-size text-align text-align-last text-anchor text-combine-upright text-decoration-skip-ink text-emphasis text-emphasis-color text-emphasis-position text-emphasis-style " +
    "text-indent text-justify text-orientation text-rendering text-shadow text-size-adjust text-spacing-trim text-transform text-underline-offset text-underline-position text-wrap " +
    "text-wrap-mode text-wrap-style visibility white-space white-space-collapse widows word-break word-spacing word-wrap writing-mode accent-color color-scheme caret-color " +
    "fill fill-opacity fill-rule stroke stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width clip-rule color-interpolation " +
    "color-interpolation-filters color-rendering marker marker-end marker-mid marker-start shape-rendering dominant-baseline " +
    "-webkit-font-smoothing -webkit-text-fill-color -webkit-text-stroke -webkit-text-stroke-color -webkit-text-stroke-width -webkit-text-security -webkit-border-horizontal-spacing " +
    "-webkit-border-vertical-spacing -webkit-locale -webkit-rtl-ordering -webkit-user-modify -webkit-text-combine -webkit-text-emphasis -webkit-text-emphasis-color " +
    "-webkit-text-emphasis-position -webkit-text-emphasis-style -webkit-text-orientation -webkit-writing-mode -webkit-hyphenate-character -webkit-line-break -webkit-print-color-adjust " +
    "-webkit-text-size-adjust -webkit-tap-highlight-color -webkit-highlight -webkit-ruby-position -webkit-nbsp-mode -webkit-text-decorations-in-effect").split(" ").forEach(function (p) { INHERITED[p] = 1; });
  var SKIP = /^(transition|animation|will-change|cursor|caret-color|pointer-events|user-select|-webkit-user-select|-webkit-user-drag|touch-action|scroll-|overscroll|content-visibility|contain-intrinsic|view-transition|-webkit-tap-highlight|app-region|-webkit-app-region|interactivity|field-sizing)/;
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, LINK: 1, META: 1, TITLE: 1, BASE: 1, SOURCE: 1, TRACK: 1 };
  var BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
  function clean(s) {
    s = String(s).replace(BAD_XML, "");
    if (/[\uD800-\uDFFF]/.test(s)) s = Array.from(s).filter(function (ch) { return !/^[\uD800-\uDFFF]$/.test(ch); }).join("");
    return s;
  }
  var csOf = function (el, pe) { return (el.ownerDocument.defaultView || window).getComputedStyle(el, pe || null); };

  // ---- 默认样式：一个看不见的空 iframe 里放同样的标签，量一次记下 ----
  var defaults = {}, sandbox = null;
  function defaultsFor(el) {
    var ns = el.namespaceURI === SVG_NS ? "svg:" : "", key = ns + el.localName;
    if (defaults[key]) return defaults[key];
    if (!sandbox) {
      sandbox = document.createElement("iframe");
      sandbox.setAttribute("aria-hidden", "true");
      sandbox.tabIndex = -1;
      sandbox.style.cssText = "position:fixed;left:-10000px;top:0;width:40px;height:40px;border:0;visibility:hidden;pointer-events:none";
      document.body.appendChild(sandbox);
      var d0 = sandbox.contentDocument;
      d0.open(); d0.write("<!DOCTYPE html><html><head></head><body></body></html>"); d0.close();
    }
    var d = sandbox.contentDocument, host = d.body, box = null, e;
    if (ns) { box = d.createElementNS(SVG_NS, "svg"); host.appendChild(box); e = d.createElementNS(SVG_NS, el.localName); box.appendChild(e); }
    else { e = d.createElement(el.localName); host.appendChild(e); }
    var cs = sandbox.contentWindow.getComputedStyle(e), o = {};
    for (var i = 0; i < cs.length; i++) o[cs[i]] = cs.getPropertyValue(cs[i]);
    (box || e).remove();
    defaults[key] = o;
    return o;
  }

  // ---- 外面的东西 → data: 地址（按地址 + 尺寸记住；图太大就按要画的大小缩一下）----
  var cache = new Map();
  function readAsDataURL(blob) { return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = function () { rej(fr.error); }; fr.readAsDataURL(blob); }); }
  function dataURL(url, maxW, maxH) {
    if (!url || /^data:/.test(url)) return Promise.resolve(url || "");
    var key = url + "|" + (maxW || 0) + "x" + (maxH || 0);
    if (cache.has(key)) return cache.get(key);
    var p = fetch(url, { credentials: "same-origin" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.blob(); }).then(function (blob) {
      if (!maxW || !maxH || !/^image\/(png|jpe?g|webp|gif|avif|bmp)/.test(blob.type) || !window.createImageBitmap) return readAsDataURL(blob);
      return createImageBitmap(blob).then(function (bm) {
        var k = Math.min(1, maxW / bm.width, maxH / bm.height);
        if (k > 0.85) { bm.close && bm.close(); return readAsDataURL(blob); }
        var c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(bm.width * k)); c.height = Math.max(1, Math.round(bm.height * k));
        c.getContext("2d").drawImage(bm, 0, 0, c.width, c.height);
        bm.close && bm.close();
        return c.toDataURL(blob.type === "image/png" || blob.type === "image/gif" ? "image/png" : "image/jpeg", 0.9);
      });
    }).catch(function () { return "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"; }); // 取不到：透明的一个点
    cache.set(key, p);
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return p;
  }
  var URL_RE = /url\((['"]?)([^'")]+)\1\)/g;
  function inlineURLs(value, maxW, maxH) {
    var urls = [], m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(value))) if (!/^data:/.test(m[2]) && !/^#/.test(m[2])) urls.push(m[2]);
    if (!urls.length) return Promise.resolve(value);
    return Promise.all(urls.map(function (u) { return dataURL(u, maxW, maxH); })).then(function (datas) {
      var i = 0;
      return value.replace(URL_RE, function (all, q, u) { return /^data:/.test(u) || /^#/.test(u) ? all : 'url("' + datas[i++] + '")'; });
    });
  }

  // ---- 画 ----
  function intersects(a, b) { return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; }
  function inter(a, b) { return { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) }; }
  function render(root, opts) {
    opts = opts || {};
    var doc = root.ownerDocument, view = doc.defaultView;
    var rb = root === doc.body || root === doc.documentElement ? { left: 0, top: 0, width: view.innerWidth, height: view.innerHeight } : root.getBoundingClientRect();
    var rect = opts.rect || { left: rb.left, top: rb.top, width: rb.width, height: rb.height };
    var W = Math.max(1, Math.round(rect.width)), H = Math.max(1, Math.round(rect.height)), scale = opts.scale || Math.min(2, window.devicePixelRatio || 1);
    var jobs = [], rules = [], pseq = 0, screen = { left: rect.left, top: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height };
    var setLater = function (el, prop, v, mw, mh) { jobs.push(inlineURLs(v, mw, mh).then(function (nv) { el.style.setProperty(prop, nv); })); };

    function writeStyle(el, out, cs, pcs, isRoot, r) {
      var def = defaultsFor(el), css = [], urls = [];
      for (var i = 0; i < cs.length; i++) {
        var p = cs[i];
        if (p.charCodeAt(0) === 45 && p.charCodeAt(1) === 45) continue; // --变量：值已经算进别的属性里了
        if (SKIP.test(p)) continue;
        var v = cs.getPropertyValue(p);
        if (INHERITED[p]) { if (v === (pcs ? pcs.getPropertyValue(p) : def[p])) continue; }
        else if (v === def[p]) continue;
        if (/^(filter|backdrop-filter|-webkit-backdrop-filter|clip-path|mask|-webkit-mask|mask-image|-webkit-mask-image|marker-start|marker-mid|marker-end)$/.test(p) && /url\(["']?#/.test(v)) {
          v = v.replace(/url\([^)]*\)\s*/g, "").trim() || "none"; // 指到文档里别处的 SVG（液态玻璃的折射）：图里找不到，去掉
          if (v === def[p]) continue;
        }
        if (v.indexOf("url(") >= 0 && !/^url\(["']?data:/.test(v)) { urls.push([p, v]); continue; }
        css.push(p + ":" + v);
      }
      if (isRoot) css.push("position:absolute", "margin:0", "left:" + (r.left - rect.left) + "px", "top:" + (r.top - rect.top) + "px", "transform:none", "translate:none", "scale:none", "rotate:none");
      out.setAttribute("style", css.join(";"));
      var bw = Math.ceil(r.width * scale), bh = Math.ceil(r.height * scale), fit = /cover|contain/.test(cs.backgroundSize);
      urls.forEach(function (x) { setLater(out, x[0], x[1], fit ? bw : 0, fit ? bh : 0); });
    }
    function pseudo(el, out, cs) {
      [":before", ":after"].forEach(function (pe) {
        var ps = csOf(el, pe), content = ps.getPropertyValue("content");
        if (!content || content === "none" || content === "normal") return;
        var def = defaultsFor({ namespaceURI: XHTML, localName: "span" }), css = [];
        for (var i = 0; i < ps.length; i++) {
          var p = ps[i];
          if ((p.charCodeAt(0) === 45 && p.charCodeAt(1) === 45) || SKIP.test(p)) continue;
          var v = ps.getPropertyValue(p);
          if (INHERITED[p] ? v === cs.getPropertyValue(p) : v === def[p]) continue;
          css.push(p + ":" + v);
        }
        var cls = "tp" + (++pseq), rule = "." + cls + ":" + pe + "{" + css.join(";") + "}";
        out.setAttribute("class", ((out.getAttribute("class") || "") + " " + cls).trim());
        if (rule.indexOf("url(") >= 0) { var at = rules.length; rules.push(""); jobs.push(inlineURLs(rule).then(function (r2) { rules[at] = r2; })); }
        else rules.push(rule);
      });
      if ((el.tagName === "INPUT" || el.tagName === "TEXTAREA") && el.placeholder && !el.value) {
        try { var ph = csOf(el, "::placeholder"), cl = "tp" + (++pseq); rules.push("." + cl + "::placeholder{color:" + ph.color + ";opacity:1}"); out.setAttribute("class", ((out.getAttribute("class") || "") + " " + cl).trim()); } catch (e) { /* 取不到就用默认的灰 */ }
      }
    }
    function copyAttrs(el, out) {
      if (el.namespaceURI === SVG_NS) {
        for (var i = 0; i < el.attributes.length; i++) { var a = el.attributes[i]; if (a.name === "style" || a.name === "class" || /^on/i.test(a.name)) continue; try { out.setAttributeNS(a.namespaceURI, a.name, clean(a.value)); } catch (e) { /* 奇怪的属性名 */ } }
        return;
      }
      ["type", "placeholder", "colspan", "rowspan", "span", "start", "reversed", "dir", "lang", "alt", "width", "height", "disabled", "readonly", "multiple", "size", "rows", "cols", "open", "min", "max", "step"].forEach(function (n) {
        if (el.hasAttribute(n)) out.setAttribute(n, clean(el.getAttribute(n)));
      });
    }
    function replaced(el, cs, r) {
      var out = document.createElementNS(XHTML, "img"), tag = el.tagName;
      if (tag === "CANVAS") { try { out.setAttribute("src", el.toDataURL("image/png")); } catch (e) { out.setAttribute("src", dataURLBlank()); } return out; }
      if (tag === "VIDEO") {
        try {
          if (el.readyState < 2) throw new Error("no frame");
          var c = document.createElement("canvas");
          c.width = Math.max(1, Math.min(el.videoWidth, Math.ceil(r.width * scale * 1.2))); c.height = Math.max(1, Math.round(c.width * el.videoHeight / el.videoWidth));
          c.getContext("2d").drawImage(el, 0, 0, c.width, c.height);
          out.setAttribute("src", c.toDataURL("image/jpeg", 0.9));
        } catch (e) { var poster = el.poster || ""; if (poster) jobs.push(dataURL(poster, Math.ceil(r.width * scale), Math.ceil(r.height * scale)).then(function (u) { out.setAttribute("src", u); })); else out.setAttribute("src", dataURLBlank()); }
        return out;
      }
      // IMG：已经载入的直接画（按要画的大小，太大的缩一下）；SVG 和画不了的（别的源）去取
      var src = el.currentSrc || el.src;
      if (!src) { out.setAttribute("src", dataURLBlank()); return out; }
      if (/^data:/.test(src)) { out.setAttribute("src", src); return out; }
      var drawn = false;
      if (el.complete && el.naturalWidth && !/\.svg(\?|#|$)/i.test(src)) {
        try {
          var k = Math.min(1, Math.max(1, r.width * scale) / el.naturalWidth * 1.5), c2 = document.createElement("canvas");
          c2.width = Math.max(1, Math.round(el.naturalWidth * k)); c2.height = Math.max(1, Math.round(el.naturalHeight * k));
          c2.getContext("2d").drawImage(el, 0, 0, c2.width, c2.height);
          out.setAttribute("src", c2.toDataURL(/\.jpe?g(\?|$)/i.test(src) ? "image/jpeg" : "image/png", 0.92));
          drawn = true;
        } catch (e) { /* 别的源的图：去取 */ }
      }
      if (!drawn) jobs.push(dataURL(src).then(function (u) { out.setAttribute("src", u); }));
      return out;
    }
    function dataURLBlank() { return "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"; }
    function frameShot(el, r) {
      var out = document.createElementNS(XHTML, "img"), d2 = null;
      try { d2 = el.contentDocument; } catch (e) { d2 = null; }
      if (d2 && d2.body && el.clientWidth && el.clientHeight) {
        out.setAttribute("src", dataURLBlank());
        jobs.push(render(d2.body, { rect: { left: 0, top: 0, width: el.clientWidth, height: el.clientHeight }, scale: scale, bg: true }).then(function (c) { out.setAttribute("src", c.toDataURL("image/png")); }, function () {}));
        return out;
      }
      var box = document.createElementNS(XHTML, "div"), host = "";
      try { host = new URL(el.src, location.href).host; } catch (e) { /* 没有地址 */ }
      box.textContent = host ? "(" + host + " — another site's page can't be captured)" : "(embedded page)";
      box.__ph = true;
      return box;
    }
    // 完全在画面外、自己有块状大小的一大块：只留一个同样大小的空盒子
    function hollowable(k, clipR) {
      if (!clipR || k.nodeType !== 1 || SKIP_TAGS[k.tagName]) return false;
      if (k.childElementCount < 3 && (k.textContent || "").length < 400) return false;
      var r = k.getBoundingClientRect();
      if (!r.width || !r.height || intersects({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }, clipR)) return false;
      var cs = csOf(k);
      return /^(block|flex|grid|list-item|flow-root|table)$/.test(cs.display) && (cs.position === "static" || cs.position === "relative");
    }
    function hollow(k) {
      var cs = csOf(k), o = document.createElementNS(XHTML, "div"), css = ["display:block", "box-sizing:border-box", "flex:0 0 auto", "width:" + k.offsetWidth + "px", "height:" + k.offsetHeight + "px"];
      ["margin-top", "margin-right", "margin-bottom", "margin-left", "position", "top", "left", "right", "bottom", "float", "clear", "order", "align-self", "justify-self", "grid-row-start", "grid-row-end", "grid-column-start", "grid-column-end"].forEach(function (p) { css.push(p + ":" + cs.getPropertyValue(p)); });
      o.setAttribute("style", css.join(";"));
      return o;
    }
    // 滚过的容器：子元素挪到滚动后的位置（行内的用相对定位，别的用 translate，不碰它自己的 transform）
    function shift(c, orig, sl, st) {
      if (orig.nodeType === 3) {
        var sp = document.createElementNS(XHTML, "span");
        sp.setAttribute("style", "position:relative;left:" + (-sl) + "px;top:" + (-st) + "px");
        sp.appendChild(c);
        return sp;
      }
      var cs = csOf(orig);
      if (cs.position === "sticky" || cs.position === "fixed") return c;
      if (/^inline$|^contents$/.test(cs.display)) {
        if (cs.position === "static") c.style.setProperty("position", "relative");
        c.style.setProperty("left", ((parseFloat(cs.left) || 0) - sl) + "px");
        c.style.setProperty("top", ((parseFloat(cs.top) || 0) - st) + "px");
        return c;
      }
      var t = cs.translate && cs.translate !== "none" ? cs.translate.split(/\s+/).map(parseFloat) : [0, 0];
      c.style.setProperty("translate", ((t[0] || 0) - sl) + "px " + ((t[1] || 0) - st) + "px");
      return c;
    }
    function cloneEl(el, pcs, clipR, isRoot) {
      if (el.nodeType === 3) return document.createTextNode(clean(el.nodeValue));
      if (el.nodeType !== 1 || SKIP_TAGS[el.tagName]) return null;
      if (el === sandbox) return null;
      var cs = csOf(el);
      if (cs.display === "none") return null;
      var r = el.getBoundingClientRect(), tag = el.tagName, out;
      if (tag === "IMG" || tag === "CANVAS" || tag === "VIDEO") out = replaced(el, cs, r);
      else if (tag === "IFRAME" || tag === "OBJECT" || tag === "EMBED") out = frameShot(el, r);
      else out = el.namespaceURI === SVG_NS ? document.createElementNS(SVG_NS, el.localName) : document.createElementNS(XHTML, el.localName.toLowerCase());
      if (!out.__ph && tag !== "IMG" && tag !== "CANVAS" && tag !== "VIDEO") copyAttrs(el, out);
      writeStyle(out.__ph ? { namespaceURI: XHTML, localName: "div" } : el, out, cs, pcs, isRoot, r);
      if (out.__ph) { out.style.setProperty("background", "#e5e5ea"); out.style.setProperty("color", "#6e6e73"); out.style.setProperty("font", "13px -apple-system, sans-serif"); out.style.setProperty("display", "flex"); out.style.setProperty("align-items", "center"); out.style.setProperty("justify-content", "center"); out.style.setProperty("text-align", "center"); return out; }
      if (el.namespaceURI !== SVG_NS) pseudo(el, out, cs);
      if (tag === "INPUT") { if (el.type !== "file") out.setAttribute("value", clean(el.value)); if (el.checked) out.setAttribute("checked", ""); return out; }
      if (tag === "TEXTAREA") { out.textContent = clean(el.value); return out; }
      if (tag === "OPTION" && el.selected) out.setAttribute("selected", "");
      if (tag === "IMG" || tag === "CANVAS" || tag === "VIDEO") return out;
      var clipNext = clipR;
      if (!isRoot && /(hidden|clip|auto|scroll)/.test(cs.overflowX + " " + cs.overflowY)) clipNext = inter(clipR, { left: r.left, top: r.top, right: r.right, bottom: r.bottom });
      var sl = el.scrollLeft || 0, st = el.scrollTop || 0, kids = el.childNodes;
      if (el.namespaceURI === SVG_NS) sl = st = 0;
      for (var i = 0; i < kids.length; i++) {
        var k = kids[i];
        if (k.nodeType === 1 && hollowable(k, clipNext)) { out.appendChild(hollow(k)); continue; }
        var c = cloneEl(k, cs, clipNext, false);
        if (!c) continue;
        out.appendChild(sl || st ? shift(c, k, sl, st) : c);
      }
      return out;
    }

    var clone = cloneEl(root, null, screen, true); // 根：会继承的属性也都写上（图里它的上一层是个空 div）
    return Promise.all(jobs).then(function () {
      var wrap = document.createElementNS(XHTML, "div"), hcs = csOf(doc.documentElement);
      var bg = root === doc.body || root === doc.documentElement || opts.bg ? "background:" + (hcs.backgroundColor !== "rgba(0, 0, 0, 0)" ? hcs.backgroundColor : csOf(doc.body).backgroundColor) + ";" : "";
      wrap.setAttribute("style", "position:relative;overflow:hidden;margin:0;padding:0;width:" + W + "px;height:" + H + "px;transform:scale(1);" + bg);
      var style = document.createElementNS(XHTML, "style");
      style.textContent = rules.join("\n") + "\n*{scrollbar-width:none!important}*::-webkit-scrollbar{display:none!important}";
      wrap.appendChild(style);
      if (clone) wrap.appendChild(clone);
      var xml = new XMLSerializer().serializeToString(wrap);
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '"><foreignObject x="0" y="0" width="' + W + '" height="' + H + '">' + xml + "</foreignObject></svg>";
      return new Promise(function (res, rej) {
        var img = new Image();
        img.onload = function () { res(img); };
        img.onerror = function () { rej(new Error("the browser couldn't draw this part of the page")); };
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      });
    }).then(function (img) {
      // Safari：SVG 里的图片解码得晚，等一下再画
      var wait = /Safari/.test(navigator.userAgent) && !/Chrome|Chromium/.test(navigator.userAgent) ? 120 : 0;
      return new Promise(function (res) { setTimeout(res, wait); }).then(function () {
        var c = document.createElement("canvas");
        c.width = Math.round(W * scale); c.height = Math.round(H * scale);
        var g = c.getContext("2d");
        g.drawImage(img, 0, 0, c.width, c.height);
        return c;
      });
    });
  }
  window.TSU_SYS_CAPTURE = { render: render };
})();
