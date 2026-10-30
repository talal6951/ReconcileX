import "server-only";
import { NextResponse } from "next/server";
import { NotFoundError, ValidationError } from "./repo";
import { AuthError, requireWorkspace, type WorkspaceContext } from "./session";

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
  if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
  if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
  console.error("[reconcile-x] unexpected error", e);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}

const NO_STORE = { "cache-control": "no-store" };

/**
 * Wrap an API handler: authenticate, resolve workspace, enforce same-origin for
 * mutations, and map errors. Handlers never run without a verified context.
 */
export function withWorkspace<P>(
  handler: (ctx: WorkspaceContext, req: Request, params: P) => Promise<Response> | Response,
  opts: { mutation?: boolean } = {},
) {
  return async (req: Request, routeCtx: { params: Promise<P> }) => {
    if (opts.mutation) {
      const blocked = assertSameOrigin(req);
      if (blocked) return blocked;
    }
    try {
      const ctx = await requireWorkspace();
      const res = await handler(ctx, req, await routeCtx.params);
      for (const [k, v] of Object.entries(NO_STORE)) if (!res.headers.has(k)) res.headers.set(k, v);
      return res;
    } catch (e) {
      return errorResponse(e);
    }
  };
}
