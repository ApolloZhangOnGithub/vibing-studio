// 往上快速滚动一个很长的 Claude Code 会话（gen_cc.py 造的，约 12 MB）：数一数滚的时候看得见的地方有没有「没画的块」（黑的）、
//   有没有滚到已读进来的最顶上停住等更早的那段（「要加载」）。真终端两样都没有。
//   第一趟 8000 px/s 从最底下滚到会话的最开头（更早的要一段段读进来）；第二趟全部读进来以后，再 20000 px/s 来回滚一趟（只看没画的块）
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
  var rt = TSU_AGENTS.runtime(P.program.agentId), sc = P.screen;
  // 读进来、画好（块数一阵子不变）
  var last = -1, same = 0;
  while (same < 10) { await tick(100); var n0 = P.out.children.length; same = n0 === last ? same + 1 : 0; last = n0; }
  out.initial = { blocks: P.out.children.length, more: !!rt.more(), height: sc.scrollHeight, view: sc.clientHeight };
  var blank = function () {
    var r = sc.getBoundingClientRect(), n = 0;
    P.out.querySelectorAll(".blk.cvfar").forEach(function (b) { var q = b.getBoundingClientRect(); if (q.bottom > r.top && q.top < r.bottom) n++; });
    return n;
  };
  async function pass(speed, dir, stopAtTop) {
    var step = speed * 16 / 1000, st = { frames: 0, blankFrames: 0, stuckFrames: 0, ms: 0, maxBlank: 0 }, t0 = performance.now();
    while (performance.now() - t0 < 120000) {
      var before = sc.scrollTop;
      sc.scrollTop = dir < 0 ? Math.max(0, before - step) : Math.min(sc.scrollHeight, before + step);
      await tick(16);
      st.frames++;
      var b = blank();
      if (b) { st.blankFrames++; st.maxBlank = Math.max(st.maxBlank, b); }
      if (dir < 0 && sc.scrollTop <= 1 && rt.more()) st.stuckFrames++;
      if (dir < 0 && sc.scrollTop <= 1 && !(stopAtTop && rt.more())) break;
      if (dir > 0 && sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 1) break;
    }
    st.ms = Math.round(performance.now() - t0);
    return st;
  }
  sc.scrollTop = sc.scrollHeight;
  await tick(300);
  out.up1 = await pass(8000, -1, true); // 一直滚到会话最开头（中间要读更早的）
  out.afterUp1 = { blocks: P.out.children.length, more: !!rt.more(), height: sc.scrollHeight };
  out.down = await pass(20000, 1, false);
  out.up2 = await pass(20000, -1, false);
  out.ok = true;
} catch (e) { out.error = String(e && e.stack || e); }
return out;
