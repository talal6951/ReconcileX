import { createHash, createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import type { Side } from "@/engine/types";
import type { ExtractedTable } from "./types";

/**
 * Signed extraction preview.
 *
 * The extract endpoint returns the table AND a token binding it to the
 * workspace, user, side and original file, plus a hash of everything shown in
 * the preview. The confirm endpoint recomputes that hash from what the client
 * sends back — any change to an amount, row, flag or balance invalidates it.
 */

export const TOKEN_TTL_SECONDS = 30 * 60;

export interface ImportClaims {
  v: 1;
  org: string;
  user: string;
  side: Side;
  kind: ExtractedTable["kind"];
  filename: string;
  bytes: number;
  sha256: string;
  sheet?: string;
  pages?: number;
  tableHash: string;
  rowCount: number;
  iat: number;
  exp: number;
}

export class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenError";
  }
}

function key(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("BETTER_AUTH_SECRET (≥ 32 chars) is required to sign import previews");
  return Buffer.from(hkdfSync("sha256", secret, "reconcile-x", "import-preview-v1", 32));
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** Canonical hash of every part of the extraction a reviewer sees and the server will persist. */
export function tableHash(t: Pick<ExtractedTable, "headers" | "rows" | "locators" | "rowFlags" | "warnings" | "balances">): string {
  const canonical = JSON.stringify([t.headers, t.rows, t.locators, t.rowFlags, t.warnings, t.balances ?? null]);
  return createHash("sha256").update(canonical).digest("hex");
}

export function signPreview(table: ExtractedTable, ctx: { orgId: string; userId: string; side: Side }, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const claims: ImportClaims = {
    v: 1,
    org: ctx.orgId,
    user: ctx.userId,
    side: ctx.side,
    kind: table.kind,
    filename: table.filename,
    bytes: table.bytes,
    sha256: table.sha256,
    sheet: table.sheet,
    pages: table.pages,
    tableHash: tableHash(table),
    rowCount: table.rows.length,
    iat,
    exp: iat + TOKEN_TTL_SECONDS,
  };
  const body = b64(JSON.stringify(claims));
  const mac = createHmac("sha256", key()).update(body).digest();
  return `${body}.${b64(mac)}`;
}

/** Verify signature, binding and freshness; returns the claims. Throws TokenError on any mismatch. */
export function verifyPreview(
  token: string,
  table: Pick<ExtractedTable, "headers" | "rows" | "locators" | "rowFlags" | "warnings" | "balances">,
  ctx: { orgId: string; userId: string; side: Side },
  now = Date.now(),
): ImportClaims {
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined) throw new TokenError("Malformed import token");
  const expected = createHmac("sha256", key()).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new TokenError("Import preview signature is invalid");
  let claims: ImportClaims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new TokenError("Malformed import token");
  }
  if (claims.v !== 1) throw new TokenError("Unsupported import token version");
  if (claims.org !== ctx.orgId || claims.user !== ctx.userId) throw new TokenError("This import preview belongs to a different user or workspace");
  if (claims.side !== ctx.side) throw new TokenError("This import preview was created for the other side of the reconciliation");
  if (Math.floor(now / 1000) > claims.exp) throw new TokenError("The import preview has expired; upload the file again");
  if (claims.rowCount !== table.rows.length || claims.tableHash !== tableHash(table)) {
    throw new TokenError("The submitted transactions differ from the extracted preview; amounts and rows cannot be changed after extraction");
  }
  return claims;
}
