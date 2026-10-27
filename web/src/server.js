// server.js —— Vibing Studio 的 Linux 服务器版（没有桌面也能装）：「设备」里「添加服务器」给一条一次性的安装命令，
//   服务器上跑它：装好、自己登记成这个账号的设备、开机自己起来、自己更新——不用输密码、不用输代码、不用装别的。
//   POST /api/server/token      登录着：要一个一次性的安装口令（1 小时内有效，配对用一次）→ { token, command, expires }
//   GET  /s/<口令>               不用登录：安装脚本（网站地址、口令写在里面）；口令过期 / 用过了，给一个只说这件事的脚本
//   GET  /s/<口令>/<文件>        不用登录：安装要下的东西（server.json、程序包、Node 运行时）——口令有效期内
//   POST /auth/server/pair       不用登录：口令 + 服务器自己生成的公钥（P-256）→ 一把设备钥匙（devicekeys，同 Mac App 的「用 Touch ID 登录」那张表）；口令用掉。
//                                之后服务器自己用这把钥匙登录（/auth/devicekey/* → /auth/app，同 Mac App），连中转当主机（relay.js），报到「设备」（/api/devices）
//   GET  /api/server/node/<arch> 登录着：Node 运行时（服务器自己更新时用）
//   程序包、Node 运行时放在网站的 /downloads/server/（tools/release-server.sh）；Node 一个文件超过 25 MB，切成几段，这里接着流出去（同 Linux 版的 AppImage）
const enc = new TextEncoder();
const now = () => Date.now();
const TOKEN_MS = 60 * 60e3;
const b64u = (u) => { let s = ""; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const unb64u = (str) => { const s = String(str || "").replace(/-/g, "+").replace(/_/g, "/"); const bin = atob(s + "===".slice((s.length + 3) % 4)); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const sha = async (s) => b64u(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))));
const tokenOk = (t) => /^[A-Za-z0-9_-]{43}$/.test(t || "");
const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS server_tokens (hash TEXT PRIMARY KEY, github_id INTEGER NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0, used_at INTEGER, used_name TEXT)",
  "CREATE TABLE IF NOT EXISTS devicekeys (id TEXT PRIMARY KEY, github_id INTEGER NOT NULL, pub TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, last_used INTEGER)",
  "CREATE INDEX IF NOT EXISTS devicekeys_by_user ON devicekeys (github_id)",
];
let ready = false;
async function schema(env) { if (ready) return; await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s))); ready = true; }

const sh = (body, status = 200) => new Response(body, { status, headers: { "content-type": "text/x-shellscript; charset=utf-8", "cache-control": "no-store" } });
// 给 curl … | sh 看的：一句话、退出（中文、英文各一行：服务器的终端不一定显示得了中文）
const shFail = (zh, en) => sh("#!/bin/sh\nprintf '%s\\n%s\\n' " + JSON.stringify("Vibing Studio: " + zh) + " " + JSON.stringify("Vibing Studio: " + en) + " >&2\nexit 1\n");

async function tokenRow(env, token) {
  if (!tokenOk(token)) return null;
  return env.DB.prepare("SELECT * FROM server_tokens WHERE hash = ?").bind(await sha(token)).first();
}
async function manifest(env, origin) {
  const r = await env.ASSETS.fetch(new Request(origin + "/downloads/server/server.json"));
  return r.ok ? r.json().catch(() => null) : null;
}
// 一个文件或几段接起来流出去
async function stream(env, origin, parts, size, name) {
  const { readable, writable } = new TransformStream();
  (async () => {
    try {
      for (const p of parts) {
        const r0 = await env.ASSETS.fetch(new Request(origin + "/downloads/server/" + p));
        if (!r0.ok || !r0.body) throw new Error("part " + p);
        await r0.body.pipeTo(writable, { preventClose: true });
      }
      await writable.close();
    } catch (e) { try { await writable.abort(e); } catch (e2) { /* 已经断了 */ } }
  })();
  const h = { "content-type": "application/octet-stream", "cache-control": "no-store", "content-disposition": 'attachment; filename="' + name + '"' };
  if (size) h["content-length"] = String(size);
  return new Response(readable, { headers: h });
}
async function nodeFor(env, origin, arch) {
  const m = await manifest(env, origin), e = m && m.node && m.node[arch];
  if (!e || !Array.isArray(e.parts) || !e.parts.length) return new Response("no node runtime for " + arch, { status: 404 });
  return stream(env, origin, e.parts, e.size, "node-" + (m.node.version || "") + "-linux-" + arch + ".tar.gz");
}

export async function server(req, env, url, h) {
  await schema(env);
  const origin = url.origin;

  // ---- 登录着：要一个安装口令 ----
  if (url.pathname === "/api/server/token" && req.method === "POST") {
    const user = await h.currentUser(req, env);
    if (!user) return h.json({ error: "Not signed in" }, 401);
    if (!user.allowed) return h.json({ error: "Invite only" }, 403);
    const token = b64u(crypto.getRandomValues(new Uint8Array(32))), t = now();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM server_tokens WHERE expires < ?").bind(t - 7 * 864e5), // 一周前过期的不留
      env.DB.prepare("INSERT INTO server_tokens (hash, github_id, created, expires) VALUES (?, ?, ?, ?)").bind(await sha(token), user.github_id, t, t + TOKEN_MS),
    ]);
    return h.json({ token, command: "curl -fsSL " + origin + "/s/" + token + " | sh", expires: t + TOKEN_MS });
  }
  // 登录着：Node 运行时（服务器自己更新时用；程序包本身在 /downloads/server/ 照常取）
  const na = /^\/api\/server\/node\/(x64|arm64)$/.exec(url.pathname);
  if (na) {
    const user = await h.currentUser(req, env);
    if (!user) return h.json({ error: "Not signed in" }, 401);
    return nodeFor(env, origin, na[1]);
  }

  // ---- 服务器那边：拿口令配对 ----
  if (url.pathname === "/auth/server/pair" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const row = await tokenRow(env, b.token);
    if (!row || row.expires < now()) return h.json({ ok: false, error: "expired", message: "This install command has expired. Copy a new one from Devices in Vibing Studio." }, 400);
    if (row.used) return h.json({ ok: false, error: "used", message: "This install command was already used. Copy a new one from Devices in Vibing Studio." }, 400);
    // 公钥：P-256 未压缩点（65 字节）；导得进来才收
    const raw = (() => { try { return unb64u(b.pub); } catch (e) { return null; } })();
    if (!raw || raw.length !== 65 || raw[0] !== 4) return h.json({ ok: false, error: "bad key" }, 400);
    try { await crypto.subtle.importKey("raw", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]); } catch (e) { return h.json({ ok: false, error: "bad key" }, 400); }
    const name = String(b.name || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 60) || "Linux";
    const user = await env.DB.prepare("SELECT * FROM users WHERE github_id = ?").bind(row.github_id).first();
    if (!user || !h.privateOk(env, user.github_id)) return h.json({ ok: false, error: "denied" }, 403);
    // 口令只用一次：先占住（两台同时拿同一个口令来，只有一台成）
    const take = await env.DB.prepare("UPDATE server_tokens SET used = 1, used_at = ?, used_name = ? WHERE hash = ? AND used = 0 AND expires > ?").bind(now(), name, row.hash, now()).run();
    if (!take.meta || take.meta.changes !== 1) return h.json({ ok: false, error: "used", message: "This install command was already used. Copy a new one from Devices in Vibing Studio." }, 400);
    const id = b64u(crypto.getRandomValues(new Uint8Array(16)));
    await env.DB.prepare("INSERT INTO devicekeys (id, github_id, pub, name, created) VALUES (?, ?, ?, ?, ?)").bind(id, user.github_id, b64u(raw), name, now()).run();
    return h.json({ ok: true, id, login: user.login });
  }

  // ---- 安装脚本、安装要下的东西（不用登录，凭口令）----
  const m = /^\/s\/([A-Za-z0-9_-]{43})(?:\/(server\.json|pkg|node\/(x64|arm64)))?$/.exec(url.pathname);
  if (!m) return h.json({ error: "not found" }, 404);
  const row = await tokenRow(env, m[1]), live = !!row && row.expires > now();
  if (!m[2]) {
    if (!live) return shFail("这条安装命令已过期。请在 Vibing Studio 的「设备」里点「添加服务器」，复制新的命令。", "This install command has expired. In Vibing Studio, open Devices › Add Server and copy a new command.");
    if (row.used) return shFail("这条安装命令已经用过了。请在 Vibing Studio 的「设备」里点「添加服务器」，复制新的命令。", "This install command was already used. In Vibing Studio, open Devices › Add Server and copy a new command.");
    const r = await env.ASSETS.fetch(new Request(origin + "/downloads/server/install.sh"));
    if (!r.ok) return shFail("服务器版还没有发布。", "The server edition hasn't been published yet.");
    const body = (await r.text()).replace(/__VS_ORIGIN__/g, origin).replace(/__VS_TOKEN__/g, m[1]);
    return sh(body);
  }
  if (!live) return new Response("expired", { status: 410 });
  if (m[2] === "server.json") {
    const mf = await manifest(env, origin);
    return mf ? h.json(mf) : new Response("not published", { status: 404 });
  }
  if (m[2] === "pkg") {
    const mf = await manifest(env, origin);
    if (!mf || !mf.pkg || !mf.pkg.file) return new Response("not published", { status: 404 });
    return stream(env, origin, Array.isArray(mf.pkg.parts) && mf.pkg.parts.length ? mf.pkg.parts : [mf.pkg.file], mf.pkg.size, mf.pkg.file);
  }
  return nodeFor(env, origin, m[3]);
}
