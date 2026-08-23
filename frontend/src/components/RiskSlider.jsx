import React from 'react';
import { Sliders, Search, Filter, Check, AlertCircle } from 'lucide-react';

export function RiskSlider({
  minConfidence,
  onConfidenceChange,
  statusFilter,
  onStatusFilterChange,
  searchQuery,
  onSearchChange,
  filteredCount,
  totalCount,
}) {
  return (
    <div className="p-4 rounded-xl bg-razor-card border border-razor-border space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Risk / Confidence Slider */}
        <div className="flex-1 max-w-lg">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <div className="flex items-center gap-1.5 font-medium text-slate-300">
              <Sliders className="w-3.5 h-3.5 text-razor-blue" />
              <span>0ms In-Memory Risk & Confidence Filter:</span>
              <span className="text-white font-mono font-bold bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                {(minConfidence * 100).toFixed(0)}% Min
              </span>
            </div>
            <span className="text-[11px] text-slate-400 font-mono">
              Instant Local React Filter
            </span>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="range"
              min="0.5"
              max="1.0"
              step="0.01"
              value={minConfidence}
              onChange={(e) => onConfidenceChange(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-razor-blue"
            />
            {/* Quick Presets */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => onConfidenceChange(0.95)}
                className={`text-[10px] px-2 py-0.5 rounded font-mono transition-all ${
                  minConfidence === 0.95
                    ? 'bg-razor-blue text-white font-bold shadow-sm'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-400'
                }`}
                title="Strict 95%+ Confidence"
              >
                95%
              </button>
              <button
                onClick={() => onConfidenceChange(0.8)}
                className={`text-[10px] px-2 py-0.5 rounded font-mono transition-all ${
                  minConfidence === 0.8
                    ? 'bg-razor-blue text-white font-bold shadow-sm'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-400'
                }`}
                title="Balanced 80%+ Confidence"
              >
                80%
              </button>
              <button
                onClick={() => onConfidenceChange(0.5)}
                className={`text-[10px] px-2 py-0.5 rounded font-mono transition-all ${
                  minConfidence === 0.5
                    ? 'bg-razor-blue text-white font-bold shadow-sm'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-400'
                }`}
                title="All records >= 50%"
              >
                All
              </button>
            </div>
          </div>
        </div>

        {/* Search Bar & Stats */}
        <div className="flex items-center gap-3">
          <div className="relative min-w-[220px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter UTR, Invoice, Narration..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-razor-blue transition-colors"
            />
          </div>

          <div className="text-xs text-slate-400 font-mono whitespace-nowrap bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-slate-800">
            Showing <span className="text-white font-semibold">{filteredCount}</span> of {totalCount}
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center flex-wrap gap-2 pt-2 border-t border-slate-800/80 text-xs">
        <span className="text-slate-400 text-[11px] font-medium flex items-center gap-1 mr-1">
          <Filter className="w-3 h-3 text-slate-400" /> Filter by:
        </span>

        {[
          { key: 'ALL', label: 'All Records' },
          { key: 'MATCHED', label: 'Matched (Paid)', count: null },
          { key: 'EXCEPTION', label: 'Discrepancies / Outbox' },
          { key: 'TIER_1', label: 'Tier 1 (Deterministic)' },
          { key: 'TIER_2', label: 'Tier 2 (Rule Cache)' },
          { key: 'TIER_3', label: 'Tier 3 (GenAI Pool)' },
        ].map((tab) => {
          const isActive = statusFilter === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => onStatusFilterChange(tab.key)}
              className={`px-2.5 py-1 rounded-md text-xs transition-all ${
                isActive
                  ? 'bg-razor-blue/20 text-razor-blue border border-razor-blue/40 font-semibold'
                  : 'bg-slate-900/60 hover:bg-slate-800 text-slate-400 border border-slate-800'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
