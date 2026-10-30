import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Reconcile X — AI-assisted financial reconciliation", template: "%s · Reconcile X" },
  description:
    "Reconcile bank statements against your ledger in seconds. Deterministic matching, explainable machine learning, evidence-based investigations and a complete audit trail.",
};

export const viewport: Viewport = { themeColor: "#0b1a33" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
