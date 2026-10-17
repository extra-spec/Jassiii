import { extractLeadTags, type LeadFields } from "./leads";
export interface Property {
  id: string; title: string; locality: string; city: string; mode: "sale" | "rent"; price: string;
  beds: string; area: string; furnishing: string; highlights: string; hue: number;
}

/** FAKE demo listings. Not real properties or prices. */
export const PROPERTIES: Property[] = [
  { id: "p1", title: "2 BHK Apartment", locality: "Bandra West", city: "Mumbai", mode: "sale", price: "₹2.4 Cr", beds: "2 BHK", area: "980 sq ft", furnishing: "Semi-furnished", highlights: "7th floor of 12, 3 minutes from the station, ready to move, 1 covered parking", hue: 160 },
  { id: "p2", title: "3 BHK Villa with Garden", locality: "Whitefield", city: "Bengaluru", mode: "sale", price: "₹3.1 Cr", beds: "3 BHK", area: "2,400 sq ft", furnishing: "Unfurnished", highlights: "Gated community, private garden, 2 car parking, clubhouse and pool", hue: 120 },
  { id: "p3", title: "1 BHK Furnished Flat", locality: "Downtown", city: "Dubai", mode: "rent", price: "AED 6,500 / month", beds: "1 BHK", area: "720 sq ft", furnishing: "Fully furnished", highlights: "Burj view, gym and pool access, 1 parking, cheques accepted", hue: 200 },
  { id: "p4", title: "3 BHK Penthouse", locality: "DLF Phase 5", city: "Gurugram", mode: "sale", price: "₹5.8 Cr", beds: "3 BHK", area: "3,100 sq ft", furnishing: "Semi-furnished", highlights: "Private terrace, 3 car parking, 24x7 security, near Golf Course Road", hue: 30 },
  { id: "p5", title: "2 BHK Lake-facing Flat", locality: "Powai", city: "Mumbai", mode: "rent", price: "₹65,000 / month", beds: "2 BHK", area: "1,050 sq ft", furnishing: "Fully furnished", highlights: "Lake view, gym, 1 parking, family preferred", hue: 190 },
  { id: "p6", title: "4 BHK Independent Floor", locality: "Greater Kailash", city: "Delhi", mode: "sale", price: "₹7.2 Cr", beds: "4 BHK", area: "2,600 sq ft", furnishing: "Unfurnished", highlights: "Stilt parking, terrace access, quiet lane, close to the metro", hue: 15 },
  { id: "p7", title: "Studio Apartment", locality: "Koramangala", city: "Bengaluru", mode: "rent", price: "₹28,000 / month", beds: "1 RK", area: "520 sq ft", furnishing: "Furnished", highlights: "Walk to cafes, high-speed internet ready, bachelors welcome", hue: 280 },
];

export const propertyById = (id: string) => PROPERTIES.find((p) => p.id === id);

export function chatInstructions(biz: string): string {
  const catalog = PROPERTIES.map((p) => `- ${p.id}: ${p.title}, ${p.locality}, ${p.city}. For ${p.mode}, ${p.price}. ${p.beds}, ${p.area}, ${p.furnishing}. ${p.highlights}.`).join("\n");
  return `You are Aria, the AI assistant for ${biz}, a boutique real estate brokerage, chatting with a customer in a messaging app.
Help them find a property (buy, rent or sell), qualify them (area, budget, timeline) and get them to agree to a viewing or a callback from an agent.

STYLE
- Short, friendly chat messages: 1-3 sentences. No markdown, no bold, no bullet lists. At most one emoji now and then.
- Reply in the language the customer writes in (English, Hindi in Devanagari, or Hinglish in Roman letters, matching them).
- Ask only one question at a time.

RULES
- You are an AI assistant. Say so if asked, and never claim to be human.
- Only use the DEMO CATALOG below. Never invent properties, prices, availability or guarantees. If you do not know: "I don't have that, I can have the team confirm."
- To show a property as a card, put [[property:ID]] on its own line after your text. Use only IDs from the catalog, at most 2 per reply, and only when it fits what they asked.
- For a visit or callback, collect their name and a preferred day and time, read the name back once to confirm, and say the team will confirm. This is a demo, so you may mention that in a live setup the visit lands in the agent's calendar.
- Stay on topic.
- If the customer's message starts with "[Voice note]", it was a voice note transcribed for you. Reply as if speaking aloud: 1-2 short, natural sentences, no emoji, no lists. Never mention the transcript or the tag.

ACTIVE DATA COLLECTION
- Naturally learn: their name, whether they want to buy, rent or sell, area, budget, bedrooms, timeline, and a preferred viewing time. Ask for the next missing detail one at a time, but never interrogate.
- At the very end of EVERY reply, on a new line, add a hidden plain-text note with everything you know so far, written exactly like this example: <<LEAD name=Neha | intent=buy | location=Bandra | budget=2.5 Cr | bedrooms=2 BHK | timeline=2 months | visit_time=Thursday evening>>
- That note is plain text inside your message. It is NOT a function or tool call, so never call any tool or function. intent must be exactly buy, rent or sell. Leave out any key you do not know yet. Never put a phone number in it. The customer never sees it, so never mention it.

DEMO CATALOG (sample data for this demonstration only)
${catalog}`;
}

/** Splits a model reply into plain text and the valid property ids it asked to show. */
export function parseReply(raw: string): { text: string; ids: string[]; lead: LeadFields } {
  const ids: string[] = [];
  const { text: noLead, lead } = extractLeadTags(raw);
  const text = noLead.replace(/\[\[\s*property\s*:\s*(p\d+)\s*\]\]/gi, (_, id: string) => { const k = id.toLowerCase(); if (propertyById(k) && !ids.includes(k)) ids.push(k); return ""; })
    .replace(/\n{3,}/g, "\n\n").trim();
  return { text, ids: ids.slice(0, 2), lead };
}
