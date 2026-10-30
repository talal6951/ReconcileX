# Methodology

This document explains the mathematics behind Reconcile X, what each method assumes, how it was evaluated, and where it can fail. Every number quoted here is reproducible with the commands at the end.

**Guiding rule:** a claim is labelled by how it was produced. *Verified* means proven by an exact rule. *Probability* is used only for the logistic-regression output, whose calibration was measured. *Score* or *indicator* is used for everything heuristic.

---

## 1. Exact money

Amounts are stored as integers in the currency's minor unit (cents, fils, yen) using JavaScript `bigint`, with ISO 4217 exponents (e.g. JPY 0, USD 2, KWD 3). A strict parser converts text to minor units and **rejects** anything ambiguous — extra decimal places (`10.005 USD`), malformed thousands separators, both a debit and a credit on one row — rather than rounding. Sums, differences, balance checks and split searches are all exact integer arithmetic.

Excel stores numbers as IEEE-754 doubles. They are converted with the shortest round-trip decimal representation; a stored value like `0.30000000000000004` stays visible and is rejected by the strict parser instead of being silently rounded to 0.30.

## 2. Deterministic matching

A bank row *b* and ledger row *l* are **verified** if either:

- **Rule A**: same transaction ID (≥ 3 characters), same currency, same amount, |date difference| ≤ 5 days, and that ID occurs exactly once on each side; or
- **Rule B**: same currency, same amount, |date difference| ≤ 5 days, and a shared reference — identical normalised reference (≥ 4 characters), or one record's invoice number appearing inside the other's narrative.

**Uniqueness check:** for Rule B, build the bipartite graph of all (b, l) pairs satisfying it. A pair is verified only if both *b* and *l* have degree 1. Two identical ledger entries that both satisfy the rule with one bank line are therefore *not* verified — they go to review.

## 3. Candidate scoring with logistic regression

### Candidates
Remaining rows are paired if they share currency and sign, fall within the date window, and either differ in amount by ≤ 5% or share a reference/identifier. For each pair, 13 features *x* are computed: exact-amount indicator, relative amount difference (%, capped at 100), date gap / window, Jaro–Winkler similarity of references, identical-reference indicator, identifier cross-hit, Jaccard overlap of description words, Jaro–Winkler similarity of counterparties, identical-ID indicator, log(1 + competing candidates) for the bank and ledger row, closest-amount indicator, and a fee pattern (bank slightly lower, ≤ 3%).

**Missing data is not evidence.** If a field is empty on either side, its similarity is marked missing and mean-imputed (standardised value 0, so it contributes nothing), instead of being treated as "dissimilar".

### Model
Standardise each feature, *z_j = (x_j − μ_j) / σ_j*, then

> P(match | x) = σ(β₀ + Σ_j β_j z_j),  σ(t) = 1 / (1 + e^(−t))

fitted by minimising the L2-regularised log loss

> L(β) = −(1/n) Σ_i [ y_i log p_i + (1 − y_i) log(1 − p_i) ] + (λ/2) ‖β‖²,  λ = 10⁻³

with full-batch gradient descent (1,500 epochs, learning rate 0.3, zero initialisation — fully deterministic).

### Why logistic regression
It is the simplest model whose output is a probability and whose prediction **decomposes exactly** into per-feature contributions β_j·z_j on the log-odds scale. Every suggestion in the app shows those contributions, so a reviewer can see *why* — e.g. "description overlap +2.2, amount difference −3.5". A tree ensemble might score higher but could not be explained this simply.

### Assignment and ambiguity
Pairs with P ≥ 0.5 are assigned greedily in descending probability (each row used once). A match is flagged **ambiguous** if a competing candidate for the same bank or ledger row has probability within 0.15 and its other row is not already held by a strictly stronger pair. All model matches require human approval.

### Training data
Training uses only the pairs that remain *after* the deterministic rules and linked-split pass — the model's real operating distribution. Labels come from the synthetic generator's ground truth (a pair is positive if it is a true 1:1 link; indistinguishable duplicates are treated as equivalent).

## 4. Splits and aggregated settlements

For an unmatched transaction with amount T, search subsets of up to 4 unmatched counterpart rows (same currency and sign, within the window, at most 20 candidates, ranked by evidence) whose amounts sum **exactly** to T. Depth-first search with pruning (amounts are positive, so a partial sum > T is abandoned). Splits where every part carries the target's reference are proposed *before* the model runs; unlinked exact sums (e.g. card-processor payouts) are proposed afterwards with low confidence. The score shown for splits is an evidence heuristic and is labelled as such — it is not a probability.

## 5. Evidence-based investigation

For every exception the investigator searches the whole dataset (not only unmatched rows) for: same amount and currency within and outside the date window, same reference at a different amount or currency, duplicate groups, and statement-period edges. Each hypothesis must cite evidence items, each evidence item must cite real transaction IDs (the code throws otherwise), and support levels (strong / moderate / weak) are rule-based. When nothing is found, it says so.

## 6. Anomaly detection

### Unusual amounts — robust z-score
Within each group (same side, currency, direction and counterparty, ≥ 8 transactions), let *x = ln|amount|*. Then

> z = 0.6745 · (x − median(x)) / MAD,  MAD = median(|x − median(x)|)

(Iglewicz & Hoaglin, 1993). The constant 0.6745 makes MAD comparable to a standard deviation under normality. **Why median/MAD:** the mean and standard deviation are pulled towards the very outliers being searched for; the median and MAD have a 50% breakdown point. **Why logs:** spending varies multiplicatively ("3× usual"), and logs make the distribution closer to symmetric. If MAD = 0 the mean absolute deviation is used (z = (x − median)/(1.253314 · MeanAD)); if that is also 0 the group is constant and nothing is flagged. |z| > 3.5 is flagged.

**Evaluation.** A synthetic benchmark (10 seeds × 40 counterparties × 30 transactions = 12,000) draws each counterparty's amounts from a log-normal distribution (σ = 0.25) and replaces ~3% with amounts 4–15× higher or lower (349 injected anomalies, positions known):

| Threshold | Precision | Recall | F1 |
|---|---|---|---|
| 2.5 | 58.8% | 100% | 74.0% |
| 3.0 | 77.4% | 100% | 87.3% |
| **3.5** | **90.6%** | **99.1%** | **94.7%** |
| 4.0 | 96.1% | 98.6% | 97.3% |
| 5.0 | 99.4% | 95.1% | 97.2% |

On this benchmark 4.0 has the best F1. I kept the published 3.5: tuning a threshold to a benchmark I generated myself would be overfitting to my own assumptions.

### First-digit test — Benford's law
For naturally occurring amounts spanning several orders of magnitude, the leading digit *d* often follows P(d) = log₁₀(1 + 1/d). With observed counts O_d and expected E_d = n·P(d):

> χ² = Σ_{d=1..9} (O_d − E_d)² / E_d,  8 degrees of freedom

The p-value is the upper tail of the χ² distribution, computed exactly as the regularised upper incomplete gamma function Q(4, χ²/2) (series / continued-fraction evaluation, verified against table values: χ²₈ = 15.507 → p = 0.05). At least 100 amounts are required. The result is a **dataset-level indicator only**: the synthetic demo data deviates (p ≈ 0.006) because ~15% of its amounts are deliberately round — exactly the kind of legitimate reason a real dataset might deviate too.

## 7. Scenario Lab

### Deterministic projection (month t = 1..H)
> revenue_t = R(1 + g)^(t−1), expenses_t = E(1 + h)^(t−1)

Revenue invoiced in month t with payment delay D days is collected in month t + ⌊D/30⌋ (fraction 1 − f) and t + ⌊D/30⌋ + 1 (fraction f), where f = (D mod 30)/30. Cash: C_t = C_{t−1} + collections_t − expenses_t. The model conserves money (collected + outstanding = invoiced, tested), and longer delays can never raise the lowest cash point (tested).

### Monte Carlo
Each of N = 2,000 runs (fixed seed, reproducible) multiplies each month's revenue by exp(σZ − σ²/2) — a log-normal factor with mean 1, so uncertainty doesn't bias the expected revenue — and draws each month's delay from Normal(D, σ_D) truncated to [0, 365]. Reported: the 10th, 50th and 90th percentile of cash per month, and

> p̂ = (runs with cash < 0 in any month) / N,  SE = √(p̂(1 − p̂)/N)

shown with a 95% interval (±1.96·SE). With zero uncertainty the simulation collapses exactly onto the deterministic path (tested).

The Scenario Lab is illustrative: it uses floating-point whole currency units, and its assumptions (fixed expenses timing, independent monthly shocks) are deliberately simple.

## 8. Evaluation design

The synthetic generator (`src/engine/synthetic.ts`) produces paired bank/ledger data with ground truth across 15 scenarios: exact references, references embedded in narratives, no reference, typos, fees deducted, rounding differences, late settlements, split payments, aggregated payouts, missing items on either side, duplicates on either side, currency mismatches, and indistinguishable "twin" payments. The model is trained on seeds 1–8 and evaluated on seeds 101–103. A rules-only baseline (0.6 × exact amount + 0.4 × date proximity) is evaluated on the same pairs.

Metrics: ROC-AUC (rank-sum with tie handling), average precision, precision/recall/F1 at 0.5, log loss and a 10-bin calibration table. Undefined metrics (e.g. recall with no positives) are reported as *n/a*, never as 100% (tested).

| | Model | Baseline |
|---|---|---|
| ROC-AUC | 99.99% | 96.42% |
| Average precision | 99.99% | 97.59% |
| Precision @ 0.5 | 99.73% | 96.54% |
| Recall @ 0.5 | 99.78% | 86.64% |
| F1 | 99.75% | 91.32% |

End to end on the three held-out datasets: 2,398 / 2,398 rule-verified matches correct; 1,440 / 1,440 model suggestions correct; 276 of 278 splits/aggregates found exactly; 99.3–99.6% of true one-to-one links found.

### Why these scores are high — and what they don't show
The generator and the features were designed by the same person, from the same understanding of how reconciliation fails. The model is therefore learning a pattern I specified. The results demonstrate that the pipeline is correct and the model learns what it should; they do **not** estimate accuracy on real bank data, where formats, narratives and error types differ. A real deployment would need a labelled sample of real reconciliations, and would monitor reviewers' approval rate of model suggestions (the "How it works" page already reports this per workspace, labelled as reviewer agreement rather than validation).

## 9. Reproducing every number

```bash
npm run train          # retrains the model; writes src/engine/model/weights.json + evaluation.json
npm run eval:anomaly   # writes src/engine/model/anomaly-evaluation.json
npm test               # 147 tests, including exact-value checks of the statistics
```

## References
- Iglewicz, B. & Hoaglin, D. (1993). *How to Detect and Handle Outliers*. ASQC Quality Press.
- Nigrini, M. (2012). *Benford's Law: Applications for Forensic Accounting, Auditing, and Fraud Detection*. Wiley.
- Winkler, W. (1990). String comparator metrics and enhanced decision rules in the Fellegi–Sunter model of record linkage.
- Press, W. et al. *Numerical Recipes* — incomplete gamma function evaluation.
