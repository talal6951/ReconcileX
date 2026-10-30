import type { Metadata } from "next";
import { Sidebar } from "@/components/sidebar";
import { requireWorkspacePage } from "@/server/session";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireWorkspacePage();
  return (
    <>
      <div className="print:hidden">
        <Sidebar user={{ name: ctx.userName, email: ctx.userEmail }} workspace={{ name: ctx.orgName, role: ctx.role }} />
      </div>
      <main className="min-h-screen lg:pl-64 print:pl-0">
        <div className="mx-auto max-w-[1440px] px-4 py-6 md:px-8 md:py-8 print:p-0">{children}</div>
      </main>
    </>
  );
}
