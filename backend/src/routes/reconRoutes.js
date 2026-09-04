import express from 'express';
import { sseManager } from '../utils/sseManager.js';
import { ReconciliationEngine, resetChainPointer } from '../services/reconciliationEngine.js';
import { OutboxService } from '../services/outboxService.js';
import { BankLedger } from '../models/BankLedger.js';
import { Invoice } from '../models/Invoice.js';
import { ReconciliationEvent } from '../models/ReconciliationEvent.js';
import { RuleCache } from '../models/RuleCache.js';
import { JournalEntry } from '../models/JournalEntry.js';
import multer from 'multer';
import { getApiKeyStatus, initGemini, getGeminiModel, getTextGenModel, getGenAI, getActiveModelName, isAIAvailable } from '../config/ai.js';
import { parseCSV, normalizeBankStatementRows, normalizeInvoiceRows } from '../utils/csvParser.js';
import { runSettlementAgent } from '../services/settlementAgent.js';
import { JournalService } from '../services/journalService.js';
import { calculateEventHash, GENESIS_HASH } from '../utils/hasher.js';
import { clearRAGCache } from '../services/tier3GenAIPool.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export const reconRouter = express.Router();

/**
 * Download Sample CSV Template for Invoices
 */
reconRouter.get('/template-invoices', (req, res) => {
  const csv = `Invoice Number,Customer Name,Total Amount,Base Amount,Tax Amount,TDS Section,TDS Rate
INV-2024-8001,Reliance Retail Ltd,100000,84745.76,15254.24,194C,2
INV-2024-8002,Tata Digital Services,250000,211864.41,38135.59,194J,10
INV-2024-8003,Swiggy Bundl Technologies,75000,63559.32,11440.68,194C,1`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="invoices_template.csv"');
  return res.send(csv);
});

/**
 * Download Sample CSV Template for Bank Statement Feeds
 */
reconRouter.get('/template-bank-feed', (req, res) => {
  const csv = `Date,Narration,Credit,UTR
2026-08-23,NEFT-RELIANCE-RETAIL-INV-2024-8001-LESS-2PCT-TDS,98000,AXISN88990011
2026-08-23,RTGS-TATA-DIGITAL-INV-2024-8002-PROF-FEE-194J,225000,HDFCN99002233
2026-08-23,IMPS/SWIGGY/INV-2024-8003/SETTLEMENT,74250,ICICIN11223344`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="bank_statement_template.csv"');
  return res.send(csv);
});

/**
 * Ingest Real Invoices (CSV Text or JSON Array)
 */
reconRouter.post('/import-invoices', async (req, res) => {
  try {
    let invoices = [];
    if (typeof req.body === 'string' || req.body.csvText) {
      const csvText = typeof req.body === 'string' ? req.body : req.body.csvText;
      const rawRows = parseCSV(csvText);
      invoices = normalizeInvoiceRows(rawRows);
    } else if (Array.isArray(req.body.invoices)) {
      invoices = normalizeInvoiceRows(req.body.invoices);
    } else if (Array.isArray(req.body.records)) {
      invoices = normalizeInvoiceRows(req.body.records);
    } else if (Array.isArray(req.body)) {
      invoices = normalizeInvoiceRows(req.body);
    }

    if (!invoices.length) {
      return res.status(400).json({ error: 'No valid invoice rows found in payload.' });
    }

    // Bulk upsert into master database
    const bulkOps = invoices.map((inv) => ({
      updateOne: {
        filter: { invoiceNumber: inv.invoiceNumber },
        update: { $set: inv },
        upsert: true,
      },
    }));

    await Invoice.bulkWrite(bulkOps);

    return res.json({
      success: true,
      message: `Successfully imported & synced ${invoices.length} real enterprise invoices into master database.`,
      count: invoices.length,
      sample: invoices.slice(0, 3),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Ingest Real Bank Statement (CSV Text or JSON) & Run Cascaded Engine
 */
reconRouter.post('/import-bank-feed', async (req, res) => {
  try {
    let rawRows = [];
    let txns = [];

    if (typeof req.body === 'string' || req.body.csvText) {
      const csvText = typeof req.body === 'string' ? req.body : req.body.csvText;
      rawRows = parseCSV(csvText);
      txns = normalizeBankStatementRows(rawRows);
    } else if (Array.isArray(req.body.transactions)) {
      txns = normalizeBankStatementRows(req.body.transactions);
      rawRows = req.body.transactions;
    } else if (Array.isArray(req.body.records)) {
      txns = normalizeBankStatementRows(req.body.records);
      rawRows = req.body.records;
    } else if (Array.isArray(req.body)) {
      txns = normalizeBankStatementRows(req.body);
      rawRows = req.body;
    }

    if (!txns.length) {
      return res.status(400).json({ error: 'No valid bank transactions found in payload.' });
    }

    // If the uploaded data contains paired invoice fields (e.g. Combined Recon Sheet), auto-upsert Invoices first!
    const invoices = normalizeInvoiceRows(rawRows);
    if (invoices.length > 0) {
      const invoiceBulkOps = invoices.map((inv) => ({
        updateOne: {
          filter: { invoiceNumber: inv.invoiceNumber },
          update: { $set: inv },
          upsert: true,
        },
      }));
      await Invoice.bulkWrite(invoiceBulkOps).catch((e) => {
        console.warn('[Auto-Invoice Sync] Bulk write warning:', e.message);
      });
    }

    // Ensure any invoices referenced in the incoming bank feed are present and set to UNPAID
    const referencedInvoices = [];
    for (const t of txns) {
      const match = (t.narration || '').replace(/\b1NV\b/gi, 'INV').match(/\b(?:INV|INVOICE)[-_/ ]*([A-Z0-9]+[-_/]?[0-9]+)\b/i);
      if (match) {
        const invNum = match[1].toUpperCase().startsWith('INV-') ? match[1].toUpperCase() : `INV-${match[1].replace(/[/_ ]/g, '-').toUpperCase()}`;
        referencedInvoices.push(invNum);
      }
    }
    if (referencedInvoices.length > 0) {
      // 1. Reset any existing paid invoices to UNPAID for this fresh run
      await Invoice.updateMany(
        { invoiceNumber: { $in: referencedInvoices } },
        { $set: { status: 'UNPAID', paidAmount: 0, reconciledBankTxnId: null, reconciledAt: null, reconMethod: null } }
      ).catch(() => {});

      // 2. If any referenced Kaggle invoices are missing from DB, auto-seed them from datasets
      try {
        const existingInvs = await Invoice.find({ invoiceNumber: { $in: referencedInvoices } }, 'invoiceNumber').lean();
        const existingSet = new Set(existingInvs.map(i => i.invoiceNumber));
        const missing = referencedInvoices.filter(id => !existingSet.has(id));

        if (missing.length > 0) {
          const fs = await import('fs');
          const path = await import('path');
          const { fileURLToPath } = await import('url');
          const __filename = fileURLToPath(import.meta.url);
          const __dirname = path.dirname(__filename);
          const kaggleJsonPath = path.resolve(__dirname, '../../../datasets/kaggle-reconciliation-100.json');

          if (fs.existsSync(kaggleJsonPath)) {
            const kaggleData = JSON.parse(fs.readFileSync(kaggleJsonPath, 'utf8'));
            const missingToInsert = kaggleData.invoices
              .filter(inv => missing.includes(inv.invoiceNumber))
              .map(inv => ({ ...inv, status: 'UNPAID', paidAmount: 0, reconciledBankTxnId: null, reconciledAt: null }));
            if (missingToInsert.length > 0) {
              await Invoice.insertMany(missingToInsert, { ordered: false }).catch(() => {});
            }
          }
        }
      } catch (err) {
        console.warn('[Auto-Invoice Ingest] Warning seeding missing invoices:', err.message);
      }
    }

    const batchId = `REAL-FEED-${Date.now()}`;
    
    // Process in background and stream results over SSE
    ReconciliationEngine.processBatch(txns, batchId).catch((err) => {
      console.error('[Real Batch Error]:', err);
    });

    return res.status(202).json({
      success: true,
      message: `Accepted ${txns.length} real bank feed transactions (auto-synced ${invoices.length} invoices). Streaming live reconciliation events over SSE.`,
      batchId,
      totalCount: txns.length,
      sample: txns.slice(0, 3),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * One-Click Kaggle Accounting Benchmark Loader
 * Seeds all 100 Kaggle invoices as UNPAID and processes the Kaggle bank feed
 */
reconRouter.post('/load-kaggle-benchmark', async (req, res) => {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const kaggleJsonPath = path.resolve(__dirname, '../../../datasets/kaggle-reconciliation-100.json');

    if (!fs.existsSync(kaggleJsonPath)) {
      return res.status(404).json({ error: 'Kaggle dataset file not found on server.' });
    }

    const { invoices, bankTransactions } = JSON.parse(fs.readFileSync(kaggleJsonPath, 'utf8'));

    // 1. Upsert all Kaggle invoices as UNPAID
    const invoiceBulkOps = invoices.map((inv) => ({
      updateOne: {
        filter: { invoiceNumber: inv.invoiceNumber },
        update: { $set: { ...inv, status: 'UNPAID', paidAmount: 0, reconciledBankTxnId: null, reconciledAt: null, reconMethod: null } },
        upsert: true,
      },
    }));
    await Invoice.bulkWrite(invoiceBulkOps);

    // 2. Start batch reconciliation
    const batchId = `KAGGLE-BENCHMARK-${Date.now()}`;
    ReconciliationEngine.processBatch(bankTransactions, batchId, { mockLlm: req.body.mockLlm ?? true }).catch((err) => {
      console.error('[Kaggle Benchmark Error]:', err);
    });

    return res.status(202).json({
      success: true,
      message: `Loaded ${invoices.length} Kaggle ERP invoices and started reconciling ${bankTransactions.length} bank transactions.`,
      batchId,
      totalCount: bankTransactions.length,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * AI Financial Data Structurer & Normalizer (Gemini / Zod)
 * Converts messy emails, unstructured statements, and raw OCR text into canonical schema
 */
reconRouter.post('/ai-parse-and-structure', async (req, res) => {
  try {
    const { rawText, targetType } = req.body;
    if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
      return res.status(400).json({ error: 'rawText is required' });
    }

    const model = getGeminiModel() || getTextGenModel();

    if (isAIAvailable() && model) {
      try {
        const prompt = `You are Razorpay's Enterprise AI Financial Data Structurer.
Convert the following unstructured, messy financial text (which could be an email snippet, raw bank statement, check deposit log, or invoice list) into a clean, canonical JSON structure.

Target Schema: ${targetType === 'INVOICES' ? 'INVOICES' : 'BANK_TRANSACTIONS'}

If Target is BANK_TRANSACTIONS, output JSON conforming strictly to:
{
  "type": "BANK_TRANSACTIONS",
  "records": [
    {
      "bankTxnId": "TXN-AUTO-01",
      "utrNumber": "Extracted UTR/Ref or generated string",
      "amount": 98000,
      "narration": "Clean extracted narration string",
      "txnDate": "YYYY-MM-DD"
    }
  ]
}

If Target is INVOICES, output JSON conforming strictly to:
{
  "type": "INVOICES",
  "records": [
    {
      "invoiceNumber": "INV-2026-001",
      "customerName": "Extracted Customer Name",
      "totalAmount": 100000,
      "baseAmount": 84745.76,
      "taxAmount": 15254.24,
      "expectedTdsSection": "194C" | "194J" | "194H" | "194Q" | "NONE",
      "expectedTdsRate": 2.0
    }
  ]
}

SPECIAL INSTRUCTION FOR ACCOUNTING / GENERAL LEDGER / KAGGLE DATASETS (containing fields: Transaction ID, Date, Account Type, Transaction Amount, Cash Flow, Revenue, Expenditure):
- If Target is BANK_TRANSACTIONS:
  - bankTxnId: Use Transaction ID e.g. "TXN_0001"
  - utrNumber: Use Transaction ID or format as UTR
  - amount: Use positive Transaction Amount
  - narration: Format as "NEFT/CMS/[ACCOUNT_TYPE]/INV-[TRANSACTION_ID]/SETTLEMENT"
  - txnDate: Use Date
- If Target is INVOICES:
  - invoiceNumber: Format as "INV-[TRANSACTION_ID]" e.g. "INV-TXN_0001"
  - customerName: "[Account Type] Counterparty (INV-[TRANSACTION_ID])"
  - totalAmount: Use Transaction Amount or Revenue/Expenditure
  - baseAmount: totalAmount / 1.18
  - taxAmount: totalAmount - baseAmount
  - expectedTdsSection: If Expense, use "194C"; if Revenue, use "NONE"
  - expectedTdsRate: 2.0 or 0.0

RAW INPUT TEXT TO CONVERT:
"""
${rawText}
"""

Return ONLY a valid JSON object without code blocks or markdown text.`;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text().trim();
        const cleanJsonStr = responseText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
        const parsed = JSON.parse(cleanJsonStr);

        return res.json({
          success: true,
          source: 'GEMINI_AI_PARSER',
          type: parsed.type,
          records: parsed.records || [],
          message: `Successfully structured ${parsed.records?.length || 0} financial records via Gemini AI.`,
        });
      } catch (err) {
        console.warn('[AI Structurer] Gemini parse failed, falling back to local normalizer:', err.message);
      }
    }

    // High-Resilience Local Parser Fallback
    const rows = parseCSV(rawText);
    const normalized = targetType === 'INVOICES' ? normalizeInvoiceRows(rows) : normalizeBankStatementRows(rows);

    return res.json({
      success: true,
      source: 'LOCAL_HEURISTIC_PARSER',
      type: targetType,
      records: normalized,
      message: `Parsed & structured ${normalized.length} records via intelligent local parser.`,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Item 7: Multimodal PDF & Scanned-Statement Ingestion
 * Uses Gemini 1.5 Flash Vision to extract structured transaction rows from PDF / Image files
 */
reconRouter.post('/upload-multimodal-statement', upload.single('statementFile'), async (req, res) => {
  try {
    const file = req.file;
    const targetType = req.body.targetType || 'BANK_TRANSACTIONS';

    if (!file) {
      return res.status(400).json({ error: 'statementFile is required (PDF, PNG, JPG, JPEG)' });
    }

    const genAI = getGenAI();
    const activeModel = getActiveModelName();

    if (isAIAvailable() && genAI) {
      try {
        const model = genAI.getGenerativeModel({
          model: activeModel,
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1,
          },
        });

        const prompt = `You are an expert Indian B2B Banking Document OCR & Normalizer.
Extract structured table records from this uploaded bank statement document / image.

Target Schema: ${targetType === 'INVOICES' ? 'INVOICES' : 'BANK_TRANSACTIONS'}

If Target is BANK_TRANSACTIONS, output JSON conforming strictly to:
{
  "type": "BANK_TRANSACTIONS",
  "records": [
    {
      "bankTxnId": string,
      "utrNumber": string,
      "amount": number,
      "narration": string,
      "txnDate": "YYYY-MM-DD"
    }
  ]
}

If Target is INVOICES, output JSON conforming strictly to:
{
  "type": "INVOICES",
  "records": [
    {
      "invoiceNumber": string,
      "customerName": string,
      "totalAmount": number,
      "baseAmount": number,
      "taxAmount": number,
      "expectedTdsSection": "194C" | "194J" | "194H" | "194Q" | "NONE",
      "expectedTdsRate": number
    }
  ]
}

Return ONLY valid JSON matching this schema.`;

        const imagePart = {
          inlineData: {
            data: file.buffer.toString('base64'),
            mimeType: file.mimetype || 'application/pdf',
          },
        };

        const result = await model.generateContent([prompt, imagePart]);
        const responseText = result.response.text().trim();
        const cleanJsonStr = responseText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
        const parsed = JSON.parse(cleanJsonStr);

        return res.json({
          success: true,
          source: 'GEMINI_1_5_FLASH_MULTIMODAL_VISION',
          type: parsed.type,
          records: parsed.records || [],
          message: `Extracted ${parsed.records?.length || 0} structured records from ${file.originalname} via Gemini 1.5 Flash Vision.`,
        });
      } catch (err) {
        console.warn('[Multimodal OCR] Gemini Vision error, attempting local buffer parse:', err.message);
      }
    }

    // Fallback: If text content is readable from buffer, parse heuristic lines
    const textBuffer = file.buffer.toString('utf8');
    const rows = parseCSV(textBuffer);
    const normalized = targetType === 'INVOICES' ? normalizeInvoiceRows(rows) : normalizeBankStatementRows(rows);

    return res.json({
      success: true,
      source: 'LOCAL_DOCUMENT_NORMALIZER',
      type: targetType,
      records: normalized,
      message: `Extracted & normalized ${normalized.length} records from uploaded document.`,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * SSE Real-Time Event Stream Endpoint
 */
reconRouter.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders?.();

  sseManager.addClient(res);

  // Send current stats on connect
  res.write(`event: ready\ndata: ${JSON.stringify({ status: 'STREAM_CONNECTED' })}\n\n`);
});

/**
 * Trigger Batch Reconciliation (e.g. 50 Synthetic/Real B2B records)
 */
reconRouter.post('/batch', async (req, res) => {
  try {
    const transactions = req.body.transactions;
    if (!Array.isArray(transactions) || !transactions.length) {
      return res.status(400).json({ error: 'transactions array is required' });
    }

    // Run batch asynchronously while returning batchId to client immediately
    const batchId = `BATCH-${Date.now()}`;
    
    // Trigger in background and stream results over SSE
    ReconciliationEngine.processBatch(transactions, batchId).catch((err) => {
      console.error('[Batch Background Error]:', err);
    });

    return res.status(202).json({
      success: true,
      message: `Batch ${batchId} accepted for processing. Streaming live events.`,
      batchId,
      totalCount: transactions.length,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Single Transaction Reconciliation
 */
reconRouter.post('/process-single', async (req, res) => {
  try {
    const txn = req.body;
    if (!txn.amount || !txn.narration) {
      return res.status(400).json({ error: 'amount and narration are required' });
    }

    const result = await ReconciliationEngine.processTransaction(txn);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Get AI Status & Free Tier Capabilities
 */
reconRouter.get('/ai-status', (req, res) => {
  return res.json(getApiKeyStatus());
});

/**
 * Dynamically set Gemini API Key from UI without server restart
 */
reconRouter.post('/set-api-key', (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey || apiKey.trim().length < 10) {
    return res.status(400).json({ error: 'Valid Gemini API key required' });
  }
  const success = initGemini(apiKey);
  return res.json({
    success,
    status: getApiKeyStatus(),
    message: success ? 'Gemini 1.5 Flash API Key activated successfully.' : 'Failed to initialize with provided key.',
  });
});

/**
 * Generate Live Dynamic AI Dispute Reasoning & Drafts via Gemini
 */
reconRouter.post('/generate-ai-draft', async (req, res) => {
  try {
    const { bankTxnId, bankTxn: rawTxn, invoice: rawInvoice, discrepancy } = req.body;
    let bankTxn = rawTxn;
    if (!bankTxn && bankTxnId) {
      bankTxn = await BankLedger.findOne({ bankTxnId }).lean();
    }
    if (!bankTxn) {
      return res.status(404).json({ error: 'Bank transaction not found' });
    }

    let invoice = rawInvoice;
    if (!invoice && bankTxn.reconciledInvoiceId) {
      invoice = await Invoice.findById(bankTxn.reconciledInvoiceId).lean();
    }
    if (!invoice) {
      invoice = await Invoice.findOne({ status: { $in: ['UNPAID', 'PARTIALLY_PAID'] } }).lean();
    }

    const draft = await OutboxService.generateAIDrafts(bankTxn, invoice, discrepancy || bankTxn.discrepancyDetails);
    return res.json(draft);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Dispatch Notification via Relay (WhatsApp Web API / SMTP / Webhook)
 */
reconRouter.post('/dispatch-notification', async (req, res) => {
  try {
    const result = await OutboxService.dispatchNotification(req.body);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Resolve Exception & Optionally Learn Rule (Agentic Outbox)
 */
reconRouter.post('/resolve-exception', async (req, res) => {
  try {
    const result = await OutboxService.resolveException(req.body);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Confirm AI-Proposed Match (v5 Graduated Autonomy)
 * Advances Rule trust level (FIRST_TIME -> CONFIRMED_ONCE -> PROVISIONAL_AUTO -> FULLY_TRUSTED)
 * Commits invoice as PAID and appends hash-chained confirmation event.
 */
reconRouter.post('/confirm-proposal', async (req, res) => {
  try {
    const { bankTxnId, accountantNotes } = req.body;
    if (!bankTxnId) return res.status(400).json({ error: 'bankTxnId is required' });

    const bankTxn = await BankLedger.findOne({ bankTxnId });
    if (!bankTxn) return res.status(404).json({ error: 'Bank transaction not found' });

    const candidateInvoiceId = bankTxn.reconciledInvoiceId || bankTxn.proposalDetails?.proposedInvoiceId;
    const candidateInvoice = candidateInvoiceId ? await Invoice.findById(candidateInvoiceId) : null;

    if (candidateInvoice) {
      candidateInvoice.status = 'PAID';
      candidateInvoice.paidAmount = bankTxn.amount;
      candidateInvoice.reconciledBankTxnId = bankTxn._id;
      candidateInvoice.reconciledAt = new Date();
      candidateInvoice.reconMethod = 'ACCOUNTANT_CONFIRMED';
      await candidateInvoice.save();
    }

    bankTxn.reconciliationStatus = 'MATCHED';
    bankTxn.matchedTier = 'ACCOUNTANT_CONFIRMED';
    bankTxn.accountabilityStatement = 'Accountant confirmed — pattern promoted in trust hierarchy.';
    await bankTxn.save();

    // Graduate trust on any associated RuleCache rule
    let rule = null;
    if (candidateInvoice?.customerName) {
      rule = await RuleCache.findOne({ partyIdentifier: candidateInvoice.customerName.toUpperCase() });
      if (rule) {
        await rule.graduateTrust();
      }
    }

    // Post double-entry General Ledger entry
    if (candidateInvoice) {
      const journalDocData = JournalService.generateJournalEntry(bankTxn, candidateInvoice, {
        matched: true,
        deductions: bankTxn.deductionsApplied || {},
      });
      await JournalEntry.create([journalDocData]);
    }

    // Append cryptographic audit event to hash chain
    const lastEvent = await ReconciliationEvent.findOne().sort({ chainIndex: -1 }).lean();
    const previousEventHash = lastEvent?.eventHash || GENESIS_HASH;
    const chainIndex = (lastEvent?.chainIndex || 0) + 1;

    const eventHash = calculateEventHash(previousEventHash, {
      chainIndex,
      bankTxnId: bankTxn.bankTxnId,
      invoiceNumber: candidateInvoice?.invoiceNumber || 'NONE',
      resolvedTier: 'ACCOUNTANT_CONFIRMED',
      bankAmount: bankTxn.amount,
      circuitBreakerResult: { passed: true, equation: 'Accountant Sign-Off' },
      batchId: 'MANUAL_GOVERNANCE',
    });

    const confirmationEvent = await ReconciliationEvent.create({
      chainIndex,
      bankTxnId: bankTxn.bankTxnId,
      invoiceId: candidateInvoice?._id || null,
      invoiceNumber: candidateInvoice?.invoiceNumber || 'NONE',
      reconciliationStatus: 'MATCHED',
      resolvedTier: 'ACCOUNTANT_CONFIRMED',
      trustLevel: rule?.trustLevel || 'CONFIRMED_ONCE',
      accountabilityStatement: 'Accountant confirmed — pattern promoted in trust hierarchy.',
      bankAmount: bankTxn.amount,
      confidenceScore: 1.0,
      rawNarration: bankTxn.narration,
      previousEventHash,
      eventHash,
      overrideDetails: { accountantNotes, confirmedAt: new Date() },
    });

    sseManager.broadcast('txn:confirmed', {
      bankTxnId: bankTxn.bankTxnId,
      status: 'MATCHED',
      resolvedTier: 'ACCOUNTANT_CONFIRMED',
      eventHash: confirmationEvent.eventHash,
    });

    return res.json({
      success: true,
      message: 'Proposal confirmed and committed to General Ledger.',
      bankTxn,
      ruleTrustLevel: rule?.trustLevel || null,
      eventHash: confirmationEvent.eventHash,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Override/Reject AI Match (v5 Trust & Governance)
 * Downgrades Rule trust level, reverts invoice status, and records an immutable override event in the hash chain.
 */
reconRouter.post('/override-match', async (req, res) => {
  try {
    const { bankTxnId, reason, overrideInvoiceId } = req.body;
    if (!bankTxnId) return res.status(400).json({ error: 'bankTxnId is required' });

    const bankTxn = await BankLedger.findOne({ bankTxnId });
    if (!bankTxn) return res.status(404).json({ error: 'Bank transaction not found' });

    const originalProposal = {
      reconciliationStatus: bankTxn.reconciliationStatus,
      matchedTier: bankTxn.matchedTier,
      reconciledInvoiceId: bankTxn.reconciledInvoiceId,
      proposalDetails: bankTxn.proposalDetails,
    };

    // If previous invoice was marked PAID, revert it to UNPAID
    if (bankTxn.reconciledInvoiceId) {
      await Invoice.findByIdAndUpdate(bankTxn.reconciledInvoiceId, {
        status: 'UNPAID',
        paidAmount: 0,
        reconciledBankTxnId: null,
        reconciledAt: null,
        reconMethod: null,
      });
    }

    bankTxn.reconciliationStatus = 'OVERRIDDEN';
    bankTxn.matchedTier = 'MANUAL';
    bankTxn.reconciledInvoiceId = overrideInvoiceId || null;
    bankTxn.accountabilityStatement = 'Accountant override logged — rule trust downgraded in ledger.';
    bankTxn.overrideDetails = {
      originalProposal,
      accountantReason: reason || 'Accountant manual override',
      overriddenBy: 'ACCOUNTANT_CONTROLLER',
      overriddenAt: new Date(),
    };
    await bankTxn.save();

    // If there is an associated RuleCache rule, downgrade its trust level
    let rule = null;
    if (originalProposal.reconciledInvoiceId) {
      const inv = await Invoice.findById(originalProposal.reconciledInvoiceId).lean();
      if (inv?.customerName) {
        rule = await RuleCache.findOne({ partyIdentifier: inv.customerName.toUpperCase() });
        if (rule) {
          await rule.downgradeTrust();
        }
      }
    }

    // Append cryptographic audit event to hash chain
    const lastEvent = await ReconciliationEvent.findOne().sort({ chainIndex: -1 }).lean();
    const previousEventHash = lastEvent?.eventHash || GENESIS_HASH;
    const chainIndex = (lastEvent?.chainIndex || 0) + 1;

    const eventHash = calculateEventHash(previousEventHash, {
      chainIndex,
      bankTxnId: bankTxn.bankTxnId,
      invoiceNumber: 'OVERRIDDEN',
      resolvedTier: 'ACCOUNTANT_OVERRIDE',
      bankAmount: bankTxn.amount,
      circuitBreakerResult: { passed: false, equation: 'Accountant Manual Override' },
      batchId: 'MANUAL_GOVERNANCE',
    });

    const overrideEvent = await ReconciliationEvent.create({
      chainIndex,
      bankTxnId: bankTxn.bankTxnId,
      invoiceId: overrideInvoiceId || null,
      invoiceNumber: 'OVERRIDDEN',
      reconciliationStatus: 'OVERRIDDEN',
      resolvedTier: 'ACCOUNTANT_OVERRIDE',
      trustLevel: rule?.trustLevel || 'FIRST_TIME',
      accountabilityStatement: 'Accountant override logged — rule trust downgraded in ledger.',
      bankAmount: bankTxn.amount,
      confidenceScore: 1.0,
      rawNarration: bankTxn.narration,
      previousEventHash,
      eventHash,
      overrideDetails: {
        originalProposal,
        accountantReason: reason || 'Accountant manual override',
        overriddenBy: 'ACCOUNTANT_CONTROLLER',
        overriddenAt: new Date(),
      },
    });

    sseManager.broadcast('txn:overridden', {
      bankTxnId: bankTxn.bankTxnId,
      status: 'OVERRIDDEN',
      resolvedTier: 'ACCOUNTANT_OVERRIDE',
      eventHash: overrideEvent.eventHash,
    });

    return res.json({
      success: true,
      message: 'Transaction overridden and recorded in cryptographic hash chain.',
      bankTxn,
      ruleTrustLevel: rule?.trustLevel || null,
      eventHash: overrideEvent.eventHash,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Get Live Dashboard Metrics & Analytics
 */
reconRouter.get('/stats', async (req, res) => {
  try {
    const [
      totalLedgerCount,
      matchedCount,
      proposedCount,
      exceptionCount,
      unprocessedCount,
      tier1Count,
      tier2Count,
      tier3Count,
      invoices,
      recentEvents,
      ragCacheHitsCount,
    ] = await Promise.all([
      BankLedger.countDocuments(),
      BankLedger.countDocuments({ reconciliationStatus: 'MATCHED' }),
      BankLedger.countDocuments({ reconciliationStatus: 'PROPOSED' }),
      BankLedger.countDocuments({ reconciliationStatus: 'EXCEPTION' }),
      BankLedger.countDocuments({ reconciliationStatus: 'UNPROCESSED' }),
      BankLedger.countDocuments({ matchedTier: 'TIER_1' }),
      BankLedger.countDocuments({ matchedTier: 'TIER_2' }),
      BankLedger.countDocuments({ matchedTier: 'TIER_3' }),
      Invoice.find().lean(),
      ReconciliationEvent.find().sort({ createdAt: -1 }).limit(100).lean(),
      BankLedger.countDocuments({ 'executionMetrics.ragCacheHit': true }),
    ]);

    const totalInflow = matchedCount === 0
      ? 0
      : invoices
          .filter((i) => i.status === 'PAID')
          .reduce((sum, i) => sum + (i.paidAmount || 0), 0);

    const pendingInflow = invoices
      .filter((i) => i.status === 'UNPAID' || i.status === 'PARTIALLY_PAID')
      .reduce((sum, i) => sum + (i.totalAmount || 0), 0);

    // Compute Latency percentiles from recent events
    const durations = recentEvents.map((e) => e.totalDurationMs || 0).sort((a, b) => a - b);
    const p50 = durations.length ? durations[Math.floor(durations.length * 0.5)] : 0;
    const p95 = durations.length ? durations[Math.floor(durations.length * 0.95)] : 0;
    const p99 = durations.length ? durations[Math.floor(durations.length * 0.99)] : 0;

    // Cost economics calculation
    // Naive 100% LLM cost = $0.005 per txn
    // Hybrid Cost = Tier 3 non-RAG calls only ($0.005 * (tier3Count - ragCacheHits))
    const realTier3Calls = Math.max(0, tier3Count - ragCacheHitsCount);
    const naiveCostUsd = totalLedgerCount * 0.005;
    const hybridCostUsd = realTier3Calls * 0.005;
    const savingsPercent = naiveCostUsd > 0 ? Number((((naiveCostUsd - hybridCostUsd) / naiveCostUsd) * 100).toFixed(1)) : 100;

    const matchRatePercent = totalLedgerCount > 0 ? Number(((matchedCount / totalLedgerCount) * 100).toFixed(1)) : 0;

    return res.json({
      totalTransactions: totalLedgerCount,
      matchedCount,
      proposedCount,
      exceptionCount,
      unprocessedCount,
      matchRatePercent,
      totalInflow,
      pendingInflow,
      tierDistribution: {
        tier1: tier1Count,
        tier2: tier2Count,
        tier3: tier3Count,
        manual: Math.max(0, matchedCount - (tier1Count + tier2Count + tier3Count)),
      },
      ragCacheHits: ragCacheHitsCount,
      latencyMetrics: {
        p50Ms: Number(p50.toFixed(1)),
        p95Ms: Number(p95.toFixed(1)),
        p99Ms: Number(p99.toFixed(1)),
      },
      costEconomics: {
        naiveCostUsd: Number(naiveCostUsd.toFixed(3)),
        hybridCostUsd: Number(hybridCostUsd.toFixed(3)),
        savingsPercent,
      },
      hashChainLength: recentEvents.length,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Export Comprehensive Reconciliation Evidence Report for Auditor (CSV)
 */
reconRouter.get('/export-audit', async (req, res) => {
  try {
    const events = await ReconciliationEvent.find()
      .populate('invoiceId')
      .sort({ createdAt: 1 })
      .lean();

    const headers = [
      'Audit Event Hash',
      'Previous Event Hash',
      'Bank Txn ID',
      'Transaction Date',
      'Bank Amount (INR)',
      'Status',
      'Resolution Tier',
      'Trust Level',
      'Accountability Statement',
      'Reconciled Invoice Number',
      'Invoice Gross (INR)',
      'Deductions Total (INR)',
      'Circuit Breaker Equation',
      'Confidence Score',
      'RAG Cache Hit',
      'Override / Confirmation Notes',
      'Execution Latency (ms)',
      'Raw Narration',
    ];

    const rows = events.map((e) => {
      const invNum = e.invoiceNumber || e.invoiceId?.invoiceNumber || (e.splitInvoices?.length ? e.splitInvoices.map((s) => s.invoiceNumber).join(' + ') : 'N/A');
      const gross = e.circuitBreakerResult?.invoiceGross || (e.invoiceId?.totalAmount || 'N/A');
      const deductions = e.circuitBreakerResult?.deductionsTotal || 0;
      const cbEq = `"${(e.circuitBreakerResult?.equation || '').replace(/"/g, '""')}"`;
      const narration = `"${(e.rawNarration || '').replace(/"/g, '""')}"`;
      const accountability = `"${(e.accountabilityStatement || '').replace(/"/g, '""')}"`;
      const notes = `"${(e.overrideDetails?.accountantReason || e.overrideDetails?.accountantNotes || '').replace(/"/g, '""')}"`;

      return [
        e.eventHash,
        e.previousEventHash || 'GENESIS',
        e.bankTxnId,
        new Date(e.createdAt).toISOString(),
        e.circuitBreakerResult?.bankReceived || e.bankAmount || 0,
        e.reconciliationStatus || (e.resolvedTier === 'OUTBOX_EXCEPTION' ? 'EXCEPTION' : 'MATCHED'),
        e.resolvedTier,
        e.trustLevel || 'UNRATED',
        accountability,
        invNum,
        gross,
        deductions,
        cbEq,
        e.confidence,
        e.ragCacheHit ? 'YES' : 'NO',
        notes,
        e.totalDurationMs ? Number(e.totalDurationMs.toFixed(1)) : '<1',
        narration,
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="razorpay-recon-audit-report-${Date.now()}.csv"`);
    return res.status(200).send(csvContent);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Get Recent Live Feed of Transactions with Populated Details
 */
reconRouter.get('/feed', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '100', 10);
    const feed = await BankLedger.find()
      .populate('reconciledInvoiceId')
      .populate('splitInvoices.invoiceId')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json(feed);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Get DAG Event Traces for a specific Bank Transaction
 */
reconRouter.get('/events/:bankTxnId', async (req, res) => {
  try {
    const event = await ReconciliationEvent.findOne({ bankTxnId: req.params.bankTxnId })
      .populate('invoiceId')
      .lean();

    if (!event) {
      return res.status(404).json({ error: 'Audit trace not found' });
    }

    return res.json(event);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Reset Database for clean benchmark/demo runs
 */
reconRouter.post('/reset', async (req, res) => {
  try {
    clearRAGCache();
    await resetChainPointer();
    await Promise.all([
      BankLedger.deleteMany({}),
      ReconciliationEvent.deleteMany({}),
      JournalEntry.deleteMany({}),
      Invoice.deleteMany({ invoiceNumber: { $regex: /^BANK-/i } }),
      Invoice.updateMany({}, { $set: { status: 'UNPAID', paidAmount: 0, reconciledBankTxnId: null, reconciledAt: null, reconMethod: null } }),
    ]);

    sseManager.broadcast('dashboard:reset', { timestamp: new Date().toISOString() });

    return res.json({ success: true, message: 'Database reset successfully. Ready for fresh batch run.' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Track-04 Direction 3 & GenAI Depth Step 2: Function-Calling Settlement Q&A Agent
 * Answers natural-language accounting queries with grounded database function calling
 */
reconRouter.post('/assistant-chat', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ error: 'Query string is required.' });
    }

    const agentResult = await runSettlementAgent(query);
    return res.json(agentResult);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Track-04 Direction 4: Forward Cash Forecaster
 * Forecasts 30/60/90-day cash position from settled inflows, open receivables, and statutory liabilities
 */
reconRouter.get('/cash-forecast', async (req, res) => {
  try {
    const [reconciledLedger, openInvoices, exceptionLedger] = await Promise.all([
      BankLedger.find({ reconciliationStatus: 'MATCHED' }).lean(),
      Invoice.find({ status: { $in: ['UNPAID', 'PARTIALLY_PAID'] } }).lean(),
      BankLedger.find({ reconciliationStatus: 'EXCEPTION' }).lean(),
    ]);

    const currentBankCashInflow = reconciledLedger.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const stuckExceptionCash = exceptionLedger.reduce((s, t) => s + (Number(t.amount) || 0), 0);

    // Group receivables by aging buckets (0-30, 31-60, 61-90 days)
    let bucket0to30 = 0;
    let bucket31to60 = 0;
    let bucket61to90 = 0;
    let expectedTdsDeduction = 0;

    const vendorBuckets = {};

    for (const inv of openInvoices) {
      const gross = Number(inv.totalAmount || 0);
      const estTdsRate = inv.expectedTdsRate || 2; // Default 2% standard
      const estTds = (gross * estTdsRate) / 100;
      expectedTdsDeduction += estTds;

      // Real date-based invoice aging calculation
      const invDate = inv.dueDate ? new Date(inv.dueDate) : (inv.invoiceDate ? new Date(inv.invoiceDate) : (inv.createdAt ? new Date(inv.createdAt) : new Date()));
      const ageInDays = Math.max(0, Math.floor((Date.now() - invDate.getTime()) / (1000 * 60 * 60 * 24)));
      if (ageInDays <= 30) {
        bucket0to30 += gross;
      } else if (ageInDays <= 60) {
        bucket31to60 += gross;
      } else {
        bucket61to90 += gross;
      }

      // Track by vendor
      const vName = inv.customerName || 'Unknown Vendor';
      vendorBuckets[vName] = (vendorBuckets[vName] || 0) + gross;
    }

    const topVendorsDue = Object.entries(vendorBuckets)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, amount]) => ({ vendorName: name, amountDue: amount }));

    // Forecast projections
    const netReceivables0to30 = bucket0to30 * 0.95; // 95% collection probability
    const netReceivables31to60 = bucket31to60 * 0.88; // 88% collection probability
    const netReceivables61to90 = bucket61to90 * 0.75; // 75% collection probability

    const forecast = {
      currentBankCashInflow: Number(currentBankCashInflow.toFixed(2)),
      stuckExceptionCash: Number(stuckExceptionCash.toFixed(2)),
      totalOpenReceivables: Number((bucket0to30 + bucket31to60 + bucket61to90).toFixed(2)),
      expectedTdsLiabilitiesReceivable: Number(expectedTdsDeduction.toFixed(2)),
      agingBreakdown: {
        days0to30: Number(bucket0to30.toFixed(2)),
        days31to60: Number(bucket31to60.toFixed(2)),
        days61to90: Number(bucket61to90.toFixed(2)),
      },
      projectedNetLiquidity: {
        tPlus30Days: Number((currentBankCashInflow + netReceivables0to30).toFixed(2)),
        tPlus60Days: Number((currentBankCashInflow + netReceivables0to30 + netReceivables31to60).toFixed(2)),
        tPlus90Days: Number((currentBankCashInflow + netReceivables0to30 + netReceivables31to60 + netReceivables61to90).toFixed(2)),
      },
      topVendorsDue,
      liquidityHealthIndex: stuckExceptionCash > 0
        ? Math.max(10, Math.round((currentBankCashInflow / (currentBankCashInflow + stuckExceptionCash)) * 100))
        : 100,
    };

    return res.json(forecast);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Rillet-Style AI-Native ERP Innovation 1: Live Trial Balance & Zero-Day Month-End Close
 * Computes live, balanced General Ledger Trial Balance (Dr = Cr) and continuous close health
 */
reconRouter.get('/trial-balance', async (req, res) => {
  try {
    const data = await JournalService.getLiveTrialBalance();
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Rillet-Style AI-Native ERP Innovation 2: Double-Entry Journal Entry Stream
 * Returns list of auto-generated journal entries with balanced debits and credits
 */
reconRouter.get('/journal-entries', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const entries = await JournalEntry.find().sort({ createdAt: -1 }).limit(limit).lean();
    return res.json(entries);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Rillet-Style AI-Native ERP Innovation 3: 100% Traceable AI Audit Memo per Transaction
 * Provides full source traceback (Bank Line -> Invoice -> Tax Math -> Double Entry GL)
 */
reconRouter.get('/audit-memo/:bankTxnId', async (req, res) => {
  try {
    const { bankTxnId } = req.params;
    const [bankTxn, event, journal] = await Promise.all([
      BankLedger.findOne({ bankTxnId }).populate('reconciledInvoiceId').lean(),
      ReconciliationEvent.findOne({ bankTxnId }).populate('invoiceId').lean(),
      JournalEntry.findOne({ bankTxnId }).lean(),
    ]);

    if (!bankTxn) {
      return res.status(404).json({ error: 'Transaction not found in ledger.' });
    }

    const memo = {
      bankTxnId,
      status: bankTxn.reconciliationStatus,
      matchedTier: bankTxn.matchedTier,
      confidenceScore: bankTxn.confidenceScore,
      bankAmount: bankTxn.amount,
      narration: bankTxn.narration,
      utrNumber: bankTxn.utrNumber,
      invoice: bankTxn.reconciledInvoiceId || event?.invoiceId || null,
      deductions: bankTxn.deductionsApplied || {},
      circuitBreaker: event?.circuitBreakerResult || bankTxn.discrepancyDetails || null,
      journalEntry: journal || null,
      cryptographicEventHash: event?.eventHash || 'GENESIS',
      auditMemoSummary: journal?.auditMemo?.summary || bankTxn.discrepancyDetails?.reason || 'Transaction recorded in cryptographic audit ledger.',
    };

    return res.json(memo);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});
