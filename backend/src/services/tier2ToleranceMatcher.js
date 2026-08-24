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
 * Evaluates:
 * 1. Explainable Arithmetic Deltas: Standard Statutory TDS, Flat Bank/PG Fees, GST Rounding (+-₹1)
 * 2. Bounded Split-Match: 1 Bank Deposit settling 2 to 4 open invoices for a vendor
 */
export async function matchTier2(bankTxn) {
  const startTime = performance.now();
  const rawNarration = (bankTxn.narration || '').trim();
  const bankAmount = Number(bankTxn.amount);

  // 1. Identify potential invoice or vendor tokens from narration
  const invoiceMatch = rawNarration.match(/\b(INV[/-]?[A-Z0-9-]+|[A-Z0-9]+-INV[/-]?[A-Z0-9-]+)\b/i);
  let explicitInvoice = null;

  if (invoiceMatch) {
    const invNumber = invoiceMatch[1].toUpperCase();
    explicitInvoice = await Invoice.findOne({
      invoiceNumber: { $regex: new RegExp(`^${invNumber}$`, 'i') },
      status: { $in: ['UNPAID', 'PARTIALLY_PAID'] },
    }).lean();
  }

  // Fetch all open unpaid invoices to evaluate candidate deltas & split matches
  const openInvoices = await Invoice.find({
    status: { $in: ['UNPAID', 'PARTIALLY_PAID'] },
  }).lean();

  if (!openInvoices.length) {
    return {
      matched: false,
      tier: 'TIER_2',
      durationMs: performance.now() - startTime,
      reason: 'No open unpaid invoices available in ledger',
    };
  }

  // -------------------------------------------------------------------------
  // Part A: Explainable Delta Engine (Single Invoice with Statutory Deductions)
  // -------------------------------------------------------------------------
  const candidateList = explicitInvoice
    ? [explicitInvoice, ...openInvoices.filter((i) => String(i._id) !== String(explicitInvoice._id))]
    : openInvoices;

  for (const inv of candidateList) {
    const gross = Number(inv.totalAmount);
    const base = Number(inv.baseAmount || (gross / 1.18).toFixed(2));
    const delta = Number((gross - bankAmount).toFixed(2));

    // If delta is negative, bank amount is larger than invoice gross (unless handling fee refund)
    if (delta <= 0) continue;

    // Check 1: Pure GST / Cash Rounding Tolerance (<= ₹1.00)
    if (Math.abs(delta) <= 1.05) {
      const durationMs = performance.now() - startTime;
      return {
        matched: true,
        tier: 'TIER_2',
        invoice: inv,
        confidence: 0.99,
        deductions: {
          tdsAmount: 0,
          tdsRate: 0,
          tdsSection: 'NONE',
          bankCharges: 0,
          discount: 0,
          gstRounding: delta,
          totalDeductions: delta,
        },
        durationMs,
        matchType: 'EXPLAINABLE_DELTA_GST_ROUNDING',
        explanation: `Arithmetic delta of ₹${delta} matches standard GST/cash fractional rounding (<= ₹1).`,
      };
    }

    // Check 2: Standard Statutory TDS Rates (evaluated on Gross and on Taxable Base)
    for (const tds of KNOWN_TDS_RATES) {
      const tdsOnGross = Number(((gross * tds.rate) / 100).toFixed(2));
      const tdsOnBase = Number(((base * tds.rate) / 100).toFixed(2));

      // 2a. Exact match on Gross TDS
      if (Math.abs(delta - tdsOnGross) <= 0.50) {
        const durationMs = performance.now() - startTime;
        return {
          matched: true,
          tier: 'TIER_2',
          invoice: inv,
          confidence: 0.98,
          deductions: {
            tdsAmount: tdsOnGross,
            tdsRate: tds.rate,
            tdsSection: tds.section,
            bankCharges: 0,
            discount: 0,
            gstRounding: Number((delta - tdsOnGross).toFixed(2)),
            totalDeductions: delta,
          },
          durationMs,
          matchType: `EXPLAINABLE_DELTA_TDS_${tds.section}_GROSS`,
          explanation: `Arithmetic delta of ₹${delta} matches Section ${tds.section} TDS (${tds.rate}% on Gross ₹${gross}).`,
        };
      }

      // 2b. Exact match on Taxable Base TDS (CBDT Circular 23/2017)
      if (Math.abs(delta - tdsOnBase) <= 0.50) {
        const durationMs = performance.now() - startTime;
        return {
          matched: true,
          tier: 'TIER_2',
          invoice: inv,
          confidence: 0.98,
          deductions: {
            tdsAmount: tdsOnBase,
            tdsRate: tds.rate,
            tdsSection: tds.section,
            bankCharges: 0,
            discount: 0,
            gstRounding: Number((delta - tdsOnBase).toFixed(2)),
            totalDeductions: delta,
          },
          durationMs,
          matchType: `EXPLAINABLE_DELTA_TDS_${tds.section}_BASE`,
          explanation: `Arithmetic delta of ₹${delta} matches Section ${tds.section} TDS (${tds.rate}% on Taxable Base ₹${base}, CBDT Circ 23/2017).`,
        };
      }

      // 2c. Combined: TDS + Flat Bank/PG Charge (<= ₹500)
      for (const fee of COMMON_BANK_CHARGES) {
        const totalExpectedDeductionGross = tdsOnGross + fee;
        if (Math.abs(delta - totalExpectedDeductionGross) <= 0.50) {
          const durationMs = performance.now() - startTime;
          return {
            matched: true,
            tier: 'TIER_2',
            invoice: inv,
            confidence: 0.97,
            deductions: {
              tdsAmount: tdsOnGross,
              tdsRate: tds.rate,
              tdsSection: tds.section,
              bankCharges: fee,
              discount: 0,
              gstRounding: Number((delta - totalExpectedDeductionGross).toFixed(2)),
              totalDeductions: delta,
            },
            durationMs,
            matchType: `EXPLAINABLE_DELTA_TDS_PLUS_PG_FEE`,
            explanation: `Arithmetic delta matches Section ${tds.section} TDS (${tds.rate}%) + Flat PG Surcharge (₹${fee}).`,
          };
        }
      }
    }

    // Check 3: Pure Flat Bank / PG Charge (<= ₹500) without TDS
    if (delta <= 500 && (COMMON_BANK_CHARGES.includes(Math.round(delta)) || delta <= 100)) {
      const durationMs = performance.now() - startTime;
      return {
        matched: true,
        tier: 'TIER_2',
        invoice: inv,
        confidence: 0.96,
        deductions: {
          tdsAmount: 0,
          tdsRate: 0,
          tdsSection: 'NONE',
          bankCharges: delta,
          discount: 0,
          gstRounding: 0,
          totalDeductions: delta,
        },
        durationMs,
        matchType: 'EXPLAINABLE_DELTA_FLAT_BANK_CHARGE',
        explanation: `Arithmetic delta of ₹${delta} matches standard flat banking/PG processing fee (<= ₹500).`,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Part B: Bounded Split-Match Engine (1 Bank Credit -> 2 to 4 Invoices)
  // -------------------------------------------------------------------------
  // Group open invoices by vendor if vendor token is present, else evaluate all candidates
  const splitCandidates = findBoundedSplitMatch(openInvoices, bankAmount, rawNarration);

  if (splitCandidates && splitCandidates.invoices.length >= 2) {
    const primaryInvoice = splitCandidates.invoices[0];
    const totalSplitGross = splitCandidates.invoices.reduce((sum, i) => sum + Number(i.totalAmount), 0);
    const durationMs = performance.now() - startTime;

    return {
      matched: true,
      tier: 'TIER_2',
      invoice: primaryInvoice,
      splitInvoices: splitCandidates.invoices.map((i) => ({
        invoiceId: i._id,
        invoiceNumber: i.invoiceNumber,
        amount: Number(i.totalAmount),
      })),
      confidence: 0.98,
      deductions: {
        tdsAmount: 0,
        tdsRate: 0,
        tdsSection: 'NONE',
        bankCharges: 0,
        discount: 0,
        gstRounding: Number((totalSplitGross - bankAmount).toFixed(2)),
        totalDeductions: Number((totalSplitGross - bankAmount).toFixed(2)),
      },
      durationMs,
      matchType: `BOUNDED_SPLIT_MATCH_${splitCandidates.invoices.length}_INVOICES`,
      explanation: `Single bank credit of ₹${bankAmount} matches sum of ${splitCandidates.invoices.length} open invoices (${splitCandidates.invoices.map((i) => i.invoiceNumber).join(' + ')} = ₹${totalSplitGross}).`,
    };
  }

  const durationMs = performance.now() - startTime;
  return {
    matched: false,
    tier: 'TIER_2',
    durationMs,
    reason: 'Delta does not match known statutory TDS rates, bank charge brackets, or bounded split combinations',
  };
}

/**
 * Early-pruned combination search for 2 to 4 invoice split matches
 */
function findBoundedSplitMatch(invoices, targetAmount, narration) {
  if (invoices.length < 2) return null;

  // Filter or prioritize invoices matching vendor keywords in narration
  const cleanNarration = (narration || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const sorted = [...invoices].sort((a, b) => {
    const aMatch = cleanNarration.includes((a.customerName || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
    const bMatch = cleanNarration.includes((b.customerName || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (aMatch && !bMatch) return -1;
    if (!aMatch && bMatch) return 1;
    return a.totalAmount - b.totalAmount;
  });

  const maxItems = Math.min(sorted.length, 25); // Bound search space for guaranteed <5ms latency

  // 1. Check 2-Way Combinations
  for (let i = 0; i < maxItems; i++) {
    const a = sorted[i];
    if (a.totalAmount > targetAmount + 1) break;

    for (let j = i + 1; j < maxItems; j++) {
      const b = sorted[j];
      const sum = a.totalAmount + b.totalAmount;

      if (Math.abs(sum - targetAmount) <= 1.05) {
        return { invoices: [a, b] };
      }
      if (sum > targetAmount + 1) break;
    }
  }

  // 2. Check 3-Way Combinations
  for (let i = 0; i < maxItems; i++) {
    const a = sorted[i];
    if (a.totalAmount > targetAmount + 1) break;

    for (let j = i + 1; j < maxItems; j++) {
      const b = sorted[j];
      if (a.totalAmount + b.totalAmount > targetAmount + 1) break;

      for (let k = j + 1; k < maxItems; k++) {
        const c = sorted[k];
        const sum = a.totalAmount + b.totalAmount + c.totalAmount;

        if (Math.abs(sum - targetAmount) <= 1.05) {
          return { invoices: [a, b, c] };
        }
        if (sum > targetAmount + 1) break;
      }
    }
  }

  // 3. Check 4-Way Combinations
  for (let i = 0; i < maxItems; i++) {
    const a = sorted[i];
    if (a.totalAmount > targetAmount + 1) break;

    for (let j = i + 1; j < maxItems; j++) {
      const b = sorted[j];
      if (a.totalAmount + b.totalAmount > targetAmount + 1) break;

      for (let k = j + 1; k < maxItems; k++) {
        const c = sorted[k];
        if (a.totalAmount + b.totalAmount + c.totalAmount > targetAmount + 1) break;

        for (let l = k + 1; l < maxItems; l++) {
          const d = sorted[l];
          const sum = a.totalAmount + b.totalAmount + c.totalAmount + d.totalAmount;

          if (Math.abs(sum - targetAmount) <= 1.05) {
            return { invoices: [a, b, c, d] };
          }
          if (sum > targetAmount + 1) break;
        }
      }
    }
  }

  return null;
}
