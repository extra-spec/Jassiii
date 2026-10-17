import { z } from "zod";

/** Exotel AgentStream WebSocket protocol (per developer.exotel.com/docs/agentstream/websocket-protocol). */
export const SAMPLE_RATE = 8000;            // 8 kHz mono 16-bit PCM
export const BYTES_PER_MS = (SAMPLE_RATE * 2) / 1000; // 16
export const CHUNK_UNIT = 320;              // sent chunks must be a multiple of 320 bytes (20 ms)
export const MIN_CHUNK = 3200;              // 100 ms minimum
export const MAX_CHUNK = 100_000;

const startSchema = z.object({
  event: z.literal("start"),
  stream_sid: z.string().optional(),
  start: z.object({
    stream_sid: z.string().optional(),
    call_sid: z.string().optional(),
    account_sid: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    custom_parameters: z.record(z.unknown()).optional().nullable(),
  }).passthrough().optional(),
}).passthrough();

const incoming = z.discriminatedUnion("event", [
  z.object({ event: z.literal("connected") }).passthrough(),
  startSchema,
  z.object({ event: z.literal("media"), media: z.object({ payload: z.string(), chunk: z.union([z.string(), z.number()]).optional(), timestamp: z.union([z.string(), z.number()]).optional() }).passthrough() }).passthrough(),
  z.object({ event: z.literal("dtmf"), dtmf: z.object({ digit: z.string() }).passthrough().optional() }).passthrough(),
  z.object({ event: z.literal("mark"), mark: z.object({ name: z.string() }).passthrough() }).passthrough(),
  z.object({ event: z.literal("stop") }).passthrough(),
]);
export type ExotelEvent = z.infer<typeof incoming>;

/** Returns null (and the reason) instead of throwing, so one bad frame never crashes a call. */
export function parseEvent(raw: string): { ok: true; event: ExotelEvent } | { ok: false; reason: string } {
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return { ok: false, reason: "not valid JSON" }; }
  const r = incoming.safeParse(json);
  return r.success ? { ok: true, event: r.data } : { ok: false, reason: r.error.issues[0]?.message ?? "unknown shape" };
}

export const mediaMsg = (pcm: Buffer) => JSON.stringify({ event: "media", media: { payload: pcm.toString("base64") } });
export const markMsg = (name: string) => JSON.stringify({ event: "mark", mark: { name } });
export const clearMsg = (streamSid: string) => JSON.stringify({ event: "clear", stream_sid: streamSid });

/** Split PCM into frames that obey Exotel's rules: multiple of 320 bytes, >= 3200 (zero-pad the tail). */
export function frame(pcm: Buffer, frameBytes = MIN_CHUNK): Buffer[] {
  if (frameBytes < MIN_CHUNK || frameBytes > MAX_CHUNK || frameBytes % CHUNK_UNIT !== 0) {
    throw new Error(`frameBytes must be a multiple of 320 between ${MIN_CHUNK} and ${MAX_CHUNK}`);
  }
  const out: Buffer[] = [];
  for (let i = 0; i < pcm.length; i += frameBytes) {
    const part = pcm.subarray(i, i + frameBytes);
    if (part.length === frameBytes) out.push(Buffer.from(part));
    else {
      const padded = Buffer.alloc(Math.max(MIN_CHUNK, Math.ceil(part.length / CHUNK_UNIT) * CHUNK_UNIT));
      part.copy(padded);
      out.push(padded);
    }
  }
  return out;
}

/** Placeholder "greeting": a short two-tone chime. Real speech arrives with TTS in P2. */
export function chime(ms = 1200): Buffer {
  const n = Math.floor((SAMPLE_RATE * ms) / 1000);
  const buf = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const f = t < ms / 2000 ? 660 : 880;
    const env = Math.min(1, i / 400, (n - i) / 400);
    buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * f * t) * 9000 * env), i * 2);
  }
  return buf;
}
