// globalagent.js —— 全局助手（Studio Assistant）：辅助侧栏分两层——「Agent」是跟着当前标签页的那个 agent（原来那一层），「全局」是这一个：
//   一个特别的 agent（agent.global，不在 agent 列表、访达里出现），同样的运行时、模型、计费；它不干项目里的活，管的是整个工作区——
//   看各个 agent 在干什么、读它们最近的对话、给它们发消息、新建 / 打断 / 归档；看现在的布局（窗口、编辑组、标签页、侧栏、面板），开 / 切 / 关标签页、
//   开关侧栏面板、改几项界面设置。这些都是页面里跑的工具（agents.js 的 addTools），调的就是 STUDIO / TSU_TERM / TSU_AGENTS 现成的接口。
//   在哪看它：VS Code 风格——辅助侧栏顶上「Agent | 全局」切到全局；Claude App 风格——标题栏右边的「全局助手」卡片；macOS 风格——程序坞里一个 App（窗口）。
(function () {
  "use strict";
  if (window.TSU_GLOBAL) return;
  var root = document.documentElement;
  var A = function () { return window.TSU_AGENTS; }, T = function () { return window.TSU_TERM; }, S = function () { return window.STUDIO; };
  var en = function () { return !!(window.TSU_I18N && TSU_I18N.lang && TSU_I18N.lang() === "en"); };
  var tr = function (zh, e) { return en() ? e : zh; };
  var clip = function (s, n) { s = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  var ago = function (t) { if (!t) return "never"; var s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? Math.round(s) + "s ago" : s < 3600 ? Math.round(s / 60) + "m ago" : s < 86400 ? Math.round(s / 3600) + "h ago" : Math.round(s / 86400) + "d ago"; };
  var NAME = "studio";

  // ---- 那一个 agent：没有就建（等 agent 数据读完再看，免得重复建）；几台设备各建了一个的：用最早的那个 ----
  var gid = "", making = null;
  function agent() { var a = A() && A().globalAgent ? A().globalAgent() : null; if (a) gid = a.id; return a; }
  function ensure() {
    if (agent()) return Promise.resolve(agent());
    if (making) return making;
    making = (A().ready ? A().ready() : Promise.resolve()).then(function () {
      var a = agent();
      if (a) return a;
      var me = A().me ? A().me() : null;
      if (!me || !me.loggedIn) return null; // 没登录：不建
      a = A().create({ name: NAME });
      a.name = NAME; // 名字不编号（它只有一个）
      A().markGlobal(a.id);
      gid = a.id;
      return a;
    }).then(function (a) { making = null; return a; }, function () { making = null; return null; });
    return making;
  }

  // ---- 工具用的小帮手 ----
  var all = function (withArchived) { var l = A().list(); return withArchived && A().archived ? l.concat(A().archived()) : l; };
  function findAgent(q) {
    q = String(q == null ? "" : q).trim();
    if (!q) return null;
    var l = all(true), low = q.toLowerCase();
    return l.filter(function (a) { return a.id === q; })[0] || l.filter(function (a) { return a.name.toLowerCase() === low; })[0] || l.filter(function (a) { return a.id.indexOf(q) === 0; })[0] || null;
  }
  var mustAgent = function (q) { var a = findAgent(q); if (!a) throw new Error('unknown agent "' + q + '" — AgentsOverview lists them'); if (a.global) throw new Error("that is you"); return a; };
  var front = function () { var t = T(); return t && t.front ? t.front() : null; };
  var volLabel = function (a) { try { return A().volLabel ? A().volLabel(A().volOf(a.id)) : ""; } catch (e) { return ""; } };
  var reachable = function (a) { try { return A().reachable ? A().reachable(a.id) : true; } catch (e) { return true; } };
  // 标签页：窗口里的编辑组按顺序编号，标签按组里的顺序——"g0.t1"；也能用 agent 名字 / id、标题找
  function tabsOf(tw) {
    var ws = tw.ws, out = [], groups = ws.groups ? ws.groups() : [];
    groups.forEach(function (g, gi) { (g.editors || []).forEach(function (p, ti) { out.push({ id: "g" + gi + ".t" + ti, p: p, g: g }); }); });
    if (!groups.length && ws.all) ws.all().forEach(function (p, i) { out.push({ id: "t" + i, p: p, g: null }); });
    return out;
  }
  function tabInfo(x, ws) {
    var p = x.p, pr = p.program || {}, title = "";
    try { title = p.title ? p.title() : ""; } catch (e) { title = ""; }
    var kind = pr.agentId ? (/^cc:/.test(pr.agentId) ? "claude-code" : "agent") : pr.page === "web" ? "web" : pr.page === "file" ? "file" : pr.page ? "page" : pr.pty ? "terminal" : "shell";
    var o = { id: x.id, title: clip(title, 80), kind: kind };
    if (pr.agentId) { o.agent = pr.agentId; var a = A().get(pr.agentId); if (a) o.agentName = a.name; }
    if (pr.page && kind === "page") o.page = pr.page;
    if (pr.page && pr.arg) o[kind === "web" ? "url" : kind === "file" ? "path" : "arg"] = String(pr.arg);
    if (x.g && x.g.active === p) o.active = true;
    if (ws.active === p) o.focused = true;
    return o;
  }
  function findTab(tw, q) {
    q = String(q == null ? "" : q).trim();
    var tabs = tabsOf(tw), low = q.toLowerCase();
    var hit = tabs.filter(function (x) { return x.id === q; })[0];
    if (hit) return hit;
    var a = findAgent(q);
    if (a) hit = tabs.filter(function (x) { return x.p.program && x.p.program.agentId === a.id; })[0];
    if (hit) return hit;
    return tabs.filter(function (x) { var t = ""; try { t = x.p.title(); } catch (e) { t = ""; } return String(t).toLowerCase() === low; })[0] ||
      tabs.filter(function (x) { var t = ""; try { t = x.p.title(); } catch (e) { t = ""; } return low && String(t).toLowerCase().indexOf(low) >= 0; })[0] || null;
  }
  function gridOf(ws, n, gi) {
    if (!n) return null;
    if (n.g) return { group: gi.get(n.g), tabs: (n.g.editors || []).map(function (p, ti) { return tabInfo({ id: "g" + gi.get(n.g) + ".t" + ti, p: p, g: n.g }, ws); }) };
    return { split: n.dir === "row" ? "left|right" : "top|bottom", ratio: Math.round((n.ratio || 0.5) * 100) / 100, a: gridOf(ws, n.a, gi), b: gridOf(ws, n.b, gi) };
  }
  // 一轮对话压成几行字（ReadAgent 用）
  function toolLine(p) {
    var i = p.input || {}, arg = i.command || i.file_path || i.path || i.pattern || i.url || i.query || i.description || i.to || i.subject || "";
    return "  · " + p.name + (arg ? "(" + clip(arg, 90) + ")" : "") + (p.status && p.status !== "done" ? " [" + p.status + "]" : "") + (p.status === "error" && (p.error || p.summary) ? " — " + clip(p.error || p.summary, 140) : "");
  }
  function turnText(t) {
    var L = [];
    if (t.recap !== undefined) return ["※ recap: " + clip(t.recap, 400)];
    if (t.cmd !== undefined) return ["❯ " + clip(t.cmd, 200) + (t.note ? "  ⎿ " + clip(t.note, 200) : "")];
    if (t.bash !== undefined) return ["! " + clip(t.bash, 200) + (t.out ? "  ⎿ " + clip(t.out, 300) : "")];
    if (t.system && t.social) (t.social || []).forEach(function (m) { L.push("➤ from " + (m.from_name || m.from) + ": " + clip(m.text, 300)); });
    else if (t.system) L.push("(system: " + clip(t.ask || "notice", 160) + ")");
    else if (t.ask) L.push("❯ " + clip(t.ask, 500));
    (t.parts || [{ kind: "text", text: t.answer || "" }]).forEach(function (p) {
      if (p.kind === "tool") L.push(toolLine(p));
      else if (p.kind === "text" && String(p.text || "").trim()) L.push("⏺ " + clip(p.text, 900));
    });
    if (t.error) L.push("  ⎿ error: " + clip(t.error, 300));
    return L;
  }

  // ======== 工具 ========
  var AGENT_Q = { type: "string", description: "Agent name or id (8-hex id or a unique prefix)" };
  var TAB_Q = { type: "string", description: "Tab id from GetLayout (e.g. \"g0.t1\"), or an agent name / id, or a tab title" };
  var DEFS = [
    { name: "AgentActivity", description: "Live activity monitor of every open agent session (like macOS Activity Monitor): status (running / waiting-for-you / idle), what it is doing right now, how long the current turn has been running (or how long it has been idle), tool calls this turn, context used %, background tasks running, and the CPU %, memory (MB) and process count of the session's whole process tree (Claude Code sessions: its claude process plus every command / dev server it started; Codex sessions share one service, so null). Also the recent total CPU history. Use it for questions like: what are my agents doing, which one is stuck or waiting for me, what is using the CPU or memory.",
      input_schema: { type: "object", properties: {} } },
    { name: "AgentsOverview", description: "Awareness of every agent in this workspace: id, name, folder, volume, state (working / waiting / idle), what it is doing right now, running background shells and sub-agents, last activity, whether it is open in a tab, pinned. Read this before acting on agents.",
      input_schema: { type: "object", properties: { include_archived: { type: "boolean", description: "Also list archived agents" } } } },
    { name: "ReadAgent", description: "Read another agent's recent conversation, condensed: prompts (❯), replies (⏺), tool calls (·) with status, errors, messages it received.",
      input_schema: { type: "object", properties: { agent: AGENT_Q, last: { type: "number", description: "How many recent turns (default 6, max 30)" } }, required: ["agent"] } },
    { name: "CreateAgent", description: "Create a new agent; optionally give it a first task (sent as the user's message) and open it in a tab.",
      input_schema: { type: "object", properties: { name: { type: "string", description: "Letters, digits, . - _; omit for the next paimon-NN" }, prompt: { type: "string", description: "First message to send it" }, open: { type: "boolean", description: "Open it in a tab (default false)" } } } },
    { name: "InterruptAgent", description: "Stop what another agent is doing right now (its current turn); it keeps its history.",
      input_schema: { type: "object", properties: { agent: AGENT_Q }, required: ["agent"] } },
    { name: "ArchiveAgent", description: "Archive an agent (hidden from the lists, nothing is deleted; it can be unarchived). Only when the user asked for it.",
      input_schema: { type: "object", properties: { agent: AGENT_Q }, required: ["agent"] } },
    { name: "GetLayout", description: "The current workspace layout: Application style, agent view style, theme, the editor area as a tree of splits → groups → tabs (ids like g0.t1, kind agent/page/file/web/terminal, which is active/focused), primary side bar (shown, view), secondary side bar, bottom panel (open, maximized), status bar, activity bar.",
      input_schema: { type: "object", properties: {} } },
    { name: "OpenTab", description: "Open something in the editor area: an agent, a page, a file or a web page; where = tab (default, in the current group), split-right, split-down or new-window.",
      input_schema: { type: "object", properties: { agent: AGENT_Q, page: { type: "string", enum: ["settings", "explorer", "history", "changelog", "extension"], description: "A built-in page (explorer = Finder; arg is a path or \"agents\")" }, arg: { type: "string" }, file: { type: "string", description: "A file path" }, url: { type: "string" },
        where: { type: "string", enum: ["tab", "split-right", "split-down", "new-window"] } } } },
    { name: "FocusTab", description: "Bring a tab to the front and focus it.", input_schema: { type: "object", properties: { tab: TAB_Q }, required: ["tab"] } },
    { name: "CloseTab", description: "Close a tab (an agent keeps running in the background). The user is asked first if something could be lost.", input_schema: { type: "object", properties: { tab: TAB_Q }, required: ["tab"] } },
    { name: "SetLayout", description: "Show or hide parts of the workbench (VS Code style): primarySideBar (true / false or a view: agents, files, search, extensions), secondarySideBar, panel, panelMaximized, statusBar, activityBar (true / false or side / top / bottom).",
      input_schema: { type: "object", properties: { primarySideBar: { type: "string", description: "show, hide, or a view to show: agents, files, search, extensions" }, secondarySideBar: { type: "boolean" }, panel: { type: "boolean" }, panelMaximized: { type: "boolean" }, statusBar: { type: "boolean" },
        activityBar: { type: "string", description: "show, hide, or a position: side, top, bottom" } } } },
    { name: "SetSetting", description: "Change one interface setting (whitelisted: " + "os, ui, lang, colorScheme, highlightScheme, fontSize, transcriptSize, uiFont, activityPos, activitySize, activityBar, sideBarPos, panelAlign, tabBar, tabBarPos, editorActions, statusBar, breadcrumbs, minimap, density, quickInput, macDock, macDockSize, macMagnify, macAutoHide, macWidgets, macWall" + "). Returns the value now in effect.",
      input_schema: { type: "object", properties: { key: { type: "string" }, value: { description: "A string, number or boolean" } }, required: ["key", "value"] } },
  ];
  var SETTABLE = {
    os: ["vscode", "claude", "macos", "terminal"], ui: ["tui", "gui"], lang: ["zh", "en"], colorScheme: "string", highlightScheme: "string", fontSize: "number", transcriptSize: ["small", "medium", "large"], uiFont: ["auto", "system", "mono"],
    activityPos: ["side", "top", "bottom"], activitySize: ["normal", "compact"], activityBar: "boolean", sideBarPos: ["left", "right"], panelAlign: ["left", "right", "center", "justify"], tabBar: ["multiple", "single", "hidden"], tabBarPos: ["top", "bottom"],
    editorActions: ["tabbar", "titlebar", "hidden"], statusBar: "boolean", breadcrumbs: "boolean", // statusLine 没了：agent 的状态信息定在它底部、输入框下面 minimap: ["show", "scroll", "transparent", "hide"], density: ["default", "compact"], quickInput: ["top", "center"],
    macDock: ["bottom", "left", "right"], macDockSize: "number", macMagnify: "boolean", macAutoHide: "boolean", macWidgets: "boolean", macWall: ["pub-sunset", "pub-emerald", "graphite", "black"],
  };
  var RUN = {
    AgentActivity: function () {
      var s = window.TSU_TRACE && TSU_TRACE.snapshot ? TSU_TRACE.snapshot() : null;
      if (!s) return { text: "Agent Activity isn't available here.", summary: "unavailable" };
      var busy = s.agents.filter(function (x) { return x.status !== "idle"; }).length;
      return { text: JSON.stringify(s, null, 1), summary: s.agents.length + " open sessions, " + busy + " busy" };
    },
    AgentsOverview: function (a) {
      var l = all(!!a.include_archived);
      if (!l.length) return { text: "No agents yet (CreateAgent makes one).", summary: "0 agents" };
      var open = {};
      (T().panes ? T().panes() : []).forEach(function (p) { var id = p.program && p.program.agentId; if (id) open[id] = (open[id] || 0) + 1; });
      var rows = l.map(function (x) {
        var rt = A().runtime(x.id), st = rt ? rt.state() : "idle", tasks = (rt && rt.tasks) || [];
        var bg = tasks.filter(function (k) { return k.status === "running" && k.kind === "shell"; }).length, subs = tasks.filter(function (k) { return k.status === "running" && k.kind !== "shell"; }).length;
        var bits = [x.name, "id " + x.id, st + (x.archived ? " (archived)" : ""), "now: " + (clip(rt ? rt.tail() : "", 90) || "—")];
        if (x.path) bits.push("folder " + x.path);
        var v = volLabel(x);
        if (v) bits.push("volume " + v + (reachable(x) ? "" : " (not reachable from this device)"));
        if (bg || subs) bits.push("running: " + bg + " shell, " + subs + " sub-agent");
        bits.push("last active " + ago(x.active));
        if (open[x.id]) bits.push("open in " + open[x.id] + " tab");
        if (x.pinned) bits.push("pinned");
        return "- " + bits.join(" · ");
      });
      return { text: rows.join("\n"), summary: "Agents " + l.length };
    },
    ReadAgent: function (a) {
      var x = mustAgent(a.agent), n = Math.max(1, Math.min(30, Math.round(+a.last || 6)));
      if (!reachable(x)) return { text: x.name + " lives on " + (volLabel(x) || "another device") + " — its conversation isn't reachable from this device." };
      var load = A().volLoad ? A().volLoad(x.id) : Promise.resolve();
      return Promise.race([Promise.resolve(load).catch(function () {}), new Promise(function (r) { setTimeout(r, 3000); })]).then(function () {
        var rt = A().runtime(x.id), turns = rt.session().turns || [], take = turns.slice(-n), L = [];
        L.push(x.name + " (" + x.id + ") — " + rt.state() + (rt.stream ? ", working on the turn below" : "") + "; " + turns.length + " turns in this session, showing the last " + take.length + ".");
        take.forEach(function (t) { L.push(""); L = L.concat(turnText(t)); });
        return { text: L.join("\n"), summary: x.name + " · " + take.length + " turns" };
      });
    },
    CreateAgent: function (a) {
      var name = a.name && A().validName && A().validName(String(a.name)) ? String(a.name) : undefined;
      var x = A().create(name ? { name: name } : {});
      var sent = false;
      if (a.prompt && String(a.prompt).trim()) { var rt = A().runtime(x.id); sent = rt.send(String(a.prompt)) !== false; }
      if (a.open && T().agent) T().agent(x.id);
      return { text: "Created " + x.name + " (" + x.id + ")" + (a.prompt ? sent ? ", sent it the first task" : ", but couldn't send the first task" : "") + (a.open ? ", opened it in a tab" : "") + "." };
    },
    InterruptAgent: function (a) { var x = mustAgent(a.agent), rt = A().runtime(x.id), was = rt.state(); rt.interrupt(); return { text: was === "working" ? "Interrupted " + x.name + "." : x.name + " wasn't working (" + was + "); nothing to interrupt." }; },
    ArchiveAgent: function (a) { var x = mustAgent(a.agent); if (x.archived) return { text: x.name + " is already archived." }; A().archive(x.id); return { text: "Archived " + x.name + " (nothing deleted; it can be unarchived)." }; },
    GetLayout: function () {
      var tw = front(), st = S();
      if (!tw) return { text: "No window." };
      var ws = tw.ws, groups = ws.groups ? ws.groups() : [], gi = new Map(groups.map(function (g, i) { return [g, i]; }));
      var o = {
        os: st.get("os"), viewer: st.get("ui"), theme: root.classList.contains("light") ? "light" : "dark", colorScheme: st.get("colorScheme"), lang: st.get("lang"),
        window: window.TSU_WIN ? TSU_WIN.id : 1,
        primarySideBar: { shown: !!(tw.side && tw.side.shown && tw.side.shown()), view: tw.stView || "agents", position: st.get("sideBarPos") },
        secondarySideBar: { shown: !!(st.isOpen && st.isOpen()), level: tw.st && tw.st.side && tw.st.side.classList.contains("st-lv-global") ? "global" : "agent" },
        panel: { open: !!(st.panelOpen && st.panelOpen()), maximized: !!(tw.st && tw.st.panel && tw.st.panel.classList.contains("max")), align: st.get("panelAlign") },
        statusBar: !!st.get("statusBar"), activityBar: st.get("activityBar") === false ? "hidden" : st.get("activityPos"),
        editor: ws.itabs ? { itermTabs: ws.itabs.map(function (gr) { var g2 = []; (function walk(n) { if (!n) return; if (n.g) g2.push(n.g); else { walk(n.a); walk(n.b); } })(gr); var m = new Map(g2.map(function (g, i) { return [g, i]; })); return gridOf(ws, gr, m); }), current: ws.ti } : gridOf(ws, ws.grid, gi),
      };
      return { text: JSON.stringify(o, null, 1), summary: groups.length + " group" + (groups.length === 1 ? "" : "s") + " · " + tabsOf(tw).length + " tabs" };
    },
    OpenTab: function (a) {
      var tw = front(), st = S(), where = a.where || "tab", spec, what;
      if (!tw) throw new Error("no window");
      if (a.agent) { var x = mustAgent(a.agent); spec = { agent: x.id }; what = x.name; }
      else if (a.url) { var u = window.TSU_WEB && TSU_WEB.normalize ? TSU_WEB.normalize(a.url) : String(a.url); spec = { page: "web", arg: u }; what = u; }
      else if (a.file) { spec = { page: "file", arg: String(a.file) }; what = a.file; }
      else if (a.page) { if (["settings", "explorer", "history", "changelog", "extension"].indexOf(a.page) < 0) throw new Error("page must be settings, explorer, history, changelog or extension"); spec = { page: a.page, arg: a.arg || null }; what = a.page + (a.arg ? " " + a.arg : ""); }
      else throw new Error("give agent, page, file or url");
      if (where === "new-window") {
        if (!window.nadosNative) throw new Error("new windows need the Mac app");
        return nadosNative.call("window.new", { open: JSON.stringify(spec) }).then(function () { return { text: "Opened " + what + " in a new window." }; });
      }
      var prog = function (P) { return spec.agent ? T().makeView(P, spec.agent) : st.page(P, spec.page, spec.arg); };
      if ((where === "split-right" || where === "split-down") && tw.ws.splitTo && tw.ws.active && tw.ws.groups && tw.ws.groups().length) {
        tw.ws.splitTo(where === "split-right" ? "right" : "bottom");
        var np = tw.ws.active;
        np.run(prog(np));
        if (tw.ws.layout) tw.ws.layout();
        return { text: "Opened " + what + " in a split " + (where === "split-right" ? "to the right" : "below") + "." };
      }
      if (spec.agent) T().agent(spec.agent);
      else if (spec.page === "changelog" && window.TSU_CHANGELOG) TSU_CHANGELOG.open(tw);
      else if (spec.page === "web" && window.TSU_WEB) TSU_WEB.open(tw, spec.arg);
      else st.openPage(tw, spec.page, spec.arg);
      return { text: "Opened " + what + " in a tab." };
    },
    FocusTab: function (a) {
      var tw = front(), x = tw && findTab(tw, a.tab);
      if (!x) throw new Error('no tab matches "' + a.tab + '" (GetLayout lists them)');
      tw.ws.show(x.p);
      if (x.p.focus) x.p.focus();
      return { text: "Focused " + clip(x.p.title ? x.p.title() : x.id, 60) + "." };
    },
    CloseTab: function (a) {
      var tw = front(), x = tw && findTab(tw, a.tab);
      if (!x) throw new Error('no tab matches "' + a.tab + '" (GetLayout lists them)');
      var title = clip(x.p.title ? x.p.title() : x.id, 60);
      return new Promise(function (res) {
        var done = false, go = function () { done = true; tw.ws.closePane(x.p); res({ text: "Closed " + title + "." }); };
        if (T().askClose) T().askClose([x.p], tr("标签页", "tab"), go); else go();
        setTimeout(function () { if (!done) res({ text: "Asked the user before closing " + title + " (it isn't closed unless they confirm)." }); }, 400);
      });
    },
    SetLayout: function (a) {
      var tw = front(), st = S(), did = [];
      if (!tw) throw new Error("no window");
      if (!root.classList.contains("st-os-vscode")) did.push("(note: side bars and the panel are part of the VS Code style; the current style is " + st.get("os") + ")");
      var onoff = function (v) { return v === true || v === "true" || v === "show" ? true : v === false || v === "false" || v === "hide" ? false : null; };
      if (a.primarySideBar !== undefined && tw.side) {
        var ps = onoff(a.primarySideBar);
        if (ps === null) { st.showView(tw, String(a.primarySideBar)); did.push("primary side bar → " + a.primarySideBar); }
        else { tw.side.toggle(ps); did.push("primary side bar " + (ps ? "shown" : "hidden")); }
      }
      if (a.secondarySideBar !== undefined) { st.toggle(tw, !!a.secondarySideBar); did.push("secondary side bar " + (a.secondarySideBar ? "shown" : "hidden")); }
      if (a.panel !== undefined) { st.togglePanel(tw, !!a.panel); did.push("panel " + (a.panel ? "open" : "closed")); }
      if (a.panelMaximized !== undefined && tw.st && tw.st.panel) {
        if (a.panelMaximized && !st.panelOpen()) st.togglePanel(tw, true);
        var mx = tw.st.panel.classList.contains("max"), b = tw.st.panel.querySelector('[data-st="panel-max"]');
        if (!!a.panelMaximized !== mx && b) b.click();
        did.push("panel " + (a.panelMaximized ? "maximized" : "restored"));
      }
      if (a.statusBar !== undefined) { st.setv("statusBar", !!a.statusBar); did.push("status bar " + (a.statusBar ? "shown" : "hidden")); }
      if (a.activityBar !== undefined) {
        var ab = onoff(a.activityBar);
        if (ab === null) { if (["side", "top", "bottom"].indexOf(a.activityBar) < 0) throw new Error("activityBar: show, hide, side, top or bottom"); st.setv("activityPos", a.activityBar); st.setv("activityBar", true); did.push("activity bar → " + a.activityBar); }
        else { st.setv("activityBar", ab); did.push("activity bar " + (ab ? "shown" : "hidden")); }
      }
      return { text: did.length ? did.join("; ") + "." : "Nothing to change." };
    },
    SetSetting: function (a) {
      var k = String(a.key || ""), v = a.value, rule = SETTABLE[k], st = S();
      if (!rule) throw new Error("not a setting I may change: " + k);
      if (Array.isArray(rule) && rule.indexOf(v) < 0) throw new Error(k + " must be one of " + rule.join(", "));
      if (rule === "number") { v = +v; if (!isFinite(v)) throw new Error(k + " must be a number"); }
      if (rule === "boolean") v = v === true || v === "true";
      if (rule === "string") v = String(v);
      st.setv(k, v);
      var now = st.get(k);
      return { text: k + " = " + JSON.stringify(now) + (JSON.stringify(now) !== JSON.stringify(v) ? " (" + JSON.stringify(v) + " isn't available in the current style)" : "") + "." };
    },
  };
  var PROMPT = "YOU ARE THE STUDIO ASSISTANT — the workspace-level agent of Vibing Studio. You don't work on projects yourself: you watch and manage the other agents and the workspace for the user. " +
    "Agents: AgentsOverview (who exists, what each is doing), ReadAgent (their recent conversation), SendMessage (talk to one; they can't see your replies), CreateAgent, InterruptAgent, ArchiveAgent. " +
    "Workspace: GetLayout (styles, split tree, tabs, side bars, panel), OpenTab (agent / page / file / url; tab, split-right, split-down, new-window), FocusTab, CloseTab, SetLayout, SetSetting. " +
    "Always read the current state (AgentsOverview / GetLayout) before acting, change things in small steps, and tell the user exactly what you changed. Don't archive agents or close tabs unless the user asked for it.";
  function install() {
    if (!A() || !A().addTools) return false;
    A().addTools({ when: function (a) { return !!(a && a.global); }, defs: DEFS, run: function (name, input) { return RUN[name](input || {}); }, prompt: function () { return PROMPT; } });
    return true;
  }
  if (!install()) document.addEventListener("DOMContentLoaded", install);

  // ======== 显示：一个自己的面板（Pane），挂到哪儿都是它（VS Code 的辅助侧栏「全局」、Claude App 的「全局助手」卡片、macOS 的窗口）========
  var viewFor = function (P, id) { var gui = S() && S().get && S().get("ui") === "gui" && window.TSU_GUI; return gui ? TSU_GUI.view(P, id) : T().agentView(P, id); };
  function mount(tw, host) {
    if (!host || !tw || !T() || !T().globalPane) return;
    var a = agent();
    if (!a) {
      if (!host.querySelector(".st-gwait")) host.innerHTML = '<div class="st-dim st-gwait">' + tr("正在准备全局助手…", "Getting the Studio Assistant ready…") + "</div>";
      ensure().then(function (x) { if (x) mount(tw, host); else host.innerHTML = '<div class="st-dim st-gwait">' + tr("登录以后才能用全局助手", "Sign in to use the Studio Assistant") + "</div>"; });
      return;
    }
    var gp = T().globalPane(tw), want = S() && S().get("ui") === "gui" && window.TSU_GUI ? "gui" : "tui";
    var w0 = host.querySelector(".st-gwait");
    if (w0) w0.remove();
    if (gp.el.parentNode !== host) host.appendChild(gp.el);
    if (!gp.onRun) gp.onRun = function (prog) { // 在这一块里切到别的 agent、退出：别的 agent 开到编辑区去，这里一直是全局助手
      if (prog && prog.agentId && prog.agentId !== gid) { if (T().agent) T().agent(prog.agentId); return true; }
      if (prog === gp.shell) return true;
      return false;
    };
    gp.view = null; gp.compact = false;
    if (!gp.program || gp.program.agentId !== a.id || (gp.program.gui ? "gui" : "tui") !== want) { gp.ta.value = ""; gp.run(viewFor(gp, a.id), true); }
    else if (gp.renderLater) gp.renderLater();
  }
  // 辅助侧栏「全局」那一层的 ···
  function menu(tw) {
    var a = agent();
    return [
      { label: tr("在编辑区中打开", "Open in Editor"), run: function () { if (a && T().agent) T().agent(a.id); } },
      { label: tr("新会话", "New Session"), disabled: !a, run: function () { var rt = a && A().runtime(a.id); if (rt && rt.clear) rt.clear(); } }, // 从头开始一段新的（旧的会话都还在）
      { sep: true },
      { label: tr("隐藏辅助侧栏", "Hide Secondary Side Bar"), keys: "⌥⌘I", run: function () { if (S().toggle && tw) S().toggle(tw, false); } },
    ];
  }
  window.TSU_GLOBAL = { ensure: ensure, agent: agent, id: function () { var a = agent(); return a ? a.id : ""; }, mount: mount, menu: menu, tools: DEFS, run: function (n, i) { return Promise.resolve(RUN[n](i || {})); } };
  if (window.TSU_I18N && TSU_I18N.add) TSU_I18N.add({ "全局": "Global", "全局助手": "Studio Assistant", "在编辑区中打开": "Open in Editor", "新会话": "New Session", "正在准备全局助手…": "Getting the Studio Assistant ready…", "登录以后才能用全局助手": "Sign in to use the Studio Assistant" });
})();
