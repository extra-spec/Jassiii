import { analysisFromLead, chatRecord } from "../lib/demo/leads";
import type { CallRecord } from "../lib/demo/store";
import { buildDailySummary } from "../lib/demo/summary";
import { rowToLead, type WaRepo } from "./repo";

/** Turns stored WhatsApp conversations into the same records the dashboard and report already understand. */
export function waRecords(repo: WaRepo, sinceMs: number, biz: string, limit = 60): CallRecord[] {
  return repo.leadsSince(sinceMs).slice(0, limit).map((l) => {
    const transcript = repo.messagesFor(l.phone).filter((m) => m.body).map((m) => ({ role: m.direction === "in" ? "user" as const : "assistant" as const, content: m.kind === "audio" && m.direction === "in" ? `🎤 Voice note: ${m.body}` : m.body! }));
    const rec = chatRecord({ id: `wa_${l.phone}`, startedAt: l.first_seen, durationSecs: Math.max(1, Math.round((l.last_seen - l.first_seen) / 1000)), biz, lang: transcript.some((t) => /[\u0900-\u097F]/.test(t.content)) ? "hi" : "en", transcript, lead: rowToLead(l), voiceNotes: l.voice_notes });
    rec.analysis = analysisFromLead({ ...rowToLead(l), name: l.name ?? l.profile_name ?? undefined }, l.voice_notes);
    return { ...rec, phone: l.phone, live: true };
  });
}

export function buildWaReport(repo: WaRepo, biz: string, now = Date.now()) {
  return buildDailySummary(waRecords(repo, now - 24 * 3600_000, biz), biz, now);
}

/** True once per local day, from the configured time onwards (so a missed minute still sends later that day). */
export function isReportDue(nowMs: number, tz: string, hhmm: string, lastSentDate: string | undefined): { due: boolean; today: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(nowMs));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const today = `${g("year")}-${g("month")}-${g("day")}`;
  return { due: lastSentDate !== today && `${g("hour")}:${g("minute")}` >= hhmm, today };
}
