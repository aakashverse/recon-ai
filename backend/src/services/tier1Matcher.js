import { Invoice } from '../models/Invoice.js';

/**
 * Tier 1: Deterministic Exact Matcher (<2ms)
 * - Strictly matches 100% exact gross amount (0 deductions) or pre-mapped exact UTR
 * - If there are any deductions (TDS, fees, discounts) or variances, Tier 1 yields to Tier 2/3!
 */
export async function matchTier1(bankTxn) {
  const startTime = performance.now();
  const rawNarration = (bankTxn.narration || '').trim();
  const bankAmount = Number(bankTxn.amount);

  // 1. Check invoice number pattern in narration (e.g., INV-2024-1001, INV-1001, INV/2026/01)
  const invoiceMatch = rawNarration.match(/\b(INV[-_]?[0-9]{4}[-_]?[0-9]+|INV[-_]?[0-9]+)\b/i) || rawNarration.match(/\b(INV[/-]?[A-Z0-9]+(?:-[0-9]+)?)\b/i);
  let candidateInvoice = null;

  if (invoiceMatch) {
    const invNumber = invoiceMatch[1].toUpperCase();
    candidateInvoice = await Invoice.findOne({
      invoiceNumber: { $regex: new RegExp(`^${invNumber}$`, 'i') },
      status: { $in: ['UNPAID', 'PARTIALLY_PAID'] },
    }).lean();
  }

  // 2. Lookup by Vendor Name match in narration + Exact Gross Amount
  if (!candidateInvoice && rawNarration) {
    const allUnpaid = await Invoice.find({ status: { $in: ['UNPAID', 'PARTIALLY_PAID'] } }).lean();
    for (const inv of allUnpaid) {
      const cleanVendor = (inv.customerName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const cleanNarration = rawNarration.toLowerCase().replace(/[^a-z0-9]/g, '');
      
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

  // 5. Check exact UTR match if previously mapped or referenced
  if (bankTxn.utrNumber) {
    const utrInvoice = await Invoice.findOne({
      $or: [
        { 'metadata.expectedUtr': bankTxn.utrNumber },
        { invoiceNumber: bankTxn.utrNumber },
      ],
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
    tier: 'TIER_1',
    invoice: candidateInvoice || null,
    confidence: candidateInvoice ? 0.5 : 0.0,
    durationMs,
    reason: candidateInvoice ? 'Amount differs from gross (has deductions/variance), delegating to Tier 2/3' : 'No exact invoice match found in Tier 1',
  };
}
