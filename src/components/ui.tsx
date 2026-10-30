import clsx from "clsx";
import type { ReactNode } from "react";
import { EXCEPTION_LABEL, FLAG_LABEL, STATUS_LABEL } from "@/lib/format";

type Tone = "ok" | "info" | "warn" | "bad" | "neutral";

const TONE: Record<Tone, string> = {
  ok: "bg-ok-soft text-ok",
  info: "bg-info-soft text-info",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  neutral: "bg-neutral-soft text-ink-2",
};

const DOT: Record<Tone, string> = { ok: "bg-ok", info: "bg-info", warn: "bg-warn", bad: "bg-bad", neutral: "bg-ink-3" };

export function Badge({ tone, children, dot = true, className }: { tone: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap", TONE[tone], className)}>
      {dot && <span className={clsx("h-1.5 w-1.5 rounded-full", DOT[tone])} />}
      {children}
    </span>
  );
}

export const STATUS_TONE: Record<string, Tone> = {
  verified: "ok",
  approved: "ok",
  suggested: "info",
  needs_review: "warn",
  rejected: "bad",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status] ?? status}</Badge>;
}

export const EXCEPTION_TONE: Record<string, Tone> = {
  missing_in_ledger: "bad",
  missing_in_bank: "bad",
  duplicate_bank: "warn",
  duplicate_ledger: "warn",
  amount_mismatch: "warn",
  currency_mismatch: "bad",
};

export function ExceptionBadge({ type }: { type: string }) {
  return <Badge tone={EXCEPTION_TONE[type] ?? "neutral"}>{EXCEPTION_LABEL[type] ?? type}</Badge>;
}

export function FlagChip({ flag }: { flag: string }) {
  const tone: Tone = flag === "ambiguous" || flag === "duplicate_involved" ? "warn" : flag === "low_confidence" ? "bad" : "neutral";
  return (
    <Badge tone={tone} dot={false} className="!px-1.5 !py-0 !text-[10px] !font-medium">
      {FLAG_LABEL[flag] ?? flag}
    </Badge>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
        <h1 className="text-[22px] font-semibold tracking-tight text-ink md:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-[13px] text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Kpi({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; icon?: ReactNode }) {
  return (
    <div className="card relative overflow-hidden p-4">
      <div className="flex items-start justify-between">
        <div className="eyebrow">{label}</div>
        {icon && <div className={clsx("rounded-md p-1.5", tone ? TONE[tone] : "bg-neutral-soft text-ink-3")}>{icon}</div>}
      </div>
      <div className="tabular mt-2 text-[26px] font-semibold leading-none tracking-tight text-ink">{value}</div>
      {sub && <div className="mt-2 text-[12px] text-ink-3">{sub}</div>}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, className, bodyClassName }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={clsx("card", className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-[14px] font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[12px] text-ink-3">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={clsx("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Progress({ value, tone = "ok" }: { value: number; tone?: Tone }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-soft">
      <div className={clsx("h-full rounded-full", DOT[tone])} style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-brand-soft text-brand">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M4 12h10M4 17h7" strokeLinecap="round" /></svg>
      </div>
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {children && <p className="mt-1 max-w-md text-[13px] text-ink-3">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
