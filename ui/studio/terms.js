// terms.js —— 有名字的终端（同 tmux 的会话）：每个终端标签页都登记在这里，关掉标签页它照跑（shell、里面的程序都不停），
//   在 Agents 视图的「终端」里找回来、重命名、结束；在 shell 里 exit 了就自己没了。
//   记在 localStorage 的 st-terms：[{ id（原生伪终端的编号）, name, cwd, at（建的时间）}]；最近一次输出的时间、前台在跑什么只在这一页里算
//   TSU_TERMS：list()、get(id)、add({ id, name, cwd })、rename(id, name)、end(id)（真的结束）、gone(id)（它自己退了）、
//     fg(id)（前台程序名，没有是 ""）、last(id)（最近一次输出）、nextName()、on(fn) → off
(function () {
  "use strict";
  var L = window.TSU_LOCAL, N = window.nadosNative;
  if (!L || !N || !N.on) { window.TSU_TERMS = null; return; }
  var KEY = "st-terms", subs = [], live = {}; // live：id → { last, fg, cwd }
  var load = function () { try { var a = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(a) ? a.filter(function (x) { return x && x.id; }) : []; } catch (e) { return []; } };
  var list = load();
  var save = function () { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* 满了 */ } };
  var emit = function () { subs.slice().forEach(function (f) { try { f(); } catch (e) { console.error(e); } }); };
  var byId = function (id) { return list.filter(function (x) { return x.id === id; })[0] || null; };
  var tr = function (zh, en) { return window.TSU_I18N && TSU_I18N.lang && TSU_I18N.lang() === "en" ? en : zh; };
  // 页面起来时：登记过的都要回来（不让原生那边 15 秒后的清理关掉它们）；原生那边已经没有的（App 重开过）从表里拿掉
  list.forEach(function (x) { L.want(x.id); });
  (L.ready || Promise.resolve()).then(function () { return N.call("pty.list"); }).then(function (ps) {
    var have = {};
    (Array.isArray(ps) ? ps : []).forEach(function (p) { if (p && p.id) have[p.id] = 1; });
    var n0 = list.length;
    list = list.filter(function (x) { return have[x.id]; });
    if (list.length !== n0) { save(); emit(); }
  }).catch(function () { /* 老版本没有 pty.list：照旧 */ });
  // 有输出：记一下时间（Agents 视图里写「刚刚有输出」）；不解码，几秒才通知一次
  var bumpT = 0;
  N.on("pty.data", function (d) {
    if (!d || !byId(d.id)) return;
    (live[d.id] = live[d.id] || {}).last = Date.now();
    if (!bumpT) bumpT = setTimeout(function () { bumpT = 0; emit(); }, 2000);
  });
  N.on("pty.exit", function (d) { if (d && byId(d.id)) gone(d.id); });
  // 前台在跑什么、在哪个目录（看得见 Agents 视图时隔几秒问一次）
  var pollT = 0;
  function poll() {
    if (document.hidden || !list.length) return;
    Promise.all(list.map(function (x) {
      return N.call("pty.cwd", { id: x.id }).then(function (r) {
        var l = live[x.id] = live[x.id] || {}, fg = r && r.fg && r.fg.name ? String(r.fg.name) : "";
        if (r && r.cwd && r.cwd !== x.cwd) { x.cwd = r.cwd; save(); }
        if (fg !== (l.fg || "")) { l.fg = fg; return true; }
        return false;
      }, function () { return false; });
    })).then(function (ch) { if (ch.some(Boolean)) emit(); });
  }
  function gone(id) { list = list.filter(function (x) { return x.id !== id; }); delete live[id]; save(); emit(); }
  var API = {
    list: function () { return list.slice(); },
    get: byId,
    add: function (o) {
      if (!o || !o.id || byId(o.id)) return byId(o && o.id);
      var x = { id: o.id, name: String(o.name || API.nextName()).slice(0, 60), cwd: o.cwd || "", at: Date.now() };
      list.push(x); L.want(x.id); save(); emit();
      return x;
    },
    rename: function (id, name) { var x = byId(id); name = String(name || "").trim().slice(0, 60); if (!x || !name) return false; x.name = name; save(); emit(); return true; },
    end: function (id) { if (!byId(id)) return; N.call("pty.close", { id: id }).catch(function () {}); gone(id); },
    gone: gone,
    fg: function (id) { return (live[id] && live[id].fg) || ""; },
    last: function (id) { return (live[id] && live[id].last) || 0; },
    // 新终端的默认名字：「终端 1」「终端 2」……（同访达新建的「未命名文件夹」，建好就让你改）
    nextName: function () { var base = tr("终端", "Terminal"), n = 1; while (list.some(function (x) { return x.name === base + " " + n; })) n++; return base + " " + n; },
    on: function (fn) { subs.push(fn); if (!pollT) pollT = setInterval(poll, 4000); return function () { subs = subs.filter(function (f) { return f !== fn; }); }; },
    poll: poll,
  };
  window.TSU_TERMS = API;
})();
