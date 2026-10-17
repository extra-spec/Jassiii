export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
export interface AIProvider { reply(messages: ChatMessage[]): Promise<string> }

export class ToolCallFailed extends Error {
  constructor(public recovered: string, public raw: string) { super("Groq tool_use_failed: " + raw.slice(0, 300)); }
}

/** If the model tried to "call a tool" instead of answering, keep any customer details it wrote and ask a safe follow-up question. */
export function recoveredReply(failed: string): string {
  let args: Record<string, unknown> = {};
  try { const j = JSON.parse(failed); args = (j && typeof j === "object" ? (j.arguments ?? j) : {}) as Record<string, unknown>; } catch { /* ignore */ }
  const pairs = Object.entries(args).filter(([, v]) => typeof v === "string" || typeof v === "number").map(([k, v]) => k + "=" + String(v).replace(/[|<>]/g, " ")).join(" | ");
  return "Thanks, I have noted that. Could you tell me a little more about what you are looking for?" + (pairs ? "\n<<LEAD " + pairs + ">>" : "");
}

const NO_TOOLS = "IMPORTANT: answer with a normal plain-text message only. Never call a function or tool. Hidden notes must be plain text such as <<LEAD name=... | intent=...>> at the very end of your message.";

export class GroqProvider implements AIProvider {
  constructor(private apiKey: string, private model: string) {}

  private async call(messages: ChatMessage[], maxTokens: number, extraSystem?: string): Promise<{ text: string; raw: string }> {
    // gpt-oss models think before answering, and the thinking counts toward the token limit.
    // Low effort plus a roomy limit stops the thinking from using up the whole reply.
    const msgs: ChatMessage[] = extraSystem ? [...messages, { role: "system", content: extraSystem }] : messages;
    const body: Record<string, unknown> = { model: this.model, messages: msgs, temperature: 0.5, max_completion_tokens: maxTokens };
    if (this.model.startsWith("openai/gpt-oss")) { body.reasoning_effort = "low"; body.include_reasoning = false; }
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", headers: { Authorization: "Bearer " + this.apiKey, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const raw = await res.text();
    if (!res.ok) {
      let code = "", failed = "";
      try { const j = JSON.parse(raw); code = j?.error?.code ?? ""; failed = j?.error?.failed_generation ?? ""; } catch { /* not JSON */ }
      if (res.status === 400 && code === "tool_use_failed") throw new ToolCallFailed(String(failed), raw);
      throw new Error("Groq " + res.status + ": " + raw.slice(0, 500));
    }
    const out = JSON.parse(raw)?.choices?.[0]?.message?.content;
    return { text: typeof out === "string" ? out.trim() : "", raw };
  }

  async reply(messages: ChatMessage[]): Promise<string> {
    let r: { text: string; raw: string };
    try { r = await this.call(messages, 1500); }
    catch (e) {
      if (!(e instanceof ToolCallFailed)) throw e;
      try { r = await this.call(messages, 1500, NO_TOOLS); }
      catch (e2) { if (e2 instanceof ToolCallFailed) return recoveredReply(e2.recovered || e.recovered); throw e2; }
    }
    if (!r.text) r = await this.call(messages, 4000); // one retry with a bigger allowance
    if (!r.text) throw new Error("Groq returned no text: " + r.raw.slice(0, 500));
    return r.text;
  }
}

/** Offline stand-in so the page and route can be tested without a key. Not used in the real demo. */
export class MockProvider implements AIProvider {
  async reply(messages: ChatMessage[]): Promise<string> {
    const last = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    return `(mock reply) You said: ${last.slice(0, 80)}`;
  }
}
