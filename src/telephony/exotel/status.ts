/** Exotel StatusCallback body (form-encoded). Field names per developer.exotel.com/api/statuscallback. */
export interface StatusPayload { callSid?: string; status?: string; recordingUrl?: string; customField?: string; duration?: number; raw: Record<string, string> }

export function parseStatusBody(body: string, contentType: string): StatusPayload {
  let raw: Record<string, string> = {};
  if (contentType.includes("json")) { try { raw = Object.fromEntries(Object.entries(JSON.parse(body)).map(([k, v]) => [k, String(v)])); } catch { /* logged by caller */ } }
  else raw = Object.fromEntries(new URLSearchParams(body));
  const pick = (...k: string[]) => k.map((x) => raw[x]).find((v) => v !== undefined && v !== "");
  const dur = Number(pick("Duration", "ConversationDuration", "CallDuration"));
  return { callSid: pick("CallSid", "Sid"), status: pick("Status", "CallStatus"), recordingUrl: pick("RecordingUrl"), customField: pick("CustomField"), duration: Number.isFinite(dur) ? dur : undefined, raw };
}

export function callIdFromCustomField(cf?: string): number | undefined {
  const m = cf ? /callId=(\d+)/.exec(cf) : null;
  return m ? Number(m[1]) : undefined;
}
