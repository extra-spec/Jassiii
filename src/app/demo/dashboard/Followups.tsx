"use client";
import { useCallback, useEffect, useRef, useState } from "react";

interface Candidate { phone: string; name: string | null; reason: string; reasonLabel: string; summary: string; lastInboundAt: number | null; windowOpen: boolean; hoursLeft: number; attempts: number; preselect: boolean }
interface Item { id: number; phone: string; name: string | null; text: string; reason: string | null; status: string; error: string | null; created_at: number; sent_at: number | null; replied: boolean }
interface View { candidates: Candidate[]; items: Item[]; drafting: number; running: boolean; waitingForHours: boolean; rules: { hours: string; tz: string; maxAttempts: number; windowHours: number } }

const card = "rounded-xl border border-black/10 bg-white shadow-sm";
const pill = (cls: string, t: string) => <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>{t}</span>;
const STATUS: Record<string, [string, string]> = {
  queued: ["Waiting to send", "bg-amber-50 text-amber-700 border-amber-200"], sent: ["Sent", "bg-emerald-50 text-emerald-700 border-emerald-200"], replied: ["Customer replied", "bg-emerald-100 text-emerald-800 border-emerald-300"],
  failed: ["Failed", "bg-red-50 text-red-700 border-red-200"], blocked: ["Not sent", "bg-red-50 text-red-700 border-red-200"], skipped: ["Skipped", "bg-slate-50 text-slate-600 border-slate-200"], discarded: ["Discarded", "bg-slate-50 text-slate-500 border-slate-200"],
};
const ago = (t: number) => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

export default function Followups({ token }: { token: string | null }) {
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const seen = useRef<Set<string>>(new Set());

  const call = useCallback(async (action: string, body?: unknown) => {
    const r = await fetch(`/api/whatsapp/followups${action === "list" ? "" : "/" + action}?token=${encodeURIComponent(token ?? "")}`, action === "list" ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
    if (r.status === 401) throw new Error("That dashboard token was not accepted.");
    if (!r.ok) throw new Error(`Something went wrong (${r.status}).`);
    return r.json();
  }, [token]);

  const load = useCallback(async () => {
    try {
      const d: View = await call("list"); setV(d); setErr("");
      setPicked((prev) => { const next = new Set(prev); for (const c of d.candidates) if (!seen.current.has(c.phone)) { seen.current.add(c.phone); if (c.preselect) next.add(c.phone); } return next; });
    } catch (e) { setErr((e as Error).message); }
  }, [call]);

  useEffect(() => { if (!token) return; void load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, [token, load]);

  if (!token) return <div className={`${card} p-5 text-sm text-black/60`}>Open the dashboard with your token in the address (<code>?token=…</code>) to use follow-ups. They send real WhatsApp messages, so they are locked.</div>;
  if (err && !v) return <div className={`${card} p-5 text-sm text-red-700`}>{err}</div>;
  if (!v) return <div className={`${card} p-5 text-sm text-black/50`}>Loading…</div>;

  const drafts = v.items.filter((i) => i.status === "draft");
  const activity = v.items.filter((i) => i.status !== "draft");
  const selectable = v.candidates.filter((c) => c.windowOpen);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); await load(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const writeDrafts = () => run(async () => { await call("draft", { phones: [...picked] }); setPicked(new Set()); });
  const sendAll = () => run(async () => {
    for (const d of drafts) { const t = edits[d.id]; if (t !== undefined && t.trim() && t !== d.text) await call("update", { id: d.id, text: t }); }
    await call("send", { ids: drafts.map((d) => d.id) }); setEdits({});
  });

  return (
    <div className="space-y-6">
      <div className={`${card} p-4`}>
        <p className="text-sm font-medium">How follow-ups work</p>
        <p className="mt-1 text-xs leading-relaxed text-black/55">Pick the people, let the AI write a personal message for each, check them, then send. Safety rules are built in:</p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {[`Only within ${v.rules.windowHours} h of their last message`, `Sent between ${v.rules.hours} (${v.rules.tz})`, `Stops after ${v.rules.maxAttempts} unanswered`, "Skips anyone who replied or said STOP"].map((t) => <span key={t} className="rounded-full bg-[#F7F6F3] px-3 py-1 text-black/60">{t}</span>)}
        </div>
      </div>
      {err && <p className="text-sm text-red-700">{err}</p>}
      {(v.drafting > 0 || v.running || v.waitingForHours) && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">{v.drafting > 0 ? `Writing ${v.drafting} message${v.drafting > 1 ? "s" : ""}…` : v.running ? "Sending, one message every few seconds…" : `Waiting for the sending hours (${v.rules.hours}). Queued messages go out automatically.`}</p>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium">1. Who to follow up</h2>
        <div className={card}>
          {v.candidates.length === 0 ? <p className="p-4 text-sm text-black/50">No one needs a follow-up right now. Customers appear here after they chat with the assistant.</p> : (
            <ul className="divide-y divide-black/5">{v.candidates.map((c) => (
              <li key={c.phone} className={`flex items-start gap-3 px-4 py-3 ${c.windowOpen ? "" : "opacity-60"}`}>
                <input type="checkbox" disabled={!c.windowOpen} checked={picked.has(c.phone)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(c.phone); else n.delete(c.phone); return n; })} className="mt-1 h-4 w-4 accent-[#1F5B4C]" aria-label={`Select ${c.name ?? c.phone}`} />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium">{c.name ?? "Customer"} <span className="font-normal text-black/40">+{c.phone}</span></p>
                  <p className="text-xs text-black/50">{c.summary}{c.lastInboundAt ? ` · wrote ${ago(c.lastInboundAt)}` : ""}{c.attempts ? ` · ${c.attempts} follow-up${c.attempts > 1 ? "s" : ""} sent` : ""}</p>
                  {!c.windowOpen && <p className="mt-0.5 text-xs text-red-700">Last message was over 24 hours ago. WhatsApp needs an approved template for this, which isn&apos;t set up yet.</p>}
                </div>
                <div className="flex flex-col items-end gap-1">{pill(c.reason === "viewing" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : c.reason === "recent" ? "bg-slate-50 text-slate-600 border-slate-200" : "bg-amber-50 text-amber-700 border-amber-200", c.reasonLabel)}{c.windowOpen && <span className="text-[11px] text-black/40">{c.hoursLeft} h left</span>}</div>
              </li>))}</ul>)}
        </div>
        <button onClick={writeDrafts} disabled={busy || picked.size === 0} className="mt-3 rounded-xl bg-[#1F5B4C] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#184a3e] disabled:opacity-40">Write follow-ups for {picked.size} selected</button>
        {selectable.length > 0 && <button onClick={() => setPicked(new Set(selectable.map((c) => c.phone)))} className="ml-3 text-sm text-[#1F5B4C] underline underline-offset-2">Select everyone</button>}
      </section>

      {drafts.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium">2. Check the messages, then send</h2>
          <div className="space-y-3">{drafts.map((d) => (
            <div key={d.id} className={`${card} p-4`}>
              <div className="flex items-center justify-between gap-2 text-sm"><p className="font-medium">{d.name ?? "Customer"} <span className="font-normal text-black/40">+{d.phone}</span></p><button onClick={() => run(() => call("discard", { id: d.id }))} className="text-xs text-black/40 hover:text-red-700">Discard</button></div>
              <textarea value={edits[d.id] ?? d.text} onChange={(e) => setEdits((x) => ({ ...x, [d.id]: e.target.value }))} rows={3} maxLength={1000} className="mt-2 w-full resize-y rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-[#1F5B4C]" />
            </div>))}</div>
          <button onClick={sendAll} disabled={busy} className="mt-3 rounded-xl bg-[#1F5B4C] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#184a3e] disabled:opacity-40">Send {drafts.length} follow-up{drafts.length > 1 ? "s" : ""} now</button>
          <p className="mt-1 text-xs text-black/40">Messages go out one at a time through WhatsApp.</p>
        </section>)}

      {activity.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium">Activity</h2>
          <div className={card}><ul className="divide-y divide-black/5">{activity.map((a) => { const [label, cls] = STATUS[a.replied ? "replied" : a.status] ?? [a.status, "bg-slate-50 text-slate-600 border-slate-200"]; return (
            <li key={a.id} className="px-4 py-3 text-sm"><div className="flex items-center justify-between gap-2"><p className="font-medium">{a.name ?? "Customer"} <span className="font-normal text-black/40">+{a.phone}</span></p>{pill(cls, label)}</div>
              <p className="mt-1 text-black/60">{a.text}</p>{a.error && <p className="mt-1 text-xs text-red-700">{a.error}</p>}<p className="mt-1 text-[11px] text-black/35">{ago(a.sent_at ?? a.created_at)}</p></li>); })}</ul></div>
        </section>)}
    </div>
  );
}
