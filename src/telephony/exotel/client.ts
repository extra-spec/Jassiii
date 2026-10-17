import type { Env } from "../../lib/env";

export interface OutboundResult { ok: boolean; callSid?: string; status: number; body: string }

/** Connect Voice AI API: POST /v1/Accounts/{sid}/Calls/connect (developer.exotel.com/docs/agentstream/connect-voice-ai). */
export async function startOutboundCall(env: Env, a: { to: string; callId: number }): Promise<OutboundResult> {
  const wsHost = new URL(env.PUBLIC_BASE_URL).host;
  // callId rides on the stream URL (full URL must stay < 600 chars) AND in CustomField (< 128 chars).
  const streamUrl = `wss://${wsHost}/ws/exotel?callId=${a.callId}&dir=out&key=${encodeURIComponent(env.EXOTEL_WS_PASSWORD)}`;
  if (streamUrl.length >= 600) throw new Error("StreamUrl too long (Exotel max 600 chars)");
  const form = new URLSearchParams({
    From: a.to,
    CallerId: env.EXOTEL_CALLER_ID,
    StreamUrl: streamUrl,
    StreamType: "bidirectional",
    StatusCallback: `${env.PUBLIC_BASE_URL}/api/exotel/status?key=${encodeURIComponent(env.EXOTEL_WS_PASSWORD)}`,
    CustomField: `callId=${a.callId}`,
    Record: "true",
  });
  const url = `https://${env.EXOTEL_API_HOST}/v1/Accounts/${env.EXOTEL_ACCOUNT_SID}/Calls/connect`;
  const auth = Buffer.from(`${env.EXOTEL_API_KEY}:${env.EXOTEL_API_TOKEN}`).toString("base64");
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  const body = await res.text();
  const sid = /<Sid>([^<]+)<\/Sid>/i.exec(body)?.[1] ?? (() => { try { const j = JSON.parse(body); return j?.Call?.Sid ?? j?.call?.sid; } catch { return undefined; } })();
  return { ok: res.ok, callSid: sid, status: res.status, body };
}
