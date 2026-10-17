import { loadCoreEnv } from "../env";
import { ElevenLabsTTS, GoogleTTS, type TTSProvider } from "./provider";

let cached: TTSProvider | null | undefined;
/** null = use the browser's built-in voice. */
export function getTTSProvider(): TTSProvider | null {
  if (cached !== undefined) return cached;
  const e = loadCoreEnv();
  cached = e.TTS_PROVIDER === "google" ? new GoogleTTS(e.GOOGLE_TTS_API_KEY!, { en: e.GOOGLE_VOICE_EN, hi: e.GOOGLE_VOICE_HI }) : e.TTS_PROVIDER === "elevenlabs" ? new ElevenLabsTTS(e.ELEVENLABS_API_KEY!, e.ELEVENLABS_MODEL, { en: e.ELEVENLABS_VOICE_EN!, hi: e.ELEVENLABS_VOICE_HI! }) : null;
  return cached;
}
/** v3/v4-class models understand expression tags like [warmly]; flash/turbo/multilingual do not. */
export function ttsIsExpressive(): boolean {
  const e = loadCoreEnv();
  return e.TTS_PROVIDER === "elevenlabs" && /v3|v4/.test(e.ELEVENLABS_MODEL);
}
