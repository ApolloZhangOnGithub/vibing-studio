// account.js —— 跟着账号走的数据（同 iCloud：服务器上只有一份，设备上的都是缓存）：agent 与对话、设备、租约、通知。
// 窗口、Dock、壁纸、主题这些界面状态跟着设备走（各台设备自己的 localStorage），不经过这里。
// 同一件事只在一处定：租约让一个 agent 同一时间只在一台设备上跑；通知的处理由服务器按当前状态判断，只生效一次。
// 大块 JSON Worker 不解析（免费版每个请求只有 10ms CPU）：写入原样交给 SQLite 的 json_each，读出由 SQLite 拼好直接转给浏览器
// agent = 索引（id、名字、住在哪个卷、哪个文件夹……）；dir = 文件夹（卷|路径，空文件夹也在）。sess / turn 是以前连对话一起同步时的记录：
// 现在对话只在 agent 住的卷里（不同步），这两种不再新写，留着给还没搬进卷的 agent 读
const NS = "('agent', 'sess', 'turn', 'dir')";
const PAGE = 1500000; // 一次拉取大约多少字节（按 data 的长度估），多了翻页
const WEEK = 7 * 864e5;
const HEAD = "(SELECT rev FROM store_head WHERE github_id = ?1)";
export const devOk = (s) => typeof s === "string" && /^[A-Za-z0-9_-]{6,40}$/.test(s); // 设备 id：设备自己生成的随机串
const str = (s, n) => (s == null ? null : String(s).slice(0, n));
const bump = (db, uid) => db.prepare("INSERT INTO store_head (github_id, rev) VALUES (?1, 1) ON CONFLICT (github_id) DO UPDATE SET rev = rev + 1").bind(uid);
const raw = (body) => new Response(body, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

// 设备后加的几列：型号（model：「MacBook Air (M2, 2022)」「iPhone 15 Pro」）、系统（os：「macOS 27.0」「Ubuntu 26.04」）、App 版本（app）、
//   硬件编号（hw：这台机器本身的编号经哈希，同一台机器上不同的 App、页面报到的都一样——列设备时按它并成一台）、
//   中转里的编号（relay：这台 Mac 当主机时的编号、这台设备连别的 Mac 时的编号，「设备」App 按它把在线的 Mac 和连着它的设备对上）。
//   第一次用到时补上（加过了会报错，不管它）
let modelCol = null;
const ensureModel = (env) => (modelCol = modelCol || Promise.all(["model", "os", "app", "hw", "relay"].map((c) => env.DB.prepare("ALTER TABLE devices ADD COLUMN " + c + " TEXT").run().catch(() => null))));

export async function account(req, env, url, user, json) {
  const uid = user.github_id, p = url.pathname;
  await ensureModel(env);
  if (p === "/api/sync" && req.method === "GET") return pull(env, uid, url);
  if (p === "/api/store" && req.method === "POST") return push(req, env, uid, json);
  if (p === "/api/lease" && req.method === "POST") return lease(req, env, uid, json);
  if (p === "/api/devices") return devices(req, env, uid, json);
  if (p === "/api/notices" && req.method === "POST") return notices(req, env, uid, json);
  return json({ error: "not found" }, 404);
}

// ---- 拉：rev 大于 since 的记录（一页放不下就翻页：after = 上一页最后一条的 rev、ns、id、part），
// 再加上变过的通知（第一次拉只给最近 7 天的）、现在有效的租约、设备名单。head = 这时账号写到了第几次，拉完所有页后下次从它开始 ----
async function pull(env, uid, url) {
  const since = Math.max(0, parseInt(url.searchParams.get("since"), 10) || 0);
  const a = (url.searchParams.get("after") || "").split("\n");
  const paged = a.length === 4;
  // 不翻页时 (ns, id, part) > ("~", …) 永远不成立（ns 都是小写字母）：只剩 rev > since
  const cur = paged ? [parseInt(a[0], 10) || 0, a[1], a[2], parseInt(a[3], 10) || 0] : [since, "~", "", 0];
  const now = Date.now();
  const r = await env.DB.batch([
    env.DB.prepare(`WITH r AS (
        SELECT ns, id, part, parts, v, data, at, dev, rev,
               SUM(COALESCE(length(CAST(data AS BLOB)), 0) + 100) OVER (ORDER BY rev, ns, id, part ROWS UNBOUNDED PRECEDING) AS run
        FROM store WHERE github_id = ?1 AND (rev > ?2 OR (rev = ?2 AND (ns, id, part) > (?3, ?4, ?5)))),
      page AS (SELECT ns, id, part, parts, v, data, at, dev, rev FROM r WHERE run <= ?6 OR run = (SELECT MIN(run) FROM r)),
      -- 拆成几段的记录：同一版（v 相同）的别的段也一起给（它们可能是更早几次推上来的），设备那边总能拼出整条
      sib AS (SELECT s.ns, s.id, s.part, s.parts, s.v, s.data, s.at, s.dev, s.rev FROM store s
              JOIN (SELECT DISTINCT ns, id, v FROM page WHERE parts > 1) k ON s.ns = k.ns AND s.id = k.id AND s.v = k.v WHERE s.github_id = ?1),
      rows AS (SELECT * FROM page UNION SELECT * FROM sib)
      SELECT COALESCE((SELECT json_group_array(json_object('ns', ns, 'id', id, 'part', part, 'parts', parts, 'v', v, 'data', data, 'at', at, 'dev', dev, 'rev', rev))
                       FROM (SELECT * FROM rows ORDER BY rev, ns, id, part)), '[]') AS rows,
             (SELECT COUNT(*) FROM r) - (SELECT COUNT(*) FROM page) AS rest,
             (SELECT rev || char(10) || ns || char(10) || id || char(10) || part FROM page ORDER BY rev DESC, ns DESC, id DESC, part DESC LIMIT 1) AS after`).bind(uid, cur[0], cur[1], cur[2], cur[3], PAGE),
    env.DB.prepare(`SELECT COALESCE(json_group_array(json_object('key', key, 'app', app, 'title', title, 'body', body, 'data', data, 'created_at', created_at, 'dev', dev,
        'state', state, 'action', action, 'by_dev', by_dev, 'acted_at', acted_at, 'until', until, 'rev', rev)), '[]') AS j
        FROM notices WHERE github_id = ?1 AND rev > ?2 AND (?2 > 0 OR created_at > ?3)`).bind(uid, paged ? Number.MAX_SAFE_INTEGER : since, now - WEEK),
    env.DB.prepare("SELECT COALESCE(json_group_array(json_object('name', name, 'dev', dev, 'until', until)), '[]') AS j FROM leases WHERE github_id = ?1 AND until > ?2").bind(uid, now),
    env.DB.prepare("SELECT COALESCE(json_group_array(json_object('id', id, 'name', name, 'kind', kind, 'model', model, 'os', os, 'app', app, 'hw', hw, 'relay', relay, 'created_at', created_at, 'last_seen', last_seen)), '[]') AS j FROM devices WHERE github_id = ?1").bind(uid),
    env.DB.prepare("SELECT rev FROM store_head WHERE github_id = ?1").bind(uid),
  ]);
  const page = r[0].results[0], h = r[4].results[0];
  return raw(`{"rows":${page.rows},"rest":${page.rest},"after":${JSON.stringify(page.after || "")},"notices":${r[1].results[0].j},"leases":${r[2].results[0].j},"devices":${r[3].results[0].j},"head":${h ? h.rev : 0},"now":${now}}`);
}

// ---- 推：[{ ns, id, part, parts, v, data, at }]（data 为 null = 删了）。整批一个 rev；json_each 在 SQLite 里拆，Worker 不解析 ----
async function push(req, env, uid, json) {
  const dev = req.headers.get("x-tsu-device") || "";
  const buf = await req.arrayBuffer();
  if (buf.byteLength > 1900000) return json({ error: "Too large (max 1.9 MB per push)" }, 413); // D1 单个值不超过 2 MB：设备那边按这个分批
  const body = new TextDecoder().decode(buf);
  if (body.charCodeAt(0) !== 91) return json({ error: "Bad request" }, 400);
  try {
    const r = await env.DB.batch([
      bump(env.DB, uid),
      env.DB.prepare(`INSERT INTO store (github_id, ns, id, part, parts, v, data, at, dev, rev)
          SELECT ?1, json_extract(value, '$.ns'), json_extract(value, '$.id'), COALESCE(json_extract(value, '$.part'), 0), COALESCE(json_extract(value, '$.parts'), 1),
                 json_extract(value, '$.v'), json_extract(value, '$.data'), COALESCE(json_extract(value, '$.at'), 0), ?3, ${HEAD}
          FROM json_each(?2) WHERE json_extract(value, '$.ns') IN ${NS} AND json_type(value, '$.id') = 'text'
          ON CONFLICT (github_id, ns, id, part) DO UPDATE SET parts = excluded.parts, v = excluded.v, data = excluded.data, at = excluded.at, dev = excluded.dev, rev = excluded.rev`)
        .bind(uid, body, devOk(dev) ? dev : null),
      env.DB.prepare("SELECT rev FROM store_head WHERE github_id = ?1").bind(uid),
    ]);
    return json({ rev: r[2].results[0].rev, n: r[1].meta.changes });
  } catch (e) {
    return json({ error: "Bad request (" + ((e && e.message) || e) + ")" }, 400);
  }
}

// ---- 租约：name = agent:<id> 等；op = take（拿：别的设备拿着且没过期就拿不到，force 抢过来）| renew（续）| free（放）。
// 返回现在是谁拿着（设备 id 与名字），拿不到的设备据此显示「正在 iPhone 上运行」 ----
async function lease(req, env, uid, json) {
  const b = await req.json().catch(() => ({}));
  const name = String(b.name || ""), dev = String(b.dev || ""), now = Date.now();
  const ttl = Math.max(10e3, Math.min(600e3, +b.ttl || 90e3));
  if (!/^[a-z]+:[\w.-]{1,64}$/.test(name) || !devOk(dev)) return json({ error: "Bad request" }, 400);
  if (b.op === "free") {
    await env.DB.prepare("DELETE FROM leases WHERE github_id = ?1 AND name = ?2 AND dev = ?3").bind(uid, name, dev).run();
    return json({ ok: true });
  }
  const force = b.op === "take" && !!b.force;
  const r = await env.DB.batch([
    env.DB.prepare(`INSERT INTO leases (github_id, name, dev, until) VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT (github_id, name) DO UPDATE SET dev = excluded.dev, until = excluded.until
        WHERE leases.dev = excluded.dev OR leases.until < ?5 OR ?6 = 1`).bind(uid, name, dev, now + ttl, now, force ? 1 : 0),
    env.DB.prepare(`SELECT l.dev, l.until, d.name FROM leases l LEFT JOIN devices d ON d.github_id = l.github_id AND d.id = l.dev
        WHERE l.github_id = ?1 AND l.name = ?2`).bind(uid, name),
  ]);
  const cur = r[1].results[0] || {};
  return json({ ok: cur.dev === dev, dev: cur.dev || null, until: cur.until || 0, device: cur.name || null });
}

// ---- 设备：POST { id, name, kind, model, os, app, hw, relay } 报到（打开时、之后每隔一阵）；POST { op: "remove", ids } 从账户里移除；GET 列出。
//   名字、型号都是设备自己认出来的（不让人改）。移除的设备如果还登录着，下次报到时会重新出现（同 Apple 账户的设备列表）
async function devices(req, env, uid, json) {
  if (req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    if (b.op === "remove") {
      const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).filter(devOk).slice(0, 20);
      if (!ids.length) return json({ error: "Bad request" }, 400);
      await env.DB.batch(ids.map((id) => env.DB.prepare("DELETE FROM devices WHERE github_id = ?1 AND id = ?2").bind(uid, id)));
      return json({ ok: true, removed: ids.length });
    }
    if (!devOk(b.id)) return json({ error: "Bad request" }, 400);
    const now = Date.now();
    await env.DB.prepare(`INSERT INTO devices (github_id, id, name, kind, model, os, app, hw, relay, created_at, last_seen) VALUES (?1, ?2, ?3, ?4, ?6, ?7, ?8, ?9, ?10, ?5, ?5)
        ON CONFLICT (github_id, id) DO UPDATE SET name = COALESCE(excluded.name, devices.name), kind = COALESCE(excluded.kind, devices.kind), model = COALESCE(excluded.model, devices.model),
          os = COALESCE(excluded.os, devices.os), app = COALESCE(excluded.app, devices.app), hw = COALESCE(excluded.hw, devices.hw), relay = COALESCE(excluded.relay, devices.relay),
          last_seen = excluded.last_seen`)
      .bind(uid, b.id, str(b.name, 60), str(b.kind, 12), now, str(b.model, 80), str(b.os, 60), str(b.app, 40), str(b.hw, 64), str(b.relay, 120)).run();
    return json({ ok: true });
  }
  const r = await env.DB.prepare("SELECT id, name, kind, model, os, app, hw, relay, created_at, last_seen FROM devices WHERE github_id = ?1 ORDER BY last_seen DESC").bind(uid).all();
  return json({ devices: r.results });
}

// ---- 通知：op = add（同一个 key 只记一条；已经有了就原样返回——可能已经在别的设备上处理了，这台就不再弹）
//            act（处理：只在它还没被处理时生效；晚了一步就返回是在哪台设备上、怎么处理的）。
// 稍后提醒（action = snooze，until = 什么时候再出来）：到点以后各设备再显示，谁先处理算谁的 ----
async function notices(req, env, uid, json) {
  const b = await req.json().catch(() => ({}));
  const key = String(b.key || ""), dev = devOk(b.dev) ? b.dev : null, now = Date.now();
  if (!key || key.length > 200) return json({ error: "Bad request" }, 400);
  const get = env.DB.prepare(`SELECT n.*, d.name AS by_name FROM notices n LEFT JOIN devices d ON d.github_id = n.github_id AND d.id = n.by_dev
      WHERE n.github_id = ?1 AND n.key = ?2`).bind(uid, key);
  if (b.op === "add") {
    const r = await env.DB.batch([
      bump(env.DB, uid),
      env.DB.prepare(`INSERT INTO notices (github_id, key, app, title, body, data, created_at, dev, rev) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ${HEAD})
          ON CONFLICT (github_id, key) DO NOTHING`)
        .bind(uid, key, str(b.app, 60), str(b.title, 300), str(b.body, 2000), b.data ? str(JSON.stringify(b.data), 8000) : null, now, dev),
      get,
    ]);
    return json({ notice: r[2].results[0] || null, fresh: r[1].meta.changes === 1 });
  }
  if (b.op === "act") {
    const action = str(b.action, 40) || "dismiss", until = action === "snooze" && +b.until > now ? +b.until : null;
    const r = await env.DB.batch([
      bump(env.DB, uid),
      env.DB.prepare(`UPDATE notices SET state = ?3, action = ?4, by_dev = ?5, acted_at = ?6, until = ?7, rev = ${HEAD}
          WHERE github_id = ?1 AND key = ?2 AND (state = 'new' OR (state = 'snoozed' AND until <= ?6))`)
        .bind(uid, key, until ? "snoozed" : "done", action, dev, now, until),
      get,
    ]);
    return json({ ok: r[1].meta.changes === 1, notice: r[2].results[0] || null });
  }
  return json({ error: "Bad request" }, 400);
}
