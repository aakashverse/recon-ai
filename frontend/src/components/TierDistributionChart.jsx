import React from 'react';
import { Cpu, Zap, Database, AlertCircle, Sparkles } from 'lucide-react';

export function TierDistributionChart({ stats, statusFilter = 'ALL', onSelectStatus }) {
  const {
    totalTransactions = 0,
    tierDistribution = { tier1: 0, tier2: 0, tier3: 0, manual: 0 },
    ragCacheHits = 0,
    exceptionCount = 0,
  } = stats || {};

  const t1 = tierDistribution.tier1 || 0;
  const t2 = tierDistribution.tier2 || 0;
  const t3 = tierDistribution.tier3 || 0;
  const exp = exceptionCount || 0;

  const total = t1 + t2 + t3 + exp || 1;
  const t1Pct = Math.round((t1 / total) * 100);
  const t2Pct = Math.round((t2 / total) * 100);
  const t3Pct = Math.round((t3 / total) * 100);
  const expPct = Math.max(0, 100 - (t1Pct + t2Pct + t3Pct));

  const handleCardClick = (tierKey) => {
    if (!onSelectStatus) return;
    onSelectStatus(statusFilter === tierKey ? 'ALL' : tierKey);
  };

  return (
    <div className="p-4 rounded-xl bg-razor-card border border-razor-border">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5 text-razor-blue" />
          3-Tier Cascaded Execution Distribution
        </h4>
        <span className="text-[11px] text-slate-400 font-mono">
          Cost: Tiers 1-2 &amp; RAG ($0.00) • Tier 3 Gemini Flash ($0.005)
        </span>
      </div>

      {/* Multi-segment Progress Bar */}
      <div className="w-full h-3 bg-slate-900 rounded-full overflow-hidden flex border border-slate-800">
        {t1 > 0 && (
          <div
            className="bg-razor-blue h-full transition-all duration-500 relative group cursor-pointer"
            style={{ width: `${(t1 / total) * 100}%` }}
            title={`Tier 1 (Exact): ${t1} txns (${t1Pct}%)`}
            onClick={() => handleCardClick('TIER_1')}
          ></div>
        )}
        {t2 > 0 && (
          <div
            className="bg-teal-500 h-full transition-all duration-500 relative group cursor-pointer"
            style={{ width: `${(t2 / total) * 100}%` }}
            title={`Tier 2 (Rules & Split): ${t2} txns (${t2Pct}%)`}
            onClick={() => handleCardClick('TIER_2')}
          ></div>
        )}
        {t3 > 0 && (
          <div
            className="bg-razor-purple h-full transition-all duration-500 relative group cursor-pointer"
            style={{ width: `${(t3 / total) * 100}%` }}
            title={`Tier 3 (GenAI & RAG): ${t3} txns (${t3Pct}%)`}
            onClick={() => handleCardClick('TIER_3')}
          ></div>
        )}
        {exp > 0 && (
          <div
            className="bg-amber-500 h-full transition-all duration-500 relative group cursor-pointer"
            style={{ width: `${(exp / total) * 100}%` }}
            title={`Exceptions / Outbox: ${exp} txns (${expPct}%)`}
            onClick={() => handleCardClick('EXCEPTION')}
          ></div>
        )}
      </div>

      {/* Tier Badges & Quick-Filter Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 pt-2 border-t border-slate-800/80 text-xs">
        {/* Tier 1 */}
        <div
          onClick={() => handleCardClick('TIER_1')}
          className={`flex items-center gap-2 p-2 rounded-lg transition-all cursor-pointer border ${
            statusFilter === 'TIER_1'
              ? 'bg-razor-blue/20 border-razor-blue shadow-sm shadow-razor-blue/20'
              : 'bg-slate-900/60 border-slate-800 hover:bg-slate-800/80 hover:border-slate-700'
          }`}
          title="Click to filter by Tier 1: Exact Matches"
        >
          <div className="w-2.5 h-2.5 rounded-full bg-razor-blue shrink-0"></div>
          <div className="min-w-0">
            <div className="font-semibold text-white truncate flex items-center gap-1">
              <span>Tier 1: Exact</span>
              <span className="font-mono text-razor-blue">({t1})</span>
            </div>
            <p className="text-[10px] text-slate-400 font-mono">&lt;2ms • $0 Cost</p>
          </div>
        </div>

        {/* Tier 2 */}
        <div
          onClick={() => handleCardClick('TIER_2')}
          className={`flex items-center gap-2 p-2 rounded-lg transition-all cursor-pointer border ${
            statusFilter === 'TIER_2'
              ? 'bg-teal-500/20 border-teal-500 shadow-sm shadow-teal-500/20'
              : 'bg-slate-900/60 border-slate-800 hover:bg-slate-800/80 hover:border-slate-700'
          }`}
          title="Click to filter by Tier 2: Rules & Split Matches"
        >
          <div className="w-2.5 h-2.5 rounded-full bg-teal-500 shrink-0"></div>
          <div className="min-w-0">
            <div className="font-semibold text-white truncate flex items-center gap-1">
              <span>Tier 2: Rules &amp; Split</span>
              <span className="font-mono text-teal-400">({t2})</span>
            </div>
            <p className="text-[10px] text-slate-400 font-mono">&lt;5ms • TDS / Split</p>
          </div>
        </div>

        {/* Tier 3 */}
        <div
          onClick={() => handleCardClick('TIER_3')}
          className={`flex items-center gap-2 p-2 rounded-lg transition-all cursor-pointer border ${
            statusFilter === 'TIER_3'
              ? 'bg-purple-500/20 border-purple-500 shadow-sm shadow-purple-500/20'
              : 'bg-slate-900/60 border-slate-800 hover:bg-slate-800/80 hover:border-slate-700'
          }`}
          title="Click to filter by Tier 3: GenAI Pool Matches"
        >
          <div className="w-2.5 h-2.5 rounded-full bg-razor-purple shrink-0"></div>
          <div className="min-w-0">
            <div className="font-semibold text-white truncate flex items-center gap-1">
              <span>Tier 3: GenAI Pool</span>
              <span className="font-mono text-purple-400">({t3})</span>
            </div>
            <p className="text-[10px] text-slate-400 font-mono">
              {ragCacheHits > 0 ? `${ragCacheHits} RAG Cache Hits` : 'Google Gemini Flash'}
            </p>
          </div>
        </div>

        {/* Exceptions */}
        <div
          onClick={() => handleCardClick('EXCEPTION')}
          className={`flex items-center gap-2 p-2 rounded-lg transition-all cursor-pointer border ${
            statusFilter === 'EXCEPTION'
              ? 'bg-amber-500/20 border-amber-500 shadow-sm shadow-amber-500/20'
              : 'bg-slate-900/60 border-slate-800 hover:bg-slate-800/80 hover:border-slate-700'
          }`}
          title="Click to filter by Agentic Outbox Exceptions"
        >
          <div className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0"></div>
          <div className="min-w-0">
            <div className="font-semibold text-white truncate flex items-center gap-1">
              <span>Agentic Outbox</span>
              <span className="font-mono text-amber-400">({exp})</span>
            </div>
            <p className="text-[10px] text-slate-400 font-mono">Math Discrepancies</p>
          </div>
        </div>
      </div>
    </div>
  );
}
