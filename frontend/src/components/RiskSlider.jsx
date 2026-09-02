import React from 'react';
import { Sliders, Search, Filter, X, ShieldCheck, Sparkles, AlertCircle, Layers, CheckCircle2 } from 'lucide-react';

export function RiskSlider({
  minConfidence = 0,
  onConfidenceChange,
  statusFilter = 'ALL',
  onStatusChange,
  onStatusFilterChange,
  searchQuery = '',
  onSearchChange,
  filteredCount = 0,
  totalCount = 0,
  counts = {},
}) {
  const handleStatusChange = onStatusChange || onStatusFilterChange;

  const NECESSARY_TABS = [
    {
      key: 'ALL',
      label: 'All Records',
      icon: Layers,
      count: counts.all ?? totalCount,
      activeClass: 'bg-razor-blue/20 text-razor-blue border-razor-blue/50 shadow-sm shadow-razor-blue/10',
      badgeClass: 'bg-razor-blue/30 text-blue-300',
    },
    {
      key: 'MATCHED',
      label: 'Auto-Reconciled',
      icon: CheckCircle2,
      count: counts.matched ?? 0,
      activeClass: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50 shadow-sm shadow-emerald-500/10',
      badgeClass: 'bg-emerald-500/30 text-emerald-200',
    },
    {
      key: 'PROPOSED',
      label: 'Review Queue',
      icon: ShieldCheck,
      count: counts.proposed ?? 0,
      activeClass: 'bg-purple-500/20 text-purple-400 border-purple-500/50 shadow-sm shadow-purple-500/10',
      badgeClass: 'bg-purple-500/30 text-purple-200',
    },
    {
      key: 'TIER_3',
      label: 'GenAI Pool (Tier 3)',
      icon: Sparkles,
      count: counts.tier3 ?? 0,
      activeClass: 'bg-violet-500/20 text-violet-300 border-violet-500/50 shadow-sm shadow-violet-500/10',
      badgeClass: 'bg-violet-500/30 text-violet-200',
    },
    {
      key: 'EXCEPTION',
      label: 'Discrepancies / Outbox',
      icon: AlertCircle,
      count: counts.exception ?? 0,
      activeClass: 'bg-amber-500/20 text-amber-400 border-amber-500/50 shadow-sm shadow-amber-500/10',
      badgeClass: 'bg-amber-500/30 text-amber-200',
    },
  ];

  // Helper for confidence badge color
  const getSliderBadge = () => {
    if (minConfidence <= 0.01) {
      return { label: 'All Records (0% Min)', class: 'bg-slate-800 text-slate-300 border-slate-700' };
    }
    const pct = Math.round(minConfidence * 100);
    if (pct >= 95) {
      return { label: `≥ ${pct}% (Strict / Verified)`, class: 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60' };
    }
    if (pct >= 80) {
      return { label: `≥ ${pct}% (Balanced AI)`, class: 'bg-blue-950/80 text-blue-300 border-blue-700/60' };
    }
    return { label: `≥ ${pct}% Min`, class: 'bg-amber-950/80 text-amber-300 border-amber-700/60' };
  };

  const sliderBadge = getSliderBadge();

  return (
    <div className="p-4 rounded-xl bg-razor-card border border-razor-border space-y-4 shadow-sm">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Risk & Confidence Slider */}
        <div className="flex-1 max-w-xl">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <div className="flex items-center gap-1.5 font-medium text-slate-300">
              <Sliders className="w-3.5 h-3.5 text-razor-blue" />
              <span>Risk & Confidence Threshold:</span>
              <span className={`font-mono font-bold text-[11px] px-2 py-0.5 rounded border transition-colors ${sliderBadge.class}`}>
                {sliderBadge.label}
              </span>
            </div>
            <span className="text-[11px] text-slate-400 font-mono hidden sm:inline">
              0ms Real-Time Filter
            </span>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="range"
              min="0"
              max="1.0"
              step="0.01"
              value={minConfidence}
              onChange={(e) => onConfidenceChange(parseFloat(e.target.value))}
              className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-razor-blue"
              title={`Confidence threshold: ${(minConfidence * 100).toFixed(0)}%`}
            />

            {/* Quick Presets */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => onConfidenceChange(0)}
                className={`text-[10px] px-2.5 py-1 rounded font-mono transition-all cursor-pointer ${
                  minConfidence <= 0.01
                    ? 'bg-razor-blue text-white font-bold shadow-sm'
                    : 'bg-slate-800/80 hover:bg-slate-700 text-slate-400 border border-slate-700/60'
                }`}
                title="Show 100% of records regardless of confidence"
              >
                All (0%)
              </button>
              <button
                type="button"
                onClick={() => onConfidenceChange(0.8)}
                className={`text-[10px] px-2.5 py-1 rounded font-mono transition-all cursor-pointer ${
                  Math.abs(minConfidence - 0.8) < 0.02
                    ? 'bg-razor-blue text-white font-bold shadow-sm'
                    : 'bg-slate-800/80 hover:bg-slate-700 text-slate-400 border border-slate-700/60'
                }`}
                title="Balanced: records with >= 80% confidence"
              >
                80%
              </button>
              <button
                type="button"
                onClick={() => onConfidenceChange(0.95)}
                className={`text-[10px] px-2.5 py-1 rounded font-mono transition-all cursor-pointer ${
                  Math.abs(minConfidence - 0.95) < 0.02
                    ? 'bg-emerald-600 text-white font-bold shadow-sm'
                    : 'bg-slate-800/80 hover:bg-slate-700 text-slate-400 border border-slate-700/60'
                }`}
                title="Strict: only >= 95% verified/exact matches"
              >
                95%
              </button>
            </div>
          </div>
        </div>

        {/* Search Bar & Result Counter */}
        <div className="flex items-center gap-3">
          <div className="relative min-w-[240px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search UTR, Invoice, Vendor, Amount..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-8 pr-7 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-razor-blue transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-0.5 cursor-pointer"
                title="Clear search"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="text-xs text-slate-400 font-mono whitespace-nowrap bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-slate-800">
            Showing <span className="text-white font-semibold">{filteredCount}</span> of {totalCount}
          </div>
        </div>
      </div>

      {/* Filter Tabs — Only the Necessary Lifecycle Buckets */}
      <div className="flex items-center flex-wrap gap-2 pt-2 border-t border-slate-800/80 text-xs">
        <span className="text-slate-400 text-[11px] font-medium flex items-center gap-1 mr-1">
          <Filter className="w-3 h-3 text-slate-400" /> Filter:
        </span>

        {NECESSARY_TABS.map((tab) => {
          const isActive = statusFilter === tab.key;
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleStatusChange && handleStatusChange(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-xs transition-all cursor-pointer flex items-center gap-2 border ${
                isActive
                  ? `${tab.activeClass} font-semibold`
                  : 'bg-slate-900/70 hover:bg-slate-800/90 text-slate-400 border-slate-800 hover:text-slate-200'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? '' : 'opacity-70'}`} />
              <span>{tab.label}</span>
              <span
                className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full font-medium ${
                  isActive ? tab.badgeClass : 'bg-slate-800 text-slate-400'
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}

        {statusFilter !== 'ALL' && (
          <button
            type="button"
            onClick={() => handleStatusChange && handleStatusChange('ALL')}
            className="text-[11px] text-slate-400 hover:text-razor-blue px-2 py-1 rounded transition-colors ml-auto font-mono cursor-pointer"
          >
            Reset Filter
          </button>
        )}
      </div>
    </div>
  );
}
