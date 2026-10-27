// teyvat.js —— 连接器：这台电脑上的 Teyvat（命令 genshin；里面每个 agent 叫 Paimon；数据在 ~/.teyvat）。
//   不改 Teyvat 自己的任何文件、不往它的收件箱里塞消息、不往终端里送键：只读它的数据，用它自己的后台通道说话。
//   看：MemoryData/plist.json 里没归档的 agent（名字以 IdentityData/<id>/identity.json 为准，同它的 launcher）；
//     记录在 SessionData/<id>/<时间>_<id>.jsonl（pi v3 的格式：一棵树，只画现在这一支）——每次启动开一份新的
//     （它续命靠自己的记忆快照，不靠接着同一份记录），这里按时间接起来：先读最新的一份，往上翻读更早的
//   状态（同它的 list.cjs、communicate.ts）：在跑 = 有 genshin:<名字>(main,<id>,…) 进程；前台 / 后台 = RuntimeCache/<id>/detached；
//     在做什么 = RuntimeCache/<id>/ 里的 main-resting（Waiting）、main-hibernate（Hibernating，wake-at 是到点醒的时刻）、paused（Paused），都没有 = Working
//   说：只对后台（headless）的——它本来就以 rpc 模式常驻、从 AgentFileData/<id>/headless-in（fifo）读命令（同 Teyvat 自己的 web-tui）：
//     {"type":"prompt","message":…,"streamingBehavior":"steer"}（它在忙时排在当前这一步之后）；Esc = {"type":"abort"}。
//     离线的：genshin bg <名字>（它自己的命令：直接拉成后台），起来以后再说；前台的（在终端里跑着）：只读，说明怎么转到后台
//   id：ty:<agent id>（agents.js 的外部运行时，前缀 ty）。列表：TSU_TEYVAT.list()，变了发 tsu-teyvat 事件
(function () {
  "use strict";
  var LOC = window.TSU_LOCAL, A = window.TSU_AGENTS, CON = window.TSU_CONNECTORS;
  if (!LOC || !A || !A.registerExternal) { window.TSU_TEYVAT = null; return; }
  var TAIL = 4 << 20;
  var home = function () { return (LOC.info() || {}).home || ""; };
  var PH = function () { return window.__TY_HOME || home() + "/.teyvat"; }; // PAIMON_HOME（它的 launcher 一律 $HOME/.teyvat；测试换到别处）
  var on = function () { return !!(CON && CON.on("teyvat")); };
  var shq = function (x) { return "'" + String(x).replace(/'/g, "'\\''") + "'"; };
  var ts = function (s) { var t = typeof s === "number" ? s : Date.parse(s || ""); return isNaN(t) ? Date.now() : t; };
  var dec = function (buf) { return new TextDecoder().decode(new Uint8Array(buf)); };
  var tr = function (s) { return window.TSU_I18N && TSU_I18N.t ? TSU_I18N.t(s) : s; };
  var clip = function (s, n) { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  var textOf = function (c) { return typeof c === "string" ? c : (Array.isArray(c) ? c : []).filter(function (b) { return b && b.type === "text"; }).map(function (b) { return b.text || ""; }).join("\n"); };
  var imagesOf = function (c) { return (Array.isArray(c) ? c : []).filter(function (b) { return b && b.type === "image" && b.data; }).map(function (b) { return { media_type: b.mimeType || "image/png", data: b.data }; }); };
  var execT = function (cmd, ms) {
    var ac = window.AbortController ? new AbortController() : null, t = setTimeout(function () { if (ac) ac.abort(); }, ms || 8000);
    return LOC.exec({ cmd: cmd }, ac ? ac.signal : undefined).then(function (r) { clearTimeout(t); return r; }, function (e) { clearTimeout(t); throw e; });
  };
  var readJSON = function (p) { return LOC.read(p).then(function (b) { try { return JSON.parse(dec(b)); } catch (e) { return null; } }, function () { return null; }); };
  var list = function (p) { return LOC.list(p).then(function (l) { return l || []; }, function () { return []; }); };
  // 它给模型看的结果后面挂的尾标签（[id: …] [background: …] [remaining: N] [result N tokens, ctx …] [12:00:01 +0.9s | ctx 49%]）：画的时候去掉（同它的 stripResultTokenMark）
  var TAG_RE = /(?:(?:\[(?:id|background|remaining):[^\]]*\]|\[result\s+[\d.]+[kM]?\s*tokens?(?:,[^\]]*)?\]|\[\d{2}:\d{2}:\d{2}[^\]]*\])\s*)+$/;
  function stripTags(s) { s = String(s == null ? "" : s); var prev; do { prev = s; s = s.replace(TAG_RE, "").replace(/\s+$/, ""); } while (s !== prev); return s.replace(/\n\[background: [^\]]*running[^\]]*\]/g, ""); }
  // 耗时（同它的 fmtElapsedMs）：0.12s、1.2s、16s、1m 5s、2h 3m
  function elapsed(ms) {
    var s = Math.max(0, +ms || 0) / 1000;
    if (s < 1) return s.toFixed(2) + "s";
    if (s < 10) return (Number.isInteger(s) ? s : s.toFixed(1)) + "s";
    if (s < 60) return Math.round(s) + "s";
    if (s < 3600) { var m = Math.floor(s / 60), sec = Math.round(s % 60); return sec ? m + "m " + sec + "s" : m + "m"; }
    return Math.floor(s / 3600) + "h " + Math.floor(s % 3600 / 60) + "m";
  }
  // 你说的话：它（bioclock）在最后加了一个时刻「 [2026-10-06 23:13:41.729]」给模型看——画的时候拿掉，时刻记在这一问上（时间戳那一列显示）
  var BIO_RE = /\s*\[(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)(?:\.(\d{1,3}))?\]\s*$/;
  function bioStrip(txt) {
    var m = BIO_RE.exec(String(txt || ""));
    if (!m) return { text: String(txt || ""), at: 0 };
    return { text: String(txt).slice(0, m.index), at: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +(m[7] || 0)).getTime() };
  }
  var clock = function (t) { var d = new Date(t); if (isNaN(d.getTime())) return ""; var p = function (n) { return (n < 10 ? "0" : "") + n; }; return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds()); };

  // ======== agent 列表 ========
  var LIST = [], byId = {}, scanning = null, lastScan = 0, names = {};
  try { LIST = (JSON.parse(localStorage.getItem("tsu-ty-list") || "[]") || []).filter(function (x) { return x && x.id; }); LIST.forEach(function (x) { x.running = false; x.mode = "offline"; x.state = "offline"; byId[x.id] = x; }); } catch (e) { LIST = []; }
  var keepList = function () { try { localStorage.setItem("tsu-ty-list", JSON.stringify(LIST.map(function (x) { return { id: x.id, name: x.name, kind: x.kind, created: x.created, mtime: x.mtime, cwd: x.cwd }; }))); } catch (e) { /* 满了就不记 */ } };
  // 在跑的 agent：进程名是 genshin:<名字>(<角色>,<id>,<记录 id 的后 12 位>)（同它 launcher 的 _kill_stale_same_sid）；TTY 是 ?? 的是脱离了终端的后台进程
  function procs() {
    if (window.__TY_PS) return Promise.resolve(window.__TY_PS());
    return execT("ps -Ao pid=,tty=,command= 2>/dev/null | grep -F 'genshin:' | grep -v grep", 6000).then(function (r) {
      var out = {};
      String(r && r.out || "").split("\n").forEach(function (l) {
        var m = /^\s*(\d+)\s+(\S+)\s+genshin:(.*?)\((\w+),([0-9a-f]{6,}),([0-9a-f]*)\)/.exec(l);
        if (m && m[4] === "main") out[m[5]] = { pid: +m[1], tty: m[2], name: m[3], sess: m[6] };
      });
      return out;
    }, function () { return {}; });
  }
  // 名字：改过名的在 identity.json（它的 launcher 每次启动都从这里读最新的名字）
  function nameOf(id, fallback) {
    var c = names[id];
    if (c && Date.now() - c.at < 60000) return Promise.resolve(c.name || fallback);
    return readJSON(PH() + "/IdentityData/" + id + "/identity.json").then(function (j) { var n = j && typeof j.name === "string" ? j.name.trim() : ""; names[id] = { name: n, at: Date.now() }; return n || fallback; });
  }
  function stateOf(a, ps) {
    var ph = PH(), id = a.id, sd = ph + "/SessionData/" + id;
    return Promise.all([list(ph + "/RuntimeCache/" + id), list(sd), nameOf(id, a.name), LOC.stat(ph + "/MemoryData/" + id + "/paused").catch(function () { return null; })]).then(function (rs) {
      var has = {}; rs[0].forEach(function (f) { has[f.name] = f; });
      var files = rs[1].filter(function (f) { return !f.dir && /\.jsonl$/.test(f.name); }).sort(function (x, y) { return x.name < y.name ? -1 : x.name > y.name ? 1 : 0; });
      var last = files[files.length - 1], p = ps[id], running = !!p;
      var paused = !!(has.paused || rs[3]);
      var x = {
        id: id, conn: "teyvat", name: rs[2] || a.name || id, kind: a.kind || "", note: a.note || "", model: a.model || "", org: a.org || "",
        created: ts(a.created), lastSeen: typeof a.lastSeen === "number" ? a.lastSeen : ts(a.lastSeen),
        running: running, mode: !running ? "offline" : has.detached ? "bg" : "fg",
        state: !running ? "offline" : paused ? "paused" : has["main-hibernate"] ? "hibernating" : has["main-resting"] ? "waiting" : "working",
        stateAt: !running ? 0 : ((has["main-hibernate"] || has["main-resting"] || has.paused || {}).mtime || (last && last.mtime) || 0),
        pid: p ? p.pid : 0, tty: p ? p.tty : "", sess: p ? p.sess : "",
        files: files.map(function (f) { return { name: f.name, size: f.size, mtime: f.mtime }; }),
        path: last ? sd + "/" + last.name : "", size: last ? last.size : 0, mtime: last ? last.mtime : 0, wakeAt: 0,
        fifo: !!has["headless-in"],
      };
      if (!has["main-hibernate"] || !has["wake-at"]) return x;
      return readJSON(ph + "/RuntimeCache/" + id + "/wake-at").then(function (j) { x.wakeAt = j && +j.until || 0; return x; });
    });
  }
  function scan(force) {
    if (!on()) { LIST = []; return Promise.resolve(LIST); }
    if (scanning) return scanning;
    if (!force && Date.now() - lastScan < 3000) return Promise.resolve(LIST);
    scanning = (LOC.ready || Promise.resolve()).then(function () { return Promise.all([readJSON(PH() + "/MemoryData/plist.json"), procs()]); }).then(function (rs) {
      var plist = Array.isArray(rs[0]) ? rs[0] : [];
      return Promise.all(plist.filter(function (a) { return a && a.id && !a.archived; }).map(function (a) { return stateOf(a, rs[1]); }));
    }).then(function (items) {
      var sig0 = JSON.stringify(LIST.map(sigOf));
      LIST = items.sort(function (a, b) { return (b.running - a.running) || (b.mtime - a.mtime); });
      byId = {}; LIST.forEach(function (x) { byId[x.id] = x; });
      keepList();
      lastScan = Date.now(); scanning = null;
      Object.keys(rts).forEach(function (k) { var r = rts[k], x = byId[r.agentId]; if (x) r.refresh(x); });
      if (JSON.stringify(LIST.map(sigOf)) !== sig0) document.dispatchEvent(new Event("tsu-teyvat"));
      return LIST;
    }).catch(function (e) { console.warn("teyvat scan:", e); scanning = null; return LIST; });
    return scanning;
  }
  var sigOf = function (x) { return [x.id, x.name, x.mode, x.state, x.path, x.size, x.wakeAt].join("|"); };

  // ======== 记录 → 对话（同 pi.js 的 Runtime，加上 Teyvat 自己的工具、通知）========
  // 它的工具：read / edit / write 是 pi 自带的那几样（画成 Claude Code 的 Read / Update / Write）；别的是它自己的（execute、wait、hibernate、social……）：
  //   p.ty = 工具名，tyHead / tyArg = 调用那一行，tyOut = { sum, tone, lines, num, dim } = ⎿ 那一行和下面几行（live.js 的 tyRows 画）
  var CC_TOOL = { read: "Read", edit: "Edit", write: "Write" };
  var LABEL = { execute: "Execute", wait: "Wait", hibernate: "Hibernate", social: "Social", intentions: "Intentions", amem: "Amem", web: "Web", eyes: "Eyes", status: "Status", help: "Help",
    editcontext: "Edit Context", nap: "Nap", sleep: "Sleep", dream: "Dream", drinkcoffee: "Drink Coffee", ear: "Ears", mouth: "Mouth", mobile: "Mobile", highlight: "Highlight", remove: "Remove" };
  function toolPart(tc, at, t) {
    var name = String(tc.name || ""), a = tc.arguments && typeof tc.arguments === "object" ? tc.arguments : {}, p = { kind: "tool", status: "running", id: tc.id, t0: at, turn: t };
    if (CC_TOOL[name]) {
      var fp = a.path || a.file_path || "";
      p.name = CC_TOOL[name];
      if (p.name === "Read") p.input = { file_path: fp, offset: a.offset, limit: a.limit };
      else if (p.name === "Write") p.input = { file_path: fp, content: a.content || "" };
      else { var eds = Array.isArray(a.edits) ? a.edits : [{ oldText: a.oldText != null ? a.oldText : a.old_string, newText: a.newText != null ? a.newText : a.new_string }]; p.input = { file_path: fp, old_string: String((eds[0] || {}).oldText || ""), new_string: String((eds[0] || {}).newText || ""), edits: eds }; }
      return p;
    }
    p.name = name; p.ty = name; p.input = a; p.tyHead = LABEL[name] || (name.charAt(0).toUpperCase() + name.slice(1));
    var s = function (v) { return String(v == null ? "" : v); };
    switch (name) {
      case "execute":
        p.tyHead = a.terminal === true ? "Execute(T)" : "Execute";
        if (a.action === "list" || a.action === "l") p.tyArg = "list";
        else if (/^(show|s|sh|kill|k)$/.test(s(a.action))) p.tyArg = s(a.action).replace(/^(s|sh)$/, "show").replace(/^k$/, "kill") + " " + (Array.isArray(a.id) ? a.id.join(", ") : s(a.id));
        else if (s(a.title).trim()) p.tyArg = '"' + s(a.title).trim() + '"';
        else { p.tyArg = s(a.command).split("\n")[0].slice(0, 80); p.tyArgDim = true; }
        p.tyCmd = s(a.command);
        break;
      case "wait":
        p.tyArg = [s(a.title).trim(), (a.seconds != null ? a.seconds : "?") + "s" + (a.wait_for_user ? " (for user)" : ""), a.message ? "— " + s(a.message) : ""].filter(Boolean).join(" ");
        break;
      case "hibernate":
        p.tyArg = [a.until ? "until " + s(a.until).trim() : "", a.reuse === true ? tr("（沿用上一次的说明）") : s(a.summary).trim() || "hibernating"].filter(Boolean).join(" ");
        break;
      case "social":
        if (a.action === "send") { var md = a.mode === "queue" ? "queue" : "interrupt"; p.tyArg = "send " + (md === "interrupt" ? "an" : "a") + " " + md + " message " + (/^(group|public):/.test(s(a.to)) ? "in " : "to ") + s(a.to); }
        else p.tyArg = [s(a.action), a.action === "focus" ? s(a.mode) : a.action === "group" || a.action === "public" ? [s(a.gop), s(a.gname || a.gid)].filter(Boolean).join(" ") : a.action === "check-message" ? s(a.gid || "new") : ""].filter(Boolean).join(" ");
        break;
      case "intentions": p.tyArg = a.new_string != null || a.old_string != null ? "edit" : "read"; break;
      case "amem": p.tyArg = [s(a.action), a.hash_key ? "[apply]" : /^(fetch|mark_enter|mark_exit|memory-reboot)$/.test(s(a.action)) ? "" : "[check]", s(a.title || a.summary)].filter(Boolean).join(" "); break;
      case "web": p.tyArg = [s(a.op), s(a.op === "search" ? a.query : a.op === "upload" ? a.path : a.url)].filter(Boolean).join(" "); break;
      case "eyes": p.tyArg = [s(a.action || "ocr"), a.action === "ax" ? s(a.app || (a.pid ? "pid " + a.pid : "frontmost")) : s(a.path)].filter(Boolean).join(" "); break;
      case "status": p.tyArg = s(a.instruction); break;
      case "help": p.tyArg = s(a.name); break;
      case "ear": p.tyHead = "Ears " + s(a.action); p.tyArg = a.action === "file" ? s(a.path) : a.action === "seek" ? (a.seconds || 0) + "s" : ""; break;
      case "mouth": p.tyArg = s(a.text).slice(0, 80); break;
      case "mobile": p.tyArg = s(a.input).split("\n")[0].slice(0, 80); break;
      case "remove": p.tyArg = [s(a.action), s(a.path)].filter(Boolean).join(" "); break;
      case "highlight": p.tyArg = s(a.block) + " " + (a.unpin ? "unpin" : s(a.color)); break;
      default: p.tyArg = s(a.action || a.title || a.path || a.query || "");
    }
    return p;
  }
  // pi 的 edit 结果里那份 diff（details.diff，pi 的 generateDiffString）：一行「+12 内容」「-12 内容」「 12 内容」（行号按最宽的补空格），省掉的是「     ...」
  //   → live.js diffRows 认的 { t: "+" / "-" / " " / "…", n: 行号, l: 内容 }；没有这份时照 edits 拼（没有行号）
  function piDiff(s) {
    var out = [];
    String(s || "").split("\n").forEach(function (ln) {
      var m = /^([+\- ])(\s*)(\d*) (.*)$/.exec(ln);
      if (!m) return;
      if (!m[3]) { if (/^\.\.\.$/.test(m[4].trim())) out.push({ t: "…" }); return; }
      out.push({ t: m[1], n: +m[3], l: m[4] });
    });
    return out;
  }
  // 工具的结果：read / edit / write 同 pi.js（Claude Code 的样子）；它自己的工具按它的画法（execute 的 Result、Created，social 的 Sent，……）
  function toolResult(p, m) {
    var at = ts(m.timestamp), d = m.details && typeof m.details === "object" ? m.details : {};
    var raw = textOf(m.content), txt = stripTags(raw), lines = txt.replace(/\r/g, "").split("\n");
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    p.secs = Math.max(0, Math.round((at - (p.t0 || at)) / 1000));
    var err = !!m.isError || (!!p.ty && /^ERR:/m.test(txt)) || (p.ty === "hibernate" && /^(还有|禁止|请先)/.test(txt)); // 休眠被拦下（还有后台命令在跑……）同它：算出错
    p.status = err ? "error" : "done";
    if (!p.ty) {
      if (err) { p.error = (lines.filter(Boolean).slice(-1)[0] || "error").slice(0, 300); p.detail = lines.slice(0, 200); return; }
      if (p.name === "Edit") {
        var dd = d.diff ? piDiff(d.diff) : [], add = 0, del = 0;
        if (!dd.length) (p.input.edits || []).forEach(function (ed, i) {
          if (i) dd.push({ t: "…" });
          if (ed.oldText) String(ed.oldText).split("\n").forEach(function (l) { dd.push({ t: "-", l: l }); });
          if (ed.newText) String(ed.newText).split("\n").forEach(function (l) { dd.push({ t: "+", l: l }); });
        });
        dd.forEach(function (x) { if (x.t === "+") add++; else if (x.t === "-") del++; });
        p.diff = dd.slice(0, 2000);
        p.summary = "Updated " + String(p.input.file_path || "file").split("/").pop() + " with " + add + " addition" + (add === 1 ? "" : "s") + " and " + del + " removal" + (del === 1 ? "" : "s");
        return;
      }
      if (p.name === "Write") { var wl = String(p.input.content || "").replace(/\n$/, "").split("\n"); p.summary = "Wrote " + wl.length + " lines to " + String(p.input.file_path || "file").split("/").pop(); p.detail = wl; return; } // 点开看写了什么
      if (p.name === "Read") { p.summary = "Read " + lines.length + " line" + (lines.length === 1 ? "" : "s"); return; }
      p.detail = lines.slice(0, 400);
      return;
    }
    var out = function (sum, body, o) { p.tyOut = Object.assign({ sum: sum || "", tone: err ? "err" : "", lines: body || [] }, o || {}); };
    if (err) { out(lines[0] || "error", lines.slice(1, 200)); p.error = (lines[0] || "error").slice(0, 300); return; }
    switch (p.ty) {
      case "execute":
        // 快命令：⎿ done in 1.2s（+ 输出，淡的，带行号）；转到后台的：⎿ Created 1 bash process (3 in total), id …（跑完时它推一条 cmd-done，见下面）
        if (d.execId && d.createdInfo) {
          var ci = d.createdInfo || {};
          p.status = "background"; p.recId = d.recId || d.execId; p.bgTotal = ci.total > 0 ? ci.total : 0; p.bgTerm = d.terminal === true;
          out("Created " + (ci.created || 1) + " " + (d.terminal === true ? "terminal process" + (d.tname ? " named " + d.tname : "") : "bash process") + (ci.total > 0 ? " (" + ci.total + " in total)" : "") + (p.recId ? ", id " + p.recId : ""), []);
          break;
        }
        if (d.execId) {
          var ec = typeof d.exitCode === "number" ? d.exitCode : null, body = stripTags(d.renderText != null ? d.renderText : raw).replace(/\r/g, "").split("\n");
          while (body.length && !body[body.length - 1].trim()) body.pop();
          if (ec) p.status = "error";
          out((d.elapsedMs > 0 ? "done in " + elapsed(d.elapsedMs) : "done instantly") + (ec ? ", exit " + ec : ""), body, { num: true, dim: true, tone: ec ? "err" : "" });
          break;
        }
        out("", stripTags(d.renderText != null ? d.renderText : raw).split("\n").filter(function (l, i, all) { return i < all.length - 1 || l.trim(); }));
        break;
      case "wait": // 它的 wait 一调就返回（这一轮停下），真正的等在后面：它醒来（continuous-resume / wait-interrupted）或者又开始说话时才算完
        p.waitPlanned = d.wait != null ? +d.wait : +(p.input.seconds || 0);
        p.status = "running";
        break;
      case "hibernate": p.status = "running"; break;
      case "social":
        var sm = d.social ? d : null, a = d.action || p.input.action;
        if (!sm) { out(lines[0] || "", lines.slice(1)); break; }
        var sum = a || "done";
        if (a === "send") {
          if (d.count === 1 && d.modeUsed && !d.chanId) sum = "Sent and " + d.modeUsed + " " + (d.targetName || d.target || "?") + (d.targetSid ? " (" + d.targetSid + ")" : "");
          else if (d.chanId) sum = "Sent a message in " + (d.chanName || d.chanId) + " (" + d.chanId + ")";
          else sum = d.count === 1 ? "Sent to " + (d.targetDisplay || d.target || "?") : "Sent to " + (d.count || 0) + " receivers";
        } else if (a === "list") sum = "Agents " + (d.count || 0);
        else if (a === "inbox") sum = (d.count ? d.count : "No") + " message" + (d.count === 1 ? "" : "s");
        else if (a === "focus") sum = "focus " + (d.mode || "");
        else if (a === "check-message") sum = (d.unread !== undefined ? d.unread + " new / " : "") + (d.count || 0) + " msg";
        else if (a === "group") sum = "Group " + (d.gop || "") + (d.count ? " · " + d.count + " receivers" : "");
        var bl = [], md = "";
        if ((a === "send" || (a === "public" && d.gop === "send")) && d.text) md = String(d.text); // 发出去的正文：按 Markdown 画（同收到的消息；不再一行行原样漏出 ** ## ```）
        else if (Array.isArray(d.lines) && d.lines.length) bl = d.lines.map(String);
        else if (a === "list" || a === "global") bl = lines;
        out(sum + (d.ts ? "  " + clock(d.ts) : ""), bl, md ? { sumDimTail: d.ts ? 2 + clock(d.ts).length : 0, md: md, msg: true } : { sumDimTail: d.ts ? 2 + clock(d.ts).length : 0 });
        break;
      case "intentions":
        if (d.action === "read") { if (!txt || txt === "(empty)") break; out(lines.filter(function (l) { return l.trim(); }).length + " lines", lines, { num: true }); break; }
        if (/^\((cleared|empty)\)/.test(txt)) break;
        var nw = String(d._new != null ? d._new : d._full != null ? d._full : "").replace(/\s+$/, "");
        out(d.action === "edit" ? "Updated intentions" : "Wrote intentions", nw ? nw.split("\n") : lines, { num: true });
        break;
      case "amem": {
        var first = lines[0] || "", act = (/^amem\s+([a-z_]+)/i.exec(first) || [])[1] || "", tok = /~\s*(\d+)\s*tok/.exec(raw), n = tok ? +tok[1] : 0;
        var verb = /^(archive|sweep)$/i.test(act) ? "Archived" : /^manage$/i.test(act) ? "Managed" : /^revert$/i.test(act) ? "Reverted" : /^fetch$/i.test(act) ? "Fetched" : /^mark_/i.test(act) ? "Marked" : "";
        out(verb && n ? verb + " " + (n >= 1000 ? (n / 1000).toFixed(1) + "K" : n) + " tokens" : first.replace(/^amem\s+\w+:\s*/, ""), lines.slice(1));
        break;
      }
      case "mouth": break;
      default: out(lines[0] || "", lines.slice(1), d.markdown ? { md: txt } : null);
    }
  }

  // 一份记录的解析器：条目一条条喂进来，变成 Paimon 的一问一问（turns）。一份记录一个（换了下一份记录 / 往上翻更早的一份时各自一个）
  function Parser(sink) {
    var P = { turns: [], cur: null, byCall: {}, byRec: {}, lastWait: null, lastHib: null, runEnded: true, model: "", provider: "", effort: "", ctx: 0, cost: 0, cwd: "", sent: null,
      workAt: 0, workTok: 0, segAt: 0, accMs: 0, bgs: [] }; // workAt：这一段开始干活（同它状态栏的 Working 计时）；workTok：这一段写了多少 token；segAt / accMs：这次启动以来干活的累计（休眠那一行写）；bgs：转到后台的命令
    // 开始干活（你说了话、它醒了、续命）：Working 从这里算
    var work = function (at) { P.workAt = at; P.workTok = 0; if (!P.segAt) P.segAt = at; };
    // 等着的 / 休眠的被叫醒：记下等了多久、谁叫醒的
    var wake = function (at, why) {
      var w = P.lastWait;
      if (w && w.status === "running" && w.resulted) { w.status = "done"; if (w.waited == null) w.waited = Math.max(0, Math.round((at - (w.waitAt || w.t0 || at)) / 1000)); if (!w.waitWhy && why) w.waitWhy = why.kind === "user" ? "user message" : why.kind === "social" ? "message from " + why.from : why.kind === "cmd" ? "task completed" : ""; w.wokeAt = at; touch(w.turn); }
      var h = P.lastHib;
      if (h && h.status === "running" && h.resulted) { h.status = "done"; h.slept = at - (h.hibAt || h.t0 || at); h.wokeBy = why || null; h.wokeAt = at; touch(h.turn); P.segAt = at; work(at); }
    };
    var finish = function () {}; // 它没有「Worked for … · done …」这种一问做完的那一行（它一直在跑：Working / Waiting / Hibernating 写在底部的状态栏）
    var push = function (t) { P.turns.push(t); if (sink && sink.onTurn) sink.onTurn(t); return t; };
    var newTurn = function (o) { finish(); P.cur = Object.assign({ parts: [] }, o); push(P.cur); return P.cur; };
    var turnFor = function (at) { if (!P.cur || P.runEnded) newTurn({ ask: "", cont: true, at: at }); return P.cur; };
    // 一块它的显示用的块（✤ Life Restarted、◆ Date、▸ 系统消息、cmd-done 的 Result）：一问里的一段；不在一问里就自成一问
    var block = function (b, at, own) {
      b.kind = "ty"; b.at = at;
      if (own || !P.cur) { newTurn({ ask: "", cont: true, at: at }); P.runEnded = true; }
      P.cur.parts.push(b); P.cur.last = at;
      return P.cur;
    };
    P.feed = function (e) {
      var at = ts(e.timestamp);
      if (e.type === "session") { if (e.cwd) P.cwd = e.cwd; if (at) { P.segAt = at; work(at); } return null; }
      if (e.type === "model_change") { if (e.modelId) P.model = e.modelId; if (e.provider) P.provider = e.provider; return null; }
      if (e.type === "thinking_level_change") { P.effort = e.thinkingLevel || ""; return null; }
      if (e.type === "session_info" || e.type === "label") return null;
      if (e.type === "compaction" || e.type === "branch_summary") { finish(); P.cur = null; P.runEnded = true; return push({ compact: { summary: String(e.summary || "").trim(), pre: e.tokensBefore || 0, post: 0, msgs: 0, trigger: e.type === "branch_summary" ? "branch" : "" }, at: at }); }
      if (e.type === "custom_message") return custom(e, at);
      if (e.type !== "message" || !e.message) return null;
      var m = e.message, mat = m.timestamp ? ts(m.timestamp) : at;
      if (m.role === "user") {
        var bs = bioStrip(textOf(m.content)), txt = bs.text, imgs = imagesOf(m.content);
        if (bs.at && !m.timestamp) mat = bs.at; // 它记的时刻（同一个时刻）：记录里没有 timestamp 时才用
        if (!txt.trim() && !imgs.length) return null;
        wake(mat, { kind: "user" });
        if (P.runEnded) work(mat);
        P.runEnded = false;
        var t0 = newTurn({ ask: txt, images: imgs, at: mat });
        if (sink && sink.onAsk) sink.onAsk(txt, mat);
        return t0;
      }
      if (m.role === "assistant") {
        if (m.model) P.model = m.model;
        if (m.provider) P.provider = m.provider;
        var u = m.usage || {};
        if (u.input || u.cacheRead || u.output) P.ctx = (u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0) + (u.output || 0);
        if (u.cost && u.cost.total) P.cost += u.cost.total;
        if (u.output) P.workTok += u.output;
        var t = turnFor(mat);
        P.runEnded = false;
        [P.lastWait, P.lastHib].forEach(function (w) { if (w && w.status === "running" && w.resulted) { w.status = "done"; touch(w.turn); } }); // wait / hibernate 回来以后它又说话了：等完了
        (Array.isArray(m.content) ? m.content : []).forEach(function (bl) {
          if (!bl) return;
          if (bl.type === "text" && String(bl.text || "").trim()) t.parts.push({ kind: "text", text: String(bl.text), whole: true, at: mat });
          else if (bl.type === "thinking" && String(bl.thinking || "").trim()) { t.thinking = (t.thinking ? t.thinking + "\n\n" : "") + bl.thinking; t.thought = Math.max(t.thought || 1, Math.round((mat - t.at) / 1000)); }
          else if (bl.type === "toolCall") {
            var part = toolPart(bl, mat, t);
            if (bl.id) P.byCall[bl.id] = part;
            if (part.ty === "wait") { P.lastWait = part; part.waitAt = mat; }
            if (part.ty === "hibernate") { P.lastHib = part; part.hibAt = mat; P.accMs += Math.max(0, mat - (P.segAt || mat)); part.accMs = P.accMs; P.segAt = 0; }
            if (part.ty === "execute") P.bgs.push(part);
            t.parts.push(part);
          }
        });
        if (m.stopReason === "error") t.error = String(m.errorMessage || "error").slice(0, 600);
        if (m.stopReason === "aborted") (t.parts || []).forEach(function (q) { if (q.kind === "tool" && q.status === "running" && q.ty !== "wait" && q.ty !== "hibernate") q.status = "done"; });
        t.last = mat;
        if (m.stopReason && m.stopReason !== "toolUse") { P.runEnded = true; finish(); }
        return t;
      }
      if (m.role === "toolResult") {
        var pp = P.byCall[m.toolCallId];
        if (!pp) return null;
        toolResult(pp, m);
        pp.resulted = true;
        if (pp.recId) P.byRec[pp.recId] = pp;
        if (pp.ty === "execute" && pp.status === "background" && pp.bgTotal > 0) trimBg(pp.bgTotal, pp);
        if (pp.turn) pp.turn.last = mat;
        return pp.turn;
      }
      if (m.role === "bashExecution") { finish(); P.cur = null; P.runEnded = true; return push({ bash: String(m.command || ""), out: String(m.output || "").trim(), code: m.cancelled ? 130 : m.exitCode == null ? null : m.exitCode, at: mat }); }
      return null;
    };
    // 它自己的消息（custom_message）：display 的照它的画法画；不显示的（给模型看的续命提示、wait 被打断、记忆快照……）不画，只取有用的（wait 等了多久、换了模型）
    // 还在跑的后台命令最多 keep 个（它自己报的：Created 时的「一共 N 个」、跑完时的「还剩 N 个」）：多出来的、更早的那些已经结束了——
    //   结果没对上（跑完的通知 id 对不上、被吞了、手动结束的）。以前这样的一直算「在跑」，越积越多（用户 2026-10-28：188 个在跑 22 小时）
    function trimBg(keep, cur) {
      var run = P.bgs.filter(function (q) { return q !== cur && q.status === "background" && !q.done && !q.lost; });
      var extra = run.length - Math.max(0, keep - (cur ? 1 : 0));
      if (extra <= 0) return;
      run.sort(function (a, b) { return (a.t0 || 0) - (b.t0 || 0); }).slice(0, extra).forEach(function (q) { q.lost = true; q.lostWhy = "gone"; touch(q.turn); });
    }
    function cmdDone(d, txt, at, show) {
      // 转到后台的命令跑完（它推的 cmd-done）：⏺ Result "标题" done in 16s + 输出；原来那一条 Execute 改成做完了
      var st = d.status || "done", src = d.recId && P.byRec[d.recId], ec = typeof d.exitCode === "number" ? d.exitCode : null;
      if ((!src || src.done) && d.cmd) { // id 对不上（它那边换了算法、跨秒）：同一条命令里最早还在跑的那个
        var c0 = String(d.cmd).trim();
        src = P.bgs.filter(function (q) { return q.status === "background" && !q.done && !q.lost && String((q.input && q.input.command) || "").trim() === c0; }).sort(function (a, b) { return (a.t0 || 0) - (b.t0 || 0); })[0] || src;
      }
      var head = st === "failed" ? "failed after " : st === "timeout" ? "timed out after " : st === "terminated" ? "terminated after " : (d.elapsedSec > 0 ? "done in " : "");
      var body = String(d.output != null ? d.output : txt).replace(/\s+$/, "");
      var res = { ty: "result", title: d.title || (src && src.input && src.input.title) || "", sum: (head ? head + (d.elapsedSec > 0 || st !== "done" ? elapsed((d.elapsedSec || 0) * 1000) : "") : "done instantly") + (ec ? ", exit " + ec : ""), remaining: d.remaining > 0 ? d.remaining : 0,
        err: st !== "done" || !!ec, lines: d.status ? (body ? body.split("\n") : []) : stripTags(txt).split("\n"), recId: d.recId || "", src: src || null, endTs: d.endTs || at };
      if (src && !src.done) { src.status = res.err ? "error" : "done"; src.doneBy = at; src.done = res; src.lost = false; if (src.turn) touch(src.turn); }
      if (typeof d.remaining === "number") trimBg(d.remaining, null);
      if (!show) return src ? src.turn : null; // 它不显示的那种：只把那一条改成跑完了，不另画一块
      wake(at, { kind: "cmd" });
      finish(); P.runEnded = false;
      work(at);
      return block(res, at, true);
    }
    function custom(e, at) {
      var ct = String(e.customType || ""), txt = textOf(e.content), d = e.details && typeof e.details === "object" ? e.details : {};
      if (ct === "continuous-cmd-done") return cmdDone(d, txt, at, !!e.display);
      if (ct === "wait-interrupted") { var wm = /\[wait (\d+)s (?:被打断|interrupted) \(([^)]*)\)\]/.exec(txt), w = P.lastWait; if (wm && w) { w.waited = +wm[1]; w.waitWhy = wm[2]; w.interrupted = true; w.status = "done"; w.wokeAt = at; return w.turn; } return null; }
      if (ct === "continuous-resume" && (d.resumeType === "wait" || d.resumeType === "hibernate" || d.resumeType === "hibernate-until")) {
        var isW = d.resumeType === "wait", rw = isW ? P.lastWait : P.lastHib, sm = /(\d+)s/.exec(txt), nx = /\(next:\s*([\s\S]*)\)\s*$/.exec(txt);
        if (rw) {
          if (isW) { if (rw.waited == null && sm) rw.waited = +sm[1]; rw.status = "done"; rw.wokeAt = at; }
          else { rw.status = "done"; rw.slept = at - (rw.hibAt || rw.t0 || at); rw.wokeBy = { kind: d.resumeType === "hibernate-until" ? "until" : "timer" }; rw.wokeAt = at; P.segAt = at; }
          touch(rw.turn);
        }
        work(at);
        return rw ? rw.turn : null;
      }
      if (ct === "model-switch") { var mm = /(?:模型切换到|switched to)\s*([^\s(]+)/i.exec(txt); if (mm) P.model = mm[1]; return null; }
      if (!e.display) {
        // 不显示的续命 / 叫醒：它又开始跑了——新的一段（没有问的那一行）
        if (P.runEnded && /^(continuous-next|continuous-|sleep-|memory-reboot)/.test(ct)) { work(at); newTurn({ ask: "", cont: true, at: at, auto: ct }); P.runEnded = false; return P.cur; }
        return null;
      }
      switch (ct) {
        case "social-message": {
          // 别的 agent 发来的（收件箱里读进来的）：一问「别的 agent 发来的话」（同 Paimon 的 social：外壳按自己的样子画），它接着的回答接在这一问里
          // 正文：它给模型看的那份开头带「[interrupt] 10-13 13:34 名字: 」——谁、几点、怎么送的上面 ➤ 那一行已经写了，去掉（不然第一行的 ## 标题也画不出来）
          var body2 = String(d.text != null ? d.text : txt).replace(/^\s*\[[\w-]+\]\s+\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}(:\d{2})?\s+[^:\n]{1,80}?:\s*/, "");
          var sm2 = { from: d.from || "", from_name: d.from_name || d.from || "agent", mode: d.mode || "", mode_used: d.mode_used || d.mode || "", ts: d.ts || at, text: body2, chan: d.chan || "", at: d.at || [] };
          wake(at, { kind: "social", from: sm2.from_name });
          if (P.runEnded) work(at);
          finish(); P.runEnded = false;
          return newTurn({ system: true, social: [sm2], ask: "", at: at });
        }
        // continuous-cmd-done：在上面（cmdDone），不管显示不显示都认
        case "continuous-resume":
          if (d.resumeType === "restart") {
            var self0 = /自己触发了重启|you triggered|self[- ]?reboot/i.test(txt);
            wake(at, { kind: "restart" });
            P.bgs.forEach(function (q) { if (q.status === "background" && !q.done && !q.lost) { q.lost = true; q.lostWhy = "restart"; touch(q.turn); } }); // 重启了：转到后台的那些跟着没了（它不会再推 cmd-done）
            work(at);
            return block({ ty: "event", label: "Life Restarted", sub: self0 ? "自己重启" : "用户重启", text: txt.replace(/^\[系统\]\s*/, "") }, at, true);
          }
          return block({ ty: "notice", label: "Resumed From History Sessions", text: txt.replace(/^\[系统\]\s*/, "") }, at, true);
        case "sleep-wake-resume": return block({ ty: "notice", label: "Resumed From Sleep", text: txt }, at, true);
        case "continuous-date": return block({ ty: "notice", label: "Date", text: txt.replace(/^Current date: /, "") }, at, true);
        case "display-hidden": return block({ ty: "event", label: "Hidden", text: txt }, at, true);
        case "display-shown": return block({ ty: "event", label: "Shown", text: txt }, at, true);
        case "memory-capacity": case "memory-reminder": return block({ ty: "sys", tone: "", text: txt }, at, false);
        case "system-error": case "hippocampus-error": return block({ ty: "sys", tone: "err", text: txt }, at, false);
        case "continuous-error-retry": case "syntax-error": return block({ ty: "sys", tone: "warn", text: txt }, at, false);
      }
      return block({ ty: "notice", label: ct || "Message", text: txt }, at, false);
    }
    var touched = null;
    var touch = function (t) { if (touched) touched.add(t); };
    P.track = function (set) { touched = set; };
    P.finish = finish;
    return P;
  }

  // ======== 一个 agent：同 pi.js 的 Runtime（每种外壳只认这些）========
  var rts = {};
  function Runtime(aid, info) {
    var rt = this, id = aid.slice(3), subs = [], turns = [], sess = { id: id, title: info.name || id, turns: turns, todo: { items: [] }, ctx: 0, window: 0, updated: info.mtime || 0 };
    var agent = rt.agent = { id: aid, name: sess.title, effort: "", access: "rw", model: info.model || "", current: id, goal: null, archived: false, claude: true, connector: "teyvat" };
    rt.agentId = id; rt.info = info; rt.label = "Teyvat";
    var emit = function (t, d) { subs.slice().forEach(function (f) { try { f(t, d); } catch (e) { console.error(e); } }); };
    rt.on = function (fn) { subs.push(fn); if (subs.length === 1) start(); return function () { subs = subs.filter(function (f) { return f !== fn; }); if (!subs.length) stop(); }; };
    rt.watched = function () { return subs.length > 0; };
    rt.fire = emit;
    rt.session = function () { return sess; };
    rt.stream = null; rt.tasks = []; rt.queued = null;
    rt.pendingMsgs = function () { return 0; };
    var sentWait = [];
    rt.pending = function () {
      sentWait = sentWait.filter(function (x) { return Date.now() - x.at < 3600000; });
      return sentWait.map(function (x) { return { text: x.text, at: x.at, ours: true, sending: !x.ok, err: x.err || "" }; });
    };
    rt.takeQueued = function () { var q = rt.queued; rt.queued = null; emit("status"); return q; };
    rt.todo = function () { return sess.todo.items; };
    rt.state = function () { return info.state === "working" ? "working" : "idle"; };
    rt.busyNow = function () { return info.state === "working"; };
    rt.ctx = function () { var w = sess.window || 0; return { tokens: sess.ctx, window: w, pct: w ? sess.ctx / w * 100 : 0 }; };
    rt.home = rt.cwd = function () { return sess.cwd || info.cwd || home(); };
    rt.cost = function () { return sess.cost || 0; };
    rt.tail = function () { return ""; };
    rt.maybeRecap = rt.recap = function () {};
    rt.record = function (cmd, res) { var t = { cmd: cmd, note: tr(res), at: Date.now(), local: true }; turns.push(t); emit("append", t); };
    ["setEffort", "setAccess", "rename", "setGoal", "clearGoal", "clear", "resume", "bang", "detachBash", "stopTask", "wakeUp", "receive", "afterReload"].forEach(function (k) { rt[k] = function () { return false; }; });
    rt.turnOf = function () { return null; };
    rt.historical = function () { return false; };
    rt.later = function () { return Promise.resolve(false); };
    rt.latest = function () { return load(); };
    rt.agentName = function () { return ""; };
    rt.canCycle = function () { return false; };
    rt.limits = function () { return null; };
    rt.hint = function () { return ""; };
    rt.model = function () { var mid = agent.model || info.model || ""; return { id: mid, name: mid || "Teyvat", window: sess.window || 0, pending: false }; };
    rt.models = function () { return []; };
    rt.setModel = function () { return false; };

    // ---- 读记录：最新的一份读最后一段、跟着读新写进来的；往上翻读更早的一份（每份各自一棵树）----
    var cur = { path: "", offset: 0, all: [], byEntry: {}, leaf: "", parser: null }, lo = -1, files = [], loading = null, gen = 0, pollT = 0, pollBusy = false, pollAgain = false;
    var parse = function (l) { if (!l || l.length < 8) return null; try { return JSON.parse(l); } catch (e) { return null; } };
    function linesOf(buf, dropHead) {
      var u8 = new Uint8Array(buf), a = 0;
      if (dropHead) { var i = u8.indexOf(10); a = i < 0 ? u8.length : i + 1; }
      var j = u8.lastIndexOf(10), end = j + 1 > a ? j + 1 : a;
      return { end: end, lines: end > a ? dec(u8.subarray(a, end)).split("\n") : [] };
    }
    function branchOf(all, byEntry, leaf) {
      var path = [], seen = {}, k = leaf;
      while (k && byEntry[k] && !seen[k]) { seen[k] = 1; path.push(byEntry[k]); k = byEntry[k].parentId; }
      path.reverse();
      var head = all.filter(function (e) { return e.type === "session"; })[0];
      return head ? [head].concat(path) : path;
    }
    var sinkOf = function (live) { return { onAsk: function (text, at) { dropSent(text, at); }, onTurn: live ? function (t) { if (rt.stream && t.parts) rt.stream.turn = t; } : null }; };
    function build(entries, live) { var p = Parser(sinkOf(live)); entries.forEach(function (e) { p.feed(e); }); p.finish(); return p; }
    function absorb(p) { if (p.model) agent.model = p.model; if (p.provider) agent.provider = p.provider; if (p.effort) agent.effort = p.effort; if (p.ctx) sess.ctx = p.ctx; if (p.cost) sess.cost = p.cost; if (p.cwd) sess.cwd = p.cwd; }
    // 下一份记录开始的地方：一行淡的分隔（它重启了 / 开了新的一份），点不了
    var sepOf = function (f) { var m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d)-(\d\d)/.exec(f.name || ""), when = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) : new Date(f.mtime || Date.now()); return { tySep: when.getTime(), at: when.getTime() }; };
    function readFile(path, size) {
      var start0 = size > TAIL ? size - TAIL : 0;
      return LOC.read(path, { offset: start0, max: size - start0 }).then(function (buf) { var r = linesOf(buf, start0 > 0), all = [], byEntry = {}, leaf = ""; r.lines.forEach(function (l) { var e = parse(l); if (!e) return; all.push(e); if (e.id) { byEntry[e.id] = e; leaf = e.id; } }); return { all: all, byEntry: byEntry, leaf: leaf, end: start0 + r.end, partial: start0 > 0 }; });
    }
    function load() {
      var g = ++gen;
      files = (info.files || []).slice();
      if (!files.length) { turns.length = 0; turns.push({ note: tr("这个 Agent 还没有记录"), at: 0 }); emit("reset"); return Promise.resolve(); }
      var f = files[files.length - 1], path = PH() + "/SessionData/" + id + "/" + f.name;
      loading = LOC.stat(path).then(function (st) {
        if (g !== gen) return;
        if (!st) throw new Error(tr("会话记录不存在"));
        return readFile(path, st.size).then(function (r) {
          if (g !== gen) return;
          cur = { path: path, offset: r.end, all: r.all, byEntry: r.byEntry, leaf: r.leaf, parser: null, name: f.name };
          var p = build(branchOf(r.all, r.byEntry, r.leaf), true);
          cur.parser = p; absorb(p);
          lo = files.length - 1; partial = r.partial;
          turns.length = 0; p.turns.forEach(function (t) { turns.push(t); });
          sess.updated = st.mtime;
          settle();
          emit("reset"); emit("status"); emit("config");
        });
      }).catch(function (e) { if (g !== gen) return; turns.length = 0; if (e && e.message) turns.push({ note: tr("无法读取会话：" + e.message), at: 0 }); emit("reset"); }).then(function () { if (g === gen) loading = null; });
      return loading;
    }
    var partial = false;
    // 往上翻：更早的一份（读了最后一段的大文件不往前接——同 pi.js 只画读到的那一段）
    rt.more = function () { return lo > 0; };
    rt.earlier = function () {
      if (loading || lo <= 0) return Promise.resolve(false);
      var f = files[lo - 1], path = PH() + "/SessionData/" + id + "/" + f.name, g = gen;
      loading = readFile(path, f.size).then(function (r) {
        if (g !== gen) return false;
        var p = build(branchOf(r.all, r.byEntry, r.leaf)), add = p.turns.concat([sepOf(files[lo])]);
        lo--;
        Array.prototype.unshift.apply(turns, add);
        emit("prepend", add);
        return true;
      }, function () { return false; }).then(function (ok) { loading = null; return ok; });
      return loading;
    };
    function poll() {
      if (!cur.path || loading) return;
      if (pollBusy) { pollAgain = true; return; }
      pollBusy = true;
      var g = gen;
      LOC.stat(cur.path).then(function (st) {
        if (g !== gen || !st) return;
        if (st.size < cur.offset) return load();
        if (st.size <= cur.offset) return;
        return LOC.read(cur.path, { offset: cur.offset, max: Math.min(st.size - cur.offset, TAIL) }).then(function (buf) {
          if (g !== gen) return;
          var r = linesOf(buf, false);
          if (!r.end) { if (buf.byteLength >= TAIL) cur.offset += buf.byteLength; return; }
          cur.offset += r.end;
          sess.updated = st.mtime;
          var fresh = r.lines.map(parse).filter(Boolean), branched = false;
          fresh.forEach(function (e) { if (e.id && cur.leaf && e.parentId !== cur.leaf && e.parentId !== undefined) branched = true; cur.all.push(e); if (e.id) { cur.byEntry[e.id] = e; cur.leaf = e.id; } });
          if (branched) { var p2 = build(branchOf(cur.all, cur.byEntry, cur.leaf), true); cur.parser = p2; absorb(p2); var keep = turns.length - countCur(); turns.length = keep; p2.turns.forEach(function (t) { turns.push(t); }); emit("reset"); emit("status"); return; }
          var p = cur.parser, before = p.turns.length, touched = new Set();
          p.track(touched);
          fresh.forEach(function (e) { var t = p.feed(e); if (t) touched.add(t); });
          p.track(null);
          absorb(p);
          p.turns.slice(before).forEach(function (t) { touched.delete(t); turns.push(t); emit("append", t); });
          touched.forEach(function (t) { emit("turn", t); });
          settle();
          emit("status");
          panelChanged();
        });
      }).catch(function () {}).then(function () { pollBusy = false; if (pollAgain) { pollAgain = false; setTimeout(poll, 0); } });
    }
    var countCur = function () { return cur.parser ? cur.parser.turns.length : 0; };
    // 最后那个 wait / hibernate：它已经不在等 / 不在休眠了（扫到的状态为准）——算完了（不然一直闪）
    function settle() {
      var p = cur.parser;
      if (!p || !info.scanned) return;
      [[p.lastWait, "waiting"], [p.lastHib, "hibernating"]].forEach(function (k) { var w = k[0]; if (w && w.status === "running" && info.state !== k[1]) { w.status = "done"; if (w.turn) emit("turn", w.turn); } });
    }
    // 它重启了（又开了一份新的记录）：接在后面，中间一行分隔
    function nextFile(f) {
      var path = PH() + "/SessionData/" + id + "/" + f.name, g = gen;
      readFile(path, f.size || 0).then(function (r) {
        if (g !== gen) return;
        // 上一份里停在半截的（它重启了）：都算完了
        if (cur.parser) cur.parser.turns.forEach(function (t) { (t.parts || []).forEach(function (q) { if (q.kind === "tool" && q.status === "running") { q.status = "done"; emit("turn", t); } if (q.kind === "tool" && q.status === "background" && !q.done && !q.lost) { q.lost = true; emit("turn", t); } }); });
        cur = { path: path, offset: r.end, all: r.all, byEntry: r.byEntry, leaf: r.leaf, parser: null, name: f.name };
        var p = build(branchOf(r.all, r.byEntry, r.leaf), true);
        cur.parser = p; absorb(p);
        var sep = sepOf(f);
        turns.push(sep); emit("append", sep);
        p.turns.forEach(function (t) { turns.push(t); emit("append", t); });
        emit("status");
      }).catch(function () {});
    }
    // 列表扫到了新的状态（每几秒一次）：在做什么、记录换了没有
    rt.refresh = function (x) {
      var was = info.state, wasMode = info.mode;
      Object.assign(info, x);
      info.scanned = true;
      settle();
      if (x.name && x.name !== sess.title) { sess.title = agent.name = x.name; emit("config"); }
      if (cur.name && x.files && x.files.length) {
        var nf = x.files[x.files.length - 1];
        if (nf.name !== cur.name && !loading) { files = x.files.slice(); nextFile(nf); }
        else files = x.files.slice();
      } else if (!cur.name && !loading && x.files && x.files.length) load(); // 第一次读的时候还没扫到它的记录（App 刚起来、标签页先于连接器恢复）：扫到了就读，不一直停在「还没有记录」
      if (was !== x.state || wasMode !== x.mode) { setBusy(x.state === "working"); emit("status"); emit("state"); panelChanged(); }
    };
    // 没在干活、但有在走的时间（等着、休眠、后台的命令在跑）：一秒一下（状态栏、那几块的计时）
    var slowT = 0;
    var liveBg = function () { return bgList().some(function (q) { return q.status === "background" && !q.done && !q.lost; }); };
    function start() { if (!loading && !cur.path) load(); clearInterval(pollT); pollT = setInterval(poll, 700); scan(true); clearInterval(slowT); slowT = setInterval(function () { if (rt.stream || document.hidden) return; if (info.state === "waiting" || info.state === "hibernating" || liveBg()) emit("tick"); }, 1000); }
    function stop() { clearInterval(pollT); pollT = 0; clearInterval(slowT); slowT = 0; }

    // ---- 它底部那一行（同它自己的状态栏 StatusBar）要的：在做什么、从什么时候、写了多少、在读 / 写 / 改哪个、后台还有几个命令；等着的：等多久、等谁；休眠的：睡了多久、几点醒 ----
    var ACT = { Read: "reading", Write: "writing", Edit: "editing" }; // 同它：只有这三样写在 Working 后面
    function bgList() {
      var p = cur.parser;
      if (!p) return [];
      var now = Date.now();
      p.bgs.forEach(function (q) {
        if (q.status !== "background" || q.done || q.lost || q.bgTerm || !q.t0) return;
        var lim = ((+(q.input && q.input.timeout_minutes)) || 30) * 60000 + 120000;
        if (now - q.t0 > lim) { q.lost = true; q.lostWhy = "gone"; if (q.turn) emit("turn", q.turn); }
      });
      return p.bgs.filter(function (q) { return q.recId && (q.status === "background" || q.done || q.lost); });
    }
    rt.tyState = function () {
      var p = cur.parser || {}, o = { state: info.state, mode: info.mode, at: info.stateAt || 0 }, last = turns[turns.length - 1];
      o.work = { t0: p.workAt || info.stateAt || 0, tokens: p.workTok || 0 };
      var runP = null;
      (last && last.parts || []).forEach(function (q) { if (q.kind === "tool" && q.status === "running" && q.ty !== "wait" && q.ty !== "hibernate") runP = q; });
      if (runP && ACT[runP.name]) o.work.act = { verb: ACT[runP.name], t0: runP.t0 || 0 };
      o.bg = bgList().filter(function (q) { return q.status === "background" && !q.lost; }).map(function (q) { return q.t0 || 0; });
      var w = p.lastWait;
      if (w && info.state === "waiting") o.wait = { secs: +(w.waitPlanned || (w.input && w.input.seconds) || 0), t0: w.waitAt || w.t0 || 0, forUser: !!(w.input && w.input.wait_for_user), title: String((w.input && w.input.title) || ""), next: String((w.input && w.input.next_steps) || "").trim() };
      var h = p.lastHib;
      if (h && info.state === "hibernating") o.hib = { t0: h.hibAt || h.t0 || info.stateAt || 0, until: String((h.input && h.input.until) || "").trim(), untilTs: info.wakeAt || 0, accMs: h.accMs || 0, summary: String((h.input && h.input.summary) || "").trim() };
      return o;
    };
    // 右侧栏：意图（它的 intentions.txt）、转到后台的命令（Created 的那些，跑完的带结果）
    var intent = { text: "", mtime: -1, at: 0 };
    function readIntent() {
      var f = PH() + "/MemoryData/" + id + "/intentions.txt";
      return LOC.stat(f).then(function (st) {
        var mt = st ? st.mtime : 0;
        if (mt === intent.mtime) return;
        if (!st) { intent = { text: "", mtime: 0, at: Date.now() }; emit("status"); panelChanged(); return; }
        return LOC.read(f).then(function (b) { intent = { text: dec(b).trim(), mtime: mt, at: Date.now() }; emit("status"); panelChanged(); });
      }).catch(function () {});
    }
    var panelChanged = function () { if (window.STUDIO && STUDIO.familyChanged) STUDIO.familyChanged(); };
    rt.tyPanel = function () {
      if (Date.now() - intent.at > 3000) { intent.at = Date.now(); readIntent(); } // 看的时候隔几秒看一眼改了没有
      return { intentions: intent.text, intentAt: intent.mtime, bg: bgList(), state: rt.tyState() };
    };

    // ---- 在跑吗：它自己的状态（Working / Waiting / Hibernating / Paused），不是这边猜的 ----
    var ticker = 0;
    function tickOn() { if (ticker) return; ticker = setInterval(function () { if (!rt.stream) { clearInterval(ticker); ticker = 0; return; } if (document.hidden) return; emit("tick"); }, 120); }
    function setBusy(v) {
      if (!!v === !!rt.stream) return;
      if (v) { var c0 = turns[turns.length - 1]; rt.stream = { t0: info.stateAt || Date.now(), turn: c0 && !c0.stats && c0.parts ? c0 : { parts: [] }, outTokens: 0, thinking: false, firstAt: Date.now(), verb: "Working", answer: "", ctl: { abort: function () { rt.interrupt(); } } }; tickOn(); }
      else rt.stream = null;
      emit("status"); emit("state");
    }
    setBusy(info.state === "working");

    // ---- 说：后台的从它的 fifo 递命令（同它自己的 web-tui）；离线的先拉成后台；前台的只读 ----
    rt.canInject = function () { return info.mode !== "fg"; };
    rt.canInterrupt = function () { return info.mode === "bg" && info.state === "working"; };
    rt.canSendNow = function () { return false; };
    rt.elsewhere = function () { return false; };
    rt.inputHint = function () {
      if (info.mode === "fg") return tr("在终端里运行（前台）：在它的终端里按 Ctrl+C 转到后台后，可以在这里对话");
      return ""; // 没在跑：同平常一样的输入框（发消息时自己先在后台启动它），不写一句说明（用户 2026-10-28）
    };
    var wnorm = function (t) { return String(t || "").replace(/\s+/g, ""); };
    function dropSent(text, at) {
      if (!sentWait.length) return;
      var k = wnorm(text), hit = -1;
      sentWait.forEach(function (x, i) { if (hit >= 0) return; var w = wnorm(x.text); if (w === k || (w && k && (k.indexOf(w) >= 0 || w.indexOf(k) >= 0))) hit = i; });
      if (hit >= 0) { sentWait.splice(hit, 1); emit("status"); }
    }
    function sendCmd(obj) { return rpc(id, obj); }
    rt.send = function (text, imgs) {
      text = String(text || "").trim();
      imgs = (imgs || []).filter(function (x) { return x && x.data; });
      if (!text && !imgs.length) return false;
      if (info.mode === "fg") { rt.record(text, tr("它在终端里运行（前台），这里只能看。在它的终端里按 Ctrl+C 转到后台后，再在这里说。")); return true; }
      var item = { text: text, at: Date.now(), ok: false };
      sentWait.push(item); emit("status");
      var cmd = { type: "prompt", message: text, streamingBehavior: "steer" };
      if (imgs.length) cmd.images = imgs.map(function (im) { return { type: "image", data: im.data, mimeType: im.media_type || "image/png" }; });
      var go = info.mode === "bg" ? Promise.resolve() : startBg(id).then(function () { return waitReady(id); });
      go.then(function () { return sendCmd(cmd); }).then(function () { item.ok = true; emit("status"); setTimeout(poll, 300); }, function (e) { item.err = String((e && e.message) || e); emit("status"); });
      return true;
    };
    rt.sendNow = function (text, imgs) { return rt.send(text, imgs); };
    rt.interrupt = function () { if (info.mode !== "bg") return false; sendCmd({ type: "abort" }).catch(function () {}); return true; };
    // / 命令：交给它自己（扩展命令在 rpc 模式下照样能用：/pause 这些）；它只在终端界面里有的（/s 设置面板）它自己会说
    rt.command = function (line) {
      var s = String(line || "").trim();
      if (!/^\//.test(s) || /^\/(exit|quit)\b/.test(s)) return false;
      if (info.mode === "fg") { rt.record(s, tr("它在终端里运行（前台）：命令请在它的终端里输入")); return true; }
      rt.send(s);
      return true;
    };
    rt.island = function () {
      var st = info.state === "working" ? "working" : "needs", me = { id: id, name: sess.title, current: true, st: st, at: Date.now(), cwd: sess.cwd || "", title: sess.title, right: info.state };
      return Promise.resolve({ groups: [{ title: st === "working" ? "Working" : "Needs input", items: [me] }], running: st === "working" ? 1 : 0 });
    };
  }

  // ---- 递命令：一行 JSON 写进它的 fifo（AgentFileData/<id>/headless-in）。先确认真的是 fifo、有进程在读（非阻塞打开，没人读就不写——不会卡住），
  //   内容先写进一个文件再整段交给它（长消息不进命令行）；同一个 agent 一次只递一条 ----
  var PERL = 'use Fcntl; sysopen(my $o, $ARGV[0], O_WRONLY|O_NONBLOCK) or do { print "NOREADER\\n"; exit 0 }; my $fl = fcntl($o, F_GETFL, 0); fcntl($o, F_SETFL, $fl & ~O_NONBLOCK); open(my $i, "<", $ARGV[1]) or do { print "NOTMP\\n"; exit 0 }; binmode $i; binmode $o; local $/; my $d = <$i>; print {$o} $d; close $o; print "SENT\\n";';
  var rpcQ = {};
  function rpc(id, obj) {
    var prev = rpcQ[id] || Promise.resolve();
    var p = prev.catch(function () {}).then(function () {
      var fifo = PH() + "/AgentFileData/" + id + "/headless-in", tmp = home() + "/Library/Application Support/Vibing Studio/run/ty-" + id + ".json";
      if (window.__TY_RPC) return window.__TY_RPC(id, obj);
      return LOC.write(tmp, JSON.stringify(obj) + "\n").then(function () {
        return execT("f=" + shq(fifo) + '; [ -p "$f" ] || { echo NOFIFO; exit 0; }; /usr/bin/perl -e ' + shq(PERL) + ' "$f" ' + shq(tmp), 20000);
      }).then(function (r) {
        var o = String(r && r.out || "");
        if (/SENT/.test(o)) return true;
        throw new Error(/NOREADER/.test(o) ? tr("它没有在后台运行（没有进程在读它的命令通道）") : /NOFIFO/.test(o) ? tr("找不到它的后台命令通道") : tr("没有送出去") + (r && r.err ? "：" + String(r.err).trim().slice(0, 200) : ""));
      });
    });
    rpcQ[id] = p;
    return p;
  }
  // ---- 拉成后台：genshin bg <名字>（它自己的命令；已经在跑的它会说一声、不动）----
  //   不往它的对话里塞东西（用户 2026-10-13：「不应该使用注入方法」）：它的 heart 在内核启动时会注入「[系统] 用户回来了」（当成你从离线回来），
  //   attach 时注入「用户已以前台模式进入」。照它自己的 attach 协议（web-tui 同款）：先写 RuntimeCache/<id>/attached-back（heart 见到就不发「用户回来了」），
  //   再 --silent 启动（不发 attach 的那句）。已经在后台跑着的不写标记——写了它下一回合会说「用户进了前台」
  var genshin = function () { return window.__TY_GENSHIN || '"$HOME/.local/bin/genshin"'; };
  function startBg(id) {
    var x = byId[id];
    if (!x) return Promise.reject(new Error(tr("找不到这个 Agent")));
    if (x.running) return x.mode === "bg" ? Promise.resolve() : Promise.reject(new Error(tr("它在终端里运行（前台）")));
    var g = genshin(), mark = PH() + "/RuntimeCache/" + id + "/attached-back";
    return LOC.write(mark, JSON.stringify({ ts: new Date().toISOString().replace(/\.\d+Z$/, "Z"), from: "vibing-studio" })).catch(function () {}).then(function () {
      return execT("G=" + g + '; [ -x "$G" ] || G=$(command -v genshin); [ -n "$G" ] || { echo NOGENSHIN; exit 0; }; "$G" --silent bg ' + shq(x.name) + " </dev/null 2>&1 | tail -3", 30000);
    }).then(function (r) {
      var o = String(r && r.out || "");
      if (/NOGENSHIN/.test(o)) throw new Error(tr("这台电脑上没有找到 genshin 命令"));
      return scan(true);
    });
  }
  // 等它起来：有了进程、fifo 有人读（最多 20 秒）
  function waitReady(id) {
    var t0 = Date.now();
    return new Promise(function (res, rej) {
      (function look() {
        scan(true).then(function () {
          var x = byId[id];
          if (x && x.running && x.mode === "bg") return res();
          if (Date.now() - t0 > 20000) return rej(new Error(tr("它没有在后台启动起来（genshin bg 没有成功）")));
          setTimeout(look, 800);
        });
      })();
    });
  }
  // 在终端里打开它的界面（它自己的 genshin <名字>：后台的会被接回前台）
  function openTui(id) {
    var x = byId[id], S = window.STUDIO, tw = window.TSU_TERM && TSU_TERM.front ? TSU_TERM.front() : null;
    if (!x || !S || !S.newTerm || !tw) return false;
    S.newTerm(tw, null, home(), "genshin " + shq(x.name));
    return true;
  }

  function ensure(id, info) {
    var aid = "ty:" + id, x = byId[id] || {};
    if (!rts[aid]) { rts[aid] = new Runtime(aid, Object.assign({ id: id, files: [], mode: "offline", state: "offline" }, x, info || {})); A.registerExternal(aid, rts[aid]); }
    else if (info) Object.assign(rts[aid].info, info);
    return rts[aid];
  }
  A.setExternalResolver(function (aid) { return on() ? ensure(aid.slice(3)) : null; }, "ty");
  var API = {
    list: function () { return LIST; }, refresh: scan, ensure: ensure, id: function (x) { return "ty:" + x; }, get: function (x) { return byId[x] || null; },
    startBg: startBg, openTui: openTui, home: PH,
    busy: function (x) { var it = byId[x]; return !!(it && it.state === "working"); },
  };
  window.TSU_TEYVAT = on() ? API : null;
  if (CON) CON.watch(function (cid, v) { if (cid !== "teyvat") return; window.TSU_TEYVAT = v ? API : null; if (v) scan(true); else { LIST = []; } document.dispatchEvent(new Event("tsu-teyvat")); });
  if (on()) setTimeout(function () { scan(true); }, 1200);
  // 有人在看（开着的 agent、侧栏）时几秒一次；没人看时半分钟一次
  setInterval(function () { if (!on() || document.hidden) return; var watching = Object.keys(rts).some(function (k) { return rts[k].watched(); }); if (watching || Date.now() - lastScan > 15000) scan(true); }, 3000);
  window.__TY_TEST = { stripTags: stripTags, elapsed: elapsed, Parser: Parser, rts: rts };
})();
