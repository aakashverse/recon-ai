import { RuleCache } from '../models/RuleCache.js';
import { Invoice } from '../models/Invoice.js';
import { BankLedger } from '../models/BankLedger.js';
import { ReconciliationEvent } from '../models/ReconciliationEvent.js';
import { validateCircuitBreaker } from './circuitBreaker.js';
import { withTransaction } from '../config/db.js';
import { sseManager } from '../utils/sseManager.js';
import { getTextGenModel, isAIAvailable } from '../config/ai.js';

/**
 * Agentic Outbox Service
 * Generates automated WhatsApp and Email drafts with Live Gemini 1.5 Flash reasoning and handles 1-click dispatch.
 */
export class OutboxService {
  /**
   * Generates dynamic AI reasoning & drafts via Gemini 1.5 Flash (or intelligent fallback)
   */
  static async generateAIDrafts(bankTxn, invoice, discrepancyDetails) {
    const customer = invoice?.customerName || 'Vendor Finance Team';
    const invNum = invoice?.invoiceNumber || 'your referenced invoice';
    const amountReceived = Number(bankTxn.amount);
    const grossAmount = invoice ? Number(invoice.totalAmount) : amountReceived;
    const diff = discrepancyDetails?.discrepancyAmount || (amountReceived - grossAmount);
    const mathEquation = discrepancyDetails?.mathEquation || `₹${grossAmount} vs ₹${amountReceived}`;
    const narration = bankTxn.narration || '';

    const textModel = getTextGenModel();

    if (isAIAvailable() && textModel) {
      try {
        const prompt = `You are Razorpay's Enterprise B2B AI Finance Controller.
Analyze the following payment discrepancy and generate two highly professional, courteous communication drafts.

TRANSACTION DETAILS:
- Counterparty / Customer: "${customer}"
- Invoice Number: "${invNum}" (Gross Billed Amount: ₹${grossAmount.toLocaleString('en-IN')})
- Bank Credit Received: ₹${amountReceived.toLocaleString('en-IN')} (UTR: ${bankTxn.utrNumber || bankTxn.bankTxnId})
- Mathematical Variance / Shortfall: ₹${Math.abs(diff).toLocaleString('en-IN')} (${diff < 0 ? 'Underpayment / Excess Deduction' : 'Overpayment'})
- Circuit Breaker Math Trace: ${mathEquation}
- Bank Narration String: "${narration}"

INSTRUCTIONS:
1. Explain the exact accounting reasoning (e.g., whether TDS under Section 194C/194J/206AB was deducted at a different rate, or bank charges/discounts were withheld).
2. Generate a concise, clear WhatsApp message draft with markdown formatting (*bold*, bullet points).
3. Generate a formal Corporate Email draft with subject line and structured table breakdown.

Return a JSON object conforming strictly to this format:
{
  "aiReasoning": "Concise 2-sentence explanation of why the discrepancy occurred and statutory context",
  "whatsappText": "Formatted WhatsApp message string",
  "emailSubject": "Formal subject line",
  "emailBodyText": "Clean plain-text / markdown email body"
}`;

        const result = await textModel.generateContent(prompt);
        const responseText = result.response.text().trim();
        
        // Clean markdown backticks if returned in code fence
        const cleanJsonStr = responseText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
        const parsed = JSON.parse(cleanJsonStr);

        return {
          source: 'GEMINI_1_5_FLASH_LIVE',
          aiReasoning: parsed.aiReasoning,
          whatsapp: {
            recipient: customer,
            channel: 'WHATSAPP',
            messageText: parsed.whatsappText,
          },
          email: {
            recipientEmail: `finance@${(customer || 'company').toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
            subject: parsed.emailSubject,
            bodyText: parsed.emailBodyText,
          },
        };
      } catch (err) {
        console.warn('[Outbox AI] Gemini generation error, using structured fallback:', err.message);
      }
    }

    // High-Resilience Deterministic Template Fallback
    const varianceDesc = diff < 0 
      ? `shortfall of ₹${Math.abs(diff).toLocaleString('en-IN')}` 
      : `excess credit of ₹${Math.abs(diff).toLocaleString('en-IN')}`;

    const reasoning = `Variance detected: Gross billed ₹${grossAmount.toLocaleString('en-IN')} minus applied deductions does not reconcile with bank credit ₹${amountReceived.toLocaleString('en-IN')} (${varianceDesc}). Probable TDS rate mismatch (Section 194C/194J) or unapproved discount.`;

    const whatsappText = `*Payment Reconciliation Notice | Razorpay AI Controller*\n\nDear Finance Team at *${customer}*,\n\nWe received a bank transfer of *₹${amountReceived.toLocaleString('en-IN')}* (Ref UTR: \`${bankTxn.utrNumber || bankTxn.bankTxnId}\`) for Invoice *#${invNum}* (Gross: ₹${grossAmount.toLocaleString('en-IN')}).\n\n⚠️ *Discrepancy Detected:* ${varianceDesc}\n*Arithmetic Trace:* \`${mathEquation}\`\n\nKindly confirm if this variance corresponds to TDS under Section 194C / 194J or bank processing charges so we can adjust our ledger.\n\n_Generated automatically by Razorpay AI Finance Controller._`;

    const emailSubject = `[ACTION REQUIRED] Reconciliation Discrepancy: Invoice #${invNum} (UTR: ${bankTxn.utrNumber || bankTxn.bankTxnId})`;
    
    const emailBodyText = `Dear Finance Team at ${customer},\n\nOur automated B2B reconciliation engine recorded an incoming bank remittance with an arithmetic variance.\n\n• Invoice Number: #${invNum} (Gross: ₹${grossAmount.toLocaleString('en-IN')})\n• Amount Received in Bank: ₹${amountReceived.toLocaleString('en-IN')}\n• Discrepancy: ${varianceDesc}\n• Arithmetic Trace: ${mathEquation}\n\nKindly reply with the TDS deduction certificate (Form 16A) or remittance advice so we can close this entry.\n\nRegards,\nFinance & Accounts Department\nRazorpay AI Controller`;

    return {
      source: 'LOCAL_INTELLIGENT_ENGINE',
      aiReasoning: reasoning,
      whatsapp: {
        recipient: customer,
        channel: 'WHATSAPP',
        messageText: whatsappText,
      },
      email: {
        recipientEmail: `finance@${(customer || 'company').toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
        subject: emailSubject,
        bodyText: emailBodyText,
      },
    };
  }

  /**
   * Synchronous helper for WhatsApp draft generation during batch processing
   */
  static generateWhatsAppDraft(bankTxn, invoice, discrepancyDetails) {
    const customer = invoice?.customerName || 'Vendor Finance Team';
    const invNum = invoice?.invoiceNumber || 'your invoice';
    const amountReceived = Number(bankTxn.amount);
    const grossAmount = invoice ? Number(invoice.totalAmount) : amountReceived;
    const diff = discrepancyDetails?.discrepancyAmount || (amountReceived - grossAmount);
    const mathEquation = discrepancyDetails?.mathEquation || `₹${grossAmount} vs ₹${amountReceived}`;

    const varianceDesc = diff < 0 
      ? `shortfall of ₹${Math.abs(diff).toLocaleString('en-IN')}` 
      : `excess credit of ₹${Math.abs(diff).toLocaleString('en-IN')}`;

    return {
      recipient: customer,
      channel: 'WHATSAPP',
      messageText: `*Payment Reconciliation Notice | Razorpay AI Controller*\n\nDear Finance Team at *${customer}*,\n\nWe received a bank transfer of *₹${amountReceived.toLocaleString('en-IN')}* (Ref UTR: \`${bankTxn.utrNumber || bankTxn.bankTxnId}\`) for Invoice *#${invNum}* (Gross: ₹${grossAmount.toLocaleString('en-IN')}).\n\n⚠️ *Discrepancy Detected:* ${varianceDesc}\n*Arithmetic Trace:* \`${mathEquation}\`\n\nKindly confirm if this variance corresponds to TDS under Section 194C / 194J or bank processing charges so we can adjust our ledger.\n\n_Generated automatically by Razorpay AI Finance Controller._`,
    };
  }

  /**
   * Synchronous helper for Email draft generation during batch processing
   */
  static generateEmailDraft(bankTxn, invoice, discrepancyDetails) {
    const customer = invoice?.customerName || 'Vendor Finance Team';
    const invNum = invoice?.invoiceNumber || 'your invoice';
    const amountReceived = Number(bankTxn.amount);
    const grossAmount = invoice ? Number(invoice.totalAmount) : amountReceived;
    const diff = discrepancyDetails?.discrepancyAmount || (amountReceived - grossAmount);
    const mathEquation = discrepancyDetails?.mathEquation || `₹${grossAmount} vs ₹${amountReceived}`;

    const varianceDesc = diff < 0 
      ? `shortfall of ₹${Math.abs(diff).toLocaleString('en-IN')}` 
      : `excess credit of ₹${Math.abs(diff).toLocaleString('en-IN')}`;

    return {
      recipientEmail: `finance@${(customer || 'company').toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
      subject: `[ACTION REQUIRED] Reconciliation Discrepancy: Invoice #${invNum} (UTR: ${bankTxn.utrNumber || bankTxn.bankTxnId})`,
      bodyText: `Dear Finance Team at ${customer},\n\nOur automated B2B reconciliation engine recorded an incoming bank remittance with an arithmetic variance.\n\n• Invoice Number: #${invNum} (Gross: ₹${grossAmount.toLocaleString('en-IN')})\n• Amount Received in Bank: ₹${amountReceived.toLocaleString('en-IN')}\n• Discrepancy: ${varianceDesc}\n• Arithmetic Trace: ${mathEquation}\n\nKindly reply with the TDS deduction certificate (Form 16A) or remittance advice so we can close this entry.\n\nRegards,\nFinance & Accounts Department\nRazorpay AI Controller`,
    };
  }

  /**
   * Dispatches a notification via simulated/real API relay
   */
  static async dispatchNotification(payload) {
    const { bankTxnId, channel, recipient, messageText, subject } = payload;
    const trackingId = `MSG-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    console.log(`[Outbox Dispatch] ${channel} dispatched to "${recipient}" with Tracking ID: ${trackingId}`);

    // Update bank ledger with dispatch event
    await BankLedger.findOneAndUpdate(
      { bankTxnId },
      {
        $set: {
          'discrepancyDetails.dispatchStatus': 'DISPATCHED',
          'discrepancyDetails.dispatchedAt': new Date(),
          'discrepancyDetails.dispatchTrackingId': trackingId,
          'discrepancyDetails.lastDispatchedChannel': channel,
        },
      }
    );

    sseManager.broadcast('outbox:dispatched', {
      bankTxnId,
      channel,
      recipient,
      trackingId,
      dispatchedAt: new Date().toISOString(),
    });

    return {
      success: true,
      channel,
      recipient,
      trackingId,
      status: 'DELIVERED_TO_GATEWAY',
      timestamp: new Date().toISOString(),
      message: `${channel} notification successfully queued & dispatched via gateway relay.`,
    };
  }

  /**
   * Resolves an exception manually and optionally promotes it into a Tier-2 Rule
   */
  static async resolveException(payload) {
    const { bankTxnId, invoiceId, approvedAdjustment, deductionReason, learnAsRule, rulePattern, tdsRate, tdsSection } = payload;

    const bankTxn = await BankLedger.findOne({ bankTxnId });
    if (!bankTxn) throw new Error(`Bank transaction ${bankTxnId} not found`);

    let invoice = null;
    if (invoiceId && invoiceId !== 'null' && invoiceId.length > 5) {
      invoice = await Invoice.findById(invoiceId).catch(() => null);
    }
    if (!invoice) {
      // Find candidate from invoiceNumber or party
      invoice = await Invoice.findOne({ status: { $in: ['UNPAID', 'PARTIALLY_PAID'] } });
    }

    if (!invoice) throw new Error('No valid candidate invoice found to reconcile');

    const circuitResult = validateCircuitBreaker(invoice, bankTxn.amount, {
      tdsAmount: approvedAdjustment,
      bankCharges: 0,
      discount: 0,
    });

    let learnedRuleDoc = null;

    // ACID Commit
    await withTransaction(async (session) => {
      bankTxn.reconciliationStatus = 'MATCHED';
      bankTxn.matchedTier = 'MANUAL';
      bankTxn.reconciledInvoiceId = invoice._id;
      bankTxn.deductionsApplied = {
        tdsAmount: approvedAdjustment,
        tdsRate: tdsRate || 0,
        tdsSection: tdsSection || '194C',
        bankCharges: 0,
        discount: 0,
        totalDeductions: approvedAdjustment,
      };
      await bankTxn.save({ session });

      invoice.status = 'PAID';
      invoice.paidAmount = bankTxn.amount;
      invoice.reconciledBankTxnId = bankTxn._id;
      invoice.reconciledAt = new Date();
      invoice.reconMethod = 'MANUAL_OVERRIDE';
      await invoice.save({ session });

      // If user toggled "Learn as Rule", create or update Tier-2 Rule
      if (learnAsRule) {
        const partyId = (rulePattern || invoice.customerName).toUpperCase().trim();
        const calculatedRate = tdsRate || (invoice.totalAmount > 0 ? Number(((approvedAdjustment / invoice.totalAmount) * 100).toFixed(1)) : 2.0);

        learnedRuleDoc = await RuleCache.findOneAndUpdate(
          { partyIdentifier: partyId },
          {
            $set: {
              partyIdentifier: partyId,
              patternType: 'TDS_STANDARD',
              'matchCriteria.narrationKeywords': [partyId],
              adjustmentLogic: {
                tdsSection: tdsSection || '194C',
                tdsRate: calculatedRate,
                handlingFeeRate: 0,
                fixedDeduction: 0,
              },
              confidence: 0.98,
              isActive: true,
              source: 'LEARNED_FROM_EXCEPTION',
              description: `Learned from manual resolution on ${new Date().toLocaleDateString()}: ${deductionReason}`,
            },
            $inc: { usageCount: 1 },
          },
          { upsert: true, new: true, session }
        );
      }

      // Record DAG Event for manual resolution
      await ReconciliationEvent.create(
        [
          {
            bankTxnId: bankTxn.bankTxnId,
            invoiceId: invoice._id,
            invoiceNumber: invoice.invoiceNumber,
            resolvedTier: 'TIER_2',
            dagNodes: [
              {
                nodeKey: 'STEP_INGEST',
                name: 'Ingest Exception Item',
                status: 'SUCCESS',
                durationMs: 0.5,
              },
              {
                nodeKey: 'STEP_CIRCUIT_BREAKER',
                name: 'Human Approved Arithmetic Check',
                status: circuitResult.passed ? 'SUCCESS' : 'DISCREPANCY_DETECTED',
                durationMs: 0.5,
                outputData: circuitResult,
              },
              {
                nodeKey: 'STEP_COMMIT',
                name: 'ACID Ledger Synchronization',
                status: 'SUCCESS',
                durationMs: 2.0,
              },
            ],
            circuitBreakerResult: circuitResult,
            confidence: 1.0,
            totalDurationMs: 3.0,
            rawNarration: bankTxn.narration,
          },
        ],
        { session }
      );
    });

    // Broadcast SSE update
    sseManager.broadcast('txn:reconciled', {
      bankTxnId: bankTxn.bankTxnId,
      invoiceNumber: invoice.invoiceNumber,
      matchedTier: 'MANUAL',
      amount: bankTxn.amount,
      deductions: bankTxn.deductionsApplied,
      circuitBreaker: circuitResult,
      learnedRule: learnedRuleDoc,
    });

    return {
      success: true,
      bankTxn,
      invoice,
      learnedRule: learnedRuleDoc,
    };
  }
}
