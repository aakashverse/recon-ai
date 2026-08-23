import { Invoice } from '../models/Invoice.js';

/**
 * Tier 1: Deterministic Exact Matcher (<2ms)
 * - Indexed lookup by UTR, direct Invoice Number token, or Exact Amount match
 * - Bypasses rule engine and GenAI pool if 100% mathematical match exists
 */
export async function matchTier1(bankTxn) {
  const startTime = performance.now();
  const rawNarration = (bankTxn.narration || '').trim();
  const bankAmount = Number(bankTxn.amount);

  // 1. Check exact invoice number pattern in narration (e.g., INV-2024-101 or INV-1001)
  const invoiceMatch = rawNarration.match(/\b(INV-\d{4,}-\d+|\bINV-\d{4,}|\b[A-Z]{2,4}-INV-\d+)\b/i);
  let candidateInvoice = null;

  if (invoiceMatch) {
    const invNumber = invoiceMatch[1].toUpperCase();
    candidateInvoice = await Invoice.findOne({
      invoiceNumber: invNumber,
      status: { $in: ['UNPAID', 'PARTIALLY_PAID'] },
    }).lean();
  }

  // 2. If found by invoice number and exact amount matches totalAmount (gross payment with 0 TDS)
  if (candidateInvoice) {
    const diff = Math.abs(candidateInvoice.totalAmount - bankAmount);
    if (diff < 0.01) {
      const durationMs = performance.now() - startTime;
      return {
        matched: true,
        tier: 'TIER_1',
        invoice: candidateInvoice,
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
        matchType: 'EXACT_INVOICE_AND_GROSS_AMOUNT',
      };
    }

    // 3. If exact amount matches expected net amount (pre-calculated standard TDS)
    const netDiff = Math.abs(candidateInvoice.expectedNetAmount - bankAmount);
    if (netDiff < 0.01) {
      const durationMs = performance.now() - startTime;
      return {
        matched: true,
        tier: 'TIER_1',
        invoice: candidateInvoice,
        confidence: 1.0,
        deductions: {
          tdsAmount: candidateInvoice.expectedTdsAmount || 0,
          tdsRate: candidateInvoice.expectedTdsRate || 0,
          tdsSection: candidateInvoice.expectedTdsSection || '194C',
          bankCharges: 0,
          discount: 0,
          totalDeductions: candidateInvoice.expectedTdsAmount || 0,
        },
        durationMs,
        matchType: 'EXACT_INVOICE_AND_NET_AMOUNT',
      };
    }
  }

  // 4. Check exact UTR match if previously mapped or referenced
  if (bankTxn.utrNumber) {
    const utrInvoice = await Invoice.findOne({
      'metadata.expectedUtr': bankTxn.utrNumber,
      status: { $in: ['UNPAID', 'PARTIALLY_PAID'] },
    }).lean();

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
    durationMs,
  };
}
