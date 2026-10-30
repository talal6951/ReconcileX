import type { Metadata, Viewport } from "next";
import { Sidebar } from "@/components/sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Reconcile X", template: "%s · Reconcile X" },
  description: "AI-assisted financial reconciliation and investigation",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#0b1a33" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Sidebar />
        <main className="min-h-screen lg:pl-64">
          <div className="mx-auto max-w-[1440px] px-4 py-6 md:px-8 md:py-8">{children}</div>
        </main>
      </body>
    </html>
  );
}
