import { withWorkspace } from "@/server/http";
import { exportWorkspaceAudit } from "@/server/service";

export const runtime = "nodejs";

/**
 * Workspace-scoped audit CSV with the same filters as the Audit trail page.
 * The workspace comes from the verified session (withWorkspace), never the query string.
 */
export const GET = withWorkspace((ctx, req) => {
  const p = new URL(req.url).searchParams;
  const pick = (k: string) => p.get(k)?.trim().slice(0, 200) || undefined;
  const out = exportWorkspaceAudit(ctx, {
    q: pick("q"),
    action: pick("action"),
    actor: pick("actor"),
    runId: pick("run"),
    from: pick("from"),
    to: pick("to"),
  });
  const day = new Date().toISOString().slice(0, 10);
  return new Response(out.csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="audit-trail-${day}.csv"`,
      // Lets clients tell the user when the export was capped.
      "x-audit-matched": String(out.total),
      "x-audit-exported": String(out.exported),
      "x-audit-truncated": String(out.truncated),
    },
  });
});
