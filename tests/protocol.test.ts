import { test } from "node:test";
import assert from "node:assert/strict";
import { frame, parseEvent, chime, clearMsg } from "../src/telephony/exotel/protocol";
import { Db, normalize } from "../src/lib/db";
import { CallsRepo } from "../src/lib/db/calls.repo";
import { loadEnv, loadCoreEnv, loadExotelEnv } from "../src/lib/env";
import { isAuthorized } from "../src/telephony/exotel/auth";
import { parseStatusBody, callIdFromCustomField } from "../src/telephony/exotel/status";

test("frames are multiples of 320 and >= 3200", () => {
  for (const f of frame(chime(1234))) { assert.equal(f.length % 320, 0); assert.ok(f.length >= 3200); }
  assert.throws(() => frame(Buffer.alloc(10), 4096));
});
test("parseEvent tolerates garbage", () => {
  assert.equal(parseEvent("nope").ok, false);
  assert.equal(parseEvent('{"event":"wat"}').ok, false);
  assert.equal(parseEvent('{"event":"stop"}').ok, true);
  assert.equal(parseEvent('{"event":"media","media":{"payload":"AA==","chunk":2}}').ok, true);
});
test("clear message shape", () => assert.deepEqual(JSON.parse(clearMsg("MZ1")), { event: "clear", stream_sid: "MZ1" }));
test("sqlite undefined -> null", () => {
  assert.deepEqual(normalize([undefined, 1, "a", true]), [null, 1, "a", 1]);
  const calls = new CallsRepo(new Db(":memory:"));
  const id = calls.create({ direction: "INBOUND", from: undefined, to: undefined });
  assert.ok(id > 0);
  calls.attachStream(id, undefined, undefined);
});
test("env fails in plain language", () => {
  assert.throws(() => loadEnv({} as NodeJS.ProcessEnv), /cannot start/);
  const ok = loadEnv({ AI_PROVIDER: "mock", PUBLIC_BASE_URL: "https://a.b", EXOTEL_ACCOUNT_SID: "x", EXOTEL_API_KEY: "k", EXOTEL_API_TOKEN: "t", EXOTEL_CALLER_ID: "+918012345678", EXOTEL_WS_PASSWORD: "123456789012" } as unknown as NodeJS.ProcessEnv);
  assert.equal(ok.PORT, 3000);
});
test("auth: key or basic", () => {
  assert.ok(isAuthorized(undefined, new URLSearchParams("key=pw"), "u", "pw"));
  assert.ok(isAuthorized("Basic " + Buffer.from("u:pw").toString("base64"), new URLSearchParams(), "u", "pw"));
  assert.ok(!isAuthorized(undefined, new URLSearchParams("key=bad"), "u", "pw"));
});
test("status parsing", () => {
  const p = parseStatusBody("CallSid=abc&Status=completed&RecordingUrl=https%3A%2F%2Fx%2Fr.mp3&CustomField=callId%3D7", "application/x-www-form-urlencoded");
  assert.equal(p.callSid, "abc"); assert.equal(p.recordingUrl, "https://x/r.mp3"); assert.equal(callIdFromCustomField(p.customField), 7);
});

test("demo mode needs only a Groq key; Exotel optional", () => {
  assert.throws(() => loadCoreEnv({ AI_PROVIDER: "groq" } as unknown as NodeJS.ProcessEnv), /GROQ_API_KEY/);
  assert.equal(loadCoreEnv({} as unknown as NodeJS.ProcessEnv).AI_PROVIDER, "mock");
  assert.ok(loadCoreEnv({ GROQ_API_KEY: "k" } as unknown as NodeJS.ProcessEnv));
  assert.equal(loadExotelEnv({ GROQ_API_KEY: "k" } as unknown as NodeJS.ProcessEnv), null);
  assert.throws(() => loadExotelEnv({ EXOTEL_API_KEY: "x" } as unknown as NodeJS.ProcessEnv), /cannot start/);
});
import { resolvePersona, cleanBiz } from "../src/lib/demo/personas";
import { GroqProvider } from "../src/lib/ai/provider";
test("personas: opening discloses AI; biz name sanitised", () => {
  for (const v of ["realestate", "plumbing"]) assert.match(resolvePersona(v).persona.opening("X", "en"), /AI assistant/);
  assert.equal(cleanBiz("<script>Joe's Plumbing</script>", "d"), "scriptJoe's Plumbingscript");
  assert.equal(cleanBiz(undefined, "fallback"), "fallback");
});
test("Groq provider parses a reply and surfaces errors", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: " hi " } }] }))) as typeof fetch;
  assert.equal(await new GroqProvider("k", "m").reply([{ role: "user", content: "x" }]), "hi");
  globalThis.fetch = (async () => new Response("nope", { status: 401 })) as typeof fetch;
  await assert.rejects(new GroqProvider("k", "m").reply([{ role: "user", content: "x" }]), /Groq 401/);
  globalThis.fetch = real;
});
import { asLang } from "../src/lib/demo/personas";
test("hindi mode: Devanagari opening + Hindi instruction", () => {
  for (const v of ["realestate", "plumbing"]) {
    const { persona } = resolvePersona(v);
    assert.match(persona.opening("X", "hi"), /[\u0900-\u097F]/);
    assert.match(persona.opening("X", "hi"), /एआई/);
    assert.match(persona.instructions("X", "hi"), /LANGUAGE: HINDI/);
    assert.match(persona.instructions("X", "en"), /LANGUAGE: ENGLISH/);
  }
  assert.equal(asLang("hi"), "hi"); assert.equal(asLang("zz"), "en");
});
import { ElevenLabsTTS, stripTags } from "../src/lib/tts/provider";
test("tts: tags stripped; elevenlabs request shape; env requires voices", async () => {
  assert.equal(stripTags("[warmly] Hello  there [short pause] ji"), "Hello there ji");
  assert.throws(() => loadCoreEnv({ AI_PROVIDER: "mock", TTS_PROVIDER: "elevenlabs" } as unknown as NodeJS.ProcessEnv), /ELEVENLABS_API_KEY/);
  const real = globalThis.fetch; let seen: { url: string; init: RequestInit } | undefined;
  globalThis.fetch = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } }); }) as unknown as typeof fetch;
  const out = await new ElevenLabsTTS("K", "eleven_flash_v2_5", { en: "VEN", hi: "VHI" }).synth("hi", "hi");
  assert.match(seen!.url, /text-to-speech\/VHI/); assert.equal((seen!.init.headers as Record<string, string>)["xi-api-key"], "K");
  assert.equal(JSON.parse(seen!.init.body as string).model_id, "eleven_flash_v2_5"); assert.equal(out.audio.byteLength, 3);
  globalThis.fetch = real;
});
import { GoogleTTS } from "../src/lib/tts/provider";
test("google tts: request shape, language derived from voice, base64 decoded", async () => {
  const real = globalThis.fetch; let seen: { url: string; body: any } | undefined;
  globalThis.fetch = (async (url: string, init: RequestInit) => { seen = { url, body: JSON.parse(init.body as string) }; return new Response(JSON.stringify({ audioContent: Buffer.from([9, 8, 7, 6]).toString("base64") })); }) as unknown as typeof fetch;
  const g = new GoogleTTS("K", { en: "en-IN-Chirp3-HD-Aoede", hi: "hi-IN-Neural2-A" });
  const out = await g.synth("नमस्ते", "hi");
  assert.match(seen!.url, /text:synthesize\?key=K/); assert.equal(seen!.body.voice.languageCode, "hi-IN"); assert.equal(seen!.body.voice.name, "hi-IN-Neural2-A");
  assert.equal(seen!.body.audioConfig.audioEncoding, "MP3"); assert.deepEqual([...new Uint8Array(out.audio)], [9, 8, 7, 6]);
  await g.synth("hi", "en"); assert.equal(seen!.body.voice.languageCode, "en-IN");
  globalThis.fetch = (async () => new Response("bad voice", { status: 400 })) as unknown as typeof fetch;
  await assert.rejects(g.synth("x", "en"), /Google TTS 400/);
  assert.throws(() => loadCoreEnv({ AI_PROVIDER: "mock", TTS_PROVIDER: "google" } as unknown as NodeJS.ProcessEnv), /GOOGLE_TTS_API_KEY/);
  globalThis.fetch = real;
});
import { puterText } from "../src/lib/demo/puter";
test("puterText handles string, message.content string/array, junk", () => {
  assert.equal(puterText(" hi "), "hi");
  assert.equal(puterText({ message: { content: "yo" } }), "yo");
  assert.equal(puterText({ message: { content: [{ type: "text", text: "a" }, { text: "b" }] } }), "a b");
  assert.equal(puterText(null), ""); assert.equal(puterText({}), "");
});
test("company name keeps Hindi letters and marks, strips junk", () => {
  assert.equal(cleanBiz("स्काईलाइन रियल्टी", "d"), "स्काईलाइन रियल्टी");
  assert.equal(cleanBiz("Sharma & Sons <b>", "d"), "Sharma & Sons b");
  assert.equal(cleanBiz("   ", "Skyline"), "Skyline");
  assert.equal(cleanBiz("x".repeat(80), "d").length, 40);
});
import { parseAnalysis, buildAnalysisMessages } from "../src/lib/demo/analysis";
import { seedCalls, leadStatus, fmtDuration } from "../src/lib/demo/store";
test("analysis parsing: fenced JSON, nulls, junk", () => {
  const a = parseAnalysis('Sure!\n```json\n{"summary":"Wants a 2 BHK.","callerName":"Neha","intent":null,"requirement":"null","urgency":"weird","outcome":"booking_requested","sentiment":"positive"}\n```');
  assert.equal(a?.callerName, "Neha"); assert.equal(a?.intent, undefined); assert.equal(a?.requirement, undefined);
  assert.equal(a?.urgency, "low"); assert.equal(a?.outcome, "booking_requested"); assert.equal(leadStatus(a), "BOOKING_REQUESTED");
  assert.equal(parseAnalysis("no json here"), null); assert.equal(parseAnalysis('{"summary":""}'), null);
  const m = buildAnalysisMessages([{ role: "user", content: "hi" }], "X", "plumbing");
  assert.match(m[0].content, /never invent phone numbers/); assert.match(m[1].content, /Caller: hi/);
});
test("seed calls + duration format", () => {
  for (const v of ["realestate", "plumbing"] as const) { const s = seedCalls(v, "Biz"); assert.equal(s.length, 3); assert.ok(s.every((c) => c.sample && c.analysis && c.transcript.length)); }
  assert.equal(fmtDuration(187), "3m 07s"); assert.equal(fmtDuration(3720), "1h 2m");
});
import { ttsOptionChain, asPreset, asVoiceId } from "../src/lib/demo/voices";
test("voice presets: option chains, fallback last, input sanitised", () => {
  const g = ttsOptionChain("gemini", { vertical: "realestate", lang: "hi", speechLang: "hi-IN" });
  assert.equal(g[0].provider, "gemini"); assert.equal(g[0].voice, "Sulafat"); assert.match(String(g[0].instructions), /Hindi/);
  assert.equal(g[g.length - 1].provider, "aws-polly"); assert.equal(g[g.length - 1].voice, "Kajal");
  assert.equal(ttsOptionChain("gemini", { vertical: "plumbing", lang: "en", speechLang: "en-IN" })[0].voice, "Achird");
  assert.equal(ttsOptionChain("eleven", { vertical: "realestate", lang: "en", speechLang: "en-IN", vid: "abc123" })[0].voice, "abc123");
  assert.equal(ttsOptionChain("openai", { vertical: "realestate", lang: "en", speechLang: "en-IN" })[0].model, "gpt-4o-mini-tts");
  assert.equal(ttsOptionChain("polly", { vertical: "realestate", lang: "en", speechLang: "en-GB" }).length, 1);
  assert.equal(asPreset("nope"), "gemini"); assert.equal(asPreset("eleven"), "eleven");
  assert.equal(asVoiceId("a b"), undefined); assert.equal(asVoiceId("Kore"), "Kore");
});
import { PROPERTIES, chatInstructions, parseReply } from "../src/lib/demo/chatbot";
test("chatbot: catalog in prompt, property tags parsed and validated", () => {
  assert.ok(PROPERTIES.length >= 6);
  const ins = chatInstructions("Skyline");
  for (const p of PROPERTIES) assert.match(ins, new RegExp(p.id + ":"));
  const r = parseReply("Here you go!\n[[property:p1]]\n[[property:p99]]\n[[property:p1]]\n[[ property : p3 ]]\n[[property:p2]]");
  assert.deepEqual(r.ids, ["p1", "p3"]); assert.equal(r.text, "Here you go!");
  assert.deepEqual(parseReply("no cards").ids, []);
});
import { extractLeadTags, normalizeLead, analysisFromLead } from "../src/lib/demo/leads";
import { buildDailySummary } from "../src/lib/demo/summary";
import { seedAll } from "../src/lib/demo/store";
test("lead tags: stripped, normalised, merged; analysis rules", () => {
  const r = extractLeadTags('Sure, noted!\n[[lead:{"name":"Neha","intent":"BUY","budget":"2.5 Cr","visit_time":"Thursday evening","phone":"999"}]]\n[[lead:{"location":"Bandra","name":"null"}]]');
  assert.equal(r.text.trim(), "Sure, noted!"); assert.deepEqual(r.lead, { name: "Neha", intent: "buy", budget: "2.5 Cr", visitTime: "Thursday evening", location: "Bandra" });
  assert.equal((r.lead as unknown as Record<string, unknown>).phone, undefined);
  assert.equal(extractLeadTags("[[lead:{bad json}]] hi").text.trim(), "hi");
  assert.deepEqual(normalizeLead({ intent: "lease" }), {});
  assert.equal(analysisFromLead(r.lead, 2).outcome, "booking_requested"); assert.match(analysisFromLead(r.lead, 2).summary, /2 voice notes/);
  assert.equal(analysisFromLead({ name: "A", intent: "rent" }, 0).outcome, "callback_requested"); assert.equal(analysisFromLead({}, 0).outcome, "no_outcome");
  assert.match(parseReply('Hi\n[[property:p1]]\n[[lead:{"name":"Z"}]]').lead.name ?? "", /Z/);
});
test("daily summary: counts from seeded data, bold markers, hot leads", () => {
  const now = Date.now(); const { text, stats } = buildDailySummary(seedAll("realestate", "Skyline", now), "Skyline", now);
  assert.equal(stats.chats, 3); assert.ok(stats.conversations >= 6); assert.equal(stats.voiceNotes, 3); assert.ok(stats.visits >= 2);
  assert.match(text, /^\*Daily report · Skyline\*/); assert.match(text, /\*Hot leads\*/); assert.match(text, /\*Neha\*/);
  assert.equal(buildDailySummary([], "X", now).stats.conversations, 0);
});

test("groq: low reasoning + roomy limit for gpt-oss, retries once on empty content, no reasoning params for other models", async () => {
  const real = globalThis.fetch; const bodies: any[] = []; let n = 0;
  globalThis.fetch = (async (_u: string, init: RequestInit) => { bodies.push(JSON.parse(init.body as string)); n++; return new Response(JSON.stringify({ choices: [{ message: { content: n === 1 ? "" : "Hello!", reasoning: "thinking..." } }] })); }) as unknown as typeof fetch;
  assert.equal(await new GroqProvider("k", "openai/gpt-oss-20b").reply([{ role: "user", content: "x" }]), "Hello!");
  assert.equal(bodies[0].reasoning_effort, "low"); assert.equal(bodies[0].include_reasoning, false); assert.ok(bodies[0].max_completion_tokens >= 1500); assert.ok(bodies[1].max_completion_tokens > bodies[0].max_completion_tokens);
  bodies.length = 0; n = 5;
  await new GroqProvider("k", "llama-3.1-8b-instant").reply([{ role: "user", content: "x" }]);
  assert.equal(bodies[0].reasoning_effort, undefined);
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }))) as unknown as typeof fetch;
  await assert.rejects(new GroqProvider("k", "m").reply([{ role: "user", content: "x" }]), /returned no text/);
  globalThis.fetch = real;
});
