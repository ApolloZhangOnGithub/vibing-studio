// agents.js —— agent 的运行时（不碰界面）。全局 TSU_AGENTS
// agent 是一个持续存在的个体：固定的 8 位 id（目录 /agents/<id>、文件属主、各种引用都用它；改名什么都不用动）、名字（人起的，只用来显示和输入）、
// 模型、思考强度（effort）、出了自己目录的权限（access）。会话（session）是它的一段对话：/clear 开新会话，agent 还是那个 agent。
// ReAct 循环、工具、后台任务、hibernate / 唤醒都在这里，和窗口无关——终端面板只是「接上」一个 agent 看它、跟它说话；
// 关掉面板 agent 照样睡着或干着活。子 agent（Agent 工具）是它的器官：同一个身份、同一个目录，不另开目录。
// 存储：IndexedDB tsu-agents（agents、sessions 两张表）；第一次运行时把以前 localStorage 里的会话按名字归到 agent 下（原数据不删）
(function () {
  "use strict";
  // 版本号 0.1.<提交数>；系统自己的文件都在沙盒的 /.paimon 下面（同 teyvat 的 ~/.teyvat）：config/settings.json、IdentityData/<id>.json、MemoryData/<id>/
  var SPIRIT = { version: "0.1.74", home: "/.paimon", settings: "/.paimon/config/settings.json" };
  // 循环方式。REACT = true：ReAct——每一步都必须调工具（tool_choice: any），只有 hibernate 能停下（可以定时醒）。
  // 暂时关掉（用户的决定），用传统的工具循环：模型不再调工具就是这一问答完了（同 Claude Code）。hibernate 相关的代码都留着，改回 true 就恢复
  var REACT = false;

  // ---- 小工具（界面也用：TSU_AGENTS.fmt）----
  var fmtK = function (n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + "m" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n || 0); };
  var fmtDur = function (ms) { var s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + "h " : "") + (h || m ? m + "m " : "") + (s % 60) + "s"; };
  var money = function (micro) { var y = (micro || 0) / 1e6; return (y < 0 ? "-¥" : "¥") + (Math.abs(y) < 1 && y !== 0 ? Math.abs(y).toFixed(4) : Math.abs(y).toFixed(2)); };
  var plural = function (n, w) { return n + " " + w + (n === 1 ? "" : "s"); };
  var kb = function (n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + "MB" : n >= 1024 ? (n / 1024).toFixed(1) + "KB" : n + "B"; };
  function hexId() { var a = new Uint8Array(4); crypto.getRandomValues(a); return Array.from(a, function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join(""); }
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function titleOf(turns) { var t = turns.find(function (x) { return x.ask && !x.system; }); return t ? t.ask.replace(/\s+/g, " ").slice(0, 60) : ""; }
  function readSSE(reader, cb) {
    var dec = new TextDecoder(), buf = "";
    return (function pump() {
      return reader.read().then(function (r) {
        if (r.done) return;
        buf += dec.decode(r.value, { stream: true });
        var i;
        while ((i = buf.indexOf("\n")) >= 0) {
          var line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (line.indexOf("data:") === 0) { try { cb(JSON.parse(line.slice(5))); } catch (e) { /* 不完整的行 */ } }
        }
        return pump();
      });
    })();
  }
  function Emitter() { this.fns = []; }
  Emitter.prototype.on = function (fn) { var self = this; this.fns.push(fn); return function () { self.fns = self.fns.filter(function (f) { return f !== fn; }); }; };
  Emitter.prototype.emit = function (type, data) { this.fns.slice().forEach(function (f) { try { f(type, data); } catch (e) { console.error(e); } }); };
  var hub = new Emitter(); // 全局事件："agents"（列表 / 某个 agent 的状态变了）、"me"（账号）、"cfg"（设置）

  // ---- 价格（同服务器）：元 / 百万 token；DeepSeek 的高峰是北京时间工作日 9–12、14–18 点，其余时段按 offpeak 打折 ----
  function isPeak(t) {
    var d = new Date((t || Date.now()) + 8 * 3600e3), day = d.getUTCDay(), m = d.getUTCHours() * 60 + d.getUTCMinutes();
    return day >= 1 && day <= 5 && ((m >= 540 && m < 720) || (m >= 840 && m < 1080));
  }
  function priceOf(model, u, peak) {
    if (!model) return 0;
    var hit = model.hit !== undefined ? model.hit : model.in * 0.1;
    var y = (u.input || 0) * model.in + (u.cacheRead || 0) * hit + (u.cacheWrite || 0) * (model.write !== undefined ? model.write : model.in) + (u.output || 0) * model.out;
    return Math.ceil(y * (peak ? 1 : model.offpeak || 1));
  }

  // ---- 设置：本质是沙盒里的 /.paimon/config/settings.json（人能改；rw 档位的 agent 也能改，改了立刻生效）；本地也存一份，沙盒没就绪时先用它 ----
  var STATUS_FIELDS = ["balance", "context", "cost", "model", "cwd", "access"], FOOTER_FIELDS = ["duration", "time", "tokens", "cost"];
  // 对话里的工具按类显示：一次工具调用 = 调用（⏺ Name(参数)）+ 结果（⎿ …）；每类一个档位——
  //   full 完整结果（调用 + 全部结果）/ preview 结果预览（调用 + 结果的前几行）/ call 只看调用（一行调用 + 一行摘要）/ hidden 隐藏
  var TOOL_MODES = ["full", "preview", "call", "hidden"];
  var TOOL_KEYS = ["toolRead", "toolBash", "toolEdit", "toolWeb", "toolAgent", "toolTodo", "toolOther"];
  // 工具属于哪一类（MCP 之类没列出来的都是「其他工具」）
  function toolCat(name) {
    name = String(name || "");
    if (/^(Read|Glob|Grep|LS|NotebookRead)$/.test(name)) return "toolRead";
    if (/^(Bash|BashOutput|KillShell|KillBash|TaskOutput|TaskStop)$/.test(name)) return "toolBash";
    if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(name)) return "toolEdit";
    if (/^(web_search|WebSearch|WebFetch)$/.test(name)) return "toolWeb";
    if (/^(Agent|Task|SendMessage|ListAgents)$/.test(name)) return "toolAgent";
    if (/^(TodoWrite|TaskCreate|TaskUpdate|TaskList|TaskGet)$/.test(name)) return "toolTodo";
    return "toolOther";
  }
  var CFG_DEFAULT = { thinking: "collapsed", tips: true, autoscroll: true, copyOnSelect: true, time: "12h", webSearch: true, webFetch: true, sandbox: true, wrap: "wrap", recap: true, taskList: true, bgList: true, subList: true, infoList: false, footInfo: true, translateTasks: "off", translateReplies: "off", translateShow: "swap",
    statusline: ["balance", "context"], footer: ["duration"], instructions: "", defaultModel: "",
    toolRead: "call", toolBash: "preview", toolEdit: "preview", toolWeb: "call", toolAgent: "call", toolTodo: "full", toolOther: "preview", mergeReads: true, errorsFull: true, sysErrors: "full", workLine: "full", progress: "full", toolModes: {}, agentPrompt: false, agentSteps: true, agentResult: true, timestamps: "hide",
    bashOut: "preview", recaps: true, notices: true, images: true, imageShow: "hover", doneLine: true, prompts: true, answers: true, // 回顾（※ recap）：同 Claude Code 自己，默认显示
    // agent 之间的消息：全部一个档位，收到的 / 发出的 / 子 Agent 报告各自能单独设（inherit = 跟「全部」）。
    // 对话里各种内容的出厂值 = 「Claude Code 原样」那一套（live.js 的 CC_VALS：和 Claude Code 自己画的一样）
    agentMsgs: "line", agentIn: "inherit", agentOut: "inherit", agentReports: "inherit" };
  // 每一项能取什么（文件里写错的那一项不认、用默认；整个文件不是 JSON 就保留上一次好的）；help settings 讲的就是这张表
  var CFG_SCHEMA = {
    thinking: { one: ["hidden", "collapsed", "expanded"], about: "how the model's thinking is shown in the terminal" },
    tips: { bool: true, about: "show hints in the input placeholder" },
    autoscroll: { bool: true, about: "follow new output to the bottom" },
    copyOnSelect: { bool: true, about: "copy terminal selections to the clipboard" },
    time: { one: ["12h", "24h"], about: "clock format in the terminal" },
    webSearch: { bool: true, about: "give agents the web_search tool (if the server has a search key)" },
    webFetch: { bool: true, about: "give agents the WebFetch tool" },
    sandbox: { bool: true, about: "give agents the sandbox tools (Bash, Read, Write, Edit, Glob, Grep)" },
    wrap: { one: ["wrap", "clip"], about: "long lines in code, diffs and tool output: wrap (default) or clip" },
    recap: { bool: true, about: "coming back to an agent after 30 minutes away: a one- or two-sentence ※ recap of where things stand (/recap any time)" },
    taskList: { bool: true, about: "show the agent's task list in the agent's right side panel (ctrl+t toggles)" },
    // agent 自己那几块的开关（位置是定死的：任务清单、后台任务、子 Agent 在 agent 的右侧；运行状态、输入框、状态信息在 agent 底部）
    bgList: { bool: true, about: "show the agent's background commands in its right side panel" },
    subList: { bool: true, about: "show the agent's subagents in its right side panel" },
    infoList: { bool: true, about: "show a Claude Code session's details (created, working time, tokens) in its right side panel" },
    translateTasks: { one: ["off", "display", "zh", "en", "ja", "ko", "fr", "de", "es"], about: "translate task titles, background task and subagent descriptions and the working line into a language (display = the display language); uses your credit, cached so nothing is translated twice" },
    translateShow: { one: ["swap", "only"], about: "how translated replies appear: swap = show the original first, replace it when the translation arrives; only = show nothing until the translation is ready (no original flashing)" },
    translateReplies: { one: ["off", "display", "zh", "en", "ja", "ko", "fr", "de", "es"], about: "translate the agent's replies (its messages, not tool output or code) into a language (display = the display language); uses your credit, cached per paragraph so nothing is translated twice" },
    footInfo: { bool: true, about: "show the status info (access, balance, context, model) at the bottom of the agent, under the input" },
    statusline: { some: STATUS_FIELDS, about: "fields under the input box" },
    footer: { some: FOOTER_FIELDS, about: "what the ✻ line after each answer shows" },
    instructions: { text: 8000, about: "custom instructions added to every agent's system prompt" },
    defaultModel: { text: 80, about: "model id for new agents (\"\" = the first model)" },
    // 对话里显示什么（编辑区标签栏的 ··· ；设置 › 对话）：工具每类一个档位（full / preview / call / hidden，见 TOOL_MODES）
    toolRead: { one: TOOL_MODES, about: "read & search tools (Read, Glob, Grep, LS): full result, result preview, call only (default) or hidden" },
    toolBash: { one: TOOL_MODES, about: "commands the agent runs (Bash, background command output): full, preview (default), call only or hidden" },
    toolEdit: { one: TOOL_MODES, about: "file changes (Edit, Write, MultiEdit): the whole diff, a preview (default), call only or hidden" },
    toolWeb: { one: TOOL_MODES, about: "web search and fetch: full, preview, call only (default) or hidden" },
    toolAgent: { one: TOOL_MODES, about: "subagent launches: full, preview, call only (default: one status line, like Claude Code) or hidden" },
    agentMsgs: { one: ["full", "line", "hidden"], about: "messages between agents, all kinds: full, line (default, collapsed like Claude Code) or hidden" },
    agentIn: { one: ["inherit", "full", "line", "hidden"], about: "messages other agents sent to this one: inherit (default: follows agentMsgs), full, line or hidden" },
    agentOut: { one: ["inherit", "full", "line", "hidden"], about: "this agent's SendMessage calls: inherit (default), full, line or hidden" },
    agentReports: { one: ["inherit", "full", "line", "hidden"], about: "subagent reports (finished / failed / stopped): inherit (default), full, line or hidden" },
    toolTodo: { one: TOOL_MODES, about: "task list tools (TodoWrite, TaskCreate…): full (default), preview, call only or hidden" },
    toolOther: { one: TOOL_MODES, about: "every other tool (MCP and the rest): full, preview (default), call only or hidden" },
    mergeReads: { bool: true, about: "combine consecutive read & search calls into one line (\"Read 3 files, searched for 2 patterns\")" },
    errorsFull: { bool: true, about: "always show failed tool results in full, whatever their category's setting" },
    // 系统错误：不是模型说的、也不是工具的——API 出错（402 额度、429、5xx、过载）、网络、登录与权限、沙盒不可用、中断、模型什么都没回……
    // 回答分两种：过程说明（一问里夹在工具调用之间的话，同「Now the Extensions view itself…」）/ 最终回复（最后一次调用工具之后说给你的话，answers）；
    // 在跑的这一问，最后那段先算过程说明，答完了才是最终回复
    progress: { one: ["full", "line", "hidden"], about: "progress notes — the agent's text between tool calls within a turn: in full (default), one line or hidden (the final reply after the last tool call is answers)" },
    // 按工具：给某一个工具单独设档位，盖过它那一类（{ "Bash": "full", "mcp__github__create_issue": "hidden" }；没写的跟着类别）
    toolModes: { map: TOOL_MODES, about: "per-tool display modes that override the tool's category, e.g. { \"Bash\": \"full\", \"mcp__github__create_issue\": \"hidden\" }" },
    // 子 Agent（Agent / Claude Code 的 Task）的几块：任务说明（交给它的 prompt）、过程（它自己的每一步，有的话）、结果（它最后的报告）
    agentPrompt: { bool: true, about: "subagent calls: show the task prompt given to the subagent" },
    agentSteps: { bool: true, about: "subagent calls: show the subagent's own steps (when available)" },
    agentResult: { bool: true, about: "subagent calls: show the subagent's final report" },
    // 时间戳：隐藏 / 指着那一块时显示 / 始终显示（右边一列时间，换天的地方一条「今天」「昨天」「9月26日」）
    timestamps: { one: ["hide", "hover", "show"], about: "timestamps in the conversation: hidden (default), shown on hover, or always shown (a time column plus date separators)" },
    // 运行状态行：Agent 在跑时对话最后那一行（✢ Reticulating… (12s · ↓ 579 tokens · esc to interrupt)）——完整 / 简洁（只有转圈和用时）/ 隐藏；隐藏了 Esc 照样能打断，标签页的图标照样在转
    workLine: { one: ["full", "brief", "hidden"], about: "the working status row while an agent runs (✢ Verb… (12s · ↓ 579 tokens · esc to interrupt)): full (default), brief (spinner and time) or hidden — Esc still interrupts and the tab icon keeps spinning" },
    sysErrors: { one: ["full", "line", "hidden"], about: "system errors that come from neither the model nor a tool (API errors such as 402/429/5xx, network, sign-in, sandbox unavailable, interruptions): in full (default), one line or hidden" },
    bashOut: { one: ["expanded", "preview", "hidden"], about: "output of your own ! commands: all of it, the first lines (default) or hidden" },
    recaps: { bool: true, about: "show ※ recap lines" },
    notices: { bool: true, about: "show background-task notices" },
    images: { bool: true, about: "show image thumbnails in the conversation" },
    imageShow: { one: ["hover", "inline"], about: "how attached images appear: hover = one [Image #N] line each (hover to preview, click to enlarge; like Claude Code), inline = the thumbnails right in the conversation" },
    doneLine: { bool: true, about: "show the ✻ line after each answer" },
    prompts: { bool: true, about: "show your messages and /commands in the conversation" },
    answers: { bool: true, about: "show the agent's final reply (its text after the last tool call; text between tool calls is progress)" },
  };
  function cleanCfg(j) {
    var out = {};
    if (!j || typeof j !== "object" || Array.isArray(j)) return out;
    Object.keys(CFG_SCHEMA).forEach(function (k) {
      if (!(k in j)) return;
      var d = CFG_SCHEMA[k], v = j[k];
      if (d.bool && typeof v === "boolean") out[k] = v;
      else if (d.one && d.one.indexOf(v) >= 0) out[k] = v;
      else if (d.some && Array.isArray(v)) out[k] = v.filter(function (f, i) { return d.some.indexOf(f) >= 0 && v.indexOf(f) === i; });
      else if (d.text && typeof v === "string") out[k] = v.slice(0, d.text);
      else if (d.map && v && typeof v === "object" && !Array.isArray(v)) { var o = {}; Object.keys(v).slice(0, 300).forEach(function (n) { if (n && n.length <= 160 && d.map.indexOf(v[n]) >= 0) o[n] = v[n]; }); out[k] = o; }
    });
    return out;
  }
  // 模型是哪家的（选模型是「提供方 › 模型」两级）：服务器给了 provider 就用它，不然看 id / 名字
  var PROVIDERS = [[/^deepseek/i, "DeepSeek"], [/^claude|^anthropic/i, "Anthropic"], [/^gpt|^o\d|^openai/i, "OpenAI"], [/^gemini|^google/i, "Google"], [/^qwen|^qwq/i, "通义千问"], [/^kimi|^moonshot/i, "Moonshot"], [/^glm|^zhipu/i, "智谱"], [/^doubao|^seed/i, "豆包"], [/^minimax|^abab/i, "MiniMax"], [/^grok/i, "xAI"], [/^llama|^meta/i, "Meta"], [/^mistral|^codestral/i, "Mistral"]];
  function providerOf(m) {
    if (!m) return "";
    if (m.provider) return m.provider;
    var hit = PROVIDERS.filter(function (x) { return x[0].test(m.id || "") || x[0].test(m.name || ""); })[0];
    return hit ? hit[1] : String(m.name || m.id || "").split(/\s+/)[0];
  }
  // 以前的三个（tools：工具调用、diffs：文件更改、web：网页）换成按类的档位：只搬用户改过的（旧的默认值不搬，用新的默认）；
  // 新的键已经有了（改过、存过一次）就不再搬
  function migrateView(raw, into) {
    if (!raw || typeof raw !== "object" || TOOL_KEYS.some(function (k) { return k in raw; })) return;
    var to = { expanded: "full", hidden: "hidden" };
    if (to[raw.tools]) ["toolRead", "toolBash", "toolAgent", "toolTodo", "toolOther"].forEach(function (k) { into[k] = to[raw.tools]; });
    if (to[raw.diffs]) into.toolEdit = to[raw.diffs];
    if (to[raw.web]) into.toolWeb = to[raw.web];
  }
  // 以前「回答」关掉 = 所有 agent 的话都不显示：拆成过程说明 / 最终回复以后，过程说明也跟着关（只搬一次：新的键有了就不动）
  function migrateProgress(raw, into) { if (raw && typeof raw === "object" && raw.answers === false && !("progress" in raw)) into.progress = "hidden"; }
  var cfg = JSON.parse(JSON.stringify(CFG_DEFAULT));
  try { var raw0 = JSON.parse(localStorage.getItem("tsu-config") || "{}"); Object.assign(cfg, cleanCfg(raw0)); migrateView(raw0, cfg); migrateProgress(raw0, cfg); } catch (e) { /* 坏了就用默认 */ }
  // 文件是准的：文件里没写的键回到默认（删掉一行 = 恢复默认）；改的是同一个对象（界面拿着它）
  function loadCfgFile() {
    try {
      if (!SANDBOX.exists(SPIRIT.settings)) return;
      var raw = JSON.parse(SANDBOX.as(null, function () { return SANDBOX.read(SPIRIT.settings); })), j = cleanCfg(raw);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
      // 写了、但值不对的：保留原来的；没写的：回到默认
      Object.keys(CFG_DEFAULT).forEach(function (k) { if (k in j) cfg[k] = j[k]; else if (!(k in raw)) cfg[k] = JSON.parse(JSON.stringify(CFG_DEFAULT[k])); });
      migrateView(raw, cfg);
      migrateProgress(raw, cfg);
      localStorage.setItem("tsu-config", JSON.stringify(cfg));
      hub.emit("cfg");
    } catch (e) { /* 文件写坏了（不是 JSON）：保留当前设置 */ }
  }
  // 回顾（※ recap）以前出厂是不显示、存下来的设置里就是 false：换成显示一次（只换这一次；之后你自己关掉的照旧）
  function migRecap() {
    try { if (localStorage.getItem("tsu-recap-mig1")) return; localStorage.setItem("tsu-recap-mig1", "1"); } catch (e) { return; }
    if (cfg.recaps === false) { cfg.recaps = true; saveCfgFile(); hub.emit("cfg"); }
  }
  var writingCfg = false;
  function saveCfgFile() {
    localStorage.setItem("tsu-config", JSON.stringify(cfg));
    if (!window.SANDBOX) return;
    writingCfg = true;
    try { SANDBOX.as(null, function () { SANDBOX.write(SPIRIT.settings, JSON.stringify(cfg, null, 2) + "\n"); var st = SANDBOX.stat(SPIRIT.settings); if (st && st.mode !== 0o666) st.mode = 0o666; }); } catch (e) { /* 还没就绪 */ }
    writingCfg = false;
  }
  function setCfg(k, v) {
    var c = cleanCfg((function () { var o = {}; o[k] = v; return o; })());
    if (!(k in c)) return false; // 不认的值：不改
    cfg[k] = c[k]; saveCfgFile(); hub.emit("cfg");
    return true;
  }
  // 一次改好几项（反选、套用预设）：只存一次、只通知一次
  function setCfgMany(o) {
    var c = cleanCfg(o || {}), ks = Object.keys(o || {}).filter(function (k) { return k in c; });
    ks.forEach(function (k) { cfg[k] = c[k]; });
    if (ks.length) { saveCfgFile(); hub.emit("cfg"); }
    return ks.length > 0;
  }

  // ---- 账号（/api/me）：模型列表、价格、工具、余额 ----
  var me = null, layout = null, sbxRetry = 0, sbxT = 0;
  // 服务器配了真沙盒：再问一次它的布局（Linux 上是沙盒里的 /home/user、/agents；macOS 的 seatbelt 驱动是这台 Mac 上的真实路径）。
  // 一时连不上（服务器、隧道）：隔一会儿再试，一直等到连上——不退回浏览器里另存一份
  function refreshMe() {
    return fetch("/api/me").then(function (r) { return r.json(); }).then(function (j) { me = j; }, function () { me = me || { loggedIn: false }; })
      .then(function () {
        if (LOCAL) { if (me && me.sandbox && !cloudLay) fetchCloudLay(); return; }
        if (!me || !me.sandbox || layout) return;
        return connectSandbox();
      })
      .then(function () { hub.emit("me"); resumeAll(); return me; });
  }
  // 管理员命令（/admin，终端界面和图形界面都走这里）：credit 账号 元（可为负）、allow 账号 —— 直接调 /api/admin/*，回一句结果
  function adminCommand(arg) {
    var en = !!(window.TSU_I18N && TSU_I18N.lang && TSU_I18N.lang() === "en"), t = function (zh, e) { return en ? e : zh; };
    var p = String(arg || "").trim().split(/\s+/), sub = (p[0] || "").toLowerCase(), who = p[1] || "", amt = Number(p[2]);
    var usage = t("用法：/admin credit <GitHub 账号> <金额（元，负数是扣回）>　·　/admin allow <GitHub 账号>", "Usage: /admin credit <GitHub login> <amount in CNY, negative to take back> · /admin allow <GitHub login>");
    if (!me || !me.admin) return Promise.resolve(t("只有管理员能用 /admin", "Only admins can use /admin"));
    var post = function (path, body) {
      return fetch("/api/admin/" + path, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || "HTTP " + r.status); return j; });
      });
    };
    var fail = function (e) { return t("没成功：", "Failed: ") + e.message; };
    if (sub === "credit" && who && isFinite(amt) && amt) {
      return post("credit", { login: who, cny: amt }).then(function () {
        return refreshMe().then(function () {
          var mine = me && me.login && me.login.toLowerCase() === who.toLowerCase(), y = mine ? (me.balance || 0) / 1e6 : null;
          return (amt > 0 ? t("已给 " + who + " 加了 ¥" + amt, "Added ¥" + amt + " to " + who) : t("已从 " + who + " 扣回 ¥" + -amt, "Took ¥" + -amt + " back from " + who)) +
            (y == null ? "" : t("，现在余额 ", " · balance now ") + (y < 0 ? "-¥" : "¥") + Math.abs(y).toFixed(2));
        });
      }, fail);
    }
    if (sub === "allow" && who) return post("allow", { login: who }).then(function () { return t("已放行 " + who, "Allowed " + who); }, fail);
    return Promise.resolve(usage);
  }
  function connectSandbox() {
    clearTimeout(sbxT);
    return fetch("/api/sbx/info").then(function (r) { return r.ok ? r.json() : null; }).then(function (l) {
      if (!l || !l.home || !l.agents) throw new Error("no layout");
      layout = l;
      cloudLay = l; // 网页里：Cloud 就是这个沙盒
      sbxRetry = 0;
      // 访达、编辑器、传输看到的 /home/user、/agents、/shared 换成真沙盒里的（镜像）；这台设备上原来有自己的文件的，问一次要不要搬过去
      if (window.SANDBOX && SANDBOX.mirrorStart) SANDBOX.mirrorStart(l).then(function (ok) { if (ok) { settlePaimon(); setTimeout(offerImport, 1500); } else retrySandbox(); });
      hub.emit("sandbox");
      if (srvReady || !SY) { volMigrateAll(); volLoadAll(); }
    }).catch(function () { retrySandbox(); });
  }
  // 原生 App 里：不开镜像（这台 Mac 的文件是真的），只要布局——Cloud 的 agent 的家、笔记在那边的哪儿
  var cloudT = 0;
  function fetchCloudLay() {
    clearTimeout(cloudT);
    return fetch("/api/sbx/info").then(function (r) { return r.ok ? r.json() : null; }).then(function (l) {
      if (!l || !l.home || !l.agents) throw new Error("no layout");
      cloudLay = l;
      hub.emit("agents");
      if (srvReady || !SY) { volMigrateAll(); volLoadAll(); }
    }).catch(function () { cloudT = setTimeout(fetchCloudLay, 15000); });
  }
  function retrySandbox() {
    sbxRetry = Math.min(30000, (sbxRetry || 1500) * 2);
    hub.emit("sandbox");
    clearTimeout(sbxT);
    sbxT = setTimeout(function () { if (layout && SANDBOX.mirrorActive && SANDBOX.mirrorActive()) return; layout = null; connectSandbox(); }, sbxRetry);
  }
  // ---- 浏览器沙盒 → 真沙盒：开了真沙盒以后浏览器里原来的文件看不到了（还在 IndexedDB），问一次要不要复制过去 ----
  function importLocal() {
    if (!window.SANDBOX || !SANDBOX.mirrorImport) return Promise.resolve({ files: 0, failed: [] });
    // agent 的家目录先在真沙盒里建好（Docker 里要由它自己的 Linux 用户拥有，人才能往里写）
    return Promise.all(list().map(function (a) { return sbx.agent(a).catch(function () {}); }))
      .then(function () { return SANDBOX.mirrorImport(); })
      .then(function (r) {
        if (window.TSU_DESK && TSU_DESK.notify) TSU_DESK.notify({ app: "访达", title: "已把 " + r.files + " 个文件导入真沙盒", body: r.failed.length ? r.failed.length + " 个没导进去：" + r.failed.slice(0, 3).join("；") : "浏览器里那份照旧留着" });
        return r;
      });
  }
  function offerImport() {
    var n = SANDBOX.mirrorImportable ? SANDBOX.mirrorImportable() : null, key = "tsu-import-asked:" + (layout ? layout.driver + ":" + layout.home : "");
    if (!n || !n.files || localStorage.getItem(key) || !window.TSU_DESK || !TSU_DESK.alert) return;
    localStorage.setItem(key, String(Date.now()));
    var size = n.bytes < 1e6 ? Math.max(1, Math.round(n.bytes / 1e3)) + " KB" : (n.bytes / 1e6).toFixed(1) + " MB";
    TSU_DESK.alert({
      title: "把浏览器沙盒里的文件搬进真沙盒？",
      message: "开了真沙盒以后，访达和编辑器看到的是真沙盒里的文件。浏览器里原来的 " + n.files + " 个文件（" + size + "）还在，只是看不到了。\n\n导入 = 复制到真沙盒里同样的位置（已有的跳过），浏览器里那份照旧留着。以后也可以在访达的「文件」菜单里导入。",
      icon: "app", buttons: [{ label: "不用了", role: "cancel" }, { label: "导入", role: "default" }],
    }).then(function (b) { if (b === "导入") importLocal(); });
  }
  // ---- 桌面上 App 的数据接口：日历、提醒事项、备忘录、Office 这些 App 把数据存成沙盒里的普通文件，在这里登记，
  // agent 的提示词里就会写上「哪个 App 的数据在哪、怎么改」——agent 用自己的文件工具读写，App 那边跟着刷新 ----
  // TSU_AGENTS.describeApp({ id, name, path（访达里看到的路径，如 /home/user/Library/Reminders）, about（格式、约定，一两句；详细的写在那个目录的 README.md 里）})
  var appDocs = [];
  function describeApp(o) {
    if (!o || !o.id || !o.name || !o.path) return;
    appDocs = appDocs.filter(function (a) { return a.id !== o.id; }).concat([{ id: o.id, name: o.name, path: o.path, about: o.about || "" }]);
  }
  // App 能做的事现在是系统命令（sys.js：TSU_SYS.registerApp，Bash 里 numbers write …、help numbers）；老的登记方式转过去
  function registerActions(appId, list, o) { if (window.TSU_SYS && TSU_SYS.registerApp) TSU_SYS.registerApp(appId, { name: o && o.name, actions: list }); }
  // 名字 → 登记了数据文件的 App：id、App 名都认，不分大小写
  function findApp(key) {
    key = String(key || "").trim().toLowerCase();
    if (!key) return null;
    var d = appDocs.find(function (x) { return x.id.toLowerCase() === key || x.name.toLowerCase() === key; });
    return d ? d.id : null;
  }
  var argLine = function (k, d, req) {
    var t = Array.isArray(d.type) ? d.type.join(" | ") : d.type || "any";
    return k + " (" + t + (req ? ", required" : "") + (d.enum ? ": " + d.enum.map(function (x) { return JSON.stringify(x); }).join(" | ") : "") + (d.path ? ", a path you can " + d.path : "") + ")" + (d.description ? " — " + d.description : "") + (d.default !== undefined ? " (default " + JSON.stringify(d.default) + ")" : "");
  };

  // ======== help（同 teyvat 的 kernel.help）：提示词里每样只有一行，细节 agent 自己 help <名字> 查 ========
  var HELP_GROUPS = ["Files & shell", "Web", "Tasks", "Agents", "Help"];
  var TOOL_HELP = {
    Bash: { group: "Files & shell", line: "run a shell command in your sandbox", detail: function (x) { return x.bashDetail; } },
    Read: { group: "Files & shell", line: "read a file with line numbers", detail: "Read a file. Returns lines as `     N<tab>text` (N is 1-based). offset = first line, limit = how many lines (default 2000); lines longer than 2000 characters are cut with …. An offset past the end is reported as such. For binary files use Bash (file, xxd, python)." },
    Write: { group: "Files & shell", line: "create or overwrite a file", detail: "Create or overwrite file_path with content; missing parent folders are created. The human sees the first lines. To change part of an existing file use Edit (Read it first)." },
    Edit: { group: "Files & shell", line: "replace an exact string in a file", detail: "Replace old_string with new_string in file_path. old_string must match exactly — whitespace and indentation included — and be unique in the file, unless replace_all is true (every occurrence is replaced). Read the file first so old_string is exact. The human sees the change as a diff." },
    Glob: { group: "Files & shell", line: "find files by pattern", detail: "Find files by glob pattern relative to your working directory; ** crosses folders (e.g. **/*.py, src/*.js). Newest first, up to 2000 paths." },
    Grep: { group: "Files & shell", line: "search file contents with a regex", detail: "Search file contents with a regular expression. path = a file or a folder (default: your home); ignore_case = true for case-insensitive. Returns file:line:text lines." },
    web_search: { group: "Web", line: "search the web (Brave)", detail: "Search the web with Brave: titles, URLs, snippets and ages for query (5 results). Each call costs a little credit. Use it for current events or facts you are unsure about; read a result with WebFetch." },
    WebFetch: { group: "Web", line: "read a web page", detail: "Fetch a public http(s) page and read it. prompt says what you want from it; a fast model reads the page and returns just that (quote-level details — numbers, prices, code — are kept), which saves your context. A redirect to a different host is reported instead of followed: fetch the new URL if you want it. Private / intranet / localhost addresses are refused; 20 s and 5 MB at most; binary content (images, PDF, archives) isn't read." },
    Agent: { group: "Tasks", line: "launch a sub-agent", detail: "Launch a sub-agent for a self-contained task (research, multi-step file work). It has its own context and the same tools, and works as you (same home and permissions). It can't see this conversation, so put everything it needs in prompt. It returns a final report. run_in_background: keep working while it runs; you get a <task-notification> when it finishes (TaskOutput shows its report). Launch several in one message to run them in parallel. Sub-agents can't start sub-agents or message other agents." },
    TaskOutput: { group: "Tasks", line: "check background tasks", detail: "Check background tasks (shell commands started with run_in_background, and background sub-agents). Without id: all tasks with status. With id: status plus the output so far (shell) or the report (sub-agent); tail = only the last N lines." },
    TaskStop: { group: "Tasks", line: "stop a background task", detail: "Stop a running background task (shell command or sub-agent) by id (from TaskOutput)." },
    hibernate: { group: "Tasks", line: "stop and sleep until woken", detail: "Stop working and sleep until something wakes you: the user's next message, a background task finishing, or `until` (a duration like 30s, 10m, 2h, a clock time like 09:00, or an ISO date). It is the only way to end your turn: write your message to the user and call hibernate in the same response." },
    SendMessage: { group: "Agents", line: "message another agent (queue / interrupt)", detail: function () { return TOPICS.social.detail(); } },
    ListAgents: { group: "Agents", line: "list the other agents and their status", detail: "List all agents you can message: name, id, status, model and what each is doing. Status like `paimon ls`: [W] working / [NW] not working, plus [F] open in a terminal, [B] alive in the background, [O] offline (offline agents still receive messages and wake up for them)." },
    help: { group: "Help", line: "show usage on demand", detail: "help → every tool, system command and topic in one line each. help <name> → the full usage of a tool (help Bash), a system command (help screencapture — the same text as `screencapture --help` in Bash), a topic (help settings, help paimon, help social) or an app's data files (help notes)." },
  };
  var TOPICS = {
    settings: { line: "the settings JSON files and what each key does", detail: function (x) {
      var l = ["SETTINGS are plain JSON files in " + x.P0 + "/config/ — Read / Edit them with your file tools; the apps apply changes at once. A key you leave out falls back to its default; a value that isn't allowed is ignored (the old value stays). Who can write: the human, and agents at access level \"rw\" (you: " + x.access + "; the human switches it with shift+tab).", "", "settings.json — agents and the terminal:"];
      Object.keys(CFG_SCHEMA).forEach(function (k) {
        var d = CFG_SCHEMA[k], kind = d.bool ? "true | false" : d.one ? d.one.map(function (v) { return JSON.stringify(v); }).join(" | ") : d.some ? "array of " + d.some.map(function (v) { return JSON.stringify(v); }).join(", ") : d.map ? "object { tool name: " + d.map.map(function (v) { return JSON.stringify(v); }).join(" | ") + " }" : "string";
        l.push("  " + k + ": " + kind + " — " + d.about + " (default " + JSON.stringify(CFG_DEFAULT[k]) + "; now " + JSON.stringify(cfg[k]) + ")");
      });
      var ds = window.TSU_DESK && TSU_DESK.settings && TSU_DESK.settings.schema ? TSU_DESK.settings.schema() : [];
      if (ds.length) {
        l.push("", "desktop.json — the desktop (the same things as the System Settings app):");
        ds.forEach(function (d) { l.push("  " + d.key + ": " + d.kind + " — " + d.about + " (default " + JSON.stringify(d.def) + "; now " + JSON.stringify(d.now) + ")"); });
      }
      l.push("", "Per-agent settings (name, model, effort, access) are not in these files: they are shown in " + x.P0 + "/IdentityData/<id>.json and changed by the human (System Settings › Paimon, or /model, /effort, shift+tab in the terminal).");
      return l.join("\n");
    } },
    paimon: { line: "the system folder (settings, identity, memory, inbox)", detail: function (x) {
      return [x.P0 + " is PAIMON_HOME, the system folder (like teyvat's ~/.teyvat):",
        "  README.md — this layout",
        "  config/settings.json, config/desktop.json — settings (help settings); everyone reads them, the human and rw agents can change them",
        "  IdentityData/<id>.json — each agent's identity card (id, name, home, model, effort, access). Yours is readable by you; other agents' are hidden. Written by the system — editing it changes nothing",
        "  MemoryData/<id>/NOTES.md and PLAN.md — your notes and plan: loaded into your prompt every turn; only you and the human can read them. Keep NOTES for lasting facts, PLAN for what's next; delete finished items",
        "  SocialData/inbox/<id>.jsonl — messages other agents sent (one JSON object per line: from, from_name, mode, text, ts, injected); only the human reads it"].join("\n");
    } },
    social: { line: "messaging other agents (SendMessage / ListAgents)", detail: function () {
      return ["All agents here are peers. SendMessage { to, message, mode } — to: an agent name, its 8-hex id, or \"all\" (every other agent). The receiver sees only what you send with SendMessage, never your normal replies.",
        "mode (you judge the urgency; default queue):",
        "  queue — delivered when the receiver's current turn ends; an idle receiver gets it right away.",
        "  interrupt — delivered now; if the receiver is working it is cut off (its turn ends as \"Interrupted · message from you\") and handles your message first, at the same level as user input.",
        "Use queue for normal collaboration; interrupt only when it is urgent or the receiver asked for it. The receipt says what happened (delivered / queued / interrupted it).",
        "Incoming messages reach you as lines like `[interrupt] 09-26 11:52 paimon-02: text` (or [queue]). [interrupt]: drop what you were doing and handle it first; [queue]: handle it when you're done. To reply, SendMessage back to the sender.",
        "ListAgents shows who exists and what they're doing. Archived agents can't receive messages; sub-agents can't send."].join("\n");
    } },
  };
  // help <app>：它的数据文件（有系统命令的，命令的用法 help <命令>）
  function appHelp(id, x) {
    var d = appDocs.find(function (a) { return a.id === id; }), l = ["## " + d.name + " (" + id + ")", "Data: " + x.shown(d.path) + (d.about ? " — " + d.about : "")];
    var cmds = window.TSU_SYS ? TSU_SYS.list().filter(function (c) { return c.name === id || (d.name + " " + d.about).indexOf(c.name) >= 0 && /^(numbers|pages|keynote)$/.test(c.name); }) : [];
    if (cmds.length) l.push("", "System commands for it: " + cmds.map(function (c) { return c.name; }).join(", ") + " (help <command>).");
    return l.join("\n");
  }
  function helpText(name, x) {
    var key = String(name || "").trim(), k = key.toLowerCase(), SYS = window.TSU_SYS, cmds = SYS ? SYS.list() : [];
    if (!key) {
      var l = ["Tools (help <tool> for the full usage):"];
      HELP_GROUPS.forEach(function (g) {
        var ts = x.tools.filter(function (n) { return (TOOL_HELP[n] || { group: "Help" }).group === g; });
        if (!ts.length) return;
        l.push("", "[" + g + "]");
        ts.forEach(function (n) { l.push("  " + n + " — " + (TOOL_HELP[n] ? TOOL_HELP[n].line : "")); });
      });
      if (cmds.length) {
        l.push("", "System commands — run them with Bash (pipes and > file work); they see and drive the human's desktop. help <command> or <command> --help for the usage:");
        cmds.forEach(function (c) { l.push("  " + c.name + " — " + c.summary); });
      }
      l.push("", "Topics:");
      Object.keys(TOPICS).forEach(function (t) { l.push("  " + t + " — " + TOPICS[t].line); });
      if (appDocs.length) {
        l.push("", "App data — plain files you can edit with your file tools (help <app> for the format):");
        appDocs.forEach(function (d) { l.push("  " + d.id + " (" + d.name + ") · " + x.shown(d.path)); });
      }
      return { text: l.join("\n"), summary: "Listed " + x.tools.length + " tools, " + cmds.length + " commands, " + Object.keys(TOPICS).length + " topics" };
    }
    var tool = x.tools.find(function (n) { return n.toLowerCase() === k; }) || Object.keys(TOOL_HELP).find(function (n) { return n.toLowerCase() === k; });
    if (tool) {
      var th = TOOL_HELP[tool] || {}, det = typeof th.detail === "function" ? th.detail(x) : th.detail || "", def = x.defs[tool], props = def && def.input_schema && def.input_schema.properties || {}, req = def && def.input_schema && def.input_schema.required || [];
      var tl = ["## " + tool + (th.group ? "  [" + th.group + "]" : "") + (x.tools.indexOf(tool) < 0 ? "  — not available to you right now" : "")];
      if (det) tl.push("", det);
      if (Object.keys(props).length) { tl.push("", "Args:"); Object.keys(props).forEach(function (p) { tl.push("  " + argLine(p, props[p], req.indexOf(p) >= 0)); }); }
      return { text: tl.join("\n"), summary: tool };
    }
    var ch = SYS && SYS.help(key.replace(/^--?/, ""));
    if (ch) return { text: ch + (x.tools.indexOf("Bash") < 0 ? "\n\n(You don't have Bash right now — the sandbox tools are turned off in settings — so you can't run it.)" : ""), summary: key };
    if (TOPICS[k]) return { text: TOPICS[k].detail(x), summary: k };
    var app = findApp(k);
    if (app) return { text: appHelp(app, x), summary: appDocs.find(function (d) { return d.id === app; }).name };
    var all = x.tools.concat(cmds.map(function (c) { return c.name; }), Object.keys(TOPICS), appDocs.map(function (d) { return d.id; })), sim = all.filter(function (n) { n = n.toLowerCase(); return n.indexOf(k) >= 0 || k.indexOf(n) >= 0; }).slice(0, 8);
    return { error: "unknown name", text: "help: nothing called \"" + key + "\"." + (sim.length ? " Similar: " + sim.join(", ") + "." : "") + " help (no name) lists everything." };
  }

  var ALIASES = { "deepseek-v4-flash": "deepseek-flash" };
  function models() { return (me && me.models) || []; }
  function modelOf(id) { var ms = models(); id = ALIASES[id] || id; return ms.find(function (m) { return m.id === id; }) || ms[0] || null; }
  var hasTool = function (id) { return !!(me && me.tools && me.tools.some(function (t) { return t.id === id; })); };
  // 工具请求的超时：和这一问的 signal 合在一起（Esc 也停），到时间就当失败，不会一直「Searching…」
  function timed(signal, ms) {
    var c = new AbortController(), t = setTimeout(function () { c.timedOut = true; c.abort(); }, ms), onAbort = function () { c.abort(); };
    if (signal) { if (signal.aborted) c.abort(); else signal.addEventListener("abort", onAbort); }
    c.done = function () { clearTimeout(t); if (signal) signal.removeEventListener("abort", onAbort); }; // 用完摘掉（这一问里调很多次也不越挂越多）
    return c;
  }
  // ======== 调模型：一次请求。失败了哪些值得再试、等多久、界面上怎么显示，同 Claude Code：
  // 连不上、超时、408 / 409 / 429 / 5xx / 529、流中途断了（没收到 message_stop）→ 等 1、2、4、8…秒（最多 32 秒）再来，最多 10 次；
  // 等的时候状态行变红：✻ Waiting for API response · will retry in 4s (attempt 2/10)。别的错（没登录、没额度、请求不对）直接报。
  // 开发时 wrangler 一改文件就重载，进行中的流全被掐断——所以要能多等几次
  var MAX_RETRIES = 10, RETRY_STATUS = [408, 409, 429, 500, 502, 503, 504, 529];
  function chatFetch(body, signal) { return fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, signal: signal, body: body }); }
  var backoff = function (n) { return Math.min(32000, 1000 * Math.pow(2, n - 1)); };
  var clean = function (t) { return String(t || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240); };
  // 非 2xx 的回应 → Error（message 形如「API Error: 503 …」，retry：值得再试）
  function httpError(res) {
    return res.text().then(function (t) {
      var j = null;
      try { j = JSON.parse(t); } catch (e) { /* 不是 JSON（比如 wrangler 重载时的 503 页面）*/ }
      var why = j && j.error ? (typeof j.error === "string" ? j.error : j.error.message || JSON.stringify(j.error)) : clean(t);
      var err = new Error("API Error: " + res.status + (why ? " " + why : ""));
      err.status = res.status;
      err.retry = RETRY_STATUS.indexOf(res.status) >= 0;
      return err;
    });
  }
  // 等 ms 毫秒；中途按了 Esc 就马上以 AbortError 结束
  function sleepFor(ms, signal) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { if (signal) signal.removeEventListener("abort", stop); res(); }, ms);
      function stop() { clearTimeout(t); var e = new Error("Interrupted by user"); e.name = "AbortError"; rej(e); }
      if (signal) { if (signal.aborted) return stop(); signal.addEventListener("abort", stop); }
    });
  }
  function jsonOf(r, what) {
    return r.text().then(function (t) {
      try { return JSON.parse(t); } catch (e) { return { error: what + " error (HTTP " + r.status + ")" + (t ? ": " + clean(t).slice(0, 160) : "") }; }
    });
  }

  // ======== 真沙盒（sandboxd，经 Worker 的 /api/sbx）：服务器配了沙盒（me.sandbox）时，agent 的工具都在真 Linux 里执行 ========
  // agent 在容器里是 Linux 用户 a_<id>，家目录 /agents/<id>；出了家目录能不能读写由它的组（档位）与文件的权限决定——内核判，不是这里判
  // Paimon Terminal（Mac 上的原生终端 App，local.js）：agent 的工具在这台 Mac 上跑，不经过服务器的沙盒；布局在 load() 里按这台 Mac 定
  var LOCAL = window.TSU_LOCAL || null;
  var remote = function () { return !!(LOCAL || (me && me.sandbox)); };
  var LAYOUT0 = { driver: "docker", os: "Debian 12", shell: "bash", home: "/home/user", agents: "/agents", shared: "/shared", paimon: "/.paimon" };
  var L = function () { return layout || LAYOUT0; };
  var shq = function (s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; };
  var touched = function (x) { document.dispatchEvent(new Event("tsu-sandbox-touch")); return x; }; // 真沙盒里动过文件：镜像马上再拉一次
  // 工具结果：带图（screencapture 截的）时是 [文字, 图…]，同 Anthropic 的 tool_result
  function resultContent(text, images) {
    if (!images || !images.length) return text;
    return [{ type: "text", text: String(text || "") }].concat(images.map(function (im) { return { type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } }; }));
  }
  // 访达、编辑器刚改的文件先推到真沙盒，agent 的工具再去动（不然可能读到旧的）
  var flushed = function () { return window.SANDBOX && SANDBOX.mirrorFlush ? SANDBOX.mirrorFlush().catch(function () {}) : Promise.resolve(); };
  function normPath(p, cwd, home) {
    p = String(p || "");
    if (p === "~" || p.indexOf("~/") === 0) p = home + p.slice(1);
    if (p[0] !== "/") p = (cwd || home) + "/" + p;
    var o = [];
    p.split("/").forEach(function (x) { if (!x || x === ".") return; if (x === "..") o.pop(); else o.push(x); });
    return "/" + o.join("/");
  }
  var sbx = {
    ensured: {},
    // 建好 agent 的 Linux 用户与家目录；档位（access）变了重设
    agent: function (a) {
      var key = a.access || "read";
      if (sbx.ensured[a.id] === key) return Promise.resolve();
      return fetch("/api/sbx/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: a.id, level: key, name: a.name }) })
        .then(function (r) { return jsonOf(r, "Sandbox"); }).then(function (j) { if (j.error) throw new Error(j.error); sbx.ensured[a.id] = key; });
    },
    // 执行：NDJSON 流（{o} 输出、{e} 错误输出、{x, cwd} 结束）→ { out, err, code, cwd }；onChunk 边收边给
    exec: function (o, signal, onChunk) {
      return flushed().then(function () { return fetch("/api/sbx/exec", { method: "POST", headers: { "content-type": "application/json" }, signal: signal, body: JSON.stringify(o) }); }).then(function (r) {
        if (!r.ok) return jsonOf(r, "Sandbox").then(function (j) { throw new Error(j.error || "Sandbox error (HTTP " + r.status + ")"); });
        var out = "", err = "", code = null, cwd = null, reader = r.body.getReader(), dec = new TextDecoder(), buf = "";
        var take = function (line) {
          if (!line) return;
          var j; try { j = JSON.parse(line); } catch (e) { return; }
          if (j.o !== undefined) { out += j.o; if (onChunk) onChunk(j.o, 1); }
          if (j.e !== undefined) { err += j.e; if (onChunk) onChunk(j.e, 2); }
          if (j.x !== undefined) { code = j.x; cwd = j.cwd; }
        };
        return (function pump() {
          return reader.read().then(function (x) {
            if (x.done) { take(buf); return touched({ out: out, err: err, code: code === null ? -1 : code, cwd: cwd }); }
            buf += dec.decode(x.value, { stream: true });
            var i;
            while ((i = buf.indexOf("\n")) >= 0) { take(buf.slice(0, i)); buf = buf.slice(i + 1); }
            return pump();
          });
        })();
      });
    },
    read: function (as, path) {
      return flushed().then(function () { return fetch("/api/sbx/fs/read?as=" + encodeURIComponent(as) + "&path=" + encodeURIComponent(path)); }).then(function (r) {
        if (!r.ok) return jsonOf(r, "Read").then(function (j) { throw new Error(j.error || "Read failed (HTTP " + r.status + ")"); });
        return r.arrayBuffer();
      });
    },
    write: function (as, path, data) {
      return fetch("/api/sbx/fs/write?as=" + encodeURIComponent(as) + "&path=" + encodeURIComponent(path), { method: "PUT", body: data })
        .then(function (r) { return jsonOf(r, "Write"); }).then(function (j) { if (j.error) throw new Error(j.error); return touched(j); });
    },
    stat: function (as, path) {
      return fetch("/api/sbx/fs/stat?as=" + encodeURIComponent(as) + "&path=" + encodeURIComponent(path)).then(function (r) { return r.status === 404 ? null : jsonOf(r, "Stat"); });
    },
    glob: function (as, pattern, cwd) {
      return fetch("/api/sbx/fs/glob?as=" + encodeURIComponent(as) + "&pattern=" + encodeURIComponent(pattern) + "&cwd=" + encodeURIComponent(cwd))
        .then(function (r) { return jsonOf(r, "Glob"); }).then(function (j) { if (j && j.error) throw new Error(j.error); return j || []; });
    },
  };
  // ======== 卷：agent 住在哪——它的会话、记忆、文件都在那，也只在那 ——
  //   local:<设备 id>  那台 Mac（原生 App；文件在它的磁盘上，~/.paimon 下面）
  //   cloud            服务器上的沙盒（哪台设备都连得上）
  // 账号里只同步索引（agent 这一条：id、名字、卷、文件夹、状态……）；会话、记忆、文件不同步——要看就去它的卷里读（Cloud 随时读得到；别的 Mac 上的，远程访问以后再做）。
  // Paimon 的 agent 没有「工作目录」：它自己的包就是它的家（这台 Mac：~/.paimon/agents/<id>；Cloud：/agents/<id>）========
  var srvSbx = { agent: sbx.agent, exec: sbx.exec, read: sbx.read, write: sbx.write, stat: sbx.stat, glob: sbx.glob }; // 服务器沙盒那一套（原生 App 里 Cloud 的 agent 也走它）
  var cloudLay = null; // 服务器沙盒的布局（网页里就是 layout；原生 App 里另外问一次）
  var devHere = function () { return SY ? SY.dev : "here"; };
  var localVol = function () { return "local:" + devHere(); };
  var guessed = {}; // 以前的 agent 索引里还没记着住哪：猜的（资源进卷没开时不写回索引——免得第一次打开就把每个 agent 都改一遍）
  var volOf = function (a) { return (a && (a.vol || guessed[a.id])) || (LOCAL ? localVol() : "cloud"); };
  var isCloud = function (a) { return volOf(a) === "cloud"; };
  var cloudOK = function () { return !!(me && me.sandbox); };
  var onSrv = function (a) { return !!LOCAL && !!a && isCloud(a) && cloudOK(); }; // 原生 App 里、Cloud 的 agent：工具去服务器的沙盒跑（服务器没配沙盒：照旧在这台 Mac 上）
  // 这台设备够得着这个卷：Cloud 要服务器配了沙盒（没配的网页是浏览器沙盒，照旧能跑、资源只在这台）；Local 只有那台 Mac 自己
  var volHere = function (v) { return v === "cloud" ? cloudOK() || (!LOCAL && !(me && me.sandbox)) : !!LOCAL && v === localVol(); };
  var volMaybe = function (v) { return v === "cloud" && !me ? true : volHere(v); }; // 账号还没回来：Cloud 先当够得着（回来了再说）
  var en0 = function () { return !!(window.TSU_I18N && TSU_I18N.lang && TSU_I18N.lang() === "en"); };
  function volLabel(v) {
    if (v === "cloud") return "Cloud";
    var d = String(v || "").slice(6);
    if (d === devHere()) { var i = LOCAL && LOCAL.info && LOCAL.info(); return (i && i.host) || (en0() ? "This Mac" : "本机"); }
    var n = SY && SY.devices && SY.devices()[d] ? SY.deviceName(d) : "";
    return n || "Mac";
  }
  // 各卷的布局：这台 Mac 是 L()（原生 App 里）；Cloud 是服务器沙盒的（网页里 L() 就是它）
  var LA = function (a) { return onSrv(a) ? cloudLay || LAYOUT0 : L(); };
  function homeOf(a) { return remote() ? (LA(a).agents || "/agents") + "/" + a.id : "/agents/" + a.id; }
  var paimonOf = function (a) { return remote() ? LA(a).paimon || "" : SPIRIT.home; };
  // 连不上它住的卷时说一句（发消息、! 命令都挡在这）
  function unreachText(a) {
    var v = volOf(a), lb = volLabel(v);
    if (v === "cloud") return en0() ? "Cloud can't be reached right now — try again when it's back." : "现在连不上 Cloud，等它恢复了再发。";
    return en0() ? "This agent lives on " + lb + " — it can't be reached from this device yet (remote access is coming)." : "这个 Agent 住在「" + lb + "」上，这台设备现在还连不上它（远程访问以后会有）。";
  }
  if (LOCAL) {
    // 原生 App：这台 Mac 上的 agent 的工具在这台 Mac 上跑（档位 none / read / rw 由 macOS Seatbelt 管，「自己的文件夹」= 它的包）；Cloud 的照旧去服务器的沙盒
    var cloudAs = function (as) { return onSrv(agents[as]); };
    var accOf = function (as) {
      var a = agents[as];
      if (!a) return { access: "user", workdir: "" };
      return { access: a.access || "read", workdir: homeOf(a), extra: [L().paimon + "/MemoryData/" + as] }; // 自己的包、笔记目录总能写
    };
    var madeHome = {};
    var ensureHome = function (a) { // Seatbelt 只放行它自己的文件夹：先建好
      if (madeHome[a.id]) return Promise.resolve();
      return LOCAL.exec({ cmd: "mkdir -p " + shq(homeOf(a)) + " " + shq(L().paimon + "/MemoryData/" + a.id), access: "user" }).then(function () { madeHome[a.id] = 1; });
    };
    sbx.agent = function (a) { return onSrv(a) ? srvSbx.agent(a) : ensureHome(a); };
    sbx.exec = function (o, signal, onChunk) {
      if (cloudAs(o.as)) return srvSbx.exec(o, signal, onChunk);
      var x = accOf(o.as), go = function () { return LOCAL.exec({ cmd: o.cmd, cwd: o.cwd, access: x.access, workdir: x.workdir, extra: x.extra }, signal, onChunk); };
      return agents[o.as] ? ensureHome(agents[o.as]).then(go, go) : go();
    };
    sbx.read = function (as, path) { return cloudAs(as) ? srvSbx.read(as, path) : LOCAL.read(path, accOf(as)); };
    sbx.write = function (as, path, data) { return cloudAs(as) ? srvSbx.write(as, path, data) : LOCAL.write(path, data, accOf(as)); };
    sbx.stat = function (as, path) { return cloudAs(as) ? srvSbx.stat(as, path) : LOCAL.stat(path); };
    sbx.glob = function (as, pattern, cwd) { return cloudAs(as) ? srvSbx.glob(as, pattern, cwd) : LOCAL.glob(pattern, cwd, accOf(as)); };
  }
  // 字节 → 文本：不是 UTF-8 就当二进制
  function textOf(buf) { try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e) { return null; } }

  // ======== 存储：agent 与对话跟着账号走（同 iCloud：服务器上那份为准，sync.js），这台设备上的 IndexedDB 只是缓存——
  // 按账号分开（tsu-agents-u<账号 id>），换个账号登录不会串；写入攒 300ms 一次。拉到了哪儿（meta.rev）、每条上次同步时的指纹（synced）也在缓存里 ========
  var SY = window.TSU_SYNC || null;
  var DBNAME = SY ? "tsu-agents-u" + SY.uid : "tsu-agents";
  var db = null, agents = {}, sessions = {}, loading = null;
  function openDB() {
    return new Promise(function (resolve) {
      var req;
      try { req = indexedDB.open(DBNAME, 2); } catch (e) { return resolve(); }
      req.onupgradeneeded = function () { var d = req.result; ["agents", "sessions", "meta", "synced"].forEach(function (n) { if (!d.objectStoreNames.contains(n)) d.createObjectStore(n); }); };
      req.onsuccess = function () { db = req.result; resolve(); };
      req.onerror = function () { resolve(); }; // 隐私模式等：只放内存
    });
  }
  function readAll(name, keyed, from) {
    return new Promise(function (resolve) {
      var d = from || db;
      if (!d || !d.objectStoreNames.contains(name)) return resolve(keyed ? {} : []);
      var out = keyed ? {} : [], req = d.transaction(name).objectStore(name).openCursor();
      req.onsuccess = function () { var c = req.result; if (c) { if (keyed) out[c.key] = c.value; else out.push(c.value); c.continue(); } else resolve(out); };
      req.onerror = function () { resolve(out); };
    });
  }
  // 按账号分开以前的缓存（tsu-agents，不分账号）：第一个在这台设备上登录的账号认领——它的 agent、会话算这个账号的，稍后推进账号（原来那份不动）
  function legacy() {
    if (!SY || localStorage.getItem("tsu-agents-owner")) return Promise.resolve([[], []]);
    return new Promise(function (resolve) {
      var req, fresh = false;
      try { req = indexedDB.open("tsu-agents"); } catch (e) { return resolve([[], []]); }
      req.onupgradeneeded = function () { fresh = true; }; // 本来就没有：什么都不认领
      req.onsuccess = function () {
        var old = req.result;
        if (fresh) { old.close(); localStorage.setItem("tsu-agents-owner", String(SY.uid)); return resolve([[], []]); }
        Promise.all([readAll("agents", false, old), readAll("sessions", false, old)]).then(function (r) {
          old.close();
          localStorage.setItem("tsu-agents-owner", String(SY.uid));
          resolve(r);
        });
      };
      req.onerror = function () { resolve([[], []]); };
    });
  }
  // 卷的第二步「资源进卷」一个开关，默认关：开了（这台设备 localStorage tsu-volumes-v2 = 1）会话写进 agent 住的卷里的文件、不再推进账号、
  // 以前的会话搬进卷（只复制）、从卷里读。关着：会话照旧进账号（sess / turn），同以前；卷、文件夹、名字.agent、没有工作目录这些（索引、界面）照样有
  var VOL2 = (function () { try { return localStorage.getItem("tsu-volumes-v2") === "1"; } catch (e) { return false; } })();
  var dirty = { agents: {}, sessions: {} }, flushT = 0, metaQ = [];
  function persist(kind, rec) { if (!rec) return; dirty[kind][rec.id] = rec; clearTimeout(flushT); flushT = setTimeout(flush, 300); if (kind === "sessions" && VOL2) volMark(rec.id); else srvMark(kind, rec.id); } // 资源进卷（VOL2）：会话写进它的卷，账号里只有索引；没开：照旧进账号
  function keep(kind, rec) { if (!rec) return; dirty[kind][rec.id] = rec; clearTimeout(flushT); flushT = setTimeout(flush, 300); } // 只进这台设备的缓存（从账号拉下来的，不再推回去）
  function flush() {
    clearTimeout(flushT);
    if (!db) return;
    // 先把这一批拿出来写；事务失败（磁盘满、被浏览器中断）就放回去，下次再写——不能先清掉（那样一失败就丢了）
    var batch = dirty, mq = metaQ;
    dirty = { agents: {}, sessions: {} };
    metaQ = [];
    var putBack = function (e) {
      console.error("Agent 数据保存失败，将稍后重试：", e);
      ["agents", "sessions"].forEach(function (k) { Object.keys(batch[k]).forEach(function (id) { if (!dirty[k][id]) dirty[k][id] = batch[k][id]; }); });
      metaQ = mq.concat(metaQ);
      clearTimeout(flushT);
      flushT = setTimeout(flush, 3000);
    };
    try {
      var tx = db.transaction(["agents", "sessions", "meta", "synced"], "readwrite");
      tx.onerror = tx.onabort = function () { putBack(tx.error); };
      ["agents", "sessions"].forEach(function (k) {
        var st = tx.objectStore(k);
        // 回合里挂着函数（Ctrl+B 的 detach）：JSON 来回一次去掉
        Object.keys(batch[k]).forEach(function (id) { st.put(JSON.parse(JSON.stringify(batch[k][id])), id); });
      });
      // 拉到了哪儿、同步过的指纹：和记录本身在同一个事务里写（不会出现「记着拉过了、记录却没存下」）
      mq.forEach(function (m) { tx.objectStore(m[0]).put(m[2], m[1]); });
    } catch (e) { putBack(e); }
  }

  // ======== 跟账号同步：一个 agent 一条（agent），一个会话头一条（sess，不含每一轮；n = 几轮），每一轮一条（turn，id = 会话 id:序号）。
  // 只推变了的：记着每条上次推上去 / 拉下来时的指纹（sent）。正在别的设备上跑的 agent（租约在别人那儿）这台不推它的，只看 ========
  var sent = {}, cursor = 0, srvReady = false, srvDirty = { agents: {}, sessions: {}, dirs: {} }, srvT = 0, srvBusy = false, srvWait = 0;
  var NO_RES_SYNC = VOL2; // 资源进卷了：会话、每一轮不进账号，只同步索引
  function fp(s) { var h = 0x811c9dc5; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return s.length.toString(36) + "." + (h >>> 0).toString(36); }
  var busyHere = function (id) { var r = runtimes[id]; return !!(r && (r.stream || r.tasks.some(function (x) { return x.status === "running"; }))); };
  var elsewhere = function (id) { return SY ? SY.elsewhere("agent:" + id) : null; }; // 在别的设备上跑着：{ device（名字）, until }
  function srvMark(kind, id) {
    if (!SY) return;
    srvDirty[kind][id] = 1;
    if (!srvReady) return; // 第一次同步完以后统一对一遍
    clearTimeout(srvT);
    srvT = setTimeout(srvFlush, Object.keys(runtimes).some(function (k) { return runtimes[k].stream; }) ? 3000 : 1200);
  }
  function srvFlush() {
    clearTimeout(srvT);
    if (!SY || !srvReady) return Promise.resolve();
    if (srvBusy) { srvT = setTimeout(srvFlush, 800); return Promise.resolve(); }
    var d = srvDirty, recs = [], marks = [];
    srvDirty = { agents: {}, sessions: {}, dirs: {} };
    var add = function (ns, id, str) {
      var k = ns + "|" + id, h = str == null ? "-" : fp(str);
      if (sent[k] === h || (str == null && !sent[k])) return;
      recs.push({ ns: ns, id: id, data: str });
      marks.push([k, h]);
    };
    Object.keys(d.agents).forEach(function (id) { var a = agents[id]; if (a && !elsewhere(id)) add("agent", id, JSON.stringify(a)); });
    Object.keys(d.dirs || {}).forEach(function (k) { add("dir", k, dirs[k] ? JSON.stringify(dirs[k]) : null); });
    // 会话、每一轮：资源不同步（在 agent 的卷里）。以前推上去的那些留在账号里不动，还没搬进卷的 agent 读它们兜底
    if (NO_RES_SYNC) d.sessions = {};
    Object.keys(d.sessions).forEach(function (sid) {
      var ss = sessions[sid];
      if (!ss || (ss.agentId && elsewhere(ss.agentId))) return;
      var head = {};
      Object.keys(ss).forEach(function (k) { if (k !== "turns") head[k] = ss[k]; });
      head.n = ss.turns.length;
      add("sess", sid, JSON.stringify(head));
      ss.turns.forEach(function (t, i) { add("turn", sid + ":" + i, JSON.stringify(t)); });
      for (var i = ss.turns.length; sent["turn|" + sid + ":" + i] && sent["turn|" + sid + ":" + i] !== "-"; i++) add("turn", sid + ":" + i, null); // 少了的几轮
    });
    if (!recs.length) return Promise.resolve();
    srvBusy = true;
    return SY.push(recs).then(function () {
      srvWait = 0;
      marks.forEach(function (m) { sent[m[0]] = m[1]; metaQ.push(["synced", m[0], m[1]]); });
      clearTimeout(flushT);
      flushT = setTimeout(flush, 300);
    }, function (e) {
      console.warn("同步：推送失败，将稍后重试 ·", e.message || e);
      Object.keys(d.agents).forEach(function (id) { srvDirty.agents[id] = 1; });
      Object.keys(d.sessions).forEach(function (id) { srvDirty.sessions[id] = 1; });
      Object.keys(d.dirs || {}).forEach(function (k) { srvDirty.dirs[k] = 1; });
      srvWait = Math.min(60000, (srvWait || 1500) * 2);
      srvT = setTimeout(srvFlush, srvWait);
    }).then(function () { srvBusy = false; });
  }
  // 从账号拉下来的（别的设备改的）合进来：这台正在跑的 agent 以这台为准（它推上去会盖掉服务器上的）；别的照服务器上的换掉。
  // 原地换（同一个对象）：界面上按对象找的那一轮照样找得到
  function replaceObj(o, n) { Object.keys(o).forEach(function (k) { if (!(k in n)) delete o[k]; }); return Object.assign(o, n); }
  function applyRemote(res, quiet) {
    var ui = {}, touched = false;
    var mark = function (aid, sid, ev, turn) { if (!aid) return; var u = ui[aid] || (ui[aid] = { sids: {}, ev: [] }); u.sids[sid] = 1; if (ev) u.ev.push([sid, ev, turn]); };
    res.recs.forEach(function (r) {
      var k = r.ns + "|" + r.id, h = r.data == null ? "-" : fp(r.data), ss, owner;
      if (sent[k] === h) return; // 本来就是这样（多半是这台自己推上去的）
      if (r.data != null) { try { JSON.parse(r.data); } catch (e) { console.warn("同步：已跳过一条损坏的记录", k); return; } }
      if (r.ns === "tabtime") { // 别的设备上标签页的时间（tabtime.js）：交给它记着，详情里写所有设备加起来的
        if (window.TSU_TABTIME && TSU_TABTIME.remote) TSU_TABTIME.remote(r.id, r.data);
      } else if (r.ns === "dir") { // 文件夹（索引的一部分）：vol|path → { vol, path, at }；null = 删了
        if (r.data == null) delete dirs[r.id]; else dirs[r.id] = JSON.parse(r.data);
        dirsDirty = true;
      } else if (r.ns === "agent") {
        if (r.data == null || busyHere(r.id)) return; // agent 不删（归档也只是一个标记）
        var a = JSON.parse(r.data), was = agents[r.id] ? agents[r.id].current : null, wasAct = agents[r.id] ? agents[r.id].active : 0;
        if (agents[r.id]) replaceObj(agents[r.id], a); else agents[r.id] = a;
        keep("agents", agents[r.id]);
        mark(r.id, a.current, was && was !== a.current ? "reset" : null);
        if (VOL2 && a.mig && a.active !== wasAct && volHere(volOf(a))) volSoon(r.id); // 别的设备用它说过话：去它的卷里读新的（资源不同步，只有索引告诉「变了」）
      } else if (r.ns === "sess" && migratedSess(r)) { /* 搬进卷了：卷里的为准，账号里这份是搬之前的 */
      } else if (r.ns === "turn" && migratedTurn(r)) { /* 同上 */
      } else if (r.ns === "sess") {
        if (r.data == null) return; // 会话不删
        var sd = JSON.parse(r.data), n = sd.n || 0;
        ss = sessions[r.id];
        owner = sd.agentId || (ss && ss.agentId);
        if (owner && busyHere(owner)) return;
        delete sd.n;
        var turns = ss ? ss.turns : [];
        ss = ss ? replaceObj(ss, sd) : (sessions[r.id] = sd);
        ss.turns = turns;
        if (turns.length > n) { turns.length = n; mark(owner, r.id, "reset"); }
        keep("sessions", ss);
        mark(owner, r.id, null);
      } else if (r.ns === "turn") {
        var j = r.id.lastIndexOf(":"), sid = r.id.slice(0, j), idx = +r.id.slice(j + 1);
        ss = sessions[sid] || (sessions[sid] = { id: sid, turns: [] });
        owner = ss.agentId;
        if (owner && busyHere(owner)) return;
        if (r.data == null) { if (ss.turns.length > idx) { ss.turns.length = idx; mark(owner, sid, "reset"); } }
        else {
          var t = JSON.parse(r.data), old = ss.turns[idx];
          while (ss.turns.length < idx) ss.turns.push({ ask: "", answer: "", thinking: "", parts: [], api: [], at: 0, error: "Missing (not synced yet)" });
          if (old) { replaceObj(old, t); mark(owner, sid, "turn", old); } else { ss.turns[idx] = t; mark(owner, sid, "append", t); }
        }
        keep("sessions", ss);
      }
      sent[k] = h;
      metaQ.push(["synced", k, h]);
      touched = true;
    });
    cursor = Math.max(cursor, res.head || 0);
    metaQ.push(["meta", "rev", cursor]);
    if (dirsDirty) { dirsDirty = false; metaQ.push(["meta", "dirs", JSON.parse(JSON.stringify(dirs))]); }
    flush();
    if (quiet || !touched) return;
    // 界面：正开着的 agent，当前会话里变了的那几轮重画（新的接在后面；少了几轮、换了会话就整个重画）
    Object.keys(ui).forEach(function (aid) {
      var rt0 = runtimes[aid], a = agents[aid];
      if (!rt0 || !a) return;
      var evs = ui[aid].ev.filter(function (e) { return e[0] === a.current; });
      if (evs.some(function (e) { return e[1] === "reset"; })) rt0.fire("reset");
      else evs.forEach(function (e) { rt0.fire(e[1], e[2]); });
      rt0.fire("status");
    });
    hub.emit("agents");
  }
  // 打开时：先用这台设备上的缓存，再跟账号对一次（拉 cursor 之后的）；这台上有、账号里没有的（第一次同步、以前只存在这台设备上的）推上去
  function initialSync(quiet) {
    if (!SY) return Promise.resolve();
    var full = !cursor;
    return Promise.race([SY.pull(cursor), new Promise(function (_, no) { setTimeout(function () { no(new Error("timeout")); }, 12000); })]).then(function (res) {
      if (full) { // 全量拉的：账号里没有的，即使这台记着同步过（账号被重置等）也要重推
        var seen = {};
        res.recs.forEach(function (x) { seen[x.ns + "|" + x.id] = 1; });
        Object.keys(sent).forEach(function (k) { if (!seen[k]) delete sent[k]; });
      }
      applyRemote(res, quiet);
      srvReady = true;
      settleVols();
      Object.keys(agents).forEach(function (id) { srvDirty.agents[id] = 1; });
      Object.keys(sessions).forEach(function (id) { srvDirty.sessions[id] = 1; });
      setTimeout(srvFlush, 1500);
      SY.attach({ since: function () { return cursor; }, apply: function (r) { applyRemote(r); return Promise.resolve(); } });
    }, function (e) {
      console.warn("同步：拉取 Agent 失败，暂用本机数据，15 秒后重试 ·", e.message || e);
      setTimeout(function () { initialSync(false); }, 15000);
    });
  }
  // ---- 搬进卷了的 agent：账号里的旧会话 / 旧的每一轮不再合进来 ----
  function migratedSess(r) { if (!VOL2) return false; var sd = null; try { sd = r.data ? JSON.parse(r.data) : null; } catch (e) { sd = null; } var ow = (sd && sd.agentId) || (sessions[r.id] && sessions[r.id].agentId); return !!(ow && agents[ow] && agents[ow].mig); }
  function migratedTurn(r) { if (!VOL2) return false; var j = r.id.lastIndexOf(":"), ss = sessions[r.id.slice(0, j)], ow = ss && ss.agentId; return !!(ow && agents[ow] && agents[ow].mig); }

  // ======== 卷里的会话（资源不同步：写进 agent 住的那个卷，读也从那里读）——
  //   <.paimon>/SessionData/<agent id>/<会话 id>.json        整段会话（会话头 + 每一轮）：不在答的时候写
  //   <.paimon>/SessionData/<agent id>/<会话 id>.live.json   正在答的那一轮（答的过程中几秒写一次，别的设备看得到进度；答完清空）
  // 以人（user）的身份读写：agent 自己改不了自己的对话记录。这台设备的 IndexedDB 只是缓存 ========
  var VOLFMT = 1;
  function volIO(v) {
    if (!VOL2) return null;
    if (v === "cloud") {
      var lay = LOCAL ? cloudLay : layout;
      if (!cloudOK() || !lay || !lay.paimon) return null;
      var api = function (path, opts) {
        return fetch("/api/sbx/fs/" + path, opts).then(function (r) {
          if (r.ok) return r;
          return r.text().then(function (t) { var m; try { m = JSON.parse(t).error; } catch (e) { m = t; } throw new Error(m || "HTTP " + r.status); });
        });
      };
      return {
        base: lay.paimon + "/SessionData",
        write: function (p, text) { return api("write?as=user&path=" + encodeURIComponent(p), { method: "PUT", body: text }); },
        read: function (p) { return api("read?as=user&path=" + encodeURIComponent(p)).then(function (r) { return r.text(); }); },
        // 整个目录一次取回来：{ 路径: 内容 }（大于 1 MB 的是 null，要单独读）
        dump: function (dir) {
          return fetch("/api/sbx/fs/snapshot?as=user&text=1048576&roots=" + encodeURIComponent(dir)).then(function (r) { return r.ok ? r.json() : {}; }).then(function (j) {
            var out = {};
            Object.keys(j || {}).forEach(function (k) { var m = j[k]; if (m && m.t === "f" && /\.json$/.test(k)) out[k] = typeof m.text === "string" ? m.text : null; });
            return out;
          });
        },
      };
    }
    if (LOCAL && v === localVol() && L().paimon) {
      var rd = function (p) { return LOCAL.read(p, { access: "user" }).then(function (buf) { return new TextDecoder().decode(buf); }); };
      return {
        base: L().paimon + "/SessionData",
        write: function (p, text) { return LOCAL.write(p, text, { access: "user" }); },
        read: rd,
        dump: function (dir) {
          return LOCAL.list(dir).then(function (l) {
            var out = {};
            return Promise.all((l || []).filter(function (x) { return !x.dir && /\.json$/.test(x.name); }).map(function (x) {
              var p = dir + "/" + x.name;
              return rd(p).then(function (t) { out[p] = t; }, function () {});
            })).then(function () { return out; });
          }, function () { return {}; });
        },
      };
    }
    return null;
  }
  var sessJSON = function (s0, turns) { var head = {}; Object.keys(s0).forEach(function (k) { if (k !== "turns") head[k] = s0[k]; }); return JSON.stringify({ v: VOLFMT, head: head, turns: turns || s0.turns }); };
  var volDirty = {}, volT = 0, volBusy = false, volSent = {}, volLiveAt = {}, volErr = "";
  function volMark(sid) {
    var ss = sessions[sid], a = ss && agents[ss.agentId];
    if (!VOL2 || !a || !a.mig || !volHere(volOf(a))) return; // 还没搬进卷：先只在这台的缓存里（搬的时候一起带过去）
    volDirty[sid] = 1;
    clearTimeout(volT);
    volT = setTimeout(volFlush, 1200);
  }
  function volFlush() {
    clearTimeout(volT);
    if (volBusy) { volT = setTimeout(volFlush, 600); return Promise.resolve(); }
    var ids = Object.keys(volDirty), again = false;
    if (!ids.length) return Promise.resolve();
    volDirty = {};
    volBusy = true;
    return ids.reduce(function (p, sid) {
      return p.then(function () {
        var ss = sessions[sid], a = ss && agents[ss.agentId], io = a && volIO(volOf(a));
        if (!io) return;
        var file = io.base + "/" + a.id + "/" + sid, r = runtimes[a.id], i = ss.turns.length - 1;
        if (r && r.stream && a.current === sid && i >= 0 && ss.turns[i] === r.stream.turn) {
          // 正在答：只写这一轮（最多 3 秒一次），答完再整段写；前面几轮有没写进去的，整段（不带这一轮）先写一次
          volDirty[sid] = 1; again = true;
          if (Date.now() - (volLiveAt[sid] || 0) < 3000) return;
          volLiveAt[sid] = Date.now();
          return io.write(file + ".live.json", JSON.stringify({ v: VOLFMT, i: i, turn: ss.turns[i] })).then(function () {
            volSent[sid + "|l"] = 1;
            var body = sessJSON(ss, ss.turns.slice(0, i)), h = fp(body);
            if (volSent[sid + "|b"] === h) return;
            return io.write(file + ".json", body).then(function () { volSent[sid + "|b"] = h; });
          });
        }
        var body2 = sessJSON(ss), h2 = fp(body2);
        return (volSent[sid + "|b"] === h2 ? Promise.resolve() : io.write(file + ".json", body2).then(function () { volSent[sid + "|b"] = h2; })).then(function () {
          if (volSent[sid + "|l"] !== 0) return io.write(file + ".live.json", "{}").then(function () { volSent[sid + "|l"] = 0; }); // 答完了：「正在答」那份清空
        });
      }).catch(function (e) { volDirty[sid] = 1; again = true; volErr = (e && e.message) || String(e); console.warn("会话写不进 agent 的卷，稍后重试 ·", volErr); });
    }, Promise.resolve()).then(function () {
      volBusy = false;
      if (again) { clearTimeout(volT); volT = setTimeout(volFlush, 3000); } else volErr = "";
      hub.emit("vol");
    });
  }
  // 从卷里读回一个 agent 的会话（开页面时；别的设备在它的卷里写过以后）：卷里的比缓存新就换掉；缓存更新（这台还没写进去）就补写
  var volLoading = {}, volSoonT = {}, volMissing = {}; // volMissing：卷里也没有它的当前会话（再要就开新的）
  function volSoon(id) { clearTimeout(volSoonT[id]); volSoonT[id] = setTimeout(function () { var a = agents[id]; if (a) volLoad(a); }, 800); }
  function volLoad(a) {
    var io = VOL2 && a && a.mig ? volIO(volOf(a)) : null;
    if (!io) return Promise.resolve(null); // 卷还没准备好（账号、Cloud 的布局还没回来）：等准备好了 volLoadAll 会再来
    if (volLoading[a.id]) return volLoading[a.id];
    var dir = io.base + "/" + a.id;
    var p = io.dump(dir).then(function (files) {
      var by = {}, changed = [];
      Object.keys(files).forEach(function (path) {
        var m = /\/([^/]+?)(\.live)?\.json$/.exec(path);
        if (!m) return;
        var e = by[m[1]] || (by[m[1]] = { path: dir + "/" + m[1] + ".json" });
        if (m[2]) e.live = files[path]; else e.body = files[path];
      });
      return Promise.all(Object.keys(by).map(function (sid) {
        var e = by[sid];
        return (e.body === null ? io.read(e.path).then(function (t) { e.body = t; }, function () {}) : Promise.resolve()).then(function () {
          var j = null, lv = null;
          try { j = JSON.parse(e.body || "null"); } catch (x) { j = null; }
          try { lv = e.live ? JSON.parse(e.live) : null; } catch (x) { lv = null; }
          if (!j || !j.head || !Array.isArray(j.turns)) return;
          var turns = j.turns.slice();
          if (lv && lv.turn && typeof lv.i === "number" && lv.i >= turns.length - 1 && lv.i <= turns.length) turns[lv.i] = lv.turn; // 正在答的那一轮
          var cur = sessions[sid], r = runtimes[a.id];
          if (r && (r.stream || r.tasks.some(function (x) { return x.status === "running"; })) && a.current === sid) return; // 这台正在跑它：以这台为准
          var body = JSON.stringify(turns), h = fp(body) + "|" + (j.head.updated || 0);
          if (cur && cur._vh === h) return;
          if (cur && (cur.updated || 0) > (j.head.updated || 0) && cur.turns.length >= turns.length) { volMark(sid); return; } // 这台的更新：补写进卷
          var fresh = Object.assign({}, j.head, { turns: turns });
          if (cur) { var keepTurns = cur.turns; replaceObj(cur, fresh); if (keepTurns !== cur.turns) { /* 换了一套：界面整个重画 */ } } else sessions[sid] = fresh;
          Object.defineProperty(sessions[sid], "_vh", { value: h, writable: true, configurable: true, enumerable: false });
          volSent[sid + "|b"] = fp(sessJSON(sessions[sid], j.turns));
          keep("sessions", sessions[sid]);
          changed.push(sid);
        });
      })).then(function () {
        if (!changed.length) return false;
        var r = runtimes[a.id];
        if (r && changed.indexOf(a.current) >= 0) { r.fire("reset"); r.fire("status"); }
        hub.emit("agents");
        return true;
      });
    }).catch(function (e) { console.warn("读不到 " + a.name + " 卷里的会话 ·", (e && e.message) || e); return null; }) // 读不到（网络）：不算「没有」
      .then(function (x) { delete volLoading[a.id]; return x; });
    volLoading[a.id] = p;
    return p;
  }
  function volLoadAll() {
    if (!VOL2) return;
    Object.keys(agents).forEach(function (id) {
      var a = agents[id];
      if (!a.mig || a.deleted || !volHere(volOf(a))) return;
      volLoad(a).then(function (x) { var r = runtimes[id]; if (x !== null && r && !sessions[a.current]) { volMissing[id] = 1; r.fire("reset"); r.fire("status"); } });
    });
  }
  // ---- 搬进卷（只复制）：还没搬的 agent（没有 mig）、它的卷这台够得着——每段会话写进卷里，全写好了才在索引上记 mig。
  // 账号里原来那份（D1）、这台的缓存都不动；中途失败下次再来（重写一遍无妨）----
  var migrating = {};
  function volMigrate(a) {
    if (!VOL2 || !a || a.mig || migrating[a.id] || (SY && !srvReady)) return Promise.resolve(false);
    var io = volIO(volOf(a));
    if (!io) return Promise.resolve(false);
    migrating[a.id] = true;
    var list0 = Object.keys(sessions).map(function (k) { return sessions[k]; }).filter(function (s0) { return s0.agentId === a.id; });
    return list0.reduce(function (p, s0) {
      return p.then(function () { var body = sessJSON(s0); return io.write(io.base + "/" + a.id + "/" + s0.id + ".json", body).then(function () { volSent[s0.id + "|b"] = fp(body); }); });
    }, Promise.resolve()).then(function () {
      a.mig = Date.now();
      persist("agents", a);
      hub.emit("agents");
      return true;
    }, function (e) { console.warn("没能把 " + a.name + " 的会话搬进它的卷，下次再试 ·", (e && e.message) || e); return false; })
      .then(function (ok) { delete migrating[a.id]; return ok; });
  }
  function volMigrateAll() { if (!VOL2) return; Object.keys(agents).forEach(function (id) { var a = agents[id]; if (!a.mig && !a.deleted && volHere(volOf(a))) volMigrate(a); }); }
  // 以前的 agent 住哪（第一次见到时定一次，记进索引）：最后一轮是哪台设备跑的——那台是 Mac 上的 App 就住那台 Mac；网页跑的是 Cloud；
  // 没跑过的：在 App 里建的算这台 Mac，网页里的算 Cloud
  function guessVol(a) {
    var last = null;
    Object.keys(sessions).forEach(function (k) { var s0 = sessions[k]; if (s0.agentId !== a.id) return; s0.turns.forEach(function (t) { if (t.dev && (!last || (t.at || 0) >= (last.at || 0))) last = t; }); });
    var d = last && last.dev;
    if (LOCAL && (!d || d === devHere())) return localVol();
    // 那台是不是电脑上的 App：现在按 kind（mac、linux；网页是 web）；以前的记录名字是「Mac · App」，浏览器的 kind 也记成过 mac
    var dd = d && SY && SY.devices ? SY.devices()[d] || {} : {}, dn = String(dd.name || "");
    if (d && (/App\s*$/.test(dn) || ((dd.kind === "mac" || dd.kind === "linux") && !/ · (Safari|Chrome|Edge|Firefox|浏览器)$/.test(dn)))) return "local:" + d;
    return "cloud";
  }
  // ======== 文件夹（索引的一部分，同步）：卷里任意多层，agent 的 path 是它在哪个文件夹（"" = 卷的最外层）。
  // 空文件夹记一条 dir（vol|path）；有 agent 的文件夹不用记也在 ========
  var dirs = {}, dirsDirty = false;
  var normDir = function (p) { return String(p || "").split("/").map(function (x) { return x.trim().replace(/[\u0000-\u001f]/g, ""); }).filter(function (x) { return x && x !== "." && x !== ".."; }).join("/"); };
  function dirMark(k) { srvDirty.dirs[k] = 1; metaQ.push(["meta", "dirs", JSON.parse(JSON.stringify(dirs))]); clearTimeout(flushT); flushT = setTimeout(flush, 300); if (srvReady) { clearTimeout(srvT); srvT = setTimeout(srvFlush, 800); } hub.emit("agents"); }
  function folders(v) {
    var out = {};
    var add = function (p) { var segs = normDir(p).split("/").filter(Boolean); for (var i = 1; i <= segs.length; i++) out[segs.slice(0, i).join("/")] = 1; };
    Object.keys(dirs).forEach(function (k) { var d = dirs[k]; if (d && d.vol === v) add(d.path); });
    Object.keys(agents).forEach(function (id) { var a = agents[id]; if (!a.deleted && volOf(a) === v && a.path) add(a.path); });
    return Object.keys(out).sort();
  }
  function mkdir(v, p) { p = normDir(p); if (!p) return false; var k = v + "|" + p; if (dirs[k] || folders(v).indexOf(p) >= 0) return false; dirs[k] = { vol: v, path: p, at: Date.now() }; dirMark(k); return true; }
  function inDir(a, p) { return a.path === p || String(a.path || "").indexOf(p + "/") === 0; }
  // 挪文件夹 / 改名：里面的 agent、子文件夹一起换前缀
  function moveDir(v, from, to) {
    from = normDir(from); to = normDir(to);
    if (!from || !to || from === to || to.indexOf(from + "/") === 0) return false;
    if (folders(v).indexOf(to) >= 0) return false; // 同名的已经有了
    Object.keys(agents).forEach(function (id) { var a = agents[id]; if (volOf(a) === v && inDir(a, from)) { a.path = to + String(a.path).slice(from.length); persist("agents", a); } });
    Object.keys(dirs).forEach(function (k) {
      var d = dirs[k];
      if (!d || d.vol !== v || !(d.path === from || d.path.indexOf(from + "/") === 0)) return;
      var np = to + d.path.slice(from.length), nk = v + "|" + np;
      delete dirs[k]; dirMark(k);
      dirs[nk] = { vol: v, path: np, at: d.at || Date.now() }; dirMark(nk);
    });
    if (!dirs[v + "|" + to]) { dirs[v + "|" + to] = { vol: v, path: to, at: Date.now() }; dirMark(v + "|" + to); }
    hub.emit("agents");
    return true;
  }
  // 删文件夹：只删空的（里面还有 agent 就不删，删 agent 要先把它挪走或删掉）
  function rmdir(v, p) {
    p = normDir(p);
    if (!p || Object.keys(agents).some(function (id) { var a = agents[id]; return !a.deleted && volOf(a) === v && inDir(a, p); })) return false;
    Object.keys(dirs).forEach(function (k) { var d = dirs[k]; if (d && d.vol === v && (d.path === p || d.path.indexOf(p + "/") === 0)) { delete dirs[k]; dirMark(k); } });
    hub.emit("agents");
    return true;
  }
  // 把 agent 挪进一个文件夹（同一个卷里；换卷要搬资源，以后再做）
  // 换卷（vol）：只有资源还不在卷里的（没开资源进卷、或还没搬）——那时会话在账号里，换卷只是改索引；搬进卷了的要搬资源，以后再做
  function moveAgent(id, p, vol) {
    var a = agents[id];
    if (!a) return false;
    p = normDir(p); vol = vol || volOf(a);
    if (vol !== volOf(a) && VOL2 && a.mig) return false;
    if ((a.path || "") === p && vol === volOf(a) && a.vol) return false;
    a.vol = vol; a.path = p; // 挪过的记下卷（猜的就定下来了）
    persist("agents", a); hub.emit("agents");
    return true;
  }
  // 账号拉完了（设备名单也有了）：以前的 agent 定下住哪；够得着卷的搬进去（只复制）、搬过的从卷里读新的
  function settleVols() {
    Object.keys(agents).forEach(function (id) { var a = agents[id]; if (a.vol) return; if (VOL2) { a.vol = guessVol(a); a.path = normDir(a.path || ""); persist("agents", a); } else guessed[id] = guessVol(a); });
    volMigrateAll();
    volLoadAll();
  }
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", function () { if (document.hidden) flush(); });

  // 一行 Markdown → 纯文字（列表里显示最后一句用）：去掉 **、`、标题的 #、列表的 - / 1.、引用的 >、链接只留字
  function plainLine(l) {
    return String(l).replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)+/, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/(\*\*|__|`)/g, "").replace(/(^|\s)[*_]([^*_\s][^*_]*)[*_](?=\s|$|[,.;:!?，。；：！？])/g, "$1$2").trim();
  }
  // ---- 名字（同 teyvat）：名字后面自动带两位编号——没给名字是 paimon-01、paimon-02……；给了 dev 就是 dev-01，再一个 dev-02；自己带了编号（dev-07）就原样 ----
  var suffixOf = function (name) { var m = /^(.*\D)-(\d{2,})$/.exec(name || ""); return m ? { base: m[1], n: +m[2] } : null; };
  var two = function (n) { return n < 10 ? "0" + n : String(n); };
  // base 的下一个号（归档的也算进去，号不重用）；except：改名时不算自己
  function numberName(base, except) {
    base = String(base || "paimon").replace(/-+$/, "") || "paimon";
    var max = 0;
    Object.keys(agents).forEach(function (k) { var a = agents[k], x = suffixOf(a.name); if (a !== except && x && x.base.toLowerCase() === base.toLowerCase()) max = Math.max(max, x.n); });
    var n = max + 1;
    while (Object.keys(agents).some(function (k) { return agents[k] !== except && agents[k].name.toLowerCase() === (base + "-" + two(n)).toLowerCase(); })) n++;
    return base + "-" + two(n);
  }
  function pickName() { return numberName("paimon"); }
  var autoNumber = function (name, except) { return suffixOf(name) ? name : numberName(name, except); };
  // 以前的名字是从一张词表里随机挑的（amber、birch……），一多就乱：第一次加载时按创建先后改成 paimon-01、paimon-02……；人自己起的名字不动
  var OLD_NAMES = ["amber", "birch", "cedar", "dune", "ember", "fern", "grove", "harbor", "iris", "juniper", "kelp", "lumen", "maple", "nova", "opal", "pine", "quill", "reed", "sage", "tide", "umber", "vale", "willow", "yarrow", "zephyr"];
  function renumber() {
    if (localStorage.getItem("tsu-agents-numbered2")) return [];
    var auto = list().filter(function (a) { return OLD_NAMES.indexOf(String(a.name).replace(/-\d\d$/, "")) >= 0 || /^agent-\d\d$/.test(a.name); })
      .sort(function (a, b) { return (a.created || 0) - (b.created || 0); });
    auto.forEach(function (a) { a.formerName = a.formerName || a.name; a.name = "\u0000"; }); // 先腾开，免得和自己撞号
    auto.forEach(function (a) { a.name = pickName(); persist("agents", a); });
    localStorage.setItem("tsu-agents-numbered2", "1");
    return auto;
  }
  var validName = function (s) { return /^[A-Za-z][\w.-]{0,44}$/.test(s); };
  function byName(name) {
    var n = String(name || "").toLowerCase();
    return list().find(function (a) { return a.name.toLowerCase() === n; }) || (agents[n] && !agents[n].archived ? agents[n] : null) ||
      (n.length >= 3 ? list().filter(function (a) { return a.id.indexOf(n) === 0; })[0] : null) || null;
  }
  function list() { return Object.keys(agents).map(function (k) { return agents[k]; }).filter(function (a) { return !a.archived && !a.global; }).sort(function (a, b) { return (b.active || 0) - (a.active || 0); }); } // 全局助手（global）不算在「agent 们」里：它管它们
  // ======== 外加的工具（别的文件挂进来，比如 globalagent.js 给全局助手的「看各个 agent、看 / 调布局」那几样）========
  // addTools({ when(agent) → 这个 agent 有没有这几样, defs: [工具定义…], run(name, input, agent) → Promise<{ text, summary?, error? }> 或一段字, prompt?(agent) → 提示词里加一段 })
  var EXTRA_TOOLS = [];
  var extraFor = function (agent) { return EXTRA_TOOLS.filter(function (x) { try { return !!x.when(agent); } catch (e) { return false; } }); };
  function newSession(agent) {
    var s = { id: newId(), agentId: agent.id, title: "", created: Date.now(), updated: Date.now(), turns: [], sleep: null, ctx: 0 };
    sessions[s.id] = s;
    agent.sessions = (agent.sessions || []).concat([s.id]);
    agent.current = s.id;
    persist("sessions", s);
    persist("agents", agent);
    return s;
  }
  // 新 agent：id、名字、自己的目录
  function create(opts) {
    opts = opts || {};
    var name = opts.name && validName(opts.name) ? autoNumber(opts.name) : pickName();
    if (byName(name)) name = numberName(suffixOf(name) ? suffixOf(name).base : name);
    var dm = cfg.defaultModel && models().some(function (m) { return m.id === cfg.defaultModel; }) ? cfg.defaultModel : ""; // 设置里定的「新 agent 用的模型」
    var a = { id: hexId(), name: name, created: Date.now(), active: Date.now(), model: opts.model || dm || (models()[0] && models()[0].id) || "", effort: opts.effort || "high", access: opts.access || "read", sessions: [], archived: false,
      vol: opts.vol === "cloud" || /^local:/.test(opts.vol || "") ? opts.vol : LOCAL ? localVol() : "cloud", path: normDir(opts.path || ""), mig: VOL2 ? Date.now() : undefined }; // 住哪（卷）、哪个文件夹；资源进卷开着：资源一开始就在卷里
    while (agents[a.id]) a.id = hexId();
    agents[a.id] = a;
    newSession(a);
    if (window.SANDBOX) SANDBOX.ready().then(function () { SANDBOX.ensureAgent(a.id); writeIdentity(a); });
    hub.emit("agents");
    return a;
  }
  // ======== /.paimon：系统自己的文件都在这（同 teyvat 的 ~/.teyvat；以前散在 /etc 和各自的家目录里）========
  //   README.md                 这个目录的说明
  //   config/settings.json      设置（人能改；rw 档位的 agent 也能改）
  //   IdentityData/<id>.json    每个 agent 的身份卡（只读投影：真相在 IndexedDB；agent 只读得到自己的）
  //   MemoryData/<id>/NOTES.md  agent 的笔记、PLAN.md 它的计划（每一轮都放进它的提示词；只有它自己和人能读写）
  var PAIMON_README = "# /.paimon\n\n系统自己的文件都在这（同 teyvat 的 `~/.teyvat`），别的地方不放。改了立刻生效；身份卡是投影，改了没用（下次会重写）。\n\n" +
    "| 路径 | 是什么 | 谁能读 / 写 |\n|---|---|---|\n" +
    "| `config/settings.json` | 设置：状态栏、每一问结尾显示什么、思考怎么显示…… | 都能读；人、rw 档位的 agent 能改 |\n" +
    "| `IdentityData/<id>.json` | 每个 agent 的身份卡：名字、家目录、模型、档位 | 人；agent 只读得到自己的 |\n" +
    "| `MemoryData/<id>/NOTES.md`、`PLAN.md` | agent 的笔记与计划，每一轮都放进它的提示词 | 人与这个 agent 自己 |\n" +
    "| `SocialData/inbox/<id>.jsonl` | 别的 agent 发给它的消息（SendMessage），一行一条；`injected` = 已经交给它 | 人 |\n";
  var paimonPath = function (rel) { return SPIRIT.home + (rel ? "/" + rel : ""); };
  // agent 眼里的 /.paimon：浏览器沙盒是 /.paimon；真沙盒是 sandboxd 给的真路径（老版本的 sandboxd 没给，就是空的：笔记退回家目录里的老位置）
  var paimonSeen = function () { return remote() ? L().paimon || "" : SPIRIT.home; };
  function writeIdentity(a) {
    if (onSrv(a)) { // 原生 App 里的 Cloud agent：身份卡在服务器沙盒的 .paimon 里
      if (cloudLay && cloudLay.paimon) srvSbx.write("user", cloudLay.paimon + "/IdentityData/" + a.id + ".json", JSON.stringify({ id: a.id, name: a.name, home: homeOf(a), memory: cloudLay.paimon + "/MemoryData/" + a.id, created: new Date(a.created).toISOString(), model: a.model, effort: a.effort, access: a.access }, null, 2) + "\n").catch(function () {});
      return;
    }
    try {
      var P0 = paimonSeen();
      SANDBOX.as(null, function () {
        SANDBOX.mkdirp(paimonPath("IdentityData"));
        var p = paimonPath("IdentityData/" + a.id + ".json");
        SANDBOX.write(p, JSON.stringify({ id: a.id, name: a.name, home: remote() ? L().agents + "/" + a.id : "/agents/" + a.id, memory: P0 ? P0 + "/MemoryData/" + a.id : "", created: new Date(a.created).toISOString(), model: a.model, effort: a.effort, access: a.access }, null, 2) + "\n");
        var st = SANDBOX.stat(p);
        if (st && st.mode !== 0o600) st.mode = 0o600; // 别的 agent 读不到；它自己读得到（sandbox.js 里单独放行）
      });
    } catch (e) { /* 沙盒还没好 */ }
  }
  // 整理 /.paimon：说明、目录；以前的 /etc/harness.json、/etc/agents/*.json、家目录里的 AGENT.md / PLAN.md 挪进来（挪，不删）；空了的 /etc 进废纸篓
  function settlePaimon() {
    if (!window.SANDBOX || (remote() && !L().paimon)) return; // 真沙盒还是老版本的 sandboxd：先不动
    try {
      SANDBOX.as(null, function () {
        ["", "config", "IdentityData", "MemoryData", "SocialData"].forEach(function (d) { SANDBOX.mkdirp(paimonPath(d)); });
        var rd = paimonPath("README.md");
        if (!SANDBOX.exists(rd) || SANDBOX.read(rd) !== PAIMON_README) SANDBOX.write(rd, PAIMON_README);
        var mv = function (from, to) { if (SANDBOX.exists(from) && !SANDBOX.exists(to)) { try { SANDBOX.move(from, to); } catch (e) { console.warn("挪不过去：" + from + " → " + to, e); } } };
        mv("/etc/harness.json", SPIRIT.settings);
        if (SANDBOX.isDir("/etc/agents")) SANDBOX.list("/etc/agents").forEach(function (p) { mv(p, paimonPath("IdentityData/" + p.split("/").pop())); });
        Object.keys(agents).forEach(function (id) {
          var mem = ensureMemory(id), home = "/agents/" + id;
          mv(home + "/AGENT.md", mem + "/NOTES.md");
          mv(home + "/PLAN.md", mem + "/PLAN.md");
        });
        // /etc 里只剩空目录了：整个移到废纸篓（不删）
        if (SANDBOX.isDir("/etc") && !SANDBOX.walk("/etc").some(function (p) { return !SANDBOX.isDir(p); })) {
          var T = SANDBOX.HOME + "/.Trash", to = T + "/etc", n = 2;
          SANDBOX.mkdirp(T);
          while (SANDBOX.exists(to)) to = T + "/etc " + n++;
          try { SANDBOX.move("/etc", to); } catch (e) { /* 挪不动就留着 */ }
        }
      });
      Object.keys(agents).forEach(function (id) { writeIdentity(agents[id]); });
    } catch (e) { console.warn("整理 /.paimon 没做完：", e); }
  }
  // agent 的笔记目录 /.paimon/MemoryData/<id>：属主是它自己，700（别的 agent 读不到；人都能读写）
  function ensureMemory(id) {
    var d = paimonPath("MemoryData/" + id);
    SANDBOX.as(null, function () {
      if (!SANDBOX.exists(d)) { SANDBOX.mkdirp(d); var st = SANDBOX.stat(d); if (st) { st.owner = id; st.mode = 0o700; } }
    });
    return d;
  }

  // ---- 迁移：以前的会话（localStorage tsu-sessions，按名字）→ agent + 会话；原数据留着不删 ----
  function migrate() {
    var old = null;
    try { old = JSON.parse(localStorage.getItem("tsu-sessions") || "null"); } catch (e) { old = null; }
    var groups = {}, nameless = [];
    if (old && old.list) Object.keys(old.list).forEach(function (k) {
      var s = old.list[k];
      if (!s || !s.turns || !s.turns.length) return;
      if (s.agent && s.agent !== "undefined" && validName(s.agent)) (groups[s.agent] = groups[s.agent] || []).push(s); else nameless.push(s);
    });
    if (nameless.length) groups[pickName()] = nameless;
    var effort = { off: "off", low: "low", medium: "high", high: "high", max: "max" }[(JSON.parse(localStorage.getItem("tsu-config") || "{}") || {}).effort] || "high";
    Object.keys(groups).forEach(function (name) {
      var list0 = groups[name].sort(function (a, b) { return a.updated - b.updated; }), latest = list0[list0.length - 1];
      var a = { id: hexId(), name: name, created: list0[0].updated || Date.now(), active: latest.updated || Date.now(), model: ALIASES[latest.model] || latest.model || "", effort: effort,
        access: latest.access || "read", sessions: [], archived: false, legacyName: name };
      agents[a.id] = a;
      list0.forEach(function (s) {
        var first = s.turns.find(function (t) { return t.at; });
        sessions[s.id] = { id: s.id, agentId: a.id, title: s.title || titleOf(s.turns), created: first ? first.at : s.updated, updated: s.updated, turns: s.turns, sleep: s === latest ? s.sleep || null : null, ctx: 0 };
        a.sessions.push(s.id);
        persist("sessions", sessions[s.id]);
      });
      a.current = latest.id;
      persist("agents", a);
    });
    localStorage.setItem("tsu-agents-migrated", "1");
  }
  // 文件：/agents/<名字> → /agents/<id>，属主改成 id；以前给子 agent 开的目录（<名字>-a1…）收进主 agent 目录里；/agents/undefined 挪到 /tmp/recovered（都不删）
  function migrateFS() {
    try {
      SANDBOX.as(null, function () {
        var entries = SANDBOX.isDir("/agents") ? SANDBOX.list("/agents") : [];
        Object.keys(agents).forEach(function (id) {
          var a = agents[id], home = "/agents/" + id, name = a.legacyName || a.name;
          SANDBOX.ensureAgent(id);
          if (name && SANDBOX.isDir("/agents/" + name) && "/agents/" + name !== home) {
            SANDBOX.list("/agents/" + name).forEach(function (p) { var to = home + p.slice(("/agents/" + name).length); if (!SANDBOX.exists(to)) SANDBOX.move(p, to); });
            if (!SANDBOX.list("/agents/" + name).length) SANDBOX.remove("/agents/" + name, true); // 已经搬空的旧目录
          }
          if (name && SANDBOX.renameOwner) SANDBOX.renameOwner(name, id);
          entries.forEach(function (p) {
            var m = /^\/agents\/(.+)-(a\d+)$/.exec(p);
            if (!m || m[1] !== name || !SANDBOX.isDir(p)) return;
            SANDBOX.mkdirp(home + "/old-subagents");
            if (!SANDBOX.exists(home + "/old-subagents/" + m[2])) SANDBOX.move(p, home + "/old-subagents/" + m[2]);
            if (SANDBOX.renameOwner) SANDBOX.renameOwner(name + "-" + m[2], id);
          });
          writeIdentity(a);
        });
        // 剩下的不是 id 的目录（以前按名字建、又没有会话可迁的，如 /agents/undefined）：挪到 /tmp/recovered（不删）
        SANDBOX.list("/agents").forEach(function (p) {
          var nm = p.slice(8);
          if (agents[nm] || /^[0-9a-f]{8}$/.test(nm) || !SANDBOX.isDir(p)) return;
          SANDBOX.mkdirp("/tmp/recovered");
          var to = "/tmp/recovered/agents-" + nm, k = 2;
          while (SANDBOX.exists(to)) to = "/tmp/recovered/agents-" + nm + "-" + k++;
          SANDBOX.move(p, to);
        });
      });
    } catch (e) { console.error("迁移 agent 目录出错：", e); }
    // ls -l、Finder 里显示名字而不是 id
    if (SANDBOX.setUserNames) SANDBOX.setUserNames(function (owner) { var a = agents[owner]; return a ? a.name : owner; });
  }
  function load() {
    return (LOCAL ? LOCAL.ready.then(function (i) {
      // 这台 Mac 的布局：人的家目录是真的 ~；agent 的笔记、身份、会话在 ~/.paimon（同 teyvat）；agent 住在自己的包里（~/.paimon/agents/<id>），没有工作目录
      layout = { driver: "mac", os: i.os, shell: "zsh", home: i.home, agents: i.home + "/.paimon/agents", shared: i.home + "/.paimon/shared", paimon: i.home + "/.paimon", user: i.user, host: i.host };
    }, function () {}) : Promise.resolve()).then(openDB).then(function () { return Promise.all([readAll("agents"), readAll("sessions"), readAll("meta", true), readAll("synced", true), legacy()]); }).then(function (r) {
      r[0].forEach(function (a) { agents[a.id] = a; });
      r[1].forEach(function (s) { sessions[s.id] = s; });
      cursor = r[2].rev || 0;
      if (r[2].dirs && typeof r[2].dirs === "object") dirs = r[2].dirs;
      sent = r[3] || {};
      r[4][0].forEach(function (a) { if (!agents[a.id]) { agents[a.id] = a; persist("agents", a); } }); // 认领的旧缓存
      r[4][1].forEach(function (s) { if (!sessions[s.id]) { sessions[s.id] = s; persist("sessions", s); } });
      return initialSync(true);
    }).then(function () {
      if (!Object.keys(agents).length && !localStorage.getItem("tsu-agents-migrated")) migrate();
      if (!SY) settleVols(); // 没有账号（本地开发不登录）：不用等同步
      // 当前会话这台缓存里没有：搬进卷了的（卷够得着）先去卷里读（rt.session 读到之前给个占位）；别的开一段新的
      Object.keys(agents).forEach(function (id) { var a = agents[id]; a.model = ALIASES[a.model] || a.model; if (!sessions[a.current] && !(VOL2 && a.mig && a.current && volMaybe(volOf(a)))) newSession(a); if (a.goal) a.goal.checking = false; });
      var renamed = renumber();
      // 上次没跑完就关了页面（多半是刷新）：agent 当前会话的最后一问留着，登录状态回来后接着跑（resumeAll）；
      // 别的（老会话里的、已经接过 3 次还没跑完的）标成中断。跑到一半的工具都标成中断（进程随页面没了）
      // 别的设备开始的一问：那台设备还拿着租约（还在跑）就不动；租约没了（那台关了）才标成中断——要是连账号都没连上，也先不动
      Object.keys(sessions).forEach(function (k) {
        var ss = sessions[k], a = agents[ss.agentId], last = ss.turns[ss.turns.length - 1];
        if (a && elsewhere(a.id)) return;
        ss.turns.forEach(function (t) {
          var other = SY && t.dev && t.dev !== SY.dev;
          if (other && !srvReady) return;
          if (t.ask !== undefined && !t.worked && !t.error) {
            if (!other && a && a.current === k && t === last && !a.archived && (t.resumes || 0) < 3) resumable[a.id] = t;
            else t.error = other ? "Interrupted (" + SY.deviceName(t.dev) + " stopped)" : "Interrupted (page closed)";
          }
          (t.parts || []).forEach(function (p) { if (p.status === "running") { p.status = "error"; p.error = other ? "Interrupted (" + SY.deviceName(t.dev) + " stopped)" : "Interrupted (page closed)"; } });
        });
      });
      if (window.SANDBOX) SANDBOX.ready().then(function () {
        migrateFS();
        if (!remote()) settlePaimon();
        renamed.forEach(writeIdentity);
        loadCfgFile();
        migRecap(); // 设置文件读进来以后再换（文件是准的：先换了会被文件里的旧值盖回去）
        SANDBOX.onChange(function (p) { if (p === SPIRIT.settings && !writingCfg) loadCfgFile(); });
      });
      else migRecap();
      // 有定时唤醒的 agent：没人看也要按时醒
      list().forEach(function (a) { var s = sessions[a.current]; if (s && s.sleep && s.sleep.until) runtime(a.id); });
      loaded = true;
      resumeAll();
      hub.emit("agents");
    });
  }

  // ======== 工具定义 ========
  var SANDBOX_TOOLS = [
    { name: "Bash", description: "Run a shell command in your sandbox as you; the working directory persists. Default timeout 120000 ms (max 600000); run_in_background for long jobs (you get a <task-notification>). help Bash lists the supported syntax and commands.",
      input_schema: { type: "object", properties: { command: { type: "string" }, description: { type: "string", description: "What it does, in a few words" }, timeout: { type: "integer", description: "Milliseconds, max 600000" }, run_in_background: { type: "boolean" } }, required: ["command"] } },
    { name: "Read", description: "Read a file from the sandbox. Returns lines with line numbers.",
      input_schema: { type: "object", properties: { file_path: { type: "string" }, offset: { type: "integer", description: "1-based line to start at" }, limit: { type: "integer" } }, required: ["file_path"] } },
    { name: "Write", description: "Create or overwrite a file in the sandbox.",
      input_schema: { type: "object", properties: { file_path: { type: "string" }, content: { type: "string" } }, required: ["file_path", "content"] } },
    { name: "Edit", description: "Replace an exact string in a file. old_string must match exactly and be unique unless replace_all is true.",
      input_schema: { type: "object", properties: { file_path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" }, replace_all: { type: "boolean" } }, required: ["file_path", "old_string", "new_string"] } },
    { name: "Glob", description: "Find files by pattern, e.g. **/*.py or src/*.js.",
      input_schema: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] } },
    { name: "Grep", description: "Search file contents with a regular expression. Returns file:line:text.",
      input_schema: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string", description: "File or directory (default: your home)" }, ignore_case: { type: "boolean" } }, required: ["pattern"] } },
  ];
  // 有真沙盒时 Bash 的说明换成真 Linux 的
  var BASH_REMOTE = { name: "Bash", description: "Run a bash command in your real Linux container; the working directory persists and output streams to the user. Default timeout 120000 ms (max 600000); run_in_background for servers and builds (you get a <task-notification>). help Bash lists what's installed.",
    input_schema: { type: "object", properties: { command: { type: "string" }, description: { type: "string", description: "What it does, in a few words" }, timeout: { type: "integer", description: "Milliseconds, max 600000" }, run_in_background: { type: "boolean" } }, required: ["command"] } };
  var BASH_MAC = Object.assign({}, BASH_REMOTE, { description: "Run a bash command in your real macOS shell (a Seatbelt sandbox); the working directory persists and output streams to the user. Default timeout 120000 ms (max 600000); run_in_background for servers and builds (you get a <task-notification>). help Bash lists what's installed and what's off limits." });
  var BASH_LOCAL = Object.assign({}, BASH_REMOTE, { description: "Run a zsh command on the user's own Mac (not a sandbox), starting in your own folder; the directory persists across calls and output streams to the user. Default timeout 120000 ms (max 600000); run_in_background for servers and builds (you get a <task-notification>). help Bash for what your access level allows." });
  function sandboxTools(a) { return remote() ? [LOCAL && !onSrv(a) ? BASH_LOCAL : LA(a).driver === "seatbelt" ? BASH_MAC : BASH_REMOTE].concat(SANDBOX_TOOLS.slice(1)) : SANDBOX_TOOLS; } // Bash 的说明跟着 agent 住的卷走（同提示词里的 YOUR COMPUTER）
  var WEB_SEARCH = { name: "web_search", description: "Search the web (Brave). Use for current events, facts you are unsure about, or anything after your training data. Returns titles, URLs and snippets.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "Search query" } }, required: ["query"] } };
  var WEB_FETCH = { name: "WebFetch", description: "Read a web page (http/https): `prompt` says what you want from it and a fast model returns just that. help WebFetch for limits and redirects.",
    input_schema: { type: "object", properties: { url: { type: "string" }, prompt: { type: "string", description: "What to extract or answer from the page" } }, required: ["url", "prompt"] } };
  var HIBERNATE_TOOL = { name: "hibernate", description: "Stop working and sleep until something wakes you: the user's next message, a background task finishing, or `until`. This is the ONLY way to end your turn. Write your message to the user as normal text in the same response, then call hibernate. Use `until` to wait for something (e.g. a background job) for a bounded time.",
    input_schema: { type: "object", properties: { summary: { type: "string", description: "One line: what you did / what you're waiting for" }, until: { type: "string", description: "Optional wake time: a duration like 30s, 10m, 2h, a clock time like 09:00, or an ISO date" } }, required: ["summary"] } };
  var TASK_OUTPUT_TOOL = { name: "TaskOutput", description: "Check background tasks (shell commands and sub-agents). Without id: list all with status. With id: status plus output so far (shell) or report (agent); tail limits to the last N lines.",
    input_schema: { type: "object", properties: { id: { type: "string" }, tail: { type: "integer" } } } };
  // 任务清单（同 Claude Code 的 TaskCreate / TaskUpdate / TaskList）：多步的活先列出来，人在输入框上面看得到进度（◼ 在做 · ◻ 没开始 · ✔ 做完）；存在会话里
  var TASK_CREATE = { name: "TaskCreate", description: "Add a task to your task list (the user sees the list above the input box). For multi-step work: create the steps up front, set one to in_progress before you start it and completed right after it's done. activeForm is the spinner text while it's in progress (e.g. \"Running the tests\").",
    input_schema: { type: "object", properties: { subject: { type: "string", description: "Short imperative title, e.g. \"Run the tests\"" }, description: { type: "string", description: "What needs to be done" }, activeForm: { type: "string", description: "Present continuous, shown while in progress" } }, required: ["subject"] } };
  var TASK_UPDATE = { name: "TaskUpdate", description: "Update a task on your task list: status pending | in_progress | completed | deleted, or change its subject, description or activeForm.",
    input_schema: { type: "object", properties: { taskId: { type: "string", description: "Task id, e.g. \"3\"" }, status: { type: "string", enum: ["pending", "in_progress", "completed", "deleted"] }, subject: { type: "string" }, description: { type: "string" }, activeForm: { type: "string" } }, required: ["taskId"] } };
  var TASK_LIST = { name: "TaskList", description: "Show your task list: ids, status and subjects.", input_schema: { type: "object", properties: {} } };
  var TASK_STOP_TOOL = { name: "TaskStop", description: "Stop a running background task (shell command or sub-agent) by id.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } };
  var AGENT_TOOL = { name: "Agent", description: "Launch a sub-agent for a self-contained task; it works as you (same home and permissions) and returns a report. run_in_background to keep working meanwhile; several in one message run in parallel. help Agent for details.",
    input_schema: { type: "object", properties: { description: { type: "string", description: "3-5 word summary" }, prompt: { type: "string", description: "Full task instructions; the sub-agent can't see this conversation" }, run_in_background: { type: "boolean" } }, required: ["description", "prompt"] } };
  // agent 之间发消息（同 teyvat 的 social.communicate：全对全、没有层级；interrupt / queue 两种送法）
  var SEND_MESSAGE = { name: "SendMessage", description: "Send a message to another agent (all agents are peers); the receiver sees only what you send here, not your normal replies. help social for how delivery works.",
    input_schema: { type: "object", properties: { to: { type: "string", description: "Agent name, 8-hex id, or \"all\"" }, message: { type: "string" }, mode: { type: "string", enum: ["queue", "interrupt"], description: "queue (default): delivered when the receiver's current turn ends (an idle receiver gets it at once); interrupt: cut it off now, same level as user input — only when it's urgent" } }, required: ["to", "message"] } };
  var LIST_AGENTS = { name: "ListAgents", description: "List the other agents: name, id, status ([W]/[NW] working, [F]/[B]/[O] open / background / offline), model, what each is doing.",
    input_schema: { type: "object", properties: {} } };
  // 渐进式披露（同 teyvat 的 kernel.help）：提示词里每样东西只有一行，细节 agent 自己查
  var HELP_TOOL = { name: "help", description: "Usage on demand: help lists every tool, desktop system command and topic in one line each; help <name> shows the full usage of one — a tool (Bash…), a system command (screencapture, ax, windows…), a topic (settings, paimon, social) or an app's data files (notes…).",
    input_schema: { type: "object", properties: { name: { type: "string", description: "Tool, command, topic or app; omit to list everything" } } } };
  var ACCESS = { none: "none (only your own folder)", read: "read-only", rw: "read & write" };
  var EFFORTS = ["off", "low", "high", "max"];

  // ======== 刷新不丢：没跑完的一问接着跑；排队的消息、没交出去的通知、在跑的后台任务（被刷新停掉了）都接着给 ========
  var resumable = {}, resumeDone = false, loaded = false;
  // 同一个 agent 同一时间只在一个标签页里跑：跑的时候拿着锁（Web Locks），另开的标签页看到锁被拿着就不接着跑那一问
  function turnLock(id, cb, ifFree) {
    if (!navigator.locks || !navigator.locks.request) { cb(function () {}); return; }
    navigator.locks.request("tsu-turn-" + id, ifFree ? { ifAvailable: true } : {}, function (lock) {
      if (!lock) { cb(null); return; }
      return new Promise(function (release) { cb(release); });
    }).catch(function () { /* 锁不可用：不管 */ });
  }
  function resumeAll() {
    if (resumeDone || !me || !loaded) return; // 要等 agent 数据读完、登录状态回来（两个都好了才跑，谁后到谁叫）
    resumeDone = true;
    var ok = me.loggedIn && me.allowed, busy = {};
    Object.keys(resumable).forEach(function (id) {
      var t = resumable[id];
      delete resumable[id];
      var rt0 = runtime(id);
      var giveUp = function () { if (!t.worked && !t.error) { t.error = "Interrupted (page closed)"; if (rt0) { rt0.save(); rt0.redraw(t); rt0.afterReload(); } } };
      if (!ok || !rt0) return giveUp();
      busy[id] = 1;
      if (elsewhere(id)) return giveUp(); // 别的设备接过去了
      rt0.auto(function () {
        turnLock(id, function (release) {
          if (!release) { t.error = "Interrupted (page closed)"; return; } // 别的标签页正在跑它：这里不接，也不存
          if (!rt0.resumeTurn(t, release)) { release(); giveUp(); }
        }, true);
      });
    });
    if (!ok) return;
    list().forEach(function (a) {
      if (busy[a.id]) return;
      var s0 = sessions[a.current];
      if (a.pend || (s0 && s0.sleep && s0.sleep.until)) { var r = runtime(a.id); if (r) r.afterReload(); }
    });
  }

  // ======== agent 之间发消息（同 teyvat 的 social.communicate）========
  // 每条消息记在 /.paimon/SocialData/inbox/<收件人 id>.jsonl（一行一条，同 teyvat；injected = 已经交给收件人的模型）；只有人看得到
  var SOCIAL_MAX = 16384, openCheck = null;
  var msgId = function () { return "msg_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8); };
  var inboxPath = function (id) { return paimonPath("SocialData/inbox/" + id + ".jsonl"); };
  function inboxWrite(id, fn) {
    if (!window.SANDBOX || (remote() && !L().paimon)) return;
    try {
      SANDBOX.as(null, function () {
        SANDBOX.mkdirp(paimonPath("SocialData/inbox"));
        var p = inboxPath(id), old = SANDBOX.exists(p) ? SANDBOX.read(p) : "";
        var next = fn(old);
        if (next === old) return;
        SANDBOX.write(p, next);
        var st = SANDBOX.stat(p);
        if (st && st.mode !== 0o600) st.mode = 0o600;
      });
    } catch (e) { /* 沙盒还没好：记录丢了，消息照送 */ }
  }
  function inboxAppend(id, rec) { inboxWrite(id, function (old) { return old + JSON.stringify(rec) + "\n"; }); }
  // 交给模型了：把这几条标成 injected（只看最后 200 行，同 teyvat）
  function inboxMark(id, ids) {
    var want = {};
    ids.forEach(function (x) { want[x] = 1; });
    inboxWrite(id, function (old) {
      var lines = old.split("\n"), from = Math.max(0, lines.length - 201);
      for (var i = from; i < lines.length; i++) {
        if (!lines[i]) continue;
        try { var r = JSON.parse(lines[i]); if (want[r.id] && !r.injected) { r.injected = true; lines[i] = JSON.stringify(r); } } catch (e) { /* 坏行不动 */ }
      }
      return lines.join("\n");
    });
  }
  var sendErr = function (msg) { return { error: msg, text: "SendMessage: " + msg }; };
  function socialSend(from, a) {
    var text = String(a.message != null ? a.message : a.text != null ? a.text : ""), to = String(a.to || "").trim(), mode = a.mode || "queue";
    if (!to) return sendErr("`to` is required (an agent name, its id, or \"all\")");
    if (!text.trim()) return sendErr("message cannot be empty");
    if (text.length > SOCIAL_MAX) return sendErr("message too long (" + text.length + " > " + SOCIAL_MAX + ")");
    if (mode !== "interrupt" && mode !== "queue") return sendErr('mode must be interrupt|queue, got "' + mode + '"');
    var targets;
    if (to === "all" || to === "*") targets = list().filter(function (x) { return x.id !== from.id; });
    else {
      var t = agents[to] || byName(to.replace(/^@/, ""));
      if (!t) return sendErr('unknown agent "' + to + '" (ListAgents shows who exists)');
      if (t.id === from.id) return sendErr("cannot message yourself");
      if (t.archived) return sendErr(t.name + " is archived (it can't receive messages until the human restores it)");
      targets = [t];
    }
    if (!targets.length) return sendErr("there are no other agents");
    var ts = Date.now(), receipts = targets.map(function (t) {
      var rec = { id: msgId(), from: from.id, from_name: from.name, to: t.id, mode: mode, mode_used: mode, text: text, ts: ts, injected: false };
      inboxAppend(t.id, rec);
      return { name: t.name, id: t.id, status: runtime(t.id).receive(rec) };
    });
    var one = receipts.length === 1 ? receipts[0] : null;
    return {
      social: { to: one ? one.name : "", id: one ? one.id : "", count: receipts.length, mode: mode, ts: ts, lines: one ? [] : receipts.map(function (r) { return r.name + " (" + r.id + "): " + r.status; }) },
      summary: one ? "Sent and " + mode + " " + one.name + " (" + one.id + ")" : "Sent to " + receipts.length + " receivers",
      detail: text.split("\n"),
      text: (one ? "Sent and " + mode + " " + one.name + " (" + one.id + "): " + one.status : "Sent to " + receipts.length + " receivers (mode: " + mode + "):\n" + receipts.map(function (r) { return "  " + r.name + " (" + r.id + "): " + r.status; }).join("\n")) + "\n" + text,
    };
  }
  // ListAgents：同 paimon ls 的那几列（纯文字）
  function agentsTable(self) {
    var all = list();
    if (!all.length) return "No agents.";
    return all.map(function (a) {
      var r = runtime(a.id), st = r.state(), working = st === "working" || r.tasks.some(function (x) { return x.status === "running"; });
      var g = openCheck && openCheck(a.id) ? "F" : st !== "idle" || working ? "B" : "O"; // 同 paimon ls（开没开在终端里由界面告诉）
      var tag = g === "O" ? "[O]" : (working ? "[W]" : "[NW]") + " [" + g + "]", m = modelOf(a.model);
      return a.name + (a.id === self ? " (you)" : "") + "\t" + a.id + "\t" + tag + "\t" + (m ? m.name : a.model || "") + "\t" + String(r.tail() || "").replace(/\s+/g, " ").slice(0, 80);
    }).join("\n");
  }
  // 交给模型的样子（同 teyvat 的 formatPendingMsgs）：[interrupt] 09-26 11:52 paimon-02: …
  function socialLine(m) { return "[" + m.mode_used + "] " + new Date(m.ts).toLocaleString("sv").slice(5, 16) + " " + (m.from_name || m.from) + ": " + m.text; }

  // ======== 运行时：每个 agent 一个（用到才建）========
  var runtimes = {};
  function runtime(id) { return runtimes[id] || (agents[id] ? (runtimes[id] = new Runtime(agents[id])) : null); }

  function Runtime(agent) {
    var rt = this, ev = new Emitter();
    rt.agent = agent;
    rt.stream = null;   // 正在进行的一问：{ turn, t0, verb, ctl, … }
    rt.queued = null;   // 回答中又发的一条：答完接着发
    rt.tasks = [];      // 后台任务与子 agent
    var notices = [];   // 跑完、还没交给模型的后台任务
    var inbox = [];     // 别的 agent 发来、还没交给模型的消息（queue 的等这一问做完）
    // 上次刷新前留下的（排队的消息、通知、后台任务）：是这台设备留下的、或者留下它们的那台已经不跑了，才接过来
    if (agent.pend && !(SY && agent.pend.dev && agent.pend.dev !== SY.dev && elsewhere(agent.id))) {
      rt.queued = agent.pend.queued || null;
      notices = (agent.pend.notices || []).slice();
      inbox = (agent.pend.msgs || []).slice();
      (agent.pend.tasks || []).forEach(function (x) {
        var t = { id: x.id, kind: x.kind, desc: x.desc, cmd: x.cmd, status: "stopped", t0: x.t0, ms: Date.now() - (x.t0 || Date.now()), error: "stopped: the page was reloaded while it was running", result: "", log: [], tools: 0, tokensIn: 0, tokensOut: 0, background: true };
        rt.tasks.push(t);
        notices.push(t);
      });
    }
    rt.on = function (fn) { return ev.on(fn); };
    rt.fire = function (type, data) { emit(type, data); }; // 账号里拉下来的变化（别的设备上的这个 agent）：让界面重画
    var emit = function (type, data) { ev.emit(type, data); if (type === "state") hub.emit("agents"); if (type === "tasks" || type === "status" || type === "state") savePend(); };
    // 刷新不丢：排队的消息、没交出去的通知、在跑的后台任务记在 agent.pend；下次打开时接回（后台任务随页面停了，当成一条「停了」的通知）
    function savePend() {
      var run = rt.tasks.filter(function (x) { return x.status === "running"; }).map(function (x) { return { id: x.id, kind: x.kind, desc: x.desc, cmd: x.cmd, t0: x.t0 }; });
      var nt = notices.map(function (x) { return x.kind === "wake" ? { kind: "wake", text: x.text } : { kind: x.kind, id: x.id, desc: x.desc, cmd: x.cmd, status: x.status, code: x.code, error: x.error, result: String(x.result || "").slice(0, 6000), ms: x.ms }; });
      var p = run.length || nt.length || rt.queued || inbox.length ? { tasks: run, notices: nt, queued: rt.queued || null, msgs: inbox.slice(), dev: SY ? SY.dev : undefined } : null;
      if (JSON.stringify(p) === JSON.stringify(agent.pend || null)) return;
      if (p) agent.pend = p; else delete agent.pend;
      persist("agents", agent);
    }
    // 当前会话：缓存里没有、agent 搬进卷了——先从卷里读（读到之前是一个不存的空占位，读回来整个重画）；卷里也没有才开一段新的
    var ph = null;
    rt.session = function () {
      var s0 = sessions[agent.current];
      if (s0) return s0;
      if (VOL2 && agent.mig && agent.current && volMaybe(volOf(agent)) && !volMissing[agent.id]) {
        if (!ph || ph.id !== agent.current) {
          ph = { id: agent.current, agentId: agent.id, title: "", created: Date.now(), updated: 0, turns: [], sleep: null, ctx: 0 };
          Object.defineProperty(ph, "_ph", { value: true, enumerable: false });
          volLoad(agent).then(function (x) { if (x === null) return; if (!sessions[agent.current]) volMissing[agent.id] = 1; emit("reset"); emit("status"); }); // null：卷还没准备好（等准备好了 volLoadAll 再读）
        }
        return ph;
      }
      return newSession(agent);
    };
    rt.model = function () { return modelOf(agent.model); };
    rt.home = function () { return homeOf(agent); }; // 它的包就是它的家（Paimon 的 agent 没有工作目录）
    rt.setWorkdir = function () {}; // 以前「在哪个目录敲的 paimon 就在哪干活」：不要了（老的调用照样不出错）
    rt.vol = function () { return volOf(agent); };
    // 它的包里有什么、在哪（访达「显示包内容」用）：家（它自己的文件夹）、笔记、会话；cloud = 在服务器的沙盒里（要经 /api/sbx 看）
    rt.dirs = function () { var mf = memFiles(), io = volIO(volOf(agent)); return { home: rt.home(), memory: mf.dir, sessions: io ? io.base + "/" + agent.id : "", cloud: isCloud(agent) && cloudOK(), here: rt.reachable() }; }; // cloud：它的文件在服务器的沙盒里（经 /api/sbx 看）
    rt.reachable = function () { return !VOL2 || volHere(volOf(agent)); }; // 资源进卷没开：会话在账号里、在这台跑，哪台都够得着
    function save() {
      var s = rt.session();
      s.updated = Date.now();
      s.title = titleOf(s.turns) || s.title;
      agent.active = Date.now();
      persist("sessions", s);
      persist("agents", agent);
    }
    rt.save = save;

    // ---- 身份与 shell：属主、目录都用 id；出了目录看外部权限档位 ----
    function principal() { return { name: agent.id, label: agent.name, home: SANDBOX.ensureAgent(agent.id), mem: paimonPath("MemoryData/" + agent.id), outside: agent.access || "read" }; }
    var shells = {};
    function agentShell(key) {
      var s0 = shells[key || "main"] || (shells[key || "main"] = new SANDBOX.Shell(principal()));
      s0.who.outside = agent.access || "read";
      s0.who.label = agent.name;
      return s0;
    }
    var rcwds = {}; // 真沙盒里各个 shell（主 agent、子 agent）的当前目录
    rt.cwd = function () { return remote() ? rcwds.main || rt.home() : window.SANDBOX ? agentShell().cwd : rt.home(); };
    // 这个 agent（sub：子 agent）这一问能用的工具——loop、子 agent、提示词、help 都从这里拿，不会对不上
    function toolDefs(sub) {
      var t = (cfg.sandbox ? sandboxTools(agent) : []).concat(cfg.webSearch && hasTool("brave") ? [WEB_SEARCH] : [], cfg.webFetch !== false && hasTool("fetch") ? [WEB_FETCH] : []);
      if (!sub) t = t.concat([AGENT_TOOL, TASK_OUTPUT_TOOL, TASK_STOP_TOOL, TASK_CREATE, TASK_UPDATE, TASK_LIST, SEND_MESSAGE, LIST_AGENTS]);
      if (!sub) extraFor(agent).forEach(function (x) { t = t.concat(x.defs || []); }); // 外加的（全局助手的那几样）
      t.push(HELP_TOOL);
      if (!sub && REACT) t.push(HIBERNATE_TOOL);
      return t;
    }
    rt.toolNames = function (sub) { return toolDefs(sub).map(function (d) { return d.name; }); };
    function helpCtx(sub) {
      var defs = {}, lay = LA(agent), list = toolDefs(sub);
      list.forEach(function (d) { defs[d.name] = d; });
      [WEB_SEARCH, WEB_FETCH, AGENT_TOOL, TASK_OUTPUT_TOOL, TASK_STOP_TOOL, SEND_MESSAGE, LIST_AGENTS, HELP_TOOL, HIBERNATE_TOOL].concat(sandboxTools(agent)).forEach(function (d) { if (!defs[d.name]) defs[d.name] = d; });
      var common = " Args are listed below. run_in_background: start it and keep going — you get a <task-notification> when it ends (TaskOutput shows output so far, TaskStop stops it)." +
        "\n\nDesktop system commands (apps, windows, screencapture, ax, open, defaults, notifications, pbcopy / pbpaste, numbers / pages / keynote … — help lists them) work in Bash too, with pipes and > file" +
        (remote() ? ". They run in the browser rather than in your sandbox, so use them as plain commands or pipelines (`windows --json | jq …`, `cat a.csv | numbers write A1 -`), not inside if / for / $( … )." : ".") +
        " When screencapture runs, the picture is attached to the result so you can see it.";
      var bash = LOCAL && !onSrv(agent)
        ? "Runs zsh (-f, no rc files) on the user's own Mac (" + lay.os + ") with the user's login PATH (Homebrew and the like), starting in your own folder; stdin is /dev/null, no TTY. Access (" + (agent.access || "read") + "): none = read/write only your own folder; read = read anywhere, write only your own folder, temp and cache folders; rw = no limits. Apple Events (osascript to other apps) and launching apps are blocked unless access is rw. Internet access is on."
        : !remote()
        ? "Runs in the browser sandbox: a small POSIX-like shell (not bash). Supports pipes |, redirects (> >> < 2>&1 2>/dev/null &>), && || ;, heredoc (<<EOF … EOF), $VAR, ${VAR:-default}, $? $# $@ $1…, $(cmd) and backquotes, $((arithmetic)), test / [ ], sh script.sh, source. Commands: " + (window.SANDBOX && SANDBOX.commandNames ? SANDBOX.commandNames().join(" ") : "ls cat echo …") + ". node and python run real JavaScript and Python (Pyodide, downloaded the first time) on the sandbox files. The human can move a running foreground command to the background (Ctrl+B)."
        : lay.driver === "seatbelt"
          ? "Runs bash in a real macOS shell (" + lay.os + ") inside a Seatbelt sandbox: BSD coreutils, Node + npm, Python 3 + pip, git, curl, ripgrep, jq, sqlite3, Homebrew tools; internet access. Off limits: the Mac outside your folders, localhost services, other apps (osascript / open), the clipboard; setuid tools (ps, sudo) don't run. Install into your home (pip install --user, local node_modules). Output streams to the human."
          : "Runs bash in your real Linux container (" + lay.os + "): coreutils, Node 22 + npm, Python 3 + pip, git, curl, ripgrep, jq, sqlite3, build tools; internet access; no sudo. Access outside your home is enforced by Unix groups and ACLs. Install with npm / pip into your home (pip install --user, local node_modules). Output streams to the human.";
      return { tools: list.map(function (d) { return d.name; }), defs: defs, access: agent.access || "read", P0: paimonOf(agent) || SPIRIT.home, bashDetail: bash + common,
        shown: function (v) { return mapped() ? SANDBOX.toReal(v) : v; } };
    }
    rt.help = function (name, sub) { return helpText(name, helpCtx(sub)); };
    // ---- 系统命令（sys.js）：浏览器沙盒里是 shell 自己的命令；真沙盒里 Bash 碰到它们就拆开，这几段在浏览器里跑（以这个 agent 的身份、按它的档位）----
    // 网页里的镜像（/home/user ↔ 服务器上的真路径）：原生 App 里 Cloud 的 agent 不走镜像，路径原样
    var mapped = function () { return remote() && !onSrv(agent) && !!window.SANDBOX && !!SANDBOX.toReal && !!SANDBOX.toVirtual; };
    var toV = function (p) { return mapped() ? (SANDBOX.toVirtual(p) || p) : p; };
    var toR = function (v) { return mapped() ? SANDBOX.toReal(v) : v; };
    // 真沙盒里以某个身份（agent 的 id，或 "user"）读写文件：系统命令写截图、> 文件用
    function sysFiles(as, home, signal) {
      var ex = function (cmd, stdin) { return sbx.exec({ as: as, name: as === "user" ? undefined : agent.name, cmd: cmd, cwd: home, stdin: stdin, timeout_ms: 30000 }, signal); };
      return {
        readFile: function (p) { return sbx.read(as, toR(p)).then(function (buf) { return new TextDecoder().decode(buf); }); },
        readBytes: function (p) { return sbx.read(as, toR(p)).then(function (buf) { return new Uint8Array(buf); }); },
        writeFile: function (p, data, append) {
          var real = toR(p), dir = real.replace(/\/[^/]*$/, "") || "/";
          return ex("mkdir -p -- " + shq(dir)).then(function (r) {
            if (r.code) throw new Error((r.err || "").trim() || "can't create " + dir);
            if (append) return ex("cat >> " + shq(real), typeof data === "string" ? data : new TextDecoder().decode(data)).then(function (r2) { if (r2.code) throw new Error((r2.err || "").trim() || "can't write " + real); });
            return sbx.write(as, real, data);
          });
        },
      };
    }
    function sysBase(key, signal) {
      var home = rt.home(), m = rt.model();
      return Object.assign({
        agent: { id: agent.id, name: agent.name, access: agent.access || "read" }, remote: true, signal: signal, vision: !!(m && m.vision),
        principal: { name: agent.id, label: agent.name, home: toV(home), outside: agent.access || "read" },
        cwd: toV(rcwds[key] || home), home: toV(home), shown: toR, virt: toV,
      }, sysFiles(agent.id, home, signal));
    }
    // 系统命令截到的图附在结果里；终端里那一行按命令自己的样子画（⏺ Screenshot(…)）
    function sysResult(res, r, cmd) {
      if (r && r.images && r.images.length) res.images = r.images;
      if (r && r.thumb) res.thumb = r.thumb;
      if (!window.TSU_SYS) return res;
      // 这一行算哪个命令的：开头就是系统命令的算它；不然看里面有没有带标题的（截屏、表格…）
      var words = String(cmd || "").trim().split(/[\s;&|()]+/), titled = TSU_SYS.list().filter(function (c) { return c.title && words.indexOf(c.name) >= 0; });
      var name = TSU_SYS.has(words[0]) ? words[0] : titled.length ? titled[0].name : "";
      if (name) { res.sys = name; if (r && r.summary && !res.error) res.summary = r.summary; }
      return res;
    }
    function runSysPlan(p, a, key, ctx) {
      if (p.error) return Promise.resolve({ text: p.error, error: "can't run that here", code: 2, detail: [p.error] });
      var ms = Math.max(1000, Math.min(600000, parseInt(a.timeout, 10) || 120000)), timedOut = false;
      ctx.ctl = ctx.ctl || new AbortController();
      var timer = ctx.background ? 0 : setTimeout(function () { timedOut = true; ctx.ctl.abort(); }, ms);
      ctx.cancelTimeout = function () { clearTimeout(timer); };
      ctx.live = "";
      var base = sysBase(key, ctx.ctl.signal);
      return sbx.agent(agent).then(function () {
        return TSU_SYS.runPlan(p, base, function (cmd, stdin) {
          return sbx.exec({ as: agent.id, name: agent.name, cmd: cmd, cwd: rcwds[key] || rt.home(), stdin: stdin == null ? undefined : stdin, timeout_ms: ms + 2000 }, ctx.ctl.signal,
            function (chunk) { ctx.live += chunk; if (ctx.live.length > 200000) ctx.live = ctx.live.slice(-150000); })
            .then(function (r) { if (r.cwd) { rcwds[key] = r.cwd; r.vcwd = toV(r.cwd); } return r; });
        });
      }).then(function (r) {
        clearTimeout(timer);
        return sysResult(bashResult(r, timedOut || r.code === 124, ms), r, a.command);
      }, function (e) {
        clearTimeout(timer);
        if (e.name === "AbortError") return bashResult({ out: ctx.live, err: "", code: 130 }, timedOut, ms);
        return { text: "Error: " + e.message, error: e.message };
      });
    }
    var userSh = null; // 人用的 shell（! 命令）：从这个 agent 的目录开始
    function humanShell() { if (!userSh) { userSh = new SANDBOX.Shell(); userSh.cwd = rt.home(); } return userSh; }

    // 笔记与计划：/.paimon/MemoryData/<id>/NOTES.md、PLAN.md（agent 眼里的路径；老版本的 sandboxd 没有 .paimon，就还是家目录里的 AGENT.md、PLAN.md）
    var memFiles = function () {
      var P0 = paimonOf(agent);
      return P0 ? { notes: P0 + "/MemoryData/" + agent.id + "/NOTES.md", plan: P0 + "/MemoryData/" + agent.id + "/PLAN.md", dir: P0 + "/MemoryData/" + agent.id } : { notes: rt.home() + "/AGENT.md", plan: rt.home() + "/PLAN.md", dir: rt.home() };
    };
    // 真沙盒：每一轮开始前把笔记、计划取回来（没有就是空；取不到不耽误这一轮）
    var rnotes = { notes: "", plan: "" };
    function notesReady() {
      if (!remote()) return Promise.resolve();
      var get = function (p) { return sbx.read(agent.id, p).then(function (buf) { return new TextDecoder().decode(buf); }, function () { return ""; }); }, f = memFiles();
      return sbx.agent(agent).then(function () { return Promise.all([get(f.notes), get(f.plan)]); })
        .then(function (r) { rnotes.notes = r[0]; rnotes.plan = r[1]; }, function () {});
    }
    function systemPrompt(sub) {
      var home = rt.home(), m = rt.model(), notes = "", plan = "", mf = memFiles(), P0 = paimonOf(agent);
      var readOwn = function (p) { try { return SANDBOX.exists(p) ? SANDBOX.as(principal(), function () { return SANDBOX.read(p); }) : ""; } catch (e) { return ""; } };
      if (!remote()) ensureMemory(agent.id);
      notes = remote() ? rnotes.notes : readOwn(mf.notes);
      plan = remote() ? rnotes.plan : readOwn(mf.plan);
      var lay = LA(agent), access = ACCESS[agent.access || "read"];
      var computer = LOCAL && !onSrv(agent)
        ? "YOUR COMPUTER: the user's own Mac (" + lay.os + ", user " + (lay.user || "") + ") — not a sandbox: your commands run as the user. Your own folder is " + home + " — that is where you work and keep your files (the user may point you at other folders). Your access: " + access + " — enforced by macOS Seatbelt: none = read and write only your own folder; read = read anywhere, write only your own folder (plus temp and cache folders); rw = anything the user can do. The user switches it with shift+tab. On 'Operation not permitted' don't try to work around it — tell the user what access you need. This is the user's real machine: never delete, move or overwrite anything you didn't create without asking first."
        : !remote()
        ? "YOUR COMPUTER: a sandbox filesystem with a small POSIX-like shell. You are user `" + agent.id + "` (display name " + agent.name + "); your home " + home + " is your working directory (full access). /shared is shared by all agents. The human's files live in /home/user. Your access outside your home: " + access + " (the human switches it with shift+tab); file mode bits (chmod) also apply. On 'Permission denied' don't try to work around it — tell the user what access you need."
        : lay.driver === "seatbelt"
          ? "YOUR COMPUTER: a real macOS shell (" + lay.os + ") inside a Seatbelt sandbox on the user's Mac. You are `a_" + agent.id + "` (display name " + agent.name + "); your home " + home + " is your working directory. " + lay.shared + " is shared; the human works in " + lay.home + ". Your access outside your home: " + access + " — enforced by the kernel (the human switches it with shift+tab). On 'Operation not permitted' or 'Permission denied' don't try to work around it — tell the user what access you need. help Bash: what's installed and what's off limits."
          : "YOUR COMPUTER: a real Linux container (" + lay.os + "). You are Linux user `a_" + agent.id + "` (display name " + agent.name + "); your home " + home + " is your working directory. " + lay.shared + " is shared; the human (user `user`) works in " + lay.home + ". Your access outside your home: " + access + " — enforced by Unix groups and ACLs (the human switches it with shift+tab). On 'Permission denied' don't try to work around it — tell the user what access you need. help Bash: what's installed.";
      var tools = rt.toolNames(sub);
      return [
        "You are " + agent.name + " (agent id " + agent.id + "), a Paimon — an AI agent living in code.paimon.beer, a terminal-style AI workspace in the user's browser (v" + SPIRIT.version + "). Model: " + (m ? m.name : "?") + ". Now: " + new Date().toString() + ".",
        sub ? "" : REACT ? "HOW YOU RUN (ReAct): every response must call at least one tool. Text you write is shown to the user as your message. You keep running until you call `hibernate` — the only way to stop. When the task is done or you need the user, write your message and call hibernate in the same response. hibernate(until) is also a bounded wait (e.g. while a background job runs); a user message or a finished task wakes you early. Waking means work; don't hibernate just to test it."
          : "HOW YOU RUN: use tools as needed; each tool result comes back to you. When the task is done or you need the user, reply without calling a tool — that ends your turn. Background tasks you start notify you when they finish (a <task-notification> message), even after your turn ended.",
        computer,
        "TOOLS: " + tools.join(", ") + ". Each tool's description has the basics; help <name> gives the full usage of any tool, topic or app, and help lists everything.",
        sub ? "" : "TASKS: for work with several steps keep a task list (TaskCreate / TaskUpdate / TaskList) — the user watches it; one task in_progress at a time, mark it completed as soon as it's done.",
        sub ? "" : extraFor(agent).map(function (x) { try { return x.prompt ? x.prompt(agent) : ""; } catch (e) { return ""; } }).filter(Boolean).join("\n\n"),
        sub ? "" : "OTHER AGENTS: you are one of several peers; SendMessage / ListAgents talk to them (help social). Their messages reach you as `[interrupt] 09-26 11:52 paimon-02: …` — handle [interrupt] first, [queue] when you're done; answer with SendMessage (they can't see your replies).",
        cfg.sandbox && window.TSU_SYS ? "DESKTOP: you can see and drive the human's desktop with system commands run through Bash (" + TSU_SYS.list().map(function (c) { return c.name; }).join(", ") + ") — `help` lists them, <command> --help gives the usage." +
          (appDocs.length ? " Apps keep their data as plain files you can edit (" + appDocs.map(function (d) { return d.id; }).join(", ") + "; help <app>)." : "") : "",
        (P0 ? "SYSTEM FILES: " + P0 + " (help paimon); settings in " + P0 + "/config/settings.json and desktop.json (help settings) — " + (agent.access === "rw" ? "you can edit them" : "read-only for you") + ". " : "") +
          "YOUR MEMORY: your notes " + mf.notes + " and your plan " + mf.plan + " — both are loaded into this prompt every turn, so edit them to remember things across sessions; delete finished plan items. Only you and the human can read them.",
        window.STUDIO && STUDIO.get && String(STUDIO.get("callMe") || "").trim() ? "THE USER would like to be called " + JSON.stringify(String(STUDIO.get("callMe")).trim().slice(0, 40)) + "." : "", // 设置 › 账号 › Agent 怎么称呼你
        "Reply in the user's language. Markdown is rendered. Be concise. If you notice something wrong in your own context (duplicated or missing messages, odd tool results), say so plainly.",
      ].filter(Boolean).concat(cfg.instructions ? ["USER INSTRUCTIONS:\n" + cfg.instructions] : [], notes ? ["YOUR NOTES (" + mf.notes + "):\n" + notes.slice(0, 8000)] : [],
        plan ? ["YOUR PLAN (" + mf.plan + "):\n" + plan.slice(0, 4000)] : []).join("\n\n");
    }

    // ---- 整段对话 → API 消息。每一问的用户消息 = 上一次 hibernate 的结果（醒来的原因，必须排在最前）+ 期间的 ! 命令 + 用户的话 ----
    var content = function (t) {
      var blocks = (t.images || []).map(function (im) { return { type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } }; });
      if (t.ask) blocks.push({ type: "text", text: t.ask });
      return blocks;
    };
    function buildMessages(upto) {
      var messages = [], bashBuf = [];
      rt.session().turns.forEach(function (t) {
        if (t.bash !== undefined) { if (t.code !== null) bashBuf.push({ type: "text", text: "<bash-input>" + t.bash + "</bash-input>\n<bash-stdout>" + t.out.slice(0, 4000) + "</bash-stdout>" }); return; }
        if (t.note !== undefined || t.cmd !== undefined || t.ask === undefined) return;
        if (t !== upto && !(t.api && t.api.length) && !t.answer) return;
        var user = (t.pre || []).concat(bashBuf, content(t));
        bashBuf = [];
        if (!user.length) user = [{ type: "text", text: "(continue)" }];
        var last = messages[messages.length - 1];
        if (last && last.role === "user") last.content = last.content.concat(user); else messages.push({ role: "user", content: user });
        if (t === upto) return;
        if (t.api && t.api.length) messages.push.apply(messages, t.api);
        else messages.push({ role: "assistant", content: t.answer });
      });
      return messages;
    }
    // 每个 tool_use 都要有 tool_result（中断、老数据）；tool_result 必须排在用户消息最前
    function fixPairs(messages) {
      var out = [];
      messages.forEach(function (m, i) {
        out.push(m);
        if (m.role !== "assistant" || !Array.isArray(m.content)) return;
        var ids = m.content.filter(function (b) { return b.type === "tool_use"; }).map(function (b) { return b.id; });
        if (!ids.length) return;
        var next = messages[i + 1], have = {};
        if (next && next.role === "user" && Array.isArray(next.content)) next.content.forEach(function (b) { if (b.type === "tool_result") have[b.tool_use_id] = 1; });
        var missing = ids.filter(function (id) { return !have[id]; }).map(function (id) { return { type: "tool_result", tool_use_id: id, content: "Interrupted (no result)", is_error: true }; });
        if (!missing.length) return;
        if (next && next.role === "user") messages[i + 1] = { role: "user", content: missing.concat(Array.isArray(next.content) ? next.content : [{ type: "text", text: String(next.content) }]) };
        else out.push({ role: "user", content: missing });
      });
      return out.map(function (m) {
        if (m.role !== "user" || !Array.isArray(m.content)) return m;
        var r = m.content.filter(function (b) { return b.type === "tool_result"; }), o = m.content.filter(function (b) { return b.type !== "tool_result"; });
        return { role: "user", content: r.concat(o.length ? o : r.length ? [] : [{ type: "text", text: "(continue)" }]) };
      });
    }

    // ---- 睡与醒 ----
    function wakeInto(turn, reason) {
      var sl = rt.session().sleep;
      if (!sl) return;
      clearTimeout(wakeTimer);
      var txt = "Woke after " + fmtDur(Date.now() - sl.since) + ": " + reason + ". Now: " + new Date().toString() + ".";
      turn.pre = (sl.results || []).concat(sl.id ? [{ type: "tool_result", tool_use_id: sl.id, content: txt }] : []);
      rt.session().turns.forEach(function (t) { (t.parts || []).forEach(function (p) { if (p.name === "hibernate" && p.status === "sleeping" && (!sl.id || p.useId === sl.id)) { p.status = "done"; p.wake = "Slept " + fmtDur(Date.now() - sl.since) + " · woken by " + reason; } }); });
      turn.woke = reason;
      rt.session().sleep = null;
    }
    var wakeTimer = 0;
    function scheduleWake() {
      clearTimeout(wakeTimer);
      var sl = rt.session().sleep;
      if (!sl || !sl.until || agent.archived) return; // 归档的不按时醒
      var late = Date.now() - sl.until;
      // 页面关着的时候到了点：打开时补上，并告诉它睡过头了
      var reason = late > 60000 ? "timer (was due " + new Date(sl.until).toLocaleTimeString() + "; the page was closed, so you overslept by " + fmtDur(late) + ")" : "timer (" + new Date(sl.until).toLocaleTimeString() + ")";
      wakeTimer = setTimeout(function () { if (rt.session().sleep === sl && !rt.stream && !agent.archived && me && me.allowed) auto(function () { if (rt.session().sleep === sl && !rt.stream) send("", [], { system: true, reason: reason }); }); }, Math.max(0, -late));
    }
    rt.scheduleWake = scheduleWake;

    // ---- ! 命令：人在沙盒里执行（不经过模型）；也记进会话，下一问时交给模型（同 Claude Code 的 bash 模式）----
    var humanCwd = null;
    // 人的命令：Cloud 的 agent 就在 Cloud 里跑；先把它的家建好（从它的家开始）
    var hexec = function (o, sg, ch) { var ex = onSrv(agent) ? srvSbx.exec : sbx.exec; return (remote() ? sbx.agent(agent).catch(function () {}) : Promise.resolve()).then(function () { return ex(o, sg, ch); }); };
    rt.bang = function (cmd) {
      if (VOL2 && !volHere(volOf(agent))) { rt.record("!" + cmd, unreachText(agent)); return; }
      if (!cmd) return;
      if (rt.session()._ph) { volMissing[agent.id] = 1; newSession(agent); }
      var turn = { bash: cmd, out: "", code: null, at: Date.now() };
      rt.session().turns.push(turn);
      emit("append", turn);
      var hp = remote() && window.TSU_SYS ? TSU_SYS.plan(cmd) : null;
      if (hp) { // 里面有桌面的系统命令：同 agent 的 Bash，拆开跑（这里是人自己，不受档位限制）
        var hb = Object.assign({ agent: null, remote: true, cwd: toV(humanCwd || rt.home()), home: toV(LA(agent).home || rt.home()), shown: toR, virt: toV }, sysFiles("user", humanCwd || rt.home(), null));
        (hp.error ? Promise.resolve({ out: "", err: hp.error + "\n", code: 2 }) : TSU_SYS.runPlan(hp, hb, function (c, stdin) {
          return hexec({ as: "user", cmd: c, cwd: humanCwd || rt.home(), stdin: stdin == null ? undefined : stdin, timeout_ms: 600000 }, null).then(function (r) { if (r.cwd) { humanCwd = r.cwd; r.vcwd = toV(r.cwd); } return r; });
        })).then(function (r) { turn.out = (r.out + r.err).replace(/\n$/, ""); turn.code = r.code; turn.cwd = humanCwd; save(); emit("turn", turn); },
          function (e) { turn.out = (e && e.message) || String(e); turn.code = 1; save(); emit("turn", turn); });
        return;
      }
      if (remote()) {
        // 人自己的命令：以 user 的身份在真 Linux 里跑，从这个 agent 的家目录开始
        hexec({ as: "user", cmd: cmd, cwd: humanCwd || rt.home(), timeout_ms: 600000 }, null, function (chunk) { turn.out += chunk; emit("turn", turn); }).then(function (r) {
          turn.out = (r.out + r.err).replace(/\n$/, ""); turn.code = r.code; if (r.cwd) humanCwd = r.cwd; turn.cwd = humanCwd;
          save(); emit("turn", turn);
        }, function (e) { turn.out = e.message; turn.code = 1; save(); emit("turn", turn); });
        return;
      }
      SANDBOX.ready().then(function () { return humanShell().run(cmd); }).then(function (r) {
        if (r.out.indexOf("\x1b[clear]") >= 0) { rt.session().turns = rt.session().turns.filter(function (t) { return t.bash === undefined; }); save(); emit("reset"); return; }
        turn.out = (r.out + r.err).replace(/\n$/, "");
        turn.code = r.code;
        turn.cwd = humanShell().cwd;
        save();
        emit("turn", turn);
      }, function (e) { turn.out = (e && e.message) || String(e); turn.code = 1; save(); emit("turn", turn); }); // 出错也要收尾（不然一直「Running…」）
    };
    // 命令的回应（/model、/effort…）：记进对话（同 Claude Code 的 ❯ /cmd ⎿ 结果），不发给模型
    rt.record = function (cmd, result) {
      if (rt.session()._ph) { volMissing[agent.id] = 1; newSession(agent); }
      var turn = { cmd: cmd, note: result, at: Date.now() };
      rt.session().turns.push(turn);
      save();
      emit("append", turn);
      return turn;
    };

    // ---- 发消息：一问 = 一个 turn；ReAct 循环跑到 hibernate 为止 ----
    function send(text, images, opts) {
      opts = opts || {};
      if (!me || !me.loggedIn || !me.allowed) return false;
      if (VOL2 && !volHere(volOf(agent))) { if (!opts.system && String(text || "").trim()) rt.record(String(text), unreachText(agent)); return !opts.system; } // 资源进卷了、住在别的 Mac 上：这台连不上（远程访问以后再做）；没开资源进卷：会话在账号里，照旧在这台跑
      text = String(text || "").replace(/\s+$/, "");
      if (!text.trim() && !(images && images.length) && !opts.system) return false;
      if (agent.archived && opts.system) return false; // 归档的不自己醒（后台任务的通知先留着，恢复后再给）
      if (!opts.force && elsewhere(agent.id)) return false; // 正在别的设备上跑：这台不插进去（界面上说在哪台；ctrl+enter 接管 = force）
      if (agent.archived) { agent.archived = false; agent.active = Date.now(); persist("agents", agent); hub.emit("agents"); } // 给归档的发消息 = 恢复它
      if (rt.stream) {
        // 答着的时候又发：排在后面；已经排着一条就接在它后面（同 Claude Code：排队的几条一起发，一条都不丢）
        if (!opts.system) { rt.queued = rt.queued ? { text: rt.queued.text + "\n\n" + text, images: (rt.queued.images || []).concat(images || []) } : { text: text, images: images || [] }; emit("status"); }
        else { notices.push({ kind: "wake", text: text }); savePend(); }
        return true;
      }
      if (rt.session()._ph) { volMissing[agent.id] = 1; newSession(agent); } // 卷里的当前会话还没读回来就要写：先开一段新的（读回来的那段还在，/resume 回得去）
      var turn = { ask: text, images: images || [], answer: "", thinking: "", parts: [], api: [], at: Date.now(), system: !!opts.system, goal: !!opts.goal, dev: SY ? SY.dev : undefined };
      if (opts.notices && opts.notices.length) turn.notices = opts.notices;
      if (opts.social && opts.social.length) turn.social = opts.social;
      if (!opts.system && agent.goal && agent.goal.paused) { agent.goal.paused = false; agent.goal.iterations = 0; }
      wakeInto(turn, opts.reason || (opts.system ? "system" : "user message"));
      rt.session().turns.push(turn);
      save();
      var s0 = rt.stream = { turn: turn, t0: Date.now(), verb: VERBS[Math.floor(Math.random() * VERBS.length)], ctl: new AbortController(), outTokens: 0, inTokens: 0, cacheTokens: 0, cost: 0, thinking: false, thinkMs: 0, peak: isPeak() };
      emit("append", turn);
      turnLock(agent.id, function (release) { if (rt.stream === s0) s0.release = release; else if (release) release(); });
      takeLease(s0, opts.force);
      start(s0, buildMessages(turn), 0);
      return true;
    }
    rt.send = send;
    // ---- 租约：这个 agent 同一时间只在一台设备上跑（别的设备只看，见 sync.js）。开始一问时拿，跑着每 30 秒续一次，停下来放掉；
    // 拿不到（别的设备刚拿走）或续的时候发现被别的设备接管了：这一问停下，说清楚在哪台设备上 ----
    var leaseT = 0, freeT = 0;
    function takeLease(s0, force) {
      if (!SY) return;
      clearTimeout(freeT);
      SY.lease("agent:" + agent.id, "take", { force: !!force, ttl: 90000 }).then(function (j) {
        if (j.ok) return keepLease();
        if (rt.stream === s0) { s0.lostTo = j.device || "another device"; s0.ctl.abort(); }
      }, function () { keepLease(); }); // 连不上服务器：照跑，续约时再说
    }
    function keepLease() {
      if (leaseT) return;
      leaseT = setInterval(function () {
        if (!busyHere(agent.id)) return freeLease();
        SY.lease("agent:" + agent.id, "renew", { ttl: 90000 }).then(function (j) {
          if (!j.ok && rt.stream) { rt.stream.lostTo = j.device || "another device"; rt.stream.ctl.abort(); }
        }, function () {});
      }, 30000);
    }
    function freeLease() {
      clearInterval(leaseT);
      leaseT = 0;
      if (SY) SY.lease("agent:" + agent.id, "free").catch(function () {});
    }
    // 自己醒、接着刚才没跑完的、交排队的消息这些「自动」的事：先拿租约，拿到了才做（两台设备同时到点，只有一台会醒）
    function auto(fn) {
      if (!SY) return fn();
      if (elsewhere(agent.id)) return;
      SY.lease("agent:" + agent.id, "take", { ttl: 90000 }).then(function (j) { if (j.ok) { keepLease(); fn(); } }, function () { fn(); });
    }
    rt.auto = auto;
    // 跑着时转圈旁边的词（同 Claude Code 那一串），答完那行用过去式（同 Claude Code：Baked、Brewed、Churned、Cogitated、Cooked、Crunched、Sautéed、Worked）
    var VERBS = ["Accomplishing", "Baking", "Brewing", "Calculating", "Cerebrating", "Churning", "Coalescing", "Cogitating", "Computing", "Concocting", "Conjuring", "Considering", "Contemplating", "Cooking", "Crafting", "Crunching",
      "Deciphering", "Deliberating", "Divining", "Elucidating", "Enchanting", "Envisioning", "Finagling", "Forging", "Garnishing", "Generating", "Germinating", "Hatching", "Herding", "Hustling", "Ideating", "Imagining", "Incubating",
      "Inferring", "Manifesting", "Marinating", "Meandering", "Moseying", "Mulling", "Mustering", "Musing", "Noodling", "Percolating", "Perusing", "Philosophising", "Pondering", "Pontificating", "Processing", "Puttering",
      "Puzzling", "Reticulating", "Ruminating", "Scheming", "Simmering", "Spelunking", "Spinning", "Stewing", "Sussing", "Synthesizing", "Thinking", "Tinkering", "Transmuting", "Unfurling", "Unravelling", "Vibing", "Whirring", "Wrangling", "Zigzagging"];
    var DONE_VERBS = ["Baked", "Brewed", "Churned", "Cogitated", "Cooked", "Crunched", "Sautéed", "Worked"];
    function start(s0, messages, round) {
      var turn = s0.turn;
      emit("state");
      startTicker();
      Promise.resolve().then(function () { return loop(s0, messages, round); }).then(function () { finish(); }, function (e) {
        turn.error = s0.timedOut ? "No response from the model in 90s — try again" : e.name === "AbortError" ? (s0.lostTo ? "Stopped · " + agent.name + " is running on " + s0.lostTo : s0.cutBy ? "Interrupted · message from " + s0.cutBy : s0.sendNow ? "Interrupted · sent now" : "Interrupted by user") : (e.message || String(e));
        if (!s0.timedOut && e.name !== "AbortError") console.error(e);
        finish();
      });
    }
    // 刷新前没跑完的一问：接着跑。流到一半断的那一轮撤回重来；工具跑到一半的，跑完了的照交结果，没跑完的告诉模型被刷新打断了
    rt.resumeTurn = function (turn, release) {
      if (rt.stream || !me || !me.loggedIn || !me.allowed || rt.session().turns[rt.session().turns.length - 1] !== turn) return false;
      turn.resumes = (turn.resumes || 0) + 1;
      var mk = turn.mark;
      if (mk && turn.api.length <= mk.api) {
        turn.parts.length = Math.min(turn.parts.length, mk.parts);
        turn.answer = (turn.answer || "").slice(0, mk.answer);
        turn.thinking = (turn.thinking || "").slice(0, mk.thinking);
      }
      var last = turn.api[turn.api.length - 1];
      if (last && last.role === "assistant" && Array.isArray(last.content)) {
        var uses = last.content.filter(function (b) { return b.type === "tool_use"; });
        if (!uses.length) { turn.worked = "done"; save(); emit("turn", turn); return true; } // 已经答完了（没调工具的最后一轮）
        var got = {};
        turn.parts.forEach(function (p) { if (p.useId && p.res) got[p.useId] = p.res; });
        var results = uses.map(function (u) {
          var r = got[u.id];
          return r ? { type: "tool_result", tool_use_id: u.id, content: resultContent(r.c, r.i), is_error: !!r.e }
            : { type: "tool_result", tool_use_id: u.id, content: "Interrupted: the page was reloaded while this was running, so it was stopped and its result is lost. Check the current state and re-run it if it is still needed.", is_error: true };
        });
        turn.api.push({ role: "user", content: results });
      }
      turn.parts.forEach(function (p) { delete p.res; });
      var acc = turn.acc || {};
      var s0 = rt.stream = { turn: turn, t0: turn.at || Date.now(), verb: VERBS[Math.floor(Math.random() * VERBS.length)], ctl: new AbortController(), outTokens: acc.out || 0, inTokens: acc.in || 0, cacheTokens: acc.cache || 0, cost: acc.cost || 0, thinking: false, thinkMs: 0, peak: isPeak(), release: release };
      save();
      emit("turn", turn);
      start(s0, buildMessages(turn).concat(turn.api), Math.floor(turn.api.length / 2));
      return true;
    };
    // 刷新后（没有要接着跑的一问时）：别的 agent 的消息、排队的消息、留着的通知交上去，定时唤醒重新定
    rt.afterReload = function () {
      scheduleWake();
      if (rt.stream || elsewhere(agent.id)) return;
      if (inbox.length) setTimeout(function () { auto(deliverInbox); }, 300);
      else if (rt.queued) setTimeout(function () { auto(function () { if (!rt.queued || rt.stream) return; var q = rt.queued; rt.queued = null; savePend(); send(q.text, q.images); }); }, 300);
      else if (notices.length) setTimeout(function () { auto(deliverNotices); }, 300);
    };
    // ---- 别的 agent 发来的消息（SendMessage）----
    rt.pendingMsgs = function () { return inbox.length; };
    rt.receive = function (rec) {
      inbox.push(rec);
      savePend();
      emit("status");
      var can = me && me.loggedIn && me.allowed && !agent.archived;
      if (rt.stream) {
        if (rec.mode_used === "interrupt" && can) { rt.stream.cutBy = rec.from_name; rt.stream.ctl.abort(); return "interrupted it (it was working); it handles your message now"; }
        return "queued (it is working; it gets your message when this turn ends)";
      }
      if (!can) return "queued (it can't run right now; it gets your message later)";
      var far = elsewhere(agent.id);
      if (far) return "queued on this device (it is running on " + far.device + " right now; it gets your message when it runs here next)";
      var slept = !!(rt.session().sleep);
      setTimeout(function () { auto(deliverInbox); }, 0);
      return "delivered" + (slept ? " (woke it)" : "");
    };
    function deliverInbox() {
      if (rt.stream || !inbox.length || agent.archived || !me || !me.loggedIn || !me.allowed) return false;
      var l = inbox.splice(0);
      savePend();
      inboxMark(agent.id, l.map(function (m) { return m.id; }));
      var social = l.map(function (m) { return { from: m.from, from_name: m.from_name, mode: m.mode, mode_used: m.mode_used, ts: m.ts, text: m.text }; });
      send(l.map(socialLine).join("\n"), [], { system: true, reason: l.length === 1 ? "message from " + l[0].from_name : l.length + " messages from other agents", social: social });
      return true;
    }
    rt.redraw = function (turn) { emit("turn", turn); emit("state"); };
    var ticker = 0;
    function startTicker() {
      clearInterval(ticker);
      ticker = setInterval(function () { if (!rt.stream && !rt.tasks.some(function (x) { return x.status === "running"; })) { clearInterval(ticker); ticker = 0; } if (document.hidden) return; emit("tick"); }, 120); // 看不见时不转
    }
    function loop(s, messages, round) {
      s.blocks = [];
      s.stop = "";
      s.gotStop = false;
      s.sawError = false;
      s.upErr = "";
      s.upErrType = "";
      // 这一轮开始前界面上已有的：流中途断了要撤回这一轮说到一半的，再重来
      var mark = { parts: s.turn.parts.length, answer: s.turn.answer.length, thinking: (s.turn.thinking || "").length };
      s.turn.mark = { parts: mark.parts, answer: mark.answer, thinking: mark.thinking, api: s.turn.api.length }; // 刷新后接着跑：这一轮没说完就撤回到这里
      save();
      // 这一轮没成（连不上、超时、5xx、流中途断了）：撤回这一轮说到一半的，等一会儿同样的请求再来；状态行显示在等（见 live.js 的 renderStatus）
      function retryRound(why) {
        s.turn.parts.length = mark.parts;
        s.turn.answer = s.turn.answer.slice(0, mark.answer);
        s.turn.thinking = (s.turn.thinking || "").slice(0, mark.thinking);
        s.blocks = [];
        s.round = null;
        s.thinking = false;
        s.firstAt = 0;
        s.retries = (s.retries || 0) + 1;
        if (s.retries > MAX_RETRIES) { s.retries = 0; throw new Error(why + " · gave up after " + MAX_RETRIES + " retries"); }
        var ms = backoff(s.retries);
        s.wait = { attempt: s.retries, max: MAX_RETRIES, until: Date.now() + ms, why: why };
        emit("turn", s.turn);
        return sleepFor(ms, s.ctl.signal).then(function () { s.wait = null; return loop(s, messages, round); }, function (e) { s.wait = null; throw e; });
      }
      var tools = toolDefs(false);
      // 这一次请求自己的中止：Esc（整轮的 signal）连带着停；90 秒什么都没收到 = 超时，只停这一次、再试
      var actl = new AbortController(), link = function () { actl.abort(); };
      s.ctl.signal.addEventListener("abort", link);
      var first = false, timedOut = false, watchdog = setTimeout(function () { if (!first) { timedOut = true; actl.abort(); } }, 90000);
      var settle = function () { clearTimeout(watchdog); s.ctl.signal.removeEventListener("abort", link); };
      var m = rt.model();
      return notesReady().then(function () {
        return chatFetch(JSON.stringify(Object.assign({ model: m ? m.id : agent.model, effort: agent.effort || "high", system: systemPrompt(), messages: fixPairs(messages), tools: tools }, REACT ? { tool_choice: { type: "any" } } : {})), actl.signal);
      })
        .then(function (res) {
          if (!res.ok) return httpError(res).then(function (err) { if (res.status === 402) refreshMe(); throw err; });
          return readSSE(res.body.getReader(), function (ev2) { if (!first) { first = true; clearTimeout(watchdog); } onEvent(s, ev2); });
        })
        .then(function () { settle(); return null; }, function (e) {
          settle();
          if (s.ctl.signal.aborted) throw e; // Esc
          if (timedOut) return "API Error: Request timed out (no response in 90s)";
          if (e.retry || e.name === "TypeError") return e.retry ? e.message : "API Error: Connection error (" + clean(e.message) + ")"; // fetch 连不上是 TypeError
          throw e;
        })
        .then(function (retryWhy) {
          if (retryWhy) return retryRound(retryWhy);
          if (s.sawError) {
            if (/overloaded|api_error|rate_limit|timeout|internal/i.test(s.upErrType || "") || /overloaded|timeout|temporar|try again/i.test(s.upErr)) return retryRound("API Error: " + s.upErr);
            throw new Error("API Error: " + (s.upErr || "upstream error"));
          }
          if (!s.gotStop && !s.ctl.signal.aborted) return retryRound("API Error: Connection closed before the response finished");
          s.retries = 0;
          // 这一轮模型说的话（思考要带签名原样回传，工具调用要带参数）
          var blocks = s.blocks.filter(Boolean).map(function (b) {
            if (b.type === "thinking") return { type: "thinking", thinking: b.thinking, signature: b.signature || "" };
            if (b.type === "text") return { type: "text", text: b.text };
            if (b.type === "tool_use") { var input = {}, bad = false; try { input = JSON.parse(b.json || "{}"); } catch (e) { bad = true; } var tu = { type: "tool_use", id: b.id, name: b.name, input: bad ? {} : input }; if (bad) Object.defineProperty(tu, "badJson", { value: String(b.json || "").slice(0, 200) }); return tu; }
          }).filter(function (b) { return b && !(b.type === "text" && !b.text); });
          var uses = blocks.filter(function (b) { return b.type === "tool_use"; });
          var hib = uses.filter(function (b) { return b.name === "hibernate"; })[0], acts = uses.filter(function (b) { return b !== hib; });
          if (!blocks.length) blocks = [{ type: "text", text: "(no output)" }];
          s.turn.api.push({ role: "assistant", content: blocks });
          // ReAct：每一步都是工具调用（tool_choice: any），只有 hibernate 让 agent 停下。没调工具 = 一次无效动作：
          // 把「必须调工具，停下要用 hibernate」作为观察交回去（最多 2 次），再不守约才停，并把原因显示出来（不悄悄停）
          // 传统循环：不调工具就是答完了
          if (!uses.length && !REACT) {
            if (s.stop === "max_tokens") s.turn.error = "The answer hit the output limit (max_tokens) and was cut off";
            else if (!blocks.some(function (b) { return b.type === "text" && b.text.trim(); }) && !s.turn.parts.some(function (p) { return p.kind === "text" && p.text.trim(); }))
              s.turn.note = "(no content)" + (s.turn.thinking ? " — the model only thought, then stopped" : "") + " · stop_reason: " + (s.stop || "?");
            return;
          }
          if (!uses.length) {
            s.violations = (s.violations || 0) + 1;
            if (s.violations <= 2 && round < 60) {
              var obs = { role: "user", content: [{ type: "text", text: "[system] Your last response called no tool" + (s.stop && s.stop !== "end_turn" ? " (stop_reason: " + s.stop + ")" : "") + ". Every response must call at least one tool. If you are done or need the user, call hibernate now." }] };
              s.turn.api.push(obs);
              return loop(s, messages.concat([{ role: "assistant", content: blocks }, obs]), round + 1);
            }
            s.turn.error = "Stopped: the model kept answering without calling a tool" + (s.stop ? " (stop_reason: " + s.stop + ")" : "");
            return sleepAfter(s, null, [], {});
          }
          s.violations = 0;
          return Promise.all(acts.map(function (u) { return runTool(s, u); })).then(function (results) {
            if (hib) return sleepAfter(s, hib, results, hib.input || {});
            // 工具间隙：后台任务的通知跟着工具结果一起交上去（不打断正在进行的思考与输出）
            if (notices.length) {
              var nl = notices.splice(0), ni = noticeInfo(nl);
              results = results.concat([{ type: "text", text: noticeText(nl) }]);
              if (ni.length) { s.turn.parts.push({ kind: "notice", notices: ni }); emit("turn", s.turn); }
            }
            var msg = { role: "user", content: results };
            s.turn.api.push(msg);
            s.turn.parts.forEach(function (p) { delete p.res; });
            return loop(s, messages.concat([{ role: "assistant", content: blocks }, msg]), round + 1);
          });
        });
    }
    function onEvent(s, e) {
      if (rt.stream !== s) return;
      if (!s.firstAt && e.type === "content_block_delta") s.firstAt = Date.now();
      // 用量：message_start 给输入（未命中 / 命中缓存分开），message_delta 给输出（DeepSeek 在这里再给一次完整的）
      if (e.type === "message_start" && e.message && e.message.usage) { var u0 = e.message.usage; s.round = { input: u0.input_tokens || 0, cacheRead: u0.cache_read_input_tokens || 0, cacheWrite: u0.cache_creation_input_tokens || 0, output: 0 }; }
      if (e.type === "message_delta" && e.usage && s.round) {
        s.round.output = e.usage.output_tokens || s.round.output;
        if (e.usage.input_tokens !== undefined) s.round.input = e.usage.input_tokens;
        if (e.usage.cache_read_input_tokens !== undefined) s.round.cacheRead = e.usage.cache_read_input_tokens;
      }
      if (e.type === "message_delta" && e.delta && e.delta.stop_reason) s.stop = e.delta.stop_reason;
      if (e.type === "message_stop") s.gotStop = true; // 收到它才算这一轮完整说完了（没收到 = 流被掐断，见 loop 的 retryRound）
      if (e.type === "message_stop" && s.round) {
        var r = s.round;
        s.inTokens += r.input; s.cacheTokens += r.cacheRead + r.cacheWrite; s.outTokens += r.output;
        s.cost += me && !me.mock ? priceOf(rt.model(), r, s.peak) : 0;
        // 上下文占用 = 这一轮的全部输入 + 输出（下一轮都要带上）；以接口返回的为准，不自己估
        rt.session().ctx = r.input + r.cacheRead + r.cacheWrite + r.output;
        lastRound = { input: r.input + r.cacheRead + r.cacheWrite, output: r.output, at: Date.now(), sid: rt.session().id }; // 上下文明细按它放缩（contextBreakdown）
        s.round = null;
        s.turn.acc = { in: s.inTokens, cache: s.cacheTokens, out: s.outTokens, cost: s.cost };
      }
      if (e.type === "content_block_start" && e.content_block) {
        var cb = e.content_block;
        s.blocks[e.index] = { type: cb.type, text: "", thinking: "", signature: "", json: "", id: cb.id, name: cb.name };
        if (cb.type === "text") s.turn.parts.push({ kind: "text", text: "", at: Date.now() }); // at：时间戳显示用
        if (cb.type === "thinking") { s.thinking = true; s.thinkStart = Date.now(); }
      }
      var blk = e.index !== undefined && s.blocks[e.index];
      if (blk && e.type === "content_block_delta" && e.delta) {
        if (e.delta.type === "signature_delta") blk.signature += e.delta.signature || "";
        if (e.delta.type === "input_json_delta") blk.json += e.delta.partial_json || "";
        if (e.delta.type === "thinking_delta") { blk.thinking += e.delta.thinking || ""; s.turn.thinking += e.delta.thinking || ""; }
        if (e.delta.type === "text_delta") {
          blk.text += e.delta.text || "";
          var part = s.turn.parts[s.turn.parts.length - 1];
          if (part && part.kind === "text") part.text += e.delta.text || "";
          s.turn.answer += e.delta.text || "";
          if ((e.delta.text || "").indexOf("\n") >= 0) emit("turn", s.turn); // 写完一行才重排（同 line-by-line）
        }
      }
      if (e.type === "error") { s.upErr = (e.error && e.error.message) || "error"; s.upErrType = (e.error && e.error.type) || ""; s.sawError = true; } // 算不算要重试，流完了在 loop 里定
      if (e.type === "content_block_stop" && blk && blk.type === "thinking" && s.thinking) {
        s.thinking = false;
        s.thinkMs += Date.now() - s.thinkStart;
        s.turn.thought = Math.max(1, Math.round(s.thinkMs / 1000));
        emit("turn", s.turn);
      }
      if (e.type === "content_block_stop" && blk && blk.type === "text") emit("turn", s.turn);
    }
    // 目标检查：用最便宜的模型、不思考，只回 JSON { met, reason }
    var GOAL_MAX = 30;
    function transcriptTail(n) {
      var out = [];
      rt.session().turns.slice(-8).forEach(function (t) {
        if (t.ask !== undefined) out.push((t.system ? "[system] " : "User: ") + String(t.ask).slice(0, 1500));
        (t.parts || []).forEach(function (p) {
          if (p.kind === "text" && p.text.trim()) out.push("Assistant: " + p.text.slice(0, 3000));
          if (p.kind === "tool") out.push("[tool " + p.name + " " + (p.status || "") + "] " + String(p.summary || (p.input && (p.input.command || p.input.file_path || p.input.url || p.input.query)) || "").slice(0, 300) + (p.error ? " ERROR: " + String(p.error).slice(0, 200) : ""));
        });
        if (t.error) out.push("[turn error] " + t.error);
      });
      var s = out.join("\n");
      return s.length > n ? s.slice(s.length - n) : s;
    }
    // ---- 任务清单（存在会话里，跟着账号同步；/clear 开新会话就是新的清单）----
    function todoList() { var s0 = rt.session(); return s0.todo || (s0.todo = { seq: 0, items: [] }); }
    rt.todo = function () { var s0 = rt.session(); return (s0.todo && s0.todo.items) || []; };
    function todoTool(name, a) {
      var td = todoList(), items = td.items, keep = function () { persist("sessions", rt.session()); emit("status"); };
      if (name === "TaskList") return { summary: items.length ? plural(items.length, "task") : "No tasks", text: items.length ? items.map(function (x) { return "#" + x.id + " [" + x.status + "] " + x.subject; }).join("\n") : "No tasks yet." };
      if (name === "TaskCreate") {
        var subj = String(a.subject || "").trim();
        if (!subj) return { text: "subject is required", error: "bad input" };
        var x = { id: String(++td.seq), subject: subj.slice(0, 200), description: String(a.description || "").slice(0, 2000), activeForm: String(a.activeForm || "").slice(0, 120), status: "pending", at: Date.now() };
        items.push(x);
        keep();
        return { summary: "#" + x.id + " " + x.subject, text: "Task #" + x.id + " created successfully: " + x.subject };
      }
      var id = String(a.taskId == null ? "" : a.taskId).replace(/^#/, ""), t = items.find(function (y) { return y.id === id; });
      if (!t) return { text: "No task #" + id + " (TaskList shows the ids).", error: "not found" };
      if (a.status === "deleted") { items.splice(items.indexOf(t), 1); keep(); return { summary: "#" + t.id + " deleted", text: "Deleted task #" + t.id }; }
      var changed = [];
      if (["pending", "in_progress", "completed"].indexOf(a.status) >= 0 && a.status !== t.status) { t.status = a.status; changed.push("status"); }
      ["subject", "description", "activeForm"].forEach(function (k) { if (typeof a[k] === "string" && a[k] !== t[k]) { t[k] = a[k].slice(0, k === "description" ? 2000 : 200); changed.push(k); } });
      t.at = Date.now();
      keep();
      return { summary: "#" + t.id + " " + (changed.indexOf("status") >= 0 ? t.status.replace("_", " ") : changed.join(", ") || "unchanged"), text: changed.length ? "Updated task #" + t.id + " " + changed.join(", ") : "Task #" + t.id + " unchanged" };
    }

    // ---- 回来时的回顾（同 Claude Code 的「※ recap」）：离开这个会话一阵（30 分钟）再回来，便宜的模型说一两句「在做什么、下一步是什么」；/recap 随时要一句 ----
    var RECAP_AFTER = 30 * 60000, recapBusy = false;
    rt.maybeRecap = function () {
      if (recapBusy || rt.stream || elsewhere(agent.id) || !me || !me.allowed || cfg.recap === false) return;
      var ts = rt.session().turns, last = null, asks = 0;
      for (var i = ts.length - 1; i >= 0 && !last; i--) { if (ts[i].recap !== undefined) return; if (ts[i].ask !== undefined) last = ts[i]; } // 最后一条已经是回顾：不重复
      ts.forEach(function (t) { if (t.ask !== undefined && !t.system) asks++; });
      if (!last || asks < 2 || Date.now() - ((last.stats && last.stats.at) || last.at || 0) < RECAP_AFTER) return;
      rt.recap();
    };
    rt.recap = function () {
      if (recapBusy) return Promise.resolve(null);
      recapBusy = true;
      var ms = models(), m = ms.find(function (x) { return /flash|haiku/.test(x.id); }) || rt.model(), text = "", ctl = new AbortController(), tm = setTimeout(function () { ctl.abort(); }, 45000);
      return fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, signal: ctl.signal,
        body: JSON.stringify({ model: m ? m.id : agent.model, effort: "off", max_tokens: 300,
          system: "The user is coming back to this conversation after a break. Write a recap in at most two short sentences (under 50 words): what we're working on, and the next step — especially anything that is waiting on the user. Speak as the assistant to the user (\"We're …\"), in the language the user writes in. Plain text only: no markdown, no preamble.",
          messages: [{ role: "user", content: "Conversation so far (oldest first):\n" + transcriptTail(12000) }] }) })
        .then(function (res) { if (!res.ok) throw new Error("HTTP " + res.status); return readSSE(res.body.getReader(), function (e) { if (e.type === "content_block_delta" && e.delta && e.delta.type === "text_delta") text += e.delta.text || ""; }); })
        .then(function () {
          clearTimeout(tm);
          recapBusy = false;
          text = text.replace(/\s+/g, " ").trim();
          if (!text) return null;
          var turn = { recap: text, at: Date.now() };
          rt.session().turns.push(turn);
          persist("sessions", rt.session()); // 不算「用过」（不动 agent 的最近使用时间）
          emit("append", turn);
          refreshMe();
          return turn;
        }, function (e) { clearTimeout(tm); recapBusy = false; console.warn("回顾生成失败：", e.message || e); return null; });
    };

    var goalCtl = null; // 正在进行的目标检查（Esc 能停）
    function judgeGoal(goal) {
      var ms = models(), m = ms.find(function (x) { return /flash|haiku/.test(x.id); }) || rt.model(), text = "", gc = goalCtl = new AbortController(), gt = setTimeout(function () { gc.abort(); }, 60000);
      return fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, signal: gc.signal,
        body: JSON.stringify({ model: m ? m.id : agent.model, effort: "off", max_tokens: 400,
          system: "You check whether an AI agent has met a goal condition set by the user. Judge only from the conversation. Reply with JSON only, no prose: {\"met\": true or false, \"reason\": \"one short sentence\"}. Be strict: met means the condition is actually satisfied and verified, not merely attempted or promised.",
          messages: [{ role: "user", content: "Goal condition: " + goal.text + "\n\nRecent conversation (oldest first):\n" + transcriptTail(12000) }] }) })
        .then(function (res) { if (!res.ok) throw new Error("HTTP " + res.status); return readSSE(res.body.getReader(), function (e) { if (e.type === "content_block_delta" && e.delta && e.delta.type === "text_delta") text += e.delta.text || ""; }); })
        .then(function () { clearTimeout(gt); var j = /\{[\s\S]*\}/.exec(text); var v = j ? JSON.parse(j[0]) : null; if (!v || typeof v.met !== "boolean") throw new Error("Couldn't read the goal check result"); return v; },
          function (e) { clearTimeout(gt); throw e.name === "AbortError" ? new Error(gc.byUser ? "stopped" : "no answer in 60s") : e; });
    }
    function afterTurn(turn) {
      var g = agent.goal;
      if (!g || rt.stream || rt.queued || g.checking) return; // 同一时间只查一次（不重复扣费，[goal] 消息不叠）
      if (turn && /Interrupted by user/.test(turn.error || "")) { g.paused = true; persist("agents", agent); emit("status"); return; } // 按了 Esc：先停，等人
      if (g.paused) return;
      g.checking = true; emit("status");
      judgeGoal(g).then(function (v) {
        g.checking = false;
        if (agent.goal !== g) return;
        if (v.met) { agent.goal = null; persist("agents", agent); rt.record("/goal", "Goal met — " + v.reason + "（" + g.iterations + " 次检查）"); emit("status"); return; }
        g.iterations++; g.last = v.reason; persist("agents", agent); emit("status");
        if (g.iterations >= GOAL_MAX) { g.paused = true; rt.record("/goal", "已检查 " + GOAL_MAX + " 次仍未达成，已暂停（" + v.reason + "）。发送消息以继续，或输入 /goal clear"); return; }
        send("[goal] The goal is not met yet: " + v.reason + "\nKeep working until this condition holds: " + g.text, [], { system: true, reason: "goal check " + g.iterations, goal: true });
      }, function (e) { g.checking = false; g.paused = true; persist("agents", agent); emit("status"); if (e.message !== "stopped") rt.record("/goal", "目标检查出错，已暂停：" + e.message); });
    }
    rt.setGoal = function (text) { agent.goal = { text: text, set: Date.now(), iterations: 0, last: "", paused: false }; persist("agents", agent); emit("status"); };
    rt.clearGoal = function () { var had = !!agent.goal; agent.goal = null; persist("agents", agent); emit("status"); return had; };
    function finish() {
      var s = rt.stream;
      if (!s) return;
      var m = rt.model(), secs = Math.max(1, Math.round((Date.now() - s.t0) / 1000));
      s.turn.usage = { model: m && m.id, in: s.inTokens, cache: s.cacheTokens, out: s.outTokens, cost: s.cost, ms: Date.now() - s.t0, peak: s.peak };
      s.turn.stats = { secs: secs, at: Date.now(), in: s.inTokens + s.cacheTokens, out: s.outTokens, cost: s.cost, verb: DONE_VERBS[Math.floor(Math.random() * DONE_VERBS.length)],
        bg: rt.tasks.filter(function (x) { return x.status === "running"; }).length }; // 结尾那行（同 Claude Code）：✻ Brewed for 6m 51s · done
      s.turn.worked = "done";
      delete s.turn.mark;
      delete s.turn.acc;
      rt.stream = null;
      if (s.release) s.release();
      save();
      flush();
      srvFlush(); // 答完了：马上推进账号（别的设备很快就能看到）
      clearTimeout(freeT);
      freeT = setTimeout(function () { if (!busyHere(agent.id)) freeLease(); }, 2500);
      emit("turn", s.turn);
      emit("state");
      refreshMe();
      if (s.sendNow) { var sn = s.sendNow; setTimeout(function () { send(sn.text, sn.images); }, 30); } // 人按了 ctrl+enter：这一问停下，马上发
      else if (inbox.length) setTimeout(deliverInbox, s.cutBy ? 30 : 300); // 被 interrupt 打断的：马上接着处理那条消息
      else if (rt.queued) { var q = rt.queued; rt.queued = null; savePend(); setTimeout(function () { send(q.text, q.images); }, 300); }
      else if (notices.length) setTimeout(deliverNotices, 300);
      else setTimeout(function () { afterTurn(s.turn); }, 300);
    }

    // ---- hibernate：记下「睡到什么时候 / 被什么叫醒」，这一问到此结束；其余工具的结果留到醒来时和 hibernate 的结果一起交 ----
    function sleepAfter(s, hib, results, a) {
      var until = parseUntil(a.until);
      s.turn.parts.forEach(function (p) { delete p.res; });
      if (hib) s.turn.parts.push({ kind: "tool", name: "hibernate", input: a, status: "sleeping", t0: Date.now(), useId: hib.id, until: until });
      rt.session().sleep = { id: hib ? hib.id : null, since: Date.now(), until: until, summary: a.summary || "", results: results };
      agent.summary = a.summary || agent.summary || "";
      scheduleWake();
    }
    function parseUntil(u) {
      if (!u) return 0;
      var m = /^(\d+(?:\.\d+)?)\s*(s|m|h|d)$/.exec(String(u).trim());
      if (m) return Date.now() + parseFloat(m[1]) * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2]];
      var hm = /^(tomorrow\s+)?(\d{1,2}):(\d{2})$/.exec(String(u).trim());
      if (hm) { var d = new Date(); d.setHours(+hm[2], +hm[3], 0, 0); if (hm[1] || d.getTime() <= Date.now()) d.setDate(d.getDate() + 1); return d.getTime(); }
      var t = Date.parse(u);
      return isNaN(t) ? 0 : t;
    }

    // ---- 沙盒工具（在浏览器里执行）：返回 { text（给模型）, summary（⎿ 后面那句）, detail（展开看的行）, diff, error } ----
    var SANDBOX_NAMES = { Bash: 1, Read: 1, Write: 1, Edit: 1, Glob: 1, Grep: 1 };
    function bashResult(r, timedOut, ms) {
      var outText = (r.out + r.err).replace(/\x1b\[clear\]/g, ""), lines = outText.replace(/\n$/, "").split("\n").filter(function (l, i, all) { return l || i < all.length - 1; });
      var err = timedOut ? "timed out after " + fmtDur(ms) : r.code ? "exit code " + r.code : null;
      return { text: (outText || "(no output)") + (timedOut ? "\n(timed out after " + fmtDur(ms) + "; the command was stopped)" : r.code ? "\n(exit code " + r.code + ")" : ""), detail: lines, summary: lines.length ? null : "(no output)", error: err, code: r.code };
    }
    // 真沙盒里的 Bash：超时（默认 2 分钟，最多 10 分钟）与中断都会把整组进程杀掉；目录跨调用保留（同 Claude Code）
    function runBashRemote(a, key, ctx) {
      var ms = Math.max(1000, Math.min(600000, parseInt(a.timeout, 10) || 120000)), timedOut = false;
      ctx.ctl = ctx.ctl || new AbortController();
      var timer = ctx.background ? 0 : setTimeout(function () { timedOut = true; ctx.ctl.abort(); }, ms);
      ctx.cancelTimeout = function () { clearTimeout(timer); };
      ctx.live = "";
      return sbx.agent(agent).then(function () {
        return sbx.exec({ as: agent.id, name: agent.name, cmd: a.command || "", cwd: rcwds[key] || rt.home(), timeout_ms: ctx.background ? 3600000 : ms + 2000 }, ctx.ctl.signal,
          function (chunk) { ctx.live += chunk; if (ctx.live.length > 200000) ctx.live = ctx.live.slice(-150000); });
      }).then(function (r) {
        clearTimeout(timer);
        if (r.cwd) rcwds[key] = r.cwd;
        return bashResult(r, timedOut || r.code === 124, ms);
      }, function (e) {
        clearTimeout(timer);
        if (e.name === "AbortError") return bashResult({ out: ctx.live, err: "", code: 130 }, timedOut, ms);
        return { text: "Error: " + e.message, error: e.message };
      });
    }
    // 真沙盒里的文件工具（以 agent 自己的 Linux 用户读写，权限由内核判）
    function remoteFileTool(name, a, key) {
      var cwd = rcwds[key] || rt.home(), P = function (p) { return normPath(p, cwd, rt.home()); }, as = agent.id;
      var fail = function (e) { return { text: "Error: " + e.message, error: e.message }; };
      return sbx.agent(agent).then(function () {
        if (name === "Read") return sbx.read(as, P(a.file_path)).then(function (buf) {
          var text = textOf(buf);
          if (text === null) return { text: "(binary file, " + buf.byteLength + " bytes — use Bash tools like file/xxd to inspect)", summary: "Binary file (" + kb(buf.byteLength) + ")" };
          return readSlice(text, a);
        });
        if (name === "Write") return sbx.stat(as, P(a.file_path)).then(function (st) {
          return sbx.write(as, P(a.file_path), a.content || "").then(function () {
            var n = (a.content || "").split("\n").length;
            return { text: (st ? "Overwrote " : "Created ") + P(a.file_path), summary: "Wrote " + plural(n, "line") + " to " + a.file_path, detail: (a.content || "").split("\n") };
          });
        });
        if (name === "Edit") return sbx.read(as, P(a.file_path)).then(function (buf) {
          var src = textOf(buf), path = P(a.file_path);
          if (src === null) return { text: path + " is a binary file", error: "binary file" };
          var count = src.split(a.old_string).length - 1;
          if (!a.old_string || !count) return { text: "old_string not found in " + path, error: "String not found" };
          if (count > 1 && !a.replace_all) return { text: "old_string matches " + count + " times; add context or set replace_all", error: "Found " + count + " matches" };
          var at = src.indexOf(a.old_string), next = a.replace_all ? src.split(a.old_string).join(a.new_string) : src.replace(a.old_string, function () { return a.new_string; });
          return sbx.write(as, path, next).then(function () {
            var diff = editDiff(src, next, at, a.old_string.length, a.new_string.length, 3);
            var adds = diff.filter(function (d) { return d.t === "+"; }).length, dels = diff.filter(function (d) { return d.t === "-"; }).length;
            return { text: "Updated " + path + (count > 1 ? " (" + count + " occurrences)" : ""), summary: "Updated " + a.file_path + " with " + plural(adds, "addition") + " and " + plural(dels, "removal") + (a.replace_all && count > 1 ? " (" + count + " places)" : ""), diff: diff };
          });
        });
        if (name === "Glob") return sbx.glob(as, a.pattern, cwd).then(function (found) { return { text: found.join("\n") || "No files found", summary: "Found " + plural(found.length, "file"), detail: found.slice(0, 200) }; });
        if (name === "Grep") return sbx.exec({ as: as, cmd: "{ if command -v rg >/dev/null 2>&1; then rg -n --no-heading --color never " + (a.ignore_case ? "-i " : "") + "-e " + shq(a.pattern) + " -- " + shq(P(a.path || ".")) + "; else grep -rnIE " + (a.ignore_case ? "-i " : "") + "-e " + shq(a.pattern) + " -- " + shq(P(a.path || ".")) + "; fi; } 2>&1 | head -500", cwd: cwd, timeout_ms: 60000 }, null).then(function (r) {
          var hits = r.out.replace(/\n$/, "").split("\n").filter(Boolean);
          return { text: hits.slice(0, 200).join("\n") || "No matches", summary: "Found " + plural(hits.length, "line"), detail: hits.slice(0, 50) };
        });
      }).catch(fail);
    }
    // Bash：超时（默认 2 分钟，最多 10 分钟）与中断都走 signal；输出边跑边进 live（后台任务的 TaskOutput 能看到跑到哪了）
    function runBash(a, sh, ctx) {
      var ms = Math.max(1000, Math.min(600000, parseInt(a.timeout, 10) || 120000)), timedOut = false;
      ctx.ctl = ctx.ctl || new AbortController();
      var timer = ctx.background ? 0 : setTimeout(function () { timedOut = true; ctx.ctl.abort(); }, ms);
      ctx.cancelTimeout = function () { clearTimeout(timer); };
      ctx.live = "";
      var run = sh.run(a.command || "", { signal: ctx.ctl.signal, onOut: function (chunk) { ctx.live += chunk; if (ctx.live.length > 200000) ctx.live = ctx.live.slice(-150000); } });
      // 沙盒还不认 signal 的命令：超时也照样把结果交回去（命令在后台跑完为止）
      var stop = new Promise(function (res) { ctx.ctl.signal.addEventListener("abort", function () { setTimeout(function () { res({ out: ctx.live, err: "", code: 130, aborted: true }); }, 1500); }); });
      return Promise.race([run, stop]).then(function (r) { clearTimeout(timer); return bashResult(r, timedOut, ms); });
    }
    // Read 的结果：带行号的一段；offset 过了文件末尾就说清楚（不是「空文件」，也不是「读了 -3 行」）
    function readSlice(text, a) {
      if (text === "") return { text: "(empty file)", summary: "Read 0 lines" };
      var all = text.split("\n"), from = Math.max(1, a.offset || 1), to = Math.min(all.length, from - 1 + Math.max(1, a.limit || 2000));
      if (from > all.length) return { text: "The file has only " + plural(all.length, "line") + "; offset " + from + " is past the end.", summary: "Read 0 lines" };
      var body = all.slice(from - 1, to).map(function (l, i) { return String(from + i).padStart(6) + "\t" + (l.length > 2000 ? l.slice(0, 2000) + "…" : l); }).join("\n");
      return { text: body, summary: "Read " + plural(to - from + 1, "line") };
    }
    function sandboxSync(name, a, sh, P) {
      try {
        if (name === "Read") {
          return readSlice(SANDBOX.read(P(a.file_path)), a);
        }
        if (name === "Write") {
          var existed = SANDBOX.exists(P(a.file_path));
          SANDBOX.write(P(a.file_path), a.content || "");
          var n = (a.content || "").split("\n").length;
          return { text: (existed ? "Overwrote " : "Created ") + P(a.file_path), summary: "Wrote " + plural(n, "line") + " to " + a.file_path, detail: (a.content || "").split("\n") };
        }
        if (name === "Edit") {
          var path = P(a.file_path), src = SANDBOX.read(path), count = src.split(a.old_string).length - 1;
          if (!a.old_string || !count) return { text: "old_string not found in " + path, error: "String not found" };
          if (count > 1 && !a.replace_all) return { text: "old_string matches " + count + " times; add context or set replace_all", error: "Found " + count + " matches" };
          var at = src.indexOf(a.old_string), next = a.replace_all ? src.split(a.old_string).join(a.new_string) : src.replace(a.old_string, function () { return a.new_string; });
          SANDBOX.write(path, next);
          // 第一处改动的逐行对比（replace_all 改了好几处时只画第一处，摘要里写总数）
          var diff = editDiff(src, next, at, a.old_string.length, a.new_string.length, 3);
          var adds = diff.filter(function (d) { return d.t === "+"; }).length, dels = diff.filter(function (d) { return d.t === "-"; }).length;
          return { text: "Updated " + path + (count > 1 ? " (" + count + " occurrences)" : ""), summary: "Updated " + a.file_path + " with " + plural(adds, "addition") + " and " + plural(dels, "removal") + (a.replace_all && count > 1 ? " (" + count + " places)" : ""), diff: diff };
        }
        if (name === "Glob") {
          var found = SANDBOX.glob(a.pattern, sh.cwd);
          return { text: found.join("\n") || "No files found", summary: "Found " + plural(found.length, "file"), detail: found };
        }
        if (name === "Grep") {
          var re = new RegExp(a.pattern, a.ignore_case ? "i" : ""), root = P(a.path || "."), hits = [];
          (SANDBOX.isDir(root) ? SANDBOX.walk(root) : [root]).forEach(function (k) {
            var st = SANDBOX.stat(k);
            if (!st || st.dir || st.binary) return;
            SANDBOX.read(k).split("\n").forEach(function (l, i) { if (re.test(l)) hits.push(k + ":" + (i + 1) + ":" + l); });
          });
          return { text: hits.slice(0, 200).join("\n") || "No matches", summary: "Found " + plural(hits.length, "line"), detail: hits.slice(0, 50) };
        }
      } catch (e) {
        return { text: "Error: " + e.message, error: e.message };
      }
    }
    // 改动的逐行对比：{ t: "-" | "+" | " " | "…", n: 行号（删的是旧文件的，加的与上下文是新文件的）, l: 内容 }
    // old / nw 是改动前后的整个文件；at 是改动在旧文件里开始的字符位置；前后各带 ctx 行上下文，中间离得远的用 … 省略
    function editDiff(old, nw, at, oldLen, newLen, ctx) {
      ctx = ctx === undefined ? 3 : ctx;
      var before = old.slice(0, at), line0 = before.split("\n").length; // 改动所在的第一行（从 1 数）
      var startCol = before.length - before.lastIndexOf("\n") - 1;
      var oldLines = old.split("\n"), newLines = nw.split("\n");
      var oEnd = old.slice(0, at + oldLen).split("\n").length, nEnd = nw.slice(0, at + newLen).split("\n").length;
      var a = oldLines.slice(line0 - 1, oEnd), b = newLines.slice(line0 - 1, nEnd);
      // 最长公共子序列（改动区域不大，O(n·m) 够用；太大就整块删、整块加）
      var ops = [];
      if (a.length * b.length <= 250000) {
        var n = a.length, m = b.length, L = [];
        for (var i = 0; i <= n; i++) { L.push(new Int32Array(m + 1)); }
        for (i = n - 1; i >= 0; i--) for (var j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
        i = 0; j = 0;
        while (i < n || j < m) {
          if (i < n && j < m && a[i] === b[j]) { ops.push([" ", a[i]]); i++; j++; }
          else if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) { ops.push(["-", a[i]]); i++; } // 同 Claude Code：先删后加
          else { ops.push(["+", b[j]]); j++; }
        }
      } else { a.forEach(function (l) { ops.push(["-", l]); }); b.forEach(function (l) { ops.push(["+", l]); }); }
      var out = [], on = line0, nn = line0;
      for (var k = Math.max(1, line0 - ctx); k < line0; k++) out.push({ t: " ", n: k, l: newLines[k - 1] });
      // 改动区域里没变的长段：只留两头各 ctx 行
      var run = [];
      var flushRun = function (last) {
        if (!run.length) return;
        if (run.length > ctx * 2 + 1 && !last) { run.slice(0, ctx).forEach(function (x) { out.push(x); }); out.push({ t: "…" }); run.slice(-ctx).forEach(function (x) { out.push(x); }); }
        else run.forEach(function (x) { out.push(x); });
        run = [];
      };
      ops.forEach(function (o) {
        if (o[0] === " ") { run.push({ t: " ", n: nn, l: o[1] }); on++; nn++; return; }
        flushRun(false);
        if (o[0] === "-") out.push({ t: "-", n: on++, l: o[1] }); else out.push({ t: "+", n: nn++, l: o[1] });
      });
      flushRun(false);
      for (k = nEnd + 1; k <= Math.min(newLines.length, nEnd + ctx); k++) out.push({ t: " ", n: k, l: newLines[k - 1] });
      return out;
    }
    // 执行一个工具调用（不碰界面）：主循环与子 agent 共用。ctx：{ ctl, live, background }（Bash 用）
    function execTool(use, signal, depth, shellKey, ctx) {
      var a = use.input || {};
      ctx = ctx || {};
      // 外加的工具（全局助手的那几样）：在页面里跑，回一段字
      var xt = !depth ? extraFor(agent).filter(function (x) { return (x.defs || []).some(function (d) { return d.name === use.name; }); })[0] : null;
      if (xt) return Promise.resolve().then(function () { return xt.run(use.name, a, agent); }).then(function (r) { return r && typeof r === "object" ? r : { text: String(r == null ? "" : r) }; },
        function (e) { var m = (e && e.message) || String(e); return { error: m, text: use.name + ": " + m }; });
      if (use.name === "Bash" && remote()) {
        var plan = window.TSU_SYS ? TSU_SYS.plan(a.command || "") : null; // 里面有桌面的系统命令：拆开，那几段在浏览器里跑
        var runR = function (x, k, c) { return plan ? runSysPlan(plan, x, k, c) : runBashRemote(x, k, c); };
        if (a.run_in_background) {
          var rbctx = { background: true, ctl: new AbortController() };
          var rt0 = startShellTask(a.command || "", a.description, runR(a, shellKey || "main", rbctx), rbctx);
          return Promise.resolve({ task: rt0, text: "Started background task " + rt0.id + ". You'll get a <task-notification> when it finishes; keep working or hibernate." });
        }
        ctx.ctl = new AbortController();
        var rlink = function () { ctx.ctl.abort(); };
        if (signal) signal.addEventListener("abort", rlink);
        ctx.unlink = function () { if (signal) signal.removeEventListener("abort", rlink); if (ctx.cancelTimeout) ctx.cancelTimeout(); };
        return runR(a, shellKey || "main", ctx).then(function (r) { ctx.unlink(); return r; });
      }
      if (SANDBOX_NAMES[use.name] && remote()) return remoteFileTool(use.name, a, shellKey || "main");
      if (use.name === "Bash") {
        return SANDBOX.ready().then(function () {
          var sh = agentShell(shellKey);
          if (a.run_in_background) {
            var bctx = { background: true, ctl: new AbortController() };
            var t = startShellTask(a.command || "", a.description, runBash(a, sh, bctx), bctx);
            return { task: t, text: "Started background task " + t.id + ". You'll get a <task-notification> when it finishes; keep working or hibernate." };
          }
          // 前台：Esc（这一问的 signal）也停它；Ctrl+B 转后台时解开
          ctx.ctl = new AbortController();
          var link = function () { ctx.ctl.abort(); };
          if (signal) signal.addEventListener("abort", link);
          ctx.unlink = function () { if (signal) signal.removeEventListener("abort", link); if (ctx.cancelTimeout) ctx.cancelTimeout(); };
          if (window.TSU_SYS) TSU_SYS.takeImages(agent.id); // 别的命令剩下的图不算这一步的
          return runBash(a, sh, ctx).then(function (r) { ctx.unlink(); return window.TSU_SYS ? sysResult(r, TSU_SYS.takeImages(agent.id), a.command) : r; });
        });
      }
      if (SANDBOX_NAMES[use.name]) return SANDBOX.ready().then(function () { var sh = agentShell(shellKey), P = function (p) { return SANDBOX.norm(p, sh.cwd); }; return SANDBOX.as(sh.who, function () { return sandboxSync(use.name, a, sh, P); }); });
      if (use.name === "web_search") { var ws = timed(signal, 30000); return fetch("/api/tools/brave", { method: "POST", headers: { "content-type": "application/json" }, signal: ws.signal, body: JSON.stringify({ q: a.query || "", count: 5 }) })
        .then(function (r) { ws.done(); return jsonOf(r, "Web Search"); }, function (e) { ws.done(); if (ws.timedOut) return { error: "Web Search timed out (30s)" }; throw e; })
        .then(function (j) {
          if (j.error) return { text: j.error, error: j.error };
          return { results: j.results, text: j.results.map(function (x, i) { return (i + 1) + ". " + x.title + "\n" + x.url + (x.age ? " (" + x.age + ")" : "") + "\n" + x.description; }).join("\n\n") || "No results." };
        }); }
      if (use.name === "WebFetch") { var wf = timed(signal, 90000); return fetch("/api/tools/fetch", { method: "POST", headers: { "content-type": "application/json" }, signal: wf.signal, body: JSON.stringify({ url: a.url || "", prompt: a.prompt || "" }) })
        .then(function (r) { wf.done(); return jsonOf(r, "WebFetch"); }, function (e) { wf.done(); if (wf.timedOut) return { error: "WebFetch timed out (90s)" }; throw e; })
        .then(function (j) {
          if (j.redirect) return { summary: "Redirected to " + j.redirect, text: "The page redirected (" + j.status + ") to a different host: " + j.redirect + "\nCall WebFetch again with that URL if you want it." };
          if (j.error && !j.text) return { text: j.error, error: j.error };
          var body = j.answer || j.text || "(empty page)";
          return { summary: "Received " + kb(j.bytes || 0) + " (" + j.status + " " + (j.statusText || "") + ")", bytes: j.bytes, status: j.status,
            text: "URL: " + (j.finalUrl || a.url) + "\nStatus: " + j.status + " " + (j.statusText || "") + (j.title ? "\nTitle: " + j.title : "") + "\n\n" + body + (j.truncated && !j.answer ? "\n\n(page truncated)" : "") + (j.askError ? "\n\n(" + j.askError + "; showing the raw page)" : "") };
        }); }
      if (use.name === "help") { var hr = rt.help(a.name, depth > 0); return Promise.resolve({ text: hr.text, summary: hr.summary || (hr.error ? "Not found" : ""), error: hr.error, detail: String(hr.text).split("\n"), helpName: a.name || "" }); }
      if (use.name === "TaskCreate" || use.name === "TaskUpdate" || use.name === "TaskList") return Promise.resolve(depth > 0 ? { text: "Sub-agents don't have a task list.", error: "sub-agent" } : todoTool(use.name, a));
      if (use.name === "SendMessage") return Promise.resolve(depth > 0 ? { text: "Sub-agents can't message other agents.", error: "sub-agent" } : socialSend(agent, a));
      if (use.name === "ListAgents") { var nAg = list().length; return Promise.resolve({ summary: "Agents " + nAg, count: nAg, text: agentsTable(agent.id) }); }
      if (use.name === "TaskOutput") {
        var bg = rt.tasks;
        if (!a.id) return Promise.resolve({ summary: plural(bg.length, "task"), text: bg.length ? bg.map(function (x) { return x.id + "\t" + x.status + "\t" + fmtDur(x.ms || Date.now() - x.t0) + "\t" + (x.kind === "shell" ? "$ " + x.cmd : x.desc); }).join("\n") : "No background tasks." });
        var tk = bg.find(function (x) { return x.id === a.id; });
        if (!tk) return Promise.resolve({ text: "No task " + a.id, error: "no such task" });
        var out = tk.kind === "shell" ? String(tk.result || tk.error || (tk.ctx && tk.ctx.live) || "(still running, no output yet)") : (tk.result || tk.error || tk.log.filter(function (x) { return x.kind === "text"; }).map(function (x) { return x.text; }).join("\n\n") || "(no report yet)");
        if (a.tail) out = out.split("\n").slice(-a.tail).join("\n");
        return Promise.resolve({ summary: tk.id + " " + tk.status, text: tk.id + " — " + tk.status + " after " + fmtDur(tk.ms || Date.now() - tk.t0) + "\n\n" + out });
      }
      if (use.name === "TaskStop") {
        var tk2 = rt.tasks.find(function (x) { return x.id === a.id; });
        if (!tk2) return Promise.resolve({ text: "No task " + a.id, error: "no such task" });
        if (tk2.status !== "running") return Promise.resolve({ text: tk2.id + " already " + tk2.status });
        rt.stopTask(tk2.id);
        return Promise.resolve({ summary: "Stopped " + tk2.id, text: "Stopped " + tk2.id + "." });
      }
      if (use.name === "Agent") {
        if (depth > 0) return Promise.resolve({ text: "Sub-agents can't start other agents.", error: "nested agent" });
        var ag = spawnAgent(a.description || "agent", a.prompt || "", a.run_in_background ? null : signal);
        ag.background = !!a.run_in_background;
        if (a.run_in_background) return Promise.resolve({ agent: ag, text: "Started background agent " + ag.id + ". You'll be notified when it finishes; don't wait for it." });
        return ag.done.then(function () { return { agent: ag, text: ag.result || "(the agent returned no text)", error: ag.status === "error" ? ag.error : null }; });
      }
      return Promise.resolve({ text: "Unknown tool: " + use.name, error: "unknown tool" });
    }
    function runTool(s, use) {
      var part = { kind: "tool", name: use.name, input: use.input, status: "running", t0: Date.now(), useId: use.id }, ctx = {};
      s.turn.parts.push(part);
      emit("turn", s.turn);
      // 参数不是合法的 JSON（模型写坏了）：不拿空参数去跑（空的 Bash、空的 Write），告诉模型重来
      var run = use.badJson !== undefined ? Promise.resolve({ error: "invalid tool input JSON", text: "Error: the input for " + use.name + " was not valid JSON (" + use.badJson + "…). Call the tool again with valid JSON." }) : execTool(use, s.ctl.signal, 0, "main", ctx);
      // 前台的 Bash 可以按 Ctrl+B 转到后台：模型马上拿到「已转后台」，命令接着跑，跑完发通知
      if (use.name === "Bash" && !(use.input || {}).run_in_background) {
        part.ctx = ctx;
        run = Promise.race([run, new Promise(function (res) {
          part.detach = function () {
            if (ctx.unlink) ctx.unlink();
            var t = startShellTask((use.input || {}).command || "", (use.input || {}).description, run, ctx);
            part.taskId = t.id;
            res({ task: t, text: "The user moved this command to the background as task " + t.id + ". You'll get a <task-notification> when it finishes." });
          };
        })]);
      }
      // 工具自己出错（网络断了、返回的不是 JSON、沙盒一时连不上……）：当成这个工具的错误结果交回给模型，让它自己看着办；
      // 以前是整轮报错结束（「每次一出错就死」）。只有用户按了 Esc / 停止才真的结束这一轮
      return run.then(null, function (e) {
        if (s.ctl.signal.aborted) throw e;
        return { error: String((e && e.message) || e), text: "Error: " + ((e && e.message) || e) };
      }).then(function (r) {
        part.detach = null;
        delete part.ctx;
        part.status = r.error ? "error" : "done";
        ["error", "summary", "detail", "diff", "results", "bytes", "social", "count", "helpName", "sys", "thumb"].forEach(function (k) { if (r[k] !== undefined) part[k] = r[k]; });
        if (use.name === "WebFetch" && r.text) part.detail = String(r.text).split("\n").slice(0, 600);
        // 读到的内容、其他工具（MCP……）的结果：留一段在对话里（「完整结果」「结果预览」看得到；交给模型的全文不留）
        else if (r.text && part.detail === undefined && !r.error && (use.name === "Read" || toolCat(use.name) === "toolOther")) part.detail = String(r.text).split("\n").slice(0, 60);
        else if (use.name === "Agent" && r.text && !r.error && !(r.agent && r.agent.status === "running")) part.detail = String(r.text).split("\n").slice(0, 200); // 子 Agent 的报告（「结果」那一块；后台的跑完了在任务里）
        if (r.agent) { part.agentId = r.agent.id; if (r.agent.status === "running") part.status = "background"; }
        if (r.task) { part.taskId = r.task.id; part.status = "background"; }
        part.secs = Math.max(1, Math.round((Date.now() - part.t0) / 1000));
        part.res = { c: r.text, e: !!r.error, i: r.images }; // 这一批工具都跑完、交上去以后删掉（见 loop）
        save();
        emit("turn", s.turn);
        return { type: "tool_result", tool_use_id: use.id, content: resultContent(r.text, r.images), is_error: !!r.error };
      });
    }
    rt.detachBash = function () {
      var s = rt.stream, hit = null;
      if (!s) return false;
      s.turn.parts.forEach(function (p) { if (p.name === "Bash" && p.status === "running" && p.detach) hit = p; });
      if (!hit) return false;
      hit.detach();
      return true;
    };

    // ======== 后台任务与子 agent（同 Claude Code 的 Agent 工具）：子 agent 是器官——同一个身份、同一个目录，自己一份上下文 ========
    function startShellTask(cmd, desc, promise, ctx) {
      var t = { id: "b" + (rt.tasks.filter(function (x) { return x.kind === "shell"; }).length + 1), kind: "shell", desc: desc || cmd, cmd: cmd, status: "running", t0: Date.now(), tools: 0, tokensIn: 0, tokensOut: 0, log: [], result: "", background: true, ctx: ctx, ctl: ctx && ctx.ctl };
      rt.tasks.push(t);
      emit("tasks");
      startTicker();
      promise.then(function (r) { t.status = r.error ? (/timed out|exit code 130/.test(r.error) && t.stopped ? "stopped" : "error") : "done"; t.error = r.error; t.result = r.text; t.code = r.code; }, function (e) { t.status = "error"; t.error = e.message; })
        .then(function () { if (t.stopped) t.status = "stopped"; t.ms = Date.now() - t.t0; t.log.push({ kind: "text", text: "```\n" + (t.result || t.error || "") + "\n```" }); notices.push(t); emit("tasks"); emit("state"); deliverNotices(); });
      return t;
    }
    rt.stopTask = function (id) {
      var t = rt.tasks.find(function (x) { return x.id === id; });
      if (!t || t.status !== "running") return false;
      t.stopped = true;
      if (t.ctl) t.ctl.abort();
      return true;
    };
    function spawnAgent(desc, prompt, parentSignal) {
      var ag = { id: "a" + (rt.tasks.filter(function (x) { return x.kind !== "shell"; }).length + 1), kind: "agent", desc: desc, prompt: prompt, status: "running", t0: Date.now(), tools: 0, tokensIn: 0, tokensOut: 0, cost: 0, log: [], result: "", ctl: new AbortController() };
      if (parentSignal) parentSignal.addEventListener("abort", function () { ag.ctl.abort(); });
      rt.tasks.push(ag);
      emit("tasks");
      startTicker();
      var messages = [{ role: "user", content: prompt }], label = agent.name + "›" + ag.id;
      var sys = systemPrompt(true) + "\n\nYou are a sub-agent (" + label + ") doing one task for " + agent.name + ", as the same user with the same home. Work autonomously with your tools, then end with a concise final report as plain text (no tool call); that report is all " + agent.name + " will see.";
      var tools = toolDefs(true);
      var retries = 0; // 同主 agent：连不上、超时、5xx、流被掐断 → 等一会儿再来，最多 10 次
      function round(n) {
        var blocks = [], m = rt.model(), usage = null, gotStop = false, upErr = "";
        var again = function (why) {
          if (++retries > MAX_RETRIES) throw new Error(why + " · gave up after " + MAX_RETRIES + " retries");
          ag.wait = why;
          emit("tasks");
          return sleepFor(backoff(retries), ag.ctl.signal).then(function () { ag.wait = null; return round(n); });
        };
        return chatFetch(JSON.stringify({ model: m ? m.id : agent.model, effort: agent.effort || "high", system: sys, messages: messages, tools: tools.length ? tools : undefined }), ag.ctl.signal)
          .then(function (res) {
            if (!res.ok) return httpError(res).then(function (err) { throw err; });
            return readSSE(res.body.getReader(), function (e) {
              if (e.type === "message_start" && e.message && e.message.usage) { var u0 = e.message.usage; usage = { input: u0.input_tokens || 0, cacheRead: u0.cache_read_input_tokens || 0, cacheWrite: u0.cache_creation_input_tokens || 0, output: 0 }; }
              if (e.type === "message_delta" && e.usage && usage) { usage.output = e.usage.output_tokens || usage.output; if (e.usage.input_tokens !== undefined) usage.input = e.usage.input_tokens; if (e.usage.cache_read_input_tokens !== undefined) usage.cacheRead = e.usage.cache_read_input_tokens; }
              if (e.type === "message_stop") gotStop = true;
              if (e.type === "error") upErr = (e.error && e.error.message) || "upstream error";
              if (e.type === "message_stop" && usage) { ag.tokensIn += usage.input + usage.cacheRead + usage.cacheWrite; ag.tokensOut += usage.output; ag.cost += me && !me.mock ? priceOf(m, usage, isPeak()) : 0; usage = null; }
              if (e.type === "content_block_start" && e.content_block) blocks[e.index] = { type: e.content_block.type, text: "", thinking: "", signature: "", json: "", id: e.content_block.id, name: e.content_block.name };
              var b = e.index !== undefined && blocks[e.index];
              if (b && e.type === "content_block_delta" && e.delta) {
                if (e.delta.type === "text_delta") b.text += e.delta.text || "";
                if (e.delta.type === "thinking_delta") b.thinking += e.delta.thinking || "";
                if (e.delta.type === "signature_delta") b.signature += e.delta.signature || "";
                if (e.delta.type === "input_json_delta") b.json += e.delta.partial_json || "";
              }
            });
          })
          .then(function () { return null; }, function (e) {
            if (ag.ctl.signal.aborted) throw e;
            if (e.retry || e.name === "TypeError") return e.retry ? e.message : "API Error: Connection error (" + clean(e.message) + ")";
            throw e;
          })
          .then(function (retryWhy) {
            if (retryWhy) return again(retryWhy);
            if (upErr) { if (/overloaded|timeout|temporar|try again/i.test(upErr)) return again("API Error: " + upErr); throw new Error("API Error: " + upErr); }
            if (!gotStop && !ag.ctl.signal.aborted) return again("API Error: Connection closed before the response finished");
            retries = 0;
            var content2 = blocks.filter(Boolean).map(function (b) {
              if (b.type === "thinking") return { type: "thinking", thinking: b.thinking, signature: b.signature };
              if (b.type === "text") return { type: "text", text: b.text };
              if (b.type === "tool_use") { var input = {}; try { input = JSON.parse(b.json || "{}"); } catch (e) { /* 不完整 */ } return { type: "tool_use", id: b.id, name: b.name, input: input }; }
            }).filter(function (b) { return b && !(b.type === "text" && !b.text); });
            messages.push({ role: "assistant", content: content2.length ? content2 : [{ type: "text", text: "(no output)" }] });
            content2.forEach(function (b) { if (b.type === "text") { ag.log.push({ kind: "text", text: b.text }); ag.result = b.text; } });
            var uses = content2.filter(function (b) { return b.type === "tool_use"; });
            if (!uses.length || n >= 30) { if (n >= 30) ag.result += "\n(stopped after 30 tool rounds)"; return; }
            return Promise.all(uses.map(function (u) {
              var entry = { kind: "tool", name: u.name, input: u.input, status: "running", t0: Date.now() };
              ag.log.push(entry);
              ag.tools++;
              emit("tasks");
              return execTool(u, ag.ctl.signal, 1, ag.id).then(null, function (e) {
                if (ag.ctl.signal.aborted) throw e;
                return { error: String((e && e.message) || e), text: "Error: " + ((e && e.message) || e) }; // 同主 agent：工具出错交回给模型
              }).then(function (r) {
                entry.status = r.error ? "error" : "done";
                ["error", "summary", "detail", "diff", "results", "bytes", "sys"].forEach(function (k) { if (r[k] !== undefined) entry[k] = r[k]; });
                return { type: "tool_result", tool_use_id: u.id, content: resultContent(r.text, r.images), is_error: !!r.error };
              });
            })).then(function (results) { messages.push({ role: "user", content: results }); return round(n + 1); });
          });
      }
      ag.done = round(0).then(function () { ag.status = "done"; }, function (e) { ag.status = e.name === "AbortError" ? "stopped" : "error"; ag.error = e.message; })
        .then(function () {
          ag.ms = Date.now() - ag.t0;
          emit("tasks");
          refreshMe();
          if (ag.background) { notices.push(ag); deliverNotices(); }
          if (ag.background && window.TSU_DESK && TSU_DESK.notify) TSU_DESK.notify({ app: "终端", key: "task:" + agent.id + ":" + ag.id + ":" + ag.t0, data: { agent: agent.id }, title: agent.name + " · " + ag.id + " " + ag.status, body: ag.desc, onClick: function () { hub.emit("open", agent.id); } });
        });
      return ag;
    }
    function noticeText(list0) {
      return list0.map(function (x) {
        if (x.kind === "wake") return x.text;
        return "<task-notification>" + (x.kind === "shell" ? "Background task " + x.id + " ($ " + x.cmd + ")" : "Background agent " + x.id + " (" + x.desc + ")") + " " + x.status + " after " + fmtDur(x.ms) +
          ".\nResult:\n" + String(x.result || x.error || "(none)").slice(0, 6000) + "</task-notification>";
      }).join("\n");
    }
    // 界面上那一行要的（同 Claude Code：● Background command "描述" completed (exit code 0)）
    function noticeInfo(list0) {
      return list0.filter(function (x) { return x.kind !== "wake"; }).map(function (x) { return { kind: x.kind, id: x.id, desc: x.desc, cmd: x.cmd, status: x.status, code: x.code, error: x.error }; });
    }
    function deliverNotices() {
      if (rt.stream || !notices.length || agent.archived) return; // 跑着：loop 会在下一个工具间隙带上；归档的：恢复时再给
      var l = notices.splice(0), n = l.filter(function (x) { return x.kind !== "wake"; }).length;
      savePend();
      send(noticeText(l), [], { system: true, reason: n ? n + " background task" + (n > 1 ? "s" : "") + " finished" : "system", notices: noticeInfo(l) });
    }

    // ---- 给界面用的操作 ----
    rt.wakeUp = function () { scheduleWake(); if (inbox.length) setTimeout(function () { auto(deliverInbox); }, 300); else if (notices.length) setTimeout(function () { auto(deliverNotices); }, 300); }; // 从归档里恢复：定时唤醒、留着的消息和通知接着来
    rt.interrupt = function () {
      if (rt.stream) { rt.stream.ctl.abort(); return true; }
      if (agent.goal && agent.goal.checking && goalCtl) { goalCtl.byUser = true; goalCtl.abort(); return true; } // 正在查目标：停下（目标暂停）
      return false;
    };
    rt.takeQueued = function () { var q = rt.queued; rt.queued = null; emit("status"); return q; };
    rt.sendNow = function (text, images) {
      text = String(text || "").replace(/\s+$/, "");
      images = images || [];
      if (!rt.stream) { if (!text.trim() && !images.length && rt.queued) { var q0 = rt.queued; rt.queued = null; savePend(); return send(q0.text, q0.images); } return send(text, images, { force: true }); } // 正在别的设备上跑时 = 接管到这台
      var q = rt.queued, merged = { text: [q ? q.text : "", text].filter(function (x) { return x && x.trim(); }).join("\n\n"), images: (q ? q.images || [] : []).concat(images) };
      if (!merged.text.trim() && !merged.images.length) return false;
      rt.queued = null;
      rt.stream.sendNow = merged;
      savePend();
      emit("status");
      rt.stream.ctl.abort();
      return true;
    };
    rt.clear = function () { if (rt.stream) rt.stream.ctl.abort(); clearTimeout(wakeTimer); newSession(agent); emit("reset"); emit("state"); };
    rt.resume = function (sid) { if (!sessions[sid] || sessions[sid].agentId !== agent.id) return false; if (rt.stream) rt.stream.ctl.abort(); agent.current = sid; persist("agents", agent); emit("reset"); scheduleWake(); return true; };
    rt.setModel = function (id) { agent.model = id; persist("agents", agent); writeIdentity(agent); emit("config"); hub.emit("agents"); };
    rt.setEffort = function (e) { if (EFFORTS.indexOf(e) < 0) return false; agent.effort = e; persist("agents", agent); writeIdentity(agent); emit("config"); return true; };
    rt.setAccess = function (a) { agent.access = a; persist("agents", agent); writeIdentity(agent); emit("config"); if (remote()) sbx.agent(agent).catch(function (e) { console.error(e); }); };
    rt.rename = function (name) {
      if (!validName(name)) return "Names start with a letter and use only letters, digits, ., - and _ (max 45)";
      name = autoNumber(name, agent);
      var other = byName(name);
      if (other && other !== agent) return "There is already an agent named " + name;
      agent.name = name; persist("agents", agent); writeIdentity(agent);
      if (remote()) sbx.agent(agent).catch(function (e) { console.error(e); }); // 真沙盒里的名字（whoami、提示符）也换
      emit("config"); hub.emit("agents");
      return "";
    };
    // 状态：working（在跑）/ waiting（睡着，定了时间或等后台任务）/ idle（睡着等人）
    rt.state = function () {
      if (rt.stream) return "working";
      var sl = rt.session().sleep, running = rt.tasks.some(function (x) { return x.status === "running"; });
      if ((sl && sl.until) || running) return "waiting";
      return "idle";
    };
    rt.ctx = function () { var m = rt.model(), t = rt.session().ctx || 0; return { tokens: t, window: m ? m.ctx : 0, pct: m && m.ctx ? t / m.ctx * 100 : 0 }; };
    // ---- 上下文占用的明细（同 Claude 的「Context window」，ctxmap.js 画）：下一次请求真的会带上的几块——系统提示（基本说明、笔记、计划、扩展的说明、
    //      你的指令）、工具定义（系统工具 / 扩展工具，一样一个）、对话（文字、图片）——先按字数估，再按上一轮接口给的真实用量（输入 + 缓存 + 输出）
    //      等比例放缩，加起来就是真的总数；还没说过话：只有估算（estimated）。这个 runtime 不自动压缩，没有「压缩预留」 ----
    var lastRound = null;
    rt.contextBreakdown = function () {
      var m = rt.model(), win = (m && m.ctx) || 0;
      var est = function (s) { s = String(s || ""); var cjk = (s.match(/[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/g) || []).length; return Math.round(cjk * 0.9 + (s.length - cjk) / 3.6); };
      var readOwn = function (p) { try { return SANDBOX.exists(p) ? SANDBOX.as(principal(), function () { return SANDBOX.read(p); }) : ""; } catch (e) { return ""; } };
      var sys = "", mf = memFiles(), notes = "", plan = "", extras = "", instr = cfg.instructions || "";
      try { sys = systemPrompt(); } catch (e) { sys = ""; }
      try { notes = String((remote() ? rnotes.notes : readOwn(mf.notes)) || "").slice(0, 8000); plan = String((remote() ? rnotes.plan : readOwn(mf.plan)) || "").slice(0, 4000); } catch (e) { /* 读不到就当没有 */ }
      var ext = extraFor(agent), extNames = {};
      try { extras = ext.map(function (x) { return x.prompt ? x.prompt(agent) : ""; }).filter(Boolean).join("\n\n"); } catch (e) { extras = ""; }
      ext.forEach(function (x) { (x.defs || []).forEach(function (d) { extNames[d.name] = 1; }); });
      var tNotes = est(notes), tPlan = est(plan), tExtras = est(extras), tInstr = est(instr), tBase = Math.max(0, est(sys) - tNotes - tPlan - tExtras - tInstr);
      var sysTools = [], extTools = [];
      try { toolDefs(false).forEach(function (d) { (extNames[d.name] ? extTools : sysTools).push({ name: d.name, tokens: est(JSON.stringify(d)) }); }); } catch (e) { /* 没有工具 */ }
      var tText = 0, nImg = 0;
      try {
        buildMessages(null).forEach(function (mm) {
          var c = mm.content;
          if (typeof c === "string") { tText += est(c); return; }
          (c || []).forEach(function (b) { if (b && b.type === "image") nImg++; else tText += est(b && b.type === "text" ? b.text : JSON.stringify(b)); });
        });
      } catch (e) { /* 对话还没载进来 */ }
      var tImg = nImg * 1600; // 一张图大约的 token（按 1568 像素宽高算的上限附近）
      var sum = function (l) { return l.reduce(function (a, x) { return a + x.tokens; }, 0); };
      var parts = [
        { id: "messages", label: "对话", tokens: tText + tImg, color: "#5b8def", items: [{ name: "文字", tokens: tText }].concat(nImg ? [{ name: "图片 × " + nImg, tokens: tImg }] : []) },
        { id: "extTools", label: "扩展工具", tokens: sum(extTools), color: "#d9774b", items: extTools },
        { id: "extPrompts", label: "扩展说明", tokens: tExtras, color: "#4caf7d" },
        { id: "sysTools", label: "系统工具", tokens: sum(sysTools), color: "#d4a33b", items: sysTools },
        { id: "system", label: "系统提示", tokens: tBase, color: "#9b9b9b" },
        { id: "memory", label: "记忆文件", tokens: tNotes + tPlan, color: "#c2c2c2", items: [{ name: mf.notes.split("/").pop(), tokens: tNotes }, { name: mf.plan.split("/").pop(), tokens: tPlan }].filter(function (x) { return x.tokens > 0; }) },
        { id: "instructions", label: "你的指令", tokens: tInstr, color: "#7a7a7a" },
      ].filter(function (p) { return p.tokens > 0; });
      // 按真实用量放缩：上一轮是这段会话的——输入 + 输出（输出下一轮也要带上）；没有：用会话记下的 ctx；都没有：就是估算
      var e0 = sum(parts), real = lastRound && lastRound.sid === rt.session().id ? lastRound.input + lastRound.output : rt.session().ctx || 0, k = real && e0 ? real / e0 : 1;
      if (k !== 1) parts.forEach(function (p) { p.tokens = Math.round(p.tokens * k); (p.items || []).forEach(function (x) { x.tokens = Math.round(x.tokens * k); }); });
      var total = sum(parts);
      return { total: total, window: win, pct: win ? total / win * 100 : 0, estimated: !real, buffer: 0, parts: parts, at: lastRound && lastRound.sid === rt.session().id ? lastRound.at : rt.session().updated || 0, model: m ? m.name : "" };
    };
    // 一行近况（agents 列表用）：在做的事 / 最后说的话 / hibernate 的摘要
    rt.tail = function () {
      var s = rt.stream;
      if (s) {
        var p = s.turn.parts.filter(function (x) { return x.kind === "tool" && x.status === "running"; }).pop();
        if (p) return (p.name === "Bash" ? "$ " + ((p.input || {}).command || "") : p.name + " " + JSON.stringify(p.input || {}).slice(0, 60));
        var txt = s.turn.answer.trim().split("\n").pop();
        return txt || (s.firstAt ? "thinking" : "waiting for the model");
      }
      var sl = rt.session().sleep;
      if (sl && sl.summary) return sl.summary;
      var turns = rt.session().turns;
      for (var i = turns.length - 1; i >= 0; i--) {
        var t = turns[i];
        if (t.answer && t.answer.trim()) return plainLine(t.answer.trim().split("\n").filter(function (l) { return l.trim() && !/^\s*(```|[-|: ]+$)/.test(l); }).pop() || "");
        if (t.error && !/^Interrupted/.test(t.error)) return "✕ " + t.error;
        if (t.ask && !t.system) return "You: " + t.ask.trim().split("\n")[0] + (t.error ? " (interrupted)" : "");
      }
      return "new";
    };
    rt.cost = function () { var c = 0; rt.session().turns.forEach(function (t) { if (t.usage) c += t.usage.cost || 0; }); return c; };
    setTimeout(scheduleWake, 0);
  }

  // 别的 agent 的运行时（Claude Code 的会话，claude.js 登记）：id 是 cc:<会话 id>；刷新后第一次用到时由 claude.js 现建
  // 连接器的会话（ext.js 的 TSU_CONNECTORS）：id 的前缀是哪个连接器——cc: Claude Code（claude.js）、cx: Codex（codex.js）
  var externals = {}, extResolve = {};
  function ext(id) { if (externals[id]) return externals[id]; var m = /^([a-z]+):/.exec(String(id)), f = m && extResolve[m[1]]; if (f) { var r = f(id); if (r) externals[id] = r; return r || null; } return null; }
  window.TSU_AGENTS = {
    SPIRIT: SPIRIT,
    remote: remote, layout: function () { return L(); }, // 真沙盒开着没有、它的路径布局
    sandboxWaiting: function () { return !!(me && me.sandbox && !(window.SANDBOX && SANDBOX.mirrorActive && SANDBOX.mirrorActive())); }, // 配了真沙盒、还没连上（访达里显示「正在连接」）
    importLocal: importLocal, // 浏览器沙盒里的文件导进真沙盒（访达的菜单用）
    describeApp: describeApp, // App 登记自己的数据文件在哪（agent 的提示词里一行，help <app> 看细节）
    registerActions: registerActions, // 老接口：App 登记能做的事 → 系统命令（TSU_SYS.registerApp）
    CFG_SCHEMA: CFG_SCHEMA, CFG_DEFAULT: CFG_DEFAULT,
    ready: function () { return loading || (loading = load()); },
    on: function (fn) { return hub.on(fn); },
    emit: function (t, d) { hub.emit(t, d); },
    list: list, byName: byName, create: create,
    get: function (id) { if (agents[id]) return agents[id]; var x = ext(id); return x ? x.agent : null; },
    runtime: function (id) { return runtimes[id] || (agents[id] ? runtime(id) : ext(id)); },
    liveRuntimes: function () { return Object.keys(runtimes).map(function (k) { return runtimes[k]; }); }, // 已经起来的那些（底部面板的「Agent 活动」用：不为了看一眼把每个 agent 都叫醒）
    setOpenCheck: function (fn) { openCheck = fn; }, // 界面告诉：这个 agent 开在哪个终端面板里没有（[F]）
    sessionsOf: function (id) { return Object.keys(sessions).map(function (k) { return sessions[k]; }).filter(function (s) { return s.agentId === id && s.turns.length; }).sort(function (a, b) { return b.updated - a.updated; }); },
    allSessions: function () { return Object.keys(sessions).map(function (k) { return sessions[k]; }); },
    // 归档：不在列表里了，但什么都不删（会话、家目录都在）；归档的在 agent 列表最下面「Archived」，可以恢复。没有删除
    archive: function (id) { var a = agents[id]; if (!a) return; if (runtimes[id]) runtimes[id].interrupt(); a.archived = true; a.archivedAt = Date.now(); persist("agents", a); hub.emit("agents"); },
    // 删除（界面上先问过）：哪儿都不再出现——列表、已归档、访达，别的设备同步过去也一样。同步只加不删（见上面的同步）：这里是一个标记
    // （deleted，同时算归档：不会被叫醒、名字的号不重用），会话、家目录都还在，删错了还找得回来
    remove: function (id) { var a = agents[id]; if (!a || a.deleted) return; if (runtimes[id]) runtimes[id].interrupt(); a.archived = true; a.deleted = true; a.deletedAt = a.archivedAt = Date.now(); a.pinned = false; persist("agents", a); hub.emit("agents"); },
    // 分支（Fork）：一个新的 agent，带着这个 agent 当前会话到现在为止的对话（还没答完的那一轮不带），模型、推理强度、权限、工作目录（这台 Mac）也一样；
    // 从这里另开一条路往下聊，原来的不动。名字接着编号（dev-02 → 下一个空着的 dev-NN）
    fork: function (id) {
      var src = agents[id];
      if (!src || src.deleted) return null;
      var s0 = sessions[src.current] || { turns: [] }, rt0 = runtimes[id], turns = s0.turns.slice(0, rt0 && rt0.stream ? -1 : s0.turns.length);
      var a = create({ name: src.name, model: src.model, effort: src.effort, access: src.access, vol: volOf(src), path: src.path || "" }), s = sessions[a.current]; // 同一个卷、同一个文件夹
      Object.keys(s0).forEach(function (k) { if (["id", "agentId", "created", "updated", "turns", "sleep"].indexOf(k) >= 0) return; var v = JSON.stringify(s0[k]); if (v !== undefined) s[k] = JSON.parse(v); });
      s.turns = JSON.parse(JSON.stringify(turns)); // 回合里挂着的函数（detach）去掉
      s.forkOf = { agent: id, session: s0.id || "" };
      s.updated = Date.now();
      persist("sessions", s);
      hub.emit("agents");
      return a;
    },
    unarchive: function (id) { var a = agents[id]; if (!a || !a.archived || a.deleted) return; a.archived = false; a.active = Date.now(); persist("agents", a); hub.emit("agents"); if (runtimes[id] && runtimes[id].wakeUp) runtimes[id].wakeUp(); },
    // 履历：这个 agent 所有会话一共过了多少 token（输入 + 缓存 + 输出），同 teyvat 的「履历」
    history: function (id) {
      var a = agents[id];
      if (!a) return 0;
      var key = (a.sessions || []).map(function (sid) { var s0 = sessions[sid]; return s0 ? sid + ":" + s0.updated + ":" + s0.turns.length : ""; }).join("|");
      if (a._hist && a._hist.key === key) return a._hist.n;
      var n = 0;
      (a.sessions || []).forEach(function (sid) { var s0 = sessions[sid]; if (s0) s0.turns.forEach(function (t) { if (t.usage) n += (t.usage.in || 0) + (t.usage.cache || 0) + (t.usage.out || 0); }); });
      Object.defineProperty(a, "_hist", { value: { key: key, n: n }, writable: true, configurable: true, enumerable: false }); // 不存进 IndexedDB
      return n;
    },
    // 置顶：agent 列表最上面「Pinned」一组（在 agent 列表里连按两次 ctrl+p）
    pin: function (id, on) { var a = agents[id]; if (!a) return; a.pinned = on !== false; a.pinnedAt = a.pinned ? Date.now() : 0; persist("agents", a); hub.emit("agents"); },
    // 全局助手（globalagent.js）：外加工具的登记处；那一个 agent 本身（不在 list() 里）；把一个 agent 标成全局助手
    addTools: function (x) { if (x && x.defs && x.run) EXTRA_TOOLS.push(x); },
    globalAgent: function () { return Object.keys(agents).map(function (k) { return agents[k]; }).filter(function (a) { return a.global && !a.deleted; })[0] || null; },
    markGlobal: function (id) { var a = agents[id]; if (!a) return; a.global = true; persist("agents", a); hub.emit("agents"); },
    archived: function () { return Object.keys(agents).map(function (k) { return agents[k]; }).filter(function (a) { return a.archived && !a.deleted; }).sort(function (a, b) { return (b.archivedAt || 0) - (a.archivedAt || 0); }); },
    // 别的 agent（Claude Code 的会话，claude.js）：同一个界面画，运行时是它们自己的（id 是 cc:<会话 id>）
    registerExternal: function (id, rt) { externals[id] = rt; },
    setExternalResolver: function (fn, prefix) { extResolve[prefix || "cc"] = fn; }, // 连接器按自己的前缀登记（cc、cx……）
    me: function () { return me; }, refreshMe: refreshMe, adminCommand: adminCommand, models: models, modelOf: modelOf, providerOf: providerOf,
    elsewhere: function (id) { return elsewhere(id); }, // 正在别的设备上跑：{ device（名字）, until }；否则 null
    local: function () { return !!LOCAL; }, // Paimon Terminal：工具在这台 Mac 上
    // ---- 卷与文件夹：agent 住在哪个卷（local:<设备> / cloud）、在哪个文件夹；索引跟着账号走，会话这些资源只在卷里 ----
    volumes: function () {
      var seen = {}, out = [];
      var add = function (v) { if (seen[v]) return; seen[v] = 1; out.push({ id: v, kind: v === "cloud" ? "cloud" : "local", label: volLabel(v), here: volHere(v), mine: v === "cloud" || (!!LOCAL && v === localVol()) }); };
      if (LOCAL) add(localVol());
      if (cloudOK() || !LOCAL) add("cloud");
      Object.keys(agents).forEach(function (id) { var a = agents[id]; if (!a.deleted) add(volOf(a)); });
      Object.keys(dirs).forEach(function (k) { if (dirs[k]) add(dirs[k].vol); });
      return out;
    },
    volOf: function (id) { var a = agents[id]; return a ? volOf(a) : ""; },
    volLabel: volLabel,
    volHere: volHere,
    reachable: function (id) { var a = agents[id]; return a && VOL2 ? volHere(volOf(a)) : true; },
    localVol: function () { return LOCAL ? localVol() : ""; },
    folders: folders, mkdir: mkdir, rmdir: rmdir, moveDir: moveDir, move: moveAgent, normDir: normDir,
    volumesV2: function () { return VOL2; }, // 资源进卷开着没有（这台设备）
    volStatus: function () { return { v2: VOL2, error: volErr, pending: Object.keys(volDirty).length, migrated: Object.keys(agents).filter(function (id) { return agents[id].mig; }).length }; },
    volLoad: function (id) { var a = agents[id]; return a ? volLoad(a) : Promise.resolve(false); },
    volFlush: function () { return volFlush(); },
    sync: function () { return srvFlush(); }, // 马上把这台改了的推进账号
    cfg: cfg, setCfg: setCfg, setCfgMany: setCfgMany, STATUS_FIELDS: STATUS_FIELDS, FOOTER_FIELDS: FOOTER_FIELDS, EFFORTS: EFFORTS, ACCESS: ACCESS,
    toolCat: toolCat, TOOL_KEYS: TOOL_KEYS, TOOL_MODES: TOOL_MODES,
    // 这一次工具调用按设置显示成哪一档（出错的：设置了「出错的结果总是完整显示」就是 full）；over：别的地方临时换的档位（预览、右侧栏）
    // 按工具单独设的（toolModes）盖过类别；over 同样可以带 toolModes
    toolMode: function (p, over) {
      var n = p && p.name, k = toolCat(n), own = ((over && over.toolModes) || cfg.toolModes || {})[n];
      var m = own || (over && over[k] !== undefined ? over[k] : cfg[k] || CFG_DEFAULT[k]);
      if (n === "SendMessage" && !own) { var ao = cfg.agentOut && cfg.agentOut !== "inherit" ? cfg.agentOut : cfg.agentMsgs || "full"; m = ao === "full" ? "full" : ao === "line" ? "call" : "hidden"; } // 发出的消息按「Agent 消息 › 发出的」
      return p && p.status === "error" && cfg.errorsFull !== false ? "full" : m;
    },
    isPeak: isPeak, priceOf: priceOf,
    fmt: { k: fmtK, dur: fmtDur, money: money, kb: kb, plural: plural,
      // 一问用了多久（同 Claude Code 2.1.281 的 Qt，「✻ Baked for …」那一行）：不到一分钟按整秒往下取（59.6 秒是 59s）；「2m 5s」「1h 2m 3s」；一天以上「1d 2h 3m」
      ccDur: function (ms) {
        ms = +ms || 0;
        if (ms < 60000) return ms === 0 ? "0s" : ms < 1 ? (ms / 1000).toFixed(1) + "s" : Math.floor(ms / 1000) + "s";
        var d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4), s = Math.round(ms % 6e4 / 1000);
        if (s === 60) { s = 0; m++; } if (m === 60) { m = 0; h++; } if (h === 24) { h = 0; d++; }
        return d > 0 ? d + "d " + h + "h " + m + "m" : h > 0 ? h + "h " + m + "m " + s + "s" : m + "m " + s + "s";
      },
      // 短的（子 Agent 报告那一行）：1h 25m、4m 5s、12s；460k、1.2M
      durS: function (ms) { var s = Math.max(0, Math.round((+ms || 0) / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? h + "h " + m + "m" : m ? m + "m" + (m < 10 && s % 60 ? " " + s % 60 + "s" : "") : s + "s"; },
      kS: function (n) { n = +n || 0; return n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M" : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, "") + "k" : String(n); } },
    flush: flush,
    validName: validName,
  };
})();
