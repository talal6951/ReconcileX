import clsx from "clsx";
import Link from "next/link";

export function LogoMark({ className }: { className?: string }) {
  return (
    <div className={clsx("relative grid place-items-center rounded-[9px] bg-gradient-to-br from-[#4a7dff] to-[#1b3db5] shadow-[0_0_0_1px_rgba(255,255,255,0.12)_inset,0_6px_16px_-6px_rgba(59,116,255,0.7)]", className ?? "h-8 w-8")}>
      <svg viewBox="0 0 24 24" className="h-[55%] w-[55%]" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round">
        <path d="M6 6l12 12" />
        <path d="M18 6L6 18" opacity="0.65" />
      </svg>
    </div>
  );
}

export function Wordmark({ dark = true, href = "/" }: { dark?: boolean; href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5" aria-label="Reconcile X home">
      <LogoMark />
      <span className={clsx("text-[16px] font-semibold tracking-tight", dark ? "text-white" : "text-ink")}>
        Reconcile <span className={dark ? "text-[#8fb0ff]" : "text-brand"}>X</span>
      </span>
    </Link>
  );
}
