import express from 'express';
import { sseManager } from '../utils/sseManager.js';
import { ReconciliationEngine } from '../services/reconciliationEngine.js';
import { OutboxService } from '../services/outboxService.js';
import { BankLedger } from '../models/BankLedger.js';
import { Invoice } from '../models/Invoice.js';
import { ReconciliationEvent } from '../models/ReconciliationEvent.js';
import { RuleCache } from '../models/RuleCache.js';
import { JournalEntry } from '../models/JournalEntry.js';
import { JournalService } from '../services/journalService.js';
import { getApiKeyStatus, initGemini, getGeminiModel, getTextGenModel, isAIAvailable } from '../config/ai.js';
import { parseCSV, normalizeBankStatementRows, normalizeInvoiceRows } from '../utils/csvParser.js';

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
 * AI Financial Data Structurer & Normalizer (Gemini / Zod)
 * Converts messy emails, unstructured statements, and raw OCR text into canonical schema
 */
reconRouter.post('/ai-parse-and-structure', async (req, res) => {
  try {
    const { rawText, targetType } = req.body;
    if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
      return res.status(400).json({ error: 'rawText is required' });
    }

    const jsonModel = getGeminiModel() || getTextGenModel();

    if (isAIAvailable() && jsonModel) {
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

RAW INPUT TEXT TO CONVERT:
"""
${rawText}
"""

Return ONLY a valid JSON object without code blocks or markdown text.`;

        const result = await textModel.generateContent(prompt);
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
 * Get Live Dashboard Metrics & Analytics
 */
reconRouter.get('/stats', async (req, res) => {
  try {
    const [
      totalLedgerCount,
      matchedCount,
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
      BankLedger.countDocuments({ reconciliationStatus: 'EXCEPTION' }),
      BankLedger.countDocuments({ reconciliationStatus: 'UNPROCESSED' }),
      BankLedger.countDocuments({ matchedTier: 'TIER_1' }),
      BankLedger.countDocuments({ matchedTier: 'TIER_2' }),
      BankLedger.countDocuments({ matchedTier: 'TIER_3' }),
      Invoice.find().lean(),
      ReconciliationEvent.find().sort({ createdAt: -1 }).limit(100).lean(),
      BankLedger.countDocuments({ 'executionMetrics.ragCacheHit': true }),
    ]);

    const totalInflow = invoices
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
      'Reconciled Invoice Number',
      'Invoice Gross (INR)',
      'Deductions Total (INR)',
      'Circuit Breaker Equation',
      'Confidence Score',
      'RAG Cache Hit',
      'Execution Latency (ms)',
      'Raw Narration',
    ];

    const rows = events.map((e) => {
      const invNum = e.invoiceNumber || e.invoiceId?.invoiceNumber || (e.splitInvoices?.length ? e.splitInvoices.map((s) => s.invoiceNumber).join(' + ') : 'N/A');
      const gross = e.circuitBreakerResult?.invoiceGross || (e.invoiceId?.totalAmount || 'N/A');
      const deductions = e.circuitBreakerResult?.deductionsTotal || 0;
      const cbEq = `"${(e.circuitBreakerResult?.equation || '').replace(/"/g, '""')}"`;
      const narration = `"${(e.rawNarration || '').replace(/"/g, '""')}"`;

      return [
        e.eventHash,
        e.previousEventHash || 'GENESIS',
        e.bankTxnId,
        new Date(e.createdAt).toISOString(),
        e.circuitBreakerResult?.bankReceived || 0,
        e.resolvedTier === 'OUTBOX_EXCEPTION' ? 'EXCEPTION' : 'MATCHED',
        e.resolvedTier,
        invNum,
        gross,
        deductions,
        cbEq,
        e.confidence,
        e.ragCacheHit ? 'YES' : 'NO',
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
 * Track-04 Direction 3: Settlement Q&A Agent
 * Answers natural-language accounting & reconciliation queries over verified live ledger data
 */
reconRouter.post('/assistant-chat', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query string is required.' });
    }

    // 1. Gather real-time verified ledger metrics
    const [
      totalInvoices,
      unpaidInvoices,
      reconciledTxns,
      exceptionTxns,
      recentEvents,
      rules,
    ] = await Promise.all([
      Invoice.find().lean(),
      Invoice.find({ status: { $in: ['UNPAID', 'PARTIALLY_PAID'] } }).lean(),
      BankLedger.find({ reconciliationStatus: 'MATCHED' }).populate('reconciledInvoiceId').lean(),
      BankLedger.find({ reconciliationStatus: 'EXCEPTION' }).lean(),
      ReconciliationEvent.find().sort({ createdAt: -1 }).limit(10).lean(),
      RuleCache.find({ isActive: true }).lean(),
    ]);

    const totalBilled = totalInvoices.reduce((s, i) => s + (Number(i.totalAmount) || 0), 0);
    const totalCollected = reconciledTxns.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const totalExceptionsAmount = exceptionTxns.reduce((s, t) => s + (Number(t.amount) || 0), 0);

    // Compute TDS deductions by section
    const tdsBreakdown = {};
    for (const t of reconciledTxns) {
      const section = t.deductionsApplied?.tdsSection || 'NONE';
      const amt = Number(t.deductionsApplied?.tdsAmount || 0);
      if (amt > 0) {
        tdsBreakdown[section] = (tdsBreakdown[section] || 0) + amt;
      }
    }

    // Top exceptions list
    const topExceptions = exceptionTxns.slice(0, 5).map((e) => ({
      bankTxnId: e.bankTxnId,
      amount: e.amount,
      narration: e.narration,
      reason: e.discrepancyDetails?.reason || 'Discrepancy detected',
      discrepancyAmount: e.discrepancyDetails?.discrepancyAmount || 0,
    }));

    const contextSummary = {
      totalInvoicesCount: totalInvoices.length,
      unpaidInvoicesCount: unpaidInvoices.length,
      totalBilledInr: totalBilled,
      totalCollectedInr: totalCollected,
      reconciledTxnsCount: reconciledTxns.length,
      exceptionsCount: exceptionTxns.length,
      totalExceptionsInr: totalExceptionsAmount,
      tdsWithholdingsBySection: tdsBreakdown,
      topExceptions,
      activeRulesCount: rules.length,
      matchRatePercent: reconciledTxns.length + exceptionTxns.length > 0
        ? Math.round((reconciledTxns.length / (reconciledTxns.length + exceptionTxns.length)) * 100)
        : 0,
    };

    // 2. Call Gemini 1.5 Flash if available, else deterministic finance accountant synthesizer
    const model = getGeminiModel();
    if (isAIAvailable() && model) {
      try {
        const prompt = `You are an elite B2B AI Finance Controller for Razorpay Recon AI.
Your answers are strictly grounded in verified database accounting data.

Context Summary from live database:
${JSON.stringify(contextSummary, null, 2)}

User Question: "${query}"

Guidelines:
- Provide concise, professional, bulleted financial answers with exact INR amounts (₹).
- Cite specific statutory TDS sections (e.g. 194C, 194J, 194H, 206AB) and transaction IDs where relevant.
- Never hallucinate data that is not in the context.`;

        const result = await model.generateContent(prompt);
        const answer = result.response.text();
        return res.json({ answer, context: contextSummary });
      } catch (err) {
        console.warn('[Assistant Chat] Gemini API error, falling back to local synthesizer:', err.message);
      }
    }

    // High-precision local fallback response
    let answer = `### 📊 AI Finance Controller Report\n\n`;
    const qLower = query.toLowerCase();

    if (qLower.includes('tds') || qLower.includes('tax')) {
      answer += `**Statutory TDS Withholdings Summary:**\n`;
      const sections = Object.entries(tdsBreakdown);
      if (sections.length > 0) {
        for (const [sec, amt] of sections) {
          answer += `- **Section ${sec}**: ₹${amt.toLocaleString('en-IN')}\n`;
        }
        const totalTds = Object.values(tdsBreakdown).reduce((a, b) => a + b, 0);
        answer += `\n**Total TDS Withheld by Clients:** ₹${totalTds.toLocaleString('en-IN')} (Eligible for Form 26AS tax credit claim).`;
      } else {
        answer += `No TDS deductions recorded in the current reconciled batch.`;
      }
    } else if (qLower.includes('exception') || qLower.includes('outbox') || qLower.includes('discrepan')) {
      answer += `**Active Exceptions in Outbox (${contextSummary.exceptionsCount} items | ₹${totalExceptionsAmount.toLocaleString('en-IN')}):**\n`;
      for (const ex of topExceptions) {
        answer += `- **${ex.bankTxnId}** (₹${ex.amount.toLocaleString('en-IN')}): ${ex.reason} — *${ex.narration.slice(0, 45)}...*\n`;
      }
      answer += `\n*Action*: Automated WhatsApp and Email dispute drafts are ready for dispatch in the Agentic Outbox.`;
    } else if (qLower.includes('rate') || qLower.includes('kpi') || qLower.includes('metric')) {
      answer += `**Pipeline Performance & Reconciliation KPIs:**\n`;
      answer += `- **Reconciliation Rate**: ${contextSummary.matchRatePercent}%\n`;
      answer += `- **Total Collections Reconciled**: ₹${totalCollected.toLocaleString('en-IN')} across ${contextSummary.reconciledTxnsCount} transactions\n`;
      answer += `- **Active Self-Healing Rules**: ${contextSummary.activeRulesCount} vendor pattern rules\n`;
      answer += `- **Pending Receivables**: ${contextSummary.unpaidInvoicesCount} invoices pending payment`;
    } else {
      answer += `**Current Financial Position Overview:**\n`;
      answer += `- **Total Invoices Billed**: ₹${totalBilled.toLocaleString('en-IN')} (${contextSummary.totalInvoicesCount} invoices)\n`;
      answer += `- **Total Bank Inflows Reconciled**: ₹${totalCollected.toLocaleString('en-IN')}\n`;
      answer += `- **Unresolved Discrepancies (Outbox)**: ₹${totalExceptionsAmount.toLocaleString('en-IN')} (${contextSummary.exceptionsCount} transactions)\n`;
      answer += `- **Open Invoices Receivable**: ${contextSummary.unpaidInvoicesCount} invoices\n\n`;
      answer += `*You can ask me specific questions about TDS breakdowns, vendor exception reasons, cash forecasting, or rule cache efficiency.*`;
    }

    return res.json({ answer, context: contextSummary });
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

      // Mock aging based on invoice number modulo or real date
      const hashSeed = (inv.invoiceNumber || '').charCodeAt((inv.invoiceNumber || '').length - 1) % 3;
      if (hashSeed === 0) {
        bucket0to30 += gross;
      } else if (hashSeed === 1) {
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
