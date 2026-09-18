import React, { useState, useRef, useEffect } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { LIGHT_COLORS, DARK_COLORS } from '../context/themeColors.js';
import { supabase } from '../lib/supabase.js';

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
    else if (/^\d+\.\s/.test(line)) { list = list || []; list.push(withInline.replace(/^\d+\.\s/, '')); }
    else { flush(); out.push(`<p>${withInline}</p>`); }
  }
  flush();
  return out.join('');
}

const SUGGESTIONS = [
  'usage summary batao',
  'expiring subscriptions in 30 days',
  'pending payments',
  'top users by messages',
  'leads pipeline',
  'table counts',
];

export default function Copilot() {
  const { user, isAdmin, loading: authLoading, signOut } = useAuth();
  const { theme } = useTheme();
  const A = theme === 'dark' ? DARK_COLORS : LIGHT_COLORS;
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, busy]);

  const ask = async (text) => {
    const q = String(text ?? input).trim();
    if (!q || busy) return;
    setInput('');
    setError('');
    setMsgs((prev) => [...prev, { role: 'user', content: q }]);
    setBusy(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('copilot', { body: { question: q } });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      setMsgs((prev) => [...prev, { role: 'assistant', content: data.answer, op: data.op }]);
    } catch (err) {
      setError(err.message || 'Kuch gadbad ho gayi. Dobara try karo ya alag sentence me puchho.');
    } finally {
      setBusy(false);
    }
  };

  if (authLoading) return <div style={{ textAlign: 'center', padding: '40px', background: A.bg, minHeight: '100vh' }}>Loading…</div>;
  if (!user || !isAdmin) return <Navigate to={!user ? '/login' : '/access-denied'} replace />;

  return (
    <div style={{ minHeight: '100vh', background: A.bg, fontFamily: "'Inter', system-ui, sans-serif", display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px', background: A.surface, borderBottom: `1px solid ${A.border}`, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 800, fontSize: 15, color: A.heading }}>🧠 Dev-Copilot</span>
          <span style={{ fontSize: 11, color: A.muted, border: `1px solid ${A.border}`, borderRadius: 99, padding: '2px 8px', background: A.bg }}>data copilot · admin only</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Link to="/" style={{ fontSize: 13.5, color: A.primary, fontWeight: 600, textDecoration: 'none' }}>← Home</Link>
          <Link to="/ops" style={{ fontSize: 13.5, color: A.primary, fontWeight: 600, textDecoration: 'none' }}>Ops</Link>
          <Link to="/sales" style={{ fontSize: 13.5, color: A.primary, fontWeight: 600, textDecoration: 'none' }}>Sales</Link>
          <span style={{ fontSize: 13, color: A.muted }}>{user?.email}</span>
          <button onClick={() => signOut()} style={{ padding: '7px 14px', borderRadius: 7, border: `1px solid ${A.border}`, background: A.bg, color: A.text, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Log out</button>
        </div>
      </div>

      <div style={{ maxWidth: 860, margin: '0 auto', width: '100%', flex: 1, display: 'flex', flexDirection: 'column', padding: '20px 18px' }}>
        {error && (
          <div style={{ background: A.warningBg, border: `1px solid ${A.warningBorder}`, borderRadius: 8, padding: '10px 14px', fontSize: 13, color: A.warning, marginBottom: 12 }}>{error}</div>
        )}

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', paddingBottom: 12 }}>
          {msgs.length === 0 && (
            <div style={{ textAlign: 'center', padding: '30px 10px', color: A.muted }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🔍</div>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: A.text, marginBottom: 4 }}>Apne data se Hindi/English me puchho</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.7 }}>
                Users, MRR, subscriptions, payments, leads, documents — sab whitelisted, read-only. Koi bhi SQL nahi chalti.
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 16 }}>
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => ask(s)} disabled={busy} style={{ padding: '7px 14px', borderRadius: 99, border: `1px solid ${A.primary}55`, background: A.surface, color: A.primary, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>{s}</button>
                ))}
              </div>
            </div>
          )}

          {msgs.map((m, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              {m.role === 'user' ? (
                <div style={{ maxWidth: '80%', background: A.primary, color: '#fff', borderRadius: '16px 16px 4px 16px', padding: '10px 14px', fontSize: 14, lineHeight: 1.5, wordBreak: 'break-word' }}>{m.content}</div>
              ) : (
                <div style={{ maxWidth: '94%', background: A.surface, border: `1px solid ${A.border}`, borderRadius: '16px 16px 16px 4px', padding: '14px 18px', fontSize: 13.5, lineHeight: 1.7, color: A.text }}>
                  <div style={{ fontSize: 11, color: A.muted, marginBottom: 6 }}>🤖 Dev-Copilot{m.op ? ` · op: ${m.op.op}` : ''}</div>
                  <div dangerouslySetInnerHTML={{ __html: md(m.content) }} />
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div style={{ background: A.surface, border: `1px solid ${A.border}`, borderRadius: '16px 16px 16px 4px', padding: '14px 18px', fontSize: 13.5, color: A.muted, alignSelf: 'flex-start' }}>🧠 Thinking<span className="dots">…</span></div>
          )}
          <div ref={endRef} />
        </div>

        <div style={{ display: 'flex', gap: 8, borderTop: `1px solid ${A.border}`, paddingTop: 14 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ask()}
            placeholder='Ask… e.g. "kis user ki subscription 15 din me expire hogi?"'
            disabled={busy}
            style={{ flex: 1, padding: '12px 14px', borderRadius: 10, border: `1px solid ${A.border}`, background: A.surface, color: A.text, fontSize: 14, outline: 'none', colorScheme: theme === 'dark' ? 'dark' : 'light' }}
          />
          <button onClick={() => ask()} disabled={busy || !input.trim()} style={{ padding: '12px 20px', borderRadius: 10, border: 'none', background: A.primary, color: '#fff', fontSize: 14, fontWeight: 700, cursor: busy || !input.trim() ? 'default' : 'pointer', opacity: busy || !input.trim() ? 0.6 : 1 }}>Ask</button>
        </div>
      </div>
    </div>
  );
}