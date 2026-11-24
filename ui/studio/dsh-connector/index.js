import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const name = "vibing-studio-session-input";
export const inject = {sessionController: {required: true}, workspaceRegistry: {required: true}, deepseekAccount: {required: false}};
export function apply(ctx) {
  const dir = path.join(process.env.DSH_HOME || path.join(os.homedir(), ".dsh"), "vibing-studio-ipc");
  fs.mkdirSync(dir, {recursive: true, mode: 0o700});
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077)) {
    throw new Error("DSH 本机连接目录需要仅当前用户可访问");
  }
  const address = path.join(dir, (process.env.VIBING_DSH_BACKGROUND === "1" ? "studio-" : "") + process.pid + ".sock");
  const server = net.createServer({allowHalfOpen: true}, socket => {
    let bytes = 0;
    const chunks = [];
    socket.setTimeout(15000, () => socket.destroy());
    socket.on("error", () => socket.destroy());
    socket.on("data", chunk => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) socket.destroy();
      else chunks.push(chunk);
    });
    socket.on("end", async () => {
      try {
        const message = JSON.parse(Buffer.concat(chunks));
        if (message.action === "balance") {
          const wallet = await ctx.deepseekAccount.getBalance({
            version: "1", locale: Intl.DateTimeFormat().resolvedOptions().locale,
            timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60
          });
          socket.end(JSON.stringify({accepted: true, value: wallet}));
          return;
        }
        if (message.action === "catalog" || message.action === "selectModel") {
          const value = message.action === "catalog" ? await ctx.sessionController.modelCatalog()
            : await ctx.sessionController.selectModel(message.selection);
          socket.end(JSON.stringify({accepted: true, value}));
          return;
        }
        if (message.action === "create") {
          const workspace = message.workspaceId || (await ctx.workspaceRegistry.create(os.homedir())).id;
          const created = await ctx.sessionController.create({workspaceId: workspace});
          socket.end(JSON.stringify({accepted: true, sessionId: created.sessionId}));
          return;
        }
        const {sessionId, requestId, text} = message;
        if (typeof sessionId !== "string" || !/^session-[\da-f-]{36}$/i.test(sessionId) ||
            typeof requestId !== "string" || !/^[\da-f-]{36}$/i.test(requestId) ||
            typeof text !== "string" || !text.trim()) throw new Error("无效的 DSH 消息");
        const receipt = await ctx.sessionController.prompt({
          sessionId, requestId, mode: "queue", content: [{type:"text", text}]
        }, AbortSignal.timeout(15000));
        socket.end(JSON.stringify(receipt));
      } catch (error) {
        socket.end(JSON.stringify({error: error.message}));
      }
    });
  });
  const balanceAddress = address + ".balance";
  const balanceServer = net.createServer({allowHalfOpen: true}, socket => server.emit("connection", socket));
  balanceServer.listen(balanceAddress);
  ctx.effect(() => () => balanceServer.close());
  server.listen(address);
  ctx.effect(() => () => server.close());
}
