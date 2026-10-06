// pi.js —— 连接器：这台电脑上的 pi（pi coding agent，命令 pi）的会话：~/.pi/agent/sessions/--<目录>--/<时间>_<会话 id>.jsonl。第三方扩展里的第一个。
//   看：读它的记录转成 Paimon 的对话（同 codex.js、claude.js 的 Runtime），任何外壳都能显示；只读最后一段（大文件也快），之后跟着读新追加的。
//     记录是一棵树（每条 id / parentId，/tree 回到前面接着说就分出一支）：只顺着现在这一支画——从最后写进来的那一条往回走到根
//   说：pi -p --mode json --session <记录文件> -- "<话>"（在会话的目录里跑；它照常把对话写回记录，这边跟着读出来）；Esc 打断（停掉那个进程）；
//     新会话：pi -p --mode json --session-id <新 uuid> -- "<第一句>"（id 事先定好，标签页、列表直接认这个 id）
//   id：pi:<会话 id>（agents.js 的外部运行时，前缀 pi）。列表：TSU_PI.list()（侧栏、Agent Finder 用），变了发 tsu-pi 事件
(function () {
  "use strict";
  var LOC = window.TSU_LOCAL, A = window.TSU_AGENTS, CON = window.TSU_CONNECTORS;
  if (!LOC || !A || !A.registerExternal) { window.TSU_PI = null; return; }
  var TAIL = 4 << 20;
  var home = function () { return (LOC.info() || {}).home || ""; };
  var root = function () { return home() + "/.pi/agent/sessions"; };
  var on = function () { return !!(CON && CON.on("pi")); };
  var ts = function (s) { var t = typeof s === "number" ? s : Date.parse(s || ""); return isNaN(t) ? Date.now() : t; };
  var dec = function (buf) { return new TextDecoder().decode(new Uint8Array(buf)); };
  var tr = function (s) { return window.TSU_I18N && TSU_I18N.t ? TSU_I18N.t(s) : s; };
  var clip = function (s, n) { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  var uuid = function () { return crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, function (c) { return (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16); }); };
  // 记录文件名：<时间>_<会话 id>.jsonl（id 一般是 uuid，--session-id 给的也可以是别的）
  var idOfFile = function (name) { var m = /^[^_]*_(.+)\.jsonl$/.exec(String(name || "").split("/").pop()); return m ? m[1] : ""; };
  // 一条消息里的字（字符串，或者 [{ type: "text", text }, { type: "image", data, mimeType }]）
  var textOf = function (c) { return typeof c === "string" ? c : (Array.isArray(c) ? c : []).filter(function (b) { return b && b.type === "text"; }).map(function (b) { return b.text || ""; }).join("\n"); };
  var imagesOf = function (c) { return (Array.isArray(c) ? c : []).filter(function (b) { return b && b.type === "image" && b.data; }).map(function (b) { return { media_type: b.mimeType || "image/png", data: b.data }; }); };
  // 附的图（粘贴、拖进来的截屏）：存成文件（同 codex.js），发话时 @路径 带上
  function saveShots(imgs) {
    if (!LOC.write) return Promise.resolve([]);
    var dir = home() + "/Library/Application Support/Vibing Studio/shots", stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
    return Promise.all(imgs.map(function (im, i) {
      var ext = /png/.test(im.media_type) ? "png" : /gif/.test(im.media_type) ? "gif" : /webp/.test(im.media_type) ? "webp" : "jpg", p = dir + "/shot-" + stamp + "-pi" + (i + 1) + "." + ext;
      var bin = atob(im.data), u8 = new Uint8Array(bin.length);
      for (var k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
      return LOC.write(p, u8).then(function () { return p; }, function () { return ""; });
    })).then(function (ps) { return ps.filter(Boolean); });
  }

  // ======== 会话列表 ========
  var LIST = [], byId = {}, heads = {}, scanning = null, lastScan = 0;
  try { heads = JSON.parse(localStorage.getItem("tsu-pi-heads") || "{}") || {}; } catch (e) { heads = {}; }
  // 上次扫到的列表（这台设备记着）：一载入就有，扫完一遍再换成新的
  try { LIST = (JSON.parse(localStorage.getItem("tsu-pi-list") || "[]") || []).filter(function (x) { return x && x.id; }); LIST.forEach(function (x) { byId[x.id] = x; }); } catch (e) { LIST = []; }
  var keptList = "", keepList = function () {
    try {
      var j = JSON.stringify(LIST.map(function (x) { return { id: x.id, conn: x.conn, path: x.path, size: x.size, mtime: x.mtime, cwd: x.cwd, model: x.model, title: x.title, dimTitle: x.dimTitle, named: x.named, last: String(x.last || "").slice(0, 400) }; }));
      if (j !== keptList) { keptList = j; localStorage.setItem("tsu-pi-list", j); }
    } catch (e) { /* 满了就不记 */ }
  };
  var saveHeads = function () { try { var k = Object.keys(heads); if (k.length > 600) k.slice(0, k.length - 600).forEach(function (x) { delete heads[x]; }); localStorage.setItem("tsu-pi-heads", JSON.stringify(heads)); } catch (e) { /* 满了就不记 */ } };
  var list = function (p) { return LOC.list(p).catch(function () { return []; }); };
  // 一段字里的整行（第一行、最后一行可能是半截：不要）→ 解析出来的那几条
  function entriesIn(txt, dropHead, dropTail) {
    var ls = txt.split("\n");
    if (dropHead) ls.shift();
    if (dropTail) ls.pop();
    var out = [];
    ls.forEach(function (l) { if (!l || l.length < 8) return; try { out.push(JSON.parse(l)); } catch (e) { /* 半行、坏行 */ } });
    return out;
  }
  // 开头：目录（会话头的 cwd）、id、第一句你说的话、模型；结尾：最近的名字（session_info）、最后一句它说的话。读到的记着（大小没变不再读）
  function readMeta(f) {
    var h = heads[f.path];
    if (h && h.size === f.size && h.v === 1) return Promise.resolve(h);
    var o = { v: 1, size: f.size, id: "", cwd: "", title: "", name: "", model: "", last: "" };
    return LOC.read(f.path, { offset: 0, max: Math.min(f.size, 96 << 10) }).then(function (b) {
      entriesIn(dec(b), false, f.size > (96 << 10)).forEach(function (e) {
        if (e.type === "session") { if (e.id) o.id = String(e.id); if (e.cwd) o.cwd = String(e.cwd); return; }
        if (e.type === "session_info") { o.name = e.name ? String(e.name) : ""; return; }
        var m = e.type === "message" && e.message;
        if (!m) return;
        if (m.role === "user" && !o.title) { var t = textOf(m.content).trim(); if (t) o.title = clip(t, 80); }
        if (m.role === "assistant" && m.model) o.model = m.model;
      });
      if (f.size <= (96 << 10)) return null;
      return LOC.read(f.path, { offset: Math.max(0, f.size - (64 << 10)), max: 64 << 10 }).then(function (b2) {
        entriesIn(dec(b2), true, false).forEach(function (e) {
          if (e.type === "session_info") o.name = e.name ? String(e.name) : "";
          var m = e.type === "message" && e.message;
          if (m && m.role === "assistant") { if (m.model) o.model = m.model; var t = textOf((m.content || []).filter(function (b) { return b && b.type === "text"; })).trim(); if (t) o.last = t; }
        });
      }, function () {});
    }).then(function () {
      if (!o.last && f.size <= (96 << 10)) { /* 小文件：最后一句已经在上面那一段里 */ }
      heads[f.path] = o;
      return o;
    }, function () { return o; });
  }
  // 小文件的最后一句：开头那一段里最后一条它说的话
  function lastOfSmall(f, o) {
    if (o.last || f.size > (96 << 10)) return Promise.resolve(o);
    return LOC.read(f.path, { offset: 0, max: f.size }).then(function (b) {
      entriesIn(dec(b), false, false).forEach(function (e) { var m = e.type === "message" && e.message; if (m && m.role === "assistant") { var t = textOf((m.content || []).filter(function (x) { return x && x.type === "text"; })).trim(); if (t) o.last = t; } if (e.type === "session_info") o.name = e.name ? String(e.name) : ""; });
      return o;
    }, function () { return o; });
  }
  // 标题：它的名字（/name、--name）> 第一句你说的话 > 目录名 + 时间（淡的）
  function titleOf(h, f) {
    if (h.name) return { t: clip(h.name, 80) };
    if (h.title) return { t: h.title };
    var d = new Date(f.mtime || Date.now());
    return { t: (String(h.cwd || "").split("/").filter(Boolean).pop() || "~") + " · " + (d.getMonth() + 1) + "/" + d.getDate() + " " + d.toTimeString().slice(0, 5), dim: true };
  }
  // 扫一遍：--<目录>-- 一层，里面的 .jsonl；最近 300 个读开头、结尾（有缓存）
  function scan(force) {
    if (!on()) { LIST = []; return Promise.resolve(LIST); }
    if (scanning) return scanning;
    if (!force && Date.now() - lastScan < 8000) return Promise.resolve(LIST);
    var r0 = root(), files = [];
    scanning = (LOC.ready || Promise.resolve()).then(function () { return list(r0); }).then(function (ds) {
      return Promise.all(ds.filter(function (d) { return d.dir; }).map(function (d) {
        return list(r0 + "/" + d.name).then(function (fs) { fs.forEach(function (f) { if (!f.dir && /\.jsonl$/.test(f.name)) files.push({ path: r0 + "/" + d.name + "/" + f.name, name: f.name, size: f.size, mtime: f.mtime }); }); });
      }));
    }).then(function () {
      files.sort(function (a, b) { return b.mtime - a.mtime; });
      files = files.slice(0, 300);
      return Promise.all(files.map(function (f) { return readMeta(f).then(function (h) { return lastOfSmall(f, h); }).then(function (h) { f.head = h; }); }));
    }).then(function () {
      saveHeads();
      var out = [], seen = {};
      files.forEach(function (f) {
        var h = f.head || {}, id = h.id || idOfFile(f.name);
        if (!id || seen[id]) return;
        seen[id] = 1;
        var tt = titleOf(h, f), x = { id: id, conn: "pi", path: f.path, size: f.size, mtime: f.mtime, cwd: h.cwd || "", model: h.model || "", title: tt.t || id.slice(0, 8), dimTitle: !!tt.dim, named: !!h.name, last: clip(h.last || "", 160) };
        var rt = rts["pi:" + id];
        if (rt && rt.busyNow && rt.busyNow()) x.live = { kind: "pi", status: "busy", since: f.mtime };
        else if (Date.now() - f.mtime < 20000) x.live = { kind: "pi", status: "busy", since: f.mtime }; // 刚写过：多半正在别处（终端里的 pi）跑着
        out.push(x);
      });
      LIST = out; byId = {};
      LIST.forEach(function (x) { byId[x.id] = x; });
      keepList();
      lastScan = Date.now(); scanning = null;
      document.dispatchEvent(new Event("tsu-pi"));
      return LIST;
    }).catch(function () { scanning = null; return LIST; });
    return scanning;
  }

  // ======== 工具：pi 自带的几样对到 Claude Code 那一套的名字（筛选、外壳都认），参数放进 input ========
  var TOOL = { read: "Read", bash: "Bash", edit: "Edit", write: "Write", grep: "Grep", find: "Glob", ls: "LS" };
  function toolPart(tc) {
    var name = String(tc.name || ""), a = tc.arguments && typeof tc.arguments === "object" ? tc.arguments : {}, mapped = TOOL[name] || name;
    var p = a.path || a.file_path || a.file || "";
    if (mapped === "Read") return { name: mapped, input: { file_path: p, offset: a.offset, limit: a.limit } };
    if (mapped === "Bash") return { name: mapped, input: { command: a.command || "", description: a.description || "" } };
    if (mapped === "Write") return { name: mapped, input: { file_path: p, content: a.content || "" } };
    if (mapped === "Edit") {
      var eds = Array.isArray(a.edits) ? a.edits : [{ oldText: a.oldText != null ? a.oldText : a.old_string, newText: a.newText != null ? a.newText : a.new_string }];
      return { name: mapped, input: { file_path: p, old_string: String((eds[0] || {}).oldText || ""), new_string: String((eds[0] || {}).newText || ""), edits: eds } };
    }
    if (mapped === "Grep" || mapped === "Glob") return { name: mapped, input: { pattern: a.pattern || "", path: p || a.dir || "" } };
    if (mapped === "LS") return { name: mapped, input: { path: p } };
    return { name: mapped, input: a };
  }
  // 工具的结果：字（图不画）；出错的记一句
  function result(p, m) {
    var txt = textOf(m.content), lines = txt.replace(/\r/g, "").split("\n");
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    p.secs = Math.max(0, Math.round((ts(m.timestamp) - (p.t0 || ts(m.timestamp))) / 1000));
    p.status = m.isError ? "error" : "done";
    if (m.isError) { p.error = (lines.filter(Boolean).slice(-1)[0] || "error").slice(0, 300); p.detail = lines.slice(0, 200); return; }
    if (p.name === "Edit") {
      var d = [], add = 0, del = 0;
      (p.input.edits || []).forEach(function (ed, i) {
        if (i) d.push({ t: "…" });
        String(ed.oldText || "").split("\n").forEach(function (l) { if (ed.oldText) { d.push({ t: "-", l: l }); del++; } });
        String(ed.newText || "").split("\n").forEach(function (l) { if (ed.newText) { d.push({ t: "+", l: l }); add++; } });
      });
      p.diff = d.slice(0, 400);
      p.summary = "Updated " + String(p.input.file_path || "file").split("/").pop() + " with " + add + " addition" + (add === 1 ? "" : "s") + " and " + del + " removal" + (del === 1 ? "" : "s");
      return;
    }
    if (p.name === "Write") { p.summary = "Wrote " + (String(p.input.content || "").split("\n").length) + " lines to " + String(p.input.file_path || "file").split("/").pop(); return; }
    if (p.name === "Read") { p.summary = "Read " + lines.length + " line" + (lines.length === 1 ? "" : "s"); return; }
    p.detail = lines.slice(0, 400);
  }

  // ======== 一段会话：同 codex.js 的 Runtime（每种外壳只认这些）========
  var rts = {};
  function Runtime(aid, info) {
    var rt = this, sid = aid.slice(3), subs = [], turns = [], sess = { id: sid, title: info.title || sid.slice(0, 8), turns: turns, todo: { items: [] }, ctx: 0, window: 0, updated: info.mtime || 0 };
    var agent = rt.agent = { id: aid, name: sess.title, effort: "", access: "rw", model: info.model || "", current: sid, goal: null, archived: false, claude: true, connector: "pi" };
    rt.info = info; rt.sid = sid; rt.label = "pi";
    var emit = function (t, d) { subs.slice().forEach(function (f) { try { f(t, d); } catch (e) { console.error(e); } }); };
    rt.on = function (fn) { subs.push(fn); if (subs.length === 1) start(); return function () { subs = subs.filter(function (f) { return f !== fn; }); if (!subs.length) stop(); }; };
    rt.fire = emit;
    rt.session = function () { return sess; };
    rt.stream = null; rt.tasks = []; rt.queued = null;
    rt.pendingMsgs = function () { return 0; };
    rt.pending = function () {
      sentWait = sentWait.filter(function (x) { return Date.now() - x.at < 600000; });
      return sentWait.map(function (x) { return { text: x.text, at: x.at, ours: true, sending: !x.q }; });
    };
    rt.takeQueued = function () { var q = rt.queued; rt.queued = null; emit("status"); return q; };
    rt.todo = function () { return sess.todo.items; };
    rt.state = function () { return busy ? "working" : "idle"; };
    rt.busyNow = function () { return busy; };
    rt.ctx = function () { var w = sess.window || 200000; return { tokens: sess.ctx, window: w, pct: sess.ctx / w * 100 }; };
    rt.home = rt.cwd = function () { return info.cwd || ""; };
    rt.cost = function () { return sess.cost || 0; };
    rt.tail = function () { return info.last || ""; };
    rt.maybeRecap = rt.recap = function () {};
    rt.record = function (cmd, res) { var t = { cmd: cmd, note: tr(res), at: Date.now(), local: true }; turns.push(t); emit("append", t); };
    ["setEffort", "setAccess", "rename", "setGoal", "clearGoal", "clear", "resume", "bang", "detachBash", "stopTask", "wakeUp", "receive", "afterReload"].forEach(function (k) { rt[k] = function () { return false; }; });
    rt.turnOf = function () { return null; };
    rt.historical = function () { return false; };
    rt.more = function () { return false; };
    rt.earlier = function () { return Promise.resolve(false); };
    rt.later = function () { return Promise.resolve(false); };
    rt.latest = function () { return load(); };
    rt.agentName = function () { return ""; };
    rt.canCycle = function () { return false; };
    rt.limits = function () { return null; };
    rt.hint = function () { return ""; };

    // ---- 读记录：树（id / parentId）——只顺着现在这一支画：从最后一条往回走到根 ----
    var offset = 0, pollT = 0, cur = null, byCall = {}, loading = null;
    var all = [], byEntry = {}, leaf = "", lastEntry = null;
    var sentWait = [];
    var wnorm = function (t) { return String(t || "").replace(/\s+/g, ""); };
    function finishTurn() { if (cur && cur.last && !cur.stats && cur.at && !pendingTools(cur)) cur.stats = { secs: Math.max(1, Math.round((cur.last - cur.at) / 1000)), verb: "Worked", at: cur.last, auto: true }; }
    var pendingTools = function (t) { return (t.parts || []).some(function (q) { return q.kind === "tool" && q.status === "running"; }); };
    function dropSent(text, at) {
      if (!sentWait.length) return;
      var k = wnorm(text), hit = -1;
      sentWait.forEach(function (x, i) { if (hit >= 0) return; var w = wnorm(x.text); if (w === k || (w && k && (k.indexOf(w) >= 0 || w.indexOf(k) >= 0))) hit = i; });
      if (hit < 0 && at && at >= sentWait[0].at - 3000) hit = 0;
      if (hit >= 0) sentWait.splice(hit, 1);
    }
    function newTurn(text, at, imgs) { finishTurn(); cur = { ask: text, images: imgs || [], parts: [], at: at }; turns.push(cur); if (rt.stream) rt.stream.turn = cur; dropSent(text, at); return cur; }
    function ensureTurn(at) { if (!cur) { cur = { ask: "", parts: [], at: at, cont: true }; turns.push(cur); if (rt.stream && !rt.stream.turn.at) rt.stream.turn = cur; } return cur; }
    // 一条记录 → 画进对话（返回动过的那一问）
    function feedEntry(e) {
      var at = ts(e.timestamp);
      if (e.type === "session") { if (e.cwd) info.cwd = e.cwd; return null; }
      if (e.type === "session_info") { if (e.name) { sess.title = agent.name = String(e.name); emit("config"); } return null; }
      if (e.type === "model_change") { if (e.modelId) agent.model = e.modelId; return null; }
      if (e.type === "thinking_level_change") { agent.effort = e.thinkingLevel || ""; return null; }
      if (e.type === "compaction") { finishTurn(); cur = null; var c = { compact: { summary: String(e.summary || "").trim(), pre: e.tokensBefore || 0, post: 0, msgs: 0, trigger: "" }, at: at }; turns.push(c); return c; }
      if (e.type === "branch_summary") { finishTurn(); cur = null; var bs = { compact: { summary: String(e.summary || "").trim(), pre: 0, post: 0, msgs: 0, trigger: "branch" }, at: at }; turns.push(bs); return bs; }
      if (e.type === "custom_message") { if (!e.display) return null; var cm = { note: clip(textOf(e.content), 2000), at: at }; turns.push(cm); return cm; }
      if (e.type !== "message" || !e.message) return null;
      var m = e.message, mat = m.timestamp ? ts(m.timestamp) : at;
      if (m.role === "user") {
        var txt = textOf(m.content), imgs = imagesOf(m.content);
        if (!txt.trim() && !imgs.length) return null;
        return newTurn(txt, mat, imgs);
      }
      if (m.role === "bashExecution") { finishTurn(); cur = null; var b = { bash: String(m.command || ""), out: String(m.output || "").trim(), code: m.cancelled ? 130 : m.exitCode == null ? null : m.exitCode, at: mat }; turns.push(b); return b; }
      if (m.role === "assistant") {
        if (m.model) agent.model = m.model;
        var u = m.usage || {};
        if (u.input || u.cacheRead || u.output) sess.ctx = (u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0) + (u.output || 0);
        if (u.cost && u.cost.total) sess.cost = (sess.cost || 0) + u.cost.total;
        var t = ensureTurn(mat);
        (Array.isArray(m.content) ? m.content : []).forEach(function (bl) {
          if (!bl) return;
          if (bl.type === "text" && String(bl.text || "").trim()) t.parts.push({ kind: "text", text: String(bl.text), whole: true, at: mat });
          else if (bl.type === "thinking" && String(bl.thinking || "").trim()) { t.thinking = (t.thinking ? t.thinking + "\n\n" : "") + bl.thinking; t.thought = Math.max(t.thought || 1, Math.round((mat - t.at) / 1000)); }
          else if (bl.type === "toolCall") {
            var tp = toolPart(bl), part = { kind: "tool", name: tp.name, input: tp.input || {}, status: "running", id: bl.id, t0: mat, turn: t };
            if (bl.id) byCall[bl.id] = part;
            t.parts.push(part);
          }
        });
        if (m.stopReason === "error") t.error = String(m.errorMessage || "error").slice(0, 600);
        if (m.stopReason === "aborted") { t.error = "Interrupted by user"; (t.parts || []).forEach(function (q) { if (q.kind === "tool" && q.status === "running") q.status = "done"; }); }
        t.last = mat;
        if (m.stopReason && m.stopReason !== "toolUse" && m.stopReason !== "pending") { t.done = true; finishTurn(); }
        return t;
      }
      if (m.role === "toolResult") {
        var pp = byCall[m.toolCallId];
        if (!pp) return null;
        result(pp, m);
        if (pp.turn) pp.turn.last = mat;
        return pp.turn;
      }
      return null; // system（系统提示、工具清单）、custom（不显示的）、别的
    }
    // 现在这一支：从 leaf 往回走到根（窗口外的祖先读不到就到此为止）
    function branch() {
      var path = [], seen = {}, k = leaf;
      while (k && byEntry[k] && !seen[k]) { seen[k] = 1; path.push(byEntry[k]); k = byEntry[k].parentId; }
      path.reverse();
      return path;
    }
    function rebuild() {
      turns.length = 0; cur = null; byCall = {};
      var head = all.filter(function (e) { return e.type === "session"; })[0];
      if (head) feedEntry(head);
      branch().forEach(feedEntry);
      finishTurn();
      // 记录里停在半截的工具调用（没有结果）：不在跑就画成做完了
      if (!busy && !(Date.now() - (sess.updated || 0) < 60000)) turns.forEach(function (t) { (t.parts || []).forEach(function (q) { if (q.kind === "tool" && q.status === "running") q.status = "done"; }); });
    }
    function addEntry(e) { all.push(e); if (e.id) { byEntry[e.id] = e; leaf = e.id; lastEntry = e; } else if (e.type === "session") lastEntry = lastEntry || e; }
    function withPath() {
      if (info.path) return Promise.resolve(info.path);
      return scan(true).then(function () { var x = byId[sid]; if (!x) throw new Error(info.fresh ? "" : "找不到 pi 会话：" + sid); Object.assign(info, x); info.fresh = false; sess.title = agent.name = x.title || sess.title; agent.model = x.model || agent.model; return info.path; });
    }
    var gen = 0, loadingNow = false, pollBusy = false, pollAgain = false;
    function linesOf(buf, dropHead) {
      var u8 = new Uint8Array(buf), a = 0;
      if (dropHead) { var i = u8.indexOf(10); a = i < 0 ? u8.length : i + 1; }
      var j = u8.lastIndexOf(10), end = j + 1 > a ? j + 1 : a;
      return { end: end, lines: end > a ? dec(u8.subarray(a, end)).split("\n") : [] };
    }
    var parse = function (l) { if (!l || l.length < 8) return null; try { return JSON.parse(l); } catch (e) { return null; } };
    function load() {
      var g = ++gen;
      loadingNow = true;
      loading = withPath().then(function (pth) { return LOC.stat(pth); }).then(function (st) {
        if (g !== gen) return;
        if (!st) throw new Error("会话记录不存在");
        var size = st.size, start0 = size > TAIL ? size - TAIL : 0;
        return LOC.read(info.path, { offset: start0, max: size - start0 }).then(function (buf) {
          if (g !== gen) return;
          all = []; byEntry = {}; leaf = ""; lastEntry = null;
          var r = linesOf(buf, start0 > 0);
          r.lines.forEach(function (l) { var e = parse(l); if (e) addEntry(e); });
          offset = start0 + r.end;
          sess.updated = st.mtime;
          rebuild();
          emit("reset"); emit("status"); emit("config");
          liveBusy();
        });
      }).catch(function (e) { if (g !== gen) return; turns.length = 0; if (e && e.message) turns.push({ note: tr("无法读取会话：" + e.message), at: 0 }); emit("reset"); })
        .then(function () { if (g === gen) loadingNow = false; });
      return loading;
    }
    function poll() {
      if (!info.path || loadingNow) return;
      if (pollBusy) { pollAgain = true; return; }
      pollBusy = true;
      var g = gen;
      LOC.stat(info.path).then(function (st) {
        if (g !== gen || !st) return;
        if (st.size < offset) return load(); // 文件变短了（被改写）：重建
        if (st.size <= offset) { liveBusy(); return; }
        return LOC.read(info.path, { offset: offset, max: Math.min(st.size - offset, TAIL) }).then(function (buf) {
          if (g !== gen) return;
          var r = linesOf(buf, false);
          if (!r.end) { if (buf.byteLength >= TAIL) offset += buf.byteLength; return; }
          offset += r.end;
          sess.updated = st.mtime;
          var fresh = r.lines.map(parse).filter(Boolean), branched = false;
          // 接在现在这一支末尾的：照常接上；接到别处的（/tree 回到前面接着说）：整段按新的这一支重画
          fresh.forEach(function (e) { if (e.id && leaf && e.parentId !== leaf) branched = true; addEntry(e); }); // parentId 为 null：又起了一个根（同样整段重画）
          if (branched) { rebuild(); emit("reset"); emit("status"); liveBusy(); return; }
          var before = turns.length, touched = new Set();
          fresh.forEach(function (e) { var t = feedEntry(e); if (t) touched.add(t); });
          turns.slice(before).forEach(function (t) { touched.delete(t); emit("append", t); });
          touched.forEach(function (t) { emit("turn", t); });
          emit("status");
          liveBusy();
        });
      }).catch(function () {}).then(function () { pollBusy = false; if (pollAgain) { pollAgain = false; setTimeout(poll, 0); } });
    }
    function start() { if (!loading) load(); clearInterval(pollT); pollT = setInterval(poll, 700); }
    function stop() { clearInterval(pollT); pollT = 0; }

    // ---- 在跑吗：自己起的 pi 进程；或者记录停在一问的中间（最后一条是你说的话 / 要调工具 / 工具结果）而且文件一分钟内写过（在终端里的 pi 跑着）----
    var busy = false, proc = null, outBuf = "", sentAt = 0;
    var ticker = 0;
    function tickOn() { if (ticker) return; ticker = setInterval(function () { if (!busy) { clearInterval(ticker); ticker = 0; return; } if (document.hidden) return; emit("tick"); }, 120); }
    function setBusy(v) {
      if (v === busy) return;
      busy = v;
      if (v) tickOn();
      if (v) rt.stream = { t0: Date.now(), turn: cur && !cur.stats ? cur : { parts: [] }, outTokens: 0, thinking: false, firstAt: Date.now(), verb: "Working", answer: "", ctl: { abort: function () { rt.interrupt(); } } };
      else { rt.stream = null; finishTurn(); if (cur) emit("turn", cur); }
      emit("status"); emit("state");
    }
    function midTurn() {
      var m = lastEntry && lastEntry.type === "message" && lastEntry.message;
      if (!m) return false;
      return m.role === "user" || m.role === "toolResult" || (m.role === "assistant" && m.stopReason === "toolUse");
    }
    function liveBusy() { if (proc && proc.alive()) return; setBusy((midTurn() && Date.now() - (sess.updated || 0) < 60000) || Date.now() - sentAt < 10000); }
    rt.elsewhere = function () { return !(proc && proc.alive()) && busy; };
    rt.canInject = function () { return true; };
    rt.canInterrupt = function () { return !!(proc && proc.alive()); };
    rt.canSendNow = rt.canInterrupt;
    // 模型：真在用的是记录里最近一条回答的；这边选的（--model，下一句起）记在这台设备上
    var modelSel = piModels()[sid] || "";
    rt.model = function () { var real = agent.model || "", pending = !!modelSel && !!real && modelSel.split("/").pop() !== real, id = pending ? modelSel : real || modelSel; return { id: id, name: pending ? tr((id || "pi") + " · 下一句起") : (id || "pi"), window: sess.window || 200000, pending: pending }; };
    rt.models = function () {
      var ids = [], add = function (x) { if (x && ids.indexOf(x) < 0) ids.push(x); };
      add(agent.model); add(modelSel); LIST.forEach(function (x) { add(x.model); });
      return ids.map(function (id) { return { id: id, name: id, desc: "" }; });
    };
    rt.setModel = function (id) { id = String(id || "").trim(); if (!id) return false; modelSel = id; piModelKeep(sid, id); emit("config"); emit("status"); return true; };
    // 附的图（[Image: "…"]，见 rt.send）→ @路径，话里去掉
    function takeShots(text) { var ims = []; text = String(text || "").replace(/\[Image: "([^"\n]+)"\] ?/g, function (all0, p) { ims.push("@" + p); return ""; }).trim(); return { text: text || (ims.length ? "(image)" : ""), args: ims }; }
    function runPi(text) {
      outBuf = "";
      var sh = takeShots(text), fresh = !info.path;
      var argv = ["pi", "-p", "--mode", "json"].concat(fresh ? ["--session-id", sid] : ["--session", info.path], modelSel ? ["--model", modelSel] : [], ["--"], sh.args, [sh.text]);
      var mine = proc = LOC.proc({ argv: argv, cwd: info.cwd || home() }, function (s, isErr) {
        if (isErr) { if (/\berror\b/i.test(s) && !/^\s*(WARN|INFO|\[)/.test(s)) rt.record("pi", s.trim().slice(0, 600)); return; }
        outBuf += s;
        var ls = outBuf.split("\n");
        outBuf = ls.pop();
        ls.forEach(function (l) {
          var j = parse(l.replace(/\r$/, ""));
          if (!j) return;
          if (j.type === "session" && fresh && !info.path) setTimeout(findNew, 300); // 建出来了：找它的记录文件接着读
          if (j.type === "message_update" && j.usage && j.usage.output && rt.stream) rt.stream.outTokens = j.usage.output;
          if (j.type === "auto_retry_end" && j.success === false) rt.record("pi", String(j.finalError || "error").slice(0, 600));
          if (j.type === "message_end" && j.message && j.message.role === "assistant" && j.message.stopReason === "error") { /* 记录里也会有：那边画 */ }
        });
      }, function (code) {
        if (proc !== mine && proc) return;
        proc = null; setBusy(false);
        if (fresh && !info.path) findNew(); else poll();
        if (code && code !== 143 && code !== 130 && code !== 15) rt.record("pi", tr("pi 已退出（" + code + "）"));
        if (rt.queued) { var q = rt.queued; rt.queued = null; emit("status"); setTimeout(function () { rt.send(q.text); }, 300); } // 排着的（几句拼成的一条）一次发出去
      });
      eof(proc);
      setBusy(true);
      setTimeout(poll, 400);
    }
    // 新会话：说了第一句以后，按 id 找它的记录文件（--session-id 定好的 id 在文件名里），找到就接着读
    function findNew() {
      var tries = 0, look = function () {
        scan(true).then(function () {
          var x = byId[sid];
          if (!x) { if (++tries < 15) setTimeout(look, 1200); return; }
          Object.assign(info, x); info.fresh = false; sess.title = agent.name = x.title || sess.title;
          newKeep(sid, null);
          load(); emit("config");
        });
      };
      look();
    }
    // pi 的 stdin 是接着的管道时会读到头（把读到的接在话前面）：起来就关掉，不然它一直等着
    function eof(p) { if (p && p.close && p.started) p.started.then(function () { p.close(); }, function () {}); }
    rt.send = function (text, imgs) {
      text = String(text || "").trim();
      imgs = (imgs || []).filter(function (x) { return x && x.data; });
      if (imgs.length) { saveShots(imgs).then(function (ps) { rt.send(ps.map(function (p) { return '[Image: "' + p + '"]'; }).join(" ") + (ps.length && text ? " " : "") + text); }); return true; }
      if (!text) return false;
      if (proc && proc.alive()) { rt.queued = rt.queued ? { text: rt.queued.text + "\n\n" + text } : { text: text }; emit("status"); return true; } // 这边起的那一问还没完：排着，完了一次发出去
      sentWait.push({ text: takeShots(text).text, at: Date.now(), q: false }); emit("status");
      sentAt = Date.now();
      runPi(text);
      return true;
    };
    rt.interrupt = function () { if (proc && proc.alive()) { proc.kill(); return true; } return false; };
    rt.sendNow = function (text, imgs) {
      text = String(text || "").trim();
      if (text) rt.queued = rt.queued ? { text: rt.queued.text + "\n\n" + text } : { text: text };
      if (rt.interrupt()) { emit("status"); return true; }
      if (!rt.queued) return false;
      var q = rt.queued; rt.queued = null; emit("status");
      return rt.send(q.text, imgs);
    };
    // / 命令：pi 自己的命令大多只在它的终端界面里有；这边做得了的几个（/new、/session），别的说清楚
    rt.command = function (line) {
      var m = /^\/(\S+)\s*([\s\S]*)$/.exec(String(line || "").trim());
      if (!m) return false;
      var c = m[1].toLowerCase(), say = function (res) { rt.record(line, res); };
      switch (c) {
        case "new": case "clear": newSession(info.cwd || home()); return true;
        case "model":
          if (!m[2].trim()) { say("Model: " + (rt.model().id || "default") + " · /model <provider/model> to change (from the next message)"); return true; }
          rt.setModel(m[2].trim()); say("Set model to " + m[2].trim() + " (from the next message)"); return true;
        case "session":
          say(["Session: " + (info.path ? sid : "not started yet"), "File: " + String(info.path || "—").replace(home(), "~"), "Directory: " + String(info.cwd || home()).replace(home(), "~"), "Model: " + (agent.model || "default"), sess.ctx ? "Context: " + Math.round(sess.ctx / 1000) + "k tokens" : "", sess.cost ? "Cost: $" + sess.cost.toFixed(4) : ""].filter(Boolean).join("\n"));
          return true;
        case "exit": case "quit": return false;
      }
      say(tr("这条命令只能在 pi 自己的终端界面里用：/" + c));
      return true;
    };
    rt.island = function () {
      var me = { id: sid, name: "current session", current: true, st: busy ? "working" : "needs", at: Date.now(), cwd: info.cwd || "", title: info.title || "", right: !info.path ? "send a prompt to start" : busy ? "working" : clip(info.last || "send a prompt to continue", 200) };
      var needs = busy ? [] : [me], working = busy ? [me] : [], done = [];
      LIST.forEach(function (x) {
        if (x.id === sid) return;
        var it = { id: x.id, name: x.title, cwd: x.cwd || "", at: x.mtime || 0, st: x.live ? "working" : "done", right: clip(x.last || "", 200) };
        if (x.live) working.push(it); else if (done.length < 15) done.push(it);
      });
      return Promise.resolve({ groups: [{ title: "Needs input", items: needs }, { title: "Working", items: working }, { title: "Completed", items: done }].filter(function (g) { return g.items.length; }), running: working.length - (busy ? 1 : 0) });
    };
  }
  // 每段会话选的模型（--model）
  var piModels = function () { try { return JSON.parse(localStorage.getItem("tsu-pi-model") || "{}") || {}; } catch (e) { return {}; } };
  function piModelKeep(sid, id) { var m = piModels(); m[sid] = id; try { localStorage.setItem("tsu-pi-model", JSON.stringify(m)); } catch (e) { /* 满了 */ } }
  // 新开、还没说第一句的会话：记着目录（刷新后标签页还在，照样能说第一句）
  var NEWS = "tsu-pi-new";
  var newMap = function () { try { return JSON.parse(localStorage.getItem(NEWS) || "{}") || {}; } catch (e) { return {}; } };
  function newKeep(sid, o) {
    var m = newMap();
    if (o) m[sid] = Object.assign({ at: Date.now() }, o); else delete m[sid];
    Object.keys(m).forEach(function (k) { if (Date.now() - (m[k].at || 0) > 30 * 864e5) delete m[k]; });
    try { localStorage.setItem(NEWS, JSON.stringify(m)); } catch (e) { /* 满了 */ }
  }
  function ensure(sid, info) {
    var nw = newMap()[sid];
    if (nw && !info && !byId[sid]) info = { cwd: nw.cwd || "", title: tr("新会话"), fresh: true };
    var aid = "pi:" + sid, x = byId[sid] || {};
    if (!rts[aid]) { rts[aid] = new Runtime(aid, Object.assign({ id: sid }, x, info || {})); A.registerExternal(aid, rts[aid]); }
    else if (info) Object.assign(rts[aid].info, info);
    return rts[aid];
  }
  // 新会话（TSU_CONNECTORS.newSession("pi", 目录, 第一句?)）：id 现在就定（--session-id），开标签页；第一句说出去时 pi 在那个目录里建出记录
  function newSession(cwd, prompt) {
    var sid = uuid(), x = { cwd: cwd || home(), title: tr("新会话"), fresh: true, mtime: Date.now() };
    newKeep(sid, { cwd: x.cwd });
    var rt = ensure(sid, x), tw = window.TSU_TERM && TSU_TERM.front ? TSU_TERM.front() : null;
    var p = tw && tw.side && tw.side.viewPI ? tw.side.viewPI(sid, x) : null;
    if (prompt) rt.send(prompt);
    return { id: sid, aid: "pi:" + sid, pane: p || null };
  }
  // 刷新后（布局里记着 pi:<会话>）、搜索、侧栏：第一次用到时现建（还没扫到的：先扫一遍再找它的文件）
  A.setExternalResolver(function (aid) { return on() ? ensure(aid.slice(3)) : null; }, "pi");
  var API = { list: function () { return LIST; }, refresh: scan, ensure: ensure, id: function (sid) { return "pi:" + sid; }, get: function (sid) { return byId[sid] || null; }, newSession: newSession, real: function (sid) { return sid; } };
  if (CON && CON.provide) CON.provide("pi", { newSession: newSession });
  window.TSU_PI = on() ? API : null;
  if (CON) CON.watch(function (id, v) { if (id !== "pi") return; window.TSU_PI = v ? API : null; if (v) scan(true); else { LIST = []; document.dispatchEvent(new Event("tsu-pi")); } });
  if (on()) setTimeout(function () { scan(true); }, 1500);
  setInterval(function () { if (on() && !document.hidden) scan(); }, 10000);
})();
