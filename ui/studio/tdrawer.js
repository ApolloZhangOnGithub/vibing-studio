// tdrawer.js —— 标签页最下面的「任务」抽屉：没有辅助侧栏的风格（macOS 的窗口、Pure Terminal）里，这个 agent 的任务清单、后台任务、子 Agent 放在这里。
//   VS Code 风格在辅助侧栏的 Agent 那一层，Claude App 在右边的「后台任务」卡片——画的都是 studio.js 的 familyHtml：同一份东西、同一套收起（点标题行）。
//   终端界面、图形界面一样（挂在面板上，不在哪一种界面里面）；Paimon 的 agent、连接器的会话（Claude Code、Codex）一样；这个 agent 什么都没有就整个不显示。
(function () {
  "use strict";
  if (window.TSU_TDRAWER) return;
  var A = function () { return window.TSU_AGENTS; }, T = function () { return window.TSU_TERM; }, S = function () { return window.STUDIO; };
  var here = function () { var s = S(); return !!(s && s.familyHost && s.familyHost() === "drawer"); };
  // 画一个面板的抽屉；不是这种风格、没有 agent、什么都没有：藏起来
  function paint(P) {
    var d = P.el.querySelector(":scope > .st-tdrawer"), s = S();
    var h = !P.side && here() ? s.familyHtml(P) : "";
    if (!h) { if (d && !d.hidden) { d.hidden = true; refit(P); } return; }
    if (!d) {
      d = document.createElement("div");
      d.className = "st-tdrawer";
      d.addEventListener("click", function (e) { click(P, e); });
      P.el.appendChild(d);
      // 收起、展开是高度动画：抽屉每变一点，终端界面按像素排的对话区跟着让地方
      var rq = 0;
      if (window.ResizeObserver) new ResizeObserver(function () { cancelAnimationFrame(rq); rq = requestAnimationFrame(function () { refit(P); }); }).observe(d); // 下一帧再排（在回调里直接改布局会「ResizeObserver loop」）
    }
    d.hidden = false;
    if (d.dataset.h !== h && !(s.famPressed && s.famPressed())) { var sc = d.querySelector(".st-fam"), top = sc ? sc.scrollTop : 0; d.dataset.h = h; d.innerHTML = h; s.applyFold(d); var sc2 = d.querySelector(".st-fam"); if (sc2) sc2.scrollTop = top; } // 正按着：先不换（换了这一下点击就丢了）
    refit(P);
  }
  // 抽屉的高度变了（出现、收起、多了几行）：终端界面按像素排的对话区要重新让出地方（图形界面是弹性的，不用管）
  function refit(P) {
    var d = P.el.querySelector(":scope > .st-tdrawer"), h = d && !d.hidden ? d.offsetHeight : 0;
    if (h === (P._tdH || 0)) return;
    P._tdH = h;
    if (P.fit) P.fit();
    if (P.stick) P.stick();
  }
  // 点了：标题行收起 / 展开、一条后台任务看详情、停止、「n 项已完成」——都交给 studio.js（辅助侧栏、卡片里点的是同一套）
  function click(P, e) {
    var b = e.target.closest("[data-st]"), s = S(), tw = P.win || (T() && T().front ? T().front() : null);
    if (!b || !s || !s.act || !tw) return;
    e.stopPropagation();
    s.act(tw, b.dataset.st, b);
    paint(P);
  }
  // 跟着 agent 的事件马上重画；另外每秒一遍（用了多久在走、换了界面、新开的标签页）
  var subs = {}; // 面板 id → { aid, off }
  function watch(P) {
    var aid = here() && P.program && P.program.agentId, s = subs[P.id];
    if (s && s.aid === aid) return;
    if (s && s.off) s.off();
    delete subs[P.id];
    if (!aid || !A()) return;
    var rt = null;
    try { rt = A().runtime(aid); } catch (e) { rt = null; }
    var raf = 0, off = rt && rt.on ? rt.on(function (type) { if (type === "tasks" || type === "state" || type === "status") { cancelAnimationFrame(raf); raf = requestAnimationFrame(function () { paint(P); }); } }) : null;
    subs[P.id] = { aid: aid, off: typeof off === "function" ? off : null };
  }
  // 这个 agent 现在有东西在跑（在回答、后台命令在跑）：抽屉里的用时要每秒走——没有就不用每秒重画
  function running(P) {
    var aid = P.program && P.program.agentId, rt = null;
    if (!aid || !A()) return false;
    try { rt = A().runtime(aid); } catch (e) { return false; }
    return !!(rt && (rt.stream || (rt.tasks || []).some(function (x) { return x.status === "running"; })));
  }
  // tick：每秒那一次——只重画有东西在跑的（以前每秒把每个标签页的整份任务清单、几百条后台任务重新拼一遍，能耗采样里占了一截）
  function syncAll(tick) {
    var t = T(), list = t && t.panes ? t.panes() : [], live = {};
    list.forEach(function (P) { if (!P || P.closed || !P.el) return; live[P.id] = true; watch(P); if (tick !== true || (here() && !P.side && running(P))) paint(P); });
    Object.keys(subs).forEach(function (id) { if (!live[id]) { if (subs[id].off) subs[id].off(); delete subs[id]; } });
  }
  setInterval(function () { if (!document.hidden) syncAll(true); }, 1000);
  // 换了应用风格：马上重排（到了 VS Code / Claude App 风格，抽屉收走，东西去辅助侧栏 / 卡片）——<html> 上别的 class 变了不算（它们变得很勤）
  var moT = 0, styleSig = function () { return (document.documentElement.className.match(/\bst-(?:os|gui|ui|tb|lay)[\w-]*/g) || []).sort().join(" "); }, lastStyle = styleSig();
  new MutationObserver(function () { var s0 = styleSig(); if (s0 === lastStyle) return; lastStyle = s0; clearTimeout(moT); moT = setTimeout(syncAll, 30); }).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  setTimeout(syncAll, 500);
  window.TSU_TDRAWER = { sync: syncAll, paint: paint };
})();
