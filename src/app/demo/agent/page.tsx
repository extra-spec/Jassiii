"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { cleanBiz, PERSONAS } from "@/lib/demo/personas";
import { loadCalls, seedAll, type CallRecord } from "@/lib/demo/store";
import { buildDailySummary } from "@/lib/demo/summary";
import { DayChip, NoticeChip, WaBubble, WaHeader, WaText, WaWallpaper } from "@/components/wa";

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export default function AgentPhone() {
  const [real, setReal] = useState<CallRecord[]>([]);
  const [biz, setBiz] = useState("");
  const [now] = useState(() => Date.now());
  useEffect(() => { const q = new URLSearchParams(window.location.search); const l = loadCalls(); setReal(l); setBiz(cleanBiz(q.get("biz") ?? l[0]?.biz, PERSONAS.realestate.defaultBiz)); }, []);

  const name = biz || PERSONAS.realestate.defaultBiz;
  const all = useMemo(() => [...real, ...seedAll("realestate", name, now)].sort((a, b) => b.startedAt - a.startedAt), [real, name, now]);
  const { text, stats } = useMemo(() => buildDailySummary(all, name, now), [all, name, now]);
  const alerts = stats.hot.slice(0, 3);
  const q = `?biz=${encodeURIComponent(name)}&v=realestate`;

  return (
    <main className="flex min-h-[100dvh] items-center justify-center gap-8 bg-[#D1D7DB] sm:p-4">
      <div className="flex h-[100dvh] w-full max-w-[430px] flex-col overflow-hidden bg-[#EFEAE2] sm:h-[min(100dvh-2rem,860px)] sm:rounded-[28px] sm:border-[6px] sm:border-[#111B21] sm:shadow-[0_20px_60px_rgba(17,19,24,0.35)]">
        <WaHeader title="STRIKE.AI Reports" subtitle={`for ${name}'s agent`} initials="S" verified />
        <WaWallpaper>
          <DayChip>Today</DayChip>
          <NoticeChip>This is what the real estate agent receives on their own WhatsApp. Demo data.</NoticeChip>
          {alerts.map((c, i) => { const a = c.analysis!; return (
            <WaBubble key={c.id} first={i === 0} time={clock(c.startedAt + c.durationSecs * 1000)}>
              <WaText text={`🔥 *New hot lead* via ${c.channel === "chat" ? "WhatsApp" : "phone call"}\n*${a.callerName ?? "Customer"}* · ${a.intent ?? "Enquiry"}${a.requirement ? `\n${a.requirement}` : ""}${a.preferredTime ? `\nViewing: ${a.preferredTime}` : ""}\n\n${a.nextStep ?? ""}`} />
            </WaBubble>); })}
          <DayChip>8:00 PM · Daily report</DayChip>
          <WaBubble first time="8:00 PM"><WaText text={text} /></WaBubble>
        </WaWallpaper>
        <div className="flex items-center gap-2 bg-[#EFEAE2] px-2 pb-3 pt-1"><p className="flex-1 rounded-full bg-white px-4 py-3 text-[14px] text-[#8696A0] shadow-sm">Reports are sent automatically every day</p></div>
      </div>
      <aside className="hidden w-[300px] shrink-0 lg:block">
        <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wide text-[#1F5B4C]">Agent&apos;s phone</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">Instant alerts and a daily report</h2>
          <p className="mt-2 text-sm leading-relaxed text-black/60">Hot leads reach the agent the moment they happen. Every evening a summary lands in their WhatsApp, built from the day&apos;s chats and calls.</p>
          <div className="mt-4 grid gap-2"><Link href={`/demo/dashboard${q}`} className="rounded-xl bg-[#1F5B4C] px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-[#184a3e]">Open dashboard</Link>
            <Link href={`/demo/chat?biz=${encodeURIComponent(name)}`} className="rounded-xl border border-black/10 px-4 py-2.5 text-center text-sm font-medium hover:bg-black/[.03]">Try the customer chat</Link></div>
        </div>
      </aside>
    </main>
  );
}
