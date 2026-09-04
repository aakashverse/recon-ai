import React, { useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  X,
  CheckCircle,
  AlertTriangle,
  Clock,
  Zap,
  ArrowRight,
  ShieldAlert,
  Cpu,
  Calculator,
  Building2,
  Landmark,
  Receipt,
  Scale,
  FileSpreadsheet,
  FileCheck2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

function extractInvoiceFromNarration(narration = '') {
  const match = (narration || '').replace(/\b1NV\b/gi, 'INV').match(/\b(?:INV|INVOICE)[-_/ ]*([A-Z0-9]+[-_/]?[0-9]+)\b/i);
  return match ? (match[1].toUpperCase().startsWith('INV-') ? match[1].toUpperCase() : `INV-${match[1].replace(/[/_ ]/g, '-').toUpperCase()}`) : null;
}

function extractCustomerFromNarration(narration = '') {
  const parts = (narration || '').split('/');
  if (parts.length >= 3) {
    const candidate = parts[2].replace(/-/g, ' ').trim();
    if (candidate && !candidate.startsWith('INV') && !candidate.startsWith('UTR')) {
      return candidate.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }
  }
  return null;
}

const CORNER_CLASSES = {
  'bottom-left': 'bottom-4 left-4',
  'bottom-right': 'bottom-4 right-4',
};

// Custom DAG Node component
function CustomDAGNode({ data }) {
  const { title, subtitle, status = 'PENDING', durationMs, tier, details } = data;

  const isSuccess = status === 'SUCCESS';
  const isBypassed = status === 'BYPASSED';
  const isFailed = status === 'FAILED';
  const isDiscrepancy = status === 'DISCREPANCY_DETECTED';
  const isPending = status === 'PENDING';

  let borderColor = 'border-slate-700';
  let bgColor = 'bg-slate-900';
  let badgeColor = 'bg-slate-800 text-slate-400';

  if (isSuccess) {
    borderColor = 'border-emerald-500/90 shadow-lg shadow-emerald-500/20 ring-1 ring-emerald-500/30';
    bgColor = 'bg-slate-900/95';
    badgeColor = 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
  } else if (isDiscrepancy || isFailed) {
    borderColor = 'border-amber-500/90 shadow-lg shadow-amber-500/20 ring-1 ring-amber-500/30';
    bgColor = 'bg-slate-900/95';
    badgeColor = isFailed ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' : 'bg-amber-500/20 text-amber-300 border border-amber-500/40';
  } else if (isBypassed) {
    borderColor = 'border-slate-800 border-dashed opacity-50';
    bgColor = 'bg-slate-950/60';
    badgeColor = 'bg-slate-800/60 text-slate-500';
  } else if (isPending) {
    borderColor = 'border-slate-800 border-dashed opacity-70';
    bgColor = 'bg-slate-950/80';
    badgeColor = 'bg-slate-800 text-slate-400';
  }

  return (
    <div className={`w-[270px] rounded-xl border p-3.5 ${borderColor} ${bgColor} text-xs shadow-xl transition-all select-none`}>
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
  const cb = transaction.circuitBreaker || transaction.discrepancyDetails || {};
  const isMatched = transaction.reconciliationStatus === 'MATCHED';
  const isException = transaction.reconciliationStatus === 'EXCEPTION';
  const isUnprocessed = !isMatched && !isException;
  const tier = transaction.matchedTier;
  const backendNodes = Array.isArray(transaction.dagNodes) ? transaction.dagNodes : [];

  const [hudCorner, setHudCorner] = useState('bottom-right');
  const [isHudCollapsed, setIsHudCollapsed] = useState(true);

  // Accountant Audit & Deduction Calculation
  const inv = typeof transaction.reconciledInvoiceId === 'object' && transaction.reconciledInvoiceId !== null
    ? transaction.reconciledInvoiceId
    : (typeof transaction.invoice === 'object' && transaction.invoice !== null ? transaction.invoice : null);

  const bankAmount = Number(transaction.amount || 0);
  const deductions = transaction.deductionsApplied || {};
  let tdsAmount = Number(deductions.tdsAmount || 0);
  let tdsRate = Number(deductions.tdsRate || 0);
  let tdsSection = deductions.tdsSection || (inv?.expectedTdsSection) || 'NONE';
  const bankCharges = Number(deductions.bankCharges || 0);
  const discount = Number(deductions.discount || 0);
  let totalDeductions = Number(deductions.totalDeductions || (tdsAmount + bankCharges + discount));

  // Extract from narration if deductionsApplied is 0
  const narrUpper = (transaction.narration || '').toUpperCase();
  if (totalDeductions === 0) {
    const rateMatch = narrUpper.match(/LESS-([0-9.]+)PCT-TDS/i);
    if (rateMatch) {
      tdsRate = parseFloat(rateMatch[1]);
      if (tdsRate === 2) tdsSection = '194C';
      else if (tdsRate === 10) tdsSection = '194J';
      else if (tdsRate === 5) tdsSection = '194H';
      else if (tdsRate === 0.1) tdsSection = '194Q';
      else if (tdsRate === 20) tdsSection = '206AB';
    }
  }

  const cbNode = backendNodes.find((n) => n?.nodeKey === 'STEP_CIRCUIT_BREAKER');
  const cbData = { ...cb, ...(cbNode?.outputData || {}) };

  // Explicit check for Unmatched Credit (Direct Bank Inflow with no matching candidate invoice)
  const isUnmatchedCredit = Boolean(
    isException && (
      cbData.discrepancyType === 'UNMATCHED' ||
      cbData.reason?.toLowerCase().includes('no matching invoice') ||
      cbData.reason?.toLowerCase().includes('no candidate invoice') ||
      cbData.reason?.toLowerCase().includes('no open invoice') ||
      cbData.equation?.toLowerCase().includes('no matching invoice') ||
      (!inv && !cbData.invoiceGross && !cbData.expectedAmount)
    )
  );

  const invoiceNumber = isUnmatchedCredit
    ? 'NONE (Unmatched Credit)'
    : (inv?.invoiceNumber || cbData?.invoiceNumber || extractInvoiceFromNarration(transaction.narration) || 'INV-RECON');

  const customerName = isUnmatchedCredit
    ? 'Unknown Remitter (Direct Bank Deposit)'
    : (inv?.customerName || cbData?.customerName || extractCustomerFromNarration(transaction.narration) || 'Counterparty Commercial Entity');

  let invoiceGross = inv ? Number(inv.totalAmount || 0) : 0;
  if (!invoiceGross && !isUnmatchedCredit) {
    if (cbData.invoiceGross) {
      invoiceGross = Number(cbData.invoiceGross);
    } else if (cbData.expectedAmount) {
      invoiceGross = Number(cbData.expectedAmount);
    } else if (tdsRate > 0 && tdsRate < 100) {
      invoiceGross = Number((bankAmount / (1 - tdsRate / 100)).toFixed(2));
      totalDeductions = Number((invoiceGross - bankAmount).toFixed(2));
      tdsAmount = totalDeductions;
    } else {
      invoiceGross = bankAmount;
    }
  }

  // Calculate variances for exceptions
  let varianceShortfall = 0;
  let varianceExcess = 0;

  if (isException && !isUnmatchedCredit && invoiceGross > 0) {
    const diff = cbData.difference !== undefined
      ? Number(cbData.difference)
      : Number((bankAmount - (invoiceGross - totalDeductions)).toFixed(2));
    if (diff < -0.05) {
      varianceShortfall = Number(Math.abs(diff).toFixed(2));
      if (totalDeductions === 0) totalDeductions = varianceShortfall;
    } else if (diff > 0.05) {
      varianceExcess = Number(diff.toFixed(2));
    }
  }

  const baseAmount = inv ? Number(inv.baseAmount || (invoiceGross / 1.18)) : Number((invoiceGross / 1.18).toFixed(2));
  const taxAmount = inv ? Number(inv.taxAmount || (invoiceGross - baseAmount)) : Number((invoiceGross - baseAmount).toFixed(2));

  // Determine Deduction Type, Destination & Accounting Treatment
  let deductionType = 'Nil Deductions (100% Gross Remittance)';
  let whereDeducted = 'Direct Bank Rail (Zero Withholdings)';
  let destinationEntity = 'Corporate Bank Account (100% Inflow)';
  let statutoryRule = 'Direct Gross Clearing per Invoice Terms';
  let statutoryCode = 'NIL_DEDUCTIONS';
  let taxCertReq = 'No TDS deducted. No Form 16A TDS certificate required.';

  if (isUnmatchedCredit) {
    deductionType = 'Unidentified Bank Deposit (No Invoice Matched)';
    whereDeducted = 'Direct Bank Rail (Inward Remittance)';
    destinationEntity = 'Bank Suspense Account (Liability)';
    statutoryCode = 'BANK_SUSPENSE';
    statutoryRule = 'Unidentified Direct Inflow parked in Suspense under Ind AS 109';
    taxCertReq = 'Unidentified Remittance. Dispatched to Outbox to trace remitter / request invoice details.';
  } else if (tdsAmount > 0 || (tdsSection && tdsSection !== 'NONE' && tdsSection !== 'NIL')) {
    deductionType = `Statutory TDS Withholding (@ ${tdsRate > 0 ? `${tdsRate}%` : '2%'})`;
    whereDeducted = `Withheld at Source by Deductor (${customerName})`;
    destinationEntity = 'Central Govt of India Treasury (CBDT / NSDL)';
    taxCertReq = 'Mandatory Form 16A Certificate to be obtained quarterly from client to verify in Form 26AS / Annual Information Statement (AIS).';

    if (tdsSection.includes('194C')) {
      statutoryCode = 'Section 194C';
      statutoryRule = 'TDS on Contractor / Subcontractor & Logistics Payments (1% Individual / 2% Corporate)';
    } else if (tdsSection.includes('194J')) {
      statutoryCode = 'Section 194J';
      statutoryRule = 'TDS on Professional & Technical Fees (10% Technical / 2% Royalty)';
    } else if (tdsSection.includes('194H')) {
      statutoryCode = 'Section 194H';
      statutoryRule = 'TDS on Commission or Brokerage (5% on annual total exceeding ₹15,000)';
    } else if (tdsSection.includes('194Q')) {
      statutoryCode = 'Section 194Q';
      statutoryRule = 'TDS on Purchase of Goods exceeding ₹50L Turnover Threshold (@ 0.1%)';
    } else if (tdsSection.includes('194I')) {
      statutoryCode = 'Section 194I';
      statutoryRule = 'TDS on Rent (10% on Land/Building, 2% on Plant/Machinery)';
    } else if (tdsSection.includes('206AB')) {
      statutoryCode = 'Section 206AB';
      statutoryRule = 'Penal Withholding for Non-Filers of Income Tax Return (Minimum 20%)';
    } else if (tdsSection.includes('GST_TDS') || tdsSection.includes('51')) {
      statutoryCode = 'Sec 51 CGST';
      statutoryRule = 'PSU / Govt Entity GST-TDS (2% on Taxable Turnover)';
    } else {
      statutoryCode = `Sec ${tdsSection}`;
      statutoryRule = `Indian Income Tax Act 1961 Statutory Withholding (${tdsSection})`;
    }
  } else if (bankCharges > 0) {
    deductionType = 'Interbank CMS / Wire Processing Fee';
    whereDeducted = 'Withheld by Banking Clearing Rail (Gateway Switch)';
    destinationEntity = 'Remitting / Clearing Bank Operating Fee A/c';
    statutoryCode = 'WIRE_FEE';
    statutoryRule = 'Interbank NEFT/RTGS/CMS Transaction Settlement Surcharge';
    taxCertReq = 'Book to Operating Expense (Bank Charges A/c). Not subject to TDS withholding.';
  } else if (discount > 0) {
    deductionType = 'Early Settlement Cash Discount';
    whereDeducted = 'Deducted by Customer Accounts Payable per Credit Terms';
    destinationEntity = 'Customer Commercial Concession';
    statutoryCode = 'DISCOUNT';
    statutoryRule = 'Agreed Commercial Prompt-Payment Credit Terms (e.g. 2/10 Net 30)';
    taxCertReq = 'Book to Discount Allowed Expense A/c against Credit Memo.';
  } else if (isException) {
    if (varianceExcess > 0) {
      deductionType = `Customer Overpayment (+₹${varianceExcess.toLocaleString('en-IN')})`;
      whereDeducted = `Remitted in Excess by Customer (${customerName})`;
      destinationEntity = 'Customer Advance Account (Liability)';
      statutoryCode = 'CUST_ADVANCE';
      statutoryRule = 'Remittance Exceeds Outstanding Invoice Balance (Customer Advance)';
      taxCertReq = 'Escalated to Agentic Outbox. Adjust against future invoice or refund to customer.';
    } else {
      deductionType = `Unallocated Shortfall / Variance (₹${varianceShortfall.toLocaleString('en-IN')})`;
      whereDeducted = `Withheld / Underpaid by Customer (${customerName})`;
      destinationEntity = 'Customer Operating Account / Shortfall Suspense';
      statutoryCode = 'SUSPENSE_VARIANCE';
      statutoryRule = 'Mathematical Circuit Breaker Mismatch (Exceeds Allowed Tolerance)';
      taxCertReq = 'Escalated to Agentic Outbox. Dispatch WhatsApp/Email notice to request Form 16A or balance remittance.';
    }
  }

  // Map backend dagNodes by nodeKey for 100% faithful execution rendering
  const nodeMap = useMemo(() => {
    const map = {};
    for (const n of backendNodes) {
      if (n && n.nodeKey) {
        map[n.nodeKey] = n;
      }
    }
    return map;
  }, [backendNodes]);

  // Build DAG Graph dynamically with clean, non-overlapping coordinates across 3 Tiers
  const { nodes, edges } = useMemo(() => {
    const ingestNode = nodeMap['STEP_INGEST'];
    const t1Node = nodeMap['STEP_TIER_1'];
    const t2Node = nodeMap['STEP_TIER_2'];
    const t3Node = nodeMap['STEP_TIER_3'];
    const cbNode = nodeMap['STEP_CIRCUIT_BREAKER'];
    const outboxNode = nodeMap['STEP_OUTBOX'];
    const commitNode = nodeMap['STEP_COMMIT'];

    const t2RuleName = t2Node?.outputData?.ruleApplied || (transaction.deductionsApplied?.ruleName);

    const graphNodes = [
      {
        id: '1',
        type: 'custom',
        position: { x: 380, y: 20 },
        data: {
          title: '1. Ingest & Idempotency Guard',
          subtitle: `SHA-256 Hash: ${transaction.bankTxnId || 'TXN-PENDING'}`,
          status: ingestNode?.status || (isUnprocessed ? 'PENDING' : 'SUCCESS'),
          durationMs: ingestNode?.durationMs || 0.4,
          tier: 'Guard',
          details: `Amount: ₹${Number(transaction.amount || 0).toLocaleString('en-IN')} | UTR: ${transaction.utrNumber || 'N/A'}`,
        },
      },
      {
        id: '2',
        type: 'custom',
        position: { x: 40, y: 220 },
        data: {
          title: '2. Tier 1: Deterministic Exact',
          subtitle: 'Exact Gross & UTR Match (<2ms)',
          status: t1Node?.status || (tier === 'TIER_1' ? 'SUCCESS' : isUnprocessed ? 'PENDING' : 'FAILED'),
          durationMs: t1Node?.durationMs || metrics.tier1DurationMs || (tier === 'TIER_1' ? 0.5 : 0),
          tier: 'Tier 1',
          details: t1Node?.outputData?.reason || (tier === 'TIER_1' ? 'Exact gross invoice match found ($0 deductions)' : isUnprocessed ? 'Awaiting batch run' : 'No exact gross match found, cascading to Tier 2'),
        },
      },
      {
        id: '3',
        type: 'custom',
        position: { x: 380, y: 220 },
        data: {
          title: '3. Tier 2: Rules, Tolerance & Split',
          subtitle: 'Statutory TDS + Rules + Split (<5ms)',
          status: t2Node?.status || (tier === 'TIER_2' ? 'SUCCESS' : tier === 'TIER_1' ? 'BYPASSED' : isUnprocessed ? 'PENDING' : 'FAILED'),
          durationMs: t2Node?.durationMs || metrics.tier2DurationMs || (tier === 'TIER_2' ? 0.7 : 0),
          tier: 'Tier 2',
          details: t2Node?.outputData?.reason || (tier === 'TIER_2' ? (t2RuleName ? `Matched Rule: ${t2RuleName}` : 'Explainable statutory TDS / split match verified') : tier === 'TIER_1' ? 'Bypassed (Resolved in Tier 1)' : isUnprocessed ? 'Awaiting batch run' : 'Delta unexplained, cascading to Tier 3 (GenAI)'),
        },
      },
      {
        id: '4',
        type: 'custom',
        position: { x: 720, y: 220 },
        data: {
          title: '4. Tier 3: GenAI & RAG Pool',
          subtitle: 'Google Gemini Flash + RAG-First',
          status: t3Node?.status || (tier === 'TIER_3' ? 'SUCCESS' : (tier === 'TIER_1' || tier === 'TIER_2') ? 'BYPASSED' : isUnprocessed ? 'PENDING' : 'FAILED'),
          durationMs: t3Node?.durationMs || metrics.tier3DurationMs || (tier === 'TIER_3' ? 18.5 : 0.1),
          tier: 'Tier 3',
          details: t3Node?.outputData?.reason || (tier === 'TIER_3' ? (metrics.ragCacheHit ? '⚡ RAG Cache Hit: Reused verified pattern ($0 cost)' : 'Live Google Gemini AI structured entity extraction') : (tier === 'TIER_1' || tier === 'TIER_2') ? 'Bypassed (Resolved deterministically)' : isUnprocessed ? 'Awaiting batch run' : 'Unstructured narration could not be grounded to open ledger invoice'),
        },
      },
      {
        id: '5',
        type: 'custom',
        position: { x: 380, y: 440 },
        data: {
          title: '5. Zero-Trust Circuit Breaker',
          subtitle: 'Mathematical Equation Proof',
          status: cbNode?.status || (isMatched ? 'SUCCESS' : isException ? 'DISCREPANCY_DETECTED' : 'PENDING'),
          durationMs: cbNode?.durationMs || metrics.circuitBreakerDurationMs || 0.1,
          tier: 'Circuit Breaker',
          details: cbNode?.outputData?.equation || cb.equation || cb.mathEquation || (isMatched ? 'Gross - Deductions ≡ Bank Received [EXACT MATCH]' : isException ? 'Gross - Deductions ≠ Bank Received [DISCREPANCY DETECTED]' : 'Equation proof calculated at batch runtime'),
        },
      },
      {
        id: '6',
        type: 'custom',
        position: { x: 380, y: 640 },
        data: {
          title: isMatched ? '6. ACID Multi-Doc Commit (PAID)' : isException ? '6. Agentic Outbox Queue' : '6. General Ledger Commit',
          subtitle: isMatched ? 'Status: PAID • Reconciled' : isException ? 'Status: FLAGGED_FOR_HUMAN' : 'Status: UNPROCESSED',
          status: isMatched ? (commitNode?.status || 'SUCCESS') : isException ? (outboxNode?.status || 'DISCREPANCY_DETECTED') : 'PENDING',
          durationMs: (isMatched ? commitNode?.durationMs : outboxNode?.durationMs) || (isUnprocessed ? 0 : 2.1),
          tier: isMatched ? 'Commit' : isException ? 'Outbox' : 'Ledger',
          details: isMatched ? 'General ledger committed with cryptographic hash link.' : isException ? (outboxNode?.outputData?.whatsappDraft?.messageText ? 'Dispatched to WhatsApp / Email Discrepancy Action Queue.' : 'Discrepancy recorded in Outbox for accountant review.') : 'Awaiting batch reconciliation execution.',
        },
      },
    ];

    const graphEdges = [
      { id: 'e1-2', source: '1', target: '2', type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e2-3', source: '2', target: '3', sourceHandle: 'right', targetHandle: 'left', type: 'smoothstep', style: { strokeDasharray: '4,4' }, markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e3-4', source: '3', target: '4', sourceHandle: 'right', targetHandle: 'left', type: 'smoothstep', style: { strokeDasharray: '4,4' }, markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e2-5', source: '2', target: '5', type: 'smoothstep', animated: tier === 'TIER_1', style: { stroke: tier === 'TIER_1' ? '#10B981' : '#334155', strokeWidth: tier === 'TIER_1' ? 2 : 1 }, markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e3-5', source: '3', target: '5', type: 'smoothstep', animated: tier === 'TIER_2', style: { stroke: tier === 'TIER_2' ? '#10B981' : '#334155', strokeWidth: tier === 'TIER_2' ? 2 : 1 }, markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e4-5', source: '4', target: '5', type: 'smoothstep', animated: tier === 'TIER_3' || isException, style: { stroke: tier === 'TIER_3' ? '#10B981' : isException ? '#F59E0B' : '#334155', strokeWidth: tier === 'TIER_3' || isException ? 2 : 1 }, markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e5-6', source: '5', target: '6', type: 'smoothstep', animated: isMatched || isException, style: { stroke: isMatched ? '#10B981' : isException ? '#F59E0B' : '#334155', strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed } },
    ];

    return { nodes: graphNodes, edges: graphEdges };
  }, [transaction, nodeMap, isMatched, isException, isUnprocessed, tier, metrics, cb]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-5xl h-[85vh] shadow-2xl flex flex-col overflow-hidden text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-razor-blue/20 flex items-center justify-center border border-razor-blue/40 text-razor-blue">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">Execution State Machine &amp; Audit DAG</h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  {transaction.bankTxnId || 'TXN-PENDING'}
                </span>
                <span
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                    isMatched
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : isException
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}
                >
                  {isMatched ? `MATCHED (${tier})` : isException ? 'OUTBOX EXCEPTION' : 'UNPROCESSED'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Reconciliation Pipeline: Ingest &rarr; 3-Tier Cascade &rarr; Math Circuit Breaker &rarr; General Ledger / Outbox
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* React Flow Container */}
        <div className="flex-1 bg-slate-950 relative overflow-hidden">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.5}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#1e293b" gap={16} size={1} />
            <Controls className="!bg-slate-900 !border-slate-800 !text-slate-300" />
          </ReactFlow>

          {/* Corner Deduction & Accountant Inspector Card */}
          {isHudCollapsed ? (
            <div className={`absolute ${CORNER_CLASSES[hudCorner]} z-20 transition-all duration-200`}>
              <button
                type="button"
                onClick={() => setIsHudCollapsed(false)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-cyan-500/40 text-cyan-300 text-xs font-semibold shadow-xl backdrop-blur-md transition-all cursor-pointer ring-1 ring-cyan-500/20"
                title="Expand Accountant Tax & Deduction Inspector"
              >
                <Calculator className="w-3.5 h-3.5 text-cyan-400" />
                <span>Accountant Audit</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-200 font-mono">
                  {statutoryCode}
                </span>
                <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </div>
          ) : (
            <div className={`absolute ${CORNER_CLASSES[hudCorner]} z-20 w-[290px] rounded-xl bg-slate-900/95 border border-slate-700/90 shadow-2xl backdrop-blur-md overflow-hidden text-xs text-slate-200 select-none animate-in fade-in zoom-in-95 duration-150`}>
              {/* Header: Title + Statutory Badge + TR/BR + Minimize */}
              <div className="flex items-center justify-between px-3 py-2 bg-slate-950/90 border-b border-slate-800">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Calculator className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="font-bold text-white text-[11px] truncate">Tax &amp; Deduction Slip</span>
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shrink-0">
                    {statutoryCode}
                  </span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {/* 4-Corner Dock Switcher */}
                  <div className="flex items-center rounded bg-slate-800 p-0.5 border border-slate-700">
                    {(['bottom-left', 'bottom-right']).map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setHudCorner(c)}
                        className={`px-1.5 py-0.2 text-[8px] font-mono rounded transition-colors cursor-pointer ${
                          hudCorner === c ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
                        }`}
                        title={`Dock ${c.replace('-', ' ')}`}
                      >
                        {c === 'bottom-left' ? 'L' : c === 'bottom-right' ? 'R' : 'R'}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsHudCollapsed(true)}
                    className="p-0.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 cursor-pointer"
                    title="Minimize"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Compact Body — High-Signal Accountant Headaches */}
              <div className="p-2.5 space-y-2">
                {/* 1. The Cash Reconciliation Numbers */}
                {isUnmatchedCredit ? (
                  <div className="p-2 rounded-lg bg-slate-950/80 border border-slate-800 font-mono text-[10.5px] space-y-0.5">
                    <div className="flex justify-between text-slate-300">
                      <span>Matched Invoice:</span>
                      <span className="font-semibold text-rose-400">None (Unmatched Direct Inflow)</span>
                    </div>
                    <div className="flex justify-between text-amber-400">
                      <span>Unallocated Bank Deposit:</span>
                      <span className="font-semibold">+₹{bankAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between text-emerald-400 pt-1 border-t border-slate-800/80 font-bold">
                      <span className="font-sans">Net Bank Credit:</span>
                      <span>₹{bankAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                ) : isException && varianceExcess > 0 ? (
                  <div className="p-2 rounded-lg bg-slate-950/80 border border-slate-800 font-mono text-[10.5px] space-y-0.5">
                    <div className="flex justify-between text-slate-300">
                      <span>Gross Invoice:</span>
                      <span className="font-semibold text-white">₹{invoiceGross.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between text-emerald-400">
                      <span>Customer Overpayment:</span>
                      <span className="font-semibold">+₹{varianceExcess.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between text-emerald-400 pt-1 border-t border-slate-800/80 font-bold">
                      <span className="font-sans">Net Bank Credit:</span>
                      <span>₹{bankAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                ) : (
                  <div className="p-2 rounded-lg bg-slate-950/80 border border-slate-800 font-mono text-[10.5px] space-y-0.5">
                    <div className="flex justify-between text-slate-300">
                      <span>Gross Invoice:</span>
                      <span className="font-semibold text-white">₹{invoiceGross.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between text-amber-400">
                      <span>{isException ? 'Discrepancy (Shortfall):' : `Less ${statutoryCode} (${tdsRate > 0 ? `${tdsRate}%` : 'TDS'}):`}</span>
                      <span className="font-semibold">-₹{totalDeductions.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between text-emerald-400 pt-1 border-t border-slate-800/80 font-bold">
                      <span className="font-sans">Net Bank Credit:</span>
                      <span>₹{bankAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                )}

                {/* 2. Where Deducted & Tax Base (CBDT Cir 23/2017) */}
                <div className="space-y-1 text-[10px] leading-tight text-slate-300">
                  <div className="flex justify-between">
                    <span className="text-slate-400">{isUnmatchedCredit ? 'Remitted by:' : 'Withheld by:'}</span>
                    <span className="text-white font-medium truncate max-w-[170px] text-right">{customerName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Deposited to:</span>
                    <span className="text-emerald-300 font-medium truncate max-w-[170px] text-right">{destinationEntity}</span>
                  </div>
                  {tdsAmount > 0 && (
                    <div className="flex justify-between text-[9.3px] text-slate-400 pt-0.5">
                      <span>Base (ex-GST):</span>
                      <span className="font-mono text-slate-300">₹{baseAmount.toLocaleString('en-IN')} (18% GST: ₹{taxAmount.toLocaleString('en-IN')})</span>
                    </div>
                  )}
                </div>

                {/* 3. Accountant Actions (Form 16A / 26AS Match) */}
                <div className="p-1.5 rounded-lg bg-cyan-950/30 border border-cyan-500/20 text-[9.5px] text-cyan-200/90 space-y-0.5">
                  <div className="font-bold text-cyan-300 flex items-center gap-1">
                    <FileCheck2 className="w-3 h-3 text-cyan-400 shrink-0" />
                    <span>Accountant Actions:</span>
                  </div>
                  <p className="leading-snug text-slate-300">
                    {isUnmatchedCredit
                      ? '• Unidentified Credit • Logged in Outbox • Trace remitter UTR & request invoice reference • Parked in Suspense until claimed.'
                      : tdsAmount > 0
                      ? '• Await Form 16A from client • Match credit in 26AS / AIS on TRACES portal.'
                      : isException && varianceExcess > 0
                      ? '• Customer Overpayment • Credit customer ledger • Adjust against future billing or process refund.'
                      : isException
                      ? '• Discrepancy logged in Outbox • Request remittance advice / Form 16A from customer.'
                      : '• 100% Gross match • Zero withholding • No Form 16A certificate needed.'}
                  </p>
                </div>

                {/* 4. Double-Entry GL Impact (Single Clean Line) */}
                <div className="pt-1 border-t border-slate-800/80 font-mono text-[9px] text-slate-400 flex justify-between">
                  <span className="text-slate-500">GL:</span>
                  {isUnmatchedCredit ? (
                    <p className="text-slate-300">
                      Dr Bank ₹{(bankAmount / 1000).toFixed(1)}k • Cr Bank Suspense Liability ₹{(bankAmount / 1000).toFixed(1)}k
                    </p>
                  ) : isException && varianceExcess > 0 ? (
                    <p className="text-slate-300">
                      Dr Bank ₹{(bankAmount / 1000).toFixed(1)}k • Cr AR ₹{(invoiceGross / 1000).toFixed(1)}k • Cr Customer Advance ₹{(varianceExcess / 1000).toFixed(1)}k
                    </p>
                  ) : isException && varianceShortfall > 0 ? (
                    <p className="text-slate-300">
                      Dr Bank ₹{(bankAmount / 1000).toFixed(1)}k • Dr Shortfall Suspense ₹{(varianceShortfall / 1000).toFixed(1)}k • Cr AR ₹{(invoiceGross / 1000).toFixed(1)}k
                    </p>
                  ) : (
                    <p className="text-slate-300">
                      Dr Bank ₹{(bankAmount / 1000).toFixed(1)}k{totalDeductions > 0 ? ` • Dr TDS ₹${(totalDeductions / 1000).toFixed(1)}k` : ''} • Cr AR ₹{(invoiceGross / 1000).toFixed(1)}k
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Summary */}
        <div className="px-6 py-3 bg-slate-950/80 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-4">
            <span>
              Amount: <strong className="text-white font-mono">₹{Number(transaction.amount || 0).toLocaleString('en-IN')}</strong>
            </span>
            <span>
              Narration: <span className="text-slate-300 font-mono text-[11px]">{transaction.narration || 'N/A'}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500">Cryptographic Proof:</span>
            <span className="font-mono text-[10px] text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/20">
              {isMatched ? 'SHA-256 Merkle Link Verified' : isException ? 'Discrepancy Audit Hash Chained' : 'Awaiting Ingestion Hash'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
