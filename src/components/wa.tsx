"use client";
import { useEffect, useRef, useState } from "react";

/** Reusable WhatsApp-style pieces (original lookalike, no WhatsApp logo). */
const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function Ticks({ status }: { status: "sent" | "delivered" | "read" }) {
  const c = status === "read" ? "#53BDEB" : "#8696A0";
  return status === "sent"
    ? <svg width="14" height="11" viewBox="0 0 16 11" aria-label="Sent"><path d="M2 6l3.2 3.2L13 1.5" stroke={c} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
    : <svg width="17" height="11" viewBox="0 0 18 11" aria-label={status}><path d="M1 6l3.2 3.2L11 1.5M6.2 8.6l.9.9L14 1.5" stroke={c} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function WaHeader(p: { title: string; subtitle: string; initials: string; verified?: boolean; right?: React.ReactNode }) {
  return (
    <header className="relative z-20 flex items-center gap-2 bg-[#008069] px-2 py-2 text-white">
      <svg width="24" height="24" viewBox="0 0 24 24" {...stroke} aria-hidden><path d="M15 18l-6-6 6-6" /></svg>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#DFE5E7] text-sm font-semibold text-[#54656F]">{p.initials}</div>
      <div className="ml-1 min-w-0 flex-1 leading-tight">
        <p className="flex items-center gap-1 truncate text-[16px] font-medium">{p.title}{p.verified && <svg width="15" height="15" viewBox="0 0 24 24" aria-label="Verified"><circle cx="12" cy="12" r="11" fill="#25D366" /><path d="M7 12.5l3.2 3.2L17 9" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}</p>
        <p className="truncate text-[12.5px] text-white/85">{p.subtitle}</p>
      </div>
      <svg width="22" height="22" viewBox="0 0 24 24" {...stroke} aria-hidden><rect x="2" y="6" width="13" height="12" rx="2" /><path d="M15 10l7-4v12l-7-4" /></svg>
      <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2.1z" /></svg>
      {p.right}
    </header>
  );
}

export function WaWallpaper({ children, endRef }: { children: React.ReactNode; endRef?: React.RefObject<HTMLDivElement> }) {
  return (
    <div className="relative flex-1 space-y-[3px] overflow-y-auto px-[5%] py-3" style={{ backgroundColor: "#EFEAE2", backgroundImage: "radial-gradient(rgba(11,20,26,.045) 1.2px, transparent 1.2px), radial-gradient(rgba(11,20,26,.03) 1px, transparent 1px)", backgroundSize: "22px 22px, 22px 22px", backgroundPosition: "0 0, 11px 11px" }}>
      {children}<div ref={endRef} />
    </div>
  );
}

export function DayChip({ children }: { children: React.ReactNode }) {
  return <p className="mx-auto my-2 w-fit rounded-lg bg-white px-3 py-1 text-[12px] uppercase tracking-wide text-[#54656F] shadow-[0_1px_0.5px_rgba(11,20,26,.13)]">{children}</p>;
}
export function NoticeChip({ children }: { children: React.ReactNode }) {
  return <p className="mx-auto my-2 max-w-[88%] rounded-lg bg-[#FFEECD] px-3 py-1.5 text-center text-[12px] leading-snug text-[#54656F] shadow-[0_1px_0.5px_rgba(11,20,26,.13)]">{children}</p>;
}

export function WaBubble(p: { me?: boolean; first?: boolean; time: string; status?: "sent" | "delivered" | "read"; wide?: boolean; children: React.ReactNode; flush?: boolean }) {
  const me = !!p.me;
  return (
    <div className={`flex ${me ? "justify-end" : "justify-start"} ${p.first ? "mt-2" : ""} rise`}>
      <div className={`relative ${p.wide ? "w-[78%]" : "max-w-[82%]"} rounded-[8px] ${p.flush ? "p-[3px]" : "px-[9px] pb-[6px] pt-[6px]"} text-[14.2px] leading-[19px] text-[#111B21] shadow-[0_1px_0.5px_rgba(11,20,26,.13)] ${me ? "bg-[#D9FDD3]" : "bg-white"} ${p.first ? (me ? "rounded-tr-none" : "rounded-tl-none") : ""}`}>
        {p.first && <span aria-hidden className="absolute top-0 h-0 w-0" style={me ? { right: -8, borderTop: "8px solid #D9FDD3", borderRight: "8px solid transparent" } : { left: -8, borderTop: "8px solid #fff", borderLeft: "8px solid transparent" }} />}
        {p.children}
        <span className={`float-right ml-2 mt-[5px] flex items-center gap-1 text-[11px] leading-none text-[#667781] ${p.flush ? "pr-1.5" : ""}`}>{p.time}{me && p.status && <Ticks status={p.status} />}</span>
      </div>
    </div>
  );
}

/** Minimal *bold* and line-break rendering, like WhatsApp text formatting. */
export function WaText({ text }: { text: string }) {
  return <span className="whitespace-pre-wrap break-words">{text.split(/(\*[^*\n]+\*)/g).map((part, i) => /^\*[^*\n]+\*$/.test(part) ? <strong key={i} className="font-semibold">{part.slice(1, -1)}</strong> : <span key={i}>{part}</span>)}</span>;
}

const bars = (seed: number, n = 30) => Array.from({ length: n }, (_, i) => 22 + Math.abs(Math.sin(seed * 9.7 + i * 1.7) * 60 + Math.cos(seed * 3.1 + i * 0.9) * 18));
const isHindi = (t: string) => /[\u0900-\u097F]/.test(t);

/** Voice-note bubble body: plays recorded/generated audio, or speaks the text with the browser voice as a fallback. */
export function WaVoice(p: { me?: boolean; secs: number; url?: string; speak?: string; transcript?: string; seed: number; autoPlay?: boolean }) {
  const [playing, setPlaying] = useState(false);
  const [prog, setProg] = useState(0);
  const [showT, setShowT] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const tick = useRef<number | null>(null);
  const heights = useRef(bars(p.seed)).current;

  const stop = () => { audio.current?.pause(); if (tick.current) clearInterval(tick.current); try { window.speechSynthesis?.cancel(); } catch {} setPlaying(false); setProg(0); };
  const play = () => {
    if (playing) { stop(); return; }
    setPlaying(true);
    if (p.url) {
      const a = audio.current ?? new Audio(p.url); audio.current = a;
      a.ontimeupdate = () => setProg(Math.min(1, a.currentTime / (a.duration && isFinite(a.duration) ? a.duration : p.secs)));
      a.onended = () => { setPlaying(false); setProg(0); };
      a.currentTime = 0; a.play().catch(() => setPlaying(false));
    } else if (p.speak && "speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(p.speak); u.lang = isHindi(p.speak) ? "hi-IN" : "en-IN";
      u.onend = u.onerror = () => { if (tick.current) clearInterval(tick.current); setPlaying(false); setProg(0); };
      const t0 = Date.now(); tick.current = window.setInterval(() => setProg(Math.min(0.98, (Date.now() - t0) / 1000 / p.secs)), 150);
      window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
    } else setPlaying(false);
  };
  useEffect(() => { if (p.autoPlay) { const t = setTimeout(play, 250); return () => clearTimeout(t); } return undefined; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => () => { audio.current?.pause(); if (tick.current) clearInterval(tick.current); }, []);

  const mm = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;
  return (
    <div className="w-[236px]">
      <div className="flex items-center gap-2">
        <button onClick={play} aria-label={playing ? "Pause voice note" : "Play voice note"} className="flex h-9 w-9 shrink-0 items-center justify-center text-[#54656F]">
          {playing ? <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg> : <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 001.5.9l10-6.5a1 1 0 000-1.8l-10-6.5A1 1 0 008 5.5z" /></svg>}
        </button>
        <div className="flex-1">
          <div className="flex h-7 items-center gap-[2px]">{heights.map((h, i) => <span key={i} className="w-[2.5px] rounded-full" style={{ height: `${h * 0.32}px`, backgroundColor: i / heights.length < prog ? "#00A884" : "#B3BDC3" }} />)}</div>
          <p className="mt-0.5 text-[11px] text-[#667781]">{mm(p.secs)}</p>
        </div>
        <div className="relative shrink-0"><div className={`flex h-11 w-11 items-center justify-center rounded-full text-white ${p.me ? "bg-[#6B7C85]" : "bg-[#00A884]"}`}><svg width="20" height="20" viewBox="0 0 24 24" {...stroke}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg></div></div>
      </div>
      {p.transcript && <button onClick={() => setShowT((v) => !v)} className="mt-1 text-[12px] font-medium text-[#027EB5]">{showT ? "Hide transcript" : "Show transcript"}</button>}
      {showT && p.transcript && <p className="mt-1 rounded-md bg-black/[.04] px-2 py-1 text-[13px] italic text-[#3B4A54]">{p.transcript}</p>}
    </div>
  );
}
