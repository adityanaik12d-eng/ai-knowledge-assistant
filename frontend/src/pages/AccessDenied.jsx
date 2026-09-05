import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function AccessDenied() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#F7F8FA',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      padding: 20,
    }}>
      <div style={{
        width: '100%',
        maxWidth: 420,
        background: '#FFFFFF',
        borderRadius: 12,
        padding: '36px 32px',
        textAlign: 'center',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 8px 24px rgba(15,110,125,0.08)',
        border: '1px solid #E3EEEF',
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12, background: '#FEF3E7',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 18px', fontSize: 22,
        }}>
          🔒
        </div>
        <h2 style={{ margin: '0 0 8px', fontSize: 18, color: '#0F2A2E' }}>
          This tool is for IT/CSE department only
        </h2>
        <p style={{ margin: '0 0 20px', fontSize: 13.5, color: '#6B7280' }}>
          Your account ({user?.email}) doesn't have access. If you believe this is a mistake, contact your IT/CSE admin.
        </p>
        <button
          onClick={handleLogout}
          style={{
            padding: '10px 20px', borderRadius: 8, border: 'none',
            background: '#0F6E7D', color: '#fff', fontSize: 13.5, fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Log out
        </button>
      </div>
    </div>
  );
}