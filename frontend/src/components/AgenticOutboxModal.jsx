import React, { useState, useEffect } from 'react';
import {
  X,
  MessageSquare,
  Mail,
  CheckCircle2,
  BookOpen,
  AlertTriangle,
  Send,
  Copy,
  Sparkles,
  RefreshCw,
  ExternalLink,
  Bot,
} from 'lucide-react';

export function AgenticOutboxModal({ transaction, onClose, onResolved }) {
  if (!transaction) return null;

  const invoiceObj =
    typeof transaction.reconciledInvoiceId === 'object' && transaction.reconciledInvoiceId !== null
      ? transaction.reconciledInvoiceId
      : null;

  const customerName = invoiceObj?.customerName || transaction.customerName || 'Customer Finance';
  const customerEmail =
    invoiceObj?.customerEmail ||
    `finance@${customerName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'vendor'}.com`;
  const customerPhone = invoiceObj?.customerPhone || '+919876543210';
  const isException = transaction.reconciliationStatus === 'EXCEPTION';
  const varianceAmt = Math.abs(transaction.discrepancyDetails?.discrepancyAmount || 0);

  const [activeTab, setActiveTab] = useState('WHATSAPP');
  const [approvedAdjustment, setApprovedAdjustment] = useState(varianceAmt);
  const [deductionReason, setDeductionReason] = useState(
    'Authorized TDS deduction verified against customer Form 16A / IT section'
  );
  const [learnAsRule, setLearnAsRule] = useState(true);
  const [rulePattern, setRulePattern] = useState(customerName);
  const [tdsSection, setTdsSection] = useState('194C');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dispatchStatus, setDispatchStatus] = useState(null);

  const [recipientPhone, setRecipientPhone] = useState(customerPhone);
  const [recipientEmailState, setRecipientEmailState] = useState(customerEmail);

  // Live dynamic AI drafts
  const [aiReasoning, setAiReasoning] = useState(
    transaction.discrepancyDetails?.reason ||
      (isException
        ? 'Automated variance analysis: Applied deduction differs from expected ledger amounts.'
        : 'Automated reconciliation: Bank receipt matches expected gross and TDS statutory deductions.')
  );

  const defaultWhatsapp =
    transaction.whatsappDraft?.messageText ||
    (isException
      ? `*Payment Reconciliation Notice | Razorpay Controller*\n\nDear Finance Team at *${customerName}*,\n\nWe received a bank transfer of *₹${Number(transaction.amount || 0).toLocaleString('en-IN')}* (Ref: \`${transaction.utrNumber || transaction.bankTxnId}\`).\n\n⚠️ *Discrepancy Detected:* ₹${varianceAmt.toLocaleString('en-IN')}\n*Math Trace:* ${transaction.discrepancyDetails?.mathEquation || 'Unresolved difference'}\n\nPlease share TDS certificate or remittance advice.`
      : `*Payment Confirmation Notice | Razorpay Controller*\n\nDear Finance Team at *${customerName}*,\n\nWe confirm receipt of *₹${Number(transaction.amount || 0).toLocaleString('en-IN')}* for Invoice *${invoiceObj?.invoiceNumber || transaction.bankTxnId}*.\n\nTransaction Reference: \`${transaction.utrNumber || transaction.bankTxnId}\`\nStatus: *RECONCILED & PAID*\n\nThank you for your payment!`);

  const [whatsappDraftText, setWhatsappDraftText] = useState(defaultWhatsapp);
  const [emailSubject, setEmailSubject] = useState(
    transaction.emailDraft?.subject ||
      (isException
        ? `[ACTION REQUIRED] Reconciliation Discrepancy: ${transaction.bankTxnId}`
        : `[CONFIRMATION] Payment Received & Reconciled: ${transaction.bankTxnId}`)
  );
  const [emailBodyText, setEmailBodyText] = useState(
    isException
      ? `Dear Finance Team at ${customerName},\n\nOur automated B2B AI Controller recorded an incoming bank transfer with an arithmetic variance.\n\n• Transaction Ref: ${transaction.bankTxnId} (UTR: ${transaction.utrNumber || 'N/A'})\n• Amount Received: ₹${Number(transaction.amount || 0).toLocaleString('en-IN')}\n• Discrepancy Variance: ₹${varianceAmt.toLocaleString('en-IN')}\n• Arithmetic Trace: ${transaction.discrepancyDetails?.mathEquation || 'Discrepancy'}\n\nKindly confirm if this corresponds to TDS or processing charges so we can close this entry.\n\nRegards,\nFinance & Accounts Department`
      : `Dear Finance Team at ${customerName},\n\nThis is to confirm that we have successfully received and reconciled your payment.\n\n• Transaction Ref: ${transaction.bankTxnId} (UTR: ${transaction.utrNumber || 'N/A'})\n• Amount Received: ₹${Number(transaction.amount || 0).toLocaleString('en-IN')}\n• Invoice Reference: ${invoiceObj?.invoiceNumber || 'B2B Invoice'}\n• Status: FULLY RECONCILED\n\nThank you for your business.\n\nRegards,\nFinance & Accounts Department`
  );
  const [aiSource, setAiSource] = useState(null);

  // Live AI Generation call
  const generateAIDraft = async () => {
    setIsGeneratingAI(true);
    setDispatchStatus(null);
    try {
      const res = await fetch('/api/reconciliation/generate-ai-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankTxnId: transaction.bankTxnId,
          bankTxn: transaction,
          invoice: invoiceObj,
          discrepancy: transaction.discrepancyDetails || { discrepancyAmount: varianceAmt },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const whatsappVal = typeof data.whatsapp === 'string' ? data.whatsapp : (data.whatsapp?.messageText || data.whatsappText || data.whatsappDraft);
        if (whatsappVal) setWhatsappDraftText(whatsappVal);

        const emailSub = data.emailSubject || data.email?.subject;
        if (emailSub) setEmailSubject(emailSub);

        const emailBody = data.emailBody || data.emailBodyText || data.email?.bodyText;
        if (emailBody) setEmailBodyText(emailBody);

        const reason = data.reasoning || data.aiReasoning;
        if (reason) setAiReasoning(reason);

        setAiSource(data.source || 'GEMINI_1_5_FLASH_LIVE');
      }
    } catch (e) {
      console.warn('Live AI Draft generation failed:', e);
    } finally {
      setIsGeneratingAI(false);
    }
  };

  // Dispatch via Server Relay (Simulated / Gateway Relay)
  const handleServerDispatch = async (channel) => {
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/reconciliation/dispatch-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankTxnId: transaction.bankTxnId,
          channel,
          recipient: channel === 'WHATSAPP' ? recipientPhone : recipientEmailState,
          messageText: channel === 'WHATSAPP' ? whatsappDraftText : emailBodyText,
          subject: channel === 'EMAIL' ? emailSubject : null,
        }),
      });

      if (res.ok) {
        const result = await res.json();
        setDispatchStatus({
          channel,
          trackingId: result.trackingId,
          timestamp: result.timestamp,
        });
      }
    } catch (e) {
      alert(`Dispatch error: ${e.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApprove = async () => {
    setIsSubmitting(true);
    try {
      const invoiceId = invoiceObj?._id || transaction.reconciledInvoiceId;
      const res = await fetch('/api/reconciliation/resolve-exception', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankTxnId: transaction.bankTxnId,
          invoiceId: invoiceId || '66c000000000000000000001',
          approvedAdjustment: Number(approvedAdjustment),
          deductionReason,
          learnAsRule,
          rulePattern,
          tdsSection,
        }),
      });

      if (res.ok) {
        onResolved?.();
        onClose();
      } else {
        const err = await res.json();
        alert(`Failed to resolve: ${err.error || 'Server error'}`);
      }
    } catch (e) {
      alert(`Error: ${e.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Gmail Web Direct Link
  const gmailComposeUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
    recipientEmailState
  )}&su=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBodyText)}`;

  // WhatsApp Web Direct Link with phone number
  const cleanPhone = recipientPhone.replace(/[^0-9]/g, '');
  const whatsappWebUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(
    whatsappDraftText
  )}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-razor-card border border-razor-border rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-fade-in">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-razor-border bg-slate-900/90 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center border ${
                isException
                  ? 'bg-amber-500/20 border-amber-500/40'
                  : 'bg-emerald-500/20 border-emerald-500/40'
              }`}
            >
              {isException ? (
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">
                  {isException ? 'Agentic Exception Outbox' : 'Payment Notification & Outbox'}
                </h3>
                {aiSource && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-mono flex items-center gap-1">
                    <Bot className="w-3 h-3" /> Live Gemini AI Draft
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Txn: <span className="font-mono text-white">{transaction.bankTxnId}</span> • Amount:{' '}
                <span className="text-emerald-400 font-mono font-bold">
                  ₹{Number(transaction.amount || 0).toLocaleString('en-IN')}
                </span>
                {isException && (
                  <span>
                    {' '}
                    • Variance:{' '}
                    <span className="text-amber-400 font-mono font-bold">
                      ₹{varianceAmt.toLocaleString('en-IN')}
                    </span>
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={generateAIDraft}
              disabled={isGeneratingAI}
              className="px-3 py-1.5 rounded-lg bg-razor-purple/20 hover:bg-razor-purple/30 text-purple-300 border border-razor-purple/40 text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer"
              title="Query Gemini 1.5 Flash to dynamically draft contextual reasoning and notifications"
            >
              <Sparkles className={`w-3.5 h-3.5 text-purple-400 ${isGeneratingAI ? 'animate-spin' : ''}`} />
              <span>{isGeneratingAI ? 'Gemini Thinking...' : 'Regenerate with Gemini AI'}</span>
            </button>

            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Dispatch Success Alert Banner */}
          {dispatchStatus && (
            <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 flex items-center justify-between text-xs animate-fade-in text-emerald-300">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  <strong>{dispatchStatus.channel} Dispatched Successfully!</strong> Relay Tracking ID:{' '}
                  <code className="bg-emerald-900/60 px-1.5 py-0.5 rounded text-white font-mono">
                    {dispatchStatus.trackingId}
                  </code>
                </span>
              </div>
              <span className="text-[10px] text-emerald-400 font-mono">Audit Trace Updated</span>
            </div>
          )}

          {/* AI Reasoning & Circuit Breaker Trace */}
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Bot className="w-3.5 h-3.5 text-razor-purple" />
                AI Contextual Accounting Reasoning
              </span>
              <span className="text-[10px] font-mono text-slate-500">
                Zero-Trust Circuit Breaker Guard
              </span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/80 p-2.5 rounded-lg border border-slate-800/80">
              {aiReasoning}
            </p>
            <div className="p-2.5 rounded-lg bg-amber-950/20 border border-amber-900/40 font-mono text-xs text-amber-300 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>{transaction.discrepancyDetails?.mathEquation || 'Gross - Deductions ≡ Bank Received'}</span>
            </div>
          </div>

          {/* Tab Selector: WhatsApp vs Email Draft */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              <button
                onClick={() => setActiveTab('WHATSAPP')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 transition-all cursor-pointer ${
                  activeTab === 'WHATSAPP'
                    ? 'bg-emerald-600 text-white font-semibold shadow-md'
                    : 'bg-slate-800/80 text-slate-400 hover:bg-slate-800'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Agentic WhatsApp Draft</span>
              </button>

              <button
                onClick={() => setActiveTab('EMAIL')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 transition-all cursor-pointer ${
                  activeTab === 'EMAIL'
                    ? 'bg-razor-blue text-white font-semibold shadow-md'
                    : 'bg-slate-800/80 text-slate-400 hover:bg-slate-800'
                }`}
              >
                <Mail className="w-3.5 h-3.5" />
                <span>Formal Corporate Email</span>
              </button>
            </div>

            {/* Tab 1: WhatsApp Preview */}
            {activeTab === 'WHATSAPP' && (
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 font-semibold">Vendor WhatsApp Phone:</span>
                    <input
                      type="text"
                      value={recipientPhone}
                      onChange={(e) => setRecipientPhone(e.target.value)}
                      placeholder="+919876543210"
                      className="px-2.5 py-1 rounded bg-slate-950 border border-slate-700 text-emerald-300 font-mono text-xs focus:border-emerald-500 focus:outline-none w-44"
                    />
                  </div>
                  <div className="flex items-center flex-wrap gap-2">
                    <button
                      onClick={() => handleCopy(whatsappDraftText)}
                      className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <Copy className="w-3 h-3" />
                      <span>{copied ? 'Copied!' : 'Copy'}</span>
                    </button>
                    <a
                      href={whatsappWebUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[11px] flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>Open in WhatsApp Web</span>
                    </a>
                    {/* <button
                      onClick={() => handleServerDispatch('WHATSAPP')}
                      disabled={isSubmitting}
                      className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/40 font-semibold text-[11px] flex items-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer"
                    >
                      {/* <Send className="w-3 h-3" /> */}
                      {/* <span>Dispatch via API Relay</span> */}
                    {/* </button> */}
                  </div>
                </div>
                <textarea
                  value={whatsappDraftText}
                  onChange={(e) => setWhatsappDraftText(e.target.value)}
                  rows={6}
                  className="w-full p-3 rounded-lg bg-emerald-950/20 border border-emerald-800/40 text-emerald-200 font-sans text-xs whitespace-pre-line leading-relaxed focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>
            )}

            {/* Tab 2: Email Preview */}
            {activeTab === 'EMAIL' && (
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 font-semibold">Vendor Accounts Email:</span>
                    <input
                      type="email"
                      value={recipientEmailState}
                      onChange={(e) => setRecipientEmailState(e.target.value)}
                      placeholder="finance@vendor.com"
                      className="px-2.5 py-1 rounded bg-slate-950 border border-slate-700 text-razor-blue font-mono text-xs focus:border-razor-blue focus:outline-none w-56"
                    />
                  </div>
                  <div className="flex items-center flex-wrap gap-2">
                    <button
                      onClick={() => handleCopy(`Subject: ${emailSubject}\n\n${emailBodyText}`)}
                      className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <Copy className="w-3 h-3" />
                      <span>{copied ? 'Copied!' : 'Copy'}</span>
                    </button>
                    <a
                      href={gmailComposeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1 rounded bg-red-600 hover:bg-red-500 text-white font-semibold text-[11px] flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
                      title="Opens Gmail directly in browser with pre-filled subject and body"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>Open in Gmail Web</span>
                    </a>
                    {/* <button 
                      onClick={() => handleServerDispatch('EMAIL')}
                      disabled={isSubmitting}
                      className="px-3 py-1 rounded bg-razor-blue hover:bg-razor-blueHover text-white font-semibold text-[11px] flex items-center gap-1.5 transition-all shadow-sm disabled:opacity-50 cursor-pointer"
                    >
                      {/* <Send className="w-3 h-3" /> */}
                      {/* <span>Dispatch via SMTP Relay</span> */}
                    {/* </button> */}
                  </div>
                </div>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-razor-blue"
                  />
                  <textarea
                    value={emailBodyText}
                    onChange={(e) => setEmailBodyText(e.target.value)}
                    rows={6}
                    className="w-full p-3 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 text-xs font-sans whitespace-pre-line leading-relaxed focus:outline-none focus:border-razor-blue"
                  />
                </div>
              </div>
            )}
          </div>

          {/* 1-Click Accountant Approval & Continuous Learning (Tier 2 Rule Cache) */}
          {isException && (
            <div className="p-4 rounded-xl bg-purple-950/20 border border-purple-800/40 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-razor-purple" />
                  <h4 className="text-xs font-bold text-white">
                    1-Click Accountant Adjustment &amp; Active Rule Learning
                  </h4>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-mono font-medium">
                  Auto-Promote to Tier 2 Cache
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="text-slate-400 block mb-1">Approved Deduction (₹)</label>
                  <input
                    type="number"
                    value={approvedAdjustment}
                    onChange={(e) => setApprovedAdjustment(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-razor-blue"
                  />
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Deduction Type / Reason</label>
                  <select
                    value={tdsSection}
                    onChange={(e) => setTdsSection(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs focus:outline-none focus:border-razor-blue"
                  >
                    <option value="194C">TDS 194C (Contractor - 1% / 2%)</option>
                    <option value="194J">TDS 194J (Professional - 10%)</option>
                    <option value="194H">TDS 194H (Commission - 5%)</option>
                    <option value="194Q">TDS 194Q (Goods Purchase - 0.1%)</option>
                    <option value="206AB">Section 206AB (Penal Non-Filer - 20%)</option>
                    <option value="PG_COMMISSION">PG / Payment Gateway Surcharge</option>
                    <option value="SETTLEMENT_ROUNDING">Settlement FX / Rounding Variance</option>
                    <option value="CLIENT_DISPUTE">Unresolved Client Dispute (Hold)</option>
                  </select>
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Learn Regex / Narration Keyword</label>
                  <input
                    type="text"
                    value={rulePattern}
                    onChange={(e) => setRulePattern(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-razor-blue"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={learnAsRule}
                    onChange={(e) => setLearnAsRule(e.target.checked)}
                    className="rounded bg-slate-900 border-slate-700 text-razor-blue focus:ring-0"
                  />
                  <span>
                    Save to <strong className="text-razor-purple">Tier 2 Rule Cache</strong> (Future matching will resolve in &lt;5ms at $0 cost)
                  </span>
                </label>

                <button
                  onClick={handleApprove}
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-md shadow-emerald-500/20 transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{isSubmitting ? 'Committing...' : 'Approve & Reconcile'}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-razor-border bg-slate-900/90 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
