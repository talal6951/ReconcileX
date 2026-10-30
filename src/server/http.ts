import "server-only";
import { NextResponse } from "next/server";
import { NotFoundError, ValidationError } from "./repo";

/** Reject cross-site state-changing requests (CSRF) by requiring a same-origin Origin header. */
export function assertSameOrigin(req: Request): NextResponse | null {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host) return NextResponse.json({ error: "Missing origin" }, { status: 403 });
  try {
    if (new URL(origin).host !== host) return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  } catch {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  return null;
}

export async function readJson<T>(req: Request, maxBytes: number): Promise<T> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) throw new ValidationError(`Request body exceeds ${Math.round(maxBytes / 1024 / 1024)} MB`);
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new ValidationError(`Request body exceeds ${Math.round(maxBytes / 1024 / 1024)} MB`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ValidationError("Request body is not valid JSON");
  }
}

/** Map domain errors to HTTP responses without leaking internals. */
export function errorResponse(e: unknown): NextResponse {
  if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
  if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
  console.error("[reconcile-x] unexpected error", e);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}
