import crypto from "node:crypto";

/** HMAC-SHA256 hex over the exact raw body, per docs.kapso.ai webhooks overview. */
export function verifySignature(rawBody: string, signature: string | undefined, secret: string): boolean {
  if (typeof signature !== "string") return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8"), b = Buffer.from(signature, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** What the agent needs from a WhatsApp provider. Keeps Kapso replaceable (and the agent testable). */
export interface WaSender {
  sendText(to: string, body: string): Promise<void>;
  sendButtons(to: string, body: string, buttons: { id: string; title: string }[]): Promise<void>;
  sendVoice(to: string, ogg: Buffer): Promise<void>;
  markRead(messageId: string): Promise<void>;
}

export class WaApiError extends Error {
  constructor(public status: number, public body: string, what: string) { super(`Kapso ${what} failed (${status}): ${body.slice(0, 400)}`); }
}

export class KapsoClient implements WaSender {
  constructor(private o: { apiKey: string; phoneNumberId: string; baseUrl: string }) {}
  private get base() { return `${this.o.baseUrl.replace(/\/$/, "")}/meta/whatsapp/v24.0/${this.o.phoneNumberId}`; }

  private async post(path: string, body: unknown, what: string): Promise<unknown> {
    const res = await fetch(`${this.base}/${path}`, { method: "POST", headers: { "X-API-Key": this.o.apiKey, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) throw new WaApiError(res.status, text, what);
    try { return JSON.parse(text); } catch { return text; }
  }
  private msg(to: string, rest: Record<string, unknown>) { return { messaging_product: "whatsapp", recipient_type: "individual", to, ...rest }; }

  async sendText(to: string, body: string) { await this.post("messages", this.msg(to, { type: "text", text: { body: body.slice(0, 4000) } }), "send text"); }

  async sendButtons(to: string, body: string, buttons: { id: string; title: string }[]) {
    await this.post("messages", this.msg(to, { type: "interactive", interactive: { type: "button", body: { text: body.slice(0, 1000) }, action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) } })) } } }), "send buttons");
  }

  /** Voice notes must be OGG with the Opus codec (docs.kapso.ai send-messages/audio). Upload first, then send by media id. */
  async sendVoice(to: string, ogg: Buffer) {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", "audio/ogg");
    form.append("file", new Blob([new Uint8Array(ogg)], { type: "audio/ogg" }), "voice.ogg");
    const up = await fetch(`${this.base}/media`, { method: "POST", headers: { "X-API-Key": this.o.apiKey }, body: form });
    const upText = await up.text();
    if (!up.ok) throw new WaApiError(up.status, upText, "upload voice note");
    const id = (JSON.parse(upText) as { id?: string }).id;
    if (!id) throw new WaApiError(up.status, upText, "upload voice note (no media id)");
    await this.post("messages", this.msg(to, { type: "audio", audio: { id, voice: true } }), "send voice note");
  }

  /** Marks the message read and shows "typing…" to the customer (best effort). */
  async markRead(messageId: string) {
    try { await this.post("messages", { messaging_product: "whatsapp", status: "read", message_id: messageId, typing_indicator: { type: "text" } }, "mark read"); }
    catch { /* cosmetic only */ }
  }
}

/** Registers our webhook on the connected number (docs.kapso.ai webhooks overview). */
export async function registerWebhook(o: { apiKey: string; baseUrl: string; phoneNumberId: string; url: string; secret: string }) {
  const res = await fetch(`${o.baseUrl.replace(/\/$/, "")}/platform/v1/whatsapp/phone_numbers/${o.phoneNumberId}/webhooks`, {
    method: "POST", headers: { "X-API-Key": o.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ whatsapp_webhook: { kind: "kapso", url: o.url, events: ["whatsapp.message.received"], secret_key: o.secret } }),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}
