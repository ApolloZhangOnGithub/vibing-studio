// studio.js —— Vibe Code Studio：用户怎么看、怎么控制一个 coding agent（和 agent 怎么跑解耦；装它们的是 Terminal-Coding-Browser，见 browser.js）。
// 外观守 TUI 的规矩：等宽字、终端的颜色、Claude Code 那套符号（⏺ ⎿ ✻ ◼ ◻ ✔ ❯）；GUI 给的是交互的自由——每个部件都能拖动调整、能关、能点、能滚。
// 结构学 VS Code：编辑区（标签页：终端、agent、文件、设置…）· 右侧栏（一节一节能折叠：视图、任务、状态、上下文）· 下面板（终端，⌘J）· 状态栏
//   · 命令面板（⇧⌘P）· 快速打开（⌘P）· 设置是个标签页（⌘,，样子同 Claude Code 的 /config）· 文件在标签页里打开（默认只看，「编辑」才改）
// 「元素」：页面交出有类型的数据，放在哪由用户定：行内（页面自己画在正文里）· 状态栏 · 右侧栏 · 隐藏（按「站点:元素」记在本机）
//   三条路交元素：HTML 页面（paimon.code）STUDIO.set(面板, 元素)；任何终端程序 OSC 7700（ESC ] 7700 ; base64(JSON) BEL，
//   JSON = { v:1, op:"set", el } | { op:"remove", id } | { op:"clear" }；shell 里有 TCB=1，命令行里用 tcb）；改不了的程序（Claude Code）走适配层，
//   读它写在磁盘上的（~/.claude/tasks/<会话>/*.json、sessions、会话记录）
// 元素：{ id, type, title?, data, site?, events? }，type：
//   tasks { items: [{ id, subject, status: pending | in_progress | completed, activeForm? }] } · status { busy, label, t0?, detail? }
//   context { tokens, window, model? } · kv { rows: [[键, 值]] } · form { fields: [{ key, label, desc?, kind: "seg" | "toggle", options?: [[值, 名]], value } | { head }] }
(function () {
  "use strict";
  var root = document.documentElement;
  var LOC = function () { return window.TSU_LOCAL; };
  // 设置文件（~/.paimon/studio.json）用哪一份：iPad 借 Mac 用时（remote.js）不读写 Mac 上那份——iPad 的字号、配色、布局记在 iPad 自己这里（同网页版），不去改 Mac 的
  var SLOC = function () { var N = window.nadosNative; return N && N.remote ? null : LOC(); };
  // App 里连着另一台 Mac 的窗口（remote.js 的 hybrid）：设置是这台的（字号、配色、风格跟着人走），~/.paimon/studio.json 经这台 App 的桥读写（TSU_HOSTLOCAL）
  var HYB = function () { var N = window.nadosNative; return !!(N && N.hybrid); };
  var FLOC = function () { return HYB() ? window.TSU_HOSTLOCAL || null : SLOC(); };
  var T = function () { return window.TSU_TERM; };
  // Claude Code 的支持是扩展（ext.js）：默认不装；没装时这里跟它有关的（设置那一区、搜索它的会话、终端里 claude 的状态）都不出现
  var ccOn = function () { return !!(window.TSU_EXT && TSU_EXT.on("claude-code")); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var home = function () { var i = LOC() && LOC().info(); return i ? i.home : ""; };
  var tilde = function (p) { var h = home(); return h && (p === h || String(p).indexOf(h + "/") === 0) ? "~" + p.slice(h.length) : p; };
  var dur = function (ms) { var s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60), h = Math.floor(m / 60); return ms > 0 && ms < 1000 ? "<1s" : s < 60 ? s + "s" : m < 60 ? m + "m " + (s % 60) + "s" : h + "h " + (m % 60) + "m"; }; // 不到 1 秒写 <1s（同左边对话里的）
  var kfmt = function (n) { return n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "k" : String(n || 0); };
  var SPIN = ["·", "✢", "✳\uFE0E", "✶", "✻", "✽", "✽", "✻", "✶", "✳\uFE0E", "✢", "·"]; // ✳ 后面带 U+FE0E（文字样式）：iPad、iPhone 上不带的话它画成绿底的 emoji ✳️
  var spin = function () { return SPIN[Math.floor(Date.now() / 120) % SPIN.length]; };
  var termapp = function () { return root.classList.contains("termapp"); };
  var store = function (k, d) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } };
  var keep = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 满了 */ } };
  var allWins = function () { return T() && T().wins ? T().wins().filter(function (w) { return w.open; }) : []; };
  var allPanes = function () { return T() && T().panes ? T().panes() : []; };

  // ======== 放在哪：行内 · 状态栏 · 右侧栏 · 隐藏 ========
  var SLOTS = [["inline", "行内"], ["status", "状态栏"], ["side", "辅助侧栏"], ["hidden", "隐藏"]];
  var DEFAULT = { "paimon:tasks": "inline", "paimon:status": "inline", "paimon:view": "hidden", "claude:tasks": "status", "claude:status": "status", "claude:context": "status", "claude:view": "hidden" };
  var pref = store("st-slots", null);
  if (!pref) { // 旧的（底栏 / 检查器）换成新名字
    pref = {};
    var old = store("vs-slots", {});
    Object.keys(old).forEach(function (k) { pref[k] = { footer: "status", inspector: "side" }[old[k]] || old[k]; });
  }
  var SLOTP = {}; // 预览：菜单里指着「放进右侧栏」那一项时临时换的位置（不存）
  function slotOf(site, id, real) {
    var k = site + ":" + id, s = (!real && SLOTP[k]) || pref[k] || DEFAULT[k] || "status";
    if (s === "inline" && site !== "paimon") s = "status"; // 行内只有自己画正文的页面（paimon.code）才有
    if (k === "paimon:tasks" && s === "status") s = "drawer"; // agent 的任务清单不放全局的状态栏了：以前放那儿的算「Agent 底部抽屉」
    return s;
  }
  function place(site, id, slot) {
    pref[site + ":" + id] = slot;
    keep("st-slots", pref);
    placed(site, id);
  }
  function placed(site, id) {
    allPanes().forEach(function (p) { if (p.els && p.els[id] && p.els[id].site === site && p.renderNow) p.renderNow(); });
    allWins().forEach(renderSoon);
    if (site === "paimon" && id === "tasks") familyChanged();
  }
  // ======== agent 这一级的「任务」一家子：任务清单、后台任务、子 Agent。位置定死（有规律才好找，不让人挪）：
  //   VS Code 风格——辅助侧栏的 Agent 那一层；Claude App——右边「后台任务 · <agent>」卡片；macOS 的窗口、Pure Terminal——这个标签页最下面（tdrawer.js）。
  //   每一块单独显示 / 隐藏（设置 › 对话 › 显示、对话 ··· › 显示；任务清单还有 ⌃T）；每一块的标题行点一下收起（只剩标题：进度、正在做的那一项）、再点展开，按 agent 记着。
  //   终端界面、图形界面一样；Paimon 的 agent 和连接器的会话（Claude Code、Codex）一样 ========
  function familyHost() { return root.classList.contains("st-os-claude") ? "card" : /\bst-(macos|os-terminal)\b/.test(root.className) ? "drawer" : "side"; }
  // 任务翻译（translate.js；设置 › 对话 › 任务翻译）：显示译文，原文放在 title 里；ctx = 哪个 agent 的（同一个 agent 的一起翻，用词一致）
  var trT = function (s, ctx) { return s && window.TSU_TRANSLATE ? TSU_TRANSLATE.text(s, ctx) : s; };
  var trTitle = function (t, s) { return t !== s ? ' title="' + esc(String(s)) + '"' : ""; };
  var acfg = function () { return (window.TSU_AGENTS && TSU_AGENTS.cfg) || {}; };
  // ⌃T：这个 agent 的任务清单这次显示还是不显示（同 Claude Code：不存，默认按「任务清单」开关）。显示时那块地方关着就打开（辅助侧栏 / 卡片）
  var TODO_T = {};
  function todoShown(aid) { if (aid && aid in TODO_T) return TODO_T[aid]; return acfg().taskList !== false; }
  function toggleTodo(aid) { var v = !todoShown(aid); if (aid) TODO_T[aid] = v; if (v) revealFamily(); familyChanged(); return v; }
  // 标题行：这一块收起 / 展开（存；按 agent + 哪一块）。收起、展开是换 class（高度动画），不重画
  var FFOLD = store("st-ffold", {});
  var famFolded = function (aid, sec) { return !!FFOLD[aid + ":" + sec]; };
  function toggleFamFold(aid, sec) { var k = aid + ":" + sec; if (FFOLD[k]) delete FFOLD[k]; else FFOLD[k] = 1; keep("st-ffold", FFOLD); applyFold(document); }
  function applyFold(box) { if (box && box.querySelectorAll) { box.querySelectorAll(".st-fsec[data-aid]").forEach(function (x) { x.classList.toggle("folded", famFolded(x.dataset.aid, x.dataset.sec)); }); tickDurs(box); } }
  // 在跑的后台任务、子 Agent 用了多久：每秒就地改那几个字（「任务」一家子、Agent 活动；HTML 不变就不重画）
  function tickDurs(box) { (box || document).querySelectorAll(".st-tick[data-t0]").forEach(function (e) { var t0 = +e.dataset.t0, t = t0 ? dur(Date.now() - t0) : ""; if (e.textContent !== t) e.textContent = t; }); }
  setInterval(function () { if (!document.hidden) tickDurs(document); }, 1000);
  var TDONE = false; // 清单里做完的那些：收成一行「n 项已完成」，点开看
  var FDONE = {}; // 后台任务、子 Agent 里跑完的那些：aid:bg / aid:sub → 展开着
  function toggleTodoDone() { TDONE = !TDONE; familyChanged(); }
  var TDET = {}; // 点开看详情的后台任务 / 子 Agent（agent:任务）：就地展开命令、输出、结果
  // 这个面板的任务清单：终端界面交出来的元素；别的（图形界面、连接器的会话）按运行时现拿。还有没做完的才算（同 Claude Code：全做完就不显示）
  function tasksOf(P) {
    var el = P && P.els && P.els.tasks;
    if (el && (el.site || "paimon") === "paimon") return (el.data && el.data.items) || [];
    var pr = P && P.program, aid = pr && pr.agentId, rt = null;
    if (!aid || !window.TSU_AGENTS) return [];
    try { rt = TSU_AGENTS.runtime(aid); } catch (e) { rt = null; }
    var it = rt && rt.todo ? rt.todo() || [] : [];
    // 全做完了也列着（收成「n 项已完成」，点开看历史）：入口不因为做完就没了
    return it.map(function (x) { return { id: x.id, subject: x.subject, status: x.status, activeForm: x.activeForm }; });
  }
  var TWRAP = {}; // 任务清单里点开换行的那几项（agent:id）
  var todoHead = function (it) { var d = it.filter(function (x) { return x.status === "completed"; }).length, g = it.filter(function (x) { return x.status === "in_progress"; }).length; return "任务 · " + d + " 完成 · " + g + " 进行中 · " + (it.length - d - g) + " 待办"; };
  // 清单的一行行：在做的在前、没开始的其次，做完的收成「n 项已完成」
  function todoRowsHtml(it, aid) {
    var done = it.filter(function (x) { return x.status === "completed"; }), doing = it.filter(function (x) { return x.status === "in_progress"; }), open = it.filter(function (x) { return x.status !== "completed" && x.status !== "in_progress"; });
    var row = function (x) {
      // 字形同 Claude Code 的任务清单：■ 进行中（橙）、◻ 待办（灰）、✔ 完成（绿，划掉）——▶ 是后台任务在跑，不用在这里
      // 放不下的：点一下换行展开全文，再点一下收回（按 agent + 这一项记着，重画也不丢）
      var d = x.status === "completed", g = d ? "✔" : x.status === "in_progress" ? "■" : "◻", t0 = x.subject || x.activeForm || "", t = trT(t0, aid), ti = trTitle(t, t0), wk = aid + ":" + (x.id || t0), wr = !!TWRAP[wk];
      return '<div class="st-todoi ' + (d ? "done" : x.status === "in_progress" ? "doing" : "open") + (wr ? " wrap" : "") + '" data-st="todo-wrap-' + esc(wk) + '"><i class="st-tg ' + (d ? "st-tgok" : x.status === "in_progress" ? "st-tgdo" : "st-dim") + '">' + g + "</i>" + (d ? '<s class="st-cut"' + ti + ">" + esc(t) + "</s>" : '<span class="st-cut"' + ti + ">" + esc(t) + "</span>") + "</div>";
    };
    return '<div class="st-todo">' + doing.concat(open).map(row).join("") + (done.length ? '<div class="st-todoi st-tdone" data-st="tasks-done"><i class="st-dchev' + (TDONE ? " open" : "") + '"></i><span>' + esc(done.length + " 项已完成") + "</span></div>" + (TDONE ? done.map(row).join("") : "") : "") + "</div>";
  }
  // 正在运行（前台）：左边对话里最后那一块工具调用（同一套标题、计数、收起，跟「后台任务」「子 Agent」一样）
  var FG_SKIP = /^(Agent|Task|TodoWrite|TaskCreate|TaskUpdate|TaskGet|TaskList|TaskStop|TaskOutput|SendMessage|ToolSearch|AskUserQuestion)$/;
  var isFg = function (p) { return !!p && p.kind === "tool" && !p.asyncLaunched && !(p.input && p.input.run_in_background) && !FG_SKIP.test(p.name); };
  var fgKey = function (p) { return p.id || String(p.t0 || ""); };
  // 真的还在跑：状态是 running，而且在正在答的这一问里（会话重读、这一问已经完了还挂着 running 的，算跑完）
  var fgRun = function (p, rt) { var tt = rt && rt.stream && rt.stream.turn; return p.status === "running" && !!(tt && tt.parts && tt.parts.indexOf(p) >= 0); };
  // 同左边（live.js 的 Claude Code 风格）怎么分块：连着的读、搜、列、命令、MCP 并成一组（「Ran 3 shell commands」那一组），改文件、Fetch 这些单独一块；
  //   任务清单那几个不打断一组，子 agent、SendMessage、ToolSearch 这些打断；中间有话（不是工具）也打断。列的就是最后那一块的每一条
  var FG_GRP = function (p) { return (p.name === "Read" || p.name === "Grep" || p.name === "Glob" || p.name === "LS" || /^mcp__/.test(p.name) || (p.name === "Bash" && !p.sys)) && !(p.edits && p.edits.length); };
  var FG_ABS = /^(TodoWrite|TaskCreate|TaskGet|TaskList|TaskUpdate)$/;
  function fgBlock(parts) {
    var last = [], cur = [], close = function () { if (cur.length) last = cur; cur = []; };
    (parts || []).forEach(function (p) {
      if (!p || p.kind !== "tool") return close();
      if (FG_ABS.test(p.name)) return;
      if (FG_SKIP.test(p.name)) return close();
      if (FG_GRP(p)) return void cur.push(p);
      close(); last = [p];
    });
    close();
    return last;
  }
  // 这一问还没调用过工具（在想、在写话）：留着上一问最后那一块
  function fgBatch(aid, rt) {
    var tt = rt.stream && rt.stream.turn, b = tt && tt.parts ? fgBlock(tt.parts) : [];
    if (!b.length && rt.session) { var ts0 = rt.session().turns || []; for (var i = ts0.length - 1; i >= 0 && !b.length; i--) if (ts0[i] !== tt) b = fgBlock(ts0[i].parts); }
    return b;
  }
  // 标题同左边那一条：命令写它的说明（没有就命令第一行），读、列写路径（调用时所在目录里的写相对的，家目录下的 ~/…），搜写「"模式"」
  var fgPath = function (fp, cwd) {
    fp = String(fp || ""); cwd = String(cwd || "").replace(/\/+$/, "");
    if (cwd && fp.indexOf(cwd + "/") === 0) return fp.slice(cwd.length + 1);
    var li = window.TSU_LOCAL && TSU_LOCAL.info ? TSU_LOCAL.info() : null, home = li && li.home;
    return home && fp.indexOf(home + "/") === 0 ? "~" + fp.slice(home.length) : fp;
  };
  function fgTitle(p, rt) {
    var a = p.input || {}, cwd = p.cwd || (rt && rt.session && rt.session().cwd) || "";
    if (p.name === "Bash") return String(a.description || String(a.command || "").split("\n")[0]).replace(/\s+/g, " ").trim();
    if (p.name === "Grep" || p.name === "Glob") return '"' + String(a.pattern || "").replace(/\s+/g, " ").trim() + '"';
    var f = a.file_path || a.notebook_path || a.path;
    if (f) return fgPath(f, cwd);
    return String(a.url || a.query || a.description || a.prompt || p.name).replace(/\s+/g, " ").trim();
  }
  function famData(P) {
    var pr = P && P.program, aid = pr && pr.agentId, rt = null;
    if (!aid || !window.TSU_AGENTS) return null;
    try { rt = TSU_AGENTS.runtime(aid); } catch (e) { rt = null; }
    if (!rt) return null;
    var c = acfg(), ts = rt.tasks || [];
    // 正在前台跑的（这一问里还没结果的工具调用）：不是后台任务、不是任务清单；子 agent 在「子 Agent」里，管任务清单的那几个不算
    var fg = fgBatch(aid, rt), fgOn = /^c[cx]:/.test(aid) || fg.length > 0; // 连接器的会话：「正在运行」一直在（没在跑时留着上一批）
    // 进到子 agent 里看（只读的标签页）：右边是它的主 agent（点一下回去）和主 agent 的其它子 agent（它自己那一行标出来）——关系是相互的
    var par = rt.info && rt.info.sub && rt.info.parent ? String(rt.info.parent) : "";
    if (par) {
      var prt = null; try { prt = TSU_AGENTS.runtime("cc:" + par); } catch (e) { prt = null; }
      var sibs = prt && c.subList !== false ? (prt.tasks || []).filter(function (x) { return x.kind !== "shell"; }).sort(taskOrder) : [];
      return { aid: aid, fg: fg, fgOn: fgOn, goal: null, todo: [], sh: [], sa: sibs, main: { sid: par, rt: prt, me: String(rt.sid || "").replace(/^sub-/, "") } };
    }
    return { aid: aid, fg: fg, fgOn: fgOn, goal: rt.agent && rt.agent.goal && rt.agent.goal.text ? rt.agent.goal : null, todo: c.taskList !== false && todoShown(aid) ? tasksOf(P) : [], sh: c.bgList === false ? [] : ts.filter(function (x) { return x.kind === "shell"; }).sort(taskOrder), sa: c.subList === false ? [] : ts.filter(function (x) { return x.kind !== "shell"; }).sort(taskOrder) };
  }
  // 一条后台任务 / 子 Agent 的详情（点那一行就地展开）：命令或任务说明、最后的输出 / 结果
  // 连接器的会话（rt.taskDetail：Claude Code 的后台命令读它的输出文件、子 agent 读它自己的记录，只读）：读回来就重画，在跑的每 2 秒再读一次；
  // 什么都读不到时写为什么（没记下输出文件、文件不在了……），不是一句「还没有输出」
  var TDC = {}, tdcT = 0;
  var tkey = function (x) { return (x && (x.id || x.toolUseId)) || ""; }; // 一条任务的键：它的 ID；没拿到 ID 的（没在后台起来的命令）用那次工具调用的 id
  function tdRt(aid) { try { return window.TSU_AGENTS ? TSU_AGENTS.runtime(aid) : null; } catch (e) { return null; } }
  function tdFetch(aid, id) {
    var k = aid + ":" + id, c = TDC[k] || (TDC[k] = { aid: aid, id: id, at: 0, busy: false, d: null }), rt = tdRt(aid);
    if (c.busy || !rt || !rt.taskDetail) return;
    c.busy = true; c.at = Date.now();
    rt.taskDetail(id).then(function (d) { c.busy = false; var was = JSON.stringify(c.d); c.d = d || { why: "找不到这条任务" }; if (JSON.stringify(c.d) !== was && TDET[k]) familyChanged(); }, function (e) { c.busy = false; c.d = { why: "读不了：" + (e && e.message || e) }; if (TDET[k]) familyChanged(); });
  }
  function tdTick() {
    var ks = Object.keys(TDC).filter(function (k) { return TDET[k]; });
    if (!ks.length) { clearInterval(tdcT); tdcT = 0; return; }
    ks.forEach(function (k) { var c = TDC[k], rt = tdRt(c.aid), t = rt && (rt.tasks || []).filter(function (x) { return tkey(x) === c.id; })[0]; if (t && t.status === "running" && Date.now() - c.at > 1800) tdFetch(c.aid, c.id); });
  }
  // 输出的最后一段：滚动条停在最底下（column-reverse），同终端里看 tail
  function tdTail(text) { return '<div class="td-out" style="display:flex;flex-direction:column-reverse"><pre>' + esc(text.length > 16000 ? "…" + text.slice(-16000) : text) + "</pre></div>"; }
  function tdBody(t, d) {
    var why = d.why ? '<div class="td-none">' + esc(d.why) + "</div>" : "";
    if (t.kind === "shell") { var hasOut = (d.output || []).length; return (hasOut ? tdTail(d.output.join("\n")) : d.error ? tdTail(d.error) : "") + (d.error && !hasOut ? "" : why); } // 没起来的命令：写它为什么没起来
    var steps = (d.last || []).map(function (x) { return "· " + x.text; }).join("\n"), rep = String(d.result || t.result || d.error || "");
    // 子 agent：跑完的看它交回的报告；在跑的（还没有报告）看它最近几步
    return (rep && t.status !== "running" ? tdTail(rep) : steps ? tdTail(steps) : rep ? tdTail(rep) : "") + why;
  }
  function taskDet(t, aid) {
    var head = t.kind === "shell" ? "$ " + (t.cmd || t.desc || "") : t.prompt || t.desc || "", rt = aid ? tdRt(aid) : null, body;
    if (rt && rt.taskDetail) {
      var k0 = tkey(t), c = TDC[aid + ":" + k0];
      if (!c || (c.d && c.d.status && c.d.status !== t.status && Date.now() - c.at > 500)) tdFetch(aid, k0);
      if (!tdcT) tdcT = setInterval(tdTick, 2000);
      c = TDC[aid + ":" + k0];
      body = c && c.d ? tdBody(t, c.d) : '<div class="td-none">读取中…</div>';
    } else {
      var log = (t.log || []).slice(-10).map(function (x) { return x.text || x.summary || x.name || ""; }).filter(Boolean).join("\n"), o = String(t.result || t.error || log || "");
      body = o ? '<pre class="td-out">' + esc(o.length > 2400 ? "…" + o.slice(-2400) : o) + "</pre>" : '<div class="td-none">还没有输出</div>';
    }
    return '<div class="td-det"><pre class="td-cmd">' + esc(head.slice(0, 600)) + "</pre>" + body + "</div>";
  }
  // 画出来：一块一块（标题行 + 内容）；没有东西可画就是空字符串。收起没收起不在字符串里（放进去以后 applyFold 按记下的加 class）
  // only：只画哪几块（["todo", "bg"]：辅助侧栏在面板的 Agent 那一层开着时；["sub"]：面板的 Agent 那一层）；不给就是全部
  // ---- Teyvat 的会话：右侧栏是它自己的东西（不是 Claude Code 那一套任务清单 / 后台任务）——
  //   状态：同它的状态栏（Working / Waiting / Hibernating / Paused）、在哪儿跑；等着的写等什么、醒来要做什么（next_steps）；休眠的写几点醒、休眠时的说明
  //   意图：它给自己写的打算（MemoryData/<id>/intentions.txt，它的 intentions 工具）——编号的是待办、✓ 开头的是做完的，别的行照原样（小标题、说明）
  //   后台命令：Execute 转到后台的（Created 的那些）——在跑的走时间；跑完的收成「n 个已结束」，点一行看命令和输出 ----
  function tyFamilyHtml(P) {
    var aid = P.program.agentId, rt = null;
    try { rt = TSU_AGENTS.runtime(aid); } catch (e) { rt = null; }
    if (!rt || !rt.tyPanel) return "";
    var d = rt.tyPanel(), st = d.state || {}, now = Date.now();
    var sec = function (k, title, extra, body) {
      return '<div class="st-fsec' + (famFolded(aid, k) ? " folded" : "") + '" data-aid="' + esc(aid) + '" data-sec="' + k + '"><div class="st-fh" data-st="fam-fold" title="收起 / 展开"><i class="st-fchev"></i><span class="st-ft">' + esc(title) + "</span>" + (extra || "") +
        '</div><div class="st-fb"><div class="st-fbi">' + body + "</div></div></div>";
    };
    var fe = function (ms) { var s0 = Math.floor(Math.max(0, ms) / 1000); if (s0 < 60) return s0 + "s"; if (s0 < 3600) { var m0 = Math.floor(s0 / 60), r0 = s0 % 60; return r0 ? m0 + "m " + r0 + "s" : m0 + "m"; } return Math.floor(s0 / 3600) + "h " + Math.floor(s0 % 3600 / 60) + "m"; };
    var wrapK = function (k) { return !!TWRAP[aid + ":" + k]; };
    // 状态
    var stRows = "", where = st.mode === "bg" ? "后台运行" : st.mode === "fg" ? "在终端里运行（前台）" : "没有在运行", model = rt.model ? rt.model().id : "";
    var line = function (cls, ico, label, tail) { return '<div class="st-todoi st-tyst ' + cls + '"><i class="st-tg">' + ico + '</i><span class="st-cut">' + esc(label) + "</span>" + (tail || "") + "</div>"; };
    var note = function (k, text) { var op = wrapK(k); return '<div class="st-todoi st-tynote' + (op ? " wrap" : "") + '" data-st="todo-wrap-' + esc(aid + ":" + k) + '"><i class="st-tg"></i><span class="st-cut st-dim">' + esc(text) + "</span></div>"; };
    if (st.state === "working") {
      stRows += line("doing", "●", "Working", '<span class="st-tick st-dim" data-t0="' + ((st.work && st.work.t0) || 0) + '"></span>');
      if (st.work && st.work.act) stRows += note("act", st.work.act.verb + (st.work.tokens ? " · " + kfmt(st.work.tokens) + " tokens" : ""));
    } else if (st.state === "waiting") {
      var w = st.wait || {};
      stRows += line("open", "❄︎", w.forUser ? "Waiting for user" : "Waiting", '<span class="st-dim">' + esc(w.secs ? fe(now - (w.t0 || now)) + " / " + fe(w.secs * 1000) : "") + "</span>");
      if (w.title) stRows += note("wtitle", w.title);
      if (w.next) stRows += note("wnext", "醒来后：" + w.next);
    } else if (st.state === "hibernating") {
      var h = st.hib || {};
      stRows += line("open", "❄︎", "Hibernating", '<span class="st-tick st-dim" data-t0="' + (h.t0 || 0) + '"></span>');
      if (h.until) stRows += note("hwake", "到 " + h.until + " 醒来");
      if (h.summary) stRows += note("hsum", h.summary);
    } else if (st.state === "paused") stRows += line("open", "❄︎", "Paused", "");
    else stRows += line("open", "○", "没有在运行", "");
    stRows += '<div class="st-todoi st-tynote"><i class="st-tg"></i><span class="st-cut st-dim">' + esc(where + (model ? " · " + model : "")) + "</span></div>";
    // 意图
    var il = String(d.intentions || "").split("\n").filter(function (l) { return l.trim(); }), nDone = 0, nTodo = 0;
    var intHtml = il.map(function (l, i) {
      var t = l.trim(), done = /^[✓✅☑]\s?/.test(t), todo = /^\d+[.)]\s/.test(t), k = "int:" + i, op = wrapK(k);
      if (done) { nDone++; return '<div class="st-todoi done' + (op ? " wrap" : "") + '" data-st="todo-wrap-' + esc(aid + ":" + k) + '"><i class="st-tg st-tgok">✔</i><s class="st-cut">' + esc(t.replace(/^[✓✅☑]\s?/, "")) + "</s></div>"; }
      if (todo) { nTodo++; var m = /^(\d+)[.)]\s+([\s\S]*)$/.exec(t); return '<div class="st-todoi open' + (op ? " wrap" : "") + '" data-st="todo-wrap-' + esc(aid + ":" + k) + '"><i class="st-tg st-dim">' + esc(m[1]) + '</i><span class="st-cut">' + esc(m[2]) + "</span></div>"; }
      return '<div class="st-todoi st-tyhead' + (op ? " wrap" : "") + '" data-st="todo-wrap-' + esc(aid + ":" + k) + '"><i class="st-tg"></i><span class="st-cut">' + esc(t.replace(/^#+\s*/, "")) + "</span></div>";
    }).join("");
    // 后台命令
    var bg = (d.bg || []).map(function (q) { var dn = q.done, run = !dn && !q.lost; return { q: q, status: run ? "running" : q.lost ? "lost" : dn.err ? "error" : "done", t0: q.t0 || 0 }; });
    var bgRow = function (x) {
      var q = x.q, dn = q.done, k = "bg:" + q.recId, op = wrapK(k), title = String((q.input && q.input.title) || "").trim() || String((q.input && q.input.command) || "").split("\n")[0];
      var ico = x.status === "running" ? '<i class="st-tg st-fgdot">●</i>' : x.status === "error" ? '<i class="st-tg st-tgerr">✗</i>' : x.status === "lost" ? '<i class="st-tg st-dim">○</i>' : '<i class="st-tg st-tgok">✔</i>';
      var tail = x.status === "running" ? '<span class="st-tick st-dim" data-t0="' + x.t0 + '"></span>' : '<span class="st-dim">' + esc(x.status === "lost" ? "没有结果" : dn.sum) + "</span>";
      var det = "";
      if (op) {
        var outL = dn ? (dn.lines || []).filter(function (l, i, all) { return i < all.length - 1 || String(l).trim(); }) : [];
        det = '<div class="st-fgdet"><pre>' + esc("$ " + String((q.input && q.input.command) || "").slice(0, 4000)) + "</pre>" + '<div class="st-dim st-tyid">' + esc(q.recId) + "</div>" +
          (outL.length ? '<pre class="st-tyout">' + esc(outL.slice(-60).join("\n")) + "</pre>" : "") + "</div>";
      }
      return '<div class="st-prw st-frow' + (x.status === "running" ? " run" : " fin") + (op ? " wrap" : "") + '" data-st="todo-wrap-' + esc(aid + ":" + k) + '">' + ico + ' <span class="st-cut">' + esc(title) + '</span><span class="st-fill"></span>' + tail + "</div>" + det;
    };
    var live = bg.filter(function (x) { return x.status === "running"; }), fin = bg.filter(function (x) { return x.status !== "running"; }), fOpen = !!FDONE[aid + ":bg"];
    var bgHtml = live.map(bgRow).join("") + (fin.length ? '<div class="st-todoi st-tdone" data-st="fam-done-bg"><i class="st-dchev' + (fOpen ? " open" : "") + '"></i>' + esc(fin.length + " 个已结束") + "</div>" + (fOpen ? fin.slice().reverse().map(bgRow).join("") : "") : "");
    return '<div class="st-fam st-tyfam" data-aid="' + esc(aid) + '">' + sec("tystate", "状态", "", stRows) +
      (il.length && acfg().taskList !== false ? sec("tyint", "意图", '<span class="st-fill"></span><span class="st-dim st-fhtime">' + esc((nTodo ? nTodo + " 待办" : "") + (nTodo && nDone ? " · " : "") + (nDone ? nDone + " 完成" : "")) + "</span>", intHtml) : "") +
      (bg.length && acfg().bgList !== false ? sec("tybg", "后台命令 · " + live.length + " 运行中 · " + fin.length + " 已结束", "", bgHtml) : "") + "</div>";
  }
  function familyHtml(P, only) {
    if (P && P.program && /^ty:/.test(String(P.program.agentId || ""))) return only && only.indexOf("todo") < 0 && only.indexOf("bg") < 0 ? "" : tyFamilyHtml(P);
    var d = famData(P);
    if (d && only) { if (only.indexOf("todo") < 0) { d.todo = []; d.fg = []; d.fgOn = false; } if (only.indexOf("bg") < 0) d.sh = []; if (only.indexOf("sub") < 0) d.sa = []; }
    // 「详情」那一块（辅助侧栏 ··· 里勾上才有；只在 Claude Code 的会话里）：几项要紧的（创建、工作时长、Token、子 Agent）+「全部详情…」（ccinfo.js）
    var infoOn = !!(d && (!only || only.indexOf("todo") >= 0) && acfg().infoList === true && /^cc:/.test(d.aid) && !/^cc:sub-/.test(d.aid) && window.TSU_CCINFO);
    if (!d || !(d.goal || d.main || d.fgOn || d.todo.length || d.sh.length || d.sa.length || infoOn)) return "";
    var aid = d.aid;
    // /goal 在跑：最上面一行「◎ Goal · 条件 · active 1d」（同 Claude Code 输入框上面那句 ◎ /goal active (1d)）；放不下的点一下换行
    var gl = d.goal, gAge = gl && gl.at ? Date.now() - gl.at : 0, gk = aid + ":goal";
    var goalHtml = gl ? '<div class="st-fgoal' + (TWRAP[gk] ? " wrap" : "") + '" data-st="todo-wrap-' + esc(gk) + '"><i class="st-tg st-fgi">◎</i><span class="st-cut" title="' + esc(gl.text) + '"><b>Goal</b> ' + esc(trT(gl.text, aid)) + '</span><span class="st-fill"></span><span class="st-dim">' + (gl.checking ? "checking…" : "active" + (gAge >= 864e5 ? " " + Math.floor(gAge / 864e5) + "d" : gAge >= 36e5 ? " " + Math.floor(gAge / 36e5) + "h" : gAge >= 6e4 ? " " + Math.floor(gAge / 6e4) + "m" : "")) + "</span></div>" : "";
    var sec = function (k, title, extra, body) {
      // 收着的直接画成收着的（class 在字符串里）：重画时不会先展开再收一遍（那样看着是上下跳）；只有点标题行才有往上收 / 往下展开的动画
      return '<div class="st-fsec' + (famFolded(aid, k) ? " folded" : "") + '" data-aid="' + esc(aid) + '" data-sec="' + k + '"><div class="st-fh" data-st="fam-fold" title="收起 / 展开"><i class="st-fchev"></i><span class="st-ft">' + esc(title) + "</span>" + (extra || "") +
        '</div><div class="st-fb"><div class="st-fbi">' + body + "</div></div></div>";
    };
    // 点开看详情的：那一行也换行显示全文。子 Agent：Claude Code 的会话里点一下进去看它自己的记录（只读的标签页）；Paimon 的就地看详情
    var saAid = d.main ? "cc:" + d.main.sid : aid; // 子 agent 的标签页里：列的是主 agent 的子 agent（点了开那一个）
    // 子 agent 再开的子 agent：挂在它下面一层（再往下也一样，最多四层）；点一行同样进去看它自己的记录
    var nestRows = function (x, ownerAid, depth) {
      if (x.kind === "shell" || !/^cc:/.test(ownerAid) || depth > 4 || !window.TSU_CLAUDE || !TSU_CLAUDE.subTasks) return "";
      var kids = TSU_CLAUDE.subTasks(x, tdRt(ownerAid));
      if (!kids.length) return "";
      var kAid = "cc:sub-" + x.id;
      return '<div class="st-sanest" style="--nd:' + depth + '">' + kids.slice().sort(taskOrder).map(function (k) { var op = !!TDET[kAid + ":" + tkey(k)], me = d.main && k.id === d.main.me; return subRow(k, kAid, "st-frow" + (op ? " wrap" : "") + (me ? " st-me" : ""), "sub-open") + nestRows(k, kAid, depth + 1); }).join("") + "</div>";
    };
    var row1 = function (x) { var ra = x.kind === "shell" ? aid : saAid, op = !!TDET[ra + ":" + tkey(x)], me = d.main && x.id === d.main.me; return (x.kind === "shell" ? taskRow(x, aid, "st-frow" + (op ? " wrap" : ""), "task-det") : subRow(x, ra, "st-frow" + (op ? " wrap" : "") + (me ? " st-me" : ""), /^cc:/.test(ra) ? "sub-open" : "task-det")) + (op ? taskDet(x, ra) : "") + nestRows(x, ra, 1); };
    // 在跑的一行行列着；跑完的（完成、失败、停了）收成一行「n 个已结束」，点开看（同任务清单的「n 项已完成」）
    var rows = function (l, k, rf) {
      rf = rf || row1;
      var live = l.filter(function (x) { return x.status === "running"; }), fin = l.filter(function (x) { return x.status !== "running"; }), open = !!FDONE[aid + ":" + k];
      return live.map(rf).join("") + (fin.length ? '<div class="st-todoi st-tdone" data-st="fam-done-' + k + '"><i class="st-dchev' + (open ? " open" : "") + '"></i>' + esc(fin.length + " 个已结束") + "</div>" + (open ? fin.map(rf).join("") : "") : "");
    };
    var head = function (name, l) { var n = l.filter(function (x) { return x.status === "running"; }).length; return name + " · " + n + " 运行中 · " + (l.length - n) + " 已结束"; }; // 几个在跑、几个跑完：两个数都写（同任务清单那一行）
    var cur = d.todo.filter(function (x) { return x.status === "in_progress"; })[0];
    // 正在运行（前台）：一条一行，同后台任务那一行（在跑的 ● 闪、写用时；跑完的打勾、划掉、写用了多久）；不是命令的写工具名（Fetch、Update……）
    //   点一下换行看全，下面是完整的命令 / 路径（再点收回）
    var FGN = { Read: "Read", Edit: "Update", MultiEdit: "Update", Write: "Write", Grep: "Search", Glob: "Search", WebFetch: "Fetch", WebSearch: "Web Search", NotebookEdit: "Update", LS: "List" };
    var fgRtm = null; try { fgRtm = TSU_AGENTS.runtime(aid); } catch (e) { fgRtm = null; }
    var fgItems = d.fg.map(function (p) { return { p: p, status: fgRun(p, fgRtm) ? "running" : p.status === "error" ? "error" : "done", t0: p.t0 || 0 }; }).sort(taskOrder);
    var fgRow = function (x) {
      var p = x.p, a = p.input || {}, run = x.status === "running", grp = FG_GRP(p), nm = grp ? "" : FGN[p.name] || String(p.name).replace(/^mcp__([^_]+(?:_[^_]+)*)__/, "$1 · "), wk = aid + ":fg:" + fgKey(p);
      var raw = fgTitle(p, fgRtm), what = trT(raw, aid), op = !!TWRAP[wk], took = run ? "" : p.t0 && p.t1 && p.t1 >= p.t0 ? dur(p.t1 - p.t0) : "";
      var full = String(a.command || a.file_path || a.notebook_path || a.path || a.pattern || a.url || a.query || "").trim();
      var ico = run ? '<i class="st-tg st-fgdot">●</i>' : taskIco(x), tl = (nm ? nm + " " : "") + what;
      return '<div class="st-prw st-frow st-fgrow' + (run ? " run" : " fin") + (op ? " wrap" : "") + '" data-st="todo-wrap-' + esc(wk) + '">' + ico + " " + (run ? '<span class="st-cut"' + trTitle(tl, raw) + ">" + esc(tl) + "</span>" : '<s class="st-cut"' + trTitle(tl, raw) + ">" + esc(tl) + "</s>") + '<span class="st-fill"></span>' +
        (run ? '<span class="st-tick st-dim" data-t0="' + (p.t0 || 0) + '"></span>' : '<span class="st-dim">' + esc(took) + "</span>") + "</div>" +
        (op && full && full !== raw ? '<div class="st-fgdet"><pre>' + esc((p.name === "Bash" ? "$ " : "") + full.slice(0, 4000)) + "</pre></div>" : "");
    };
    // 这一块一共多久（左边那一组的标题不再写）：从第一条开始算；还在这一问里跑着的每秒走，跑完的写总共用了多久
    var fgTotal = function () {
      var g0 = d.fg.reduce(function (m, p) { return p.t0 && (!m || p.t0 < m) ? p.t0 : m; }, 0), g1 = d.fg.reduce(function (m, p) { return Math.max(m, p.t1 || p.t0 || 0); }, 0), tt = fgRtm && fgRtm.stream && fgRtm.stream.turn;
      if (!g0) return "";
      var live = fgItems.some(function (x) { return x.status === "running"; }) || !!(tt && tt.parts && tt.parts.indexOf(d.fg[0]) >= 0);
      return '<span class="st-fill"></span>' + (live ? '<span class="st-dim st-fhtime st-tick" data-t0="' + g0 + '"></span>' : '<span class="st-dim st-fhtime">' + esc(dur(g1 - g0)) + "</span>");
    };
    // 主 agent 那一行（同 Claude Code 的 ● main）：名字、在不在跑（在跑的写它在干什么）、点一下回到它的标签页
    var mainHtml = "";
    if (d.main) {
      var mr = d.main.rt, mbusy = !!(mr && mr.stream), mname = (mr && mr.agent && mr.agent.name) || (mr && mr.info && mr.info.title) || d.main.sid.slice(0, 8), mact = "";
      if (mbusy && mr.stream.turn && mr.stream.turn.parts) { var lastP = mr.stream.turn.parts.filter(function (p) { return p.kind === "tool" && p.status === "running"; }).pop(); if (lastP) mact = String((lastP.input && (lastP.input.description || lastP.input.command || lastP.input.file_path)) || lastP.name).replace(/\s+/g, " ").trim(); }
      var nestedPar = /^sub-/.test(d.main.sid); // 再往下一层的子 agent：上面那一行是开它的那个子 agent，不是主 agent（名字不带标签页上的「↳」）
      if (nestedPar) mname = String(mname).replace(/^↳\s*/, "");
      mainHtml = sec("main", nestedPar ? "上一级 Agent" : "主 Agent", "", '<div class="st-prw st-frow st-mainrow" data-st="open-main-' + esc(d.main.sid) + '" title="' + esc(mname) + '"><i class="st-tg st-maindot">●</i> <b class="st-fgn">' + (nestedPar ? "parent" : "main") + '</b> <span class="st-cut">' + esc(mname) + '</span><span class="st-fill"></span><span class="st-dim">' + esc(mbusy ? (mact ? trT(mact, aid) : "运行中") : "空闲") + "</span></div>");
    }
    if (famTui() && P && P.toHtml) return familyTuiHtml(P, d, fgItems);
    // 右上角「TUI / 图形」的切换先关掉（TUI 的样子不能折叠，没做好）：<div class="st-fmode"><button … data-st="fam-tui">TUI</button></div>
    return '<div class="st-fam" data-aid="' + esc(aid) + '">' + goalHtml + mainHtml +
      (d.fgOn ? sec("fg", fgItems.length ? head("正在运行", fgItems) : "正在运行", fgTotal(), fgItems.length ? rows(fgItems, "fg", fgRow) : '<div class="st-dim st-fgnone">还没有运行过命令</div>') : "") +
      (d.todo.length ? sec("todo", todoHead(d.todo), cur ? (function (s0) { var t = trT(s0, aid); return '<span class="st-fcur"' + trTitle(t, s0) + ">" + esc(t) + "</span>"; })(cur.activeForm || cur.subject) : "", todoRowsHtml(d.todo, aid)) : "") +
      (d.sh.length ? sec("bg", head("后台任务", d.sh), "", rows(d.sh, "bg")) : "") +
      (d.sa.length ? sec("sub", head("子 Agent", d.sa), "", rows(d.sa, "sub")) : "") +
      (infoOn ? sec("info", "详情", "", TSU_CCINFO.summaryHtml(aid.slice(3), familyChanged)) : "") + "</div>";
  }
  // 右侧栏这一块的 TUI 样子（右上角「TUI / 图形」换，只记在这台设备上，不进设置）：同 Claude Code 终端里的写法——
  //   ◎ Goal、Running 下面一条条 ⏺ 工具(参数)、Todos 的 ☐ / ☒、Background commands、Agents，用时写在后面
  //   先关掉（不能折叠、长清单一长串）：以前选过 TUI 的也回到图形的样子。要恢复：换回 localStorage.getItem("tsu-fam-tui") === "1"，上面加回按钮
  var famTui = function () { return false; };
  function familyTuiHtml(P, d, fgItems) {
    var E = "\x1b[", R = E + "0m", B = E + "1m", D = E + "2m", S = E + "9m", OR = E + "38;2;215;119;87m", GR = E + "38;2;78;186;101m", RD = E + "38;2;255;107;128m", LV = E + "38;2;177;185;249m", aid = d.aid, L = [];
    var dot = function (st) { return (st === "running" ? OR : /error|fail|kill|stop/.test(String(st)) ? RD : GR) + "⏺" + R; };
    var took = function (x) { var t0 = x.t0 || 0, t1 = x.end || x.t1 || (x.ms ? t0 + x.ms : 0); return x.status === "running" ? (t0 ? dur(Date.now() - t0) : "") : t0 && t1 ? dur(t1 - t0) : ""; };
    var gap = function () { if (L.length) L.push(""); };
    if (d.goal) L.push(LV + "◎ " + R + D + "Goal: " + R + trT(d.goal.text, aid) + (d.goal.at ? D + " · active " + dur(Date.now() - d.goal.at) + R : ""));
    if (d.fgOn && fgItems.length) { gap(); L.push(B + "Running" + R); fgItems.forEach(function (x) { var p = x.p, a = p.input || {}, arg = String(a.description || a.command || a.file_path || a.pattern || a.url || a.query || "").replace(/\s+/g, " "), t = took(x); L.push("  " + dot(x.status) + " " + p.name + (arg ? "(" + arg.slice(0, 80) + ")" : "") + (t ? D + " · " + t + R : "")); }); }
    if (d.todo.length) { gap(); L.push(B + "Todos" + R); d.todo.forEach(function (t) { var c = trT(String(t.content || t.subject || ""), aid); L.push("  " + (t.status === "completed" ? D + "☒ " + S + c : t.status === "in_progress" ? B + "☐ " + c : "☐ " + c) + R); }); }
    if (d.sh.length) { gap(); L.push(B + "Background commands" + R); d.sh.forEach(function (x) { var t = took(x); L.push("  " + dot(x.status) + " " + String(x.desc || x.cmd || "").replace(/\s+/g, " ").slice(0, 90) + D + " · " + (x.status === "running" ? "running" : x.status) + (t ? " " + t : "") + R); }); }
    if (d.sa.length) { gap(); L.push(B + "Agents" + R); d.sa.forEach(function (x) { var t = took(x); L.push("  " + dot(x.status) + " " + String(x.desc || x.name || "").replace(/\s+/g, " ").slice(0, 80) + D + (x.tools ? " · " + x.tools + " tool uses" : "") + " · " + (x.status === "running" ? "running" : x.status) + (t ? " " + t : "") + R); }); }
    return '<div class="st-fam st-famtui" data-aid="' + esc(aid) + '"><div class="st-fmode"><button type="button" class="st-fmodeb" data-st="fam-tui" title="' + esc("换回图形的样子") + '">' + esc("图形") + '</button></div><pre class="term terminal-style-ui st-ftui">' + P.toHtml(L, 400) + "</pre></div>";
  }
  // 要显示任务清单时，那块地方得看得见：VS Code 风格打开辅助侧栏（Agent 那一层），Claude App 打开右边的「后台任务」卡片
  function revealFamily() {
    var tw = T() && T().front ? T().front() : null, h = familyHost();
    if (!tw) return;
    if (h === "side") { var ch = false; if (!L.side) { L.side = true; ch = true; } if (L.sideLevel === "global") { L.sideLevel = "agent"; ch = true; } if (ch) { saveL(); render(tw); } }
    else if (h === "card") { var tg = tw.el.querySelector('.ca-tog[data-c="tasks"]:not(.on)'); if (tg) tg.click(); }
  }
  // 有变化（开关、⌃T、收起、做完的展开）：辅助侧栏、卡片、标签页底下都重画
  function familyChanged() {
    allWins().forEach(function (w) { familyPaint(w); });
    if (window.TSU_TDRAWER) TSU_TDRAWER.sync();
  }
  // 只重画「任务」这一块（辅助侧栏、Claude App 的卡片）：内容没变就不动 DOM
  function familyPaint(tw) {
    if (!tw || !tw.st) return;
    var h = familyHost();
    if (h === "side") { if (L.side && L.sideLevel !== "global" && tw.open) sideBody(tw, parts(tw)); footSubs(tw); }
    else if (h === "card") renderPanel(tw);
  }
  // 子 Agent 在面板的 Agent 那一层（agent 的底部：在跑的那一行下面、输入框上面）时，辅助侧栏只放任务清单、后台任务
  // 子 Agent 在 agent 标签页自己的底部（输入框、状态信息下面，同 Claude Code 的样子；live.js subRows、gui.js subs）：辅助侧栏、Claude App 的卡片里就不再列
  // 现在：子 Agent 回到辅助侧栏（任务清单 → 后台任务 → 子 Agent 一家子）、Claude App 的卡片里；agent 的底部只有在跑的那一行、输入框、状态行
  var subsInFoot = function () { return false; };
  // 面板的 Agent 那一层里的「子 Agent」：在跑的、跑完的，一行一个（点一下就地看详情；标题行收起 / 展开）。插在输入框上面——
  // 终端界面：面板里那份 agent 界面的输入栏上面；图形界面：搬进来的那一列里、输入框上面
  function footSubs(tw) {
    var S = tw && tw.st, sp = tw && tw.sidePane, gv = S && S.docked, on = subsInFoot(tw);
    var holder = gv && gv.dockCol ? gv.dockCol() : sp && sp.el.isConnected && !sp.el.hidden ? sp.el : null;
    if (sp && sp.el !== holder) { var ob = sp.el.querySelector(":scope > .st-fsubs"); if (ob && !ob.hidden) { ob.hidden = true; ob.dataset.h = ""; } }
    if (!holder) return;
    var box = holder.querySelector(":scope > .st-fsubs");
    if (!box) {
      if (!on) return;
      box = document.createElement("div");
      box.className = "st-fsubs";
      holder.insertBefore(box, holder.querySelector(gv ? ":scope > .gv-comp" : ":scope > .foot"));
    }
    var h = on ? familyHtml(agentPaneFor(tw), ["sub"]) : "";
    if (box.dataset.h === h && box.hidden === !h || famPress) return;
    box.dataset.h = h;
    box.innerHTML = h;
    box.hidden = !h;
    applyFold(box);
    if (!gv && sp && sp.fit) { sp.fit(); if (sp.stick) sp.stick(); }
  }
  // 当前那个 agent 的事件（任务清单、后台任务变了）：马上重画；另外每秒一遍（用了多久在走）
  var famSubs = new Map();
  setInterval(function () {
    if (document.hidden) return;
    allWins().forEach(function (w) {
      var P = agentPaneFor(w), aid = P && P.program && P.program.agentId, s = famSubs.get(w); // 跟着的那个 agent（编辑区当前的不是 agent 时，是最近用的那个）
      if (!s || s.aid !== aid) {
        if (s && s.off) s.off();
        var rt = null;
        if (aid && window.TSU_AGENTS) try { rt = TSU_AGENTS.runtime(aid); } catch (e) { rt = null; }
        var raf = 0, off = rt && rt.on ? rt.on(function (type) { if (type === "tasks" || type === "status" || type === "state" || type === "turn") { cancelAnimationFrame(raf); raf = requestAnimationFrame(function () { familyPaint(w); }); } }) : null;
        famSubs.set(w, { aid: aid, off: typeof off === "function" ? off : null });
      }
      if (aid) familyPaint(w);
      // 面板的 Agent 那一层跟着的 agent 换了（关了标签页、换了编辑器组）而没有重画：跟上
      if (footOn() && w.st) { var fsp = w.sidePane, fid = P && sideAgent(P); if (fid ? !fsp || !fsp.program || fsp.program.agentId !== fid || !fsp.el.isConnected || fsp.el.hidden : fsp && !fsp.el.hidden) renderPanel(w); }
    });
  }, 1000);
  if (window.TSU_AGENTS && TSU_AGENTS.on) TSU_AGENTS.on(function (t) { if (t === "cfg") familyChanged(); }); // 设置里的开关（任务清单、后台任务、子 Agent）
  // 对话 ··· 里我这边加的几项：显示 ›（任务清单 ⌃T、后台任务、子 Agent、状态信息）；在跑的时候还有「停止」（不放在显眼的地方：发送键一直是发送）
  function agentMenuItems(MI0, aid) {
    MI0 = MI0 || MI;
    var A = window.TSU_AGENTS;
    if (!A || !A.setCfg) return [];
    var rt = null; if (aid) try { rt = A.runtime(aid); } catch (e) { rt = null; }
    var info = acfg().footInfo !== false;
    var out = [{ sep: true }, { label: "显示", icon: MI0.sliders || MI0.layout, items: function () { return famToggles(aid, MI0).concat([{ sep: true }, { label: "状态信息", icon: MI0.info || MI0.status, checked: info, run: function () { A.setCfg("footInfo", !info); } }]); } }];
    if (rt && rt.stream && rt.interrupt) out.push({ sep: true }, { label: "停止", icon: MI0.stop, keys: "Esc", run: function () { rt.interrupt(); } });
    return out;
  }
  // 「显示」里「任务」一家子的那三项（辅助侧栏的 ···、对话 ··· 一样）：任务清单勾的是这个 agent 现在看不看得到（⌃T 只管这一个 agent；这里改的是全部）
  function famToggles(aid, MI0) {
    var A = window.TSU_AGENTS;
    MI0 = MI0 || MI;
    if (!A || !A.setCfg) return [];
    var chk = function (k, label, icon) { var on = acfg()[k] !== false; return { label: label, icon: icon, checked: on, run: function () { A.setCfg(k, !on); familyChanged(); } }; };
    if (/^ty:/.test(String(aid || ""))) return [chk("taskList", "意图", MI0.checklist || MI0.status), chk("bgList", "后台命令", MI0.term || MI0.status)]; // Teyvat：右侧栏是它的意图、转到后台的命令（没有任务清单、子 Agent）
    var on = todoShown(aid);
    // 任务翻译（translate.js）：就在任务这一家子的菜单里开——选一种语言，任务清单、后台任务、子 Agent、运行状态那一句都翻过去（翻过的缓存着，不重复花钱）
    var TRL = [["off", "关"], ["display", "跟随显示语言"], ["zh", "简体中文"], ["en", "English"], ["ja", "日本語"], ["ko", "한국어"], ["fr", "Français"], ["de", "Deutsch"], ["es", "Español"]];
    var trNow = acfg().translateTasks || "off";
    var trItem = { label: "任务翻译", icon: MI0.web, value: (TRL.filter(function (x) { return x[0] === trNow; })[0] || TRL[0])[1], items: function () { return TRL.map(function (x) { return { label: x[1], radio: true, checked: (acfg().translateTasks || "off") === x[0], run: function () { A.setCfg("translateTasks", x[0]); familyChanged(); } }; }); } };
    return [{ label: "任务清单", icon: MI0.checklist || MI0.status, keys: "⌃T", checked: on, run: function () { TODO_T = {}; A.setCfg("taskList", !on); if (!on) revealFamily(); familyChanged(); } }, chk("bgList", "后台任务", MI0.term), chk("subList", "子 Agent", MI0.fork || MI0.agent),
      /^cc:/.test(aid || "") && !/^cc:sub-/.test(aid || "") && window.TSU_CCINFO ? { label: "详情", icon: MI0.info, checked: acfg().infoList === true, run: function () { A.setCfg("infoList", acfg().infoList !== true); familyChanged(); } } : null, // 默认不开
      { sep: true }, trItem].filter(Boolean);
  }
  function previewSlot(site, id, slot) { var k = site + ":" + id; if (slot) SLOTP[k] = slot; else delete SLOTP[k]; placed(site, id); }

  // ======== 元素：记在面板上（P.els = { id: 元素 }）========
  var same = function (a, b) { try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; } };
  function set(P, el) {
    if (!P || !el || !el.id || !el.type) return;
    P.els = P.els || {};
    var old = P.els[el.id];
    if (old && old.type === el.type && old.title === el.title && old.site === el.site && same(old.data, el.data) && old.fields === el.fields) return;
    P.els[el.id] = el;
    if (P.win) renderSoon(P.win);
  }
  function remove(P, id) { if (P && P.els && P.els[id]) { delete P.els[id]; if (P.win) renderSoon(P.win); } }
  function clear(P, site) {
    if (!P || !P.els) return;
    var n = 0;
    Object.keys(P.els).forEach(function (id) { if (!site || P.els[id].site === site) { delete P.els[id]; n++; } });
    if (n && P.win) renderSoon(P.win);
  }
  function list(P) { return P && P.els ? Object.keys(P.els).map(function (k) { return P.els[k]; }) : []; }
  function inlineOn(P, id) {
    if (id === "tasks") return false; // 任务清单不在对话里：在 agent 的右边（辅助侧栏 / Claude App 的卡片 / 标签页最下面），见上面「任务」一家子
    if (P && P.side && P.win && P.win.ws.active) P = P.win.ws.active; // 右侧栏里的那份：按编辑区那份交出来的元素算（Claude Code 的状态默认在状态栏）
    var pr = P && P.program, el = P && P.els && P.els[id];
    return slotOf(el ? el.site : pr && pr.claude ? "claude" : "paimon", id) === "inline";
  }
  var TITLES = { tasks: "任务", status: "状态", context: "上下文", view: "视图" };
  var titleOf = function (el) { return el.title && el.id !== "status" ? el.title : TITLES[el.id] || TITLES[el.type] || el.id; };

  // ---- 每种元素怎么画（终端的样子）：一行的（状态栏）、一块的（右侧栏、状态栏点开的）----
  function bar(f, n) { var k = Math.round(Math.max(0, Math.min(1, f)) * n); return '<span class="st-lav">' + "▰".repeat(k) + '</span><span class="st-dim">' + "▱".repeat(n - k) + "</span>"; }
  var TYPES = {
    tasks: {
      line: function (el) {
        var it = (el.data && el.data.items) || [], done = it.filter(function (x) { return x.status === "completed"; }).length, cur = it.filter(function (x) { return x.status === "in_progress"; })[0];
        if (!it.length) return "";
        if (cur) return "▶ " + esc(trT(cur.activeForm || cur.subject)) + ' <span class="st-dim">' + done + "/" + it.length + "</span>";
        return done === it.length ? '<span class="st-green">✔</span> <span class="st-dim">' + it.length + " 项已全部完成</span>" : '◻ <span class="st-dim">' + done + "/" + it.length + "</span>";
      },
      block: function (el) {
        var it = (el.data && el.data.items) || [];
        if (!it.length) return '<div class="st-dim">（无任务）</div>';
        var done = it.filter(function (x) { return x.status === "completed"; }), doing = it.filter(function (x) { return x.status === "in_progress"; }), open = it.filter(function (x) { return x.status === "pending"; });
        return '<div class="st-dim">' + it.length + " tasks (" + done.length + " done, " + doing.length + " in progress, " + open.length + " open)</div>" + todoRowsHtml(it); // 在做的在前，做完的收成「n 项已完成」
      },
    },
    status: {
      line: function (el) {
        var d = el.data || {}, bits = [];
        if (!d.label && !d.busy) return "";
        if (d.busy && d.t0) bits.push(dur(Date.now() - d.t0));
        if (d.detail) bits.push(d.detail);
        return (d.busy ? '<span class="st-orange">' + spin() + " " + esc(d.label || "Working") + "…</span>" : '<span class="st-dim">' + esc(d.label || "空闲") + "</span>") + (bits.length ? ' <span class="st-dim">(' + esc(bits.join(" · ")) + ")</span>" : "");
      },
      block: function (el) { return '<div class="st-cut">' + (TYPES.status.line(el) || '<span class="st-dim">空闲</span>') + "</div>"; },
    },
    context: {
      line: function (el) { var d = el.data || {}, f = d.window ? (d.tokens || 0) / d.window : 0; return d.tokens ? '<span class="st-dim">上下文</span> ' + bar(f, 6) + ' <span class="st-dim">' + Math.round(f * 100) + "%</span>" : ""; },
      block: function (el) { var d = el.data || {}, f = d.window ? (d.tokens || 0) / d.window : 0; return "<div>" + bar(f, 16) + " " + Math.round(f * 100) + '%</div><div class="st-dim st-cut">' + kfmt(d.tokens) + " / " + kfmt(d.window) + " tokens" + (d.model ? " · " + esc(d.model) : "") + "</div>"; },
    },
    // 一段字（状态栏上的一格：权限级别、余额这些）；el.click 有的话点一下就执行它
    text: {
      line: function (el) { var d = el.data || {}; return d.text ? '<span class="' + esc(d.cls || "") + '">' + esc(d.text) + "</span>" : ""; },
      block: function (el) { return '<div class="st-cut">' + TYPES.text.line(el) + "</div>"; },
    },
    kv: {
      line: function (el) { var r = ((el.data && el.data.rows) || [])[0]; return r ? '<span class="st-dim">' + esc(el.title || r[0]) + "</span> " + esc(el.title ? r[0] + " " + r[1] : r[1]) : ""; },
      block: function (el) { return ((el.data && el.data.rows) || []).map(function (r) { return '<div class="st-cut"><span class="st-dim">' + esc(r[0]) + "</span>  " + esc(r[1]) + "</div>"; }).join(""); },
    },
    form: {
      line: function (el) { return '<span class="st-dim">' + esc(titleOf(el)) + "</span>"; },
      block: function (el) { return formRows(typeof el.fields === "function" ? el.fields() : (el.data && el.data.fields) || [], el.id); },
    },
  };
  // 表单（右侧栏的「视图」）：一行一项，选项排在右边，当前那个反色（同 TUI 的标签）；点一下就换
  function formRows(fields, elId) {
    return fields.map(function (f) {
      if (f.head) return '<div class="st-dim st-fhead0">' + esc(f.head) + "</div>";
      var opts = f.kind === "toggle" ? [[true, "开"], [false, "关"]] : f.options || [];
      return '<div class="st-frow"><span class="st-flab" title="' + esc(f.desc || f.label) + '">' + esc(f.label) + '</span><span class="st-fopts">' +
        opts.map(function (o) { var on = o[0] === f.value; return '<span class="st-opt' + (on ? " on" : "") + '" data-el="' + esc(elId) + '" data-key="' + esc(f.key) + '" data-v="' + esc(JSON.stringify(o[0])) + '">' + esc(o[1]) + "</span>"; }).join("") + "</span></div>";
    }).join("");
  }
  function formChange(P, el, key, raw) {
    var v; try { v = JSON.parse(raw); } catch (e) { v = raw; }
    if (el.change) el.change(key, v);
    else if (el.events && P.shell && P.shell.pty && P.shell.type) P.shell.type(osc({ op: "change", id: el.id, key: key, value: v })); // 程序要事件：写回它的 stdin
    if (P.win) renderSoon(P.win);
  }

  // ======== 窗口的部件：右侧栏、下面板、状态栏——都能拖动调整、能关 ========
  var WSUF = (function () { var N0 = window.nadosNative; if (N0 && N0.hybrid) return ":mac:" + N0.mac; var n = parseInt(new URLSearchParams(location.search).get("win") || "1", 10) || 1; return n > 1 ? ":" + n : ""; })(); // App 的第几个窗口：各记各的布局（连着另一台 Mac 的窗口按那台记，同 live.js）
  var L = store("st-layout" + WSUF, { side: false, panel: false, panelH: 240, status: true, fold: {} }); // 右侧栏默认关着（同 VS Code 的辅助侧栏）
  if (!(L.sideR > 0)) L.sideR = 0.5; // 右侧栏的宽度：占编辑区加右侧栏的几成（默认一半）
  // 右侧栏显示哪些内容（它右上角的 ··· 勾选）：输入框，以及对话里的哪几种（默认只有输入框：输入与管理）
  var realSide = function () { return L.sideView || { composer: true }; };
  var SVP = null; // 预览：··· 里指着的那一项临时换过来的样子（不存；移开、关菜单就回去）
  var sideView = function () { var v = realSide(); return SVP ? Object.assign({}, v, SVP) : v; };
  var sideMini = function (sv) { var m = sv.minimap; return m === true || m === "transparent" ? "show" : m || SET_DEF.minimap; }; // 右侧栏里对话的缩略图（默认同编辑区的默认）
  var anyKind = function (sv) { return Object.keys(sv).some(function (k) { return k !== "composer" && k !== "minimap" && sv[k]; }); };
  var saveL = function () { keep("st-layout" + WSUF, L); };
  // 全局的底部面板（终端、Agent 活动）：以前开着的收起来一次；之后只在你自己打开（⌘J、新建终端、在终端中继续）时出来
  if (!L.panelOff1) { L.panel = false; L.panelOff1 = 1; saveL(); }
  function parts(tw) {
    if (tw.st) return tw.st;
    var main = tw.el.querySelector(".tmain") || tw.panesEl.parentNode, body = tw.el.querySelector(".body"), lab = main.parentNode;
    var mid = document.createElement("div"), grip = document.createElement("i"), side = document.createElement("div"), panel = document.createElement("div"), status = document.createElement("div");
    mid.className = "st-mid";
    main.insertBefore(mid, tw.panesEl);
    // 编辑区和下面的面板是一列（面板属于上面的编辑区）；右侧栏在这一列旁边，从顶一直到底
    var ecol = document.createElement("div");
    ecol.className = "st-ecol";
    mid.appendChild(ecol);
    ecol.appendChild(tw.panesEl);
    grip.className = "st-grip";
    side.className = "st-aside terminal-style-ui";
    // 右侧栏：和左边的侧栏是同一种东西——标题行（对话 · ··· 显示哪些内容）、上面是分区（任务清单、上下文……）、下面是对话（输入框）
    // 标题行左边「Agent | 全局」两层：Agent——跟着编辑区当前的那个 agent（下面的分区、输入框）；全局——全局助手（globalagent.js：看各个 agent、调布局）
    // 标题行：跟着的那个 agent 的名字（sideBody 放进来）、「···」。没有 Agent / 全局 的切换（全局助手在面板的「助手」视图里）
    side.innerHTML = '<div class="st-shdr st-sidehdr"><span class="st-sidelv" hidden></span><span class="st-fill"></span><button class="st-hbtn" data-st="side-views" title="更多操作"></button></div><div class="st-sbody"></div><div class="st-sactsplit" hidden></div><div class="st-sact tr-host" hidden></div><div class="st-scomp" hidden></div><div class="st-sglob" hidden></div>';
    // 摆法（.tlab 是一张网格，见 studio.css）：主侧栏 | 编辑区 在上，面板在下面、从主侧栏底下一直到编辑区（同 VS Code 面板「左对齐」）；
    // 右侧栏在最右边，从顶一直到底
    lab.appendChild(grip);
    lab.appendChild(side);
    panel.className = "st-panel";
    // 面板（同 VS Code 的面板）：最上面单独一行是面板的总控「··· 显示哪些视图 | 放大 · 关闭」；下面几个视图并排：终端（右边一列终端）、Agent 活动（全局：按 agent 分组）；
    // 「后台任务」只给 Claude App 右边的卡片用（当前这个会话的）。每个 agent 自己的后台任务、子 Agent 在它那个标签页底下（tdrawer.js）
    // 面板是全局的（终端、Agent 活动这些视图并排）；agent 的底部（在跑的那一行、输入框、状态信息、子 Agent）在它自己的标签页里（同一块地方，见 live.js / gui.js 的底部）
    panel.innerHTML = '<i class="st-pgrip"></i><div class="st-ptop"><div class="st-ptabs" role="tablist"></div><button class="st-hbtn st-ptmore" data-st="pvtabs-more" title="更多视图" hidden></button><span class="st-fill"></span><span class="st-ptacts"></span><button class="st-hbtn" data-st="panel-views" title="视图"></button><i class="st-psep"></i><button class="st-hbtn" data-st="panel-max" title="放大"></button><button class="st-hbtn" data-st="panel-close" title="关闭面板 (⌘J)"></button></div>' +
      '<div class="st-pagent" hidden></div>' +
      '<div class="st-pviews"><div class="st-pv" data-v="term"><div class="st-pvh" data-st="pv-fold-term"></div><div class="st-pvb"><div class="st-pbody"></div><div class="st-tlist"></div></div></div>' +
      '<div class="st-pv" data-v="activity"><div class="st-pvh" data-st="pv-fold-activity"></div><div class="st-pvb st-plist st-actv"></div></div>' +
      '<div class="st-pv" data-v="system"><div class="st-pvh" data-st="pv-fold-system"></div><div class="st-pvb st-plist st-sysv"></div></div>' +
      '<div class="st-pv" data-v="assistant"><div class="st-pvh" data-st="pv-fold-assistant"></div><div class="st-pvb st-pglob"></div></div>' +
      '<div class="st-pv" data-v="tasks"><div class="st-pvh" data-st="pv-fold-tasks"></div><div class="st-pvb st-plist"></div></div></div>';
    lab.appendChild(panel);
    status.className = "st-status terminal-style-ui";
    body.appendChild(status);
    var S = tw.st = { mid: mid, lab: lab, side: side, grip: grip, panel: panel, status: status, terms: [], cur: 0 };
    lab.classList.add("st-grid");
    // 右侧栏的宽度：没拖过 = 340px（studio.css 的默认；以前默认占一半，太宽）；拖过 = 记下占几成（L.sideR，L.sideRUser 标着是自己拖的）
    var asideCol = function () { if (L.sideRUser && L.sideR > 0) lab.style.setProperty("--aside-col", "calc(" + L.sideR + " * (100% - 6px))"); else lab.style.removeProperty("--aside-col"); };
    asideCol();
    panelHeight(tw);
    // 右侧栏：拖左边缘调宽，双击恢复成默认的宽度
    var sideW = function (r) { if (r) { L.sideR = r; L.sideRUser = true; } else { L.sideRUser = false; } asideCol(); fitTerms(tw); };
    drag(grip, "x", function () { return side.offsetWidth; }, function (w0, d) { var W0 = lab.clientWidth || 1, sg = lab.classList.contains("st-sright") ? -1 : 1; sideW(Math.max(220, Math.min(Math.round(W0 * 0.75), w0 - sg * d)) / W0); }, function () { sideW(0); });
    // 下面板：拖上边缘调高，双击恢复。Agent 那一层自己记一个高度（L.panelHA；没拖过 = 贴着内容，双击回到贴着内容）
    drag(panel.querySelector(".st-pgrip"), "y", function () { return panel.offsetHeight; }, function (h0, d) {
      var h = Math.max(90, Math.min(Math.round(lab.clientHeight * 0.85), h0 - d));
      if (footOn()) { L.panelHA = h; panelHeight(tw); footFit(tw); } else { L.panelH = h; panel.style.height = L.panelH + "px"; }
      fitTerms(tw);
    }, function () { if (footOn()) { L.panelHA = 0; panelHeight(tw); footFit(tw); } else fitPanel(tw); fitTerms(tw); });
    // 双击面板的标题栏（同双击上边缘）：调到正合适的高度——Agent 活动是它的内容正好放下（会话表 + 整机），终端是窗口的四成；已经是这个高度就回到原来的
    panel.querySelector(".st-ptop").addEventListener("dblclick", function (e) { if (footOn() || e.target.closest("button, [data-st], input")) return; fitPanel(tw); fitTerms(tw); saveL(); });
    side.addEventListener("click", function (e) { click(tw, e); });
    status.addEventListener("click", function (e) { click(tw, e); });
    panel.addEventListener("contextmenu", function (e) { var r = e.target.closest(".st-trow"); if (!r) return; e.preventDefault(); e.stopPropagation(); termMenu(tw, +r.dataset.st.slice(5), { x: e.clientX, y: e.clientY }); });
    panel.querySelector(".st-ptop").addEventListener("contextmenu", function (e) { if (footOn()) return; var b = e.target.closest("[data-st]"); toolbarMenu(e, "panel", [{ id: "panel-max", label: "最大化面板大小", icon: ICO.max }], b && b.dataset.st === "panel-max" ? "panel-max" : null, function () { renderPanel(tw); }); }); // Agent 那一层：交给下面那个（只管这一层的）
    // 面板的 Agent 那一层上右键（标题行、在跑的那一行、子 Agent、输入框那一带）：显示哪几块、Agent / 全局、隐藏面板。输入框里、选着字时照常
    panel.addEventListener("contextmenu", function (e) {
      if (e.defaultPrevented || !footOn() || !e.target.closest(".st-pagent, .st-ptop")) return;
      if (e.target.closest("input, textarea, [contenteditable='true'], [contenteditable='']") || String(window.getSelection() || "").trim()) return;
      e.preventDefault();
      menu(function () { return footMenu(tw); }, { x: e.clientX, y: e.clientY });
    });
    panel.addEventListener("click", function (e) { click(tw, e); });
    var ctx = function (e) {
      var el = e.target.closest("[data-sec], .st-item"), P = tw.ws.active, id = el && (el.dataset.sec || el.dataset.el);
      if (!id || !P || !P.els || !P.els[id]) return;
      e.preventDefault();
      placeMenu(P.els[id], e.clientX, e.clientY);
    };
    // 辅助侧栏上右键：只管这一块的（显示哪几块、Agent / 全局、隐藏辅助侧栏）；全局助手自己有菜单的地方、输入框里、选着字时不管
    side.addEventListener("contextmenu", function (e) {
      if (e.defaultPrevented || e.target.closest("input, textarea, [contenteditable='true'], [contenteditable='']") || String(window.getSelection() || "").trim()) return;
      e.preventDefault();
      menu(function () { return asideMenu(tw); }, { x: e.clientX, y: e.clientY });
    });
    status.addEventListener("contextmenu", function (e) { e.preventDefault(); menu(function () { return statusMenu(tw); }, { x: e.clientX, y: e.clientY }); });

    return S;
  }
  // 拖一条边：axis x / y；get() 起始尺寸；move(起始尺寸, 位移)；reset() 双击
  function drag(handle, axis, get, move, reset) {
    handle.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      var p0 = axis === "x" ? e.clientX : e.clientY, s0 = get();
      root.classList.add(axis === "x" ? "st-drag-x" : "st-drag-y");
      var mv = function (ev) { move(s0, (axis === "x" ? ev.clientX : ev.clientY) - p0); };
      var up = function () { handle.removeEventListener("pointermove", mv); handle.removeEventListener("pointerup", up); handle.removeEventListener("pointercancel", up); root.classList.remove("st-drag-x", "st-drag-y"); saveL(); };
      handle.addEventListener("pointermove", mv);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
    handle.addEventListener("dblclick", function () { reset(); saveL(); });
  }
  function click(tw, e) {
    var P = tw.ws.active, t = e.target;
    var opt = t.closest(".st-opt");
    if (opt && P && P.els && P.els[opt.dataset.el]) return formChange(P, P.els[opt.dataset.el], opt.dataset.key, opt.dataset.v);
    var act = t.closest("[data-st]");
    if (act) return action(tw, act.dataset.st, act);
    var sec = t.closest(".st-shead");
    if (sec) { var id = sec.parentNode.dataset.sec; L.fold[id] = !L.fold[id]; saveL(); return render(tw); }
    var item = t.closest(".st-item");
    if (item && P && P.els && P.els[item.dataset.el]) { var el0 = P.els[item.dataset.el]; if (el0.click) { el0.click(); return renderSoon(tw); } return pop(tw, el0, item); }
  }
  function action(tw, what, el) {
    famPress = false; // 点完了（click 在 pointerup 之后）：这一下要的重画马上做——以前按着的标记要等 pointerup 的下一拍才清，这一下的重画被跳过，等下一秒的定时重画才展开（「n 个已结束」点了要等一两秒）
    if (what === "reload") return location.reload();
    if (what === "app-update") return appUpdateNow();
    if (what === "preview-close") { parts(tw).previewImg = null; return render(tw); }
    if (what === "side-close") return toggleSide(tw, false);
    if (/^side-lv-/.test(what)) return; // 以前辅助侧栏的「Agent / 全局」：没有了
    if (what === "side-views") return menu(function () { return L.sideLevel === "global" && window.TSU_GLOBAL ? [{ label: "返回 Agent 的任务", icon: MI.sideR, run: function () { L.sideLevel = "agent"; saveL(); render(tw); } }, { sep: true }].concat(TSU_GLOBAL.menu(tw)) : sideMenu(tw); }, { el: el, side: "below-end" });
    if (what === "panel-close") return togglePanel(tw, false);
    if (/^ptab-/.test(what)) return panelTab(tw, what.slice(5)); // 面板的视图：agent 的底部 · 终端 · Agent 活动
    if (/^pvtab-/.test(what)) { L.pvTab = what.slice(6); saveL(); renderPanel(tw); fitTerms(tw); return; } // 面板顶上的视图标签（同 VS Code：终端、Agent 活动、助手……一次看一个）
    if (what === "pvtabs-more") return menu(function () { return (parts(tw).pvHidden || []).map(function (v) { var pv = PVIEWS.filter(function (x) { return x[0] === v; })[0]; return { label: pv ? pv[1] : v, run: function () { L.pvTab = v; saveL(); renderPanel(tw); fitTerms(tw); } }; }); }, { el: el, side: "below" });
    if (what === "panel-views") return menu(function () { return PVIEWS.filter(function (pv) { return pvAvail(pv[0]); }).map(function (pv) { var on = pvOn(pv[0], true); return { label: pv[1], icon: { term: MI.term, activity: TRACE_ICO, system: SYS_ICO, tasks: ICO.pvtasks }[pv[0]], sym: { term: "terminal", activity: "timeline.selection", system: "waveform.path.ecg", tasks: "list.bullet", assistant: "sparkles" }[pv[0]], checked: on, run: function () { L.pvOff = L.pvOff || {}; L.pvOff[pv[0]] = on; saveL(); renderPanel(tw); fitTerms(tw); }, preview: function (p) { PVP = p ? (function () { var o = {}; o[pv[0]] = !on; return o; })() : null; renderPanel(tw); fitTerms(tw); } }; }); }, { el: el, side: "below-end" }); // 不再有「以标签页显示」：标签页是唯一的样子（用户定的）；每一项都带图标（系统菜单里用 SF Symbols）
    if (/^pv-fold-/.test(what) && Date.now() - (parts(tw).pvDragged || 0) < 400) return; // 刚拖完：不算点
    if (/^pv-fold-/.test(what)) { var v0 = what.slice(8); L.pvFold = L.pvFold || {}; L.pvFold[v0] = !L.pvFold[v0]; saveL(); renderPanel(tw); return fitTerms(tw); }
    // 一条后台任务 / 子 Agent：task-open-<任务>[@<agent>]——带 agent 的是「Agent 活动」里的（先到那个 agent 的标签页，再在那里打开详情）；不带的是当前这个
    if (/^task-(open|stop)-/.test(what)) {
      var tid = what.slice(10), at = tid.lastIndexOf("@"), aid = at > 0 ? tid.slice(at + 1) : "", P1 = tw.ws.active;
      if (at > 0) tid = tid.slice(0, at); else aid = P1 && P1.program && P1.program.agentId;
      if (!aid || !window.TSU_AGENTS) return;
      if (what.indexOf("task-stop-") === 0) { var t0 = (TSU_AGENTS.runtime(aid).tasks || []).filter(function (x) { return x.id === tid; })[0]; if (t0 && t0.ctl && t0.ctl.abort) t0.ctl.abort(); familyChanged(); return renderPanel(tw); }
      var P2 = at > 0 ? agentPane(tw, aid) : P1;
      if (P2 && P2.program && P2.program.openTask) P2.program.openTask(tid);
      return;
    }
    if (/^agent-open-/.test(what)) return void agentPane(tw, what.slice(11));
    if (/^agent-done-/.test(what)) { var ad = what.slice(11); ACTD[ad] = !ACTD[ad]; return renderPanel(tw); }
    if (/^todo-wrap-/.test(what)) { if (String(window.getSelection() || "").trim()) return; var wk0 = what.slice(10); if (TWRAP[wk0]) delete TWRAP[wk0]; else TWRAP[wk0] = 1; return familyChanged(); } // 任务清单的一项：换行展开全文 / 收回
    if (what === "tasks-done") return toggleTodoDone(); // 任务清单里「n 项已完成」：展开 / 收起（侧栏、卡片、抽屉一起）
    if (/^fam-done-(bg|sub|fg)$/.test(what)) { var fs0 = el && el.closest ? el.closest(".st-fsec") : null, fk = (fs0 ? fs0.dataset.aid : "") + ":" + what.slice(9); FDONE[fk] = !FDONE[fk]; return familyChanged(); } // 「n 个已结束」：展开 / 收起
    if (what === "side-agent") { var ap = agentPaneFor(tw); if (ap && ap !== tw.ws.active) { if (tw.ws.show) tw.ws.show(ap); if (ap.focus) ap.focus(); } return; } // 辅助侧栏标题行上 agent 的名字：切到它的标签页
    if (what === "new-agent") return newAgent(tw);
    if (what === "fam-tui") { localStorage.setItem("tsu-fam-tui", famTui() ? "0" : "1"); return familyChanged(); } // 右侧栏这一块：TUI ↔ 图形
    if (what === "fam-fold") { var fs = el && el.closest(".st-fsec"); if (fs) toggleFamFold(fs.dataset.aid, fs.dataset.sec); return; } // 「任务」一家子某一块的标题行：收起 / 展开
    if (what === "cc-info") { if (window.TSU_CCINFO && el && el.dataset.sid) TSU_CCINFO.open(el.dataset.sid); return; } // 「详情」那一块的「全部详情…」
    if (/^open-main-/.test(what)) { var ms0 = what.slice(10); if (tw.side && tw.side.viewCC) tw.side.viewCC(ms0); return; } // 子 agent 的标签页里点「main」：回到主 agent
    if (/^sub-open-/.test(what)) { // 子 Agent：进去看它自己的记录（Claude Code 的：只读的标签页，已经开着就跳过去）；没有记录可看的就地看详情
      var sk = what.slice(9), sa = sk.lastIndexOf("@"), sAid = sa > 0 ? sk.slice(sa + 1) : "", sKey = sa > 0 ? sk.slice(0, sa) : sk, sRt = sAid ? tdRt(sAid) : null;
      var sT = sRt ? (sRt.tasks || []).filter(function (x) { return tkey(x) === sKey; })[0] : null;
      if (sT && sT.id && sT.transcript && window.TSU_CLAUDE && TSU_CLAUDE.openSub) { TSU_CLAUDE.openSub(sT, sRt, tw); return; }
      var sdk = sAid + ":" + sKey; if (TDET[sdk]) delete TDET[sdk]; else TDET[sdk] = 1; familyChanged(); return;
    }
    if (/^task-det-/.test(what)) { var dk = what.slice(9), da = dk.lastIndexOf("@"); if (da > 0) { dk = dk.slice(da + 1) + ":" + dk.slice(0, da); if (TDET[dk]) delete TDET[dk]; else TDET[dk] = 1; familyChanged(); } return; } // 一条后台任务 / 子 Agent：就地看详情
    if (what === "panel-max") { tw.st.panel.classList.toggle("max"); return fitTerms(tw); }
    if (what === "panel-new") return newTerm(tw, null, null, shellCmd(getv("defaultShell")));
    if (what === "panel-new-menu") return menu(function () { return newTermMenu(tw); }, { el: el, side: "below-end" });
    if (what.indexOf("term-") === 0) { tw.st.cur = +what.slice(5); renderPanel(tw); return; }
    if (what.indexOf("kill-") === 0) return killTerm(tw, +what.slice(5));
    if (what === "cwd") { var P = tw.ws.active; if (P && P.shell && P.shell.cwd && window.TSU_BROWSER) TSU_BROWSER.go(P.shell.cwd(), null); }
  }
  // 连接器的介绍页（扩展详情）：辅助侧栏暂时收起（宽度给介绍页），离开这一页自动恢复——设置里的开关（L.side）不动。
  //   这时右上角的开关画成虚线的侧栏（「暂时收起」：还在、点一下就出来）；点了就这一页里开着（tw.sideForce），离开这一页再回来又收起
  //   同样的还有：浏览器、更新内容、键盘快捷方式、设置这些「页面」——右侧栏是 Agent 的（目标、在跑的、后台任务），看网页、看说明时用不上；
  //   对话、终端、文件（看 Agent 改的东西时常要对着它的进度）照旧
  var SIDE_OFF_PAGES = { extension: 1, web: 1, changelog: 1, keys: 1, settings: 1, explorer: 1 };
  var sideAuto = function (tw) { var P = tw && tw.ws && tw.ws.active, pg = P && P.program && P.program.page; return !!(L.side && pg && SIDE_OFF_PAGES[pg] && tw.sideForce !== P); };
  var sideVis = function (tw) { return !!L.side && !sideAuto(tw); };
  function toggleSide(tw, on) {
    parts(tw);
    if (on === undefined && sideAuto(tw)) { tw.sideForce = tw.ws.active; render(tw); compMoved(); return; } // 暂时收起着：点一下就是在这一页里打开
    L.side = on === undefined ? !L.side : !!on; saveL(); render(tw); compMoved();
  }
  // 输入框换了地方（右侧栏开关、右侧栏的「输入框」勾没勾）：编辑区里的 agent 重画（输入框、转圈、任务清单跟着走）
  function compMoved() { allPanes().forEach(function (p) { if (!p.side && p.program && p.program.agentId && p.renderLater) p.renderLater(); }); }
  function setSideView(tw, k, v) { var sv = Object.assign({}, realSide()); sv[k] = v; L.sideView = sv; saveL(); sideRefresh(tw, k === "composer"); }
  function sideRefresh(tw, comp) { render(tw); if (comp) compMoved(); var sp = tw.sidePane; if (sp && sp.program) sp.renderNow(); }
  // 预览一项：on = 看看换过去的样子，off = 回到原来的
  var sidePrev = function (tw, k, v) { return function (on) { SVP = on ? (function () { var o = {}; o[k] = v; return o; })() : null; sideRefresh(tw, k === "composer"); }; };
  // 右侧栏（Agent 那一层）的 ···：这里只放这个 agent 的「任务」一家子——勾选显示哪几块（同设置、对话 ··· 里的「显示」）。对话、输入框不放这里
  function sideMenu(tw) { return asideMenu(tw, true); }
  // 辅助侧栏上右键 / ···：Agent 那一层——这里显示哪几块（任务清单 ⌃T、后台任务；子 Agent 在面板里时就不在这里列）；两层：Agent / 全局；隐藏辅助侧栏
  function asideMenu(tw, dots) {
    var P = agentPaneFor(tw), aid = P && P.program && P.program.agentId, g = (L.sideLevel || "agent") === "global";
    var fam = g ? [] : famToggles(aid).filter(function (x) { return !(x.label === "子 Agent" && subsInFoot(tw)); });
    var lv = window.TSU_GLOBAL ? [{ label: "助手", icon: (window.TSU_LOGOS && TSU_LOGOS.paimon) || MI.answer, checked: g, run: function () { L.sideLevel = g ? "agent" : "global"; saveL(); render(tw); } }] : []; // 右侧栏换成 Studio 的助手（再点一下回到这个 agent 的任务）
    return fam.concat(fam.length && lv.length ? [{ sep: true }] : [], lv, [{ sep: true }, { label: "隐藏辅助侧栏", icon: MI.sideR, keys: "⌥⌘I", run: function () { toggleSide(tw, false); } }]);
  }
  // agent 的底部上右键：显示哪几块（运行状态行、状态信息、子 Agent）、隐藏面板——只管这一块
  function footMenu(tw) {
    var A = window.TSU_AGENTS, c = acfg(), items = [];
    if (A && A.setCfg) {
      // 运行状态行：这个 agent 的标签页有自己的一套筛选（Claude Code 的会话默认套着预设）就改它的那一套，不然只改设置（被它那一套盖着，点了没反应）
      var P = agentPaneFor(tw), TT = window.TSU_TERM, fullV = !!(P && P.view && P.view.vals && TT && TT.viewAcc);
      var wl0 = fullV && "workLine" in P.view.vals ? P.view.vals.workLine : c.workLine;
      var wOn = (wl0 || "full") !== "hidden", sOn = c.subList !== false, iOn = c.footInfo !== false;
      var redrawAll = function () { if (TT && TT.front && TT.front()) (TT.front().ws.all ? TT.front().ws.all() : []).forEach(function (p) { if (p.renderNow) p.renderNow(); }); };
      items.push({ label: "运行状态行", icon: MI.workline, checked: wOn, run: function () {
          var v = wOn ? "hidden" : "full";
          if (fullV) return TT.viewAcc(P.view, function (prev) { P.renderNow(); if (!prev && window.TSU_VSPLIT && TSU_VSPLIT.setView) TSU_VSPLIT.setView(P, 0, P.view); }).setMode("workLine", v);
          if (A.setCfg("workLine", v)) redrawAll();
        } },
        { label: "状态信息", icon: MI.info, checked: iOn, run: function () { A.setCfg("footInfo", !iOn); } },
        { label: "子 Agent", icon: MI.fork, checked: sOn, run: function () { A.setCfg("subList", !sOn); familyChanged(); } }, { sep: true });
    }
    return items.concat([{ label: "隐藏面板", icon: MI.panel, keys: "⌘J", run: function () { togglePanel(tw, false); } }]);
  }
  // 辅助侧栏的两层：Agent · 全局，单选
  function levelItems(which, tw) {
    var cur = L.sideLevel || "agent";
    var go = function (lv) { return function () { action(tw, "side-lv-" + lv); }; };
    return [{ label: "Agent", radio: true, checked: cur === "agent", run: go("agent") }, { label: "全局", radio: true, checked: cur === "global", run: go("global") }];
  }
  // ======== 面板的 Agent 那一层 = agent 的底部（同 VS Code 面板的位置）：跟着的那个 agent（同辅助侧栏：编辑区当前的，不是 agent 时是最近用的）的
  //   在跑的那一行（转圈、用时、token，排着的）· 输入框 · 状态信息（权限、余额、上下文、模型）。agent 标签页里就只剩对话。
  //   只在 VS Code 风格；面板关着（⌘J）、切到「全局」那一层时，输入框、在跑的那一行回到 agent 标签页自己下面，输入不会没地方。终端界面的 agent（图形界面的下一步）
  var sideAgent = function (P) { var pr = P && P.program; return pr && pr.agentId && !pr.gui ? pr.agentId : null; };
  // 面板现在是哪个视图：agent（跟着的那个 agent 的底部）· term（终端）· activity（Agent 活动）。以前的「全局」那一层算终端
  var pTab = function () { if (!L.panelTab) L.panelTab = L.panelLevel === "global" ? "term" : "agent"; return L.panelTab; };
  // agent 的底部不放面板里了：同 agent 的标签页是一块地方（输入框、在跑的那一行、状态信息、子 Agent 都在标签页自己下面）。这些面板里的代码留着不用（footOn 一直是 false）
  var footOn = function () { return false; };
  function composerAway(P) { return !!(footOn() && P && !P.side && sideAgent(P)); }
  // 输入框在面板里：焦点给那里（先跟上跟着的那个 agent）
  function focusSide(tw) {
    if (!tw || !footOn()) return false;
    renderPanel(tw);
    var gv = tw.st && tw.st.docked, gta = gv && gv.dockCol ? gv.dockCol().querySelector("textarea") : null;
    if (gta) { gta.focus({ preventScroll: true }); return true; } // 图形界面：搬进来的那一列的输入框
    var sp = tw.sidePane;
    if (!sp || !sp.el.isConnected || sp.el.parentNode.hidden || !sp.program) return false;
    if (sp.program.focus) sp.program.focus(); else sp.ta.focus({ preventScroll: true });
    return true;
  }
  function fitPanel(tw) {
    var S = parts(tw), panel = S.panel, lab = panel.parentNode, maxH = Math.round(((lab && lab.clientHeight) || innerHeight) * 0.8), want = 0;
    var host = Array.prototype.filter.call(panel.querySelectorAll(".st-pv:not([hidden]):not(.folded) .tr-host"), function (x) { return x.getClientRects().length; })[0];
    if (host) {
      var top = host.querySelector(".am-top"), split = host.querySelector(".am-split"), body = host.querySelector(".am-body"), foot = host.querySelector(".am-footw");
      var hb = body ? body.scrollHeight : 0, hf = foot ? foot.scrollHeight : 0, content = split && split.classList.contains("h") ? Math.max(hb, hf) : hb + hf + 1;
      var chrome = panel.offsetHeight - host.clientHeight; // 面板的标题栏、边框
      want = (top ? top.offsetHeight : 0) + content + chrome + 6;
    } else want = Math.round(((lab && lab.clientHeight) || innerHeight) * 0.4);
    want = Math.max(140, Math.min(maxH, want));
    if (Math.abs(panel.offsetHeight - want) < 6 && L.panelHPrev) { want = L.panelHPrev; L.panelHPrev = 0; } else L.panelHPrev = panel.offsetHeight;
    L.panelH = want; panel.style.height = want + "px";
  }
  // 面板多高：全局那一层用记下的高度（L.panelH）；Agent 那一层默认贴着内容（在跑的那一行、输入框多高就多高，上限是窗口的一半多），拖过就用拖的那个（L.panelHA）
  function panelHeight(tw) {
    var S = tw && tw.st;
    if (!S || S.panel.classList.contains("max")) return;
    S.panel.style.height = footOn() ? (L.panelHA ? L.panelHA + "px" : "") : L.panelH + "px";
  }
  var footCap = function (S) { return Math.max(120, Math.round((S.lab.clientHeight || 600) * 0.6)); };
  function footFit(tw) { var sp = tw && tw.sidePane; if (sp && sp.program && sp.el.isConnected && sp.fit) { sp.compact = !L.panelHA; sp.el.classList.toggle("compact", sp.compact); sp.fit(); if (sp.stick) sp.stick(); } }
  function syncFoot(tw, S) {
    var host = S.panel.querySelector(".st-pagent"), on = footOn(), AP = on ? agentPaneFor(tw) : null, id = AP && sideAgent(AP);
    var gv = AP && AP.program && AP.program.gui && AP.program.dock ? AP.program : null; // 图形界面的 agent：把它输入框那一列整列搬进来（gui.js V.dock）
    if (S.footWas !== on) { var first = S.footWas === undefined; S.footWas = on; if (!first) compMoved(); } // 换了风格、开关面板、换了层：agent 标签页里的输入框跟着来回
    S.panel.classList.toggle("st-plv-agent", on);
    S.panel.querySelectorAll(".st-plv > button").forEach(function (b) { b.classList.toggle("on", b.dataset.st === (on || (L.panelLevel || "agent") === "agent" ? "panel-lv-agent" : "panel-lv-global")); });
    S.panel.querySelector(".st-pviews").hidden = on;
    host.hidden = !on;
    panelHeight(tw);
    // 换了跟着的 agent、面板关了 / 到了全局那一层：搬进来的那一列还回去（它里面的「子 Agent」那块收起来）
    if (S.docked && (S.docked !== gv || !on)) { try { var ob = S.docked.dockCol && S.docked.dockCol().querySelector(":scope > .st-fsubs"); if (ob) ob.hidden = true; S.docked.dock(null); } catch (e) { /* 那个界面已经没了 */ } S.docked = null; }
    if (!on) { S.footShown = false; return; }
    var msg = host.querySelector(":scope > .st-pempty"), dk = host.querySelector(":scope > .st-gdock");
    if (gv) {
      if (msg) msg.hidden = true;
      if (tw.sidePane) tw.sidePane.el.hidden = true;
      if (!dk) { dk = document.createElement("div"); dk.className = "st-gdock"; host.appendChild(dk); }
      dk.hidden = false;
      if (S.docked !== gv) { gv.dock(dk); S.docked = gv; }
      S.footShown = false;
      footSubs(tw);
      return;
    }
    if (dk) dk.hidden = true;
    // 一个 agent 都没开：说一句
    if (!id) {
      if (!msg) { msg = document.createElement("div"); msg.className = "st-dim st-pempty"; host.appendChild(msg); }
      if (msg.textContent !== "没有打开的 agent") msg.textContent = "没有打开的 agent";
      msg.hidden = false;
      if (tw.sidePane) tw.sidePane.el.hidden = true;
      S.footShown = false;
      return;
    }
    if (msg) msg.hidden = true;
    var sp = T().sidePane(tw), fresh = !S.footShown;
    sp.el.hidden = false;
    if (sp.el.parentNode !== host) {
      host.appendChild(sp.el);
      sp.maxH = function () { var fs = sp.el.querySelector(":scope > .st-fsubs"); return footCap(S) - 30 - (fs && !fs.hidden ? fs.offsetHeight : 0); }; // 贴着内容时最高多少（减去面板标题行、子 Agent 那一块）
      // 在面板里换 agent（/名字）、退出：交给编辑区（面板跟着编辑区的那个）
      sp.onRun = function (prog) {
        var m = agentPaneFor(tw) || tw.ws.active, cur = sideAgent(m);
        if (prog.agentId && prog.agentId === cur) return false;
        if (prog === sp.shell) { if (m && m.program && m.program.exit) m.program.exit(); return true; }
        if (prog.agentId) { if (cur) m.run(T().agentView(m, prog.agentId)); else T().agent(prog.agentId); }
        return true;
      };
    }
    sp.view = {}; // 对话一条都不画：只有在跑的那一行、输入框、状态信息
    sp.compact = !L.panelHA;
    sp.el.classList.toggle("compact", sp.compact);
    sp.el.classList.remove("nofoot");
    if (!sp.program || sp.program.agentId !== id) { sp.ta.value = ""; sp.run(T().agentView(sp, id), true); }
    else if (fresh) { if (sp.program.syncDraft) sp.program.syncDraft(); sp.renderLater(); }
    S.footShown = true;
    footSubs(tw);
  }
  function togglePanel(tw, on) {
    var S = parts(tw);
    L.panel = on === undefined ? !L.panel : !!on;
    saveL();
    familyChanged(); // 子 Agent 在面板和辅助侧栏之间换地方
    if (footOn()) { renderPanel(tw); compMoved(); if (L.panel) setTimeout(function () { focusSide(tw); }, 0); layBar(tw); return; } // Agent 那一层：输入框挪到面板里，焦点给它
    renderPanel(tw); // 面板关了：搬进去的那一列（图形界面）还回去
    compMoved(); // 面板关了 / 在全局那一层：输入框回到 agent 标签页自己下面
    if (L.panel && !S.terms.length) newTerm(tw); else renderPanel(tw);
    if (L.panel && S.terms[S.cur] && S.terms[S.cur].term) setTimeout(function () { S.terms[S.cur].term.focus(); }, 0);
    layBar(tw); // 右上角那几个开关的样子跟着（开着是实的）
  }
  // 面板的两层：Agent / 全局
  // 面板换一个视图：agent 的底部 · 终端 · Agent 活动（同 VS Code 面板上面那排）
  function panelTab(tw, tab) {
    var S = parts(tw);
    if (["agent", "term", "activity"].indexOf(tab) < 0 || pTab() === tab) return;
    L.panelTab = tab;
    saveL();
    if (tab === "agent") S.panel.classList.remove("max"); // 放大是终端那些看得多一点用的；agent 的底部贴着内容
    renderPanel(tw);
    compMoved();
    familyChanged(); // 子 Agent 在面板和辅助侧栏之间换地方
    if (tab === "term" && L.panel && !S.terms.length) newTerm(tw);
    fitTerms(tw);
    if (tab === "agent") setTimeout(function () { focusSide(tw); }, 0);
  }
  // 打开面板里的某个视图（菜单栏 › 显示 › 终端 / Agent 活动）：面板开着、这个视图显示着、展开着。
  // 以前的「后台任务」「子 Agent」都到「Agent 活动」；Claude App 里是右边「后台任务」那张卡片（点标题栏上它的开关）
  function panelView(tw, v) {
    if (v === "agents" || v === "tasks" || v === "activity") v = pvAvail("activity") ? "activity" : "tasks";
    if (v === "tasks" && root.classList.contains("st-os-claude")) { var tg = tw.el.querySelector('.ca-tog[data-c="tasks"]:not(.on)'); if (tg) tg.click(); return; }
    var S = parts(tw);
    L.pvOff = L.pvOff || {}; delete L.pvOff[v];
    if (L.pvFold) delete L.pvFold[v];
    saveL();
    if (!L.panel) togglePanel(tw, true); else renderPanel(tw);
    if (v === "term" && S.terms[S.cur] && S.terms[S.cur].term) setTimeout(function () { S.terms[S.cur].term.focus(); }, 0);
    fitTerms(tw);
  }
  // 状态栏右键的菜单：隐藏状态栏；这个标签页交出来、放在状态栏的每一项（勾掉 = 隐藏，勾上 = 回到状态栏），指着就预览
  function statusMenu(tw) {
    var P = tw.ws.active, items = [{ label: "隐藏状态栏", icon: MI.status, run: function () { setv("statusBar", false); } }];
    var els = list(P).filter(function (el) {
      if (!TYPES[el.type]) return false;
      var site = el.site || "paimon", k = site + ":" + el.id, cur = slotOf(site, el.id, true);
      return cur === "status" || cur === "hidden" && (DEFAULT[k] || "status") === "status";
    });
    if (els.length) items = items.concat([{ sep: true }], els.map(function (el) {
      var site = el.site || "paimon", on = slotOf(site, el.id, true) === "status", to = on ? "hidden" : "status";
      return { label: titleOf(el), icon: MI.status, checked: on, run: function () { place(site, el.id, to); }, preview: function (p) { previewSlot(site, el.id, p ? to : null); } };
    }));
    return items;
  }
  // 顶栏右键：顶栏上的每一样（地址栏、布局控件，以及平时不放的新建标签页、标签页概览）显示 / 隐藏，同 VS Code
  var TITLE_ITEMS = [["address", "地址栏"], ["layout", "布局控件"], ["newTab", "新建标签页"], ["overview", "标签页概览"]];
  var TITLE_ICONS = { address: "web", layout: "layout", newTab: "tab", overview: "window" };
  var titleIcon = function (k) { return k === "newTab" ? MIc('<path d="M8 3v10M3 8h10"/>') : k === "overview" ? LAY_ICONS.overview : k === "layout" ? LAY_ICONS.custom : MI[TITLE_ICONS[k]]; }; // 和标题栏上的按钮同一个图标
  var TBP = null; // 预览：指着的那一项临时换过来
  var titleOn = function (k, real) { if (!real && TBP && k in TBP) return TBP[k]; var t = getv("titleBar") || {}; return k in t ? !!t[k] : !!SET_DEF.titleBar[k]; };
  function applyTitle() { TITLE_ITEMS.forEach(function (x) { root.classList.toggle("st-tb-" + x[0], titleOn(x[0])); }); }
  function titleMenu() {
    return TITLE_ITEMS.map(function (x) {
      var on = titleOn(x[0], true);
      return { label: x[1], icon: titleIcon(x[0]), checked: on, run: function () { var t = Object.assign({}, SET_DEF.titleBar, getv("titleBar") || {}); t[x[0]] = !on; setv("titleBar", t); }, preview: function (p) { TBP = p ? (function () { var o = {}; o[x[0]] = !on; return o; })() : null; applyTitle(); } };
    });
  }
  function toggleStatus(on) { setv("statusBar", on === undefined ? !getv("statusBar") : !!on); }

  // ---- TUI 的小菜单（放在哪、状态栏点开的一块）：等宽字、一圈细线、❯ 指着的那项 ----
  var popEl = null;
  function closePop() { if (popEl) { popEl.remove(); popEl = null; } }
  function popAt(html, x, y, below) {
    closePop();
    var box = popEl = document.createElement("div");
    box.className = "st-pop terminal-style-ui";
    box.innerHTML = html;
    document.body.appendChild(box);
    var w = box.offsetWidth, h = box.offsetHeight;
    box.style.left = Math.max(6, Math.min(innerWidth - w - 6, x)) + "px";
    box.style.top = Math.max(6, below ? y : y - h - 6) + "px";
    setTimeout(function () {
      var off = function (e) { if (!box.contains(e.target)) { closePop(); document.removeEventListener("pointerdown", off, true); document.removeEventListener("keydown", esc2, true); } };
      var esc2 = function (e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closePop(); document.removeEventListener("pointerdown", off, true); document.removeEventListener("keydown", esc2, true); } };
      document.addEventListener("pointerdown", off, true);
      document.addEventListener("keydown", esc2, true);
    }, 0);
    return box;
  }
  function placeMenu(el, x, y) {
    var site = el.site || "paimon", cur = slotOf(site, el.id);
    var opts = SLOTS.filter(function (s) { return s[0] !== "inline" || site === "paimon"; });
    var box = popAt('<div class="st-dim">「' + esc(titleOf(el)) + "」放在</div>" + opts.map(function (s) {
      return '<div class="st-mi" data-slot="' + s[0] + '">' + (s[0] === cur ? '<span class="st-lav">❯ ' + s[1] + " ✔</span>" : "  " + s[1]) + "</div>";
    }).join(""), x, y, true);
    box.addEventListener("click", function (e) { var m = e.target.closest("[data-slot]"); if (m) { place(site, el.id, m.dataset.slot); closePop(); } });
  }
  function pop(tw, el, item) {
    var r = item.getBoundingClientRect(), t = TYPES[el.type];
    if (!t) return;
    popAt('<div class="st-b">' + esc(titleOf(el)) + '</div>' + t.block(el) + '', r.left, r.top);
  }

  // ---- 画 ----
  var rq = new Map();
  function renderSoon(tw) { if (!tw || rq.has(tw)) return; rq.set(tw, requestAnimationFrame(function () { rq.delete(tw); render(tw); })); }
  // agent 这一级（辅助侧栏的 Agent 那一层、Claude App 的「后台任务」卡片）跟着哪个 agent：编辑区当前的是 agent（Paimon 的、Claude Code / Codex 的会话，终端界面、图形界面）就是它；
  // 不是（设置、文件、别的页面）就是这个窗口里最近用过的那个 agent 标签页，它关了就是随便一个还开着的——不留一块没意义的空白
  function agentPaneFor(tw) {
    var ws = tw && tw.ws, P = ws && ws.active, isAg = function (p) { return !!(p && !p.side && !p.closed && p.program && p.program.agentId); };
    if (isAg(P)) { tw._lastAgentP = P; return P; }
    var all = ws && ws.all ? ws.all() : [], last = tw && tw._lastAgentP;
    if (isAg(last) && all.indexOf(last) >= 0) return last;
    return all.filter(isAg)[0] || null;
  }
  var agentName = function (aid) { var a = null; try { a = aid && window.TSU_AGENTS ? TSU_AGENTS.get(aid) : null; } catch (e) { a = null; } return (a && a.name) || ""; };
  // 辅助侧栏的 Agent 那一层：跟着的那个 agent 的「任务」一家子（任务清单、后台任务、子 Agent），上面可能还有一张点开看的图片——别的不放
  // （以前能把对话、输入框放进来；现在输入框在 agent 底部，对话在编辑区：有规律）。标题行写着是哪个 agent（点一下切到它的标签页）
  function sideBody(tw, S) {
    var sc = S.side.querySelector(".st-scomp");
    if (sc && !sc.hidden) { sc.hidden = true; S.sideShown = false; }
    S.side.classList.remove("chat");
    var AP = agentPaneFor(tw), aid = AP && AP.program.agentId, nm = agentName(aid);
    var lab = S.side.querySelector(".st-sagent");
    if (!lab) { lab = document.createElement("button"); lab.type = "button"; lab.className = "st-sagent"; lab.dataset.st = "side-agent"; var lv = S.side.querySelector(".st-sidehdr .st-sidelv"); if (lv) lv.after(lab); }
    // 名字左边是这个 agent 的标志（同右边的「···」一左一右）：Claude Code 的会话是 Claude 的标志（橙）、Codex 的是它的记号、Paimon 的是派蒙的头像
    var LG = window.TSU_LOGOS || {}, alg = /^cc:/.test(aid || "") ? LG.claude : /^cx:/.test(aid || "") ? LG.codex : /^pi:/.test(aid || "") ? LG.pi : /^ty:/.test(aid || "") ? LG.teyvat : LG.paimon;
    var lk = /^cc:/.test(aid || "") ? "cc" : /^(cx|pi|ty):/.test(aid || "") ? "cx" : "pm"; // pi、Teyvat 的标志同 Codex 的一样单色
    var lh = aid ? (alg ? '<i class="st-salogo st-salogo-' + lk + '" aria-hidden="true">' + alg + "</i>" : "") + '<span class="st-cut">' + esc(nm || aid) + "</span>" : "";
    if (lab.dataset.h !== lh) { lab.dataset.h = lh; lab.innerHTML = lh; }
    lab.hidden = !aid;
    lab.title = aid ? (AP === tw.ws.active ? nm : "当前：" + nm + "（最近使用的 Agent；点按以切换）") : "";
    lab.classList.toggle("away", !!aid && AP !== tw.ws.active);
    var art = null; try { art = aid && window.TSU_AGENTS ? TSU_AGENTS.runtime(aid) : null; } catch (e) { art = null; }
    lab.classList.toggle("busy", !!(art && (art.stream || (art.state && art.state() === "working")))); // 在跑：标志是橙的；闲着是灰的
    var fam = familyHost() === "side" && AP ? familyHtml(AP, subsInFoot(tw) ? ["todo", "bg"] : null) : ""; // 子 Agent 在面板的 Agent 那一层时，这里只放任务清单、后台任务
    var empty = aid ? '<div class="st-dim st-empty">这个 agent 现在没有任务清单、后台任务和子 Agent</div>' :
      '<div class="st-empty st-noag"><div>没有打开的 agent</div><div class="st-dim">打开或新建一个 agent，这里是它的任务清单、后台任务和子 Agent</div>' + (!window.TSU_CONNECTORS || TSU_CONNECTORS.on("paimon") ? '<button type="button" class="st-btn" data-st="new-agent">新建 Agent</button>' : "") + "</div>"; // Paimon Code 连接器关了：没有「新建 Agent」
    var html = (S.previewImg ? '<div class="st-sec st-prev"><div class="st-prevh"><span class="st-cut">预览 · ' + esc(S.previewImg.title || "") + '</span><span class="st-fill"></span><span class="st-x" data-st="preview-close" title="关闭预览">×</span></div><div class="st-prevb"><img src="' + esc(S.previewImg.src) + '" alt=""></div></div>' : "") +
      (fam || (S.previewImg ? "" : empty));
    var sb = S.side.querySelector(".st-sbody");
    sb.hidden = false;
    if (S.sideHtml !== html && !famPress) { var top = sb.scrollTop; S.sideHtml = html; sb.innerHTML = html; applyFold(sb); sb.scrollTop = top; }
  }
  // 正按在「任务」一家子上：先不换内容（每秒重画一次用时；这时换了，这一下点击就丢了）
  var famPress = false;
  document.addEventListener("pointerdown", function (e) { famPress = !!(e.target && e.target.closest && e.target.closest(".st-fam")); }, true);
  ["pointerup", "pointercancel"].forEach(function (t) { document.addEventListener(t, function () { setTimeout(function () { famPress = false; }, 0); }, true); });
  // 新建一个 agent，在新标签页里开（同标签栏「+」里的「新建 Agent」；Claude App 风格是开一张新会话的草稿）
  function newAgent(tw) {
    if (root.classList.contains("st-os-claude") && window.TSU_CLAUDEAPP && TSU_CLAUDEAPP.newSession) return TSU_CLAUDEAPP.newSession();
    var A = window.TSU_AGENTS;
    if (!A || !A.create || !tw || !tw.side || !tw.side.open) return;
    var ag = A.create({});
    if (ag && ag.id) tw.side.open(ag.id, "tab");
  }
  function render(tw) {
    if (!tw || !tw.open || !termapp()) return;
    if (!tw.stViewBack) { tw.stViewBack = true; if (L.leftView && L.leftView !== "agents" && (VIEWS[L.leftView] || /^(search|extensions)$/.test(L.leftView))) setTimeout(function () { showView(tw, L.leftView, false, true); }, 0); } // 上次主侧栏里开着的视图
    var S = parts(tw), P = tw.ws.active, els = list(P);
    if (tw.sideForce && tw.sideForce !== P) tw.sideForce = null; // 离开了点开过侧栏的那一页：下次再来照旧收起
    var sideV = sideVis(tw);
    // 右侧栏
    S.mid.classList.toggle("st-aside-on", sideV);
    S.lab.classList.toggle("st-aside-on", sideV);
    // 辅助侧栏的两层：Agent（下面原来那些）/ 全局（全局助手，globalagent.js 挂进 .st-sglob）
    // 辅助侧栏只有 agent 这一级（跟着的那个 agent 的任务、后台任务）；全局助手在面板的「助手」视图里。没有 Agent / 全局 的切换
    var lvG = L.sideLevel === "global" && !!window.TSU_GLOBAL, gh = S.side.querySelector(".st-sglob");
    if (L.side) {
      var hb0 = S.side.querySelector('.st-sidehdr [data-st="side-views"]');
      if (!hb0.innerHTML) hb0.innerHTML = ICO.more;
      S.side.classList.toggle("st-lv-global", lvG);
      S.side.querySelectorAll(".st-sidelv > button").forEach(function (b) { b.classList.toggle("on", b.dataset.st === (lvG ? "side-lv-global" : "side-lv-agent")); });
      gh.hidden = !lvG;
    }
    // 一块出错不连累别的（后面的标题栏布局按钮、面包屑照样画）；错还是报出去
    var later = function (e) { setTimeout(function () { throw e; }, 0); };
    try {
      if (lvG) {
        S.side.querySelector(".st-sbody").hidden = true;
        var sag = S.side.querySelector(".st-sagent");
        if (sag) sag.hidden = true;
        var sc = S.side.querySelector(".st-scomp");
        if (!sc.hidden) { sc.hidden = true; S.sideShown = false; }
        TSU_GLOBAL.mount(tw, gh);
      } else if (L.side) {
        sideBody(tw, S);
      }
      // 「Agent 活动」挪到了右侧栏：在它下面（窄的版式，一行一个会话）
      var sa = S.side.querySelector(".st-sact");
      if (sa) {
        var onS = L.actAt === "side" && sideVis(tw) && !lvG && !!window.TSU_TRACE, spl = S.side.querySelector(".st-sactsplit");
        if (sa.hidden === onS) sa.hidden = !onS;
        if (spl && spl.hidden === onS) spl.hidden = !onS;
        if (L.actH && !sa.classList.contains("sized")) { sa.classList.add("sized"); sa.style.height = L.actH + "px"; }
        if (onS) TSU_TRACE.render(sa);
      }
    } catch (e) { later(e); }
    statusBar(tw, S, P, els);
    try { renderPanel(tw); } catch (e) { later(e); }
    try { syncAct(tw); } catch (e) { later(e); }
    layBar(tw);
    crumbs(tw);
  }
  // 状态栏（窗口最下面一整行，同 VS Code）：左边在哪、在做什么；右边状态、上下文、模型、文件的语言。
  //   转圈、「几秒」在走的时候每 240ms 只重画这一行（以前整个窗口的东西——面板、右侧栏、标题栏——都跟着重画一遍，菜单开着指一下都卡）
  function statusBar(tw, S, P, els) {
    S = S || parts(tw); P = P || tw.ws.active; els = els || list(P);
    S.status.hidden = !getv("statusBar");
    if (getv("statusBar")) {
      var prog = P && P.program, cwd = P && P.shell && P.shell.cwd ? tilde(P.shell.cwd()) : "", left = [], rightI = [];
      var item = function (el) { var h = TYPES[el.type].line(el); return h ? '<span class="st-item" data-el="' + esc(el.id) + '" title="' + esc(titleOf(el)) + '">' + h + "</span>" : ""; };
      if (prog && prog.page === "file") left.push('<span class="st-item st-cwd" title="文件">' + esc(tilde(prog.arg || "")) + "</span>");
      // 不是终端了：状态栏不再挂「›_ 当前目录」（只有底下终端面板里的终端才有目录）
      els.forEach(function (el) {
        if (slotOf(el.site || "paimon", el.id) !== "status" || !TYPES[el.type]) return;
        var h = item(el);
        if (!h) return;
        if (el.type === "tasks" || el.left) left.push(h); else rightI.push(h);
      });
      // agent 的上下文、模型不放这里：在 agent 底部、输入框下面（状态栏只放工作区的东西）
      if (prog && prog.page === "file") { var lang = window.TSU_HL ? TSU_HL.langName(prog.arg || "") : ""; if (lang) rightI.push('<span class="st-item st-dim">' + esc(lang) + "</span>"); rightI.push('<span class="st-item st-dim">UTF-8</span>'); }
      if (updateReady && !appUpd) rightI.push('<span class="st-item st-update" data-st="reload" title="重新载入以使用新版本">有新版本</span>');
      if (appUpd) rightI.push('<span class="st-item st-update" data-st="app-update" title="' + esc("换上 Vibing Studio " + appUpd.ver + " 并重新打开：标签页、会话都会接回去；旧版留在 Application Support/Vibing Studio/previous") + '">' + esc(updWait ? "按 ⌘Q 退出后自动换上新版本并重新打开" : "App 有新版本 · 重启以更新") + "</span>");
      var sh = left.join('<span class="st-gap"></span>') + '<span class="st-fill"></span>' + rightI.join('<span class="st-gap"></span>');
      if (S.statusHtml !== sh) { S.statusHtml = sh; S.status.innerHTML = sh; }
    }
  }

  // 对话里点了 [Image #N]：在屏幕中间放大看（lightbox）；右侧栏那份预览（以前点了放这里）照旧能用：preview(tw, o)
  function preview(tw, o) { var S = parts(tw); S.previewImg = o; if (!L.side) toggleSide(tw, true); else render(tw); }
  // ======== 图片：悬停在 [Image #N] 上浮出一张小预览（离开就收）；点一下在屏幕中间放大，后面毛玻璃；点外面任何地方、Esc、同一个再点一下都关 ========
  // 悬停的小图按「哪张图」（data-img 键）认，不按元素认：对话每秒重画、[Image #N] 那个元素被换掉时——
  //   同一张图就只把位置对到新元素上（不重建、不闪）；鼠标下面已经不是这张图了（元素没了、滚走了、移开了）就收掉，不会卡在屏幕上
  var peekEl = null, peekFor = null, peekKey = "", peekT = 0, LB = null, ptX = -1, ptY = -1;
  var IMGREF = '.st-imgref, a[href*="#vs-img:"]'; // [Image #N]，和读图工具那行「Read image (…)」的链接
  var peekKeyOf = function (ref) { var d = (ref && ref.dataset) || {}, h = /#vs-img:(\w+)/.exec((ref && ref.getAttribute && ref.getAttribute("href")) || ""); return h ? h[1] : d.img || d.src || ""; };
  function peekHide(now) {
    clearTimeout(peekT);
    var go = function () { if (peekEl) peekEl.remove(); peekEl = null; peekFor = null; peekKey = ""; };
    if (now) go(); else peekT = setTimeout(go, 80);
  }
  function peekPlace() {
    if (!peekEl || !peekFor || !peekFor.isConnected) return;
    var im = peekEl.firstChild;
    if (im && !im.complete) return; // 图还没解码好：onload 时再放
    var r = peekFor.getBoundingClientRect(), w = peekEl.offsetWidth, h = peekEl.offsetHeight, x = Math.min(Math.max(8, r.left), innerWidth - w - 8), y = r.top - h - 8;
    if (y < 8) y = Math.min(innerHeight - h - 8, r.bottom + 8); // 上面放不下：放下面
    peekEl.style.left = Math.round(x) + "px"; peekEl.style.top = Math.round(y) + "px"; peekEl.classList.add("on");
  }
  // 浮着的时候每 200ms 看一眼：挂着的元素被重画换掉了，就按鼠标位置找回同一张图的新元素；找不到（或已经不是它）就收
  function peekWatch() {
    if (!peekEl) return;
    if (!peekFor || !peekFor.isConnected) {
      var el = ptX >= 0 ? document.elementFromPoint(ptX, ptY) : null, r = el && el.closest && el.closest(IMGREF);
      if (r && peekKeyOf(r) === peekKey) { peekFor = r; peekPlace(); } else return peekHide(true);
    }
    setTimeout(peekWatch, 200);
  }
  function imgPeek(ref, on) {
    clearTimeout(peekT);
    if (!on) return peekHide(true); // 鼠标离开就收（不再等 80ms——看着像卡了一下）
    if (LB) return;
    var k = peekKeyOf(ref);
    if (!k) return;
    if (peekEl && peekKey === k) { if (peekFor !== ref) { peekFor = ref; peekPlace(); } return; } // 同一张图：不重建
    if (peekEl) peekEl.remove();
    peekFor = ref; peekKey = k;
    peekEl = document.createElement("div");
    peekEl.className = "st-imgpeek";
    var im = new Image(); im.alt = ""; im.decoding = "async"; im.src = TSU_IMG.srcOf(ref); // blob: 地址：同一张图只解码一次；解码不占主线程
    peekEl.appendChild(im);
    document.body.appendChild(peekEl);
    if (im.complete) peekPlace(); else im.onload = peekPlace;
    setTimeout(peekWatch, 200);
  }
  // 鼠标在哪：移到别处（不是这张图的 [Image #N]）就收；滚动、按下、按键、窗口失焦也收
  document.addEventListener("mousemove", function (e) {
    ptX = e.clientX; ptY = e.clientY;
    if (!peekEl) return;
    var r = e.target.closest && e.target.closest(IMGREF);
    if (!r || peekKeyOf(r) !== peekKey) peekHide(true);
    else if (r !== peekFor) { clearTimeout(peekT); peekFor = r; peekPlace(); }
  }, true);
  ["mousedown", "keydown"].forEach(function (t) { document.addEventListener(t, function () { if (peekEl) peekHide(true); }, true); });
  // 滚动（手滚、对话自己跟着往下滚）：鼠标下面还是这张图就跟着挪过去，不是了就收
  document.addEventListener("scroll", function () {
    if (!peekEl) return;
    var el = ptX >= 0 ? document.elementFromPoint(ptX, ptY) : null, r = el && el.closest && el.closest(IMGREF);
    if (r && peekKeyOf(r) === peekKey) { peekFor = r; peekPlace(); } else peekHide(true);
  }, true);
  window.addEventListener("blur", function () { if (peekEl) peekHide(true); });
  // 存在文件里的图（这边附的截图）刚读好：正浮着的就是它的话换上
  window.addEventListener("tsu-img", function (e) {
    if (!peekEl || peekKey !== (e.detail || "")) return;
    var im = peekEl.querySelector("img"), u = TSU_IMG.url(peekKey);
    if (im && u && im.src !== u) { im.onload = peekPlace; im.src = u; }
  });
  function lightbox(src) {
    var same = LB && LB.src === src;
    if (LB) { modalClose(LB.M); if (same) return; }
    if (!src) return;
    if (peekEl) peekHide(true);
    var box = document.createElement("div");
    box.className = "st-lbwin";
    var im = new Image(); im.alt = ""; im.decoding = "async"; im.src = src;
    box.appendChild(im);
    var onKey = function (e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
    var close = function () { if (LB && LB.box === box) { lbShut = Date.now(); modalClose(LB.M); } };
    // noInert：看图不把整个 App 标成 inert——标一次要把几万个元素的样式全部重算（对话开得多时要大半秒，点了图要等一下才出来）；看图点哪儿都是关，用不着
    var M = modalOpen(box, { cls: "st-lb", noInert: true, onBackdrop: close, onClose: function () { document.removeEventListener("keydown", onKey, true); if (LB && LB.box === box) LB = null; } });
    M.layer.addEventListener("click", function (e) { if (e.target !== im) close(); }); // 图片以外（毛玻璃、四周）点一下就关
    document.addEventListener("keydown", onKey, true);
    LB = { M: M, box: box, src: src };
    void M.layer.offsetWidth; M.layer.classList.add("on"); // 先按没开的样子排一次版，再加 on：过渡照样有（不靠 requestAnimationFrame——窗口在后面时它不跑）
  }
  // 整页听一次：[Image #N]（TUI 对话、Claude App、GUI 里带 data-src 的）悬停浮出、点了放大；右侧栏预览里的图点了也放大
  document.addEventListener("mouseover", function (e) { var r = e.target.closest && e.target.closest(IMGREF); if (r) imgPeek(r, true); }, true);
  document.addEventListener("mouseout", function (e) { var r = e.target.closest && e.target.closest(IMGREF); if (r && !(e.relatedTarget && r.contains(e.relatedTarget))) imgPeek(r, false); }, true);
  // 刚在毛玻璃上按下关掉的：这一下的 click 会落到底下那个 [Image #N] 上——别又打开（反复点就开开关关、越堆越卡）
  var lbShut = 0;
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest(IMGREF + ", .st-prevb img, .gv-imgs img");
    if (!t) return;
    e.preventDefault(); e.stopPropagation();
    if (!LB && Date.now() - lbShut < 350) return;
    lightbox(TSU_IMG.srcOf(t));
  }, true);

  // ======== 有新版本（同 VS Code 的「重启以更新」）：每分钟看一眼页面的脚本变了没有；变了状态栏右边出「有新版本」，点一下重新载入（终端会接回去）========
  var verSig = null, updateReady = false;
  // 界面的版本号（部署时写进 version.json）：现在跑的这一份（cur、built）、有新版本时新的那一个（next：「重新载入以更新（v0.2.301）」）、网站上最新的（site）。
  //   App 从这台 Mac 上读界面（TSU_UI_LOCAL）时，现在跑的、重新载入后会用的都是本机那份的 version.json——以前读的是网站上的：本机那份旧了也说「已是最新版本」
  var uiVer = { cur: "", built: "", next: "", site: "", siteAt: 0 };
  var verJ = function (j) { return j && j.version ? j : null; };
  var siteVerJ = function () { return fetch("version.json", { cache: "no-store", credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; }).then(verJ, function () { return null; }); };
  var localVerJ = function () {
    var LU = window.TSU_UI_LOCAL;
    if (!LU || !LU.dir || !LOC() || !LOC().read) return Promise.resolve(null);
    return LOC().read(LU.dir + "/version.json").then(function (b) { try { return verJ(JSON.parse(new TextDecoder().decode(new Uint8Array(b)))); } catch (e) { return null; } }, function () { return null; });
  };
  var readVerJ = function () { return window.TSU_UI_LOCAL ? localVerJ() : siteVerJ(); }; // 重新载入后会用的那一份
  var readVer = function () { return readVerJ().then(function (j) { return j ? String(j.version) : ""; }); };
  (LOC() && LOC().ready ? LOC().ready : Promise.resolve()).then(readVerJ, readVerJ).then(function (j) { if (j) { uiVer.cur = String(j.version); uiVer.built = j.built || ""; uiVer.curBuild = +j.build || 0; } });
  document.addEventListener("st-update-ready", function () { readVer().then(function (v) { uiVer.next = v; allWins().forEach(function (w) { renderSoon(w); }); }); });
  var localVer = ""; // 本地界面：页面载入后第一次读到的 version.json
  function checkVersion(force) {
    if (updateReady) { if (!document.hidden || force === true) readVer().then(function (v) { if (v && v !== uiVer.next) { uiVer.next = v; allWins().forEach(function (w) { renderSoon(w); }); } }); return; }
    if (document.hidden && force !== true) return;
    // App 从这台 Mac 上读界面文件（原生的 LocalUI）：看本地文件改没改（不问网站）；改了就是有新版本（点「重新载入以更新」/ ⌘R）
    var LU = window.TSU_UI_LOCAL, NN = window.nadosNative;
    if (LU && NN && NN.call) {
      var ready = function () { if (updateReady) return; updateReady = true; allWins().forEach(function (w) { renderSoon(w); syncAct(w); }); document.dispatchEvent(new Event("st-update-ready")); };
      NN.call("ui.stamp").then(function (r) { if (r && r.stamp && r.stamp > (LU.stamp || 0)) ready(); }, function () {});
      // 原生那边只看界面目录最上面一层的改动时间（只改了 studio/ 里的不算）：再看一眼目录里的 version.json——每次部署都会改它
      if (LU.dir && LOC() && LOC().read) LOC().read(LU.dir + "/version.json").then(function (b) {
        var v = ""; try { v = String(JSON.parse(new TextDecoder().decode(new Uint8Array(b))).version || ""); } catch (e) { v = ""; }
        if (!v) return;
        if (!localVer) localVer = v; else if (v !== localVer) ready();
      }, function () {});
      return;
    }
    Promise.all(["studio/studio.js", "live.js", "studio/browser.js"].map(function (f) {
      return fetch(f, { method: "HEAD", cache: "no-store", credentials: "same-origin" }).then(function (r) { return r.ok ? r.headers.get("etag") || r.headers.get("last-modified") || "" : ""; }, function () { return ""; });
    })).then(function (tags) {
      if (!tags.every(Boolean)) return;
      var sig = tags.join("|");
      if (verSig === null) { verSig = sig; return; }
      if (sig !== verSig) { updateReady = true; allWins().forEach(function (w) { renderSoon(w); syncAct(w); }); document.dispatchEvent(new Event("st-update-ready")); } // Claude App 的边栏（新建上面那张「有新版本」卡片）也听这个
    });
  }
  setTimeout(checkVersion, 4000);
  setInterval(checkVersion, window.TSU_UI_LOCAL ? 5000 : 60000); // 本地界面：本地文件，问一次很便宜

  // ======== App 本身（原生那部分）的新版本：编好的新版放在 ~/Library/Application Support/Vibing Studio/update/（tools/stage-app.sh），比现在跑的新就在状态栏写
  //   「App 有新版本 · 重启以更新」——不弹窗；你点了才换：先把手上的记下（TSU_FLUSH），交给一个独立的小脚本等 App 退出、把旧版挪到 previous/（留着，不进废纸篓）、
  //   新版放到原位、重新打开。App 自己终端标签页里还有程序在跑的，退出前它照常问一声 ========
  var appUpd = null, appBuild = 0;
  var UPD_DIR = function () { var I = LOC() && LOC().info ? LOC().info() : null; return I && I.home ? I.home + "/Library/Application Support/Vibing Studio/update" : ""; };
  // 新版 App 的签名能不能用：签它的证书被 Apple 吊销了的，macOS 一打开就当恶意软件扔进废纸篓（2026-10-13 的 296 就是这样，原来的 App 也跟着没了）——
  //   这种不放进「待更新」、不给「重启以更新」，挪到 previous/（不删）。签名不完整的同样。没联网、查不了吊销的照旧
  var sigBad = {}, sigOkAt = {};
  var shq0 = function (x) { return "'" + String(x).replace(/'/g, "'\\''") + "'"; };
  function appSigProblem(appPath) {
    return LOC().exec({ cmd: "/usr/bin/codesign --verify --strict " + shq0(appPath) + " >/dev/null 2>&1 || echo SIGBAD; /usr/sbin/spctl -a -t exec -vv " + shq0(appPath) + " 2>&1 | head -4" }).then(function (r) {
      var o = String((r && (r.out || r.stdout)) || "") + String((r && (r.err || r.stderr)) || "");
      return /SIGBAD/.test(o) ? "签名不完整" : /REVOKED/i.test(o) ? "签它的证书已被 Apple 吊销" : "";
    }, function () { return ""; });
  }
  function setAside(dir, build) {
    var prev = dir.replace(/\/update$/, "/previous");
    return LOC().exec({ cmd: "U=" + shq0(dir) + "; P=" + shq0(prev) + '; [ -d "$U/Vibing Studio.app" ] && mkdir -p "$P" && mv "$U/Vibing Studio.app" "$P/rejected-' + (+build || 0) + '-$(date +%Y%m%d-%H%M%S).app"; echo OK' }).catch(function () {});
  }
  function checkAppUpdate(force) {
    var N = window.nadosNative, dir = UPD_DIR();
    if (!SLOC() || !N || !N.call || !dir || (document.hidden && !force)) return Promise.resolve();
    return (appBuild ? Promise.resolve(appBuild) : N.call("info").then(function (i) { appBuild = +(i && i.build) || 0; return appBuild; })).then(function (cur) {
      if (!cur) return;
      return LOC().read(dir + "/Vibing Studio.app/Contents/Info.plist").then(function (b) {
        var x = new TextDecoder().decode(new Uint8Array(b)), bv = /<key>CFBundleVersion<\/key>\s*<string>(\d+)<\/string>/.exec(x), sv = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(x);
        var nu = bv && +bv[1] > cur ? { build: +bv[1], ver: sv ? sv[1] : String(bv[1]) } : null;
        if (nu && sigBad[nu.build]) nu = null;
        // 放进来的这一版：签名先查一遍（每版查一次）；不能用的挪走，不给「重启以更新」
        if (nu && !sigOkAt[nu.build]) {
          var nb = nu.build;
          return appSigProblem(dir + "/Vibing Studio.app").then(function (why) {
            if (why) { sigBad[nb] = why; console.warn("App update " + nb + " rejected: " + why); return setAside(dir, nb).then(function () { if (appUpd) { appUpd = null; allWins().forEach(function (w) { renderSoon(w); syncAct(w); }); } }); }
            sigOkAt[nb] = Date.now();
            if (JSON.stringify(nu) !== JSON.stringify(appUpd)) { appUpd = nu; allWins().forEach(function (w) { renderSoon(w); syncAct(w); }); }
          });
        }
        if (JSON.stringify(nu) !== JSON.stringify(appUpd)) { appUpd = nu; allWins().forEach(function (w) { renderSoon(w); syncAct(w); }); }
      }, function () { if (appUpd) { appUpd = null; allWins().forEach(function (w) { renderSoon(w); syncAct(w); }); } });
    }).catch(function () {});
  }
  setTimeout(checkAppUpdate, 6000);
  setInterval(checkAppUpdate, 30000);
  // ---- 别的 Mac：网站上发了新版（tools/release-mac.sh 放在 downloads/，macos.json 写着最新的是哪一版）——比现在跑的新、「待更新」里也还没有：
  //   自己下载（按这台 Mac 的芯片挑那一份）、解开放进「待更新」，状态栏照常出「App 有新版本 · 重启以更新」（同 tools/stage-app.sh 放的）。半小时内只看一次 ----
  var remoteBusy = false, remoteAt = 0;
  var remoteLast = null; // 最近一次查的结果：{ state: "latest"|"staged"|"error"|"skip", ver, error }
  function checkRemoteApp(force) {
    var N = window.nadosNative, dir = UPD_DIR();
    if (!SLOC() || !N || !N.call || !dir || location.protocol !== "https:") return Promise.resolve({ state: "skip" });
    if (remoteBusy) return remoteBusy;
    if (!force && Date.now() - remoteAt < 30 * 60000) return Promise.resolve(remoteLast || { state: "skip" });
    // 用本地界面的也查（以前跳过）：发出去的 App 记着编它那台 Mac 上仓库的路径，别的 Mac 上同一个用户名、「文稿」走 iCloud 时那个路径也在，
    //   它们用的就是本地界面——以前因此从不查新版。只在比现在跑的、「待更新」里放好的都新时才下（上面比的构建号），开发这台自己放进去的更新的不会被盖掉
    remoteAt = Date.now();
    var res = null, fin = function (r) { res = r || res || { state: "latest" }; remoteLast = res; return res; };
    var q = function (x) { return "'" + String(x).replace(/'/g, "'\\''") + "'"; };
    remoteBusy = Promise.all([N.call("info"), fetch("/downloads/macos.json", { cache: "no-store", credentials: "same-origin" }).then(function (r) { if (!r.ok) throw new Error("读不到版本信息（HTTP " + r.status + "）"); return r.json(); })]).then(function (rs) {
      var i = rs[0] || {}, m = rs[1], cur = +i.build || 0;
      if (i.platform !== "macos") return fin({ state: "skip" });
      if (!m || !(+m.build > cur)) return fin({ state: "latest", ver: i.version || "" }); // 没有更新的
      if (appUpd && appUpd.build >= +m.build) return fin({ state: "staged", ver: appUpd.ver }); // 已经下好了
      if (sigBad[+m.build]) return fin({ state: "error", error: "新版本（" + (m.version || m.build) + "）" + sigBad[+m.build] + "，没有放进待更新" });
      var url = m[i.arch === "x86_64" ? "x86_64" : "arm64"];
      if (!url) return fin({ state: "error", error: "没有这种芯片的安装包" });
      remoteDl = m.version || String(m.build); allWins().forEach(function (w) { renderSoon(w); });
      return fetch("/" + String(url).replace(/^\/+/, ""), { credentials: "same-origin" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.arrayBuffer(); }).then(function (buf) {
        var zip = dir + "/download-" + m.build + ".zip", prev = dir.replace(/\/update$/, "/previous");
        return LOC().write(zip, new Uint8Array(buf)).then(function () {
          // 「待更新」里旧的那份先挪到 previous/（不删），再把新的解开放进去
          return LOC().exec({ cmd: "U=" + q(dir) + "; P=" + q(prev) + '; mkdir -p "$U"; if [ -d "$U/Vibing Studio.app" ]; then mkdir -p "$P" && mv "$U/Vibing Studio.app" "$P/staged-$(date +%Y%m%d-%H%M%S).app"; fi; /usr/bin/ditto -x -k ' + q(zip) + ' "$U" && echo OK' }).then(function (r) { if (!/OK/.test(String((r && (r.out || r.stdout)) || ""))) throw new Error("解开安装包没有成功"); })
            .then(function () { return appSigProblem(dir + "/Vibing Studio.app"); }).then(function (why) { // 签名不能用的（证书被吊销……）：不放进待更新
              if (!why) { sigOkAt[+m.build] = Date.now(); return; }
              sigBad[+m.build] = why;
              return setAside(dir, m.build).then(function () { throw new Error("新版本（" + (m.version || m.build) + "）" + why + "，没有放进待更新"); });
            });
        });
      }).then(function () { return checkAppUpdate(true); }).then(function () { return fin({ state: "staged", ver: m.version || String(m.build) }); });
    }).catch(function (e) { console.warn("App update check:", e); return fin({ state: "error", error: String((e && e.message) || e) }); })
      .then(function (r) { remoteBusy = null; remoteDl = ""; allWins().forEach(function (w) { renderSoon(w); syncAct(w); }); return r; });
    return remoteBusy;
  }
  var remoteDl = ""; // 正在下载的那一版（⚙ 菜单里写「正在下载更新…」）
  setTimeout(function () { checkRemoteApp(); }, 5000);
  setInterval(function () { checkRemoteApp(); }, 60 * 60000);
  // 点了更新：独立的小脚本等 App 退出再换（同一时间只有一个在等——两个一起换会把刚换上的新版也挪走）；
  //   请 App 退出：新版 App 有 app.quit（同 ⌘Q：有程序在跑会先问）；老版本没有就用 AppleScript。2.5 秒后还开着：状态栏改成「按 ⌘Q 退出后自动换上」，脚本等 30 分钟
  var updT = 0, updWait = false;
  function appUpdateNow() {
    var dir = UPD_DIR();
    if (!appUpd || !dir || !LOC() || !LOC().exec) return;
    try { if (window.TSU_FLUSH) TSU_FLUSH(); } catch (e) { /* 记不了就算了 */ }
    var q = function (x) { return "'" + String(x).replace(/'/g, "'\\''") + "'"; };
    var N = window.nadosNative;
    var quit = function () { var osa = function () { return LOC().exec({ cmd: "osascript -e 'tell application id \"beer.paimon.terminal\" to quit'" }); }; return N && N.call ? N.call("app.quit").catch(osa) : osa(); };
    var still = function () { setTimeout(function () { updWait = true; allWins().forEach(function (w) { renderSoon(w); }); }, 2500); }; // 还在跑（没退成、或在「要终止正在运行的进程吗」里点了取消）
    if (updT && Date.now() - updT < 30 * 60000) { quit().then(still, still); return; } // 脚本已经在等：只再请一次退出
    updT = Date.now();
    var sh = ["PF=" + q(dir + "/swap.pid"),
      "if [ -f \"$PF\" ] && kill -0 \"$(cat \"$PF\")\" 2>/dev/null; then exit 0; fi", // 已经有一个在等：不再开第二个
      "echo $$ > \"$PF\"",
      "APP=\"/Applications/Vibing Studio.app\"", "NEW=" + q(dir + "/Vibing Studio.app"), "PREV=" + q(dir.replace(/\/update$/, "/previous")),
      "i=0; while pgrep -f \"$APP/Contents/MacOS/Paimon\" >/dev/null && [ $i -lt 9000 ]; do sleep 0.2; i=$((i+1)); done", // 等 App 退出：最多 30 分钟（自动退不了时按 ⌘Q）
      "pgrep -f \"$APP/Contents/MacOS/Paimon\" >/dev/null && exit 0", // 还没退：不换
      "[ -d \"$NEW\" ] || exit 0",
      // 换之前最后查一遍新版的签名：证书被吊销的，macOS 一打开就当恶意软件扔进废纸篓（原来的 App 已经挪走了，就一个都没有了）——不换，照旧打开原来的
      "if ! /usr/bin/codesign --verify --strict \"$NEW\" >/dev/null 2>&1 || /usr/sbin/spctl -a -t exec -vv \"$NEW\" 2>&1 | grep -q REVOKED; then mkdir -p \"$PREV\" && mv \"$NEW\" \"$PREV/rejected-$(date +%Y%m%d-%H%M%S).app\"; open \"$APP\"; exit 0; fi",
      "OLDV=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \"$APP/Contents/Info.plist\" 2>/dev/null || echo old)",
      "OLD=\"$PREV/Vibing Studio $OLDV $(date +%Y%m%d-%H%M%S).app\"",
      "mkdir -p \"$PREV\" && mv \"$APP\" \"$OLD\" && mv \"$NEW\" \"$APP\"",
      "open \"$APP\"",
      // 打开以后它要是被系统拿走了（不在原处了）：把原来那一份放回去、打开它（不留下一个没有 App 的「应用程序」）
      "i=0; while [ $i -lt 50 ]; do sleep 0.2; i=$((i+1)); done",
      "if [ ! -d \"$APP\" ] && [ -d \"$OLD\" ]; then mv \"$OLD\" \"$APP\" && open \"$APP\"; fi"].join("\n");
    // 脚本单独起一个会话（setsid）：App 退了它还在
    LOC().write(dir + "/swap.sh", new TextEncoder().encode(sh + "\n")).then(function () {
      return LOC().exec({ cmd: "/usr/bin/perl -e 'use POSIX qw(setsid); exit 0 if fork; setsid(); open STDIN, \"</dev/null\"; open STDOUT, \">/dev/null\"; open STDERR, \">&STDOUT\"; exec \"/bin/sh\", $ARGV[0]' " + q(dir + "/swap.sh") });
    }).then(quit).then(still, function (e) { updT = 0; if (window.TSU_DESK && TSU_DESK.alert) TSU_DESK.alert({ title: "没能开始更新", message: String(e && e.message || e), icon: "caution" }); });
  }

  // ======== 下面板：终端（⌘J），能开好几个；拖上边缘调高、⤢ 放大、× 关 ========
  function termOpts() {
    var fs = +(localStorage.getItem("tsu-font") || 12);
    return { fontFamily: monoStack(), fontSize: fs, lineHeight: Math.max(1, Math.round(fs * 1.3) / fs), cursorBlink: false, cursorStyle: "block", scrollback: 5000, allowProposedApi: true, macOptionIsMeta: true,
      theme: xtermTheme() };
  }
  var PKEY = "st-panel-terms";
  // ---- 终端的几种「配置文件」（同 VS Code 终端 + 旁边 ⌄）：默认的 shell 开起来以后换成这个 ----
  var SHELLS = [["zsh", "zsh", ""], ["bash", "bash", "exec bash -l"], ["tmux", "tmux", "tmux new -A -s vibing"], ["sh", "sh", "exec sh"]];
  var shellCmd = function (id) { var x = SHELLS.filter(function (y) { return y[0] === id; })[0]; return x ? x[2] : ""; };
  var TCOLORS = { red: "var(--st-red)", green: "var(--st-green)", yellow: "var(--st-yellow)", blue: "var(--st-blue)", orange: "var(--st-orange)", magenta: "#c678dd", cyan: "#56b6c2" };
  var TICONS = ["›_", "✦", "⚙", "◆", "●", "★", "⚡"];
  function newTermMenu(tw) {
    var def = getv("defaultShell") || "zsh";
    return [
      { label: "新建终端", keys: "⌃⇧`", icon: MI.term, run: function () { newTerm(tw, null, null, shellCmd(def)); } },
      { sep: true },
    ].concat(SHELLS.map(function (x) { return { label: x[1] + (x[0] === def ? "（默认）" : ""), icon: MI.term, run: function () { newTerm(tw, null, null, x[2]); } }; })).concat([
      { sep: true },
      { label: "配置终端设置", icon: MI.gear, run: function () { settings(tw, "terminal"); } },
      { label: "选择默认配置文件", icon: MI.term, value: (SHELLS.filter(function (x) { return x[0] === (getv("defaultShell") || "zsh"); })[0] || ["", ""])[1], items: function () { var cur = getv("defaultShell") || "zsh"; return SHELLS.map(function (x) { return { label: x[1], radio: true, checked: cur === x[0], run: function () { setv("defaultShell", x[0]); } }; }); } },
    ]);
  }
  // 终端列表里右键（同 VS Code）：重命名、换颜色、换图标、终止
  function termMenu(tw, i, at) {
    var S = parts(tw), t = S.terms[i];
    if (!t) return;
    menu(function () {
      return [
        { label: "重命名…", icon: MI.rename, run: function () { ask({ title: "终端名称", value: t.name || t.title, ok: "重命名" }).then(function (n) { if (n != null) { t.name = String(n).trim(); renderPanel(tw); } }); } },
        { label: "更改颜色", icon: MI.scheme, items: [{ label: "默认", radio: true, checked: !t.color, run: function () { t.color = ""; renderPanel(tw); } }].concat(Object.keys(TCOLORS).map(function (c) { return { label: { red: "红色", green: "绿色", yellow: "黄色", blue: "蓝色", orange: "橙色", magenta: "紫色", cyan: "青色" }[c], radio: true, checked: t.color === c, run: function () { t.color = c; renderPanel(tw); } }; })) },
        { label: "更改图标", icon: MI.image, items: TICONS.map(function (ic) { return { label: ic, radio: true, checked: (t.icon || "›_") === ic, run: function () { t.icon = ic; renderPanel(tw); } }; }) },
        { sep: true },
        { label: "终止终端", keys: "⌘⌫", icon: MI.close, run: function () { killTerm(tw, i); } },
      ];
    }, at);
  }
  function newTerm(tw, attach, cwd0, cmd) {
    var S = parts(tw);
    if (!window.Terminal || !LOC()) return;
    var P = tw.ws.active, cwd = cwd0 || (P && P.shell && P.shell.cwd ? P.shell.cwd() : "");
    var host = document.createElement("div");
    host.className = "st-term";
    S.panel.querySelector(".st-pbody").appendChild(host);
    var term = new Terminal(termOpts()), fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    if (window.Unicode11Addon) try { term.loadAddon(new Unicode11Addon.Unicode11Addon()); term.unicode.activeVersion = "11"; } catch (e) { /* 照旧 */ }
    term.open(host);
    var glh = window.TSU_XGL ? TSU_XGL.attach(term, host) : null; // WebGL：挂、摘、丢了再挂见 xterm-gl.js
    if (window.WebLinksAddon) try { term.loadAddon(new WebLinksAddon.WebLinksAddon(function (e, uri) { if (e.metaKey && T()) (T().openUrl || T().openLink)(uri); })); } catch (e) { /* 照旧 */ }
    var t = { host: host, term: term, fit: fit, glh: glh, title: "zsh", ws: null };
    S.terms.push(t);
    S.cur = S.terms.length - 1;
    L.panel = true;
    saveL();
    renderPanel(tw);
    try { fit.fit(); } catch (e) { /* 还没尺寸 */ }
    var ws = t.ws = LOC().pty({ cols: term.cols, rows: term.rows, cwd: cwd, attach: attach || null });
    var typed = !cmd;
    ws.onmessage = function (e) {
      ws.feed(term, new Uint8Array(e.data)); // 积压多了叫原生先别读（流控），见 local.js
      if (!typed) { typed = true; setTimeout(function () { if (ws.readyState === 1) ws.send(cmd + "\r"); }, 250); } // shell 出了第一段（提示符）再敲命令
    };
    ws.onopen = function () { savePanel(tw); };
    ws.onclose = function () { var i = S.terms.indexOf(t); if (i >= 0) killTerm(tw, i, true); };
    term.onData(function (d) { if (ws.readyState === 1) ws.send(d); });
    term.onResize(function (sz) { if (ws.readyState === 1 && ws.resize) ws.resize(sz.cols, sz.rows); });
    // 这块终端自己的大小一变（开关主侧栏 / 辅助侧栏、Claude App 的侧栏和卡片、拖分隔条、窗口大小）就重新量行列：xterm 重排，伪终端收到新的行列（SIGWINCH），
    // 里面跑的 Claude Code 跟着重画（不然它按旧的宽度画，出「Rendered line … exceeds terminal width」）。等停下来（60ms 没再变）才量，藏着的时候不量
    var roT = 0;
    if (window.ResizeObserver) new ResizeObserver(function () { clearTimeout(roT); roT = setTimeout(function () { if (host.clientWidth && host.style.display !== "none") try { fit.fit(); } catch (e) { /* 藏着 */ } }, 60); }).observe(host);
    term.onTitleChange(function (s) { t.title = s || "zsh"; renderPanel(tw); });
    setTimeout(function () { term.focus(); }, 0);
    return t;
  }
  function killTerm(tw, i, gone) {
    var S = parts(tw), t = S.terms[i];
    if (!t) return;
    if (!gone && t.ws) try { t.ws.close(); } catch (e) { /* 已关 */ }
    if (t.glh) t.glh.dispose();
    try { t.term.dispose(); } catch (e) { /* 已关 */ }
    t.host.remove();
    S.terms.splice(i, 1);
    S.cur = Math.max(0, Math.min(S.cur, S.terms.length - 1));
    if (!S.terms.length) L.panel = false;
    saveL();
    savePanel(tw);
    renderPanel(tw);
  }
  function savePanel(tw) { keep(PKEY, (tw.st ? tw.st.terms : []).map(function (t) { return t.ws && t.ws.id; }).filter(Boolean)); }
  // 面板里的视图：终端；Agent 活动（全局那一级：所有 agent 在跑什么，按 agent 分组）；后台任务（只有 Claude App 右边的卡片用：当前这个会话自己的）。
  // 每个 agent 自己的后台任务、子 Agent 在它那个标签页底下（tdrawer.js），不在全局的面板里
  var PVIEWS = [["activity", "Agent 活动"], ["term", "终端"], ["assistant", "助手"], ["tasks", "后台任务"]]; // 整机的 CPU、内存、能耗、磁盘、网络、GPU 并进 Agent 活动（同活动监视器：上面页签、中间会话、底下一条），不再单独一个视图
  // 时间线的图标（Agent 活动）：几条长短不一、错开的横条（同 trace / 甘特图）
  var SYS_ICO = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 9.5h3l1.5-4 2.5 7 2-5 1 2h3"/></svg>'; // 系统资源：一条起伏的线（同活动监视器）
  var TRACE_ICO = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2.5 4h6M5.5 8h8M3.5 12h5"/><path d="M1.5 2v12" stroke-width="1" opacity=".55"/></svg>';
  // 「助手」：全局助手（globalagent.js），以前在辅助侧栏的「全局」那一层；Claude App 风格里它有自己的卡片（标题栏上的 ✦）
  // 助手（Studio 自己的全局 agent）不在底部面板里了：在右侧栏右上角「···」里打开（整个右侧栏换成它，宽度就是右侧栏的宽）
  var pvAvail = function (v) { var ca = root.classList.contains("st-os-claude"); if (v === "activity" && L.actAt === "side") return false; if (v === "system") return !!window.TSU_TRACE && !!LOC(); return v === "term" || (v === "tasks" ? ca : v === "assistant" ? false : !ca); };
  var ACTD = {}; // 「Agent 活动」里展开了「n 个已完成」的那几个 agent
  // 以前是「后台任务」「子 Agent」两个全局视图：合成一个「Agent 活动」——记下的开关、顺序、大小、折叠跟过去（只换一次）
  (function () {
    if (L.pvMig2) return;
    var off = L.pvOff || {}, fold = L.pvFold || {}, sz = L.pvSize || {};
    if (off.tasks && off.agents) off.activity = true;
    if (fold.tasks && fold.agents) fold.activity = true;
    if (sz.tasks || sz.agents) sz.activity = (sz.tasks || 0) + (sz.agents || 0);
    delete off.agents; delete fold.agents; delete sz.agents; delete off.tasks; delete fold.tasks; delete sz.tasks;
    if (L.pvOrder) { var o = []; L.pvOrder.forEach(function (v) { var n = v === "tasks" || v === "agents" ? "activity" : v; if (o.indexOf(n) < 0) o.push(n); }); L.pvOrder = o; }
    L.pvOff = off; L.pvFold = fold; L.pvSize = sz; L.pvMig2 = 1;
    saveL();
  })();
  // 以前面板里放过 agent 的底部（Agent 那一层）、辅助侧栏有「全局」那一层：都没了。面板只放全局的（终端、Agent 活动、助手）——
  // 以前面板是拿来放 agent 底部的，这次先关着（要用再 ⌘J 打开）；收起着的视图全展开，不留一条空的窄条（只换一次）
  (function () {
    if (L.pmig4) return;
    if ((L.panelLevel || "agent") === "agent" || L.panelTab === "agent") L.panel = false;
    L.pvFold = {};
    delete L.panelLevel; delete L.panelTab; delete L.panelHA; delete L.sideLevel;
    L.pmig4 = 1;
    saveL();
  })();
  // 面板同 VS Code 只放终端：「Agent 活动」只列 Paimon 自己的 agent（Claude Code、Codex 的会话不在里面——平时一直是一句「没有正在运行的后台任务」），
  //   每个会话自己的后台任务、子 Agent 在右边的辅助侧栏；「助手」是 Studio 自己的全局 agent，和你的会话无关。两样默认不放进面板（只换一次）——
  //   入口都还在：面板右上「···」的视图里勾上、「显示 › Agent 活动」
  (function () {
    if (L.pvMig5) return;
    L.pvOff = Object.assign({}, L.pvOff || {}, { activity: true, assistant: true });
    delete L.pvOff.term;
    L.pvMig5 = 1;
    saveL();
  })();
  // 「Agent 活动」换成了时间线（trace.js）：面板默认就是它（第一个、开着），终端默认不放（要用在「···」里勾上），「以标签页显示」默认开
  (function () {
    if (L.pvMig6) return;
    L.pvOff = Object.assign({}, L.pvOff || {}, { term: true, assistant: true });
    delete L.pvOff.activity;
    L.pvOrder = ["activity", "term"].concat((L.pvOrder || []).filter(function (v) { return v !== "activity" && v !== "term"; }));
    L.pvTabs = true; L.pvTab = "activity";
    L.pvMig6 = 1;
    saveL();
  })();
  // 这个 agent 开着的那个标签页（没开就新开一个）：切过去，给回那个面板
  function agentPane(tw, aid) {
    var hit = null;
    (tw.ws.all ? tw.ws.all() : []).forEach(function (p) { if (!hit && !p.side && p.program && p.program.agentId === aid) hit = p; });
    if (hit) { if (tw.ws.show) tw.ws.show(hit); if (hit.focus) hit.focus(); return hit; }
    if (tw.side && tw.side.open) tw.side.open(aid, "tab");
    var p2 = tw.ws.active;
    return p2 && p2.program && p2.program.agentId === aid ? p2 : null;
  }
  // 后台任务 / 子 Agent 的先后：在跑的在前、新的在前；一行：状态、说明、用了多久、停止（aid 给了：是「Agent 活动」里的，点了先到那个 agent 的标签页）
  var taskOrder = function (a, b) { return (a.status === "running" ? 0 : 1) - (b.status === "running" ? 0 : 1) || (b.t0 || 0) - (a.t0 || 0); };
  // 状态字形：同任务清单的样子（◼ 在跑、✔ 完成、✗ 失败、■ 停了），固定一格宽（字都对齐）；颜色只给字形，不给字
  // ▶ 在跑（黄）、✔ 完成（绿）、✗ 失败（红）、■ 停了（灰，画成和字一样大的小方块）
  var taskIco = function (x) { return x.status === "running" ? '<span class="st-tg st-tgrun">▶</span>' : /fail|error/.test(x.status || "") ? '<span class="st-tg st-red">✗</span>' : /stop|kill/.test(x.status || "") ? '<span class="st-tg st-tgstop"></span>' : '<span class="st-tg st-tgok">✔</span>'; };
  // 在跑的那条用了多久：字不写进 HTML（不然每秒都不一样，整块每秒重画——指着的、点着的、收起的动画都被打断），放 data-t0，由 tickDurs 就地改字
  function taskRow(x, aid, cls, open) {
    var run = x.status === "running", took = run ? "" : x.ms ? dur(x.ms) : x.t1 ? dur(x.t1 - x.t0) : "", at = aid ? "@" + aid : "";
    var lab = x.desc || x.cmd || x.id, tl = x.desc && x.desc !== x.cmd ? trT(x.desc, aid) : lab; // 任务翻译：只翻说明，命令原样
    return '<div class="st-prw' + (cls ? " " + cls : "") + '" data-st="' + (open || "task-open") + "-" + esc(tkey(x) + at) + '">' + taskIco(x) + " " + (run ? '<span class="st-cut"' + trTitle(tl, lab) + ">" + esc(tl) + "</span>" : '<s class="st-cut"' + trTitle(tl, lab) + ">" + esc(tl) + "</s>") /* 跑完的（完成、失败、停了）：同任务清单做完的，划掉 */ + '<span class="st-fill"></span><span class="st-dim' + (run ? ' st-tick" data-t0="' + (x.t0 || 0) : "") + '">' + esc(took) + "</span>" +
      "</div>"; // （以前行尾有个像复选框的「停止」：多数任务停不了，看着又像勾选框——去掉）
  }
  // 子 Agent 一行（同 Claude Code 的 agents 面板：「○ fork  Checking x.ts for …   4m 21s · ↓ 907.1k tokens」）：
  //   ○ 白色空心圆是子 agent（▶ 只给后台命令）；种类（fork、Explore……）淡的；在跑的写它在干嘛（最近一次工具调用），名字（说明）进去才看到（指着时也有）；
  //   跑完的淡色、划掉，写它的说明；右边用时 · ↓ token（同 Claude Code：最近一次的输入含缓存 + 一路的输出；跑完的用通知里的数）
  var tokN = function (n) { n = +n || 0; return n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "m" : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k" : String(n); };
  // fork（直接分叉出去的子 agent）：一个分叉的小图标代替「○ fork」（省地方）；别的种类照旧 ○ + 淡色的种类名
  var FORK_ICO = '<svg class="st-forki" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"/></svg>';
  function subRow(x, aid, cls, open) {
    var run = x.status === "running", at = aid ? "@" + aid : "", key = tkey(x), fork = x.type === "fork";
    var took = run ? "" : x.ms ? dur(x.ms) : x.end && x.t0 ? dur(x.end - x.t0) : "", tk = run ? x.tokLive || x.tokens || 0 : x.tokens || x.tokLive || 0;
    // 在干嘛、说明都翻（任务翻译开着时；原文放在指着时的提示里）
    var desc = x.desc || x.type || key, act = run && x.activity ? x.activity : "", ta = act ? trT(act, aid) : "", td = act ? desc : trT(desc, aid), what = ta || td; // 行里只写一样：在干嘛 / 说明（只翻写出来的那一样）
    var tip = [fork ? "fork" : "", act || td !== desc ? desc : "", ta && ta !== act ? act : ""].filter(Boolean).join(" · ");
    // 两层：第一行是在干嘛 / 说明（占满整行，只在右边留用时），第二行淡的小字是种类、token——说明不再被右边那串挤成几个字，信息也都在
    var sub2 = [x.type && !fork ? x.type : "", tk > 0 ? "↓ " + tokN(tk) + " tokens" : ""].filter(Boolean).join(" · ");
    return '<div class="st-prw st-sarow st-sa2' + (cls ? " " + cls : "") + (run ? "" : " fin") + '" data-st="' + open + "-" + esc(key + at) + '"' + (tip ? ' title="' + esc(tip) + '"' : "") + ">" +
      '<span class="st-tg st-sadot">' + (fork ? FORK_ICO : "○") + "</span>" +
      '<span class="st-sabody"><span class="st-saline">' + (run ? '<span class="st-cut">' + esc(what) + "</span>" : '<s class="st-cut">' + esc(what) + "</s>") +
      '<span class="st-dim st-satime">' + (run ? '<span class="st-tick" data-t0="' + (x.resumedAt || x.t0 || 0) + '"></span>' : esc(took)) + "</span></span>" +
      (sub2 ? '<span class="st-dim st-sasub">' + esc(sub2) + "</span>" : "") + "</span></div>";
  }
  var hueOf = function (id) { var h = 0; String(id).split("").forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) % 360; }); return h; };
  // 全局那一级：底部面板的「Agent 活动」——一个 agent 一组：agent 一行（图标、名字、在干嘛、几个在跑），它在跑的任务缩进在下面，跑完的收成「n 个已完成」（点开看）。
  // 只看已经起来的 agent（不为了看一眼把每个都叫醒）；这次什么都没做过的不列
  // 所有打开着的会话都在这里（Claude Code、Codex、Paimon）：一个会话一组——标志、名字、在干嘛（在跑的前台命令的说明，译文）/ 空闲、用时；
  //   下面是它正在跑的前台命令、后台命令、子 Agent，跑完的收成「n 个已完成」。以前只列 Paimon 的 agent，平时永远是一句「没有正在运行的后台任务」
  function activityHtml() {
    var Ag = window.TSU_AGENTS, rts = Ag && Ag.liveRuntimes ? Ag.liveRuntimes().slice() : [], groups = [];
    // 连接器的会话（Claude Code、Codex）不在 liveRuntimes 里：按开着的标签页找它们的运行时
    if (Ag && Ag.runtime && window.TSU_TERM && TSU_TERM.panes) TSU_TERM.panes().forEach(function (p) {
      var id = p && p.program && p.program.agentId, r = null;
      if (!id || !/^c[cx]:/.test(id)) return;
      try { r = Ag.runtime(id); } catch (e) { r = null; }
      if (r && rts.indexOf(r) < 0) rts.push(r);
    });
    rts.forEach(function (rt) {
      var a = rt.agent;
      if (!a || a.deleted) return;
      var cn = /^cc:/.test(a.id || "") ? "cc" : /^cx:/.test(a.id || "") ? "cx" : /^pi:/.test(a.id || "") ? "pi" : /^ty:/.test(a.id || "") ? "ty" : "pm", ts = rt.tasks || [];
      var st = cn === "pm" ? (rt.state ? rt.state() : "idle") : rt.stream ? "working" : "idle";
      if (cn === "pm" && !ts.length && st !== "working") return;
      var tt = rt.stream && rt.stream.turn, fg = tt && tt.parts ? tt.parts.filter(function (p) { return isFg(p) && p.status === "running"; }) : [];
      groups.push({ a: a, cn: cn, rt: rt, st: st, fg: fg, run: ts.filter(function (x) { return x.status === "running"; }).sort(taskOrder), done: ts.filter(function (x) { return x.status !== "running"; }).sort(taskOrder) });
    });
    if (!groups.length) return '<div class="st-dim st-pempty">现在没有打开的会话</div>';
    var LG = window.TSU_LOGOS || {}, logo = function (g) { return g.cn === "cc" ? '<span class="st-alogo cc">' + (LG.claude || "") + "</span>" : g.cn === "cx" ? '<span class="st-alogo cx">' + (LG.codex || "›_") + "</span>" : g.cn === "pi" ? '<span class="st-alogo cx">' + (LG.pi || "") + "</span>" : g.cn === "ty" ? '<span class="st-alogo cx">' + (LG.teyvat || "") + "</span>" : '<span class="st-alogo pm">' + (LG.paimon || "✦") + "</span>"; };
    var fgLine = function (p, id) { var a0 = p.input || {}, raw = String(a0.description || a0.command || a0.file_path || a0.pattern || a0.url || p.name || "").replace(/\s+/g, " ").trim(), t = trT(raw, id); return '<div class="st-prw st-sub st-afg"><i class="st-tg st-fgdot">●</i> <span class="st-cut"' + trTitle(t, raw) + ">" + esc(t) + '</span><span class="st-fill"></span><span class="st-tick st-dim" data-t0="' + (p.t0 || 0) + '"></span></div>'; };
    groups.sort(function (x, y) { var r = function (g) { return g.st === "working" ? 0 : g.run.length ? 1 : 2; }; return r(x) - r(y) || String(x.a.name || "").localeCompare(String(y.a.name || "")); });
    var html = groups.map(function (g) {
      if (g.cn === "pm") return null;
      var id = g.a.id, s0 = g.rt.stream, what = g.st === "working" ? (g.fg.length ? "" : "运行中") : "空闲";
      var h = '<div class="st-arow st-acn' + (g.st === "working" ? " busy" : "") + '" data-st="agent-open-' + esc(id) + '">' + logo(g) + '<span class="st-cut st-aname">' + esc(g.a.name || id) + '</span><span class="st-fill"></span><span class="st-dim st-astate">' + (g.st === "working" && s0 ? '<span class="st-tick" data-t0="' + (s0.t0 || 0) + '"></span>' : esc(what)) + "</span></div>";
      h += g.fg.map(function (p) { return fgLine(p, id); }).join("");
      h += g.run.map(function (x) { return x.kind === "shell" ? taskRow(x, id, "st-sub") : subRow(x, id, "st-sub", /^cc:/.test(id) ? "sub-open" : "task-det"); }).join("");
      if (g.done.length) h += '<div class="st-prw st-adone" data-st="agent-done-' + esc(id) + '"><span class="ts-chev ' + (ACTD[id] ? "d" : "r") + '"></span><span>' + esc(g.done.length + " 个已完成") + "</span></div>" + (ACTD[id] ? g.done.map(function (x) { return x.kind === "shell" ? taskRow(x, id, "st-sub") : subRow(x, id, "st-sub", /^cc:/.test(id) ? "sub-open" : "task-det"); }).join("") : "");
      return h;
    });
    groups = groups.filter(function (g, i) { if (html[i] === null) { g.keep = true; return true; } return false; }); // Paimon 的照原来的样子画（下面）
    var conn = html.filter(function (x) { return x !== null; }).join("");
    if (!groups.length) return conn;
    var rank = function (g) { return g.st === "working" ? 0 : g.run.length ? 1 : 2; }, ST = { working: "运行中", waiting: "等待中", idle: "空闲" };
    groups.sort(function (x, y) { return rank(x) - rank(y) || (y.a.active || 0) - (x.a.active || 0); });
    return conn + groups.map(function (g) {
      var id = g.a.id, h = '<div class="st-arow" data-st="agent-open-' + esc(id) + '"><span class="xb-ic sm" style="--h:' + hueOf(id) + '">' + ((window.TSU_LOGOS && TSU_LOGOS.paimon) || '<span class="xb-g">✦</span>') + '</span><span class="st-cut st-aname">' + esc(g.a.name || id) + '</span><span class="st-astate ' + esc(g.st) + '">' + esc(ST[g.st] || g.st) + '</span><span class="st-fill"></span>' + (g.run.length ? '<span class="st-dim">' + esc(g.run.length + " 个在运行") + "</span>" : "") + "</div>";
      h += g.run.map(function (x) { return taskRow(x, id, "st-sub"); }).join("");
      if (g.done.length) h += '<div class="st-prw st-adone" data-st="agent-done-' + esc(id) + '"><span class="ts-chev ' + (ACTD[id] ? "d" : "r") + '"></span><span>' + esc(g.done.length + " 个已完成") + "</span></div>" + (ACTD[id] ? g.done.map(function (x) { return taskRow(x, id, "st-sub"); }).join("") : "");
      return h;
    }).join("");
  }
  // 「Agent 活动」开着时每秒刷一遍（用了多久在走；别的 agent 起了、跑完了任务）——没变就不动 DOM
  setInterval(function () {
    if (document.hidden || !L.panel || !window.TSU_TERM || !TSU_TERM.wins) return;
    TSU_TERM.wins().forEach(function (w) { if (w.open && w.st && w.st.panel && pvAvail("activity") && pvOn("activity")) renderPanel(w); });
  }, 1000);
  var PVP = null; // 预览：··· 里指着的那个视图临时显示 / 不显示
  function pvOn(v, real) { if (!real && PVP && v in PVP) return PVP[v]; return !(L.pvOff || {})[v]; }
  // 视图的顺序、大小（拖出来的，记着）
  function pvOrder() { var o = (L.pvOrder || []).filter(function (v) { return PVIEWS.some(function (p) { return p[0] === v; }); }); PVIEWS.forEach(function (p) { if (o.indexOf(p[0]) < 0) o.push(p[0]); }); return o; }
  function pvWeights(vs) {
    var sz = L.pvSize || {}, known = vs.filter(function (v) { return sz[v] > 0; }), avg = known.length ? known.reduce(function (n, v) { return n + sz[v]; }, 0) / known.length : 1;
    var w = vs.map(function (v) { return sz[v] > 0 ? sz[v] : (v === "term" ? 2 : 1) * avg; }), tot = w.reduce(function (a, b) { return a + b; }, 0);
    return w.map(function (x) { return Math.max(x, tot * 0.12); });
  }
  // 面板里的视图：拖两个视图中间的缝调大小，按住标题左右拖换顺序（同 VS Code）
  function pvDrag(tw, S) {
    var box = S.panel.querySelector(".st-pviews");
    if (box.dragBound) return;
    box.dragBound = true;
    var visible = function () { return Array.prototype.filter.call(box.children, function (x) { return x.classList.contains("st-pv") && !x.hidden; }); };
    var open = function () { return visible().filter(function (x) { return !x.classList.contains("folded"); }); };
    box.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      var grip = e.target.closest(".st-pvgrip"), head = !grip && e.target.closest(".st-pvh"), x0 = e.clientX;
      if (grip) {
        var el = grip.parentNode, exp = open(), i = exp.indexOf(el), prev = exp[i - 1]; // 左边最近的那个展开的视图（中间收起的竖条跟着走）
        if (i < 0 || !prev) return;
        e.preventDefault();
        exp.forEach(function (x) { x.style.flex = x.offsetWidth + " 1 0"; }); // 先都换成按像素的比例，拖的两个才好算
        var w1 = prev.offsetWidth, w2 = el.offsetWidth;
        S.pvBusy = true;
        root.classList.add("st-drag-x");
        var mv = function (ev) { var a = Math.max(90, Math.min(w1 + w2 - 90, w1 + ev.clientX - x0)); prev.style.flex = a + " 1 0"; el.style.flex = (w1 + w2 - a) + " 1 0"; fitTerms(tw); };
        var up = function () {
          window.removeEventListener("pointermove", mv, true); window.removeEventListener("pointerup", up, true);
          root.classList.remove("st-drag-x");
          S.pvBusy = false;
          L.pvSize = L.pvSize || {};
          open().forEach(function (x) { L.pvSize[x.dataset.v] = x.offsetWidth; });
          saveL(); fitTerms(tw);
        };
        window.addEventListener("pointermove", mv, true); window.addEventListener("pointerup", up, true);
        return;
      }
      if (!head || e.target.closest("button")) return;
      var src = head.parentNode, moved = false, line = null, at = -1;
      var mv2 = function (ev) {
        if (!moved && Math.abs(ev.clientX - x0) < 6) return;
        moved = true;
        var vis = visible(), xs = vis.map(function (x) { var r = x.getBoundingClientRect(); return r.left + r.width / 2; });
        at = xs.filter(function (m) { return ev.clientX > m; }).length;
        if (!line) { line = document.createElement("i"); line.className = "st-pvdrop"; box.appendChild(line); }
        var br = box.getBoundingClientRect(), ref = vis[at], lx = ref ? ref.getBoundingClientRect().left : br.right;
        line.style.left = (lx - br.left - 1) + "px";
      };
      var up2 = function () {
        window.removeEventListener("pointermove", mv2, true); window.removeEventListener("pointerup", up2, true);
        if (line) line.remove();
        if (!moved) return;
        S.pvDragged = Date.now(); // 这一下不算「点标题」（不折叠）
        var order = pvOrder(), vis = visible().map(function (x) { return x.dataset.v; }), v = src.dataset.v;
        var target = vis.filter(function (x) { return x !== v; })[Math.min(at - (vis.indexOf(v) < at ? 1 : 0), vis.length - 1)];
        order.splice(order.indexOf(v), 1);
        order.splice(target ? order.indexOf(target) : order.length, 0, v);
        if (at >= vis.length) { order.splice(order.indexOf(v), 1); order.push(v); }
        L.pvOrder = order; saveL(); renderPanel(tw);
      };
      window.addEventListener("pointermove", mv2, true); window.addEventListener("pointerup", up2, true);
    });
  }
  function pvFolded(v) { return !!(L.pvFold || {})[v]; }
  // 面板的视图一次看一个、顶上一排标签（同 VS Code 的面板：终端 · Agent 活动 · 助手，当前那个下面一道线）；「···」里能换回并排
  function pvTabsOn() { return root.classList.contains("st-os-vscode"); } // 面板的几个视图一律是标签页（没有别的样子可选）
  if (window.TSU_I18N && TSU_I18N.add) TSU_I18N.add({ "以标签页显示": "Show as Tabs", "更多视图": "More Views" });
  function renderPanel(tw) {
    var S = parts(tw);
    S.panel.classList.toggle("on", !!L.panel);
    var top = S.panel.querySelector(".st-ptop");
    var tb = ["panel-views", "panel-max", "panel-close"].map(function (k) { return top.querySelector('[data-st="' + k + '"]'); });
    if (!tb[0].innerHTML) { tb[0].innerHTML = ICO.more; tb[2].innerHTML = ICO.close; }
    var PV_ICON = { term: ICO.pvterm, activity: TRACE_ICO, system: SYS_ICO, tasks: ICO.pvtasks, assistant: (window.TSU_LOGOS && TSU_LOGOS.paimon) || "✦" }; // 助手就是派蒙
    // 面板里不能什么都没有：一个视图都不显示、显示的全收起了——终端那个显示、展开（开着面板就有东西看）
    if (!root.classList.contains("st-os-claude")) {
      var vis = PVIEWS.filter(function (pv) { return pvAvail(pv[0]) && pvOn(pv[0]); });
      if (!vis.length && L.pvOff) { delete L.pvOff.term; saveL(); }
      if (vis.length && vis.every(function (pv) { return pvFolded(pv[0]); }) && L.pvFold) { delete L.pvFold[vis[0][0]]; saveL(); }
    }
    var maxed = S.panel.classList.contains("max"), mh = maxed ? ICO.restore : ICO.max;
    if (tb[1].dataset.h !== mh) { tb[1].dataset.h = mh; tb[1].innerHTML = mh; tb[1].title = maxed ? "还原面板大小" : "最大化面板大小"; }
    tb[1].hidden = tbHidden("panel", "panel-max") || footOn(); // Agent 那一层：放大、显示哪些视图都是全局那一层的事
    tb[0].hidden = footOn();
    top.querySelector(".st-psep").hidden = footOn();
    try { syncFoot(tw, S); } catch (e) { setTimeout(function () { throw e; }, 0); }
    // 「后台任务」卡片（Claude App）：当前这个会话的后台任务和子 Agent；标题写明是哪个 agent 的
    var P = agentPaneFor(tw), prog = P && P.program, fname = prog ? agentName(prog.agentId) : ""; // 跟着的那个 agent（同辅助侧栏的 Agent 那一层）
    var tabs = pvTabsOn() && !footOn(), tvis = pvOrder().filter(function (v) { return pvAvail(v) && pvOn(v); }), tact = tvis.indexOf(L.pvTab) >= 0 ? L.pvTab : tvis[0];
    S.panel.classList.toggle("st-ptabbed", tabs);
    PVIEWS.forEach(function (pv) {
      var v = pv[0], el = S.panel.querySelector('.st-pv[data-v="' + v + '"]'), folded = !tabs && pvFolded(v);
      if (!el) return;
      el.hidden = !pvAvail(v) || !pvOn(v) || (tabs && v !== tact);
      el.classList.toggle("folded", folded);
      var acts = v === "term" ? '<span class="st-fill"></span><span class="st-split-btn"><button class="st-hbtn" data-st="panel-new" title="新建终端 (⌃⇧`)">' + ICO.plus + '</button><button class="st-hbtn st-caret" data-st="panel-new-menu" title="启动配置文件…"><svg viewBox="0 0 16 16"><path d="M4.5 6.5L8 10l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></button></span>' : "";
      var name = v === "tasks" && fname ? pv[1] + " · " + fname : pv[1];
      var hh = folded ? '<span class="ts-chev r"></span><span class="st-pvi">' + PV_ICON[v] + "</span>" : '<span class="ts-chev d"></span><span class="st-pvt">' + esc(name) + "</span>" + acts;
      var head = el.querySelector(".st-pvh");
      if (head.dataset.h !== hh) { head.dataset.h = hh; head.innerHTML = hh; }
      if (folded) head.title = name; else head.removeAttribute("title");
      if (v === "system") { var sb = el.querySelector(".st-pvb"); sb.classList.add("tr-host", "am-syshost"); if (!el.hidden && !folded && window.TSU_TRACE) TSU_TRACE.renderSys(sb); return; }
      if (v === "activity") { // 时间线（trace.js）：每个会话这段时间在干嘛；没有 trace.js 时才用老的列表
        var ab = el.querySelector(".st-pvb");
        if (window.TSU_TRACE) { ab.classList.add("tr-host"); if (!el.hidden && !folded) TSU_TRACE.render(ab); return; }
        var ah = activityHtml();
        if (ab.dataset.h !== ah) { ab.dataset.h = ah; ab.innerHTML = ah; tickDurs(ab); }
        return;
      }
      if (v === "assistant") { // 全局助手：面板开着、这个视图显示着、展开着才挂上去（它自己的输入框、工具都在里面）
        if (L.panel && !el.hidden && !folded && window.TSU_GLOBAL) try { TSU_GLOBAL.mount(tw, el.querySelector(".st-pvb")); } catch (e) { setTimeout(function () { throw e; }, 0); }
        return;
      }
      if (v === "term") {
        var lh = S.terms.map(function (t, i) { return '<div class="st-trow' + (i === S.cur ? " on" : "") + '" data-st="term-' + i + '"><span class="st-cut"><b class="st-ticon"' + (t.color ? ' style="color:' + TCOLORS[t.color] + '"' : "") + ">" + esc(t.icon || "›_") + "</b> " + esc(String(t.name || t.title).slice(0, 40)) + '</span><button class="st-hbtn st-tkill" data-st="kill-' + i + '" title="终止终端（结束此 Shell 进程）">' + ICO.trash + "</button></div>"; }).join("") || '<div class="st-dim st-pempty">无终端</div>';
        var tl = el.querySelector(".st-tlist");
        if (tl.dataset.h !== lh) { tl.dataset.h = lh; tl.innerHTML = lh; }
        return;
      }
      // 后台任务（Claude App 的卡片）：这个 agent 的「任务」一家子——任务清单、后台任务、子 Agent（同 VS Code 风格辅助侧栏的 Agent 那一层；这个风格没有辅助侧栏）
      var fh = familyHost() === "card" ? familyHtml(P, subsInFoot() ? ["todo", "bg"] : null) : ""; // 子 Agent 在 agent 自己的底部
      var bh = fh || '<div class="st-dim st-pempty">' + (prog && prog.agentId ? "这个会话现在没有任务" : "没有打开的 agent") + "</div>";
      var body = el.querySelector(".st-pvb");
      if (body.dataset.h !== bh) { body.dataset.h = bh; body.innerHTML = bh; applyFold(body); }
    });
    var pbox = S.panel.querySelector(".st-pviews"), ord = pvOrder();
    if (Array.prototype.map.call(pbox.querySelectorAll(":scope > .st-pv"), function (x) { return x.dataset.v; }).join() !== ord.join()) ord.forEach(function (v) { pbox.appendChild(pbox.querySelector(':scope > .st-pv[data-v="' + v + '"]')); });
    // 展开的视图按记下的比例分宽度；左边缘能拖（左边还有展开的视图才有）
    var shown = Array.prototype.filter.call(pbox.querySelectorAll(":scope > .st-pv"), function (x) { return !x.hidden; }), exp = shown.filter(function (x) { return !x.classList.contains("folded"); });
    var wts = pvWeights(exp.map(function (x) { return x.dataset.v; }));
    shown.forEach(function (x, i) {
      if (!x.querySelector(":scope > .st-pvgrip")) { var g0 = document.createElement("i"); g0.className = "st-pvgrip"; x.appendChild(g0); }
      var k = exp.indexOf(x);
      x.classList.toggle("first", i === 0);
      x.classList.toggle("nogrip", k < 1);
      if (!S.pvBusy) x.style.flex = k < 0 ? "" : wts[k] + " 1 0";
    });
    pvDrag(tw, S);
    pvTabsPaint(tw, S, tabs ? tvis : [], tact);
    S.terms.forEach(function (t, i) { t.host.style.display = i === S.cur ? "" : "none"; });
    if (L.panel) requestAnimationFrame(function () { fitTerms(tw); });
  }
  // 右侧栏里任务清单和 Agent 活动之间的分隔线：按住上下拖，Agent 活动那块跟着变高变矮（记住）
  document.addEventListener("pointerdown", function (e) {
    var spl = e.target.closest && e.target.closest(".st-sactsplit");
    if (!spl || e.button !== 0) return;
    var side = spl.parentNode, sa = side.querySelector(".st-sact");
    if (!sa) return;
    e.preventDefault();
    var y0 = e.clientY, h0 = sa.getBoundingClientRect().height, maxH = Math.max(140, side.getBoundingClientRect().height - 140);
    spl.classList.add("drag"); sa.classList.add("sized");
    var mv = function (ev) { var h = Math.max(120, Math.min(maxH, h0 + (y0 - ev.clientY))); sa.style.height = h + "px"; if (window.TSU_TRACE) TSU_TRACE.render(sa); };
    var up = function () { document.removeEventListener("pointermove", mv, true); document.removeEventListener("pointerup", up, true); spl.classList.remove("drag"); L.actH = Math.round(sa.getBoundingClientRect().height); saveL(); };
    document.addEventListener("pointermove", mv, true); document.addEventListener("pointerup", up, true);
  });
  // 「Agent 活动」挪到右侧栏 / 挪回面板（它右上角那个按钮）：挪过去时面板里只剩它的话面板收起来；挪回来时打开面板、选中它
  function moveActivity(to) {
    var tw = T() && T().front();
    if (!tw) return;
    L.actAt = to === "side" ? "side" : "panel"; saveL();
    if (L.actAt === "side") {
      if (!L.side) toggleSide(tw, true);
      var left = PVIEWS.filter(function (pv) { return pvAvail(pv[0]) && pvOn(pv[0]); });
      if (L.panel && !left.length) togglePanel(tw, false);
    } else {
      L.pvOff = L.pvOff || {}; delete L.pvOff.activity; L.pvTab = "activity"; saveL();
      if (!L.panel) togglePanel(tw, true);
    }
    render(tw);
  }
  function fitTerms(tw) { var S = tw.st; if (!S) return; S.terms.forEach(function (t, i) { if (i === S.cur) try { t.fit.fit(); } catch (e) { /* 藏着 */ } }); }
  // 面板顶上的视图标签：名字（大写，同 VS Code）、当前那个下面一道线；放不下的收进「»」菜单（当前那个总留着）；当前视图自己的按钮（终端的 + 新建、⌄ 配置）放到右边
  function pvTabsPaint(tw, S, vis, act) {
    var top = S.panel.querySelector(".st-ptop"), box = top && top.querySelector(".st-ptabs"), acts = top && top.querySelector(".st-ptacts"), more = top && top.querySelector(".st-ptmore");
    if (!box) return;
    var name = function (v) { var pv = PVIEWS.filter(function (x) { return x[0] === v; })[0]; return pv ? pv[1] : v; };
    var h = vis.map(function (v) { return '<div class="st-ptab' + (v === act ? " on" : "") + '" role="tab" aria-selected="' + (v === act) + '" draggable="true" data-st="pvtab-' + v + '" data-v="' + v + '"><span>' + esc(name(v)) + "</span></div>"; }).join("");
    if (box.dataset.h !== h) { box.dataset.h = h; box.innerHTML = h; }
    var ah = act === "term" && vis.length ? '<span class="st-split-btn"><button class="st-hbtn" data-st="panel-new" title="新建终端 (⌃⇧`)">' + ICO.plus + '</button><button class="st-hbtn st-caret" data-st="panel-new-menu" title="启动配置文件…"><svg viewBox="0 0 16 16"><path d="M4.5 6.5L8 10l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></button></span>' : "";
    if (act === "activity" && vis.length && window.TSU_TRACE && TSU_TRACE.headActs) ah = TSU_TRACE.headActs(); // Agent 活动的按钮放在标题栏右边（同 VS Code），不在内容里再占一行
    if (acts.dataset.h !== ah) { acts.dataset.h = ah; acts.innerHTML = ah; }
    // 放不下：从后往前收（当前那个不收），收了的列在「»」里
    var tabsEls = Array.prototype.slice.call(box.children), hid = [];
    tabsEls.forEach(function (t) { t.hidden = false; });
    if (!more.innerHTML) more.innerHTML = '<svg viewBox="0 0 16 16"><path d="M4 4.5l3.5 3.5L4 11.5M8.5 4.5L12 8l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    more.hidden = true;
    if (box.clientWidth && box.scrollWidth > box.clientWidth + 1) {
      more.hidden = false;
      for (var i = tabsEls.length - 1; i >= 0 && box.scrollWidth > box.clientWidth + 1; i--) { if (tabsEls[i].dataset.v === act) continue; tabsEls[i].hidden = true; hid.unshift(tabsEls[i].dataset.v); }
    }
    S.pvHidden = hid;
    if (!box.dndBound) { // 拖标签换顺序（同 VS Code）
      box.dndBound = true;
      var dragV = null;
      box.addEventListener("dragstart", function (e) { var t = e.target.closest(".st-ptab"); if (!t) return; dragV = t.dataset.v; try { e.dataTransfer.setData("text/plain", dragV); e.dataTransfer.effectAllowed = "move"; } catch (x) { /* 拖不了 */ } });
      box.addEventListener("dragover", function (e) { if (dragV) e.preventDefault(); });
      box.addEventListener("drop", function (e) {
        var t = e.target.closest(".st-ptab"); if (!dragV || !t || t.dataset.v === dragV) { dragV = null; return; }
        e.preventDefault();
        var r = t.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2, o = pvOrder().filter(function (v) { return v !== dragV; }), at = o.indexOf(t.dataset.v) + (after ? 1 : 0);
        o.splice(at, 0, dragV); L.pvOrder = o; dragV = null; saveL(); renderPanel(tw);
      });
      box.addEventListener("dragend", function () { dragV = null; });
    }
  }
  // 刷新页面：面板里的终端接回原来的 shell
  function restorePanel(tw) {
    var ids = store(PKEY, []);
    if (!ids.length || !LOC()) return;
    ids.forEach(function (id) { if (LOC().want) LOC().want(id); });
    if (L.panel) ids.forEach(function (id) { newTerm(tw, id); });
  }

  // ======== 编辑区的页面：设置（⌘,）、文件（点路径）——同别的标签页，能关、能拖、能分屏 ========
  var PAGES = {};
  var IC = function (body) { return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">' + body + "</svg>"; };
  var ICO = {
    json: IC('<path d="M6 2.5C4.8 2.5 4.3 3 4.3 4.2v1.6c0 .8-.5 1.4-1.3 1.7.8.3 1.3.9 1.3 1.7v1.6c0 1.2.5 1.7 1.7 1.7M10 2.5c1.2 0 1.7.5 1.7 1.7v1.6c0 .8.5 1.4 1.3 1.7-.8.3-1.3.9-1.3 1.7v1.6c0 1.2-.5 1.7-1.7 1.7"/>'),
    edit: IC('<path d="M10.8 2.7l2.5 2.5-7.6 7.6H3.2v-2.5z"/><path d="M9.3 4.2l2.5 2.5"/>'),
    save: IC('<path d="M3 3h8.2L13 4.8V13H3z"/><path d="M5.5 3v3h4.5V3M5.5 13V9.5h5V13"/>'),
    done: IC('<path d="M3.2 8.4l3 3 6.6-6.6"/>'),
    reveal: IC('<path d="M2 4.5h4l1.4 1.5H14v6.5H2z"/>'),
    open: IC('<path d="M9.5 2.5h4v4M13.5 2.5L8 8M12 9.5v3.5H3V4h3.5"/>'), // 用默认 App 打开
    dock: IC('<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M9.5 6.5L6 10M6 7v3h3"/>'),
    max: IC('<path d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3"/>'),
    restore: IC('<path d="M6 3v3H3M10 3v3h3M10 13v-3h3M6 13v-3H3"/>'),
    close: IC('<path d="M4 4l8 8M12 4l-8 8"/>'),
    collapse: IC('<rect x="3" y="3" width="10" height="10" rx="1.5"/><path d="M5.8 8h4.4"/>'),
    plus: IC('<path d="M8 3v10M3 8h10"/>'),
    trash: IC('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v4M9 7v4"/>'),
    stop: IC('<rect x="4.5" y="4.5" width="7" height="7" rx="1"/>'),
    // 面板的视图收起成竖条时的图标：终端（框里 >_）、后台任务（清单）
    pvterm: IC('<rect x="1.8" y="2.5" width="12.4" height="11" rx="1.6"/><path d="M4.6 6.2l2 1.8-2 1.8M8.2 10.4h3.2"/>'),
    pvtasks: IC('<path d="M6.5 4.5h7M6.5 8h7M6.5 11.5h7"/><circle cx="3.4" cy="4.5" r=".5"/><circle cx="3.4" cy="8" r=".5"/><circle cx="3.4" cy="11.5" r=".5"/>'),
    logo: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 4.5C10.5 9.2 12.8 11.5 17.5 12C12.8 12.5 10.5 14.8 10 19.5C9.5 14.8 7.2 12.5 2.5 12C7.2 11.5 9.5 9.2 10 4.5Z"/><path d="M18.5 2.8C18.7 4.6 19.4 5.3 21.2 5.5C19.4 5.7 18.7 6.4 18.5 8.2C18.3 6.4 17.6 5.7 15.8 5.5C17.6 5.3 18.3 4.6 18.5 2.8Z"/></svg>',
    more: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="3.5" cy="8" r="1.15"/><circle cx="8" cy="8" r="1.15"/><circle cx="12.5" cy="8" r="1.15"/></svg>',
  };
  function page(P, kind, arg) {
    var def = PAGES[kind];
    if (!def) return null;
    var V = { page: kind, arg: arg }, host = document.createElement("div"), shown = false;
    host.className = "st-pg terminal-style-ui st-pg-" + kind;
    P.el.appendChild(host);
    // V.arg 可以变（页面里往下走：资源管理器进到某个 agent 的包里），地址、标题、恢复布局都跟着
    V.title = function () { return def.title(V.arg, V); };
    V.busy = function () { return false; };
    V.full = function () { return true; };
    V.noJump = function () { return true; };
    V.inputChanged = function () {};
    V.key = function () {};
    V.spec = function () { return { sh: P.shell.spec().sh, page: kind, arg: V.arg }; };
    V.address = function () { return def.address ? def.address(V.arg) : ""; };
    V.render = function () { host.style.display = ""; shown = true; def.render(host, P, V.arg, V); };
    V.detach = function () { host.style.display = "none"; shown = false; if (def.detach) def.detach(host, P, V.arg, V); };
    V.focus = function () { if (def.focus) def.focus(host, P, V.arg, V); else host.focus(); };
    V.redraw = function () { if (shown && !P.closed && P.program === V) { if (P.off) { P.dirty = true; return; } def.render(host, P, V.arg, V); } }; // 藏在同一组后面：露出来时再画
    V.shown = function () { return shown && !P.closed && P.program === V && !P.off; }; // 藏在同一组后面的不算（内嵌网页的原生视图也跟着藏）
    V.go = function (a) { V.arg = a; V.redraw(); if (P.win) { P.win.persist(); P.win.syncTitles(); } }; // 页面里换地方
    V.tabActions = function () { return def.tabActions ? def.tabActions(host, P, V.arg, V) : []; };
    V.host = host;
    host.tabIndex = -1;
    return V;
  }
  // 打开一页：已经开着同一页就切过去，不然新标签页
  function openPage(tw, kind, arg) {
    tw = tw || (T() && T().front());
    if (!tw) return;
    var hit = null;
    tw.ws.tabs.forEach(function (t, i) { tw.ws.leaves(t.root).forEach(function (l) { var pr = l.pane.program; if (!hit && pr && pr.page === kind && (pr.arg || null) === (arg || null)) hit = { i: i, p: l.pane }; }); });
    if (hit) { tw.ws.select(hit.i); tw.ws.activate(hit.p); hit.p.focus(); return hit.p; }
    var P = tw.ws.active, p = tw.ws.newTab({ sh: { cwd: P && P.shell && P.shell.cwd ? P.shell.cwd() : "" }, page: kind, arg: arg });
    return p;
  }

  // ======== 键盘快捷方式（同 VS Code 的 Keyboard Shortcuts）：一张能搜的表——命令、快捷键（一个键一格）、适用于、来源 ========
  // 命令面板里的命令（带快捷键的）+ 下面这些不是命令、但有快捷键的操作
  var KEYS_EXTRA = [
    { title: "聚焦地址栏", keys: "⌘L", when: "全局" }, { title: "标签页概览", keys: "⇧⌘\\", when: "全局" }, { title: "历史记录", keys: "⌘Y", when: "全局" },
    { title: "切换到第 1–8 个标签页", keys: "⌘1…⌘8", when: "编辑器组" }, { title: "切换到最后一个标签页", keys: "⌘9", when: "编辑器组" },
    { title: "放大", keys: "⌘+", when: "全局" }, { title: "缩小", keys: "⌘-", when: "全局" }, { title: "实际大小", keys: "⌘0", when: "全局" },
    { title: "切换主侧栏", keys: "⌃⌘S", when: "全局" },
    { title: "换行（不发送）", keys: "⇧Enter", when: "输入框" }, { title: "打开文件路径", keys: "⌘+单击", when: "终端、对话" }, { title: "在浏览器中打开链接", keys: "⌘+单击", when: "终端、对话" },
  ];
  // 一串快捷键拆成一个个键帽：「⇧⌘P」→ ⇧ ⌘ P；「⌘K ⌘T」是先后两下
  function keycaps(k) {
    return String(k || "").split(" ").map(function (chord) {
      var caps = [], rest = chord;
      while (rest && /^[⌃⌥⇧⌘]/.test(rest)) { caps.push(rest[0]); rest = rest.slice(1); }
      if (rest) caps.push(rest);
      return '<span class="st-kchord">' + caps.map(function (c) { return '<kbd class="st-kc">' + esc(c) + "</kbd>"; }).join("") + "</span>";
    }).join('<span class="st-kthen"></span>').replace(/^/, '<span class="st-kcaps">') + "</span>";
  }
  var keysQ = "";
  function keyRows() {
    var rows = CMDS.filter(function (c) { return c.keys; }).map(function (c) { return { title: c.title, keys: c.keys, when: c.when0 || "全局", src: "系统", run: c.run }; }).concat(KEYS_EXTRA.map(function (x) { return Object.assign({ src: "系统" }, x); }));
    var seen = {}; rows = rows.filter(function (r) { var k = r.title + "|" + r.keys; if (seen[k]) return false; seen[k] = 1; return true; }); // 命令表和额外那几条里都有的（标签页概览）：只列一次
    return rows.sort(function (a, b) { return a.title.localeCompare(b.title, "zh-CN"); });
  }
  // 以前单独的「键盘快捷方式」标签页：留着给恢复出来的旧标签页用；新打开的都去 设置 › 键盘快捷方式（showPage 那里转过去）
  PAGES.keys = {
    title: function () { return "键盘快捷方式"; },
    address: function () { return "paimon.code/keys"; },
    render: function (host, P, arg, V) {
      var rows = keyRows();
      if (!host.querySelector(".st-kq")) {
        host.innerHTML = '<div class="st-keys"><div class="st-search"><input class="st-kq" placeholder="搜索快捷键" spellcheck="false" autocomplete="off"></div><div class="st-ktable"></div></div>';
        var inp = host.querySelector(".st-kq");
        inp.value = keysQ;
        inp.addEventListener("input", function () { keysQ = inp.value; V.redraw(); });
        inp.addEventListener("keydown", function (e) { if (e.key === "Escape" && inp.value) { inp.value = keysQ = ""; V.redraw(); } e.stopPropagation(); });
        host.querySelector(".st-ktable").addEventListener("dblclick", function (e) { var r = e.target.closest("[data-k]"); if (!r) return; var row = host.stRows[+r.dataset.k]; if (row && row.run) row.run(T() && T().front()); }); // 双击：执行这个命令
      }
      var q = keysQ.trim().toLowerCase().replace(/\s+/g, "");
      var shown = rows.filter(function (r) { return !q || (r.title + r.keys + r.when).toLowerCase().replace(/\s+/g, "").indexOf(q) >= 0; });
      host.stRows = shown;
      host.querySelector(".st-ktable").innerHTML = '<div class="st-krow st-khead"><span>命令</span><span>快捷键</span><span>适用于</span><span>来源</span></div>' +
        shown.map(function (r, i) { return '<div class="st-krow" data-k="' + i + '"><span class="st-cut">' + esc(r.title) + '</span><span>' + keycaps(r.keys) + '</span><span class="st-dim st-cut">' + esc(r.when) + '</span><span class="st-dim">' + esc(r.src) + "</span></div>"; }).join("") +
        (shown.length ? "" : '<div class="st-dim st-kempty">未找到结果</div>');
    },
    focus: function (host) { var i = host.querySelector(".st-kq"); if (i) i.focus(); },
  };

  // ---- 设置：只有「通用」和现在这个应用风格自己的（别的应用风格的设置在这里没有意义，不列出来）。
  //      左边只列顶级分区（通用、账号、这个风格的、Agent 的……），点一个右边就只看那一个分区（分区和分区不连着滚；分区里的小节连着滚）；搜索时列出所有分区里找到的。三个样子：
  //      VS Code（Pure Terminal 同）：上面搜索框；左边分区、中间这一区、右边「本页」（这一区的小节和各项）——三栏各自滚动；
  //      Claude App：一张表单，左边搜索、分组的分区（图标 + 名字），右边一行一项（名字在左、控件在右）；macOS：同系统设置（顶上一张标题卡片、分组的圆角卡片）。
  //      三级字号分得开：分区名（大）> 小节标题（像标题：VS Code 大一号带分隔线、Claude App 粗体、macOS 卡片上面的组名）> 一项的名字（正文），说明是淡的。
  //      每一项：名字、说明（VS Code 全显示，别的只显示必要的——「设置说明」可改）、控件——开关、下拉框（几选一）、输入框、滑块（有先后的）、
  //      两三个短选项的（Claude App 分段控件 / macOS 单选按钮）；和默认不一样的：名字后面一个小圆点（VS Code）。
  //      重画只换变了的：框架（搜索框、左边目录）留着，右边只换变了的那几行——换分区不闪、开关的动画走得完。窄的时候左边的分区变成上面一排。
  //      焦点：点控件、开下拉框都不会跑到搜索框（只有 ⌘F、或者焦点不在输入框里时直接打字才到搜索框）----
  var SECTIONS = {};
  // 设置左边的分组和顺序（别的文件登记的分区也在这里排；同 Claude 的 Settings / Desktop app / Customize）：
  //   设置——通用、账号、用量；App——外观、布局（Claude App 是侧边栏与卡片）、对话、终端；Agent——连接器（Paimon Code、Claude Code、Codex 各是它的第二级）；
  //   开发者——开了开发者功能才有。under：不在左边单列，挂在别的分区的第二级那一页里
  var SEC_META = {
    general: { group: "settings", order: 1 }, account: { group: "settings", order: 2 }, usage: { group: "settings", order: 3 },
    appearance: { group: "app", order: 10 }, layout: { group: "app", order: 11 }, sidebar: { group: "app", order: 11 }, desktop: { group: "app", order: 11 }, tabs: { group: "app", order: 11 },
    view: { group: "app", order: 12 }, terminal: { group: "app", order: 13 },
    // Paimon 不是连接器（不接外面的 CLI），是 Studio 内置的助手：左边单独一项，在「连接器」下面（用户定的）
    connectors: { group: "agents", order: 20 }, paimon: { group: "agents", order: 21, title: "Paimon", desc: "内置助手：监看其他 Agent 的运行" }, claude: { under: "connectors/claude-code" },
    keys: { group: "app", order: 14 }, advanced: { group: "adv", order: 80 }, about: { group: "adv", order: 85 }, developer: { group: "dev", order: 90 },
  };
  var GROUPS = { settings: "Studio", app: "应用", agents: "Agent", adv: "", dev: "开发者" }; // adv：不写组名，只空一点——「高级」单独在最下面 // 第一组不再叫「设置」：窗口标题、搜索框已经写了两遍「设置」
  function addSettings(id, sec) { if (id === "view") sec = viewPaged(sec); if (id === "paimon") sec = paimonPage(sec); SECTIONS[id] = Object.assign(sec, SEC_META[id] || {}); }
  // Paimon 那一页最上面：开 / 关（内置助手，默认关着；开关在它自己这一页，不在连接器列表里）；开着才列它自己的设置（模型、工具……）
  function paimonPage(sec) {
    var f0 = sec.fields, ch0 = sec.change, C = function () { return window.TSU_CONNECTORS; };
    sec.fields = function (tw) {
      var on = !!(C() && C().on("paimon")), head = [{ key: "pmOn", label: "启用 Paimon", desc: "Studio 内置助手：不直接编写代码，负责监看正在运行的 Agent，并在需要时提醒和协助", must: true, kind: "toggle", value: on, def: false }];
      return on ? head.concat(f0 ? f0(tw) : []) : head;
    };
    sec.change = function (k, v, tw) { if (k === "pmOn") { if (C()) C().set("paimon", !!v); redrawSettings(); return; } return ch0 ? ch0(k, v, tw) : undefined; };
    return sec;
  }
  // 设置 › 对话（live.js 登记的，三十来项）：分两级，好找——第一级：视图预设（一排卡片）、内容（消息、思考……）、显示（时间戳、任务清单、翻译……）；
  //   「工具（调用与结果）」「Agent 消息」「系统」各是一页第二级（第一级最后一行一个，右边写现在的样子）。项和改法还是 live.js 的，这里只按小节标题分页。
  //   工具每一类的说明（Read、Glob、Grep……）一直显示：光看「读取与搜索」不知道管哪些工具
  var VIEW_PAGES = { "工具（调用与结果）": "tools", "Agent 消息": "agent", "系统": "system" };
  function viewPaged(sec) {
    var fields0 = sec.fields;
    sec.pages = { tools: { title: "工具（调用与结果）", nav: "工具（调用与结果）" }, agent: { title: "Agent 消息" }, system: { title: "系统" } };
    sec.fields = function (tw) {
      var pg = "";
      var list = (fields0 ? fields0(tw) : []).map(function (f) {
        if ("head" in f) { pg = VIEW_PAGES[f.head] || ""; return pg ? { head: "", page: pg } : f; } // 这一页的标题就是它的名字：页里不再写一遍
        if (!pg) return f;
        var o = Object.assign({}, f, { page: pg });
        if (/^tool[A-Z]/.test(f.key) && f.kind === "seg") o.must = true;
        return o;
      });
      // 「译文出现方式」跟在「回复翻译」后面（它只管回复翻译）
      var keyAt = function (key) { for (var i = 0; i < list.length; i++) if (list[i].key === key) return i; return -1; }, a = keyAt("translateShow"), b = keyAt("translateReplies");
      if (a >= 0 && b > a) list.splice(b, 0, list.splice(a, 1)[0]);
      return list;
    };
    // 去第二级那一行右边：工具——几类显示、几类隐藏；Agent 消息——「全部」那一档；系统——几项显示
    sec.summary = function (p) {
      var fs = p.fields.filter(function (f) { return !("head" in f); }), lab = function (f) { var o = (f.options || []).filter(function (x) { return x[0] === f.value; })[0]; return o ? o[1] : ""; };
      var shown = function (f) { return f.kind === "toggle" ? !!f.value : f.value !== "hidden"; };
      if (p.id === "tools") { var ts = fs.filter(function (f) { return /^tool[A-Z]/.test(f.key) && f.kind === "seg"; }), on = ts.filter(shown).length; return !ts.length ? "" : on === ts.length ? "都显示" : !on ? "都隐藏" : on + " 类显示，" + (ts.length - on) + " 类隐藏"; }
      if (p.id === "agent") { var am = fs.filter(function (f) { return f.key === "agentMsgs"; })[0]; return am ? lab(am) : ""; }
      var sw = fs.filter(function (f) { return f.kind === "toggle" || f.kind === "seg"; }), n = sw.filter(shown).length;
      return !sw.length ? "" : n === sw.length ? "都显示" : !n ? "都隐藏" : n + " 项显示，" + (sw.length - n) + " 项隐藏";
    };
    return sec;
  }
  // page：这一区的第二级（"" 是第一级）。没有 ‹ › 的历史：只有上下两级——第二级的标题「分区 › 这一页」里点分区（或 Esc）回第一级
  var setState = { sec: "", page: "", q: "", sel: "", jump: "", scroll: {} };
  // 顶上的 ‹ ›（同系统设置、浏览器）：去过的页（分区 + 第二级）一条条记着，‹ 回上一页、› 再往前；在中间又去了别处，前面的就不要了
  var setHist = { list: [], i: -1 };
  function histPush() { var k = setState.sec + "/" + (setState.page || ""); if (setHist.list[setHist.i] === k) return; setHist.list = setHist.list.slice(0, setHist.i + 1); setHist.list.push(k); if (setHist.list.length > 60) setHist.list.shift(); setHist.i = setHist.list.length - 1; }
  var secIds = function (tw) { return Object.keys(SECTIONS).filter(function (k) { return !SECTIONS[k].under && (!SECTIONS[k].show || SECTIONS[k].show(tw)); }).sort(function (a, b) { return (SECTIONS[a].order || 50) - (SECTIONS[b].order || 50); }); };
  var trL = function (s) { return s && window.TSU_I18N && TSU_I18N.lang() !== "zh" ? TSU_I18N.t(s) : ""; }; // 显示成英文时，搜英文也找得到
  var ddLabel = function (f) { var o = (f.options || []).filter(function (x) { return x[0] === f.value; })[0]; return o ? o[1] : f.value === "custom" ? "自定义" : String(f.value == null ? "" : f.value); };
  // 设置页现在是哪个样子：vscode（Pure Terminal 也用它）/ claude / macos
  var ssStyle = function () { return root.classList.contains("st-macos") ? "macos" : root.classList.contains("st-os-claude") ? "claude" : "vscode"; };
  var NA = "在此应用风格下不可用"; // 选不了的选项（应用风格定死了的）：灰着，写这句
  // 说明显示不显示：默认只显示必要的（must，或别的文件定的项在 DESC_MUST 里）；「设置说明」选「详细」全显示
  var DESC_MUST = { "paimon:recap": 1, "paimon:sandbox": 1, "terminal:copyOnSelect": 1 };
  function descOn(f, key) {
    if (!f.desc) return false;
    return getv("settingsDesc") === "all" || !!(f.must || DESC_MUST[key]);
  }
  // 选项的字体（界面字体、代码字体：每一项用它自己的字画）
  var optFont = function (f, o) { var ff = f.fontOf ? f.fontOf(o[0]) : ""; return ff ? ' style="font-family:' + esc(ff).replace(/"/g, "&quot;") + '"' : ""; };
  function setRow(S, k, f, i, q) {
    var key = k + ":" + f.key, di = ' data-i="' + i + '"', ctl, sty = ssStyle(), dOn = descOn(f, key), desc = dOn ? '<div class="ss-desc">' + esc(f.desc) + "</div>" : "";
    var na = f.na || {}, os0 = f.options || [], isCards = os0.length > 1 && (f.cards || f.key === "$preset");
    // 几个短选项画成分段控件：一眼看全、点一下就换（下拉框要点开才知道有什么）。VS Code 四个以内、每个不长（中文按两格算）；Claude App 三个以内
    var wid = function (s) { return String(s).replace(/[\u2e80-\u9fff\uff00-\uffef]/g, "  ").length; };
    var segOK = os0.length > 1 && (sty === "vscode" ? os0.length <= 4 && os0.every(function (o) { return wid(o[1]) <= 12; }) && os0.reduce(function (n, o) { return n + wid(o[1]); }, 0) <= 34 : os0.length <= 3 && os0.every(function (o) { return String(o[1]).length <= 14; }));
    // 开关（同 macOS 系统设置：钮滑过去、底填上强调色）；灰着的写原因（disabled 给一句话时，比如「在此应用风格下不可用」）
    if (f.kind === "toggle") { ctl = '<label class="ss-checkrow"><input type="checkbox" role="switch" class="ss-check"' + di + (f.value ? " checked" : "") + (f.disabled ? " disabled" + (typeof f.disabled === "string" ? ' title="' + esc(f.disabled) + '"' : "") : "") + ">" + (dOn ? '<span class="ss-desc">' + esc(f.desc) + "</span>" : "") + "</label>"; desc = ""; }
    else if (f.kind === "number") ctl = '<input class="ss-input ss-num" type="number"' + di + ' value="' + esc(f.value) + '"' + (f.min != null ? ' min="' + f.min + '"' : "") + (f.max != null ? ' max="' + f.max + '"' : "") + ">";
    else if (f.kind === "text") ctl = '<input class="ss-input" type="text"' + di + ' value="' + esc(f.value || "") + '" spellcheck="false" autocomplete="off" placeholder="' + esc(f.placeholder || "") + '"' + (f.fontOf && f.value ? optFont(f, [f.value]) : "") + ">" + (f.suggest ? '<button class="ss-sugbtn" data-i="' + i + '" title="选择">' + ICO.more + "</button>" : "");
    else if (f.kind === "info") ctl = '<span class="ss-info' + (f.cls ? " " + f.cls : "") + '">' + esc(f.value) + "</span>"; // 只看的（账户名、余额）
    else if (f.kind === "keys") ctl = keycaps(f.keys); // 快捷键：一个个键帽
    else if (f.kind === "button") ctl = '<button type="button" class="ss-btn' + (f.primary ? " primary" : "") + (f.danger ? " danger" : "") + '" data-sact="' + esc(f.act) + '">' + esc(f.text || f.label) + "</button>";
    else if (f.kind === "avatar") ctl = '<button type="button" class="ss-avbtn" title="更换头像">' + avatarHtml(40) + '<i class="ss-avshuf">' + SHUFFLE + "</i></button>"; // 自己的头像：指着出现「换一个」，点一下换下一种
    else if (f.kind === "meter") { // 一长条：限额用了多少（快满了变橙、变红）；cls left 是「还剩多少」（剩得少了变色）
      var pv = +f.pct || 0, lvl = f.cls === "left" ? (pv < 5 ? " hot" : pv < 20 ? " warm" : "") : (pv >= 95 ? " hot" : pv >= 80 ? " warm" : "");
      ctl = '<div class="ss-meter' + lvl + '" role="meter" aria-valuenow="' + Math.round(pv) + '" aria-valuemin="0" aria-valuemax="100"><i style="width:' + pv.toFixed(1) + '%"></i></div><span class="ss-mt">' + esc(f.text) + "</span>";
    } else if (f.kind === "line") ctl = ""; // 只有一行字（结论、没有数据）
    else if (f.kind === "stat") ctl = f.pct != null ? '<div class="ss-ubar' + (f.warn ? " warn" : "") + '" role="meter" aria-valuenow="' + Math.round(f.pct) + '" aria-valuemin="0" aria-valuemax="100"><i style="width:' + Math.max(0, Math.min(100, +f.pct || 0)).toFixed(1) + '%"></i></div><span class="ss-upct">' + esc(f.pctText || "") + "</span>" : ""; // 一个大的数（余额）、下面淡的一行；右边一条细的长条和「已用 x%」
    else if (f.kind === "pairs") ctl = '<div class="ss-prs">' + (f.pairs || []).map(function (x) { return '<span class="ss-pr"><span>' + esc(x[0]) + "</span><b>" + esc(x[1]) + "</b></span>"; }).join("") + "</div>"; // 几对「名字 值」排成一行
    else if (f.kind === "nav") ctl = (f.value ? '<span class="ss-navv">' + esc(f.value) + "</span>" : "") + (f.sw ? '<input type="checkbox" role="switch" class="ss-check ss-navsw"' + di + ' data-tk="' + esc(f.sw.key) + '"' + (f.sw.value ? " checked" : "") + (f.sw.disabled ? " disabled" : "") + ">" : "") + '<i class="ss-navc"></i>'; // 去第二级的一行：现在的样子（淡的）、开关（有的话）、›
    else if (f.kind === "swatch") ctl = '<div class="ss-swatches" role="radiogroup">' + os0.map(function (o, j) { return '<button type="button" class="ss-sw' + (o[0] === f.value ? " on" : "") + '" data-i="' + i + '" data-j="' + j + '" role="radio" aria-checked="' + (o[0] === f.value) + '" title="' + esc(o[1]) + '"><i style="background:' + esc(o[2] || "#333") + '"></i><span>' + esc(o[1]) + "</span></button>"; }).join("") + "</div>"; // 墙纸：一排缩略图
    else if (f.kind === "slider") {
      var at = Math.max(0, os0.findIndex(function (o) { return o[0] === f.value; })), pc = os0.length > 1 ? at / (os0.length - 1) * 100 : 0;
      ctl = '<div class="ss-slider"><input type="range" class="ss-range"' + di + ' min="0" max="' + Math.max(0, os0.length - 1) + '" step="1" value="' + at + '" style="--p:' + pc + '%"><div class="ss-stops">' +
        os0.map(function (o, j) { return '<span' + (j === at ? ' class="on"' : "") + ' data-j="' + j + '">' + esc(o[1]) + "</span>"; }).join("") + "</div></div>";
    } else if (isCards) {
      // 视图预设：一排卡片（名字 + 一句话说是什么样子），点一张就整套换上；「自定义」只在现在和哪一套都不一样时出现（点它不变）
      ctl = '<div class="ss-pcards" role="radiogroup">' + os0.map(function (o, j) { var on = o[0] === f.value; return '<button type="button" class="ss-opt ss-pcard' + (on ? " on" : "") + (o[0] === "custom" ? " ss-pcust" : "") + '" data-i="' + i + '" data-j="' + j + '" role="radio" aria-checked="' + on + '"><b>' + esc(o[1]) + "</b>" + (o[2] ? "<span>" + esc(o[2]) + "</span>" : "") + "</button>"; }).join("") + "</div>";
    } else if (segOK) {
      // 几个短选项：VS Code 一排分段按钮（选中的强调色底）；Claude App 画成分段控件（滑动的那块由 seg.js 画）、macOS 画成单选按钮
      // 有图标的（主题：显示器 / 太阳 / 月亮）：按钮上只画图标，名字放在提示里
      ctl = '<div class="ss-opts' + (sty === "claude" ? " st-seg" : "") + (f.icons ? " ss-icons" : "") + '" role="radiogroup" data-seg-key="set:' + esc(key) + '">' + os0.map(function (o, j) { var off = na[o[0]], ic = f.icons && f.icons[o[0]]; return '<button type="button" class="ss-opt' + (o[0] === f.value ? " on" : "") + (off ? " na" : "") + '" data-i="' + i + '" data-j="' + j + '" role="radio" aria-checked="' + (o[0] === f.value) + '"' + (off ? ' disabled title="' + esc(off) + '"' : ic ? ' title="' + esc(o[1]) + '" aria-label="' + esc(o[1]) + '"' : "") + optFont(f, o) + ">" + (ic || esc(o[1])) + "</button>"; }).join("") + "</div>";
    } else ctl = '<button class="ss-dd"' + di + ' type="button"><span class="ss-ddv"' + optFont(f, [f.value]) + ">" + esc(ddLabel(f)) + '</span><i class="ss-ddc"></i></button>'; // 几选一：下拉框
    // 改没改过（和默认不一样）不在界面上标出来
    return '<div class="ss-row' + (setState.sel === key ? " on" : "") + (f.kind === "button" || f.kind === "info" || f.kind === "avatar" || f.kind === "nav" || f.kind === "stat" || f.kind === "keys" ? " ss-plain" : "") + (f.half ? " ss-half" : "") + " ss-k-" + (isCards ? "cards" : f.kind || "seg") + (f.rowCls ? " " + f.rowCls : "") + (f.kind === "stat" && f.cls ? " " + f.cls : "") + '" data-row="' + i + '" data-k="' + esc(key) + '"' + (f.to ? ' data-to="' + esc(f.to) + '"' : "") + ' tabindex="-1"><div class="ss-title">' +
      (newSet(key) ? '<i class="ss-newdot" title="这一版新加的设置"></i>' : "") + '<span class="ss-name">' + esc(f.label) + "</span></div>" + desc + '<div class="ss-ctl">' + ctl + "</div>" + (f.after ? f.after() : "") + "</div>";
  }
  // 新加的设置：名字前面一个蓝点（同 App 里「有新东西」的那种），看过（打开过那一页几秒、改过它）就不再标。
  //   只给测试账号（管理员）和开了「开发者功能」的——正式用户不打扰。新加一项设置就在 NEW_SETS 里写上它的键
  var NEW_SETS = { layButtons: "0.2.397" };
  var seenSets = store("st-seen-sets", {});
  var newSet = function (k) {
    if (!NEW_SETS[k] || seenSets[k]) return false;
    var me = window.TSU_AGENTS && TSU_AGENTS.me ? TSU_AGENTS.me() : null;
    return !!((me && me.admin) || getv("devFeatures"));
  };
  var seenSoon = function (keys) { setTimeout(function () { var ch = false; keys.forEach(function (k) { if (NEW_SETS[k] && !seenSets[k]) { seenSets[k] = 1; ch = true; } }); if (ch) keep("st-seen-sets", seenSets); }, 4000); };
  // 左边目录里分区的图标（Claude App 画；macOS 用自己的彩色方块；VS Code 不画）
  var SV16 = function (b) { return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">' + b + "</svg>"; };
  // 设置左边一列的图标：同一套干净的线条图标（24 格、圆头圆角，同 Lucide 的画法；以前手画的齿轮歪、粗细不一）
  var SV24 = function (b) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + b + "</svg>"; };
  var SEC_ICO = {
    general: SV24('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
    account: SV24('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662"/>'),
    usage: SV24('<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>'), // 仪表
    appearance: SV24('<circle cx="12" cy="12" r="10"/><path d="M12 18a6 6 0 0 0 0-12v12z"/>'), // 对比（外观）
    keys: SV24('<rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/>'), // 键盘
    advanced: SV24('<path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/>'), // 滑块（高级）
    developer: SV24('<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>'), // { }
    layout: SV24('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="M9 15h12"/>'),
    desktop: SV24('<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>'),
    sidebar: SV24('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>'),
    tabs: SV24('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 4v4M2 8h20M6 4v4"/>'),
    terminal: SV24('<path d="m7 11 2-2-2-2"/><path d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2"/>'),
    get paimon() { return (window.TSU_LOGOS && TSU_LOGOS.paimon) || '<img class="pm-av" src="img/paimon.png" alt="" draggable="false">'; }, // Paimon：派蒙的头像（不是四角星）；读进内存的那一份（ext.js）
    view: SV24('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'), // 对话：一个气泡
    claude: window.TSU_LOGOS && TSU_LOGOS.claudePath ? '<svg viewBox="-13 -13 126 127"><path fill="currentColor" d="' + TSU_LOGOS.claudePath + '"/></svg>' : SV24('<circle cx="12" cy="12" r="9"/>'), // Claude Code：Claude 自己的标志（不是画的星号）
    extensions: SV24('<rect width="7" height="7" x="14" y="3" rx="1"/><path d="M10 21V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3"/>'),
    about: SV24('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'), // 关于：圆里一个 i
    connectors: SV24('<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>'), // 插头：会话在哪里跑（Claude Code、Codex、派蒙）
  };

  // Claude App 的主题（同 Claude App：显示器 = 跟随系统、太阳 = 浅色、月亮 = 深色）
  var THEME_ICO = {
    system: SV16('<rect x="1.8" y="2.6" width="12.4" height="8.6" rx="1.4"/><path d="M5.6 13.6h4.8M8 11.2v2.4"/>'),
    light: SV16('<circle cx="8" cy="8" r="2.8"/><path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M3.5 12.5l1.1-1.1M11.4 4.6l1.1-1.1"/>'),
    dark: SV16('<path d="M13.3 9.6A5.6 5.6 0 0 1 6.4 2.7a5.6 5.6 0 1 0 6.9 6.9z"/>'),
  };
  // 右边一块一块的（一行一项、标题、说明……）：重画时只换变了的那几块
  var SS_BLOCK = ".ss-row, .ss-note, .ss-hero, .ss-h2, .ss-h3, .ss-none, .ss-pagehead, .ss-pageh";
  var ssSig = function (e) { return e.className.split(" ")[0] + "|" + (e.dataset.k || "") + "|" + (e.classList.contains("ss-row") ? "" : e.textContent); };
  function ssBody(host, B, html) {
    var tmp = document.createElement("div");
    tmp.innerHTML = html;
    var nb = Array.prototype.slice.call(tmp.querySelectorAll(SS_BLOCK)), sig = nb.map(ssSig).join("\n"), nh = nb.map(function (e) { return e.outerHTML; });
    var ob = Array.prototype.slice.call(B.querySelectorAll(SS_BLOCK));
    if (host.bodySig === sig && ob.length === nb.length && host.blockH) {
      for (var i = 0; i < nb.length; i++) if (nh[i] !== host.blockH[i]) ob[i].replaceWith(nb[i]);
    } else {
      var top = B.scrollTop;
      B.replaceChildren.apply(B, Array.prototype.slice.call(tmp.childNodes)); // 一下子换好（中间不排版，不闪）
      B.scrollTop = top;
    }
    host.bodySig = sig; host.blockH = nh;
  }
  PAGES.settings = {
    title: function () { return "设置"; },
    address: function () { return "settings"; },
    render: function (host, P, arg) {
      // Claude App：设置从来不是标签页——放在编辑区里的那一页（VS Code 风格里放进去的、agent 打开的、历史里的）换成盖在窗口上的表单
      if (root.classList.contains("st-os-claude") && host.isConnected && !host.closest(".st-float") && P.win && P.win.ws && P.win.ws.all && P.win.ws.all().indexOf(P) >= 0) {
        if (!host.toFloat) { host.toFloat = true; setTimeout(function () { var w = P.win; if (w.ws.all().indexOf(P) >= 0 && w.ws.closePane) w.ws.closePane(P); floatPage(w, "settings", null); }, 0); }
        return;
      }
      var tw = P.win, ids = secIds(tw), sty = ssStyle(), curOS = getv("os") || "vscode";
      if (host.dataset.want !== String(arg)) { host.dataset.want = String(arg); if (ids.indexOf(arg) >= 0) { setState.sec = arg; setState.page = ""; } }
      if (!setState.sec || ids.indexOf(setState.sec) < 0) { setState.sec = ids[0]; setState.page = ""; }
      if (setHist.i < 0) histPush();
      var q = setState.q.trim().toLowerCase(), rows = [], body = "", toc = "", tree = [], paged = !q, headTitle = "", headCrumb = "";
      var fieldsOf = function (k) { return secFields(k, tw); }; // 别的应用风格的项不列；挂在第二级下面的分区的项在那一页里
      if (paged) {
        // 一页：这一区的第一级（它自己的项 + 去第二级的那几行），或者它的某个第二级
        var k = setState.sec, S = SECTIONS[k], pg = secPages(S, fieldsOf(k));
        if (setState.page && !pg.pages[setState.page]) setState.page = "";
        var P2 = setState.page ? pg.pages[setState.page] : null, list = P2 ? P2.fields : pg.top;
        // 自己写了去第二级那一行的（用量的卡片顶上）：不再在最后补；那一页没有东西的：不带 ›，只是名字
        if (!P2) list = list.map(function (f) { return f.kind === "nav" && f.to && !pg.pages[f.to] && S.levels !== 2 ? Object.assign({}, f, { kind: "line", value: "" }) : f; });
        if (!P2 && pg.order.length) { var nv = navRows(S, pg).filter(function (r) { return !list.some(function (f) { return f.kind === "nav" && f.to === r.to; }); }); if (nv.length) list = S.levels === 2 ? nv.concat(list.length ? [{ head: "" }] : [], list) : list.concat([{ head: "" }], nv); }
        var hero = sty === "macos" && !P2 ? '<div class="ss-hero"><div class="ss-hero-ic" data-sec-ic="' + k + '">' + esc(S.icon || S.title.slice(0, 1)) + '</div><div class="ss-hero-t">' + esc(S.title) + "</div>" + (S.desc ? '<div class="ss-hero-d">' + esc(S.desc) + "</div>" : "") + "</div>" : "";
        body = hero + '<section class="ss-sec ss-paged" data-sec="' + k + '" data-page="' + esc(setState.page || "") + '">' + (!P2 && S.note ? '<div class="ss-note">' + S.note(tw) + "</div>" : "") + cardsHtml(S, k, list, rows, "", setState.page || "") + "</section>";
        if (!rows.length) body = '<div class="ss-none">没有设置</div>';
        headTitle = S.title; headCrumb = P2 ? P2.title : "";
        ids.forEach(function (k2) { tree.push({ k: k2, title: SECTIONS[k2].title, group: SECTIONS[k2].group }); });
      } else {
        // 搜索：所有分区、所有页里找到的项，按页分开（「分区」或「分区 › 第二级」）；点一项的名字：去它那一页、它闪一下
        ids.forEach(function (k) {
          var S = SECTIONS[k], pg = secPages(S, fieldsOf(k)), any = false;
          [{ id: "", title: S.title, fields: pg.top }].concat(pg.order.map(function (id) { return { id: id, title: S.title + " › " + pg.pages[id].title, fields: pg.pages[id].fields }; })).forEach(function (g) {
            var head = "", keep = [];
            g.fields.forEach(function (f) { if ("head" in f) { head = f.head; keep.push(f); return; } if ([S.title, g.title, head, f.label, f.desc, trL(S.title), trL(head), trL(f.label), trL(f.desc)].join(" ").toLowerCase().indexOf(q) >= 0) keep.push(f); });
            var n0 = rows.length, html = cardsHtml(S, k, keep, rows, q, g.id);
            if (rows.length > n0) { any = true; body += '<section class="ss-sec ss-found" data-sec="' + k + '" data-page="' + esc(g.id) + '"><h2 class="ss-h2">' + esc(g.title) + "</h2>" + html + "</section>"; }
          });
          if (any) tree.push({ k: k, title: S.title, group: S.group });
        });
        if (!rows.length) body = '<div class="ss-none">未找到设置</div>';
        headTitle = "搜索结果";
      }
      // 左边：只有顶级分区（小节不列——右边自己滚着看）；Claude App 按组列、前面一个图标，macOS 是彩色小方块
      var lastG = null;
      toc = tree.map(function (t) {
        var g = t.group || "agents", gh = "";
        if (g !== lastG) { lastG = g; gh = '<div class="ss-grp">' + esc(GROUPS[g] || "") + "</div>"; }
        return gh + '<div class="ss-ti ss-t1" data-go="' + t.k + '"><i class="ss-sic">' + (SEC_ICO[t.k] || SEC_ICO.general) + "</i><span>" + esc(t.title) + "</span></div>";
      }).join("");
      host.tree = tree;
      host.rows = rows;
      // 右边顶上一条（不跟着滚）：这一页的名字；第二级是「分区 › 这一页」——点分区回第一级（没有返回按钮）
      var hnav = ""; // 设置里不放 ‹ ›（用户：看着难受）；第二级的标题「分区 › 这一页」点分区、Esc 回第一级
      var headH = hnav + '<span class="ss-ht' + (headCrumb ? " ss-up" : "") + '"' + (headCrumb ? ' data-up="1" role="link" title="' + esc(headTitle) + '"' : "") + ">" + esc(headTitle) + "</span>" + (headCrumb ? '<span class="ss-hc">' + esc(headCrumb) + "</span>" : "");
      // 焦点在哪个控件（光标位置）：换掉那一行以后放回去
      var ae = document.activeElement, focus = null;
      if (ae && host.contains(ae) && !ae.classList.contains("ss-q")) { var rw0 = ae.closest(".ss-row"); focus = { k: rw0 && rw0.dataset.k, ctl: !!rw0 && ae !== rw0, j: ae.dataset && ae.dataset.j, s: ae.tagName === "INPUT" && ae.type === "text" ? [ae.selectionStart, ae.selectionEnd] : null }; }
      closeDD();
      // 框架（左边：搜索框、分区；右边：顶上一条、内容）只在第一次、换了样子时搭；之后只换里面
      var ss = host.querySelector(":scope > .ss");
      if (!ss || ss.dataset.sty !== sty) {
        host.innerHTML = '<div class="ss" data-sty="' + sty + '" tabindex="-1"><div class="ss-top"><input class="ss-q" type="text" placeholder="搜索设置" spellcheck="false" autocomplete="off"></div><div class="ss-cols"><nav class="ss-toc"></nav><div class="ss-main"><div class="ss-head"></div><div class="ss-body"></div></div></div></div>';
        ss = host.firstChild;
        ss.querySelector(".ss-q").value = setState.q;
        var B0 = ss.querySelector(".ss-body");
        B0.addEventListener("scroll", function () { closeDD(); settingsSpy(host); }, { passive: true });
        host.tocH = host.headH = host.bodyKey = host.bodySig = host.blockH = null;
      }
      ss.classList.toggle("ss-pagedmode", paged);
      var qi = ss.querySelector(".ss-q"); if (qi.value !== setState.q && document.activeElement !== qi) qi.value = setState.q; // 别处清了搜索（跳到某一项）：框里也清掉
      var B = ss.querySelector(".ss-body"), TOC = ss.querySelector(".ss-toc"), HEAD = ss.querySelector(".ss-head");
      if (host.tocH !== toc) { var tt = TOC.scrollTop; TOC.innerHTML = toc; TOC.scrollTop = tt; host.tocH = toc; }
      if (host.headH !== headH) { HEAD.innerHTML = headH; host.headH = headH; }
      // 换了页：从最上面看；同一页重画（改了一项）：滚动一点不动——点的那一行留在原来的位置（上面的行高变了也一样）
      var key = paged ? "p:" + setState.sec + "/" + (setState.page || "") : "q:" + q, same = host.bodyKey === key, st0 = B.scrollTop, anchor = null, ay = 0;
      if (same && setState.sel) { anchor = B.querySelector('.ss-row[data-k="' + CSS.escape(setState.sel) + '"]'); if (anchor) ay = anchor.getBoundingClientRect().top; }
      if (!same) { host.bodySig = null; }
      ssBody(host, B, body);
      if (!same) { host.bodyKey = key; B.scrollTop = 0; }
      else {
        B.scrollTop = st0;
        var a2 = anchor && B.querySelector('.ss-row[data-k="' + CSS.escape(setState.sel) + '"]');
        if (a2) { var dy = a2.getBoundingClientRect().top - ay; if (dy) B.scrollTop = st0 + dy; }
      }
      if (focus && focus.k && !host.contains(document.activeElement)) {
        var fe = host.querySelector('.ss-row[data-k="' + CSS.escape(focus.k) + '"]');
        if (fe && focus.ctl) fe = (focus.j != null && fe.querySelector('[data-j="' + focus.j + '"]')) || fe.querySelector("input, button") || fe;
        if (fe) { fe.focus({ preventScroll: true }); if (focus.s && fe.setSelectionRange) try { fe.setSelectionRange(focus.s[0], focus.s[1]); } catch (e) { /* 不是文字框 */ } }
      }
      if (setState.jump) { settingsGo(host, setState.jump); setState.jump = ""; }
      settingsSpy(host);
      if (!host.bound) { host.bound = true; bindSettings(host, P, arg); }
    },
    // 面板要焦点（点了面板任何地方都会来这里）：焦点已经在设置页里（点的控件、开着的下拉框）就不动；不然给整页（不是搜索框——只有 ⌘F、直接打字才去搜索框）
    focus: function (host) { var ae = document.activeElement; if (ae && host.contains(ae)) return; var ss = host.querySelector(".ss"); if (ss) ss.focus({ preventScroll: true }); },
    tabActions: function (host, P) { return LOC() && !HYB() ? [{ icon: ICO.json, title: "打开设置 (JSON)", run: function () { openFile(P.win, setState.sec === "claude" ? ccFile() : setFile()); } }] : []; },
  };
  // ---- 两级：一个分区是一页（第一级）；有的项分到它的第二级（S.pages：{ id: { title, nav?, desc? } }，项上标 page: id——比如「通用 › 高级」）。
  //      levels: 2 的分区（连接器）：每个 { head } 一组是一页，第一级是它们的目录（一行一个：名字、现在的样子、›）；标了 top 的项留在第一级 ----
  // 一个分区现在有哪些项：别的应用风格的项不列；挂在它第二级下面的分区（SEC_META 的 under：Paimon Code、Claude Code → 连接器 › 它们那一页）
  //   的项接在那一页后面（不带标题的先起一张新卡片），改的时候还是交给它们自己（_sec）
  // 常用的几项搬到「通用」（用户：通用里没几样有用的，常用的都在后面）：从原来那一页拿走、只在通用里（不重复）；改的时候还是交给原来的分区
  var GENERAL_PULL = { appearance: ["claudeTheme", "colorScheme", "ui"], view: ["translateTasks", "translateReplies", "translateShow"] };
  // 搬到「通用」的几项在那里的说明：一句、两行以内（同 Claude Desktop 的设置：每项下面一句淡的）
  var PULL_DESC = { ui: "以终端界面（TUI）或图形界面（GUI）显示对话", colorScheme: "应用于整个窗口的配色", translateTasks: "将任务、后台任务和运行状态行翻译为所选语言", translateReplies: "将 Agent 的回复按段落翻译为所选语言；点按译文可查看原文", translateShow: "翻译时先显示原文，或在翻译完成后再显示" };
  var pulledTo = function (k, key) { return !!(GENERAL_PULL[k] && GENERAL_PULL[k].indexOf(key) >= 0); };
  function secFields(k, tw, raw) {
    var S = SECTIONS[k], os = getv("os") || "vscode", ok = function (f) { return f && (!f.os || f.os.indexOf(os) >= 0) && (typeof f.show !== "function" || f.show(tw)); }; // show：只在有意义时列（回复翻译关着时「译文出现方式」不列）
    var list = (S.fields ? S.fields(tw) : []).filter(ok);
    if (!raw && GENERAL_PULL[k]) list = list.filter(function (f) { return !pulledTo(k, f.key); });
    Object.keys(SECTIONS).forEach(function (c) {
      var C = SECTIONS[c], u = String(C.under || "").split("/"), cf = [];
      if (u[0] !== k || !u[1] || (C.show && !C.show(tw))) return;
      try { cf = (C.fields ? C.fields(tw) : []).filter(ok); } catch (e) { cf = []; }
      if (!cf.length) return;
      cf = cf.map(function (f) { return "head" in f ? { head: f.head } : Object.assign({}, f, { _sec: c }); });
      if (!("head" in cf[0])) cf.unshift({ head: "" });
      var at = -1, end = list.length;
      list.forEach(function (f, i) { if ("head" in f && f.id != null && String(f.id) === u[1]) at = i; });
      if (at < 0) return;
      for (var i = at + 1; i < list.length; i++) if ("head" in list[i] && list[i].id != null) { end = i; break; }
      list.splice.apply(list, [end, 0].concat(cf));
    });
    return list;
  }
  function secPages(S, list) {
    var pages = {}, order = [], top = [], cur = null, P0 = S.pages || {};
    list.forEach(function (f) {
      if (f.page === "advanced") return; // 标了 advanced 的项只在左边的「高级」里（不再在各区最后一行「高级… ›」）
      if (S.levels === 2) {
        // 带 id 的 { head } 开一页（连接器 › Claude Code）；不带 id 的是这一页里的小节标题
        if ("head" in f && f.id) { cur = { id: String(f.id), title: f.head, fields: [] }; pages[cur.id] = cur; order.push(cur.id); return; }
        if (f.top || !cur) top.push(f); else cur.fields.push(f);
      } else if (f.page && P0[f.page]) {
        var p = pages[f.page] || (pages[f.page] = { id: f.page, title: P0[f.page].title, nav: P0[f.page].nav, desc: P0[f.page].desc, fields: [] });
        if (order.indexOf(f.page) < 0) order.push(f.page);
        p.fields.push(f);
      } else top.push(f);
    });
    return { top: top, pages: pages, order: order };
  }
  // 去第二级的那几行：名字、现在的样子（开着没有、状态），最后一个 ›
  function navRows(S, pg) {
    return pg.order.map(function (id) {
      var p = pg.pages[id], tg = p.fields.filter(function (f) { return f.kind === "toggle"; })[0], inf = p.fields.filter(function (f) { return f.kind === "info"; })[0];
      var v = S.summary ? S.summary(p) : S.levels === 2 ? [tg ? (tg.value ? "已开启" : "已关闭") : "", inf && inf !== tg ? inf.value : ""].filter(Boolean).join(" · ") : "";
      // 连接器那种（levels: 2）：这一行右边还有它那一页的开关（开关在这里就能拨，点别处进去看）
      var sw = null; // 这一行不放开关（用户：连接器在自己的页面上开关；这里只写它在哪）
      // 点进去没有能改的（Codex：那一页只有「安装位置」，这一行右边已经写了）：不做成链接、没有 ›
      var real = p.fields.filter(function (f) { return !("head" in f) && !(f.kind === "info" && /\.st$/.test(f.key || "")); });
      if (S.levels === 2 && !real.length) return { key: "nav:" + id, kind: "info", label: p.nav || p.title, value: v, desc: p.desc };
      return { key: "nav:" + id, kind: "nav", label: p.nav || p.title, value: v, to: id, desc: p.desc, sw: sw };
    });
  }
  // 一串项 → 一张张卡片（{ head } 开一张新的，卡片上面是小节标题；head 是 "" 就是不带标题的一张）
  function cardsHtml(S, k, list, rows, q, pgId) {
    var subs = [{ title: "", html: "", n: 0, half: false }], cur = subs[0];
    list.forEach(function (f) {
      if ("head" in f) { cur = { title: f.head, html: "", n: 0, half: false, card: f.card }; subs.push(cur); return; } // card: "usage"——用量的卡片（留白大、行和行之间不画线）
      var fk = f._sec || k; // 挂进来的分区的项：它自己的名字、改的时候交给它
      cur.html += setRow(SECTIONS[fk] || S, fk, f, rows.length, q);
      if (f.key && NEW_SETS[f.key]) seenSoon([f.key]); // 新设置的蓝点：在这一页上看到过几秒就算看过
      if (f.half) cur.half = true;
      rows.push({ sec: fk, f: f, page: pgId || "" });
      cur.n++;
    });
    return subs.filter(function (u) { return u.n; }).map(function (u, i) { return '<div class="ss-sub' + (u.half ? " ss-halves" : "") + (u.card === "usage" ? " ss-ucard" : "") + '" data-sub="' + esc(k + "/" + (pgId || "") + "/" + i) + '">' + (u.title ? '<h3 class="ss-h3">' + esc(u.title) + "</h3>" : "") + '<div class="ss-card">' + u.html + "</div></div>"; }).join("");
  }
  // 跳到这一页上的一项（"appearance:fontSize"）：滚到它、它闪一下
  function settingsGo(host, to) {
    var B = host.querySelector(".ss-body"), el = /:/.test(to) && B.querySelector('.ss-row[data-k="' + CSS.escape(to) + '"]');
    if (!el) return;
    var y = el.getBoundingClientRect().top - B.getBoundingClientRect().top + B.scrollTop;
    B.scrollTop = Math.max(0, y - 12);
    el.classList.add("flash"); setTimeout(function () { el.classList.remove("flash"); }, 900);
  }
  // 左边亮现在这一区（搜索时：滚到的那一区）
  function settingsSpy(host) {
    var B = host.querySelector(".ss-body"), TOC = host.querySelector(".ss-toc");
    if (!B || !TOC) return;
    var sec = setState.sec;
    if (setState.q) {
      var bt = B.getBoundingClientRect().top; sec = "";
      B.querySelectorAll(".ss-sec").forEach(function (x) { if (x.getBoundingClientRect().top - bt <= 30) sec = x.dataset.sec; });
      if (!sec) { var f0 = B.querySelector(".ss-sec"); sec = f0 ? f0.dataset.sec : ""; }
    }
    TOC.querySelectorAll(".ss-ti").forEach(function (t) { t.classList.toggle("on", t.dataset.go === sec); });
  }
  // 去一页（分区 + 第二级，可以顺带跳到一项）；已经在这一页：回到最上面（或者跳到那一项）
  function navTo(host, P, arg, sec, page, jump) {
    if (setState.sec === sec && (setState.page || "") === (page || "") && !setState.q) { var B = host.querySelector(".ss-body"); if (jump) settingsGo(host, jump); else if (B) B.scrollTop = 0; return; }
    setState.sec = sec; setState.page = page || ""; setState.q = ""; setState.jump = jump || "";
    if (!navTo.hist) histPush();
    var qi = host.querySelector(".ss-q"); if (qi) qi.value = ""; // 从搜索结果去了一页：框里也清掉（焦点还在框里也一样）
    PAGES.settings.render(host, P, arg);
  }

  // ---- 下拉框：VS Code——点一下在它正下方展开一列（同宽），框本身不动不盖；默认那项右边写「默认」；指着的那项有说明就写在最下面。
  //      Claude App——框下面弹出一张圆角的小卡片（右边对齐），选中的那项右边一个 ✓，字体的选项用它自己的字；
  //      macOS——系统的弹出菜单（App 里是原生的 NSMenu，选中的那项打勾）。选不了的项灰着、写原因 ----
  var DD = null;
  function closeDD(back) { if (!DD) return; var d = DD; DD = null; d.el.remove(); d.btn.classList.remove("open", "up"); document.removeEventListener("pointerdown", d.out, true); if (back) d.btn.focus({ preventScroll: true }); }
  function openDD(btn, f, pick) {
    closeDD();
    btn.focus({ preventScroll: true }); // 焦点留在这个下拉框上（↑↓ 回车在列表里走；关了回到它）——不去搜索框
    var os = f.options || [], na = f.na || {}, sty = ssStyle();
    if (sty === "macos") {
      return menu(os.map(function (o) { return { label: o[1] + (na[o[0]] ? "（" + na[o[0]] + "）" : ""), checked: o[0] === f.value, radio: true, disabled: !!na[o[0]], run: function () { pick(o[0]); } }; }), { el: btn, side: "below" });
    }
    var ok = function (j) { return os[j] && !na[os[j][0]]; };
    var sel = Math.max(0, os.findIndex(function (o) { return o[0] === f.value; })), el = document.createElement("div"), pop = sty === "claude";
    el.className = "ss-ddlist" + (pop ? " ss-pop" : "");
    var paint = function () {
      var o = os[sel], dsc = !pop && o && o[2] ? o[2] : "";
      el.innerHTML = '<div class="ss-ddrows">' + os.map(function (o2, j) {
        var off = na[o2[0]];
        return '<div class="ss-ddi' + (j === sel && !off ? " on" : "") + (o2[0] === f.value ? " cur" : "") + (off ? " na" : "") + '" data-j="' + j + '"><span' + optFont(f, o2) + ">" + esc(o2[1]) + "</span>" +
          (off ? "<em>" + esc(off) + "</em>" : "<em>" + [o2[0] === f.value ? "当前" : "", !pop && f.def !== undefined && o2[0] === f.def ? "默认" : ""].filter(Boolean).join(" · ") + "</em>") + (pop ? '<i class="ss-ddk"></i>' : "") + "</div>"; // 右边淡淡写着「当前」（和「默认」）
      }).join("") + "</div>" + (dsc ? '<div class="ss-dddesc">' + esc(dsc) + "</div>" : "");
    };
    paint();
    document.body.appendChild(el);
    var r = btn.getBoundingClientRect();
    if (pop) {
      // 弹出的卡片：框下面 6px、右边和框对齐；下面放不下就放上面
      el.style.minWidth = Math.max(r.width, 180) + "px";
      var w = el.offsetWidth, below = innerHeight - r.bottom - 12, above = r.top - 12, h = el.offsetHeight;
      el.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + "px";
      if (h > below && above > below) { el.style.maxHeight = above + "px"; el.style.top = Math.max(8, r.top - 6 - Math.min(h, above)) + "px"; }
      else { el.style.maxHeight = Math.max(120, below) + "px"; el.style.top = Math.min(Math.max(8, r.bottom + 6), innerHeight - Math.min(h, Math.max(120, below)) - 8) + "px"; } // 框在窗口外（滚走了）也不跑出窗口
    } else {
      // 接在框正下方（同宽）；下面放不下、上面地方更大：接在框正上方；右边出了窗口：往左挪
      el.style.minWidth = r.width + "px";
      var w1 = el.offsetWidth, h1 = el.offsetHeight, bl = innerHeight - r.bottom - 8, ab = r.top - 8;
      el.style.left = Math.max(4, Math.min(r.left, innerWidth - w1 - 4)) + "px";
      if (h1 > bl && ab > bl) { el.classList.add("up"); btn.classList.add("up"); el.style.maxHeight = ab + "px"; el.style.top = (r.top + 1 - Math.min(h1, ab)) + "px"; }
      else { el.style.maxHeight = Math.max(60, bl) + "px"; el.style.top = (r.bottom - 1) + "px"; }
    }
    btn.classList.add("open");
    var on = el.querySelector(".ss-ddi.on"); if (on) on.scrollIntoView({ block: "nearest" });
    var out = function (e) { if (!el.contains(e.target) && e.target !== btn && !btn.contains(e.target)) closeDD(); };
    var step = function (d) { for (var j = sel + d; j >= 0 && j < os.length; j += d) if (ok(j)) { sel = j; return; } };
    DD = { el: el, btn: btn, out: out, key: function (e) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); step(e.key === "ArrowDown" ? 1 : -1); paint(); var o1 = el.querySelector(".ss-ddi.on"); if (o1) o1.scrollIntoView({ block: "nearest" }); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); var o3 = ok(sel) ? os[sel] : null; closeDD(true); if (o3) pick(o3[0]); }
      else if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); closeDD(true); }
      else if (e.key.length === 1) { var c = e.key.toLowerCase(), n0 = os.length; for (var i = 1; i <= n0; i++) { var j = (sel + i) % n0; if (ok(j) && String(os[j][1]).toLowerCase().indexOf(c) === 0) { sel = j; paint(); break; } } }
      return true;
    } };
    setTimeout(function () { document.addEventListener("pointerdown", out, true); }, 0);
    el.addEventListener("mousemove", function (e) { var it = e.target.closest(".ss-ddi"); if (it && +it.dataset.j !== sel && ok(+it.dataset.j)) { sel = +it.dataset.j; paint(); } });
    el.addEventListener("mousedown", function (e) { e.preventDefault(); var it = e.target.closest(".ss-ddi"); if (!it || !ok(+it.dataset.j)) return; var o4 = os[+it.dataset.j]; closeDD(true); if (o4) pick(o4[0]); });
  }
  function bindSettings(host, P, arg) {
    var rowOf = function (el) { var r = el && el.closest(".ss-row"); return r ? host.rows[+r.dataset.row] : null; };
    var pick = function (rw) { if (!rw) return; setState.sel = rw.dataset.k; host.querySelectorAll(".ss-row.on").forEach(function (x) { if (x !== rw) x.classList.remove("on"); }); rw.classList.add("on"); };
    var change = function (r, v, key) { Promise.resolve(SECTIONS[r.sec].change(key || r.f.key, v, P.win)).then(function () { PAGES.settings.render(host, P, arg); allWins().forEach(renderSoon); }); };
    // 视图预设的卡片上右键：自己存的——重命名、删除；「自定义」——删除（下次改了设置又会自动存一份）；内置的没有菜单
    host.addEventListener("contextmenu", function (e) {
      var card = e.target.closest(".ss-pcard");
      if (!card) return;
      var r = rowOf(card), o = r && (r.f.options || [])[+card.dataset.j], TT = window.TSU_TERM && TSU_TERM.presets;
      if (!o || !TT || (o[3] !== "user" && o[3] !== "custom")) return;
      e.preventDefault();
      var refresh = function () { document.dispatchEvent(new Event("st-settings-changed")); };
      var del = function () { TT.save(TT.user().filter(function (x) { return x.id !== o[0]; })); refresh(); };
      menu(o[3] === "custom" ? [{ label: "删除「自定义」", icon: MI.close, run: del }] : [
        { label: "重命名…", icon: MI.rename || MI.edit, run: function () { ask({ title: "重命名预设", value: o[1] }).then(function (nm) { nm = String(nm || "").trim(); if (!nm) return; TT.save(TT.user().map(function (x) { return x.id === o[0] ? Object.assign({}, x, { name: nm }) : x; })); refresh(); }); } },
        { label: "删除", icon: MI.close, run: del },
      ], { x: e.clientX, y: e.clientY });
    });
    // 左边那一列：按下就选中、下一帧换页（同访达、系统设置的侧栏）——不等松开（click）才动，点了马上有反应
    host.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      var g0 = e.target.closest(".ss-toc [data-go]");
      if (!g0) return;
      host.querySelectorAll(".ss-toc [data-go].on, .ss-toc .ss-ti.on").forEach(function (x) { x.classList.remove("on"); });
      g0.classList.add("on");
      host._navDown = g0.dataset.go;
      requestAnimationFrame(function () { navTo(host, P, arg, g0.dataset.go, ""); });
    });
    host.addEventListener("click", function (e) {
      var hb = e.target.closest("[data-hnav]");
      if (hb) { // ‹ ›：历史里退一页 / 进一页
        var ni = setHist.i + (+hb.dataset.hnav);
        if (hb.disabled || ni < 0 || ni >= setHist.list.length) return;
        setHist.i = ni;
        var hk = setHist.list[ni].split("/");
        navTo.hist = true; try { navTo(host, P, arg, hk[0], hk[1] || ""); } finally { navTo.hist = false; }
        return;
      }
      if (e.target.closest("[data-up]")) return navTo(host, P, arg, setState.sec, ""); // 第二级顶上「分区 › 这一页」的分区：回第一级
      var go = e.target.closest(".ss-toc [data-go]");
      if (go && host._navDown === go.dataset.go) { host._navDown = null; return; } // 按下时已经换过了
      if (go) return navTo(host, P, arg, go.dataset.go, ""); // 左边的分区：去那一区的第一级（搜索时也是：清掉搜索）；已经在那儿：回到最上面
      var nr = e.target.closest(".ss-row.ss-k-nav");
      if (nr && !e.target.closest(".ss-check")) { var rn = rowOf(nr); if (rn) navTo(host, P, arg, rn.sec, nr.dataset.to); return; } // 去第二级（点这一行上的开关只是拨开关）
      // 搜索结果：点一项的名字（不是它的控件）——去它那一页，它闪一下
      var fr = setState.q && !e.target.closest(".ss-ctl, input, button, label, .ss-code") && e.target.closest(".ss-row");
      if (fr) { var rr = rowOf(fr); if (rr) navTo(host, P, arg, rr.sec, rr.page, fr.dataset.k); return; }
      var link = e.target.closest("[data-sact]");
      if (link) { var sc = link.closest(".ss-sec"), r6 = rowOf(link), S2 = SECTIONS[(r6 && r6.sec) || (sc && sc.dataset.sec)]; if (S2 && S2.action) S2.action(link.dataset.sact, P.win); return; } // 按钮交给这一行所属的分区（挂进来的分区是它自己）
      var opt = e.target.closest(".ss-opt, .ss-sw");
      if (opt) { var r9 = rowOf(opt), o9 = r9 && (r9.f.options || [])[+opt.dataset.j]; if (o9 && o9[0] !== r9.f.value && !(r9.f.na || {})[o9[0]]) change(r9, o9[0]); return; }
      var stop = e.target.closest(".ss-stops [data-j]");
      if (stop) { var r0 = rowOf(stop), o0 = r0 && (r0.f.options || [])[+stop.dataset.j]; if (o0) change(r0, o0[0]); return; }
      var avb = e.target.closest(".ss-avbtn");
      if (avb) { var ra = rowOf(avb); if (ra) change(ra, avatarNext()); return; }
      var dd = e.target.closest(".ss-dd");
      if (dd) { var r1 = rowOf(dd); pick(dd.closest(".ss-row")); if (DD && DD.btn === dd) return closeDD(true); if (r1) openDD(dd, r1.f, function (v) { if (v !== r1.f.value) change(r1, v); }); return; }
      var sb = e.target.closest(".ss-sugbtn");
      if (sb) { var r2 = rowOf(sb); if (r2 && r2.f.suggest) Promise.resolve(r2.f.suggest()).then(function (list) { var fake = { options: (list || []).map(function (x) { return [x, x]; }), value: r2.f.value, def: r2.f.def, fontOf: r2.f.fontOf }; openDD(sb.previousElementSibling || sb, fake, function (v) { change(r2, v); }); }); return; }
      var rw = e.target.closest(".ss-row");
      if (rw) { pick(rw); if (!e.target.closest("input, button, label")) rw.focus({ preventScroll: true }); }
    });
    host.addEventListener("change", function (e) {
      var el = e.target, r = rowOf(el), os = r && (r.f.options || []);
      if (!r) return;
      if (el.classList.contains("ss-check")) { var v0 = el.checked, tk = el.dataset.tk; return setTimeout(function () { change(r, v0, tk); }, 180); } // 开关：先让钮滑过去，再用上、重画（去第二级那行上的开关：data-tk 是它那一页的开关）
      if (el.classList.contains("ss-range")) { var o = os[+el.value]; if (o) change(r, o[0]); return; }
      if (el.classList.contains("ss-num")) { var n = parseFloat(el.value); if (!isFinite(n)) { el.value = r.f.value; return; } if (r.f.min != null) n = Math.max(r.f.min, n); if (r.f.max != null) n = Math.min(r.f.max, n); return change(r, n); }
      if (el.classList.contains("ss-input")) return change(r, el.value);
    });
    host.addEventListener("input", function (e) {
      var el = e.target;
      if (el.classList.contains("ss-q")) { searchSet(el.value); return; }
      // 全名、称呼：边打边换头像的首字母（设置页里的、左下角 / 活动栏的账户按钮）；离开输入框或回车才存
      var rI = el.classList.contains("ss-input") && rowOf(el);
      if (rI && rI.sec === "account" && (rI.f.key === "fullName" || rI.f.key === "callMe")) {
        AV_LIVE[rI.f.key] = el.value;
        host.querySelectorAll(".ss-avbtn > .st-av").forEach(function (a) { a.outerHTML = avatarHtml(40); });
        allWins().forEach(function (w) { if (w.stGlob) syncAct(w); });
        document.dispatchEvent(new Event("st-avatar")); // 别处画了头像的（Claude App 左下角）：听这个重画
        return;
      }
      if (el.classList.contains("ss-range")) { // 拖着：刻度跟着亮，放手才定
        var os = ((rowOf(el) || {}).f || {}).options || [], j = +el.value;
        el.style.setProperty("--p", (os.length > 1 ? j / (os.length - 1) * 100 : 0) + "%");
        el.parentNode.querySelectorAll(".ss-stops span").forEach(function (sp, k) { sp.classList.toggle("on", k === j); });
      }
    });
    // 搜索：结果换掉右边；清掉以后回到原来那一页
    var searchSet = function (v) {
      setState.q = v;
      PAGES.settings.render(host, P, arg);
    };
    host.addEventListener("focusin", function (e) { var rw = e.target.closest && e.target.closest(".ss-row"); if (rw) pick(rw); });
    // 键盘：搜索框里 ↓ 到第一项；一项上 ↑↓ 换、空格 / 回车用它的控件（勾选框直接勾、下拉框展开）；控件里 Esc 回到这一项。
    // 焦点只有两种办法进搜索框：点它、⌘F（打字、↑ 到头、重画都不会把焦点送过去）
    host.addEventListener("keydown", function (e) {
      if (DD && DD.key(e)) { e.stopPropagation(); return; }
      if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === "f" || e.key === "F")) { e.preventDefault(); e.stopPropagation(); var qf = host.querySelector(".ss-q"); if (qf) { qf.focus(); qf.select(); } return; } // ⌘F：搜索设置
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      var el = e.target, inQ = el.classList.contains("ss-q"), rw = el.classList.contains("ss-row") ? el : null;
      var all = Array.prototype.slice.call(host.querySelectorAll(".ss-row")), at = rw ? all.indexOf(rw) : -1;
      var go = function (i) { var t = all[Math.max(0, Math.min(all.length - 1, i))]; if (t) { t.focus({ preventScroll: true }); t.scrollIntoView({ block: "nearest" }); pick(t); } };
      // Esc：搜索框里有字——清掉；输入框里——回到这一行；第二级——回第一级；第一级不管（浮着的表单、Claude App 的设置：关掉）
      var up = function () { if (!setState.page || setState.q) return false; e.preventDefault(); e.stopPropagation(); navTo(host, P, arg, setState.sec, ""); return true; };
      if (inQ) {
        if (e.key === "ArrowDown") { e.preventDefault(); go(0); }
        else if (e.key === "Escape" && el.value) { e.preventDefault(); el.value = ""; searchSet(""); }
        else if (e.key === "Escape") up();
        return;
      }
      if (e.key === "Escape") {
        if (el.matches && el.matches("input:not(.ss-check), textarea") && el.closest(".ss-row")) { e.preventDefault(); el.closest(".ss-row").focus(); return; }
        up(); return;
      }
      if (el.classList.contains("ss-dd") && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) { e.preventDefault(); el.click(); return; }
      if (el.classList.contains("ss-check") && e.key === "Enter") { e.preventDefault(); if (!el.disabled) { el.checked = !el.checked; el.dispatchEvent(new Event("change", { bubbles: true })); } return; } // 开关：空格（系统的）、回车都拨
      if (rw) {
        if (e.key === "ArrowDown") { e.preventDefault(); go(at + 1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); go(at - 1); }
        else if (rw.classList.contains("ss-k-nav") && (e.key === "Enter" || !rw.querySelector(".ss-check"))) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); var rn2 = rowOf(rw); if (rn2) navTo(host, P, arg, rn2.sec, rw.dataset.to); } } // 去第二级的一行：回车进去（空格拨它的开关）
        else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          var c = rw.querySelector("input, button");
          if (c && c.type === "checkbox") { if (!c.disabled) { c.checked = !c.checked; c.dispatchEvent(new Event("change", { bubbles: true })); } } else if (c && c.classList.contains("ss-dd")) c.click(); else if (c) c.focus();
        }
        return;
      }
    });
    window.addEventListener("resize", function () { closeDD(); });
  }
  document.addEventListener("st-settings-changed", function () { redrawSettings(); });
  function settings(tw, sec) {
    tw = tw || (T() && T().front());
    if (!tw) return;
    sec = sec || "general"; // 没说去哪：通用（不接着上次的）
    if (sec) {
      var sk = String(sec).split(/[:/]/)[0], fk = /:/.test(sec) ? String(sec).slice(String(sec).indexOf(":") + 1) : "", page = !fk && /\//.test(sec) ? String(sec).split("/")[1] || "" : "";
      // 跳到一项（"appearance:tabBar"）：那一项搬到别的分区了也找得到
      var owns = function (k) { try { return (SECTIONS[k].fields ? SECTIONS[k].fields(tw) : []).some(function (f) { return f && f.key === fk; }); } catch (e) { return false; } };
      if (fk && (!SECTIONS[sk] || !owns(sk))) { var hit = Object.keys(SECTIONS).filter(owns)[0]; if (hit) sk = hit; }
      var pullSec = fk && pulledTo(sk, fk) ? sk : fk && sk === "general" ? Object.keys(GENERAL_PULL).filter(function (k) { return pulledTo(k, fk); })[0] || null : null; // 搬到「通用」的那几项
      var jump = fk ? sk + ":" + fk : "", U = String((SECTIONS[sk] && SECTIONS[sk].under) || "").split("/");
      if (pullSec) { jump = pullSec + ":" + fk; sk = "general"; page = ""; U = [""]; } // 在「通用」里，那一行的 data-k 还是「原来的分区:项」
      var adv = fk && SECTIONS[sk] && (function () { try { return secFields(sk, tw).some(function (f) { return f && f.key === fk && f.page === "advanced"; }); } catch (e) { return false; } })();
      if (adv) { sk = "advanced"; page = ""; } // 那一项在「高级」里（jump 还是「原来的分区:项」——那一行的 data-k 是它）
      else if (U[1]) { sk = U[0]; page = U[1]; } // Paimon Code、Claude Code：在「连接器」下面它那一页
      else if (fk && SECTIONS[sk]) { var pg = secPages(SECTIONS[sk], secFields(sk, tw)); pg.order.forEach(function (id) { if (pg.pages[id].fields.some(function (f) { return f.key === fk && !f._sec; })) page = id; }); } // 那一项在第二级：直接进那一页
      setState.sec = sk; setState.page = page; setState.q = ""; setState.jump = jump;
    }
    var p = showPage(tw, "settings", null);
    if (p && p.program && p.program.redraw) p.program.redraw();
  }
  // 已经放进编辑区的那一页：切过去；不然浮在编辑区正中
  function showPage(tw, kind, arg) {
    var hit = null;
    if (root.classList.contains("st-os-claude") && kind === "keys") return null; // Claude App：沉浸式的图形界面，不讲快捷键（键照样能用，只是不给这一页）
    if (kind === "keys") { var kq = keysQ; keysQ = ""; settings(tw, "keys" + (kq ? ":" + kq : "")); return null; } // 键盘快捷方式在设置里（左边一项），不再单开一页
    if (root.classList.contains("st-os-claude") && kind === "settings") return floatPage(tw, kind, arg); // Claude App：设置是盖在整个窗口上的表单（同 Claude App）
    if (root.classList.contains("st-macos")) { tw.ws.all().forEach(function (p) { var pr = p.program; if (!hit && pr && pr.page === kind && (pr.arg || null) === (arg || null)) hit = p; }); if (hit) { tw.ws.show(hit); return hit; } return openPage(tw, kind, arg); } // macOS：每一页是一个窗口（不浮在编辑区里）
    tw.ws.all().forEach(function (p) { var pr = p.program; if (!hit && pr && pr.page === kind && (pr.arg || null) === (arg || null)) hit = p; });
    if (hit) { if (tw.ws.show) tw.ws.show(hit); else openPage(tw, kind, arg); return hit; }
    return floatPage(tw, kind, arg);
  }
  // ======== 浮动窗口（同 VS Code）：浮在编辑区正中；右上角：这一页自己的图标（JSON 等）· 放进编辑区 · 放大 · 关闭；Esc 关 ========
  // ======== 模态层：一层盖住整个窗口的底（接住所有的指针事件），窗口放在它里面；底下的整个 App（body 下面别的孩子）标成 inert——
  //   点不到、指不到、滚不动、Tab 也到不了，焦点只在窗口里转；关掉时把标过的 inert 原样拿掉、焦点还回去。
  //   从窗口里弹出来的菜单、下拉列表、命令面板、对话框加在 body 最后，在这一层上面（z-index 更高），不是 inert。
  //   页面上的原生网页（内嵌浏览器）被它盖住就藏起来（webview.js 的 OVER 里有 .st-modal）----
  var MODALS = [], MODAL_TOP = ".st-menu, .ss-ddlist, .st-palette, .st-pop, .ca-dlgdim, .st-modal";
  var focusables = function (el) { return Array.prototype.slice.call(el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(function (x) { return !x.disabled && x.offsetParent; }); };
  function modalOpen(win, o) {
    o = o || {};
    var layer = document.createElement("div");
    layer.className = "st-modal" + (o.cls ? " " + o.cls : "");
    document.body.appendChild(layer);
    layer.appendChild(win);
    if (!win.getAttribute("role")) win.setAttribute("role", "dialog");
    win.setAttribute("aria-modal", "true");
    var M = { layer: layer, win: win, o: o, marked: [], back: document.activeElement };
    // 底下别的模态层（设置上面又开了对话框）也标 inert：只有最上面这一层能用；菜单、下拉列表这些弹出来的不标
    if (!o.noInert) Array.prototype.forEach.call(document.body.children, function (el) { if (el === layer || el.inert || (el.matches(MODAL_TOP) && !el.classList.contains("st-modal")) || el.tagName === "SCRIPT" || el.tagName === "STYLE") return; el.inert = true; M.marked.push(el); });
    layer.addEventListener("pointerdown", function (e) { if (e.target === layer) { e.preventDefault(); if (o.onBackdrop) o.onBackdrop(e); } }); // 点在底上（窗口外面）：只到这一层
    layer.addEventListener("keydown", function (e) { // Tab 只在窗口里转
      if (e.key !== "Tab" || MODALS[MODALS.length - 1] !== M) return;
      var fs = focusables(win); if (!fs.length) { e.preventDefault(); return; }
      var i = fs.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); fs[fs.length - 1].focus(); } else if (!e.shiftKey && i === fs.length - 1) { e.preventDefault(); fs[0].focus(); }
    });
    MODALS.push(M);
    return M;
  }
  function modalClose(M) {
    var i = MODALS.indexOf(M);
    if (i < 0) return;
    MODALS.splice(i, 1);
    M.marked.forEach(function (el) { el.inert = false; });
    M.layer.remove();
    if (M.back && M.back.isConnected && !M.back.closest("[inert]")) try { M.back.focus({ preventScroll: true }); } catch (e) { /* 焦点回不去就算了 */ }
    if (M.o.onClose) M.o.onClose();
  }
  // 焦点跑到了模态层外面（也不在它上面弹出来的东西里）：拉回窗口里
  document.addEventListener("focusin", function (e) {
    var M = MODALS[MODALS.length - 1];
    if (!M || M.layer.contains(e.target) || (e.target.closest && e.target.closest(MODAL_TOP))) return;
    var f0 = focusables(M.win)[0] || M.win; if (f0 === M.win && !M.win.hasAttribute("tabindex")) M.win.setAttribute("tabindex", "-1");
    f0.focus({ preventScroll: true });
  }, true);
  function floatPage(tw, kind, arg) {
    var S = parts(tw), f = document.querySelector(".st-modal > .st-float");
    if (f && f.pane && f.pane.program && f.pane.program.page === kind) { f.pane.program.redraw(); f.pane.focus(); return f.pane; }
    if (f) closeFloat(f);
    var p = tw.ws.newPane({ page: kind, arg: arg });
    f = document.createElement("div");
    f.className = "st-float";
    f.dataset.page = kind; // 设置：窄一点（floatLayout）
    f.innerHTML = '<div class="st-fbar"><span class="st-ftitle"></span><span class="st-fill"></span><span class="st-facts"></span></div><div class="st-fbox"></div>';
    // 放进模态层（盖住整个窗口；Claude App 的那一层是毛玻璃：变暗、变模糊）；点底（窗口外面）关掉
    f.modal = modalOpen(f, { cls: "st-modal-float", onBackdrop: function () { closeFloat(f); } });
    f.pane = p;
    f.off = { x: 0, y: 0 };
    floatLayout(f);
    floatDrag(f);
    f.querySelector(".st-fbox").appendChild(p.el);
    var bar = function () {
      if (!f.pane) return;
      var pr = f.pane.program, extra = pr && pr.tabActions ? pr.tabActions() : [];
      f.querySelector(".st-ftitle").textContent = f.pane.title();
      var h = extra.map(function (x, i) { return '<button data-x="' + i + '" title="' + esc(x.title) + '">' + x.icon + "</button>"; }).join("") + (extra.length ? '<i class="st-fsep"></i>' : "") +
        '<button data-f="dock" title="移到编辑区">' + ICO.dock + '</button><button data-f="max" title="' + (f.classList.contains("max") ? "还原" : "放大") + '">' + (f.classList.contains("max") ? ICO.restore : ICO.max) + '</button><button data-f="close" title="关闭 (Esc)">' + ICO.close + "</button>";
      var box = f.querySelector(".st-facts");
      if (box.dataset.h !== h) { box.dataset.h = h; box.innerHTML = h; }
      f.extra = extra;
    };
    f.querySelector(".st-facts").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.x) { var x = f.extra[+b.dataset.x]; if (x) x.run(); return bar(); }
      if (b.dataset.f === "dock") return dockFloat(tw, f);
      if (b.dataset.f === "max") { f.classList.toggle("max"); floatLayout(f); return bar(); }
      if (b.dataset.f === "close") return closeFloat(f);
    });
    f.addEventListener("keydown", function (e) { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); closeFloat(f); } });
    f.timer = setInterval(bar, 500);
    bar();
    p.program.render();
    p.focus();
    return p;
  }
  // 浮动窗口的大小、位置：VS Code 是窗口的 88%，Claude App 的表单宽 78%、高 94%（同 Claude App）；最大 1200×860，最小 520×420，窗口更小就四边各留 8px。
  //   设置最宽 960（Claude App 1000）：左边分区 + 680 的一栏内容正好，再宽只是名字和控件之间空一大截（同系统设置、Claude 的设置那样紧凑）
  // 开在窗口正中；拖过的话照拖过的地方，但不出窗口。放大：四边各留 6px
  function floatLayout(f) {
    var vw = innerWidth, vh = innerHeight, st = f.style, ca = root.classList.contains("st-os-claude"), capW = f.dataset.page === "settings" ? (ca ? 1000 : 960) : 1200;
    if (f.classList.contains("max")) { st.left = st.top = "6px"; st.width = (vw - 12) + "px"; st.height = (vh - 12) + "px"; return; }
    var w = Math.min(vw - 16, Math.max(520, Math.min(capW, Math.round(vw * (ca ? 0.78 : 0.88))))), h = Math.min(vh - 16, Math.max(420, Math.min(860, Math.round(vh * (ca ? 0.94 : 0.88)))));
    var x = Math.round(Math.max(8, Math.min(vw - w - 8, (vw - w) / 2 + f.off.x))), y = Math.round(Math.max(8, Math.min(vh - h - 8, (vh - h) / 2 + f.off.y)));
    f.off = { x: x - (vw - w) / 2, y: y - (vh - h) / 2 };
    st.left = x + "px"; st.top = y + "px"; st.width = w + "px"; st.height = h + "px";
  }
  // 拖顶上那一条挪它（标题栏；设置页的搜索框那一格、页名那一排）：按钮、输入框、‹ ›、能点的页名不算；动了 4px 才算拖（没动就是普通的点）；双击回到正中
  var FLOAT_GRIP = ".st-fbar, .ss-top, .ss-head", FLOAT_NOGRIP = "button, input, select, textarea, a, [data-up], .st-facts";
  function floatDrag(f) {
    f.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || f.classList.contains("max") || !e.target.closest || !e.target.closest(FLOAT_GRIP) || e.target.closest(FLOAT_NOGRIP)) return;
      var x0 = e.clientX, y0 = e.clientY, o0 = f.off, moved = false;
      var mv = function (ev) {
        var dx = ev.clientX - x0, dy = ev.clientY - y0;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
        if (!moved) { moved = true; f.classList.add("st-fdrag"); closeDD(); }
        f.off = { x: o0.x + dx, y: o0.y + dy }; floatLayout(f);
      };
      var up = function () {
        document.removeEventListener("pointermove", mv, true); document.removeEventListener("pointerup", up, true); document.removeEventListener("pointercancel", up, true);
        if (!moved) return;
        f.classList.remove("st-fdrag");
        var kill = function (ev) { ev.stopPropagation(); ev.preventDefault(); }; // 拖完松手不算点了一下（不去点到页名、分区）
        f.addEventListener("click", kill, true); setTimeout(function () { f.removeEventListener("click", kill, true); }, 0);
      };
      document.addEventListener("pointermove", mv, true); document.addEventListener("pointerup", up, true); document.addEventListener("pointercancel", up, true);
    });
    f.addEventListener("dblclick", function (e) {
      if (f.classList.contains("max") || !e.target.closest(FLOAT_GRIP) || e.target.closest(FLOAT_NOGRIP)) return;
      f.off = { x: 0, y: 0 }; floatLayout(f);
    });
  }
  window.addEventListener("resize", function () { document.querySelectorAll(".st-float").forEach(function (f) { if (f.off) floatLayout(f); }); });
  function closeFloat(f) { clearInterval(f.timer); if (f.pane) f.pane.close(); f.pane = null; f.remove(); if (f.modal) modalClose(f.modal); }
  function dockFloat(tw, f) {
    var p = f.pane;
    clearInterval(f.timer);
    f.pane = null;
    f.remove();
    if (f.modal) modalClose(f.modal);
    if (tw.ws.adopt) tw.ws.adopt(p); else p.close();
  }

  // ---- 文件：默认只看（Markdown 排好、代码高亮、图片、PDF；别处改了跟着刷新），「编辑」才改，⌘S 存 ----
  var FILES = {}; // 路径 → { text, saved, kind, url, mtime, size, mode, dirty }
  var IMG = { png: 1, jpg: 1, jpeg: 1, gif: 1, webp: 1, bmp: 1, ico: 1, svg: 1, heic: 1, tiff: 1, tif: 1 }, MIME = { svg: "image/svg+xml", pdf: "application/pdf", jpg: "image/jpeg" };
  // Office 这些：用 macOS 的「快速查看」生成预览（同访达里按空格看到的），放进原生的网页视图里看；要改就用默认 App 打开
  var OFFICE = { docx: 1, doc: 1, dotx: 1, xlsx: 1, xlsm: 1, xls: 1, pptx: 1, ppt: 1, pages: 1, numbers: 1, key: 1, rtf: 1, rtfd: 1, odt: 1, ods: 1, odp: 1 };
  var extOf = function (p) { var n = String(p).split("/").pop(), i = n.lastIndexOf("."); return i > 0 ? n.slice(i + 1).toLowerCase() : ""; };
  PAGES.file = {
    tabActions: function (host, P, path, V) {
      var f = FILES[path] || {}, name = String(path).split("/").pop(), out = [], again = function () { V.redraw(); P.win.syncTitles(); };
      if (f.kind === "text") {
        if (f.mode === "edit") {
          if (f.dirty) out.push({ icon: ICO.save, title: "保存 (⌘S)", run: function () { saveFile(path, again); } }); // 改了才有「保存」（没改动时不出来）
          out.push({ icon: ICO.done, title: "完成", run: function () { leaveEdit(path, again); } }); // 改了没存：问保存 / 不保存 / 取消
        } else out.push({ icon: ICO.edit, title: "编辑", run: function () { f.mode = "edit"; again(); } });
      }
      if (LOC() && (f.kind === "office" || f.kind === "pdf")) out.push({ icon: ICO.open, title: "用默认应用打开", run: function () { LOC().exec({ cmd: "open " + T().shellEscape(path) }).catch(function () {}); } }); // 要改就在 Word / Pages / 预览 里改
      if (LOC()) out.push({ icon: ICO.reveal, title: "在访达中显示", run: function () { LOC().exec({ cmd: "open -R " + T().shellEscape(path) }).catch(function () {}); } });
      return out;
    },
    title: function (path) { var f = FILES[path]; return (f && f.dirty ? "● " : "") + String(path).split("/").pop(); },
    address: function (path) { return tilde(path); },
    render: function (host, P, path, V) {
      var f = FILES[path] || (FILES[path] = { kind: "", mode: "view", dirty: false });
      if (!f.loaded) { f.loaded = true; loadFile(path, function () { V.redraw(); P.win.syncTitles(); }); }
      var name = String(path).split("/").pop();
      // 文本：只看、编辑是同一个编辑器（只看 = 只读），切换不重建；只有不太大的 Markdown 只看时排好版（TTU）
      var rich = f.kind === "text" && f.mode !== "edit" && /^(md|markdown|mdx)$/.test(extOf(path)) && (f.text || "").length < 150000;
      var mk = f.kind + (f.kind === "text" ? (rich ? ":rich" : ":code") : "");
      // 名字、路径已经在标签和面包屑上了：这一行只放操作
      var head = '<div class="st-fhead" hidden></div>'; // 操作在所在那组标签条的右上角（tabActions）
      if (host.dataset.mode !== mk || !host.querySelector(".st-fbody")) {
        host.innerHTML = head + '<div class="st-fbody"></div>';
        host.dataset.mode = mk;
        if (!host.bound) {
          host.bound = true;
          var body0 = function () { return host.querySelector(".st-fbody") || {}; };
          host.addEventListener("click", function (e) {
            var a = e.target.closest("[data-fa]");
            if (!a) return;
            var ff = FILES[path];
            if (a.dataset.fa === "edit") { ff.mode = "edit"; V.redraw(); }
            if (a.dataset.fa === "view") leaveEdit(path, function () { V.redraw(); P.win.syncTitles(); });
            if (a.dataset.fa === "save") saveFile(path, function () { V.redraw(); P.win.syncTitles(); });
            if (a.dataset.fa === "reveal" && LOC()) LOC().exec({ cmd: "open -R " + T().shellEscape(path) }).catch(function () {});
            if (a.dataset.fa === "retry") { ff.kind = ""; ff.loaded = false; ff.native = false; if (body0().nv) body0().nv.key = ""; V.redraw(); }
            if (a.dataset.fa === "open" && LOC()) LOC().exec({ cmd: "open " + T().shellEscape(path) }).catch(function () {});
          });
        }
      } else host.querySelector(".st-fhead").outerHTML = head;
      var body = host.querySelector(".st-fbody");
      if (f.kind === "") { body.innerHTML = '<div class="st-dim st-pad st-fload">读取中…</div>'; return; } // 读得快的根本看不到这一行（CSS 里过 0.35 秒才淡出来）
      if (f.kind === "missing") { body.innerHTML = '<div class="st-dim st-pad">文件不存在：' + esc(tilde(path)) + "</div>"; return; }
      if (f.kind === "error") { body.innerHTML = '<div class="st-red st-pad">无法读取：' + esc(f.error) + '　<span class="st-k" data-fa="retry">重试</span></div>'; return; }
      if (f.kind === "big" || f.kind === "binary") { body.innerHTML = '<div class="st-dim st-pad">' + (f.kind === "big" ? "文件太大（" + kfmt(f.size) + "B），无法预览" : "二进制文件，无法预览") + '　<span class="st-k" data-fa="reveal">在访达中显示</span></div>'; return; }
      if (f.native) return nativeFile(body, path, f, V);
      if (f.kind === "image") { body.innerHTML = '<div class="st-img"><img src="' + f.url + '" alt=""></div>'; return; }
      if (f.kind === "pdf") { body.innerHTML = '<iframe class="st-pdf" src="' + f.url + '"></iframe>'; return; }
      if (!rich) return editor(body, path, function () { P.win.syncTitles(); }, f.mode !== "edit"); // 改没改变了：标签上的 ●、「保存」按钮跟着（不重画编辑器）
      var cw = cellW(body), cols = Math.max(24, Math.floor((body.clientWidth - 30) / cw)), light = P.win.el.classList.contains("tl"), top = body.scrollTop, html;
      if (body.dataset.sig === f.mtime + ":" + cols + ":" + light) return;
      body.dataset.sig = f.mtime + ":" + cols + ":" + light;
      try { html = window.TTU ? hlHtml(TTU.renderFile(name, f.text, { width: cols, theme: light ? "light" : "dark" }).html) : esc(f.text); } catch (e) { html = esc(f.text); }
      body.innerHTML = '<pre class="terminal-style-ui st-doc' + (light ? " ttu-light" : "") + '">' + (html || '<span class="st-dim">（空文件）</span>') + "</pre>";
      lineWheel(body, function () { var pre = body.querySelector(".st-doc"); return pre ? parseFloat(getComputedStyle(pre).lineHeight) || 0 : 0; }, function () { var pre = body.querySelector(".st-doc"); return pre ? pre.offsetTop + (parseFloat(getComputedStyle(pre).paddingTop) || 0) : 0; });
      body.scrollTop = top;
      if (f.line && !f.scrolled) { f.scrolled = true; body.scrollTop = Math.max(0, (f.line - 4) * 17); }
      if (!body.ro) { body.ro = new ResizeObserver(function () { if (FILES[path] && FILES[path].mode === "view") V.redraw(); }); body.ro.observe(body); }
    },
    focus: function (host) { var b = host.querySelector(".st-fbody"), ed = b && b.ed; if (ed && ed.api) ed.api.focus(); else host.focus(); },
  };
  function cellW(el) { var pr = document.createElement("span"); pr.textContent = "0".repeat(100); pr.style.cssText = "position:absolute;visibility:hidden;white-space:pre;font:12px Monaco, monospace"; el.appendChild(pr); var w = pr.offsetWidth / 100 || 7.2; pr.remove(); return w; }
  // 读进来：20 秒还没读完就说一声（不一直「读取中…」），能点「重试」；读完了又来的结果不要（已经超时了）
  function loadFile(path, done) {
    var f = FILES[path], over = false, t0 = Date.now();
    var fin = function () { if (over) return; over = true; clearTimeout(tm); f.loadMs = Date.now() - t0; done(); };
    var tm = setTimeout(function () { if (over) return; f.kind = "error"; f.error = "读取超时（20 秒没有读完）"; f.loaded = false; fin(); }, 20000);
    LOC().stat(path).then(function (st) {
      if (over) return;
      if (!st) { f.kind = "missing"; return fin(); }
      if (st.type === "dir") { f.kind = "missing"; return fin(); }
      f.mtime = st.mtime; f.size = st.size;
      var ext = extOf(path), nat = !!(window.TSU_WEB && TSU_WEB.native && TSU_WEB.native());
      // App 里：PDF（多大都行）、Office 文稿、很大的图片不读进页面——原生的网页视图直接读文件（见 nativeFile）
      if (nat && ext === "pdf") { f.kind = "pdf"; f.native = true; return fin(); }
      if (nat && OFFICE[ext]) { f.kind = "office"; f.native = true; return fin(); }
      if (nat && IMG[ext] && st.size > 8 * 1024 * 1024) { f.kind = "image"; f.native = true; return fin(); }
      if (st.size > 30 * 1024 * 1024 && !IMG[ext] && ext !== "pdf") { f.kind = "big"; return fin(); }
      return LOC().read(path).then(function (buf) {
        if (over) return;
        var u8 = new Uint8Array(buf);
        if (IMG[ext] || ext === "pdf") { if (f.url) URL.revokeObjectURL(f.url); f.url = URL.createObjectURL(new Blob([u8], { type: MIME[ext] || (ext === "pdf" ? "application/pdf" : "image/" + ext) })); f.kind = ext === "pdf" ? "pdf" : "image"; return fin(); }
        for (var i = 0; i < Math.min(8000, u8.length); i++) if (u8[i] === 0) { f.kind = "binary"; return fin(); }
        f.text = new TextDecoder("utf-8").decode(u8);
        if (!f.dirty) f.saved = f.text;
        f.kind = "text";
        fin();
      });
    }).catch(function (e) { if (over) return; f.kind = "error"; f.error = e.message; f.loaded = false; fin(); });
  }
  // PDF、Office、很大的图片：原生的网页视图直接读文件（file://；WebKit 自己的 PDF 显示，几百 MB 也只画看得见的那几页），叠在这一块上；
  //   Office 先用「快速查看」（qlmanage）生成一份预览（HTML + 附件）放在缓存里，同一个文件没改过就不再生成。标签页关了原生那块跟着关（webview.js）
  function fileUrl(p) { return "file://" + String(p).split("/").map(encodeURIComponent).join("/"); }
  function nativeFile(body, path, f, V) {
    var key = f.kind + ":" + f.mtime + ":" + f.size, nv = body.nv;
    if (nv && nv.key === key && nv.box.parentNode === body) { if (nv.h) nv.h.place(); return; }
    if (nv) { if (nv.h) nv.h.close(); if (nv.stop) nv.stop(); }
    body.innerHTML = '<div class="st-nv"><div class="st-nvmsg st-dim st-pad"></div></div>';
    var box = body.firstChild, msg = box.firstChild, NV = { key: key, box: box, h: null, stop: null };
    body.nv = NV;
    var shown = function () { return body.nv === NV && box.isConnected && V.shown(); };
    var show = function (url) {
      if (body.nv !== NV || !box.isConnected) return;
      NV.h = window.TSU_WEB && TSU_WEB.overlay ? TSU_WEB.overlay(box, url, shown) : null;
      if (NV.h) msg.hidden = true; else msg.textContent = "这里没法预览这种文件";
    };
    if (f.kind !== "office") return show(fileUrl(path));
    var t0 = Date.now(), tick = setInterval(function () { if (body.nv !== NV || !box.isConnected) return clearInterval(tick); msg.textContent = "正在生成预览（快速查看）… " + Math.round((Date.now() - t0) / 1000) + " 秒"; }, 1000);
    msg.textContent = "正在生成预览（快速查看）…";
    quickLook(path, f, NV).then(function (url) { clearInterval(tick); show(url); }, function (e) {
      clearInterval(tick);
      if (body.nv === NV) msg.innerHTML = '<span class="st-red">无法预览：' + esc(e.message) + '</span>　<span class="st-k" data-fa="open">用默认 App 打开</span>　<span class="st-k" data-fa="retry">重试</span>';
    });
  }
  function quickLook(path, f, NV) {
    var info = LOC().info ? LOC().info() : null, home = (info && info.home) || "", h = 0, id = path + "|" + f.mtime + "|" + f.size, q = T().shellEscape;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    var dir = home + "/Library/Caches/Vibing Studio/quicklook/" + (h >>> 0).toString(36), pv = dir + "/" + String(path).split("/").pop() + ".qlpreview";
    // 生成好的预览：Preview.html（文稿、表格、讲演）或 Preview.pdf 等（直接看文件在不在，不起 shell）
    var pick = function () {
      var names = ["Preview.html", "Preview.pdf", "Preview.png", "Preview.jpeg", "Preview.tiff", "Preview.rtf", "Preview.txt"], i = 0;
      var next = function () { if (i >= names.length) return ""; var n = names[i++]; return LOC().stat(pv + "/" + n).then(function (st) { return st ? fileUrl(pv + "/" + n) : next(); }, next); };
      return Promise.resolve(next());
    };
    return pick().then(function (u) {
      if (u) return u;
      var ac = new AbortController(), timer = setTimeout(function () { ac.abort(); }, 180000); // 三分钟还没好：不等了
      NV.stop = function () { clearTimeout(timer); ac.abort(); };
      // 标签页关了：还在生成的停掉
      var watch = setInterval(function () { if (!NV.box.isConnected) { clearInterval(watch); NV.stop(); } }, 1500);
      return LOC().exec({ cmd: "mkdir -p " + q(dir) + " && qlmanage -p -o " + q(dir) + " " + q(path) + " >/dev/null 2>&1" }, ac.signal).then(function () {
        clearInterval(watch); clearTimeout(timer);
        if (ac.signal.aborted) throw new Error("生成预览超时");
        return pick();
      }).then(function (u2) { if (!u2) throw new Error("快速查看没有生成预览"); return u2; });
    });
  }
  // 代码编辑器（只看也用它，只读）：CodeMirror 6（vendor/codemirror/cm6.js，第一次打开文件时才载入）——
  //   只画看得见的行、语法树在后台分片算：几千行、几 MB 的文件打开、滚动、打字都不卡；中文输入法、撤销、⌘F 查找、括号、缩进都是它自己的。
  //   颜色、字体走页面的 CSS 变量（代码字 --st-mono、--hl-*），深浅主题跟着变。建好一次就留着：只看 ⇄ 编辑只换只读，换标签页、重画都不重建
  var cmP = null, BIG_TEXT = 2 * 1024 * 1024, EDS = {};
  // 预先准备（不等你点）：空闲时把编辑器载入；指针在「文件」里某个文件上停一下（150ms），先把它读进来——点开就是现成的
  setTimeout(function () { if (LOC()) loadCM().catch(function () {}); }, 4000);
  var preT = 0;
  function prefetch(path) {
    if (!path || !LOC() || FILES[path]) return;
    var f = FILES[path] = { kind: "", mode: "view", dirty: false, loaded: true };
    loadFile(path, function () { f.pre = true; allPanes().forEach(function (p) { var pr = p.program; if (pr && pr.page === "file" && pr.arg === path && pr.redraw) { pr.redraw(); p.win.syncTitles(); } }); }); // 读到一半就点开了：读完把开着的那一页画出来
  }
  document.addEventListener("mouseover", function (e) {
    var r = e.target.closest && e.target.closest(".st-ft-row[data-i], [data-fpath]");
    clearTimeout(preT);
    if (!r) return;
    preT = setTimeout(function () { var p = r.dataset.fpath || (window.TSU_FILES && TSU_FILES.pathAt ? TSU_FILES.pathAt(r) : ""); if (p && !/\/$/.test(p)) prefetch(p); }, 150);
  }, true);
  function loadCM() {
    if (window.CM6) return Promise.resolve(window.CM6);
    if (cmP) return cmP;
    cmP = new Promise(function (res, rej) {
      var sc = document.createElement("script");
      sc.src = "vendor/codemirror/cm6.js";
      sc.onload = function () { if (window.CM6) res(window.CM6); else { cmP = null; rej(new Error("编辑器没载入")); } };
      sc.onerror = function () { cmP = null; sc.remove(); rej(new Error("编辑器没载入")); };
      document.head.appendChild(sc);
    });
    return cmP;
  }
  // 缩进跟着文件自己的：tab 缩进的用 tab；空格的看最小那一级是 2 还是 4 个
  function indentOf(text) {
    var t = 0, sp = 0, min = 0;
    String(text || "").slice(0, 400000).split("\n", 4000).forEach(function (l) { var m = /^( +|\t+)\S/.exec(l); if (!m) return; if (m[1][0] === "\t") t++; else { sp++; if (!min || m[1].length < min) min = m[1].length; } });
    return t > sp ? "\t" : min === 2 ? "  " : "    ";
  }
  // 按行滚（阻尼，同终端里的对话 live.js）：滚轮、触控板攒够一行走一行，停在整行上（上面不露半行）；设置 › 外观 › 代码滚动选「平滑」就交给原生。
  //   sc：滚动的那一块；rowH()：一行多高；pad()：第一行上面空出来的那一截（滚到最上面时留着）。左右滑照原生（长行要横着看）
  function lineWheel(sc, rowH, pad) {
    if (!sc || sc.stLineWheel) return;
    sc.stLineWheel = true;
    var acc = 0;
    sc.addEventListener("wheel", function (e) {
      if (e.ctrlKey || e.metaKey || getv("codeScroll") === "smooth") return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { acc = 0; return; }
      var h = rowH(), p0 = pad ? pad() : 0;
      if (!(h > 0)) return;
      e.preventDefault();
      var px = e.deltaMode === 1 ? e.deltaY * h : e.deltaMode === 2 ? e.deltaY * sc.clientHeight : e.deltaY;
      if (Math.sign(px) !== Math.sign(acc)) acc = 0;
      acc += px;
      var rows = Math.trunc(acc / h);
      if (!rows) return;
      acc -= rows * h;
      // 现在停在第几行（最上面那一截空白算第 0 格），走 rows 行；到头了让浏览器自己夹住
      var k = sc.scrollTop <= p0 / 2 ? 0 : Math.round((sc.scrollTop - p0) / h);
      k = Math.max(0, k + rows);
      sc.scrollTop = k ? p0 + k * h : 0;
    }, { passive: false });
  }
  function editor(body, path, onDirty, ro) {
    var f = FILES[path], old = body.ed;
    if (old && old.path === path && old.root.parentNode === body) { old.sync(ro); return old; }
    body.innerHTML = '<div class="st-ed st-cm"></div>';
    var root = body.firstChild, ED = { path: path, root: root, api: null, seen: null, quiet: false, cmpT: 0 };
    body.ed = ED;
    (EDS[path] = (EDS[path] || []).filter(function (x) { return x.root.isConnected; })).push(ED);
    // 改了：马上标 ●、出「保存」；停手 250ms 再整篇比一次（改回原样了 ● 就去掉）
    var flush = function () {
      clearTimeout(ED.cmpT); ED.cmpT = 0;
      if (!ED.api) return;
      f.text = ED.seen = ED.api.text();
      var d = f.text !== f.saved;
      if (d !== f.dirty) { f.dirty = d; onDirty(); }
      (EDS[path] || []).forEach(function (x) { if (x !== ED && x.root.isConnected) x.sync(); }); // 同一个文件还开在别的格子里：跟着换
    };
    ED.flush = flush;
    ED.sync = function (r) {
      if (r !== undefined && r !== ro) { ro = r; if (ED.api) { ED.api.setReadOnly(ro); if (!ro) ED.api.focus(); } }
      if (!ED.api) return;
      if (ED.cmpT) return flush();
      if (f.text !== ED.seen) { ED.quiet = true; ED.seen = f.text; ED.api.setText(f.text || ""); ED.quiet = false; }
      if (f.line && !f.scrolled) { f.scrolled = true; ED.api.gotoLine(f.line); }
    };
    var t0 = Date.now();
    // 编辑器已经载入了：当场建（不等下一轮——那一帧是空白的，点一下就闪一下）
    var withCM = function (fn, fail) { if (window.CM6) { try { fn(window.CM6); } catch (e) { fail(e); } } else loadCM().then(fn, fail); };
    withCM(function (CM) {
      if (body.ed !== ED || !root.isConnected) return;
      var text = f.text || "";
      ED.seen = text;
      // 编辑器放进影子 DOM：整页几千条样式规则不再一条条去配 CodeMirror 每次新画出来的几千个元素——快速滚动时每次重算样式从 20ms 左右降到几 ms。
      //   颜色、字体走继承下来的 CSS 变量（--st-* / --hl-*）；行号藏不藏看 --st-cm-gut（html.st-noln 设，studio.css）
      var mount = root;
      if (root.attachShadow) {
        var sh = root.shadowRoot || root.attachShadow({ mode: "open" });
        sh.innerHTML = "<style>" + CM_SHADOW_CSS + '</style><div class="st-cmin"></div>';
        mount = sh.lastChild;
      }
      ED.api = CM.create(mount, {
        text: text, name: path, readOnly: ro, plain: text.length > BIG_TEXT, indent: indentOf(text), crlf: /\r\n/.test(text.slice(0, 200000)),
        line: f.line && !f.scrolled ? f.line : 0,
        onChange: function () { if (ED.quiet) return; if (!f.dirty) { f.dirty = true; onDirty(); } clearTimeout(ED.cmpT); ED.cmpT = setTimeout(flush, 250); },
        onSave: function () { saveFile(path, onDirty); },
      });
      if (f.line && !f.scrolled) f.scrolled = true;
      var cmv = ED.api.view;
      var cmPad = -1; // 第一行上面那一截（主题里写死的 8px）：量一次就记着——每一下滚轮都去量会逼着重算样式
      lineWheel(cmv.scrollDOM, function () { return cmv.defaultLineHeight; }, function () { if (cmPad < 0) cmPad = parseFloat(getComputedStyle(cmv.contentDOM).paddingTop) || 0; return cmPad; }); // 只看、编辑一样
      // 字给编辑器：别的快捷键（⌘ 开头的除外）不往外冒
      root.addEventListener("keydown", function (e) { if (!e.metaKey) e.stopPropagation(); });
      if (!ro && document.activeElement && root.closest(".tpane") && root.closest(".tpane").contains(document.activeElement)) ED.api.focus();
      ED.openMs = Date.now() - t0;
    }, function (e) { if (body.ed === ED) (root.shadowRoot || root).innerHTML = '<div class="st-red st-pad">' + esc(e.message) + "</div>"; });
    return ED;
  }
  // 影子 DOM 里编辑器用的那几条（外面 studio.css 的规则进不来）
  var CM_SHADOW_CSS = ":host{display:block}.st-cmin,.cm-editor{height:100%}.cm-scroller{-webkit-user-select:text;user-select:text}" +
    ".cm-gutters{display:var(--st-cm-gut,flex)!important}.cm-editor .cm-content .cm-line{padding-left:var(--st-cm-pl,4px)}" +
    ".st-red{color:var(--st-red)}.st-pad{padding:12px 14px}";
  // 存：then() 存好了；fail() 没存成（写不进去、外面改过了你又选了不覆盖）
  function saveFile(path, then, fail) {
    var f = FILES[path];
    if (!f || f.kind !== "text") { if (fail) fail(); return; }
    flushEd(path);
    var text = f.text;
    LOC().stat(path).then(function (st) {
      var go = function () {
        return LOC().write(path, text).then(function () {
          f.saved = text; f.dirty = f.text !== text;
          return LOC().stat(path).then(function (s2) { f.mtime = s2 ? s2.mtime : Date.now(); if (then) then(); });
        }, function (e) { if (window.TSU_DESK && TSU_DESK.alert) TSU_DESK.alert({ title: "无法保存", message: e.message, icon: "caution" }); if (fail) fail(); });
      };
      if (st && f.mtime && st.mtime > f.mtime + 1 && window.TSU_DESK && TSU_DESK.alert) TSU_DESK.alert({ title: "文件已在外部被修改", message: "文件在打开后被其他程序（可能是 Agent）修改。要用当前内容覆盖吗？", icon: "caution", buttons: [{ label: "取消", role: "cancel", run: function () { if (fail) fail(); } }, { label: "覆盖", role: "default", run: go }] });
      else go();
    }, function () { if (fail) fail(); });
  }
  // 编辑器里刚打的字（停手 250ms 才并进 FILES）：存、问之前先并进去
  function flushEd(path) { (EDS[path] || []).forEach(function (x) { if (x.cmpT && x.flush) x.flush(); }); }
  // 改了没存：问一声（同 VS Code 在 Mac 上的那个）——粗体一行标题、一行淡的说明、三个按钮：不保存（左）· 取消 · 保存（蓝，默认）；
  //   不带图标（不要 App 图标、星号）。键：回车 = 保存，Esc = 取消，⌘D = 不保存；点外面不算。→ Promise "save" | "discard" | "cancel"
  function askSave(path) {
    var name = String(path).split("/").pop();
    return new Promise(function (resolve) {
      var box = document.createElement("div");
      box.className = "st-savedlg";
      box.setAttribute("role", "alertdialog");
      // 按钮都靠右：保存（蓝，默认）· 不保存（最危险的放中间）· 取消；右上角还有一个 ×（取消有两个入口）
      box.innerHTML = '<button type="button" class="sd-x" data-r="cancel" title="取消" aria-label="取消"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg></button>' +
        '<div class="sd-title"></div><div class="sd-msg">如果不保存，你的更改将丢失。</div>' +
        '<div class="sd-btns"><span class="sd-fill"></span><button type="button" class="sd-yes" data-r="save">保存</button><button type="button" data-r="discard">不保存</button><button type="button" data-r="cancel">取消</button></div>';
      box.querySelector(".sd-title").textContent = "是否要保存对「" + name + "」的更改？";
      var M = modalOpen(box, { cls: "st-modal-save" });
      var done = function (r) { if (!M) return; var m = M; M = null; window.removeEventListener("keydown", key, true); modalClose(m); resolve(r); };
      var key = function (e) {
        if (!M || MODALS[MODALS.length - 1] !== M) return;
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done("cancel"); }
        else if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); e.stopPropagation(); done("save"); }
        else if (e.metaKey && e.code === "KeyD") { e.preventDefault(); e.stopPropagation(); done("discard"); }
      };
      window.addEventListener("keydown", key, true);
      box.addEventListener("click", function (e) { var b = e.target.closest("[data-r]"); if (b) done(b.dataset.r); });
      setTimeout(function () { var b = box.querySelector(".sd-yes"); if (b && M) b.focus({ preventScroll: true }); }, 0);
    });
  }
  // 编辑完了切回只看：改了没存的先问（保存了再切 / 不保存就丢掉改动再切 / 取消就还在编辑）
  function leaveEdit(path, then) {
    var f = FILES[path];
    if (!f) return;
    var fin = function () { f.mode = "view"; if (then) then(); };
    flushEd(path);
    if (!f.dirty) return fin();
    askSave(path).then(function (r) {
      if (r === "save") saveFile(path, fin);
      else if (r === "discard") { f.text = f.saved; f.dirty = false; fin(); }
    });
  }
  // 要关的标签页 / 窗格 / 窗口里有改了没存的文件：一个一个问（保存 / 不保存 / 取消）；都答好了才 go()，取消了、没存成就不关
  //   同一个文件还开在别的（这次不关的）标签页里：不问（改动还在那边）。stop()：取消了 / 没存成（可不给）
  function askUnsaved(panes, go, stop) {
    var closing = (panes || []).filter(Boolean), paths = [];
    closing.forEach(function (p) { var pr = p.program; if (pr && pr.page === "file") flushEd(pr.arg); });
    closing.forEach(function (p) { var pr = p.program; if (pr && pr.page === "file" && FILES[pr.arg] && FILES[pr.arg].dirty && paths.indexOf(pr.arg) < 0) paths.push(pr.arg); });
    if (!paths.length) return go();
    var others = allPanes().filter(function (p) { return closing.indexOf(p) < 0 && !p.closed; });
    paths = paths.filter(function (path) { return !others.some(function (p) { return p.program && p.program.page === "file" && p.program.arg === path; }); });
    var next = function (i) {
      if (i >= paths.length) return go();
      var path = paths[i], f = FILES[path];
      if (!f || !f.dirty) return next(i + 1);
      askSave(path).then(function (r) {
        if (r === "save") saveFile(path, function () { next(i + 1); }, function () { if (stop) stop(); });
        else if (r === "discard") { f.text = f.saved; f.dirty = false; next(i + 1); }
        else if (stop) stop();
      });
    };
    next(0);
  }
  // 只看的文件在别处改了（agent 正在写）：跟着重新读
  setInterval(function () {
    if (!LOC() || document.hidden) return;
    allPanes().forEach(function (p) {
      var pr = p.program;
      if (!pr || pr.page !== "file" || p.win.ws.active !== p) return;
      var f = FILES[pr.arg];
      if (!f || f.mode !== "view" || f.kind === "") return;
      LOC().stat(pr.arg).then(function (st) { if (st && st.mtime !== f.mtime) { f.scrolled = true; loadFile(pr.arg, function () { pr.redraw(); }); } }).catch(function () {});
    });
  }, 1500);
  // ---- 在访达里用这个 App 打开的（「打开方式 › Vibing Studio」、拖到 Dock 图标上；原生 AppDelegate 记着）：文件在编辑区打开，文件夹在访达页里打开 ----
  function openPending() {
    if (!window.nadosNative || !LOC()) return;
    nadosNative.call("open.pending").then(function (paths) {
      var tw = T() && T().front ? T().front() : null;
      if (!tw || !Array.isArray(paths) || !paths.length) return;
      var h = home(), argOf = function (p) { return p === "/" ? "/" : h && p === h ? "~" : h && p.indexOf(h + "/") === 0 ? "~" + p.slice(h.length) : p.replace(/^\/+/, ""); };
      paths.forEach(function (p) { LOC().stat(p).then(function (st) { if (st && st.type === "dir") openPage(tw, "explorer", argOf(p)); else openFile(tw, p); }, function () { openFile(tw, p); }); });
    }, function () { /* 老版本的 App 没有这一条 */ });
  }
  window.addEventListener("nados-native", function (e) { var d = e.detail || {}; if (d.type === "open-files") openPending(); });
  setTimeout(openPending, 2500); // 刚启动（从访达里打开文件把 App 叫起来的）：窗口恢复完再来取
  function openFile(tw, path, o) {
    if (!path) return;
    if (!termapp() || !LOC()) { if (window.TSU_IDE && TSU_IDE.open) TSU_IDE.open(path); return; } // 网页桌面：交给编辑器
    var f = FILES[path];
    if (f && o && o.line) { f.line = o.line; f.scrolled = false; }
    if (!f) FILES[path] = { kind: "", mode: "view", dirty: false, line: (o && o.line) || 0 };
    openPage(tw, "file", path);
  }

  // ======== 命令面板（⇧⌘P）、快速打开（⌘P）：同 Claude Code 的斜杠菜单的样子 ========
  var CMDS = [];
  function command(id, o) { CMDS = CMDS.filter(function (c) { return c.id !== id; }); o.id = id; if (o.when0 === undefined && o.scope) o.when0 = o.scope; CMDS.push(o); }
  // 命令面板、快速选择、自定义布局：VS Code、Claude App 风格里放进模态层——底下整个 App 点不到、Tab 出不去，点外面 / Esc 关、焦点还回去；
  //   页面上的原生网页被它盖住就藏起来（webview.js 的 OVER 里有 .st-modal）。macOS、Pure Terminal 照旧放在窗口里
  var PAL = null; // 现在开着的那一个：{ box, close, M }
  function palHost(tw, box, close) {
    if (PAL && PAL.box !== box) { var p0 = PAL; PAL = null; try { p0.close(); } catch (e) { /* 已经关了 */ } }
    if (root.classList.contains("st-os-vscode") || root.classList.contains("st-os-claude")) { PAL = { box: box, close: close, M: modalOpen(box, { cls: "st-modal-pal", onBackdrop: function () { close(); } }) }; palPlace(box); Promise.resolve().then(function () { palPlace(box); }); return; } // 调用的那边这一轮里才填列表：填完（画之前）再按真的高度摆一次
    tw.el.appendChild(box);
    PAL = { box: box, close: close, M: null };
  }
  // 快速输入摆在哪（同 VS Code）：「顶部」——上沿和窗口顶上那一条（地址框）的上沿齐，盖住标题栏，不是落在标签行上；
  //   「居中」——按这个框打开时真的高度上下居中（命令面板、配色、高亮配色带代码样例、自定义布局高矮都不一样，不再一律 24%）；开着时打字筛选变矮，位置不跟着跳
  function palPlace(box) {
    if (!box.isConnected) return;
    var bar = document.querySelector("#win .bar"), br = bar && bar.getClientRects().length ? bar.getBoundingClientRect() : null;
    var addr = bar && bar.querySelector(".ts-addr"), ar = addr && addr.getClientRects().length ? addr.getBoundingClientRect() : null;
    var H = window.innerHeight, h = box.offsetHeight, top;
    if (getv("quickInput") === "center") top = Math.max(br ? br.bottom + 6 : 8, Math.round((H - h) / 2));
    else top = ar && ar.height ? ar.top : br ? br.top + 4 : 4;
    if (top + h > H - 6) top = Math.max(4, H - 6 - h); // 放不下：往上挪，底边留一点
    box.style.top = Math.round(top) + "px";
  }
  function palDone(box) { if (!PAL || PAL.box !== box) return; var M = PAL.M; PAL = null; if (M) modalClose(M); }
  function palette(tw, mode) {
    tw = tw || (T() && T().front());
    if (!tw) return;
    if (PAL) { var p1 = PAL; PAL = null; try { p1.close(); } catch (e) { /* 已经关了 */ } }
    var old = document.querySelector(".st-palette");
    if (old) old.remove();
    var box = document.createElement("div"), q0 = mode === "cmd" ? ">" : "", sel = 0, items = [];
    box.className = "st-palette terminal-style-ui";
    box.innerHTML = '<div class="st-pin"><span class="st-lav">❯</span><input spellcheck="false" autocomplete="off" placeholder="' + (mode === "cmd" ? "输入命令" : "搜索会话、Agent、文件或输入网址（输入 > 以运行命令）") + '"></div><div class="st-plist"></div>';
    palHost(tw, box, function () { close(); });
    var input = box.querySelector("input"), listEl = box.querySelector(".st-plist");
    input.value = q0;
    function compute() {
      var v = input.value, isCmd = v[0] === ">", q = (isCmd ? v.slice(1) : v).trim().toLowerCase();
      if (isCmd) items = CMDS.filter(function (c) { return !c.when || c.when(tw); }).filter(function (c) { return !q || c.title.toLowerCase().indexOf(q) >= 0 || c.id.indexOf(q) >= 0; }).map(function (c) { return { title: c.title, meta: c.keys || "", run: function () { c.run(tw); } }; });
      else items = (window.TSU_BROWSER && TSU_BROWSER.suggest ? TSU_BROWSER.suggest(q || "") : []).map(function (s) { return { title: s.title, meta: s.url || s.go || "", run: function () { TSU_BROWSER.go(s.url || s.go, null); } }; });
      if (!isCmd && !q) items = (window.TSU_BROWSER && TSU_BROWSER.recent ? TSU_BROWSER.recent(12) : []).map(function (h) { return { title: h.title, meta: h.url, run: function () { TSU_BROWSER.go(h.url, null); } }; });
      if (!isCmd && q && !items.length && /^(~|\/|https?:|[\w-]+\.code)/.test(q)) items = [{ title: "打开 " + input.value.trim(), meta: "", run: function () { TSU_BROWSER.go(input.value.trim(), null); } }];
      sel = Math.min(sel, Math.max(0, items.length - 1));
      listEl.innerHTML = items.slice(0, 14).map(function (it, i) { return '<div class="st-prow' + (i === sel ? " on" : "") + '" data-i="' + i + '"><span class="st-ptr">' + (i === sel ? "❯" : " ") + '</span><span class="st-cut st-pt">' + esc(it.title) + '</span><span class="st-pkey">' + esc(it.meta) + "</span></div>"; }).join("") || '<div class="st-dim st-prow">  无匹配结果</div>';
    }
    var close = function () { palDone(box); box.remove(); var P = tw.ws.active; if (P) P.focus(); };
    var run = function (i) { var it = items[i]; close(); if (it) it.run(); };
    input.addEventListener("input", function () { sel = 0; compute(); });
    input.addEventListener("keydown", function (e) {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); compute(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); compute(); }
      else if (e.key === "Enter") { e.preventDefault(); run(sel); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
      e.stopPropagation();
    });
    listEl.addEventListener("mousedown", function (e) { var r = e.target.closest("[data-i]"); if (r) { e.preventDefault(); run(+r.dataset.i); } });
    input.addEventListener("blur", function () { setTimeout(function () { if (document.contains(box) && document.activeElement !== input && !(document.activeElement && box.contains(document.activeElement))) close(); }, 150); });
    compute();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  // ======== 终端里的路径：⌘ 点一下在编辑区打开 ========
  var PATH_RE = /(?:~|\.{1,2})?\/[^\s'"`<>|()\[\]{}:,;]+(?::\d+(?::\d+)?)?|(?:[\w.@-]+\/)*[\w@-][\w.@-]*\.[A-Za-z][\w]{0,9}(?::\d+(?::\d+)?)?/g;
  function fileLinks(term, P) {
    if (!term.registerLinkProvider || !LOC()) return;
    term.registerLinkProvider({
      provideLinks: function (y, cb) {
        var line = term.buffer.active.getLine(y - 1);
        if (!line) return cb(undefined);
        var s = "", map = [];
        for (var x = 0; x < line.length; x++) {
          var cell = line.getCell(x);
          if (!cell) break;
          if (cell.getWidth() === 0) continue;
          var ch = cell.getChars() || " ";
          for (var k = 0; k < ch.length; k++) map.push(x);
          s += ch;
        }
        var found = [], m;
        PATH_RE.lastIndex = 0;
        while ((m = PATH_RE.exec(s))) {
          var raw = m[0].replace(/[.,;:]+$/, ""), lm = /:(\d+)(?::\d+)?$/.exec(raw), p = lm ? raw.slice(0, lm.index) : raw;
          if (p.length < 3 || /^https?:/.test(s.slice(Math.max(0, m.index - 6), m.index + 1))) continue;
          found.push({ p: p, line: lm ? +lm[1] : 0, a: m.index, b: m.index + raw.length });
        }
        if (!found.length) return cb(undefined);
        var base = (P.shell && P.shell.fg && P.shell.fg.cwd) || (P.shell && P.shell.cwd ? P.shell.cwd() : home());
        var abs = function (p) { return p[0] === "~" ? home() + p.slice(1) : p[0] === "/" ? p : base.replace(/\/$/, "") + "/" + p.replace(/^\.\//, ""); };
        Promise.all(found.map(function (f) { return LOC().stat(abs(f.p)).then(function (st) { return st && st.type === "file" ? f : null; }, function () { return null; }); })).then(function (ok) {
          var links = ok.filter(Boolean).map(function (f) {
            return { range: { start: { x: map[f.a] + 1, y: y }, end: { x: map[f.b - 1] + 1, y: y } }, text: f.p, decorations: { underline: true, pointerCursor: true },
              activate: function (e) { if (e.metaKey || e.ctrlKey) openFile(P.win, abs(f.p), { line: f.line }); } };
          });
          cb(links.length ? links : undefined);
        });
      },
    });
  }

  // ======== OSC 7700：终端程序交的元素 ========
  function osc(o) { return "\x1b]7700;" + btoa(unescape(encodeURIComponent(JSON.stringify(o)))) + "\x07"; }
  function fromOSC(P, payload) {
    var j;
    try { j = JSON.parse(decodeURIComponent(escape(atob(String(payload).trim())))); } catch (e) { return; }
    if (!j || typeof j !== "object") return;
    var owner = P.shell && P.shell.fg && P.shell.fg.pid || 0; // 交元素的程序（shell 自己交的：跟着标签页；程序交的：程序退了就收掉）
    if (j.op === "set" && j.el && typeof j.el === "object" && /^[^\s\x00-\x1f"'<>&]{1,64}$/.test(String(j.el.id || "")) && TYPES[j.el.type]) {
      set(P, { id: String(j.el.id), type: j.el.type, title: j.el.title ? String(j.el.title).slice(0, 80) : "", data: j.el.data || {}, site: String(j.el.site || "osc").replace(/[^\w.-]/g, "").slice(0, 32) || "osc", events: !!j.el.events, osc: true, owner: owner });
    } else if (j.op === "remove" && j.id) remove(P, String(j.id));
    else if (j.op === "clear") Object.keys(P.els || {}).forEach(function (id) { if (P.els[id].osc) remove(P, id); });
  }
  function fgChanged(P, fg) { Object.keys(P.els || {}).forEach(function (id) { var el = P.els[id]; if (el.osc && el.owner && (!fg || fg.pid !== el.owner)) remove(P, id); }); }

  // ======== Claude Code 的适配层：读它写在磁盘上的，变成同样的元素 ========
  var ccSettings = { at: 0, j: null };
  function readCCSettings() {
    if (Date.now() - ccSettings.at < 10000 || !LOC()) return;
    ccSettings.at = Date.now();
    LOC().read(home() + "/.claude/settings.json").then(function (b) { try { ccSettings.j = JSON.parse(new TextDecoder().decode(b)); } catch (e) { /* 写坏了 */ } }, function () {});
  }
  var ccTasks = {}; // 会话 id → { sig, items }
  function ccTasksOf(sid, done) {
    var t = ccTasks[sid] || (ccTasks[sid] = { items: [] }), dir = home() + "/.claude/tasks/" + sid;
    LOC().stat(dir + "/.highwatermark").then(function (st) {
      var sig = st ? st.mtime : 0;
      if (t.sig === sig && t.seen) return done(t.items);
      return LOC().glob(dir + "/*.json").then(function (files) {
        return Promise.all((files || []).map(function (f) { return LOC().read(f).then(function (b) { try { return JSON.parse(new TextDecoder().decode(b)); } catch (e) { return null; } }, function () { return null; }); }));
      }).then(function (items) {
        t.sig = sig; t.seen = true;
        t.items = items.filter(function (i) { return i && i.subject && i.status !== "deleted"; }).sort(function (a, b) { return (+a.id || 0) - (+b.id || 0); });
        done(t.items);
      });
    }).catch(function () { done(t.items); });
  }
  function ccAdapter() {
    if (!LOC()) return;
    if (!ccOn()) { allWins().forEach(function (tw) { tw.ws.all().forEach(function (P) { if (P.els) clear(P, "claude"); }); }); return; }
    readCCSettings();
    allWins().forEach(function (tw) {
      var P = tw.ws.active;
      if (!P || !P.shell || !P.shell.pty) return;
      var cc = tw.side && tw.side.cc ? tw.side.cc() : null, sid = null;
      if (cc) Object.keys(cc.panes).forEach(function (k) { if (cc.panes[k] === P) sid = k; });
      if (!sid || P.program !== P.shell) { clear(P, "claude"); return; }
      var x = cc.list.filter(function (y) { return y.id === sid; })[0];
      if (!x) return;
      var busy = !!(x.live && x.live.status === "busy"), s = ccSettings.j || {}, base = String(x.model || s.model || "").replace(/\[1m\]$/i, "");
      var effort = (s.modelSettings && s.modelSettings[base] && s.modelSettings[base].effortLevel) || s.effortLevel || "";
      var big = /\[1m\]/i.test(String(s.model || "")) || (x.ctx || 0) > 200000;
      var status = function (items) {
        var doing = (items || []).filter(function (i) { return i.status === "in_progress"; })[0];
        set(P, { id: "status", type: "status", site: "claude", title: "Claude Code", data: { busy: busy, label: busy ? (doing && (doing.activeForm || doing.subject)) || "Working" : "空闲", t0: busy ? (x.live && x.live.statusAt) || 0 : 0, detail: busy && effort ? effort + " effort" : "" } });
      };
      status(ccTasks[sid] && ccTasks[sid].items);
      if (x.ctx) set(P, { id: "context", type: "context", site: "claude", data: { tokens: x.ctx, window: big ? 1000000 : 200000, model: x.model || "" } });
      ccTasksOf(sid, function (items) {
        status(items);
        if (items.length && items.some(function (i) { return i.status !== "completed"; })) set(P, { id: "tasks", type: "tasks", site: "claude", data: { items: items.map(function (i) { return { id: i.id, subject: i.subject, status: i.status, activeForm: i.activeForm }; }) } });
        else remove(P, "tasks");
      });
      set(P, { id: "view", type: "form", site: "claude", title: "视图", fields: ccViewFields, change: function (k, v) { place("claude", k, v); } });
    });
  }
  function ccViewFields() {
    var opt = [["status", "状态栏"], ["side", "辅助侧栏"], ["hidden", "隐藏"]];
    return [
      { head: "Claude Code 界面元素的显示位置" },
      { key: "status", label: "状态", desc: "运行状态、持续时间与推理强度", kind: "seg", options: opt, value: slotOf("claude", "status") },
      { key: "tasks", label: "任务清单", desc: "~/.claude/tasks 中的任务", kind: "seg", options: opt, value: slotOf("claude", "tasks") },
      { key: "context", label: "上下文", desc: "上下文用量", kind: "seg", options: opt, value: slotOf("claude", "context") },
    ];
  }
  setInterval(ccAdapter, 2000);
  // ---- 通知（设置 › 通用 › 通知，默认关）：开着的 Agent 从在跑变成停下、App 不在前台时发一条系统通知；点它回到那个 Agent ----
  var notePrev = {};
  function noteTick() {
    var mode = getv("agentNotify") || "off", T = window.TSU_TERM, A2 = window.TSU_AGENTS, N = window.nadosNative;
    if (!T || !T.panes || !A2 || !A2.runtime) return;
    var seen = {};
    T.panes().forEach(function (p) {
      var id = p.program && p.program.agentId;
      if (!id || seen[id]) return;
      seen[id] = 1;
      var rt = null; try { rt = A2.runtime(id); } catch (e) { rt = null; }
      if (!rt) return;
      var busy = !!rt.stream, was = notePrev[id];
      notePrev[id] = busy;
      if (mode === "off" || !was || busy || !N || !N.call) return;
      if (!document.hidden && document.hasFocus()) return; // 正看着：不打扰
      var name = (rt.agent && rt.agent.name) || "Agent", tail = rt.tail ? String(rt.tail() || "") : "";
      N.call("notify", { id: "agent:" + id + ":" + Date.now(), title: name + " 做完了", body: tail.replace(/\s+/g, " ").slice(0, 160) }).catch(function () {});
    });
  }
  setInterval(noteTick, 2000);
  // ---- 在等你的会话（问你问题、等你确认权限）：开着的标签页（V.needsYou）+ 没开着、Claude Code 登记成 waiting 的（侧栏的会话列表）----
  //   标签页图标变蓝（browser.js 的 fav）、在跑那一行右边「● n awaiting input」（live.js）、Dock 角标写个数、新出现的发一条系统通知（不在看它的时候）
  function needsList() {
    var T = window.TSU_TERM, out = [], seen = {};
    if (T && T.panes) T.panes().forEach(function (p) {
      var pr = p.program, id = pr && pr.agentId, nd = null;
      if (!id || seen[id] || !pr.needsYou) return;
      try { nd = pr.needsYou(); } catch (e) { nd = null; }
      seen[id] = 1;
      if (nd) out.push({ aid: id, name: (pr.title && pr.title()) || id, text: nd.text || "", pane: p });
    });
    var cc = window.STUDIO && STUDIO.cc ? STUDIO.cc() : null;
    ((cc && cc.list) || []).forEach(function (x) { var id = "cc:" + x.id; if (seen[id] || !x.live || x.live.status !== "waiting") return; seen[id] = 1; out.push({ aid: id, name: x.title || x.id.slice(0, 8), text: "" }); });
    return out;
  }
  var needsSig = "", needsSeen = {};
  setInterval(function () {
    var L0 = needsList(), sig = L0.map(function (x) { return x.aid; }).sort().join("|"), N = window.nadosNative;
    if (sig === needsSig) return;
    needsSig = sig;
    document.dispatchEvent(new Event("vs-needs"));
    allWins().forEach(function (w) { if (w.syncTitlesSoon) w.syncTitlesSoon(); else if (w.syncTitles) w.syncTitles(); });
    if (N && N.call) N.call("badge", { text: L0.length ? String(L0.length) : "" }).catch(function () {}); // Dock 角标：几个会话在等你
    var now = {};
    L0.forEach(function (x) {
      now[x.aid] = 1;
      if (needsSeen[x.aid]) return;
      var vis = x.pane && !x.pane.off && document.visibilityState === "visible" && document.hasFocus() && x.pane.el && x.pane.el.offsetParent; // 正看着它：不打扰
      if (vis || !N || !N.call || (getv("agentNotify") || "off") === "off") return;
      N.call("notify", { id: "agent:" + x.aid + ":" + Date.now(), title: x.name + " 在等你", body: x.text ? x.text.slice(0, 160) : "需要你确认或回答" }).catch(function () {});
    });
    needsSeen = now;
  }, 1500);
  if (window.nadosNative && nadosNative.on) nadosNative.on("notification-click", function (d) { var m = /^agent:(.+):\d+$/.exec((d && d.id) || ""); if (m && window.TSU_TERM && TSU_TERM.agent) TSU_TERM.agent(m[1]); });
  // 转圈、「几秒」在走：只重画状态栏那一行（状态栏关着就什么都不做）
  setInterval(function () { if (document.hidden || !getv("statusBar")) return; allWins().forEach(function (tw) { if (!tw.open || !termapp()) return; var els = list(tw.ws.active); if (els.some(function (el) { return el.type === "status" && el.data && el.data.busy; })) { try { statusBar(tw, null, null, els); } catch (e) { /* 这一格还没搭好 */ } } }); }, 240);

  // ---- Claude Code 的设置：~/.claude/settings.json 里它 /config 写的那些（Claude Code 会自己重新读）；第一次改之前留一份 settings.json.paimon-bak ----
  var ccFile = function () { return home() + "/.claude/settings.json"; };
  var ccBacked = false, ccCache = null;
  function ccRead() { return LOC().read(ccFile()).then(function (b) { return JSON.parse(new TextDecoder().decode(b) || "{}"); }, function () { return {}; }); }
  function ccWrite(fn) {
    return LOC().read(ccFile()).then(function (b) { return new TextDecoder().decode(b); }, function () { return "{}"; }).then(function (raw) {
      var j = JSON.parse(raw || "{}");
      fn(j);
      var w = ccBacked ? Promise.resolve() : LOC().write(ccFile() + ".paimon-bak", raw).then(function () { ccBacked = true; });
      return w.then(function () { return LOC().write(ccFile(), JSON.stringify(j, null, 2) + "\n"); }).then(function () { ccSettings.j = j; ccSettings.at = Date.now(); });
    });
  }
  // Claude Code 的权限模式（2.1.281 自己的叫法）：指着看说明
  var CC_PERM = { "default": ["Manual", "每次修改文件或运行命令前都请求确认"], acceptEdits: ["Accept edits", "自动修改文件，运行命令前请求确认"], plan: ["Plan", "仅分析和规划，不修改文件、不运行命令"],
    auto: ["Auto", "按规则自动判断：Soft allow（允许）、Soft deny（询问）、Hard deny（拒绝）；规则可在 /permissions 中配置"], bypassPermissions: ["Bypass Permissions", "不请求确认，直接执行所有操作"], dontAsk: ["Don't Ask", "不请求确认，拒绝所有未授权的操作"] };
  var ccAt = 0;
  addSettings("claude", {
    title: "Claude Code", order: 30, desc: "本机 Claude Code 的设置（~/.claude/settings.json），此处仅供查看；如需修改，请直接编辑该文件",
    show: function () { return !!LOC() && ccOn(); },
    fields: function () {
      var j = ccCache || {}, perm = (j.permissions && j.permissions.defaultMode) || "default", pm = CC_PERM[perm] || [perm, ""];
      // 一直跟着文件：隔几秒再打开就重新读一次（你在它的终端里 /config、/permissions 改了，这里也对得上）
      if (!ccCache || Date.now() - ccAt > 3000) { ccAt = Date.now(); ccRead().then(function (x) { var same = JSON.stringify(x) === JSON.stringify(ccCache); ccCache = x; if (!same) document.dispatchEvent(new Event("st-settings-changed")); }); }
      var base = String(j.model || "").replace(/\[1m\]$/i, ""), own = j.modelSettings && j.modelSettings[base] && j.modelSettings[base].effortLevel, eff = own || j.effortLevel || "";
      var EFF = { low: "低", medium: "中", high: "高", xhigh: "很高", max: "最高" };
      return [
        { head: "检测到的" },
        { key: "cc.model", label: "模型", kind: "info", value: j.model || "默认" },
        { key: "cc.effort", label: "默认推理强度", desc: own ? "这个模型（" + base + "）单独设的；新会话用它" : "新会话用它", kind: "info", value: eff ? (EFF[eff] || eff) : "默认" },
        { key: "cc.perm", label: "默认权限模式", desc: pm[1], kind: "info", value: pm[0] + (j.permissions && j.permissions.defaultMode ? "" : "（默认）") },
        { key: "cc.mem", label: "自动记忆", kind: "info", value: j.autoMemoryEnabled === false ? "关" : "开" },
        { head: "设置文件" },
        { key: "cc.edit", label: "~/.claude/settings.json", desc: "在编辑器中打开并修改；Claude Code 会自动重新载入，此处同步更新", kind: "button", text: "编辑…", act: "json" },
      ];
    },
    change: function (k, v) {
      return ccWrite(function (j) {
        if (k === "defaultMode") { j.permissions = j.permissions || {}; j.permissions.defaultMode = v; }
        else if (k === "effort") { var base = String(j.model || "").replace(/\[1m\]$/i, ""); if (base && j.modelSettings && j.modelSettings[base]) j.modelSettings[base].effortLevel = v; else j.effortLevel = v; }
        else if (k === "tui" && v === "default") delete j.tui;
        else j[k] = v;
      }).then(function () { return ccRead(); }).then(function (x) { ccCache = x; });
    },
    action: function (what, tw) {
      if (what === "json") return openFile(tw, ccFile());
      if (what !== "native") return;
      var P = null;
      tw.ws.all().forEach(function (p) { if (!P && p.shell && p.shell.fg && /claude/i.test(p.shell.fg.name || "")) P = p; });
      if (P && P.shell.type) { tw.ws.tabs.forEach(function (t, i) { if (tw.ws.leaves(t.root).some(function (l) { return l.pane === P; })) tw.ws.select(i); }); tw.ws.activate(P); P.shell.type("/config\r"); }
      else if (window.TSU_DESK && TSU_DESK.alert) TSU_DESK.alert({ title: "没有运行 Claude Code 的标签页", message: "请先在标签页中打开 Claude Code。" });
    },
  });

  // ======== 设置：一份 JSON（这台 Mac 上是 ~/.paimon/studio.json，别处存在浏览器里）；设置页是它的界面，也能直接改文件（改了马上用上）========
  // 缩略图的几种样子：始终显示、仅手动滚动时浮现（默认）、透明、隐藏
  var MINI_MODES = [["show", "始终显示"], ["scroll", "仅滚动时显示"], ["hide", "隐藏"]]; // 以前还有「透明」：和始终显示几乎看不出差别（底色本来就同对话），去掉了——存着的当「始终显示」
  // 两种风格各管各的：Agent 显示风格（对话怎么画：TUI 同 Claude Code 的终端界面 / GUI 同 Claude App）、应用风格（整个外壳：VS Code / Claude App / macOS）
  var UI_MODES = [["tui", "TUI"], ["gui", "GUI"]];
  var OS_MODES = [["vscode", "Visual Studio Code"], ["claude", "Claude Desktop"], ["macos", "macOS"], ["terminal", "Pure Terminal"]]; // Pure Terminal：同 iTerm，只有标签页和终端 / 对话
  // Claude App 风格的对话字体（设置 › 通用 › 外观 › 对话字体）：衬线（同 Claude 的 Anthropic Serif 那种）、无衬线、系统、给读写障碍的
  var CHAT_FONTS = { system: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", system-ui, sans-serif', serif: '"Tiempos Text", "Iowan Old Style", "Palatino", Georgia, "Songti SC", "STSong", serif',
    sans: '"Styrene B", "Avenir Next", "Helvetica Neue", "PingFang SC", sans-serif', dyslexic: '"OpenDyslexic", "Comic Sans MS", "Chalkboard SE", "PingFang SC", sans-serif' };
  // 能选的应用风格：macOS、Pure Terminal 暂停开发了（不再修问题、不跟新功能），打开「开发者功能」才列出来（现在正用着的那个照样列出、打勾，不会被收走）；
  // 列出来时名字后面标「（暂停开发）」，换过去之前先提醒一句（setv 里拦）。每一项 [id, 名字, 第几个]——第几个是它的快捷键 ⌃⌘n（不随列出来的多少变）
  var OS_FROZEN = { macos: true, terminal: true };
  var devOn = function () { return !!getv("devFeatures"); };
  var osOk = function (id) { return devOn() || id === "vscode" || id === "claude"; };
  function osModesNow() { var cur = getv("os", true) || "vscode", shown = getv("os") || "vscode"; return OS_MODES.map(function (x, i) { return [x[0], x[1] + (OS_FROZEN[x[0]] ? "（暂停开发）" : ""), i + 1]; }).filter(function (x) { return osOk(x[0]) || x[0] === cur || x[0] === shown; }); }
  function frozenAsk(v) {
    var name = (OS_MODES.filter(function (x) { return x[0] === v; })[0] || [0, v])[1];
    ask({ title: "切换到 " + name + " 风格？", text: "此风格已暂停开发，不再修复问题或添加新功能，部分内容可能无法正常显示或使用。建议使用 Visual Studio Code 或 Claude Desktop 风格。", ok: "仍然切换" })
      .then(function (ok) { if (ok) setv("os", v, true); else applySettings(); }); // 不换：设置页里那一格回到原来的
  }
  // 发布的默认值 = 作者自己用着的那一套（2026-09-29 照 ~/.paimon/studio.json 抄的）：做完通知、界面用系统字、活动栏精致、布局紧凑、标题栏不放地址放总览、
  //   不要状态栏 / 缩略图 / 路径导航。名字、头像、语言这些个人的不抄
  var SET_DEF = { linkOpen: "builtin", chatWidth: "efficient", agentNotify: "done", lang: "auto", ui: "tui", os: "vscode", devFeatures: false, claudeTheme: "system", claudeChatFont: "system", claudeMotion: "system", settingsDesc: "key", callMe: "", fullName: "", avatar: "github", statusLine: "global", defaultShell: "zsh", macDock: "bottom", macDockSize: 52, macMagnify: true, macAutoHide: false, macWidgets: true, macWall: "pub-sunset", claudeGroupByDate: true, claudeGroupBy: "connector", claudeStatus: "active", claudeEnv: [], claudeSort: "activity", claudeDots: true, claudeTime: false, claudeGroupOf: {}, claudeGroupOrder: [], claudeCards: "auto", ptTabBar: "auto", ptTitle: true, uiFont: "system", agentFont: "auto", codeFont: "", transcriptSize: "medium", tabBar: "multiple", tabBarPos: "top", editorActions: "tabbar", toolbarHidden: {}, toolbarShown: {}, codeLineNumbers: true, codeScroll: "line", activityPos: "side", activitySize: "compact", sideBarPos: "left", panelAlign: "center", quickInput: "top", density: "compact", activityItems: { agents: true, search: true, extensions: true, manage: true }, appLauncher: "menu", extensions: {}, connectors: {}, uiTui: "claude-code", uiGui: "claude-app", titleBar: { address: false, layout: true, newTab: false, overview: true }, colorScheme: "auto", highlightScheme: "auto", highlightLight: "auto", highlightDark: "auto", fontSize: 12, statusBar: false, minimap: "hide", activityBar: true, breadcrumbs: false, fullAddress: false };
  var SET_ABOUT = {
    colorScheme: "配色方案：auto（跟随系统）或方案 ID（paimon-dark、paimon-light、dark-gray、solarized-dark、solarized-light），也可以自定义：{ \"type\": \"dark\", \"colors\": {…}, \"terminal\": {…} }",
    highlightScheme: "（旧的，只认自定义颜色 { \"k\": \"#…\" }）代码高亮现在分浅色、深色两套：见 highlightLight、highlightDark",
    highlightLight: "浅色模式下代码语法高亮的配色（文件与对话中的代码块）：auto（跟随配色方案）或 vscode-light、github-light、paimon-light、solarized-light（深色的几种也行）",
    highlightDark: "深色模式下代码语法高亮的配色：auto（跟随配色方案）或 vscode-dark、monokai、one-dark、dracula、github-dark、solarized-dark（浅色的几种也行）",
    fullAddress: "地址栏平时是否显示完整地址（关：只显示站点，如 local.claude；点进地址栏总是完整地址）",
    ui: "界面：tui（终端界面，同 Claude Code 的 TUI）、gui（图形界面，同 Claude Desktop）；Agent 的运行时不变",
    extensions: "已安装的扩展（在「扩展」视图中勾选安装）：{ \"claude-code\": true }",
    titleBar: "顶栏上显示哪些（顶栏右键可改）：address 地址栏、layout 布局控件、newTab 新建标签页、overview 标签页概览",
    activityItems: "活动栏上显示哪些图标（活动栏右键可改）：agents、search、extensions、manage",
    codeLineNumbers: "代码文件左侧的行号", codeScroll: "代码文件的滚动：line（按行，同终端里的对话）、smooth（平滑）",
    fontSize: "终端与对话的字号（px）", statusBar: "窗口底部的状态栏", minimap: "对话、终端与文件右侧的缩略图：show（始终显示）、scroll（仅手动滚动时浮现）、transparent（透明：无背景与边框，悬停时显示滑块）、hide（隐藏）", activityBar: "窗口最左侧的活动栏（左下角 ⚙ 为管理菜单）", breadcrumbs: "标签栏下方的路径导航（现在在哪：Agent › 会话、文件夹 › 文件）",
  };
  var SET = Object.assign({}, SET_DEF, store("st-settings", {}));
  var fontAt = 0; // 这个窗口记着的字号是什么时候定的（setv、读设置文件）：和 localStorage 的 tsu-font-at 比谁新（见 applySettings）
  // 字号：这台设备上次用的（⌘+ / ⌘- 调过、设置里改过的都记在 tsu-font）比默认值可信——开页面时就用它，不先按 13 画一遍再缩放
  (function () { var f0 = +localStorage.getItem("tsu-font"), st0 = store("st-settings", {}); if (f0 && st0.fontSize === undefined) SET.fontSize = f0; })();
  if (SET.ui === "macos") { SET.ui = "gui"; SET.os = "macos"; } // 以前「界面风格」里的 macOS：现在是应用风格
  // 缩略图的默认改成了「仅滚动时显示」：以前存下的是旧默认（show）就换成新的——只换一次（设置文件读到时算数）
  var MIG_MINI = "st-mig-mini";
  var migrateMini = function (o) {
    if (!o || localStorage.getItem(MIG_MINI + "2")) return false;
    var ch = false;
    if (!localStorage.getItem(MIG_MINI) && (o.minimap === "show" || o.minimap === true)) { o.minimap = "scroll"; ch = true; }
    if (o.panelAlign === "left") { o.panelAlign = "center"; ch = true; } // 面板的默认改成「居中」（只在编辑区下面、不伸到主侧栏下）：存下的旧默认换掉，只换一次
    return ch;
  };
  if (migrateMini(SET)) keep("st-settings", SET);
  if (!FLOC()) { localStorage.setItem(MIG_MINI, "1"); localStorage.setItem(MIG_MINI + "2", "1"); }
  // 设置文件：测试用的（本地开发服务器 :8787 上的页面）用另一份——以前测试和你的 App 共用这一份，测试一跑就可能把你调好的字号这些冲掉
  var setFile = function () { var F = FLOC(), i = F && F.info ? F.info() : null; return ((i && i.home) || home()) + "/.paimon/studio" + (location.port === "8787" ? "-dev" : "") + ".json"; };
  var setMtime = 0;
  var SETP = {}; // 预览：菜单里指着的那一种（缩略图的样子）临时用上
  var OS_UI = { claude: "gui", terminal: "tui" }; // 应用风格定了 Agent 显示风格的：Claude App 只有 GUI，Pure Terminal 只有 TUI
  function getv(k, real) {
    if (k === "ui") { var os0 = getv("os", real); if (OS_UI[os0]) return OS_UI[os0]; }
    var v = !real && k in SETP ? SETP[k] : SET[k] === undefined ? SET_DEF[k] : SET[k];
    if (k === "minimap" && typeof v === "boolean") v = v ? "show" : "hide"; // 以前是开 / 关
    if (k === "minimap" && v === "transparent") v = "show"; // 以前的「透明」
    if (k === "settingsDesc" && v !== "all") v = "key"; // 以前还有「跟随应用风格」：现在默认只显示必要的
    // 以前只有一个「高亮配色」：按它是浅色的还是深色的，算作那一边的（另一边跟随配色方案）
    // Claude App 的主题：第一次用的时候照配色方案来（自动 → 跟随系统，浅色的 → 浅色，深色的 → 深色）；之后各管各的
    if (k === "claudeTheme" && SET[k] === undefined && !(!real && k in SETP)) { var cs0 = SET.colorScheme; v = !cs0 || cs0 === "auto" ? "system" : typeof cs0 === "object" ? (cs0.type === "light" ? "light" : "dark") : SCHEMES && SCHEMES[cs0] ? SCHEMES[cs0].type : "system"; }
    if ((k === "highlightLight" || k === "highlightDark") && SET[k] === undefined && !(!real && k in SETP)) { var hs = SET.highlightScheme; if (typeof hs === "string" && HLS && HLS[hs] && (HLS[hs].type === "light") === (k === "highlightLight")) v = hs; }
    return v;
  }
  function setv(k, v, sure) {
    if (k === "os" && OS_FROZEN[v] && !sure && (getv("os", true) || "vscode") !== v) return frozenAsk(v); // 暂停开发的风格：先问一句
    if (k === "fontSize") fontAt = Date.now();
    SET[k] = v;
    keep("st-settings", SET);
    applySettings();
    if (k === "appLauncher") { allWins().forEach(function (w) { syncAct(w); }); if (STUDIO.apps && STUDIO.apps.dock) STUDIO.apps.dock(); }
    if (k === "claudeTheme" || k === "colorScheme" || k === "os") document.dispatchEvent(new Event("st-theme-mode")); // 深浅色跟不跟系统变了：窗口那边（native.js）跟上
    if (FLOC()) writeKey(k);
  }
  // 写设置文件：只改这一项——先读文件里现在的，把这一项改上再写回去。以前整份写这个页面记着的那一套：另一个窗口（藏着的不读文件）、
  //   测试用的 App（同一个文件，它自己记着旧的）随便改一项，就把别处刚改的冲掉了（⌘+ 调大的字号，重启后又回去了）。
  //   文件里别的项和这里记着的不一样（别处改过）：顺手跟上
  var wq = Promise.resolve();
  function writeKey(k) {
    wq = wq.then(function () {
      return FLOC().read(setFile()).then(function (b) { try { var j = JSON.parse(new TextDecoder().decode(b)); return j && typeof j === "object" && !Array.isArray(j) ? j : null; } catch (e) { return null; } }, function () { return null; }).then(function (cur) {
        if (!cur) return FLOC().write(setFile(), settingsText());
        var v = k === "ui" ? (SET.ui !== undefined ? SET.ui : SET_DEF.ui) : getv(k, true), moved = false;
        Object.keys(cur).forEach(function (x) { if (x !== k && JSON.stringify(cur[x]) !== JSON.stringify(SET[x])) { SET[x] = cur[x]; moved = true; } });
        if (v === undefined) delete cur[k]; else cur[k] = v;
        if (moved) { keep("st-settings", SET); applySettings(); }
        return FLOC().write(setFile(), JSON.stringify(cur, null, 2) + "\n");
      }).then(function () { return FLOC().stat(setFile()); }).then(function (st) { if (st) setMtime = st.mtime; }).catch(function () {});
    });
  }
  function settingsText() {
    var o = {};
    // 写进文件的是用户自己选的：不带预览着的（previewSet），也不带应用风格定死的（Claude App 里 ui 读出来总是 gui——
    // 以前把它写进了文件，回到 VS Code 就变成了 GUI）
    Object.keys(SET_DEF).forEach(function (k) { o[k] = k === "ui" ? (SET.ui !== undefined ? SET.ui : SET_DEF.ui) : getv(k, true); });
    Object.keys(SET).forEach(function (k) { if (!(k in o)) o[k] = SET[k]; });
    return JSON.stringify(o, null, 2) + "\n";
  }
  // 文件在别处改了（在编辑器里改、agent 改）：读回来，马上用上
  // 第一次读设置文件：页面一起来就读（以前等 2 秒一次的定时器——界面已经露出来了才换成你的字号，看得见跳一下）；读完了界面才露出来（live.js 等 settingsReady）
  var setReadyRes = null, setReady = new Promise(function (r) { setReadyRes = r; });
  var markReady = function () { if (setReadyRes) { var r = setReadyRes; setReadyRes = null; r(); } };
  setTimeout(function () { loadSettingsFile(); }, 0); // local.js 在前面，TSU_LOCAL 这时已经有了
  // 新设备借 Mac 用（iPhone、iPad）：第一次照那台 Mac 的设置整份抄一份（全名、头像、风格、布局……同 clone），之后各管各的（这边改的不回写 Mac，Mac 改的也不再抄过来）。
  //   抄过的记在 vs-cloned-mac（哪台 Mac）；最多等 4 秒（Mac 一时连不上就先用自己的，下次打开再抄）
  //   名字、称呼、头像（同一个人）每次打开都照 Mac 的
  function cloneFromMac() {
    var N = window.nadosNative, L = LOC(), key = "vs-cloned-mac", mac = (N && N.mac) || "1";
    if (!N || !N.remote || !L) return Promise.resolve();
    var all = localStorage.getItem(key) !== mac;
    var job = (L.ready || Promise.resolve()).then(function () { var h = home(); if (!h) throw new Error("no home"); return L.read(h + "/.paimon/studio.json"); }).then(function (b) {
      var j = JSON.parse(new TextDecoder().decode(b));
      if (!j || typeof j !== "object" || Array.isArray(j)) return;
      var ch = false;
      Object.keys(j).forEach(function (k) { if ((all || PERSONAL.indexOf(k) >= 0) && JSON.stringify(SET[k]) !== JSON.stringify(j[k])) { SET[k] = j[k]; ch = true; } });
      if (ch) { keep("st-settings", SET); applySettings(); }
      if (all) localStorage.setItem(key, mac);
    }).catch(function () { /* 读不到：先用这台设备自己的，下次打开再抄 */ });
    return Promise.race([job, new Promise(function (r) { setTimeout(r, 4000); })]);
  }
  function loadSettingsFile() {
    var F = FLOC();
    if (!F) { if (!setReadyRes) return; return cloneFromMac().then(markReady, markReady); }
    (F.ready || Promise.resolve()).then(function () { return F.stat(setFile()); }).then(function (st) {
      if (!st) return F.write(setFile(), settingsText()).then(function () { return F.stat(setFile()); }).then(function (s2) { if (s2) setMtime = s2.mtime; });
      if (st.mtime === setMtime) return;
      setMtime = st.mtime;
      return F.read(setFile()).then(function (b) {
        try { var j = JSON.parse(new TextDecoder().decode(b)); if (j && typeof j === "object" && !Array.isArray(j)) { var mig = migrateMini(j); localStorage.setItem(MIG_MINI, "1"); localStorage.setItem(MIG_MINI + "2", "1"); var fzAt = +localStorage.getItem("tsu-font-at") || 0, fzNow = +localStorage.getItem("tsu-font"); if (fzAt > st.mtime && fzNow && j.fontSize !== fzNow) { j.fontSize = fzNow; setTimeout(function () { writeKey("fontSize"); }, 0); } /* ⌘+ ⌘- 刚调过、文件比它旧：用调的那个（localStorage，几个窗口共用；不是这个窗口记着的，它可能是旧的），写回文件 */ SET = Object.assign({}, SET_DEF, j); fontAt = Math.max(fzAt, st.mtime); var fz = fzNow; if (fz && !localStorage.getItem("tsu-font-mig1")) { localStorage.setItem("tsu-font-mig1", "1"); if (+(j.fontSize || SET_DEF.fontSize) === SET_DEF.fontSize && fz !== SET_DEF.fontSize) { SET.fontSize = fz; setTimeout(function () { setv("fontSize", fz); }, 0); } } /* 以前 ⌘+ / ⌘- 只记在这台设备上、没写进设置：文件里还是默认的 13 时，一次性补进去 */ keep("st-settings", SET); applySettings(); if (mig) { setv("minimap", j.minimap); setv("panelAlign", j.panelAlign); } if (window.TSU_EXT) TSU_EXT.refresh(); document.dispatchEvent(new Event("st-settings-changed")); } } catch (e) { /* 写坏了：保留上一次好的 */ }
      });
    }).catch(function () {}).then(markReady); // 文件没变 / 读不到：也算读过了
  }
  setInterval(function () { if (!document.hidden) loadSettingsFile(); }, 2000);

  // ======== 第一次打开（新装的 App）：先选样子——两种推荐的（Visual Studio Code + 终端界面、Claude Desktop）大大地摆着，
  //   「Visual Studio Code + 图形界面」一行小字放在下面（不推荐）；以后在 设置 › 通用 里随时换。设置文件读到了、里面没选过应用风格才问 ========
  var ART_VS = '<svg viewBox="0 0 120 72" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="1" y="1" width="118" height="70" rx="6"/><path d="M12 1v70M40 1v70M40 12h79M40 50h79"/><rect x="45" y="17" width="40" height="3" rx="1.5" fill="currentColor" stroke="none" opacity=".5"/><rect x="45" y="24" width="60" height="3" rx="1.5" fill="currentColor" stroke="none" opacity=".35"/><rect x="45" y="31" width="50" height="3" rx="1.5" fill="currentColor" stroke="none" opacity=".35"/><rect x="45" y="56" width="30" height="3" rx="1.5" fill="currentColor" stroke="none" opacity=".35"/><rect x="16" y="8" width="18" height="2.5" rx="1.2" fill="currentColor" stroke="none" opacity=".4"/><rect x="16" y="14" width="14" height="2.5" rx="1.2" fill="currentColor" stroke="none" opacity=".3"/><rect x="16" y="20" width="16" height="2.5" rx="1.2" fill="currentColor" stroke="none" opacity=".3"/></svg>';
  var ART_CA = '<svg viewBox="0 0 120 72" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="1" y="1" width="118" height="70" rx="6"/><path d="M30 1v70M88 1v70"/><rect x="6" y="9" width="18" height="2.5" rx="1.2" fill="currentColor" stroke="none" opacity=".4"/><rect x="6" y="15" width="14" height="2.5" rx="1.2" fill="currentColor" stroke="none" opacity=".3"/><rect x="6" y="21" width="16" height="2.5" rx="1.2" fill="currentColor" stroke="none" opacity=".3"/><rect x="52" y="10" width="30" height="8" rx="4" fill="currentColor" stroke="none" opacity=".25"/><rect x="36" y="24" width="44" height="3" rx="1.5" fill="currentColor" stroke="none" opacity=".4"/><rect x="36" y="31" width="38" height="3" rx="1.5" fill="currentColor" stroke="none" opacity=".35"/><rect x="36" y="56" width="46" height="9" rx="4.5"/><rect x="92" y="6" width="23" height="28" rx="3"/><rect x="92" y="38" width="23" height="28" rx="3"/></svg>';
  function firstRun(force) {
    if (!force && (!termapp() || SET.os !== undefined || localStorage.getItem("st-first-style"))) return;
    if (document.querySelector(".st-first")) return;
    var box = document.createElement("div");
    box.className = "st-firstwin";
    var card = function (id, title, desc, art, rec) { return '<button type="button" class="st-fcard" data-fs="' + id + '"><span class="st-fart">' + art + "</span><b>" + esc(title) + (rec ? '<i class="st-frec">' + esc("推荐") + "</i>" : "") + "</b><span>" + esc(desc) + "</span></button>"; };
    box.innerHTML = '<div class="st-fh">' + esc("选择 Vibing Studio 的样子") + '</div><div class="st-fsub">' + esc("以后随时能在 设置 › 通用 里换") + '</div><div class="st-fcards">' +
      card("vscode-tui", "Visual Studio Code", "工作台：侧栏、标签页、面板；对话同 Claude Code 的终端界面", ART_VS, true) +
      card("claude", "Claude Desktop", "同 Claude 桌面 App：会话列表、图形界面的对话、右边的卡片", ART_CA, true) + "</div>" +
      '<button type="button" class="st-fother" data-fs="vscode-gui">' + esc("Visual Studio Code + 图形界面（不推荐）") + "</button>";
    var M = modalOpen(box, { cls: "st-first" });
    box.addEventListener("click", function (e) {
      var b = e.target.closest("[data-fs]");
      if (!b) return;
      var v = b.dataset.fs;
      localStorage.setItem("st-first-style", v);
      if (v === "claude") setv("os", "claude"); else { setv("os", "vscode"); setv("ui", v === "vscode-gui" ? "gui" : "tui"); }
      modalClose(M);
      setTimeout(function () { if (window.TSU_WELCOME) TSU_WELCOME.open(); }, 400); // 选完外观：开一次欢迎页（能做什么、连上没有、快捷键）
    });
    var f0 = box.querySelector(".st-fcard"); if (f0) f0.focus();
  }
  var frT = setInterval(function () { if (!LOC()) { clearInterval(frT); return; } if (!setMtime) return; clearInterval(frT); firstRun(); }, 1000); // 设置文件读到（或刚建好）以后看一眼

  // ======== 配色方案：一套颜色管整个窗口（工具栏、标签、侧栏、终端、页面）========
  var SCHEMES = {
    // 名字说人话：深色 / 浅色（默认那一对，纯黑 / 纯白底）、深灰 / 浅灰（同 VS Code）、柔和深色 / 柔和浅色（低对比的青蓝 / 米黄，就是 Solarized）；id 不变，选过的照旧
    "paimon-dark": { name: "深色", desc: "默认深色（纯黑）", type: "dark", colors: { bg: "#000000", bg2: "#131313", bg3: "#1c1c1c", line: "#242424", fg: "#d6d6d6", hi: "#ffffff", dim: "#808080", faint: "#4a4a4a", accent: "#b1b9f9", onAccent: "#000000", orange: "#d77757", green: "#4eba65", red: "#ff6b80", blue: "#6eaaff", yellow: "#e5c07b" } },
    "paimon-light": { name: "浅色", desc: "默认浅色（纯白）", type: "light", colors: { bg: "#ffffff", bg2: "#f2f2f2", bg3: "#e9e9e9", line: "#dddddd", fg: "#1a1a1a", hi: "#000000", dim: "#8a8a8a", faint: "#c8c8c8", accent: "#5a67d8", onAccent: "#ffffff", orange: "#c4613d", green: "#2e8b57", red: "#d20f39", blue: "#286ec8", yellow: "#a07800" } },
    "dark-gray": { name: "深灰", desc: "Visual Studio Code 深色（Dark Modern）", type: "dark", colors: { bg: "#1f1f1f", bg2: "#181818", bg3: "#313131", line: "#2b2b2b", fg: "#cccccc", hi: "#ffffff", dim: "#9d9d9d", faint: "#555555", accent: "#0078d4", onAccent: "#ffffff", focus: "#0078d4", orange: "#d77757", green: "#4eba65", red: "#f48771", blue: "#4daafc", yellow: "#e5c07b" },
      terminal: { background: "#1f1f1f" } },
    "light-gray": { name: "浅灰", desc: "Visual Studio Code 浅色（Light Modern）", type: "light", colors: { bg: "#ffffff", bg2: "#f8f8f8", bg3: "#ffffff", line: "#e5e5e5", fg: "#3b3b3b", hi: "#1f1f1f", dim: "#6e6e6e", faint: "#b5b5b5", accent: "#005fb8", onAccent: "#ffffff", focus: "#005fb8", orange: "#b35900", green: "#2ea043", red: "#c72e0f", blue: "#005fb8", yellow: "#895503" },
      terminal: { background: "#ffffff" } },
    "solarized-dark": { name: "柔和深色", desc: "Solarized 深色", type: "dark", hl: "solarized-dark", colors: { bg: "#002b36", bg2: "#073642", bg3: "#0a3c48", line: "#0e4a57", fg: "#93a1a1", hi: "#fdf6e3", dim: "#657b83", faint: "#586e75", accent: "#268bd2", onAccent: "#fdf6e3", orange: "#cb4b16", green: "#859900", red: "#dc322f", blue: "#268bd2", yellow: "#b58900" },
      terminal: { background: "#002b36", foreground: "#93a1a1", cursor: "#93a1a1", black: "#073642", red: "#dc322f", green: "#859900", yellow: "#b58900", blue: "#268bd2", magenta: "#d33682", cyan: "#2aa198", white: "#eee8d5",
        brightBlack: "#586e75", brightRed: "#cb4b16", brightGreen: "#859900", brightYellow: "#b58900", brightBlue: "#839496", brightMagenta: "#6c71c4", brightCyan: "#93a1a1", brightWhite: "#fdf6e3" } },
    "solarized-light": { name: "柔和浅色", desc: "Solarized 浅色", type: "light", hl: "solarized-light", colors: { bg: "#fdf6e3", bg2: "#eee8d5", bg3: "#e6dfc8", line: "#dcd4bc", fg: "#586e75", hi: "#002b36", dim: "#93a1a1", faint: "#c9c2ab", accent: "#268bd2", onAccent: "#fdf6e3", orange: "#cb4b16", green: "#859900", red: "#dc322f", blue: "#268bd2", yellow: "#b58900" },
      terminal: { background: "#fdf6e3", foreground: "#586e75", cursor: "#586e75", black: "#073642", red: "#dc322f", green: "#859900", yellow: "#b58900", blue: "#268bd2", magenta: "#d33682", cyan: "#2aa198", white: "#eee8d5",
        brightBlack: "#002b36", brightRed: "#cb4b16", brightGreen: "#586e75", brightYellow: "#657b83", brightBlue: "#839496", brightMagenta: "#6c71c4", brightCyan: "#93a1a1", brightWhite: "#fdf6e3" } },
  };
  // ======== 高亮配色：代码里的颜色（关键字 k、类型 / 声明 d、函数 f、字符串 s、注释 c、数字 n、属性 / 参数 p、变量 v、标题 h、链接 / 属性名 a）========
  // 文件页（查看、编辑）和对话里的代码块都用它；auto = 跟着配色方案（方案自己配了就用它的，不然深色 Monokai、浅色 Paimon 浅色）
  var HLS = {
    "vscode-dark": { name: "Dark+", desc: "Visual Studio Code 默认深色", type: "dark", c: { k: "#c586c0", d: "#569cd6", f: "#dcdcaa", s: "#ce9178", c: "#6a9955", n: "#b5cea8", p: "#9cdcfe", v: "#9cdcfe", h: "#569cd6", a: "#9cdcfe" } },
    "monokai": { name: "Monokai", type: "dark", c: { k: "#f92672", d: "#66d9ef", f: "#a6e22e", s: "#e6db74", c: "#75715e", n: "#ae81ff", p: "#fd971f", v: "#f8f8f2", h: "#66d9ef", a: "#a6e22e" } },
    "one-dark": { name: "One Dark", type: "dark", c: { k: "#c678dd", d: "#c678dd", f: "#61afef", s: "#98c379", c: "#7f848e", n: "#d19a66", p: "#e06c75", v: "#e06c75", h: "#e06c75", a: "#d19a66" } },
    "dracula": { name: "Dracula", type: "dark", c: { k: "#ff79c6", d: "#ff79c6", f: "#50fa7b", s: "#f1fa8c", c: "#6272a4", n: "#bd93f9", p: "#ffb86c", v: "#f8f8f2", h: "#bd93f9", a: "#50fa7b" } },
    "github-dark": { name: "GitHub 深色", type: "dark", c: { k: "#ff7b72", d: "#ff7b72", f: "#d2a8ff", s: "#a5d6ff", c: "#8b949e", n: "#79c0ff", p: "#ffa657", v: "#ffa657", h: "#79c0ff", a: "#7ee787" } },
    "solarized-dark": { name: "柔和深色", type: "dark", c: { k: "#859900", d: "#859900", f: "#268bd2", s: "#2aa198", c: "#586e75", n: "#d33682", p: "#cb4b16", v: "#268bd2", h: "#cb4b16", a: "#6c71c4" } },
    "vscode-light": { name: "Light+", desc: "Visual Studio Code 默认浅色", type: "light", c: { k: "#af00db", d: "#0000ff", f: "#795e26", s: "#a31515", c: "#008000", n: "#098658", p: "#001080", v: "#001080", h: "#0000ff", a: "#001080" } },
    "github-light": { name: "GitHub 浅色", type: "light", c: { k: "#cf222e", d: "#cf222e", f: "#8250df", s: "#0a3069", c: "#6e7781", n: "#0550ae", p: "#953800", v: "#953800", h: "#0550ae", a: "#116329" } },
    "paimon-light": { name: "浅色", type: "light", c: { k: "#d7005f", d: "#0086b3", f: "#508200", s: "#a07800", c: "#8c8773", n: "#7d3cc8", p: "#c86400", v: "#1a1a1a", h: "#5a67d8", a: "#5a67d8" } },
    "solarized-light": { name: "柔和浅色", type: "light", c: { k: "#859900", d: "#859900", f: "#268bd2", s: "#2aa198", c: "#93a1a1", n: "#d33682", p: "#cb4b16", v: "#268bd2", h: "#cb4b16", a: "#6c71c4" } },
  };
  // 现在用哪一套：浅色时用「浅色模式」那一套、深色时用「深色模式」那一套（以前写在文件里的自定义颜色 {k: …} 照旧优先）
  function hlOf(id, sc) {
    sc = sc || schemeOf();
    if (id === undefined) { var old = getv("highlightScheme"); id = old && typeof old === "object" ? old : getv(sc.type === "light" ? "highlightLight" : "highlightDark"); }
    if (id && typeof id === "object") return { name: "自定义", c: Object.assign({}, HLS["vscode-dark"].c, id) };
    if (!HLS[id]) id = sc.hl || (sc.type === "light" ? "paimon-light" : "monokai");
    return HLS[id];
  }
  function applyHL(h) {
    var c = (h || hlOf()).c;
    Object.keys(c).forEach(function (k) { root.style.setProperty("--hl-" + k, c[k]); });
  }
  // TTU 画的代码（对话里的代码块、文件预览）颜色是写死的 Dark+ / Light+：认出这几种颜色，换成变量，跟着高亮配色走
  var TTU_HL = { "249,38,114": "k", "102,217,239": "d", "166,226,46": "f", "230,219,116": "s", "117,113,94": "c", "190,132,255": "n", "253,151,31": "p",
    "215,0,95": "k", "0,134,179": "d", "80,130,0": "f", "160,120,0": "s", "140,135,115": "c", "125,60,200": "n", "200,100,0": "p" };
  function hlHtml(h) { return String(h).replace(/color:rgb\((\d+),(\d+),(\d+)\)/g, function (m, r, g, b) { var k = TTU_HL[r + "," + g + "," + b]; return k ? "color:var(--hl-" + k + ")" : m; }); }
  var darkMQ = matchMedia("(prefers-color-scheme: dark)");
  var SCHEME_PAIR = { "dark-gray": "light-gray", "light-gray": "dark-gray", "paimon-dark": "paimon-light", "paimon-light": "paimon-dark", "solarized-dark": "solarized-light", "solarized-light": "solarized-dark" };
  // 某个模式下用的配色方案：现在的方案就是这个模式的就用它，不然用它的另一半（深灰 ↔ 浅灰），都没有就 Paimon 的
  function schemeForMode(mode) {
    var cs = getv("colorScheme");
    if (typeof cs === "string" && SCHEMES[cs]) { if (SCHEMES[cs].type === mode) return SCHEMES[cs]; if (SCHEME_PAIR[cs] && SCHEMES[SCHEME_PAIR[cs]]) return SCHEMES[SCHEME_PAIR[cs]]; }
    else if (cs && typeof cs === "object" && (cs.type === "light" ? "light" : "dark") === mode) return schemeOf(cs);
    return SCHEMES[mode === "light" ? "paimon-light" : "paimon-dark"];
  }
  function schemeOf(id) {
    // Claude App 风格有它自己的「主题」（跟随系统 / 浅色 / 深色）：只管 Claude App，不动 VS Code 的配色方案
    if (id === undefined && (getv("os") || "vscode") === "claude") { var ct = getv("claudeTheme"); return schemeForMode(ct === "light" || ct === "dark" ? ct : darkMQ.matches ? "dark" : "light"); }
    id = id === undefined ? getv("colorScheme") : id;
    if (id && typeof id === "object") return { name: "自定义", type: id.type === "light" ? "light" : "dark", colors: Object.assign({}, SCHEMES[id.type === "light" ? "paimon-light" : "paimon-dark"].colors, id.colors || {}), terminal: id.terminal };
    if (!SCHEMES[id]) id = darkMQ.matches ? "paimon-dark" : "paimon-light";
    return SCHEMES[id];
  }
  var hexA = function (c, a) { var m = /^#([0-9a-f]{6})$/i.exec(c); if (!m) return c; var n = parseInt(m[1], 16); return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")"; };
  // 两个颜色按比例混（t = 0 是 a，1 是 b）：悬停、你说的话的底色这些从方案的底色和字色里调出来，换哪个方案都看得清
  var mix = function (a, b, t) {
    var p = /^#([0-9a-f]{6})$/i.exec(a), q = /^#([0-9a-f]{6})$/i.exec(b);
    if (!p || !q) return a;
    var x = parseInt(p[1], 16), y = parseInt(q[1], 16), ch = function (sh) { var u = (x >> sh) & 255, v = (y >> sh) & 255; return Math.round(u + (v - u) * t); };
    return "#" + [16, 8, 0].map(function (sh) { return ("0" + ch(sh).toString(16)).slice(-2); }).join("");
  };
  function applySettings(preview, hlPreview) {
    var sc = preview || schemeOf(), c = sc.colors, r = root.style;
    // 换配色：这一下里所有东西一起换——先关掉所有过渡（不然有的立刻变、有的 .12s .25s 慢慢淡过去，看着东一块西一块不同步），换完、样式算好了再开
    var scSig = sc.type + JSON.stringify(c) + JSON.stringify(sc.terminal || {}), theming = lastScSig !== null && scSig !== lastScSig;
    lastScSig = scSig;
    if (theming) root.classList.add("st-theming");
    applyHL(hlPreview || hlOf(undefined, sc));
    ["bg", "bg2", "bg3", "line", "fg", "hi", "dim", "faint", "orange", "green", "red", "blue", "yellow"].forEach(function (k) { r.setProperty("--st-" + k, c[k]); });
    r.setProperty("--st-lav", c.accent);
    r.setProperty("--st-focus", c.focus || c.blue); // 输入框的焦点框、滑块、已修改的竖线（VS Code 的两套用 VS Code 的蓝）
    r.setProperty("--st-onacc", c.onAccent);
    r.setProperty("--st-sel", hexA(c.accent, sc.type === "light" ? 0.12 : 0.16));
    var lt = sc.type === "light";
    root.classList.add("st-nosel"); // 界面本身的字（标签、按钮、菜单、目录……）一律选不中；对话、终端、文件内容、设置里的值（路径、版本、账号、用量）照常能选
    root.classList.toggle("st-gui", getv("ui") === "gui"); // Agent 显示风格 GUI：对话、快速查看、仪表盘也是图形的样子
    OS_MODES.forEach(function (x) { root.classList.toggle("st-os-" + x[0], (getv("os") || "vscode") === x[0]); }); // 应用风格
    // 底部面板开没开：每种风格各记各的（Claude App 的卡片也放在面板里——在那边开了卡片，回到 VS Code 不会跟着冒出终端、Agent 活动那一块）
    var osNow = getv("os") || "vscode";
    if (L.panelOs !== osNow) {
      L.panelBy = L.panelBy || {};
      if (L.panelOs) L.panelBy[L.panelOs] = !!L.panel;
      var pWant = !!L.panelBy[osNow], pCh = !!L.panel !== pWant;
      L.panel = pWant; L.panelOs = osNow; saveL();
      if (pCh) setTimeout(function () { allWins().forEach(function (w) { try { renderPanel(w); layBar(w); } catch (e) { /* 这一格还没搭好 */ } }); }, 0);
    }
    root.classList.toggle("st-macos", getv("os") === "macos"); // macOS：桌面、窗口、程序坞（macos.js）
    root.classList.toggle("st-tabs-single", getv("tabBar") === "single"); // 标签栏外观：单个标签页（只显示当前的）
    root.classList.toggle("st-tabs-hidden", getv("tabBar") === "hidden"); // 标签栏外观：隐藏
    root.classList.toggle("st-tabs-bottom", getv("tabBarPos") === "bottom"); // 标签栏位置：底部
    root.classList.toggle("st-pt-tabs", getv("ptTabBar") === "always"); // Pure Terminal：标签栏始终显示
    root.classList.toggle("st-pt-notitle", !getv("ptTitle")); // Pure Terminal：标题栏不显示标题
    ["left", "right", "center", "justify"].forEach(function (a) { root.classList.toggle("st-pa-" + a, getv("panelAlign") === a); }); // 面板对齐
    root.classList.toggle("st-act-compact", getv("activitySize") === "compact"); // 活动栏大小：精致（窄一点、图标小一点）；宽裕是默认
    root.classList.toggle("st-qcenter", getv("quickInput") === "center"); // 快速输入（命令面板）在中间
    root.classList.toggle("st-compact", getv("density") === "compact"); // 布局密度：紧凑
    var noLn = getv("codeLineNumbers") === false; // 代码文件的行号（设置 › 外观、标签栏 ··· 菜单）：关了就藏起行号那一栏，编辑器重新量宽度
    if (root.classList.contains("st-noln") !== noLn) { root.classList.toggle("st-noln", noLn); Object.keys(EDS || {}).forEach(function (p) { EDS[p].forEach(function (x) { if (x.api && x.api.view) x.api.view.requestMeasure(); }); }); }
    // Claude App 自己的：动画（减少：流式输出和界面上的动画都不播）、对话字体（GUI 对话的字）——只在 Claude App 风格下起作用
    root.classList.toggle("st-reduced", getv("os") === "claude" && getv("claudeMotion") === "reduced");
    r.setProperty("--ca-chat-font", CHAT_FONTS[getv("claudeChatFont")] || CHAT_FONTS.system);
    applyTitle();
    r.setProperty("--st-hover", c.hover || mix(c.bg, c.fg, lt ? 0.07 : 0.12)); // 列表里悬停的那行（同 VS Code 的 list.hoverBackground，要看得出来）
    r.setProperty("--st-hover2", mix(c.bg, c.fg, lt ? 0.13 : 0.2)); // 按钮按下 / 更重一点的悬停
    r.setProperty("--st-active", c.active || mix(c.bg, c.fg, lt ? 0.11 : 0.19)); // 选中的那行：一块实的底色（同 VS Code 资源管理器里选中的文件），字不变色
    // 你说的话、工具详情的底色：深色的原来是 24%（#333 压在纯黑上，一条条很重，整页看着脏——用户：白天的很美、夜间的脏）；
    //   按看上去的深浅对齐浅色的那一档（浅色 8% ≈ 亮度差 7，深色 13% ≈ 亮度差 11：暗处要稍多一点才看得出）
    r.setProperty("--st-ask", c.ask || mix(c.bg, c.fg, lt ? 0.08 : 0.13));
    r.setProperty("--st-prompt", c.prompt || mix(c.bg, lt ? "#000000" : "#ffffff", lt ? 0.06 : 0.216)); // 你说的话的底：同 Claude Code（黑底上是 55 灰，白底上是 240 灰）
    r.setProperty("--st-pill", mix(c.bg, c.fg, lt ? 0.08 : 0.22)); // 浮在对话上的小块（「跳到底部」）：还是要看得出来
    r.setProperty("--st-canvas", c.canvas || c.bg2); // 窗口的底：和边栏一样的灰（边栏、编辑区是放在它上面的圆角卡片，靠边线分开）
    r.setProperty("--st-shadow", lt ? "0 8px 24px rgba(0, 0, 0, 0.16)" : "0 10px 32px rgba(0, 0, 0, 0.5)"); // 弹出来的（菜单、选择器、浮动窗口）的投影：浅色方案淡一些
    r.setProperty("--st-fs", Math.max(10, Math.min(18, (+getv("fontSize") || 12) - 1)) + "px");
    // 字体：代码字体（终端、编辑器、TUI）；界面字体（跟随应用风格：VS Code、Pure Terminal 用等宽，Claude App、macOS 用系统字体）；GUI 对话的字号
    var mono = monoStack(), uf = getv("uiFont"), osf = getv("os") || "vscode";
    var sys = '-apple-system, BlinkMacSystemFont, "PingFang SC", system-ui, sans-serif';
    r.setProperty("--st-mono", mono);
    var uiProp = uf === "system" || (uf !== "mono" && (osf === "claude" || osf === "macos"));
    r.setProperty("--st-font", uiProp ? sys : mono);
    root.classList.toggle("st-uiprop", uiProp); // 界面字是比例字：Agents 树不用等宽格子画（live.js renderTree），见 fonts.css
    var af = getv("agentFont"), agentProp = af === "system" || (af !== "mono" && getv("ui") === "gui"); // Agent 界面字：跟随显示方式 = TUI 等宽、GUI 系统字体
    r.setProperty("--st-agent-font", agentProp ? sys : mono); // Agent 自己的界面（任务一家子、子 Agent、分屏的标题、上下文卡片、GUI 整个对话）；见 fonts.css
    r.setProperty("--st-guifont", uf === "mono" ? mono : sys); // 图形界面（GUI、Agent Finder 的 GUI 样子）的界面字：系统字体，界面字体选了等宽就等宽
    r.setProperty("--st-fk", String((+getv("fontSize") || 12) / 12)); // 字号设置的比例（默认 13 = 1）：写死像素的界面（Agent Finder 等）乘它，跟着设置变大变小
    r.setProperty("--gv-fs", { small: "13px", medium: "14px", large: "15.5px" }[getv("transcriptSize")] || "14px");
    r.setProperty("--gv-colw", { classic: "680px", efficient: "880px", max: "1400px" }[getv("chatWidth")] || "880px"); // 对话那一栏的宽度（字的宽度，不算两边的边距）：经典 = Claude Desktop 的
    if (mono !== lastMono) { lastMono = mono; setTimeout(function () { allWins().forEach(function (w) { if (w.st) w.st.terms.forEach(function (t) { t.term.options.fontFamily = mono; }); }); allPanes().forEach(function (p) { if (p.setFont) p.setFont(+getv("fontSize") || 13); }); fitAll(); }, 0); }
    var light = sc.type === "light";
    // 终端、网页桌面原来那两个外观开关都跟着配色方案走（不再各管各的）
    if (localStorage.getItem("tsu-term") !== (light ? "light" : "dark")) localStorage.setItem("tsu-term", light ? "light" : "dark");
    if (root.classList.contains("light") !== light) { root.classList.toggle("light", light); localStorage.setItem("tsu-theme", light ? "light" : "dark"); }
    allWins().forEach(function (w) { w.el.classList.toggle("tl", light); });
    // 字号（⌘+ / ⌘- / ⌘0 和设置里的「字号」同一个值）：localStorage 的 tsu-font 是几个窗口共用的、最新调的那个（tsu-font-at 是什么时候调的）。
    //   这个窗口记着的比它旧（别的窗口刚调过、这个窗口藏着没读设置文件）：跟上它，不能反过来拿旧的盖回去（以前这样把调大的字号改回 12）；
    //   这个窗口的更新（设置里刚改了字号）：照这个窗口的
    var lsFont = +localStorage.getItem("tsu-font"), lsFontAt = +localStorage.getItem("tsu-font-at") || 0;
    if (lsFont && lsFont !== +getv("fontSize")) {
      if (lsFontAt > fontAt) { SET.fontSize = lsFont; fontAt = lsFontAt; keep("st-settings", SET); }
      else if (window.TSU_APP && TSU_APP.setFont) TSU_APP.setFont(+getv("fontSize"));
    } else if (!lsFont && window.TSU_APP && TSU_APP.setFont) TSU_APP.setFont(+getv("fontSize"));
    // 对话（TUI 画出来的字、左边的会话树）只在真的影响它们的设置变了时整段重画：深浅、字体、字号、应用风格、显示方式、语言。
    //   以前任何一项设置一动（包括同是深色的两套配色之间换、开关路径导航）都把开着的每个对话整段重画——几千行的对话一个就要一两百毫秒，换个颜色卡半秒。
    //   同深浅的配色之间换：颜色都是 CSS 变量，不用重画
    var rSig = [light, mono, uf, af, osf, getv("ui"), getv("fontSize"), getv("transcriptSize"), getv("lang")].join("|");
    if (rSig !== lastRSig) { lastRSig = rSig; allPanes().forEach(function (p) { if (p.renderNow) p.renderNow(); }); allWins().forEach(function (w) { if (w.side) w.side.render(true); }); }
    allWins().forEach(function (w) { if (w.st) { w.st.terms.forEach(function (t) { t.term.options.theme = xtermTheme(); }); } renderSoon(w); });
    if (T() && T().applyUI) T().applyUI(); // 界面换了：开着的 agent 换外壳
    if (theming) { void getComputedStyle(root).color; setTimeout(function () { root.classList.remove("st-theming"); }, 40); } // 样式按新颜色算好（这时没有过渡），再把过渡打开
    if (theming) document.dispatchEvent(new Event("st-theme")); // 画在 canvas 上的（缩略图）照新颜色重画
  }
  var lastMono = null, lastScSig = null, lastRSig = "";
  function fitAll() { allWins().forEach(function (w) { if (w.st) fitTerms(w); }); }
  // 代码字体：设置里写了就用它（前面加上），后面跟着 Monaco、中文用苹方
  function monoStack() { var f = String(getv("codeFont") || "").trim().replace(/["\\;{}]/g, ""); return (f ? '"' + f + '", ' : "") + 'Monaco, Menlo, "DejaVu Sans Mono", "Ubuntu Mono", "Noto Sans Mono", "PingFang SC", "Noto Sans Mono CJK SC", "Noto Sans CJK SC", monospace'; } // 后面几个是 Linux 上常见的（Linux 版 App）
  // 这台 Mac 上装了的等宽字体（设置里「代码字体」的候选）：量一下宽度，和回退字体不一样就是有
  function monoFonts() {
    var c = document.createElement("canvas").getContext("2d"), probe = "mmmmmmmmmmlli10OoWw", base = {};
    ["monospace", "serif"].forEach(function (b) { c.font = "16px " + b; base[b] = c.measureText(probe).width; });
    return ["Monaco", "Menlo", "SF Mono", "JetBrains Mono", "Fira Code", "Source Code Pro", "Cascadia Code", "IBM Plex Mono", "Hack", "Iosevka", "Roboto Mono", "Ubuntu Mono", "Courier New", "PT Mono", "Andale Mono"]
      .filter(function (f) { return ["monospace", "serif"].some(function (b) { c.font = '16px "' + f + '", ' + b; return c.measureText(probe).width !== base[b]; }); });
  }
  // 终端的颜色：方案里写了就用它的，没写的用 Paimon 深 / 浅的那套
  function xtermTheme(sc, where) {
    sc = sc || schemeOf();
    var base = T() && T().baseXterm ? T().baseXterm(sc.type === "light") : {};
    // 底下面板里的终端：底色同面板、侧栏（bg2，同 VS Code 的 terminal.background 默认跟 panel.background）；
    //   编辑区的终端标签页（where = "editor"）：同 TUI 的会话，编辑区的底（深色黑、浅色白）——同一块地方不两种底色
    var bg = where === "editor" ? sc.colors.bg : sc.colors.bg2;
    return Object.assign({}, base, { foreground: sc.colors.fg }, sc.terminal || {}, { background: bg, cursorAccent: bg });
  }
  // 别的窗口 ⌘+ / ⌘- 调了字号（localStorage 的 tsu-font 变了）：这个窗口马上跟上，只改这边记着的和画面，不再写文件（调的那个窗口写过了）
  window.addEventListener("storage", function (e) {
    if (e.key !== "tsu-font" || !e.newValue || +e.newValue === +getv("fontSize")) return;
    var px = +e.newValue;
    SET.fontSize = px; fontAt = +localStorage.getItem("tsu-font-at") || Date.now();
    keep("st-settings", SET);
    applySettings();
    allPanes().forEach(function (p) { if (p.setFont) p.setFont(px); });
    document.dispatchEvent(new CustomEvent("tsu-font", { detail: px }));
  });
  darkMQ.addEventListener("change", function () { if (getv("os") === "claude" ? getv("claudeTheme") === "system" : getv("colorScheme") === "auto") applySettings(); });
  // 选配色方案（同 VS Code 的 Color Theme ⌘K ⌘T）：上下移动就先换上看看，回车定下，Esc 换回原来的
  function byType(table, cur, auto) {
    var items = [auto];
    ["light", "dark"].forEach(function (type) {
      Object.keys(table).filter(function (id) { return table[id].type === type; }).forEach(function (id) { items.push({ id: id, title: table[id].name, desc: table[id].desc || "", group: type === "light" ? "浅色" : "深色", on: id === cur }); });
    });
    return items;
  }
  function pickScheme(tw) {
    tw = tw || (T() && T().front());
    var cur = getv("colorScheme");
    quickPick(tw, {
      placeholder: "选择配色方案",
      items: byType(SCHEMES, cur, { id: "auto", title: "跟随系统", desc: "当前：" + SCHEMES[darkMQ.matches ? "paimon-dark" : "paimon-light"].name, group: "系统", on: cur === "auto" }),
      preview: function (it) { applySettings(schemeOf(it.id)); },
      pick: function (it) { setv("colorScheme", it.id); },
      cancel: function () { applySettings(); },
    });
  }
  function pickHighlight(tw) { // 选的是现在这个模式（浅色 / 深色）用的那一套
    tw = tw || (T() && T().front());
    var sc = schemeOf(), key = sc.type === "light" ? "highlightLight" : "highlightDark", cur = getv(key);
    quickPick(tw, {
      placeholder: sc.type === "light" ? "选择高亮配色（浅色模式）" : "选择高亮配色（深色模式）", sample: true,
      items: byType(HLS, cur, { id: "auto", title: "跟随配色方案", desc: "当前：" + hlOf("auto", sc).name, group: "自动", on: cur === "auto" }),
      preview: function (it) { applyHL(hlOf(it.id)); },
      pick: function (it) { setv(key, it.id); },
      cancel: function () { applyHL(); },
    });
  }
  // 选高亮配色时框底下那段代码（按 JS 高亮）
  function sampleCode() {
    var src = ["// 读取配置并返回默认值", "import { readFile } from \"fs/promises\";", "export async function load(path = \"./studio.json\") {", "  const text = await readFile(path, \"utf8\");", "  return { ...JSON.parse(text), fontSize: 13 };", "}"];
    if (!window.TSU_HL) return esc(src.join("\n"));
    var st = "", L = TSU_HL.LANG && (TSU_HL.LANG.js || TSU_HL.LANG.javascript);
    return src.map(function (l) { var r = TSU_HL.line(l, st, L); st = r[1]; return r[0]; }).join("\n");
  }
  // 通用的快速选择（同 VS Code 的 Quick Pick：命令面板、配色方案、高亮配色同一个框）：上面输入框（打字筛），下面一列；
  // 分组（item.group）：组和组之间一条线，组名在这组第一行的最右边；每项 title + 淡色的 desc，现在用的那个打 ✔。
  // 键盘 ↑↓ 移动（有 preview 就先换上看看）、回车定下、Esc 不换；鼠标只高亮（悬停不移动、不预览），点一下才选
  function quickPick(tw, o) {
    if (PAL) { var p1 = PAL; PAL = null; try { p1.close(); } catch (e) { /* 已经关了 */ } }
    var old = document.querySelector(".st-palette");
    if (old) old.remove();
    var box = document.createElement("div"), sel = Math.max(0, o.items.findIndex(function (x) { return x.on; })), shown = o.items;
    box.className = "st-palette";
    box.innerHTML = '<div class="st-pin"><span class="st-lav">❯</span><input spellcheck="false" autocomplete="off" placeholder="' + esc(o.placeholder || "") + '"></div><div class="st-plist"></div>' + (o.sample ? '<pre class="st-psample">' + sampleCode() + "</pre>" : "");
    palHost(tw, box, function () { close(false); });
    var input = box.querySelector("input"), listEl = box.querySelector(".st-plist"), done = false;
    var paint = function (preview) {
      var last = null;
      listEl.innerHTML = shown.map(function (it, i) {
        var g = it.group || "", first = g !== last;
        last = g;
        return (first && i ? '<div class="st-psep"></div>' : "") + '<div class="st-prow' + (i === sel ? " on" : "") + '" data-i="' + i + '"><span class="st-ptr">' + (i === sel ? "❯" : " ") + '</span><span class="st-cut st-pt">' + esc(it.title) + (it.desc ? '<span class="st-pdesc">' + esc(it.desc) + "</span>" : "") + "</span>" + (it.on ? '<span class="st-pchk">✔</span>' : "") + '<span class="st-pgrp">' + (first ? esc(g) : "") + "</span></div>";
      }).join("") || '<div class="st-dim st-prow">  无匹配结果</div>';
      var on = listEl.querySelector(".on"); if (on) on.scrollIntoView({ block: "nearest" });
      if (preview && o.preview && shown[sel]) o.preview(shown[sel]);
    };
    var close = function (ok) { if (done) return; done = true; palDone(box); box.remove(); if (!ok && o.cancel) o.cancel(); var P = tw.ws.active; if (P) P.focus(); };
    input.addEventListener("input", function () { var q = input.value.trim().toLowerCase(); shown = o.items.filter(function (it) { return !q || (it.title + " " + (it.desc || "") + " " + (it.group || "") + " " + (it.id || "")).toLowerCase().indexOf(q) >= 0; }); sel = 0; paint(true); });
    input.addEventListener("keydown", function (e) {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); paint(true); }
      else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); paint(true); }
      else if (e.key === "Enter") { e.preventDefault(); var it = shown[sel]; close(true); if (it) o.pick(it); }
      else if (e.key === "Escape") { e.preventDefault(); close(false); }
      e.stopPropagation();
    });
    listEl.addEventListener("mousedown", function (e) { var r = e.target.closest("[data-i]"); if (r) { e.preventDefault(); var it = shown[+r.dataset.i]; close(true); if (it) o.pick(it); } });
    input.addEventListener("blur", function () { setTimeout(function () { if (!done && document.activeElement !== input && !(document.activeElement && box.contains(document.activeElement))) close(false); }, 150); });
    paint(false);
    input.focus();
  }
  // 「高亮配色」下面：一段带增删的代码（用现在的高亮颜色画；Claude App、macOS 的设置里有）
  // ---- 代码外观（同 Claude App）：浅色、深色各选一套高亮（现在是浅色还是深色就用哪一套）；各自下面一张预览——用它自己那套颜色和那个模式的底色画，
  //      一段 diff：删掉、加上的行一行淡红 / 淡绿，改了的那几个词再深一点（逐词）----
  var HL_MODE_KEY = { light: "highlightLight", dark: "highlightDark" }; // 两个模式各用哪一套配色方案：schemeForMode（在 schemeOf 旁边）
  // 一段 HTML 里第 a 到 b 个字（不算标签）包一个 <mark>（逐词的增删）
  function markRange(html, a, b) {
    if (!(b > a)) return html;
    var box = document.createElement("div"), pos = 0, nodes = [], n;
    box.innerHTML = html;
    var tw0 = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    while ((n = tw0.nextNode())) nodes.push(n);
    nodes.forEach(function (t) {
      var s = pos, e = pos + t.data.length; pos = e;
      if (e <= a || s >= b) return;
      var mid = t.splitText(Math.max(a, s) - s); mid.splitText(Math.min(b, e) - Math.max(a, s));
      var m = document.createElement("mark"); m.className = "ss-wd"; mid.parentNode.replaceChild(m, mid); m.appendChild(mid);
    });
    return box.innerHTML;
  }
  function hlCard(mode) {
    var sc = schemeForMode(mode), h = hlOf(getv(HL_MODE_KEY[mode]), sc), c = sc.colors || {};
    var vars = Object.keys(h.c).map(function (k) { return "--hl-" + k + ":" + h.c[k]; }).concat(["--cb:" + c.bg, "--cf:" + c.fg, "--cl:" + c.line, "--cd:" + c.dim]).join(";");
    var A = '  return "Hello, " + name;', Bv = "  return `Hello, ${name}!`;", p = 0, s = 0;
    while (p < A.length && p < Bv.length && A[p] === Bv[p]) p++;
    while (s < A.length - p && s < Bv.length - p && A[A.length - 1 - s] === Bv[Bv.length - 1 - s]) s++;
    var L = [["1", " ", "function greet(name: string) {"], ["2", "-", A, p, A.length - s], ["2", "+", Bv, p, Bv.length - s], ["3", " ", "}"]];
    var hl = function (x) { try { return window.TSU_HL && TSU_HL.line ? TSU_HL.line(x, "", TSU_HL.LANG && (TSU_HL.LANG.typescript || TSU_HL.LANG.javascript))[0] : esc(x); } catch (e) { return esc(x); } };
    return '<div class="ss-code ss-code-' + mode + '" style="' + esc(vars) + '" aria-hidden="true">' + L.map(function (l) {
      return '<div class="ss-cl' + (l[1] === "-" ? " del" : l[1] === "+" ? " add" : "") + '"><span class="ss-ln">' + l[0] + '</span><span class="ss-sg">' + (l[1] === " " ? "" : l[1]) + "</span><code>" + (l[3] != null ? markRange(hl(l[2]), l[3], l[4]) : hl(l[2])) + "</code></div>";
    }).join("") + "</div>";
  }
  // 两边的选项：这个模式的配色排前面，另一种的放后面（也能选）
  var hlOpts = function (mode) { var ids = Object.keys(HLS); return [["auto", "跟随配色方案"]].concat(ids.filter(function (id) { return HLS[id].type === mode; }).concat(ids.filter(function (id) { return HLS[id].type !== mode; })).map(function (id) { return [id, HLS[id].name]; })); };
  var SYS_FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", system-ui, sans-serif';
  var setChange = function (k, v) {
    // 对话宽度选「最大利用」：先问一句（铺满以后一行字很长，不是每个人都想要）
    if (k === "chatWidth" && v === "max" && getv("chatWidth") !== "max") {
      return ask({ title: "使用全部宽度显示对话？", text: "「最大利用」会使对话占满编辑区宽度（最大约 1400 像素，两侧保留边距）。行较长时阅读可能较吃力，可随时切换回「效率」。", ok: "开启" }).then(function (ok) { if (ok) setv(k, v); else redrawSettings(); });
    }
    setv(k, v); if (k === "lang" && window.TSU_I18N) TSU_I18N.set(v);
    if (k === "menuBarIcon") menuBarSync();
  };
  // 菜单栏图标（同 Claude 的 App）：默认显示；关掉窗口不退出（Agent、命令照常跑），从菜单栏或程序坞叫回来，退出在图标的菜单、⌘Q 里
  function menuBarSync() { var N = window.nadosNative; if (N && N.call) N.call("statusItem.set", { on: getv("menuBarIcon") !== false }).catch(function () { /* 老版本的 App 没有：不管 */ }); }
  setTimeout(menuBarSync, 1500);
  if (window.nadosNative && nadosNative.on) nadosNative.on("status.settings", function () { var tw = allWins()[0]; if (tw && STUDIO.settings) STUDIO.settings(tw, "general"); });
  // 通用：每个应用风格都一样的——应用风格本身、显示语言；第二级「通用 › 高级」：设置说明、开发者功能
  addSettings("general", {
    title: "通用", icon: "⚙", desc: "应用风格、显示风格、配色、语言、翻译、通知",
    fields: function (tw) {
      var pull = function (sec) { if (!SECTIONS[sec]) return []; try { return secFields(sec, tw, true).filter(function (f) { return pulledTo(sec, f.key); }).map(function (f) { return Object.assign({}, f, { _sec: sec, must: true }, PULL_DESC[f.key] ? { desc: PULL_DESC[f.key] } : {}, f.key === "ui" ? { label: "Agent 显示风格" } : {}); }); } catch (e) { return []; } }; // 在通用里：「显示风格」写全是谁的；说明都显示（短的一句）
      var look = pull("appearance"), ui = look.filter(function (f) { return f.key === "ui"; }), theme = look.filter(function (f) { return f.key !== "ui"; }), tr0 = pull("view");
      return [
        { key: "os", label: "应用风格", desc: "Studio 的整体界面风格", must: true, kind: "seg", options: osModesNow().map(function (x) { return [x[0], x[1]]; }), value: getv("os"), def: SET_DEF.os },
      ].concat(ui, theme, [
        { key: "lang", label: "显示语言", desc: "菜单、设置和提示使用的语言", must: true, kind: "seg", options: [["auto", LANG_AUTO()], ["en", "English"], ["zh", "简体中文"]], value: getv("lang"), def: SET_DEF.lang },
      ], tr0.length ? [{ head: "翻译" }].concat(tr0, [{ head: "" }]) : [], [
        { key: "linkOpen", label: "打开链接", desc: "在对话和终端中点按链接时使用的浏览器", must: true, kind: "seg", options: [["builtin", "内置浏览器"], ["system", "系统浏览器"]], value: getv("linkOpen"), def: SET_DEF.linkOpen },
        { key: "askPopup", label: "提问卡片", desc: "会话问你问题而你没在看它时，在窗口中间弹出问题卡片，可直接回答；按 Esc 稍后再答", must: true, kind: "toggle", value: getv("askPopup") === true, def: false },
        window.nadosNative ? { key: "askFront", label: "提问时切到前台", desc: "会话问你问题时，如果 Vibing Studio 在后台，把窗口切到最前面", must: true, kind: "toggle", value: getv("askFront") === true, def: false } : null,
        window.nadosNative ? { key: "menuBarIcon", label: "菜单栏图标", desc: "在菜单栏中显示 Vibing Studio 的图标。关闭窗口时 App 继续在后台运行，Agent 和命令不受影响", must: true, kind: "toggle", value: getv("menuBarIcon") !== false, def: true } : null,
        { key: "agentNotify", label: "通知", desc: "App 不在前台时，Agent 完成任务后发送系统通知", must: true, kind: "seg", options: [["off", "关"], ["done", "Agent 完成时"]], value: getv("agentNotify") || "off", def: SET_DEF.agentNotify },
        { key: "settingsDesc", label: "设置说明", desc: "在每项设置下方显示说明", page: "advanced", kind: "seg", options: [["key", "仅必要项"], ["all", "详细"]], value: getv("settingsDesc"), def: SET_DEF.settingsDesc },
        { key: "devFeatures", label: "开发者功能", desc: "显示已暂停开发的应用风格（macOS、Pure Terminal）" + (ssStyle() === "claude" ? "" : "（⌃⌘3、⌃⌘4）"), must: true, page: "advanced", kind: "toggle", value: !!getv("devFeatures"), def: false }, // Claude App 里不提快捷键
        // 配置文件：现在这一套存一份（~/.paimon/profiles/）、换成存过的一份、回到默认——名字、头像这些个人的不跟着换
        LOC() ? { key: "profSave", label: "设置配置文件", desc: "将当前设置保存为配置文件，以便之后切换", must: true, page: "advanced", kind: "button", text: "保存…", act: "profSave" } : null,
        LOC() ? { key: "profLoad", label: "切换配置文件", desc: "切换前建议先保存当前设置", must: true, page: "advanced", kind: "button", text: "选择…", act: "profLoad" } : null,
        { key: "profReset", label: "恢复默认设置", desc: "名称和头像将保留", must: true, page: "advanced", kind: "button", text: "恢复…", act: "profReset" },
      ].filter(Boolean), remoteFields());
    },
    change: function (k, v, tw) {
      if (k === "remoteOn" && window.TSU_REMOTE_HOST) { TSU_REMOTE_HOST.set(!!v); return redrawSettings(); }
      if (k === "remotePolicy" && window.TSU_REMOTE_HOST && TSU_REMOTE_HOST.setPolicy) { Promise.resolve(TSU_REMOTE_HOST.setPolicy(v)).then(redrawSettings); return; }
      return setChange(k, v, tw);
    },
    action: function (what, tw) { if (/^revoke:/.test(what) && window.TSU_REMOTE_HOST) { TSU_REMOTE_HOST.revoke(what.slice(7)); return redrawSettings(); } profileAction(what, tw); },
  });
  // 其他设备使用这台 Mac（remote-host.js / RemoteHost.swift）：App 里才有——开关、连入时怎么确认、现在谁连着、允许过的设备（能移除）
  var REMOTE_POLICIES = [["first", "首次连接时确认"], ["every", "每次连接都确认"], ["code", "首次连接时确认并输入验证码"], ["auto", "直接允许"]];
  function remoteFields() {
    var H = window.TSU_REMOTE_HOST;
    if (!H) return [];
    if (!H.watched) { H.watched = true; H.watch(function () { redrawSettings(); }); }
    var on = H.on(), now = H.clients(), ok = H.approved(), pol = H.policy ? H.policy() : "";
    var en = !!(window.TSU_I18N && TSU_I18N.lang && TSU_I18N.lang() === "en"), tz = function (c, e) { return en ? e : c; };
    var when = function (ms) { var d = new Date(ms); return isNaN(d.getTime()) ? "" : d.toLocaleDateString(en ? "en-US" : "zh-CN", { year: "numeric", month: "short", day: "numeric" }); };
    return [{ head: "其他设备" },
      { key: "remoteOn", label: "其他设备使用这台 Mac", desc: "允许登录同一个 GitHub 账号的其他 Mac、iPhone、iPad 和网页端连接这台 Mac；终端、文件和会话都在这台 Mac 上运行", must: true, kind: "toggle", value: on, def: false },
      on && pol ? { key: "remotePolicy", label: "其他设备连接时", desc: "每台设备用自己的密钥识别，只知道设备号无法冒充。「直接允许」：登录同一个 GitHub 账号的设备不再确认", must: true, kind: "seg", options: REMOTE_POLICIES, value: pol, def: "first" } : null,
      on ? { key: "remoteState", label: "状态", kind: "info", value: H.connected() ? (now.length ? tz("已连接 · ", "Connected · ") + now.map(function (c) { return c.name; }).join(tz("、", ", ")) : tz("已连接，等待其他设备", "Connected, waiting for other devices")) : tz("正在连接…", "Connecting…") } : null,
    ].concat(ok.length ? [{ head: "允许过的设备" }] : [], ok.map(function (d) {
      var bits = [d.at ? tz("允许于 ", "Allowed ") + when(d.at) : "", d.last && d.last - (d.at || 0) > 60000 ? tz("上次连接 ", "Last connected ") + when(d.last) : "", d.loc || ""].filter(Boolean);
      return { key: "rv-" + d.id, label: d.name || d.id, desc: bits.join(" · "), must: true, kind: "button", text: "移除", act: "revoke:" + d.id };
    })).filter(Boolean);
  }
  // ---- 设置的配置文件 ----
  var PROF_DIR = function () { return home() + "/.paimon/profiles"; }, PERSONAL = ["callMe", "fullName", "avatar"];
  function useProfile(j) { // 换成这一套（没写的项用默认）；个人的几项留着现在的
    var mine = {};
    PERSONAL.forEach(function (k) { if (SET[k] !== undefined) mine[k] = SET[k]; });
    SET = Object.assign({}, SET_DEF, j || {}, mine);
    keep("st-settings", SET);
    applySettings();
    document.dispatchEvent(new Event("st-theme-mode"));
    if (FLOC()) FLOC().write(setFile(), settingsText()).then(function () { return FLOC().stat(setFile()); }).then(function (st) { if (st) setMtime = st.mtime; }).catch(function () {});
    redrawSettings();
  }
  function profileAction(what, tw) {
    var say = function (t, m) { if (window.TSU_DESK && TSU_DESK.alert) TSU_DESK.alert({ title: t, message: m || "", icon: "none", buttons: [{ label: "好", role: "default" }] }); };
    var p2 = function (n) { return (n < 10 ? "0" : "") + n; };
    if (what === "profSave" && LOC()) {
      var d = new Date(), nm = "设置 " + d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) + " " + p2(d.getHours()) + "." + p2(d.getMinutes()) + ".json", fp = PROF_DIR() + "/" + nm;
      LOC().exec({ cmd: "/bin/mkdir -p " + T().shellEscape(PROF_DIR()) }).then(function () { return LOC().write(fp, settingsText()); }).then(function () { say("已存好这一套设置。", tilde(fp)); }, function (e) { say("没存成。", String((e && e.message) || e)); });
      return;
    }
    if (what === "profLoad" && LOC()) {
      LOC().list(PROF_DIR()).then(function (l) { return l || []; }, function () { return []; }).then(function (l) {
        var fs = l.filter(function (x) { return !x.dir && /\.json$/i.test(x.name); }).sort(function (a, b) { return (b.mtime || 0) - (a.mtime || 0); });
        if (!fs.length) return say("还没有存过配置。", "先点「存一份」把现在这一套存下来。");
        quickPick(tw, { placeholder: "选择要切换的配置文件", items: fs.map(function (x) { return { id: x.name, title: x.name.replace(/\.json$/i, ""), desc: tilde(PROF_DIR()) }; }), pick: function (it) {
          LOC().read(PROF_DIR() + "/" + it.id).then(function (b) {
            var j = null;
            try { j = JSON.parse(new TextDecoder().decode(b)); } catch (e) { j = null; }
            if (!j || typeof j !== "object" || Array.isArray(j)) return say("这份配置读不出来。", it.id);
            ask({ title: "切换到「" + it.title + "」？", text: "当前设置将替换为该配置文件（名称和头像保留）。", ok: "切换" }).then(function (ok) { if (ok) useProfile(j); });
          }, function (e) { say("这份配置读不出来。", String((e && e.message) || e)); });
        } });
      });
      return;
    }
    if (what === "profReset") ask({ title: "恢复默认设置？", text: "所有设置将恢复为默认值（名称和头像保留）。建议先保存当前设置。", ok: "恢复" }).then(function (ok) { if (ok) useProfile({}); });
  }
  // 键盘快捷方式（同 VS Code 的 Keyboard Shortcuts，放进设置里）：一行一个命令——名字、在哪儿有用（不是全局的才写）、右边一个个键帽；设置的搜索框直接能搜
  addSettings("keys", {
    title: "键盘快捷方式", icon: "⌨", desc: "查看和配置所有命令的快捷键",
    show: function () { return !root.classList.contains("st-os-claude"); }, // Claude App：不讲快捷键（同以前）
    fields: function () { return keyRows().map(function (r) { return { key: r.title, label: r.title, desc: r.when && r.when !== "全局" ? r.when : "", must: true, kind: "keys", keys: r.keys }; }); },
  });
  // 高级（左边最下面单独一项）：各区标了 page: "advanced" 的项都在这里，按原来的分区分小节；改的时候还是交给原来的分区（_sec）
  addSettings("advanced", {
    title: "高级", icon: "⋯", desc: "设置说明、开发者功能、长行与时间格式",
    fields: function (tw) {
      var out = [];
      secIds(tw).forEach(function (k) {
        if (k === "advanced") return;
        var fs = [];
        try { fs = secFields(k, tw).filter(function (f) { return f && f.page === "advanced"; }); } catch (e) { fs = []; }
        if (!fs.length) return;
        out.push({ head: SECTIONS[k].title });
        fs.forEach(function (f) { out.push(Object.assign({}, f, { page: "", _sec: f._sec || k })); });
      });
      return out;
    },
  });
  // 对话宽度（图形界面的对话那一栏多宽）：最大利用 | 效率（默认）| 经典（Claude Desktop 的经典宽度）；选最大利用要确认一下（setChange）
  var CHAT_W = function () { return { key: "chatWidth", label: "对话宽度", desc: "经典：与 Claude Desktop 一致；效率：每行可显示更多代码", must: true, kind: "seg", options: [["max", "最大利用"], ["efficient", "效率"], ["classic", "经典"]], value: getv("chatWidth") || "efficient", def: SET_DEF.chatWidth }; };
  // 外观：这个应用风格自己的样子（Claude App 是它的主题、对话字体、动画；VS Code 是配色方案、界面字体、字号……），代码外观，Agent 怎么显示（TUI / GUI、外壳）
  addSettings("appearance", {
    title: "外观", icon: "◐", desc: "配色、字体、代码外观与 Agent 显示风格",
    fields: function () {
      var forced = OS_UI[getv("os")], other = forced && UI_MODES.filter(function (x) { return x[0] !== forced; })[0], na = {};
      if (other) na[other[0]] = NA;
      // 外观是这个应用风格自己的：Claude App 是它自己的主题、对话字体、动画（同 Claude App 的 Settings › General）；VS Code 这几种是配色方案、界面字体、字号……——互不影响
      var osName = (OS_MODES.filter(function (x) { return x[0] === (getv("os") || "vscode"); })[0] || [0, ""])[1]; // 小节标题写应用风格的名字：这几项只管这个风格
      var look = (getv("os") || "vscode") === "claude" ? [
        { head: osName },
        { key: "claudeTheme", label: "主题", desc: "浅色、深色或跟随系统", must: true, kind: "seg", options: [["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]], icons: THEME_ICO, value: getv("claudeTheme"), def: SET_DEF.claudeTheme },
        { key: "claudeChatFont", label: "对话字体", kind: "seg", options: [["system", "系统"], ["serif", "衬线"], ["sans", "无衬线"], ["dyslexic", "OpenDyslexic"]], value: getv("claudeChatFont"), def: SET_DEF.claudeChatFont, fontOf: function (v) { return CHAT_FONTS[v] || ""; } },
        { key: "claudeMotion", label: "动画", desc: "减少流式输出和界面中的动画效果", must: true, kind: "seg", options: [["system", "跟随系统"], ["reduced", "减少"]], value: getv("claudeMotion"), def: SET_DEF.claudeMotion },
        CHAT_W(),
      ] : [
        { head: osName },
        { key: "colorScheme", label: "配色方案", desc: "应用于整个窗口", kind: "seg", options: [["auto", "跟随系统"]].concat(Object.keys(SCHEMES).map(function (id) { return [id, SCHEMES[id].name]; })), value: typeof getv("colorScheme") === "object" ? "custom" : getv("colorScheme"), def: SET_DEF.colorScheme },
        { key: "uiFont", label: "应用界面字体", desc: "菜单、侧栏、标签页等界面元素使用的字体", kind: "seg", options: [["auto", "跟随应用风格"], ["system", "系统字体"], ["mono", "等宽字体"]], value: getv("uiFont"), def: SET_DEF.uiFont, fontOf: function (v) { return v === "system" ? SYS_FONT : v === "mono" ? monoStack() : ""; } },
        { key: "agentFont", label: "Agent 界面字体", desc: "Agent 界面使用的字体：任务、子 Agent、底部状态与输入框，以及图形界面（GUI）中的对话", kind: "seg", options: [["auto", "跟随显示方式"], ["system", "系统字体"], ["mono", "等宽字体"]], value: getv("agentFont"), def: SET_DEF.agentFont, os: ["vscode"], fontOf: function (v) { return v === "system" ? SYS_FONT : v === "mono" ? monoStack() : ""; } },
        { key: "fontSize", label: "字号", desc: "界面、对话与终端的字号（像素）", kind: "number", min: 10, max: 20, value: +getv("fontSize"), def: SET_DEF.fontSize },
        { key: "transcriptSize", label: "对话字号", desc: "图形界面（GUI）中对话的字号", kind: "seg", options: [["small", "小"], ["medium", "中"], ["large", "大"]], value: getv("transcriptSize"), def: SET_DEF.transcriptSize, os: ["vscode", "macos"] },
      ];
      return look.concat([
        // 代码外观：浅色、深色各一套高亮，并排两张预览（窄的时候上下放）；下面是代码字体
        { head: "代码外观" },
        { key: "highlightLight", label: "浅色模式", kind: "seg", half: true, options: hlOpts("light"), value: getv("highlightLight"), def: SET_DEF.highlightLight, after: function () { return hlCard("light"); } },
        { key: "highlightDark", label: "深色模式", kind: "seg", half: true, options: hlOpts("dark"), value: getv("highlightDark"), def: SET_DEF.highlightDark, after: function () { return hlCard("dark"); } },
        { key: "codeFont", label: "代码字体", desc: "代码、终端和终端界面（TUI）使用的等宽字体，例如 JetBrains Mono；留空则使用 Monaco", kind: "text", placeholder: "Monaco", value: getv("codeFont"), def: SET_DEF.codeFont, suggest: function () { return monoFonts(); }, fontOf: function (v) { return v ? '"' + String(v).replace(/["\\;{}]/g, "") + '", monospace' : ""; } },
        { key: "codeLineNumbers", label: "行号", desc: "在代码文件左侧显示行号", kind: "toggle", value: getv("codeLineNumbers") !== false, def: true },
        { key: "codeScroll", label: "代码滚动", desc: "按行：滚轮和触控板一次走一整行，手感与终端中的对话一致；平滑：系统的平滑滚动", kind: "seg", options: [["line", "按行"], ["smooth", "平滑"]], value: getv("codeScroll") === "smooth" ? "smooth" : "line", def: SET_DEF.codeScroll },
        // Agent 怎么显示（每个应用风格共用）：终端界面（TUI）还是图形界面（GUI）；应用风格定死了的（Claude App 只有 GUI）另一个灰着，写明「在此应用风格下不可用」。
        // 下面是具体用哪一种外壳（ext.js 的 TSU_WRAPPERS）；任何连接器的会话（Paimon、Claude Code、Codex）都能用它看
        { head: "Agent 显示" },
        { key: "ui", label: "显示风格", desc: forced ? other[1] + " " + NA : "对话怎么显示；Agent 的运行时不变", must: !!forced, kind: "seg", options: UI_MODES, value: getv("ui"), def: forced ? undefined : SET_DEF.ui, na: na },
        (getv("os") || "vscode") !== "claude" && getv("ui") === "gui" ? CHAT_W() : null, // 图形界面才有「对话那一栏」
        (function () { var k = getv("ui") === "gui" ? "gui" : "tui", key = k === "gui" ? "uiGui" : "uiTui", W = window.TSU_WRAPPERS, l = W ? W.list(k) : [], cur = W && W.current(k); return { key: key, label: k === "gui" ? "GUI 外壳" : "TUI 外壳", desc: "以不同外观显示同一会话，适用于 Paimon、Claude Code 和 Codex 的会话", kind: "seg", options: l.map(function (w) { return [w.id, w.name]; }), value: cur ? cur.id : SET_DEF[key], def: SET_DEF[key] }; })(),
      ]);
    },
    change: setChange,
  });
  // 开发者（开了「通用 › 高级 › 开发者功能」才有）：设置文件在哪、用编辑器打开它；暂停开发的应用风格
  addSettings("developer", {
    title: "开发者", icon: "{}", desc: "设置文件与已暂停开发的应用风格",
    show: function () { return !!getv("devFeatures"); },
    fields: function () {
      return [
        { key: "file", label: "设置文件", kind: "info", value: LOC() ? setFile() : "只有在 App 里才有" },
        LOC() && !HYB() ? { key: "json", label: "在编辑器中打开设置文件", kind: "button", text: "打开", act: "json" } : null,
        { key: "paused", label: "暂停开发的应用风格", desc: "可在「通用 › 应用风格」中选择 macOS 和 Pure Terminal", must: true, kind: "info", value: "已显示" },
      ].filter(Boolean);
    },
    action: function (what, tw) { if (what === "json" && LOC() && !HYB()) openFile(tw, setFile()); },
  });
  // ---- 各个应用风格自己的：只在那个风格下出现 ----
  var onOS = function (os) { return function () { return (getv("os") || "vscode") === os; }; };
  addSettings("layout", {
    title: "布局", icon: "▥", order: 7, group: "os", show: onOS("vscode"), desc: "活动栏、侧栏、标签栏、状态栏和标题栏",
    fields: function () {
      return [
        { head: "活动栏与侧栏" },
        { key: "activityBar", label: "活动栏", desc: "显示活动栏", kind: "toggle", value: !!getv("activityBar"), def: true },
        { key: "activityPos", label: "活动栏位置", kind: "seg", options: [["side", "默认"], ["top", "顶部"], ["bottom", "底部"]], value: getv("activityPos"), def: SET_DEF.activityPos },
        { key: "activitySize", label: "活动栏大小", kind: "seg", options: [["normal", "宽裕"], ["compact", "精致"]], value: getv("activitySize"), def: SET_DEF.activitySize },
        { key: "appLauncher", label: "App 启动器", desc: "开始菜单：点活动栏上的 App 按钮弹出一块；程序坞：窗口最下面一排 App，鼠标移到窗口底边时出现", kind: "seg", options: [["menu", "开始菜单"], ["dock", "程序坞"]], value: getv("appLauncher"), def: SET_DEF.appLauncher },
        { key: "sideBarPos", label: "主侧栏位置", kind: "seg", options: [["left", "左侧"], ["right", "右侧"]], value: getv("sideBarPos"), def: SET_DEF.sideBarPos },
        { key: "layButtons", label: "布局按钮", desc: "标题栏右边切换侧栏、面板、浏览器的那几个按钮：精简为一个按钮，点开再选（手机上默认）；经典为全部摆出来", kind: "seg", options: [["concise", "精简"], ["classic", "经典"]], value: layConcise() ? "concise" : "classic", def: layDefault() },
        { head: "编辑区" },
        { key: "tabBar", label: "标签栏外观", desc: "编辑区标签页的显示方式", kind: "seg", options: [["multiple", "多个标签页"], ["single", "单个标签页"], ["hidden", "隐藏"]], value: getv("tabBar"), def: SET_DEF.tabBar },
        { key: "tabBarPos", label: "标签栏位置", kind: "seg", options: [["top", "顶部"], ["bottom", "底部"]], value: getv("tabBarPos"), def: SET_DEF.tabBarPos },
        { key: "editorActions", label: "编辑器操作位置", desc: "拆分、更多等操作按钮的位置", must: true, kind: "seg", options: [["tabbar", "标签栏"], ["titlebar", "标题栏"], ["hidden", "隐藏"]], value: getv("editorActions"), def: SET_DEF.editorActions },
        { key: "breadcrumbs", label: "路径导航", desc: "在标签页下方显示当前位置（如 Agent › 会话、文件夹 › 文件），点按任一层级可返回", must: true, kind: "toggle", value: !!getv("breadcrumbs"), def: true }, // 以前叫「面包屑」（breadcrumbs 的直译，没几个人认得）
        // 缩略图在「对话 › 显示」里（它是对话的）
        { head: "状态栏与标题栏" },
        { key: "statusBar", label: "状态栏", desc: "窗口底部的状态栏", kind: "toggle", value: !!getv("statusBar"), def: true },
        // 标题栏正中那个地址：以前是个开关（「显示完整地址」+ 一句绕口的说明），看不出开和关各是什么样——换成两个选块，直接写两种样子
        { key: "fullAddress", label: "标题栏的地址", kind: "seg", options: [[false, "只显示站点"], [true, "完整地址"]], value: !!getv("fullAddress"), def: false },
      ];
    },
    change: setChange,
  });
  // 墙纸：缩略图（图片、渐变）
  var WALLS = [["pub-sunset", "太浩湖黄昏", "url(pub-sunset.webp) center / cover"], ["pub-emerald", "翡翠湾", "url(pub-emerald.webp) center / cover"], ["graphite", "石墨", "linear-gradient(160deg, #4a4d52, #1d1f22)"], ["black", "黑色", "#000"]];
  addSettings("desktop", {
    title: "桌面与程序坞", icon: "▭", order: 7, group: "os", show: onOS("macos"), desc: "程序坞的位置与大小、桌面墙纸与小组件",
    fields: function () {
      return [
        { head: "程序坞" },
        { key: "macDockSize", label: "大小", desc: "程序坞图标的大小（像素）", kind: "number", min: 32, max: 96, value: +getv("macDockSize"), def: SET_DEF.macDockSize },
        { key: "macMagnify", label: "放大", desc: "指针悬停在程序坞上时放大图标", kind: "toggle", value: !!getv("macMagnify"), def: SET_DEF.macMagnify },
        { key: "macDock", label: "在屏幕上的位置", kind: "seg", options: [["left", "左侧"], ["bottom", "底部"], ["right", "右侧"]], value: getv("macDock"), def: SET_DEF.macDock },
        { key: "macAutoHide", label: "自动隐藏和显示程序坞", kind: "toggle", value: !!getv("macAutoHide"), def: SET_DEF.macAutoHide },
        { head: "桌面" },
        { key: "macWall", label: "墙纸", kind: "swatch", options: WALLS, value: getv("macWall"), def: SET_DEF.macWall },
        { key: "macWidgets", label: "桌面小组件", desc: "在桌面上显示时钟、Agent、余额小组件", kind: "toggle", value: !!getv("macWidgets"), def: SET_DEF.macWidgets },
      ];
    },
    change: setChange,
  });
  addSettings("sidebar", {
    title: "侧边栏与卡片", icon: "▤", order: 7, group: "os", show: onOS("claude"), desc: "会话列表和右侧的工具卡片",
    fields: function () {
      return [
        { key: "claudeGroupBy", label: "会话分组", desc: "边栏中会话的分组方式（也可在边栏的筛选菜单中更改）", kind: "seg", options: [["connector", "按连接器"], ["date", "按日期"], ["status", "按状态"], ["group", "按文件夹"], ["none", "不分组"]], value: getv("claudeGroupBy"), def: SET_DEF.claudeGroupBy },
        { key: "claudeCards", label: "右侧工具卡片", desc: "终端、更改、浏览器卡片", must: true, kind: "seg", options: [["auto", "需要时显示"], ["always", "始终显示"], ["never", "不显示"]], value: getv("claudeCards"), def: SET_DEF.claudeCards },
      ];
    },
    change: setChange,
  });
  addSettings("tabs", {
    title: "标签页与窗口", icon: "▭", order: 7, group: "os", show: onOS("terminal"), desc: "标签栏与窗口标题（与 iTerm 一致）",
    fields: function () {
      return [
        { key: "ptTabBar", label: "标签栏", desc: "与 iTerm 一致", kind: "seg", options: [["auto", "仅一个标签页时隐藏"], ["always", "始终显示"]], value: getv("ptTabBar"), def: SET_DEF.ptTabBar },
        { key: "ptTitle", label: "窗口标题", desc: "在标题栏中间显示当前标签页的标题", kind: "toggle", value: !!getv("ptTitle"), def: SET_DEF.ptTitle },
      ];
    },
    change: setChange,
  });
  // ---- 账户：GitHub 账户（头像、名字）、Agent 怎么称呼你、额度和用量、登录着的设备、退出登录；没登录就是「登录」 ----
  var ACCT = { usage: null, uAt: 0 };
  var money = function (micro) { var y = (+micro || 0) / 1e6; return (y < 0 ? "-¥" : "¥") + Math.abs(y).toFixed(2); }; // 金额是「微元」：1 000 000 = ¥1
  var ago = function (t) {
    var s = Math.max(0, (Date.now() - (+t || 0)) / 1000);
    return s < 90 ? "刚刚" : s < 3600 ? Math.round(s / 60) + "分钟前" : s < 86400 ? Math.round(s / 3600) + "小时前" : Math.round(s / 86400) + "天前";
  };
  function redrawSettings() { // 编辑区里的、浮着的（Claude App 的表单）设置页都重画
    var ps = allPanes().slice();
    document.querySelectorAll(".st-float").forEach(function (f) { if (f.pane && ps.indexOf(f.pane) < 0) ps.push(f.pane); });
    ps.forEach(function (p) { if (p.program && p.program.page === "settings" && p.program.redraw) p.program.redraw(); });
  }
  function acctUsage() {
    if (Date.now() - ACCT.uAt < 60000) return;
    ACCT.uAt = Date.now();
    fetch("/api/usage", { credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j && !j.error) { ACCT.usage = j; redrawSettings(); } }, function () {});
  }
  // ---- 自己的头像（设置 › 账号 › 头像，同 Claude 的 Profile）：GitHub 的照片，或者名字的首字母放在一个圆里——0 是中性灰（同 Claude 的灰圆），
  //      1–5 是几种低饱和的底色（深色、浅色各一套，在 studio.css）。点头像换下一种。显示自己头像的地方都用 avatarHtml（Claude App 左下角、VS Code 的账户按钮、账号页）----
  var AV_N = 6;
  var meNow = function () { var A = window.TSU_AGENTS; return A && A.me ? A.me() : null; };
  // 首字母：全名（设置 › 账号 › 全名）→ 没有就用「你希望 Agent 怎么称呼你」→ 再没有用 GitHub 账号。
  //   中文：三个字以上取后两个字（名：「张可桢」→「可桢」），两个字以下整个用；英文：第一个词、最后一个词的首字母（「Kezhen Zhang」→ KZ；一个词取头两个字母），大写。
  //   正在输入还没存的（AV_LIVE）也算：头像跟着字变
  var AV_LIVE = {};
  function avatarIni() {
    var me = meNow(), pick = function (k) { return String(k in AV_LIVE ? AV_LIVE[k] : getv(k) || "").trim(); };
    var n = pick("fullName") || pick("callMe") || (me && me.loggedIn !== false && me.login) || "";
    if (!n) return "?";
    var han = n.replace(/[^\u3400-\u9fff\uf900-\ufaff]/g, "");
    if (han) return han.length > 2 ? han.slice(-2) : han;
    var ws = n.split(/[\s_.\-]+/).filter(Boolean);
    return (ws.length > 1 ? ws[0].charAt(0) + ws[ws.length - 1].charAt(0) : n.replace(/[^A-Za-z0-9]/g, "").slice(0, 2)).toUpperCase() || "?";
  }
  function avatarNow() {
    var v = String(getv("avatar") || "github"), me = meNow(), m = /^initials:(\d+)$/.exec(v);
    if (!m && me && me.avatar) return { src: me.avatar };
    return { ini: avatarIni(), tint: m ? Math.min(AV_N - 1, +m[1]) : 0 };
  }
  // 头像的 HTML（size：边长 px，不给就按 CSS）；cls：再加的 class
  function avatarHtml(size, cls) {
    var a = avatarNow(), st = size ? ' style="width:' + size + "px;height:" + size + "px;font-size:" + Math.max(8, Math.round(size * 0.4)) + 'px"' : "";
    return '<span class="st-av' + (a.src ? " st-av-img" : " st-av-t" + a.tint) + (cls ? " " + cls : "") + '"' + st + ">" + (a.src ? '<img src="' + esc(a.src) + '" alt="" draggable="false">' : esc(a.ini)) + "</span>";
  }
  // 点一下换哪一个：GitHub 照片（有的话）→ 灰 → 几种颜色 → 回到照片
  function avatarNext() {
    var me = meNow(), list = (me && me.avatar ? ["github"] : []), cur = String(getv("avatar") || "github");
    for (var i = 0; i < AV_N; i++) list.push("initials:" + i);
    if (cur === "github" && !(me && me.avatar)) cur = "initials:0";
    return list[(list.indexOf(cur) + 1) % list.length];
  }
  var SHUFFLE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5h1.8c1.3 0 2.4.7 3.1 1.8l1.9 3.4c.6 1.1 1.8 1.8 3.1 1.8H14M12 9.6l2 1.9-2 1.9M2 11.5h1.8c1 0 1.9-.4 2.5-1.1M14 4.5h-2.1c-1 0-1.9.4-2.5 1.1M12 2.6l2 1.9-2 1.9"/></svg>';
  addSettings("account", {
    title: "账号", icon: "◉", order: 6, group: "general", desc: "GitHub 账号、额度与用量、登录的设备",
    fields: function () {
      var A = window.TSU_AGENTS, me = A && A.me ? A.me() : null, login = me && me.loggedIn !== false && me.login, SY = window.TSU_SYNC;
      if (!login) return [
        { key: "signin", label: "未登录", desc: "登录后，Agent 和会话将与账户同步，可在其他设备上继续使用", must: true, kind: "button", text: "使用 GitHub 登录", act: "login", primary: true },
      ];
      var out = [
        { head: "个人资料" },
        // 同 Claude 的 Profile：头像（点一下换一种）、全名、你希望 Agent 怎么称呼你
        { key: "avatar", label: "头像", kind: "avatar", value: getv("avatar") },
        { key: "fullName", label: "全名", kind: "text", placeholder: "你的全名", value: getv("fullName") || "", def: "" }, // 头像的首字母从这里来
        { key: "callMe", label: "Agent 对你的称呼", desc: "将写入每个 Agent 的系统提示词", kind: "text", placeholder: login, value: getv("callMe") || "", def: "" },
        { key: "login", label: "GitHub 账号", kind: "info", value: login + (me.admin ? " · 管理员" : "") },
        { key: "usageLink", label: "余额与用量", desc: "在「用量」中查看", must: true, kind: "button", text: "查看用量", act: "usage" },
        { key: "passkeys", label: "通行密钥", desc: "用 Touch ID、Face ID 或手机登录，不用每次都经过 GitHub；在浏览器里添加和管理", must: true, kind: "button", text: "管理通行密钥…", act: "passkeys" },
      ];
      if (SY) {
        // 名字、型号都由设备自己认出来（不让改）：这台电脑自己的名字 +「MacBook Air (M2, 2022)」这样的型号，方便分清是哪一台；
        //   同一台机器并成一台、以前版本留下的旧记录不列（TSU_SYNC.deviceList，同「设备」App）
        var dl = SY.deviceList ? SY.deviceList() : [];
        out.push({ head: "登录的设备" });
        dl.slice(0, 9).forEach(function (d) { out.push({ key: d.self ? "devThis" : "dev:" + d.id, label: d.label, desc: d.model && d.model !== d.label ? d.model : "", kind: "info", value: d.self ? "这台设备" : Date.now() - (d.last_seen || 0) < 15 * 60000 ? "在线" : ago(d.last_seen) + "在线" }); });
      } else out.push({ head: "登录的设备" });
      out.push({ key: "logout", label: "在这台设备上退出登录", desc: "Agent 和会话将保留在账户中，重新登录后即可恢复", kind: "button", text: "退出登录", act: "logout" });
      return out;
    },
    change: function (k, v) {
      if (k === "callMe") { delete AV_LIVE.callMe; setv("callMe", String(v || "").trim().slice(0, 40)); }
      else if (k === "fullName") { delete AV_LIVE.fullName; setv("fullName", String(v || "").trim().slice(0, 60)); }
      else if (k === "avatar") setv("avatar", /^(github|initials:\d)$/.test(String(v)) ? String(v) : "github");
    },
    action: function (what, tw) {
      if (what === "logout") location.href = "/auth/logout";
      else if (what === "login") location.href = "/auth/login?next=" + encodeURIComponent(location.pathname + location.search);
      else if (what === "usage") settings(tw, "usage");
      else if (what === "passkeys") openPasskeys();
    },
  });

  // ---- 用量（同 Claude 的 Settings › Usage）：一段一段分开——Paimon 自己的额度（服务器上的账，¥）；每个连接器自己的限额只看这台 Mac 上已经有的：
  //      Codex 最近一次会话记下的 rate_limits（~/.codex/sessions/**/rollout-*.jsonl）；Claude Code 的 5 小时 / 每周限额是它状态行拿到的那份
  //      （~/.claude/statusline-last.json，同状态行上的 5h / 7d），最近 7 天各模型的用量直接从它的记录（~/.claude/projects/**/*.jsonl）算（ccusage.py，增量缓存）。
  //      本机没有就写「没有本地数据」——不去问 Claude / OpenAI 的服务器。
  //      上一次读到的记在本机（tsu-use）：再打开时先显示它（带「x 分钟前」），后台再读新的——不会一直「正在读取…」；读太久（桥忙）算超时，过一会儿再试 ----
  var USE = { st: null, stAt: 0, cx: undefined, cxAt: 0, cxErr: "", cc: undefined, ccAt: 0, lim: undefined, limAt: 0, lok: undefined, lokAt: 0, lokErr: "", lokBusy: false };
  (function () { try { var c = JSON.parse(localStorage.getItem("tsu-use") || "null"); if (c) { if (c.cx) USE.cx = c.cx; if (c.lok) USE.lok = c.lok; if (c.lim) USE.lim = c.lim; } } catch (e) { /* 读不懂 */ } })();
  var useKeep = function () { try { localStorage.setItem("tsu-use", JSON.stringify({ cx: USE.cx || null, lok: USE.lok || null, lim: USE.lim || null })); } catch (e) { /* 满了 */ } };
  var inTime = function (p, ms) { return Promise.race([p, new Promise(function (_, no) { setTimeout(function () { no(new Error("timeout")); }, ms); })]); };
  var shq = function (s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; };
  var homeDir = function () { var i = LOC() && LOC().info && LOC().info(); return (i && i.home) || ""; };
  var readText = function (p, o) { return LOC().read(p, o).then(function (b) { return new TextDecoder().decode(b); }); };
  var fmtTok = function (n) { n = +n || 0; return n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n); };
  var WEEKDAY = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  // 什么时候重置：一天之内写「x 小时 y 分钟后重置」，再远写「周四 20:00 重置」
  function resetsText(sec) {
    var d = sec * 1000 - Date.now();
    if (!(d > 0)) return "已经重置过";
    var m = Math.round(d / 60000);
    if (m < 60) return m + " 分钟后重置";
    if (m < 1440) return Math.floor(m / 60) + " 小时 " + (m % 60) + " 分钟后重置";
    var t = new Date(sec * 1000); return WEEKDAY[t.getDay()] + " " + t.getHours() + ":" + String(t.getMinutes()).padStart(2, "0") + " 重置";
  }
  var winName = function (min) { return min === 10080 ? "每周" : min % 1440 === 0 ? (min / 1440) + " 天" : min % 60 === 0 ? (min / 60) + " 小时" : min + " 分钟"; };
  // Codex：sessions/年/月/日/rollout-时间-id.jsonl——一层层挑名字最大的（名字就是日期），从最新的几个会话的末尾往前找 token_count 里的 rate_limits
  function codexLimits() {
    var base = homeDir() + "/.codex", ls = function (p) { return LOC().list(p).then(function (r) { return Array.isArray(r) ? r : []; }, function () { return []; }); };
    var newest = function (p, dir) { return ls(p).then(function (es) { return es.filter(function (e) { return !!e.dir === dir && (dir ? /^\d+$/.test(e.name) : /^rollout-.*\.jsonl$/.test(e.name)); }).map(function (e) { return e.name; }).sort().reverse(); }); };
    var files = [];
    var walk = function (p, depth) { // 年 → 月 → 日（最多往前找 3 天），收集最新的几个文件
      if (files.length >= 6) return Promise.resolve();
      if (depth === 3) return newest(p, false).then(function (fs) { fs.forEach(function (f) { if (files.length < 6) files.push(p + "/" + f); }); });
      return newest(p, true).then(function (ds) { var i = 0; var next = function () { if (i >= ds.length || i >= 3 || files.length >= 6) return; return walk(p + "/" + ds[i++], depth + 1).then(next); }; return next(); });
    };
    var scan = function (i) {
      if (i >= files.length) return null;
      var f = files[i];
      return LOC().stat(f).then(function (st) {
        var size = (st && st.size) || 0, off = Math.max(0, size - 2000000);
        return readText(f, { offset: off, max: 2000000 }).then(function (txt) {
          var lines = txt.split("\n");
          for (var j = lines.length - 1; j >= (off ? 1 : 0); j--) { // 从读到的那段里最后一行往前（中间截断的第一行不要）
            if (lines[j].indexOf('"rate_limits"') < 0) continue;
            try { var o = JSON.parse(lines[j]), rl = o.payload && o.payload.rate_limits; if (rl && (rl.primary || rl.secondary)) return { rl: rl, at: Date.parse(o.timestamp) || (st && st.mtime) || 0, file: f }; } catch (e) { /* 半行 */ }
          }
          return scan(i + 1);
        });
      }, function () { return scan(i + 1); });
    };
    return walk(base + "/sessions", 0).then(function () { return scan(0); });
  }
  // Claude Code 的订阅方式（~/.claude.json 的 oauthAccount）。它自己的 /stats 缓存（~/.claude/stats-cache.json）不用：只在跑 /stats 时才更新，常常是几周前的
  function claudeLocal() {
    var out = {};
    return readText(homeDir() + "/.claude.json").then(function (t) { try { var j = JSON.parse(t), a = j.oauthAccount || {}; out.billing = a.billingType || ""; out.org = a.organizationName || ""; out.role = a.organizationRole || ""; } catch (e) { /* 读不懂 */ } }, function () {})
      .then(function () { return out.billing ? out : null; });
  }
  // Codex 的限额，一条命令找完（按修改时间最新的 6 个会话记录，各自从末尾找最后一行带 rate_limits 的）：桥只来回一次——
  //   上面那种一层层列目录、一个个读的，桥忙的时候（大的会话记录正在读）一步要等好几秒，页面就一直「正在读取…」
  function codexLimitsFast() {
    var cmd = "cd " + shq(homeDir() + "/.codex/sessions") + " 2>/dev/null || exit 0; for f in $(ls -t */*/*/rollout-*.jsonl 2>/dev/null | head -6); do l=$(tail -c 2000000 \"$f\" | grep '\"rate_limits\":{' | tail -1); if [ -n \"$l\" ]; then printf '%s\\n' \"$l\"; exit 0; fi; done";
    return LOC().exec({ cmd: cmd }).then(function (r) {
      var line = String(r && r.out || "").trim().split("\n").pop();
      if (!line) return null;
      var o = JSON.parse(line), rl = o.payload && o.payload.rate_limits;
      return rl && (rl.primary || rl.secondary) ? { rl: rl, at: Date.parse(o.timestamp) || Date.now() } : null;
    });
  }
  // Claude Code 的 5 小时 / 每周限额：它的状态行命令把拿到的 JSON 存在 ~/.claude/statusline-last.json（rate_limits.five_hour / seven_day 的
  //   used_percentage、resets_at——同它状态行上的 5h / 7d）；没有这个文件就用这边起的 claude -p 报过的（TSU_CLAUDE.limits()）
  function claudeLimits() {
    var f = homeDir() + "/.claude/statusline-last.json", sec = function (v) { v = +v || 0; return v > 1e12 ? v / 1000 : v; };
    return Promise.all([readText(f), LOC().stat(f).then(null, function () { return null; })]).then(function (r) {
      var j = JSON.parse(r[0]), rl = j && j.rate_limits, w = function (x) { return x && typeof x.used_percentage === "number" ? { pct: x.used_percentage, resets: sec(x.resets_at) } : null; };
      if (!rl || !(rl.five_hour || rl.seven_day)) throw new Error("none");
      return { five: w(rl.five_hour), week: w(rl.seven_day), at: (r[1] && r[1].mtime) || Date.now(), src: "statusline" };
    }).then(null, function () {
      var L = window.TSU_CLAUDE && TSU_CLAUDE.limits ? TSU_CLAUDE.limits() : null;
      return L && (L.five != null || L.week != null) ? { five: L.five != null ? { pct: L.five, resets: sec(L.resets5) } : null, week: L.week != null ? { pct: L.week, resets: sec(L.resets7) } : null, at: L.at || 0, src: "cli" } : null;
    });
  }
  // 最近几天各模型用了多少：同目录的 ccusage.py 读 ~/.claude/projects 里的记录（第一次要把最近改过的都读一遍，几百 MB 要十几秒；之后只读新写的）。
  //   本地界面（App 从本机的界面目录读）：直接跑那个文件；从网站 / 开发服务器加载的：取下来经 stdin 交给 python3
  var ccPy = null;
  function claudeUsage() {
    var ui = window.TSU_UI_LOCAL && TSU_UI_LOCAL.dir, py = "PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin python3 ";
    if (!ui) ccPy = ccPy || fetch("studio/ccusage.py", { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("ccusage.py " + r.status); return r.text(); }).then(null, function (e) { ccPy = null; throw e; });
    return (ui ? Promise.resolve(py + shq(ui + "/studio/ccusage.py")) : ccPy.then(function (src) { return "printf %s " + btoa(unescape(encodeURIComponent(src))) + " | /usr/bin/base64 -D | " + py + "-"; })).then(function (cmd) {
      return LOC().exec({ cmd: cmd });
    }).then(function (r) {
      var out = String(r && r.out || "").trim();
      if (!out) throw new Error(String(r && r.err || "").trim().split("\n").pop() || "python3 没有输出");
      return Object.assign(JSON.parse(out), { at: Date.now() });
    });
  }
  // 模型的显示名（同 claude.js）：claude-opus-5-5 → Opus 5.5；claude-haiku-4-5-20251001 → Haiku 4.5
  var ccModel = function (m) { var b = String(m || "").replace(/\[1m\]$/i, "").replace(/-\d{8}$/, ""), x = /^(?:claude-)?(opus|sonnet|haiku|fable)(?:-(\d+)(?:-(\d+))?)?$/i.exec(b); return x ? x[1].charAt(0).toUpperCase() + x[1].slice(1).toLowerCase() + (x[2] ? " " + x[2] + (x[3] ? "." + x[3] : "") : "") : b || "Claude"; };
  var ymd = function (d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  // 最近 7 天（今天和前 6 天，本地日期）：合计、每天、各模型（同一个显示名的并在一起）；会话数是这 7 天里有回复的会话
  function ccWeek(lok) {
    var now = new Date(), w = { n: 0, i: 0, o: 0, cr: 0, cw: 0, tok: 0, ses: 0, days: [], models: [] }, by = {}, ses = {};
    for (var k = 0; k < 7; k++) {
      var d = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - k)), day = (lok.days || {})[d] || {}, dn = 0, dt = 0;
      Object.keys(day).forEach(function (m) {
        var a = day[m], t = a[1] + a[2] + a[3] + a[4], nm = ccModel(m), x = by[nm] = by[nm] || { name: nm, n: 0, tok: 0 };
        x.n += a[0]; x.tok += t; dn += a[0]; dt += t; w.n += a[0]; w.i += a[1]; w.o += a[2]; w.cr += a[3]; w.cw += a[4]; w.tok += t;
      });
      ((lok.sess || {})[d] || []).forEach(function (s) { ses[s] = 1; });
      w.days.push({ d: d, k: k, n: dn, tok: dt });
    }
    w.ses = Object.keys(ses).length;
    w.models = Object.keys(by).map(function (x) { return by[x]; }).sort(function (a, b) { return b.tok - a.tok; });
    return w;
  }
  var dayName = function (x) { if (x.k === 0) return "今天"; if (x.k === 1) return "昨天"; var p = x.d.split("-"), t = new Date(+p[0], +p[1] - 1, +p[2]); return (t.getMonth() + 1) + "月" + t.getDate() + "日 星期" + "日一二三四五六".charAt(t.getDay()); };
  // 读不到的原因（超时：桥忙 / 命令卡住）
  var useErr = function (e) { return e === "timeout" ? "读取超时（这台 Mac 上的文件读取在排队），稍后自动重试" : "读取出错：" + e; };
  function useLoad() {
    var t = Date.now();
    acctUsage();
    if (t - USE.stAt > 300000) { USE.stAt = t; fetch("/api/stats?tz=" + (-new Date().getTimezoneOffset()), { credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j && !j.error) { USE.st = j; redrawSettings(); } }, function () {}); }
    if (!LOC()) return;
    // 读太久（桥忙、命令卡住）算超时：写原因、留着上次读到的，过一会儿（again 毫秒）再试——不会一直「正在读取…」
    var fail = function (k, again) { return function (e) { USE[k + "Err"] = e && e.message === "timeout" ? "timeout" : String(e && e.message || e || "error"); USE[k + "At"] = Date.now() - 60000 + again; redrawSettings(); }; };
    if (t - USE.cxAt > 60000) { USE.cxAt = t; inTime(codexLimitsFast().then(null, function () { return codexLimits(); }), 15000).then(function (x) { USE.cx = x; USE.cxErr = ""; useKeep(); redrawSettings(); }, fail("cx", 15000)); }
    if (t - USE.ccAt > 60000) { USE.ccAt = t; inTime(claudeLocal(), 15000).then(function (x) { USE.cc = x; redrawSettings(); }, function () { if (USE.cc === undefined) USE.cc = null; USE.ccAt = Date.now() - 45000; redrawSettings(); }); }
    if (t - USE.limAt > 20000) { USE.limAt = t; inTime(claudeLimits(), 10000).then(function (x) { USE.lim = x; useKeep(); redrawSettings(); }, function () { if (USE.lim === undefined) USE.lim = null; redrawSettings(); }); }
    if (!USE.lokBusy && t - USE.lokAt > 60000) { USE.lokAt = t; USE.lokBusy = true; inTime(claudeUsage(), 180000).then(function (x) { USE.lokBusy = false; USE.lok = x; USE.lokErr = ""; useKeep(); redrawSettings(); }, function (e) { USE.lokBusy = false; fail("lok", 60000)(e); }); }
  }
  // 一条限额（同 Claude 的 Settings › Usage）：名字、什么时候重置（淡的）；右边一条细的长条、「已用 x%」
  var meter = function (key, label, pct, desc, page) { pct = Math.max(0, Math.min(100, +pct || 0)); return { key: key, label: label, desc: desc, must: true, kind: "meter", pct: pct, text: "已用 " + Math.round(pct) + "%", page: page }; };
  // 用量：两级。第一级一张张卡片（Paimon 额度、Claude Code、Codex、任务翻译），卡片顶上一行是它的名字和 ›，点进去是第二级的明细（账、各模型、限额的窗口、重置时间）。
  //   Claude Code、Codex 只看这台 Mac 上已经有的，不去问它们的服务器
  addSettings("usage", {
    title: "用量", icon: "▦", desc: "Paimon 的余额和用量，以及本机 Codex 和 Claude Code 的用量限额",
    pages: { paimon: { title: "Paimon 额度" }, claude: { title: "Claude Code" }, codex: { title: "Codex" }, translate: { title: "任务翻译" } },
    fields: function () {
      useLoad();
      var A = window.TSU_AGENTS, me = A && A.me ? A.me() : null, login = me && me.loggedIn !== false && me.login, u = ACCT.usage, out = [];
      var card = function (to, title, value) { out.push({ head: "", card: "usage" }, { key: "nav:" + to, kind: "nav", label: title, value: value || "", to: to, rowCls: "ss-uhead" }); }; // 一张卡片：顶上一行是名字和 ›
      var yuan4 = function (m) { var y = (+m || 0) / 1e6; return "¥" + (y && y < 1 ? y.toFixed(4) : y.toFixed(2)); }; // 任务翻译一次几厘钱：写到小数点后四位
      var fine = function (micro) { var x = Math.abs(+micro || 0) / 1e6; return (micro > 0 ? "+¥" : micro < 0 ? "-¥" : "¥") + (x && x < 1 ? x.toFixed(4) : x.toFixed(2)); };
      var ledger = function (rows, page) { rows.forEach(function (r, i) { var mo = r.model && A && A.modelOf ? A.modelOf(r.model) : null, grant = r.kind === "grant" || r.delta > 0; out.push({ key: page + ":r:" + i, label: grant ? "充值" : r.kind === "translate" ? "任务翻译" : r.kind === "adjust" ? "调整" : (mo && mo.name) || r.model || "扣费", desc: ago(r.at) + (r.input_tokens || r.output_tokens ? " · " + fmtTok(r.input_tokens) + " → " + fmtTok(r.output_tokens) + " tokens" : ""), must: true, kind: "info", value: fine(r.delta), cls: r.delta > 0 ? "pos" : "", page: page }); }); };
      // ---- Paimon 额度（服务器上的账）----
      if (!login) { out.push({ head: "", card: "usage" }, { key: "p:title", kind: "line", label: "Paimon 额度", rowCls: "ss-uhead" }, { key: "p:none", kind: "line", label: "登录后可查看 Paimon 的余额和用量", rowCls: "dim" }); }
      else {
        var bal = u && u.balance != null ? u.balance : me.balance, wk = u ? u.spentWeek : 0, per = wk / 7, low = bal <= 0 || (u && u.granted > 0 && bal / u.granted < 0.1) || (per > 0 && bal / per < 7);
        var used = u && u.granted > 0 ? Math.max(0, Math.min(100, (1 - bal / u.granted) * 100)) : null;
        card("paimon", "Paimon 额度");
        out.push({ key: "p:stat", kind: "stat", label: money(bal), desc: "剩余" + (u && u.granted > 0 ? " · 累计充值 " + money(u.granted) : ""), must: true, pct: used, pctText: used == null ? "" : "已用 " + Math.round(used) + "%", warn: low, cls: bal < 0 ? "neg" : "" });
        out.push({ key: "p:fc", kind: "line", rowCls: low ? "warn" : "dim", label: bal <= 0 ? "余额用完了：请管理员充值后再用 Paimon 的模型" : !u ? "正在读取…" : !wk ? "最近 7 天没有用 Paimon 的模型" : bal / per > 60 ? "照最近 7 天的用量，够用两个月以上" : "照最近 7 天的用量，余额还够用约 " + Math.max(1, Math.round(bal / per)) + " 天" });
        if (u) out.push({ key: "p:pairs", kind: "pairs", pairs: [["最近 24 小时", money(u.spentDay)], ["最近 7 天", money(u.spentWeek)]] });
        // 第二级：余额的明细、最近 7 天各模型、最近的账
        out.push({ head: "", page: "paimon" }, { key: "p:bal", label: "余额", kind: "info", value: money(bal), cls: bal < 0 ? "neg" : "", page: "paimon" });
        if (u && u.granted > 0) out.push({ key: "p:granted", label: "累计充值", kind: "info", value: money(u.granted), page: "paimon" });
        if (u) out.push({ key: "p:day", label: "最近 24 小时", kind: "info", value: money(u.spentDay), page: "paimon" }, { key: "p:week", label: "最近 7 天", kind: "info", value: money(u.spentWeek), page: "paimon" });
        var st = USE.st, by = {};
        if (st && st.days) st.days.forEach(function (r) { if (r.d > st.today - 7) { var x = by[r.m] = by[r.m] || { n: 0, t: 0 }; x.n += r.n; x.t += (r.i || 0) + (r.o || 0) + (r.c || 0); } });
        var ms = Object.keys(by).sort(function (x, y) { return by[y].t - by[x].t; });
        if (ms.length) { out.push({ head: "最近 7 天各模型", page: "paimon" }); ms.slice(0, 8).forEach(function (m) { var mo = A && A.modelOf ? A.modelOf(m) : null; out.push({ key: "p:m:" + m, label: (mo && mo.name) || m, kind: "info", value: by[m].n + " 次 · " + fmtTok(by[m].t) + " tokens", page: "paimon" }); }); }
        var rows = (u && u.rows || []).filter(function (r) { return r.note !== "pending"; }).slice(0, 20);
        if (rows.length) { out.push({ head: "最近的账", page: "paimon" }); ledger(rows, "paimon"); }
      }
      // ---- Claude Code：5 小时 / 每周限额（状态行拿到的那份）；最近 7 天各模型、每天（本机记录算的）----
      var cc = USE.cc || {}, BILL = { apple_subscription: "App Store 订阅", stripe_subscription: "订阅", google_play_subscription: "Google Play 订阅" }, lim = USE.lim, k7 = USE.lok && USE.lok.days ? ccWeek(USE.lok) : null;
      card("claude", "Claude Code", cc.billing ? BILL[cc.billing] || cc.billing : "");
      if (!LOC()) out.push({ key: "cc:none", kind: "line", rowCls: "dim", label: "仅在 App 中可读取本机的 Claude Code 数据" });
      else {
        var limRows = function (page) {
          if (!lim) return out.push({ key: "cc:lim" + page, kind: "line", rowCls: "dim", label: lim === undefined ? "正在读取限额…" : "还没有限额数据：Claude Code 的状态行刷新一次以后就有", page: page || undefined });
          [["five", "5 小时限额"], ["week", "每周限额"]].forEach(function (x) { var w = lim[x[0]]; if (!w) return; var gone = w.resets && w.resets * 1000 < Date.now(); out.push(meter("cc:" + x[0] + page, x[1], gone ? 0 : w.pct, w.resets ? resetsText(w.resets) : "", page || undefined)); });
        };
        limRows("");
        if (k7) out.push({ key: "cc:pairs", kind: "pairs", pairs: [["最近 7 天", k7.n + " 次回复"], ["会话", String(k7.ses)], ["tokens", fmtTok(k7.tok)]] });
        else out.push({ key: "cc:stat", kind: "line", rowCls: USE.lokErr ? "warn" : "dim", label: USE.lokErr ? "用量没统计出来：" + (USE.lokErr === "timeout" ? "超时" : USE.lokErr) : "正在统计这台 Mac 上的记录…" });
        // 第二级：限额（和它从哪来）、订阅、最近 7 天的合计、各模型、每天
        out.push({ head: "", page: "claude" });
        limRows("claude");
        if (lim) out.push({ key: "cc:limsrc", kind: "line", rowCls: "dim", label: (lim.src === "statusline" ? "来自 Claude Code 状态行（" : "来自本应用启动的 Claude Code（") + ago(lim.at) + "）；不向 Claude 服务器查询", page: "claude" });
        if (cc.billing) out.push({ key: "cc:plan", label: "订阅方式", kind: "info", value: BILL[cc.billing] || cc.billing, page: "claude" });
        if (k7) {
          out.push({ head: "最近 7 天", page: "claude" }, { key: "cc:n", label: "回复数", kind: "info", value: String(k7.n), page: "claude" }, { key: "cc:ses", label: "会话", kind: "info", value: String(k7.ses), page: "claude" },
            { key: "cc:tok", label: "tokens", desc: "输入 " + fmtTok(k7.i) + " · 输出 " + fmtTok(k7.o) + " · 缓存读取 " + fmtTok(k7.cr) + " · 缓存写入 " + fmtTok(k7.cw), must: true, kind: "info", value: fmtTok(k7.tok), page: "claude" });
          if (k7.models.length) { out.push({ head: "各模型（最近 7 天）", page: "claude" }); k7.models.forEach(function (m) { out.push({ key: "cc:m:" + m.name, label: m.name, kind: "info", value: m.n + " 次 · " + fmtTok(m.tok) + " tokens", page: "claude" }); }); }
          out.push({ head: "每天", page: "claude" });
          k7.days.forEach(function (x) { out.push({ key: "cc:d:" + x.d, label: dayName(x), kind: "info", value: x.n ? x.n + " 次 · " + fmtTok(x.tok) + " tokens" : "—", page: "claude" }); });
          out.push({ key: "cc:src", kind: "line", rowCls: "dim", label: "根据本机 Claude Code 记录统计（" + ago(USE.lok.at) + "）" + (USE.lokErr ? "；刚才没更新成：" + (USE.lokErr === "timeout" ? "超时" : USE.lokErr) : ""), page: "claude" });
        } else out.push({ key: "cc:stat2", kind: "line", rowCls: USE.lokErr ? "warn" : "dim", label: USE.lokErr ? "用量没统计出来：" + (USE.lokErr === "timeout" ? "超时" : USE.lokErr) : "正在统计这台 Mac 上的记录（第一次要把最近的记录读一遍，可能要十几秒）…", page: "claude" });
      }
      // ---- Codex：最近一次会话里记下的限额（读过的记着：先显示上次的；读不到写原因）----
      var rl = USE.cx && USE.cx.rl, plan = rl && rl.plan_type ? "ChatGPT " + String(rl.plan_type).replace(/^./, function (c) { return c.toUpperCase(); }) : "";
      card("codex", "Codex", plan);
      if (!LOC()) out.push({ key: "cx:none", kind: "line", rowCls: "dim", label: "仅在 App 中可读取本机的 Codex 数据" });
      else if (USE.cx === undefined) out.push({ key: "cx:load", kind: "line", rowCls: USE.cxErr ? "warn" : "dim", label: USE.cxErr ? useErr(USE.cxErr) : "正在读取…" });
      else if (!USE.cx) out.push({ key: "cx:none", kind: "line", rowCls: "dim", label: "暂无本地数据（本机尚无 Codex 会话记录）" });
      else {
        if (USE.cxErr) out.push({ key: "cx:err", kind: "line", rowCls: "dim", label: "显示的是上次读取的数据；" + useErr(USE.cxErr) });
        var wins = [["primary", rl.primary], ["secondary", rl.secondary]].filter(function (x) { return x[1]; });
        wins.forEach(function (x) { var w = x[1], gone = w.resets_at && w.resets_at * 1000 < Date.now(); out.push(meter("cx:" + x[0], winName(w.window_minutes || 0) + "限额", gone ? 0 : w.used_percent, w.resets_at ? resetsText(w.resets_at) : "")); });
        out.push({ head: "", page: "codex" });
        if (plan) out.push({ key: "cx:plan", label: "订阅", kind: "info", value: plan, page: "codex" });
        out.push({ key: "cx:src", kind: "line", rowCls: "dim", label: "来自最近一次 Codex 会话的记录（" + ago(USE.cx.at) + "）；不向 OpenAI 查询", page: "codex" });
        wins.forEach(function (x) { var w = x[1], gone = w.resets_at && w.resets_at * 1000 < Date.now(); out.push(meter("cx:" + x[0] + "2", winName(w.window_minutes || 0) + "限额", gone ? 0 : w.used_percent, w.resets_at ? resetsText(w.resets_at) : "", "codex")); });
        if (rl.credits && rl.credits.has_credits) out.push({ key: "cx:credits", label: "Codex 额度", kind: "info", value: rl.credits.unlimited ? "不限" : String(rl.credits.balance), page: "codex" });
      }
      // ---- 任务翻译（设置 › 对话 › 任务翻译）：用 Paimon 的额度，翻过的缓存着 ----
      if (login) {
        var trU = u && u.translate;
        card("translate", "任务翻译");
        if (trU && trU.calls) {
          out.push({ key: "tr:pairs", kind: "pairs", pairs: [["最近 7 天", yuan4(trU.spentWeek) + " · " + trU.stringsWeek + " 条"], ["累计", yuan4(trU.spent) + " · " + trU.strings + " 条"]] });
          out.push({ key: "tr:note", kind: "line", rowCls: "dim", label: "已翻译的内容会缓存，相同内容不重复计费" });
          out.push({ head: "", page: "translate" }, { key: "tr:week", label: "最近 7 天", kind: "info", value: yuan4(trU.spentWeek) + " · " + trU.stringsWeek + " 条", page: "translate" }, { key: "tr:all", label: "累计", kind: "info", value: yuan4(trU.spent) + " · " + trU.strings + " 条", page: "translate" });
          var trRows = (u.rows || []).filter(function (r) { return r.kind === "translate"; }).slice(0, 20);
          if (trRows.length) { out.push({ head: "最近的账", page: "translate" }); ledger(trRows, "translate"); }
        } else out.push({ key: "tr:none", kind: "line", rowCls: "dim", label: "尚未使用任务翻译" });
      }
      return out;
    },
  });

  // ======== 活动栏（最左一条，同 VS Code）：Agent（目录树）、搜索，左下 ⚙ 管理菜单；图标同 VS Code 的线条图标 ========
  var SVG = function (body) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + body + "</svg>"; };
  var ACT_ICONS = {
    // 一大一小两颗四角星（同 Paimon 的 ✦）
    agents: SVG('<path d="M10 4.5C10.5 9.2 12.8 11.5 17.5 12C12.8 12.5 10.5 14.8 10 19.5C9.5 14.8 7.2 12.5 2.5 12C7.2 11.5 9.5 9.2 10 4.5Z"/><path d="M18.5 2.8C18.7 4.6 19.4 5.3 21.2 5.5C19.4 5.7 18.7 6.4 18.5 8.2C18.3 6.4 17.6 5.7 15.8 5.5C17.6 5.3 18.3 4.6 18.5 2.8Z"/>'),
    search: SVG('<circle cx="10" cy="10" r="6"/><path d="M14.2 14.2L20.2 20.2"/>'),
    // 扩展：三块拼成 L、一块在右上角分开（同 VS Code）
    extensions: SVG('<rect x="3.5" y="9.5" width="6" height="6" rx=".6"/><rect x="3.5" y="15.5" width="6" height="6" rx=".6"/><rect x="9.5" y="15.5" width="6" height="6" rx=".6"/><rect x="13.5" y="3.5" width="7" height="7" rx=".6"/>'),
    account: SVG('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3.2"/><path d="M6.3 18.4c1.2-2.3 3.3-3.5 5.7-3.5s4.5 1.2 5.7 3.5"/>'),
    // App：三行三列的点（同启动台）——活动栏上面那一组的最后一个，点一下弹出 App（apps.js）
    apps: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none">' + [5.5, 12, 18.5].map(function (y) { return [5.5, 12, 18.5].map(function (x) { return '<circle cx="' + x + '" cy="' + y + '" r="1.8"/>'; }).join(""); }).join("") + "</svg>",
    manage: SVG('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  };
  // ---- 活动栏：上面各视图的图标（Agent、搜索、扩展……，别的文件用 addView 加），下面「账户」「管理」两个全局的；
  //      位置：默认（左边一条）/ 顶部（主侧栏标题栏里一排）/ 底部（主侧栏最下面一排）/ 隐藏；不在左边一条时「账户」「管理」到标题栏最右边（同 VS Code）----
  var VIEWS = {}; // 别的文件加的视图：id → { title, icon（24 格线条图标）, keys?, sym?, order?, create(tw, side) → 元素（第一个孩子是 .st-shdr 标题栏）, show?(el, tw, fromBar) }
  var GLOBAL_ACTS = { account: 1, manage: 1 };
  function addView(id, v) {
    VIEWS[id] = v;
    ACT_ICONS[id] = v.icon;
    if (v.keys) ACT_KEYS[id] = v.keys;
    if (v.sym) ACT_SYM[id] = v.sym;
    if (!ACT_ITEMS.some(function (x) { return x[0] === id; })) ACT_ITEMS.splice(Math.max(0, Math.min(ACT_ITEMS.length - 3, v.order == null ? 1 : v.order)), 0, [id, v.title]); // 视图都在「App」前面（App、账户、管理是最后三个）
    command("view." + id, { title: "显示" + v.title, keys: v.keys || "", run: function (tw) { showView(tw, id); } });
    allWins().forEach(function (w) { if (w.stAct) { paintAct(w); syncAct(w); } });
  }
  function actBar(tw) {
    if (tw.stAct) return tw.stAct;
    var body = tw.el.querySelector(".body"), lab = tw.el.querySelector(".tlab"), a = tw.stAct = document.createElement("div"), g = tw.stGlob = document.createElement("div");
    a.className = "st-act";
    a.innerHTML = '<span class="st-grow"></span>';
    g.className = "st-glob";
    g.dataset.nodrag = ""; // 在标题栏里时：这一块能点，不算拖窗口的地方（native.js 按这个算拖动区）
    g.innerHTML = '<button data-a="account" title="账户">' + ACT_ICONS.account + '</button><button data-a="manage" title="管理">' + ACT_ICONS.manage + "</button>";
    a.appendChild(g);
    paintAct(tw);
    var row = document.createElement("div");
    row.className = "st-row0";
    row.style.cssText = "flex:1 1 auto;min-height:0;display:flex";
    body.insertBefore(row, lab);
    row.appendChild(a);
    row.appendChild(lab);
    // 右键：同 VS Code——每个视图勾选显示不显示（带快捷键，指着就预览）、活动栏位置 ›、主侧栏移到右侧 / 左侧、账户、管理
    var ctx = function (e) { e.preventDefault(); e.stopPropagation(); menu(function () { return actMenu(tw); }, { x: e.clientX, y: e.clientY }); };
    a.addEventListener("contextmenu", ctx);
    g.addEventListener("contextmenu", ctx);
    var click = function (e) {
      var b = e.target.closest("[data-a]");
      if (!b) return;
      e.stopPropagation();
      var k = b.dataset.a, inBar = g.parentNode !== a;
      if (k === "manage") manageMenu(tw, b, inBar ? "below-end" : "right-up");
      else if (k === "account") accountMenu(tw, b, inBar ? "below-end" : "right-up");
      else if (k === "apps") { if (STUDIO.apps && STUDIO.apps.popup) STUDIO.apps.popup(tw, b, e.detail === 0); } // 弹出 App（不是一个视图）；用键盘按的焦点进到格子里
      else showView(tw, k, true);
      syncAct(tw);
    };
    a.addEventListener("click", click);
    g.addEventListener("click", click);
    ["pointerdown", "dblclick"].forEach(function (t) { g.addEventListener(t, function (e) { e.stopPropagation(); }); }); // 在标题栏里时：不拖窗口
    return a;
  }
  // 各视图的图标：按 ACT_ITEMS 的顺序（有视图加进来重画）
  function paintAct(tw) {
    var a = tw.stAct, grow = a.querySelector(":scope > .st-grow");
    a.querySelectorAll(":scope > [data-a]").forEach(function (b) { b.remove(); });
    ACT_ITEMS.forEach(function (x) {
      if (GLOBAL_ACTS[x[0]]) return;
      var b = document.createElement("button");
      b.dataset.a = x[0];
      b.title = x[1] + (ACT_KEYS[x[0]] ? " (" + ACT_KEYS[x[0]] + ")" : "");
      b.innerHTML = ACT_ICONS[x[0]] || "";
      a.insertBefore(b, grow);
    });
  }
  var ACT_ITEMS = [["agents", "Agents"], ["search", "搜索"], ["extensions", "扩展"], ["apps", "App"], ["account", "账户"], ["manage", "管理"]];
  var ACT_KEYS = { agents: "⇧⌘E", search: "⇧⌘F", extensions: "⇧⌘X" }, ACT_SYM = { agents: "sparkles", search: "magnifyingglass", extensions: "square.grid.2x2", apps: "circle.grid.3x3", account: "person.crop.circle", manage: "gearshape" };
  var ACT_POS = [["side", "默认"], ["top", "顶部"], ["bottom", "底部"], ["hidden", "隐藏"]];
  var actPos = function () { var p = getv("activityPos"); return getv("activityBar") === false ? "hidden" : p === "top" || p === "bottom" ? p : "side"; };
  // 默认不摆出来的按钮（右键勾上才有，记在 toolbarShown）：标题栏右上角的浏览器——浏览器的入口在活动栏的「App」里
  var TB_OFF = { layout: ["web"] };
  var tbOff = function (tb, id) { return (TB_OFF[tb] || []).indexOf(id) >= 0; };
  var tbHidden = function (tb, id) { if (tbOff(tb, id)) return ((getv("toolbarShown") || {})[tb] || []).indexOf(id) < 0; var o = getv("toolbarHidden") || {}; return (o[tb] || []).indexOf(id) >= 0; };
  function setTbHidden(tb, id, hide) { var k = tbOff(tb, id) ? "toolbarShown" : "toolbarHidden", put = k === "toolbarShown" ? !hide : hide, o = Object.assign({}, getv(k) || {}), a = (o[tb] || []).filter(function (x) { return x !== id; }); if (put) a.push(id); o[tb] = a; setv(k, o); }
  function toolbarMenu(e, tb, items, hitId, after) {
    e.preventDefault(); e.stopPropagation();
    var hit = items.filter(function (x) { return x.id === hitId; })[0], tw = T() && T().front();
    menu(function () {
      return [
        root.classList.contains("st-os-claude") ? null : { label: "配置快捷键", icon: MI.keys, sym: "keyboard", disabled: !hit, run: function () { keysQ = hit ? hit.label : ""; if (tw) showPage(tw, "keys"); } }, // Claude App：不讲快捷键
        hit ? { label: "隐藏「" + hit.label + "」", icon: MI.hide, run: function () { setTbHidden(tb, hit.id, true); if (after) after(); allWins().forEach(renderSoon); } } : null,
        { sep: true },
      ].filter(Boolean).concat(items.map(function (x) { var on = !tbHidden(tb, x.id); return { label: x.label, keys: x.keys || "", icon: x.icon && /<svg/.test(x.icon) ? MIc2(x.icon) : x.icon, checked: on, run: function () { setTbHidden(tb, x.id, on); if (after) after(); allWins().forEach(renderSoon); } }; }));
    }, { x: e.clientX, y: e.clientY });
  }
  function actMenu(tw) {
    var item = function (x) {
      var on = actOn(x[0], true);
      return { label: x[1], keys: ACT_KEYS[x[0]] || "", icon: MIc2(ACT_ICONS[x[0]]), sym: ACT_SYM[x[0]], checked: on, run: function () { var o = Object.assign({}, SET_DEF.activityItems, getv("activityItems") || {}); o[x[0]] = !on; setv("activityItems", o); syncAct(tw); },
        preview: function (p) { ACTP = p ? (function () { var o = {}; o[x[0]] = !on; return o; })() : null; syncAct(tw); } };
    };
    var right = getv("sideBarPos") === "right";
    return ACT_ITEMS.filter(function (x) { return !GLOBAL_ACTS[x[0]]; }).map(item).concat([
      { sep: true },
      { label: "活动栏位置", icon: MI.act, sym: "sidebar.left", value: (ACT_POS.filter(function (x) { return x[0] === actPos(); })[0] || ["", ""])[1], items: function () { var cur = actPos(); return ACT_POS.map(function (x) { return { label: x[1], radio: true, checked: cur === x[0], run: function () { setActPos(x[0]); } }; }); } },
      { label: "活动栏大小", icon: MI.act, sym: "arrow.up.left.and.arrow.down.right", value: (getv("activitySize") || "normal") === "compact" ? "精致" : "宽裕", items: function () { return [["normal", "宽裕"], ["compact", "精致"]].map(function (x) { return { label: x[1], radio: true, checked: (getv("activitySize") || "normal") === x[0], run: function () { setv("activitySize", x[0]); }, preview: function (p) { previewSet("activitySize", p ? x[0] : null); applySettings(); } }; }); } },
      { label: right ? "将主侧栏移到左侧" : "将主侧栏移到右侧", icon: right ? MI.sideL : MI.sideR, run: function () { setv("sideBarPos", right ? "left" : "right"); } },
      { sep: true },
    ], ACT_ITEMS.filter(function (x) { return x[0] === "account"; }).map(item)); // ⚙ 管理不给藏（藏了就进不了设置）
  }
  function setActPos(v) { if (v === "hidden") return setv("activityBar", false); setv("activityPos", v); setv("activityBar", true); }
  var ACTP = null; // 预览：右键菜单里指着的那一项临时显示 / 不显示
  // 用程序坞（设置 › 布局 › App 启动器）时活动栏上不放 App 按钮
  var actOn = function (k, real) { if (k === "manage") return true; if (k === "apps" && getv("appLauncher") === "dock") return false; if (!real && ACTP && k in ACTP) return ACTP[k]; var o = getv("activityItems") || {}; return k in o ? !!o[k] : true; };
  var MIc2 = function (svg) { return String(svg || "").replace(/<svg /, '<svg width="16" height="16" '); }; // 活动栏的 24 格图标缩到菜单里
  // 当前视图的标题栏（活动栏在顶部时放进这里）
  var viewHeader = function (side, v) { return VIEWS[v] ? side.querySelector('.st-cview[data-view="' + v + '"] > .st-shdr') : v === "search" ? side.querySelector(".st-sview > .st-shdr") : v === "extensions" ? side.querySelector(".st-xview > .st-shdr") : side.querySelector(".st-vhead"); };
  function syncAct(tw) {
    var a = actBar(tw), g = tw.stGlob, pos = actPos(), shown = !!(tw.side && tw.side.shown()), v = tw.stView || "agents";
    var btns = Array.prototype.slice.call(a.querySelectorAll(":scope > [data-a]")).concat(Array.prototype.slice.call(g.querySelectorAll("[data-a]")));
    btns.forEach(function (b) { b.hidden = !actOn(b.dataset.a); b.classList.toggle("on", shown && b.dataset.a === v); });
    var gear = g.querySelector('[data-a="manage"]');
    if (gear) { gear.classList.toggle("st-badge", updateReady || !!appUpd); gear.title = updateReady || appUpd ? "管理 · 有新版本" : "管理"; }
    // 账户：GitHub 头像
    var me = window.TSU_AGENTS && TSU_AGENTS.me ? TSU_AGENTS.me() : null, inAcc = me && me.loggedIn !== false && me.login, av = inAcc ? avatarHtml(0, "st-avatar") : "", acc = g.querySelector('[data-a="account"]'); // 登录了：自己的头像（设置 › 账号 › 头像选的那种）
    if (acc && acc.dataset.av !== av) { acc.dataset.av = av; acc.innerHTML = av || ACT_ICONS.account; acc.title = inAcc ? me.login + " (GitHub)" : "账户"; }
    // 主侧栏在右边：活动栏、主侧栏整个换到右边，辅助侧栏到左边（同 VS Code 的「将主侧栏移到右侧」）
    var right = getv("sideBarPos") === "right", row0 = tw.el.querySelector(".st-row0"), lab = tw.el.querySelector(".tlab"), side = tw.el.querySelector(".tside");
    if (row0) { row0.classList.toggle("st-sright", right); row0.classList.toggle("st-noact", pos !== "side"); } // 活动栏不在边上：窗口边上也留一道缝
    if (lab) lab.classList.toggle("st-sright", right);
    // 位置：顶部——当前视图的标题栏里一排；底部——主侧栏最下面一排；隐藏；默认——左边一条
    a.classList.toggle("st-acttop", pos === "top" || pos === "bottom");
    a.style.display = pos === "hidden" ? "none" : "";
    if (side) { side.classList.toggle("st-acttop", pos === "top"); side.classList.toggle("st-actbot", pos === "bottom"); }
    var ft = side && side.querySelector(":scope > .st-actfoot");
    if (pos === "top" && side) { var hdr = viewHeader(side, v); if (hdr && a.parentNode !== hdr) hdr.insertBefore(a, hdr.firstChild); }
    else if (pos === "bottom" && side) {
      if (!ft) { ft = document.createElement("div"); ft.className = "st-actfoot"; }
      if (a.parentNode !== ft) ft.appendChild(a);
      if (side.lastElementChild !== ft) side.appendChild(ft);
    } else if (row0 && a.parentNode !== row0) row0.insertBefore(a, row0.firstChild);
    if (pos !== "bottom" && ft) ft.remove();
    // 账户、管理：左边一条时在它最下面；别的时候到标题栏最右边
    var bar = tw.el.querySelector(".bar");
    if (pos === "side") { if (g.parentNode !== a) a.appendChild(g); }
    else if (bar && bar.lastElementChild !== g) bar.appendChild(g); // 标题栏最右边（布局控件后面）
    g.classList.toggle("st-globbar", pos !== "side");
  }
  // 通行密钥：在浏览器里加、管（App 的网页视图里用不了系统的通行密钥——要在 Safari / Chrome 里，那里有 Touch ID、iCloud 钥匙串）
  function openPasskeys() {
    var u = location.origin + "/account/passkeys", N = window.nadosNative;
    if (N && N.call) N.call("openExternal", { url: u }).catch(function () { window.open(u, "_blank", "noopener"); });
    else window.open(u, "_blank", "noopener");
  }
  // 账户（同 VS Code 左下角的账户）：GitHub 登录的是谁、退出登录
  function accountMenu(tw, anchor, side) {
    var me = window.TSU_AGENTS && TSU_AGENTS.me ? TSU_AGENTS.me() : null, login = me && me.loggedIn !== false && me.login;
    // 同 VS Code 的账号菜单：账号是一项（指着出二级菜单：账号设置、设备、退出登录）——「退出登录」不放在最外面当一个光秃秃的出口；
    //   下面是跟账号相关、常用的几样（连接器、设置）。没登录：一项「登录」
    var syncOn = !!window.TSU_SYNC, devN = syncOn && TSU_SYNC.deviceList ? TSU_SYNC.deviceList().length : 0;
    var signOut = function () {
      var go = function () { location.href = "/auth/logout"; };
      if (!window.TSU_DESK || !TSU_DESK.alert) return go();
      TSU_DESK.alert({ title: "退出登录 " + login + "？", message: "跟着账号走的数据会停止同步；这台 Mac 上的 Claude Code、Codex 会话不受影响。", icon: "caution",
        buttons: [{ label: "取消", role: "cancel" }, { label: "退出登录", role: "default", run: go }] });
    };
    menu(login ? [
      { label: login + " (GitHub)", icon: MI.agent, sym: "person.crop.circle", items: [
        { label: "账号设置…", icon: MI.gear || MI.agent, sym: "person.text.rectangle", run: function () { settings(tw, "account"); } }, // 设置里的「账号」：头像、额度与用量、设备
        { label: "通行密钥…", icon: MI.lock || MI.gear || MI.agent, sym: "key", run: openPasskeys },
        syncOn ? { label: "设备" + (devN ? "（" + devN + "）" : "") + "…", icon: MI.window || MI.gear, sym: "laptopcomputer.and.iphone", run: function () { if (S.pages.devices) S.openPage(tw, "devices", ""); else settings(tw, "account"); } } : null, // 「设备」App
        { sep: true },
        { label: "退出登录…", icon: MI.open, sym: "rectangle.portrait.and.arrow.right", run: signOut },
      ].filter(Boolean) },
      { sep: true },
      syncOn ? { label: "同步已开启", checked: true, sym: "arrow.triangle.2.circlepath", disabled: true } : null,
      { label: "管理连接器…", icon: MI.plug || MI.gear, sym: "powerplug", run: function () { showView(tw, "extensions"); } },
      { label: "设置…", icon: MI.gear, sym: "gearshape", keys: "⌘,", run: function () { settings(tw); } },
    ].filter(Boolean) : [
      { label: "使用 GitHub 登录…", icon: MI.open, sym: "person.crop.circle.badge.plus", run: function () { location.href = "/auth/login?next=" + encodeURIComponent(location.pathname + location.search); } },
      { sep: true },
      { label: "管理连接器…", icon: MI.plug || MI.gear, sym: "powerplug", run: function () { showView(tw, "extensions"); } },
      { label: "设置…", icon: MI.gear, sym: "gearshape", keys: "⌘,", run: function () { settings(tw); } },
    ], { el: anchor, side: side });
  }
  // ---- 主侧栏里放哪个视图：agent（目录树）/ 搜索 / 扩展 / 别的文件加的；点着的那个再点一下是收起主侧栏（同 VS Code；活动栏在主侧栏里时不收）----
  // quiet：只换成这个视图（重新载入后恢复上次选的那个）——主侧栏关着就不打开、不抢焦点
  function showView(tw, v, fromBar, quiet) {
    var side = tw.el.querySelector(".tside"), list = side && side.querySelector(".ts-list");
    if (!side) return;
    var shown = !!(tw.side && tw.side.shown());
    if (fromBar && shown && (tw.stView || "agents") === v) { if (actPos() === "top" || actPos() === "bottom") return; tw.side.toggle(false); return syncAct(tw); }
    if (!shown && tw.side && !quiet) tw.side.toggle(true);
    tw.stView = v;
    if (L.leftView !== v) { L.leftView = v; saveL(); } // 记住主侧栏选的是哪一个视图（Agent / 搜索 / 连接器……）：重新载入、更新、重开后还是它
    if (quiet) fromBar = true; // 恢复的那一下：不抢焦点
    var sv = side.querySelector(".st-sview"), xv = side.querySelector(".st-xview");
    var vh = side.querySelector(".st-vhead");
    if (vh) vh.hidden = v !== "agents";
    if (sv) sv.hidden = v !== "search";
    if (xv) xv.hidden = v !== "extensions";
    if (list) list.hidden = v !== "agents";
    side.querySelectorAll(":scope > .st-cview").forEach(function (el) { el.hidden = el.dataset.view !== v; });
    if (VIEWS[v]) {
      var cv = side.querySelector(':scope > .st-cview[data-view="' + v + '"]');
      if (!cv) { cv = VIEWS[v].create(tw, side); cv.classList.add("st-cview"); cv.dataset.view = v; side.appendChild(cv); }
      cv.hidden = false;
      if (VIEWS[v].show) VIEWS[v].show(cv, tw, fromBar);
    }
    else if (v === "search") { if (!sv) sv = searchView(tw, side); sv.hidden = false; var qi = sv.querySelector("input"); if (qi) { qi.focus(); qi.select(); } }
    else if (v === "extensions") { if (!xv) xv = extView(tw, side); xv.hidden = false; xv.paint(); if (!fromBar) xv.querySelector(".st-xlist").focus({ preventScroll: true }); }
    else { if (tw.side) tw.side.render(true); if (list && !fromBar) list.focus({ preventScroll: true }); }
    syncAct(tw);
  }
  // ======== 扩展（同 VS Code 的扩展视图）：不是 Paimon Code 本身的功能，勾选安装、再点卸载；默认都不装（见 ext.js）========
  function extView(tw, side) {
    var el = document.createElement("div"), sel = 0;
    el.className = "st-xview terminal-style-ui";
    el.innerHTML = '<div class="st-shdr"><span class="st-vtitle">扩展</span></div><div class="st-xlist" tabindex="-1"></div>';
    side.appendChild(el);
    var box = el.querySelector(".st-xlist"), X = window.TSU_EXT;
    el.paint = function () {
      var L0 = X ? X.list() : [];
      box.innerHTML = L0.map(function (x, i) {
        var on = X.on(x.id);
        return '<div class="st-xrow' + (i === sel && document.activeElement === box ? " kfocus" : "") + '" data-x="' + esc(x.id) + '"><span class="st-xbox' + (on ? " on" : "") + '">' + (on ? "✓" : "") + '</span><span class="st-xicon">' + (x.id === "claude-code" && window.TSU_LOGOS && TSU_LOGOS.claude ? '<i class="st-alogo cc">' + TSU_LOGOS.claude + "</i>" : esc(x.icon || "")) + '</span><span class="st-xmain"><span class="st-xname">' + esc(x.name) + '</span><span class="st-xdesc st-dim">' + esc(x.desc || "") + "</span></span></div>";
      }).join("") || '<div class="st-dim st-empty">无扩展</div>';
    };
    var toggle = function (id) { if (X) { X.set(id, !X.on(id)); el.paint(); } };
    box.addEventListener("click", function (e) { var r = e.target.closest(".st-xrow"); if (r) { sel = Array.prototype.indexOf.call(box.children, r); toggle(r.dataset.x); } });
    box.addEventListener("keydown", function (e) {
      var n = X ? X.list().length : 0;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, Math.min(n - 1, sel + (e.key === "ArrowDown" ? 1 : -1))); el.paint(); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); var x = X && X.list()[sel]; if (x) toggle(x.id); }
    });
    box.addEventListener("focus", el.paint);
    box.addEventListener("blur", el.paint);
    if (X) X.watch(function () { el.paint(); });
    return el;
  }
  // ======== 搜索（在所有对话里找，同 VS Code 的搜索）：按 agent / 会话分组，每组几处；每一处一行（找到的字亮起来），点一下跳过去 ========
  function searchView(tw, side) {
    var el = document.createElement("div");
    el.className = "st-sview terminal-style-ui";
    if (window.TSU_I18N && TSU_I18N.add) TSU_I18N.add({ "正在搜索…": "Searching…", "只找了 12 秒（文件太多）：在「文件」里打开小一点的文件夹可以找全": "Stopped after 12 s (too many files). Open a smaller folder in Files to search all of it" });
    el.innerHTML = '<div class="st-shdr"><span class="st-vtitle">搜索</span><span class="st-fill"></span><button class="st-hbtn" data-s="fold" title="全部折叠">' + ICO.collapse + '</button></div>' +
      // 在哪找（三选一，默认中间的「打开的 Agent」）：全部 Agent（这台 Mac 上所有会话）· 打开的 Agent（标签页里开着的）· 文件（「文件」视图打开的文件夹）
      '<div class="st-sscope" role="radiogroup"><button data-sc="all" title="本机所有 Agent 会话">全部 Agent</button><button data-sc="open" title="仅搜索已打开标签页中的 Agent 会话">打开的 Agent</button><button data-sc="files" title="「文件」视图中已打开文件夹内的文件（名称和内容）">文件</button></div><div class="st-search st-sbox"><input spellcheck="false" autocomplete="off" placeholder="搜索"><span class="st-sopts"><button data-o="cs" title="区分大小写">Aa</button><button data-o="word" title="全字匹配"><u>ab</u></button><button data-o="re" title="使用正则表达式">.*</button></span></div>' +
      '<div class="st-sres"></div>'; // 范围（打开的 / 全部）在搜索框上面：先定在哪找，再打字 // 范围：默认只找开着的（快、准），要翻旧账切到全部
    side.appendChild(el);
    var input = el.querySelector("input"), res = el.querySelector(".st-sres"), timer = 0, seq = 0, folds = {}, last = null, sopt = store("st-search-opts", { cs: false, word: false, re: false });
    // 搜的字记着（同 VS Code）：重启、重新载入以后还在，结果重新找出来
    input.value = store("st-search-q", "") || "";
    if (input.value) setTimeout(function () { run(); }, 400);
    var paintOpts = function () { el.querySelectorAll(".st-sopts [data-o]").forEach(function (b) { b.classList.toggle("on", !!sopt[b.dataset.o]); }); el.querySelectorAll(".st-sscope [data-sc]").forEach(function (b) { b.classList.toggle("on", (sopt.scope || "open") === b.dataset.sc); b.setAttribute("aria-checked", String((sopt.scope || "open") === b.dataset.sc)); }); };
    paintOpts();
    el.querySelector(".st-sopts").addEventListener("mousedown", function (e) { e.preventDefault(); }); // 点开关不让搜索框失焦
    el.querySelector(".st-sopts").addEventListener("click", function (e) { var b = e.target.closest("[data-o]"); if (!b) return; sopt[b.dataset.o] = !sopt[b.dataset.o]; keep("st-search-opts", sopt); paintOpts(); run(); });
    el.querySelector(".st-sscope").addEventListener("mousedown", function (e) { e.preventDefault(); });
    el.querySelector(".st-sscope").addEventListener("click", function (e) { var b = e.target.closest("[data-sc]"); if (!b || (sopt.scope || "open") === b.dataset.sc) return; sopt.scope = b.dataset.sc; keep("st-search-opts", sopt); paintOpts(); run(); });
    input.addEventListener("input", function () { keep("st-search-q", input.value); clearTimeout(timer); timer = setTimeout(run, 250); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { clearTimeout(timer); run(); }
      if (e.key === "Escape") { input.value = ""; keep("st-search-q", ""); res.innerHTML = ""; }
      if (e.key === "ArrowDown") { e.preventDefault(); var first = res.querySelector(".st-sgh, .st-sh[data-h]"); if (first) { kf = first.dataset.g + ":" + (first.dataset.h || ""); res.focus(); markK(); } }
      e.stopPropagation();
    });
    var kf = null;
    res.tabIndex = -1;
    var kRows = function () { return Array.prototype.slice.call(res.querySelectorAll(".st-sgh, .st-sh[data-h]")); };
    var kOf = function (r) { return r.dataset.g + ":" + (r.dataset.h || ""); };
    function markK() { kRows().forEach(function (r) { r.classList.toggle("kfocus", kOf(r) === kf); }); var on = res.querySelector(".kfocus"); if (on) on.scrollIntoView({ block: "nearest" }); }
    res.addEventListener("keydown", function (e) {
      var rs = kRows(), i = rs.findIndex(function (r) { return kOf(r) === kf; }), cur = rs[i];
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (e.key === "ArrowUp" && i <= 0) { kf = null; markK(); return input.focus(); }
        i = Math.max(0, Math.min(rs.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
        kf = kOf(rs[i]);
        markK();
      } else if ((e.key === "Enter" || e.key === " ") && cur) { e.preventDefault(); cur.click(); }
      else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && cur && cur.classList.contains("st-sgh")) { var g0 = grpOf(cur.dataset.g); if (g0 && g0.kind !== "fname" && !!folds[g0.key] === (e.key === "ArrowRight")) { e.preventDefault(); cur.click(); } }
      e.stopPropagation();
    });
    function run() {
      var q = input.value.trim(), my = ++seq;
      if (fctl) { try { fctl.abort(); } catch (e) { /* 已经完了 */ } fctl = null; } // 上一次还在找的文件：停掉
      if (!q) { res.innerHTML = ""; last = null; return; }
      var rx = searchRx(q, sopt);
      if (!rx) { last = null; res.innerHTML = '<div class="st-dim st-spad">正则表达式无效</div>'; return; }
      // 范围：文件——只找文件；打开的 Agent（标签页里开着的那几个）/ 全部 Agent——只找对话。开着的 Codex 会话在内存里找（它的记录已经读进来了）
      var scope = sopt.scope || "open";
      if (scope === "files") {
        var fr0 = filesRoot();
        if (!fr0) { last = null; res.innerHTML = '<div class="st-dim st-spad">只能在 App 里搜索文件</div>'; return; }
        last = { q: q, rx: rx, groups: [], pending: false, froot: fr0, fgroups: [], fpending: true, files: true };
        paint();
        findFiles(fr0, q, rx, my);
        return;
      }
      var openIds = scope === "open" ? openAgentIds() : null;
      var groups = paimonHits(rx).filter(function (g) { return !openIds || openIds[g.id]; }).concat(liveCxHits(rx, openIds)), froot = "";
      // Paimon Code 的先出来，Claude Code 的（扩展装了才有：原生那边在会话记录里找）回来再补上；
      //   文件（「文件」视图打开的那个文件夹里：名字里有的、内容里有的）同时另外找，回来补在「文件」那一节
      last = { q: q, rx: rx, groups: groups, pending: scope !== "open" && !!(LOC() && LOC().ccSearch && ccOn()), froot: froot, fgroups: [], fpending: !!froot }; // 打开的 Agent：上面在内存里已经找完了
      paint();
      if (froot) findFiles(froot, q, rx, my);
      if (!last.pending) return;
      LOC().ccSearch(q, { limit: 80, per: 40, cs: sopt.cs, word: sopt.word, re: sopt.re }).catch(function () { return []; }).then(function (list0) {
        if (my !== seq) return;
        (list0 || []).forEach(function (x) { if (!x || x.error) return; if (openIds && !openIds["cc:" + x.id]) return; groups.push({ kind: "cc", key: "cc:" + x.id, id: x.id, title: x.title, count: x.count, info: { path: x.path, title: x.title }, hits: x.hits.map(function (h) { return { role: h.role, text: h.text, match: h.match, uuid: h.uuid, offset: h.offset }; }) }); });
        last.groups = groups; last.pending = false; // 文件那一节（可能已经回来了）留着
        paint();
      });
    }
    // ---- 文件：「文件」视图打开的文件夹（st-files 的 root，没开过就是主目录）里找——名字里有的排前面（最多 30 个），再是内容里有的（rg，按文件分组，每个文件最多 5 处）。
    //   主目录、根这种大的：不进 Library、Applications；node_modules、.git 不找；内容边找边出、最多 12 秒；新的一次搜索把上一次停掉
    var fctl = null, FIDX = { key: "", at: 0, p: null };
    var RG0 = 'RG=$(command -v rg || ls /opt/homebrew/bin/rg /usr/local/bin/rg 2>/dev/null | head -n 1); ';
    function filesRoot() { if (!LOC() || !LOC().exec) return ""; var r = ""; try { r = (JSON.parse(localStorage.getItem("st-files") || "{}") || {}).root || ""; } catch (e) { /* 没记过 */ } return r || home() || ""; }
    var bigRoot = function (r) { return r === "/" || r === home(); };
    var fglob = function (r) { return (bigRoot(r) ? "--max-depth 16 -g '!Library' -g '!Applications' -g '!System' " : "") + "-g '!node_modules' -g '!.git' "; };
    var fjoin = function (r, f) { return r === "/" ? "/" + f : r + "/" + f; };
    function fileNames(r) { // 文件名：列一次，30 秒里同一个文件夹不再列
      if (FIDX.key === r && Date.now() - FIDX.at < 30000 && FIDX.p) return FIDX.p;
      var cmd = "cd " + shq(r) + " && { " + RG0 + 'if [ -n "$RG" ]; then "$RG" --files --no-messages ' + fglob(r) + "2>/dev/null; else find . " + (bigRoot(r) ? "-maxdepth 16 " : "") + "-type f -not -path '*/.*' -not -path '*/node_modules/*' -not -path './Library/*' 2>/dev/null | sed 's|^\\./||'; fi; } | head -n 60000";
      FIDX = { key: r, at: Date.now(), p: LOC().exec({ cmd: cmd }).then(function (x) { return String((x && x.out) || "").split("\n").filter(Boolean); }, function () { return []; }) };
      return FIDX.p;
    }
    function findFiles(r, q, rx, my) {
      if (fctl) { try { fctl.abort(); } catch (e) { /* 已经完了 */ } }
      var ctl = fctl = window.AbortController ? new AbortController() : null, timedOut = false; // 找到一处就先画出来（边找边出，同 VS Code），12 秒还没找完就停（文件太多：主目录这种）
      var stop = setTimeout(function () { timedOut = true; if (ctl) try { ctl.abort(); } catch (e) { /* 已经完了 */ } }, 12000);
      var flags = "--line-number --no-heading --color never --max-count 5 --max-columns 300 --max-columns-preview --max-filesize 1M " + (sopt.cs ? "-s " : "-i ") + (sopt.re ? "" : "-F ") + (sopt.word ? "-w " : "") + fglob(r);
      var cmd = "cd " + shq(r) + " && { " + RG0 + 'if [ -n "$RG" ]; then "$RG" ' + flags + "-- " + shq(q) + " . 2>/dev/null; else grep -rnI" + (sopt.cs ? "" : "i") + (sopt.re ? "E" : "F") + (sopt.word ? "w" : "") + " --exclude-dir=.git --exclude-dir=node_modules -m 5 -- " + shq(q) + " . 2>/dev/null; fi; } | head -n 400";
      var by = {}, order = [], buf = "", nameHits = null, pT = 0;
      var add = function (l) { var m = /^(?:\.\/)?(.*?):(\d+):(.*)$/.exec(l); if (!m) return; if (!by[m[1]]) { by[m[1]] = []; order.push(m[1]); } if (by[m[1]].length < 5) by[m[1]].push({ line: +m[2], text: m[3].replace(/\t/g, "  ").trim() }); };
      var build = function (done) {
        if (my !== seq || !last) return;
        var seen = {}, fg = [];
        (nameHits || []).slice(0, 30).forEach(function (f) { seen[f] = 1; fg.push({ kind: by[f] ? "file" : "fname", key: "f:" + f, rel: f, path: fjoin(r, f), count: by[f] ? by[f].length : 0, hits: by[f] || [] }); });
        order.forEach(function (f) { if (!seen[f]) fg.push({ kind: "file", key: "f:" + f, rel: f, path: fjoin(r, f), count: by[f].length, hits: by[f] }); });
        last.fgroups = fg; last.fpending = !done; last.fstopped = !!(done && timedOut);
        paint();
      };
      var soon = function () { if (!pT) pT = setTimeout(function () { pT = 0; build(false); }, 250); };
      var names = fileNames(r).then(function (l) { // 名字里有的：文件名（不算所在的文件夹）对上的，一样的、开头就是的、层数少的排前面
        var hits = [], ql = q.toLowerCase();
        for (var i = 0; i < l.length && hits.length < 400; i++) { var f = l[i], bn = f.slice(f.lastIndexOf("/") + 1); rx.lastIndex = 0; if (rx.test(bn)) hits.push(f); }
        var rank = function (f) { var bn = f.slice(f.lastIndexOf("/") + 1).toLowerCase(); return (bn === ql ? 0 : bn.indexOf(ql) === 0 ? 1 : 2) * 1000 + f.split("/").length * 10 + Math.min(9, f.length / 20); };
        nameHits = hits.sort(function (x, y) { return rank(x) - rank(y); });
        soon();
      });
      LOC().exec({ cmd: cmd }, ctl && ctl.signal, function (chunk, fd) { if (fd !== 1) return; buf += chunk; var ls = buf.split("\n"); buf = ls.pop(); ls.forEach(add); soon(); })
        .catch(function () { return null; })
        .then(function () { clearTimeout(stop); if (buf) { add(buf); buf = ""; } var fin = function () { clearTimeout(pT); pT = 0; build(true); }; names.then(fin, fin); });
    }
    var grpOf = function (id) { id = String(id || ""); return !last ? null : id.charAt(0) === "f" ? (last.fgroups || [])[+id.slice(1)] : last.groups[+id]; };
    // 一处一行：找到的字要落在看得见的宽度里——前面的字太长就从前面截掉（… 开头），找到的字放在这行前三成以内，后面交给省略号
    var meas = document.createElement("canvas").getContext("2d");
    function hitIn(s0, q, rx, m) { if (m) { var k = s0.indexOf(m); if (k >= 0) return [k, m.length]; } rx.lastIndex = 0; var r = rx.exec(s0); return r ? [r.index, r[0].length] : [-1, 0]; }
    function fitHit(t, q, px, rx, mt) {
      var had = t[0] === "…", s0 = had ? t.slice(1) : t, i = hitIn(s0, q, rx, mt)[0];
      if (i < 0) return t;
      var pre = s0.slice(0, i), lead = Math.max(48, px * 0.3);
      if (meas.measureText(pre).width <= lead) return (had ? "…" : "") + s0;
      var k = pre.length;
      while (k > 0 && meas.measureText("…" + pre.slice(k - 1)).width <= lead) k--;
      return "…" + pre.slice(k) + s0.slice(i);
    }
    function paint() {
      if (!last) return;
      var q = last.q, total = last.groups.reduce(function (n, g) { return n + g.count; }, 0);
      var cs = getComputedStyle(res), px = Math.max(80, res.clientWidth - 28 - 12 - 12 - 24); // 左缩进、右边距、两边的圆角留白、「❯ 」
      meas.font = cs.fontSize + " " + cs.fontFamily;
      var rx = last.rx;
      var hl = function (t0, mt) { var t = fitHit(t0, q, px, rx, mt), hm = hitIn(t, q, rx, mt), i = hm[0], n = hm[1]; return i < 0 ? esc(t) : esc(t.slice(0, i)) + '<b class="st-hit">' + esc(t.slice(i, i + n)) + "</b>" + esc(t.slice(i + n)); };
      // 对话和文件分开找（上面的范围三选一）：对话只列对话；文件只列「文件」那一节（标题写在哪个文件夹里找的）
      var secs = false, sum = total ? last.groups.length + " 个对话中有 " + total + " 个结果" : last.pending ? "" : "未找到结果";
      var secHead = function (k, name, path, right) { var f0 = !!folds["sec:" + k]; return '<div class="st-ssec" data-sec="' + k + '"><span class="ts-chev ' + (f0 ? "r" : "d") + '"></span><span class="st-ssec-t">' + name + "</span>" + (path ? '<span class="st-ssec-p st-dim">' + esc(path) + "</span>" : "") + '<span class="st-fill"></span><span class="st-dim">' + right + "</span></div>"; };
      var hlName = function (b) { var hm = hitIn(b, q, rx), i = hm[0], n = hm[1]; return i < 0 ? esc(b) : esc(b.slice(0, i)) + '<b class="st-hit">' + esc(b.slice(i, i + n)) + "</b>" + esc(b.slice(i + n)); };
      var fileSec = function () {
        var fg = last.fgroups || [];
        var h0 = secHead("file", "文件", tilde(last.froot), last.fpending ? (fg.length ? fg.length + '</span><span class="st-dim"> · </span><span class="st-dim">' : "") + "正在搜索…" : fg.length ? String(fg.length) : "未找到结果");
        if (folds["sec:file"]) return h0;
        return h0 + fg.map(function (g, gi) {
          var id = "f" + gi, f = !!folds[g.key], cut = g.rel.lastIndexOf("/"), b = g.rel.slice(cut + 1), d = cut > 0 ? g.rel.slice(0, cut) : "", nm = g.kind === "fname";
          var head = '<div class="st-sgh st-sgf" data-g="' + id + '" title="' + esc(tilde(g.path)) + '"><span class="ts-chev ' + (nm ? "st-chev0" : f ? "r" : "d") + '"></span> ' + (window.TSU_FICON ? TSU_FICON(b) : "") + '<span class="st-sfn">' + hlName(b) + '</span><span class="st-dim st-sfd">' + esc(d) + '</span><span class="st-fill"></span>' + (g.count ? '<span class="st-dim">' + g.count + "</span>" : "") + "</div>";
          if (nm || f) return '<div class="st-sg">' + head + "</div>";
          return '<div class="st-sg">' + head + g.hits.map(function (h, hi) { return '<div class="st-sh" data-g="' + id + '" data-h="' + hi + '"><span class="st-dim st-sln">' + h.line + "</span>" + hl(h.text) + "</div>"; }).join("") + "</div>";
        }).join("") + (last.fstopped ? '<div class="st-dim st-spad">只找了 12 秒（文件太多）：在「文件」里打开小一点的文件夹可以找全</div>' : "");
      };
      if (last.files) { res.innerHTML = fileSec(); if (kf) markK(); return; }
      res.innerHTML = (secs ? secHead("conv", "对话", "", sum || (last.pending ? "正在搜索…" : "")) : '<div class="st-dim st-spad">' + sum + (last.pending ? '<span class="st-dim"> · 正在搜索 Claude Code 会话…</span>' : "") + "</div>") + (secs && folds["sec:conv"] ? "" : last.groups.map(function (g, gi) {
        var f = !!folds[g.key];
        return '<div class="st-sg"><div class="st-sgh" data-g="' + gi + '">' + '<span class="ts-chev ' + (f ? "r" : "d") + '"></span> ' + (g.kind === "cc" || g.kind === "ccm" ? '<span class="st-orange st-cclogo">' + ((window.TSU_LOGOS && TSU_LOGOS.claude) || "") + '</span> ' : g.kind === "cx" ? '<span class="st-cclogo">' + ((window.TSU_LOGOS && TSU_LOGOS.codex) || "◎") + '</span> ' : "") + esc(g.title) + '<span class="st-fill"></span><span class="st-dim">' + g.count + "</span></div>" +
          (f ? "" : g.hits.map(function (h, hi) { return '<div class="st-sh" data-g="' + gi + '" data-h="' + hi + '"><span class="st-dim">' + (h.role === "user" ? "❯ " : "⏺ ") + "</span>" + hl(h.text, h.match) + "</div>"; }).join("") + (g.count > g.hits.length ? '<div class="st-dim st-sh">还有 ' + (g.count - g.hits.length) + " 个结果</div>" : "")) + "</div>";
      }).join("")) + (secs ? fileSec() : "");
      if (kf) markK();
    }
    res.addEventListener("click", function (e) {
      var gh = e.target.closest(".st-sgh"), hh = e.target.closest("[data-h]");
      var sec = e.target.closest(".st-ssec");
      if (sec) { folds["sec:" + sec.dataset.sec] = !folds["sec:" + sec.dataset.sec]; return paint(); }
      if (gh && !hh) { var g = grpOf(gh.dataset.g); if (!g) return; if (g.kind === "fname") return openFile(tw, g.path); folds[g.key] = !folds[g.key]; return paint(); } // 只是名字对上的文件：点了打开
      if (hh) { var g2 = grpOf(hh.dataset.g), h = g2 && g2.hits[+hh.dataset.h]; if (!h) return; if (g2.kind === "file") return openFile(tw, g2.path, { line: h.line }); jump(tw, g2, h, last && last.q); } // 文件里的一处：打开、跳到那一行
    });
    res.addEventListener("dblclick", function (e) { var gh = e.target.closest(".st-sgf"); var g = gh && grpOf(gh.dataset.g); if (g && g.path) { e.preventDefault(); openFile(tw, g.path); } }); // 文件那一组：双击打开（单击收起、展开，同 VS Code）
    el.addEventListener("click", function (e) { if (e.target.closest('[data-s="fold"]') && last) { last.groups.concat(last.fgroups || []).forEach(function (g) { folds[g.key] = true; }); paint(); } });
    var rw = 0, rtimer = 0;
    if (window.ResizeObserver) new ResizeObserver(function () { if (res.clientWidth === rw) return; rw = res.clientWidth; clearTimeout(rtimer); rtimer = setTimeout(paint, 60); }).observe(res);
    return el;
  }
  // Paimon 的对话：每个 agent 的每个会话里，你说的、它说的
  // 搜索框的三个开关 → 一个正则（区分大小写、全字匹配、正则）；正则写错了返回 null
  function searchRx(q, o) {
    var src = o.re ? q : q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (o.word) src = "(?<![\\p{L}\\p{N}_])(?:" + src + ")(?![\\p{L}\\p{N}_])";
    try { return new RegExp(src, "g" + (o.cs ? "" : "i") + "u"); } catch (e) { return null; }
  }
  // 开着的标签页里的 Agent：{ agentId: 1 }
  function openAgentIds() { var o = {}; try { (window.TSU_TERM && TSU_TERM.panes ? TSU_TERM.panes() : []).forEach(function (p) { var id = p.program && p.program.agentId; if (id) o[id] = 1; }); } catch (e) { /* 还没好 */ } return o; }
  // Codex 的会话：读进来了的（开着的，或者全部范围时列表里已经载入过的）在内存里找——你说的话、它的回答
  // 开着的 Codex、Claude Code 会话：读进来了的那段在内存里找（不用再去翻这台 Mac 上所有的会话记录——以前「打开的 Agent」也去全部记录里找一遍再筛，两个对话要找几十秒）
  function liveCxHits(rx, openIds) {
    var A2 = window.TSU_AGENTS, out = [];
    if (!A2 || !A2.runtime) return out;
    var snip = function (t, i, n) { var a = Math.max(0, i - 40), b = Math.min(t.length, i + n + 60); return (a ? "…" : "") + t.slice(a, b).replace(/\s+/g, " ") + (b < t.length ? "…" : ""); };
    Object.keys(openIds || openAgentIds()).filter(function (id) { return /^c[xc]:/.test(id); }).forEach(function (id) {
      var rt = null; try { rt = A2.runtime(id); } catch (e) { rt = null; }
      if (!rt || !rt.session) return;
      var sess = rt.session(), g = { kind: /^cc:/.test(id) ? "ccm" : "cx", key: id, id: id, title: (rt.agent && rt.agent.name) || sess.title || id, count: 0, hits: [] };
      (sess.turns || []).forEach(function (t, ti) {
        var texts = [];
        if (typeof t.ask === "string" && t.ask) texts.push(["user", t.ask]);
        (t.parts || []).forEach(function (p) { if (p.kind === "text" && p.text) texts.push(["assistant", p.text]); });
        var nth = 0; // 这一问里的第几处
        texts.forEach(function (x) { rx.lastIndex = 0; var m; while ((m = rx.exec(x[1]))) { if (!m[0].length) { rx.lastIndex++; continue; } g.count++; nth++; if (g.hits.length < 40) g.hits.push({ role: x[0], text: snip(x[1], m.index, m[0].length), match: m[0].replace(/\s+/g, " "), turn: ti, t: t, nth: nth }); } });
      });
      if (g.count) out.push(g);
    });
    return out;
  }
  function paimonHits(rx) {
    var A2 = window.TSU_AGENTS, out = [];
    if (!A2) return out;
    var snip = function (t, i, n) { var a = Math.max(0, i - 40), b = Math.min(t.length, i + n + 60); return (a ? "…" : "") + t.slice(a, b).replace(/\s+/g, " ") + (b < t.length ? "…" : ""); };
    A2.list().forEach(function (a) {
      var g = { kind: "pm", key: "pm:" + a.id, id: a.id, title: a.name, count: 0, hits: [] };
      A2.allSessions().filter(function (x) { return x.agentId === a.id; }).forEach(function (sess) {
        sess.turns.forEach(function (t, ti) {
          var texts = [];
          if (typeof t.ask === "string" && t.ask && !t.system) texts.push(["user", t.ask]);
          (t.parts || []).forEach(function (p) { if (p.kind === "text" && p.text) texts.push(["assistant", p.text]); });
          texts.forEach(function (x) {
            rx.lastIndex = 0;
            var m;
            while ((m = rx.exec(x[1]))) {
              if (!m[0].length) { rx.lastIndex++; continue; }
              g.count++;
              if (g.hits.length < 40) g.hits.push({ role: x[0], text: snip(x[1], m.index, m[0].length), match: m[0].replace(/\s+/g, " "), session: sess.id, turn: ti });
            }
          });
        });
      });
      if (g.count) out.push(g);
    });
    return out;
  }
  // 跳过去：打开那个对话（已经开着就切过去），滚到那一问
  function jump(tw, g, h, q) {
    var find = function (aid) { var hit = null; tw.ws.all().forEach(function (p) { if (!hit && p.program && p.program.agentId === aid) hit = p; }); return hit; };
    // 跳到找到的那一处（不是那一问的开头）：把找到的字交给对话那边，它在那一问里找到这几个字、滚到眼前、亮一下
    var needle = h.match || q || "";
    var reveal = function (p, getTurn) {
      var n = 0, go = function () { var t = getTurn(); if (t && p.program && p.program.reveal && p.program.reveal(t, needle, h.nth, h.text)) return; if (++n < 30) setTimeout(go, 120); };
      go();
    };
    if (g.kind === "pm") {
      var A2 = window.TSU_AGENTS, rt = A2.runtime(g.id);
      if (rt.session().id !== h.session) rt.resume(h.session);
      if (tw.side) tw.side.open(g.id);
      var p = find(g.id);
      if (p) reveal(p, function () { return rt.session().turns[h.turn]; });
      return;
    }
    if (g.kind === "cx" || g.kind === "ccm") { // 开着的 Codex、Claude Code 会话：切到它的标签页，滚到那一处
      if (window.TSU_TERM && TSU_TERM.agent) TSU_TERM.agent(g.id);
      var rt2 = window.TSU_AGENTS && TSU_AGENTS.runtime ? TSU_AGENTS.runtime(g.id) : null;
      setTimeout(function () { var p3 = find(g.id); if (p3 && rt2) reveal(p3, function () { return h.t && rt2.session().turns.indexOf(h.t) >= 0 ? h.t : rt2.session().turns[h.turn]; }); }, 60);
      return;
    }
    if (!window.TSU_CLAUDE || !tw.side || !tw.side.viewCC) return;
    var p2 = tw.side.viewCC(g.id, g.info), crt = TSU_CLAUDE.ensure(g.id, g.info);
    crt.reveal(h.uuid, h.offset).then(function (t) { var pp = find(TSU_CLAUDE.id(g.id)) || p2; if (t && pp) reveal(pp, function () { return t; }); });
  }

  // ⚙ 管理菜单（同 VS Code 左下那个）
  var MIc = function (b) { return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">' + b + "</svg>"; };
  var MI = {
    palette: MIc('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6"/><path d="M4.6 6.4l2 1.6-2 1.6M8 9.8h3.4"/>'),
    gear: MIc('<circle cx="8" cy="8" r="2"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"/>'),
    json: MIc('<path d="M6 2.5C4.8 2.5 4.3 3 4.3 4.2v1.6c0 .8-.5 1.4-1.3 1.7.8.3 1.3.9 1.3 1.7v1.6c0 1.2.5 1.7 1.7 1.7M10 2.5c1.2 0 1.7.5 1.7 1.7v1.6c0 .8.5 1.4 1.3 1.7-.8.3-1.3.9-1.3 1.7v1.6c0 1.2-.5 1.7-1.7 1.7"/>'),
    keys: MIc('<rect x="1.5" y="4" width="13" height="8.4" rx="1.6"/><path d="M4 6.7h.3M6.3 6.7h.3M8.6 6.7h.3M10.9 6.7h.3M4.8 9.6h6.4"/>'),
    ui: MIc('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6"/><path d="M1.8 5.6h12.4M4.6 8.4h3.6M4.6 10.6h6"/>'),
    tui: MIc('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6"/><path d="M4.6 6.4l2 1.6-2 1.6M8 9.8h3.4"/>'),
    gui: MIc('<rect x="3.5" y="1.8" width="9" height="10.4" rx="1.4"/><rect x="5" y="3.3" width="6" height="4.7" rx=".6"/><path d="M8.9 10.2h1.9M4.7 12.2v1.9h6.6v-1.9"/>'), // 图形界面（GUI）：一台经典的 Macintosh（屏幕、软盘口、底座），同 TUI 那个终端一样的线条
    os_vscode: MIc('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6"/><path d="M4.4 3v10M1.8 11h12.4"/>'),
    os_claude: window.TSU_LOGOS && TSU_LOGOS.claudePath ? '<svg viewBox="-13 -13 126 127"><path fill="currentColor" d="' + TSU_LOGOS.claudePath + '"/></svg>' : MIc('<circle cx="8" cy="8" r="5.6"/>'), // Claude App 风格：Claude 自己的标志（ext.js），不是画出来的星号；四周留一圈同别的图标的边距。颜色同别的图标（菜单里黑的，不是灰的）
    os_terminal: MIc('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6"/><path d="M4.6 6.4l2 1.6-2 1.6M8 9.8h3.4"/>'),
    os_macos: MIc('<rect x="1.8" y="2.4" width="12.4" height="9.2" rx="1.6"/><path d="M1.8 4.6h12.4M5 13.6h6M4.4 11.6l-.6 2M11.6 11.6l.6 2"/>'),
    macos: MIc('<rect x="1.8" y="2.4" width="12.4" height="9.2" rx="1.6"/><path d="M1.8 4.6h12.4M5 13.6h6M4.4 11.6l-.6 2M11.6 11.6l.6 2"/><circle cx="3.4" cy="3.5" r=".35" fill="currentColor"/>'),
    scheme: MIc('<path d="M8 1.8a6.2 6.2 0 1 0 0 12.4c1 0 1.3-.7 1-1.4-.3-.9.2-1.7 1.2-1.7h1.6a2.4 2.4 0 0 0 2.4-2.4A6.2 6.2 0 0 0 8 1.8z"/><circle cx="4.9" cy="7.4" r=".7"/><circle cx="7.3" cy="4.9" r=".7"/><circle cx="10.4" cy="5.6" r=".7"/>'),
    highlight: MIc('<path d="M5 4.2L1.8 8 5 11.8M11 4.2L14.2 8 11 11.8M9.4 3l-2.8 10"/>'),
    layout: MIc('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6"/><path d="M6.2 2.8v10.4M6.2 8.6h8"/>'),
    act: MIc('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6"/><path d="M4.4 3v10"/>'),
    sideL: MIc('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6"/><path d="M6.4 3v10"/><path d="M2.4 3.4h3.8v9.2H2.4z" fill="currentColor" stroke="none" opacity=".35"/>'),
    sideR: MIc('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6"/><path d="M9.6 3v10"/><path d="M9.8 3.4h3.8v9.2H9.8z" fill="currentColor" stroke="none" opacity=".35"/>'),
    panel: MIc('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6"/><path d="M2 9.4h12"/><path d="M2.4 9.6h11.2v3H2.4z" fill="currentColor" stroke="none" opacity=".35"/>'),
    status: MIc('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6"/><path d="M2 11.2h12"/>'),
    crumbs: MIc('<path d="M2 8h3.2M6.2 5.8L8.4 8l-2.2 2.2M10 5.8L12.2 8 10 10.2"/>'),
    minimap: MIc('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6"/><path d="M10.4 3v10M4 5.6h4M4 7.6h3M4 9.6h4.4M11.6 5.4h1.4M11.6 7h1"/>'),
    lineNo: MIc('<path d="M2.6 4.5h1.2M2.6 8h1.2M2.6 11.5h1.2M5.8 2.5v11M8 4.5h5.4M8 8h4M8 11.5h5"/>'), // 行号：左边一列短横、一条分隔线、右边几行字
    full: MIc('<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>'),
    zen: MIc('<circle cx="8" cy="8" r="5.6"/><circle cx="8" cy="8" r="2.4"/>'),
    title: MIc('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6"/><path d="M2 5.4h12M5 4.1h6"/>'),
    splitR: MIc('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6"/><path d="M8 3v10"/>'),
    splitD: MIc('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6"/><path d="M2 8h12"/>'),
    close: MIc('<path d="M4 4l8 8M12 4l-8 8"/>'),
    closeOthers: MIc('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6"/><path d="M6.4 6.4l3.2 3.2M9.6 6.4l-3.2 3.2"/>'),
    msg: MIc('<path d="M2.5 3.5h11v7.2H7.2L4.4 13v-2.3H2.5z"/>'),
    answer: MIc('<path d="M8 2.2c.5 3.1 2.2 4.8 5.3 5.3-3.1.5-4.8 2.2-5.3 5.3-.5-3.1-2.2-4.8-5.3-5.3 3.1-.5 4.8-2.2 5.3-5.3z"/>'),
    think: MIc('<path d="M5.4 12.2c-2 0-3.4-1.3-3.4-3 0-1.4 1-2.5 2.3-2.8C4.6 4.4 6.1 3 8 3c1.8 0 3.3 1.2 3.7 2.9 1.3.3 2.3 1.5 2.3 2.9 0 1.8-1.4 3.4-3.4 3.4z"/>'),
    tool: MIc('<path d="M10.2 2.4a3 3 0 0 0-3.4 4L2.6 10.6a1.3 1.3 0 0 0 1.8 1.8l4.2-4.2a3 3 0 0 0 4-3.4l-1.8 1.8-1.8-.4-.4-1.8z"/>'),
    diff: MIc('<path d="M5 2.5v6M2 5.5h6M9.5 11.5h4.5M3.5 13.5l9-11"/>'),
    web: MIc('<circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c1.8 1.8 2.6 3.8 2.6 6s-.8 4.2-2.6 6M8 2C6.2 3.8 5.4 5.8 5.4 8s.8 4.2 2.6 6"/>'),
    term: MIc('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6"/><path d="M4.6 6.4l2 1.6-2 1.6M8 9.8h3.4"/>'),
    recap: MIc('<path d="M2.6 8a5.4 5.4 0 1 0 1.6-3.8M2.4 2.8v2.6H5"/><path d="M8 5.2V8l2 1.2"/>'),
    done: MIc('<path d="M3.2 8.4l3 3 6.6-6.6"/>'),
    bell: MIc('<path d="M4.2 11V7.4a3.8 3.8 0 0 1 7.6 0V11l1 1.2H3.2zM6.6 13.4a1.5 1.5 0 0 0 2.8 0"/>'),
    update: MIc('<circle cx="8" cy="8" r="5.8"/><path d="M8 4.9v5.4M5.6 8l2.4 2.4L10.4 8"/>'), // 升级（有新版本、检查更新）：圆里一个向下的箭头
    about: MIc('<circle cx="8" cy="8" r="5.8"/><path d="M8 7.3v3.6M8 5.1v.01"/>'), // 关于：圆里一个 i
    // 后台任务的通知（跑完的命令、子 Agent 回来的结果送进对话）：收件盘——「有东西送到了」，不像铃铛那样吵
    tray: MIc('<path d="M2.2 9.2l1.7-5.4c.1-.4.5-.6.9-.6h6.4c.4 0 .8.2.9.6l1.7 5.4v3a1 1 0 0 1-1 1H3.2a1 1 0 0 1-1-1z"/><path d="M2.4 9.2h3.2l.8 1.6h3.2l.8-1.6h3.2"/>'),
    // 过程说明（一问里夹在工具调用之间的话）：说着话的气泡里三个点——还在做；最终回复是 ✦（answer）
    note: MIc('<path d="M2.5 3.5h11v7.2H7.2L4.4 13v-2.3H2.5z"/><path d="M5.4 7.1h.1M8 7.1h.1M10.6 7.1h.1" stroke-width="1.8"/>'),
    image: MIc('<rect x="2" y="3" width="12" height="10" rx="1.6"/><circle cx="5.6" cy="6.4" r="1.1"/><path d="M2.4 11.4l3.4-3 2.4 2.2 2-1.6 3.4 2.8"/>'),
    composer: MIc('<rect x="1.8" y="4.6" width="12.4" height="6.8" rx="2"/><path d="M4.4 8h4.4"/>'),
    // 哪儿都不用眼睛图标（不好看）：「隐藏 …」用那块东西自己的图标（辅助侧栏、面板……），剩下的用圆里一横；eye 这个名字还留着（旧代码引用），画的是「信息」
    hide: MIc('<circle cx="8" cy="8" r="5.8"/><path d="M5.2 8h5.6"/>'),
    eye: MIc('<circle cx="8" cy="8" r="5.8"/><path d="M8 7.2v3.8M8 4.9v.1"/>'),
    info: MIc('<circle cx="8" cy="8" r="5.8"/><path d="M8 7.2v3.8M8 4.9v.1"/>'), // 状态信息
    sliders: MIc('<path d="M2.5 4.5h1.7M6.8 4.5h6.7M2.5 8h6.7M11.8 8h1.7M2.5 11.5h3M8.1 11.5h5.4"/><circle cx="5.5" cy="4.5" r="1.3"/><circle cx="10.5" cy="8" r="1.3"/><circle cx="6.8" cy="11.5" r="1.3"/>'), // 显示哪几块
    filter: MIc('<path d="M2.4 4h11.2M4.4 8h7.2M6.4 12h3.2"/>'), // 视图预设
    hidden: MIc('<rect x="2.6" y="2.6" width="10.8" height="10.8" rx="1.8" stroke-dasharray="2 1.6"/>'), // 显示隐藏文件
    invert: MIc('<path d="M2.6 5.4h9.6M9.8 3l2.4 2.4-2.4 2.4M13.4 10.6H3.8M6.2 8.2l-2.4 2.4 2.4 2.4"/>'), // 反选
    clock: MIc('<circle cx="8" cy="8" r="5.8"/><path d="M8 4.8V8l2.2 1.4"/>'), // 时间戳
    stop: MIc('<rect x="3.6" y="3.6" width="8.8" height="8.8" rx="1.6"/>'), // 停止
    workline: MIc('<path d="M4.6 2.5h6.8M4.6 13.5h6.8M5.3 2.5c0 2.9 5.4 3.3 5.4 5.5s-5.4 2.6-5.4 5.5M10.7 2.5c0 2.9-5.4 3.3-5.4 5.5s5.4 2.6 5.4 5.5"/>'), // 运行状态行（在跑的那一行：沙漏）
    checklist: MIc('<path d="M2.4 4.2l1.1 1.1 1.9-2M2.4 9.2l1.1 1.1 1.9-2M7.4 4.4h6.2M7.4 9.4h6.2M7.4 13h4"/>'), // 任务清单（勾着的清单）
    fork: MIc('<circle cx="5" cy="3.6" r="1.5"/><circle cx="11" cy="3.6" r="1.5"/><circle cx="8" cy="12.4" r="1.5"/><path d="M5 5.1v1.2c0 .9.7 1.6 1.6 1.6h2.8c.9 0 1.6-.7 1.6-1.6V5.1M8 7.9v3"/>'), // 子 Agent（同对话里子 Agent 那个分叉图标）
    open: MIc('<path d="M9.5 2.5h4v4M13.5 2.5L8 8M12 9.5v3.5H3V4h3.5"/>'),
    tab: MIc('<path d="M1.8 5.2h5l1-1.6h6.4v9.6H1.8z"/>'),
    window: MIc('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6"/><path d="M1.8 5.6h12.4"/>'),
    rename: MIc('<path d="M10.8 2.7l2.5 2.5-7.6 7.6H3.2v-2.5z"/>'),
    archive: MIc('<rect x="1.8" y="3" width="12.4" height="3" rx=".8"/><path d="M3 6v6.6h10V6M6.4 8.6h3.2"/>'),
    history: MIc('<path d="M2.6 8a5.4 5.4 0 1 0 1.6-3.8M2.4 2.8v2.6H5"/><path d="M8 5.2V8l2 1.2"/>'),
    collapse: MIc('<rect x="2.5" y="2.5" width="11" height="11" rx="1.6"/><path d="M5.4 8h5.2"/>'),
    discard: MIc('<path d="M5.6 3.4L2.8 6.2l2.8 2.8"/><path d="M3 6.2h6.4a3.6 3.6 0 0 1 0 7.2H7"/>'),
    agent: MIc('<path d="M7 2.6c.4 2.9 1.9 4.4 4.8 4.8-2.9.4-4.4 1.9-4.8 4.8-.4-2.9-1.9-4.4-4.8-4.8 2.9-.4 4.4-1.9 4.8-4.8z"/><path d="M12.4 1.6c.1 1 .6 1.5 1.6 1.6-1 .1-1.5.6-1.6 1.6-.1-1-.6-1.5-1.6-1.6 1-.1 1.5-.6 1.6-1.6z"/>'),
  };
  var LIc = function (b) { return MIc('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6"/>' + b); };
  var FILL = ' fill="currentColor" stroke="none"';
  var LI = {
    // 活动栏位置：左边一条 / 主侧栏上面一排 / 主侧栏下面一排
    actSide: LIc('<path d="M2.4 3.4h2.2v9.2H2.4z"' + FILL + '/><path d="M7.2 3v10"/>'),
    actTop: LIc('<path d="M2.4 3.4h4.6v1.8H2.4z"' + FILL + '/><path d="M7.2 3v10"/>'),
    actBottom: LIc('<path d="M2.4 10.8h4.6v1.8H2.4z"' + FILL + '/><path d="M7.2 3v10"/>'),
    // 面板对齐：面板（下面实的一块）从哪到哪
    paLeft: LIc('<path d="M10.6 3v10M5.4 3v6"/><path d="M2.4 9.2h8.2v3.4H2.4z"' + FILL + '/>'),
    paRight: LIc('<path d="M5.4 3v10M10.6 3v6"/><path d="M5.4 9.2h8.2v3.4H5.4z"' + FILL + '/>'),
    paCenter: LIc('<path d="M5.4 3v10M10.6 3v10"/><path d="M5.4 9.2h5.2v3.4H5.4z"' + FILL + '/>'),
    paJustify: LIc('<path d="M5.4 3v6M10.6 3v6"/><path d="M2.4 9.2h11.2v3.4H2.4z"' + FILL + '/>'),
    // 快速输入（命令面板）：顶上 / 中间
    qiTop: MIc('<path d="M8 13V4M4.6 7.2L8 3.8l3.4 3.4"/>'),
    qiCenter: MIc('<circle cx="8" cy="8" r="2.6"/>'),
    // 布局密度：行距宽 / 窄
    dnDefault: MIc('<path d="M2.5 3.5h11M2.5 8h11M2.5 12.5h11"/>'),
    dnCompact: MIc('<path d="M2.5 5.5h11M2.5 8h11M2.5 10.5h11"/>'),
    // 缩略图：右边那一条——实的 / 带上下箭头（滚动时）/ 虚线（透明）/ 没有
    mm_show: LIc('<path d="M4 5.6h4M4 7.6h3M4 9.6h4.4"/><path d="M10.6 3.4h3v9.2h-3z"' + FILL + ' opacity=".55"/>'),
    mm_scroll: LIc('<path d="M4 5.6h4M4 7.6h3M4 9.6h4.4M10.4 3v10"/><path d="M12.2 5.2v5.6M11.2 6.2l1-1 1 1M11.2 9.8l1 1 1-1"/>'),
    mm_transparent: LIc('<path d="M4 5.6h4M4 7.6h3M4 9.6h4.4"/><path d="M10.6 3.6v8.8" stroke-dasharray="1.2 1.4"/>'),
    mm_hide: LIc('<path d="M4 5.6h4M4 7.6h3M4 9.6h4.4"/>'),
  };
  var KIND_ICONS = { prompts: "msg", answers: "answer", thinking: "think", tools: "tool", diffs: "diff", web: "web", bashOut: "term", recaps: "recap", doneLine: "done", notices: "tray", images: "image", progress: "note" };
  function manageMenu(tw, anchor, side) {
    var mi = function (label, keys, run, o) { return Object.assign({ label: label, keys: keys || "", run: run }, o || {}); };
    menu([
      // 设置 › 风格 › 主题……（用户：风格放在设置和主题中间）；命令面板不再放在这里（⇧⌘P 照样能开）
      mi("设置", "⌘,", function () { settings(tw, sectionFor(tw)); }, { icon: MI.gear }),
      // 应用风格、Agent 显示风格合成一项「风格」（用户：两个并排的二级菜单太占地方）：点开是两段，各自一个小标题
      mi("风格", "", null, { icon: MI.os_macos, items: function () {
        var forced = OS_UI[getv("os", true)];
        return [{ header: true, label: "应用风格" }].concat(osModesNow().map(function (x) { return mi(x[1], "⌃⌘" + x[2], function () { setv("os", x[0]); }, { radio: true, checked: (getv("os", true) || "vscode") === x[0], icon: MI["os_" + x[0]] }); }),
          [{ sep: true }, { header: true, label: "Agent 显示风格" }], UI_MODES.map(function (x) { var off = !!forced && forced !== x[0]; return mi(x[1] + (off ? "（" + NA + "）" : ""), "", function () { setv("ui", x[0]); }, { radio: true, checked: getv("ui", true) === x[0], icon: MI[x[0]], disabled: off }); }));
      } }),
      // 连接器（活动栏里就有、⇧⌘X）和键盘快捷方式（在设置里）不再单列在这里
      // 两个配色合成一个「主题」（同 VS Code）
      mi("主题", "", null, { icon: MI.scheme, items: [mi("配色方案…", "⌘K ⌘T", function () { pickScheme(tw); }, { icon: MI.scheme }), mi("高亮配色…", "", function () { pickHighlight(tw); }, { icon: MI.highlight })] }),
      mi("自定义布局…", "", function () { layoutPick(tw); }, { icon: MI.layout }),
      mi("显示语言…", "", function () { pickLang(tw); }, { icon: MI.web }),
      // 网页版 / iPad：借你的 Mac 用（remote.js）；连着的时候能断开。App 里：开一个窗口连另一台 Mac（连着另一台的窗口里也能再开一台）
      window.TSU_REMOTE && !TSU_REMOTE.hybrid ? mi(TSU_REMOTE.mac() ? "换一台 Mac / 断开…" : "连接到我的 Mac…", "", function () { pickMac(tw); }, { icon: MI.term, sym: "laptopcomputer" }) :
        canOpenMac() ? mi("连接到另一台 Mac…", "", function () { pickMac(tw); }, { icon: MI.term, sym: "laptopcomputer" }) : null,
      // iPad App 里（Classic 界面）：换成 iPad 原生的界面（App 自己画的列表、输入框、顶栏）
      window.vsApp && window.webkit && webkit.messageHandlers && webkit.messageHandlers.vsApp && !/iPhone/.test(navigator.userAgent) ? mi("切换到原生界面", "", function () { webkit.messageHandlers.vsApp.postMessage({ type: "setMode", mode: "native" }); }, { icon: MI.term, sym: "ipad" }) : null,
      { sep: true },
      mi("检查更新…", "", function () { checkNow(); }, { icon: MI.update, sym: "arrow.down.circle" }),
      mi("关于 Vibing Studio", "", function () { settings(tw, "about"); }, { icon: MI.about, sym: "info.circle" }),
    ].filter(Boolean).concat(updItem(mi)), { el: anchor, side: side || "right-up" }); // 有新版本：⚙ 上一个点，菜单最后一项（同 VS Code 的「重启以更新」），带新版本号；图标是升级（不是「重新载入」的转圈）
  }
  // 选连哪台 Mac：这个账号现在在线的 Mac（这台自己不算）。网页版 / iPad：这一页换成用它（连着的时候多一项「断开」）；
  //   App 里：开一个窗口连它（已经开着就叫到前面，同 VS Code 的远程窗口）
  var canOpenMac = function () { var N = window.nadosNative; if (!N || !N.call) return false; if (!appInfo) { nativeInfo(); return false; } return (appInfo.commands || []).indexOf("remote.open") >= 0; };
  function openMac(id, name) {
    var R = window.TSU_REMOTE, N = window.nadosNative;
    if (R) return R.use(id, name);
    if (N && N.call) return N.call("remote.open", { mac: id, name: name || "" }).catch(function (e) {
      if (window.TSU_DESK && TSU_DESK.alert) TSU_DESK.alert({ title: "没能打开这台 Mac。", message: e && e.code === "E_UNKNOWN_CMD" ? "这个版本的 App 还不能连接另一台 Mac：在 ⚙ 菜单里检查更新，重启以更新后再试。" : String((e && e.message) || e), icon: "none", buttons: [{ label: "好", role: "default" }] });
    });
  }
  function pickMac(tw) {
    tw = tw || (T() && T().front ? T().front() : null);
    var R = window.TSU_REMOTE, cur = R ? R.mac() : "", self = window.TSU_REMOTE_HOST && TSU_REMOTE_HOST.device ? TSU_REMOTE_HOST.device() : "";
    var pick = R ? R.pick() : fetch("/api/relay/hosts", { credentials: "same-origin", cache: "no-store" }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; });
    pick.then(function (hosts) {
      var items = (hosts || []).filter(function (h) { return h && h.device && h.device !== self; }).map(function (h) { return { id: h.device, title: h.name || "Mac", desc: h.device === cur ? "正在用" : "在线", on: h.device === cur }; });
      if (cur && R && !R.hybrid) items.push({ id: "", title: "断开连接（仅使用网页版）", desc: "" });
      if (!items.length) return TSU_DESK && TSU_DESK.alert ? TSU_DESK.alert({ title: "没有可连接的 Mac。", message: "在另一台 Mac 上的 Vibing Studio 里打开 设置 › 通用 › 「其他设备使用这台 Mac」。", icon: "none", buttons: [{ label: "好", role: "default" }] }) : null;
      quickPick(tw, { placeholder: "选择要连接的 Mac", items: items, pick: function (it) { openMac(it.id, it.title); } });
    });
  }
  // ⚙ 菜单最后那一项（只有一项）：App 有新版、下好了（重启时界面也一起换上）→「重启以更新（v…）」；正在下载 →「正在下载更新…」；只有界面的新版 →「重新载入以更新（v…）」
  function updItem(mi) {
    var v = function (x) { return x ? "（v" + String(x).replace(/^v/, "") + "）" : ""; };
    if (appUpd) return [{ sep: true }, mi("重启以更新" + v(appUpd.ver), "", function () { appUpdateNow(); }, { icon: MI.update, sym: "arrow.down.circle.fill" })];
    if (remoteDl) return [{ sep: true }, mi("正在下载更新" + v(remoteDl) + "…", "", null, { icon: MI.update, sym: "arrow.down.circle", disabled: true })];
    if (updateReady) return [{ sep: true }, mi("重新载入以更新" + v(uiVer.next), "", function () { location.reload(); }, { icon: MI.update, sym: "arrow.down.circle.fill" })];
    return [];
  }
  // 检查更新（同 VS Code 的「检查更新…」）：马上看一次本地的界面文件 / 网站；有就问要不要重新载入，没有就说现在是最新的（带版本号）
  function checkNow() {
    // App 本身、界面一起查（以前只查界面：App 有新版时也说「没有可用的更新」）；App 有新版就当场下载，下好了问要不要重启
    var A0 = window.TSU_DESK && TSU_DESK.alert ? TSU_DESK.alert : null, v = function (x) { return x ? "（v" + String(x).replace(/^v/, "") + "）" : ""; };
    if (!A0) { checkVersion(true); checkRemoteApp(true); return; }
    checkVersion(true);
    var slow = setTimeout(function () { A0({ title: "正在检查和下载更新…", message: "下载好后 ⚙ 菜单最下面会出现「重启以更新」。", icon: "none", buttons: [{ label: "好", role: "default" }] }); }, 1500);
    Promise.all([checkRemoteApp(true), checkSite()]).then(function (rs) {
      var r = rs[0];
      clearTimeout(slow);
      redrawSettings();
      return readVer().then(function (nv) {
        if (updateReady) uiVer.next = nv || uiVer.next;
        if (appUpd) return A0({ title: "有新版本" + v(appUpd.ver) + "，已经下载好。", message: "重启以更新：标签页、会话都会接回去；旧版本留在「Application Support / Vibing Studio / previous」。", icon: "none", buttons: [{ label: "稍后", role: "cancel" }, { label: "重启以更新", role: "default", run: function () { appUpdateNow(); } }] });
        if (r && r.state === "error") return A0({ title: "检查更新没有成功。", message: r.error + "。稍后再试，或者到 GitHub 的发行版页面下载。", icon: "none", buttons: [{ label: "好", role: "default" }] });
        if (updateReady) return A0({ title: "有可用的更新" + v(uiVer.next) + "。", message: "重新载入以更新：终端、会话都会接回去。", icon: "none", buttons: [{ label: "稍后", role: "cancel" }, { label: "重新载入", role: "default", run: function () { location.reload(); } }] });
        // 这台 Mac 从本机文件夹读界面，那一份比网站上的旧（iCloud 没同步过来、以前装的一份）：说清楚，能换就给一个按钮
        if (siteNewer()) return A0({ title: "网站上有更新的界面" + v(uiVer.site) + "。", message: "这台 Mac 用的是本机文件夹里的一份" + v(uiVer.cur) + "：" + tilde(window.TSU_UI_LOCAL.dir) + "。" + (canSource() ? "改用网站上的界面后，以后都跟着网站更新。" : "这一版 App 不能切换；更新 App 后会自动改用网站上的界面。"), icon: "none",
          buttons: canSource() ? [{ label: "稍后", role: "cancel" }, { label: "改用网站上的界面", role: "default", run: function () { useSite(); } }] : [{ label: "好", role: "default" }] });
        A0({ title: "当前已是最新版本" + v(uiVer.cur) + "。", icon: "none", buttons: [{ label: "好", role: "default" }] });
      });
    });
  }
  // 网站上最新的界面版本（本机读界面时拿来比：本机那份旧了就说）
  function checkSite() { return siteVerJ().then(function (j) { if (j) { uiVer.site = String(j.version); uiVer.siteBuild = +j.build || 0; } uiVer.siteAt = Date.now(); return j; }); }
  var buildOf = function (v, b) { return +b || +String(v || "").split(".").pop() || 0; }; // 版本号最后一段就是构建号（0.2.1.432、早先的 0.2.426）
  function siteNewer() { return !!(window.TSU_UI_LOCAL && uiVer.site && uiVer.cur && buildOf(uiVer.site, uiVer.siteBuild) > buildOf(uiVer.cur, uiVer.curBuild)); }
  // App 能不能换界面来源（新版原生才有 ui.source）
  var appInfo = null;
  function nativeInfo() { var N = window.nadosNative; if (!N || !N.call) return Promise.resolve(null); if (appInfo) return Promise.resolve(appInfo); return N.call("info").then(function (i) { appInfo = i || {}; return appInfo; }, function () { appInfo = {}; return appInfo; }); }
  function canSource() { return !!(appInfo && (appInfo.commands || []).indexOf("ui.source") >= 0); }
  function useSite() { var N = window.nadosNative; if (!N || !N.call || !canSource()) return; if (window.TSU_FLUSH) TSU_FLUSH(); N.call("ui.source", { source: "site" }).then(function () { location.reload(); }, function (e) { if (window.TSU_DESK && TSU_DESK.alert) TSU_DESK.alert({ title: "没有切换成功。", message: String((e && e.message) || e), icon: "none", buttons: [{ label: "好", role: "default" }] }); }); }

  // ======== 关于（设置 › 关于；⚙ 菜单、App 菜单里的「关于 Vibing Studio」）：版本号（界面、App）、界面从哪儿读的、更新的情况和按钮、更新内容、服务状态 ========
  //   更新那一行写清楚现在是什么情况：已是最新（上次检查的时间）/ 界面有新版本 / App 新版本正在下载、已下载 / 本机那份界面比网站上的旧 / 上次检查失败（原因）
  var aboutAt = 0;
  function aboutLoad() {
    if (!appInfo && window.nadosNative) nativeInfo().then(function () { redrawSettings(); });
    if (Date.now() - aboutAt > 10 * 60000) { aboutAt = Date.now(); checkSite().then(function () { redrawSettings(); }); }
  }
  function updState(L2) {
    var vv = function (x) { return x ? " " + String(x).replace(/^v/, "") : ""; }, when = function (t) { return new Date(t).toLocaleTimeString(L2("zh-CN", "en-US"), { hour: "numeric", minute: "2-digit" }); };
    if (appUpd) return { text: L2("App 新版本" + vv(appUpd.ver) + " 已下载好，重启后换上（标签页、会话都会接回去）", "App" + vv(appUpd.ver) + " is downloaded; restart to update (tabs and sessions come back)"), btn: "重启以更新", act: "appUpdate" };
    if (remoteDl) return { text: L2("正在下载 App" + vv(remoteDl) + "…", "Downloading App" + vv(remoteDl) + "…"), btn: "检查更新", act: "check" };
    if (updateReady) return { text: L2("界面有新版本" + vv(uiVer.next), "A new interface version is available:" + vv(uiVer.next)), btn: "重新载入", act: "reload" };
    if (siteNewer()) return { text: L2("网站上有更新的界面" + vv(uiVer.site) + "；这台 Mac 用的是本机文件夹里的" + vv(uiVer.cur), "The website has a newer interface:" + vv(uiVer.site) + "; this Mac uses a local copy:" + vv(uiVer.cur)) + (canSource() ? "" : L2("。更新 App 后会自动改用网站上的界面", ". Updating the App switches to the website version automatically")), btn: canSource() ? "改用网站上的界面" : "检查更新", act: canSource() ? "useSite" : "check" };
    if (remoteLast && remoteLast.state === "error") return { text: L2("上次检查 App 更新没有成功：", "The last App update check failed: ") + remoteLast.error, btn: "重试", act: "check" };
    return { text: L2("已是最新版本", "Up to date") + (remoteAt ? L2(" · 上次检查 ", " · Last checked ") + when(remoteAt) : uiVer.siteAt ? L2(" · 上次检查 ", " · Last checked ") + when(uiVer.siteAt) : ""), btn: "检查更新", act: "check" };
  }
  // 芯片：macOS 上 arm64 = Apple 芯片、x86_64 = Intel；别的系统写架构（Linux 的 Node 报 x64）
  function chipOf(A, L2) {
    var mac = (A.platform || "") === "macos", a = String(A.arch || "");
    if (/^(x86_64|x64|amd64)$/.test(a)) return mac ? "Intel" : "x86-64";
    if (/^(arm64|aarch64)$/.test(a)) return mac ? L2("Apple 芯片", "Apple silicon") : "ARM64";
    return a;
  }
  function devRow(A, L2) {
    var SY = window.TSU_SYNC, L0 = LOC() && LOC().info ? LOC().info() : null;
    var model = SY && SY.model ? SY.model() : "", osName = SY && SY.os ? SY.os() : "", name = SY && SY.name ? SY.name() : "";
    if (!osName || /^(macOS|Linux)$/.test(osName)) osName = (L0 && L0.os) || (A && (A.platform || "") === "macos" && A.os ? "macOS " + String(A.os).replace(/\.0$/, "") : osName);
    if (!model && !osName) return null;
    return { key: "abDev", label: "这台设备", must: true, kind: "info", value: model || name || (L0 && L0.host) || "—", desc: [model && name ? name : "", osName].filter(Boolean).join(" · ") };
  }
  addSettings("about", {
    title: "关于", icon: "i", desc: "版本与更新",
    fields: function () {
      aboutLoad();
      var en0 = !!(window.TSU_I18N && TSU_I18N.lang() === "en"), L2 = function (zh, e) { return en0 ? e : zh; }, A = appInfo, LU = window.TSU_UI_LOCAL, N = window.nadosNative, st = updState(L2);
      var day = function (s) { var d = new Date(s); return isNaN(d.getTime()) ? "" : d.toLocaleString(L2("zh-CN", "en-US"), { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); };
      return [
        { key: "abVer", label: "版本", must: true, kind: "info", value: uiVer.cur || "—", desc: uiVer.built ? L2("发布于 ", "Released ") + day(uiVer.built) : "" },
        A && A.version ? { key: "abApp", label: "App", must: true, kind: "info", value: A.version + (A.build ? L2("（构建 " + A.build + "）", " (build " + A.build + ")") : ""), desc: chipOf(A, L2) } : null,
        // 这台设备：同「设备」页的那一张卡片（型号、系统都是它认出来的那一份，Linux 是发行版的名字，不是内核版本）
        devRow(A, L2),
        { key: "abSrc", label: "界面来源", must: true, kind: "info", value: LU ? L2("本机文件夹", "Local folder") : N ? L2("网站", "Website") : L2("网页版", "Web"), desc: LU ? tilde(LU.dir) : location.host },
        { key: "abUpd", label: "更新", must: true, kind: "button", text: st.btn, act: st.act, desc: st.text },
        { key: "abLog", label: "更新内容", must: true, kind: "button", text: "查看", act: "changelog" },
        { key: "abStatus", label: "服务状态", must: true, kind: "button", text: "查看", act: "status" },
      ].filter(Boolean);
    },
    action: function (what, tw) {
      if (what === "check") return checkNow();
      if (what === "reload") return location.reload();
      if (what === "appUpdate") return appUpdateNow();
      if (what === "useSite") return useSite();
      if (what === "changelog" && window.TSU_CHANGELOG) return TSU_CHANGELOG.open(tw);
      if (what === "status") return openPage(tw, "status", "");
    },
  });
  if (window.nadosNative && nadosNative.on) nadosNative.on("app.about", function () { var tw = allWins()[0]; if (tw) settings(tw, "about"); }); // App 菜单「关于 Vibing Studio」
  // 显示语言（同 VS Code 的「配置显示语言」）
  function LANG_AUTO() { return window.TSU_I18N && TSU_I18N.lang && TSU_I18N.lang() === "en" ? "Follow System (跟随系统)" : "跟随系统 (Follow System)"; }
  function pickLang(tw) {
    var cur = getv("lang");
    // 「跟随系统」两种语言都写（认错了语言、界面变成看不懂的那种时，也找得到这一项）；语言的名字本来就是它自己的写法
    quickPick(tw, { placeholder: "选择显示语言", items: [{ id: "auto", title: LANG_AUTO(), on: cur !== "en" && cur !== "zh" }, { id: "en", title: "English", on: cur === "en" }, { id: "zh", title: "简体中文", on: cur === "zh" }],
      pick: function (it) { setv("lang", it.id); if (window.TSU_I18N) TSU_I18N.set(it.id); } });
  }
  function oldLayoutItems(tw, mi) {
    return [mi("布局", "", null, { items: [
        mi("主侧栏", "⌘B", function () { if (tw.side) tw.side.toggle(); }, { checked: !!(tw.side && tw.side.shown()) }),
        mi("辅助侧栏", "⌥⌘I", function () { toggleSide(tw); }, { checked: !!L.side }),
        mi("面板", "⌘J", function () { togglePanel(tw); }, { checked: !!L.panel }),
        { sep: true },
        mi("活动栏", "", function () { setv("activityBar", !getv("activityBar")); }, { checked: !!getv("activityBar") }),
        mi("路径导航", "", function () { setv("breadcrumbs", !getv("breadcrumbs")); }, { checked: !!getv("breadcrumbs") }),
        mi("缩略图", "", null, { value: (MINI_MODES.filter(function (x) { return x[0] === getv("minimap", true); })[0] || ["", ""])[1], items: function () { return MINI_MODES.map(function (x) { return mi(x[1], "", function () { setv("minimap", x[0]); }, { radio: true, checked: getv("minimap", true) === x[0], preview: function (p) { previewSet("minimap", p ? x[0] : null); } }); }); } }),
        mi("状态栏", "", function () { setv("statusBar", !getv("statusBar")); }, { checked: !!getv("statusBar") }),
      ] })];
  }
  // ======== 自定义布局（同 VS Code 的 Customize Layout）：一块浮在上面的选择框——每行一个图标；可见性、界面、缩略图、模式分组，组名在这组第一行右边；
  // 快捷键是一个键一格；勾着的打 ✓；点了（回车、空格）马上换、框不关；右上角 ↺ 恢复默认、× 关 ========
  // 禅模式：收起主侧栏、面板、活动栏、状态栏——都是「暂时收起」（开关画成虚线，点一下就在禅模式里拿回来，不会出不来）；
  //   辅助侧栏（Agent 的目标、在跑的、任务）反而默认打开：和 VS Code 不同，专心看 Agent 干活时它最要紧。退出时全部回到进来前的样子
  var zen = null; // 进来前的样子 + hid：禅模式替你收起的
  function toggleZen(tw) {
    if (zen) {
      var z = zen; zen = null; root.classList.remove("st-zen", "st-zshow-act", "st-zshow-status");
      if (z.side !== !!(tw.side && tw.side.shown()) && tw.side) tw.side.toggle(z.side);
      if (z.aside !== !!L.side) toggleSide(tw, z.aside);
      if (z.panel !== !!L.panel) togglePanel(tw, z.panel);
      layBar(tw); return;
    }
    zen = { side: !!(tw.side && tw.side.shown()), aside: !!L.side, panel: !!L.panel, hid: { act: true, status: true } };
    root.classList.add("st-zen");
    if (tw.side && tw.side.shown()) { tw.side.toggle(false); zen.hid.side = true; }
    if (L.panel) { togglePanel(tw, false); zen.hid.panel = true; }
    if (!L.side) toggleSide(tw, true);
    layBar(tw);
  }
  // 禅模式里把活动栏 / 状态栏拿回来（只在这次禅模式里，不改设置）
  function zenShow(what, on) { root.classList.toggle(what === "act" ? "st-zshow-act" : "st-zshow-status", on); if (zen) zen.hid[what] = !on; }
  function layoutPick(tw) {
    tw = tw || (T() && T().front());
    if (!tw) return;
    if (PAL) { var p1 = PAL; PAL = null; try { p1.close(); } catch (e) { /* 已经关了 */ } }
    var old = document.querySelector(".st-lpick");
    if (old) old.remove();
    var box = document.createElement("div"), sel = 0;
    box.className = "st-palette st-lpick";
    box.tabIndex = -1;
    var N0 = window.nadosNative;
    var items = function () {
      var vis = function (label, icon, on, keys, run) { return { g: "可见性", label: label, icon: icon, on: on, keys: keys, run: run }; };
      var one = function (g, key, opts) { var cur = getv(key, true); return opts.map(function (x) { return { g: g, label: x[1], icon: x[2], on: cur === x[0], radio: true, run: function () { setv(key, x[0]); } }; }); };
      var ap = actPos();
      return [
        zen && ap !== "hidden" ? vis("活动栏", MI.act, !zen.hid.act, "", function () { zenShow("act", !!zen.hid.act); }) : vis("活动栏", MI.act, ap !== "hidden", "", function () { setv("activityBar", ap === "hidden"); }),
        vis("主侧栏", MI.sideL, !!(tw.side && tw.side.shown()), "⌘B", function () { if (tw.side) tw.side.toggle(); }),
        vis("辅助侧栏", MI.sideR, !!L.side, "⌥⌘I", function () { toggleSide(tw); }),
        vis("面板", MI.panel, !!L.panel, "⌘J", function () { togglePanel(tw); }),
        zen && getv("statusBar") ? vis("状态栏", MI.status, !zen.hid.status, "", function () { zenShow("status", !!zen.hid.status); }) : vis("状态栏", MI.status, !!getv("statusBar"), "", function () { setv("statusBar", !getv("statusBar")); }),
        vis("路径导航", MI.crumbs, !!getv("breadcrumbs"), "", function () { setv("breadcrumbs", !getv("breadcrumbs")); }),
      ].concat(one("主侧栏位置", "sideBarPos", [["left", "左侧", MI.sideL], ["right", "右侧", MI.sideR]]))
        .concat([["side", "默认", LI.actSide], ["top", "顶部", LI.actTop], ["bottom", "底部", LI.actBottom]].map(function (x) { return { g: "活动栏位置", label: x[1], icon: x[2], on: ap === x[0], radio: true, run: function () { setActPos(x[0]); } }; }))
        .concat(one("面板对齐", "panelAlign", [["left", "左对齐", LI.paLeft], ["right", "右对齐", LI.paRight], ["center", "居中", LI.paCenter], ["justify", "两端对齐", LI.paJustify]]))
        .concat(one("快速输入位置", "quickInput", [["top", "顶部", LI.qiTop], ["center", "居中", LI.qiCenter]]))
        .concat(one("布局密度", "density", [["default", "默认", LI.dnDefault], ["compact", "紧凑", LI.dnCompact]]))
        .concat(osModesNow().map(function (x) { return { g: "应用风格", label: x[1], icon: MI["os_" + x[0]], on: (getv("os", true) || "vscode") === x[0], radio: true, run: function () { setv("os", x[0]); } }; }))
        .concat(UI_MODES.map(function (x) { var forced = OS_UI[getv("os", true)], off = !!forced && forced !== x[0]; return { g: "Agent 显示风格", label: x[1] + (off ? "（" + NA + "）" : ""), icon: MI[x[0]], on: getv("ui", true) === x[0], radio: true, disabled: off, run: function () { if (!off) setv("ui", x[0]); } }; }))
        .concat(MINI_MODES.map(function (x) { return { g: "缩略图", label: x[1], icon: LI["mm_" + x[0]], on: getv("minimap", true) === x[0], radio: true, run: function () { setv("minimap", x[0]); } }; }))
        .concat([
          { g: "模式", label: "全屏", icon: MI.full, on: !!document.fullscreenElement || root.classList.contains("st-fs"), keys: "⌃⌘F", run: function () { if (N0) N0.call("window.fullscreen", {}).catch(function () {}); } },
          { g: "模式", label: "禅模式", icon: MI.zen, on: !!zen, keys: "⌘K Z", run: function () { toggleZen(tw); } },
        ]);
    };
    var paint = function () {
      var L0 = items(), last = null;
      box.innerHTML = '<div class="st-lph"><span class="st-fill"></span><b>自定义布局</b><span class="st-fill"></span><button class="st-hbtn" data-act="reset" title="恢复默认">' + MI.discard + '</button><button class="st-hbtn" data-act="close" title="关闭 (Esc)">' + ICO.close + "</button></div><div class=\"st-plist\">" +
        L0.map(function (it, i) {
          var first = it.g !== last; last = it.g;
          // 组名写在分隔线右端（不占这一组第一行的位置——以前挤在那一行，快捷键和下面几行对不齐）
          return (first ? '<div class="st-lgh' + (i ? "" : " st-lgh0") + '"><span>' + esc(it.g) + "</span></div>" : "") + '<div class="st-lrow' + (i === sel ? " on" : "") + '" data-i="' + i + '"><span class="st-lico">' + it.icon + '</span><span class="st-llab">' + esc(it.label) + (it.on ? '<span class="st-lchk">✓</span>' : "") + '</span><span class="st-fill"></span>' +
            (it.keys ? keycaps(it.keys) : "") + "</div>";
        }).join("") + "</div>";
      var on = box.querySelector(".st-lrow.on"); if (on) on.scrollIntoView({ block: "nearest" });
    };
    // 改了以后马上按新的设置重画、重新摆位置（比如「快速输入位置」换成顶部 / 居中，这个框自己就挪过去——不用关了再开才看到效果）
    var repaint = function () { paint(); palPlace(box); };
    var run = function (i) { var it = items()[i]; if (!it) return; it.run(); setTimeout(repaint, 30); };
    palHost(tw, box, function () { close(); });
    paint();
    box.addEventListener("mousedown", function (e) {
      var b = e.target.closest("[data-act]"), r = e.target.closest(".st-lrow");
      e.preventDefault();
      if (b && b.dataset.act === "close") return close();
      if (b && b.dataset.act === "reset") {
        ["activityBar", "activityPos", "activitySize", "sideBarPos", "panelAlign", "quickInput", "density", "statusBar", "breadcrumbs", "minimap"].forEach(function (k) { if (getv(k, true) !== SET_DEF[k]) setv(k, SET_DEF[k]); });
        if (tw.side && !tw.side.shown()) tw.side.toggle(true); if (L.side) toggleSide(tw, false); if (L.panel) togglePanel(tw, false); if (zen) toggleZen(tw);
        return setTimeout(repaint, 30);
      }
      if (r) { sel = +r.dataset.i; run(sel); }
    });
    var close = function () { palDone(box); box.remove(); document.removeEventListener("pointerdown", out, true); var P = tw.ws.active; if (P) P.focus(); };
    var out = function (e) { if (!box.contains(e.target) && !(e.target.closest && e.target.closest(".st-menu"))) close(); };
    setTimeout(function () { document.addEventListener("pointerdown", out, true); }, 0);
    box.addEventListener("keydown", function (e) {
      var n = items().length;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + n) % n; paint(); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); run(sel); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
      e.stopPropagation();
    });
    box.focus();
  }

  // ======== 菜单（TUI 画的：等宽字、一圈细线，同命令面板一个样子）：⚙ 管理菜单、右键菜单、标签条的 ··· 都用它 ========
  //   items：[{ label, keys, run, disabled, checked, radio, close, info（只显示）, items（子菜单：数组或返回数组的函数）} | { sep: true }]，也可以是返回这个数组的函数
  //   有 checked 的是勾选（显示哪些、选哪一种）：点了不关菜单，勾换过来，接着能点别的（close: true 的照常关）；radio：同一层里只勾一个
  //   at：{ x, y }（左上角）或 { el: 元素, side: "right-up"（右边、底对齐，⚙ 用）| "right"（子菜单）| "below"（下面左对齐）| "below-end"（下面右对齐）}
  //   键盘 ↑↓ 移、→ 开子菜单、← 回上一层、回车选、Esc 关；鼠标悬停高亮（有子菜单就打开），点了才选
  var menus = [];
  function closeMenus(from) {
    while (menus.length > from) { var m0 = menus.pop(); if (m0.unprev) m0.unprev(); m0.el.remove(); }
    if (!menus.length) document.removeEventListener("pointerdown", outsideMenu, true);
  }
  // 点菜单外面：只是关菜单——这一下不落到下面的东西上（不然关菜单的同时点中了下面的按钮）；右键例外：在那儿接着开它的菜单
  function outsideMenu(e) {
    if (menus.some(function (m) { return m.el.contains(e.target); })) return;
    closeMenus(0);
    if (e.button === 2) return;
    e.preventDefault(); e.stopPropagation();
    var types = ["mousedown", "pointerup", "mouseup", "click"], tm = 0;
    var done = function () { clearTimeout(tm); types.forEach(function (t) { document.removeEventListener(t, eat, true); }); };
    var eat = function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      if (ev.type === "click") done();
      else if (ev.type === "pointerup") { clearTimeout(tm); tm = setTimeout(done, 80); } // 松开了还没有 click（拖走了）：不再拦
    };
    types.forEach(function (t) { document.addEventListener(t, eat, true); });
    tm = setTimeout(done, 1500);
  }
  // ---- App 里：菜单交给系统的菜单画（menu.popup，同 VS Code 在 macOS 上的右键菜单）；指着哪一项原生告诉这边（menu.highlight）→ 照样预览 ----
  var NM = { ok: false, hl: null };
  if (window.nadosNative) {
    nadosNative.call("info").then(function (i) { NM.ok = ((i && i.commands) || []).indexOf("menu.popup") >= 0; }).catch(function () {});
    if (nadosNative.on) nadosNative.on("menu.highlight", function (d) {
      var st = NM.hl, it = st && d && d.id ? st.byId[d.id] : null;
      if (!st) return;
      clearTimeout(st.t);
      st.t = setTimeout(function () { if (st.pv === it) return; if (st.pv) { var p0 = st.pv; st.pv = null; p0.preview(false); } if (it && it.preview) { st.pv = it; it.preview(true); } }, 300); // 停稳了才预览（划过去的不算）
    });
  }
  // 快捷键写法 → 系统菜单的按键（只显示；和弦 ⌘K ⌘S、方向键这种不给）
  function keyOf(k) {
    k = String(k || "").trim();
    if (!k || /\s|…|↑|↓|←|→|空格/.test(k)) return null;
    var mods = [], i = 0, M0 = { "⌘": "cmd", "⇧": "shift", "⌥": "alt", "⌃": "ctrl" };
    while (i < k.length && M0[k[i]]) { mods.push(M0[k[i]]); i++; }
    var key = k.slice(i);
    if (key.length !== 1) return null;
    return { key: key.toLowerCase(), mods: mods.join(",") || "cmd" };
  }
  // 菜单图标 → SF Symbols 的名字（系统的菜单用系统的图标）
  var MI_SYM = { eye: "info.circle", palette: "command", gear: "gearshape", json: "curlybraces", keys: "keyboard", ui: "macwindow", tui: "terminal", gui: "desktopcomputer", macos: "menubar.dock.rectangle", os_vscode: "sidebar.left", os_claude: "asterisk", os_macos: "menubar.dock.rectangle", os_terminal: "terminal", scheme: "paintpalette", highlight: "chevron.left.forwardslash.chevron.right",
    layout: "rectangle.split.3x1", act: "sidebar.left", sideL: "sidebar.left", sideR: "sidebar.right", panel: "rectangle.bottomthird.inset.filled", status: "rectangle.split.1x2", crumbs: "chevron.right.2",
    minimap: "sidebar.squares.right", lineNo: "list.number", full: "arrow.up.left.and.arrow.down.right", zen: "scope", title: "menubar.rectangle", splitR: "rectangle.split.2x1", splitD: "rectangle.split.1x2", close: "xmark",
    closeOthers: "xmark.square", msg: "bubble.left", answer: "sparkles", think: "brain.head.profile", tool: "wrench.and.screwdriver", diff: "plusminus", web: "globe", term: "terminal", recap: "clock.arrow.circlepath",
    done: "checkmark.circle", bell: "bell", tray: "tray", note: "ellipsis.bubble", image: "photo", composer: "character.cursor.ibeam", hide: "minus.circle", open: "arrow.up.forward.square", tab: "plus.square.on.square", window: "macwindow",
    rename: "pencil", archive: "archivebox", history: "clock.arrow.circlepath", collapse: "minus.square", agent: "sparkles",
    info: "info.circle", sliders: "slider.horizontal.3", filter: "line.3.horizontal.decrease.circle", hidden: "square.dashed", invert: "arrow.left.arrow.right", clock: "clock", stop: "stop.circle", checklist: "checklist", fork: "arrow.triangle.branch", workline: "hourglass" };
  // 系统图标里没有的：直接把页面画的 SVG 给系统菜单（Claude 自己的标志、经典 Macintosh）；旧版 App 不认 svg，用上面的 SF Symbols 顶着
  var MI_SVG = { os_claude: 1, gui: 1 }, MI_SVGCOLOR = {}; // Claude Desktop 的标志同别的图标当模板图（浅色菜单里黑、深色里白），以前保留了灰色，看着和别的不一样
  var nsvg = function (s) { return String(s).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" ').replace(/currentColor/g, "#000"); };
  function nativeMenu(items, at) {
    // 上一个系统菜单还没关（连着点了几下 ···，第二下在菜单弹出来之前就到了）：不再叠一个——叠起来的系统菜单会把整个 App 卡住
    if (NM.hl && Date.now() - (NM.hl.at || 0) < 30000) return { el: null, first: function () {}, unprev: function () {} };
    var byId = {}, rev = null;
    var symOf = function (it) {
      if (it.sym) return it.sym;
      if (!it.icon || !window.STUDIO || !STUDIO.menuIcons) return "";
      if (!rev) { rev = {}; var mi0 = STUDIO.menuIcons(); Object.keys(mi0).forEach(function (k) { rev[mi0[k]] = k; }); }
      return MI_SYM[rev[it.icon]] || "";
    };
    var conv = function (list, pre) {
      if (typeof list === "function") list = list();
      return (list || []).filter(Boolean).map(function (it, i) {
        if (it.sep) return { sep: true };
        if (it.header) return { id: pre + i, title: it.label || "", enabled: false }; // 一段的小标题：系统菜单里是一行灰字
        // 一排颜色圆点（访达右键的标签）：每个点自己一个 id，选了哪个就跑它的 run
        if (it.dots) return { dots: it.dots.map(function (d, j) { var did = pre + i + "." + j; byId[did] = d; return { id: did, color: d.color, on: !!d.on, title: d.title || "" }; }) };
        var id = pre + i, o = { id: id, title: it.label || "", enabled: !(it.disabled || it.info), checked: !!it.checked }, k = keyOf(it.keys), sy = symOf(it);
        byId[id] = it;
        if (k) { o.key = k.key; o.mods = k.mods; }
        else if (it.acc && /^[a-z0-9]$/i.test(String(it.acc))) { o.key = String(it.acc).toLowerCase(); o.mods = "none"; } // 菜单开着时按这个字母（不带 ⌘），同 Claude App 会话菜单
        if (sy) o.symbol = sy;
        var sk = it.icon && rev ? rev[it.icon] : null;
        if (it.svg) o.svg = nsvg(it.svg); else if (sk && MI_SVG[sk]) { o.svg = nsvg(it.icon); if (MI_SVGCOLOR[sk]) o.svgColor = true; }
        if (it.file) o.file = String(it.file); // 用这个文件 / App 的图标（「打开方式」）
        if (it.dot) o.dot = String(it.dot); // 前面一个颜色圆点
        if (it.value != null && it.value !== "") o.value = String(it.value); // 右边一段灰字（现在选的是什么）
        if (it.items) o.items = conv(it.items, id + ".");
        return o;
      });
    };
    var spec = conv(items, ""), x = at.x || 0, y = at.y || 0, up = false, end = false, x2 = null;
    if (at.el) {
      var r = at.el.getBoundingClientRect();
      if (at.side === "right-up") { x = r.right + 4; y = r.bottom; up = true; } // 左下角的 ⚙：往上开
      else if (at.side === "above") { x = r.left; y = r.top - 4; up = true; }
      else if (at.side === "below-end") { x = r.left; y = r.bottom + 4; x2 = r.right; } // 优先往右展开；窗口右边放不下时原生那边改成靠右对齐
      else if (at.side === "below-right") { x = r.right; y = r.bottom + 4; end = true; } // 右边和按钮对齐、往左展开（边栏上那种按钮）
      else { x = r.left; y = r.bottom + 4; }
    }
    // 往上开的（左下角 ⚙）：系统菜单实际比原生那边先算的高度高（macOS 27 的菜单行更高，每项约多 4px），底边会压到屏幕下沿，被折成要滚的菜单（最下面一个 ⌄）——先往上多挪这么多，整个菜单都放得下
    //   以前按每项多 4px 往上挪（4 × 项数 + 8）挪过头了：12 项的 ⚙ 菜单底边比按钮高出四十多像素（用户：「每次点开都特别偏上」）。
    //   量下来原生那边算的高度只比实际少十来像素：固定补 12px，菜单底边和按钮的底边对齐
    if (up) y -= 12;
    var back = document.activeElement;
    NM.hl = { byId: byId, pv: null, t: 0, at: Date.now() };
    nadosNative.call("menu.popup", { items: spec, x: x, y: y, up: up, end: end, x2: x2 }).then(function (id) {
      var st = NM.hl; NM.hl = null;
      if (st) { clearTimeout(st.t); if (st.pv) { var p0 = st.pv; st.pv = null; p0.preview(false); } }
      if (back && back.focus && document.contains(back)) back.focus();
      var it = id && byId[id];
      if (!it || !it.run) return;
      it.run();
      if (it.preview) it.preview(false);
      // 系统的菜单选完就关（同 macOS），不再原地弹出来——关了又开会闪
    }, function () { NM.hl = null; });
    return { el: null, first: function () {}, unprev: function () {} };
  }
  function menu(items, at, level) {
    level = level || 0;
    // App 里：系统的菜单——Claude App 风格除外（沉浸式的图形界面：菜单都是自己画的 Claude 的样子，见 claudeapp.css）
    if (!level && NM.ok && window.nadosNative && getv("nativeMenus") !== false && !root.classList.contains("st-os-claude")) return nativeMenu(items, at);
    closeMenus(level);
    var src0 = typeof items === "function" ? items : null, src = src0 ? function () { return (src0() || []).filter(Boolean); } : null; // 空的项（null）不画
    items = src ? src() : (items || []).filter(Boolean);
    var el = document.createElement("div"), sel = -1, back = level ? null : document.activeElement;
    el.className = "st-menu";
    el.tabIndex = -1;
    var rows = function () {
      var icons = items.some(function (it) { return it && (it.icon || it.dot); });
      return items.map(function (it, i) {
        if (it.sep) return '<div class="st-msep"></div>';
        if (it.header) return '<div class="st-mhead">' + esc(it.label || "") + "</div>"; // 一段的小标题（灰、不能选）
        // 一排颜色圆点（访达右键的标签）：点一个就是选了它
        if (it.dots) return '<div class="st-mdots" data-i="' + i + '">' + it.dots.map(function (d, j) { return '<span class="st-mdot' + (d.on ? " on" : "") + '" data-j="' + j + '" title="' + esc(d.title || "") + '" style="--c:' + esc(d.color || "#8e8e93") + '"></span>'; }).join("") + "</div>";
        var off = it.disabled || it.info, val = it.value != null && it.value !== "" ? '<span class="st-mval">' + esc(it.value) + "</span>" : ""; // value：右边一段灰字（现在选的是什么）；box：画成复选框
        var ico = it.dot ? '<i class="st-mdoti" style="--c:' + esc(it.dot) + '"></i>' : it.icon || "";
        // sub：名字下面一行灰字（说明）；acc：菜单开着时按这个键就是选它（右边一列显示，同 Claude App 会话菜单里的 1 2 P R……）；danger：红字（删除）
        var lab = it.sub ? '<span class="st-mlab st-mlab2"><span>' + esc(it.label || "") + '</span><span class="st-msub">' + esc(it.sub) + "</span></span>" : '<span class="st-mlab">' + esc(it.label || "") + "</span>";
        // dim：灰字（账户菜单最上面那一行：账号）；flush：不留图标那一格（字从最左边开始，同 Claude 的账户菜单）
        return '<div class="st-mrow' + (off ? " off" : "") + (it.box ? " box" : "") + (it.checked ? " chk" : "") + (it.sub ? " two" : "") + (it.danger ? " dan" : "") + (it.dim ? " dim" : "") + '" data-i="' + i + '"><span class="st-mchk">' + (it.checked ? "✓" : "") + "</span>" + (icons && !it.flush ? '<span class="st-mico">' + ico + "</span>" : "") + lab + val + '<span class="st-mkey">' + esc(it.keys || "") + "</span>" + (it.acc ? '<span class="st-macc">' + esc(it.acc) + "</span>" : "") + (it.items ? '<span class="st-marr">›</span>' : "") + "</div>";
      }).join("");
    };
    el.innerHTML = rows();
    document.body.appendChild(el);
    var w = el.offsetWidth, h = el.offsetHeight, x = at.x || 0, y = at.y || 0;
    if (at.el) {
      var r = at.el.getBoundingClientRect();
      if (at.side === "right-up") { x = r.right + 4; y = r.bottom - h; }
      else if (at.side === "right") { var pr = (at.el.closest(".st-menu") || at.el).getBoundingClientRect(); x = pr.right + 2; y = r.top - 5; if (x + w > innerWidth - 4) x = pr.left - w - 2; } // 子菜单：右边放不下就放左边，不叠在上一层上面
      else if (at.side === "below-end") { x = r.left; y = r.bottom + 4; if (x + w > innerWidth - 4) x = r.right - w; } // 优先往右展开，放不下才靠右对齐
      else if (at.side === "below-right") { x = r.right - w; y = r.bottom + 4; } // 右边和按钮对齐
      else if (at.side === "above") { x = r.left; y = r.top - h - 6; } // 输入框下面那排按钮（图形界面）：往上开
      else { x = r.left; y = r.bottom + 4; }
    }
    el.style.left = Math.max(4, Math.min(x, innerWidth - w - 4)) + "px";
    el.style.top = Math.max(4, Math.min(y, innerHeight - h - 4)) + "px";
    var M = { el: el, t0: Date.now() };
    menus.push(M);
    if (menus.length === 1) document.addEventListener("pointerdown", outsideMenu, true);
    // 防误触：按下（右键）就弹出来的菜单，松开的那一下不算选中——刚弹出来 250ms 内的点选只有指针动过（≥4px）或是在菜单里按下的才算
    var p0x = null, p0y = null, moved = false, pressIn = false;
    el.addEventListener("mousemove", function (e) { if (p0x === null) { p0x = e.clientX; p0y = e.clientY; } else if (!moved && Math.abs(e.clientX - p0x) + Math.abs(e.clientY - p0y) >= 4) moved = true; });
    el.addEventListener("pointerdown", function () { pressIn = true; });
    var early = function () { return Date.now() - M.t0 < 250 && !moved && !pressIn; };
    var ok = function (i) { var it = items[i]; return it && !it.sep && !it.header && !it.dots && !it.disabled && !it.info; };
    var pv = null, pvT = 0;
    var unprev = M.unprev = function () { clearTimeout(pvT); if (pv) { var p0 = pv; pv = null; p0.preview(false); } };
    var prev = function (i) { // 停稳了（300ms）才预览：划过去的不算，换到别的行重新计时
      clearTimeout(pvT);
      var it = ok(i) ? items[i] : null;
      if (pv === it) return;
      pvT = setTimeout(function () { if (pv) { var p0 = pv; pv = null; p0.preview(false); } if (it && it.preview && el.isConnected) { pv = it; it.preview(true); } }, 300);
    };
    var hi = function (i, quiet) { sel = i; el.querySelectorAll(".st-mrow").forEach(function (rw) { rw.classList.toggle("on", +rw.dataset.i === i); }); if (!quiet) prev(i); };
    var sub = function (i, focus) { var it = items[i]; if (!ok(i) || !it.items) return false; var m2 = menu(it.items, { el: el.querySelector('[data-i="' + i + '"]'), side: "right" }, level + 1); if (focus) m2.first(); return true; };
    var choose = function (i) {
      if (!ok(i)) return;
      var it = items[i];
      if (it.items) return sub(i, true);
      if (it.checked !== undefined && !it.close) { // 勾选的：定下来（预览的那个样子就是它），不关，接着能点别的
        clearTimeout(pvT); pv = null;
        if (it.run) it.run();
        if (it.preview) it.preview(false);
        if (src) items = src(); else if (it.radio) items.forEach(function (x) { if (x.radio) x.checked = x === it; }); else it.checked = !it.checked;
        closeMenus(level + 1);
        // 菜单不关、原地更新：只换变了的那几行（整个重画会闪一下）
        var tmp = document.createElement("div"), olds = el.children;
        tmp.innerHTML = rows();
        if (tmp.children.length !== olds.length) el.innerHTML = tmp.innerHTML;
        else for (var k = tmp.children.length - 1; k >= 0; k--) { var nw = tmp.children[k], od = olds[k]; od.classList.remove("on"); if (od.outerHTML !== nw.outerHTML) el.replaceChild(nw, od); }
        hi(i, true);
        return;
      }
      closeMenus(0); if (back && back.focus) back.focus(); if (it.run) it.run();
    };
    var step = function (d) { for (var k = 0, i = sel; k < items.length; k++) { i = (i + d + items.length) % items.length; if (ok(i)) return hi(i); } };
    // 悬停换行：子菜单开着时等一下再换（指针斜着划向子菜单、路过别的行不算；进了子菜单就不换了）
    el.addEventListener("mouseover", function (e) {
      var rw = e.target.closest(".st-mrow");
      clearTimeout(M.hovT); M.hovT = 0;
      if (!rw || +rw.dataset.i === sel) return;
      var i = +rw.dataset.i, go = function () { M.hovT = 0; hi(i); closeMenus(level + 1); sub(i, false); };
      if (menus[level + 1]) M.hovT = setTimeout(go, 220); else go();
    });
    if (level) el.addEventListener("mouseenter", function () { var par = menus[level - 1]; if (par && par.hovT) { clearTimeout(par.hovT); par.hovT = 0; } });
    el.addEventListener("click", function (e) {
      if (early()) return; // 弹出来的那一下的松开，不算
      var dt = e.target.closest(".st-mdot");
      if (dt) { var d = (items[+dt.parentNode.dataset.i].dots || [])[+dt.dataset.j]; closeMenus(0); if (back && back.focus) back.focus(); if (d && d.run) d.run(); return; }
      var rw = e.target.closest(".st-mrow"); if (rw) choose(+rw.dataset.i);
    });
    el.addEventListener("mouseleave", function () { unprev(); sel = -1; el.querySelectorAll(".st-mrow.on").forEach(function (rw) { if (!(rw.querySelector(".st-marr") && menus[level + 1])) rw.classList.remove("on"); }); });
    // 菜单里的快捷字母（acc）：这一层有就选它；没有就看子菜单里的（按 1 直接就是「打开方式 › 拆分视图」）
    var accHit = function (k) {
      k = String(k || "").toLowerCase();
      if (!k || k.length !== 1) return false;
      for (var i = 0; i < items.length; i++) if (ok(i) && items[i].acc && String(items[i].acc).toLowerCase() === k) { choose(i); return true; }
      for (var j = 0; j < items.length; j++) {
        if (!ok(j) || !items[j].items) continue;
        var kids = (typeof items[j].items === "function" ? items[j].items() : items[j].items) || [];
        for (var n = 0; n < kids.length; n++) { var c = kids[n]; if (c && c.acc && !c.disabled && !c.header && String(c.acc).toLowerCase() === k) { closeMenus(0); if (back && back.focus) back.focus(); if (c.run) c.run(); return true; } }
      }
      return false;
    };
    el.addEventListener("keydown", function (e) {
      e.preventDefault(); e.stopPropagation();
      if (!e.metaKey && !e.ctrlKey && !e.altKey && accHit(e.key)) return;
      if (e.key === "ArrowDown") step(1);
      else if (e.key === "ArrowUp") step(-1);
      else if (e.key === "ArrowRight") sub(sel, true);
      else if (e.key === "ArrowLeft" && level) { closeMenus(level); menus[level - 1].el.focus(); }
      else if (e.key === "Enter" || e.key === " ") choose(sel);
      else if (e.key === "Escape") { closeMenus(0); if (back && back.focus) back.focus(); }
    });
    el.focus();
    M.first = function () { step(1); };
    return M;
  }
  // ---- 问一句：{ title, text?, value?（有就带一个输入框）, ok?, danger? } → Promise：确定 → true（有输入框：输入的字）；取消 → null
  //      Claude App 风格里画成它的对话框（claudeapp.js，不用系统的）；别的风格用浏览器的（App 里是系统的对话框）
  function ask(o) {
    if (root.classList.contains("st-os-claude") && window.TSU_CLAUDEAPP && TSU_CLAUDEAPP.dialog) return TSU_CLAUDEAPP.dialog(o);
    var t = o.title + (o.text ? "\n" + o.text : "");
    return Promise.resolve(o.value !== undefined ? window.prompt(t, o.value) : window.confirm(t) ? true : null);
  }
  // Paimon Terminal 里别处的弹出菜单（右键菜单、··· 等，原来是网页桌面那种 macOS 菜单）也换成这个
  // （desk.js 在后面才载入：等页面的脚本都跑完再换）
  function hookPopup() {
    if (!termapp() || !window.TSU_DESK || !TSU_DESK.popup || TSU_DESK.popup.tui) return;
    TSU_DESK.popup = function (items, at) {
      if (at && at.above) return menu(items, { el: at.above, side: "below" });
      return menu(items, { x: (at && at.x || 0) + 1, y: (at && at.y || 0) + 1 });
    };
    TSU_DESK.popup.tui = true;
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hookPopup); else setTimeout(hookPopup, 0);

  // ======== 标题栏右上：布局开关（同 VS Code：自定义布局 · 左边栏 · 面板 · 右侧栏）========
  var LAY_ICONS = {
    custom: '<svg viewBox="0 0 16 16"><rect x="2" y="2.5" width="5" height="11" rx="1" fill="none" stroke="currentColor"/><rect x="9" y="2.5" width="5" height="5" rx="1" fill="none" stroke="currentColor"/><rect x="9" y="9.5" width="5" height="4" rx="1" fill="none" stroke="currentColor"/></svg>',
    left: function (on) { return '<svg viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor"/><rect x="2" y="3" width="4.5" height="10" fill="' + (on ? "currentColor" : "none") + '"/><path d="M6.5 3v10" stroke="currentColor"/></svg>'; },
    panel: function (on) { return '<svg viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor"/><rect x="2" y="9.5" width="12" height="3.5" fill="' + (on ? "currentColor" : "none") + '"/><path d="M2 9.5h12" stroke="currentColor"/></svg>'; },
    right: function (on) { return '<svg viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor"/><rect x="9.5" y="3" width="4.5" height="10" fill="' + (on ? "currentColor" : "none") + '"/><path d="M9.5 3v10" stroke="currentColor"/></svg>'; },
    // 暂时收起（系统替你收的，离开这一页自动回来）：侧栏那一块是虚线框、淡淡一层——介于开和关之间
    rightAuto: function () { return '<svg viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor"/><rect x="9.9" y="3.9" width="3.3" height="8.2" rx=".6" fill="currentColor" fill-opacity=".28" stroke="currentColor" stroke-width=".9" stroke-dasharray="1.3 1.1"/></svg>'; },
    leftAuto: function () { return '<svg viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor"/><rect x="2.8" y="3.9" width="3.3" height="8.2" rx=".6" fill="currentColor" fill-opacity=".28" stroke="currentColor" stroke-width=".9" stroke-dasharray="1.3 1.1"/></svg>'; },
    panelAuto: function () { return '<svg viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor"/><rect x="2.9" y="9.6" width="10.2" height="2.6" rx=".6" fill="currentColor" fill-opacity=".28" stroke="currentColor" stroke-width=".9" stroke-dasharray="1.3 1.1"/></svg>'; },
  };
  LAY_ICONS.overview = '<svg viewBox="0 0 16 16"><rect x="2" y="2.5" width="5" height="5" rx="1" fill="none" stroke="currentColor"/><rect x="9" y="2.5" width="5" height="5" rx="1" fill="none" stroke="currentColor"/><rect x="2" y="9.5" width="5" height="4" rx="1" fill="none" stroke="currentColor"/><rect x="9" y="9.5" width="5" height="4" rx="1" fill="none" stroke="currentColor"/></svg>';
  // 浏览器（最右上角那一个，同 Claude App 标题栏里的地球）：打开内嵌的浏览器；已经开着就切过去
  LAY_ICONS.web = function () { return '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor"/><path d="M2.2 8h11.6M8 2c1.8 1.8 2.6 3.8 2.6 6s-.8 4.2-2.6 6M8 2C6.2 3.8 5.4 5.8 5.4 8s.8 4.2 2.6 6" fill="none" stroke="currentColor"/></svg>'; };
  var LAY_ITEMS = [{ id: "custom", label: "自定义布局…" }, { id: "left", label: "切换主侧栏", keys: "⌘B" }, { id: "panel", label: "切换面板", keys: "⌘J" }, { id: "right", label: "切换辅助侧栏", keys: "⌥⌘I" }, { id: "web", label: "浏览器" }];
  LAY_ITEMS.forEach(function (x) { x.icon = x.id === "custom" ? LAY_ICONS.custom : LAY_ICONS[x.id](true); });
  // 布局按钮精简成一个（点开是一个菜单，再选一项——同手机上的习惯）：iPhone 默认这样，设置 › 布局里能换回经典（全部摆出来）
  // 手机的版面（贴边、无边框……studio.css 的 html.st-phone）：iPhone 一直是；别的设备窗口窄到 600 以下也是
  var phoneNow = function () { root.classList.toggle("st-phone", root.classList.contains("iphone") || innerWidth < 600); };
  phoneNow(); window.addEventListener("resize", phoneNow);
  // 有灵动岛的 iPhone 竖着拿、VS Code 风格、布局按钮精简：标签页那一行顶到最上面绕开灵动岛（studio.css）——告诉 App 把状态栏收起来
  var islandOn = null;
  function islandSync() {
    var on = root.classList.contains("iphone") && root.classList.contains("st-island") && layConcise() && !root.classList.contains("st-os-claude") && matchMedia("(orientation: portrait)").matches;
    if (on === islandOn) return;
    islandOn = on;
    try { webkit.messageHandlers.vsApp.postMessage({ type: "statusBar", hidden: on }); } catch (e) { /* 不在 App 里 */ }
    setTimeout(function () { allWins().forEach(function (w) { if (w.ws && w.ws.syncTitles) w.ws.syncTitles(); }); }, 50); // 标签栏变窄了：当前那一页滑进看得见的地方
  }
  matchMedia("(orientation: portrait)").addEventListener("change", function () { islandSync(); });
  var layDefault = function () { return /iPhone/.test(navigator.userAgent) || (innerWidth && innerWidth < 600) ? "concise" : "classic"; };
  var layConcise = function () { var v = getv("layButtons"); return (v === "concise" || v === "classic" ? v : layDefault()) === "concise"; };
  function layItems(tw) {
    var sideOn = !!(tw.side && tw.side.shown()), MIx = MI;
    return [
      { label: "设置…", icon: MIx.gear, keys: "⌘,", run: function () { settings(tw, sectionFor(tw)); } }, // 手机上标题栏收起来了：设置、账号也从这里进
      { label: "账号…", icon: MIx.account || MIx.user, run: function () { settings(tw, "account"); } },
      { sep: true },
      { label: "新建标签页", icon: ICO.plus, keys: "⌘T", run: function () { (tw.ws.newTabUser || tw.ws.newTab)(); } },
      { sep: true },
      { label: "主侧栏", icon: LAY_ICONS.left(true), keys: "⌘B", checked: sideOn, run: function () { if (tw.side) tw.side.toggle(); layBar(tw); } },
      { label: "面板", icon: LAY_ICONS.panel(true), keys: "⌘J", checked: !!L.panel, run: function () { togglePanel(tw); layBar(tw); } },
      { label: "辅助侧栏", icon: LAY_ICONS.right(true), keys: "⌥⌘I", checked: !!L.side, run: function () { toggleSide(tw); layBar(tw); } },
      { sep: true },
      { label: "浏览器", icon: LAY_ICONS.web(), run: function () { openBrowser(tw); } },
      { label: "标签页概览", icon: LAY_ICONS.overview, keys: "⇧⌘\\", run: function () { if (window.TSU_BROWSER && TSU_BROWSER.overview) TSU_BROWSER.overview(tw); } },
      { label: "自定义布局…", icon: LAY_ICONS.custom, run: function () { layoutPick(tw); } },
    ];
  }
  function layMenu(tw, el) { menu(layItems(tw), { el: el, side: "below-end" }); }
  function layBar(tw) {
    var bar = tw.el.querySelector(".bar");
    if (!bar) return;
    var box = bar.querySelector(".st-lay");
    if (!box) {
      box = document.createElement("div");
      box.className = "st-lay";
      bar.appendChild(box);
      bar.addEventListener("contextmenu", function (e) {
        if (e.target.closest("input, .st-tbacts, .st-glob")) return;
        var lb = e.target.closest(".st-lay [data-l]");
        if (lb) return toolbarMenu(e, "layout", LAY_ITEMS, lb.dataset.l, function () { layBar(tw); }); // 布局按钮上右键：同 VS Code 工具栏的右键（配置快捷键、隐藏它、勾选哪些显示）
        e.preventDefault(); menu(titleMenu, { x: e.clientX, y: e.clientY });
      });
      ["pointerdown", "dblclick"].forEach(function (t) { box.addEventListener(t, function (e) { e.stopPropagation(); }); });
      box.addEventListener("click", function (e) {
        var b = e.target.closest("[data-l]");
        if (!b) return;
        if (b.dataset.l === "concise") return layMenu(tw, b);
        if (b.dataset.l === "custom") layoutPick(tw);
        if (b.dataset.l === "newtab") (tw.ws.newTabUser || tw.ws.newTab)();
        if (b.dataset.l === "overview" && window.TSU_BROWSER && TSU_BROWSER.overview) TSU_BROWSER.overview(tw);
        if (b.dataset.l === "left" && tw.side) { tw.side.toggle(); if (zen) zen.hid.side = false; }
        if (b.dataset.l === "panel") { togglePanel(tw); if (zen) zen.hid.panel = false; }
        if (b.dataset.l === "right") toggleSide(tw);
        if (b.dataset.l === "web") openBrowser(tw);
        layBar(tw);
      });
    }
    var sideOn = !!(tw.side && tw.side.shown()), hb = function (id) { return tbHidden("layout", id) ? " hidden" : ""; };
    // 禅模式替你收起的（左边栏、面板）：同「暂时收起」画成虚线的那一块——点一下就在禅模式里拿回来
    var zl = !!(zen && zen.hid.side && !sideOn), zp = !!(zen && zen.hid.panel && !L.panel);
    var h = '<button data-l="newtab" title="新建标签页 (⌘T)">' + ICO.plus + '</button><button data-l="custom" title="自定义布局"' + hb("custom") + ">" + LAY_ICONS.custom + '</button><button data-l="left" title="' + (zl ? "主侧栏：禅模式里收起（点一下拿回来）" : "切换主侧栏 (⌘B)") + '"' + hb("left") + ">" + (zl ? LAY_ICONS.leftAuto() : LAY_ICONS.left(sideOn)) + '</button><button data-l="panel" title="' + (zp ? "面板：禅模式里收起（点一下拿回来）" : "切换面板 (⌘J)") + '"' + hb("panel") + ">" + (zp ? LAY_ICONS.panelAuto() : LAY_ICONS.panel(!!L.panel)) + '</button><button data-l="right" title="' + (sideAuto(tw) ? "辅助侧栏：暂时收起（离开这一页会自动恢复）" : "切换辅助侧栏 (⌥⌘I)") + '"' + hb("right") + ">" + (sideAuto(tw) ? LAY_ICONS.rightAuto() : LAY_ICONS.right(!!L.side)) + '</button><button data-l="web" title="浏览器"' + hb("web") + ">" + LAY_ICONS.web() + '</button><button data-l="overview" title="标签页概览 (⇧⌘\\)">' + LAY_ICONS.overview + "</button>"; // 标签页概览在最右边（同 Safari）
    if (layConcise()) h = '<button data-l="concise" title="布局：侧栏、面板、浏览器、新建标签页">' + LAY_ICONS.custom + "</button>"; // 精简：一个按钮，点开再选
    root.classList.toggle("st-lay-concise", layConcise()); // 手机上：标题栏整条不要，标签页在最上面（灵动岛正下方），这些收进标签栏的 ···（studio.css）
    islandSync();
    if (box.dataset.h !== h) { box.dataset.h = h; box.innerHTML = h; }
  }
  function manageLayout(tw, b) { manageMenu(tw, b, "below-end"); }
  // 标题栏的浏览器按钮：已经开着一个浏览器标签页就切过去，没有就开一个空白的
  function openBrowser(tw) {
    var hit = null;
    (tw.ws.all ? tw.ws.all() : []).forEach(function (p) { if (!hit && p.program && p.program.page === "web") hit = p; });
    if (hit) { if (tw.ws.show) tw.ws.show(hit); else tw.ws.activate(hit); hit.focus(); return hit; }
    return window.TSU_WEB ? TSU_WEB.open(tw, "") : openPage(tw, "web", "");
  }

  // ======== 面包屑：标签条下面一行（在哪：agent、会话、文件）；编辑器组里每组一行 ========
  // 目录只在文件里是路径；Claude Code 只写它是哪个项目（开会话时的目录名，历史原因），Paimon 没有目录
  function crumbHtml(P) {
    var prog = P && P.program, parts0 = [], sep = '<span class="st-sepc">›</span>';
    var path = function (p) { var t = tilde(p || ""), segs = t.split("/").filter(Boolean); if (t[0] === "/") segs.unshift("/"); return segs.map(function (x, i) { return i === segs.length - 1 ? "<b>" + esc(x) + "</b>" : esc(x); }); };
    var base = function (p) { var t = String(p || "").replace(/\/+$/, ""); return t ? esc(t.split("/").pop() || t) : ""; };
    if (!prog) parts0 = [];
    else if (prog.page === "file") parts0 = path(prog.arg);
    else if (prog.page) parts0 = []; // 设置、主页这些页面：名字就是标签上那个，不再写一遍
    else if (prog.agentId && /^(c[cx]|pi):/.test(prog.agentId)) { var crt = TSU_AGENTS.runtime(prog.agentId); parts0 = [/^cx:/.test(prog.agentId) ? "Codex" : /^pi:/.test(prog.agentId) ? "pi" : "Claude Code", crt && crt.info && crt.info.cwd ? base(crt.info.cwd) : "", "<b>" + esc(crt ? crt.agent.name : "") + "</b>"].filter(Boolean); }
    else if (prog.agentId) { var ag = window.TSU_AGENTS && TSU_AGENTS.get(prog.agentId), rt = ag && TSU_AGENTS.runtime(ag.id); parts0 = ["Paimon Code", ag ? "<b>" + esc(ag.name) + "</b>" : "", rt && rt.session().title && rt.session().title !== ag.name ? esc(rt.session().title) : ""].filter(Boolean); }
    else if (ccOn() && P.shell && P.shell.fg && /claude/i.test(P.shell.fg.name || "")) { var osc0 = P.shell.oscTitle ? P.shell.oscTitle().replace(/^[^\p{L}\p{N}]+/u, "") : ""; parts0 = ["Claude Code", base(P.shell.fg.cwd || P.shell.cwd())].concat(osc0 ? ["<b>" + esc(osc0) + "</b>"] : []); }
    else if (P.shell && P.shell.cwd) parts0 = path(P.shell.cwd());
    return parts0.join(sep);
  }
  function crumbsInto(el, P) {
    if (!el) return;
    var h = P && getv("breadcrumbs") ? crumbHtml(P) : "";
    el.style.display = h ? "" : "none";
    if (!h) return;
    if (el.dataset.h !== h) { el.dataset.h = h; el.innerHTML = h || "&nbsp;"; }
  }
  function crumbs(tw) {
    if (tw.ws.groups) { // 编辑器组：每组自己一行
      var old = tw.el.querySelector(".tmain > .st-crumbs");
      if (old) old.remove();
      tw.ws.groups().forEach(function (g) { crumbsInto(g.crumbsEl, g.active); });
      return;
    }
    var main = tw.el.querySelector(".tmain");
    if (!main) return;
    var el = main.querySelector(":scope > .st-crumbs");
    if (!el) { el = document.createElement("div"); el.className = "st-crumbs"; main.insertBefore(el, tw.tabsEl.nextSibling); }
    crumbsInto(el, tw.ws.active);
  }

  // ======== 缩略图（minimap，同 VS Code）：面板右边一条，一行画两像素；内容比这条高时，它自己按比例跟着滚——
  //   无级：对话滚到哪（到顶 / 到底 / 中间任何位置），缩略图同比例滚到哪，每一帧都跟着（不是隔一会儿跳一下）。
  //   灰块是看得见的那段：按住灰块拖 = 连续地滚整段；点灰块外面 = 那一行放到中间（接着还能拖）========
  var MAP_LH = 2;
  function previewSet(k, v) { if (v === null) delete SETP[k]; else SETP[k] = v; minis(); }
  function minis() { sweepMini(); allWins().forEach(function (tw) { withSplit((tw.ws.visible ? tw.ws.visible() : [tw.ws.active])).concat(tw.sidePane && tw.sidePane.el.isConnected ? [tw.sidePane] : []).forEach(function (P) { if (P) mini(P); }); }); }
  // 设置里「缩略图：隐藏」：哪里都不画——后台的标签页、右侧栏 / 底部面板里的对话、拆出来的格里留着的也拿掉，让出来的地方收回
  function sweepMini() {
    if (getv("minimap") !== "hide") return;
    document.querySelectorAll(".tpane > .st-map").forEach(function (m) { m.remove(); });
    document.querySelectorAll(".tpane.st-hasmini, .tpane.st-mapclear, .tpane.st-mapfloat").forEach(function (el) { el.classList.remove("st-hasmini", "st-mapclear", "st-mapfloat"); });
  }
  var withSplit = function (ps) { var o = []; ps.forEach(function (p) { if (!p) return; o.push(p); if (p.vs && p.vs.panes) o.push.apply(o, p.vs.panes()); }); return o; }; // 标签页里拆出来的几格（vsplit.js）也各有一条
  function mini(P) {
    var g0 = getv("minimap"), mode = g0 === "hide" ? "hide" : P && P.side && !P.mirror ? (P.compact ? "hide" : sideMini(P.view || {})) : g0; // 右侧栏里的那份：看右侧栏自己的 ··· 选的；设置里隐藏了就哪里都不画（自己的只能更少）
    var on = mode !== "hide" && termapp() && P && P.program && !P.program.gui && (P.program.pty || P.program.agentId || P.program.page === "file") && P.el.clientWidth >= (mode === "scroll" ? 360 : 520); // 太窄的面板不放（字更要紧）
    P.el.classList.toggle("st-hasmini", !!on && mode !== "scroll"); // 浮着的不占地方
    P.el.classList.toggle("st-mapclear", !!on && mode === "transparent");
    P.el.classList.toggle("st-mapfloat", !!on && mode === "scroll");
    if (on && mode === "scroll" && !P.mapWheel) {
      P.mapWheel = true;
      var hideT = 0, reveal = function () {
        var m1 = P.el.querySelector(":scope > .st-map");
        if (!m1 || !P.el.classList.contains("st-mapfloat")) return;
        if (!m1.classList.contains("show")) { m1.classList.add("show"); paintMini(P, m1, true); }
        clearTimeout(hideT);
        hideT = setTimeout(function hide() { if (m1.matches(":hover") || m1.dragging) { hideT = setTimeout(hide, 600); return; } m1.classList.remove("show"); }, 1200);
      };
      P.el.addEventListener("wheel", reveal, { passive: true }); // 手动滚的才算（跟着新输出自动滚到底的不算）
    }
    var m = P.el.querySelector(":scope > .st-map");
    if (!on) { if (m) m.remove(); return; }
    if (!m) {
      m = document.createElement("div");
      m.className = "st-map";
      m.innerHTML = '<canvas></canvas><div class="st-view"></div>';
      P.el.appendChild(m);
      m.addEventListener("pointerdown", function (e) {
        var src = source(P);
        if (!src || e.button !== 0) return;
        e.preventDefault();
        try { m.setPointerCapture(e.pointerId); } catch (x) { /* 不是真的指针（测试）*/ }
        var r = m.getBoundingClientRect(), y = e.clientY - r.top, g = m.geo || { off: 0, total: 1, top: 0, h: 0, H: r.height };
        if (y < g.top || y > g.top + g.h) { src.center((g.off + y) / Math.max(1, g.total)); paintMini(P, m, false); g = m.geo || g; }
        var y0 = e.clientY, f0 = src.frac(), range = Math.max(1, Math.min(g.H, g.total) - g.h);
        var mv = function (ev) { src.setFrac(Math.max(0, Math.min(1, f0 + (ev.clientY - y0) / range))); };
        var up = function () { m.dragging = false; m.removeEventListener("pointermove", mv); m.removeEventListener("pointerup", up); m.removeEventListener("pointercancel", up); };
        m.dragging = true;
        m.addEventListener("pointermove", mv);
        m.addEventListener("pointerup", up);
        m.addEventListener("pointercancel", up);
      });
    }
    follow(P, m);
    paintMini(P, m, true);
  }
  // 滚动的时候每一帧重画（只重画，不重新读内容）
  function follow(P, m) {
    var src = source(P);
    if (!src || m.followKey === src.key) return;
    m.followKey = src.key;
    var raf = 0;
    src.onScroll(function () {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; if (m.isConnected && m.followKey === src.key) paintMini(P, m, false); });
    });
  }
  // 画什么：一行一小条，颜色按这行是什么（你说的话、agent 的话、工具、改动的 + / -）；frac = 滚到了整段的几成（0 顶、1 底）
  function source(P) {
    var prog = P.program;
    if (prog && prog.pty && prog.xterm && prog.xterm()) {
      var x = prog.xterm(), b = x.buffer.active, span = function () { return Math.max(1, b.length - x.rows); };
      return { key: x, el: P.el.querySelector(":scope > .xt") || x.element,
        lines: function () { var o = []; for (var i = 0; i < b.length; i++) { var l = b.getLine(i); o.push(l ? l.translateToString(true) : ""); } return o; },
        view: function () { return [b.viewportY / Math.max(1, b.length), x.rows / Math.max(1, b.length)]; },
        frac: function () { return Math.min(1, b.viewportY / span()); },
        setFrac: function (f) { x.scrollToLine(Math.round(f * span())); },
        center: function (c) { x.scrollToLine(Math.max(0, Math.round(c * b.length - x.rows / 2))); },
        onScroll: function (cb) { x.onScroll(cb); } };
    }
    // 文件（CodeMirror）：它只画看得见的那几十行、自己的 .cm-scroller 在滚——按整篇的文字、它的语法颜色画，跟着它的滚动（以前读 DOM：只有眼前那几十行、还错位）
    var fb = prog && prog.page === "file" ? P.el.querySelector(".st-fbody") : null, cm = fb && fb.ed && fb.ed.api && fb.ed.api.view;
    if (cm && fb.ed.api.lineRuns) {
      var api = fb.ed.api, scd = cm.scrollDOM, span3 = function () { return Math.max(1, scd.scrollHeight - scd.clientHeight); };
      return { key: scd, el: fb, rich: function () { return api.lineRuns(20000); },
        lines: function () { return api.text().split("\n"); },
        view: function () { return [scd.scrollTop / Math.max(1, scd.scrollHeight), scd.clientHeight / Math.max(1, scd.scrollHeight)]; },
        frac: function () { return Math.min(1, scd.scrollTop / span3()); },
        setFrac: function (f) { scd.scrollTop = f * span3(); },
        center: function (c) { scd.scrollTop = c * scd.scrollHeight - scd.clientHeight / 2; },
        onScroll: function (cb) { scd.addEventListener("scroll", cb, { passive: true }); } };
    }
    var sc = prog && prog.page === "file" ? fb : P.screen;
    if (!sc) return null;
    var moved = function () { if (P.onScroll) P.onScroll(true); }, span2 = function () { return Math.max(1, sc.scrollHeight - sc.clientHeight); }; // 拖缩略图是你自己滚的：往上拖就不再跟着到底
    return { key: sc, el: sc,
      lines: function () { return String((prog && prog.page === "file" ? sc : P.term).innerText || "").split("\n"); },
      view: function () { return [sc.scrollTop / Math.max(1, sc.scrollHeight), sc.clientHeight / Math.max(1, sc.scrollHeight)]; },
      frac: function () { return Math.min(1, sc.scrollTop / span2()); },
      setFrac: function (f) { sc.scrollTop = f * span2(); moved(); },
      center: function (c) { sc.scrollTop = c * sc.scrollHeight - sc.clientHeight / 2; moved(); },
      onScroll: function (cb) { sc.addEventListener("scroll", cb, { passive: true }); } };
  }
  // 文件内容的「指纹」：长度 + 语法树算到哪 + 主题（颜色）——变了才重画缩略图的颜色
  function fbSig(P) { var fb = P.el.querySelector(".st-fbody"), api = fb && fb.ed && fb.ed.api; if (!api) return ""; var st = api.view.state; return st.doc.length + ":" + st.doc.lines + ":" + (api.parsedTo ? api.parsedTo() : 0) + ":" + document.documentElement.className; }
  // full：重新量位置、重新读内容（定时的那次）；否则只按现在滚到哪重画（滚动的每一帧）
  // 换了配色：缩略图（canvas，颜色画死在里面）马上照新颜色重画一遍——不等下一次滚动 / 有新内容
  document.addEventListener("st-theme", function () { allPanes().forEach(function (P) { var m = P.el && P.el.querySelector(":scope > .st-map"); if (m) { m.colors = null; paintMini(P, m, true); } }); });
  function paintMini(P, m, full) {
    var src = source(P);
    if (!src) return;
    // 只盖滚动的那块（对话区 / 终端 / 文件正文）：输入栏、文件页的头不让
    if (full && src.el) {
      var pr = P.el.getBoundingClientRect(), er = src.el.getBoundingClientRect(), top0 = Math.round(er.top - pr.top) + "px", ht = Math.round(er.height) + "px";
      if (m.style.top !== top0) m.style.top = top0;
      if (m.style.height !== ht) m.style.height = ht;
    }
    // 内容：照屏幕上真实的样子一格格画（每格就是它在屏幕上的颜色、有底色的行先铺底色；guimap.js 的 richRows）——以前按每行开头的字猜颜色，
    // 「- 列表」「2026-…」都当成 diff 的删除行画成红的；读不到的（别的页面）才照旧按字画
    if (full || !m.lines) {
      // 文件：内容没变（同一个编辑器、同样多的字、语法树没长）就不重算整篇的颜色（700ms 一次的那一下不能每次都走一遍几千行）
      var sig = src.rich ? src.key && (fbSig(P)) : "";
      if (src.rich && m.richSig === sig && m.lines) { /* 照旧 */ }
      else { var rich0 = src.rich ? src.rich() : window.TSU_GUIMAP && TSU_GUIMAP.richRows ? TSU_GUIMAP.richRows(P) : null; m.rich = !!rich0; m.lines = rich0 || src.lines(); m.richSig = sig; }
    }
    var lines = m.lines, rich = m.rich ? lines : null, cv = m.querySelector("canvas"), W = m.clientWidth, H = m.clientHeight, dpr = window.devicePixelRatio || 1;
    var total = lines.length * MAP_LH, off = total > H ? Math.round(src.frac() * (total - H)) : 0;
    if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px"; }
    var g = cv.getContext("2d");
    if (full || !m.colors) { var cs = getComputedStyle(root), col = function (v) { return cs.getPropertyValue(v).trim() || "#888"; }; m.colors = { hi: col("--st-hi"), fg: col("--st-fg"), dim: col("--st-dim"), orange: col("--st-orange"), green: col("--st-green"), red: col("--st-red") }; }
    var C = m.colors;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.globalAlpha = 0.7;
    var cw = Math.min(1.2, (W - 8) / 100);
    for (var i = Math.floor(off / MAP_LH), n = Math.min(lines.length, Math.ceil((off + H) / MAP_LH) + 1); i < n; i++) {
      if (rich) { TSU_GUIMAP.drawRow(g, rich.get ? rich.get(i) : rich[i], i * MAP_LH - off, cw, W, MAP_LH); continue; }
      var t = lines[i].replace(/\s+$/, "");
      if (!t) continue;
      g.fillStyle = /^\s*❯/.test(t) ? C.hi : /^\s*[⏺●]/.test(t) ? C.fg : /^\s*⎿/.test(t) ? C.dim : /^\s*\d*\s*\+/.test(t) ? C.green : /^\s*\d*\s*-/.test(t) ? C.red : /^\s*[✻✳✶✽✢·]/.test(t) ? C.orange : C.dim;
      var re = /\S+/g, mm, y = i * MAP_LH - off;
      while ((mm = re.exec(t)) && mm.index * cw < W - 6) g.fillRect(4 + mm.index * cw, y, Math.max(1, Math.min(mm[0].length * cw, W - 6 - mm.index * cw)), MAP_LH * 0.7);
    }
    var v = src.view(), vw = m.querySelector(".st-view"), top = v[0] * total - off, hh = Math.max(8, v[1] * total);
    vw.style.top = top + "px";
    vw.style.height = hh + "px";
    m.geo = { off: off, total: total, top: top, h: hh, H: H };
  }
  setInterval(function () { if (document.hidden) return; minis(); }, 700); // 每组看得见的那个都有，右侧栏里的对话、标签页里拆出来的格也算（隐藏时顺带把各处留着的拿掉）

  // ======== 命令 ========
  command("view.side", { title: "切换辅助侧栏", keys: "⌥⌘I", run: function (tw) { toggleSide(tw); } });
  command("view.panel", { title: "切换面板", keys: "⌘J", run: function (tw) { togglePanel(tw); } });
  command("view.status", { title: "切换状态栏", run: function () { toggleStatus(); } });
  command("view.left", { title: "切换主侧栏", keys: "⌘B", run: function (tw) { if (tw.side) tw.side.toggle(); } });
  command("view.agents", { title: "显示 Agent", keys: "⇧⌘E", run: function (tw) { showView(tw, "agents"); } });
  command("view.search", { title: "在对话中搜索", keys: "⇧⌘F", run: function (tw) { showView(tw, "search"); } });
  command("view.extensions", { title: "显示扩展", keys: "⇧⌘X", run: function (tw) { showView(tw, "extensions"); } });
  command("view.layout", { title: "自定义布局…", run: function (tw) { layoutPick(tw); } });
  command("view.overview", { title: "标签页概览", keys: "⇧⌘\\", run: function (tw) { if (window.TSU_OVERVIEW) TSU_OVERVIEW.toggle(tw, true); } });
  command("view.appExpose", { title: "App Exposé（仅显示同类标签页）", keys: "⌥⌘\\", run: function (tw) { if (window.TSU_OVERVIEW) TSU_OVERVIEW.appExpose(tw); } });
  command("view.zen", { title: "切换禅模式", keys: "⌘K Z", run: function (tw) { toggleZen(tw); } });
  command("view.ui", { title: "切换 Agent 显示风格（TUI / GUI）", run: function (tw) {
    if (OS_UI[getv("os", true)]) return settings(tw, "appearance:ui"); // 应用风格定死了：打开设置里那一项（写着为什么不能换）
    setv("ui", getv("ui") === "gui" ? "tui" : "gui");
  } });
  command("view.os", { title: "选择应用风格…", run: function (tw) { quickPick(tw, { placeholder: "应用风格", items: osModesNow().map(function (x) { return { id: x[0], title: x[1], on: (getv("os") || "vscode") === x[0] }; }), pick: function (it) { setv("os", it.id); } }); } });
  command("view.lang", { title: "配置显示语言", run: function (tw) { pickLang(tw); } });
  command("view.sideBarPos", { title: "切换主侧栏位置", run: function (tw) { setv("sideBarPos", getv("sideBarPos") === "right" ? "left" : "right"); } });
  command("term.new", { title: "新建终端", keys: "⌃`", run: function (tw) { newTerm(tw); } });
  command("settings", { title: "设置", keys: "⌘,", run: function (tw) { settings(tw, sectionFor(tw)); } });
  command("settings.claude", { title: "设置：Claude Code", when: ccOn, run: function (tw) { settings(tw, "claude"); } });
  command("settings.json", { title: "打开 Claude Code 的 settings.json", when: ccOn, run: function (tw) { openFile(tw, ccFile()); } });
  command("studio.json", { title: "打开设置 (JSON)", run: function (tw) { if (LOC() && !HYB()) openFile(tw, setFile()); } });
  command("scheme", { title: "配色方案…", keys: "⌘K ⌘T", run: function (tw) { pickScheme(tw); } });
  command("view.minimap", { title: "切换缩略图", run: function () { setv("minimap", getv("minimap") === "hide" ? SET_DEF.minimap : "hide"); } });
  command("highlight", { title: "高亮配色…", run: function (tw) { pickHighlight(tw); } });
  command("keys", { title: "键盘快捷方式", keys: "⌘K ⌘S", when: function () { return !root.classList.contains("st-os-claude"); }, run: function (tw) { showPage(tw, "keys"); } });
  command("palette", { title: "命令面板", keys: "⇧⌘P", run: function (tw) { palette(tw, "cmd"); } });
  command("quickopen", { title: "快速打开", keys: "⌘P", run: function (tw) { palette(tw, "open"); } });
  command("view.crumbs", { title: "切换路径导航", run: function () { setv("breadcrumbs", !getv("breadcrumbs")); } });
  command("view.activity", { title: "切换活动栏", run: function () { setv("activityBar", !getv("activityBar")); } });

  // ======== 快捷键（App 里）：⌥⌘I 右侧栏 · ⌘J 终端面板 · ⌘B 左边栏 · ⌘, 设置 · ⇧⌘P 命令面板 · ⌘P 快速打开 · ⌃` 新终端 ========
  window.addEventListener("keydown", function (e) {
    if (!termapp()) return;
    var tw = T() && T().front();
    if (!tw) return;
    var hit = function (f) { e.preventDefault(); e.stopPropagation(); f(); };
    if (e.ctrlKey && !e.metaKey && e.code === "Backquote") return hit(function () { newTerm(tw); });
    if (chordK && e.metaKey && e.code === "KeyT") { chordK = false; return hit(function () { pickScheme(tw); }); }
    if (chordK && e.metaKey && e.code === "KeyS") { chordK = false; return hit(function () { showPage(tw, "keys"); }); }
    if (chordK && !e.metaKey && e.code === "KeyZ") { chordK = false; return hit(function () { toggleZen(tw); }); } // ⌘K Z：禅模式
    chordK = false;
    if (e.metaKey && !e.shiftKey && !e.altKey && e.code === "KeyK" && document.activeElement && !/xterm-helper/.test(document.activeElement.className || "")) { chordK = true; setTimeout(function () { chordK = false; }, 1500); }
    if (e.metaKey && e.ctrlKey && !e.shiftKey && !e.altKey && /^Digit[1-4]$/.test(e.code)) return hit(function () { var m = OS_MODES[+e.code.slice(5) - 1]; if (m && osOk(m[0])) setv("os", m[0]); }); // ⌃⌘1–4：应用风格（⌃⌘3、4 要打开开发者功能）
    if (!e.metaKey || e.ctrlKey) return;
    if (e.altKey && !e.shiftKey && e.code === "KeyI") return hit(function () { toggleSide(tw); });
    if (e.altKey || !window.nadosNative && !e.shiftKey && e.code !== "KeyJ") { if (e.code !== "Comma") return; }
    if (!e.shiftKey && e.code === "KeyJ") return hit(function () { togglePanel(tw); });
    if (!e.shiftKey && e.code === "KeyB") return hit(function () { if (tw.side) tw.side.toggle(); });
    if (!e.shiftKey && e.key === ",") return hit(function () { settings(tw, sectionFor(tw)); });
    if (e.shiftKey && e.code === "KeyP") return hit(function () { palette(tw, "cmd"); });
    if (e.shiftKey && e.code === "KeyF") return hit(function () { showView(tw, "search"); });
    if (e.shiftKey && e.code === "KeyE") return hit(function () { showView(tw, "agents"); });
    if (e.shiftKey && e.code === "KeyX") return hit(function () { showView(tw, "extensions"); });
    if (!e.shiftKey && e.code === "KeyP") return hit(function () { palette(tw, "open"); });
  }, true);
  var chordK = false;
  // 右键：没有自己菜单的地方不弹 WebKit 默认的那个（「重新载入」「后退」……）；输入框、终端、选着字时照常（复制、粘贴、查询）
  document.addEventListener("contextmenu", function (e) {
    if (e.defaultPrevented || !termapp()) return;
    var t = e.target;
    if (t && t.closest && t.closest("input, textarea, [contenteditable=''], [contenteditable='true'], .xterm")) return;
    if (String(window.getSelection() || "").trim()) return;
    e.preventDefault();
  });
  // 当前标签页是哪种页面，设置就从哪一区开始
  // 「设置」（⌘,、⚙ 菜单、命令面板、App 菜单）一律从「通用」进（用户定的：不按当前标签页猜、不记上次看到哪）；
  //   从别处点进来的（账号菜单 → 账号、连接器的齿轮 → 那个连接器、/config → Paimon）照旧去它们自己那一页
  function sectionFor() { return "general"; }
  // 页面起来以后：面板里的终端接回来
  var restored = false;
  setInterval(function () { if (restored || !termapp()) return; var tw = T() && T().front(); if (!tw || !LOC()) return; restored = true; LOC().ready.then(function () { parts(tw); restorePanel(tw); render(tw); }); }, 500);

  applySettings();
  window.STUDIO = {
    layItems: function (tw) { return layItems(tw); }, layConcise: function () { return layConcise(); }, layMenu: function (tw, el) { layMenu(tw, el); }, // 手机上标签栏的那一个按钮：设置、账号、布局（标题栏收起来了）
    islandSync: function () { islandSync(); },
    // Claude Code 的推理强度（~/.claude/settings.json：这个模型单独设的，没有就是总的）；转圈那一行「thinking with max effort」用
    ccEffort: function (model) { readCCSettings(); var s0 = ccSettings.j || {}, base = String(model || s0.model || "").replace(/\[1m\]$/i, ""); return (s0.modelSettings && s0.modelSettings[base] && s0.modelSettings[base].effortLevel) || s0.effortLevel || ""; },
    set: set, remove: remove, clear: clear, list: list, slotOf: function (P, id) { var el = P && P.els && P.els[id]; return slotOf(el ? el.site || "paimon" : "paimon", id); },
    // 辅助侧栏里对话那一块显示哪些（输入框、对话的哪几种）：看现在的；预览一项（不存，v 给 null 回到原来的）
    sideView: function () { return Object.assign({}, sideView()); }, previewSideView: function (tw, k, v) { sidePrev(tw, k, v)(v !== null); },
    // agent 的「任务」一家子（任务清单、后台任务、子 Agent）：在哪（side 辅助侧栏 / card Claude App 的卡片 / drawer 标签页最下面）、画出来、收起、⌃T、对话 ··· 里的「显示」
    familyHost: familyHost, familyHtml: familyHtml, applyFold: applyFold, familyChanged: familyChanged, act: function (tw, what, el) { return action(tw, what, el); }, famPressed: function () { return famPress; },
    agentPaneFor: agentPaneFor, // agent 这一级跟着哪个标签页（编辑区当前的不是 agent 时，是最近用的那个）
    todoShown: todoShown, toggleTodo: toggleTodo, toggleTodoDone: toggleTodoDone, tasksOf: tasksOf, todoHead: todoHead, todoRowsHtml: todoRowsHtml, agentMenuItems: agentMenuItems,
    inline: inlineOn, place: place, render: render, renderSoon: renderSoon, types: TYPES, composerAway: composerAway, focusSide: focusSide,
    toggle: toggleSide, isOpen: function () { return !!L.side; }, togglePanel: togglePanel, panelOpen: function () { return !!L.panel; }, panelView: panelView, toggleStatus: toggleStatus, newTerm: newTerm,
    openFile: openFile, fileLinks: fileLinks, fromOSC: fromOSC, fgChanged: fgChanged, osc: osc,
    askUnsaved: askUnsaved, // 关标签页 / 窗格 / 窗口之前：里面有改了没存的文件就问保存 / 不保存 / 取消（live.js 的 askClose 先走这里）
    renderPanelAll: function () { allWins().forEach(function (w) { try { renderPanel(w); } catch (e) { /* 下一次再画 */ } }); },
    page: page, pages: PAGES, openPage: openPage, openBrowser: openBrowser, addSettings: addSettings, layoutPick: function (tw) { layoutPick(tw); }, menuOpen: function () { return menus.length > 0; }, firstRun: function () { firstRun(true); }, moveActivity: function (to) { moveActivity(to); }, settings: function (tw, sec) { settings(tw, sec || (tw ? sectionFor(tw) : "")); }, sectionFor: sectionFor,
    modal: { open: modalOpen, close: modalClose, top: function () { return MODALS[MODALS.length - 1] || null; } }, // 模态层：open(窗口元素, { cls, onBackdrop, onClose }) → M；close(M)
    avatarHtml: avatarHtml, avatarNext: avatarNext, // 自己的头像：avatarHtml(边长 px, 再加的 class)；avatarNext() 是点一下换成的那个值（setv("avatar", …)）
    command: command, palette: palette, quickPick: quickPick, menu: menu, ask: ask, pickMac: function (tw) { pickMac(tw); }, openMac: openMac, familyChanged: function () { familyChanged(); }, showPage: showPage, floatPage: floatPage, pickScheme: pickScheme, pickHighlight: pickHighlight, hlHtml: hlHtml, get: getv, setv: setv, settingsReady: function () { return setReady; }, xtermTheme: function (sc, where) { return xtermTheme(sc, where); }, scheme: function () { return schemeOf(); },
    keycaps: function (k) { return keycaps(k); },
    updateReady: function () { return updateReady; },
    about: function (tw) { tw = tw || allWins()[0]; if (tw) settings(tw, "about"); return !!tw; }, // App 菜单「关于 Vibing Studio」（新版原生先问这个）
    needsList: needsList, // 有新版本了（页面的脚本在服务器上变了）：重新载入就用上
    crumbs: crumbs, crumbsInto: crumbsInto, mini: mini, miniModes: MINI_MODES, uiModes: UI_MODES, get osModes() { return osModesNow(); }, applySettings: function () { applySettings(); }, previewSet: previewSet, previewOf: function (k) { return SETP[k]; }, layoutPick: layoutPick, _activityHtml: function () { return activityHtml(); }, menuIcons: function () { return MI; }, showView: showView, addView: addView, viewDef: function (id) { return VIEWS[id] || null; }, toolbarMenu: toolbarMenu, tbHidden: tbHidden, icons: ICO, preview: preview,
  };
})();
