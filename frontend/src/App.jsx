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
  const [isImporterOpen, setIsImporterOpen] = useState(false);
  const [isControllerOpen, setIsControllerOpen] = useState(false);
  const [isLedgerOpen, setIsLedgerOpen] = useState(false);

  // 0ms In-Memory Instant Filter Pipeline
  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      // 1. Confidence threshold
      const conf = t.confidenceScore !== undefined ? t.confidenceScore : 1.0;
      if (conf < minConfidence) return false;

      // 2. Status & Tier filter
      if (statusFilter === 'MATCHED' && t.reconciliationStatus !== 'MATCHED') return false;
      if (statusFilter === 'EXCEPTION' && t.reconciliationStatus !== 'EXCEPTION') return false;
      if (statusFilter === 'TIER_1' && (t.matchedTier !== 'TIER_1' || t.reconciliationStatus !== 'MATCHED')) return false;
      if (statusFilter === 'TIER_2' && (t.matchedTier !== 'TIER_2' || t.reconciliationStatus !== 'MATCHED')) return false;
      if (statusFilter === 'TIER_3' && (t.matchedTier !== 'TIER_3' || t.reconciliationStatus !== 'MATCHED')) return false;
      if (statusFilter === 'TIER_4' && (t.matchedTier !== 'TIER_4' || t.reconciliationStatus !== 'MATCHED')) return false;

      // 3. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const narration = (t.narration || '').toLowerCase();
        const utr = (t.utrNumber || '').toLowerCase();
        const txnId = (t.bankTxnId || '').toLowerCase();
        const invNum = (t.reconciledInvoiceId?.invoiceNumber || '').toLowerCase();
        const vendor = (t.reconciledInvoiceId?.customerName || '').toLowerCase();
        const splitInvs = (t.splitInvoices || []).map((s) => s.invoiceNumber || '').join(' ').toLowerCase();

        return (
          narration.includes(q) ||
          utr.includes(q) ||
          txnId.includes(q) ||
          invNum.includes(q) ||
          vendor.includes(q) ||
          splitInvs.includes(q)
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
        <TierDistributionChart stats={stats} />

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
