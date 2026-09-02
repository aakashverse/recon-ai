import mongoose from 'mongoose';

const TaxRuleVectorSchema = new mongoose.Schema(
  {
    ruleId: { type: String, required: true, unique: true, index: true },
    section: { type: String, required: true },
    title: { type: String, required: true },
    standardRate: { type: Number, default: 0 },
    description: { type: String },
    keywords: { type: [String], default: [] },
    docText: { type: String, required: true },
    embedding: { type: [Number], required: true },
    embeddingModel: { type: String, default: 'gemini-embedding-001' },
    dimensions: { type: Number, default: 3072 },
    vectorSource: { type: String, enum: ['GEMINI_EMBEDDING_001', 'LOCAL_DENSE_FALLBACK'], default: 'GEMINI_EMBEDDING_001' },
  },
  { timestamps: true }
);

export const TaxRuleVector = mongoose.models.TaxRuleVector || mongoose.model('TaxRuleVector', TaxRuleVectorSchema);
