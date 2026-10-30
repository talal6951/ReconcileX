/** Text normalisation and similarity measures used for references and descriptions. */

export function normalizeText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/** Reference key: uppercase alphanumerics only, so "INV-1001", "inv 1001" and "INV1001" collide. */
export function normalizeReference(s: string): string {
  return normalizeText(s).replace(/ /g, "");
}

export function tokens(s: string): string[] {
  const t = normalizeText(s);
  return t ? t.split(" ") : [];
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function jaroWinkler(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  if (a === b) return 1;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatch = new Array<boolean>(a.length).fill(false);
  const bMatch = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(i + range + 1, b.length);
    for (let j = lo; j < hi; j++) {
      if (bMatch[j] || a[i] !== b[j]) continue;
      aMatch[i] = bMatch[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - t / 2) / m) / 3;
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Tokens that look like identifiers (contain a digit, length >= 4): invoice numbers, PO numbers, etc. */
export function identifierTokens(s: string): string[] {
  return tokens(s).filter((t) => t.length >= 4 && /\d/.test(t));
}

/**
 * True when an identifier from one record appears inside the other record's
 * reference or description, e.g. ledger ref "INV-10023" inside bank narrative
 * "ACH PMT INV10023 ACME".
 */
export function identifierCrossHit(refA: string, textB: string): boolean {
  const key = normalizeReference(refA);
  if (key.length < 4 || !/\d/.test(key)) return false;
  return normalizeReference(textB).includes(key);
}
