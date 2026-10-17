import type { Db } from "./index";

export type CallDirection = "INBOUND" | "OUTBOUND";

export class CallsRepo {
  constructor(private db: Db) {}
  create(a: { direction: CallDirection; from?: string; to?: string; leadId?: number; exotelCallSid?: string }) {
    return this.db.run(
      "INSERT INTO calls (direction, from_number, to_number, lead_id, exotel_call_sid) VALUES (?,?,?,?,?)",
      a.direction, a.from, a.to, a.leadId, a.exotelCallSid,
    ).lastInsertRowid;
  }
  get(id: number) { return this.db.get("SELECT * FROM calls WHERE id = ?", id); }
  attachStream(id: number, streamSid?: string, callSid?: string) {
    this.db.run("UPDATE calls SET stream_sid = ?, exotel_call_sid = COALESCE(?, exotel_call_sid), status = 'IN_PROGRESS' WHERE id = ?", streamSid, callSid, id);
  }
  setSid(id: number, callSid?: string) { this.db.run("UPDATE calls SET exotel_call_sid = ? WHERE id = ?", callSid, id); }
  finish(id: number, status: string, recordingUrl?: string, durationSeconds?: number) {
    this.db.run(
      "UPDATE calls SET status = ?, recording_url = COALESCE(?, recording_url), duration_seconds = COALESCE(?, duration_seconds), ended_at = CURRENT_TIMESTAMP WHERE id = ?",
      status, recordingUrl, durationSeconds, id,
    );
  }
  findBySid(callSid: string) { return this.db.get<{ id: number }>("SELECT id FROM calls WHERE exotel_call_sid = ?", callSid); }
}
