import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { routes } from "@/lib/routes";
import { auth } from "./auth";
import { getDb } from "./db";

/**
 * Server-side identity and tenancy. Every data access resolves the session AND
 * re-verifies workspace membership in the database — the client-held "active
 * organization" is never trusted on its own.
 */

export type Role = "owner" | "admin" | "member";

export interface WorkspaceContext {
  userId: string;
  userName: string;
  userEmail: string;
  orgId: string;
  orgName: string;
  orgSlug: string;
  role: Role;
  /** Display string recorded on audit events and decisions. */
  actor: string;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

function membership(orgId: string, userId: string) {
  return getDb()
    .prepare(
      `SELECT m.role AS role, o.name AS orgName, o.slug AS orgSlug
       FROM member m JOIN organization o ON o.id = m.organizationId
       WHERE m.organizationId = ? AND m.userId = ?`,
    )
    .get(orgId, userId) as { role: Role; orgName: string; orgSlug: string } | undefined;
}

export function firstMembership(userId: string): string | null {
  const row = getDb().prepare(`SELECT organizationId FROM member WHERE userId = ? ORDER BY createdAt ASC LIMIT 1`).get(userId) as { organizationId: string } | undefined;
  return row?.organizationId ?? null;
}

async function resolve(): Promise<{ ctx: WorkspaceContext | null; userId: string | null }> {
  const s = await getSession();
  if (!s) return { ctx: null, userId: null };
  const orgId = s.session.activeOrganizationId;
  if (!orgId) return { ctx: null, userId: s.user.id };
  const m = membership(orgId, s.user.id);
  if (!m) return { ctx: null, userId: s.user.id };
  return {
    userId: s.user.id,
    ctx: {
      userId: s.user.id,
      userName: s.user.name,
      userEmail: s.user.email,
      orgId,
      orgName: m.orgName,
      orgSlug: m.orgSlug,
      role: m.role,
      actor: `${s.user.name} <${s.user.email}>`,
    },
  };
}

/** For API routes: throws AuthError (401 signed out, 403 no workspace access). */
export async function requireWorkspace(): Promise<WorkspaceContext> {
  const { ctx, userId } = await resolve();
  if (!userId) throw new AuthError("Sign in required", 401);
  if (!ctx) throw new AuthError("No active workspace, or you are not a member of it", 403);
  return ctx;
}

/** For pages: redirects instead of throwing. */
export async function requireWorkspacePage(): Promise<WorkspaceContext> {
  const { ctx, userId } = await resolve();
  if (!userId) redirect(routes.signIn);
  if (!ctx) redirect(routes.onboarding);
  return ctx;
}

export async function requireUserPage() {
  const s = await getSession();
  if (!s) redirect(routes.signIn);
  return s;
}
