/** Parses Kapso v2 `whatsapp.message.received` webhooks (single or buffered batch). Never throws. */
export interface Inbound {
  id: string; from: string; name?: string; type: string; kind: "text" | "audio" | "button" | "other";
  text?: string; transcript?: string; buttonId?: string; timestamp?: number;
}
export interface ParseResult { messages: Inbound[]; skipped: string[] }

const digits = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).replace(/\D/g, "") : "");
const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" ? (v as Record<string, any>) : {});

export function parseInbound(event: string | undefined, body: unknown): ParseResult {
  const out: ParseResult = { messages: [], skipped: [] };
  if (event !== "whatsapp.message.received") { out.skipped.push(`event ${event ?? "none"} ignored`); return out; }
  const root = obj(body);
  const items: unknown[] = root.batch === true && Array.isArray(root.data) ? root.data : [body];
  for (const it of items) {
    const p = obj(it), m = obj(p.message), k = obj(m.kapso), conv = obj(p.conversation);
    if (!m.id) { out.skipped.push("no message id"); continue; }
    if (k.direction === "outbound" || k.passive === true) { out.skipped.push("outbound or passive message"); continue; }
    const from = digits(m.from) || digits(conv.phone_number);
    if (!from) { out.skipped.push("no phone number (business-scoped user id only)"); continue; }
    const type = String(m.type ?? "unknown");
    const base = { id: String(m.id), from, name: typeof conv.contact_name === "string" ? conv.contact_name : undefined, type, timestamp: Number(m.timestamp) || undefined };
    if (type === "text") { out.messages.push({ ...base, kind: "text", text: String(obj(m.text).body ?? "").trim() }); continue; }
    if (type === "interactive") {
      const i = obj(m.interactive), r = obj(i.button_reply ?? i.list_reply);
      out.messages.push({ ...base, kind: "button", text: String(r.title ?? "").trim(), buttonId: typeof r.id === "string" ? r.id : undefined }); continue;
    }
    if (type === "audio") {
      const t = k.transcript; const transcript = (typeof t === "string" ? t : typeof obj(t).text === "string" ? obj(t).text : "").trim();
      out.messages.push({ ...base, kind: "audio", transcript: transcript || undefined }); continue;
    }
    out.messages.push({ ...base, kind: "other" });
  }
  return out;
}
