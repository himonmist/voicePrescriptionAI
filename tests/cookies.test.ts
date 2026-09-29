import { describe, it, expect } from "vitest";
import { sessionCookie, clearSessionCookie } from "@/lib/security/cookies";

describe("session cookie", () => {
  it("is HttpOnly, Secure, SameSite=Lax, scoped to /", () => {
    const c = sessionCookie("tok", new Date(Date.now() + 1000));
    expect(c).toMatch(/HttpOnly/); expect(c).toMatch(/Secure/); expect(c).toMatch(/SameSite=Lax/); expect(c).toMatch(/Path=\//);
    expect(c.startsWith("__Host-sda_session=tok")).toBe(true);
  });
  it("clear expires it", () => { expect(clearSessionCookie()).toMatch(/Max-Age=0/); });
});
