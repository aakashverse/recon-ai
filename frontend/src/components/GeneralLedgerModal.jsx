import React, { useState, useEffect, useMemo } from 'react';
import {
  BookOpen,
  CheckCircle2,
  AlertCircle,
  FileText,
  TrendingUp,
  X,
  RefreshCw,
  Search,
  Filter,
  ShieldCheck,
  Building2,
  Receipt,
  PieChart,
} from 'lucide-react';

export function GeneralLedgerModal({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState('trial-balance'); // 'trial-balance' or 'journal-entries'
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  // Filters for Trial Balance Tab
  const [accountTypeFilter, setAccountTypeFilter] = useState('ALL');
  const [accountSearchQuery, setAccountSearchQuery] = useState('');

  // Filters for Journal Entries Tab
  const [journalTierFilter, setJournalTierFilter] = useState('ALL');
  const [journalSearchQuery, setJournalSearchQuery] = useState('');

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

  // Filtered Trial Balance Accounts
  const filteredAccounts = useMemo(() => {
    if (!data?.trialBalance) return [];
    return data.trialBalance.filter((acc) => {
      // Type filter
      if (accountTypeFilter !== 'ALL' && acc.type !== accountTypeFilter) {
        return false;
      }
      // Search query
      if (accountSearchQuery.trim()) {
        const q = accountSearchQuery.toLowerCase();
        const code = (acc.code || '').toLowerCase();
        const name = (acc.name || '').toLowerCase();
        return code.includes(q) || name.includes(q);
      }
      return true;
    });
  }, [data?.trialBalance, accountTypeFilter, accountSearchQuery]);

  // Filtered Journal Entries
  const filteredJournalEntries = useMemo(() => {
    if (!data?.recentJournalEntries) return [];
    return data.recentJournalEntries.filter((je) => {
      // Tier filter
      if (journalTierFilter !== 'ALL') {
        const jeTier = je.reconciliationTier || 'TIER_1';
        if (jeTier !== journalTierFilter) return false;
      }
      // Search query
      if (journalSearchQuery.trim()) {
        const q = journalSearchQuery.toLowerCase();
        const num = (je.journalEntryNumber || '').toLowerCase();
        const txnId = (je.bankTxnId || '').toLowerCase();
        const inv = (je.invoiceNumber || '').toLowerCase();
        const memo = (je.auditMemo?.summary || '').toLowerCase();
        const debitParty = (je.debitLines || []).map((d) => d.accountName || '').join(' ').toLowerCase();
        const creditParty = (je.creditLines || []).map((c) => (c.partyName || c.accountName || '')).join(' ').toLowerCase();

        return (
          num.includes(q) ||
          txnId.includes(q) ||
          inv.includes(q) ||
          memo.includes(q) ||
          debitParty.includes(q) ||
          creditParty.includes(q)
        );
      }
      return true;
    });
  }, [data?.recentJournalEntries, journalTierFilter, journalSearchQuery]);

  if (!isOpen) return null;

  const totalDebits = Number(data?.totalDebits || 0);
  const totalCredits = Number(data?.totalCredits || 0);
  const variance = Number(Math.abs(totalDebits - totalCredits).toFixed(2));
  const isBalanced = variance <= 1.0;

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
                AI-Native General Ledger &amp; Zero-Day Close
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
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all cursor-pointer ${
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
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                  activeTab === 'journal-entries'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                Auto-Journal Stream
                {data?.recentJournalEntries?.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 rounded-full bg-slate-900 text-[10px] text-emerald-300 border border-slate-700 font-mono">
                    {data.recentJournalEntries.length}
                  </span>
                )}
              </button>
            </div>

            <button
              onClick={fetchTrialBalance}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer"
              title="Refresh Ledger"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
            </button>

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Dynamic Continuous Close Banner */}
        {data?.continuousCloseMetrics && (
          <div className="px-6 py-3 bg-slate-950/40 border-b border-slate-800/80 flex items-center justify-between text-xs flex-wrap gap-3">
            <div className="flex items-center gap-4 flex-wrap">
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
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">GL Auto-Journals:</span>
                <span className="font-bold text-indigo-300 font-mono">
                  {data.continuousCloseMetrics.totalJournalEntriesCount || 0} Posted
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
        <div className="flex-1 p-6 overflow-y-auto min-h-0 bg-slate-900/50 space-y-4">
          {loading && !data ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
              <RefreshCw className="w-8 h-8 animate-spin text-emerald-500" />
              <p className="text-sm">Calculating real-time double-entry general ledger &amp; trial balance...</p>
            </div>
          ) : activeTab === 'trial-balance' ? (
            <div className="space-y-4">
              {/* Trial Balance Filter Controls */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1 mr-1">
                    <Filter className="w-3 h-3 text-slate-400" /> Account Type:
                  </span>
                  {[
                    { key: 'ALL', label: 'All Accounts' },
                    { key: 'ASSET', label: 'Assets (1000s)' },
                    { key: 'REVENUE', label: 'Revenue (4000s)' },
                    { key: 'EXPENSE', label: 'Expenses (5000s)' },
                  ].map((tab) => {
                    const isActive = accountTypeFilter === tab.key;
                    return (
                      <button
                        key={tab.key}
                        onClick={() => setAccountTypeFilter(tab.key)}
                        className={`px-2.5 py-1 rounded-md text-xs transition-all cursor-pointer ${
                          isActive
                            ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 font-semibold'
                            : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800'
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                <div className="relative min-w-[220px] w-full sm:w-auto">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search Code or Account Name..."
                    value={accountSearchQuery}
                    onChange={(e) => setAccountSearchQuery(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>
              </div>

              {/* Trial Balance Table */}
              <div className="border border-slate-700/80 rounded-xl overflow-hidden shadow-lg bg-slate-950/40">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-800/90 text-slate-300 font-semibold border-b border-slate-700">
                    <tr>
                      <th className="py-3 px-4">Account Code</th>
                      <th className="py-3 px-4">Account Title &amp; Ledger Description</th>
                      <th className="py-3 px-4">Type</th>
                      <th className="py-3 px-4 text-right">Debit (INR ₹)</th>
                      <th className="py-3 px-4 text-right">Credit (INR ₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-200">
                    {filteredAccounts.length > 0 ? (
                      filteredAccounts.map((acc, idx) => (
                        <tr key={idx} className="hover:bg-slate-800/40 transition">
                          <td className="py-2.5 px-4 font-mono text-emerald-400 font-semibold">{acc.code}</td>
                          <td className="py-2.5 px-4 font-medium">{acc.name}</td>
                          <td className="py-2.5 px-4">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                acc.type === 'ASSET'
                                  ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                  : acc.type === 'REVENUE'
                                  ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              }`}
                            >
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
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-500">
                          No matching accounts found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {/* Table Footer Totals */}
                  <tfoot className="bg-slate-950 font-bold border-t-2 border-slate-700 text-slate-100 text-xs">
                    <tr>
                      <td colSpan={3} className="py-3 px-4 text-slate-300">
                        TOTAL TRIAL BALANCE (Double-Entry Verification)
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-emerald-400 text-sm">
                        ₹{totalDebits.toLocaleString('en-IN')}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-emerald-400 text-sm">
                        ₹{totalCredits.toLocaleString('en-IN')}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Dynamic Integrity Callout */}
              <div
                className={`flex items-center justify-between p-3 rounded-xl border text-xs ${
                  isBalanced
                    ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                    : 'bg-amber-950/30 border-amber-500/30 text-amber-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  {isBalanced ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                  )}
                  <span>
                    <strong>Double-Entry Ledger Integrity: {isBalanced ? '100% Balanced.' : 'Imbalance Detected.'}</strong>{' '}
                    {isBalanced
                      ? 'Every reconciled transaction has generated balanced debit and credit entries with exact zero variance.'
                      : `Total Debits (₹${totalDebits.toLocaleString('en-IN')}) differ from Total Credits (₹${totalCredits.toLocaleString('en-IN')}) by ₹${variance.toFixed(2)}.`}
                  </span>
                </div>
                <span
                  className={`font-mono text-[10px] text-center px-2 py-0.5 rounded-full border ${
                    isBalanced
                      ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300'
                      : 'bg-amber-500/20 border-amber-500/30 text-amber-300'
                  }`}
                >
                  Δ = ₹{variance.toFixed(2)} Variance
                </span>
              </div>
            </div>
          ) : (
            /* Tab 2: Journal Entries Stream */
            <div className="space-y-4">
              {/* Journal Stream Filter Controls */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1 mr-1">
                    <Filter className="w-3 h-3 text-slate-400" /> Filter by Tier:
                  </span>
                  {[
                    { key: 'ALL', label: 'All Tiers' },
                    { key: 'TIER_1', label: 'Tier 1 (Exact)' },
                    { key: 'TIER_2', label: 'Tier 2 (Tolerance/Split)' },
                    { key: 'TIER_3', label: 'Tier 3 (Rule Cache)' },
                    { key: 'TIER_4', label: 'Tier 4 (GenAI Pool)' },
                  ].map((tab) => {
                    const isActive = journalTierFilter === tab.key;
                    return (
                      <button
                        key={tab.key}
                        onClick={() => setJournalTierFilter(tab.key)}
                        className={`px-2.5 py-1 rounded-md text-xs transition-all cursor-pointer ${
                          isActive
                            ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 font-semibold'
                            : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800'
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <div className="relative min-w-[220px] flex-1 sm:flex-none">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Search Entry #, Txn ID, Invoice, Party..."
                      value={journalSearchQuery}
                      onChange={(e) => setJournalSearchQuery(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>
                  <span className="text-[11px] text-slate-400 font-mono whitespace-nowrap">
                    {filteredJournalEntries.length} of {data?.recentJournalEntries?.length || 0}
                  </span>
                </div>
              </div>

              {/* Journal Entries List */}
              <div className="space-y-3">
                {filteredJournalEntries.length > 0 ? (
                  filteredJournalEntries.map((je, idx) => (
                    <div key={idx} className="p-4 rounded-xl bg-slate-800/70 border border-slate-700/80 space-y-3">
                      <div className="flex items-center justify-between border-b border-slate-700/60 pb-2.5 flex-wrap gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
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
                          <span className="text-[10px] px-2 py-0.5 rounded font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                            {je.reconciliationTier || 'TIER_1'}
                          </span>
                        </div>
                        <span className="text-xs text-slate-400">
                          {je.createdAt ? new Date(je.createdAt).toLocaleString('en-IN') : 'Just now'}
                        </span>
                      </div>

                      {/* Debits and Credits Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                        {/* Debits */}
                        <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-700/50 space-y-1.5">
                          <span className="font-bold text-emerald-400 flex items-center justify-between">
                            <span>Debits (Dr)</span>
                            <span className="font-mono">₹{je.totalDebit?.toLocaleString('en-IN')}</span>
                          </span>
                          {je.debitLines?.map((d, dIdx) => (
                            <div key={dIdx} className="flex justify-between text-slate-300 text-[11px]">
                              <span>{d.accountName} <span className="font-mono text-slate-400">({d.accountCode})</span></span>
                              <span className="font-mono font-semibold text-slate-100">₹{d.amount?.toLocaleString('en-IN')}</span>
                            </div>
                          ))}
                        </div>

                        {/* Credits */}
                        <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-700/50 space-y-1.5">
                          <span className="font-bold text-purple-400 flex items-center justify-between">
                            <span>Credits (Cr)</span>
                            <span className="font-mono">₹{je.totalCredit?.toLocaleString('en-IN')}</span>
                          </span>
                          {je.creditLines?.map((c, cIdx) => (
                            <div key={cIdx} className="flex justify-between text-slate-300 text-[11px]">
                              <span>{c.accountName} <span className="font-mono text-slate-400">({c.accountCode})</span></span>
                              <span className="font-mono font-semibold text-slate-100">₹{c.amount?.toLocaleString('en-IN')}</span>
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
                  <div className="text-center py-12 text-slate-400 text-sm bg-slate-950/30 rounded-xl border border-slate-800">
                    No journal entries match the selected filter criteria.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
