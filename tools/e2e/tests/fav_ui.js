// 收藏：Teyvat 那段假的记录里，不选字，右键回答 →「收藏」（整条回答）、右键你说的那句 →「收藏」；再右键回答是「取消收藏」；另一处「标记这里」；
//   开「收藏」截图（三栏）；点一张卡片看全文和出处；点「跳到原处」回到那段会话
var N = nadosNative, out = { steps: [] };
var prog = function (x) { out.steps.push(x + " @" + Math.round(performance.now())); var h = window.TSU_LOCAL && TSU_LOCAL.info() && TSU_LOCAL.info().home; if (h) N.call("fs.write", { path: h + "/clip_progress.txt", text: out.steps.join("\n") + "\n", access: "rw" }).catch(function () {}); };
var whenDom = function (fn, limit) { return new Promise(function (res, rej) { var v = fn(); if (v) return res(v); var k = 0, mo = new MutationObserver(function () { var x = fn(); if (x) { mo.disconnect(); res(x); } else if (++k > (limit || 20000)) { mo.disconnect(); rej(new Error("gave up")); } }); mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true }); }); };
var frame = function () { return new Promise(function (r) { window["set" + "Timeout"](r, 30); }); }; // 计时器（屏幕睡着时 requestAnimationFrame 不走）
var waitMs = async function (ms) { var end = performance.now() + ms; while (performance.now() < end) await frame(); };
var shot = function () { return N.call("page.snapshot", { x: 0, y: 0, w: innerWidth, h: innerHeight, width: 1400 }); };
// App 里右键菜单是原生的（不在页面里）：接住 STUDIO.menu 交出来的那几项，按名字找、直接 run
var captured = null;
var menuItem = function (label) { return captured ? captured.filter(function (x) { return x && x.label === label; })[0] : null; };
try {
  await whenDom(function () { return window.TSU_TERM && TSU_TERM.front() && window.TSU_CONNECTORS && window.TSU_LOCAL && TSU_LOCAL.info() && window.TSU_CLIPS; });
  STUDIO.menu = function (items) { captured = typeof items === "function" ? items() : items; };
  prog("ready");
  TSU_CLIPS.list().forEach(function (r) { TSU_CLIPS.remove(r.id); }); // 上一回测试留下的（只在这个假的家目录、本机的测试服务器里）
  window.__TY_PS = function () { return {}; };
  TSU_CONNECTORS.tmpOff("teyvat", "on");
  await whenDom(function () { return window.TSU_TEYVAT && TSU_TEYVAT.list().some(function (x) { return x.id === "e5f6a7b8"; }); });
  prog("teyvat listed");
  var tw = TSU_TERM.front();
  (tw.ws.all ? tw.ws.all() : []).forEach(function (p) { if (p.program && p.program.page) tw.ws.closePane(p); });
  tw.side.viewTY("e5f6a7b8");
  await whenDom(function () { var pp = tw.ws.active; return pp && pp.el && /收到。等对方/.test(pp.el.innerText); });
  await waitMs(400);
  var P = tw.ws.active;
  prog("opened " + P.program.agentId);
  prog("before dbg");
  out.dbg = { hasOut: !!P.out, outText: P.out ? P.out.innerText.slice(0, 400) : "", blk: P.out ? P.out.querySelectorAll(".blk").length : -1, nodes: (function () { var a = [], w0 = document.createTreeWalker(P.out, NodeFilter.SHOW_TEXT); while (w0.nextNode() && a.length < 40) { if (w0.currentNode.nodeValue.trim()) a.push(w0.currentNode.nodeValue.slice(0, 30)); } return a; })() };
  var ctx = function (node) { var r0 = node.parentElement.getBoundingClientRect(); captured = null; node.parentElement.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r0.left + 10, clientY: r0.top + 5 })); return (captured || []).map(function (x) { return x && (x.label || (x.sep ? "—" : "")); }).slice(0, 8); };
  var findText = function (re, inAsk) { var w = document.createTreeWalker(P.out, NodeFilter.SHOW_TEXT); while (w.nextNode()) { var n = w.currentNode; if (re.test(n.nodeValue) && (!!n.parentElement.closest(".ask") === !!inAsk)) return n; } return null; };
  window.getSelection().removeAllRanges();
  // 1) 回答上右键（不选字）→ 收藏
  var tReply = findText(/allow from 240e/, false);
  out.menuReply = ctx(tReply);
  var it = menuItem("收藏");
  if (!it) throw new Error("no 收藏 on reply; menu=" + JSON.stringify(out.menuReply));
  it.run();
  await whenDom(function () { return TSU_CLIPS.list().length >= 1; });
  var fr = TSU_CLIPS.list()[0];
  out.favReply = { type: fr.type, md: fr.md, role: fr.src && fr.src.role, len: (fr.text || "").length, head: (fr.text || "").slice(0, 80) };
  // 2) 再右键回答：取消收藏
  out.menuReply2 = ctx(tReply);
  // 3) 你说的那句上右键 → 收藏
  var tAsk = findText(/IPv6/, true) || findText(/./, true);
  out.menuAsk = ctx(tAsk);
  var it2 = menuItem("收藏");
  if (it2) it2.run();
  await whenDom(function () { return TSU_CLIPS.list().length >= 2; });
  var fu = TSU_CLIPS.list()[0];
  out.favAsk = { type: fu.type, md: fu.md, role: fu.src && fu.src.role, text: (fu.text || "").slice(0, 80) };
  // 4) 标记这里
  ctx(tAsk);
  var it3 = menuItem("标记这里"); if (it3) it3.run();
  await whenDom(function () { return TSU_CLIPS.list().some(function (r) { return r.type === "flag"; }); });
  // 5) 收藏页
  STUDIO.openPage(tw, "clips", "");
  await whenDom(function () { return document.querySelector(".fv .fv-card"); });
  await waitMs(500);
  out.cards = document.querySelectorAll(".fv-card").length;
  out.nav = Array.prototype.map.call(document.querySelectorAll(".fv-nv"), function (x) { return x.innerText.replace(/\s+/g, " "); });
  out.s1 = await shot();
  // 搜索框：点一下能聚焦、打字能过滤（用户 2026-10-30：搜索框是假的、点不了）
  var q = document.querySelector(".fv-q"), qr = q.getBoundingClientRect(), cx = qr.left + 6, cy = qr.top + qr.height / 2;
  out.qTop = document.elementFromPoint(cx, cy) === q || (document.elementFromPoint(cx, cy) || {}).className;
  ["mousedown", "mouseup", "click"].forEach(function (t) { q.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, clientX: cx, clientY: cy })); });
  out.qFocused = document.activeElement === q;
  q.value = "zzzz_no_match"; q.dispatchEvent(new Event("input", { bubbles: true }));
  await waitMs(250);
  out.qFiltered = document.querySelectorAll(".fv-card").length; // 0 = 过滤生效
  var q2 = document.querySelector(".fv-q"); q2.value = ""; q2.dispatchEvent(new Event("input", { bubbles: true })); // paint 换过 input 了，重新拿
  await waitMs(250);
  var card = Array.prototype.filter.call(document.querySelectorAll(".fv-card"), function (x) { return /回复|回答/.test(x.innerText); })[0] || document.querySelector(".fv-card");
  card.click();
  await whenDom(function () { return document.querySelector(".fv-dt .fv-full"); });
  await waitMs(300);
  out.detail = (document.querySelector(".fv-dt") || {}).innerText.replace(/\s+/g, " ").slice(0, 300);
  out.s2 = await shot();
  document.querySelector('.fv-dt [data-a="jump"]').click();
  await whenDom(function () { var a = tw.ws.active; return a && a.program && a.program.agentId; });
  await waitMs(600);
  out.jumped = tw.ws.active && tw.ws.active.program && tw.ws.active.program.agentId;
} catch (e) { out.error = String(e && e.message) + " | " + String(e && e.stack || e); }
return out;
