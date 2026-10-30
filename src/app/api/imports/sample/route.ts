import { withWorkspace } from "@/server/http";
import { ValidationError } from "@/server/repo";
import { sampleFile } from "@/server/service";

export const runtime = "nodejs";

const FILES = ["bank-pdf", "bank-xlsx", "ledger-csv"] as const;

/** Download a SYNTHETIC sample statement or ledger (no real data). Signed-in users only. */
export const GET = withWorkspace(async (_ctx, req) => {
  const p = new URL(req.url).searchParams;
  const file = p.get("file") as (typeof FILES)[number];
  if (!FILES.includes(file)) throw new ValidationError("Unknown sample file");
  const seed = Math.trunc(Number(p.get("seed") ?? "42")) || 42;
  const events = Math.trunc(Number(p.get("events") ?? "400")) || 400;
  const out = await sampleFile(file, seed, events);
  return new Response(Buffer.from(out.bytes), {
    headers: { "content-type": out.contentType, "content-disposition": `attachment; filename="${out.filename}"` },
  });
});
