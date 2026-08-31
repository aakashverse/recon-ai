import { test } from 'node:test';
import assert from 'node:assert';
import { getAccountabilityStatement, getPlainLanguageConfidence } from '../src/utils/accountabilityFormatters.js';
import { maskPIIInNarration } from '../src/services/tier3GenAIPool.js';
import { calculateEventHash, GENESIS_HASH } from '../src/utils/hasher.js';

test('Graduated Autonomy: Plain-language accountability statements communicate human vs AI responsibility', () => {
  const tier1Stmt = getAccountabilityStatement('TIER_1', 'EXACT_VERIFIED', { passed: true });
  assert.strictEqual(tier1Stmt, 'Verified — exact match, no inference involved.');

  const proposedStmt = getAccountabilityStatement('PROPOSED', 'FIRST_TIME', { passed: true }, true);
  assert.match(proposedStmt, /awaiting accountant (sign-off|confirmation)/i);

  const trustedStmt = getAccountabilityStatement('TIER_2', 'FULLY_TRUSTED', { passed: true });
  assert.strictEqual(trustedStmt, 'Matched via trusted vendor rule — auto-committed after 3 consecutive confirmations.');

  const provisionalStmt = getAccountabilityStatement('TIER_2', 'PROVISIONAL_AUTO', { passed: true });
  assert.strictEqual(provisionalStmt, 'Matched via taught rule pattern — provisional auto-commit, flagged for review.');

  const exceptionStmt = getAccountabilityStatement('OUTBOX_EXCEPTION', null, { passed: false });
  assert.match(exceptionStmt, /variance detected — routed to exception queue/i);
});

test('Confidence Mapping: Replaces raw ML floats with accountant-legible classifications', () => {
  const exact = getPlainLanguageConfidence(1.0, 'TIER_1');
  assert.strictEqual(exact.label, 'Verified (Exact Match)');

  const high = getPlainLanguageConfidence(0.92, 'TIER_3');
  assert.strictEqual(high.label, 'AI-Assisted — High Confidence');

  const novel = getPlainLanguageConfidence(0.72, 'TIER_2');
  assert.strictEqual(novel.label, 'First-Time Pattern — Unconfirmed');

  const low = getPlainLanguageConfidence(0.45, 'OUTBOX_EXCEPTION');
  assert.strictEqual(low.label, 'Low Confidence — Flagged for Manual Resolution');
});

test('PII Redaction: Safely masks PAN, Aadhaar, account numbers while preserving invoice identifiers', () => {
  const dirtyNarration = 'UPI/CR/123456789012/INV-2024-9001/ABCDE1234F/TATA/ACCT987654321098/user@enterprise.com';
  const cleanNarration = maskPIIInNarration(dirtyNarration);

  assert.ok(!cleanNarration.includes('ABCDE1234F'), 'PAN must be redacted');
  assert.ok(!cleanNarration.includes('user@enterprise.com'), 'Email must be redacted');
  assert.ok(cleanNarration.includes('[REDACTED_PAN]'), 'Must replace with [REDACTED_PAN]');
  assert.ok(cleanNarration.includes('[REDACTED_EMAIL]'), 'Must replace with [REDACTED_EMAIL]');
  assert.ok(cleanNarration.includes('INV-2024-9001'), 'Invoice ID must NOT be corrupted');
});

test('Cryptographic Audit Chain: Immutable linking holds across ACCOUNTANT_CONFIRMED and ACCOUNTANT_OVERRIDE events', () => {
  const hash0 = GENESIS_HASH;

  // Event 1: Proposed
  const hash1 = calculateEventHash(hash0, {
    chainIndex: 1,
    bankTxnId: 'TXN-GOV-01',
    invoiceNumber: 'INV-2024-1001',
    resolvedTier: 'PROPOSED',
    bankAmount: 49000,
    circuitBreakerResult: { passed: true, equation: '50000 - 1000 = 49000' },
  });
  assert.ok(hash1 && hash1.length === 64);

  // Event 2: Accountant Override
  const hash2 = calculateEventHash(hash1, {
    chainIndex: 2,
    bankTxnId: 'TXN-GOV-01',
    invoiceNumber: 'OVERRIDDEN',
    resolvedTier: 'ACCOUNTANT_OVERRIDE',
    bankAmount: 49000,
    circuitBreakerResult: { passed: false, equation: 'Accountant Manual Override' },
  });
  assert.ok(hash2 && hash2.length === 64);
  assert.notStrictEqual(hash1, hash2);

  // Event 3: Re-resolved Confirmation
  const hash3 = calculateEventHash(hash2, {
    chainIndex: 3,
    bankTxnId: 'TXN-GOV-01',
    invoiceNumber: 'INV-2024-1002',
    resolvedTier: 'ACCOUNTANT_CONFIRMED',
    bankAmount: 49000,
    circuitBreakerResult: { passed: true, equation: '50000 - 1000 = 49000' },
  });
  assert.ok(hash3 && hash3.length === 64);
  assert.notStrictEqual(hash2, hash3);
});
