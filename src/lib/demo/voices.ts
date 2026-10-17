import type { Vertical } from "./personas";

/** Voice presets for Puter's txt2speech (provider names/options verified against docs.puter.com/AI/txt2speech). */
export type VoicePreset = "gemini" | "eleven" | "openai" | "polly";
export const VOICE_LABELS: Record<VoicePreset, string> = { gemini: "Gemini (recommended)", eleven: "ElevenLabs", openai: "OpenAI", polly: "Standard" };
export const asPreset = (v: unknown): VoicePreset => (v === "eleven" || v === "openai" || v === "polly" || v === "gemini" ? v : "gemini");
export const asVoiceId = (v: unknown): string | undefined => (typeof v === "string" && /^[A-Za-z0-9_-]{2,40}$/.test(v) ? v : undefined);

const STYLE = {
  en: "Speak like a warm, friendly human receptionist on a live phone call. Natural conversational pace, a gentle smile in the voice, small natural pauses between thoughts. Never robotic, never an announcer.",
  hi: "Speak like a warm, friendly human receptionist on a live phone call, in natural conversational Hindi with a clear Indian accent. Keep common English words sounding natural. Natural pace, a gentle smile in the voice, small pauses between thoughts. Never robotic.",
};

/** Ordered list of option sets to try. The last entry is the safe fallback before the browser voice. */
export function ttsOptionChain(preset: VoicePreset, o: { vertical: Vertical; lang: "en" | "hi"; speechLang: string; vid?: string }): Record<string, unknown>[] {
  const instructions = STYLE[o.lang];
  const indian = o.lang === "hi" || o.speechLang === "en-IN";
  const polly = { provider: "aws-polly", language: o.speechLang, engine: "neural", ...(indian ? { voice: "Kajal" } : {}) };
  const male = o.vertical === "plumbing";
  const primary: Record<string, unknown> | null =
    preset === "gemini" ? { provider: "gemini", voice: o.vid ?? (male ? "Achird" : "Sulafat"), instructions }
    : preset === "eleven" ? { provider: "elevenlabs", model: "eleven_multilingual_v2", ...(o.vid ? { voice: o.vid } : {}) }
    : preset === "openai" ? { provider: "openai", model: "gpt-4o-mini-tts", voice: o.vid ?? (male ? "ash" : "coral"), instructions }
    : null;
  return primary ? [primary, polly] : [polly];
}
