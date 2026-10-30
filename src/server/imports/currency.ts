import { isSupportedCurrency } from "@/engine/money";

/**
 * Detect a statement's currency from its non-table text (title block, account
 * details). Returns a code ONLY when exactly one distinct supported ISO 4217
 * code appears; otherwise null — the user is asked instead of guessing.
 */
export function detectCurrency(texts: readonly string[]): string | null {
  const found = new Set<string>();
  for (const t of texts) {
    // Codes are matched only as written in capitals, so ordinary words ("try") never match TRY.
    for (const m of t.matchAll(/\b[A-Z]{3}\b/g)) {
      if (isSupportedCurrency(m[0])) found.add(m[0]);
    }
  }
  return found.size === 1 ? [...found][0]! : null;
}
