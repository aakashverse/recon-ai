import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ShieldCheck, AlertTriangle, CheckCircle, ExternalLink, GitBranch, MessageSquare, ArrowRight } from 'lucide-react';

export function VirtualizedFeed({
  transactions,
  onSelectTxn,
  onOpenOutbox,
  onOpenImporter,
}) {
  const parentRef = useRef(null); 

  const virtualizer = useVirtualizer({
    count: transactions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 76,
    overscan: 10,
  });

  if (!transactions.length) {
    return (
      <div className="p-14 text-center rounded-xl bg-razor-card border border-razor-border">
        <div className="w-14 h-14 rounded-2xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center mx-auto mb-3.5 shadow-lg">
          <ShieldCheck className="w-7 h-7 text-razor-blue" />
        </div>
        <h3 className="text-base font-bold text-slate-200">No Bank Transactions in Feed</h3>
        <p className="text-xs text-slate-400 mt-1.5 max-w-md mx-auto leading-relaxed">
          Upload your bank statement feed (CSV/Excel) or real enterprise invoices to start the automated reconciliation pipeline.
        </p>
        <div className="mt-4">
          <button
            onClick={onOpenImporter}
            className="px-4 py-2 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/25 transition-all inline-flex items-center gap-1.5 cursor-pointer"
          >
            <span>Upload Bank Statement CSV</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-razor-card border border-razor-border overflow-hidden flex flex-col">
      {/* Table Header */}
      <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-slate-900/90 border-b border-razor-border text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
        <div className="col-span-2">Status / Tier</div>
        <div className="col-span-2">Bank Txn / UTR</div>
        <div className="col-span-3">Narration / Vendor</div>
        <div className="col-span-2 text-right">Amount / Deductions</div>
        <div className="col-span-2 text-center">Confidence & Circuit</div>
        <div className="col-span-1 text-right">Action</div>
      </div>

      {/* Virtualized List Container */}
      <div
        ref={parentRef}
        className="h-[520px] overflow-y-auto divide-y divide-slate-800/60"
        style={{ contain: 'strict' }}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const txn = transactions[virtualRow.index];
            if (!txn) return null;

            const isMatched = txn.reconciliationStatus === 'MATCHED';
            const isProposed = txn.reconciliationStatus === 'PROPOSED' || txn.matchedTier === 'PROPOSED';
            const isOverridden = txn.reconciliationStatus === 'OVERRIDDEN';
            const isException =
              txn.reconciliationStatus === 'EXCEPTION' ||
              txn.reconciliationStatus === 'DISCREPANCY' ||
              txn.matchedTier === 'OUTBOX_EXCEPTION' ||
              Boolean(txn.discrepancyDetails && !isMatched && !isProposed);
            const tier = txn.matchedTier;
            const invoice = txn.reconciledInvoiceId;

            return (
              <div
                key={txn.bankTxnId || virtualRow.index}
                onClick={() => onSelectTxn(txn)}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className={`grid grid-cols-12 gap-2 px-4 py-2.5 items-center text-xs transition-colors hover:bg-razor-cardHover cursor-pointer ${
                  isProposed
                    ? 'bg-purple-950/15 border-l-2 border-l-purple-500'
                    : isException
                    ? 'bg-amber-950/10 border-l-2 border-l-amber-500'
                    : isOverridden
                    ? 'bg-slate-900/40 border-l-2 border-l-slate-500'
                    : ''
                }`}
              >
                {/* Status / Tier */}
                <div className="col-span-2 flex flex-col gap-1 items-start">
                  {isMatched && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                      <CheckCircle className="w-3 h-3" />
                      MATCHED
                    </span>
                  )}
                  {isProposed && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm animate-pulse">
                      <ShieldCheck className="w-3 h-3 text-purple-400" />
                      PROPOSED
                    </span>
                  )}
                  {isOverridden && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                      OVERRIDDEN
                    </span>
                  )}
                  {isException && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                      <AlertTriangle className="w-3 h-3" />
                      DISCREPANCY
                    </span>
                  )}
                  {!isMatched && !isProposed && !isOverridden && !isException && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                      UNPROCESSED
                    </span>
                  )}

                  {/* Tier & Trust Level Badge */}
                  <div className="flex items-center gap-1 flex-wrap">
                    {tier === 'TIER_1' && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-razor-blue/20 text-razor-blue font-mono font-medium border border-razor-blue/30">
                        Tier 1: Exact
                      </span>
                    )}
                    {tier === 'TIER_2' && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-teal-500/20 text-teal-300 font-mono font-medium border border-teal-500/30">
                        Tier 2: Rules
                      </span>
                    )}
                    {(tier === 'TIER_3' || (isProposed && txn.proposalDetails?.proposedTier === 'TIER_3')) && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-razor-purple/20 text-purple-300 font-mono font-medium border border-razor-purple/30 flex items-center gap-0.5">
                        {txn.executionMetrics?.ragCacheHit ? '⚡ Tier 3: RAG' : 'Tier 3: GenAI'}
                      </span>
                    )}
                    {txn.trustLevel && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-slate-800 text-slate-300 font-mono border border-slate-700">
                        {txn.trustLevel}
                      </span>
                    )}
                  </div>
                </div>

                {/* Bank Txn / UTR */}
                <div className="col-span-2">
                  <div className="font-mono font-semibold text-slate-200 truncate">
                    {txn.bankTxnId}
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 truncate">
                    UTR: {txn.utrNumber || 'N/A'}
                  </div>
                </div>

                {/* Narration / Vendor & Plain-Language Accountability */}
                <div className="col-span-3">
                  <div className="text-slate-200 font-medium truncate" title={txn.narration}>
                    {txn.narration}
                  </div>
                  <div className="text-[11px] text-slate-400 truncate flex items-center gap-1">
                    {invoice || txn.proposalDetails?.proposedInvoiceNumber ? (
                      <span className="text-razor-blue font-medium flex items-center gap-0.5">
                        <ArrowRight className="w-2.5 h-2.5" />
                        {invoice?.invoiceNumber || txn.proposalDetails?.proposedInvoiceNumber} • {invoice?.customerName || 'Vendor'}
                      </span>
                    ) : isException && txn.discrepancyDetails?.reason ? (
                      <span className="text-amber-400/90 font-medium truncate flex items-center gap-1" title={txn.discrepancyDetails.reason}>
                        <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
                        {txn.discrepancyDetails.reason}
                      </span>
                    ) : (
                      <span className="text-slate-500 italic">No mapped invoice candidate</span>
                    )}
                  </div>
                  {/* Plain-Language Primary Accountability Statement */}
                  <div className="text-[10px] text-slate-300/80 italic truncate mt-0.5 flex items-center gap-1" title={txn.accountabilityStatement}>
                    <ShieldCheck className="w-2.5 h-2.5 text-razor-blue shrink-0" />
                    <span>{txn.accountabilityStatement || (isMatched ? 'Verified — exact match, no inference involved.' : isProposed ? 'Proposed by GenAI — awaiting accountant sign-off.' : 'Awaiting accountant review.')}</span>
                  </div>
                </div>

                {/* Amount / Deductions */}
                <div className="col-span-2 text-right">
                  <div className="font-mono font-bold text-white">
                    ₹{Number(txn.amount || 0).toLocaleString('en-IN')}
                  </div>
                  {txn.deductionsApplied?.totalDeductions > 0 ? (
                    <div className="text-[10px] font-mono text-amber-400">
                      -₹{txn.deductionsApplied.totalDeductions.toLocaleString('en-IN')}{' '}
                      ({txn.deductionsApplied.tdsSection || 'TDS'})
                    </div>
                  ) : isException && txn.discrepancyDetails?.difference ? (
                    <div className="text-[10px] font-mono text-rose-400 font-semibold">
                      Δ ₹{Math.abs(txn.discrepancyDetails.difference).toLocaleString('en-IN')} (Diff)
                    </div>
                  ) : (
                    <div className="text-[10px] font-mono text-slate-500">Gross Paid (0 TDS)</div>
                  )}
                </div>

                {/* Confidence & Circuit with Plain-Language Label */}
                <div className="col-span-2 flex flex-col items-center">
                  <div className="text-[10px] font-medium text-slate-300 truncate max-w-[130px] text-center" title={txn.confidenceLabel}>
                    {txn.confidenceLabel || (tier === 'TIER_1' ? 'Verified (Exact)' : 'AI-Assisted — High')}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <div className="w-14 bg-slate-800 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          (txn.confidenceScore || 1) >= 0.8
                            ? 'bg-emerald-400'
                            : (txn.confidenceScore || 1) >= 0.6
                            ? 'bg-amber-400'
                            : 'bg-rose-400'
                        }`}
                        style={{ width: `${Math.min(100, Math.round((txn.confidenceScore || 1) * 100))}%` }}
                      ></div>
                    </div>
                    <span className="text-[9px] font-mono text-slate-400">
                      {Math.round((txn.confidenceScore || 1) * 100)}%
                    </span>
                  </div>
                  <span className="text-[9px] font-mono text-slate-400 mt-0.5">
                    {txn.executionMetrics?.totalDurationMs ? `${txn.executionMetrics.totalDurationMs}ms` : '<10ms'}
                  </span>
                </div>

                {/* Action */}
                <div className="col-span-1 text-right flex items-center justify-end gap-1 relative z-20" onClick={(e) => e.stopPropagation()}>
                  {isProposed && (
                    <>
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          try {
                            const res = await fetch('http://localhost:5000/api/reconciliation/confirm-proposal', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ bankTxnId: txn.bankTxnId, accountantNotes: '1-Click feed confirmation' }),
                            });
                            const data = await res.json();
                            if (data.success) {
                              txn.reconciliationStatus = 'MATCHED';
                              txn.accountabilityStatement = 'Accountant confirmed — pattern promoted in trust hierarchy.';
                            }
                          } catch (err) {
                            console.error('Confirm error:', err);
                          }
                        }}
                        className="p-1 rounded bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 transition-all cursor-pointer"
                        title="Confirm & Auto-Post Proposal to General Ledger"
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          const reason = prompt('Enter override reason / note for audit trail:');
                          if (reason === null) return;
                          try {
                            const res = await fetch('http://localhost:5000/api/reconciliation/override-match', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ bankTxnId: txn.bankTxnId, reason }),
                            });
                            const data = await res.json();
                            if (data.success) {
                              txn.reconciliationStatus = 'OVERRIDDEN';
                              txn.accountabilityStatement = 'Accountant override logged — rule trust downgraded in ledger.';
                            }
                          } catch (err) {
                            console.error('Override error:', err);
                          }
                        }}
                        className="p-1 rounded bg-rose-600/30 hover:bg-rose-600/50 text-rose-300 border border-rose-500/40 transition-all cursor-pointer"
                        title="Override / Downgrade Trust Level"
                      >
                        <AlertTriangle className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onOpenOutbox(txn);
                    }}
                    className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                      isException
                        ? 'bg-amber-500/20 hover:bg-amber-500/40 text-amber-400 border border-amber-500/40 shadow-sm'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700'
                    }`}
                    title={isException ? "Open Agentic WhatsApp / Email Dispute Outbox" : "Open Communication Outbox"}
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onSelectTxn(txn);
                    }}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 transition-all cursor-pointer"
                    title="Inspect React Flow State Machine DAG"
                  >
                    <GitBranch className="w-3.5 h-3.5 text-razor-blue" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
