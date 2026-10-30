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

export const reviewer = z.string().trim().min(1).max(80);

export const createRunSchema = z.object({
  name: z.string().max(120),
  reviewer,
  bank: z.object({ filename: z.string().min(1).max(200), csv: z.string(), mapping: mappingSchema }),
  ledger: z.object({ filename: z.string().min(1).max(200), csv: z.string(), mapping: mappingSchema }),
});

export const demoRunSchema = z.object({
  reviewer,
  seed: z.number().int(),
  events: z.number().int(),
});

export const matchDecisionSchema = z.object({
  decision: z.enum(["approve", "reject", "reopen"]),
  reason: z.string().max(1000),
  reviewer,
});

export const exceptionDecisionSchema = z.object({
  decision: z.enum(["resolve", "reopen"]),
  reason: z.string().max(1000),
  reviewer,
});
