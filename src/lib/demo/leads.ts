import type { Analysis } from "./analysis";
import type { CallRecord } from "./store";
import type { TranscriptLine } from "./analysis";

export interface LeadFields { name?: string; intent?: "buy" | "rent" | "sell"; location?: string; budget?: string; bedrooms?: string; timeline?: string; visitTime?: string }

const clean = (v: unknown): string | undefined => {
  if (typeof v === "number") v = String(v);
  if (typeof v !== "string") return undefined;
  const t = v.trim().slice(0, 80);
  return t && !/^(null|none|unknown|n\/a|-)$/i.test(t) ? t : undefined;
};

export function normalizeLead(o: unknown): LeadFields {
  if (!o || typeof o !== "object") return {};
  const r = o as Record<string, unknown>;
  const out: LeadFields = { name: clean(r.name), location: clean(r.location), budget: clean(r.budget), bedrooms: clean(r.bedrooms), timeline: clean(r.timeline), visitTime: clean(r.visitTime ?? r.visit_time) };
  const i = clean(r.intent)?.toLowerCase();
  if (i === "buy" || i === "rent" || i === "sell") out.intent = i;
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as LeadFields;
}
export const mergeLead = (a: LeadFields, b: LeadFields): LeadFields => ({ ...a, ...b });

/** Reads "name=Neha | intent=buy | budget=2.5 Cr" into lead fields. */
function parsePairs(body: string): LeadFields {
  const o: Record<string, string> = {};
  for (const part of body.split("|")) { const i = part.indexOf("="); if (i > 0) o[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim(); }
  return normalizeLead(o);
}

/** Removes the hidden lead note from a reply (new <<LEAD ...>> format, and the older [[lead:{...}]] one) and returns the fields it carried. */
export function extractLeadTags(raw: string): { text: string; lead: LeadFields } {
  let lead: LeadFields = {};
  let text = raw.replace(/<<\s*LEAD\b([\s\S]*?)>>/gi, (_m, body: string) => { lead = mergeLead(lead, parsePairs(body)); return ""; });
  text = text.replace(/\[\[\s*lead\s*:\s*(\{[\s\S]*?\})\s*\]\]/gi, (_m, j: string) => {
    try { lead = mergeLead(lead, normalizeLead(JSON.parse(j))); } catch { /* ignore a malformed tag */ }
    return "";
  });
  text = text.replace(/<<\s*LEAD[\s\S]*$/i, "").replace(/\[\[\s*lead[\s\S]*$/i, ""); // never show a half-written note to the customer
  return { text, lead };
}

const VERB = { buy: "Buy", rent: "Rent", sell: "Sell" } as const;

/** Builds the dashboard "analysis" for a chat straight from the captured fields (no extra AI call). */
export function analysisFromLead(lead: LeadFields, voiceNotes: number): Analysis {
  const intent = lead.intent ? `${VERB[lead.intent]} ${lead.bedrooms ? "a " + lead.bedrooms : "a property"}` : undefined;
  const requirement = [lead.location, lead.budget && `budget ${lead.budget}`, lead.timeline].filter(Boolean).join(", ") || undefined;
  const outcome: Analysis["outcome"] = lead.visitTime ? "booking_requested" : lead.name && lead.intent ? "callback_requested" : lead.intent ? "info_only" : "no_outcome";
  const who = lead.name ?? "A customer";
  const vn = voiceNotes > 0 ? ` and sent ${voiceNotes} voice note${voiceNotes > 1 ? "s" : ""}` : "";
  const want = intent ? ` Looking to ${intent.toLowerCase()}${requirement ? ` (${requirement})` : ""}.` : " No clear requirement yet.";
  const visit = lead.visitTime ? ` Wants a viewing: ${lead.visitTime}.` : "";
  return {
    summary: `${who} messaged on WhatsApp${vn}.${want}${visit}`, callerName: lead.name, intent, requirement, preferredTime: lead.visitTime,
    nextStep: outcome === "booking_requested" ? "Confirm the viewing." : outcome === "callback_requested" ? "Call back with matching properties." : "Follow up if they return.",
    urgency: "low", outcome, sentiment: "positive",
  };
}

export function chatRecord(a: { id: string; startedAt: number; durationSecs: number; biz: string; lang: "en" | "hi"; transcript: TranscriptLine[]; lead: LeadFields; voiceNotes: number }): CallRecord {
  return { id: a.id, startedAt: a.startedAt, durationSecs: a.durationSecs, biz: a.biz, vertical: "realestate", lang: a.lang, transcript: a.transcript, analysis: analysisFromLead(a.lead, a.voiceNotes), channel: "chat", voiceNotes: a.voiceNotes, lead: a.lead };
}
