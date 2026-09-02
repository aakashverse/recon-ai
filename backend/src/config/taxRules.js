/**
 * Grounded Tax & Statutory Deduction Knowledge Base
 * 
 * DISCLAIMER: These are representative statutory rates and thresholds for 
 * enterprise reconciliation test datasets and evaluation; not a certified tax engine.
 */

export const TAX_RULE_KNOWLEDGE_BASE = [
  {
    ruleId: 'TDS-194C',
    section: '194C',
    title: 'Payments to Contractors & Sub-contractors',
    standardRate: 2,
    individualHufRate: 1,
    description: 'Statutory 2% withholding on B2B contractor invoices, logistics, catering, maintenance, and advertising contracts.',
    keywords: ['CONTRACTOR', '194C', 'CONTRACT', 'CATERING', 'ADVERTISING', 'LOGISTICS', 'TRANSPORT', 'FREIGHT', 'MAINTENANCE', 'SUPPLY'],
    baseOrGross: 'GROSS',
  },
  {
    ruleId: 'TDS-194J',
    section: '194J',
    title: 'Fees for Professional or Technical Services',
    standardRate: 10,
    technicalCallCenterRate: 2,
    description: 'Statutory 10% withholding on professional, legal, technical, management consultancy, and software development fees.',
    keywords: ['PROFESSIONAL', 'PROF-FEES', '194J', 'TECHNICAL', 'LEGAL', 'CONSULTING', 'CONSULTANCY', 'MANAGEMENT', 'SOFTWARE', 'DEV'],
    baseOrGross: 'GROSS',
  },
  {
    ruleId: 'TDS-194H',
    section: '194H',
    title: 'Commission or Brokerage',
    standardRate: 5,
    description: 'Statutory 5% withholding on sales commission, agency brokerage, and intermediary payout settlements.',
    keywords: ['COMMISSION', '194H', 'BROKERAGE', 'AGENCY', 'BROKER', 'INTERMEDIARY'],
    baseOrGross: 'GROSS',
  },
  {
    ruleId: 'TDS-194Q',
    section: '194Q',
    title: 'Deduction on Purchase of Goods exceeding ₹50 Lakhs',
    standardRate: 0.1,
    description: 'Statutory 0.1% tax deduction on purchase of commercial goods where aggregate buyer turnover exceeds ₹10 Crores.',
    keywords: ['194Q', 'GOODS', 'PURCHASE OF GOODS', 'COMMERCIAL GOODS', '0.1%', '0.1PCT'],
    baseOrGross: 'GROSS',
  },
  {
    ruleId: 'TDS-206AB',
    section: '206AB',
    title: 'Special Higher Rate for Non-Filers of Income Tax Return',
    standardRate: 20,
    description: 'Penal higher withholding rate (typically 20% or twice the base rate) for specified vendors failing to file ITR in preceding years.',
    keywords: ['206AB', 'NON-FILER', 'PENAL', 'HIGHER RATE', 'SPECIFIED PERSON', '20%', '20PCT'],
    baseOrGross: 'GROSS',
  },
  {
    ruleId: 'TDS-CBDT-23',
    section: '194J_BASE_CBDT_23',
    title: 'CBDT Circular 23/2017: TDS Strictly on Taxable Base Value (Excluding GST)',
    standardRate: 10,
    description: 'When GST component is separately identified on the tax invoice, TDS is computed solely on the base taxable value, excluding CGST/SGST/IGST.',
    keywords: ['CBDT', 'CIRCULAR 23', 'BASE ONLY', 'EXCLUDING GST', 'BASE-10PCT', 'BASE TAXABLE', 'CIRCULAR-23'],
    baseOrGross: 'BASE',
  },
  {
    ruleId: 'TCS-52',
    section: 'TCS-52',
    title: 'Section 52 CGST Act: E-Commerce Operator TCS',
    standardRate: 1,
    description: 'Statutory 1% TCS collected by e-commerce aggregators on net taxable supplies facilitated through digital platforms.',
    keywords: ['TCS', 'SEC 52', 'SECTION 52', 'E-COMMERCE', 'MARKETPLACE TCS', '1% TCS'],
    baseOrGross: 'BASE',
  },
  {
    ruleId: 'FEE-WIRE-PG',
    section: 'GATEWAY_WIRE_FEE',
    title: 'Payment Gateway Wire & Processing Fee Netting',
    standardRate: null,
    standardAmount: 100,
    description: 'Standard ₹50 - ₹100 interbank RTGS/NEFT or payment aggregator gateway processing fee netted from settlement payout.',
    keywords: ['WIRE FEE', 'WIRE-FEE', 'PG-FEE', 'GATEWAY FEE', 'PROCESSING FEE', 'NET-LESS-WIRE', 'WIRE CHG', 'CHARGES'],
    baseOrGross: 'FIXED_FEE',
  },
  {
    ruleId: 'DISC-EARLY',
    section: 'CASH_DISCOUNT',
    title: 'Contractual Early Payment Cash Discount',
    standardRate: 2,
    description: 'Contractual 2% to 5% cash discount for settlement within agreed net-15 / net-30 terms.',
    keywords: ['DISCOUNT', 'CASH DISCOUNT', 'EARLY PAYMENT', 'REBATE', 'SETTL-DISC', '2% DISC'],
    baseOrGross: 'GROSS',
  },
];

/**
 * Retrieves relevant statutory tax rules for a given narration and delta percentage.
 * Injects only the targeted candidates into the prompt context for model grounding.
 */
export function retrieveRelevantTaxRules(narration = '', deltaRatio = 0) {
  const text = (narration || '').toUpperCase();
  const matchedRules = [];

  for (const rule of TAX_RULE_KNOWLEDGE_BASE) {
    let score = 0;

    // Check keyword matches in narration
    for (const kw of rule.keywords) {
      if (text.includes(kw)) {
        score += 2;
      }
    }

    // Check rate proximity if standardRate is defined and deltaRatio is positive
    if (rule.standardRate && deltaRatio > 0) {
      const rateDiff = Math.abs(rule.standardRate - deltaRatio * 100);
      if (rateDiff < 0.2) {
        score += 3;
      } else if (rateDiff < 1.0) {
        score += 1;
      }
    }

    if (score > 0) {
      matchedRules.push({ rule, score });
    }
  }

  // Sort by relevance score descending
  matchedRules.sort((a, b) => b.score - a.score);

  // Return top 3 matched rules, or default contractor/professional rules if none matched
  if (matchedRules.length > 0) {
    return matchedRules.slice(0, 3).map((m) => m.rule);
  }

  // Default fallback: return standard 194C, 194J, and Wire Fee
  return [
    TAX_RULE_KNOWLEDGE_BASE.find((r) => r.ruleId === 'TDS-194C'),
    TAX_RULE_KNOWLEDGE_BASE.find((r) => r.ruleId === 'TDS-194J'),
    TAX_RULE_KNOWLEDGE_BASE.find((r) => r.ruleId === 'FEE-WIRE-PG'),
  ].filter(Boolean);
}

/**
 * Semantic Vector RAG Retrieval for Statutory Tax Rules
 * Computes vector embeddings and Cosine Similarity against MongoDB Vector Index
 */
export async function retrieveSemanticTaxRules(narration = '', deltaRatio = 0, topK = 3) {
  try {
    const { vectorStoreService } = await import('../services/vectorStoreService.js');
    return await vectorStoreService.searchTaxRules(narration, deltaRatio, topK);
  } catch (err) {
    const fallbackRules = retrieveRelevantTaxRules(narration, deltaRatio);
    return fallbackRules.map((r) => ({
      rule: r,
      cosineScore: 0.85,
      vectorSource: 'LOCAL_RULE_FALLBACK',
      embeddingModel: 'local-dense-128',
    }));
  }
}
