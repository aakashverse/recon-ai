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
    // Graduated Autonomy State Machine (Step 1 of v5 Governance Layer)
    trustLevel: {
      type: String,
      enum: ['FIRST_TIME', 'CONFIRMED_ONCE', 'PROVISIONAL_AUTO', 'FULLY_TRUSTED'],
      default: 'FIRST_TIME',
      index: true,
    },
    consecutiveConfirmations: {
      type: Number,
      default: 0,
    },
    overrideCount: {
      type: Number,
      default: 0,
    },
    lastConfirmedAt: {
      type: Date,
      default: null,
    },
    lastOverriddenAt: {
      type: Date,
      default: null,
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

/**
 * Graduate trust level after clean accountant confirmation
 * FIRST_TIME (0) -> CONFIRMED_ONCE (1) -> PROVISIONAL_AUTO (2) -> FULLY_TRUSTED (3+)
 */
ruleCacheSchema.methods.graduateTrust = async function () {
  this.consecutiveConfirmations = (this.consecutiveConfirmations || 0) + 1;
  this.lastConfirmedAt = new Date();

  if (this.consecutiveConfirmations >= 3) {
    this.trustLevel = 'FULLY_TRUSTED';
  } else if (this.consecutiveConfirmations >= 2) {
    this.trustLevel = 'PROVISIONAL_AUTO';
  } else if (this.consecutiveConfirmations >= 1) {
    this.trustLevel = 'CONFIRMED_ONCE';
  }

  await this.save();
  return this;
};

/**
 * Automatically downgrade trust level upon accountant override/rejection
 */
ruleCacheSchema.methods.downgradeTrust = async function () {
  this.consecutiveConfirmations = 0;
  this.overrideCount = (this.overrideCount || 0) + 1;
  this.lastOverriddenAt = new Date();

  if (this.trustLevel === 'FULLY_TRUSTED') {
    this.trustLevel = 'PROVISIONAL_AUTO';
  } else if (this.trustLevel === 'PROVISIONAL_AUTO') {
    this.trustLevel = 'CONFIRMED_ONCE';
  } else {
    this.trustLevel = 'FIRST_TIME';
  }

  await this.save();
  return this;
};

ruleCacheSchema.index({ partyIdentifier: 1, isActive: 1 });

export const RuleCache = mongoose.model('RuleCache', ruleCacheSchema);
