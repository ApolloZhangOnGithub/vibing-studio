// devices.js —— 「设备」App（参考 AirPort 实用工具）：最上面是账户，下面一排是电脑（Mac、Linux）和没在用哪台电脑的 iPhone、iPad、网页；
//   在用某台 Mac 的设备挂在那台下面。点一台出它的卡片（同 AirPort 的弹出窗口）：型号、系统、App 版本、首次登录、上次在线、设备 ID；
//   另一台在线的 Mac 能「在这里使用」，这台 Mac 能开关「允许其他设备使用」、撤销允许过的设备，别的设备能从账户中移除。点账户：通行密钥、退出登录。
//   数据：TSU_SYNC.deviceList()（账户里报到过的设备：同一台机器并成一台，以前版本留下的旧记录不列）、/api/relay/hosts（在线的 Mac 和连着它的设备，
//   按中转里的编号对上）、TSU_REMOTE_HOST（这台 Mac 当主机时）
(function () {
  "use strict";
  var S = window.STUDIO;
  if (!S || !S.pages || !S.openPage) return;
  var I18N = window.TSU_I18N;
  var t = function (zh, en) { return I18N && I18N.lang && I18N.lang() === "en" ? en : zh; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var SY = function () { return window.TSU_SYNC; }, RH = function () { return window.TSU_REMOTE_HOST; }, RC = function () { return window.TSU_REMOTE; };
  var ago = function (ms) { if (!ms) return ""; var s0 = (Date.now() - ms) / 1000; return s0 < 90 ? t("刚刚", "just now") : s0 < 3600 ? t(Math.floor(s0 / 60) + " 分钟前", Math.floor(s0 / 60) + " min ago") : s0 < 86400 ? t(Math.floor(s0 / 3600) + " 小时前", Math.floor(s0 / 3600) + " h ago") : t(Math.floor(s0 / 86400) + " 天前", Math.floor(s0 / 86400) + " d ago"); };
  var seen = function (ms) { return ms ? t(ago(ms) + "在线", "Seen " + ago(ms)) : t("离线", "Offline"); };
  var day = function (ms) { if (!ms) return ""; var d = new Date(ms); return t(d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日", d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })); };
  var ONLINE_MS = 15 * 60000;
  // 其他设备连进来时怎么确认（RemoteHost.swift 的 remote.policy）
  var POLICIES = [["first", "首次连接时确认", "Ask the First Time"], ["every", "每次连接都确认", "Ask Every Time"], ["code", "首次连接时确认并输入验证码", "Ask and Enter a Code the First Time"], ["auto", "直接允许", "Allow Without Asking"]];

  // ---- 图标（48 格细线，同活动栏的线条图标）；TOP：图形本身的上沿在 48 格里的位置（连线接到图形上，不悬在图标的空白里）----
  var SV = function (b) { return '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + b + "</svg>"; };
  var ICON = {
    cloud: SV('<path d="M15 35h19.5a8.5 8.5 0 0 0 1.2-16.9A11.5 11.5 0 0 0 13.6 21 7 7 0 0 0 15 35z"/>'),
    laptop: SV('<rect x="10" y="11" width="28" height="19.5" rx="2"/><path d="M5 34.5h38l-2.4 3H7.4z"/>'),
    desktop: SV('<rect x="7" y="8.5" width="34" height="23.5" rx="2.6"/><path d="M19 39h10M24 32v7"/>'),
    ipad: SV('<rect x="11" y="6.5" width="26" height="35" rx="3.6"/><path d="M22 37.4h4"/>'),
    iphone: SV('<rect x="15" y="5.5" width="18" height="37" rx="4"/><path d="M21 9.4h6"/>'),
    web: SV('<rect x="6" y="9" width="36" height="30" rx="3"/><path d="M6 16h36"/><path d="M10.5 12.5h.01M14 12.5h.01M17.5 12.5h.01"/>'),
  };
  var TOP = { cloud: 11.2, laptop: 11, desktop: 8.5, ipad: 6.5, iphone: 5.5, web: 9 };
  var COPY = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5v-.2A1.3 1.3 0 0 0 9.2 2H3.3A1.3 1.3 0 0 0 2 3.3v5.9a1.3 1.3 0 0 0 1.3 1.3h.2"/></svg>';
  var DONE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.2 8.4l3 3 6.6-6.6"/></svg>';
  var LOGO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="12.5" height="9" rx="1.2"/><path d="M1 16.5h17"/><rect x="16.5" y="8.5" width="6" height="11" rx="1.3"/><path d="M19 17.6h1"/></svg>';
  var iconOf = function (d) {
    var s = (d.label || d.name || "") + " " + (d.model || "");
    if (d.family === "ipad" || /iPad/i.test(s)) return "ipad";
    if (d.family === "iphone" || /iPhone/i.test(s)) return "iphone";
    if (d.web) return "web";
    return /MacBook/i.test(s) ? "laptop" : "desktop";
  };
  var kindLabel = function (d) {
    if (d.web) return t("网页", "Web"); // 浏览器写在名字里了（「iPhone 上的 Safari」）
    var k = iconOf(d);
    if (k === "iphone" || k === "ipad") return k === "ipad" ? "iPad" : "iPhone";
    return d.kind === "linux" || /Linux|Ubuntu|Debian|Fedora|Arch/i.test((d.os || "") + " " + (d.label || "")) ? "Linux" : /Windows/i.test(d.os || "") ? "Windows" : "Mac";
  };

  // 能连它桌面的：别的 Linux / Windows 电脑（它们的远程桌面是 RDP；Mac 的以后由 Vibing Studio 自己来）——App 里才有
  var canDesk = function (n) { return !!(n && !n.self && !n.web && n.family === "computer" && /^(Linux|Windows)$/.test(kindLabel(n)) && window.TSU_RDP && TSU_RDP.native()); };
  // ---- 数据 ----
  var hostsCache = { at: 0, list: [] };
  function loadHosts(done) {
    if (Date.now() - hostsCache.at < 5000 || !SY()) return;
    hostsCache.at = Date.now();
    fetch("/api/relay/hosts", { credentials: "same-origin", cache: "no-store" }).then(function (r) { return r.ok ? r.json() : []; }).then(function (l) { hostsCache.list = Array.isArray(l) ? l : []; done(); }, function () { done(); });
  }
  var order = function (a, b) { return (b.self ? 1 : 0) - (a.self ? 1 : 0) || (b.online ? 1 : 0) - (a.online ? 1 : 0) || (b.last_seen || 0) - (a.last_seen || 0); };
  function model() {
    var sy = SY(), list = sy && sy.deviceList ? sy.deviceList() : null;
    if (!list) { var app = !!(window.nadosNative && !nadosNative.remote && nadosNative.local); list = [{ id: "self", label: app ? "Mac" : t("这台设备", "This device"), kind: app ? "mac" : "web", web: !app, family: "computer", self: true, last_seen: Date.now(), ids: [] }]; }
    var nodes = list.map(function (d) { return Object.assign({}, d, { rids: String(d.relay || "").split(/\s+/).filter(Boolean), kids: [] }); });
    var byRid = function (rid) { return nodes.filter(function (n) { return n.rids.indexOf(rid) >= 0; })[0]; };
    var lc = function (s) { return String(s || "").trim().toLowerCase(); };
    var guest = function (rid, nm) { // 连着某台 Mac、账户里却对不上的（老版本的 iPad 页面）：照中转给的名字画一台
      var n = { id: "rc:" + rid, label: nm || "iPad", rids: [rid], kids: [], ids: [], last_seen: Date.now(), guest: true };
      n.family = /iPhone/i.test(n.label) ? "iphone" : /iPad/i.test(n.label) ? "ipad" : "computer"; n.web = n.family === "computer";
      nodes.push(n);
      return n;
    };
    hostsCache.list.forEach(function (h) {
      var n = byRid(h.device) || nodes.filter(function (x) { return !x.web && x.family === "computer" && !x.host && (lc(x.label) === lc(h.name) || lc(x.name) === lc(h.name)); })[0];
      if (!n) { n = { id: "relay:" + h.device, label: h.name || "Mac", kind: "mac", family: "computer", rids: [h.device], kids: [], ids: [], last_seen: Date.now(), guest: true }; nodes.push(n); }
      n.host = h.device; n.online = true;
      (h.clients || []).forEach(function (c) { var cn = byRid(c.cid) || guest(c.cid, c.cname); cn.via = n; cn.online = true; });
    });
    var self = nodes.filter(function (n) { return n.self; })[0], rh = RH();
    if (rh && self && !self.web) {
      self.allow = rh.on();
      self.host = self.host || (rh.device && rh.device());
      (rh.clients() || []).forEach(function (c) { var cn = byRid(c.id) || guest(c.id, c.name); cn.via = self; cn.online = true; });
    }
    var rc = RC(), useMac = rc && rc.mac && rc.mac();
    if (useMac && self) { var hm = nodes.filter(function (n) { return n.host === useMac; })[0]; if (hm && hm !== self) self.via = hm; }
    nodes.forEach(function (n) { if (n.online == null) n.online = !!n.self || Date.now() - (n.last_seen || 0) < ONLINE_MS; });
    var isHost = function (n) { return n.family === "computer" && !n.web; };
    var hosts = nodes.filter(isHost).sort(order), others = nodes.filter(function (n) { return !isHost(n); }).sort(order);
    hosts.forEach(function (h) { h.kids = others.filter(function (o) { return o.via === h; }); });
    var me = (window.TSU_AGENTS && TSU_AGENTS.me && TSU_AGENTS.me()) || null;
    return { hosts: hosts, loose: others.filter(function (o) { return hosts.indexOf(o.via) < 0; }), count: nodes.filter(function (n) { return !n.guest; }).length, login: sy && me && me.loggedIn !== false ? me.login || "" : "", signed: !!sy };
  }

  // ---- 画：账户在上；下面一排电脑和没在用电脑的设备；在用某台电脑的挂在那台下面 ----
  function nodeHtml(n, key) {
    var ic = iconOf(n), st = n.self ? t("这台设备", "This device") : n.online ? t("在线", "Online") : seen(n.last_seen);
    return '<button type="button" class="dv-node' + (n.self ? " self" : "") + (n.online ? " on" : "") + '" data-node="' + esc(key) + '" title="' + esc(n.label) + '">' +
      '<span class="dv-ic" data-top="' + TOP[ic] + '">' + ICON[ic] + '<i class="dv-dot"></i></span><span class="dv-name">' + esc(n.label) + '</span><span class="dv-st">' + esc(st) + "</span></button>";
  }
  function render(host, P, arg, V) {
    loadHosts(function () { if (V.shown()) render(host, P, arg, V); });
    clearTimeout(host._dvT);
    host._dvT = setTimeout(function () { if (V.shown()) render(host, P, arg, V); }, 10000); // 开着时每 10 秒看一次在线的 Mac、谁连着
    var m = model(), keys = {}, k = 0, put = function (n) { var id = "n" + k++; keys[id] = n; return id; };
    var col = function (n) { var id = put(n); return '<div class="dv-col">' + nodeHtml(n, id) + (n.kids.length ? '<div class="dv-kids">' + n.kids.map(function (o) { return nodeHtml(o, put(o)); }).join("") + "</div>" : "") + "</div>"; };
    var acct = '<button type="button" class="dv-node dv-acct on" data-node="acct" title="' + esc(m.login) + '"><span class="dv-ic" data-top="' + TOP.cloud + '">' + ICON.cloud + "</span>" +
      '<span class="dv-name">' + esc(m.login || t("未登录", "Not Signed In")) + '</span><span class="dv-st">' + esc(m.signed ? t(m.count + " 台设备", m.count + (m.count === 1 ? " device" : " devices")) : "Vibing Studio") + "</span></button>";
    var tier = m.hosts.map(col).join("") + m.loose.map(col).join("");
    var html = '<div class="dv-wrap"><div class="dv-head"><h1>' + esc(t("设备", "Devices")) + '</h1></div><div class="dv-scroll"><div class="dv-fit"><div class="dv-map"><svg class="dv-lines" aria-hidden="true"></svg>' +
      '<div class="dv-tier dv-t0">' + acct + "</div>" + (tier ? '<div class="dv-tier dv-t1">' + tier + "</div>" : "") + "</div></div></div></div>";
    V.nodes = keys;
    // 和上次一样（定时看、同步拉回来没变）：不重建，卡片、悬停都不打断
    if (html === host._dvHtml && host.querySelector(".dv-map")) { if (card && card._key && keys[card._key]) card._node = keys[card._key]; return layout(host); }
    var openId = card && card._node && card._node.id;
    closeCard();
    host._dvHtml = html;
    host.innerHTML = html;
    layout(host);
    if (!host._dvWired) { host._dvWired = true; wire(host, P, V); }
    if (host._dvRO) { host._dvRO.disconnect(); host._dvRO.observe(host); host._dvRO.observe(host.querySelector(".dv-map")); }
    if (openId) Object.keys(keys).forEach(function (k2) { if (keys[k2].id === openId) { var el = host.querySelector('[data-node="' + k2 + '"]'); if (el) openCard(host, P, el, keys[k2], k2, V, true); } }); // 数据变了重画：卡片接着开着（不再播一遍弹出的动画）
  }
  // 连线：上面那一台整块（图标、名字、状态）的下沿 → 一条横线 → 下面每一台图形的上沿（同 AirPort）。横线在两排中间的空当里，不穿过任何一台；
  //   坐标按版面算（offsetLeft/Top 加到 .dv-map 为止），和窗口的缩放动画无关；地图大小一变（窗口、分栏、字体载入）就重画
  function at(el, map) { var x = 0, y = 0, e = el; while (e && e !== map) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; } return { l: x, t: y, w: el.offsetWidth, h: el.offsetHeight }; }
  // 放不下：整张图按比例缩小到正好放下（最小 0.7，再小字就看不清了，那时横着滚）
  function layout(host) {
    lines(host);
    var sc = host.querySelector(".dv-scroll"), box = host.querySelector(".dv-fit"), map = host.querySelector(".dv-map");
    if (!sc || !box || !map || !sc.clientWidth) return;
    var w = map.offsetWidth, h = map.offsetHeight, s = Math.max(0.7, Math.min(1, sc.clientWidth / w));
    map.style.transform = s < 1 ? "scale(" + s.toFixed(4) + ")" : "";
    box.style.width = Math.ceil(w * s) + "px";
    box.style.height = Math.ceil(h * s) + "px";
  }
  function lines(host) {
    var map = host.querySelector(".dv-map"), svg = host.querySelector(".dv-lines");
    if (!map || !svg || !map.offsetWidth) return;
    var d = [], R = Math.round;
    var fan = function (top, kids) {
      if (!top || !kids.length) return;
      var a = at(top, map), ax = R(a.l + a.w / 2), ab = R(a.t + a.h);
      var ks = kids.map(function (nd) { var ic = nd.querySelector(".dv-ic"), b = at(ic, map); return { x: R(b.l + b.w / 2), y: R(b.t + (parseFloat(ic.getAttribute("data-top")) || 0) * b.h / 48) }; });
      var y = R((ab + Math.min.apply(null, ks.map(function (q) { return q.y; }))) / 2), xs = ks.map(function (q) { return q.x; }).concat([ax]);
      d.push("M" + ax + " " + (ab + 1) + "V" + y, "M" + Math.min.apply(null, xs) + " " + y + "H" + Math.max.apply(null, xs));
      ks.forEach(function (q) { d.push("M" + q.x + " " + y + "V" + (q.y - 3)); });
    };
    var kidsOf = function (sel) { return Array.prototype.slice.call(map.querySelectorAll(sel)); };
    fan(map.querySelector(".dv-acct"), kidsOf(".dv-t1 > .dv-col > .dv-node"));
    map.querySelectorAll(".dv-t1 > .dv-col").forEach(function (c) { fan(c.querySelector(":scope > .dv-node"), Array.prototype.slice.call(c.querySelectorAll(":scope > .dv-kids > .dv-node"))); });
    var w = map.offsetWidth, h = map.offsetHeight;
    svg.setAttribute("width", w); svg.setAttribute("height", h); svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.innerHTML = '<path d="' + d.join("") + '"/>';
  }

  // ---- 卡片（同 AirPort 点一台弹出来的那块）----
  var card = null;
  function closeCard() { if (card) { card.remove(); card = null; } }
  function wire(host, P, V) {
    host.addEventListener("click", function (e) {
      if (e.target.closest(".dv-card")) return;
      var nd = e.target.closest("[data-node]");
      if (!nd) return closeCard();
      var key = nd.dataset.node, n = key === "acct" ? { id: "acct" } : V.nodes && V.nodes[key];
      if (card && card._key === key) return closeCard();
      // 别的 Linux / Windows 电脑：点一下就连它的桌面（远程桌面标签页；用户 2026-10-13：「点击设备直接就可以连了」）；它的信息在右键里
      if (n && canDesk(n)) { closeCard(); return window.TSU_RDP.connectDevice({ id: n.id, name: n.label }, P.win); }
      if (n) openCard(host, P, nd, n, key, V);
    });
    host.addEventListener("contextmenu", function (e) {
      var nd = e.target.closest("[data-node]");
      if (!nd) return;
      var key = nd.dataset.node, n = key === "acct" ? { id: "acct" } : V.nodes && V.nodes[key];
      if (!n) return;
      e.preventDefault();
      openCard(host, P, nd, n, key, V);
    });
    if (window.ResizeObserver) host._dvRO = new ResizeObserver(function () { if (V.shown()) layout(host); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (V.shown()) layout(host); });
    var redraw = function () { if (V.shown()) { host._dvHtml = ""; render(host, P, V.arg, V); } };
    if (SY() && SY().on) SY().on(function (type) { if (type === "devices") redraw(); });
    if (RH() && RH().watch) RH().watch(redraw);
    document.addEventListener("keydown", function (e) { if (card && e.key === "Escape") { e.stopPropagation(); closeCard(); } }, true);
  }
  var copyText = function (s) {
    var viaN = function () { if (window.nadosNative) nadosNative.call("clipboard.write", { text: s }).catch(function () {}); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).catch(viaN); else viaN();
  };
  var confirmDo = function (o, go) {
    if (window.TSU_DESK && TSU_DESK.alert) TSU_DESK.alert({ title: o.title, message: o.message, icon: "caution", buttons: [{ label: t("取消", "Cancel"), role: "cancel" }, { label: o.ok, role: "default", run: go }] });
    else if (window.confirm(o.title)) go();
  };
  function acctCard(m) {
    var rows = m.login ? [[t("设备", "Devices"), t(m.count + " 台", String(m.count))]] : [];
    var acts = m.login ? [["signout", t("退出登录…", "Sign Out…")], ["passkeys", t("通行密钥…", "Passkeys…"), "primary"]] : [["signin", t("使用 GitHub 登录", "Sign In with GitHub"), "primary"]];
    return { icon: ICON.cloud, title: m.login || t("未登录", "Not Signed In"), sub: m.login ? t("GitHub 账户", "GitHub Account") : "Vibing Studio", rows: rows, acts: acts };
  }
  function devCard(n) {
    var rows = [[t("状态", "Status"), n.online ? t("在线", "Online") : seen(n.last_seen), n.online ? "on" : ""]];
    if (n.model && n.model !== n.label) rows.push([t("型号", "Model"), n.model]);
    if (n.os) rows.push([t("系统", "System"), n.os]);
    if (n.app) rows.push(["Vibing Studio", String(n.app).replace(/^网页 /, "")]);
    if (n.created_at) rows.push([t("首次登录", "First Signed In"), day(n.created_at)]);
    if (n.via) rows.push([t("正在使用", "Using"), n.via.label]);
    if (n.ids && n.ids.length) rows.push([t("设备 ID", "Device ID"), n.ids[0], "id"]);
    var acts = [];
    if (canDesk(n)) acts.push(["desk", t("远程桌面", "Remote Desktop"), "primary"]); // 点那台电脑本身也是连它
    // 另一台在线的 Mac：App 里开一个窗口连它（终端、文件、会话都在那台上；同 VS Code 的远程窗口）；网页、iPad 这一页换成用它
    var inApp = !!(window.nadosNative && (!nadosNative.remote || nadosNative.hybrid));
    if (!n.self && n.host && n.online && !n.web) acts.push(["open", inApp ? t("在新窗口中打开", "Open in New Window") : t("在这里使用", "Use Here"), "primary"]);
    if (!n.self && n.ids && n.ids.length && SY()) acts.unshift(["remove", t("从账户中移除…", "Remove from Account…")]);
    return { icon: ICON[iconOf(n)], title: n.label, sub: n.self ? kindLabel(n) + " · " + t("这台设备", "This Device") : kindLabel(n), rows: rows, acts: acts };
  }
  function openCard(host, P, el, n, key, V, keep) {
    closeCard();
    var m = key === "acct" ? model() : null, c = key === "acct" ? acctCard(m) : devCard(n);
    var rh = RH(), hosting = n.self && !n.web && rh;
    var html = '<div class="dv-ch"><span class="dv-cic">' + c.icon + '</span><div class="dv-ct"><b>' + esc(c.title) + "</b><span>" + esc(c.sub) + "</span></div></div>" +
      (c.rows.length ? '<dl class="dv-rows">' + c.rows.map(function (r) {
        return "<dt>" + esc(r[0]) + "</dt><dd" + (r[2] === "id" ? ' class="dv-id"' : "") + ">" + (r[2] === "on" ? '<i class="dv-sdot"></i>' : "") + (r[2] === "id" ? "<code>" + esc(r[1]) + '</code><button type="button" class="dv-copy" data-copy="' + esc(r[1]) + '" title="' + esc(t("拷贝", "Copy")) + '">' + COPY + "</button>" : esc(r[1])) + "</dd>";
      }).join("") + "</dl>" : "");
    if (hosting) {
      var on = !!rh.on(), users = n.kids || [], appr = rh.approved() || [], pol = rh.policy ? rh.policy() : "";
      html += '<div class="dv-sw"><span>' + esc(t("允许其他设备使用这台 Mac", "Allow Other Devices to Use This Mac")) + '</span><button type="button" class="dv-switch' + (on ? " on" : "") + '" role="switch" aria-checked="' + on + '" data-act="share"></button></div>';
      // 其他设备连进来时怎么确认（同 设置 › 通用）
      if (on && pol) html += '<div class="dv-sw dv-pol"><span>' + esc(t("连接时", "When a Device Connects")) + '</span><select class="dv-sel" data-act="policy">' + POLICIES.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === pol ? " selected" : "") + ">" + esc(t(o[1], o[2])) + "</option>"; }).join("") + "</select></div>";
      if (users.length) html += '<div class="dv-sec">' + esc(t("正在使用这台 Mac", "Using This Mac")) + '</div><ul class="dv-list">' + users.map(function (u) { return "<li><span>" + esc(u.label) + "</span></li>"; }).join("") + "</ul>";
      if (appr.length) html += '<div class="dv-sec">' + esc(t("允许过的设备", "Allowed Devices")) + '</div><ul class="dv-list">' + appr.map(function (a) { return "<li><span>" + esc(a.name || a.id) + '</span><button type="button" data-revoke="' + esc(a.id) + '">' + esc(t("移除", "Remove")) + "</button></li>"; }).join("") + "</ul>";
    } else if (n.kids && n.kids.length) html += '<div class="dv-sec">' + esc(t("正在使用这台 Mac", "Using This Mac")) + '</div><ul class="dv-list">' + n.kids.map(function (u) { return "<li><span>" + esc(u.label) + "</span></li>"; }).join("") + "</ul>";
    if (c.acts.length) html += '<div class="dv-acts">' + c.acts.map(function (a) { return '<button type="button" data-act="' + a[0] + '"' + (a[2] ? ' class="dv-' + a[2] + '"' : "") + ">" + esc(a[1]) + "</button>"; }).join("") + "</div>";
    card = document.createElement("div");
    card.className = "dv-card" + (keep ? " dv-keep" : "");
    card.setAttribute("role", "dialog");
    card.innerHTML = html;
    card._key = key; card._node = n;
    host.appendChild(card);
    var r = el.getBoundingClientRect(), hr = host.getBoundingClientRect(), cw = card.offsetWidth, ch = card.offsetHeight;
    var left = Math.max(12, Math.min(host.clientWidth - cw - 12, r.left - hr.left + r.width / 2 - cw / 2));
    var below = r.bottom - hr.top + host.scrollTop + 6, above = r.top - hr.top + host.scrollTop - ch - 6;
    card.style.left = Math.round(left) + "px";
    card.style.top = Math.round(below + ch > host.scrollTop + host.clientHeight - 8 && above >= host.scrollTop + 8 ? above : below) + "px";
    card.addEventListener("change", function (e) {
      var sel = e.target.closest("select[data-act=policy]");
      if (sel && RH() && RH().setPolicy) Promise.resolve(RH().setPolicy(sel.value)).then(function () { host._dvHtml = ""; if (V.shown()) render(host, P, V.arg, V); });
    });
    card.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      var nn = card ? card._node : n, a = b.dataset.act, again = function () { host._dvHtml = ""; if (V.shown()) render(host, P, V.arg, V); };
      if (b.dataset.copy) { copyText(b.dataset.copy); b.innerHTML = DONE; setTimeout(function () { b.innerHTML = COPY; }, 1200); return; }
      if (b.dataset.revoke && RH()) { Promise.resolve(RH().revoke(b.dataset.revoke)).then(again); return; }
      if (a === "share" && RH()) { Promise.resolve(RH().set(!RH().on())).then(again); return; }
      if (a === "remove" && SY()) {
        return confirmDo({ title: t("从账户中移除「" + nn.label + "」？", "Remove “" + nn.label + "” from your account?"), message: t("如果这台设备还登录着，下次打开 Vibing Studio 时会重新出现。", "If this device is still signed in, it will appear again the next time it opens Vibing Studio."), ok: t("移除", "Remove") },
          function () { SY().removeDevices(nn.ids).then(function () { closeCard(); again(); }, function (err) { if (window.TSU_DESK && TSU_DESK.alert) TSU_DESK.alert({ title: t("没能移除", "Couldn’t Remove the Device"), message: String((err && err.message) || err), icon: "caution" }); }); });
      }
      if (a === "signout") return confirmDo({ title: t("退出登录 " + (model().login || "") + "？", "Sign out of " + (model().login || "") + "?"), message: t("跟着账户的数据会停止同步；这台设备上的 Claude Code、Codex 会话不受影响。", "Account data stops syncing; Claude Code and Codex sessions on this device are not affected."), ok: t("退出登录", "Sign Out") }, function () { location.href = "/auth/logout"; });
      if (a === "signin") { location.href = "/auth/login?next=" + encodeURIComponent(location.pathname + location.search); return; }
      if (a === "passkeys") {
        closeCard();
        var u = location.origin + "/account/passkeys", N = window.nadosNative;
        if (N && N.call) N.call("openExternal", { url: u }).catch(function () { window.open(u, "_blank", "noopener"); }); else window.open(u, "_blank", "noopener");
        return;
      }
      if (a === "desk" && window.TSU_RDP) { closeCard(); return TSU_RDP.connectDevice({ id: nn.id, name: nn.label }, P.win); }
      if (a === "open" && nn.host) {
        closeCard();
        // App：开一个窗口连那台 Mac（已经开着就叫到前面）；网页、iPad：这一页换成用那台 Mac
        if (S.openMac) return S.openMac(nn.host, nn.label);
        var rc = RC();
        if (rc && rc.use) return rc.use(nn.host, nn.label);
      }
    });
  }

  S.pages.devices = {
    title: function () { return t("设备", "Devices"); },
    address: function () { return "devices.local.paimon"; },
    icon: function () { return LOGO; }, // 标签页上：同 App 里的那个图标
    render: render,
    detach: function (host) { closeCard(); clearTimeout(host._dvT); },
  };
  // 「App」里一格
  if (S.apps && S.apps.add) S.apps.add({
    id: "devices", builtin: true, name: function () { return t("设备", "Devices"); },
    logo: function () { return LOGO; },
    find: function (tw) { var hit = null; (tw && tw.ws && tw.ws.all ? tw.ws.all() : []).forEach(function (p) { if (!hit && p.program && p.program.page === "devices") hit = p; }); return hit; },
    open: function (tw) { return S.openPage(tw, "devices", ""); },
  });
})();
