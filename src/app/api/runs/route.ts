import { NextResponse } from "next/server";
import { createRunSchema } from "@/lib/schemas";
import { readJson, withWorkspace } from "@/server/http";
import { MAX_UPLOAD_BYTES } from "@/server/repo";
import { createUploadRun, runs } from "@/server/service";

export const runtime = "nodejs";

export const GET = withWorkspace((ctx) => NextResponse.json({ runs: runs(ctx) }));

export const POST = withWorkspace(
  async (ctx, req) => {
    const body = createRunSchema.safeParse(await readJson(req, 2 * MAX_UPLOAD_BYTES + 64 * 1024));
    if (!body.success) return NextResponse.json({ error: "Invalid request", issues: body.error.issues.slice(0, 20) }, { status: 400 });
    const out = createUploadRun(ctx, body.data);
    return out.ok ? NextResponse.json({ runId: out.runId }, { status: 201 }) : NextResponse.json({ error: "Validation failed", validation: out.errors }, { status: 422 });
  },
  { mutation: true },
);
