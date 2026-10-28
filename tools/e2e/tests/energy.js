// 闲着的时候页面在忙什么（能耗）：<html> 上的 class 谁在来回变（每变一次，看着它的观察者全都醒一遍）、perf.js 记的最忙的回调。
//   终端风格、Claude App 风格各闲 20 秒（开着一个 Teyvat 的 agent，fixture ty）
var out = {};
var tick = function (ms) { return new Promise(function (r) { setTimeout(r, ms || 50); }); };
var until = async function (fn, ms) { var end = performance.now() + (ms || 30000); while (performance.now() < end) { var v = fn(); if (v) return v; await tick(50); } return null; };
async function watch(name, secs) {
  var flips = {}, n = 0, prev = new Set(document.documentElement.classList);
  var mo = new MutationObserver(function () {
    var cur = new Set(document.documentElement.classList);
    cur.forEach(function (c) { if (!prev.has(c)) { flips["+" + c] = (flips["+" + c] || 0) + 1; n++; } });
    prev.forEach(function (c) { if (!cur.has(c)) { flips["-" + c] = (flips["-" + c] || 0) + 1; n++; } });
    prev = cur;
  });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  var p0 = window.TSU_PERF && TSU_PERF.report ? TSU_PERF.report() : null;
  await tick(secs * 1000);
  mo.disconnect();
  var rep = window.TSU_PERF && TSU_PERF.report ? TSU_PERF.report() : null;
  out[name] = { rootClassFlips: n, flips: flips, perf: rep };
}
try {
  await until(function () { return window.TSU_TERM && TSU_TERM.front() && window.STUDIO; }, 60000);
  await tick(6000);
  await watch("terminal", 20);
  if (STUDIO.setv) { STUDIO.setv("os", "claude"); await tick(4000); await watch("claudeApp", 20); }
  out.ok = true;
} catch (e) { out.error = String(e && e.stack || e); }
return out;
