import mongoose from 'mongoose';

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    customerName: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    customerGstin: {
      type: String,
      trim: true,
      index: true,
    },
    customerEmail: {
      type: String,
      trim: true,
      default: function () {
        const name = this && this.customerName ? this.customerName : 'vendor';
        const clean = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        return `finance@${clean || 'vendor'}.com`;
      },
    },
    customerPhone: {
      type: String,
      trim: true,
      default: '+919876543210',
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    baseAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    taxAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    expectedTdsRate: {
      type: Number,
      default: 0, // e.g. 1% (194C), 2% (194C Co), 10% (194J)
      min: 0,
    },
    expectedTdsSection: {
      type: String,
      enum: ['194C', '194J', '194H', '194Q', '194I', '194A', '206AB', 'NONE'],
      default: 'NONE',
    },
    expectedTdsAmount: {
      type: Number,
      default: 0,
    },
    expectedNetAmount: {
      type: Number,
      default: function () {
        const total = this && this.totalAmount ? this.totalAmount : 0;
        const tds = this && this.expectedTdsAmount ? this.expectedTdsAmount : 0;
        return total - tds;
      },
    },
    status: {
      type: String,
      enum: ['UNPAID', 'PARTIALLY_PAID', 'PAID', 'DISPUTED'],
      default: 'UNPAID',
      index: true,
    },
    paidAmount: {
      type: Number,
      default: 0,
    },
    reconciledBankTxnId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BankLedger',
      default: null,
    },
    reconciledAt: {
      type: Date,
      default: null,
    },
    reconMethod: {
      type: String,
      enum: ['TIER_1_EXACT', 'TIER_2_RULE', 'TIER_3_GENAI', 'MANUAL_OVERRIDE', null],
      default: null,
    },
    invoiceDate: {
      type: Date,
      default: Date.now,
    },
    dueDate: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

invoiceSchema.index({ totalAmount: 1, status: 1 });
invoiceSchema.index({ expectedNetAmount: 1, status: 1 });

export const Invoice = mongoose.model('Invoice', invoiceSchema);
