import { errorResponse } from "@/server/http";
import { demoCsv } from "@/server/service";

export const runtime = "nodejs";

/** Download a synthetic CSV (no real data) to try the upload flow. */
export function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const side = url.searchParams.get("side") === "ledger" ? "ledger" : "bank";
    const seed = Math.trunc(Number(url.searchParams.get("seed") ?? "42")) || 42;
    const events = Math.trunc(Number(url.searchParams.get("events") ?? "1000")) || 1000;
    return new Response(demoCsv(seed, events, side), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="synthetic-${side}-${seed}.csv"` },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
