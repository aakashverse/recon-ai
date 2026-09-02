import crypto from 'crypto';

export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Generates a deterministic SHA-256 idempotency hash for a bank transaction.
 * Key components: utrNumber + amount + txnDate/partyIdentifier
 */
export function generateIdempotencyHash(bankTxn) {
  const utr = (bankTxn.utrNumber || '').trim().toUpperCase();
  const amount = Number(bankTxn.amount).toFixed(2);
  const narration = (bankTxn.narration || '').trim().toLowerCase();
  const dateStr = bankTxn.txnDate ? new Date(bankTxn.txnDate).toISOString().slice(0, 10) : '';

  const rawPayload = `${utr}|${amount}|${dateStr}|${narration}`;
  return crypto.createHash('sha256').update(rawPayload).digest('hex');
}

/**
 * Generates a quick signature for tier 1 exact lookup
 */
export function generateExactMatchHash(invoiceNumber, amount) {
  const cleanInv = (invoiceNumber || '').trim().toUpperCase();
  const cleanAmount = Number(amount).toFixed(2);
  return crypto.createHash('sha256').update(`${cleanInv}|${cleanAmount}`).digest('hex');
}

/**
 * Cryptographically links a ReconciliationEvent into an immutable SHA-256 Hash Chain
 * Uses strictly immutable document fields so verification is 100% reproducible.
 */
export function calculateEventHash(previousHash, eventData) {
  const prev = previousHash || GENESIS_HASH;
  const chainIndex = Number(eventData.chainIndex || 0);
  const bankTxnId = eventData.bankTxnId || '';
  const invoiceNumber = eventData.invoiceNumber || 'NONE';
  const resolvedTier = eventData.resolvedTier || 'UNKNOWN';
  const bankReceived = Number(eventData.bankAmount ?? eventData.amount ?? eventData.circuitBreakerResult?.bankReceived ?? 0).toFixed(2);
  const cbDifference = Number(eventData.circuitBreakerResult?.difference || 0).toFixed(2);
  const batchId = eventData.batchId || '';

  const payload = `${prev}|${chainIndex}|${bankTxnId}|${invoiceNumber}|${resolvedTier}|${bankReceived}|${cbDifference}|${batchId}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}
