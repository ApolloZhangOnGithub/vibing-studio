// passkey.js —— 通行密钥（WebAuthn）：GitHub 之外的另一种登录（Touch ID、Face ID、手机、安全密钥）。
//   加：登录着的账号在 /account/passkeys 这一页加（navigator.credentials.create）；可以加几把、改名、删掉。
//   登：登录页和 App 在系统浏览器里打开的登录页都有「使用通行密钥登录」（navigator.credentials.get，可发现的凭据：不用先输账号）。
//   只存公钥（COSE 原样）和计数；验签用 WebCrypto（ES256 / RS256 / Ed25519）；不要证明（attestation: none，同大多数网站）。
//   挑战（challenge）存在库里：5 分钟内、只能用一次；登录的那一个记着这次要回哪（网页的 next，或者 App 的 challenge / 本机端口）
//   另有「用 Touch ID 登录」（devicekeys）：macOS App 在 Secure Enclave 里生成的一把钥匙（拿不出来、每次用都要按指纹）——登录着时把公钥登记上来；
//   以后 App 要登录就不用开浏览器：要一个随机数 → 按指纹签名 → 交回来换一个一次性的 code（同浏览器那条路，App 再拿 code + verifier 换会话）
const enc = new TextEncoder(), dec = new TextDecoder();
const now = () => Date.now();
const b64u = (buf) => { const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf); let s = ""; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const unb64u = (str) => { const s = String(str || "").replace(/-/g, "+").replace(/_/g, "/"); const bin = atob(s + "===".slice((s.length + 3) % 4)); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const sha256 = async (u8) => new Uint8Array(await crypto.subtle.digest("SHA-256", u8));
const eq = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; };
const cat = (a, b) => { const o = new Uint8Array(a.length + b.length); o.set(a, 0); o.set(b, a.length); return o; };

// ---- 库：第一次用到时建表（同 translate.js） ----
const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS passkeys (id TEXT PRIMARY KEY, github_id INTEGER NOT NULL, public_key TEXT NOT NULL, alg INTEGER NOT NULL, sign_count INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, last_used INTEGER)",
  "CREATE INDEX IF NOT EXISTS passkeys_by_user ON passkeys (github_id)",
  "CREATE TABLE IF NOT EXISTS webauthn_challenges (challenge TEXT PRIMARY KEY, kind TEXT NOT NULL, github_id INTEGER, extra TEXT, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS devicekeys (id TEXT PRIMARY KEY, github_id INTEGER NOT NULL, pub TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, last_used INTEGER)",
  "CREATE INDEX IF NOT EXISTS devicekeys_by_user ON devicekeys (github_id)",
];
let ready = null;
const ensure = (env) => (ready = ready || env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s))).catch((e) => { ready = null; throw e; }));

// ---- CBOR（只要 WebAuthn 用到的那几种：整数、字节串、文本、数组、映射、true / false / null）----
function cbor(u8) {
  let i = 0;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const len = (ai) => {
    if (ai < 24) return ai;
    if (ai === 24) return u8[i++];
    if (ai === 25) { const v = dv.getUint16(i); i += 2; return v; }
    if (ai === 26) { const v = dv.getUint32(i); i += 4; return v; }
    if (ai === 27) { const v = dv.getUint32(i) * 4294967296 + dv.getUint32(i + 4); i += 8; return v; }
    throw new Error("cbor: unsupported length");
  };
  const item = () => {
    if (i >= u8.length) throw new Error("cbor: truncated");
    const b = u8[i++], mt = b >> 5, ai = b & 31;
    if (mt === 0) return len(ai);
    if (mt === 1) return -1 - len(ai);
    if (mt === 2) { const n = len(ai); const v = u8.slice(i, i + n); i += n; return v; }
    if (mt === 3) { const n = len(ai); const v = dec.decode(u8.subarray(i, i + n)); i += n; return v; }
    if (mt === 4) { const n = len(ai), a = []; for (let k = 0; k < n; k++) a.push(item()); return a; }
    if (mt === 5) { const n = len(ai), m = new Map(); for (let k = 0; k < n; k++) { const key = item(); m.set(key, item()); } return m; }
    if (mt === 6) { len(ai); return item(); }
    if (ai === 20) return false;
    if (ai === 21) return true;
    if (ai === 22 || ai === 23) return null;
    throw new Error("cbor: unsupported item");
  };
  const value = item();
  return { value, end: i };
}

// 认证器数据：rpIdHash(32) flags(1) signCount(4) [aaguid(16) credIdLen(2) credId credentialPublicKey(COSE)]
function authData(a) {
  if (a.length < 37) throw new Error("authenticator data too short");
  const flags = a[32], out = { rpIdHash: a.subarray(0, 32), up: !!(flags & 1), uv: !!(flags & 4), at: !!(flags & 64), signCount: new DataView(a.buffer, a.byteOffset + 33, 4).getUint32(0) };
  if (out.at) {
    const n = (a[53] << 8) | a[54];
    out.credId = a.slice(55, 55 + n);
    const rest = a.subarray(55 + n), c = cbor(rest);
    out.cose = c.value; out.coseBytes = rest.slice(0, c.end);
  }
  return out;
}

// 签名（DER 的 SEQUENCE { r, s }）→ WebCrypto 要的 r‖s
function derToRaw(der, n) {
  let i = 2;
  if (der[0] !== 0x30) throw new Error("bad signature");
  if (der[1] & 0x80) i = 2 + (der[1] & 0x7f);
  const part = () => {
    if (der[i++] !== 0x02) throw new Error("bad signature");
    const l = der[i++]; let v = der.subarray(i, i + l); i += l;
    while (v.length > n && v[0] === 0) v = v.subarray(1);
    const o = new Uint8Array(n); o.set(v, n - v.length); return o;
  };
  return cat(part(), part());
}

// COSE 公钥 → 验签的函数
async function verifier(cose) {
  const kty = cose.get(1), alg = cose.get(3);
  if (kty === 2 && cose.get(-1) === 1) {
    const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: b64u(cose.get(-2)), y: b64u(cose.get(-3)), ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return { alg: alg || -7, verify: (sig, data) => crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(sig, 32), data) };
  }
  if (kty === 3) {
    const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: b64u(cose.get(-1)), e: b64u(cose.get(-2)), alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return { alg: alg || -257, verify: (sig, data) => crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, data) };
  }
  if (kty === 1 && cose.get(-1) === 6) {
    const key = await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: b64u(cose.get(-2)), ext: true }, { name: "Ed25519" }, false, ["verify"]);
    return { alg: -8, verify: (sig, data) => crypto.subtle.verify({ name: "Ed25519" }, key, sig, data) };
  }
  throw new Error("unsupported passkey type");
}

async function newChallenge(env, kind, githubId, extra) {
  const c = b64u(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare("INSERT INTO webauthn_challenges (challenge, kind, github_id, extra, expires) VALUES (?, ?, ?, ?, ?)").bind(c, kind, githubId || null, extra ? JSON.stringify(extra) : null, now() + 300e3).run();
  return c;
}
async function takeChallenge(env, c, kind) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(c || "")) return null;
  return env.DB.prepare("UPDATE webauthn_challenges SET used = 1 WHERE challenge = ? AND kind = ? AND used = 0 AND expires > ? RETURNING github_id, extra").bind(c, kind, now()).first();
}
function clientData(bytes, type, challenge, originOk) {
  let cd = null;
  try { cd = JSON.parse(dec.decode(bytes)); } catch { cd = null; }
  if (!cd || cd.type !== type) throw new Error("wrong ceremony");
  if (cd.challenge !== challenge) throw new Error("challenge mismatch");
  if (!originOk(cd.origin)) throw new Error("origin mismatch");
  return cd;
}
const readJSON = async (req) => { try { return await req.json(); } catch { return null; } };

// ---- 路由（index.js 转过来的）----
// h：index.js 给的工具——{ currentUser, json, sessionHeaders(url, user), appRedirect(env, user, challenge, port), appChallenge, appPort, safeNext, privateOk }
export async function passkey(req, env, url, h) {
  await ensure(env);
  // 认证器记下的源：就是这个站（线上 https://code.paimon.beer）；本地开发（wrangler dev）时 Worker 看到的网址不带端口，localhost 的哪个端口都认
  const originOk = (o) => { try { const x = new URL(o); return x.origin === url.origin || (url.hostname === "localhost" && x.hostname === "localhost"); } catch { return false; } };
  const { json } = h, rpId = url.hostname;
  // 登录：要一个挑战（可发现的凭据：不列 allowCredentials，浏览器让你选是哪一把）
  if (url.pathname === "/auth/passkey/options" && req.method === "POST") {
    const b = (await readJSON(req)) || {};
    const extra = { next: h.safeNext(b.next || "/"), app: h.appChallenge(b.app), port: h.appPort(String(b.port || "")) };
    const challenge = await newChallenge(env, "login", null, extra);
    return json({ challenge, rpId, timeout: 120000, userVerification: "preferred" });
  }
  if (url.pathname === "/auth/passkey/login" && req.method === "POST") {
    const b = await readJSON(req);
    try {
      if (!b || !b.response) throw new Error("bad request");
      const ch = await takeChallenge(env, b.challenge, "login");
      if (!ch) throw new Error("This sign-in request expired. Try again.");
      const cdBytes = unb64u(b.response.clientDataJSON), adBytes = unb64u(b.response.authenticatorData), sig = unb64u(b.response.signature);
      clientData(cdBytes, "webauthn.get", b.challenge, originOk);
      const ad = authData(adBytes);
      if (!eq(ad.rpIdHash, await sha256(enc.encode(rpId)))) throw new Error("wrong site");
      if (!ad.up) throw new Error("user presence missing");
      const row = await env.DB.prepare("SELECT * FROM passkeys WHERE id = ?").bind(String(b.id || "")).first();
      if (!row) throw new Error("This passkey isn't registered here. Sign in with GitHub, then add it in Passkeys.");
      const v = await verifier(cbor(unb64u(row.public_key)).value);
      if (!(await v.verify(sig, cat(adBytes, await sha256(cdBytes))))) throw new Error("signature check failed");
      if (ad.signCount && row.sign_count && ad.signCount <= row.sign_count) throw new Error("passkey counter went backwards");
      await env.DB.prepare("UPDATE passkeys SET sign_count = ?, last_used = ? WHERE id = ?").bind(ad.signCount || 0, now(), row.id).run();
      const user = await env.DB.prepare("SELECT * FROM users WHERE github_id = ?").bind(row.github_id).first();
      if (!user || !h.privateOk(env, user.github_id)) throw new Error("This is a private site.");
      const extra = ch.extra ? JSON.parse(ch.extra) : {};
      if (extra.app) return json({ ok: true, redirect: await h.appRedirect(env, user, extra.app, extra.port) }); // App 在系统浏览器里发起的：交给 App 一个一次性的 code
      return json({ ok: true, redirect: extra.next || "/" }, 200, await h.sessionHeaders(env, url, user));
    } catch (e) {
      return json({ ok: false, error: String((e && e.message) || e) }, 400);
    }
  }
  // 用 Touch ID 登录（macOS App）：要随机数（带着 App 这次的 PKCE challenge）→ App 按指纹签「vs-devicekey-v1\n随机数」→ 验对了给一个一次性的 code
  if (url.pathname === "/auth/devicekey/options" && req.method === "POST") {
    const b = (await readJSON(req)) || {}, id = String(b.id || ""), app = h.appChallenge(b.app);
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(id) || !app) return json({ ok: false, error: "bad request" }, 400);
    return json({ ok: true, challenge: await newChallenge(env, "devicekey", null, { id, app }) });
  }
  if (url.pathname === "/auth/devicekey/login" && req.method === "POST") {
    const b = (await readJSON(req)) || {};
    try {
      const ch = await takeChallenge(env, b.challenge, "devicekey"), extra = ch && ch.extra ? JSON.parse(ch.extra) : null;
      if (!ch || !extra || extra.id !== String(b.id || "")) throw new Error("This sign-in request expired. Try again.");
      const row = await env.DB.prepare("SELECT * FROM devicekeys WHERE id = ?").bind(extra.id).first();
      if (!row) throw new Error("Touch ID sign-in isn't set up for this Mac anymore. Sign in with GitHub.");
      const key = await crypto.subtle.importKey("raw", unb64u(row.pub), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(unb64u(b.sig), 32), enc.encode("vs-devicekey-v1\n" + b.challenge));
      if (!ok) throw new Error("signature check failed");
      const user = await env.DB.prepare("SELECT * FROM users WHERE github_id = ?").bind(row.github_id).first();
      if (!user || !h.privateOk(env, user.github_id)) throw new Error("This is a private site.");
      await env.DB.prepare("UPDATE devicekeys SET last_used = ? WHERE id = ?").bind(now(), row.id).run();
      const back = await h.appRedirect(env, user, extra.app, ""), code = /[?&]code=([A-Za-z0-9_-]+)/.exec(back);
      return json({ ok: true, code: code ? code[1] : "" });
    } catch (e) {
      return json({ ok: false, error: String((e && e.message) || e) }, 400);
    }
  }
  // 下面的都要登录着
  const user = await h.currentUser(req, env);
  if (url.pathname === "/account/passkeys") {
    if (!user) return new Response(null, { status: 302, headers: { location: "/auth/login?next=" + encodeURIComponent("/account/passkeys") } });
    return passkeysPage(user);
  }
  if (!user) return json({ error: "Not signed in" }, 401);
  if (url.pathname === "/api/passkeys" && req.method === "GET") {
    const r = await env.DB.prepare("SELECT id, name, created, last_used FROM passkeys WHERE github_id = ? ORDER BY created").bind(user.github_id).all();
    return json({ passkeys: r.results || [] });
  }
  if (url.pathname === "/api/passkey/register/options" && req.method === "POST") {
    const have = await env.DB.prepare("SELECT id FROM passkeys WHERE github_id = ?").bind(user.github_id).all();
    const challenge = await newChallenge(env, "register", user.github_id, null);
    return json({
      challenge, rp: { id: rpId, name: "Vibing Studio" },
      user: { id: b64u(enc.encode("gh:" + user.github_id)), name: user.login || String(user.github_id), displayName: user.login || String(user.github_id) },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -8 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "preferred" },
      excludeCredentials: (have.results || []).map((x) => ({ type: "public-key", id: x.id })),
      attestation: "none", timeout: 120000,
    });
  }
  if (url.pathname === "/api/passkey/register" && req.method === "POST") {
    const b = await readJSON(req);
    try {
      if (!b || !b.response) throw new Error("bad request");
      const ch = await takeChallenge(env, b.challenge, "register");
      if (!ch || ch.github_id !== user.github_id) throw new Error("This request expired. Try again.");
      clientData(unb64u(b.response.clientDataJSON), "webauthn.create", b.challenge, originOk);
      const att = cbor(unb64u(b.response.attestationObject)).value;
      const ad = authData(att.get("authData"));
      if (!eq(ad.rpIdHash, await sha256(enc.encode(rpId)))) throw new Error("wrong site");
      if (!ad.up || !ad.at || !ad.cose) throw new Error("no credential in the response");
      const v = await verifier(ad.cose); // 能用来验签的才存
      const id = b64u(ad.credId), name = String(b.name || "").trim().slice(0, 60) || "Passkey";
      await env.DB.prepare("INSERT INTO passkeys (id, github_id, public_key, alg, sign_count, name, created) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, user.github_id, b64u(ad.coseBytes), v.alg, ad.signCount || 0, name, now()).run();
      return json({ ok: true, id, name });
    } catch (e) {
      return json({ ok: false, error: String((e && e.message) || e) }, 400);
    }
  }
  // Touch ID 的钥匙：登记（App 生成了以后，公钥是 65 字节的未压缩点）、列出、改名、移除
  if (url.pathname === "/api/devicekeys" && req.method === "GET") {
    const r = await env.DB.prepare("SELECT id, name, created, last_used FROM devicekeys WHERE github_id = ? ORDER BY created").bind(user.github_id).all();
    return json({ devicekeys: r.results || [] });
  }
  if (url.pathname === "/api/devicekey/register" && req.method === "POST") {
    const b = (await readJSON(req)) || {}, pub = String(b.pub || "");
    let raw = null; try { raw = unb64u(pub); } catch { raw = null; }
    if (!raw || raw.length !== 65 || raw[0] !== 4) return json({ ok: false, error: "bad public key" }, 400);
    try { await crypto.subtle.importKey("raw", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]); } catch { return json({ ok: false, error: "bad public key" }, 400); }
    const id = b64u(crypto.getRandomValues(new Uint8Array(18))), name = String(b.name || "").trim().slice(0, 60) || "Mac";
    await env.DB.prepare("INSERT INTO devicekeys (id, github_id, pub, name, created) VALUES (?, ?, ?, ?, ?)").bind(id, user.github_id, b64u(raw), name, now()).run();
    return json({ ok: true, id, name });
  }
  if (url.pathname === "/api/devicekey/rename" && req.method === "POST") {
    const b = (await readJSON(req)) || {};
    await env.DB.prepare("UPDATE devicekeys SET name = ? WHERE id = ? AND github_id = ?").bind(String(b.name || "").trim().slice(0, 60) || "Mac", String(b.id || ""), user.github_id).run();
    return json({ ok: true });
  }
  if (url.pathname === "/api/devicekey/remove" && req.method === "POST") {
    const b = (await readJSON(req)) || {};
    await env.DB.prepare("DELETE FROM devicekeys WHERE id = ? AND github_id = ?").bind(String(b.id || ""), user.github_id).run();
    return json({ ok: true });
  }
  if (url.pathname === "/api/passkey/rename" && req.method === "POST") {
    const b = (await readJSON(req)) || {};
    await env.DB.prepare("UPDATE passkeys SET name = ? WHERE id = ? AND github_id = ?").bind(String(b.name || "").trim().slice(0, 60) || "Passkey", String(b.id || ""), user.github_id).run();
    return json({ ok: true });
  }
  if (url.pathname === "/api/passkey/delete" && req.method === "POST") {
    const b = (await readJSON(req)) || {};
    await env.DB.prepare("DELETE FROM passkeys WHERE id = ? AND github_id = ?").bind(String(b.id || ""), user.github_id).run();
    return json({ ok: true });
  }
  return json({ error: "not found" }, 404);
}

// ---- 浏览器里那一段：登录（get）、加（create）共用的编码 ----
export const PASSKEY_JS = `
var b64u=function(b){var u=new Uint8Array(b),s="";for(var i=0;i<u.length;i++)s+=String.fromCharCode(u[i]);return btoa(s).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"");};
var unb64u=function(s){s=String(s).replace(/-/g,"+").replace(/_/g,"/");var b=atob(s+"===".slice((s.length+3)%4)),u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u;};
var post=function(p,b){return fetch(p,{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify(b||{})}).then(function(r){return r.json();});};
// 通行密钥用不用得了：浏览器说有这台设备上的（Touch ID、Windows Hello）或者能用手机的才露出按钮（App 里的网页、老浏览器不露）
function passkeyUsable(){
  if(!window.PublicKeyCredential)return Promise.resolve(false);
  if(PublicKeyCredential.getClientCapabilities)return PublicKeyCredential.getClientCapabilities().then(function(c){return !!(c&&(c.passkeyPlatformAuthenticator||c.userVerifyingPlatformAuthenticator||c.hybridTransport));},function(){return false;});
  return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(function(){return false;}):Promise.resolve(false);
}
function passkeyLogin(ctx,msg){
  if(!window.PublicKeyCredential){msg("这个浏览器不支持通行密钥");return;}
  msg("");
  post("/auth/passkey/options",ctx).then(function(o){
    return navigator.credentials.get({publicKey:{challenge:unb64u(o.challenge),rpId:o.rpId,timeout:o.timeout,userVerification:o.userVerification}}).then(function(c){
      return post("/auth/passkey/login",{challenge:o.challenge,id:c.id,response:{clientDataJSON:b64u(c.response.clientDataJSON),authenticatorData:b64u(c.response.authenticatorData),signature:b64u(c.response.signature),userHandle:c.response.userHandle?b64u(c.response.userHandle):null}});
    });
  }).then(function(r){if(r&&r.ok){location.href=r.redirect;}else{msg((r&&r.error)||"登录没有成功");}},function(e){msg(e&&e.name==="NotAllowedError"?"已取消":"登录没有成功："+(e&&e.message||e));});
}`;

const KEY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 3a6.5 6.5 0 0 0-6.2 8.4L2.3 17.4a1 1 0 0 0-.3.7V21a1 1 0 0 0 1 1h2.9a1 1 0 0 0 1-1v-1.3h1.4a1 1 0 0 0 1-1v-1.4h1.4a1 1 0 0 0 .7-.3l1.2-1.2A6.5 6.5 0 1 0 14.5 3zm2 6a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4z" fill="currentColor"/></svg>';
export const passkeyIcon = KEY_SVG;

// ---- /account/passkeys：你的通行密钥（列表、加、改名、删）----
function passkeysPage(user) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  return new Response(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><meta name="color-scheme" content="light dark"><title>通行密钥 · Vibing Studio</title>
<style>
html,body{margin:0}
body{font:15px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#1d1d1f;background:#f5f5f7}
main{max-width:560px;margin:56px auto;padding:0 24px}
h1{font-size:24px;font-weight:700;margin:0 0 6px}
.sub{color:#6e6e73;font-size:14px;margin:0 0 22px;line-height:1.5}
ul{list-style:none;margin:0 0 18px;padding:0;border-radius:12px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.08)}
li{display:flex;align-items:center;gap:12px;padding:12px 16px;border-top:1px solid rgba(0,0,0,.07)}
li:first-child{border-top:0}
li svg{width:20px;height:20px;color:#6e6e73;flex:none}
.nm{flex:1;min-width:0}.nm b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.nm span{color:#6e6e73;font-size:12.5px}
button{font:inherit;border:0;border-radius:8px;padding:6px 12px;background:rgba(0,0,0,.06);color:inherit;cursor:pointer}
button:hover{background:rgba(0,0,0,.1)}
button.pri{background:#0a84ff;color:#fff;padding:9px 18px;border-radius:999px;font-weight:600}
button.pri:hover{background:#0071e3}
.none{padding:16px;color:#6e6e73}
.msg{min-height:20px;margin-top:12px;color:#d70015;font-size:13.5px}
a.back{color:#0a84ff;text-decoration:none;font-size:14px}
@media (prefers-color-scheme:dark){body{color:#f5f5f7;background:#111113}.sub,.nm span,li svg,.none{color:#a1a1a6}ul{background:#1c1c1e;box-shadow:none}li{border-top-color:rgba(255,255,255,.08)}button{background:rgba(255,255,255,.1)}button:hover{background:rgba(255,255,255,.16)}.msg{color:#ff6961}}
</style></head><body><main>
<h1>通行密钥</h1>
<p class="sub">用 Touch ID、Face ID、手机或安全密钥登录 Vibing Studio，不用每次都经过 GitHub。账号：${esc(user.login || user.github_id)}</p>
<ul id="list"><li class="none">读取中…</li></ul>
<button class="pri" id="add" hidden>添加通行密钥</button>
<div class="msg" id="msg"></div>
<p><a class="back" href="/">回到 Vibing Studio</a></p>
</main>
<script>${PASSKEY_JS}
var KEY=${JSON.stringify(KEY_SVG)},listEl=document.getElementById("list"),msgEl=document.getElementById("msg");
var msg=function(t){msgEl.textContent=t||"";};
var when=function(t){if(!t)return "从未使用";var d=new Date(t);return d.toLocaleDateString()+" "+d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});};
var esc=function(s){return String(s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});};
function load(){fetch("/api/passkeys",{credentials:"same-origin"}).then(function(r){return r.json();}).then(function(d){var l=d.passkeys||[];
  listEl.innerHTML=l.length?l.map(function(x){return '<li data-id="'+esc(x.id)+'">'+KEY+'<div class="nm"><b>'+esc(x.name)+'</b><span>添加于 '+when(x.created)+' · 上次使用 '+when(x.last_used)+'</span></div><button data-a="ren">重命名</button><button data-a="del">删除</button></li>';}).join(""):'<li class="none">还没有通行密钥</li>';});}
listEl.addEventListener("click",function(e){var b=e.target.closest("button"),li=e.target.closest("li");if(!b||!li)return;var id=li.dataset.id;
  if(b.dataset.a==="del"){if(confirm("删除这个通行密钥？之后就不能用它登录了（设备上的那一份要在系统设置里另外删）。"))post("/api/passkey/delete",{id:id}).then(load);}
  if(b.dataset.a==="ren"){var n=prompt("名称",li.querySelector("b").textContent);if(n)post("/api/passkey/rename",{id:id,name:n}).then(load);}});
document.getElementById("add").addEventListener("click",function(){
  if(!window.PublicKeyCredential){msg("这个浏览器不支持通行密钥");return;}
  msg("");
  post("/api/passkey/register/options").then(function(o){
    var pk={challenge:unb64u(o.challenge),rp:o.rp,user:{id:unb64u(o.user.id),name:o.user.name,displayName:o.user.displayName},pubKeyCredParams:o.pubKeyCredParams,authenticatorSelection:o.authenticatorSelection,attestation:o.attestation,timeout:o.timeout,excludeCredentials:(o.excludeCredentials||[]).map(function(x){return {type:"public-key",id:unb64u(x.id)};})};
    return navigator.credentials.create({publicKey:pk}).then(function(c){
      var name=(navigator.userAgentData&&navigator.userAgentData.platform)||(/Mac/.test(navigator.platform)?"Mac":/iPhone|iPad/.test(navigator.userAgent)?"iPhone / iPad":/Linux/.test(navigator.platform)?"Linux":"Passkey");
      return post("/api/passkey/register",{challenge:o.challenge,name:name,response:{clientDataJSON:b64u(c.response.clientDataJSON),attestationObject:b64u(c.response.attestationObject)}});
    });
  }).then(function(r){if(r&&r.ok){load();}else{msg((r&&r.error)||"没有添加成功");}},function(e){msg(e&&e.name==="NotAllowedError"?"已取消":e&&e.name==="InvalidStateError"?"这台设备上已经有一个了":"没有添加成功："+(e&&e.message||e));});
});
load();
passkeyUsable().then(function(ok){document.getElementById("add").hidden=!ok;if(!ok)msg("这个浏览器、这台设备不能创建通行密钥（要 Touch ID、Face ID、Windows Hello，或者能用手机的浏览器）。在 macOS App 里可以改用 Touch ID 登录：设置 › 账号。");});
</script></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
