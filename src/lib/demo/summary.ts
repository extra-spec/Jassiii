import type { CallRecord } from "./store";

export interface DailyStats { conversations: number; chats: number; calls: number; leads: number; visits: number; callbacks: number; voiceNotes: number; hot: CallRecord[] }

/** Builds the end-of-day report the agent would get on WhatsApp. Uses *bold* markers like WhatsApp. */
export function buildDailySummary(all: CallRecord[], biz: string, now = Date.now()): { text: string; stats: DailyStats } {
  const day = all.filter((c) => c.startedAt >= now - 24 * 3600_000);
  const chats = day.filter((c) => c.channel === "chat").length;
  const leads = day.filter((c) => c.analysis && (c.analysis.callerName || c.analysis.intent));
  const hot = day.filter((c) => c.analysis?.outcome === "booking_requested").sort((a, b) => b.startedAt - a.startedAt);
  const callbacks = day.filter((c) => c.analysis?.outcome === "callback_requested").length;
  const voiceNotes = day.reduce((n, c) => n + (c.voiceNotes ?? 0), 0);
  const stats: DailyStats = { conversations: day.length, chats, calls: day.length - chats, leads: leads.length, visits: hot.length, callbacks, voiceNotes, hot };
  const date = new Date(now).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const lines = [`*Daily report · ${biz}*`, date, "", `*${stats.conversations}* conversations (${chats} WhatsApp, ${stats.calls} calls)`, `*${stats.leads}* leads captured`, `*${stats.visits}* viewing requests · *${callbacks}* callbacks`, `*${voiceNotes}* voice notes handled by the AI`];
  if (hot.length) {
    lines.push("", "*Hot leads*");
    hot.slice(0, 4).forEach((c, i) => { const a = c.analysis!; lines.push(`${i + 1}. *${a.callerName ?? "Customer"}* · ${a.intent ?? "Enquiry"}${a.requirement ? ` · ${a.requirement}` : ""}${a.preferredTime ? ` · visit: ${a.preferredTime}` : ""}`); });
  }
  if (callbacks) lines.push("", `*Follow up today:* ${callbacks} callback${callbacks > 1 ? "s" : ""} waiting`);
  lines.push("", "Open your dashboard for full details and transcripts.");
  return { text: lines.join("\n"), stats };
}
