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
import SAMPLE_BATCH_50 from './sample-batch-50.json';


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
  const [minConfidence, setMinConfidence] = useState(0.5);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [selectedTxnForDAG, setSelectedTxnForDAG] = useState(null);
  const [selectedTxnForOutbox, setSelectedTxnForOutbox] = useState(null);
  const [isRulesModalOpen, setIsRulesModalOpen] = useState(false);
  const [isAISettingsOpen, setIsAISettingsOpen] = useState(false);

  // 0ms In-Memory Instant Filter Pipeline
  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      // 1. Confidence threshold
      const conf = t.confidenceScore !== undefined ? t.confidenceScore : 1.0;
      if (conf < minConfidence) return false;

      // 2. Status filter
      if (statusFilter === 'MATCHED' && t.reconciliationStatus !== 'MATCHED') return false;
      if (statusFilter === 'EXCEPTION' && t.reconciliationStatus !== 'EXCEPTION') return false;
      if (statusFilter === 'TIER_1' && t.matchedTier !== 'TIER_1') return false;
      if (statusFilter === 'TIER_2' && t.matchedTier !== 'TIER_2') return false;
      if (statusFilter === 'TIER_3' && t.matchedTier !== 'TIER_3') return false;

      // 3. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const narration = (t.narration || '').toLowerCase();
        const utr = (t.utrNumber || '').toLowerCase();
        const txnId = (t.bankTxnId || '').toLowerCase();
        const invNum = (t.reconciledInvoiceId?.invoiceNumber || '').toLowerCase();
        const vendor = (t.reconciledInvoiceId?.customerName || '').toLowerCase();

        return (
          narration.includes(q) ||
          utr.includes(q) ||
          txnId.includes(q) ||
          invNum.includes(q) ||
          vendor.includes(q)
        );
      }

      return true;
    });
  }, [transactions, minConfidence, statusFilter, searchQuery]);

  const handleRun50Batch = async () => {
    try {
      await triggerBatch(SAMPLE_BATCH_50);
    } catch (e) {
      alert(`Batch error: ${e.message}`);
    }
  };

  const handleSimulateLiveStream = async () => {
    // Stream transactions one by one with small intervals
    for (const txn of SAMPLE_BATCH_50.slice(0, 15)) {
      try {
        await fetch('/api/reconciliation/process-single', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(txn),
        });
        await new Promise((r) => setTimeout(r, 400));
      } catch (e) {
        console.warn('Stream step error:', e);
      }
    }
  };

  return (
    <div className="min-h-screen bg-razor-dark flex flex-col">
      {/* Header */}
      <Header
        isConnected={isConnected}
        isProcessing={isProcessing}
        onTriggerBatch={handleRun50Batch}
        onSimulateLive={handleSimulateLiveStream}
        onOpenRules={() => setIsRulesModalOpen(true)}
        onOpenAISettings={() => setIsAISettingsOpen(true)}
        onReset={resetDashboard}
      />

      {/* Main Dashboard Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
        {/* KPI Metrics Banner */}
        <MetricsOverview stats={stats} batchProgress={batchProgress} />

        {/* Tier Distribution Visualizer */}
        <TierDistributionChart stats={stats} />

        {/* 0ms In-Memory Risk Slider & Filters */}
        <RiskSlider
          minConfidence={minConfidence}
          onConfidenceChange={setMinConfidence}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          filteredCount={filteredTransactions.length}
          totalCount={transactions.length}
        />

        {/* High-Performance 60fps Virtualized Feed */}
        <VirtualizedFeed
          transactions={filteredTransactions}
          onSelectTxn={setSelectedTxnForDAG}
          onOpenOutbox={setSelectedTxnForOutbox}
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
    </div>
  );
}
