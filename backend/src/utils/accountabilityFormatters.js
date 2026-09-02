/**
 * Accountability and Governance Formatters (v5 Trust Layer)
 * Translates low-level ML metrics into clear, human-legible accountability statements
 * and confidence classifications for financial controllers and auditors.
 */

/**
 * Generates an unambiguous, primary-view accountability statement for a transaction.
 */
export function getAccountabilityStatement(resolvedTier, trustLevel, circuitBreaker, isProposed = false) {
  if (resolvedTier === 'TIER_1') {
    return 'Verified — exact match, no inference involved.';
  }

  if (isProposed || resolvedTier === 'PROPOSED') {
    if (resolvedTier === 'TIER_3' || resolvedTier === 'TIER_4' || resolvedTier === 'PROPOSED') {
      return 'Proposed by GenAI extraction — arithmetic independently verified — awaiting accountant sign-off.';
    }
    return 'Proposed by pattern match — novel counterparty pattern — awaiting accountant confirmation.';
  }

  if (resolvedTier === 'TIER_2' || resolvedTier === 'TIER_3') {
    if (trustLevel === 'FULLY_TRUSTED') {
      return 'Matched via trusted vendor rule — auto-committed after 3 consecutive confirmations.';
    }
    if (trustLevel === 'PROVISIONAL_AUTO') {
      return 'Matched via taught rule pattern — provisional auto-commit, flagged for review.';
    }
    if (trustLevel === 'CONFIRMED_ONCE') {
      return 'Matched via confirmed vendor rule — provisional, awaiting final trust promotion.';
    }
    return 'Matched via learned rule — provisional review.';
  }

  if (resolvedTier === 'ACCOUNTANT_CONFIRMED') {
    return 'Accountant confirmed — pattern promoted in trust hierarchy.';
  }

  if (resolvedTier === 'ACCOUNTANT_OVERRIDE') {
    return 'Accountant override logged — rule trust downgraded in ledger.';
  }

  if (resolvedTier === 'OUTBOX_EXCEPTION' || !circuitBreaker?.passed) {
    return 'Arithmetic variance detected — routed to exception queue for manual resolution.';
  }

  return 'Automated match — gated by zero-trust circuit breaker.';
}

/**
 * Maps numeric confidence decimals to fixed, accountant-legible labels.
 */
export function getPlainLanguageConfidence(score, tier) {
  if (tier === 'TIER_1' || score >= 0.98) {
    return {
      label: 'Verified (Exact Match)',
      badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
      description: '100% deterministic exact match with zero inference.',
      score: Number(score || 1.0),
    };
  }

  if (score >= 0.85) {
    return {
      label: 'AI-Assisted — High Confidence',
      badgeClass: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
      description: 'High statistical similarity with verified arithmetic proof.',
      score: Number(score || 0.88),
    };
  }

  if (score >= 0.65) {
    return {
      label: 'First-Time Pattern — Unconfirmed',
      badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
      description: 'Novel vendor deduction pattern awaiting accountant confirmation.',
      score: Number(score || 0.75),
    };
  }

  return {
    label: 'Low Confidence — Flagged for Manual Resolution',
    badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
    description: 'Requires human-in-the-loop inspection before ledger posting.',
    score: Number(score || 0.35),
  };
}
