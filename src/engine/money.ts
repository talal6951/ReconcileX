/**
 * Money primitives. All monetary values are integer minor units held in `bigint`.
 * No function in this module converts money through floating point.
 */

/** ISO 4217 minor-unit exponents for supported currencies. */
export const CURRENCY_EXPONENTS: Readonly<Record<string, number>> = Object.freeze({
  AED: 2, AUD: 2, BHD: 3, BRL: 2, CAD: 2, CHF: 2, CLP: 0, CNY: 2, CZK: 2, DKK: 2,
  EGP: 2, EUR: 2, GBP: 2, HKD: 2, HUF: 2, IDR: 2, ILS: 2, INR: 2, IQD: 3, ISK: 0,
  JOD: 3, JPY: 0, KRW: 0, KWD: 3, LYD: 3, MAD: 2, MXN: 2, MYR: 2, NOK: 2, NZD: 2,
  OMR: 3, PHP: 2, PKR: 2, PLN: 2, QAR: 2, RON: 2, SAR: 2, SEK: 2, SGD: 2, THB: 2,
  TND: 3, TRY: 2, TWD: 2, UGX: 0, USD: 2, VND: 0, XAF: 0, XOF: 0, ZAR: 2,
});

export class MoneyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyParseError";
  }
}

export function normalizeCurrency(code: string): string {
  return code.trim().toUpperCase();
}

export function isSupportedCurrency(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(CURRENCY_EXPONENTS, normalizeCurrency(code));
}

export function currencyExponent(code: string): number {
  const c = normalizeCurrency(code);
  const exp = CURRENCY_EXPONENTS[c];
  if (exp === undefined) throw new MoneyParseError(`Unsupported currency "${code}"`);
  return exp;
}

export type DecimalSeparator = "." | ",";

export interface ParseAmountOptions {
  decimalSeparator?: DecimalSeparator;
}

/**
 * Strictly parse a human-entered amount into minor units.
 *
 * Accepted: optional sign (+/-), parentheses for negatives, correctly grouped
 * thousands separators, and at most `exponent` fractional digits. Anything
 * else — extra precision, malformed grouping, stray characters — is rejected
 * rather than rounded, because silent rounding corrupts reconciliation.
 */
export function parseAmount(input: string, currency: string, opts: ParseAmountOptions = {}): bigint {
  const exp = currencyExponent(currency);
  const dec = opts.decimalSeparator ?? ".";
  const group = dec === "." ? "," : ".";
  let s = input.trim();
  if (s === "") throw new MoneyParseError("Amount is empty");

  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith("-") || s.startsWith("+")) {
    if (s.startsWith("-")) {
      if (negative) throw new MoneyParseError(`Amount "${input}" has conflicting negative markers`);
      negative = true;
    }
    s = s.slice(1).trim();
  }
  // Allow space or apostrophe grouping in addition to the configured group separator.
  const groupPattern = `[${group === "." ? "\\." : ","} '  ]`;
  const decPattern = dec === "." ? "\\." : ",";
  const re = new RegExp(`^(\\d{1,3}(?:${groupPattern}\\d{3})+|\\d+)(?:${decPattern}(\\d+))?$`);
  const m = re.exec(s);
  if (!m) throw new MoneyParseError(`Amount "${input}" is not a valid number`);
  const intPart = m[1]!.replace(/[^\d]/g, "");
  const fracPart = m[2] ?? "";
  if (fracPart.length > exp) {
    throw new MoneyParseError(
      `Amount "${input}" has ${fracPart.length} decimal places; ${normalizeCurrency(currency)} allows ${exp}`,
    );
  }
  const minor = BigInt(intPart + fracPart.padEnd(exp, "0") || "0");
  return negative ? -minor : minor;
}

export function absMinor(v: bigint): bigint {
  return v < 0n ? -v : v;
}

/** Format minor units as a decimal string, e.g. 123456n USD -> "1,234.56". */
export function formatMinor(minor: bigint, currency: string, opts: { grouping?: boolean } = {}): string {
  const exp = currencyExponent(currency);
  const neg = minor < 0n;
  const digits = absMinor(minor).toString().padStart(exp + 1, "0");
  const intPart = exp === 0 ? digits : digits.slice(0, -exp);
  const fracPart = exp === 0 ? "" : digits.slice(-exp);
  const grouped = opts.grouping === false ? intPart : intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${grouped}${fracPart ? "." + fracPart : ""}`;
}

export function formatMoney(minor: bigint, currency: string): string {
  return `${formatMinor(minor, currency)} ${normalizeCurrency(currency)}`;
}

/** Plain decimal string with no grouping, suitable for CSV export. */
export function toDecimalString(minor: bigint, currency: string): string {
  return formatMinor(minor, currency, { grouping: false });
}

/** Ratio |a-b| / max(|a|,|b|) as a float for ML features only (never for money decisions). */
export function relativeDifference(a: bigint, b: bigint): number {
  const diff = absMinor(a - b);
  const denom = absMinor(a) > absMinor(b) ? absMinor(a) : absMinor(b);
  if (denom === 0n) return diff === 0n ? 0 : 1;
  // Scale to keep 1e-6 precision in integer space before converting.
  return Number((diff * 1_000_000n) / denom) / 1_000_000;
}

export function sumMinor(values: Iterable<bigint>): bigint {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}
