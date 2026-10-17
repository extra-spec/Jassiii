import type { ChatMessage } from "../lib/ai/provider";
import { PROPERTIES, propertyById } from "../lib/demo/chatbot";
import { extractLeadTags, mergeLead, normalizeLead, type LeadFields } from "../lib/demo/leads";

/** A separate, quiet AI step: reads the chat and returns the customer's details and which listings to show as cards. */
export function buildExtractMessages(history: { role: "user" | "assistant"; content: string }[]): ChatMessage[] {
  const catalog = PROPERTIES.map((p) => `${p.id} = ${p.title}, ${p.locality}, ${p.city} (for ${p.mode})`).join("\n");
  const system = `You read a WhatsApp chat between a real estate assistant and a customer and pull out facts.
Reply with ONLY one JSON object: no markdown, no explanation. Do not call any tools or functions.
Keys: name, intent ("buy", "rent" or "sell"), location, budget, bedrooms, timeline, visit_time, property_ids.
Use null for anything the CUSTOMER has not said. Never guess. Never include phone numbers.
property_ids is an array (at most 2) of catalog ids that the assistant's LAST message recommends or describes, or that the customer asks about. Use [] if none.
Catalog:
${catalog}`;
  const convo = history.slice(-8).map((m) => `${m.role === "user" ? "Customer" : "Assistant"}: ${m.content}`).join("\n").slice(0, 5000);
  return [{ role: "system", content: system }, { role: "user", content: `CHAT:\n${convo}\n\nReturn the JSON now.` }];
}

export function parseExtract(text: string): { lead: LeadFields; ids: string[] } {
  const tagged = extractLeadTags(text); // also accepts the <<LEAD ...>> fallback note
  let lead: LeadFields = tagged.lead;
  let ids: string[] = [];
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) {
    try {
      const o = JSON.parse(text.slice(a, b + 1));
      lead = mergeLead(lead, normalizeLead(o));
      if (Array.isArray(o.property_ids)) ids = o.property_ids.map((x: unknown) => String(x).toLowerCase()).filter((id: string) => !!propertyById(id));
    } catch { /* not JSON: keep whatever the note gave us */ }
  }
  return { lead, ids: [...new Set(ids)].slice(0, 2) };
}
