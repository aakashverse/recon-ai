import mongoose from 'mongoose';

const ruleCacheSchema = new mongoose.Schema(
  {
    partyIdentifier: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    patternType: {
      type: String,
      enum: ['EXACT_VENDOR', 'NARRATION_REGEX', 'GSTIN_MATCH', 'TDS_STANDARD'],
      default: 'TDS_STANDARD',
    },
    matchCriteria: {
      narrationKeywords: [{ type: String, trim: true }],
      regexPattern: { type: String, default: null },
      customerGstin: { type: String, default: null },
    },
    adjustmentLogic: {
      tdsSection: { type: String, enum: ['194C', '194J', '194H', '194Q', '194I', '194A', '206AB', 'NONE', null], default: '194C' },
      tdsRate: { type: Number, default: 2.0 },
      handlingFeeRate: { type: Number, default: 0 },
      fixedDeduction: { type: Number, default: 0 },
    },
    confidence: {
      type: Number,
      default: 0.95,
      min: 0,
      max: 1,
    },
    usageCount: {
      type: Number,
      default: 0,
    },
    lastTriggeredAt: {
      type: Date,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    source: {
      type: String,
      enum: ['SEEDED', 'LEARNED_FROM_EXCEPTION', 'MANUAL'],
      default: 'SEEDED',
    },
    description: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

ruleCacheSchema.index({ partyIdentifier: 1, isActive: 1 });

export const RuleCache = mongoose.model('RuleCache', ruleCacheSchema);
