// browser.js —— Paimon Terminal 当浏览器用（同 Safari）：每个标签页有个地址，agent 就是网址——
//   local.claude:                     Claude Code 的主页（这台 Mac 上的会话：在跑的、最近的，新会话）
//   local.claude:<账号>/<会话>/        一个 Claude Code 会话（账号：Claude 账号 id 的前 8 位；会话：会话 id 的前 8 位，同 claude attach / claude agents 用的）
//   local.paimon:                     Paimon Code 的主页（这个账号的 agent）
//   local.paimon:<agent>/             一个 Paimon Code agent
//   「local.」是在哪（这台 Mac）；以前的 claude.code/…、paimon.code/… 也照样认
//   ~/某个目录                         一个 shell（地址就是它现在的目录）
// 工具栏中间是地址栏（⌘L）：敲地址、会话名、目录都行，边敲边给建议；右上角 + 新标签页、标签页概览（⇧⌘\，同 Safari）；
// 标签页栏一直在（一个标签页也在）；访问过的 agent 网址记进历史记录（本机），macOS 菜单栏里有「历史记录」，⌘Y 打开历史记录页。
// 主页、历史记录是面板里的 HTML 页面（PageView），跟 shell、agent 界面一样是面板里跑的「程序」
(function () {
  "use strict";
  var root = document.documentElement;
  if (!root.classList.contains("termapp")) { window.TSU_BROWSER = null; return; }
  var N = window.nadosNative, LOC = window.TSU_LOCAL, A = window.TSU_AGENTS;
  var T = function () { return window.TSU_TERM; };
  // Claude Code 的支持是连接器（ext.js 的 TSU_CONNECTORS）：关着时没有 local.claude: 这些地址、它的主页、它的会话建议和菜单项（Codex 同：local.codex:）
  var ccOn = function () { return !!(window.TSU_EXT && TSU_EXT.on("claude-code")); };
  // Claude App 风格：新建 = 新会话的草稿（说了第一句话才真的建，见 claudeapp.js）
  var isCa = function () { return root.classList.contains("st-os-claude") && !!(window.TSU_CLAUDEAPP && TSU_CLAUDEAPP.newSession); };
  var caNew = function () { if (!isCa()) return false; TSU_CLAUDEAPP.newSession(); return true; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var home = function () { var i = LOC && LOC.info(); return i ? i.home : ""; };
  var tilde = function (p) { var h = home(); return !p ? "" : h && (p === h || p.indexOf(h + "/") === 0) ? "~" + p.slice(h.length) : p; };
  var untilde = function (p) { return p === "~" || p.indexOf("~/") === 0 ? home() + p.slice(1) : p; };

  // ---- 账号：Claude 的（~/.claude.json 里的 accountUuid 前 8 位；只取这一样）、Paimon 的（GitHub 账号 id）----
  var ccAcct = localStorage.getItem("tsu-cc-acct") || "";
  var readAcct = function () {
    if (!LOC || !ccOn()) return;
    LOC.ready.then(function () {
      return LOC.read(home() + "/.claude.json").then(function (buf) {
        var j = JSON.parse(new TextDecoder().decode(buf)), u = j && j.oauthAccount && j.oauthAccount.accountUuid;
        if (u) { ccAcct = String(u).replace(/-/g, "").slice(0, 8); localStorage.setItem("tsu-cc-acct", ccAcct); syncAll(); }
      });
    }).catch(function () { /* 没登录 Claude Code：地址里账号那段是 me */ });
  };
  readAcct();
  if (window.TSU_EXT) TSU_EXT.watch(function (id, on) { if (id === "claude-code") { if (on) readAcct(); menusSoon(); } });
  var pmAcct = function () { var me = A && A.me && A.me(); return me && me.id ? String(me.id) : "me"; };
  var ccURL = function (id) { return "local.claude:" + (ccAcct || "me") + "/" + String(id).slice(0, 8) + "/"; };
  var pmURL = function (id) { return "local.paimon:" + id + "/"; };
  // 地址栏平时只显示「站点」（同 Safari 默认不显示完整网址）：local.claude:…/… → local.claude；目录、文件 → 最后一段；设置里能改成显示完整地址
  var siteOf = function (u) { u = String(u || ""); var lp = /^([\w-]+\.local\.paimon)(?:\/|$)/i.exec(u); if (lp) return lp[1]; var m = /^([\w.-]+):/.exec(u); if (m && !/^https?$/i.test(m[1])) return m[1]; if (/^(~|\/)/.test(u)) return u.replace(/\/+$/, "").split("/").pop() || u; var w = /^https?:\/\/([^/]+)/i.exec(u); return w ? w[1] : u; };

  // ---- 小图标（地址栏、标签页、建议、历史记录）----
  var CLG = function () { return (window.TSU_LOGOS && TSU_LOGOS.claude) || ""; }; // Claude 自己的标志（ext.js）
  var CXL = function () { return (window.TSU_LOGOS && TSU_LOGOS.codex) || "◎"; }; // Codex：ChatGPT / OpenAI 的结（ext.js）
  var PMAV = function () { return (window.TSU_LOGOS && TSU_LOGOS.paimon) || "✦"; }; // Paimon：派蒙的头像（ext.js）
  var PIL = function () { return (window.TSU_LOGOS && TSU_LOGOS.pi) || ""; }; // pi：它自己的标志（ext.js）
  var TYL = function () { return (window.TSU_LOGOS && TSU_LOGOS.teyvat) || ""; }; // Teyvat：提瓦特这颗星球的图（ext.js）
  var CLOCK = '<svg class="bf-clock" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="8" cy="8" r="6.25"/><path d="M8 4.5V8l2.4 1.6"/></svg>'; // 历史记录：画的钟（不用 ◷ 这种字符当图标）
  var FAV = { claude: '<span class="bfav bf-claude">' + CLG() + '</span>', paimon: '<span class="bfav bf-paimon">' + PMAV() + '</span>', shell: '<span class="bfav bf-shell">›_</span>', history: '<span class="bfav bf-hist">' + CLOCK + '</span>', codex: '<span class="bfav bf-codex">' + CXL() + '</span>', pi: '<span class="bfav bf-pi">' + PIL() + '</span>', teyvat: '<span class="bfav bf-pi bf-ty">' + TYL() + '</span>', web: '<span class="bfav bf-web">◍</span>' };
  // 主页里每行前面：状态点（在干活绿、开着闲着灰圈、没在跑不画），同一页里不用每行都挂同一个图标
  var DOT = function (st) { return '<span class="bdot' + (st ? " " + st : "") + '"></span>'; };
  var kindOfURL = function (u) { return /^(local\.)?claude[:.]/.test(u) ? "claude" : /^(local\.)?codex[:.]/.test(u) ? "codex" : /^(local\.)?pi[:.]/.test(u) ? "pi" : /^(local\.)?teyvat[:.]/.test(u) ? "teyvat" : /^((dash|explorer)\.)?(local\.)?paimon[:.]?/.test(u) ? "paimon" : /^(~|\/)/.test(u) ? "shell" : /^https?:/.test(u) ? "web" : "history"; };

  // ---- 面板现在的地址：{ url, title, kind } ----
  function ccOf(tw) { return tw && tw.side && tw.side.cc ? tw.side.cc() : { list: [], panes: {} }; }
  function isClaude(f) { return !!(f && f.pid && /claude/i.test(f.name || "")); }
  function addressOf(P) {
    var prog = P && P.program;
    if (!prog) return { url: "", title: "", kind: "shell" };
    if (prog.page === "file") return { url: tilde(prog.arg || ""), title: prog.title(), kind: "file", path: prog.arg };
    if (prog.page === "settings") return { url: "settings", title: prog.title(), kind: "settings" };
    if (prog.page === "keys") return { url: "settings/keys", title: prog.title(), kind: "keys" };
    if (prog.page === "web") return { url: prog.address ? prog.address() : "", title: prog.title(), kind: "web" }; // 内嵌的浏览器（webview.js）
    if (prog.page && prog.address && prog.address()) return { url: prog.address(), title: prog.title(), kind: "paimon", page: prog.page, arg: prog.arg }; // 仪表盘、资源管理器（dash. / explorer.local.paimon）
    if (prog.page) return { url: prog.page === "history" ? "" : prog.page === "claude" || prog.page === "paimon" ? "local." + prog.page + ":" : prog.page, title: prog.title(), kind: prog.page, page: prog.page };
    if (prog.agentId && /^cc:/.test(prog.agentId)) return { url: ccURL(prog.agentId.slice(3)), title: prog.title(), kind: "claude" };
    if (prog.agentId && /^cx:/.test(prog.agentId)) { var xid = window.TSU_CODEX ? TSU_CODEX.real(prog.agentId.slice(3)) : prog.agentId.slice(3); return { url: /^new-/.test(xid) ? "local.codex:" : "local.codex:" + xid.slice(0, 8) + "/", title: prog.title(), kind: "codex" }; } // Codex 的会话（连接器）：local.codex:<会话 id 前 8 位>/
    if (prog.agentId && /^pi:/.test(prog.agentId)) { var pid = prog.agentId.slice(3); return { url: "local.pi:" + pid.slice(0, 8) + "/", title: prog.title(), kind: "pi" }; } // pi 的会话（连接器）：local.pi:<会话 id 前 8 位>/
    if (prog.agentId && /^ty:/.test(prog.agentId)) return { url: "local.teyvat:" + prog.agentId.slice(3) + "/", title: prog.title(), kind: "teyvat" }; // Teyvat 的 agent：local.teyvat:<agent id>/
    if (prog.agentId) return { url: pmURL(prog.agentId), title: prog.title(), kind: "paimon" };
    var cc = ccOf(P.win), id = null;
    Object.keys(cc.panes).forEach(function (k) { if (cc.panes[k] === P) id = k; });
    if (id) { var x = cc.list.filter(function (y) { return y.id === id; })[0]; return { url: ccURL(id), title: x ? x.title : P.title(), kind: "claude" }; }
    if (P.shell && isClaude(P.shell.fg)) return { url: "local.claude:" + (ccAcct || "me") + "/", title: P.title(), kind: "claude" };
    return { url: tilde(P.shell && P.shell.cwd ? P.shell.cwd() : ""), title: P.title(), kind: "shell" };
  }

  // ======== 历史记录（本机）：访问过的 agent 网址 { url, title, t } ========
  var HKEY = "tsu-term-history", HMAX = 3000;
  var hist = (function () { try { return JSON.parse(localStorage.getItem(HKEY) || "[]"); } catch (e) { return []; } })();
  var saveHist = function () { try { localStorage.setItem(HKEY, JSON.stringify(hist.slice(-HMAX))); } catch (e) { /* 满了 */ } menusSoon(); document.dispatchEvent(new Event("tsu-history")); };
  // 每个标签页记着它上一次的地址：地址变了（走到了别处）才记一笔；切标签页不算
  var tabLast = new WeakMap();
  function record(tab, addr) {
    var prev = tabLast.get(tab);
    if (prev && prev.url === addr.url) { if (addr.title && prev.title !== addr.title && prev.entry) { prev.title = prev.entry.title = addr.title; saveHist(); } return; }
    var o = { url: addr.url, title: addr.title };
    tabLast.set(tab, o);
    if (!/^local\.(claude|paimon):|\.code/.test(addr.url)) return; // 只记 agent 的网址（local.claude:、local.paimon:），目录不记
    o.entry = { url: addr.url, title: addr.title || addr.url, t: Date.now() };
    hist.push(o.entry);
    saveHist();
  }
  function recent(n) { var seen = {}, out = []; for (var i = hist.length - 1; i >= 0 && out.length < n; i--) { var h = hist[i]; if (seen[h.url]) continue; seen[h.url] = 1; out.push(h); } return out; }

  // ======== 走到一个地址（地址栏回车、主页里点、历史记录里点）========
  // 就地（这个面板变成它）：主页、历史记录这种页面；shell 闲着时敲目录是 cd。别的开新标签页（不把跑着的东西换掉）
  function navigable(P) { return !!(P && P.program && P.program.page); }
  function go(text, P, opts) {
    opts = opts || {};
    var tw = P ? P.win : T().front();
    if (!tw) return false;
    P = P || tw.ws.active;
    var s = String(text || "").trim().replace(/^[a-z]+:\/\/(?=(claude|paimon)\.code)/i, "");
    // 新的写法 local.claude:<账号>/<会话>/、local.paimon:<agent>/（也认 claude:、paimon:）→ 换成老的 claude.code/<账号>/<会话> 再往下走
    var nm = /^(?:local\.)?(claude|paimon):\/*([^\s]*?)\/*$/i.exec(s);
    if (nm) { var segs = nm[2].split("/").filter(Boolean), k0 = nm[1].toLowerCase(); s = k0 + ".code" + (segs.length ? "/" + (k0 === "claude" ? (segs.length > 1 ? segs[0] + "/" + segs[1] : (ccAcct || "me") + "/" + segs[0]) : pmAcct() + "/" + segs[segs.length - 1]) : ""); }
    if (!s) return false;
    // Codex 的会话（连接器）：local.codex:<会话 id 或前几位>/
    var cxm = /^(?:local\.)?codex:\/*([0-9a-f-]*)\/*$/i.exec(s);
    if (cxm) {
      var CX = window.TSU_CODEX;
      if (!CX) return flash(tw, "Codex 连接器没开（设置 › 连接器）");
      var cid = cxm[1].toLowerCase(), pick = function () { return cid ? CX.list().filter(function (y) { return y.id.indexOf(cid) === 0; })[0] : null; };
      if (!cid) { if (window.STUDIO && STUDIO.showView) STUDIO.showView(tw, "agents"); return true; }
      var hitX = pick();
      if (hitX) { tw.side.viewCX(hitX.id, hitX); return true; }
      CX.refresh(true).then(function () { var x3 = pick(); if (x3) tw.side.viewCX(x3.id, x3); else flash(tw, "本机没有此 Codex 会话：" + cid); });
      return true;
    }
    // pi 的会话（连接器）：local.pi:<会话 id 或前几位>/
    var pim = /^(?:local\.)?pi:\/*([0-9A-Za-z_-]*)\/*$/i.exec(s);
    if (pim) {
      var PIc = window.TSU_PI;
      if (!PIc) return flash(tw, "pi 连接器没开（设置 › 连接器）");
      var pidq = pim[1], pickP = function () { return pidq ? PIc.list().filter(function (y) { return y.id.indexOf(pidq) === 0; })[0] : null; };
      if (!pidq) { if (window.STUDIO && STUDIO.showView) STUDIO.showView(tw, "agents"); return true; }
      var hitP = pickP();
      if (hitP && tw.side.viewPI) { tw.side.viewPI(hitP.id, hitP); return true; }
      PIc.refresh(true).then(function () { var x4 = pickP(); if (x4 && tw.side.viewPI) tw.side.viewPI(x4.id, x4); else flash(tw, "本机没有此 pi 会话：" + pidq); });
      return true;
    }
    // Teyvat 的 agent（连接器）：local.teyvat:<agent id 或名字的开头>/
    var tym = /^(?:local\.)?teyvat:\/*([0-9A-Za-z_.-]*)\/*$/i.exec(s);
    if (tym) {
      var TYc = window.TSU_TEYVAT;
      if (!TYc) return flash(tw, "Teyvat 连接器没开（设置 › 连接器）");
      var tq = tym[1], pickT = function () { return tq ? TYc.list().filter(function (y) { return y.id.indexOf(tq) === 0 || y.name === tq; })[0] : null; };
      if (!tq) { if (window.STUDIO && STUDIO.showView) STUDIO.showView(tw, "agents"); return true; }
      var hitT = pickT();
      if (hitT && tw.side.viewTY) { tw.side.viewTY(hitT.id); return true; }
      TYc.refresh(true).then(function () { var x5 = pickT(); if (x5 && tw.side.viewTY) tw.side.viewTY(x5.id); else flash(tw, "本机没有此 Teyvat agent：" + tq); });
      return true;
    }
    // 资源管理器（explorer.local.paimon/<agent>/… 是进到那个 agent 的包里）。仪表盘（dash.local.paimon）没有了
    var am = /^agents\.local\.paimon(?:\/(.*?))?\/?$/i.exec(s); // Agent Finder
    if (am) { if (window.STUDIO) STUDIO.openPage(tw, "explorer", am[1] || "agents"); return true; }
    var fm = /^finder\.local\.paimon(?:\/(.*?))?\/?$/i.exec(s); // File Finder
    if (fm) { if (window.STUDIO) STUDIO.openPage(tw, "explorer", fm[1] === undefined ? "" : fm[1] || "/"); return true; }
    var em = /^extensions\.local\.paimon(?:\/([^/\s]+))?\/?$/i.exec(s);
    if (em) { if (window.STUDIO) { if (em[1] && STUDIO.pages.extension) STUDIO.openPage(tw, "extension", em[1]); else STUDIO.showView(tw, "extensions"); } return true; }
    var xm = /^explorer\.local\.paimon(?:\/(.*?))?\/?$/i.exec(s);
    if (xm) { if (window.STUDIO) STUDIO.openPage(tw, "explorer", xm[1] || ""); return true; }
    var m = /^(claude|paimon)\.code(?:\/([^/\s]*))?(?:\/([^/\s]+))?\/?$/i.exec(s);
    if (m && m[1].toLowerCase() === "claude" && !ccOn()) return flash(tw, "Claude Code 连接器没开（设置 › 连接器）");
    if (m) {
      var kind = m[1].toLowerCase(), id = m[3];
      if (!id) return openPage(kind, P, opts);
      if (kind === "paimon") {
        var ag = A.get(id) || A.byName && A.byName(id);
        if (!ag) return flash(tw, "找不到 Agent：" + id);
        if (ag.archived) A.unarchive(ag.id);
        if (navigable(P) || P.program && P.program.agentId) { P.run(T().makeView(P, ag.id)); return true; }
        tw.side.open(ag.id, "tab");
        return true;
      }
      var cc = ccOf(tw), x = cc.list.filter(function (y) { return y.id.indexOf(id) === 0 || y.job === id; })[0];
      if (!x) { tw.side.refreshCC(true).then(function () { var x2 = ccOf(tw).list.filter(function (y) { return y.id.indexOf(id) === 0 || y.job === id; })[0]; if (x2) tw.side.openCC(x2.id, navigable(P) ? P : null); else flash(tw, "本机没有此 Claude Code 会话：" + id); }); return true; }
      if (tw.side.viewCC && window.TSU_CLAUDE) tw.side.viewCC(x.id, x); else tw.side.openCC(x.id, navigable(P) ? P : null);
      return true;
    }
    if (/^history$/i.test(s) || s === "历史记录") return openPage("history", P, opts);
    if (/^(~|\/)/.test(s)) { // 文件：在右侧打开（Studio）；目录：闲着的 shell 里 cd，不然新标签页从那里开
      var dir = untilde(s.replace(/\/+$/, "") || "/");
      if (LOC && window.STUDIO && /\.[\w]{1,10}$/.test(dir)) { LOC.stat(dir).then(function (st) { if (st && st.type === "file") STUDIO.openFile(tw, dir); else if (st) go(dir + "/", P, opts); else flash(tw, "文件不存在：" + s); }); return true; }
      if (P && P.program === P.shell && P.shell.pty && !(P.shell.fg && P.shell.fg.pid)) { P.shell.type("cd " + T().shellEscape(dir) + "\r"); P.focus(); return true; }
      tw.ws.newTab({ sh: { cwd: dir, pty: true } });
      return true;
    }
    var isWeb = /^https?:\/\//i.test(s) || /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/\S*)?$/i.test(s) || /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(s) && !/\.code(\/|$)/.test(s);
    if (isWeb && window.TSU_WEB) { if (P && P.program && P.program.web) P.program.open(s); else TSU_WEB.open(tw, s); return true; } // 内嵌的浏览器（localhost 调试也在这里）
    if (isWeb) { T().openLink(/^https?:/i.test(s) ? s : "https://" + s); return true; }
    var sug = suggest(s)[0];
    if (sug) return go(sug.url || sug.go, P, opts);
    flash(tw, "无法识别的地址：" + s);
    return false;
  }
  function openPage(kind, P, opts) {
    var tw = P ? P.win : T().front();
    // 已经开着这一页的标签页：跳过去
    var hit = null;
    tw.ws.tabs.forEach(function (t, i) { tw.ws.leaves(t.root).forEach(function (l) { if (!hit && l.pane.program && l.pane.program.page === kind) hit = { i: i, p: l.pane }; }); });
    if (hit && !opts.fresh) { tw.ws.select(hit.i); tw.ws.activate(hit.p); hit.p.focus(); return true; }
    if (navigable(P)) { P.run(new PageView(P, kind)); return true; }
    tw.ws.newTab({ sh: { cwd: P && P.shell && P.shell.cwd ? P.shell.cwd() : "" }, page: kind }); // 页面底下的 shell 用到时才起
    return true;
  }
  function flash(tw, msg) { var p = tw.ws.active; if (p && p.flash && p.program && !p.program.page && !p.program.pty) p.flash(msg); else if (window.TSU_DESK && TSU_DESK.alert) TSU_DESK.alert({ title: msg }); return false; }

  // ---- 建议（地址栏边敲边出）：主页、会话、agent、历史记录、目录 ----
  function suggest(q) {
    q = String(q || "").trim().toLowerCase();
    var tw = T() && T().front(), out = [], seen = {};
    var add = function (o) { var k = o.url || o.go; if (!k || seen[k]) return; seen[k] = 1; out.push(o); };
    var hit = function (s) { return String(s || "").toLowerCase().indexOf(q) >= 0; };
    if (!q) return [];
    if (/^(~|\/)/.test(q)) add({ kind: "shell", title: "在此打开 Shell", url: q });
    [{ url: "local.claude:", title: "Claude Code", cc: true }, { url: "agents.local.paimon", title: "Agent Finder" }, { url: "finder.local.paimon", title: "File Finder" }].forEach(function (h) { if ((!h.cc || ccOn()) && (hit(h.url) || hit(h.title))) add({ kind: kindOfURL(h.url), title: h.title, url: h.url }); });
    if (hit("history") || hit("历史记录")) add({ kind: "history", title: "历史记录", go: "history" });
    if (ccOn()) ccOf(tw).list.forEach(function (x) { if (hit(x.title) || hit(x.id.slice(0, 8)) || hit(ccURL(x.id))) add({ kind: "claude", title: x.title, url: ccURL(x.id) }); });
    if (A) A.list().forEach(function (a) { if (hit(a.name) || hit(a.id)) add({ kind: "paimon", title: a.name, url: pmURL(a.id) }); });
    recent(400).forEach(function (h) { if ((ccOn() || kindOfURL(h.url) !== "claude") && (hit(h.title) || hit(h.url))) add({ kind: kindOfURL(h.url), title: h.title, url: h.url }); });
    return out.slice(0, 8);
  }

  // ======== 页面（面板里跑的 HTML）：claude.code、paimon.code、历史记录 ========
  var TITLES = { claude: "Claude Code", paimon: "Paimon Code", history: "历史记录" };
  // 开着的页面：会话列表、agent、历史记录变了就重画看得见的；「几分钟前」每 5 秒走一下
  var views = [];
  var redrawAll = function () { views = views.filter(function (v) { return !v.gone(); }); views.forEach(function (v) { v.redraw(); }); };
  document.addEventListener("tsu-cc", redrawAll);
  document.addEventListener("tsu-history", redrawAll);
  if (A) A.on(function (t) { if (t === "agents") redrawAll(); });
  setInterval(redrawAll, 5000);
  function PageView(P, kind) {
    var V = this, host = document.createElement("div");
    host.className = "tweb tweb-" + kind;
    P.el.appendChild(host);
    V.page = kind;
    V.title = function () { return TITLES[kind] || kind; };
    V.busy = function () { return false; };
    V.full = function () { return true; };
    V.noJump = function () { return true; };
    V.inputChanged = function () {};
    V.key = function () {};
    V.spec = function () { return { sh: P.shell.spec().sh, page: kind }; };
    var q = "", shown = false;
    V.render = function () { host.style.display = ""; shown = true; draw(); if (kind === "claude" && !ccOf(P.win).list.length) P.win.side.refreshCC(true); };
    V.detach = function () { host.style.display = "none"; shown = false; };
    // 拿到焦点：焦点已经在这页里面就不动；不然给整页（不是搜索框——以前每点一下就被拽回搜索框，方向键、Delete 都用不了）。打字时才进搜索框
    V.focus = function () { var a = document.activeElement; if (a && host.contains(a)) return; var pg = host.querySelector(".tw-page"); if (pg) pg.focus({ preventScroll: true }); };
    V.redraw = function () { if (shown && !P.closed && P.program === V) draw(); };
    V.gone = function () { return P.closed; };
    views.push(V);
    function row(o) {
      return '<div class="tw-row" data-go="' + esc(o.go) + '">' + (o.fav || "") + '<div class="tw-main"><div class="tw-t">' + esc(o.title) + (o.badge ? '<span class="tw-badge ' + (o.badgeCls || "") + '">' + esc(o.badge) + "</span>" : "") + "</div>" +
        (o.sub ? '<div class="tw-s">' + esc(o.sub) + "</div>" : "") + '</div><div class="tw-r">' + esc(o.right || "") + "</div></div>";
    }
    function section(title, rows) { return rows.length ? '<div class="tw-sec">' + esc(title) + '</div><div class="tw-list">' + rows.join("") + "</div>" : ""; }
    function draw() {
      var f = function (s) { return !q || String(s || "").toLowerCase().indexOf(q) >= 0; }, html = "", tt = T();
      if (kind === "claude") {
        var cc = ccOf(P.win), live = [], old = [];
        cc.list.forEach(function (x) {
          if (!f(x.title) && !f(x.last)) return;
          var busy = x.live && x.live.status === "busy", here = !!cc.panes[x.id];
          var o = { go: ccURL(x.id), fav: DOT(busy ? "on" : x.live || here ? "idle" : ""), title: x.title, sub: x.missing && !x.job ? "目录不存在：" + tilde(x.cwd) : x.last || "",
            right: x.live ? tt.dur(Date.now() - (x.live.since || x.mtime)) : tt.ago(x.mtime) };
          if (x.live || here) { o.badge = (busy ? "运行中" : "空闲") + (here ? " · 本窗口" : x.live && x.live.kind === "bg" ? " · 后台" : " · 其他终端"); o.badgeCls = busy ? "on" : ""; live.push(row(o)); } else old.push(row(o));
        });
        html = head("claude", "Claude Code", (ccAcct ? "账号 " + ccAcct + " · " : "") + cc.list.length + " 个会话", '<button class="tw-btn" data-act="new-cc">新建会话</button>') +
          section("正在运行", live) + section("最近", old) + (cc.list.length ? "" : '<div class="tw-empty">暂无 Claude Code 会话</div>');
      } else if (kind === "paimon") {
        var rows = { f: [], b: [], o: [] };
        (A ? A.list() : []).forEach(function (a) {
          if (!f(a.name)) return;
          var st = tt.status(a), tail = A.runtime(a.id).tail ? String(A.runtime(a.id).tail() || "").replace(/\s+/g, " ").trim() : "";
          var work = /\[W\]/.test(st.tag);
          rows[st.g].push(row({ go: pmURL(a.id), fav: DOT(work ? "on" : st.g === "o" ? "" : "idle"), title: a.name, sub: tail, right: st.time, badge: st.g === "o" ? "" : (work ? "运行中" : "空闲") + (st.g === "f" ? " · 本窗口" : " · 后台"), badgeCls: work ? "on" : "" }));
        });
        html = head("paimon", "Paimon Code", "账号 " + pmAcct() + " · " + (A ? A.list().length : 0) + " 个 Agent", '<button class="tw-btn" data-act="new-agent">新建 Agent</button>') +
          section("已打开", rows.f) + section("后台运行", rows.b) + section("全部", rows.o) + (A && A.list().length ? "" : '<div class="tw-empty">暂无 Agent</div>');
      } else {
        // 同 Safari 的「历史记录」：左上大标题，右上「清除历史记录…」和搜索框；下面一张两列的表（网站 | 地址），按天分组（「今天访问 · 93 项」，
        //   三角能收起），一行一条：图标 + 标题、地址。点一下选中，双击 / 回车打开，Delete 删掉这一条
        var days = {}, order = [], seenDay = {};
        for (var i = hist.length - 1; i >= 0; i--) {
          var h = hist[i];
          if (!f(h.title) && !f(h.url)) continue;
          var d = new Date(h.t), k = d.toDateString();
          if (seenDay[k + " " + h.url]) continue; // 同一天去过好几次的只列最近那次（同 Safari）
          seenDay[k + " " + h.url] = 1;
          if (!days[k]) { days[k] = []; order.push(k); }
          if (days[k].length < 500) days[k].push({ h: h, i: i });
        }
        order.sort(function (a, b) { return new Date(b) - new Date(a); }); // 新的一天在上面
        var lastN = window.TSU_TERM && TSU_TERM.lastTabs ? TSU_TERM.lastTabs().length : 0; // 上次开着、现在没开的标签页：一个按钮全开回来
        var body = order.map(function (k) {
          var shut = !q && (k in HFOLD ? HFOLD[k] : hShut(k, days[k].length)), g = '<div class="sf-grp' + (shut ? "" : " open") + '" data-day="' + esc(k) + '"><div class="sf-c1"><i class="sf-chev"></i><i class="sf-clk"></i>' + esc(dayGroup(k)) + '</div><div class="sf-c2">' + days[k].length + " 项</div></div>";
          return g + (shut ? "" : days[k].map(function (x) { var on = hSel === x.h.t + " " + x.h.url; return '<div class="sf-row' + (on ? " sel" : "") + '" data-go="' + esc(x.h.url) + '" data-key="' + esc(x.h.t + " " + x.h.url) + '"><div class="sf-c1">' + (FAV[kindOfURL(x.h.url)] || "") + '<span class="sf-t">' + esc(x.h.title || x.h.url) + '</span></div><div class="sf-c2">' + esc(x.h.url) + "</div></div>"; }).join(""));
        }).join("");
        html = '<div class="sf-top"><div class="sf-title">历史记录</div><div class="sf-tools">' + (lastN ? '<button class="sf-btn" data-act="reopen-last">恢复上次的 ' + lastN + " 个标签页</button>" : "") +
          '<button class="sf-btn" data-act="clear-history"' + (hist.length ? "" : " disabled") + '>清除历史记录…</button><label class="sf-find"><i class="sf-mag"></i><input class="tw-search" type="search" placeholder="搜索" spellcheck="false" autocomplete="off"></label></div></div>' +
          '<div class="sf-table"><div class="sf-hd"><div class="sf-c1">网站</div><div class="sf-c2">地址</div></div><div class="sf-body">' + body + "</div></div>" +
          (order.length ? "" : '<div class="sf-empty">' + (q ? "未找到结果" : "暂无历史记录") + "</div>");
      }
      var had = host.querySelector(".tw-search"), focused = had && document.activeElement === had, sel = had ? [had.selectionStart, had.selectionEnd] : null;
      host.innerHTML = '<div class="tw-page' + (kind === "history" ? " sf" : "") + '" tabindex="-1">' + html + "</div>";
      if (kind === "history") { for (var be = host, bgc = ""; be && be.nodeType === 1 && !bgc; be = be.parentElement) { var c0 = getComputedStyle(be).backgroundColor; if (c0 && c0 !== "transparent" && !/^rgba\([^)]*,\s*0\)$/.test(c0)) bgc = c0; } if (bgc) host.style.setProperty("--sf-bg", bgc); } // 表头贴在上面时要不透明（和这页一样的底色）
      var inp = host.querySelector(".tw-search");
      if (inp) { inp.value = q; if (focused) { inp.focus({ preventScroll: true }); inp.setSelectionRange(sel[0], sel[1]); } }
    }
    function head(k, title, sub, btn) {
      return '<div class="tw-head">' + FAV[k] + '<div class="tw-h"><div class="tw-h1">' + esc(title) + '</div><div class="tw-h2">' + esc(sub) + "</div></div>" + (btn || "") + "</div>" +
        '<input class="tw-search" type="search" placeholder="搜索" spellcheck="false" autocomplete="off">';
    }
    host.addEventListener("input", function (e) { if (e.target.classList.contains("tw-search")) { q = e.target.value.trim().toLowerCase(); draw(); } });
    host.addEventListener("click", function (e) {
      var gp = e.target.closest(".sf-grp"), sr = e.target.closest(".sf-row");
      if (gp) { var dk = gp.dataset.day; HFOLD[dk] = gp.classList.contains("open"); draw(); return; } // 一天那一组：收起 / 展开（点过的记住）
      if (sr) { hSel = sr.dataset.key; host.querySelectorAll(".sf-row.sel").forEach(function (x) { x.classList.remove("sel"); }); sr.classList.add("sel"); host.querySelector(".tw-page").focus({ preventScroll: true }); return; } // 点一下选中（同 Safari）；双击打开
      var b = e.target.closest("[data-act]"), r = e.target.closest(".tw-row");
      if (b) {
        if (b.dataset.act === "new-cc") P.win.side.newCC(P.shell && P.shell.cwd ? P.shell.cwd() : home(), P);
        if (b.dataset.act === "new-agent") { if (caNew()) return; var ag = A.create({}); P.run(T().agentView(P, ag.id)); }
        if (b.dataset.act === "clear-history") clearHistory();
        if (b.dataset.act === "reopen-last" && window.TSU_TERM && TSU_TERM.reopenLast) TSU_TERM.reopenLast();
        return;
      }
      if (r) go(r.dataset.go, P);
    });
    host.addEventListener("dblclick", function (e) { var sr = e.target.closest(".sf-row"); if (sr) go(sr.dataset.go, P); });
    host.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && e.target.classList.contains("tw-search")) { e.preventDefault(); e.target.blur(); var pg0 = host.querySelector(".tw-page"); if (pg0) pg0.focus({ preventScroll: true }); return; } // Esc：离开搜索框
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName) && !(kind === "history" && e.key === " ")) { var si = host.querySelector(".tw-search"); if (si) si.focus({ preventScroll: true }); } // 直接打字：进搜索框接着打（同 Safari 的列表）
      if (e.key === "Enter" && e.target.classList.contains("tw-search")) { var first = host.querySelector(".sf-row.sel, .sf-row, .tw-row"); if (first) go(first.dataset.go, P); return; }
      if (kind !== "history" || e.target.classList.contains("tw-search")) return;
      var rows = Array.prototype.slice.call(host.querySelectorAll(".sf-row")), at = rows.findIndex(function (x) { return x.classList.contains("sel"); });
      if (e.key === "Enter" && at >= 0) { e.preventDefault(); go(rows[at].dataset.go, P); }
      else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && rows.length) { e.preventDefault(); var nx = rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))]; hSel = nx.dataset.key; rows.forEach(function (x) { x.classList.toggle("sel", x === nx); }); nx.scrollIntoView({ block: "nearest" }); }
      else if ((e.key === "Delete" || e.key === "Backspace") && at >= 0) { e.preventDefault(); var kk = rows[at].dataset.key; hist = hist.filter(function (h) { return h.t + " " + h.url !== kk; }); hSel = rows[at + 1] ? rows[at + 1].dataset.key : rows[at - 1] ? rows[at - 1].dataset.key : ""; saveHist(); draw(); } // 删掉这一条（同 Safari）
    });
  }
  var HFOLD = {}, hSel = ""; // 历史记录：收起的那几天、选中的那一条
  // 分组的名字：今天访问、昨天访问，再往前写日期
  // 一开始展开哪几天：今天、昨天，且不超过 30 条（大约一屏）；多了、更早的都收着，点开再看
  function hShut(k, n) { var d = new Date(k), t = new Date(); t.setHours(0, 0, 0, 0); var diff = Math.round((t - d) / 86400000); return diff > 1 || n > 30; }
  function dayGroup(k) { var d = new Date(k), t = new Date(); t.setHours(0, 0, 0, 0); var diff = Math.round((t - d) / 86400000); return diff === 0 ? "今天访问" : diff === 1 ? "昨天访问" : (d.getFullYear() !== t.getFullYear() ? d.getFullYear() + "年" : "") + (d.getMonth() + 1) + "月" + d.getDate() + "日 星期" + "日一二三四五六"[d.getDay()]; }
  function dayName(k) {
    var d = new Date(k), t = new Date(); t.setHours(0, 0, 0, 0);
    var diff = Math.round((t - d) / 86400000);
    return diff === 0 ? "今天" : diff === 1 ? "昨天" : (d.getMonth() + 1) + "月" + d.getDate() + "日 星期" + "日一二三四五六"[d.getDay()];
  }
  // 清除历史记录（同 Safari）：一个对话框，选清除的范围——过去一小时 / 今天 / 今天和昨天 / 所有历史记录；只动本机的记录，不影响 Agent 与会话
  var CLR_RANGES = [["hour", "过去一小时"], ["today", "今天"], ["today2", "今天和昨天"], ["all", "所有历史记录"]];
  function clearHistory() {
    if (document.querySelector(".sf-clrov")) return;
    var tr0 = function (x) { return window.TSU_I18N && TSU_I18N.t ? TSU_I18N.t(x) : x; };
    var last = localStorage.getItem("tsu-clear-range") || "hour", ov = document.createElement("div");
    ov.className = "sf-clrov";
    ov.innerHTML = '<div class="sf-clr" role="dialog" aria-modal="true"><div class="sf-clrt">' + esc(tr0("清除历史记录")) + '</div><div class="sf-clrm">' + esc(tr0("只清除这台 Mac 上记下的浏览和会话记录，不影响 Agent 与会话本身。")) + '</div>' +
      '<label class="sf-clrr"><span>' + esc(tr0("清除：")) + '</span><select>' + CLR_RANGES.map(function (r) { return '<option value="' + r[0] + '"' + (r[0] === last ? " selected" : "") + ">" + esc(tr0(r[1])) + "</option>"; }).join("") + "</select></label>" +
      '<div class="sf-clrb"><button type="button" data-clr="no">' + esc(tr0("取消")) + '</button><button type="button" class="def" data-clr="ok">' + esc(tr0("清除历史记录")) + "</button></div></div>";
    document.body.appendChild(ov);
    var sel = ov.querySelector("select"), back = document.activeElement;
    var done = function (ok) {
      document.removeEventListener("keydown", onKey, true);
      ov.parentNode.removeChild(ov);
      if (back && back.focus) try { back.focus({ preventScroll: true }); } catch (e) { /* 焦点回不去就算了 */ }
      if (!ok) return;
      var r = sel.value, d = new Date(); d.setHours(0, 0, 0, 0);
      var from = r === "hour" ? Date.now() - 3600000 : r === "today" ? d.getTime() : r === "today2" ? d.getTime() - 86400000 : 0;
      localStorage.setItem("tsu-clear-range", r);
      hist = r === "all" ? [] : hist.filter(function (h) { return h.t < from; });
      saveHist();
    };
    var onKey = function (e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(false); } else if (e.key === "Enter" && e.target !== sel) { e.preventDefault(); e.stopPropagation(); done(true); } };
    document.addEventListener("keydown", onKey, true);
    ov.addEventListener("click", function (e) { var b0 = e.target.closest("[data-clr]"); if (b0) done(b0.dataset.clr === "ok"); else if (e.target === ov) done(false); });
    ov.querySelector('[data-clr="ok"]').focus();
  }

  // ======== 工具栏：地址栏（中间）、新标签页 + 标签页概览（右边）========
  var OV_ICON = '<svg viewBox="0 0 20 20" width="17" height="17"><rect x="2.8" y="6.2" width="10.5" height="10.5" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6.7 3.3h7.4a2.6 2.6 0 0 1 2.6 2.6v7.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  var INSP_ICON = '<svg viewBox="0 0 20 20" width="17" height="17"><rect x="2.5" y="4" width="15" height="12" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12.5 4.4v11.2" stroke="currentColor" stroke-width="1.5"/></svg>';
  var PLUS_ICON = '<svg viewBox="0 0 20 20" width="16" height="16"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  function setup(tw) {
    if (tw.browser) return tw.browser;
    var bar = tw.el.querySelector(".bar"), B = tw.browser = {};
    tw.titleEl = null; // 标题不再在工具栏中间，在标签页上
    var t0 = bar.querySelector("#title, :scope > span");
    if (t0) t0.hidden = true;
    var box = document.createElement("div");
    box.className = "ts-addr";
    box.innerHTML = '<span class="ts-afav"></span><input type="text" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" placeholder="搜索或输入地址"><span class="ts-alabel"><span></span></span><div class="ts-sug" hidden></div>';
    var input = box.querySelector("input"), sugEl = box.querySelector(".ts-sug"), favEl = box.querySelector(".ts-afav"), labEl = box.querySelector(".ts-alabel"), labTxt = labEl.firstChild;
    var toggle = bar.querySelector("#toggle");
    bar.insertBefore(box, toggle || null);
    var nb = document.createElement("button"), ob = document.createElement("button"), ib = document.createElement("button");
    nb.className = "ts-tb"; nb.title = "新建标签页（⌘T）"; nb.innerHTML = PLUS_ICON;
    ob.className = "ts-tb"; ob.title = "显示标签页概览（⇧⌘\\）"; ob.innerHTML = OV_ICON;
    ib.className = "ts-tb"; ib.title = "切换辅助侧栏 (⌥⌘I)"; ib.innerHTML = INSP_ICON;
    bar.appendChild(nb);
    bar.appendChild(ob);
    bar.appendChild(ib);
    [box, nb, ob, ib].forEach(function (el) { el.addEventListener("pointerdown", function (e) { e.stopPropagation(); }); el.addEventListener("dblclick", function (e) { e.stopPropagation(); }); });
    nb.addEventListener("click", function () { (tw.ws.newTabUser || tw.ws.newTab)(); });
    ob.addEventListener("click", function () { overview(tw); });
    ib.addEventListener("click", function () { if (window.STUDIO) STUDIO.toggle(tw); });
    // 地址栏：平时显示当前标签页的地址（居中）；点进去全选、左对齐，边敲边给建议；回车走过去，Esc 放弃
    var editing = false, sug = [], sel = 0, fullURL = "";
    var full = function () { return !!(window.STUDIO && STUDIO.get && STUDIO.get("fullAddress")); };
    B.show = function (addr) {
      favEl.innerHTML = FAV[addr.kind] || "";
      fullURL = addr.url;
      if (!editing) { input.value = addr.url; labTxt.textContent = full() ? addr.url : siteOf(addr.url); }
      box.classList.toggle("empty", !addr.url);
    };
    B.focus = function () { input.focus(); input.select(); };
    // 字从中间滑到左边（量出居中时字的位置，平移到输入框的左边距）；滑完再显示完整地址、全选
    var slide = function (toLeft, done) {
      var ir = input.getBoundingClientRect(), tr = labTxt.getBoundingClientRect(), padL = parseFloat(getComputedStyle(input).paddingLeft) || 8;
      var dx = ir.left + padL - (tr.left - (parseFloat(labTxt.style.transform.replace(/[^\d.-]/g, "")) || 0));
      labTxt.style.transition = "transform 0.18s ease";
      labTxt.style.transform = toLeft ? "translateX(" + dx + "px)" : "translateX(0)";
      clearTimeout(slide.t);
      slide.t = setTimeout(done || function () {}, 190);
    };
    input.addEventListener("focus", function () {
      editing = true;
      box.classList.add("sliding");
      slide(true, function () { if (!editing) return; box.classList.remove("sliding"); box.classList.add("editing"); input.value = fullURL; input.select(); });
    });
    input.addEventListener("blur", function () { setTimeout(function () {
      editing = false; box.classList.remove("editing"); sugEl.hidden = true;
      box.classList.add("sliding"); labTxt.style.transition = "none"; slide(true); void labTxt.offsetWidth; // 先站在左边
      requestAnimationFrame(function () { slide(false, function () { box.classList.remove("sliding"); }); });
      syncAll();
    }, 120); });
    input.addEventListener("input", function () { sug = suggest(input.value); sel = 0; paintSug(); });
    input.addEventListener("keydown", function (e) {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { if (!sug.length) return; e.preventDefault(); sel = (sel + (e.key === "ArrowDown" ? 1 : sug.length - 1)) % sug.length; paintSug(); return; }
      if (e.key === "Escape") { e.preventDefault(); input.blur(); if (tw.ws.active) tw.ws.active.focus(); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        var v = input.value, pick = !sugEl.hidden && sug[sel] && (sel > 0 || !/^(claude|paimon)\.code|^(local\.)?(claude|paimon):|^[~\/]|^https?:/i.test(v.trim())) ? sug[sel] : null;
        var P = tw.ws.active;
        input.blur();
        go(pick ? pick.url || pick.go : v, P);
      }
    });
    function paintSug() {
      if (!sug.length) { sugEl.hidden = true; return; }
      sugEl.innerHTML = sug.map(function (o, i) { return '<div class="ts-srow' + (i === sel ? " on" : "") + '" data-i="' + i + '">' + (FAV[o.kind] || "") + '<span class="ts-st">' + esc(o.title) + '</span><span class="ts-su">' + esc(o.url || "") + "</span></div>"; }).join("");
      sugEl.hidden = false;
    }
    sugEl.addEventListener("mousedown", function (e) { var r = e.target.closest(".ts-srow"); if (!r) return; e.preventDefault(); var o = sug[+r.dataset.i], P = tw.ws.active; input.blur(); go(o.url || o.go, P); });
    return B;
  }

  // ======== 标签页概览（同 Safari：一格一个标签页，点一下切过去；⇧⌘\ 或 Esc 收起）========
  function overview(tw, on) {
    if (on === undefined && window.TSU_MACOS && TSU_MACOS.on() && TSU_MACOS.mission) return TSU_MACOS.mission(); // macOS 风格：是窗口不是标签页——调度中心
    var main = tw.el.querySelector(".tmain") || tw.panesEl.parentNode, ov = main.querySelector(".ts-overview");
    if (on === undefined) on = !ov;
    if (!on) { if (ov) { ov.classList.add("out"); setTimeout(function () { ov.remove(); }, 180); if (tw.ws.active) tw.ws.active.focus(); } return; }
    if (ov) return;
    ov = document.createElement("div");
    ov.className = "ts-overview";
    ov.innerHTML = '<div class="ov-top"><input class="ov-q" type="search" placeholder="搜索标签页" spellcheck="false"></div><div class="ov-grid"></div>';
    main.appendChild(ov);
    var grid = ov.querySelector(".ov-grid"), qi = ov.querySelector(".ov-q"), sel = tw.ws.cur;
    function preview(P) {
      var prog = P.program, lines = [];
      if (prog && prog.pty && prog.xterm && prog.xterm()) {
        var x = prog.xterm(), b = x.buffer.active;
        for (var i = b.viewportY; i < b.viewportY + x.rows && i < b.length; i++) { var l = b.getLine(i); lines.push(l ? l.translateToString(true) : ""); }
      } else if (prog && prog.pty) lines = (P.shell.spec().sh.back || []).slice(-40); // 还没显示过的标签页：刷新前留下的字
      else if (prog && prog.page) lines = [prog.title()];
      else lines = String(P.term ? P.term.innerText : "").split("\n").slice(-40);
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      return lines.slice(-40).join("\n");
    }
    function paint() {
      var q = qi.value.trim().toLowerCase(), html = "";
      tw.ws.tabs.forEach(function (t, i) {
        var P = t.active || tw.ws.leaves(t.root)[0].pane, a = addressOf(P);
        if (q && (P.title() + " " + a.url).toLowerCase().indexOf(q) < 0) return;
        html += '<div class="ov-card' + (i === sel ? " on" : "") + (P.el.classList.contains("tl") ? " light" : "") + '" data-i="' + i + '"><div class="ov-shot"><pre>' + esc(preview(P)) + '</pre></div><div class="ov-cap"><i class="ov-x" title="关闭标签页">×</i>' + (FAV[a.kind] || "") + '<span>' + esc(P.title()) + "</span></div></div>";
      });
      grid.innerHTML = html || '<div class="ov-none">未找到结果</div>';
    }
    paint();
    requestAnimationFrame(function () { ov.classList.add("in"); });
    qi.addEventListener("input", paint);
    grid.addEventListener("click", function (e) {
      var c = e.target.closest(".ov-card");
      if (!c) return;
      var i = +c.dataset.i;
      if (e.target.closest(".ov-x")) {
        var t = tw.ws.tabs[i], panes = tw.ws.leaves(t.root).map(function (l) { return l.pane; });
        T().askClose(panes, "标签页", function () { var j = tw.ws.tabs.indexOf(t); if (j >= 0) tw.ws.closeTab(j); paint(); });
        return;
      }
      tw.ws.select(i);
      overview(tw, false);
    });
    ov.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); overview(tw, false); }
      if (e.key === "Enter") { var first = grid.querySelector(".ov-card.on") || grid.querySelector(".ov-card"); if (first) { tw.ws.select(+first.dataset.i); overview(tw, false); } }
      if (/^Arrow(Left|Right)$/.test(e.key) && document.activeElement !== qi) { e.preventDefault(); sel = Math.max(0, Math.min(tw.ws.tabs.length - 1, sel + (e.key === "ArrowRight" ? 1 : -1))); paint(); }
    });
    ov.tabIndex = -1;
    qi.focus();
  }

  // ======== 同步：地址栏、标签页上的小图标、历史记录、窗口标题、macOS 菜单 ========
  function sync(tw) {
    var B = setup(tw), P = tw.ws.active, addr = addressOf(P);
    B.show(addr);
    if (window.STUDIO) STUDIO.renderSoon(tw); // 底栏、右侧栏跟着当前标签页
    tw.ws.tabs.forEach(function (t) { var p = t.active || tw.ws.leaves(t.root)[0].pane; record(t, p === P ? addr : addressOf(p)); });
    if (N && P && tw === T().front()) {
      var t = P.title();
      if (t !== lastTitle) { lastTitle = t; if (can("window.title")) N.call("window.title", { title: t }).catch(function () {}); }
    }
  }
  var lastTitle = "";
  function syncAll() { var tt = T(); if (!tt) return; tt.wins().forEach(function (w) { if (w.open && w.ws.active) w.ws.syncTitles(); }); }
  // 标签页前面的小图标（同 VS Code：按类型；文件按扩展名）
  var EXT_ICON = { md: ["md", "↓"], markdown: ["md", "↓"], js: ["js", "JS"], mjs: ["js", "JS"], cjs: ["js", "JS"], ts: ["ts", "TS"], tsx: ["ts", "TS"], jsx: ["js", "JS"], json: ["js", "{}"], py: ["py", "PY"], sh: ["sh", "$"], zsh: ["sh", "$"], swift: ["cc", "SW"],
    css: ["ts", "#"], html: ["cc", "<>"], yml: ["cfg", "⚙"], yaml: ["cfg", "⚙"], toml: ["cfg", "⚙"], txt: ["cfg", "≡"], log: ["cfg", "≡"], png: ["py", "▣"], jpg: ["py", "▣"], jpeg: ["py", "▣"], gif: ["py", "▣"], svg: ["py", "▣"], pdf: ["cc", "▤"] };
  var PAGE_ICON = { settings: "<i class=\"st-ico st-i-svg\"><svg viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6\"/><circle cx=\"10\" cy=\"4.5\" r=\"1.5\"/><circle cx=\"6\" cy=\"11.5\" r=\"1.5\"/></svg></i>", keys: "<i class=\"st-ico st-i-svg\"><svg viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"1.5\" y=\"4\" width=\"13\" height=\"8.4\" rx=\"1.6\"/><path d=\"M4 6.7h.3M6.3 6.7h.3M8.6 6.7h.3M10.9 6.7h.3M4.8 9.6h6.4\"/></svg></i>", history: "<i class=\"st-ico st-i-svg\"><svg viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M2.6 8a5.4 5.4 0 1 0 1.6-3.8M2.4 2.8v2.6H5\"/><path d=\"M8 5.2V8l2 1.2\"/></svg></i>", dash: "<i class=\"st-ico st-i-svg\"><svg viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"2\" y=\"2\" width=\"5\" height=\"6\" rx=\"1\"/><rect x=\"9\" y=\"2\" width=\"5\" height=\"3.5\" rx=\"1\"/><rect x=\"9\" y=\"7.5\" width=\"5\" height=\"6.5\" rx=\"1\"/><rect x=\"2\" y=\"10\" width=\"5\" height=\"4\" rx=\"1\"/></svg></i>", explorer: "<i class=\"st-ico st-i-svg\"><svg viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M1.8 4.2c0-.6.4-1 1-1h3.1l1.4 1.5h5.9c.6 0 1 .4 1 1v6.6c0 .6-.4 1-1 1H2.8c-.6 0-1-.4-1-1z\"/><path d=\"M1.8 6.6h12.4\"/></svg></i>", web: "<i class=\"st-ico st-i-svg\"><svg viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"8\" cy=\"8\" r=\"6\"/><path d=\"M2 8h12M8 2c1.8 1.8 2.6 3.8 2.6 6s-.8 4.2-2.6 6M8 2C6.2 3.8 5.4 5.8 5.4 8s.8 4.2 2.6 6\"/></svg></i>", extension: "<i class=\"st-ico st-i-svg\"><svg viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"2\" y=\"6.5\" width=\"4\" height=\"4\" rx=\".5\"/><rect x=\"2\" y=\"10.5\" width=\"4\" height=\"4\" rx=\".5\"/><rect x=\"6\" y=\"10.5\" width=\"4\" height=\"4\" rx=\".5\"/><rect x=\"9\" y=\"2\" width=\"4.6\" height=\"4.6\" rx=\".5\"/></svg></i>" };
  function icon(a) {
    var pg = a.page && window.STUDIO && STUDIO.pages && STUDIO.pages[a.page];
    if (pg && pg.icon) { var ic = pg.icon(a.arg); if (ic) return /^<i /.test(ic) ? ic : '<i class="st-ico st-i-svg">' + ic + "</i>"; } // 页面自己给的图标
    if (a.page && PAGE_ICON[a.page]) return PAGE_ICON[a.page];
    if (PAGE_ICON[a.kind]) return PAGE_ICON[a.kind];
    if (a.kind === "file") { if (window.TSU_FICON) return TSU_FICON(a.path); var e = String(a.path || "").split(".").pop().toLowerCase(), x = EXT_ICON[e] || ["cfg", "≡"]; return '<i class="st-ico st-i-' + x[0] + '">' + x[1] + "</i>"; } // 文件：同「文件」视图的图标（ficons.js）
    return { claude: '<i class="st-ico st-i-cc">' + CLG() + '</i>', codex: '<i class="st-ico st-i-cx">' + CXL() + '</i>', pi: '<i class="st-ico st-i-cx st-i-pi">' + PIL() + '</i>', paimon: '<i class="st-ico st-i-pm">' + PMAV() + '</i>', shell: '<i class="st-ico st-i-svg st-i-sh"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.8"/><path d="M4.6 6.2l2 1.8-2 1.8M8.4 10.1h3"/></svg></i>', history: '<i class="st-ico st-i-cfg">◷</i>' }[a.kind] || '<i class="st-ico st-i-sh">›_</i>';
  }
  function fav(tabEl, P) {
    var span = tabEl.querySelector("span");
    if (!span) return;
    if (root.classList.contains("termapp")) {
      span.insertAdjacentHTML("beforebegin", icon(addressOf(P)));
      // agent 在跑：图标还是它自己的（Claude Code 的就是 Claude 的 logo），只是跳动起来（一下一下地放大、回落）；名字后面不挂 ✳，也不换成字符转圈。
      //   几个一起跑：各自的节奏、相位按会话算（不齐刷刷一起跳）
      var nyou = false; try { nyou = !!(P && P.program && P.program.needsYou && P.program.needsYou()); } catch (e) { nyou = false; }
      tabEl.classList.toggle("needs", nyou); // 在等你回答 / 确认：图标变蓝（studio.css .tab.needs）
      if (P && P.program && P.program.working && P.program.working()) {
        tabEl.classList.add("busy");
        if (P._sph == null) { var h = 0, id = String((P.program && P.program.agentId) || Math.random()); for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; P._sph = h; }
        // （不跳了：在跑 / 闲着只看颜色，见 studio.css .tab.busy）
      }
      return;
    }
    var k = addressOf(P).kind;
    if (FAV[k]) span.insertAdjacentHTML("afterbegin", FAV[k] + " ");
  }
  // 标签页上的转圈：一个计时器管所有在跑的标签页（120ms 一帧，只换一个字）；没有在跑的就停，窗口在后台不动
  var TSPIN = ["·", "✢", "✳\uFE0E", "✶", "✻", "✽", "✽", "✻", "✶", "✳\uFE0E", "✢", "·"], tspinT = 0, tspinF = 0; // ✳ 后面带 U+FE0E（文字样式）：iPad、iPhone 上不带的话它画成绿底的 emoji ✳️
  function tabSpin() {
    if (tspinT) return;
    tspinT = setInterval(function () {
      var els = document.querySelectorAll(".tab.busy > .st-tspin");
      if (!els.length) { clearInterval(tspinT); tspinT = 0; return; }
      if (document.hidden) return;
      tspinF++;
      for (var i = 0; i < els.length; i++) els[i].textContent = TSPIN[(tspinF + (+els[i].dataset.ph || 0)) % TSPIN.length];
    }, 120);
  }

  // ---- macOS 菜单栏（原生 App 支持 menu.set 时）：文件 / 显示 / 历史记录 / 帮助 ----
  var cmds = [];
  if (N) N.call("info").then(function (i) { cmds = (i && i.commands) || []; menusSoon(); }).catch(function () {});
  var can = function (c) { return cmds.indexOf(c) >= 0; };
  var menuT = 0;
  function menusSoon() { clearTimeout(menuT); menuT = setTimeout(menus, 300); }
  var ACTIONS = {};
  function menus() {
    if (!N || !can("menu.set")) return;
    var acts = {}, n = 0, it = function (title, run, key, mods, o2) { var id = "m" + (++n); acts[id] = run; var o = { id: id, title: title }; if (key) { o.key = key; o.mods = mods || "cmd"; } return Object.assign(o, o2 || {}); };
    var tw = T() && T().front(), sep = { sep: true }, S = window.STUDIO, get = function (k) { return S && S.get ? S.get(k, true) : undefined; };
    var font = +(localStorage.getItem("tsu-font") || 12);
    var chk = function (title, on, run, key, mods) { return it(title, function () { run(); menusSoon(); }, key, mods, { checked: !!on }); };
    // 「历史记录」菜单（同 Safari）：返回 / 前进；最近关闭、重新打开上次关闭的标签页；今天去过的（带图标）；更早的按天一个子菜单；显示全部、清除
    var hIco = function (url) {
      var k = kindOfURL(url), Lg = window.TSU_LOGOS || {};
      if (k === "claude" && Lg.claudePath) return { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 101"><path fill="#d97757" d="' + Lg.claudePath + '"/></svg>', svgColor: true };
      var cd = k === "codex" && Lg.codex ? /d="([^"]+)"/.exec(Lg.codex) : null;
      if (cd) return { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#000" d="' + cd[1] + '"/></svg>' };
      return { symbol: k === "web" ? "globe" : k === "shell" ? "terminal" : k === "paimon" ? "sparkles" : "clock" };
    };
    var hItem = function (h) { var t = h.title || h.url; return it(t.length > 60 ? t.slice(0, 60) + "…" : t, function () { go(h.url, null); }, null, null, hIco(h.url)); };
    var hOk = function (h) { return ccOn() || kindOfURL(h.url) !== "claude"; };
    var dayKey = function (t) { return new Date(t).toDateString(); }, todayK = dayKey(Date.now());
    var histItems = recent(60).filter(function (h) { return hOk(h) && dayKey(h.t) === todayK; }).slice(0, 15).map(hItem);
    var earlier = (function () {
      var byDay = {}, order = [], seen = {};
      for (var hi = hist.length - 1; hi >= 0 && order.length <= 7; hi--) {
        var h0 = hist[hi], k0 = dayKey(h0.t);
        if (k0 === todayK || !hOk(h0) || seen[k0 + " " + h0.url]) continue;
        seen[k0 + " " + h0.url] = 1;
        if (!byDay[k0]) { byDay[k0] = []; order.push(k0); }
        if (byDay[k0].length < 30) byDay[k0].push(h0);
      }
      return order.slice(0, 7).map(function (k0) { return { title: dayGroup(k0), items: byDay[k0].map(hItem) }; });
    })();
    var P0h = tw && tw.ws.active, pgh = P0h && P0h.program, isWeb = !!(pgh && pgh.page === "web" && window.TSU_WEB && TSU_WEB.nav);
    var closedL = window.TSU_TERM && TSU_TERM.closedTabs ? TSU_TERM.closedTabs() : [];
    var clean = function (l) { return l.filter(Boolean); };
    // 「显示」同 VS Code 的 View：命令面板；外观、编辑器布局；各个视图（Agent、搜索、扩展、对话）；面板里的（终端、后台任务、子 Agent）
    var osItems = function () { return S && S.osModes ? S.osModes.map(function (x, i) { return chk(x[1], (get("os") || "vscode") === x[0], function () { S.setv("os", x[0]); }, String(x[2] || i + 1), "cmd,ctrl"); }) : []; }; // macOS、Pure Terminal 要打开开发者功能才列出来（x[2] 是它的 ⌃⌘ 几）
    var uiItems = function () { var forced = S && S.get && S.get("os") && { claude: "gui", terminal: "tui" }[S.get("os")]; return S && S.uiModes ? S.uiModes.map(function (x) { var off = !!forced && forced !== x[0]; return it(x[1] + (off ? "（在此应用风格下不可用）" : ""), function () { if (!off) S.setv("ui", x[0]); menusSoon(); }, null, null, { checked: (S.get("ui")) === x[0], enabled: !off }); }) : []; }; // 应用风格定死了的：另一个灰着、写明不可用
    var view = clean([
      it("重新载入", function () { location.reload(); }, "r"), // ⌘R：这是 App 不是浏览器，自己带一个（新版本上线后点这里、或按 ⌘R）
      sep,
      S ? { title: "应用风格", items: osItems() } : null,
      S ? { title: "Agent 显示风格", items: uiItems() } : null,
      S ? sep : null,
      it("命令面板…", function () { if (S && tw) S.palette(tw, "cmd"); }, "p", "cmd,shift"),
      it("快速打开…", function () { if (S && tw) S.palette(tw, "open"); }, "p"),
      sep,
      { title: "外观", items: clean([
        chk("主侧栏", tw && tw.side && tw.side.shown(), function () { if (tw && tw.side) tw.side.toggle(); }, "b"),
        S ? chk("辅助侧栏", S.isOpen(), function () { if (tw) S.toggle(tw); }, "i", "cmd,alt") : null,
        S ? chk("面板", S.panelOpen && S.panelOpen(), function () { if (tw) S.togglePanel(tw); }, "j") : null,
        S ? chk("状态栏", get("statusBar"), function () { S.setv("statusBar", !get("statusBar")); }) : null,
        S ? chk("活动栏", get("activityBar"), function () { S.setv("activityBar", !get("activityBar")); }) : null,
        S ? chk("路径导航", get("breadcrumbs"), function () { S.setv("breadcrumbs", !get("breadcrumbs")); }) : null,
        S && S.miniModes ? { title: "缩略图", items: S.miniModes.map(function (x) { return chk(x[1], get("minimap") === x[0], function () { S.setv("minimap", x[0]); }); }) } : null,
        sep,
        it("放大", function () { TSU_APP.setFont(Math.min(24, font + 1)); menusSoon(); }, "+"),
        it("缩小", function () { TSU_APP.setFont(Math.max(10, font - 1)); menusSoon(); }, "-"),
        it("实际大小", function () { TSU_APP.setFont(12); menusSoon(); }, "0"),
        S ? sep : null,
        S ? it("配色方案…", function () { if (tw) S.pickScheme(tw); }) : null,
        S ? it("高亮配色…", function () { if (tw) S.pickHighlight(tw); }) : null,
      ]) },
      { title: "编辑器布局", items: [
        it("向右拆分", function () { if (tw) tw.ws.split("row"); }, "d"),
        it("向下拆分", function () { if (tw) tw.ws.split("col"); }, "d", "cmd,shift"),
        sep,
        it("标签页概览", function () { if (tw) overview(tw); }, "\\", "cmd,shift"),
      ] },
      sep,
      S ? it("Agents", function () { if (tw) S.showView(tw, "agents"); }, "e", "cmd,shift") : null,
      S ? it("搜索", function () { if (tw) S.showView(tw, "search"); }, "f", "cmd,shift") : null,
      S ? it("连接器", function () { if (tw) S.showView(tw, "extensions"); }, "x", "cmd,shift") : null, // 活动栏上原来「扩展」那一格
      S ? sep : null,
      S && ccOn() ? it("Claude Code 会话", function () { go("local.claude:", null); }) : null,
      S ? it("Agent Finder", function () { go("agents.local.paimon", null); }) : null,
      S ? it("File Finder", function () { go("finder.local.paimon", null); }) : null,
      S && S.panelView ? sep : null,
      S && S.panelView ? it("终端", function () { if (tw) S.panelView(tw, "term"); }, "`", "ctrl") : null,
      // 全局的「Agent 活动」（按 agent 分组）；Claude App 里是右边「后台任务」那张卡片（当前会话的）。每个 agent 自己的在它标签页底下
      S && S.panelView ? it(document.documentElement.classList.contains("st-os-claude") ? "后台任务" : "Agent 活动", function () { if (tw) S.panelView(tw, "activity"); }) : null,
    ]);
    var spec = [
      { title: "", place: "app", items: clean([it("设置…", function () { if (S) S.settings(tw); }, ","), S ? { title: "应用风格", items: osItems() } : null, S ? { title: "Agent 显示风格", items: uiItems() } : null]) },
      { title: "文件", place: "file", items: clean([
        it(isCa() || ccOn() || (window.TSU_CONNECTORS && TSU_CONNECTORS.on("codex")) ? "新建会话" : "新建标签页", function () { if (caNew()) return; if (tw) (tw.ws.newTabUser || tw.ws.newTab)(); }, "t"),
        isCa() || !(window.TSU_CONNECTORS && TSU_CONNECTORS.on("paimon")) ? null : it("新建 Paimon Code Agent", function () { if (tw) { var ag = A.create({}); tw.side.open(ag.id, "tab"); } }),
        ccOn() ? it("新建 Claude Code 会话", function () { if (tw) tw.side.newCC(); }) : null,
        it("打开位置…", function () { if (tw && tw.browser) tw.browser.focus(); }, "l"),
        sep,
        it("关闭标签页", function () { T().action("closePane"); }, "w"),
      ]) },
      { title: "显示", items: view },
      { title: "历史记录", items: [
        it("返回", function () { if (isWeb) TSU_WEB.nav(pgh, "back"); }, null, null, { enabled: isWeb }),
        it("前进", function () { if (isWeb) TSU_WEB.nav(pgh, "forward"); }, null, null, { enabled: isWeb }),
        sep,
        closedL.length ? { title: "最近关闭", items: closedL.slice(0, 15).map(function (x, ci) { var t = x.title || x.url || "标签页"; return it(t.length > 60 ? t.slice(0, 60) + "…" : t, function () { TSU_TERM.reopenClosed(ci); }, null, null, hIco(x.url || "")); }) } : it("最近关闭", function () {}, null, null, { enabled: false }),
        it("重新打开上次关闭的标签页", function () { if (window.TSU_TERM && TSU_TERM.reopenClosed) TSU_TERM.reopenClosed(0); }, "t", "cmd,shift", { enabled: closedL.length > 0 }),
        (window.TSU_TERM && TSU_TERM.lastTabs && TSU_TERM.lastTabs().length) ? it("恢复上次的 " + TSU_TERM.lastTabs().length + " 个标签页", function () { TSU_TERM.reopenLast(); }) : null,
        sep,
      ].filter(Boolean).concat(histItems.length ? histItems.concat([sep]) : [], earlier.length ? earlier.concat([sep]) : [], [
        it("显示全部历史记录", function () { openPage("history", tw && tw.ws.active, {}); }, "y"),
        it("清除历史记录…", clearHistory),
      ]) },
      { title: "帮助", place: "help", items: [
        it("欢迎", function () { if (window.TSU_WELCOME) TSU_WELCOME.open(tw); }),
        it("Vibing Studio 使用手册", function () { if (window.TSU_GUIDE) TSU_GUIDE.open(tw); else if (window.TSU_APP && TSU_APP.help) TSU_APP.help(); }),
        S && S.showPage ? it("键盘快捷方式", function () { if (tw) S.showPage(tw, "keys", null); }) : null,
        it("更新内容", function () { if (window.TSU_CHANGELOG) TSU_CHANGELOG.open(tw); }),
      ].filter(Boolean) },
    ];
    // Pure Terminal：菜单同 iTerm（Shell / 显示 / 会话 / 窗口 / 帮助），没有 VS Code 的那些
    if (S && get("os") === "terminal") {
      var P0 = tw && tw.ws.active, prog0 = P0 && P0.program;
      var allInTab = function () { return tw ? tw.ws.groups().map(function (g) { return g.active; }).filter(Boolean) : []; };
      spec = [
        spec[0],
        { title: "Shell", place: "file", items: clean([
          it("新建标签页", function () { if (tw) (tw.ws.newTabUser || tw.ws.newTab)(); }, "t"),
          it("复制标签页", function () { if (tw && P0 && P0.spec) tw.ws.newTab(prog0 && prog0.pty ? null : P0.spec()); }),
          sep,
          it("水平拆分", function () { if (tw) tw.ws.split("col"); }, "d", "cmd,shift"),
          it("垂直拆分", function () { if (tw) tw.ws.split("row"); }, "d"),
          sep,
          it("保存内容…", function () { if (prog0 && prog0.exportText) { var t = prog0.exportText(), a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([t], { type: "text/plain" })); a.download = (P0.title() || "terminal") + ".txt"; a.click(); } }, null, null, { enabled: !!(prog0 && prog0.exportText) }),
          sep,
          it("关闭", function () { T().action("closePane"); }, "w"),
          it("关闭标签页中的所有面板", function () { var ps = allInTab(); ps.forEach(function (x) { tw.ws.closePane(x); }); }, "w", "cmd,alt"),
        ]) },
        { title: "显示", items: clean([
          { title: "应用风格", items: osItems() },
          { title: "Agent 显示风格", items: uiItems() },
          sep,
          it("放大", function () { TSU_APP.setFont(Math.min(24, font + 1)); menusSoon(); }, "+"),
          it("缩小", function () { TSU_APP.setFont(Math.max(10, font - 1)); menusSoon(); }, "-"),
          it("实际大小", function () { TSU_APP.setFont(12); menusSoon(); }, "0"),
          sep,
          it("配色方案…", function () { if (tw) S.pickScheme(tw); }),
          it("命令面板…", function () { if (tw) S.palette(tw, "cmd"); }, "p", "cmd,shift"),
        ]) },
        { title: "会话", items: clean([
          it("清除缓冲区", function () { if (prog0 && prog0.clearScrollback) prog0.clearScrollback(); }, "k", null, { enabled: !!(prog0 && prog0.clearScrollback) }),
          sep,
          it("上一个标签页", function () { if (tw) tw.ws.cycle(-1); }, "[", "cmd,shift"),
          it("下一个标签页", function () { if (tw) tw.ws.cycle(1); }, "]", "cmd,shift"),
          sep,
          it("新建 Paimon Code Agent", function () { if (tw) { var ag = A.create({}); tw.ws.newTab({ agent: ag.id }); } }),
          ccOn() ? it("新建 Claude Code 会话", function () { if (tw) tw.side.newCC(); }) : null,
        ]) },
        spec[spec.length - 1],
      ];
    }
    // 勾选的状态（侧栏开没开……）在别处变了也要跟上：同一份就不重发
    var sig = JSON.stringify(spec);
    ACTIONS = acts;
    if (sig === lastMenus) return;
    lastMenus = sig;
    N.call("menu.set", { menus: spec, native: NATIVE_TITLES }).catch(function () {});
  }
  var lastMenus = "";
  var NATIVE_TITLES = { "#edit": "编辑", "#window": "窗口", "#services": "服务", "orderFrontStandardAboutPanel:": "关于 Vibing Studio", "showAbout:": "关于 Vibing Studio", "hide:": "隐藏 Vibing Studio", "hideOtherApplications:": "隐藏其他", "unhideAllApplications:": "全部显示", "terminate:": "退出 Vibing Studio",
    "undo:": "撤销", "redo:": "重做", "cut:": "剪切", "copy:": "拷贝", "paste:": "粘贴", "selectAll:": "全选",
    "newWindowAction:": "新建窗口", "performMiniaturize:": "最小化", "performZoom:": "缩放", "toggleFullScreen:": "进入全屏幕", "reloadPage:": "重新载入页面", "arrangeInFront:": "前置全部窗口" };
  if (window.TSU_I18N && TSU_I18N.add) TSU_I18N.add({ "编辑": "Edit", "服务": "Services", "关于 Vibing Studio": "About Vibing Studio", "隐藏 Vibing Studio": "Hide Vibing Studio", "隐藏其他": "Hide Others", "全部显示": "Show All", "退出 Vibing Studio": "Quit Vibing Studio",
    "撤销": "Undo", "重做": "Redo", "剪切": "Cut", "拷贝": "Copy", "粘贴": "Paste", "全选": "Select All", "新建窗口": "New Window", "最小化": "Minimize", "缩放": "Zoom", "进入全屏幕": "Enter Full Screen", "重新载入页面": "Reload Page", "前置全部窗口": "Bring All to Front",
    "Claude Code 会话": "Claude Code Sessions", "新建会话": "New Session", "键盘快捷方式": "Keyboard Shortcuts" });
  setInterval(function () { if (!document.hidden) menus(); }, 1500);
  if (N) N.on("menu.action", function (d) { var f = d && ACTIONS[d.id]; if (f) try { f(); } catch (e) { console.error(e); } });

  // ---- 快捷键（App 里；浏览器里这几个是浏览器自己的）：⌘L 地址栏、⇧⌘\ 标签页概览、⌘Y 历史记录 ----
  if (N) window.addEventListener("keydown", function (e) {
    if (!e.metaKey || e.ctrlKey) return;
    var tw = T() && T().front();
    if (!tw) return;
    var hit = function (f) { e.preventDefault(); e.stopPropagation(); f(); };
    if (!e.shiftKey && !e.altKey && e.code === "KeyL") return hit(function () { setup(tw).focus(); });
    if (e.shiftKey && !e.altKey && e.code === "Backslash") return hit(function () { overview(tw); });
    if (!e.shiftKey && !e.altKey && e.code === "KeyY") return hit(function () { openPage("history", tw.ws.active, {}); });
  }, true);

  window.TSU_BROWSER = {
    page: function (P, kind, arg) { if (kind === "dash") kind = "history"; return window.STUDIO && STUDIO.pages[kind] && kind !== "dash" ? STUDIO.page(P, kind, arg) : new PageView(P, kind); }, // 仪表盘没有了：以前存着的仪表盘标签页打开是空白页（历史记录）
    suggest: suggest, recent: recent,
    sync: sync, fav: fav, go: go, address: addressOf, history: function () { return hist.slice(); }, overview: overview,
    wantsCC: function () { var tt = T(); return ccOn() && !!tt && tt.panes().some(function (p) { return p.program && p.program.page === "claude"; }) || !!document.querySelector(".ts-addr.editing"); },
  };
})();
