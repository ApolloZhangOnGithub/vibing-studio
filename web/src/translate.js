// translate.js —— 任务翻译（设置 › 对话 › 任务翻译）：Agent 的任务标题（任务清单、后台任务、子 Agent、运行状态行那一句）翻成用户要的语言。
// POST /api/translate { to, items: [原文…]（一批最多 40 条、每条最多 400 字）, context?: "这些任务是谁的（agent / 会话名）" }
//   → { out: [译文…]（和 items 一一对应；翻不了的原样）, cached: 服务器缓存命中几条, hits: [命中的是第几条], translated: 这次叫模型翻了几条, cost: 这次扣了多少（微元）}
//   余额不足（402）、限流（429）、上游出错（502）时也照样给 out + hits：缓存里有的前端照样收下（不扣钱），只有没翻过的才算没翻成
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
const MAX_ITEMS = 40, MAX_LEN = 400, RATE = 20; // 一批几条、一条多长；每分钟最多叫几次模型（翻译）
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

// H：index.js 里的那些（鉴权、记账、模型、价钱），这里不重复写
export async function translate(req, env, H) {
  const user = await H.currentUser(req, env);
  if (!user) return H.json({ error: "Not signed in" }, 401);
  if (!user.allowed) return H.json({ error: "Invite only: this account has not been invited yet" }, 403);
  const body = await req.json().catch(() => null);
  const to = body && String(body.to || "");
  if (!LANGS[to] || !Array.isArray(body.items) || !body.items.length) return H.json({ error: "Bad request" }, 400);
  const reply = body.kind === "reply";
  const items = reply ? body.items.slice(0, R_ITEMS).map((s) => normR(s).slice(0, R_LEN)) : body.items.slice(0, MAX_ITEMS).map((s) => norm(s).slice(0, MAX_LEN));
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
  if (!miss.length) return H.json({ out, cached: hit, hits, translated: 0, cost: 0 });

  // ---- 2) 没有的交给模型（余额、限流同对话）----
  if (user.balance <= 0) return H.json({ error: "Out of credit", out, cached: hit, hits, translated: 0, cost: 0 }, 402);
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM ledger WHERE github_id = ? AND kind = 'translate' AND at > ?").bind(uid, Date.now() - 60000).first();
  if (recent && recent.n >= RATE) return H.json({ error: "Rate limited", out, cached: hit, hits, translated: 0, cost: 0 }, 429);
  const list = H.models(env), model = list.find((m) => /flash|haiku/.test(m.id)) || list[0];
  const key = H.upstreamKey(env);
  if (!model || !key) return H.json({ out, cached: hit, hits, translated: 0, cost: 0, mock: true }); // 本地没配上游：原样
  const src = miss.map((i) => items[i]), peak = H.isPeak();
  const r = await fetch((env.UPSTREAM_URL || "https://api.anthropic.com") + "/v1/messages", {
    method: "POST",
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
  if (!r.ok) { console.error("translate upstream", r.status); return H.json({ error: "Upstream error (" + r.status + ")", out, cached: hit, hits, translated: 0, cost: 0 }, 502); }
  const j = await r.json(), u = j.usage || {};
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
  // ---- 3) 写回缓存（翻不了的不记：下次再试）----
  if (cacheOn && rows.length) await env.DB.prepare(`INSERT INTO translations (github_id, key, lang, src, out, created_at, hits)
      SELECT ?1, json_extract(value, '$.k'), ?2, json_extract(value, '$.s'), json_extract(value, '$.o'), ?3, 0 FROM json_each(?4) WHERE 1
      ON CONFLICT (github_id, key) DO UPDATE SET out = excluded.out`).bind(uid, to, Date.now(), JSON.stringify(rows)).run().catch((e) => console.error("translate cache", e && e.message));
  return H.json({ out, cached: hit, hits, translated: rows.length, cost });
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
