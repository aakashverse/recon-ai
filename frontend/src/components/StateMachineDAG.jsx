import React, { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { X, CheckCircle, AlertTriangle, Clock, Zap, ArrowRight, ShieldAlert, Cpu } from 'lucide-react';

// Custom DAG Node component
function CustomDAGNode({ data }) {
  const { title, subtitle, status, durationMs, tier, details } = data;

  const isSuccess = status === 'SUCCESS';
  const isBypassed = status === 'BYPASSED';
  const isFailed = status === 'FAILED';
  const isDiscrepancy = status === 'DISCREPANCY_DETECTED';

  let borderColor = 'border-slate-700';
  let bgColor = 'bg-slate-900';
  let badgeColor = 'bg-slate-800 text-slate-400';

  if (isSuccess) {
    borderColor = 'border-emerald-500/90 shadow-lg shadow-emerald-500/20 ring-1 ring-emerald-500/30';
    bgColor = 'bg-slate-900/95';
    badgeColor = 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
  } else if (isDiscrepancy) {
    borderColor = 'border-amber-500/90 shadow-lg shadow-amber-500/20 ring-1 ring-amber-500/30';
    bgColor = 'bg-slate-900/95';
    badgeColor = 'bg-amber-500/20 text-amber-300 border border-amber-500/40';
  } else if (isBypassed) {
    borderColor = 'border-slate-800 border-dashed opacity-50';
    bgColor = 'bg-slate-950/60';
    badgeColor = 'bg-slate-800/60 text-slate-500';
  } else if (isFailed) {
    borderColor = 'border-rose-500/60 opacity-80';
    bgColor = 'bg-slate-900/90';
    badgeColor = 'bg-rose-500/20 text-rose-400 border border-rose-500/30';
  }

  return (
    <div className={`w-[260px] rounded-xl border p-3.5 ${borderColor} ${bgColor} text-xs shadow-xl transition-all select-none`}>
      <Handle type="target" position={Position.Top} className="!bg-razor-blue !w-2.5 !h-2.5" />
      <Handle type="target" id="left" position={Position.Left} className="!bg-slate-600 !w-2 !h-2" />
      
      <div className="flex items-center justify-between gap-1 mb-1.5">
        <span className="font-bold text-white tracking-tight truncate">{title}</span>
        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-md font-bold uppercase tracking-wider ${badgeColor}`}>
          {status}
        </span>
      </div>

      {subtitle && <p className="text-[11px] text-slate-400 leading-tight mb-2 font-medium">{subtitle}</p>}

      {details && (
        <div className="mt-2 p-2 rounded-lg bg-slate-950/90 border border-slate-800/80 font-mono text-[10px] text-slate-300 leading-snug break-words max-h-24 overflow-y-auto">
          {details}
        </div>
      )}

      <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono text-slate-400">
        <span className="flex items-center gap-1.5">
          <Clock className="w-3 h-3 text-slate-400" />
          {durationMs !== undefined ? `${Number(durationMs).toFixed(1)}ms` : '0ms'}
        </span>
        {tier && <span className="text-razor-blue font-semibold px-1.5 py-0.5 rounded bg-razor-blue/10 border border-razor-blue/20">{tier}</span>}
      </div>

      <Handle type="source" id="right" position={Position.Right} className="!bg-slate-600 !w-2 !h-2" />
      <Handle type="source" position={Position.Bottom} className="!bg-razor-blue !w-2.5 !h-2.5" />
    </div>
  );
}

const nodeTypes = { custom: CustomDAGNode };

export function StateMachineDAG({ transaction, onClose }) {
  if (!transaction) return null;

  const metrics = transaction.executionMetrics || {};
  const cb = transaction.circuitBreaker || {};

  // Build DAG Graph dynamically with clean, non-overlapping coordinates across 4 Tiers
  const { nodes, edges } = useMemo(() => {
    const isMatched = transaction.reconciliationStatus === 'MATCHED';
    const tier = transaction.matchedTier;

    const graphNodes = [
      {
        id: '1',
        type: 'custom',
        position: { x: 460, y: 20 },
        data: {
          title: '1. Ingest & Idempotency Guard',
          subtitle: `SHA-256 Hash: ${transaction.bankTxnId}`,
          status: 'SUCCESS',
          durationMs: 0.4,
          tier: 'Guard',
          details: `Amount: ₹${Number(transaction.amount || 0).toLocaleString('en-IN')} | UTR: ${transaction.utrNumber || 'N/A'}`,
        },
      },
      {
        id: '2',
        type: 'custom',
        position: { x: 20, y: 220 },
        data: {
          title: '2. Tier 1: Deterministic Exact',
          subtitle: 'Exact Gross & UTR Match (<2ms)',
          status: tier === 'TIER_1' ? 'SUCCESS' : 'FAILED',
          durationMs: metrics.tier1DurationMs || 1.2,
          tier: 'Tier 1',
          details: tier === 'TIER_1' ? 'Exact gross invoice match found ($0 deductions)' : 'Has deductions/variance, cascading to Tier 2',
        },
      },
      {
        id: '3',
        type: 'custom',
        position: { x: 310, y: 220 },
        data: {
          title: '3. Tier 2: Tolerance & Split',
          subtitle: 'Statutory TDS, Split-Match (<5ms)',
          status: tier === 'TIER_2' ? 'SUCCESS' : tier === 'TIER_1' ? 'BYPASSED' : 'FAILED',
          durationMs: metrics.tier2DurationMs || (tier === 'TIER_1' ? 0 : 3.5),
          tier: 'Tier 2',
          details: tier === 'TIER_2' ? 'Explainable statutory TDS / split match verified' : tier === 'TIER_1' ? 'Bypassed (Resolved in Tier 1)' : 'Delta unexplained, cascading to Tier 3',
        },
      },
      {
        id: '4',
        type: 'custom',
        position: { x: 600, y: 220 },
        data: {
          title: '4. Tier 3: Rule Cache',
          subtitle: 'Vendor Pattern Cache (<10ms)',
          status: tier === 'TIER_3' ? 'SUCCESS' : (tier === 'TIER_1' || tier === 'TIER_2') ? 'BYPASSED' : 'FAILED',
          durationMs: metrics.tier3DurationMs || (tier === 'TIER_1' || tier === 'TIER_2' ? 0 : 4.5),
          tier: 'Tier 3',
          details: tier === 'TIER_3' ? 'Matched learned vendor deduction rule' : (tier === 'TIER_1' || tier === 'TIER_2') ? 'Bypassed' : 'No rule found, cascading to Tier 4',
        },
      },
      {
        id: '5',
        type: 'custom',
        position: { x: 890, y: 220 },
        data: {
          title: '5. Tier 4: GenAI & RAG Pool',
          subtitle: 'Gemini Flash + RAG Cache (p-limit 5)',
          status: tier === 'TIER_4' ? 'SUCCESS' : (tier === 'TIER_1' || tier === 'TIER_2' || tier === 'TIER_3') ? 'BYPASSED' : 'DISCREPANCY_DETECTED',
          durationMs: metrics.tier4DurationMs || (tier === 'TIER_4' ? 18.5 : 0),
          tier: 'Tier 4',
          details: tier === 'TIER_4' ? (metrics.ragCacheHit ? '⚡ RAG Cache Hit: Reused verified pattern ($0 cost)' : 'Live Gemini AI structured parsing & reasoning') : (tier === 'TIER_1' || tier === 'TIER_2' || tier === 'TIER_3') ? 'Bypassed (Resolved deterministically)' : 'Unstructured narration flagged',
        },
      },
      {
        id: '6',
        type: 'custom',
        position: { x: 460, y: 450 },
        data: {
          title: '6. Zero-Trust Circuit Breaker',
          subtitle: 'Mathematical Equation Proof',
          status: isMatched ? 'SUCCESS' : 'DISCREPANCY_DETECTED',
          durationMs: metrics.circuitBreakerDurationMs || 0.4,
          tier: 'Circuit Breaker',
          details: cb.equation || (isMatched ? 'Gross - Deductions ≡ Bank Received [EXACT MATCH]' : 'Gross - Deductions ≠ Bank Received [DISCREPANCY DETECTED]'),
        },
      },
      {
        id: '7',
        type: 'custom',
        position: { x: 460, y: 670 },
        data: {
          title: isMatched ? '7. ACID Multi-Doc Commit (PAID)' : '7. Agentic Outbox Queue',
          subtitle: isMatched ? 'Status: PAID • Reconciled' : 'Status: FLAGGED_FOR_HUMAN',
          status: isMatched ? 'SUCCESS' : 'DISCREPANCY_DETECTED',
          durationMs: 2.1,
          tier: isMatched ? 'Commit' : 'Outbox',
          details: isMatched ? 'General ledger committed with cryptographic hash link.' : 'Dispatched to WhatsApp / Email Discrepancy Action Queue.',
        },
      },
    ];

    const graphEdges = [
      { id: 'e1-2', source: '1', target: '2', type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e2-3', source: '2', target: '3', sourceHandle: 'right', targetHandle: 'left', type: 'smoothstep', style: { strokeDasharray: '4,4' }, markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e3-4', source: '3', target: '4', sourceHandle: 'right', targetHandle: 'left', type: 'smoothstep', style: { strokeDasharray: '4,4' }, markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e4-5', source: '4', target: '5', sourceHandle: 'right', targetHandle: 'left', type: 'smoothstep', style: { strokeDasharray: '4,4' }, markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e2-6', source: '2', target: '6', type: 'smoothstep', animated: tier === 'TIER_1', style: { stroke: tier === 'TIER_1' ? '#10B981' : '#334155', strokeWidth: tier === 'TIER_1' ? 2 : 1 }, markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e3-6', source: '3', target: '6', type: 'smoothstep', animated: tier === 'TIER_2', style: { stroke: tier === 'TIER_2' ? '#10B981' : '#334155', strokeWidth: tier === 'TIER_2' ? 2 : 1 }, markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e4-6', source: '4', target: '6', type: 'smoothstep', animated: tier === 'TIER_3', style: { stroke: tier === 'TIER_3' ? '#10B981' : '#334155', strokeWidth: tier === 'TIER_3' ? 2 : 1 }, markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e5-6', source: '5', target: '6', type: 'smoothstep', animated: tier === 'TIER_4' || !isMatched, style: { stroke: tier === 'TIER_4' ? '#10B981' : !isMatched ? '#F59E0B' : '#334155', strokeWidth: tier === 'TIER_4' || !isMatched ? 2 : 1 }, markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e6-7', source: '6', target: '7', type: 'smoothstep', animated: true, style: { stroke: isMatched ? '#10B981' : '#F59E0B', strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed } },
    ];

    return { nodes: graphNodes, edges: graphEdges };
  }, [transaction]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-razor-card border border-razor-border rounded-2xl w-full max-w-5xl h-[88vh] flex flex-col shadow-2xl overflow-hidden animate-fade-in">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-razor-border bg-slate-900/90 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-razor-blue/20 border border-razor-blue/40 flex items-center justify-center">
              <Cpu className="w-5 h-5 text-razor-blue" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">
                  4-Tier DAG State Machine Trace: <span className="font-mono text-razor-blue">{transaction.bankTxnId}</span>
                </h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                  {transaction.executionMetrics?.totalDurationMs ? `${transaction.executionMetrics.totalDurationMs}ms Total` : '<20ms'}
                </span>
                {transaction.executionMetrics?.ragCacheHit && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-mono border border-purple-500/40">
                    ⚡ RAG Cache Hit
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 truncate max-w-xl">
                Narration: <span className="text-slate-200 font-mono">{transaction.narration}</span>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* React Flow Visual DAG Canvas */}
        <div className="flex-1 bg-razor-dark relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            attributionPosition="bottom-left"
          >
            <Background color="#1E2D4A" gap={16} size={1} />
            <Controls className="!bg-slate-900 !border-slate-800 !text-white" />
          </ReactFlow>
        </div>

        {/* Modal Footer / Arithmetic Breakdown Banner */}
        <div className="px-6 py-3 border-t border-razor-border bg-slate-900/90 flex flex-col md:flex-row md:items-center justify-between text-xs gap-2">
          <div className="flex items-center gap-2 font-mono">
            <span className="text-slate-400 font-semibold">Circuit Breaker Math:</span>
            <span className={`font-semibold ${transaction.reconciliationStatus === 'MATCHED' ? 'text-emerald-400' : 'text-amber-400'}`}>
              {cb.equation || (transaction.reconciliationStatus === 'MATCHED' ? 'Gross - Deductions ≡ Bank Received [EXACT MATCH]' : 'Gross - Deductions ≠ Bank Received [DISCREPANCY DETECTED]')}
            </span>
          </div>
          <div className="text-right font-mono text-slate-400">
            Confidence: <span className="text-white font-bold">{Math.round((transaction.confidenceScore || 1) * 100)}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
