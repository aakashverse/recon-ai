import mongoose from 'mongoose';

const journalEntrySchema = new mongoose.Schema(
  {
    journalEntryNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    bankTxnId: {
      type: String,
      required: true,
      index: true,
    },
    invoiceNumber: {
      type: String,
      default: null,
    },
    entryDate: {
      type: Date,
      default: Date.now,
    },
    reconciliationTier: {
      type: String,
      required: true,
    },
    debitLines: [
      {
        accountCode: { type: String, required: true }, // e.g. '1010-BANK-CLEARING', '1020-TDS-RECEIVABLE'
        accountName: { type: String, required: true },
        amount: { type: Number, required: true, min: 0 },
        statutorySection: { type: String, default: null }, // e.g. '194C', '194J'
      },
    ],
    creditLines: [
      {
        accountCode: { type: String, required: true }, // e.g. '1200-ACCOUNTS-RECEIVABLE'
        accountName: { type: String, required: true },
        amount: { type: Number, required: true, min: 0 },
        partyName: { type: String, default: null },
      },
    ],
    totalDebit: {
      type: Number,
      required: true,
    },
    totalCredit: {
      type: Number,
      required: true,
    },
    isBalanced: {
      type: Boolean,
      required: true,
      default: true,
    },
    auditMemo: {
      summary: String,
      statutoryReference: String,
      confidenceScore: Number,
      generatedBy: { type: String, default: 'RAZORPAY_RECON_AI_CONTROLLER' },
    },
  },
  {
    timestamps: true,
  }
);

export const JournalEntry = mongoose.model('JournalEntry', journalEntrySchema);
