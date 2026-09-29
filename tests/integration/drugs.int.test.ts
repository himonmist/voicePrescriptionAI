import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { hasDb, setupTestDb } from "./db";
import { drizzleAuthRepo } from "@/server/auth/drizzle-repo";
import { drizzleDrugRepo } from "@/server/drugs/drizzle-repo";
import { createDrugService } from "@/server/drugs/service";
import { drugReferences, drugInteractions, drugReferenceSources } from "@/db/schema";
import { ConflictError } from "@/server/errors";
import type { Actor } from "@/lib/security/rbac";

const SRC = (v = "v1") => ({ name: "TEST-SOURCE", version: v, publishedAt: "2026-01-15", licenceNote: "Synthetic test data, no licence needed" });
const D = (n: string, extra: object = {}) => ({ genericName: n, strength: "500 mg", dosageForm: "tablet", ...extra });

describe.skipIf(!hasDb)("drug reference (real Postgres)", () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>; let svc: ReturnType<typeof createDrugService>; let repo: ReturnType<typeof drizzleDrugRepo>;
  let admin: Actor; const doctor = (): Actor => ({ userId: admin.userId, roles: ["doctor"], orgId: null });
  beforeAll(async () => { ctx = await setupTestDb(); });
  afterAll(async () => { await ctx.pool.end(); });
  beforeEach(async () => {
    await ctx.db.execute(sql`ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_update`);
    await ctx.db.execute(sql`TRUNCATE audit_events, drug_interactions, drug_references, drug_reference_sources, users CASCADE`);
    await ctx.db.execute(sql`ALTER TABLE audit_events ENABLE TRIGGER audit_events_no_update`);
    const u = await drizzleAuthRepo(ctx.db).createUser({ email: "a@x.com", fullName: "Admin", phone: "01712345678", passwordHash: "h", roles: ["super_admin"] });
    admin = { userId: u.id, roles: ["super_admin"], orgId: null };
    repo = drizzleDrugRepo(ctx.db); svc = createDrugService(repo);
  });

  it("imports source + drugs + interactions atomically and records provenance", async () => {
    const r = await svc.importReference(admin, { source: SRC(), drugs: [D("Testalpha", { brandNames: ["Zedol"], drugClasses: ["testcillin"] }), D("Testbeta")], interactions: [{ ingredientA: "testbeta", ingredientB: "testalpha", severity: "major", description: "Synthetic" }] });
    expect(r).toMatchObject({ drugCount: 2, interactionCount: 1 });
    const [s] = await ctx.db.select().from(drugReferenceSources); expect(s).toMatchObject({ name: "TEST-SOURCE", version: "v1", publishedAt: "2026-01-15", status: "active", importedBy: admin.userId });
    const [ix] = await ctx.db.select().from(drugInteractions); expect([ix.ingredientA, ix.ingredientB]).toEqual(["testalpha", "testbeta"]);
  });
  it("a failing import (e.g. duplicate version) leaves nothing behind", async () => {
    await svc.importReference(admin, { source: SRC(), drugs: [D("Testalpha")] });
    await expect(svc.importReference(admin, { source: SRC(), drugs: [D("Other")] })).rejects.toThrow(ConflictError);
    expect(await ctx.db.select().from(drugReferences)).toHaveLength(1);
  });
  it("a new version supersedes the old one: search only sees the active version, old ids stay resolvable", async () => {
    await svc.importReference(admin, { source: SRC("v1"), drugs: [D("Testalpha")] });
    const old = (await svc.search(doctor(), "testalpha")).results[0];
    await svc.importReference(admin, { source: SRC("v2"), drugs: [D("Testalpha", { strength: "250 mg" })] });
    const now = (await svc.search(doctor(), "testalpha")).results;
    expect(now).toHaveLength(1); expect(now[0].strength).toBe("250 mg"); expect(now[0].sourceLabel).toBe("TEST-SOURCE v2");
    expect((await repo.getMany([old.id]))[old.id].sourceLabel).toBe("TEST-SOURCE v1"); // existing prescriptions keep their provenance
    const c = await svc.coverage(doctor()); expect(c.sources).toHaveLength(1); expect(c.sources[0].version).toBe("v2");
  });
  it("searches generic, brand and ingredient names case-insensitively; wildcards are escaped", async () => {
    await svc.importReference(admin, { source: SRC(), drugs: [D("Testalpha", { brandNames: ["Zedol"] }), D("Testgamma", { ingredients: ["testgamma", "testdelta"] })] });
    for (const q of ["TESTALPHA", "zedol", "testdelta"]) expect((await svc.search(doctor(), q)).results.length).toBeGreaterThan(0);
    expect((await svc.search(doctor(), "%%")).results).toHaveLength(0); expect((await svc.search(doctor(), "t_st")).results).toHaveLength(0);
  });
  it("interactionsFor returns only pairs whose BOTH ingredients are in the prescription, from active sources", async () => {
    await svc.importReference(admin, { source: SRC("v1"), drugs: [D("A1")], interactions: [{ ingredientA: "testalpha", ingredientB: "testbeta", severity: "major", description: "old" }, { ingredientA: "testalpha", ingredientB: "testzeta", severity: "minor", description: "other" }] });
    expect((await repo.interactionsFor(["testalpha", "testbeta"])).map((x) => x.description)).toEqual(["old"]);
    expect(await repo.interactionsFor(["testalpha"])).toEqual([]);
    await svc.importReference(admin, { source: SRC("v2"), drugs: [D("A1")], interactions: [] });
    expect(await repo.interactionsFor(["testalpha", "testbeta"])).toEqual([]); // superseded source no longer screens
  });
  it("coverage distinguishes 'nothing loaded' from 'drugs but no interactions'", async () => {
    expect((await svc.coverage(doctor())).loaded).toBe(false);
    await svc.importReference(admin, { source: SRC(), drugs: [D("Testalpha")] });
    const c = await svc.coverage(doctor()); expect(c.loaded).toBe(true); expect(c.interactionsLoaded).toBe(false);
  });
  it("import is audited with counts but never the drug content", async () => {
    await svc.importReference(admin, { source: SRC(), drugs: [D("Testalpha")] });
    const rows = await ctx.db.execute(sql`SELECT metadata::text m FROM audit_events WHERE action='drugref.imported'`);
    expect(rows.rows).toHaveLength(1); expect(JSON.stringify(rows.rows)).toMatch(/TEST-SOURCE/); expect(JSON.stringify(rows.rows)).not.toMatch(/Testalpha/);
  });
});
