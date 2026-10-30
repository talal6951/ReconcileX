import { parseDate } from "@/engine/dates";
import { parseAmount } from "@/engine/money";
import type { Side, Transaction } from "@/engine/types";

let seq = 0;

/** Build a transaction for tests. Amount is a decimal string parsed with the strict money parser. */
export function tx(side: Side, p: Partial<Omit<Transaction, "amountMinor">> & { amount: string; date: string }): Transaction {
  seq++;
  const currency = p.currency ?? "USD";
  const d = parseDate(p.date, "YYYY-MM-DD");
  return {
    id: p.id ?? `${side === "bank" ? "B" : "L"}-${String(seq).padStart(6, "0")}`,
    side,
    sourceLine: seq + 1,
    externalId: p.externalId ?? "",
    date: d.iso,
    day: d.day,
    amountMinor: parseAmount(p.amount, currency),
    currency,
    reference: p.reference ?? "",
    description: p.description ?? "",
    counterparty: p.counterparty ?? "",
  };
}
