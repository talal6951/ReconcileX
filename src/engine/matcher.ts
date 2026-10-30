import { findDuplicates } from "./duplicates";
import { buildCandidates, FEATURES, indexTx, referenceLinked, type CandidatePair, type TxIndexEntry } from "./features";
import { absMinor, sumMinor, formatMoney } from "./money";
import { assertCompatible, explain, predict, type LogisticModel } from "./model";
import { findSplitMatches, type SplitProposal } from "./splits";
import {
  DEFAULT_CONFIG,
  type CurrencyTotals,
  type EngineConfig,
  type ExceptionType,
  type Match,
  type MatchFlag,
  type ReconException,
  type ReconciliationResult,
  type Transaction,
} from "./types";

export const ENGINE_VERSION = "1.0.0";

interface DeterministicOutcome {
  matches: Omit<Match, "id">[];
  usedBank: Set<string>;
  usedLedger: Set<string>;
}

function amountKey(t: Transaction): string {
  return `${t.currency}|${t.amountMinor.toString()}`;
}

/**
 * Deterministic rules. A pair is VERIFIED only when the rule holds AND the pair
 * is unique: neither transaction satisfies the same rule with any other row.
 */
export function deterministicPass(bank: TxIndexEntry[], ledger: TxIndexEntry[], config: EngineConfig): DeterministicOutcome {
  const usedBank = new Set<string>();
  const usedLedger = new Set<string>();
  const matches: Omit<Match, "id">[] = [];

  const emit = (b: TxIndexEntry, l: TxIndexEntry, method: Match["method"], reasons: string[], uniqueness: string) => {
    usedBank.add(b.tx.id);
    usedLedger.add(l.tx.id);
    matches.push({
      kind: "one_to_one",
      status: "verified",
      method,
      score: 1,
      bankIds: [b.tx.id],
      ledgerIds: [l.tx.id],
      currency: b.tx.currency,
      bankTotalMinor: b.tx.amountMinor,
      ledgerTotalMinor: l.tx.amountMinor,
      flags: [],
      evidence: {
        reasons,
        amountDifferenceMinor: "0",
        dayDifference: b.tx.day - l.tx.day,
        uniqueness,
      },
    });
  };

  // Rule A: identical transaction ID, currency and amount, date within window, ID unique on both sides.
  const extBank = new Map<string, TxIndexEntry[]>();
  const extLedger = new Map<string, TxIndexEntry[]>();
  for (const b of bank) if (b.extKey.length >= 3) (extBank.get(b.extKey) ?? extBank.set(b.extKey, []).get(b.extKey)!).push(b);
  for (const l of ledger) if (l.extKey.length >= 3) (extLedger.get(l.extKey) ?? extLedger.set(l.extKey, []).get(l.extKey)!).push(l);
  for (const [key, bs] of extBank) {
    const ls = extLedger.get(key);
    if (!ls || bs.length !== 1 || ls.length !== 1) continue;
    const b = bs[0]!, l = ls[0]!;
    const dd = Math.abs(b.tx.day - l.tx.day);
    if (b.tx.currency !== l.tx.currency || b.tx.amountMinor !== l.tx.amountMinor || dd > config.dateWindowDays) continue;
    emit(
      b,
      l,
      "rule_external_id",
      [
        `Transaction ID "${b.tx.externalId}" is identical on both sides`,
        `Amount ${formatMoney(b.tx.amountMinor, b.tx.currency)} is identical`,
        `Dates ${b.tx.date} / ${l.tx.date} are ${dd} day(s) apart (window ${config.dateWindowDays})`,
      ],
      "The transaction ID occurs exactly once in each dataset",
    );
  }

  // Rule B: identical currency and amount, shared reference/identifier, date within window, unique pairing.
  const ledgerByAmount = new Map<string, TxIndexEntry[]>();
  for (const l of ledger) {
    if (usedLedger.has(l.tx.id)) continue;
    const k = amountKey(l.tx);
    (ledgerByAmount.get(k) ?? ledgerByAmount.set(k, []).get(k)!).push(l);
  }
  const links: [TxIndexEntry, TxIndexEntry][] = [];
  const degBank = new Map<string, number>();
  const degLedger = new Map<string, number>();
  for (const b of bank) {
    if (usedBank.has(b.tx.id)) continue;
    for (const l of ledgerByAmount.get(amountKey(b.tx)) ?? []) {
      if (Math.abs(b.tx.day - l.tx.day) > config.dateWindowDays) continue;
      if (!referenceLinked(b, l)) continue;
      links.push([b, l]);
      degBank.set(b.tx.id, (degBank.get(b.tx.id) ?? 0) + 1);
      degLedger.set(l.tx.id, (degLedger.get(l.tx.id) ?? 0) + 1);
    }
  }
  for (const [b, l] of links) {
    if (degBank.get(b.tx.id) !== 1 || degLedger.get(l.tx.id) !== 1) continue;
    const dd = Math.abs(b.tx.day - l.tx.day);
    const sameRef = b.refKey.length >= 4 && b.refKey === l.refKey;
    emit(
      b,
      l,
      "rule_exact_reference",
      [
        sameRef
          ? `Reference "${l.tx.reference}" is identical on both sides`
          : `Ledger reference "${l.tx.reference || b.tx.reference}" appears in the counterpart record`,
        `Amount ${formatMoney(b.tx.amountMinor, b.tx.currency)} is identical`,
        `Dates ${b.tx.date} / ${l.tx.date} are ${dd} day(s) apart (window ${config.dateWindowDays})`,
      ],
      "No other transaction on either side shares this amount, currency and reference within the date window",
    );
  }
  return { matches, usedBank, usedLedger };
}

interface Scored extends CandidatePair {
  p: number;
}

function flagsFor(b: Transaction[], l: Transaction[], p: number, config: EngineConfig): MatchFlag[] {
  const flags: MatchFlag[] = [];
  if (sumMinor(b.map((t) => t.amountMinor)) !== sumMinor(l.map((t) => t.amountMinor))) flags.push("amount_difference");
  const maxDd = Math.max(...b.flatMap((x) => l.map((y) => Math.abs(x.day - y.day))));
  if (maxDd > Math.min(2, config.dateWindowDays)) flags.push("date_lag");
  if (p < 0.7) flags.push("low_confidence");
  return flags;
}

/** Greedy 1:1 assignment on model probability, then an ambiguity check against unresolved competitors. */
function assignScored(scored: Scored[], config: EngineConfig): { pair: Scored; competitors: Scored[] }[] {
  const order = [...scored].sort(
    (a, b) => b.p - a.p || a.bank.tx.id.localeCompare(b.bank.tx.id) || a.ledger.tx.id.localeCompare(b.ledger.tx.id),
  );
  const bankAssigned = new Map<string, Scored>();
  const ledgerAssigned = new Map<string, Scored>();
  for (const s of order) {
    if (s.p < config.minSuggestProbability) break;
    if (bankAssigned.has(s.bank.tx.id) || ledgerAssigned.has(s.ledger.tx.id)) continue;
    bankAssigned.set(s.bank.tx.id, s);
    ledgerAssigned.set(s.ledger.tx.id, s);
  }
  const byBank = new Map<string, Scored[]>();
  const byLedger = new Map<string, Scored[]>();
  for (const s of scored) {
    (byBank.get(s.bank.tx.id) ?? byBank.set(s.bank.tx.id, []).get(s.bank.tx.id)!).push(s);
    (byLedger.get(s.ledger.tx.id) ?? byLedger.set(s.ledger.tx.id, []).get(s.ledger.tx.id)!).push(s);
  }
  const out: { pair: Scored; competitors: Scored[] }[] = [];
  for (const pair of bankAssigned.values()) {
    const rivals = [
      ...(byBank.get(pair.bank.tx.id) ?? []).filter((s) => s.ledger.tx.id !== pair.ledger.tx.id),
      ...(byLedger.get(pair.ledger.tx.id) ?? []).filter((s) => s.bank.tx.id !== pair.bank.tx.id),
    ];
    const competitors = rivals.filter((r) => {
      if (r.p < pair.p - config.ambiguityMargin || r.p < config.minSuggestProbability * 0.6) return false;
      // A rival whose other endpoint is held by a strictly stronger pair is not a real alternative.
      const otherHome =
        r.bank.tx.id === pair.bank.tx.id ? ledgerAssigned.get(r.ledger.tx.id) : bankAssigned.get(r.bank.tx.id);
      return !(otherHome && otherHome !== pair && otherHome.p > r.p + 1e-9);
    });
    out.push({ pair, competitors });
  }
  return out;
}

function totalsByCurrency(bank: Transaction[], ledger: Transaction[], matchedBank: Set<string>, matchedLedger: Set<string>): CurrencyTotals[] {
  const map = new Map<string, CurrencyTotals>();
  const get = (c: string) => {
    let t = map.get(c);
    if (!t) {
      t = { currency: c, bankCount: 0, ledgerCount: 0, bankTotalMinor: 0n, ledgerTotalMinor: 0n, matchedBankMinor: 0n, unmatchedBankMinor: 0n, unmatchedLedgerMinor: 0n };
      map.set(c, t);
    }
    return t;
  };
  for (const b of bank) {
    const t = get(b.currency);
    t.bankCount++;
    t.bankTotalMinor += b.amountMinor;
    if (matchedBank.has(b.id)) t.matchedBankMinor += b.amountMinor;
    else t.unmatchedBankMinor += b.amountMinor;
  }
  for (const l of ledger) {
    const t = get(l.currency);
    t.ledgerCount++;
    t.ledgerTotalMinor += l.amountMinor;
    if (!matchedLedger.has(l.id)) t.unmatchedLedgerMinor += l.amountMinor;
  }
  return [...map.values()].sort((a, b) => b.bankCount + b.ledgerCount - (a.bankCount + a.ledgerCount));
}

export interface ReconcileOptions {
  config?: Partial<EngineConfig>;
  model: LogisticModel;
  /** Receives the residual candidate pairs the model will score (used to build training data). */
  onCandidates?: (candidates: CandidatePair[]) => void;
}

export function reconcile(bankTxs: Transaction[], ledgerTxs: Transaction[], opts: ReconcileOptions): ReconciliationResult {
  const config: EngineConfig = { ...DEFAULT_CONFIG, ...opts.config };
  const model = opts.model;
  assertCompatible(model);
  const timings: Record<string, number> = {};
  const t0 = performance.now();
  let mark = t0;
  const lap = (name: string) => {
    const now = performance.now();
    timings[name] = Number((now - mark).toFixed(2));
    mark = now;
  };

  const ids = new Set<string>();
  for (const t of [...bankTxs, ...ledgerTxs]) {
    if (ids.has(t.id)) throw new Error(`Duplicate transaction id ${t.id} in engine input`);
    ids.add(t.id);
  }
  const txById = new Map<string, Transaction>([...bankTxs, ...ledgerTxs].map((t) => [t.id, t]));
  const bankIdx = bankTxs.map(indexTx);
  const ledgerIdx = ledgerTxs.map(indexTx);
  lap("index");

  const duplicateGroups = [...findDuplicates(bankTxs), ...findDuplicates(ledgerTxs)];
  const dupMember = new Set(duplicateGroups.flatMap((g) => g.ids));
  lap("duplicates");

  const det = deterministicPass(bankIdx, ledgerIdx, config);
  const matches: Omit<Match, "id">[] = [...det.matches];
  const usedBank = det.usedBank;
  const usedLedger = det.usedLedger;
  lap("deterministic");

  const leftBank = () => bankIdx.filter((b) => !usedBank.has(b.tx.id));
  const leftLedger = () => ledgerIdx.filter((l) => !usedLedger.has(l.tx.id));
  const pushSplit = (kind: "many_to_one" | "one_to_many", prop: SplitProposal) => {
    const bankSide = kind === "many_to_one" ? [prop.target.tx] : prop.parts.map((p) => p.tx);
    const ledgerSide = kind === "many_to_one" ? prop.parts.map((p) => p.tx) : [prop.target.tx];
    bankSide.forEach((t) => usedBank.add(t.id));
    ledgerSide.forEach((t) => usedLedger.add(t.id));
    const flags = flagsFor(bankSide, ledgerSide, prop.score, config);
    if (prop.alternatives.length > 0) flags.push("ambiguous");
    if (prop.linkedParts === 0) flags.push("low_confidence");
    const total = prop.target.tx.amountMinor;
    const partSide = kind === "many_to_one" ? "ledger" : "bank";
    matches.push({
      kind,
      status: prop.alternatives.length > 0 || prop.linkedParts === 0 ? "needs_review" : "suggested",
      method: "split_sum",
      score: prop.score,
      bankIds: bankSide.map((t) => t.id),
      ledgerIds: ledgerSide.map((t) => t.id),
      currency: prop.target.tx.currency,
      bankTotalMinor: sumMinor(bankSide.map((t) => t.amountMinor)),
      ledgerTotalMinor: sumMinor(ledgerSide.map((t) => t.amountMinor)),
      flags: [...new Set(flags)],
      evidence: {
        reasons: [
          `${prop.parts.length} ${partSide} transactions sum exactly to ${formatMoney(total, prop.target.tx.currency)}`,
          `${prop.linkedParts} of ${prop.parts.length} parts share a reference or counterparty with the ${partSide === "ledger" ? "bank" : "ledger"} record`,
          `All parts fall within ${config.dateWindowDays} day(s)`,
          "Heuristic score (not a model probability)",
        ],
        amountDifferenceMinor: "0",
        dayDifference: Math.max(...prop.parts.map((p) => Math.abs(p.tx.day - prop.target.tx.day))),
        alternatives: prop.alternatives.map((a) =>
          kind === "many_to_one"
            ? { bankIds: [prop.target.tx.id], ledgerIds: a.parts.map((p) => p.tx.id), score: a.score }
            : { bankIds: a.parts.map((p) => p.tx.id), ledgerIds: [prop.target.tx.id], score: a.score },
        ),
      },
    });
  };
  // Search both directions independently, then accept the best-evidenced
  // non-overlapping proposals first, so a coincidental unlinked sum cannot
  // consume rows that belong to a reference-linked split.
  const splitPass = (accept: (p: SplitProposal) => boolean) => {
    const splitProps = [
      ...findSplitMatches(leftBank(), leftLedger(), config).map((p) => ({ kind: "many_to_one" as const, p })),
      ...findSplitMatches(leftLedger(), leftBank(), config).map((p) => ({ kind: "one_to_many" as const, p })),
    ]
      .filter(({ p }) => accept(p))
      .sort(
        (a, b) =>
          b.p.linkedParts / b.p.parts.length - a.p.linkedParts / a.p.parts.length ||
          b.p.score - a.p.score ||
          a.p.target.tx.id.localeCompare(b.p.target.tx.id),
      );
    for (const { kind, p } of splitProps) {
      const rows = [p.target, ...p.parts].map((x) => x.tx);
      if (rows.some((t) => usedBank.has(t.id) || usedLedger.has(t.id))) continue;
      pushSplit(kind, p);
    }
  };

  // Fully reference-linked splits first: every part carries the target's
  // reference AND the parts sum exactly. That outranks a probabilistic 1:1
  // pairing with a large amount gap. Still a suggestion, never verified.
  splitPass((p) => p.parts.every((part) => referenceLinked(p.target, part)));
  lap("linked_splits");

  // ML-scored 1:1 suggestions on the residual.
  const residualBank = bankIdx.filter((b) => !usedBank.has(b.tx.id));
  const residualLedger = ledgerIdx.filter((l) => !usedLedger.has(l.tx.id));
  const candidates = buildCandidates(residualBank, residualLedger, config);
  opts.onCandidates?.(candidates);
  lap("candidates");
  const scored: Scored[] = candidates.map((c) => ({ ...c, p: predict(model, c.features) }));
  // Keep only the top-K candidates per bank row to bound downstream work.
  const perBank = new Map<string, Scored[]>();
  for (const s of scored) (perBank.get(s.bank.tx.id) ?? perBank.set(s.bank.tx.id, []).get(s.bank.tx.id)!).push(s);
  const kept: Scored[] = [];
  for (const arr of perBank.values()) kept.push(...arr.sort((a, b) => b.p - a.p).slice(0, config.maxCandidatesPerRow));
  lap("scoring");

  for (const { pair, competitors } of assignScored(kept, config)) {
    const b = pair.bank.tx, l = pair.ledger.tx;
    const flags = flagsFor([b], [l], pair.p, config);
    if (competitors.length > 0) flags.push("ambiguous");
    if (dupMember.has(b.id) || dupMember.has(l.id)) flags.push("duplicate_involved");
    const diff = b.amountMinor - l.amountMinor;
    const reasons = [
      `Model probability ${(pair.p * 100).toFixed(1)}% (${model.version})`,
      diff === 0n ? "Amounts are identical" : `Amounts differ by ${formatMoney(diff, b.currency)}`,
      `Dates are ${Math.abs(b.day - l.day)} day(s) apart`,
    ];
    if (competitors.length > 0) reasons.push(`${competitors.length} competing candidate(s) score within ${(config.ambiguityMargin * 100).toFixed(0)} points`);
    usedBank.add(b.id);
    usedLedger.add(l.id);
    matches.push({
      kind: "one_to_one",
      status: competitors.length > 0 || dupMember.has(b.id) || dupMember.has(l.id) ? "needs_review" : "suggested",
      method: "ml_scored",
      score: Number(pair.p.toFixed(4)),
      bankIds: [b.id],
      ledgerIds: [l.id],
      currency: b.currency,
      bankTotalMinor: b.amountMinor,
      ledgerTotalMinor: l.amountMinor,
      flags,
      evidence: {
        reasons,
        amountDifferenceMinor: diff.toString(),
        dayDifference: b.day - l.day,
        referenceSimilarity: Number.isNaN(pair.features[3]!) ? undefined : Number(pair.features[3]!.toFixed(4)),
        contributions: explain(model, pair.features),
        alternatives: competitors
          .sort((x, y) => y.p - x.p)
          .slice(0, 5)
          .map((c) => ({ bankIds: [c.bank.tx.id], ledgerIds: [c.ledger.tx.id], score: Number(c.p.toFixed(4)) })),
      },
    });
  }
  lap("assignment");

  // Split payments / aggregated settlements on what is left (any evidence level). Exact sums only.
  splitPass(() => true);
  lap("splits");

  // Exceptions.
  // Exceptions.
  const exceptions: Omit<ReconException, "id">[] = [];
  // Currency mismatches: leftover rows linked by ID/reference but recorded in different currencies.
  const lb = leftBank(), ll = leftLedger();
  const llByRef = new Map<string, TxIndexEntry[]>();
  for (const l of ll) {
    for (const k of [l.refKey, l.extKey]) {
      if (k.length < 4) continue;
      (llByRef.get(k) ?? llByRef.set(k, []).get(k)!).push(l);
    }
  }
  for (const b of lb) {
    const hits = new Set<TxIndexEntry>();
    for (const k of [b.refKey, b.extKey]) if (k.length >= 4) llByRef.get(k)?.forEach((l) => hits.add(l));
    const ccyHits = [...hits].filter(
      (l) => !usedLedger.has(l.tx.id) && l.tx.currency !== b.tx.currency && Math.abs(l.tx.day - b.tx.day) <= config.dateWindowDays,
    );
    if (ccyHits.length !== 1) continue;
    const l = ccyHits[0]!;
    usedBank.add(b.tx.id);
    usedLedger.add(l.tx.id);
    exceptions.push({
      type: "currency_mismatch",
      bankIds: [b.tx.id],
      ledgerIds: [l.tx.id],
      currency: b.tx.currency,
      exposureMinor: absMinor(b.tx.amountMinor),
      message: `Reference matches but bank is ${formatMoney(b.tx.amountMinor, b.tx.currency)} and ledger is ${formatMoney(l.tx.amountMinor, l.tx.currency)}`,
      details: { bankCurrency: b.tx.currency, ledgerCurrency: l.tx.currency, reference: l.tx.reference || b.tx.reference },
    });
  }
  for (const b of leftBank()) {
    exceptions.push({
      type: "missing_in_ledger",
      bankIds: [b.tx.id],
      ledgerIds: [],
      currency: b.tx.currency,
      exposureMinor: absMinor(b.tx.amountMinor),
      message: `Bank transaction ${formatMoney(b.tx.amountMinor, b.tx.currency)} on ${b.tx.date} has no ledger counterpart`,
      details: { duplicateMember: dupMember.has(b.tx.id) },
    });
  }
  for (const l of leftLedger()) {
    exceptions.push({
      type: "missing_in_bank",
      bankIds: [],
      ledgerIds: [l.tx.id],
      currency: l.tx.currency,
      exposureMinor: absMinor(l.tx.amountMinor),
      message: `Ledger entry ${formatMoney(l.tx.amountMinor, l.tx.currency)} on ${l.tx.date} has no bank counterpart`,
      details: { duplicateMember: dupMember.has(l.tx.id) },
    });
  }
  for (const g of duplicateGroups) {
    const first = txById.get(g.ids[0]!)!;
    exceptions.push({
      type: g.side === "bank" ? "duplicate_bank" : "duplicate_ledger",
      bankIds: g.side === "bank" ? g.ids : [],
      ledgerIds: g.side === "ledger" ? g.ids : [],
      currency: first.currency,
      exposureMinor: absMinor(first.amountMinor) * BigInt(g.ids.length - 1),
      message:
        g.kind === "exact"
          ? `${g.ids.length} identical ${g.side} records (${formatMoney(first.amountMinor, first.currency)} on ${first.date})`
          : g.kind === "same_content"
            ? `${g.ids.length} ${g.side} records with identical details under different IDs (${formatMoney(first.amountMinor, first.currency)} on ${first.date})`
            : `Transaction ID "${first.externalId}" appears ${g.ids.length} times in ${g.side} data`,
      details: { kind: g.kind },
    });
  }
  // Amount mismatches on proposed links.
  matches.forEach((m, i) => {
    const diff = m.bankTotalMinor - m.ledgerTotalMinor;
    if (diff === 0n) return;
    exceptions.push({
      type: "amount_mismatch",
      bankIds: m.bankIds,
      ledgerIds: m.ledgerIds,
      currency: m.currency,
      exposureMinor: absMinor(diff),
      message: `Proposed match differs by ${formatMoney(diff, m.currency)}`,
      details: { matchIndex: i, bankTotal: m.bankTotalMinor.toString(), ledgerTotal: m.ledgerTotalMinor.toString() },
    });
  });
  lap("exceptions");

  const numbered: Match[] = matches.map((m, i) => ({ ...m, id: `M-${String(i + 1).padStart(5, "0")}` }));
  const numberedExc: ReconException[] = exceptions.map((e, i) => {
    const details = { ...e.details };
    if (typeof details.matchIndex === "number") {
      details.matchId = numbered[details.matchIndex]!.id;
      delete details.matchIndex;
    }
    return { ...e, details, id: `E-${String(i + 1).padStart(5, "0")}` };
  });

  const matchedBank = new Set(numbered.flatMap((m) => m.bankIds));
  const matchedLedger = new Set(numbered.flatMap((m) => m.ledgerIds));
  const verifiedBank = new Set(numbered.filter((m) => m.status === "verified").flatMap((m) => m.bankIds));
  const exceptionsByType = {
    missing_in_ledger: 0, missing_in_bank: 0, duplicate_bank: 0, duplicate_ledger: 0, amount_mismatch: 0, currency_mismatch: 0,
  } as Record<ExceptionType, number>;
  for (const e of numberedExc) exceptionsByType[e.type]++;
  const totalMs = Number((performance.now() - t0).toFixed(2));
  const nb = Math.max(1, bankTxs.length);

  return {
    engineVersion: ENGINE_VERSION,
    modelVersion: model.version,
    config,
    matches: numbered,
    exceptions: numberedExc,
    duplicateGroups,
    metrics: {
      bankCount: bankTxs.length,
      ledgerCount: ledgerTxs.length,
      verifiedMatches: numbered.filter((m) => m.status === "verified").length,
      suggestedMatches: numbered.filter((m) => m.status === "suggested").length,
      reviewMatches: numbered.filter((m) => m.status === "needs_review").length,
      splitMatches: numbered.filter((m) => m.method === "split_sum").length,
      autoVerifiedRate: verifiedBank.size / nb,
      proposedCoverageRate: matchedBank.size / nb,
      unmatchedBank: bankTxs.length - matchedBank.size,
      unmatchedLedger: ledgerTxs.length - matchedLedger.size,
      exceptionsByType,
      candidatePairsScored: scored.length,
      timingsMs: timings,
      totalMs,
      byCurrency: totalsByCurrency(bankTxs, ledgerTxs, matchedBank, matchedLedger),
    },
  };
}

/**
 * The exact candidate pairs the model scores inside `reconcile` (after the
 * deterministic rules and fully linked splits). Candidate generation does not
 * depend on model weights, so a neutral model is used to run the pipeline.
 */
export function residualCandidates(bankTxs: Transaction[], ledgerTxs: Transaction[], config: EngineConfig = DEFAULT_CONFIG) {
  let captured: CandidatePair[] = [];
  const neutral: LogisticModel = {
    version: "neutral",
    featureKeys: FEATURES.map((f) => f.key),
    means: FEATURES.map(() => 0),
    stds: FEATURES.map(() => 1),
    weights: FEATURES.map(() => 0),
    bias: -100, // probability ~0: nothing is assigned, so later stages see the full residual
    trainedAt: "",
    trainingSummary: { examples: 0, positives: 0, seeds: [], epochs: 0, l2: 0, learningRate: 0 },
  };
  reconcile(bankTxs, ledgerTxs, { model: neutral, config, onCandidates: (c) => (captured = c) });
  return { candidates: captured };
}

