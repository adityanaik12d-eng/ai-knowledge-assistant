import React, { useState, useEffect, useCallback } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { LIGHT_COLORS, DARK_COLORS } from '../context/themeColors.js';
import { BRAND } from '../config/brand.js';
import { supabase } from '../lib/supabase.js';

const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

const STAGES = ['lead', 'demo', 'proposal', 'signed', 'paid', 'won', 'lost'];
const STAGE_COLOR = {
  lead: '#64748B', demo: '#8B5CF6', proposal: '#F59E0B', signed: '#0EA5E9',
  paid: '#10B981', won: '#22C55E', lost: '#EF4444',
};
const STAGE_LABEL = {
  lead: 'Lead', demo: 'Demo', proposal: 'Proposal', signed: 'Signed',
  paid: 'Paid', won: 'Won', lost: 'Lost',
};

const TIERS = { s: { label: 'Small', setup: 25000, amc: 6000 }, m: { label: 'Mid', setup: 40000, amc: 12000 }, e: { label: 'Enterprise', setup: 75000, amc: 25000 } };
const ADDONS = [
  { key: 'bot', label: 'WhatsApp/Slack/Teams bot', setup: 10000, mo: 2000 },
  { key: 'voice', label: 'Voice assistant', setup: 7500, mo: 1500 },
  { key: 'ana', label: 'Analytics dashboard', setup: 5000, mo: 1000 },
  { key: 'ui', label: 'Custom UI/branding work', setup: 15000, mo: 3000 },
  { key: 'mod', label: 'Custom business module', setup: 20000, mo: 5000 },
  { key: 'adv', label: 'Advanced AI model pack', setup: 6000, mo: 0 },
  { key: 'pri', label: 'Priority support/SLA', setup: 0, mo: 2000 },
];

const emptyForm = () => ({
  company: '', contact_name: '', contact_email: '', contact_phone: '',
  size: 'm', source: 'network', stage: 'lead', addons: [],
  setup_fee: 0, amc: 0, won_amount: 0, notes: '', next_follow_up: '',
});

export default function Sales() {
  const { user, isAdmin, loading: authLoading, signOut } = useAuth();
  const { theme } = useTheme();
  const A = theme === 'dark' ? DARK_COLORS : LIGHT_COLORS;
  const [leads, setLeads] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [filterStage, setFilterStage] = useState('all');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const { data, error: fnError } = await supabase.functions.invoke('sales', { body: { action: 'list' } });
      if (fnError) throw new Error(fnError.context?.error?.error ?? fnError.message ?? 'Edge function failed');
      if (data?.error) throw new Error(data.error);
      setLeads(data.leads || []);
      setSummary(data.summary || null);
    } catch (err) {
      setError(err.message || 'Failed to load pipeline');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const callSales = async (action, body = {}) => {
    const { data, error: fnError } = await supabase.functions.invoke('sales', { body: { action, ...body } });
    if (fnError) throw fnError;
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const calcFees = (size, addons) => {
    const tier = TIERS[size] || TIERS.m;
    let setup = tier.setup, amc = tier.amc;
    for (const a of ADDONS) if (addons.includes(a.key)) { setup += a.setup; amc += a.mo; }
    return { setup_fee: setup, amc };
  };

  const toggleAddon = (key) => {
    setForm((prev) => {
      const has = prev.addons.includes(key);
      const addons = has ? prev.addons.filter((k) => k !== key) : [...prev.addons, key];
      return { ...prev, addons, ...calcFees(prev.size, addons) };
    });
  };

  const saveLead = async () => {
    if (!form.company.trim()) { setError('Company name is required'); return; }
    try {
      const payload = {
        company: form.company.trim(), contact_name: form.contact_name, contact_email: form.contact_email,
        contact_phone: form.contact_phone, size: form.size, source: form.source, stage: form.stage,
        addons: form.addons, setup_fee: Number(form.setup_fee) || 0, amc: Number(form.amc) || 0, won_amount: Number(form.won_amount) || 0,
        notes: form.notes, next_follow_up: form.next_follow_up ? `${form.next_follow_up}T09:00:00` : null,
      };
      if (editingId) await callSales('update', { id: editingId, ...payload });
      else await callSales('create', payload);
      setShowForm(false); setEditingId(null); setForm(emptyForm());
      await load();
    } catch (err) { setError(err.message || 'Failed to save lead'); }
  };

  const moveStage = async (id, stage) => {
    try { await callSales('move', { id, stage }); await load(); }
    catch (err) { setError(err.message || 'Failed to update stage'); }
  };

  const delLead = async () => {
    try { await callSales('delete', { id: deleteConfirm }); setDeleteConfirm(null); await load(); }
    catch (err) { setError(err.message || 'Failed to delete'); }
  };

  const gmail = (email, subject, body) =>
    `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  const followUps = leads
    .filter((l) => !['won', 'lost'].includes(l.stage) && l.next_follow_up)
    .map((l) => ({ ...l, dueMs: new Date(l.next_follow_up).getTime() }))
    .filter((l) => !Number.isNaN(l.dueMs))
    .sort((a, b) => a.dueMs - b.dueMs)
    .slice(0, 20);

  const filtered = filterStage === 'all' ? leads : leads.filter((l) => l.stage === filterStage);

  if (authLoading) return <div style={{ textAlign: 'center', padding: '40px', background: A.bg, minHeight: '100vh' }}>Loading…</div>;
  if (!user || !isAdmin) return <Navigate to={!user ? '/login' : '/access-denied'} replace />;

  const snap = (d) => (d ? String(d).slice(0, 10) : '');
  const isOverdue = (dueMs) => dueMs < Date.now();

  return (
    <div style={{ minHeight: '100vh', background: A.bg, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px', background: A.surface, borderBottom: `1px solid ${A.border}`, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 800, fontSize: 15, color: A.heading }}>🤝 Sales-Copilot</span>
          <span style={{ fontSize: 11, color: A.muted, border: `1px solid ${A.border}`, borderRadius: 99, padding: '2px 8px', background: A.bg }}>pipeline CRM</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Link to="/" style={{ fontSize: 13.5, color: A.primary, fontWeight: 600, textDecoration: 'none' }}>← Home</Link>
          <Link to="/ops" style={{ fontSize: 13.5, color: A.primary, fontWeight: 600, textDecoration: 'none' }}>Ops</Link>
          <span style={{ fontSize: 13, color: A.muted }}>{user?.email}</span>
          <button onClick={() => signOut()} style={{ padding: '7px 14px', borderRadius: 7, border: `1px solid ${A.border}`, background: A.bg, color: A.text, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Log out</button>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px' }}>
        {error && (
          <div style={{ background: A.warningBg, border: `1px solid ${A.warningBorder}`, borderRadius: 8, padding: '12px 16px', fontSize: 13, color: A.warning, marginBottom: 16 }}>{error}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {summary && (
              <>
                <Chip label="Total leads" value={summary.totalLeads} color={A.primary} />
                <Chip label="Won revenue" value={inr(summary.wonRevenue)} color={A.success} />
                <Chip label="Live AMC/mo" value={inr(summary.liveAmc)} color="#0EA5E9" />
                <Chip label="Follow-ups due/next 24h" value={summary.dueFollowUps} color={(summary.dueFollowUps || 0) > 0 ? '#EF4444' : A.muted} />
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={load} disabled={loading} style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${A.border}`, background: A.surface, color: A.text, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>⟳ {loading ? 'Loading…' : 'Refresh'}</button>
            <button onClick={() => { setEditingId(null); setForm(emptyForm()); setShowForm(true); }} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: A.primary, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>+ New lead</button>
          </div>
        </div>

        {/* Follow-up nudges */}
        <div style={{ background: A.surface, border: `1px solid ${A.border}`, borderRadius: 14, padding: '16px 20px', marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: A.heading, marginBottom: 10 }}>⏰ Follow-up queue</div>
          {followUps.length === 0 ? (
            <div style={{ fontSize: 13, color: A.muted }}>No scheduled follow-ups. Nudge koi bhi lead me date set karo.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {followUps.map((l) => (
                <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, background: A.bg, border: `1px solid ${A.border}`, borderRadius: 10, padding: '10px 14px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 220 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: isOverdue(l.dueMs) ? '#EF4444' : A.text }}>{isOverdue(l.dueMs) ? '🔴 Overdue' : '🟡 Due'}</span>
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: A.text }}>{l.company}</div>
                      <div style={{ fontSize: 11.5, color: A.muted }}>{l.contact_name || '—'} · due {new Date(l.dueMs).toLocaleString()}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <a href={gmail(l.contact_email || 'adityanaik12d@gmail.com', `Follow-up: ${l.company} (${BRAND.name})`, `Hi ${l.contact_name || 'there'},\n\nFollowing up on ${l.company} regarding the AI Knowledge Assistant pilot. Happy to grab 15 minutes this week.\n\n— Aditya`)} target="_blank" rel="noreferrer" style={{ padding: '6px 12px', borderRadius: 7, border: `1px solid ${A.primary}`, background: A.surface, color: A.primary, fontSize: 12.5, fontWeight: 600, textDecoration: 'none' }}>✉ Nudge</a>
                    <button onClick={() => moveStage(l.id, nextStage(l.stage))} style={{ padding: '6px 12px', borderRadius: 7, border: 'none', background: A.primary, color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Mark → {STAGE_LABEL[nextStage(l.stage)]}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pipeline columns */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 8, overflowX: 'auto', paddingBottom: 4 }}>
          <button onClick={() => setFilterStage('all')} style={{ padding: '7px 14px', borderRadius: 99, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: `1px solid ${A.border}`, background: filterStage === 'all' ? A.primary : A.surface, color: filterStage === 'all' ? '#fff' : A.text }}>All</button>
          {STAGES.map((s) => (
            <button key={s} onClick={() => setFilterStage(s)} style={{ padding: '7px 14px', borderRadius: 99, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: `1px solid ${STAGE_COLOR[s]}55`, background: filterStage === s ? STAGE_COLOR[s] : A.surface, color: filterStage === s ? '#fff' : A.text }}>
              {STAGE_LABEL[s]} {leads.filter((l) => l.stage === s).length}
            </button>
          ))}
        </div>

        {/* Table */}
        <div style={{ background: A.surface, border: `1px solid ${A.border}`, borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${A.border}` }}>
                  {['Company', 'Contact', 'Stage', 'Setup', 'AMC/mo', 'Won', 'Next follow-up', 'Updated', 'Actions'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 12px', color: A.muted, fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <tr key={l.id} style={{ borderBottom: `1px solid ${A.border}` }}>
                    <td style={{ padding: '10px 12px', color: A.text, fontWeight: 700, whiteSpace: 'nowrap' }}>{l.company}</td>
                    <td style={{ padding: '10px 12px', color: A.text }}>
                      <div>{l.contact_name || '—'}</div>
                      {l.contact_email && <div style={{ fontSize: 11, color: A.muted, wordBreak: 'break-all' }}>{l.contact_email}</div>}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <select value={l.stage} onChange={(e) => moveStage(l.id, e.target.value)} style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid ${STAGE_COLOR[l.stage]}66`, background: A.bg, color: A.text, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                        {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '10px 12px', color: A.text, whiteSpace: 'nowrap' }}>{l.setup_fee ? inr(l.setup_fee) : '—'}</td>
                    <td style={{ padding: '10px 12px', color: '#0EA5E9', fontWeight: 600, whiteSpace: 'nowrap' }}>{l.amc ? inr(l.amc) + '/mo' : '—'}</td>
                    <td style={{ padding: '10px 12px', color: A.success, fontWeight: 700, whiteSpace: 'nowrap' }}>{l.won_amount ? inr(l.won_amount) : '—'}</td>
                    <td style={{ padding: '10px 12px', color: l.next_follow_up ? (new Date(l.next_follow_up).getTime() < Date.now() ? '#EF4444' : A.muted) : A.muted, whiteSpace: 'nowrap' }}>{l.next_follow_up ? new Date(l.next_follow_up).toLocaleDateString() : '—'}</td>
                    <td style={{ padding: '10px 12px', color: A.muted, whiteSpace: 'nowrap' }}>{l.updated_at ? new Date(l.updated_at).toLocaleDateString() : '—'}</td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => { setEditingId(l.id); setForm({ company: l.company, contact_name: l.contact_name || '', contact_email: l.contact_email || '', contact_phone: l.contact_phone || '', size: l.size || 'm', source: l.source || '', stage: l.stage, addons: l.addons || [], setup_fee: Number(l.setup_fee) || 0, amc: Number(l.amc) || 0, won_amount: Number(l.won_amount) || 0, notes: l.notes || '', next_follow_up: snap(l.next_follow_up) }); setShowForm(true); }} style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${A.primary}`, background: A.surface, color: A.primary, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Edit</button>
                        {deleteConfirm === l.id ? (
                          <>
                            <button onClick={delLead} style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: '#EF4444', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Confirm</button>
                            <button onClick={() => setDeleteConfirm(null)} style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${A.border}`, background: A.surface, color: A.text, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                          </>
                        ) : (
                          <button onClick={() => setDeleteConfirm(l.id)} style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid #EF4444`, background: A.surface, color: '#EF4444', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Delete</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan="9" style={{ padding: '24px', textAlign: 'center', color: A.muted }}>No leads here yet. "+ New lead" se shuru karo.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modal */}
        {showForm && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
            <div style={{ background: A.surface, border: `1px solid ${A.border}`, borderRadius: 16, padding: '22px 26px', width: '100%', maxWidth: 720, maxHeight: '90vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div style={{ fontWeight: 800, fontSize: 16, color: A.heading }}>{editingId ? 'Edit lead' : 'New lead'}</div>
                <button onClick={() => setShowForm(false)} style={{ border: 'none', background: 'none', color: A.muted, fontSize: 20, cursor: 'pointer' }}>✕</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <Field label="Company *"><input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Acme Pharma" style={{ ...input, colorScheme: theme === 'dark' ? 'dark' : 'light' }} /></Field>
                <Field label="Contact name"><input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} style={input} /></Field>
                <Field label="Contact email"><input value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} placeholder="hr@company.com" style={input} /></Field>
                <Field label="Phone"><input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} style={input} /></Field>
                <Field label="Client size">
                  <select value={form.size} onChange={(e) => { const size = e.target.value; setForm((prev) => ({ ...prev, size, ...calcFees(size, prev.addons) })); }} style={input}>
                    {Object.keys(TIERS).map((k) => <option key={k} value={k}>{TIERS[k].label} — {inr(TIERS[k].setup)} / {inr(TIERS[k].amc)}/mo</option>)}
                  </select>
                </Field>
                <Field label="Stage">
                  <select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })} style={input}>
                    {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                  </select>
                </Field>
                <Field label="Next follow-up"><input type="date" value={form.next_follow_up} onChange={(e) => setForm({ ...form, next_follow_up: e.target.value })} style={input} /></Field>
              </div>

              <div style={{ marginTop: 16, fontWeight: 800, fontSize: 13.5, color: A.heading }}>🧮 Quote calculator (auto)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                {ADDONS.map((a) => (
                  <label key={a.key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', border: `1px solid ${A.border}`, borderRadius: 8, background: form.addons.includes(a.key) ? A.activeBg : A.bg, cursor: 'pointer', fontSize: 12.5, color: A.text }}>
                    <input type="checkbox" checked={form.addons.includes(a.key)} onChange={() => toggleAddon(a.key)} style={{ accentColor: A.primary }} />
                    {a.label} <b>+{inr(a.setup)}</b>/<b style={{ color: '#0EA5E9' }}>+{inr(a.mo)}/mo</b>
                  </label>
                ))}
              </div>

              <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <Field label="Setup fee (INR)"><input type="number" value={form.setup_fee} onChange={(e) => setForm({ ...form, setup_fee: e.target.value })} style={input} /></Field>
                <Field label="AMC (INR/month)"><input type="number" value={form.amc} onChange={(e) => setForm({ ...form, amc: e.target.value })} style={input} /></Field>
                <Field label="Won amount (INR)"><input type="number" value={form.won_amount || ''} onChange={(e) => setForm({ ...form, won_amount: e.target.value })} style={input} /></Field>
              </div>
              <div style={{ marginTop: 12 }}>
                <Field label="Notes"><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows="2" style={{ ...input, fontFamily: 'inherit' }} /></Field>
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
                <button onClick={() => setShowForm(false)} style={{ padding: '9px 16px', borderRadius: 8, border: `1px solid ${A.border}`, background: A.surface, color: A.text, fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                <button onClick={saveLead} style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: A.primary, color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>{editingId ? 'Save changes' : 'Add lead'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const input = { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #555', background: '#fff', color: '#111', fontSize: 13.5 };

function Field({ label, children }) {
  return (
    <div>
      <div style={{ marginBottom: 4, fontSize: 12.5, color: '#888', fontWeight: 600 }}>{label}</div>
      {children}
    </div>
  );
}

function Chip({ label, value, color }) {
  const A = { surface: '#fff', border: '#eee' };
  return (
    <div style={{ background: A.surface, border: `1px solid ${A.border}`, borderRadius: 12, padding: '10px 14px', minWidth: 120 }}>
      <div style={{ fontSize: 17, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 11.5, color: '#999' }}>{label}</div>
    </div>
  );
}

function nextStage(s) { const i = STAGES.indexOf(s); return STAGES[Math.min(i + 1, STAGES.length - 1)]; }