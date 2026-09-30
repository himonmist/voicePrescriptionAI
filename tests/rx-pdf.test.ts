import { describe, it, expect } from "vitest";
import { renderPrescriptionPdf, needsBrowserRendering, UnsupportedScriptError } from "@/server/prescriptions/pdf";
import { emptyContent, parseContentInput } from "@/server/prescriptions/content";
import type { SheetData } from "@/components/PrescriptionSheet";
import QRCode from "qrcode";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = process.env.RX_PDF_DEBUG_DIR; // optional: write PDFs/PNGs for visual inspection
const item = (n: number) => ({ genericName: `Testdrug${n}`, strength: "500 mg", dosageForm: "tablet", route: "oral", dose: "1 tablet", frequency: "twice daily", timing: "after meals", duration: { value: 5, unit: "days" }, comments: "Take with plenty of water" });
const data = (o: Partial<SheetData> = {}, content: object = {}): SheetData => ({
  code: "RX-K7M2Q9XA", state: "valid", issuedAt: "2026-10-01T05:00:00.000Z",
  doctor: { name: "Dr Test Doctor", bmdc: "A-12345", specialty: "General Practice", chamberAddress: "House 4, Road 2, Dhaka" },
  patient: { name: "Md Rahim Uddin", dob: "1985-03-12", sex: "male", patientCode: "SDA-ABCD2345" },
  content: parseContentInput({ chiefComplaint: "Fever for 3 days", allergiesSnapshot: ["Testcillin - rash"], diagnoses: [{ text: "Viral fever", status: "provisional" }], vitals: { tempC: 38.6, pulse: 96 }, items: [item(1), item(2)], investigations: ["CBC"], advice: "Rest and plenty of fluids", followUp: { date: "2026-10-08", text: "Review if fever persists" }, ...content }),
  ...o,
});
const URL_ = "https://app.example.com/verify/RX-K7M2Q9XA";
async function pdf(d: SheetData, lang: "en" | "bn" = "en") { return renderPrescriptionPdf({ data: d, lang, verifyUrl: URL_, qrPng: await QRCode.toBuffer(URL_, { margin: 1, width: 200 }) }); }
async function inspect(bytes: Uint8Array) {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(Buffer.from(bytes), "application/pdf");
  const pages = doc.countPages();
  return { pages, bounds: doc.loadPage(0).getBounds(), text: Array.from({ length: pages }, (_, i) => doc.loadPage(i).toStructuredText("preserve-whitespace").asText()), png: (i = 0) => doc.loadPage(i).toPixmap(mupdf.Matrix.scale(1.6, 1.6), mupdf.ColorSpace.DeviceRGB, false, true).asPNG() };
}

describe("prescription PDF", () => {
  it("is a valid single-page A4 PDF with the essential content", async () => {
    const bytes = await pdf(data()); expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const p = await inspect(bytes); expect(p.pages).toBe(1); expect(Math.round(p.bounds[2])).toBe(595); expect(Math.round(p.bounds[3])).toBe(842);
    const t = p.text[0];
    for (const s of ["RX-K7M2Q9XA", "Dr Test Doctor", "A-12345", "Md Rahim Uddin", "SDA-ABCD2345", "Testdrug1", "Testdrug2", "500 mg", "twice daily", "5 days", "Testcillin - rash", "Viral fever", "Provisional", "CBC", "Rest and plenty of fluids", "Digitally sealed", URL_]) expect(t, s).toContain(s);
    if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/en.pdf`, bytes); writeFileSync(`${OUT}/en.png`, p.png()); }
  });
  it("REFUSES Bengali instead of drawing wrong glyphs (layout, patient name, or any content field)", async () => {
    await expect(pdf(data(), "bn")).rejects.toThrow(UnsupportedScriptError);
    await expect(pdf(data({ patient: { name: "রহিম উদ্দিন", dob: "1985-03-12", sex: "male", patientCode: "SDA-1" } }))).rejects.toThrow(/Bengali/);
    await expect(pdf(data({}, { advice: "বিশ্রাম নিন" }))).rejects.toThrow(UnsupportedScriptError);
    await expect(pdf(data({}, { items: [{ ...item(1), comments: "খাবারের পরে" }] }))).rejects.toThrow(UnsupportedScriptError);
  });
  it("needsBrowserRendering flags exactly the unsupported cases", () => {
    expect(needsBrowserRendering(data(), "en")).toBe(false); expect(needsBrowserRendering(data(), "bn")).toBe(true);
    expect(needsBrowserRendering(data({}, { chiefComplaint: "জ্বর" }), "en")).toBe(true);
  });
  it("superseded and cancelled copies are unmistakable", async () => {
    expect((await inspect(await pdf(data({ state: "superseded" })))).text[0]).toContain("SUPERSEDED");
    expect((await inspect(await pdf(data({ state: "cancelled" })))).text[0]).toContain("CANCELLED");
    expect((await inspect(await pdf(data()))).text[0]).not.toMatch(/SUPERSEDED|CANCELLED/);
  });
  it("long prescriptions flow onto more pages; every page carries the code, page number and the seal footer", async () => {
    const p = await inspect(await pdf(data({}, { items: Array.from({ length: 30 }, (_, i) => item(i + 1)), advice: "Line\n".repeat(40) })));
    expect(p.pages).toBeGreaterThan(1);
    p.text.forEach((t, i) => { expect(t).toContain("RX-K7M2Q9XA"); expect(t).toContain(`Page ${i + 1}/${p.pages}`); expect(t).toContain("Digitally sealed"); });
    expect(p.text.join("\n")).toContain("Testdrug30");
  });
  it("a very long unbroken string does not overflow or crash", async () => {
    const t = (await inspect(await pdf(data({}, { advice: "x".repeat(600) })))).text.join("");
    expect(t.replace(/\s/g, "")).toContain("x".repeat(600));
  });
  it("characters the fonts cannot draw (emoji, symbols) are replaced, not fatal", async () => {
    const bytes = await pdf(data({}, { advice: "Rest 😀 ℞ ✓ done" })); const t = (await inspect(bytes)).text[0];
    expect(t).toContain("Rest"); expect(t).toContain("done");
  });
  it("works with an empty medicine list (advice/investigation-only prescription)", async () => {
    const bytes = await pdf(data({ content: parseContentInput({ advice: "Rest", allergiesSnapshot: [] }) })); expect((await inspect(bytes)).text[0]).toContain("None recorded");
  });
  it("sets document metadata", async () => {
    const { PDFDocument } = await import("pdf-lib"); const d = await PDFDocument.load(await pdf(data()));
    expect(d.getTitle()).toContain("RX-K7M2Q9XA"); expect(d.getAuthor()).toBe("Dr Test Doctor");
  });
  it("uses only emptyContent-compatible input (sanity)", () => { expect(emptyContent().items).toEqual([]); });
});
