// 选中 diff 的几行（gen_ccdiff.py 造的会话：一次 Edit，删掉、加上的那两行很长、折好几行，红绿底）：
//   从上面一行没底色的字的中间选到红底那一行折出来的中间——截两张图（选之前、选之后），量选区盖住的那几格是不是选区的颜色（不是红底）
var out = {};
var tick = function (ms) { return new Promise(function (r) { setTimeout(r, ms || 16); }); };
var until = async function (fn, ms) { var end = performance.now() + (ms || 30000); while (performance.now() < end) { var v = fn(); if (v) return v; await tick(50); } return null; };
var N = window.nadosNative;
var shot = function () { return N.call("page.snapshot", { x: 0, y: 0, w: innerWidth, h: innerHeight, width: innerWidth }); };
var SID = "5c0f1e2d-0000-4000-8000-0000000d1ff0";
var px = async function (url, pts) {
  var img = new Image(); img.src = url; await img.decode();
  var c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
  var g = c.getContext("2d"); g.drawImage(img, 0, 0);
  var k = img.width / innerWidth;
  return pts.map(function (p) { var d = g.getImageData(Math.round(p[0] * k), Math.round(p[1] * k), 1, 1).data; return [d[0], d[1], d[2]]; });
};
try {
  await until(function () { return window.TSU_TERM && TSU_TERM.front() && window.TSU_CLAUDE && window.TSU_LOCAL && TSU_LOCAL.info(); }, 60000);
  var tw = TSU_TERM.front(), home = TSU_LOCAL.info().home;
  (tw.ws.all ? tw.ws.all() : []).forEach(function (p) { if (p.program && p.program.page) tw.ws.closePane(p); });
  tw.side.viewCC(SID, { id: SID, path: home + "/.claude/projects/-tmp-seltest/" + SID + ".jsonl", cwd: "/tmp/seltest", title: "sel test", mtime: Date.now() });
  var P = await until(function () { var p = tw.ws.active; return p && p.out && /不要状态栏/.test(p.out.textContent) ? p : null; }, 60000);
  if (!P) throw new Error("session did not open");
  await tick(800);
  // 起点：「不要状态栏」那几个字；终点：红底那一段（删掉的那行）里「claudeTheme」
  var walker = document.createTreeWalker(P.out, NodeFilter.SHOW_TEXT), a = null, b = null, n;
  while ((n = walker.nextNode())) {
    if (!a && n.data.indexOf("3601") >= 0) a = [n, n.data.indexOf("3601") + 2]; // 中文一个字一小块（各自一个节点）：从上面那一行的行号中间起
    var bg = n.parentElement && n.parentElement.closest(".drow.ddel");
    if (a && !b && bg && n.data.indexOf("claudeTheme") >= 0) b = [n, n.data.indexOf("claudeTheme") + 4];
  }
  if (!b) { var w2 = document.createTreeWalker(P.out, NodeFilter.SHOW_TEXT), m; while ((m = w2.nextNode())) if (m.data.indexOf("claudeTheme") >= 0) { var e0 = m.parentElement; for (var up = 0; up < 3 && e0.parentElement; up++) e0 = e0.parentElement; out.dom = e0.outerHTML.slice(0, 3000); break; } }
  if (!a || !b) throw new Error("anchors not found " + !!a + " " + !!b);
  b[0].parentElement.scrollIntoView({ block: "center" });
  await tick(300);
  var red = b[0].parentElement.closest(".drow.ddel"), red1 = red.previousElementSibling && red.previousElementSibling.closest && red.previousElementSibling.classList.contains("drow") ? red.previousElementSibling : null;
  // 第一行（整行选中）：从上一个 .drow 找；终点在第二行（只选了一半）
  out.redBg = getComputedStyle(red).backgroundColor;
  // 量的点：红底那一段第一行的中间（整行都在选区里）
  var rows = Array.prototype.filter.call(P.out.querySelectorAll(".drow.ddel"), function () { return true; });
  var r0 = rows[0].getBoundingClientRect(), r1 = red.getBoundingClientRect();
  // 量的点：删掉的第一行（整行在选区里）的中间、右边空着的地方；第二行（选到一半）选中的字上、没选中的右边
  var pts = [[r0.left + r0.width / 2, (r0.top + r0.bottom) / 2], [r0.right - 20, (r0.top + r0.bottom) / 2], [r1.left + 30, (r1.top + r1.bottom) / 2], [r1.right - 20, (r1.top + r1.bottom) / 2]];
  out.rows = rows.length;
  out.step = "shot1";
  out.before = await shot();
  out.step = "px1";
  out.pxBefore = await px(out.before, pts);
  var sel = getSelection(); sel.removeAllRanges();
  var r = document.createRange(); r.setStart(a[0], a[1]); r.setEnd(b[0], b[1]); sel.addRange(r);
  await tick(300);
  out.step = "shot2";
  out.after = await shot();
  out.step = "px2";
  out.pxAfter = await px(out.after, pts);
  out.selected = String(sel).length;
  sel.removeAllRanges();
  // 代码上色：Write 的预览（config.py）里 import 那几行有几种颜色；没有语言的代码块（AlphaLight/ 那棵树）是什么颜色
  var colorsNear = function (re) { var w3 = document.createTreeWalker(P.out, NodeFilter.SHOW_TEXT), m3, cs = {}; while ((m3 = w3.nextNode())) { if (re.test(m3.data)) { var row = m3.parentElement; cs[getComputedStyle(row).color] = 1; } } return Object.keys(cs); };
  out.importColors = colorsNear(/^(import|from)$|\bimport\b/);
  out.treeColors = colorsNear(/AlphaLight\//);
  out.shot3 = await shot();
  out.ok = true;
} catch (e) { out.error = String(e && (e.message + " · " + e.stack) || e) + " · step " + out.step; }
return out;
