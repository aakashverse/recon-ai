import React from 'react';
import { ShieldCheck, Play, RefreshCw, Layers, Cpu, Sparkles, Bot, UploadCloud, Download, BookOpen } from 'lucide-react';

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
    window.location.href = 'http://localhost:5000/api/reconciliation/export-audit';
  };

  return (
    <header className="border-b border-razor-border bg-razor-card/80 backdrop-blur-md sticky top-0 z-30 px-6 py-4">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-1">
        {/* Brand & Title */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-razor-navy to-razor-blue flex items-center justify-center shadow-lg shadow-razor-blue/20 border border-razor-blue/30">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1">
              <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                 <span className="text-razor-blue font-extrabold">Recon AI</span>
              </h1>
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-mono flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
                {isConnected ? 'SSE Live' : 'Connecting...'}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Enterprise B2B 4-Tier AI Finance Controller
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Primary CSV / Data Ingestion Button */}
          <button
            onClick={onOpenImporter}
            className="px-2 py-2 text-xs font-bold rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white border border-emerald-400/30 transition-all flex items-center gap-1.5 shadow-md shadow-emerald-600/20 cursor-pointer animate-pulse-slow"
            title="Upload Real Bank Statements or Invoices (CSV / Excel / JSON)"
          >
            <UploadCloud className="w-4 h-4 text-white" />
            <span>Import CSV / Data</span>
          </button>

          {/* Export Auditor CSV */}
          <button
            onClick={handleExportAudit}
            className="px-2 py-2  text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/80 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
            title="Download Cryptographically Chained Auditor Evidence CSV"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span>Export Audit CSV</span>
          </button>

          {/* General Ledger & Zero-Day Close */}
          <button
            onClick={onOpenLedger}
            className="px-2 py-2 text-xs font-semibold rounded-lg bg-emerald-950/50 hover:bg-emerald-900/70 text-emerald-300 border border-emerald-500/40 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
            title="Open Rillet-Style Double-Entry General Ledger & Live Trial Balance"
          >
            <BookOpen className="w-3.5 h-3.5 text-emerald-400" />
            <span>General Ledger & Close</span>
          </button>

          {/* AI Finance Controller & Cash Forecaster */}
          <button
            onClick={onOpenController}
            className="px-2 py-2 text-xs font-semibold rounded-lg bg-indigo-950/50 hover:bg-indigo-900/70 text-indigo-300 border border-indigo-500/40 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
            title="Open Settlement Q&A Agent and Forward 30/60/90-Day Cash Forecaster"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>AI Controller & Forecaster</span>
          </button>

          <button
            onClick={onOpenAISettings}
            className="px-2 py-2 text-xs font-medium rounded-lg bg-purple-950/40 hover:bg-purple-900/60 text-purple-300 border border-purple-500/40 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
            title="Configure Gemini 1.5 Flash Free Tier API Key"
          >
            <Bot className="w-3.5 h-3.5 text-purple-400" />
            <span>AI Engine</span>
          </button>

          <button
            onClick={onOpenRules}
            className="px-2 py-2 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/80 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
          >
            <Layers className="w-3.5 h-3.5 text-razor-purple" />
            <span>Rule Cache (Tier 3)</span>
          </button>

          <button
            onClick={onReset}
            disabled={isProcessing}
            className="px-2 py-2 text-xs font-medium rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/60 transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            title="Clear current ledger & start fresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${isProcessing ? 'animate-spin' : ''}`} />
            <span>Reset</span>
          </button>

          <button
            onClick={onTriggerBatch}
            disabled={isProcessing || !hasTransactions}
            className={`px-2 py-2 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
              hasTransactions
                ? 'bg-razor-blue hover:bg-razor-blueHover text-white shadow-md shadow-razor-blue/25 cursor-pointer'
                : 'bg-slate-800 text-slate-500 border border-slate-700/60 cursor-not-allowed opacity-60'
            }`}
            title={hasTransactions ? 'Run reconciliation batch on current transactions' : 'Upload bank statement CSV first to enable batch reconciliation'}
          >
            <Play className={`w-3.5 h-3.5 ${isProcessing ? 'animate-spin' : 'fill-current'}`} />
            <span>
              {isProcessing
                ? 'Reconciling...'
                : hasTransactions
                ? `Reconcile (${totalTransactionsCount} Txns)`
                : 'Reconcile (No Data)'}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}
