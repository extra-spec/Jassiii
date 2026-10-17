import type { AIProvider } from "../lib/ai/provider";
import { chatInstructions, parseReply, propertyById, type Property } from "../lib/demo/chatbot";
import { analysisFromLead } from "../lib/demo/leads";
import type { Inbound } from "./inbound";
import type { WaSender } from "./kapso";
import { buildExtractMessages, parseExtract } from "./extract";
import { buildWaReport } from "./report";
import { rowToLead, type WaLeadRow, type WaRepo } from "./repo";

export interface AgentDeps {
  repo: WaRepo; ai: AIProvider; send: WaSender; biz: string; agentPhone?: string;
  /** Optional: turns text into an OGG/Opus voice note. Return null/throw to fall back to text. */
  voice?: (text: string) => Promise<Buffer | null>;
  now?: () => number; log?: (...a: unknown[]) => void;
}

/** Only exact one-word commands count, so a normal sentence from the agent's phone is still treated as a customer chat (lets one phone test everything). */
const AGENT_CMD = /^\s*(report|summary|leads?|help)\s*[.!]?\s*$/i;
const OPT_OUT = /^\s*(stop|unsubscribe|opt[\s-]?out)\s*[.!]?\s*$/i;
export const cardText = (p: Property) => `*${p.title}*\n${p.locality}, ${p.city}\n${p.price} · ${p.mode === "sale" ? "For sale" : "For rent"}\n${p.beds} · ${p.area} · ${p.furnishing}`;
const pretty = (p: string) => `+${p}`;

export class WhatsAppAgent {
  private now: () => number;
  private log: (...a: unknown[]) => void;
  constructor(private d: AgentDeps) { this.now = d.now ?? Date.now; this.log = d.log ?? ((...a) => console.log("[whatsapp]", ...a)); }

  /** Handles one inbound message. Never throws: a bad message must not break the others. */
  async handle(m: Inbound): Promise<void> {
    try {
      if (this.d.agentPhone && m.from === this.d.agentPhone && AGENT_CMD.test(m.text ?? m.transcript ?? "")) return await this.agentMessage(m);
      await this.customerMessage(m);
    } catch (e) {
      this.log("handler error", (e as Error).message);
      try { await this.d.send.sendText(m.from, "Sorry, I'm having trouble replying right now. Please try again in a moment."); } catch { /* nothing more to do */ }
    }
  }

  private async say(to: string, text: string) {
    await this.d.send.sendText(to, text);
    this.d.repo.recordMessage({ phone: to, direction: "out", kind: "text", body: text, at: this.now() });
  }

  /** Works out what the customer meant, whatever the message type. Returns null when we cannot read it. */
  private userText(m: Inbound): string | null {
    if (m.kind === "text") return m.text || null;
    if (m.kind === "audio") return m.transcript ?? null;
    if (m.kind === "button") {
      const [act, id] = (m.buttonId ?? "").split(":"); const p = id ? propertyById(id) : undefined;
      if (p && act === "more") return `Tell me more about the ${p.title} in ${p.locality}`;
      if (p && act === "visit") return `I'd like to visit the ${p.title} in ${p.locality}`;
      return m.text || null;
    }
    return null;
  }

  private async customerMessage(m: Inbound) {
    const { repo, send } = this.d, to = m.from;
    const text = this.userText(m);
    // Store first: if this message id was already stored, it is a webhook retry and we must not answer twice.
    const fresh = repo.recordMessage({ waId: m.id, phone: to, direction: "in", kind: m.kind, body: text ?? `[${m.type}]`, at: this.now() });
    if (!fresh) { this.log("duplicate message ignored", m.id); return; }
    repo.touchLead(to, m.name, this.now());
    void send.markRead(m.id);

    if (m.kind === "other") return void (await this.say(to, "I can read text and voice notes here. Could you type your message or send a voice note?"));
    if (!text) return void (await this.say(to, "Sorry, I couldn't hear that voice note clearly. Could you send it again, or type your message?"));
    if (OPT_OUT.test(text)) { repo.setOptOut(to); return void (await this.say(to, "Okay, you won't get further messages from us. Message us any time if you'd like help again.")); }

    // Step 1: just talk. The reply prompt has no hidden notes or tags, so the model has nothing to mistake for a tool call.
    const raw = await this.d.ai.reply([{ role: "system", content: chatInstructions(this.d.biz, { tags: false }) }, ...repo.history(to, 16)]);
    const { text: body, ids: tagIds, lead: tagLead } = parseReply(raw); // still strips any stray tag the model writes
    let row = repo.mergeLead(to, tagLead, m.kind === "audio" ? 1 : 0);

    const reply = body || (tagIds.length ? "Here's one that might suit you:" : "Sorry, could you say that again?");
    let sentAsVoice = false;
    if (m.kind === "audio" && this.d.voice) {
      try {
        const ogg = await this.d.voice(reply);
        if (ogg) { await send.sendVoice(to, ogg); repo.recordMessage({ phone: to, direction: "out", kind: "audio", body: reply, at: this.now() }); sentAsVoice = true; }
      } catch (e) { this.log("voice reply failed, sending text:", (e as Error).message); }
    }
    if (!sentAsVoice) await this.say(to, reply);

    // Step 2 (quiet): pick out the customer's details and which listings to show. If this fails the reply has already gone out.
    let ids = tagIds;
    try {
      const found = parseExtract(await this.d.ai.reply(buildExtractMessages(repo.history(to, 8))));
      row = repo.mergeLead(to, found.lead, 0);
      ids = [...new Set([...tagIds, ...found.ids])].slice(0, 2);
    } catch (e) { this.log("details step failed (the reply was still sent):", (e as Error).message); }

    for (const id of ids) {
      const p = propertyById(id); if (!p) continue;
      await send.sendButtons(to, cardText(p), [{ id: `more:${p.id}`, title: "More details" }, { id: `visit:${p.id}`, title: "Book a visit" }]);
      repo.recordMessage({ phone: to, direction: "out", kind: "card", body: `[Property card] ${p.title}, ${p.locality}`, at: this.now() });
    }
    await this.maybeAlertAgent(row);
  }

  /** Tells the agent the moment a customer asks for a viewing. Needs the agent's 24h WhatsApp window to be open. */
  private async maybeAlertAgent(row: WaLeadRow) {
    const { agentPhone, send, repo } = this.d;
    if (!agentPhone || row.alerted || !row.visit_time) return;
    const lead = rowToLead({ ...row, name: row.name ?? row.profile_name });
    const a = analysisFromLead(lead, row.voice_notes);
    const msg = `🔥 *New hot lead* via WhatsApp\n*${lead.name ?? "Customer"}* · ${a.intent ?? "Enquiry"}${a.requirement ? `\n${a.requirement}` : ""}\nViewing: ${row.visit_time}\nWhatsApp: ${pretty(row.phone)}\n\n${a.nextStep}`;
    try { await send.sendText(agentPhone, msg); repo.markAlerted(row.phone); }
    catch (e) { this.log("could not alert agent (their 24-hour window may be closed):", (e as Error).message); }
  }

  private async agentMessage(m: Inbound) {
    const to = m.from; const t = (m.text ?? m.transcript ?? "").trim().toLowerCase();
    if (/^(report|summary|today)\b/.test(t)) return void (await this.d.send.sendText(to, this.report().text));
    if (/^leads?\b/.test(t)) {
      const rows = this.d.repo.leadsSince(this.now() - 24 * 3600_000).slice(0, 8);
      return void (await this.d.send.sendText(to, rows.length ? "*Leads, last 24 hours*\n" + rows.map((r, i) => `${i + 1}. *${r.name ?? r.profile_name ?? "Customer"}* ${pretty(r.phone)}${r.intent ? ` · ${r.intent}` : ""}${r.visit_time ? ` · visit: ${r.visit_time}` : ""}`).join("\n") : "No leads in the last 24 hours."));
    }
    await this.d.send.sendText(to, "Hi! I'm your assistant's report line. Send *report* for today's summary or *leads* for the latest leads.");
  }

  report(now = this.now()) { return buildWaReport(this.d.repo, this.d.biz, now); }
}
