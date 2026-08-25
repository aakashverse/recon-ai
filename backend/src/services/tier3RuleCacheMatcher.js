import { RuleCache } from '../models/RuleCache.js';
import { Invoice } from '../models/Invoice.js';

/**
 * Tier 3: Self-Healing Rule Cache (<10ms)
 * - Evaluates historical vendor rules, known deduction patterns (Section 194C, 194J, etc.)
 * - Applies deterministic deduction arithmetic before invoking GenAI
 * - Supports in-memory context indexing for sub-millisecond execution with zero DB round-trips
 */
export async function matchTier3(bankTxn, context = {}) {
  const startTime = performance.now();
  const rawNarration = (bankTxn.narration || '').trim().toUpperCase();
  const bankAmount = Number(bankTxn.amount);

  // 1. Fetch active rules
  const activeRules = context.activeRules || (await RuleCache.find({ isActive: true }).lean());
  if (!activeRules.length) {
    return { matched: false, tier: 'TIER_3', durationMs: performance.now() - startTime };
  }

  // 2. Identify potential party/invoice tokens from narration
  const invoiceMatch = rawNarration.match(/\b(INV[-_]?[0-9]{4}[-_]?[0-9]+|INV[-_]?[0-9]+)\b/i) || rawNarration.match(/\b(INV[/-]?[A-Z0-9]+(?:-[0-9]+)?)\b/i);
  const explicitInvNum = invoiceMatch ? invoiceMatch[1].toUpperCase() : null;

  for (const rule of activeRules) {
    let matchesRule = false;

    // Check party identifier presence in narration
    if (rule.partyIdentifier && rawNarration.includes(rule.partyIdentifier.toUpperCase())) {
      matchesRule = true;
    }

    // Check keyword criteria (any vendor keyword alias matches)
    if (!matchesRule && rule.matchCriteria?.narrationKeywords?.length) {
      const anyKeywordPresent = rule.matchCriteria.narrationKeywords.some((kw) =>
        rawNarration.includes(kw.toUpperCase())
      );
      if (anyKeywordPresent) matchesRule = true;
    }

    // Check regex pattern
    if (!matchesRule && rule.matchCriteria?.regexPattern) {
      try {
        const regex = new RegExp(rule.matchCriteria.regexPattern, 'i');
        if (regex.test(rawNarration)) matchesRule = true;
      } catch {
        // invalid regex in rule, ignore
      }
    }

    if (matchesRule) {
      // Find candidate unpaid invoices for this vendor / invoice number
      let candidateInvoices = [];
      if (context.allInvoices) {
        candidateInvoices = context.allInvoices.filter((inv) => {
          if (inv.status === 'PAID') return false;
          if (explicitInvNum) {
            return inv.invoiceNumber.toUpperCase() === explicitInvNum;
          }
          const vendorFilters = [rule.partyIdentifier, ...(rule.matchCriteria?.narrationKeywords || [])].filter(Boolean);
          const cName = (inv.customerName || '').toUpperCase();
          return vendorFilters.some((kw) => cName.includes(kw.toUpperCase()));
        });
      } else {
        const invoiceQuery = { status: { $in: ['UNPAID', 'PARTIALLY_PAID'] } };
        if (explicitInvNum) {
          invoiceQuery.invoiceNumber = { $regex: new RegExp(`^${explicitInvNum}$`, 'i') };
        } else {
          const vendorFilters = [rule.partyIdentifier, ...(rule.matchCriteria?.narrationKeywords || [])].filter(Boolean);
          invoiceQuery.$or = vendorFilters.map((kw) => ({
            customerName: { $regex: new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
          }));
        }
        candidateInvoices = await Invoice.find(invoiceQuery).lean();
      }

      for (const invoice of candidateInvoices) {
        const gross = Number(invoice.totalAmount);
        const tdsRate = rule.action?.defaultTdsRate || 0;
        const tdsSection = rule.action?.defaultTdsSection || '194C';
        const expectedTds = (gross * tdsRate) / 100;
        const netExpected = gross - expectedTds;
        const diff = Math.abs(netExpected - bankAmount);

        if (diff <= 1.05) {
          const durationMs = performance.now() - startTime;
          return {
            matched: true,
            tier: 'TIER_3',
            invoice,
            ruleApplied: rule.ruleName,
            confidence: 0.93,
            deductions: {
              tdsAmount: Number(expectedTds.toFixed(2)),
              tdsRate,
              tdsSection,
              bankCharges: 0,
              discount: 0,
              gstRounding: Number(diff.toFixed(2)),
              totalDeductions: Number(expectedTds.toFixed(2)),
            },
            durationMs,
            matchType: `HISTORICAL_RULE_CACHE_${rule.ruleName}`,
          };
        }
      }
    }
  }

  const durationMs = performance.now() - startTime;
  return {
    matched: false,
    tier: 'TIER_3',
    durationMs,
    reason: 'No historical pattern rule satisfied. Passing to Tier 4 GenAI.',
  };
}
