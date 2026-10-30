import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins/organization";
import { getDb } from "./db";

/**
 * Authentication: Better Auth with email/password and the organization plugin
 * (company workspaces, memberships, roles). Sessions live in the same local
 * SQLite database. Telemetry is explicitly disabled — no outbound calls.
 */

const isProd = process.env.NODE_ENV === "production";
if (isProd && !process.env.BETTER_AUTH_SECRET) {
  throw new Error("BETTER_AUTH_SECRET must be set in production");
}

/** Production trusts only BETTER_AUTH_URL; development also accepts the other loopback spelling. */
function trustedOrigins(): string[] {
  const base = process.env.BETTER_AUTH_URL;
  if (!base) return [];
  if (isProd) return [base];
  const u = new URL(base);
  const alt = u.hostname === "127.0.0.1" ? "localhost" : u.hostname === "localhost" ? "127.0.0.1" : null;
  return alt ? [base, `${u.protocol}//${alt}${u.port ? `:${u.port}` : ""}`] : [base];
}

export const auth = betterAuth({
  appName: "Reconcile X",
  database: getDb(),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins: trustedOrigins(),
  telemetry: { enabled: false },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    autoSignIn: true,
    // No email provider is configured in this MVP; addresses are not verified.
    requireEmailVerification: false,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 60, max: 5 },
    },
  },
  advanced: {
    useSecureCookies: isProd,
    defaultCookieAttributes: { sameSite: "lax", httpOnly: true },
  },
  plugins: [
    organization({
      allowUserToCreateOrganization: true,
      organizationLimit: 5,
      creatorRole: "owner",
      membershipLimit: 50,
    }),
    // Must be last: lets server actions set cookies.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
