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
    pop: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="1.8" y="4.4" width="9.6" height="9.6" rx="1.5"/><path d="M8.8 1.8h5.4v5.4M14.2 1.8L8.2 7.8"/></svg>',
    pause: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M5.6 3.4v9.2M10.4 3.4v9.2"/></svg>',
    play: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M5 3.2v9.6l7.6-4.8z"/></svg>',
    full: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9.6 2.2h4.2v4.2M13.8 2.2L9.2 6.8M6.4 13.8H2.2V9.6M2.2 13.8l4.6-4.6"/></svg>',
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
    if (d.state === "connected" && was !== "connected") { V.lastFrame = ""; V.err = null; loadHosts(); }
    if (d.state === "error" && d.kind === "auth") V.err = t("用户名或密码不对。", "The user name or password is incorrect.");
    if (d.state === "closed" && d.by === "app") tunStop(V);
    paint(V);
    if (d.state === "connected" && V.shown() && document.activeElement && document.activeElement.closest && V.box && !document.activeElement.closest("input, textarea")) N.call("rdp.focus", { id: V.id }).catch(function () {});
  });
  // 每秒的统计（助手 → 原生 rdp.stats）：分辨率、帧率、码率、编码、往返时间——状态栏右边一行，「连接选项」最上面一行
  if (N && N.on) N.on("rdp.stats", function (d) {
    var V = d && sessions[d.id];
    if (!V) return;
    V.stats = d;
    if (S.statusSoon && V.P && V.P.win) S.statusSoon(V.P.win);
  });
  var mbps = function (b, ms) { var v = b * 8 / Math.max(1, ms) / 1000; return (v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2)) + " Mbps"; };
  function statsLine(V) {
    var d = V && V.stats;
    if (!d || !V.st || V.st.state !== "connected") return "";
    if (V.st.paused) return t("已暂停", "Paused") + (d.w && d.h ? " · " + d.w + "×" + d.h : "");
    var bits = [d.w && d.h ? d.w + "×" + d.h : "", Math.round(d.frames * 1000 / Math.max(1, d.ms)) + " fps", mbps(d.rx, d.ms)];
    if (d.codec) bits.push(d.codec);
    if (d.rtt) bits.push(d.rtt + " ms");
    return bits.filter(Boolean).join(" · ");
  }
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
    if (V.finding) return '<div class="rd-cic">' + LOGO + '</div><h2 class="rd-ct">' + esc(V.devName || "") + '</h2><div class="rd-wait"><i class="rd-spin"></i>' + esc(t("正在连接…", "Connecting…")) + "</div>";
    if (V.notFound) return '<div class="rd-cic">' + LOGO + '</div><h2 class="rd-ct">' + esc(V.devName || "") + '</h2><div class="rd-err">' +
      esc({ offline: t("它现在不在线", "It’s offline"), nordp: t("它的远程桌面没有打开", "Its remote desktop is off"), denied: t("它没有允许这台设备", "It hasn’t allowed this device"),
        noreply: t("它没有回应", "It isn’t responding"), update: t("要先更新这台的 Vibing Studio", "Update Vibing Studio on this Mac first") }[V.notFound] || t("连不上它的远程桌面", "Can’t reach its remote desktop")) + "</div>" +
      (V.tunErr ? '<details class="rd-det"><summary>' + esc(t("详细信息", "Details")) + "</summary><pre>" + esc(V.tunErr) + "</pre></details>" : "") +
      '<div class="rd-cbtns">' + (V.notFound === "update" ? '<button type="button" data-act="app-update" class="rd-primary">' + esc(t("更新", "Update")) + "</button>" : '<button type="button" data-act="refind" class="rd-primary">' + esc(t("重试", "Try Again")) + "</button>") + "</div>";
    if (st.popped) return head + '<div class="rd-msg">' + esc(t("在单独的窗口中", "In a separate window")) + '</div><div class="rd-cbtns">' + btn("front", t("显示窗口", "Show Window")) + btn("dock", t("放回这里", "Move Back Here"), true) + "</div>";
    switch (st.state) {
      case "needpass":
      case "pass":
        // 只在实在问不到时出现：只要密码（用户名知道的不问）；连上了记进钥匙串，下次不再问
        return head + (V.err ? '<div class="rd-err">' + esc(V.err) + "</div>" : "") +
          '<form class="rd-pass" autocomplete="on">' + (h && !h.user ? '<input class="rd-in" type="text" name="user" autocomplete="username" spellcheck="false" autocapitalize="off" placeholder="' + esc(t("用户名", "User name")) + '" required>' : "") +
          '<input class="rd-in" type="password" name="pw" autocomplete="current-password" placeholder="' + esc(t("密码", "Password")) + '" required>' +
          '<input type="hidden" name="remember" value="1">' +
          '<div class="rd-cbtns"><button type="submit" class="rd-primary">' + esc(t("连接", "Connect")) + "</button></div></form>";
      case "connecting":
        return head + '<div class="rd-wait"><i class="rd-spin"></i>' + esc(t("正在连接…", "Connecting…")) + '</div><div class="rd-cbtns">' + btn("cancel", t("取消", "Cancel")) + "</div>";
      case "reconnecting":
        return head + '<div class="rd-wait"><i class="rd-spin"></i>' + esc(t("连接断了，正在重新连接（第 " + (st.attempt || 1) + " 次）…", "Connection lost. Reconnecting (attempt " + (st.attempt || 1) + ")…")) + '</div><div class="rd-cbtns">' + btn("cancel", t("不连了", "Stop")) + btn("again", t("立即重试", "Retry Now"), true) + "</div>";
      case "cert":
        return head + '<div class="rd-warn"><b>' + esc(t("这台电脑的证书变了", "This computer’s certificate has changed")) + "</b></div>" +
          '<dl class="rd-fp"><dt>' + esc(t("以前", "Before")) + "</dt><dd>" + esc(st.old || "—") + "</dd><dt>" + esc(t("现在", "Now")) + "</dt><dd>" + esc(st.fp || "—") + "</dd></dl>" +
          '<div class="rd-cbtns">' + btn("cancel", t("取消", "Cancel")) + btn("trust", t("仍然连接", "Connect Anyway")) + "</div>";
      case "unavailable":
        if (st.need === "freerdp") return head + '<div class="rd-msg">' + esc(t("需要 FreeRDP", "FreeRDP is required")) + '</div><pre class="rd-code">brew install freerdp</pre><div class="rd-cbtns">' + btn("install", t("在终端中安装", "Install in Terminal")) + btn("recheck", t("重新检查", "Check Again"), true) + "</div>";
        if (st.need === "clt") return head + '<div class="rd-msg">' + esc(t("需要 Xcode 命令行工具", "The Xcode Command Line Tools are required")) + '</div><pre class="rd-code">xcode-select --install</pre><div class="rd-cbtns">' + btn("clt", t("安装命令行工具", "Install Command Line Tools")) + btn("recheck", t("重新检查", "Check Again"), true) + "</div>";
        return head + '<div class="rd-err">' + esc(t("远程桌面组件没能准备好。", "The remote desktop component couldn’t be prepared.")) + "</div>" + detail(st.detail) + '<div class="rd-cbtns">' + btn("rebuild", t("重新编译", "Rebuild"), true) + "</div>";
      case "error":
        var title = st.kind === "auth" ? t("用户名或密码不对", "Incorrect user name or password") :
          st.kind === "net" ? t("连接不上 " + addrOf(h).replace(/^[^@]*@/, ""), "Can’t reach " + addrOf(h).replace(/^[^@]*@/, "")) :
          st.kind === "ended" ? t("远程会话已结束", "The remote session ended") :
          st.kind === "crash" ? t("远程桌面组件意外退出", "The remote desktop component quit unexpectedly") : t("没能连接", "Couldn’t connect");
        return head + '<div class="rd-err">' + esc(title) + "</div>" +
          detail([st.name, st.msg, st.log].filter(Boolean).join("\n")) +
          '<div class="rd-cbtns">' + (st.kind === "auth" ? btn("pass", t("输入密码", "Enter Password"), true) : btn("again", t("重新连接", "Reconnect"), true)) + "</div>";
      case "closed":
        return head + '<div class="rd-msg">' + esc(st.by === "remote" ? t("那台电脑断开了连接", "The remote computer closed the connection") : t("已断开", "Disconnected")) + '</div><div class="rd-cbtns">' + btn("again", t("重新连接", "Reconnect"), true) + "</div>";
      default:
        return "";
    }
  }
  function paint(V) {
    if (!V.host || !V.card) return;
    var st = (V.st && V.st.state) || "", up = st === "connected" && !V.editing && !(V.st && V.st.popped);
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
      '<label class="rd-field"><span>' + esc(t("电脑地址", "Computer")) + '</span><input class="rd-in" name="host" required spellcheck="false" autocapitalize="off" value="' + esc(hostTxt) + '"></label>' +
      '<label class="rd-field"><span>' + esc(t("用户名", "User Name")) + '</span><input class="rd-in" name="user" spellcheck="false" autocapitalize="off" value="' + esc(v("user", "")) + '"></label>' +
      '<label class="rd-field"><span>' + esc(t("名称", "Name")) + '</span><input class="rd-in" name="name" value="' + esc(fill.name !== undefined ? fill.name : h.name && h.name !== h.host ? h.name : "") + '"></label>' +
      '<div class="rd-opts">' +
      tog("clip", t("同步剪贴板", "Share Clipboard"), "", true) +
      tog("audio", t("播放远程声音", "Play Remote Audio"), "", false) +
      tog("dynres", t("分辨率跟随窗口", "Match Window Size"), "", true) +
      '<div class="rd-opt"><span><b>' + esc(t("⌘ 键", "⌘ Key")) + "</b></span>" + seg("cmd", [["ctrl", t("当 Ctrl", "As Ctrl")], ["super", t("当 Super", "As Super")]], v("cmd", "ctrl")) + "</div>" +
      '<div class="rd-opt"><span><b>' + esc(t("画质", "Quality")) + "</b></span>" + seg("avc444", [["1", t("清晰", "Sharp")], ["0", t("省流量", "Light")]], v("avc444", true) ? "1" : "0") + "</div>" +
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

  // ---- 从「设备」点一台电脑：不用填——找路、要账号都自己来 ----
  //   路：这台 Mac 上通到它的端口（隧道转过来的；证书上的名字就是那台电脑的名字，rdp.discover）→ 都没有就经 Vibing Studio 自己的连接（中转，
  //   那台电脑上的 App 在那边接到它本机的远程桌面端口；要那台打开了「其他设备使用这台电脑」）。
  //   账号：钥匙串里没有、或者不对了：经同一条连接问那台电脑（GNOME 远程桌面自己记着的：grdctl status --show-credentials），连上了才记进钥匙串；
  //   问不到（不是 GNOME 的远程桌面、那台还没允许这台 Mac……）才让人输
  var devices = {}; // 连接的 id → 那台设备 { id, name, relay }
  var devHostId = function (dev) { return "dev-" + String(dev.id).replace(/[^A-Za-z0-9-]/g, "").slice(0, 32); };
  var tunnelOK = function () { return cmds.indexOf("rdp.tunWrite") >= 0; }; // 新版 App（300 起）才有中转通道
  var newOK = function () { return cmds.indexOf("rdp.pause") >= 0; }; // 新版 App（303 起）：单独的窗口、暂停、帧率上限、固定分辨率、统计浮层
  function connectDevice(dev, tw) {
    if (!native() || !dev) return null;
    var hid = devHostId(dev);
    devices[hid] = { id: dev.id, name: dev.name || "", relay: dev.host || "" };
    var V0 = sessions["rdp:" + hid];
    if (V0 && V0.dev && dev.host) V0.dev.relay = dev.host;
    return openHost(hid, tw);
  }
  // 存着的「设备」连接：记着它是哪台设备（重新载入、下次打开时认得）
  var devOfHost = function (h) { return h && h.device ? { id: h.device, name: h.name || "", relay: h.relay || "" } : null; };
  var devAddr = function (V, h) {
    var u = h && h.user ? h.user : "";
    var via = V.route && V.route.tunnel ? t("经 Vibing Studio 连接", "via Vibing Studio") : V.route && V.route.host ? (V.route.host === "127.0.0.1" ? t("本机端口 ", "local port ") + V.route.port : addrOf({ host: V.route.host, port: V.route.port })) : "";
    return [u, via].filter(Boolean).join(" · ");
  };
  function linkFor(V) { var r = V.dev && V.dev.relay; return r && window.TSU_RLINK ? TSU_RLINK.open(r) : null; }
  // 同一个远程桌面已经有一个连得上的连接（以前导入的 .rdp、自己建的，记着用户名和密码）：「设备」里的这台照它连——
  //   用户名、地址、证书照抄，密码原生那边按「用户名@地址:端口」找得到（RdpStore.legacyAccount），不用再问
  var normAddr = function (host, port) { var x = String(host || "").toLowerCase().replace(/^\[|\]$/g, ""); if (x === "localhost" || x === "::1") x = "127.0.0.1"; return x + ":" + (+port || 3389); };
  var normFp = function (s) { return String(s || "").replace(/[^0-9a-f]/gi, "").toLowerCase(); };
  function sibling(V, host, port, fp) {
    var want = host ? normAddr(host, port) : "", f = normFp(fp);
    var l = hosts.filter(function (x) { return x.id !== V.hostId && x.user && (f && normFp(x.pin) === f || want && normAddr(x.host, x.port) === want); });
    l.sort(function (a, b) { return (b.hasPass ? 1 : 0) - (a.hasPass ? 1 : 0) || (b.lastAt || 0) - (a.lastAt || 0); }); // 记着密码的、最近连上过的优先；只有用户名的也照抄（至少不用问用户名）
    return l[0] || null;
  }
  // 照着那个连接改这台的：地址、用户名（连上过的那条路）。已经一样的不算
  var differs = function (h, x) { return !!x && (!h || h.user !== x.user || h.host !== x.host || (+h.port || 3389) !== (+x.port || 3389)); };
  function adopt(V, x) {
    V.route = { host: x.host, port: x.port || 3389 };
    return saveDevHost(V, { host: (/:/.test(x.host) ? "[" + x.host + "]" : x.host) + ":" + (x.port || 3389), via: "", user: x.user });
  }
  function saveDevHost(V, more) {
    var h = hostOf(V.hostId) || {};
    var o = Object.assign({}, h, { id: V.hostId, name: V.dev.name || h.name || "", device: V.dev.id, relay: V.dev.relay || h.relay || "" }, more || {});
    if (!o.host) o.host = String(V.dev.name || "device").replace(/[^A-Za-z0-9._-]/g, "") || "device"; // 还没有直连的路：先写它的名字（连的时候走 route）
    return N.call("rdp.saveHost", o).then(loadHosts);
  }
  function findDevice(V) {
    V.finding = true; V.notFound = false; V.tunErr = ""; V.st = null; paint(V);
    var L = linkFor(V);
    if (L) creds(V); // 一边找路，一边先问它要账号（中转那边慢）
    return N.call("rdp.discover", { name: V.dev.name }).then(function (r) {
      var m = r && r.match;
      if (m) {
        V.route = { host: m.host, port: m.port }; V.routeFp = m.fp || "";
        var sib = sibling(V, m.host, m.port, m.fp);
        if (sib && differs(hostOf(V.hostId), sib)) return adopt(V, sib).then(function () { V.finding = false; open(V, { again: true }); });
        return saveDevHost(V, { host: m.host + ":" + m.port, via: "", user: (hostOf(V.hostId) || {}).user || m.user || "" }).then(function () { V.finding = false; go(V); });
      }
      if (!L || !tunnelOK()) { V.finding = false; V.notFound = L ? "update" : V.dev.relay ? "offline" : true; paint(V); return; } // 这台的 App 太旧：没有中转通道

      // 这台 Mac 通不到它：经 Vibing Studio 自己的连接
      return creds(V).then(function (c) {
        V.finding = false;
        if (!c) { V.credP = null; V.notFound = L.state === "offline" ? "offline" : V.credWhy || "nordp"; paint(V); return; } // 下次「重试」重新问
        V.route = { tunnel: true }; V.routeFp = "";
        return saveDevHost(V, { rport: c.port || 3389 }).then(function () { go(V); });
      });
    }, function () { V.finding = false; V.notFound = true; paint(V); });
  }
  // 连：问到了能用的账号就用它（钥匙串里的可能是旧的）；没有就照常连（钥匙串里的，没有再问）
  function go(V) {
    var c = usable(V);
    if (c && !V.credUsed) return withCred(V, c);
    open(V, { again: true });
  }
  // 用问到的账号连：用户名、端口存进连接；密码连上了才记进钥匙串（原生那边）
  function withCred(V, c) {
    V.credUsed = true; V.credTried = true;
    var h = hostOf(V.hostId) || {}, more = {};
    if (h.user !== c.user) more.user = c.user;
    if (c.port && h.rport !== c.port) more.rport = c.port;
    var go2 = function () { open(V, { password: c.pass, remember: true, again: true }); };
    return (Object.keys(more).length ? saveDevHost(V, more) : Promise.resolve()).then(go2, go2);
  }
  // 问到的账号是不是这条路上那个远程桌面的：它的证书指纹（grdctl 给的）和这条路上的（刚找到的、记着的）对得上——
  //   对不上的（比如这条路通的是「远程登录」，问到的是「桌面共享」的账号）不用，让人输
  function usable(V) {
    var g = V.cred;
    if (!g || !g.user || !g.pass || g.pass === "(hidden)") return null;
    var norm = function (s) { return String(s || "").replace(/[^0-9a-f]/gi, "").toLowerCase(); };
    var want = norm(V.routeFp || (hostOf(V.hostId) || {}).pin), fp = norm(g.fp);
    return want && fp && want.length === fp.length && want !== fp ? null : g;
  }
  // 问那台电脑它的远程桌面账号（GNOME 远程桌面：grdctl；没有、关着的回 null）。一个标签页问一次
  function creds(V) {
    if (V.credP) return V.credP;
    var L = linkFor(V);
    if (!L) return Promise.resolve(null);
    V.credWhy = "";
    V.credP = TSU_RLINK.exec(L, "LC_ALL=C grdctl status --show-credentials 2>&1", 15000).then(function (r) {
      var g = parseGrd(r && r.out);
      if (!g || !g.enabled) { V.credWhy = "nordp"; return null; }
      V.cred = g;
      return g;
    }, function (e) { V.credWhy = e && e.code === "E_DENIED" ? "denied" : e && e.code === "E_TIMEOUT" ? "noreply" : "nordp"; return null; });
    return V.credP;
  }
  // grdctl status 的样子：「RDP:」下面一行一项（Status: enabled、Port: 3389、TLS fingerprint: …、Username: …、Password: …）
  function parseGrd(s) {
    s = String(s || "").replace(/\x1b\[[0-9;]*m/g, "");
    var m = /(?:^|\n)RDP:\n((?:[ \t]+[^\n]*(?:\n|$))*)/.exec(s);
    if (!m) return null;
    var o = {};
    m[1].split("\n").forEach(function (l) { var k = /^[ \t]+([^:]+):[ ]?(.*)$/.exec(l); if (k) o[k[1].trim().toLowerCase()] = k[2]; });
    return { enabled: /^enabled/i.test(o.status || ""), port: +o.port || 0, fp: o["tls fingerprint"] || "", user: o.username || "", pass: o.password || "" };
  }
  // 「设备」连接的状态：要密码 → 问那台要；路断了 → 重新找（直连的）；中转的那头起不来 → 写明。处理了回 true（这一条不再往下画）
  function devState(V, d) {
    var st = d.state;
    if (st === "connected") {
      V.credUsed = false; V.refound = false;
      var via = V.route && V.route.tunnel ? "tunnel" : "", h0 = hostOf(V.hostId) || {};
      if ((h0.via || "") !== via) saveDevHost(V, { via: via });
      return false;
    }
    if (st === "needpass" || st === "error" && d.kind === "auth") {
      if (V.credBusy) return true; // 正在问（原生的事件和 rdp.open 的回复各报一次）
      var sb = !V.sibTried && V.route && !V.route.tunnel ? sibling(V, V.route.host, V.route.port, V.routeFp || (hostOf(V.hostId) || {}).pin) : null;
      if (sb && differs(hostOf(V.hostId), sb)) { V.sibTried = true; V.st = { state: "connecting" }; paint(V); adopt(V, sb).then(function () { open(V, { again: true }); }); return true; }
      if (V.credTried || !V.dev.relay) return false;
      V.credTried = true; V.credBusy = true;
      V.st = { state: "connecting" }; paint(V);
      creds(V).then(function () {
        V.credBusy = false;
        if (!sessions[V.id]) return;
        var c = usable(V);
        if (c) return withCred(V, c);
        V.st = d; paint(V); // 问不到：让人输
      });
      return true;
    }
    if (st === "error" && d.kind === "net" && V.route && !V.route.tunnel && !V.refound) { V.refound = true; findDevice(V); return true; } // 隧道断了、换了端口：重新找
    if (st === "error" && V.route && V.route.tunnel && V.tunErr && d.kind !== "auth") { var L0 = linkFor(V); V.notFound = L0 && L0.state === "offline" ? "offline" : "nordp"; V.st = d; paint(V); return true; }
    return false;
  }
  // ---- 中转通道的那一头：原生在本机开的端口每来一条连接（rdp.tun open），在那台电脑上起一个小程序（python3）接到它本机的远程桌面端口，
  //   两边的字节经中转来回（一行一段 base64）。那台电脑上的 App 不用更新：用的是它本来就给的「起一个程序、写它的输入、读它的输出」
  var PY = [
    "import socket,sys,base64,threading,time",
    "h,p=sys.argv[1],int(sys.argv[2])",
    "try:",
    " s=socket.create_connection((h,p),10)",
    "except Exception as e:",
    " sys.stderr.write('connect %s:%d: %s\\n'%(h,p,e));sys.exit(3)",
    "s.setsockopt(socket.IPPROTO_TCP,socket.TCP_NODELAY,1)",
    "s.settimeout(5)",
    "last=[time.time()]",
    "def up():",
    " r=sys.stdin.buffer",
    " while True:",
    "  l=r.readline()",
    "  if not l:break",
    "  last[0]=time.time()",
    "  l=l.strip()",
    "  if l:",
    "   try:s.sendall(base64.b64decode(l))",
    "   except Exception:break",
    " try:s.shutdown(socket.SHUT_WR)",
    " except Exception:pass",
    "threading.Thread(target=up,daemon=True).start()",
    "w=sys.stdout",
    "while True:",
    " try:d=s.recv(262144)",
    " except socket.timeout:",
    "  if time.time()-last[0]>90:break",
    "  continue",
    " except Exception:break",
    " if not d:break",
    " w.write(base64.b64encode(d).decode()+'\\n');w.flush()",
  ].join("\n");
  var rid = function () { return Math.random().toString(36).slice(2, 10); };
  var TPK = "vs-rdp-tunprocs"; // 那台电脑上还开着的小程序（这一页重新载入后收拾上一回的）
  var tprocs = function () { try { return JSON.parse(localStorage.getItem(TPK) || "{}") || {}; } catch (e) { return {}; } };
  var setTprocs = function (o) { try { localStorage.setItem(TPK, JSON.stringify(o)); } catch (e) { /* 满了 */ } };
  function tunFor(V) {
    if (V.tun) return V.tun;
    var L = linkFor(V);
    if (!L) return null;
    var T = V.tun = { L: L, conns: {}, byPid: {} };
    var old = tprocs(), mine = old[L.dev] || [];
    mine.forEach(function (p) { L.call("proc.kill", { id: p }, 10000).catch(function () {}); }); // 上一回（页面重新载入、App 退出前）留下的
    old[L.dev] = []; setTprocs(old);
    T.offData = L.on("proc.data", function (x) {
      var C = x && T.byPid[x.id];
      if (!C) return;
      if (x.e) C.err = (C.err + x.e).slice(-2000);
      if (!x.o) return;
      C.buf += x.o;
      var i = C.buf.lastIndexOf("\n");
      if (i < 0) return;
      var lines = C.buf.slice(0, i).split("\n").filter(Boolean);
      C.buf = C.buf.slice(i + 1);
      if (lines.length && !C.ended) { C.got = true; V.tunErr = ""; N.call("rdp.tunWrite", { id: V.id, c: C.c, b64: lines }).catch(function () {}); }
    });
    T.offExit = L.on("proc.exit", function (x) {
      var C = x && T.byPid[x.id];
      if (!C) return;
      forget(T, C);
      if (!C.got) V.tunErr = (C.err || "").trim() || "exit " + x.code; // 一个字节都没回就退了：python3 没有、端口不对……
      if (!C.ended) N.call("rdp.tunEnd", { id: V.id, c: C.c }).catch(function () {});
    });
    T.beat = setInterval(function () { Object.keys(T.byPid).forEach(function (p) { var C = T.byPid[p]; if (C.up && !C.ended) T.L.call("proc.write", { id: p, data: "\n" }, 20000).catch(function () {}); }); }, 30000); // 那边 90 秒没收到就自己退
    return T;
  }
  function forget(T, C) {
    delete T.byPid[C.pid]; delete T.conns[C.c];
    var o = tprocs(); o[T.L.dev] = (o[T.L.dev] || []).filter(function (p) { return p !== C.pid; }); setTprocs(o);
  }
  function tunStop(V) {
    var T = V.tun;
    if (!T) return;
    V.tun = null;
    clearInterval(T.beat); T.offData(); T.offExit();
    Object.keys(T.byPid).forEach(function (p) { var C = T.byPid[p]; T.L.call("proc.kill", { id: p }, 10000).catch(function () {}); forget(T, C); });
  }
  if (N && N.on) N.on("rdp.tun", function (d) {
    var V = d && sessions[d.id], T = V && (V.tun || (V.dev && tunFor(V)));
    if (!T) { if (d && !d.end) N.call("rdp.tunEnd", { id: d.id, c: d.c }).catch(function () {}); return; }
    var C = T.conns[d.c];
    if (d.open) {
      C = { c: d.c, pid: "rdt" + rid(), q: [], up: false, buf: "", err: "" };
      T.conns[d.c] = C; T.byPid[C.pid] = C;
      var o = tprocs(); (o[T.L.dev] = o[T.L.dev] || []).push(C.pid); setTprocs(o);
      var port = (hostOf(V.hostId) || {}).rport || 3389;
      T.L.call("proc.start", { id: C.pid, argv: ["python3", "-u", "-c", PY, "127.0.0.1", String(port)] }, 20000).then(function () {
        C.up = true;
        if (C.q.length) T.L.call("proc.write", { id: C.pid, data: C.q.join("\n") + "\n" }, 20000).catch(function () {});
        C.q = [];
        if (C.ended) T.L.call("proc.close", { id: C.pid }, 10000).catch(function () {});
      }, function (e) {
        V.tunErr = String((e && e.message) || e);
        forget(T, C);
        N.call("rdp.tunEnd", { id: V.id, c: d.c }).catch(function () {});
      });
      return;
    }
    if (!C) { if (!d.end) N.call("rdp.tunEnd", { id: d.id, c: d.c }).catch(function () {}); return; } // 认不得的（这一页重新载入以前开的）：关掉，助手自己重连
    if (d.b64) { if (C.up) T.L.call("proc.write", { id: C.pid, data: d.b64 + "\n" }, 20000).catch(function () {}); else C.q.push(d.b64); }
    if (d.end) {
      C.ended = true;
      if (C.up) T.L.call("proc.close", { id: C.pid }, 10000).catch(function () {});
      setTimeout(function () { if (T.byPid[C.pid]) { T.L.call("proc.kill", { id: C.pid }, 10000).catch(function () {}); forget(T, C); } }, 10000);
    }
  });
  // 关了的标签页：中转那一头收拾掉
  setInterval(function () { Object.keys(sessions).forEach(function (id) { var V = sessions[id]; if (V.P && V.P.closed) { delete sessions[id]; tunStop(V); } }); }, 2000);

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
    return '<div class="rd-home"><div class="rd-empty"><div class="rd-eic">' + LOGO + "</div><h2>" + esc(t("远程桌面需要 macOS 版 App", "Remote Desktop needs the macOS app")) + "</h2></div></div>";
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
    var empty = hostsReady && !hosts.length ? '<div class="rd-empty"><div class="rd-eic">' + LOGO + "</div><h2>" + esc(t("还没有远程桌面连接", "No remote desktop connections yet")) + "</h2></div>" : "";
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
      V.want = function () { return !!(V.st && V.st.state === "connected") && !V.editing && !V.st.popped; };
      V.gone = function () { return P.closed; };
      if (window.TSU_WEB && TSU_WEB.track) TSU_WEB.track(V);
      host.addEventListener("submit", function (e) {
        var f = e.target.closest("form");
        if (!f) return;
        e.preventDefault();
        if (f.classList.contains("rd-pass")) {
          var pw = f.elements.pw.value, un = f.elements.user ? f.elements.user.value.trim() : "", hh = hostOf(V.hostId);
          if (!pw || (f.elements.user && !un)) return;
          V.err = null;
          var go = function () { open(V, { password: pw, remember: true, again: true }); };
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
        if (a === "front") return popOut(V, "window");
        if (a === "dock") return popOut(V, "tab");
        if (a === "refind" && V.dev) return findDevice(V);
        if (a === "app-update" && window.STUDIO && STUDIO.act) return STUDIO.act(P.win, "app-update");
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
        var h = hostOf(V.hostId), dv = devices[V.hostId];
        V.dev = dv || devOfHost(h);
        if (!V.dev) return open(V);
        V.devName = V.dev.name;
        if (!V.dev.relay && h && h.relay) V.dev.relay = h.relay;
        if (!h || !h.device) return findDevice(V); // 从「设备」点进来、还没连过：先找路
        var sib0 = !h.hasPass && h.via !== "tunnel" ? sibling(V, h.host, h.port, h.pin) : null; // 没记密码、同一个远程桌面另有连得上的：照它
        if (sib0 && differs(h, sib0)) return adopt(V, sib0).then(function () { open(V); });
        V.route = h.via === "tunnel" ? { tunnel: true } : { host: h.host, port: h.port }; // 上一次通的那条；不通了 devState 再找
        if (dv && dv.relay && dv.relay !== h.relay) saveDevHost(V);
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
      return h ? h.name : devices[arg] && devices[arg].name ? devices[arg].name : t("远程桌面", "Remote Desktop"); // 「设备」里点的、还没存成连接的：写那台电脑的名字
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
        { icon: one ? IC.fit : IC.one, title: one ? t("适应窗口", "Fit to Window") : t("原始大小", "Actual Size"), run: function () { setOpt(V, { scale: one ? "fit" : "1:1" }); } },
        newOK() ? { icon: V.st.paused ? IC.play : IC.pause, title: V.st.paused ? t("继续", "Resume") : t("暂停", "Pause"), run: function () { pause(V); } } : null,
        newOK() ? { icon: IC.pop, title: t("在单独的窗口中打开", "Open in Separate Window"), run: function () { popOut(V, "window"); } } : null,
        newOK() ? { icon: IC.full, title: t("全屏", "Full Screen"), run: function () { popOut(V, "fullscreen"); } } : null);
      acts.push({ icon: IC.opts, title: t("连接选项", "Connection Options"), run: function () { optsMenu(V); } });
      return acts.filter(Boolean);
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
  // 改了马上用：⌘ 键、剪贴板、缩放、分辨率、帧率原生那边直接换；画质、声音要重新连一次（连接时定的）
  function setOpt(V, o) {
    var h = hostOf(V.hostId);
    if (!h) return;
    N.call("rdp.saveHost", Object.assign({}, h, o)).then(loadHosts).then(function () {
      if (V.P && V.P.win) V.P.win.syncTitles();
      if (window.TSU_TERM && TSU_TERM.front) { var tw = TSU_TERM.front(); if (tw && tw.ws && tw.ws.syncTitles) tw.ws.syncTitles(); }
      if (o.avc444 !== undefined || o.audio !== undefined) open(V, { again: true });
    }).catch(function () {});
    if (o.scale || o.cmd || o.clip !== undefined || o.res !== undefined || o.fps !== undefined || o.dynres !== undefined || o.hud !== undefined) N.call("rdp.opts", Object.assign({ id: V.id }, o)).catch(function () {});
  }
  function pause(V, on) { N.call("rdp.pause", { id: V.id, on: on === undefined ? !(V.st && V.st.paused) : on }).then(function (d) { if (d && sessions[V.id]) { V.st = d; paint(V); if (S.statusSoon && V.P && V.P.win) S.statusSoon(V.P.win); } }).catch(function () {}); }
  function popOut(V, mode) { N.call("rdp.window", { id: V.id, mode: mode }).then(function (d) { if (d && sessions[V.id]) { V.st = d; paint(V); } }).catch(function () {}); }
  var RES = [["auto", "跟随窗口", "Match Window"], ["1280x720"], ["1920x1080"], ["2560x1440"], ["3840x2160"]];
  var FPS = [[0, "不限", "No Limit"], [60], [30], [15]];
  var resName = function (r) { return r === "auto" ? t("跟随窗口", "Match Window") : String(r).replace("x", " × "); };
  function optsMenu(V) {
    var h = hostOf(V.hostId) || {}, cmd = h.cmd || "ctrl", up = V.st && V.st.state === "connected", d = V.stats || {};
    var res = h.res || "auto", fps = +h.fps || 0, sl = statsLine(V), canRes = !!(d.disp || (V.st && V.st.disp));
    S.menu([
      sl ? { header: true, label: sl } : null,
      sl ? { sep: true } : null,
      newOK() ? { label: t("分辨率", "Resolution"), value: resName(res), items: (canRes ? [] : [{ header: true, label: t("由那台电脑的显示器决定", "Set by that computer’s display") }]).concat(RES.map(function (r) {
        return { label: r[1] ? t(r[1], r[2]) : resName(r[0]), checked: res === r[0], disabled: !canRes && r[0] !== "auto", run: function () { setOpt(V, { res: r[0], dynres: r[0] === "auto" ? true : h.dynres }); } };
      })) } : { label: t("分辨率跟随窗口", "Match Window Size"), checked: h.dynres !== false, run: function () { setOpt(V, { dynres: h.dynres === false }); } },
      newOK() ? { label: t("帧率上限", "Frame Rate Limit"), value: fps ? fps + " fps" : t("不限", "No Limit"), items: FPS.map(function (f) { return { label: f[1] ? t(f[1], f[2]) : f[0] + " fps", checked: fps === f[0], run: function () { setOpt(V, { fps: f[0] }); } }; }) } : null,
      { label: t("画质", "Quality"), value: h.avc444 === false ? "AVC420" : "AVC444", items: [
        { label: t("清晰（AVC444）", "Sharp (AVC444)"), checked: h.avc444 !== false, run: function () { if (h.avc444 === false) setOpt(V, { avc444: true }); } },
        { label: t("省流量（AVC420）", "Light (AVC420)"), checked: h.avc444 === false, run: function () { if (h.avc444 !== false) setOpt(V, { avc444: false }); } }] },
      { label: t("显示", "Display"), value: h.scale === "1:1" ? t("原始大小", "Actual Size") : t("适应窗口", "Fit to Window"), items: [
        { label: t("适应窗口", "Fit to Window"), checked: h.scale !== "1:1", run: function () { setOpt(V, { scale: "fit" }); } },
        { label: t("原始大小", "Actual Size"), checked: h.scale === "1:1", run: function () { setOpt(V, { scale: "1:1" }); } }] },
      { label: t("⌘ 键", "⌘ Key"), value: cmd === "super" ? "Super" : "Ctrl", items: [
        { label: t("当 Ctrl（单按是 Super）", "As Ctrl (tap for Super)"), checked: cmd === "ctrl", run: function () { setOpt(V, { cmd: "ctrl" }); } },
        { label: t("当 Super", "As Super"), checked: cmd === "super", run: function () { setOpt(V, { cmd: "super" }); } }] },
      { label: t("同步剪贴板", "Share Clipboard"), checked: h.clip !== false, run: function () { setOpt(V, { clip: h.clip === false }); } },
      { label: t("播放远程声音", "Play Remote Audio"), checked: !!h.audio, run: function () { setOpt(V, { audio: !h.audio }); } },
      newOK() ? { label: t("画面上显示统计", "Show Stats on Picture"), checked: !!h.hud, run: function () { setOpt(V, { hud: !h.hud }); } } : null,
      { sep: true },
      up && newOK() ? { label: V.st.paused ? t("继续", "Resume") : t("暂停", "Pause"), run: function () { pause(V); } } : null,
      up && newOK() ? { label: t("在单独的窗口中打开", "Open in Separate Window"), run: function () { popOut(V, "window"); } } : null,
      up && newOK() ? { label: t("全屏", "Full Screen"), run: function () { popOut(V, "fullscreen"); } } : null,
      up ? { label: t("刷新画面", "Refresh Picture"), run: function () { N.call("rdp.refresh", { id: V.id }).catch(function () {}); } } : null,
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
  // 状态栏：这个标签页是连着的远程桌面时，右边一行统计；点它出「连接选项」
  var progV = function (prog) { var V0 = prog && sessions["rdp:" + prog.arg]; return V0 && V0.P && V0.P.program === prog ? V0 : V0 || null; };
  window.TSU_RDP = { open: openHost, hosts: function () { return hosts.slice(); }, reload: loadHosts, connectDevice: connectDevice, openFile: openFile, native: function () { return native(); },
    statusLine: function (prog) { return statsLine(progV(prog)); }, options: function (prog) { var V0 = progV(prog); if (V0) optsMenu(V0); } };
})();
