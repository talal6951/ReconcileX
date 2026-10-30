import { NextResponse } from "next/server";
import { createRunSchema } from "@/lib/schemas";
import { readJson, withWorkspace } from "@/server/http";
import { confirmUpload, runs } from "@/server/service";

export const runtime = "nodejs";

/** Confirmed previews can carry up to 100k rows per side; cap the JSON body accordingly. */
const MAX_CONFIRM_BODY = 64 * 1024 * 1024;

export const GET = withWorkspace((ctx) => NextResponse.json({ runs: runs(ctx) }));

/**
 * Create a reconciliation from two CONFIRMED import previews.
 * Each side's signature is re-verified server-side; nothing unconfirmed or altered is saved.
 */
export const POST = withWorkspace(
  async (ctx, req) => {
    const body = createRunSchema.safeParse(await readJson(req, MAX_CONFIRM_BODY));
    if (!body.success) return NextResponse.json({ error: "Invalid request", issues: body.error.issues.slice(0, 20) }, { status: 400 });
    const out = confirmUpload(ctx, body.data);
    return out.ok ? NextResponse.json({ runId: out.runId }, { status: 201 }) : NextResponse.json({ error: "Validation failed", validation: out.errors }, { status: 422 });
  },
  { mutation: true },
);
