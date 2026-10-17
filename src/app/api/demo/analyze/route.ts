import { NextResponse } from "next/server";
import { z } from "zod";
import { getAIProvider } from "@/lib/ai";
import { buildAnalysisMessages } from "@/lib/demo/analysis";
import { cleanBiz, resolvePersona } from "@/lib/demo/personas";
import { limited } from "@/lib/demo/limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  vertical: z.string().optional(), biz: z.string().optional(),
  transcript: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(1500) })).min(1).max(60),
});

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (limited("analyze:" + ip, 10)) return NextResponse.json({ error: "rate" }, { status: 429 });
  const raw = await req.text();
  let parsed; try { parsed = body.safeParse(JSON.parse(raw)); } catch { parsed = null; }
  if (!parsed?.success) { console.error("[demo/analyze] malformed request body:", raw.slice(0, 2000)); return NextResponse.json({ error: "bad" }, { status: 400 }); }
  const { key, persona } = resolvePersona(parsed.data.vertical);
  try {
    const text = await getAIProvider().reply(buildAnalysisMessages(parsed.data.transcript, cleanBiz(parsed.data.biz, persona.defaultBiz), key));
    return NextResponse.json({ text });
  } catch (e) { console.error("[demo/analyze] AI error:", (e as Error).message); return NextResponse.json({ error: "unavailable" }, { status: 502 }); }
}
