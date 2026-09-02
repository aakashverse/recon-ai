# Datasets Catalog - Razorpay Recon AI

This directory houses all synthetic B2B test fixtures, benchmark batches, and adversarial datasets evaluated by the Razorpay Recon AI engine. All datasets use fictional counterparty entities with zero real PII.

## Dataset Index

- indian-b2b-accounts-batch.csv (25 rows) - Authentic Indian B2B accounting distribution across NPCI payment rails
- indian-b2b-accounts-batch.json (25 rows) - JSON version with paired ERP invoices
- sample-batch-50.json (50 rows) - Track-4 Buildathon 50+ record synthetic enterprise batch
- sample-chaos-20-nightmare.csv / .json (20 rows) - Adversarial chaos suite: prompt injections, OCR degradation, math mismatches
- sample-chaos-20-real-world.csv / .json (20 rows) - Real-world edge cases with fuzzy vendor strings and multi-line invoices
