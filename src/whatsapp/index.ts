import type { AIProvider } from "../lib/ai/provider";
import type { Db } from "../lib/db";
import type { WhatsAppEnv } from "../lib/env";
import { GoogleTTS } from "../lib/tts/provider";
import { getTTSProvider } from "../lib/tts";
import { WhatsAppAgent } from "./agent";
import { FollowupService } from "./followups";
import { parseInbound } from "./inbound";
import { KapsoClient, verifySignature, type WaSender } from "./kapso";
import { isReportDue, waRecords } from "./report";
import { WaRepo } from "./repo";
import { timingSafeEqual } from "node:crypto";

const safeEq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[whatsapp]", ...a);

export function createWhatsApp(env: WhatsAppEnv, db: Db, ai: AIProvider, sender?: WaSender) {
  const repo = new WaRepo(db);
  const send = sender ?? new KapsoClient({ apiKey: env.KAPSO_API_KEY, phoneNumberId: env.KAPSO_PHONE_NUMBER_ID, baseUrl: env.KAPSO_API_BASE });

  let voice: ((t: string) => Promise<Buffer | null>) | undefined;
  if (env.WA_VOICE_REPLIES === "true") {
    const tts = getTTSProvider();
    if (tts instanceof GoogleTTS) voice = (t) => tts.synthOggOpus(t, /[\u0900-\u097F]/.test(t) ? "hi" : "en");
    else log("WA_VOICE_REPLIES is on but TTS_PROVIDER is not 'google', so voice-note replies are disabled (text only).");
  }
  const agent = new WhatsAppAgent({ repo, ai, send, biz: env.BUSINESS_NAME, agentPhone: env.AGENT_PHONE, voice, log });
  const followups = new FollowupService({ repo, ai, send, biz: env.BUSINESS_NAME, tz: env.REPORT_TZ, hours: env.FOLLOWUP_HOURS, quietAfterMinutes: env.FOLLOWUP_AFTER_MINUTES, log });
  const tokenOk = (token: string | null) => {
    if (!env.DASHBOARD_TOKEN || !token) return false;
    const a = Buffer.from(token), b = Buffer.from(env.DASHBOARD_TOKEN);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  return {
    repo, agent, followups,
    /** Verifies the signature, then answers 200 at once and does the slow work (AI, voice) in the background (Kapso needs a reply within 10 s). */
    handleWebhook(raw: string, headers: Record<string, string | string[] | undefined>, urlKey?: string | null): { status: number; text: string } {
      const h = (k: string) => { const v = headers[k]; return Array.isArray(v) ? v[0] : v; };
      // Accepted if Kapso signed it (HMAC), OR if Kapso sent no signature and the webhook URL carries our secret as ?key=.
      // A signature that is present but wrong is always rejected.
      const sig = h("x-webhook-signature");
      const okSig = sig !== undefined && verifySignature(raw, sig, env.KAPSO_WEBHOOK_SECRET);
      const okKey = sig === undefined && typeof urlKey === "string" && urlKey.length > 0 && safeEq(urlKey, env.KAPSO_WEBHOOK_SECRET);
      if (!okSig && !okKey) { log(sig === undefined ? "rejected webhook: no signature and no/incorrect ?key= in the URL" : "rejected webhook with a bad signature"); return { status: 401, text: "unauthorized" }; }
      let body: unknown;
      try { body = JSON.parse(raw); } catch { log("webhook body was not JSON:", raw.slice(0, 1500)); return { status: 400, text: "bad json" }; }
      const { messages, skipped } = parseInbound(h("x-webhook-event"), body);
      log(`webhook accepted: event=${h("x-webhook-event") ?? "none"}, ${messages.length} message(s) to answer${skipped.length ? `, skipped: ${skipped.join("; ")}` : ""}`);
      void (async () => { for (const m of messages) await agent.handle(m); })().catch((e) => log("background error", (e as Error).message));
      return { status: 200, text: "ok" };
    },
    /** Called every minute by server.ts: sends the daily report to the agent at the configured time. */
    async tick(now = Date.now()) {
      void followups.run(); // picks up queued follow-ups that were waiting for the sending hours
      if (!env.AGENT_PHONE) return;
      const { due, today } = isReportDue(now, env.REPORT_TZ, env.DAILY_REPORT_TIME, repo.getSetting("wa_last_report_date"));
      if (!due) return;
      repo.setSetting("wa_last_report_date", today); // mark first, so a failure does not retry every minute
      try { await send.sendText(env.AGENT_PHONE, agent.report(now).text); log("daily report sent"); repo.setSetting("wa_last_report_status", "sent"); }
      catch (e) { log("daily report failed (the agent must have messaged this number in the last 24 hours, or a template is needed):", (e as Error).message); repo.setSetting("wa_last_report_status", "failed"); }
    },
    /** Live data for the dashboard. Returns null when the token is wrong or the dashboard token is not configured. */
    overview(token: string | null) {
      if (!env.DASHBOARD_TOKEN || !token) return null;
      const a = Buffer.from(token), b = Buffer.from(env.DASHBOARD_TOKEN);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
      return { records: waRecords(repo, 0, env.BUSINESS_NAME, 60), biz: env.BUSINESS_NAME };
    },
    /** Dashboard follow-up actions. Every call needs the dashboard token. */
    async followupApi(action: string, token: string | null, body: Record<string, unknown>): Promise<{ status: number; json: unknown }> {
      if (!tokenOk(token)) return { status: 401, json: { error: "unauthorized" } };
      const ids = () => (Array.isArray(body.ids) ? body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 100) : []);
      switch (action) {
        case "list": return { status: 200, json: followups.view() };
        case "draft": { const phones = Array.isArray(body.phones) ? body.phones.map(String).filter((p) => /^\d{8,15}$/.test(p)).slice(0, 25) : []; void followups.draftMany(phones).catch((e) => log("drafting error", (e as Error).message)); return { status: 202, json: { started: phones.length } }; }
        case "update": return { status: 200, json: { ok: followups.updateText(Number(body.id), String(body.text ?? "")) } };
        case "discard": return { status: 200, json: { ok: followups.discard(Number(body.id)) } };
        case "send": { const n = followups.queue(ids()); void followups.run().catch((e) => log("sending error", (e as Error).message)); return { status: 202, json: { queued: n } }; }
        default: return { status: 404, json: { error: "unknown action" } };
      }
    },
    status: () => ({ configured: true, voiceReplies: !!voice, agentPhoneSet: !!env.AGENT_PHONE, dashboardTokenSet: !!env.DASHBOARD_TOKEN, reportTime: `${env.DAILY_REPORT_TIME} ${env.REPORT_TZ}`, lastReport: repo.getSetting("wa_last_report_status") ?? "never" }),
  };
}
