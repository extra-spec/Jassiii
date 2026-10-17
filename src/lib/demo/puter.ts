/** puter.ai.chat() resolves to different shapes depending on the model; pull out the plain text. */
export function puterText(r: unknown): string {
  if (typeof r === "string") return r.trim();
  const o = r as { message?: { content?: unknown }; text?: unknown } | null;
  const c = o?.message?.content;
  if (typeof c === "string") return c.trim();
  if (Array.isArray(c)) return c.map((b) => (typeof b === "string" ? b : (b as { text?: string })?.text ?? "")).join(" ").trim();
  if (typeof o?.text === "string") return o.text.trim();
  return "";
}
