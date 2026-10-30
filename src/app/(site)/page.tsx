import {
  ArrowRight,
  BrainCircuit,
  Check,
  FileCheck2,
  FileSearch,
  FileSpreadsheet,
  Fingerprint,
  GitMerge,
  Layers,
  Lock,
  ScrollText,
  ShieldCheck,
  Split,
  UserCheck,
} from "lucide-react";
import Link from "next/link";
import { LogoMark, Wordmark } from "@/components/site/brand";
import { benchmarks } from "@/lib/benchmarks";
import { routes } from "@/lib/routes";

const pct = (v: number | null, d = 1) => (v === null ? "n/a" : `${(v * 100).toFixed(d)}%`);

export default function Home() {
  const b = benchmarks();
  return (
    <div className="bg-white text-ink">
      <SiteHeader />
      <Hero />
      <ProofStrip b={b} />
      <Problem />
      <Features />
      <HowItWorks />
      <InvestigationShowcase />
      <Trust b={b} />
      <FinalCta />
      <SiteFooter />
    </div>
  );
}

function SiteHeader() {
  return (
    <header className="absolute inset-x-0 top-0 z-30">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 md:px-8">
        <Wordmark />
        <nav className="hidden items-center gap-8 text-[13.5px] font-medium text-slate-300 md:flex">
          <a href="#product" className="hover:text-white">Product</a>
          <a href="#how" className="hover:text-white">How it works</a>
          <a href="#trust" className="hover:text-white">Security</a>
        </nav>
        <div className="flex items-center gap-2">
          <Link href={routes.signIn} className="hidden rounded-lg px-3 py-2 text-[13.5px] font-medium text-slate-200 hover:text-white sm:block">
            Sign in
          </Link>
          <Link href={routes.signUp} className="rounded-lg bg-white px-3.5 py-2 text-[13.5px] font-semibold text-navy-900 shadow-sm hover:bg-slate-100">
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden bg-navy-950 pt-32 pb-24 md:pt-40 md:pb-32">
      {/* Grid + glow */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage: "linear-gradient(rgba(143,176,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(143,176,255,0.08) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(ellipse 80% 60% at 50% 30%, black 40%, transparent 100%)",
        }}
      />
      <div aria-hidden className="absolute -top-40 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-[#2458e6] opacity-25 blur-[140px]" />
      <div className="relative mx-auto max-w-7xl px-5 md:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[12px] font-medium text-slate-300 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Reconciliation engine · deterministic rules + explainable ML
          </div>
          <h1 className="text-[40px] leading-[1.05] font-semibold tracking-[-0.03em] text-white md:text-[64px]">
            Close the books on
            <br />
            <span className="bg-gradient-to-r from-[#9db8ff] via-white to-[#9db8ff] bg-clip-text text-transparent">every transaction.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-[16px] leading-relaxed text-slate-300 md:text-[18px]">
            Reconcile X matches bank statements to your ledger in seconds, explains every suggestion, investigates every exception with real evidence — and never approves anything it can’t prove.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href={routes.signUp} className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#3b6cff] px-5 text-[14px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(59,108,255,0.8)] hover:bg-[#2f5ff0]">
              Get started free <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href={`${routes.signUp}?demo=1`} className="inline-flex h-11 items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-5 text-[14px] font-semibold text-white backdrop-blur hover:bg-white/10">
              Try the demo
            </Link>
          </div>
          <p className="mt-4 text-[12px] text-slate-400">Demo runs on synthetic data. No bank credentials required.</p>
        </div>
        <ProductPreview />
      </div>
    </section>
  );
}

/** Illustrative product preview built from synthetic sample rows (not a screenshot of customer data). */
function ProductPreview() {
  const rows = [
    { b: "ACH CREDIT NORTHWIND INV-48213", a: "12,480.00", l: "INV-48213 · Northwind Traders", la: "12,480.00", s: "Verified", tone: "ok", score: "rule" },
    { b: "WIRE IN GLOBEX REF INV-48190", a: "3,904.50", l: "INV-48190 · Globex Corporation", la: "3,904.50", s: "Verified", tone: "ok", score: "rule" },
    { b: "ACH CREDIT INITECH SYSTEMS", a: "7,215.35", l: "INV-48231 · Initech Systems", la: "7,250.00", s: "Needs review", tone: "warn", score: "94%" },
    { b: "STRIPE PAYOUT", a: "2,118.40", l: "3 card sales · SALE-91…", la: "2,118.40", s: "Split · suggested", tone: "info", score: "Σ" },
    { b: "MONTHLY SERVICE FEE", a: "-25.00", l: "No ledger entry", la: "—", s: "Exception", tone: "bad", score: "—" },
  ] as const;
  const toneCls = { ok: "bg-emerald-400/15 text-emerald-300", warn: "bg-amber-400/15 text-amber-300", info: "bg-blue-400/15 text-blue-300", bad: "bg-rose-400/15 text-rose-300" };
  return (
    <div className="relative mx-auto mt-16 max-w-5xl md:mt-20">
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-2 shadow-[0_40px_120px_-30px_rgba(36,88,230,0.55)] backdrop-blur">
        <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0c1830]">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-3">
              <LogoMark className="h-6 w-6" />
              <span className="text-[13px] font-semibold text-white">Operating account · October</span>
              <span className="hidden rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-400 sm:inline">Synthetic sample</span>
            </div>
            <div className="hidden gap-4 text-[11.5px] text-slate-400 md:flex">
              <span><b className="text-emerald-300">Verified</b> by rule</span>
              <span><b className="text-amber-300">Review</b> by people</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[12.5px]">
              <thead>
                <tr className="text-[10.5px] tracking-wider text-slate-500 uppercase">
                  <th className="px-4 py-2.5 font-medium">Bank statement</th>
                  <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-2 py-2.5 text-center font-medium">Score</th>
                  <th className="px-4 py-2.5 font-medium">Ledger</th>
                  <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {rows.map((r) => (
                  <tr key={r.b} className="border-t border-white/5">
                    <td className="px-4 py-3 font-medium text-slate-200">{r.b}</td>
                    <td className="px-4 py-3 text-right text-slate-200">{r.a}</td>
                    <td className="px-2 py-3 text-center text-[11px] text-slate-400">{r.score}</td>
                    <td className="px-4 py-3 text-slate-300">{r.l}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{r.la}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${toneCls[r.tone]}`}>{r.s}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="absolute -right-4 -bottom-10 hidden w-72 rounded-xl border border-white/10 bg-[#0f1f3d]/95 p-4 text-left shadow-2xl backdrop-blur lg:block">
        <div className="text-[10px] font-semibold tracking-[0.14em] text-[#8fb0ff] uppercase">Investigation</div>
        <p className="mt-1.5 text-[13px] font-medium text-white">Bank amount 0.48% lower than invoice</p>
        <p className="mt-1 text-[12px] leading-relaxed text-slate-400">Consistent with a processing fee netted from the payment. Evidence: E1, E2, E4.</p>
        <div className="mt-3 flex gap-2">
          <span className="rounded-md bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold text-emerald-300">Approve</span>
          <span className="rounded-md bg-white/5 px-2 py-1 text-[11px] font-semibold text-slate-300">Reject</span>
        </div>
      </div>
    </div>
  );
}

function ProofStrip({ b }: { b: ReturnType<typeof benchmarks> }) {
  const items = [
    { v: pct(b.verifiedPrecision), l: "of rule-verified matches correct", s: `${b.verifiedCorrect.toLocaleString("en-US")} / ${b.verifiedCount.toLocaleString("en-US")} on held-out data` },
    { v: pct(b.modelF1), l: "F1 for ML match ranking", s: `vs ${pct(b.baselineF1)} for a rules-only baseline` },
    { v: `${b.avgMs} ms`, l: "to reconcile ~" + b.avgRows.toLocaleString("en-US") + " rows", s: "measured, single machine" },
    { v: "0", l: "uncertain matches auto-approved", s: "by design — people decide" },
  ];
  return (
    <section className="border-b border-line bg-white">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-px bg-line md:grid-cols-4">
        {items.map((i) => (
          <div key={i.l} className="bg-white px-5 py-8 md:px-8">
            <div className="tabular text-[28px] font-semibold tracking-tight text-ink md:text-[34px]">{i.v}</div>
            <div className="mt-1 text-[13px] font-medium text-ink-2">{i.l}</div>
            <div className="mt-0.5 text-[12px] text-ink-3">{i.s}</div>
          </div>
        ))}
      </div>
      <p className="mx-auto max-w-7xl px-5 pb-6 text-[11.5px] text-ink-3 md:px-8">
        Benchmarks measured on synthetic bank/ledger data with known ground truth ({b.testSeeds} held-out datasets, model {b.modelVersion}). Real-world results depend on your data.
      </p>
    </section>
  );
}

function SectionHead({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <div className="text-[12px] font-semibold tracking-[0.14em] text-brand uppercase">{eyebrow}</div>
      <h2 className="mt-3 text-[30px] leading-tight font-semibold tracking-[-0.02em] text-ink md:text-[40px]">{title}</h2>
      <p className="mt-4 text-[15.5px] leading-relaxed text-ink-3">{body}</p>
    </div>
  );
}

function Problem() {
  return (
    <section className="bg-canvas py-20 md:py-28">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 md:px-8 lg:grid-cols-2">
        <div>
          <div className="text-[12px] font-semibold tracking-[0.14em] text-brand uppercase">The problem</div>
          <h2 className="mt-3 text-[30px] leading-tight font-semibold tracking-[-0.02em] md:text-[40px]">Spreadsheets don’t scale. Black boxes don’t pass audit.</h2>
          <p className="mt-5 text-[15.5px] leading-relaxed text-ink-3">
            Finance teams spend days ticking bank lines against ledger entries, chasing fees, split payments, processor payouts and duplicates. Automation tools that “auto-match” without showing their reasoning create a different problem: nobody can explain the result.
          </p>
          <p className="mt-4 text-[15.5px] leading-relaxed text-ink-3">
            Reconcile X separates what can be <b className="text-ink">proven</b> from what is merely <b className="text-ink">likely</b> — and gives your team the evidence to decide the rest quickly.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { t: "Proven", d: "Same amount, currency and reference, unique on both sides. Verified automatically.", c: "border-emerald-200 bg-emerald-50 text-emerald-800" },
            { t: "Likely", d: "Ranked by a trained model with a per-feature explanation. Waits for approval.", c: "border-blue-200 bg-blue-50 text-blue-800" },
            { t: "Ambiguous", d: "Competing candidates too close to call. Flagged with alternatives side by side.", c: "border-amber-200 bg-amber-50 text-amber-800" },
            { t: "Exception", d: "Missing, duplicated or mismatched. Investigated automatically with cited evidence.", c: "border-rose-200 bg-rose-50 text-rose-800" },
          ].map((x) => (
            <div key={x.t} className={`rounded-xl border p-5 ${x.c}`}>
              <div className="text-[14px] font-semibold">{x.t}</div>
              <p className="mt-1.5 text-[13px] leading-relaxed opacity-90">{x.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const FEATURES = [
  { icon: FileSpreadsheet, t: "Statement import with verification", d: "CSV, Excel and text-based PDF statements. Strict validation, explicit column mapping, and a review step before anything is reconciled." },
  { icon: GitMerge, t: "Deterministic matching", d: "Transaction IDs and references matched exactly — in integer minor units, currency-aware, with uniqueness checks on both sides." },
  { icon: BrainCircuit, t: "Explainable machine learning", d: "A trained, evaluated model ranks fuzzy candidates and shows exactly which signals raised or lowered each score." },
  { icon: Split, t: "Splits & aggregated payouts", d: "Finds instalments and processor settlements whose parts sum exactly to the counterpart — and shows the arithmetic." },
  { icon: FileSearch, t: "Evidence-based investigations", d: "Every exception gets hypotheses ranked by support, each citing the transactions it relies on. No invented evidence." },
  { icon: UserCheck, t: "Human approval workflow", d: "Approve, reject or reopen with a recorded reason. Uncertain matches never become final without a person." },
  { icon: ScrollText, t: "Tamper-evident audit trail", d: "Every import, decision and export is written to a hash-chained, append-only log you can verify at any time." },
  { icon: FileCheck2, t: "Reports & exports", d: "Reconciliation summaries, exception registers and decision logs, exported to CSV and JSON for your close package." },
];

function Features() {
  return (
    <section id="product" className="scroll-mt-16 py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-5 md:px-8">
        <SectionHead eyebrow="Product" title="Everything between the statement and the sign-off" body="A complete reconciliation workspace — built for accuracy first, speed second, and explainability throughout." />
        <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, t, d }) => (
            <div key={t} className="bg-white p-6">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand-soft text-brand">
                <Icon className="h-[18px] w-[18px]" />
              </div>
              <h3 className="mt-4 text-[15px] font-semibold text-ink">{t}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-3">{d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { n: "01", t: "Import", d: "Upload a bank statement (CSV, Excel or PDF) and a ledger export. Map columns, then confirm extracted transactions and totals." },
    { n: "02", t: "Match", d: "Rules verify what’s provable. The model ranks the rest. Splits and payouts are solved by exact sums." },
    { n: "03", t: "Investigate", d: "Open any suggestion or exception to see the evidence, the model’s reasoning and the likely explanations." },
    { n: "04", t: "Approve & export", d: "Approve or reject with a reason, resolve exceptions, and export the report and audit trail." },
  ];
  return (
    <section id="how" className="scroll-mt-16 bg-navy-950 py-20 text-white md:py-28">
      <div className="mx-auto max-w-7xl px-5 md:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <div className="text-[12px] font-semibold tracking-[0.14em] text-[#8fb0ff] uppercase">How it works</div>
          <h2 className="mt-3 text-[30px] leading-tight font-semibold tracking-[-0.02em] md:text-[40px]">From two files to a signed-off reconciliation</h2>
        </div>
        <ol className="mt-14 grid gap-4 md:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.n} className="relative rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <div className="font-mono text-[12px] text-[#8fb0ff]">{s.n}</div>
              <h3 className="mt-3 text-[17px] font-semibold">{s.t}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-slate-400">{s.d}</p>
              {i < steps.length - 1 && <ArrowRight className="absolute top-6 -right-3 hidden h-5 w-5 text-slate-600 md:block" />}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function InvestigationShowcase() {
  return (
    <section className="py-20 md:py-28">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 md:px-8 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <div className="text-[12px] font-semibold tracking-[0.14em] text-brand uppercase">Investigations</div>
          <h2 className="mt-3 text-[30px] leading-tight font-semibold tracking-[-0.02em] md:text-[40px]">Answers you can defend — with the receipts attached.</h2>
          <p className="mt-5 text-[15.5px] leading-relaxed text-ink-3">
            For every unmatched or uncertain item, Reconcile X searches the full dataset — same amounts outside the window, shared references at different amounts, other currencies, duplicates, statement-period edges — and ranks explanations by how much evidence supports them.
          </p>
          <ul className="mt-6 space-y-2.5 text-[14px] text-ink-2">
            {["Every hypothesis cites specific transactions", "States plainly when nothing is found", "Recommends a next step — never takes it for you"].map((x) => (
              <li key={x} className="flex items-center gap-2.5">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-ok-soft text-ok">
                  <Check className="h-3 w-3" />
                </span>
                {x}
              </li>
            ))}
          </ul>
        </div>
        <div className="card overflow-hidden p-0">
          <div className="border-b border-line bg-navy-900 px-5 py-4">
            <div className="text-[10px] font-semibold tracking-[0.14em] text-[#8fb0ff] uppercase">Automated investigation · E-00214</div>
            <p className="mt-1 text-[14px] font-medium text-white">Ledger 1,240.00 USD on 2024-08-29 has no bank counterpart</p>
          </div>
          <div className="space-y-3 p-5">
            {[
              { t: "Timing difference (in transit)", s: "moderate", c: "bg-info-soft text-info", d: "Entry is within 5 days of the last bank date in the file; it may clear on the next statement.", e: ["E1", "E2"] },
              { t: "Recorded with a different amount", s: "moderate", c: "bg-info-soft text-info", d: "A bank record carries the same invoice reference for 1,215.20 USD (−24.80).", e: ["E1", "E3"] },
              { t: "Recorded with a different date", s: "weak", c: "bg-neutral-soft text-ink-2", d: "An identical amount exists 9 days later, outside the matching window.", e: ["E1", "E4"] },
            ].map((h) => (
              <div key={h.t} className="rounded-lg border border-line p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13.5px] font-semibold">{h.t}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${h.c}`}>{h.s} support</span>
                </div>
                <p className="mt-1 text-[12.5px] text-ink-3">{h.d}</p>
                <div className="mt-2 flex gap-1">
                  {h.e.map((e) => (
                    <span key={e} className="rounded bg-neutral-soft px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2">{e}</span>
                  ))}
                </div>
              </div>
            ))}
            <p className="text-[11px] text-ink-3">Illustrative example on synthetic data.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Trust({ b }: { b: ReturnType<typeof benchmarks> }) {
  const items = [
    { icon: Lock, t: "Exact money arithmetic", d: "All amounts are integer minor units. No floating point touches a balance, ever." },
    { icon: ShieldCheck, t: "Proof before automation", d: `Only rule-verified, uniquely-paired matches are auto-confirmed — ${pct(b.verifiedPrecision)} correct on held-out tests.` },
    { icon: Fingerprint, t: "Tamper-evident history", d: "SHA-256 hash-chained audit events; edits to history are detectable and blocked at the database." },
    { icon: Layers, t: "Isolated workspaces", d: "Each company workspace is separated with server-side access control on every request." },
  ];
  return (
    <section id="trust" className="scroll-mt-16 border-y border-line bg-canvas py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-5 md:px-8">
        <SectionHead eyebrow="Security & control" title="Built like financial infrastructure" body="Reconcile X reads your data; it never moves money, changes bank records, or makes the final call." />
        <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {items.map(({ icon: Icon, t, d }) => (
            <div key={t} className="card p-6">
              <Icon className="h-5 w-5 text-brand" />
              <h3 className="mt-4 text-[15px] font-semibold">{t}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-3">{d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="py-20 md:py-28">
      <div className="mx-auto max-w-5xl px-5 md:px-8">
        <div className="relative overflow-hidden rounded-3xl bg-navy-950 px-6 py-14 text-center md:px-16">
          <div aria-hidden className="absolute -top-24 left-1/2 h-72 w-[600px] -translate-x-1/2 rounded-full bg-[#2458e6] opacity-30 blur-[100px]" />
          <h2 className="relative text-[28px] leading-tight font-semibold tracking-[-0.02em] text-white md:text-[38px]">See it reconcile in under a minute.</h2>
          <p className="relative mx-auto mt-4 max-w-xl text-[15px] text-slate-300">Create a workspace, load the synthetic demo dataset, and walk through matching, investigation and approval end to end.</p>
          <div className="relative mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href={routes.signUp} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-white px-5 text-[14px] font-semibold text-navy-900 hover:bg-slate-100">
              Get started <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href={routes.signIn} className="inline-flex h-11 items-center justify-center rounded-lg border border-white/15 px-5 text-[14px] font-semibold text-white hover:bg-white/5">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-10 text-[12.5px] text-ink-3 md:flex-row md:items-center md:justify-between md:px-8">
        <Wordmark dark={false} />
        <p>Reconcile X does not initiate payments, modify bank accounts, or make financial decisions.</p>
        <p>© {new Date().getFullYear()} Reconcile X</p>
      </div>
    </footer>
  );
}
