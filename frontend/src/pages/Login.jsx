import React, { useState, useEffect } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { LIGHT_COLORS, DARK_COLORS } from '../context/themeColors.js';
import { BRAND } from '../config/brand.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 60;

export default function Login() {
  const { user, loading, signIn, signUp, resetPassword } = useAuth();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const A = theme === 'dark' ? DARK_COLORS : LIGHT_COLORS;

  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!lockedUntil) return;
    const tick = () => {
      const remaining = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        setLockedUntil(null);
        setAttempts(0);
        setSecondsLeft(0);
      } else {
        setSecondsLeft(remaining);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockedUntil]);

  if (!loading && user) {
    return <Navigate to="/" replace />;
  }

  const isLocked = !!lockedUntil && secondsLeft > 0;

  const inputStyle = {
    width: '100%',
    padding: '10px 12px',
    border: `1px solid ${A.border}`,
    borderRadius: 8,
    fontSize: 14,
    color: A.text,
    background: A.surface,
    fontFamily: 'inherit',
    outline: 'none',
    boxSizing: 'border-box',
  };

  const linkButtonStyle = {
    background: 'none',
    border: 'none',
    padding: 0,
    color: A.primary,
    fontWeight: 600,
    fontSize: 11,
    cursor: 'pointer',
    textDecoration: 'underline',
  };

  const validate = () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !EMAIL_RE.test(trimmedEmail)) {
      return 'Please enter a valid email address.';
    }
    if (mode === 'forgot') return '';
    if (!password) {
      return 'Please enter your password.';
    }
    if (mode === 'signup' && password.length < 8) {
      return 'Password must be at least 8 characters.';
    }
    return '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');

    if (isLocked) {
      setError(`Too many failed attempts. Try again in ${secondsLeft}s.`);
      return;
    }

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'forgot') {
        const { error: resetError } = await resetPassword(email.trim());
        if (resetError) {
          setError('Could not send reset email. Please try again.');
          return;
        }
        setInfo('If that email is registered, a reset link has been sent. Check your inbox.');
        return;
      }

      if (mode === 'signin') {
        const { error: signInError } = await signIn(email.trim(), password);
        if (signInError) {
          const nextAttempts = attempts + 1;
          setAttempts(nextAttempts);
          if (nextAttempts >= MAX_ATTEMPTS) {
            setLockedUntil(Date.now() + LOCKOUT_SECONDS * 1000);
            setError(`Too many failed attempts. Try again in ${LOCKOUT_SECONDS}s.`);
          } else {
            setError('Invalid email or password.');
          }
          return;
        }
        setAttempts(0);
        navigate('/');
      } else {
        const { error: signUpError } = await signUp(email.trim(), password);
        if (signUpError) {
          setError('Could not create account. Please try again.');
          return;
        }
        setInfo('Account created. Check your email to confirm, then sign in.');
        setMode('signin');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const titleText = mode === 'forgot' ? 'Reset your password' : mode === 'signup' ? 'Create your account' : 'Sign in with your company email';

  return (
    <div style={{
      minHeight: '100vh',
      background: A.bg,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      padding: 20,
    }}>
      <div style={{
        width: '100%',
        maxWidth: 380,
        background: A.surface,
        borderRadius: 12,
        padding: '36px 32px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 8px 24px rgba(15,110,125,0.08)',
        border: `1px solid ${A.border}`,
      }}>
        <div style={{ marginBottom: 28, textAlign: 'center' }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10, background: A.primary,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 14px', color: '#fff', fontSize: 20, fontWeight: 700,
          }}>
            {BRAND.name.slice(0, 1)}
          </div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: A.text }}>
            {BRAND.name}
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 11, color: A.muted, lineHeight: 1.5 }}>
            {titleText}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <label style={{ display: 'block', fontSize: 11, color: A.muted, marginBottom: 4 }}>
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            autoComplete="email"
            disabled={isLocked}
            style={inputStyle}
          />

          {mode !== 'forgot' && (
            <>
              <label style={{ display: 'block', fontSize: 11, color: A.muted, margin: '14px 0 4px' }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  disabled={isLocked}
                  style={{ ...inputStyle, paddingRight: 44 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  tabIndex={-1}
                  style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 11.5, fontWeight: 600, color: A.primary, padding: 4,
                  }}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </>
          )}

          {mode === 'signin' && (
            <div style={{ textAlign: 'right', marginTop: 8 }}>
              <button
                type="button"
                onClick={() => { setMode('forgot'); setError(''); setInfo(''); }}
                style={linkButtonStyle}
              >
                Forgot password?
              </button>
            </div>
          )}

          {error && (
            <div style={{
              marginTop: 14, padding: '10px 12px', borderRadius: 8,
              background: A.warningBg, border: `1px solid ${A.warningBorder}`,
              color: A.warning, fontSize: 12.5,
            }}>
              {error}
            </div>
          )}

          {info && (
            <div style={{
              marginTop: 14, padding: '10px 12px', borderRadius: 8,
              background: A.successBg, border: `1px solid ${A.successBorder}`,
              color: A.success, fontSize: 12.5,
            }}>
              {info}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || isLocked}
            style={{
              width: '100%', marginTop: 20, padding: '11px 0', border: 'none',
              borderRadius: 8, background: (submitting || isLocked) ? A.disabled : A.primary,
              color: '#fff', fontWeight: 600, fontSize: 14,
              cursor: (submitting || isLocked) ? 'default' : 'pointer',
            }}
          >
            {isLocked ? `Locked (${secondsLeft}s)` : submitting ? 'Please wait…' : mode === 'forgot' ? 'Send reset link' : mode === 'signup' ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        <div style={{ marginTop: 18, textAlign: 'center', fontSize: 11, color: A.muted, lineHeight: 1.5 }}>
          {mode === 'signin' && (
            <>
              New here?{' '}
              <button type="button" onClick={() => { setMode('signup'); setError(''); setInfo(''); }} style={linkButtonStyle}>
                Create an account
              </button>
            </>
          )}
          {mode === 'signup' && (
            <>
              Already have an account?{' '}
              <button type="button" onClick={() => { setMode('signin'); setError(''); setInfo(''); }} style={linkButtonStyle}>
                Sign in
              </button>
            </>
          )}
          {mode === 'forgot' && (
            <>
              Remembered it?{' '}
              <button type="button" onClick={() => { setMode('signin'); setError(''); setInfo(''); }} style={linkButtonStyle}>
                Back to sign in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
