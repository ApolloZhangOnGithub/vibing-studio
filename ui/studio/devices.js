// devices.js —— 「设备」App：中间是账户（你的头像），手机、平板、网页从上面分出去，电脑（Mac、Linux、Windows）从下面分出去（分叉的树）；
//   设备之间谁能用谁画成另一种线：实线是正在用，虚线是允许过、现在没连着；指着一台只亮它的那几条。每台写着名字、型号或系统、在不在线。
//   同 Finder：点一下选中它（右边一栏：型号、系统、App 版本、首次登录、上次在线、设备 ID；谁能用它、它能用哪几台；这台自己的开关、确认方式）；
//   连按两下做它的那件事（Linux、Windows 电脑：远程桌面；另一台 Mac：在新窗口中打开）；右键是它能做的事的菜单。点账户：登录方式、退出登录。
//   数据：TSU_SYNC.deviceList()（账户里报到过的设备：同一台机器并成一台；当主机的那几台还报了 access——开没开、怎么确认、允许过哪些设备、现在谁连着）、
//   /api/relay/hosts（在线的电脑和现在连着它的设备，按中转里的编号对上）、TSU_REMOTE_HOST（这台 Mac 自己当主机时的，最新）
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
  var polName = function (p) { var x = POLICIES.filter(function (o) { return o[0] === p; })[0]; return x ? t(x[1], x[2]) : ""; };

  // ---- 图标（48 格细线，同活动栏的线条图标）；TOP：图形本身的上沿在 48 格里的位置（往下的线接到图形上，不悬在图标的空白里）----
  var SV = function (b) { return '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + b + "</svg>"; };
  var ICON = {
    cloud: SV('<path d="M15 35h19.5a8.5 8.5 0 0 0 1.2-16.9A11.5 11.5 0 0 0 13.6 21 7 7 0 0 0 15 35z"/>'),
    laptop: SV('<rect x="10" y="11" width="28" height="19.5" rx="2"/><path d="M5 34.5h38l-2.4 3H7.4z"/>'),
    desktop: SV('<rect x="7" y="8.5" width="34" height="23.5" rx="2.6"/><path d="M19 39h10M24 32v7"/>'),
    mini: SV('<rect x="7" y="18" width="34" height="12.5" rx="3.4"/><path d="M12.5 35.5h23"/><path d="M33.5 24.3h.01"/>'),
    linux: SV('<rect x="7" y="8.5" width="34" height="23.5" rx="2.6"/><path d="M19 39h10M24 32v7"/><path d="M14.5 15.5l4 4-4 4M21.5 24h8"/>'),
    windows: SV('<rect x="7" y="8.5" width="34" height="23.5" rx="2.6"/><path d="M19 39h10M24 32v7"/><path d="M17 13.5h6.2v6H17zM24.8 13.5H31v6h-6.2zM17 21h6.2v6H17zM24.8 21H31v6h-6.2z"/>'),
    ipad: SV('<rect x="11" y="6.5" width="26" height="35" rx="3.6"/><path d="M22 37.4h4"/>'),
    iphone: SV('<rect x="15" y="5.5" width="18" height="37" rx="4"/><path d="M21 9.4h6"/>'),
    web: SV('<rect x="6" y="9" width="36" height="30" rx="3"/><path d="M6 16h36"/><path d="M10.5 12.5h.01M14 12.5h.01M17.5 12.5h.01"/>'),
  };
  var TOP = { cloud: 11.2, laptop: 11, desktop: 8.5, mini: 18, linux: 8.5, windows: 8.5, ipad: 6.5, iphone: 5.5, web: 9 };
  var COPY = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5v-.2A1.3 1.3 0 0 0 9.2 2H3.3A1.3 1.3 0 0 0 2 3.3v5.9a1.3 1.3 0 0 0 1.3 1.3h.2"/></svg>';
  var DONE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.2 8.4l3 3 6.6-6.6"/></svg>';
  var LOGO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="12.5" height="9" rx="1.2"/><path d="M1 16.5h17"/><rect x="16.5" y="8.5" width="6" height="11" rx="1.3"/><path d="M19 17.6h1"/></svg>';
  var kindLabel = function (d) {
    if (d.web) return t("网页", "Web"); // 浏览器写在名字里了（「iPhone 上的 Safari」）
    var s = (d.label || d.name || "") + " " + (d.model || "");
    if (d.family === "ipad" || /iPad/i.test(s)) return "iPad";
    if (d.family === "iphone" || /iPhone/i.test(s)) return "iPhone";
    if (d.family === "android" || /Android/i.test(s)) return "Android";
    return d.kind === "linux" || /Linux|Ubuntu|Debian|Fedora|Arch|Mint|openSUSE|Manjaro/i.test((d.os || "") + " " + (d.label || "")) ? "Linux" : /Windows/i.test(d.os || "") ? "Windows" : "Mac";
  };
  var iconOf = function (d) {
    var k = kindLabel(d), s = (d.label || d.name || "") + " " + (d.model || "");
    if (k === "iPad") return "ipad";
    if (k === "iPhone" || k === "Android") return "iphone";
    if (d.web) return "web";
    if (k === "Linux") return "linux";
    if (k === "Windows") return "windows";
    if (/MacBook/i.test(s)) return "laptop";
    if (/Mac mini|Mac Studio/i.test(s)) return "mini";
    return "desktop";
  };
  // 名字下面那一行：型号（没有就是哪一类）· 系统——几台 Mac 一眼分得出（「MacBook Air · macOS 27」「OptiPlex 7090 · Ubuntu 26.04」）
  var shortOs = function (os) { return String(os || "").replace(/\s*\(.*\)\s*$/, "").replace(/^(macOS|iPadOS|iOS)\s+(\d+)(\.0)?(\.\d+)?$/, "$1 $2$4").replace(/ LTS$/, "").trim(); };
  var subOf = function (n) {
    if (n.web) return [n.browser || t("网页", "Web"), shortOs(n.os)].filter(Boolean).join(" · ");
    var full = String(n.model || ""), m = full.replace(/\s*\((M\d|Intel|\d{4}).*\)$/, "").replace(/^(Dell Inc\.|LENOVO|HP|ASUS|Micro-Star International Co\., Ltd\.|Gigabyte Technology Co\., Ltd\.)\s+/i, "").trim();
    if (m && m === n.label) { var chip = /\((M\d[^,)]*|Intel)/.exec(full); m = chip ? chip[1] : ""; } // 名字就是型号（「Mac mini」）：写芯片
    return [m || kindLabel(n), shortOs(n.os)].filter(Boolean).join(" · ");
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
  var parseAcc = function (s) { if (!s) return null; try { var o = typeof s === "string" ? JSON.parse(s) : s; return o && typeof o === "object" ? o : null; } catch (e) { return null; } };
  // 这台 Mac 自己当主机的（最新的，不等报到）
  var selfAcc = function (rh) {
    if (!rh || !rh.approved) return null;
    return { on: !!rh.on(), policy: (rh.policy && rh.policy()) || "", dev: rh.device ? rh.device() : "",
      ok: (rh.approved() || []).map(function (a) { return [a.id, Math.round((+a.at || 0) / 1000), Math.round((+a.last || 0) / 1000), a.name || "", a.loc || ""]; }),
      now: (rh.clients() || []).map(function (c) { return c.id; }), live: true };
  };
  function model() {
    var sy = SY(), list = sy && sy.deviceList ? sy.deviceList() : null;
    if (!list) { var app = !!(window.nadosNative && !nadosNative.remote && nadosNative.local); list = [{ id: "self", label: app ? "Mac" : t("这台设备", "This device"), kind: app ? "mac" : "web", web: !app, family: "computer", self: true, last_seen: Date.now(), ids: [] }]; }
    var nodes = list.map(function (d) { return Object.assign({}, d, { rids: String(d.relay || "").split(/\s+/).filter(Boolean), acc: parseAcc(d.access) }); });
    var byRid = function (rid) { return nodes.filter(function (n) { return n.rids.indexOf(rid) >= 0; })[0]; };
    var lc = function (s) { return String(s || "").trim().toLowerCase(); };
    var guest = function (rid, nm) { // 账户里对不上的（老版本的页面、没报到过的浏览器）：照中转、主机记着的名字画一台
      var n = { id: "rc:" + rid, label: nm || t("另一台设备", "Another Device"), rids: [rid], ids: [], last_seen: 0, guest: true };
      n.family = /iPhone/i.test(n.label) ? "iphone" : /iPad/i.test(n.label) ? "ipad" : "computer"; n.web = n.family === "computer" && !/^(Mac|Linux|Windows)$/i.test(n.label);
      nodes.push(n);
      return n;
    };
    // 谁能用谁：from（用的那台）→ to（被用的那台）；live：现在连着
    var edges = [], find = function (a, b) { return edges.filter(function (e) { return e.from === a && e.to === b; })[0]; };
    var edge = function (a, b, o) { if (!a || !b || a === b) return; var e = find(a, b); if (!e) { e = { from: a, to: b }; edges.push(e); } Object.keys(o).forEach(function (k) { if (o[k] != null && o[k] !== "" && !(k === "live" && !o[k])) e[k] = o[k]; }); };
    // 在线的电脑、现在连着它们的设备
    hostsCache.list.forEach(function (h) {
      var n = byRid(h.device) || nodes.filter(function (x) { return !x.web && x.family === "computer" && !x.host && (lc(x.label) === lc(h.name) || lc(x.name) === lc(h.name)); })[0];
      if (!n) { n = { id: "relay:" + h.device, label: h.name || "Mac", kind: "mac", family: "computer", rids: [h.device], ids: [], last_seen: Date.now(), guest: true }; nodes.push(n); }
      n.host = h.device; n.online = true;
      (h.clients || []).forEach(function (c) { var cn = byRid(c.cid) || guest(c.cid, c.cname); cn.online = true; edge(cn, n, { live: true, since: c.since, cid: c.cid }); });
    });
    var self = nodes.filter(function (n) { return n.self; })[0], rh = RH();
    if (rh && self && !self.web) { self.acc = selfAcc(rh) || self.acc; self.host = self.host || (rh.device && rh.device()); }
    // 每台主机报的谁能用它（这台的用自己的最新的）
    nodes.slice().forEach(function (h) {
      var a = h.acc;
      if (!a) return;
      h.hostOn = !!a.on; h.policy = a.policy || "";
      (a.ok || []).forEach(function (x) {
        if (!x || !x[0]) return;
        var c = byRid(x[0]) || guest(x[0], x[3]);
        edge(c, h, { at: (+x[1] || 0) * 1000, last: (+x[2] || 0) * 1000, cid: x[0], loc: x[4] || "", allowed: true });
      });
      if (a.live) (a.now || []).forEach(function (cid) { var c = byRid(cid); if (c) { c.online = true; edge(c, h, { live: true, cid: cid }); } });
    });
    // 这一页在用别的电脑（iPad、网页、连着另一台的窗口）
    var rc = RC(), useMac = rc && rc.mac && rc.mac();
    if (useMac && self) { var hm = nodes.filter(function (n) { return n.host === useMac; })[0]; if (hm && hm !== self) edge(self, hm, { live: true }); }
    nodes.forEach(function (n) { if (n.online == null) n.online = !!n.self || Date.now() - (n.last_seen || 0) < ONLINE_MS; });
    // 只是中转里认得、和谁都没有关系的访客不画
    nodes = nodes.filter(function (n) { return !n.guest || n.host || edges.some(function (e) { return e.from === n || e.to === n; }); });
    // 画的时候两台互相能用的并成一条（两头都有箭头）
    var draw = [];
    edges.forEach(function (e) {
      if (draw.some(function (d) { return d.from === e.to && d.to === e.from && (d.both = true) && (d.liveRev = !!e.live || d.liveRev || false, true); })) return;
      draw.push({ from: e.from, to: e.to, live: !!e.live, both: false, liveRev: false });
    });
    var isComp = function (n) { return n.family === "computer" && !n.web; };
    var me = (window.TSU_AGENTS && TSU_AGENTS.me && TSU_AGENTS.me()) || null;
    return { up: nodes.filter(function (n) { return !isComp(n); }).sort(order), down: nodes.filter(isComp).sort(order), edges: edges, draw: draw,
      count: nodes.filter(function (n) { return !n.guest; }).length, login: sy && me && me.loggedIn !== false ? me.login || "" : "", signed: !!sy };
  }

  // ---- 画：账户在中间；手机、平板、网页在上面一排，电脑在下面一排，各从账户分出去；谁能用谁另画一层线 ----
  function nodeHtml(n, key) {
    var ic = iconOf(n), st = n.self ? t("这台设备", "This device") : n.online ? t("在线", "Online") : seen(n.last_seen);
    return '<button type="button" class="dv-node' + (n.self ? " self" : "") + (n.online ? " on" : "") + '" data-node="' + esc(key) + '" title="' + esc(n.label) + '">' +
      '<span class="dv-ic" data-top="' + TOP[ic] + '">' + ICON[ic] + '<i class="dv-dot"></i></span><span class="dv-name">' + esc(n.label) + '</span><span class="dv-sub">' + esc(subOf(n)) + '</span><span class="dv-st">' + esc(st) + "</span></button>";
  }
  function render(host, P, arg, V) {
    loadHosts(function () { if (V.shown()) render(host, P, arg, V); });
    clearTimeout(host._dvT);
    host._dvT = setTimeout(function () { if (V.shown()) render(host, P, arg, V); }, 10000); // 开着时每 10 秒看一次在线的电脑、谁连着
    var m = model(), keys = {}, k = 0, put = function (n) { var id = "n" + k++; keys[id] = n; n._key = id; return id; };
    var av = S.avatarHtml && m.login ? S.avatarHtml(60, "dv-av") : '<span class="dv-ic" data-top="' + TOP.cloud + '">' + ICON.cloud + "</span>";
    var acct = '<button type="button" class="dv-node dv-acct on" data-node="acct" title="' + esc(m.login) + '">' + av +
      '<span class="dv-name">' + esc(m.login || t("未登录", "Not Signed In")) + '</span><span class="dv-st">' + esc(m.signed ? t("GitHub 账户 · " + m.count + " 台设备", "GitHub account · " + m.count + (m.count === 1 ? " device" : " devices")) : "Vibing Studio") + "</span></button>";
    var up = m.up.map(function (n) { return nodeHtml(n, put(n)); }).join(""), down = m.down.map(function (n) { return nodeHtml(n, put(n)); }).join("");
    var rel = m.draw.map(function (e) { return e.from._key + ">" + e.to._key + ":" + (e.live ? "L" : "") + (e.both ? "B" : "") + (e.liveRev ? "R" : ""); }).join(" ");
    var legend = m.edges.length ? '<div class="dv-legend"><span><i class="dv-lg live"></i>' + esc(t("正在使用", "In use")) + '</span><span><i class="dv-lg"></i>' + esc(t("允许使用", "Allowed")) + "</span></div>" : "";
    var html = '<div class="dv-wrap"><div class="dv-head"><h1>' + esc(t("设备", "Devices")) + "</h1>" + legend + '</div><div class="dv-scroll"><div class="dv-fit"><div class="dv-map" data-rel="' + esc(rel) + '"><svg class="dv-lines" aria-hidden="true"></svg>' +
      (up ? '<div class="dv-tier dv-up">' + up + "</div>" : "") + '<div class="dv-tier dv-mid">' + acct + "</div>" + (down ? '<div class="dv-tier dv-down">' + down + "</div>" : "") + "</div></div></div></div>";
    V.nodes = keys;
    V.edges = m.edges;
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
  // 坐标按版面算（offsetLeft/Top 加到 .dv-map 为止），和窗口的缩放动画无关；地图大小一变（窗口、分栏、字体载入）就重画
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
    var R = Math.round, tree = [], rel = [];
    var acct = map.querySelector(".dv-acct"), A = acct ? at(acct, map) : null;
    var nodeAt = function (key) { var el = map.querySelector('[data-node="' + key + '"]'); return el ? { el: el, b: at(el, map), ic: el.querySelector(".dv-ic") } : null; };
    var icTop = function (q) { var b = at(q.ic, map); return R(b.t + (parseFloat(q.ic.getAttribute("data-top")) || 0) * b.h / 48); };
    // 账户 → 下面一排电脑：账户下沿 → 一条横线 → 每台图形的上沿（同 AirPort）
    var downs = Array.prototype.slice.call(map.querySelectorAll(".dv-down > .dv-node")).map(function (el) { return nodeAt(el.dataset.node); });
    if (A && downs.length) {
      var ax = R(A.l + A.w / 2), ab = R(A.t + A.h), ks = downs.map(function (q) { return { x: R(q.b.l + q.b.w / 2), y: icTop(q) }; });
      var y = R((ab + Math.min.apply(null, ks.map(function (q) { return q.y; }))) / 2), xs = ks.map(function (q) { return q.x; }).concat([ax]);
      tree.push("M" + ax + " " + (ab + 1) + "V" + y, "M" + Math.min.apply(null, xs) + " " + y + "H" + Math.max.apply(null, xs));
      ks.forEach(function (q) { tree.push("M" + q.x + " " + y + "V" + (q.y - 3)); });
    }
    // 账户 → 上面一排手机、平板、网页：账户上沿 → 一条横线 → 每台的下沿
    var ups = Array.prototype.slice.call(map.querySelectorAll(".dv-up > .dv-node")).map(function (el) { return nodeAt(el.dataset.node); });
    if (A && ups.length) {
      var ax2 = R(A.l + A.w / 2), at2 = R(A.t), ks2 = ups.map(function (q) { return { x: R(q.b.l + q.b.w / 2), y: R(q.b.t + q.b.h) }; });
      var y2 = R((at2 + Math.max.apply(null, ks2.map(function (q) { return q.y; }))) / 2), xs2 = ks2.map(function (q) { return q.x; }).concat([ax2]);
      tree.push("M" + ax2 + " " + (at2 - 1) + "V" + y2, "M" + Math.min.apply(null, xs2) + " " + y2 + "H" + Math.max.apply(null, xs2));
      ks2.forEach(function (q) { tree.push("M" + q.x + " " + y2 + "V" + (q.y + 2)); });
    }
    // 谁能用谁：从用的那台到被用的那台（箭头在被用的那台）。上面一排 → 下面一排：从账户旁边绕过去；同在下面一排（一台电脑用另一台）：从下面兜过去
    var specs = String(map.getAttribute("data-rel") || "").split(" ").filter(Boolean), side = { l: 0, r: 0 }, arcs = [];
    specs.forEach(function (sp) {
      var p0 = sp.split(":"), ab0 = p0[0].split(">"), fl = p0[1] || "", a = nodeAt(ab0[0]), b = nodeAt(ab0[1]);
      if (!a || !b) return;
      var live = /L|R/.test(fl), both = /B/.test(fl), aUp = !!a.el.closest(".dv-up"), bUp = !!b.el.closest(".dv-up"), d;
      var ax3 = R(a.b.l + a.b.w / 2), bx = R(b.b.l + b.b.w / 2);
      if (aUp !== bUp) { // 上下两排之间：S 形；正好要穿过账户的从它旁边绕过去
        var u = aUp ? a : b, w0 = aUp ? b : a, ux = aUp ? ax3 : bx, wx = aUp ? bx : ax3;
        var y0 = R(u.b.t + u.b.h + 2), y1 = icTop(w0) - 6, ym = R((y0 + y1) / 2), mx = (ux + wx) / 2;
        if (A && mx > A.l - 16 && mx < A.l + A.w + 16) {
          var left = mx < A.l + A.w / 2, sx = R(left ? A.l - 22 - 12 * side.l++ : A.l + A.w + 22 + 12 * side.r++);
          d = "M" + ux + " " + y0 + "C" + ux + " " + R(y0 + 36) + " " + sx + " " + R(A.t - 10) + " " + sx + " " + R(A.t + A.h / 2) + "S" + wx + " " + R(y1 - 36) + " " + wx + " " + y1;
        } else d = "M" + ux + " " + y0 + "C" + ux + " " + ym + " " + wx + " " + ym + " " + wx + " " + y1;
        if (!aUp) { var t0 = both; both = true; if (!t0) fl += "X"; } // 从下往上的（少见）：箭头画在上面那一头
      } else arcs.push({ a: a, b: b, ax: ax3, bx: bx, up: aUp, fl: fl, key: ab0, live: live, both: both });
      if (d) rel.push('<path class="dv-e' + (live ? " live" : "") + '" data-a="' + ab0[0] + '" data-b="' + ab0[1] + '" d="' + d + '"' + (/X/.test(fl) ? ' marker-start="url(#dv-arr' + (live ? "-live" : "") + ')"' : ' marker-end="url(#dv-arr' + (live ? "-live" : "") + ')"' + (both ? ' marker-start="url(#dv-arr' + (live ? "-live" : "") + ')"' : "")) + "/>");
    });
    // 同一排的两台（一台电脑用另一台）：从下面兜过去——近的兜得浅、远的兜得深，不叠在一起
    arcs.sort(function (p, q) { return Math.abs(p.ax - p.bx) - Math.abs(q.ax - q.bx); });
    var below = 0;
    arcs.forEach(function (c, k2) {
      var dip = 30 + 16 * k2;
      if (c.up) { var yt = R(Math.min(c.a.b.t, c.b.b.t) - 2); var d2 = "M" + (c.ax + 5) + " " + yt + "C" + (c.ax + 5) + " " + (yt - dip) + " " + (c.bx - 5) + " " + (yt - dip) + " " + (c.bx - 5) + " " + (yt - 4); }
      else { var yb = R(Math.max(c.a.b.t + c.a.b.h, c.b.b.t + c.b.b.h) + 2); var d2 = "M" + (c.ax + 5) + " " + yb + "C" + (c.ax + 5) + " " + (yb + dip) + " " + (c.bx - 5) + " " + (yb + dip) + " " + (c.bx - 5) + " " + (yb + 4); below = Math.max(below, dip); }
      var mk = "url(#dv-arr" + (c.live ? "-live" : "") + ")";
      rel.push('<path class="dv-e' + (c.live ? " live" : "") + '" data-a="' + c.key[0] + '" data-b="' + c.key[1] + '" d="' + d2 + '" marker-end="' + mk + '"' + (c.both ? ' marker-start="' + mk + '"' : "") + "/>");
    });
    map.style.paddingBottom = below ? below * 0.75 + 16 + "px" : "";
    var w = map.offsetWidth, h = map.offsetHeight;
    svg.setAttribute("width", w); svg.setAttribute("height", h); svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.innerHTML = '<defs><marker id="dv-arr" viewBox="0 0 8 8" refX="6.5" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1.2L6.5 4 1 6.8" class="dv-mk"/></marker>' +
      '<marker id="dv-arr-live" viewBox="0 0 8 8" refX="6.5" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1.2L6.5 4 1 6.8" class="dv-mk live"/></marker></defs>' +
      '<path class="dv-tree" d="' + tree.join("") + '"/>' + rel.join("");
  }
  // 指着一台：只亮它那几条线、和它有关系的几台
  function focus(map, key) {
    if (!map) return;
    var rel = {}, any = false;
    map.querySelectorAll(".dv-e").forEach(function (p) { var on = !!key && (p.dataset.a === key || p.dataset.b === key); p.classList.toggle("hl", on); if (on) { any = true; rel[p.dataset.a] = 1; rel[p.dataset.b] = 1; } });
    map.classList.toggle("dv-focus", any); // 和谁都没关系的：别的不变暗
    map.querySelectorAll(".dv-node[data-node]").forEach(function (n) { n.classList.toggle("hl", !!key && (n.dataset.node === key || !!rel[n.dataset.node] || n.dataset.node === "acct")); });
  }

  // ---- 卡片（同 AirPort 点一台弹出来的那块）----
  // 右边一栏（选中一台时出来，地图让出位置）：内容多了（谁能用它、它能用谁），浮在设备旁边的小卡片放不下
  var card = null;
  function closeCard() {
    if (!card) return;
    var h0 = card._host;
    if (h0) h0.querySelectorAll(".dv-node.sel").forEach(function (x) { x.classList.remove("sel"); });
    card.remove(); card = null;
    if (h0) { h0.classList.remove("dv-open"); layout(h0); focus(h0.querySelector(".dv-map"), h0._dvFocus || ""); }
  }
  function wire(host, P, V) {
    host.addEventListener("click", function (e) {
      if (e.target.closest(".dv-card")) return;
      var nd = e.target.closest("[data-node]");
      if (!nd) return closeCard();
      var key = nd.dataset.node, n = key === "acct" ? { id: "acct" } : V.nodes && V.nodes[key];
      if (!n || card && card._key === key) return; // 已经选中的：不收起（同 Finder）
      openCard(host, P, nd, n, key, V);
    });
    // 连按两下：做它的那件事
    host.addEventListener("dblclick", function (e) {
      var nd = e.target.closest && e.target.closest("[data-node]");
      if (!nd || e.target.closest(".dv-card")) return;
      var n = V.nodes && V.nodes[nd.dataset.node];
      if (n && mainAct(n)) { closeCard(); run(mainAct(n), n, P); }
    });
    host.addEventListener("keydown", function (e) { // ⌘↓、⌘O：同连按两下
      var nd = e.target.closest && e.target.closest(".dv-node[data-node]");
      if (!nd || !e.metaKey || (e.key !== "ArrowDown" && e.key !== "o")) return;
      var n = V.nodes && V.nodes[nd.dataset.node];
      if (n && mainAct(n)) { e.preventDefault(); closeCard(); run(mainAct(n), n, P); }
    });
    host.addEventListener("contextmenu", function (e) {
      var nd = e.target.closest("[data-node]");
      if (!nd) return;
      var key = nd.dataset.node, n = key === "acct" ? null : V.nodes && V.nodes[key];
      e.preventDefault();
      if (!n) return openCard(host, P, nd, { id: "acct" }, key, V);
      var items = actsOf(n).map(function (a) { return { label: a[1], run: function () { run(a[0], n, P, host, V); } }; });
      items.push({ sep: true }, { label: t("显示简介", "Get Info"), run: function () { openCard(host, P, nd, n, key, V); } });
      S.menu(items, { x: e.clientX, y: e.clientY });
    });
    host.addEventListener("mouseover", function (e) { var nd = e.target.closest && e.target.closest(".dv-node[data-node]"); var k = nd && nd.dataset.node !== "acct" ? nd.dataset.node : ""; if (k !== host._dvFocus) { host._dvFocus = k; focus(host.querySelector(".dv-map"), card ? card._key : k); } });
    host.addEventListener("mouseleave", function () { host._dvFocus = ""; focus(host.querySelector(".dv-map"), card ? card._key : ""); });
    if (window.ResizeObserver) host._dvRO = new ResizeObserver(function () { if (V.shown()) layout(host); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (V.shown()) layout(host); });
    var redraw = function () { if (V.shown()) { host._dvHtml = ""; render(host, P, V.arg, V); } };
    if (SY() && SY().on) SY().on(function (type) { if (type === "devices") redraw(); });
    if (RH() && RH().watch) RH().watch(redraw);
    document.addEventListener("keydown", function (e) { if (card && e.key === "Escape") { e.stopPropagation(); closeCard(); focus(host.querySelector(".dv-map"), ""); } }, true);
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
    var acts = m.login ? [["signout", t("退出登录…", "Sign Out…")], ["passkeys", t("登录方式…", "Sign-In Methods…"), "primary"]] : [["signin", t("使用 GitHub 登录", "Sign In with GitHub"), "primary"]];
    var icon = S.avatarHtml && m.login ? S.avatarHtml(40, "dv-cav") : ICON.cloud;
    return { icon: icon, title: m.login || t("未登录", "Not Signed In"), sub: m.login ? t("GitHub 账户", "GitHub Account") : "Vibing Studio", rows: rows, acts: acts };
  }
  // 它能做的事：[动作, 名字, 样式]——卡片底下的按钮、右键菜单、连按两下（第一件）都用这一份
  function actsOf(n) {
    var acts = [];
    if (canDesk(n)) acts.push(["desk", t("远程桌面", "Remote Desktop"), "primary"]);
    // 另一台在线的 Mac：App 里开一个窗口连它（终端、文件、会话都在那台上；同 VS Code 的远程窗口）；网页、iPad 这一页换成用它
    var inApp = !!(window.nadosNative && (!nadosNative.remote || nadosNative.hybrid));
    if (!n.self && n.host && n.online && !n.web) acts.push(["open", inApp ? t("在新窗口中打开", "Open in New Window") : t("在这里使用", "Use Here"), canDesk(n) ? "" : "primary"]);
    // 那台上的终端：这个窗口里开一个标签页，shell 在那台上跑（经中转）
    if (!n.self && n.host && n.online && !n.web && inApp && window.TSU_LOCAL && window.TSU_RLINK) acts.push(["term", t("打开终端", "Open Terminal")]);
    if (!n.self && n.ids && n.ids.length && SY()) acts.push(["remove", t("从账户中移除…", "Remove from Account…")]);
    return acts;
  }
  var mainAct = function (n) { var a = actsOf(n).filter(function (x) { return x[0] === "desk" || x[0] === "open"; })[0]; return a ? a[0] : ""; };
  function run(a, n, P, host, V) {
    if (a === "desk" && window.TSU_RDP) return TSU_RDP.connectDevice({ id: n.id, name: n.label, host: n.host || "" }, P.win);
    if (a === "term" && n.host) return P.win.ws.newTab({ sh: { pty: true, dev: n.host, devName: n.label } });
    if (a === "open" && n.host) {
      if (S.openMac) return S.openMac(n.host, n.label);
      var rc = RC();
      if (rc && rc.use) return rc.use(n.host, n.label);
    }
    if (a === "remove" && SY()) {
      return confirmDo({ title: t("从账户中移除「" + n.label + "」？", "Remove “" + n.label + "” from your account?"), message: t("如果这台设备还登录着，下次打开 Vibing Studio 时会重新出现。", "If this device is still signed in, it will appear again the next time it opens Vibing Studio."), ok: t("移除", "Remove") },
        function () { SY().removeDevices(n.ids).then(function () { closeCard(); if (host && V) { host._dvHtml = ""; if (V.shown()) render(host, P, V.arg, V); } }, function (err) { if (window.TSU_DESK && TSU_DESK.alert) TSU_DESK.alert({ title: t("没能移除", "Couldn’t Remove the Device"), message: String((err && err.message) || err), icon: "caution" }); }); });
    }
  }
  function devCard(n) {
    var rows = [[t("状态", "Status"), n.online ? t("在线", "Online") : seen(n.last_seen), n.online ? "on" : ""]];
    if (n.model && n.model !== n.label) rows.push([t("型号", "Model"), n.model]);
    if (n.os) rows.push([t("系统", "System"), n.os]);
    if (n.app) rows.push(["Vibing Studio", String(n.app).replace(/^网页 /, "")]);
    if (n.created_at) rows.push([t("首次登录", "First Signed In"), day(n.created_at)]);
    if (n.ids && n.ids.length) rows.push([t("设备 ID", "Device ID"), n.ids[0], "id"]);
    // 卡片底下：移除放最左边，主要的放最右边（同 macOS 的对话框）
    var acts = actsOf(n), rm = acts.filter(function (a) { return a[0] === "remove"; });
    acts = rm.concat(acts.filter(function (a) { return a[0] !== "remove"; }).reverse());
    return { icon: ICON[iconOf(n)], title: n.label, sub: subOf(n) + (n.self ? " · " + t("这台设备", "This Device") : ""), rows: rows, acts: acts };
  }
  // 一条关系写成一行：名字，正在使用 / 允许于… · 上次连接…（· 在哪）
  var relLine = function (e, other) {
    var bits = e.live ? [t("正在使用", "In use")] : [];
    if (e.at) bits.push(t("允许于 ", "Allowed ") + day(e.at));
    if (!e.live && e.last && e.last - (e.at || 0) > 60000) bits.push(t("上次连接 ", "Last used ") + ago(e.last).replace(/前$/, "前"));
    if (e.loc) bits.push(e.loc.replace(/\s*·\s*IP .*$/, ""));
    return '<span class="dv-rn"><b>' + esc(other.label) + "</b><i>" + esc(bits.join(" · ") || t("允许使用", "Allowed")) + "</i></span>";
  };
  function openCard(host, P, el, n, key, V, keep) {
    closeCard();
    var m = key === "acct" ? model() : null, c = key === "acct" ? acctCard(m) : devCard(n);
    var rh = RH(), hosting = n.self && !n.web && rh, edges = V.edges || [];
    var html = '<div class="dv-ch"><span class="dv-cic">' + c.icon + '</span><div class="dv-ct"><b>' + esc(c.title) + "</b><span>" + esc(c.sub) + "</span></div></div>" +
      (c.rows.length ? '<dl class="dv-rows">' + c.rows.map(function (r) {
        return "<dt>" + esc(r[0]) + "</dt><dd" + (r[2] === "id" ? ' class="dv-id"' : "") + ">" + (r[2] === "on" ? '<i class="dv-sdot"></i>' : "") + (r[2] === "id" ? "<code>" + esc(r[1]) + '</code><button type="button" class="dv-copy" data-copy="' + esc(r[1]) + '" title="' + esc(t("拷贝", "Copy")) + '">' + COPY + "</button>" : esc(r[1])) + "</dd>";
      }).join("") + "</dl>" : "");
    if (key !== "acct") {
      var usedBy = edges.filter(function (e) { return e.to === n; }), uses = edges.filter(function (e) { return e.from === n; });
      var macWord = kindLabel(n) === "Mac" ? t("这台 Mac", "This Mac") : t("这台电脑", "This Computer");
      if (hosting) {
        var on = !!rh.on(), pol = rh.policy ? rh.policy() : "";
        html += '<div class="dv-sw"><span>' + esc(t("允许其他设备使用" + (kindLabel(n) === "Mac" ? "这台 Mac" : "这台电脑"), "Allow Other Devices to Use " + macWord)) + '</span><button type="button" class="dv-switch' + (on ? " on" : "") + '" role="switch" aria-checked="' + on + '" data-act="share"></button></div>';
        if (on && pol) html += '<div class="dv-sw dv-pol"><span>' + esc(t("连接时", "When a Device Connects")) + '</span><select class="dv-sel" data-act="policy">' + POLICIES.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === pol ? " selected" : "") + ">" + esc(t(o[1], o[2])) + "</option>"; }).join("") + "</select></div>";
      } else if (n.hostOn || n.policy) html += '<div class="dv-sw dv-ro"><span>' + esc(t("其他设备使用它", "Other Devices Can Use It")) + "</span><em>" + esc(n.hostOn === false ? t("已关闭", "Off") : polName(n.policy) || t("已打开", "On")) + "</em></div>";
      if (usedBy.length) html += '<div class="dv-sec">' + esc(t("可以使用它的设备", "Devices That Can Use It")) + '</div><ul class="dv-list">' + usedBy.map(function (e) {
        return "<li>" + relLine(e, e.from) + (hosting && e.cid && e.allowed ? '<button type="button" data-revoke="' + esc(e.cid) + '">' + esc(t("移除", "Remove")) + "</button>" : "") + "</li>";
      }).join("") + "</ul>";
      if (uses.length) html += '<div class="dv-sec">' + esc(t("它可以使用", "It Can Use")) + '</div><ul class="dv-list">' + uses.map(function (e) { return "<li>" + relLine(e, e.to) + "</li>"; }).join("") + "</ul>";
    }
    if (c.acts.length) html += '<div class="dv-acts">' + c.acts.map(function (a) { return '<button type="button" data-act="' + a[0] + '"' + (a[2] ? ' class="dv-' + a[2] + '"' : "") + ">" + esc(a[1]) + "</button>"; }).join("") + "</div>";
    card = document.createElement("div");
    card.className = "dv-card dv-panel" + (keep ? " dv-keep" : "");
    card.setAttribute("role", "dialog");
    card.innerHTML = '<button type="button" class="dv-x" data-act="close" title="' + esc(t("关闭", "Close")) + '"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>' + html;
    card._key = key; card._node = n; card._host = host;
    host.appendChild(card);
    card.style.top = host.scrollTop + 64 + "px";
    card.style.maxHeight = Math.max(200, host.clientHeight - 78) + "px";
    host.classList.add("dv-open");
    if (el && el.classList) el.classList.add("sel");
    layout(host);
    focus(host.querySelector(".dv-map"), key === "acct" ? "" : key);
    void el;
    card.addEventListener("change", function (e) {
      var sel = e.target.closest("select[data-act=policy]");
      if (sel && RH() && RH().setPolicy) Promise.resolve(RH().setPolicy(sel.value)).then(function () { host._dvHtml = ""; if (V.shown()) render(host, P, V.arg, V); });
    });
    card.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      var nn = card ? card._node : n, a = b.dataset.act, again = function () { host._dvHtml = ""; if (V.shown()) render(host, P, V.arg, V); };
      if (a === "close") return closeCard();
      if (b.dataset.copy) { copyText(b.dataset.copy); b.innerHTML = DONE; setTimeout(function () { b.innerHTML = COPY; }, 1200); return; }
      if (b.dataset.revoke && RH()) {
        var who = (V.edges || []).filter(function (x) { return x.cid === b.dataset.revoke; })[0];
        return confirmDo({ title: t("不再允许「" + (who ? who.from.label : "") + "」使用这台 Mac？", "Stop allowing “" + (who ? who.from.label : "") + "” to use this Mac?"), message: t("它下次连接时要重新确认；正连着的会断开。", "It will need approval again next time; an open connection is closed."), ok: t("移除", "Remove") },
          function () { Promise.resolve(RH().revoke(b.dataset.revoke)).then(again); });
      }
      if (a === "share" && RH()) { Promise.resolve(RH().set(!RH().on())).then(again); return; }
      if (a === "remove") return run("remove", nn, P, host, V);
      if (a === "signout") return confirmDo({ title: t("退出登录 " + (model().login || "") + "？", "Sign out of " + (model().login || "") + "?"), message: t("跟着账户的数据会停止同步；这台设备上的 Claude Code、Codex 会话不受影响。", "Account data stops syncing; Claude Code and Codex sessions on this device are not affected."), ok: t("退出登录", "Sign Out") }, function () { location.href = "/auth/logout"; });
      if (a === "signin") { location.href = "/auth/login?next=" + encodeURIComponent(location.pathname + location.search); return; }
      if (a === "passkeys") {
        closeCard();
        if (S.settings) return S.settings(P.win, "account"); // 登录方式（Touch ID、通行密钥）在 设置 › 账号
        var u = location.origin + "/account/passkeys", N = window.nadosNative;
        if (N && N.call) N.call("openExternal", { url: u }).catch(function () { window.open(u, "_blank", "noopener"); }); else window.open(u, "_blank", "noopener");
        return;
      }
      if (a === "desk" || a === "term" || a === "open") { closeCard(); return run(a, nn, P, host, V); }
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
