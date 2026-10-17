import fs from "node:fs";
// Tiny .env loader so this works on Windows without extra tools.
if (fs.existsSync(".env")) for (const l of fs.readFileSync(".env", "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
import { loadEnv } from "../src/lib/env";
import { Db } from "../src/lib/db";
import { CallsRepo } from "../src/lib/db/calls.repo";
import { startOutboundCall } from "../src/telephony/exotel/client";

(async () => {
  const to = process.argv[2];
  if (!to || !/^\+[1-9]\d{6,14}$/.test(to)) { console.error("Usage: npm run call -- +919876543210   (number in international format)"); process.exit(1); }
  let env; try { env = loadEnv(); } catch (e) { console.error((e as Error).message); process.exit(1); }
  const calls = new CallsRepo(new Db(env.DB_PATH));
  const callId = calls.create({ direction: "OUTBOUND", to, from: env.EXOTEL_CALLER_ID });
  const r = await startOutboundCall(env, { to, callId });
  console.log("Exotel replied", r.status, r.body.slice(0, 1500));
  if (r.callSid) calls.setSid(callId, r.callSid);
  if (!r.ok) { calls.finish(callId, "FAILED"); process.exit(1); }
})();
