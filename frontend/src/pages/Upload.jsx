import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useTheme } from '../context/ThemeContext.jsx';
import { LIGHT_COLORS, DARK_COLORS } from '../context/themeColors.js';
import { BRAND } from '../config/brand.js';

const MAX_TITLE_LEN = 200;
const MAX_CONTENT_LEN = 200000; // ~200k chars, comfortably below edge-function compute limits
const MAX_PDF_MB = 8;

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function Upload() {
  const [mode, setMode] = useState('text');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [pdfFile, setPdfFile] = useState(null);
  const [status, setStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { theme } = useTheme();
  const A = theme === 'dark' ? DARK_COLORS : LIGHT_COLORS;

  const isError = status.startsWith('Error');
  const isDone = status.startsWith('Done');

  const tabStyle = (active) => ({
    flex: 1,
    padding: '8px 0',
    border: `1px solid ${active ? A.primary : A.border}`,
    borderRadius: 8,
    background: active ? A.activeBg : A.surface,
    color: active ? A.primary : A.muted,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  });

  const inputStyle = {
    width: '100%',
    padding: '10px 12px',
    border: `1px solid ${A.border}`,
    borderRadius: 8,
    fontSize: 14,
    color: A.text,
    background: A.surface,
    outline: 'none',
    boxSizing: 'border-box',
  };

  const validate = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return 'Title is required.';
    if (trimmedTitle.length > MAX_TITLE_LEN) return `Title must be under ${MAX_TITLE_LEN} characters.`;

    if (mode === 'text') {
      const trimmedContent = content.trim();
      if (!trimmedContent) return 'Document text is required.';
      if (trimmedContent.length > MAX_CONTENT_LEN) return `Document text is too long (max ${MAX_CONTENT_LEN.toLocaleString()} characters).`;
    } else {
      if (!pdfFile) return 'Please select a PDF file.';
      if (pdfFile.type !== 'application/pdf') return 'Only PDF files are allowed.';
      const sizeMB = pdfFile.size / (1024 * 1024);
      if (sizeMB > MAX_PDF_MB) return `PDF is too large (max ${MAX_PDF_MB}MB). Large books/manuals aren't supported yet.`;
    }
    return '';
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setStatus(`Error: ${validationError}`);
      return;
    }

    setStatus('Uploading...');
    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();

      const body = { title: title.trim() };
      if (mode === 'pdf') {
        body.pdfBase64 = await fileToBase64(pdfFile);
      } else {
        body.content = content.trim();
      }

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ingest`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(body),
        }
      );
      const data = await res.json();
      if (!res.ok) { setStatus(`Error: ${data.error || 'Upload failed. Please try again.'}`); return; }
      setStatus(`Done! Stored ${data.chunksStored} chunks.`);
      setTitle(''); setContent(''); setPdfFile(null);
    } catch (err) {
      setStatus('Error: Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: A.bg,
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      padding: 20,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '14px 24px', background: A.surface, borderBottom: `1px solid ${A.border}`,
        marginBottom: 40,
      }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: A.heading }}>
          {BRAND.name}
        </div>
        <Link
          to="/"
          style={{ fontSize: 12.5, color: A.primary, fontWeight: 600, textDecoration: 'none' }}
        >
          ← Back to Home
        </Link>
      </div>

      <div style={{
        width: '100%',
        maxWidth: 500,
        margin: '0 auto',
        background: A.surface,
        borderRadius: 12,
        padding: '32px 32px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 8px 24px rgba(15,110,125,0.08)',
        border: `1px solid ${A.border}`,
      }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700, color: A.text }}>
          Upload Document
        </h2>
        <p style={{ margin: '0 0 20px', fontSize: 13, color: A.muted }}>
          Optional: add internal docs, code, or notes here to give the assistant extra context on IT/CSE-specific things. Not required — the assistant can already answer general and technical questions without any upload.
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          <button type="button" onClick={() => setMode('text')} style={tabStyle(mode === 'text')}>
            Paste Text
          </button>
          <button type="button" onClick={() => setMode('pdf')} style={tabStyle(mode === 'pdf')}>
            Upload PDF
          </button>
        </div>

        <form onSubmit={handleUpload}>
          <label style={{ display: 'block', fontSize: 12, color: A.muted, marginBottom: 4 }}>
            Title
          </label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. IT Onboarding Guide"
            maxLength={MAX_TITLE_LEN}
            style={inputStyle}
          />

          {mode === 'text' ? (
            <>
              <label style={{ display: 'block', fontSize: 12, color: A.muted, margin: '14px 0 4px' }}>
                Document text
              </label>
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder="Paste document text"
                rows={10}
                maxLength={MAX_CONTENT_LEN}
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
              />
              <p style={{ marginTop: 4, fontSize: 11, color: A.muted, textAlign: 'right' }}>
                {content.length.toLocaleString()} / {MAX_CONTENT_LEN.toLocaleString()}
              </p>
            </>
          ) : (
            <>
              <label style={{ display: 'block', fontSize: 12, color: A.muted, margin: '14px 0 4px' }}>
                PDF file (max {MAX_PDF_MB}MB)
              </label>
              <input
                type="file"
                accept="application/pdf"
                onChange={e => setPdfFile(e.target.files?.[0] ?? null)}
                style={{ ...inputStyle, padding: '8px 12px' }}
              />
              {pdfFile && (
                <p style={{ marginTop: 6, fontSize: 12, color: A.muted }}>
                  Selected: {pdfFile.name} ({(pdfFile.size / (1024 * 1024)).toFixed(2)} MB)
                </p>
              )}
            </>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%', marginTop: 20, padding: '11px 0', border: 'none',
              borderRadius: 8, background: submitting ? A.disabled : A.primary,
              color: '#fff', fontWeight: 600, fontSize: 14,
              cursor: submitting ? 'default' : 'pointer',
            }}
          >
            {submitting ? 'Uploading…' : 'Upload'}
          </button>
        </form>

        {status && (
          <div style={{
            marginTop: 16, padding: '10px 12px', borderRadius: 8,
            background: isError ? A.warningBg : isDone ? A.successBg : A.hoverBg,
            border: `1px solid ${isError ? A.warningBorder : isDone ? A.successBorder : A.border}`,
            color: isError ? A.warning : isDone ? A.success : A.muted,
            fontSize: 12.5,
          }}>
            {status}
          </div>
        )}
      </div>
    </div>
  );
}
