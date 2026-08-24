import { generateIdempotencyHash, calculateEventHash, GENESIS_HASH } from '../utils/hasher.js';
import { matchTier1 } from './tier1Matcher.js';
import { matchTier2 } from './tier2ToleranceMatcher.js';
import { matchTier3 } from './tier3RuleCacheMatcher.js';
import { matchTier4 } from './tier4GenAIPool.js';
import { validateCircuitBreaker } from './circuitBreaker.js';
import { BankLedger } from '../models/BankLedger.js';
import { Invoice } from '../models/Invoice.js';
import { ReconciliationEvent } from '../models/ReconciliationEvent.js';
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

export class ReconciliationEngine {
  /**
   * Reconciles a single bank transaction through the 4-Tier Cascaded Pipeline
   */
  static async processTransaction(rawTxn, batchId = null, options = {}) {
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
    let tier4Duration = 0;
    let ragCacheHit = false;

    // -----------------------------------------------------------------------
    // 2. Tier 1: Deterministic Exact Matcher (<2ms)
    // -----------------------------------------------------------------------
    const t1Res = await matchTier1(ledgerDoc);
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
      dagNodes.push({ nodeKey: 'STEP_TIER_2', name: 'Tier 2: Tolerance & Split Matcher', tier: 'TIER_2', status: 'BYPASSED', durationMs: 0 });
      dagNodes.push({ nodeKey: 'STEP_TIER_3', name: 'Tier 3: Self-Healing Rule Cache', tier: 'TIER_3', status: 'BYPASSED', durationMs: 0 });
      dagNodes.push({ nodeKey: 'STEP_TIER_4', name: 'Tier 4: GenAI & RAG Worker Pool', tier: 'TIER_4', status: 'BYPASSED', durationMs: 0 });
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
      // 3. Tier 2: Tolerance, Explainable-Delta & Bounded Split-Match (<5ms)
      // ---------------------------------------------------------------------
      const t2Res = await matchTier2(ledgerDoc);
      tier2Duration = t2Res.durationMs;

      if (t2Res.matched) {
        matchResult = t2Res;
        resolvedTier = 'TIER_2';
        dagNodes.push({
          nodeKey: 'STEP_TIER_2',
          name: 'Tier 2: Tolerance & Split Matcher',
          tier: 'TIER_2',
          status: 'SUCCESS',
          durationMs: t2Res.durationMs,
          outputData: {
            matchType: t2Res.matchType,
            invoiceNumber: t2Res.invoice?.invoiceNumber,
            splitCount: t2Res.splitInvoices?.length || 1,
            explanation: t2Res.explanation,
          },
        });
        dagNodes.push({ nodeKey: 'STEP_TIER_3', name: 'Tier 3: Self-Healing Rule Cache', tier: 'TIER_3', status: 'BYPASSED', durationMs: 0 });
        dagNodes.push({ nodeKey: 'STEP_TIER_4', name: 'Tier 4: GenAI & RAG Worker Pool', tier: 'TIER_4', status: 'BYPASSED', durationMs: 0 });
      } else {
        dagNodes.push({
          nodeKey: 'STEP_TIER_2',
          name: 'Tier 2: Tolerance & Split Matcher',
          tier: 'TIER_2',
          status: 'FAILED',
          durationMs: t2Res.durationMs,
          outputData: { reason: t2Res.reason || 'Delta not explainable by standard statutory tables' },
        });

        // -------------------------------------------------------------------
        // 4. Tier 3: Self-Healing Rule Cache (<10ms)
        // -------------------------------------------------------------------
        const t3Res = await matchTier3(ledgerDoc);
        tier3Duration = t3Res.durationMs;

        if (t3Res.matched) {
          matchResult = t3Res;
          resolvedTier = 'TIER_3';
          dagNodes.push({
            nodeKey: 'STEP_TIER_3',
            name: 'Tier 3: Self-Healing Rule Cache',
            tier: 'TIER_3',
            status: 'SUCCESS',
            durationMs: t3Res.durationMs,
            outputData: {
              matchType: t3Res.matchType,
              ruleId: t3Res.ruleApplied?._id,
              invoiceNumber: t3Res.invoice?.invoiceNumber,
            },
          });
          dagNodes.push({ nodeKey: 'STEP_TIER_4', name: 'Tier 4: GenAI & RAG Worker Pool', tier: 'TIER_4', status: 'BYPASSED', durationMs: 0 });
        } else {
          dagNodes.push({
            nodeKey: 'STEP_TIER_3',
            name: 'Tier 3: Self-Healing Rule Cache',
            tier: 'TIER_3',
            status: 'FAILED',
            durationMs: t3Res.durationMs,
            outputData: { reason: 'No matching historical vendor pattern rule' },
          });

          // -----------------------------------------------------------------
          // 5. Cost Circuit Breaker Check before Tier 4 GenAI Call
          // -----------------------------------------------------------------
          const currentBatchCost = batchCostTracker.get(batchId) || 0;
          const maxBatchCost = options.maxGenAICost || 0.50; // Default $0.50 ceiling per batch

          if (currentBatchCost >= maxBatchCost) {
            // Cost Circuit Breaker Tripped!
            sseManager.broadcast('cost_breaker:triggered', {
              batchId,
              currentBatchCost,
              maxBatchCost,
              message: `GenAI Spend Ceiling ($${maxBatchCost}) reached. Tripping Cost Circuit Breaker.`,
            });

            dagNodes.push({
              nodeKey: 'STEP_TIER_4',
              name: 'Tier 4: GenAI & RAG Worker Pool',
              tier: 'TIER_4',
              status: 'BYPASSED',
              durationMs: 0.1,
              outputData: { costCapTriggered: true, currentBatchCost, maxBatchCost },
            });

            matchResult = {
              matched: false,
              tier: 'TIER_4',
              confidence: 0,
              reason: `Cost Circuit Breaker tripped (Batch spend $${currentBatchCost.toFixed(3)} >= $${maxBatchCost}). Routed to Exception Outbox.`,
            };
            resolvedTier = 'OUTBOX_EXCEPTION';
          } else {
            // ---------------------------------------------------------------
            // 6. Tier 4: Concurrency-Controlled GenAI Worker Pool with RAG Cache
            // ---------------------------------------------------------------
            sseManager.broadcast('txn:tier4_processing', {
              bankTxnId: ledgerDoc.bankTxnId,
            });

            const t4Res = await matchTier4(ledgerDoc, options);
            tier4Duration = t4Res.durationMs;
            ragCacheHit = Boolean(t4Res.ragCacheHit);

            // Update batch GenAI cost (RAG cache hits cost $0.000, real calls cost $0.005)
            const callCost = ragCacheHit ? 0.000 : 0.005;
            batchCostTracker.set(batchId, currentBatchCost + callCost);

            if (t4Res.matched) {
              matchResult = t4Res;
              resolvedTier = 'TIER_4';
              dagNodes.push({
                nodeKey: 'STEP_TIER_4',
                name: 'Tier 4: GenAI & RAG Worker Pool',
                tier: 'TIER_4',
                status: 'SUCCESS',
                durationMs: t4Res.durationMs,
                outputData: {
                  invoiceNumber: t4Res.invoice?.invoiceNumber,
                  aiReasoning: t4Res.aiExtraction?.reasoningSummary,
                  ragCacheHit,
                  confidence: t4Res.confidence,
                },
              });
            } else {
              matchResult = t4Res;
              resolvedTier = 'OUTBOX_EXCEPTION';
              dagNodes.push({
                nodeKey: 'STEP_TIER_4',
                name: 'Tier 4: GenAI & RAG Worker Pool',
                tier: 'TIER_4',
                status: t4Res.potentialInvoice ? 'DISCREPANCY_DETECTED' : 'FAILED',
                durationMs: t4Res.durationMs,
                outputData: {
                  reason: t4Res.reason,
                  aiExtraction: t4Res.aiExtraction,
                  ragCacheHit,
                },
              });
            }
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // 7. Node.js Zero-Trust Math Circuit Breaker
    // -----------------------------------------------------------------------
    const candidateInvoice = matchResult?.invoice || matchResult?.potentialInvoice;
    const splitInvoices = matchResult?.splitInvoices || [];
    let circuitBreakerResult = null;
    let cbDuration = 0;

    if (candidateInvoice) {
      circuitBreakerResult = validateCircuitBreaker(
        candidateInvoice,
        ledgerDoc.amount,
        matchResult.deductions || {},
        splitInvoices
      );
      cbDuration = circuitBreakerResult.durationMs;

      dagNodes.push({
        nodeKey: 'STEP_CIRCUIT_BREAKER',
        name: 'Node.js Math Circuit Breaker',
        status: circuitBreakerResult.passed ? 'SUCCESS' : 'DISCREPANCY_DETECTED',
        durationMs: circuitBreakerResult.durationMs,
        outputData: circuitBreakerResult,
      });
    } else {
      circuitBreakerResult = {
        passed: false,
        difference: ledgerDoc.amount,
        equation: `₹${ledgerDoc.amount} (Bank) vs No matching invoice found`,
        invoiceGross: 0,
        deductionsTotal: 0,
        bankReceived: ledgerDoc.amount,
        durationMs: 0.1,
        status: 'NO_CANDIDATE_INVOICE',
        reason: 'No invoice candidate found across all tiers.',
      };
      dagNodes.push({
        nodeKey: 'STEP_CIRCUIT_BREAKER',
        name: 'Node.js Math Circuit Breaker',
        status: 'FAILED',
        durationMs: 0.1,
        outputData: circuitBreakerResult,
      });
    }

    // -----------------------------------------------------------------------
    // 8. State Resolution & ACID Transaction Commit with Cryptographic Hash Chain
    // -----------------------------------------------------------------------
    const commitStart = performance.now();
    const isReconciled = Boolean(matchResult?.matched && circuitBreakerResult?.passed);

    let whatsappDraft = null;
    let emailDraft = null;
    let createdEvent = null;

    // Fetch and maintain running cryptographic chain pointer
    if (!currentChainHash) {
      await resetChainPointer();
    }
    const previousEventHash = currentChainHash;

    await withTransaction(async (session) => {
      if (isReconciled && candidateInvoice) {
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
          tier4DurationMs: Number(tier4Duration.toFixed(2)),
          circuitBreakerDurationMs: Number(cbDuration.toFixed(2)),
          totalDurationMs: Number((performance.now() - totalStart).toFixed(2)),
          ragCacheHit,
          splitMatchCount: splitInvoices.length,
        };
        await ledgerDoc.save({ session });

        // Update Invoices (Handle single or multi-invoice split settlement)
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
                    : resolvedTier === 'TIER_3'
                    ? 'TIER_3_RULE'
                    : 'TIER_4_GENAI',
              },
            },
            { session }
          );
        }

        dagNodes.push({
          nodeKey: 'STEP_COMMIT',
          name: 'ACID Multi-Doc Commit (PAID)',
          status: 'SUCCESS',
          durationMs: performance.now() - commitStart,
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
          tier4DurationMs: Number(tier4Duration.toFixed(2)),
          circuitBreakerDurationMs: Number(cbDuration.toFixed(2)),
          totalDurationMs: Number((performance.now() - totalStart).toFixed(2)),
          ragCacheHit,
          splitMatchCount: 0,
        };
        await ledgerDoc.save({ session });

        // Generate Outbox notification drafts
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
      const eventHash = calculateEventHash(previousEventHash, {
        chainIndex,
        bankTxnId: ledgerDoc.bankTxnId,
        invoiceNumber: candidateInvoice ? candidateInvoice.invoiceNumber : 'NONE',
        resolvedTier: isReconciled ? resolvedTier : 'OUTBOX_EXCEPTION',
        amount: ledgerDoc.amount,
        circuitBreakerResult,
        batchId,
      });

      // Advance running chain pointer
      currentChainHash = eventHash;

      // Record Cryptographically Chained Reconciliation Event
      const [newEvent] = await ReconciliationEvent.create(
        [
          {
            chainIndex,
            bankTxnId: ledgerDoc.bankTxnId,
            invoiceId: candidateInvoice ? candidateInvoice._id : null,
            invoiceNumber: candidateInvoice ? candidateInvoice.invoiceNumber : null,
            splitInvoices,
            batchId,
            dagNodes,
            resolvedTier: isReconciled ? resolvedTier : 'OUTBOX_EXCEPTION',
            circuitBreakerResult,
            confidence: matchResult?.confidence || (isReconciled ? 0.95 : candidateInvoice ? 0.35 : 0.18),
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
   * Process a batch of bank transactions with real-time SSE progress streaming
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

    const results = [];
    let processedCount = 0;
    let matchedCount = 0;
    let exceptionCount = 0;
    let tier1Count = 0;
    let tier2Count = 0;
    let tier3Count = 0;
    let tier4Count = 0;
    let ragCacheHits = 0;

    for (const txn of transactions) {
      try {
        const result = await this.processTransaction(txn, batchId, options);
        results.push(result);
        processedCount++;

        if (result.isReconciled) {
          matchedCount++;
          if (result.resolvedTier === 'TIER_1') tier1Count++;
          else if (result.resolvedTier === 'TIER_2') tier2Count++;
          else if (result.resolvedTier === 'TIER_3') tier3Count++;
          else if (result.resolvedTier === 'TIER_4') {
            tier4Count++;
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
            tier4: tier4Count,
          },
        });
      } catch (err) {
        console.error(`[Batch Error] Txn ${txn.bankTxnId || txn.narration} failed:`, err);
        exceptionCount++;
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
        tier4: tier4Count,
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
