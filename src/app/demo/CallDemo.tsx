"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
import Link from "next/link";
import { resolvePersona } from "@/lib/demo/personas";
import { puterText } from "@/lib/demo/puter";
import { ttsOptionChain, type VoicePreset } from "@/lib/demo/voices";
import { buildAnalysisMessages, parseAnalysis } from "@/lib/demo/analysis";
import { addCall, stripTags, updateAnalysis, type CallRecord } from "@/lib/demo/store";

type Phase = "idle" | "ringing" | "live" | "ended";
type Turn = "listening" | "thinking" | "speaking";
type Msg = { role: "user" | "assistant"; content: string };

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export default function CallDemo(p: { vertical: string; biz: string; agentName: string; openings: Record<"en" | "hi", string>; enAccent: string; initialLang: "en" | "hi"; engine: "puter" | "server"; model: string; voice: VoicePreset; vid?: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [turn, setTurn] = useState<Turn>("listening");
  const [secs, setSecs] = useState(0);
  const [agentLine, setAgentLine] = useState("");
  const [youLine, setYouLine] = useState("");
  const [muted, setMuted] = useState(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [speechOk, setSpeechOk] = useState(true);
  const [micBlocked, setMicBlocked] = useState(false);
  const [lang, setLangState] = useState<"en" | "hi">(p.initialLang);
  const [noVoice, setNoVoice] = useState(false);
  const langRef = useRef<"en" | "hi">(p.initialLang);
  const sl = () => (langRef.current === "hi" ? "hi-IN" : p.enAccent);

  const msgs = useRef<Msg[]>([]);
  const rec = useRef<any>(null);
  const live = useRef(false);
  const mutedRef = useRef(false);
  const audio = useRef<AudioContext | null>(null);
  const timers = useRef<number[]>([]);
  const busy = useRef(false);
  const ttsOff = useRef(false);
  const startedAt = useRef(0);
  const [lastCallId, setLastCallId] = useState<string | null>(null);
  const voiceEl = useRef<HTMLAudioElement | null>(null);
  const openingVoice = useRef<Promise<string | null> | undefined>(undefined);

  useEffect(() => {
    const w = window as any;
    setSpeechOk(!!(w.SpeechRecognition || w.webkitSpeechRecognition) && "speechSynthesis" in window);
    return () => hangUp(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const later = (fn: () => void, ms: number) => { const id = window.setTimeout(fn, ms); timers.current.push(id); };

  const stopListening = () => { try { rec.current?.abort(); } catch {} rec.current = null; };

  const pickVoice = () => {
    const pre = sl().slice(0, 2).toLowerCase();
    const vs = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith(pre));
    if (pre === "hi") return vs.find((v) => /google|natural|neural|swara|madhur/i.test(v.name)) ?? vs[0];
    return vs.find((v) => v.lang === sl() && /female|google|natural|neural/i.test(v.name)) ?? vs.find((v) => v.lang === sl()) ?? vs.find((v) => /google uk english female|samantha|natural/i.test(v.name)) ?? vs[0];
  };

  const listen = useCallback(() => {
    if (!live.current) return;
    setTurn("listening");
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR || mutedRef.current || typing) return;
    stopListening();
    const r = new SR();
    r.lang = sl(); r.interimResults = true; r.continuous = false;
    let finalText = "";
    r.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t; else interim += t;
      }
      setYouLine((finalText + interim).trim());
    };
    r.onerror = (e: any) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") { setMicBlocked(true); setTyping(true); live.current && setTurn("listening"); } };
    r.onend = () => {
      if (rec.current !== r) return;
      rec.current = null;
      if (finalText.trim()) send(finalText.trim());
      else if (live.current && !mutedRef.current && !busy.current) later(listen, 250);
    };
    rec.current = r;
    try { r.start(); } catch { later(listen, 400); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typing]);

  const clean = (t: string) => t.replace(/\[[^\]]{1,40}\]/g, " ").replace(/\s+/g, " ").trim();

  /** Fetch natural-voice audio from the server. Resolves null when the server uses the browser voice or fails. */
  const fetchVoice = async (text: string): Promise<string | null> => {
    if (ttsOff.current) return null;
    if (p.engine === "puter") {
      const pu = (window as any).puter; if (!pu) return null;
      const chain = ttsOptionChain(p.voice, { vertical: p.vertical as "realestate" | "plumbing", lang: langRef.current, speechLang: sl(), vid: p.vid });
      for (const opts of chain) {
        try {
          const el = await pu.ai.txt2speech(text, opts);
          if (el?.src) return el.src as string;
        } catch (e) { console.warn(`[puter tts] ${String(opts.provider)} failed, trying next voice:`, e); }
      }
      return null; // browser voice
    }
    try {
      const res = await fetch("/api/demo/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, lang: langRef.current }) });
      if (res.status === 501) { ttsOff.current = true; return null; }
      if (!res.ok) return null;
      return URL.createObjectURL(await res.blob());
    } catch { return null; }
  };

  const speakBrowser = (text: string, done: () => void) => {
    if (!("speechSynthesis" in window)) { later(done, 1500 + text.length * 40); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = sl(); const v = pickVoice(); if (v) u.voice = v; u.rate = 1.02;
    let fired = false;
    const finish = () => { if (fired) return; fired = true; done(); };
    u.onend = finish; u.onerror = finish;
    later(finish, 3000 + text.length * 110); // some browsers never fire onend
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
  };

  const speak = useCallback(async (raw: string, pre?: Promise<string | null>) => {
    const text = clean(raw);
    setAgentLine(text); setTurn("thinking");
    const done = () => { busy.current = false; if (live.current) listen(); };
    const url = await (pre ?? fetchVoice(text));
    if (!live.current) { if (url) URL.revokeObjectURL(url); return; }
    setTurn("speaking");
    if (!url) { speakBrowser(text, done); return; }
    const a = new Audio(url); voiceEl.current = a;
    let fired = false;
    const finish = () => { if (fired) return; fired = true; URL.revokeObjectURL(url); voiceEl.current = null; done(); };
    a.onended = finish;
    a.onerror = () => { if (fired) return; fired = true; voiceEl.current = null; speakBrowser(text, done); };
    a.play().catch(() => { if (fired) return; fired = true; voiceEl.current = null; speakBrowser(text, done); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listen]);

  const getReply = async (): Promise<string> => {
    if (p.engine === "puter") {
      const pu = (window as any).puter; if (!pu) throw new Error("puter.js not loaded");
      const { persona } = resolvePersona(p.vertical);
      const messages = [{ role: "system", content: persona.instructions(p.biz, langRef.current, false) }, ...msgs.current.slice(-16)];
      let r: unknown;
      try { r = await pu.ai.chat(messages, { model: p.model }); }
      catch (e) { console.warn("[puter chat] model failed, retrying with Puter's default:", e); r = await pu.ai.chat(messages); }
      const t = puterText(r); if (!t) throw new Error("empty reply from puter");
      return t;
    }
    const res = await fetch("/api/demo/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vertical: p.vertical, biz: p.biz, lang: langRef.current, messages: msgs.current }) });
    const data = await res.json();
    if (!res.ok || !data.reply) throw new Error(data.error ?? "failed");
    return data.reply as string;
  };

  const send = useCallback(async (text: string) => {
    if (!live.current || busy.current) return;
    busy.current = true; stopListening();
    msgs.current.push({ role: "user", content: text }); setYouLine(text); setTurn("thinking");
    try {
      const reply = await getReply();
      msgs.current.push({ role: "assistant", content: reply });
      if (live.current) speak(reply);
    } catch (e) {
      console.warn("[demo] reply failed:", e);
      if (live.current) speak("Sorry, I'm having a little trouble on my end. Could you say that again?");
    }
  }, [p.vertical, p.biz, speak]);

  const ringtone = () => {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx: AudioContext = new Ctx(); audio.current = ctx;
    const g = ctx.createGain(); g.gain.value = 0.05; g.connect(ctx.destination);
    for (let c = 0; c < 2; c++) for (const off of [0, 0.6]) {
      const t = ctx.currentTime + 0.2 + c * 2.6 + off;
      for (const f of [440, 480]) { const o = ctx.createOscillator(); o.frequency.value = f; o.connect(g); o.start(t); o.stop(t + 0.4); }
    }
  };

  const startCall = () => {
    msgs.current = []; setLastCallId(null); setSecs(0); setAgentLine(""); setYouLine(""); setMuted(false); mutedRef.current = false;
    setPhase("ringing");
    try { ringtone(); } catch {}
    openingVoice.current = fetchVoice(clean(p.openings[langRef.current]));
    const have = window.speechSynthesis?.getVoices() ?? [];
    setNoVoice(langRef.current === "hi" && have.length > 0 && !have.some((v) => v.lang.toLowerCase().startsWith("hi")));
    later(() => {
      live.current = true; busy.current = true; startedAt.current = Date.now(); setPhase("live");
      const opening = p.openings[langRef.current];
      msgs.current.push({ role: "assistant", content: opening });
      const tick = window.setInterval(() => setSecs((s) => s + 1), 1000); timers.current.push(tick);
      speak(opening, openingVoice.current);
    }, 5200);
  };

  function hangUp(silent = false) {
    const wasLive = live.current;
    live.current = false; busy.current = false;
    timers.current.forEach((t) => { clearTimeout(t); clearInterval(t); }); timers.current = [];
    stopListening(); try { window.speechSynthesis?.cancel(); } catch {}
    try { voiceEl.current?.pause(); } catch {} voiceEl.current = null;
    try { audio.current?.close(); } catch {} audio.current = null;
    if (!silent && wasLive) finalizeCall();
    if (!silent) setPhase("ended");
  }

  /** Save this call for the demo dashboard, then summarise it in the background. */
  function finalizeCall() {
    const transcript = msgs.current.map((m) => ({ role: m.role, content: stripTags(m.content) })).filter((m) => m.content);
    if (!transcript.some((m) => m.role === "user")) return; // nothing said by the caller
    const rec: CallRecord = { id: `c${Date.now()}`, startedAt: startedAt.current || Date.now(), durationSecs: Math.max(1, Math.round((Date.now() - (startedAt.current || Date.now())) / 1000)), biz: p.biz, vertical: p.vertical as CallRecord["vertical"], lang: langRef.current, transcript };
    addCall(rec); setLastCallId(rec.id);
    void runAnalysis(rec);
  }

  async function runAnalysis(rec: CallRecord) {
    try {
      let text = "";
      if (p.engine === "puter") {
        const pu = (window as any).puter; if (!pu) throw new Error("puter.js not loaded");
        const messages = buildAnalysisMessages(rec.transcript, rec.biz, rec.vertical);
        let r: unknown;
        try { r = await pu.ai.chat(messages, { model: p.model }); } catch { r = await pu.ai.chat(messages); }
        text = puterText(r);
      } else {
        const res = await fetch("/api/demo/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vertical: rec.vertical, biz: rec.biz, transcript: rec.transcript }) });
        text = (await res.json()).text ?? "";
      }
      updateAnalysis(rec.id, parseAnalysis(text));
    } catch (e) { console.warn("[demo] call summary failed:", e); updateAnalysis(rec.id, null); }
  }

  const changeLang = (l: "en" | "hi") => {
    if (l === langRef.current) return;
    langRef.current = l; setLangState(l);
    if (phase === "live") {
      const hv = window.speechSynthesis?.getVoices() ?? [];
      setNoVoice(l === "hi" && hv.length > 0 && !hv.some((v) => v.lang.toLowerCase().startsWith("hi")));
      if (turn === "listening" && !busy.current) { stopListening(); later(listen, 150); }
    }
  };

  const toggleMute = () => {
    const m = !mutedRef.current; mutedRef.current = m; setMuted(m);
    if (m) stopListening(); else if (turn === "listening") listen();
  };

  const submitDraft = (e: React.FormEvent) => { e.preventDefault(); const t = draft.trim(); if (t) { setDraft(""); window.speechSynthesis?.cancel(); try { voiceEl.current?.pause(); } catch {} send(t); } };

  const initials = p.biz.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const status = phase === "ringing" ? "Calling…" : phase === "live" ? fmt(secs) : phase === "ended" ? `Call ended · ${fmt(secs)}` : "AI voice assistant";
  const turnLabel = muted ? "Microphone muted" : turn === "listening" ? "Listening…" : turn === "thinking" ? "Thinking…" : `${p.agentName} is speaking`;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      {p.engine === "puter" && <Script src="https://js.puter.com/v2/" strategy="afterInteractive" />}
      <div className="w-full max-w-[400px] overflow-hidden rounded-3xl border border-black/10 bg-white shadow-[0_8px_40px_rgba(17,19,24,0.08)]">
        <div className="flex items-center justify-between px-6 pt-5 text-xs text-black/50">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-black/10 px-2.5 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-[#1F5B4C]" /> Live demo
          </span>
          <span>{phase === "live" ? "Secure call" : "No sign-up needed"}</span>
        </div>

        <div className="flex flex-col items-center px-6 pb-6 pt-8 text-center">
          <div className="relative flex h-28 w-28 items-center justify-center">
            {phase === "ringing" && [0, 0.6, 1.2].map((d) => <span key={d} className="ringwave absolute inset-0 rounded-full bg-[#1F5B4C]/25" style={{ animationDelay: `${d}s` }} />)}
            {phase === "live" && turn === "speaking" && <span className="ringwave absolute inset-0 rounded-full bg-[#1F5B4C]/20" />}
            <div className={`relative flex h-24 w-24 items-center justify-center rounded-full bg-[#1F5B4C] text-2xl font-semibold tracking-wide text-white shadow-lg ${phase === "live" && turn !== "thinking" ? "" : ""}`} style={phase === "idle" ? { animation: "breathe 3.5s ease-in-out infinite" } : undefined}>
              {phase === "live" ? (
                <div className="flex h-10 items-center gap-1" aria-hidden>
                  {[0, 1, 2, 3, 4].map((i) => <span key={i} className={`h-full w-1.5 rounded-full bg-white ${turn === "speaking" || turn === "thinking" ? "bar" : ""}`} style={turn === "listening" ? { transform: "scaleY(.25)" } : { animationDelay: `${i * 0.12}s`, animationDuration: turn === "thinking" ? "1.6s" : "0.9s" }} />)}
                </div>
              ) : initials}
            </div>
          </div>

          <h1 className="mt-5 text-xl font-semibold tracking-tight">{p.biz}</h1>
          <p className="mt-1 text-sm text-black/50">{p.agentName} · AI assistant</p>
          <p className={`mt-3 text-sm tabular-nums ${phase === "live" ? "text-[#1F5B4C]" : "text-black/50"}`}>{status}</p>
        </div>

        {phase === "idle" && (
          <div className="rise px-6 pb-7 text-center">
            <p className="mx-auto max-w-[280px] text-sm leading-relaxed text-black/60">Tap to call and have a real conversation with our AI assistant. Speak naturally, as you would on a phone call.</p>
            <LangPick lang={lang} onPick={changeLang} />
            <button onClick={startCall} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#1F5B4C] px-5 py-3.5 text-sm font-medium text-white shadow-sm transition hover:bg-[#184a3e] active:scale-[.99]">
              <PhoneIcon /> Call {p.agentName}
            </button>
            <p className="mt-3 text-xs text-black/40">{speechOk ? (p.engine === "puter" ? "Your browser will ask for the microphone, and a quick free Puter sign-in may pop up the first time (it powers the AI voice)." : "Your browser will ask to use the microphone.") : "Voice isn't supported in this browser. You can still chat by typing, or open this link in Chrome."}</p>
          </div>
        )}

        {phase === "ringing" && (
          <div className="rise px-6 pb-7">
            <button onClick={() => { hangUp(); }} className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#C0392B] text-white shadow-md transition hover:brightness-110" aria-label="Cancel call"><PhoneIcon down /></button>
          </div>
        )}

        {phase === "live" && (
          <div className="px-6 pb-6">
            <div className="min-h-[96px] rounded-2xl bg-[#F7F6F3] px-4 py-3 text-left">
              {agentLine && <p key={agentLine} className="rise text-sm leading-relaxed text-[#111318]"><span className="mb-0.5 block text-[11px] font-medium uppercase tracking-wide text-[#1F5B4C]">{p.agentName}</span>{agentLine}</p>}
              {youLine && <p className="mt-2 text-xs leading-relaxed text-black/45"><span className="font-medium">You:</span> {youLine}</p>}
            </div>
            <div className="mt-3 flex justify-center"><LangPick lang={lang} onPick={changeLang} small /></div>
            {noVoice && !ttsOff.current && <p className="mt-2 text-center text-[11px] text-amber-700">No Hindi voice on this device, so the assistant may sound off. Chrome on Android or desktop has one.</p>}
            <p className="mt-2 text-center text-xs text-black/45" aria-live="polite">{micBlocked ? "Microphone blocked. Type your reply below." : turnLabel}</p>

            {(typing || !speechOk) && (
              <form onSubmit={submitDraft} className="mt-3 flex gap-2">
                <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type your reply…" className="min-w-0 flex-1 rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-[#1F5B4C]" />
                <button className="rounded-xl bg-[#1F5B4C] px-4 text-sm font-medium text-white">Send</button>
              </form>
            )}

            <div className="mt-5 flex items-center justify-center gap-5">
              <RoundBtn label={muted ? "Unmute" : "Mute"} active={muted} onClick={toggleMute} disabled={!speechOk || micBlocked}><MicIcon off={muted} /></RoundBtn>
              <button onClick={() => hangUp()} className="flex h-16 w-16 items-center justify-center rounded-full bg-[#C0392B] text-white shadow-md transition hover:brightness-110 active:scale-95" aria-label="End call"><PhoneIcon down /></button>
              <RoundBtn label="Type" active={typing} onClick={() => { const t = !typing; setTyping(t); if (t) stopListening(); else if (turn === "listening") listen(); }}><KeyIcon /></RoundBtn>
            </div>
          </div>
        )}

        {phase === "ended" && (
          <div className="rise px-6 pb-7 text-center">
            <p className="text-sm text-black/60">Thanks for trying the demo. Open the dashboard to see what your team would get from this call.</p>
            {lastCallId && <Link href={`/demo/dashboard?call=${lastCallId}&v=${p.vertical}&biz=${encodeURIComponent(p.biz)}`} className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-[#1F5B4C] px-5 py-3.5 text-sm font-medium text-white transition hover:bg-[#184a3e]">View demo dashboard</Link>}
            <button onClick={startCall} className={`${lastCallId ? "mt-3 border border-black/10 text-black/70 hover:bg-black/[.03]" : "mt-5 bg-[#1F5B4C] text-white hover:bg-[#184a3e]"} inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-sm font-medium transition`}><PhoneIcon /> Call again</button>
          </div>
        )}

        <div className="border-t border-black/5 px-6 py-3 text-center text-[11px] text-black/35">Demo of an AI voice assistant · Sample data only · Calls are not recorded</div>
      </div>
    </main>
  );
}

function LangPick(p: { lang: "en" | "hi"; onPick: (l: "en" | "hi") => void; small?: boolean }) {
  const b = (l: "en" | "hi", label: string) => (
    <button type="button" onClick={() => p.onPick(l)} className={`rounded-full px-3 ${p.small ? "py-1 text-xs" : "py-1.5 text-sm"} transition ${p.lang === l ? "bg-[#1F5B4C] text-white" : "text-black/60 hover:bg-black/[.04]"}`}>{label}</button>
  );
  return <div className="mx-auto mt-5 inline-flex gap-1 rounded-full border border-black/10 bg-white p-1" role="group" aria-label="Language">{b("en", "English")}{b("hi", "हिन्दी")}</div>;
}

function RoundBtn(p: { label: string; active: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={p.onClick} disabled={p.disabled} className={`flex h-12 w-12 flex-col items-center justify-center rounded-full border text-black/70 transition disabled:opacity-40 ${p.active ? "border-[#1F5B4C] bg-[#1F5B4C]/10 text-[#1F5B4C]" : "border-black/10 bg-white hover:bg-black/[.03]"}`} aria-label={p.label} title={p.label}>
      {p.children}
    </button>
  );
}
const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
function PhoneIcon({ down }: { down?: boolean }) { return (<svg width="20" height="20" viewBox="0 0 24 24" {...stroke} style={down ? { transform: "rotate(135deg)" } : undefined}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.800.6 2.700.7a2 2 0 0 1 1.700 2.100z" /></svg>); }
function MicIcon({ off }: { off?: boolean }) { return (<svg width="20" height="20" viewBox="0 0 24 24" {...stroke}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />{off && <path d="M4 4l16 16" />}</svg>); }
function KeyIcon() { return (<svg width="20" height="20" viewBox="0 0 24 24" {...stroke}><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" /></svg>); }
