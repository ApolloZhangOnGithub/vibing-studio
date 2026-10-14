// 设置 › 连接器 › Claude Code 那一页：下面是它装的钩子、MCP 服务器、插件、技能……（eco.js 画在这一页里）；「App」里不再有「Agent 扩展」那一格
var out = {};
var wait = function (ms) { return new Promise(function (r) { window["set" + "Timeout"](r, ms); }); };
var until = async function (fn, ms) { var end = performance.now() + (ms || 20000); while (performance.now() < end) { var v; try { v = fn(); } catch (e) { v = null; } if (v) return v; await wait(100); } return null; };
try {
  await until(function () { return window.STUDIO && window.TSU_TERM && TSU_TERM.front() && window.TSU_ECO; }, 60000);
  var tw = TSU_TERM.front();
  out.appTile = !!(STUDIO.apps && STUDIO.apps.list ? STUDIO.apps.list().some(function (a) { return a.id === "eco"; }) : null);
  STUDIO.settings(tw, "connectors/claude-code");
  var emb = await until(function () { var e = document.querySelector('.ss-embed[data-embed="eco"]'); return e && e.querySelector(".eco-embed") && !/正在读/.test(e.innerText) ? e : null; }, 40000);
  out.embed = !!emb;
  out.text = emb ? emb.innerText.replace(/\s+/g, " ").slice(0, 400) : (document.querySelector(".ss-body") || {}).innerText;
  out.sections = emb ? Array.prototype.map.call(emb.querySelectorAll("[data-fold]"), function (x) { return x.innerText.replace(/\s+/g, " ").slice(0, 40); }) : [];
} catch (e) { out.error = String(e && e.stack || e); }
return out;
