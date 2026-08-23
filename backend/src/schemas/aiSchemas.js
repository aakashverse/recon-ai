import { z } from 'zod';

export const AIExtractionSchema = z.object({
  candidateInvoiceNumbers: z.array(z.string()).default([]),
  vendorName: z.string().nullable().default(null),
  claimedTdsRate: z.number().min(0).max(100).nullable().default(null),
  claimedTdsAmount: z.number().min(0).nullable().default(null),
  claimedTdsSection: z.string().nullable().default(null), // e.g. '194C', '194J', '194H'
  claimedBankCharges: z.number().min(0).default(0),
  claimedDiscount: z.number().min(0).default(0),
  netPaymentAmount: z.number().positive().nullable().default(null),
  confidenceScore: z.number().min(0).max(1).default(0.85),
  reasoningSummary: z.string().default(''),
  extractedTokens: z.record(z.any()).default({}),
});

export const RuleDefinitionSchema = z.object({
  partyIdentifier: z.string().min(1),
  patternType: z.enum(['EXACT_VENDOR', 'NARRATION_REGEX', 'GSTIN_MATCH', 'TDS_STANDARD']),
  matchCriteria: z.object({
    narrationKeywords: z.array(z.string()).optional(),
    regexPattern: z.string().optional(),
    customerGstin: z.string().optional(),
  }),
  adjustmentLogic: z.object({
    tdsSection: z.string().optional(), // '194C', '194J', '194H'
    tdsRate: z.number().min(0).max(100).optional(),
    handlingFeeRate: z.number().min(0).max(100).optional(),
    fixedDeduction: z.number().min(0).optional(),
  }),
  confidence: z.number().min(0).max(1).default(0.95),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
});

export const DiscrepancyResolutionSchema = z.object({
  bankTxnId: z.string().min(1),
  invoiceId: z.string().min(1),
  approvedAdjustment: z.number().min(0),
  deductionReason: z.string().min(1),
  learnAsRule: z.boolean().default(false),
  rulePattern: z.string().optional(),
  tdsRate: z.number().optional(),
  tdsSection: z.string().optional(),
});
