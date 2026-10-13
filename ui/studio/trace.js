// trace.js —— 「Agent 活动」：默认是一张同 macOS 活动监视器的表（每个打开着的会话一行：在跑 / 等你 / 闲着、在做什么、这一问跑了多久、
//   它和它开出来的进程占的 CPU、内存、进程数、上下文用了多少），底下一条「CPU 负载」的小图；窄的时候（放进右侧栏）一行一个会话。
//   另一个样子是「时间线」（下面原来那一套）。数据也给 Paimon：TSU_TRACE.snapshot()（全局助手的 AgentActivity 工具读它）。
// 以前的说明（时间线）：
//   横轴是时间（最近 10 分钟 / 1 小时 / 6 小时 / 24 小时，右边是现在），每个打开着的会话一组：
//   · 淡底色的一段 = 一问（从你说那句到它答完）；
//   · 上面一格格的条 = 每次工具调用，长短就是用了多久，颜色按种类（命令、读 / 搜、改文件、子 Agent、网页、MCP）；并发的几个叠成几行；
//   · 下面细的一条 = 后台命令、子 Agent 从起到停的那段；
//   · ▼ = 你的一句话；◆ = 上下文压缩；红框 = 出错的调用。
//   左边写着这段时间里它忙了多少、调了多少次工具、最长的一次是什么——时间花在了哪、哪里卡住、哪些是并行跑的，一眼看出来。
//   指着看详情，点一组切到那个会话。数据都是已经读进来的记录（claude.js / codex.js / agents.js 的 turns、tasks），不另外读文件
(function () {
  "use strict";
  var SPANS = [[10, "10m"], [60, "1h"], [360, "6h"], [1440, "24h"]];
  var LBL = 204, ROW = 15, LGAP = 2, PAD = 8, BGH = 12, AXIS = 18;
  // 颜色收着用：同一套灰蓝里分深浅，只靠明暗区分种类（不再红绿蓝紫粉一屏花花绿绿）
  var KIND = {
    bash: { c: "#7f8ea3", n: "命令" }, read: { c: "#5f7a99", n: "读取与搜索" }, edit: { c: "#a39477", n: "文件修改" },
    agent: { c: "#8a83a6", n: "子 Agent" }, web: { c: "#6f9399", n: "网络" }, mcp: { c: "#97808e", n: "MCP" }, other: { c: "#6b6f76", n: "其他" },
  };
  var tr = function (s) { return window.TSU_I18N && TSU_I18N.t ? TSU_I18N.t(s) : s; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  // 只改变了的地方（整块重写会让悬停、底色一闪一闪）：新的 HTML 和现在的一个个节点对着比，不一样的才动
  var TPL = document.createElement("template");
  function morphKids(a, b) {
    var ac = a.childNodes, bc = b.childNodes, i;
    for (i = 0; i < bc.length; i++) { if (i < ac.length) morph(ac[i], bc[i]); else a.appendChild(bc[i].cloneNode(true)); }
    while (ac.length > bc.length) a.removeChild(a.lastChild);
  }
  function morph(a, b) {
    if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) { a.parentNode.replaceChild(b.cloneNode(true), a); return; }
    if (a.nodeType === 3 || a.nodeType === 8) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
    if (a.nodeType !== 1) return;
    var aa = a.attributes, ba = b.attributes, k;
    for (k = aa.length - 1; k >= 0; k--) if (!b.hasAttribute(aa[k].name)) a.removeAttribute(aa[k].name);
    for (k = 0; k < ba.length; k++) if (a.getAttribute(ba[k].name) !== ba[k].value) a.setAttribute(ba[k].name, ba[k].value);
    morphKids(a, b);
  }
  function morphInto(host, html) { TPL.innerHTML = html; morphKids(host, TPL.content); }
  // 面板真正的底色（表头、合计行贴着上下边时要不透明，用和面板一样的颜色，不是黑的）
  var bgOf = function (el) { for (var e = el; e && e.nodeType === 1; e = e.parentElement) { var c = getComputedStyle(e).backgroundColor; if (c && c !== "transparent" && !/^rgba\([^)]*,\s*0\)$/.test(c)) return c; } return ""; };
  var INSET = 19; // 内容的左右边：和面板标题栏里的字（系统资源 / AGENT 活动）对齐（.st-ptop 左边 10 + .st-ptab 左边 9）
  var DIS = '<svg class="am-dis" viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 2 6.5 5 3.5 8"/></svg>';
  var SORT_ICO = function (d) { return '<svg viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="' + (d > 0 ? "M2.5 3.75 5 6.25 7.5 3.75" : "M2.5 6.25 5 3.75 7.5 6.25") + '"/></svg>'; };
  var paren = function (a, b) { return b ? a + (window.TSU_I18N && TSU_I18N.lang && TSU_I18N.lang() === "en" ? " (" + b + ")" : "（" + b + "）") : a; };
  // 正在跑的是哪个程序：命令取程序名（跳过 cd、export、FOO=bar 这些），别的工具写工具名
  var progOf = function (p) {
    var n = String((p && p.name) || ""), a = (p && p.input) || {};
    if (/^(Bash|shell|exec_command|local_shell)$/.test(n)) {
      var c = a.command != null ? a.command : a.cmd;
      if (Array.isArray(c)) c = /^(ba|z)?sh$/.test(String(c[0] || "").split("/").pop()) && /^-\w*c$/.test(String(c[1] || "")) ? c[2] : c.join(" ");
      var segs = String(c || "").split(/&&|\|\||;|\||\n/);
      for (var i = 0; i < segs.length; i++) {
        var w = segs[i].trim().split(/\s+/).filter(function (t) { return t && !/^\w+=/.test(t); });
        while (w.length > 1 && /^(sudo|time|nice|env|exec|nohup|command)$/.test(w[0])) w.shift();
        if (!w.length || /^(cd|export|source|\.|set|unset|pushd|popd|echo|true|:)$/.test(w[0])) continue;
        return w[0].replace(/^["']|["']$/g, "").split("/").pop();
      }
      return n;
    }
    if (/^mcp__/.test(n)) return n.split("__").slice(1).join(" ");
    return n;
  };
  var etMs = function (s) { var m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(String(s || "").trim()); return m ? ((+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3]) * 60 + (+m[4])) * 1000 : null; };
  var dur = function (ms) { var s = Math.max(0, Math.round(ms / 1000)), m = Math.floor(s / 60), h = Math.floor(m / 60); return s < 60 ? s + "s" : m < 60 ? m + "m " + (s % 60) + "s" : h + "h " + (m % 60) + "m"; };
  var hhmm = function (t) { var d = new Date(t); return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); };
  function kindOf(p) {
    var n = String(p.name || "");
    if (n === "Bash" || /^(shell|exec_command|local_shell)$/.test(n)) return "bash";
    if (/^(Read|Grep|Glob|LS|NotebookRead|read_file|list_dir|grep)$/.test(n)) return "read";
    if (/^(Edit|MultiEdit|Write|NotebookEdit|apply_patch|write_file)$/.test(n)) return "edit";
    if (/^(Agent|Task)$/.test(n)) return "agent";
    if (/^(WebFetch|WebSearch|web_search|web_fetch)$/.test(n)) return "web";
    if (/^mcp__/.test(n)) return "mcp";
    return "other";
  }
  var spanMin = function () { var v = +(localStorage.getItem("tsu-trace-span") || 60); return SPANS.some(function (x) { return x[0] === v; }) ? v : 60; };
  // 打开着的会话的运行时：自己的 agent（liveRuntimes）+ 标签页里开着的 Claude Code、Codex 会话
  function runtimes() {
    var A = window.TSU_AGENTS, out = [], seen = new Set();
    var add = function (r) { if (r && r.agent && !r.agent.deleted && !seen.has(r)) { seen.add(r); out.push(r); } };
    if (A && A.liveRuntimes) A.liveRuntimes().forEach(add);
    if (A && A.runtime && window.TSU_TERM && TSU_TERM.panes) TSU_TERM.panes().forEach(function (p) { var id = p && p.program && p.program.agentId; if (!id) return; try { add(A.runtime(id)); } catch (e) { /* 没有就算了 */ } });
    return out;
  }
  // 一个会话在这段时间里的：一问一问（底色）、工具调用（条）、后台任务（细条）、记号
  function collect(rt, from, now) {
    var ts = rt.session ? rt.session().turns || [] : [], bars = [], turns = [], marks = [];
    for (var i = ts.length - 1; i >= 0; i--) {
      var t = ts[i], live = !!(rt.stream && rt.stream.turn === t);
      if (t.compact) { if (t.at >= from) marks.push({ at: t.at, k: "compact", tip: tr("上下文压缩") }); continue; }
      var end = live ? now : t.last || (t.stats && t.stats.at) || t.at || 0;
      if ((t.at || 0) < from && end < from) break; // 记录是按时间排的：再往前都在这段之外
      if (t.ask !== undefined && !t.system && t.at >= from) marks.push({ at: t.at, k: "ask", tip: String(t.ask || "").replace(/\s+/g, " ").slice(0, 140) });
      if (t.ask !== undefined && t.at) turns.push({ s: Math.max(t.at, from), e: Math.max(end, t.at + 1000), live: live, at: t.at });
      (t.parts || []).forEach(function (p) {
        if (p.kind !== "tool" || !p.t0) return;
        var run = p.status === "running" && live, e = p.t1 || (run ? now : p.t0 + 600);
        if (e < from) return;
        bars.push({ s: Math.max(p.t0, from), e: Math.max(e, p.t0 + 300), t0: p.t0, t1: e, k: kindOf(p), p: p, run: run, err: p.status === "error" });
      });
    }
    var bg = (rt.tasks || []).filter(function (x) { return x.t0 && (x.status === "running" ? now : x.end || x.t0) >= from; }).map(function (x) {
      var e = x.status === "running" ? now : x.end || x.t0 + 1000;
      return { s: Math.max(x.t0, from), e: e, t0: x.t0, t1: e, k: x.kind === "shell" ? "bash" : "agent", x: x, run: x.status === "running" };
    });
    return { bars: bars.reverse(), turns: turns.reverse(), marks: marks.reverse(), bg: bg };
  }
  // 并发的叠成几行（最多 max 行）；再多的不画（b.l = -1，不再挤进最后一行、条和字叠成一团），list.hidden 记下几个没画
  function laneOut(list, max) {
    var ends = [], hid = 0;
    list.slice().sort(function (a, b) { return a.s - b.s; }).forEach(function (b) {
      var l = -1;
      for (var i = 0; i < ends.length; i++) if (ends[i] <= b.s) { l = i; break; }
      if (l < 0 && ends.length < max) { l = ends.length; ends.push(0); }
      if (l < 0) { b.l = -1; hid++; return; }
      ends[l] = Math.max(ends[l], b.e); b.l = l;
    });
    list.hidden = hid;
    return Math.max(1, ends.length);
  }
  // 条里的字：套一层 <svg>（只画在条里面，超出的剪掉——不会压到旁边的条、叠成一团）
  var inBar = function (cls, x1, y, w, h, ty, text) { return '<svg x="' + x1.toFixed(1) + '" y="' + y + '" width="' + Math.max(0, w - 3).toFixed(1) + '" height="' + h + '"><text class="' + cls + '" x="4" y="' + ty + '">' + esc(text) + "</text></svg>"; };
  // 这段时间里忙了多少（一问一问的并集）
  function busyMs(turns, from, now) {
    var segs = turns.map(function (t) { return [Math.max(t.s, from), Math.min(t.e, now)]; }).filter(function (x) { return x[1] > x[0]; }).sort(function (a, b) { return a[0] - b[0]; }), n = 0, cur = null;
    segs.forEach(function (x) { if (!cur || x[0] > cur[1]) { if (cur) n += cur[1] - cur[0]; cur = x.slice(); } else cur[1] = Math.max(cur[1], x[1]); });
    if (cur) n += cur[1] - cur[0];
    return n;
  }
  // 这一条在干什么（画在条里面、左边那栏写「在做 / 刚做完」）：命令的说明、文件名、搜的词……
  var what = function (p) { var a = (p && p.input) || {}; return String(a.description || a.command || (a.file_path ? String(a.file_path).split("/").pop() : "") || a.pattern || a.url || a.query || a.prompt || (p && p.name) || "").replace(/\s+/g, " ").trim(); };
  var trT = function (x, aid) { return x && window.TSU_TRANSLATE ? TSU_TRANSLATE.text(x, aid) : x; }; // 任务标题的译文（同对话里：设置 › 任务翻译开着就是中文）
  var fit = function (s, px, fs) { // 按宽度截：中文算一个字宽、别的算 0.6 个
    s = String(s || ""); var w = 0, out = "", cw = fs || 10;
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i), d = c > 0x2e80 ? cw : cw * 0.6; if (w + d > px - cw) return out + "…"; w += d; out += s[i]; }
    return out;
  };
  var toolTip = function (b) {
    var p = b.p, a = (p && p.input) || {}, what = String(a.description || a.command || a.file_path || a.pattern || a.url || a.query || a.prompt || "").replace(/\s+/g, " ").trim().slice(0, 200);
    return (p ? p.name : "") + (what ? " · " + what : "") + " · " + (b.run ? tr("在跑") + " " : "") + dur(b.t1 - b.t0) + (b.err ? " · " + tr("出错") : "");
  };
  var bgTip = function (b) { var x = b.x; return (x.kind === "shell" ? tr("后台命令") : tr("子 Agent")) + " · " + String(x.desc || x.cmd || "").slice(0, 160) + " · " + (b.run ? tr("在跑") + " " : "") + dur(b.t1 - b.t0); };
  var modeOf = function () { return localStorage.getItem("tsu-act-mode") === "timeline" ? "timeline" : "table"; };
  // 顶上一条：列表 | 时间线（同活动监视器顶上的分段）；右边：挪到右侧栏 / 挪回面板
  // 在底部面板里：这几个按钮放进面板标题栏的右边（headActs，同 VS Code 面板的视图按钮），这里不再单独占一行
  function topBar(host, extra) {
    if (host.closest(".st-pv")) return "";
    if (host.closest(".st-pg-activity")) { var m0 = modeOf(); return '<div class="am-top"><div class="tr-seg">' + [["table", "列表"], ["timeline", "时间线"]].map(function (x) { return '<button type="button" class="tr-sp' + (x[0] === m0 ? " on" : "") + '" data-amm="' + x[0] + '">' + esc(tr(x[1])) + "</button>"; }).join("") + "</div>" + (extra || "") + "</div>"; } // 标签页里：只有列表 / 时间线（不再有浮动、挪到侧栏）
    var side = !!host.closest(".st-aside"), m = modeOf();
    return '<div class="am-top"><div class="tr-seg">' + [["table", "列表"], ["timeline", "时间线"]].map(function (x) { return '<button type="button" class="tr-sp' + (x[0] === m ? " on" : "") + '" data-amm="' + x[0] + '">' + esc(tr(x[1])) + "</button>"; }).join("") + "</div>" + (extra || "") +
      '<span class="am-fill"></span>' + (host.closest(".am-float") ? "" : '<button type="button" class="am-move" data-am-float="1" title="' + esc(tr("浮动显示（在所有标签页上面，可拖动、缩放）")) + '">' + FLOAT_ICO + "</button>") +
      (host.closest(".am-float") ? '<button type="button" class="am-move" data-am-unfloat="1" title="' + esc(tr("收回")) + '">' + MOVE_DOWN + "</button>" : '<button type="button" class="am-move" data-am-move="' + (side ? "panel" : "side") + '" title="' + esc(tr(side ? "挪回面板" : "挪到右侧栏")) + '">' + (side ? MOVE_DOWN : MOVE_RIGHT) + "</button>") + "</div>";
  }
  var FLOAT_ICO = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="1.75" y="4.75" width="9.5" height="8.5" rx="1.5"/><rect x="5.25" y="2.25" width="9" height="7.5" rx="1.5" fill="currentColor" fill-opacity=".18"/></svg>';
  var MOVE_RIGHT = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5"/><path d="M10.25 2.75v10.5M4.5 8h3.5M6.5 6l2 2-2 2"/></svg>';
  var MOVE_DOWN = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5"/><path d="M1.75 9.75h12.5M8 4v3.5M6 5.5l2 2 2-2"/></svg>';

  // ======== 进程：每个 Claude Code 会话自己的进程（claude）和它开出来的所有子进程（命令、开发服务器……）加起来占多少 CPU、内存 ========
  //   一条 ps 读全部进程（pid、父进程、CPU、内存），按父子关系往下加；看得见（或 Paimon 要）时才读，3 秒最多一次。
  //   Codex 的会话都在同一个后台服务里跑，分不出是哪一段的——写「—」
  var PS = { at: 0, busy: false, map: null, hist: [], per: {}, args: {}, aat: 0, abusy: false }; // per：每个会话自己的一段历史（点开它看的那两张图）
  function sample(force) {
    var L = window.TSU_LOCAL;
    if (!L || !L.exec || PS.busy || (!force && Date.now() - PS.at < 2800)) return;
    PS.busy = true;
    L.exec({ cmd: "ps -Ao pid=,ppid=,pcpu=,rss=,comm=; echo __GPU; ioreg -r -d 1 -w 0 -c IOAccelerator 2>/dev/null | grep -o '\"Device Utilization %\"=[0-9]*' | head -1" }).then(function (r) {
      var kids = {}, info = {}, rawAll = String((r && (r.out || r.stdout)) || ""), gm = /Device Utilization %"=(\d+)/.exec(rawAll.split("__GPU")[1] || "");
      PS.gpu = gm ? +gm[1] : null;
      String((r && (r.out || r.stdout)) || "").split("\n").forEach(function (l) { var m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s*(.*)$/.exec(l); if (!m) return; info[+m[1]] = { cpu: +m[3], rss: +m[4], name: String(m[5] || "").split("/").pop() }; (kids[+m[2]] || (kids[+m[2]] = [])).push(+m[1]); });
      PS.map = { kids: kids, info: info }; PS.at = Date.now();
      var tot = 0, mem = 0; runtimes().forEach(function (rt) { var u = useOf(rt); if (u) { tot += u.cpu; mem += u.mem; var id0 = rt.agent && rt.agent.id; if (id0) { var hs = PS.per[id0] || (PS.per[id0] = []); hs.push({ t: PS.at, cpu: u.cpu, mem: u.mem, procs: u.procs }); if (hs.length > 240) hs.shift(); } } });
      PS.hist.push({ t: PS.at, cpu: tot, mem: mem, gpu: PS.gpu }); if (PS.hist.length > 240) PS.hist.shift();
    }, function () {}).then(function () { PS.busy = false; });
  }
  var pidOf = function (rt) { var i = rt && rt.info; return (i && i.live && +i.live.pid) || 0; };
  function useOf(rt) {
    var pid = pidOf(rt), M = PS.map;
    if (!pid || !M || !M.info[pid]) return null;
    var cpu = 0, mem = 0, n = 0, st = [pid], seen = {};
    while (st.length) { var p = st.pop(); if (seen[p]) continue; seen[p] = 1; var x = M.info[p]; if (x) { cpu += x.cpu; mem += x.rss * 1024; n++; } (M.kids[p] || []).forEach(function (c) { st.push(c); }); }
    return { cpu: cpu, mem: mem, procs: n };
  }

  var rtOf = function (id) { return runtimes().filter(function (x) { return x.agent && x.agent.id === id; })[0]; };
  // 点开的会话：它那几个进程的命令行、跑了多久（ps 只问这几个，3 秒最多一次）
  function argsPoll(pids) {
    var L = window.TSU_LOCAL;
    if (!L || !L.exec || PS.abusy || !pids.length || Date.now() - PS.aat < 2800) return;
    PS.abusy = true;
    L.exec({ cmd: "ps -o pid=,etime=,args= -p " + pids.slice(0, 80).join(",") }).then(function (r) {
      var m0 = {}, info = (PS.map && PS.map.info) || {};
      String((r && (r.out || r.stdout)) || "").split("\n").forEach(function (l) {
        var m = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(l); if (!m) return;
        var a = m[3].trim(), nm = (info[+m[1]] || {}).name || "", k = nm ? a.indexOf("/" + nm) : -1;
        if (k >= 0 && (a.length === k + 1 + nm.length || a.charAt(k + 1 + nm.length) === " ")) a = nm + a.slice(k + 1 + nm.length); // 程序的路径只留名字
        m0[+m[1]] = { ms: etMs(m[2]), args: a };
      });
      PS.args = m0; PS.aat = Date.now();
    }, function () {}).then(function () { PS.abusy = false; });
  }

  // ======== 整机的状态（同「活动监视器」底下那一块）：CPU、内存、能耗、磁盘、网络、GPU，一页一页切着看 ========
  //   一条命令读全（iostat 一秒的 CPU、top 的进程线程数、vm_stat、swap、内存压力、电池、磁盘和网卡的累计量、GPU），看得见才读，4 秒最多一次；
  //   累计的量（磁盘读写、网络收发）按两次之间的差算每秒。都是系统自带的命令，不用管理员权限
  var SYS = { at: 0, cur: null, prev: null, hist: [], top: {}, want: 0, procs: null };
  //   每秒一帧（同活动监视器的「非常频繁」）：一条 top 一直开着（CPU 两位小数、进程线程数、对能耗的影响），一个小循环每秒读一次
  //   磁盘、网络、GPU、内存、电池（ioreg、netstat、vm_stat、sysctl、pmset，都是系统自带、不用管理员权限）。只在「系统资源」看得见时开，6 秒没人看就停
  var LOOP = "while :; do echo __DISK; ioreg -c IOBlockStorageDriver -r -k Statistics -d 1 -w 0 | grep -o '\"Statistics\" = {[^}]*}'; echo __GPU; ioreg -r -d 1 -w 0 -c IOAccelerator | grep -o '\"PerformanceStatistics\" = {[^}]*}' | head -1; echo __NET; netstat -ib | awk '/<Link#/ && $1 != \"lo0\"'; echo __VM; vm_stat; echo __MEM; sysctl -n hw.memsize; sysctl -n hw.ncpu; sysctl -n vm.swapusage; sysctl -n kern.memorystatus_level; echo __BAT; pmset -g batt; echo __END; sleep 1; done";
  function sysSample() {
    SYS.want = Date.now();
    var L = window.TSU_LOCAL;
    if (!L || !L.proc || SYS.procs) return;
    var bufL = "", bufT = "";
    var pl = L.proc({ argv: ["/bin/sh", "-c", LOOP] }, function (d, err) { if (err) return; bufL += d; var k; while ((k = bufL.indexOf("__END\n")) >= 0) { var fr = bufL.slice(0, k); bufL = bufL.slice(k + 6); try { frameIn(fr); } catch (e) { /* 这一帧坏了：等下一帧 */ } } }, function () { if (SYS.procs) SYS.procs.loop = null; });
    var pt = L.proc({ argv: ["/usr/bin/top", "-l", "0", "-s", "1", "-n", "12", "-o", "power", "-stats", "pid,power"] }, function (d, err) { if (err) return; bufT += d; var parts = bufT.split(/\n(?=Processes:)/); bufT = parts.pop(); parts.forEach(topIn); }, function () { if (SYS.procs) SYS.procs.top = null; });
    SYS.procs = { loop: pl, top: pt, n: 0 };
  }
  setInterval(function () { if (SYS.procs && Date.now() - SYS.want > 6000) { try { if (SYS.procs.loop) SYS.procs.loop.kill(); if (SYS.procs.top) SYS.procs.top.kill(); } catch (e) { /* 已经停了 */ } SYS.procs = null; } }, 2000);
  function topIn(txt) {
    var n = function (re) { var m = re.exec(txt); return m ? +m[1] : null; };
    if (SYS.procs) SYS.procs.n++;
    if (!SYS.procs || SYS.procs.n < 2) return; // 第一次的 CPU 不准（同 top 自己）：从第二次起算
    var pw = 0, inList = false;
    txt.split("\n").forEach(function (l) { if (/^\s*PID\s+POWER/.test(l)) { inList = true; return; } if (inList) { var m = /^\s*\d+\s+([\d.]+)/.exec(l); if (m) pw += +m[1]; } });
    SYS.top = { user: n(/([\d.]+)% user/), sys: n(/([\d.]+)% sys/), idle: n(/([\d.]+)% idle/), procs: n(/(\d+) total/), threads: n(/(\d+) threads/), energy: Math.round(pw * 10) / 10 };
  }
  function frameIn(out) {
    var sec = {}, cur = "x";
    out.split("\n").forEach(function (l) { var m = /^__(\w+)$/.exec(l.trim()); if (m) { cur = m[1].toLowerCase(); return; } (sec[cur] = sec[cur] || []).push(l); });
    var x = { t: Date.now() }, n = function (re, txt) { var m = re.exec(txt || ""); return m ? +m[1] : null; };
    var vm = (sec.vm || []).join("\n"), ps = n(/page size of (\d+)/, vm) || 16384, pg = function (k) { var v = n(new RegExp(k + ":\\s+(\\d+)"), vm); return v == null ? 0 : v * ps; };
    var mm = (sec.mem || []).map(function (l) { return l.trim(); }).filter(Boolean);
    x.phys = +mm[0] || 0; x.ncpu = +mm[1] || 0;
    x.wired = pg("Pages wired down"); x.compressed = pg("Pages occupied by compressor"); x.cached = pg("File-backed pages") + pg("Pages purgeable");
    x.app = Math.max(0, pg("Anonymous pages") - pg("Pages purgeable")); x.used = x.app + x.wired + x.compressed;
    var sw = /used = ([\d.]+)([MG])/.exec(mm[2] || ""); x.swap = sw ? +sw[1] * (sw[2] === "G" ? 1073741824 : 1048576) : 0;
    var lvl = +mm[3]; x.pressure = isNaN(lvl) ? null : Math.max(0, Math.min(100, 100 - lvl));
    var bt = (sec.bat || []).join("\n"); x.battery = n(/(\d+)%/, bt); x.ac = /AC Power/.test(bt); x.charging = /; charging;/.test(bt); x.charged = /charged/.test(bt); x.remain = (/(\d+:\d+) remaining/.exec(bt) || [])[1] || "";
    var dk = (sec.disk || []).join(" "), sum = function (re) { var t = 0, m; re.lastIndex = 0; while ((m = re.exec(dk))) t += +m[1]; return t; };
    x.rdOps = sum(/"Operations \(Read\)"=(\d+)/g); x.wrOps = sum(/"Operations \(Write\)"=(\d+)/g); x.rdB = sum(/"Bytes \(Read\)"=(\d+)/g); x.wrB = sum(/"Bytes \(Write\)"=(\d+)/g);
    x.inPk = 0; x.outPk = 0; x.inB = 0; x.outB = 0;
    (sec.net || []).forEach(function (l) { var f = l.trim().split(/\s+/); if (f.length < 10 || !/^([0-9a-f]{1,2}:){5}[0-9a-f]{1,2}$/i.test(f[3]) || /^bridge/.test(f[0])) return; x.inPk += +f[4] || 0; x.inB += +f[6] || 0; x.outPk += +f[7] || 0; x.outB += +f[9] || 0; }); // 只算实体网卡（有硬件地址的）：VPN 隧道（utun）、回环没有地址；网桥是几块网卡合起来的——算进去同一份流量会记两遍（同活动监视器）
    var gp = (sec.gpu || []).join(" "); x.gpu = n(/"Device Utilization %"=(\d+)/, gp); x.gpuRend = n(/"Renderer Utilization %"=(\d+)/, gp); x.gpuTiler = n(/"Tiler Utilization %"=(\d+)/, gp); x.gpuMem = n(/"In use system memory"=(\d+)/, gp);
    Object.assign(x, SYS.top || {});
    var p0 = SYS.cur;
    if (p0) { var dt = Math.max(0.5, (x.t - p0.t) / 1000), d = function (k) { return Math.max(0, (x[k] - p0[k]) / dt); }; x.rdOpsS = d("rdOps"); x.wrOpsS = d("wrOps"); x.rdBS = d("rdB"); x.wrBS = d("wrB"); x.inPkS = d("inPk"); x.outPkS = d("outPk"); x.inBS = d("inB"); x.outBS = d("outB"); }
    // 接着交流电多久了（同活动监视器「使用交流电时间」）：电源换了才重新算，记在这台设备上
    var ac0 = (function () { try { return JSON.parse(localStorage.getItem("tsu-ac-since") || "null"); } catch (e) { return null; } })();
    if (!ac0 || ac0.ac !== x.ac) { ac0 = { ac: x.ac, since: x.t }; try { localStorage.setItem("tsu-ac-since", JSON.stringify(ac0)); } catch (e) { /* 满了 */ } }
    x.powerSince = ac0.since;
    SYS.prev = p0; SYS.cur = x; SYS.at = x.t;
    SYS.hist.push(x); if (SYS.hist.length > 600) SYS.hist.shift();
    if (x.battery != null) { var bh = BAT_HIST(); if (!bh.length || x.t - bh[bh.length - 1].t > 300000) { bh.push({ t: x.t, v: x.battery }); while (bh.length && x.t - bh[0].t > 12 * 3600000) bh.shift(); try { localStorage.setItem("tsu-bat-hist", JSON.stringify(bh)); } catch (e) { /* 满了 */ } } }
  }
  var batH = null;
  var BAT_HIST = function () { if (!batH) { try { batH = JSON.parse(localStorage.getItem("tsu-bat-hist") || "[]") || []; } catch (e) { batH = []; } } return batH; };
  // 电池过去 12 小时（同活动监视器）：系统自己一直记着（PowerLog，这个库谁都能读，只读打开），一分钟读一次；
  //   读不到（台式机、没有这个库）就用自己每 5 分钟记的那份
  var BATDB = "/private/var/db/powerlog/Library/BatteryLife/CurrentPowerlog.PLSQL";
  var BAT = { at: 0, busy: false, pts: [], since: 0 };
  function batPoll() {
    var L = window.TSU_LOCAL;
    if (!L || !L.exec || BAT.busy || Date.now() - BAT.at < 60000) return;
    BAT.busy = true; BAT.at = Date.now();
    var T = "PLBatteryAgent_EventBackward_Battery";
    var q = "select cast(timestamp as int), Level, ExternalConnected from " + T + " where timestamp > strftime('%s','now') - 45000 order by timestamp;" +
      " select '__AC', cast(max(timestamp) as int) from " + T + " where ExternalConnected <> (select ExternalConnected from " + T + " order by timestamp desc limit 1);" +
      " select '__MIN', cast(min(timestamp) as int) from " + T + ";";
    L.exec({ cmd: "/usr/bin/sqlite3 -readonly -separator ' ' '" + BATDB + "' \"" + q + "\" 2>/dev/null" }).then(function (r) {
      var pts = [], ac = 0, mn = 0;
      String((r && (r.out || r.stdout)) || "").split("\n").forEach(function (l) { var f = l.trim().split(" "); if (f[0] === "__AC") ac = (+f[1] || 0) * 1000; else if (f[0] === "__MIN") mn = (+f[1] || 0) * 1000; else if (f.length >= 3 && +f[0] > 0) pts.push({ t: +f[0] * 1000, v: +f[1], ac: f[2] === "1" }); });
      BAT.pts = pts; BAT.since = ac || mn;
    }, function () {}).then(function () { BAT.busy = false; });
  }
  // 数：大小、速率、百分比一律两位小数（同活动监视器）；个数（包、读写次数、进程、线程）是整数
  var scaled = function (v, base, units) { var i = 0; while (i < units.length - 1 && Math.round(v * 100) / 100 >= base) { v /= base; i++; } return v.toFixed(2) + " " + units[i]; };
  var szD = function (b) { return b == null ? "—" : scaled(b / 1000, 1000, ["KB", "MB", "GB", "TB"]); }; // 磁盘、网络：1000 进（同访达、活动监视器）
  var szM = function (b) { return b == null ? "—" : scaled(b / 1024, 1024, ["KB", "MB", "GB", "TB"]); }; // 内存：1024 进（16 GB 的内存写 16.00 GB）
  var perS = function (s) { return s === "—" ? s : s + tr("/秒"); };
  var bits = function (b) { return b == null ? "—" : perS(scaled(b * 8 / 1000, 1000, ["kb", "Mb", "Gb", "Tb"])); }; // 网速：比特（同活动监视器的下载、上传：kb/秒）
  var num = function (v) { return v == null ? "—" : Math.round(v).toLocaleString("en-US"); };
  var pct = function (v) { return v == null ? "—" : (+v).toFixed(2) + "%"; };
  var hm = function (ms) { var m = Math.max(0, Math.round(ms / 60000)); return Math.floor(m / 60) + ":" + ("0" + (m % 60)).slice(-2); }; // 同活动监视器：3:05
  // 走势图（不加框）：每秒一个点、3px 一格，从右边往左长；几条叠成面积；上下对称的（读 / 写、收 / 发）上半第一条、下半第二条，两半同一个比例
  function sysChart(w, h, series, mirror) {
    w = Math.max(20, Math.round(w)); h = Math.max(20, Math.round(h));
    var STEP = 3, hs = SYS.hist.slice(-(Math.floor(w / STEP) + 1)), n = hs.length, out = [], top = 1, bot = h - 1, mid = Math.round(h / 2);
    var xOf = function (i) { return (w - (n - 1 - i) * STEP).toFixed(1); }, val = function (sr, x) { var v = +(sr.v(x)) || 0; return v < 0 ? 0 : v; };
    if (mirror) out.push('<line class="am-mid" x1="0" x2="' + w + '" y1="' + (mid + 0.5) + '" y2="' + (mid + 0.5) + '"/>');
    if (n >= 2) {
      var shared = Math.max.apply(null, hs.map(function (x) { return Math.max.apply(null, series.map(function (sr) { return val(sr, x); })); }));
      series.forEach(function (sr, si) {
        var mx = sr.max || Math.max(1e-9, shared * 1.15), down = mirror && si === 1, base = mirror ? mid : bot, span = mirror ? mid - top : bot - top;
        var pts = hs.map(function (x, i) { var r = Math.min(1, val(sr, x) / mx); return xOf(i) + "," + (down ? base + r * span : base - r * span).toFixed(1); });
        out.push('<path class="am-area" style="fill:' + sr.c + '" d="M' + xOf(0) + "," + base + " L" + pts.join(" L") + " L" + xOf(n - 1) + "," + base + ' Z"/><polyline class="am-line" style="stroke:' + sr.c + '" points="' + pts.join(" ") + '"/>');
      });
    }
    return '<svg class="am-chart" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '">' + out.join("") + "</svg>";
  }
  // 电池（过去 12 小时）：每 10 分钟一根，这 10 分钟里最后记下的电量；关机、睡着没记的那段空着
  function batChart(w, h) {
    w = Math.max(20, Math.round(w)); h = Math.max(20, Math.round(h));
    var now = Date.now(), from = now - 12 * 3600000, pts = BAT.pts.length ? BAT.pts : BAT_HIST(), N = 72, bw = w / N, out = [], j = 0, last = null;
    for (var i = 0; i < N; i++) {
      var s = from + i * 600000, e = s + 600000, v = null;
      while (j < pts.length && pts[j].t < e) { if (pts[j].t >= s - 1800000) v = pts[j].v; last = pts[j]; j++; }
      if (v == null && last && e - last.t < 2400000) v = last.v; // 系统大约每隔一会儿记一条：40 分钟以内的照上一条
      if (v == null) continue;
      var bh = Math.max(1, Math.min(100, v) / 100 * (h - 2));
      out.push('<rect x="' + (i * bw + 0.5).toFixed(1) + '" y="' + (h - bh).toFixed(1) + '" width="' + Math.max(1, bw - 1).toFixed(1) + '" height="' + bh.toFixed(1) + '"/>');
    }
    return '<svg class="am-chart" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '"><g style="fill:' + C_BAT + '">' + out.join("") + "</g></svg>";
  }

  var SYS_TABS = [["sum", "概览"], ["cpu", "CPU"], ["gpu", "GPU"], ["mem", "内存"], ["disk", "磁盘"], ["net", "网络"], ["energy", "能耗"]]; // GPU 紧跟 CPU
  var sysTab = function () { var v = localStorage.getItem("tsu-act-sys") || "sum"; return SYS_TABS.some(function (x) { return x[0] === v; }) ? v : "sum"; };
  var diskMode = function () { return localStorage.getItem("tsu-act-disk") === "data" ? "data" : "io"; };
  var netMode = function () { return localStorage.getItem("tsu-act-net") === "data" ? "data" : "pk"; };
  var C_USER = "#5aa9e6", C_SYS = "#e5534b", C_IN = "#5aa9e6", C_OUT = "#e5534b", C_MEM = "#c8a24a", C_GPU = "#8f86c9", C_BAT = "#4f9a63";
  var UPDN = '<svg class="am-updn" viewBox="0 0 8 12" width="7" height="11" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 4.5 4 2l2.5 2.5M1.5 7.5 4 10l2.5-2.5"/></svg>';
  // 页签：胶囊（同 macOS 26 活动监视器顶上那一排），和面板标题栏的标签（下划线）不是一个样子
  function sysTabsHtml(t) { return '<div class="am-segw"><div class="am-seg" role="tablist">' + SYS_TABS.map(function (z) { return '<button type="button" role="tab" class="am-segb' + (z[0] === t ? " on" : "") + '" data-amsys="' + z[0] + '">' + esc(tr(z[1])) + "</button>"; }).join("") + "</div></div>"; }
  // 每一页底下那一条（同活动监视器）：表格 | 图 | 表格 连成一个框，高度固定（表格四行），不跟着面板拉长
  function stripSecs(t, x) {
    var memC = (x.pressure || 0) > 70 ? C_SYS : (x.pressure || 0) > 45 ? C_MEM : C_BAT;
    var g = function (title, draw, sel) { return { kind: "g", title: title, draw: draw, sel: sel }; }, kvs = function (rows, cls) { return { kind: "kv", rows: rows, cls: cls }; };
    if (t === "cpu") return [kvs([["系统：", pct(x.sys), C_SYS], ["用户：", pct(x.user), C_USER], ["闲置：", pct(x.idle)]]),
      g("CPU负载", function (w, h) { return sysChart(w, h, [{ v: function (s) { return (s.sys || 0) + (s.user || 0); }, c: C_USER, max: 100 }, { v: function (s) { return s.sys; }, c: C_SYS, max: 100 }]); }),
      kvs([["线程：", num(x.threads)], ["进程：", num(x.procs)]])];
    if (t === "gpu") return [kvs([["GPU：", pct(x.gpu), C_GPU], ["渲染器：", pct(x.gpuRend)], ["拼贴器：", pct(x.gpuTiler)]]),
      g("GPU负载", function (w, h) { return sysChart(w, h, [{ v: function (s) { return s.gpu; }, c: C_GPU, max: 100 }]); }),
      kvs([["占用的内存：", szM(x.gpuMem)]])];
    if (t === "mem") return [g("内存压力", function (w, h) { return sysChart(w, h, [{ v: function (s) { return s.pressure; }, c: memC, max: 100 }]); }),
      kvs([["物理内存：", szM(x.phys)], ["已使用内存：", szM(x.used)], ["已缓存文件：", szM(x.cached)], ["已使用的交换：", szM(x.swap)]]),
      kvs([["App内存：", szM(x.app)], ["联动内存：", szM(x.wired)], ["被压缩：", szM(x.compressed)]], "am-callout")]; // 右边这块是「已使用内存」分开来的三份：框的左边有个尖指着它（同活动监视器）
    if (t === "disk") { var io = diskMode() === "io"; return [kvs([["读入：", num(x.rdOps)], ["写出：", num(x.wrOps)], ["读入/秒：", num(x.rdOpsS), io ? C_IN : ""], ["写出/秒：", num(x.wrOpsS), io ? C_OUT : ""]]),
      g(io ? "IO" : "数据", function (w, h) { return sysChart(w, h, io ? [{ v: function (s) { return s.rdOpsS; }, c: C_IN }, { v: function (s) { return s.wrOpsS; }, c: C_OUT }] : [{ v: function (s) { return s.rdBS; }, c: C_IN }, { v: function (s) { return s.wrBS; }, c: C_OUT }], true); }, "disk"),
      kvs([["读取的数据：", szD(x.rdB)], ["写入的数据：", szD(x.wrB)], ["读取的数据/秒：", perS(szD(x.rdBS)), io ? "" : C_IN], ["写入的数据/秒：", perS(szD(x.wrBS)), io ? "" : C_OUT]])]; }
    if (t === "net") { var pk = netMode() === "pk"; return [kvs([["包接收：", num(x.inPk)], ["包发送：", num(x.outPk)], ["包接收/秒：", num(x.inPkS), pk ? C_IN : ""], ["包发送/秒：", num(x.outPkS), pk ? C_OUT : ""]]),
      g(pk ? "包" : "数据", function (w, h) { return sysChart(w, h, pk ? [{ v: function (s) { return s.inPkS; }, c: C_IN }, { v: function (s) { return s.outPkS; }, c: C_OUT }] : [{ v: function (s) { return s.inBS; }, c: C_IN }, { v: function (s) { return s.outBS; }, c: C_OUT }], true); }, "net"),
      kvs([["收到的数据：", szD(x.inB)], ["发出的数据：", szD(x.outB)], ["下载：", bits(x.inBS), pk ? "" : C_IN], ["上传：", bits(x.outBS), pk ? "" : C_OUT]])]; }
    var secs = [g("对能耗的影响", function (w, h) { return sysChart(w, h, [{ v: function (s) { return s.energy; }, c: C_USER }]); })];
    if (x.battery != null) {
      var since = BAT.since || x.powerSince || 0;
      var r2 = x.ac ? ["充满电需要的时间：", x.charged || x.battery >= 100 ? tr("电池已充满电") : x.charging ? (x.remain && x.remain !== "0:00" ? x.remain : tr("正在计算…")) : tr("电池没有在充电")] : ["剩余时间：", x.remain || tr("正在计算…")];
      secs.push(kvs([["剩余电量：", pct(x.battery)], r2, [x.ac ? "使用交流电时间：" : "使用电池时间：", since ? hm(Date.now() - since) : "—"]]));
      secs.push(g("电池（过去12小时）", batChart));
    }
    return secs;
  }
  var KW = 236, GW = 300, CH = 80; // 表格一栏宽、图一栏宽、图高（图的标题 22 + 间隔 2 + 图 80 = 表格四行 4 × 26）
  function sysStrip(t, W) {
    var x = SYS.cur || {};
    if (t === "sum") return sysOverview(x, W);
    var secs = stripSecs(t, x), nk = secs.filter(function (s) { return s.kind === "kv"; }).length, ng = secs.length - nk, fixed = secs.length + 1;
    var kw = KW, gw = GW, tot = function () { return nk * kw + ng * gw + fixed; };
    if (tot() > W && ng) gw = Math.max(170, Math.floor((W - fixed - nk * kw) / ng)); // 放不下：先收窄图，再收窄表格，还放不下就上下排
    if (tot() > W && nk) kw = Math.max(200, Math.floor((W - fixed - ng * gw) / nk));
    var stack = tot() > W;
    return '<div class="am-strip' + (stack ? " stack" : "") + '">' + secs.map(function (s) {
      var sw = s.kind === "kv" ? kw : gw, st = stack ? "" : ' style="width:' + sw + 'px"';
      if (s.kind === "kv") return '<div class="am-sec am-kv' + (s.cls ? " " + s.cls : "") + '"' + st + ">" + s.rows.map(function (r) { return '<div class="am-kvr"><span>' + esc(tr(r[0])) + "</span><b" + (r[2] ? ' style="color:' + r[2] + '"' : "") + ">" + esc(r[1]) + "</b></div>"; }).join("") + "</div>";
      return '<div class="am-sec am-gsec"' + st + '><div class="am-gt">' + (s.sel ? '<button type="button" class="am-gsel" data-amsel="' + s.sel + '" title="' + esc(tr("点一下在两种之间切换")) + '">' + esc(tr(s.title)) + UPDN + "</button>" : "<span>" + esc(tr(s.title)) + "</span>") + "</div>" + s.draw((stack ? Math.max(160, W - 2) : sw) - 28, CH) + "</div>";
    }).join("") + "</div>";
  }
  // 概览：六项连成一个框，一行六格（窄了三格两行），格子宽有上限，不拉长；只写名字、现在的数、走势
  function sysOverview(x, W) {
    var c = (W - 2) / 6 >= 120 ? 6 : (W - 2) / 3 >= 120 ? 3 : 2, rowsN = 6 / c, cw = Math.max(110, Math.min(230, Math.floor((W - 2) / c))), ch = 120;
    var memC = (x.pressure || 0) > 70 ? C_SYS : (x.pressure || 0) > 45 ? C_MEM : C_BAT;
    var mir = function (a, b) { return function (w, h) { return sysChart(w, h, [{ v: function (s) { return s[a]; }, c: C_IN }, { v: function (s) { return s[b]; }, c: C_OUT }], true); }; };
    var items = [
      ["cpu", "CPU", x.user != null ? pct(x.user + x.sys) : "—", function (w, h) { return sysChart(w, h, [{ v: function (s) { return (s.sys || 0) + (s.user || 0); }, c: C_USER, max: 100 }, { v: function (s) { return s.sys; }, c: C_SYS, max: 100 }]); }],
      ["gpu", "GPU", pct(x.gpu), function (w, h) { return sysChart(w, h, [{ v: function (s) { return s.gpu; }, c: C_GPU, max: 100 }]); }],
      ["mem", "内存", x.used != null && x.phys ? szM(x.used).replace(/ GB$/, "") + " / " + szM(x.phys) : szM(x.used), function (w, h) { return sysChart(w, h, [{ v: function (s) { return s.pressure; }, c: memC, max: 100 }]); }],
      ["disk", "磁盘", x.rdBS != null ? perS(szD(x.rdBS + x.wrBS)) : "—", mir("rdBS", "wrBS")],
      ["net", "网络", x.inBS != null ? bits(x.inBS + x.outBS) : "—", mir("inBS", "outBS")],
      x.battery != null ? ["energy", "电池", pct(x.battery), batChart] : ["energy", "能耗", x.energy != null ? (+x.energy).toFixed(2) : "—", function (w, h) { return sysChart(w, h, [{ v: function (s) { return s.energy; }, c: C_USER }]); }],
    ];
    return '<div class="am-ov" style="grid-template-columns:repeat(' + c + "," + cw + 'px)">' + items.map(function (it, i) {
      return '<div class="am-ovc' + (i % c === c - 1 ? " lc" : "") + (Math.floor(i / c) === rowsN - 1 ? " lr" : "") + '" data-amsys="' + it[0] + '" style="height:' + ch + 'px"><div class="am-ovh"><span>' + esc(tr(it[1])) + "</span><b>" + esc(it[2]) + "</b></div>" + it[3](cw - 25, ch - 16 - 18 - 5) + "</div>";
    }).join("") + "</div>";
  }
  function procsOf(rt) {
    var pid = pidOf(rt), M = PS.map, out = [];
    if (!pid || !M || !M.info[pid]) return out;
    var st = [pid], seen = {};
    while (st.length) { var p = st.pop(); if (seen[p]) continue; seen[p] = 1; var x = M.info[p]; if (x) out.push({ pid: p, name: x.name || "", cpu: x.cpu, mem: x.rss * 1024 }); (M.kids[p] || []).forEach(function (c) { st.push(c); }); }
    return out.sort(function (a, b) { return b.cpu - a.cpu || b.mem - a.mem; });
  }
  var mb = function (b) { return b == null ? "—" : b >= 1073741824 ? (b / 1073741824).toFixed(1) + " GB" : (b / 1048576).toFixed(1) + " MB"; }; // 这张表一律一位小数（同 CPU 那一列）
  // 一行：这个会话现在的样子
  function rowOf(rt, now) {
    var a = rt.agent || {}, id = a.id || "", s = rt.stream, q = null;
    try { q = rt.question ? rt.question() : null; } catch (e) { q = null; }
    var turns = rt.session ? rt.session().turns || [] : [], lt = null;
    for (var i = turns.length - 1; i >= 0 && !lt; i--) if (turns[i] && turns[i].ask !== undefined) lt = turns[i];
    var parts = (lt && lt.parts) || [], runP = null, lastP = null;
    for (var j = parts.length - 1; j >= 0; j--) { var p = parts[j]; if (p.kind !== "tool") continue; if (!lastP) lastP = p; if (p.status === "running") { runP = p; break; } }
    var st = s ? "run" : q ? "wait" : "idle";
    var nat = rt.native && Date.now() - (rt.native.at || 0) < 6000 ? rt.native : null, thinking = !!(s && (s.thinking || (nat && /thinking|thought|deep in thought/i.test(nat.extra || ""))));
    var doing = runP ? trT(what(runP), id) : s ? tr(thinking ? "思考中" : "输出中") : q ? tr("等待你的回答") : lastP ? trT(what(lastP), id) : "";
    var detail = s ? (runP ? progOf(runP) : tr(thinking ? "思考" : "输出")) : "", tip = runP ? String(runP.name || "") + (what(runP) ? " · " + trT(what(runP), id) : "") : "";
    var since = s ? s.t0 : (lt && (lt.last || (lt.stats && lt.stats.at) || lt.at)) || 0, c = null, u = useOf(rt);
    try { c = rt.ctx ? rt.ctx() : null; } catch (e) { c = null; }
    return { id: id, name: a.name || id, conn: /^cc:/.test(id) ? "cc" : /^cx:/.test(id) ? "cx" : "pm", status: st, doing: doing, detail: detail, tip: tip, doingNow: !!runP, since: since, ms: since ? Math.max(0, now - since) : 0,
      calls: parts.filter(function (x) { return x.kind === "tool"; }).length, ctx: c && c.window ? Math.round(c.pct * 10) / 10 : null, bg: (rt.tasks || []).filter(function (x) { return x.status === "running"; }).length,
      cpu: u ? u.cpu : null, mem: u ? u.mem : null, procs: u ? u.procs : null };
  }
  var EN = function () { return !!(window.TSU_I18N && TSU_I18N.lang && TSU_I18N.lang() === "en"); };
  var ST_TXT = { run: "工作中", wait: "等待处理", idle: "空闲" }, ST_EN = { run: "Working", wait: "Needs input", idle: "Idle" }, ST_ORD = { run: 0, wait: 1, idle: 2 };
  var stTxt = function (k) { return EN() ? ST_EN[k] : ST_TXT[k]; }; // 状态自己给英文（不拿全局的「在跑」——别处它是小写的 running）
  var SORT = (function () { try { return JSON.parse(localStorage.getItem("tsu-act-sort")) || null; } catch (e) { return null; } })() || { k: "status", d: 1 };
  var COLS = [["name", "Agent"], ["status", "状态"], ["ms", "用时"], ["cpu", "CPU"], ["mem", "内存"], ["procs", "进程"], ["ctx", "上下文"]];
  function sorted(rows) {
    var k = SORT.k, d = SORT.d;
    return rows.slice().sort(function (a, b) {
      var x = k === "status" ? ST_ORD[a.status] : a[k], y = k === "status" ? ST_ORD[b.status] : b[k];
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      var r = typeof x === "string" ? x.localeCompare(y) : x - y;
      return (r || (ST_ORD[a.status] - ST_ORD[b.status]) || ((b.cpu || 0) - (a.cpu || 0))) * (k === "status" || typeof x === "string" ? d : -d);
    });
  }
  var LOGO = function (c) { var L = window.TSU_LOGOS || {}; return c === "cc" ? L.claude || "" : c === "cx" ? L.codex || "" : L.paimon || ""; };
  // 底下的「CPU 负载」：最近这段的总 CPU（所有会话加起来），同活动监视器底下那张
  function chart(w, h) {
    var hs = PS.hist.slice(-Math.max(20, Math.floor(w / 3))), max = Math.max(10, hs.reduce(function (m, x) { return Math.max(m, x.cpu); }, 0) * 1.25); // 按这段里最高的放大（同活动监视器：几个百分点也看得出起伏）
    if (hs.length < 2) return '<svg class="am-chart" width="' + w + '" height="' + h + '"></svg>';
    var step = w / (hs.length - 1), pts = hs.map(function (x, i) { return (i * step).toFixed(1) + "," + (h - 1 - x.cpu / max * (h - 3)).toFixed(1); });
    return '<svg class="am-chart" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '"><path class="am-area" d="M0,' + h + " L" + pts.join(" L") + " L" + w + "," + h + ' Z"/><polyline class="am-line" points="' + pts.join(" ") + '"/></svg>';
  }
  function render(host) {
    if (!host || !host.isConnected || !host.getClientRects().length) return; // 藏着的（面板收起、不在这个标签）不画
    if (host._amHold) return;
    if (modeOf() === "timeline") return renderTimeline(host);
    sample();
    var now = Date.now(), L0 = host._amLast || { key: "", at: 0 };
    // 列哪些：开在标签页里的会话，和没开着但在跑 / 等你的（闲着、又没开着的 Paimon agent 不列——一长串空行没意义）
    var openIds = {}; try { (window.TSU_TERM && TSU_TERM.panes ? TSU_TERM.panes() : []).forEach(function (p) { var i = p && p.program && p.program.agentId; if (i) openIds[i] = 1; }); } catch (e) { /* 没有就算了 */ }
    var rows = runtimes().map(function (rt) { return rowOf(rt, now); }).filter(function (r) { return openIds[r.id] || r.status !== "idle"; }), W = host.clientWidth, compact = W < 560;
    // 只列会话：整机的 CPU、GPU、内存、磁盘在状态栏右边那几项（用户 2026-10-13：不要底下那一块）
    var amv = !compact && !!host.closest(".st-pv, .am-float, .st-pg-activity"), open = host._open || (host._open = {});
    host.classList.toggle("am-amhost", amv);
    var opids = [];
    rows.forEach(function (r) { if (!open[r.id]) return; var rt = rtOf(r.id); if (rt) procsOf(rt).forEach(function (p) { opids.push(p.pid); }); });
    if (opids.length) argsPoll(opids);
    var key = W + "|" + host.clientHeight + "|" + JSON.stringify(SORT) + "|" + PS.at + "|" + PS.aat + "|" + Object.keys(open).join(",") + "|" + rows.map(function (r) { return r.id + r.status + r.detail + r.calls + r.bg + r.ctx; }).join(",");
    if (key === L0.key && now - L0.at < 950) return;
    host._amLast = { key: key, at: now };
    var run = rows.filter(function (r) { return r.status === "run"; }).length, wait = rows.filter(function (r) { return r.status === "wait"; }).length, idleN = rows.length - run - wait;
    var tc = rows.reduce(function (n, r) { return n + (r.cpu || 0); }, 0), tm = rows.reduce(function (n, r) { return n + (r.mem || 0); }, 0), tp = rows.reduce(function (n, r) { return n + (r.procs || 0); }, 0), any = rows.some(function (r) { return r.cpu != null; });
    var X0 = SYS.cur || {}, cap = (X0.ncpu || navigator.hardwareConcurrency || 8) * 100, ram = X0.phys || 0;
    var lvOf = function (r, k) {
      if (k === "cpu" && r.cpu != null) return r.cpu >= cap * 0.5 ? "crit" : r.cpu >= cap * 0.25 ? "warn" : ""; // 占了这台电脑一半的算力：红；四分之一：黄
      if (k === "mem" && r.mem != null && ram) return r.mem >= ram * 0.25 ? "crit" : r.mem >= ram * 0.1 ? "warn" : ""; // 占了内存的四分之一：红；十分之一：黄
      if (k === "ctx" && r.ctx != null) return r.ctx >= 92 ? "crit" : r.ctx >= 80 ? "warn" : ""; // 上下文快满（快要自动压缩）
      return "";
    };
    var lvWrap = function (r, k, html) { var l = lvOf(r, k); return l ? '<span class="am-' + l + '">' + html + "</span>" : html; };
    // 状态：工作中（思考）/ 工作中（输出）/ 工作中（python3）——括号里是正在跑的程序（命令的程序名、工具名），不写会变来变去的说明（说明在悬停的提示里）
    var stCell = function (r) { return r.status === "run" ? paren(stTxt("run"), r.detail) : stTxt(r.status); };
    var cell = function (r, k) {
      if (k === "name") return DIS + '<span class="am-logo am-k-' + r.conn + '">' + LOGO(r.conn) + '</span><span class="am-cut">' + esc(r.name) + "</span>";
      if (k === "status") return '<span class="am-cut am-st-' + r.status + '"' + (r.tip ? ' title="' + esc(r.tip) + '"' : "") + ">" + esc(stCell(r)) + "</span>";
      if (k === "ms") return r.ms ? dur(r.ms) : "—";
      if (k === "cpu") return r.cpu == null ? "—" : lvWrap(r, k, r.cpu.toFixed(1) + "%");
      if (k === "mem") return lvWrap(r, k, mb(r.mem));
      if (k === "procs") return r.procs == null ? "—" : String(r.procs);
      if (k === "ctx") return r.ctx == null ? "—" : lvWrap(r, k, r.ctx.toFixed(1) + "%");
      return "";
    };
    // 点开一行：下面列出它的进程（同活动监视器「分层显示」）——名字、命令行、跑了多久、CPU、内存、PID
    var NOPS = tr("量不到这个会话的进程（只有 Claude Code 的会话量得出）");
    var subs = function (r, cmp) {
      var rt = rtOf(r.id), pr = rt ? procsOf(rt).slice(0, 40) : [];
      if (!pr.length) return cmp ? '<div class="am-csub am-dim">' + esc(NOPS) + "</div>" : '<div class="am-tr am-sub"><span class="am-c am-name am-span am-dim">' + esc(NOPS) + "</span></div>";
      return pr.map(function (p) {
        var a = PS.args[p.pid] || {};
        if (cmp) return '<div class="am-csub"><span class="am-cut">' + esc(p.name || "—") + '</span><span class="am-num">' + p.cpu.toFixed(1) + "% · " + mb(p.mem) + "</span></div>";
        return '<div class="am-tr am-sub"><span class="am-c am-name"><span class="am-cut" title="' + esc(p.name) + '">' + esc(p.name || "—") + '</span></span><span class="am-c am-status"><span class="am-cut am-dim" title="' + esc(a.args || "") + '">' + esc(a.args || "") + '</span></span><span class="am-c am-ms">' + (a.ms != null ? dur(a.ms) : "") + '</span><span class="am-c am-cpu">' + p.cpu.toFixed(1) + '%</span><span class="am-c am-mem">' + mb(p.mem) + '</span><span class="am-c am-procs am-dim">' + p.pid + '</span><span class="am-c am-ctx"></span></div>';
      }).join("");
    };
    var list = sorted(rows), body;
    if (!rows.length) body = '<div class="st-dim tr-empty">' + esc(tr("没有打开的会话")) + "</div>";
    else if (compact) body = '<div class="am-list">' + list.map(function (r) {
      // 一个会话两行，按格子对齐：第一行 标志 | 名字 | CPU；第二行（从名字那一列起）状态 · 用时
      return '<div class="am-crow' + (open[r.id] ? " open" : "") + '" data-tra="' + esc(r.id) + '"><span class="am-logo am-k-' + r.conn + '">' + LOGO(r.conn) + '</span><span class="am-cut am-name">' + esc(r.name) + '</span><span class="am-num">' + (r.cpu == null ? "" : lvWrap(r, "cpu", r.cpu.toFixed(1) + "%")) + "</span>" +
        '<span class="am-cut am-l2"><span class="am-st am-st-' + r.status + '"' + (r.tip ? ' title="' + esc(r.tip) + '"' : "") + ">" + esc(stCell(r)) + "</span>" + '<span class="am-dim">' + esc(r.ms ? " · " + dur(r.ms) : "") + "</span></span></div>" + (open[r.id] ? subs(r, true) : "");
    }).join("") + "</div>";
    else {
      // 合计：用时写最长的那个、上下文写平均（加起来没有意义）；状态只写有的
      var maxMs = rows.reduce(function (m, r) { return Math.max(m, r.ms || 0); }, 0), cx = rows.filter(function (r) { return r.ctx != null; }), avgCtx = cx.length ? cx.reduce(function (n, r) { return n + r.ctx; }, 0) / cx.length : null;
      var cnt = [["run", run], ["wait", wait], ["idle", idleN]].filter(function (z) { return z[1]; }).map(function (z) { return stTxt(z[0]) + " " + z[1]; }).join(EN() ? ", " : "，");
      body = '<div class="am-table"><div class="am-tr am-th">' + COLS.map(function (c) { return '<button type="button" class="am-c am-' + c[0] + (SORT.k === c[0] ? " on" : "") + '" data-ams="' + c[0] + '">' + esc(tr(c[1])) + (SORT.k === c[0] ? '<i class="am-sort">' + SORT_ICO(SORT.d) + "</i>" : "") + "</button>"; }).join("") + "</div>" +
        list.map(function (r) { return '<div class="am-tr' + (open[r.id] ? " open" : "") + '" data-tra="' + esc(r.id) + '">' + COLS.map(function (c) { return '<span class="am-c am-' + c[0] + '">' + cell(r, c[0]) + "</span>"; }).join("") + "</div>" + (open[r.id] ? subs(r, false) : ""); }).join("") +
        '<div class="am-tr am-total"><span class="am-c am-name">' + esc(tr("合计")) + '</span><span class="am-c am-status">' + esc(cnt) + '</span><span class="am-c am-ms">' + (maxMs ? esc(tr("最长")) + " " + dur(maxMs) : "—") + '</span><span class="am-c am-cpu">' + (any ? tc.toFixed(1) + "%" : "—") + '</span><span class="am-c am-mem">' + (any ? mb(tm) : "—") + '</span><span class="am-c am-procs">' + (any ? tp : "—") + '</span><span class="am-c am-ctx">' + (avgCtx != null ? esc(tr("平均")) + " " + avgCtx.toFixed(1) + "%" : "—") + "</span></div></div>";
    }
    var sumH = '<span class="am-sum">' + esc(stTxt("run")) + " <b>" + run + "</b> · " + esc(stTxt("wait")) + " <b>" + wait + "</b> · " + esc(stTxt("idle")) + " <b>" + idleN + "</b>" +
      (any ? ' <span class="am-dim">·</span> ' + esc(tr("会话合计")) + " CPU <b>" + tc.toFixed(1) + "%</b> · " + esc(tr("内存")) + " <b>" + mb(tm) + "</b> · " + esc(tr("进程")) + " <b>" + tp + "</b>" : "") + "</span>";
    host.style.setProperty("--am-bg", bgOf(host));
    morphInto(host, topBar(host) + (amv ? '<div class="am-amv"><div class="am-body">' + body + "</div></div>" : '<div class="am-body">' + body + "</div>" + (compact ? '<div class="am-foot c">' + sumH + "</div>" : "")));
  }
  // 分隔线的位置：整机那一块占多少（左右放、上下放各记一份）
  function splitRatio(h) { var v = +localStorage.getItem("tsu-act-split-" + (h ? "h" : "v")); return v > 0.12 && v < 0.88 ? v : h ? 0.45 : 0.5; }
  document.addEventListener("pointerdown", function (e) {
    var g = e.target.closest && e.target.closest("[data-am-grip]");
    if (!g || e.button !== 0) return;
    e.preventDefault();
    var box = g.parentNode, host = g.closest(".tr-host"), h = g.dataset.amGrip === "h", r = box.getBoundingClientRect();
    host._amHold = true; g.classList.add("drag");
    var mv = function (ev) {
      var v = h ? (r.right - ev.clientX) / r.width : (r.bottom - ev.clientY) / r.height;
      v = Math.max(0.15, Math.min(0.85, v));
      localStorage.setItem("tsu-act-split-" + (h ? "h" : "v"), v.toFixed(3));
      var a = box.querySelector(".am-body"), b = box.querySelector(".am-footw");
      if (a && b) { a.style.flex = (1 - v).toFixed(3) + " 1 0"; b.style.flex = v.toFixed(3) + " 1 0"; }
    };
    var up = function () { document.removeEventListener("pointermove", mv, true); document.removeEventListener("pointerup", up, true); g.classList.remove("drag"); host._amHold = false; host._amLast = null; render(host); };
    document.addEventListener("pointermove", mv, true); document.addEventListener("pointerup", up, true);
  });
  // ---- 浮动：Agent 活动浮在窗口最上面（所有标签页之上），标题栏拖动、右下角缩放，位置大小记住；收回就回到原来的地方 ----
  var FLT = null;
  function floatOpen() {
    if (FLT) return;
    var st = (function () { try { return JSON.parse(localStorage.getItem("tsu-act-float") || "null"); } catch (e) { return null; } })() || { x: Math.max(20, innerWidth - 560), y: 80, w: 520, h: 420 };
    var box = document.createElement("div"); box.className = "am-float";
    box.style.cssText = "left:" + st.x + "px;top:" + st.y + "px;width:" + st.w + "px;height:" + st.h + "px";
    box.innerHTML = '<div class="am-fbar"><span>' + esc(tr("Agent 活动")) + '</span></div><div class="tr-host am-fhost"></div><i class="am-fres"></i>';
    document.body.appendChild(box);
    var host = box.querySelector(".am-fhost"), save = function () { var r = box.getBoundingClientRect(); localStorage.setItem("tsu-act-float", JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) })); };
    var drag = function (e, resize) {
      e.preventDefault(); var x0 = e.clientX, y0 = e.clientY, r0 = box.getBoundingClientRect();
      var mv = function (ev) { var dx = ev.clientX - x0, dy = ev.clientY - y0; if (resize) { box.style.width = Math.max(300, r0.width + dx) + "px"; box.style.height = Math.max(220, r0.height + dy) + "px"; host._amLast = null; } else { box.style.left = Math.max(0, Math.min(innerWidth - 80, r0.left + dx)) + "px"; box.style.top = Math.max(0, Math.min(innerHeight - 40, r0.top + dy)) + "px"; } };
      var up = function () { document.removeEventListener("pointermove", mv, true); document.removeEventListener("pointerup", up, true); save(); host._amLast = null; render(host); };
      document.addEventListener("pointermove", mv, true); document.addEventListener("pointerup", up, true);
    };
    box.querySelector(".am-fbar").addEventListener("pointerdown", function (e) { if (e.button === 0) drag(e, false); });
    box.querySelector(".am-fres").addEventListener("pointerdown", function (e) { if (e.button === 0) drag(e, true); });
    FLT = { box: box, host: host, t: setInterval(function () { if (!document.hidden) render(host); }, 1000) };
    localStorage.setItem("tsu-act-floating", "1");
    render(host);
  }
  function floatClose() { if (!FLT) return; clearInterval(FLT.t); FLT.box.remove(); FLT = null; localStorage.removeItem("tsu-act-floating"); }
  // 浮着的那个假窗口不再有了（用户 2026-10-13：「出来的窗口也是假的窗口」）：活动监视器是一个标签页（「App」里一格，下面）；上次浮着的记号清掉
  try { localStorage.removeItem("tsu-act-floating"); } catch (e) { /* 没有 */ }
  function openTab() {
    var S = window.STUDIO, tw = window.TSU_TERM && TSU_TERM.front ? TSU_TERM.front() : null;
    if (S && S.openPage && tw) return S.openPage(tw, "activity", "");
  }
  var last = { key: "", at: 0 };
  function renderTimeline(host) {
    var W = Math.max(360, host.clientWidth), span = spanMin(), now = Date.now(), from = now - span * 60000;
    // 只画这段时间里真的干过活的（有调用、有一问、有后台任务，或者现在正在跑）；在跑的在上面，其余按最近一次动静排
    var rts = runtimes(), groups = rts.map(function (rt) { var d = collect(rt, from, now); d.rt = rt; d.lastAt = Math.max(0, d.bars.length ? d.bars[d.bars.length - 1].t1 : 0, d.turns.length ? d.turns[d.turns.length - 1].e : 0); return d; })
      .filter(function (d) { return d.rt.stream || d.bars.length || d.turns.length || d.bg.some(function (b) { return b.run || b.t1 >= from; }); })
      .sort(function (a, b) { return (b.rt.stream ? 1 : 0) - (a.rt.stream ? 1 : 0) || b.lastAt - a.lastAt; });
    // 没东西就不必每秒重画；在跑的有条在长，按时间段决定多久重画一次（10 分钟 1 秒，别的 2 秒）
    var key = W + "|" + span + "|" + groups.map(function (g) { return g.rt.agent.id + ":" + g.bars.length + ":" + g.bg.length + ":" + g.marks.length; }).join(",");
    if (key === last.key && now - last.at < (span <= 10 ? 950 : 1950)) return;
    last = { key: key, at: now };
    var X = function (t) { return LBL + (t - from) / (now - from) * (W - LBL - PAD); };
    var sw = function (c) { return '<span><i style="background:' + c + '"></i>'; };
    var bar = topBar(host, '<div class="tr-seg">' + SPANS.map(function (x) { return '<button type="button" class="tr-sp' + (x[0] === span ? " on" : "") + '" data-trs="' + x[0] + '">' + x[1] + "</button>"; }).join("") + "</div>") + '<div class="tr-bar">' +
      '<div class="tr-legend">' + Object.keys(KIND).filter(function (k) { return k !== "other"; }).map(function (k) { return '<span><i style="background:' + KIND[k].c + '"></i>' + esc(tr(KIND[k].n)) + "</span>"; }).join("") + '<span><i class="tr-lask">▼</i>' + esc(tr("用户消息")) + '</span><span><i class="tr-lcmp">◆</i>' + esc(tr("上下文压缩")) + '</span><span><i class="tr-lturn"></i>' + esc(tr("回合")) + '</span><span><i class="tr-lbgi"></i>' + esc(tr("后台任务")) + "</span></div></div>";
    if (!groups.length) { host.innerHTML = bar + '<div class="st-dim tr-empty">' + esc(tr(rts.length ? "这段时间里没有会话在工作" : "没有打开的会话")) + "</div>"; return; }
    // 纵向：每组 = 名字那一行的高度和「工具几行 + 后台一行」取大的
    var y = AXIS + 4, parts = [], grid = [];
    // 刻度：按时间段取合适的间隔
    // 刻度的间隔按宽度挑：两个刻度之间至少 48px（窄的面板里 24 小时不再挤成「20:0000:0004:00…」）；离「现在」太近的不写字
    var pxPerMs = (W - LBL - PAD) / (now - from), step = [60000, 300000, 600000, 1800000, 3600000, 7200000, 14400000, 21600000, 43200000].filter(function (st) { return st * pxPerMs >= 48; })[0] || 86400000, t0 = Math.ceil(from / step) * step;
    for (var tt = t0; tt < now; tt += step) { var gx = X(tt); grid.push('<line class="tr-grid" x1="' + gx + '" x2="' + gx + '" y1="' + AXIS + '" y2="100%"/>' + (X(now) - gx > 34 ? '<text class="tr-tick" x="' + gx + '" y="12">' + hhmm(tt) + "</text>" : "")); }
    groups.forEach(function (g, gi) {
      var a = g.rt.agent, id = a.id, cn = /^cc:/.test(id) ? "cc" : /^cx:/.test(id) ? "cx" : "pm", nL = laneOut(g.bars, 4), bgL = g.bg.length ? laneOut(g.bg, 4) : 0;
      var h = Math.max(50, nL * (ROW + LGAP) + (bgL ? bgL * (BGH + 2) + 4 : 0) + 8), top = y;
      var name = String(a.name || id).slice(0, 40), st = g.rt.stream ? "busy" : "idle";
      // 左边两行小字（放在名字那一栏里，不压到右边的条）——以前是「100% 忙 · 24 次调用 · 最长 Bash 3m」，看了也不知道它在干嘛：
      //   第一行：在跑的写这一问跑了多久（同 Claude Code 的转圈那一行），闲着的写闲了多久；第二行：正在做的那一条（没在做就是最后做的那条）
      var liveT = g.turns.filter(function (t) { return t.live; })[0], runB = g.bars.filter(function (b) { return b.run; }).pop(), lastB = g.bars[g.bars.length - 1];
      var sum = g.rt.stream ? stTxt("run") + " " + dur(now - (g.rt.stream.t0 || (liveT && liveT.at) || now)) + " · " + g.bars.length + " " + tr("次调用") : stTxt("idle") + (g.lastAt ? " " + dur(now - g.lastAt) : "") + " · " + g.bars.length + " " + tr("次调用");
      var cur0 = runB || lastB, sum2 = cur0 ? (runB ? tr("正在") + "：" : tr("最近") + "：") + fit(trT(what(cur0.p), id), LBL - 24, 10.5) : "";
      parts.push('<g class="tr-grp ' + st + '" data-tra="' + esc(id) + '"><rect class="tr-hit" x="0" y="' + top + '" width="' + W + '" height="' + h + '"/>' +
        (gi ? '<line class="tr-sep" x1="0" x2="' + W + '" y1="' + top + '" y2="' + top + '"/>' : "") +
        '<text class="tr-name ' + cn + '" x="8" y="' + (top + 15) + '">' + esc(name) + "</text>" +
        '<text class="tr-sum" x="8" y="' + (top + 29) + '">' + esc(sum) + "</text>" + (sum2 ? '<text class="tr-sum" x="8" y="' + (top + 42) + '">' + esc(sum2) + "</text>" : "") +
        '<rect class="tr-lblbg" x="' + (LBL - 6) + '" y="' + top + '" width="6" height="' + h + '"/>');
      // 一问一问的底色
      g.turns.forEach(function (t) { var x1 = X(t.s), x2 = Math.max(x1 + 1, X(t.e)); parts.push('<rect class="tr-turn' + (t.live ? " live" : "") + '" x="' + x1 + '" y="' + (top + 3) + '" width="' + (x2 - x1) + '" height="' + (h - 6) + '" rx="3"/>'); });
      // 工具调用
      g.bars.forEach(function (b) {
        if (b.l < 0) return;
        var x1 = X(b.s), x2 = Math.max(x1 + 2, X(b.e)), by = top + 5 + b.l * (ROW + LGAP);
        parts.push('<rect class="tr-b' + (b.run ? " run" : "") + (b.err ? " err" : "") + '" x="' + x1.toFixed(1) + '" y="' + by + '" width="' + (x2 - x1).toFixed(1) + '" height="' + ROW + '" rx="2" fill="' + KIND[b.k].c + '"><title>' + esc(toolTip(b)) + "</title></rect>");
        // 放得下字的条：里面写它在干什么（+ 用时）——不用一条条指着看
        if (x2 - x1 >= 56) parts.push(inBar("tr-bt", x1, by, x2 - x1, ROW, 11, fit(trT(what(b.p), id) + " · " + dur(b.t1 - b.t0), x2 - x1 - 4, 10)));
      });
      // 后台命令、子 Agent：细条
      g.bg.forEach(function (b) {
        if (b.l < 0) return;
        var x1 = X(b.s), x2 = Math.max(x1 + 2, X(b.e)), by = top + 5 + nL * (ROW + LGAP) + 2 + b.l * (BGH + 2);
        parts.push('<rect class="tr-bg' + (b.run ? " run" : "") + '" x="' + x1.toFixed(1) + '" y="' + by + '" width="' + (x2 - x1).toFixed(1) + '" height="' + BGH + '" rx="3" fill="' + KIND[b.k].c + '" stroke="' + KIND[b.k].c + '"><title>' + esc(bgTip(b)) + "</title></rect>");
        // 后台的也写上是什么（以前只是一根细线，贯穿整段，看不出是啥）
        // 不再每条前面写「后台：」（这一行本来就是后台的；指着看提示里有）
        if (x2 - x1 >= 56) parts.push(inBar("tr-bgt", x1, by, x2 - x1, BGH, 9, fit(String(b.x.desc || b.x.cmd || "").replace(/\s+/g, " ") + " · " + dur(b.t1 - b.t0), x2 - x1 - 4, 9.5)));
      });
      // 同时在跑的太多、没画出来的：后台那几行左边一个「+n」
      if (g.bg.hidden) parts.push('<text class="tr-more" x="' + (LBL - 10) + '" y="' + (top + 5 + nL * (ROW + LGAP) + 2 + (bgL - 1) * (BGH + 2) + 9) + '" text-anchor="end"><title>' + esc(tr("同时在跑的后台任务太多，还有") + " " + g.bg.hidden + " " + tr("个没画出来")) + "</title>+" + g.bg.hidden + "</text>");
      // 记号：你的一句话（▼）、压缩（◆）
      g.marks.forEach(function (m) {
        var mx = X(m.at);
        parts.push(m.k === "ask" ? '<path class="tr-ask" d="M' + (mx - 4) + " " + (top + 1) + " L" + (mx + 4) + " " + (top + 1) + " L" + mx + " " + (top + 7) + ' Z"><title>' + esc(tr("用户消息") + "：" + m.tip) + "</title></path>"
          : '<path class="tr-cmp" d="M' + mx + " " + (top + h / 2 - 5) + " L" + (mx + 5) + " " + (top + h / 2) + " L" + mx + " " + (top + h / 2 + 5) + " L" + (mx - 5) + " " + (top + h / 2) + ' Z"><title>' + esc(m.tip) + "</title></path>");
      });
      parts.push("</g>");
      y += h;
    });
    var H = y + 6, nowX = X(now) - 0.5;
    var svg = '<svg class="tr-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '">' + grid.join("") +
      '<line class="tr-now" x1="' + nowX + '" x2="' + nowX + '" y1="' + (AXIS - 4) + '" y2="' + H + '"/><text class="tr-tick now" x="' + (nowX - 2) + '" y="12" text-anchor="end">' + esc(tr("现在")) + "</text>" + parts.join("") + "</svg>";
    host.innerHTML = bar + '<div class="tr-scroll">' + svg + "</div>";
  }
  // 点：换时间段、点一组切到那个会话
  document.addEventListener("click", function (e) {
    var fl = e.target.closest && e.target.closest("[data-am-float]");
    if (fl) { floatOpen(); return; }
    var ufl = e.target.closest && e.target.closest("[data-am-unfloat]");
    if (ufl) { floatClose(); return; }
    var sy = e.target.closest && e.target.closest("[data-amsys]");
    if (sy) { localStorage.setItem("tsu-act-sys", sy.dataset.amsys); rerenderSys(); return; }
    var sl = e.target.closest && e.target.closest("[data-amsel]");
    if (sl) { if (sl.dataset.amsel === "disk") localStorage.setItem("tsu-act-disk", diskMode() === "io" ? "data" : "io"); else localStorage.setItem("tsu-act-net", netMode() === "pk" ? "data" : "pk"); rerenderSys(); return; }
    var mm = e.target.closest && e.target.closest("[data-amm]");
    if (mm) { localStorage.setItem("tsu-act-mode", mm.dataset.amm); rerenderAll(); return; }
    var so = e.target.closest && e.target.closest("[data-ams]");
    if (so) { var k = so.dataset.ams; SORT = SORT.k === k ? { k: k, d: -SORT.d } : { k: k, d: 1 }; localStorage.setItem("tsu-act-sort", JSON.stringify(SORT)); var h1 = so.closest(".tr-host"); if (h1) { h1._amLast = null; render(h1); } return; }
    var mv = e.target.closest && e.target.closest("[data-am-move]");
    if (mv) { if (window.STUDIO && STUDIO.moveActivity) STUDIO.moveActivity(mv.dataset.amMove); return; }
    var sp = e.target.closest && e.target.closest("[data-trs]");
    if (sp) { localStorage.setItem("tsu-trace-span", sp.dataset.trs); rerenderAll(); return; }
    var g = e.target.closest && e.target.closest(".tr-grp[data-tra], .am-tr[data-tra], .am-crow[data-tra]");
    if (g) { var hh = g.closest(".tr-host"); if (hh && !g.classList.contains("tr-grp")) { var o = hh._open || (hh._open = {}); if (o[g.dataset.tra]) delete o[g.dataset.tra]; else o[g.dataset.tra] = 1; hh._amLast = null; render(hh); } else if (window.TSU_TERM && TSU_TERM.agent) TSU_TERM.agent(g.dataset.tra); } // 列表里点一个会话：就地展开它的进程（再点收起）；右键打开它；时间线里点：打开它
  });
  // 右键一个会话：打开它（打开会话）——左键是看它的资源
  document.addEventListener("contextmenu", function (e) {
    var g = e.target.closest && e.target.closest(".am-tr[data-tra], .am-crow[data-tra]");
    if (!g) return;
    var id = g.dataset.tra;
    if (!id || !window.STUDIO || !STUDIO.menu) return;
    e.preventDefault(); e.stopPropagation();
    STUDIO.menu([{ label: tr("打开会话"), run: function () { if (window.TSU_TERM && TSU_TERM.agent) TSU_TERM.agent(id); } }], { x: e.clientX, y: e.clientY });
  }, true);
  // 给 Paimon（全局助手的 AgentActivity 工具）、别的地方读：现在每个打开着的会话的样子 + 最近的 CPU 负载
  function snapshot() {
    sample(true);
    var now = Date.now(), openIds = {};
    try { (window.TSU_TERM && TSU_TERM.panes ? TSU_TERM.panes() : []).forEach(function (p) { var i = p && p.program && p.program.agentId; if (i) openIds[i] = 1; }); } catch (e) { /* 没有就算了 */ }
    var rows = runtimes().map(function (rt) { return rowOf(rt, now); }).filter(function (r) { return openIds[r.id] || r.status !== "idle"; });
    return {
      at: new Date(now).toISOString(),
      agents: rows.map(function (r) { return { id: r.id, name: r.name, connector: { cc: "claude-code", cx: "codex", pm: "paimon" }[r.conn], status: { run: "running", wait: "waiting-for-you", idle: "idle" }[r.status], doing: r.doing || null,
        runningForSec: r.status !== "idle" && r.ms ? Math.round(r.ms / 1000) : null, idleForSec: r.status === "idle" && r.ms ? Math.round(r.ms / 1000) : null, toolCallsThisTurn: r.calls, contextPct: r.ctx, backgroundTasksRunning: r.bg,
        cpuPct: r.cpu == null ? null : Math.round(r.cpu * 10) / 10, memMB: r.mem == null ? null : Math.round(r.mem / 1048576), processes: r.procs }; }),
      cpuHistory: PS.hist.slice(-40).map(function (x) { return { at: new Date(x.t).toISOString(), cpuPct: Math.round(x.cpu * 10) / 10, memMB: Math.round(x.mem / 1048576), gpuPct: x.gpu == null ? null : x.gpu }; }),
      note: "cpuPct / memMB / processes add up each Claude Code session's own process and everything it started (commands, dev servers). Codex sessions share one background service, so they show null.",
    };
  }
  // 以前单独的「系统资源」视图：现在并进 Agent 活动（同活动监视器：页签、会话、底下一条）；留着这个入口，画的是同一个
  function renderSys(host) { if (host) { host._amLast = null; render(host); } }
  function rerenderSys() { document.querySelectorAll(".tr-host").forEach(function (h) { h._amLast = null; render(h); }); }
  // 面板标题栏右边的按钮：列表 / 时间线、时间线的时间段、浮动、挪到右侧栏
  function headActs() {
    var m = modeOf(), sp = spanMin();
    return '<span class="am-hacts"><span class="tr-seg">' + [["table", "列表"], ["timeline", "时间线"]].map(function (x) { return '<button type="button" class="tr-sp' + (x[0] === m ? " on" : "") + '" data-amm="' + x[0] + '">' + esc(tr(x[1])) + "</button>"; }).join("") + "</span>" +
      (m === "timeline" ? '<span class="tr-seg">' + SPANS.map(function (x) { return '<button type="button" class="tr-sp' + (x[0] === sp ? " on" : "") + '" data-trs="' + x[0] + '">' + x[1] + "</button>"; }).join("") + "</span>" : "") +
      '<button type="button" class="st-hbtn am-move" data-am-float="1" title="' + esc(tr("浮动显示（在所有标签页上面，可拖动、缩放）")) + '">' + FLOAT_ICO + '</button><button type="button" class="st-hbtn am-move" data-am-move="side" title="' + esc(tr("挪到右侧栏")) + '">' + MOVE_RIGHT + "</button></span>";
  }
  function rerenderAll() { document.querySelectorAll(".tr-host").forEach(function (h) { h._amLast = null; render(h); }); last.key = ""; if (window.STUDIO && STUDIO.renderPanelAll) STUDIO.renderPanelAll(); }
  window.TSU_TRACE = { render: render, renderSys: renderSys, snapshot: snapshot, sample: sample, float: openTab, unfloat: floatClose, headActs: headActs, open: openTab };
  // ---- 活动监视器：一个标签页——每个会话一行（在做什么、用时、CPU、内存、进程、上下文）；整机的数在状态栏右边 ----
  var AM_LOGO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3.5" width="18" height="17" rx="3"/><path d="M6.5 13h2.6l1.9-4.6 2.6 8.2 1.9-3.6h2"/></svg>';
  if (window.STUDIO && STUDIO.pages) STUDIO.pages.activity = {
    title: function () { return tr("活动监视器"); },
    address: function () { return "activity.local.paimon"; },
    icon: function () { return AM_LOGO; },
    render: function (host) {
      host.classList.add("tr-host", "st-pg-activity");
      host._amLast = null;
      render(host);
    },
    detach: function () {},
  };
  // 「App」里一格（apps.js 在后面才载入：页面载完再登记）
  window.addEventListener("load", function () {
    var S = window.STUDIO;
    if (S && S.apps && S.apps.add) S.apps.add({
      id: "activity", builtin: true, name: function () { return tr("活动监视器"); },
      logo: function () { return AM_LOGO; },
      find: function (tw) { var hit = null; (tw && tw.ws && tw.ws.all ? tw.ws.all() : []).forEach(function (p) { if (!hit && p.program && p.program.page === "activity") hit = p; }); return hit; },
      open: function (tw) { return S.openPage(tw, "activity", ""); },
    });
  });
  setInterval(function () { if (document.hidden) return; document.querySelectorAll(".tr-host.am-amhost").forEach(function (h) { render(h); }); }, 1000); // 底下那一条每秒一新（数据每秒一帧）
})();
