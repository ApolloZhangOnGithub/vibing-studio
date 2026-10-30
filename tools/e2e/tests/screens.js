// 截几张 README 用的图（手动跑）：终端界面（Claude Code 的会话，diff + 代码块）、图形界面（同一段）、访达页、Claude App 风格的新会话
//   图是 data:image 的，run.py 的 save_shots 会写出来；跑完把 ~/Library/Caches/VibingStudio/e2e/<时间>/ 里的 screens_*.png 拷到 docs/
var out = {};
var tick = function (ms) { return new Promise(function (r) { setTimeout(r, ms || 16); }); };
var until = async function (fn, ms) { var end = performance.now() + (ms || 30000); while (performance.now() < end) { var v = fn(); if (v) return v; await tick(50); } return null; };
var N = window.nadosNative;
var shot = function (k) { return N.call("page.snapshot", { x: 0, y: 0, w: innerWidth, h: innerHeight, width: 1600 }).then(function (b) { out[k] = b; return b; }); };
var SID = "5c0f1e2d-0000-4000-8000-0000000d1ff0";
try {
  await until(function () { return window.TSU_TERM && TSU_TERM.front() && window.TSU_CLAUDE && window.TSU_LOCAL && TSU_LOCAL.info() && window.STUDIO; }, 60000);
  var tw = TSU_TERM.front(), home = TSU_LOCAL.info().home, S = STUDIO;
  (tw.ws.all ? tw.ws.all() : []).forEach(function (p) { if (p.program && p.program.page) tw.ws.closePane(p); });
  // 1) 终端界面：Claude Code 会话（一次 Edit 的 diff + 一次 Write 的代码 + 一棵代码树）
  tw.side.viewCC(SID, { id: SID, path: home + "/.claude/projects/-tmp-seltest/" + SID + ".jsonl", cwd: "/tmp/seltest", title: "sel test", mtime: Date.now() });
  var P = await until(function () { var p = tw.ws.active; return p && p.out && /改好了/.test(p.out.textContent) ? p : null; }, 60000);
  if (!P) throw new Error("cc session did not open");
  await tick(700);
  await shot("tui");
  // 2) 图形界面（同一段会话）
  S.setv("ui", "gui");
  await until(function () { return tw.ws.active && tw.ws.active.out && tw.ws.active.out.querySelector(".gv-turn"); }, 20000);
  await tick(700);
  await shot("gui");
  // 3) 访达页
  S.openPage(tw, "dash", "");
  await until(function () { return document.querySelector(".st-pg-dash"); }, 20000);
  await tick(500);
  await shot("dash");
  // 4) Claude App 风格：新会话
  S.setv("os", "claude");
  S.setv("ui", "gui");
  await until(function () { return document.querySelector(".ca-new"); }, 20000);
  await tick(700);
  await shot("ca");
  out.ok = true;
} catch (e) { out.error = String(e && e.stack || e); }
return out;
