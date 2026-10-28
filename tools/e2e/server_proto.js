// 服务器版的协议测试（在这台 Mac 上跑，不用 Linux）：本机的网页服务（wrangler dev，测试账号）→ 要安装口令 → server/main.js 配对、用设备钥匙登录、连中转当主机 →
//   一个假的客户端（同 remote.js：自己一把 P-256 钥匙）连中转、过认设备那一关，调 info、local.info、fs.list、exec.start（收 exec.data / exec.exit），
//   再看「设备」里有没有它（/api/devices）、口令不能用第二次。全在 ~/Library/Caches/VibingStudio/server-test 里，跑完停掉自己起的进程
//   node tools/e2e/server_proto.js
"use strict";
const cp = require("child_process"), fs = require("fs"), path = require("path"), os = require("os"), crypto = require("crypto");
const ROOT = path.join(__dirname, "..", ".."), PORT = 8791, ORIGIN = "http://localhost:" + PORT;
const W = path.join(os.homedir(), "Library/Caches/VibingStudio/server-test", String(Date.now()));
fs.mkdirSync(W, { recursive: true });
const procs = [], out = { steps: [] };
const step = (s) => { out.steps.push(s); console.log("·", s); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, what) { const end = Date.now() + ms; for (;;) { try { const v = await fn(); if (v) return v; } catch (e) { /* 再等 */ } if (Date.now() > end) throw new Error("timed out: " + what); await wait(200); } }
function spawn(cmd, args, o, log) { const f = fs.openSync(path.join(W, log), "w"); const p = cp.spawn(cmd, args, Object.assign({ stdio: ["ignore", f, f] }, o)); procs.push(p); return p; }

(async () => {
  try {
    // 1) 本机的网页服务（自己一份库，表先建好）
    const state = path.join(W, "wrangler-state");
    cp.execFileSync("npx", ["wrangler", "d1", "execute", "native-agent-desktop-os-web", "--local", "--persist-to", state, "--file", "schema.sql", "--yes"], { cwd: path.join(ROOT, "web"), stdio: "ignore" });
    spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--local", "--persist-to", state], { cwd: path.join(ROOT, "web") }, "wrangler.log");
    await until(async () => (await fetch(ORIGIN + "/api/version")).ok, 90000, "wrangler dev");
    step("web up");
    // 2) 测试账号登录（只在本机的 DEV_LOGIN 才有），要一个安装口令
    const lr = await fetch(ORIGIN + "/auth/login?dev=2&next=/", { redirect: "manual" });
    const ck = (lr.headers.getSetCookie() || []).map((s) => s.split(";")[0]).filter((s) => /^tsu_s=./.test(s))[0];
    if (!ck) throw new Error("dev login failed");
    const tr = await fetch(ORIGIN + "/api/server/token", { method: "POST", headers: { cookie: ck, "content-type": "application/json" }, body: JSON.stringify({ lang: "zh" }) });
    const tok = await tr.json();
    if (!tok.token || !/\/s\//.test(tok.command)) throw new Error("token: " + JSON.stringify(tok));
    step("token " + tok.command.replace(tok.token, "<token>"));
    // 3) 服务器：配对、跑起来（配置、数据都在测试目录里）
    const env = Object.assign({}, process.env, { VS_SERVER_CONFIG: path.join(W, "cfg"), VS_SERVER_DATA: path.join(W, "data"), VS_LANG: "en" });
    const main = path.join(ROOT, "server", "main.js");
    const pr = cp.spawnSync(process.execPath, [main, "pair", tok.token, "--origin", ORIGIN], { env, encoding: "utf8" });
    if (pr.status !== 0) throw new Error("pair: " + pr.stderr + pr.stdout);
    step("paired: " + pr.stdout.trim());
    const again = cp.spawnSync(process.execPath, [main, "pair", tok.token, "--origin", ORIGIN], { env: Object.assign({}, env, { VS_SERVER_CONFIG: path.join(W, "cfg2") }), encoding: "utf8" });
    out.reuseRejected = again.status !== 0;
    step("same token again: " + (out.reuseRejected ? "rejected" : "ACCEPTED (bad)"));
    spawn(process.execPath, [main, "run"], { env }, "server.log");
    const st = await until(() => { const s = JSON.parse(fs.readFileSync(path.join(W, "data", "status.json"), "utf8")); return s.up ? s : null; }, 30000, "server connected");
    step("server connected as " + st.device);
    // 4) 假的客户端：同 remote.js
    const cid = "cli" + crypto.randomBytes(5).toString("hex"), { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const j = publicKey.export({ format: "jwk" }), pub = Buffer.concat([Buffer.from([4]), Buffer.from(j.x, "base64url"), Buffer.from(j.y, "base64url")]).toString("base64");
    const ws = new WebSocket(ORIGIN.replace("http", "ws") + "/api/relay/client?device=" + st.device + "&client=" + cid + "&cname=TestMac", { headers: { Cookie: ck, Origin: ORIGIN } });
    let n = 0; const pend = {}, evs = [];
    const call = (cmd, args) => new Promise((res, rej) => { const id = ++n; pend[id] = { res, rej }; ws.send(JSON.stringify({ id, cmd, args: args || {}, k: 1, s: "t1" })); setTimeout(() => { if (pend[id]) { delete pend[id]; rej(new Error("timeout " + cmd)); } }, 15000); });
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.sys === "auth" && m.state === "challenge") {
        const sig = crypto.sign("sha256", Buffer.from("vs-remote-v1\n" + st.device + "\n" + cid + "\n" + m.nonce), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64");
        const id = ++n; ws.send(JSON.stringify({ id, cmd: "auth.prove", args: { nonce: m.nonce, pub, sig }, k: 1, s: "t1" }));
        return;
      }
      if (m.ev) { evs.push(m); return; }
      if (m.id != null && pend[m.id]) { const p = pend[m.id]; delete pend[m.id]; m.ok ? p.res(m.value) : p.rej(Object.assign(new Error(m.error && m.error.message), { code: m.error && m.error.code })); }
    };
    await new Promise((r, j2) => { ws.onopen = r; ws.onerror = j2; });
    const info = await call("info");
    out.info = { server: info.server, host: info.host, ncmd: info.commands.length };
    step("info: " + JSON.stringify(out.info));
    const li = await call("local.info");
    step("local.info: home " + li.home + ", os " + li.os);
    const ls = await call("fs.list", { path: path.join(ROOT, "server") });
    out.list = ls.map((x) => x.name);
    step("fs.list server/: " + out.list.join(", "));
    const eid = "e" + Date.now().toString(36);
    await call("exec.start", { id: eid, cmd: "echo hello-from-server && uname -s", access: "user" });
    await until(() => evs.some((m) => m.ev === "exec.exit" && m.detail.id === eid), 15000, "exec.exit");
    const txt = evs.filter((m) => m.ev === "exec.data" && m.detail.id === eid).map((m) => m.detail.o || "").join("");
    out.exec = txt.trim();
    step("exec: " + JSON.stringify(out.exec));
    try { await call("window.title", { title: "x" }); out.denied = false; } catch (e) { out.denied = e.code === "E_DENIED"; }
    step("not-allowed command denied: " + out.denied);
    // 5) 「设备」里有它（服务器自己报到的）
    const dv = await until(async () => { const r = await fetch(ORIGIN + "/api/devices", { headers: { cookie: ck } }); const l = (await r.json()).devices || []; return l.filter((d) => d.id === st.device)[0]; }, 15000, "device report");
    out.device = { name: dv.name, kind: dv.kind, os: dv.os, app: dv.app };
    step("devices: " + JSON.stringify(out.device));
    ws.close();
    out.ok = !!(out.reuseRejected && out.info.server && /hello-from-server/.test(out.exec) && out.denied && dv.kind === "server");
  } catch (e) { out.error = String(e && e.stack || e); console.error(out.error); }
  for (const p of procs.reverse()) { try { p.kill("SIGTERM"); } catch (e) { /* 已经退了 */ } }
  fs.writeFileSync(path.join(W, "result.json"), JSON.stringify(out, null, 1));
  console.log(out.ok ? "server protocol: OK" : "server protocol: FAILED", "→", W);
  process.exit(out.ok ? 0 : 1);
})();
