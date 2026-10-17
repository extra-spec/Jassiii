import { NextResponse } from "next/server";
import { z } from "zod";
import { getAIProvider } from "@/lib/ai";
import { limited } from "@/lib/demo/limit";
import { ttsIsExpressive } from "@/lib/tts";
import { chatInstructions } from "@/lib/demo/chatbot";
import { asLang, cleanBiz, resolvePersona } from "@/lib/demo/personas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  vertical: z.string().optional(),
  biz: z.string().optional(),
  lang: z.string().optional(),
  channel: z.enum(["voice", "chat"]).optional(),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(1000) })).min(1).max(40),
});

export async function POST(req: Request) {
  const raw = await req.text();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (limited("chat:" + ip, 30)) return NextResponse.json({ error: "Too many requests, please wait a moment." }, { status: 429 });
  let parsed;
  try { parsed = body.safeParse(JSON.parse(raw)); } catch { parsed = null; }
  if (!parsed?.success) { console.error("[demo/chat] malformed request body:", raw.slice(0, 2000)); return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const { key, persona } = resolvePersona(parsed.data.vertical);
  const biz = cleanBiz(parsed.data.biz, persona.defaultBiz);
  try {
    const system = parsed.data.channel === "chat" ? chatInstructions(biz) : persona.instructions(biz, asLang(parsed.data.lang), ttsIsExpressive());
    const reply = await getAIProvider().reply([{ role: "system", content: system }, ...parsed.data.messages.slice(-16)]);
    return NextResponse.json({ reply, vertical: key });
  } catch (e) {
    console.error("[demo/chat] AI error:", (e as Error).message);
    return NextResponse.json({ error: "The assistant is unavailable right now." }, { status: 502 });
  }
}
