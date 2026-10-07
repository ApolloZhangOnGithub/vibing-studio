-- schema.sql —— D1（SQLite）：账号、余额、账本。金额一律用「微元」整数（¥1 = 1 000 000），不用浮点
-- 本地：wrangler d1 execute native-agent-desktop-os-web --local --file schema.sql；线上把 --local 换成 --remote

CREATE TABLE IF NOT EXISTS users (
  github_id  INTEGER PRIMARY KEY,
  login      TEXT    NOT NULL,
  avatar     TEXT,
  allowed    INTEGER NOT NULL DEFAULT 0,  -- 邀请制：1 才能用（ALLOW_LOGINS 里的账号首次登录时自动置 1）
  balance    INTEGER NOT NULL DEFAULT 0,  -- 余额，微元
  created_at INTEGER NOT NULL,
  last_seen  INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS users_login ON users (login COLLATE NOCASE);

-- 账本：每一笔加减都记一行（充值 grant、对话扣费 chat、管理员调整 adjust）
CREATE TABLE IF NOT EXISTS ledger (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  github_id     INTEGER NOT NULL,
  at            INTEGER NOT NULL,
  kind          TEXT    NOT NULL,
  delta         INTEGER NOT NULL,          -- 正数加、负数扣，微元
  model         TEXT,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  cache_read    INTEGER,
  cache_write   INTEGER,
  note          TEXT
);
CREATE INDEX IF NOT EXISTS ledger_user_at ON ledger (github_id, at);

-- ======== 跟着账号走的数据（同 iCloud：服务器上只有一份，设备上的都是缓存）。窗口、Dock、壁纸这些界面状态跟着设备走，不在这里 ========
-- agent 与对话：ns = agent | sess（会话，不含每一轮）| turn（一轮，id = 会话 id:序号）。大记录拆成几段（part / parts，同一次写的各段 v 相同，D1 单个值不超过 2 MB）；
-- rev = 这个账号第几次写（store_head 里数），设备记着拉到了哪儿，之后只拉新的；data 为 NULL = 删了
CREATE TABLE IF NOT EXISTS store (
  github_id INTEGER NOT NULL,
  ns        TEXT    NOT NULL,
  id        TEXT    NOT NULL,
  part      INTEGER NOT NULL DEFAULT 0,
  parts     INTEGER NOT NULL DEFAULT 1,
  v         TEXT,
  data      TEXT,
  at        INTEGER NOT NULL,             -- 设备上改的时间
  dev       TEXT,                         -- 哪台设备写的
  rev       INTEGER NOT NULL,
  PRIMARY KEY (github_id, ns, id, part)
);
CREATE INDEX IF NOT EXISTS store_by_rev ON store (github_id, rev, ns, id, part);
CREATE TABLE IF NOT EXISTS store_head (
  github_id INTEGER PRIMARY KEY,
  rev       INTEGER NOT NULL
);

-- 设备：每个浏览器 / App 一台（id 由设备自己生成、存在设备上），名字给人看（「正在 iPhone 上运行」「已在 Mac 上处理」）
CREATE TABLE IF NOT EXISTS devices (
  github_id  INTEGER NOT NULL,
  id         TEXT    NOT NULL,
  name       TEXT,
  kind       TEXT,                        -- mac | ios
  model      TEXT,                        -- 设备自己认出来的型号（「MacBook Pro (14-inch, Nov 2023)」）；线上的库由 account.js 第一次用到时补这一列
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  PRIMARY KEY (github_id, id)
);

-- 租约：同一件事同一时间只在一台设备上做（agent:<id> = 谁在跑这个 agent，别的设备只看）；until 过了没续就算放了
CREATE TABLE IF NOT EXISTS leases (
  github_id INTEGER NOT NULL,
  name      TEXT    NOT NULL,
  dev       TEXT    NOT NULL,
  until     INTEGER NOT NULL,
  PRIMARY KEY (github_id, name)
);

-- 通知：同一件事只有一条（key 由那件事定，如日历某个日程的某一次提醒），各设备显示的是同一条；
-- 处理（关掉、点开、完成、稍后提醒）经服务器按当前状态判断，只生效一次，别的设备跟着收起（同 RFC 9074 的 VALARM ACKNOWLEDGED）
CREATE TABLE IF NOT EXISTS notices (
  github_id  INTEGER NOT NULL,
  key        TEXT    NOT NULL,
  app        TEXT,
  title      TEXT,
  body       TEXT,
  data       TEXT,                        -- JSON：点开去哪、按钮
  created_at INTEGER NOT NULL,
  dev        TEXT,                        -- 哪台设备先报的
  state      TEXT    NOT NULL DEFAULT 'new', -- new | done | snoozed
  action     TEXT,                        -- 怎么处理的：dismiss | open | complete | snooze | 按钮的名字
  by_dev     TEXT,                        -- 在哪台设备上处理的
  acted_at   INTEGER,
  until      INTEGER,                     -- 稍后提醒：到这个时间再出来
  rev        INTEGER NOT NULL,
  PRIMARY KEY (github_id, key)
);
CREATE INDEX IF NOT EXISTS notices_by_rev ON notices (github_id, rev);

-- 原生 App 登录：GitHub 授权在系统浏览器里做完，回调给 App 一个一次性的 code（paimon://auth?code=…）；
-- App 带着 code 和当初那个 challenge 的原文（verifier，同 PKCE）来换会话。2 分钟内、只能用一次
CREATE TABLE IF NOT EXISTS app_codes (
  code       TEXT    PRIMARY KEY,
  github_id  INTEGER NOT NULL,
  challenge  TEXT    NOT NULL,
  expires    INTEGER NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0
);

-- 任务翻译的缓存（src/translate.js）：同一个账号，同一句话翻成同一种语言只翻一次（别的窗口、别的设备直接用）。
-- key = sha256(版本 \n 语言 \n 规整后的原文) 的前 16 字节（hex）；hits = 命中过几次（用量页看）
CREATE TABLE IF NOT EXISTS translations (
  github_id  INTEGER NOT NULL,
  key        TEXT    NOT NULL,
  lang       TEXT    NOT NULL,
  src        TEXT    NOT NULL,
  out        TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  hits       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (github_id, key)
);
