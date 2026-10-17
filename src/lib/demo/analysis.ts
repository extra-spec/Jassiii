import { z } from "zod";
import type { ChatMessage } from "../ai/provider";
import { PERSONAS, type Vertical } from "./personas";

export interface TranscriptLine { role: "user" | "assistant"; content: string }

const str = z.string().nullable().optional();
const schema = z.object({
  summary: z.string().min(1).max(800),
  callerName: str, intent: str, requirement: str, preferredTime: str, nextStep: str,
  urgency: z.enum(["low", "medium", "high"]).catch("low"),
  outcome: z.enum(["booking_requested", "callback_requested", "info_only", "no_outcome"]).catch("no_outcome"),
  sentiment: z.enum(["positive", "neutral", "negative"]).catch("neutral"),
});

export interface Analysis {
  summary: string; callerName?: string; intent?: string; requirement?: string; preferredTime?: string; nextStep?: string;
  urgency: "low" | "medium" | "high";
  outcome: "booking_requested" | "callback_requested" | "info_only" | "no_outcome";
  sentiment: "positive" | "neutral" | "negative";
}

const clean = (v: string | null | undefined) => { const t = v?.trim(); return t && t.toLowerCase() !== "null" ? t : undefined; };

/** Pulls the JSON object out of a model reply (tolerates code fences / chatter). Returns null if unusable. */
export function parseAnalysis(text: string): Analysis | null {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  let json: unknown;
  try { json = JSON.parse(text.slice(a, b + 1)); } catch { return null; }
  const r = schema.safeParse(json);
  if (!r.success) return null;
  const v = r.data;
  return { summary: v.summary.trim(), callerName: clean(v.callerName), intent: clean(v.intent), requirement: clean(v.requirement), preferredTime: clean(v.preferredTime), nextStep: clean(v.nextStep), urgency: v.urgency, outcome: v.outcome, sentiment: v.sentiment };
}

export function buildAnalysisMessages(transcript: TranscriptLine[], biz: string, vertical: Vertical): ChatMessage[] {
  const label = PERSONAS[vertical].label;
  const system = `You analyse a phone call between an AI receptionist for "${biz}" (${label}) and a caller, for the business owner's dashboard.
Reply with ONLY one JSON object, no markdown, with these keys:
summary (2-3 plain sentences: what the caller wanted and what was agreed),
callerName (string or null), intent (short phrase, e.g. "Buy a 2 BHK" or "Leaking tap"), requirement (area, budget, problem details or null),
preferredTime (string or null), nextStep (one short sentence for the team),
urgency ("low"|"medium"|"high"),
outcome ("booking_requested"|"callback_requested"|"info_only"|"no_outcome"),
sentiment ("positive"|"neutral"|"negative").
Write in English even if the call was in Hindi; keep names as spoken. Use ONLY what was said: use null when something was not stated, and never invent phone numbers, prices or times.`;
  const body = transcript.map((m) => `${m.role === "user" ? "Caller" : "Assistant"}: ${m.content}`).join("\n").slice(0, 6000);
  return [{ role: "system", content: system }, { role: "user", content: `CALL TRANSCRIPT:\n${body}\n\nReturn the JSON now.` }];
}
