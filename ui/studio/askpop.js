// askpop.js —— 会话在问你（Claude Code 的 AskUserQuestion）而你没在看它：在当前窗口正中弹一张问题卡片（不是新窗口），
//   上面一段它问之前说的话（上下文），下面问题和选项，直接点 / 按数字回答；「打开会话」过去看全文；Esc「稍后」（底部的 awaiting input 还在）。
//   App 在后台时把窗口叫到前面（设置 › 通用 能关）。正在看的那个会话不弹（问答就在它的输入框那里）
(function () {
  "use strict";
  if (window.TSU_ASKPOP) return;
  var S = window.STUDIO;
  if (!S) return;
  var en = function () { return !!(window.TSU_I18N && TSU_I18N.lang && TSU_I18N.lang() === "en"); };
  var tr = function (zh, e) { return en() ? e : zh; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var getv = function (k) { return S.get ? S.get(k, true) : undefined; };
  var X_ICO = '<svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>';
  var seen = {}, fronted = {}, cur = null;
  var frontAid = function () { var T = window.TSU_TERM, tw = T && T.front ? T.front() : null, p = tw && tw.ws && tw.ws.active; return (p && p.program && p.program.agentId) || ""; };
  var tq = function (s, aid) { s = String(s || ""); return window.TSU_TRANSLATE && TSU_TRANSLATE.text ? TSU_TRANSLATE.text(s, aid) || s : s; };
  // 它问之前说的话：这一问里提问前面的那几段文字（最后约 700 字）
  function contextOf(rt) {
    var ts = rt.session ? rt.session().turns || [] : [], t = ts[ts.length - 1], parts = (t && t.parts) || [], out = [];
    for (var i = parts.length - 1; i >= 0; i--) { var p = parts[i]; if (p.kind === "tool" && p.name === "AskUserQuestion") { out = []; continue; } if (p.kind === "text" && p.text && !p.preview) out.unshift(p.text); if (out.join("\n").length > 900) break; }
    var md = out.join("\n\n").trim(), aid = rt.agent && rt.agent.id;
    var trd = md && window.TSU_TRANSLATE && TSU_TRANSLATE.reply ? TSU_TRANSLATE.reply(md, aid) : null;
    md = trd || md;
    return md.length > 700 ? "…" + md.slice(-700) : md;
  }
  function frontApp(qid) {
    if (fronted[qid] || getv("askFront") !== true) return; // 默认不把窗口叫到前面（打断你手上的事）；设置里能开
    fronted[qid] = 1;
    if (!document.hidden && document.hasFocus()) return;
    var N = window.nadosNative;
    if (N && N.call) N.call("app.activate").catch(function () { N.call("attention").catch(function () {}); });
  }
  function scan() {
    var A = window.TSU_AGENTS;
    if (!A || !A.runtime || !S.needsList) return;
    if (cur) { var q0 = cur.rt.question ? cur.rt.question() : null; if (!q0 || q0.id !== cur.q.id) close(false); return; } // 别处答了：收起
    if (getv("askPopup") !== true) return; // 默认不弹：会话问你时标签页图标变蓝、状态行写「awaiting input」、通知里有；想要卡片在设置里开
    var nd = S.needsList(), fa = frontAid();
    for (var i = 0; i < nd.length; i++) {
      var x = nd[i], rt = null;
      try { rt = A.runtime(x.aid); } catch (e) { rt = null; }
      var q = rt && rt.question ? rt.question() : null;
      if (!q || !q.questions || !q.questions.length || seen[q.id]) continue;
      if (rt.canAnswer && !rt.canAnswer()) continue; // 在别的终端里跑的会话：这里答不了，不弹一张答了也送不出去的卡片
      frontApp(q.id);
      if (x.aid === fa && !document.hidden) continue; // 正在看它：问答就在它自己的输入框那里
      return show(x, rt, q);
    }
  }
  function show(x, rt, q) {
    var dr = (window.TSU_ASKDRAFT || {})[q.id]; // 之前「稍后」时选了一半、写了一半的：接着
    cur = { aid: x.aid, name: x.name || "", rt: rt, q: q, qi: dr ? Math.min(dr.qi || 0, q.questions.length - 1) : 0, ans: dr && dr.ans && dr.ans.length === q.questions.length ? JSON.parse(JSON.stringify(dr.ans)) : q.questions.map(function () { return { pick: [], text: "" }; }), back: document.activeElement };
    var ov = cur.el = document.createElement("div");
    ov.className = "ap-ov";
    document.body.appendChild(ov);
    draw();
    ov.addEventListener("click", onClick);
    ov.addEventListener("keydown", onKey);
    document.addEventListener("keydown", onDocKey, true);
    var f = ov.querySelector(".ap-opt"); if (f) f.focus();
  }
  function logoOf(aid) { var Lg = window.TSU_LOGOS || {}; return /^cc:/.test(aid) ? '<span class="ap-logo cc">' + (Lg.claude || "") + "</span>" : /^cx:/.test(aid) ? '<span class="ap-logo">' + (Lg.codex || "") + "</span>" : /^pi:/.test(aid) ? '<span class="ap-logo">' + (Lg.pi || "") + "</span>" : ""; }
  function draw() {
    var c = cur, qs = c.q.questions, x = qs[c.qi], a = c.ans[c.qi], opts = x.options || [], multi = !!x.multiSelect, ctx = c.qi === 0 ? contextOf(c.rt) : "";
    var tabs = qs.length > 1 ? '<div class="ap-tabs">' + qs.map(function (y, i) { var done = c.ans[i].pick.length || c.ans[i].text; return '<span class="ap-tab' + (i === c.qi ? " on" : "") + (done ? " done" : "") + '">' + esc(tq(y.header || (tr("问题 ", "Question ") + (i + 1)), c.aid)) + "</span>"; }).join("") + "</div>" : "";
    c.el.innerHTML = '<div class="ap-card" role="dialog" aria-modal="true"><div class="ap-hd">' + logoOf(c.aid) + '<b class="ap-name">' + esc(c.name) + '</b><span class="ap-sub">' + esc(tr("在问你", "is asking you")) + '</span><span class="ap-fill"></span><button type="button" class="ap-x" data-ap="later" title="' + esc(tr("稍后（Esc）", "Later (Esc)")) + '">' + X_ICO + "</button></div>" +
      (ctx ? '<div class="ap-ctx">' + esc(ctx) + "</div>" : "") + tabs +
      '<div class="ap-q">' + esc(tq(x.question, c.aid)) + "</div>" +
      '<div class="ap-opts">' + opts.map(function (o, i) { var on = a.pick.indexOf(i) >= 0; return '<button type="button" class="ap-opt' + (on ? " on" : "") + (multi ? " multi" : "") + '" data-ap="opt" data-i="' + i + '"><span class="ap-n">' + (i + 1) + '</span><span class="ap-l"><span>' + esc(tq(o.label, c.aid)) + "</span>" + (o.description ? "<small>" + esc(tq(o.description, c.aid)) + "</small>" : "") + "</span></button>"; }).join("") +
      '<label class="ap-other"><span class="ap-n">' + (opts.length + 1) + '</span><input type="text" class="ap-in" placeholder="' + esc(tr("自己写一个回答，回车提交", "Type your own answer, then press Return")) + '" value="' + esc(a.text) + '"></label></div>' +
      '<div class="ap-ft"><button type="button" class="ap-btn" data-ap="open">' + esc(tr("打开会话", "Open Session")) + '</button><span class="ap-fill"></span><span class="ap-keys">' + esc(tr("按 1–" + (opts.length + 1) + " 选择 · Esc 稍后", "Press 1–" + (opts.length + 1) + " to choose · Esc for later")) + "</span>" +
      (multi || qs.length > 1 ? '<button type="button" class="ap-btn def" data-ap="next">' + esc(c.qi < qs.length - 1 ? tr("下一题", "Next") : tr("提交", "Submit")) + "</button>" : "") + "</div></div>";
  }
  function answerText() {
    var qs = cur.q.questions, one = function (x, a) { var labs = a.pick.map(function (i) { return (x.options[i] || {}).label || ""; }).filter(Boolean); if (a.text) labs.push(a.text); return labs.join(", "); };
    return qs.length === 1 ? one(qs[0], cur.ans[0]) : qs.map(function (x, i) { return (x.question || x.header || "Q" + (i + 1)) + " → " + (one(x, cur.ans[i]) || "(no answer)"); }).join("\n");
  }
  function next() {
    var qs = cur.q.questions;
    if (cur.qi < qs.length - 1) { cur.qi++; draw(); var f = cur.el.querySelector(".ap-opt"); if (f) f.focus(); return; }
    var text = answerText(), rt = cur.rt, qid = cur.q.id;
    seen[qid] = 1;
    close(true);
    if (rt.answerQuestion) rt.answerQuestion(text).catch(function (e) { seen[qid] = 0; if (window.TSU_DESK && TSU_DESK.alert) TSU_DESK.alert({ title: tr("回答没送出去", "Your answer wasn’t sent"), message: String(e && e.message || e), icon: "caution" }); });
  }
  function choose(i) {
    var x = cur.q.questions[cur.qi], a = cur.ans[cur.qi];
    if (x.multiSelect) { var k = a.pick.indexOf(i); if (k >= 0) a.pick.splice(k, 1); else a.pick.push(i); draw(); var b = cur.el.querySelector('.ap-opt[data-i="' + i + '"]'); if (b) b.focus(); return; }
    a.pick = [i]; a.text = "";
    next();
  }
  function onClick(e) {
    var b = e.target.closest && e.target.closest("[data-ap]");
    if (!b) { if (e.target === cur.el) close(false, true); return; }
    var k = b.dataset.ap;
    if (k === "later") close(false, true);
    else if (k === "open") { var aid = cur.aid; seen[cur.q.id] = 1; close(false); if (window.TSU_TERM && TSU_TERM.agent) TSU_TERM.agent(aid); }
    else if (k === "opt") choose(+b.dataset.i);
    else if (k === "next") { var inp = cur.el.querySelector(".ap-in"); if (inp && inp.value.trim()) cur.ans[cur.qi].text = inp.value.trim(); next(); }
  }
  function onKey(e) {
    if (e.target.classList && e.target.classList.contains("ap-in")) {
      if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); var v = e.target.value.trim(); if (!v) return; var a = cur.ans[cur.qi]; a.text = v; if (!cur.q.questions[cur.qi].multiSelect) a.pick = []; next(); }
      return;
    }
    var n = (cur.q.questions[cur.qi].options || []).length;
    if (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey) { var i = +e.key - 1; e.preventDefault(); if (i < n) choose(i); else if (i === n) { var inp = cur.el.querySelector(".ap-in"); if (inp) inp.focus(); } }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); var all = Array.prototype.slice.call(cur.el.querySelectorAll(".ap-opt, .ap-in")), at = all.indexOf(document.activeElement); var nx = all[Math.max(0, Math.min(all.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))]; if (nx) nx.focus(); }
  }
  function onDocKey(e) { if (cur && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(false, true); } }
  function close(answered, later) {
    if (!cur) return;
    if (later) { // 稍后：这一问不再弹（底部的 awaiting input 还在，点它过去）；选了一半、写了一半的记着
      seen[cur.q.id] = 1;
      var inp = cur.el && cur.el.querySelector(".ap-in"); if (inp && inp.value.trim()) cur.ans[cur.qi].text = inp.value.trim();
      (window.TSU_ASKDRAFT = window.TSU_ASKDRAFT || {})[cur.q.id] = { qi: cur.qi, ans: JSON.parse(JSON.stringify(cur.ans)) };
    }
    if (answered && window.TSU_ASKDRAFT) delete TSU_ASKDRAFT[cur.q.id];
    document.removeEventListener("keydown", onDocKey, true);
    var el = cur.el, back = cur.back;
    cur = null;
    if (el && el.parentNode) el.parentNode.removeChild(el);
    if (back && back.focus && back.isConnected) try { back.focus({ preventScroll: true }); } catch (e) { /* 回不去就算了 */ }
  }
  setInterval(function () { try { scan(); } catch (e) { /* 下一秒再看 */ } }, 1000);
  document.addEventListener("vs-needs", function () { try { scan(); } catch (e) { /* 下一秒再看 */ } });
  window.TSU_ASKPOP = { scan: scan };
})();
