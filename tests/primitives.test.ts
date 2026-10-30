import { describe, expect, it } from "vitest";
import { detectDateFormats, parseDate, tryParseDate } from "@/engine/dates";
import { formatMinor, MoneyParseError, parseAmount, relativeDifference, sumMinor } from "@/engine/money";
import { identifierCrossHit, jaroWinkler, normalizeReference } from "@/engine/text";

describe("parseAmount", () => {
  it("parses plain, grouped and negative amounts into minor units", () => {
    expect(parseAmount("1234.56", "USD")).toBe(123456n);
    expect(parseAmount("1,234.5", "USD")).toBe(123450n);
    expect(parseAmount("-0.01", "USD")).toBe(-1n);
    expect(parseAmount("(250.00)", "USD")).toBe(-25000n);
    expect(parseAmount("+7", "USD")).toBe(700n);
    expect(parseAmount("1.234,56", "EUR", { decimalSeparator: "," })).toBe(123456n);
    expect(parseAmount("1 234,56", "EUR", { decimalSeparator: "," })).toBe(123456n);
  });

  it("respects currency exponents", () => {
    expect(parseAmount("1500", "JPY")).toBe(1500n);
    expect(parseAmount("12.345", "KWD")).toBe(12345n);
    expect(() => parseAmount("1500.5", "JPY")).toThrow(MoneyParseError);
  });

  it("rejects extra precision instead of rounding", () => {
    expect(() => parseAmount("10.005", "USD")).toThrow(/decimal places/);
  });

  it("rejects malformed input", () => {
    for (const bad of ["", "abc", "1,23.00", "12,34", "1.2.3", "10.", "$10", "--5", "(-5)", "1e5", "NaN"]) {
      expect(() => parseAmount(bad, "USD"), bad).toThrow(MoneyParseError);
    }
    expect(() => parseAmount("10", "XYZ")).toThrow(/Unsupported currency/);
  });

  it("is exact where floating point is not", () => {
    // 0.1 + 0.2 !== 0.3 in IEEE754; in minor units it is exact.
    expect(sumMinor([parseAmount("0.10", "USD"), parseAmount("0.20", "USD")])).toBe(parseAmount("0.30", "USD"));
    const big = parseAmount("90071992547409.93", "USD");
    expect(big + 1n).toBe(9007199254740994n);
  });

  it("formats minor units", () => {
    expect(formatMinor(123456n, "USD")).toBe("1,234.56");
    expect(formatMinor(-5n, "USD")).toBe("-0.05");
    expect(formatMinor(1500n, "JPY")).toBe("1,500");
    expect(formatMinor(12345n, "KWD")).toBe("12.345");
  });

  it("computes relative difference for features", () => {
    expect(relativeDifference(10000n, 10000n)).toBe(0);
    expect(relativeDifference(9800n, 10000n)).toBeCloseTo(0.02, 6);
  });
});

describe("dates", () => {
  it("parses formats and rejects impossible dates", () => {
    expect(parseDate("2024-02-29", "YYYY-MM-DD").iso).toBe("2024-02-29");
    expect(tryParseDate("2023-02-29", "YYYY-MM-DD")).toBeNull();
    expect(parseDate("31/01/2024", "DD/MM/YYYY").iso).toBe("2024-01-31");
    expect(tryParseDate("31/01/2024", "MM/DD/YYYY")).toBeNull();
    expect(parseDate("2024-03-05T13:00:00Z", "YYYY-MM-DD").iso).toBe("2024-03-05");
  });

  it("computes day numbers without timezone drift", () => {
    expect(parseDate("2024-03-11", "YYYY-MM-DD").day - parseDate("2024-03-09", "YYYY-MM-DD").day).toBe(2);
  });

  it("reports ambiguous formats rather than guessing", () => {
    expect(detectDateFormats(["01/02/2024", "03/04/2024"])).toEqual(["DD/MM/YYYY", "MM/DD/YYYY"]);
    expect(detectDateFormats(["13/02/2024", "03/04/2024"])).toEqual(["DD/MM/YYYY"]);
  });
});

describe("text", () => {
  it("normalizes references", () => {
    expect(normalizeReference("inv-2024 /001")).toBe("INV2024001");
  });
  it("detects identifiers inside narratives", () => {
    expect(identifierCrossHit("INV-10023", "ACH PMT INV10023 ACME")).toBe(true);
    expect(identifierCrossHit("RENT", "RENT PAYMENT")).toBe(false); // no digits: too generic
  });
  it("jaro-winkler behaves", () => {
    expect(jaroWinkler("MARTHA", "MARHTA")).toBeCloseTo(0.961, 3);
    expect(jaroWinkler("", "X")).toBe(0);
  });
});
