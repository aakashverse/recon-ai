import React, { useState, useMemo } from 'react';
import { useReconStream } from './hooks/useReconStream.js';
import { Header } from './components/Header.jsx';
import { MetricsOverview } from './components/MetricsOverview.jsx';
import { TierDistributionChart } from './components/TierDistributionChart.jsx';
import { RiskSlider } from './components/RiskSlider.jsx';
import { VirtualizedFeed } from './components/VirtualizedFeed.jsx';
import { StateMachineDAG } from './components/StateMachineDAG.jsx';
import { AgenticOutboxModal } from './components/AgenticOutboxModal.jsx';
import { RulesManagerModal } from './components/RulesManagerModal.jsx';
import { AISettingsModal } from './components/AISettingsModal.jsx';
import { DataImporterModal } from './components/DataImporterModal.jsx';
import { FinanceControllerModal } from './components/FinanceControllerModal.jsx';
import { GeneralLedgerModal } from './components/GeneralLedgerModal.jsx';
import SAMPLE_BATCH_50 from './data/sample-batch-50.json';


export default function App() {
  const {
    isConnected,
    transactions,
    stats,
    batchProgress,
    isProcessing,
    triggerBatch,
    resetDashboard,
    refreshData,
  } = useReconStream();

  // Local React State for 0ms In-Memory Filtering
  const [minConfidence, setMinConfidence] = useState(0);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [selectedTxnForDAG, setSelectedTxnForDAG] = useState(null);
  const [selectedTxnForOutbox, setSelectedTxnForOutbox] = useState(null);
  const [isRulesModalOpen, setIsRulesModalOpen] = useState(false);
  const [isAISettingsOpen, setIsAISettingsOpen] = useState(false);
  const [isImporterOpen, setIsImporterOpen] = useState(false);
  const [isControllerOpen, setIsControllerOpen] = useState(false);
  const [isLedgerOpen, setIsLedgerOpen] = useState(false);

  // Real-time tab counts computation across lifecycle buckets
  const counts = useMemo(() => {
    let all = 0;
    let matched = 0;
    let proposed = 0;
    let tier3 = 0;
    let exception = 0;

    for (const t of transactions) {
      all++;
      const isM = t.reconciliationStatus === 'MATCHED' || t.reconciliationStatus === 'OVERRIDDEN';
      const isP = t.reconciliationStatus === 'PROPOSED' || t.matchedTier === 'PROPOSED';
      const isE =
        t.reconciliationStatus === 'EXCEPTION' ||
        t.reconciliationStatus === 'DISCREPANCY' ||
        t.matchedTier === 'OUTBOX_EXCEPTION' ||
        Boolean(t.discrepancyDetails && !isM && !isP);

      if (isM) matched++;
      if (isP) proposed++;
      if (isM && t.matchedTier === 'TIER_3') tier3++;
      if (isE) exception++;
    }

    return { all, matched, proposed, tier3, exception };
  }, [transactions]);

  // 0ms In-Memory Instant Filter Pipeline
  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      const isMatched = t.reconciliationStatus === 'MATCHED' || t.reconciliationStatus === 'OVERRIDDEN';
      const isProposed = t.reconciliationStatus === 'PROPOSED' || t.matchedTier === 'PROPOSED';
      const isException =
        t.reconciliationStatus === 'EXCEPTION' ||
        t.reconciliationStatus === 'DISCREPANCY' ||
        t.matchedTier === 'OUTBOX_EXCEPTION' ||
        Boolean(t.discrepancyDetails && !isMatched && !isProposed);

      // 1. Status & Tier filter
      if (statusFilter === 'MATCHED' && !isMatched) return false;
      if (statusFilter === 'PROPOSED' && !isProposed) return false;
      if (statusFilter === 'EXCEPTION' && !isException) return false;
      if (statusFilter === 'TIER_1' && (t.matchedTier !== 'TIER_1' || !isMatched)) return false;
      if (statusFilter === 'TIER_2' && (t.matchedTier !== 'TIER_2' || !isMatched)) return false;
      if (statusFilter === 'TIER_3' && (t.matchedTier !== 'TIER_3' || !isMatched)) return false;

      // 2. Confidence threshold
      // When explicitly filtering for EXCEPTION, preserve discrepancies so they're never hidden
      if (minConfidence > 0 && statusFilter !== 'EXCEPTION') {
        const conf = t.confidenceScore !== undefined && t.confidenceScore !== null
          ? Number(t.confidenceScore)
          : (isMatched ? 1.0 : (isProposed ? 0.85 : 0.2));
        if (conf < minConfidence) return false;
      }

      // 3. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const narration = (t.narration || '').toLowerCase();
        const utr = (t.utrNumber || '').toLowerCase();
        const txnId = (t.bankTxnId || '').toLowerCase();
        const invNum = (
          typeof t.reconciledInvoiceId === 'object' && t.reconciledInvoiceId !== null
            ? t.reconciledInvoiceId.invoiceNumber || ''
            : t.invoiceNumber || ''
        ).toLowerCase();
        const vendor = (
          typeof t.reconciledInvoiceId === 'object' && t.reconciledInvoiceId !== null
            ? t.reconciledInvoiceId.customerName || ''
            : t.customerName || ''
        ).toLowerCase();
        const splitInvs = (t.splitInvoices || []).map((s) => s.invoiceNumber || '').join(' ').toLowerCase();
        const discReason = (t.discrepancyDetails?.reason || '').toLowerCase();
        const amtStr = t.amount !== undefined && t.amount !== null ? String(t.amount) : '';
        const tier = (t.matchedTier || '').toLowerCase();
        const status = (t.reconciliationStatus || '').toLowerCase();

        return (
          narration.includes(q) ||
          utr.includes(q) ||
          txnId.includes(q) ||
          invNum.includes(q) ||
          vendor.includes(q) ||
          splitInvs.includes(q) ||
          discReason.includes(q) ||
          amtStr.includes(q) ||
          tier.includes(q) ||
          status.includes(q)
        );
      }

      return true;
    });
  }, [transactions, minConfidence, statusFilter, searchQuery]);

  const handleRun50Batch = async () => {
    if (!transactions.length) {
      setIsImporterOpen(true);
      return;
    }
    try {
      await triggerBatch(transactions);
    } catch (e) {
      alert(`Batch error: ${e.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-razor-dark flex flex-col">
      {/* Header */}
      <Header
        isConnected={isConnected}
        isProcessing={isProcessing}
        totalTransactionsCount={transactions.length}
        onTriggerBatch={handleRun50Batch}
        onOpenLedger={() => setIsLedgerOpen(true)}
        onOpenRules={() => setIsRulesModalOpen(true)}
        onOpenAISettings={() => setIsAISettingsOpen(true)}
        onOpenImporter={() => setIsImporterOpen(true)}
        onOpenController={() => setIsControllerOpen(true)}
        onReset={resetDashboard}
      />

      {/* Main Dashboard Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
        {/* KPI Metrics Banner */}
        <MetricsOverview stats={stats} batchProgress={batchProgress} />

        {/* Tier Distribution Visualizer */}
        <TierDistributionChart
          stats={stats}
          statusFilter={statusFilter}
          onSelectStatus={setStatusFilter}
        />

        {/* 0ms In-Memory Instant Risk Slider & Filter Controls */}
        <RiskSlider
          minConfidence={minConfidence}
          onConfidenceChange={setMinConfidence}
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          filteredCount={filteredTransactions.length}
          totalCount={transactions.length}
          counts={counts}
        />

        {/* High-Performance 60fps Virtualized Feed */}
        <VirtualizedFeed
          transactions={filteredTransactions}
          onSelectTxn={setSelectedTxnForDAG}
          onOpenOutbox={setSelectedTxnForOutbox}
          onOpenImporter={() => setIsImporterOpen(true)}
        />
      </main>

      {/* Modals */}
      {selectedTxnForDAG && (
        <StateMachineDAG
          transaction={selectedTxnForDAG}
          onClose={() => setSelectedTxnForDAG(null)}
        />
      )}

      {selectedTxnForOutbox && (
        <AgenticOutboxModal
          transaction={selectedTxnForOutbox}
          onClose={() => setSelectedTxnForOutbox(null)}
          onResolved={() => {
            refreshData();
          }}
        />
      )}

      {isRulesModalOpen && (
        <RulesManagerModal onClose={() => setIsRulesModalOpen(false)} />
      )}

      {isAISettingsOpen && (
        <AISettingsModal onClose={() => setIsAISettingsOpen(false)} />
      )}

      {isImporterOpen && (
        <DataImporterModal
          onClose={() => setIsImporterOpen(false)}
          onFeedImported={() => refreshData()}
        />
      )}

      {isControllerOpen && (
        <FinanceControllerModal
          isOpen={isControllerOpen}
          onClose={() => setIsControllerOpen(false)}
        />
      )}

      {isLedgerOpen && (
        <GeneralLedgerModal
          isOpen={isLedgerOpen}
          onClose={() => setIsLedgerOpen(false)}
        />
      )}
    </div>
  );
}
