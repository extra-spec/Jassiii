import http from "node:http";
import next from "next";
import { loadEnvConfig } from "@next/env";
import { WebSocketServer } from "ws";
import { loadCoreEnv, loadExotelEnv, loadWhatsAppEnv, type CoreEnv, type ExotelEnv } from "./src/lib/env";
import { getAIProvider } from "./src/lib/ai";
import { createWhatsApp } from "./src/whatsapp";
import { Db } from "./src/lib/db";
import { CallsRepo } from "./src/lib/db/calls.repo";
import { ExotelSession } from "./src/telephony/exotel/session";
import { isAuthorized } from "./src/telephony/exotel/auth";
import { parseStatusBody, callIdFromCustomField } from "./src/telephony/exotel/status";

function mustLoad<T>(fn: () => T): T {
  try { return fn(); } catch (e) { console.error((e as Error).message); process.exit(1); }
}

async function main() {
  loadEnvConfig(process.cwd()); // reads .env (same loader Next uses)
  const env: CoreEnv = mustLoad(loadCoreEnv);
  const exotel: ExotelEnv | null = mustLoad(loadExotelEnv);
  const waEnv = mustLoad(loadWhatsAppEnv);
  console.log(exotel ? "Telephony: Exotel enabled" : "Telephony: off (demo mode only)");

  const dev = process.env.NODE_ENV !== "production";
  if (dev) console.warn("NOTE: dev mode compiles pages on first visit, which can freeze a live call. Test calls with `npm run build` then `npm start`.");

  const db = new Db(env.DB_PATH);
  const calls = new CallsRepo(db);
  const wa = waEnv ? createWhatsApp(waEnv, db, getAIProvider()) : null;
  console.log(wa ? "WhatsApp: Kapso enabled" : "WhatsApp: off (set the KAPSO_* settings to turn it on)");
  const app = next({ dev });
  const handle = app.getRequestHandler();
  await app.prepare();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      if (exotel && req.method === "POST" && url.pathname === "/api/exotel/status") return await onStatus(req, res, url);
      if (wa && req.method === "POST" && url.pathname === "/api/whatsapp/webhook") {
        const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
        const r = wa.handleWebhook(Buffer.concat(chunks).toString(), req.headers, url.searchParams.get("key")); res.statusCode = r.status; res.end(r.text); return;
      }
      if (wa && req.method === "GET" && url.pathname === "/api/whatsapp/overview") {
        const data = wa.overview(url.searchParams.get("token"));
        res.statusCode = data ? 200 : 401; res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify(data ?? { error: "unauthorized" })); return;
      }
      if (wa && url.pathname.startsWith("/api/whatsapp/followups")) {
        const action = url.pathname.split("/")[4] || "list";
        res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
        if ((action === "list") !== (req.method === "GET")) { res.statusCode = 405; res.end(JSON.stringify({ error: "wrong method" })); return; }
        let body: Record<string, unknown> = {};
        if (req.method === "POST") {
          const chunks: Buffer[] = []; let size = 0;
          for await (const c of req) { size += (c as Buffer).length; if (size > 100_000) break; chunks.push(c as Buffer); }
          try { body = JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch { res.statusCode = 400; res.end(JSON.stringify({ error: "bad json" })); return; }
        }
        const r = await wa.followupApi(action, url.searchParams.get("token"), body); res.statusCode = r.status; res.end(JSON.stringify(r.json)); return;
      }
      if (url.pathname === "/api/whatsapp/status") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(wa ? wa.status() : { configured: false })); return; }
      if (url.pathname === "/healthz") { res.end("ok"); return; }
      return handle(req, res);
    } catch (e) {
      console.error("request error", e);
      if (!res.headersSent) res.statusCode = 500;
      res.end("error");
    }
  });

  async function onStatus(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString();
    console.log("[exotel-status] FULL BODY:", body.slice(0, 4000));
    if (!isAuthorized(req.headers.authorization, url.searchParams, exotel!.EXOTEL_WS_USER, exotel!.EXOTEL_WS_PASSWORD)) { res.statusCode = 401; res.end("unauthorized"); return; }
    const p = parseStatusBody(body, String(req.headers["content-type"] ?? ""));
    const id = callIdFromCustomField(p.customField) ?? (p.callSid ? calls.findBySid(p.callSid)?.id : undefined);
    if (id) calls.finish(id, (p.status ?? "completed").toUpperCase(), p.recordingUrl, p.duration);
    else console.warn("[exotel-status] could not match a call record", { callSid: p.callSid, customField: p.customField });
    res.end("ok");
  }

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (!exotel || url.pathname !== "/ws/exotel") {
      // Let Next's dev HMR socket through in dev; refuse everything else.
      if (dev && url.pathname.startsWith("/_next/")) return;
      socket.destroy(); return;
    }
    if (!isAuthorized(req.headers.authorization, url.searchParams, exotel!.EXOTEL_WS_USER, exotel!.EXOTEL_WS_PASSWORD)) {
      console.warn("[exotel-ws] rejected unauthorized upgrade from", req.socket.remoteAddress);
      socket.write("HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic\r\n\r\n"); socket.destroy(); return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => new ExotelSession(ws, calls, url.searchParams));
  });

  server.listen(env.PORT, () => console.log(`STRIKE.AI listening on port ${env.PORT} (${dev ? "development" : "production"})`));
  if (wa) setInterval(() => { void wa.tick(); }, 60_000);
}
main().catch((e) => { console.error(e); process.exit(1); });
