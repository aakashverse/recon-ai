import pLimit from 'p-limit';
import levenshtein from 'fast-levenshtein';
import { getGeminiModel, isAIAvailable } from '../config/ai.js';
import { AIExtractionSchema } from '../schemas/aiSchemas.js';
import { Invoice } from '../models/Invoice.js';

// Strict concurrency ceiling of 5 concurrent GenAI workers
const limit = pLimit(5);

/**
 * In-Memory RAG Resolution Cache
 * Stores normalized narration fingerprints mapped to verified AI extraction structures
 */
const ragResolutionCache = [];

/**
 * Computes a normalized structural fingerprint of a bank narration
 * Strips transient IDs, dates, and amounts while preserving vendor entities and deduction keywords
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
    // Strip invoice numbers with digits
    .replace(/\b[A-Z]{2,5}[-_]?\d+(?:[-_]\d+)?\b/g, '<INV_NUM>')
    // Strip raw numeric amounts
    .replace(/\b\d+(?:\.\d{1,2})?\b/g, '<NUM>')
    // Normalize delimiters
    .replace(/[\s/|_-]+/g, ' ')
    .trim();
}

/**
 * Checks the RAG Cache for a sufficiently similar historical resolution
 */
export function checkRAGCache(narration) {
  const currentFp = computeNarrationFingerprint(narration);
  if (!currentFp || !ragResolutionCache.length) return null;

  let bestMatch = null;
  let highestSimilarity = 0;

  for (const entry of ragResolutionCache) {
    const maxLen = Math.max(currentFp.length, entry.fingerprint.length);
    if (maxLen === 0) continue;

    const distance = levenshtein.get(currentFp, entry.fingerprint);
    const similarity = 1 - distance / maxLen;

    if (similarity > highestSimilarity && similarity >= 0.80) {
      highestSimilarity = similarity;
      bestMatch = {
        ...entry.resolution,
        ragCacheHit: true,
        similarityScore: Number(similarity.toFixed(3)),
      };
    }
  }

  return bestMatch;
}

/**
 * Stores a verified resolution in the RAG Cache
 */
export function storeRAGCache(narration, resolution) {
  const fingerprint = computeNarrationFingerprint(narration);
  if (!fingerprint || !resolution) return;

  const existingIdx = ragResolutionCache.findIndex((e) => e.fingerprint === fingerprint);
  if (existingIdx >= 0) {
    ragResolutionCache[existingIdx].resolution = resolution;
    ragResolutionCache[existingIdx].updatedAt = new Date();
  } else {
    ragResolutionCache.push({
      fingerprint,
      resolution,
      createdAt: new Date(),
    });
    if (ragResolutionCache.length > 200) {
      ragResolutionCache.shift();
    }
  }
}

/**
 * Generalized local heuristic entity extractor (zero hardcoded vendor names)
 */
function localIntelligentExtraction(narration, bankAmount, context = {}) {
  const text = (narration || '').toUpperCase();
  const candidateInvoiceNumbers = [];
  let vendorName = null;
  let claimedTdsRate = null;
  let claimedTdsSection = null;
  let claimedBankCharges = 0;
  let claimedDiscount = 0;

  // Generalized OCR typo normalization: fixes '1NV' -> 'INV', letter 'O' -> '0' and 'I' -> '1' inside numeric parts
  let normalizedText = text
    .replace(/\b[1I]NV[-_ /]*/gi, 'INV-')
    .replace(/\b([A-Z]{2,5})[-_ ]*([0-9O]{4})[-_ ]*([0-9OIA-Z]+)\b/gi, (match, p1, p2, p3) => {
      const fixedYear = p2.replace(/O/g, '0');
      const fixedNum = p3.replace(/O/g, '0').replace(/I/g, '1');
      return `${p1}-${fixedYear}-${fixedNum}`;
    })
    .replace(/1O-PERCENT|1O PERCENT|1O%|IO-PERCENT|IO PERCENT|IO%/gi, '10%');

  // Extract Invoice pattern: e.g. INV-2024-1004, BILL-99238, INV-1004, TAX-2026-01
  const invMatches = normalizedText.match(/\b(?:INV|INVOICE|BILL|TAX|RCPT)[-_/]?[0-9A-Z]{2,6}(?:[-_/][0-9A-Z]{1,6})?\b/gi);
  if (invMatches) {
    for (const m of invMatches) {
      let formatted = m.replace(/INVOICE/i, 'INV').replace(/[/_]+/g, '-').toUpperCase();
      candidateInvoiceNumbers.push(formatted);
    }
  }

  // Dynamic Vendor Identification from open database invoices
  const openInvoices = context.allInvoices || [];
  for (const inv of openInvoices) {
    if (!inv.customerName) continue;
    const cleanCustomer = inv.customerName.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const cleanText = text.replace(/[^A-Z0-9]/g, '');
    if (cleanCustomer.length >= 4 && cleanText.includes(cleanCustomer)) {
      vendorName = inv.customerName;
      break;
    }
  }

  // Extract Statutory TDS Rate patterns dynamically
  if (normalizedText.includes('206AB') || normalizedText.includes('20%') || normalizedText.includes('20PCT') || normalizedText.includes('20 PERCENT')) {
    claimedTdsRate = 20;
    claimedTdsSection = '206AB';
  } else if (normalizedText.includes('194Q') || normalizedText.includes('0.1%') || normalizedText.includes('0.1PCT')) {
    claimedTdsRate = 0.1;
    claimedTdsSection = '194Q';
  } else if (normalizedText.includes('194J') || normalizedText.includes('10%') || normalizedText.includes('10PCT') || normalizedText.includes('10 PERCENT') || normalizedText.includes('194I')) {
    claimedTdsRate = 10;
    claimedTdsSection = '194J';
  } else if (normalizedText.includes('194C') || normalizedText.includes('2%') || normalizedText.includes('2PCT') || normalizedText.includes('2 PERCENT')) {
    claimedTdsRate = 2;
    claimedTdsSection = '194C';
  } else if (normalizedText.includes('1%') || normalizedText.includes('1PCT') || normalizedText.includes('1 PERCENT')) {
    claimedTdsRate = 1;
    claimedTdsSection = '194C';
  } else if (normalizedText.includes('5%') || normalizedText.includes('5PCT') || normalizedText.includes('194H')) {
    claimedTdsRate = 5;
    claimedTdsSection = '194H';
  }

  // Extract bank charges or fee deductions: "FEE-500", "CHG 100", "DISC 250"
  const feeMatch = text.match(/(?:FEE|CHG|CHARGE|COMM)[^\d]*(\d+(?:\.\d+)?)/i);
  if (feeMatch) {
    claimedBankCharges = parseFloat(feeMatch[1]);
  }

  const discMatch = text.match(/(?:DISC|DISCOUNT|REBATE)[^\d]*(\d+(?:\.\d+)?)/i);
  if (discMatch) {
    claimedDiscount = parseFloat(discMatch[1]);
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

  // 3. Real Gemini API Call (if available)
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
      const parsedJson = JSON.parse(responseText);
      const validated = AIExtractionSchema.parse(parsedJson);

      storeRAGCache(narration, validated);
      return {
        ...validated,
        ragCacheHit: false,
      };
    } catch (err) {
      console.warn('[GenAI Pool] Gemini call failed, falling back to local extractor:', err.message);
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
 * Tier 4: Concurrency-Controlled GenAI & Vision Worker Pool with RAG Cache-First
 * - Bounded by p-limit(5)
 * - Evaluates RAG cache before every LLM call
 * - Returns candidate invoice, extracted deduction tokens, and execution timing
 */
export async function matchTier4(bankTxn, options = {}, context = {}) {
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
      if (context.allInvoices) {
        const vClean = aiResult.vendorName.toUpperCase().replace(/[^A-Z0-9]/g, '');
        candidateInvoices = context.allInvoices.filter((inv) => {
          if (inv.status === 'PAID') return false;
          const cClean = (inv.customerName || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
          return cClean.includes(vClean) || vClean.includes(cClean);
        }).slice(0, 5);
      } else {
        candidateInvoices = await Invoice.find({
          customerName: { $regex: new RegExp(aiResult.vendorName, 'i') },
          status: { $in: ['UNPAID', 'PARTIALLY_PAID'] },
        }).limit(5).lean();
      }
    }

    if (!candidateInvoices.length) {
      if (context.allInvoices) {
        candidateInvoices = context.allInvoices
          .filter((inv) => inv.status !== 'PAID' && inv.totalAmount >= bankAmount * 0.8 && inv.totalAmount <= bankAmount * 1.5)
          .slice(0, 5);
      } else {
        candidateInvoices = await Invoice.find({
          status: { $in: ['UNPAID', 'PARTIALLY_PAID'] },
          totalAmount: { $gte: bankAmount * 0.8, $lte: bankAmount * 1.5 },
        }).limit(5).lean();
      }
    }

    // 3. For each candidate invoice, evaluate arithmetic with extracted TDS and charges
    for (const invoice of candidateInvoices) {
      const gross = Number(invoice.totalAmount);
      const base = Number(invoice.baseAmount || (gross / 1.18).toFixed(2));
      let tdsRate = aiResult.claimedTdsRate !== null ? aiResult.claimedTdsRate : (invoice.expectedTdsRate || 0);
      let tdsSection = aiResult.claimedTdsSection || invoice.expectedTdsSection || '194C';

      let calculatedTds = (gross * tdsRate) / 100;
      let calculatedTdsBase = (base * tdsRate) / 100;
      let bankCharges = aiResult.claimedBankCharges || 0;
      let discount = aiResult.claimedDiscount || 0;

      let totalDeductions = calculatedTds + bankCharges + discount;
      let calculatedNet = gross - totalDeductions;

      // Check Gross TDS match
      if (Math.abs(calculatedNet - bankAmount) < 0.50) {
        const durationMs = performance.now() - startTime;
        return {
          matched: true,
          tier: 'TIER_4',
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
          tier: 'TIER_4',
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
      tier: 'TIER_4',
      invoice: candidateInvoices.length > 0 ? candidateInvoices[0] : null,
      aiExtraction: aiResult,
      ragCacheHit,
      confidence: 0.35,
      durationMs,
      reason: aiResult.reasoningSummary || 'GenAI worker pool could not ground extracted entities to an open ledger invoice with zero-trust math precision.',
    };
  });
}
