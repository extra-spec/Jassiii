"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { cleanBiz, PERSONAS, type Vertical } from "@/lib/demo/personas";
import { fmtDuration, leadStatus, loadCalls, seedAll, type CallRecord, type LeadStatus } from "@/lib/demo/store";
import { buildDailySummary } from "@/lib/demo/summary";
import { WaText } from "@/components/wa";

type Tab = "dashboard" | "chats" | "calls" | "leads" | "daily report";
const TABS: Tab[] = ["dashboard", "chats", "calls", "leads", "daily report"];

const STATUS: Record<LeadStatus, { label: string; cls: string }> = {
  NEW: { label: "New", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  CONTACTED: { label: "Contacted", cls: "bg-slate-50 text-slate-600 border-slate-200" },
  FOLLOW_UP: { label: "Callback requested", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  BOOKING_REQUESTED: { label: "Viewing requested", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
};
const Pill = ({ cls, children }: { cls: string; children: React.ReactNode }) => <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
const when = (t: number) => new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const chan = (c: CallRecord) => (c.channel === "chat" ? "WhatsApp" : "Voice call");

export default function DashboardPage() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [real, setReal] = useState<CallRecord[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [vertical, setVertical] = useState<Vertical>("realestate");
  const [biz, setBiz] = useState("");
  const [now] = useState(() => Date.now());
  const [live, setLive] = useState<CallRecord[]>([]);
  const [liveOn, setLiveOn] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const v: Vertical = q.get("v") === "plumbing" ? "plumbing" : "realestate";
    setVertical(v);
    const list = loadCalls(); setReal(list);
    setBiz(cleanBiz(q.get("biz") ?? list[0]?.biz, PERSONAS[v].defaultBiz));
    const c = q.get("call"); if (c && list.some((x) => x.id === c)) setOpen(c);
    let token = q.get("token");
    try { if (token) localStorage.setItem("strike_dash_token", token); else token = localStorage.getItem("strike_dash_token"); } catch { /* storage blocked */ }
    if (!token) return;
    const pull = async () => {
      try {
        const r = await fetch(`/api/whatsapp/overview?token=${encodeURIComponent(token!)}`, { cache: "no-store" });
        if (!r.ok) { setLiveOn(false); return; }
        const d = await r.json(); setLive(d.records ?? []); setLiveOn(true);
        if (d.biz && !q.get("biz")) setBiz(d.biz);
      } catch { setLiveOn(false); }
    };
    void pull(); const t = setInterval(pull, 10_000); return () => clearInterval(t);
  }, []);

  const pending = real.some((c) => c.analysis === undefined);
  useEffect(() => { if (!pending) return; const t = setInterval(() => setReal(loadCalls()), 1500); return () => clearInterval(t); }, [pending]);

  const name = biz || PERSONAS[vertical].defaultBiz;
  const all = useMemo(() => [...live, ...real, ...seedAll(vertical, name, now)].sort((a, b) => b.startedAt - a.startedAt), [live, real, vertical, name, now]);
  const selected = all.find((c) => c.id === open) ?? null;
  const leads = all.filter((c) => c.analysis && (c.analysis.callerName || c.analysis.intent));
  const actions = all.filter((c) => c.analysis?.outcome === "booking_requested" || c.analysis?.outcome === "callback_requested").length;
  const vnTotal = all.reduce((n, c) => n + (c.voiceNotes ?? 0), 0);
  const summary = useMemo(() => buildDailySummary(all, name, now), [all, name, now]);
  const q = `?biz=${encodeURIComponent(name)}&v=${vertical}`;

  const stat = (label: string, value: string, hint: string) => (
    <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm"><p className="text-xs text-black/50">{label}</p><p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p><p className="mt-0.5 text-xs text-black/40">{hint}</p></div>
  );
  const mine = (c: CallRecord) => c.live ? <span className="ml-2 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-medium text-white">Live</span> : !c.sample && <span className="ml-2 rounded-full bg-[#1F5B4C] px-2 py-0.5 text-[10px] font-medium text-white">Your test</span>;

  const row = (c: CallRecord) => {
    const st = c.analysis === undefined ? null : leadStatus(c.analysis);
    return (
      <tr key={c.id} onClick={() => setOpen(c.id)} className={`cursor-pointer border-t border-black/5 text-sm transition hover:bg-black/[.02] ${!c.sample ? "bg-emerald-50/40" : ""}`}>
        <td className="px-4 py-3"><span className="font-medium">{c.analysis?.callerName ?? (c.sample ? "Customer" : "You")}</span>{mine(c)}<span className="block text-xs text-black/40">{chan(c)} · {c.lang === "hi" ? "Hindi" : "English"}{c.voiceNotes ? ` · ${c.voiceNotes} voice note${c.voiceNotes > 1 ? "s" : ""}` : ""}</span></td>
        <td className="hidden px-4 py-3 text-black/60 sm:table-cell">{when(c.startedAt)}</td>
        <td className="px-4 py-3 tabular-nums text-black/60">{fmtDuration(c.durationSecs)}</td>
        <td className="hidden max-w-[260px] truncate px-4 py-3 text-black/60 md:table-cell">{c.analysis === undefined ? "Writing summary…" : c.analysis?.summary ?? "Summary unavailable"}</td>
        <td className="px-4 py-3">{st ? <Pill cls={STATUS[st].cls}>{STATUS[st].label}</Pill> : <Pill cls="bg-amber-50 text-amber-700 border-amber-200">Summarising</Pill>}</td>
      </tr>
    );
  };
  const head = (cols: string[]) => <thead><tr className="text-left text-xs text-black/45">{cols.map((c, i) => <th key={c} className={`px-4 py-2.5 font-medium ${i === 1 ? "hidden sm:table-cell" : ""} ${i === 3 ? "hidden md:table-cell" : ""}`}>{c}</th>)}</tr></thead>;
  const card = "overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm";
  const table = (list: CallRecord[]) => <div className={card}><table className="w-full">{head(["Customer", "Time", "Duration", "AI summary", "Status"])}<tbody>{list.map(row)}</tbody></table></div>;

  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-black/10 bg-white md:min-h-screen md:w-56 md:border-b-0 md:border-r">
        <Link href="/" className="flex items-center gap-2 px-5 py-4"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#1F5B4C] text-xs font-bold text-white">S</span><span className="text-sm font-semibold tracking-tight">STRIKE.AI</span></Link>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col">
          {TABS.map((t) => <button key={t} onClick={() => setTab(t)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm capitalize transition ${tab === t ? "bg-[#1F5B4C]/10 font-medium text-[#1F5B4C]" : "text-black/60 hover:bg-black/[.04]"}`}>{t}</button>)}
        </nav>
      </aside>

      <main className="flex-1 px-4 py-6 md:px-8">
        <div className="mx-auto max-w-4xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h1 className="text-xl font-semibold capitalize tracking-tight">{tab}</h1><p className="text-sm text-black/50">{name}</p></div>
            <div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-black/50">{liveOn ? "Live WhatsApp connected · plus sample data" : "Demo · sample data + your tests"}</span>
              {vertical === "realestate" && <Link href={`/demo/chat?biz=${encodeURIComponent(name)}`} className="rounded-xl border border-black/10 bg-white px-4 py-2 text-sm font-medium transition hover:bg-black/[.03]">Try chat</Link>}
              <Link href={`/demo?v=${vertical}&biz=${encodeURIComponent(name)}`} className="rounded-xl bg-[#1F5B4C] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#184a3e]">Try call</Link></div>
          </div>

          {tab === "dashboard" && <>
            <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
              {stat("Conversations", String(all.length), "WhatsApp + calls, answered by AI")}
              {stat("Leads captured", String(leads.length), "saved automatically")}
              {stat("Viewings / callbacks", String(actions), "ready for your agent")}
              {stat("Voice notes handled", String(vnTotal), "heard and answered by AI")}
            </div>
            <h2 className="mb-2 mt-7 text-sm font-medium">Recent conversations</h2>{table(all.slice(0, 6))}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/10 bg-white p-4 shadow-sm"><div><p className="text-sm font-medium">Daily report to your agent&apos;s WhatsApp</p><p className="text-xs text-black/50">Every evening, a summary of the day. Preview it now.</p></div>
              <button onClick={() => setTab("daily report")} className="rounded-xl border border-black/10 px-4 py-2 text-sm font-medium hover:bg-black/[.03]">View report</button></div>
          </>}
          {tab === "chats" && <div className="mt-5">{table(all.filter((c) => c.channel === "chat"))}</div>}
          {tab === "calls" && <div className="mt-5">{table(all.filter((c) => c.channel !== "chat"))}</div>}

          {tab === "leads" && <div className={`mt-5 ${card}`}><div className="overflow-x-auto"><table className="w-full min-w-[640px]">
            <thead><tr className="text-left text-xs text-black/45">{["Name", "Channel", "Interested in", "Details", "Viewing", "Status"].map((c) => <th key={c} className="px-4 py-2.5 font-medium">{c}</th>)}</tr></thead>
            <tbody>{leads.map((c) => { const a = c.analysis!; return (
              <tr key={c.id} onClick={() => setOpen(c.id)} className="cursor-pointer border-t border-black/5 text-sm hover:bg-black/[.02]">
                <td className="px-4 py-3 font-medium">{a.callerName ?? "Not given"}{mine(c)}</td><td className="px-4 py-3 text-black/60">{chan(c)}</td>
                <td className="px-4 py-3 text-black/70">{a.intent ?? "-"}</td><td className="px-4 py-3 text-black/60">{a.requirement ?? "-"}</td><td className="px-4 py-3 text-black/60">{a.preferredTime ?? "-"}</td>
                <td className="px-4 py-3"><Pill cls={STATUS[leadStatus(a)].cls}>{STATUS[leadStatus(a)].label}</Pill></td></tr>); })}</tbody></table></div></div>}

          {tab === "daily report" && <div className="mt-5 grid gap-5 md:grid-cols-[1fr_280px]">
            <div className="rounded-xl border border-black/10 bg-[#EFEAE2] p-5 shadow-sm"><p className="mb-3 text-xs text-black/50">Today at 8:00 PM, on the agent&apos;s WhatsApp</p>
              <div className="max-w-[360px] rounded-lg rounded-tl-none bg-white p-3 text-[14.2px] leading-[19px] shadow-sm"><WaText text={summary.text} /></div></div>
            <div className="space-y-3">
              <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm"><p className="text-sm font-medium">How it works</p><ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-black/60"><li>Built from every chat and call of the last 24 hours.</li><li>Hot leads also reach the agent instantly.</li><li>Sent at a time you choose.</li></ul></div>
              <Link href={`/demo/agent${q}`} className="block rounded-xl bg-[#1F5B4C] px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-[#184a3e]">See it on the agent&apos;s phone</Link>
              <p className="text-xs text-black/40">In this demo the report is shown here. Sending it to a real WhatsApp number needs the WhatsApp Business API, set up per client.</p>
            </div></div>}

          <p className="mt-6 text-xs text-black/40">Sample rows are examples. Your own tests are saved in this browser only. With the real setup, phone numbers, recordings and calendar bookings appear here automatically.</p>
        </div>
      </main>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4" onClick={() => setOpen(null)}>
          <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div><h3 className="text-lg font-semibold tracking-tight">{selected.analysis?.callerName ?? (selected.sample ? "Customer" : "You")}</h3><p className="text-sm text-black/50">{chan(selected)} · {when(selected.startedAt)} · {fmtDuration(selected.durationSecs)}</p></div>
              <button onClick={() => setOpen(null)} className="rounded-lg px-2 py-1 text-black/40 hover:bg-black/[.05]" aria-label="Close">✕</button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {selected.analysis ? <Pill cls={STATUS[leadStatus(selected.analysis)].cls}>{STATUS[leadStatus(selected.analysis)].label}</Pill> : <Pill cls="bg-amber-50 text-amber-700 border-amber-200">{selected.analysis === undefined ? "Summarising…" : "Summary unavailable"}</Pill>}
              {selected.analysis?.urgency === "high" && <Pill cls="bg-red-50 text-red-700 border-red-200">Needs attention</Pill>}
              {selected.voiceNotes ? <Pill cls="bg-slate-50 text-slate-600 border-slate-200">{selected.voiceNotes} voice note{selected.voiceNotes > 1 ? "s" : ""}</Pill> : null}
              {selected.sample && <Pill cls="bg-slate-50 text-slate-500 border-slate-200">Sample</Pill>}
            </div>
            <div className="mt-4 rounded-xl bg-[#F7F6F3] p-4"><p className="text-[11px] font-medium uppercase tracking-wide text-[#1F5B4C]">AI summary</p>
              <p className="mt-1 text-sm leading-relaxed">{selected.analysis === undefined ? "Writing the summary, this takes a few seconds…" : selected.analysis?.summary ?? "The summary couldn't be generated for this call. The transcript below is complete."}</p></div>
            {selected.analysis && <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {[["Interested in", selected.analysis.intent], ["Details", selected.analysis.requirement], ["Preferred time", selected.analysis.preferredTime], ["Next step", selected.analysis.nextStep], ["Phone number", selected.phone ? `+${selected.phone}` : selected.channel === "chat" ? "Taken from WhatsApp automatically on real chats" : selected.sample ? "Shown here on real calls" : "Captured automatically on real phone calls"], [selected.channel === "chat" ? "Voice notes" : "Recording", selected.channel === "chat" ? "Heard and transcribed by the AI" : "Available on real phone calls"]].map(([k, v]) => <div key={k as string}><dt className="text-xs text-black/45">{k}</dt><dd className="mt-0.5">{v ?? "-"}</dd></div>)}
            </dl>}
            <h4 className="mb-2 mt-5 text-sm font-medium">Transcript</h4>
            <div className="space-y-2">{selected.transcript.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : ""}`}><p className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${m.role === "user" ? "bg-[#1F5B4C] text-white" : "bg-[#F7F6F3]"}`}>{m.content}</p></div>))}</div>
          </div>
        </div>
      )}
    </div>
  );
}
