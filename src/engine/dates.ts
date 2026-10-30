/** Calendar-date handling. Dates are plain calendar days; no timezone conversion is applied. */

export const DATE_FORMATS = ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY", "YYYY/MM/DD", "DD-MM-YYYY", "DD.MM.YYYY", "DD MMM YYYY"] as const;

/** English month abbreviations for "DD MMM YYYY" (e.g. "03 Jul 2024", "3-JUL-2024"). */
const MONTHS: Record<string, number> = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
export type DateFormat = (typeof DATE_FORMATS)[number];

const PATTERNS: Record<Exclude<DateFormat, "DD MMM YYYY">, { re: RegExp; order: ["y" | "m" | "d", "y" | "m" | "d", "y" | "m" | "d"] }> = {
  "YYYY-MM-DD": { re: /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/, order: ["y", "m", "d"] },
  "YYYY/MM/DD": { re: /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, order: ["y", "m", "d"] },
  "DD/MM/YYYY": { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: ["d", "m", "y"] },
  "MM/DD/YYYY": { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: ["m", "d", "y"] },
  "DD-MM-YYYY": { re: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, order: ["d", "m", "y"] },
  "DD.MM.YYYY": { re: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, order: ["d", "m", "y"] },
};

export class DateParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DateParseError";
  }
}

export interface ParsedDate {
  iso: string;
  /** Days since 1970-01-01 (UTC calendar). */
  day: number;
}

export function isValidCalendarDate(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= dim;
}

export function tryParseDate(input: string, format: DateFormat): ParsedDate | null {
  let y: number, mo: number, d: number;
  if (format === "DD MMM YYYY") {
    const m = /^(\d{1,2})[ -]([A-Za-z]{3})[ -](\d{4})$/.exec(input.trim());
    const month = m ? MONTHS[m[2]!.toUpperCase()] : undefined;
    if (!m || !month) return null;
    [d, mo, y] = [Number(m[1]), month, Number(m[3])];
  } else {
    const p = PATTERNS[format];
    const m = p.re.exec(input.trim());
    if (!m) return null;
    const parts: Record<string, number> = {};
    p.order.forEach((k, i) => (parts[k] = Number(m[i + 1])));
    [y, mo, d] = [parts.y!, parts.m!, parts.d!];
  }
  if (!isValidCalendarDate(y, mo, d)) return null;
  const iso = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { iso, day: Math.round(Date.UTC(y, mo - 1, d) / 86_400_000) };
}

export function parseDate(input: string, format: DateFormat): ParsedDate {
  const r = tryParseDate(input, format);
  if (!r) throw new DateParseError(`Date "${input}" is not a valid ${format} date`);
  return r;
}

export function dayToIso(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Return every format under which all non-empty samples parse. More than one
 * result (e.g. DD/MM vs MM/DD) means the format is ambiguous and must be
 * confirmed by the user rather than guessed.
 */
export function detectDateFormats(samples: string[]): DateFormat[] {
  const values = samples.map((s) => s.trim()).filter(Boolean);
  if (values.length === 0) return [];
  return DATE_FORMATS.filter((f) => values.every((v) => tryParseDate(v, f) !== null));
}
