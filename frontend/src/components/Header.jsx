import React from 'react';
import {
  ShieldCheck,
  Play,
  RefreshCw,
  Layers,
  Sparkles,
  Bot,
  UploadCloud,
  Download,
  BookOpen,
} from 'lucide-react';

export function Header({
  isConnected,
  isProcessing,
  totalTransactionsCount,
  onTriggerBatch,
  onOpenLedger,
  onOpenController,
  onOpenRules,
  onOpenAISettings,
  onOpenImporter,
  onReset,
}) {
  const hasTransactions = totalTransactionsCount > 0;

  const handleExportAudit = () => {
    window.location.href = '/api/reconciliation/export-audit';
  };

  return (
    <header className="border-b border-razor-border bg-razor-card/90 backdrop-blur-md sticky top-0 z-30 px-4 lg:px-6 py-3.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
        {/* Brand & Title */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-razor-navy to-razor-blue flex items-center justify-center shadow-md shadow-razor-blue/20 border border-razor-blue/30 shrink-0">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-1.5">
                <span className="text-razor-blue font-extrabold">Razorpay</span>
                <span>Recon AI</span>
              </h1>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-mono flex items-center gap-1">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                  }`}
                ></span>
                {isConnected ? 'SSE Live' : 'Connecting...'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 hidden sm:block">
              4-Tier AI Finance Controller
            </p>
          </div>
        </div>

        {/* Action Controls — Single Line with Strict Non-Wrapping */}
        <div className="flex items-center gap-2 flex-nowrap shrink-0">
          {/* 1. Import CSV / Data */}
          <button
            onClick={onOpenImporter}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/40 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer whitespace-nowrap"
            title="Upload Bank Statements or Invoices (CSV / Excel / JSON)"
          >
            <UploadCloud className="w-3.5 h-3.5 text-blue-400" />
            <span>Import CSV</span>
          </button>

          {/* 2. General Ledger & Close */}
          <button
            onClick={onOpenLedger}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-teal-950/40 hover:bg-teal-900/60 text-teal-300 border border-teal-500/40 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer whitespace-nowrap"
            title="Open Rillet-Style Double-Entry General Ledger & Live Trial Balance"
          >
            <BookOpen className="w-3.5 h-3.5 text-teal-400" />
            <span>General Ledger</span>
          </button>

          {/* 3. AI Finance Controller & Cash Forecaster */}
          <button
            onClick={onOpenController}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-950/40 hover:bg-indigo-900/60 text-indigo-300 border border-indigo-500/40 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer whitespace-nowrap"
            title="Open Settlement Q&A Agent and Forward 30/60/90-Day Cash Forecaster"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>AI Controller</span>
          </button>

          {/* 4. Export Auditor CSV */}
          <button
            onClick={handleExportAudit}
            className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-800/90 hover:bg-slate-700 text-slate-300 border border-slate-700/80 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer whitespace-nowrap"
            title="Download Cryptographically Chained Auditor Evidence CSV"
          >
            <Download className="w-3.5 h-3.5 text-slate-400" />
            <span className="hidden md:inline">Audit CSV</span>
          </button>

          {/* Divider */}
          <div className="h-4 w-px bg-slate-800 mx-0.5 hidden sm:block"></div>

          {/* 5. Rule Cache (Tier 3) */}
          <button
            onClick={onOpenRules}
            className="p-1.5 text-slate-400 hover:text-purple-300 rounded-lg hover:bg-slate-800/80 border border-transparent hover:border-slate-700 transition cursor-pointer"
            title="View & Manage Tier-3 Self-Healing Rule Cache"
          >
            <Layers className="w-4 h-4 text-purple-400" />
          </button>

          {/* 6. AI Engine Settings */}
          <button
            onClick={onOpenAISettings}
            className="p-1.5 text-slate-400 hover:text-indigo-300 rounded-lg hover:bg-slate-800/80 border border-transparent hover:border-slate-700 transition cursor-pointer"
            title="Configure Gemini 1.5 Flash API Key & Settings"
          >
            <Bot className="w-4 h-4 text-indigo-400" />
          </button>

          {/* 7. Reset Ledger */}
          <button
            onClick={onReset}
            disabled={isProcessing}
            className="p-1.5 text-slate-400 hover:text-red-400 rounded-lg hover:bg-slate-800/80 border border-transparent hover:border-slate-700 transition disabled:opacity-50 cursor-pointer"
            title="Reset Ledger & Clear Feed"
          >
            <RefreshCw
              className={`w-4 h-4 ${isProcessing ? 'animate-spin text-razor-blue' : ''}`}
            />
          </button>

          {/* 8. Primary Reconcile Batch Button */}
          <button
            onClick={onTriggerBatch}
            disabled={isProcessing || !hasTransactions}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${
              hasTransactions
                ? 'bg-razor-blue hover:bg-razor-blueHover text-white shadow-md shadow-razor-blue/30 cursor-pointer'
                : 'bg-slate-800 text-slate-500 border border-slate-700/60 cursor-not-allowed opacity-60'
            }`}
            title={
              hasTransactions
                ? 'Run 4-Tier Reconciliation Batch on current transactions'
                : 'Import bank statement CSV first to enable batch reconciliation'
            }
          >
            <Play className={`w-3.5 h-3.5 ${isProcessing ? 'animate-spin' : 'fill-current'}`} />
            <span>
              {isProcessing
                ? 'Reconciling...'
                : hasTransactions
                ? `Reconcile (${totalTransactionsCount})`
                : 'Reconcile'}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}
