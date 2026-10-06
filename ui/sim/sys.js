// sys.js —— 系统命令：同 macOS 的命令行工具（apps、windows、open、screencapture、defaults、pbcopy……），人和 agent 都在 shell 里用。
// agent 感知、操作这台桌面走这里，而不是给模型再加一个个工具：
// · 浏览器里的 shell：登记成 SANDBOX 的命令，管道、重定向、&& 照常（人自己的终端、浏览器沙盒里 agent 的 Bash）
// · 真沙盒里 agent 的 Bash：agents.js 用 TSU_SYS.plan(命令) 看里面有没有这些命令——有就拆开：这几段在浏览器里跑，
//   别的照常交给沙盒，管道两头接上（windows --json | jq …、cat a.csv | numbers write A1 -、screencapture > 日志）
// · 谁调就以谁的身份：路径按它自己的权限；读界面（窗口列表、截屏、ax）要 read 档，动界面（按、填、关窗口、写设置、剪贴板）要 rw 档
// · 渐进式披露：agent 的 help 里每个命令一行；<命令> --help（或 help <命令>）看全
// · App 自己登记：TSU_SYS.register(名字, { summary, usage: [..], help, level: "any" | "read" | "rw", title, run(argv, ctx) })，
//   或者按动作登记（同 Apple 的 App Intents）：TSU_SYS.registerApp(id, { name, title, summary, actions: [{ name, summary, args, params, run(args, ctx) }] })
(function () {
  "use strict";
  var CMDS = {}, ORDER = [], ALIAS = {};
  var DK = function () { return window.TSU_DESK || null; };
  var AG = function () { return window.TSU_AGENTS || null; };
  var IOS = function () { return document.documentElement.classList.contains("ios") && window.TSU_IOS ? window.TSU_IOS : null; };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function err(msg, code) { var e = new Error(msg); e.code = code == null ? 1 : code; return e; }
  var usage = function (msg) { return err(msg, 2); };
  var nl = function (s) { s = String(s == null ? "" : s); return s && s[s.length - 1] !== "\n" ? s + "\n" : s; };
  var two = function (n) { return (n < 10 ? "0" : "") + n; };
  var json = function (v) { return JSON.stringify(v, null, 2) + "\n"; };
  function clip(s, n) { s = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function normPath(p, cwd, home) {
    p = String(p || "");
    if (p === "~" || p.indexOf("~/") === 0) p = home + p.slice(1);
    if (p[0] !== "/") p = (cwd || home || "/") + "/" + p;
    var o = [];
    p.split("/").forEach(function (x) { if (!x || x === ".") return; if (x === "..") o.pop(); else o.push(x); });
    return "/" + o.join("/");
  }
  // 终端里的宽度：中日韩、全角、emoji 算两格
  var WIDE = /[ᄀ-ᅟ⺀-〾ぁ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\ud83c-\ud83e][\udc00-\udfff]/;
  function cols(s) { var n = 0; Array.from(String(s)).forEach(function (ch) { n += WIDE.test(ch) ? 2 : 1; }); return n; }
  function padR(s, n) { s = String(s); var w = cols(s); return w >= n ? s : s + " ".repeat(n - w); }
  // 表格：第一行是表头；最后一列不补空格
  function table(rows) {
    var w = [];
    rows.forEach(function (r) { r.forEach(function (c, i) { if (i < r.length - 1) w[i] = Math.max(w[i] || 0, cols(c)); }); });
    return rows.map(function (r) { return r.map(function (c, i) { return i < r.length - 1 ? padR(c, w[i]) : String(c); }).join("  ").replace(/\s+$/, ""); }).join("\n") + "\n";
  }

  // ======== 选项：--x=y、--x y、-l y、-lvalue、-ab（开关连写）、-- 之后都是位置参数；"-" 与负数算位置参数 ========
  // spec：{ 名字: "bool" | "str" | "num" }；alias：{ "-l": "window", "--win": "window" }
  function getopt(argv, spec, alias) {
    var o = {}, a = [], i = 0;
    alias = alias || {};
    var num = function (v, n) { var x = Number(v); if (v === "" || isNaN(x)) throw usage("--" + n + " wants a number, got \"" + v + "\""); return x; };
    while (i < argv.length) {
      var s = String(argv[i++]);
      if (s === "--") { a = a.concat(argv.slice(i)); break; }
      if (/^--[^-]/.test(s)) {
        var eq = s.indexOf("="), name = eq > 0 ? s.slice(2, eq) : s.slice(2), val = eq > 0 ? s.slice(eq + 1) : undefined;
        name = alias["--" + name] || name;
        var t = spec[name];
        if (!t) throw usage("unknown option --" + name);
        if (t === "bool") { o[name] = val === undefined ? true : !/^(false|no|0|off)$/i.test(val); continue; }
        if (val === undefined) { if (i >= argv.length) throw usage("--" + name + " needs a value"); val = String(argv[i++]); }
        o[name] = t === "num" ? num(val, name) : val;
        continue;
      }
      if (/^-[^-\d.]/.test(s)) {
        for (var k = 1; k < s.length; k++) {
          var nm = alias["-" + s[k]] || (spec[s[k]] ? s[k] : null);
          if (!nm || !spec[nm]) throw usage("unknown option -" + s[k]);
          if (spec[nm] === "bool") { o[nm] = true; continue; }
          var v2 = k + 1 < s.length ? s.slice(k + 1) : argv[i++];
          if (v2 === undefined) throw usage("-" + s[k] + " needs a value");
          o[nm] = spec[nm] === "num" ? num(v2, nm) : String(v2);
          break;
        }
        continue;
      }
      a.push(s);
    }
    return { o: o, a: a };
  }

  // ======== 登记 ========
  function register(name, spec) {
    if (!name || !spec || typeof spec.run !== "function") return;
    var had = !!CMDS[name];
    CMDS[name] = Object.assign({ name: name, summary: "", usage: [name], level: "read" }, spec);
    if (!had) ORDER.push(name);
    (spec.aliases || []).forEach(function (x) { ALIAS[x] = name; });
    [name].concat(spec.aliases || []).forEach(shellHook);
    document.dispatchEvent(new CustomEvent("tsu-sys", { detail: { name: name } }));
  }
  var get = function (name) { return CMDS[name] || CMDS[ALIAS[name]] || null; };
  function helpOf(name) {
    var c = get(String(name || "").trim());
    if (!c) return null;
    var l = [c.name + " — " + c.summary + (c.aliases && c.aliases.length ? "  (also: " + c.aliases.join(", ") + ")" : ""), "", "Usage:"];
    c.usage.forEach(function (u) { l.push("  " + u); });
    var h = typeof c.help === "function" ? c.help() : c.help;
    if (h) l.push("", h);
    var lv = { read: "Agents need read access or more (reading the screen can show the human's files).", rw: "Agents need read & write access." }[c.level];
    if (lv) l.push("", "Permissions: " + lv + (c.levelNote ? " " + c.levelNote : ""));
    else if (c.levelNote) l.push("", "Permissions: " + c.levelNote);
    return l.join("\n");
  }
  function list() { return ORDER.filter(function (n) { return !CMDS[n].hidden; }).map(function (n) { var c = CMDS[n]; return { name: n, summary: c.summary, title: c.title || "", aliases: c.aliases || [] }; }); }

  // ======== 执行 ========
  // base：{ agent: { id, name, access } | null（人）, principal（SANDBOX 的身份，查权限用）, cwd, home, stdin, signal, vision,
  //         readFile(路径) → Promise<字符串>, readBytes(路径) → Promise<Uint8Array>, writeFile(路径, 字符串 | Uint8Array, 追加?) → Promise, shown(路径) → 给调用者看的路径 }
  // 路径都是桌面这边的（访达看到的）；真沙盒里 agent 看到的是真的路径，shown() 换过去
  function makeCtx(base) {
    base = base || {};
    var agent = base.agent || null, S = window.SANDBOX;
    var ctx = { agent: agent, human: !agent, principal: base.principal || null, signal: base.signal || null, vision: !!base.vision, remote: !!base.remote,
      cwd: base.cwd || base.home || (S ? S.HOME : "/"), home: base.home || (S ? S.HOME : "/"), stdin: base.stdin == null ? null : String(base.stdin), images: [], notes: [] };
    ctx.path = function (p) { return normPath(p, ctx.cwd, ctx.home); };
    ctx.shown = base.shown || function (v) { return v; };
    ctx.can = function (p, need) {
      if (!agent) return true;
      var h = ctx.principal && ctx.principal.home;
      if (h && (p === h || p.indexOf(h + "/") === 0)) return true; // 自己的家：随便（真沙盒的镜像可能还没取回刚建的目录）
      try { return S.can(p, need === "w" || need === "write" ? "w" : "r", ctx.principal); } catch (e) { return false; }
    };
    ctx.check = function (p, need) {
      if (ctx.can(p, need)) return;
      var w = need === "w" || need === "write";
      throw err("Permission denied: " + ctx.shown(p) + " (you can't " + (w ? "write" : "read") + " there; your access outside your home is " + agent.access + ")", 1);
    };
    // 档位：读界面要 read，动界面要 rw（人不受限）
    ctx.need = function (level, what) {
      if (!agent || level === "any") return;
      var a = agent.access || "read";
      if (level === "rw" && a !== "rw") throw err((what || "this") + " changes the human's desktop, so it needs read & write access (you have " + a + "; the human switches it with shift+tab)", 1);
      if (level === "read" && a === "none") throw err((what || "this") + " reads the human's screen, so it needs read access (you have none; the human switches it with shift+tab)", 1);
    };
    ctx.readFile = base.readFile || function (p) { return Promise.resolve().then(function () { ctx.check(p, "r"); return S.as(ctx.principal, function () { return S.read(p); }); }); };
    ctx.readBytes = base.readBytes || function (p) { return Promise.resolve().then(function () { ctx.check(p, "r"); return S.as(ctx.principal, function () { return S.readBinary(p); }); }); };
    ctx.writeFile = base.writeFile || function (p, data, append) {
      return Promise.resolve().then(function () {
        return S.as(ctx.principal, function () {
          var dir = p.replace(/\/[^/]*$/, "") || "/";
          if (!S.exists(dir)) S.mkdirp(dir);
          if (data instanceof Uint8Array) S.writeBinary(p, data);
          else S.write(p, append && S.exists(p) ? S.read(p) + data : data);
        });
      });
    };
    return ctx;
  }
  function exec(name, argv, base) {
    var c = get(name);
    if (!c) return Promise.resolve({ out: "", err: name + ": command not found\n", code: 127, images: [] });
    var ctx = makeCtx(base);
    argv = (argv || []).map(String);
    if (argv[0] === "--help" || argv[0] === "-h" && !c.hasH) return Promise.resolve({ out: nl(helpOf(c.name)), err: "", code: 0, images: [] });
    return Promise.resolve().then(function () {
      if (c.level && c.level !== "any") ctx.need(c.level, c.name);
      return c.run(argv, ctx);
    }).then(function (r) {
      if (r == null) r = "";
      if (typeof r === "string") r = { out: r };
      return { out: nl(r.out || ""), err: ctx.notes.map(nl).join("") + (r.err ? nl(r.err) : ""), code: r.code || 0, images: ctx.images.concat(r.images || []), summary: r.summary || "", title: c.title || "", thumb: r.thumb || null };
    }, function (e) {
      var m = (e && e.message) || String(e);
      return { out: "", err: ctx.notes.map(nl).join("") + c.name + ": " + m + (e && e.code === 2 ? "\n" + "usage: " + c.usage.join("\n       ") : "") + "\n", code: e && typeof e.code === "number" ? e.code : 1, images: [], title: c.title || "" };
    });
  }
  // agent 在浏览器沙盒里跑的命令：截到的图先放这里，Bash 这一步结束时 agents.js 取走、附在结果里给模型看
  var pendingImg = {};
  function stash(id, imgs, thumb) { if (!id || !imgs || !imgs.length) return; var p = pendingImg[id] || (pendingImg[id] = { images: [], thumb: null }); p.images = p.images.concat(imgs).slice(-4); if (thumb) p.thumb = thumb; }
  function takeImages(id) { var p = pendingImg[id]; delete pendingImg[id]; return p || { images: [], thumb: null }; }
  function agentOf(who) {
    if (!who) return null;
    var a = AG() && AG().get(who.name);
    return { id: who.name, name: (a && a.name) || who.label || who.name, access: who.outside || (a && a.access) || "read" };
  }
  function visionOf(id) { try { var m = AG().runtime(id).model(); return !!(m && m.vision); } catch (e) { return false; } }
  // 浏览器里的 shell：登记成它的命令（管道、重定向、&& 由 shell 自己管）
  function shellHook(name) {
    var S = window.SANDBOX;
    if (!S || !S.registerCommand) return;
    S.registerCommand(name, function (sc, args) {
      var who = sc.who || null, ag = agentOf(who);
      return exec(name, args, { agent: ag, principal: who, cwd: sc.cwd, home: who ? who.home : S.HOME, stdin: sc.stdin, signal: sc.signal, vision: ag ? visionOf(ag.id) : false })
        .then(function (r) { if (ag) stash(ag.id, r.images, r.thumb); return { out: r.out, err: r.err, code: r.code }; });
    });
  }

  // ======== 真沙盒里 agent 的 Bash：拆命令 ========
  // 只认「简单」的：命令列表（; && || 换行）× 管道（|）× 每段「词 + 重定向」。系统命令出现在 if / for / ( ) / $( ) 这些里面就不拆，告诉 agent 怎么写
  var RESERVED = /^(if|then|else|elif|fi|for|while|until|do|done|case|esac|function|select|coproc|\{|\}|\[\[|\]\]|!|time)$/;
  function lex(src) {
    var toks = [], i = 0, n = src.length;
    var skipParen = function (j) { // src[j] === "(" ：跳到配对的 ")" 后面
      var depth = 0;
      for (; j < n; j++) {
        var ch = src[j];
        if (ch === "\\") { j++; continue; }
        if (ch === "'") { var q = src.indexOf("'", j + 1); if (q < 0) return n; j = q; continue; }
        if (ch === "(") depth++;
        else if (ch === ")" && !--depth) return j + 1;
      }
      return n;
    };
    function word() {
      var s = i, val = "", exp = false, quoted = false, sub = false;
      while (i < n) {
        var c = src[i];
        if (/[\s|&;()<>]/.test(c)) break;
        if (c === "\\") { if (i + 1 < n && src[i + 1] !== "\n") val += src[i + 1]; i += 2; quoted = true; continue; }
        if (c === "'") { var j = src.indexOf("'", i + 1); if (j < 0) throw usage("unterminated quote"); val += src.slice(i + 1, j); i = j + 1; quoted = true; continue; }
        if (c === '"') {
          i++; quoted = true;
          while (i < n && src[i] !== '"') {
            if (src[i] === "\\" && i + 1 < n && /[$`"\\\n]/.test(src[i + 1])) { if (src[i + 1] !== "\n") val += src[i + 1]; i += 2; continue; }
            if (src[i] === "$" || src[i] === "`") { exp = true; if (src[i] === "`" || src[i + 1] === "(") sub = true; }
            if (src[i] === "$" && src[i + 1] === "(") { var e0 = skipParen(i + 1); val += src.slice(i, e0); i = e0; continue; }
            val += src[i++];
          }
          if (i >= n) throw usage("unterminated quote");
          i++;
          continue;
        }
        if (c === "$") { exp = true; if (src[i + 1] === "(") { sub = true; var e1 = skipParen(i + 1); val += src.slice(i, e1); i = e1; continue; } }
        if (c === "`") { exp = true; sub = true; var k = src.indexOf("`", i + 1); if (k < 0) throw usage("unterminated `"); val += src.slice(i, k + 1); i = k + 1; continue; }
        if (/[*?[{]/.test(c) || (c === "~" && i === s)) exp = true;
        val += c; i++;
      }
      return { t: "w", raw: src.slice(s, i), val: val, exp: exp, quoted: quoted, sub: sub, s: s, e: i };
    }
    while (i < n) {
      var c = src[i];
      if (c === " " || c === "\t" || c === "\r") { i++; continue; }
      if (c === "\\" && src[i + 1] === "\n") { i += 2; continue; }
      if (c === "#") { while (i < n && src[i] !== "\n") i++; continue; }
      if (c === "\n") { toks.push({ t: "op", v: ";", s: i, e: i + 1 }); i++; continue; }
      var rest = src.slice(i, i + 5), m = /^(\d*)(&>>|&>|>>|>&|>\||<<<|<<-|<<|<&|<>|>|<)/.exec(src.slice(i, i + 12));
      if (m && (m[1] === "" || /^\d+$/.test(m[1]))) { toks.push({ t: "redir", fd: m[1], v: m[2], s: i, e: i + m[0].length }); i += m[0].length; continue; }
      var op = /^(&&|\|\||;;|\|&|\||&|;|\(|\))/.exec(rest);
      if (op) { toks.push({ t: "op", v: op[1], s: i, e: i + op[1].length }); i += op[1].length; continue; }
      toks.push(word());
    }
    return toks;
  }
  // → null（没有系统命令：原样交给沙盒）| { error }（用法拆不了）| { items: [{ op, text, local, stages: [{ text, local, words, redirs }] }] }
  function plan(src) {
    src = String(src || "");
    if (!ORDER.length || !src.trim()) return null;
    var toks;
    try { toks = lex(src); } catch (e) { return null; } // 引号没配对：交给 bash 自己报错
    if (toks.some(function (t) { return t.t === "redir" && /^<<-?$/.test(t.v); })) return null; // here-document：后面几行是正文不是命令，这里分不清，原样交给 bash
    var inSub = /(\$\(|`)\s*([A-Za-z][\w-]*)/g, ms;
    while ((ms = inSub.exec(src))) if (get(ms[2])) return { error: "`" + ms[2] + "` is a desktop system command: it runs in the browser, outside bash, so $( " + ms[2] + " … ) and backquotes can't capture it. Run it on its own and save the output (`" + ms[2] + " … > out.txt`), or pipe it (`" + ms[2] + " … | …`)." };
    var complex = false, found = [], expect = true, target = false;
    toks.forEach(function (t) {
      if (t.t === "op") { if (t.v === "(" || t.v === ")" || t.v === ";;") complex = true; expect = true; target = false; return; }
      if (t.t === "redir") { if (/^<</.test(t.v) && t.v !== "<<<") complex = true; target = true; return; }
      if (target) { target = false; return; } // 重定向的目标（> 后面那个词）不算命令
      if (!expect) return;
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t.raw) && !t.quoted) return; // VAR=值 命令
      if (RESERVED.test(t.raw)) { complex = true; if (!/^(fi|done|esac|\}|\]\])$/.test(t.raw)) return; expect = false; return; }
      if (get(t.val)) found.push(t.val);
      expect = false;
    });
    if (!found.length) return null;
    if (complex) return { error: "`" + found[0] + "` is a desktop system command: it runs in the browser, outside bash, so it can't sit inside if / for / while, ( … ), $( … ) or here-documents. Run it on its own or in a plain pipeline — e.g. `" + found[0] + " --json > out.json` then process out.json, or `" + found[0] + " … | jq …`." };
    var items = [], it = null, st = null, pendingOp = null;
    var newStage = function (t0) { st = { words: [], redirs: [], s: t0.s, e: t0.e, local: false }; it.stages.push(st); };
    for (var k = 0; k < toks.length; k++) {
      var t = toks[k];
      if (t.t === "op" && (t.v === ";" || t.v === "&&" || t.v === "||" || t.v === "&")) {
        if (it) { if (t.v === "&") it.bg = true; pendingOp = t.v === "&" ? ";" : t.v; }
        it = null; st = null;
        continue;
      }
      if (!it) { it = { op: items.length ? pendingOp : null, stages: [], bg: false }; items.push(it); pendingOp = null; st = null; }
      if (t.t === "op" && (t.v === "|" || t.v === "|&")) { if (st && t.v === "|&") st.mergeErr = true; st = null; continue; }
      if (!st) newStage(t);
      if (t.t === "redir") { var tg = toks[k + 1]; if (!tg || tg.t !== "w") return { error: "a redirection has no target" }; st.redirs.push({ fd: t.fd, op: t.v, target: tg }); st.e = tg.e; k++; continue; }
      st.words.push(t);
      st.e = t.e;
    }
    items.forEach(function (it0) {
      it0.stages.forEach(function (s0) {
        s0.text = src.slice(s0.s, s0.e);
        var w = s0.words.filter(function (x, i) { return !(i === 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(x.raw) && !x.quoted); });
        s0.cmd = w.length ? w[0].val : "";
        s0.args = w.slice(1);
        s0.local = !!get(s0.cmd);
      });
      it0.local = it0.stages.some(function (s0) { return s0.local; });
      it0.text = src.slice(it0.stages[0].s, it0.stages[it0.stages.length - 1].e);
      if (it0.local && it0.bg) it0.error = "`" + it0.stages.filter(function (s0) { return s0.local; })[0].cmd + "` can't run in the background with &; run it in the foreground (it's quick), or use run_in_background";
    });
    var bad = items.filter(function (x) { return x.error; })[0];
    if (bad) return { error: bad.error };
    return { items: items };
  }
  // 按计划跑：remote(命令, stdin) → Promise<{ out, err, code, vcwd? }>（在真沙盒里以 agent 的身份跑，vcwd：跑完以后的当前目录，桌面这边的路径）
  function runPlan(p, base, remote) {
    var out = "", errs = "", code = 0, images = [], thumb = null, sum = "", title = "", idx = 0;
    var shq = function (s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; };
    var R = function (cmd, stdin) { return remote(cmd, stdin).then(function (r) { if (r.vcwd) base.cwd = r.vcwd; return r; }); };
    // 有 $变量、通配符、~ 的参数：让沙盒里的 bash 展开（在 agent 自己的目录、以它的身份）
    function expand(words, targets) {
      var need = words.some(function (w) { return w.exp; }) || targets.some(function (w) { return w.exp; });
      if (!need) return Promise.resolve({ args: words.map(function (w) { return w.val; }), targets: targets.map(function (w) { return w.val; }) });
      var cmd = (words.length ? "printf '%s\\0' " + words.map(function (w) { return w.raw; }).join(" ") + "; " : "") + "printf '\\001\\0'" + (targets.length ? "; printf '%s\\0' " + targets.map(function (w) { return w.raw; }).join(" ") : "");
      return R(cmd, null).then(function (r) {
        if (r.code) throw err("couldn't expand the arguments: " + (r.err || "").trim());
        var parts = r.out.split("\0"), sep = parts.indexOf("\x01"), virt = base.virt || function (x) { return x; };
        parts.pop();
        // 展开出来的是沙盒里的真路径（~ → /Users/Shared/tsu/…）：命令要的是桌面这边的路径；重定向的目标照旧交给沙盒，不换
        return { args: parts.slice(0, sep).map(function (x) { return x[0] === "/" ? virt(x) : x; }), targets: parts.slice(sep + 1) };
      });
    }
    function runLocal(st, stdin) {
      var targets = st.redirs.filter(function (r) { return !/^[<>]&$/.test(r.op) && r.target.val !== "/dev/null"; }).map(function (r) { return r.target; });
      return expand(st.args, targets).then(function (ex) {
        var map = new Map();
        targets.forEach(function (t, i) { map.set(t, ex.targets[i] != null ? ex.targets[i] : t.val); });
        var input = Promise.resolve(stdin);
        st.redirs.forEach(function (r) {
          if (r.op !== "<") return;
          var f = map.get(r.target) || r.target.val;
          input = f === "/dev/null" ? Promise.resolve("") : R("cat -- " + shq(f), null).then(function (x) { if (x.code) throw err(clip(x.err, 200) || "can't read " + f); return x.out; });
        });
        return input.then(function (inp) {
          return exec(st.cmd, ex.args, Object.assign({}, base, { stdin: inp }));
        }).then(function (r) {
          images = images.concat(r.images || []);
          if (r.thumb) thumb = r.thumb;
          if (r.summary) sum = r.summary;
          if (r.title) title = r.title;
          // 重定向同 bash：从左到右改「这个 fd 通到哪」（> f 2>&1 是两个都进 f；2>&1 > f 是只有 1 进 f）
          var dest = { 1: "out", 2: "err" }, files = [];
          st.redirs.forEach(function (rd) {
            var fd = rd.fd || (rd.op[0] === "<" ? "0" : "1"), tv = rd.target.val;
            if (rd.op === "<" || rd.op === "<>" || rd.op === "<&" || rd.op === "<<<") return;
            if (rd.op === ">&") { if (tv === "-") dest[fd] = null; else if (dest[tv] !== undefined) dest[fd] = dest[tv]; return; }
            var f = tv === "/dev/null" ? null : { path: map.get(rd.target) || tv, append: rd.op === ">>" || rd.op === "&>>", data: "" };
            if (f) files.push(f);
            if (rd.op === "&>" || rd.op === "&>>") { dest[1] = f; dest[2] = f; } else dest[fd] = f;
          });
          if (st.mergeErr) dest[2] = dest[1];
          var o = "", e = "";
          [[1, r.out], [2, r.err]].forEach(function (x) {
            var d = dest[x[0]];
            if (d === "out") o += x[1]; else if (d === "err") e += x[1]; else if (d) d.data += x[1];
          });
          var chain = Promise.resolve();
          files.forEach(function (f) {
            chain = chain.then(function () { return R("cat " + (f.append ? ">> " : "> ") + shq(f.path), f.data).then(function (x) { if (x.code) e += (x.err || "can't write " + f.path + "\n"); }); });
          });
          return chain.then(function () { return { out: o, err: e, code: r.code }; });
        });
      });
    }
    function runPipe(it) {
      if (!it.local) return R(it.text, null);
      var groups = [], g = null;
      it.stages.forEach(function (st) {
        if (st.local) { groups.push({ local: true, st: st }); g = null; }
        else { if (!g) groups.push(g = { local: false, texts: [] }); g.texts.push(st.text); }
      });
      var stdin = null, es = "", last = { out: "", code: 0 };
      return groups.reduce(function (pr, gr) {
        return pr.then(function () {
          return (gr.local ? runLocal(gr.st, stdin) : R(gr.texts.join(" | "), stdin)).then(function (r) { stdin = r.out; es += r.err || ""; last = r; });
        });
      }, Promise.resolve()).then(function () { return { out: last.out, err: es, code: last.code }; });
    }
    function next() {
      if (idx >= p.items.length) return Promise.resolve({ out: out, err: errs, code: code, images: images, thumb: thumb, summary: sum, title: title });
      var it = p.items[idx++];
      if ((it.op === "&&" && code !== 0) || (it.op === "||" && code === 0)) return next();
      if (base.signal && base.signal.aborted) return Promise.resolve({ out: out, err: errs, code: 130, images: images });
      return runPipe(it).then(function (r) { out += r.out || ""; errs += r.err || ""; code = r.code; return next(); }, function (e) { errs += ((e && e.message) || e) + "\n"; code = (e && e.code) || 1; return next(); });
    }
    return next();
  }

  // ======== App 按动作登记命令（同 Apple 的 App Intents）：numbers write A1:B2 '[[1,2],[3,4]]'、pages insert --at end -、keynote add-slide --title … ========
  // actions：[{ name（驼峰也行，命令里写成 add-sheet）, summary, args（位置参数的顺序，如 ["range", "values"]）, stdin（没给时从管道读的那个参数）,
  //   params（JSON Schema：properties、required；路径参数标 path: "read" | "write"；表格样的参数标 table: true，可以写 CSV / TSV）, run(args, ctx) → 文字 | { text, summary, data } | Promise }]
  // ctx：{ agent | null, human, signal, path(p), can(p, need), check(p, need), shown(p) }——agent 以自己的身份做事
  var kebab = function (n) { return String(n).replace(/[A-Z]/g, function (m) { return "-" + m.toLowerCase(); }); };
  var camel = function (n) { return String(n).replace(/-([a-z])/g, function (m, c) { return c.toUpperCase(); }); };
  var typesOf = function (d) { return Array.isArray(d.type) ? d.type : d.type ? [d.type] : ["string"]; };
  function checkArgs(schema, args) {
    var props = (schema && schema.properties) || {}, req = (schema && schema.required) || [];
    for (var i = 0; i < req.length; i++) if (args[req[i]] === undefined || args[req[i]] === null || args[req[i]] === "") return "missing " + req[i];
    for (var k in args) {
      if (!props[k] || args[k] === undefined || args[k] === null) continue;
      var v = args[k], ok = typesOf(props[k]).some(function (t) { return t === "array" ? Array.isArray(v) : t === "integer" ? Number.isInteger(v) : t === "number" ? typeof v === "number" : t === "object" ? v && typeof v === "object" && !Array.isArray(v) : typeof v === t; });
      if (!ok) return k + " should be " + typesOf(props[k]).join(" or ");
      if (props[k].enum && props[k].enum.indexOf(v) < 0) return k + " must be one of " + props[k].enum.join(", ");
    }
    return "";
  }
  // CSV / TSV → 行（有 tab 就按 tab 分，不然按逗号；"…" 里可以有逗号、换行，"" 是一个引号）；像数字的变成数字
  function parseTable(text) {
    text = String(text).replace(/\r\n?/g, "\n").replace(/\n$/, "");
    var sep = text.indexOf("\t") >= 0 ? "\t" : ",", rows = [[]], cell = "", q = false, i = 0;
    var push = function () { rows[rows.length - 1].push(/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(cell) ? Number(cell) : cell); cell = ""; };
    for (; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
      if (c === '"' && cell === "") { q = true; continue; }
      if (c === sep) { push(); continue; }
      if (c === "\n") { push(); rows.push([]); continue; }
      cell += c;
    }
    push();
    return rows;
  }
  function registerApp(id, meta) {
    if (!id || !meta) return;
    var acts = {};
    (meta.actions || []).forEach(function (a) { if (a && a.name && typeof a.run === "function") acts[a.name] = a; });
    var names = Object.keys(acts);
    var find = function (n) { n = String(n || ""); return acts[n] || names.map(function (k) { return acts[k]; }).filter(function (a) { return kebab(a.name) === n || a.name.toLowerCase() === n.toLowerCase(); })[0] || null; };
    var P = function (a) { return (a.params && a.params.properties) || {}; };
    var R = function (a) { return (a.params && a.params.required) || []; };
    function synopsis(a) {
      var props = P(a), req = R(a), pos = a.args || [], bits = [id, kebab(a.name)];
      pos.forEach(function (k) { bits.push(req.indexOf(k) >= 0 ? "<" + kebab(k) + ">" : "[<" + kebab(k) + ">]"); });
      Object.keys(props).filter(function (k) { return pos.indexOf(k) < 0; }).forEach(function (k) {
        var b = "--" + kebab(k) + (typesOf(props[k]).indexOf("boolean") >= 0 && typesOf(props[k]).length === 1 ? "" : " <" + (props[k].enum ? props[k].enum.join("|") : kebab(k)) + ">");
        bits.push(req.indexOf(k) >= 0 ? b : "[" + b + "]");
      });
      return bits.join(" ");
    }
    function argHelp(a) {
      var props = P(a), req = R(a);
      return Object.keys(props).map(function (k) {
        var d = props[k];
        return "      " + ((a.args || []).indexOf(k) >= 0 ? "<" + kebab(k) + ">" : "--" + kebab(k)) + " — " + (d.description || typesOf(d).join(" | ")) + (req.indexOf(k) >= 0 ? " (required)" : "") +
          (d.path ? " (a path you can " + d.path + ")" : "") + (d.default !== undefined ? " (default " + JSON.stringify(d.default) + ")" : "") + (a.stdin === k ? " (or piped in: - or stdin)" : "");
      }).join("\n");
    }
    function parse(a, argv, ctx) {
      var props = P(a), o = {}, extra = [], i = 0;
      var conv = function (k, v) {
        var d = props[k] || {}, ts = typesOf(d);
        if (v === "-") { if (ctx.stdin == null) throw usage(kebab(k) + " is - but nothing was piped in"); v = ctx.stdin.replace(/\n$/, ""); }
        if (ts.length === 1 && (ts[0] === "integer" || ts[0] === "number")) { var n = Number(v); if (v === "" || isNaN(n)) throw usage(kebab(k) + " wants a number, got \"" + v + "\""); return n; }
        if (ts.length === 1 && ts[0] === "boolean") return /^(1|true|yes|on)$/i.test(v);
        if (ts.indexOf("array") >= 0 || ts.indexOf("object") >= 0) {
          if (/^\s*[\[{]/.test(v)) { try { return JSON.parse(v); } catch (e) { if (!d.table) throw usage(kebab(k) + " isn't valid JSON: " + e.message); } }
          if (d.table) { var t = parseTable(v); return t.length === 1 && t[0].length === 1 ? t[0][0] : t; }
        }
        if (ts.indexOf("number") >= 0 && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(v)) return Number(v);
        return v;
      };
      while (i < argv.length) {
        var s = argv[i++];
        if (s === "--") { extra = extra.concat(argv.slice(i)); break; }
        var m = /^--([A-Za-z][\w-]*)(?:=([\s\S]*))?$/.exec(s);
        if (m) {
          var k = camel(m[1]);
          if (!props[k]) throw usage("unknown option --" + m[1] + " for " + kebab(a.name));
          if (typesOf(props[k]).length === 1 && typesOf(props[k])[0] === "boolean" && m[2] === undefined) { o[k] = true; continue; }
          var v = m[2] !== undefined ? m[2] : argv[i++];
          if (v === undefined) throw usage("--" + m[1] + " needs a value");
          o[k] = conv(k, v);
          continue;
        }
        extra.push(s);
      }
      var pos = (a.args || []).filter(function (k) { return !(k in o); });
      extra.forEach(function (v, j) { if (j >= pos.length) throw usage("unexpected argument \"" + v + "\" (" + synopsis(a) + ")"); o[pos[j]] = conv(pos[j], v); });
      if (a.stdin && o[a.stdin] === undefined && ctx.stdin != null && ctx.stdin !== "") o[a.stdin] = conv(a.stdin, "-");
      return o;
    }
    register(id, {
      title: meta.title || meta.name || id, level: "any", appId: id,
      summary: meta.summary || (meta.name || id) + ": " + names.map(kebab).join(", "),
      usage: names.map(function (k) { return synopsis(acts[k]); }),
      help: function () {
        return "Actions (the app does it and the human sees it happen; without --path they act on the " + (meta.name || id) + " document in front, else the last one used):\n" +
          names.map(function (k) { var a = acts[k], ah = argHelp(a); return "  " + kebab(a.name) + " — " + a.summary + (ah ? "\n" + ah : ""); }).join("\n") +
          "\n\nAdd --json for machine-readable output where there is data. Paths are relative to your working directory." + (meta.help ? "\n\n" + meta.help : "");
      },
      levelNote: "none needed beyond the files themselves: reading a document needs read permission on it, changing it needs write permission.",
      run: function (argv, ctx) {
        var j = argv.indexOf("--json"), asJson = j >= 0;
        if (asJson) argv.splice(j, 1);
        var sub = argv.shift();
        if (!sub) throw usage("which action? " + names.map(kebab).join(", ") + " (" + id + " --help)");
        var a = find(sub);
        if (!a) throw usage("no action \"" + sub + "\"; actions: " + names.map(kebab).join(", "));
        if (argv[0] === "--help" || argv[0] === "-h") return id + " " + kebab(a.name) + " — " + a.summary + "\n\nUsage:\n  " + synopsis(a) + "\n\n" + argHelp(a) + "\n";
        var args = parse(a, argv, ctx), props = P(a);
        Object.keys(props).forEach(function (k) { if (props[k].path && typeof args[k] === "string" && args[k]) { args[k] = ctx.path(args[k]); ctx.check(args[k], props[k].path); } });
        var bad = checkArgs(a.params, args);
        if (bad) throw usage(bad);
        var actx = { agent: ctx.agent, human: ctx.human, signal: ctx.signal, path: ctx.path, can: function (p, n) { return ctx.can(p, n); }, check: function (p, n) { ctx.check(p, n); }, shown: ctx.shown };
        var timer = 0;
        return Promise.race([Promise.resolve().then(function () { return a.run(args, actx); }), new Promise(function (res, rej) { timer = setTimeout(function () { rej(err((meta.name || id) + " didn't finish " + kebab(a.name) + " in 60s")); }, 60000); })])
          .then(function (r) {
            clearTimeout(timer);
            if (asJson && r && typeof r === "object" && r.data !== undefined) return { out: JSON.stringify(r.data, null, 2), summary: r.summary };
            var text = typeof r === "string" ? r : r && typeof r.text === "string" ? r.text : JSON.stringify(r === undefined ? "Done." : r, null, 2);
            // 真沙盒：App 说的是桌面这边的路径（~/…、/agents/…），换成调用者在沙盒里看到的
            if (ctx.remote) text = String(text).replace(/(^|[\s(“"'])(~\/|\/home\/user(?=[\/\s.,)]|$)|\/agents(?=\/)|\/shared(?=[\/\s.,)]|$))/g, function (m, pre, root) { return pre + ctx.shown(root === "~/" ? "/home/user" : root) + (root === "~/" ? "/" : ""); });
            return { out: text, summary: (r && r.summary) || String(text).split("\n")[0].slice(0, 120) };
          }, function (e) { clearTimeout(timer); throw e; });
      },
    });
  }

  // ======== 剪贴板（桌面这一份）：页面里拷贝、剪切、粘贴过的文字都记下；pbcopy 写这里（能写系统剪贴板时也写）========
  var PB = { text: "", t: 0 };
  var pbSet = function (t) { PB.text = String(t == null ? "" : t); PB.t = Date.now(); };
  var selText = function () {
    var a = document.activeElement;
    if (a && (a.tagName === "TEXTAREA" || a.tagName === "INPUT") && typeof a.selectionStart === "number") return a.value.slice(a.selectionStart, a.selectionEnd);
    return String(document.getSelection() || "");
  };
  window.addEventListener("copy", function (e) { var d = e.clipboardData && e.clipboardData.getData("text/plain"); pbSet(d || selText()); });
  window.addEventListener("cut", function (e) { var d = e.clipboardData && e.clipboardData.getData("text/plain"); pbSet(d || selText()); });
  window.addEventListener("paste", function (e) { var d = e.clipboardData && e.clipboardData.getData("text/plain"); if (d) pbSet(d); }, true);
  var sysWrite = null;
  try {
    var CB = navigator.clipboard;
    if (CB && CB.writeText) {
      sysWrite = CB.writeText.bind(CB);
      CB.writeText = function (t) { pbSet(t); return sysWrite(t); };
    }
  } catch (e) { /* 不让改就算了 */ }

  window.TSU_SYS = {
    register: register, registerApp: registerApp, has: function (n) { return !!get(n); }, list: list, help: helpOf, exec: exec, plan: plan, runPlan: runPlan, takeImages: takeImages,
    getopt: getopt, table: table, clip: clip, normPath: normPath, cols: cols, padR: padR, parseTable: parseTable, checkArgs: checkArgs,
    pasteboard: { get: function () { return PB.text; }, set: pbSet, sysWrite: function (t) { return sysWrite ? sysWrite(t) : Promise.reject(new Error("no clipboard")); } },
    _: { err: err, usage: usage, nl: nl, two: two, json: json, sleep: sleep, DK: DK, AG: AG, IOS: IOS, makeCtx: makeCtx, stash: stash, visionOf: visionOf },
  };
})();
