// App 里带的静态助手（FreeRDP 链进去，不靠 Homebrew）：连 sample server，看连上、有画面、帧在来、编码
var N = nadosNative, out = { states: [] };
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
try {
  var end0 = performance.now() + 60000;
  while (!(window.TSU_RDP && window.STUDIO && window.TSU_TERM && TSU_TERM.front()) && performance.now() < end0) await wait(200);
  var tw = TSU_TERM.front();
  (tw.ws.all ? tw.ws.all() : []).forEach(function (p) { if (p.program && (p.program.page === "macdesk" || p.program.page === "rdp")) tw.ws.closePane(p); });
  var old = await N.call("rdp.hosts");
  for (var i = 0; i < old.length; i++) await N.call("rdp.removeHost", { id: old[i].id });
  await N.call("rdp.saveHost", { name: "Sample", host: "127.0.0.1:33899", user: "test" });
  var hid = ((await N.call("rdp.hosts"))[0] || {}).id;
  await TSU_RDP.reload();
  TSU_RDP.open(hid, tw);
  var P = null, end1 = performance.now() + 20000;
  while (!P && performance.now() < end1) { await wait(200); P = (tw.ws.all ? tw.ws.all() : []).filter(function (p) { return p.program && p.program.page === "rdp" && p.program.hostId === hid; })[0] || null; }
  var sid = P && P.program.id;
  N.on("rdp.state", function (d) { if (d.id !== sid) return; out.states.push(Math.round(performance.now() / 1000) + "s " + d.state + (d.kind ? ":" + d.kind : "") + (d.attempt != null ? "#" + d.attempt : "")); });
  var cardOf = function () { return P && P.program && P.program.card ? String(P.program.card.innerText || "").replace(/\s+/g, " ").slice(0, 160) : ""; };
  // 等密码框出来，填上、提交（同用户输入）
  var pw = null, end2 = performance.now() + 20000;
  while (!pw && performance.now() < end2) { await wait(200); pw = P && P.program.card ? P.program.card.querySelector('input[name="pw"]') : null; }
  out.firstCard = cardOf();
  if (pw) { pw.value = "test"; var f = pw.closest("form"); if (f.requestSubmit) f.requestSubmit(); else f.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true })); }
  out.typed = !!pw;
  var end3 = performance.now() + 60000, me = null;
  while (performance.now() < end3) { await wait(500); var l = await N.call("rdp.list"); me = (l || []).filter(function (x) { return x.id === sid; })[0]; if (me && me.state === "connected" && me.view && me.view.frames >= 2) break; if (/error/.test(out.states[out.states.length - 1] || "")) break; }
  out.view = me && me.view;
  var stats = []; N.on("rdp.stats", function (d) { if (d.id === sid) stats.push(d); });
  await wait(3000);
  out.stats = stats.slice(-1);
  out.avail = await N.call("rdp.available").catch(function (e) { return "ERR " + e.message; });
  out.finalCard = cardOf();
  if (P) tw.ws.closePane(P);
  await wait(1000);
  out.after = (await N.call("rdp.list")).length;
} catch (e) { out.error = String(e && e.stack || e); }
return out;
