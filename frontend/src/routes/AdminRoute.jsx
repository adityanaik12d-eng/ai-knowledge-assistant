import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export function AdminRoute({ children }) {
  const { user, isAdmin, isITCSE, loading } = useAuth();

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#F7F8FA', color: '#6B7280', fontFamily: 'Inter, system-ui, sans-serif', fontSize: 14,
      }}>
        Loading…
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (!isITCSE) return <Navigate to="/access-denied" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;

  return children;
}