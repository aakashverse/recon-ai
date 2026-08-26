import { Invoice } from '../models/Invoice.js';
import { getGeminiModel, isAIAvailable } from '../config/ai.js';
import { z } from 'zod';
import pLimit from 'p-limit';
import levenshtein from 'fast-levenshtein';

// Bounded Concurrency: Max 5 concurrent GenAI workers to protect rate limits & memory
const limit = pLimit(5);

// In-Memory RAG-Style Cache for recurring fuzzy narration patterns (<2ms resolution, $0 cost)
const ragResolutionCache = new Map();

/**
 * Zod Schema for Structured GenAI Extraction Output
 */
const AIExtractionSchema = z.object({
  candidateInvoiceNumbers: z.array(z.string()).default([]),
  vendorName: z.string().nullable().default(null),
  claimedTdsRate: z.number().nullable().default(null),
  claimedTdsSection: z.string().nullable().default(null),
  claimedTdsAmount: z.number().nullable().default(null),
  claimedBankCharges: z.number().default(0),
  claimedDiscount: z.number().default(0),
  netPaymentAmount: z.number().default(0),
  confidenceScore: z.number().min(0).max(1).default(0.5),
  reasoningSummary: z.string().default(''),
  extractedTokens: z.record(z.any()).default({}),
});

/**
 * Normalizes narrations into a structural fingerprint for fuzzy RAG caching
 */
export function computeNarrationFingerprint(narration) {
  if (!narration) return '';

  return narration
    .toUpperCase()
    // Strip specific dates (e.g. 2026-08-01, 01/08/2026)
    .replace(/\b\d{4}[-/]\d{2}[-/]\d{2}\b/g, '<DATE>')
    .replace(/\b\d{2}[-/]\d{2}[-/]\d{4}\b/g, '<DATE>')
    // Strip specific UTRs / UPI IDs
    .replace(/\b[A-Z]{4}\d{6,16}\b/g, '<UTR>')
    .replace(/\bUPI\/\d{12}\b/g, '<UPI>')
    // Strip raw numeric amounts
    .replace(/\b\d+(?:\.\d{1,2})?\b/g, '<NUM>')
    // Normalize delimiters
    .replace(/[\s/|_-]+/g, ' ')
    .trim();
}

/**
 * Checks RAG cache for recurring narration patterns
 */
function checkRAGCache(narration) {
  const currentFp = computeNarrationFingerprint(narration);
  if (!currentFp || currentFp.length < 8) return null;

  for (const [, entry] of ragResolutionCache.entries()) {
    const maxLen = Math.max(currentFp.length, entry.fingerprint.length);
    if (maxLen === 0) continue;

    const distance = levenshtein.get(currentFp, entry.fingerprint);
    const similarity = 1 - distance / maxLen;

    // Strict 92% structural similarity threshold for RAG reuse
    if (similarity >= 0.92) {
      return {
        ...entry.resolution,
        ragCacheHit: true,
        similarityScore: similarity,
      };
    }
  }

  return null;
}

/**
 * Stores verified resolution in RAG cache
 */
function storeRAGCache(narration, resolution) {
  const fp = computeNarrationFingerprint(narration);
  if (!fp || fp.length < 8) return;

  if (ragResolutionCache.size > 2000) {
    const firstKey = ragResolutionCache.keys().next().value;
    ragResolutionCache.delete(firstKey);
  }

  ragResolutionCache.set(fp, {
    fingerprint: fp,
    resolution,
    timestamp: Date.now(),
  });
}

/**
 * Resilient Entity Extraction for messy narrations & OCR typos
 */
function localIntelligentExtraction(narration, bankAmount, context = {}) {
  const text = narration.toUpperCase();

  // Normalize OCR typos
  const normalizedOcr = text
    .replace(/\b1NV\b/g, 'INV')
    .replace(/[/_-]1NV[-_]/g, '-INV-')
    .replace(/\b1NV(?=[-_0-9])/g, 'INV')
    .replace(/(?<=[-_/])1NV/g, 'INV')
    .replace(/2O2/g, '202')
    .replace(/IOO/g, '100')
    .replace(/IO-PERCENT/g, '10%')
    .replace(/1O-PERCENT/g, '10%')
    .replace(/2-PERCENT/g, '2%')
    .replace(/2PCT/g, '2%')
    .replace(/10PCT/g, '10%');

  // Extract Invoice Numbers
  const candidateInvoiceNumbers = [];
  const invoiceRegexes = [
    /\b(INV[-_]?[0-9]{4}[-_]?[0-9]+)\b/gi,
    /\b(INVOICE[-_]?[0-9]{4}[-_]?[0-9]+)\b/gi,
    /\b(INV[-_]?[0-9]+)\b/gi,
  ];

  for (const regex of invoiceRegexes) {
    const matches = normalizedOcr.matchAll(regex);
    for (const match of matches) {
      const clean = match[1].toUpperCase().replace(/INVOICE/, 'INV');
      if (!candidateInvoiceNumbers.includes(clean)) {
        candidateInvoiceNumbers.push(clean);
      }
    }
  }

  // Extract Vendor Token dynamically from open invoices
  let vendorName = null;
  if (context.allInvoices) {
    for (const inv of context.allInvoices) {
      if (!inv.customerName) continue;
      const cleanVendor = inv.customerName.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const cleanText = normalizedOcr.replace(/[^A-Z0-9]/g, '');
      if (cleanVendor.length >= 4 && (cleanText.includes(cleanVendor) || cleanVendor.includes(cleanText))) {
        vendorName = inv.customerName;
        break;
      }
    }
  }

  // Extract Claimed TDS Rate
  let claimedTdsRate = null;
  let claimedTdsSection = null;

  if (normalizedOcr.includes('194J') || normalizedOcr.includes('10%') || normalizedOcr.includes('10PCT') || normalizedOcr.includes('PROF-FEES')) {
    claimedTdsRate = 10;
    claimedTdsSection = '194J';
  } else if (normalizedOcr.includes('194C') || normalizedOcr.includes('2%') || normalizedOcr.includes('2PCT') || normalizedOcr.includes('CONTRACTOR')) {
    claimedTdsRate = 2;
    claimedTdsSection = '194C';
  } else if (normalizedOcr.includes('194Q') || normalizedOcr.includes('0.1%') || normalizedOcr.includes('0.1PCT')) {
    claimedTdsRate = 0.1;
    claimedTdsSection = '194Q';
  } else if (normalizedOcr.includes('194H') || normalizedOcr.includes('5%') || normalizedOcr.includes('5PCT')) {
    claimedTdsRate = 5;
    claimedTdsSection = '194H';
  } else if (normalizedOcr.includes('206AB') || normalizedOcr.includes('20%') || normalizedOcr.includes('20PCT')) {
    claimedTdsRate = 20;
    claimedTdsSection = '206AB';
  }

  // Extract Claimed Bank / Wire Fees
  let claimedBankCharges = 0;
  const wireMatch = normalizedOcr.match(/(?:WIRE[-_ ]?FEE|CHG|CHARGES|PG[-_ ]?FEE)[-_ :]*(\d+)/i);
  if (wireMatch) {
    claimedBankCharges = Number(wireMatch[1]) || 0;
  }

  // Extract Claimed Settlement Discount
  let claimedDiscount = 0;
  const discMatch = normalizedOcr.match(/(?:DISC|DISCOUNT|REBATE)[-_ :]*(\d+)/i);
  if (discMatch) {
    claimedDiscount = Number(discMatch[1]) || 0;
  }

  return {
    candidateInvoiceNumbers,
    vendorName,
    claimedTdsRate,
    claimedTdsSection,
    claimedTdsAmount: null,
    claimedBankCharges,
    claimedDiscount,
    netPaymentAmount: bankAmount,
    confidenceScore: candidateInvoiceNumbers.length > 0 ? 0.92 : 0.78,
    reasoningSummary: `Extracted entities from narration. Vendor: ${vendorName || 'Unresolved'}, Invoices: [${candidateInvoiceNumbers.join(', ')}], Claimed TDS: ${claimedTdsRate ? claimedTdsRate + '%' : 'None'}.`,
    extractedTokens: { rawTokens: text.split(/[\s/|-]+/).filter(Boolean) },
  };
}

/**
 * Executes GenAI worker (with RAG cache check, Gemini API call, or Mock LLM execution)
 */
async function executeGenAIWorker(bankTxn, options = {}, context = {}) {
  const narration = bankTxn.narration || '';
  const bankAmount = Number(bankTxn.amount);

  // 1. RAG-Style Cache-First Check (<2ms)
  const cachedResolution = checkRAGCache(narration);
  if (cachedResolution) {
    return {
      ...cachedResolution,
      ragCacheHit: true,
    };
  }

  // 2. Mock LLM mode (realistic simulated network latency ~180-250ms for benchmark & CI)
  if (options.mockLlm || process.env.MOCK_LLM === 'true') {
    await new Promise((r) => setTimeout(r, 180 + Math.random() * 80));
    const extracted = localIntelligentExtraction(narration, bankAmount, context);
    storeRAGCache(narration, extracted);
    return {
      ...AIExtractionSchema.parse(extracted),
      ragCacheHit: false,
    };
  }

  // 3. Live Gemini API Call (Google Gemini 1.5 Flash)
  const model = getGeminiModel();
  if (isAIAvailable() && model) {
    try {
      const prompt = `You are an expert Indian B2B Corporate Banking & Tax Accountant AI.
Analyze the following unstructured bank transaction narration and extract financial reconciliation entities.

Bank Transaction Narration: "${narration}"
Bank Received Amount: ₹${bankAmount}

Return STRICT JSON matching this schema:
{
  "candidateInvoiceNumbers": string[],
  "vendorName": string | null,
  "claimedTdsRate": number | null,
  "claimedTdsSection": "194C" | "194J" | "194H" | "194Q" | "194I" | "194A" | "206AB" | null,
  "claimedTdsAmount": number | null,
  "claimedBankCharges": number,
  "claimedDiscount": number,
  "netPaymentAmount": number,
  "confidenceScore": number (0.0 to 1.0),
  "reasoningSummary": string,
  "extractedTokens": object
}`;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      const cleanJson = responseText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsedJson = JSON.parse(cleanJson);
      const validated = AIExtractionSchema.parse(parsedJson);

      storeRAGCache(narration, validated);
      return {
        ...validated,
        ragCacheHit: false,
      };
    } catch (err) {
      console.warn('[GenAI Pool] Gemini API call error, using intelligent fallback:', err.message);
    }
  }

  // 4. Resilient Fallback Extractor
  const fallback = localIntelligentExtraction(narration, bankAmount, context);
  storeRAGCache(narration, fallback);
  return {
    ...AIExtractionSchema.parse(fallback),
    ragCacheHit: false,
  };
}

/**
 * Tier 3: Concurrency-Controlled GenAI & Vision Worker Pool with RAG Cache-First
 * - Bounded by p-limit(5)
 * - Evaluates RAG cache before every LLM call
 * - Returns candidate invoice, extracted deduction tokens, and execution timing
 */
export async function matchTier3(bankTxn, options = {}, context = {}) {
  return limit(async () => {
    const startTime = performance.now();
    const bankAmount = Number(bankTxn.amount);

    const aiResult = await executeGenAIWorker(bankTxn, options, context);
    const ragCacheHit = Boolean(aiResult.ragCacheHit);

    // 1. Locate candidate invoices matching extracted invoice numbers
    let candidateInvoices = [];
    if (aiResult.candidateInvoiceNumbers.length > 0) {
      if (context.allInvoices) {
        const patterns = aiResult.candidateInvoiceNumbers.map((n) => n.toUpperCase().replace(/[^A-Z0-9]/g, ''));
        candidateInvoices = context.allInvoices.filter((inv) => {
          if (inv.status === 'PAID') return false;
          const cleanInv = inv.invoiceNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
          return patterns.some((p) => cleanInv.includes(p) || p.includes(cleanInv));
        });
      } else {
        candidateInvoices = await Invoice.find({
          invoiceNumber: { $in: aiResult.candidateInvoiceNumbers.map((n) => new RegExp(`^${n}$`, 'i')) },
          status: { $in: ['UNPAID', 'PARTIALLY_PAID'] },
        }).lean();
      }
    }

    // 2. Fallback search by vendor name if no invoice number matched
    if (!candidateInvoices.length && aiResult.vendorName) {
      const vendorKeywords = aiResult.vendorName
        .split(/[\s,.-]+/)
        .filter((w) => w.length >= 4 && !['PVT', 'LTD', 'CORP', 'SERVICES', 'SOLUTIONS', 'ENTERPRISES', 'INDIA', 'LIMITED'].includes(w.toUpperCase()));

      const vendorQuery = vendorKeywords.length > 0
        ? { $or: vendorKeywords.map((kw) => ({ customerName: { $regex: new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') } })) }
        : { customerName: { $regex: new RegExp(aiResult.vendorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') } };

      if (context.allInvoices) {
        const vClean = aiResult.vendorName.toUpperCase().replace(/[^A-Z0-9]/g, '');
        candidateInvoices = context.allInvoices.filter((inv) => {
          if (inv.status === 'PAID') return false;
          const cClean = (inv.customerName || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (cClean.includes(vClean) || vClean.includes(cClean)) return true;
          return vendorKeywords.some((kw) => (inv.customerName || '').toUpperCase().includes(kw.toUpperCase()));
        }).slice(0, 5);
      } else {
        candidateInvoices = await Invoice.find({
          ...vendorQuery,
          status: { $in: ['UNPAID', 'PARTIALLY_PAID'] },
        }).limit(5).lean();
      }
    }

    if (!candidateInvoices.length) {
      const durationMs = performance.now() - startTime;
      return {
        matched: false,
        tier: 'TIER_3',
        aiExtraction: aiResult,
        ragCacheHit,
        confidence: 0.3,
        durationMs,
        reason: aiResult.reasoningSummary || 'No open invoices found matching GenAI extracted entities.',
      };
    }

    // 3. Zero-Trust Deductions Calculation
    for (const invoice of candidateInvoices) {
      const gross = Number(invoice.totalAmount);
      const base = Number(invoice.baseAmount || invoice.totalAmount / 1.18);
      const tdsRate = Number(aiResult.claimedTdsRate || 0);
      const tdsSection = aiResult.claimedTdsSection || 'NONE';
      const bankCharges = Number(aiResult.claimedBankCharges || 0);
      const discount = Number(aiResult.claimedDiscount || 0);

      const calculatedTds = (gross * tdsRate) / 100;
      const calculatedTdsBase = (base * tdsRate) / 100;
      const totalDeductions = calculatedTds + bankCharges + discount;
      const calculatedNet = gross - totalDeductions;

      // Check Gross TDS match
      if (Math.abs(calculatedNet - bankAmount) < 0.50) {
        const durationMs = performance.now() - startTime;
        return {
          matched: true,
          tier: 'TIER_3',
          invoice,
          aiExtraction: aiResult,
          ragCacheHit,
          confidence: ragCacheHit ? 0.92 : (aiResult.confidenceScore ? Math.min(aiResult.confidenceScore, 0.86) : 0.83),
          deductions: {
            tdsAmount: Number(calculatedTds.toFixed(2)),
            tdsRate,
            tdsSection,
            bankCharges: Number(bankCharges.toFixed(2)),
            discount: Number(discount.toFixed(2)),
            gstRounding: Number((calculatedNet - bankAmount).toFixed(2)),
            totalDeductions: Number(totalDeductions.toFixed(2)),
          },
          durationMs,
          matchType: ragCacheHit ? 'GENAI_RAG_CACHE_REUSE' : 'GENAI_LLM_POOL_RESOLUTION',
        };
      }

      // Check Base TDS match (CBDT Circ 23/2017)
      let totalDeductionsBase = calculatedTdsBase + bankCharges + discount;
      let calculatedNetBase = gross - totalDeductionsBase;
      if (Math.abs(calculatedNetBase - bankAmount) < 0.50) {
        const durationMs = performance.now() - startTime;
        return {
          matched: true,
          tier: 'TIER_3',
          invoice,
          aiExtraction: aiResult,
          ragCacheHit,
          confidence: ragCacheHit ? 0.92 : (aiResult.confidenceScore ? Math.min(aiResult.confidenceScore, 0.86) : 0.83),
          deductions: {
            tdsAmount: Number(calculatedTdsBase.toFixed(2)),
            tdsRate,
            tdsSection: `${tdsSection}_BASE_CBDT_23`,
            bankCharges: Number(bankCharges.toFixed(2)),
            discount: Number(discount.toFixed(2)),
            gstRounding: Number((calculatedNetBase - bankAmount).toFixed(2)),
            totalDeductions: Number(totalDeductionsBase.toFixed(2)),
          },
          durationMs,
          matchType: ragCacheHit ? 'GENAI_RAG_CACHE_REUSE' : 'GENAI_LLM_POOL_RESOLUTION_BASE_TDS',
        };
      }
    }

    const durationMs = performance.now() - startTime;
    return {
      matched: false,
      tier: 'TIER_3',
      invoice: candidateInvoices.length > 0 ? candidateInvoices[0] : null,
      aiExtraction: aiResult,
      ragCacheHit,
      confidence: 0.35,
      durationMs,
      reason: aiResult.reasoningSummary || 'GenAI worker pool could not ground extracted entities to an open ledger invoice with zero-trust math precision.',
    };
  });
}
