// relay.js —— Vibing Studio 的 iPad 端：iPad 上的页面借你的 Mac 干活（终端、文件、Claude Code / Codex 的会话都在 Mac 上）。
//   Mac 上 App 的页面（host）、iPad 的页面（client）各连一条 WebSocket 到这里；同一个账号一个 Durable Object（Relay），只转发：
//   client → host：调用（{ id, cmd, args }，带上是哪台设备 from / cname）；host → client：回复（to: 那台设备）、事件（to: "*" 给这台 Mac 的所有 client）。
//   谁能连：Worker 先验会话（只有这个账号自己），交过来时按账号分好；Mac 那边还要逐台设备点「允许」（ui/studio/remote-host.js），并只放行一部分命令。
//   GET /api/relay/hosts：这个账号现在在线的 Mac（iPad 上选连哪一台）
const clean = (s) => (/^[\w-]{4,64}$/.test(s || "") ? s : "");
const cleanName = (s) => String(s || "").replace(/[\u0000-\u001f]/g, "").slice(0, 80);
const MAX = 4 * 1024 * 1024; // 一条消息最多 4 MB（大文件两边自己分块）

export class Relay {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.endsWith("/hosts")) return new Response(JSON.stringify(this.hosts()), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
    if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const role = url.searchParams.get("role"), dev = clean(url.searchParams.get("device"));
    if (!dev) return new Response("device required", { status: 400 });
    const pair = new WebSocketPair(), client = pair[0], server = pair[1];
    if (role === "host") {
      // 同一台 Mac 又连上来（页面刷新、重连）：旧的那条关掉，只留一条
      this.state.getWebSockets("host:" + dev).forEach((ws) => { try { ws.close(4000, "replaced"); } catch (e) { /* 已经断了 */ } });
      this.state.acceptWebSocket(server, ["host", "host:" + dev]);
      server.serializeAttachment({ role: "host", dev, name: cleanName(url.searchParams.get("name")) || "Mac", since: Date.now() });
      this.toClients(dev, { sys: "host-online" });
    } else if (role === "client") {
      const cid = clean(url.searchParams.get("client"));
      if (!cid) return new Response("client required", { status: 400 });
      this.state.acceptWebSocket(server, ["client", "client:" + dev, "cid:" + cid]);
      const cname = cleanName(url.searchParams.get("cname")) || "iPad", loc = cleanName(url.searchParams.get("loc"));
      server.serializeAttachment({ role: "client", dev, cid, cname, loc, since: Date.now() });
      const host = this.host(dev);
      if (host) host.send(JSON.stringify({ sys: "client-join", from: cid, cname, loc }));
      else server.send(JSON.stringify({ sys: "host-offline" }));
    } else return new Response("bad role", { status: 400 });
    return new Response(null, { status: 101, webSocket: client });
  }
  host(dev) { return this.state.getWebSockets("host:" + dev)[0] || null; }
  // 在线的 Mac，和现在连着它们的设备（「设备」App 画连线用：哪台 iPad 在用哪台 Mac）
  hosts() {
    return this.state.getWebSockets("host").map((ws) => {
      const a = ws.deserializeAttachment() || {};
      const clients = this.state.getWebSockets("client:" + a.dev).map((c) => { const b = c.deserializeAttachment() || {}; return { cid: b.cid, cname: b.cname, since: b.since }; });
      return { device: a.dev, name: a.name, since: a.since, clients };
    });
  }
  toClients(dev, msg) {
    const s = JSON.stringify(msg);
    this.state.getWebSockets("client:" + dev).forEach((ws) => { try { ws.send(s); } catch (e) { /* 断了 */ } });
  }
  async webSocketMessage(ws, data) {
    if (typeof data !== "string" || data.length > MAX) return;
    let m;
    try { m = JSON.parse(data); } catch (e) { return; }
    if (!m || typeof m !== "object") return;
    const a = ws.deserializeAttachment() || {};
    if (m.sys === "ping") return ws.send('{"sys":"pong"}');
    if (a.role === "client") {
      const host = this.host(a.dev);
      if (!host) { if (m.id != null) ws.send(JSON.stringify({ id: m.id, ok: false, error: { code: "E_OFFLINE", message: "Mac 不在线" } })); return; }
      m.from = a.cid;
      m.cname = a.cname;
      if (a.loc) m.loc = a.loc; // 在哪（城市、IP）：Mac 问「允许」时写上
      host.send(JSON.stringify(m));
    } else if (a.role === "host") {
      const to = m.to;
      delete m.to;
      if (to === "*") this.toClients(a.dev, m);
      else if (to) {
        const c = this.state.getWebSockets("cid:" + to).filter((w) => (w.deserializeAttachment() || {}).dev === a.dev)[0];
        if (c) { try { c.send(JSON.stringify(m)); } catch (e) { /* 断了 */ } }
      }
    }
  }
  async webSocketClose(ws) { this.gone(ws); }
  async webSocketError(ws) { this.gone(ws); }
  gone(ws) {
    const a = ws.deserializeAttachment() || {};
    if (a.role === "host" && !this.state.getWebSockets("host:" + a.dev).some((w) => w !== ws)) this.toClients(a.dev, { sys: "host-offline" });
    if (a.role === "client") { const host = this.host(a.dev); if (host) { try { host.send(JSON.stringify({ sys: "client-leave", from: a.cid })); } catch (e) { /* 断了 */ } } }
  }
}
