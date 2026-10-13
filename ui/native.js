// native.js —— 在 Paimon App（macOS 原生壳，apps/macos/）里跑时接上原生的桥 window.nadosNative；浏览器里什么都不做。
// · 系统命令 native：权限（查、申请、打开系统设置）、截真的屏幕、系统通知、真的剪贴板、Dock 角标（help native 看全）
// · pbcopy / pbpaste 走真的系统剪贴板；网页里读剪贴板（navigator.clipboard.readText）不再弹 WebKit 的「粘贴」按钮
// · App 不在前台时，桌面的通知同时发一条系统通知（勿扰时不发）；点它回到这条通知对应的 App
// · 窗口：菜单栏左边让出红黄绿三个按钮的位置；菜单栏空着的地方能拖窗口、双击缩放；桌面的「全屏」= App 窗口进 macOS 全屏
(function () {
  "use strict";
  var N = window.nadosNative;
  if (!N || (N.remote && !N.hybrid)) return; // iPad 端（remote.js 经中转连到 Mac 的那份）：窗口、红黄绿按钮这些是 Mac 自己的，这里不管；App 里连着另一台 Mac 的窗口照常（窗口是这台的）
  var root = document.documentElement;
  root.classList.add("native-app");

  // ======== 窗口：三个按钮让位、拖动区、全屏 ========
  var st = document.createElement("style");
  st.textContent = "html.native-app:not(.ios) #menubar { padding-left: var(--nados-pad, 14px); }";
  document.head.appendChild(st);
  var active = true, inset = 0;
  function setChrome(full, px) {
    if (typeof px === "number") inset = px;
    root.classList.toggle("native-full", !!full);
    if (full || !inset) root.style.removeProperty("--nados-pad"); else root.style.setProperty("--nados-pad", Math.round(inset + 10) + "px");
    regionsSoon();
  }
  N.call("info").then(function (i) { active = !!i.active; setChrome(i.fullscreen, i.inset); }, function () {});
  N.on("active", function (d) { active = !!(d && d.active); });
  N.on("fullscreen", function (d) { setChrome(d && d.on, d && d.inset); });

  // 菜单栏中间空着的那段（.sp）当标题栏：按下拖窗口、双击同标题栏。菜单栏收起来（窗口全屏、调度中心、启动台）时不算
  var lastRegions = "", rq = 0;
  function regions() {
    rq = 0;
    var out = [], mb = document.getElementById("menubar"), desk = document.getElementById("desktop");
    // Paimon Terminal（只有终端的页面）：终端窗口的标题栏就是 App 的标题栏——右边的按钮以外都能拖
    // 只算按钮之间的空白：左边红黄绿和边栏按钮（.ts-btn）的右边，到右边第一个按钮（◐ 等）的左边——按钮自己要能点
    if (root.classList.contains("termapp")) {
      var bar = document.querySelector("#win .bar");
      if (bar && !root.classList.contains("native-full")) {
        // 按钮、地址栏之间的空白都能拖（地址栏在正中，把空白分成左右两段）
        var br = bar.getBoundingClientRect(), x = br.left + (inset || 70) + 10, spans = [];
        // 能点的都不算拖动区：按钮、地址栏、右上角的布局开关（.st-lay 是一组按钮）、以后加的控件标 data-nodrag 就行
        // data-dragfill 的一组（Claude App 风格的标题行）：只有里面的按钮、输入框、标签不能拖，组里的空白能拖
        Array.prototype.forEach.call(bar.querySelectorAll(":scope > button, :scope > .ts-btn, :scope > .ts-tb, :scope > .ts-addr, :scope > .st-lay, :scope > .term-toggle, :scope > [data-nodrag], :scope > [data-dragfill] :is(button, input, a, .ca-chip, [data-nodrag])"), function (b) {
          if (!b.offsetParent) return;
          var r = b.getBoundingClientRect();
          spans.push([r.left - 6, r.right + 6]);
        });
        spans.sort(function (a, b) { return a[0] - b[0]; }).forEach(function (s) {
          if (s[0] - x > 20) out.push({ x: Math.round(x), y: Math.round(br.top), w: Math.round(s[0] - x), h: Math.round(br.height) });
          x = Math.max(x, s[1]);
        });
        if (br.right - x > 20) out.push({ x: Math.round(x), y: Math.round(br.top), w: Math.round(br.right - x), h: Math.round(br.height) });
      }
      mb = null;
    }
    var hidden = !mb || root.classList.contains("ios") || root.classList.contains("native-full") || (desk && /(^|\s)(full|mc|lp)(\s|$)/.test(desk.className));
    if (!hidden) Array.prototype.forEach.call(mb.querySelectorAll(":scope > .sp"), function (el) {
      var r = el.getBoundingClientRect();
      if (r.width > 4 && r.height > 4) out.push({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
    });
    var sig = JSON.stringify(out);
    if (sig === lastRegions) return;
    lastRegions = sig;
    N.call("window.dragRegions", { rects: out }).catch(function () {});
  }
  function regionsSoon() { if (!rq) rq = requestAnimationFrame(regions); }
  window.addEventListener("resize", regionsSoon);
  // Paimon Terminal：标题栏里的按钮是后加的（边栏按钮）、会显示 / 隐藏：变了就重算拖动区
  if (root.classList.contains("termapp")) document.addEventListener("DOMContentLoaded", function () {
    var bar = document.querySelector("#win .bar");
    if (bar && window.MutationObserver) new MutationObserver(regionsSoon).observe(bar, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class", "style"] });
    regionsSoon();
  });

  // 桌面的「全屏」（⌃⌘F、菜单）：整个 App 窗口进 / 出 macOS 的全屏；别的元素（视频）照旧用 WebKit 的元素全屏
  ["requestFullscreen", "webkitRequestFullscreen"].forEach(function (k) {
    var orig = Element.prototype[k];
    if (!orig) return;
    Element.prototype[k] = function () {
      if (this === root) return N.call("window.fullscreen", {}).then(function () {});
      return orig.apply(this, arguments);
    };
  });

  // ======== 剪贴板：真的系统剪贴板 ========
  var readClip = function () { return N.call("clipboard.read").then(function (r) { return (r && r.text) || ""; }); };
  try { if (navigator.clipboard) navigator.clipboard.readText = readClip; } catch (e) { /* 不让改就算了 */ }

  // ======== 系统命令 ========
  var S = window.TSU_SYS;
  if (S) {
    var U = S._, err = U.err, usage = U.usage, two = U.two;
    S.pasteboard.sysWrite = function (t) { return N.call("clipboard.write", { text: String(t == null ? "" : t) }); };
    S.register("pbpaste", {
      summary: "print the clipboard",
      usage: ["pbpaste"],
      help: "Prints the text on the clipboard. For the human it is the Mac's real clipboard (this desktop runs in the Paimon app). " +
        "Agents get the text last copied, cut or pasted on this desktop (or put there with pbcopy); `native clipboard` reads the Mac's clipboard with read & write access.",
      run: function (argv, ctx) {
        var mine = S.pasteboard.get();
        if (ctx.agent) return mine;
        return readClip().then(function (t) { return t || mine; }, function () { return mine; });
      },
    });

    var KINDS = ["notifications", "screen", "accessibility", "camera", "microphone"];
    var WHAT = { notifications: "system notifications", screen: "screen recording (native screenshot)", accessibility: "accessibility (controlling other apps)", camera: "camera", microphone: "microphone" };
    var kindOf = function (k) {
      var x = String(k || "").toLowerCase().replace(/^(screen-?recording|screencapture)$/, "screen").replace(/^(ax|a11y)$/, "accessibility").replace(/^(mic)$/, "microphone").replace(/^(notify|notification)$/, "notifications");
      if (KINDS.indexOf(x) < 0) throw usage("which permission? " + KINDS.join(", "));
      return x;
    };
    var shotName = function () { var d = new Date(); return "截屏" + d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate()) + " " + two(d.getHours()) + "." + two(d.getMinutes()) + "." + two(d.getSeconds()); };
    var bytesOf = function (dataURL) { var b = atob(dataURL.slice(dataURL.indexOf(",") + 1)), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
    var imgOf = function (src) { return new Promise(function (res, rej) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = function () { rej(err("couldn't decode the screenshot")); }; im.src = src; }); };
    // 给模型的那份：同 screencapture（长边 ≤ 1568、≤ 115 万像素、JPEG）；给界面的缩略图 320×200 以内
    function scaled(im, k, q) {
      var c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
      var g = c.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(im, 0, 0, c.width, c.height);
      return { canvas: c, url: c.toDataURL("image/jpeg", q) };
    }

    S.register("native", {
      title: "Paimon App",
      summary: "the Mac itself (this desktop runs in the Paimon app): permissions, real screenshots, system notifications, the real clipboard, the Dock badge",
      level: "any",
      usage: [
        "native                                   what's available, permission states",
        "native info | permissions [--json]",
        "native request <kind>                    ask macOS for a permission (kind: " + KINDS.join(", ") + ")",
        "native settings <kind>                   open that page of System Settings",
        "native screenshot [-o <file>] [--display <n>] [--max-width <px>] [--exclude-self] [-t png|jpg]",
        "native notify <title> [<body> | -]      a macOS notification (body - reads stdin)",
        "native clipboard [<text> | -]            print the Mac's clipboard, or set it",
        "native badge [<text>]                    the number / text on the Dock icon (empty clears it)",
        "native open <url>                        open http(s) or mailto in the Mac's default app",
      ],
      help: "This is the real Mac under the desktop, not the desktop itself: `screencapture` and `ax` see this desktop; `native screenshot` sees the whole Mac screen (other apps too). " +
        "macOS asks the human once per permission: `native request <kind>` shows the system dialog the first time; after that (or if it was refused) it opens the right page of System Settings. " +
        "Screen recording may need Paimon to be reopened after it is turned on.\n" +
        "Screenshots without -o go to ~/Desktop/截屏YYYY-MM-DD HH.MM.SS.png (local time); when an agent runs it, the picture is attached for the model (if the model can see images). " +
        "--exclude-self leaves the Paimon window out.",
      levelNote: "info and permissions are open to everyone; everything else (the real screen and clipboard, notifications, permission prompts) needs read & write access because it reaches outside this desktop.",
      run: function (argv, ctx) {
        var sub = argv[0] || "status", rest = argv.slice(1), rw = function () { ctx.need("rw", "native " + sub); };
        if (sub === "status") {
          return Promise.all([N.call("info"), N.call("permissions")]).then(function (r) {
            var i = r[0], p = r[1];
            return "Paimon " + i.version + " (" + i.build + ") · macOS " + i.os + " · " + i.arch + "\n\n" +
              S.table([["PERMISSION", "STATE", ""]].concat(KINDS.map(function (k) { return [k, p[k], p[k] === "granted" ? "" : "native request " + k]; }))) +
              "\nnative --help for the commands.";
          });
        }
        if (sub === "info") return N.call("info").then(function (i) { return rest.indexOf("--json") >= 0 ? JSON.stringify(i, null, 2) : S.table(Object.keys(i).filter(function (k) { return k !== "commands"; }).map(function (k) { return [k, String(i[k])]; })); });
        if (sub === "permissions") {
          return N.call("permissions").then(function (p) {
            if (rest.indexOf("--json") >= 0) return JSON.stringify(p, null, 2);
            return S.table([["PERMISSION", "STATE", "FOR"]].concat(KINDS.map(function (k) { return [k, p[k], WHAT[k]]; })));
          });
        }
        if (sub === "request" || sub === "settings") {
          rw();
          var kind = kindOf(rest[0]);
          if (sub === "settings") return N.call("settings", { kind: kind }).then(function () { return "Opened System Settings for " + WHAT[kind] + "."; });
          return N.call("request", { kind: kind }).then(function (r) {
            return kind + ": " + r.status + (r.openedSettings ? " (opened System Settings)" : "") + (r.note ? "\n" + r.note : "");
          });
        }
        if (sub === "screenshot") {
          rw();
          var g = S.getopt(rest, { o: "str", display: "num", "max-width": "num", "exclude-self": "bool", t: "str" }, { "-o": "o", "-t": "t" });
          if (g.a.length > 1) throw usage("one file at a time");
          var file0 = g.o.o || g.a[0], fmt = String(g.o.t || (file0 && /\.jpe?g$/i.test(file0) ? "jpg" : "png")).toLowerCase();
          if (!/^(png|jpe?g)$/.test(fmt)) throw usage("-t png or jpg");
          var file = ctx.path(file0 || "~/Desktop/" + shotName() + "." + (fmt === "png" ? "png" : "jpg"));
          return N.call("screenshot", { display: g.o.display || 0, maxWidth: g.o["max-width"] || undefined, excludeSelf: !!g.o["exclude-self"], format: fmt === "png" ? "png" : "jpeg" }).then(function (r) {
            return ctx.writeFile(file, bytesOf(r.dataURL)).then(function () { return imgOf(r.dataURL); }).then(function (im) {
              var msg = "Saved a screenshot of the Mac's display " + r.display + " to " + ctx.shown(file) + " (" + r.width + "×" + r.height + " pixels, " + r.points.width + "×" + r.points.height + " points).";
              var thumb = scaled(im, Math.min(1, 320 / im.naturalWidth, 200 / im.naturalHeight), 0.72).url;
              if (!ctx.agent) return { out: msg, summary: msg, thumb: thumb };
              if (!ctx.vision) return { out: msg + "\nYour model can't see images, so it isn't attached.", summary: "Captured the Mac screen", thumb: thumb };
              var k = Math.min(1, 1568 / Math.max(im.naturalWidth, im.naturalHeight), Math.sqrt(1150000 / (im.naturalWidth * im.naturalHeight))), m = scaled(im, k, 0.85);
              ctx.images.push({ media_type: "image/jpeg", data: m.url.slice(m.url.indexOf(",") + 1), width: m.canvas.width, height: m.canvas.height });
              return { out: msg + "\nThe screenshot is attached (" + m.canvas.width + "×" + m.canvas.height + ").", summary: "Captured the Mac screen · " + r.points.width + "×" + r.points.height, thumb: thumb };
            });
          });
        }
        if (sub === "notify") {
          rw();
          var title = rest[0], body = rest[1];
          if (body === "-" || (body === undefined && ctx.stdin != null && ctx.stdin !== "")) body = String(ctx.stdin || "").replace(/\n$/, "");
          if (!title && !body) throw usage("native notify <title> [<body> | -]");
          return N.call("notify", { title: title || "", body: body || "", subtitle: ctx.agent ? ctx.agent.name : "" }).then(function () { return { out: "", summary: "Notified: " + (title || body) }; });
        }
        if (sub === "clipboard") {
          rw();
          if (!rest.length) return readClip();
          var text = rest[0] === "-" ? String(ctx.stdin == null ? "" : ctx.stdin) : rest.join(" ");
          S.pasteboard.set(text);
          return N.call("clipboard.write", { text: text }).then(function () { return { out: "", summary: "Copied " + text.length + " characters to the Mac's clipboard" }; });
        }
        if (sub === "badge") { rw(); return N.call("badge", { text: rest.join(" ") }).then(function () { return rest.length ? "" : "Cleared the Dock badge."; }); }
        if (sub === "open") {
          rw();
          if (!/^(https?:|mailto:)/i.test(rest[0] || "")) throw usage("native open <http(s) or mailto URL>");
          return N.call("openExternal", { url: rest[0] }).then(function () { return "Opened " + rest[0] + "."; });
        }
        throw usage("unknown subcommand \"" + sub + "\" (native --help)");
      },
    });
  }

  // ======== 通知：App 不在前台时桌面的通知也发到 macOS（勿扰时不发）；点它回到对应的 App ========
  function hookDesk() {
    var D = window.TSU_DESK;
    regionsSoon();
    var mb = document.getElementById("menubar"), desk = document.getElementById("desktop");
    if (window.MutationObserver) {
      if (mb) new MutationObserver(regionsSoon).observe(mb, { childList: true, subtree: true, characterData: true });
      if (desk) new MutationObserver(regionsSoon).observe(desk, { attributes: true, attributeFilter: ["class"] });
      new MutationObserver(regionsSoon).observe(root, { attributes: true, attributeFilter: ["class"] });
    }
    if (!D || !D.notify || D.notify.nadosNative) return;
    var orig = D.notify, sent = {};
    var appOf = function (key) {
      var list = []; try { list = D.appList() || []; } catch (e) { /* 桌面还没好 */ }
      return list.filter(function (a) { return a.id === key || a.name === key; })[0] || null;
    };
    var wrapped = function (o) {
      var r = orig.apply(this, arguments);
      try {
        if (!active && r && r.id && o && (o.title || o.body) && localStorage.getItem("tsu-dnd") !== "on") {
          var a = appOf(o.app), key = "desk-" + r.id, name = (a && a.name) || o.app || "";
          sent[key] = { o: o, r: r, app: a };
          N.call("notify", { id: key, title: String(o.title || name), subtitle: o.title ? name : "", body: String(o.body || "") }).catch(function () { delete sent[key]; });
        }
      } catch (e) { console.error(e); }
      return r;
    };
    wrapped.nadosNative = true;
    D.notify = wrapped;
    N.on("notification-click", function (d) {
      var s = d && sent[d.id];
      if (!s) return;
      delete sent[d.id];
      try { s.r.close(); } catch (e) { /* 已经在通知中心里点掉了 */ }
      try { if (s.o.onClick) s.o.onClick(); else if (s.app) D.launch(s.app.id); } catch (e) { console.error(e); }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hookDesk); else hookDesk();
})();

// ---- 窗口的深浅色跟着页面（html 上有没有 light）：标题栏、原生右键菜单、系统对话框都跟着变（App 支持 window.appearance 时）----
//   主题是「跟随系统」时不定死（mode = auto）：定死了网页里读到的系统深浅（prefers-color-scheme）也跟着被定死，macOS 换深浅色就没反应了
(function () {
  var N = window.nadosNative, root = document.documentElement;
  if (!N || !N.call) return;
  var ok = false, last = "";
  var follows = function () { var S = window.STUDIO; if (!S || !S.get) return false; return (S.get("os") || "vscode") === "claude" ? S.get("claudeTheme") === "system" : S.get("colorScheme") === "auto"; };
  var sync = function () { if (!ok) return; var m = follows() ? "auto" : root.classList.contains("light") ? "light" : "dark"; if (m !== last) { last = m; N.call("window.appearance", { mode: m }).catch(function () {}); } };
  document.addEventListener("st-settings-changed", sync);
  document.addEventListener("st-theme-mode", sync);
  N.call("info").then(function (i) { ok = ((i && i.commands) || []).indexOf("window.appearance") >= 0; sync(); }).catch(function () {});
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["class"] });
})();
