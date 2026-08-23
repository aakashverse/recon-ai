import { generateIdempotencyHash } from '../utils/hasher.js';
import { matchTier1 } from './tier1Matcher.js';
import { matchTier2 } from './tier2CacheMatcher.js';
import { matchTier3 } from './tier3GenAIPool.js';
import { validateCircuitBreaker } from './circuitBreaker.js';
import { BankLedger } from '../models/BankLedger.js';
import { Invoice } from '../models/Invoice.js';
import { ReconciliationEvent } from '../models/ReconciliationEvent.js';
import { OutboxService } from './outboxService.js';
import { withTransaction } from '../config/db.js';
import { sseManager } from '../utils/sseManager.js';

export class ReconciliationEngine {
  /**
   * Reconciles a single bank transaction through the 3-Tier Cascaded Pipeline
   */
  static async processTransaction(rawTxn, batchId = null) {
    const totalStart = performance.now();
    const dagNodes = [];

    // 1. Ingestion & Idempotency Guard
    const ingestStart = performance.now();
    const hash = generateIdempotencyHash(rawTxn);
    const bankTxnId = rawTxn.bankTxnId || `TXN-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    let existingTxn = await BankLedger.findOne({ idempotencyHash: hash });

    if (existingTxn && existingTxn.reconciliationStatus === 'MATCHED') {
      dagNodes.push({
        nodeKey: 'STEP_INGEST',
        name: 'Idempotency Guard Check',
        status: 'SUCCESS',
        durationMs: performance.now() - ingestStart,
        outputData: { duplicateDetected: true, message: 'Replay rejected: Transaction already processed & reconciled.' },
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

    // 2. Tier 1: Deterministic Exact Matcher (<2ms)
    const t1Res = await matchTier1(ledgerDoc);
    tier1Duration = t1Res.durationMs;

    if (t1Res.matched) {
      matchResult = t1Res;
      resolvedTier = 'TIER_1';
      dagNodes.push({
        nodeKey: 'STEP_TIER_1',
        name: 'Tier 1: Deterministic Math Matcher',
        tier: 'TIER_1',
        status: 'SUCCESS',
        durationMs: t1Res.durationMs,
        outputData: { matchType: t1Res.matchType, invoiceNumber: t1Res.invoice?.invoiceNumber },
      });
      dagNodes.push({
        nodeKey: 'STEP_TIER_2',
        name: 'Tier 2: Rule Cache',
        tier: 'TIER_2',
        status: 'BYPASSED',
        durationMs: 0,
      });
      dagNodes.push({
        nodeKey: 'STEP_TIER_3',
        name: 'Tier 3: GenAI Worker Pool',
        tier: 'TIER_3',
        status: 'BYPASSED',
        durationMs: 0,
      });
    } else {
      dagNodes.push({
        nodeKey: 'STEP_TIER_1',
        name: 'Tier 1: Deterministic Math Matcher',
        tier: 'TIER_1',
        status: 'FAILED',
        durationMs: t1Res.durationMs,
        outputData: { reason: 'No exact hash/UTR match' },
      });

      // 3. Tier 2: Self-Healing Rule Cache (<20ms)
      const t2Res = await matchTier2(ledgerDoc);
      tier2Duration = t2Res.durationMs;

      if (t2Res.matched) {
        matchResult = t2Res;
        resolvedTier = 'TIER_2';
        dagNodes.push({
          nodeKey: 'STEP_TIER_2',
          name: 'Tier 2: Self-Healing Rule Cache',
          tier: 'TIER_2',
          status: 'SUCCESS',
          durationMs: t2Res.durationMs,
          outputData: {
            matchType: t2Res.matchType,
            ruleId: t2Res.ruleApplied?._id,
            invoiceNumber: t2Res.invoice?.invoiceNumber,
          },
        });
        dagNodes.push({
          nodeKey: 'STEP_TIER_3',
          name: 'Tier 3: GenAI Worker Pool',
          tier: 'TIER_3',
          status: 'BYPASSED',
          durationMs: 0,
        });
      } else {
        dagNodes.push({
          nodeKey: 'STEP_TIER_2',
          name: 'Tier 2: Self-Healing Rule Cache',
          tier: 'TIER_2',
          status: 'FAILED',
          durationMs: t2Res.durationMs,
          outputData: { reason: 'No matching historical vendor rule' },
        });

        // 4. Tier 3: Concurrency-Controlled GenAI Pool (p-limit 5)
        sseManager.broadcast('txn:tier3_processing', {
          bankTxnId: ledgerDoc.bankTxnId,
        });

        const t3Res = await matchTier3(ledgerDoc);
        tier3Duration = t3Res.durationMs;

        if (t3Res.matched) {
          matchResult = t3Res;
          resolvedTier = 'TIER_3';
          dagNodes.push({
            nodeKey: 'STEP_TIER_3',
            name: 'Tier 3: GenAI & Vision Pool',
            tier: 'TIER_3',
            status: 'SUCCESS',
            durationMs: t3Res.durationMs,
            outputData: {
              invoiceNumber: t3Res.invoice?.invoiceNumber,
              aiReasoning: t3Res.aiExtraction?.reasoningSummary,
              confidence: t3Res.confidence,
            },
          });
        } else {
          matchResult = t3Res; // Contains potential invoice or failure reason
          resolvedTier = 'OUTBOX_EXCEPTION';
          dagNodes.push({
            nodeKey: 'STEP_TIER_3',
            name: 'Tier 3: GenAI & Vision Pool',
            tier: 'TIER_3',
            status: t3Res.potentialInvoice ? 'DISCREPANCY_DETECTED' : 'FAILED',
            durationMs: t3Res.durationMs,
            outputData: {
              reason: t3Res.reason,
              aiExtraction: t3Res.aiExtraction,
            },
          });
        }
      }
    }

    // 5. The Circuit Breaker Evaluation
    const candidateInvoice = matchResult?.invoice || matchResult?.potentialInvoice;
    let circuitBreakerResult = null;
    let cbDuration = 0;

    if (candidateInvoice) {
      circuitBreakerResult = validateCircuitBreaker(
        candidateInvoice,
        ledgerDoc.amount,
        matchResult.deductions || {}
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

    // 6. State Resolution & ACID Transaction Commit
    const commitStart = performance.now();
    const isReconciled = Boolean(matchResult?.matched && circuitBreakerResult?.passed);

    let whatsappDraft = null;
    let emailDraft = null;

    await withTransaction(async (session) => {
      if (isReconciled && candidateInvoice) {
        // Update Ledger
        ledgerDoc.reconciliationStatus = 'MATCHED';
        ledgerDoc.matchedTier = resolvedTier;
        ledgerDoc.reconciledInvoiceId = candidateInvoice._id;
        ledgerDoc.confidenceScore = matchResult.confidence || 1.0;
        ledgerDoc.deductionsApplied = matchResult.deductions || {};
        ledgerDoc.executionMetrics = {
          tier1DurationMs: Number(tier1Duration.toFixed(2)),
          tier2DurationMs: Number(tier2Duration.toFixed(2)),
          tier3DurationMs: Number(tier3Duration.toFixed(2)),
          circuitBreakerDurationMs: Number(cbDuration.toFixed(2)),
          totalDurationMs: Number((performance.now() - totalStart).toFixed(2)),
        };
        await ledgerDoc.save({ session });

        // Update Invoice
        await Invoice.updateOne(
          { _id: candidateInvoice._id },
          {
            $set: {
              status: 'PAID',
              paidAmount: ledgerDoc.amount,
              reconciledBankTxnId: ledgerDoc._id,
              reconciledAt: new Date(),
              reconMethod: resolvedTier === 'TIER_1' ? 'TIER_1_EXACT' : resolvedTier === 'TIER_2' ? 'TIER_2_RULE' : 'TIER_3_GENAI',
            },
          },
          { session }
        );

        dagNodes.push({
          nodeKey: 'STEP_COMMIT',
          name: 'ACID Multi-Doc Commit (PAID)',
          status: 'SUCCESS',
          durationMs: performance.now() - commitStart,
        });
      } else {
        // Exception / Flag for human
        ledgerDoc.reconciliationStatus = 'EXCEPTION';
        ledgerDoc.matchedTier = null;
        ledgerDoc.confidenceScore = matchResult?.confidence || 0.2;
        ledgerDoc.discrepancyDetails = {
          expectedAmount: candidateInvoice ? candidateInvoice.totalAmount : null,
          actualReceived: ledgerDoc.amount,
          discrepancyAmount: circuitBreakerResult.difference,
          mathEquation: circuitBreakerResult.equation,
          reason: circuitBreakerResult.reason || 'Unmatched transaction',
        };
        ledgerDoc.executionMetrics = {
          tier1DurationMs: Number(tier1Duration.toFixed(2)),
          tier2DurationMs: Number(tier2Duration.toFixed(2)),
          tier3DurationMs: Number(tier3Duration.toFixed(2)),
          circuitBreakerDurationMs: Number(cbDuration.toFixed(2)),
          totalDurationMs: Number((performance.now() - totalStart).toFixed(2)),
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

      // Record DAG Audit Event
      await ReconciliationEvent.create(
        [
          {
            bankTxnId: ledgerDoc.bankTxnId,
            invoiceId: candidateInvoice ? candidateInvoice._id : null,
            invoiceNumber: candidateInvoice ? candidateInvoice.invoiceNumber : null,
            batchId,
            dagNodes,
            resolvedTier: isReconciled ? resolvedTier : 'OUTBOX_EXCEPTION',
            circuitBreakerResult,
            confidence: matchResult?.confidence || (isReconciled ? 1.0 : 0.2),
            totalDurationMs: performance.now() - totalStart,
            rawNarration: ledgerDoc.narration,
          },
        ],
        { session }
      );
    });

    const totalDuration = performance.now() - totalStart;

    // 7. Broadcast real-time SSE event
    if (isReconciled) {
      sseManager.broadcast('txn:reconciled', {
        bankTxnId: ledgerDoc.bankTxnId,
        invoiceNumber: candidateInvoice?.invoiceNumber,
        customerName: candidateInvoice?.customerName,
        matchedTier: resolvedTier,
        amount: ledgerDoc.amount,
        deductions: ledgerDoc.deductionsApplied,
        circuitBreaker: circuitBreakerResult,
        confidence: ledgerDoc.confidenceScore,
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
      isReconciled,
      resolvedTier: isReconciled ? resolvedTier : 'OUTBOX_EXCEPTION',
      circuitBreaker: circuitBreakerResult,
      dagNodes,
      whatsappDraft,
      emailDraft,
      totalDurationMs: totalDuration,
    };
  }

  /**
   * Process a batch of 50+ bank transactions with real-time SSE progress streaming
   */
  static async processBatch(transactions, batchId = `BATCH-${Date.now()}`) {
    const batchStart = performance.now();
    const totalTxns = transactions.length;

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

    for (const txn of transactions) {
      try {
        const result = await this.processTransaction(txn, batchId);
        results.push(result);
        processedCount++;

        if (result.isReconciled) {
          matchedCount++;
          if (result.resolvedTier === 'TIER_1') tier1Count++;
          else if (result.resolvedTier === 'TIER_2') tier2Count++;
          else if (result.resolvedTier === 'TIER_3') tier3Count++;
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
          tierCounts: { tier1: tier1Count, tier2: tier2Count, tier3: tier3Count },
        });
      } catch (err) {
        console.error(`[Batch Error] Txn ${txn.bankTxnId || txn.narration} failed:`, err);
        exceptionCount++;
      }
    }

    const batchDuration = performance.now() - batchStart;

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
      durationMs: batchDuration,
      completedAt: new Date().toISOString(),
    };

    sseManager.broadcast('batch:completed', summary);
    return { summary, results };
  }
}
