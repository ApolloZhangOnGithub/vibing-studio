// claude.js —— Claude Code 的会话在 paimon code 里看、接着说（agent 一直在跑：后台、别的终端里；这里打开的是观察它的视图，关掉标签页它照跑）。
//   看：读它的会话记录（~/.claude/projects/<项目>/<会话>.jsonl）转成 Paimon 的对话，用同一个界面画（右侧栏「视图」里的开关对它一样管用）；
//       文件只读最后一段（几百 MB 的也快），之后跟着读新追加的——它在后台、在别的终端里干什么，这里都看得见
//   说：claude -p --resume <会话> --input-format stream-json --output-format stream-json（它照常把对话写回会话记录，这边跟着读出来）；Esc 打断
//   正在后台跑的（claude --bg）：说的话经官方的 `claude attach <job>` 送进去（同你在终端里接上它、打字、回车），送完就断开，它照跑；
//   开在别的终端里的：只看不说——那个终端的输入框归那边，这边插进去会和那边打的字搅在一起；在那个终端里说，或者关掉它再从这里接着说
// 运行时的样子同 agents.js 的 Runtime（每种外壳只认这些）：on、session()、stream、state()、todo()、model()、ctx()、send()、interrupt()…
// 这是连接器（ext.js 的 TSU_CONNECTORS：claude-code）：开着才有 window.TSU_CLAUDE，界面上跟 Claude Code 有关的都看它
(function () {
  "use strict";
  // /goal 结束了：达成了（met），或者判不了 / 放弃了（failed：它判定这个条件没法评估，Claude Code 就把目标清掉了、/goal 显示 No goal set），
  //   以及以后可能有的 cleared / cancelled / stopped / expired——都不再算「在跑」（用户 2026-10-28：目标早清掉了，右边还写着 active 13d）
  function goalEnded(gs) { return !!(gs && (gs.met || gs.failed || gs.cleared || gs.cancelled || gs.canceled || gs.stopped || gs.expired)); }
  // 这边起的 claude -p 进程（stream-json）：页面要走了（重新载入、关窗口）就全部停掉——不然成了孤儿进程一直占着会话，
  // 用户在终端里 claude --resume / 后台会话列表里打开它会被拒（「this session is running in another terminal」）
  var LIVE_PROCS = new Set();
  window.addEventListener("pagehide", function () { LIVE_PROCS.forEach(function (p) { try { p.kill(); } catch (e) { /* 已经停了 */ } }); });
  var LOC = window.TSU_LOCAL, A = window.TSU_AGENTS;
  if (!LOC || !A || !A.registerExternal) { window.TSU_CLAUDE = null; return; }
  var TAIL = 3 << 20, WINDOW = 16 << 20;
  // 心跳：这个页面还在（run/hb 里写「页面编号 时间」，5 秒一次）。后台起的长流（看 Claude Code 的屏幕，DAEMON_WATCH_PL）看它：
  //   页面刷新了、关了，旧页面起的流自己退出——不再把没人要的输出推给页面（以前一天下来攒二十多条，App 卡死）
  var HB = { id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), path: "" };
  var shq = function (x) { return "'" + String(x).replace(/'/g, "'\\''") + "'"; };
  (LOC.ready || Promise.resolve()).then(function () {
    var info = LOC.info && LOC.info();
    if (!info || !info.home || !LOC.write) return;
    HB.path = info.home + "/Library/Application Support/Vibing Studio/run/hb-" + HB.id; // 每个页面一个（开着两个窗口也互不干扰）
    var beat = function () { LOC.write(HB.path, HB.id + " " + Date.now()).catch(function () {}); };
    beat(); setInterval(beat, 5000);
    // 以前的页面留下的、还不认心跳的老流：一开始清一次（只认那段 perl 的原样，别的进程不碰）
    if (LOC.exec) LOC.exec({ cmd: "ps -Ao pid=,command= | grep -F 'IO::Socket::UNIX->new(Peer => $ARGV[0])' | grep -F 'while (my $l = <$s>) { print $l; }' | grep -v grep | awk '{print $1}' | while read p; do kill \"$p\" 2>/dev/null; done; true" }).catch(function () {});
  });
  var ts = function (j) { var t = Date.parse(j && j.timestamp || ""); return isNaN(t) ? Date.now() : t; };
  var bytes = function (s) { return new TextEncoder().encode(s).length; };
  // 界面上的字（提示、记下的说明、标题）：用 i18n.js 的词典 / 规则翻成现在的语言（中文原样）
  var tr = function (s) { return window.TSU_I18N && TSU_I18N.t ? TSU_I18N.t(s) : s; };
  var rts = {};
  // Claude Code 的模型（全名；带 [1m] 的是 1M 上下文那种，原样传给 --model）。def：~/.claude/settings.json 里的默认模型
  // 模型：同 Claude Desktop 的选择器——上面常用的四个（最新的每家一个），「更多模型」里是 1M 上下文的和上一代的（这一版 Claude Code 认得的）
  var CC = { MODELS: ["claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5", "claude-haiku-4-5-20251001"], MORE: ["claude-opus-5-5[1m]", "claude-sonnet-5[1m]", "claude-opus-5", "claude-fable-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6"], def: "" };
  (LOC.ready || Promise.resolve()).then(function () { return LOC.read(LOC.info().home + "/.claude/settings.json"); }).then(function (b) { try { var sj = JSON.parse(new TextDecoder().decode(new Uint8Array(b))); CC.def = String(sj.model || ""); CC.defMode = String((sj.permissions && sj.permissions.defaultMode) || ""); CC.autoCompact = sj.autoCompactEnabled !== false; } catch (e) { /* 没设 */ } }, function () {}); // autoCompact：它的自动压缩开着没（/config 里那一项；没设就是开）
  // 5 小时、7 天的限额用了多少：Claude Code 不写到本机文件里，只在它自己的输出里报（stream-json 的 rate_limit_event）——
  // 这边起的 claude -p 每次报了就记下来（带时间），状态行、设置 › 用量都用这一份；从没报过就是 n/a
  CC.limits = (function () { try { return JSON.parse(localStorage.getItem("tsu-cc-limits") || "null"); } catch (e) { return null; } })();
  function keepLimits(ri) {
    var w = ri.unifiedWindows || {}, pc = function (x) { return x && typeof x.utilization === "number" ? Math.round(x.utilization <= 1 ? x.utilization * 100 : x.utilization) : null; };
    CC.limits = { five: pc(w.five_hour), week: pc(w.seven_day), resets5: w.five_hour && w.five_hour.resetsAt, resets7: w.seven_day && w.seven_day.resetsAt, status: ri.status || "", at: Date.now() };
    try { localStorage.setItem("tsu-cc-limits", JSON.stringify(CC.limits)); } catch (e) { /* 满了 */ }
  }
  // 不用查询的一份：Claude Code 的状态行命令每刷新一次，把它拿到的那份 JSON 原样存到 ~/.claude/statusline-last.json（里面有 rate_limits——同它状态行上的 5h / 7d）。
  //   这边隔一会儿读一下这个文件（本机读文件，不发请求），内容变了就用它；限额是整个账号的，哪个会话刷新的都一样
  var slLast = "";
  CC.slCtx = {};
  function readStatusline() {
    if (document.hidden) return;
    (LOC.ready || Promise.resolve()).then(function () { return LOC.read(LOC.info().home + "/.claude/statusline-last.json"); }).then(function (b) {
      var txt = new TextDecoder().decode(new Uint8Array(b));
      if (!txt || txt === slLast) return;
      slLast = txt;
      var j = JSON.parse(txt), rl = j && j.rate_limits, cw = j && j.context_window;
      if (j && j.session_id && cw && typeof cw.used_percentage === "number") CC.slCtx[j.session_id] = { tokens: cw.total_input_tokens || 0, window: cw.context_window_size || 0, pct: cw.used_percentage, at: Date.now() }; // 这个会话的上下文（同它状态行上的 Ctx）
      if (!rl) return;
      var pc = function (x) { return x && typeof x.used_percentage === "number" ? Math.round(x.used_percentage) : null; }, rs = function (x) { return x && x.resets_at ? (x.resets_at < 1e12 ? x.resets_at * 1000 : x.resets_at) : null; };
      CC.limits = { five: pc(rl.five_hour), week: pc(rl.seven_day), resets5: rs(rl.five_hour), resets7: rs(rl.seven_day), status: "", at: Date.now(), src: "statusline" };
      try { localStorage.setItem("tsu-cc-limits", JSON.stringify(CC.limits)); } catch (e) { /* 满了 */ }
      Object.keys(rts).forEach(function (k) { var r0 = rts[k]; if (r0 && r0.poke) r0.poke(); });
    }).catch(function () { /* 没有这个文件（状态行没配这一句）：用 claude -p 报的那份 */ });
  }
  setTimeout(readStatusline, 1200);
  setInterval(readStatusline, 15000);
  document.addEventListener("visibilitychange", readStatusline);
  // ---- ← 那一块的数据（同 Claude Code 的 ← 视图）：它的后台会话（~/.claude/jobs/<短 id>/state.json）+ 哪些正开在别的终端里（~/.claude/sessions/*.json）；只读，4 秒内不重读 ----
  var JOBS = { at: 0, list: [], regs: {} };
  var readJson = function (p) { return LOC.read(p).then(function (b) { try { return JSON.parse(new TextDecoder().decode(new Uint8Array(b))); } catch (e) { return null; } }, function () { return null; }); };
  function jobsNow() {
    if (Date.now() - JOBS.at < 4000) return Promise.resolve(JOBS);
    var home = LOC.info().home, lst = function (p) { return LOC.list(p).then(function (r) { return Array.isArray(r) ? r : []; }, function () { return []; }); };
    return Promise.all([
      lst(home + "/.claude/jobs").then(function (ds) { return Promise.all(ds.filter(function (d) { return d.dir; }).map(function (d) { return readJson(home + "/.claude/jobs/" + d.name + "/state.json").then(function (j) { if (j) j.short = d.name; return j; }); })); }),
      lst(home + "/.claude/sessions").then(function (fs) { return Promise.all(fs.filter(function (f) { return /^\d+\.json$/.test(f.name); }).map(function (f) { return readJson(home + "/.claude/sessions/" + f.name); })); }),
    ]).then(function (r) {
      var regs = {};
      (r[1] || []).forEach(function (s) { if (s && s.sessionId) regs[s.sessionId] = s; });
      JOBS = { at: Date.now(), list: (r[0] || []).filter(Boolean).sort(function (a, b) { return Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0); }), regs: regs };
      return JOBS;
    }).catch(function () { return JOBS; });
  }
  // 分成「等你回复」「在干活」「已完成」；最前面是现在这个会话（「current session」）。每一项：{ id（会话 id）, name, right（右边那一列）, st（状态）, current, term（开在别的终端里）}
  function islandOf(curSid, cur) {
    return jobsNow().then(function (J) {
      var needs = [], working = [], done = [], me = { id: curSid, name: "current session", current: true, st: cur.busy ? "working" : "needs", right: cur.fresh ? "send a prompt to start" : cur.busy ? "working" : clip(cur.last || "send a prompt to continue", 200) };
      (cur.busy ? working : needs).push(me);
      // 同名的（这一列表里重名、或者和别的会话重名）：名字后面带短 id（tag，见 dupTag）
      seeNames(J.list.map(function (j) { return { id: j.sessionId, name: j.name }; }), true);
      var nOf = function (j) { return tidy(j.name || j.intent || j.short).slice(0, 60); }, cnt = {};
      J.list.forEach(function (j) { if (j.sessionId) { var k = nameKey(nOf(j)); cnt[k] = (cnt[k] || 0) + 1; } });
      J.list.forEach(function (j) {
        if (!j.sessionId || j.sessionId === curSid) return;
        var reg = J.regs[j.sessionId], it = { id: j.sessionId, job: j.short, cwd: j.cwd || "", name: nOf(j), st: j.state || "" };
        it.tag = cnt[nameKey(it.name)] > 1 ? String(j.sessionId).slice(0, 8) : dupTag(j.sessionId, it.name);
        if (reg && reg.kind === "interactive") { it.term = true; it.right = "Open in a terminal · continue it there"; }
        else it.right = clip(String(j.detail || (j.output && j.output.result) || j.state || ""), 200);
        if (j.state === "working") working.push(it); else if (/^(needs_input|needs-input|waiting|blocked|input)$/.test(j.state || "")) needs.push(it); else done.push(it);
      });
      var others = J.list.filter(function (j) { return j.sessionId && j.sessionId !== curSid && j.state === "working"; }).length;
      return { groups: [{ title: "Needs input", items: needs }, { title: "Working", items: working }, { title: "Completed", items: done }].filter(function (g) { return g.items.length; }), running: others };
    });
  }
  var clip = function (s, n) { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  // 文件大小（同 Claude Code 的 formatFileSize）：512 bytes、120.6KB、3MB
  var fsize = function (n) { var kb = n / 1024; if (kb < 1) return n + " bytes"; if (kb < 1024) return kb.toFixed(1).replace(/\.0$/, "") + "KB"; var mb = kb / 1024; if (mb < 1024) return mb.toFixed(1).replace(/\.0$/, "") + "MB"; return (mb / 1024).toFixed(1).replace(/\.0$/, "") + "GB"; };
  // 思考块是不是「旁白」（同 Claude Code）：签名是 base64 的 protobuf，字段 2 → 1 → 8 是 "narration" 的，Claude Code 当普通的一段话画（● 开头），不是「∴ Thinking」
  var pbVar = function (b, i) { var v = 0, m = 1; for (var k = 0; k < 10; k++) { if (i + k >= b.length) return null; var x = b[i + k]; v += (x & 127) * m; if (!(x & 128)) return [v, i + k + 1]; m *= 128; } return null; };
  function pbField(b, want) { // 读不通的：当没有（同 Claude Code）
    var i = 0, got;
    while (i < b.length) {
      var t = pbVar(b, i);
      if (!t) return;
      var wt = t[0] & 7, f = Math.floor(t[0] / 8);
      i = t[1];
      if (wt === 0) { var x = pbVar(b, i); if (!x) return; i = x[1]; }
      else if (wt === 1) { if (i + 8 > b.length) return; i += 8; }
      else if (wt === 2) { var l = pbVar(b, i); if (!l || l[0] > b.length - l[1]) return; if (f === want) got = b.subarray(l[1], l[1] + l[0]); i = l[1] + l[0]; }
      else if (wt === 5) { if (i + 4 > b.length) return; i += 4; }
      else return;
    }
    return got;
  }
  // 转圈那一行的词（同 Claude Code 的 SPINNER_VERBS，constants/spinnerVerbs.ts）：每一问随机一个，按这一问开头的时间挑（重画、TUI / GUI 都是同一个）
  var SPIN_VERBS = ["Accomplishing","Actioning","Actualizing","Architecting","Baking","Beaming","Beboppin'","Befuddling","Billowing","Blanching","Bloviating","Boogieing","Boondoggling","Booping","Bootstrapping","Brewing","Bunning","Burrowing","Calculating","Canoodling","Caramelizing","Cascading","Catapulting","Cerebrating","Channeling","Channelling","Choreographing","Churning","Clauding","Coalescing","Cogitating","Combobulating","Composing","Computing","Concocting","Considering","Contemplating","Cooking","Crafting","Creating","Crunching","Crystallizing","Cultivating","Deciphering","Deliberating","Determining","Dilly-dallying","Discombobulating","Doing","Doodling","Drizzling","Ebbing","Effecting","Elucidating","Embellishing","Enchanting","Envisioning","Evaporating","Fermenting","Fiddle-faddling","Finagling","Flambéing","Flibbertigibbeting","Flowing","Flummoxing","Fluttering","Forging","Forming","Frolicking","Frosting","Gallivanting","Galloping","Garnishing","Generating","Gesticulating","Germinating","Gitifying","Grooving","Gusting","Harmonizing","Hashing","Hatching","Herding","Honking","Hullaballooing","Hyperspacing","Ideating","Imagining","Improvising","Incubating","Inferring","Infusing","Ionizing","Jitterbugging","Julienning","Kneading","Leavening","Levitating","Lollygagging","Manifesting","Marinating","Meandering","Metamorphosing","Misting","Moonwalking","Moseying","Mulling","Mustering","Musing","Nebulizing","Nesting","Newspapering","Noodling","Nucleating","Orbiting","Orchestrating","Osmosing","Perambulating","Percolating","Perusing","Philosophising","Photosynthesizing","Pollinating","Pondering","Pontificating","Pouncing","Precipitating","Prestidigitating","Processing","Proofing","Propagating","Puttering","Puzzling","Quantumizing","Razzle-dazzling","Razzmatazzing","Recombobulating","Reticulating","Roosting","Ruminating","Sautéing","Scampering","Schlepping","Scurrying","Seasoning","Shenaniganing","Shimmying","Simmering","Skedaddling","Sketching","Slithering","Smooshing","Sock-hopping","Spelunking","Spinning","Sprouting","Stewing","Sublimating","Swirling","Swooping","Symbioting","Synthesizing","Tempering","Thinking","Thundering","Tinkering","Tomfoolering","Topsy-turvying","Transfiguring","Transmuting","Twisting","Undulating","Unfurling","Unravelling","Vibing","Waddling","Wandering","Warping","Whatchamacalliting","Whirlpooling","Whirring","Whisking","Wibbling","Working","Wrangling","Zesting","Zigzagging"];
  // 一问做完那一行的过去式（同 Claude Code 的 TURN_COMPLETION_VERBS）：「✻ Baked for 3m 15s」
  var DONE_VERBS = ["Baked", "Brewed", "Churned", "Cogitated", "Cooked", "Crunched", "Sautéed", "Worked"];
  var doneVerb = function (t) { var h = Math.floor(+t || 0) % 2147483647; h = (h * 16807) % 2147483647; return DONE_VERBS[h % DONE_VERBS.length]; };
  // 同 Claude Code 2.1.281（ig）：结尾那行的词按那条 turn_duration 记录的 uuid 算（字符串哈希 h = h * 31 + c），同一问在它那里、这里是同一个词
  var doneVerbU = function (u) { var e = 0; u = String(u || ""); for (var n = 0; n < u.length; n++) e = (e << 5) - e + u.charCodeAt(n) | 0; return DONE_VERBS[(e >>> 0) % DONE_VERBS.length]; };
  var verbFor = function (t) { var h = Math.floor(+t || 0) % 2147483647; h = (h * 48271) % 2147483647; return SPIN_VERBS[h % SPIN_VERBS.length] || "Working"; };
  function narration(sig) {
    if (!sig) return false;
    try {
      var s0 = atob(sig), b = new Uint8Array(s0.length);
      for (var i = 0; i < s0.length; i++) b[i] = s0.charCodeAt(i);
      var a = pbField(b, 2), c = a && pbField(a, 1), d = c && pbField(c, 8);
      return !!d && new TextDecoder().decode(d) === "narration";
    } catch (e) { return false; }
  }
  // 模型的显示名：claude-opus-5-5[1m] → Opus 5.5 · 1M；claude-haiku-4-5-20251001 → Haiku 4.5
  function ccName(m) {
    if (!m) return "Claude";
    var one = /\[1m\]$/i.test(m), b = String(m).replace(/\[1m\]$/i, "").replace(/-\d{8}$/, ""), x = /^(?:claude-)?(opus|sonnet|haiku|fable)(?:-(\d+)(?:-(\d+))?)?$/i.exec(b);
    var n = x ? x[1].charAt(0).toUpperCase() + x[1].slice(1).toLowerCase() + (x[2] ? " " + x[2] + (x[3] ? "." + x[3] : "") : "") : b;
    return n + (one ? " · 1M" : "");
  }

  // 标签页上的名字：上一次显示的记在这台设备上（tsu-cc-name）——重开 App、重新载入时标签页一出来就是它，不先露出会话 ID 等读完文件再换
  var NAME_K = "tsu-cc-name", nameMem = (function () { try { return JSON.parse(localStorage.getItem(NAME_K) || "{}") || {}; } catch (e) { return {}; } })(), nameT = 0;
  function nameKeep(id, n) {
    n = String(n || "");
    if (!n || nameMem[id] === n || n === String(id).slice(0, 8)) return;
    delete nameMem[id]; nameMem[id] = n; // 删了再加：最近用的排在后面，超了从前面丢
    clearTimeout(nameT);
    nameT = setTimeout(function () { try { var ks = Object.keys(nameMem); ks.slice(0, Math.max(0, ks.length - 500)).forEach(function (k) { delete nameMem[k]; }); localStorage.setItem(NAME_K, JSON.stringify(nameMem)); } catch (e) { /* 满了 */ } }, 400);
  }
  function Runtime(aid, info) {
    var rt = this, sid = aid.slice(3), subs = [], turns = [], t00 = info.title || nameMem[sid] || (TITLES[sid] && TITLES[sid].good ? TITLES[sid].t : ""), sess = { id: sid, title: t00 || sid.slice(0, 8), turns: turns, todo: { items: [] }, ctx: info.ctx || 0, updated: info.mtime || 0 };
    var agent = rt.agent = { id: aid, name: sess.title, effort: "", access: "rw", model: info.model || "", current: sid, goal: null, archived: false, claude: true };
    (function () { var nm = agent.name; Object.defineProperty(agent, "name", { enumerable: true, configurable: true, get: function () { return nm; }, set: function (v) { nm = v; nameKeep(sid, v); } }); nameKeep(sid, nm); })(); // 名字一变就记下（各处直接赋值 agent.name 的都算上）
    rt.info = info;
    rt.sid = sid;
    var emit = function (t, d) { subs.slice().forEach(function (f) { try { f(t, d); } catch (e) { console.error(e); } }); };
    rt.on = function (fn) { subs.push(fn); if (subs.length === 1) start(); return function () { subs = subs.filter(function (f) { return f !== fn; }); if (!subs.length) stop(); }; };
    rt.fire = emit;
    rt.session = function () { return sess; };
    rt.stream = null;
    rt.tasks = [];
    rt.queued = null;
    rt.pendingMsgs = function () { return 0; };
    rt.takeQueued = function () { return null; };
    rt.todo = function () { return sess.todo.items; };
    // 模型：真在用的是它最近一次回答记下的（message.model——不带 [1m]）；选过的 / 记录里 /model 设的 / 默认设置里的，底子一样就用那个（带 [1m] = 1M 上下文）。
    // 这边选了还没轮到的（下一句才用上）：pending
    var modelSel = modelMap()[sid] || "", modelCmd = "", selAt = modelSel ? 0 : Infinity;
    var baseOf = function (m) { return String(m || "").replace(/\[1m\]$/i, ""); };
    rt.model = function () {
      var real = agent.model || "", want = modelSel || modelCmd || CC.def || "", pending = !!modelSel && baseOf(modelSel) !== baseOf(real) && !!real;
      var id = pending ? modelSel : want && baseOf(want) === baseOf(real) ? want : real || want;
      if (id && !/\[1m\]$/i.test(id) && sess.ctx > 200000) id += "[1m]";
      return { id: id, name: pending ? tr(ccName(id) + " · 下一句起") : ccName(id), window: /\[1m\]$/i.test(id) ? 1e6 : 2e5, pending: pending };
    };
    // 可选的模型：Claude Code 的（带 [1m] 的是 1M 上下文那种，id 原样传给 --model）+ 默认设置里的 + 这段会话用过的
    rt.models = function () {
      var ids = CC.MODELS.slice(), more = CC.MORE.slice(), add = function (x) { if (x && ids.indexOf(x) < 0 && more.indexOf(x) < 0) more.unshift(x); };
      add(CC.def); add(agent.model); add(modelCmd); add(modelSel); // 默认设置里的、这段会话在用的：不在表里就放进「更多模型」
      var mk = function (id, m) { return { id: id, name: ccName(id), desc: id, ctx: /\[1m\]$/i.test(id) ? 1e6 : 2e5, more: !!m, def: !!CC.def && id === CC.def }; };
      return ids.map(function (id) { return mk(id, false); }).concat(more.map(function (id) { return mk(id, true); }));
    };
    // agent：这段会话的名字（tmd—01）、它用的 agent（--agent；换模型接着说时带上，不丢）
    rt.agentName = function () { return info.agentName || (info.live && info.live.name) || ""; };
    rt.state = function () { return busy ? "working" : "idle"; };
    rt.ctx = function () {
      var sl = CC.slCtx[sid]; // 它的状态行最近报过的（窗口大小、百分比都是 Claude Code 自己算的）：比这边从记录里估的准
      if (sl && sl.window) { var w0 = sl.window; return { tokens: Math.max(sess.ctx || 0, sl.tokens), window: w0, pct: sess.ctx && sess.updated > sl.at ? sess.ctx / w0 * 100 : sl.pct }; }
      var w = /\[1m\]/.test(agent.model) || sess.ctx > 200000 ? 1000000 : 200000; return { tokens: sess.ctx, window: w, pct: sess.ctx / w * 100 };
    };
    rt.home = rt.cwd = function () { return info.cwd || ""; };
    rt.cost = function () { return 0; };
    rt.tail = function () { return info.last || ""; };
    rt.maybeRecap = rt.recap = function () {};
    rt.record = function (cmd, result) { var t = { cmd: cmd, note: tr(result), at: Date.now(), local: true }; turns.push(t); emit("append", t); };
    ["setEffort", "setModel", "setAccess", "rename", "setGoal", "clearGoal", "clear", "resume", "bang", "detachBash", "stopTask", "wakeUp", "receive", "afterReload"].forEach(function (k) { rt[k] = function () { return false; }; });
    rt.turnOf = function (uuid) { return byUuid[uuid] || null; };
    rt.historical = function () { return !!win; };

    // ---- 读会话记录 ----
    var pendFire = null; // 定时任务到点那一行（scheduled_task_fire）：挂到它送进来的那一问上面
    var path = info.path || "", offset = 0, from = 0, win = null, pollT = 0, cur = null, lastCmd = null, lastCompact = null, lastBash = null, byTool = {}, byUuid = {}, loading = null;
    // 跟着读新写进来的，只能一格一格往后走：同一时间只有一次在读（上一次没回来，下一次等着）；重读（load）了，之前发出去还没回来的读作废（gen）；
    // 每条记录按它的 uuid 只认一次（seen）——哪儿读重了也不会多画一份
    var forkSpawn = {}; // 分出去的（fork）的记录开头抄进来的那一下 Agent 调用（开它的那一下）：它的 id，结果也不画
    var gen = 0, loadingNow = false, pollBusy = false, pollAgain = false, seen = new Set(), readOnce = false; // readOnce：记录读过一遍了（上次没送完的这时才接着送：先看记录里是不是已经有了）
    // 一段字节 → 完整的行：按字节找换行（一个字的几个字节被切在两次读里也不会读坏）；最后没写完的半行不要（offset 停在它前面，下次连着读）。
    // dropHead：不是从行首读起的，开头半行丢掉
    function linesOf(buf, dropHead) {
      var u8 = new Uint8Array(buf), a = 0;
      if (dropHead) { var i = u8.indexOf(10); a = i < 0 ? u8.length : i + 1; }
      var j = u8.lastIndexOf(10), end = j + 1 > a ? j + 1 : a;
      return { head: a, end: end, lines: end > a ? new TextDecoder().decode(u8.subarray(a, end)).split("\n") : [] };
    }
    function withPath() {
      if (!path && info.path) path = info.path; // 子 agent：建的时候还不知道它的记录在哪，后来补上的
      if (path) return Promise.resolve(path);
      return ccFindL().then(function (x) {
        if (!x) throw new Error(info.fresh ? "" : "找不到 Claude Code 会话：" + sid);
        var t0 = info.title && !messy(info.title) && !/^\//.test(info.title) ? info.title : ""; // 列表里清好的标题（ccFind 给的是原样的）
        Object.assign(info, x); path = x.path; if (t0) info.title = t0;
        sess.title = agent.name = t0 || (x.custom ? tidy(x.title) : cleanTitle(x.title)) || sess.title; agent.model = x.model || agent.model; sess.ctx = x.ctx || sess.ctx;
        // 标签页上的名字：原样是标记、或者只是命令的，读文件开头补准（同列表）
        if (!info.custom && (!t0 || /^\//.test(sess.title))) deepTitle(Object.assign({}, info, { path: x.path })).then(function (r) { if (r && r.t && (r.good || !sess.title || messy(sess.title)) && r.t !== sess.title) { sess.title = agent.name = r.t; emit("config"); emit("status"); } });
        if (info.fresh) { info.fresh = false; freshKeep(sid, null); }
        return path;
      });
    }
    // 这一轮（转圈那一行）：从它最近读进去的那句话（你说的、别的 agent 发来的、一轮中间被读进去的）算起的用时、写了多少 token；还排着没被读到的（queue）
    // taken：刚被它从队里拿走、记录里那一问 / 那条附件还没读到的几句——这段空档照样挂着（画成「在发」），不然先消失一下再出来（一轮中间读进去时尤其明显）
    var taken = [];
    var queue = [], turnAt = 0, tokById = {}, forkN = 0, qopAt = 0, shotPath = {}, sentShots = []; // shotPath / sentShots：这边送出去的图（编号 → 路径），排进队后找回来画 // qopAt：最近一次读到它的队有动静（queue-operation）
    // 打断后退回输入框的那几句（Claude Code 把它从这一问里撤回、放回输入框）：记录里还留着它（被换掉的那一支），重新载入时也不再画
    var RWK = "vs-rewound:" + sid, rewound = (function () { try { return new Set(JSON.parse(sessionStorage.getItem(RWK) || "[]")); } catch (e) { return new Set(); } })(); // forkN：换掉过一支（拿掉了已经画出来的几问）——这一次读到的要整段重画
    // ======== 子 agent、后台任务（rt.tasks：同 Paimon 的样子，面板、抽屉、状态栏都认）========
    // 一条：{ id（子 agent 的 agentId / 后台命令的 ID）, kind: "agent"|"shell", desc, prompt, cmd, type（子 agent 的种类：fork、general-purpose…）, background,
    //   status: "running"|"done"|"error"|"stopped", partial（到了轮数上限停下的）, t0, end, ms, tools, tokens（= tokensOut）, tokensIn, code（退出码）,
    //   result（子 agent 交回的报告）, error, summary（通知里那一句）, out（输出文件）, transcript（子 agent 自己的记录）, log: [{ text }]（最近几步）, toolUseId, resumedAt }
    // 从哪来：Agent / 后台 Bash 的调用和结果（agentId、后台命令 ID、输出文件）、后来的 <task-notification>（跑完、失败、停了、到上限；用量）、TaskStop、
    //   SendMessage 给停下来的子 agent（「Resuming agent …」：又跑起来了）。读进来的那段之前的：载入后用 grep 只挑相关的几行补上（只读）
    var taskById = {}, taskByTool = {}, noteSeen = new Set(), taskEvents = [], inOlder = false, preFrom = -1, taskDirty = false, goalSeen = false;
    // 前台跑的子 agent 跑完的那条结果（{ status: "completed", prompt, agentId, … }，正文末尾「agentId: … (use SendMessage …)」）也要：不然它一直「在跑」、拿不到 agentId（点不进去、看不到它再开的子 agent）
    var TASK_RE = /"name":"(Agent|Task|TaskStop|KillShell|KillBash)"|"run_in_background":true|<task-notification>|async_launched|backgroundTaskId|resumedAgentId|Resuming agent|"status":"completed","prompt"|agentId: \w+ \(/;
    function resetTasks() { rt.tasks.length = 0; taskById = {}; taskByTool = {}; noteSeen = new Set(); }
    function addTask(t) { rt.tasks.push(t); if (t.id) taskById[t.id] = t; if (t.toolUseId) taskByTool[t.toolUseId] = t; return t; }
    function newTask(o) { return addTask(Object.assign({ id: "", kind: "agent", desc: "", prompt: "", cmd: "", type: "", background: true, status: "running", partial: false, t0: 0, end: null, ms: 0, tools: 0, tokens: 0, tokensIn: 0, tokensOut: 0, code: null, result: "", error: "", summary: "", out: "", transcript: "", log: [], toolUseId: "", resumedAt: null }, o)); }
    var bashIn = {}; // 前台的命令（还没结果的）：超时转到后台时拿它的说明、命令
    // 子 agent 自己的记录：同 Claude Code 2.1.281（eh()）——一段会话的子 agent（子 agent 再开的子 agent 也一样）都在 <会话>/subagents/agent-<id>.jsonl，一层，不往下套；
    //   这一段本身就是子 agent 的记录（在 subagents/ 里）：它开的子 agent 和它在同一个目录
    function bindId(t, id) {
      if (id && !t.id) { t.id = id; taskById[id] = t; }
      if (t.kind === "agent" && t.id && path) t.transcript = (/\/subagents\//.test(path) ? path.replace(/\/[^/]*$/, "") : path.replace(/\.jsonl$/, "") + "/subagents") + "/agent-" + t.id + ".jsonl";
    }
    function taskLine(j) {
      var at = ts(j), m = j.message || {}, c = m.content, changed = false;
      if (j.type === "assistant" && Array.isArray(c)) c.forEach(function (b) {
        if (!b || b.type !== "tool_use") return;
        var inp = b.input || {};
        if ((b.name === "Agent" || b.name === "Task") && !taskByTool[b.id]) { newTask({ kind: "agent", desc: inp.description || String(inp.prompt || "").split("\n")[0].slice(0, 80), prompt: String(inp.prompt || ""), type: inp.subagent_type || "general-purpose", background: !!inp.run_in_background || inp.subagent_type === "fork", t0: at, toolUseId: b.id }); changed = true; }
        else if (b.name === "Bash" && inp.run_in_background && !taskByTool[b.id]) { newTask({ kind: "shell", desc: inp.description || String(inp.command || "").split("\n")[0], cmd: String(inp.command || ""), t0: at, toolUseId: b.id }); changed = true; }
        else if (b.name === "Bash" && !taskByTool[b.id]) { bashIn[b.id] = { desc: String(inp.description || String(inp.command || "").split("\n")[0]).slice(0, 200), cmd: String(inp.command || "").slice(0, 2000), at: at }; var bk = Object.keys(bashIn); if (bk.length > 400) delete bashIn[bk[0]]; }
        else if (/^(TaskStop|KillShell|KillBash)$/.test(b.name)) { var st = taskById[inp.task_id || inp.shell_id || inp.bash_id]; if (st && st.status === "running") { st.status = "stopped"; st.end = at; st.ms = at - (st.resumedAt || st.t0); changed = true; } }
      });
      if (j.type === "user" && Array.isArray(c)) c.forEach(function (b) {
        if (!b || b.type !== "tool_result") return;
        var t = taskByTool[b.tool_use_id], r = j.toolUseResult && typeof j.toolUseResult === "object" ? j.toolUseResult : {}, txt = typeof b.content === "string" ? b.content : (Array.isArray(b.content) ? b.content : []).map(function (x) { return x && x.text || ""; }).join("\n");
        // 前台跑的命令超时、或者按了 ctrl+b：转到后台接着跑（同 Claude Code 底下的「N shells」也算它）
        //   （以前要先在 bashIn 里记着这条命令才认——可前台命令那一行不一定过这里（只挑跟任务有关的行），按了 ctrl+b 转到后台的就不出现在右侧栏的「后台任务」里）
        var bgId = !t ? r.backgroundTaskId || (/moved to the background \(ID: (\w+)\)|backgrounded[^\n]*?with ID: (\w+)/.exec(txt) || []).slice(1).filter(Boolean)[0] : "";
        if (bgId) {
          var tp0 = byTool[b.tool_use_id], ti0 = (tp0 && tp0.input) || {}, bi0 = bashIn[b.tool_use_id] || { desc: String(ti0.description || String(ti0.command || "").split("\n")[0]).slice(0, 200), cmd: String(ti0.command || "").slice(0, 2000), at: (tp0 && tp0.t0) || at };
          delete bashIn[b.tool_use_id];
          t = newTask({ kind: "shell", desc: bi0.desc, cmd: bi0.cmd, t0: bi0.at, toolUseId: b.tool_use_id }); bindId(t, bgId);
        }
        else if (bashIn[b.tool_use_id]) delete bashIn[b.tool_use_id];
        if (t && t.kind === "agent") {
          bindId(t, r.agentId || (/agentId: (\w+)/.exec(txt) || [])[1]);
          if (r.isAsync || /Async agent launched/.test(txt)) t.background = true; // 在后台跑的（ctrl+b 放到后台的也是这样回）：算后台 Agent（结尾那行「Waiting for … to finish」）
          if (!(r.isAsync || /Async agent launched/.test(txt))) { t.status = b.is_error ? "error" : "done"; t.end = at; t.ms = r.totalDurationMs || at - t.t0; t.result = txt.slice(0, 20000); if (r.totalTokens) t.tokens = t.tokensOut = r.totalTokens; if (r.totalToolUseCount) t.tools = r.totalToolUseCount; if (b.is_error) t.error = txt.slice(0, 300); }
          changed = true;
        } else if (t && t.kind === "shell") {
          bindId(t, r.backgroundTaskId || (/with ID: (\w+)/.exec(txt) || [])[1]);
          var of = /written to: (\S+?\.output)/.exec(txt);
          if (of) t.out = of[1];
          if (b.is_error) { t.status = "error"; t.error = txt.slice(0, 300); t.end = at; }
          // 没拿到后台 ID（「Working directory … was deleted」这种）：它根本没在后台跑起来——不是一直「在跑」（83 小时还在转、点不开的那种）
          else if (!t.id && t.status === "running" && !/running in (the )?background|in the background/i.test(txt)) { t.status = "error"; t.error = txt.split("\n")[0].slice(0, 300); t.end = at; t.ms = at - (t.t0 || at); }
          changed = true;
        }
        var rid = r.resumedAgentId || (/Resuming agent (\w+)/.exec(txt) || [])[1];
        if (rid) { var ra = taskById[rid] || rt.tasks.filter(function (x) { return x.id && x.id.indexOf(rid) === 0; })[0]; if (ra && ra.status !== "running") { ra.status = "running"; ra.resumedAt = at; ra.end = null; ra.partial = false; changed = true; } }
      });
      // 跑完 / 停下的通知：排队进来的（queue-operation）、一轮中间读进去的（附件）、闲着时收到的（用户消息）都有同一条——只认一次
      var raw = j.type === "queue-operation" ? j.content : j.type === "attachment" && j.attachment ? j.attachment.prompt : j.type === "user" && typeof c === "string" ? c : null;
      if (typeof raw === "string" && raw.indexOf("<task-notification>") >= 0) {
        var re = /<task-notification>([\s\S]*?)<\/task-notification>/g, mm;
        while ((mm = re.exec(raw))) { if (noteSeen.has(mm[1])) continue; noteSeen.add(mm[1]); if (applyNote(mm[1], at)) changed = true; }
      }
      return changed;
    }
    function applyNote(x, at) {
      var g = function (k) { var r0 = new RegExp("<" + k + ">([\\s\\S]*?)</" + k + ">").exec(x); return r0 ? r0[1].trim() : ""; };
      var id = g("task-id");
      if (!id) return false;
      var summary = g("summary").replace(/\\"/g, "\""), status = g("status"), usage = g("usage"), t = taskById[id] || taskByTool[g("tool-use-id")];
      if (!t) t = newTask({ kind: /^Agent /.test(summary) ? "agent" : "shell", desc: (/"([^"]*)"/.exec(summary) || [])[1] || id, toolUseId: g("tool-use-id") }); // 开始得比读到的还早：从通知里补一条
      bindId(t, id);
      t.summary = summary; t.out = g("output-file") || t.out;
      var code = /exit code (-?\d+)/.exec(summary);
      if (code) t.code = +code[1];
      t.partial = /turn limit/.test(summary);
      t.status = /was stopped|killed/i.test(summary) || status === "killed" || (status === "failed" && (t.code === 143 || t.code === 144 || t.code === 137)) ? "stopped" : status === "failed" ? "error" : "done";
      t.error = t.status === "error" ? summary : "";
      t.end = at;
      var du = /<duration_ms>(\d+)</.exec(usage), tk = /<subagent_tokens>(\d+)</.exec(usage), tu = /<tool_uses>(\d+)</.exec(usage);
      t.ms = du ? +du[1] : t.t0 ? at - (t.resumedAt || t.t0) : 0;
      if (tk) t.tokens = t.tokensOut = +tk[1];
      if (tu) t.tools = +tu[1];
      var res = g("result");
      if (res) t.result = res.slice(0, 20000);
      return true;
    }
    // 对话里的一条通知（同 Paimon 的 notices）：{ kind: "agent"|"shell", id, desc, type（子 agent 的种类）, status, partial, code, summary, result（报告）, ms, tokens, tools, error }
    function noteItems(raw) {
      var re = /<task-notification>([\s\S]*?)<\/task-notification>/g, mm, out = [];
      while ((mm = re.exec(raw))) {
        var x = mm[1], g = function (k) { var r0 = new RegExp("<" + k + ">([\\s\\S]*?)</" + k + ">").exec(x); return r0 ? r0[1].trim() : ""; };
        var id = g("task-id"), summary = g("summary").replace(/\\"/g, "\""), status = g("status"), usage = g("usage"), t = taskById[id] || taskByTool[g("tool-use-id")] || {};
        var code = /exit code (-?\d+)/.exec(summary), du = /<duration_ms>(\d+)</.exec(usage), tk = /<subagent_tokens>(\d+)</.exec(usage), tu = /<tool_uses>(\d+)</.exec(usage);
        var st = /was stopped|killed/i.test(summary) || status === "killed" ? "stopped" : status === "failed" ? "error" : "done";
        out.push({ kind: /^Agent /.test(summary) ? "agent" : /^Background /.test(summary) ? "shell" : t.kind || "shell", id: id, desc: (/"([^"]*)"/.exec(summary) || [])[1] || t.desc || id, type: t.type || "",
          status: st, partial: /turn limit/.test(summary), code: code ? +code[1] : null, summary: summary, result: (g("result") || "").slice(0, 20000), error: st === "error" ? summary : "", outFile: g("output-file"),
          ms: du ? +du[1] : t.ms || 0, tokens: tk ? +tk[1] : t.tokens || 0, tools: tu ? +tu[1] : t.tools || 0 });
      }
      return out;
    }
    // 读进来的那段之前的任务（会话很长时，开始得早、还在跑的：开发服务器、早就派出去的子 agent）：grep 只挑相关的几行（只读），先放它们，再放读进来的这段里的
    function prescan() {
      if (!path || !LOC.exec || !(from > 0) || preFrom === from) return;
      preFrom = from;
      var g = gen, q = function (s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; };
      // 用系统自带的 perl 挑（几百 MB 几秒；BSD grep 多个 -F 碰上很长的行要慢十几倍）；出队（remove）、附件是同一条通知的另外几份，不要
      var pick = '/usr/bin/perl -ne \'print if /"name":"(?:Agent|Task|TaskStop|KillShell|KillBash)"|"run_in_background":true|<task-notification>|async_launched|backgroundTaskId|resumedAgentId|Resuming agent|"status":"completed","prompt"|agentId: \\w+ \\(|"is_error":true/ && !/"operation":"remove"|"type":"attachment"/\'';
      LOC.exec({ cmd: "head -c " + from + " " + q(path) + " | " + pick }).then(function (r) {
        if (g !== gen) return;
        var evs = String(r && r.out || "").split("\n").map(function (l) { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
        resetTasks();
        evs.concat(taskEvents).forEach(taskLine);
        emit("tasks"); emit("status");
      }, function () {});
      // /goal：读进来的那段（最后 3MB）里没有它的记录时，目标还可能是更早定的（一轮跑几个小时，上一次 goal_status 在几 MB 之前）——
      //   同样只挑相关的几行：goal_status 附件、/goal 命令，按先后走一遍，最后还没达成、没清掉的就是现在的目标（用时从定下它那一刻算：同 Claude Code 的「/goal active (7h)」）
      var gpick = '/usr/bin/perl -ne \'print if /"type":"goal_status"|<command-name>\\/goal<\\/command-name>/\'';
      LOC.exec({ cmd: "head -c " + from + " " + q(path) + " | " + gpick + " | tail -n 400" }).then(function (r) {
        if (g !== gen) return;
        var goal = null;
        String(r && r.out || "").split("\n").forEach(function (l) {
          var j; try { j = JSON.parse(l); } catch (e) { return; }
          if (j.type === "attachment" && j.attachment && j.attachment.type === "goal_status") {
            var gs = j.attachment;
            if (goalEnded(gs)) goal = null; else if (gs.condition) goal = { text: String(gs.condition), at: goal && goal.text === String(gs.condition) ? goal.at : ts(j), checking: false, iterations: 0 };
            return;
          }
          var c = j.message && j.message.content, text = typeof c === "string" ? c : Array.isArray(c) ? c.map(function (b) { return b && b.type === "text" ? b.text : ""; }).join("") : "";
          var ca = /<command-args>([^<]*)<\/command-args>/.exec(text), arg = ca ? ca[1].trim() : "";
          if (/^(clear|off|stop|cancel)\b/i.test(arg)) goal = null; else if (arg && !(goal && goal.text === arg)) goal = { text: arg, at: ts(j), checking: false, iterations: 0 };
        });
        if (!goal) return;
        if (!goalSeen) { agent.goal = goal; emit("config"); } // 读进来的那段里没提过目标：就是更早定的这个
        else if (agent.goal && agent.goal.text === goal.text && goal.at < agent.goal.at) { agent.goal.at = goal.at; emit("config"); } // 同一个目标一直在：从最早定下它那时算起
      }, function () {});
    }
    // 在跑的子 agent：它自己的记录最后一段（只读，最多 24KB）里最近几步；后台命令：输出文件最后一段
    var tailAt = 0;
    function tailOf(file, max) { return LOC.stat(file).then(function (st) { if (!st) return ""; var n = Math.min(st.size, max); return LOC.read(file, { offset: st.size - n, max: n }).then(function (b) { return new TextDecoder().decode(new Uint8Array(b)); }); }).catch(function () { return ""; }); }
    function stepsOf(text, n) {
      var out = [];
      text.split("\n").forEach(function (l) {
        var j; try { j = JSON.parse(l); } catch (e) { return; }
        var c = j && j.type === "assistant" && j.message && Array.isArray(j.message.content) ? j.message.content : [];
        c.forEach(function (b) {
          if (b.type === "text" && b.text && b.text.trim()) out.push({ text: b.text.trim().split("\n")[0].slice(0, 200), at: ts(j) });
          else if (b.type === "tool_use") { var i0 = b.input || {}; out.push({ text: b.name + (i0.description ? " · " + i0.description : i0.command ? " · " + String(i0.command).split("\n")[0] : i0.file_path ? " · " + String(i0.file_path).split("/").pop() : ""), at: ts(j), tool: b.name }); }
        });
      });
      return out.slice(-n);
    }
    // 在跑的子 agent 这一行（同 Claude Code 的 agents 面板）：在干嘛 = 它最近一次工具调用的说明（同 Claude Code 各个工具的 getActivityDescription：
    //   Reading x.ts、Editing x.ts、Searching for …；命令写的说明是祈使句的换成「-ing」：Check x → Checking x，别的是「Running <说明>」）；
    //   token = 最近一次回答的输入（含缓存）+ 一路累加的输出（同它的 getTokenCountFromTracker）。它的记录只往后追加：接着上次读到的地方读新写的（第一次最多读最后 4MB）
    var ING = ("add analyze analyse apply audit build bump calculate capture check clean clear clone collect commit compare compile compute configure confirm convert copy count create debug decode delete deploy describe detect diff disable download " +
      "dump edit enable encode ensure examine execute expand export extract fetch filter find fix format gather generate grab grep identify import inspect install investigate kill launch lint list load locate look make map measure merge migrate " +
      "move open pack parse patch peek pick ping poll prepare preview print probe profile prune publish pull push query read rebuild record refresh reload remove rename render replace report reproduce request rerun reset resolve restart " +
      "restore retry review rewrite run sample save scan search send set show simulate skim snapshot sort split stage start stop strip summarize swap switch sync tail take test time trace track trigger trim try unpack unzip update upload " +
      "use validate verify view wait watch wrap write zip").split(" ");
    var DBL = { run: 1, stop: 1, get: 1, set: 1, put: 1, cut: 1, plan: 1, log: 1, grep: 1, ship: 1, drop: 1, map: 1, skip: 1, strip: 1, swap: 1, trim: 1, wrap: 1, zip: 1, dig: 1, grab: 1, begin: 1, rerun: 1, unzip: 1 };
    function ingOf(v) { var w = v.toLowerCase(); return DBL[w] ? v + v.slice(-1) + "ing" : /ie$/.test(w) ? v.slice(0, -2) + "ying" : /[^eoy]e$/.test(w) ? v.slice(0, -1) + "ing" : v + "ing"; }
    var baseName = function (p) { var s0 = String(p || ""); return s0.split("/").filter(Boolean).pop() || s0; };
    var clip1 = function (s0, n) { s0 = String(s0 || "").split("\n")[0].trim(); return s0.length > n ? s0.slice(0, n - 1) + "…" : s0; };
    function actDesc(name, i) {
      i = i || {};
      if (name === "Bash") {
        var d = String(i.description || "").trim(), m0 = /^([A-Za-z]+)(\b[\s\S]*)$/.exec(d);
        if (d && m0 && ING.indexOf(m0[1].toLowerCase()) >= 0) { var g = ingOf(m0[1]); return g.charAt(0).toUpperCase() + g.slice(1) + m0[2]; }
        return i.command ? "Running " + (d || clip1(i.command, 60)) : "Running command";
      }
      if (name === "Read") return i.file_path ? "Reading " + baseName(i.file_path) : "Reading file";
      if (name === "Edit" || name === "MultiEdit") return i.file_path ? "Editing " + baseName(i.file_path) : "Editing file";
      if (name === "Write") return i.file_path ? "Writing " + baseName(i.file_path) : "Writing file";
      if (name === "NotebookEdit") return i.notebook_path ? "Editing " + baseName(i.notebook_path) : "Editing notebook";
      if (name === "Grep") return i.pattern ? "Searching for " + clip1(i.pattern, 40) : "Searching";
      if (name === "Glob") return i.pattern ? "Finding " + clip1(i.pattern, 40) : "Finding files";
      if (name === "WebFetch") return i.url ? "Fetching " + clip1(String(i.url).replace(/^https?:\/\//, ""), 50) : "Fetching web page";
      if (name === "WebSearch") return i.query ? "Searching for " + clip1(i.query, 40) : "Searching the web";
      if (name === "Agent" || name === "Task") return i.description || "Running task";
      if (/^(TaskCreate|TaskUpdate|TaskList|TaskGet|TodoWrite)$/.test(name)) return "Updating tasks";
      if (name === "Skill") return "Using " + (i.skill || i.name || "skill");
      return name ? "Using " + String(name).replace(/^mcp__[^_]+__/, "") : "";
    }
    function agentProg(t) {
      var f = t.transcript;
      if (!f || t._pBusy || Date.now() - (t._pAt || 0) < 2000) return; // 每条最多两秒看一次（它每一步都写记录，两秒够跟上）
      t._pBusy = true; t._pAt = Date.now();
      LOC.stat(f).then(function (st) {
        if (!st) return;
        var at0 = t._pOff || 0, drop = at0 > 0;
        if (st.size < at0) { at0 = 0; t._pOut = 0; drop = false; }
        if (st.size - at0 > (4 << 20)) { at0 = st.size - (4 << 20); drop = true; }
        if (st.size <= at0) return;
        return LOC.read(f, { offset: at0, max: st.size - at0 }).then(function (buf) {
          var u8 = new Uint8Array(buf), a = 0;
          if (drop && at0 !== t._pOff) { var i0 = u8.indexOf(10); a = i0 < 0 ? u8.length : i0 + 1; }
          var j0 = u8.lastIndexOf(10), end = j0 + 1 > a ? j0 + 1 : a, ch = false;
          t._pOff = at0 + end;
          new TextDecoder().decode(u8.subarray(a, end)).split("\n").forEach(function (l) {
            if (l.indexOf('"assistant"') < 0) return;
            var j; try { j = JSON.parse(l); } catch (e) { return; }
            if (!j || j.type !== "assistant" || !j.message) return;
            var u = j.message.usage;
            if (u) { t.tokIn = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0); t._pOut = (t._pOut || 0) + (u.output_tokens || 0); ch = true; }
            (Array.isArray(j.message.content) ? j.message.content : []).forEach(function (b) { if (b && b.type === "tool_use") { var d = actDesc(b.name, b.input); if (d && d !== t.activity) { t.activity = d; ch = true; } } });
          });
          if (ch) { t.tokLive = (t.tokIn || 0) + (t._pOut || 0); emit("tasks"); }
        });
      }).catch(function () {}).then(function () { t._pBusy = false; });
    }
    // 前台跑着的子 agent：结果回来之前记录里没有它的 agentId——Claude Code 一开它就写的 agent-<id>.meta.json 里记着开它的那次调用（toolUseId），
    //   按这个认出来（认出来才点得进去、看得到它再开的子 agent）。只在有这样的子 agent 时看，3 秒最多一次，只读
    var metaAt = 0, metaBusy = false;
    function metaLink() {
      var want = rt.tasks.filter(function (t) { return t.kind === "agent" && !t.id && t.status === "running" && t.toolUseId; });
      if (!want.length || metaBusy || !path || !LOC.exec || Date.now() - metaAt < 3000) return;
      metaAt = Date.now(); metaBusy = true;
      var dir = /\/subagents\//.test(path) ? path.replace(/\/[^/]*$/, "") : path.replace(/\.jsonl$/, "") + "/subagents";
      LOC.exec({ cmd: "cd '" + dir.replace(/'/g, "'\\''") + "' 2>/dev/null && grep -Ho '\"toolUseId\": *\"[^\"]*\"' -- *.meta.json 2>/dev/null" }).then(function (r) {
        metaBusy = false;
        var by = {}, ch = false;
        String(r && r.out || "").split("\n").forEach(function (l) { var m = /^agent-([\w-]+)\.meta\.json:"toolUseId": *"([^"]+)"/.exec(l); if (m) by[m[2]] = m[1]; });
        want.forEach(function (t) { var id = by[t.toolUseId]; if (id && !t.id && !taskById[id]) { bindId(t, id); ch = true; } });
        if (ch) emit("tasks");
      }, function () { metaBusy = false; });
    }
    function refreshTaskLogs() {
      rt.tasks.forEach(function (t) { if (t.kind === "agent" && t.transcript && t.status === "running") agentProg(t); }); // 跑完的用它通知里的 token 数，不再去读
      metaLink();
      if (Date.now() - tailAt < 8000) return;
      tailAt = Date.now();
      rt.tasks.filter(function (t) { return t.status === "running" && (t.kind === "agent" ? t.transcript : t.out); }).slice(0, 12).forEach(function (t) {
        tailOf(t.kind === "agent" ? t.transcript : t.out, t.kind === "agent" ? 24 << 10 : 4 << 10).then(function (s) {
          var lg = t.kind === "agent" ? stepsOf(s, 3) : s.replace(/\r/g, "").split("\n").filter(function (l) { return l.trim(); }).slice(-3).map(function (l) { return { text: l.slice(0, 200) }; });
          if (JSON.stringify(lg) !== JSON.stringify(t.log)) { t.log = lg; emit("tasks"); }
        });
      });
    }
    // 点开一条：子 agent 的任务说明、状态、最近的几步、交回的报告；后台命令的命令、状态、退出码、输出的最后一段（都是只读）。
    // 什么都读不到时 why 说为什么（没记下输出文件、文件不在了、读不了），不是一句「还没有输出」
    function tailRead(file, max) {
      return LOC.stat(file).then(function (st) {
        if (!st) return { missing: true };
        var n = Math.min(st.size, max);
        if (!n) return { text: "", size: 0 };
        return LOC.read(file, { offset: st.size - n, max: n }).then(function (b) { return { text: new TextDecoder().decode(new Uint8Array(b)), size: st.size, cut: st.size > n }; });
      }).catch(function (e) { return { err: String(e && e.message || e) }; });
    }
    // 记录里没写输出文件的后台命令：按 Claude Code 放的地方猜（/private/tmp/claude-<uid>/<项目>/<会话>/tasks/<id>.output；同一会话别的任务记下的目录优先）
    var uidP = null;
    function guessOut(t) {
      if (!t.id || !path) return Promise.resolve("");
      var other = rt.tasks.filter(function (x) { return x.out && /\/tasks\/[^\/]+\.output$/.test(x.out); })[0];
      if (other) return Promise.resolve(other.out.replace(/[^\/]+\.output$/, t.id + ".output"));
      uidP = uidP || LOC.exec({ cmd: "id -u" }).then(function (r) { return String(r && r.out || "").trim(); }, function () { return ""; });
      return uidP.then(function (uid) { return /^\d+$/.test(uid) ? "/private/tmp/claude-" + uid + "/" + path.split("/").slice(-2)[0] + "/" + sid + "/tasks/" + t.id + ".output" : ""; });
    }
    rt.taskDetail = function (id) {
      var t = taskById[id] || taskByTool[id];
      if (!t) return Promise.resolve(null);
      var base = { id: t.id, kind: t.kind, desc: t.desc, type: t.type, status: t.status, partial: t.partial, t0: t.t0, end: t.end, ms: t.ms, tools: t.tools, tokens: t.tokens, code: t.code, summary: t.summary, prompt: t.prompt, cmd: t.cmd, result: t.result, error: t.error, transcript: t.transcript, out: t.out, why: "" };
      if (t.kind === "agent") {
        base.last = [];
        if (!t.transcript) { if (!t.result) base.why = "没有记下它自己的记录"; return Promise.resolve(base); }
        return tailRead(t.transcript, 96 << 10).then(function (r) {
          base.last = r.text ? stepsOf(r.text, 12) : [];
          if (!base.last.length && !t.result) base.why = r.missing ? "找不到它自己的记录：" + t.transcript : r.err ? "读不了它自己的记录：" + r.err : t.status === "running" ? "还没有输出" : "没有输出";
          return base;
        });
      }
      base.output = [];
      return (t.out ? Promise.resolve(t.out) : guessOut(t)).then(function (f) {
        if (!f) { base.why = "没有记下输出文件"; return base; }
        base.out = f;
        return tailRead(f, 16 << 10).then(function (r) {
          var ls = r.text ? r.text.replace(/\r/g, "").split("\n") : [];
          if (r.cut) ls.shift(); // 从中间读起的：头一行是半截
          while (ls.length && !ls[ls.length - 1].trim()) ls.pop();
          base.output = ls.slice(-200); base.size = r.size || 0;
          base.why = r.missing ? (t.out ? "找不到输出文件：" : "没有记下输出文件，也不在：") + f : r.err ? "读不了输出文件：" + r.err : ls.length ? "" : t.status === "running" ? "还没有输出" : "没有输出";
          return base;
        });
      });
    };
    function newRound(t) { turnAt = t; tokById = {}; if (rt.stream) { rt.stream.t0 = t; rt.stream.outTokens = 0; } }
    function outTok() { var n = 0; for (var k in tokById) n += tokById[k]; return n; }
    function syncStream() { if (!rt.stream) return; if (turnAt) rt.stream.t0 = turnAt; rt.stream.outTokens = outTok(); }
    // 新会话（TSU_CONNECTORS.newSession）：说第一句之前没有记录文件；说了以后等它写出来再接着读
    var findAt = 0, said = false;
    function findFresh() {
      if (path || !info.fresh || Date.now() - findAt < 1200) return;
      findAt = Date.now();
      withPath().then(function () { offset = 0; from = 0; poll(); if (pollT) tailOn(); emit("config"); }, function () {});
    }
    // 从 at 开始读到文件尾（最多 WINDOW；读不到尾就是历史上的一段，不再跟着读新追加的）。整个重来：之前读到的全不要，从这一段重新建
    function load(at) {
      var g = ++gen;
      loadingNow = true;
      loading = withPath().then(function (p) { return LOC.stat(p); }).then(function (st) {
        if (g !== gen) return;
        if (!st) throw new Error("会话记录不存在");
        // 默认读最后 TAIL；前面剩下的不多（< 2MB）就干脆全读，不留一句「还有多少没载入」
        var size = st.size, start = at === undefined ? (size > TAIL + (2 << 20) ? size - TAIL : 0) : Math.max(0, at);
        var n = Math.min(size - start, WINDOW);
        return LOC.read(path, { offset: start, max: n }).then(function (buf) {
          if (g !== gen) return; // 这期间又重读了：这一份作废
          turns.length = 0; cur = null; lastCmd = null; lastCompact = null; lastBash = null; byTool = {}; byUuid = {}; seen = new Set(); forkSpawn = {}; queue = []; taken = []; turnAt = 0; tokById = {};
          resetTasks(); taskEvents = []; preFrom = -1; goalSeen = false;
          // 没从头读的：头一行是半截，丢掉（往前接着读时从它开头接上）。更早的不显示提示——滚到顶自动接着往前读（同终端的回滚，一直往上翻都有）
          var r = linesOf(buf, start > 0);
          win = start + buf.byteLength < size ? { from: start, to: start + r.end } : null; // 没读到尾（看的是历史上的一段）：滚到底自动接着往后读
          r.lines.forEach(feedLine);
          finishTurn();
          from = start + r.head;
          offset = start + r.end;
          if (pollT) tailOn(); // iPad：从这里起 Mac 把新写的推过来
          sess.updated = st.mtime;
          syncStream();
          emit("reset");
          emit("status");
          emit("tasks");
          prescan();
        });
      }).catch(function (e) { if (g !== gen) return; turns.length = 0; if (!info.fresh) turns.push({ note: tr("无法读取会话：" + e.message), at: 0 }); emit("reset"); })
        .then(function () { if (g === gen) { loadingNow = false; readOnce = true; if (lq.length) flushSoon(); } });
      // 刚打开 App / 重新载入的头几秒读的：界面等这些读完（最多 2.5 秒，live.js 的 bootShow）再露出来——不先露出一块黑的、标签页上一串 ID
      if (performance.now() < 8000) (window.TSU_CC_BOOT = window.TSU_CC_BOOT || []).push(loading);
      return loading;
    }
    // 新读到的几整行接到后面（自己读到的、Mac 推过来的都走这里）
    function ingest(r, mtime) {
      offset += r.end;
      var before = turns.length, touched = new Set(), fk0 = forkN;
      r.lines.forEach(function (l) { var t = feedLine(l); if (t) touched.add(t); });
      if (mtime) sess.updated = mtime;
      syncStream();
      if (taskDirty) { taskDirty = false; emit("tasks"); }
      if (forkN !== fk0) { emit("reset"); emit("status"); return; } // 拿掉了已经画出来的几问：整段重画
      turns.slice(before).forEach(function (t) { touched.delete(t); emit("append", t); });
      touched.forEach(function (t) { emit("turn", t); });
      emit("status");
    }
    function poll() {
      if (!path && info.fresh && said) return findFresh();
      if (win || !path || loadingNow) return;
      if (pollBusy) { pollAgain = true; return; } // 上一次还没读回来：等它完了再读（两次同时从同一个位置读，同一段就会接上两遍）
      pollBusy = true;
      var g = gen;
      LOC.stat(path).then(function (st) {
        if (g !== gen || !st) return;
        if (st.size < offset) return load(); // 文件变短了（被改写了）：从头重建，不在后面接
        if (st.size <= offset) return;
        var o0 = offset;
        return LOC.read(path, { offset: offset, max: Math.min(st.size - offset, WINDOW) }).then(function (buf) {
          if (g !== gen || offset !== o0) return; // 这期间 Mac 推过来的已经接上了（iPad）：这一份不要
          var r = linesOf(buf, false);
          if (!r.end) { if (buf.byteLength >= WINDOW) offset += buf.byteLength; return; } // 最后一行还没写完：下次连着它一起读（一行比 WINDOW 还长的：跳过）
          ingest(r, st.mtime);
        });
      }).catch(function () {}).then(function () { pollBusy = false; seenAt = Date.now(); if (pollAgain) { pollAgain = false; setTimeout(poll, 0); } });
    }
    // iPad（经中转用 Mac）：Mac 那边盯着这份记录，长了就把新写的整行推过来（LOC.tail）——到了马上接上，不等下一次自己去问；
    //   自己读（poll）退成每 4 秒一次兜底。本机（Mac）上 LOC.tail 是空的：照旧 0.7 秒读一次
    var tailSub = null, tickN0 = 0;
    function tailOn() {
      if (!LOC.tail || !path || win) { tailOff(); return; }
      if (tailSub) { tailSub.rewatch(); return; } // 重新载入过（位置变了）：让那边从现在的位置接着盯
      tailSub = LOC.tail(path, function () { return offset; }, function (at, buf, d) {
        if (!tailSub || win || loadingNow) return;
        if (at < 0) return load(); // 文件变短了（被改写）
        if (at !== offset || pollBusy) { if (at > offset) poll(); return; } // 接不上（中间漏了一段）：自己读；重复的、自己正在读的：不要
        var r = linesOf(buf, false);
        if (r.end) ingest(r, d && d.mtime);
      });
    }
    function tailOff() { if (tailSub) { tailSub.stop(); tailSub = null; } }
    function start() { if (!loading) load(); clearInterval(pollT); pollT = setInterval(function () { if (!tailSub || !tailSub.live() || ++tickN0 % 6 === 0) poll(); if (Date.now() - liveAt > 3000) refreshLive(); refreshTaskLogs(); checkUnc(); }, 700); }
    function stop() { clearInterval(pollT); pollT = 0; tailOff(); }
    rt.reveal = function (uuid, offset0) { // 搜到的那句：载入的范围里没有就从它前面一点重新读
      if (byUuid[uuid]) return Promise.resolve(byUuid[uuid]);
      return load(Math.max(0, (offset0 || 0) - (256 << 10))).then(function () { return byUuid[uuid] || null; });
    };
    rt.latest = function () { win = null; return load(); };
    // 滚到顶：往前再读一段，接在前面（没有「较早的对话未加载」这种提示——同终端往上翻）
    var moreBusy = false;
    rt.more = function () { return from > 0; };
    var perf = [];
    rt.perf = function () { return perf.slice(); };
    rt.earlier = function () {
      if (!(from > 0) || moreBusy || !path || loadingNow) return Promise.resolve(false);
      moreBusy = true;
      var s0 = Math.max(0, from - TAIL), g = gen, pf = { at: Date.now(), bytes: from - s0 }, tq = performance.now(); // pf：往前读一段各步用了多久（rt.perf，滚动测试看瓶颈在哪）
      return LOC.read(path, { offset: s0, max: from - s0 }).then(function (buf) {
        if (g !== gen) { moreBusy = false; return false; } // 这期间重读了：这一段接不上了
        var t1 = performance.now(); pf.read = Math.round(t1 - tq);
        var r = linesOf(buf, s0 > 0), lines = r.lines, head = r.head; // 读到 from 为止，正好是一行的结尾
        var t2 = performance.now(); pf.decode = Math.round(t2 - t1); pf.lines = lines.length;
        // 用一份新的状态读这一段；会话现在的标题、任务清单、模型、上下文不能被旧的盖掉
        var keep = { turns: turns, cur: cur, lastCmd: lastCmd, lastCompact: lastCompact, lastBash: lastBash, byTool: byTool, title: sess.title, name: agent.name, todo: sess.todo.items, model: agent.model, ctx: sess.ctx, queue: queue, turnAt: turnAt, tokById: tokById, agentName: info.agentName, agentSetting: info.agentSetting, modelCmd: modelCmd };
        turns = []; cur = null; lastCmd = null; lastCompact = null; lastBash = null; byTool = {}; queue = []; tokById = {}; pendFire = null;
        inOlder = true; lines.forEach(feedLine); inOlder = false; // 更早的这段里的任务：载入时已经从前面补过了（prescan），不再算一遍
        finishTurn();
        var older = turns;
        turns = keep.turns; cur = keep.cur; lastCmd = keep.lastCmd; lastCompact = keep.lastCompact; lastBash = keep.lastBash; byTool = keep.byTool;
        queue = keep.queue; turnAt = keep.turnAt; tokById = keep.tokById; modelCmd = keep.modelCmd; if (keep.agentName) info.agentName = keep.agentName; if (keep.agentSetting) info.agentSetting = keep.agentSetting; // 更早那段里的不算现在的
        sess.title = keep.title; agent.name = keep.name; sess.todo.items = keep.todo; agent.model = keep.model; sess.ctx = keep.ctx;
        // 旧的那段里调了、结果在后面那段的工具：早就做完了
        older.forEach(function (t) { (t.parts || []).forEach(function (p) { if (p.kind === "tool" && p.status === "running") p.status = "done"; }); });
        // 已经载入的第一问是接着旧的最后一问的（它的问题在旧的那段里）：并成一问
        var first = turns[0], last = older[older.length - 1];
        if (first && first.cont && last && last.parts && last.ask !== undefined) {
          first.parts.forEach(function (p) { p.turn = last; last.parts.push(p); });
          ["last", "error", "thinking", "thought"].forEach(function (k) { if (first[k] !== undefined) last[k] = first[k]; });
          if (first.stats) last.stats = { secs: Math.max(1, Math.round(((first.last || first.at) - last.at) / 1000)), verb: first.stats.verb || "Worked", at: first.stats.at };
          Object.keys(byUuid).forEach(function (u) { if (byUuid[u] === first) byUuid[u] = last; });
          if (cur === first) cur = last;
          turns.shift();
        }
        Array.prototype.unshift.apply(turns, older);
        from = s0 + head;
        moreBusy = false;
        var t3 = performance.now(); pf.parse = Math.round(t3 - t2); pf.turns = older.length;
        emit("prepend");
        pf.render = Math.round(performance.now() - t3); pf.total = Math.round(performance.now() - tq);
        perf.push(pf); if (perf.length > 30) perf.shift();
        return true;
      }, function () { moreBusy = false; return false; });
    };
    // 看的是历史上的一段、滚到底：往后再读一段；读到文件尾就接回平时（跟着新写进来的）
    rt.later = function () {
      if (!win || moreBusy || !path || loadingNow) return Promise.resolve(false);
      moreBusy = true;
      var g = gen;
      return LOC.stat(path).then(function (st) {
        var s0 = win.to, n = Math.min(Math.max(0, st.size - s0), TAIL);
        return LOC.read(path, { offset: s0, max: n }).then(function (buf) {
          if (g !== gen || !win) { moreBusy = false; return false; }
          var r = linesOf(buf, false), lines = r.lines;
          if (s0 + buf.byteLength < st.size) win.to = s0 + (r.end || buf.byteLength); else { win = null; offset = s0 + r.end; if (pollT) tailOn(); }
          if (cur && cur.stats && cur.stats.auto) delete cur.stats; // 上一段末尾那一问可能还没完
          var before = turns.length, touched = new Set();
          lines.forEach(function (l) { var t = feedLine(l); if (t) touched.add(t); });
          if (win) finishTurn();
          moreBusy = false;
          turns.slice(before).forEach(function (t) { touched.delete(t); emit("append", t); });
          touched.forEach(function (t) { emit("turn", t); });
          emit("status");
          return true;
        });
      }).catch(function () { moreBusy = false; return false; });
    };

    // 排着的那几句：比较时规整（去掉 [Image #n]、所有空白），按字认出来划掉（被读进去了 / 出队了 / 闲着时直接当问题收了）
    // 别的会话发来的（<cross-session-message …>正文</cross-session-message>）：排进去时带 hop-chain、读进去时不带——只按正文认，不然永远「排着」
    var XS_RE = /^\s*<cross-session-message\b([^>]*)>\n?([\s\S]*?)(\n?<\/cross-session-message>)?\s*$/;
    var IMG_ANY = /\[Image(?: #\d+)?(?:: "[^"\n]*")?\]/g;
    // 很长的一句（粘贴了几 MB）：算过的记着（排着的、等确认的每次对一遍都要算——以前一粘贴整个界面卡住）
    var QN = typeof Map === "function" ? new Map() : null;
    var qnorm = function (t) {
      t = String(t || "");
      if (QN && t.length > 4000) { var c0 = QN.get(t); if (c0 !== undefined) return c0; var v0 = qnorm0(t); QN.set(t, v0); if (QN.size > 24) QN.delete(QN.keys().next().value); return v0; }
      return qnorm0(t);
    };
    var qnorm0 = function (t) {
      var xs = XS_RE.exec(t); if (xs) t = "xs:" + xs[2];
      t = t.replace(/^\s*!/, ""); // 「! 命令」（bash 模式）：它记成 <bash-input>命令</bash-input>、排进它的队时也只记命令本身——按命令本身认（以前认不出：跑完了还挂着一行「❯ ! …」，30 秒后误报没收到）
      var k = t.replace(IMG_ANY, "").replace(/[\s\u200b"`]+/g, ""); // 引号、反引号也不算（开头的路径送出去时加了引号，图片路径包了反引号）
      if (k) return k;
      var n = (t.match(IMG_ANY) || []).length; // 只有图的一句（「[Image #1][Image #2]」）：去掉图就什么都不剩了——按几张图认（以前认不出：排着的一直挂着、30 秒后误报「没有收到」，再点就重复发）
      return n ? "\u0001img" + n : "";
    };
    function unqueue(t) { var k = qnorm(t); if (!k) return; for (var qi = 0; qi < queue.length; qi++) if (qnorm(queue[qi].text) === k) { queue.splice(qi, 1); break; } if (inj) inj = inj.filter(function (x) { return qnorm(x.text) !== k; }); }
    // 记录里出现了这一问 / 这条附件（几句排着的会拼成一条）：拿走时挂着的那几句不再挂
    function untake(t) { var k = qnorm(t); if (!k || !taken.length) return; taken = taken.filter(function (x) { var xn = qnorm(x.text); return !xn || k.indexOf(xn) < 0; }); }
    // 在输入框里打的一句、送进去时它正问着你（或者开着对话框）：被它当成了回答（记在 AskUserQuestion 的结果里），不会再作为一问出现在记录里——
    //   不再挂成「在发 / 排着」（不然一直挂在对话最下面，排到它的回复后面去）
    function answeredBy(list) {
      var ks = list.map(qnorm).filter(Boolean);
      if (!ks.length) return;
      var hit = function (x) { var xn = qnorm(x.text); return !!xn && ks.some(function (k) { return k.indexOf(xn) >= 0; }); };
      if (inj.length) inj = inj.filter(function (x) { return !hit(x); });
      if (taken.length) taken = taken.filter(function (x) { return !hit(x); });
      if (unc.length) { var n0 = unc.length; unc = unc.filter(function (x) { return !hit(x); }); if (unc.length !== n0) lqSave(); }
    }
    function takeOut(text) { if (!readOnce || inOlder || !text || !text.trim() || /^\s*[\/<]/.test(text)) return; taken.push({ text: text, at: Date.now() }); } // 斜杠命令、它自己塞的（<…>）不挂
    // 记录里读到了你说的一句（当一问收下的、一轮中间读进去的、跑了的 ! 命令——bash）：这边送进去的、排着的、拿走了在等的同一句都不再挂着；
    //   话和别的话拼在一起读进去的也算（这边那句是它的一部分）；! 命令只认一模一样的（命令很短，别的话里常常带着同样几个字）
    function gotAsk(mt, bash) {
      if (inj && inj.length) { var n0 = qnorm(mt); inj = inj.filter(function (x) { var xn = qnorm(x.text); if (!xn) return true; return /^\s*!/.test(x.text) ? xn !== n0 : bash || n0.indexOf(xn) < 0; }); }
      unqueue(mt); untake(mt); lqDrop(mt);
    }
    // ---- 一行记录 → Paimon 的对话 ----
    // 这一问做完：补一行「✻ …for 5s」——它还在等你回答选择题（AskUserQuestion 没结果）的不算做完（同 Claude Code：问着的时候没有这一行）
    function finishTurn() { if (cur && cur.last && !cur.stats && cur.at && !(cur.parts || []).some(function (p) { return p.kind === "tool" && p.name === "AskUserQuestion" && p.status === "running"; })) cur.stats = { secs: Math.max(1, Math.round((cur.last - cur.at) / 1000)), verb: doneVerb(cur.at), at: cur.last, auto: true }; }
    var lastIn = 0, lastOut = 0;
    // 它从哪一刻起在想（等模型回）：忙着、最后一条是你的话或工具结果、它还没写出东西；不在想是 0
    rt.thinkSince = function () { return rt.stream && lastIn > lastOut ? lastIn : 0; };
    // 斜杠命令（同 Claude Code 2.1.281）：命令那一条——「local」类的是一条用户消息，结果显示成 system 的那种（/rename 这类）命令、结果都是 system / local_command；
    //   结果是 <local-command-stdout>（淡字）/ <local-command-stderr>（红字），以前的版本是用户消息、新版在 system / local_command 里。空的、「(no content)」不画那一行 ⎿（同它的 pl()）
    function cmdOpen(text, j) {
      var cm = /<command-name>([^<]*)<\/command-name>/.exec(text);
      if (!cm) return null;
      finishTurn(); cur = null;
      var ca = /<command-args>([^<]*)<\/command-args>/.exec(text);
      if (cm[1] === "/model" && ca && ca[1].trim()) modelCmd = ca[1].trim();
      if (cm[1] === "/goal") goalSeen = true;
      if (cm[1] === "/goal" && ca && /^\s*(clear|off|stop|cancel)\b/i.test(ca[1])) agent.goal = null;
      lastCmd = { cmd: (cm[1] + " " + (ca ? ca[1] : "")).trim(), note: "", at: ts(j) };
      unqueue(lastCmd.cmd); lqDrop(lastCmd.cmd); // 这边送进去的那句命令：不再挂成「在发」
      turns.push(lastCmd); byUuid[j.uuid] = lastCmd;
      return lastCmd;
    }
    function cmdOut(text, j) {
      var so = /<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/.exec(text), se = /<local-command-stderr>([\s\S]*?)<\/local-command-stderr>/.exec(text);
      if (!so && !se) return undefined;
      if (!lastCmd) return null;
      var clean = function (x) { x = String(x || "").replace(/\x1b\[[\d;]*m/g, "").trim(); return x === "(no content)" ? "" : x; };
      if (so) lastCmd.note = clean(so[1]);
      if (se) lastCmd.err = clean(se[1]);
      if (/^\/goal\b/.test(lastCmd.cmd) && /No goal set|Goal cleared/i.test(lastCmd.note || "")) { if (agent.goal) { agent.goal = null; emit("config"); } goalSeen = true; } // /goal 说没有目标：右边那块也清掉
      if (j.contextUsage) lastCmd.ctxUsage = j.contextUsage;
      if (j.usageReport) lastCmd.usageReport = j.usageReport;
      return lastCmd;
    }
    function lastAskTurn() { for (var i = turns.length - 1; i >= 0; i--) if (turns[i].ask !== undefined) return turns[i]; return null; }
    function feedLine(line) {
      if (!line || line.length < 10) return null;
      var j;
      try { j = JSON.parse(line); } catch (e) { return null; }
      // 同一条记录只认一次：按它的 uuid（没有 uuid 的对话记录：类型 + 消息 id + 时间 + 长度）
      var dk = j.uuid || (j.type === "user" || j.type === "assistant" || j.type === "system" ? j.type + "|" + (j.message && j.message.id || "") + "|" + (j.timestamp || "") + "|" + line.length : "");
      if (dk) { if (seen.has(dk)) return null; seen.add(dk); }
      // 分出去的（fork）的记录：开头一条 fork-context-ref（指着主会话前面那一大段，没抄进来），接着是主会话开它的那一下 Agent 调用、「Fork started」——
      //   不是它自己做的事：不画，也不当成它又开了一个子 agent（以前同一个 agent 在子 Agent 里一层套一层画了五层）；同一条里交给它的那段话照常是一问
      if (j.type === "fork-context-ref") return null;
      var mc0 = j.message && Array.isArray(j.message.content) ? j.message.content : null;
      if (j.type === "assistant" && j.parentUuid == null && /\/subagents\//.test(path || "") && mc0 && mc0.length && mc0.every(function (b) { return b && b.type === "tool_use" && (b.name === "Agent" || b.name === "Task"); })) { mc0.forEach(function (b) { forkSpawn[b.id] = 1; }); return null; }
      if (j.type === "user" && mc0 && mc0.some(function (b) { return b && b.type === "tool_result" && forkSpawn[b.tool_use_id]; })) j.message.content = mc0.filter(function (b) { return !(b && b.type === "tool_result" && forkSpawn[b.tool_use_id]); });
      if (!inOlder && typeof j.cwd === "string" && j.cwd) sess.cwd = j.cwd; // 它现在在哪个目录（同 Claude Code 显示路径用：目录里的写相对路径）
      // 在等它回（它在想）：最后一条是要它回的（你的话、工具结果）、它还没写出东西——转圈那一行据此写 thinking / deep in thought（rt.thinkSince）
      if (!inOlder && (j.type === "assistant" || (j.type === "user" && !j.isMeta))) { var tj = ts(j); if (j.type === "assistant") lastOut = Math.max(lastOut, tj); else lastIn = Math.max(lastIn, tj); }
      // 出错的工具结果也看一眼：后台命令没起来（is_error，没有后台 ID）要算结束，不然一直「在跑」；只有真动了哪条任务的才记下来（重放用）
      if (!inOlder) { var tre = TASK_RE.test(line); if (tre || (line.indexOf('"is_error":true') >= 0 && line.indexOf('"tool_result"') >= 0)) { var tch = taskLine(j); if (tre || tch) taskEvents.push(j); if (tch) taskDirty = true; } }
      // 压缩了上下文（/compact、自动压缩）：先是一条 system 的分界，后面跟着一条 isCompactSummary 的「用户」消息（其实是摘要）——合成一条分隔线
      if (j.type === "system" && j.subtype === "compact_boundary") {
        finishTurn(); cur = null; lastCmd = null;
        var cm0 = j.compactMetadata || {}, cb = { compact: { summary: "", pre: cm0.preTokens || 0, post: cm0.postTokens || 0, msgs: cm0.messagesSummarized || 0, trigger: cm0.trigger || "" }, at: ts(j) }; // 压缩前、压缩后各多少 token
        turns.push(cb); byUuid[j.uuid] = cb; lastCompact = cb;
        return cb;
      }
      // 离开一阵回来时 Claude Code 写的回顾（system / away_summary）：自成一条「※ recap: …」（同它自己画的；末尾那句「(disable recaps in /config)」不要）。
      //   后面它再接着说的，是接在回顾后面的新一段（不塞回上一问里，不然画在回顾上面）
      if (j.type === "system" && j.subtype === "away_summary" && j.content) {
        var rct = String(j.content).replace(/\s*\(disable recaps in \/config\)\s*$/, "").trim();
        if (!rct) return null;
        if (cur) { finishTurn(); cur = null; }
        var rc = { recap: rct, at: ts(j), uuid: j.uuid, parts: [] };
        turns.push(rc); byUuid[j.uuid] = rc;
        return rc;
      }
      // Claude Code 的提示（system / informational）：warning、notice、suggestion 级的画成「● 内容」（warning 黄、notice 灰，同它）；info 级的它自己也不画
      if (j.type === "system" && j.subtype === "informational" && typeof j.content === "string") {
        if (j.level === "info" || !j.content.trim()) return null;
        var it0 = cur || lastAskTurn();
        if (!it0) return null;
        it0.parts.push({ kind: "info", text: j.content.trim(), level: j.level || "", at: ts(j) });
        return it0;
      }
      // 定时任务（/loop、cron）到点（system / scheduled_task_fire）：同 2.1.281——一行淡的「✻ 内容」，画在它送进来的那一问上面
      if (j.type === "system" && j.subtype === "scheduled_task_fire") {
        if (typeof j.content === "string" && j.content.trim()) pendFire = { text: j.content.trim(), at: ts(j) };
        return null;
      }
      // 换了模型（model_fallback：黄点、黄字，找不到模型 / 没权限的加粗）、后台 Agent 全停了（agents_killed：红点、淡字「All background agents stopped」）、
      //   放行了刚才被拦的命令（permission_retry：「✻ Allowed npm test, git push」）：同 2.1.281，挂在这一问里
      if (j.type === "system" && /^(model_fallback|agents_killed|permission_retry)$/.test(j.subtype || "")) {
        var st0 = cur || lastAskTurn();
        if (!st0) return null;
        if (j.subtype === "model_fallback" && typeof j.content === "string" && j.content.trim()) st0.parts.push({ kind: "info", text: j.content.trim(), level: "warning", bold: j.trigger === "model_not_found" || j.trigger === "permission_denied", at: ts(j) });
        else if (j.subtype === "agents_killed") st0.parts.push({ kind: "killed", at: ts(j) });
        else if (j.subtype === "permission_retry" && ((j.commands || []).length || String(j.content || "").trim())) st0.parts.push({ kind: "allowed", cmds: (j.commands || []).map(String), text: String(j.content || ""), at: ts(j) });
        else return null;
        return st0;
      }
      // stop hook（system / stop_hook_summary）：同它——平常跑完什么都不画；出错、带回话、拦下了不让停、有名字的才画「● Ran 2 stop hooks」和下面几行
      if (j.type === "system" && j.subtype === "stop_hook_summary") {
        var hErr = Array.isArray(j.hookErrors) ? j.hookErrors : [], hCtx = Array.isArray(j.hookAdditionalContext) ? j.hookAdditionalContext : [];
        if (!hErr.length && !hCtx.length && !j.preventedContinuation && !j.hookLabel) return null;
        var ht0 = cur || lastAskTurn();
        if (!ht0) return null;
        var hInf = Array.isArray(j.hookInfos) ? j.hookInfos : [];
        ht0.parts.push({ kind: "hooks", n: j.hookCount || hInf.length, label: j.hookLabel || "", errors: hErr.map(String), ctx: hCtx.map(String), stop: j.preventedContinuation ? String(j.stopReason || "") : "", at: ts(j),
          cmds: hInf.map(function (h) { return h && h.command === "prompt" ? "prompt: " + (h.promptText || "") : String((h && h.command) || ""); }) });
        return ht0;
      }
      // 一问做完：它自己记的用时（turn_duration）——「✻ Baked for 3m 15s · done 5:06 AM」用这个（比按消息时间估的准）
      if (j.type === "system" && j.subtype === "turn_duration" && j.durationMs) {
        var tt = cur; if (!tt) for (var ti0 = turns.length - 1; ti0 >= 0 && !tt; ti0--) if (turns[ti0].ask !== undefined) tt = turns[ti0];
        if (!tt) return null;
        // 同 Claude Code 2.1.281：一问结束时还在跑的后台 Agent、动态工作流（有就画成「Waiting for N background agents to finish」）、
        //   token 预算（「12k / 50k (24%)」）、/focus 藏起来的消息数
        tt.stats = { secs: Math.max(1, Math.round(j.durationMs / 1000)), ms: j.durationMs, verb: j.uuid ? doneVerbU(j.uuid) : doneVerb(tt.at), at: ts(j), pendAgents: j.pendingBackgroundAgentCount || 0, pendWf: j.pendingWorkflowCount || 0,
          budget: j.budgetLimit !== undefined ? { used: j.budgetTokens || 0, limit: j.budgetLimit, nudges: j.budgetNudges || 0 } : null, hidden: j.briefHiddenCount || 0 };
        return tt;
      }
      // 斜杠命令和它的结果记成 system / local_command 的（新版 Claude Code：结果都在这里；/rename 这种连命令那一条也是）
      if (j.type === "system" && j.subtype === "local_command" && typeof j.content === "string") {
        var lco = cmdOpen(j.content, j);
        if (lco) return lco;
        var lcr = cmdOut(j.content, j);
        return lcr === undefined ? null : lcr;
      }
      // 别的 agent / 会话发来的消息（它们的 SendMessage）：闲着时是一条 isMeta 的用户消息，忙着时是一条 queued_command 附件（下一轮工具时读到）；
      // 都带 origin（kind: "peer"，from、name、body）→ 一问「别的 agent 发来的话」（同 Paimon 的 social：外壳按自己的样子画），它接下来的回答接在这一问里
      var og = j.origin || (j.attachment && j.attachment.type === "queued_command" && j.attachment.origin) || null;
      if (og && og.kind === "peer" && (j.type === "user" || j.type === "attachment")) {
        var raw = String(og.body || (j.attachment && j.attachment.prompt) || (j.message && typeof j.message.content === "string" ? j.message.content : "") || "");
        var sm = { from: og.from || "", from_name: og.name || og.from || "agent", mode: "queue", mode_used: "queue", ts: ts(j), text: og.body ? raw : raw.replace(/^[\s\S]*?<agent-message[^>]*>\n?/, "").replace(/\n?<\/agent-message>[\s\S]*$/, "") };
        if (j.type === "user") { finishTurn(); newRound(ts(j)); } // 闲着时收到的：上一问已经完了；忙着时收到的（附件）：上一问还在跑，不给它记「做完了」
        var pt = { system: true, social: [sm], ask: "", parts: [], at: ts(j), uuid: j.uuid };
        turns.push(pt); byUuid[j.uuid] = pt;
        // 一轮中间读进去的（附件）：这一轮接着的工具还记在这一轮里——不把它切成两半（「Ran 2 shell commands」不被拦腰截断），这条消息排在这一轮后面
        if (j.type === "user" || !cur) cur = pt;
        return pt;
      }
      // 子 agent / 后台命令跑完的通知（<task-notification>）：闲着时是一条用户消息（origin.kind: task-notification），一轮中间读进去的是 queued_command 附件。
      // 记成同 Paimon 的后台通知（notices；kind 是 agent 的就是「子 Agent 报告」，筛选里单独管）：闲着的一条自成一问（它接下来的回答接在这一问里），一轮中间的挂在这一问里
      var tnRaw = j.type === "user" && j.message && typeof j.message.content === "string" ? j.message.content : j.type === "attachment" && j.attachment && j.attachment.type === "queued_command" && typeof j.attachment.prompt === "string" ? j.attachment.prompt : "";
      if (tnRaw && /^\s*<task-notification>/.test(tnRaw)) {
        var nl0 = noteItems(tnRaw);
        if (!nl0.length) return null;
        if (j.type === "attachment" && cur) { cur.parts.push({ kind: "notice", notices: nl0, at: ts(j) }); return cur; }
        finishTurn(); newRound(ts(j));
        cur = { system: true, notices: nl0, ask: "", parts: [], at: ts(j), uuid: j.uuid };
        turns.push(cur); byUuid[j.uuid] = cur;
        return cur;
      }
      // 排着的消息（Claude Code 自己记的）：enqueue 进队；dequeue（轮到它，当作下一问）/ remove（在一轮中间被读进去了：absorbed_mid_turn）出队。
      // 还在队里的就是「排着还没被读到的」（外壳画成排队的那几块）；被读进去的那一刻起重新计时、重新数 token（同 Claude Code 的转圈那一行）
      if (j.type === "queue-operation") {
        qopAt = Date.now();
        var qc = typeof j.content === "string" ? j.content : "";
        qc = qc.replace(/^\u200b/, "");
        if (j.operation === "enqueue") { queue.push({ text: qc, at: ts(j) }); lqDrop(qc); }
        else if (j.operation === "dequeue") { var dq = queue.shift(); if (dq && Date.now() - ts(j) < 60000) takeOut(dq.text); }
        else if (j.operation === "remove" || j.operation === "popAll" || j.operation === "popOne") { // remove：一轮中间读进去了（这一轮接着算，同 Claude Code 的转圈那一行）；popAll / popOne：按 ↑ 拿回输入框改了
          var qi0 = qc ? queue.findIndex(function (q) { return qnorm(q.text) === qnorm(qc); }) : -1;
          if (readOnce && qc.trim() && Date.now() - ts(j) < 120000) {
            if (j.operation !== "remove" && !editing && Date.now() - escAt < 8000 && !escTook) { // 这边按的 Esc 让它把这句拿回了它的输入框，按完也没再送：拿回这边，它那边删掉
              emit("edit", { text: qc, images: [] });
              var bsQ = [{ keys: new Array(Array.from(qc).length + 41).join("\x7f") }];
              (ownPane() || typable() ? termSteps(bsQ) : rt.canInject() && info.job ? daemonKeys(bsQ) : Promise.resolve()).catch(function () { /* 删不掉：下一句会接在它后面 */ });
            } else if (j.operation === "remove" && /^(dropped_by_hook|cleared_on_cancel)$/.test(j.reason || "")) { // 没处理就丢了：放回这边排着的、标红
              lq.unshift({ text: qc, at: Date.now() }); lqHold = true;
              qErr = tr(j.reason === "dropped_by_hook" ? "被 Claude Code 的钩子拦下，未发送" : "Claude Code 取消时清掉了这句，未发送");
              lqSave(); emit("status");
            }
          }
          var absorbed = j.operation === "remove" && !/^(dropped_by_hook|cleared_on_cancel)$/.test(j.reason || "") && Date.now() - ts(j) < 60000; // 一轮中间读进去了：附件那条到之前照样挂着
          if (absorbed) { if (qi0 > 0) queue.slice(0, qi0).forEach(function (q) { if (!/^\s*\//.test(q.text)) takeOut(q.text); }); takeOut(qc); }
          if (qi0 > 0 && j.operation !== "popOne") { var keepQ = queue.filter(function (q, i) { return i >= qi0 || /^\s*\//.test(q.text); }); queue.length = 0; Array.prototype.push.apply(queue, keepQ); } // 它是按先后一起读进去 / 一起拿回去的：排在它前面的普通的话还在这边挂着的，是早就不在它队里的（不然挂成发不出去的「死消息」）
          unqueue(qc);
        }
        return null;
      }
      // /goal（Claude Code 的会话级目标）：goal_status 附件——met 了就算完成（不再在跑）；没 met 的就是还在跑（同它输入框上面那句「◎ /goal active (1d)」）
      if (j.type === "attachment" && j.attachment && j.attachment.type === "goal_status") {
        var gs = j.attachment; goalSeen = true;
        if (goalEnded(gs)) agent.goal = null;
        else if (gs.condition) agent.goal = { text: String(gs.condition), at: agent.goal && agent.goal.text === String(gs.condition) ? agent.goal.at : ts(j), checking: false, iterations: 0 };
        emit("config");
        return null;
      }
      // 你在它忙着的时候说的话，在一轮中间被读进去（queued_command 附件，origin: human）：同一问你说的话，接着的回答在它下面
      if (j.type === "attachment" && j.attachment && j.attachment.type === "queued_command") {
        var pr = j.attachment.prompt, qtext = typeof pr === "string" ? pr : (Array.isArray(pr) ? pr : []).filter(function (b) { return b && b.type === "text"; }).map(function (b) { return b.text; }).join("\n");
        var qimgs = Array.isArray(pr) ? pr.filter(function (b) { return b && b.type === "image" && b.source && b.source.type === "base64"; }).map(function (b) { return { media_type: b.source.media_type, data: b.source.data }; }) : [];
        if ((!qtext.trim() && !qimgs.length) || /^\s*<(task-notification|system-reminder|local-command)/.test(qtext)) return null;
        qtext = qtext.replace(/^\u200b/, "");
        var qmt = qtext.trim() || qimgs.map(function () { return "[Image]"; }).join(" ");
        gotAsk(qmt); // 这边送进去的那句已经被读进去了（原样，或者和别的话连在一起）：不再挂成排着的
        var qsp = splitShots(qtext, qimgs);
        cur = { ask: qsp.text, images: qsp.images, imgIds: Array.isArray(j.attachment.imagePasteIds) ? j.attachment.imagePasteIds : null, parts: [], at: ts(j), uuid: j.uuid, queued: true };
        if (pendFire) { if (ts(j) - pendFire.at < 600000) cur.fire = pendFire.text; pendFire = null; }
        turns.push(cur); byUuid[j.uuid] = cur;
        if (rt.stream) rt.stream.turn = cur; // 接着答的是这一问（前面那一问不再画成在跑）
        return cur;
      }
      if (j.type === "custom-title" && j.customTitle) { sess.title = agent.name = j.customTitle; return null; }
      if (j.type === "ai-title" && j.aiTitle && !info.custom) { if (!info.titleLocked) sess.title = agent.name = info.title && !messy(info.title) && !/^\//.test(info.title) ? info.title : tidy(j.aiTitle); return null; } // 它起的标题比「/effort」这种命令、原样的标记好
      if (j.type === "agent-name" && j.agentName) { info.agentName = j.agentName; return null; }
      if (j.type === "agent-setting" && j.agentSetting) { info.agentSetting = j.agentSetting; return null; }
      if (j.type === "permission-mode" && j.permissionMode) { info.permMode = j.permissionMode; return null; }
      if (j.type !== "user" && j.type !== "assistant" || !j.message || j.isMeta) return null;
      var c = j.message.content, t = null;
      if (j.type === "user") {
        var isTool = Array.isArray(c) && c.some(function (b) { return b.type === "tool_result"; });
        if (!isTool) {
          var text = typeof c === "string" ? c : (c || []).filter(function (b) { return b.type === "text"; }).map(function (b) { return b.text; }).join("\n");
          var imgs = Array.isArray(c) ? c.filter(function (b) { return b.type === "image" && b.source && b.source.type === "base64"; }).map(function (b) { return { media_type: b.source.media_type, data: b.source.data }; }) : [];
          if (j.isCompactSummary || /^This session is being continued from a previous conversation/.test(text)) {
            finishTurn(); cur = null; cmpSince(0); if (rt.compacting) { rt.compacting = null; emit("status"); } // 压缩完了
            var cs = lastCompact && !lastCompact.compact.summary ? lastCompact : null;
            if (!cs) { cs = { compact: { summary: "" }, at: ts(j) }; turns.push(cs); }
            cs.compact.summary = text.replace(/^This session is being continued from a previous conversation[^\n]*\n+/, "").trim();
            byUuid[j.uuid] = cs; lastCompact = null;
            return cs;
          }
          // 你在 Claude Code 里用 ! 跑的命令：<bash-input> 一条，<bash-stdout> / <bash-stderr> 是它的输出（画成 Paimon 的 ! 命令）
          var bi = /^\s*<bash-input>([\s\S]*?)<\/bash-input>/.exec(text);
          if (bi) { gotAsk("!" + bi[1], true); finishTurn(); cur = null; lastBash = { bash: bi[1], out: "", code: null, at: ts(j) }; turns.push(lastBash); byUuid[j.uuid] = lastBash; return lastBash; } // 这边打的「! 命令」跑完了（它跑完才把这一条和输出一起写进记录）：不再挂成排着的
          var bo = /<bash-stdout>([\s\S]*?)<\/bash-stdout>/.exec(text), be = /<bash-stderr>([\s\S]*?)<\/bash-stderr>/.exec(text);
          if ((bo || be) && lastBash) { var er = be ? be[1].trim() : ""; lastBash.out = ((bo ? bo[1] : "") + (er ? "\n" + er : "")).replace(/\x1b\[[\d;]*m/g, "").trim(); lastBash.code = er ? 1 : 0; var lb = lastBash; lastBash = null; return lb; }
          var co = cmdOpen(text, j);
          if (co) return co;
          var cr = cmdOut(text, j);
          if (cr !== undefined) return cr;
          // 打断记在真的被打断的那一问上：从后往前，跳过刚被读进来、还没回的那几句（排着的、一轮中间读进去的）——「Interrupted」画在被打断的那一块下面（同 Claude Code），不画到最后一句你说的话下面
          if (/^\s*\[Request interrupted/.test(text)) {
            for (var ii = turns.length - 1; ii >= 0; ii--) { var ti0 = turns[ii]; if (ti0.ask === undefined) continue; if (ti0.queued && !(ti0.parts || []).length && !ti0.answer) continue; ti0.error = "Interrupted by user"; return ti0; }
            return null;
          }
          if (/^\s*(<|Caveat:)/.test(text) && !imgs.length) return null; // Claude Code 自己塞进来的（提醒、钩子的输出……）
          if (j.uuid && rewound.has(j.uuid)) return null; // 打断后退回输入框了的那一句
          // 同一条（parentUuid）后面又来了一句：前面那一句在被换掉的那一支上（打断后它被放回输入框、补了几个字再发；/rewind；按两下 Esc 改上一句）——
          //   同 Claude Code 只顺着最新的这一支画：那一句和它后面的都拿掉（以前两句都画，「每7天过期的应用好」「每7天过期的应用好Web是垃圾」一上一下）
          if (j.parentUuid) for (var fk = turns.length - 1; fk >= 0; fk--) { if (turns[fk].ask !== undefined && turns[fk].parentUuid === j.parentUuid) { turns.splice(fk); cur = null; forkN++; break; } }
          finishTurn();
          text = text.replace(/^\u200b/, "");
          var mt = text.trim() || imgs.map(function () { return "[Image]"; }).join(" "); // 只有图、没有字的一问：用占位去认这边送的那句
          // 这边送进去、还没出现在记录里的：这一问里有它（原样，或者被它接在放回输入框的那句后面一起发了）就不再画成另一句；闲着时直接收下的问题也不再排着
          newRound(ts(j));
          gotAsk(mt);
          var tsp = splitShots(text, imgs);
          cur = { ask: tsp.text, images: tsp.images, imgIds: Array.isArray(j.imagePasteIds) ? j.imagePasteIds : null, parts: [], at: ts(j), uuid: j.uuid, parentUuid: j.parentUuid || "" };
          if (pendFire) { if (ts(j) - pendFire.at < 600000) cur.fire = pendFire.text; pendFire = null; }
          turns.push(cur);
          byUuid[j.uuid] = cur;
          return cur;
        }
        (c || []).forEach(function (b) {
          if (b.type !== "tool_result") return;
          var p = byTool[b.tool_use_id];
          if (!p) return;
          p.t1 = ts(j); // 结果到的时间：右侧栏「正在运行」里跑完的那几条写它用了多久
          var out = typeof b.content === "string" ? b.content : (b.content || []).filter(function (x) { return x.type === "text"; }).map(function (x) { return x.text; }).join("\n");
          result(p, out, j.toolUseResult, !!b.is_error);
          t = p.turn;
        });
        if (t) { byUuid[j.uuid] = t; t.last = ts(j); }
        return t;
      }
      // 助手：一行一块（文字、思考、工具调用）
      if (!cur) { cur = { ask: "", parts: [], at: ts(j), cont: true }; turns.push(cur); }
      byUuid[j.uuid] = cur;
      // 一块接一块放进这一问。思考不单独占一块：记在它后面那一块上（thinkBefore）——同 Claude Code 并进那一组「Thought for 5s, ran 2 shell commands」；
      // 这一问最后、还没有下一块的记在 cur.think。旁白（narration）的思考同 Claude Code 是一段话
      var put = function (p) { var lp0 = cur.parts[cur.parts.length - 1]; if (lp0 && lp0.preview) cur.parts.pop(); if (cur.think) { p.thinkBefore = cur.think; cur.think = null; } cur.parts.push(p); }; // 屏幕上先抄来的那段（streamScan）：记录里的到了就换掉
      (Array.isArray(c) ? c : []).forEach(function (b) {
        // whole：记录里读到的都是说完了的整段（不是流式的半段）——在跑的这一问里也整段画（不然最后一行没换行的整句看不见，要等下一句才出来）
        if (b.type === "text" && b.text && b.text.trim()) put({ kind: "text", text: b.text, whole: true });
        else if (b.type === "thinking" && b.thinking && narration(b.signature)) { if (b.thinking.trim()) put({ kind: "text", text: b.thinking, narration: true, whole: true }); }
        else if (b.type === "thinking" && b.thinking) {
          cur.thinking = (cur.thinking ? cur.thinking + "\n\n" : "") + b.thinking; cur.thought = Math.max(cur.thought || 1, Math.round((ts(j) - cur.at) / 1000));
          (cur.think = cur.think || []).push({ text: b.thinking, ms: Math.min(600000, Math.max(0, ts(j) - (cur.last || cur.at))) }); // 想了多久：离上一条记录（同 Claude Code，最多算 10 分钟）
        }
        else if (b.type === "tool_use") {
          var name = { WebSearch: "web_search", Task: "Agent", MultiEdit: "Edit" }[b.name] || b.name;
          var p = { kind: "tool", name: name, input: b.input || {}, status: "running", id: b.id, t0: ts(j), turn: cur, cwd: j.cwd || "" }; // cwd：调用那一刻它在哪个目录（同 Claude Code：路径按那时的目录写相对的）
          // 子 agent：说明、给它的任务（prompt，筛选里的「任务说明」读它）、哪一种子 agent 都留着；它交回来的报告在结果里（result）
          if (name === "Agent") { var ai0 = b.input || {}; p.input = { description: ai0.description || String(ai0.prompt || "").split("\n")[0].slice(0, 120), prompt: ai0.prompt || "", subagent_type: ai0.subagent_type || "" }; }
          byTool[b.id] = p;
          put(p);
          if (b.name === "TodoWrite" && b.input && Array.isArray(b.input.todos)) sess.todo.items = b.input.todos.map(function (x, i) { return { id: String(i + 1), subject: x.content, status: x.status, activeForm: x.activeForm }; });
        }
      });
      var u = j.message.usage;
      if (u) { var n = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0); if (n) sess.ctx = n; }
      // 这一轮写了多少 token（转圈那一行的 ↓）：同一条回复（message.id 一样）拆成好几行记，每行带着到那时为止的用量——每条回复取最大的，再加起来
      if (u && j.message.id) tokById[j.message.id] = Math.max(tokById[j.message.id] || 0, u.output_tokens || 0);
      if (j.message.model && j.message.model !== "<synthetic>") agent.model = j.message.model;
      cur.last = ts(j);
      return cur;
    }
    // 工具的结果：同 Claude Code 的摘要（Read 12 lines、Updated x with 3 additions and 1 removal……），改动的文件给 diff
    function result(p, out, r, err) {
      p.status = err ? "error" : "done";
      p.secs = Math.max(0, Math.round(((p.turn && p.turn.last) || p.t0) - p.t0) / 1000);
      var lines = String(out || "").replace(/\r/g, "").split("\n");
      if (err) { p.error = lines[0] || "error"; p.detail = lines.slice(0, 200); return; }
      if (p.name === "AskUserQuestion") { // 同 Claude Code：答了的画「User answered Claude's questions:」，每题一行「· 问题 → 回答」（live.js askAnswered）
        p.answers = r && r.answers && typeof r.answers === "object" ? r.answers : null;
        p.response = r && typeof r.response === "string" ? r.response : "";
        p.followUp = !!(r && r.followUp);
        answeredBy([out, p.response].concat(p.answers ? Object.keys(p.answers).map(function (k) { return String(p.answers[k]); }) : []));
        p.detail = []; return;
      }
      var fp = (p.input && (p.input.file_path || p.input.path)) || (r && (r.filePath || (r.file && r.file.filePath))) || "";
      // 命令改了文件（Claude Code 记在 toolUseResult.bashEditDiff 里：它自己看出来的）：同它，这条命令不并进「Ran N shell commands」，下面每个文件「Updated x (+41 -5)」+ diff
      if (p.name === "Bash" && r && r.bashEditDiff && Array.isArray(r.bashEditDiff.files) && r.bashEditDiff.files.length) {
        p.edits = r.bashEditDiff.files.slice(0, 20).map(function (f) {
          var d = [], add = 0, del = 0;
          (f.hunks || []).forEach(function (h, hi) {
            if (hi) d.push({ t: "…" });
            var o = h.oldStart, n = h.newStart;
            (h.lines || []).forEach(function (l) { var ch = l[0], tx = l.slice(1); if (ch === "-") { d.push({ t: "-", l: tx, n: o++ }); del++; } else if (ch === "+") { d.push({ t: "+", l: tx, n: n++ }); add++; } else { d.push({ t: " ", l: tx, n: n }); o++; n++; } });
          });
          return { path: String(f.filePath || ""), diff: d, add: add, del: del };
        });
      }
      if (p.name === "Read") { // 同 Claude Code：Read 12 lines / Read image (120.6KB) / Read PDF (1.2MB) / Read 3 cells / Read 2 pages (…) / Unchanged since last read
        var rf = (r && r.file) || {}, rty = (r && r.type) || "text", nl = rf.numLines || lines.length;
        p.summary = rty === "image" ? "Read image (" + fsize(rf.originalSize || 0) + ")" : rty === "pdf" ? "Read PDF (" + fsize(rf.originalSize || 0) + ")" : rty === "notebook" ? "Read " + (rf.cells || []).length + " cells"
          : rty === "parts" ? "Read " + (rf.count || 0) + " " + (rf.count === 1 ? "page" : "pages") + " (" + fsize(rf.originalSize || 0) + ")" : rty === "file_unchanged" ? "Unchanged since last read" : "Read " + nl + " " + (nl === 1 ? "line" : "lines");
        if (rty === "image" && rf.base64) p.img = { media_type: rf.type || "image/png", data: rf.base64 }; // 读的那张图：「Read image (…)」悬停浮出、点了放大
        p.readKind = rty; p.detail = []; return;
      }
      if ((p.name === "Edit" || (p.name === "Write" && r && r.type === "update" && r.structuredPatch && r.structuredPatch.length)) && r && Array.isArray(r.structuredPatch)) { // 改过的文件（Write 覆盖已有的也是）：diff
        var d = [], add = 0, del = 0;
        r.structuredPatch.forEach(function (h, hi) {
          if (hi) d.push({ t: "…" });
          var o = h.oldStart, n = h.newStart;
          (h.lines || []).forEach(function (l) {
            var ch = l[0], tx = l.slice(1);
            if (ch === "-") { d.push({ t: "-", l: tx, n: o++ }); del++; } else if (ch === "+") { d.push({ t: "+", l: tx, n: n++ }); add++; } else { d.push({ t: " ", l: tx, n: n }); o++; n++; }
          });
        });
        p.diff = d;
        p.summary = "Updated " + fp.split("/").pop() + " with " + add + " addition" + (add === 1 ? "" : "s") + " and " + del + " removal" + (del === 1 ? "" : "s");
        return;
      }
      if (p.name === "Write") { var content = (r && r.content) || (p.input && p.input.content) || ""; var cl = String(content).split("\n"); p.detail = cl; p.summary = (r && r.type === "update" ? "Updated " : "Wrote ") + cl.length + " lines to " + fp.split("/").pop(); return; }
      // 搜（同 Claude Code 的 SearchResultSummary，连单数的写法都照它：1 个是去掉最后一个字母）：Found 3 files / Found 12 lines / Found 5 matches across 2 files
      var pl = function (n, w) { return n + " " + (n === 0 || n > 1 ? w : w.slice(0, -1)); };
      if (p.name === "Glob") { var nf = r && typeof r.numFiles === "number" ? r.numFiles : lines.filter(Boolean).length; p.summary = "Found " + pl(nf, "files"); p.detail = (r && Array.isArray(r.filenames) ? r.filenames : lines.filter(Boolean)).slice(0, 200); return; }
      if (p.name === "Grep") {
        var gm = (r && r.mode) || "files_with_matches", gl = lines.filter(Boolean);
        p.summary = gm === "content" ? "Found " + pl(typeof r.numLines === "number" ? r.numLines : gl.length, "lines") : gm === "count" ? "Found " + pl(r.numMatches || 0, "matches") + " across " + pl(r.numFiles || 0, "files") : "Found " + pl(r && typeof r.numFiles === "number" ? r.numFiles : gl.length, "files");
        p.detail = gl.slice(0, 200); return;
      }
      if (p.name === "web_search") { // 同 Claude Code：Did 1 search in 3s（不到一秒写毫秒）
        if (!r) { p.summary = "Did 1 search"; return; }
        var ws0 = (Array.isArray(r.results) ? r.results : []).filter(function (x) { return x != null && typeof x !== "string"; }).length, wsec = typeof r.durationSeconds === "number" ? r.durationSeconds : p.secs || 0;
        p.summary = "Did " + ws0 + " search" + (ws0 !== 1 ? "es" : "") + " in " + (wsec >= 1 ? Math.round(wsec) + "s" : Math.round(wsec * 1000) + "ms"); return;
      }
      if (p.name === "WebFetch") { // 同 Claude Code：Received 12.3KB (200 OK)；展开是它读出来的那段
        p.summary = lines[0] ? lines[0].slice(0, 160) : "Done"; p.detail = lines.slice(0, 200);
        if (r && typeof r.bytes === "number") { p.bytes = r.bytes; p.httpStatus = String(r.code != null ? r.code : "") + (r.codeText ? " " + r.codeText : ""); p.summary = "Received " + fsize(r.bytes) + " (" + p.httpStatus + ")"; }
        return;
      }
      if (p.name === "Skill") { // 同 Claude Code：Successfully loaded skill · 3 tools allowed · 模型；分出去跑的：Done
        var sk = r && r.status === "forked" ? ["Done"] : ["Successfully loaded skill"];
        if (r && r.status !== "forked" && Array.isArray(r.allowedTools) && r.allowedTools.length) sk.push(r.allowedTools.length + " " + (r.allowedTools.length === 1 ? "tool" : "tools") + " allowed");
        if (r && r.status !== "forked" && r.model) sk.push(r.model);
        p.summary = sk.join(" · "); p.detail = []; return;
      }
      if (p.name === "TaskStop" && r && typeof r.command === "string") p.stopCmd = r.command; // 同 Claude Code：「命令 · stopped」
      if (/^Task(Create|Update|List|Output)$|^TodoWrite$/.test(p.name)) { p.summary = lines[0] || "Done"; return; }
      if (p.name === "Agent") { // 同 Claude Code：放到后台的「Backgrounded agent」；跑完的 Done (N tool uses · Xk tokens · 用时)
        p.summary = lines[0] ? lines[0].slice(0, 200) : "Done"; p.detail = lines.slice(0, 200);
        if (r && r.status === "async_launched") p.asyncLaunched = true;
        else if (r && r.status === "completed") p.agentStats = { tools: r.totalToolUseCount || 0, tokens: r.totalTokens || 0, ms: r.totalDurationMs || 0 };
        return;
      }
      if (p.name === "SendMessage") { // 结果是一段 JSON：{ success, message: "Message queued for delivery to … at its next tool round." }
        var sr = r && typeof r === "object" && r.message ? r : null;
        if (!sr) try { sr = JSON.parse(String(out || "")); } catch (e) { sr = null; }
        p.summary = String(sr && sr.message || lines[0] || "Sent");
        if (sr && sr.success === false) { p.status = "error"; p.error = p.summary; }
        p.social = { to: (p.input && p.input.to) || "", ts: p.t0, mode: /queued/i.test(p.summary) ? "queue" : "" };
        p.detail = [];
        return;
      }
      p.detail = lines.slice(0, 400);
    }

    // ---- 在跑吗：Claude Code 自己登记的（后台会话、别的终端）；这边自己起的那个（stream-json）----
    // waiting：它在等你处理对话框（Claude Code 登记的 status "waiting"）——这时它的输入框没有焦点，送进去的字落不进它的队（见 refreshLive）
    var waitAt = 0, closedAt = 0;
    var busy = false, waiting = false, busyAt = 0, liveAt = 0, proc = null, outBuf = "", idleT = 0; // idleT：这一问答完、一阵子没再说：关掉 stdin 让 claude 自己退出（不一直占着会话，别的终端才打得开）
    function setBusy(on, t0) {
      if (on === busy) return;
      busy = on;
      if (on) { busyAt = turnAt || t0 || Date.now(); rt.stream = { t0: busyAt, turn: cur || { parts: [] }, outTokens: outTok(), thinking: false, firstAt: busyAt, verb: verbFor(busyAt), answer: "", ctl: { abort: function () {} } }; tickOn(); }
      else { rt.stream = null; if (cur && cur.parts && cur.parts.length && cur.parts[cur.parts.length - 1].preview) cur.parts.pop(); streamLines = null; finishTurn(); if (cur) emit("turn", cur); flushSoon(); } // 答完了（或者被打断了）：这边排着的几句拼成一条接着发；屏幕上抄来、记录里没等到的那段不留
      emit("status"); emit("state");
    }
    var ticker = 0;
    // App 在后台（窗口看不见）时不转：每秒八次的重画白白占着主线程（perf.json：看不见的那几格里一半的忙都是它）；回到前台下一格接着转
    function tickOn() { if (ticker) return; ticker = setInterval(function () { if (!busy) { clearInterval(ticker); ticker = 0; return; } if (rt.stream) rt.stream.turn = cur || rt.stream.turn; if (document.hidden) return; emit("tick"); }, 120); }
    function refreshLive() {
      liveAt = Date.now();
      // 子 agent 的记录（cc:sub-<id>）：它没有自己的进程可查——在不在跑看主会话的任务单里它那一条（同右侧栏）；
      //   以前按「查不到进程」当成停了：转圈那一行一直是空的，在跑的那条命令也被画成跑完（用户：子 agent 的状态栏一直是空的）
      if (info.sub) {
        var pr = rts["cc:" + info.parent], tk = pr && (pr.tasks || []).filter(function (x) { return x.id === String(sid).replace(/^sub-/, ""); })[0];
        var run0 = !!(tk && tk.status === "running"), root0 = rootOf(rt); // 会话还开着没有：看主会话（再往下一层的子 agent，它的上一级也没有自己的进程）
        setBusy(run0, tk && tk.t0);
        settle(run0 || !!(root0 && root0.info && root0.info.live));
        return;
      }
      ccFindL().then(function (x) {
        if (!x) { settle(false); return; }
        var wasLive = !!info.live;
        info.live = x.live || null; info.job = x.job || ""; info.cwd = x.cwd || info.cwd;
        // 它在等你处理一个对话框（权限确认、AskUserQuestion、MCP 要的输入、开着的面板：Claude Code 登记成 status "waiting"，claude agents 里的「needs input」）：
        //   这时它的输入框没有焦点——后台服务的 reply 粘贴进去的字落进那个对话框（或者被当成那个问题的回答），不会排进它的队。先排在这边，它回到 busy / idle 再送
        var wt0 = !!(x.live && x.live.status === "waiting") && !(closedAt && x.live.statusAt === closedAt), wAt = wt0 && x.live.statusAt || 0;
        if (wt0 !== waiting) { waiting = wt0; waitAt = wAt; emit("status"); if (!waiting && lq.length) flushSoon(); }
        else if (wt0 && wAt !== waitAt) { waitAt = wAt; emit("status"); } // 关了一个、又开了一个（中间没看到它闲着）：也算变了
        if (!proc || !proc.alive()) {
          var bz = !!(x.live && x.live.status === "busy");
          // 刚送进去一句、它的状态还没改过来（还是送之前写的「闲」）：这几秒当它在忙——不然排着的那句紧跟着送进去，落进它自己的队
          if (!bz && busy && Date.now() - sentAt < 8000 && !(x.live && x.live.statusAt > sentAt)) bz = true;
          setBusy(bz, x.live && x.live.statusAt);
        }
        if (wasLive !== !!info.live) emit("config");
        // 在压缩上下文吗：后台会话的状态文件（~/.claude/jobs/<短 id>/state.json）里它自己写的「在干嘛」提到 compact 就是在压缩；
        //   里面带百分比的话一起拿出来（同它自己转圈那一行下面的进度条），压缩完（记录里出现压缩的分界）就收起
        // 在压缩上下文吗：状态文件里不写这个——看它自己的界面（后台服务 subscribe：只读它终端的输出，不送任何东西）
        if (info.job && busy && info.live && info.live.kind === "bg" && shownNow()) watchOn(); else watchOff(); // 看得见才看它的屏幕（后台标签页、App 在后台时不看）
        termWatch(!!(busy && info.live && info.live.kind !== "bg" && shownNow())); // 开在终端里的：看它终端里的那几行
        if (rt.compacting && !busy) { rt.compacting = null; cmpSince(0); emit("status"); }
        settle(!!info.live);
        if (lq.length && !busy) flushSoon(); // 刷新页面前排着的、上一次没轮到的
      }).catch(function () {});
    }
    // 没在跑的会话，记录停在一半的（最后一个工具没有结果、子 agent / 后台命令没等到通知）：不是「还在跑」——
    // 不然它最后那条命令一直画成「Running…」（底部面板里看着像又开了一份），子 agent 显示「跑了 637 小时」
    function settle(alive) {
      if (loadingNow || !loading) return;
      alive = alive || !!(proc && proc.alive());
      var ch = false, tch = false;
      // 会话还开着（别的终端里跑着）：还没结果的就是还在跑——不因为「忙不忙」一时没对上就画成跑完（不然在跑的那条一会儿出来、一会儿没了）；开着却十分钟都没结果的才算停在一半
      //   它在问你（AskUserQuestion）、在等你处理对话框（waiting）：会话开着就一直算还在等——你过一个小时再答也一样（以前十分钟后当成停在一半，问答面板没了，只剩它自己界面里那一块）
      if (!busy) turns.slice(-4).forEach(function (t) { (t.parts || []).forEach(function (p) { if (p.kind === "tool" && p.status === "running" && (!alive || (Date.now() - (p.t0 || 0) > 600000 && !waiting && p.name !== "AskUserQuestion"))) { p.status = "done"; p.stale = true; ch = true; } }); if (ch) emit("turn", t); });
      if (!alive) rt.tasks.forEach(function (t) { if (t.status === "running") { t.status = "stopped"; t.summary = t.summary || "会话已结束"; tch = true; } });
      if (tch) emit("tasks");
      if (ch || tch) emit("status");
    }
    rt.elsewhere = function () { return !!(info.live && (!proc || !proc.alive())); };
    // 能送进去：后台会话（claude --bg，经后台服务）；开在 Vibing Studio 自己终端标签页里的（敲进那个终端，同你在那里打字）
    // 它在等你处理对话框 / 开着的面板（登记成 waiting）：这一回「在等」的记号（它登记的时间；关了又开一个是新的一回），不在等是 0
    rt.waitingDialog = function () { return waiting && !(proc && proc.alive()) ? (info.live && info.live.statusAt) || 1 : 0; };
    // 这边看着它的面板关了（屏幕上回到输入框）：不等它的登记改过来（几秒一次）——排着的马上送
    //   它的登记还没改过来时（还是关掉的那一回的「在等」）不再当成在等
    rt.dialogClosed = function () { if (!waiting) return; waiting = false; closedAt = (info.live && info.live.statusAt) || 0; emit("status"); if (lq.length) flushSoon(); };
    rt.canInject = function () { return !!(info.live && info.live.kind === "bg" && info.job && LOC.pty) || typable(); };
    // 能直接往它所在的终端里敲（不用接过来）：开在自己的终端标签页里；开在 iTerm2 里、试过一次能让 iTerm2 替你敲
    var typable = function () { return !!ownPane() || (itermOK === true && !!info.live && info.live.kind !== "bg"); };
    // 开在 iTerm2 里的：经 AppleScript 让 iTerm2 往那个会话里打字、按键（同你在那里按）——按它的终端（tty）找是哪个会话；第一次 macOS 会问允不允许 Vibing Studio 控制 iTerm2。
    //   Claude Code 自己没有给别的程序往交互会话里送话、打断的口子（它的消息 socket 只收「别的 agent 发来的消息」；SIGINT 是让它退出）
    var itermOK = null; // null：还没试过；true：成了；false：不是 iTerm2 / 没被允许
    var ITERM_AS = ["on run argv", "set t to item 1 of argv", "set k to item 2 of argv", "set d to item 3 of argv", "set E to character id 27", "tell application \"iTerm2\"",
      "repeat with w in windows", "repeat with tb in tabs of w", "repeat with s in sessions of tb", "if tty of s is t then",
      "if k is \"read\" then", "return contents of s", "end if", // 读它现在屏幕上的字（只看转圈那一行、压缩进度，见 termWatch）
      "if k is \"esc\" then", "tell s to write text E newline no", "else if k is \"stab\" then", "tell s to write text (E & \"[Z\") newline no",
      "else if k is \"ctrlb\" then", "tell s to write text (character id 2) newline no", "else if k is \"clear\" then", "tell s to write text (character id 12) newline no",
      "else if k is \"parts\" then", "set AppleScript's text item delimiters to (character id 31)", "set ps to text items of d", "set AppleScript's text item delimiters to \"\"", "set hasImg to false",
      "repeat with x in ps", "set x to x as text", "if x starts with (character id 30) then", "set hasImg to true", "tell s to write text (E & \"[200~\" & (text 2 thru -1 of x) & E & \"[201~\") newline no", "delay 0.25",
      "else if length of x > 0 then", "tell s to write text (E & \"[200~\" & x & E & \"[201~\") newline no", "delay 0.06", "end if", "end repeat",
      "if hasImg then", "delay 1.5", "else", "delay 0.15", "end if", "tell s to write text (character id 13) newline no",
      "else if k is \"keys\" then", "tell s to write text d newline no", // 原样的几个键（取回排着的话：↑、回车、ctrl+l）
      "else if k is \"sendnow\" then", "tell s to write text (character id 24) newline no", "delay 0.05", "tell s to write text (character id 19) newline no", // ctrl+x ctrl+s：Claude Code 的 chat:sendNow
      "else", "tell s to write text (E & \"[200~\" & d & E & \"[201~\") newline no", "delay 0.15", "tell s to write text (character id 13) newline no", "end if",
      "return \"ok\"", "end if", "end repeat", "end repeat", "end repeat", "end tell", "return \"notfound\"", "end run"].join("\n");
    // macOS 拦下来的（-1743 / -1744）：多半是一时的（同时有别的 AppleScript 在问 iTerm2、它正忙）——隔一下再试一次；两次都被拦才算没权限，
    //   报的时候带上原始的错误码（以前只写「没权限」，看不出到底是哪一种）
    function viaIterm(kind, text, again) {
      var pid = info.live && +info.live.pid;
      if (itermOK === false || !pid || !LOC.exec) return Promise.reject(new Error(tr("该会话不在 iTerm2 中")));
      var q = function (x) { return "'" + String(x).replace(/'/g, "'\\''") + "'"; };
      var cmd = "t=$(ps -o tty= -p " + pid + " | tr -d ' '); [ -n \"$t\" ] && [ \"$t\" != '??' ] || { echo notty; exit 0; }; pgrep -xq iTerm2 || { echo notrunning; exit 0; }; osascript - \"/dev/$t\" " + q(kind) + " " + q(text || "") + " 2>&1 <<'APPLESCRIPT'\n" + ITERM_AS + "\nAPPLESCRIPT";
      return LOC.exec({ cmd: cmd }).then(function (r) {
        var out = String((r && (r.out || r.stdout)) || "") + String((r && (r.err || r.stderr)) || "");
        if (/^\s*ok\s*$/m.test(out)) { itermOK = true; emit("config"); return; }
        if (/-1743|-1744|not allowed|not authorized|不允许/i.test(out)) {
          if (!again) return new Promise(function (res) { setTimeout(res, 700); }).then(function () { return viaIterm(kind, text, true); });
          var code = (/-17\d\d/.exec(out) || [""])[0];
          // 「自动化」里 Vibing Studio → iTerm 是开着的也会这样：现在装的这一版签名时少了「控制其他 App」（apple-events）的授权声明，macOS 照样拦——是这边的问题，不是你没开
          throw new Error(tr("macOS 拦下了 Vibing Studio 控制 iTerm2" + (code ? "（" + code + "）" : "") + "：现在装的这一版 Vibing Studio 缺少控制其他 App 的授权声明，装上新版后就能送达"));
        }
        itermOK = false;
        throw new Error(/notrunning|notfound|notty/.test(out) ? tr("该会话不在 iTerm2 中（进程 " + pid + "）") : tr("iTerm2 操作失败：") + out.trim().slice(0, 200));
      });
    }
    var KEYSEQ = { esc: "\x1b", stab: "\x1b[Z", ctrlb: "\x02", clear: "\x0c", sendnow: "\x18\x13" }; // clear：ctrl+l，Claude Code 的 chat:clearInput（清空它的输入框）
    function termKeys(kind) { if (ownPane()) { paneKeys(KEYSEQ[kind]); return Promise.resolve(); } return viaIterm(kind); }
    function termText(text) {
      if (ownPane()) return viaPane(text);
      if (!hasImgs(text)) return viaIterm("text", text);
      return viaIterm("parts", pasteSeq(text).map(function (x) { return (x.img ? "\x1e" : "") + x.s; }).join("\x1f"));
    }
    // 开在 Vibing Studio 自己的哪个终端标签页里（你在那里敲的 claude）：侧栏认得出是哪一个（终端标题里的会话名 / 前台进程的 pid）
    function ownPane() {
      var T = window.TSU_TERM, hit = null;
      if (!T || !T.wins || !info.live || info.live.kind === "bg") return null;
      try { T.wins().forEach(function (w) { if (hit || !w.side || !w.side.cc) return; var p = w.side.cc().panes[sid]; if (p && !p.closed && p.shell && p.shell.pty && p.shell.type) hit = p; }); } catch (e) { return null; }
      return hit;
    }
    // 按键敲进那个终端（Esc、Shift+Tab、ctrl+b）；不在了返回 false
    function paneKeys(seq) { var p = ownPane(); if (!p) return false; p.shell.type(seq); return true; }
    // 一句话敲进那个终端：整段按「粘贴」送（多行不会一行一行地提交；长的它自己收成 [Pasted text]），停一下再按回车
    // 附的图同 Claude Code 自己的做法送：话里的 [Image #N: "路径"] 拆出来，图的路径单独粘贴一次——同把图拖进它的终端，它自己读成 [Image #N]、
    //   作为图发给模型（以前整段话连路径一起粘贴、路径故意不以 .png 结尾，它不当图，模型要再用 Read 读那个文件）。
    //   它读图是异步的、读的时候按下的回车会被它清掉：全部粘完、等 1.5 秒再回车
    var IMG_TOK = /\[Image(?: #(\d+))?: "([^"\n]+)"\]/g;
    function hasImgs(t) { IMG_TOK.lastIndex = 0; return IMG_TOK.test(String(t || "")); }
    function imgParts(text) {
      var out = [], last = 0, m;
      text = String(text || ""); IMG_TOK.lastIndex = 0;
      while ((m = IMG_TOK.exec(text))) { if (m.index > last) out.push({ text: text.slice(last, m.index) }); out.push({ img: m[2], no: m[1] ? +m[1] : 0 }); last = m.index + m[0].length; }
      if (last < text.length) out.push({ text: text.slice(last) });
      return out;
    }
    var dragPath = function (p) { return String(p).replace(/([ \\'"()&;|<>$`!*?#~{}\[\]])/g, "\\$1"); }; // 同拖进终端：空格这些前面加反斜杠（它去掉反斜杠再认）
    function pasteSeq(text) { return (hasImgs(text) ? imgParts(text) : [{ text: text }]).map(function (x, i) { return x.img ? { img: true, s: dragPath(x.img) } : { s: ccPasteSafe(i ? x.text : unslash(x.text)) }; }).filter(function (x) { return x.s; }); }
    function viaPane(text) {
      var p = ownPane();
      if (!p) return Promise.reject(new Error(tr("该终端标签页已关闭")));
      var seq = pasteSeq(text), n = seq.filter(function (x) { return x.img; }).length, i = 0;
      return new Promise(function (res) {
        (function next() {
          if (i >= seq.length) return setTimeout(function () { p.shell.type("\r"); res(); }, n ? 1500 : 150);
          var x = seq[i++];
          p.shell.type("\x1b[200~" + x.s + "\x1b[201~");
          setTimeout(next, x.img ? 250 : 60);
        })();
      });
    }
    rt.label = "Claude Code";
    // 状态栏、输入框下面那一行：它在哪跑、这里说话会怎样
    rt.hint = function () { return tr(hintRaw()); };
    // 只在真的不能说话时写一句（开在别的终端里、只读）；能说的（这里接着说、后台会话）不写提示——输入框就是普通的输入框
    function hintRaw() {
      if (rt.elsewhere() && !rt.canInject() && !(info.live && info.live.kind !== "bg" && itermOK === null)) return "在另一个终端中运行 · 请在那个终端里发送";
      return "";
    };
    // 送进后台会话、它还没读到的（忙着的时候它排着，下一步才写进记录）：「n msg pending」
    var inj = [], injecting = false, sentAt = 0, nowAt = 0; // nowAt：点了「马上发」的时刻
    // 这边排着的（答着的时候又说的几句）：不一句一句送进去——送进后台会话的会一句一句排进它自己的队，ctrl+enter 一次只发出去一句；
    // 留在这边，这一问答完了（或者 ctrl+enter 打断以后）拼成一条（空一行隔开）一次发出去。自己起的 claude -p 也一样（不一句一句写进 stdin）。
    // 刷新页面也不丢：记在这台设备上（十分钟内的还算数）；正在送的那条（lqSending）送到了才从记着的里面划掉
    var LQK = "tsu-cc-queued", LQ_TTL = 600000, lqSending = "", unc = [], UNC_MS = 30000, seenAt = 0; // unc：送出去了（后台服务说收下了）、记录里还没见到的——见到才算送到；seenAt：上一次读完记录的时刻
    // 同一句话送的经过（放回来、拼起来、重试都跟着走；记在排着的那一条上）：first 第一次送出的时刻、last 最近一次、tries 送了几次、
    //   fails 没送成几次、manual 你点「重试」几次、err 最近一次没送成的原因——「未发送」那一行照它写（失败几次、手动重试几次、什么时候）
    var META = ["first", "last", "tries", "fails", "manual", "err"], sendMeta = {};
    var metaOf = function (x) { var m = {}; META.forEach(function (k) { if (x && x[k] != null && x[k] !== "") m[k] = x[k]; }); return m; };
    var metaJoin = function (xs) { var m = {}; xs.forEach(function (x) { var a = metaOf(x); if (a.first && (!m.first || a.first < m.first)) m.first = a.first; ["last", "tries", "fails", "manual"].forEach(function (k) { if (a[k] > (m[k] || 0)) m[k] = a[k]; }); if (a.err) m.err = a.err; }); return m; };
    // 粘贴的大段（同 Claude Code：输入框里是「[Pasted text #N +M lines]」，原文另存）：送出去是展开的原文；
    //   排着、没送到的画成输入框里的样子，「编辑」放回输入框时也放回原来的样子（原文跟着）——不把几万行一下子塞回输入框
    var PASTE = typeof Map === "function" ? new Map() : null;
    var pasteOf = function (t) { return (PASTE && PASTE.get(t)) || null; };
    function withPastes(x) {
      var r = splitShots(x.text), pm = pasteOf(x.text);
      if (pm) { var r2 = splitShots(pm.shown); r2.images = r.images; r2.pastes = pm.pastes; return r2; }
      return r; // 原文的分段不在了（重新打开过）：给原文，输入框那边太长的照 Claude Code 收起来
    }
    // 前后的空行不算（送出去、画出来都去掉：以前重试过的一句第一行是空的）
    var unpad = function (t) { return String(t || "").replace(/^(?:[ \t]*\n)+/, "").replace(/(?:\n[ \t]*)+$/, ""); };
    // 晚送到的（没送成、重试以后才送到的）：第一次发出的时刻记在这台设备上——记录里那一问下面淡淡写「16:33 写 · 16:40 送达」，
    //   不然它在记录里的位置看着像是你后来才说的
    var LATEK = "tsu-cc-late", lateAt = (function () { try { return (JSON.parse(localStorage.getItem(LATEK) || "{}") || {})[sid] || {}; } catch (e) { return {}; } })();
    function lateSave() {
      try {
        var ks = Object.keys(lateAt); if (ks.length > 40) ks.sort(function (a, b) { return lateAt[a].at - lateAt[b].at; }).slice(0, ks.length - 40).forEach(function (k) { delete lateAt[k]; });
        var m = JSON.parse(localStorage.getItem(LATEK) || "{}") || {}; m[sid] = lateAt; localStorage.setItem(LATEK, JSON.stringify(m));
      } catch (e) { /* 满了 */ }
    }
    rt.writtenAt = function (text) { var k = qnorm(text); return (k && lateAt[k]) || null; };
    // 每一次送（成没成、走的哪条路、用了多久、为什么没成）都记进服务记录：「服务状态」里的「Claude Code 送达」——哪天什么时候送不进去，回头查得到
    var VIA = { daemon: "daemon", iterm: "iTerm2", pane: "terminal tab", resume: "resume in background", proc: "claude -p" };
    function svcRec(text, m, ok, err) {
      try {
        if (!window.TSU_SVCLOG || !TSU_SVCLOG.rec) return;
        m = m || {};
        TSU_SVCLOG.rec({ svc: "cc", op: ok === "confirm" ? "confirm" : "send · " + (VIA[m.via] || "daemon"), at: m.t0 || Date.now(), ms: m.t0 ? Date.now() - m.t0 : 0, st: ok === true ? 200 : 0, err: ok === true ? "" : String(err || ""),
          info: { session: String(sid).slice(0, 8), text: String(text || "").replace(/\s+/g, " ").slice(0, 120), tries: m.tries || 1, fails: m.fails || 0 } });
      } catch (e) { /* 记不了也不影响送 */ }
    }
    var lq = (function () { try { var q = (JSON.parse(localStorage.getItem(LQK) || "{}") || {})[sid]; return q && Date.now() - q.at < LQ_TTL && Array.isArray(q.items) ? q.items.filter(function (x) { return x && unpad(x.text).trim(); }) : []; } catch (e) { return []; } })();
    function lqSave() {
      try {
        var m = JSON.parse(localStorage.getItem(LQK) || "{}") || {}, items = (lqSending ? [Object.assign({ text: lqSending, at: Date.now() }, sendMeta[qnorm(lqSending)] || {})] : []).concat((unc || []).map(function (u) { return Object.assign({ text: u.text, at: u.at, u: 1 }, metaOf(u)); }), lq);
        items = items.filter(function (x) { return String(x.text || "").length < 300000; }); // 几百 KB 以上的（粘贴的大日志）只留在内存里：存进去会撑爆本地存储
        Object.keys(m).forEach(function (k) { if (!m[k] || Date.now() - m[k].at > LQ_TTL) delete m[k]; });
        if (items.length) m[sid] = { items: items, at: Date.now() }; else delete m[sid];
        localStorage.setItem(LQK, JSON.stringify(m));
      } catch (e) { /* 满了 */ }
    }
    function lqAdd(text) { text = unpad(text); if (!text.trim()) return; var pm = pasteOf(text); lq.push(Object.assign({ text: text, at: Date.now() }, pm ? { shown: pm.shown } : {})); lqSave(); emit("status"); }
    // 真要送的那一刻才取（接上后台会话要一两秒，这期间又排进来的也在里面）；没送成的放回最前面
    //   ! 命令一条一条单独发（同 Claude Code 它队里的 bash 命令一条一条跑）：拼进别的话里就不是命令了；排在最前面的是命令时，后面的话接上去会被当成命令的一部分在 shell 里跑
    function lqTake() {
      lq = lq.filter(function (x) { return !(x.sentAt && evHas(x.text, x.sentAt - EV_WIN)) && unpad(x.text).trim(); }); // 以为没收到、放回来的：记录里其实有了就不再重送（以前这样一句发了两遍）
      // 没送成、还没重试的（带着 err）不跟着一起走：它在最前面就一句都不取（按顺序，等你重试、编辑或取消它）
      var bang = function (x) { return /^\s*!/.test(x.text); }, n = lq.length && !lq[0].err && bang(lq[0]) ? 1 : 0;
      if (!n) while (n < lq.length && !bang(lq[n]) && !lq[n].err) n++;
      var took = lq.slice(0, n), t = took.map(function (x) { return unpad(x.text); }).join("\n\n");
      if (t) sendMeta[qnorm(t)] = metaJoin(took);
      lq = lq.slice(n); lqSending = t; lqSave(); emit("status"); return t;
    }
    function lqSent() { lqSending = ""; lqSave(); }
    // 记录里已经有了的（它排进自己的队 / 已经当一问读了）：这边排着的同一句划掉——送到了却以为没送到、放回来的，不再拼进下一句重送
    // 记录里见到的话（排进它队里的 enqueue、一轮中间读进去的 queued_command、当一问的）：几分钟内的都记着——
    //   它常常在「送到了」的回话回来之前就写进记录、被这边读到了：那时这句还不在等确认的（unc）里，对不上；以前就这样误报「没有收到」，再一发就重复了
    var ev = [], EV_WIN = 120000;
    function evAdd(t) { ev.push({ t: t, at: Date.now() }); if (ev.length > 150) ev.splice(0, ev.length - 150); }
    function evHas(text, since) { for (var i = ev.length - 1; i >= 0; i--) { if (ev[i].at < since) break; if (sameMsg(text, ev[i].t)) return true; } return false; }
    function lqDrop(text) {
      var t = String(text || "").replace(/^\u200b/, "").trim();
      if (!t || typeof lq === "undefined" || !lq) return;
      evAdd(t);
      confirmSent(t); // 送出去、等着确认的：记录里见到了就算送到
      var n = lq.length, tq = qnorm(t); // 按去掉引号、空白比（开头的路径送出去时加了引号）
      // 没送成过、过了一阵才送到的：记下它第一次发出的时刻（记录里那一问下面写「16:33 写 · 16:40 送达」）
      var m0 = sendMeta[tq];
      if (m0 && m0.first && (m0.fails || Date.now() - m0.first > 60000) && !lateAt[tq]) { lateAt[tq] = { first: m0.first, at: Date.now() }; lateSave(); }
      delete sendMeta[tq]; // 送到了：它送的经过不用再记
      if (PASTE) PASTE.forEach(function (v, k0) { if (qnorm(k0) === tq) PASTE.delete(k0); });
      lq = lq.filter(function (x) { return qnorm(x.text) !== tq && !(x.u && sameMsg(x.text, t)); });
      var wasSending = lqSending && qnorm(lqSending) === tq;
      if (wasSending) lqSending = "";
      if (lq.length !== n || wasSending) { if (!lq.length && lqHold) { lqHold = false; qErr = ""; } lqSave(); emit("status"); } // 正在送的那句已经在记录里了：记着的也划掉（不然重新打开后当成没送出去的又发一遍）
    }
    // 记录里的这句（排进它队里的、读进去的一问、问题的回答）是不是这边送的那句：去掉引号、空白比；和别的话拼在一起读进去的也算；
    //   长的一段它可能记成「[Pasted text #N +n lines]」：认前面那段（只剩占位符的：只有一句在等确认时算它）
    function sameMsg(mine, theirs) {
      var x = qnorm(mine), y = qnorm(theirs);
      if (!x || !y) return false;
      if (x === y || y.indexOf(x) >= 0) return true;
      if (!/\[Pasted text #\d+/.test(theirs)) return false;
      var head = qnorm(String(theirs).split(/\[Pasted text #\d+[^\]]*\]/)[0]);
      return head.length >= 6 ? x.indexOf(head) === 0 : !!unc && unc.length === 1;
    }
    function confirmSent(text) {
      if (!unc || !unc.length || !text) return;
      var n = unc.length;
      unc = unc.filter(function (u) { return !sameMsg(u.text, text); });
      if (unc.length !== n) lqSave();
    }
    // 送出去 30 秒、记录也又读过了，还是没见到（没排进它的队、没当一问读、也没当回答）：它没收到——多半是送进去的那一刻它在等你处理对话框，
    //   字落进了对话框。放回这边排着的最前面，标红写清楚（能点「重试」、按 ↑ 取回改），不自己重送（万一其实收到了，不重复塞给它）
    function checkUnc() {
      if (!unc.length || !path || win || loadingNow) return;
      var got = unc.filter(function (u) { return evHas(u.text, u.at - EV_WIN); });
      if (got.length) { unc = unc.filter(function (u) { return got.indexOf(u) < 0; }); lqSave(); } // 其实早就见到了（送到之前就写进记录了）：算送到
      var late = unc.filter(function (u) { return seenAt - u.at > UNC_MS; });
      if (!late.length) return;
      unc = unc.filter(function (u) { return late.indexOf(u) < 0; });
      late.forEach(function (u) { inj = inj.filter(function (x) { return x.text !== u.text; }); });
      qErr = tr("Claude Code 没有收到（30 秒内未出现在会话记录中）");
      lq = late.map(function (u) { var m = metaOf(u); m.fails = (m.fails || 0) + 1; m.err = qErr; svcRec(u.text, Object.assign({}, u, m), "confirm", qErr); return Object.assign({ text: u.text, at: Date.now(), sentAt: u.at }, m); }).concat(lq);
      lqHold = true;
      lqSave(); emit("status");
    }

    // 这边排着、还没送出去的：几句；按 ↑ 拿回输入框改（拿回去就不排了，改完再发）
    rt.localQueued = function () { return lq.length; };
    // 它在问你（AskUserQuestion，还没有结果）：最近几问里还在等的那一个——{ id, questions }
    rt.question = function () {
      for (var i = turns.length - 1; i >= Math.max(0, turns.length - 4); i--) {
        var ps = turns[i].parts || [];
        for (var k = ps.length - 1; k >= 0; k--) { var p = ps[k]; if (p.kind === "tool" && p.name === "AskUserQuestion" && p.status === "running" && p.input && Array.isArray(p.input.questions) && p.input.questions.length) return { id: p.id, questions: p.input.questions }; }
      }
      return null;
    };
    // 回答它：经后台服务的 reply 送进去（它在等回答时，这句就是回答；同 claude agents 视图里回复）。几个问题的拼成一段（每行「问题 → 回答」），它读得懂
    // 在这里能不能回答它的问题：经后台服务送得进去（后台会话）——在别的终端里跑的不行（那里自己会问）
    rt.canAnswer = function () { return !!(rt.canInject() && !typable()); };
    rt.answerQuestion = function (text) {
      if (!rt.canInject() || typable()) return Promise.reject(new Error(tr("该会话未在后台运行，无法在此回答，请在其终端中回答")));
      return viaDaemon(text).then(function () { setTimeout(poll, 400); setTimeout(poll, 1500); emit("status"); });
    };
    rt.takeQueued = function () { if (!lq.length) return null; var t = lq.map(function (x) { return x.shown || x.text; }).join("\n\n"); lq = []; lqSave(); emit("status"); return { text: t, images: [] }; };
    // 「未发送 · 重试 · 编辑」的编辑：这一句从排着的里拿掉，原话（附的图跟着）交回输入框改——同在 Claude Code 里按 ↑ 把排着的拿回来改。at：画的时候它的时间（对一下是不是同一句）
    var lqAt = function (i, at) { return lq[i] && (at == null || lq[i].at === at) ? i : lq.findIndex(function (x) { return x.at === at; }); };
    // 拿掉、改了没送成的那一句以后：别的都送得出去了（没有别的没送成的）就不再拦着，排着的接着送
    var lqUnhold = function () { if (lq.some(function (y) { return y.err; })) return; lqHold = false; qErr = ""; if (lq.length) flushSoon(); };
    rt.editUnsent = function (i, at) {
      var k = lqAt(i, at);
      if (k < 0) return null;
      var x = lq.splice(k, 1)[0];
      lqUnhold(); lqSave(); emit("status");
      return withPastes(x);
    };
    // 「取消」：这一句不发了（只这一句；排着的别的照旧）
    //   取消的那一句留一会儿（rt.cancelled）：下面写「已取消 · 撤销」，点了原样放回去（失败几次、什么时候发的都在）
    var lastCancel = null;
    rt.cancelUnsent = function (i, at) {
      var k = lqAt(i, at);
      if (k < 0) return false;
      lastCancel = { x: lq.splice(k, 1)[0], k: k, at: Date.now() };
      lqUnhold(); lqSave(); emit("status");
      return true;
    };
    rt.cancelled = function () { return lastCancel && Date.now() - lastCancel.at < 10000 ? lastCancel.x : null; };
    rt.undoCancel = function () {
      if (!rt.cancelled()) return false;
      var c = lastCancel; lastCancel = null;
      lq.splice(Math.min(c.k, lq.length), 0, c.x);
      if (c.x.err) lqHold = true;
      lqSave(); emit("status");
      return true;
    };
    // 「重试」：只再送这一句（挪到最前面；送的经过跟着，手动重试 +1）——别的没送成的照旧等你处理
    rt.retryOne = function (i, at) {
      var k = lqAt(i, at);
      if (k < 0) return false;
      var x = lq.splice(k, 1)[0];
      x.manual = (x.manual || 0) + 1; delete x.err;
      lq.unshift(x);
      if (!lq.some(function (y) { return y.err; })) qErr = "";
      lqHold = false; retryN = 0; lqSave(); emit("status"); flushSoon();
      return true;
    };
    function lqBack(text, meta) { if (lqSending === text) lqSending = ""; text = unpad(text); var pm0 = pasteOf(text); if (pm0) meta = Object.assign({}, meta || {}, { shown: pm0.shown }); if (!text.trim()) return; lq.unshift(Object.assign({ text: text, at: Date.now() }, meta || {})); lqSave(); emit("status"); }
    // 排着还没被读到的：它自己记的队（queue-operation）+ 这边送进去、还没出现在记录里的（inj）+ 这边排着、还没送的（local）；太久没出队的（它没在跑）不算
    //   闲着时送进去的（inj 里 q 为 false）不是排着：它马上就当这一问开始——sending（画成平常的一问，不写「ctrl+x ctrl+s to send now」）
    rt.pending = function () {
      // ! 命令：它跑完才写进记录——它还忙着（多半就是在跑这条命令）就一直挂着（最多半小时），跑完、记录里有了就划掉
      inj = inj.filter(function (x) { var age = Date.now() - x.at; return age < 180000 || unc.some(function (u) { return u.text === x.text; }) || (busy && age < 1800000 && /^\s*!/.test(x.text)); });
      var idleSent = function (t) { var n = qnorm(t); return inj.some(function (x) { return !x.q && qnorm(x.text) === n; }); }, now0 = interrupting || Date.now() - nowAt < 8000; // 马上发的这几秒：排着的都算在发
      // 它队里的 ! 命令只记命令本身（模式另记，记录里没有）：这边打的是「! 命令」就照这边的写（同 Claude Code 排着的 bash 命令前面有 !）
      var bangOf = function (t) { var n = qnorm(t); for (var i = 0; i < inj.length; i++) if (/^\s*!/.test(inj[i].text) && qnorm(inj[i].text) === n) return inj[i].text.trim(); return t; };
      // 它自己排的（不是你说的话）：任务通知、系统提示不列；/goal 自己排进去的那句（「Goal set: …」）照样列出来（同 Claude Code），
      //   但它不是你的话——不能改、不出「send now」（sys）
      var sysQ = /^\s*<(?:task-notification|system-reminder)/, goalQ = /^\s*Goal (?:set|cleared|active): /;
      var out = queue.filter(function (q) { return (busy || Date.now() - q.at < 120000) && !sysQ.test(q.text); }).map(function (q) {
        if (goalQ.test(q.text)) return { text: q.text.trim(), at: q.at, sys: true };
        var am = /^\s*<agent-message from="([^"]+)"[^>]*>\n?([\s\S]*?)(\n?<\/agent-message>)?\s*$/.exec(q.text);
        if (am) return { text: am[2], from: am[1], at: q.at };
        var xs = XS_RE.exec(q.text), xn = xs && (/\bfrom-name="([^"]*)"/.exec(xs[1]) || /\bfrom="([^"]*)"/.exec(xs[1])); // 别的会话发来的：同 agent 的消息，一行「› Message from @名字」
        return xs ? { text: xs[2], from: xn ? xn[1] : "session", at: q.at } : { text: bangOf(q.text), at: q.at, sending: now0 || idleSent(q.text) };
      });
      taken = taken.filter(function (x) { return Date.now() - x.at < 20000; }); // 20 秒还没在记录里出现：不再挂
      taken.forEach(function (x) { if (!out.some(function (q) { return qnorm(q.text) === qnorm(x.text); })) out.push({ text: bangOf(x.text), at: x.at, sending: true }); });
      inj.forEach(function (x) { if (!out.some(function (q) { return qnorm(q.text) === qnorm(x.text); })) out.push({ text: x.text, at: x.at, ours: true, sending: now0 || !x.q }); });
      // li：排在这边的第几句（「编辑」「取消」对的就是它）；没送成的带着自己的原因、失败几次、手动重试几次、什么时候（老的记录没有这些：用整体的原因）
      var anyErr = lq.some(function (y) { return y.err; });
      lq.forEach(function (x, i) { out.push(Object.assign({ text: unpad(x.text), at: x.at, local: true, li: i, sending: now0 && !lqHold, err: x.err || (lqHold && qErr && (x.u || !anyErr) ? qErr : "") }, x.err || lqHold ? { first: x.first || x.sentAt || x.at, last: x.last || 0, tries: x.tries || 0, fails: x.fails || 0, manual: x.manual || 0 } : {})); });
      // 附的图（[Image #N: "路径"]）：字里留 [Image #N]，图另给（images，同已经发出去的那几问：下面一张一行「⎿  [Image #N]」，悬停看、点开）
      out.forEach(function (q) { if (q.from || q.sys) return; var pm = pasteOf(q.text); if (pm) q.shown = pm.shown; }); // 画成输入框里的样子（粘贴的大段收着）
      lq.forEach(function (x) { if (!x.shown) return; out.forEach(function (q) { if (q.local && q.text === unpad(x.text) && !q.shown) q.shown = x.shown; }); });
      out.forEach(function (q) { if (q.from || q.text.indexOf("[Image") < 0) return; var sp = splitShots(q.text); if (sp.images.length) { q.text = sp.text; q.images = sp.images; } else { var bk = shotsBack(q); if (bk) q.images = bk; } }); // 排进它的队以后也一直有图（不只是在发的那几秒）
      return out;
    };
    rt.pendingMsgs = function () { return rt.pending().filter(function (q) { return !q.sys; }).length; };
    // ---- 经官方的 `claude attach <job>` 送一句话进后台会话：同你在终端里接上它、打字、回车 ----
    // 开一个看不见的伪终端，exec claude attach（exec：attach 起不来时不会留下一个 shell 来接这句话——绝不能让它落进 shell 里执行）；
    // 等它的界面真的起来了（去掉颜色后能看到「for shortcuts」「esc to interrupt」或者会话名），屏幕上是权限确认 / 选择题就不送（那是要你来选的）；
    // 用「粘贴」送进去（多行也不会提前回车），再回车；过一会儿关掉伪终端——会话照跑，它把这句写进自己的记录，这边跟着读出来
    // 换模型（setModel）：自己起的 claude -p 用旧模型起的——闲着就停掉，下一句带 --model 重新起（--model 只管这一次，不动你的默认设置）；正忙着就等这一问完了再停。
    // 正在别处跑的（后台会话、别的终端）不替它换：在里面打 /model 会连你的默认模型一起改掉（Claude Code 把它存成新会话的默认）——说一句，在它那里换
    var restartAfter = false;
    // 换模型：
    //   · 自己起的 claude -p（stream-json）：直接发 set_model 控制请求——马上换、不用停掉重起（同 Claude Desktop）；下一次起也带 --model
    //   · 后台会话（Claude Code 后台服务里的 job）：经后台服务送「/model 模型」进去（同你在它终端里打）——Claude Code 会把它也存成你的默认模型，先问一句
    //   · 开在别的终端里的：这边送不进去，说一句
    rt.setModel = function (id) {
      id = String(id || "").trim();
      if (!id) return false;
      if (rt.elsewhere()) {
        if (!(info.job && LOC.exec)) { rt.record("/model " + id, "这个会话开在别的终端里：在那里打 /model " + id); return false; }
        var go = function () { viaDaemon("/model " + id).then(function () { modelSel = id; selAt = Date.now(); modelKeep(sid, id); emit("config"); emit("status"); }, function (e) { rt.record("/model " + id, "没换成：" + (e && e.message || e)); }); };
        var ask = window.STUDIO && STUDIO.ask;
        if (ask) ask({ title: "切换到 " + ccName(id) + "？", text: "这是一个后台会话。切换模型需要向会话发送 /model，Claude Code 会同时将其保存为默认模型，之后新建的会话也将使用该模型。", ok: "切换" }).then(function (ok) { if (ok) go(); });
        else go();
        return true;
      }
      modelSel = id; selAt = Date.now(); modelKeep(sid, id);
      if (proc && proc.alive()) proc.write(JSON.stringify({ type: "control_request", request_id: "model-" + Date.now(), request: { subtype: "set_model", model: id } }) + "\n");
      emit("config"); emit("status");
      return true;
    };
    // esc：先按一下 Esc（打断这一问；在等你选的权限 / 选项也是取消），等它停下（屏幕上出现 Interrupted，最多 3.5 秒）再送；
    // text 可以是函数：真要粘贴的那一刻才取（ctrl+enter：接上要一两秒，这期间又排进来的也一起送）；取出来是空的就只是 Esc
    var ANSI = /\x1b\[[0-9;?<>=]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
    // 送一句给后台会话：走 Claude Code 后台服务（daemon）自己的「reply」——它控制口（/tmp/cc-daemon-<uid>/*/control.sock）上的一个请求，
    //   带 ~/.claude/daemon/control.key（同它 agents 视图里「回复」、claude CLI 里送话用的那一个）。不接进它的终端、不往输入框里打字、不改终端大小；
    //   它忙着时就排进它自己的队（同在它终端里回车），闲着就直接开始这一问。还在起、重启中的，隔 200ms 再试几次（同 CLI）
    // 连上后台服务的控制口，把请求原样写进去，等它回一行再退（最多 20 秒）；连不上 / 断开 / 超时各回一行说明
    var DAEMON_PL = 'use IO::Socket::UNIX; my $s = IO::Socket::UNIX->new(Peer => $ARGV[0]) or do { print qq({"ok":false,"code":"ENOCONN","error":"连不上 Claude Code 后台服务"}\\n); exit 0 }; print $s join(q(), <STDIN>); $s->flush; $SIG{ALRM} = sub { print qq({"ok":false,"code":"ETIMEOUT"}\\n); exit 0 }; alarm 20; my $l = <$s>; print(defined $l ? $l : qq({"ok":false,"code":"ECLOSED"}\\n));';
    // 命令行放得下的长度（macOS 一条命令连参数最多 1 MB 左右，再长 spawn 报「Argument list too long」）：更长的写进文件，命令从文件读
    var BIG_ARG = 60000;
    function bigFile(name, data) { var p = LOC.info().home + "/Library/Application Support/Vibing Studio/run/" + name; return LOC.write(p, data).then(function () { return p; }); }
    // 以路径开头的话（拖进来的截图「/Users/…/截屏 09.12.33.png 说明」）：Claude Code 把「/」开头的一律当斜杠命令——一轮中间不读、等这一轮完了才轮到，
    //   而且弹出命令补全、回车被补全吃掉，后面几句会粘成一条。前面垫看不见的字没用（它会把零宽字符、各种空格去掉）。
    //   做法：开头那个路径加上引号（"/Users/…png" 说明）——不再是斜杠命令，同平常说的话一样下一步就读到（实测）；真的命令 /model、/compact 不动
    var PATH_EXT = /^(\/[^\n]*?\.(?:png|jpe?g|gif|webp|heic|heif|tiff?|bmp|svg|pdf|mov|mp4|m4a|mp3|wav|txt|md|json|jsonl|js|mjs|ts|tsx|py|swift|html|css|csv|zip|log))(?=\s|$)/i;
    function unslash(t) {
      var lead = /^\s*/.exec(t)[0], body = t.slice(lead.length), m = /^\/(\S+)/.exec(body);
      if (!m || !/[^a-zA-Z0-9:_-]/.test(m[1])) return t; // 不是「/」开头，或者就是个命令
      var pm = PATH_EXT.exec(body), path = pm ? pm[1] : "/" + m[1]; // 文件名里可能有空格（截屏 2026-09-29 09.12.33.png）：按扩展名找到路径的结尾
      return lead + '"' + path + '"' + body.slice(path.length);
    }
    // 粘贴里有「图片路径」的段：Claude Code 按换行、按「空格 + /」把粘贴切成几段，哪一段（去掉首尾引号、反斜杠转义）以 .png/.jpg/.jpeg/.gif/.webp 结尾
    //   就当是拖进来的图、先去读（异步）；读完——不管读没读到——把这期间按下的回车清掉（它的 usePasteHandler：W() 清掉等着的回车，只有普通粘贴走 Z() 补回车）。
    //   reply 是「粘贴 + 10ms 后回车」：截图路径单独一行（拖了两张截图）必定卡在它的输入框里不发。做法：这样的段用反引号包起来（`/…/截屏.png`），
    //   它不再当图读，路径照样在（模型照样 Read）。! 开头的（shell 命令）：反引号在 shell 里是命令替换，改成单引号包起来、后面接一个空的 ''
    //   （shell 里还是原来的路径；结尾不是 .png，也不当图读）
    var CC_IMG = /\.(png|jpe?g|gif|webp)$/i;
    function ccPasteSafe(t) {
      var bang = /^\s*!/.test(String(t));
      return String(t).split("\n").map(function (line) {
        return line.split(/ (?=\/|[A-Za-z]:\\)/).map(function (seg) {
          var core = seg.trim();
          if (core.length > 1 && ((core[0] === '"' && core[core.length - 1] === '"') || (core[0] === "'" && core[core.length - 1] === "'"))) core = core.slice(1, -1);
          core = core.replace(/\\(.)/g, "$1");
          if (!CC_IMG.test(core)) return seg;
          if (bang) return /^\s*/.exec(seg)[0] + "'" + core.replace(/'/g, "'\\''") + "'''" + /\s*$/.exec(seg)[0];
          return /^\s*/.exec(seg)[0] + "`" + core + "`" + /\s*$/.exec(seg)[0];
        }).join(" ");
      }).join("\n");
    }
    rt._pasteSafe = ccPasteSafe; // 测试用
    // 登记里最新的一条不是后台会话（kind 不是 bg），可这个会话在 Claude Code 的后台服务里有 job：问后台服务这个 job 还在不在——在就是后台会话。
    //   同一个会话有时多出一条「interactive」的登记（接上它看的 claude attach、刚退出还没清掉的那条……），以前就被当成「开在别的终端里」：
    //   话送不进去、提示「在 iTerm2 以外的终端里」，还弹过「接管」
    var hasAt = 0, hasJob = "", hasAlive = false;
    function ccFindL() {
      return ccFindJ(sid).then(function (x) {
        if (!x || !x.live || x.live.kind === "bg" || !x.job || !LOC.exec) return x;
        var job = String(x.job).replace(/[^\w-]/g, "");
        var mark = function () { if (hasAlive) x.live = Object.assign({}, x.live, { kind: "bg" }); return x; };
        if (hasJob === job && Date.now() - hasAt < 8000) return mark();
        return daemonAsk({ proto: 1, op: "has", short: job }).then(function (j) { hasJob = job; hasAt = Date.now(); hasAlive = !!(j && j.ok && j.alive); return mark(); }, function () { return x; });
      });
    }
    function daemonAsk(obj) {
      var req = JSON.stringify(Object.assign({}, obj, { auth: "__CCKEY__" })) + "\n", b64 = btoa(unescape(encodeURIComponent(req)));
      var cmd = "K=$(tr -d '\\n' < \"$HOME/.claude/daemon/control.key\"); S=$(ls /tmp/cc-daemon-$(id -u)/*/control.sock 2>/dev/null | head -1); [ -n \"$S\" ] || { echo '{\"ok\":false,\"code\":\"ENOCONN\"}'; exit 0; }; printf '%s' '" + b64 + "' | base64 -D | sed \"s/__CCKEY__/$K/\" | /usr/bin/perl -e '" + DAEMON_PL + "' \"$S\"";
      return LOC.exec({ cmd: cmd }).then(function (r) { var out = String((r && (r.out || r.stdout)) || ""), m = /\{[^\n]*\}/.exec(out); try { return m ? JSON.parse(m[0]) : null; } catch (e) { return null; } });
    }
    function viaDaemon(text) {
      if (hasImgs(text) && info.job) {
        var seq = pasteSeq(String(text)), stp = [];
        seq.forEach(function (x) { stp.push({ keys: "\x1b[200~" + x.s + "\x1b[201~" }, { pause: x.img ? 250 : 60 }); });
        stp.push({ pause: seq.some(function (x) { return x.img; }) ? 1500 : 200 }, { keys: "\r" }, { pause: 300 });
        return daemonKeys(stp).catch(function () { return LOC.pty ? viaAttach(String(text)) : Promise.reject(); }).catch(function () { return viaReply(text); });
      }
      return viaReply(text);
    }
    function viaReply(text) {
      text = ccPasteSafe(unslash(String(text)));
      var job = String(info.job || "").replace(/[^\w-]/g, "");
      if (!job || !LOC.exec) return Promise.reject(new Error("没有后台会话"));
      var req = JSON.stringify({ proto: 1, op: "reply", short: job, text: String(text), auth: "__CCKEY__" }) + "\n";
      var b64 = btoa(unescape(encodeURIComponent(req)));
      // 送出去以后等它回的那一行（{"ok":true,"op":"reply"}）再断开：原来用 nc，读完输入就退，常常等不到这一行——
      //   明明送到了却当成没送到、放回这边排着，下一句又拼上它再送一遍（消息越叠越长、重复）。perl 是 macOS 自带的
      //   很长的一句（粘贴了几 MB 的日志）：先写进文件、从文件读（放在命令行里超过系统的上限，spawn 报「Argument list too long」）
      var cmd = "", tries = 0, t0 = Date.now();
      var src = b64.length > BIG_ARG ? bigFile("reply-" + job + ".json", req).then(function (p) { return "cat " + shq(p); }) : Promise.resolve("printf '%s' '" + b64 + "' | base64 -D");
      var once = function () {
        if (!cmd) return src.then(function (s0) { cmd = "K=$(tr -d '\\n' < \"$HOME/.claude/daemon/control.key\"); S=$(ls /tmp/cc-daemon-$(id -u)/*/control.sock 2>/dev/null | head -1); [ -n \"$S\" ] || { echo '{\"ok\":false,\"error\":\"找不到 Claude Code 后台服务\",\"code\":\"ENOCONN\"}'; exit 0; }; " + s0 + " | sed \"s/__CCKEY__/$K/\" | /usr/bin/perl -e '" + DAEMON_PL + "' \"$S\""; return once(); });
        return LOC.exec({ cmd: cmd }).then(function (r) {
          var out = String((r && (r.out || r.stdout)) || ""), m = /\{[^\n]*\}/.exec(out), j = null;
          try { j = m ? JSON.parse(m[0]) : null; } catch (e) { j = null; }
          if (j && j.ok) return true;
          // 它正在起来（后台服务刚重新起来、会话刚在后台跑起来，大的会话要读好一会儿）：等它好了再送——先密后疏，最多等 45 秒
          if (j && /^(ESTARTING|ENOREPLY|ERESPAWNING)$/.test(j.code || "") && Date.now() - t0 < 45000) return new Promise(function (res) { setTimeout(res, tries++ < 12 ? 250 : 1000); }).then(once);
          // 没等到回话（超时、断了）：送没送到不知道——不放回来重送（宁可让你再说一遍，也不重复塞给它）
          if (!j || j.code === "ETIMEOUT" || j.code === "ECLOSED") return "unknown";
          throw Object.assign(new Error(j.error || j.code || "后台服务没收"), { code: j.code || "" });
        });
      };
      return once();
    }
    // ---- 看它自己的界面（只读）：后台服务的 subscribe 先回一个快照（streamTail = 最近一段终端输出），之后是它界面的每一次重画 ----
    //   照着写到一块看不见的「屏幕」上（只认光标移动、写字、擦行），读出屏幕上现在是什么：
    //   「Compacting conversation…」那一行和下面「▰▰▰▱▱ 39%」的进度条（同它自己转圈那里）。不忙了就断开
    //   页面没了（刷新、更新、重开）它还在跑：原生那边照样把它的每一行推给页面——以前每刷新一次就留下一套，几小时攒了二十多条流，
    //   页面的主线程全耗在收这些没人要的推送上（整个 App 卡死）。所以带一个心跳文件（run/hb-<页面编号>，页面每 5 秒写一次）：
    //   每收到一行看一眼（最多 3 秒一次），30 秒没写过（页面没了）就自己退出
    var DAEMON_WATCH_PL = 'use IO::Socket::UNIX; use IO::Select; use Time::HiRes qw(time); $| = 1; my ($sp, $hb, $me) = @ARGV; my $s = IO::Socket::UNIX->new(Peer => $sp) or exit 0; print $s join(q(), <STDIN>); $s->flush;' +
      ' my $sel = IO::Select->new($s); my ($buf, $lf, $lc) = (q(), 0, 0);' +
      ' while (1) { if ($sel->can_read(0.25)) { my $n = sysread($s, my $c, 65536); last unless $n; $buf .= $c; } my $t = time;' +
      ' if (length $buf && $t - $lf >= 0.25) { print $buf; $buf = q(); $lf = $t; }' +
      ' if ($hb && $t - $lc >= 3) { $lc = $t; my $m = (stat($hb))[9]; exit 0 if !$m || time - $m > 30; } } print $buf if length $buf;';
    //   攒着 0.25 秒一推（它的界面一秒重画十来次：一次一推，页面光收推送就忙不过来）；页面没了（心跳 30 秒没写）自己退出
    function Screen() {
      var rows = [], r = 0, c = 0;
      var wide = function (cp) { return cp >= 0x1100 && (cp <= 0x115f || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x20000 && cp <= 0x3fffd)); };
      var row = function () { while (rows.length <= r) rows.push([]); return rows[r]; };
      return {
        write: function (s) {
          for (var i = 0; i < s.length;) {
            var ch = s[i];
            if (ch === "\x1b") {
              var m = /^\x1b\[([?>=]?)([\d;]*)[ -\/]*([@-~])/.exec(s.slice(i, i + 40));
              if (m) {
                i += m[0].length;
                if (m[1]) continue;
                var ps = m[2].split(";"), a = ps[0] === "" ? 1 : +ps[0];
                if (m[3] === "H" || m[3] === "f") { r = Math.max(0, (ps[0] === "" ? 1 : +ps[0]) - 1); c = Math.max(0, (ps[1] === undefined || ps[1] === "" ? 1 : +ps[1]) - 1); }
                else if (m[3] === "A") r = Math.max(0, r - a);
                else if (m[3] === "B") r += a;
                else if (m[3] === "C") c += a;
                else if (m[3] === "D") c = Math.max(0, c - a);
                else if (m[3] === "G") c = Math.max(0, a - 1);
                else if (m[3] === "E") { r += a; c = 0; }
                else if (m[3] === "F") { r = Math.max(0, r - a); c = 0; }
                else if (m[3] === "K") { var k0 = ps[0] === "" ? 0 : +ps[0], rw = row(); if (k0 === 0) rw.length = Math.min(rw.length, c); else if (k0 === 2) rw.length = 0; else for (var k = 0; k <= c && k < rw.length; k++) rw[k] = " "; }
                else if (m[3] === "J") { var j0 = ps[0] === "" ? 0 : +ps[0]; if (j0 >= 2) rows = []; else if (j0 === 0) { row().length = Math.min(row().length, c); rows.length = Math.min(rows.length, r + 1); } }
                continue;
              }
              var o = /^\x1b\][^\x07\x1b]*(\x07|\x1b\\)/.exec(s.slice(i, i + 400));
              i += o ? o[0].length : 2;
              continue;
            }
            if (ch === "\r") { c = 0; i++; continue; }
            if (ch === "\n") { r++; i++; continue; }
            if (ch < " ") { i++; continue; }
            var cp = s.codePointAt(i), g = String.fromCodePoint(cp), rw2 = row();
            i += g.length;
            while (rw2.length < c) rw2.push(" ");
            rw2[c] = g;
            if (wide(cp)) { rw2[c + 1] = ""; c += 2; } else c += 1;
          }
          if (rows.length > 600) { var cut = rows.length - 400; rows.splice(0, cut); r = Math.max(0, r - cut); }
        },
        lines: function () { return rows.map(function (x) { return x.join(""); }); }
      };
    }
    var watchCtl = null, watchScr = null, watchT = 0;
    rt._watch = function () { return { on: !!watchCtl, lines: watchScr ? watchScr.lines().slice(-20) : null }; }; // 查问题用：后台会话屏幕的最后几行
    var cmpSince = function (v) { var k = "vs-cmp:" + sid; try { if (v === undefined) { var x = +sessionStorage.getItem(k) || 0; return Date.now() - x < 3600000 ? x : 0; } if (v) sessionStorage.setItem(k, String(Math.round(v))); else sessionStorage.removeItem(k); } catch (e) { /* 存不了就算了 */ } return 0; };
    var scanLabel = ""; // 上一次读到、还没用上的词（要连着两次一样才换）
    function watchScan() { if (watchScr) scanLines(watchScr.lines()); }
    // 屏幕上的这几行里：转圈那一行（词、用时、token、在想）、「Compacting conversation…」和它下面的进度条。后台会话的屏幕（watchScan）、
    //   开在终端里的（iTerm2、这边自己的终端标签页：termWatch）都照这一套认
    function scanLines(ls) {
      var at = -1, pct = null;
      for (var i = ls.length - 1; i >= 0; i--) if (/^\s{0,4}[·✢✳✶✻✽*]\s+Compacting conversation/.test(ls[i])) { at = i; break; } // 转圈那一行（对话里提到这几个字的不算）
      if (at >= 0) for (var k = at; k < Math.min(ls.length, at + 4); k++) { var pm = /[▰▱█░▏▎▍▌▋▊▉]{3,}[^\d]{0,4}(\d{1,3})\s*%/.exec(ls[k]); if (pm) { pct = Math.min(100, +pm[1]); break; } }
      // 转圈那一行本身（同一块屏幕上）：Claude Code 自己写的词、用时、token、状态（thinking with max effort / still thinking… 这些）——照它的画，不自己估
      //   「✳ Whirlpooling… (53m 22s · ↓ 170.7k tokens · thinking with max effort)」；任务清单在做的那一项时，词是那一项的 activeForm
      //   它只重画变了的那几格：回放得到的这一行可能缺了一段（「✽ Percolating…      17s · ↓ 12.5k tokens)」）——各取认得出的那几样，缺的（用时）用自己算的
      var sp = null, spAt = -1;
      for (var i2 = ls.length - 1; i2 >= Math.max(0, ls.length - 60) && !sp; i2--) { var m2 = /^\s{0,4}[·✢✳✶✻✽*]\s+(\S.*?)…(.*)$/.exec(ls[i2]); if (m2 && !/^Compacting conversation/.test(m2[1]) && /\d+s\b|tokens|thinking/.test(m2[2])) sp = m2; spAt = i2; }
      if (sp) {
        var rest = sp[2], tm = /\(\s*((?:\d+h )?(?:\d+m )?\d+s)\b/.exec(rest), tk = /[↓↑]\s*[\d.,]+\s*[kKmM]?\s*tokens?/.exec(rest), ex = /\b((?:still )?thinking(?: some)?(?: more)?(?: with \w+ effort)?|deep in thought|picking the thought back up(?: \(\d+ of \d+\))?|thought for \d+s)/.exec(rest);
        var nv = { label: sp[1], time: tm ? tm[1] : "", tokens: tk ? tk[0].replace(/\s+/g, " ") : "", extra: ex ? ex[1] : "", at: Date.now() };
        var ov = rt.native;
        // 词要连着两次读到一样的才换（它重画到一半时读到的常缺几个字）：没对上就先用上一次的
        if (ov && ov.label && nv.label !== ov.label) { if (scanLabel !== nv.label) { scanLabel = nv.label; nv.label = ov.label; } }
        else scanLabel = nv.label;
        // 这一段从什么时候开始想的（live.js 的 thinkTint：想了 10 秒起那几个字往黄色过渡）：同一段接着用最早看到的；第一次看到时按它写的说法倒推
        //   （still thinking = 至少 10 秒，thinking more 20 秒，thinking some more 30 秒，deep in thought 45 秒——同 Claude Code 的换说法时刻）
        var thLb = { "thinking": 0, "still thinking": 10000, "thinking more": 20000, "thinking some more": 30000, "deep in thought": 45000 }[nv.extra.replace(/ with \w+ effort$/, "")];
        nv.thinkAt = thLb === undefined ? 0 : Math.min(ov && ov.thinkAt ? ov.thinkAt : Infinity, Date.now() - thLb);
        rt.native = nv;
        if (!ov || ov.label !== nv.label || ov.time !== nv.time || ov.tokens !== nv.tokens || ov.extra !== nv.extra) emit("status");
      } else if (rt.native && Date.now() - rt.native.at > 5000) { rt.native = null; emit("status"); }
      // （以前这里还从它屏幕上抠「正在写的那段话」先画出来——抠出来的常是通知、工具调用，画成了重复、乱七八糟的一块：去掉，回复只认记录里的）
      // 在压缩：开始的时刻一直留着——它重画到一半那一帧读不到这一行、你发了话它整屏重画，都不算压完（以前一读不到就清掉，计时、进度从 0 重来）；
      //   压完：记录里出现压缩的摘要、不忙了，或者连着 10 秒都读不到这一行。它屏幕上的百分比读得到：照它的算法倒推开始的时刻（页面刷新过、晚看到的也对得上）
      streamScan(ls, sp ? spAt : -1);
      var was = rt.compacting, now = Date.now();
      if (at >= 0) {
        var since = was ? was.since : cmpSince() || now, pm2 = /…\s*\(([^()]*)\)\s*$/.exec(ls[at]);
        if (pct != null && pct < 95) { var t0c = now + 90000 * Math.log(1 - pct / 100); if (t0c < since - 2000) since = t0c; }
        rt.compacting = { since: since, pct: Math.max((was && was.pct) || 0, pct || 0) || null, paren: pm2 ? pm2[1].trim() : (was && was.paren) || "" };
        cmpSince(since);
      } else if (was && !was.missAt) was.missAt = now;
      else if (was && now - was.missAt > 10000) { rt.compacting = null; cmpSince(0); }
      if (!!was !== !!rt.compacting || (was && rt.compacting && (was.since !== rt.compacting.since || was.pct !== rt.compacting.pct || was.paren !== rt.compacting.paren))) emit("status");
    }
    // ---- 正在写的那段话：Claude Code 写完一整段才把它记进会话记录（长的一段要几十秒），它自己屏幕上是一个字一个字出来的——
    //   在它屏幕上找转圈那一行正上面、紧挨着的「⏺ 一段话」，照着先画出来（只画写完了的行，见 live.js 的 settled）；工具调用、通知、思考不算。
    //   记录里出现这段话（或者它不在屏幕上了）就换成记录里的。屏幕上折了的行按它的宽度接回去，段落、列表照原样
    var streamCols = 0, streamLines = null, streamCand = "", streamSeen = 0;
    var vw = function (s) { var n = 0; for (var ch of String(s)) n += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1; return n; };
    var nzs = function (s) { return String(s || "").replace(/[\s*`#>_|~\-]+/g, ""); };
    var TOOLISH = /^(?:[A-Z][A-Za-z0-9_]*\(|(?:Read|Reading|Searched|Searching|Listed|Listing|Ran|Running|Wrote|Writing|Updated|Updating|Fetched|Fetching|Edited|Editing|Called|Calling|Created|Creating|Background command|Agent)\b)/;
    function streamScan(ls, spIdx) {
      var t = cur, lines = null;
      // 有工具在跑的时候它不会在写话（话是在工具结果回来以后写的）：这时屏幕上转圈那一行上面的不是话，一律不抄（以前抄进来过「1m 6s…」这种状态行）
      var real = t && (t.parts || []).filter(function (p) { return !p.preview; }), lastReal = real && real[real.length - 1];
      if (lastReal && lastReal.kind === "tool" && lastReal.status === "running") spIdx = -1;
      if (spIdx > 0 && busy && t) {
        var j = spIdx - 1;
        while (j >= 0 && !ls[j].trim()) j--;
        var end = j, start = -1, bad = false;
        for (; j >= 0; j--) {
          var L = ls[j];
          if (/^⏺(?: |$)/.test(L)) { start = j; break; }
          if (!L.trim()) continue;
          if (!/^  /.test(L) || /^\s*⎿/.test(L)) { bad = true; break; } // 不是这段话里的行（工具的结果、别的东西）
        }
        if (!bad && end >= 0) {
          var body = ls.slice(start >= 0 ? start + 1 : 0, end + 1);
          if (start >= 0) {
            var first = ls[start].replace(/^⏺ ?/, "");
            if (!TOOLISH.test(first)) lines = [first].concat(body.map(function (l) { return l.replace(/^  /, ""); }));
          } else if (streamLines && streamLines.length) { // 开头那行翻出屏幕了：跟上一次读到的接上（找重叠的那几行）
            var part = body.map(function (l) { return l.replace(/^  /, ""); }), k0 = part.findIndex(function (l) { return l.trim(); });
            if (k0 >= 0) for (var q = streamLines.length - 1; q >= 0; q--) if (streamLines[q] === part[k0]) { lines = streamLines.slice(0, q).concat(part.slice(k0)); break; }
          }
        }
      }
      var text = "";
      if (lines && lines.length) {
        streamLines = lines;
        var cw = streamCols || ls.reduce(function (m, l) { return Math.max(m, vw(l)); }, 0), out = [];
        lines.forEach(function (l, i) { // 它按屏幕宽度折的行接回去：上一行差不多写满了、这一行接着是字（不是列表、代码、空行）
          var prev = out.length ? out[out.length - 1] : null;
          if (prev !== null && i > 0 && vw("  " + lines[i - 1]) >= cw - 3 && l.trim() && !/^\s*(?:[-*•]\s|\d+[.)]\s|│|```)/.test(l)) {
            var a = prev.slice(-1), b = l.trim().charAt(0);
            out[out.length - 1] = prev + (/[A-Za-z0-9,.;:!?)\]]/.test(a) && /[A-Za-z0-9(\[]/.test(b) ? " " : "") + l.trim();
          } else out.push(l.replace(/\s+$/, ""));
        });
        text = out.join("\n").trim();
        var known = nzs((t.parts || []).filter(function (p) { return p.kind === "text" && !p.preview; }).map(function (p) { return p.text; }).join("\n"));
        if (!nzs(text) || known.indexOf(nzs(text)) >= 0) text = ""; // 记录里已经有了
        // 不像话的不要：太短、是用时 / token / 按键提示这类状态字
        if (text && (vw(text) < 12 || /^\(?\d+(?:h|m|s)\b|\b\d+m \d+s\b|tokens?\b|esc to|ctrl\+|shift\+tab|…\s*$/.test(text.split("\n")[0]) && vw(text) < 60)) text = "";
        // 屏幕上别的东西（工具调用展开的那几行、表格、几列对齐的输出）：开头一行只是个数字 / 符号，或者行中间有一大段空格（分栏），都不是在写的话
        if (text && (/^[\s\d.,:;·•\-–—|()\[\]]{1,6}$/.test(text.split("\n")[0]) || /\S {4,}\S/.test(text.replace(/^```[\s\S]*?```/gm, "")))) text = "";
        // 要连着两次读到、而且是接着长的（正在写的话只会往后长）才画：闪一下就变的状态行进不来
        if (text) { if (streamCand && (text === streamCand || text.indexOf(streamCand) === 0)) streamSeen++; else streamSeen = 0; streamCand = text; if (streamSeen < 1) text = ""; }
      } else { streamCand = ""; streamSeen = 0; if (!busy) streamLines = null; }
      var ps = t && t.parts, lp = ps && ps[ps.length - 1];
      if (!text) { if (lp && lp.preview) { ps.pop(); emit("turn", t); } return; }
      if (lp && lp.preview) { if (lp.text === text) return; lp.text = text; } else ps.push({ kind: "text", text: text, preview: true, at: Date.now() });
      emit("turn", t);
    }
    // 看后台会话屏幕用的终端：有 xterm 就用它（不挂到页面上、不画，只解析——Claude Code 的界面是一格一格改的，自己的简易版解析对不上），没有才用上面那个
    function watchScreen() {
      if (!window.Terminal) return Screen();
      var t = new Terminal({ cols: 200, rows: 50, scrollback: 0, allowProposedApi: true });
      try { if (window.Unicode11Addon) { t.loadAddon(new Unicode11Addon.Unicode11Addon()); t.unicode.activeVersion = "11"; } } catch (e) { /* 没有就按默认宽度 */ }
      return {
        write: function (d) { t.write(d); },
        lines: function () { var b = t.buffer.active, out = []; for (var i = 0; i < t.rows; i++) { var l = b.getLine(b.viewportY + i); out.push(l ? l.translateToString(true) : ""); } return out; },
        resize: function (c, r) { try { t.resize(c, r); } catch (e) { /* 大小不对就算了 */ } },
        dispose: function () { try { t.dispose(); } catch (e) { /* 已经没了 */ } }
      };
    }
    function dropScr() { if (watchScr && watchScr.dispose) watchScr.dispose(); watchScr = null; }
    // 开在终端里的会话（iTerm2、这边自己的终端标签页）：没有后台服务那条屏幕流——它在忙、这边看得见时，每 1.5 秒看一眼它屏幕上的那几行
    //   （只认转圈那一行和压缩进度；以前只有后台会话认得出，开在 iTerm2 里的压缩着也不显示）
    var termT = 0, termBusy = false;
    function termWatch(on) {
      if (!on) { if (termT) { clearInterval(termT); termT = 0; if (rt.native) { rt.native = null; emit("status"); } } return; }
      if (termT) return;
      termT = setInterval(function () {
        if (termBusy) return;
        var p = ownPane();
        if (p) { try { var x = p.shell.xterm && p.shell.xterm(), b = x && x.buffer && x.buffer.active, ls = []; if (b) for (var i = 0; i < x.rows; i++) { var l = b.getLine(b.viewportY + i); ls.push(l ? l.translateToString(true) : ""); } if (ls.length) scanLines(ls); } catch (e) { /* 读不到就算了 */ } return; }
        if (itermOK === false || !info.live || !info.live.pid || !LOC.exec) return;
        termBusy = true;
        var cmd = "t=$(ps -o tty= -p " + (+info.live.pid) + " | tr -d ' '); [ -n \"$t\" ] && [ \"$t\" != '??' ] || exit 0; pgrep -xq iTerm2 || exit 0; osascript - \"/dev/$t\" read '' 2>/dev/null <<'APPLESCRIPT' | tail -n 60\n" + ITERM_AS + "\nAPPLESCRIPT";
        LOC.exec({ cmd: cmd }).then(function (r) {
          var out = String((r && (r.out || r.stdout)) || "");
          if (out && !/^\s*notfound\s*$/.test(out)) scanLines(out.replace(/\r/g, "").split("\n"));
        }, function () {}).then(function () { termBusy = false; });
      }, 800); // 正在写的那段话也从这里读（streamScan）：读得勤一点
    }
    function watchOn() {
      var job = String(info.job || "").replace(/[^\w-]/g, "");
      if (watchCtl || !job || !LOC.exec) return;
      var req = JSON.stringify({ proto: 1, op: "subscribe", short: job, auth: "__CCKEY__", tail: 4000 }) + "\n"; // 多要一些以前的输出：从最近一次整屏重画开始回放，屏幕才完整（它平时只改变了的那几格）
      var b64 = btoa(unescape(encodeURIComponent(req)));
      var cmd = "K=$(tr -d '\\n' < \"$HOME/.claude/daemon/control.key\"); S=$(ls /tmp/cc-daemon-$(id -u)/*/control.sock 2>/dev/null | head -1); [ -n \"$S\" ] || exit 0; printf '%s' '" + b64 + "' | base64 -D | sed \"s/__CCKEY__/$K/\" | /usr/bin/perl -e '" + DAEMON_WATCH_PL + "' \"$S\" " + (HB.path ? shq(HB.path) + " " + HB.id : "");
      var ctl = watchCtl = new AbortController(), buf = "";
      // 先量它现在的大小（iTerm 接着时是 iTerm 的宽）再开始回放：大小不对，一格一格的改动全对不上
      var early = [], sized = false, scr = watchScr = watchScreen();
      var feed = function (d) { if (sized) scr.write(d); else early.push(d); };
      var goSized = function (sz) { if (sized) return; sized = true; if (sz && sz.cols) streamCols = +sz.cols; if (sz && scr.resize) scr.resize(sz.cols, sz.rows); early.forEach(function (d) { scr.write(d); }); early = []; };
      jobSize().then(goSized, function () { goSized(null); });
      setTimeout(function () { goSized(null); }, 1500);
      LOC.exec({ cmd: cmd }, ctl.signal, function (chunk, fd) {
        if (fd !== 1 || ctl !== watchCtl) return;
        buf += chunk;
        var ls = buf.split("\n"); buf = ls.pop();
        if (buf.length > 4000000) buf = "";
        ls.forEach(function (l) {
          var j; try { j = JSON.parse(l); } catch (e) { return; }
          if (j.type === "snapshot" && typeof j.streamTail === "string") feed(j.streamTail);
          else if (j.type === "stream" && typeof j.line === "string") feed(j.line);
        });
        if (!watchT) watchT = setTimeout(function () { watchT = 0; watchScan(); }, 300);
      }).then(function () { if (ctl === watchCtl) { watchCtl = null; dropScr(); } }, function () { if (ctl === watchCtl) { watchCtl = null; dropScr(); } });
    }
    // 这段会话的对话现在露着吗（开着的标签页里、不是藏在同一组后面、App 在前台）：转圈那一行的用时 / token、压缩的进度只有露着时有用
    function shownNow() {
      if (document.hidden) return false;
      var T = window.TSU_TERM;
      if (!T || !T.panes) return true;
      try { return T.panes().some(function (p) { return p.program && p.program.agentId === agent.id && !p.off && p.el && p.el.getClientRects().length > 0; }); } catch (e) { return true; }
    }
    function watchOff() {
      if (!watchCtl) return;
      var ctl = watchCtl; watchCtl = null; dropScr();
      try { ctl.abort(); } catch (e) { /* 已经停了 */ }
    }
    // 后台会话现在的终端大小（行、列）：它的进程（或它的子进程）挂着的那个伪终端，stty 读出来。拿不到就 null
    function jobSize() {
      var pid = +(info.live && info.live.pid) || 0;
      if (!pid || !LOC.exec) return Promise.resolve(null);
      var cmd = "t=$(ps -Ao pid=,ppid=,tty= | awk -v p=" + pid + " '($1==p || $2==p) && $3!=\"??\" {print $3; exit}'); [ -n \"$t\" ] && stty -f /dev/$t size";
      return LOC.exec({ cmd: cmd }).then(function (r) { var m = /(\d+)\s+(\d+)/.exec(String((r && (r.out || r.stdout)) || "")); return m && +m[1] > 4 && +m[2] > 10 ? { rows: +m[1], cols: +m[2] } : null; }, function () { return null; });
    }
    // 接上去的那个看不见的终端要和后台会话现在一样大：不一样的话 Claude Code 会把会话改成这边的大小，
    //   你在 iTerm 里接着的那个就整屏错乱（一行一个词）几秒，直到这边断开才改回去
    function viaAttach(text, esc, key) { return jobSize().then(function (sz) { return viaAttach0(text, esc, sz, key); }); }
    // ---- 按键直接送进后台会话：不起 claude attach（起一个要等它的 shell、它自己启动、界面画出来，好几秒——按 Esc 要等好几秒才打断），
    //   直接跟后台服务说 attach（同 claude attach 用的那条连接），回话一到就把键送进去，按完就断开；整个不到 0.3 秒。
    //   steps：{ keys: 原样的键 } / { pause: 毫秒 } / { expect: "正则", ms: 等多久 }（等它屏幕上出现这几个字才往下走，没等到就停、什么都不再按）
    var DAEMON_KEYS_PL = 'use IO::Socket::UNIX; use IO::Select; use Time::HiRes qw(time sleep); use MIME::Base64; $| = 1; my ($sp, $sb) = @ARGV; if ($sb =~ /^\\@(.+)$/s) { open(my $fh, q(<), $1) or do { print qq(fail:EARG\\n); exit 0 }; local $/; $sb = <$fh>; close $fh; } my $s = IO::Socket::UNIX->new(Peer => $sp) or do { print qq(fail:ENOCONN\\n); exit 0 }; print $s join(q(), <STDIN>); $s->flush; my $sel = IO::Select->new($s); my $buf = q(); my $t0 = time; while (time - $t0 < 5) { last if $buf =~ /\\n/; if ($sel->can_read(0.2)) { my $n = sysread($s, my $c, 65536); last unless $n; $buf .= $c; } } my ($first) = split(/\\n/, $buf, 2); unless (defined $first && $first =~ /"ok":true/) { $first = q(ETIMEOUT) unless defined $first; print qq(fail:$first\\n); exit 0 } for my $st (split /\\x1e/, decode_base64($sb)) { if ($st =~ /^k:(.*)$/s) { syswrite($s, decode_base64($1)); } elsif ($st =~ /^p:(\\d+)$/) { my $end = time + $1 / 1000; while (time < $end) { if ($sel->can_read($end - time)) { sysread($s, my $c, 65536) or last; } } } elsif ($st =~ /^w:(\\d+):(.*)$/s) { my ($ms, $re) = ($1, $2); my $seen = q(); my $end = time + $ms / 1000; my $ok = 0; while (time < $end) { if ($sel->can_read($end - time)) { my $n = sysread($s, my $c, 65536); last unless $n; $seen .= $c; my $pl = $seen; $pl =~ s/\\e\\[[0-9;?]*[ -\\/]*[@-~]//g; $pl =~ s/\\e\\][^\\a\\e]*(?:\\a|\\e\\\\)//g; $pl =~ s/\\e[()][0-9A-Za-z]//g; if ($pl =~ /$re/) { $ok = 1; last } } } unless ($ok) { print qq(fail:nomatch\\n); close $s; exit 0 } } } sleep 0.12; close $s; print qq(ok\\n);';
    function daemonKeys(steps) {
      var job = String(info.job || "").replace(/[^\w-]/g, "");
      if (!job || !LOC.exec) return Promise.reject(new Error(tr("没有后台会话")));
      var u8b64 = function (x) { return btoa(unescape(encodeURIComponent(String(x)))); };
      return jobSize().then(function (sz) {
        var req = JSON.stringify({ proto: 1, op: "attach", short: job, auth: "__CCKEY__", cols: sz ? sz.cols : 120, rows: sz ? sz.rows : 40, caps: { terminal: null, mux: null, ssh: false, colorLevel: 3 } }) + "\n"; // caps 要按它的格式给全（terminal、mux、ssh 必须有），少了它回「malformed request」
        var enc = steps.map(function (st) { return st.keys != null ? "k:" + u8b64(st.keys) : st.expect ? "w:" + (st.ms || 1500) + ":" + st.expect : "p:" + (st.pause || 0); }).join("\x1e");
        // 要按的键很长（粘贴了几 MB）：写进文件，perl 读「@文件」（放在命令行里超过系统的上限）
        var e64 = u8b64(enc), arg = e64.length > BIG_ARG ? bigFile("keys-" + job + ".b64", e64).then(function (p) { return "@" + p; }) : Promise.resolve(e64);
        return arg.then(function (a0) {
          var cmd = "K=$(tr -d '\\n' < \"$HOME/.claude/daemon/control.key\"); S=$(ls /tmp/cc-daemon-$(id -u)/*/control.sock 2>/dev/null | head -1); [ -n \"$S\" ] || { echo fail:ENOCONN; exit 0; }; printf '%s' '" + u8b64(req) + "' | base64 -D | sed \"s/__CCKEY__/$K/\" | /usr/bin/perl -e '" + DAEMON_KEYS_PL + "' \"$S\" " + shq(a0);
          return LOC.exec({ cmd: cmd });
        }).then(function (r) {
          var out = String((r && (r.out || r.stdout)) || "").trim();
          if (/^ok$/m.test(out)) return;
          var m = /fail:(.*)/.exec(out);
          throw new Error(m && /nomatch/.test(m[1]) ? tr("它的屏幕上没出现预期的提示，已停下，没有再按别的键") : tr("没连上后台会话：") + (m ? m[1] : out || "无输出").slice(0, 160));
        });
      });
    }
    // ---- 它自己的界面（同 claude attach）：接上后台会话的终端，一条原样转发的通道——它画的（终端输出）给 h.data(字)，send(键) 原样送进去。
    //   斜杠命令弹的面板（/config、/model、/theme、/help…）这边没有自己的版本：接上它，把它画的那一块原样搬过来（live.js 的 cc 面板）。
    //   cols、rows：按这边的大小画（它改成这个大小；断开后保持，下一个接上的再改）。h.open(它开着的终端模式：鼠标、括号粘贴……)、h.close(原因，正常断开是 "")
    //   走 proc（管道，不要伪终端）：perl 连上后台服务的控制口、说 attach，回话的第一行包成 OSC 1337;VSAttach=<base64> 交给这边，之后两头原样转发；stdin 关了就断开
    //   页面没了（刷新、更新）它还接着：页面走的时候停掉（LIVE_PROCS），停不掉的看心跳文件（同 DAEMON_WATCH_PL：30 秒没写就自己退出）
    var TUI_PL = 'use IO::Socket::UNIX; use IO::Select; use MIME::Base64; $| = 1; my ($q, $hb) = @ARGV;' +
      ' my $fail = sub { print "\\e]1337;VSAttach=fail:" . $_[0] . "\\a"; exit 0 }; my ($sp) = glob("/tmp/cc-daemon-$</*/control.sock"); $fail->("ENOCONN") unless $sp;' +
      ' open(my $kf, "<", "$ENV{HOME}/.claude/daemon/control.key") or $fail->("ENOKEY"); my $k = <$kf>; close $kf; $k =~ s/\\s+//g;' +
      ' my $req = decode_base64($q); $req =~ s/__CCKEY__/$k/; my $s = IO::Socket::UNIX->new(Peer => $sp) or $fail->("ENOCONN"); print $s $req; $s->flush;' +
      ' my $sel = IO::Select->new($s); my $buf = ""; my $t0 = time; while ($buf !~ /\\n/ && time - $t0 < 6) { if ($sel->can_read(0.2)) { my $n = sysread($s, my $c, 65536); last unless $n; $buf .= $c } }' +
      ' my ($first, $rest) = split(/\\n/, $buf, 2); $fail->("ETIMEOUT") unless defined $first && length $first; print "\\e]1337;VSAttach=" . encode_base64($first, "") . "\\a"; exit 0 unless $first =~ /"ok":true/;' +
      ' syswrite(STDOUT, $rest) if defined $rest && length $rest; my $all = IO::Select->new($s, \\*STDIN);' +
      ' my $lc = time; while (1) { for my $fh ($all->can_read(1)) { my $n = sysread($fh, my $c, 65536); exit 0 unless $n; if ($fh == $s) { syswrite(STDOUT, $c) } else { syswrite($s, $c) } }' +
      ' if ($hb && time - $lc >= 3) { $lc = time; my $m = (stat($hb))[9]; exit 0 if !$m || time - $m > 30; } }';
    var tuiLast = "";
    rt.tui = function (cols, rows, h) {
      var job = String(info.job || "").replace(/[^\w-]/g, "");
      if (!job || !LOC.proc || !(info.live && info.live.kind === "bg")) return null;
      var head = "", opened = false, done = false, p = null;
      var end = function (why) { if (done) return; done = true; if (p) { LIVE_PROCS.delete(p); p.close(); setTimeout(function () { p.kill(); }, 400); } if (h.close) h.close(why || ""); };
      // 接上时它只在终端大小变了时整屏重画：和这边上次接上的一样大就差一行（一次 60 一次 59）——不然面板已经开着时这边什么都收不到。
      //   不先去量它现在多大（要起一个登录 shell，一两秒）
      var go = function () {
        if (done) return;
        if (tuiLast === cols + "x" + rows) rows = rows - 1;
        tuiLast = cols + "x" + rows;
        var req = JSON.stringify({ proto: 1, op: "attach", short: job, auth: "__CCKEY__", cols: cols, rows: rows, caps: { terminal: null, mux: null, ssh: false, colorLevel: 3 } }) + "\n";
        p = LOC.proc({ argv: ["/usr/bin/perl", "-e", TUI_PL, btoa(unescape(encodeURIComponent(req))), HB.path || ""] }, function (s, isErr) {
          if (isErr || done) return;
          if (opened) return h.data(s);
          head += s;
          var m = /\x1b\]1337;VSAttach=([^\x07]*)\x07/.exec(head);
          if (!m) { if (head.length > 65536) head = head.slice(-4096); return; }
          var rest = head.slice(m.index + m[0].length), j = null;
          head = "";
          if (/^fail:/.test(m[1])) return end(m[1].slice(5));
          try { j = JSON.parse(decodeURIComponent(escape(atob(m[1])))); } catch (e) { j = null; }
          if (!j || !j.ok) return end((j && (j.code || j.error)) || "refused");
          opened = true;
          if (h.open) h.open(Array.isArray(j.decModes) ? j.decModes : []);
          if (rest) h.data(rest);
        }, function (code) { LIVE_PROCS.delete(p); if (!done) { done = true; if (h.close) h.close(opened ? "" : "exit " + code); } });
        LIVE_PROCS.add(p);
      };
      go();
      return { rows: function () { return rows; }, send: function (s) { if (!done && opened) p.write(String(s)).catch(function () {}); }, close: function () { end(""); }, alive: function () { return !done; } };
    };
    // 开在终端里的（自己的终端标签页、iTerm2）：同样一步一步按，要等提示的读它的屏幕
    function itermRead() {
      var pid = info.live && +info.live.pid;
      if (!pid || !LOC.exec) return Promise.resolve("");
      var cmd = "t=$(ps -o tty= -p " + pid + " | tr -d ' '); [ -n \"$t\" ] && [ \"$t\" != '??' ] || exit 0; osascript - \"/dev/$t\" read '' 2>/dev/null <<'APPLESCRIPT' | tail -n 60\n" + ITERM_AS + "\nAPPLESCRIPT";
      return LOC.exec({ cmd: cmd }).then(function (r) { return String((r && (r.out || r.stdout)) || ""); }, function () { return ""; });
    }
    function paneScreen() { var p = ownPane(), out = []; try { var x = p.shell.xterm && p.shell.xterm(), b = x && x.buffer && x.buffer.active; if (b) for (var i = 0; i < x.rows; i++) { var l = b.getLine(b.viewportY + i); out.push(l ? l.translateToString(true) : ""); } } catch (e) { /* 读不到 */ } return out.join("\n"); }
    function termSteps(steps) {
      var own = !!ownPane(), i = 0;
      var send = function (k) { if (own) { paneKeys(k); return Promise.resolve(); } return viaIterm("keys", k); };
      var read = function () { return own ? Promise.resolve(paneScreen()) : itermRead(); };
      return new Promise(function (res, rej) {
        (function next() {
          if (i >= steps.length) return res();
          var st = steps[i++];
          if (st.keys != null) return send(st.keys).then(function () { setTimeout(next, 60); }, rej);
          if (st.expect) { var t0 = Date.now(), re = new RegExp(st.expect); return (function poll() { read().then(function (scr) { if (re.test(scr)) return next(); if (Date.now() - t0 > (st.ms || 1500)) return rej(new Error(tr("它的屏幕上没出现预期的提示，已停下，没有再按别的键"))); setTimeout(poll, 150); }); })(); }
          setTimeout(next, st.pause || 0);
        })();
      });
    }
    // ---- 把排着的一句拿回来改（同 Claude Code：空输入按 ↑ 选中最新排着的那条，回车拿回输入框）：
    //   这边还没送进去的：直接拿回。已经在它队里的：在它那里按 ↑，看到「Press Enter to edit the selected message」才按回车（拿进它的输入框），
    //   再按 ctrl+l 清掉它的输入框——这句就从它的队里拿掉了，原话放回这边的输入框。没看到那句提示就停下，什么都不再按（不会误按成「回车 = 马上发」）
    var editing = false;
    // 取回排着的话来改（同 Claude Code：输入框空着按 ↑，它把排着的几句一起拿回输入框、用换行连起来——默认就是这样，不是一句一句选）：
    //   这边按 ↑ 让它拿出来，再按 ctrl+l 把它那边的输入框清掉，几句一起放进这边的输入框；这边还没送出去的也一起拿回来
    rt.editQueued = function () {
      if (editing) return Promise.resolve(null);
      var users = rt.pending().filter(function (q) { return !q.from && !q.local && !q.err && !q.sys; });
      var takeLocal = function () { var xs = lq.splice(0); lqHold = false; qErr = ""; lqSave(); return xs.map(withPastes); };
      var join = function (list) { return { text: list.map(function (q) { return q.text; }).filter(Boolean).join("\n"), images: [].concat.apply([], list.map(function (q) { return q.images || []; })) }; };
      if (!users.length) { if (!lq.length) return Promise.resolve(null); var l0 = takeLocal(); emit("status"); return Promise.resolve(join(l0)); }
      // 按 ↑：它把排着的几句一起放回它的输入框（用换行连起来）；再按退格把它那边的输入框删空（ctrl+l 在它那里只是重画屏幕，删不掉——
      //   以前删不掉，下一句发出去时和留在那里的连成一句，同一句话发了两遍）。多按几下不要紧：空的输入框按退格什么也不做
      var popped = users.map(function (q) { return q.text; }).join("\n"), nBs = Array.from(popped).length + 40;
      var steps = [{ keys: "\x1b[A" }, { pause: 400 }, { keys: new Array(nBs + 1).join("\x7f") }, { pause: 200 }];
      var run = ownPane() || typable() ? termSteps(steps) : rt.canInject() && info.job ? daemonKeys(steps) : null;
      if (!run) return Promise.reject(new Error(tr("这个会话现在不能在这里取回排着的话")));
      editing = true; emit("status");
      return run.then(function () {
        editing = false;
        users.forEach(function (q) { unqueue(q.text); lqDrop(q.text); });
        var l1 = takeLocal();
        emit("status");
        return join(users.concat(l1));
      }, function (e) { editing = false; emit("status"); throw e; });
    };
    rt.editingQueued = function () { return editing; };
    // 先走直连；直连不上（老版本的后台服务……）再退回 claude attach
    function bgKeys(keys) { return daemonKeys([{ keys: keys }]).catch(function () { return viaAttach("", keys === "\x1b", keys === "\x1b" ? null : keys); }); }
    // 把在跑的前台命令放到后台（同在它的终端里按 ctrl+b）：接上去按一下，过一会儿断开
    var bgging = false;
    // 点了 / 按了：马上画成「正在放到后台」（不能再点），等它的记录里这条命令变成后台的（或者 6 秒）再收；没成写原因
    var bgErr = "";
    rt.toBackground = function () {
      if (!rt.canInject() || !busy || bgging) return false;
      bgging = Date.now(); bgErr = ""; emit("status"); emit("tasks");
      var p0 = typable() ? termKeys("ctrlb") : bgKeys("\x02");
      p0.then(function () { setTimeout(poll, 300); setTimeout(function () { bgging = false; emit("status"); emit("tasks"); }, 6000); }, function (e) { bgging = false; bgErr = tr("没能把命令放到后台：" + String(e && e.message || e).slice(0, 160)); emit("status"); emit("tasks"); });
      return true;
    };
    rt.bgState = function () { return bgging ? "moving" : bgErr ? "error" : ""; };
    rt.bgError = function () { return bgErr; };
    // 输入框的 ctrl+b（live.js 叫 rt.detachBash）：在跑的是前台的 Bash 才送（同 Claude Code：没有在跑的命令时 ctrl+b 什么都不做）
    rt.detachBash = function () {
      var tt = rt.stream && rt.stream.turn, run = !!(tt && (tt.parts || []).some(function (p) { return p.kind === "tool" && p.name === "Bash" && p.status === "running" && !(p.input && p.input.run_in_background); }));
      return run ? rt.toBackground() !== false : false;
    };
    function viaAttach0(text, esc, sz, key) {
      return new Promise(function (resolve, reject) {
        var ws = null, buf = "", done = false, t0 = Date.now(), stage = 0, tick = 0, dec = new TextDecoder(), name = (info.live && info.live.name) || "", escAt = 0, mark = 0;
        var fin = function (err) { if (done) return; done = true; clearInterval(tick); try { if (ws) ws.close(); } catch (e) { /* 已经关了 */ } if (err) reject(err); else resolve(); };
        try { ws = LOC.pty({ cols: sz ? sz.cols : 120, rows: sz ? sz.rows : 40, cwd: info.cwd || "" }); } catch (e) { return reject(e); }
        ws.onmessage = function (e) { buf += dec.decode(e.data, { stream: true }); if (buf.length > 400000) { mark = Math.max(0, mark - (buf.length - 200000)); buf = buf.slice(-200000); } };
        ws.onclose = function () { if (!done) fin(stage >= 3 ? null : new Error("claude attach 启动失败")); };
        ws.onopen = function () { stage = 1; t0 = Date.now(); ws.send("exec claude attach " + info.job + "\r"); };
        tick = setInterval(function () {
          var el = Date.now() - t0;
          if (stage === 1) {
            if (el > 12000) return fin(new Error("无法连接后台会话（12 秒内未响应）"));
            var tail = buf.replace(ANSI, "").slice(-4000);
            if (!(el > 500 && (/for shortcuts|esc to interrupt|to interrupt\)/i.test(tail) || /❯/.test(tail) || (name && tail.indexOf(name) >= 0 && />/.test(tail)) || (el > 900 && buf.length > 400)))) return;
            stage = 2; mark = buf.length;
            if (key) { ws.send(key); stage = 5; setTimeout(function () { fin(null); }, 900); return; } // 只按一个键（ctrl+b）：按完等一下就断开
            if (esc) { ws.send("\x1b"); escAt = Date.now(); }
            return;
          }
          if (stage !== 2) return;
          var after = buf.slice(mark).replace(ANSI, ""), since = Date.now() - escAt;
          if (escAt && text === "") { if (since < 250) return; stage = 3; return setTimeout(function () { fin(null); }, 100); } // 只按 Esc：按完就走（不再等它屏幕上出「Interrupted」，最多 3.5 秒）
          if (escAt && since < 3500 && !(since > 500 && /Interrupted/i.test(after))) return;
          // 屏幕上是权限确认 / 选择题：不送（那是要你来选的）；按过 Esc 的只看按了以后的屏幕
          if (/Do you want to|Would you like to|❯\s*1\.\s|\b1\.\s*Yes\b|Allow once|Enter to confirm|Esc to cancel/i.test((escAt ? after : buf.replace(ANSI, "")).slice(-4000))) return fin(new Error("会话正在等待确认权限或选项，请在终端中连接后处理（claude attach " + info.job + "）"));
          stage = 3;
          var tx = typeof text === "function" ? text() : text;
          if (!tx) return setTimeout(function () { fin(null); }, 300);
          var seq = pasteSeq(tx), nImg = seq.filter(function (x) { return x.img; }).length, si = 0;
          (function next() {
            if (done) return;
            if (si >= seq.length) return setTimeout(function () { if (done) return; ws.send("\r"); stage = 4; setTimeout(function () { fin(null); }, 900); }, nImg ? 1500 : 300);
            var x = seq[si++];
            ws.send("\x1b[200~" + x.s + "\x1b[201~");
            setTimeout(next, x.img ? 250 : 60);
          })();
        }, 150);
      });
    }
    // 让 Claude Code 的后台接着跑这个会话（claude --bg --resume <id>，同一个 id；模型、权限模式、agent 照带），等它在后台起来（最多 20 秒）
    function viaBg() {
      // 只写 --bg --resume 会话号，别的参数一个都不带：带了（-n、--model、--permission-mode、--agent）Claude Code 不接着这个会话，而是另起一份副本
      //   （「the flags you passed started a copy as de7363e2」）。选过的模型起来以后再用 /model 换上
      var cmd = ["claude", "--bg", "--resume", sid];
      var sq = function (s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; };
      return LOC.exec({ cmd: cmd.map(sq).join(" ") + " 2>&1", cwd: info.cwd || "" }).then(function (r) {
        var out = String((r && (r.out || r.stdout)) || "");
        if (r && r.code) throw new Error("claude --bg 启动失败：" + out.trim().split("\n")[0].slice(0, 160));
        if (modelSel) setTimeout(function () { viaDaemon("/model " + modelSel).catch(function () {}); }, 1500);
        var t0 = Date.now();
        return new Promise(function (resolve, reject) {
          (function wait() {
            ccFindL().then(function (x) {
              if (x && x.live && x.live.kind === "bg" && x.job) { info.live = x.live; info.job = x.job; info.cwd = x.cwd || info.cwd; emit("config"); return resolve(); }
              if (Date.now() - t0 > 20000) return reject(new Error("后台会话未能在 20 秒内启动"));
              setTimeout(wait, 500);
            }, reject);
          })();
        });
      });
    }
    // 送不进去的（开在 iTerm2 以外的终端程序里）：排着不丢，下面写清楚为什么。不问「接管」、不结束那边的 claude
    //   （以前这里弹「在此接管该会话？」，点了就把那边的 claude 停掉——后台服务里跑着的会话也被当成「别的终端」，一点就停了它）
    //   写清楚它在哪：顺着它的进程往上找是哪个 App 开的（Visual Studio Code、Terminal、Warp……）——不写「别的终端」这种让人猜的话
    function cantReach(text) {
      var bg = info.live && info.live.kind === "bg", pid = info.live && +info.live.pid;
      if (bg || !pid || !LOC.exec) return unsentBg(text, new Error(bg ? tr("找不到这个后台会话的 job，无法送达") : tr("这个会话不在 Vibing Studio 能送达的地方运行")));
      var cmd = "p=" + pid + "; for i in 1 2 3 4 5 6 7 8 9 10 11 12; do l=$(ps -o ppid=,comm= -p $p 2>/dev/null); [ -z \"$l\" ] && break; echo \"$l\"; p=$(echo $l | awk '{print $1}'); [ \"$p\" -le 1 ] && break; done";
      LOC.exec({ cmd: cmd }).then(function (r) { var m = /\/([^\/\n]+)\.app\//.exec(String((r && (r.out || r.stdout)) || "")); return m ? m[1] : ""; }, function () { return ""; }).then(function (app) {
        unsentBg(text, new Error(app === "Vibing Studio" ? tr("这个会话开在 Vibing Studio 的一个终端标签页里（进程 " + pid + "），请在那个标签页里发送")
          : app ? tr("这个会话开在「" + app + "」里（进程 " + pid + "），Vibing Studio 只能把消息送进 iTerm2 和后台会话，请在「" + app + "」里发送")
          : tr("这个会话的进程（" + pid + "）不在 iTerm2、也不在后台服务里，Vibing Studio 送不进去")));
      });
    }
    // 说一句：答着（或者前一句正在送进去、正在打断）就先排在这边（lq），完了跟排着的拼成一条一起发；闲着就直接送
    // 送进后台会话的：它马上就忙起来（状态文件要过一会儿才改）——先当它在忙；闲着时送的，这一轮从现在算
    // 斜杠命令（/goal、/model……）：Claude Code 收到当场就执行、不进它的队（记录里也不会出现原话）——送到了就不再画成「排着」（以前一直挂着 send now 三分钟）
    //   ! 命令也不等确认：它跑完才把这一条（连同输出）写进记录，跑得久的 30 秒内本来就不会出现——不能算「没收到」；记录里出现了才划掉（gotAsk）
    function sentBg(text) { var st0 = typeof text === "string" && text ? text : lqSending; if (st0 && !/^\s*\/[\w:-]+(\s|$)/.test(st0) && !/^\s*!/.test(st0) && !evHas(st0, Date.now() - EV_WIN)) unc.push(Object.assign({ text: st0, at: Date.now() }, sendMeta[qnorm(st0)] || {})); /* 回话回来之前记录里已经有了：算送到 */ lqSent(); if (st0) svcRec(st0, sendMeta[qnorm(st0)], true); sentAt = Date.now(); qErr = ""; retryN = 0; inj = inj.filter(function (x) { return !x.cmd; }); if (chordAfter) { chordAfter = false; setTimeout(sendChord, 250); } if (!/^\s*\/[\w:-]+(\s|$)/.test(st0 || "")) { if (!busy) newRound(sentAt); setBusy(true, sentAt); } /* 斜杠命令：多半不开始一问（面板、/rename 这种），不先当它在忙——真开始了它的状态会改过来 */ // 它忙着时送进去的：还是这一轮（时间、token 不重新算）
      setTimeout(poll, 600); refreshLive(); emit("status"); if (lq.length) flushSoon(); }
    // 没送成：放回排着的最前面，不自己一遍遍重试（等你 ctrl+enter 再试、再说一句，或者在终端里接上它处理）
    // dying：自己起的、正在退出的那个 claude -p（打断没停下来被停掉的、换模型停掉的、闲着关掉的）——它还没退干净时不另起一个 --resume 同一个会话，排着等它退了再发
    var lqHold = false, dying = null, intSeq = 0, resSeq = 0;
    //   原因写在排着的那句下面（红的「未发送：……」，能点「重试」）——不再另记一条（同一句话出现两遍，看着像排进去了、其实没有）；隔 4 秒自己再试一次（多半是一时的）
    var qErr = "", retryN = 0, chordAfter = false, sendNowAt = 0;
    if (lq.some(function (x) { return x.u; })) { lqHold = true; qErr = tr("上次发送后未确认 Claude Code 已收到；确认未收到再点「重试」"); lq.forEach(function (x) { if (x.u && !x.err) x.err = qErr; }); }
    function unsentBg(text, e) {
      qErr = String(e && e.message || e).split("\n")[0].slice(0, 200);
      var m = metaOf(sendMeta[qnorm(text)]); m.fails = (m.fails || 0) + 1; m.err = qErr; m.last = m.last || Date.now();
      svcRec(text, Object.assign({}, sendMeta[qnorm(text)], m), false, qErr);
      inj = inj.filter(function (x) { return x.text !== text; }); lqBack(text, m); lqHold = true; chordAfter = false; sendNowAt = 0; nowAt = 0;
      emit("status");
      if (retryN++ < 1) setTimeout(function () { if (lqHold && lq.length) rt.retryQueued(false, true); }, 4000); // 自己再试的这一次不算「手动重试」
    }
    var flushT = 0;
    function flushSoon() { clearTimeout(flushT); flushT = setTimeout(flushQ, 80); }
    // 后台会话（claude attach 能接上的）：它忙着也照样马上送进去——排进 Claude Code 自己的队（同在它的终端里打字回车：它下一步就读到，
    //   「Press up to edit queued messages」、ctrl+x ctrl+s 都是它自己的那一套）。只有正在送上一句、正在打断时先在这边等一下，送完接着送
    var realQ = function () { return rt.canInject() && !(proc && proc.alive()); };
    function flushQ() { if (!lq.length || lqHold || injecting || interrupting || (waiting && !(proc && proc.alive())) || (dying && dying.alive()) || (path && !readOnce)) return; if (busy && !realQ()) return; if (rt.elsewhere() && !rt.canInject()) return; deliver(lqTake()); }
    // 附带的图（拖进来、粘贴的截屏）：后台会话只收文字——先把图存成文件（~/Library/Application Support/Vibing Studio/shots/），路径写在这句话前面，
    //   它用 Read 读得到（系统临时目录 TemporaryItems 里的截屏它读不了，也会被删）。存好了再发；存不了的就只发文字、说一句
    function withImages(text, imgs, go) {
      imgs = (imgs || []).filter(function (x) { return x && (x.data || x.path); });
      if (!imgs.length || !LOC.write || !LOC.info) return go(text);
      var dir = LOC.info().home + "/Library/Application Support/Vibing Studio/shots", stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
      Promise.all(imgs.map(function (im, i) {
        if (im.path && !im.data) return Promise.resolve(im.path); // 早就存成文件了的（退回输入框又发的那张）：照原来的路径
        var ext = /png/.test(im.media_type) ? "png" : /gif/.test(im.media_type) ? "gif" : /webp/.test(im.media_type) ? "webp" : "jpg", p = dir + "/shot-" + stamp + "-" + (i + 1) + "." + ext;
        var bin = atob(im.data), u8 = new Uint8Array(bin.length);
        for (var k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
        return LOC.write(p, u8).then(function () { return p; }, function () { return ""; });
      })).then(function (ps) {
        var lost = ps.filter(function (p) { return !p; }).length;
        if (lost) rt.record("图片", "有 " + lost + " 张图没存下来，只发了文字");
        // [Image #N: "路径"]：模型一看就知道是附图、照路径 Read；这边画回 [Image #N]（splitShots）。不以 .png 结尾，Claude Code 不当图去读（见 ccPasteSafe）
        //   图在哪就在哪：字里的「[Image #N]」原地换成这样（同 Claude Code：你在中间粘贴的图就在中间）；号是粘贴时编好的（接着这个会话往下编）。
        //   字里没有它的号的（老的调用）：照旧写在最前面
        var out = String(text || ""), pre = [];
        imgs.forEach(function (im, i) {
          var p = ps[i], no = im.no || rt.takeImageNo(), tag = "[Image #" + no + "]", at = out.indexOf(tag);
          if (!p) { if (at >= 0) out = out.slice(0, at) + out.slice(at + tag.length); return; }
          var full = "[Image #" + no + ': "' + p + '"]';
          if (im.no && at >= 0) out = out.slice(0, at) + full + out.slice(at + tag.length); else pre.push(full);
        });
        go(pre.join(" ") + (pre.length && out ? " " : "") + out);
      });
      return true;
    }
    // 这边附的图（withImages 存成文件、[Image #N: "路径"] 写在图原来的位置）：话里原地画回 [Image #N]（同 Claude Code：图在你粘贴的位置），下面一张一行的引用悬停浮出、点开看图
    //   更早的写成 [Image: "…/shots/shot-….png"]、开头几个带引号的路径（"…/Vibing Studio/shots/….png"）：去掉。图按需读（TSU_IMG 用到时才要 bytes）
    var SHOT_TOK = /\[Image(?: #(\d+))?: "([^"\n]+)"\]( ?)/g, SHOT_OLD = /^\s*"([^"\n]*\/Vibing Studio\/shots\/[^"\n]+)" ?/, shotCache = new Map();
    function shotImg(p) {
      var im = shotCache.get(p);
      if (im) return im;
      im = { media_type: /\.png$/i.test(p) ? "image/png" : /\.gif$/i.test(p) ? "image/gif" : /\.webp$/i.test(p) ? "image/webp" : "image/jpeg", data: "", path: p };
      im.load = function (done) {
        if (im.bytes || !LOC || !LOC.read) return done && done();
        if (im.loading) return im.loading.push(done);
        im.loading = [done];
        LOC.read(p).then(function (buf) { im.bytes = buf; }, function () { im.missing = true; }).then(function () { var cbs = im.loading; im.loading = null; cbs.forEach(function (f) { if (f) f(); }); });
      };
      shotCache.set(p, im);
      return im;
    }
    // 下一个号（同 Claude Code：图和粘贴的长文字共用一个号，整个会话一直往上数）：记录里见过的最大号——它自己的（imagePasteIds、话里的
    //   [Image #N] / [Pasted text #N]）、这边附的（[Image #N: "路径"]）、排着还没读到的——和这台设备记着的最大号取大的，+1。
    //   只读进来最后一段、压缩过的会话，前面的号看不到：记着的那个不会往回退（以前压缩后又从 #2 编起）；连着发两句也不会重号
    var NOK = "vs-paste-no";
    var noMark = function (v) {
      try { var m = JSON.parse(localStorage.getItem(NOK) || "{}") || {}, cur0 = +m[sid] || 0; if (v === undefined) return cur0; if (v > cur0) { m[sid] = v; localStorage.setItem(NOK, JSON.stringify(m)); } } catch (e) { /* 存不了就只按记录算 */ }
      return 0;
    };
    rt.nextImageNo = function () {
      var mx = 0, see = function (n) { n = +n; if (n > mx) mx = n; }, refs = function (t) { String(t || "").replace(/\[(?:Image|Pasted text|\.\.\.Truncated text) #(\d+)/g, function (a, n) { see(n); return a; }); };
      ((sess && sess.turns) || []).forEach(function (t) {
        (t.imgIds || []).forEach(see);
        (t.images || []).forEach(function (im) { if (im && im.no) see(im.no); });
        refs(t.ask);
      });
      queue.forEach(function (q) { refs(q.text); });
      inj.forEach(function (x) { refs(x.text); });
      lq.forEach(function (x) { refs(x.text); });
      return Math.max(mx, noMark()) + 1;
    };
    rt.takeImageNo = function () { var n = rt.nextImageNo(); noMark(n); return n; }; // 粘贴时就编号（同 Claude Code）：这个号算用掉了
    function splitShots(text, imgs) {
      var out = (imgs || []).slice(), m;
      text = String(text || "");
      while ((m = SHOT_OLD.exec(text))) { out.push(shotImg(m[1])); text = text.slice(m[0].length); }
      text = text.replace(SHOT_TOK, function (all, no, p, sp) { var im = shotImg(p); if (no) { im.no = +no; shotPath[+no] = im; } out.push(im); return no ? "[Image #" + no + "]" + sp : ""; }); // 有号的原地留「[Image #N]」
      if (out.length && typeof qnorm === "function") { var sk = noImgKey(text); sentShots = sentShots.filter(function (x) { return x.key !== sk; }).concat([{ key: sk, images: out }]).slice(-40); } // 记下：它排进队后记录里只剩「[Image #N]」（没有路径），照这个把图找回来
      return { text: text, images: out };
    }
    function noImgKey(t) { return qnorm(t).replace(/\[Image #\d+\]/g, "[Image]"); }
    // 排着的那句只有「[Image #N]」（它记录里的样子）：找回图——先找这边送进去的同一句话（不看编号），再按编号
    function shotsBack(q) {
      var nos = (String(q.text).match(/\[Image #(\d+)\]/g) || []).map(function (x) { return +x.replace(/\D/g, ""); });
      if (!nos.length) return null;
      var k = noImgKey(q.text), src = sentShots.filter(function (x) { return x.key === k; }).pop();
      if (src && src.images.length) return src.images.map(function (im, i) { return Object.assign({}, im, { no: nos[i] != null ? nos[i] : im.no }); });
      var ims = nos.map(function (n) { return shotPath[n] ? Object.assign({}, shotPath[n], { no: n }) : null; }).filter(Boolean);
      return ims.length ? ims : null;
    }
    // 刚送出一句：接下来几秒每 150ms 读一次会话记录（平时 0.7 秒一次）——Mac 本机没有「新写的推过来」（iPhone 借 Mac 用时有），
    //   「sending…」要等下一次读到记录里有这一句才消失，以前 Mac 上反倒比 iPhone 慢
    var burstT = 0, burstEnd = 0;
    function burst() {
      if (LOC.tail) return; // 有推送的（借 Mac 用的设备）：不用
      burstEnd = Date.now() + 8000;
      if (burstT) return;
      burstT = setInterval(function () { if (Date.now() > burstEnd) { clearInterval(burstT); burstT = 0; return; } poll(); }, 150);
    }
    // opts.shown：输入框里原来的样子（粘贴的大段还是「[Pasted text #N +M lines]」）、opts.pastes：那几段的原文——排着、没送到时照它画，「编辑」时照它放回输入框
    rt.send = function (text, imgs, opts) {
      burst();
      text = String(text || "").trim();
      if (imgs && imgs.length) return withImages(text, imgs, function (t) { rt.send(t, null, opts); });
      if (opts && opts.shown && PASTE && String(opts.shown).trim() !== text) { PASTE.set(text, { shown: String(opts.shown).trim(), pastes: opts.pastes || [] }); if (PASTE.size > 30) PASTE.delete(PASTE.keys().next().value); }
      if (!text) return false;
      if (rt.elsewhere() && !rt.canInject()) return deliver(text); // 开在别的终端里：只读（deliver 写一句说明）
      lqHold = false;
      if (waiting && !(proc && proc.alive())) { lqAdd(text); return true; } // 它在等你处理对话框：先排在这边，它回到 busy / idle 就送（refreshLive）
      if (busy && realQ() && !injecting && !interrupting && !lq.length) return deliver(text); // 忙着：直接排进它自己的队
      if (busy || injecting || interrupting || lq.length || (dying && dying.alive())) { lqAdd(text); flushSoon(); return true; }
      return deliver(text);
    };
    // 从后台服务送：后台服务不在了（关掉 iTerm 时它跟着退了：ENOCONN）、这个 job 没了（ENOJOB）——同一个会话在后台重新跑起来再送
    function viaDaemonOrResume(text) {
      return viaDaemon(text).catch(function (e) {
        if (!e || !/^(ENOJOB|ENOCONN)$/.test(e.code || "")) throw e;
        return resumeAndSend(text);
      });
    }
    // 再看一眼它现在在哪：后台服务里有它就从那里送；哪儿都没在跑就用 claude --bg --resume 在后台跑起来再送；
    //   还开在某个终端里（不是后台的）不另起——另起一个 --resume 同一个会话，Claude Code 会分叉出一份
    function resumeAndSend(text) {
      return ccFindL().then(function (x) {
        if (x && x.live && !(x.live.kind === "bg" && x.job)) throw new Error(tr("该会话正在另一个终端中运行（进程 " + x.live.pid + "），请在该终端中继续"));
        if (x && x.live) { info.live = x.live; info.job = x.job; emit("config"); return viaDaemon(text); }
        info.live = null; emit("config");
        return viaBg().then(function () { return viaDaemon(text); });
      });
    }
    function deliver(text) {
      text = unpad(text);
      if (!text.trim()) return false;
      // 送的经过记在这一句上：第一次送出的时刻、送了几次、最近一次（「未发送」那一行照它写）
      var mt = sendMeta[qnorm(text)] || (sendMeta[qnorm(text)] = {});
      mt.first = mt.first || Date.now(); mt.tries = (mt.tries || 0) + 1; mt.last = mt.t0 = Date.now(); mt.via = proc && proc.alive() ? "proc" : rt.elsewhere() ? "daemon" : "resume";
      // 正在送的这一句先记下来（同排着的，存在这台设备上）：送到了（sentBg / lqSent）才划掉——送的中间 App 退出、页面重新载入，下次打开接着送，
      //   不会凭空没了（记录里已经有了的 lqDrop 会划掉，不会重复）。以前只有排着的才记，直接送的一句在半路上 App 一退就丢了
      if (!lqSending) { lqSending = text; lqSave(); }
      if (rt.elsewhere()) {
        var started = function () { injecting = true; inj.push({ text: text, at: Date.now(), q: busy, cmd: /^\s*\//.test(text) }); emit("status"); };
        var done = function () { injecting = false; sentBg(text); }, failed = function (e) { injecting = false; unsentBg(text, e); };
        // 送不进它在的那个终端（关掉了 iTerm 的窗口、进程没了、AppleScript 被拦……）、或者以为它开在别的终端程序里：先再看一眼它现在在哪——
        //   不再开在终端里了（后台服务里有它、或者哪儿都没在跑）：从后台送（不依赖 iTerm）；还开在那个终端里：在 iTerm2 里只是这一次没送成的排着、
        //   写清楚为什么，不在 iTerm2 的写清楚它在哪个 App 里（cantReach）
        var recheck = function (e, inIterm) {
          ccFindL().then(function (x) {
            if (x && x.live && !(x.live.kind === "bg" && x.job)) { info.live = x.live; injecting = false; return inIterm ? unsentBg(text, e) : cantReach(text); }
            mt.via = "resume"; return resumeAndSend(text).then(done, failed);
          }, function () { failed(e); });
        };
        if (typable() || (info.live && info.live.kind !== "bg" && itermOK === null)) { // 自己的终端标签页 / iTerm2：直接敲进去；没试过 iTerm2 的先试一次
          started();
          var tried = typable(); mt.via = ownPane() ? "pane" : "iterm";
          termText(text).then(done, function (e) { recheck(e, tried || /控制 iTerm2/.test(e && e.message || "")); });
          return true;
        }
        if (rt.canInject()) {
          started();
          mt.via = "daemon"; viaDaemonOrResume(text).then(done, failed);
          return true;
        }
        // 以为它开在别的终端程序里：先再看一眼（它可能已经退了、或者其实在后台）
        started();
        recheck(new Error(tr("这个会话不在 Vibing Studio 能送达的地方运行")), false);
        return true;
      }
      // 没在跑的已有会话：不自己起 claude -p（那个进程只有这里接得上，Claude Code 的 agent 面板会被拒「running in another terminal」）——
      // 交给 Claude Code 的后台（claude --bg --resume，同一个会话 id）跑起来，再同后台会话一样经 claude attach 送进去：两边接的是同一个进程
      if ((!proc || !proc.alive()) && !(!path && info.fresh) && LOC.pty && LOC.exec) {
        injecting = true;
        inj.push({ text: text, at: Date.now(), q: busy, cmd: /^\s*\//.test(text) });
        emit("status");
        // 起之前再看一眼：刚在别的终端里打开、刚在后台起来的，就不另起——另起一个 --resume 同一个会话，Claude Code 会分叉出一个新的
        ccFindL().then(function (x) {
          if (x && x.live) {
            info.live = x.live; info.job = x.job || info.job; emit("config");
            if (x.live.kind === "bg" && info.job) return viaDaemon(text);
            throw new Error("该会话正在另一个终端中运行（进程 " + x.live.pid + "），请在该终端中继续，或关闭后在此继续");
          }
          return viaBg().then(function () { return viaDaemon(text); });
        }).then(function () { injecting = false; sentBg(text); }, function (e) { injecting = false; unsentBg(text, e); });
        return true;
      }
      if (!proc || !proc.alive()) {
        outBuf = "";
        // 新会话还没有记录：用这个 id 建出来（--session-id）；之后都是 --resume
        var mk = !path && info.fresh;
        if (mk) said = true;
        // 选过模型的带 --model（[1m] 原样）；它用的 agent（--agent）照带，换模型不丢
        var argv = ["claude", "-p", mk ? "--session-id" : "--resume", sid, "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"];
        if (modelSel) argv.push("--model", modelSel);
        if (modeSel) argv.push("--permission-mode", modeSel); // Shift+Tab 换过的权限模式
        if (info.agentSetting) argv.push("--agent", info.agentSetting);
        var mine = proc = LOC.proc({ argv: argv, cwd: info.cwd || "" }, function (s, isErr) {
          if (isErr) { if (/error/i.test(s)) rt.record("claude", s.trim().slice(0, 600)); return; }
          outBuf += s;
          var ls = outBuf.split("\n");
          outBuf = ls.pop();
          ls.forEach(function (l) {
            var j; try { j = JSON.parse(l); } catch (e) { return; }
            if (j.type === "rate_limit_event" && j.rate_limit_info) keepLimits(j.rate_limit_info); // 5 小时、7 天的限额用了多少（同 Claude Code 自己的状态行）
            if (j.type === "result") {
              resSeq = intSeq; // 打断（有的话）已经停下来了：别再当它没停、把进程停掉
              setBusy(false); poll();
              // 答完了：15 秒内没再说就关掉 stdin（stream-json 读到结尾，claude 写完记录自己退出）。一直开着会占着这个会话——
              // 用户在别的终端里打开它会被拒（「this session is running in another terminal」）；下一句再起一个 --resume 的就是
              clearTimeout(idleT);
              idleT = setTimeout(function () { if (proc === mine && !busy) { proc = null; dying = mine; try { mine.close(); } catch (e) { /* 已经停了 */ } setTimeout(function () { if (mine.alive()) try { mine.kill(); } catch (e) { /* 已经停了 */ } }, 8000); } }, 15000);
              if (j.is_error && j.result) rt.record("claude", String(j.result).slice(0, 600));
              if (restartAfter && proc === mine) { restartAfter = false; proc = null; dying = mine; try { mine.kill(); } catch (e) { /* 已经停了 */ } } // 这一问完了：换模型，下一句重新起
            }
          });
        }, function (code) { LIVE_PROCS.delete(mine); if (mine === dying) { dying = null; flushSoon(); } if (proc !== mine && proc) return; setBusy(false); proc = null; if (code && code !== 143) rt.record("claude", "Claude Code 已退出（" + code + "）"); });
        LIVE_PROCS.add(mine);
      }
      clearTimeout(idleT); // 又说了：别关
      if (hasImgs(text)) {
        var pw = proc, ps0 = imgParts(text), shots = ps0.filter(function (x) { return x.img; });
        Promise.all(shots.map(function (x) { return LOC.read(x.img).then(function (b) { return b64of(b); }, function () { return ""; }); })).then(function (datas) {
          var body = ps0.map(function (x) { return x.img ? "[Image #" + (x.no || "") + "]" : x.text; }).join(""), content = [{ type: "text", text: body }];
          shots.forEach(function (x, i) { if (datas[i]) content.push({ type: "image", source: { type: "base64", media_type: /\.png$/i.test(x.img) ? "image/png" : /\.gif$/i.test(x.img) ? "image/gif" : /\.webp$/i.test(x.img) ? "image/webp" : "image/jpeg", data: datas[i] } }); });
          if (pw && pw.alive()) pw.write(JSON.stringify({ type: "user", message: { role: "user", content: content } }) + "\n");
        });
      } else proc.write(JSON.stringify({ type: "user", message: { role: "user", content: text } }) + "\n");
      lqSent();
      if (!busy) newRound(Date.now()); // 新的一问：转圈那一行从现在算（不是上一问的开头）
      setBusy(true);
      setTimeout(poll, 300);
      return true;
    }
    // 排着的马上发（ctrl+enter，同 Claude Code 的「Enter to send them now」）：这边排着的几句（加上这一句）拼成一条，
    // 答着就先打断这一问（只打断一次：后台会话接上一次，按一下 Esc 接着就送），闲着就直接发
    rt.canSendNow = function () { return !!(proc && proc.alive()) || rt.canInject(); };
    rt.sendNow = function (text, imgs) {
      burst();
      if (imgs && imgs.length) return withImages(String(text || "").trim(), imgs, function (t) { rt.sendNow(t); });
      text = String(text || "").trim();
      if (rt.elsewhere() && !rt.canInject()) return text ? deliver(text) : false;
      if (text) lqAdd(text);
      lqHold = false;
      if (busy) return rt.interrupt();
      if (!lq.length) return false;
      flushSoon();
      return true;
    };
    // ---- 排着的马上发（点 send now、ctrl+x ctrl+s、空输入框 ctrl+enter）：同 Claude Code 2.1.281 的 chat:sendNow——
    //   它自己的队里排着的：它先试「不打断、直接塞进正在跑的这一轮」，塞不进才打断这一轮。这边就是在它那里按 ctrl+x ctrl+s，交给它自己做
    //   （以前这边按的是 Esc：每点一次打断一次，连点两下就成了它的「双击 Esc 回退」）。
    //   这边还没送进去的（没送成的、等着的）：先送进去再按。压缩着：不按——压缩完它自己接着发排着的；这时按，塞不进就会打断压缩。
    //   点一次就算：8 秒内（或者看到它读了）不再算第二次；点了排着的那几句马上画成在发
    function sendChord() {
      var p0 = typable() ? termKeys("sendnow") : rt.canInject() && info.job ? bgKeys("\x18\x13") : null;
      if (!p0) return;
      p0.then(function () { setTimeout(poll, 400); }, function (e) { qErr = tr("未能立即发送：" + String(e && e.message || e).split("\n")[0].slice(0, 200)); sendNowAt = 0; nowAt = 0; emit("status"); });
    }
    // null：没有排着的；compacting：在压缩（压完自动发）；sending：刚点过、在发；ready：能点
    rt.sendNowState = function () {
      var w = rt.pending().filter(function (q) { return !q.from && !q.err && !q.sys; });
      if (!w.length) return null;
      if (interrupting || injecting || Date.now() - sendNowAt < 8000) return "sending";
      if (!w.some(function (q) { return !q.sending; })) return null; // 都已经在发了（闲着时发的、刚送进去它马上读的）：没有排着的
      if (waiting && !(proc && proc.alive())) return "waiting"; // 它在等你处理对话框：处理完自动发
      if (rt.compacting) return "compacting";
      return "ready";
    };
    rt.sendNowError = function () { return qErr; };
    rt.sendQueuedNow = function () {
      burst();
      if (lqHold && lq.length && !(Date.now() - sendNowAt < 8000)) { sendNowAt = nowAt = Date.now(); chordAfter = !!busy; rt.retryQueued(); return "sent"; } // 没送成、还排着的：再送一次，送到了接着按
      var st = rt.sendNowState();
      if (st !== "ready") return st || "nothing";
      sendNowAt = nowAt = Date.now(); qErr = ""; emit("status");
      if (proc && proc.alive()) { lqHold = false; if (busy) rt.interrupt(); else flushSoon(); return "sent"; } // 自己起的 claude -p：没有它那一套队，只能打断这一问、接着发
      if (lq.length) { chordAfter = !!busy; rt.retryQueued(true); return "sent"; }
      if (busy) sendChord(); else flushSoon();
      // 按了「马上发」12 秒里它的队一点动静都没有（没读进去、没拿走）：这边挂着的那几句早就不在它队里了（比如已经并进别的消息发出去）——
      //   去掉，不留着让人一遍遍点
      var was = rt.pending().filter(function (q) { return !q.from && !q.sys && !q.local; }).map(function (q) { return qnorm(q.text); }), t0 = Date.now();
      setTimeout(function () { if (qopAt > t0) return; rt.pending().filter(function (q) { return !q.from && !q.sys && !q.local && was.indexOf(qnorm(q.text)) >= 0; }).forEach(function (q) { unqueue(q.text); }); emit("status"); }, 12000);
      return "sent";
    };
    // ctrl+enter 带着字：这句照常送（忙着就排进它的队），送到了马上按 ctrl+x ctrl+s。自己起的 claude -p 没有这一套：返回 false，照旧打断
    rt.sendNowAfter = function () { if (proc && proc.alive()) return false; chordAfter = !!busy; if (busy) { sendNowAt = nowAt = Date.now(); emit("status"); } return true; };
    // 没送成的再送一次（点「重试」、ctrl+enter、出错 4 秒后自己试一次）
    // 再送一次排着的（没送成的那几句）。auto：自己隔 4 秒再试的那一次（不算你的「手动重试」）
    rt.retryQueued = function (keep, auto) {
      if (!lq.length) return false;
      lq.forEach(function (x) { if (x.err) { if (!auto) x.manual = (x.manual || 0) + 1; delete x.err; } });
      lqHold = false; if (!keep) qErr = ""; lqSave(); emit("status");
      if (rt.elsewhere() && !rt.canInject() && info.live && info.live.kind !== "bg") { deliver(lqTake()); return true; } // iTerm2 里的、还没成功过一次的：照样先试 iTerm2
      flushSoon();
      return true;
    };
    // 能不能打断：自己起的、后台会话能；开在别的终端里的不能（那边的 Esc 才算）
    rt.canInterrupt = function () { return !!(proc && proc.alive()) || rt.canInject(); };
    // ---- 权限模式（同 Claude Code 最下面那一行：⏵⏵ bypass permissions on (shift+tab to cycle)）：记录里最近的 permission-mode，没有就是默认设置里的；
    // Shift+Tab 换：自己起的——正开着就经控制通道换，下一次起的带 --permission-mode；别处在跑的换不了（不显示「shift+tab to cycle」）----
    var MODES = ["default", "acceptEdits", "plan", "bypassPermissions"], modeSel = (function () { try { return (JSON.parse(localStorage.getItem("tsu-cc-mode") || "{}") || {})[sid] || ""; } catch (e) { return ""; } })();
    rt.permMode = function () { return modeSel || info.permMode || CC.defMode || "default"; };
    rt.canCycle = function () { return !rt.elsewhere() || typable(); };
    rt.cycleMode = function () {
      if (!rt.canCycle()) return false;
      if (rt.elsewhere()) { termKeys("stab").then(function () { setTimeout(function () { emit("status"); emit("config"); }, 600); }, function (e) { rt.record("shift+tab", e.message); }); return MODES[(MODES.indexOf(info.permMode || CC.defMode || "default") + 1) % MODES.length]; } // 开在自己终端标签页里的：敲 Shift+Tab（换成什么看它记下的 permission-mode）
      var m = MODES[(MODES.indexOf(rt.permMode()) + 1) % MODES.length];
      modeSel = m;
      try { var mm = JSON.parse(localStorage.getItem("tsu-cc-mode") || "{}") || {}; mm[sid] = m; localStorage.setItem("tsu-cc-mode", JSON.stringify(mm)); } catch (e) { /* 满了 */ }
      if (proc && proc.alive()) proc.write(JSON.stringify({ type: "control_request", request_id: "mode-" + Date.now(), request: { subtype: "set_permission_mode", mode: m } }) + "\n");
      emit("status"); emit("config");
      return m;
    };
    rt.limits = function () { return CC.limits; };
    rt.poke = function () { emit("status"); }; // 限额（状态行文件）变了：状态行重画
    // ← 打开的那一块（同 Claude Code 的 ← 视图）：它的后台会话（~/.claude/jobs/*/state.json，只读）分成「等你回复」「在干活」「已完成」，
    // 最前面是现在这个会话；右边一列是它的状态 / 最后一句
    rt.island = function () { return islandOf(sid, { busy: busy, fresh: info.fresh && !path, cwd: info.cwd, last: info.last }); };
    // 打断（Esc）：自己起的——控制通道说 interrupt，1.5 秒还没停就停掉进程；停下来以后（setBusy(false)）这边排着的拼成一条接着写进去。
    // 后台会话——经 claude attach 接上一次：按一下 Esc（同你接上它按 Esc），等它停下，这边排着的（有的话）拼成一条送进去；
    // 开在别的终端里的——做不到，返回 false（界面上也不写「esc to interrupt」）。闲着、这边还有排着的：直接发
    var interrupting = false, escAt = 0, escTook = false; // escAt / escTook：这边按 Esc 的时刻、按完有没有接着送一句
    // 占着这个会话的是一个没人管的「claude -p --resume <这个会话> --input-format stream-json」（这个 App 以前那一页起的、页面刷新后没收回来的）：
    //   停止 = 给它发 SIGINT（停下这一问），3 秒后还在就 SIGTERM。只认这种进程（按它的命令行、会话 id）；别的终端里你自己开的 claude 不碰
    function stopOrphan(why) {
      var pid = info.live && +info.live.pid;
      if (!pid || !LOC.exec) return Promise.resolve(false);
      return LOC.exec({ cmd: "ps -o command= -p " + pid }).then(function (r) {
        var cmd = String((r && (r.out || r.stdout)) || "");
        if (!/\bclaude\b.*\s-p\s.*--input-format stream-json/.test(cmd) || cmd.indexOf(sid) < 0) { rt.record("esc", why || tr("无法中断：该会话正在另一个终端中运行（进程 " + pid + "）")); return false; }
        return LOC.exec({ cmd: "kill -INT " + pid }).then(function () {
          setTimeout(function () { LOC.exec({ cmd: "kill -0 " + pid + " 2>/dev/null && kill -TERM " + pid + " || true" }); }, 3000);
          setBusy(false); setTimeout(refreshLive, 800); emit("status");
          return true;
        });
      }, function () { return false; });
    }
    // 刚发的这一问它还没回（记录里它后面什么都没有）：同 Claude Code，打断后这句退回输入框改——Claude Code 会把它从这一问里撤回、放回它自己的输入框
    function editable() { return !lq.length && cur && cur.ask !== undefined && cur.uuid && !(cur.parts || []).length && !cur.answer && !cur.error && !cur.stats ? cur : null; }
    // 打断以后看一眼记录：它记了「已打断」或者已经回了——没退回，照常；都没有——退回了：这边对话里拿掉这一句、放回这边的输入框（live.js 收 edit），
    //   它那边输入框里放回的那句清掉（ctrl+l），不然下一句会接在它后面拼成一句发出去（「每7天过期的应用好」+「Web是垃圾」）
    function backToInput(t, clearTheirs) {
      setTimeout(function () {
        poll();
        setTimeout(function () {
          if (t.error || (t.parts || []).length || t.answer || t.stats || turns.indexOf(t) < 0) return;
          rewound.add(t.uuid);
          try { sessionStorage.setItem(RWK, JSON.stringify(Array.from(rewound).slice(-50))); } catch (e) { /* 存不了就算了 */ }
          var i = turns.indexOf(t);
          turns.splice(i, 1);
          cur = turns[turns.length - 1] && turns[turns.length - 1].ask !== undefined ? turns[turns.length - 1] : null;
          forkN++;
          emit("reset"); emit("status");
          emit("edit", { text: t.ask || "", images: t.images || [] });
          if (clearTheirs) clearTheirs().catch(function () { /* 清不掉：下一句发出去时它会接在后面 */ });
        }, 900);
      }, 500);
    }
    rt.interrupt = function () {
      if (proc && proc.alive()) {
        if (!busy) { if (!lq.length) return false; lqHold = false; flushSoon(); return true; }
        proc.write(JSON.stringify({ type: "control_request", request_id: "int-" + Date.now(), request: { subtype: "interrupt" } }) + "\n");
        // 1.5 秒还没停下来（没等到 result）就停掉进程；停下来了、已经接着答排着的那条的——那是新的一问，不动它
        var p0 = proc, n0 = ++intSeq;
        setTimeout(function () { if (resSeq < n0 && busy && p0 === proc && p0.alive()) { proc = null; dying = p0; p0.kill(); setBusy(false); } }, 1500);
        lqHold = false;
        return true;
      }
      if (rt.elsewhere() && typable()) { // 开在自己终端标签页 / iTerm2 里的：在那里按一下 Esc；这边排着的停下后接着敲进去
        lqHold = false;
        if (!busy) { if (!lq.length) return false; flushSoon(); return true; }
        termKeys("esc").then(function () {
          var tk = lqTake();
          if (tk) { inj.push({ text: tk, at: Date.now(), q: false }); setTimeout(function () { termText(tk).then(function () { sentBg(tk); }, function (e) { unsentBg(tk, e); }); }, 600); }
          setTimeout(poll, 500);
        }, function (e) { rt.record("esc", tr("无法中断：") + e.message); });
        return true;
      }
      if (rt.elsewhere() && rt.canInject()) {
        lqHold = false;
        if (!busy) { if (!lq.length) return false; flushSoon(); return true; }
        if (interrupting) return true;
        interrupting = true; nowAt = Date.now(); emit("status"); // 点了马上发：排着的这几句立刻画成在发（不再是排队的样子、也不再写 send now），后台再去按 Esc
        var took = "";
        // 只用 attach 按一下 Esc（打断这一问）；排在它自己队里的，它停下来就接着读。这边还没送出去的，停下后经 daemon 的 reply 送进去（不再往输入框里打字）
        escAt = Date.now(); escTook = false;
        bgKeys("\x1b").then(function () {
          took = lqTake();
          if (!took) { interrupting = false; setTimeout(poll, 400); refreshLive(); return; }
          inj.push({ text: took, at: Date.now(), q: false });
          escTook = true;
          return viaDaemon(took).then(function () { interrupting = false; sentBg(took); });
        }).catch(function (e) {
          interrupting = false;
          if (took) unsentBg(took, e); else rt.record("esc", "无法中断后台会话：" + e.message);
        });
        return true;
      }
      // 开在别的终端里：先试 iTerm2（让它在那个会话里按 Esc）；不是 iTerm2 的，再看是不是没人管的后台驱动进程（停掉它这一问）
      if (rt.elsewhere() && busy && info.live && info.live.kind !== "bg") {
        viaIterm("esc").then(function () { setTimeout(poll, 500); }, function (e) { stopOrphan(e && e.message); });
        return true;
      }
      return false;
    };
    // 后台命令真的还在跑吗：它的输出文件（/private/tmp/claude-<uid>/<项目>/<会话>/tasks/<ID>.output）还有没有进程开着（lsof）。
    //   Claude Code 重启、会话换了进程以后，旧的命令早就没了，也不会再来「跑完了」的通知——不查的话一直挂着「在跑」（写着 11 running，它自己只有 1 shell）
    //   没人开着的：算已结束，结束时间取输出文件最后一次写入的时间
    var shellBusy = false, shellAt = 0;
    function shellAlive() {
      if (shellBusy || !LOC.exec || !path || Date.now() - shellAt < 15000) return;
      var run = rt.tasks.filter(function (t) { return t.kind === "shell" && t.status === "running" && /^\w+$/.test(t.id || "") && Date.now() - (t.t0 || 0) > 20000; });
      if (!run.length) return;
      shellBusy = true; shellAt = Date.now();
      var slug = path.split("/").slice(-2)[0].replace(/'/g, ""), fs = run.map(function (t) { return '"$D/' + t.id + '.output"'; }).join(" ");
      var cmd = "D=/private/tmp/claude-$(id -u)/'" + slug + "'/'" + sid.replace(/'/g, "") + "'/tasks; lsof -Fn -- " + fs + " 2>/dev/null; echo __M; stat -f '%m %N' " + fs + " 2>/dev/null; echo __END";
      LOC.exec({ cmd: cmd }).then(function (r) {
        shellBusy = false;
        var o = String((r && (r.out || r.stdout)) || ""), cut = o.indexOf("__M");
        if (cut < 0 || o.indexOf("__END") < 0) return;
        var open = {}, mt = {};
        o.slice(0, cut).split("\n").forEach(function (l) { if (l.charAt(0) === "n") open[l.slice(1).split("/").pop()] = true; });
        o.slice(cut).split("\n").forEach(function (l) { var m = /^(\d+) (.*)$/.exec(l); if (m) mt[m[2].split("/").pop()] = +m[1] * 1000; });
        var ch = false;
        run.forEach(function (t) {
          var f = t.id + ".output";
          if (open[f] || t.status !== "running") return;
          t.status = "done"; t.gone = true; t.end = mt[f] && mt[f] > (t.t0 || 0) ? mt[f] : Date.now(); t.ms = t.end - (t.resumedAt || t.t0 || t.end); ch = true;
        });
        if (ch) emit("tasks");
      }, function () { shellBusy = false; });
    }
    setInterval(function () { if (subs.length) shellAlive(); }, 5000);
    // 任务清单：~/.claude/tasks/<会话>/*.json（新版的 TaskCreate / TaskUpdate）
    setInterval(function () {
      if (!subs.length) return;
      var dir = LOC.info().home + "/.claude/tasks/" + sid;
      LOC.glob(dir + "/*.json").then(function (fs) {
        if (!fs || !fs.length) return;
        return Promise.all(fs.map(function (f) { return LOC.read(f).then(function (b) { try { return JSON.parse(new TextDecoder().decode(b)); } catch (e) { return null; } }, function () { return null; }); })).then(function (items) {
          var it = items.filter(function (x) { return x && x.subject && x.status !== "deleted"; }).sort(function (a, b) { return (+a.id || 0) - (+b.id || 0); }).map(function (x) { return { id: x.id, subject: x.subject, status: x.status, activeForm: x.activeForm }; });
          if (JSON.stringify(it) !== JSON.stringify(sess.todo.items)) { sess.todo.items = it; emit("tasks"); }
        });
      }).catch(function () {});
    }, 3000);
    refreshLive();
  }

  // 新开的、还没说第一句的会话（没有记录文件）：记着它的目录，刷新后标签页还在、说第一句时照样建在那里；有了记录就划掉
  var FRESH = "tsu-cc-fresh";
  var freshMap = function () { try { return JSON.parse(localStorage.getItem(FRESH) || "{}") || {}; } catch (e) { return {}; } };
  function freshKeep(sid, x) {
    var m = freshMap();
    if (x) m[sid] = { cwd: x.cwd || "", at: Date.now() }; else delete m[sid];
    Object.keys(m).forEach(function (k) { if (Date.now() - (m[k].at || 0) > 30 * 864e5) delete m[k]; });
    try { localStorage.setItem(FRESH, JSON.stringify(m)); } catch (e) { /* 满了 */ }
    return m;
  }
  // 刷新后（布局里记着 cc:<会话>）、搜索结果、左边栏：第一次用到时现建
  function ensure(sid, info) {
    var aid = "cc:" + sid, sub = /^sub-/.test(sid);
    if (!rts[aid]) {
      var fr = !info && !sub && freshMap()[sid];
      if (sub) { info = Object.assign({ sub: true, custom: true }, subMap()[sid] || {}, info || {}); subFind(sid, info); subRemember(sid, info); }
      rts[aid] = new Runtime(aid, Object.assign({ id: sid }, fr ? { cwd: fr.cwd, title: tr("新会话"), fresh: true } : {}, info || {}));
      if (sub) { readOnly(rts[aid]); subDelegate(rts[aid]); }
      A.registerExternal(aid, rts[aid]);
    } else if (info) { Object.assign(rts[aid].info, info); if (sub) subRemember(sid, rts[aid].info); }
    return rts[aid];
  }
  // 子 agent 的记录在哪、谁开的它：没给的从已经读进来的会话（主会话、别的子 agent）的任务里找
  function subFind(sid, info) {
    if (info.path) return;
    var id = sid.slice(4);
    Object.keys(rts).some(function (k) {
      var t = (rts[k].tasks || []).filter(function (x) { return x.kind === "agent" && x.id === id && x.transcript; })[0];
      if (!t) return false;
      info.path = t.transcript; info.parent = info.parent || rts[k].sid;
      if (!info.title) { info.title = "↳ " + (t.desc || t.type || id); info.agentName = info.agentName || t.desc || t.type || id; }
      return true;
    });
  }
  // 知道了它的记录在哪：记下（刷新后它的标签页照样打开；再往下一层的标签页先恢复出来时，也找得到它这个上一级）
  function subRemember(sid, info) { var m0 = subMap()[sid]; if (info.path && (!m0 || m0.path !== info.path || (!m0.parent && info.parent))) subKeep(sid, info); }
  // 子 agent 的记录（辅助侧栏里点一个子 agent 进去看）：cc:sub-<agentId>，读它自己的记录（<会话>/subagents/agent-<id>.jsonl）。
  //   只读：它不是一段能接着说的会话——不送话、不打断、不 claude --bg --resume（那会拿子 agent 的 id 去起一个后台会话）；
  //   打开过的记着记录在哪、叫什么（刷新后标签页还在，照样能打开）
  var SUBK = "tsu-cc-subs";
  var subMap = function () { try { return JSON.parse(localStorage.getItem(SUBK) || "{}") || {}; } catch (e) { return {}; } };
  function subKeep(sid, x) {
    var m = subMap();
    m[sid] = { path: x.path, title: x.title, agentName: x.agentName || "", cwd: x.cwd || "", parent: x.parent || "", at: Date.now() };
    Object.keys(m).forEach(function (k) { if (Date.now() - (m[k].at || 0) > 30 * 864e5) delete m[k]; });
    try { localStorage.setItem(SUBK, JSON.stringify(m)); } catch (e) { /* 满了 */ }
  }
  function readOnly(r) {
    var no = function (text) { r.record(String(text || "").trim() || "…", "这是子 agent 的记录（只读），在这里说不了话。要跟它说，回到主会话里说"); return false; };
    r.send = no;
    r.sendNow = function (text) { return String(text || "").trim() ? no(text) : false; };
    r.answerQuestion = function () { return Promise.reject(new Error(tr("子 Agent 的记录为只读"))); };
    r.takeQueued = function () { return null; };
    r.localQueued = function () { return 0; };
    ["interrupt", "canInject", "canSendNow", "canInterrupt", "canCycle", "cycleMode", "setModel"].forEach(function (k) { r[k] = function () { return false; }; });
    r.hint = function () { return tr("子 Agent 的记录 · 只读"); };
  }
  // 子 agent（再往下的也一样）的那段会话所在的主会话：顺着 parent 往上找；主会话还没建（刷新后先开的是子 agent 的标签页）就建起来
  function rootOf(r) {
    var pm = r && r.info && r.info.sub ? /\/([^/]+)\/subagents\/agent-[^/]+\.jsonl$/.exec(String(r.info.path || "")) : null;
    if (pm && !/^sub-/.test(pm[1])) return rts["cc:" + pm[1]] || ensure(pm[1]);
    var cur = r, n = 0;
    while (cur && cur.info && cur.info.sub && cur.info.parent && n++ < 8) {
      var par = String(cur.info.parent), next = rts["cc:" + par] || (!/^sub-/.test(par) || subMap()[par] ? ensure(par) : null);
      if (!next) return null;
      cur = next;
    }
    return cur && !(cur.info && cur.info.sub) ? cur : null;
  }
  // 子 agent 的弹窗（要权限、问你问题）画在主会话的界面里：子 agent 的标签页里照样看得见、答得了——
  //   它在问的（AskUserQuestion）答了经主会话送进去；别的弹窗（权限确认……）接上主会话的界面原样搬过来（live.js 的 cc 面板）。
  //   主会话「在等你」的状态也跟过来（子 agent 的标签页开着时，主会话照常跟着读）
  function subDelegate(r) {
    r.tuiRoot = function () { return rootOf(r) || r; };
    r.answerQuestion = function (text) { var root = rootOf(r); return root ? root.answerQuestion(text) : Promise.reject(new Error(tr("找不到它的主会话，在这里答不了"))); };
    r.waitingDialog = function () { var root = rootOf(r); return root && root.waitingDialog ? root.waitingDialog() : 0; };
    r.dialogClosed = function () { var root = rootOf(r); if (root && root.dialogClosed) root.dialogClosed(); };
    r.tui = function (c, rows, h) { var root = rootOf(r); return root && root.tui ? root.tui(c, rows, h) : null; };
    //   它在不在跑看它上一级的任务单：上一级也是子 agent 的，跟着读它的记录（不然它的任务单不动，这边一直「在跑」/ 一直停着）
    var on0 = r.on;
    r.on = function (fn) {
      var off = on0.call(r, fn), root = rootOf(r), offs = [];
      if (root && root !== r) offs.push(root.on(function (type) { if (type === "status" || type === "state") fn(type); }));
      var ps = String(r.info.parent || ""), par = /^sub-/.test(ps) ? rts["cc:" + ps] || (subMap()[ps] ? ensure(ps) : null) : null;
      if (par && par !== r && par !== root) offs.push(par.on(function () {}));
      return function () { off(); offs.forEach(function (f) { f(); }); };
    };
  }
  // 家谱里一个子 agent 的子 agent（studio.js 的「子 Agent」那一块往下一层）：在跑的跟着读它自己的记录（最多同时看 8 个）；
  //   跑完的读一遍就够（它开过的子 agent 不会再变；最多 60 个），读完重画一次
  var nestWatch = {}, nestRead = {};
  var famRedraw = function () { if (window.STUDIO && STUDIO.familyChanged) STUDIO.familyChanged(); };
  function subTasks(t, prt) {
    if (!t || t.kind !== "agent" || !t.id || !t.transcript) return [];
    var sid = "sub-" + t.id, aid = "cc:" + sid, r = rts[aid], run = t.status === "running";
    if (!r && (run ? Object.keys(nestWatch).length < 8 : Object.keys(nestRead).length < 60)) r = ensure(sid, { path: t.transcript, title: "↳ " + (t.desc || t.type || t.id), agentName: t.desc || t.type || t.id, cwd: (prt && prt.info && prt.info.cwd) || "", parent: prt ? prt.sid : "" });
    if (!r) return [];
    if (!r.info.path) { r.info.path = t.transcript; r.info.parent = r.info.parent || (prt ? prt.sid : ""); subRemember(sid, r.info); if (run) r.latest(); else delete nestRead[aid]; } // 早先建的、当时不知道记录在哪（没读出来）：补上再读
    if (run && !nestWatch[aid]) nestWatch[aid] = r.on(function (type) { if (type === "tasks") famRedraw(); });
    else if (!run && nestWatch[aid]) { nestWatch[aid](); delete nestWatch[aid]; nestRead[aid] = 1; } // 跟着读到它跑完：不用再读
    if (!run && !nestRead[aid]) { nestRead[aid] = 1; r.latest().then(famRedraw, function () {}); }
    // 不列它自己、不列它上面那几层：分出去的（fork）的记录开头抄着主会话的最后一段——连开它的那一下 Agent 调用（「Fork started」）也在里面，
    //   当成它自己又开了一个，就一层套一层（同一个 agent 画了五层）
    var up = {};
    for (var a = prt, k = 0; a && k < 8; k++) { if (a.sid) up[String(a.sid).replace(/^sub-/, "")] = 1; a = a.info && a.info.parent ? rts["cc:" + a.info.parent] : null; }
    return (r.tasks || []).filter(function (x) { return x.kind === "agent" && x.id !== t.id && !(t.toolUseId && x.toolUseId === t.toolUseId) && !up[x.id]; });
  }
  // 进去看一个子 agent（t：主会话 rt.tasks 里的那一条；prt：主会话）：开一个标签页，标题是它的说明（「↳ 说明」），已经开着就跳过去
  function openSub(t, prt, tw) {
    if (!t || !t.id || !t.transcript) return null;
    var sid = "sub-" + t.id, name = t.desc || t.type || t.id;
    var x = { path: t.transcript, title: "↳ " + name, agentName: name, cwd: (prt && prt.info && prt.info.cwd) || "", parent: prt ? prt.sid : "", sub: true, custom: true };
    subKeep(sid, x);
    ensure(sid, x);
    tw = tw || (window.TSU_TERM && TSU_TERM.front ? TSU_TERM.front() : null);
    return tw && tw.side && tw.side.viewCC ? tw.side.viewCC(sid, x) : null;
  }
  // 每段会话选的模型（记在这台设备上：刷新后下一句还用它）
  var modelMap = function () { try { return JSON.parse(localStorage.getItem("tsu-cc-model") || "{}") || {}; } catch (e) { return {}; } };
  function modelKeep(sid, id) { var m = modelMap(); m[sid] = id; try { localStorage.setItem("tsu-cc-model", JSON.stringify(m)); } catch (e) { /* 满了 */ } }
  var uuid = function () { return crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, function (c) { return (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16); }); };
  // 新会话（TSU_CONNECTORS.newSession("claude-code", 目录, 第一句?)）：先定好 id，开标签页；第一句用 claude -p --session-id <id> 在那个目录里建出来（同接着说的那条路）
  function newSession(cwd, prompt) {
    var sid = uuid(), x = { cwd: cwd, title: tr("新会话"), fresh: true, mtime: Date.now() };
    freshKeep(sid, x);
    var rt = ensure(sid, x), tw = window.TSU_TERM && TSU_TERM.front ? TSU_TERM.front() : null;
    var p = tw && tw.side && tw.side.viewCC ? tw.side.viewCC(sid, x) : null;
    if (prompt) rt.send(prompt);
    return { id: sid, aid: "cc:" + sid, pane: p || null };
  }
  // 这是「Claude Code」连接器：开着才接上（关着时 Vibing Studio 里没有 Claude Code 的任何东西，也不去读 ~/.claude）；在「设置 › 连接器」里开关马上生效
  // ======== 会话的标题（同 Claude Code 自己的）：它自己的标题（改过名的 custom-title、它起的 ai-title、summary）> 第一句真的话 >
  // 开头的斜杠命令（干净的「/cnb-model 参数」）> 只有 /exit、/login 这种杂事的：目录名 + 时间（淡的）。列表给的标题常是原样的 <command-name>… 标记，先就地清一遍，再读文件开头补准 ========
  var HOUSE = /^\/(exit|quit|login|logout|clear|resume|status|config|model|effort|help|cost|doctor|permissions|memory|compact|context|usage|stats|theme|vim|ide|agents|mcp|hooks|release-notes|upgrade|bug|feedback|fast|output-style|statusline|rename|add-dir|terminal-setup|privacy-settings)$/;
  var messy = function (t) { return /<\/?(command-name|command-message|command-args|local-command-stdout|local-command-caveat|system-reminder|bash-input|bash-stdout|bash-stderr)\b|^\s*Caveat:/.test(String(t || "")); };
  var tidy = function (t) { return String(t || "").replace(/<\/?[a-z][\w-]*(\s[^>]*)?>/gi, " ").replace(/\s+/g, " ").trim().slice(0, 80); };
  function cmdOf(t) {
    var n = /<command-name>\s*([^<]*?)\s*<\/command-name>/.exec(t), m = /<command-message>\s*([^<]*?)\s*<\/command-message>/.exec(t), a = /<command-args>\s*([^<]*?)\s*<\/command-args>/.exec(t);
    var name = n && n[1] ? n[1] : m && m[1] ? m[1] : "";
    return name ? ("/" + name.replace(/^\//, "") + (a && a[1].trim() ? " " + a[1].trim() : "")).replace(/\s+/g, " ").slice(0, 80) : "";
  }
  function cleanTitle(t) { return messy(t) ? cmdOf(t) || tidy(t) : tidy(t); }
  var chore = function (t) { return HOUSE.test(String(t || "").split(" ")[0]); }; // 只是杂事命令（/exit、/login……）
  // 后台会话（Claude Code 后台服务里的 job）是哪个 job：它在登记文件（~/.claude/sessions/<pid>.json）里自己写的 jobId。
  //   App 里按「会话 id 的前 8 位」找 ~/.claude/jobs/ 下的目录——job 里 /clear、换过会话以后会话 id 变了、job 还是原来那个，就找不到：
  //   找不到就当成「开在别的终端里」，话送不进去（还弹过「接管」）。这里照登记文件补上
  var jobByPid = {};
  function ccFindJ(id) {
    return LOC.ccFind(id).then(function (x) {
      if (!x || !x.live || x.live.kind !== "bg" || x.job || !LOC.read || !LOC.info) return x;
      var pid = +x.live.pid, k = pid + ":" + (x.live.since || "");
      if (jobByPid[k] !== undefined) { x.job = jobByPid[k]; return x; }
      return LOC.read(LOC.info().home + "/.claude/sessions/" + pid + ".json").then(function (b) {
        var j = null; try { j = JSON.parse(new TextDecoder().decode(new Uint8Array(b))); } catch (e) { j = null; }
        jobByPid[k] = j && j.sessionId === x.id && j.jobId ? String(j.jobId).replace(/[^\w-]/g, "") : "";
        x.job = jobByPid[k];
        return x;
      }, function () { return x; });
    });
  }
  function b64of(buf) { var u8 = new Uint8Array(buf), s = "", CH = 0x8000; for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); }
  function fallbackTitle(x) { var d = new Date(x.mtime || Date.now()); return (String(x.cwd || "").split("/").filter(Boolean).pop() || "~") + " · " + (d.getMonth() + 1) + "/" + d.getDate() + " " + d.toTimeString().slice(0, 5); }
  var TITLES = (function () { try { return JSON.parse(localStorage.getItem("tsu-cc-titles") || "{}") || {}; } catch (e) { return {}; } })(), titleBusy = 0, titleQ = [];
  // 读会话文件开头（最多 512KB，只读）找它自己的标题 / 第一句真的话
  function deepTitle(x) {
    var hit = TITLES[x.id];
    if (hit && (hit.m === x.mtime || hit.good)) return Promise.resolve(hit);
    return (x.path ? Promise.resolve(x) : LOC.ccFind(x.id)).then(function (f) {
      if (!f || !f.path) return null;
      return LOC.read(f.path, { offset: 0, max: 512 << 10 }).then(function (buf) {
        var custom = "", ai = "", summ = "", first = "", cmd = "";
        new TextDecoder().decode(new Uint8Array(buf)).split("\n").forEach(function (l) {
          if (l.length < 10) return;
          var j; try { j = JSON.parse(l); } catch (e) { return; }
          if (j.type === "custom-title" && j.customTitle) custom = j.customTitle;
          else if (j.type === "ai-title" && j.aiTitle) ai = j.aiTitle;
          else if (j.type === "summary" && j.summary) summ = j.summary;
          else if (j.type === "user" && !j.isMeta && !first) {
            var c = j.message && j.message.content, s = typeof c === "string" ? c : Array.isArray(c) && !c.some(function (b) { return b && b.type === "tool_result"; }) ? c.filter(function (b) { return b && b.type === "text"; }).map(function (b) { return b.text; }).join(" ") : "";
            if (!String(s).trim()) return;
            if (/<command-name>|<command-message>/.test(s)) { var cm = cmdOf(s); if (cm && !cmd && !chore(cm)) cmd = cm; return; }
            if (messy(s) || /^\s*</.test(s)) return;
            first = tidy(s);
          }
        });
        var t = tidy(custom || ai || summ) || first || cmd, r = { t: t || fallbackTitle(x), dim: !t, m: x.mtime, good: !!(custom || ai || summ || first) };
        TITLES[x.id] = r;
        try { localStorage.setItem("tsu-cc-titles", JSON.stringify(TITLES)); } catch (e) { /* 满了 */ }
        return r;
      });
    }).catch(function () { return null; });
  }
  // 列表里的每一项：就地清一遍；原样是标记、或者只是命令的，读文件补准（同时最多读 3 个；读完 changed() 一次）
  function titles(list, changed) {
    var todo = [];
    (list || []).forEach(function (x) {
      if (x.rawTitle === undefined) x.rawTitle = x.title || "";
      var hit = TITLES[x.id];
      if (!x.custom && hit && (hit.m === x.mtime || hit.good)) { x.title = hit.t; x.dimTitle = !!hit.dim; return; }
      x.title = x.custom ? tidy(x.rawTitle) : cleanTitle(x.rawTitle) || x.title;
      if (!x.custom && chore(x.title)) { x.title = fallbackTitle(x); x.dimTitle = true; } // 只是 /exit、/login 这种：先写目录名 + 时间，读了文件有更好的再换
      if (!x.custom && (messy(x.rawTitle) || /^\//.test(x.title) || x.dimTitle || !x.title)) todo.push(x);
    });
    seeNames(list);
    if (!todo.length) return;
    var left = todo.length, any = false, next = function () {
      var x = todo.shift();
      if (!x) return;
      deepTitle(x).then(function (r) { if (r && r.t && r.t !== x.title) { x.title = r.t; x.dimTitle = !!r.dim; any = true; seeNames([x]); } if (--left === 0 && any && changed) changed(); next(); });
    };
    for (var i = 0; i < 3; i++) next();
  }
  // ---- 同名的会话：Claude Code 允许几个会话起一样的名字（名字只是给人看的，认会话照样按 id）——列表、标签页、窗口标题、← 视图里
  //   名字后面淡淡地写上它的短 id（会话 id 前 8 位，同 claude attach、~/.claude/jobs/ 用的那个），分得清是哪一个；不重名的照旧。
  //   比名字：去掉首尾空白、不分大小写，-、–、— 算一样；在这边改过名的（st-claude-ext）按改的名字比。见过的会话：各处的列表（titles）、后台服务的 job
  var SEEN = {}, DUPX = null, DUPRAW = null;
  var nameKey = function (s) { return String(s || "").trim().replace(/\s+/g, " ").toLowerCase().replace(/[–—]/g, "-"); };
  // weak：只补还没见过的（后台服务的 job 名；列表里的标题为准）
  function seeNames(list, weak) {
    var ch = false;
    (list || []).forEach(function (x) {
      var id = x && String(x.id || x.sessionId || ""), n = x ? String(x.title || x.name || "").trim() : "";
      if (!id || !n || /^sub-/.test(id) || SEEN[id] === n || (weak && SEEN[id])) return;
      SEEN[id] = n; ch = true;
    });
    if (ch) DUPX = null;
  }
  function dupIndex() {
    var raw = ""; try { raw = localStorage.getItem("st-claude-ext") || ""; } catch (e) { /* 读不了：不算改过的名字 */ }
    if (DUPX && raw === DUPRAW) return DUPX;
    var ext = {}; try { ext = (JSON.parse(raw || "{}") || {}).name || {}; } catch (e) { ext = {}; }
    var by = {}, shown = function (id) { return ext["cc:" + id] || SEEN[id] || ""; };
    Object.keys(SEEN).forEach(function (id) { var k = nameKey(shown(id)); if (k) (by[k] = by[k] || []).push(id); });
    DUPRAW = raw; DUPX = { by: by, shown: shown };
    return DUPX;
  }
  // 这个会话名字后面要不要带短 id：name 是它现在显示的名字（不给就按见过的）；不重名回 ""
  function dupTag(id, name) {
    id = String(id || "");
    if (!id || /^sub-/.test(id)) return "";
    var I = dupIndex(), k = nameKey(name != null && String(name).trim() ? name : I.shown(id)), ids = k ? I.by[k] || [] : [];
    for (var i = 0; i < ids.length; i++) if (ids[i] !== id) return id.slice(0, 8);
    return "";
  }
  // 一打开就把后台服务里的 job（它们的名字）记上：列表还没读到的那几个也比得上
  (LOC.ready || Promise.resolve()).then(function () { if (LOC.list && LOC.info) setTimeout(function () { jobsNow().then(function (J) { seeNames((J.list || []).map(function (j) { return { id: j.sessionId, name: j.name }; }), true); }, function () {}); }, 2500); }, function () {});
  var API = { ensure: ensure, openSub: openSub, subTasks: subTasks, id: function (sid) { return "cc:" + sid; }, newSession: newSession, titles: titles, cleanTitle: cleanTitle, limits: function () { return CC.limits; }, autoCompact: function () { return CC.autoCompact !== false; },
    dupTag: dupTag, seeNames: seeNames };
  if (window.TSU_CONNECTORS && TSU_CONNECTORS.provide) TSU_CONNECTORS.provide("claude-code", { newSession: newSession });
  A.setExternalResolver(function (aid) { return window.TSU_CLAUDE ? ensure(aid.slice(3)) : null; });
  var EXT = window.TSU_EXT;
  window.TSU_CLAUDE = EXT && EXT.on("claude-code") ? API : null;
  if (EXT) EXT.watch(function (id, on) { if (id === "claude-code") window.TSU_CLAUDE = on ? API : null; });
})();
