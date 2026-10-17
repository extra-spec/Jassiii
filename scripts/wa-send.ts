import { loadEnvConfig } from "@next/env";
import { loadWhatsAppEnv } from "../src/lib/env";
import { KapsoClient } from "../src/whatsapp/kapso";

(async () => {
  loadEnvConfig(process.cwd());
  const to = (process.argv[2] ?? "").replace(/\D/g, "");
  if (!/^\d{8,15}$/.test(to)) { console.error("Usage: npm run wa:send -- 919876543210   (number with country code, digits only)"); process.exit(1); }
  let env; try { env = loadWhatsAppEnv(); } catch (e) { console.error((e as Error).message); process.exit(1); }
  if (!env) { console.error("No KAPSO_* settings found in .env."); process.exit(1); }
  const c = new KapsoClient({ apiKey: env.KAPSO_API_KEY, phoneNumberId: env.KAPSO_PHONE_NUMBER_ID, baseUrl: env.KAPSO_API_BASE });
  try { await c.sendText(to, `Hi! This is a test message from ${env.BUSINESS_NAME}'s assistant. Reply to this message to chat with it.`); console.log("Sent. Check WhatsApp on that phone."); }
  catch (e) { console.error((e as Error).message); console.error("Note: WhatsApp only allows free text if that person messaged this number in the last 24 hours. If not, message the number first, then run this again."); process.exit(1); }
})();
