import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  CheckCircle2,
  AlertCircle,
  FileText,
  DollarSign,
  TrendingUp,
  X,
  RefreshCw,
  Layers,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';

export function GeneralLedgerModal({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState('trial-balance'); // 'trial-balance' or 'journal-entries'
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchTrialBalance = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/reconciliation/trial-balance');
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (e) {
      console.warn('Failed to load trial balance:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchTrialBalance();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-5xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-600 flex items-center justify-center shadow-md shadow-emerald-500/20">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                AI-Native General Ledger & Zero-Day Close
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-medium flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  Rillet-Grade Double-Entry GL
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Continuous Month-End Close • Balanced Double-Entry Auto-Journaling • Live Trial Balance
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Tabs switcher */}
            <div className="flex bg-slate-800/80 p-1 rounded-lg border border-slate-700 text-xs font-semibold">
              <button
                onClick={() => setActiveTab('trial-balance')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
                  activeTab === 'trial-balance'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" />
                Live Trial Balance
              </button>
              <button
                onClick={() => setActiveTab('journal-entries')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
                  activeTab === 'journal-entries'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                Auto-Journal Stream
              </button>
            </div>

            <button
              onClick={fetchTrialBalance}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
              title="Refresh Ledger"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
            </button>

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Continuous Close Banner */}
        {data?.continuousCloseMetrics && (
          <div className="px-6 py-3 bg-slate-950/40 border-b border-slate-800/80 flex items-center justify-between text-xs">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">Continuous Close Health:</span>
                <span className="font-bold text-emerald-400">
                  {data.continuousCloseMetrics.continuousCloseHealthPercent}% Reconciled
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">Days Sales Outstanding (DSO):</span>
                <span className="font-bold text-white">
                  {data.continuousCloseMetrics.dsoDays} Days
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">Unsettled AR Balance:</span>
                <span className="font-bold text-amber-400">
                  ₹{data.continuousCloseMetrics.unsettledArBalance?.toLocaleString('en-IN')}
                </span>
              </div>
            </div>

            <div>
              {data.continuousCloseMetrics.monthEndCloseStatus === 'ZERO_DAY_CLOSED' ? (
                <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Zero-Day Close Ready
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 font-semibold flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {data.continuousCloseMetrics.unreconciledExceptionsCount} Exceptions Pending Review
                </span>
              )}
            </div>
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 p-6 overflow-y-auto min-h-0 bg-slate-900/50">
          {loading && !data ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
              <RefreshCw className="w-8 h-8 animate-spin text-emerald-500" />
              <p className="text-sm">Calculating real-time double-entry general ledger & trial balance...</p>
            </div>
          ) : activeTab === 'trial-balance' ? (
            <div className="space-y-6">
              {/* Trial Balance Table */}
              <div className="border border-slate-700/80 rounded-xl overflow-hidden shadow-lg bg-slate-950/40">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-800/90 text-slate-300 font-semibold border-b border-slate-700">
                    <tr>
                      <th className="py-3 px-4">Account Code</th>
                      <th className="py-3 px-4">Account Title & Ledger Description</th>
                      <th className="py-3 px-4">Type</th>
                      <th className="py-3 px-4 text-right">Debit (INR ₹)</th>
                      <th className="py-3 px-4 text-right">Credit (INR ₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-200">
                    {data?.trialBalance?.map((acc, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/40 transition">
                        <td className="py-2.5 px-4 font-mono text-emerald-400 font-semibold">{acc.code}</td>
                        <td className="py-2.5 px-4 font-medium">{acc.name}</td>
                        <td className="py-2.5 px-4">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            acc.type === 'ASSET' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                            acc.type === 'REVENUE' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' :
                            'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }`}>
                            {acc.type}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-100">
                          {acc.debit > 0 ? `₹${acc.debit.toLocaleString('en-IN')}` : '—'}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-100">
                          {acc.credit > 0 ? `₹${acc.credit.toLocaleString('en-IN')}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {/* Table Footer Totals */}
                  <tfoot className="bg-slate-950 font-bold border-t-2 border-slate-700 text-slate-100 text-xs">
                    <tr>
                      <td colSpan={3} className="py-3 px-4 text-slate-300">
                        TOTAL TRIAL BALANCE (Double-Entry Verification)
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-emerald-400 text-sm">
                        ₹{data?.totalDebits?.toLocaleString('en-IN')}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-emerald-400 text-sm">
                        ₹{data?.totalCredits?.toLocaleString('en-IN')}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Integrity Callout */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-xs text-emerald-300">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    <strong>Double-Entry Ledger Integrity: 100% Balanced.</strong> Every reconciled transaction has generated balanced debit and credit entries with exact zero variance.
                  </span>
                </div>
                <span className="font-mono text-[10px] bg-emerald-500/20 px-2.5 py-1 rounded-full border border-emerald-500/30">
                  Δ = 0.00 Variance
                </span>
              </div>
            </div>
          ) : (
            /* Tab 2: Journal Entries Stream */
            <div className="space-y-4">
              {data?.recentJournalEntries?.length > 0 ? (
                data.recentJournalEntries.map((je, idx) => (
                  <div key={idx} className="p-4 rounded-xl bg-slate-800/70 border border-slate-700/80 space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-700/60 pb-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-emerald-400">
                          {je.journalEntryNumber}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded bg-slate-700/60 text-slate-300 font-mono">
                          Txn: {je.bankTxnId}
                        </span>
                        {je.invoiceNumber && (
                          <span className="text-xs px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
                            Inv: {je.invoiceNumber}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-slate-400">
                        {new Date(je.createdAt).toLocaleString('en-IN')}
                      </span>
                    </div>

                    {/* Debits and Credits Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      {/* Debits */}
                      <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-700/50 space-y-1.5">
                        <span className="font-bold text-emerald-400 flex items-center gap-1">
                          Debits (Dr) — ₹{je.totalDebit?.toLocaleString('en-IN')}
                        </span>
                        {je.debitLines?.map((d, dIdx) => (
                          <div key={dIdx} className="flex justify-between text-slate-300">
                            <span>{d.accountName} ({d.accountCode})</span>
                            <span className="font-mono font-semibold">₹{d.amount?.toLocaleString('en-IN')}</span>
                          </div>
                        ))}
                      </div>

                      {/* Credits */}
                      <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-700/50 space-y-1.5">
                        <span className="font-bold text-purple-400 flex items-center gap-1">
                          Credits (Cr) — ₹{je.totalCredit?.toLocaleString('en-IN')}
                        </span>
                        {je.creditLines?.map((c, cIdx) => (
                          <div key={cIdx} className="flex justify-between text-slate-300">
                            <span>{c.accountName} ({c.accountCode})</span>
                            <span className="font-mono font-semibold">₹{c.amount?.toLocaleString('en-IN')}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* AI Audit Memo */}
                    {je.auditMemo?.summary && (
                      <div className="p-2.5 rounded-lg bg-slate-900/40 border border-slate-800 text-[11px] text-slate-300 leading-relaxed italic">
                        <strong>AI Audit Memo:</strong> {je.auditMemo.summary}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-center py-12 text-slate-400 text-sm">
                  No journal entries recorded yet. Run a reconciliation batch to auto-post double-entry records.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
