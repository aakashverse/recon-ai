import { Invoice } from '../models/Invoice.js';

/**
 * Known Statutory TDS Rates in India & their Standard Accounting Sections
 */
const KNOWN_TDS_RATES = [
  { rate: 0.1, section: '194Q', description: 'TDS on Purchase of Goods (0.1%)' },
  { rate: 1.0, section: '194C', description: 'TDS on Contractor / Individual (1.0%)' },
  { rate: 2.0, section: '194C', description: 'TDS on Contractor / Corporate (2.0%)' },
  { rate: 2.0, section: '194I', description: 'TDS on Plant & Machinery Rent (2.0%)' },
  { rate: 2.0, section: 'GST_TDS', description: 'PSU GST-TDS Section 51 (2.0% on Taxable Value)' },
  { rate: 5.0, section: '194H', description: 'TDS on Commission / Brokerage (5.0%)' },
  { rate: 10.0, section: '194J', description: 'TDS on Professional / Technical Fees (10.0%)' },
  { rate: 10.0, section: '194I', description: 'TDS on Land & Building Rent (10.0%)' },
  { rate: 20.0, section: '206AB', description: 'Special Higher Rate for Non-Filers (20.0%)' },
];

/**
 * Standard Gateway / Banking Flat Surcharge Brackets (<= ₹500)
 */
const COMMON_BANK_CHARGES = [15, 25, 50, 100, 118, 150, 177, 200, 236, 250, 295, 300, 354, 500];

/**
 * Tier 2: Deterministic Tolerance, Explainable-Delta & Bounded Split-Match Engine (<5ms)
 */
export async function matchTier2(bankTxn, context = {}) {
  const startTime = performance.now();
  const rawNarration = (bankTxn.narration || '').trim();
  const bankAmount = Number(bankTxn.amount);

  // 1. Identify potential invoice or vendor tokens from narration
  const invoiceMatch = rawNarration.match(/\b(INV[-_]?[0-9]{4}[-_]?[0-9]+|INV[-_]?[0-9]+)\b/i) || rawNarration.match(/\b(INV[/-]?[A-Z0-9]+(?:-[0-9]+)?)\b/i);
  let explicitInvoice = null;

  if (invoiceMatch) {
    const invNumber = invoiceMatch[1].toUpperCase();
    if (context.invoiceByNumber) {
      explicitInvoice = context.invoiceByNumber.get(invNumber) || null;
      if (explicitInvoice && explicitInvoice.status === 'PAID') explicitInvoice = null;
    } else {
      explicitInvoice = await Invoice.findOne({
        invoiceNumber: { $regex: new RegExp(`^${invNumber}$`, 'i') },
        status: { $in: ['UNPAID', 'PARTIALLY_PAID'] },
      }).lean();
    }
  }

  // Fetch open invoices (using in-memory cache if provided)
  const openInvoicesRaw = context.allInvoices || (await Invoice.find({ status: { $in: ['UNPAID', 'PARTIALLY_PAID'] } }).lean());
  const openInvoices = openInvoicesRaw.filter((i) => i.status !== 'PAID');

  // 2. Evaluate Explicit Invoice match first
  if (explicitInvoice) {
    const match = evaluateInvoiceDelta(explicitInvoice, bankAmount, rawNarration);
    if (match.isMatch) {
      const durationMs = performance.now() - startTime;
      return {
        matched: true,
        tier: 'TIER_2',
        invoice: explicitInvoice,
        confidence: match.confidence,
        deductions: match.deductions,
        durationMs,
        matchType: match.matchType,
      };
    }
    // If explicit single invoice did not match, check bounded split matching before giving up
    const splitCandidates = findBoundedSplitMatch(openInvoices, bankAmount, rawNarration, context);
    if (splitCandidates && splitCandidates.invoices.length >= 2) {
      const totalGross = splitCandidates.invoices.reduce((s, i) => s + i.totalAmount, 0);
      const durationMs = performance.now() - startTime;
      return {
        matched: true,
        tier: 'TIER_2',
        invoice: splitCandidates.invoices[0],
        splitInvoices: splitCandidates.invoices.map((i) => ({
          invoiceId: i._id,
          invoiceNumber: i.invoiceNumber,
          amount: i.totalAmount,
        })),
        confidence: 0.90,
        deductions: {
          tdsAmount: 0,
          tdsRate: 0,
          tdsSection: 'NONE',
          bankCharges: 0,
          discount: 0,
          gstRounding: Number((totalGross - bankAmount).toFixed(2)),
          totalDeductions: Number((totalGross - bankAmount).toFixed(2)),
        },
        durationMs,
        matchType: 'MULTI_INVOICE_SPLIT_MATCH',
      };
    }

    const durationMs = performance.now() - startTime;
    return {
      matched: false,
      tier: 'TIER_2',
      invoice: explicitInvoice,
      durationMs,
      reason: `Invoice ${explicitInvoice.invoiceNumber} variance (Gross ₹${explicitInvoice.totalAmount} vs Bank ₹${bankAmount}) does not match standard statutory tables. Passing to Tier 3.`,
    };
  }

  // 3. Bounded Split-Matching (1 Bank Deposit settling 2 open invoices)
  const splitCandidates = findBoundedSplitMatch(openInvoices, bankAmount, rawNarration, context);
  if (splitCandidates && splitCandidates.invoices.length >= 2) {
    const totalGross = splitCandidates.invoices.reduce((s, i) => s + i.totalAmount, 0);
    const durationMs = performance.now() - startTime;
    return {
      matched: true,
      tier: 'TIER_2',
      invoice: splitCandidates.invoices[0],
      splitInvoices: splitCandidates.invoices.map((i) => ({
        invoiceId: i._id,
        invoiceNumber: i.invoiceNumber,
        amount: i.totalAmount,
      })),
      confidence: 0.90,
      deductions: {
        tdsAmount: 0,
        tdsRate: 0,
        tdsSection: 'NONE',
        bankCharges: 0,
        discount: 0,
        gstRounding: Number((totalGross - bankAmount).toFixed(2)),
        totalDeductions: Number((totalGross - bankAmount).toFixed(2)),
      },
      durationMs,
      matchType: 'MULTI_INVOICE_SPLIT_MATCH',
    };
  }

  // 4. If NO explicit invoice was found, scan open invoices whose customer name matches the narration
  if (rawNarration) {
    const cleanNarration = rawNarration.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const inv of openInvoices) {
      const cleanVendor = (inv.customerName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cleanVendor && cleanVendor.length > 3 && (cleanNarration.includes(cleanVendor) || cleanVendor.includes(cleanNarration))) {
        const match = evaluateInvoiceDelta(inv, bankAmount, rawNarration);
        if (match.isMatch) {
          const durationMs = performance.now() - startTime;
          return {
            matched: true,
            tier: 'TIER_2',
            invoice: inv,
            confidence: match.confidence,
            deductions: match.deductions,
            durationMs,
            matchType: match.matchType,
          };
        }
      }
    }
  }

  const durationMs = performance.now() - startTime;
  return {
    matched: false,
    tier: 'TIER_2',
    durationMs,
    reason: 'No statutory tolerance delta or bounded split match resolved. Passing to Tier 3.',
  };
}

/**
 * Evaluates whether an invoice matches the received bank amount through explainable arithmetic deltas
 */
function evaluateInvoiceDelta(inv, bankAmount, narration = '') {
  const gross = Number(inv.totalAmount);
  const base = Number(inv.baseAmount || inv.totalAmount / 1.18);
  const variance = gross - bankAmount;

  if (variance < -1.05) {
    return { isMatch: false };
  }

  // Case A: Exact Match with +/- ₹1 GST Rounding
  if (Math.abs(variance) <= 1.05) {
    return {
      isMatch: true,
      confidence: 0.98,
      matchType: 'GST_ROUNDING_EXACT',
      deductions: {
        tdsAmount: 0,
        tdsRate: 0,
        tdsSection: 'NONE',
        bankCharges: 0,
        discount: 0,
        gstRounding: Number(variance.toFixed(2)),
        totalDeductions: Number(variance.toFixed(2)),
      },
    };
  }

  // Case B: Known Statutory TDS Rates on Gross Amount
  for (const { rate, section } of KNOWN_TDS_RATES) {
    const expectedTds = (gross * rate) / 100;
    const netExpected = gross - expectedTds;
    const diff = Math.abs(netExpected - bankAmount);

    if (diff <= 1.05) {
      return {
        isMatch: true,
        confidence: 0.95,
        matchType: `STATUTORY_TDS_GROSS_${section}`,
        deductions: {
          tdsAmount: Number(expectedTds.toFixed(2)),
          tdsRate: rate,
          tdsSection: section,
          bankCharges: 0,
          discount: 0,
          gstRounding: Number(diff.toFixed(2)),
          totalDeductions: Number(expectedTds.toFixed(2)),
        },
      };
    }
  }

  // Case C: CBDT Circular 23/2017 — TDS deducted strictly on Base Amount (excluding GST)
  for (const { rate, section } of KNOWN_TDS_RATES) {
    const expectedTdsOnBase = (base * rate) / 100;
    const netExpected = gross - expectedTdsOnBase;
    const diff = Math.abs(netExpected - bankAmount);

    if (diff <= 1.05) {
      return {
        isMatch: true,
        confidence: 0.95,
        matchType: `STATUTORY_TDS_BASE_${section}_CBDT_CIRCULAR_23`,
        deductions: {
          tdsAmount: Number(expectedTdsOnBase.toFixed(2)),
          tdsRate: rate,
          tdsSection: section,
          bankCharges: 0,
          discount: 0,
          gstRounding: Number(diff.toFixed(2)),
          totalDeductions: Number(expectedTdsOnBase.toFixed(2)),
        },
      };
    }
  }

  // Case D: Flat Gateway / Wire Processing Fee Surcharge
  for (const fee of COMMON_BANK_CHARGES) {
    const diff = Math.abs(gross - fee - bankAmount);
    if (diff <= 1.05) {
      return {
        isMatch: true,
        confidence: 0.89,
        matchType: 'PAYMENT_GATEWAY_FLAT_FEE',
        deductions: {
          tdsAmount: 0,
          tdsRate: 0,
          tdsSection: 'NONE',
          bankCharges: fee,
          discount: 0,
          gstRounding: Number(diff.toFixed(2)),
          totalDeductions: fee,
        },
      };
    }
  }

  // Case E: Statutory TDS + Gateway Fee Combo
  for (const { rate, section } of KNOWN_TDS_RATES) {
    const expectedTds = (gross * rate) / 100;
    for (const fee of [15, 25, 50, 100, 150, 200]) {
      const net = gross - expectedTds - fee;
      if (Math.abs(net - bankAmount) <= 1.05) {
        return {
          isMatch: true,
          confidence: 0.92,
          matchType: `TDS_${section}_PLUS_GATEWAY_FEE`,
          deductions: {
            tdsAmount: Number(expectedTds.toFixed(2)),
            tdsRate: rate,
            tdsSection: section,
            bankCharges: fee,
            discount: 0,
            gstRounding: 0,
            totalDeductions: Number((expectedTds + fee).toFixed(2)),
          },
        };
      }
    }
  }

  return { isMatch: false };
}

/**
 * Fast, deterministic 2-way split-match search with explicit split intent
 */
function findBoundedSplitMatch(invoices, targetAmount, narration, context = {}) {
  if (invoices.length < 2) return null;

  const upperNarration = (narration || '').toUpperCase();
  const invMatches = upperNarration.match(/\bINV[-_]?[0-9]{4}[-_]?[0-9]+\b/gi) || [];

  // If specific invoices are named in narration (e.g. INV-2024-1008 and INV-2024-1009)
  if (invMatches.length >= 2) {
    const cleanMatches = invMatches.map((m) => m.replace(/[-_]+/g, '-').toUpperCase());
    const matchedInvs = invoices.filter((i) => cleanMatches.includes(i.invoiceNumber.toUpperCase()));
    if (matchedInvs.length >= 2) {
      const sum = matchedInvs.reduce((s, i) => s + i.totalAmount, 0);
      if (Math.abs(sum - targetAmount) <= 1.05) {
        return { invoices: matchedInvs.slice(0, 2) };
      }
    }
  }

  const hasSplitIntent =
    upperNarration.includes('SPLIT') ||
    upperNarration.includes('MULTI') ||
    upperNarration.includes(' AND ') ||
    upperNarration.includes(' + ') ||
    upperNarration.includes('&') ||
    invMatches.length >= 2;

  const cleanNarration = (narration || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const sorted = [...invoices].sort((a, b) => {
    const aMatch = cleanNarration.includes((a.customerName || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
    const bMatch = cleanNarration.includes((b.customerName || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (aMatch && !bMatch) return -1;
    if (!aMatch && bMatch) return 1;
    return a.totalAmount - b.totalAmount;
  });

  const maxItems = Math.min(sorted.length, 30);

  for (let i = 0; i < maxItems; i++) {
    const a = sorted[i];
    if (a.totalAmount > targetAmount + 1) break;

    for (let j = i + 1; j < maxItems; j++) {
      const b = sorted[j];
      const sum = a.totalAmount + b.totalAmount;

      if (Math.abs(sum - targetAmount) <= 1.05) {
        const sameCustomer = a.customerName && b.customerName && a.customerName === b.customerName;
        if (hasSplitIntent || sameCustomer) {
          return { invoices: [a, b] };
        }
      }
      if (sum > targetAmount + 1) break;
    }
  }

  return null;
}
