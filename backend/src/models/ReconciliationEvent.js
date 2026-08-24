import mongoose from 'mongoose';

const dagNodeSchema = new mongoose.Schema(
  {
    nodeKey: {
      type: String,
      required: true,
      enum: [
        'STEP_INGEST',
        'STEP_TIER_1',
        'STEP_TIER_2',
        'STEP_TIER_3',
        'STEP_TIER_4',
        'STEP_CIRCUIT_BREAKER',
        'STEP_COMMIT',
        'STEP_OUTBOX',
      ],
    },
    name: { type: String, required: true },
    tier: { type: String, default: null },
    status: {
      type: String,
      enum: ['PENDING', 'RUNNING', 'SUCCESS', 'BYPASSED', 'FAILED', 'DISCREPANCY_DETECTED'],
      required: true,
    },
    durationMs: { type: Number, default: 0 },
    inputData: { type: mongoose.Schema.Types.Mixed, default: {} },
    outputData: { type: mongoose.Schema.Types.Mixed, default: {} },
    errorMessage: { type: String, default: null },
  },
  { _id: false }
);

const reconciliationEventSchema = new mongoose.Schema(
  {
    chainIndex: {
      type: Number,
      required: true,
      index: true,
    },
    bankTxnId: {
      type: String,
      required: true,
      index: true,
    },
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
      default: null,
    },
    invoiceNumber: {
      type: String,
      default: null,
      index: true,
    },
    splitInvoices: [
      {
        invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
        invoiceNumber: String,
        amount: Number,
      },
    ],
    batchId: {
      type: String,
      default: null,
      index: true,
    },
    dagNodes: [dagNodeSchema],
    resolvedTier: {
      type: String,
      enum: ['TIER_1', 'TIER_2', 'TIER_3', 'TIER_4', 'OUTBOX_EXCEPTION', 'DUPLICATE_REJECTED'],
      required: true,
    },
    circuitBreakerResult: {
      passed: { type: Boolean, default: false },
      equation: { type: String, default: '' },
      difference: { type: Number, default: 0 },
      invoiceGross: { type: Number, default: 0 },
      deductionsTotal: { type: Number, default: 0 },
      bankReceived: { type: Number, default: 0 },
    },
    confidence: {
      type: Number,
      default: 1.0,
    },
    ragCacheHit: {
      type: Boolean,
      default: false,
    },
    totalDurationMs: {
      type: Number,
      default: 0,
    },
    rawNarration: {
      type: String,
      default: '',
    },
    previousEventHash: {
      type: String,
      default: null,
      index: true,
    },
    eventHash: {
      type: String,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

reconciliationEventSchema.index({ createdAt: -1 });

export const ReconciliationEvent = mongoose.model('ReconciliationEvent', reconciliationEventSchema);
