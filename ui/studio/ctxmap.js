// ctxmap.js —— 上下文窗口的明细（同 Claude 桌面版的「Context window」）：总数 / 窗口（百分比）、一条叠起来的细条、每一块一行（色块、名字、token、占比）、
//   空余；有明细的几块（工具、记忆文件、对话）可以展开看每一项。数据：Paimon 的 agent 用 rt.contextBreakdown()（agents.js：按真实请求的几块估、
//   再按接口给的真实用量放缩）；Claude Code、Codex 这些连接器的会话：读会话文件的开头——第一次请求带上的系统提示、技能、自定义 agent、MCP 的说明、
//   记忆文件（按字数分）和那次的真实用量，每一轮都带着的这几块之外都算对话；读不到就粗估（对话 + 系统提示与工具，标「估算」）。
//   GUI：输入框下面的上下文圆环点开（gui.js 的 ctxPop 用 TSU_CTX.html）；TUI：状态行的「Ctx: n%」点一下、/context、窗口底部状态栏的「上下文 n%」——同一张卡片，
//   TUI 里用终端的样子（等宽字、方角）。
(function () {
  "use strict";
  if (window.TSU_CTX) return;
  var en = function () { return !!(window.TSU_I18N && TSU_I18N.lang && TSU_I18N.lang() === "en"); };
  var tr = function (zh, e) { return en() ? e : zh; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var LABEL = { imageInput:["图片输入","Image input"], userText:["用户消息","User messages"], assistantText:["助手消息","Assistant messages"], toolInput:["工具使用","Tool use"], toolOutput:["工具结果","Tool results"], unclassified:["其他","Other"], cachedInput: ["缓存输入", "Cached input"], input: ["未缓存输入", "Uncached input"], output: ["输出", "Output"], used: ["已用", "Used"], messages: ["对话", "Messages"], extTools: ["扩展工具", "Extension tools"], extPrompts: ["扩展说明", "Extension prompts"], sysTools: ["工具定义", "Tool definitions"],
    system: ["系统提示", "System prompt"], memory: ["记忆文件", "Memory files"], instructions: ["你的指令", "Your instructions"], buffer: ["自动压缩预留", "Autocompact buffer"],
    free: ["可用", "Free space"], sysAndTools: ["系统提示与工具", "System prompt & tools"], skills: ["技能", "Skills"], agents: ["自定义 agent", "Custom agents"], mcp: ["MCP 的说明", "MCP instructions"] };
  // 每一项的名字：agents.js 给的几个中文名（文字、图片 × 3）英文时换掉；别的是工具名、文件名、技能名，原样
  var ITEM = { "文字": "Text" };
  var itemName = function (n) { var m; return !en() ? n : ITEM[n] ? ITEM[n] : (m = /^图片 × (\d+)$/.exec(n)) ? "Images × " + m[1] : n; };
  var lab = function (p) { if (p.label) return p.label; var l = LABEL[p.id]; return l ? tr(l[0], l[1]) : p.label || p.id; };
  // 1234 → 1.2k、912900 → 912.9k、1000000 → 1M
  var k = function (n) { n = Math.max(0, Math.round(+n || 0)); if (n >= 1e6) return +(n / 1e6).toFixed(n % 1e6 ? 1 : 0) + "M"; if (n >= 1000) return +(n / 1000).toFixed(1) + "k"; return String(n); };
  var pc = function (n, w) { if (!w) return "—"; var v = n / w * 100; return (v > 0 && v < 0.1 ? "<0.1" : v.toFixed(1)) + "%"; };

  // 按字数估 token（同 agents.js）：中日韩的字一个约 0.9，别的约 3.6 个字符一个；图一张约 1600
  var est = function (s) { s = String(s || ""); var cjk = (s.match(/[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/g) || []).length; return Math.round(cjk * 0.9 + (s.length - cjk) / 3.6); };
  var tokOf = function (c) {
    if (typeof c === "string") return est(c);
    return (Array.isArray(c) ? c : []).reduce(function (n, b) { return n + (!b ? 0 : b.type === "image" || b.type === "input_image" ? 1600 : b.type === "tool_result" ? tokOf(b.content) : est(b.text)); }, 0);
  };
  // 「- 名字: 说明」那种一行的名字；MCP 的一块「## 名字」（名字是一串 id 的：用下一行冒号前面的）
  var nameOf = function (s) { return (/^- ([^:\n]{1,60}):/.exec(s) || [])[1] || ""; };
  var mcpName = function (s) { var l = String(s).split("\n"), n = String(l[0] || "").replace(/^#+\s*/, ""); return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(n) ? String(l[1] || n).split(/[:：]/)[0].slice(0, 40) : n; };
  var home = function (p) { return String(p || "").replace(/^\/Users\/[^/]+/, "~"); };
  // 会话文件的开头 → 第一次请求：真实的输入（first）、第一句（user，算对话）、记着的每一块（cats：按字数，带每一项）、系统提示记着没有（sys）。
  //   Claude Code：attachment 里的 prompt_snapshot（系统提示）、instructions（CLAUDE.md）、skill_listing、agent_listing_delta、mcp_instructions_delta，第一条有用量的回答；
  //   Codex：session_meta 的 base_instructions（系统提示）、developer 的几段（技能、记忆，别的算系统提示）、AGENTS.md，第一个 token_count
  function parseHead(txt) {
    var o = { first: 0, user: 0, cats: {}, sys: false };
    var put = function (id, name, s) { var t = est(s), g = o.cats[id] || (o.cats[id] = { tokens: 0, items: [] }); g.tokens += t; if (name && t) g.items.push({ name: name, tokens: t }); };
    var cx = function (t) {
      if (/^<skills_instructions>/.test(t)) {
        var a = t.indexOf("### Available skills"), b = a < 0 ? -1 : t.indexOf("\n### ", a + 5), e = b < 0 ? t.length : b;
        if (a < 0) return put("skills", "", t);
        t.slice(a, e).split(/\n(?=- )/).slice(1).forEach(function (s) { put("skills", nameOf(s), s); });
        return put("skills", "", t.slice(0, a) + t.slice(e));
      }
      var ag = /^# AGENTS\.md instructions for (.+)/.exec(t);
      if (ag || /^<user_instructions>/.test(t)) return put("memory", "AGENTS.md" + (ag ? " · " + home(ag[1]) : ""), t);
      if (/^## Memory\b/.test(t)) return put("memory", "Memory", t);
      return put("system", "", t);
    };
    var lines = txt.split("\n");
    for (var i = 0; i < lines.length && !o.first; i++) {
      var j = null;
      try { j = JSON.parse(lines[i]); } catch (e) { continue; }
      if (!j || j.isSidechain) continue;
      var a = j.attachment || {}, m = j.message || {}, p = j.payload || {}, u = m.usage || (p.info && p.info.last_token_usage);
      if (j.type === "attachment") {
        if (a.type === "prompt_snapshot") { o.sys = true; put("system", "", [].concat(a.systemPrompt || []).join("\n")); }
        else if (a.type === "instructions") (a.files || []).forEach(function (f) { put("memory", home(f.path), f.content); });
        else if (a.type === "skill_listing") String(a.content || "").split(/\n(?=- )/).forEach(function (s) { put("skills", nameOf(s), s); });
        else if (a.type === "agent_listing_delta") (a.addedLines || []).forEach(function (s) { put("agents", nameOf(s), s); });
        else if (a.type === "mcp_instructions_delta") (a.addedBlocks || []).forEach(function (s) { put("mcp", mcpName(s), s); });
      } else if (j.type === "user" && m.content) o.user += tokOf(m.content);
      else if (j.type === "assistant" && u) o.first = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
      else if (j.type === "session_meta" && p.base_instructions) { o.sys = true; put("system", "", typeof p.base_instructions === "string" ? p.base_instructions : p.base_instructions.text); }
      else if (j.type === "response_item" && p.type === "message" && p.role !== "assistant") (p.content || []).forEach(function (c) {
        var t = String(c.text || "");
        if (c.type === "input_image") o.user += 1600;
        else if (p.role === "developer" || /^(# AGENTS\.md instructions|<(user_instructions|environment_context|recommended_plugins|app-context)>)/.test(t)) cx(t);
        else o.user += est(t);
      });
      else if (j.type === "event_msg" && p.type === "token_count" && u) o.first = u.input_tokens || 0;
    }
    return o.first ? o : null;
  }
  // 读会话文件的开头（先 512K，第一次回答还在后面就 8M），读到了记着（按文件）；开着的卡片换成新的。没读到（还没回答）过 5 秒再试
  var heads = {};
  function headOf(rt) {
    var LOC = window.TSU_LOCAL, path = rt && !rt.contextBreakdown && rt.info && rt.info.path;
    if (!path || !LOC || !LOC.read) return null;
    var h = heads[path] || (heads[path] = { at: 0 });
    if (h.v || h.none || h.busy || Date.now() - h.at < 5000) return h.v || null;
    h.busy = true;
    var go = function (max) {
      return LOC.read(path, { offset: 0, max: max }).then(function (b) {
        var v = parseHead(new TextDecoder().decode(b)), cut = b.byteLength >= max;
        if (!v && cut && max < 8 << 20) return go(8 << 20);
        if (!v && cut) h.none = true;
        return v;
      });
    };
    h.pending = go(512 << 10).then(function (v) { h.busy = false; h.at = Date.now(); if (v) { h.v = v; redraw(rt); } }, function () { h.busy = false; h.at = Date.now(); });
    return null;
  }
  // 每一轮都带着的 = 第一次请求的输入 − 第一句：记着的几块按字数，剩下的是工具（系统提示没记着的：系统提示与工具）；总数里别的都是对话。
  //   比总数还多（刚压缩过、记录不全）：按比例缩到总数以内
  function fromHead(h, total, win) {
    var C = h.cats, g = function (id) { return C[id] ? C[id].tokens : 0; };
    var known = g("system") + g("memory") + g("skills") + g("agents") + g("mcp"), fixed = Math.max(known, h.first - h.user), f = fixed > total ? total / fixed : 1;
    var sc = function (n) { return Math.round(n * f); }, parts = [];
    var push = function (id, n, color) { if (n > 0) parts.push({ id: id, tokens: n, color: color, items: C[id] && C[id].items.length ? C[id].items.map(function (x) { return { name: x.name, tokens: sc(x.tokens) }; }) : null }); };
    var rest = sc(fixed - known), mcp = sc(g("mcp")), ag = sc(g("agents")), sk = sc(g("skills")), sy = sc(g("system")), me = sc(g("memory"));
    push("messages", Math.max(0, total - rest - mcp - ag - sk - sy - me), "var(--st-blue)");
    push("mcp", mcp, "var(--st-orange)"); push("agents", ag, "var(--st-green)"); push("skills", sk, "var(--st-lav)");
    push(h.sys ? "sysTools" : "sysAndTools", rest, h.sys ? "var(--st-yellow)" : "var(--st-dim)");
    push("system", sy, "var(--st-dim)"); push("memory", me, "var(--st-faint)");
    return { total: total, window: win, pct: win ? total / win * 100 : 0, estimated: true, head: true, buffer: 0, parts: parts, at: 0 };
  }
  // 连接器的会话（没有 contextBreakdown）：总数、窗口来自 rt.ctx()；会话文件的开头读到了按它分（fromHead）；还没读到：对话按会话里的文字估，剩下的算系统提示与工具
  function rough(rt) {
    var c = (rt.ctx && rt.ctx()) || {}, total = c.tokens || 0, win = c.window || 0, h = headOf(rt);
    if (h && total) return fromHead(h, total, win);
    return { total: total, window: win, parts: [{ id: "used", tokens: total, color: "var(--st-blue)" }] };
  }
  var contextReads = new WeakMap();
  function splitUsed(d, rt) {
    if (!d || !d.total || d.parts.length !== 1 || d.parts[0].id !== "used") return d;
    var turns = rt.session().turns, start = turns.length;
    while (start && !turns[start - 1].compact) start--;
    var counts = { userText: 0, assistantText: 0, toolInput: 0, toolOutput: 0 };
    if (start) for (var msg of turns[start - 1].compact.entries || []) {
      counts[msg.role === "user" ? "userText" : "assistantText"] += est(msg.text);
    }
    for (var t of turns.slice(start)) {
      counts.userText += est(t.ask);
      var hasText = false;
      for (var part of t.parts || []) {
        if (part.kind === "text") { counts.assistantText += est(part.text); hasText = true; }
        if (part.kind === "tool") {
          counts.toolInput += est(part.name) + est(JSON.stringify(part.input || {}));
          counts.toolOutput += est(Array.isArray(part.detail) ? part.detail.join("\n") : part.detail);
        }
      }
      if (!hasText) counts.assistantText += est(t.answer);
    }
    var snapshot;
    if (rt.readContextParts) {
      var read = contextReads.get(rt);
      if (!read || (!read.busy && read.total !== d.total)) {
        read = {total:d.total, busy:true, value:read?.value};
        contextReads.set(rt, read);
        read.pending = rt.readContextParts().then(value => { read.value = value; read.busy = false; redraw(rt); },
          () => { read.busy = false; });
      }
      snapshot = read.value;
      if (snapshot) counts = snapshot.counts;
    }
    var scale = Math.min(1, d.total / (Object.values(counts).reduce((a,b) => a+b, 0) || 1));
    var parts = [], left = d.total;
    for (var [id,color] of [["userText","var(--st-blue)"],["assistantText","var(--st-lav)"],["toolInput","var(--st-orange)"],["toolOutput","var(--st-green)"],["system","var(--st-yellow)"],["sysTools","var(--st-red)"],["imageInput","var(--st-cyan, #36a9b0)"]]) {
      var tokens = Math.min(left, Math.round((counts[id] || 0) * scale));
      if (tokens) { parts.push({id, tokens, color, estimated:true}); left -= tokens; }
    }
    if (!parts.length) return d;
    if (left) parts.push({id:"unclassified", tokens:left, color:"var(--cx-other)", estimated:true});
    return Object.assign({}, d, {parts, compactLayout:true});
  }
  function data(rt) {
    if (!rt) return null;
    try { if (rt.contextBreakdown) return splitUsed(rt.contextBreakdown(), rt); } catch (e) { console.error(e); }
    return splitUsed(rough(rt), rt);
  }
  // 卡片里面（GUI 的弹出层、TUI 的卡片都用）
  function html(rt, opts) {
    var d = data(rt);
    if (!d) return "";
    var win = d.window || 0, used = d.total || 0, buf = d.buffer || 0, free = win ? Math.max(0, win - used - buf) : 0;
    var rows = d.parts.filter(p => !p.deferred);
    if (buf) rows.push({ id: "buffer", tokens: buf, color: "var(--st-dim)" });
    rows.sort((a, b) => b.tokens - a.tokens);
    var bar = rows.map(function (p) { return win && p.tokens ? '<i style="width:' + (p.tokens / win * 100).toFixed(2) + "%;background:" + p.color + '"></i>' : ""; }).join("");
    var row = function (p, extra) { return '<div class="cx-r' + (extra || "") + '"><i class="cx-sq" style="background:' + (p.color || "transparent") + '"></i><span class="cx-n">' + esc(lab(p)) + '</span><span class="cx-t">' + k(p.tokens) + '</span><span class="cx-p">' + (p.deferred ? "—" : pc(p.tokens, win)) + "</span></div>"; };
    var list = rows.map(function (p) { return row(p); }).join("") + (win ? row({ id: "free", tokens: free, color: "" }, " free") : "") +
      d.parts.filter(function (p) { return p.deferred; }).map(function (p) { return row(p, " def"); }).join("");
    var groups = d.parts.filter(function (p) { return p.items && p.items.length > (p.id === "messages" ? 1 : 0); }).map(function (p) {
      var items = p.items.slice().sort(function (a, b) { return b.tokens - a.tokens; });
      return '<div class="cx-g" data-g="' + esc(p.id) + '"><div class="cx-gh" role="button" tabindex="0"><i class="cx-car"></i><span class="cx-n">' + esc(lab(p)) + '</span><span class="cx-t">' + k(p.tokens) + '</span><span class="cx-p">' + items.length + "</span></div>" +
        '<div class="cx-gl" hidden>' + items.map(function (x) { return '<div class="cx-gi"><span class="cx-n">' + esc(itemName(x.name)) + '</span><span class="cx-t">' + k(x.tokens) + '</span><span class="cx-p">' + pc(x.tokens, win) + "</span></div>"; }).join("") + "</div></div>";
    }).join("");
    var compact = d.compactLayout || rows.length === 1 && rows[0].id === "used";
    return '<div class="cx' + (compact ? " cx-simple" : "") + (opts && opts.tui ? " cx-tui" : "") + '" data-aid="' + esc(rt.agent && rt.agent.id || "") + '">' +
      '<div class="cx-h"><span class="cx-sum">' + esc(tr("已用", "Used")) + " " + k(used) + " / " + (win ? k(win) : "?") + (win ? " (" + (used && used / win < 0.01 ? "&lt;1" : Math.round(used / win * 100)) + "%)" : "") + '</span></div>' +
      '<div class="cx-bar">' + bar + "</div>" +
      '<div class="cx-body"><div class="cx-rows">' + list + "</div>" + (groups ? '<div class="cx-sep"></div>' + groups : "") + "</div></div>";
  }
  // 展开 / 收起：标题（整张明细）、每一组（它的每一项）
  function bind(el) {
    if (!el || el._cx) return el;
    el._cx = true;
    el.addEventListener("click", function (e) {
      var gh = e.target.closest(".cx-gh");
      if (gh) { var g = gh.parentNode, l = g.querySelector(".cx-gl"); l.hidden = !l.hidden; g.classList.toggle("open", !l.hidden); e.stopPropagation(); }
    });
    el.addEventListener("keydown", function (e) { if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("cx-gh")) { e.preventDefault(); e.target.click(); } });
    return el;
  }
  // 会话文件读到了：开着的这个 agent 的卡片换成新的（收起的还收起）；弹出层在 anchor 上面的，下沿不动
  function redraw(rt) {
    var aid = rt.agent && rt.agent.id;
    [].forEach.call(document.querySelectorAll(".cx"), function (el) {
      if (!aid || el.dataset.aid !== aid) return;
      var box = el.closest(".gv-pop, .cx-pop"), h0 = box ? box.offsetHeight : 0, t = document.createElement("div");
      t.innerHTML = html(rt, { tui: el.classList.contains("cx-tui") });
      if (!t.firstChild) return;
      t.firstChild.classList.toggle("folded", el.classList.contains("folded"));
      el.parentNode.replaceChild(t.firstChild, el);
      if (box && box.dataset.up !== "0") box.style.top = Math.max(8, (parseFloat(box.style.top) || 0) - (box.offsetHeight - h0)) + "px";
    });
  }
  // 单独的一张卡片（TUI 的状态行、/context、窗口底部状态栏）：贴着 anchor，放得下就在上面
  var cur = null, trigger = null, triggerPane = null;
  function sameTrigger(el) {
    return !!(trigger && el && (trigger.contains(el) ||
      (trigger.dataset.footerChoice && el.closest?.("[data-footer-choice]")?.dataset.footerChoice === trigger.dataset.footerChoice &&
       triggerPane && el.closest(".tpane") === triggerPane)));
  }
  function close() { cur?.remove(); cur = trigger = triggerPane = null; document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", onKey, true); }
  function outside(e) { if (trigger && !cur?.contains(e.target) && !sameTrigger(e.target)) close(); }
  function onKey(e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } }
  async function open(rt, anchor, opts) {
    var collapse = sameTrigger(anchor);
    close();
    if (collapse) return null;
    var h = html(rt, opts);
    if (!h) return null;
    trigger = anchor; triggerPane = anchor?.closest?.(".tpane");
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", onKey, true);
    var read = contextReads.get(rt) || heads[rt.info?.path];
    if (read?.busy && read.pending) {
      var originalPane = triggerPane;
      await read.pending;
      if (trigger !== anchor) return null;
      if (!anchor.isConnected && anchor.dataset.footerChoice) anchor = originalPane?.querySelector('[data-footer-choice="#agent-context"]') || anchor;
      h = html(rt, opts);
    }
    cur = document.createElement("div");
    cur.className = "cx-pop" + (opts && opts.tui ? " cx-pop-tui" : "");
    cur.innerHTML = h;
    document.body.appendChild(cur);
    bind(cur);
    var r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: innerWidth / 2, right: innerWidth / 2, top: innerHeight / 2, bottom: innerHeight / 2 };
    var left = r.left, summary = cur.querySelector(".cx-sum");
    if (anchor && anchor.classList && anchor.classList.contains("cx-footer-choice") && summary) {
      var range = document.createRange();
      range.selectNodeContents(anchor);
      left = range.getBoundingClientRect().left - (summary.getBoundingClientRect().left - cur.getBoundingClientRect().left);
    }
    var w = cur.offsetWidth, ht = cur.offsetHeight, x = Math.max(8, Math.min(innerWidth - w - 8, left)), y = r.top - ht - 6;
    cur.dataset.up = y < 8 ? "0" : "1";
    if (y < 8) y = Math.min(innerHeight - ht - 8, r.bottom + 6);
    cur.style.left = x + "px"; cur.style.top = Math.max(8, y) + "px";
    return cur;
  }
  // 哪个 agent：点的那个标签页里的；状态栏上的就是当前标签页的
  var rtOf = function (P) { var id = P && P.program && P.program.agentId; return id && window.TSU_AGENTS && TSU_AGENTS.runtime ? TSU_AGENTS.runtime(id) : null; };
  var paneOf = function (el) { var T = window.TSU_TERM; return T && T.panes ? T.panes().filter(function (p) { return p.el && p.el.contains(el); })[0] || null : null; };
  var ctxItem = function (it) { return it && /^\s*(上下文|Context)\s+[\d.<]+%\s*$/.test(it.textContent || "") ? it : null; };
  var frontRt = function () { var T = window.TSU_TERM, tw = T && T.front ? T.front() : null; return rtOf(tw && tw.ws && tw.ws.active); };
  // 指到入口上（GUI 的上下文圆环、状态行的「Ctx」、状态栏的「上下文」）就先去读连接器会话文件的开头：点开时多半已经读好
  document.addEventListener("pointerover", function (e) {
    var t = e.target, ring, rt = null;
    if (!t || !t.closest || !(window.TSU_CLAUDE || window.TSU_CODEX)) return;
    if ((ring = t.closest('[data-c="ctx"]'))) rt = rtOf(paneOf(ring));
    else if (ctxItem(t.closest(".st-item"))) rt = frontRt();
    else if (t.tagName === "SPAN" && /^\s*Ctx: [\d.]+%\s*$/.test(t.textContent || "")) rt = rtOf(paneOf(t));
    if (rt) headOf(rt);
  }, true);
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    // TUI 的状态行：「Ctx: 12%」那一段
    var sp = t.closest("span");
    if (sp && /^\s*Ctx: [\d.]+%\s*$/.test(sp.textContent || "")) {
      var P = paneOf(sp), rt = rtOf(P);
      if (rt) { e.preventDefault(); e.stopPropagation(); open(rt, sp, { tui: !(P.program && P.program.gui) }); }
      return;
    }
    // 窗口底部状态栏的「上下文 n%」
    var it = ctxItem(t.closest(".st-item")), rt2 = it && frontRt();
    if (rt2) { e.stopPropagation(); open(rt2, it, {}); }
  }, true);
  window.TSU_CTX = { data: data, html: html, bind: bind, open: open, close: close };
})();
