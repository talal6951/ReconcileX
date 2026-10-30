import { errorResponse } from "@/server/http";
import { ValidationError } from "@/server/repo";
import { exportRun, type ExportFormat } from "@/server/service";

export const runtime = "nodejs";

const FORMATS: ExportFormat[] = ["matches", "exceptions", "decisions", "audit", "json"];

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const format = url.searchParams.get("format") as ExportFormat;
    if (!FORMATS.includes(format)) throw new ValidationError("Unknown export format");
    const actor = (url.searchParams.get("by") ?? "").trim().slice(0, 80) || "anonymous";
    const out = exportRun(id, format, actor);
    return new Response(out.body, {
      headers: { "content-type": out.contentType, "content-disposition": `attachment; filename="${out.filename}"`, "cache-control": "no-store" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
