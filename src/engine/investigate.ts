import { indexTx, referenceLinked, type TxIndexEntry } from "./features";
import { absMinor, currencyExponent, formatMoney, sumMinor } from "./money";
import type { Match, ReconException, ReconciliationResult, Transaction } from "./types";

/**
 * Evidence-grounded investigation. Every finding cites transactions and values
 * that exist in the run's data. Hypotheses are phrased as "consistent with" —
 * the investigator never asserts a cause it cannot see, and never approves.
 */

export type Support = "strong" | "moderate" | "weak";

export interface EvidenceItem {
  id: string;
  /** Transactions this evidence refers to (all exist in the run). */
  txIds: string[];
  text: string;
}

export interface Hypothesis {
  title: string;
  support: Support;
  explanation: string;
  evidenceIds: string[];
}

export interface Investigation {
  subject: { type: "match" | "exception"; id: string };
  headline: string;
  evidence: EvidenceItem[];
  hypotheses: Hypothesis[];
  recommendedAction: string;
  limitations: string[];
}

const BANK_ORIGINATED = /\b(FEE|FEES|CHARGE|CHARGES|INTEREST|COMMISSION|OVERDRAFT|SERVICE|MAINTENANCE)\b/i;

export function createInvestigator(bank: Transaction[], ledger: Transaction[], result: ReconciliationResult) {
  const txById = new Map<string, Transaction>([...bank, ...ledger].map((t) => [t.id, t]));
  const idx = new Map<string, TxIndexEntry>([...bank, ...ledger].map((t) => [t.id, indexTx(t)]));
  const matchOf = new Map<string, Match>();
  for (const m of result.matches) for (const id of [...m.bankIds, ...m.ledgerIds]) matchOf.set(id, m);
  const window = result.config.dateWindowDays;
  const bankDays = bank.map((t) => t.day);
  const bankPeriod = bankDays.length ? { min: Math.min(...bankDays), max: Math.max(...bankDays) } : null;

  const describe = (t: Transaction) =>
    `${t.id} (${t.side}, line ${t.sourceLine}): ${formatMoney(t.amountMinor, t.currency)} on ${t.date}` +
    `${t.reference ? `, ref "${t.reference}"` : ""}${t.description ? `, "${t.description}"` : ""}`;

  function builder(subject: Investigation["subject"]) {
    const evidence: EvidenceItem[] = [];
    const hypotheses: Hypothesis[] = [];
    const limitations: string[] = [];
    const ev = (txIds: string[], text: string) => {
      for (const id of txIds) if (!txById.has(id)) throw new Error(`Investigation cited unknown transaction ${id}`);
      const id = `E${evidence.length + 1}`;
      evidence.push({ id, txIds, text });
      return id;
    };
    const hyp = (title: string, support: Support, explanation: string, evidenceIds: string[]) => {
      if (evidenceIds.length === 0) throw new Error("A hypothesis must cite evidence");
      hypotheses.push({ title, support, explanation, evidenceIds });
    };
    const done = (headline: string, recommendedAction: string): Investigation => ({
      subject,
      headline,
      evidence,
      hypotheses: hypotheses.sort((a, b) => rank(b.support) - rank(a.support)),
      recommendedAction,
      limitations,
    });
    return { ev, hyp, done, limitations, hypothesisCount: () => hypotheses.length };
  }

  /** Counterparts on the other side, searched across the WHOLE dataset (matched or not). */
  function searchOtherSide(t: Transaction) {
    const others = t.side === "bank" ? ledger : bank;
    const self = idx.get(t.id)!;
    const sameAmountAnyDate: Transaction[] = [];
    const linkedOtherAmount: Transaction[] = [];
    const linkedOtherCurrency: Transaction[] = [];
    for (const o of others) {
      const oi = idx.get(o.id)!;
      const linked = referenceLinked(self, oi);
      if (o.currency === t.currency && o.amountMinor === t.amountMinor) sameAmountAnyDate.push(o);
      else if (linked && o.currency === t.currency) linkedOtherAmount.push(o);
      else if (linked && o.currency !== t.currency) linkedOtherCurrency.push(o);
    }
    sameAmountAnyDate.sort((a, b) => Math.abs(a.day - t.day) - Math.abs(b.day - t.day));
    return { sameAmountAnyDate, linkedOtherAmount, linkedOtherCurrency };
  }

  function investigateMissing(e: ReconException): Investigation {
    const t = txById.get(e.bankIds[0] ?? e.ledgerIds[0]!)!;
    const other = t.side === "bank" ? "ledger" : "bank";
    const { ev, hyp, done, limitations, hypothesisCount } = builder({ type: "exception", id: e.id });
    const base = ev([t.id], `Unmatched ${t.side} record: ${describe(t)}`);
    const s = searchOtherSide(t);

    const outside = s.sameAmountAnyDate.filter((o) => Math.abs(o.day - t.day) > window);
    const inside = s.sameAmountAnyDate.filter((o) => Math.abs(o.day - t.day) <= window);
    for (const o of inside.slice(0, 3)) {
      const m = matchOf.get(o.id);
      const id = ev([o.id], `Same amount and currency within ${window} days: ${describe(o)}${m ? ` — already part of ${m.id} (${m.status})` : ""}`);
      hyp(
        m ? `Counterpart may be linked to another transaction (${m.id})` : "Possible counterpart not selected",
        m ? "moderate" : "weak",
        m
          ? `${o.id} has the same amount and currency but is assigned to ${m.id}. If that link is wrong, ${t.id} may belong with ${o.id}.`
          : `${o.id} has the same amount but was not proposed; descriptions/references gave insufficient support.`,
        [base, id],
      );
    }
    if (outside.length > 0) {
      const o = outside[0]!;
      const id = ev([o.id], `Same amount and currency, ${Math.abs(o.day - t.day)} days apart (outside the ${window}-day window): ${describe(o)}`);
      hyp("Recorded with a different date", "weak", `An identical ${other} amount exists outside the matching window; it may be a late posting or a coincidence.`, [base, id]);
    }
    for (const o of s.linkedOtherAmount.slice(0, 3)) {
      const diff = t.amountMinor - o.amountMinor;
      const id = ev([o.id], `Shares a reference/identifier but amount differs by ${formatMoney(diff, t.currency)}: ${describe(o)}`);
      hyp("Recorded with a different amount", "moderate", `The ${other} record carries the same reference with a different amount (partial payment, fee, or keying error).`, [base, id]);
    }
    for (const o of s.linkedOtherCurrency.slice(0, 2)) {
      const id = ev([o.id], `Shares a reference/identifier but is in ${o.currency}: ${describe(o)}`);
      hyp("Recorded in a different currency", "moderate", "The same reference appears in another currency; check the FX conversion and the account the item was posted to.", [base, id]);
    }
    if (t.side === "bank" && BANK_ORIGINATED.test(t.description)) {
      hyp(
        "Bank-originated item",
        "moderate",
        `The narrative "${t.description}" is typical of items the bank posts itself (fees, interest), which are often recorded in the ledger only after the statement is received.`,
        [base],
      );
    }
    if (t.side === "ledger" && bankPeriod && t.day > bankPeriod.max - window) {
      const id = ev([t.id], `Ledger date ${t.date} falls within ${window} days of the last bank transaction date in this file`);
      hyp("Timing difference (in transit)", "moderate", "The entry is close to the end of the bank data; it may clear on the next statement.", [base, id]);
    }
    if (t.side === "ledger" && bankPeriod && t.day < bankPeriod.min - window) {
      const id = ev([t.id], `Ledger date ${t.date} precedes the first bank transaction in this file`);
      hyp("Outside the bank statement period", "moderate", "The bank file may not cover this date; the counterpart may be on an earlier statement.", [base, id]);
    }
    const dup = result.duplicateGroups.find((g) => g.ids.includes(t.id));
    if (dup) {
      const id = ev(dup.ids, `Part of a ${dup.kind.replace("_", " ")} duplicate group of ${dup.ids.length} ${dup.side} records`);
      hyp("Duplicate record", "strong", `Another ${t.side} record has identical details; this copy has no ${other} counterpart, consistent with a double posting or re-import.`, [base, id]);
    }
    if (hypothesisCount() === 0) {
      limitations.push(`No ${other} record with the same amount, reference or identifier was found in the data provided.`);
    }
    limitations.push("Only the two uploaded files were examined; other accounts, statements or periods were not available.");
    return done(
      `${t.side === "bank" ? "Bank" : "Ledger"} ${formatMoney(t.amountMinor, t.currency)} on ${t.date} has no ${other} counterpart`,
      dup
        ? `Confirm whether ${t.id} is a duplicate; if so, reverse/remove it at source and document the decision.`
        : t.side === "bank"
          ? "Verify the bank item and record it in the ledger if it is legitimate, or raise it with the bank."
          : "Confirm the payment was executed; if in transit, carry forward and re-check against the next statement.",
    );
  }

  return {
    investigateException(exceptionId: string): Investigation {
      const e = result.exceptions.find((x) => x.id === exceptionId);
      if (!e) throw new Error(`Unknown exception ${exceptionId}`);
      if (e.type === "missing_in_bank" || e.type === "missing_in_ledger") return investigateMissing(e);
      if (e.type === "amount_mismatch" && typeof e.details.matchId === "string") return this.investigateMatch(e.details.matchId, e.id);
      if (e.type === "currency_mismatch") return investigateCurrency(e);
      return investigateDuplicate(e);
    },
    investigateMatch(matchId: string, viaException?: string): Investigation {
      const m = result.matches.find((x) => x.id === matchId);
      if (!m) throw new Error(`Unknown match ${matchId}`);
      return investigateMatch(m, viaException);
    },
  };

  function investigateCurrency(e: ReconException): Investigation {
    const b = txById.get(e.bankIds[0]!)!, l = txById.get(e.ledgerIds[0]!)!;
    const { ev, hyp, done, limitations } = builder({ type: "exception", id: e.id });
    const e1 = ev([b.id], `Bank: ${describe(b)}`);
    const e2 = ev([l.id], `Ledger: ${describe(l)}`);
    const e3 = ev([b.id, l.id], `Both records share reference/identifier "${String(e.details.reference ?? "")}"`);
    const rate = impliedRate(b, l);
    const e4 = ev([b.id, l.id], `Implied rate ${l.currency}→${b.currency}: ${rate} (display only; not used for matching)`);
    hyp("Invoice and settlement currencies differ", "strong", `The ledger records ${l.currency} but the bank settled ${b.currency}. Matching across currencies requires an FX rate and policy, so the engine does not match them automatically.`, [e1, e2, e3, e4]);
    limitations.push("No FX rate source was provided; the implied rate is derived only from the two amounts.");
    return done(`Same reference settled in ${b.currency} but booked in ${l.currency}`, "Confirm the FX rate applied and book any FX gain/loss before approving the link manually.");
  }

  function investigateDuplicate(e: ReconException): Investigation {
    const ids = [...e.bankIds, ...e.ledgerIds];
    const rows = ids.map((id) => txById.get(id)!);
    const t = rows[0]!;
    const { ev, hyp, done, limitations } = builder({ type: "exception", id: e.id });
    const base = ev(ids, `${rows.length} ${t.side} records with ${e.details.kind === "external_id" ? "the same transaction ID" : "identical details"}: ${rows.map((r) => `${r.id} (line ${r.sourceLine})`).join(", ")}`);
    const counterparts = searchOtherSide(t).sameAmountAnyDate.filter((o) => Math.abs(o.day - t.day) <= window);
    const cev = counterparts.length
      ? ev(counterparts.map((o) => o.id), `${counterparts.length} ${t.side === "bank" ? "ledger" : "bank"} record(s) with the same amount within ${window} days`)
      : ev([t.id], `No ${t.side === "bank" ? "ledger" : "bank"} record with the same amount within ${window} days`);
    if (counterparts.length >= rows.length) {
      hyp("Legitimate repeated transactions", "moderate", `The other side has ${counterparts.length} matching amount(s) for ${rows.length} identical records, consistent with genuinely repeated payments.`, [base, cev]);
    } else {
      hyp("Double posting or re-import", "strong", `There are ${rows.length} identical ${t.side} records but only ${counterparts.length} counterpart(s), consistent with a duplicate.`, [base, cev]);
    }
    limitations.push("Identical records can be legitimate; only a person with access to source documents can confirm.");
    return done(e.message, counterparts.length >= rows.length ? "Confirm each repeated payment against source documents; no correction may be needed." : "Identify the original entry and reverse the duplicate at source; record the decision.");
  }

  function investigateMatch(m: Match, viaException?: string): Investigation {
    const { ev, hyp, done, limitations } = builder(viaException ? { type: "exception", id: viaException } : { type: "match", id: m.id });
    const bs = m.bankIds.map((id) => txById.get(id)!), ls = m.ledgerIds.map((id) => txById.get(id)!);
    const eb = ev(m.bankIds, `Bank side: ${bs.map(describe).join("; ")}`);
    const el = ev(m.ledgerIds, `Ledger side: ${ls.map(describe).join("; ")}`);
    const bTotal = sumMinor(bs.map((t) => t.amountMinor)), lTotal = sumMinor(ls.map((t) => t.amountMinor));
    const diff = bTotal - lTotal;
    const ccy = m.currency;
    const lag = Math.max(...bs.flatMap((b) => ls.map((l) => b.day - l.day)));

    if (m.status === "verified") {
      const id = ev([...m.bankIds, ...m.ledgerIds], `Rule ${m.method}: ${m.evidence.reasons.join("; ")}. ${m.evidence.uniqueness ?? ""}`);
      hyp("Deterministic match", "strong", "The rule's conditions hold and the pairing is unique on both sides.", [eb, el, id]);
      limitations.push("Verification confirms the two records agree; it does not validate the underlying business transaction.");
      return done(`Verified by rule: ${formatMoney(bTotal, ccy)}`, "No action needed.");
    }

    if (diff !== 0n) {
      const ed = ev([...m.bankIds, ...m.ledgerIds], `Bank total ${formatMoney(bTotal, ccy)} vs ledger total ${formatMoney(lTotal, ccy)}: difference ${formatMoney(diff, ccy)}`);
      const absD = absMinor(diff);
      const rel = Number((absD * 10_000n) / (absMinor(lTotal) || 1n)) / 100;
      if (absD <= 2n) hyp("Rounding difference", "strong", `A difference of ${formatMoney(diff, ccy)} is consistent with rounding in a conversion or allocation.`, [ed]);
      else if (absMinor(bTotal) < absMinor(lTotal) && rel <= 3) hyp("Fee deducted before settlement", "moderate", `The bank amount is ${rel.toFixed(2)}% lower than the ledger amount, consistent with a processing or transfer fee netted from the payment.`, [eb, el, ed]);
      else if (absMinor(bTotal) > absMinor(lTotal)) hyp("Overpayment or ledger recorded net", "weak", `The bank amount exceeds the ledger amount by ${formatMoney(absD, ccy)}.`, [ed]);
      else hyp("Partial payment or keying error", "weak", `The amounts differ by ${rel.toFixed(2)}%, larger than typical fees.`, [ed]);
    }
    if (Math.abs(lag) > 2) {
      const id = ev([...m.bankIds, ...m.ledgerIds], `Bank date is ${Math.abs(lag)} day(s) ${lag > 0 ? "after" : "before"} the ledger date`);
      hyp("Settlement timing difference", lag > 0 ? "moderate" : "weak", lag > 0 ? "Bank posting after the ledger date is consistent with normal clearing delays." : "Bank posting before the ledger date suggests the ledger entry was recorded late.", [id]);
    }
    if (m.method === "ml_scored" && m.evidence.contributions) {
      const top = m.evidence.contributions.filter((c) => c.contribution !== 0).slice(0, 4);
      const id = ev([...m.bankIds, ...m.ledgerIds], `Model ${result.modelVersion} probability ${(m.score * 100).toFixed(1)}%. Strongest factors: ${top.map((c) => `${c.label} ${c.contribution > 0 ? "+" : ""}${c.contribution.toFixed(2)}`).join(", ")}`);
      hyp("Likely the same transaction", m.score >= 0.9 ? "moderate" : "weak", "The model's evidence favours this pairing, but model scores are never sufficient for automatic approval.", [eb, el, id]);
    }
    if (m.method === "split_sum") {
      const id = ev([...m.bankIds, ...m.ledgerIds], m.evidence.reasons.join("; "));
      hyp(m.kind === "many_to_one" ? "Aggregated settlement" : "Split / instalment payment", m.flags.includes("low_confidence") ? "weak" : "moderate", "The parts sum exactly to the counterpart. Exact sums can occur by coincidence, especially with round amounts.", [eb, el, id]);
    }
    for (const alt of (m.evidence.alternatives ?? []).slice(0, 3)) {
      const altIds = [...alt.bankIds, ...alt.ledgerIds];
      const id = ev(altIds, `Alternative pairing scored ${(alt.score * 100).toFixed(1)}%: ${altIds.map((x) => describe(txById.get(x)!)).join(" ↔ ")}`);
      hyp("Ambiguous: an alternative pairing is nearly as likely", "moderate", "Competing candidates are too close to choose between automatically; compare source documents.", [id]);
    }
    if (m.flags.includes("duplicate_involved")) {
      const g = result.duplicateGroups.find((d) => d.ids.some((x) => m.bankIds.includes(x) || m.ledgerIds.includes(x)))!;
      const id = ev(g.ids, `Involves a ${g.kind.replace("_", " ")} duplicate group: ${g.ids.join(", ")}`);
      hyp("Duplicate in play", "moderate", "One of the records has an identical twin; make sure the right copy is linked.", [id]);
    }
    limitations.push("Supporting documents (remittance advices, invoices) were not available to the investigator.");
    return done(
      `${m.kind.replaceAll("_", " ")} ${m.method === "split_sum" ? "split" : "match"} — ${diff === 0n ? "amounts agree" : `difference ${formatMoney(diff, ccy)}`}`,
      m.flags.includes("ambiguous") ? "Compare the alternatives against remittance details before approving one." : diff !== 0n ? "Approve only if the difference is explained (e.g. fee); post an adjustment for it." : "Approve if the counterparty and purpose agree with source documents.",
    );
  }
}

function rank(s: Support): number {
  return s === "strong" ? 3 : s === "moderate" ? 2 : 1;
}

function impliedRate(b: Transaction, l: Transaction): string {
  // Ratio of major-unit amounts with 6 decimals, computed in bigint (display only).
  const bExp = 10n ** BigInt(currencyExponent(b.currency)), lExp = 10n ** BigInt(currencyExponent(l.currency));
  const num = absMinor(b.amountMinor) * lExp * 1_000_000n, den = absMinor(l.amountMinor) * bExp;
  if (den === 0n) return "n/a";
  const q = num / den;
  return `${q / 1_000_000n}.${(q % 1_000_000n).toString().padStart(6, "0")}`;
}
