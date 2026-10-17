import type { WebSocket } from "ws";
import type { CallsRepo } from "../../lib/db/calls.repo";
import { parseEvent, mediaMsg, markMsg, frame, chime, MIN_CHUNK } from "./protocol";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[exotel-ws]", ...a);

/** One instance per WebSocket connection. Telephony only: no business logic in here. */
export class ExotelSession {
  private streamSid?: string;
  private callId?: number;
  private mediaFrames = 0;
  private closed = false;

  constructor(private ws: WebSocket, private calls: CallsRepo, private query: URLSearchParams) {
    const q = Number(query.get("callId"));
    if (Number.isInteger(q) && q > 0) this.callId = q;
    ws.on("message", (d) => this.onMessage(d.toString()));
    ws.on("close", () => { this.closed = true; log("socket closed", { callId: this.callId, mediaFrames: this.mediaFrames }); });
    ws.on("error", (e) => log("socket error", e.message));
  }

  private onMessage(raw: string) {
    const p = parseEvent(raw);
    if (!p.ok) { log("UNPARSEABLE frame:", p.reason, "body:", raw.slice(0, 2000)); return; }
    const ev = p.event;
    switch (ev.event) {
      case "connected": log("connected"); break;
      case "start": this.onStart(ev as never); break;
      case "media":
        this.mediaFrames++;
        if (this.mediaFrames === 1 || this.mediaFrames % 50 === 0) log(`media frames received: ${this.mediaFrames}`);
        break;
      case "dtmf": log("dtmf", JSON.stringify(ev)); break;
      case "mark": log("mark (playback reached):", (ev as { mark: { name: string } }).mark.name); break;
      case "stop": log("stop"); break;
    }
  }

  private onStart(ev: { stream_sid?: string; start?: { stream_sid?: string; call_sid?: string; from?: string; to?: string; custom_parameters?: Record<string, unknown> | null } }) {
    const s = ev.start ?? {};
    this.streamSid = s.stream_sid ?? ev.stream_sid;
    const cp = s.custom_parameters ?? {};
    log("start", JSON.stringify({ streamSid: this.streamSid, callSid: s.call_sid, from: s.from, to: s.to, custom_parameters: cp, queryCallId: this.callId }));

    if (!this.callId) {
      // Inbound (or callId lost): create the record from Exotel metadata ONLY, never from model text.
      const fromCp = Number((cp as Record<string, unknown>).callId);
      this.callId = Number.isInteger(fromCp) && fromCp > 0
        ? fromCp
        : this.calls.create({ direction: "INBOUND", from: s.from, to: s.to, exotelCallSid: s.call_sid });
    }
    this.calls.attachStream(this.callId, this.streamSid, s.call_sid);
    void this.playGreeting();
  }

  /** P1 test audio: a chime, paced at ~real time, then a mark so we can see playback finish. */
  private async playGreeting() {
    const frames = frame(chime(1200), MIN_CHUNK);
    for (const f of frames) {
      if (this.closed || this.ws.readyState !== this.ws.OPEN) return;
      this.ws.send(mediaMsg(f));
      await new Promise((r) => setTimeout(r, 90));
    }
    if (!this.closed) { this.ws.send(markMsg("greeting-end")); log("greeting sent", frames.length, "frames"); }
  }
}
