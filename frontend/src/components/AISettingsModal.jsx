import React, { useState, useEffect } from 'react';
import { X, Sparkles, Key, CheckCircle, ShieldCheck, ExternalLink, Bot } from 'lucide-react';

export function AISettingsModal({ onClose }) {
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState({ isConfigured: false, hasKey: false, modelName: 'gemini-1.5-flash' });
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/reconciliation/ai-status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (e) {
      console.warn('Failed to fetch AI status:', e);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!apiKey.trim()) return;

    setIsSaving(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/reconciliation/set-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setFeedback({ type: 'success', message: 'Gemini 1.5 Flash activated successfully on Free Tier!' });
        fetchStatus();
        setApiKey('');
      } else {
        setFeedback({ type: 'error', message: data.error || 'Failed to activate key. Check API key validity.' });
      }
    } catch (err) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-razor-card border border-razor-border rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden animate-fade-in">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-razor-border bg-slate-900/90 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center">
              <Bot className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Gemini AI Engine Settings
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold ${status.isConfigured ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'}`}>
                  {status.isConfigured ? 'Live Gemini 1.5 Active' : 'Intelligent Local Mode'}
                </span>
              </h3>
              {/* <p className="text-xs text-slate-400">
                100% Free Tier Supported (15 RPM • 1,500 Requests/Day • Zero Cost)
              </p> */}
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4 text-xs">
          {/* Status info */}
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-300">Active AI Model:</span>
              <span className="font-mono text-razor-blue font-bold">google/gemini-1.5-flash</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-300">API Key Status:</span>
              <span className="font-mono text-slate-400">
                {status.hasKey ? `Configured (${status.keyMasked})` : 'Not set (Using intelligent local fallback)'}
              </span>
            </div>
            <div className="pt-2 border-t border-slate-800 text-[11px] text-slate-400 leading-relaxed">
              💡 <strong>Free Tier Guide:</strong> Google AI Studio provides a completely free tier with no credit card required. You can generate a free key in 10 seconds.
            </div>
          </div>

          {feedback && (
            <div className={`p-3 rounded-lg text-xs flex items-center gap-2 ${feedback.type === 'success' ? 'bg-emerald-950/40 border border-emerald-500/40 text-emerald-300' : 'bg-rose-950/40 border border-rose-500/40 text-rose-300'}`}>
              <CheckCircle className="w-4 h-4 shrink-0" />
              <span>{feedback.message}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSave} className="space-y-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1 flex items-center justify-between">
                <span>Enter Google Gemini API Key:</span>
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-razor-blue hover:underline flex items-center gap-1 font-normal text-[11px]"
                >
                  Get Free API Key <ExternalLink className="w-3 h-3" />
                </a>
              </label>
              <div className="relative">
                <Key className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  placeholder="AIzaSy..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono text-xs focus:border-razor-blue focus:outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSaving || !apiKey.trim()}
              className="w-full py-2.5 rounded-lg bg-razor-purple hover:bg-purple-600 text-white font-bold text-xs shadow-md shadow-purple-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Sparkles className="w-4 h-4" />
              <span>{isSaving ? 'Connecting to Gemini...' : 'Activate Gemini'}</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
