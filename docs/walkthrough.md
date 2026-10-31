# Walkthrough — a 5-minute demo

A script for presenting Reconcile X live or in a recording. Everything shown uses synthetic data.

**Before you start:** run the app (`npm run dev -- -p 3001 -H 127.0.0.1`), create an account and a workspace, and download the three sample files from *New reconciliation → Try with synthetic files* (bank statement PDF, bank statement Excel, matching ledger CSV).

---

## 1. The problem (30 seconds) — *Home page, signed out*

> "Every company has to prove that its bank statement and its accounting ledger agree. Most of the work is easy, but the hard cases — fees taken out of a payment, one invoice paid in three parts, a card processor paying ten sales at once, something posted twice — are where people spend their time and make mistakes. And if software automates it with a black-box score, an auditor can't trust it."

Point at the four boxes in *The problem* section: **Proven · Likely · Ambiguous · Exception**.

## 2. Upload (60 seconds) — *New reconciliation*

1. Drop the **PDF bank statement** into step 1.
   > "This is a text PDF. Reconcile X rebuilds the table from the position of each word on the page. A value only goes into a column if it lines up with that column's header — if it's ambiguous, it's flagged, not guessed. Scanned PDFs are refused, because OCR can misread a 3 as an 8 in an amount."
2. Point out: *Currency USD — detected from the document*, *Columns matched automatically*, and the green **Opening + transactions = closing** check.
   > "Before anything is saved, it proves the statement adds up: opening balance plus every transaction equals the closing balance, in exact integer cents."
3. Drop the **ledger CSV** into step 2. Tick both confirmation boxes. Click **Import & reconcile**.
   > "The preview is cryptographically signed. If anyone changed a single amount between this screen and the server, the import would be rejected."

## 3. Results (90 seconds) — *the reconciliation workspace*

1. **Review queue.** Click a suggested match.
   > "Rule-verified matches are proven — same amount, same reference, and unique on both sides. Everything else is a suggestion from a logistic-regression model I trained and evaluated. This panel shows *why*: each bar is one feature's contribution to the log-odds."
2. Type a reason and **Approve**.
   > "Nothing uncertain is approved automatically, and every decision needs a reason."
3. **Exceptions** tab → open a *Missing in ledger* item (one described as *MONTHLY SERVICE FEE* shows the "Bank-originated item" explanation well).
   > "For every exception it searches all the data for evidence and ranks possible explanations. Every claim cites real transactions; if it finds nothing, it says so."
4. **Insights** tab.
   > "Two pieces of statistics. Unusual amounts use a robust z-score on each counterparty's own history — median and MAD, so the outliers can't hide themselves. And a Benford first-digit test with a real χ² p-value. Interesting: my own synthetic data fails Benford, because I made 15% of amounts round numbers. That's exactly why it's an indicator, not an accusation."

## 4. Trust (45 seconds)

- **Report** → *Position by currency* and *Ready for sign-off*.
- **Audit trail** → **Verify integrity**.
  > "Every import, decision and export is hash-chained. The database blocks edits, and if someone bypassed that, verification would show exactly where the chain broke."
- **How it works** → the yellow *Not validated on real-world bank data* banner.
  > "All my accuracy numbers come from synthetic data where I know the right answer. I say that on the page itself."

## 5. Scenario Lab (45 seconds)

Drag **Customers pay after** from 45 to 90 days.

> "Same company, customers just pay later — and the lowest cash point goes negative. The shaded band is 2,000 Monte Carlo simulations with uncertain revenue and payment timing; the probability of running out of cash comes with its own error bar, because a simulated probability is an estimate too."

## 6. Close (30 seconds)

> "What I wanted to show is not that AI can match transactions — it's how to build AI that finance people can trust: prove what you can, estimate what you can't, explain both, and let a person decide."

---

## Facts you can quote (all measured, synthetic data)

- 2,398 / 2,398 rule-verified matches correct on three held-out datasets.
- Model F1 99.75% vs 91.32% for a rules-only baseline (3,127 held-out pairs).
- 276 of 278 split payments / aggregated payouts found exactly.
- Anomaly detector: precision 90.6%, recall 99.1% on 349 injected anomalies.
- ~3,150 rows reconciled in about 0.3 seconds.
- 148 automated tests; a live security test with 69 checks covering sign-in, company isolation and import tampering.

Always add: *"measured on synthetic data I generated, not on real bank statements."*

---

## What I learned — fill this in yourself

These are prompts based on real moments in the build. Replace them with your own words; admissions readers value genuine reflection over polish.

- **Honesty about metrics.** The model scores ~99.8% F1 — and why that number says more about my synthetic data than about the real world. What would a real evaluation need?
- **Exactness.** Why floating-point numbers are dangerous for money (0.1 + 0.2 ≠ 0.3), and the decision to reject ambiguous amounts instead of rounding them.
- **A bug that taught me something.** Examples from this project: the PDF importer first flagged 42 correct rows as ambiguous because I placed column boundaries at midpoints between headers; the Import button stayed disabled because statements don't have a currency column; a chart was black because a colour constant lived in a client-only module.
- **Robust statistics.** Why median and MAD instead of mean and standard deviation when searching for outliers.
- **Building for trust.** Why only provable matches are automated, and what that costs in automation rate (51% verified automatically in the demo) versus what it gains.
- **What I would do next.** For example: evaluate on a real, labelled sample; calibrate the model per company; add role-based approval limits.
