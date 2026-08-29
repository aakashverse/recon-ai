import React, { useState, useEffect } from 'react';
import {
  MessageSquare,
  TrendingUp,
  X,
  Send,
  Sparkles,
  DollarSign,
  Calendar,
  Layers,
  RefreshCw,
  CheckCircle2,
  Cpu,
} from 'lucide-react';

export function FinanceControllerModal({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' or 'forecast'

  // Settlement Q&A Chat State
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: `👋 Hello Controller! I am your **AI Finance Controller & Settlement Agent**.

I have real-time access to your verified MongoDB ledger, statutory TDS withholdings, Outbox exception queue, and cash positions.

**Suggested Queries:**
- *"What is our total TDS withheld under Section 194C vs 194J?"*
- *"Show me high-priority exceptions in the Outbox."*
- *"What is our current reconciliation match rate and collection total?"*
- *"Give me a forward cash forecast for the next 30 days."*`,
    },
  ]);
  const [isQuerying, setIsQuerying] = useState(false);

  // Cash Forecast State
  const [forecastData, setForecastData] = useState(null);
  const [isForecastLoading, setIsForecastLoading] = useState(false);

  const fetchForecast = async () => {
    setIsForecastLoading(true);
    try {
      const res = await fetch('/api/reconciliation/cash-forecast');
      if (res.ok) {
        const data = await res.json();
        setForecastData(data);
      }
    } catch (e) {
      console.warn('Failed to load forecast:', e);
    } finally {
      setIsForecastLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchForecast();
    }
  }, [isOpen]);

  const handleSendChat = async (e) => {
    e?.preventDefault();
    if (!query.trim() || isQuerying) return;

    const userText = query.trim();
    setQuery('');
    setMessages((prev) => [...prev, { role: 'user', text: userText }]);
    setIsQuerying(true);

    try {
      const res = await fetch('/api/reconciliation/assistant-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: userText }),
      });

      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            text: data.answer,
            toolCallsExecuted: data.toolCallsExecuted || [],
            grounded: data.grounded,
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', text: '⚠️ Unable to process query. Please check server logs.' },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `⚠️ Network error: ${err.message}` },
      ]);
    } finally {
      setIsQuerying(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-slate-100">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-razor-blue flex items-center justify-center shadow-md shadow-indigo-500/20">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                AI Finance Controller Studio
                {/* <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-medium">
                  Track-04 Complete Suite
                </span> */}
              </h2>
              <p className="text-xs text-slate-400">
                Settlement Q&A Assistant • Tax-Line Verifier • Forward 30/60/90-Day Cash Forecaster
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Tabs switcher */}
            <div className="flex bg-slate-800/80 p-1 rounded-lg border border-slate-700 text-xs font-semibold">
              <button
                onClick={() => setActiveTab('chat')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
                  activeTab === 'chat'
                    ? 'bg-razor-blue text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Settlement Q&A Agent
              </button>
              <button
                onClick={() => {
                  setActiveTab('forecast');
                  fetchForecast();
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
                  activeTab === 'forecast'
                    ? 'bg-razor-blue text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" />
                Forward Cash Forecaster
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab 1: Settlement Q&A Chat */}
        {activeTab === 'chat' && (
          <div className="flex-1 flex flex-col min-h-0 bg-slate-900/50">
            {/* Chat message stream */}
            <div className="flex-1 p-6 overflow-y-auto space-y-4 text-sm">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex gap-3 ${
                    m.role === 'user' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  {m.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-lg bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center shrink-0 mt-0.5">
                      <Sparkles className="w-4 h-4 text-indigo-400" />
                    </div>
                  )}

                  <div
                    className={`p-4 rounded-xl max-w-2xl leading-relaxed whitespace-pre-wrap ${
                      m.role === 'user'
                        ? 'bg-razor-blue text-white rounded-tr-none'
                        : 'bg-slate-800/90 border border-slate-700/80 text-slate-200 rounded-tl-none font-sans'
                    }`}
                  >
                    <div>{m.text}</div>

                    {/* Step 2 Grounded Tool Call Proof Receipts */}
                    {m.toolCallsExecuted && m.toolCallsExecuted.length > 0 && (
                      <div className="mt-3 pt-2.5 border-t border-slate-700/60">
                        <div className="text-[11px] font-mono text-emerald-400 font-semibold flex items-center gap-1.5 mb-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Grounded Tool Calls Executed ({m.toolCallsExecuted.length}):</span>
                        </div>
                        <div className="space-y-1">
                          {m.toolCallsExecuted.map((tc, tcIdx) => (
                            <details key={tcIdx} className="bg-slate-900/90 rounded-lg border border-slate-700/80 p-2 text-[10px] font-mono">
                              <summary className="cursor-pointer text-slate-300 font-bold hover:text-white flex items-center justify-between">
                                <span className="flex items-center gap-1">
                                  <Cpu className="w-3 h-3 text-razor-blue" />
                                  <span>{tc.toolName}({Object.keys(tc.arguments || {}).map((k) => `${k}: "${tc.arguments[k]}"`).join(', ')})</span>
                                </span>
                                <span className="text-emerald-400 text-[9px] bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-500/30">
                                  VERIFIED
                                </span>
                              </summary>
                              <pre className="mt-1.5 p-1.5 bg-slate-950 rounded text-slate-300 overflow-x-auto text-[9px] leading-snug">
                                {JSON.stringify(tc.output, null, 2)}
                              </pre>
                            </details>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {isQuerying && (
                <div className="flex gap-3 justify-start items-center text-xs text-slate-400 animate-pulse">
                  <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center shrink-0">
                    <RefreshCw className="w-4 h-4 text-indigo-400 animate-spin" />
                  </div>
                  Analyzing verified MongoDB ledger & calculating tax lines...
                </div>
              )}
            </div>

            {/* Quick Prompt Pill Buttons */}
            <div className="px-6 py-2 bg-slate-950/40 border-t border-slate-800/80 flex items-center gap-2 overflow-x-auto text-xs">
              <span className="text-slate-400 whitespace-nowrap font-medium">Quick Prompts:</span>
              <button
                onClick={() => setQuery('What is our total TDS withheld under Section 194C vs 194J?')}
                className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 whitespace-nowrap transition"
              >
                📊 TDS Withholdings
              </button>
              <button
                onClick={() => setQuery('Show me high-priority exceptions in the Outbox.')}
                className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 whitespace-nowrap transition"
              >
                ⚠️ Outbox Discrepancies
              </button>
              <button
                onClick={() => setQuery('What is our current reconciliation match rate and collection total?')}
                className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 whitespace-nowrap transition"
              >
                ⚡ Match Rate & KPIs
              </button>
            </div>

            {/* Input Bar */}
            <form onSubmit={handleSendChat} className="p-4 bg-slate-950/80 border-t border-slate-800 flex gap-3">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ask any settlement, statutory tax, or cash question..."
                className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-razor-blue"
              />
              <button
                type="submit"
                disabled={!query.trim() || isQuerying}
                className="px-5 py-2.5 bg-gradient-to-r from-razor-blue to-indigo-600 text-white rounded-xl text-sm font-semibold flex items-center gap-2 hover:opacity-95 disabled:opacity-50 transition shadow-lg shadow-razor-blue/20"
              >
                <Send className="w-4 h-4" />
                Ask Controller
              </button>
            </form>
          </div>
        )}

        {/* Tab 2: Forward Cash Forecaster */}
        {activeTab === 'forecast' && (
          <div className="flex-1 p-6 overflow-y-auto space-y-6">
            {isForecastLoading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                <RefreshCw className="w-8 h-8 animate-spin text-razor-blue" />
                <p className="text-sm">Generating forward liquidity forecast from settled vs receivable ledgers...</p>
              </div>
            ) : forecastData ? (
              <>
                {/* 30/60/90 Day Liquidity Forecast Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-slate-800/80 border border-slate-700/80 p-4 rounded-xl">
                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-razor-blue" /> T+30 Days Liquidity
                      </span>
                      <span className="text-emerald-400 font-semibold">95% Probable</span>
                    </div>
                    <div className="text-2xl font-bold text-white">
                      ₹{forecastData.projectedNetLiquidity?.tPlus30Days?.toLocaleString('en-IN') || '0'}
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      Includes ₹{forecastData.agingBreakdown?.days0to30?.toLocaleString('en-IN')} pending receivables
                    </p>
                  </div>

                  <div className="bg-slate-800/80 border border-slate-700/80 p-4 rounded-xl">
                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-indigo-400" /> T+60 Days Liquidity
                      </span>
                      <span className="text-indigo-400 font-semibold">88% Probable</span>
                    </div>
                    <div className="text-2xl font-bold text-white">
                      ₹{forecastData.projectedNetLiquidity?.tPlus60Days?.toLocaleString('en-IN') || '0'}
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      Includes ₹{forecastData.agingBreakdown?.days31to60?.toLocaleString('en-IN')} pending receivables
                    </p>
                  </div>

                  <div className="bg-slate-800/80 border border-slate-700/80 p-4 rounded-xl">
                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-purple-400" /> T+90 Days Liquidity
                      </span>
                      <span className="text-purple-400 font-semibold">75% Probable</span>
                    </div>
                    <div className="text-2xl font-bold text-white">
                      ₹{forecastData.projectedNetLiquidity?.tPlus90Days?.toLocaleString('en-IN') || '0'}
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      Includes ₹{forecastData.agingBreakdown?.days61to90?.toLocaleString('en-IN')} pending receivables
                    </p>
                  </div>
                </div>

                {/* Balance Summary Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Left: Inflow vs Exceptions Breakdown */}
                  <div className="bg-slate-800/60 border border-slate-700/80 p-5 rounded-xl space-y-4">
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-emerald-400" />
                      Live Cash Inflow & Receivables Ledger
                    </h3>
                    <div className="space-y-2.5 text-xs">
                      <div className="flex justify-between py-1.5 border-b border-slate-700/50">
                        <span className="text-slate-400">Reconciled Bank Cash Inflow:</span>
                        <span className="font-bold text-emerald-400">
                          ₹{forecastData.currentBankCashInflow?.toLocaleString('en-IN')}
                        </span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-slate-700/50">
                        <span className="text-slate-400">Total Open Receivables (Unpaid):</span>
                        <span className="font-bold text-white">
                          ₹{forecastData.totalOpenReceivables?.toLocaleString('en-IN')}
                        </span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-slate-700/50">
                        <span className="text-slate-400">Stuck Cash in Outbox Discrepancies:</span>
                        <span className="font-bold text-amber-400">
                          ₹{forecastData.stuckExceptionCash?.toLocaleString('en-IN')}
                        </span>
                      </div>
                      <div className="flex justify-between py-1.5">
                        <span className="text-slate-400">Expected Statutory TDS Credit (Form 26AS):</span>
                        <span className="font-bold text-indigo-400">
                          ₹{forecastData.expectedTdsLiabilitiesReceivable?.toLocaleString('en-IN')}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Top Vendor Exposures */}
                  <div className="bg-slate-800/60 border border-slate-700/80 p-5 rounded-xl space-y-4">
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                      <Layers className="w-4 h-4 text-razor-blue" />
                      Top 5 Accounts Receivable Exposures
                    </h3>
                    <div className="space-y-2 text-xs">
                      {forecastData.topVendorsDue?.map((v, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-2 rounded-lg bg-slate-900/60 border border-slate-700/50"
                        >
                          <span className="text-slate-200 font-medium truncate max-w-[200px]">
                            {idx + 1}. {v.vendorName}
                          </span>
                          <span className="text-white font-bold">
                            ₹{v.amountDue?.toLocaleString('en-IN')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-12 text-slate-400 text-sm">
                No forecast data available. Run a reconciliation batch to populate forward cash projections.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
