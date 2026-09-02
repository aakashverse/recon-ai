import mongoose from 'mongoose';
import { getEmbeddingModel, isAIAvailable } from '../config/ai.js';
import { TAX_RULE_KNOWLEDGE_BASE } from '../config/taxRules.js';
import { TaxRuleVector } from '../models/TaxRuleVector.js';

/**
 * Mathematical Cosine Similarity between two N-dimensional vectors:
 * cos(theta) = (u . v) / (||u|| * ||v||)
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0) return 0;
  const len = Math.min(vecA.length, vecB.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < len; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : Number((dot / denom).toFixed(6));
}

/**
 * Deterministic High-Speed Dense Vectorizer (128 dimensions)
 * Used when offline, in CI/mock mode, or as instant fallback.
 */
export function generateDeterministicDenseVector(text, dimensions = 128) {
  const clean = (text || '').toLowerCase().trim();
  const vector = new Array(dimensions).fill(0);
  if (!clean) return vector;

  // Tri-gram character hashing
  for (let i = 0; i < clean.length - 2; i++) {
    const tri = clean.slice(i, i + 3);
    let hash = 0;
    for (let c = 0; c < tri.length; c++) {
      hash = (hash << 5) - hash + tri.charCodeAt(c);
      hash |= 0;
    }
    const idx = Math.abs(hash) % dimensions;
    vector[idx] += 1.0;
  }

  // Token-level hashing for high-weight keywords
  const tokens = clean.split(/[^a-z0-9]+/);
  for (const tok of tokens) {
    if (!tok) continue;
    let hash = 5381;
    for (let c = 0; c < tok.length; c++) {
      hash = ((hash << 5) + hash) + tok.charCodeAt(c);
    }
    const idx = Math.abs(hash) % dimensions;
    vector[idx] += 2.5;
  }

  // L2 Normalization
  let norm = 0;
  for (let i = 0; i < dimensions; i++) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm) || 1e-9;
  for (let i = 0; i < dimensions; i++) vector[i] /= norm;
  return vector;
}

// In-Memory Fallback & Performance Cache
let inMemoryTaxVectors = [];
const narrationVectorCache = [];
const MAX_NARRATION_CACHE = 500;

class VectorStoreService {
  constructor() {
    this.isSynced = false;
    this.syncPromise = null;
  }

  /**
   * Generates vector embeddings for a given string.
   * Priority: Google Gemini gemini-embedding-001 (3072 dims) -> Local Dense Fallback (128 dims)
   */
  async embedText(text, forceLocal = false) {
    const cleanText = (text || '').trim();
    const isMock = process.env.MOCK_LLM === 'true';

    if (!forceLocal && !isMock && isAIAvailable()) {
      const model = getEmbeddingModel();
      if (model) {
        try {
          const res = await model.embedContent(cleanText);
          if (res && res.embedding && Array.isArray(res.embedding.values)) {
            return {
              vector: res.embedding.values,
              source: 'GEMINI_EMBEDDING_001',
              dimensions: res.embedding.values.length,
            };
          }
        } catch (err) {
          console.warn('[VectorStore] Live Gemini embedding query failed, using resilient fallback:', err.message);
        }
      }
    }

    return {
      vector: generateDeterministicDenseVector(cleanText, 128),
      source: 'LOCAL_DENSE_FALLBACK',
      dimensions: 128,
    };
  }

  /**
   * Synchronizes and indexes all statutory tax rules into MongoDB and Memory
   */
  async syncTaxRuleVectors() {
    if (this.isSynced && inMemoryTaxVectors.length > 0) return inMemoryTaxVectors;
    if (this.syncPromise) return this.syncPromise;

    this.syncPromise = (async () => {
      const isDbConnected = mongoose.connection.readyState === 1;
      const syncedDocs = [];

      for (const rule of TAX_RULE_KNOWLEDGE_BASE) {
        const docText = `${rule.title} - Section ${rule.section}. Standard TDS rate: ${rule.standardRate || 0}%. ${rule.description} Keywords: ${(rule.keywords || []).join(', ')}`;
        const { vector, source, dimensions } = await this.embedText(docText);

        const record = {
          ruleId: rule.ruleId,
          section: rule.section,
          title: rule.title,
          standardRate: rule.standardRate || 0,
          description: rule.description,
          keywords: rule.keywords || [],
          docText,
          embedding: vector,
          embeddingModel: source === 'GEMINI_EMBEDDING_001' ? 'gemini-embedding-001' : 'local-dense-128',
          dimensions,
          vectorSource: source,
          rule,
        };

        syncedDocs.push(record);

        if (isDbConnected) {
          try {
            await TaxRuleVector.findOneAndUpdate(
              { ruleId: rule.ruleId },
              { $set: record },
              { upsert: true, new: true }
            );
          } catch (dbErr) {
            console.warn(`[VectorStore Warning] Could not persist vector for ${rule.ruleId} to MongoDB: ${dbErr.message}`);
          }
        }
      }

      inMemoryTaxVectors = syncedDocs;
      this.isSynced = true;
      const src = inMemoryTaxVectors[0]?.vectorSource || 'LOCAL_DENSE_FALLBACK';
      const dims = inMemoryTaxVectors[0]?.dimensions || 128;
      console.log(`[VectorStore] Synchronized ${inMemoryTaxVectors.length} Statutory Tax Embeddings into MongoDB & Memory (${src}, ${dims} dims).`);
      return inMemoryTaxVectors;
    })();

    return this.syncPromise;
  }

  /**
   * Performs Semantic Vector Search across Statutory Tax Rules
   * Uses MongoDB Atlas $vectorSearch when supported, with exact cosine aggregation fallback.
   */
  async searchTaxRules(narrationText = '', deltaRatio = 0, topK = 3) {
    if (!this.isSynced || inMemoryTaxVectors.length === 0) {
      await this.syncTaxRuleVectors();
    }

    const { vector: queryVector, source: vectorSource } = await this.embedText(narrationText);
    let results = [];

    // Attempt MongoDB Atlas $vectorSearch if database is connected
    const isDbConnected = mongoose.connection.readyState === 1;
    if (isDbConnected && vectorSource === 'GEMINI_EMBEDDING_001') {
      try {
        const atlasResults = await TaxRuleVector.aggregate([
          {
            $vectorSearch: {
              index: 'tax_vector_index',
              path: 'embedding',
              queryVector,
              numCandidates: 20,
              limit: topK,
            },
          },
        ]);
        if (atlasResults && atlasResults.length > 0) {
          results = atlasResults.map((doc) => ({
            rule: TAX_RULE_KNOWLEDGE_BASE.find((r) => r.ruleId === doc.ruleId) || doc,
            cosineScore: Number(doc.score || 0.95),
            vectorSource: 'MONGODB_ATLAS_VECTOR_SEARCH',
            embeddingModel: 'gemini-embedding-001',
          }));
        }
      } catch {
        // Fallback to exact cosine search over MongoDB / memory
      }
    }

    // Mathematical Cosine Similarity Search (Primary / Resilient Fallback)
    if (results.length === 0) {
      const candidates = inMemoryTaxVectors.map((entry) => {
        let targetVector = entry.embedding;
        if (targetVector.length !== queryVector.length) {
          targetVector = generateDeterministicDenseVector(entry.docText, queryVector.length);
        }

        let sim = cosineSimilarity(queryVector, targetVector);

        // Boost by statutory rate proximity if delta percentage is available
        if (entry.standardRate && deltaRatio > 0) {
          const rateDiff = Math.abs(entry.standardRate - deltaRatio * 100);
          if (rateDiff < 0.2) sim += 0.08;
          else if (rateDiff < 1.0) sim += 0.03;
        }

        return {
          rule: entry.rule || TAX_RULE_KNOWLEDGE_BASE.find((r) => r.ruleId === entry.ruleId),
          cosineScore: Number(Math.min(1.0, sim).toFixed(4)),
          vectorSource,
          embeddingModel: vectorSource === 'GEMINI_EMBEDDING_001' ? 'gemini-embedding-001' : 'local-dense-128',
        };
      });

      candidates.sort((a, b) => b.cosineScore - a.cosineScore);
      results = candidates.slice(0, topK);
    }

    return results;
  }

  /**
   * Semantic Vector Search for Recurring Bank Narrations
   */
  async searchNarrationCache(narrationText, threshold = 0.88) {
    if (narrationVectorCache.length === 0) return null;
    const { vector: queryVector } = await this.embedText(narrationText);

    let bestMatch = null;
    let highestSim = -1;

    for (const item of narrationVectorCache) {
      let targetVec = item.vector;
      if (targetVec.length !== queryVector.length) {
        targetVec = generateDeterministicDenseVector(item.narration, queryVector.length);
      }
      const sim = cosineSimilarity(queryVector, targetVec);
      if (sim > highestSim) {
        highestSim = sim;
        bestMatch = item;
      }
    }

    if (bestMatch && highestSim >= threshold) {
      return {
        ...bestMatch.resolution,
        ragCacheHit: true,
        semanticSimilarity: highestSim,
        vectorSource: bestMatch.vectorSource,
      };
    }

    return null;
  }

  /**
   * Stores verified resolution in semantic vector cache
   */
  async storeNarrationCache(narrationText, resolution) {
    if (!narrationText || narrationText.length < 8) return;
    const { vector, source } = await this.embedText(narrationText);

    if (narrationVectorCache.length >= MAX_NARRATION_CACHE) {
      narrationVectorCache.shift();
    }

    narrationVectorCache.push({
      narration: narrationText,
      vector,
      vectorSource: source,
      resolution,
      timestamp: Date.now(),
    });
  }

  /**
   * Clears in-memory semantic cache
   */
  clearCache() {
    narrationVectorCache.length = 0;
  }
}

export const vectorStoreService = new VectorStoreService();
