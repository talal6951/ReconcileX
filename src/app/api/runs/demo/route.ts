import { NextResponse } from "next/server";
import { demoRunSchema } from "@/lib/schemas";
import { assertSameOrigin, errorResponse, readJson } from "@/server/http";
import { createDemoRun } from "@/server/service";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;
  try {
    const body = demoRunSchema.safeParse(await readJson(req, 16 * 1024));
    if (!body.success) return NextResponse.json({ error: "Invalid request", issues: body.error.issues }, { status: 400 });
    const out = createDemoRun(body.data);
    return out.ok ? NextResponse.json({ runId: out.runId }, { status: 201 }) : NextResponse.json({ error: "Validation failed", validation: out.errors }, { status: 422 });
  } catch (e) {
    return errorResponse(e);
  }
}
