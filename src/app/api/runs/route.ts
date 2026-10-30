import { NextResponse } from "next/server";
import { createRunSchema } from "@/lib/schemas";
import { assertSameOrigin, errorResponse, readJson } from "@/server/http";
import { MAX_UPLOAD_BYTES } from "@/server/repo";
import { createUploadRun, runs } from "@/server/service";

export const runtime = "nodejs";

export function GET() {
  try {
    return NextResponse.json({ runs: runs() });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;
  try {
    const body = createRunSchema.safeParse(await readJson(req, 2 * MAX_UPLOAD_BYTES + 64 * 1024));
    if (!body.success) return NextResponse.json({ error: "Invalid request", issues: body.error.issues.slice(0, 20) }, { status: 400 });
    const out = createUploadRun(body.data);
    return out.ok ? NextResponse.json({ runId: out.runId }, { status: 201 }) : NextResponse.json({ error: "Validation failed", validation: out.errors }, { status: 422 });
  } catch (e) {
    return errorResponse(e);
  }
}
