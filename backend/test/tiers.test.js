import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCircuitBreaker } from '../src/services/circuitBreaker.js';
import { calculateEventHash, generateIdempotencyHash, GENESIS_HASH } from '../src/utils/hasher.js';
import { computeNarrationFingerprint, matchTier3 } from '../src/services/tier3GenAIPool.js';

test('Circuit Breaker: should pass when Gross - Deductions === BankReceived', () => {
  const invoice = { totalAmount: 100000 };
  const bankAmount = 98000;
  const deductions = { tdsAmount: 2000, bankCharges: 0, discount: 0, gstRounding: 0 };

  const result = validateCircuitBreaker(invoice, bankAmount, deductions);
  assert.equal(result.passed, true);
  assert.equal(result.difference, 0);
  assert.match(result.equation, /EXACT MATCH/);
});

test('Circuit Breaker: should fail and catch discrepancy when arithmetic does not balance', () => {
  const invoice = { totalAmount: 100000 };
  const bankAmount = 90000; // Customer shortpaid by ₹8,000 without authorization
  const deductions = { tdsAmount: 2000, bankCharges: 0, discount: 0, gstRounding: 0 };

  const result = validateCircuitBreaker(invoice, bankAmount, deductions);
  assert.equal(result.passed, false);
  assert.equal(result.difference, -8000);
  assert.match(result.equation, /DISCREPANCY/);
});

test('Circuit Breaker: should support bounded split-invoices', () => {
  const splitInvoices = [
    { invoiceNumber: 'INV-101', amount: 45000 },
    { invoiceNumber: 'INV-102', amount: 55000 },
  ];
  const bankAmount = 100000;
  const deductions = { tdsAmount: 0, bankCharges: 0, discount: 0, gstRounding: 0 };

  const result = validateCircuitBreaker(null, bankAmount, deductions, splitInvoices);
  assert.equal(result.passed, true);
  assert.equal(result.invoiceGross, 100000);
});

test('Hasher: SHA-256 idempotency hash is deterministic', () => {
  const txn1 = { utrNumber: 'AXIS123456', amount: 125000, narration: 'neft/abc/inv-101', txnDate: '2026-08-01' };
  const txn2 = { utrNumber: 'AXIS123456', amount: 125000, narration: 'neft/abc/inv-101', txnDate: '2026-08-01' };

  const hash1 = generateIdempotencyHash(txn1);
  const hash2 = generateIdempotencyHash(txn2);
  assert.equal(hash1, hash2);
  assert.equal(hash1.length, 64);
});

test('Hasher: Cryptographic Hash Chain links event hashes deterministically', () => {
  const event1 = {
    chainIndex: 1,
    bankTxnId: 'TXN-001',
    invoiceNumber: 'INV-1001',
    resolvedTier: 'TIER_1',
    circuitBreakerResult: { bankReceived: 100000, difference: 0 },
    batchId: 'BATCH-01',
  };

  const hash1 = calculateEventHash(GENESIS_HASH, event1);
  assert.equal(typeof hash1, 'string');
  assert.equal(hash1.length, 64);

  const event2 = {
    chainIndex: 2,
    bankTxnId: 'TXN-002',
    invoiceNumber: 'INV-1002',
    resolvedTier: 'TIER_2',
    circuitBreakerResult: { bankReceived: 98000, difference: 0 },
    batchId: 'BATCH-01',
  };

  const hash2 = calculateEventHash(hash1, event2);
  assert.notEqual(hash1, hash2);
  assert.equal(hash2.length, 64);

  // Recalculating with same input produces exact same hash
  const verifyHash2 = calculateEventHash(hash1, event2);
  assert.equal(hash2, verifyHash2);
});

test('RAG Fingerprinting: normalizes narrations while preserving vendor and keywords', () => {
  const narration = 'NEFT/TATA-SERVICES/INV-2024-1001/LESS-TDS-10PCT/2026-08-01';
  const fingerprint = computeNarrationFingerprint(narration);

  assert.match(fingerprint, /TATA/);
  assert.match(fingerprint, /LESS TDS 10PCT/);
  assert.doesNotMatch(fingerprint, /2026-08-01/);
  assert.doesNotMatch(fingerprint, /2024-1001/);
});

test('Tier 3 GenAI Pool: correctly extracts OCR typos and deduction tokens in mock/offline mode', async () => {
  const bankTxn = {
    bankTxnId: 'TXN-TEST-01',
    amount: 67500,
    narration: 'UPI/CR/58291039102/1NV-2O24-IOO4/ZENITH/OCR-MESSY-TYPOS-TDS-1O-PERCENT',
  };

  const context = {
    allInvoices: [
      {
        _id: 'inv-1',
        invoiceNumber: 'INV-2024-1004',
        customerName: 'Zenith Infotech Pvt Ltd',
        totalAmount: 75000,
        baseAmount: 63559.32,
        status: 'UNPAID',
      },
    ],
  };

  const result = await matchTier3(bankTxn, { mockLlm: true }, context);
  assert.equal(result.matched, true);
  assert.equal(result.tier, 'TIER_3');
  assert.equal(result.invoice.invoiceNumber, 'INV-2024-1004');
  assert.equal(result.deductions.tdsRate, 10);
  assert.equal(result.deductions.tdsAmount, 7500);
});
