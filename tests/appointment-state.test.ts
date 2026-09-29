import { describe, it, expect } from "vitest";
import { canTransition, ACTIVE_STATUSES, type ApptStatus } from "@/server/appointments/state";

describe("appointment status machine", () => {
  const ok: [ApptStatus, ApptStatus][] = [["booked", "checked_in"], ["booked", "cancelled"], ["booked", "no_show"], ["checked_in", "in_progress"], ["checked_in", "cancelled"], ["checked_in", "no_show"], ["in_progress", "completed"]];
  it.each(ok)("allows %s → %s", (a, b) => expect(canTransition(a, b)).toBe(true));
  const bad: [ApptStatus, ApptStatus][] = [["booked", "completed"], ["booked", "in_progress"], ["completed", "cancelled"], ["cancelled", "booked"], ["no_show", "checked_in"], ["in_progress", "cancelled"], ["completed", "in_progress"]];
  it.each(bad)("forbids %s → %s", (a, b) => expect(canTransition(a, b)).toBe(false));
  it("only booked/checked_in/in_progress occupy a slot", () => { expect([...ACTIVE_STATUSES].sort()).toEqual(["booked", "checked_in", "in_progress"]); });
});
