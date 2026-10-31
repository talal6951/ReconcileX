import { AlertTriangle, BrainCircuit, CheckCircle2, GitMerge, ListChecks, Split } from "lucide-react";
import { Calibration, PrCurve } from "@/components/model-charts";
import { Badge, Card, PageHeader } from "@/components/ui";
import anomalyEvaluation from "@/engine/model/anomaly-evaluation.json";
import evaluation from "@/engine/model/evaluation.json";
import { DEFAULT_CONFIG } from "@/engine/types";
import { int, METHOD_LABEL, pct } from "@/lib/format";
import { workspaceModelUsage } from "@/server/service";
import { requireWorkspacePage } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Matching model" };

const STAGES = [
  {
    icon: GitMerge,
    title: "1 · Deterministic rules",
    status: "Verified",
    tone: "ok" as const,
    body: "Same transaction ID — or same amount, currency and a shared reference/invoice number — within the date window. Verified only if the pairing is unique on both sides; otherwise it is passed on for review.",
  },
  {
    icon: Split,
    title: "2 · Reference-linked splits",
    status: "Suggested",
    tone: "info" as const,
    body: "Instalments or payouts where every part carries the counterpart’s reference and the parts sum exactly (in integer minor units) to it.",
  },
  {
    icon: BrainCircuit,
    title: "3 · ML-ranked candidates",
    status: "Suggested / Needs review",
    tone: "warn" as const,
    body: `Remaining pairs in the same currency and date window are scored by a logistic-regression model. Pairs at or above ${pct(DEFAULT_CONFIG.minSuggestProbability, 0)} are proposed; if a competitor scores within ${Math.round(DEFAULT_CONFIG.ambiguityMargin * 100)} points the match is flagged ambiguous.`,
  },
  {
    icon: ListChecks,
    title: "4 · Exact-sum aggregates & exceptions",
    status: "Needs review / Exception",
    tone: "bad" as const,
    body: "Unlinked exact-sum groups (e.g. processor payouts) are proposed with low confidence. Everything left becomes an exception: missing, duplicate, amount or currency mismatch.",
  },
];

export default async function ModelPage() {
  const ctx = await requireWorkspacePage();
  const usage = workspaceModelUsage(ctx);
  const e = evaluation;
  const verifiedTotals = e.pipeline.reduce((s, p) => ({ c: s.c + p.evaluation.verified.correct, n: s.n + p.evaluation.verified.count }), { c: 0, n: 0 });
  const features = [...e.features].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  const maxW = Math.max(...features.map((f) => Math.abs(f.weight)));

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Transparency"
        title="How matching works"
        description="Reconcile X separates what it can prove from what it can only estimate. This page shows the rules, the model, how it was measured — and what it has not been tested on."
      />

      <div className="flex gap-3 rounded-xl border border-warn/30 bg-warn-soft p-4 text-[13px]">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
        <div>
          <div className="font-semibold text-warn">Not validated on real-world bank data</div>
          <p className="mt-0.5 text-ink-2">
            All accuracy figures below come from synthetic datasets generated with known ground truth ({e.dataset.testSeeds.length} held-out datasets). Real statements contain patterns the generator does not, so treat model scores as rankings to review — never as proof. Only rule-verified matches are confirmed automatically.
          </p>
        </div>
      </div>

      <Card title="The matching pipeline" subtitle="Each stage only sees transactions the previous stages left unmatched">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {STAGES.map(({ icon: Icon, title, status, tone, body }) => (
            <div key={title} className="rounded-lg border border-line p-4">
              <div className="flex items-center justify-between gap-2">
                <Icon className="h-5 w-5 text-brand" />
                <Badge tone={tone} dot={false}>{status}</Badge>
              </div>
              <h3 className="mt-3 text-[14px] font-semibold">{title}</h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-3">{body}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Confidence levels" subtitle="What each status means">
          <ul className="space-y-3 text-[13px]">
            <Level tone="ok" label="Verified" text="A deterministic rule holds and the pairing is unique. No model involved." />
            <Level tone="ok" label="Approved" text="A reviewer accepted a proposed match, with a recorded reason." />
            <Level tone="info" label="Suggested" text="Model probability ≥ 50% and no close competitor. Still requires approval." />
            <Level tone="warn" label="Needs review" text="Ambiguous, involves a duplicate, or an unlinked split. Compare alternatives." />
            <Level tone="bad" label="Rejected / Exception" text="Not a match, or no counterpart found. Investigated with cited evidence." />
          </ul>
        </Card>
        <Card className="lg:col-span-2" title="Measured on synthetic held-out data" subtitle={`Model ${e.modelVersion} · ${int(e.dataset.testPairs)} candidate pairs (${int(e.dataset.testPositives)} true matches) · generated ${e.generatedAt.slice(0, 10)}`}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Rule-verified correct" value={pct(verifiedTotals.n ? verifiedTotals.c / verifiedTotals.n : null, 2)} sub={`${int(verifiedTotals.c)} of ${int(verifiedTotals.n)}`} />
            <Metric label="ML F1" value={pct(e.model.f1, 2)} sub={`baseline ${pct(e.baseline.f1, 2)}`} />
            <Metric label="ML precision @ 50%" value={pct(e.model.precision, 2)} sub={`recall ${pct(e.model.recall, 2)}`} />
            <Metric label="ROC-AUC" value={pct(e.model.rocAuc, 2)} sub={`avg precision ${pct(e.model.averagePrecision, 2)}`} />
          </div>
          <p className="mt-3 text-[11.5px] text-ink-3">{e.scope} Baseline: {e.baseline.description}.</p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Precision vs recall" subtitle="Held-out synthetic pairs; higher and further right is better">
          <PrCurve model={e.model.prCurve} baseline={e.baseline.prCurve} />
        </Card>
        <Card title="Calibration" subtitle="When the model says 80%, how often is it right? Dots on the diagonal are well calibrated">
          <Calibration bins={e.model.calibration} />
        </Card>
      </div>

      <Card title="What the model looks at" subtitle="Standardised logistic-regression weights. Every suggestion in the workspace shows these contributions for that specific pair." bodyClassName="p-0">
        <div className="divide-y divide-line">
          {features.map((f) => (
            <div key={f.key} className="grid grid-cols-[1fr_minmax(120px,240px)_64px] items-center gap-3 px-4 py-2.5 text-[13px]">
              <div className="min-w-0">
                <div className="truncate font-medium text-ink">{f.label}</div>
                <div className="font-mono text-[10.5px] text-ink-3">{f.key}</div>
              </div>
              <div className="relative h-2 rounded bg-neutral-soft">
                <div className="absolute top-0 bottom-0 left-1/2 w-px bg-line-strong" />
                <div className={`absolute top-0 bottom-0 rounded ${f.weight >= 0 ? "left-1/2 bg-ok" : "right-1/2 bg-bad"}`} style={{ width: `${(Math.abs(f.weight) / maxW) * 50}%` }} />
              </div>
              <div className={`tabular text-right font-medium ${f.weight >= 0 ? "text-ok" : "text-bad"}`}>{f.weight >= 0 ? "+" : ""}{f.weight.toFixed(2)}</div>
            </div>
          ))}
        </div>
        <p className="border-t border-line px-4 py-3 text-[11.5px] text-ink-3">
          Weights near zero (identical references, identical transaction IDs) are expected: those cases are resolved by the deterministic rules before the model runs, so the model rarely sees them. Weights describe the model’s behaviour, not causal importance.
        </p>
      </Card>

      <Card title="In this workspace" subtitle={`Real usage across ${int(usage.runs)} reconciliation${usage.runs === 1 ? "" : "s"} in ${ctx.orgName}`} bodyClassName="p-0">
        {usage.byMethod.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-ink-3">No reconciliations in this workspace yet.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="tabular w-full min-w-[640px] text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-3">
                    <th className="px-4 py-2.5 font-semibold">Method</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Matches</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Verified</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Awaiting review</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Approved</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Rejected</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.byMethod.map((m) => (
                    <tr key={m.method} className="border-b border-line last:border-0">
                      <td className="px-4 py-2.5 font-medium">{METHOD_LABEL[m.method] ?? m.method}</td>
                      <td className="px-4 py-2.5 text-right">{int(m.total)}</td>
                      <td className="px-4 py-2.5 text-right text-ok">{int(m.verified)}</td>
                      <td className="px-4 py-2.5 text-right text-warn">{int(m.suggested + m.needsReview)}</td>
                      <td className="px-4 py-2.5 text-right">{int(m.approved)}</td>
                      <td className="px-4 py-2.5 text-right text-bad">{int(m.rejected)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {usage.mlBands.length > 0 && (
              <div className="border-t border-line px-4 py-4">
                <h3 className="text-[13px] font-semibold">Reviewer agreement with ML suggestions, by score</h3>
                <p className="mt-0.5 text-[12px] text-ink-3">Of the model’s suggestions that reviewers have decided, how many they approved. This reflects your team’s judgement on your data — a useful signal, but not a formal validation.</p>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  {usage.mlBands.map((b) => {
                    const decided = b.approved + b.rejected;
                    return (
                      <div key={b.band} className="rounded-lg border border-line p-3">
                        <div className="text-[12px] text-ink-3">Score {b.band}</div>
                        <div className="tabular mt-1 text-[20px] font-semibold">{decided ? pct(b.approved / decided, 0) : "—"}</div>
                        <div className="tabular text-[11.5px] text-ink-3">
                          {decided ? `${int(b.approved)} approved / ${int(b.rejected)} rejected` : "no decisions yet"} · {int(b.undecided)} undecided
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      <Card title="Statistical insights" subtitle="Descriptive statistics shown on each reconciliation’s Insights tab — no training involved">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="text-[13px] leading-relaxed text-ink-2">
            <h3 className="font-semibold text-ink">Unusual amounts — robust z-score</h3>
            <p className="mt-1">
              Within each counterparty’s own history (≥ {anomalyEvaluation.minGroupSize} payments), z = 0.6745·(x − median)/MAD on log amounts. Median and MAD are used because the mean and standard deviation are pulled towards the very outliers being searched for. |z| &gt; {anomalyEvaluation.defaultThreshold} is flagged.
            </p>
            <h3 className="mt-4 font-semibold text-ink">First-digit test — Benford’s law</h3>
            <p className="mt-1">Pearson χ² with 8 degrees of freedom; p-value computed numerically. A dataset-level indicator only: many legitimate datasets (fixed prices, round amounts) don’t follow Benford.</p>
          </div>
          <div>
            <div className="text-[12px] text-ink-3">
              Measured on a synthetic benchmark: {int(anomalyEvaluation.benchmark.transactions)} transactions, {int(anomalyEvaluation.benchmark.injectedAnomalies)} injected anomalies
            </div>
            <table className="tabular mt-2 w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-3">
                  <th className="py-1.5 font-semibold">Threshold</th>
                  <th className="py-1.5 text-right font-semibold">Precision</th>
                  <th className="py-1.5 text-right font-semibold">Recall</th>
                  <th className="py-1.5 text-right font-semibold">F1</th>
                </tr>
              </thead>
              <tbody>
                {anomalyEvaluation.results.map((r) => (
                  <tr key={r.threshold} className={`border-b border-line last:border-0 ${r.threshold === anomalyEvaluation.defaultThreshold ? "font-semibold text-ink" : "text-ink-2"}`}>
                    <td className="py-1.5">
                      {r.threshold}
                      {r.threshold === anomalyEvaluation.defaultThreshold ? " (default)" : ""}
                    </td>
                    <td className="py-1.5 text-right">{pct(r.precision)}</td>
                    <td className="py-1.5 text-right">{pct(r.recall)}</td>
                    <td className="py-1.5 text-right">{pct(r.f1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11.5px] text-ink-3">The published 3.5 cut-off is kept even though 4.0 scores higher here — tuning to a self-generated benchmark would overfit to its assumptions.</p>
          </div>
        </div>
      </Card>

      <Card title="Known limitations">
        <ul className="grid gap-x-8 gap-y-2 text-[13px] text-ink-2 md:grid-cols-2">
          {[
            "Trained and evaluated only on synthetic data; accuracy on real statements is unmeasured.",
            "Logistic regression is linear: it cannot express every interaction (e.g. a shared invoice number with a large amount gap). Structural rules handle known cases such as linked splits.",
            "Candidates must share currency and fall within the date window; cross-currency pairs become exceptions, never matches.",
            "Exact-sum split detection can find coincidental sums, especially with round amounts — always reviewed.",
            "Scores are relative rankings for review prioritisation, not probabilities you should act on without checking.",
            "Thresholds (≥ 50% to suggest, 15-point ambiguity margin) are fixed defaults, not tuned to your data.",
          ].map((t) => (
            <li key={t} className="flex gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
              {t}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Level({ tone, label, text }: { tone: "ok" | "info" | "warn" | "bad"; label: string; text: string }) {
  return (
    <li className="flex items-start gap-3">
      <Badge tone={tone} className="mt-0.5 w-36 shrink-0 justify-center self-start">{label}</Badge>
      <span className="text-ink-2">{text}</span>
    </li>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="text-[11.5px] text-ink-3">{label}</div>
      <div className="tabular mt-1 text-[22px] font-semibold tracking-tight">{value}</div>
      <div className="tabular text-[11.5px] text-ink-3">{sub}</div>
    </div>
  );
}
