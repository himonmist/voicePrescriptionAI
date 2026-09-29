import { describe, it, expect } from "vitest";
import { scoreDuplicate, findDuplicates, type DupCandidate } from "@/server/patients/duplicates";

const base = { fullNameNorm: "md rahim uddin", dob: "1985-03-12", phoneIdx: "phoneA" };
const c = (o: Partial<DupCandidate> = {}): DupCandidate => ({ id: "c1", patientCode: "SDA-1", fullNameNorm: "md rahim uddin", dob: "1985-03-12", phoneIdx: "phoneA", ...o });

describe("duplicate detection", () => {
  it("exact name+dob+phone is a strong match", () => expect(scoreDuplicate(base, c()).level).toBe("strong"));
  it("same phone + same dob with a typo in the name is strong", () => expect(scoreDuplicate(base, c({ fullNameNorm: "md rahim udin" })).level).toBe("strong"));
  it("same name+dob but different phone is possible", () => expect(scoreDuplicate(base, c({ phoneIdx: "other" })).level).toBe("possible"));
  it("same phone only (family shared phone), different name/dob is NOT flagged strong", () => {
    const r = scoreDuplicate(base, c({ fullNameNorm: "ayesha begum", dob: "1990-01-01" }));
    expect(["none", "possible"]).toContain(r.level);
    expect(r.level).not.toBe("strong");
  });
  it("different person yields none", () => expect(scoreDuplicate(base, c({ fullNameNorm: "karim ali", dob: "1970-01-01", phoneIdx: "z" })).level).toBe("none"));
  it("findDuplicates returns strongest first and omits non-matches", () => {
    const res = findDuplicates(base, [c({ id: "a", phoneIdx: "other" }), c({ id: "b" }), c({ id: "n", fullNameNorm: "x y", dob: "2000-01-01", phoneIdx: "q" })]);
    expect(res.map((r) => r.id)).toEqual(["b", "a"]);
  });
  it("never leaks contact details in results", () => {
    expect(Object.keys(findDuplicates(base, [c()])[0]).sort()).toEqual(["dob", "fullNameNorm", "id", "level", "patientCode", "reasons"].sort());
  });
});
