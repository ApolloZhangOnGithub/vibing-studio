// eco.js —— 这台电脑上 Claude Code、pi、Codex 各自装了什么——钩子、MCP 服务器、插件、技能、子 Agent、斜杠命令、pi 的包和扩展……
//   画在各自连接器的设置页里（设置 › 连接器 › Claude Code 那一页下面；用户 2026-10-14：不要单独一个 App，各自放在连接器里）：TSU_ECO.mount。
//   能在这里开关的（Claude Code 的插件、停用所有钩子）直接开关，写回它自己的设置文件；别的点一下在编辑器里打开它所在的文件、跳到那一行
//   （改的就是它自己的文件，Vibing Studio 不另存一份）。MCP 服务器连不连得上：点「检查连接」（claude mcp list，它自己去连一遍）。
//   环境变量、令牌的值一律不显示（只写有几个）
(function () {
  "use strict";
  var S = window.STUDIO;
  if (!S || !S.pages || !S.openPage) return;
  var I18N = window.TSU_I18N;
  var t = function (zh, en) { return I18N && I18N.lang && I18N.lang() === "en" ? en : zh; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var LOC = function () { return window.TSU_LOCAL; };
  var N = window.nadosNative;
  var LOGO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 3.5h5v3a1.6 1.6 0 1 0 3.2 0v-3H20.5v6h-3a1.6 1.6 0 1 0 0 3.2h3v7.8h-6.2v-3a1.6 1.6 0 1 0-3.2 0v3H3.5v-6h3a1.6 1.6 0 1 0 0-3.2h-3V3.5h6z"/></svg>';
  var IC = {
    open: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2.5h4v4M13.5 2.5L7.8 8.2M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3"/></svg>',
    chev: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>',
    reload: '<svg viewBox="0 0 16 16"><path d="M12.5 7.5A4.5 4.5 0 1 1 11 4.3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M11.5 2v2.8H8.7" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  var home = function () { var i = LOC() && LOC().info && LOC().info(); return (i && i.home) || ""; };
  var tilde = function (p) { var h = home(); p = String(p || ""); return h && p.indexOf(h + "/") === 0 ? "~" + p.slice(h.length) : p; };
  var text = function (path, max) { return LOC().read(path, { max: max || 4000000 }).then(function (b) { return new TextDecoder().decode(new Uint8Array(b)); }, function () { return null; }); };
  var json = function (path) { return text(path).then(function (s) { if (s == null) return { path: path, text: null, json: null }; try { return { path: path, text: s, json: JSON.parse(s) }; } catch (e) { return { path: path, text: s, json: null, bad: String(e.message || e) }; } }); };
  var list = function (dir) { return LOC().list(dir).then(function (l) { return l || []; }, function () { return []; }); };
  // 一个键在文件里的第几行（编辑器里跳过去）：找它第一次出现的地方
  var lineOf = function (s, needle, from) { if (!s) return 0; var i = s.indexOf(needle, from ? s.indexOf(from) : 0); if (i < 0) i = s.indexOf(needle); return i < 0 ? 0 : s.slice(0, i).split("\n").length; };
  // Markdown 文件开头的 --- name / description --- （技能、子 Agent、命令）
  var front = function (s) {
    var o = {}, m = /^---\s*\n([\s\S]*?)\n---/.exec(String(s || ""));
    if (m) m[1].split("\n").forEach(function (l) { var k = /^([A-Za-z_-]+):\s*(.*)$/.exec(l); if (k) o[k[1].toLowerCase()] = k[2].replace(/^["']|["']$/g, "").trim(); });
    if (!o.description) { var body = String(s || "").replace(/^---[\s\S]*?\n---\s*/, "").split("\n").filter(function (l) { return l.trim() && !/^#/.test(l.trim()); })[0]; if (body) o.description = body.trim().slice(0, 200); }
    return o;
  };
  var mdItems = function (dir, src, nested) { // 一个目录里的 *.md（子 Agent、命令），或者一个个目录里的 SKILL.md（技能）
    return list(dir).then(function (l) {
      var ps = l.filter(function (x) { return nested ? x.dir : !x.dir && /\.md$/i.test(x.name); }).slice(0, 200).map(function (x) {
        var f = dir + "/" + x.name + (nested ? "/SKILL.md" : "");
        return text(f, 6000).then(function (s) { if (s == null) return null; var fm = front(s); return { name: fm.name || x.name.replace(/\.md$/i, ""), desc: fm.description || "", file: f, src: src }; });
      });
      return Promise.all(ps).then(function (r) { return r.filter(Boolean); });
    });
  };

  // ---- 读：Claude Code ----
  function loadCC() {
    var H = home(), C = H + "/.claude";
    return Promise.all([json(C + "/settings.json"), json(C + "/settings.local.json"), json(H + "/.claude.json"), json(C + "/plugins/installed_plugins.json")]).then(function (r) {
      var st = r[0], loc = r[1], cj = r[2], ip = r[3], out = { settings: st, local: loc, hooks: [], mcp: [], plugins: [], skills: [], agents: [], commands: [], bad: [] };
      [st, loc].forEach(function (f) { if (f.bad) out.bad.push(tilde(f.path) + "：" + f.bad); });
      out.disableAll = !!(st.json && st.json.disableAllHooks) || !!(loc.json && loc.json.disableAllHooks);
      var addHooks = function (hk, src, f) {
        if (!hk || typeof hk !== "object") return;
        Object.keys(hk).forEach(function (ev) {
          (Array.isArray(hk[ev]) ? hk[ev] : []).forEach(function (g) {
            (g && Array.isArray(g.hooks) ? g.hooks : []).forEach(function (h) {
              out.hooks.push({ event: ev, matcher: g.matcher || "", type: h.type || "command", command: h.command || h.prompt || "", timeout: h.timeout || 0, status: h.statusMessage || "", src: src, file: f.path, line: lineOf(f.text, h.command ? JSON.stringify(h.command).slice(0, 40) : '"' + ev + '"', '"hooks"') });
            });
          });
        });
      };
      if (st.json) addHooks(st.json.hooks, t("用户", "User"), st);
      if (loc.json) addHooks(loc.json.hooks, t("用户（本机）", "User (local)"), loc);
      var addMcp = function (m, scope, f, sub) {
        if (!m || typeof m !== "object") return;
        Object.keys(m).forEach(function (nm) { var x = m[nm] || {}; out.mcp.push({ name: nm, scope: scope, type: x.type || (x.url ? "http" : "stdio"), cmd: x.url || [x.command].concat(x.args || []).filter(Boolean).join(" "), envN: x.env ? Object.keys(x.env).length : 0, hdrN: x.headers ? Object.keys(x.headers).length : 0, file: f.path, line: lineOf(f.text, '"' + nm + '"', sub || '"mcpServers"') }); });
      };
      if (cj.json) {
        addMcp(cj.json.mcpServers, t("用户", "User"), cj);
        var pr = cj.json.projects || {};
        Object.keys(pr).forEach(function (p) { if (pr[p] && pr[p].mcpServers && Object.keys(pr[p].mcpServers).length) addMcp(pr[p].mcpServers, tilde(p), cj, JSON.stringify(p)); });
      }
      // 插件：装了哪些（installed_plugins.json）、开没开（settings.json 的 enabledPlugins；没写的算开着）；每个插件自己带的钩子、MCP、技能、子 Agent、命令
      var en = (st.json && st.json.enabledPlugins) || {}, plugs = (ip.json && ip.json.plugins) || {};
      var tasks = Object.keys(plugs).map(function (id) {
        var e = (Array.isArray(plugs[id]) ? plugs[id] : [plugs[id]])[0] || {}, at = id.lastIndexOf("@"), pth = e.installPath || "";
        var pl = { id: id, name: at > 0 ? id.slice(0, at) : id, market: at > 0 ? id.slice(at + 1) : "", version: e.version || "", scope: e.scope || "", at: e.installedAt || "", path: pth, enabled: en[id] !== false, desc: "" };
        out.plugins.push(pl);
        if (!pth) return null;
        var src = t("插件 ", "Plugin ") + pl.name;
        return Promise.all([json(pth + "/.claude-plugin/plugin.json"), json(pth + "/hooks/hooks.json"), json(pth + "/.mcp.json"), mdItems(pth + "/skills", src, true), mdItems(pth + "/agents", src), mdItems(pth + "/commands", src)]).then(function (q) {
          if (q[0].json) pl.desc = q[0].json.description || "";
          if (q[1].json) addHooks(q[1].json.hooks || q[1].json, src, q[1]);
          if (q[2].json) addMcp(q[2].json.mcpServers || q[2].json, src, q[2]);
          out.skills = out.skills.concat(q[3]); out.agents = out.agents.concat(q[4]); out.commands = out.commands.concat(q[5]);
        });
      }).filter(Boolean);
      tasks.push(mdItems(C + "/skills", t("用户", "User"), true).then(function (x) { out.skills = x.concat(out.skills); }));
      tasks.push(mdItems(C + "/agents", t("用户", "User")).then(function (x) { out.agents = x.concat(out.agents); }));
      tasks.push(mdItems(C + "/commands", t("用户", "User")).then(function (x) { out.commands = x.concat(out.commands); }));
      return Promise.all(tasks).then(function () { out.found = !!(st.text || cj.text || ip.text); return out; });
    });
  }
  // ---- 读：pi（~/.pi/agent）----
  function loadPI() {
    var A = home() + "/.pi/agent";
    return Promise.all([json(A + "/settings.json"), list(A + "/extensions"), mdItems(A + "/skills", t("用户", "User"), true), list(A + "/prompts")]).then(function (r) {
      var st = r[0], pk = st.json && Array.isArray(st.json.packages) ? st.json.packages : [];
      return { found: !!st.text, settings: st,
        packages: pk.map(function (p) { var s0 = typeof p === "string" ? p : p && (p.source || p.name) || ""; return { name: s0, file: st.path, line: lineOf(st.text, JSON.stringify(s0)) }; }),
        extensions: r[1].filter(function (x) { return x.dir || /\.(ts|js|mjs)$/.test(x.name); }).map(function (x) { return { name: x.name.replace(/\.(ts|js|mjs)$/, ""), file: A + "/extensions/" + x.name + (x.dir ? "/index.ts" : ""), dir: x.dir }; }),
        skills: r[2], prompts: r[3].filter(function (x) { return /\.md$/i.test(x.name); }).map(function (x) { return { name: x.name.replace(/\.md$/i, ""), file: A + "/prompts/" + x.name }; }) };
    });
  }
  // ---- 读：Codex（~/.codex/config.toml：只认 [plugins."…"] 和 [mcp_servers.…] 这几段）----
  function loadCX() {
    var f = home() + "/.codex/config.toml";
    return text(f).then(function (s) {
      var out = { found: s != null, file: f, plugins: [], mcp: [] };
      if (!s) return out;
      var cur = null, lines = s.split("\n");
      lines.forEach(function (l, i) {
        var h = /^\s*\[([^\]]+)\]\s*$/.exec(l);
        if (h) {
          var k = h[1].trim(), pm = /^plugins\."?([^"]+)"?$/.exec(k), mm = /^mcp_servers\."?([^".]+)"?$/.exec(k);
          cur = pm ? { kind: "plugin", o: { id: pm[1], enabled: true, line: i + 1 } } : mm ? { kind: "mcp", o: { name: mm[1], cmd: "", line: i + 1, envN: 0 } } : null;
          if (cur) (cur.kind === "plugin" ? out.plugins : out.mcp).push(cur.o);
          return;
        }
        if (!cur) return;
        var kv = /^\s*([A-Za-z_]+)\s*=\s*(.+?)\s*$/.exec(l);
        if (!kv) return;
        if (cur.kind === "plugin" && kv[1] === "enabled") cur.o.enabled = kv[2] !== "false";
        if (cur.kind === "mcp" && (kv[1] === "command" || kv[1] === "url")) cur.o.cmd = kv[2].replace(/^"|"$/g, "") + (cur.o.cmd ? " " + cur.o.cmd : "");
        if (cur.kind === "mcp" && kv[1] === "args") cur.o.cmd = (cur.o.cmd ? cur.o.cmd + " " : "") + kv[2].replace(/^\[|\]$/g, "").replace(/"/g, "").replace(/,\s*/g, " ");
      });
      return out;
    });
  }

  // ---- 写：Claude Code 的设置（settings.json；原来的缩进两格，照写）----
  function editSettings(fn) {
    var p = home() + "/.claude/settings.json";
    return json(p).then(function (f) {
      if (f.text != null && !f.json) throw new Error(t("settings.json 不是合法的 JSON，没有改动", "settings.json isn’t valid JSON; nothing was changed"));
      var o = f.json || {};
      fn(o);
      return LOC().write(p, JSON.stringify(o, null, 2) + "\n");
    });
  }

  // ---- 页面 ----
  var state = { tab: "", data: {}, busy: false, mcpSt: null, mcpBusy: false, open: {}, err: "" };
  var views = [];
  function reload() {
    if (!LOC() || state.busy) return Promise.resolve();
    state.busy = true; paintAll();
    return Promise.all([loadCC(), loadPI(), loadCX()]).then(function (r) {
      state.data = { cc: r[0], pi: r[1], cx: r[2] };
      if (!state.tab || !state.data[state.tab] || !state.data[state.tab].found) state.tab = ["cc", "pi", "cx"].filter(function (k) { return state.data[k].found; })[0] || "cc";
    }, function (e) { state.err = String((e && e.message) || e); }).then(function () { state.busy = false; paintAll(); });
  }
  var mounts = [];
  function paintAll() {
    views = views.filter(function (V) { return V.host && V.host.isConnected; }); views.forEach(function (V) { paint(V); });
    mounts = mounts.filter(function (M) { return M.host && M.host.isConnected; }); mounts.forEach(function (M) { paintMount(M); });
  }
  var chip = function (s, cls) { return s ? '<span class="eco-chip' + (cls ? " " + cls : "") + '">' + esc(s) + "</span>" : ""; };
  var openBtn = function (file, line) { return file ? '<button type="button" class="eco-ib" data-open="' + esc(file) + '" data-line="' + (line || 0) + '" title="' + esc(t("在编辑器中打开 ", "Open in Editor: ") + tilde(file)) + '">' + IC.open + "</button>" : ""; };
  var sw = function (on, act, id, title) { return '<button type="button" class="eco-sw' + (on ? " on" : "") + '" role="switch" aria-checked="' + on + '" data-act="' + act + '" data-id="' + esc(id) + '" title="' + esc(title || "") + '"></button>'; };
  function section(key, title, n, body, extra) {
    var shut = !!state.open["x:" + key];
    return '<section class="eco-sec' + (shut ? " shut" : "") + '"><header data-fold="' + esc(key) + '"><i class="eco-chev">' + IC.chev + "</i><h3>" + esc(title) + "</h3><em>" + n + "</em><span class=\"eco-fill\"></span>" + (extra || "") + "</header>" +
      (shut ? "" : n ? '<div class="eco-rows">' + body + "</div>" : '<div class="eco-none">' + esc(t("没有", "None")) + "</div>") + "</section>";
  }
  function ccHtml(d) {
    var hooks = d.hooks.map(function (h) {
      return '<div class="eco-row">' + chip(h.event, "ev") + (h.matcher ? chip(h.matcher, "mt") : "") + '<code class="eco-cmd" title="' + esc(h.command) + '">' + esc(h.command) + "</code>" + (h.timeout ? chip(h.timeout + "s") : "") + chip(h.src, "src") + openBtn(h.file, h.line) + "</div>";
    }).join("");
    var stat = function (nm) { var s0 = state.mcpSt && state.mcpSt[nm]; return s0 ? '<i class="eco-dot ' + (s0.ok ? "ok" : "bad") + '" title="' + esc(s0.text) + '"></i>' : ""; };
    var mcp = d.mcp.map(function (m) {
      return '<div class="eco-row">' + stat(m.name) + '<b class="eco-nm">' + esc(m.name) + "</b>" + chip(m.type) + '<code class="eco-cmd" title="' + esc(m.cmd) + '">' + esc(m.cmd) + "</code>" +
        (m.envN ? chip(t(m.envN + " 个环境变量", m.envN + " env vars")) : "") + (m.hdrN ? chip(t(m.hdrN + " 个请求头", m.hdrN + " headers")) : "") + chip(m.scope, "src") + openBtn(m.file, m.line) + "</div>";
    }).join("");
    var plugs = d.plugins.map(function (p) {
      return '<div class="eco-row' + (p.enabled ? "" : " off") + '"><b class="eco-nm">' + esc(p.name) + "</b>" + (p.market ? chip(p.market, "src") : "") + (p.version ? chip(p.version) : "") + '<span class="eco-desc">' + esc(p.desc) + "</span>" +
        sw(p.enabled, "plugin", p.id, p.enabled ? t("停用这个插件", "Disable this plugin") : t("启用这个插件", "Enable this plugin")) + openBtn(p.path ? p.path + "/.claude-plugin/plugin.json" : "", 0) + "</div>";
    }).join("");
    var md = function (l) { return l.map(function (x) { return '<div class="eco-row"><b class="eco-nm">' + esc(x.name) + '</b><span class="eco-desc">' + esc(x.desc) + "</span>" + chip(x.src, "src") + openBtn(x.file, 0) + "</div>"; }).join(""); };
    var mcpBtn = '<button type="button" class="eco-btn" data-act="mcpcheck"' + (state.mcpBusy ? " disabled" : "") + ">" + esc(state.mcpBusy ? t("正在检查…", "Checking…") : t("检查连接", "Check Connections")) + "</button>";
    var hookSw = '<label class="eco-lab">' + esc(t("启用", "Enabled")) + sw(!d.disableAll, "allhooks", "", d.disableAll ? t("重新启用所有钩子", "Re-enable all hooks") : t("停用所有钩子（disableAllHooks）", "Disable all hooks (disableAllHooks)")) + "</label>";
    var setBtn = '<button type="button" class="eco-btn" data-open="' + esc(d.settings.path) + '" data-line="0">' + esc(t("打开 settings.json", "Open settings.json")) + "</button>";
    return (d.bad.length ? '<div class="eco-warn">' + esc(d.bad.join("；")) + "</div>" : "") +
      section("cc-hooks", t("钩子", "Hooks"), d.hooks.length, hooks, hookSw + setBtn) +
      section("cc-mcp", t("MCP 服务器", "MCP Servers"), d.mcp.length, mcp, mcpBtn) +
      section("cc-plugins", t("插件", "Plugins"), d.plugins.length, plugs) +
      section("cc-skills", t("技能", "Skills"), d.skills.length, md(d.skills)) +
      section("cc-agents", t("子 Agent", "Subagents"), d.agents.length, md(d.agents)) +
      section("cc-commands", t("斜杠命令", "Slash Commands"), d.commands.length, md(d.commands));
  }
  function piHtml(d) {
    var rows = function (l) { return l.map(function (x) { return '<div class="eco-row"><b class="eco-nm">' + esc(x.name) + "</b>" + (x.desc ? '<span class="eco-desc">' + esc(x.desc) + "</span>" : '<span class="eco-fill"></span>') + openBtn(x.file, x.line || 0) + "</div>"; }).join(""); };
    return section("pi-packages", t("包", "Packages"), d.packages.length, rows(d.packages), '<button type="button" class="eco-btn" data-open="' + esc(d.settings.path) + '" data-line="0">' + esc(t("打开 settings.json", "Open settings.json")) + "</button>") +
      section("pi-ext", t("扩展", "Extensions"), d.extensions.length, rows(d.extensions)) +
      section("pi-skills", t("技能", "Skills"), d.skills.length, rows(d.skills)) +
      section("pi-prompts", t("提示词模板", "Prompt Templates"), d.prompts.length, rows(d.prompts));
  }
  function cxHtml(d) {
    var pl = d.plugins.map(function (p) { return '<div class="eco-row' + (p.enabled ? "" : " off") + '"><b class="eco-nm">' + esc(p.id.replace(/@.*$/, "")) + "</b>" + chip(p.id.replace(/^[^@]*@?/, ""), "src") + chip(p.enabled ? t("已启用", "Enabled") : t("已停用", "Disabled"), p.enabled ? "on" : "") + openBtn(d.file, p.line) + "</div>"; }).join("");
    var mc = d.mcp.map(function (m) { return '<div class="eco-row"><b class="eco-nm">' + esc(m.name) + '</b><code class="eco-cmd">' + esc(m.cmd) + "</code>" + openBtn(d.file, m.line) + "</div>"; }).join("");
    return section("cx-plugins", t("插件", "Plugins"), d.plugins.length, pl, '<button type="button" class="eco-btn" data-open="' + esc(d.file) + '" data-line="0">' + esc(t("打开 config.toml", "Open config.toml")) + "</button>") +
      section("cx-mcp", t("MCP 服务器", "MCP Servers"), d.mcp.length, mc);
  }
  var TABS = [["cc", "Claude Code"], ["pi", "pi"], ["cx", "Codex"]];
  function paint(V) {
    var d = state.data, tab = state.tab || "cc", cur = d[tab];
    var tabs = TABS.filter(function (x) { return d[x[0]] && d[x[0]].found; }).map(function (x) { return '<button type="button" class="eco-tab' + (x[0] === tab ? " on" : "") + '" data-tab="' + x[0] + '">' + esc(x[1]) + "</button>"; }).join("");
    var body = !LOC() ? '<div class="eco-empty">' + esc(t("要在 App 里用（读这台电脑上的配置）", "Available in the app (it reads this computer’s configuration)")) + "</div>" :
      !cur ? '<div class="eco-empty">' + esc(state.busy ? t("正在读…", "Loading…") : t("这台电脑上没有找到 Claude Code、pi、Codex 的配置", "No Claude Code, pi or Codex configuration found on this computer")) + "</div>" :
      tab === "cc" ? ccHtml(cur) : tab === "pi" ? piHtml(cur) : cxHtml(cur);
    var html = '<div class="eco"><div class="eco-head"><h1>' + esc(t("Agent 扩展", "Agent Extensions")) + '</h1><div class="eco-tabs">' + tabs + '</div><span class="eco-fill"></span>' +
      (state.err ? '<span class="eco-err">' + esc(state.err) + "</span>" : "") + '<button type="button" class="eco-ib" data-act="reload" title="' + esc(t("重新读取", "Reload")) + '">' + IC.reload + "</button></div>" +
      body + "</div>";
    if (V.host.dataset.h !== html) { V.host.dataset.h = html; V.host.innerHTML = html; }
  }
  // 连接器设置页里那一块：只画这一个连接器的（cc / pi / cx）
  function paintMount(M) {
    var d = state.data[M.kind];
    var body = !LOC() ? "" : !d ? '<div class="eco-empty">' + esc(state.busy ? t("正在读…", "Loading…") : t("没有找到它的配置", "No configuration found")) + "</div>" :
      M.kind === "cc" ? ccHtml(d) : M.kind === "pi" ? piHtml(d) : cxHtml(d);
    var html = '<div class="eco eco-embed">' + (state.err ? '<div class="eco-err">' + esc(state.err) + "</div>" : "") + body + "</div>";
    if (M.host.dataset.h !== html) { M.host.dataset.h = html; M.host.innerHTML = html; }
  }
  function mount(el, kind, win) {
    var M = { host: el, kind: kind };
    wire(M, { win: win });
    mounts.push(M);
    if (!state.data.cc && !state.busy) reload();
    paintMount(M);
  }
  function checkMcp() {
    if (!LOC() || state.mcpBusy) return;
    state.mcpBusy = true; paintAll();
    LOC().exec({ cmd: "claude mcp list 2>&1" }).then(function (r) {
      var st = {};
      String((r && r.out) || "").split("\n").forEach(function (l) { var m = /^([^:]+):\s.*\s-\s(.*)$/.exec(l.trim()); if (m) st[m[1].trim()] = { ok: /✓|Connected/i.test(m[2]), text: m[2].trim() }; });
      state.mcpSt = st;
    }, function (e) { state.err = String((e && e.message) || e); }).then(function () { state.mcpBusy = false; paintAll(); });
  }
  function wire(V, P) {
    V.host.addEventListener("click", function (e) {
      var o = e.target.closest("[data-open]");
      if (o) { if (S.openFile) S.openFile(P.win, o.dataset.open, +o.dataset.line ? { line: +o.dataset.line } : undefined); return; }
      var tb = e.target.closest("[data-tab]");
      if (tb) { state.tab = tb.dataset.tab; paintAll(); return; }
      var f = e.target.closest("[data-fold]");
      if (f && !e.target.closest("button, label")) { var k = "x:" + f.dataset.fold; state.open[k] = !state.open[k]; paintAll(); return; }
      var b = e.target.closest("[data-act]");
      if (!b) return;
      var a = b.dataset.act;
      if (a === "reload") return reload();
      if (a === "mcpcheck") return checkMcp();
      if (a === "plugin") { var id = b.dataset.id, on = b.classList.contains("on"); return editSettings(function (s0) { s0.enabledPlugins = s0.enabledPlugins || {}; s0.enabledPlugins[id] = !on; }).then(reload, fail); }
      if (a === "allhooks") { var dis = b.classList.contains("on"); return editSettings(function (s0) { if (dis) s0.disableAllHooks = true; else delete s0.disableAllHooks; }).then(reload, fail); }
    });
  }
  var fail = function (e) { if (window.TSU_DESK && TSU_DESK.alert) TSU_DESK.alert({ title: t("没能改", "Couldn’t Change It"), message: String((e && e.message) || e), icon: "caution" }); else window.alert(String((e && e.message) || e)); };

  S.pages.eco = {
    title: function () { return t("Agent 扩展", "Agent Extensions"); },
    address: function () { return "extensions.local.paimon"; },
    icon: function () { return LOGO; },
    render: function (host, P, arg, V) {
      host.classList.add("st-pg-eco");
      V.host = host;
      if (!V.inited) { V.inited = true; views.push(V); wire(V, P); if (!state.data.cc && !state.busy) reload(); }
      paint(V);
    },
  };
  window.TSU_ECO = { reload: reload, state: function () { return state; }, mount: mount };
  if (S.embed) S.embed("eco", function (el, kind, win) { mount(el, kind || "cc", win); });
})();
