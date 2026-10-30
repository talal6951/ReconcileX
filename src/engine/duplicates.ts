import { normalizeReference, normalizeText } from "./text";
import type { Side, Transaction } from "./types";

export type DuplicateKind = "exact" | "same_content" | "external_id";

export interface DuplicateGroup {
  side: Side;
  ids: string[];
  /**
   * exact: every field including the transaction ID is identical (re-imported row).
   * same_content: identical except the transaction ID (e.g. an entry posted twice).
   * external_id: same transaction ID but other fields differ.
   */
  kind: DuplicateKind;
}

function contentKey(t: Transaction): string {
  return [
    t.currency,
    t.amountMinor.toString(),
    t.date,
    normalizeReference(t.reference),
    normalizeText(t.description),
    normalizeText(t.counterparty),
  ].join("|");
}

function exactKey(t: Transaction): string {
  return `${normalizeReference(t.externalId)}|${contentKey(t)}`;
}

/**
 * Detect possible duplicates within one side. A group is a *possible* duplicate:
 * two identical legitimate payments look the same, so groups are surfaced for
 * review and never deleted or auto-resolved.
 */
export function findDuplicates(txs: readonly Transaction[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const byExact = new Map<string, Transaction[]>();
  for (const t of txs) {
    const k = exactKey(t);
    const g = byExact.get(k);
    if (g) g.push(t);
    else byExact.set(k, [t]);
  }
  const inExact = new Set<string>();
  for (const g of byExact.values()) {
    if (g.length > 1) {
      groups.push({ side: g[0]!.side, ids: g.map((t) => t.id), kind: "exact" });
      g.forEach((t) => inExact.add(t.id));
    }
  }
  // Same content under different IDs. Skip groups that are wholly a single exact group.
  const byContent = new Map<string, Transaction[]>();
  for (const t of txs) {
    const k = contentKey(t);
    const g = byContent.get(k);
    if (g) g.push(t);
    else byContent.set(k, [t]);
  }
  for (const g of byContent.values()) {
    if (g.length < 2) continue;
    const distinctExact = new Set(g.map(exactKey));
    if (distinctExact.size < 2) continue;
    groups.push({ side: g[0]!.side, ids: g.map((t) => t.id), kind: "same_content" });
  }
  const byExt = new Map<string, Transaction[]>();
  for (const t of txs) {
    const k = normalizeReference(t.externalId);
    if (k.length < 3) continue;
    const g = byExt.get(k);
    if (g) g.push(t);
    else byExt.set(k, [t]);
  }
  for (const g of byExt.values()) {
    if (g.length > 1 && !g.every((t) => inExact.has(t.id))) {
      groups.push({ side: g[0]!.side, ids: g.map((t) => t.id), kind: "external_id" });
    }
  }
  return groups;
}
