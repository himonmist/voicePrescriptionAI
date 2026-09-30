// pdf-lib's fontkit fork uses Babel generators and expects this global.
import "regenerator-runtime/runtime";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { L, ageYears, type Lang } from "@/lib/rx-labels";
import type { SheetData } from "@/components/PrescriptionSheet";

const A4: [number, number] = [595.28, 841.89];
const M = 40, FOOTER_H = 128, BASE = 10, SMALL = 8;
const BN = /([ঀ-৿।॥‌‍]+)/;
const FONT_DIR = path.join(process.cwd(), "src/assets/fonts");
let fontBytes: Promise<Record<"lr" | "lb" | "br" | "bb", Buffer>> | undefined;
const loadFontBytes = () => (fontBytes ??= Promise.all(["NotoSans-Regular", "NotoSans-Bold", "NotoSansBengali-Regular", "NotoSansBengali-Bold"].map((f) => readFile(path.join(FONT_DIR, `${f}.woff`)))).then(([lr, lb, br, bb]) => ({ lr, lb, br, bb })));

/** Only draw what the embedded fonts can draw; anything else becomes "?" instead of failing the whole document. */
const clean = (s: string) => Array.from(s.normalize("NFC")).map((ch) => { const c = ch.codePointAt(0)!; return c === 10 || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || (c >= 0x2010 && c <= 0x2027) || c === 0x20ac || (c >= 0x980 && c <= 0x9ff) || c === 0x964 || c === 0x965 || c === 0x200c || c === 0x200d ? ch : "?"; }).join("");

interface Fonts { lr: PDFFont; lb: PDFFont; br: PDFFont; bb: PDFFont }
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Bengali (and other Indic) text CANNOT be shaped correctly by the pure-JS PDF stack: conjuncts and vowel signs come out
 * wrong or missing (verified by rasterizing the output). A wrong glyph in a prescription is a patient-safety risk, so we refuse
 * rather than produce it. Bengali copies are printed from the browser instead (see the print page).
 */
export class UnsupportedScriptError extends Error { constructor() { super("This prescription contains Bengali text, which cannot be exported to PDF reliably yet. Use Print and choose “Save as PDF” in your browser."); this.name = "UnsupportedScriptError"; } }
const BENGALI = /[\u0980-\u09FF]/;
export function needsBrowserRendering(data: SheetData, lang: Lang): boolean {
  return lang === "bn" || BENGALI.test(JSON.stringify([data.content, data.patient, data.doctor]));
}

export async function renderPrescriptionPdf(o: { data: SheetData; lang: Lang; verifyUrl: string; qrPng: Uint8Array }): Promise<Uint8Array> {
  const { data, lang } = o, t = L[lang], c = data.content;
  if (needsBrowserRendering(data, lang)) throw new UnsupportedScriptError();
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const b = await loadFontBytes();
  const f: Fonts = { lr: await doc.embedFont(b.lr, { subset: true }), lb: await doc.embedFont(b.lb, { subset: true }), br: await doc.embedFont(b.br, { subset: true }), bb: await doc.embedFont(b.bb, { subset: true }) };
  doc.setTitle(`Prescription ${data.code}`); doc.setAuthor(data.doctor.name); doc.setProducer("SmartDoctorAid"); doc.setCreator("SmartDoctorAid"); doc.setSubject(`Prescription ${data.code}`);
  const qr = await doc.embedPng(o.qrPng);

  const runs = (s: string) => s.split(BN).filter(Boolean).map((text) => ({ text, bn: BN.test(text) && !/[^ঀ-৿।॥‌‍]/.test(text) }));
  const fontFor = (bn: boolean, bold: boolean) => (bn ? (bold ? f.bb : f.br) : bold ? f.lb : f.lr);
  const width = (s: string, size: number, bold = false) => runs(s).reduce((w, r) => w + fontFor(r.bn, bold).widthOfTextAtSize(r.text, size), 0);
  const draw = (page: PDFPage, s: string, x: number, y: number, size = BASE, bold = false) => { let cx = x; for (const r of runs(s)) { const ft = fontFor(r.bn, bold); page.drawText(r.text, { x: cx, y, size, font: ft, color: rgb(0, 0, 0) }); cx += ft.widthOfTextAtSize(r.text, size); } };
  const wrap = (raw: string, maxW: number, size = BASE, bold = false): string[] => {
    const lines: string[] = [];
    for (const para of clean(raw).split("\n")) {
      let line = "";
      for (const word of para.split(" ")) {
        const trial = line ? `${line} ${word}` : word;
        if (width(trial, size, bold) <= maxW) { line = trial; continue; }
        if (line) { lines.push(line); line = ""; }
        if (width(word, size, bold) <= maxW) { line = word; continue; }
        let piece = ""; // a single over-long word: break at grapheme boundaries (never inside a Bengali cluster)
        for (const { segment } of segmenter.segment(word)) { if (width(piece + segment, size, bold) > maxW && piece) { lines.push(piece); piece = ""; } piece += segment; }
        line = piece;
      }
      lines.push(line);
    }
    return lines;
  };

  const pages: PDFPage[] = []; let page!: PDFPage; let y = 0;
  const LH = BASE * 1.4, W = A4[0] - 2 * M;
  const newPage = (continuation: boolean) => { page = doc.addPage(A4); pages.push(page); y = A4[1] - M; if (continuation) { draw(page, `${data.code} — ${data.patient.name}`, M, y - 8, SMALL, true); y -= 24; } };
  const ensure = (h: number) => { if (y - h < FOOTER_H + 10) newPage(true); };
  const para = (s: string, x = M, maxW = W, size = BASE, bold = false) => { for (const ln of wrap(s, maxW, size, bold)) { ensure(size * 1.4); draw(page, ln, x, y - size, size, bold); y -= size * 1.4; } };
  const labelled = (label: string, value: string) => { const lines = wrap(`${label}: ${value}`, W); for (const [i, ln] of lines.entries()) { ensure(LH); if (i === 0 && ln.startsWith(`${label}:`)) { draw(page, `${label}:`, M, y - BASE, BASE, true); draw(page, ln.slice(label.length + 1), M + width(`${label}:`, BASE, true), y - BASE); } else draw(page, ln, M, y - BASE); y -= LH; } };
  const fmtDate = (iso: string) => new Date(new Date(iso).getTime() + 6 * 3600_000).toISOString().slice(0, 10);

  newPage(false);
  // ---- header ----
  const hy = y;
  draw(page, data.doctor.name, M, hy - 14, 14, true); let ly = hy - 28;
  for (const s of [data.doctor.specialty, `${t.reg}: ${data.doctor.bmdc}`, data.doctor.chamberAddress ?? ""].filter(Boolean)) for (const ln of wrap(s, 300)) { draw(page, ln, M, ly - BASE); ly -= LH; }
  const right = (s: string, yy: number, size: number, bold: boolean) => draw(page, s, A4[0] - M - width(s, size, bold), yy, size, bold);
  right(`Rx ${t.rx}`, hy - 14, 14, true); right(`${t.id}: ${data.code}`, hy - 30, BASE, true); right(`${t.date}: ${fmtDate(data.issuedAt)}`, hy - 44, BASE, false);
  y = Math.min(ly, hy - 52) - 4; page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 1.2, color: rgb(0, 0, 0) }); y -= 10;
  // ---- patient ----
  labelled(t.patient, `${data.patient.name}  (${t.patientId}: ${data.patient.patientCode})`);
  labelled(t.age, `${ageYears(data.patient.dob, data.issuedAt)} y   ${t.sex}: ${t[data.patient.sex] ?? t.unknown}`);
  y -= 4; labelled(t.allergies, c.allergiesSnapshot.length ? c.allergiesSnapshot.join("; ") : t.none);
  if (c.chiefComplaint) labelled(t.complaint, c.chiefComplaint);
  if (c.history) labelled(t.history, c.history);
  const v = c.vitals; if (v) { const parts = [v.bpSystolic !== undefined ? `BP ${v.bpSystolic}/${v.bpDiastolic ?? "?"} mmHg` : "", v.pulse ? `Pulse ${v.pulse}/min` : "", v.tempC ? `Temp ${v.tempC} °C` : "", v.spo2 ? `SpO2 ${v.spo2}%` : "", v.respRate ? `RR ${v.respRate}/min` : "", v.weightKg ? `Wt ${v.weightKg} kg` : "", v.heightCm ? `Ht ${v.heightCm} cm` : ""].filter(Boolean); if (parts.length) labelled(t.vitals, parts.join("  ·  ")); }
  if (c.diagnoses.length) labelled(t.diagnosis, c.diagnoses.map((d) => `${d.text} (${d.status === "confirmed" ? t.confirmed : t.provisional})`).join("; "));
  // ---- medicines ----
  if (c.items.length) {
    y -= 8; ensure(40); draw(page, t.medicines, M, y - BASE, BASE + 1, true); y -= 18;
    const cols = [{ k: "#", x: M, w: 16 }, { k: t.drug, x: M + 18, w: 150 }, { k: t.dose, x: M + 172, w: 66 }, { k: t.frequency, x: M + 242, w: 80 }, { k: t.duration, x: M + 326, w: 62 }, { k: t.instructions, x: M + 392, w: W - 392 }];
    const head = () => { ensure(30); page.drawLine({ start: { x: M, y: y }, end: { x: A4[0] - M, y }, thickness: 0.8, color: rgb(0, 0, 0) }); for (const col of cols) draw(page, col.k, col.x, y - 11, SMALL + 1, true); y -= 15; page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.8, color: rgb(0, 0, 0) }); };
    head();
    c.items.forEach((it, i) => {
      const dur = !it.duration ? "" : "ongoing" in it.duration ? t.ongoing : `${it.duration.value} ${t[it.duration.unit]}`;
      const cells = [String(i + 1), `${it.genericName}${it.brandName ? ` (${it.brandName})` : ""}\n${[it.strength, it.dosageForm, it.route].filter(Boolean).join(" · ")}`, it.dose ?? "", it.frequency ?? "", dur, [it.timing, it.quantity ? `Qty ${it.quantity}` : null, it.refills != null ? `Refills ${it.refills}` : null, it.warnings, it.comments].filter(Boolean).join(" · ")];
      const wrapped = cells.map((s, k) => wrap(s, cols[k].w - 4, SMALL + 1, k === 1 && false));
      const rows = Math.max(...wrapped.map((w) => w.length)), h = rows * (SMALL + 1) * 1.35 + 5;
      if (y - h < FOOTER_H + 10) { newPage(true); head(); }
      wrapped.forEach((lines, k) => lines.forEach((ln, r) => draw(page, ln, cols[k].x, y - (SMALL + 1) - r * (SMALL + 1) * 1.35 - 1, SMALL + 1, k === 1 && r === 0)));
      y -= h; page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.3, color: rgb(0.6, 0.6, 0.6) });
    });
  }
  if (c.investigations.length) { y -= 8; ensure(30); draw(page, t.investigations, M, y - BASE, BASE, true); y -= LH + 2; for (const inv of c.investigations) para(`•  ${inv}`, M + 6, W - 6); }
  if (c.advice) { y -= 8; ensure(30); draw(page, t.advice, M, y - BASE, BASE, true); y -= LH + 2; para(c.advice); }
  if (c.followUp && (c.followUp.date || c.followUp.text)) { y -= 6; labelled(t.followUp, [c.followUp.date, c.followUp.text].filter(Boolean).join(" — ")); }
  if (c.referral && (c.referral.to || c.referral.reason)) labelled(t.referral, [c.referral.to, c.referral.reason].filter(Boolean).join(" — "));

  // ---- footer + watermark on every page ----
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: FOOTER_H }, end: { x: A4[0] - M, y: FOOTER_H }, thickness: 1.2, color: rgb(0, 0, 0) });
    let fy = FOOTER_H - 14;
    draw(p, clean(t.signed), M, fy, BASE, true); fy -= 13;
    draw(p, `${data.doctor.name} · ${t.reg} ${data.doctor.bmdc}`, M, fy, SMALL + 1); fy -= 12;
    for (const ln of wrap(`${t.verify}: ${o.verifyUrl}`, W - 100, SMALL)) { draw(p, ln, M, fy, SMALL); fy -= 10; }
    for (const ln of wrap(t.notes, W - 100, SMALL - 1)) { draw(p, ln, M, fy - 2, SMALL - 1); fy -= 9; }
    p.drawImage(qr, { x: A4[0] - M - 84, y: FOOTER_H - 96, width: 84, height: 84 });
    draw(p, `${data.code}  ·  Page ${i + 1}/${pages.length}`, M, 22, SMALL);
    if (data.state !== "valid") {
      const word = data.state === "superseded" ? "SUPERSEDED" : "CANCELLED";
      p.drawText(word, { x: 120, y: 260, size: 90, font: f.lb, color: rgb(0.5, 0.5, 0.5), opacity: 0.18, rotate: degrees(30) });
      draw(p, clean(data.state === "superseded" ? t.superseded : t.cancelled), M, A4[1] - 24, BASE, true);
    }
  });
  return doc.save();
}
