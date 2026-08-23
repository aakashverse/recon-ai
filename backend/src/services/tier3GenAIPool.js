import pLimit from 'p-limit';
import { getGeminiModel, isAIAvailable } from '../config/ai.js';
import { AIExtractionSchema } from '../schemas/aiSchemas.js';
import { Invoice } from '../models/Invoice.js';

// Strict concurrency ceiling of 5 concurrent GenAI workers
const limit = pLimit(5);

/**
 * Intelligent local heuristic parser for offline/resilient execution
 * Extracts invoice tokens, vendor names, TDS rates, and bank charges from messy narrations
 */
function localIntelligentExtraction(narration, bankAmount) {
  const text = (narration || '').toUpperCase();
  const candidateInvoiceNumbers = [];
  let vendorName = null;
  let claimedTdsRate = null;
  let claimedTdsSection = null;
  let claimedBankCharges = 0;
  let claimedDiscount = 0;

  // Typo normalization for OCR (e.g. 2O24 -> 2024, IOOI -> 1001)
  const normalizedText = text
    .replace(/\b([A-Z]{3,4})[-_](2O2[0-9])[-_]([A-Z0-9]+)\b/gi, (match, p1, p2, p3) => {
      const fixedYear = p2.replace(/O/g, '0');
      const fixedNum = p3.replace(/O/g, '0').replace(/I/g, '1');
      return `${p1}-${fixedYear}-${fixedNum}`;
    });

  // Extract Invoice pattern: e.g. INV-2024-001, INVOICE-99238, INV1002
  const invMatches = normalizedText.match(/(?:INV|INVOICE)[-_]?\d{3,}(?:-\d+)?/gi);
  if (invMatches) {
    for (const m of invMatches) {
      // Normalize to INV-YYYY-XXX format
      let formatted = m.replace(/INVOICE/i, 'INV').replace(/[-_]+/g, '-').toUpperCase();
      if (!formatted.includes('-')) {
        formatted = formatted.replace(/INV/i, 'INV-');
      }
      candidateInvoiceNumbers.push(formatted);
    }
  }

  // Extract Vendor Tokens
  const vendorKeywords = [
    'INFOSYS', 'TCS', 'WIPRO', 'SWIGGY', 'ZOMATO', 'AMAZON', 'FLIPKART',
    'RELIANCE', 'TATA', 'ACME', 'PAYTM', 'RAZORPAY', 'HDFC', 'ICICI',
    'HEXAWAVE', 'DELTA', 'URBANSTALLION', 'OMNISECURE', 'PIXELCRAFT', 'ZENITH',
    'QUICKKART', 'AERODYNAMICS', 'GREENLEAF', 'SUMMIT', 'TITAN'
  ];
  for (const v of vendorKeywords) {
    if (text.includes(v)) {
      vendorName = v;
      break;
    }
  }

  // Extract TDS Rate patterns: e.g. "TDS 2%", "10% TDS", "TDS-194C-2PCT", "LESS-TDS-10", "206AB"
  if (text.includes('206AB') || text.includes('20%') || text.includes('20PCT') || text.includes('20 PERCENT')) {
    claimedTdsRate = 20;
    claimedTdsSection = '206AB';
  } else if (text.includes('194Q') || text.includes('0.1%') || text.includes('0.1PCT')) {
    claimedTdsRate = 0.1;
    claimedTdsSection = '194Q';
  } else if (text.includes('194J') || text.includes('10%') || text.includes('10PCT') || text.includes('10 PERCENT') || text.includes('194I')) {
    claimedTdsRate = 10;
    claimedTdsSection = '194J';
  } else if (text.includes('194C') || text.includes('2%') || text.includes('2PCT') || text.includes('2 PERCENT')) {
    claimedTdsRate = 2;
    claimedTdsSection = '194C';
  } else if (text.includes('1%') || text.includes('1PCT') || text.includes('1 PERCENT')) {
    claimedTdsRate = 1;
    claimedTdsSection = '194C';
  } else if (text.includes('5%') || text.includes('5PCT') || text.includes('194H')) {
    claimedTdsRate = 5;
    claimedTdsSection = '194H';
  }

  // Extract bank charge or fee deductions: "FEE-500", "CHG 100", "DISC 250"
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
    claimedTdsAmount: null, // to be calculated deterministically against candidate invoice
    claimedBankCharges,
    claimedDiscount,
    netPaymentAmount: bankAmount,
    confidenceScore: candidateInvoiceNumbers.length > 0 ? 0.92 : 0.78,
    reasoningSummary: `Extracted tokens via intelligent heuristic analyzer. Vendor: ${vendorName || 'Unknown'}, Invoices: [${candidateInvoiceNumbers.join(', ')}], Claimed TDS: ${claimedTdsRate ? claimedTdsRate + '%' : 'None'}.`,
    extractedTokens: { rawTokens: text.split(/[\s/|-]+/).filter(Boolean) },
  };
}

/**
 * Executes GenAI Structured Parsing using Gemini or intelligent local heuristic fallback
 */
async function executeGenAIWorker(bankTxn) {
  const model = getGeminiModel();
  const bankAmount = Number(bankTxn.amount);
  const narration = bankTxn.narration || '';

  if (isAIAvailable() && model) {
    try {
      const prompt = `You are Razorpay's specialized B2B Banking & Recon AI Controller.
Analyze the following bank transaction narration and extract structured payment reconciliation tokens.
Transaction Amount: ₹${bankAmount}
Narration: "${narration}"
Attachment/Receipt: ${bankTxn.attachmentUrl || 'None'}

Return a JSON object conforming strictly to this structure:
{
  "candidateInvoiceNumbers": string[],
  "vendorName": string or null,
  "claimedTdsRate": number or null (e.g. 1.0, 2.0, 10.0),
  "claimedTdsAmount": number or null,
  "claimedTdsSection": string or null (e.g. "194C", "194J", "194H"),
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
      return validated;
    } catch (err) {
      console.warn(`[Tier 3 GenAI] Gemini API error, failing over to resilient heuristic parser:`, err.message);
    }
  }

  // Resilient Heuristic Fallback
  const extracted = localIntelligentExtraction(narration, bankAmount);
  return AIExtractionSchema.parse(extracted);
}

/**
 * Tier 3: Concurrency-Controlled GenAI & Vision Worker Pool
 * - Bounded by p-limit(5)
 * - Returns candidate invoice, extracted deduction tokens, and execution timing
 */
export async function matchTier3(bankTxn) {
  return limit(async () => {
    const startTime = performance.now();
    const bankAmount = Number(bankTxn.amount);

    const aiResult = await executeGenAIWorker(bankTxn);

    // 1. Locate candidate invoices matching extracted invoice numbers
    let candidateInvoices = [];
    if (aiResult.candidateInvoiceNumbers.length > 0) {
      candidateInvoices = await Invoice.find({
        invoiceNumber: { $in: aiResult.candidateInvoiceNumbers },
        status: { $in: ['UNPAID', 'PARTIALLY_PAID'] },
      }).lean();
    }

    // 2. Fallback search by vendor name if no invoice number matched
    if (!candidateInvoices.length && aiResult.vendorName) {
      candidateInvoices = await Invoice.find({
        customerName: { $regex: new RegExp(aiResult.vendorName, 'i') },
        status: { $in: ['UNPAID', 'PARTIALLY_PAID'] },
      }).limit(5).lean();
    }

    if (!candidateInvoices.length) {
      // Also try broad search for unpaid invoices with matching gross range
      candidateInvoices = await Invoice.find({
        status: { $in: ['UNPAID', 'PARTIALLY_PAID'] },
        totalAmount: { $gte: bankAmount, $lte: bankAmount * 1.25 },
      }).limit(5).lean();
    }

    // 3. For each candidate invoice, evaluate arithmetic with extracted TDS and charges
    for (const invoice of candidateInvoices) {
      const gross = Number(invoice.totalAmount);
      let tdsRate = aiResult.claimedTdsRate !== null ? aiResult.claimedTdsRate : (invoice.expectedTdsRate || 0);
      let tdsSection = aiResult.claimedTdsSection || invoice.expectedTdsSection || '194C';

      let calculatedTds = (gross * tdsRate) / 100;
      let bankCharges = aiResult.claimedBankCharges || 0;
      let discount = aiResult.claimedDiscount || 0;
      let totalDeductions = calculatedTds + bankCharges + discount;
      let calculatedNet = gross - totalDeductions;

      // Check if arithmetic is close to bank amount
      if (Math.abs(calculatedNet - bankAmount) < 0.1) {
        const durationMs = performance.now() - startTime;
        return {
          matched: true,
          tier: 'TIER_3',
          invoice,
          aiExtraction: aiResult,
          confidence: aiResult.confidenceScore || 0.88,
          deductions: {
            tdsAmount: Number(calculatedTds.toFixed(2)),
            tdsRate,
            tdsSection,
            bankCharges: Number(bankCharges.toFixed(2)),
            discount: Number(discount.toFixed(2)),
            totalDeductions: Number(totalDeductions.toFixed(2)),
          },
          durationMs,
          matchType: 'GENAI_EXTRACTED_AND_VALIDATED',
        };
      }
    }

    // If candidate found but math has a discrepancy, return candidate for Circuit Breaker inspection
    if (candidateInvoices.length > 0) {
      const primaryCandidate = candidateInvoices[0];
      const gross = Number(primaryCandidate.totalAmount);
      let tdsRate = aiResult.claimedTdsRate || primaryCandidate.expectedTdsRate || 2;
      let calculatedTds = (gross * tdsRate) / 100;

      const durationMs = performance.now() - startTime;
      return {
        matched: false,
        potentialInvoice: primaryCandidate,
        aiExtraction: aiResult,
        confidence: aiResult.confidenceScore || 0.65,
        deductions: {
          tdsAmount: Number(calculatedTds.toFixed(2)),
          tdsRate,
          tdsSection: aiResult.claimedTdsSection || '194C',
          bankCharges: aiResult.claimedBankCharges || 0,
          discount: aiResult.claimedDiscount || 0,
          totalDeductions: Number(calculatedTds.toFixed(2)) + (aiResult.claimedBankCharges || 0),
        },
        durationMs,
        reason: 'Candidate invoice identified, but mathematical discrepancy requires Circuit Breaker / Human Outbox.',
      };
    }

    const durationMs = performance.now() - startTime;
    return {
      matched: false,
      aiExtraction: aiResult,
      confidence: 0.3,
      durationMs,
      reason: 'No matching unpaid invoice found for extracted tokens.',
    };
  });
}
