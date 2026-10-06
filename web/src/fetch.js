// fetch.js —— WebFetch 工具（同 Claude Code 的 WebFetch）：服务器替模型抓一个网页，转成好读的 Markdown。
// 安全：只抓公网 http(s)；内网、本机、带账号密码的地址一律拒绝；跨站跳转不跟，把新地址告诉模型让它自己决定要不要再抓。
// 限制：20 秒、5 MB；二进制（图片、PDF、压缩包）不读。

const MAX_BYTES = 5 * 1024 * 1024, TIMEOUT = 20000, MAX_HOPS = 5;

// 内网 / 本机 / 保留地址（Worker 上线后本来也打不到，但本地 wrangler dev 能打到你的局域网）
export function blockedHost(host) {
  host = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host.includes(".") && !host.includes(":")) return true; // 裸主机名
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/.test(host)) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (m) {
    const a = +m[1], b = +m[2];
    const c = +m[3];
    // 另外挡掉：192.0.0.0/24（IETF 协议分配）、192.0.2 / 198.51.100 / 203.0.113（文档用）、198.18.0.0/15（基准测试）
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224 ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
  }
  if (host.includes(":")) return host === "::1" || host === "::" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || /^::ffff:/.test(host);
  return false;
}

// 抓一页：{ url, finalUrl, status, statusText, bytes, contentType, title, text, truncated } 或 { redirect } 或 { error }
export async function fetchPage(input) {
  let url;
  try { url = new URL(String(input || "").trim()); } catch { return { error: "网址不对：" + input }; }
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:") return { error: "只支持 http(s) 网址" };
  if (url.username || url.password) return { error: "网址里不能带账号密码" };
  if (blockedHost(url.hostname)) return { error: "不能抓内网或本机地址：" + url.hostname };
  const start = url.toString(), ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    let res, hops = 0;
    for (;;) {
      res = await fetch(url.toString(), {
        redirect: "manual", signal: ctl.signal,
        headers: { "user-agent": "Mozilla/5.0 (compatible; WebFetch; +https://code.paimon.beer)", accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5", "accept-language": "zh-CN,zh;q=0.9,en;q=0.8" },
      });
      if (res.status < 300 || res.status >= 400 || !res.headers.get("location")) break;
      const next = new URL(res.headers.get("location"), url);
      if (next.protocol === "http:") next.protocol = "https:";
      const bare = (h) => h.replace(/^www\./, "");
      // 跨站跳转：不跟，告诉模型新地址
      if (bare(next.hostname) !== bare(url.hostname) || blockedHost(next.hostname)) return { url: start, status: res.status, statusText: res.statusText, redirect: next.toString() };
      if (++hops > MAX_HOPS) return { error: "跳转太多次（超过 " + MAX_HOPS + " 次）" };
      url = next;
    }
    // 读正文，最多 5 MB
    const reader = res.body.getReader(), chunks = [];
    let bytes = 0, truncated = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (bytes + value.byteLength > MAX_BYTES) { chunks.push(value.subarray(0, MAX_BYTES - bytes)); bytes = MAX_BYTES; truncated = true; await reader.cancel(); break; }
      chunks.push(value);
      bytes += value.byteLength;
    }
    const buf = new Uint8Array(bytes);
    let o = 0;
    for (const c of chunks) { buf.set(c, o); o += c.byteLength; }
    const type = (res.headers.get("content-type") || "").toLowerCase();
    const out = { url: start, finalUrl: url.toString(), status: res.status, statusText: res.statusText, bytes, contentType: type.split(";")[0].trim(), truncated, title: "", text: "" };
    if (/^(image|audio|video|font)\/|application\/(pdf|zip|gzip|octet-stream|x-)/.test(type)) return Object.assign(out, { error: "不是网页或文本（" + out.contentType + "），读不了" });
    const text = decode(buf, type);
    // 太大的页面只转前 2MB（正则转换在超大页面上又慢又占内存）
    if (/html|xml/.test(type) || (!type && /^\s*</.test(text))) Object.assign(out, htmlToMarkdown(text.length > 2e6 ? text.slice(0, 2e6) : text, url));
    else if (/json/.test(type)) { try { out.text = JSON.stringify(JSON.parse(text), null, 2); } catch { out.text = text; } }
    else out.text = text;
    return out;
  } catch (e) {
    return { error: e.name === "AbortError" ? "超时（" + TIMEOUT / 1000 + " 秒）" : "抓取失败：" + e.message };
  } finally {
    clearTimeout(timer);
  }
}

// 字符集：content-type 里有就用；没有就看页面开头的 <meta charset>；解不了按 UTF-8
function decode(buf, type) {
  let cs = (/charset=["']?([\w-]+)/.exec(type) || [])[1];
  if (!cs) {
    let head = "";
    for (let i = 0; i < Math.min(buf.length, 4096); i++) head += String.fromCharCode(buf[i]);
    cs = (/<meta[^>]+charset=["']?([\w-]+)/i.exec(head) || [])[1];
  }
  try { return new TextDecoder(cs || "utf-8").decode(buf); } catch { return new TextDecoder("utf-8").decode(buf); }
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", trade: "™", mdash: "—", ndash: "–", hellip: "…", laquo: "«", raquo: "»",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", middot: "·", times: "×", divide: "÷", yen: "¥", euro: "€", pound: "£", cent: "¢", bull: "•", rarr: "→", larr: "←", uarr: "↑", darr: "↓", deg: "°", plusmn: "±", ensp: " ", emsp: " ", thinsp: " ", zwj: "", zwnj: "", shy: "" };
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
    if (e[0] !== "#") return ENT[e.toLowerCase()] ?? m;
    const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    try { return String.fromCodePoint(n); } catch { return m; }
  });
}
const strip = (s) => decodeEntities(s.replace(/<[^>]+>/g, ""));
const abs = (href, base) => { try { return new URL(decodeEntities(href), base).toString(); } catch { return ""; } };

// HTML → Markdown（够读就行，不求还原排版）：正文优先取唯一的 <main> / <article>；导航、页脚、侧栏、按钮去掉；
// 标题、段落、列表（带缩进）、引用、代码块（带语言）、行内代码、粗斜体、链接（绝对地址）、有 alt 的图片、表格
export function htmlToMarkdown(html, base) {
  const title = strip(((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || "")).replace(/\s+/g, " ").trim();
  html = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|noscript|template|textarea|svg|head|canvas|math)\b[\s\S]*?<\/\1\s*>/gi, "");
  const only = (tag) => { const all = html.match(new RegExp("<" + tag + "\\b[\\s\\S]*?<\\/" + tag + "\\s*>", "gi")); return all && all.length === 1 ? all[0] : null; };
  const main = only("main") || only("article");
  let text = convert(main || html, base);
  if (main && text.replace(/\s/g, "").length < 200) text = convert(html, base);
  return { title, text };
}
function convert(html, base) {
  const keep = []; // 代码块、表格先换成占位符，最后放回（不参与空白整理）
  const hold = (s) => "\u0000" + (keep.push(s) - 1) + "\u0000";
  html = html.replace(/<(nav|footer|aside|button|select|dialog|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, "");
  html = html.replace(/<pre\b([^>]*)>([\s\S]*?)<\/pre\s*>/gi, (m, attrs, body) => {
    const lang = (/(?:language|lang)-([\w+#-]+)/.exec(attrs + body.slice(0, 200)) || [])[1] || "";
    const code = strip(body.replace(/<br\s*\/?>/gi, "\n")).replace(/^\n+|\s+$/g, "");
    return "\n\n" + hold("```" + lang + "\n" + code + "\n```") + "\n\n";
  });
  html = html.replace(/<table\b[\s\S]*?<\/table\s*>/gi, (t) => {
    const rows = [];
    (t.match(/<tr\b[\s\S]*?(?=<tr\b|<\/table)/gi) || []).forEach((tr) => {
      const cells = (tr.match(/<t[hd]\b[\s\S]*?(?=<t[hd]\b|<\/tr|$)/gi) || []).map((c) => inline(c.replace(/^<t[hd]\b[^>]*>/i, ""), base).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/\|/g, "\\|").trim());
      if (cells.length) rows.push(cells);
    });
    if (!rows.length) return "";
    const n = rows.reduce((m, r) => Math.max(m, r.length), 0), line = (r) => "| " + Array.from({ length: n }, (_, i) => decodeEntities(r[i] || "")).join(" | ") + " |";
    return "\n\n" + hold([line(rows[0]), "|" + " --- |".repeat(n)].concat(rows.slice(1).map(line)).join("\n")) + "\n\n";
  });
  html = html.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (m, n, t) => { const s = strip(inline(t, base)).replace(/\s+/g, " ").trim(); return s ? "\n\n" + "#".repeat(+n) + " " + s + "\n\n" : ""; });
  // 列表：按 ul / ol 的嵌套深度缩进；ol 编号
  let depth = 0;
  const counters = [];
  html = html.replace(/<(\/?)(ul|ol|li)\b[^>]*>/gi, (m, close, tag) => {
    tag = tag.toLowerCase();
    if (tag !== "li") {
      if (close) { depth = Math.max(0, depth - 1); counters.pop(); } else { depth++; counters.push(tag === "ol" ? 0 : -1); }
      return "\n";
    }
    if (close) return "";
    const c = counters[counters.length - 1], bullet = c >= 0 ? (counters[counters.length - 1] = c + 1) + ". " : "- ";
    return "\n" + "  ".repeat(Math.max(0, depth - 1)) + "\u0002" + bullet;
  });
  html = html.replace(/<blockquote\b[^>]*>/gi, "\n\n\u0003").replace(/<\/blockquote\s*>/gi, "\u0004\n\n");
  html = inline(html, base);
  html = html.replace(/<br\s*\/?>/gi, "\n").replace(/<hr\b[^>]*>/gi, "\n\n---\n\n")
    .replace(/<\/?(p|div|section|article|main|header|figure|figcaption|address|details|summary|dl|center|fieldset|form)\b[^>]*>/gi, "\n\n")
    .replace(/<\/?(dt|dd|tr|caption|legend|label)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  let text = decodeEntities(html)
    .replace(/[ \t\r\f\v ]+/g, " ")
    .split("\n").map((l) => l.trim()).join("\n")
    .replace(/\u0002/g, "").replace(/\n{3,}/g, "\n\n");
  // 引用：标记之间的行前面加 >
  text = text.replace(/\u0003([\s\S]*?)\u0004/g, (m, body) => body.trim().split("\n").map((l) => "> " + l).join("\n"));
  text = text.replace(/\u0000(\d+)\u0000/g, (m, i) => keep[+i]).replace(/\n{3,}/g, "\n\n").trim();
  return text;
}
// 行内：代码、粗斜体、链接、图片
function inline(html, base) {
  return html
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code\s*>/gi, (m, c) => { const s = strip(c); return s.trim() ? "`" + s.replace(/`/g, "ˋ") + "`" : ""; })
    // 粗斜体只包行内的字：里面有块（占位的表格 / 代码、换行的段落）就不加星号
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (m, t, s) => (s.replace(/<[^>]+>/g, "").trim() && !/[\u0000\n]|<(p|div|h\d|li|table)\b/i.test(s) ? "**" + s.trim() + "**" : s))
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (m, t, s) => (s.replace(/<[^>]+>/g, "").trim() && !/[\u0000\n]|<(p|div|h\d|li|table)\b/i.test(s) ? "*" + s.trim() + "*" : s))
    .replace(/<a\b[^>]*?href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi, (m, q, href, s) => {
      const t = s.replace(/<(?!img)[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (!t) return "";
      if (/^(#|javascript:|mailto:)/i.test(href)) return t;
      const u = abs(href, base);
      return u ? "[" + t + "](" + u + ")" : t;
    })
    .replace(/<img\b[^>]*>/gi, (m) => {
      const alt = (/\balt\s*=\s*(["'])(.*?)\1/i.exec(m) || [])[2], src = (/\bsrc\s*=\s*(["'])(.*?)\1/i.exec(m) || [])[2];
      return alt && alt.trim() && src ? "![" + decodeEntities(alt.trim()) + "](" + abs(src, base) + ")" : "";
    });
}
