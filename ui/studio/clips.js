// clips.js —— 收藏：对话里右键一条消息「收藏」（整条：你说的那一问，或 agent 的回答），同微信、飞书的收藏；右键「标记这里」在那一问上打一个标记。
//   记下那条消息原样的一份（不改）和它从哪来——哪个连接器、哪段会话（id、名字、目录）、哪一问（记录里的 uuid、第几问、那句话的时间）、谁说的、哪台设备、什么时候收的——
//   跟着账号同步到每台设备（同 agent 的记录，ns = "clip"）。「收藏」App：左边按种类、连接器分，中间一张张卡片（回答按 Markdown 排好），右边是选中那条的全文和出处；
//   「跳到原处」打开那段会话、滚到那一问、亮一下；复制为引用（带出处，贴到哪儿都知道原来在哪）；插进正在用的输入框（喂回给 agent：它压缩过、你自己也忘了的那些中间结论）。
//   标记：那一问左边一道橙色的线（对话里），收藏里同样列着、能跳过去。以前「摘录本」里收的一段段字照旧在（type = "clip"）
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
  // 收：type = "msg"（一整条消息）/ "flag"（一处标记）/ "clip"（以前摘录本里的一段字）；src = 出处（见上）；md = 按 Markdown 排（agent 的回答）
  function add(type, text, src, note, md) {
    var ty = type === "flag" ? "flag" : type === "msg" ? "msg" : "clip";
    return put({ id: rid(), type: ty, text: String(text || "").replace(/\s+$/, "").slice(0, 200000), md: !!md, note: note || "", src: src || {}, created: Date.now(), dev: devName() });
  }
  function list() { return Object.keys(all).map(function (k) { return all[k]; }).sort(function (a, b) { return (b.created || 0) - (a.created || 0); }); }
  var sameMsg = function (a, b) { return !!a && !!b && a.agent === b.agent && (a.uuid ? a.uuid === b.uuid : !!a.at && a.at === b.at) && (a.role || "") === (b.role || ""); };
  // 这一条已经收藏了吗（右键菜单里写「取消收藏」）
  function favOf(src) { return list().filter(function (r) { return r.type === "msg" && sameMsg(r.src, src); })[0] || null; }
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
  // 跳到原处：打开那段会话（开着就切过去）、找到那一问（Claude Code 的不在读进来的那段里：从它前面一点重新读）、滚过去、亮一下
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
      if (p && tn && p.program && p.program.reveal && p.program.reveal(tn, r.type === "clip" ? needle : "", 1, r.type === "clip" ? String(r.text || "").slice(0, 200) : "")) return;
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
    list: list, get: function (id) { return all[id] || null; }, add: add, remove: remove, remote: remote, flagsFor: flagsFor, favOf: favOf,
    setNote: function (id, note) { var r = all[id]; if (!r) return; r.note = String(note || ""); r.edited = Date.now(); put(r); },
    reference: reference, jump: jump, insert: insert, srcLine: srcLine, when: when,
    watch: function (f) { subs.push(f); return function () { subs = subs.filter(function (g) { return g !== f; }); }; },
  };

  // ======== 「收藏」App ========
  var S = window.STUDIO;
  if (!S || !S.pages || !S.openPage) return;
  var LOGO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M12 3.6l2.55 5.17 5.7.83-4.13 4.02.98 5.68L12 16.62l-5.1 2.68.98-5.68L3.75 9.6l5.7-.83z"/></svg>';
  var FLAG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 14V2.5"/><path d="M3.5 3h8.2l-1.8 3 1.8 3H3.5" fill="currentColor" fill-opacity=".25"/></svg>';
  var IC = {
    all: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M8 2.2l1.75 3.55 3.9.57-2.83 2.76.67 3.89L8 11.13l-3.49 1.84.67-3.89L2.35 6.32l3.9-.57z"/></svg>',
    user: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>',
    reply: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M3 4h10M3 7h10M3 10h7M3 13h4"/></svg>',
    flag: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 14V2.5"/><path d="M3.5 3h8.2l-1.8 3 1.8 3H3.5"/></svg>',
    jump: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2.5h4v4M13.5 2.5L7.8 8.2M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3"/></svg>',
    back: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5L5.5 8l4.5 4.5"/></svg>',
  };
  var KINDS = ["cc", "cx", "pi", "ty", "pm"];
  var logoOf = function (k) { var L = window.TSU_LOGOS || {}; return k === "cc" ? L.claude || "" : k === "cx" ? L.codex || "" : k === "pm" ? L.paimon || "" : ""; };
  var roleOf = function (r) { return r.type === "flag" ? "flag" : (r.src && r.src.role) === "user" ? "user" : "reply"; };
  // agent 的回答：同对话里那样画（终端的样子：代码块上色、折行对齐），用对话的 Markdown 渲染（同 live.js / dash.js），不自己糊一套 HTML
  var termLight = function () { try { return !!(window.TSU_TERM && TSU_TERM.termLight && TSU_TERM.termLight()); } catch (e) { return false; } };
  var termMd = function (md, width) {
    var light = termLight(), theme = light ? "light" : "dark", w = width || 84, lines;
    try { lines = window.TSU_MD && TSU_MD.lines ? TSU_MD.lines(md, { width: w, theme: theme }) : (window.TTU && TTU.markdownLines ? TTU.markdownLines(md, { width: w, theme: theme }) : String(md || "").split("\n")); }
    catch (e) { lines = String(md || "").split("\n"); }
    var h = window.TTU && TTU.ansiToHtml ? TTU.ansiToHtml(lines.join("\n"), theme, { widthOf: TTU.visibleWidth, links: true }) : esc(md);
    return '<div class="fv-term' + (light ? " tl" : "") + '"><pre class="term terminal-style-ui">' + h + "</pre></div>";
  };
  var termAsk = function (text) { // 你说的话：同对话里（灰底，字白）
    return '<div class="fv-term"><pre class="term terminal-style-ui"><span class="ask">' + esc(text) + "</span></pre></div>";
  };
  var Q = { q: "", f: "", sel: "" }; // f：全部 "" / user / reply / flag / kind:cc …（来源）；sel：选中的那一条
  var hosts = [];
  function filtered() {
    var q = Q.q.trim().toLowerCase();
    return list().filter(function (r) {
      var s = r.src || {};
      if (Q.f === "user" || Q.f === "reply" || Q.f === "flag") { if (roleOf(r) !== Q.f) return false; }
      else if (/^kind:/.test(Q.f)) { var k = Q.f.slice(5); if (k === "other") { if (!s.kind || KINDS.indexOf(s.kind) >= 0) return false; } else if (s.kind !== k) return false; }
      return !q || [r.text, r.note, s.title, s.cwd, s.label].join(" ").toLowerCase().indexOf(q) >= 0;
    });
  }
  function navHtml() {
    var L = list(), n = function (f) { return L.filter(f).length; };
    var row = function (f, ic, label, c) { return c || !f || /^(user|reply|flag)$/.test(f) ? '<button type="button" class="fv-nv' + (Q.f === f ? " on" : "") + '" data-f="' + f + '"><i>' + ic + "</i><span>" + esc(label) + "</span><em>" + c + "</em></button>" : ""; };
    var rows = KINDS.map(function (k) { var c = n(function (r) { return (r.src || {}).kind === k; }); return c ? row("kind:" + k, logoOf(k) || IC.reply, KIND[k], c) : ""; });
    var other = n(function (r) { var k = (r.src || {}).kind; return k && KINDS.indexOf(k) < 0; }); // 不认识的新连接器：归到「其他」
    if (other) rows.push(row("kind:other", IC.reply, t("其他", "Other"), other));
    var kinds = rows.join("");
    return row("", IC.all, t("全部", "All"), L.length) + row("user", IC.user, t("你的消息", "Your messages"), n(function (r) { return roleOf(r) === "user"; })) +
      row("reply", IC.reply, t("回复", "Replies"), n(function (r) { return roleOf(r) === "reply"; })) + row("flag", IC.flag, t("标记", "Flags"), n(function (r) { return r.type === "flag"; })) +
      (kinds ? '<div class="fv-nvh">' + esc(t("来源", "Sources")) + "</div>" + kinds : "");
  }
  var kindName = function (s) { return KIND[s.kind] || (s.kind ? s.kind : t("其他", "Other")); };
  function cardHtml(r) {
    var s = r.src || {}, ro = roleOf(r);
    var body = ro === "flag" ? '<div class="fv-flag"><i>' + FLAG + "</i><span>" + esc(r.text || s.label || t("一处标记", "A flag")) + "</span></div>" :
      ro === "user" ? termAsk(r.text) : termMd(r.text, 40);
    return '<article class="fv-card' + (Q.sel === r.id ? " on" : "") + '" data-id="' + esc(r.id) + '" tabindex="-1">' +
      '<header><span class="fv-lg">' + (logoOf(s.kind) || "") + '</span><b>' + esc(s.title || kindName(s)) + "</b><time>" + esc(when(r.created)) + "</time></header>" +
      '<div class="fv-who">' + esc(ro === "user" ? t("你", "You") : ro === "flag" ? t("标记", "Flag") : t("回复", "Reply")) + "</div>" + '<div class="fv-prev">' + body + "</div>" +
      (r.note ? '<div class="fv-cnote">' + esc(r.note) + "</div>" : "") + "</article>";
  }
  function detailHtml(r) {
    if (!r) return '<div class="fv-none">' + esc(t("选择一条", "Select an item")) + "</div>";
    var s = r.src || {}, ro = roleOf(r);
    var row = function (k, v) { return v ? "<dt>" + esc(k) + "</dt><dd>" + esc(v) + "</dd>" : ""; };
    var body = ro === "flag" ? '<div class="fv-flag big"><i>' + FLAG + "</i><span>" + esc(r.text || s.label || "") + "</span></div>" :
      '<div class="fv-full">' + (ro === "user" ? termAsk(r.text) : termMd(r.text, 84)) + "</div>";
    return '<div class="fv-dt"><button type="button" class="fv-back" data-a="back">' + IC.back + "<span>" + esc(t("收藏", "Favorites")) + "</span></button>" +
      '<div class="fv-dh"><span class="fv-lg">' + (logoOf(s.kind) || "") + "</span><div><b>" + esc(s.title || kindName(s)) + "</b><span>" +
      esc([kindName(s), s.at ? when(s.at) : ""].filter(Boolean).join(" · ")) + "</span></div></div>" +
      '<div class="fv-acts"><button type="button" data-a="jump" class="fv-primary">' + IC.jump + "<span>" + esc(t("跳到原处", "Go to source")) + '</span></button><button type="button" data-a="ref">' + esc(t("复制为引用", "Copy as quote")) +
      '</button><button type="button" data-a="copy">' + esc(t("复制", "Copy")) + '</button><button type="button" data-a="insert">' + esc(t("插入到输入框", "Insert")) + '</button><span class="fv-fill"></span><button type="button" data-a="del" class="fv-del">' +
      esc(ro === "flag" ? t("取消标记", "Remove flag") : t("取消收藏", "Remove")) + "</button></div>" + body +
      '<div class="fv-note" contenteditable="plaintext-only" data-note="' + esc(r.id) + '" data-ph="' + esc(t("备注", "Note")) + '">' + esc(r.note || "") + "</div>" +
      '<dl class="fv-meta">' + row(t("会话", "Session"), s.title) + row(t("目录", "Folder"), s.cwd) + row(t("时间", "Time"), s.at ? when(s.at) : "") + row(t("收藏于", "Saved"), when(r.created)) + "</dl></div>";
  }
  function paint(host) {
    var items = filtered();
    if (Q.sel && !all[Q.sel]) Q.sel = "";
    var sel = Q.sel ? all[Q.sel] : null;
    var empty = !list().length;
    var html = '<div class="fv' + (sel ? " has-sel" : "") + '"><aside class="fv-nav"><h1>' + esc(t("收藏", "Favorites")) + '</h1><input class="fv-q" type="search" placeholder="' + esc(t("搜索", "Search")) + '" value="' + esc(Q.q) + '">' +
      '<nav class="fv-nvs">' + navHtml() + "</nav></aside>" +
      '<section class="fv-list">' + (empty ? '<div class="fv-empty"><i>' + LOGO + "</i><b>" + esc(t("暂无收藏", "No favorites yet")) + "</b><span>" + esc(t("在对话里右键一条消息，选「收藏」", "Right-click a message → Favorite")) + "</span></div>" :
        !items.length ? '<div class="fv-empty"><span>' + esc(t("没有符合的", "Nothing matches")) + "</span></div>" : items.map(cardHtml).join("")) + "</section>" +
      '<section class="fv-detail">' + (empty ? "" : detailHtml(sel)) + "</section></div>";
    if (host.dataset.h === html) return;
    var focused = document.activeElement && host.contains(document.activeElement) ? document.activeElement : null;
    if (focused && focused.matches("[data-note]")) return; // 正在写备注：不打断（失焦时存、再画）
    var had = focused && focused.classList.contains("fv-q"), pos = had ? focused.selectionStart : 0;
    var lst = host.querySelector(".fv-list"), top = lst ? lst.scrollTop : 0;
    host.dataset.h = html; host.innerHTML = html;
    var l2 = host.querySelector(".fv-list"); if (l2) l2.scrollTop = top;
    if (had) { var qi = host.querySelector(".fv-q"); qi.focus(); qi.setSelectionRange(pos, pos); }
  }
  function wire(host, P) {
    host.addEventListener("input", function (e) { if (e.target.classList && e.target.classList.contains("fv-q")) { Q.q = e.target.value; paint(host); } });
    host.addEventListener("focusout", function (e) { var n = e.target.closest && e.target.closest("[data-note]"); if (n) { var r = all[n.dataset.note]; if (r && (r.note || "") !== n.textContent) window.TSU_CLIPS.setNote(r.id, n.textContent); setTimeout(function () { paint(host); }, 0); } });
    host.addEventListener("keydown", function (e) {
      var n = e.target.closest && e.target.closest("[data-note]");
      if (n) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); n.blur(); } return; }
      if (e.target.classList && e.target.classList.contains("fv-q")) return;
      var items = filtered(), i = items.map(function (r) { return r.id; }).indexOf(Q.sel);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); var j = Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1))); if (items[j]) { Q.sel = items[j].id; paint(host); var c = host.querySelector('.fv-card[data-id="' + Q.sel + '"]'); if (c) c.scrollIntoView({ block: "nearest" }); } }
      else if (e.key === "Enter" && Q.sel && all[Q.sel]) jump(all[Q.sel], P.win);
    });
    host.addEventListener("click", function (e) {
      var nv = e.target.closest("[data-f]");
      if (nv) { Q.f = nv.dataset.f; return paint(host); }
      var card = e.target.closest(".fv-card");
      if (card) { Q.sel = card.dataset.id; paint(host); host.focus({ preventScroll: true }); return; }
      var b = e.target.closest("[data-a]");
      if (!b) return;
      var a = b.dataset.a, r = Q.sel ? all[Q.sel] : null;
      if (a === "back") { Q.sel = ""; return paint(host); }
      if (!r) return;
      var copy = function (s) { if (navigator.clipboard) navigator.clipboard.writeText(s).catch(function () { if (window.nadosNative) nadosNative.call("clipboard.write", { text: s }).catch(function () {}); }); b.classList.add("done"); setTimeout(function () { b.classList.remove("done"); }, 900); };
      if (a === "jump") return jump(r, P.win);
      if (a === "insert") return insert(r, P.win);
      if (a === "ref") return copy(reference(r));
      if (a === "copy") return copy(r.text || "");
      if (a === "del") { remove(r.id); Q.sel = ""; return; }
    });
    host.addEventListener("dblclick", function (e) { var card = e.target.closest(".fv-card"); if (card && all[card.dataset.id]) jump(all[card.dataset.id], P.win); });
  }
  S.pages.clips = {
    title: function () { return t("收藏", "Favorites"); },
    address: function () { return "favorites.local.paimon"; },
    icon: function () { return LOGO; },
    render: function (host, P, arg, V) {
      host.classList.add("st-pg-clips");
      if (!host.hasAttribute("tabindex")) host.tabIndex = -1;
      if (!V.inited) { V.inited = true; wire(host, P); hosts.push(host); }
      paint(host);
    },
  };
  window.TSU_CLIPS.watch(function () { hosts = hosts.filter(function (h) { return h.isConnected; }); hosts.forEach(paint); });
  if (S.apps && S.apps.add) S.apps.add({
    id: "clips", builtin: true, name: function () { return t("收藏", "Favorites"); },
    desc: function () { return t("对话里收藏的消息和标记", "Messages and flags saved from conversations"); },
    logo: function () { return LOGO; },
    find: function (tw) { var hit = null; (tw && tw.ws && tw.ws.all ? tw.ws.all() : []).forEach(function (p) { if (!hit && p.program && p.program.page === "clips") hit = p; }); return hit; },
    open: function (tw) { return S.openPage(tw, "clips", ""); },
  });
})();
