import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** /app/* — authenticated area. Guards live in the nested layouts and on every API route. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return children;
}
