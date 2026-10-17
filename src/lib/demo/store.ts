import type { Analysis, TranscriptLine } from "./analysis";
import type { Vertical } from "./personas";
import { analysisFromLead, chatRecord, type LeadFields } from "./leads";

export interface CallRecord {
  id: string; startedAt: number; durationSecs: number; biz: string; vertical: Vertical; lang: "en" | "hi";
  transcript: TranscriptLine[]; analysis?: Analysis | null; // undefined = still summarising, null = failed
  sample?: boolean;
  channel?: "voice" | "chat"; voiceNotes?: number; lead?: LeadFields; phone?: string; live?: boolean;
}

const KEY = "strike_demo_calls_v1";
export const stripTags = (t: string) => t.replace(/\[[^\]]{1,40}\]/g, " ").replace(/\s+/g, " ").trim();

export function loadCalls(): CallRecord[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function save(list: CallRecord[]) { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 20))); } catch { /* storage full or blocked */ } }
export function addCall(rec: CallRecord) { save([rec, ...loadCalls().filter((c) => c.id !== rec.id)]); }
export function updateAnalysis(id: string, analysis: Analysis | null) { save(loadCalls().map((c) => (c.id === id ? { ...c, analysis } : c))); }

export const fmtDuration = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`);

export type LeadStatus = "NEW" | "CONTACTED" | "FOLLOW_UP" | "BOOKING_REQUESTED";
export function leadStatus(a?: Analysis | null): LeadStatus {
  switch (a?.outcome) { case "booking_requested": return "BOOKING_REQUESTED"; case "callback_requested": return "FOLLOW_UP"; case "info_only": return "CONTACTED"; default: return "NEW"; }
}

/** Sample calls so the dashboard is never empty. Clearly marked as samples in the UI. */
export function seedCalls(vertical: Vertical, biz: string, now = Date.now()): CallRecord[] {
  const H = 3600_000;
  const a = (o: Partial<Analysis> & { summary: string }): Analysis => ({ urgency: "low", outcome: "info_only", sentiment: "positive", ...o });
  if (vertical === "plumbing") return [
    { id: "s1", sample: true, startedAt: now - 1.2 * H, durationSecs: 142, biz, vertical, lang: "en", transcript: [
      { role: "assistant", content: `Hello, you've reached ${biz}. I'm Max, an AI assistant. What's the plumbing problem I can help with?` },
      { role: "user", content: "My kitchen tap is leaking badly." }, { role: "assistant", content: "Sorry to hear that. Which area are you in, and is the water running constantly?" },
      { role: "user", content: "Rohini, yes it's constant. Can someone come today?" }, { role: "assistant", content: "I've noted that as urgent. I'll have the team confirm a same-day slot with you shortly." }],
      analysis: a({ summary: "Caller reported a constantly leaking kitchen tap in Rohini and wants a same-day visit. Marked urgent for the team.", callerName: "Rakesh", intent: "Leaking tap", requirement: "Kitchen tap, constant leak, Rohini", urgency: "high", outcome: "booking_requested", preferredTime: "Today", nextStep: "Confirm a same-day technician slot." }) },
    { id: "s2", sample: true, startedAt: now - 3.5 * H, durationSecs: 96, biz, vertical, lang: "hi", transcript: [
      { role: "assistant", content: "नमस्ते, आप से बात कर रहे हैं। मैं मैक्स हूँ, एक एआई असिस्टेंट।" }, { role: "user", content: "ड्रेन ब्लॉक हो गया है, कितना खर्चा आएगा?" },
      { role: "assistant", content: "ड्रेन क्लियरिंग की शुरुआत सात सौ निन्यानवे रुपये से होती है। क्या मैं टीम से कॉलबैक करवा दूँ?" }, { role: "user", content: "हाँ, कल सुबह।" }],
      analysis: a({ summary: "Caller asked the price for clearing a blocked drain (from Rs 799) and asked for a callback tomorrow morning.", intent: "Blocked drain", outcome: "callback_requested", preferredTime: "Tomorrow morning", nextStep: "Call back tomorrow morning with a visit quote." }) },
    { id: "s3", sample: true, startedAt: now - 6 * H, durationSecs: 61, biz, vertical, lang: "en", transcript: [
      { role: "assistant", content: `Hello, you've reached ${biz}. I'm Max, an AI assistant.` }, { role: "user", content: "Do you install water heaters?" }, { role: "assistant", content: "Yes, we do. The team gives a quote after a site visit. Want me to arrange that?" }, { role: "user", content: "Not now, thanks." }],
      analysis: a({ summary: "Caller asked whether water heater installation is offered. Informed that a quote follows a site visit; caller declined for now.", intent: "Water heater installation", outcome: "info_only", sentiment: "neutral", nextStep: "No action needed." }) },
  ];
  return [
    { id: "s1", sample: true, startedAt: now - 1.5 * H, durationSecs: 187, biz, vertical, lang: "en", transcript: [
      { role: "assistant", content: `Hello, thank you for calling ${biz}. I'm Aria, an AI assistant. Are you looking to buy, rent, or sell a property?` },
      { role: "user", content: "I want to buy a 2 BHK in Bandra, budget around two and a half crore." }, { role: "assistant", content: "We have a 2 BHK in Bandra West listed at 2.4 crore. Would you like to view it this week?" },
      { role: "user", content: "Yes, Thursday evening works. I'm Neha." }, { role: "assistant", content: "Thanks, Neha. I've noted Thursday evening and the team will confirm the viewing." }],
      analysis: a({ summary: "Neha wants to buy a 2 BHK in Bandra within about 2.5 crore. She was offered the 2.4 crore Bandra West listing and asked to view it on Thursday evening.", callerName: "Neha", intent: "Buy a 2 BHK", requirement: "Bandra, budget around 2.5 crore", outcome: "booking_requested", preferredTime: "Thursday evening", nextStep: "Confirm the Thursday evening viewing." }) },
    { id: "s2", sample: true, startedAt: now - 4 * H, durationSecs: 118, biz, vertical, lang: "hi", transcript: [
      { role: "assistant", content: "नमस्ते, आपका स्वागत है। मैं आरिया हूँ, एक एआई असिस्टेंट।" }, { role: "user", content: "मुझे दुबई में किराये पर फ्लैट चाहिए।" },
      { role: "assistant", content: "डाउनटाउन दुबई में एक वन बीएचके फर्निश्ड फ्लैट छह हज़ार पाँच सौ दिरहम महीने पर उपलब्ध है। क्या आप जानकारी चाहेंगे?" }, { role: "user", content: "हाँ, एजेंट से बात करवा दीजिए।" }],
      analysis: a({ summary: "Caller is looking to rent in Dubai and was told about a furnished 1 BHK in Downtown Dubai at 6,500 AED per month. Asked to speak with an agent.", intent: "Rent in Dubai", requirement: "Furnished 1 BHK, Downtown Dubai", outcome: "callback_requested", nextStep: "Agent to call back with details." }) },
    { id: "s3", sample: true, startedAt: now - 7 * H, durationSecs: 74, biz, vertical, lang: "en", transcript: [
      { role: "assistant", content: `Hello, thank you for calling ${biz}. I'm Aria, an AI assistant.` }, { role: "user", content: "Do you have villas with a garden?" }, { role: "assistant", content: "Yes, a 3 BHK villa with a garden in Whitefield, Bengaluru, at 3.1 crore. Shall I arrange a callback?" }, { role: "user", content: "I'll think about it." }],
      analysis: a({ summary: "Caller asked about villas with gardens and was told about the Whitefield 3 BHK at 3.1 crore. Undecided.", intent: "Villa with garden", requirement: "Garden villa", outcome: "info_only", sentiment: "neutral", nextStep: "Optional follow-up message." }) },
  ];
}

const U = (c: string): TranscriptLine => ({ role: "user", content: c });
const B = (c: string): TranscriptLine => ({ role: "assistant", content: c });

/** Sample WhatsApp chats (real estate only) so the dashboard and daily report are never empty. */
export function seedChats(biz: string, now = Date.now()): CallRecord[] {
  const H = 3600_000;
  const mk = (id: string, ago: number, secs: number, lang: "en" | "hi", lead: LeadFields, vn: number, t: TranscriptLine[]): CallRecord => ({ ...chatRecord({ id, startedAt: now - ago * H, durationSecs: secs, biz, lang, transcript: t, lead, voiceNotes: vn }), sample: true });
  return [
    mk("w1", 0.8, 412, "en", { name: "Neha", intent: "buy", location: "Bandra West", budget: "around 2.5 Cr", bedrooms: "2 BHK", timeline: "within 2 months", visitTime: "Thursday evening" }, 2, [
      B(`Hi! Welcome to ${biz}. I'm Aria, an AI assistant. Are you looking to buy, rent or sell a property?`), U("🎤 Voice note: I want to buy a two BHK in Bandra, budget around two and a half crore."),
      B("Lovely. I have a 2 BHK in Bandra West at 2.4 Cr, 3 minutes from the station. Want to see it?"), U("🎤 Voice note: Yes, Thursday evening works. I'm Neha."), B("Thanks Neha, I've noted Thursday evening. The team will confirm the viewing.")]),
    mk("w2", 2.6, 268, "en", { name: "Imran", intent: "rent", location: "Downtown Dubai", budget: "AED 7,000", bedrooms: "1 BHK", timeline: "next month" }, 0, [
      B("Hi! Welcome. I'm Aria, an AI assistant."), U("Looking for a 1BHK on rent in Dubai next month, up to 7000 AED"), B("I have a furnished 1 BHK in Downtown Dubai at AED 6,500 a month. Shall I arrange a callback?"), U("Yes please, I'm Imran")]),
    mk("w3", 5.2, 190, "hi", { name: "Priya", intent: "sell", location: "Whitefield", bedrooms: "3 BHK" }, 1, [
      B("नमस्ते! मैं आरिया हूँ, एक एआई असिस्टेंट।"), U("🎤 Voice note: मुझे व्हाइटफील्ड में अपना तीन बीएचके फ्लैट बेचना है।"), B("ज़रूर। क्या मैं आपका नाम पूछ सकती हूँ?"), U("Priya"), B("धन्यवाद Priya, हमारी टीम आपको कॉल करेगी।")]),
  ];
}

export function seedAll(vertical: Vertical, biz: string, now = Date.now()): CallRecord[] {
  return [...seedCalls(vertical, biz, now), ...(vertical === "realestate" ? seedChats(biz, now) : [])];
}
export { analysisFromLead };
