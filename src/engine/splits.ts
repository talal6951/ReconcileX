import { absMinor } from "./money";
import { referenceLinked, type TxIndexEntry } from "./features";
import { jaroWinkler } from "./text";
import type { EngineConfig } from "./types";

export interface SplitProposal {
  /** The single transaction whose amount equals the sum of `parts`. */
  target: TxIndexEntry;
  parts: TxIndexEntry[];
  score: number;
  linkedParts: number;
  alternatives: { parts: TxIndexEntry[]; score: number }[];
}

const MAX_SOLUTIONS = 5;

/** Words too generic to count as evidence that two records involve the same party. */
const GENERIC_NAME_TOKENS = new Set([
  "BANK", "PAYMENT", "PAYMENTS", "LTD", "LIMITED", "CORP", "CORPORATION", "INC", "LLC", "LLP", "PLC", "GMBH",
  "SERVICES", "SERVICE", "GROUP", "COMPANY", "TRADING", "INTERNATIONAL", "HOLDINGS", "SYSTEMS",
]);

function nameTokens(counterpartyKey: string): string[] {
  return counterpartyKey.split(" ").filter((t) => t.length >= 4 && !GENERIC_NAME_TOKENS.has(t));
}

/**
 * Evidence that a candidate part relates to the target:
 * 1.0 shared reference/identifier, 0.8 near-identical counterparty,
 * 0.6 one side's counterparty name appears in the other's narrative
 * (e.g. bank "STRIPE PAYOUT" vs ledger "Card sale via Stripe"), else 0.
 */
export function relatedness(target: TxIndexEntry, part: TxIndexEntry): number {
  if (referenceLinked(target, part)) return 1;
  if (target.counterpartyKey && part.counterpartyKey) {
    const s = jaroWinkler(target.counterpartyKey, part.counterpartyKey);
    if (s >= 0.9) return 0.8;
  }
  const partWords = new Set(part.descTokens);
  if (nameTokens(target.counterpartyKey).some((t) => partWords.has(t))) return 0.6;
  const targetWords = new Set(target.descTokens);
  if (nameTokens(part.counterpartyKey).some((t) => targetWords.has(t))) return 0.6;
  return 0;
}

/**
 * Find subsets of `pool` (same currency/sign, within the date window) whose
 * amounts sum *exactly* to the target. Sums are bigint; there is no tolerance.
 * Returns proposals for review only — split matches are never auto-verified.
 */
export function findSplitMatches(
  targets: readonly TxIndexEntry[],
  pool: readonly TxIndexEntry[],
  config: EngineConfig,
): SplitProposal[] {
  const used = new Set<string>();
  const proposals: SplitProposal[] = [];
  const ordered = [...targets].sort((a, b) => {
    const d = absMinor(b.tx.amountMinor) - absMinor(a.tx.amountMinor);
    return d > 0n ? 1 : d < 0n ? -1 : a.tx.id.localeCompare(b.tx.id);
  });
  const byCurrency = new Map<string, TxIndexEntry[]>();
  for (const p of pool) {
    const arr = byCurrency.get(p.tx.currency);
    if (arr) arr.push(p);
    else byCurrency.set(p.tx.currency, [p]);
  }

  for (const target of ordered) {
    const T = absMinor(target.tx.amountMinor);
    const negative = target.tx.amountMinor < 0n;
    const cands = (byCurrency.get(target.tx.currency) ?? [])
      .filter(
        (p) =>
          !used.has(p.tx.id) &&
          (p.tx.amountMinor < 0n) === negative &&
          absMinor(p.tx.amountMinor) < T &&
          Math.abs(p.tx.day - target.tx.day) <= config.dateWindowDays,
      )
      .map((p) => ({ p, rel: relatedness(target, p), dd: Math.abs(p.tx.day - target.tx.day) }))
      .sort((a, b) => b.rel - a.rel || a.dd - b.dd || a.p.tx.id.localeCompare(b.p.tx.id))
      .slice(0, config.splitCandidatePool);
    if (cands.length < 2) continue;

    // DFS over candidates sorted by magnitude descending, pruning when the sum exceeds T.
    const items = [...cands].sort((a, b) => {
      const d = absMinor(b.p.tx.amountMinor) - absMinor(a.p.tx.amountMinor);
      return d > 0n ? 1 : d < 0n ? -1 : a.p.tx.id.localeCompare(b.p.tx.id);
    });
    const values = items.map((c) => absMinor(c.p.tx.amountMinor));
    const solutions: number[][] = [];
    const chosen: number[] = [];
    const dfs = (start: number, sum: bigint) => {
      if (solutions.length >= MAX_SOLUTIONS) return;
      if (sum === T && chosen.length >= 2) {
        solutions.push([...chosen]);
        return;
      }
      if (chosen.length >= config.maxSplitParts) return;
      for (let i = start; i < items.length; i++) {
        const next = sum + values[i]!;
        if (next > T) continue;
        chosen.push(i);
        dfs(i + 1, next);
        chosen.pop();
        if (solutions.length >= MAX_SOLUTIONS) return;
      }
    };
    dfs(0, 0n);
    if (solutions.length === 0) continue;

    const scored = solutions
      .map((sol) => {
        const parts = sol.map((i) => items[i]!);
        const linked = parts.filter((c) => c.rel > 0).length;
        const avgDd = parts.reduce((s, c) => s + c.dd, 0) / parts.length;
        const score = 0.4 + 0.4 * (linked / parts.length) + 0.2 * (1 - avgDd / Math.max(1, config.dateWindowDays));
        return { parts: parts.map((c) => c.p), score: Number(score.toFixed(4)), linked };
      })
      .sort((a, b) => b.score - a.score);
    const best = scored[0]!;
    proposals.push({
      target,
      parts: best.parts,
      score: best.score,
      linkedParts: best.linked,
      alternatives: scored.slice(1).map((s) => ({ parts: s.parts, score: s.score })),
    });
    best.parts.forEach((p) => used.add(p.tx.id));
  }
  return proposals;
}
