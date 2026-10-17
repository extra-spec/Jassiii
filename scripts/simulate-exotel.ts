// Pretends to be Exotel: connects to our WS server and sends connected/start/media/stop. Use: npm run simulate
import fs from "node:fs";
if (fs.existsSync(".env")) for (const l of fs.readFileSync(".env", "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
import WebSocket from "ws";
const port = process.env.PORT ?? "3000";
const ws = new WebSocket(`ws://localhost:${port}/ws/exotel?key=${encodeURIComponent(process.env.EXOTEL_WS_PASSWORD ?? "")}`);
let got = 0, marks = 0;
ws.on("open", async () => {
  ws.send(JSON.stringify({ event: "connected" }));
  ws.send(JSON.stringify({ event: "start", sequence_number: "1", stream_sid: "MZsim", start: { stream_sid: "MZsim", call_sid: "CAsim", account_sid: "ACsim", from: "+919876543210", to: "+918047491899", custom_parameters: {} } }));
  for (let i = 0; i < 5; i++) { ws.send(JSON.stringify({ event: "media", media: { chunk: String(i + 2), payload: Buffer.alloc(3200).toString("base64") } })); await new Promise((r) => setTimeout(r, 100)); }
  setTimeout(() => { ws.send(JSON.stringify({ event: "stop" })); ws.close(); }, 2500);
});
ws.on("message", (d) => { const m = JSON.parse(d.toString()); if (m.event === "media") { got++; const n = Buffer.from(m.media.payload, "base64").length; if (n % 320 !== 0 || n < 3200) console.error("BAD CHUNK SIZE", n); } if (m.event === "mark") marks++; });
ws.on("close", () => { console.log(`simulator: received ${got} audio frames, ${marks} mark(s)`); process.exit(got > 0 && marks === 1 ? 0 : 1); });
ws.on("error", (e) => { console.error("simulator error:", e.message); process.exit(1); });
