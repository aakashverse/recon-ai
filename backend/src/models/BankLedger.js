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
      enum: ['UNPROCESSED', 'MATCHED', 'EXCEPTION', 'FLAGGED_FOR_HUMAN'],
      default: 'UNPROCESSED',
      index: true,
    },
    reconciledInvoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
      default: null,
    },
    matchedTier: {
      type: String,
      enum: ['TIER_1', 'TIER_2', 'TIER_3', 'MANUAL', null],
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
      totalDeductions: { type: Number, default: 0 },
    },
    executionMetrics: {
      tier1DurationMs: { type: Number, default: 0 },
      tier2DurationMs: { type: Number, default: 0 },
      tier3DurationMs: { type: Number, default: 0 },
      circuitBreakerDurationMs: { type: Number, default: 0 },
      totalDurationMs: { type: Number, default: 0 },
    },
    discrepancyDetails: {
      expectedAmount: { type: Number, default: null },
      actualReceived: { type: Number, default: null },
      discrepancyAmount: { type: Number, default: null },
      mathEquation: { type: String, default: null },
      reason: { type: String, default: null },
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
