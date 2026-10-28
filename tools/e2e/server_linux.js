// 服务器版在真的 Linux 上从头装一遍（Docker 容器，不碰你的电脑、你的服务器）：
//   本机的网页服务（wrangler dev，容器经 host.docker.internal 连它）→ 测试账号要安装口令 → 容器里 curl …/s/<口令> | sh（同用户复制的那一条）→
//   装好、配对、跑起来 → 假的客户端经中转调 local.info（是不是容器里那个系统）、exec、pty.open（真终端，node-pty）→ 「设备」里有它
//   node tools/e2e/server_linux.js [镜像…]   默认 fedora:41（自带 curl）；ubuntu、debian 先 apt 装 curl
//   要先 tools/release-server.sh（ui/downloads/server/ 里有程序包、Node）；结果在 ~/Library/Caches/VibingStudio/server-test/<时间>/
"use strict";
const cp = require("child_process"), fs = require("fs"), path = require("path"), os = require("os"), crypto = require("crypto");
const ROOT = path.join(__dirname, "..", ".."), PORT = 8792, LOCAL = "http://localhost:" + PORT, INSIDE = "http://host.docker.internal:" + PORT;
const W = path.join(os.homedir(), "Library/Caches/VibingStudio/server-test", "linux-" + Date.now());
fs.mkdirSync(W, { recursive: true });
const images = process.argv.slice(2).length ? process.argv.slice(2) : ["fedora:41"];
const procs = [], made = [], results = {};
const log = (s) => console.log("·", s);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, what) { const end = Date.now() + ms; for (;;) { try { const v = await fn(); if (v) return v; } catch (e) { /* 再等 */ } if (Date.now() > end) throw new Error("timed out: " + what); await wait(300); } }
const sh = (args, o) => cp.spawnSync("docker", args, Object.assign({ encoding: "utf8", maxBuffer: 64 << 20 }, o));

async function client(ck, dev) {
  const cid = "cli" + crypto.randomBytes(5).toString("hex"), { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const j = publicKey.export({ format: "jwk" }), pub = Buffer.concat([Buffer.from([4]), Buffer.from(j.x, "base64url"), Buffer.from(j.y, "base64url")]).toString("base64");
  const ws = new WebSocket(LOCAL.replace("http", "ws") + "/api/relay/client?device=" + dev + "&client=" + cid + "&cname=TestMac", { headers: { Cookie: ck, Origin: LOCAL } });
  let n = 0; const pend = {}, evs = [];
  const call = (cmd, args) => new Promise((res, rej) => { const id = ++n; pend[id] = { res, rej }; ws.send(JSON.stringify({ id, cmd, args: args || {}, k: 1, s: "t1" })); setTimeout(() => { if (pend[id]) { delete pend[id]; rej(new Error("timeout " + cmd)); } }, 20000); });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.sys === "auth" && m.state === "challenge") {
      const sig = crypto.sign("sha256", Buffer.from("vs-remote-v1\n" + dev + "\n" + cid + "\n" + m.nonce), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64");
      ws.send(JSON.stringify({ id: ++n, cmd: "auth.prove", args: { nonce: m.nonce, pub, sig }, k: 1, s: "t1" }));
      return;
    }
    if (m.ev) { evs.push(m); return; }
    if (m.id != null && pend[m.id]) { const p = pend[m.id]; delete pend[m.id]; m.ok ? p.res(m.value) : p.rej(Object.assign(new Error(m.error && m.error.message), { code: m.error && m.error.code })); }
  };
  await new Promise((r, j2) => { ws.onopen = r; ws.onerror = j2; });
  return { call, evs, close: () => ws.close() };
}

async function one(image, ck) {
  const r = { image }, name = "vs-srv-test-" + crypto.randomBytes(3).toString("hex");
  // 1) 一个干净的容器（没有 systemd：装成「cron / 后台」那一路）；ubuntu、debian 自己没有 curl，先装上
  const plat = /@(amd64|arm64)$/.exec(image), img = image.replace(/@\w+$/, ""); // fedora:41@amd64：x86_64（Apple 芯片上靠模拟）
  let res = sh(["run", "-d", "--name", name, "--add-host", "host.docker.internal:host-gateway"].concat(plat ? ["--platform", "linux/" + plat[1]] : []).concat([img, "tail", "-f", "/dev/null"]));
  if (res.status !== 0) throw new Error("docker run: " + res.stderr);
  made.push(name);
  if (/ubuntu|debian/.test(img)) { res = sh(["exec", name, "sh", "-c", "apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null"]); if (res.status !== 0) throw new Error("apt: " + res.stderr.slice(-400)); }
  // 2) 要一个安装口令（同「设备」›「添加服务器」），脚本里的网址换成容器看得到的
  const tok = await (await fetch(LOCAL + "/api/server/token", { method: "POST", headers: { cookie: ck, "content-type": "application/json" }, body: "{}" })).json();
  const script = (await (await fetch(LOCAL + "/s/" + tok.token)).text()).split(new URL(LOCAL).origin.replace(":" + PORT, "")).join(INSIDE);
  fs.writeFileSync(path.join(W, name + ".install.sh"), script);
  // 3) 在容器里跑（同 curl … | sh：脚本从标准输入进去）
  const t0 = Date.now();
  res = sh(["exec", "-i", "-e", "LANG=en_US.UTF-8", name, "sh"], { input: script, timeout: 300000 });
  r.installSecs = Math.round((Date.now() - t0) / 1000);
  r.installOut = (res.stdout + res.stderr).trim().split("\n").slice(-12);
  fs.writeFileSync(path.join(W, name + ".install.log"), res.stdout + "\n--- stderr ---\n" + res.stderr);
  if (res.status !== 0) throw new Error("install failed (" + res.status + "): " + (res.stderr || res.stdout).slice(-600));
  log(image + ": installed in " + r.installSecs + "s");
  // 4) 它报到「设备」了：拿设备号
  const dv = await until(async () => { const l = (await (await fetch(LOCAL + "/api/devices", { headers: { cookie: ck } })).json()).devices || []; return l.filter((d) => d.kind === "server" && !results[d.id])[0]; }, 30000, "device report");
  results[dv.id] = true;
  r.device = { name: dv.name, os: dv.os, app: dv.app, hw: dv.hw };
  log(image + ": in Devices as " + JSON.stringify(r.device));
  // 5) 经中转用它
  const c = await client(ck, dv.id);
  const li = await c.call("local.info");
  r.localInfo = { os: li.os, home: li.home, user: li.user, platform: li.platform };
  const eid = "e" + Date.now().toString(36);
  await c.call("exec.start", { id: eid, cmd: "cat /etc/os-release | head -2 && echo exec-ok", access: "user" });
  await until(() => c.evs.some((m) => m.ev === "exec.exit" && m.detail.id === eid), 20000, "exec");
  r.exec = c.evs.filter((m) => m.ev === "exec.data" && m.detail.id === eid).map((m) => m.detail.o || "").join("").trim();
  const pid = "p" + Date.now().toString(36);
  await c.call("pty.open", { id: pid, cols: 80, rows: 24, cwd: li.home });
  await c.call("pty.write", { id: pid, data: "echo pty-$((6*7))\r" });
  const ptyOut = await until(() => { const s = c.evs.filter((m) => m.ev === "pty.data" && m.detail.id === pid).map((m) => Buffer.from(m.detail.b64 || "", "base64").toString("utf8")).join(""); return /pty-42/.test(s) ? s : null; }, 20000, "pty output");
  r.pty = /pty-42/.test(ptyOut);
  await c.call("pty.close", { id: pid }).catch(() => {});
  c.close();
  // 6) 服务器上的命令
  r.status = sh(["exec", name, "sh", "-c", "$HOME/.local/bin/vibing-studio-server status"]).stdout.trim();
  r.ok = /exec-ok/.test(r.exec) && r.pty && /Connected/.test(r.status);
  log(image + ": " + (r.ok ? "OK" : "FAILED") + " — " + r.status);
  return r;
}

(async () => {
  const out = { runs: [] };
  try {
    if (sh(["info", "--format", "{{.ServerVersion}}"]).status !== 0) throw new Error("Docker isn't running");
    const state = path.join(W, "wrangler-state");
    cp.execFileSync("npx", ["wrangler", "d1", "execute", "native-agent-desktop-os-web", "--local", "--persist-to", state, "--file", "schema.sql", "--yes"], { cwd: path.join(ROOT, "web"), stdio: "ignore" });
    const f = fs.openSync(path.join(W, "wrangler.log"), "w");
    procs.push(cp.spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--ip", "0.0.0.0", "--local", "--persist-to", state], { cwd: path.join(ROOT, "web"), stdio: ["ignore", f, f] }));
    await until(async () => (await fetch(LOCAL + "/api/version")).ok, 90000, "wrangler dev");
    const lr = await fetch(LOCAL + "/auth/login?dev=2&next=/", { redirect: "manual" });
    const ck = (lr.headers.getSetCookie() || []).map((s) => s.split(";")[0]).filter((s) => /^tsu_s=./.test(s))[0];
    if (!ck) throw new Error("dev login failed");
    for (const im of images) { try { out.runs.push(await one(im, ck)); } catch (e) { out.runs.push({ image: im, error: String(e && e.message || e) }); log(im + ": ERROR " + (e && e.message || e)); } }
  } catch (e) { out.error = String(e && e.stack || e); console.error(out.error); }
  for (const n of made) sh(["stop", "-t", "1", n]);
  for (const p of procs) { try { p.kill("SIGTERM"); } catch (e) { /* 已经退了 */ } }
  out.ok = !out.error && out.runs.length > 0 && out.runs.every((x) => x.ok);
  fs.writeFileSync(path.join(W, "result.json"), JSON.stringify(out, null, 1));
  console.log(out.ok ? "server on linux: OK" : "server on linux: FAILED", "→", W, "(stopped containers: " + made.join(", ") + ")");
  process.exit(out.ok ? 0 : 1);
})();
