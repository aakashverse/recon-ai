# Razorpay Recon AI — AI Decision Log

> **Judging Alignment**: *AI Judgment — The right tool in the right place, and where you chose not to use one.*

This document records the explicit architectural decisions made in Razorpay Recon AI regarding where Artificial Intelligence (LLMs / Generative Models) is used, and more importantly, where deterministic algorithms and cryptographic guarantees were chosen instead.

---

## 🎯 Architecture Decision Matrix

| # | Decision Point | Considered Using AI? | Architecture Choice / Implementation | Engineering & Financial Rationale |
|---|---|---|---|---|
| **1** | **Tier 1: Exact Gross Match** | **Yes** — LLM matching bank rows to invoice lines. | **Deterministic SHA-256 Hash Matching (`<1ms`)** | Exact matches (e.g. UTR + Amount) are mathematically binary. Invoking an LLM for exact matching costs money ($0.005/call), adds 200ms+ latency, and introduces unnecessary non-determinism into foundational accounting. |
| **2** | **Tier 2: Rules, Tolerance & Split Engine** | **Yes** — LLM prompt asking if a 2% or 10% deduction is valid. | **Deterministic Arithmetic & In-Memory `RuleCache` (`<5ms`)** | Known statutory TDS deductions (Section 194C 2%, 194J 10%) and learned vendor rules are fixed equations. Executing exact decimal math via deterministic code guarantees 100% precision and zero hallucinations. |
| **3** | **Bounded Multi-Invoice Split Engine (Combined in Tier 2)** | **Yes** — LLM combinatorial reasoning to find combinations. | **Deterministic Bounded Subset-Sum Algorithm (Window Size $\le 4$)** | Subset-sum is a classic bounded computational problem. Deterministic exact combinatorial calculation prevents hallucinations and enforces mathematical conservation of money. |
| **4** | **Reconciliation Arithmetic Verification** | **Yes** — LLM verification prompt asking "does this math add up?". | **Deterministic Zero-Trust Circuit Breaker (`circuitBreaker.js`)** | **NEVER trust an LLM with arithmetic.** LLMs are probabilistic token predictors, not algebraic engines. Every single match proposal is strictly gated by `Gross - Deductions ≡ BankReceived`. |
| **5** | **Statutory Tax Rule Grounding** | **Yes** — Relying on model memory / parametric knowledge of Indian tax law. | **Retrieved Grounded Rule Table (`taxRules.js`)** | Model parameters hallucinate rates or obsolete sections. Grounding the prompt in a retrievable knowledge base ensures statutory compliance (e.g. CBDT Circular 23/2017 Base TDS) and verifiable `rule_id` output. |
| **6** | **Tier 3: Fuzzy / Messy Narration Extraction** | **Yes** — Free-text natural language output. | **Schema-Constrained GenAI Extraction (`gemini-1.5-flash` + Zod)** | Unstructured bank narrations and OCR typos (`1NV-2O24-IOO4`) are where LLMs excel. Gemini is constrained with strict JSON schemas, bounding outputs to `{ matched_invoice_id, deduction_type, deduction_amount, rule_id }`. |
| **7** | **LLM Cost & Latency Optimization** | **Yes** — Calling Gemini API on every Tier 3 transaction. | **RAG Narration Fingerprint Cache (`<2ms`, $0.00)** | B2B payment narrations repeat monthly across payroll/vendors. A Levenshtein-distance structural fingerprint cache resolves repeated patterns instantly without incurring API tokens. |
| **8** | **Factual Claim Verification** | **Yes** — Trusting GenAI candidate invoice IDs. | **Independent Ground-Truth Database Gate (`reconciliationEngine.js`)** | If an LLM hallucinates an invoice ID (`INV-9999`) with plausible numbers, the system independently verifies that the invoice ID exists and is currently in an `UNPAID` status in MongoDB before proceeding. |
| **9** | **Audit Trail & Idempotency** | **Yes** — AI generated ledger logs. | **Cryptographic SHA-256 Merkle-Style Hash Chain (`hasher.js`)** | Audit records require tamper-evident mathematical immutability for statutory compliance (Companies Act / SOX). Hash chaining guarantees cryptographically verifiable ledger history. |
| **10** | **Discrepancy Dispute Drafting** | **No** — Fixed rigid static templates. | **Live Contextual GenAI Drafting (Agentic Outbox)** | Communicating with counterparties requires context, tone, and empathy. Gemini 1.5 Flash generates tailored WhatsApp & formal Email drafts explaining specific statutory variances. |
| **11** | **Settlement Q&A Assistant** | **Yes** — RAG embedding search over conversational text. | **Function-Calling Agent with Verified Tool Handlers (`settlementAgent.js`)** | To prevent financial hallucinations in conversational queries, Gemini executes verified database tools (`getTransactionEvidence`, `getVendorRuleHistory`, `computeDelta`) before synthesizing answers. |
| **12** | **Autonomy & Ledger Posting** | **Yes** — Uniform auto-commit across all tiers. | **Graduated Autonomy State Machine (`RuleCache.js`)** | Inference-based matches (Tiers 2–3) default to `PROPOSED` review state until clean accountant confirmations earn `FULLY_TRUSTED` promotion. A single override immediately demotes trust level. |
| **13** | **PII & Data Privacy** | **Yes** — Passing raw narration text directly to API. | **Regex-Based Redaction Pre-API Pass (`tier3GenAIPool.js`)** | To prevent personal identifiers (PANs, Aadhaar, bank accounts) from leaking across the model boundary, regex sanitizers mask sensitive tokens prior to API dispatch. |

---

## 🏛️ Guiding Philosophy

> *"Use deterministic code where rules and math are fixed; use AI where data is messy, unstructured, and human; and use cryptographic gates to ensure the latter never compromises the former."*
