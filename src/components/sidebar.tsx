"use client";

import clsx from "clsx";
import { BrainCircuit, Building2, ChevronsUpDown, FileClock, LayoutDashboard, Layers, LogOut, Menu, PlusCircle, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { routes } from "@/lib/routes";
import { Wordmark } from "./site/brand";

const NAV = [
  { href: routes.app, label: "Overview", icon: LayoutDashboard, exact: true },
  { href: routes.newReconciliation, label: "New reconciliation", icon: PlusCircle },
  { href: routes.reconciliations, label: "Reconciliations", icon: Layers },
  { href: routes.model, label: "Matching model", icon: BrainCircuit },
  { href: routes.audit, label: "Audit trail", icon: FileClock },
];

interface Props {
  user: { name: string; email: string };
  workspace: { name: string; role: string };
}

function isActive(path: string, href: string, exact?: boolean) {
  if (exact) return path === href;
  if (href === routes.reconciliations) return path.startsWith(href) && !path.startsWith(routes.newReconciliation);
  return path.startsWith(href);
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav className="mt-6 flex flex-col gap-0.5 px-3" aria-label="Main">
      {NAV.map(({ href, label, icon: Icon, exact }) => {
        const active = isActive(path, href, exact);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
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

function WorkspaceBadge({ workspace }: Pick<Props, "workspace">) {
  return (
    <div className="mx-3 mt-6 flex items-center gap-2.5 rounded-lg border border-white/5 bg-navy-800/60 px-3 py-2.5">
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white/10 text-[#8fb0ff]">
        <Building2 className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-white">{workspace.name}</div>
        <div className="text-[11px] capitalize text-slate-400">{workspace.role}</div>
      </div>
      <ChevronsUpDown className="h-3.5 w-3.5 text-slate-500" aria-hidden />
    </div>
  );
}

function UserFooter({ user }: Pick<Props, "user">) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    await authClient.signOut();
    router.replace(routes.signIn);
    router.refresh();
  }
  return (
    <div className="mt-auto space-y-3 px-3 pb-4">
      <div className="flex items-start gap-2 rounded-lg px-2 text-[11px] leading-relaxed text-slate-400">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
        Read-only analysis. Reconcile X never moves money or edits bank records.
      </div>
      <div className="flex items-center gap-2.5 rounded-lg border-t border-white/5 px-2 pt-3">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#2458e6] text-[12px] font-semibold text-white">
          {user.name.trim().charAt(0).toUpperCase() || "?"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-semibold text-white">{user.name}</div>
          <div className="truncate text-[11px] text-slate-400">{user.email}</div>
        </div>
        <button onClick={signOut} disabled={busy} className="rounded-md p-1.5 text-slate-400 hover:bg-navy-800 hover:text-white" aria-label="Sign out" title="Sign out">
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function Sidebar({ user, workspace }: Props) {
  const [open, setOpen] = useState(false);
  const body = (onNavigate?: () => void) => (
    <>
      <WorkspaceBadge workspace={workspace} />
      <NavLinks onNavigate={onNavigate} />
      <UserFooter user={user} />
    </>
  );
  return (
    <>
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between bg-navy-900 px-4 lg:hidden">
        <Wordmark href={routes.app} />
        <button aria-label="Open navigation" className="rounded-md p-2 text-slate-200 hover:bg-navy-800" onClick={() => setOpen(true)}>
          <Menu className="h-5 w-5" />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-navy-900 pt-4">
            <div className="flex items-center justify-between px-5">
              <Wordmark href={routes.app} />
              <button aria-label="Close navigation" className="rounded-md p-2 text-slate-300 hover:bg-navy-800" onClick={() => setOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            {body(() => setOpen(false))}
          </aside>
        </div>
      )}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col bg-navy-900 pt-5 lg:flex">
        <div className="px-5">
          <Wordmark href={routes.app} />
        </div>
        {body()}
      </aside>
    </>
  );
}
