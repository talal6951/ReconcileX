import { NextResponse } from "next/server";
import { withWorkspace } from "@/server/http";
import { ImportError, MAX_IMPORT_BYTES } from "@/server/imports/types";
import { ValidationError } from "@/server/repo";
import { extractForPreview } from "@/server/service";

export const runtime = "nodejs";

/**
 * Upload a statement file (multipart: file, side, optional sheet) and receive a
 * signed preview. NOTHING is saved by this endpoint.
 */
export const POST = withWorkspace(
  async (ctx, req) => {
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_IMPORT_BYTES + 64 * 1024) throw new ValidationError(`The file is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB.`);
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ValidationError("Expected a multipart form upload with a file.");
    }
    const file = form.get("file");
    const side = form.get("side");
    const sheet = form.get("sheet");
    if (!(file instanceof File)) throw new ValidationError("No file was uploaded.");
    if (side !== "bank" && side !== "ledger") throw new ValidationError("side must be bank or ledger.");
    if (file.size > MAX_IMPORT_BYTES) throw new ValidationError(`The file is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB.`);
    try {
      const out = await extractForPreview(ctx, {
        bytes: new Uint8Array(await file.arrayBuffer()),
        filename: file.name,
        side,
        sheet: typeof sheet === "string" && sheet ? sheet.slice(0, 120) : undefined,
      });
      return NextResponse.json(out);
    } catch (e) {
      // Expected, user-facing extraction outcomes (unsupported file, scanned PDF, …).
      if (e instanceof ImportError) return NextResponse.json({ error: e.message, code: e.code }, { status: 422 });
      throw e;
    }
  },
  { mutation: true },
);
