/** Reject cross-site state-changing requests. Uses Origin, then Referer; missing both is denied. */
export function isSameOrigin(req: Request): boolean {
  const expected = new URL(req.url).origin;
  const h = req.headers.get("origin") ?? req.headers.get("referer");
  if (!h) return false;
  try { return new URL(h).origin === expected; } catch { return false; }
}
