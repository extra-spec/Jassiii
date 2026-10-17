export interface TTSProvider { synth(text: string, lang: "en" | "hi"): Promise<{ audio: ArrayBuffer; contentType: string }> }

export class ElevenLabsTTS implements TTSProvider {
  constructor(private key: string, private model: string, private voices: { en: string; hi: string }) {}
  async synth(text: string, lang: "en" | "hi") {
    const voice = lang === "hi" ? this.voices.hi : this.voices.en;
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_64`, {
      method: "POST",
      headers: { "xi-api-key": this.key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: this.model }),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 500)}`);
    return { audio: await res.arrayBuffer(), contentType: res.headers.get("content-type") ?? "audio/mpeg" };
  }
}
/** Google Cloud Text-to-Speech REST: POST texttospeech.googleapis.com/v1/text:synthesize, returns base64 audioContent. */
export class GoogleTTS implements TTSProvider {
  constructor(private key: string, private voices: { en: string; hi: string }) {}
  /** OGG/Opus bytes, the format WhatsApp needs for a real voice note. */
  async synthOggOpus(text: string, lang: "en" | "hi"): Promise<Buffer> {
    const r = await this.call(text, lang, "OGG_OPUS");
    return Buffer.from(r.b64, "base64");
  }
  async synth(text: string, lang: "en" | "hi") {
    const r = await this.call(text, lang, "MP3");
    const buf = Buffer.from(r.b64, "base64");
    return { audio: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, contentType: "audio/mpeg" };
  }
  private async call(text: string, lang: "en" | "hi", audioEncoding: "MP3" | "OGG_OPUS") {
    const name = lang === "hi" ? this.voices.hi : this.voices.en;
    const languageCode = name.split("-").slice(0, 2).join("-"); // "hi-IN-Chirp3-HD-Aoede" -> "hi-IN"
    const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(this.key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: { text }, voice: { languageCode, name }, audioConfig: { audioEncoding } }),
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`Google TTS ${res.status}: ${raw.slice(0, 500)}`);
    const b64 = JSON.parse(raw)?.audioContent;
    if (typeof b64 !== "string") throw new Error(`Google TTS returned no audio: ${raw.slice(0, 300)}`);
    return { b64 };
  }
}
export const stripTags = (t: string) => t.replace(/\[[^\]]{1,40}\]/g, " ").replace(/\s+/g, " ").trim();
