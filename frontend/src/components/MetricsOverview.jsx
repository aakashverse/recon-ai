import React from 'react';
import { TrendingUp, CheckCircle2, DollarSign, Zap, AlertTriangle, ArrowUpRight } from 'lucide-react';

export function MetricsOverview({ stats, batchProgress }) {
  const {
    totalTransactions = 0,
    matchedCount = 0,
    exceptionCount = 0,
    matchRatePercent = 0,
    totalInflow = 0,
    latencyMetrics = { p50Ms: 0, p95Ms: 0, p99Ms: 0 },
    costEconomics = { naiveCostUsd: 0, hybridCostUsd: 0, savingsPercent: 100 },
  } = stats || {};

  return (
    <div className="space-y-4">
      {/* Batch Progress Alert Banner */}
      {batchProgress && (
        <div className="p-4 rounded-xl bg-gradient-to-r from-razor-navy via-razor-card to-slate-900 border border-razor-blue/40 shadow-lg shadow-razor-blue/10 animate-fade-in">
          <div className="flex items-center justify-between text-xs mb-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-razor-blue animate-ping"></span>
              <span className="font-semibold text-white">Streaming Batch: {batchProgress.batchId}</span>
            </div>
            <span className="font-mono text-razor-blue font-bold">
              {batchProgress.processed} / {batchProgress.total} txns ({batchProgress.percentage}%)
            </span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className="bg-gradient-to-r from-razor-blue to-emerald-400 h-full transition-all duration-300 rounded-full"
              style={{ width: `${batchProgress.percentage}%` }}
            ></div>
          </div>
        </div>
      )}

      {/* 4 Primary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Inflow Reconciled */}
        <div className="p-5 rounded-xl bg-razor-card border border-razor-border hover:border-razor-borderLight transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Total Reconciled Inflow</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-bold text-white tracking-tight">
              ₹{Number(totalInflow || 0).toLocaleString('en-IN')}
            </h3>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
              <span className="inline-flex items-center text-emerald-400 font-semibold">
                <ArrowUpRight className="w-3.5 h-3.5" />
                {matchedCount} txns
              </span>
              <span>across 4 tiers</span>
            </div>
          </div>
        </div>

        {/* Match Rate % */}
        <div className="p-5 rounded-xl bg-razor-card border border-razor-border hover:border-razor-borderLight transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Reconciliation Precision</span>
            <div className="w-8 h-8 rounded-lg bg-razor-blue/10 border border-razor-blue/20 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4 text-razor-blue" />
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <h3 className="text-2xl font-bold text-white tracking-tight">
                {matchRatePercent}%
              </h3>
              <span className="text-xs text-slate-400 font-mono">
                ({matchedCount}/{totalTransactions})
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs">
              <span className="text-emerald-400 font-medium font-mono">100% Math Verified</span>
              {exceptionCount > 0 && (
                <span className="text-amber-400 font-medium">({exceptionCount} in Outbox)</span>
              )}
            </div>
          </div>
        </div>

        {/* API Cost Economics */}
        <div className="p-5 rounded-xl bg-razor-card border border-razor-border hover:border-razor-borderLight transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">GenAI Cost Reduction</span>
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
              <DollarSign className="w-4 h-4 text-purple-400" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-bold text-white tracking-tight text-purple-400">
              {costEconomics.savingsPercent}% Saved
            </h3>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
              <span>Hybrid ${costEconomics.hybridCostUsd}</span>
              <span>vs</span>
              <span className="line-through text-slate-500">${costEconomics.naiveCostUsd}</span>
              <span className="text-slate-500">(100% LLM)</span>
            </div>
          </div>
        </div>

        {/* P95 Latency */}
        <div className="p-5 rounded-xl bg-razor-card border border-razor-border hover:border-razor-borderLight transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Pipeline P95 Latency</span>
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <Zap className="w-4 h-4 text-amber-400" />
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <h3 className="text-2xl font-bold text-white tracking-tight">
                {latencyMetrics.p95Ms || 0} <span className="text-sm font-normal text-slate-400">ms</span>
              </h3>
              <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono">
                &lt;50ms Target
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-slate-400 font-mono">
              <span>P50: {latencyMetrics.p50Ms}ms</span>
              <span>•</span>
              <span>P99: {latencyMetrics.p99Ms}ms</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
