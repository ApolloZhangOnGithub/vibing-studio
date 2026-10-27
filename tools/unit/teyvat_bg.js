// 单元测试：Teyvat 转到后台的命令——跑完的通知对不上、被吞了、不显示的、它报的「一共 / 还剩几个」、超时——列表里「在跑」的数要对。
//   node tools/unit/teyvat_bg.js   （不开浏览器：把 ui/studio/teyvat.js 放进一个假的 window 里，直接用它的 Parser）
const fs = require("fs"), path = require("path"), vm = require("vm");
const src = fs.readFileSync(path.join(__dirname, "../../ui/studio/teyvat.js"), "utf8");
const win = { TSU_LOCAL: { info: () => ({ home: "/tmp/none" }) }, TSU_AGENTS: { registerExternal() {}, setExternalResolver() {} }, TSU_CONNECTORS: { on: () => false, watch() {} } };
const ctx = { window: win, document: { hidden: true, addEventListener() {}, dispatchEvent() {} }, setTimeout() {}, setInterval() {}, clearInterval() {}, console, Event: function () {}, Date, JSON, Math };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const { Parser } = win.__TY_TEST;

let n = 0, at = Date.now() - 20 * 60000; // 20 分钟前开始（都在超时以内）
const iso = () => new Date(at).toISOString();
const call = (id, cmd) => ({ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id, name: "execute", arguments: { command: cmd, title: cmd } }], stopReason: "toolUse", timestamp: at }, timestamp: iso() });
const created = (id, rec, total) => ({ type: "message", message: { role: "toolResult", toolCallId: id, toolName: "execute", content: [{ type: "text", text: "Running in background" }],
  details: { execId: "#" + id, recId: rec, createdInfo: { created: 1, total, ts: at } }, timestamp: at }, timestamp: iso() });
const done = (rec, cmd, remaining, display) => ({ type: "custom_message", customType: "continuous-cmd-done", display, content: "完成 (3s, exit 0):\n$ " + cmd,
  details: { title: cmd, status: "done", recId: rec, exitCode: 0, elapsedSec: 3, endTs: at, cmd, output: "ok", remaining }, timestamp: iso() });
const feed = [];
const step = (e) => { at += 30000; feed.push(e); };
// 四个转到后台：a、b、c、d（它报的「一共」：1、2、3、4）
step(call("c1", "cmd-a")); step(created("c1", "r-a", 1));
step(call("c2", "cmd-b")); step(created("c2", "r-b", 2));
step(call("c3", "cmd-c")); step(created("c3", "r-c", 3));
step(call("c4", "cmd-d")); step(created("c4", "r-d", 4));
// a 跑完：通知里的 id 对不上（它那边跨秒、换了算法）——按命令认出是 a；它说还剩 3 个
step(done("r-a-DRIFT", "cmd-a", 3, true));
// b 跑完：这一条不显示（以前直接跳过）——也要认
step(done("r-b", "cmd-b", 2, false));
// 新开 e：它说「一共 1 个」——c、d 其实早就结束了（通知被吞了）
step(call("c5", "cmd-e")); step(created("c5", "r-e", 1));

const P = Parser(null);
feed.forEach((e) => P.feed(e));
const st = (q) => (q.done ? (q.done.err ? "error" : "done") : q.lost ? "lost:" + (q.lostWhy || "") : q.status);
const got = Object.fromEntries(P.bgs.map((q) => [q.input.command, st(q)]));
const want = { "cmd-a": "done", "cmd-b": "done", "cmd-c": "lost:gone", "cmd-d": "lost:gone", "cmd-e": "background" };
let ok = JSON.stringify(got) === JSON.stringify(want);
console.log(ok ? "teyvat_bg: OK" : "teyvat_bg: FAILED\n  got  " + JSON.stringify(got) + "\n  want " + JSON.stringify(want));
// 「在跑」的只剩一个
const running = P.bgs.filter((q) => q.status === "background" && !q.done && !q.lost).length;
if (running !== 1) { ok = false; console.log("  running " + running + " (want 1)"); }
process.exit(ok ? 0 : 1);
