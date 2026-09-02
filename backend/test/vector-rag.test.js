import test from 'node:test';
import assert from 'node:assert/strict';
import { cosineSimilarity, generateDeterministicDenseVector, vectorStoreService } from '../src/services/vectorStoreService.js';
import { TaxRuleVector } from '../src/models/TaxRuleVector.js';

test('Vector RAG: cosineSimilarity returns 1.0 for identical vectors', () => {
  const vecA = [0.6, 0.8];
  const vecB = [0.6, 0.8];
  const score = cosineSimilarity(vecA, vecB);
  assert.equal(score, 1.0);
});

test('Vector RAG: cosineSimilarity returns 0.0 for orthogonal vectors', () => {
  const vecA = [1.0, 0.0];
  const vecB = [0.0, 1.0];
  const score = cosineSimilarity(vecA, vecB);
  assert.equal(score, 0.0);
});

test('Vector RAG: cosineSimilarity safely handles empty vectors', () => {
  assert.equal(cosineSimilarity([], []), 0);
  assert.equal(cosineSimilarity(null, [1, 2]), 0);
});

test('Vector RAG: dense vectorizer generates normalized non-zero vectors', () => {
  const vec = generateDeterministicDenseVector('TDS deduction under section 194J on legal consultancy');
  assert.equal(vec.length, 128);
  let norm = 0;
  for (const val of vec) norm += val * val;
  assert.ok(Math.abs(Math.sqrt(norm) - 1.0) < 0.01, 'Vector should be L2 normalized');
});

test('Vector RAG: Semantically retrieves Section 194J for professional/consulting narrations', async () => {
  const results = await vectorStoreService.searchTaxRules('NEFT/TECHCORP/CONSULTING-RETAINER-AND-LEGAL-FEES', 0.10, 3);
  assert.ok(results.length > 0);
  assert.equal(results[0].rule.section, '194J');
  assert.ok(results[0].cosineScore > 0.4);
});

test('Vector RAG: Semantically retrieves Section 194C for logistics/contractor narrations', async () => {
  const results = await vectorStoreService.searchTaxRules('IFT/BLUESKY-LOGISTICS/FREIGHT-TRANSPORT-CONTRACTOR', 0.02, 3);
  assert.ok(results.length > 0);
  assert.equal(results[0].rule.section, '194C');
  assert.ok(results[0].cosineScore > 0.4);
});

test('Vector RAG: Semantically retrieves Section 194H for commission/brokerage narrations', async () => {
  const results = await vectorStoreService.searchTaxRules('CMS/NOVA-INFOTECH/SALES-AGENCY-COMMISSION-BROKERAGE', 0.05, 3);
  assert.ok(results.length > 0);
  assert.equal(results[0].rule.section, '194H');
  assert.ok(results[0].cosineScore > 0.4);
});

test('Vector RAG: Semantically retrieves Section 206AB for penal non-filer narrations', async () => {
  const results = await vectorStoreService.searchTaxRules('NEFT/VENDOR-PENALTY-NON-FILER-HIGHER-WITHHOLDING', 0.20, 3);
  assert.ok(results.length > 0);
  assert.equal(results[0].rule.section, '206AB');
  assert.ok(results[0].cosineScore > 0.4);
});

test('Vector RAG: TaxRuleVector model defines required vector search attributes', () => {
  assert.ok(TaxRuleVector.schema.paths.embedding);
  assert.ok(TaxRuleVector.schema.paths.dimensions);
  assert.ok(TaxRuleVector.schema.paths.embeddingModel);
});
