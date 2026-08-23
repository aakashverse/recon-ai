import express from 'express';
import { sseManager } from '../utils/sseManager.js';
import { ReconciliationEngine } from '../services/reconciliationEngine.js';
import { OutboxService } from '../services/outboxService.js';
import { BankLedger } from '../models/BankLedger.js';
import { Invoice } from '../models/Invoice.js';
import { ReconciliationEvent } from '../models/ReconciliationEvent.js';
import { RuleCache } from '../models/RuleCache.js';
import { getApiKeyStatus, initGemini } from '../config/ai.js';

export const reconRouter = express.Router();

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
    // Hybrid Cost = Tier 3 only ($0.005 * tier3Count)
    const naiveCostUsd = totalLedgerCount * 0.005;
    const hybridCostUsd = tier3Count * 0.005;
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
        manual: matchedCount - (tier1Count + tier2Count + tier3Count),
      },
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
    });
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
      Invoice.updateMany({}, { $set: { status: 'UNPAID', paidAmount: 0, reconciledBankTxnId: null, reconciledAt: null, reconMethod: null } }),
    ]);

    sseManager.broadcast('dashboard:reset', { timestamp: new Date().toISOString() });

    return res.json({ success: true, message: 'Database reset successfully. Ready for fresh batch run.' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});
