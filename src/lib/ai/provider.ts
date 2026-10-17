export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
export interface AIProvider { reply(messages: ChatMessage[]): Promise<string> }

export class GroqProvider implements AIProvider {
  constructor(private apiKey: string, private model: string) {}

  private async call(messages: ChatMessage[], maxTokens: number): Promise<{ text: string; raw: string }> {
    // gpt-oss models think before answering, and the thinking counts toward the token limit.
    // Low effort plus a roomy limit stops the thinking from using up the whole reply.
    const body: Record<string, unknown> = { model: this.model, messages, temperature: 0.5, max_completion_tokens: maxTokens };
    if (this.model.startsWith('openai/gpt-oss')) { body.reasoning_effort = 'low'; body.include_reasoning = false; }
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + this.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const raw = await res.text();
    if (!res.ok) throw new Error('Groq ' + res.status + ': ' + raw.slice(0, 500));
    const out = JSON.parse(raw)?.choices?.[0]?.message?.content;
    return { text: typeof out === 'string' ? out.trim() : '', raw };
  }

  async reply(messages: ChatMessage[]): Promise<string> {
    let r = await this.call(messages, 1500);
    if (!r.text) r = await this.call(messages, 4000); // one retry with a bigger allowance
    if (!r.text) throw new Error('Groq returned no text: ' + r.raw.slice(0, 500));
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
