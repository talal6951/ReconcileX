import { absMinor, relativeDifference } from "./money";
import { identifierCrossHit, jaccard, jaroWinkler, normalizeReference, normalizeText, tokens } from "./text";
import type { EngineConfig, Transaction } from "./types";

/** Precomputed text keys so similarity work is done once per transaction. */
export interface TxIndexEntry {
  tx: Transaction;
  refKey: string;
  extKey: string;
  fullText: string;
  descTokens: string[];
  counterpartyKey: string;
}

export function indexTx(tx: Transaction): TxIndexEntry {
  return {
    tx,
    refKey: normalizeReference(tx.reference),
    extKey: normalizeReference(tx.externalId),
    fullText: `${tx.reference} ${tx.description}`,
    descTokens: tokens(`${tx.description} ${tx.counterparty}`),
    counterpartyKey: normalizeText(tx.counterparty),
  };
}

export const FEATURES = [
  { key: "amount_exact", label: "Amounts are exactly equal" },
  { key: "amount_rel_diff", label: "Relative amount difference (%)" },
  { key: "day_diff", label: "Date gap (relative to window)" },
  { key: "ref_similarity", label: "Reference similarity" },
  { key: "ref_exact", label: "References identical" },
  { key: "id_cross_hit", label: "Identifier found in other record" },
  { key: "desc_overlap", label: "Description word overlap" },
  { key: "counterparty_similarity", label: "Counterparty similarity" },
  { key: "external_id_equal", label: "Transaction IDs identical" },
  { key: "bank_candidates", label: "Competing candidates for bank row" },
  { key: "ledger_candidates", label: "Competing candidates for ledger row" },
  { key: "closest_amount", label: "Closest amount among candidates" },
  { key: "fee_pattern", label: "Bank amount slightly lower (fee-like)" },
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];
export const FEATURE_COUNT = FEATURES.length;

/** Marker for a feature whose inputs are absent. The model mean-imputes it (zero contribution). */
export const MISSING = Number.NaN;

/** True when the two records share a meaningful reference or identifier. */
export function referenceLinked(a: TxIndexEntry, b: TxIndexEntry): boolean {
  if (a.refKey.length >= 4 && a.refKey === b.refKey) return true;
  return identifierCrossHit(a.tx.reference, b.fullText) || identifierCrossHit(b.tx.reference, a.fullText);
}

export interface CandidatePair {
  bank: TxIndexEntry;
  ledger: TxIndexEntry;
  features: number[];
}

/**
 * Generate candidate pairs between unmatched bank and ledger rows.
 * Blocking: same currency, same sign, date within window, and either the
 * amount within tolerance or a shared reference/identifier.
 */
export function generateCandidates(
  bank: readonly TxIndexEntry[],
  ledger: readonly TxIndexEntry[],
  config: EngineConfig,
): CandidatePair[] {
  const tolBp = BigInt(Math.round(config.amountTolerancePct * 10_000));
  const byCurrency = new Map<string, TxIndexEntry[]>();
  for (const l of ledger) {
    const arr = byCurrency.get(l.tx.currency);
    if (arr) arr.push(l);
    else byCurrency.set(l.tx.currency, [l]);
  }
  for (const arr of byCurrency.values()) arr.sort((x, y) => (x.tx.amountMinor < y.tx.amountMinor ? -1 : x.tx.amountMinor > y.tx.amountMinor ? 1 : 0));
  // Reference index for linked candidates outside amount tolerance.
  const byRef = new Map<string, TxIndexEntry[]>();
  for (const l of ledger) {
    if (l.refKey.length < 4) continue;
    const arr = byRef.get(l.refKey);
    if (arr) arr.push(l);
    else byRef.set(l.refKey, [l]);
  }

  const raw: { b: TxIndexEntry; l: TxIndexEntry }[] = [];
  for (const b of bank) {
    const pool = byCurrency.get(b.tx.currency);
    if (!pool) continue;
    const a = b.tx.amountMinor;
    const span = (absMinor(a) * tolBp) / 10_000n;
    const lo = a - span, hi = a + span;
    // Binary search lower bound.
    let left = 0, right = pool.length;
    while (left < right) {
      const mid = (left + right) >> 1;
      if (pool[mid]!.tx.amountMinor < lo) left = mid + 1;
      else right = mid;
    }
    const seen = new Set<string>();
    for (let i = left; i < pool.length && pool[i]!.tx.amountMinor <= hi; i++) {
      const l = pool[i]!;
      if (Math.abs(l.tx.day - b.tx.day) > config.dateWindowDays) continue;
      if ((l.tx.amountMinor < 0n) !== (a < 0n)) continue;
      raw.push({ b, l });
      seen.add(l.tx.id);
    }
    const linked = new Set<TxIndexEntry>();
    if (b.refKey.length >= 4) byRef.get(b.refKey)?.forEach((l) => linked.add(l));
    for (const l of linked) {
      if (seen.has(l.tx.id) || l.tx.currency !== b.tx.currency) continue;
      if ((l.tx.amountMinor < 0n) !== (a < 0n)) continue;
      if (Math.abs(l.tx.day - b.tx.day) > config.dateWindowDays) continue;
      raw.push({ b, l });
      seen.add(l.tx.id);
    }
  }
  return featurize(raw, config);
}

/**
 * Additional pass for identifiers embedded in narratives (bank text containing a
 * ledger invoice number). Kept separate because it needs a token index.
 */
export function generateIdentifierCandidates(
  bank: readonly TxIndexEntry[],
  ledger: readonly TxIndexEntry[],
  existing: ReadonlySet<string>,
  config: EngineConfig,
): { b: TxIndexEntry; l: TxIndexEntry }[] {
  // Index each ledger reference under its longest digit run. A bank narrative is
  // probed with its digit substrings (bounded by the longest indexed key), and
  // every hit is confirmed with a full reference containment check.
  const byDigits = new Map<string, TxIndexEntry[]>();
  let maxKeyLen = 0;
  for (const l of ledger) {
    const run = longestDigitRun(l.refKey);
    if (l.refKey.length < 4 || run.length < MIN_ID_DIGITS) continue;
    const arr = byDigits.get(run);
    if (arr) arr.push(l);
    else byDigits.set(run, [l]);
    if (run.length > maxKeyLen) maxKeyLen = run.length;
  }
  const out: { b: TxIndexEntry; l: TxIndexEntry }[] = [];
  if (byDigits.size === 0) return out;
  const emitted = new Set<string>();
  for (const b of bank) {
    const hay = normalizeReference(b.fullText);
    const probed = new Set<string>();
    for (const run of hay.match(/\d+/g) ?? []) {
      if (run.length < MIN_ID_DIGITS) continue;
      for (let i = 0; i + MIN_ID_DIGITS <= run.length; i++) {
        const maxJ = Math.min(run.length, i + maxKeyLen);
        for (let j = i + MIN_ID_DIGITS; j <= maxJ; j++) {
          const sub = run.slice(i, j);
          if (probed.has(sub)) continue;
          probed.add(sub);
          for (const l of byDigits.get(sub) ?? []) {
            const pk = `${b.tx.id}|${l.tx.id}`;
            if (existing.has(pk) || emitted.has(pk)) continue;
            if (!hay.includes(l.refKey)) continue;
            if (l.tx.currency !== b.tx.currency) continue;
            if ((l.tx.amountMinor < 0n) !== (b.tx.amountMinor < 0n)) continue;
            if (Math.abs(l.tx.day - b.tx.day) > config.dateWindowDays) continue;
            emitted.add(pk);
            out.push({ b, l });
          }
        }
      }
    }
  }
  return out;
}

const MIN_ID_DIGITS = 4;

export function longestDigitRun(s: string): string {
  let best = "";
  for (const m of s.match(/\d+/g) ?? []) if (m.length > best.length) best = m;
  return best;
}

export function featurize(raw: { b: TxIndexEntry; l: TxIndexEntry }[], config: EngineConfig): CandidatePair[] {
  const bankCount = new Map<string, number>();
  const ledgerCount = new Map<string, number>();
  const bankMinDiff = new Map<string, bigint>();
  for (const { b, l } of raw) {
    bankCount.set(b.tx.id, (bankCount.get(b.tx.id) ?? 0) + 1);
    ledgerCount.set(l.tx.id, (ledgerCount.get(l.tx.id) ?? 0) + 1);
    const d = absMinor(b.tx.amountMinor - l.tx.amountMinor);
    const cur = bankMinDiff.get(b.tx.id);
    if (cur === undefined || d < cur) bankMinDiff.set(b.tx.id, d);
  }
  return raw.map(({ b, l }) => {
    const diff = absMinor(b.tx.amountMinor - l.tx.amountMinor);
    const rel = relativeDifference(b.tx.amountMinor, l.tx.amountMinor);
    // Similarities over fields that are absent on either side are MISSING (NaN),
    // not 0: absence of data is not evidence of a mismatch. The model imputes them.
    const refSim = b.refKey && l.refKey ? jaroWinkler(b.refKey, l.refKey) : MISSING;
    const crossHit = identifierCrossHit(l.tx.reference, b.fullText) || identifierCrossHit(b.tx.reference, l.fullText);
    const cpSim = b.counterpartyKey && l.counterpartyKey ? jaroWinkler(b.counterpartyKey, l.counterpartyKey) : MISSING;
    const descSim = b.descTokens.length && l.descTokens.length ? jaccard(b.descTokens, l.descTokens) : MISSING;
    const feePattern = absMinor(b.tx.amountMinor) < absMinor(l.tx.amountMinor) && diff > 0n && rel <= 0.03 ? 1 : 0;
    const features = [
      diff === 0n ? 1 : 0,
      // Percentage difference, capped at 100% so large gaps (e.g. a 40% instalment) stay distinguishable from fees.
      Math.min(rel * 100, 100),
      Math.abs(b.tx.day - l.tx.day) / Math.max(1, config.dateWindowDays),
      refSim,
      b.refKey.length >= 4 && b.refKey === l.refKey ? 1 : 0,
      crossHit ? 1 : 0,
      descSim,
      cpSim,
      b.extKey.length >= 3 && b.extKey === l.extKey ? 1 : 0,
      Math.log1p((bankCount.get(b.tx.id) ?? 1) - 1),
      Math.log1p((ledgerCount.get(l.tx.id) ?? 1) - 1),
      diff === bankMinDiff.get(b.tx.id) ? 1 : 0,
      feePattern,
    ];
    return { bank: b, ledger: l, features };
  });
}

/** Full candidate generation: amount/ref blocking plus narrative identifier hits. */
export function buildCandidates(bank: readonly TxIndexEntry[], ledger: readonly TxIndexEntry[], config: EngineConfig): CandidatePair[] {
  const base = generateCandidates(bank, ledger, config);
  const keys = new Set(base.map((p) => `${p.bank.tx.id}|${p.ledger.tx.id}`));
  const extra = generateIdentifierCandidates(bank, ledger, keys, config);
  if (extra.length === 0) return base;
  return featurize([...base.map((p) => ({ b: p.bank, l: p.ledger })), ...extra], config);
}
