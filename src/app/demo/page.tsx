import { cleanBiz, resolvePersona } from "@/lib/demo/personas";
import CallDemo from "./CallDemo";
import { asPreset, asVoiceId } from "@/lib/demo/voices";

export const metadata = { title: "Talk to our AI assistant" };

export default function DemoPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const one = (k: string) => (Array.isArray(searchParams[k]) ? searchParams[k]![0] : (searchParams[k] as string | undefined));
  const { key, persona } = resolvePersona(one("v"));
  const biz = cleanBiz(one("biz"), persona.defaultBiz);
  const l = one("lang") ?? "";
  const initialLang = l.toLowerCase().startsWith("hi") ? "hi" : "en";
  const enAccent = /^en-[A-Z]{2}$/.test(l) ? l : "en-IN";
  const openings = { en: persona.opening(biz, "en"), hi: persona.opening(biz, "hi") };
  return <CallDemo vertical={key} biz={biz} agentName={persona.agentName} openings={openings} enAccent={enAccent} initialLang={initialLang} voice={asPreset(one("voice"))} vid={asVoiceId(one("vid"))} engine={one("engine") === "server" ? "server" : "puter"} model={/^[\w.\-\/:]{1,60}$/.test(one("model") ?? "") ? (one("model") as string) : "gpt-5.4-nano"} />;
}
