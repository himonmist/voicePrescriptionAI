import { describe, it, expect } from "vitest";
import { isSameOrigin } from "@/lib/security/origin";

const req = (headers: Record<string, string>) => new Request("https://app.example.com/api/x", { method: "POST", headers });

describe("same-origin check (CSRF defence)", () => {
  it("allows matching Origin", () => expect(isSameOrigin(req({ origin: "https://app.example.com" }))).toBe(true));
  it("blocks foreign Origin", () => expect(isSameOrigin(req({ origin: "https://evil.com" }))).toBe(false));
  it("falls back to Referer", () => expect(isSameOrigin(req({ referer: "https://app.example.com/login" }))).toBe(true));
  it("blocks when neither header is present", () => expect(isSameOrigin(req({}))).toBe(false));
  it("blocks malformed origin", () => expect(isSameOrigin(req({ origin: "null" }))).toBe(false));
});
