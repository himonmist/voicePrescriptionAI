export type ApptStatus = "booked" | "checked_in" | "in_progress" | "completed" | "cancelled" | "no_show";

/** Statuses that occupy the doctor's and the patient's time (mirrors the DB exclusion constraints). */
export const ACTIVE_STATUSES: readonly ApptStatus[] = ["booked", "checked_in", "in_progress"];

const T: Record<ApptStatus, ApptStatus[]> = {
  booked: ["checked_in", "cancelled", "no_show"],
  checked_in: ["in_progress", "cancelled", "no_show"],
  in_progress: ["completed"],
  completed: [], cancelled: [], no_show: [],
};
export const canTransition = (from: ApptStatus, to: ApptStatus) => T[from].includes(to);
