import { z } from "zod";
import { DATE_FORMATS } from "@/engine/dates";

const column = z.string().max(200).optional();

export const mappingSchema = z.object({
  date: z.string().min(1).max(200),
  amount: column,
  debit: column,
  credit: column,
  currency: column,
  defaultCurrency: z.string().max(3).optional(),
  reference: column,
  description: column,
  externalId: column,
  counterparty: column,
  dateFormat: z.enum(DATE_FORMATS),
  decimalSeparator: z.enum([".", ","]),
  invertSign: z.boolean().optional(),
});

const MAX_ROWS = 100_000;
const cell = z.string().max(2_000);

/** The extraction exactly as returned by /api/imports/extract (verified against its signature on the server). */
const extractionSchema = z.object({
  headers: z.array(cell).min(1).max(60),
  rows: z.array(z.array(cell).max(60)).max(MAX_ROWS),
  locators: z.array(z.string().max(200)).max(MAX_ROWS),
  rowFlags: z.array(z.object({ row: z.number().int().nonnegative(), code: z.string().max(40), message: z.string().max(300) })).max(MAX_ROWS),
  warnings: z.array(z.string().max(500)).max(50),
  balances: z
    .object({
      opening: z.object({ raw: z.string().max(60), location: z.string().max(200) }).optional(),
      closing: z.object({ raw: z.string().max(60), location: z.string().max(200) }).optional(),
    })
    .optional(),
});

const confirmSideSchema = z.object({
  token: z.string().min(1).max(4_000),
  extraction: extractionSchema,
  mapping: mappingSchema.extend({ balance: z.string().max(200).optional() }),
  excludedRows: z.array(z.number().int()).max(MAX_ROWS),
  confirmed: z.literal(true, { error: "Confirm that you have checked the extracted transactions" }),
});

// Identity comes from the server session; request bodies never carry a reviewer name.
export const createRunSchema = z.object({ name: z.string().max(120), bank: confirmSideSchema, ledger: confirmSideSchema });

export const demoRunSchema = z.object({ seed: z.number().int(), events: z.number().int() });

export const matchDecisionSchema = z.object({
  decision: z.enum(["approve", "reject", "reopen"]),
  reason: z.string().max(1000),
});

export const exceptionDecisionSchema = z.object({
  decision: z.enum(["resolve", "reopen"]),
  reason: z.string().max(1000),
});
