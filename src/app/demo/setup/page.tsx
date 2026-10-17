"use client";
import { useEffect, useMemo, useState } from "react";
import { cleanBiz, PERSONAS, type Lang, type Vertical } from "@/lib/demo/personas";
import { VOICE_LABELS, type VoicePreset } from "@/lib/demo/voices";

export default function SetupPage() {
  const [biz, setBiz] = useState("");
  const [vertical, setVertical] = useState<Vertical>("realestate");
  const [lang, setLang] = useState<Lang>("en");
  const [voice, setVoice] = useState<VoicePreset>("gemini");
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);

  const persona = PERSONAS[vertical];
  const name = cleanBiz(biz, persona.defaultBiz);
  const path = useMemo(() => {
    const q = new URLSearchParams({ v: vertical, biz: name });
    if (lang === "hi") q.set("lang", "hi");
    if (voice !== "gemini") q.set("voice", voice);
    return `/demo?${q.toString()}`;
  }, [vertical, name, lang, voice]);
  const link = origin + path;

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { window.prompt("Copy this link:", link); }
  };

  const pill = (active: boolean) => `rounded-full px-4 py-2 text-sm transition ${active ? "bg-[#1F5B4C] text-white" : "text-black/60 hover:bg-black/[.04]"}`;

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <div className="rounded-2xl border border-black/10 bg-white p-6 shadow-[0_8px_40px_rgba(17,19,24,0.06)]">
        <h1 className="text-xl font-semibold tracking-tight">Personalise the demo</h1>
        <p className="mt-1 text-sm text-black/55">Type your client&apos;s company name. The assistant will greet callers with it and use it throughout the call.</p>

        <label className="mt-6 block text-sm font-medium">Company name</label>
        <input value={biz} onChange={(e) => setBiz(e.target.value)} maxLength={40} placeholder={persona.defaultBiz} className="mt-1.5 w-full rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-[#1F5B4C]" />

        <div className="mt-5 flex flex-wrap gap-6">
          <div>
            <p className="text-sm font-medium">Business type</p>
            <div className="mt-1.5 inline-flex gap-1 rounded-full border border-black/10 p-1">
              {(Object.keys(PERSONAS) as Vertical[]).map((v) => <button key={v} type="button" onClick={() => setVertical(v)} className={pill(vertical === v)}>{PERSONAS[v].label}</button>)}
            </div>
          </div>
          <div>
            <p className="text-sm font-medium">Starts in</p>
            <div className="mt-1.5 inline-flex gap-1 rounded-full border border-black/10 p-1">
              <button type="button" onClick={() => setLang("en")} className={pill(lang === "en")}>English</button>
              <button type="button" onClick={() => setLang("hi")} className={pill(lang === "hi")}>हिन्दी</button>
            </div>
          </div>
        </div>

        <div className="mt-5">
          <p className="text-sm font-medium">Voice</p>
          <div className="mt-1.5 inline-flex flex-wrap gap-1 rounded-full border border-black/10 p-1">
            {(Object.keys(VOICE_LABELS) as VoicePreset[]).map((v) => <button key={v} type="button" onClick={() => setVoice(v)} className={pill(voice === v)}>{VOICE_LABELS[v]}</button>)}
          </div>
          <p className="mt-1.5 text-xs text-black/45">Try each with Preview call and keep the one that sounds best in English and in Hindi.</p>
        </div>

        <div className="mt-6 rounded-xl bg-[#F7F6F3] p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-[#1F5B4C]">The assistant will open with</p>
          <p className="mt-1 text-sm leading-relaxed">{persona.opening(name, lang)}</p>
        </div>

        <label className="mt-6 block text-sm font-medium">Voice call link to send your client</label>
        <div className="mt-1.5 break-all rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-xs text-black/70">{link || path}</div>

        <label className="mt-6 block text-sm font-medium">Chatbot link (WhatsApp-style, real estate)</label>
        <div className="mt-1.5 break-all rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-xs text-black/70">{origin}/demo/chat?biz={encodeURIComponent(name)}</div>
        <a href={`/demo/chat?biz=${encodeURIComponent(name)}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-medium text-[#1F5B4C] underline underline-offset-2">Preview chatbot</a>

        <div className="mt-4 flex gap-3">
          <button onClick={copy} className="flex-1 rounded-xl bg-[#1F5B4C] px-4 py-3 text-sm font-medium text-white transition hover:bg-[#184a3e]">{copied ? "Copied" : "Copy link"}</button>
          <a href={path} target="_blank" rel="noreferrer" className="flex-1 rounded-xl border border-black/10 px-4 py-3 text-center text-sm font-medium transition hover:bg-black/[.03]">Preview call</a>
        </div>
      </div>
    </main>
  );
}
