// rdp.js —— 远程桌面：在标签页里用另一台电脑的桌面（RDP：Linux 的 GNOME 远程桌面、Windows），代替 Windows App。
//   「远程桌面」App（App 里一格、命令面板）：首页列出存着的连接（名字、地址、上次连接、缩略图），点一个在它自己的标签页里连；新建、编辑、从 .rdp 文件导入。
//   连着的那一页：原生在这一块叠一个视图画远端的画面、接键盘鼠标（app/Sources/RdpPanes.swift + 助手 vs-rdp）——位置、被菜单盖住时藏起来，同内置浏览器（TSU_WEB.track）；
//   页面管连接前后的那张卡片（输密码、正在连接、连不上、证书变了……）和标签栏右边的按钮（重新连接、发送按键、缩放、选项）。关掉标签页就断开。
//   只有 macOS 版 App 里有（要原生的那一块）；网页版、Linux 版写明
(function () {
  "use strict";
  var S = window.STUDIO, N = window.nadosNative;
  if (!S || !S.pages || !S.openPage) return;
  var I18N = window.TSU_I18N;
  var t = function (zh, en) { return I18N && I18N.lang && I18N.lang() === "en" ? en : zh; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var cmds = [];
  var native = function () { return !!N && cmds.indexOf("rdp.open") >= 0; };
  var ready = N && N.call ? N.call("info").then(function (i) { cmds = (i && i.commands) || []; }).catch(function () {}) : Promise.resolve();

  // ---- 图标 ----
  var LOGO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.75" y="4" width="18.5" height="12.5" rx="2"/><path d="M8.5 20h7M12 16.5V20"/><path d="M10.1 7.4l4.9 2-2.1.8-.8 2.1z"/></svg>';
  var IC = {
    reload: '<svg viewBox="0 0 16 16"><path d="M12.5 7.5A4.5 4.5 0 1 1 11 4.3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M11.5 2v2.8H8.7" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    keys: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="4" width="13" height="8.5" rx="1.6"/><path d="M4.2 6.7h.01M6.4 6.7h.01M8.6 6.7h.01M10.8 6.7h.01M4.8 9.9h6.4"/></svg>',
    fit: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2.5H2.5V6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/></svg>',
    one: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="1.8" y="3" width="12.4" height="10" rx="1.6"/><path d="M4.6 6.3l1.1-.8v5M8 7.1v.01M8 9.6v.01M10.3 6.3l1.1-.8v5"/></svg>',
    opts: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6"/><circle cx="10" cy="4.5" r="1.5"/><circle cx="6" cy="11.5" r="1.5"/></svg>',
  };

  // ---- 存着的连接（原生记在 UserDefaults；密码在钥匙串里，页面拿不到）----
  var hosts = [], hostsReady = false, avail = null;
  var homes = []; // 开着的首页（连接列表变了重画）
  function loadHosts() {
    if (!native()) return Promise.resolve([]);
    return N.call("rdp.hosts").then(function (l) {
      hosts = l || []; hostsReady = true;
      homes.forEach(function (V) { if (V.redraw) V.redraw(); });
      Object.keys(sessions).forEach(function (id) { var V = sessions[id]; if (V.P && V.P.win && !V.P.closed) V.P.win.syncTitles(); }); // 标签页上的名字
      syncCmds();
      return hosts;
    }, function () { return hosts; });
  }
  function hostOf(id) { return hosts.filter(function (h) { return h.id === id; })[0] || null; }
  function checkAvail(rebuild) {
    if (!native()) return Promise.resolve(null);
    return N.call("rdp.available", { rebuild: !!rebuild }).then(function (a) { avail = a; homes.forEach(function (V) { if (V.redraw) V.redraw(); }); return a; }, function () { return null; });
  }
  var addrOf = function (h) { return h ? (h.user ? h.user + "@" : "") + (/:/.test(h.host) ? "[" + h.host + "]" : h.host) + (h.port && h.port !== 3389 ? ":" + h.port : "") : ""; };
  var ago = function (ts) {
    if (!ts) return "";
    var s = Math.max(0, Date.now() / 1000 - ts), m = Math.round(s / 60), h = Math.round(s / 3600), d = Math.round(s / 86400);
    return s < 60 ? t("刚刚", "just now") : m < 60 ? t(m + " 分钟前", m + " min ago") : h < 24 ? t(h + " 小时前", h + " hr ago") : t(d + " 天前", d + (d === 1 ? " day ago" : " days ago"));
  };
  var thumbKey = function (id) { return "vs-rdp-thumb:" + id; };

  // ---- 连接的标签页 ----
  var sessions = {}; // V.id → V
  if (N && N.on) N.on("rdp.state", function (d) {
    var V = d && sessions[d.id];
    if (!V) return;
    var was = V.st && V.st.state;
    if (V.dev && devState(V, d)) return; // 「设备」里的电脑：要密码时问那台要、路断了换一条（devState 接着连）
    V.st = d;
    if (d.state === "connected" && was !== "connected") { V.lastFrame = ""; V.err = null; V.pwBusy = false; loadHosts(); }
    if (d.state === "error" && d.kind === "auth") V.err = t("用户名或密码不对。", "The user name or password is incorrect.");
    if (d.state === "closed" && d.by === "app") tunStop(V);
    paint(V);
    if (d.state === "connected" && V.shown() && document.activeElement && document.activeElement.closest && V.box && !document.activeElement.closest("input, textarea")) N.call("rdp.focus", { id: V.id }).catch(function () {});
  });
  // 每 30 秒存一张缩略图（首页的卡片上用）：只在看得见、连着的时候
  setInterval(function () {
    Object.keys(sessions).forEach(function (id) {
      var V = sessions[id];
      if (!V.st || V.st.state !== "connected" || !V.shown()) return;
      N.call("rdp.snapshot", { id: id, width: 360 }).then(function (u) { if (u) try { localStorage.setItem(thumbKey(V.hostId), u); } catch (e) { /* 满了 */ } }).catch(function () {});
    });
  }, 30000);

  function open(V, extra) {
    if (!native() || !V.hostId) return;
    V.st = V.st && V.st.state === "connected" ? V.st : { state: "connecting" };
    paint(V);
    var a = Object.assign({ id: V.id, host: V.hostId }, V.dev && V.route ? { route: V.route } : {}, extra || {});
    if (V.route && V.route.tunnel) tunFor(V);
    N.call("rdp.open", a).then(function (d) { if (d && sessions[V.id] && !(V.dev && devState(V, d))) { V.st = d; paint(V); } }, function (e) {
      V.st = { state: "error", kind: "other", msg: String((e && e.message) || e) };
      paint(V);
    });
  }

  // 卡片：连上以前、断了以后显示在那一块的中间（连着时原生的画面盖住整块，卡片藏起来）
  function cardHtml(V) {
    var st = V.st || { state: "connecting" }, h = hostOf(V.hostId), name = esc(h ? h.name : t("远程桌面", "Remote Desktop")), addr = esc(V.dev ? devAddr(V, h) : addrOf(h));
    var head = '<div class="rd-cic">' + LOGO + '</div><h2 class="rd-ct">' + name + '</h2><div class="rd-csub">' + addr + "</div>";
    var btn = function (act, label, primary) { return '<button type="button" data-act="' + act + '"' + (primary ? ' class="rd-primary"' : "") + ">" + esc(label) + "</button>"; };
    var detail = function (s) { return s ? '<details class="rd-det"><summary>' + esc(t("详细信息", "Details")) + "</summary><pre>" + esc(s) + "</pre></details>" : ""; };
    if (V.finding) return '<div class="rd-cic">' + LOGO + '</div><h2 class="rd-ct">' + esc(V.devName || "") + '</h2><div class="rd-wait"><i class="rd-spin"></i>' + esc(t("正在找到它的远程桌面…", "Finding its remote desktop…")) + "</div>";
    if (V.notFound) return '<div class="rd-cic">' + LOGO + '</div><h2 class="rd-ct">' + esc(V.devName || "") + '</h2><div class="rd-err">' + esc(V.notFound === "offline" ? t("它现在不在线", "It’s offline") : t("没找到它的远程桌面", "Couldn’t find its remote desktop")) + '</div><div class="rd-msg">' +
      esc(V.notFound === "offline" ? t("那台电脑上的 Vibing Studio 没在运行，或者没打开「设置 › 通用 › 其他设备使用这台电脑」。开着时这台 Mac 经它连它的桌面，不用隧道、不用密码。", "Vibing Studio isn’t running on that computer, or Settings › General › Allow Other Devices to Use This Computer is off there. With it on, this Mac reaches its desktop through it — no tunnel, no password.") :
        V.notFound === "nordp" ? t("那台电脑的远程桌面没有打开（GNOME：设置 › 系统 › 远程桌面 › 桌面共享）。", "Remote Desktop is off on that computer (GNOME: Settings › System › Remote Desktop › Desktop Sharing).") :
        t("要那台电脑的远程桌面开着（GNOME：设置 › 系统 › 远程桌面），并且那台电脑上的 Vibing Studio 打开了「其他设备使用这台电脑」，或者这台 Mac 能直接通到它（同一个网络、一条转到本机端口的隧道）。", "Its remote desktop must be on (GNOME: Settings › System › Remote Desktop), and either Vibing Studio on it allows other devices to use it, or this Mac can reach it directly (same network, or a tunnel to a local port).")) +
      (V.tunErr ? '<details class="rd-det"><summary>' + esc(t("详细信息", "Details")) + "</summary><pre>" + esc(V.tunErr) + "</pre></details>" : "") +
      '</div><div class="rd-cbtns"><button type="button" data-act="refind" class="rd-primary">' + esc(t("再找一次", "Try Again")) + "</button></div>";
    switch (st.state) {
      case "needpass":
      case "pass":
        return head + (V.err ? '<div class="rd-err">' + esc(V.err) + "</div>" : "") +
          '<form class="rd-pass" autocomplete="on">' + (h && !h.user ? '<input class="rd-in" type="text" name="user" autocomplete="username" spellcheck="false" autocapitalize="off" placeholder="' + esc(t("用户名", "User name")) + '" required>' : "") +
          '<input class="rd-in" type="password" name="pw" autocomplete="current-password" placeholder="' + esc(t("密码", "Password")) + '" required>' +
          '<label class="rd-chk"><input type="checkbox" name="remember" checked> ' + esc(t("记在钥匙串里", "Remember in Keychain")) + "</label>" +
          '<div class="rd-cbtns">' + btn("edit", t("编辑连接…", "Edit Connection…")) + '<button type="submit" class="rd-primary"' + (V.pwBusy ? " disabled" : "") + ">" + esc(t("连接", "Connect")) + "</button></div></form>";
      case "connecting":
        return head + '<div class="rd-wait"><i class="rd-spin"></i>' + esc(t("正在连接…", "Connecting…")) + '</div><div class="rd-cbtns">' + btn("cancel", t("取消", "Cancel")) + "</div>";
      case "reconnecting":
        return head + '<div class="rd-wait"><i class="rd-spin"></i>' + esc(t("连接断了，正在重新连接（第 " + (st.attempt || 1) + " 次）…", "Connection lost. Reconnecting (attempt " + (st.attempt || 1) + ")…")) + '</div><div class="rd-cbtns">' + btn("cancel", t("不连了", "Stop")) + btn("again", t("立即重试", "Retry Now"), true) + "</div>";
      case "cert":
        return head + '<div class="rd-warn"><b>' + esc(t("这台电脑的证书变了", "This computer’s certificate has changed")) + "</b>" +
          esc(t("如果你没有重装那台电脑、也没有重新设置它的远程桌面，可能有别的机器在冒充它。确认是你的那台再继续。", "If you haven’t reinstalled that computer or reset its remote desktop, another machine may be impersonating it. Continue only if you’re sure it’s yours.")) + "</div>" +
          '<dl class="rd-fp"><dt>' + esc(t("以前", "Before")) + "</dt><dd>" + esc(st.old || "—") + "</dd><dt>" + esc(t("现在", "Now")) + "</dt><dd>" + esc(st.fp || "—") + "</dd></dl>" +
          '<div class="rd-cbtns">' + btn("cancel", t("取消", "Cancel")) + btn("trust", t("信任新证书并连接", "Trust and Connect")) + "</div>";
      case "unavailable":
        if (st.need === "freerdp") return head + '<div class="rd-msg">' + esc(t("远程桌面用 FreeRDP 解码画面。在终端里安装它（Homebrew），装好后点「重新检查」。", "Remote Desktop uses FreeRDP to decode the picture. Install it with Homebrew in Terminal, then click Check Again.")) + '</div><pre class="rd-code">brew install freerdp</pre><div class="rd-cbtns">' + btn("install", t("在终端中安装", "Install in Terminal")) + btn("recheck", t("重新检查", "Check Again"), true) + "</div>";
        if (st.need === "clt") return head + '<div class="rd-msg">' + esc(t("这台 Mac 上的 FreeRDP 和 App 里带的组件对不上，需要现编一个：先装 Xcode 命令行工具。", "The FreeRDP on this Mac doesn’t match the bundled component, so it needs to be built here. Install the Xcode Command Line Tools first.")) + '</div><pre class="rd-code">xcode-select --install</pre><div class="rd-cbtns">' + btn("clt", t("安装命令行工具", "Install Command Line Tools")) + btn("recheck", t("重新检查", "Check Again"), true) + "</div>";
        return head + '<div class="rd-err">' + esc(t("远程桌面组件没能准备好。", "The remote desktop component couldn’t be prepared.")) + "</div>" + detail(st.detail) + '<div class="rd-cbtns">' + btn("rebuild", t("重新编译", "Rebuild"), true) + "</div>";
      case "error":
        var title = st.kind === "auth" ? t("用户名或密码不对", "Incorrect user name or password") :
          st.kind === "net" ? t("连接不上 " + addrOf(h).replace(/^[^@]*@/, ""), "Can’t reach " + addrOf(h).replace(/^[^@]*@/, "")) :
          st.kind === "ended" ? t("远程会话已结束", "The remote session ended") :
          st.kind === "crash" ? t("远程桌面组件意外退出", "The remote desktop component quit unexpectedly") : t("没能连接", "Couldn’t connect");
        var tip = st.kind === "net" ? t("看看那台电脑开着没有、远程桌面开着没有；经隧道连的，看隧道还在不在（本机的端口有没有在听）。", "Check that the computer is on with Remote Desktop enabled; if you connect through a tunnel, check that the tunnel is up (the local port is listening).") :
          st.kind === "ended" ? t("在那台电脑上注销了、被别的连接顶掉了，或者它的远程桌面重启了。", "The user signed out on that computer, another connection took over, or its remote desktop restarted.") : "";
        return head + '<div class="rd-err">' + esc(title) + "</div>" + (tip ? '<div class="rd-msg">' + esc(tip) + "</div>" : "") +
          detail([st.name, st.msg, st.log].filter(Boolean).join("\n")) +
          '<div class="rd-cbtns">' + btn("edit", t("编辑连接…", "Edit Connection…")) + (st.kind === "auth" ? btn("pass", t("重新输入密码", "Enter Password"), true) : btn("again", t("重新连接", "Reconnect"), true)) + "</div>";
      case "closed":
        return head + '<div class="rd-msg">' + esc(st.by === "remote" ? t("那台电脑断开了连接。", "The remote computer closed the connection.") : t("已断开。", "Disconnected.")) + '</div><div class="rd-cbtns">' + btn("edit", t("编辑连接…", "Edit Connection…")) + btn("again", t("重新连接", "Reconnect"), true) + "</div>";
      default:
        return "";
    }
  }
  function paint(V) {
    if (!V.host || !V.card) return;
    var st = (V.st && V.st.state) || "", up = st === "connected" && !V.editing;
    V.box.classList.toggle("on", up);
    var html = V.editing ? formHtml(hostOf(V.hostId), V) : up ? "" : cardHtml(V);
    if (V.card.dataset.h !== html) {
      var keepPw = V.card.querySelector('input[name="pw"]'), pw = keepPw ? keepPw.value : "";
      V.card.dataset.h = html;
      V.card.innerHTML = html;
      var np = V.card.querySelector('input[name="pw"]');
      if (np) { np.value = pw; if (V.shown()) setTimeout(function () { if (np.isConnected) np.focus(); }, 30); }
    }
    V.card.hidden = !html;
    V.card.classList.toggle("rd-formcard", !!V.editing);
    V.lastFrame = "";
    if (window.TSU_WEB && TSU_WEB.placeNow) TSU_WEB.placeNow(V);
    if (V.P && V.P.win) V.P.win.syncTitles();
  }

  // ---- 新建 / 编辑一个连接 ----
  function seg(name, opts, val) {
    return '<span class="rd-seg">' + opts.map(function (o) { return '<label><input type="radio" name="' + name + '" value="' + esc(o[0]) + '"' + (o[0] === val ? " checked" : "") + "><span>" + esc(o[1]) + "</span></label>"; }).join("") + "</span>";
  }
  function formHtml(h, V) {
    h = h || {};
    var fill = (V && V.fill) || {}, v = function (k, d) { return fill[k] !== undefined ? fill[k] : h[k] !== undefined ? h[k] : d; };
    var hostTxt = v("host", "") ? (/:/.test(v("host", "")) && !/^\[/.test(v("host", "")) && v("host", "").split(":").length > 2 ? "[" + v("host", "") + "]" : v("host", "")) + (v("port", 3389) && v("port", 3389) !== 3389 ? ":" + v("port", 3389) : "") : "";
    var tog = function (k, label, desc, d) { return '<label class="rd-opt"><span><b>' + esc(label) + "</b>" + (desc ? "<i>" + esc(desc) + "</i>" : "") + '</span><input type="checkbox" class="rd-sw" name="' + k + '"' + (v(k, d) ? " checked" : "") + "></label>"; };
    return '<form class="rd-form" autocomplete="off"><h2>' + esc(h.id ? t("编辑连接", "Edit Connection") : t("新建远程桌面连接", "New Remote Desktop Connection")) + "</h2>" +
      '<label class="rd-field"><span>' + esc(t("电脑地址", "Computer")) + '</span><input class="rd-in" name="host" required spellcheck="false" autocapitalize="off" placeholder="' + esc(t("例如 192.168.1.20 或 localhost:3389", "e.g. 192.168.1.20 or localhost:3389")) + '" value="' + esc(hostTxt) + '"></label>' +
      '<label class="rd-field"><span>' + esc(t("用户名", "User Name")) + '</span><input class="rd-in" name="user" spellcheck="false" autocapitalize="off" value="' + esc(v("user", "")) + '"></label>' +
      '<label class="rd-field"><span>' + esc(t("名称", "Name")) + '</span><input class="rd-in" name="name" placeholder="' + esc(t("显示在标签页上（可不填）", "Shown on the tab (optional)")) + '" value="' + esc(fill.name !== undefined ? fill.name : h.name && h.name !== h.host ? h.name : "") + '"></label>' +
      '<div class="rd-opts">' +
      tog("clip", t("同步剪贴板", "Share Clipboard"), t("两边复制的文字互通", "Text you copy on either side can be pasted on the other"), true) +
      tog("audio", t("播放远程声音", "Play Remote Audio"), "", false) +
      tog("dynres", t("分辨率跟随窗口", "Match Window Size"), t("那边支持时（GNOME 的「远程登录」可以；「桌面共享」跟着那边的显示器）", "When supported (GNOME Remote Login yes; Desktop Sharing follows that computer’s display)"), true) +
      '<div class="rd-opt"><span><b>' + esc(t("⌘ 键", "⌘ Key")) + "</b><i>" + esc(t("当 Ctrl：⌘C、⌘V、⌘Z 照常用；单按一下是 Super（活动）", "As Ctrl: ⌘C, ⌘V, ⌘Z work as usual; tap it alone for Super (Activities)")) + "</i></span>" + seg("cmd", [["ctrl", t("当 Ctrl", "As Ctrl")], ["super", t("当 Super", "As Super")]], v("cmd", "ctrl")) + "</div>" +
      '<div class="rd-opt"><span><b>' + esc(t("画质", "Quality")) + "</b><i>" + esc(t("清晰：文字边缘不发虚（AVC444）；省流量：AVC420", "Sharp: crisp text (AVC444); Light: AVC420, less data")) + "</i></span>" + seg("avc444", [["1", t("清晰", "Sharp")], ["0", t("省流量", "Light")]], v("avc444", true) ? "1" : "0") + "</div>" +
      '<div class="rd-opt"><span><b>' + esc(t("显示", "Display")) + "</b></span>" + seg("scale", [["fit", t("适应窗口", "Fit to Window")], ["1:1", t("原始大小", "Actual Size")]], v("scale", "fit")) + "</div>" +
      "</div>" +
      '<div class="rd-fbtns">' + '<button type="button" data-act="import">' + esc(t("从 .rdp 文件导入…", "Import .rdp File…")) + "</button>" +
      (h.id ? '<button type="button" data-act="remove" class="rd-danger">' + esc(t("删除连接", "Delete")) + "</button>" + (h.hasPass ? '<button type="button" data-act="forget">' + esc(t("忘记密码", "Forget Password")) + "</button>" : "") : "") +
      '<span class="rd-fill"></span><button type="button" data-act="cancel">' + esc(t("取消", "Cancel")) + '</button><button type="submit" class="rd-primary">' + esc(h.id ? t("保存", "Save") : t("保存并连接", "Save and Connect")) + "</button></div></form>";
  }
  function formValue(f) {
    var g = function (n) { var el = f.elements[n]; return el ? el.value.trim() : ""; }, ck = function (n) { var el = f.elements[n]; return !!(el && el.checked); };
    return { host: g("host"), user: g("user"), name: g("name"), clip: ck("clip"), audio: ck("audio"), dynres: ck("dynres"), cmd: g("cmd") || "ctrl", avc444: g("avc444") !== "0", scale: g("scale") || "fit" };
  }
  function importInto(V) {
    N.call("rdp.import").then(function (h) {
      if (!h) return;
      V.fill = Object.assign({}, V.fill || {}, h);
      if (V.redraw) V.redraw(); else paint(V);
    }).catch(function () {});
  }
  function saveForm(f, V, id, connect) {
    var val = formValue(f);
    if (!val.host) { f.elements.host.focus(); return Promise.resolve(null); }
    var old = id ? hostOf(id) : null;
    return N.call("rdp.saveHost", Object.assign({ id: id || "" }, val, { name: val.name || "" })).then(function (h) {
      V.fill = null;
      return loadHosts().then(function () { return h; });
    }, function (e) { alertMsg(t("没能保存", "Couldn’t Save"), String((e && e.message) || e)); return null; }).then(function (h) {
      if (h && connect && !old) openHost(h.id, V.P && V.P.win);
      return h;
    });
  }
  function alertMsg(title, msg) { if (window.TSU_DESK && TSU_DESK.alert) TSU_DESK.alert({ title: title, message: msg, icon: "caution" }); else window.alert(title + "\n" + msg); }
  function confirmDo(title, msg, ok, go) {
    if (window.TSU_DESK && TSU_DESK.alert) TSU_DESK.alert({ title: title, message: msg, icon: "caution", buttons: [{ label: t("取消", "Cancel"), role: "cancel" }, { label: ok, role: "default", run: go }] });
    else if (window.confirm(title)) go();
  }
  function removeHost(id, after) {
    var h = hostOf(id);
    confirmDo(t("删除「" + (h ? h.name : "") + "」？", "Delete “" + (h ? h.name : "") + "”?"), t("连着的会断开；记在钥匙串里的密码一起删掉。", "An open connection will be closed, and its password removed from the Keychain."), t("删除", "Delete"), function () {
      N.call("rdp.removeHost", { id: id }).then(function () {
        try { localStorage.removeItem(thumbKey(id)); } catch (e) { /* 没有 */ }
        Object.keys(sessions).forEach(function (sid) { var V = sessions[sid]; if (V.hostId === id && V.P && !V.P.closed) { delete sessions[sid]; closeTab(V.P); } }); // 开着的那几页一起关掉（连接没了，留着也连不上）
        loadHosts();
        if (after) after();
      }).catch(function () {});
    });
  }

  // ---- 从「设备」点一台电脑：找到通到它远程桌面的路（这台 Mac 上在听的端口里，证书是它名字的那个），存成一个连接、直接连——不用填 ----
  var devices = {}; // 连接的 id → 那台设备 { id, name }
  var devHostId = function (dev) { return "dev-" + String(dev.id).replace(/[^A-Za-z0-9-]/g, "").slice(0, 32); };
  function connectDevice(dev, tw) {
    if (!native() || !dev) return null;
    var hid = devHostId(dev);
    devices[hid] = { id: dev.id, name: dev.name || "" };
    return openHost(hid, tw);
  }
  function findDevice(V) {
    V.finding = true; V.notFound = false; paint(V);
    return N.call("rdp.discover", { name: V.dev.name }).then(function (r) {
      var m = r && r.match;
      if (!m) { V.finding = false; V.notFound = true; paint(V); return; }
      return N.call("rdp.saveHost", { id: V.hostId, name: V.dev.name, host: m.host + ":" + m.port, user: m.user || "" }).then(loadHosts).then(function () {
        V.finding = false; paint(V); open(V);
      });
    }, function (e) { V.finding = false; V.notFound = true; paint(V); });
  }
  // 拖进来 / 用它打开的 .rdp 文件：读出地址、用户名，存成一个连接，直接连
  function openFile(path, tw) {
    if (!native()) return null;
    return N.call("rdp.readFile", { path: path }).then(function (h) {
      if (!h || !h.host) throw new Error("no address");
      // 已经有同一个地址、同一个用户名的连接：用那个（不重复建）
      var norm = function (host, port) { var x = String(host || "").toLowerCase().replace(/^\[|\]$/g, ""); if (x === "localhost" || x === "::1") x = "127.0.0.1"; return x + ":" + (port || 3389); };
      var m0 = /^(.*?)(?::(\d+))?$/.exec(String(h.host).replace(/^\[([^\]]+)\]/, "$1")), want = norm(m0[1], +(m0[2] || h.port || 3389));
      var hit = hosts.filter(function (x) { return norm(x.host, x.port) === want && (x.user || "") === (h.user || ""); })[0];
      return (hit ? Promise.resolve(hit) : N.call("rdp.saveHost", Object.assign({ id: "" }, h))).then(function (x) { return loadHosts().then(function () { return openHost(x.id, tw); }); });
    }).catch(function (e) { alertMsg(t("打不开这个 .rdp 文件", "Couldn’t open this .rdp file"), String((e && e.message) || e)); });
  }
  // 打开一个连接（已经开着就切过去）
  function openHost(id, tw) { tw = tw || (window.TSU_TERM && TSU_TERM.front ? TSU_TERM.front() : null); return S.openPage(tw, "rdp", id); }

  // ---- 页面 ----
  var unsupported = function () {
    return '<div class="rd-home"><div class="rd-empty"><div class="rd-eic">' + LOGO + "</div><h2>" + esc(t("远程桌面需要 macOS 版 App", "Remote Desktop needs the macOS app")) + "</h2><p>" +
      esc(t("画面和键盘鼠标走 App 里的原生组件；网页版和 Linux 版还没有。", "The picture, keyboard and mouse go through a native component in the app; the web and Linux versions don’t have it yet.")) + "</p></div></div>";
  };
  function homeHtml() {
    var need = avail && avail.ok === false ? '<div class="rd-need"><b>' + esc(avail.need === "freerdp" ? t("需要 FreeRDP", "FreeRDP Required") : avail.need === "clt" ? t("需要 Xcode 命令行工具", "Command Line Tools Required") : t("远程桌面组件没能准备好", "Component Not Ready")) + "</b><span>" +
      esc(avail.need === "freerdp" ? t("远程桌面用 FreeRDP 解码画面：brew install freerdp", "Remote Desktop decodes the picture with FreeRDP: brew install freerdp") : avail.need === "clt" ? "xcode-select --install" : String(avail.detail || "").slice(0, 200)) + "</span>" +
      '<button type="button" data-act="' + (avail.need === "freerdp" ? "install" : avail.need === "clt" ? "clt" : "rebuild") + '">' + esc(avail.need === "freerdp" ? t("在终端中安装", "Install in Terminal") : avail.need === "clt" ? t("安装", "Install") : t("重新编译", "Rebuild")) + '</button><button type="button" data-act="recheck">' + esc(t("重新检查", "Check Again")) + "</button></div>" : "";
    var cards = hosts.map(function (h) {
      var th = ""; try { th = localStorage.getItem(thumbKey(h.id)) || ""; } catch (e) { th = ""; }
      var sub = [h.lastAt ? t("上次连接 " + ago(h.lastAt), "Last connected " + ago(h.lastAt)) : t("还没连过", "Never connected"), h.hasPass ? t("已记住密码", "Password saved") : ""].filter(Boolean).join(" · ");
      return '<div class="rd-host" data-id="' + esc(h.id) + '" tabindex="0"><div class="rd-thumb">' + (th ? '<img src="' + esc(th) + '" alt="">' : '<span class="rd-tic">' + LOGO + "</span>") + (h.open ? '<i class="rd-live">' + esc(t("已打开", "Open")) + "</i>" : "") + "</div>" +
        '<div class="rd-hn">' + esc(h.name) + '</div><div class="rd-ha">' + esc(addrOf(h)) + '</div><div class="rd-hl">' + esc(sub) + "</div>" +
        '<div class="rd-hbtns"><button type="button" data-act="edit" title="' + esc(t("编辑", "Edit")) + '">' + esc(t("编辑", "Edit")) + '</button><button type="button" data-act="remove" title="' + esc(t("删除", "Delete")) + '">' + esc(t("删除", "Delete")) + "</button></div></div>";
    }).join("");
    var empty = hostsReady && !hosts.length ? '<div class="rd-empty"><div class="rd-eic">' + LOGO + "</div><h2>" + esc(t("还没有远程桌面连接", "No remote desktop connections yet")) + "</h2><p>" +
      esc(t("用 RDP 连另一台电脑的桌面：Linux（GNOME 的远程桌面）、Windows。地址可以是局域网里的、也可以是 SSH 隧道转到本机的端口。", "Use another computer’s desktop over RDP — Linux (GNOME Remote Desktop) or Windows. The address can be on your network or a local port forwarded through an SSH tunnel.")) + "</p></div>" : "";
    return '<div class="rd-home"><div class="rd-head"><h1>' + esc(t("远程桌面", "Remote Desktop")) + '</h1><span class="rd-fill"></span><button type="button" data-act="import">' + esc(t("从 .rdp 文件导入…", "Import .rdp File…")) + '</button><button type="button" data-act="new" class="rd-primary">' + esc(t("新建连接", "New Connection")) + "</button></div>" +
      need + (cards ? '<div class="rd-grid">' + cards + "</div>" : "") + empty + "</div>";
  }

  function renderHome(host, P, V) {
    if (!V.homeInit) {
      V.homeInit = true;
      homes.push(V);
      V.redraw0 = V.redraw;
      host.addEventListener("click", function (e) {
        var b = e.target.closest("[data-act]"), card = e.target.closest(".rd-host"), a = b && b.dataset.act;
        if (a === "new") return S.openPage(P.win, "rdp", "new");
        if (a === "import") return N.call("rdp.import").then(function (h) {
          if (!h) return;
          pendingFill = h; // 新开的那一页画的时候拿去填表；已经开着「新建连接」那一页：直接填进去
          var pn = S.openPage(P.win, "rdp", "new"), Vn = pn && pn.program;
          if (Vn && Vn.formInit && pendingFill) { Vn.fill = pendingFill; pendingFill = null; if (Vn.redraw) Vn.redraw(); }
        }).catch(function () {});
        if (a === "install") return runInTerminal(P.win, "brew install freerdp");
        if (a === "clt") return runInTerminal(P.win, "xcode-select --install");
        if (a === "recheck" || a === "rebuild") return checkAvail(a === "rebuild");
        if (card && a === "edit") return S.openPage(P.win, "rdp", "edit:" + card.dataset.id);
        if (card && a === "remove") return removeHost(card.dataset.id);
        if (card) return openHost(card.dataset.id, P.win);
      });
      host.addEventListener("keydown", function (e) { var card = e.target.closest && e.target.closest(".rd-host"); if (card && e.key === "Enter") { e.preventDefault(); openHost(card.dataset.id, P.win); } });
    }
    var html = native() ? homeHtml() : unsupported();
    if (host.dataset.h !== html) { host.dataset.h = html; host.innerHTML = html; }
  }
  var pendingFill = null; // 首页「从 .rdp 文件导入…」：新开的那一页拿去填表

  // 在终端里跑一条命令（装 FreeRDP、命令行工具）：新开一个终端标签页
  function runInTerminal(tw, cmd) {
    tw = tw || (window.TSU_TERM && TSU_TERM.front ? TSU_TERM.front() : null);
    if (!tw || !tw.ws) return;
    var i0 = window.TSU_LOCAL && TSU_LOCAL.info && TSU_LOCAL.info(), p = tw.ws.newTab({ sh: { cwd: (i0 && i0.home) || "", pty: true } });
    if (p && p.program && p.program.type) p.program.type(cmd + "\r"); // 提示符出来以前排着队，出来了再打进去
  }
  var closeTab = function (P) { if (P && P.win && P.win.ws && P.win.ws.closePane) P.win.ws.closePane(P); };

  function renderForm(host, P, arg, V) {
    var id = /^edit:/.test(arg) ? arg.slice(5) : "";
    if (!V.formInit) {
      V.formInit = true;
      if (pendingFill) { V.fill = pendingFill; pendingFill = null; }
      host.addEventListener("submit", function (e) {
        var f = e.target.closest(".rd-form");
        if (!f) return;
        e.preventDefault();
        saveForm(f, V, id, true).then(function (h) { if (h) closeTab(P); }); // 新建的：连接的那一页已经开了，这一页关掉；编辑的：存好就关
      });
      host.addEventListener("click", function (e) {
        var b = e.target.closest("[data-act]");
        if (!b) return;
        var a = b.dataset.act;
        if (a === "cancel") return closeTab(P);
        if (a === "import") return importInto(V);
        if (a === "remove" && id) return removeHost(id, function () { closeTab(P); });
        if (a === "forget" && id) return N.call("rdp.forget", { id: id }).then(loadHosts).then(function () { V.redraw(); });
      });
    }
    var html = native() ? '<div class="rd-home rd-formpage">' + formHtml(id ? hostOf(id) : null, V) + "</div>" : unsupported();
    if (host.dataset.h !== html) { host.dataset.h = html; host.innerHTML = html; var f0 = host.querySelector('input[name="host"]'); if (f0 && !f0.value && V.shown()) setTimeout(function () { f0.focus(); }, 40); }
  }

  function renderSession(host, P, arg, V) {
    if (!V.id) {
      V.id = "rdp:" + arg; // 同一个窗口里一个连接一页（openPage 按 arg 认）：页面重新载入后原生那边认得回来，接着用
      V.hostId = arg;
      V.P = P;
      V.st = null;
      sessions[V.id] = V;
      host.innerHTML = '<div class="rd"><div class="rd-box"></div><div class="rd-card" hidden></div></div>';
      V.box = host.querySelector(".rd-box");
      V.card = host.querySelector(".rd-card");
      V.frameCmd = "rdp.frame";
      V.closeCmd = "rdp.close";
      V.want = function () { return !!(V.st && V.st.state === "connected") && !V.editing; };
      V.gone = function () { return P.closed; };
      if (window.TSU_WEB && TSU_WEB.track) TSU_WEB.track(V);
      host.addEventListener("submit", function (e) {
        var f = e.target.closest("form");
        if (!f) return;
        e.preventDefault();
        if (f.classList.contains("rd-pass")) {
          var pw = f.elements.pw.value, un = f.elements.user ? f.elements.user.value.trim() : "", hh = hostOf(V.hostId);
          if (!pw || (f.elements.user && !un)) return;
          V.pwBusy = true;
          var go = function () { open(V, { password: pw, remember: !!f.elements.remember.checked }); };
          if (un && hh) N.call("rdp.saveHost", Object.assign({}, hh, { user: un })).then(loadHosts).then(go, go); else go();
          return;
        }
        if (f.classList.contains("rd-form")) saveForm(f, V, V.hostId, false).then(function (h) { if (!h) return; V.editing = false; open(V, { again: true }); });
      });
      host.addEventListener("click", function (e) {
        var b = e.target.closest("[data-act]");
        if (!b) return;
        var a = b.dataset.act;
        if (a === "cancel") { if (V.editing) { V.editing = false; V.fill = null; paint(V); return; } N.call("rdp.close", { id: V.id }).catch(function () {}); V.st = { state: "closed", by: "app" }; paint(V); return; }
        if (a === "again") return open(V, { again: true });
        if (a === "refind" && V.dev) return findDevice(V);
        if (a === "pass") { V.st = { state: "pass" }; paint(V); return; }
        if (a === "edit") { V.editing = true; paint(V); return; }
        if (a === "trust") return N.call("rdp.trust", { id: V.id }).then(function (d) { if (d) { V.st = d; paint(V); } }).catch(function () {});
        if (a === "install") return runInTerminal(P.win, "brew install freerdp");
        if (a === "clt") return runInTerminal(P.win, "xcode-select --install");
        if (a === "recheck" || a === "rebuild") return checkAvail(a === "rebuild").then(function (av) { if (av && av.ok) open(V, { again: true }); else { V.st = Object.assign({ state: "unavailable" }, av || {}); paint(V); } });
        if (a === "import") return importInto(V);
        if (a === "remove") return removeHost(V.hostId, function () { closeTab(P); });
        if (a === "forget") return N.call("rdp.forget", { id: V.id }).then(loadHosts).then(function () { paint(V); });
      });
      // 点画面以外的那块（卡片的空白处）不抢焦点；连着时点了这一块（原生那块盖着，一般到不了这里）交给原生
      V.box.addEventListener("mousedown", function () { if (V.want()) N.call("rdp.focus", { id: V.id }).catch(function () {}); });
      (hostsReady ? Promise.resolve() : loadHosts()).then(function () {
        V.dev = devices[V.hostId] || null;
        if (V.dev && !hostOf(V.hostId)) { V.devName = V.dev.name; return findDevice(V); } // 从「设备」点进来、还没连过：先找路
        open(V);
      });
    }
    paint(V);
  }

  S.pages.rdp = {
    title: function (arg, V) {
      if (!arg) return t("远程桌面", "Remote Desktop");
      if (arg === "new") return t("新建连接", "New Connection");
      var h = hostOf(/^edit:/.test(arg) ? arg.slice(5) : arg);
      if (/^edit:/.test(arg)) return t("编辑：", "Edit: ") + (h ? h.name : "");
      return h ? h.name : t("远程桌面", "Remote Desktop");
    },
    address: function (arg) { var h = arg && !/^(new|edit:)/.test(arg) ? hostOf(arg) : null; return h ? "rdp://" + addrOf(h) : "rdp.local.paimon"; },
    icon: function () { return LOGO; },
    render: function (host, P, arg, V) {
      host.classList.add("st-pg-rdp");
      if (!cmds.length && N && N.call) { ready.then(function () { if (V.redraw) V.redraw(); }); }
      if (!native()) { var u = unsupported(); if (host.dataset.h !== u) { host.dataset.h = u; host.innerHTML = u; } return; }
      if (!hostsReady) loadHosts();
      if (avail === null) checkAvail();
      if (!arg) return renderHome(host, P, V);
      if (arg === "new" || /^edit:/.test(arg)) return renderForm(host, P, arg, V);
      renderSession(host, P, arg, V);
    },
    detach: function (host, P, arg, V) { if (V && V.id && native()) { N.call("rdp.frame", { id: V.id, x: 0, y: 0, w: 0, h: 0, visible: false }).catch(function () {}); V.lastFrame = ""; } },
    focus: function (host, P, arg, V) { if (V && V.id && V.want && V.want() && native()) N.call("rdp.focus", { id: V.id }).catch(function () {}); },
    tabActions: function (host, P, arg, V) {
      if (!V || !V.id || !native()) return [];
      var h = hostOf(V.hostId) || {}, up = V.st && V.st.state === "connected", one = h.scale === "1:1";
      var acts = [{ icon: IC.reload, title: t("重新连接", "Reconnect"), run: function () { open(V, { again: true }); } }];
      if (up) acts.push(
        { icon: IC.keys, title: t("发送按键", "Send Keys"), run: function () { keysMenu(V); } },
        { icon: one ? IC.fit : IC.one, title: one ? t("适应窗口", "Fit to Window") : t("原始大小", "Actual Size"), run: function () { setOpt(V, { scale: one ? "fit" : "1:1" }); } });
      acts.push({ icon: IC.opts, title: t("连接选项", "Connection Options"), run: function () { optsMenu(V); } });
      return acts;
    },
  };

  // ---- 标签栏右边那几个按钮的菜单 ----
  var lastBtn = null;
  document.addEventListener("mousedown", function (e) { var b = e.target.closest && e.target.closest(".st-tacts button, .st-facts button"); if (b) lastBtn = b; }, true);
  var at = function () { return lastBtn && lastBtn.isConnected ? { el: lastBtn, side: "below-end" } : undefined; };
  function keysMenu(V) {
    var send = function (c) { return function () { N.call("rdp.keys", { id: V.id, combo: c }).then(function () { N.call("rdp.focus", { id: V.id }); }).catch(function () {}); }; };
    S.menu([
      { label: t("Super（活动）", "Super (Activities)"), run: send("Super") },
      { label: "Ctrl+Alt+Delete", run: send("Ctrl+Alt+Delete") },
      { label: "Alt+Tab", run: send("Alt+Tab") },
      { label: "Alt+F4", run: send("Alt+F4") },
      { label: t("截屏（Print Screen）", "Print Screen"), run: send("Print") },
      { label: t("终端（Ctrl+Alt+T）", "Terminal (Ctrl+Alt+T)"), run: send("Ctrl+Alt+T") },
      { label: t("锁屏（Super+L）", "Lock Screen (Super+L)"), run: send("Super+L") },
    ], at());
  }
  function setOpt(V, o) {
    var h = hostOf(V.hostId);
    if (!h) return;
    N.call("rdp.saveHost", Object.assign({}, h, o)).then(loadHosts).then(function () { if (V.P && V.P.win) V.P.win.syncTitles(); if (window.TSU_TERM && TSU_TERM.front) { var tw = TSU_TERM.front(); if (tw && tw.ws && tw.ws.syncTitles) tw.ws.syncTitles(); } }).catch(function () {});
    if (o.scale || o.cmd || o.clip !== undefined) N.call("rdp.opts", Object.assign({ id: V.id }, o)).catch(function () {});
  }
  function optsMenu(V) {
    var h = hostOf(V.hostId) || {}, cmd = h.cmd || "ctrl", up = V.st && V.st.state === "connected";
    S.menu([
      { header: true, label: t("⌘ 键", "⌘ Key") },
      { label: t("当 Ctrl（单按是 Super）", "As Ctrl (tap for Super)"), radio: true, checked: cmd === "ctrl", run: function () { setOpt(V, { cmd: "ctrl" }); } },
      { label: t("当 Super", "As Super"), radio: true, checked: cmd === "super", run: function () { setOpt(V, { cmd: "super" }); } },
      { sep: true },
      { label: t("同步剪贴板", "Share Clipboard"), checked: h.clip !== false, run: function () { setOpt(V, { clip: h.clip === false }); } },
      { label: t("分辨率跟随窗口", "Match Window Size"), checked: h.dynres !== false, run: function () { setOpt(V, { dynres: h.dynres === false }); } },
      { sep: true },
      up ? { label: t("刷新画面", "Refresh Picture"), run: function () { N.call("rdp.refresh", { id: V.id }).catch(function () {}); } } : null,
      { label: t("编辑连接…", "Edit Connection…"), run: function () { V.editing = true; paint(V); } },
      h.hasPass ? { label: t("忘记密码", "Forget Password"), run: function () { N.call("rdp.forget", { id: V.id }).then(loadHosts).catch(function () {}); } } : null,
      up ? { label: t("断开连接", "Disconnect"), run: function () { N.call("rdp.close", { id: V.id }).catch(function () {}); V.st = { state: "closed", by: "app" }; paint(V); } } : null,
    ].filter(Boolean), at());
  }

  // ---- 命令面板：远程桌面首页；每个存着的连接一条 ----
  var cmdIds = [];
  function syncCmds() {
    if (!S.command) return;
    hosts.forEach(function (h) {
      var cid = "rdp.connect." + h.id;
      S.command(cid, { title: t("远程桌面：连接到 ", "Remote Desktop: Connect to ") + h.name, run: function (tw) { openHost(h.id, tw); } });
      if (cmdIds.indexOf(cid) < 0) cmdIds.push(cid);
    });
  }
  // 不再在「App」里单独一格（用户 2026-10-13：连的是自己账号里登录着的电脑——从「设备」点那台电脑就连，不用填地址）
  // 页面重新载入之前开着、现在没有标签页认领的连接：断开（15 秒后看一次——恢复出来的标签页那时都画过了）
  ready.then(function () {
    if (!native()) return;
    loadHosts();
    setTimeout(function () {
      N.call("rdp.list").then(function (l) { (l || []).forEach(function (s) { if (!sessions[s.id]) N.call("rdp.close", { id: s.id }).catch(function () {}); }); }).catch(function () {});
    }, 15000);
  });
  window.TSU_RDP = { open: openHost, hosts: function () { return hosts.slice(); }, reload: loadHosts, connectDevice: connectDevice, openFile: openFile, native: function () { return native(); } };
})();
