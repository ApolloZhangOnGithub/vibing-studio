// devices.js —— 「设备」App（参考 AirPort 实用工具）：你的设备之间的关系画成一张图——最上面是账户（同它的「互联网」），下面一排是 Mac，
//   iPhone、iPad、网页这些在用哪台 Mac 就连到那台下面，没在用的连在账户下面。点一台出它的卡片（同 AirPort 的弹出窗口）：
//   名字、状态、上次在线；另一台在线的 Mac 能「在这里打开」，这台能改名，这台 Mac 能开关「其他设备使用这台 Mac」、撤销允许过的设备。
//   数据：账户里报到过的设备（sync.js 的 TSU_SYNC.devices()）、现在在线的 Mac 和连着它们的设备（/api/relay/hosts）、这台 Mac 当主机时的（TSU_REMOTE_HOST）
(function () {
  "use strict";
  var S = window.STUDIO;
  if (!S || !S.pages || !S.openPage) return;
  var I18N = window.TSU_I18N;
  var t = function (zh, en) { return I18N && I18N.lang && I18N.lang() === "en" ? en : zh; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var SY = function () { return window.TSU_SYNC; }, RH = function () { return window.TSU_REMOTE_HOST; }, RC = function () { return window.TSU_REMOTE; };
  var ago = function (ms) { if (!ms) return ""; var s0 = (Date.now() - ms) / 1000; return s0 < 90 ? t("刚刚", "just now") : s0 < 3600 ? t(Math.floor(s0 / 60) + " 分钟前", Math.floor(s0 / 60) + " min ago") : s0 < 86400 ? t(Math.floor(s0 / 3600) + " 小时前", Math.floor(s0 / 3600) + " h ago") : t(Math.floor(s0 / 86400) + " 天前", Math.floor(s0 / 86400) + " d ago"); };
  var ONLINE_MS = 15 * 60000;

  // ---- 图标（48 格细线，同活动栏的线条图标）----
  var SV = function (b) { return '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + b + "</svg>"; };
  var ICON = {
    cloud: SV('<path d="M15 35h19.5a8.5 8.5 0 0 0 1.2-16.9A11.5 11.5 0 0 0 13.6 21 7 7 0 0 0 15 35z"/>'),
    laptop: SV('<rect x="10" y="11" width="28" height="19.5" rx="2"/><path d="M5 34.5h38l-2.4 3H7.4z"/>'),
    desktop: SV('<rect x="7" y="8.5" width="34" height="23.5" rx="2.6"/><path d="M19 39h10M24 32v7"/>'),
    ipad: SV('<rect x="11" y="6.5" width="26" height="35" rx="3.6"/><path d="M22 37.4h4"/>'),
    iphone: SV('<rect x="15" y="5.5" width="18" height="37" rx="4"/><path d="M21 9.4h6"/>'),
    web: SV('<rect x="6" y="9" width="36" height="30" rx="3"/><path d="M6 16h36"/><path d="M10.5 12.5h.01M14 12.5h.01M17.5 12.5h.01"/>'),
  };
  var iconOf = function (d) {
    var n = String(d.name || "");
    if (/iPhone/i.test(n)) return "iphone";
    if (/iPad/i.test(n)) return "ipad";
    if (/MacBook/i.test(n)) return "laptop";
    if (/iMac|Mac ?mini|Mac Studio|Mac Pro|Linux|Windows/i.test(n)) return "desktop";
    if (/Chrome|Safari|Edge|Firefox|浏览器|Browser/i.test(n)) return "web";
    if (d.mac) return "laptop";
    return d.kind === "ios" ? "iphone" : "web";
  };
  var kindName = function (d) { var k = iconOf(d); return k === "iphone" ? "iPhone" : k === "ipad" ? "iPad" : k === "web" ? t("网页", "Web") : d.mac ? "Mac" : t("电脑", "Computer"); };

  // ---- 数据：账户里的设备 + 在线的 Mac（及连着它的）——同一台按名字并起来（中转那边的编号和账户里的不是一套）----
  var hostsCache = { at: 0, list: [] };
  function loadHosts(done) {
    if (Date.now() - hostsCache.at < 5000) return;
    hostsCache.at = Date.now();
    fetch("/api/relay/hosts", { credentials: "same-origin", cache: "no-store" }).then(function (r) { return r.ok ? r.json() : []; }).then(function (l) { hostsCache.list = Array.isArray(l) ? l : []; done(); }, function () { done(); });
  }
  function model() {
    var sy = SY(), me = sy ? sy.dev : "self", nodes = [], byName = {};
    var add = function (d) { var k = String(d.name || "").toLowerCase(); if (k && byName[k]) { Object.assign(byName[k], d, { id: byName[k].id }); return byName[k]; } nodes.push(d); if (k) byName[k] = d; return d; };
    var macApp = !!(window.nadosNative && !nadosNative.remote && nadosNative.local);
    if (sy) {
      var ds = sy.devices() || {};
      Object.keys(ds).forEach(function (id) { var x = ds[id]; add({ id: id, name: x.name || t("另一台设备", "Another device"), kind: x.kind, last: x.last_seen || 0, mac: /Mac/.test(x.name || "") && !/iPad|iPhone/.test(x.name || "") && x.kind !== "ios" }); });
      add({ id: me, name: sy.name(), kind: macApp ? "mac" : "", last: Date.now(), self: true, mac: macApp || /Mac · App/.test(sy.name()) });
    } else add({ id: me, name: macApp ? "Mac" : t("这台设备", "This device"), last: Date.now(), self: true, mac: macApp });
    hostsCache.list.forEach(function (h) { var n = add({ id: "relay:" + h.device, name: h.name || "Mac", mac: true, last: Date.now() }); n.relay = h.device; n.online = true; n.since = h.since; (h.clients || []).forEach(function (c) { var cn = add({ id: "rc:" + c.cid, name: c.cname || "iPad", last: Date.now() }); cn.via = n; cn.online = true; }); });
    // 这台设备正在用哪台 Mac（网页、iPad）
    var rc = RC(), useMac = rc && rc.mac && rc.mac();
    if (useMac) { var hm = nodes.filter(function (n) { return n.relay === useMac; })[0], self0 = nodes.filter(function (n) { return n.self; })[0]; if (hm && self0) self0.via = hm; }
    // 这台 Mac 当主机：现在连着的
    var rh = RH(), self1 = nodes.filter(function (n) { return n.self; })[0];
    if (rh && self1 && self1.mac) { self1.allow = rh.on(); (rh.clients() || []).forEach(function (c) { var cn = add({ id: "rc:" + c.id, name: c.name || "iPad", last: Date.now() }); cn.via = self1; cn.online = true; }); }
    nodes.forEach(function (n) { if (n.online == null) n.online = Date.now() - (n.last || 0) < ONLINE_MS; });
    var macs = nodes.filter(function (n) { return n.mac; }).sort(function (a, b) { return (b.self ? 1 : 0) - (a.self ? 1 : 0) || (b.online ? 1 : 0) - (a.online ? 1 : 0) || (b.last || 0) - (a.last || 0); });
    var others = nodes.filter(function (n) { return !n.mac; }).sort(function (a, b) { return (b.self ? 1 : 0) - (a.self ? 1 : 0) || (b.online ? 1 : 0) - (a.online ? 1 : 0) || (b.last || 0) - (a.last || 0); });
    return { macs: macs, others: others, me: (window.TSU_AGENTS && TSU_AGENTS.me && TSU_AGENTS.me()) || null, signed: !!sy };
  }

  // ---- 画：账户在上，一排 Mac，再下一排在用某台 Mac 的设备（挂在那台下面）、没在用的（挂在账户下面），线同 AirPort 的连线 ----
  function nodeHtml(n, key) {
    var st = n.online ? (n.mac && n.self && n.allow ? t("在线 · 允许其他设备使用", "Online · Shared") : t("在线", "Online")) : n.last ? t("上次在线 ", "Last seen ") + ago(n.last) : t("离线", "Offline");
    return '<button type="button" class="dv-node' + (n.self ? " self" : "") + (n.online ? " on" : "") + '" data-node="' + esc(key) + '">' +
      '<span class="dv-ic">' + ICON[iconOf(n)] + '<i class="dv-dot"></i></span><span class="dv-name">' + esc(n.name) + "</span>" +
      '<span class="dv-st">' + (n.self ? '<b class="dv-me">' + t("这台", "This device") + "</b> · " : "") + esc(st) + "</span></button>";
  }
  function render(host, P, arg, V) {
    loadHosts(function () { if (V.shown()) render(host, P, arg, V); });
    var m = model(), keys = {}, k = 0, put = function (n) { var id = "n" + k++; keys[id] = n; return id; };
    V.nodes = keys;
    var acct = m.me && m.me.login ? m.me.login : t("未登录", "Not signed in");
    var under = function (mac) { return m.others.filter(function (o) { return o.via === mac; }); };
    var loose = m.others.filter(function (o) { return !o.via || m.macs.indexOf(o.via) < 0; });
    var html = '<div class="dv-wrap"><div class="dv-head"><h1>' + t("设备", "Devices") + '</h1><span class="dv-sub">' + esc(t("你的设备之间的连接关系；点一台看详情", "How your devices connect; click one for details")) + "</span></div>" +
      '<div class="dv-map"><svg class="dv-lines"></svg>' +
      '<div class="dv-row dv-top"><div class="dv-node dv-acct" data-node="acct"><span class="dv-ic">' + ICON.cloud + '</span><span class="dv-name">Vibing Studio</span><span class="dv-st">' + esc(acct) + "</span></div></div>" +
      '<div class="dv-row dv-macs">' + m.macs.map(function (mac) { var id = put(mac); return '<div class="dv-col" data-col="' + id + '">' + nodeHtml(mac, id) + '<div class="dv-kids">' + under(mac).map(function (o) { return nodeHtml(o, put(o)); }).join("") + "</div></div>"; }).join("") +
      (loose.length ? '<div class="dv-col dv-loose">' + loose.map(function (o) { return nodeHtml(o, put(o)); }).join("") + "</div>" : "") + "</div>" +
      (m.signed ? "" : '<p class="dv-hint">' + esc(t("登录后，这里会显示你在其他设备上的 Vibing Studio。", "Sign in to see Vibing Studio on your other devices.")) + "</p>") +
      "</div></div>";
    host.innerHTML = html;
    requestAnimationFrame(function () { lines(host); });
    if (!host._dvWired) { host._dvWired = true; wire(host, P, V); }
  }
  // 连线：账户 → 每台 Mac、账户 → 没在用 Mac 的设备、Mac → 挂在它下面的设备（直角折线，同 AirPort）
  function lines(host) {
    var map = host.querySelector(".dv-map"), svg = host.querySelector(".dv-lines");
    if (!map || !svg) return;
    var mr = map.getBoundingClientRect(), pts = [], at = function (el, edge) { var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2 - mr.left, y: (edge === "top" ? r.top : r.bottom) - mr.top }; };
    // 从上面那一台的整块（图标 + 名字 + 状态）下沿出发，到下面那一台图标的上沿：线不穿过字
    var acct = map.querySelector(".dv-acct");
    var link = function (a, b) { var p = at(a, "bottom"), q = at(b, "top"), my = Math.round(q.y - 18); pts.push("M" + p.x + " " + (p.y + 2) + "V" + my + "H" + q.x + "V" + (q.y - 2)); };
    map.querySelectorAll(".dv-macs > .dv-col:not(.dv-loose) > .dv-node").forEach(function (nd) { if (acct) link(acct, nd.querySelector(".dv-ic")); });
    map.querySelectorAll(".dv-loose > .dv-node").forEach(function (nd) { if (acct) link(acct, nd.querySelector(".dv-ic")); });
    map.querySelectorAll(".dv-macs > .dv-col:not(.dv-loose)").forEach(function (col) { var mac = col.querySelector(":scope > .dv-node"); col.querySelectorAll(".dv-kids > .dv-node").forEach(function (nd) { link(mac, nd.querySelector(".dv-ic")); }); });
    svg.setAttribute("width", mr.width); svg.setAttribute("height", mr.height);
    svg.innerHTML = pts.map(function (d) { return '<path d="' + d + '"/>'; }).join("");
  }
  // ---- 卡片（同 AirPort 点一台弹出来的那块）----
  var card = null;
  function closeCard() { if (card) { card.remove(); card = null; } }
  function wire(host, P, V) {
    host.addEventListener("click", function (e) {
      var nd = e.target.closest("[data-node]");
      if (!nd || nd.dataset.node === "acct") { if (!e.target.closest(".dv-card")) closeCard(); return; }
      var n = V.nodes && V.nodes[nd.dataset.node];
      if (n) openCard(host, P, nd, n);
    });
    window.addEventListener("resize", function () { if (V.shown()) lines(host); });
    document.addEventListener("keydown", function (e) { if (card && e.key === "Escape") closeCard(); }, true);
  }
  function openCard(host, P, el, n) {
    closeCard();
    var rows = [[t("类型", "Kind"), kindName(n)], [t("状态", "Status"), n.online ? t("在线", "Online") : t("离线", "Offline")]].concat(n.last && !n.online ? [[t("上次在线", "Last seen"), ago(n.last)]] : []).concat(n.via ? [[t("正在使用", "Using"), n.via.name]] : []);
    var acts = [];
    if (n.self) acts.push(["rename", t("重命名…", "Rename…")]);
    if (n.mac && !n.self && n.online && n.relay) acts.push(["open", t("在这里使用这台 Mac", "Use This Mac Here")]);
    if (n.self && n.mac && RH()) acts.push(["share", RH().on() ? t("不再允许其他设备使用", "Stop Sharing This Mac") : t("允许其他设备使用这台 Mac", "Share This Mac")]);
    var appr = n.self && n.mac && RH() ? RH().approved() || [] : [];
    card = document.createElement("div");
    card.className = "dv-card";
    card.innerHTML = '<div class="dv-ch"><span class="dv-cic">' + ICON[iconOf(n)] + '</span><div><b>' + esc(n.name) + "</b><span>" + esc(kindName(n)) + "</span></div></div>" +
      '<dl class="dv-rows">' + rows.map(function (r) { return "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>"; }).join("") + "</dl>" +
      (appr.length ? '<div class="dv-sec">' + esc(t("允许过的设备", "Allowed Devices")) + '</div><ul class="dv-appr">' + appr.map(function (a) { return '<li><span>' + esc(a.name || a.id) + '</span><button type="button" data-revoke="' + esc(a.id) + '">' + esc(t("撤销", "Revoke")) + "</button></li>"; }).join("") + "</ul>" : "") +
      (acts.length ? '<div class="dv-acts">' + acts.map(function (a) { return '<button type="button" data-act="' + a[0] + '">' + esc(a[1]) + "</button>"; }).join("") + "</div>" : "");
    host.appendChild(card);
    var r = el.getBoundingClientRect(), hr = host.getBoundingClientRect();
    var left = Math.max(12, Math.min(hr.width - card.offsetWidth - 12, r.left - hr.left + r.width / 2 - card.offsetWidth / 2)), top = r.bottom - hr.top + host.scrollTop + 8;
    card.style.left = left + "px"; card.style.top = top + "px";
    card.addEventListener("click", function (e) {
      e.stopPropagation();
      var b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.revoke && RH()) { RH().revoke(b.dataset.revoke); closeCard(); setTimeout(function () { P.program && P.program.redraw && P.program.redraw(); }, 300); return; }
      var a = b.dataset.act;
      if (a === "rename" && S.ask && SY()) S.ask({ title: t("重命名这台设备", "Rename This Device"), value: SY().name() }).then(function (v) { if (v == null || v === true) return; v = String(v).trim(); if (v) { SY().rename(v); closeCard(); setTimeout(function () { P.program && P.program.redraw && P.program.redraw(); }, 300); } });
      else if (a === "share" && RH()) { RH().set(!RH().on()); closeCard(); setTimeout(function () { P.program && P.program.redraw && P.program.redraw(); }, 500); }
      else if (a === "open" && n.relay) {
        closeCard();
        var rc = RC();
        if (rc && rc.use) return rc.use(n.relay, n.name); // 网页、iPad：这一页换成用那台 Mac
        // Mac / Linux 的 App：在内置浏览器里开一页网页版，连那台 Mac（同在 iPad 上用它）
        var u = location.origin + "/terminal.html?mac=" + encodeURIComponent(n.relay);
        if (window.TSU_WEB && TSU_WEB.open) TSU_WEB.open(P.win, u);
      }
    });
  }

  S.pages.devices = {
    title: function () { return t("设备", "Devices"); },
    address: function () { return "devices.local.paimon"; },
    render: render,
    detach: function () { closeCard(); },
  };
  // 「App」里一格
  if (S.apps && S.apps.add) S.apps.add({
    id: "devices", builtin: true, name: function () { return t("设备", "Devices"); },
    logo: function () { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="12.5" height="9" rx="1.2"/><path d="M1 16.5h17"/><rect x="16.5" y="8.5" width="6" height="11" rx="1.3"/><path d="M19 17.6h1"/></svg>'; },
    find: function (tw) { var hit = null; (tw && tw.ws && tw.ws.all ? tw.ws.all() : []).forEach(function (p) { if (!hit && p.program && p.program.page === "devices") hit = p; }); return hit; },
    open: function (tw) { return S.openPage(tw, "devices", ""); },
  });
})();
