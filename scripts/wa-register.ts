import { loadEnvConfig } from "@next/env";
import { loadWhatsAppEnv } from "../src/lib/env";
import { registerWebhook } from "../src/whatsapp/kapso";

(async () => {
  loadEnvConfig(process.cwd());
  let env; try { env = loadWhatsAppEnv(); } catch (e) { console.error((e as Error).message); process.exit(1); }
  if (!env) { console.error("No KAPSO_* settings found in .env. Fill them in first (see .env.example)."); process.exit(1); }
  if (!env.PUBLIC_BASE_URL) { console.error("PUBLIC_BASE_URL is missing in .env. Put your live https address there (for example your Railway link), no trailing slash."); process.exit(1); }
  const url = `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/api/whatsapp/webhook`;
  console.log(`Registering ${url} for phone number ID ${env.KAPSO_PHONE_NUMBER_ID} ...`);
  const r = await registerWebhook({ apiKey: env.KAPSO_API_KEY, baseUrl: env.KAPSO_API_BASE, phoneNumberId: env.KAPSO_PHONE_NUMBER_ID, url, secret: env.KAPSO_WEBHOOK_SECRET });
  console.log(r.ok ? "Done. Kapso replied:" : `Kapso refused (status ${r.status}):`, r.body.slice(0, 1500));
  if (!r.ok) process.exit(1);
})();
