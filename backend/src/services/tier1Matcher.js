import { Invoice } from '../models/Invoice.js';

/**
 * Tier 1: Deterministic Exact Matcher (<2ms)
 * - Strictly matches 100% exact gross amount (0 deductions) or pre-mapped exact UTR
 * - Supports in-memory context indexing for sub-millisecond execution with zero DB round-trips
 */
export async function matchTier1(bankTxn, context = {}) {
  const startTime = performance.now();
  const rawNarration = (bankTxn.narration || '').trim();
  const normalizedNarration = rawNarration.replace(/\b1NV\b/gi, 'INV').replace(/\b1NVOICE\b/gi, 'INVOICE');
  const bankAmount = Number(bankTxn.amount);

  // 1. Check invoice number pattern in narration (e.g., INV-2024-1001, INV-1001, INV/2026/01, INV-KAG-0001, INVOICE-2024-1001)
  const invoiceMatch = normalizedNarration.match(/\b((?:INV|INVOICE)[-_]?[0-9]{4}[-_]?[0-9]+|(?:INV|INVOICE)[-_]?[A-Z0-9]+[-_][0-9]+|(?:INV|INVOICE)[-_]?[0-9]+)\b/i) || normalizedNarration.match(/\b(INV\/[0-9]{4}\/[0-9]+)\b/i);
  let candidateInvoice = null;

  if (invoiceMatch) {
    const rawInvNumber = (invoiceMatch[1] || invoiceMatch[2]).toUpperCase();
    const invNumber = rawInvNumber.startsWith('INVOICE') ? rawInvNumber.replace(/^INVOICE/i, 'INV') : rawInvNumber;
    const cleanInvKey = rawInvNumber.replace(/[^A-Z0-9]/g, '');

    if (context.invoiceByNumber) {
      candidateInvoice = context.invoiceByNumber.get(invNumber) || context.invoiceByNumber.get(rawInvNumber) || context.invoiceByNumber.get(cleanInvKey) || null;
      if (candidateInvoice && candidateInvoice.status === 'PAID') candidateInvoice = null;
    } else {
      candidateInvoice = await Invoice.findOne({
        $or: [
          { invoiceNumber: { $in: [invNumber, rawInvNumber] } },
          { invoiceNumber: { $regex: new RegExp(`^${cleanInvKey}$`, 'i') } },
        ],
        status: { $in: ['UNPAID', 'PARTIALLY_PAID'] },
      }).lean();
    }
  }

  // 2. Lookup by Vendor Name match in narration + Exact Gross Amount
  if (!candidateInvoice && rawNarration) {
    const allUnpaid = context.allInvoices || (await Invoice.find({ status: { $in: ['UNPAID', 'PARTIALLY_PAID'] } }).lean());
    const cleanNarration = rawNarration.toLowerCase().replace(/[^a-z0-9]/g, '');

    for (const inv of allUnpaid) {
      if (inv.status === 'PAID') continue;
      const cleanVendor = (inv.customerName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cleanVendor && cleanVendor.length > 3 && (cleanNarration.includes(cleanVendor) || cleanVendor.includes(cleanNarration))) {
        if (Math.abs(inv.totalAmount - bankAmount) < 0.01) {
          candidateInvoice = inv;
          break;
        }
      }
    }
  }

  // 3. Exact Gross Amount Match Verification (Strictly 0 Deductions for Tier 1)
  if (candidateInvoice) {
    const diff = Math.abs(candidateInvoice.totalAmount - bankAmount);
    if (diff < 0.01) {
      const durationMs = performance.now() - startTime;
      return {
        matched: true,
        tier: 'TIER_1',
        invoice: candidateInvoice,
        confidence: 0.99,
        deductions: {
          tdsAmount: 0,
          tdsRate: 0,
          tdsSection: 'NONE',
          bankCharges: 0,
          discount: 0,
          totalDeductions: 0,
        },
        durationMs,
        matchType: 'EXACT_INVOICE_AND_GROSS_AMOUNT',
      };
    }
  }

  // 4. Check exact UTR match if previously mapped
  if (bankTxn.utrNumber) {
    let utrInvoice = null;
    if (context.allInvoices) {
      utrInvoice = context.allInvoices.find(
        (inv) => inv.status !== 'PAID' && (inv.metadata?.expectedUtr === bankTxn.utrNumber || inv.invoiceNumber === bankTxn.utrNumber)
      );
    } else {
      utrInvoice = await Invoice.findOne({
        $or: [{ 'metadata.expectedUtr': bankTxn.utrNumber }, { invoiceNumber: bankTxn.utrNumber }],
        status: { $in: ['UNPAID', 'PARTIALLY_PAID'] },
      }).lean();
    }

    if (utrInvoice && Math.abs(utrInvoice.totalAmount - bankAmount) < 0.01) {
      const durationMs = performance.now() - startTime;
      return {
        matched: true,
        tier: 'TIER_1',
        invoice: utrInvoice,
        confidence: 1.0,
        deductions: {
          tdsAmount: 0,
          tdsRate: 0,
          tdsSection: 'NONE',
          bankCharges: 0,
          discount: 0,
          totalDeductions: 0,
        },
        durationMs,
        matchType: 'EXACT_UTR_LOOKUP',
      };
    }
  }

  const durationMs = performance.now() - startTime;
  return {
    matched: false,
    tier: 'TIER_1',
    invoice: candidateInvoice || null,
    confidence: candidateInvoice ? 0.4 : 0,
    durationMs,
    reason: candidateInvoice
      ? `Gross amount mismatch: Invoice ₹${candidateInvoice.totalAmount} vs Bank ₹${bankAmount}. Passing to Tier 2.`
      : 'No exact invoice/gross match found. Passing to Tier 2.',
  };
}
