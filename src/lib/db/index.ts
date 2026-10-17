import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { SCHEMA } from "./schema";

export type SqlValue = string | number | null | bigint | Uint8Array;

/** node:sqlite cannot bind `undefined`; normalise at the boundary so no caller has to remember. */
export function normalize(params: unknown[]): SqlValue[] {
  return params.map((p) => (p === undefined ? null : typeof p === "boolean" ? (p ? 1 : 0) : (p as SqlValue)));
}

export class Db {
  private db: DatabaseSync;
  constructor(file: string) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
  }
  run(sql: string, ...params: unknown[]) {
    const r = this.db.prepare(sql).run(...normalize(params));
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
    return this.db.prepare(sql).get(...normalize(params)) as T | undefined;
  }
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
    return this.db.prepare(sql).all(...normalize(params)) as T[];
  }
  close() { this.db.close(); }
}
