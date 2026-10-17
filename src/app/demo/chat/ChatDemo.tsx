"use client";
import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import Link from "next/link";
import { chatInstructions, parseReply, propertyById, type Property } from "@/lib/demo/chatbot";
import { chatRecord, mergeLead, type LeadFields } from "@/lib/demo/leads";
import { puterText } from "@/lib/demo/puter";
import { addCall } from "@/lib/demo/store";
import { ttsOptionChain, type VoicePreset } from "@/lib/demo/voices";
import { DayChip, NoticeChip, WaBubble, WaHeader, WaText, WaVoice, WaWallpaper } from "@/components/wa";

type Status = "sent" | "delivered" | "read";
type Msg = { id: number; from: "bot" | "me"; text?: string; prop?: Property; voice?: { url?: string; secs: number; speak?: string; transcript?: string; auto?: boolean }; time: string; status?: Status };
type Props = { biz: string; engine: "puter" | "server"; model: string; voice: VoicePreset; vid?: string };

const nowT = () => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CHIPS = ["I want to buy a home", "Looking for a rental", "I want to sell my property"];
const isHindi = (t: string) => /[\u0900-\u097F]/.test(t);
const estSecs = (t: string) => Math.max(2, Math.round(t.trim().split(/\s+/).length / 2.5));
const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export default function ChatDemo({ biz, engine, model, voice, vid }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<"idle" | "typing" | "recording">("idle");
  const [chips, setChips] = useState(true);
  const [lead, setLead] = useState<LeadFields>({});
  const [vnCount, setVnCount] = useState(0);
  const [rec, setRec] = useState<{ secs: number } | null>(null);
  const [menu, setMenu] = useState(false);
  const [vlang, setVlang] = useState<"en-IN" | "hi-IN">("en-IN");

  const history = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const log = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const leadRef = useRef<LeadFields>({});
  const vnRef = useRef(0);
  const idc = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const startTs = useRef(Date.now());
  const sessionId = useRef(`w${Date.now()}`);
  const mr = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recog = useRef<any>(null);
  const recActive = useRef(false);
  const acc = useRef(""); const cur = useRef("");
  const recStart = useRef(0); const recTimer = useRef<number | null>(null);

  const push = (m: Omit<Msg, "id" | "time">) => { const id = ++idc.current; setMsgs((x) => [...x, { ...m, id, time: nowT() }]); return id; };
  const setStatus = (id: number, status: Status) => setMsgs((x) => x.map((m) => (m.id === id ? { ...m, status } : m)));
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, phase]);

  useEffect(() => {
    const greet = `Hi! Welcome to ${biz} 👋 I'm Aria, an AI assistant. Are you looking to buy, rent or sell a property?`;
    setPhase("typing");
    const t = setTimeout(() => { setPhase("idle"); push({ from: "bot", text: greet }); history.current.push({ role: "assistant", content: greet }); log.current.push({ role: "assistant", content: greet }); }, 1100);
    return () => { clearTimeout(t); cleanupRec(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function persist() {
    if (!log.current.some((l) => l.role === "user")) return;
    addCall(chatRecord({ id: sessionId.current, startedAt: startTs.current, durationSecs: Math.max(1, Math.round((Date.now() - startTs.current) / 1000)), biz, lang: log.current.some((l) => isHindi(l.content)) ? "hi" : "en", transcript: log.current, lead: leadRef.current, voiceNotes: vnRef.current }));
  }

  async function getReply(): Promise<string> {
    const messages = history.current.slice(-16);
    if (engine === "puter") {
      const pu = (window as any).puter; if (!pu) throw new Error("puter.js not loaded");
      const full = [{ role: "system", content: chatInstructions(biz) }, ...messages];
      let r: unknown;
      try { r = await pu.ai.chat(full, { model }); } catch (e) { console.warn("[puter chat] model failed, retrying default:", e); r = await pu.ai.chat(full); }
      const t = puterText(r); if (!t) throw new Error("empty reply"); return t;
    }
    const res = await fetch("/api/demo/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: "chat", biz, messages }) });
    const d = await res.json(); if (!res.ok || !d.reply) throw new Error(d.error ?? "failed"); return d.reply as string;
  }

  /** Turn the AI's text into a playable voice note. Returns null when no natural voice is available. */
  async function makeVoice(text: string): Promise<{ url: string; secs: number } | null> {
    const lang = isHindi(text) ? "hi" : "en";
    let url: string | null = null;
    try {
      if (engine === "puter") {
        const pu = (window as any).puter;
        if (pu) for (const opts of ttsOptionChain(voice, { vertical: "realestate", lang, speechLang: lang === "hi" ? "hi-IN" : "en-IN", vid })) {
          try { const el = await pu.ai.txt2speech(text, opts); if (el?.src) { url = el.src as string; break; } } catch (e) { console.warn(`[puter tts] ${String(opts.provider)} failed, trying next:`, e); }
        }
      } else {
        const res = await fetch("/api/demo/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, lang }) });
        if (res.ok) url = URL.createObjectURL(await res.blob());
      }
    } catch (e) { console.warn("[chat] voice failed:", e); }
    if (!url) return null;
    const secs = await new Promise<number>((resolve) => { const a = new Audio(url!); const t = setTimeout(() => resolve(estSecs(text)), 1500); a.onloadedmetadata = () => { clearTimeout(t); resolve(isFinite(a.duration) && a.duration > 0 ? Math.max(1, Math.round(a.duration)) : estSecs(text)); }; a.onerror = () => { clearTimeout(t); resolve(estSecs(text)); }; });
    return { url, secs };
  }

  /** One full turn: send to the AI, then show text or a voice note plus any property cards. */
  async function converse(userText: string, meId: number, viaVoice: boolean) {
    busy.current = true; setChips(false);
    history.current.push({ role: "user", content: userText });
    setTimeout(() => setStatus(meId, "delivered"), 350);
    try {
      await sleep(700); setStatus(meId, "read"); setPhase(viaVoice ? "recording" : "typing");
      const raw = await getReply();
      history.current.push({ role: "assistant", content: raw });
      const { text: body, ids, lead: got } = parseReply(raw);
      if (Object.keys(got).length) { leadRef.current = mergeLead(leadRef.current, got); setLead(leadRef.current); }
      if (body) {
        log.current.push({ role: "assistant", content: body });
        if (viaVoice) {
          const v = await makeVoice(body);
          setPhase("idle"); vnRef.current += 1; setVnCount(vnRef.current);
          push({ from: "bot", voice: v ? { url: v.url, secs: v.secs, transcript: body, auto: true } : { speak: body, secs: estSecs(body), transcript: body, auto: true } });
        } else { await sleep(500); setPhase("idle"); push({ from: "bot", text: body }); }
      } else setPhase("idle");
      for (const pid of ids) { const prop = propertyById(pid); if (prop) { await sleep(450); push({ from: "bot", prop }); log.current.push({ role: "assistant", content: `[Sent property card: ${prop.title}, ${prop.locality}]` }); } }
    } catch (e) {
      console.warn("[chat] reply failed:", e); setPhase("idle");
      push({ from: "bot", text: "Sorry, I'm having trouble replying right now. Please try again in a moment." });
    } finally { busy.current = false; persist(); }
  }

  function sendText(text: string) {
    const t = text.trim(); if (!t || busy.current) return;
    setDraft(""); const id = push({ from: "me", text: t, status: "sent" });
    log.current.push({ role: "user", content: t }); void converse(t, id, false);
  }

  // ---- voice notes (record + live speech-to-text in the browser) ----
  function cleanupRec() {
    recActive.current = false; if (recTimer.current) clearInterval(recTimer.current);
    try { recog.current?.abort(); } catch {} recog.current = null;
    try { if (mr.current && mr.current.state !== "inactive") mr.current.stop(); } catch {}
    stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null;
  }
  async function startRec() {
    if (busy.current || rec) return;
    const w = window as any; const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR || typeof MediaRecorder === "undefined") { push({ from: "bot", text: "Voice notes need Chrome or Edge on a laptop or Android phone. You can type your message instead." }); return; }
    try { stream.current = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { push({ from: "bot", text: "To send voice notes, please allow microphone access in your browser." }); return; }
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported?.(m));
    const r = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
    chunks.current = []; r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
    mr.current = r; r.start();
    acc.current = ""; cur.current = ""; recActive.current = true;
    const sr = new SR(); sr.lang = vlang; sr.interimResults = true; sr.continuous = true;
    sr.onresult = (e: any) => { let t = ""; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; cur.current = t; };
    sr.onend = () => { acc.current += (acc.current && cur.current ? " " : "") + cur.current; cur.current = ""; if (recActive.current) { try { sr.start(); } catch {} } };
    recog.current = sr; try { sr.start(); } catch {}
    recStart.current = Date.now(); setRec({ secs: 0 });
    recTimer.current = window.setInterval(() => { const s = Math.round((Date.now() - recStart.current) / 1000); setRec({ secs: s }); if (s >= 60) void finishRec(true); }, 250);
  }
  async function finishRec(send: boolean) {
    if (!recActive.current || !mr.current) return;
    const r = mr.current; const secs = Math.max(1, Math.round((Date.now() - recStart.current) / 1000));
    recActive.current = false; if (recTimer.current) clearInterval(recTimer.current);
    const stopped = new Promise<void>((res) => { r.onstop = () => res(); });
    try { recog.current?.stop(); } catch {}
    try { r.stop(); } catch {}
    stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; setRec(null);
    if (!send) { recog.current = null; return; }
    await stopped; await sleep(600);
    const transcript = `${acc.current} ${cur.current}`.trim(); recog.current = null;
    const url = URL.createObjectURL(new Blob(chunks.current, { type: r.mimeType || "audio/webm" }));
    const id = push({ from: "me", voice: { url, secs, transcript: transcript || undefined }, status: "sent" });
    if (!transcript) { setTimeout(() => setStatus(id, "read"), 600); await sleep(900); push({ from: "bot", text: "Sorry, I couldn't catch that voice note. Could you try again, or type your message?" }); return; }
    log.current.push({ role: "user", content: `🎤 Voice note: ${transcript}` });
    void converse(`[Voice note] ${transcript}`, id, true);
  }

  function newChat() { cleanupRec(); setMenu(false); history.current = []; log.current = []; leadRef.current = {}; vnRef.current = 0; setLead({}); setVnCount(0); setMsgs([]); setChips(true); setPhase("idle"); busy.current = false; startTs.current = Date.now(); sessionId.current = `w${Date.now()}`;
    const greet = `Hi! Welcome to ${biz} 👋 I'm Aria, an AI assistant. Are you looking to buy, rent or sell a property?`; push({ from: "bot", text: greet }); history.current.push({ role: "assistant", content: greet }); log.current.push({ role: "assistant", content: greet }); }

  const initials = biz.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const sub = phase === "typing" ? "typing…" : phase === "recording" ? "recording audio…" : "AI assistant · online";
  const qs = `?biz=${encodeURIComponent(biz)}`;
  const fields: [string, string | undefined][] = [["Name", lead.name], ["Looking to", lead.intent && lead.intent[0].toUpperCase() + lead.intent.slice(1)], ["Area", lead.location], ["Budget", lead.budget], ["Size", lead.bedrooms], ["Timeline", lead.timeline], ["Viewing", lead.visitTime]];
  const filled = fields.filter(([, v]) => v).length;

  return (
    <main className="flex min-h-[100dvh] items-center justify-center gap-8 bg-[#D1D7DB] sm:p-4">
      {engine === "puter" && <Script src="https://js.puter.com/v2/" strategy="afterInteractive" />}
      <div className="relative flex h-[100dvh] w-full max-w-[430px] flex-col overflow-hidden bg-[#EFEAE2] sm:h-[min(100dvh-2rem,860px)] sm:rounded-[28px] sm:border-[6px] sm:border-[#111B21] sm:shadow-[0_20px_60px_rgba(17,19,24,0.35)]">
        <WaHeader title={biz} subtitle={sub} initials={initials} verified right={
          <button onClick={() => setMenu((m) => !m)} aria-label="Menu" className="px-1"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></svg></button>} />
        {menu && (
          <div className="absolute right-2 top-12 z-30 w-60 overflow-hidden rounded-lg bg-white py-1 text-[15px] text-[#111B21] shadow-xl" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setVlang(vlang === "en-IN" ? "hi-IN" : "en-IN")} className="flex w-full justify-between px-4 py-2.5 text-left hover:bg-black/[.04]"><span>Voice note language</span><span className="text-[#008069]">{vlang === "en-IN" ? "English" : "हिन्दी"}</span></button>
            <Link href={`/demo/dashboard${qs}&v=realestate`} className="block px-4 py-2.5 hover:bg-black/[.04]">Agent dashboard</Link>
            <Link href={`/demo/agent${qs}`} className="block px-4 py-2.5 hover:bg-black/[.04]">Agent&apos;s daily report</Link>
            <button onClick={newChat} className="block w-full px-4 py-2.5 text-left hover:bg-black/[.04]">New chat</button>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col" onClick={() => menu && setMenu(false)}>
          <WaWallpaper endRef={endRef}>
            <DayChip>Today</DayChip>
            <NoticeChip>Demo chat with an AI assistant. Properties shown are sample data. Not affiliated with WhatsApp.</NoticeChip>
            {msgs.map((m, i) => {
              const first = msgs[i - 1]?.from !== m.from; const me = m.from === "me";
              return (
                <WaBubble key={m.id} me={me} first={first} time={m.time} status={m.status} flush={!!m.prop} wide={!!m.voice}>
                  {m.prop ? <PropertyCard p={m.prop} onAsk={sendText} /> : m.voice ? <WaVoice me={me} secs={m.voice.secs} url={m.voice.url} speak={m.voice.speak} transcript={m.voice.transcript} seed={m.id} autoPlay={!me && m.voice.auto} /> : <WaText text={m.text ?? ""} />}
                </WaBubble>
              );
            })}
            {chips && msgs.length > 0 && <div className="flex flex-wrap gap-2 pt-1">{CHIPS.map((c) => <button key={c} onClick={() => sendText(c)} className="rounded-full border border-[#008069]/25 bg-white px-3.5 py-1.5 text-[13.5px] font-medium text-[#008069] shadow-sm transition active:scale-95">{c}</button>)}</div>}
            {phase !== "idle" && <div className="mt-2 flex"><div className="flex gap-1 rounded-lg rounded-tl-none bg-white px-3 py-3 shadow-sm">{[0, 1, 2].map((d) => <span key={d} className="bar h-1.5 w-1.5 rounded-full bg-[#8696A0]" style={{ animationDelay: `${d * 0.15}s`, animationDuration: "1s" }} />)}</div></div>}
          </WaWallpaper>
        </div>

        <div className="flex items-end gap-1.5 bg-[#EFEAE2] px-1.5 pb-2 pt-1">
          {rec ? (
            <div className="flex min-h-[46px] flex-1 items-center gap-3 rounded-full bg-white px-4 shadow-sm">
              <button onClick={() => finishRec(false)} aria-label="Cancel recording" className="text-[#54656F]"><svg width="22" height="22" viewBox="0 0 24 24" {...stroke}><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6" /></svg></button>
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" /><span className="text-[15px] tabular-nums text-[#111B21]">{Math.floor(rec.secs / 60)}:{String(rec.secs % 60).padStart(2, "0")}</span>
              <span className="truncate text-[13px] text-[#667781]">Recording · tap send when done</span>
            </div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); sendText(draft); }} className="flex min-h-[46px] flex-1 items-center gap-2 rounded-full bg-white px-3 shadow-sm">
              <svg width="24" height="24" viewBox="0 0 24 24" {...stroke} className="shrink-0 text-[#8696A0]" aria-hidden><circle cx="12" cy="12" r="9.5" /><path d="M8 14.5s1.5 2 4 2 4-2 4-2M9 9.5h.01M15 9.5h.01" /></svg>
              <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Message" className="min-w-0 flex-1 bg-transparent py-2 text-[16px] outline-none placeholder:text-[#8696A0]" />
              <svg width="22" height="22" viewBox="0 0 24 24" {...stroke} className="shrink-0 text-[#8696A0]" aria-hidden><path d="M21 12.5l-8.6 8.6a5.5 5.5 0 01-7.8-7.8L13 4.8a3.7 3.7 0 015.2 5.2l-8.4 8.4a1.8 1.8 0 01-2.6-2.6l7.7-7.7" /></svg>
            </form>
          )}
          <button onClick={() => (rec ? finishRec(true) : draft.trim() ? sendText(draft) : startRec())} aria-label={rec || draft.trim() ? "Send" : "Record voice note"} className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full bg-[#00A884] text-white shadow-sm transition active:scale-95">
            {rec || draft.trim() ? <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M3.4 20.4l17.5-7.5a1 1 0 000-1.8L3.4 3.6a.7.7 0 00-1 .8L4 10.5l9 1.5-9 1.5-1.6 6.1a.7.7 0 001 .8z" /></svg>
              : <svg width="22" height="22" viewBox="0 0 24 24" {...stroke} aria-hidden><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>}
          </button>
        </div>
      </div>

      <aside className="hidden w-[300px] shrink-0 lg:block">
        <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wide text-[#1F5B4C]">What your agent sees, live</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">Lead details</h2>
          <p className="text-xs text-black/50">{filled} of {fields.length} captured automatically</p>
          <dl className="mt-4 space-y-2.5">{fields.map(([k, v]) => (
            <div key={k} className="flex items-start gap-2.5 text-sm"><span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${v ? "bg-[#1F5B4C] text-white" : "border border-black/15 text-transparent"}`}>✓</span>
              <div className="min-w-0"><dt className="text-xs text-black/45">{k}</dt><dd className={v ? "font-medium" : "text-black/30"}>{v ?? "Not asked yet"}</dd></div></div>))}
          </dl>
          <div className="mt-4 flex justify-between border-t border-black/5 pt-3 text-xs text-black/50"><span>Voice notes handled</span><span className="font-medium text-black">{vnCount}</span></div>
          <div className="mt-4 grid gap-2">
            <Link href={`/demo/dashboard${qs}&v=realestate`} className="rounded-xl bg-[#1F5B4C] px-4 py-2.5 text-center text-sm font-medium text-white transition hover:bg-[#184a3e]">Open agent dashboard</Link>
            <Link href={`/demo/agent${qs}`} className="rounded-xl border border-black/10 px-4 py-2.5 text-center text-sm font-medium transition hover:bg-black/[.03]">See daily report on agent&apos;s phone</Link>
          </div>
        </div>
        <p className="mt-3 px-1 text-xs text-black/40">Tip: tap the mic, speak, then tap send. The AI replies with a voice note.</p>
      </aside>
    </main>
  );
}

function PropertyCard({ p, onAsk }: { p: Property; onAsk: (t: string) => void }) {
  return (
    <div className="w-[236px] overflow-hidden rounded-[6px]">
      <div className="relative flex h-28 items-end p-2.5" style={{ background: `linear-gradient(135deg, hsl(${p.hue} 45% 38%), hsl(${(p.hue + 40) % 360} 50% 62%))` }}>
        <svg className="absolute right-3 top-3 opacity-30" width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 21V8l6-4 6 4v13M15 21V12l6 3v6M3 21h18M7 11h2M7 15h2M11 11h2M11 15h2" /></svg>
        <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#111B21]">{p.mode === "sale" ? "For sale" : "For rent"}</span>
      </div>
      <div className="px-2 pb-1 pt-2"><p className="text-[15px] font-semibold leading-tight">{p.title}</p><p className="mt-0.5 text-[13px] text-[#54656F]">{p.locality}, {p.city}</p>
        <p className="mt-1 text-[15px] font-semibold text-[#008069]">{p.price}</p><p className="mt-1 text-[12px] text-[#667781]">{p.beds} · {p.area} · {p.furnishing}</p></div>
      <div className="mt-1.5 divide-y divide-black/10 border-t border-black/10 text-center text-[14px] font-medium text-[#00A884]">
        <button onClick={() => onAsk(`Tell me more about the ${p.title} in ${p.locality}`)} className="w-full py-2 transition hover:bg-black/[.03]">More details</button>
        <button onClick={() => onAsk(`I'd like to visit the ${p.title} in ${p.locality}`)} className="w-full py-2 transition hover:bg-black/[.03]">Book a visit</button>
      </div>
    </div>
  );
}
