import { cleanBiz, PERSONAS } from "@/lib/demo/personas";
import ChatDemo from "./ChatDemo";
import { asPreset, asVoiceId } from "@/lib/demo/voices";

export const metadata = { title: "Chat with our AI assistant" };

export default function ChatPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const one = (k: string) => (Array.isArray(searchParams[k]) ? searchParams[k]![0] : (searchParams[k] as string | undefined));
  const biz = cleanBiz(one("biz"), PERSONAS.realestate.defaultBiz);
  const model = /^[\w.\-\/:]{1,60}$/.test(one("model") ?? "") ? (one("model") as string) : "gpt-5.4-nano";
  return <ChatDemo biz={biz} engine={one("engine") === "server" ? "server" : "puter"} model={model} voice={asPreset(one("voice"))} vid={asVoiceId(one("vid"))} />;
}
