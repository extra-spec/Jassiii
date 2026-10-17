import type { Db } from "../lib/db";
import type { LeadFields } from "../lib/demo/leads";

export interface WaLeadRow { phone: string; name: string | null; profile_name: string | null; intent: string | null; location: string | null; budget: string | null; bedrooms: string | null; timeline: string | null; visit_time: string | null; voice_notes: number; opted_out: number; alerted: number; first_seen: number; last_seen: number }
export interface WaMsgRow { id: number; phone: string; direction: "in" | "out"; kind: string | null; body: string | null; created_at: number }

export class WaRepo {
  constructor(private db: Db) {}

  /** Returns false when this WhatsApp message id was already stored (a webhook retry). */
  recordMessage(a: { waId?: string; phone: string; direction: "in" | "out"; kind: string; body: string; at?: number }): boolean {
    return this.db.run("INSERT OR IGNORE INTO wa_messages (wa_message_id, phone, direction, kind, body, created_at) VALUES (?,?,?,?,?,?)", a.waId, a.phone, a.direction, a.kind, a.body, a.at ?? Date.now()).changes > 0;
  }
  history(phone: string, n = 16): { role: "user" | "assistant"; content: string }[] {
    const rows = this.db.all<WaMsgRow>("SELECT * FROM wa_messages WHERE phone = ? ORDER BY id DESC LIMIT ?", phone, n).reverse();
    return rows.filter((r) => r.body).map((r) => ({ role: r.direction === "in" ? "user" as const : "assistant" as const, content: r.direction === "in" && r.kind === "audio" ? `[Voice note] ${r.body}` : r.body! }));
  }
  messagesFor(phone: string): WaMsgRow[] { return this.db.all<WaMsgRow>("SELECT * FROM wa_messages WHERE phone = ? ORDER BY id", phone); }

  getLead(phone: string) { return this.db.get<WaLeadRow>("SELECT * FROM wa_leads WHERE phone = ?", phone); }
  touchLead(phone: string, profileName?: string, now = Date.now()) {
    if (!this.getLead(phone)) this.db.run("INSERT INTO wa_leads (phone, profile_name, first_seen, last_seen) VALUES (?,?,?,?)", phone, profileName, now, now);
    else this.db.run("UPDATE wa_leads SET last_seen = ?, profile_name = COALESCE(?, profile_name) WHERE phone = ?", now, profileName, phone);
  }
  mergeLead(phone: string, f: LeadFields, voiceNotesInc = 0) {
    this.db.run("UPDATE wa_leads SET name = COALESCE(?, name), intent = COALESCE(?, intent), location = COALESCE(?, location), budget = COALESCE(?, budget), bedrooms = COALESCE(?, bedrooms), timeline = COALESCE(?, timeline), visit_time = COALESCE(?, visit_time), voice_notes = voice_notes + ? WHERE phone = ?",
      f.name, f.intent, f.location, f.budget, f.bedrooms, f.timeline, f.visitTime, voiceNotesInc, phone);
    return this.getLead(phone)!;
  }
  markAlerted(phone: string) { this.db.run("UPDATE wa_leads SET alerted = 1 WHERE phone = ?", phone); }
  setOptOut(phone: string) { this.db.run("UPDATE wa_leads SET opted_out = 1 WHERE phone = ?", phone); }
  leadsSince(ms: number) { return this.db.all<WaLeadRow>("SELECT * FROM wa_leads WHERE last_seen >= ? ORDER BY last_seen DESC", ms); }

  getSetting(k: string) { return this.db.get<{ value: string }>("SELECT value FROM settings WHERE key = ?", k)?.value; }
  setSetting(k: string, v: string) { this.db.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", k, v); }
}

export const rowToLead = (r: WaLeadRow): LeadFields => Object.fromEntries(Object.entries({ name: r.name ?? undefined, intent: r.intent ?? undefined, location: r.location ?? undefined, budget: r.budget ?? undefined, bedrooms: r.bedrooms ?? undefined, timeline: r.timeline ?? undefined, visitTime: r.visit_time ?? undefined }).filter(([, v]) => v !== undefined)) as LeadFields;
