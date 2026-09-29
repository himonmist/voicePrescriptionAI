export interface DupCandidate { id: string; patientCode: string; fullNameNorm: string; dob: string; phoneIdx: string | null }
export interface DupProbe { fullNameNorm: string; dob: string; phoneIdx: string | null }
export interface DupMatch { id: string; patientCode: string; fullNameNorm: string; dob: string; level: "strong" | "possible"; reasons: string[] }

function lev(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
const similar = (a: string, b: string) => a === b || lev(a, b) <= Math.max(1, Math.floor(Math.max(a.length, b.length) * 0.15));

/** A shared phone alone never makes a strong match: families commonly share one number. */
export function scoreDuplicate(p: DupProbe, c: DupCandidate): { level: "strong" | "possible" | "none"; reasons: string[] } {
  const reasons: string[] = [];
  const phone = !!p.phoneIdx && p.phoneIdx === c.phoneIdx;
  const dob = p.dob === c.dob;
  const nameExact = p.fullNameNorm === c.fullNameNorm;
  const nameClose = nameExact || similar(p.fullNameNorm, c.fullNameNorm);
  if (phone) reasons.push("same phone"); if (dob) reasons.push("same date of birth"); if (nameClose) reasons.push(nameExact ? "same name" : "similar name");
  if ((phone && dob && nameClose) || (nameExact && dob && phone)) return { level: "strong", reasons };
  if (nameClose && dob) return { level: "possible", reasons };
  if (phone && (nameClose || dob)) return { level: "possible", reasons };
  return { level: "none", reasons };
}

export function findDuplicates(p: DupProbe, candidates: DupCandidate[]): DupMatch[] {
  const rank = { strong: 0, possible: 1 } as const;
  return candidates
    .map((c) => ({ c, s: scoreDuplicate(p, c) }))
    .filter((x): x is { c: DupCandidate; s: { level: "strong" | "possible"; reasons: string[] } } => x.s.level !== "none")
    .sort((a, b) => rank[a.s.level] - rank[b.s.level])
    .map(({ c, s }) => ({ id: c.id, patientCode: c.patientCode, fullNameNorm: c.fullNameNorm, dob: c.dob, level: s.level, reasons: s.reasons }));
}
