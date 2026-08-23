import crypto from 'crypto';

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
