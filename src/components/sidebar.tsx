"use client";

import clsx from "clsx";
import { BrainCircuit, FileClock, LayoutDashboard, Layers, Menu, PlusCircle, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/reconcile/new", label: "New reconciliation", icon: PlusCircle },
  { href: "/runs", label: "Reconciliations", icon: Layers },
  { href: "/model", label: "Matching model", icon: BrainCircuit },
  { href: "/audit", label: "Audit trail", icon: FileClock },
];

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-2">
      <div className="relative grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-[#3b74ff] to-[#1d3fb8] shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset]">
        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </div>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight text-white">
          Reconcile <span className="text-[#7fa2ff]">X</span>
        </div>
        <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">Reconciliation OS</div>
      </div>
    </Link>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav className="mt-8 flex flex-col gap-0.5 px-3">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? path === "/" : path.startsWith(href) && !(href === "/runs" && path.startsWith("/reconcile"));
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={clsx(
              "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
              active ? "bg-navy-700/70 text-white" : "text-slate-300 hover:bg-navy-800 hover:text-white",
            )}
          >
            {active && <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r bg-[#5b8cff]" />}
            <Icon className={clsx("h-4 w-4", active ? "text-[#8fb0ff]" : "text-slate-400 group-hover:text-slate-200")} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function Footer() {
  return (
    <div className="mt-auto space-y-3 px-5 pb-5">
      <div className="rounded-lg border border-white/5 bg-navy-800/60 p-3">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-slate-200">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> Local mode
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
          Data stays in a local SQLite file. No bank connections, no outbound calls. Authentication is not enabled.
        </p>
      </div>
    </div>
  );
}

export function Sidebar() {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between bg-navy-900 px-4 lg:hidden">
        <Logo />
        <button aria-label="Open navigation" className="rounded-md p-2 text-slate-200 hover:bg-navy-800" onClick={() => setOpen(true)}>
          <Menu className="h-5 w-5" />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-navy-900 pt-4">
            <div className="flex items-center justify-between pr-3">
              <Logo />
              <button aria-label="Close navigation" className="rounded-md p-2 text-slate-300 hover:bg-navy-800" onClick={() => setOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavLinks onNavigate={() => setOpen(false)} />
            <Footer />
          </aside>
        </div>
      )}
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col bg-navy-900 pt-5 lg:flex">
        <Logo />
        <NavLinks />
        <Footer />
      </aside>
    </>
  );
}
