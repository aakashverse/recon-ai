# Datasets Catalog - Razorpay Recon AI

This directory houses all benchmark batches, adversarial stress tests, and external accounting datasets evaluated by the Razorpay Recon AI engine. All datasets use fictional counterparty entities with zero real PII.

## Dataset Index

### 🌟 External Benchmark Datasets
- **`kaggle-accounting-financial-management.csv`**:
  - Source: [Kaggle - Accounting Data for Financial Management](https://www.kaggle.com/datasets/ziya07/accounting-data-for-financial-management) by `ziya07`.
  - Schema (18 Columns): `Transaction ID`, `Date`, `Account Type`, `Transaction Amount`, `Cash Flow`, `Net Income`, `Revenue`, `Expenditure`, `Profit Margin`, `Debt-to-Equity Ratio`, `Operating Expenses`, `Gross Profit`, `Transaction Volume`, `Processing Time (seconds)`, `Accuracy Score`, `Missing Data Indicator`, `Normalized Transaction Amount`, `Transaction Outcome`.
- **`kaggle-reconciliation-invoices.csv` / `.json`**:
  - Mapped ERP ledger invoices with base amount, 18% GST, and statutory Indian TDS tags.
- **`kaggle-reconciliation-bank-feed.csv` / `.json`**:
  - Bank settlement feed with UTR numbers, NEFT/RTGS narrations, and statutory deductions.
- **`kaggle-reconciliation-100.json`**:
  - Unified dual-ledger benchmark suite (100 rows). Benchmarkable via `npm run benchmark:kaggle`.

### 🛡️ Production & Adversarial Batches
- **`indian-b2b-accounts-batch.csv` / `.json`** (25 rows) - Authentic Indian B2B accounting distribution across NPCI payment rails.
- **`sample-batch-50.json`** (50 rows) - Track-4 Buildathon 50+ record enterprise stress test batch.
- **`sample-chaos-20-nightmare.csv` / `.json`** (20 rows) - Adversarial chaos suite: prompt injections, OCR degradation, math mismatches.
- **`sample-chaos-20-real-world.csv` / `.json`** (20 rows) - Real-world edge cases with fuzzy vendor strings and multi-line invoices.

## Running Kaggle Benchmark
```bash
npm run benchmark:kaggle
```
