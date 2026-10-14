// 当被用的那台 Mac：等原生的主机连上中转，报设备号；之后一直开着（NADOS_SELFTEST_STAY=1）。等用计时器（屏幕睡着时 requestAnimationFrame 不走）
var N = nadosNative, st = null;
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
for (var i = 0; i < 300; i++) { st = await N.call("remote.state"); if (st && st.up) break; await wait(100); }
return { up: !!(st && st.up), device: st && st.device, on: st && st.on, policy: st && st.policy, at: Date.now() };
