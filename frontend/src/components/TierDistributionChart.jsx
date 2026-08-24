import React from 'react';
import { Cpu, Zap, Database, AlertCircle } from 'lucide-react';

export function TierDistributionChart({ stats }) {
  const {
    totalTransactions = 0,
    tierDistribution = { tier1: 0, tier2: 0, tier3: 0, manual: 0 },
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
  const expPct = 100 - (t1Pct + t2Pct + t3Pct);

  return (
    <div className="p-4 rounded-xl bg-razor-card border border-razor-border">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5 text-razor-blue" />
          Cascaded Tier Execution Distribution
        </h4>
        <span className="text-[11px] text-slate-400 font-mono">
          Cost: Tier 1 & 2 ($0.00) • Tier 3 ($0.005)
        </span>
      </div>

      {/* Multi-segment Progress Bar */}
      <div className="w-full h-3 bg-slate-900 rounded-full overflow-hidden flex border border-slate-800">
        {t1 > 0 && (
          <div
            className="bg-razor-blue h-full transition-all duration-500 relative group"
            style={{ width: `${(t1 / total) * 100}%` }}
            title={`Tier 1 (Exact): ${t1} txns (${t1Pct}%)`}
          ></div>
        )}
        {t2 > 0 && (
          <div
            className="bg-emerald-500 h-full transition-all duration-500 relative group"
            style={{ width: `${(t2 / total) * 100}%` }}
            title={`Tier 2 (Rule Cache): ${t2} txns (${t2Pct}%)`}
          ></div>
        )}
        {t3 > 0 && (
          <div
            className="bg-razor-purple h-full transition-all duration-500 relative group"
            style={{ width: `${(t3 / total) * 100}%` }}
            title={`Tier 3 (GenAI Pool): ${t3} txns (${t3Pct}%)`}
          ></div>
        )}
        {exp > 0 && (
          <div
            className="bg-amber-500 h-full transition-all duration-500 relative group"
            style={{ width: `${(exp / total) * 100}%` }}
            title={`Exceptions / Outbox: ${exp} txns (${expPct}%)`}
          ></div>
        )}
      </div>

      {/* Tier Badges & Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 pt-2 border-t border-slate-800/80 text-xs">
        {/* Tier 1 */}
        <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-900/60 border border-slate-800">
          <div className="w-2.5 h-2.5 rounded-full bg-razor-blue"></div>
          <div>
            <div className="font-semibold text-white flex items-center gap-1">
              <span>Tier 1: Deterministic</span>
              <span className="font-mono text-razor-blue">({t1})</span>
            </div>
            <p className="text-[10px] text-slate-400 font-mono">&lt;10ms • $0 Cost</p>
          </div>
        </div>

        {/* Tier 2 */}
        <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-900/60 border border-slate-800">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
          <div>
            <div className="font-semibold text-white flex items-center gap-1">
              <span>Tier 2: Rule Cache</span>
              <span className="font-mono text-emerald-400">({t2})</span>
            </div>
            <p className="text-[10px] text-slate-400 font-mono">&lt;20ms • $0 Cost</p>
          </div>
        </div>

        {/* Tier 3 */}
        <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-900/60 border border-slate-800">
          <div className="w-2.5 h-2.5 rounded-full bg-razor-purple"></div>
          <div>
            <div className="font-semibold text-white flex items-center gap-1">
              <span>Tier 3: GenAI Pool</span>
              <span className="font-mono text-purple-400">({t3})</span>
            </div>
            <p className="text-[10px] text-slate-400 font-mono">p-limit(5) • Multi-modal</p>
          </div>
        </div>

        {/* Exceptions */}
        <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-900/60 border border-slate-800">
          <div className="w-2.5 h-2.5 rounded-full bg-amber-500"></div>
          <div>
            <div className="font-semibold text-white flex items-center gap-1">
              <span>Exceptions Outbox</span>
              <span className="font-mono text-amber-400">({exp})</span>
            </div>
            <p className="text-[10px] text-slate-400 font-mono">Human Action Queue</p>
          </div>
        </div>
      </div>
    </div>
  );
}
