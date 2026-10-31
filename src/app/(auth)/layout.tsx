import { Check } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/site/brand";
import { routes } from "@/lib/routes";
import { getSession } from "@/server/session";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getSession()) redirect(routes.app);
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-night-950 p-12 text-white lg:flex lg:flex-col">
        <div aria-hidden className="absolute -top-32 -left-32 h-[480px] w-[480px] rounded-full bg-[#C8A96A] opacity-[0.10] blur-[120px]" />
        <div
          aria-hidden
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: "linear-gradient(rgba(200,169,106,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(200,169,106,0.05) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        <div className="relative">
          <Wordmark />
        </div>
        <div className="relative mt-auto max-w-md">
          <h2 className="text-[32px] leading-tight font-semibold tracking-[-0.02em]">Reconciliation you can explain to an auditor.</h2>
          <ul className="mt-8 space-y-3 text-[14px] text-stone-300">
            {[
              "Rules verify only what’s provable — the rest waits for you",
              "Every suggestion shows the model’s reasoning",
              "Every exception comes with cited evidence",
              "Every decision is recorded in a tamper-evident log",
            ].map((t) => (
              <li key={t} className="flex gap-3">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-400/15 text-emerald-300">
                  <Check className="h-3 w-3" />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative mt-12 text-[12px] text-stone-500">Reconcile X never moves money, connects to bank accounts, or makes financial decisions.</p>
      </aside>
      <main className="flex flex-col bg-white px-6 py-8 sm:px-12">
        <div className="lg:hidden">
          <Wordmark dark={false} />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">{children}</div>
      </main>
    </div>
  );
}
