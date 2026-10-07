// translate.js —— 任务翻译（设置 › 对话 › 任务翻译）：Agent 的任务标题（任务清单、后台任务、子 Agent、运行状态行那一句）翻成用户要的语言。
// POST /api/translate { to, items: [原文…]（一批最多 40 条、每条最多 400 字）, context?: "这些任务是谁的（agent / 会话名）" }
//   → { out: [译文…]（和 items 一一对应；翻不了的原样）, cached: 服务器缓存命中几条, hits: [命中的是第几条], translated: 这次叫模型翻了几条, cost: 这次扣了多少（微元）}
//   余额不足（402）、限流（429）、上游出错（502）、上游超时（504）时也照样给 out + hits：缓存里有的前端照样收下（不扣钱），只有没翻过的才算没翻成
//   限流：每个账号每分钟最多 TRANSLATE_PER_MIN 次（默认 60）叫模型；429 带 retryAfter（毫秒）：再过多久窗口里就空出一次，前端照这个等，不是一律停一分钟
//   每一次请求记一行 svc_log（服务状态页：GET /api/svclog）：什么时候、任务还是回复、几条、整个多久、其中模型多久、状态码、错误
// 用系统默认的额度：同 Paimon 的 agent（余额、按实际 token 扣费、账本里一行），模型用最便宜的那个（名字带 flash / haiku 的）。
// 账本：kind = 'translate'，note 以条数开头（「12 strings → zh」：SQLite 的 CAST(note AS INTEGER) 取到 12），用量页据此汇总「翻译用了多少」。
//
// ======== 缓存（服务器这一层）========
// translations 表（schema.sql）：按账号存 (github_id, key) → 译文；key = sha256(版本 \n 语言 \n 规整后的原文)，服务器自己算（不信前端给的）。
// 一批里先查表：有的直接给（不叫模型、不扣钱），只把没有的交给模型；翻好的写回表里。别的窗口、别的设备翻过的同样命中。
// 线上的库还没建这张表时（schema 要人工 wrangler d1 execute --remote）：查、写都跳过，照样翻、照样扣费——只是少了这一层缓存，
// 前端那两层（内存、IndexedDB）照样挡住重复。本地开发（DEV_STATIC）没有这张表就自己建上。
// 版本（VERSION）改了：key 全变，旧的自然不再命中。
export const TR_VERSION = 1;
const LANGS = { zh: "Simplified Chinese (简体中文)", en: "English", ja: "Japanese (日本語)", ko: "Korean (한국어)", fr: "French", de: "German", es: "Spanish" };
// 一批几条、一条多长；每分钟最多叫几次模型（翻译；以前是 20：任务标题多是一条一个请求，几个 agent 一起跑就满，满了整页的翻译停一分钟）；
// 模型多久不回就不等了（DeepSeek 忙的时候请求排着队，连接一直开着、不报错：不设上限就一直挂着）
const MAX_ITEMS = 40, MAX_LEN = 400, RATE = 60, UP_WAIT = { tasks: 45000, reply: 120000 };
// kind: "reply"（回复翻译：Agent 说的话，一条是一段 markdown——段落、列表的一项、标题、引用）：一批最多 24 段、每段最多 4000 字；换行留着；
//   key 里多一个 "reply"（同一句当任务标题翻和当一段话翻不混）；提示词是翻一段话、markdown 原样。不给 kind 就是原来的任务翻译，什么都不变
const R_ITEMS = 24, R_LEN = 4000;
const normR = (s) => String(s == null ? "" : s).replace(/\r/g, "").trim();

const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
async function keyOf(to, text, kind) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TR_VERSION + "\n" + to + "\n" + (kind === "reply" ? "reply\n" : "") + text));
  return Array.from(new Uint8Array(d).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}
const noTable = (e) => /no such table/i.test(String((e && e.message) || e));
const CREATE = "CREATE TABLE IF NOT EXISTS translations (github_id INTEGER NOT NULL, key TEXT NOT NULL, lang TEXT NOT NULL, src TEXT NOT NULL, out TEXT NOT NULL, created_at INTEGER NOT NULL, hits INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (github_id, key))";

// H：index.js 里的那些（鉴权、记账、模型、价钱、waitUntil），这里不重复写
export async function translate(req, env, H) {
  const t0 = Date.now();
  const user = await H.currentUser(req, env);
  if (!user) return H.json({ error: "Not signed in" }, 401);
  const devH = req.headers.get("x-tsu-device") || "", dev0 = /^[A-Za-z0-9_-]{6,40}$/.test(devH) ? devH : null;
  // 回给前端，同时记一行 svc_log（不耽误回话：waitUntil）
  const log = { uid: user.github_id, at: t0, svc: "translate", op: "tasks", dev: dev0 };
  const done = (body, status = 200, headers) => {
    Object.assign(log, { status, ms: Date.now() - t0, cached: body.cached, translated: body.translated, error: status === 200 ? null : body.error || null });
    const p = logCall(env, log);
    if (H.waitUntil) H.waitUntil(p);
    return H.json(body, status, headers);
  };
  if (!user.allowed) return done({ error: "Invite only: this account has not been invited yet" }, 403);
  const body = await req.json().catch(() => null);
  const to = body && String(body.to || "");
  if (!LANGS[to] || !Array.isArray(body.items) || !body.items.length) return done({ error: "Bad request" }, 400);
  const reply = body.kind === "reply";
  const items = reply ? body.items.slice(0, R_ITEMS).map((s) => normR(s).slice(0, R_LEN)) : body.items.slice(0, MAX_ITEMS).map((s) => norm(s).slice(0, MAX_LEN));
  log.op = reply ? "reply" : "tasks"; log.items = items.length;
  const context = norm(body.context).slice(0, 200);
  const keys = await Promise.all(items.map((s) => keyOf(to, s, reply ? "reply" : "")));
  const out = items.slice(), uid = user.github_id, dev = !!env.DEV_STATIC;

  // ---- 1) 服务器缓存 ----
  let cacheOn = true, hit = 0;
  const lookup = () => env.DB.prepare("SELECT key, out FROM translations WHERE github_id = ?1 AND key IN (SELECT value FROM json_each(?2))").bind(uid, JSON.stringify(keys)).all();
  let found = null;
  try { found = await lookup(); } catch (e) {
    if (!noTable(e)) throw e;
    if (dev) { await env.DB.prepare(CREATE).run(); found = await lookup(); } else cacheOn = false; // 线上还没建表：这一层先不用
  }
  const have = new Map(((found && found.results) || []).map((r) => [r.key, r.out]));
  const miss = [], hits = [];
  items.forEach((s, i) => { if (have.has(keys[i])) { out[i] = have.get(keys[i]) || s; hit++; hits.push(i); } else miss.push(i); });
  if (cacheOn && hit) await env.DB.prepare("UPDATE translations SET hits = hits + 1 WHERE github_id = ?1 AND key IN (SELECT value FROM json_each(?2))")
    .bind(uid, JSON.stringify(keys.filter((k) => have.has(k)))).run().catch(() => {});
  if (!miss.length) return done({ out, cached: hit, hits, translated: 0, cost: 0 });

  // ---- 2) 没有的交给模型（余额、限流同对话）----
  if (user.balance <= 0) return done({ error: "Out of credit", out, cached: hit, hits, translated: 0, cost: 0 }, 402);
  const lim = parseInt(env.TRANSLATE_PER_MIN || "", 10) || RATE, now = Date.now();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM ledger WHERE github_id = ? AND kind = 'translate' AND at > ?").bind(uid, now - 60000).first();
  if (recent && recent.n >= lim) {
    // 再过多久窗口里少到 lim 以下：第 (n - lim + 1) 早的那次满一分钟的时候
    const r0 = await env.DB.prepare("SELECT at FROM ledger WHERE github_id = ? AND kind = 'translate' AND at > ? ORDER BY at ASC LIMIT 1 OFFSET ?").bind(uid, now - 60000, recent.n - lim).first().catch(() => null);
    const wait = Math.min(60000, Math.max(1000, (r0 ? r0.at + 60000 - now : 60000) + 250));
    return done({ error: "Rate limited", retryAfter: wait, out, cached: hit, hits, translated: 0, cost: 0 }, 429, { "retry-after": String(Math.ceil(wait / 1000)) });
  }
  const list = H.models(env), model = list.find((m) => /flash|haiku/.test(m.id)) || list[0];
  const key = H.upstreamKey(env);
  if (!model || !key) return done({ out, cached: hit, hits, translated: 0, cost: 0, mock: true }); // 本地没配上游：原样
  log.model = model.id;
  const src = miss.map((i) => items[i]), peak = H.isPeak();
  const u0 = Date.now();
  let r, j;
  try {
    r = await fetch((env.UPSTREAM_URL || "https://api.anthropic.com") + "/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(UP_WAIT[log.op]),
      headers: { "x-api-key": key, authorization: "Bearer " + key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: model.id, max_tokens: reply ? 8000 : 4000, thinking: { type: "disabled" },
        system: reply ? "You translate paragraphs from an AI coding agent's replies to its user into " + LANGS[to] + ". Each item is one markdown block (a paragraph, a list item's text, a heading or a quote line). " +
          "Translate naturally and faithfully, keeping the tone. Keep exactly as written: markdown syntax (**bold**, *italic*, links' URLs), anything in backticks, code, file paths, commands, flags, URLs, " +
          "identifiers, numbers, versions and product or tool names (Claude Code, Codex, npm, git, Bash…). Keep line breaks inside an item. If an item is already in the target language, return it unchanged. " +
          "Reply with ONLY a JSON array of strings: same length and order as the input, no commentary." : "You translate short UI labels from a software agent's task list into " + LANGS[to] + ": task titles, progress phrases (\"Running the tests\"), background job descriptions and subagent names. " +
          "Keep each item concise like a UI label, with the same meaning and tone. Keep exactly as written: code, file paths, commands, flags, URLs, identifiers, numbers, versions, " +
          "product and tool names (Claude Code, Codex, npm, git, Bash…) and anything in backticks. If an item is already in the target language, return it unchanged. " +
          "Use the other items and the context only for consistent terminology. Reply with ONLY a JSON array of strings: same length and order as the input, no commentary.",
        messages: [{ role: "user", content: (context ? (reply ? "Context: these are replies in the conversation \"" : "Context: these tasks belong to \"") + context + "\".\n\n" : "") + "Items:\n" + JSON.stringify(src) }],
      }),
    });
    log.upStatus = r.status;
    if (r.ok) j = await r.json(); // 忙的时候先回 200、正文晚到：读完正文才算模型用完的时间
  } catch (e) {
    log.upMs = Date.now() - u0;
    const late = e && (e.name === "TimeoutError" || e.name === "AbortError");
    console.error("translate upstream", late ? "timeout" : e && e.message);
    return done({ error: late ? "Upstream timeout (" + Math.round(UP_WAIT[log.op] / 1000) + "s)" : "Upstream error (" + String((e && e.message) || e).slice(0, 80) + ")", out, cached: hit, hits, translated: 0, cost: 0 }, late ? 504 : 502);
  }
  log.upMs = Date.now() - u0;
  if (!r.ok) { console.error("translate upstream", r.status); return done({ error: "Upstream error (" + r.status + ")", out, cached: hit, hits, translated: 0, cost: 0 }, 502); }
  const u = j.usage || {};
  const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  let arr = null;
  try { const a = text.indexOf("["), b = text.lastIndexOf("]"); arr = a >= 0 && b > a ? JSON.parse(text.slice(a, b + 1)) : null; } catch { arr = null; }
  const ok = Array.isArray(arr) && arr.length === src.length;
  // 一条一条核对：不是字符串、空的、长得离谱（原文 4 倍 + 60 字以上）的不要，原样
  const got = src.map((s, i) => { const t = ok && typeof arr[i] === "string" ? (reply ? normR(arr[i]) : norm(arr[i])) : ""; return t && t.length <= s.length * 4 + (reply ? 200 : 60) ? t : null; });
  const cost = H.priceOf(model, { input: u.input_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens, output: u.output_tokens }, peak);
  await H.charge(env, user, { kind: "translate", service: model.id, cost, input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens, note: src.length + (reply ? " paragraphs → " : " strings → ") + to + (ok ? "" : " (unparsed)") });
  const rows = [];
  miss.forEach((i, n) => { if (got[n] != null) { out[i] = got[n]; rows.push({ k: keys[i], s: items[i], o: got[n] }); } });
  if (!ok) log.note = "unparsed";
  // ---- 3) 写回缓存（翻不了的不记：下次再试）----
  if (cacheOn && rows.length) await env.DB.prepare(`INSERT INTO translations (github_id, key, lang, src, out, created_at, hits)
      SELECT ?1, json_extract(value, '$.k'), ?2, json_extract(value, '$.s'), json_extract(value, '$.o'), ?3, 0 FROM json_each(?4) WHERE 1
      ON CONFLICT (github_id, key) DO UPDATE SET out = excluded.out`).bind(uid, to, Date.now(), JSON.stringify(rows)).run().catch((e) => console.error("translate cache", e && e.message));
  return done({ out, cached: hit, hits, translated: rows.length, cost });
}

// ======== 服务记录（服务状态页）========
// svc_log（schema.sql）：每次翻译请求一行。线上没有就建上（每个 isolate 头一回写的时候）；只留 30 天：写的时候偶尔（约两百次一回）清掉更早的
const LOG_DDL = [
  "CREATE TABLE IF NOT EXISTS svc_log (github_id INTEGER NOT NULL, at INTEGER NOT NULL, svc TEXT NOT NULL, op TEXT, status INTEGER, ms INTEGER, up_ms INTEGER, up_status INTEGER, items INTEGER, cached INTEGER, translated INTEGER, model TEXT, dev TEXT, error TEXT, note TEXT)",
  "CREATE INDEX IF NOT EXISTS svc_log_user_at ON svc_log (github_id, at)",
];
const KEEP_MS = 30 * 864e5, SLOW_MS = { tasks: 8000, reply: 30000 };
let logReady = null;
const ensureLog = (env) => (logReady = logReady || env.DB.batch(LOG_DDL.map((q) => env.DB.prepare(q))).catch((e) => { logReady = null; throw e; }));
async function logCall(env, r) {
  try {
    await ensureLog(env);
    await env.DB.prepare("INSERT INTO svc_log (github_id, at, svc, op, status, ms, up_ms, up_status, items, cached, translated, model, dev, error, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)")
      .bind(r.uid, r.at, r.svc, r.op || null, r.status, r.ms, r.upMs ?? null, r.upStatus ?? null, r.items ?? null, r.cached ?? null, r.translated ?? null, r.model || null, r.dev || null, r.error ? String(r.error).slice(0, 300) : null, r.note || null).run();
    if (Math.random() < 0.005) await env.DB.prepare("DELETE FROM svc_log WHERE github_id = ?1 AND at < ?2").bind(r.uid, Date.now() - KEEP_MS).run();
  } catch (e) { console.error("svc_log", e && e.message); }
}
// GET /api/svclog → { now, slow: { tasks, reply }（多久算慢，毫秒）, hours: 30 天里每小时一行（h 小时开始的时间、op、n 次数、bad 没成功的、limited 限流的、slow 慢的、ms 合计、mx 最长）,
//   rows: 最近 24 小时的每一次（新的在前，最多 2000）, fails: 30 天里没成功的（最多 500）}——这个账号所有设备的
export async function svcLog(req, env, H) {
  const user = await H.currentUser(req, env);
  if (!user) return H.json({ error: "Not signed in" }, 401);
  const now = Date.now(), uid = user.github_id, cols = "at, svc, op, status, ms, up_ms, up_status, items, cached, translated, model, dev, error, note";
  try {
    await ensureLog(env);
    const [h, rows, fails] = await env.DB.batch([
      env.DB.prepare("SELECT (at / 3600000) * 3600000 AS h, op, COUNT(*) AS n, SUM(status <> 200) AS bad, SUM(status = 429) AS limited, SUM(CASE WHEN op = 'reply' THEN ms > ?3 ELSE ms > ?4 END) AS slow, SUM(ms) AS ms, MAX(ms) AS mx " +
        "FROM svc_log WHERE github_id = ?1 AND at > ?2 GROUP BY h, op").bind(uid, now - KEEP_MS, SLOW_MS.reply, SLOW_MS.tasks),
      env.DB.prepare(`SELECT ${cols} FROM svc_log WHERE github_id = ?1 AND at > ?2 ORDER BY at DESC LIMIT 2000`).bind(uid, now - 864e5),
      env.DB.prepare(`SELECT ${cols} FROM svc_log WHERE github_id = ?1 AND at > ?2 AND status <> 200 ORDER BY at DESC LIMIT 500`).bind(uid, now - KEEP_MS),
    ]);
    return H.json({ now, slow: SLOW_MS, hours: h.results, rows: rows.results, fails: fails.results });
  } catch (e) {
    console.error("svc_log read", e && e.message);
    return H.json({ error: "Unavailable", now, slow: SLOW_MS, hours: [], rows: [], fails: [] }, 503);
  }
}

// 用量页：翻译一共 / 最近 7 天花了多少、翻了几条（账本里 kind = 'translate' 的那些）；服务器缓存里有几条、命中过几次（有表才有）
export async function translateUsage(env, uid) {
  const wk = Date.now() - 7 * 864e5;
  const s = await env.DB.prepare("SELECT COUNT(*) AS calls, COALESCE(SUM(-delta), 0) AS spent, COALESCE(SUM(CAST(note AS INTEGER)), 0) AS strings, " +
    "COALESCE(SUM(CASE WHEN at > ?2 THEN -delta END), 0) AS spentWeek, COALESCE(SUM(CASE WHEN at > ?2 THEN CAST(note AS INTEGER) END), 0) AS stringsWeek " +
    "FROM ledger WHERE github_id = ?1 AND kind = 'translate'").bind(uid, wk).first();
  const res = { calls: s.calls, spent: s.spent, strings: s.strings, spentWeek: s.spentWeek, stringsWeek: s.stringsWeek };
  try { const c = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(hits), 0) AS hits FROM translations WHERE github_id = ?1").bind(uid).first(); res.cachedStrings = c.n; res.cacheHits = c.hits; } catch { /* 还没建表 */ }
  return res;
}
