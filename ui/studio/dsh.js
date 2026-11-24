(function () {
  "use strict";
  var sessions = [], workspaces = [], pending, scanned = 0, error = "";
  function enabled() {
    return window.nadosNative && nadosNative.local && !nadosNative.remote && TSU_CONNECTORS.on("dsh");
  }
  async function read(id, helper = "dsh_sessions.py") {
    if (!enabled()) throw new Error("DSH 连接器未启用");
    var dir = window.TSU_UI_LOCAL && TSU_UI_LOCAL.dir;
    if (!dir) throw new Error("未找到本机界面目录");
    var args = ["python3", dir + "/studio/" + helper];
    if (id) args.push(id);
    var result = await TSU_LOCAL.exec({cmd: args.map(function (arg) { return "'" + arg.replace(/'/g, "'\\''") + "'"; }).join(" ")});
    if (result.code) throw new Error(result.err || "读取 DSH 记录失败");
    return JSON.parse(result.out);
  }
  function refresh() {
    if (!pending) pending = read().then(function (items) { 
      if (!Array.isArray(items.sessions) || !Array.isArray(items.workspaces)) throw new Error("无效的工作区列表");
      sessions = items.sessions; workspaces = items.workspaces; error = "";
      try { localStorage.setItem("tsu-sidebar-dsh-v1", JSON.stringify({sessions:sessions, workspaces:workspaces})); } catch (_) {}
     }).catch(function (e) { error = e.message; }).finally(function () {
      scanned = Date.now(); pending = null; document.dispatchEvent(new Event("tsu-dsh"));
    });
    return pending;
  }
  var balanceLabel = "", balanceChecked = 0, balanceRequest;
  function balance() {
    if (balanceRequest) return balanceRequest;
    if (Date.now() - balanceChecked < 60000) return Promise.resolve();
    balanceChecked = Date.now();
    balanceRequest = read("--balance", "dsh_send.py").then(wallet => {
      var totals = new Map();
      if (wallet?.status === "ready") for (var item of [...wallet.value, ...wallet.bonusWallets]) totals.set(item.currency, (totals.get(item.currency) || 0) + Number(item.balance));
      var items = Array.from(totals, ([currency,total]) => ({currency,total}));
      balanceLabel = items.map(b => new Intl.NumberFormat("zh-CN", {style:"currency", currency:b.currency}).format(b.total)).join(" / ");
    }).catch(() => { balanceLabel = ""; }).finally(() => { balanceRequest = null; });
    return balanceRequest;
  }
  function ensure(id) {
    var A = window.TSU_AGENTS, aid = "dsh:" + id;
    if (!enabled() || !A) return null;
    if (A.get(aid)) return A.runtime(aid);
    var info = {}, listeners = new Set(), loading, revision, timer, hasHistory = false;
    var session = { id: id, title: "DeepSeek Harness", turns: [], todo: {items: []} };
    var agent = {id: aid, current: id, name: session.title, connector: "dsh", claude: true, access: "rw"};
    function ready() {
      var oldBalance = balanceLabel;
      balance().then(() => { if (balanceLabel !== oldBalance) listeners.forEach(fn => fn("status")); });
      if (!loading) loading = (async function () {
        if (!scanned || Date.now() - scanned > 30000) await refresh();
        info = sessions.find(function (s) { return s.id === id; }) || {};
        session.title = agent.name = info.title || id;
        var stat = info.path && await TSU_LOCAL.stat(info.path);
        var current = stat ? stat.size + ":" + stat.mtime : info.updated;
        if (stat && hasHistory && revision === current) {
          if (rt.state() === "working") listeners.forEach(function (fn) { fn("status"); });
          return;
        }
        var history = await read(id);
        if (!Array.isArray(history.turns)) throw new Error("无效的 DSH 会话记录");
        session.turns = history.turns;
        hasHistory = true;
        session.effort = agent.effort = info.selection?.reasoningEffort || history.effort;
        session.progress = history.progress;
        revision = current;
        listeners.forEach(function (fn) { fn("reset"); });
      })().catch(function (e) {
        if (!hasHistory && session.turns[0]?.note !== e.message) {
          session.turns = [{note: e.message}];
          listeners.forEach(fn => fn("reset"));
        }
      }).finally(function () {
        loading = null;
      });
      return loading;
    }
    var sending = false;
    async function send(text, images) {
      if (!enabled()) throw new Error("DSH 连接器未启用");
      if (images && images.length) throw new Error("DSH 文本发送暂不支持图片");
      if (sending) throw new Error("请等待当前 DSH 消息处理完成");
      sending = true;
      try {
        await ready();
        if (!info.cwd) throw new Error("找不到 DSH 会话工作目录");
        function deliver(argv) { return new Promise(function (resolve, reject) {
          var diagnostic = "";
          var proc = TSU_LOCAL.proc({argv: argv, cwd: info.cwd}, function (chunk, stderr) {
            if (stderr) diagnostic = (diagnostic + chunk).slice(-1500);
          }, function (code, reason) {
            if (!code) resolve();
            else reject(new Error(reason || diagnostic.trim() || "DSH 退出码 " + code));
          });
          proc.write(text).then(function () { return proc.close(); }).catch(reject);
        }); }
        var requestKey = "dsh-send:" + id;
        var previous = JSON.parse(sessionStorage.getItem(requestKey) || "null");
        var requestId = previous && previous.text === text ? previous.id : crypto.randomUUID();
        sessionStorage.setItem(requestKey, JSON.stringify({id: requestId, text: text}));
        await deliver(["python3", TSU_UI_LOCAL.dir + "/studio/dsh_send.py", id, requestId]);
        sessionStorage.removeItem(requestKey);
      } finally {
        sending = false;
        await ready();
      }
    }
    var catalog, selection;
    async function settings(args) {
      var argv = ["python3", TSU_UI_LOCAL.dir + "/studio/dsh_send.py"].concat(args);
      var result = await TSU_LOCAL.exec({cmd: argv.map(arg => "'" + arg.replace(/'/g, "'\\''") + "'").join(" ")});
      if (result.code) throw new Error(result.err.trim() || "DSH 设置失败");
      return JSON.parse(result.out);
    }
    function routes() {
      return (catalog?.groups || []).flatMap(group => group.models.map(m => ({
        id: JSON.stringify([group.id, m.id]), name: m.name, desc: group.name, reasoning: m.reasoning
      })));
    }
    function currentRoute() {
      var current = selection || info.selection || {};
      return routes().find(m => m.id === JSON.stringify([current.provider, current.model]));
    }
    async function select(routeId, effort) {
      var [provider, model] = JSON.parse(routeId);
      var result = await settings(["--select-model", JSON.stringify({sessionId: id, provider, model, reasoningEffort: effort})]);
      selection = result.selected;
      agent.effort = session.effort = selection.reasoningEffort || "";
      listeners.forEach(fn => fn("config"));
    }
    function no() { return false; }
    function cwd() { return info.cwd || ""; }
    var rt = { agent: agent, sid: id, label: "DeepSeek Harness", readOnly: false, hideInputHint: true, tasks: [], stream: null,
      session: function () { return session; }, ready: ready,
      on: function (fn) { listeners.add(fn); ready();
        if (!timer) timer = setInterval(ready, 2500);
        return function () { listeners.delete(fn); if (!listeners.size) { clearInterval(timer); timer = null; } }; },
      statGroups: function () {
        var p = session.progress || {}, s = p.stats || {}, u = p.usage || {}, c = p.pressure || {}, b = p.breakdown || {};
        var compact = n => new Intl.NumberFormat("en", {notation:"compact", maximumFractionDigits:1}).format(n);
        var tokens = n => n == null ? "—" : n.toLocaleString("en") + " tok";
        var approximate = n => n == null ? "—" : "~" + compact(n);
        var time = ms => ms == null ? "—" : (ms >= 60000 ? Math.floor(ms/60000) + "分 " : "") + Math.floor(ms/1000)%60 + "秒";
        var n = (u.uncachedInputTokens || 0) + (u.cacheReadTokens || 0) + (u.cacheWriteTokens || 0);
        var total = n + (u.outputTokens || 0), speed = s.decodeMs ? Math.round(s.decodeTokens*1000/s.decodeMs) + " tok/s" : "—";
        var hit = n ? Math.round(100*u.cacheReadTokens/n) + "%" : "—";
        var percent = c.contextWindow && c.pressureTokens != null ? Math.round(100*c.pressureTokens/c.contextWindow) + "%" : "—";
        var counts = (s.turns ?? p.turn) + " 轮 " + (s.steps ?? p.steps) + " 步";
        return [
          {label:counts + " · " + speed, title:"会话统计", value:counts, rows:[["模型用时",time(s.llmMs)],["工具调用用时",time(s.toolMs)],["首 token 平均（TTFT）",s.ttftSteps ? (s.ttftMs/s.ttftSteps/1000).toFixed(1)+"秒" : "—"],["输出速度（TPS）",speed]]},
          {label:compact(total)+" tok · 缓存命中 "+hit, title:"Token 用量", value:tokens(total), rows:[["缓存命中",hit],["未缓存输入",tokens(u.uncachedInputTokens)],["缓存读取",tokens(u.cacheReadTokens)],...(u.cacheWriteTokens ? [["缓存写入",tokens(u.cacheWriteTokens)]] : []),["输出",tokens(u.outputTokens)]]},
          {label:percent, title:"上下文已用 "+percent, value:approximate(c.pressureTokens)+" / "+(c.contextWindow ? compact(c.contextWindow) : "—"), rows:[["系统提示词",approximate(b.systemTokens)],["工具定义",approximate(b.toolsTokens)],["对话消息",approximate(b.messageTokens)]]}
        ];
      },
      showStat: function (button, index) {
        var existing = document.querySelector(".dsh-stat-detail");
        var key = id + ":" + index;
        if (existing) { var same = existing.dataset.key === key; existing.remove(); if (same) return; }
        var group = rt.statGroups()[index], box = document.createElement("div");
        box.className = "dsh-stat-detail"; box.dataset.key = key; box.popover = "manual";
        [[group.title,group.value], ...group.rows].forEach(function (row) {
          var line = box.appendChild(document.createElement("div"));
          row.forEach(function (v) { line.appendChild(document.createElement("span")).textContent = v; });
        });
        var pane = button.closest(".tpane");
        box.classList.toggle("is-light", !!pane && pane.classList.contains("tl"));
        box.style.fontFamily = getComputedStyle(button).fontFamily;
        document.body.appendChild(box); box.showPopover();
        var rect = button.getBoundingClientRect();
        box.style.left = Math.max(4,Math.min(rect.left,innerWidth-box.offsetWidth-4))+"px";
        box.style.top = Math.max(4,rect.top-box.offsetHeight-6)+"px";
        var abort = new AbortController();
        function close() { box.remove(); abort.abort(); }
        document.addEventListener("pointerdown", function (e) {
          if (!box.contains(e.target) && !e.target.closest("[data-dsh-stat]")) close();
        }, {capture:true,signal:abort.signal});
        document.addEventListener("keydown", function(e){ if(e.key==="Escape") close(); },{signal:abort.signal});
        box.addEventListener("toggle",function(){ if(!box.isConnected || !box.matches(":popover-open")) abort.abort(); });
      },
      showDetailedStats: false,
      statusText: function () {
        var p = session.progress;
        if (!p || !p.turn) return "";
        var states = {running: "进行中", completed: "已完成", cancelled: "已取消", interrupted: "已中断", failed: "失败"};
        if (!rt.showDetailedStats && (p.phase === "completed" || p.phase === "running")) return "";
        if (!rt.showDetailedStats) return states[p.phase] || p.phase || "";
        var stats = p.stats || {}, usage = p.usage || {}, pressure = p.pressure || {};
        var fields = [(stats.turns ?? p.turn) + " 轮 " + (stats.steps ?? p.steps) + " 步"];
        if (stats.decodeMs > 0) fields.push(Math.round(stats.decodeTokens * 1000 / stats.decodeMs) + " tok/s");
        var input = (usage.uncachedInputTokens || 0) + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0);
        var total = input + (usage.outputTokens || 0);
        if (total) fields.push(new Intl.NumberFormat("en", {notation: "compact", maximumFractionDigits: 1}).format(total) + " tok");
        if (input && usage.cacheReadTokens != null) fields.push("缓存命中 " + Math.round(100 * usage.cacheReadTokens / input) + "%");
        if (pressure.contextWindow > 0 && pressure.pressureTokens != null) fields.push(Math.round(100 * pressure.pressureTokens / pressure.contextWindow) + "%");
        fields.push(states[p.phase] || p.phase);
        return fields.join(" · ");
      },
      footerFields: function () {
        var pressure = session.progress && session.progress.pressure;
        var fields = [rt.model().name, agent.effort].filter(Boolean);
        if (balanceLabel && (selection || info.selection)?.provider === "deepseek-account") fields.unshift("remained " + balanceLabel);
        if (!rt.showDetailedStats && pressure && pressure.contextWindow > 0 && pressure.pressureTokens != null)
          fields.unshift("Context " + Math.round(100 * pressure.pressureTokens / pressure.contextWindow) + "% Used");
        return fields;
      },
      prepareChoices: async function () { catalog = await settings(["--catalog"]); },
      models: routes, efforts: function () { return (currentRoute()?.reasoning?.efforts || []).map(e => e.id); },
      model: function () { return currentRoute() || {id: "", name: info.model || "DSH"}; },
      state: function () { return session.progress && session.progress.phase === "running" ? "working" : "idle"; }, home: cwd, cwd: cwd, ctx: function () { var tokens = session.progress?.pressure?.pressureTokens || 0, window = session.progress?.pressure?.contextWindow || 0; return {tokens, window, pct:window ? tokens/window*100 : 0}; },
      todo: function () { return []; }, pendingMsgs: function () { return 0; }, cost: function () { return 0; }, tail: function () { return ""; },
      more: no, historical: no, send: send, sendNow: send, canInject: no, interrupt: no, canInterrupt: no, canSendNow: no,
      takeQueued: no, detachBash: no, canCycle: no, afterReload: ready, maybeRecap: no, record: no, setGoal: no, clearGoal: no, clear: no,
      bang: no, wakeUp: no, setAccess: no, setEffort: level => select(currentRoute().id, level), setModel: route => select(route), resume: no, recap: no };
    A.registerExternal(aid, rt);
    return rt;
  }
  async function create(workspaceId) {
    var args = ["python3", TSU_UI_LOCAL.dir + "/studio/dsh_send.py", "--create", workspaceId || ""];
    var result = await TSU_LOCAL.exec({cmd: args.map(arg => "'" + arg.replace(/'/g, "'\\''") + "'").join(" ")});
    if (result.code) throw new Error(result.err.trim() || "创建 DSH 会话失败");
    var id = result.out.trim().split("\n").pop();
    if (!/^session-[a-f0-9-]{36}$/i.test(id)) throw new Error("DSH 未返回会话编号");
    await refresh();
    await ensure(id).ready();
    return id;
  }
  if (window.nadosNative?.local && !nadosNative.remote) {
    try {
      var cache = JSON.parse(localStorage.getItem("tsu-sidebar-dsh-v1"));
      if (Array.isArray(cache?.sessions) && Array.isArray(cache.workspaces)) {
        sessions = cache.sessions; workspaces = cache.workspaces;
      }
    } catch (_) {}
    setTimeout(function () { if (enabled() && !scanned) refresh(); }, 0);
  }
  window.TSU_DSH = { create: create, enabled: enabled, ensure: ensure, refresh: refresh,
    workspaces: function () { return workspaces; },
    list: function () { if (Date.now() - scanned > 30000) refresh(); return sessions.filter(s => !s.emptyDraft); },
    status: function () { return error || (pending ? "正在读取会话…" : "没有会话"); } };
})();
