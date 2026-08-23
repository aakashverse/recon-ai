import React, { useState, useEffect } from 'react';
import { X, Layers, Plus, Check, Trash2, Power, BookOpen } from 'lucide-react';

export function RulesManagerModal({ onClose }) {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);

  const [newParty, setNewParty] = useState('');
  const [newTdsSection, setNewTdsSection] = useState('194C');
  const [newTdsRate, setNewTdsRate] = useState(2.0);
  const [newDescription, setNewDescription] = useState('');

  const fetchRules = async () => {
    try {
      const res = await fetch('/api/rules');
      if (res.ok) {
        const data = await res.json();
        setRules(data);
      }
    } catch (e) {
      console.warn('Failed to fetch rules:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRules();
  }, []);

  const handleToggleActive = async (rule) => {
    try {
      const res = await fetch(`/api/rules/${rule._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !rule.isActive }),
      });
      if (res.ok) fetchRules();
    } catch (e) {
      alert(e.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this rule?')) return;
    try {
      const res = await fetch(`/api/rules/${id}`, { method: 'DELETE' });
      if (res.ok) fetchRules();
    } catch (e) {
      alert(e.message);
    }
  };

  const handleCreateRule = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partyIdentifier: newParty.toUpperCase().trim(),
          patternType: 'TDS_STANDARD',
          matchCriteria: {
            narrationKeywords: [newParty.toUpperCase().trim()],
          },
          adjustmentLogic: {
            tdsSection: newTdsSection,
            tdsRate: Number(newTdsRate),
            handlingFeeRate: 0,
            fixedDeduction: 0,
          },
          confidence: 0.98,
          description: newDescription || `Custom Rule for ${newParty.toUpperCase()}`,
          isActive: true,
        }),
      });

      if (res.ok) {
        setShowAddForm(false);
        setNewParty('');
        setNewDescription('');
        fetchRules();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to create rule');
      }
    } catch (e) {
      alert(e.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-razor-card border border-razor-border rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-fade-in">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-razor-border bg-slate-900/90 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-razor-purple/20 border border-razor-purple/40 flex items-center justify-center">
              <Layers className="w-5 h-5 text-razor-purple" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Tier-2 Self-Healing Rule Cache
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                  {rules.length} Rules Active
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Deterministic vendor pattern cache &lt;20ms • Auto-learned from accountant resolutions
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="px-3 py-1.5 rounded-lg bg-razor-blue hover:bg-razor-blueHover text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{showAddForm ? 'Cancel' : 'New Rule'}</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Add Rule Form */}
          {showAddForm && (
            <form onSubmit={handleCreateRule} className="p-4 rounded-xl bg-slate-900 border border-razor-blue/40 space-y-3 animate-fade-in">
              <h4 className="text-xs font-bold text-white">Create New Vendor Pattern Rule</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">Vendor Keyword / ID</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. INFOSYS"
                    value={newParty}
                    onChange={(e) => setNewParty(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono uppercase focus:border-razor-blue focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">TDS Section</label>
                  <select
                    value={newTdsSection}
                    onChange={(e) => {
                      setNewTdsSection(e.target.value);
                      if (e.target.value === '194J') setNewTdsRate(10);
                      else if (e.target.value === '194C') setNewTdsRate(2);
                      else if (e.target.value === '194H') setNewTdsRate(5);
                    }}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white focus:border-razor-blue focus:outline-none"
                  >
                    <option value="194C">Section 194C (Contractor - 2%)</option>
                    <option value="194J">Section 194J (Professional - 10%)</option>
                    <option value="194H">Section 194H (Commission - 5%)</option>
                    <option value="NONE">Custom Deduction</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">TDS Rate (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={newTdsRate}
                    onChange={(e) => setNewTdsRate(parseFloat(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-razor-blue focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-slate-400 mb-1 text-xs">Description</label>
                <input
                  type="text"
                  placeholder="e.g. Standard IT service TDS rate"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-xs focus:border-razor-blue focus:outline-none"
                />
              </div>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors"
              >
                Save Rule to Cache
              </button>
            </form>
          )}

          {/* Rules List */}
          <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60">
            {rules.map((rule) => (
              <div
                key={rule._id}
                className="p-4 flex items-center justify-between gap-4 hover:bg-slate-900/90 transition-colors"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-white text-sm">
                      {rule.partyIdentifier}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-mono">
                      {rule.adjustmentLogic?.tdsSection} @ {rule.adjustmentLogic?.tdsRate}%
                    </span>
                    {rule.source === 'LEARNED_FROM_EXCEPTION' && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 font-mono flex items-center gap-1">
                        <BookOpen className="w-2.5 h-2.5" /> Learned from Outbox
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">{rule.description || 'Standard vendor pattern'}</p>
                </div>

                <div className="flex items-center gap-4 text-xs font-mono text-slate-400">
                  <div>
                    Used <strong className="text-white">{rule.usageCount || 0}</strong> times
                  </div>
                  <button
                    onClick={() => handleToggleActive(rule)}
                    className={`p-1.5 rounded-lg transition-colors ${
                      rule.isActive
                        ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                        : 'bg-slate-800 text-slate-500 hover:bg-slate-700'
                    }`}
                    title={rule.isActive ? 'Active Rule' : 'Inactive'}
                  >
                    <Power className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(rule._id)}
                    className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition-colors"
                    title="Delete Rule"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
