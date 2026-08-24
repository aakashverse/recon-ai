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
    borderColor = 'border-emerald-500/80 shadow-lg shadow-emerald-500/10';
    bgColor = 'bg-slate-900';
    badgeColor = 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40';
  } else if (isDiscrepancy) {
    borderColor = 'border-amber-500/80 shadow-lg shadow-amber-500/10';
    bgColor = 'bg-slate-900';
    badgeColor = 'bg-amber-500/20 text-amber-400 border border-amber-500/40';
  } else if (isBypassed) {
    borderColor = 'border-slate-800 border-dashed opacity-60';
    bgColor = 'bg-slate-950/80';
    badgeColor = 'bg-slate-800/60 text-slate-500';
  } else if (isFailed) {
    borderColor = 'border-rose-500/60';
    bgColor = 'bg-slate-900';
    badgeColor = 'bg-rose-500/20 text-rose-400';
  }

  return (
    <div className={`w-64 rounded-xl border p-3 ${borderColor} ${bgColor} text-xs shadow-md transition-all`}>
      <Handle type="target" position={Position.Top} className="!bg-razor-blue" />
      
      <div className="flex items-center justify-between gap-1 mb-1.5">
        <span className="font-bold text-white tracking-tight truncate">{title}</span>
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full font-semibold ${badgeColor}`}>
          {status}
        </span>
      </div>

      {subtitle && <p className="text-[11px] text-slate-400 leading-tight mb-2">{subtitle}</p>}

      {details && (
        <div className="mt-2 p-2 rounded bg-slate-950/80 border border-slate-800 font-mono text-[10px] text-slate-300 leading-snug break-words">
          {details}
        </div>
      )}

      <div className="mt-2 pt-1.5 border-t border-slate-800 flex items-center justify-between text-[10px] font-mono text-slate-400">
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3 text-slate-400" />
          {durationMs !== undefined ? `${Number(durationMs).toFixed(1)}ms` : '0ms'}
        </span>
        {tier && <span className="text-razor-blue font-semibold">{tier}</span>}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-razor-blue" />
    </div>
  );
}

const nodeTypes = { custom: CustomDAGNode };

export function StateMachineDAG({ transaction, onClose }) {
  if (!transaction) return null;

  const dagNodes = transaction.dagNodes || [];
  const metrics = transaction.executionMetrics || {};
  const cb = transaction.circuitBreaker || {};

  // Build DAG Graph dynamically
  const { nodes, edges } = useMemo(() => {
    const isMatched = transaction.reconciliationStatus === 'MATCHED';
    const tier = transaction.matchedTier;

    const graphNodes = [
      {
        id: '1',
        type: 'custom',
        position: { x: 250, y: 20 },
        data: {
          title: '1. Ingest & Idempotency Guard',
          subtitle: `SHA-256 Hash: ${transaction.bankTxnId}`,
          status: 'SUCCESS',
          durationMs: 0.5,
          tier: 'Guard',
          details: `Payload: ₹${transaction.amount} | UTR: ${transaction.utrNumber || 'N/A'}`,
        },
      },
      {
        id: '2',
        type: 'custom',
        position: { x: 50, y: 170 },
        data: {
          title: '2. Tier 1: Deterministic Math',
          subtitle: 'Exact UTR & Hash Lookup (<10ms)',
          status: tier === 'TIER_1' ? 'SUCCESS' : 'FAILED',
          durationMs: metrics.tier1DurationMs || 1.8,
          tier: 'Tier 1',
          details: tier === 'TIER_1' ? 'Exact gross invoice match found' : 'No exact match, falling back to Tier 2',
        },
      },
      {
        id: '3',
        type: 'custom',
        position: { x: 450, y: 170 },
        data: {
          title: '3. Tier 2: Self-Healing Cache',
          subtitle: 'Historical Vendor Pattern Match (<20ms)',
          status: tier === 'TIER_2' ? 'SUCCESS' : tier === 'TIER_1' ? 'BYPASSED' : 'FAILED',
          durationMs: metrics.tier2DurationMs || (tier === 'TIER_1' ? 0 : 4.5),
          tier: 'Tier 2',
          details: tier === 'TIER_2' ? `Matched vendor deduction rule` : tier === 'TIER_1' ? 'Bypassed (Tier 1 matched)' : 'No rule found, falling back to GenAI',
        },
      },
      {
        id: '4',
        type: 'custom',
        position: { x: 250, y: 330 },
        data: {
          title: '4. Tier 3: GenAI & Vision Pool',
          subtitle: 'Gemini 1.5 Structured Parser (p-limit 5)',
          status: tier === 'TIER_3' ? 'SUCCESS' : (tier === 'TIER_1' || tier === 'TIER_2') ? 'BYPASSED' : 'DISCREPANCY_DETECTED',
          durationMs: metrics.tier3DurationMs || (tier === 'TIER_3' ? 6.2 : 0),
          tier: 'Tier 3',
          details: tier === 'TIER_3' ? 'Tokens extracted: TDS & Invoice mapped' : (tier === 'TIER_1' || tier === 'TIER_2') ? 'Bypassed (Resolved in Tier 1/2)' : 'Unstructured narration flagged',
        },
      },
      {
        id: '5',
        type: 'custom',
        position: { x: 250, y: 490 },
        data: {
          title: '5. The Circuit Breaker (Node.js)',
          subtitle: 'Zero-Trust Arithmetic Validation',
          status: isMatched ? 'SUCCESS' : 'DISCREPANCY_DETECTED',
          durationMs: metrics.circuitBreakerDurationMs || 0.4,
          tier: 'Circuit Breaker',
          details: cb.equation || (isMatched ? 'Gross - Deductions ≡ Bank Received [EXACT MATCH]' : 'Gross - Deductions ≠ Bank Received [DISCREPANCY DETECTED]'),
        },
      },
      {
        id: '6',
        type: 'custom',
        position: { x: 250, y: 640 },
        data: {
          title: isMatched ? '6. ACID Transaction Commit' : '6. Agentic Outbox Dispatched',
          subtitle: isMatched ? 'Status: PAID • Reconciled' : 'Status: FLAGGED_FOR_HUMAN',
          status: isMatched ? 'SUCCESS' : 'DISCREPANCY_DETECTED',
          durationMs: 2.1,
          tier: isMatched ? 'Commit' : 'Outbox',
          details: isMatched ? 'Invoice and Bank Ledger state committed atomically.' : 'Dispatched to WhatsApp / Email Discrepancy Action Queue.',
        },
      },
    ];

    const graphEdges = [
      { id: 'e1-2', source: '1', target: '2', type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e1-3', source: '1', target: '3', type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e2-5', source: '2', target: '5', type: 'smoothstep', animated: tier === 'TIER_1', markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e3-5', source: '3', target: '5', type: 'smoothstep', animated: tier === 'TIER_2', markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e3-4', source: '3', target: '4', type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e4-5', source: '4', target: '5', type: 'smoothstep', animated: tier === 'TIER_3', markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e5-6', source: '5', target: '6', type: 'smoothstep', animated: true, markerEnd: { type: MarkerType.ArrowClosed } },
    ];

    return { nodes: graphNodes, edges: graphEdges };
  }, [transaction]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-razor-card border border-razor-border rounded-2xl w-full max-w-5xl h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-fade-in">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-razor-border bg-slate-900/90 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-razor-blue/20 border border-razor-blue/40 flex items-center justify-center">
              <Cpu className="w-5 h-5 text-razor-blue" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">
                  DAG State Machine Trace: <span className="font-mono text-razor-blue">{transaction.bankTxnId}</span>
                </h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                  {transaction.executionMetrics?.totalDurationMs ? `${transaction.executionMetrics.totalDurationMs}ms Total` : '<20ms'}
                </span>
              </div>
              <p className="text-xs text-slate-400 truncate max-w-xl">
                Narration: <span className="text-slate-200 font-mono">{transaction.narration}</span>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
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
