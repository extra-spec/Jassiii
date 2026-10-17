import crypto from "node:crypto";

function safeEq(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Accepts HTTP Basic auth (user:password in the wss URL) OR ?key=<password>. */
export function isAuthorized(authHeader: string | undefined, query: URLSearchParams, user: string, password: string): boolean {
  const key = query.get("key");
  if (key && safeEq(key, password)) return true;
  if (authHeader?.startsWith("Basic ")) {
    const [u, ...rest] = Buffer.from(authHeader.slice(6), "base64").toString().split(":");
    return safeEq(u ?? "", user) && safeEq(rest.join(":"), password);
  }
  return false;
}
