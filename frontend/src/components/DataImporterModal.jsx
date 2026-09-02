import React, { useState } from 'react';
import {
  X,
  UploadCloud,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  AlertCircle,
  FileText,
  Play,
  Layers,
  Sparkles,
  Bot,
} from 'lucide-react';
import SAMPLE_BATCH_50 from '../data/sample-batch-50.json';
import SAMPLE_BENCHMARK_20 from '../data/sample-benchmark-20.json';

export function DataImporterModal({ onClose, onFeedImported, onInvoicesImported }) {
  const [activeTab, setActiveTab] = useState('BANK_FEED'); // 'BANK_FEED' | 'INVOICES'
  const [csvContent, setCsvContent] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAIStructuring, setIsAIStructuring] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const sampleBankCSV = `Date,Narration,Credit,UTR
2026-08-23,NEFT-RELIANCE-RETAIL-INV-2024-8001-LESS-2PCT-TDS,98000,AXISN88990011
2026-08-23,RTGS-TATA-DIGITAL-INV-2024-8002-PROF-FEE-194J,225000,HDFCN99002233
2026-08-23,IMPS/SWIGGY/INV-2024-8003/SETTLEMENT,74250,ICICIN11223344`;

  const sampleInvoiceCSV = `Invoice Number,Customer Name,Total Amount,Base Amount,Tax Amount,TDS Section,TDS Rate
INV-2024-8001,Reliance Retail Ltd,100000,84745.76,15254.24,194C,2
INV-2024-8002,Tata Digital Services,250000,211864.41,38135.59,194J,10
INV-2024-8003,Swiggy Bundl Technologies,75000,63559.32,11440.68,194C,1`;

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isPdfOrImage =
      file.type.includes('pdf') ||
      file.type.includes('image') ||
      /\.(pdf|png|jpe?g)$/i.test(file.name);

    if (isPdfOrImage) {
      setIsAIStructuring(true);
      setFeedback({ type: 'info', message: `Analyzing ${file.name} with Gemini 1.5 Flash Vision OCR...` });
      try {
        const formData = new FormData();
        formData.append('statementFile', file);
        formData.append('targetType', activeTab);

        const res = await fetch('/api/reconciliation/upload-multimodal-statement', {
          method: 'POST',
          body: formData,
        });

        const data = await res.json();
        if (res.ok && data.records?.length) {
          setCsvContent(JSON.stringify(data.records, null, 2));
          setFeedback({
            type: 'success',
            message: `✨ ${data.message || `Extracted ${data.records.length} records via Gemini Vision.`}`,
          });
        } else {
          setFeedback({
            type: 'error',
            message: data.error || 'Failed to extract records from document.',
          });
        }
      } catch (err) {
        setFeedback({ type: 'error', message: `Vision Ingestion Error: ${err.message}` });
      } finally {
        setIsAIStructuring(false);
      }
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      setCsvContent(event.target?.result || '');
      setFeedback({ type: 'info', message: `Loaded file: ${file.name} (${file.size} bytes)` });
    };
    reader.readAsText(file);
  };

  const handleLoadDemoDataset = () => {
    if (activeTab === 'BANK_FEED') {
      const csv =
        'Date,Narration,Credit,UTR\n' +
        SAMPLE_BATCH_50.map((t) => `${t.txnDate},"${t.narration}",${t.amount},${t.utrNumber}`).join('\n');
      setCsvContent(csv);
      setFeedback({
        type: 'info',
        message: `Loaded ${SAMPLE_BATCH_50.length} real-world stress test bank transactions into workspace.`,
      });
    } else {
      setCsvContent(sampleInvoiceCSV);
      setFeedback({ type: 'info', message: 'Loaded enterprise sample invoices into workspace.' });
    }
  };

  const handleLoadBenchmark20 = () => {
    if (activeTab === 'BANK_FEED') {
      const csv =
        'Date,Narration,Credit,UTR\n' +
        SAMPLE_BENCHMARK_20.map((t) => `${t.txnDate},"${t.narration}",${t.amount},${t.utrNumber}`).join('\n');
      setCsvContent(csv);
      setFeedback({
        type: 'info',
        message: `Loaded 20 real-world B2B benchmark bank transactions (TDS, GST, wire fees, split match & exceptions).`,
      });
    } else {
      setCsvContent(sampleInvoiceCSV);
      setFeedback({ type: 'info', message: 'Loaded enterprise sample invoices into workspace.' });
    }
  };

  const handleAIStructure = async () => {
    if (!csvContent.trim()) {
      setFeedback({
        type: 'error',
        message: 'Please paste raw text or upload a document first before AI Structuring.',
      });
      return;
    }

    setIsAIStructuring(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/reconciliation/ai-parse-and-structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText: csvContent,
          targetType: activeTab,
        }),
      });

      const text = await res.text();
      const data = text ? JSON.parse(text) : {};

      if (res.ok && data.records?.length) {
        setCsvContent(JSON.stringify(data.records, null, 2));
        setFeedback({
          type: 'success',
          message: `✨ ${data.message} Formatted into canonical schema.`,
        });
      } else {
        setFeedback({
          type: 'error',
          message: data.error || 'Could not structure raw text. Please check format.',
        });
      }
    } catch (err) {
      setFeedback({ type: 'error', message: `AI Structuring Error: ${err.message}` });
    } finally {
      setIsAIStructuring(false);
    }
  };

  const handleImport = async () => {
    if (!csvContent.trim()) {
      setFeedback({ type: 'error', message: 'Please paste CSV content or upload a file first.' });
      return;
    }

    setIsProcessing(true);
    setFeedback(null);

    const endpoint =
      activeTab === 'BANK_FEED'
        ? '/api/reconciliation/import-bank-feed'
        : '/api/reconciliation/import-invoices';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText: csvContent }),
      });

      const text = await res.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { error: 'Server returned non-JSON response. Please verify backend is active.' };
      }

      if (res.ok) {
        setFeedback({
          type: 'success',
          message: data.message || `Successfully processed ${data.count || 'batch'} records!`,
        });

        if (activeTab === 'BANK_FEED') {
          onFeedImported?.();
        } else {
          onInvoicesImported?.();
        }

        setTimeout(() => {
          onClose();
        }, 1200);
      } else {
        setFeedback({ type: 'error', message: data.error || 'Failed to import data.' });
      }
    } catch (err) {
      setFeedback({ type: 'error', message: `Import Error: ${err.message}` });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-razor-card border border-razor-border rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden animate-fade-in flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-razor-border bg-slate-900/90 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-razor-blue/20 border border-razor-blue/40 flex items-center justify-center">
              <UploadCloud className="w-5 h-5 text-razor-blue" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Real Data Ingestion Hub
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-mono">
                  Live Production Ingest
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Upload real bank statement feeds or ERP invoices (CSV / JSON / Unstructured Text)
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

        {/* Modal Tabs */}
        <div className="px-6 pt-4 border-b border-slate-800 bg-slate-900/50 flex items-center gap-2">
          <button
            onClick={() => {
              setActiveTab('BANK_FEED');
              setCsvContent('');
              setFeedback(null);
            }}
            className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition-all flex items-center gap-2 border-b-2 ${
              activeTab === 'BANK_FEED'
                ? 'border-razor-blue text-white bg-slate-800/80'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span>1. Real Bank Statement Feed</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('INVOICES');
              setCsvContent('');
              setFeedback(null);
            }}
            className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition-all flex items-center gap-2 border-b-2 ${
              activeTab === 'INVOICES'
                ? 'border-razor-purple text-white bg-slate-800/80'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-4 h-4 text-purple-400" />
            <span>2. Real ERP Invoices Master</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1 text-xs">
          {/* Action Helper Banner */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900 border border-slate-800">
            <div className="text-slate-300">
              {activeTab === 'BANK_FEED' ? (
                <span>
                  Upload bank statement rows (from <strong>HDFC, ICICI, SBI, Axis</strong>) or drop a file.
                </span>
              ) : (
                <span>
                  Upload billed enterprise invoices (from <strong>Tally, Zoho Books, SAP, QuickBooks</strong>).
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-2 flex-wrap">
              {/* <button
                type="button"
                onClick={handleLoadBenchmark20}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/40 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                title="Load 20 Real-World Benchmark Cases (Statutory TDS, Wire Fees, Split & Outbox)"
              >
                <Sparkles className="w-3 h-3 text-amber-400" />
                <span>20-Txn Benchmark</span>
              </button> */}
              {/* <button
                type="button"
                onClick={handleLoadDemoDataset}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-purple-300 border border-purple-500/30 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                title="Load 50 enterprise stress test batch"
              >
                <Layers className="w-3 h-3" />
                <span>50-Txn Batch</span>
              </button> */}
              <a
                href={activeTab === 'BANK_FEED' ? '/api/reconciliation/template-bank-feed' : '/api/reconciliation/template-invoices'}
                download
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-razor-blue text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Download className="w-3 h-3" />
                <span>Template CSV</span>
              </a>
            </div>
          </div>

          {/* File Upload Drag & Drop Area */}
          <label className="border-2 border-dashed border-slate-700 hover:border-razor-blue rounded-xl p-4 flex flex-col items-center justify-center gap-2 cursor-pointer bg-slate-950/40 hover:bg-slate-950/80 transition-all">
            <UploadCloud className="w-6 h-6 text-slate-400" />
            <div className="text-center">
              <span className="text-razor-blue font-semibold">Click to browse file</span> or drag & drop CSV / JSON / PDF / Image here
            </div>
            <span className="text-[10px] text-slate-400 font-mono">Supported: .csv, .json, .txt, .pdf (Scanned statements), .png, .jpg</span>
            <input type="file" accept=".csv,.txt,.json,.pdf,.png,.jpg,.jpeg" onChange={handleFileUpload} className="hidden" />
          </label>

          {/* CSV Text Area Editor */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-slate-400 font-medium">
              <span>Data Preview / Direct Paste:</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAIStructure}
                  disabled={isAIStructuring || !csvContent.trim()}
                  className="px-2.5 py-0.5 rounded bg-purple-950/60 hover:bg-purple-900 border border-purple-500/40 text-purple-300 text-[11px] font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50 transition-colors"
                  title="Use Gemini AI to parse and convert unstructured text into canonical schema"
                >
                  <Sparkles className={`w-3 h-3 text-purple-400 ${isAIStructuring ? 'animate-spin' : ''}`} />
                  <span>{isAIStructuring ? 'AI Structuring...' : 'AI Structurer (Gemini)'}</span>
                </button>
                {/* <button
                  type="button"
                  onClick={() => setCsvContent(activeTab === 'BANK_FEED' ? sampleBankCSV : sampleInvoiceCSV)}
                  className="text-[11px] text-razor-blue hover:underline cursor-pointer"
                >
                  Quick Insert
                </button> */}
              </div>
            </div>
            <textarea
              value={csvContent}
              onChange={(e) => setCsvContent(e.target.value)}
              rows={7}
              placeholder="Paste raw CSV lines, JSON array, or messy financial notes here..."
              className="w-full p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 focus:outline-none focus:border-razor-blue transition-colors"
            />
          </div>

          {/* Feedback Status Alert */}
          {feedback && (
            <div
              className={`p-3 rounded-xl text-xs flex items-center gap-2 animate-fade-in ${
                feedback.type === 'success'
                  ? 'bg-emerald-950/40 border border-emerald-500/40 text-emerald-300'
                  : feedback.type === 'error'
                  ? 'bg-rose-950/40 border border-rose-500/40 text-rose-300'
                  : 'bg-slate-800 border border-slate-700 text-slate-300'
              }`}
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span>{feedback.message}</span>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-razor-border bg-slate-900/90 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
          >
            Cancel
          </button>

          <button
            onClick={handleImport}
            disabled={isProcessing || !csvContent.trim()}
            className="px-5 py-2 rounded-lg bg-gradient-to-r from-razor-blue to-blue-600 hover:from-blue-600 hover:to-blue-500 text-white text-xs font-bold shadow-md shadow-blue-500/20 transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            <Play className={`w-3.5 h-3.5 ${isProcessing ? 'animate-spin' : 'fill-current'}`} />
            <span>
              {isProcessing
                ? 'Processing...'
                : activeTab === 'BANK_FEED'
                ? 'Run Live Reconciliation'
                : 'Import Invoices to DB'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
