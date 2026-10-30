import { withWorkspace } from "@/server/http";
import { ValidationError } from "@/server/repo";
import { exportRun, type ExportFormat } from "@/server/service";

export const runtime = "nodejs";

const FORMATS: ExportFormat[] = ["matches", "exceptions", "decisions", "audit", "json"];

export const GET = withWorkspace<{ id: string }>((ctx, req, { id }) => {
  const format = new URL(req.url).searchParams.get("format") as ExportFormat;
  if (!FORMATS.includes(format)) throw new ValidationError("Unknown export format");
  const out = exportRun(ctx, id, format);
  return new Response(out.body, {
    headers: { "content-type": out.contentType, "content-disposition": `attachment; filename="${out.filename}"` },
  });
});
