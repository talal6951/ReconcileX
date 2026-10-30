# Reconcile X

**AI-assisted financial reconciliation that proves what it can, estimates what it can't, and explains both.**

Reconcile X matches a bank statement against a company's ledger, finds what doesn't match, investigates why, and lets a person approve the results — with every decision recorded in a tamper-evident audit trail. It also includes statistical anomaly detection and a small cash-flow Scenario Lab.

> Independent project by **Talal Mohamed Talal Sarhan**. All data in the demo is **synthetic** — no real bank accounts, customers or statements are used.

---

## The problem

Every business that has a bank account has to reconcile it: confirm that each line on the bank statement corresponds to an entry in the accounting ledger, and explain every line that doesn't. Finance teams still do much of this by hand in spreadsheets. It is slow, and the hard cases — bank fees deducted from a payment, one invoice paid in three instalments, a card processor paying out several sales in one deposit, an entry posted twice — are exactly where errors happen.

Automating it raises a second problem: **trust**. A tool that silently "auto-matches" with a confidence score nobody can explain is not acceptable to an accountant or an auditor.

## The approach

Reconcile X separates three kinds of claim:

| | What it means | How it is produced | Needs a person? |
|---|---|---|---|
| **Verified** | Provably the same transaction | Deterministic rules + a uniqueness check on both sides | No |
| **Suggested** | Probably the same transaction | A trained, evaluated logistic-regression model, with a per-feature explanation | **Yes** |
| **Exception** | Something is missing, duplicated or different | Rules + an evidence-based investigator that cites the records it used | **Yes** |

Nothing uncertain is ever approved automatically. Reconcile X never moves money or edits bank or ledger records.

## What you can do with it

1. **Upload** a bank statement and a ledger export — CSV, Excel (.xlsx) or a text-based PDF.
2. **Review** the extracted transactions: columns and currency are detected automatically, every row is validated, the statement's opening + transactions = closing balance is checked, and you confirm before anything is saved.
3. **Results**: approve or reject suggested matches (with a reason), investigate exceptions, see statistical insights, export a report.

Plus: a **Scenario Lab** for "what if customers pay 30 days later?", a **How it works** page with the model's real weights and evaluation, and an **Audit trail** you can search and verify.

---

## Technical overview

### Matching engine (`src/engine`)
- **Money is exact.** All amounts are integer minor units (`bigint`); a strict parser rejects anything ambiguous (e.g. `10.005 USD`) instead of rounding. Floating point is used only for statistics and the illustrative Scenario Lab, never for matching.
- **Deterministic rules** (`matcher.ts`): identical transaction ID, or identical amount + currency + shared reference/invoice number within a date window — *verified only if the pairing is unique on both sides*.
- **Candidate generation** (`features.ts`): blocking by currency, sign, date window and amount tolerance, plus an index of invoice numbers embedded in bank narratives.
- **Machine learning** (`model.ts`): L2-regularised logistic regression trained by full-batch gradient descent on 13 features (amount equality and relative difference, date gap, Jaro–Winkler reference similarity, identifier cross-hits, description overlap, counterparty similarity, candidate competition, fee pattern…). Missing inputs are mean-imputed so "no data" is never read as "mismatch". Every suggestion shows each feature's contribution to the log-odds.
- **Ambiguity handling**: if a competing candidate scores within 15 points, the match is flagged for review with the alternatives listed.
- **Splits and aggregated payouts** (`splits.ts`): bounded subset-sum search finds groups of transactions whose amounts sum *exactly* (in integer cents) to a counterpart.
- **Investigator** (`investigate.ts`): for every exception, searches the full dataset for evidence (same amount outside the window, same reference at a different amount, other currencies, duplicates, statement-period edges) and ranks hypotheses by support. It must cite real transactions — it throws if it doesn't.

### Statistics (`src/engine/anomaly.ts`, `src/engine/scenario.ts`)
- **Unusual amounts**: robust modified z-score (Iglewicz & Hoaglin) on log amounts within each counterparty's own history, using the median and median absolute deviation.
- **Benford first-digit test**: Pearson χ² goodness of fit with an exact p-value from the regularised incomplete gamma function.
- **Scenario Lab**: deterministic cash projection plus a seeded Monte Carlo simulation reporting P10/P50/P90 bands and the probability of a cash shortfall with its standard error.

### Statement import (`src/server/imports`)
- File type determined from the **bytes**, not the extension. `.xlsx` is checked for zip bombs and macros before parsing; legacy `.xls`, scanned/encrypted PDFs and unrecognised layouts are rejected with a plain explanation.
- **PDF tables** are reconstructed from text positions (Mozilla pdf.js): a value is assigned to a column only if it overlaps *and* aligns with that column's header; anything ambiguous is flagged, never guessed. No OCR — misread digits in amounts can't be ruled out.
- **Signed previews**: the server returns the extracted rows with an HMAC signature bound to the workspace, user, file hash and the exact rows. Saving requires explicit confirmation, and any change to an amount after extraction is rejected.

### Platform (`src/app`, `src/server`)
- **Next.js 15 (App Router) + TypeScript (strict) + Tailwind CSS 4**, SQLite via `better-sqlite3`.
- **Authentication & company workspaces**: Better Auth (email/password, organization plugin). Every page and API route verifies the session *and* re-checks workspace membership in the database; every query is scoped to the workspace.
- **Audit trail**: append-only (database triggers block edits and deletes) and SHA-256 hash-chained per workspace, so tampering is detectable.
- **Exports**: CSV/JSON with spreadsheet formula-injection protection.

---

## Results (measured, synthetic data)

All figures come from committed evaluation artifacts (`src/engine/model/evaluation.json`, `anomaly-evaluation.json`) produced by `npm run train` and `npm run eval:anomaly`. They are measured on **synthetic data with known ground truth** and are **not** evidence of accuracy on real bank statements (see *Limitations*).

**Matching** — 3 held-out datasets, ~3,150 rows each:

| | Result |
|---|---|
| Rule-verified matches that were correct | **2,398 / 2,398** |
| Model on held-out candidate pairs (3,127 pairs) | ROC-AUC 99.99% · precision 99.73% · recall 99.78% · F1 99.75% |
| Rules-only baseline on the same pairs | ROC-AUC 96.42% · precision 96.54% · recall 86.64% · F1 91.32% |
| ML suggestions that were correct | 1,440 / 1,440 |
| Split / aggregate groups found exactly | 276 of 278 |
| Time to reconcile ~3,150 rows | ≈ 0.3 s on a laptop |

**Anomaly detection** — 12,000 synthetic transactions with 349 injected anomalies (10 seeds), default threshold |z| > 3.5: precision **90.6%**, recall **99.1%**, F1 **94.7%**.

## Limitations — read before trusting any number above

- **Synthetic evaluation only.** I wrote the data generator, so the patterns the model learns (fees, typos, delays, splits) are patterns I put there. The high scores show the system behaves as designed on a well-specified problem; real statements contain patterns the generator doesn't. That is why only rule-verified matches are confirmed automatically.
- **Linear model.** Logistic regression can't express every interaction (e.g. "same invoice number but only 40% of the amount" — handled instead by a structural rule for reference-linked splits).
- **Benford's law** doesn't apply to every dataset — the synthetic demo data itself *deviates* (p ≈ 0.006) because about 15% of its amounts are deliberately round numbers.
- **Anomaly benchmark** matches the detector's assumptions (stable spending per counterparty). On my own benchmark a threshold of 4.0 scores a higher F1 than 3.5; I kept the published 3.5 rather than tuning to data I generated.
- **PDF import** supports text-based statements with a clear header row; other layouts are rejected. No email delivery yet (password reset, invitations), no role-based approval limits, single-node SQLite.

## Running it locally

Developed and tested with Node.js 24 on macOS.

```bash
npm install
cp .env.example .env.local        # then set BETTER_AUTH_SECRET (see the file for a generator command)
npm run db:migrate                # creates the local SQLite database in ./data
npm run dev -- -p 3001 -H 127.0.0.1   # http://127.0.0.1:3001 (matches BETTER_AUTH_URL in .env.example)
```

Sign up, create a workspace and choose **Explore with demo data**, or download the synthetic sample statement (PDF/Excel) and ledger (CSV) from *New reconciliation* and upload them.

### Tests and evaluation

```bash
npm test                 # 147 unit + integration tests
npm run typecheck && npm run lint
npm run train            # retrain the model and regenerate evaluation.json
npm run eval:anomaly     # re-measure the anomaly detector
npm run test:security -- http://127.0.0.1:3002   # live auth/isolation checks — run ONLY against a test server with its own database
```

## Repository map

```
src/engine/        matching, ML model, anomaly statistics, scenario model, synthetic data, evaluation (pure TypeScript)
src/server/        database, auth, workspace-scoped repository, audit chain, statement import, reports
src/app/           pages (marketing site, auth, workspace) and API routes
tests/             Vitest suites
scripts/           training, evaluation, migrations, verified backups, security smoke test
docs/              methodology and demo walkthrough
```

See **[docs/methodology.md](docs/methodology.md)** for the mathematics and **[docs/walkthrough.md](docs/walkthrough.md)** for a 5-minute demo script.
