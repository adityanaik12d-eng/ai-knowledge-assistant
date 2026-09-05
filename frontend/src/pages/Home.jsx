import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { LIGHT_COLORS, DARK_COLORS } from '../context/themeColors.js';
import { BRAND } from '../config/brand.js';

export default function Home() {
  const { user, signOut, isAdmin } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const A = theme === 'dark' ? DARK_COLORS : LIGHT_COLORS;
  return (
    <div style={{
      minHeight: '100vh',
      background: A.bg,
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '14px 24px', background: A.surface, borderBottom: `1px solid ${A.border}`,
      }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: A.heading }}>
          {BRAND.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 13, color: A.muted }}>{user?.email}</span>
          <button
            onClick={toggleTheme}
            style={{
              background: 'none',
              border: 'none',
              color: A.primary,
              fontSize: 20,
              cursor: 'pointer',
              padding: 0,
              lineHeight: 1,
            }}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button
            onClick={() => signOut()}
            style={{
              padding: '7px 14px', borderRadius: 7, border: `1px solid ${A.border}`,
              background: A.bg, color: A.text, fontSize: 14, fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Log out
          </button>
        </div>
      </div>
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '80px 24px', textAlign: 'center',
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12, background: A.primary,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 22, fontWeight: 700, marginBottom: 18,
        }}>
          ✓
        </div>
        <h2 style={{ margin: '0 0 24px', fontSize: 18, color: A.heading }}>
          Welcome to {BRAND.name}
        </h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link
            to="/chat"
            style={{
              padding: '10px 20px', borderRadius: 8, background: A.primary, color: '#fff',
              fontSize: 14, fontWeight: 600, textDecoration: 'none',
            }}
          >
            Start Chat →
          </Link>
          <Link
            to="/upload"
            style={{
              padding: '10px 20px', borderRadius: 8, background: A.surface, color: A.primary,
              border: `1px solid ${A.primary}`, fontSize: 14, fontWeight: 600, textDecoration: 'none',
            }}
          >
            Upload Document
          </Link>
          {isAdmin && (
            <Link
              to="/dashboard"
              style={{
                padding: '10px 20px', borderRadius: 8, background: A.surface, color: A.primary,
                border: `1px solid ${A.primary}`, fontSize: 14, fontWeight: 600, textDecoration: 'none',
              }}
            >
              Admin Dashboard
            </Link>
          )}
        </div>
        {BRAND.helpdeskEmail && (
          <div style={{
            marginTop: 34,
            paddingTop: 18,
            borderTop: `1px solid ${A.border}`,
            fontSize: 13,
            color: A.text,
            maxWidth: 420,
            marginLeft: 'auto',
            marginRight: 'auto',
          }}>
            <span style={{ fontWeight: 600 }}>{BRAND.helpdeskLabel}:</span>{' '}
            <a
              href={`mailto:${BRAND.helpdeskEmail}`}
              style={{ fontWeight: 600, textDecoration: 'underline' }}
            >
              {BRAND.helpdeskEmail}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
