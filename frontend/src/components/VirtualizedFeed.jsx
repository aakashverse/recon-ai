import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ShieldCheck, AlertTriangle, CheckCircle, ExternalLink, GitBranch, MessageSquare, ArrowRight } from 'lucide-react';

export function VirtualizedFeed({
  transactions,
  onSelectTxn,
  onOpenOutbox,
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
      <div className="p-12 text-center rounded-xl bg-razor-card border border-razor-border">
        <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mx-auto mb-3">
          <ShieldCheck className="w-6 h-6 text-slate-500" />
        </div>
        <h3 className="text-sm font-semibold text-slate-300">No Transactions in Feed</h3>
        <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
          Click <span className="text-razor-blue font-semibold">"Run 50-Txn Batch"</span> or <span className="text-amber-400 font-semibold">"Stream Live Feed"</span> to trigger the cascaded reconciliation pipeline.
        </p>
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
            const isException = txn.reconciliationStatus === 'EXCEPTION';
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
                className={`grid grid-cols-12 gap-2 px-4 py-3 items-center text-xs transition-colors hover:bg-razor-cardHover cursor-pointer ${
                  isException ? 'bg-amber-950/10' : ''
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
                  {isException && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                      <AlertTriangle className="w-3 h-3" />
                      DISCREPANCY
                    </span>
                  )}
                  {!isMatched && !isException && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                      UNPROCESSED
                    </span>
                  )}

                  {/* Tier Badge */}
                  {tier === 'TIER_1' && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-razor-blue/20 text-razor-blue font-mono font-medium">
                      Tier 1: &lt;2ms Exact
                    </span>
                  )}
                  {tier === 'TIER_2' && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 font-mono font-medium">
                      Tier 2: Rule Cache
                    </span>
                  )}
                  {tier === 'TIER_3' && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-razor-purple/20 text-purple-300 font-mono font-medium">
                      Tier 3: GenAI Pool
                    </span>
                  )}
                  {tier === 'MANUAL' && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 font-mono font-medium">
                      Manual Approved
                    </span>
                  )}
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

                {/* Narration / Vendor */}
                <div className="col-span-3">
                  <div className="text-slate-200 font-medium truncate" title={txn.narration}>
                    {txn.narration}
                  </div>
                  <div className="text-[11px] text-slate-400 truncate flex items-center gap-1">
                    {invoice ? (
                      <span className="text-razor-blue font-medium flex items-center gap-0.5">
                        <ArrowRight className="w-2.5 h-2.5" />
                        {invoice.invoiceNumber || 'INV'} • {invoice.customerName || 'Vendor'}
                      </span>
                    ) : (
                      <span className="text-slate-500 italic">No mapped invoice candidate</span>
                    )}
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
                  ) : (
                    <div className="text-[10px] font-mono text-slate-500">Gross Paid (0 TDS)</div>
                  )}
                </div>

                {/* Confidence & Circuit */}
                <div className="col-span-2 flex flex-col items-center">
                  <div className="flex items-center gap-1.5">
                    <div className="w-16 bg-slate-800 rounded-full h-1.5 overflow-hidden">
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
                    <span className="text-[10px] font-mono font-bold text-slate-300">
                      {Math.round((txn.confidenceScore || 1) * 100)}%
                    </span>
                  </div>
                  <span className="text-[9px] font-mono text-slate-400 mt-0.5">
                    {txn.executionMetrics?.totalDurationMs ? `${txn.executionMetrics.totalDurationMs}ms` : '<10ms'}
                  </span>
                </div>

                {/* Action */}
                <div className="col-span-1 text-right flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  {isException ? (
                    <button
                      onClick={() => onOpenOutbox(txn)}
                      className="p-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/40 transition-colors"
                      title="Open Agentic WhatsApp / Email Outbox"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={() => onSelectTxn(txn)}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 transition-colors"
                      title="Inspect DAG Execution Path"
                    >
                      <GitBranch className="w-3.5 h-3.5 text-razor-blue" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
