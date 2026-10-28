// 往上快速滚动一个很长的 Claude Code 会话（gen_cc.py 造的，约 12 MB）——同人用触控板、滚轮滚（发 wheel 事件，走页面自己的一行一行滚的那一套）：
//   blankFrames  看得见的地方有没画的块（黑的）
//   edgeFrames   滚到已经画出来的最顶上、可上面其实还有（更早的还没读进来，或读进来了还没补画）——「要加载」
//   maxGap / over100  两帧之间最长隔了多久、超过 100 ms 的有几次（卡住）
//   第一趟 12000 px/s 从最底下滚到会话真正的最开头（一路要读更早的）；第二趟 20000 px/s 往下滚到底；第三趟 20000 px/s 再往上滚到顶
var out = {};
var tick = function (ms) { return new Promise(function (r) { setTimeout(r, ms || 16); }); };
var until = async function (fn, ms) { var end = performance.now() + (ms || 30000); while (performance.now() < end) { var v = fn(); if (v) return v; await tick(50); } return null; };
var SID = "5c0f1e2d-0000-4000-8000-00000000abcd";
try {
  await until(function () { return window.TSU_TERM && TSU_TERM.front() && window.TSU_CLAUDE && window.TSU_LOCAL && TSU_LOCAL.info(); }, 60000);
  var tw = TSU_TERM.front(), home = TSU_LOCAL.info().home;
  (tw.ws.all ? tw.ws.all() : []).forEach(function (p) { if (p.program && p.program.page) tw.ws.closePane(p); });
  tw.side.viewCC(SID, { id: SID, path: home + "/.claude/projects/-tmp-scrolltest/" + SID + ".jsonl", cwd: "/tmp/scrolltest", title: "scroll test", mtime: Date.now() });
  var P = await until(function () { var p = tw.ws.active; return p && p.out && p.out.querySelectorAll(".blk").length > 20 ? p : null; }, 60000);
  if (!P) throw new Error("session did not open");
  var rt = TSU_AGENTS.runtime(P.program.agentId), sc = P.screen, rowH = P.rowH || 16;
  var last = -1, same = 0;
  while (same < 10) { await tick(100); var n0 = P.out.children.length; same = n0 === last ? same + 1 : 0; last = n0; }
  out.initial = { blocks: P.out.children.length, more: !!rt.more(), height: sc.scrollHeight, view: sc.clientHeight };
  var blank = function () {
    var r = sc.getBoundingClientRect(), n = 0;
    P.out.querySelectorAll(".blk.cvfar").forEach(function (b) { var q = b.getBoundingClientRect(); if (q.bottom > r.top && q.top < r.bottom) n++; });
    return n;
  };
  var firstDrawn = function () { var f = rt.session().turns[0]; return Array.prototype.some.call(P.out.children, function (b) { return b._t === f; }); };
  var realTop = function () { return !rt.more() && firstDrawn(); };
  async function pass(speed, dir) {
    var st = { frames: 0, blankFrames: 0, edgeFrames: 0, maxBlank: 0, maxGap: 0, over100: 0, ms: 0 }, t0 = performance.now(), prev = t0, gap0 = 16;
    while (performance.now() - t0 < 150000) {
      // 按时间走（同触控板的惯性：两次事件隔得久，一次走得多）——页面卡一下，下一次就跳得更远
      sc.dispatchEvent(new WheelEvent("wheel", { deltaY: dir * speed * Math.min(gap0, 120) / 1000, deltaMode: 0, bubbles: true, cancelable: true }));
      await tick(16);
      var now = performance.now(), gap = now - prev; prev = now; gap0 = gap;
      st.frames++; st.maxGap = Math.max(st.maxGap, Math.round(gap)); if (gap > 100) st.over100++;
      var b = blank();
      if (b) { st.blankFrames++; st.maxBlank = Math.max(st.maxBlank, b); }
      if (dir < 0 && sc.scrollTop <= rowH * 2 && !realTop()) st.edgeFrames++;
      if (dir < 0 && sc.scrollTop <= 1 && realTop()) break;
      if (dir > 0 && sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 1) break;
    }
    st.ms = Math.round(performance.now() - t0);
    st.top = Math.round(sc.scrollTop);
    return st;
  }
  P.toBottom();
  await tick(300);
  out.up1 = await pass(12000, -1);
  out.afterUp1 = { blocks: P.out.children.length, more: !!rt.more(), height: sc.scrollHeight, realTop: realTop() };
  out.loads = rt.perf ? rt.perf() : null; // 往前读的每一段：读文件、解码、解析、画（同步那部分）各用了多少毫秒
  out.down = await pass(20000, 1);
  out.up2 = await pass(20000, -1);
  out.ok = true;
} catch (e) { out.error = String(e && e.stack || e); }
return out;
