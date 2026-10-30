import { validateMapping } from "@/engine/csv";
import type { LogisticModel } from "@/engine/model";
import { validateStatement, type StatementValidation } from "@/engine/statement";
import type { ColumnMapping, RowError, Side } from "@/engine/types";
import type { DB } from "../db";
import { createRun, ValidationError, type CreateRunOutcome, type ImportSide } from "../repo";
import { TokenError, verifyPreview, type ImportClaims } from "./token";
import type { ExtractedTable } from "./types";

/** What the browser sends back for one side after the user reviewed and confirmed the preview. */
export interface ConfirmSide {
  token: string;
  extraction: Pick<ExtractedTable, "headers" | "rows" | "locators" | "rowFlags" | "warnings" | "balances">;
  mapping: ColumnMapping;
  /** 0-based indexes of rows the user explicitly excluded. */
  excludedRows: number[];
  /** Must be true: the user ticked "I have checked these transactions against the original statement". */
  confirmed: boolean;
}

export interface ConfirmContext {
  orgId: string;
  userId: string;
  actor: string;
}

const MAX_REPORTED = 200;
const toJson = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

/**
 * Server-side gate between a signed preview and saved financial data.
 * Nothing is persisted unless: the user confirmed, the signature verifies for
 * this user/workspace/side, every remaining row validates, and exclusions are
 * explicit. The saved provenance records exactly what was confirmed.
 */
export function confirmImportRun(db: DB, ctx: ConfirmContext, input: { name: string; bank: ConfirmSide; ledger: ConfirmSide }, model: LogisticModel): CreateRunOutcome {
  const sides = {} as Record<Side, ImportSide>;
  const errors: Extract<CreateRunOutcome, { ok: false }>["errors"] = [];
  const confirmedAt = new Date().toISOString();

  for (const side of ["bank", "ledger"] as const) {
    const s = input[side];
    if (s.confirmed !== true) throw new ValidationError(`Confirm that you have checked the ${side} transactions before importing`);

    let claims: ImportClaims;
    try {
      claims = verifyPreview(s.token, s.extraction, { orgId: ctx.orgId, userId: ctx.userId, side });
    } catch (e) {
      if (e instanceof TokenError) throw new ValidationError(`${side === "bank" ? "Bank" : "Ledger"} file: ${e.message}`);
      throw e;
    }

    const n = s.extraction.rows.length;
    const excluded = new Set<number>();
    for (const i of s.excludedRows) {
      if (!Number.isInteger(i) || i < 0 || i >= n) throw new ValidationError(`Excluded row ${i} does not exist in the ${side} file`);
      if (excluded.has(i)) throw new ValidationError(`Row ${i} is excluded twice`);
      excluded.add(i);
    }
    if (excluded.size === n) throw new ValidationError(`Every ${side} row was excluded; nothing would be imported`);

    const v: StatementValidation = validateStatement(
      { side, ...s.extraction, mapping: s.mapping, excluded },
      validateMapping(s.extraction.headers, s.mapping),
    );
    if (v.mappingProblems.length || v.counts.errors > 0) {
      const rowErrors: RowError[] = v.rows
        .filter((r) => r.state === "error")
        .slice(0, MAX_REPORTED)
        .map((r) => ({ line: r.index + 1, message: `${r.locator}: ${r.errors.join("; ")}` }));
      const problems = [...v.mappingProblems];
      if (v.counts.errors) problems.push(`${v.counts.errors} row(s) have errors. Exclude them explicitly or correct the source file — amounts are never changed automatically.`);
      errors.push({ side, problems, rowErrors, totalRowErrors: v.counts.errors });
      continue;
    }

    const keep = s.extraction.rows.map((_, i) => i).filter((i) => !excluded.has(i));
    sides[side] = {
      filename: claims.filename,
      mapping: s.mapping,
      table: { headers: s.extraction.headers, rows: keep.map((i) => s.extraction.rows[i]!), lines: keep.map((i) => i + 1) },
      provenance: {
        kind: claims.kind,
        sourceSha256: claims.sha256,
        sourceBytes: claims.bytes,
        confirmedBy: ctx.actor,
        confirmedAt,
        extraction: toJson({
          tableHash: claims.tableHash,
          sheet: claims.sheet,
          pages: claims.pages,
          extractedRows: n,
          importedRows: keep.length,
          warnings: s.extraction.warnings,
          extractionFlags: s.extraction.rowFlags.length,
          balances: s.extraction.balances ?? null,
          balanceCheck: v.balanceCheck,
          runningBalance: v.runningBalance,
          rowWarnings: v.counts.warnings,
          totals: v.totals,
          // Excluded rows are kept verbatim so the decision can be audited later.
          excluded: [...excluded].sort((a, b) => a - b).map((i) => ({ row: i + 1, locator: s.extraction.locators[i], cells: s.extraction.rows[i] })),
        }),
      },
    };
  }
  if (errors.length) return { ok: false, errors };
  return createRun(db, { orgId: ctx.orgId, name: input.name, actor: ctx.actor, model, source: "upload", bank: sides.bank, ledger: sides.ledger });
}
