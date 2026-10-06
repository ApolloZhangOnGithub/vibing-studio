// sys-cmds.js —— 桌面的系统命令：apps、windows、spaces、notifications、defaults、open、pbcopy / pbpaste、menubar（登记进 sys.js）
// 截屏和辅助功能（screencapture、ax）在 sys-ax.js
(function () {
  "use strict";
  var S = window.TSU_SYS;
  if (!S) return;
  var U = S._, err = U.err, usage = U.usage, DK = U.DK, AG = U.AG, IOS = U.IOS, two = U.two, json = U.json;
  var getopt = S.getopt, table = S.table, clip = S.clip;
  function D() { var d = DK(); if (!d || !d.apps) throw err("the desktop isn't ready yet"); return d; }
  var stamp = function (t) { var d = new Date(t); return two(d.getMonth() + 1) + "-" + two(d.getDate()) + " " + two(d.getHours()) + ":" + two(d.getMinutes()); };

  // ======== App 与窗口 ========
  // 英文名也认（open -a Safari、open -a Terminal）
  var EN = { terminal: "win", finder: "finder", safari: "safari", editor: "ide", textedit: "ide", "text edit": "ide", "system settings": "settings", "system preferences": "settings", settings: "settings",
    numbers: "numbers", pages: "pages", keynote: "keynote", notes: "notes", reminders: "reminders", calendar: "calendar", clock: "clock", transfer: "export", "file transfer": "export" };
  function apps() { try { return D().appList() || []; } catch (e) { return []; } }
  function appName(id, fb) { var a = apps().filter(function (x) { return x.id === id; })[0]; return a ? a.name : fb || id; }
  function findApp(key) {
    var k = String(key || "").trim(), low = k.toLowerCase().replace(/\.app$/, "");
    if (!k) return null;
    var list = apps(), hit = list.filter(function (a) { return a.id === k || a.id.toLowerCase() === low || a.name === k || a.name.toLowerCase() === low; })[0];
    if (hit) return hit;
    if (EN[low]) return list.filter(function (a) { return a.id === EN[low]; })[0] || { id: EN[low], name: appName(EN[low], k) };
    var d = D();
    return d.apps[k] ? { id: d.apps[k].app, name: appName(d.apps[k].app, d.apps[k].name) } : null;
  }
  function titleOf(w) {
    try { if (typeof w.title === "function") { var t = w.title(); if (t) return String(t); } } catch (e) { /* 取不到就用标题栏上的字 */ }
    var s = w.el.querySelector(".bar span");
    return (s && s.textContent) || w.name || w.el.id;
  }
  function frameOf(w) {
    var b = w.el.getBoundingClientRect();
    if (b.width && b.height) return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) };
    var r = w.rect ? w.rect() : { left: 0, top: 0, width: 0, height: 0 };
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  }
  // 前面的在前（同 macOS 的 CGWindowList）：最前的窗口、按叠放、最小化的、关着的
  function allWins(all) {
    var d = D(), front = d.front(), ios = IOS(), fg = ios ? ios.fg() : null;
    var rank = function (w) { return (w.state === "closed" ? -2e6 : w.state === "min" ? -1e6 : 0) + (+w.el.style.zIndex || 0) + (w === (ios ? fg : front) ? 1e5 : 0); };
    return Object.keys(d.apps).map(function (k) { return d.apps[k]; }).filter(function (w) { return w && w.el && (all || w.state !== "closed"); })
      .sort(function (a, b) { return rank(b) - rank(a); })
      .map(function (w) {
        var f = frameOf(w), isFront = ios ? w === fg : w === front;
        return { id: w.el.id, app: w.app, appName: appName(w.app, w.name), title: titleOf(w), x: f.x, y: f.y, width: f.w, height: f.h, desktop: (w.space || 0) + 1, state: w.state,
          front: !!isFront, onScreen: w.state !== "min" && w.state !== "closed" && !w.el.classList.contains("elsewhere") && (!ios || !!isFront) };
      });
  }
  // 窗口 id；也认 App（id 或名字）→ 它最前面的那个窗口
  function winOf(key) {
    var d = D(), k = String(key || "");
    if (!k) throw usage("which window? (windows lists their ids)");
    if (d.apps[k]) return d.apps[k];
    var a = findApp(k), w = a && allWins(true).filter(function (x) { return x.app === a.id && x.state !== "closed"; })[0];
    if (w) return d.apps[w.id];
    throw err("no window \"" + k + "\" (windows lists them)");
  }
  var winLine = function (x) { return [x.front ? "*" : " ", x.id, x.appName, x.state, String(x.desktop), x.x + "," + x.y + " " + x.width + "×" + x.height, clip(x.title, 70)]; };
  S.register("apps", {
    summary: "list the running apps (front one first) and their windows",
    usage: ["apps [--all] [--json]"],
    help: "Running = has open or minimized windows. --all also lists every installed app (Dock, Launchpad) that isn't running. Open an app with `open -a <app>`; see its windows with `windows`.",
    run: function (argv) {
      var g = getopt(argv, { all: "bool", json: "bool" }, { "-a": "all" }).o, by = {}, out = [];
      allWins(false).forEach(function (w) {
        var a = by[w.app];
        if (!a) { a = by[w.app] = { id: w.app, name: w.appName, running: true, front: false, windows: [] }; out.push(a); }
        a.windows.push(w.id);
        if (w.front) a.front = true;
      });
      out.sort(function (a, b) { return (b.front ? 1 : 0) - (a.front ? 1 : 0); });
      if (g.all) apps().forEach(function (x) { if (!by[x.id]) { by[x.id] = 1; out.push({ id: x.id, name: x.name, running: false, front: false, windows: [] }); } });
      if (g.json) return json(out);
      if (!out.length) return "No apps are running (apps --all lists the installed ones).";
      return table([["ID", "NAME", "STATE", "WINDOWS"]].concat(out.map(function (a) { return [a.id, a.name, a.front ? "front" : a.running ? "running" : "-", a.windows.join(" ") || "-"]; })));
    },
  });
  S.register("windows", {
    summary: "list the windows (id, app, title, frame, desktop, state); bring one to front, move, minimize, zoom, close",
    usage: ["windows [--all] [--json]", "windows front <id>", "windows move <id> <x> <y> [<width> <height>]", "windows resize <id> <width> <height>", "windows min|zoom|full|close <id>"],
    help: "The list is front to back; * marks the front window. FRAME is x,y width×height in screen points (the menu bar is at the top); DESKTOP is the Mission Control space; STATE is normal, zoom, full, min or closed (--all includes closed ones).\n" +
      "<id> is a window id from the list, or an app (id or name) meaning its frontmost window. front also un-minimizes and switches desktop; close is the red button, so the app may ask the human first (unsaved changes).\n" +
      "Look inside a window with `ax <id>` (its controls and text) or `screencapture -l <id> shot.png` (a picture).",
    levelNote: "Listing needs read access; front, move, resize, min, zoom, full and close need read & write.",
    run: function (argv, ctx) {
      var sub = argv[0] && argv[0][0] !== "-" ? argv.shift() : "list";
      if (sub === "list") {
        var g = getopt(argv, { all: "bool", json: "bool" }, { "-a": "all" }).o, l = allWins(!!g.all);
        if (g.json) return json(l);
        if (!l.length) return "No windows are open.";
        return table([[" ", "ID", "APP", "STATE", "DESKTOP", "FRAME", "TITLE"]].concat(l.map(winLine)));
      }
      var ACT = { front: 1, focus: 1, show: 1, move: 1, resize: 1, min: 1, minimize: 1, zoom: 1, full: 1, fullscreen: 1, close: 1 };
      if (!ACT[sub]) throw usage("unknown subcommand \"" + sub + "\"");
      ctx.need("rw", "windows " + sub);
      var w = winOf(argv[0]), ios = IOS(), n = argv.slice(1).map(Number), id = w.el.id;
      if (ios && /^(move|resize|zoom|full|fullscreen)$/.test(sub)) throw err("on the phone every app is full screen: there's nothing to " + sub);
      if (sub === "front" || sub === "focus" || sub === "show") { if (ios) ios.open(w); else if (w.state === "min" || w.state === "closed") w.show(); else w.front(); }
      else if (sub === "min" || sub === "minimize") { if (ios) ios.home(); else w.hide("min"); }
      else if (sub === "zoom") w.zoom();
      else if (sub === "full" || sub === "fullscreen") { if (w.state === "full") w.exitFull(); else w.enterFull(); }
      else if (sub === "close") {
        D().close(id);
        return U.sleep(400).then(function () { return w.state === "closed" ? "Closed " + id + "." : "Asked " + id + " to close; it's still open — the app is probably asking the human something (unsaved changes)."; });
      } else {
        var r = w.rect(), want = sub === "move" ? { left: n[0], top: n[1], width: argv.length > 3 ? n[2] : r.width, height: argv.length > 4 ? n[3] : r.height } : { left: r.left, top: r.top, width: n[0], height: n[1] };
        if ([want.left, want.top, want.width, want.height].some(function (v) { return typeof v !== "number" || isNaN(v); })) throw usage(sub === "move" ? "windows move <id> <x> <y> [<width> <height>]" : "windows resize <id> <width> <height>");
        if (w.state === "full") w.exitFull();
        if (w.state === "min" || w.state === "closed") w.show();
        w.place(want, true);
      }
      return U.sleep(350).then(function () { var x = allWins(true).filter(function (v) { return v.id === id; })[0]; return x ? table([winLine(x)]).replace(/^\s+/, "") : ""; });
    },
  });
  S.register("spaces", {
    summary: "the desktops (Mission Control spaces) with their windows; switch between them",
    usage: ["spaces [--json]", "spaces switch <n>"],
    levelNote: "switch needs read & write access.",
    run: function (argv, ctx) {
      var d = D(), sp = d.spaces ? d.spaces() : { count: 1, current: 0 };
      if (argv[0] === "switch") {
        ctx.need("rw", "spaces switch");
        var n = parseInt(argv[1], 10);
        if (!(n >= 1 && n <= sp.count)) throw usage("spaces switch <1–" + sp.count + ">");
        d.switchSpace(n - 1);
        return "Now on desktop " + n + ".";
      }
      var g = getopt(argv, { json: "bool" }).o, ws = allWins(false), out = [];
      for (var i = 0; i < sp.count; i++) out.push({ desktop: i + 1, current: i === sp.current, windows: ws.filter(function (w) { return w.desktop === i + 1 && w.state !== "min"; }).map(function (w) { return w.id; }) });
      if (g.json) return json(out);
      return out.map(function (s) { return "Desktop " + s.desktop + (s.current ? " (current)" : "") + ": " + (s.windows.join(" ") || "no windows"); }).join("\n");
    },
  });

  // ======== 通知中心 ========
  S.register("notifications", {
    summary: "the Notification Center: list what's there, post one, clear them",
    usage: ["notifications [list] [--app <app>] [-n <count>] [--json]", "notifications post [--title <title>] <message…>", "notifications clear [<id>…] [--app <app>] [--all]"],
    level: "any",
    help: "list: newest first; <id> is the first column. post: shows a banner (unless Do Not Disturb is on or the human turned them off) and stays in the Notification Center; " +
      "an agent's notifications come from the Terminal with the agent's name, and clicking one opens that agent. clear: by id, by app, or --all. " +
      "Per-app banner styles and Do Not Disturb are settings: `defaults read desktop notifications`, `defaults read desktop focus`.",
    levelNote: "list needs read access, clear needs read & write; any agent can post.",
    run: function (argv, ctx) {
      var sub = argv[0] && argv[0][0] !== "-" ? argv.shift() : "list", d = D();
      if (sub === "list") {
        ctx.need("read", "notifications list");
        var g = getopt(argv, { app: "str", count: "num", json: "bool" }, { "-n": "count", "-a": "app" }).o, a = g.app ? findApp(g.app) : null;
        var l = (d.notifications ? d.notifications() : []).filter(function (x) { return !g.app || x.appId === (a && a.id) || x.name === g.app; });
        if (g.count) l = l.slice(0, g.count);
        var rows = l.map(function (x) { return { id: x.id, app: x.appId || "", appName: x.name, time: new Date(x.t).toISOString(), title: x.title, body: x.body }; });
        if (g.json) return json(rows);
        if (!rows.length) return "No notifications.";
        return table([["ID", "TIME", "APP", "NOTIFICATION"]].concat(l.map(function (x) { return [String(x.id), stamp(x.t), x.name, clip(x.title + (x.body ? " — " + x.body : ""), 100)]; })));
      }
      if (sub === "post") {
        var p = getopt(argv, { title: "str", app: "str" }, { "-t": "title" }), body = p.a.join(" ") || (ctx.stdin || "").trim();
        if (!body && !p.o.title) throw usage("notifications post [--title <title>] <message…>");
        var ag = ctx.agent, o = ag ? { app: "win", title: ag.name + (p.o.title ? " · " + p.o.title : ""), body: body, onClick: function () { if (window.TSU_TERM && TSU_TERM.agent) TSU_TERM.agent(ag.id); } }
          : { app: (p.o.app && findApp(p.o.app) || {}).id || p.o.app || "win", title: p.o.title || "", body: body };
        if (ag && p.o.app) ctx.notes.push("(--app is ignored for agents: your notifications always come from the Terminal with your name)");
        var h = d.notify(o);
        if (!h || !h.id) return "Notifications from " + appName(o.app, o.app) + " are turned off (System Settings › Notifications), so nothing was shown.";
        return { out: "Posted notification " + h.id + ".", summary: "Posted a notification" };
      }
      if (sub === "clear") {
        ctx.need("rw", "notifications clear");
        var c = getopt(argv, { app: "str", all: "bool" }, { "-a": "app" }), all = d.notifications ? d.notifications() : [], ids;
        if (c.o.all) ids = null;
        else if (c.o.app) { var ap = findApp(c.o.app); ids = all.filter(function (x) { return x.appId === (ap && ap.id) || x.name === c.o.app; }).map(function (x) { return x.id; }); }
        else if (c.a.length) ids = c.a.map(function (x) { return x; });
        else throw usage("notifications clear <id>… | --app <app> | --all");
        var before = all.length;
        d.clearNotifications(ids);
        var after = d.notifications().length;
        return "Cleared " + (before - after) + " notification" + (before - after === 1 ? "" : "s") + ".";
      }
      throw usage("unknown subcommand \"" + sub + "\"");
    },
  });

  // ======== defaults：设置就是 JSON 文件（desktop.json、settings.json），这里按 macOS 的 defaults 读写 ========
  function deskSettings() { var d = D(); if (!d.settings || !d.settings.schema) throw err("the desktop settings aren't ready yet"); return d.settings; }
  var AGENTS_FILE = "/.paimon/config/settings.json";
  function kindOfCfg(d) { return d.bool ? "true | false" : d.one ? d.one.map(function (v) { return JSON.stringify(v); }).join(" | ") : d.some ? "an array of " + d.some.map(function (v) { return JSON.stringify(v); }).join(", ") : d.map ? "an object { tool name: " + d.map.map(function (v) { return JSON.stringify(v); }).join(" | ") + " }" : "a string"; }
  var DOMAINS = {
    "com.paimon.desktop": {
      aliases: ["desktop", "NSGlobalDomain", "-g", "-globalDomain", "com.apple.desktop"], about: "the desktop — appearance, wallpaper, Dock, Stage Manager, Do Not Disturb (focus), notifications (System Settings; " + "/.paimon/config/desktop.json)",
      file: function () { return deskSettings().file; },
      read: function () { var o = {}; deskSettings().schema().forEach(function (x) { o[x.key] = x.now; }); return o; },
      keys: function () { return deskSettings().schema().map(function (x) { return x.key; }); },
      kind: function (k) { var x = deskSettings().schema().filter(function (y) { return y.key === k; })[0]; return x ? x.kind : ""; },
      def: function (k) { var x = deskSettings().schema().filter(function (y) { return y.key === k; })[0]; return x ? x.def : undefined; },
      write: function (k, v) {
        var st = deskSettings(), path = k.split(".");
        if (path[0] === "notifications") {
          if (path.length === 2) { if (!st.setNotifyStyle(path[1], v)) throw err("notifications." + path[1] + " must be \"banner\", \"alert\" or \"none\""); return; }
          if (!v || typeof v !== "object" || Array.isArray(v)) throw err("notifications must be an object like {\"numbers\": \"alert\"}");
          var cur = this.read().notifications || {};
          Object.keys(cur).forEach(function (id) { if (!(id in v)) st.setNotifyStyle(id, "banner"); });
          Object.keys(v).forEach(function (id) { if (!st.setNotifyStyle(id, v[id])) throw err("notifications." + id + " must be \"banner\", \"alert\" or \"none\""); });
          return;
        }
        if (k === "loginItems") {
          if (!Array.isArray(v) || v.some(function (x) { return typeof x !== "string"; })) throw err("loginItems must be an array of app ids");
          var now = st.loginItems();
          now.forEach(function (id) { if (v.indexOf(id) < 0) st.setLoginItem(id, false); });
          v.forEach(function (id) { if (now.indexOf(id) < 0) st.setLoginItem(id, true); });
          return;
        }
        if (this.keys().indexOf(k) < 0) throw err("no key \"" + k + "\" in com.paimon.desktop (defaults read desktop lists them)");
        if (!st.set(k, v)) throw err("\"" + k + "\" can't be " + JSON.stringify(v) + " — it takes " + this.kind(k));
      },
    },
    "com.paimon.agents": {
      aliases: ["paimon", "agents", "settings", "com.paimon.settings"], about: "the agents and the terminal — thinking, status line, tools, custom instructions, default model (" + AGENTS_FILE + ")",
      file: function () { return AGENTS_FILE; },
      read: function () { var A = AG(), o = {}; Object.keys(A.CFG_SCHEMA).forEach(function (k) { o[k] = A.cfg[k]; }); return o; },
      keys: function () { return Object.keys(AG().CFG_SCHEMA); },
      kind: function (k) { var d = AG().CFG_SCHEMA[k]; return d ? kindOfCfg(d) : ""; },
      def: function (k) { return AG().CFG_DEFAULT[k]; },
      write: function (k, v) {
        var A = AG();
        if (!A.CFG_SCHEMA[k]) throw err("no key \"" + k + "\" in com.paimon.agents (defaults read agents lists them)");
        if (!A.setCfg(k, v)) throw err("\"" + k + "\" can't be " + JSON.stringify(v) + " — it takes " + this.kind(k));
      },
    },
  };
  // 每个 agent 一个域：com.paimon.agent.<名字>（读谁都能读；改只有人能改——agent 不能改自己或别人的档位、模型）
  function agentDomain(name) {
    var A = AG(), m = /^com\.paimon\.agent\.(.+)$/.exec(name);
    if (!A || !m) return null;
    var a = A.get(m[1]) || A.byName(m[1]);
    if (!a) return null;
    var rt = function () { return A.runtime(a.id); };
    return {
      id: "com.paimon.agent." + a.name, about: "agent " + a.name + " (" + a.id + ")", agent: a,
      read: function () { var x = A.get(a.id) || a; return { id: x.id, name: x.name, model: x.model, effort: x.effort || "high", access: x.access || "read", archived: !!x.archived, pinned: !!x.pinned, home: rt().home() }; },
      keys: function () { return ["name", "model", "effort", "access", "archived", "pinned"]; },
      kind: function (k) { return { name: "a name (letters, digits, . - _)", model: A.models().map(function (x) { return JSON.stringify(x.id); }).join(" | "), effort: A.EFFORTS.map(function (x) { return JSON.stringify(x); }).join(" | "), access: "\"none\" | \"read\" | \"rw\"", archived: "true | false", pinned: "true | false" }[k] || ""; },
      def: function (k) { return { effort: "high", access: "read", archived: false, pinned: false }[k]; },
      write: function (k, v) {
        if (k === "name") { var e = rt().rename(String(v)); if (e && typeof e === "string") throw err(e); return; }
        if (k === "model") { if (!A.models().some(function (x) { return x.id === v; })) throw err("model must be one of " + this.kind("model")); rt().setModel(v); return; }
        if (k === "effort") { if (!rt().setEffort(v)) throw err("effort must be one of " + this.kind("effort")); return; }
        if (k === "access") { if (["none", "read", "rw"].indexOf(v) < 0) throw err("access must be none, read or rw"); rt().setAccess(v); return; }
        if (k === "archived") { if (v) A.archive(a.id); else A.unarchive(a.id); return; }
        if (k === "pinned") { A.pin(a.id, !!v); return; }
        throw err("no key \"" + k + "\" (" + this.keys().join(", ") + ")");
      },
    };
  }
  function domainOf(name) {
    var n = String(name || "");
    if (DOMAINS[n]) return Object.assign({ id: n }, DOMAINS[n]);
    var hit = Object.keys(DOMAINS).filter(function (k) { return DOMAINS[k].aliases.indexOf(n) >= 0; })[0];
    if (hit) return Object.assign({ id: hit }, DOMAINS[hit]);
    var ad = agentDomain(n) || agentDomain("com.paimon.agent." + n.replace(/^agent\./, ""));
    if (ad && (/^com\.paimon\.agent\./.test(n) || /^agent\./.test(n))) return ad;
    throw err("Domain " + n + " does not exist (defaults domains lists them)");
  }
  function getKey(obj, k) { return k.split(".").reduce(function (o, p) { return o && typeof o === "object" ? o[p] : undefined; }, obj); }
  var show = function (v) { return typeof v === "string" ? v : JSON.stringify(v, null, 2); };
  // 值：-bool / -int / -float / -string / -array / -dict（同 macOS）；不写类型就按 JSON 读，读不了就是字符串
  function valueOf(args) {
    if (!args.length) throw usage("defaults write <domain> <key> <value>");
    var t = args[0], rest = args.slice(1);
    if (/^-(bool|boolean)$/.test(t)) { if (!/^(yes|no|true|false|1|0)$/i.test(rest[0] || "")) throw usage("-bool wants YES/NO, true/false or 1/0"); return /^(yes|true|1)$/i.test(rest[0]); }
    if (/^-(int|integer)$/.test(t)) { var i = parseInt(rest[0], 10); if (isNaN(i)) throw usage("-int wants a number"); return i; }
    if (t === "-float") { var f = parseFloat(rest[0]); if (isNaN(f)) throw usage("-float wants a number"); return f; }
    if (t === "-string") return rest.join(" ");
    if (t === "-array") return rest.map(function (x) { try { var j = JSON.parse(x); return typeof j === "object" ? x : j; } catch (e) { return x; } });
    if (t === "-dict") { var o = {}; for (var k = 0; k + 1 < rest.length; k += 2) o[rest[k]] = rest[k + 1]; return o; }
    if (args.length > 1) throw usage("more than one value — quote it, or use -array / -dict");
    try { return JSON.parse(t); } catch (e) { return t; }
  }
  S.register("defaults", {
    summary: "read and write settings (the desktop's, the agents', each agent's) — macOS style, over the JSON files",
    usage: ["defaults domains", "defaults read [<domain> [<key>]]", "defaults write <domain> <key> [-bool|-int|-float|-string|-array|-dict] <value>", "defaults delete <domain> <key>", "defaults keys <domain>"],
    help: function () {
      return "Domains:\n  com.paimon.desktop (desktop) — " + DOMAINS["com.paimon.desktop"].about + "\n  com.paimon.agents (agents) — " + DOMAINS["com.paimon.agents"].about +
        "\n  com.paimon.agent.<name> — one agent: name, model, effort, access, archived, pinned (only the human can change these)\n" +
        "Values are JSON (true, 13, \"dark\", [\"balance\"]) or a bare word; nested keys use dots (notifications.numbers). `defaults keys <domain>` shows what each key takes. " +
        "Changes apply at once — the apps and the JSON files update together, just like the System Settings app.\n" +
        "Examples: defaults read desktop theme · defaults write desktop theme dark · defaults write desktop focus -bool YES · defaults write desktop notifications.numbers alert · defaults write agents statusline '[\"balance\",\"context\"]'";
    },
    levelNote: "Reading needs read access; write and delete need read & write (the same as editing the JSON files). An agent's own domain (model, access…) is changed by the human only.",
    run: function (argv, ctx) {
      var sub = argv.shift() || "read";
      if (sub === "domains") {
        var A = AG(), l = Object.keys(DOMAINS).map(function (k) { return k + " — " + DOMAINS[k].about; });
        if (A) A.list().concat(A.archived ? A.archived() : []).forEach(function (a) { l.push("com.paimon.agent." + a.name + " — agent " + a.name + " (" + a.id + ")" + (a.archived ? ", archived" : "")); });
        return l.join("\n");
      }
      if (sub === "read") {
        if (!argv.length) { var all = {}; Object.keys(DOMAINS).forEach(function (k) { all[k] = DOMAINS[k].read(); }); return json(all); }
        var dm = domainOf(argv[0]), data = dm.read();
        if (argv.length < 2) return json(data);
        var v = getKey(data, argv[1]);
        if (v === undefined) throw err("The domain/default pair of (" + dm.id + ", " + argv[1] + ") does not exist");
        return show(v);
      }
      if (sub === "keys" || sub === "read-type") {
        var dk = domainOf(argv[0]);
        if (sub === "read-type") { var tv = getKey(dk.read(), argv[1] || ""); if (tv === undefined) throw err("no key " + argv[1]); return "Type is " + (Array.isArray(tv) ? "array" : tv === null ? "null" : typeof tv === "object" ? "dictionary" : typeof tv); }
        var cur = dk.read();
        return table([["KEY", "TAKES", "DEFAULT", "NOW"]].concat(dk.keys().map(function (k) { return [k, clip(dk.kind(k), 60), JSON.stringify(dk.def(k)) || "-", clip(JSON.stringify(cur[k]), 50)]; })));
      }
      if (sub === "write" || sub === "delete") {
        if (argv.length < 2) throw usage(sub === "write" ? "defaults write <domain> <key> <value>" : "defaults delete <domain> <key>");
        var d2 = domainOf(argv[0]), key = argv[1];
        if (d2.agent) { if (ctx.agent) throw err("only the human can change an agent's settings (System Settings › Paimon)"); }
        else { ctx.need("rw", "defaults " + sub); ctx.check(d2.file(), "w"); }
        var val = sub === "write" ? valueOf(argv.slice(2)) : d2.def(key);
        if (sub === "delete" && val === undefined) throw err("\"" + key + "\" has no default to go back to");
        d2.write(key, val);
        return { out: d2.id + " " + key + " = " + JSON.stringify(getKey(d2.read(), key)), summary: "Set " + key };
      }
      throw usage("unknown subcommand \"" + sub + "\"");
    },
  });

  // ======== open：同双击（文件交给默认的 App，文件夹开访达，网址开 Safari）；-a 指定 App ========
  var IMG = /\.(png|jpe?g|gif|webp|bmp|ico|avif|svg)$/i, HTML = /\.(html?|xhtml)$/i;
  function openers(p) { return (window.TSU_OPENERS || []).filter(function (o) { var e = (p.match(/\.([^./]+)$/) || [])[1]; return o && o.exts && e && o.exts.indexOf(e.toLowerCase()) >= 0; }); }
  S.register("open", {
    summary: "open files, folders, URLs or apps on the desktop, like double-clicking them",
    usage: ["open <path|url>…", "open -a <app> [<path>…]", "open -R <path>", "open -e <path>"],
    help: "A file opens in its default app (spreadsheets in 表格, documents in 文稿, .pptx in 讲演, images in Quick Look, web pages in Safari, text in the editor); a folder opens a Finder window; http(s) URLs open in Safari.\n" +
      "-a <app>: that app (id or name: finder, safari, ide, numbers… or Finder, Safari, TextEdit, Terminal); without paths it just launches it. -R: reveal in Finder. -e / -t: open in the text editor.\n" +
      "The human sees it happen. What's in a window afterwards: `ax <window>` or `screencapture -l <window>`.",
    levelNote: "Agents need read access, and read permission on each path. Agents can't open files in Terminal (that would run them as the human).",
    run: function (argv, ctx) {
      var g = getopt(argv, { app: "str", reveal: "bool", edit: "bool", "new": "bool", background: "bool", fresh: "bool", wait: "bool" }, { "-a": "app", "-R": "reveal", "-e": "edit", "-t": "edit", "-n": "new", "-g": "background", "-F": "fresh", "-W": "wait" });
      var o = g.o, items = g.a, done = [], d = D();
      var app = o.app ? findApp(o.app) : null;
      if (o.app && !app) throw err("Unable to find application named '" + o.app + "' (apps --all lists them)");
      if (!items.length) {
        if (!app) throw usage("open <path|url>… (or open -a <app>)");
        d.launch(app.id);
        return "Opened " + app.name + ".";
      }
      items.forEach(function (x) {
        if (/^https?:\/\//i.test(x)) {
          if (!window.TSU_SAFARI) throw err("Safari isn't available");
          TSU_SAFARI.open(x);
          done.push(x + " in Safari");
          return;
        }
        var p = ctx.path(x), SB = window.SANDBOX;
        if (!SB.exists(p)) throw err("The file " + ctx.shown(p) + " does not exist.");
        ctx.check(p, "r");
        var dir = SB.isDir(p), F = window.TSU_FINDER;
        if (o.reveal) { F.reveal(p); done.push(ctx.shown(p) + " (revealed in Finder)"); return; }
        if (o.edit) { if (dir) throw err(ctx.shown(p) + " is a folder"); TSU_IDE.open(p); done.push(ctx.shown(p) + " in " + appName("ide", "编辑器")); return; }
        if (app) {
          if (app.id === "win" && !dir && ctx.agent) throw err("opening a file in Terminal runs it as the human, so agents can't do that — run it yourself with Bash");
          if (app.id === "win" && dir) { TSU_TERM.openWindow(p); done.push(ctx.shown(p) + " in " + app.name); return; }
          if (!F || !F.openWith(app.id, [p])) throw err(app.name + " can't open " + ctx.shown(p));
          done.push(ctx.shown(p) + " in " + app.name);
          return;
        }
        if (dir) { F.newWindow(p); done.push(ctx.shown(p) + " in " + appName("finder", "访达")); return; }
        var reg = openers(p)[0];
        if (reg) { F.openWith(reg.id, [p]) || reg.open(p); done.push(ctx.shown(p) + " in " + (reg.name || appName(reg.id))); return; }
        if (IMG.test(p)) { F.preview(p); done.push(ctx.shown(p) + " in Quick Look"); return; }
        if (HTML.test(p) && F.openWith("safari", [p])) { done.push(ctx.shown(p) + " in Safari"); return; }
        if (window.TSU_IDE) { TSU_IDE.open(p); done.push(ctx.shown(p) + " in " + appName("ide", "编辑器")); return; }
        throw err("no app can open " + ctx.shown(p));
      });
      return { out: "Opened " + done.join(", ") + ".", summary: "Opened " + done.length + " item" + (done.length > 1 ? "s" : "") };
    },
  });

  // ======== 剪贴板 ========
  S.register("pbcopy", {
    summary: "copy stdin to the clipboard",
    usage: ["… | pbcopy"],
    level: "rw",
    help: "Puts the piped text on this desktop's clipboard (and on the system clipboard when the browser allows it), so the human can paste it with ⌘V.",
    run: function (argv, ctx) {
      if (ctx.stdin == null) throw usage("pipe something in, e.g. echo hi | pbcopy");
      S.pasteboard.set(ctx.stdin);
      var n = ctx.stdin.length;
      return S.pasteboard.sysWrite(ctx.stdin).then(function () { return { out: "", summary: "Copied " + n + " characters" }; },
        function () { return { out: "", summary: "Copied " + n + " characters (desktop clipboard)" }; });
    },
  });
  S.register("pbpaste", {
    summary: "print the clipboard",
    usage: ["pbpaste"],
    help: "Prints the text last copied, cut or pasted on this desktop (or put there with pbcopy). For the human it reads the system clipboard when the browser allows it.",
    run: function (argv, ctx) {
      var mine = S.pasteboard.get();
      if (ctx.agent || !navigator.clipboard || !navigator.clipboard.readText) return mine;
      return Promise.race([navigator.clipboard.readText(), U.sleep(1500).then(function () { throw new Error("timeout"); })]).then(function (t) { return t || mine; }, function () { return mine; });
    },
  });

  // ======== 菜单栏：最前面那个 App 的菜单；click 选一项（同 AppleScript 的 click menu item）========
  function menuModel() { var d = D(); if (!d.menus) throw err("the menu bar isn't available"); return d.menus(); }
  var usable = function (a) { return a && !a.sep && !a.disabled && !a.info && !a.swatches; };
  var subOf = function (a) { try { return typeof a.items === "function" ? a.items() || [] : a.items || null; } catch (e) { return []; } }; // 子菜单可能是打开时才算的
  function menuLines(items, ind, out) {
    (items || []).forEach(function (a) {
      if (a.sep) { out.push(ind + "—"); return; }
      if (a.swatches) { out.push(ind + "(tags: " + a.swatches.map(function (s) { return s.title || s.color; }).join(", ") + ")"); return; }
      out.push(ind + (a.checked ? "✓ " : "") + a.label + (a.keys ? "  " + a.keys : "") + (a.disabled ? "  (disabled)" : "") + (a.info ? "  (info)" : "") + (a.items ? "  ▸" : ""));
      if (a.items) menuLines(subOf(a), ind + "    ", out);
    });
  }
  var plainMenu = function (items) { return (items || []).filter(function (a) { return !a.sep; }).map(function (a) { return a.swatches ? { tags: a.swatches.map(function (s) { return s.title || s.color; }) } : { label: a.label, keys: a.keys || "", enabled: usable(a), checked: !!a.checked, items: a.items ? plainMenu(subOf(a)) : undefined }; }); };
  S.register("menubar", {
    summary: "the front app's menu bar menus and items; choose one",
    usage: ["menubar [--json]", "menubar click <menu> <item> [<submenu item>]"],
    help: "Lists every menu of the app in front (what you'd see clicking its menu titles), with shortcuts and disabled items. click chooses an item exactly as if the human did (match by the exact label, or a unique prefix). Bring another app to front first with `windows front <id>`.",
    levelNote: "Listing needs read access; click needs read & write.",
    run: function (argv, ctx) {
      var m = menuModel();
      if (argv[0] === "click") {
        ctx.need("rw", "menubar click");
        var path = argv.slice(1);
        if (path.length < 2) throw usage("menubar click <menu> <item> [<submenu item>]");
        var pick = function (list, name, what) {
          var l = (Array.isArray(list) ? list : []).filter(function (a) { return !a.sep && a.label; }), n = String(name).toLowerCase();
          var hit = l.filter(function (a) { return a.label === name || a.title === name; })[0] || l.filter(function (a) { return String(a.label).toLowerCase() === n; })[0];
          if (!hit) { var pre = l.filter(function (a) { return String(a.label).toLowerCase().indexOf(n) === 0; }); if (pre.length === 1) hit = pre[0]; }
          if (!hit) throw err("no " + what + " \"" + name + "\" (" + l.map(function (a) { return a.label; }).join(", ") + ")");
          return hit;
        };
        var menu = (m.menus || []).filter(function (x) { return x.title === path[0] || String(x.title).toLowerCase() === path[0].toLowerCase(); })[0];
        if (!menu) throw err("no menu \"" + path[0] + "\" (" + (m.menus || []).map(function (x) { return x.title; }).join(", ") + ")");
        var it = pick(subOf(menu), path[1], "item"), trail = [menu.title, it.label];
        if (path[2]) { if (!it.items) throw err("\"" + it.label + "\" has no submenu"); it = pick(subOf(it), path[2], "submenu item"); trail.push(it.label); }
        if (!usable(it) || typeof it.run !== "function") throw err("\"" + it.label + "\" is " + (it.items ? "a submenu — name one of its items" : "disabled right now"));
        if (D().closeMenus) D().closeMenus();
        it.run();
        return { out: "Chose " + trail.join(" › ") + ".", summary: "Chose " + trail.join(" › ") };
      }
      var g = getopt(argv, { json: "bool" }).o;
      if (g.json) return json({ app: m.app, menus: (m.menus || []).map(function (x) { return { title: x.title, items: plainMenu(subOf(x) || []) }; }) });
      var out = [m.app + " (the app in front)"];
      (m.menus || []).forEach(function (x) { out.push("", x.title); menuLines(subOf(x) || [], "    ", out); });
      return out.join("\n");
    },
  });
})();
