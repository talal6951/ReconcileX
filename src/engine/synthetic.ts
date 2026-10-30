import Papa from "papaparse";
import { normalizeRows, parseCsv } from "./csv";
import { dayToIso } from "./dates";
import { toDecimalString } from "./money";
import type { ColumnMapping, Transaction } from "./types";

/**
 * Synthetic bank/ledger generator with ground truth. Every scenario the engine
 * must handle is produced deliberately, and the truth is recorded so matching
 * quality can be *measured* rather than asserted.
 */

export type Scenario =
  | "exact_reference"
  | "narrative_reference"
  | "no_reference"
  | "noisy_reference"
  | "fee_deducted"
  | "rounding"
  | "late_settlement"
  | "split_payment"
  | "aggregate_settlement"
  | "missing_in_bank"
  | "missing_in_ledger"
  | "duplicate_ledger"
  | "duplicate_bank"
  | "currency_mismatch"
  | "ambiguous_twins";

export const SCENARIO_WEIGHTS: Record<Scenario, number> = {
  exact_reference: 30,
  narrative_reference: 18,
  no_reference: 10,
  noisy_reference: 8,
  fee_deducted: 4,
  rounding: 2,
  late_settlement: 3,
  split_payment: 3,
  aggregate_settlement: 3,
  missing_in_bank: 4,
  missing_in_ledger: 4,
  duplicate_ledger: 2,
  duplicate_bank: 1,
  currency_mismatch: 2,
  ambiguous_twins: 3,
};

export interface TruthLink {
  bankIds: string[];
  ledgerIds: string[];
  scenario: Scenario;
}

export interface GroundTruth {
  links: TruthLink[];
  missingInBank: string[];
  missingInLedger: string[];
  currencyMismatch: { bankId: string; ledgerId: string }[];
  duplicateBank: string[][];
  duplicateLedger: string[][];
  /** Maps interchangeable rows (exact duplicates, indistinguishable twins) to a canonical id. */
  canonical: Record<string, string>;
  scenarioCounts: Partial<Record<Scenario, number>>;
}

export interface SyntheticDataset {
  seed: number;
  bankCsv: string;
  ledgerCsv: string;
  bank: Transaction[];
  ledger: Transaction[];
  truth: GroundTruth;
}

export const DEMO_BANK_MAPPING: ColumnMapping = {
  externalId: "Transaction ID",
  date: "Posting Date",
  description: "Description",
  reference: "Reference",
  counterparty: "Counterparty",
  amount: "Amount",
  currency: "Currency",
  dateFormat: "YYYY-MM-DD",
  decimalSeparator: ".",
};

export const DEMO_LEDGER_MAPPING: ColumnMapping = {
  externalId: "Entry ID",
  date: "Date",
  reference: "Reference",
  description: "Memo",
  counterparty: "Counterparty",
  amount: "Amount",
  currency: "Currency",
  dateFormat: "YYYY-MM-DD",
  decimalSeparator: ".",
};

/** mulberry32: small, fast, deterministic PRNG. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)]!,
    chance: (p: number) => next() < p,
  };
}
type Rng = ReturnType<typeof rng>;

const CUSTOMERS = [
  "Acme Industrial Ltd", "Northwind Traders", "Globex Corporation", "Initech Systems", "Umbrella Logistics",
  "Stark Components", "Wayne Hospitality", "Hooli Cloud Services", "Vandelay Imports", "Soylent Foods",
  "Tyrell Robotics", "Cyberdyne Analytics", "Wonka Confectionery", "Gringotts Advisory", "Pied Piper Media",
  "Oceanic Freight", "Massive Dynamic", "Blue Sun Retail", "Aperture Labs", "Duff Beverages",
];
const VENDORS = [
  "Amazon Web Services", "Office Supplies Co", "City Power & Light", "Metro Property Mgmt", "DataSafe Insurance",
  "Swift Couriers", "Prime Payroll Services", "Telco Networks", "CleanCo Facilities", "LegalEdge LLP",
];
const CURRENCY_WEIGHTS: [string, number][] = [["USD", 70], ["EUR", 20], ["GBP", 10]];

interface Row {
  extId: string;
  day: number;
  amountMinor: bigint;
  currency: string;
  reference: string;
  description: string;
  counterparty: string;
}

interface Pending {
  bank: Row[];
  ledger: Row[];
  /** Links expressed as indices into the pending rows, resolved to ids after shuffling. */
  links: { bank: Row[]; ledger: Row[]; scenario: Scenario }[];
  missingInBank: Row[];
  missingInLedger: Row[];
  currencyMismatch: { bank: Row; ledger: Row }[];
  duplicateBank: Row[][];
  duplicateLedger: Row[][];
  equivalence: Row[][];
}

function weightedPick<T>(r: Rng, items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let x = r.next() * total;
  for (const [v, w] of items) {
    x -= w;
    if (x <= 0) return v;
  }
  return items[items.length - 1]![0];
}

function randomAmount(r: Rng, currency: string): bigint {
  // Log-uniform between 25 and 40,000 major units, with occasional round numbers.
  const major = Math.exp(Math.log(25) + r.next() * (Math.log(40_000) - Math.log(25)));
  const minorUnits = currency === "JPY" ? 1 : 100;
  if (r.chance(0.15)) return BigInt(Math.round(major / 50) * 50 * minorUnits);
  return BigInt(Math.round(major * minorUnits));
}

function typo(r: Rng, ref: string): string {
  const chars = ref.split("");
  const digitPositions = chars.map((c, i) => (/\d/.test(c) ? i : -1)).filter((i) => i >= 0);
  const kind = r.int(0, 2);
  if (kind === 0 && digitPositions.length >= 2) {
    const i = digitPositions[r.int(0, digitPositions.length - 2)]!;
    const j = digitPositions[digitPositions.indexOf(i) + 1]!;
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
    return chars.join("");
  }
  if (kind === 1) return ref.slice(0, Math.max(4, ref.length - 2));
  return ref.replace(/-/g, "").toLowerCase();
}

export function generateSynthetic(seed: number, events: number, opts: { startDate?: string; spanDays?: number } = {}): SyntheticDataset {
  const r = rng(seed);
  const startDay = Math.round(Date.parse(`${opts.startDate ?? "2024-07-01"}T00:00:00Z`) / 86_400_000);
  const span = opts.spanDays ?? 60;
  const P: Pending = { bank: [], ledger: [], links: [], missingInBank: [], missingInLedger: [], currencyMismatch: [], duplicateBank: [], duplicateLedger: [], equivalence: [] };
  let invoiceSeq = 10_000 + r.int(0, 50_000);
  let jeSeq = 1;
  const bankIds = new Set<string>();
  const bankId = () => {
    let id: string;
    do id = `BTX${r.int(10_000_000, 99_999_999)}`;
    while (bankIds.has(id));
    bankIds.add(id);
    return id;
  };
  const jeId = () => `JE-${String(jeSeq++).padStart(6, "0")}`;
  const scenarioCounts: Partial<Record<Scenario, number>> = {};
  const scenarioItems = Object.entries(SCENARIO_WEIGHTS) as [Scenario, number][];

  const ledgerRow = (day: number, amount: bigint, currency: string, inflow: boolean, cp: string, ref?: string): Row => {
    const reference = ref ?? (inflow ? `INV-${invoiceSeq++}` : `BILL-${invoiceSeq++}`);
    return {
      extId: jeId(),
      day,
      amountMinor: amount,
      currency,
      reference,
      description: inflow ? `Customer receipt ${cp}` : `Payment to ${cp}`,
      counterparty: cp,
    };
  };
  const bankNarrative = (inflow: boolean, cp: string, ref: string | null) => {
    const CP = cp.toUpperCase();
    if (inflow) return r.pick(ref ? [`ACH CREDIT ${CP} ${ref}`, `WIRE IN ${CP} REF ${ref}`, `${CP} PMT ${ref}`] : [`ACH CREDIT ${CP}`, `${CP} PAYMENT`, `DEPOSIT ${CP}`]);
    return r.pick(ref ? [`ACH DEBIT ${CP} ${ref}`, `WIRE OUT ${CP} ${ref}`] : [`ACH DEBIT ${CP}`, `CARD PURCHASE ${CP}`, `DIRECT DEBIT ${CP}`]);
  };
  const bankRow = (day: number, amount: bigint, currency: string, inflow: boolean, cp: string, ref: string | null, refField = ""): Row => ({
    extId: bankId(),
    day,
    amountMinor: amount,
    currency,
    reference: refField,
    description: bankNarrative(inflow, cp, ref),
    // Many bank exports carry no counterparty column value; keep the model honest about that.
    counterparty: r.chance(0.3) ? "" : cp.toUpperCase(),
  });

  for (let e = 0; e < events; e++) {
    const scenario = weightedPick(r, scenarioItems);
    scenarioCounts[scenario] = (scenarioCounts[scenario] ?? 0) + 1;
    const currency = weightedPick(r, CURRENCY_WEIGHTS);
    const inflow = r.chance(0.62);
    const sign = inflow ? 1n : -1n;
    const cp = inflow ? r.pick(CUSTOMERS) : r.pick(VENDORS);
    const day = startDay + r.int(0, span);
    const amount = randomAmount(r, currency) * sign;
    const lag = r.int(0, 2);

    switch (scenario) {
      case "exact_reference": {
        const l = ledgerRow(day, amount, currency, inflow, cp);
        const b = bankRow(day + lag, amount, currency, inflow, cp, null, l.reference);
        P.ledger.push(l); P.bank.push(b); P.links.push({ bank: [b], ledger: [l], scenario });
        break;
      }
      case "narrative_reference": {
        const l = ledgerRow(day, amount, currency, inflow, cp);
        const b = bankRow(day + lag, amount, currency, inflow, cp, l.reference);
        P.ledger.push(l); P.bank.push(b); P.links.push({ bank: [b], ledger: [l], scenario });
        break;
      }
      case "no_reference": {
        const l = ledgerRow(day, amount, currency, inflow, cp);
        const b = bankRow(day + lag, amount, currency, inflow, cp, null);
        P.ledger.push(l); P.bank.push(b); P.links.push({ bank: [b], ledger: [l], scenario });
        break;
      }
      case "noisy_reference": {
        const l = ledgerRow(day, amount, currency, inflow, cp);
        const b = bankRow(day + lag, amount, currency, inflow, cp, typo(r, l.reference));
        P.ledger.push(l); P.bank.push(b); P.links.push({ bank: [b], ledger: [l], scenario });
        break;
      }
      case "fee_deducted": {
        const gross = amount < 0n ? -amount : amount;
        const l = ledgerRow(day, gross, currency, true, r.pick(CUSTOMERS));
        const fee = r.chance(0.5) ? BigInt(r.int(1000, 3500)) : (gross * BigInt(r.int(50, 250))) / 10_000n;
        const b = bankRow(day + lag, gross - fee, currency, true, l.counterparty, r.chance(0.5) ? l.reference : null);
        P.ledger.push(l); P.bank.push(b); P.links.push({ bank: [b], ledger: [l], scenario });
        break;
      }
      case "rounding": {
        const l = ledgerRow(day, amount, currency, inflow, cp);
        const b = bankRow(day + lag, amount + (r.chance(0.5) ? 1n : -1n), currency, inflow, cp, r.chance(0.5) ? l.reference : null);
        P.ledger.push(l); P.bank.push(b); P.links.push({ bank: [b], ledger: [l], scenario });
        break;
      }
      case "late_settlement": {
        const l = ledgerRow(day, amount, currency, inflow, cp);
        const b = bankRow(day + r.int(3, 5), amount, currency, inflow, cp, r.chance(0.4) ? l.reference : null);
        P.ledger.push(l); P.bank.push(b); P.links.push({ bank: [b], ledger: [l], scenario });
        break;
      }
      case "split_payment": {
        // One invoice paid in 2-3 instalments.
        const gross = (amount < 0n ? -amount : amount) + 10_000n;
        const l = ledgerRow(day, gross, currency, true, r.pick(CUSTOMERS));
        const parts = r.int(2, 3);
        const bs: Row[] = [];
        let remaining = gross;
        for (let i = 0; i < parts; i++) {
          // Shares bounded so the final instalment stays positive: 2 parts 25-55%, 3 parts 20-40% each.
          const share = parts === 2 ? r.int(25, 55) : r.int(20, 40);
          const part = i === parts - 1 ? remaining : (gross * BigInt(share)) / 100n;
          remaining -= part;
          bs.push(bankRow(day + r.int(0, 3), part, currency, true, l.counterparty, `${l.reference} PART ${i + 1}`));
        }
        P.ledger.push(l); P.bank.push(...bs); P.links.push({ bank: bs, ledger: [l], scenario });
        break;
      }
      case "aggregate_settlement": {
        // Several card sales settled by one processor payout.
        const n = r.int(2, 4);
        const ls: Row[] = [];
        for (let i = 0; i < n; i++) {
          const a = randomAmount(r, currency) / 10n + 500n;
          const c = r.pick(CUSTOMERS);
          ls.push({ ...ledgerRow(day - r.int(0, 2), a, currency, true, c, `SALE-${invoiceSeq++}`), description: `Card sale via Stripe - ${c}` });
        }
        const total = ls.reduce((s, x) => s + x.amountMinor, 0n);
        const b: Row = { extId: bankId(), day: day + 1, amountMinor: total, currency, reference: `PO_${r.int(100000, 999999)}`, description: "STRIPE PAYOUT", counterparty: "STRIPE" };
        P.ledger.push(...ls); P.bank.push(b); P.links.push({ bank: [b], ledger: ls, scenario });
        break;
      }
      case "missing_in_bank": {
        const l = ledgerRow(day, amount, currency, inflow, cp);
        P.ledger.push(l); P.missingInBank.push(l);
        break;
      }
      case "missing_in_ledger": {
        const kind = r.int(0, 2);
        const b: Row =
          kind === 0
            ? { extId: bankId(), day, amountMinor: -BigInt(r.int(500, 4500)), currency, reference: "", description: "MONTHLY SERVICE FEE", counterparty: "BANK" }
            : kind === 1
              ? { extId: bankId(), day, amountMinor: BigInt(r.int(100, 9000)), currency, reference: "", description: "INTEREST CREDIT", counterparty: "BANK" }
              : bankRow(day, amount, currency, inflow, cp, null);
        P.bank.push(b); P.missingInLedger.push(b);
        break;
      }
      case "duplicate_ledger": {
        const l = ledgerRow(day, amount, currency, inflow, cp);
        const copy = { ...l, extId: jeId() };
        const b = bankRow(day + lag, amount, currency, inflow, cp, r.chance(0.5) ? l.reference : null);
        P.ledger.push(l, copy); P.bank.push(b);
        P.links.push({ bank: [b], ledger: [l], scenario });
        P.missingInBank.push(copy);
        P.duplicateLedger.push([l, copy]);
        P.equivalence.push([l, copy]);
        break;
      }
      case "duplicate_bank": {
        const l = ledgerRow(day, amount, currency, inflow, cp);
        const b = bankRow(day + lag, amount, currency, inflow, cp, r.chance(0.5) ? l.reference : null);
        const copy = { ...b };
        P.ledger.push(l); P.bank.push(b, copy);
        P.links.push({ bank: [b], ledger: [l], scenario });
        P.missingInLedger.push(copy);
        P.duplicateBank.push([b, copy]);
        P.equivalence.push([b, copy]);
        break;
      }
      case "currency_mismatch": {
        const l = ledgerRow(day, amount, "USD", inflow, cp);
        const eurAmount = (amount * 92n) / 100n;
        const b = bankRow(day + lag, eurAmount, "EUR", inflow, cp, null, l.reference);
        P.ledger.push(l); P.bank.push(b); P.currencyMismatch.push({ bank: b, ledger: l });
        break;
      }
      case "ambiguous_twins": {
        // Two indistinguishable subscription charges to the same customer on the same day.
        const c = r.pick(CUSTOMERS);
        const a = BigInt(r.int(5, 60)) * 1000n;
        const l1 = { ...ledgerRow(day, a, currency, true, c), reference: "", description: `Subscription ${c}` };
        const l2 = { ...ledgerRow(day, a, currency, true, c), reference: "", description: `Subscription ${c}` };
        const b1 = bankRow(day + lag, a, currency, true, c, null);
        const b2 = { ...bankRow(day + lag, a, currency, true, c, null), description: b1.description };
        P.ledger.push(l1, l2); P.bank.push(b1, b2);
        P.links.push({ bank: [b1], ledger: [l1], scenario }, { bank: [b2], ledger: [l2], scenario });
        P.equivalence.push([l1, l2], [b1, b2]);
        break;
      }
    }
  }

  // Shuffle each side deterministically, then derive the ids the CSV importer will assign.
  const shuffle = <T>(arr: T[]) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(r.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
  };
  shuffle(P.bank);
  shuffle(P.ledger);
  const bankIdOf = new Map<Row, string>(P.bank.map((row, i) => [row, `B-${String(i + 1).padStart(6, "0")}`]));
  const ledgerIdOf = new Map<Row, string>(P.ledger.map((row, i) => [row, `L-${String(i + 1).padStart(6, "0")}`]));
  const idOf = (row: Row) => bankIdOf.get(row) ?? ledgerIdOf.get(row)!;

  const bankCsv = Papa.unparse({
    fields: ["Transaction ID", "Posting Date", "Description", "Reference", "Counterparty", "Amount", "Currency"],
    data: P.bank.map((x) => [x.extId, dayToIso(x.day), x.description, x.reference, x.counterparty, toDecimalString(x.amountMinor, x.currency), x.currency]),
  });
  const ledgerCsv = Papa.unparse({
    fields: ["Entry ID", "Date", "Reference", "Memo", "Counterparty", "Amount", "Currency"],
    data: P.ledger.map((x) => [x.extId, dayToIso(x.day), x.reference, x.description, x.counterparty, toDecimalString(x.amountMinor, x.currency), x.currency]),
  });

  const pb = parseCsv(bankCsv);
  const pl = parseCsv(ledgerCsv);
  const nb = normalizeRows("bank", pb.headers, pb.rows, DEMO_BANK_MAPPING);
  const nl = normalizeRows("ledger", pl.headers, pl.rows, DEMO_LEDGER_MAPPING);
  const problems = [...pb.errors, ...pl.errors, ...nb.errors, ...nl.errors];
  if (problems.length > 0) throw new Error(`Synthetic data failed validation: ${JSON.stringify(problems.slice(0, 3))}`);

  const canonical: Record<string, string> = {};
  for (const group of P.equivalence) {
    const ids = group.map(idOf).sort();
    for (const id of ids) canonical[id] = ids[0]!;
  }

  return {
    seed,
    bankCsv,
    ledgerCsv,
    bank: nb.transactions,
    ledger: nl.transactions,
    truth: {
      links: P.links.map((l) => ({ bankIds: l.bank.map(idOf), ledgerIds: l.ledger.map(idOf), scenario: l.scenario })),
      missingInBank: P.missingInBank.map(idOf),
      missingInLedger: P.missingInLedger.map(idOf),
      currencyMismatch: P.currencyMismatch.map((c) => ({ bankId: idOf(c.bank), ledgerId: idOf(c.ledger) })),
      duplicateBank: P.duplicateBank.map((g) => g.map(idOf)),
      duplicateLedger: P.duplicateLedger.map((g) => g.map(idOf)),
      canonical,
      scenarioCounts,
    },
  };
}
