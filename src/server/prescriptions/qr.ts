import QRCode from "qrcode";
import { headers } from "next/headers";

/** Public origin for verification links. Prefer an explicit APP_URL; otherwise derive from the request. */
export async function appOrigin(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers(); const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
}
export const verifyUrl = (origin: string, code: string) => `${origin}/verify/${code}`;
export const qrSvg = (url: string) => QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
export const qrPngBuffer = (url: string) => QRCode.toBuffer(url, { margin: 1, width: 220, errorCorrectionLevel: "M" });
