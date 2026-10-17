import { NextResponse } from "next/server";
import { z } from "zod";
import { getTTSProvider } from "@/lib/tts";
import { limited } from "@/lib/demo/limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ text: z.string().min(1).max(600), lang: z.enum(["en", "hi"]) });

export async function POST(req: Request) {
  const tts = getTTSProvider();
  if (!tts) return NextResponse.json({ error: "browser-voice" }, { status: 501 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (limited("tts:" + ip, 40)) return NextResponse.json({ error: "rate" }, { status: 429 });
  const raw = await req.text();
  let parsed; try { parsed = body.safeParse(JSON.parse(raw)); } catch { parsed = null; }
  if (!parsed?.success) { console.error("[demo/tts] malformed request body:", raw.slice(0, 1000)); return NextResponse.json({ error: "bad" }, { status: 400 }); }
  try {
    const { audio, contentType } = await tts.synth(parsed.data.text, parsed.data.lang);
    return new Response(audio, { headers: { "Content-Type": contentType, "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[demo/tts] error:", (e as Error).message);
    return NextResponse.json({ error: "tts-failed" }, { status: 502 });
  }
}
