import mongoose from 'mongoose';

const bankLedgerSchema = new mongoose.Schema(
  {
    bankTxnId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    utrNumber: {
      type: String,
      trim: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    narration: {
      type: String,
      required: true,
      trim: true,
    },
    attachmentUrl: {
      type: String,
      default: null,
    },
    idempotencyHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    reconciliationStatus: {
      type: String,
      enum: ['UNPROCESSED', 'MATCHED', 'PROPOSED', 'EXCEPTION', 'FLAGGED_FOR_HUMAN', 'OVERRIDDEN'],
      default: 'UNPROCESSED',
      index: true,
    },
    // Governance & Accountability Fields (v5 Trust Layer)
    trustLevel: {
      type: String,
      enum: ['FIRST_TIME', 'CONFIRMED_ONCE', 'PROVISIONAL_AUTO', 'FULLY_TRUSTED', 'EXACT_VERIFIED', null],
      default: null,
      index: true,
    },
    accountabilityStatement: {
      type: String,
      default: '',
    },
    confidenceLabel: {
      type: String,
      default: '',
    },
    proposalDetails: {
      proposedInvoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
      proposedInvoiceNumber: { type: String, default: null },
      proposedTier: { type: String, default: null },
      proposedAt: { type: Date, default: null },
    },
    overrideDetails: {
      originalProposal: { type: mongoose.Schema.Types.Mixed, default: null },
      accountantReason: { type: String, default: null },
      overriddenBy: { type: String, default: null },
      overriddenAt: { type: Date, default: null },
    },
    reconciledInvoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
      default: null,
    },
    splitInvoices: [
      {
        invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
        invoiceNumber: String,
        amount: Number,
      },
    ],
    matchedTier: {
      type: String,
      enum: ['TIER_1', 'TIER_2', 'TIER_3', 'PROPOSED', 'MANUAL', null],
      default: null,
    },
    confidenceScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
    },
    deductionsApplied: {
      tdsAmount: { type: Number, default: 0 },
      tdsRate: { type: Number, default: 0 },
      tdsSection: { type: String, default: null },
      bankCharges: { type: Number, default: 0 },
      discount: { type: Number, default: 0 },
      gstRounding: { type: Number, default: 0 },
      totalDeductions: { type: Number, default: 0 },
    },
    executionMetrics: {
      tier1DurationMs: { type: Number, default: 0 },
      tier2DurationMs: { type: Number, default: 0 },
      tier3DurationMs: { type: Number, default: 0 },
      tier4DurationMs: { type: Number, default: 0 },
      circuitBreakerDurationMs: { type: Number, default: 0 },
      totalDurationMs: { type: Number, default: 0 },
      ragCacheHit: { type: Boolean, default: false },
      splitMatchCount: { type: Number, default: 0 },
    },
    discrepancyDetails: {
      expectedAmount: { type: Number, default: null },
      actualReceived: { type: Number, default: null },
      discrepancyAmount: { type: Number, default: null },
      mathEquation: { type: String, default: null },
      reason: { type: String, default: null },
    },
    dagNodes: {
      type: Array,
      default: [],
    },
    txnDate: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

bankLedgerSchema.index({ reconciliationStatus: 1, txnDate: -1 });

export const BankLedger = mongoose.model('BankLedger', bankLedgerSchema);
