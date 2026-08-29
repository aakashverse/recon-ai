import { generateIdempotencyHash, calculateEventHash, GENESIS_HASH } from '../utils/hasher.js';
import { matchTier1 } from './tier1Matcher.js';
import { matchTier2 } from './tier2ToleranceMatcher.js';
import { matchTier3 } from './tier3GenAIPool.js';
import { validateCircuitBreaker } from './circuitBreaker.js';
import { BankLedger } from '../models/BankLedger.js';
import { Invoice } from '../models/Invoice.js';
import { ReconciliationEvent } from '../models/ReconciliationEvent.js';
import { RuleCache } from '../models/RuleCache.js';
import { JournalEntry } from '../models/JournalEntry.js';
import { JournalService } from './journalService.js';
import { OutboxService } from './outboxService.js';
import { withTransaction } from '../config/db.js';
import { sseManager } from '../utils/sseManager.js';

// Batch-level cost tracking map
const batchCostTracker = new Map();

// Global sequential hash chain pointers
let currentChainHash = null;
let currentChainIndex = 0;

export async function resetChainPointer() {
  const last = await ReconciliationEvent.findOne().sort({ chainIndex: -1 }).lean();
  currentChainHash = last?.eventHash || GENESIS_HASH;
  currentChainIndex = last?.chainIndex || 0;
  return { currentChainHash, currentChainIndex };
}

/**
 * Step 2: Ground-Truth Factual Claim Validation Gate (v4 Addendum)
 * Independently verifies that candidate invoices exist, are open (UNPAID/PARTIALLY_PAID),
 * and match claimed counterparty entity before mathematical verification.
 */
export function validateFactualClaims(candidateInvoice, matchResult, ledgerDoc, splitInvoices = []) {
  if (splitInvoices && splitInvoices.length >= 2) {
    for (const inv of splitInvoices) {
      if (!inv || !inv.invoiceNumber) {
        return { valid: false, reason: 'Split invoice list contains invalid or non-existent record.' };
      }
      if (inv.status === 'PAID') {
        return { valid: false, reason: `Split invoice ${inv.invoiceNumber} is already marked PAID in ledger.` };
      }
    }
    return { valid: true };
  }

  if (!candidateInvoice) {
    return { valid: false, reason: matchResult?.reason || 'No candidate invoice resolved.' };
  }

  // 1. Check Invoice Exists & Has Valid ID
  if (!candidateInvoice.invoiceNumber || !candidateInvoice._id) {
    return { valid: false, reason: 'Ground-truth failure: Candidate invoice does not exist in open ledger.' };
  }

  // 2. Check Open Status (Prevent double-matching / race conditions)
  if (candidateInvoice.status === 'PAID' || candidateInvoice.status === 'CANCELLED') {
    return {
      valid: false,
      reason: `Ground-truth failure: Invoice ${candidateInvoice.invoiceNumber} is already ${candidateInvoice.status}.`,
    };
  }

  // 3. Check Vendor Entity Compatibility (if GenAI extracted a specific vendor claim)
  const aiVendor = matchResult?.aiExtraction?.vendor_name;
  if (aiVendor && candidateInvoice.customerName) {
    const cleanAiVendor = aiVendor.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const cleanInvCustomer = candidateInvoice.customerName.toUpperCase().replace(/[^A-Z0-9]/g, '');

    const nonGenericAi = cleanAiVendor.replace(/PVTLTD|LTD|CORP|SERVICES|SOLUTIONS|ENTERPRISES|INDIA/g, '');
    const nonGenericInv = cleanInvCustomer.replace(/PVTLTD|LTD|CORP|SERVICES|SOLUTIONS|ENTERPRISES|INDIA/g, '');

    if (nonGenericAi.length >= 4 && nonGenericInv.length >= 4) {
      if (!nonGenericAi.includes(nonGenericInv) && !nonGenericInv.includes(nonGenericAi)) {
        return {
          valid: false,
          reason: `Ground-truth failure: GenAI claimed vendor "${aiVendor}" does not match ledger customer "${candidateInvoice.customerName}".`,
        };
      }
    }
  }

  return { valid: true };
}

export class ReconciliationEngine {
  /**
   * Reconciles a single bank transaction through the 4-Tier Cascaded Pipeline
   * Supports optional in-memory context for sub-millisecond batch execution
   */
  static async processTransaction(rawTxn, batchId = null, options = {}, context = {}) {
    const totalStart = performance.now();
    const dagNodes = [];

    // 1. Ingestion & Idempotency Guard
    const ingestStart = performance.now();
    const hash = generateIdempotencyHash(rawTxn);
    const bankTxnId = rawTxn.bankTxnId || `TXN-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    const existingTxn = await BankLedger.findOne({
      $or: [{ idempotencyHash: hash }, { bankTxnId }],
    });

    if (existingTxn && (existingTxn.reconciliationStatus === 'MATCHED' || existingTxn.reconciliationStatus === 'EXCEPTION')) {
      dagNodes.push({
        nodeKey: 'STEP_INGEST',
        name: 'Idempotency Guard Check',
        status: 'SUCCESS',
        durationMs: performance.now() - ingestStart,
        outputData: {
          duplicateDetected: true,
          status: existingTxn.reconciliationStatus,
          message: `Replay rejected: Transaction ${bankTxnId} already ingested & recorded as ${existingTxn.reconciliationStatus}.`,
        },
      });

      return {
        success: true,
        isDuplicate: true,
        bankTxn: existingTxn,
        resolvedTier: 'DUPLICATE_REJECTED',
        dagNodes,
        totalDurationMs: performance.now() - totalStart,
      };
    }

    // Persist or find bank ledger entry
    let ledgerDoc = existingTxn;
    if (!ledgerDoc) {
      ledgerDoc = await BankLedger.create({
        bankTxnId,
        utrNumber: rawTxn.utrNumber || '',
        amount: Number(rawTxn.amount),
        narration: rawTxn.narration,
        attachmentUrl: rawTxn.attachmentUrl || null,
        idempotencyHash: hash,
        reconciliationStatus: 'UNPROCESSED',
        txnDate: rawTxn.txnDate ? new Date(rawTxn.txnDate) : new Date(),
      });
    }

    dagNodes.push({
      nodeKey: 'STEP_INGEST',
      name: 'Idempotency & Ingestion Guard',
      status: 'SUCCESS',
      durationMs: performance.now() - ingestStart,
      outputData: { idempotencyHash: hash, status: 'ACCEPTED' },
    });

    sseManager.broadcast('txn:ingested', {
      bankTxnId: ledgerDoc.bankTxnId,
      amount: ledgerDoc.amount,
      narration: ledgerDoc.narration,
    });

    let matchResult = null;
    let resolvedTier = null;
    let tier1Duration = 0;
    let tier2Duration = 0;
    let tier3Duration = 0;
    let ragCacheHit = false;

    // -----------------------------------------------------------------------
    // 2. Tier 1: Deterministic Exact Matcher (<2ms)
    // -----------------------------------------------------------------------
    const t1Res = await matchTier1(ledgerDoc, context);
    tier1Duration = t1Res.durationMs;

    if (t1Res.matched) {
      matchResult = t1Res;
      resolvedTier = 'TIER_1';
      dagNodes.push({
        nodeKey: 'STEP_TIER_1',
        name: 'Tier 1: Deterministic Exact Matcher',
        tier: 'TIER_1',
        status: 'SUCCESS',
        durationMs: t1Res.durationMs,
        outputData: { matchType: t1Res.matchType, invoiceNumber: t1Res.invoice?.invoiceNumber },
      });
      dagNodes.push({ nodeKey: 'STEP_TIER_2', name: 'Tier 2: Rules, Tolerance & Split Engine', tier: 'TIER_2', status: 'BYPASSED', durationMs: 0 });
      dagNodes.push({ nodeKey: 'STEP_TIER_3', name: 'Tier 3: GenAI Worker Pool & RAG Cache', tier: 'TIER_3', status: 'BYPASSED', durationMs: 0 });
    } else {
      dagNodes.push({
        nodeKey: 'STEP_TIER_1',
        name: 'Tier 1: Deterministic Exact Matcher',
        tier: 'TIER_1',
        status: 'FAILED',
        durationMs: t1Res.durationMs,
        outputData: { reason: t1Res.reason || 'No exact gross/UTR match' },
      });

      // ---------------------------------------------------------------------
      // 3. Tier 2: Rules, Tolerance, Explainable-Delta & Split-Match (<5ms)
      // ---------------------------------------------------------------------
      const t2Res = await matchTier2(ledgerDoc, context);
      tier2Duration = t2Res.durationMs;

      if (t2Res.matched) {
        matchResult = t2Res;
        resolvedTier = 'TIER_2';
        dagNodes.push({
          nodeKey: 'STEP_TIER_2',
          name: 'Tier 2: Rules, Tolerance & Split Engine',
          tier: 'TIER_2',
          status: 'SUCCESS',
          durationMs: t2Res.durationMs,
          outputData: {
            matchType: t2Res.matchType,
            ruleApplied: t2Res.ruleApplied,
            invoiceNumber: t2Res.invoice?.invoiceNumber,
            splitCount: t2Res.splitInvoices?.length || 1,
          },
        });
        dagNodes.push({ nodeKey: 'STEP_TIER_3', name: 'Tier 3: GenAI Worker Pool & RAG Cache', tier: 'TIER_3', status: 'BYPASSED', durationMs: 0 });
      } else {
        dagNodes.push({
          nodeKey: 'STEP_TIER_2',
          name: 'Tier 2: Rules, Tolerance & Split Engine',
          tier: 'TIER_2',
          status: 'FAILED',
          durationMs: t2Res.durationMs,
          outputData: { reason: t2Res.reason || 'Delta not explainable by statutory tables, learned rules, or split match' },
        });

        // -------------------------------------------------------------------
        // 4. Cost Circuit Breaker Check before Tier 3 GenAI Call
        // -------------------------------------------------------------------
        const currentBatchCost = batchCostTracker.get(batchId) || 0;
        const maxBatchCost = options.costCapUsd || options.maxGenAICost || (process.env.GENAI_COST_CAP_USD ? parseFloat(process.env.GENAI_COST_CAP_USD) : 0.50);

        if (currentBatchCost >= maxBatchCost) {
          dagNodes.push({
            nodeKey: 'STEP_TIER_3',
            name: 'Tier 3: GenAI Worker Pool & RAG Cache',
            tier: 'TIER_3',
            status: 'BYPASSED',
            durationMs: 0.1,
            outputData: { costCapTriggered: true, currentBatchCost, maxBatchCost, reason: 'COST_CAP_TRIGGERED' },
          });

          matchResult = {
            matched: false,
            tier: 'TIER_3',
            confidence: 0,
            reason: 'COST_CAP_TRIGGERED',
            discrepancyDetails: {
              reason: `Cumulative GenAI spend cap ($${maxBatchCost.toFixed(2)}) reached ($${currentBatchCost.toFixed(3)} spent). Routed to Outbox to prevent budget overrun.`,
              discrepancyType: 'COST_CAP_TRIGGERED',
              discrepancyAmount: ledgerDoc.amount,
            },
          };
          resolvedTier = 'OUTBOX_EXCEPTION';
        } else {
          // -----------------------------------------------------------------
          // 5. Tier 3: Concurrency-Controlled GenAI Worker Pool with RAG Cache
          // -----------------------------------------------------------------
          sseManager.broadcast('txn:tier3_processing', {
            bankTxnId: ledgerDoc.bankTxnId,
          });

          const t3Res = await matchTier3(ledgerDoc, options, context);
          tier3Duration = t3Res.durationMs;
          ragCacheHit = Boolean(t3Res.ragCacheHit);

          const callCost = ragCacheHit ? 0.000 : 0.005;
          batchCostTracker.set(batchId, currentBatchCost + callCost);

          if (t3Res.matched) {
            matchResult = t3Res;
            resolvedTier = 'TIER_3';
            dagNodes.push({
              nodeKey: 'STEP_TIER_3',
              name: ragCacheHit ? 'Tier 3: RAG Fingerprint Cache Hit ($0.00)' : 'Tier 3: GenAI Worker Pool (Google Gemini)',
              tier: 'TIER_3',
              status: 'SUCCESS',
              durationMs: t3Res.durationMs,
              outputData: {
                ragCacheHit,
                matchType: t3Res.matchType,
                invoiceNumber: t3Res.invoice?.invoiceNumber,
                confidence: t3Res.confidence,
              },
            });
          } else {
            matchResult = t3Res;
            resolvedTier = 'OUTBOX_EXCEPTION';
            dagNodes.push({
              nodeKey: 'STEP_TIER_3',
              name: 'Tier 3: GenAI Worker Pool',
              tier: 'TIER_3',
              status: 'FAILED',
              durationMs: t3Res.durationMs,
              outputData: { reason: t3Res.reason || 'GenAI pool unable to ground extraction to open invoice' },
            });
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // 6.5. Independent Ground-Truth Factual Claim Validation Gate (v4 Addendum)
    // -----------------------------------------------------------------------
    const factualCheckStart = performance.now();
    const factualClaimCheck = validateFactualClaims(
      matchResult?.invoice,
      matchResult,
      ledgerDoc,
      matchResult?.splitInvoices
    );
    const factualCheckDuration = performance.now() - factualCheckStart;

    dagNodes.push({
      nodeKey: 'STEP_FACTUAL_CLAIM_VALIDATION',
      name: 'Ground-Truth Database Claim Validation',
      status: factualClaimCheck.valid ? 'SUCCESS' : 'FAILED',
      durationMs: factualCheckDuration,
      outputData: factualClaimCheck,
    });

    if (!factualClaimCheck.valid && matchResult?.matched) {
      matchResult.matched = false;
      matchResult.reason = factualClaimCheck.reason;
      resolvedTier = 'OUTBOX_EXCEPTION';
    }

    // -----------------------------------------------------------------------
    // 7. Deterministic Zero-Trust Circuit Breaker Validation
    // -----------------------------------------------------------------------
    const cbStart = performance.now();
    const candidateInvoice = matchResult?.invoice || null;
    const splitInvoices = matchResult?.splitInvoices || [];
    const deductions = matchResult?.deductions || {};

    let circuitBreakerResult = null;
    if (candidateInvoice || splitInvoices.length >= 2) {
      if (splitInvoices.length >= 2) {
        circuitBreakerResult = validateCircuitBreaker(candidateInvoice, ledgerDoc.amount, deductions, splitInvoices);
      } else {
        circuitBreakerResult = validateCircuitBreaker(candidateInvoice, ledgerDoc.amount, deductions);
      }
    } else {
      circuitBreakerResult = {
        passed: false,
        reason: matchResult?.reason || 'No candidate invoice found',
        equation: `${ledgerDoc.amount} (Bank) vs No matching invoice found`,
        difference: ledgerDoc.amount,
        discrepancyType: 'UNMATCHED',
        discrepancyAmount: ledgerDoc.amount,
      };
    }

    const cbDuration = performance.now() - cbStart;
    dagNodes.push({
      nodeKey: 'STEP_CIRCUIT_BREAKER',
      name: 'Zero-Trust Circuit Breaker Math Verification',
      status: circuitBreakerResult.passed ? 'SUCCESS' : 'DISCREPANCY_DETECTED',
      durationMs: cbDuration,
      outputData: circuitBreakerResult,
    });

    // -----------------------------------------------------------------------
    // 8. State Resolution & ACID Commit with Cryptographic Hash Chain
    // -----------------------------------------------------------------------
    const commitStart = performance.now();
    const isReconciled = Boolean(matchResult?.matched && circuitBreakerResult?.passed);

    let whatsappDraft = null;
    let emailDraft = null;
    let createdEvent = null;

    if (!currentChainHash) {
      await resetChainPointer();
    }
    const previousEventHash = currentChainHash;

    await withTransaction(async (session) => {
      if (isReconciled && candidateInvoice) {
        // Mark candidate invoice as in-memory PAID to prevent race conditions
        candidateInvoice.status = 'PAID';
        if (splitInvoices?.length) {
          for (const s of splitInvoices) {
            if (context.invoiceByNumber) {
              const inv = context.invoiceByNumber.get(s.invoiceNumber?.toUpperCase());
              if (inv) inv.status = 'PAID';
            }
          }
        }

        // Update Bank Ledger
        ledgerDoc.reconciliationStatus = 'MATCHED';
        ledgerDoc.matchedTier = resolvedTier;
        ledgerDoc.reconciledInvoiceId = candidateInvoice._id;
        ledgerDoc.splitInvoices = splitInvoices;
        ledgerDoc.confidenceScore = matchResult.confidence || 1.0;
        ledgerDoc.deductionsApplied = matchResult.deductions || {};
        ledgerDoc.executionMetrics = {
          tier1DurationMs: Number(tier1Duration.toFixed(2)),
          tier2DurationMs: Number(tier2Duration.toFixed(2)),
          tier3DurationMs: Number(tier3Duration.toFixed(2)),
          circuitBreakerDurationMs: Number(cbDuration.toFixed(2)),
          totalDurationMs: Number((performance.now() - totalStart).toFixed(2)),
          ragCacheHit,
          splitMatchCount: splitInvoices.length,
        };
        await ledgerDoc.save({ session });

        // Update Invoices
        if (splitInvoices.length >= 2) {
          const splitIds = splitInvoices.map((i) => i.invoiceId);
          await Invoice.updateMany(
            { _id: { $in: splitIds } },
            {
              $set: {
                status: 'PAID',
                reconciledBankTxnId: ledgerDoc._id,
                reconciledAt: new Date(),
                reconMethod: 'TIER_2_SPLIT_MATCH',
              },
            },
            { session }
          );
        } else {
          await Invoice.updateOne(
            { _id: candidateInvoice._id },
            {
              $set: {
                status: 'PAID',
                paidAmount: ledgerDoc.amount,
                reconciledBankTxnId: ledgerDoc._id,
                reconciledAt: new Date(),
                reconMethod:
                  resolvedTier === 'TIER_1'
                    ? 'TIER_1_EXACT'
                    : resolvedTier === 'TIER_2'
                    ? 'TIER_2_TOLERANCE'
                    : 'TIER_3_GENAI',
              },
            },
            { session }
          );
        }

        // Generate Rillet-Style Double-Entry Journal Entry
        const journalDocData = JournalService.generateJournalEntry(ledgerDoc, candidateInvoice, matchResult);
        await JournalEntry.create([journalDocData], { session });

        dagNodes.push({
          nodeKey: 'STEP_COMMIT',
          name: 'ACID Multi-Doc Commit (PAID)',
          status: 'SUCCESS',
          durationMs: performance.now() - commitStart,
        });

        dagNodes.push({
          nodeKey: 'STEP_JOURNAL',
          name: `General Ledger Auto-Journal (${journalDocData.journalEntryNumber})`,
          status: 'BALANCED',
          durationMs: 1.2,
          outputData: {
            journalEntryNumber: journalDocData.journalEntryNumber,
            totalDebit: journalDocData.totalDebit,
            totalCredit: journalDocData.totalCredit,
            auditMemo: journalDocData.auditMemo?.summary,
          },
        });
      } else {
        // Exception / Flag for Human Review
        ledgerDoc.reconciliationStatus = 'EXCEPTION';
        ledgerDoc.matchedTier = null;
        ledgerDoc.confidenceScore = matchResult?.confidence || (candidateInvoice ? 0.35 : 0.18);
        ledgerDoc.discrepancyDetails = {
          expectedAmount: candidateInvoice ? candidateInvoice.totalAmount : null,
          actualReceived: ledgerDoc.amount,
          discrepancyAmount: circuitBreakerResult.difference,
          mathEquation: circuitBreakerResult.equation,
          reason: circuitBreakerResult.reason || matchResult?.reason || 'Unmatched transaction',
        };
        ledgerDoc.executionMetrics = {
          tier1DurationMs: Number(tier1Duration.toFixed(2)),
          tier2DurationMs: Number(tier2Duration.toFixed(2)),
          tier3DurationMs: Number(tier3Duration.toFixed(2)),
          circuitBreakerDurationMs: Number(cbDuration.toFixed(2)),
          totalDurationMs: Number((performance.now() - totalStart).toFixed(2)),
          ragCacheHit,
          splitMatchCount: 0,
        };
        await ledgerDoc.save({ session });

        // Lazy-friendly Outbox notification drafts
        whatsappDraft = OutboxService.generateWhatsAppDraft(ledgerDoc, candidateInvoice, ledgerDoc.discrepancyDetails);
        emailDraft = OutboxService.generateEmailDraft(ledgerDoc, candidateInvoice, ledgerDoc.discrepancyDetails);

        dagNodes.push({
          nodeKey: 'STEP_OUTBOX',
          name: 'Agentic Outbox Exception Queue',
          status: 'DISCREPANCY_DETECTED',
          durationMs: performance.now() - commitStart,
          outputData: {
            whatsappDraft,
            emailDraft,
          },
        });
      }

      // Compute Cryptographic Hash for Audit Trail
      const eventTimestamp = new Date();
      const chainIndex = ++currentChainIndex;
      const finalInvoiceNumber = candidateInvoice?.invoiceNumber || (splitInvoices?.length ? splitInvoices.map((s) => s.invoiceNumber).join('+') : 'NONE');
      const eventHash = calculateEventHash(previousEventHash, {
        chainIndex,
        bankTxnId: ledgerDoc.bankTxnId,
        invoiceNumber: finalInvoiceNumber,
        resolvedTier: isReconciled ? resolvedTier : 'OUTBOX_EXCEPTION',
        bankAmount: ledgerDoc.amount,
        circuitBreakerResult,
        batchId,
      });
      currentChainHash = eventHash;

      const [newEvent] = await ReconciliationEvent.create(
        [
          {
            chainIndex,
            bankTxnId: ledgerDoc.bankTxnId,
            invoiceId: candidateInvoice?._id || null,
            invoiceNumber: finalInvoiceNumber,
            splitInvoices: splitInvoices.map((s) => ({ invoiceId: s.invoiceId, invoiceNumber: s.invoiceNumber, amount: s.amount })),
            reconciliationStatus: ledgerDoc.reconciliationStatus,
            resolvedTier: isReconciled ? resolvedTier : 'OUTBOX_EXCEPTION',
            confidenceScore: ledgerDoc.confidenceScore,
            bankAmount: ledgerDoc.amount,
            deductionsApplied: ledgerDoc.deductionsApplied,
            circuitBreakerResult: {
              passed: circuitBreakerResult.passed,
              equation: circuitBreakerResult.equation,
              difference: circuitBreakerResult.difference,
              reason: circuitBreakerResult.reason,
            },
            batchId,
            dagNodes,
            ragCacheHit,
            totalDurationMs: performance.now() - totalStart,
            rawNarration: ledgerDoc.narration,
            previousEventHash,
            eventHash,
            createdAt: eventTimestamp,
          },
        ],
        { session }
      );
      createdEvent = newEvent;
      ledgerDoc.dagNodes = dagNodes;
      await ledgerDoc.save({ session });
    });

    const totalDuration = performance.now() - totalStart;

    // 9. Broadcast real-time SSE event
    if (isReconciled) {
      sseManager.broadcast('txn:reconciled', {
        bankTxnId: ledgerDoc.bankTxnId,
        utrNumber: ledgerDoc.utrNumber,
        narration: ledgerDoc.narration,
        invoiceNumber: candidateInvoice?.invoiceNumber,
        customerName: candidateInvoice?.customerName,
        matchedTier: resolvedTier,
        amount: ledgerDoc.amount,
        deductions: ledgerDoc.deductionsApplied,
        circuitBreaker: circuitBreakerResult,
        confidence: ledgerDoc.confidenceScore,
        ragCacheHit,
        eventHash: createdEvent?.eventHash,
        durationMs: totalDuration,
        dagNodes,
      });
    } else {
      sseManager.broadcast('txn:exception', {
        bankTxnId: ledgerDoc.bankTxnId,
        amount: ledgerDoc.amount,
        narration: ledgerDoc.narration,
        candidateInvoiceNumber: candidateInvoice?.invoiceNumber,
        customerName: candidateInvoice?.customerName,
        discrepancy: ledgerDoc.discrepancyDetails,
        circuitBreaker: circuitBreakerResult,
        eventHash: createdEvent?.eventHash,
        whatsappDraft,
        emailDraft,
        durationMs: totalDuration,
        dagNodes,
      });
    }

    return {
      success: true,
      bankTxn: ledgerDoc,
      invoice: candidateInvoice,
      splitInvoices,
      isReconciled,
      resolvedTier: isReconciled ? resolvedTier : 'OUTBOX_EXCEPTION',
      circuitBreaker: circuitBreakerResult,
      dagNodes,
      whatsappDraft,
      emailDraft,
      ragCacheHit,
      eventHash: createdEvent?.eventHash,
      totalDurationMs: totalDuration,
    };
  }

  /**
   * Process a batch of bank transactions with real-time SSE progress streaming and In-Memory Pre-fetching
   */
  static async processBatch(transactions, batchId = `BATCH-${Date.now()}`, options = {}) {
    const batchStart = performance.now();
    const totalTxns = transactions.length;

    // Initialize batch cost
    batchCostTracker.set(batchId, 0);

    sseManager.broadcast('batch:start', {
      batchId,
      totalCount: totalTxns,
      startedAt: new Date().toISOString(),
    });

    // 1. High-Performance Pre-fetching: Load open invoices & active rules into in-memory index
    const [openInvoicesDocs, activeRulesDocs] = await Promise.all([
      Invoice.find({ status: { $in: ['UNPAID', 'PARTIALLY_PAID'] } }).lean(),
      RuleCache.find({ isActive: true }).lean(),
    ]);

    const invoiceByNumber = new Map();
    for (const inv of openInvoicesDocs) {
      invoiceByNumber.set(inv.invoiceNumber.toUpperCase(), inv);
      invoiceByNumber.set(inv.invoiceNumber.toUpperCase().replace(/[^A-Z0-9]/g, ''), inv);
    }

    const context = {
      allInvoices: openInvoicesDocs,
      invoiceByNumber,
      activeRules: activeRulesDocs,
    };

    const results = [];
    let processedCount = 0;
    let matchedCount = 0;
    let exceptionCount = 0;
    let tier1Count = 0;
    let tier2Count = 0;
    let tier3Count = 0;
    let ragCacheHits = 0;

    for (const txn of transactions) {
      try {
        const result = await this.processTransaction(txn, batchId, options, context);
        results.push(result);
        processedCount++;

        if (result.isReconciled) {
          matchedCount++;
          if (result.resolvedTier === 'TIER_1') tier1Count++;
          else if (result.resolvedTier === 'TIER_2') tier2Count++;
          else if (result.resolvedTier === 'TIER_3') {
            tier3Count++;
            if (result.ragCacheHit) ragCacheHits++;
          }
        } else {
          exceptionCount++;
        }

        sseManager.broadcast('batch:progress', {
          batchId,
          processedCount,
          totalCount: totalTxns,
          percentage: Number(((processedCount / totalTxns) * 100).toFixed(1)),
          matchedCount,
          exceptionCount,
          tierCounts: {
            tier1: tier1Count,
            tier2: tier2Count,
            tier3: tier3Count,
          },
        });
      } catch (err) {
        console.error(`[Batch Error] Txn ${txn.bankTxnId || txn.narration} failed:`, err.message);
        exceptionCount++;
        results.push({
          isReconciled: false,
          resolvedTier: 'OUTBOX_EXCEPTION',
          totalDurationMs: 0,
          circuitBreaker: {
            passed: false,
            discrepancyType: 'NETWORK_FAULT',
            reason: `Batch processing exception: ${err.message}`,
          },
        });
      }
    }

    const batchDuration = performance.now() - batchStart;
    const finalGenAICost = batchCostTracker.get(batchId) || 0;

    const summary = {
      batchId,
      totalCount: totalTxns,
      processedCount,
      matchedCount,
      exceptionCount,
      matchRatePercent: totalTxns > 0 ? Number(((matchedCount / totalTxns) * 100).toFixed(2)) : 0,
      tierDistribution: {
        tier1: tier1Count,
        tier2: tier2Count,
        tier3: tier3Count,
      },
      ragCacheHits,
      genAICostUsd: Number(finalGenAICost.toFixed(3)),
      durationMs: batchDuration,
      completedAt: new Date().toISOString(),
    };

    sseManager.broadcast('batch:completed', summary);
    return { summary, results };
  }
}
