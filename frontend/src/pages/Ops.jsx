import React, { useState, useEffect, useCallback } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { LIGHT_COLORS, DARK_COLORS } from '../context/themeColors.js';
import { BRAND } from '../config/brand.js';
import { supabase } from '../lib/supabase.js';

const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

function md(text = '') {
  const lines = String(text).split('\n');
  let out = [];
  let list = null;
  const flush = () => {
    if (list) { out.push('<ul>' + list.map((l) => `<li>${l}</li>`).join('') + '</ul>'); list = null; }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const esc = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const bold = esc.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*]+)\*/g, '<i>$1</i>');
    const withInline = bold.replace(/`([^`]+)`/g, '<code>$1</code>');
    if (line.startsWith('## ')) { flush(); out.push(`<h3>${withInline.slice(3)}</h3>`); }
    else if (line.startsWith('# ')) { flush(); out.push(`<h2>${withInline.slice(2)}</h2>`); }
    else if (line.startsWith('- ')) { list = list || []; list.push(withInline.slice(2)); }
    else { flush(); out.push(`<p>${withInline}</p>`); }
  }
  flush();
  return out.join('');
}

export default function Ops() {
  const { user, isAdmin, loading: authLoading, signOut } = useAuth();
  const { theme } = useTheme();
  const A = theme === 'dark' ? DARK_COLORS : LIGHT_COLORS;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No session');
      const { data: res, error: fnError } = await supabase.functions.invoke('ops', { body: {} });
      if (fnError) throw new Error(fnError.context?.error?.error ?? fnError.message ?? 'Edge function failed');
      if (!res || res.error) throw new Error(res?.error || 'Failed to load ops data');
      setData(res);
    } catch (err) {
      console.error('Ops load error:', err);
      setError(err.message || 'Failed to load operations data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  if (authLoading) {
    return <div style={{ textAlign: 'center', padding: '40px', background: A.bg, minHeight: '100vh' }}>Loading…</div>;
  }
  if (!user || !isAdmin) return <Navigate to={!user ? '/login' : '/access-denied'} replace />;

  const s = data?.stats || {};
  const mrr = data?.mrr || { breakdown: [], total: 0, feesTotal: 0, projectedAnnual: 0 };

  const kpis = [
    { label: 'Total Users', value: s.totalUsers ?? '—', color: A.primary, sub: `${s.signups7 ?? 0} new in 7d` },
    { label: 'Active Premium', value: s.activePremium ?? '—', color: A.success, sub: `${s.conversionRate ?? 0}% conversion` },
    { label: 'MRR', value: inr(mrr.total), color: A.warning, sub: `${inr(mrr.projectedAnnual)}/yr projection` },
    { label: 'Expiring ≤7d', value: s.expiring7 ?? '—', color: (s.expiring7 || 0) > 0 ? '#EF4444' : A.success, sub: `${s.expiring30 ?? 0} within 30d` },
    { label: 'Pending Payments', value: s.pendingPayments ?? '—', color: (s.pendingPayments || 0) > 0 ? '#EF4444' : A.success, sub: `${s.abandonedPayments ?? 0} abandoned (>48h)` },
    { label: 'Active Users /7d', value: s.activeUsers7 ?? '—', color: '#8B5CF6', sub: `${s.totalMessages ?? 0} msgs · ${s.totalConversations ?? 0} convos` },
  ];

  const chipColor = (d) => {
    if (d === null || d < 0) return A.muted;
    if (d <= 7) return '#EF4444';
    if (d <= 14) return '#F59E0B';
    return A.success;
  };

  const gmailLink = (email, subject, body) =>
    `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  const renewalNote = (sub) => `Hey ${sub.full_name || sub.email},\n\nYour ${sub.plan} Premium plan for ${BRAND.name} expires on ${new Date(sub.expires_at).toLocaleDateString()}. Renew to keep unlimited access — login and pick your plan at your dashboard.\n\nThanks`;

  return (
    <div style={{ minHeight: '100vh', background: A.bg, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px', background: A.surface, borderBottom: `1px solid ${A.border}`, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 800, fontSize: 15, color: A.heading }}>🛰 Ops Command Center</span>
          <span style={{ fontSize: 11, color: A.muted, border: `1px solid ${A.border}`, borderRadius: 99, padding: '2px 8px', background: A.bg }}>internal · enterprise</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Link to="/" style={{ fontSize: 13.5, color: A.primary, fontWeight: 600, textDecoration: 'none' }}>← Home</Link>
          <Link to="/dashboard" style={{ fontSize: 13.5, color: A.primary, fontWeight: 600, textDecoration: 'none' }}>Admin Dashboard</Link>
          <span style={{ fontSize: 13, color: A.muted }}>{user?.email}</span>
          <button onClick={() => signOut()} style={{ padding: '7px 14px', borderRadius: 7, border: `1px solid ${A.border}`, background: A.bg, color: A.text, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Log out</button>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px' }}>

        {error && (
          <div style={{ background: A.warningBg, border: `1px solid ${A.warningBorder}`, borderRadius: 8, padding: '12px 16px', fontSize: 13, color: A.warning, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {loading && !data && (
          <div style={{ textAlign: 'center', padding: '48px', color: A.muted }}>Fetching enterprise data…</div>
        )}

        {data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* AI briefing */}
            <div style={{ background: 'linear-gradient(135deg, rgba(56,189,248,.08), rgba(99,102,241,.08))', border: `1px solid ${A.border}`, borderRadius: 14, padding: '20px 24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>🤖</span>
                  <span style={{ fontWeight: 800, fontSize: 14, color: A.heading }}>Ops-Copilot daily briefing</span>
                  <span style={{ fontSize: 11.5, color: A.muted }}>· {new Date(data.generated_at).toLocaleString()}</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={load} disabled={loading} style={{ padding: '6px 12px', borderRadius: 7, border: `1px solid ${A.border}`, background: A.surface, color: A.text, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>⟳ {loading ? 'Refreshing…' : 'Refresh'}</button>
                </div>
              </div>
              {data.briefing ? (
                <div style={{ fontSize: 13.5, color: A.text, lineHeight: 1.7, maxHeight: 340, overflowY: 'auto' }} dangerouslySetInnerHTML={{ __html: md(data.briefing) }} />
              ) : (
                <div style={{ fontSize: 13, color: A.muted }}>Briefing unavailable right now (Gemini key/short transient). Data below is live.</div>
              )}
            </div>

            {/* KPI cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
              {kpis.map((k) => (
                <div key={k.label} style={{ background: A.surface, border: `1px solid ${A.border}`, borderRadius: 12, padding: '16px' }}>
                  <div style={{ fontSize: 24, fontWeight: 800, color: k.color }}>{k.value}</div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: A.text, marginTop: 2 }}>{k.label}</div>
                  <div style={{ fontSize: 11, color: A.muted, marginTop: 2 }}>{k.sub}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16, alignItems: 'start' }}>
              {/* MRR breakdown */}
              <div style={{ background: A.surface, border: `1px solid ${A.border}`, borderRadius: 14, padding: '18px 22px' }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: A.heading, marginBottom: 12 }}>💳 Revenue engine</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                  {mrr.breakdown.map((b) => (
                    <div key={b.plan} style={{ flex: 1, minWidth: 110, background: A.bg, border: `1px solid ${A.border}`, borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: A.text }}>{inr(b.mrr)}</div>
                      <div style={{ fontSize: 11.5, color: A.muted }}>{b.label} · {b.count} users</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '8px 0', borderTop: `1px dashed ${A.border}` }}>
                  <span style={{ color: A.muted }}>MRR total</span><b style={{ color: A.text }}>{inr(mrr.total)}</b>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '8px 0', borderTop: `1px dashed ${A.border}` }}>
                  <span style={{ color: A.muted }}>Convenience fees collected</span><b style={{ color: A.warning }}>{inr(mrr.feesTotal)}</b>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '8px 0', borderTop: `1px dashed ${A.border}` }}>
                  <span style={{ color: A.muted }}>Annual projection (MRR×12)</span><b style={{ color: A.primary }}>{inr(mrr.projectedAnnual)}</b>
                </div>
              </div>

              {/* Pending / abandoned */}
              <div style={{ background: A.surface, border: `1px solid ${A.border}`, borderRadius: 14, padding: '18px 22px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontWeight: 800, fontSize: 14, color: A.heading }}>⏳ Payment follow-ups</span>
                  <span style={{ fontSize: 12, color: (s.pendingPayments || 0) > 0 ? '#EF4444' : A.success, fontWeight: 700 }}>{s.pendingPayments ?? 0} pending</span>
                </div>
                {(data.pending || []).length === 0 ? (
                  <div style={{ fontSize: 13, color: A.muted }}>No pending order drafts. All clean.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
                    {(data.pending || []).map((p, i) => (
                      <div key={i} style={{ background: A.bg, border: `1px solid ${A.border}`, borderRadius: 10, padding: '10px 12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                          <b style={{ color: A.text, wordBreak: 'break-all' }}>{p.email}</b>
                          <span style={{ color: p.days_pending > 1 ? '#EF4444' : A.muted, whiteSpace: 'nowrap', marginLeft: 8 }}>{p.days_pending}d old{p.days_pending > 1 ? ' · abandoned' : ''}</span>
                        </div>
                        <div style={{ marginTop: 6 }}>
                          <a href={gmailLink(p.email, 'Complete your Premium order', `Hi,\n\nYour ${BRAND.name} Premium order (${p.order_id || ''}) was created but not completed. Complete payment to activate: ${window.location.origin}/chat\n\nThanks`)} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: A.primary, fontWeight: 600, textDecoration: 'none' }}>✉ Nudge</a>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Subscriptions expiring */}
            <div style={{ background: A.surface, border: `1px solid ${A.border}`, borderRadius: 14, padding: '18px 22px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <span style={{ fontWeight: 800, fontSize: 14, color: A.heading }}>📅 Renewal watchlist</span>
                <span style={{ fontSize: 12, color: A.muted }}>all premium users by expiry · {data.subscriptions.length} total</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${A.border}` }}>
                      <th style={{ textAlign: 'left', padding: '8px 10px', color: A.muted, fontWeight: 600 }}>User</th>
                      <th style={{ textAlign: 'left', padding: '8px 10px', color: A.muted, fontWeight: 600 }}>Plan</th>
                      <th style={{ textAlign: 'left', padding: '8px 10px', color: A.muted, fontWeight: 600 }}>Expires</th>
                      <th style={{ textAlign: 'left', padding: '8px 10px', color: A.muted, fontWeight: 600 }}>Days left</th>
                      <th style={{ textAlign: 'right', padding: '8px 10px', color: A.muted, fontWeight: 600 }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.subscriptions.map((sub) => {
                      const d = sub.days_left;
                      return (
                        <tr key={sub.id} style={{ borderBottom: `1px solid ${A.border}` }}>
                          <td style={{ padding: '8px 10px', wordBreak: 'break-all', color: A.text }}>{sub.email}</td>
                          <td style={{ padding: '8px 10px', textTransform: 'capitalize', color: A.text }}>{sub.plan}</td>
                          <td style={{ padding: '8px 10px', color: A.text }}>{new Date(sub.expires_at).toLocaleDateString()}</td>
                          <td style={{ padding: '8px 10px' }}>
                            <span style={{ color: chipColor(d), fontWeight: 700, background: A.bg, border: `1px solid ${chipColor(d)}33`, borderRadius: 99, padding: '2px 8px', fontSize: 12 }}>{d === null ? '—' : d < 0 ? 'expired' : `${d}d`}</span>
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                            <a href={gmailLink(sub.email, `Renew your ${BRAND.name} Premium`, renewalNote(sub))} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: A.primary, fontWeight: 600, textDecoration: 'none' }}>✉ Renew nudge</a>
                          </td>
                        </tr>
                      );
                    })}
                    {data.subscriptions.length === 0 && (
                      <tr><td colSpan="5" style={{ padding: '16px', textAlign: 'center', color: A.muted }}>No active premium subscriptions yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}