import { useState, useEffect, useCallback, useRef } from 'react';

export function useReconStream() {
  const [isConnected, setIsConnected] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [stats, setStats] = useState({
    totalTransactions: 0,
    matchedCount: 0,
    exceptionCount: 0,
    unprocessedCount: 0,
    matchRatePercent: 0,
    totalInflow: 0,
    pendingInflow: 0,
    tierDistribution: { tier1: 0, tier2: 0, tier3: 0, manual: 0 },
    latencyMetrics: { p50Ms: 0, p95Ms: 0, p99Ms: 0 },
    costEconomics: { naiveCostUsd: 0, hybridCostUsd: 0, savingsPercent: 100 },
  });
  const [batchProgress, setBatchProgress] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const eventSourceRef = useRef(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/reconciliation/stats');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (e) {
      console.warn('Failed to fetch stats:', e);
    }
  }, []);

  const fetchFeed = useCallback(async () => {
    try {
      const res = await fetch('/api/reconciliation/feed?limit=100');
      if (res.ok) {
        const data = await res.json();
        setTransactions(data);
      }
    } catch (e) {
      console.warn('Failed to fetch feed:', e);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    fetchFeed();

    // Connect to SSE stream
    const eventSource = new EventSource('/api/reconciliation/stream');
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsConnected(true);
    };

    eventSource.onerror = () => {
      setIsConnected(false);
    };

    eventSource.addEventListener('ready', () => {
      setIsConnected(true);
    });

    eventSource.addEventListener('batch:start', (e) => {
      setIsProcessing(true);
      const data = JSON.parse(e.data);
      setBatchProgress({
        batchId: data.batchId,
        total: data.totalCount,
        processed: 0,
        percentage: 0,
      });
    });

    eventSource.addEventListener('batch:progress', (e) => {
      const data = JSON.parse(e.data);
      setBatchProgress({
        batchId: data.batchId,
        total: data.totalCount,
        processed: data.processedCount,
        percentage: data.percentage,
        tierCounts: data.tierCounts,
      });
    });

    eventSource.addEventListener('batch:completed', () => {
      setIsProcessing(false);
      setBatchProgress(null);
      fetchStats();
      fetchFeed();
    });

    eventSource.addEventListener('txn:reconciled', (e) => {
      const data = JSON.parse(e.data);
      setTransactions((prev) => {
        const idx = prev.findIndex((t) => t.bankTxnId === data.bankTxnId);
        const updatedItem = {
          bankTxnId: data.bankTxnId,
          amount: data.amount,
          narration: data.narration || '',
          reconciliationStatus: 'MATCHED',
          matchedTier: data.matchedTier,
          confidenceScore: data.confidence || 1.0,
          deductionsApplied: data.deductions,
          reconciledInvoiceId: {
            invoiceNumber: data.invoiceNumber,
            customerName: data.customerName,
            totalAmount: data.circuitBreaker?.invoiceGross,
          },
          executionMetrics: {
            totalDurationMs: data.durationMs,
          },
          dagNodes: data.dagNodes,
          circuitBreaker: data.circuitBreaker,
          createdAt: new Date().toISOString(),
        };

        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], ...updatedItem };
          return next;
        }
        return [updatedItem, ...prev];
      });
      fetchStats();
    });

    eventSource.addEventListener('txn:exception', (e) => {
      const data = JSON.parse(e.data);
      setTransactions((prev) => {
        const idx = prev.findIndex((t) => t.bankTxnId === data.bankTxnId);
        const updatedItem = {
          bankTxnId: data.bankTxnId,
          amount: data.amount,
          narration: data.narration,
          reconciliationStatus: 'EXCEPTION',
          matchedTier: null,
          confidenceScore: data.confidence || 0.3,
          discrepancyDetails: data.discrepancy,
          whatsappDraft: data.whatsappDraft,
          emailDraft: data.emailDraft,
          reconciledInvoiceId: data.candidateInvoiceNumber ? {
            invoiceNumber: data.candidateInvoiceNumber,
            customerName: data.customerName,
          } : null,
          executionMetrics: {
            totalDurationMs: data.durationMs,
          },
          dagNodes: data.dagNodes,
          circuitBreaker: data.circuitBreaker,
          createdAt: new Date().toISOString(),
        };

        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], ...updatedItem };
          return next;
        }
        return [updatedItem, ...prev];
      });
      fetchStats();
    });

    eventSource.addEventListener('dashboard:reset', () => {
      setTransactions([]);
      fetchStats();
    });

    return () => {
      eventSource.close();
    };
  }, [fetchStats, fetchFeed]);

  const triggerBatch = async (batchPayload) => {
    setIsProcessing(true);
    try {
      const res = await fetch('/api/reconciliation/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: batchPayload }),
      });
      return await res.json();
    } catch (e) {
      setIsProcessing(false);
      throw e;
    }
  };

  const resetDashboard = async () => {
    await fetch('/api/reconciliation/reset', { method: 'POST' });
    setTransactions([]);
    fetchStats();
  };

  return {
    isConnected,
    transactions,
    stats,
    batchProgress,
    isProcessing,
    triggerBatch,
    resetDashboard,
    refreshData: () => {
      fetchStats();
      fetchFeed();
    },
  };
}
