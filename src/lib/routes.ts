/** Single source of truth for in-app paths. */
export const routes = {
  home: "/",
  signIn: "/sign-in",
  signUp: "/sign-up",
  app: "/app",
  onboarding: "/app/onboarding",
  reconciliations: "/app/reconciliations",
  newReconciliation: "/app/reconciliations/new",
  reconciliation: (id: string) => `/app/reconciliations/${encodeURIComponent(id)}`,
  report: (id: string) => `/app/reconciliations/${encodeURIComponent(id)}/report`,
  model: "/app/model",
  audit: "/app/audit",
  scenarios: "/app/scenarios",
  settings: "/app/settings",
} as const;
