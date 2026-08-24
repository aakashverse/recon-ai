import { RuleCache } from '../models/RuleCache.js';
import { Invoice } from '../models/Invoice.js';

/**
 * Tier 3: Self-Healing Rule Cache (<10ms)
 * - Evaluates historical vendor rules, known deduction patterns (Section 194C, 194J, etc.)
 * - Applies deterministic deduction arithmetic before invoking GenAI
 */
export async function matchTier3(bankTxn) {
  const startTime = performance.now();
  const rawNarration = (bankTxn.narration || '').trim().toUpperCase();
  const bankAmount = Number(bankTxn.amount);

  // 1. Fetch active rules
  const activeRules = await RuleCache.find({ isActive: true }).lean();
  if (!activeRules.length) {
    return { matched: false, tier: 'TIER_3', durationMs: performance.now() - startTime };
  }

  // 2. Identify potential party/invoice tokens from narration
  const invoiceMatch = rawNarration.match(/\b(INV[/-]?[A-Z0-9-]+|[A-Z0-9]+-INV[/-]?[A-Z0-9-]+)\b/i);
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
      const invoiceQuery = { status: { $in: ['UNPAID', 'PARTIALLY_PAID'] } };
      if (explicitInvNum) {
        invoiceQuery.invoiceNumber = { $regex: new RegExp(`^${explicitInvNum}$`, 'i') };
      } else {
        const vendorFilters = [rule.partyIdentifier, ...(rule.matchCriteria?.narrationKeywords || [])].filter(Boolean);
        invoiceQuery.$or = vendorFilters.map((kw) => ({
          customerName: { $regex: new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
        }));
      }

      const candidateInvoices = await Invoice.find(invoiceQuery).limit(5).lean();

      for (const invoice of candidateInvoices) {
        const gross = Number(invoice.totalAmount);
        const tdsRate = Number(rule.adjustmentLogic?.tdsRate || 0);
        const handlingFeeRate = Number(rule.adjustmentLogic?.handlingFeeRate || 0);
        const fixedDeduction = Number(rule.adjustmentLogic?.fixedDeduction || 0);

        const tdsAmount = tdsRate > 0 ? (gross * tdsRate) / 100 : 0;
        const handlingFee = handlingFeeRate > 0 ? (gross * handlingFeeRate) / 100 : 0;
        const totalDeductions = tdsAmount + handlingFee + fixedDeduction;
        const calculatedNet = gross - totalDeductions;

        // Check if arithmetic matches bank received amount (within 0.05 float tolerance)
        if (Math.abs(calculatedNet - bankAmount) < 0.05) {
          // Increment rule usage asynchronously
          RuleCache.updateOne(
            { _id: rule._id },
            {
              $inc: { usageCount: 1 },
              $set: { lastTriggeredAt: new Date() },
            }
          ).catch((e) => console.warn('[Tier 3] Rule usage count update error:', e.message));

          const durationMs = performance.now() - startTime;
          return {
            matched: true,
            tier: 'TIER_3',
            invoice,
            ruleApplied: rule,
            confidence: rule.confidence ? Math.min(rule.confidence, 0.93) : 0.91,
            deductions: {
              tdsAmount: Number(tdsAmount.toFixed(2)),
              tdsRate,
              tdsSection: rule.adjustmentLogic?.tdsSection || '194C',
              bankCharges: Number(handlingFee.toFixed(2)),
              discount: Number(fixedDeduction.toFixed(2)),
              totalDeductions: Number(totalDeductions.toFixed(2)),
            },
            durationMs,
            matchType: `RULE_PATTERN_${rule.partyIdentifier}`,
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
  };
}

// Backwards compatibility alias
export const matchTier2 = matchTier3;
