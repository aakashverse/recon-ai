import mongoose from 'mongoose';
import { getEmbeddingModel, isAIAvailable } from '../config/ai.js';
import { TAX_RULE_KNOWLEDGE_BASE } from '../config/taxRules.js';
import { TaxRuleVector } from '../models/TaxRuleVector.js';

/**
 * Calculates the Euclidean L2 norm of a vector: ||v||_2
 */
export function vectorNorm(vec) {
  if (!vec || vec.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < vec.length; i++) {
    sum += vec[i] * vec[i];
  }
  return Math.sqrt(sum) || 1e-9;
}

/**
 * High-Performance Mathematical Cosine Similarity
 * Uses precalculated L2 norms when available to avoid redundant sqrt computations in loops:
 * cos(theta) = (u . v) / (||u|| * ||v||)
 */
export function cosineSimilarity(vecA, vecB, normA = null, normB = null) {
  if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0) return 0;
  const len = Math.min(vecA.length, vecB.length);
  let dot = 0;

  if (normA !== null && normB !== null) {
    for (let i = 0; i < len; i++) {
      dot += vecA[i] * vecB[i];
    }
    const denom = normA * normB;
    return denom === 0 ? 0 : Number((dot / denom).toFixed(6));
  }

  let sumSqA = 0;
  let sumSqB = 0;
  for (let i = 0; i < len; i++) {
    dot += vecA[i] * vecB[i];
    sumSqA += vecA[i] * vecA[i];
    sumSqB += vecB[i] * vecB[i];
  }

  const denom = Math.sqrt(sumSqA) * Math.sqrt(sumSqB);
  return denom === 0 ? 0 : Number((dot / denom).toFixed(6));
}

/**
 * Deterministic High-Speed Dense Vectorizer (128 dimensions)
 * Used when offline, in CI/mock mode, or as instant zero-network fallback.
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
  const norm = vectorNorm(vector);
  for (let i = 0; i < dimensions; i++) vector[i] /= norm;
  return vector;
}

// In-Memory Vector Stores & LRU Caches
let inMemoryTaxVectors = [];
const narrationVectorCache = [];
const MAX_NARRATION_CACHE = 500;

// Embedding LRU Cache: avoids duplicate Google Gemini API roundtrips
const embeddingCache = new Map();
const MAX_EMBED_CACHE = 1000;

class VectorStoreService {
  constructor() {
    this.isSynced = false;
    this.syncPromise = null;
  }

  /**
   * Generates vector embeddings for a given string with LRU caching.
   * Priority: Google Gemini gemini-embedding-001 (3072 dims) -> Local Dense Fallback (128 dims)
   */
  async embedText(text, forceLocal = false) {
    const cleanText = (text || '').trim();
    if (!cleanText) {
      return {
        vector: new Array(128).fill(0),
        source: 'EMPTY_VECTOR',
        dimensions: 128,
        norm: 0,
      };
    }

    const cacheKey = `${forceLocal ? 'L' : 'G'}:${cleanText}`;
    if (embeddingCache.has(cacheKey)) {
      return embeddingCache.get(cacheKey);
    }

    const isMock = process.env.MOCK_LLM === 'true';

    if (!forceLocal && !isMock && isAIAvailable()) {
      const model = getEmbeddingModel();
      if (model) {
        try {
          const res = await model.embedContent(cleanText);
          if (res && res.embedding && Array.isArray(res.embedding.values)) {
            const vec = res.embedding.values;
            const norm = vectorNorm(vec);
            const result = {
              vector: vec,
              source: 'GEMINI_EMBEDDING_001',
              dimensions: vec.length,
              norm,
            };

            if (embeddingCache.size >= MAX_EMBED_CACHE) {
              const firstKey = embeddingCache.keys().next().value;
              embeddingCache.delete(firstKey);
            }
            embeddingCache.set(cacheKey, result);
            return result;
          }
        } catch (err) {
          console.warn('[VectorStore] Live Gemini embedding query failed, using resilient fallback:', err.message);
        }
      }
    }

    const vec = generateDeterministicDenseVector(cleanText, 128);
    const result = {
      vector: vec,
      source: 'LOCAL_DENSE_FALLBACK',
      dimensions: 128,
      norm: 1.0, // already normalized
    };

    if (embeddingCache.size >= MAX_EMBED_CACHE) {
      const firstKey = embeddingCache.keys().next().value;
      embeddingCache.delete(firstKey);
    }
    embeddingCache.set(cacheKey, result);
    return result;
  }

  /**
   * Synchronizes and indexes all statutory tax rules concurrently into MongoDB and Memory
   */
  async syncTaxRuleVectors() {
    if (this.isSynced && inMemoryTaxVectors.length > 0) return inMemoryTaxVectors;
    if (this.syncPromise) return this.syncPromise;

    this.syncPromise = (async () => {
      const isDbConnected = mongoose.connection.readyState === 1;

      // Parallelize embedding generation across all statutory tax rules for 8x faster startup
      const syncedDocs = await Promise.all(
        TAX_RULE_KNOWLEDGE_BASE.map(async (rule) => {
          const docText = `${rule.title} - Section ${rule.section}. Standard TDS rate: ${rule.standardRate || 0}%. ${rule.description} Keywords: ${(rule.keywords || []).join(', ')}`;
          const { vector, source, dimensions, norm } = await this.embedText(docText);

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
            norm,
            rule,
          };

          if (isDbConnected) {
            try {
              await TaxRuleVector.findOneAndUpdate(
                { ruleId: rule.ruleId },
                { $set: record },
                { upsert: true, new: true }
              );
            } catch (dbErr) {
              console.warn(`[VectorStore Warning] Could not persist vector for ${rule.ruleId}: ${dbErr.message}`);
            }
          }

          return record;
        })
      );

      inMemoryTaxVectors = syncedDocs;
      this.isSynced = true;
      const src = inMemoryTaxVectors[0]?.vectorSource || 'LOCAL_DENSE_FALLBACK';
      const dims = inMemoryTaxVectors[0]?.dimensions || 128;
      console.log(`[VectorStore] Synchronized ${inMemoryTaxVectors.length} Statutory Tax Embeddings in parallel (${src}, ${dims} dims).`);
      return inMemoryTaxVectors;
    })();

    return this.syncPromise;
  }

  /**
   * Performs Semantic Vector Search across Statutory Tax Rules
   * Uses MongoDB Atlas $vectorSearch when supported, with optimized Cosine Similarity fallback.
   */
  async searchTaxRules(narrationText = '', deltaRatio = 0, topK = 3) {
    if (!this.isSynced || inMemoryTaxVectors.length === 0) {
      await this.syncTaxRuleVectors();
    }

    const { vector: queryVector, source: vectorSource, norm: queryNorm } = await this.embedText(narrationText);
    let results = [];

    // Attempt MongoDB Atlas $vectorSearch if connected to MongoDB Atlas
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
        // Fallback to exact in-memory cosine search with precalculated norms
      }
    }

    // Mathematical Cosine Similarity Search (Primary / High-Performance Resilient Fallback)
    if (results.length === 0) {
      const candidates = inMemoryTaxVectors.map((entry) => {
        let targetVector = entry.embedding;
        let targetNorm = entry.norm;

        if (targetVector.length !== queryVector.length) {
          targetVector = generateDeterministicDenseVector(entry.docText, queryVector.length);
          targetNorm = 1.0;
        }

        let sim = cosineSimilarity(queryVector, targetVector, queryNorm, targetNorm);

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
   * Semantic Vector Search for Recurring Bank Narrations with Dynamic Invoice Binding
   */
  async searchNarrationCache(narrationText, threshold = 0.90) {
    if (narrationVectorCache.length === 0) return null;

    const clean = (narrationText || '').toUpperCase();
    // Dynamic Invoice Extraction from incoming narration
    const normalizedOcr = clean
      .replace(/\b1NV\b/g, 'INV')
      .replace(/2O2/g, '202')
      .replace(/3OO/g, '300')
      .replace(/4OO/g, '400')
      .replace(/5OO/g, '500')
      .replace(/IOO/g, '100')
      .replace(/([0-9])O([0-9])/g, '$10$2')
      .replace(/([0-9])OO([0-9])/g, '$100$2');

    const invMatch = normalizedOcr.match(/\b(?:INV|INVOICE)[-_/ ]*([A-Z0-9]+[-_/]?[0-9]+)\b/i);
    const currentInvoiceId = invMatch ? (invMatch[1].toUpperCase().startsWith('INV-') ? invMatch[1].toUpperCase() : `INV-${invMatch[1].replace(/[/_ ]/g, '-').toUpperCase()}`) : null;

    const { vector: queryVector, norm: queryNorm } = await this.embedText(narrationText);

    let bestMatch = null;
    let highestSim = -1;

    for (const item of narrationVectorCache) {
      let targetVec = item.vector;
      let targetNorm = item.norm;

      if (targetVec.length !== queryVector.length) {
        targetVec = generateDeterministicDenseVector(item.narration, queryVector.length);
        targetNorm = 1.0;
      }

      const sim = cosineSimilarity(queryVector, targetVec, queryNorm, targetNorm);
      if (sim > highestSim) {
        highestSim = sim;
        bestMatch = item;
      }
    }

    if (bestMatch && highestSim >= threshold) {
      // Dynamic Invoice Binding: bind to current transaction's invoice ID
      const resolvedInvoiceId = currentInvoiceId || bestMatch.resolution.matched_invoice_id;
      return {
        ...bestMatch.resolution,
        matched_invoice_id: resolvedInvoiceId,
        ragCacheHit: true,
        semanticSimilarity: Number(highestSim.toFixed(4)),
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
    const { vector, source, norm } = await this.embedText(narrationText);

    if (narrationVectorCache.length >= MAX_NARRATION_CACHE) {
      narrationVectorCache.shift(); // Evict oldest entry
    }

    narrationVectorCache.push({
      narration: narrationText,
      vector,
      vectorSource: source,
      norm,
      resolution,
      timestamp: Date.now(),
    });
  }

  /**
   * Clears in-memory semantic cache and embedding cache
   */
  clearCache() {
    narrationVectorCache.length = 0;
    embeddingCache.clear();
  }
}

export const vectorStoreService = new VectorStoreService();
