import { rng } from "./synthetic";
import type { Transaction } from "./types";

/**
 * Synthetic benchmark for the amount-anomaly detector, with KNOWN injected anomalies.
 * Each counterparty has a stable spending pattern (log-normal around its own
 * typical amount, σ = 0.25 in log space ≈ ±28%); a fraction of transactions is
 * replaced by an amount 4–15× higher or lower. Ground truth is recorded.
 * This measures the detector on data that matches its assumptions — it is not
 * evidence of performance on real statements.
 */
export interface AnomalyBenchmark {
  transactions: Transaction[];
  anomalyIds: Set<string>;
}

export function anomalyBenchmark(seed: number, opts: { counterparties?: number; perCounterparty?: number; anomalyRate?: number } = {}): AnomalyBenchmark {
  const r = rng(seed);
  const cps = opts.counterparties ?? 40;
  const per = opts.perCounterparty ?? 30;
  const rate = opts.anomalyRate ?? 0.03;
  // Box–Muller standard normal.
  const normal = () => Math.sqrt(-2 * Math.log(1 - r.next())) * Math.cos(2 * Math.PI * r.next());
  const transactions: Transaction[] = [];
  const anomalyIds = new Set<string>();
  let n = 0;
  for (let c = 0; c < cps; c++) {
    const typical = Math.exp(Math.log(50) + r.next() * (Math.log(20_000) - Math.log(50)));
    const outflow = r.chance(0.5);
    for (let k = 0; k < per; k++) {
      let major = typical * Math.exp(0.25 * normal());
      const id = `B-${String(++n).padStart(6, "0")}`;
      if (r.chance(rate)) {
        const factor = 4 + r.next() * 11;
        major = r.chance(0.5) ? major * factor : major / factor;
        anomalyIds.add(id);
      }
      const minor = BigInt(Math.max(1, Math.round(major * 100)));
      transactions.push({
        id,
        side: "bank",
        sourceLine: n + 1,
        externalId: "",
        date: "2024-07-01",
        day: 19905,
        amountMinor: outflow ? -minor : minor,
        currency: "USD",
        reference: "",
        description: "PAYMENT",
        counterparty: `COUNTERPARTY ${String.fromCharCode(65 + (c % 26))}${Math.floor(c / 26)}`,
      });
    }
  }
  return { transactions, anomalyIds };
}
