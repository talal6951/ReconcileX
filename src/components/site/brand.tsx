import clsx from "clsx";
import Link from "next/link";

/**
 * "Convergence" mark: four entries pointing at one verified (gold) point, on a charcoal tile.
 * Geometry is drawn on a 32-unit grid so the gold centre stays legible at 16px.
 * Keep in sync with src/app/icon.svg.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={clsx("shrink-0", className ?? "h-8 w-8")} aria-hidden>
      <rect width="32" height="32" rx="7.5" fill="#16161a" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="7" fill="none" stroke="#2a2a30" />
      <path d="M7 7L12 12M25 7L20 12M7 25L12 20M25 25L20 20" fill="none" stroke="#edeae3" strokeWidth="4" />
      <path d="M16 11.8L20.2 16L16 20.2L11.8 16Z" fill="#c8a96a" />
    </svg>
  );
}

export function Wordmark({ dark = true, href = "/" }: { dark?: boolean; href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5" aria-label="Reconcile X home">
      <LogoMark />
      <span className={clsx("text-[16px] font-semibold tracking-tight", dark ? "text-white" : "text-ink")}>
        Reconcile <span className={dark ? "text-champagne" : "text-brand"}>X</span>
      </span>
    </Link>
  );
}
