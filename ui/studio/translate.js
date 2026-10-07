// translate.js —— 任务翻译（设置 › 对话 › 任务翻译，agent 设置里的 translateTasks：off | display（跟随显示语言）| zh | en | ja | ko | fr | de | es）。
//   翻的是 Agent 的「任务」一家子：任务清单（标题、在做时的那句 activeForm）、后台任务的说明、子 Agent 的名字 / 说明、运行状态行那一句。
//   代码、路径、命令、标识符、数字原样（提示词里要求；看着就是代码的整条不送去翻）。
//   TSU_TRANSLATE.text(原文, ctx?) → 有译文给译文；没有就先给原文，在后台去翻，翻好了让用到的地方重画（任务一家子、Agent 的 TUI / GUI）。
//     ctx：这些任务是谁的（agent id 或名字）——同一个 agent 的一起送去翻，模型看得到它们彼此，用词一致。
//   TSU_TRANSLATE.target() → 现在翻成哪种语言（"" = 关着）；onChange(fn)：有新译文了。
//
// ======== 缓存（同一句话翻成同一种语言只翻一次；重画、状态变了都不会再要）========
//   key = 版本 + 语言 + 规整后的原文（去掉首尾空白、连续空白并成一个）。任务从「待办」变「在做」变「做完」key 不变；
//   换语言只翻那种语言还没有的；改了提示词、规则就把 VERSION 加一（服务器那边 TR_VERSION 同时加），旧的全部不再命中。
//   1) 内存：MEM（key → 译文；"" = 不用翻 / 同原文）。同一句正在路上的不再要第二次（FLY）；250ms 内要的攒成一批（PEND），同一个 agent 的一起发，一批最多 40 条。
//   2) 本机：IndexedDB（库 tsu-translate，表 tr：{ k, o, t }，t 上有索引）。内存里没有的先查这里，查到就不发请求。
//      页面一起来就把最近用过的（最多 8000 条）读进内存（WARM）：刷新、重开 App 以后第一次画就是译文，不先闪一下原文再换。
//      查本机不看「暂停」「过会儿再试」（那是给网络的）：余额不足、限流时，翻过的照样从本机拿出来。
//      最多 20000 条：写满了删最久没用的（命中时刷新 t，同一条一天最多刷一次）。打不开 IndexedDB 就用 localStorage（最多 800 条）。
//   3) 服务器：按账号存（src/translate.js 的 translations 表）；别的窗口、别的设备翻过的直接拿，只有哪儿都没有的才叫模型、才扣费。
//   4) 不用翻的（已经是目标语言、整条看着像代码、没有字母）直接原样，连请求都不发。
//   发请求：任务标题、回复各一条队，同一种语言的不分 agent 攒成一批；同时在路上的最多回复 2 个、任务 1 个（见下面 pump）。
//   出错：这一批 4 秒、12 秒、36 秒后再试，满 4 次放下；限流（429）照服务器给的 retryAfter 等；余额不足（402）、没登录（401 / 403）整个停 10 分钟。
//   每一次请求记进服务记录（svclog.js，服务状态页）：多久、几条、结果、错误。
(function () {
  "use strict";
  if (window.TSU_TRANSLATE) return;
  var VERSION = 1, BATCH = 40, WAIT = 250, CAP = 20000, WARM = 8000, LS_CAP = 800, DAY = 864e5;
  var LANGS = ["zh", "en", "ja", "ko", "fr", "de", "es"];
  var mode = function () { var A = window.TSU_AGENTS, c = (A && A.cfg) || {}; return c.translateTasks || "off"; };
  var PREV = null; // 预览（测试、设置页里指着一项时）：不存，给 null 回到设置里的
  function target() {
    var m = PREV !== null ? PREV : mode();
    if (m === "off" || !m) return "";
    if (m === "display") return (window.TSU_I18N && TSU_I18N.lang && TSU_I18N.lang()) === "en" ? "en" : "zh";
    return LANGS.indexOf(m) >= 0 ? m : "";
  }
  var norm = function (s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); };
  // cyrb53：快、53 位；再带上长度和语言，本机 5000 条里撞上的机会可以忽略（服务器那边另用 sha256）
  function h53(str) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0, ch; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  var keyOf = function (to, src) { return VERSION + ":" + to + ":" + h53(src) + ":" + src.length; };

  // ---- 要不要翻：已经是目标语言的、看着像代码的、没有字母的都不翻 ----
  var HAN = /[\u3400-\u9fff\uf900-\ufaff]/, KANA = /[\u3040-\u30ff]/, HANGUL = /[\uac00-\ud7af\u1100-\u11ff]/, WORD = /[A-Za-z]{2,}/;
  var NONLATIN = /[\u0400-\u04ff\u0590-\u06ff\u0e00-\u0e7f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
  var codeLike = function (s) { return (!/\s/.test(s) && /[./\\_:=@~$#]|[a-z][A-Z]|^-/.test(s)) || /^[$>#%] /.test(s) || /^[\w.-]+\(.*\)$/.test(s) || /^(https?|file):\/\//.test(s); };
  function needs(s, to) {
    if (s.length < 2 || codeLike(s) || !/[A-Za-z\u00c0-\u024f\u0400-\u04ff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(s)) return false;
    if (to === "zh") return !HAN.test(s) && (WORD.test(s) || KANA.test(s) || HANGUL.test(s));
    if (to === "ja") return !KANA.test(s) && (WORD.test(s) || HAN.test(s) || HANGUL.test(s));
    if (to === "ko") return !HANGUL.test(s) && (WORD.test(s) || HAN.test(s) || KANA.test(s));
    if (to === "en") return NONLATIN.test(s);
    return WORD.test(s) || NONLATIN.test(s); // 法、德、西：拉丁字母的多半是英文；本来就是那种语言的，模型原样交回（记成「同原文」）
  }

  // ======== 2) 本机：IndexedDB（不行就 localStorage）========
  var dbP = null, puts = 0;
  function db() {
    if (dbP) return dbP;
    dbP = new Promise(function (ok) {
      if (!window.indexedDB) return ok(null);
      var q;
      try { q = indexedDB.open("tsu-translate", 1); } catch (e) { return ok(null); }
      q.onupgradeneeded = function () { var st = q.result.createObjectStore("tr", { keyPath: "k" }); st.createIndex("t", "t"); };
      q.onsuccess = function () { ok(q.result); };
      q.onerror = q.onblocked = function () { ok(null); };
    });
    return dbP;
  }
  var LS_KEY = "tsu-tr", lsMap = null;
  function ls() { if (!lsMap) { try { lsMap = JSON.parse(localStorage.getItem(LS_KEY) || "{}") || {}; } catch (e) { lsMap = {}; } } return lsMap; }
  function lsSave() { var m = ls(), ks = Object.keys(m); if (ks.length > LS_CAP) ks.sort(function (a, b) { return m[a].t - m[b].t; }).slice(0, ks.length - LS_CAP).forEach(function (k) { delete m[k]; }); try { localStorage.setItem(LS_KEY, JSON.stringify(m)); } catch (e) { /* 满了 */ } }
  // 一次查好几条：{ key: 译文 }（没有的不在里面）；命中的刷新 t（一天最多一次）
  function localGet(keys) {
    return db().then(function (d) {
      if (!d) { var m = ls(), r0 = {}; keys.forEach(function (k) { if (m[k]) r0[k] = m[k].o; }); return r0; }
      return new Promise(function (ok) {
        var r = {}, tx = d.transaction("tr", "readwrite"), st = tx.objectStore("tr"), now = Date.now();
        keys.forEach(function (k) { var g = st.get(k); g.onsuccess = function () { var v = g.result; if (v) { r[k] = v.o; if (now - v.t > DAY) { v.t = now; st.put(v); } } }; });
        tx.oncomplete = function () { ok(r); };
        tx.onerror = tx.onabort = function () { ok(r); };
      });
    }, function () { return {}; });
  }
  function localPut(list) { // [{ k, o }]
    if (!list.length) return;
    db().then(function (d) {
      var now = Date.now();
      if (!d) { var m = ls(); list.forEach(function (x) { m[x.k] = { o: x.o, t: now }; }); lsSave(); return; }
      var tx = d.transaction("tr", "readwrite"), st = tx.objectStore("tr");
      list.forEach(function (x) { st.put({ k: x.k, o: x.o, t: now }); });
      puts += list.length;
      if (puts >= 200) { puts = 0; tx.oncomplete = function () { trim(d); }; }
    }, function () {});
  }
  function trim(d) { // 超过 CAP 条：按 t 从旧到新删到九成
    var tx = d.transaction("tr", "readwrite"), st = tx.objectStore("tr"), c = st.count();
    c.onsuccess = function () {
      var extra = c.result - Math.floor(CAP * 0.9);
      if (c.result <= CAP || extra <= 0) return;
      var cur = st.index("t").openCursor();
      cur.onsuccess = function () { var x = cur.result; if (!x || extra-- <= 0) return; x.delete(); x.continue(); };
    };
  }

  // ======== 1) 内存 + 攒批 + 发请求 ========
  // LMISS：本机查过、没有的（不再每次重画都去查本机，只等网络那边）
  var MEM = new Map(), FLY = new Set(), PEND = new Map(), RETRY = new Map(), LMISS = new Set(), pauseTill = 0, timer = 0;
  // 起来就把本机最近用过的读进内存（按 t 从新到旧，最多 WARM 条）；读完了让用到的地方重画一次
  var warmed = db().then(function (d) {
    var n = 0;
    if (!d) { var m = ls(); Object.keys(m).forEach(function (k) { if (!MEM.has(k)) { MEM.set(k, m[k].o); n++; } }); stats.warm = n; if (n) changed(); return; }
    return new Promise(function (ok) {
      var tx, cur;
      try { tx = d.transaction("tr", "readonly"); cur = tx.objectStore("tr").index("t").openCursor(null, "prev"); } catch (e) { return ok(); }
      cur.onsuccess = function () { var c = cur.result; if (!c || n >= WARM) return; var v = c.value; if (v && v.k && !MEM.has(v.k)) { MEM.set(v.k, v.o); n++; } c.continue(); };
      tx.oncomplete = tx.onerror = tx.onabort = function () { stats.warm = n; if (n) changed(); ok(); };
    });
  }, function () {});
  // 这几条试满了次数、放下了：到点了重画一次，让还没译文的再要一遍（不然没人再来要）
  var wakeT = 0, wakeAt = 0;
  function wakeAtTime(t) { if (!(t > Date.now())) return; if (wakeT && wakeAt <= t) return; clearTimeout(wakeT); wakeAt = t; wakeT = setTimeout(function () { wakeT = 0; wakeAt = 0; changed(); }, t - Date.now() + 200); }
  // 这一条现在能不能再要（放下了、还没到点的不能：等 wakeAtTime 到点重画再来）。网络暂停（限流、余额不足）不在这里管：要的照样进队，到点接着发
  function netOK(k) { var r = RETRY.get(k) || 0; if (r > Date.now()) { wakeAtTime(r); return false; } return true; }
  var ctxName = function (ctx) {
    if (!ctx) return "";
    var A = window.TSU_AGENTS, a = null;
    if (A && A.get) try { a = A.get(ctx); } catch (e) { a = null; }
    if (!a && A && A.runtime && /^c[cx]:/.test(ctx)) try { var rt = A.runtime(ctx); a = rt && rt.agent; } catch (e) { a = null; }
    return String((a && a.name) || ctx).slice(0, 120);
  };
  function text(s, ctx) {
    var to = target();
    if (!to || s == null) return s;
    var src = norm(s);
    if (!src || !needs(src, to)) return s;
    var k = keyOf(to, src);
    if (MEM.has(k)) return MEM.get(k) || s;
    if (FLY.has(k) || PEND.has(k) || (LMISS.has(k) && !netOK(k))) return s; // 在队里 / 路上，或者试满了还没到点：先照原文
    PEND.set(k, { k: k, src: src, to: to, ctx: ctx ? String(ctx) : "" });
    if (!timer) timer = setTimeout(flush, WAIT);
    return s;
  }
  // 先等起来时的预读，再查本机（内存里还没有、本机也没查过的）；查到的进内存、重画；
  // 剩下的（哪儿都没有）：交回去进队发；放下了还没到点的先不要（FLY 去掉，到点重画时再来）
  function lookLocal(all) {
    return warmed.then(function () {
      var ask = all.filter(function (x) { return !MEM.has(x.k) && !LMISS.has(x.k); });
      return (ask.length ? localGet(ask.map(function (x) { return x.k; })) : Promise.resolve({})).then(function (found) {
        var miss = [], n = 0;
        all.forEach(function (x) {
          if (MEM.has(x.k)) { FLY.delete(x.k); n++; return; }
          if (x.k in found) { MEM.set(x.k, found[x.k]); FLY.delete(x.k); n++; return; }
          LMISS.add(x.k);
          if (netOK(x.k)) miss.push(x); else FLY.delete(x.k);
        });
        stats.local += n;
        if (n) changed();
        return miss;
      });
    });
  }
  function flush() {
    timer = 0;
    var all = Array.from(PEND.values());
    PEND.clear();
    if (!all.length) return;
    all.forEach(function (x) { FLY.add(x.k); });
    lookLocal(all).then(function (miss) { enqueue(miss, "task"); });
  }
  var stats = { warm: 0, local: 0, server: 0, model: 0, requests: 0, failed: 0, limited: 0, last: "" }; // 看缓存有没有用（测试、调试用）：warm = 起来时从本机读进内存的条数；limited = 被限流几次；last = 上一次出错
  // ---- 发请求：两条队（任务标题、回复），同一种语言的不管哪个 agent 的都进同一批；同时在路上的最多：回复 2 个、任务 1 个——
  //   有在路上的时候新来的在队里攒着，回来了一起发（以前一个 agent 一批、来一条发一条：任务标题多是一条一个请求，几个 agent 一起跑，
  //   服务器每分钟 20 次一会儿就满，满了这一页的翻译整个停一分钟、到点又一起发、又满）。任务标题两批之间至少隔 2 秒。
  //   回复先发；同一条队里新的先发（刚说完的那几段先翻，旧的历史排在后面）。
  //   限流（429）：照服务器给的 retryAfter 等，东西都还在队里，到点接着发；余额不足、没登录：停 10 分钟，也还在队里。
  //   出错（5xx、超时、断网）：这一批 4 秒、12 秒、36 秒后再试，满 4 次放下（5 分钟后用到时再要）
  var QUEUE = { task: new Map(), reply: new Map() }, INFL = { task: 0, reply: 0 }, MAXF = { task: 1, reply: 2 }, LAST = { task: 0, reply: 0 }, TASK_GAP = 2000, seqN = 0, pumpT = 0, pumpAt = 0;
  function enqueue(list, kind) {
    var q = QUEUE[kind];
    list.forEach(function (x) { if (!q.has(x.k)) { x.seq = ++seqN; x.tries = 0; x.after = 0; q.set(x.k, x); } });
    if (list.length) pump();
  }
  function pumpLater(t) { if (pumpT && pumpAt <= t) return; clearTimeout(pumpT); pumpAt = t; pumpT = setTimeout(function () { pumpT = 0; pumpAt = 0; pump(); }, Math.max(0, t - Date.now())); }
  function pauseFor(ms) { pauseTill = Math.max(pauseTill, Date.now() + ms); pumpLater(pauseTill); }
  function pump() {
    var now = Date.now();
    if (now < pauseTill) return pumpLater(pauseTill);
    ["reply", "task"].forEach(function (kind) {
      var q = QUEUE[kind];
      while (INFL[kind] < MAXF[kind] && q.size) {
        if (kind === "task" && now - LAST.task < TASK_GAP) { pumpLater(LAST.task + TASK_GAP); return; }
        var ready = [], next = Infinity;
        q.forEach(function (x) { if (x.after <= now) ready.push(x); else next = Math.min(next, x.after); });
        if (!ready.length) { pumpLater(next); return; }
        ready.sort(function (a, b) { return b.seq - a.seq; });
        var to = ready[0].to, batch = [], chars = 0;
        for (var i = 0; i < ready.length; i++) {
          var x = ready[i];
          if (x.to !== to) continue;
          if (kind === "reply" ? batch.length >= R_BATCH || (batch.length && chars + x.src.length > R_CHARS) : batch.length >= BATCH) break;
          batch.push(x); chars += x.src.length;
        }
        batch.forEach(function (x) { q.delete(x.k); });
        LAST[kind] = now;
        post(batch, kind);
      }
    });
  }
  function post(list, kind) {
    stats.requests++;
    INFL[kind]++;
    var t0 = Date.now(), ctl = window.AbortController ? new AbortController() : null;
    var tmo = ctl ? setTimeout(function () { ctl.abort(); }, kind === "reply" ? 150e3 : 60e3) : 0; // 服务器那边等模型 45 秒 / 120 秒就不等了，这里再宽一点
    var names = [], seen = {}, SY = window.TSU_SYNC, hd = { "content-type": "application/json" };
    list.forEach(function (x) { var n = ctxName(x.ctx); if (n && !seen[n]) { seen[n] = 1; names.push(n); } });
    if (SY && SY.dev) hd["x-tsu-device"] = SY.dev; // 服务记录里写哪台设备
    fetch("/api/translate", { method: "POST", credentials: "same-origin", headers: hd, signal: ctl ? ctl.signal : undefined, svclog: false, // 这里自己记（带上条数、缓存命中）
      body: JSON.stringify({ to: list[0].to, items: list.map(function (x) { return x.src; }), context: names.join(", ").slice(0, 200), kind: kind === "reply" ? "reply" : undefined }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { st: r.status, j: j || {} }; }); })
      .then(function (res) { clearTimeout(tmo); settle(list, kind, res.st, res.j, t0, ""); },
        function (e) { clearTimeout(tmo); settle(list, kind, 0, {}, t0, e && e.name === "AbortError" ? "Client timeout (" + (kind === "reply" ? 150 : 60) + "s)" : String((e && e.message) || e || "network error")); });
  }
  function settle(list, kind, st, j, t0, err) {
    INFL[kind]--;
    var now = Date.now(), whole = st === 200 && !j.mock && Array.isArray(j.out) && j.out.length === list.length, keep = [], dropped = 0;
    var nrm = function (s) { return kind === "reply" ? String(s).replace(/\r/g, "").trim() : norm(s); };
    var take = function (x, o) { var v = o && o !== x.src ? o : ""; MEM.set(x.k, v); keep.push({ k: x.k, o: v }); FLY.delete(x.k); RETRY.delete(x.k); };
    if (whole) list.forEach(function (x, i) { take(x, typeof j.out[i] === "string" ? nrm(j.out[i]) : ""); });
    else if (Array.isArray(j.hits) && Array.isArray(j.out) && j.out.length === list.length) j.hits.forEach(function (i) { var x = list[i]; if (x && typeof j.out[i] === "string") take(x, nrm(j.out[i])); }); // 服务器缓存里有的照样收下
    if (whole) { stats.server += j.cached || 0; stats.model += j.translated || 0; } else stats.server += keep.length;
    var why = whole ? "" : err || j.error || (j.mock ? "no model configured" : st === 200 ? "bad response" : "HTTP " + st);
    if (why) stats.last = why;
    var SL = window.TSU_SVCLOG;
    if (SL && SL.rec) SL.rec({ svc: "translate", op: kind === "reply" ? "reply" : "tasks", at: t0, ms: now - t0, st: st, err: why, n: list.length, info: { lang: list[0].to, cached: j.cached || 0, translated: j.translated || 0, wait: j.retryAfter || 0 } });
    if (!whole) {
      var hold = st === 429 || st === 401 || st === 402 || st === 403;
      if (st === 429) { stats.limited++; pauseFor(Math.min(60e3, Math.max(1000, +j.retryAfter || 15e3))); }
      else if (hold) pauseFor(600e3);
      list.forEach(function (x) {
        if (MEM.has(x.k)) return;
        if (hold) { QUEUE[kind].set(x.k, x); return; } // 还在队里：到点接着发（不算次数）
        if (j.mock || ++x.tries >= 4) { FLY.delete(x.k); RETRY.set(x.k, now + (j.mock ? 60e3 : 300e3)); stats.failed++; dropped++; return; } // 放下：过会儿用到时再要
        x.after = now + 4e3 * Math.pow(3, x.tries - 1); QUEUE[kind].set(x.k, x); // 4 秒、12 秒、36 秒后再试
      });
      if (dropped) wakeAtTime(now + (j.mock ? 60e3 : 300e3));
    }
    localPut(keep);
    if (keep.length) changed();
    pump();
  }
  // 有新译文：用到的地方重画（攒一下，一次）。不用 requestAnimationFrame：窗口被挡住时它不走，译文到了也不重画
  var subs = [], raf = 0, langFlip = false;
  function changed() {
    if (raf) return;
    raf = setTimeout(function () {
      raf = 0;
      if (window.STUDIO && STUDIO.familyChanged) try { STUDIO.familyChanged(); } catch (e) { console.error(e); }
      var T = window.TSU_TERM;
      // 终端样式的会话：只重画译文有变化的那几问（retranslate）；别的整段重画
      if (T && T.panes) T.panes().forEach(function (p) { if (!p || !p.program || !p.program.agentId) return; if (p.program.retranslate && !langFlip) p.program.retranslate(); else if (p.renderLater) p.renderLater(); });
      langFlip = false;
      subs.slice().forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } });
    }, 16);
  }
  // 换了语言 / 开关：用到的地方重画（译文按新的语言现取）
  var lastTo = null;
  var lastRTo = null;
  setInterval(function () {
    var t = target(), rt0 = rTarget();
    if (t === lastTo && rt0 === lastRTo) return;
    var first = lastTo === null;
    lastTo = t; lastRTo = rt0;
    [["task", t], ["reply", rt0]].forEach(function (w) { QUEUE[w[0]].forEach(function (x, k) { if (x.to !== w[1]) { QUEUE[w[0]].delete(k); FLY.delete(k); } }); }); // 队里还没发的、旧语言的不要了
    if (!first) { langFlip = true; changed(); }
  }, 1000); // 换了语言 / 开关：整段重画

  // ======== 回复翻译（agent 设置里的 translateReplies：off | display | zh | en …）========
  //   翻的是 Agent 说的话（● 那几段、过程说明、最终回复）；不翻工具的调用 / 输出、你说的话。按 markdown 的块翻：段落、列表的一项、标题、引用各一块；
  //   代码块、表格、分隔线原样，行内代码、链接、路径交给模型原样留着（提示词里要求）。每一块单独缓存（同上面三层；本机 key 的语言前面多个 r，和任务标题分开；
  //   服务器那边 kind: "reply"）。一段话的每一块都有译文了才整段换上（没齐之前照原文：不半中半英、不跳）；在流的那段（还没说完）不翻，说完了再翻
  var RPREV = null, RPEND = new Map(), rtimer = 0, R_BATCH = 20, R_CHARS = 6000;
  var rMode = function () { var A = window.TSU_AGENTS, c = (A && A.cfg) || {}; return c.translateReplies || "off"; };
  function rTarget() {
    var m = RPREV !== null ? RPREV : rMode();
    if (m === "off" || !m) return "";
    if (m === "display") return (window.TSU_I18N && TSU_I18N.lang && TSU_I18N.lang()) === "en" ? "en" : "zh";
    return LANGS.indexOf(m) >= 0 ? m : "";
  }
  // 切块：{ keep: true, raw } 原样；{ pre: 前缀（「- 」「## 」「> 」「1. 」）, body: 要翻的字, raw: 原来那几行 }
  function mdBlocks(md) {
    var lines = String(md || "").replace(/\r/g, "").split("\n"), out = [], i = 0, para = null, m;
    var endPara = function () { if (para) { out.push({ pre: "", body: para.join(" "), raw: para.join("\n") }); para = null; } };
    while (i < lines.length) {
      var l = lines[i];
      if (/^\s*(```|~~~)/.test(l)) { // 代码块：原样（到配对的那一行为止）
        endPara();
        var fence = /^\s*(```|~~~)/.exec(l)[1], blk = [l];
        i++;
        while (i < lines.length) { blk.push(lines[i]); if (lines[i].trim().indexOf(fence) === 0) { i++; break; } i++; }
        out.push({ keep: true, raw: blk.join("\n") });
        continue;
      }
      if (!l.trim() || /^\s*\|/.test(l) || /^\s*([-*_]\s*){3,}$/.test(l)) { endPara(); out.push({ keep: true, raw: l }); i++; continue; } // 空行、表格、分隔线
      m = /^(\s*#{1,6}\s+)(.*)$/.exec(l) || /^(\s*>\s?)(.*)$/.exec(l) || /^(\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)(.*)$/.exec(l);
      if (m) { endPara(); out.push({ pre: m[1], body: m[2], raw: l, item: /[-*+\d]/.test(m[1]) }); i++; continue; }
      var last = out[out.length - 1];
      if (!para && last && last.item && /^\s{2,}\S/.test(l)) { last.body += " " + l.trim(); last.raw += "\n" + l; i++; continue; } // 列表那一项接着的行
      (para = para || []).push(l.trim()); i++;
    }
    endPara();
    return out;
  }
  // 这一块要不要翻：去掉行内代码、网址以后，看目标语言的字占多少
  function needsR(s, to) {
    var t = String(s).replace(/`[^`]*`/g, " ").replace(/https?:\/\/\S+/g, " ").replace(/\]\([^)]*\)/g, "]");
    var han = (t.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length, kana = (t.match(/[\u3040-\u30ff]/g) || []).length, hangul = (t.match(/[\uac00-\ud7af]/g) || []).length, lat = (t.match(/[A-Za-z\u00c0-\u024f]/g) || []).length;
    var n = han + kana + hangul + lat;
    if (n < 2 || (lat && !han && !kana && !hangul && !/[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(t) && lat < 12)) return false; // 没几个字、就一两个英文词（多半是名字、标识符）
    // 中文：只翻「英文为主」的——按英文单词数（不按字母数）比中文字数：一段中文里夹着 live.js、renderStatus、queue 这些词的，
    //   字母一多按字母算就像英文（会中翻中）。文件名、路径、驼峰、带数字的这些标识符不算单词；中文字不到英文词的八成才算英文
    if (to === "zh") {
      var wds = (t.replace(/[\w-]*[._\/\\][\w./\\-]*/g, " ").replace(/\b[a-z]+[A-Z]\w*\b|\b\w*\d\w*\b|\b[A-Z0-9_]{2,}\b/g, " ").match(/\b[A-Za-z][a-z]{1,}\b/g) || []).length;
      if (wds < 3) return false; // 就一两个英文词：多半是名字、标识符
      var hq = (t.replace(/「[^」]*」|“[^”]*”|"[^"]*"|『[^』]*』/g, " ").match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length; // 英文里引着的中文（「…」）不算
      return hq < wds * 0.8;
    }
    if (to === "ja") return kana / n < 0.08;
    if (to === "ko") return hangul / n < 0.3;
    if (to === "en") return (han + kana + hangul) / n > 0.2;
    return lat / n < 0.5 || /\b(the|and|with|this|that|is|are|was|for)\b/i.test(t); // 法、德、西：看着像英文的才翻
  }
  // 整段的译文：每一块都有了才给（没有的在后台去要），不然 null（照原文）
  function reply(md, ctx) {
    var to = rTarget();
    if (!to || !md) return null;
    var bl = mdBlocks(md), out = [], miss = false, any = false;
    bl.forEach(function (b) {
      if (b.keep) { out.push(b.raw); return; }
      var src = b.body.trim();
      if (!needsR(src, to)) { out.push(b.raw); return; }
      any = true;
      var k = keyOf("r" + to, src);
      if (MEM.has(k)) { var v = MEM.get(k); out.push(v ? b.pre + v : b.raw); return; }
      miss = true;
      if (FLY.has(k) || RPEND.has(k) || (LMISS.has(k) && !netOK(k))) return; // 在队里 / 路上，或者试满了还没到点：等译文到了、到点再来
      RPEND.set(k, { k: k, src: src, to: to, ctx: ctx ? String(ctx) : "" });
      if (!rtimer) rtimer = setTimeout(rflush, WAIT);
    });
    return any && !miss ? out.join("\n") : null;
  }
  // 这一段要翻、还有没翻好的（「只显示译文」时先不露原文）
  function replyPending(md) {
    var to = rTarget();
    if (!to || !md) return false;
    return mdBlocks(md).some(function (b) { if (b.keep) return false; var src = b.body.trim(); return needsR(src, to) && !MEM.has(keyOf("r" + to, src)); });
  }
  function rflush() {
    rtimer = 0;
    var all = Array.from(RPEND.values());
    RPEND.clear();
    if (!all.length) return;
    all.forEach(function (x) { FLY.add(x.k); });
    lookLocal(all).then(function (miss) { enqueue(miss, "reply"); }); // 一批最多 20 段、6000 字（pump 里分）
  }

  window.TSU_TRANSLATE = {
    text: text, target: target, onChange: function (fn) { subs.push(fn); },
    // 译文和原文都要的地方（HTML 里 title 放原文）：{ t: 显示的字, o: 原文或 "" }
    pair: function (s, ctx) { var t = text(s, ctx); return { t: t, o: t !== s ? String(s) : "" }; },
    stats: function () { return Object.assign({ mem: MEM.size, queued: QUEUE.task.size + QUEUE.reply.size, inflight: INFL.task + INFL.reply, paused: Math.max(0, pauseTill - Date.now()) }, stats); },
    preview: function (m) { PREV = m == null ? null : String(m); changed(); },
    reply: reply, replyPending: replyPending, replyTarget: rTarget, blocks: mdBlocks,
    previewReplies: function (m) { RPREV = m == null ? null : String(m); changed(); },
    langs: LANGS,
  };
})();
