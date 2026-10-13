// clips.js —— 摘录本：对话里选一段，右键「收藏到摘录本」；或者在某一处右键「标记这里」（不选字）。
//   记下原文（不改的一份，同书摘）和它从哪来——哪个连接器、哪段会话（id、名字、目录）、哪一问（记录里的 uuid、第几问、那句话的时间）、谁说的、哪台设备、什么时候收的——
//   跟着账号同步到每台设备（同 agent 的记录，ns = "clip"）。「摘录本」App：按来源分组看、搜、只看标记；「跳到原处」打开那段会话、滚到那一处、亮一下；
//   复制为引用（带出处，贴到哪儿都知道原来在哪）、插进正在用的输入框（喂回给 agent：它压缩过、你自己也忘了的那些中间结论）。
//   标记：那一问左边一道橙色的线（对话里），摘录本里同样列着、能跳过去
(function () {
  "use strict";
  if (window.TSU_CLIPS) return;
  var I18N = window.TSU_I18N;
  var t = function (zh, en) { return I18N && I18N.lang && I18N.lang() === "en" ? en : zh; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var KEY = "vs-clips";
  var all = (function () { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; } })();
  var subs = [];
  var save = function () { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) { /* 满了 */ } };
  var fire = function () { subs.slice().forEach(function (f) { try { f(); } catch (e) { console.error(e); } }); document.dispatchEvent(new Event("vs-clips")); };
  var rid = function () { var a = new Uint8Array(5); crypto.getRandomValues(a); return "c" + Date.now().toString(36) + Array.prototype.map.call(a, function (x) { return (x % 36).toString(36); }).join(""); };
  function push(id) {
    var SY = window.TSU_SYNC;
    if (SY && SY.push) SY.push([{ ns: "clip", id: id, data: all[id] ? JSON.stringify(all[id]) : null }]).catch(function () { /* 下次改动时再推 */ });
  }
  function put(rec) { all[rec.id] = rec; save(); push(rec.id); fire(); return rec; }
  function remove(id) { if (!all[id]) return; delete all[id]; save(); push(id); fire(); }
  // 别的设备收的、改的（agents.js 拉到 ns = "clip" 的记录交过来）
  function remote(id, data) {
    if (data == null) { if (!all[id]) return; delete all[id]; }
    else { var o; try { o = JSON.parse(data); } catch (e) { return; } if (JSON.stringify(all[id]) === data) return; all[id] = o; }
    save(); fire();
  }
  var devName = function () { var SY = window.TSU_SYNC; try { return SY && SY.name ? SY.name() : ""; } catch (e) { return ""; } };
  // 收：type = "clip"（一段字）/ "flag"（一处标记）；src = 出处（见上）
  function add(type, text, src, note) {
    return put({ id: rid(), type: type === "flag" ? "flag" : "clip", text: String(text || "").replace(/\s+$/, "").slice(0, 60000), note: note || "", src: src || {}, created: Date.now(), dev: devName() });
  }
  function list() { return Object.keys(all).map(function (k) { return all[k]; }).sort(function (a, b) { return (b.created || 0) - (a.created || 0); }); }
  // 这段会话里的标记：对话里那一问左边画一道线
  function flagsFor(agentId) { return list().filter(function (r) { return r.type === "flag" && r.src && r.src.agent === agentId; }); }
  var KIND = { cc: "Claude Code", cx: "Codex", pi: "pi", ty: "Teyvat", pm: "Paimon" };
  var when = function (ms) { if (!ms) return ""; var d = new Date(ms); return t((d.getMonth() + 1) + "月" + d.getDate() + "日 ", d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " ") + ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); };
  var srcLine = function (r) { var s = r.src || {}; return [KIND[s.kind] || "", s.title ? "「" + s.title + "」" : "", s.at ? when(s.at) : ""].filter(Boolean).join(" · "); };
  // 复制为引用：原文一行行 > 引起来，下面一行出处（连接器、会话、时间、会话 id）——贴到别的对话、笔记里也知道从哪来
  function reference(r) {
    var s = r.src || {}, q = String(r.text || "").split("\n").map(function (l) { return "> " + l; }).join("\n");
    return q + "\n> — " + [srcLine(r), s.session ? "session " + s.session : "", s.cwd || ""].filter(Boolean).join(" · ");
  }
  // 跳到原处：打开那段会话（开着就切过去）、找到那一问（Claude Code 的不在读进来的那段里：从它前面一点重新读）、滚过去、那几个字亮一下
  function jump(r, tw) {
    var s = r.src || {}, aid = s.agent;
    if (!aid) return;
    tw = tw || (window.TSU_TERM && TSU_TERM.front ? TSU_TERM.front() : null);
    if (!tw) return;
    var paneOf = function () { var hit = null; (tw.ws.all ? tw.ws.all() : []).forEach(function (p) { if (!hit && p.program && p.program.agentId === aid) hit = p; }); return hit; };
    if (!paneOf()) {
      if (/^cc:/.test(aid) && tw.side && tw.side.viewCC) tw.side.viewCC(s.session || aid.slice(3));
      else if (window.TSU_TERM && TSU_TERM.agent) TSU_TERM.agent(aid);
    } else { var p0 = paneOf(); if (tw.ws.show) tw.ws.show(p0); else if (tw.ws.activate) tw.ws.activate(p0); }
    var needle = String(r.text || "").replace(/\s+/g, " ").trim().slice(0, 40), loaded = false, n = 0;
    (function go() {
      var p = paneOf(), rt = null;
      try { rt = window.TSU_AGENTS ? TSU_AGENTS.runtime(aid) : null; } catch (e) { rt = null; }
      var turns = rt && rt.session ? rt.session().turns || [] : [], tn = null;
      if (s.uuid) tn = turns.filter(function (x) { return x.uuid === s.uuid; })[0] || (rt && rt.turnOf ? rt.turnOf(s.uuid) : null);
      if (!tn && s.at) tn = turns.filter(function (x) { return x.at === s.at; })[0];
      if (!tn && s.turn != null && !s.uuid) tn = turns[s.turn];
      if (p && tn && p.program && p.program.reveal && p.program.reveal(tn, needle, 1, String(r.text || "").slice(0, 200))) return;
      if (!tn && !loaded && rt && rt.reveal && s.uuid && n > 4) { loaded = true; rt.reveal(s.uuid, s.offset || 0); } // 不在读进来的那段里
      if (++n < 60) setTimeout(go, 150);
    })();
  }
  // 插进正在用的那个输入框（终端界面的 p.ta、图形界面自己的 insertText）
  function insert(r, tw) {
    tw = tw || (window.TSU_TERM && TSU_TERM.front ? TSU_TERM.front() : null);
    var p = tw && tw.ws && tw.ws.active, prog = p && p.program, txt = reference(r) + "\n\n";
    if (prog && prog.insertText) return prog.insertText(txt);
    if (p && p.ta) { p.ta.focus(); document.execCommand("insertText", false, txt); return true; }
    return false;
  }
  window.TSU_CLIPS = {
    list: list, get: function (id) { return all[id] || null; }, add: add, remove: remove, remote: remote, flagsFor: flagsFor,
    setNote: function (id, note) { var r = all[id]; if (!r) return; r.note = String(note || ""); r.edited = Date.now(); put(r); },
    reference: reference, jump: jump, insert: insert, srcLine: srcLine, when: when,
    watch: function (f) { subs.push(f); return function () { subs = subs.filter(function (g) { return g !== f; }); }; },
  };

  // ======== 「摘录本」App ========
  var S = window.STUDIO;
  if (!S || !S.pages || !S.openPage) return;
  var LOGO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 3.5h10l3 3v14h-13z"/><path d="M15.5 3.5v3h3"/><path d="M8.5 10.5h7M8.5 13.5h7M8.5 16.5h4.5"/></svg>';
  var FLAG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 14V2.5"/><path d="M3.5 3h8.2l-1.8 3 1.8 3H3.5" fill="currentColor" fill-opacity=".25"/></svg>';
  var Q = { q: "", only: "" };
  var hosts = [];
  function itemHtml(r) {
    var s = r.src || {}, isF = r.type === "flag";
    return '<article class="cl-it' + (isF ? " flag" : "") + '" data-id="' + esc(r.id) + '">' +
      (isF ? '<div class="cl-fl"><i>' + FLAG + "</i><span>" + esc(r.text || t("一处标记", "A flag")) + "</span></div>" : '<blockquote class="cl-q">' + esc(r.text) + "</blockquote>") +
      '<div class="cl-meta"><span>' + esc(srcLine(r)) + "</span>" + (s.role ? "<span>" + esc(s.role === "user" ? t("你说的", "You") : t("回答", "Reply")) + "</span>" : "") + "<span>" + esc(t("收于 ", "Saved ") + when(r.created) + (r.dev ? " · " + r.dev : "")) + "</span></div>" +
      '<div class="cl-note" contenteditable="plaintext-only" data-note="' + esc(r.id) + '" data-ph="' + esc(t("添加备注…", "Add a note…")) + '">' + esc(r.note || "") + "</div>" +
      '<div class="cl-acts"><button type="button" data-a="jump" class="cl-primary">' + esc(t("跳到原处", "Go to Source")) + '</button><button type="button" data-a="insert">' + esc(t("插入到输入框", "Insert into Input")) + '</button><button type="button" data-a="ref">' + esc(t("复制为引用", "Copy as Quote")) + '</button>' +
      (isF ? "" : '<button type="button" data-a="copy">' + esc(t("复制", "Copy")) + "</button>") + '<span class="cl-fill"></span><button type="button" data-a="del" class="cl-del">' + esc(t("删除", "Delete")) + "</button></div></article>";
  }
  function paint(host) {
    var q = Q.q.trim().toLowerCase(), items = list().filter(function (r) {
      if (Q.only && r.type !== Q.only) return false;
      return !q || [r.text, r.note, (r.src || {}).title, (r.src || {}).cwd].join(" ").toLowerCase().indexOf(q) >= 0;
    });
    // 按出处（同一段会话）分组；组按最近收的排
    var groups = [], by = {};
    items.forEach(function (r) { var k = (r.src && r.src.agent) || "?"; if (!by[k]) { by[k] = { k: k, r0: r, items: [] }; groups.push(by[k]); } by[k].items.push(r); });
    var nClip = list().filter(function (r) { return r.type !== "flag"; }).length, nFlag = list().length - nClip;
    var seg = function (v, label, n) { return '<button type="button" class="cl-seg' + (Q.only === v ? " on" : "") + '" data-only="' + v + '">' + esc(label) + (n != null ? " <em>" + n + "</em>" : "") + "</button>"; };
    var body = !list().length ? '<div class="cl-empty"><div class="cl-eic">' + LOGO + "</div><h2>" + esc(t("还没有摘录", "No Clippings Yet")) + "</h2><p>" +
      esc(t("在对话里选一段字，右键「收藏到摘录本」；或者在某一处右键「标记这里」。记下原文和它从哪来，以后在这里找得到、点一下回到原处。", "Select text in a conversation and right-click Save to Clippings, or right-click anywhere and choose Flag Here. The text and where it came from are kept here, and one click takes you back.")) + "</p></div>" :
      !groups.length ? '<div class="cl-empty"><p>' + esc(t("没有符合的", "Nothing matches")) + "</p></div>" :
      groups.map(function (g) { var s = g.r0.src || {}; return '<section class="cl-grp"><header><b>' + esc(s.title || t("一段对话", "A conversation")) + "</b><span>" + esc([KIND[s.kind] || "", s.cwd || ""].filter(Boolean).join(" · ")) + "</span><em>" + g.items.length + "</em></header>" + g.items.map(itemHtml).join("") + "</section>"; }).join("");
    var html = '<div class="cl"><div class="cl-head"><h1>' + esc(t("摘录本", "Clippings")) + '</h1><div class="cl-segs">' + seg("", t("全部", "All"), list().length) + seg("clip", t("摘录", "Clips"), nClip) + seg("flag", t("标记", "Flags"), nFlag) + "</div>" +
      '<span class="cl-fill"></span><input class="cl-q-in" type="search" placeholder="' + esc(t("搜索摘录、备注、会话", "Search clippings, notes, sessions")) + '" value="' + esc(Q.q) + '"></div>' + body + "</div>";
    if (host.dataset.h === html) return;
    var focused = document.activeElement && host.contains(document.activeElement) ? document.activeElement : null;
    if (focused && focused.matches("[data-note]")) return; // 正在写备注：不打断（写完失焦时存、再画）
    var had = focused && focused.classList.contains("cl-q-in"), pos = had ? focused.selectionStart : 0;
    host.dataset.h = html; host.innerHTML = html;
    if (had) { var qi = host.querySelector(".cl-q-in"); qi.focus(); qi.setSelectionRange(pos, pos); }
  }
  function wire(host, P) {
    host.addEventListener("input", function (e) { if (e.target.classList.contains("cl-q-in")) { Q.q = e.target.value; paint(host); } });
    host.addEventListener("focusout", function (e) { var n = e.target.closest && e.target.closest("[data-note]"); if (n) { var r = all[n.dataset.note]; if (r && (r.note || "") !== n.textContent) window.TSU_CLIPS.setNote(r.id, n.textContent); setTimeout(function () { paint(host); }, 0); } });
    host.addEventListener("keydown", function (e) { var n = e.target.closest && e.target.closest("[data-note]"); if (n && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); n.blur(); } });
    host.addEventListener("click", function (e) {
      var sg = e.target.closest("[data-only]");
      if (sg) { Q.only = sg.dataset.only; return paint(host); }
      var b = e.target.closest("[data-a]"), it = e.target.closest(".cl-it"), r = it && all[it.dataset.id];
      if (!b || !r) return;
      var a = b.dataset.a, copy = function (s) { if (navigator.clipboard) navigator.clipboard.writeText(s).catch(function () { if (window.nadosNative) nadosNative.call("clipboard.write", { text: s }).catch(function () {}); }); b.classList.add("done"); setTimeout(function () { b.classList.remove("done"); }, 900); };
      if (a === "jump") return jump(r, P.win);
      if (a === "insert") return insert(r, P.win);
      if (a === "ref") return copy(reference(r));
      if (a === "copy") return copy(r.text || "");
      if (a === "del") {
        var go = function () { remove(r.id); };
        if (window.TSU_DESK && TSU_DESK.alert) TSU_DESK.alert({ title: t("删除这条" + (r.type === "flag" ? "标记" : "摘录") + "？", "Delete this " + (r.type === "flag" ? "flag" : "clipping") + "?"), message: t("每台设备上都会删掉；原来的对话不受影响。", "It’s removed on all your devices; the original conversation isn’t affected."), icon: "caution", buttons: [{ label: t("取消", "Cancel"), role: "cancel" }, { label: t("删除", "Delete"), role: "default", run: go }] });
        else if (window.confirm("Delete?")) go();
      }
    });
  }
  S.pages.clips = {
    title: function () { return t("摘录本", "Clippings"); },
    address: function () { return "clippings.local.paimon"; },
    icon: function () { return LOGO; },
    render: function (host, P, arg, V) {
      host.classList.add("st-pg-clips");
      if (!V.inited) { V.inited = true; wire(host, P); hosts.push(host); }
      paint(host);
    },
  };
  window.TSU_CLIPS.watch(function () { hosts = hosts.filter(function (h) { return h.isConnected; }); hosts.forEach(paint); });
  if (S.apps && S.apps.add) S.apps.add({
    id: "clips", builtin: true, name: function () { return t("摘录本", "Clippings"); },
    desc: function () { return t("对话里收藏的段落和标记", "Passages and flags saved from conversations"); },
    logo: function () { return LOGO; },
    find: function (tw) { var hit = null; (tw && tw.ws && tw.ws.all ? tw.ws.all() : []).forEach(function (p) { if (!hit && p.program && p.program.page === "clips") hit = p; }); return hit; },
    open: function (tw) { return S.openPage(tw, "clips", ""); },
  });
})();
