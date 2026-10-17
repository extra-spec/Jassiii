import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Db } from "../src/lib/db";
import { loadWhatsAppEnv, loadEnv } from "../src/lib/env";
import { verifySignature, type WaSender } from "../src/whatsapp/kapso";
import { parseInbound } from "../src/whatsapp/inbound";
import { WaRepo } from "../src/whatsapp/repo";
import { WhatsAppAgent } from "../src/whatsapp/agent";
import { isReportDue, buildWaReport } from "../src/whatsapp/report";
import type { AIProvider } from "../src/lib/ai/provider";

const sign = (raw: string, secret: string) => crypto.createHmac("sha256", secret).update(raw).digest("hex");
const recv = (over: Record<string, unknown>, conv: Record<string, unknown> = { contact_name: "Neha", phone_number: "919811100001" }) => ({ message: { id: "wamid.1", timestamp: "1730092800", type: "text", from: "919811100001", text: { body: "hi" }, kapso: { direction: "inbound" }, ...over }, conversation: conv, phone_number_id: "1446197948568307" });

class FakeSend implements WaSender {
  sent: { kind: string; to: string; body?: string }[] = []; failTo?: string; failVoice = false;
  async sendText(to: string, body: string) { if (to === this.failTo) throw new Error("131047 window closed"); this.sent.push({ kind: "text", to, body }); }
  async sendButtons(to: string, body: string) { this.sent.push({ kind: "buttons", to, body }); }
  async sendVoice(to: string) { if (this.failVoice) throw new Error("upload failed"); this.sent.push({ kind: "voice", to }); }
  async markRead() { /* ok */ }
}
const scripted = (...replies: string[]): AIProvider & { calls: number } => { const q = [...replies]; const a = { calls: 0, async reply() { a.calls++; return q.shift() ?? "ok"; } }; return a; };
const setup = (ai: AIProvider, over: Partial<ConstructorParameters<typeof WhatsAppAgent>[0]> = {}) => {
  const repo = new WaRepo(new Db(":memory:")); const send = new FakeSend();
  const agent = new WhatsAppAgent({ repo, ai, send, biz: "Skyline", agentPhone: "919900000000", log: () => {}, ...over });
  return { repo, send, agent };
};
const inbound = (o: Record<string, unknown> = {}) => parseInbound("whatsapp.message.received", recv(o)).messages[0];

test("signature: valid, wrong secret, missing, tampered body", () => {
  const raw = '{"a":1}';
  assert.ok(verifySignature(raw, sign(raw, "s3cret-s3cret-s3cret"), "s3cret-s3cret-s3cret"));
  assert.ok(!verifySignature(raw, sign(raw, "other"), "s3cret-s3cret-s3cret")); assert.ok(!verifySignature(raw, undefined, "x")); assert.ok(!verifySignature(raw + " ", sign(raw, "k"), "k"));
});

test("parse: text, button, audio with/without transcript, batch, skips", () => {
  assert.equal(inbound().text, "hi");
  const b = inbound({ type: "interactive", interactive: { type: "button_reply", button_reply: { id: "visit:p1", title: "Book a visit" } } });
  assert.equal(b.kind, "button"); assert.equal(b.buttonId, "visit:p1");
  assert.equal(inbound({ type: "audio", audio: { id: "m" }, kapso: { direction: "inbound", transcript: { text: "mujhe flat chahiye" } } }).transcript, "mujhe flat chahiye");
  assert.equal(inbound({ type: "audio", kapso: { direction: "inbound" } }).transcript, undefined);
  assert.equal(inbound({ type: "image" }).kind, "other");
  const batch = parseInbound("whatsapp.message.received", { type: "whatsapp.message.received", batch: true, data: [recv({ id: "a" }), recv({ id: "b" })] });
  assert.deepEqual(batch.messages.map((m) => m.id), ["a", "b"]);
  assert.equal(parseInbound("whatsapp.message.sent", recv({})).messages.length, 0);
  assert.equal(parseInbound("whatsapp.message.received", recv({ kapso: { direction: "outbound" } })).messages.length, 0);
  assert.equal(parseInbound("whatsapp.message.received", recv({ from: undefined }, { business_scoped_user_id: "US.1" })).messages.length, 0); // BSUID-only: no phone to reply to
  assert.equal(parseInbound("whatsapp.message.received", "garbage").messages.length, 0);
});

test("customer flow: reply, lead saved from tag, property card, one agent alert, phone only from metadata", async () => {
  const ai = scripted('Great choice! I have one in Bandra.\n[[property:p1]]\n[[lead:{"name":"Neha","intent":"buy","budget":"2.5 Cr","phone":"123"}]]', 'Noted Thursday evening.\n[[lead:{"visit_time":"Thursday evening"}]]', "Anything else?\n[[lead:{\"visit_time\":\"Thursday evening\"}]]");
  const { agent, repo, send } = setup(ai);
  await agent.handle(inbound());
  assert.equal(send.sent[0].body, "Great choice! I have one in Bandra."); assert.equal(send.sent[1].kind, "buttons"); assert.match(send.sent[1].body!, /Bandra West/);
  assert.ok(send.sent.every((s) => s.to === "919811100001")); // never a number from the model
  let lead = repo.getLead("919811100001")!; assert.equal(lead.name, "Neha"); assert.equal(lead.intent, "buy"); assert.equal(lead.phone, "919811100001");
  assert.equal(send.sent.filter((s) => s.to === "919900000000").length, 0);
  await agent.handle(inbound({ id: "wamid.2", text: { body: "Thursday evening works" } }));
  const alerts = send.sent.filter((s) => s.to === "919900000000"); assert.equal(alerts.length, 1); assert.match(alerts[0].body!, /Neha/); assert.match(alerts[0].body!, /\+919811100001/); assert.match(alerts[0].body!, /Thursday evening/);
  await agent.handle(inbound({ id: "wamid.3", text: { body: "ok thanks" } }));
  assert.equal(send.sent.filter((s) => s.to === "919900000000").length, 1, "agent is alerted once per lead");
  lead = repo.getLead("919811100001")!; assert.equal(lead.alerted, 1);
});

test("duplicate webhook (same message id) is answered once", async () => {
  const ai = scripted("Hello!"); const { agent, send } = setup(ai);
  await agent.handle(inbound()); await agent.handle(inbound());
  assert.equal(ai.calls, 1); assert.equal(send.sent.length, 1);
});

test("history reaches the AI (voice notes marked); button replies become real questions", async () => {
  const seen: string[][] = []; const ai: AIProvider = { async reply(m) { seen.push(m.map((x) => `${x.role}:${x.content}`)); return "ok"; } };
  const { agent } = setup(ai);
  await agent.handle(inbound({ text: { body: "I want a flat" } }));
  await agent.handle(inbound({ id: "v1", type: "audio", kapso: { direction: "inbound", transcript: { text: "budget 2 crore" } } }));
  assert.ok(seen[1].some((l) => l === "user:[Voice note] budget 2 crore")); assert.ok(seen[1].some((l) => l === "assistant:ok"));
  await agent.handle(inbound({ id: "b1", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "visit:p1", title: "Book a visit" } } }));
  assert.ok(seen[2].some((l) => l.includes("I'd like to visit the 2 BHK Apartment in Bandra West")));
});

test("voice note in -> voice note out; falls back to text when voice fails; no voice engine -> text", async () => {
  const v = setup(scripted("Sure, one moment."), { voice: async () => Buffer.from("ogg") });
  await v.agent.handle(inbound({ type: "audio", kapso: { direction: "inbound", transcript: { text: "hello" } } }));
  assert.equal(v.send.sent[0].kind, "voice"); assert.equal(v.repo.getLead("919811100001")!.voice_notes, 1);
  const f = setup(scripted("Sure."), { voice: async () => Buffer.from("ogg") }); f.send.failVoice = true;
  await f.agent.handle(inbound({ type: "audio", kapso: { direction: "inbound", transcript: { text: "hello" } } }));
  assert.equal(f.send.sent[0].kind, "text");
  const t = setup(scripted("Sure.")); await t.agent.handle(inbound({ type: "audio", kapso: { direction: "inbound", transcript: { text: "hello" } } })); assert.equal(t.send.sent[0].kind, "text");
  const typed = setup(scripted("Sure."), { voice: async () => Buffer.from("ogg") }); await typed.agent.handle(inbound()); assert.equal(typed.send.sent[0].kind, "text", "typed messages get text replies");
});

test("unreadable messages, STOP, AI failure never crash", async () => {
  const ai = scripted(); const { agent, send, repo } = setup(ai);
  await agent.handle(inbound({ id: "i1", type: "image" })); assert.match(send.sent[0].body!, /text and voice notes/);
  await agent.handle(inbound({ id: "a1", type: "audio", kapso: { direction: "inbound" } })); assert.match(send.sent[1].body!, /couldn't hear/);
  await agent.handle(inbound({ id: "s1", text: { body: "STOP" } })); assert.match(send.sent[2].body!, /won't get further/); assert.equal(repo.getLead("919811100001")!.opted_out, 1);
  assert.equal(ai.calls, 0);
  const bad = setup({ async reply() { throw new Error("groq down"); } }); await bad.agent.handle(inbound()); assert.match(bad.send.sent[0].body!, /trouble replying/);
});

test("agent commands and a closed window do not break the customer flow", async () => {
  const { agent, send, repo } = setup(scripted('Booked it.\n[[lead:{"name":"Neha","intent":"buy","visit_time":"Friday"}]]'));
  send.failTo = "919900000000"; // agent's 24h window closed
  await agent.handle(inbound());
  assert.equal(send.sent.length, 1); assert.equal(repo.getLead("919811100001")!.alerted, 0, "not marked alerted when the alert failed");
  send.failTo = undefined;
  await agent.handle(parseInbound("whatsapp.message.received", recv({ id: "ag1", from: "919900000000", text: { body: "Report" } }, {})).messages[0]);
  assert.match(send.sent.at(-1)!.body!, /Daily report · Skyline/); assert.equal(send.sent.at(-1)!.to, "919900000000");
  await agent.handle(parseInbound("whatsapp.message.received", recv({ id: "ag2", from: "919900000000", text: { body: "leads" } }, {})).messages[0]);
  assert.match(send.sent.at(-1)!.body!, /Neha/);
  await agent.handle(parseInbound("whatsapp.message.received", recv({ id: "ag3", from: "919900000000", text: { body: "help" } }, {})).messages[0]);
  assert.match(send.sent.at(-1)!.body!, /report/);
});

test("daily report is built from stored chats; due-time logic is once per local day", async () => {
  const { agent, repo } = setup(scripted('Done.\n[[lead:{"name":"Neha","intent":"buy","visit_time":"Thu"}]]'));
  await agent.handle(inbound({ type: "audio", kapso: { direction: "inbound", transcript: { text: "2 bhk" } } }));
  const r = buildWaReport(repo, "Skyline"); assert.equal(r.stats.chats, 1); assert.equal(r.stats.voiceNotes, 1); assert.equal(r.stats.visits, 1); assert.match(r.text, /\*Neha\*/);
  const t = Date.UTC(2026, 9, 20, 14, 31); // 20:01 in India
  assert.equal(isReportDue(t, "Asia/Kolkata", "20:00", undefined).due, true);
  assert.equal(isReportDue(t, "Asia/Kolkata", "20:00", isReportDue(t, "Asia/Kolkata", "20:00", undefined).today).due, false);
  assert.equal(isReportDue(Date.UTC(2026, 9, 20, 13, 0), "Asia/Kolkata", "20:00", undefined).due, false);
});

test("whatsapp env: optional, friendly errors, agent number normalised", () => {
  assert.equal(loadWhatsAppEnv({ AI_PROVIDER: "mock" } as unknown as NodeJS.ProcessEnv), null);
  assert.throws(() => loadWhatsAppEnv({ AI_PROVIDER: "mock", KAPSO_API_KEY: "abcdefghijk" } as unknown as NodeJS.ProcessEnv), /KAPSO_PHONE_NUMBER_ID/);
  const e = loadWhatsAppEnv({ AI_PROVIDER: "mock", KAPSO_API_KEY: "abcdefghijk", KAPSO_PHONE_NUMBER_ID: "1446197948568307", KAPSO_WEBHOOK_SECRET: "0123456789abcdef", AGENT_PHONE: "+91 98765-43210" } as unknown as NodeJS.ProcessEnv)!;
  assert.equal(e.AGENT_PHONE, "919876543210"); assert.equal(e.KAPSO_API_BASE, "https://api.kapso.ai"); assert.equal(e.DAILY_REPORT_TIME, "20:00");
  assert.throws(() => loadWhatsAppEnv({ AI_PROVIDER: "mock", KAPSO_API_KEY: "abcdefghijk", KAPSO_PHONE_NUMBER_ID: "1446197948568307", KAPSO_WEBHOOK_SECRET: "0123456789abcdef", AGENT_PHONE: "12" } as unknown as NodeJS.ProcessEnv), /AGENT_PHONE/);
  assert.equal(loadEnv === undefined, false);
});

test("one phone can be both agent and tester: normal sentences are a customer chat, one-word commands are commands", async () => {
  const { agent, send, repo } = setup(scripted("Happy to help! Which area?"), { agentPhone: "919811100001" });
  await agent.handle(inbound({ text: { body: "I want a 2 BHK today" } }));
  assert.equal(send.sent[0].body, "Happy to help! Which area?"); assert.ok(repo.getLead("919811100001"));
  await agent.handle(inbound({ id: "c2", text: { body: "report" } }));
  assert.match(send.sent.at(-1)!.body!, /Daily report/);
});
import { createWhatsApp } from "../src/whatsapp";
test("webhook auth: valid signature, or ?key= when Kapso sends no signature; wrong or mixed credentials rejected", () => {
  const SECRET = "0123456789abcdef0123";
  const env = loadWhatsAppEnv({ AI_PROVIDER: "mock", KAPSO_API_KEY: "abcdefghijk", KAPSO_PHONE_NUMBER_ID: "597907523413541", KAPSO_WEBHOOK_SECRET: SECRET } as unknown as NodeJS.ProcessEnv)!;
  const wa = createWhatsApp(env, new Db(":memory:"), scripted("ok"), new FakeSend());
  const raw = JSON.stringify(recv({ id: "auth1" })); const ev = { "x-webhook-event": "whatsapp.message.received" };
  assert.equal(wa.handleWebhook(raw, { ...ev, "x-webhook-signature": sign(raw, SECRET) }).status, 200);
  assert.equal(wa.handleWebhook(raw, { ...ev, "x-webhook-signature": "bad" }).status, 401);
  assert.equal(wa.handleWebhook(raw, ev).status, 401);
  assert.equal(wa.handleWebhook(raw, ev, "wrong-key").status, 401);
  assert.equal(wa.handleWebhook(raw, ev, SECRET).status, 200);
  assert.equal(wa.handleWebhook(raw, { ...ev, "x-webhook-signature": "bad" }, SECRET).status, 401, "a wrong signature is never rescued by the URL key");
  assert.equal(wa.handleWebhook("not json", ev, SECRET).status, 400);
});
