import type { AIProvider } from "../lib/ai/provider";
import { parseReply } from "../lib/demo/chatbot";
import type { WaSender } from "./kapso";
import type { WaFollowupRow, WaLeadRow, WaRepo } from "./repo";

export const WINDOW_MS = 24 * 3600_000; // WhatsApp: free-text messages only within 24h of the customer's last message
export const MAX_ATTEMPTS = 3;

export type Reason = "viewing" | "callback" | "quiet" | "recent";
const REASON_LABEL: Record<Reason, string> = { viewing: "Viewing not confirmed", callback: "Callback pending", quiet: "Went quiet", recent: "Recent chat" };
const REASON_BRIEF: Record<Reason, (l: WaLeadRow) => string> = {
  viewing: (l) => `they asked for a viewing${l.visit_time ? ` (${l.visit_time})` : ""} and it is not confirmed yet. Ask them to confirm the time`,
  callback: () => "they asked for a callback and the team will reach them. Check that a call still suits them",
  quiet: () => "they stopped replying. Gently check whether they are still interested",
  recent: () => "this is a friendly check-in after your recent chat",
};

export interface Candidate {
  phone: string; name: string | null; reason: Reason; reasonLabel: string; summary: string;
  lastInboundAt: number | null; windowOpen: boolean; hoursLeft: number; attempts: number; preselect: boolean;
}
export interface FollowupItem extends WaFollowupRow { name: string | null; replied: boolean }

/** True when the local time in `tz` falls inside "HH:MM-HH:MM" (overnight ranges allowed). */
export function inSendingHours(nowMs: number, tz: string, range: string): boolean {
  const m = /^(\d\d:\d\d)-(\d\d:\d\d)$/.exec(range); if (!m) return true;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(nowMs));
  const t = `${parts.find((p) => p.type === "hour")?.value}:${parts.find((p) => p.type === "minute")?.value}`;
  return m[1] <= m[2] ? t >= m[1] && t < m[2] : t >= m[1] || t < m[2];
}

const summaryOf = (l: WaLeadRow) => [l.intent && ({ buy: "Buy", rent: "Rent", sell: "Sell" } as Record<string, string>)[l.intent], l.bedrooms, l.location].filter(Boolean).join(" · ") || "Enquiry";
const fallbackText = (name: string | null, biz: string) => `Hi${name ? " " + name : ""}, this is Aria from ${biz}. Just checking in on your property search. Is there anything I can help you with?`;

export interface FollowupDeps {
  repo: WaRepo; ai: AIProvider; send: WaSender; biz: string; tz: string; hours: string; quietAfterMinutes: number;
  now?: () => number; sleep?: (ms: number) => Promise<void>; gapMs?: number; log?: (...a: unknown[]) => void;
}

export class FollowupService {
  private now: () => number; private sleep: (ms: number) => Promise<void>; private gap: number; private log: (...a: unknown[]) => void;
  private running = false; private drafting = 0;
  constructor(private d: FollowupDeps) {
    this.now = d.now ?? Date.now; this.sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))); this.gap = d.gapMs ?? 2500;
    this.log = d.log ?? ((...a) => console.log("[followups]", ...a));
  }

  /** People who could be followed up, most important first. Opted-out people and people at the attempt limit are left out. */
  candidates(now = this.now()): Candidate[] {
    const { repo } = this.d; const order: Reason[] = ["viewing", "callback", "quiet", "recent"]; const out: Candidate[] = [];
    for (const l of repo.leadsSince(now - 14 * 24 * 3600_000)) {
      if (l.opted_out || repo.hasActiveFollowup(l.phone)) continue;
      const attempts = repo.sentSinceLastReply(l.phone); if (attempts >= MAX_ATTEMPTS) continue;
      const { lastIn, lastOut } = repo.lastTimes(l.phone);
      const windowOpen = lastIn !== null && now - lastIn < WINDOW_MS;
      const reason: Reason = l.visit_time ? "viewing" : l.name && l.intent ? "callback" : lastOut !== null && (lastIn === null || lastOut > lastIn) && now - lastOut > this.d.quietAfterMinutes * 60_000 ? "quiet" : "recent";
      out.push({ phone: l.phone, name: l.name ?? l.profile_name, reason, reasonLabel: REASON_LABEL[reason], summary: summaryOf(l), lastInboundAt: lastIn, windowOpen, hoursLeft: windowOpen ? Math.round(((WINDOW_MS - (now - lastIn!)) / 3600_000) * 10) / 10 : 0, attempts, preselect: reason !== "recent" && windowOpen });
    }
    return out.sort((a, b) => order.indexOf(a.reason) - order.indexOf(b.reason));
  }

  /** Writes one personal draft per person, one after another (so the AI limits are respected). Runs in the background. */
  async draftMany(phones: string[]): Promise<void> {
    const wanted = new Set(phones); const cands = this.candidates().filter((c) => wanted.has(c.phone) && c.windowOpen); // closed 24h window: needs a template, so no draft
    this.drafting += cands.length;
    for (const c of cands) {
      try { await this.draftOne(c); } catch (e) { this.log("draft failed for one customer:", (e as Error).message); }
      finally { this.drafting -= 1; }
    }
  }

  async draftOne(c: Candidate): Promise<number> {
    const { repo, ai, biz } = this.d; const lead = repo.getLead(c.phone)!;
    const system = `You are Aria, the AI assistant for ${biz}, a real estate brokerage. Write ONE short WhatsApp follow-up message to a customer, based on the chat below.
Reason for the follow-up: ${REASON_BRIEF[c.reason](lead)}.
Rules: at most 2 sentences and under 280 characters. Use their name if known and mention what they were looking for. Ask one clear next step. Write in the language the customer used. Plain text only: no markdown, no tags, at most one emoji. Never invent properties, prices or availability.`;
    let text = "";
    try { text = parseReply(await ai.reply([{ role: "system", content: system }, ...repo.history(c.phone, 12), { role: "user", content: "[System: write the follow-up message now. Output only the message text.]" }])).text.trim(); }
    catch (e) { this.log("AI draft failed, using a plain template:", (e as Error).message); }
    return repo.addFollowup(c.phone, (text || fallbackText(c.name, biz)).slice(0, 600), c.reason, this.now());
  }

  updateText(id: number, text: string): boolean { const t = text.trim(); return !!t && t.length <= 1000 && this.d.repo.setFollowupText(id, t); }
  discard(id: number): boolean { const f = this.d.repo.getFollowup(id); if (!f || !["draft", "queued"].includes(f.status)) return false; this.d.repo.setFollowupStatus(id, "discarded"); return true; }

  /** Moves drafts to the sending queue. Returns how many were queued. */
  queue(ids: number[]): number {
    let n = 0; for (const id of ids) { const f = this.d.repo.getFollowup(id); if (f?.status === "draft") { this.d.repo.setFollowupStatus(id, "queued"); n++; } } return n;
  }

  /** Sends queued follow-ups one at a time. Safe to call often; only one run at a time. Waits outside sending hours. */
  async run(): Promise<void> {
    if (this.running) return; this.running = true;
    try {
      for (;;) {
        const next = this.d.repo.queuedFollowups()[0]; if (!next) break;
        if (!inSendingHours(this.now(), this.d.tz, this.d.hours)) break; // stays queued until the sending hours begin
        await this.sendOne(next); await this.sleep(this.gap);
      }
    } finally { this.running = false; }
  }

  private async sendOne(f: WaFollowupRow) {
    const { repo, send } = this.d; const now = this.now(); const stop = (status: string, error: string) => repo.setFollowupStatus(f.id, status, { error });
    const lead = repo.getLead(f.phone);
    if (!lead || lead.opted_out) return stop("blocked", "The customer asked not to be contacted.");
    const { lastIn } = repo.lastTimes(f.phone);
    if (lastIn !== null && lastIn > f.created_at) return stop("skipped", "The customer wrote again after this draft was made. Read the chat before following up.");
    if (lastIn === null || now - lastIn >= WINDOW_MS) return stop("blocked", "More than 24 hours since their last message. WhatsApp then requires an approved template message, which is not set up yet.");
    if (repo.sentSinceLastReply(f.phone) >= MAX_ATTEMPTS) return stop("blocked", `Already sent ${MAX_ATTEMPTS} follow-ups with no reply. Over to a human.`);
    try {
      await send.sendText(f.phone, f.text);
      repo.recordMessage({ phone: f.phone, direction: "out", kind: "followup", body: f.text, at: now });
      repo.setFollowupStatus(f.id, "sent", { sentAt: now });
    } catch (e) { repo.setFollowupStatus(f.id, "failed", { error: (e as Error).message.slice(0, 300) }); this.log("send failed:", (e as Error).message); }
  }

  view(now = this.now()) {
    const items: FollowupItem[] = this.d.repo.listFollowups(100).map((f) => {
      const lead = this.d.repo.getLead(f.phone); const { lastIn } = this.d.repo.lastTimes(f.phone);
      return { ...f, name: lead?.name ?? lead?.profile_name ?? null, replied: f.status === "sent" && f.sent_at !== null && lastIn !== null && lastIn > f.sent_at };
    });
    const inHours = inSendingHours(now, this.d.tz, this.d.hours);
    return { candidates: this.candidates(now), items, drafting: this.drafting, running: this.running, waitingForHours: !inHours && items.some((i) => i.status === "queued"), rules: { hours: this.d.hours, tz: this.d.tz, maxAttempts: MAX_ATTEMPTS, windowHours: 24 } };
  }
}
