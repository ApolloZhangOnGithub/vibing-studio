// 远程桌面那头接了连接却不回握手（助手自己会一直等）：App 30 秒后停掉这一次、自己再试两次，最后卡片写「那台电脑没有回应」。
//   用一个标签页：卡片里输入密码（同用户），看状态和最后的卡片
var N = nadosNative, out = { states: [] };
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
try {
  var end0 = performance.now() + 60000;
  while (!(window.TSU_RDP && window.STUDIO && window.TSU_TERM && TSU_TERM.front()) && performance.now() < end0) await wait(200);
  var tw = TSU_TERM.front();
  (tw.ws.all ? tw.ws.all() : []).forEach(function (p) { if (p.program && (p.program.page === "macdesk" || p.program.page === "rdp")) tw.ws.closePane(p); });
  var old = await N.call("rdp.hosts");
  for (var i = 0; i < old.length; i++) await N.call("rdp.removeHost", { id: old[i].id });
  await N.call("rdp.saveHost", { name: "Silent", host: "127.0.0.1:33977", user: "test" });
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
  if (pw) { pw.value = "x"; var f = pw.closest("form"); if (f.requestSubmit) f.requestSubmit(); else f.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true })); }
  out.typed = !!pw;
  var end3 = performance.now() + 170000;
  while (performance.now() < end3) { await wait(1000); if (/error:timeout/.test(out.states[out.states.length - 1] || "")) break; }
  await wait(500);
  out.finalCard = cardOf();
  if (P) tw.ws.closePane(P);
  await wait(1000);
  out.after = (await N.call("rdp.list")).length;
} catch (e) { out.error = String(e && e.stack || e); }
return out;
