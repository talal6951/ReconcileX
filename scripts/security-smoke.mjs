/**
 * Live security smoke test against a running Reconcile X server.
 * Verifies that unauthenticated, forged-session, workspace-less and cross-tenant
 * callers cannot reach financial data through pages or direct API requests.
 *
 * Usage: node scripts/security-smoke.mjs [baseUrl]   (default http://127.0.0.1:3001)
 * Creates throwaway test users/workspaces with synthetic data only.
 */
const BASE = process.argv[2] ?? "http://127.0.0.1:3001";
const ORIGIN = new URL(BASE).origin;
let failures = 0;
const check = (ok, label) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
};

/** Minimal cookie-jar client. */
function client() {
  const jar = new Map();
  return {
    jar,
    async req(path, { method = "GET", body, headers = {}, raw = false } = {}) {
      const h = { ...headers };
      if (jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
      if (body !== undefined) h["content-type"] = "application/json";
      if (method !== "GET") h.origin ??= ORIGIN;
      const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(";");
        const i = pair.indexOf("=");
        const k = pair.slice(0, i), v = pair.slice(i + 1);
        if (v === "" || /max-age=0/i.test(c)) jar.delete(k);
        else jar.set(k, v);
      }
      const text = await res.text();
      return { status: res.status, location: res.headers.get("location"), text, json: raw ? null : safeJson(text) };
    },
  };
}
const safeJson = (t) => {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
};

async function newUser(label, { workspace = true } = {}) {
  const c = client();
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const su = await c.req("/api/auth/sign-up/email", { method: "POST", body: { name: `Test ${label}`, email, password: "correct horse battery" } });
  if (su.status !== 200) throw new Error(`sign-up ${label} failed: ${su.status} ${su.text}`);
  let orgId = null;
  if (workspace) {
    const org = await c.req("/api/auth/organization/create", { method: "POST", body: { name: `Workspace ${label}`, slug: `ws-${label}-${Date.now()}` } });
    if (org.status !== 200) throw new Error(`org ${label} failed: ${org.status} ${org.text}`);
    orgId = org.json.id;
    const act = await c.req("/api/auth/organization/set-active", { method: "POST", body: { organizationId: orgId } });
    if (act.status !== 200) throw new Error(`set-active ${label} failed: ${act.status}`);
  }
  return { c, email, orgId };
}

const privatePages = ["/app", "/app/reconciliations", "/app/reconciliations/new", "/app/onboarding", "/app/model", "/app/audit"];
const apiProbes = (runId) => [
  ["GET", "/api/runs"],
  ["GET", "/api/audit/export"],
  ["GET", `/api/audit/export?run=${runId}`],
  ["GET", `/api/runs/${runId}/workspace`],
  ["GET", `/api/runs/${runId}/investigate?exception=E-00001`],
  ["GET", `/api/runs/${runId}/export?format=json`],
  ["GET", `/api/runs/${runId}/export?format=matches`],
  ["GET", `/api/runs/${runId}/export?format=audit`],
  ["GET", "/api/audit/verify"],
  ["GET", "/api/demo-csv?side=bank"],
  ["POST", "/api/runs/demo", { seed: 7, events: 60 }],
  ["POST", `/api/runs/${runId}/matches/M-00001`, { decision: "reject", reason: "attack" }],
  ["POST", `/api/runs/${runId}/exceptions/E-00001`, { decision: "resolve", reason: "attack" }],
  ["POST", "/api/runs", { name: "x", bank: { filename: "a", csv: "a", mapping: {} }, ledger: { filename: "b", csv: "b", mapping: {} } }],
];
/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Markers that would indicate financial data leaked into a response body.
const leaks = (text) => /amountMinor|"transactions"|bankTotalMinor|Match ID,|BTX\d{6}|"matches"\s*:/.test(text);

(async () => {
  // Victim workspace with a real (synthetic) reconciliation.
  const victim = await newUser("victim");
  const demo = await victim.c.req("/api/runs/demo", { method: "POST", body: { seed: 42, events: 300 } });
  check(demo.status === 201, `victim can create a run (got ${demo.status})`);
  const runId = demo.json?.runId;
  const own = await victim.c.req(`/api/runs/${runId}/workspace`);
  check(own.status === 200 && leaks(own.text), "victim can read own run (control)");
  const ownReport = await victim.c.req(`/app/reconciliations/${runId}/report`);
  check(ownReport.status === 200 && ownReport.text.includes(runId), "victim can open own report page (control)");
  const ownAudit = await victim.c.req(`/api/audit/export?run=${runId}`, { raw: true });
  check(ownAudit.status === 200 && ownAudit.text.includes(runId), "victim's audit export includes own run events (control)");
  for (const p of ["/app/model", "/app/audit"]) {
    const r = await victim.c.req(p);
    check(r.status === 200, `victim can open ${p} (control, ${r.status})`);
  }

  console.log("\n— Unauthenticated —");
  const anon = client();
  for (const p of [...privatePages, `/app/reconciliations/${runId}`, `/app/reconciliations/${runId}/report`]) {
    const r = await anon.req(p);
    check(r.status >= 300 && r.status < 400 && /\/sign-in/.test(r.location ?? "") && !leaks(r.text), `page ${p} redirects to sign-in (${r.status} → ${r.location})`);
  }
  for (const [m, p, b] of apiProbes(runId)) {
    const r = await anon.req(p, { method: m, body: b });
    check(r.status === 401 && !leaks(r.text), `${m} ${p} → ${r.status}`);
  }

  console.log("\n— Forged session cookie —");
  const forged = client();
  forged.jar.set("better-auth.session_token", "forged.token-value");
  for (const [m, p, b] of apiProbes(runId).slice(0, 4)) {
    const r = await forged.req(p, { method: m, body: b });
    check(r.status === 401 && !leaks(r.text), `${m} ${p} with forged cookie → ${r.status}`);
  }
  const fp = await forged.req("/app");
  check(fp.status >= 300 && fp.status < 400 && !leaks(fp.text), `page /app with forged cookie redirects (${fp.status})`);

  console.log("\n— Signed in, no workspace —");
  const lone = await newUser("lone", { workspace: false });
  for (const [m, p, b] of apiProbes(runId).slice(0, 4)) {
    const r = await lone.c.req(p, { method: m, body: b });
    check(r.status === 403 && !leaks(r.text), `${m} ${p} → ${r.status}`);
  }
  const lp = await lone.c.req("/app");
  check(lp.status >= 300 && lp.status < 400 && /onboarding/.test(lp.location ?? ""), `page /app redirects to onboarding (${lp.location})`);

  console.log("\n— Other company (cross-tenant) —");
  const attacker = await newUser("attacker");
  // Workspace-wide endpoints answer 200 for the attacker but must contain only the attacker's own data.
  const ownExport = await attacker.c.req(`/api/audit/export?run=${runId}`, { raw: true });
  const exportRows = ownExport.text.trim().split(/\r?\n/).length - 1;
  check(ownExport.status === 200 && exportRows === 0 && !ownExport.text.includes(runId), `attacker's audit export filtered to victim run is empty (${exportRows} rows)`);
  // Note: the attacker's OWN log legitimately records the filter text they typed (e.g. the victim run ID)
  // on their "audit.exported" event, so check structured columns rather than raw substrings.
  const fullExport = await attacker.c.req("/api/audit/export", { raw: true });
  const [header, ...auditRows] = parseCsv(fullExport.text);
  const col = (name) => header.indexOf(name);
  const victimRows = auditRows.filter((r) => r[col("Run")] === runId || r[col("Actor")].includes(victim.email));
  check(fullExport.status === 200 && col("Run") >= 0 && victimRows.length === 0, `attacker's full audit export contains no victim events (${auditRows.length} own rows, ${victimRows.length} victim rows)`);
  const auditPage = await attacker.c.req(`/app/audit?q=${encodeURIComponent(runId)}`);
  check(auditPage.status === 200 && !auditPage.text.includes(`>${runId}<`), "attacker's audit page search finds no victim events");
  const reportPage = await attacker.c.req(`/app/reconciliations/${runId}/report`);
  check(reportPage.status === 404 && !leaks(reportPage.text), `attacker cannot open victim's report page (${reportPage.status})`);
  for (const [m, p, b] of apiProbes(runId)) {
    if (p === "/api/runs" || p === "/api/audit/verify" || p.startsWith("/api/audit/export") || p.startsWith("/api/demo-csv") || p === "/api/runs/demo") continue;
    const r = await attacker.c.req(p, { method: m, body: b });
    check(r.status === 404 && !leaks(r.text), `${m} ${p} → ${r.status}`);
  }
  const list = await attacker.c.req("/api/runs");
  check(list.status === 200 && !list.text.includes(runId), "attacker's run list excludes victim's run");
  // Setting another company's workspace as active must fail (not a member).
  const hijack = await attacker.c.req("/api/auth/organization/set-active", { method: "POST", body: { organizationId: victim.orgId } });
  check(hijack.status !== 200, `attacker cannot activate victim's workspace (${hijack.status})`);
  const after = await attacker.c.req(`/api/runs/${runId}/workspace`);
  check(after.status === 404 || after.status === 403, `still no access after hijack attempt (${after.status})`);
  // Victim data untouched by attempted mutations.
  const victimAgain = await victim.c.req(`/api/runs/${runId}/workspace`);
  const m1 = victimAgain.json?.matches?.find((m) => m.id === "M-00001");
  check(m1 && m1.status === m1.originalStatus, "victim's match M-00001 unchanged");

  console.log("\n— Legacy run with no workspace —");
  const legacy = "RUN-20261030-8331069B";
  const lr = await victim.c.req(`/api/runs/${legacy}/workspace`);
  check(lr.status === 404 && !leaks(lr.text), `legacy run not reachable from any workspace (${lr.status})`);

  console.log("\n— Sign-out revokes access —");
  await victim.c.req("/api/auth/sign-out", { method: "POST", body: {} });
  const post = await victim.c.req(`/api/runs/${runId}/workspace`);
  check(post.status === 401, `victim after sign-out → ${post.status}`);

  console.log(`\n${failures === 0 ? "ALL SECURITY CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("SMOKE TEST ERROR:", e);
  process.exit(1);
});
