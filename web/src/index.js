// index.js —— code.paimon.beer 的 Worker：GitHub 登录（邀请制）、会话 Cookie、额度账本（人民币）、模型流式代理（Anthropic 格式，默认接 DeepSeek）。
import { fetchPage } from "./fetch.js";
import { account } from "./account.js";
import { translate, translateUsage, svcLog } from "./translate.js";
import { passkey, PASSKEY_JS, passkeyIcon } from "./passkey.js";
import { server } from "./server.js";
export { Relay } from "./relay.js"; // iPad 端借 Mac 干活的中转（Durable Object，见 relay.js）
// 浏览器只拿到一个签名的会话 Cookie（HttpOnly，JS 读不到）；GitHub token 用完即弃，Anthropic Key 只在 Worker Secret 里。
// 路由：/auth/login → GitHub → /auth/callback；/auth/logout；/api/me；/api/chat（SSE 原样转给浏览器，另一路读完记账）；
// /api/tools/brave（搜索）、/api/tools/fetch（抓网页）；/api/admin/*（管理员加额度、放行账号）；
// /api/sync、/api/store、/api/lease、/api/devices、/api/notices（跟着账号走的数据，见 account.js）。
// 其余是网页本身（public/）：私人站点，没登录只给登录页——网页的脚本、样式、图片一样都不给
// 金额一律是「微元」整数：1 000 000 = ¥1
const COOKIE = "tsu_s";
const STATE_COOKIE = "tsu_state";
const APP_COOKIE = "tsu_app"; // 原生 App 发起的登录：记着 App 给的 challenge，回调时给 App 一个一次性的 code
const NEXT_COOKIE = "tsu_next"; // 登录前要去的那一页（iPad 上打开 /terminal.html?mac=…：登好了回到那里，不是首页）
// 登好了回哪：只认本站的路径（/ 开头、不是 //），可以带查询（?mac=…&open=…）；别的一律回首页
const safeNext = (n) => (/^\/[\w\-./]*(\?[\w\-.=&%:~+]*)?$/.test(n || "") && !String(n).startsWith("//") ? n : "/");
const SESSION_DAYS = 30;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/auth/login") return login(req, env, url);
      if (url.pathname === "/auth/callback") return callback(req, env, url);
      if (url.pathname === "/auth/logout") return logout(url);
      if (url.pathname === "/auth/app") return appLogin(req, env, url);
      // 通行密钥（passkey.js）：登录（/auth/passkey/*）、管理（/account/passkeys、/api/passkeys、/api/passkey/*）
      if (url.pathname.startsWith("/auth/passkey/") || url.pathname === "/account/passkeys" || url.pathname === "/api/passkeys" || url.pathname.startsWith("/api/passkey/") ||
          url.pathname.startsWith("/auth/devicekey/") || url.pathname === "/api/devicekeys" || url.pathname.startsWith("/api/devicekey/")) return passkey(req, env, url, passkeyHelpers); // devicekey：用 Touch ID 登录（macOS App）
      // Linux 服务器版（server.js）：一次性的安装命令（/s/<口令>）、配对（/auth/server/pair）、要口令（/api/server/token）——安装、配对不用登录，凭口令
      if (url.pathname.startsWith("/s/") || url.pathname === "/auth/server/pair" || url.pathname === "/api/server/token" || url.pathname.startsWith("/api/server/node/")) return server(req, env, url, passkeyHelpers);
      if (url.pathname === "/api/me") return me(req, env);
      if (url.pathname === "/api/chat" && req.method === "POST") return chat(req, env, ctx);
      if (url.pathname === "/api/usage") return usage(req, env);
      if (url.pathname === "/api/stats") return stats(req, env, url);
      if (url.pathname === "/api/version") return json({ id: env.CF_VERSION_METADATA ? String(env.CF_VERSION_METADATA.id || "").slice(0, 8) : "", at: env.CF_VERSION_METADATA ? env.CF_VERSION_METADATA.timestamp || "" : "" }); // 线上这一版（部署的版本号、时间）：「有新版本」卡片上写
      if (url.pathname === "/api/translate" && req.method === "POST") return translate(req, env, { currentUser, json, models, priceOf, isPeak, charge, upstreamKey, waitUntil: (p) => ctx.waitUntil(p) }); // 任务翻译（translate.js）
      if (url.pathname === "/api/svclog") return svcLog(req, env, { currentUser, json }); // 服务状态页：这个账号所有设备的翻译请求记录（translate.js）
      if (url.pathname.startsWith("/api/tools/") && req.method === "POST") return tool(req, env, url.pathname.slice(11));
      if (url.pathname.startsWith("/api/sbx/")) return sandbox(req, env, url);
      if (url.pathname.startsWith("/api/admin/") && req.method === "POST") return admin(req, env, url);
      // iPad 端 ↔ Mac：同一个账号一个中转（Relay）；先验会话，只有这个账号自己的设备能连上
      if (url.pathname === "/api/relay/host" || url.pathname === "/api/relay/client" || url.pathname === "/api/relay/hosts") {
        const user = await currentUser(req, env);
        if (!user) return json({ error: "Not signed in" }, 401);
        if (!user.allowed) return json({ error: "Invite only: this account has not been invited yet" }, 403);
        if (!env.RELAY) return json({ error: "relay not configured" }, 501);
        const u2 = new URL(req.url);
        if (url.pathname !== "/api/relay/hosts") u2.searchParams.set("role", url.pathname.slice(11));
        // 新设备来请求时 Mac 上要写清是哪里：Cloudflare 按网络估计的城市、地区、国家，和它的 IP（同 Apple 账户登录新设备时给的位置）
        if (url.pathname === "/api/relay/client") {
          const cf = req.cf || {}, loc = [cf.city, cf.region, cf.country].filter(Boolean).join(", "), ip = req.headers.get("CF-Connecting-IP") || "";
          u2.searchParams.set("loc", (loc + (ip ? (loc ? " · " : "") + "IP " + ip : "")).slice(0, 120));
        }
        return env.RELAY.get(env.RELAY.idFromName("u:" + user.github_id)).fetch(new Request(u2.toString(), req));
      }
      if (/^\/api\/(sync|store|lease|devices|notices)$/.test(url.pathname)) {
        const user = await currentUser(req, env);
        if (!user) return json({ error: "Not signed in" }, 401);
        if (!user.allowed) return json({ error: "Invite only: this account has not been invited yet" }, 403);
        return account(req, env, url, user, json);
      }
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return json({ error: "not found" }, 404);
      return site(req, env, url);
    } catch (e) {
      console.error(e);
      return json({ error: "internal error" }, 500);
    }
  },
};

// ---- 网页本身：没登录（或不是名单里的账号）只给登录页；登录了照常给 public/ 里的文件。
// 静态文件只验会话 Cookie 的签名（不查库，页面上几十个文件不用各查一次）；index.html 不缓存 ----
async function site(req, env, url) {
  let s = null;
  try { s = await readSession(req, env); } catch { s = null; }
  const isPage = url.pathname === "/" || /^\/[\w-]+(?:\.html)?$/.test(url.pathname); // 网页：App（terminal.html，/ 就是它）、桌面模拟器（index.html，在 /simulator）
  // 加到主屏幕（iPad 的 Safari）：清单和图标不带登录也给——Safari 取它们时不一定带上会话 Cookie；这几个文件没有任何私人内容
  const pwa = /^\/(manifest\.webmanifest|img\/(apple-touch-icon|app-icon-192|app-icon-512)\.png)$/.test(url.pathname);
  if ((!s || !privateOk(env, s.id)) && pwa && env.ASSETS) return env.ASSETS.fetch(req);
  if (!s || !privateOk(env, s.id)) {
    if (isPage || (req.headers.get("accept") || "").includes("text/html")) return loginPage(url.pathname + url.search);
    return new Response("Not signed in", { status: 401, headers: { "cache-control": "no-store" } });
  }
  // Linux 版的 AppImage 一整个下载（/downloads/linux/latest/x64.AppImage、arm64）：网站上一个文件最多 25 MB，它切成了几段（tools/release-linux.sh）——
  //   这里按 linux.json 一段段接着流出去，浏览器里点一下就是完整的一个文件（第一次装、deb 换成 AppImage 时用；装好以后 App 自己更新）
  const la = /^\/downloads\/linux\/latest\/(x64|arm64)\.AppImage$/.exec(url.pathname);
  if (la && env.ASSETS) {
    const mr = await env.ASSETS.fetch(new Request(url.origin + "/downloads/linux.json"));
    const m = mr.ok ? await mr.json().catch(() => null) : null, e = m && m[la[1]];
    if (!e || !Array.isArray(e.parts)) return new Response("No Linux build yet", { status: 404 });
    const { readable, writable } = new TransformStream();
    (async () => { try { for (const p of e.parts) { const r0 = await env.ASSETS.fetch(new Request(url.origin + "/" + p)); if (!r0.ok || !r0.body) throw new Error("part " + p); await r0.body.pipeTo(writable, { preventClose: true }); } await writable.close(); } catch (err) { await writable.abort(err); } })();
    return new Response(readable, { headers: { "content-type": "application/octet-stream", "content-length": String(e.size || ""), "content-disposition": 'attachment; filename="Vibing-Studio-' + m.version + "-" + (la[1] === "x64" ? "x86_64" : "arm64") + '.AppImage"', "cache-control": "private, no-store" } });
  }
  // 线上：页面里引用的脚本、样式地址带上这次部署的版本号（?v=，见下面改页面那里），这样的请求让浏览器（App 里的 WKWebView）存一年、不再问——
  // 以前 60 来个文件每次启动都要各问一遍「改了没有」（线上每个一个来回），第一帧要等它们。部署了新版本，页面里的地址跟着变，旧的自然不再用。
  // 本地开发（DEV_STATIC）不带：文件随时在改
  const ver = !env.DEV_STATIC && env.CF_VERSION_METADATA && env.CF_VERSION_METADATA.id ? String(env.CF_VERSION_METADATA.id).slice(0, 8) : "";
  const pinned = !!ver && !isPage && url.searchParams.get("v") === ver;
  // 网页按它在静态文件里的规范地址去取：静态文件那一层会把 /terminal.html 307 到 /terminal（多一个来回，而且跳过去以后不算网页、账号 id 没写进去——同步就断了），
  // 这里直接取 /terminal 的内容、在原地址给出去
  // 打开网址就是 App 本身（Vibing Studio 的工作台，terminal.html），同 iPhone、iPad 的 App；桌面模拟器（一个假的 macOS）只在 /simulator
  const PAGE = { "/": "/terminal", "/index.html": "/terminal", "/simulator": "/", "/simulator.html": "/" };
  const assetPath = isPage ? (PAGE[url.pathname] || (/\.html$/.test(url.pathname) ? url.pathname.slice(0, -5) : url.pathname)) : url.pathname;
  const r = env.DEV_STATIC ? await devStatic(req, env, assetPath !== url.pathname ? new URL(url.origin + assetPath + url.search) : url) : await env.ASSETS.fetch(pinned || assetPath !== url.pathname ? new Request(url.origin + assetPath, req) : req); // 本地开发（dev/run.mjs）：静态文件直接从 public/ 读，改了不重启
  const h = new Headers(r.headers);
  h.set("cache-control", isPage ? "no-store" : pinned && r.ok ? "private, max-age=31536000, immutable" : "private, no-cache"); // 只给登录了的人：别让中间的缓存存一份给别人
  if (isPage && r.ok) {
    // 账号 id 先写进页面：设备上的缓存（agent、对话）按账号分开放，换个账号登录不会串；
    // 配了真沙盒（TSU_SBX）：文件只在服务器上那一份，浏览器里不放示例文件、连不上时等它回来，不在这台设备上另存
    const sbx = !!(env.SANDBOX_URL && env.SANDBOX_KEY);
    let html = (await r.text()).replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<script>window.TSU_UID = ${Number(s.id) || 0}; window.TSU_SBX = ${sbx};</script>`);
    // 站内的 .js / .css（<script src>、<link href>，相对路径）带上版本号：见上面 pinned
    if (ver) html = html.replace(/(<(?:script|link)\b[^>]*?\s(?:src|href)=")(?![a-z][\w+.-]*:|\/\/)([\w./-]+\.(?:js|css))(")/gi, (m, a, p, z) => a + p + "?v=" + ver + z);
    h.delete("content-length");
    h.delete("etag");
    return new Response(html, { status: 200, headers: h });
  }
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
}
// 登录页（同 Mac 的锁屏：日期、时间，下面一个头像和登录按钮）；自带样式，不引用网页的任何文件，也不显示是谁的站点
function lockPage(next) {
  return new Response(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="robots" content="noindex"><meta name="color-scheme" content="dark light"><title>登录</title>
<style>
html,body{height:100%;margin:0}
body{font:15px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#fff;background:radial-gradient(120% 90% at 30% 15%,#43507e 0%,#1f2544 48%,#0b0d18 100%);
  display:flex;flex-direction:column;align-items:center;justify-content:space-between;-webkit-user-select:none;user-select:none;cursor:default}
.clock{margin-top:11vh;text-align:center;text-shadow:0 1px 14px rgba(0,0,0,.2)}
.d{font-size:22px;font-weight:600;opacity:.92}
.t{font-size:clamp(76px,15vw,128px);font-weight:700;letter-spacing:-2px;line-height:1.05;font-variant-numeric:tabular-nums}
.who{margin-bottom:max(11vh,env(safe-area-inset-bottom));display:flex;flex-direction:column;align-items:center;gap:16px}
.av{width:64px;height:64px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px)}
.av svg{width:40px;height:40px;fill:rgba(255,255,255,.85)}
a{display:inline-flex;align-items:center;gap:8px;padding:7px 18px;border-radius:999px;background:rgba(255,255,255,.2);color:#fff;text-decoration:none;font-size:14px;-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px)}
a:hover{background:rgba(255,255,255,.3)}
a svg{width:16px;height:16px;fill:#fff}
@media (prefers-color-scheme:light){
  body{color:#1d1d1f;background:radial-gradient(120% 90% at 30% 15%,#eef1fb 0%,#dfe4f3 48%,#cfd6ea 100%)}
  .clock{text-shadow:none}
  .av{background:rgba(0,0,0,.07)} .av svg{fill:rgba(0,0,0,.5)}
  a{background:rgba(0,0,0,.07);color:#1d1d1f} a:hover{background:rgba(0,0,0,.12)} a svg{fill:#1d1d1f}
}
</style></head><body>
<div class="clock"><div class="d" id="d"></div><div class="t" id="t"></div></div>
<div class="who"><div class="av"><svg viewBox="0 0 24 24"><path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5z"/></svg></div>
<a href="/auth/login${next && next !== "/" ? "?next=" + encodeURIComponent(safeNext(next)) : ""}"><svg viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>使用 GitHub 登录</a></div>
<script>(function(){var t=document.getElementById("t"),d=document.getElementById("d");function f(){var n=new Date();t.textContent=n.toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit",hour12:false});d.textContent=n.toLocaleDateString("zh-CN",{month:"long",day:"numeric",weekday:"long"})}f();setInterval(f,1000)})()</script>
</body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
// 登录页：Vibing Studio 自己的样子——图标、名字、「使用 GitHub 登录」，跟着系统深浅；不引用网页的任何文件（图标是不用登录也给的那一个）。
//   去桌面模拟器（/simulator）的还是锁屏那一页
function loginPage(next, appCtx) {
  if (/^\/simulator\b/.test(next || "") && !appCtx) return lockPage(next);
  const nx = next && next !== "/" ? safeNext(next) : "/";
  // App 在系统浏览器里打开的（appCtx：App 的 challenge、本机端口）：GitHub 那个按钮走原来的路（go=github），通行密钥登好了交回 App
  const href = appCtx ? "/auth/login?app=" + appCtx.app + (appCtx.port ? "&port=" + appCtx.port : "") + (nx !== "/" ? "&next=" + encodeURIComponent(nx) : "") + "&go=github" : "/auth/login" + (nx !== "/" ? "?next=" + encodeURIComponent(nx) : "");
  const pkCtx = JSON.stringify(Object.assign({ next: nx }, appCtx ? { app: appCtx.app, port: appCtx.port || "" } : {})).replace(/</g, "\\u003c");
  return new Response(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="robots" content="noindex"><meta name="color-scheme" content="light dark"><title>Vibing Studio</title>
<style>
html,body{height:100%;margin:0}
body{font:15px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#1d1d1f;background:#f5f5f7;display:flex;align-items:center;justify-content:center;-webkit-user-select:none;user-select:none}
main{display:flex;flex-direction:column;align-items:center;gap:14px;padding:24px;text-align:center}
img{width:88px;height:88px;border-radius:20px;box-shadow:0 6px 22px rgba(0,0,0,.14)}
h1{margin:6px 0 0;font-size:26px;font-weight:700;letter-spacing:-.3px}
p{margin:0;color:#6e6e73;font-size:14px}
a{margin-top:10px;display:inline-flex;align-items:center;gap:8px;padding:9px 20px;border-radius:999px;background:#1d1d1f;color:#fff;text-decoration:none;font-size:15px;font-weight:500}
a:hover{background:#000}
a svg{width:17px;height:17px;fill:currentColor}
@media (prefers-color-scheme:dark){body{color:#f5f5f7;background:#111113}p{color:#a1a1a6}a{background:#f5f5f7;color:#111113}a:hover{background:#fff}img{box-shadow:0 6px 22px rgba(0,0,0,.5)}}
.pk{margin-top:2px;display:inline-flex;align-items:center;gap:8px;padding:8px 18px;border-radius:999px;border:1px solid rgba(0,0,0,.18);background:transparent;color:inherit;font:inherit;font-size:14.5px;cursor:pointer}
.pk:hover{background:rgba(0,0,0,.05)}
.pk svg{width:16px;height:16px}
.pkmsg{min-height:18px;font-size:13px;color:#d70015}
@media (prefers-color-scheme:dark){.pk{border-color:rgba(255,255,255,.25)}.pk:hover{background:rgba(255,255,255,.08)}.pkmsg{color:#ff6961}}
</style></head><body><main>
<img src="/img/app-icon-192.png" alt="">
<h1>Vibing Studio</h1>
<p>${appCtx ? "登录后回到 Vibing Studio" : "登录后连接你的 Mac，使用上面的会话、终端和文件"}</p>
<a href="${href}"><svg viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>使用 GitHub 登录</a>
<button type="button" class="pk" id="pk" hidden>${passkeyIcon}使用通行密钥登录</button>
<div class="pkmsg" id="pkmsg"></div>
<script>${PASSKEY_JS}
passkeyUsable().then(function(ok){document.getElementById("pk").hidden=!ok;});
document.getElementById("pk").addEventListener("click",function(){passkeyLogin(${pkCtx},function(t){document.getElementById("pkmsg").textContent=t;});});
</script>
</main></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

// 本地开发：转给 dev/static.mjs（只在 wrangler dev 带 --var DEV_STATIC 时；线上没有这个变量）
async function devStatic(req, env, url) {
  try {
    const r = await fetch(env.DEV_STATIC.replace(/\/$/, "") + url.pathname + url.search, { method: req.method, headers: req.headers });
    return new Response(r.body, { status: r.status, headers: r.headers });
  } catch (e) {
    return new Response("dev static server unreachable (" + (e && e.message || e) + ") — start it with node dev/run.mjs", { status: 502 });
  }
}

// ---- 小工具 ----
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
const now = () => Date.now();
const list = (s) => String(s || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (s) => b64url(new TextEncoder().encode(s));
const unb64urlText = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
function cookies(req) {
  const out = {};
  (req.headers.get("cookie") || "").split(/;\s*/).forEach((kv) => {
    const i = kv.indexOf("=");
    if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1);
  });
  return out;
}
// 本地（http://localhost）不能带 Secure，其余一律带
function setCookie(url, name, value, maxAge) {
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
async function hmac(env, data) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET 未设置或太短（至少 32 个字符）");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}
// 常数时间比较，避免按字节比较泄露签名
function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// ---- 会话：payload（github_id、login、过期时间）+ HMAC 签名 ----
async function makeSession(env, user) {
  const payload = b64urlText(JSON.stringify({ id: user.github_id, login: user.login, exp: now() + SESSION_DAYS * 864e5 }));
  return payload + "." + (await hmac(env, payload));
}
async function readSession(req, env) {
  const raw = cookies(req)[COOKIE];
  if (!raw || !raw.includes(".")) return null;
  const [payload, sig] = raw.split(".");
  if (!same(sig, await hmac(env, payload))) return null;
  const s = JSON.parse(unb64urlText(payload));
  return s.exp > now() ? s : null;
}
// 当前账号（带余额、是否放行）；未登录返回 null
async function currentUser(req, env) {
  const s = await readSession(req, env);
  if (!s) return null;
  const user = await env.DB.prepare("SELECT * FROM users WHERE github_id = ?").bind(s.id).first();
  return user && privateOk(env, user.github_id) ? user : null; // 私人站点：名单外的旧会话也不认
}
// 账号一律按 GitHub 的数字 id 认（登录名可以改，id 不变）：ONLY_IDS 私人站点（只有这些 id 能登录，别的连账号记录都不建）、
// ALLOW_IDS 首次登录自动放行、ADMIN_IDS 管理员。本地开发的 DEV_LOGIN 账号（id 1，只在 .dev.vars 里有）三样都算；
// 本地还有一个测试账号 id 2（/auth/login?dev=2，自动测试用，数据和 id 1 分开）
const ids = (s) => String(s || "").split(",").map((x) => x.trim()).filter((x) => /^\d+$/.test(x));
const devUser = (env, id) => !!env.DEV_LOGIN && (String(id) === "1" || String(id) === "2");
const privateOk = (env, id) => !env.ONLY_IDS || ids(env.ONLY_IDS).includes(String(id)) || devUser(env, id);
const isAdmin = (env, user) => ids(env.ADMIN_IDS).includes(String(user.github_id)) || devUser(env, user.github_id);

// ---- 登录 ----
// app=<challenge>：原生 App 在系统浏览器里发起的登录（ASWebAuthenticationSession）。challenge = base64url(sha256(verifier))，verifier 只有 App 知道
const appChallenge = (s) => (/^[A-Za-z0-9_-]{43}$/.test(s || "") ? s : "");
// port=<端口>：Linux 版（Electron）没有 ASWebAuthenticationSession——在本机开一个临时端口等回调（127.0.0.1，同 RFC 8252 的做法），code 交到那里
const appPort = (s) => (/^\d{4,5}$/.test(s || "") && +s >= 1024 && +s <= 65535 ? s : "");
const APP_PORT_COOKIE = "tsu_app_port";
async function login(req, env, url) {
  const app = appChallenge(url.searchParams.get("app"));
  // 本地开发：DEV_LOGIN 设了就直接以这个账号登录，不走 GitHub（只该出现在 .dev.vars 里）
  if (env.DEV_LOGIN && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) { // 127.0.0.1：测试 iPad 端（没有原生桥的那个源）
    const test = url.searchParams.get("dev") === "2";
    const user = await upsertUser(env, test ? { id: 2, login: "dev-test", avatar_url: "" } : { id: 1, login: env.DEV_LOGIN, avatar_url: "" });
    const next = url.searchParams.get("next") || "/";
    return app ? toApp(env, url, user, app, appPort(url.searchParams.get("port"))) : finishLogin(env, url, user, safeNext(next));
  }
  if (!env.GITHUB_CLIENT_ID) return json({ error: "GITHUB_CLIENT_ID is not configured" }, 500);
  // App 在系统浏览器里打开的登录：先给一页选「使用 GitHub 登录」还是「使用通行密钥登录」（go=github 才直接去 GitHub）
  if (app && url.searchParams.get("go") !== "github") return loginPage(safeNext(url.searchParams.get("next") || "/"), { app, port: appPort(url.searchParams.get("port")) });
  const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
  const to = new URL("https://github.com/login/oauth/authorize");
  to.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  to.searchParams.set("redirect_uri", url.origin + "/auth/callback");
  to.searchParams.set("scope", "read:user");
  to.searchParams.set("state", state);
  const headers = new Headers({ location: to.toString() });
  headers.append("set-cookie", setCookie(url, STATE_COOKIE, state, 600));
  headers.append("set-cookie", setCookie(url, APP_COOKIE, app, app ? 600 : 0));
  const port = app ? appPort(url.searchParams.get("port")) : "";
  headers.append("set-cookie", setCookie(url, APP_PORT_COOKIE, port, port ? 600 : 0));
  const nx = safeNext(url.searchParams.get("next") || "/");
  headers.append("set-cookie", setCookie(url, NEXT_COOKIE, nx === "/" ? "" : encodeURIComponent(nx), nx === "/" ? 0 : 600));
  return new Response(null, { status: 302, headers });
}
async function callback(req, env, url) {
  const state = url.searchParams.get("state"), code = url.searchParams.get("code");
  const expected = cookies(req)[STATE_COOKIE];
  if (!code || !state || !expected || !same(state, expected)) return page("登录失败", "登录请求已过期或来源不对，请回到首页重新登录。", 400);
  // code 换 token（只在这里用一次，不存、不给浏览器），再用它读出 GitHub 身份
  const tok = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: url.origin + "/auth/callback" }),
  }).then((r) => r.json());
  if (!tok.access_token) return page("登录失败", "GitHub 没有返回授权，请重试。", 400);
  const gh = await fetch("https://api.github.com/user", {
    headers: { authorization: "Bearer " + tok.access_token, accept: "application/vnd.github+json", "user-agent": "native-agent-desktop-os-web" },
  }).then((r) => r.json());
  if (!gh.id) return page("登录失败", "读不到 GitHub 账号信息，请重试。", 400);
  if (!privateOk(env, gh.id)) return page("这是一个私人站点", "只有站点的主人能登录。", 403);
  const user = await upsertUser(env, gh);
  const app = appChallenge(cookies(req)[APP_COOKIE]);
  const nx = cookies(req)[NEXT_COOKIE];
  let next = "/";
  try { next = safeNext(nx ? decodeURIComponent(nx) : "/"); } catch { next = "/"; }
  return app ? toApp(env, url, user, app, appPort(cookies(req)[APP_PORT_COOKIE])) : finishLogin(env, url, user, next);
}
// 原生 App：浏览器这边不设会话，给 App 一个一次性的 code（2 分钟、用一次），跳回 App（paimon://auth）
async function appRedirect(env, user, challenge, port) {
  const code = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare("INSERT INTO app_codes (code, github_id, challenge, expires) VALUES (?, ?, ?, ?)").bind(code, user.github_id, challenge, now() + 120e3).run();
  return port ? "http://127.0.0.1:" + port + "/auth?code=" + code : "paimon://auth?code=" + code;
}
// 通行密钥那边要用的（passkey.js）
const passkeyHelpers = {
  currentUser: (req, env) => currentUser(req, env), json: (d, s, h) => json(d, s, h), safeNext: (n) => safeNext(n), privateOk: (env, id) => privateOk(env, id),
  appChallenge: (s) => appChallenge(s), appPort: (s) => appPort(s), appRedirect: (env, user, ch, port) => appRedirect(env, user, ch, port),
  sessionHeaders: async (env, url, user) => ({ "set-cookie": setCookie(url, COOKIE, await makeSession(env, user), SESSION_DAYS * 86400) }),
};
async function toApp(env, url, user, challenge, port) {
  const headers = new Headers({ location: await appRedirect(env, user, challenge, port) });
  headers.append("set-cookie", setCookie(url, STATE_COOKIE, "", 0));
  headers.append("set-cookie", setCookie(url, APP_COOKIE, "", 0));
  headers.append("set-cookie", setCookie(url, APP_PORT_COOKIE, "", 0));
  return new Response(null, { status: 302, headers });
}
// App 拿 code + verifier 换会话（Cookie 设在 App 自己的网页里）：code 对、没过期、没用过，sha256(verifier) 对得上 challenge
async function appLogin(req, env, url) {
  const code = url.searchParams.get("code") || "", verifier = url.searchParams.get("verifier") || "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(code) || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) return page("登录失败", "登录请求不对，请在 App 里重新登录。", 400);
  const row = await env.DB.prepare("UPDATE app_codes SET used = 1 WHERE code = ? AND used = 0 AND expires > ? RETURNING github_id, challenge").bind(code, now()).first();
  const hash = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  if (!row || !same(hash, row.challenge)) return page("登录失败", "登录已过期或已经用过，请在 App 里重新登录。", 400);
  const user = await env.DB.prepare("SELECT * FROM users WHERE github_id = ?").bind(row.github_id).first();
  if (!user || !privateOk(env, user.github_id)) return page("这是一个私人站点", "只有站点的主人能登录。", 403);
  const next = url.searchParams.get("next") || "/";
  return finishLogin(env, url, user, safeNext(next)); // 登好了回到 App 的那一页（Paimon Terminal 是 /terminal.html）
}
// 记下账号；ALLOW_IDS 里的账号首次登录自动放行并送初始额度
async function upsertUser(env, gh) {
  const t = now();
  await env.DB.prepare(
    "INSERT INTO users (github_id, login, avatar, created_at, last_seen) VALUES (?1, ?2, ?3, ?4, ?4) " +
      "ON CONFLICT(github_id) DO UPDATE SET login = ?2, avatar = ?3, last_seen = ?4",
  ).bind(gh.id, gh.login, gh.avatar_url || "", t).run();
  let user = await env.DB.prepare("SELECT * FROM users WHERE github_id = ?").bind(gh.id).first();
  if (!user.allowed && (ids(env.ALLOW_IDS).includes(String(gh.id)) || devUser(env, gh.id))) {
    await allowUser(env, user);
    user = await env.DB.prepare("SELECT * FROM users WHERE github_id = ?").bind(gh.id).first();
  }
  return user;
}
async function allowUser(env, user) {
  const credit = parseInt(env.NEW_USER_CREDIT || "0", 10);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET allowed = 1, balance = balance + ? WHERE github_id = ?").bind(credit, user.github_id),
    env.DB.prepare("INSERT INTO ledger (github_id, at, kind, delta, note) VALUES (?, ?, 'grant', ?, '放行时的初始额度')").bind(user.github_id, now(), credit),
  ]);
}
async function finishLogin(env, url, user, next = "/") {
  const headers = new Headers({ location: next });
  headers.append("set-cookie", setCookie(url, COOKIE, await makeSession(env, user), SESSION_DAYS * 86400));
  headers.append("set-cookie", setCookie(url, STATE_COOKIE, "", 0));
  headers.append("set-cookie", setCookie(url, NEXT_COOKIE, "", 0));
  return new Response(null, { status: 302, headers });
}
function logout(url) {
  return new Response(null, { status: 302, headers: { location: "/", "set-cookie": setCookie(url, COOKIE, "", 0) } });
}
function page(title, text, status) {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="dark light"><title>${esc(title)}</title><style>body{font:15px -apple-system,sans-serif;padding:3em;background:#000;color:#ccc}@media (prefers-color-scheme:light){body{background:#fff;color:#333}}</style><body><h2>${esc(title)}</h2><p>${esc(text)}</p><p><a style="color:#d77757" href="/">回到首页</a></p>`, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

// ---- 真沙盒（sandboxd：每个用户一台 Docker 里的 Linux）：同 Brave 的做法，Worker 带着密钥转发，浏览器碰不到 sandboxd ----
// /api/sbx/<路径> → SANDBOX_URL/v1/<路径>；终端是 WebSocket（/api/sbx/pty），照样转
async function sandbox(req, env, url) {
  if (!env.SANDBOX_URL || !env.SANDBOX_KEY) return json({ error: "The server has no sandbox configured (SANDBOX_URL / SANDBOX_KEY)" }, 503);
  const user = await currentUser(req, env);
  if (!user) return json({ error: "Not signed in" }, 401);
  if (!user.allowed) return json({ error: "Invite only: this account has not been invited yet" }, 403);
  const target = env.SANDBOX_URL.replace(/\/$/, "") + "/v1/" + url.pathname.slice(9) + url.search;
  const headers = sbxHeaders(env);
  headers.set("authorization", "Bearer " + env.SANDBOX_KEY);
  headers.set("x-tsu-user", String(user.github_id));
  if (req.headers.get("content-type")) headers.set("content-type", req.headers.get("content-type"));
  if ((req.headers.get("upgrade") || "").toLowerCase() === "websocket") {
    headers.set("upgrade", "websocket");
    return fetch(target, { headers });
  }
  try {
    const r = await fetch(target, { method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body });
    return new Response(r.body, { status: r.status, headers: { "content-type": r.headers.get("content-type") || "application/octet-stream", "cache-control": "no-store" } });
  } catch (e) {
    return json({ error: "Sandbox unreachable (" + (e && e.message || e) + ")" }, 502);
  }
}

// ---- 账号信息 ----
// 模型：[{ id, name, ctx, in, out, hit, offpeak? }]，价格是「元 / 百万 token」（高峰价）；offpeak 是平时的折扣（DeepSeek 0.5）
const models = (env) => JSON.parse(env.MODELS || "[]");
// 老会话里存的模型名（改名前的）→ 现在的
const ALIASES = { "deepseek-v4-flash": "deepseek-flash" };
const findModel = (env, id) => models(env).find((m) => m.id === (ALIASES[id] || id));
const upstreamKey = (env) => env.UPSTREAM_KEY || env.ANTHROPIC_API_KEY || "";
// 工具服务（与模型一样按额度计费）：{ id: { name, per_call（微元）} }；地址与密钥在各自的环境变量里（换 provider 只改配置）
const tools = (env) => JSON.parse(env.TOOLS || '{"brave":{"name":"Brave Search","per_call":40000},"fetch":{"name":"Web Fetch","per_call":2000}}');
// DeepSeek 的高峰：北京时间周一到周五 9:00–12:00、14:00–18:00；其余时段（含周末）按 offpeak 折扣。
// 法定节假日官方也按平时价——这里当普通工作日算（为几天假期维护一张假日表不值得；最多多扣那几天的一半）
function isPeak(t = now()) {
  const d = new Date(t + 8 * 3600e3), day = d.getUTCDay(), m = d.getUTCHours() * 60 + d.getUTCMinutes();
  return day >= 1 && day <= 5 && ((m >= 540 && m < 720) || (m >= 840 && m < 1080));
}
// 一次调用的价钱（微元）：未命中缓存的输入、命中缓存的输入、输出分开计；平时打折
function priceOf(model, u, peak) {
  const hit = model.hit ?? model.in * 0.1, write = model.write ?? model.in;
  const yuanPerM = (u.input || 0) * model.in + (u.cacheRead || 0) * hit + (u.cacheWrite || 0) * write + (u.output || 0) * model.out;
  return Math.ceil(yuanPerM * (peak ? 1 : model.offpeak || 1));
}
const yuan = (micro) => "¥" + (micro / 1e6).toFixed(2);

// ---- 三层分开：鉴权（currentUser / allowed）只管“你是谁、有没有被邀请”；额度（charge）是唯一的记账入口，
// 每一笔都进 ledger（服务、金额、明细）；provider（各服务的 URL 与 Key）只在配置里 ----
async function charge(env, user, row) {
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET balance = balance - ? WHERE github_id = ?").bind(row.cost, user.github_id),
    env.DB.prepare("INSERT INTO ledger (github_id, at, kind, delta, model, input_tokens, output_tokens, cache_read, cache_write, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(user.github_id, now(), row.kind, -row.cost, row.service, row.input ?? null, row.output ?? null, row.cacheRead ?? null, row.cacheWrite ?? null, row.note ?? null),
  ]);
}
async function allowedUser(req, env) {
  const user = await currentUser(req, env);
  if (!user) return { error: json({ error: "Not signed in" }, 401) };
  if (!user.allowed) return { error: json({ error: "Invite only: this account has not been invited yet" }, 403) };
  if (user.balance <= 0) return { error: json({ error: "Out of credit (balance " + yuan(user.balance) + ")" + (isAdmin(env, user) ? " · you are an admin: /admin credit " + user.login + " 50 adds ¥50" : " · ask an admin to top up"), balance: user.balance }, 402) };
  return { user };
}

// ---- 工具：Brave 搜索。BRAVE_URL 默认官方接口，也可以指向一个中继（比如放在自己 Mac 上的转发），路径与参数原样 ----
async function tool(req, env, id) {
  const { user, error } = await allowedUser(req, env);
  if (error) return error;
  const def = tools(env)[id];
  if (!def) return json({ error: "No such tool" }, 404);
  const body = await req.json().catch(() => ({}));
  if (id === "brave") {
    const q = String(body.q || "").trim().slice(0, 400);
    if (!q) return json({ error: "Empty query" }, 400);
    if (!env.BRAVE_KEY) return json({ error: "BRAVE_KEY is not configured on the server" }, 500);
    const u = new URL((env.BRAVE_URL || "https://api.search.brave.com") + "/res/v1/web/search");
    u.searchParams.set("q", q);
    u.searchParams.set("count", String(Math.max(1, Math.min(10, parseInt(body.count, 10) || 5)))); // 1–10（负数、0 都不行）
    const r = await fetch(u, { headers: { accept: "application/json", "x-subscription-token": env.BRAVE_KEY } });
    if (!r.ok) return json({ error: "Brave error (" + r.status + ")" }, 502);
    const data = await r.json();
    const results = ((data.web && data.web.results) || []).map((x) => ({ title: x.title, url: x.url, description: (x.description || "").replace(/<[^>]+>/g, ""), age: x.age || "" }));
    await charge(env, user, { kind: "tool", service: "brave", cost: def.per_call, note: q });
    return json({ results });
  }
  if (id === "fetch") {
    let page;
    try { page = await fetchPage(body.url); } catch (e) { console.error("fetch tool", e); return json({ error: "Fetch failed: " + (e && e.message || e) }, 502); }
    if (page.error && !page.status) return json(page, 400);
    let cost = def.per_call, note = String(body.url || "").slice(0, 200);
    // 给了 prompt：让快模型按 prompt 读这一页，只交回答（同 Claude Code：省主 agent 的上下文）
    const prompt = String(body.prompt || "").trim();
    if (prompt && page.text && page.status < 300 && upstreamKey(env)) {
      const ask = await askPage(env, page, prompt).catch((e) => ({ error: "Page reader model error: " + (e && e.message || e) }));
      if (ask.error) page.askError = ask.error;
      else { page.answer = ask.text; cost += ask.cost; note += " · " + ask.model; }
    }
    if (!page.answer && page.text && page.text.length > 50000) { page.text = page.text.slice(0, 50000); page.truncated = true; }
    await charge(env, user, { kind: "tool", service: "fetch", cost, note });
    return json(page);
  }
  return json({ error: "No such tool" }, 404);
}
// 用最便宜的模型（名字带 flash 的，没有就第一个）按 prompt 读网页；不思考、不流式
async function askPage(env, page, prompt) {
  const list = models(env), model = list.find((m) => /flash|haiku/.test(m.id)) || list[0];
  if (!model) return { error: "No model configured" };
  const peak = isPeak();
  const r = await fetch((env.UPSTREAM_URL || "https://api.anthropic.com") + "/v1/messages", {
    method: "POST",
    headers: { "x-api-key": upstreamKey(env), authorization: "Bearer " + upstreamKey(env), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: model.id, max_tokens: 4000, thinking: { type: "disabled" },
      system: "You read one web page for another AI agent and answer its request using only the page. Quote numbers, prices, names and code exactly as written. If the page doesn't contain the answer, say so plainly. Answer in the language of the request.",
      messages: [{ role: "user", content: "Page: " + page.finalUrl + (page.title ? "\nTitle: " + page.title : "") + "\n\n" + page.text.slice(0, 100000) + "\n\n---\nRequest: " + prompt }],
    }),
  });
  if (!r.ok) return { error: "Page reader model error (" + r.status + ")" };
  const j = await r.json(), u = j.usage || {};
  const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  return { text: text || "(empty answer)", model: model.id, cost: priceOf(model, { input: u.input_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens, output: u.output_tokens }, peak) };
}
// sandboxd 放在 Cloudflare Tunnel 后面、又用 Cloudflare Access 挡着时：Worker 带上 Access 的服务令牌（SANDBOX_ACCESS_ID / SANDBOX_ACCESS_SECRET，没配就不带）
function sbxHeaders(env) {
  const h = new Headers();
  if (env.SANDBOX_ACCESS_ID && env.SANDBOX_ACCESS_SECRET) { h.set("cf-access-client-id", env.SANDBOX_ACCESS_ID); h.set("cf-access-client-secret", env.SANDBOX_ACCESS_SECRET); }
  return h;
}
// 沙盒此刻连不连得上：/v1/health 2.5 秒内答得上来；结果记 30 秒（连不上时网页显示正在重试，等它回来）
let sbxHealth = { t: 0, ok: false };
async function sandboxUp(env) {
  if (!env.SANDBOX_URL || !env.SANDBOX_KEY) return false;
  if (Date.now() - sbxHealth.t < 30000) return sbxHealth.ok;
  let ok = false;
  const h = sbxHeaders(env);
  h.set("authorization", "Bearer " + env.SANDBOX_KEY);
  try { ok = (await fetch(env.SANDBOX_URL.replace(/\/$/, "") + "/v1/health", { headers: h, signal: AbortSignal.timeout(2500) })).ok; } catch { ok = false; }
  sbxHealth = { t: Date.now(), ok };
  return ok;
}
async function me(req, env) {
  const user = await currentUser(req, env);
  if (!user) return json({ loggedIn: false, loginUrl: "/auth/login" }, 401);
  return json({
    loggedIn: true, login: user.login, avatar: user.avatar, allowed: !!user.allowed, balance: user.balance,
    admin: isAdmin(env, user), models: models(env), mock: !upstreamKey(env),
    pricing: { currency: "CNY", unit: "元 / 百万 token", peak: isPeak(), peakHours: "工作日 9:00–12:00、14:00–18:00（北京时间）", now: now() },
    // 服务器配了真沙盒就一直用它（文件只有服务器上那一份）；一时连不上（sandboxUp = false）网页等它回来，不退回浏览器里另存一份
    sandbox: !!(env.SANDBOX_URL && env.SANDBOX_KEY), sandboxUp: await sandboxUp(env),
    tools: Object.entries(tools(env)).filter(([id]) => id !== "brave" || env.BRAVE_KEY).map(([id, t]) => ({ id, name: t.name, per_call: t.per_call })),
  });
}

// ---- 用量：余额 + 最近 30 笔账 ----
async function usage(req, env) {
  const user = await currentUser(req, env);
  if (!user) return json({ error: "Not signed in" }, 401);
  const rows = await env.DB.prepare("SELECT at, kind, delta, model, input_tokens, output_tokens, note FROM ledger WHERE github_id = ? ORDER BY id DESC LIMIT 30").bind(user.github_id).all();
  // 汇总：一共充了多少、最近 24 小时 / 7 天花了多少（画额度条用）
  const t = now(), sum = await env.DB.prepare(
    "SELECT COALESCE(SUM(CASE WHEN delta > 0 THEN delta END), 0) AS granted, COALESCE(SUM(CASE WHEN delta < 0 AND at > ?2 THEN -delta END), 0) AS day, " +
      "COALESCE(SUM(CASE WHEN delta < 0 AND at > ?3 THEN -delta END), 0) AS week FROM ledger WHERE github_id = ?1",
  ).bind(user.github_id, t - 864e5, t - 7 * 864e5).first();
  const tr = await translateUsage(env, user.github_id).catch(() => null); // 任务翻译花了多少（用量页那一行）
  return json({ balance: user.balance, granted: sum.granted, spentDay: sum.day, spentWeek: sum.week, rows: rows.results, translate: tr });
}

// ---- 用量统计（新会话页的那张卡片：总览、模型）：最近一年的对话账，按本地日期 × 模型、按钟点汇总；会话、轮数按记录数 ----
// ?tz=分钟（本地比 UTC 快多少，getTimezoneOffset 的相反数）。d 是本地日期的「第几天」（1970-01-01 起），前端再按 全部 / 30 天 / 7 天 切
async function stats(req, env, url) {
  const user = await currentUser(req, env);
  if (!user) return json({ error: "Not signed in" }, 401);
  const tz = Math.max(-840, Math.min(840, Math.round(+url.searchParams.get("tz") || 0))), since = now() - 366 * 864e5, off = tz * 60000;
  const [days, hours, sess, turns] = await env.DB.batch([
    env.DB.prepare("SELECT CAST((at + ?2) / 86400000 AS INTEGER) AS d, model AS m, COUNT(*) AS n, SUM(COALESCE(input_tokens, 0)) AS i, SUM(COALESCE(output_tokens, 0)) AS o, " +
      "SUM(COALESCE(cache_read, 0) + COALESCE(cache_write, 0)) AS c FROM ledger WHERE github_id = ?1 AND kind = 'chat' AND at > ?3 AND (note IS NULL OR note != 'pending') GROUP BY d, m").bind(user.github_id, off, since),
    env.DB.prepare("SELECT CAST(((at + ?2) % 86400000) / 3600000 AS INTEGER) AS h, COUNT(*) AS n FROM ledger WHERE github_id = ?1 AND kind = 'chat' AND at > ?3 GROUP BY h").bind(user.github_id, off, since),
    env.DB.prepare("SELECT CAST((at + ?2) / 86400000 AS INTEGER) AS d, COUNT(*) AS n FROM store WHERE github_id = ?1 AND ns = 'sess' AND part = 0 AND data IS NOT NULL GROUP BY d").bind(user.github_id, off),
    env.DB.prepare("SELECT CAST((at + ?2) / 86400000 AS INTEGER) AS d, COUNT(*) AS n FROM store WHERE github_id = ?1 AND ns = 'turn' AND part = 0 AND data IS NOT NULL GROUP BY d").bind(user.github_id, off),
  ]);
  return json({ tz, today: Math.floor((now() + off) / 864e5), days: days.results, hours: hours.results, sessions: sess.results, turns: turns.results });
}

// ---- 对话：校验 → 转给 Anthropic（流式）→ 一路原样给浏览器，另一路读完按实际用量扣费 ----
async function chat(req, env, ctx) {
  const { user, error } = await allowedUser(req, env);
  if (error) return error;
  const body = await req.json().catch(() => null);
  const model = body && findModel(env, body.model);
  if (!model || !Array.isArray(body.messages) || !body.messages.length) return json({ error: "Bad request" }, 400);
  // 限流：最近一分钟的对话次数。每一问一进来就先记一行（还在跑的也算，不然同时发一堆全都放行），跑完再把用量、扣费填进这一行
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM ledger WHERE github_id = ? AND kind = 'chat' AND at > ?").bind(user.github_id, now() - 60000).first();
  if (recent.n >= parseInt(env.RATE_PER_MIN || "60", 10)) return json({ error: "Rate limited: too many requests this minute" }, 429);
  const pending = await env.DB.prepare("INSERT INTO ledger (github_id, at, kind, delta, model, note) VALUES (?, ?, 'chat', 0, ?, 'pending') RETURNING id").bind(user.github_id, now(), model.id).first();
  const rowId = pending && pending.id;

  const upstreamBody = {
    model: model.id,
    max_tokens: Math.min(parseInt(body.max_tokens, 10) || 32000, parseInt(env.MAX_TOKENS || "64000", 10)),
    messages: body.messages,
    stream: true,
  };
  if (typeof body.system === "string") upstreamBody.system = body.system;
  if (body.tool_choice && ["auto", "any"].includes(body.tool_choice.type)) upstreamBody.tool_choice = { type: body.tool_choice.type };
  // 思考强度（/effort）：off 关掉思考；low / high / max 是模型自己的档位（DeepSeek：output_config.effort，默认 high；budget_tokens 它不认）
  const EFFORT = { off: "off", none: "off", minimal: "low", low: "low", medium: "high", high: "high", xhigh: "max", max: "max", ultra: "max" };
  const effort = EFFORT[String(body.effort || "").toLowerCase()];
  if (effort === "off") upstreamBody.thinking = { type: "disabled" };
  else if (effort) upstreamBody.output_config = { effort };
  else if (body.thinking && body.thinking.type === "disabled") upstreamBody.thinking = { type: "disabled" };
  // 工具定义由前端带来（执行也在前端发起，走 /api/tools/*、各自计费）；只放行登记过的工具
  // 服务器执行、要计费的工具（名字 → 服务）只在配置了才放行；沙盒工具在用户浏览器里执行，服务器没有成本，直接放行
  const SERVER_TOOLS = { web_search: "brave", WebFetch: "fetch" };
  const SANDBOX_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Agent", "hibernate", "TaskOutput", "TaskStop", "SendMessage", "ListAgents", "help",
    "TaskCreate", "TaskUpdate", "TaskList", // 任务清单（agents.js 里一直有，之前没放行，模型从来没看到过）
    // 全局助手（public/globalagent.js）：在页面里跑的「看各个 agent、看 / 调布局」
    "AgentsOverview", "ReadAgent", "CreateAgent", "InterruptAgent", "ArchiveAgent", "GetLayout", "OpenTab", "FocusTab", "CloseTab", "SetLayout", "SetSetting"];
  if (Array.isArray(body.tools)) upstreamBody.tools = body.tools.filter((t) => t && (SANDBOX_TOOLS.includes(t.name) || (SERVER_TOOLS[t.name] && tools(env)[SERVER_TOOLS[t.name]]))).slice(0, 40);
  // 上游：默认 Anthropic；UPSTREAM_URL 可换成任何 Anthropic 兼容的接口（如 DeepSeek 的 https://api.deepseek.com/anthropic）
  const key = upstreamKey(env);
  const upstream = key
    ? await fetch((env.UPSTREAM_URL || "https://api.anthropic.com") + "/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, authorization: "Bearer " + key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify(upstreamBody),
      })
    : mockStream(body.messages);
  if (!upstream.ok) {
    const detail = await upstream.text();
    console.error("upstream", upstream.status, detail);
    if (rowId) ctx.waitUntil(env.DB.prepare("UPDATE ledger SET note = ? WHERE id = ?").bind("upstream " + upstream.status, rowId).run().catch(() => {}));
    // 把上游给的原因带回去（如 402 余额不足、429 限流），用户才知道是服务方的问题
    let why = "";
    try { why = JSON.parse(detail).error.message.replace(/\s*\(request_id[^)]*\)/, ""); } catch { /* 不是 JSON */ }
    return json({ error: "Upstream error (" + upstream.status + (why ? ": " + why : "") + ")" }, 502);
  }
  // 一路给浏览器；另一路在后台读完、从事件里取 usage 扣费——浏览器中途断开也照样记账（上游已经在生成、已经产生费用）
  const [toClient, toMeter] = upstream.body.tee();
  ctx.waitUntil(meter(env, user, model, toMeter, isPeak(), rowId));
  return new Response(toClient, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" } });
}
// 读 SSE：message_start 带输入 token（含缓存），message_delta 带累计的输出 token
async function meter(env, user, model, stream, peak, rowId) {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "", usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  // 上游中途断了（读流抛错）也要把已经产生的用量记上：finally 里照样扣费
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        let ev;
        try { ev = JSON.parse(line.slice(5)); } catch { continue; }
        if (ev.type === "message_start" && ev.message && ev.message.usage) {
          const u = ev.message.usage;
          usage.input = u.input_tokens || 0;
          usage.cacheRead = u.cache_read_input_tokens || 0;
          usage.cacheWrite = u.cache_creation_input_tokens || 0;
        }
        if (ev.type === "message_delta" && ev.usage) {
          usage.output = ev.usage.output_tokens || usage.output;
          // 有的上游（DeepSeek）在 message_delta 里再给一次完整的 usage：以它为准
          if (ev.usage.input_tokens !== undefined) usage.input = ev.usage.input_tokens;
          if (ev.usage.cache_read_input_tokens !== undefined) usage.cacheRead = ev.usage.cache_read_input_tokens;
          if (ev.usage.cache_creation_input_tokens !== undefined) usage.cacheWrite = ev.usage.cache_creation_input_tokens;
        }
      }
    }
  } catch (e) {
    console.error("meter: stream broke", e && e.message);
  } finally {
    // 元 / 百万 token × token = 微元
    const charged = upstreamKey(env) ? priceOf(model, usage, peak) : 0; // 模拟回答不扣钱
    const row = { kind: "chat", service: model.id, cost: charged, input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite, note: peak ? "高峰" : "平时" };
    if (rowId) await settle(env, user, rowId, row); else await charge(env, user, row);
  }
}
// 进来时先记的那一行（限流用）：填上用量、扣费
async function settle(env, user, rowId, row) {
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET balance = balance - ? WHERE github_id = ?").bind(row.cost, user.github_id),
    env.DB.prepare("UPDATE ledger SET delta = ?, input_tokens = ?, output_tokens = ?, cache_read = ?, cache_write = ?, note = ? WHERE id = ?")
      .bind(-row.cost, row.input ?? null, row.output ?? null, row.cacheRead ?? null, row.cacheWrite ?? null, row.note ?? null, rowId),
  ]);
}
// 没有 ANTHROPIC_API_KEY 时（本地开发）：按 Anthropic 的事件格式吐一段模拟回答，前后端整条链路照样能跑
function mockStream(messages) {
  const last = messages[messages.length - 1];
  const asked = typeof last.content === "string" ? last.content : "";
  const text = "（这是本地的模拟回答：没有配置 ANTHROPIC_API_KEY。）\n\n你问的是：**" + asked.slice(0, 200) + "**\n\n" +
    "下面是一段 Markdown，用来看流式排版：\n\n| 项目 | 状态 |\n|---|---|\n| 登录 | ✅ |\n| 额度 | ✅ |\n| 流式代理 | ✅ |\n\n```js\nconsole.log(\"hello from the mock stream\");\n```\n";
  const events = [{ type: "message_start", message: { usage: { input_tokens: asked.length } } }, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }];
  for (let i = 0; i < text.length; i += 6) events.push({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(i, i + 6) } });
  events.push({ type: "content_block_stop", index: 0 }, { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: Math.ceil(text.length / 1.3) } }, { type: "message_stop" });
  const enc = new TextEncoder();
  let k = 0;
  const body = new ReadableStream({
    async pull(controller) {
      if (k >= events.length) return controller.close();
      await new Promise((r) => setTimeout(r, k < 2 ? 400 : 25));
      const ev = events[k++];
      controller.enqueue(enc.encode("event: " + ev.type + "\ndata: " + JSON.stringify(ev) + "\n\n"));
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

// ---- 管理员：加额度、放行账号 ----
async function admin(req, env, url) {
  const user = await currentUser(req, env);
  if (!user || !isAdmin(env, user)) return json({ error: "Forbidden" }, 403);
  const body = await req.json().catch(() => ({}));
  const target = await env.DB.prepare("SELECT * FROM users WHERE login = ? COLLATE NOCASE").bind(String(body.login || "")).first();
  if (!target) return json({ error: "No such account (they need to sign in once first)" }, 404);
  if (url.pathname === "/api/admin/allow") {
    if (!target.allowed) await allowUser(env, target);
    return json({ ok: true });
  }
  if (url.pathname === "/api/admin/credit") {
    // 金额用 cny（元）；可以是负数（扣回）
    const delta = Math.round(Number(body.cny) * 1e6);
    if (!Number.isFinite(delta) || !delta) return json({ error: "Invalid amount (cny)" }, 400);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET balance = balance + ? WHERE github_id = ?").bind(delta, target.github_id),
      env.DB.prepare("INSERT INTO ledger (github_id, at, kind, delta, note) VALUES (?, ?, 'adjust', ?, ?)").bind(target.github_id, now(), delta, "by " + user.login),
    ]);
    return json({ ok: true });
  }
  return json({ error: "not found" }, 404);
}
