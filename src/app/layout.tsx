import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SmartDoctorAid — AI-assisted clinical documentation",
  description: "Draft clinical notes and prescriptions from Bangla, English and mixed-language consultations. Doctor-reviewed and doctor-signed.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
