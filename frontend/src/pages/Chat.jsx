import React, { useState, useRef, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { supabase } from '../lib/supabase.js';
import { useTheme } from '../context/ThemeContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { BRAND } from '../config/brand.js';

const COLORS = {
  primary: '#0F6E7D',
  bg: '#F7F8FA',
  surface: '#FFFFFF',
  text: '#1A1F24',
  muted: '#6B7280',
  warning: '#D97706',
  success: '#2E8B57',
  border: '#E3EEEF',
  inlineCodeBg: '#F0F4F5',
  codeBlockBg: '#0F2A2E',
  codeBlockText: '#E8F4F5',
  activeItemBg: '#EAF3F4',
  hoverBg: '#F0F4F5',
  sourceBg: '#EAF3F4',
  successBg: '#EAF6F0',
  warningBg: '#FEF3E7',
  warningBorder: '#F5D9AE',
  disabled: '#7FA9AF',
  brand: '#0F2A2E',
};

const DARK_COLORS = {
  primary: '#22A7B3',
  bg: '#0F1416',
  surface: '#1A2226',
  text: '#E8EDEE',
  muted: '#8A9BA0',
  warning: '#F59E0B',
  success: '#34D399',
  border: '#2A3438',
  inlineCodeBg: '#232D32',
  codeBlockBg: '#0D1117',
  codeBlockText: '#C9D1D9',
  activeItemBg: '#16282C',
  hoverBg: '#222D32',
  sourceBg: '#16282C',
  successBg: '#0D2818',
  warningBg: '#3D2200',
  warningBorder: '#5C3A00',
  disabled: '#3A4A4E',
  brand: '#E8EDEE',
};

const MAX_HISTORY_TURNS = 40;
const MAX_FILE_SIZE_MB = 8;

const loadCashfreeSdk = () => new Promise((resolve, reject) => {
  if (typeof window === 'undefined') return reject(new Error('No window'));
  if (window.Cashfree) return resolve(window.Cashfree);
  const existing = document.querySelector('script[data-cashfree-sdk]');
  if (existing) {
    existing.addEventListener('load', () => resolve(window.Cashfree));
    existing.addEventListener('error', () => reject(new Error('Could not load payment SDK.')));
    return;
  }
  const s = document.createElement('script');
  s.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';
  s.async = true;
  s.setAttribute('data-cashfree-sdk', '1');
  s.onload = () => resolve(window.Cashfree);
  s.onerror = () => reject(new Error('Could not load payment SDK.'));
  document.head.appendChild(s);
});

const clearCashfreeModal = () => {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('iframe[src*="cashfree"]').forEach((el) => el.remove());
  document.querySelectorAll('[id*="cf-checkout"], [id*="cashfree"], [class*="cf-checkout"], [class*="cashfree-modal"], [class*="cashfree__"]').forEach((el) => el.remove());
};

const getSourceText = (s) => {
  const raw = s?.text || s?.chunk || s?.content || s?.excerpt || s?.snippet || '';
  return raw
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/[*_#`>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const CodeBlock = ({ children, activeColor }) => {
  const [copied, setCopied] = useState(false);
  const codeText = String(children || '').replace(/\n$/, '');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codeText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) { /* ignore */ }
  };
  return (
    <div style={{ position: 'relative', margin: '8px 0', maxWidth: '100%' }}>
      <button
        onClick={copy}
        title="Copy code"
        style={{
          position: 'absolute', top: 8, right: 8,
          background: copied ? activeColor.successBg : 'rgba(0,0,0,0.35)',
          border: 'none', borderRadius: 6,
          color: copied ? activeColor.success : '#fff',
          fontSize: 11, cursor: 'pointer', padding: '3px 8px', lineHeight: 1.2,
          fontFamily: 'inherit', zIndex: 2,
        }}
      >
        {copied ? '✓ Copied' : '⧉ Copy'}
      </button>
      <pre style={{
        background: activeColor.codeBlockBg, color: activeColor.codeBlockText, padding: '12px 14px', borderRadius: 8,
        overflowX: 'auto', fontSize: 12.5, fontFamily: 'Consolas, Monaco, monospace',
        margin: 0, lineHeight: 1.5,
      }}>
        <code>{children}</code>
      </pre>
    </div>
  );
};

const Markdown = React.memo(function Markdown({ children, activeColor }) {
  return (
    <div style={{ fontSize: 14, lineHeight: 1.6, color: activeColor.text, overflowWrap: 'break-word', wordBreak: 'break-word' }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <div style={{ margin: '0 0 8px' }}>{children}</div>,
          ul: ({ children }) => <ul style={{ margin: '0 0 8px', paddingLeft: 20 }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ margin: '0 0 8px', paddingLeft: 20 }}>{children}</ol>,
          li: ({ children }) => <li style={{ marginBottom: 3 }}>{children}</li>,
          strong: ({ children }) => <strong style={{ color: activeColor.text }}>{children}</strong>,
          code: ({ inline, children }) =>
            inline ? (
              <code style={{
                background: activeColor.inlineCodeBg, padding: '2px 5px', borderRadius: 4,
                fontSize: 12.5, fontFamily: 'Consolas, Monaco, monospace', color: activeColor.primary,
              }}>
                {children}
              </code>
            ) : (
              <CodeBlock activeColor={activeColor}>{children}</CodeBlock>
            ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});

export default function Chat() {
  const { theme, toggleTheme } = useTheme();
  const { role, refreshProfile, user, premiumExpiresAt, signOut, updatePassword } = useAuth();
  const location = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [pwMsg, setPwMsg] = useState(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradePlan, setUpgradePlan] = useState('monthly');
  const [upgradeBusy, setUpgradeBusy] = useState(false);
  const [upgradeError, setUpgradeError] = useState('');
  const [upgradePhone, setUpgradePhone] = useState('');
  const speechSupported = ('webkitSpeechRecognition' in window) || ('SpeechRecognition' in window);
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024);
  const [sidebarHoverId, setSidebarHoverId] = useState(null); // For hover state of conversation items
  const [projects, setProjects] = useState([]); // List of projects
  const [activeProjectFilter, setActiveProjectFilter] = useState(null); // Currently selected project filter (null = show all)
  const [fileButtonHover, setFileButtonHover] = useState(false); // For file attachment button hover
  const [micButtonHover, setMicButtonHover] = useState(false); // For microphone button hover
  const [openMenuId, setOpenMenuId] = useState(null); // For three-dot menu
  const [moveSubmenuId, setMoveSubmenuId] = useState(null); // For move to project submenu
  const [submenuPosition, setSubmenuPosition] = useState({ top: 0, left: 0 }); // For submenu positioning
  const [confirmDeleteId, setConfirmDeleteId] = useState(null); // FIX 2: For conversation deletion confirmation
  const [hoveredMenuItem, setHoveredMenuItem] = useState(null); // FIX 3: For dropdown menu item hover
  const [viewportWidth, setViewportWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024);
  const [copiedId, setCopiedId] = useState(null);
  const [speakingId, setSpeakingId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pinnedIds, setPinnedIds] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('pinnedConversations') || '[]');
    } catch {
      return [];
    }
  });
  const [previewSource, setPreviewSource] = useState(null);
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const messagesContainerRef = useRef(null); // For auto-scroll functionality
  const abortControllerRef = useRef(null);
  const speechRef = useRef(null); // For SpeechRecognition instance
  const [isListening, setIsListening] = useState(false); // Mic button state
  const forceScrollToBottomRef = useRef(false);

  const A = theme === 'dark' ? DARK_COLORS : COLORS;

  useEffect(() => {
    if (location.state?.openUpgrade) {
      setUpgradePlan('monthly');
      setUpgradeError('');
      setShowUpgrade(true);
      setSettingsOpen(false);
      window.history.replaceState({}, document.title);
    }
    if (location.state?.openSettings) {
      setSettingsOpen(true);
      setShowUpgrade(false);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const handleResize = () => {
        const width = window.innerWidth;
        setViewportWidth(width);
        if (width < 1024) setSidebarOpen(false);
      };
      window.addEventListener('resize', handleResize);
      // Set initial value
      setViewportWidth(window.innerWidth);
      return () => window.removeEventListener('resize', handleResize);
    }
  }, []);

  // Close menus when clicking outside
  useEffect(() => {
    if (openMenuId !== null || moveSubmenuId !== null) {
      const handleClickOutside = (event) => {
        // Check if click is outside both menus
        const isOutsideMenu = !openMenuId || !document.getElementById(`menu-${openMenuId}`)?.contains(event.target);
        const isOutsideSubmenu = !moveSubmenuId || !document.getElementById(`submenu-${moveSubmenuId}`)?.contains(event.target);

        if (isOutsideMenu && isOutsideSubmenu) {
          setOpenMenuId(null);
          setMoveSubmenuId(null);
          setConfirmDeleteId(null); // FIX 2: Also reset deletion confirmation when clicking outside
        }
      };

      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [openMenuId, moveSubmenuId, confirmDeleteId]);

  useEffect(() => {
    loadProjects();
    loadConversations(activeProjectFilter);
  }, [activeProjectFilter]);

  // Auto-resize textarea on input
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const newHeight = Math.min(textareaRef.current.scrollHeight, 200);
      textareaRef.current.style.height = newHeight + 'px';
      // If content exceeds 200px, make it scrollable internally
      if (textareaRef.current.scrollHeight > 200) {
        textareaRef.current.style.overflowY = 'auto';
      } else {
        textareaRef.current.style.overflowY = 'hidden';
      }
    }
  }, [input]);

  // Reset textarea height after sending a message
  useEffect(() => {
    if (!sending && textareaRef.current && input.trim() === '') {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = (textareaRef.current.scrollHeight) + 'px';
      textareaRef.current.style.overflowY = 'hidden';
    }
  }, [sending, input]);

  // Auto-scroll to bottom when user is near bottom and new messages arrive
  useEffect(() => {
    if (messagesContainerRef.current) {
      const container = messagesContainerRef.current;
      if (forceScrollToBottomRef.current) {
        container.scrollTop = container.scrollHeight;
        forceScrollToBottomRef.current = false;
      } else {
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
        // Only auto-scroll if user is near bottom or if this is the first render of a new message
        if (isNearBottom || messages.length === 0) {
          container.scrollTop = container.scrollHeight;
        }
      }
    }
  }, [messages]);


  const loadProjects = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setProjects([]);
        return;
      }
      const { data, error } = await supabase.from('projects').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
      if (error) throw error;
      setProjects(data);
    } catch (err) {
      console.error('Error loading projects:', err);
    }
  };

  const loadConversations = async (projectId = null) => {
    setLoadingConversations(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setConversations([]);
        return;
      }
      let query = supabase.from('conversations').select('*').eq('user_id', user.id).order('updated_at', { ascending: false });

      if (projectId !== null) {
        query = query.eq('project_id', projectId);
      }

      const { data, error } = await query;
      if (error) throw error;
      setConversations(data);
      // Auto-select the most recent conversation if none is active
      if (activeConversationId === null && data.length > 0) {
        setActiveConversationId(data[0].id);
        forceScrollToBottomRef.current = true;
        loadConversationMessages(data[0].id);
      }
    } catch (err) {
      console.error('Error loading conversations:', err);
    } finally {
      setLoadingConversations(false);
    }
  };

  const loadConversationMessages = async (conversationId) => {
    setLoadingMessages(true);
    try {
      const { data, error } = await supabase.from('messages').select('*').eq('conversation_id', conversationId).order('created_at', { ascending: true });
      if (error) throw error;
      // Transform database rows to match component's expected shape.
      // Skip empty assistant messages (saved during rate-limit/abort edge cases)
      // so they never reappear as a stuck "Thinking…" bubble after a refresh.
      const transformedMessages = data
        .filter(m => m.role !== 'assistant' || (m.content && m.content.trim()))
        .map(msg => ({
        role: msg.role,
        text: msg.content,
        sources: msg.sources || []
      }));
      setMessages(transformedMessages);
    } catch (err) {
      console.error('Error loading messages:', err);
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleNewConversation = () => {
    setActiveConversationId(null);
    setSidebarOpen(false);
    setMessages([]);
    setInput('');
    setError('');
    // Reset upload states when starting new conversation
    setUploading(false);
    setUploadError('');
    setUploadSuccess(null);
  };

  const handleSelectConversation = (id) => {
    setActiveConversationId(id);
    setSidebarOpen(false);
    forceScrollToBottomRef.current = true;
    loadConversationMessages(id);
    // Reset upload states when switching conversations
    setUploading(false);
    setUploadError('');
    setUploadSuccess(null);
  };

  const togglePin = (id) => {
    setPinnedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id];
      try {
        localStorage.setItem('pinnedConversations', JSON.stringify(next));
      } catch (e) { /* ignore storage errors */ }
      return next;
    });
  };

  const copyMessage = async (idx, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(idx);
      setTimeout(() => setCopiedId((prev) => (prev === idx ? null : prev)), 1500);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  const speakMessage = (idx, text) => {
    if (!('speechSynthesis' in window)) return;
    if (speakingId === idx) {
      window.speechSynthesis.cancel();
      setSpeakingId(null);
      return;
    }
    window.speechSynthesis.cancel();
    const plain = String(text || '')
      .replace(/```[a-z]*\n?/gi, '')
      .replace(/\n/g, ' ')
      .replace(/[*_#`>~\[\]|]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!plain) return;
    const u = new SpeechSynthesisUtterance(plain);
    u.lang = 'en-US';
    u.rate = 1;
    u.pitch = 1;
    u.onend = () => setSpeakingId(null);
    u.onerror = () => setSpeakingId(null);
    setSpeakingId(idx);
    window.speechSynthesis.speak(u);
  };

  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const handleEditMessage = (idx) => {
    const text = messages[idx]?.text || '';
    setInput(text);
    setMessages((prev) => prev.slice(0, idx));
    setError('');
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const persistPinned = (ids) => {
    try {
      localStorage.setItem('pinnedConversations', JSON.stringify(ids));
    } catch (e) { /* ignore storage errors */ }
  };

  const readFileBase64 = async (file) => {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    return dataUrl.split(',')[1];
  };

  const uploadOne = async (file) => {
    // Validate file
    if (!file) {
      throw new Error('No file selected');
    }

    if (file.size === 0) {
      throw new Error('File is empty');
    }

    const fileSizeMB = file.size / (1024 * 1024);
    if (fileSizeMB > MAX_FILE_SIZE_MB) {
      throw new Error(`File too large (max ${MAX_FILE_SIZE_MB}MB)`);
    }

    // FIXED: Get access token from session (same as handleSend)
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('No session');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('No user');

    const nameLower = file.name.toLowerCase();
    const dot = nameLower.lastIndexOf('.');
    const ext = dot >= 0 ? nameLower.slice(dot) : '';
    const allowedTextExtensions = ['.txt', '.md', '.markdown', '.json', '.js', '.jsx', '.ts', '.tsx', '.css', '.html', '.py', '.java', '.c', '.cpp', '.cs', '.go', '.rb', '.php', '.sql', '.yaml', '.yml', '.sh', '.xml', '.csv'];
    const isTextFile = allowedTextExtensions.some(e => nameLower.endsWith(e));
    const isPdfFile = file.type === 'application/pdf' || nameLower.endsWith('.pdf');
    const isImageFile = /\.(png|jpe?g|gif|webp|bmp)$/.test(nameLower) || file.type.startsWith('image/');
    const isOfficeFile = ext === '.docx' || ext === '.pptx' || ext === '.xlsx';

    const body = { title: file.name, fileName: file.name, mime: file.type || undefined };

    if (isTextFile) {
      // Read as text
      const content = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.trim());
        reader.onerror = reject;
        reader.readAsText(file);
      });
      body.content = content;
    } else if (isPdfFile) {
      // Read as base64
      body.pdfBase64 = await readFileBase64(file);
    } else if (isImageFile) {
      body.imageBase64 = await readFileBase64(file);
    } else if (isOfficeFile) {
      body.officeBase64 = await readFileBase64(file);
    } else {
      throw new Error('unsupported file type (text, PDF, images, DOCX/PPTX/XLSX)');
    }

    // Upload to knowledge base
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
    if (!res.ok) {
      throw new Error(data.error || 'Upload failed');
    }

    return {
      name: file.name,
      chunksStored: data.chunksStored ?? 0,
      url: data.url,
      mime: data.mime,
      kind: data.kind,
    };
  };

  const handleFileUpload = async (files) => {
    const list = Array.from(files || []);
    if (list.length === 0) return;

    // Reset previous upload states
    setUploading(true);
    setUploadError('');
    setUploadSuccess(null);

    // Add uploading message to chat
    const uploadMessageId = `upload-${Date.now()}`;
    const label = list.length === 1 ? list[0].name : `${list.length} files`;
    setMessages(prev => [
      ...prev,
      {
        id: uploadMessageId,
        role: 'system',
        text: `📄 Uploading ${label}...`,
        type: 'uploading',
        fileName: list.length === 1 ? list[0].name : undefined
      }
    ]);

    const ok = [];
    const failed = [];

    try {
      for (let i = 0; i < list.length; i++) {
        const file = list[i];
        setMessages(prev => prev.map(m => (
          m.id === uploadMessageId
            ? { ...m, text: `📄 Uploading ${file.name} (${i + 1}/${list.length})...` }
            : m
        )));
        try {
          const result = await uploadOne(file);
          ok.push(result);
        } catch (err) {
          console.error('Upload error:', err);
          failed.push({ name: file.name, error: err.message });
        }
      }
    } finally {
      setUploading(false);
      // Clear file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }

    // Summarize results
    const summary = [];
    if (ok.length === 1) {
      summary.push(`✅ Added ${ok[0].name} to the knowledge base (${ok[0].chunksStored} chunks).`);
    } else if (ok.length > 1) {
      summary.push(`✅ Added ${ok.length} files to the knowledge base.`);
    }
    if (failed.length) {
      summary.push(`⚠️ Couldn't add ${failed.length} file(s): ${failed.map(f => `${f.name} (${f.error})`).join(', ')}`);
    }

    setMessages(prev => [
      ...prev.filter(msg => msg.id !== uploadMessageId),
      {
        id: uploadMessageId,
        role: 'system',
        text: summary.join('\n') || 'Upload finished.',
        type: ok.length > 0 ? 'success' : 'error',
        fileName: list.length === 1 ? list[0].name : undefined,
        url: ok.length === 1 ? ok[0].url : undefined,
        mime: ok.length === 1 ? ok[0].mime : undefined,
        kind: ok.length === 1 ? ok[0].kind : undefined,
      }
    ]);

    if (ok.length) {
      // Also add an assistant message for conversation history
      const names = ok.length === 1 ? `"${ok[0].name}"` : `${ok.length} files`;
      const pronoun = ok.length === 1 ? 'its' : 'their';
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          text: `I've added ${names} to the knowledge base (${ok.reduce((acc, r) => acc + r.chunksStored, 0)} chunk(s) total). You can ask me anything about ${pronoun} contents and I'll search it.`
        }
      ]);
      setUploadSuccess({ chunksStored: ok.reduce((acc, r) => acc + r.chunksStored, 0) });
    } else {
      setUploadError(failed.map(f => `${f.name}: ${f.error}`).join(', '));
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    const question = input.trim();
    if (!question || sending) return;
    await submitQuestion(question);
  };

  const submitQuestion = async (question) => {
    setError('');
    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-MAX_HISTORY_TURNS)
      .map((m) => ({ role: m.role, content: m.text }));

    // Optimistically add user message to UI
    setMessages((prev) => [...prev, { role: 'user', text: question }]);
    setInput('');
    setSending(true);

    // If this is a new conversation (not yet persisted), create it first
    let conversationId = activeConversationId;
    if (!conversationId) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('No user');
        const title = question.length > 40 ? question.slice(0, 40) + '...' : question;
        const { data, error } = await supabase.from('conversations').insert([
            { user_id: user.id, title },
          ]).select();
        if (error) throw error;
        conversationId = data[0].id;
        setActiveConversationId(conversationId);
        // Add new conversation to the list at the top
        setConversations((prev) => [
          { id: conversationId, user_id: user.id, title, created_at: new Date(), updated_at: new Date() },
          ...prev.filter((c) => c.id !== conversationId),
        ]);
      } catch (err) {
        console.error('Error creating conversation:', err);
        setMessages((prev) => {
          const next = [...prev];
          next.pop(); // Remove the optimistic user message
          return next;
        });
        setError('Failed to start conversation. Please try again.');
        setSending(false);
        return;
      }
    }

    // Save user message to DB
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('messages').insert([
        {
          conversation_id: conversationId,
          user_id: user.id,
          role: 'user',
          content: question,
        }
      ]);
      // Update conversation's updated_at
      await supabase.from('conversations').update({ updated_at: new Date() }).eq('id', conversationId);
    } catch (err) {
      console.error('Error saving user message:', err);
      // We'll still proceed with the chat, but note that persistence might fail
    }

    const assistantIndex = messages.length + 1; // +1 for the user message we just added
    await runStream(question, history, assistantIndex, conversationId);
  };

  const handleRegenerate = async () => {
    if (sending) return;
    let lastIdx = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') { lastIdx = i; break; }
    }
    if (lastIdx === -1) return;
    const lastQuestion = messages[lastIdx].text;
    const trimmed = messages.slice(0, lastIdx + 1);
    const history = trimmed
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-MAX_HISTORY_TURNS)
      .map((m) => ({ role: m.role, content: m.text }));
    setMessages(trimmed);
    setError('');
    await runStream(lastQuestion, history, trimmed.length, activeConversationId);
  };

  const runStream = async (question, history, assistantIndex, conversationId) => {
    setSending(true);
    // Initialize abort controller for this request
    abortControllerRef.current = new AbortController();
    setMessages((prev) => {
      const next = [...prev];
      next[assistantIndex] = { role: 'assistant', text: '', sources: [] };
      return next;
    });

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ question, history }),
          signal: abortControllerRef.current.signal,
        }
      );

      if (!res.ok || !res.body) {
        let errMsg = 'Something went wrong.';
        let resetAt = null;
        try {
          const data = await res.json();
          errMsg = data.error || errMsg;
          resetAt = data.resetAt || null;
        } catch (e) {}
        if (resetAt) {
          errMsg = `${errMsg} (Your limit resets at ${new Date(resetAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})`;
        }
        setMessages((prev) => {
          const next = [...prev];
          next[assistantIndex] = { role: 'error', text: errMsg };
          return next;
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedText = '';
      let sources = [];
      let streamHadError = false;

      try {
        await Promise.race([
          (async () => {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (!line.trim()) continue;
                let evt;
                try{ evt = JSON.parse(line); } catch { continue; }

                if (evt.type === 'sources') {
                  sources = evt.sources;
                  setMessages((prev) => {
                    const next = [...prev];
                    next[assistantIndex] = { ...next[assistantIndex], sources };
                    return next;
                  });
                } else if (evt.type === 'token') {
                  accumulatedText += evt.text;
                  setMessages((prev) => {
                    const next = [...prev];
                    next[assistantIndex] = { ...next[assistantIndex], text: accumulatedText };
                    return next;
                  });
                } else if (evt.type === 'error') {
                  streamHadError = true;
                  setMessages((prev) => {
                    const next = [...prev];
                    let text = evt.error;
                    if (evt.resetAt) {
                      text = `${text} (Your limit resets at ${new Date(evt.resetAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})`;
                    }
                    next[assistantIndex] = { role: 'error', text };
                    return next;
                  });
                }
              }
            }
          })(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Stream timeout')), 35000)
          )
        ]);

        // Empty streamed response (e.g. provider returned nothing): drop the
        // "Thinking…" placeholder instead of persisting an empty assistant row.
        // Keep any error bubble that was already shown during the stream.
        if (!accumulatedText.trim() && !streamHadError) {
          setMessages(prev => prev.slice(0, assistantIndex));
          return;
        }

        // Save assistant message to DB after streaming completes
        try {
          const { data: { user } } = await supabase.auth.getUser();
          await supabase.from('messages').insert([
            {
              conversation_id: conversationId,
              user_id: user.id,
              role: 'assistant',
              content: accumulatedText,
              sources: sources,
            }
          ]);
          // Update conversation's updated_at
          await supabase.from('conversations').update({ updated_at: new Date() }).eq('id', conversationId);
          // Refresh conversations list to update ordering
          loadConversations();
        } catch (err) {
          console.error('Error saving assistant message:', err);
        }
      } catch (err) {
        if (err.message === 'Stream timeout') {
          // Timeout occurred
          try {
            await reader.cancel();
          } finally {
            setMessages((prev) => {
              const next = [...prev];
              next[assistantIndex] = { role: 'error', text: 'The response took too long. Please try again.' };
              return next;
            });
          }
        } else if (err.name === 'AbortError') {
          // If the error is due to abort, treat as user-initiated stop (no error message)
          if (accumulatedText.trim()) {
            // Save partial message as final
            try {
              const { data: { user } } = await supabase.auth.getUser();
              await supabase.from('messages').insert([
                {
                  conversation_id: conversationId,
                  user_id: user.id,
                  role: 'assistant',
                  content: accumulatedText,
                  sources: sources,
                }
              ]);
              // Update conversation's updated_at
              await supabase
                .from('conversations')
                .update({ updated_at: new Date() })
                .eq('id', conversationId);
              // Refresh conversations list to update ordering
              loadConversations();
            } catch (saveErr) {
              console.error('Error saving assistant message after abort:', saveErr);
            }
          } else {
            // Stopped before any text: remove the "Thinking…" placeholder
            setMessages(prev => prev.slice(0, assistantIndex));
          }
        } else {
          // Other error (network, etc.)
          setMessages((prev) => {
            const next = [...prev];
            next[assistantIndex] = { role: 'error', text: 'Network error. Please try again.' };
            return next;
          });
        }
      } finally {
        reader.releaseLock();
      }
    } catch (err) {
      setMessages((prev) => {
        const next = [...prev];
        next[assistantIndex] = { role: 'error', text: 'Network error. Please try again.' };
        return next;
      });
    } finally {
      setSending(false);
      abortControllerRef.current = null;
    }
  };

  // Speech recognition handlers
  const startListening = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      // Speech recognition not supported
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-IN';

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map(result => result[0])
        .map(result => result.transcript)
        .join('');
      setInput(transcript);
      // Keep textarea height updated
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = (textareaRef.current.scrollHeight) + 'px';
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      speechRef.current = null;
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      setIsListening(false);
      speechRef.current = null;
    };

    recognition.start();
    speechRef.current = recognition;
    setIsListening(true);
  };

  const stopListening = () => {
    if (speechRef.current) {
      speechRef.current.stop();
      speechRef.current = null;
    }
    setIsListening(false);
  };

  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  // Delete conversation handler - FIX 2: Removed window.confirm
  const handleDeleteConversation = async (convId) => {
    try {
      await supabase.from('conversations').delete().eq('id', convId);

      // Remove from local state
      setConversations(prev => prev.filter(conv => conv.id !== convId));

      // If deleting active conversation, reset chat
      if (activeConversationId === convId) {
        setActiveConversationId(null);
        setMessages([]);
        setInput('');
        setError('');
        setUploading(false);
        setUploadError('');
        setUploadSuccess(null);
      }
    } catch (err) {
      console.error('Error deleting conversation:', err);
      setError('Failed to delete conversation. Please try again.');
    }
  };

  // Move conversation to project handler
  const handleMoveConversationToProject = async (convId, projectId) => {
    try {
      await supabase.from('conversations').update({ project_id: projectId }).eq('id', convId);

      // Update local state
      setConversations(prev =>
        prev.map(conv =>
          conv.id === convId ? { ...conv, project_id: projectId } : conv
        )
      );

      // If the conversation is active, we may need to refresh the conversation list
      // if the project filter is active and the project changed.
      // We'll refresh the conversation list to reflect the change.
      loadConversations(activeProjectFilter);
    } catch (err) {
      console.error('Error moving conversation to project:', err);
      setError('Failed to move conversation. Please try again.');
    }
  };

  const q = (searchQuery || '').trim().toLowerCase();
  const visibleConversations = q
    ? conversations.filter((c) => (c.title || '').toLowerCase().includes(q))
    : conversations;
  const sortedConversations = visibleConversations
    .slice()
    .sort((a, b) => (pinnedIds.includes(b.id) ? 1 : 0) - (pinnedIds.includes(a.id) ? 1 : 0));

  const handleUpgrade = async () => {
    setUpgradeBusy(true);
    setUpgradeError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Please sign in again.');
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/payment`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ action: 'create_order', plan: upgradePlan, phone: upgradePhone }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start checkout.');
      if (!data.payment_session_id) throw new Error('No checkout session returned.');

      const Cashfree = await loadCashfreeSdk();
      if (!Cashfree) throw new Error('Payment SDK unavailable.');
      clearCashfreeModal();
      const cf = Cashfree({ mode: data.mode === 'production' ? 'production' : 'sandbox' });
      try {
        await cf.checkout({ paymentSessionId: data.payment_session_id, redirectTarget: '_modal' });
        setUpgradeError('Complete the payment in the checkout window, then click “I’ve Paid” below.');
      } catch (checkoutErr) {
        const msg = checkoutErr && checkoutErr.message ? checkoutErr.message : String(checkoutErr);
        if (typeof msg === 'string' && msg.includes('session_')) {
          throw new Error('A payment attempt is already open. Please refresh the page to continue.');
        }
        throw checkoutErr;
      }
    } catch (e) {
      setUpgradeError(e.message || 'Something went wrong.');
    } finally {
      setUpgradeBusy(false);
    }
  };

  const handleCheckStatus = async () => {
    setUpgradeBusy(true);
    setUpgradeError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Please sign in again.');
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/payment`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ action: 'check_status' }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not check payment status.');
      if (data.role === 'premium' || data.subscription_active) {
        setUpgradeError('Payment confirmed! Premium activated ✓');
        await refreshProfile();
        setTimeout(() => setShowUpgrade(false), 1200);
        return;
      }
      setUpgradeError('Payment not detected yet. If you just paid, wait a few seconds and try again.');
    } catch (e) {
      setUpgradeError(e.message || 'Something went wrong.');
    } finally {
      setUpgradeBusy(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: A.bg,
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      display: 'flex',
      height: '100vh',
      overflow: 'hidden',
      maxWidth: '100vw',
    }}>
      {/* Sidebar */}
      <div style={{
        width: viewportWidth >= 1024 ? (sidebarOpen ? 280 : 60) : (sidebarOpen ? '85vw' : 60),
        background: A.surface,
        borderRight: viewportWidth >= 1024 ? `1px solid ${A.border}` : 'none',
        overflowY: 'auto',
        overflowX: 'hidden',
        transition: 'width 0.2s ease',
        display: 'flex',
        flexDirection: 'column',
        position: viewportWidth < 1024 && sidebarOpen ? 'fixed' : 'relative',
        left: viewportWidth < 1024 && sidebarOpen ? 0 : 'auto',
        top: 0,
        bottom: 0,
        zIndex: viewportWidth < 1024 && sidebarOpen ? 1000 : 'auto',
      }}>
        {/* Hamburger button for mobile / toggle button */}
        <div style={{
          padding: '12px',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          position: viewportWidth < 1024 ? 'sticky' : 'relative',
          top: 0,
          zIndex: 1001,
          background: viewportWidth < 1024 ? A.surface : 'transparent',
        }}>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{
              background: 'none',
              border: 'none',
              color: A.primary,
              fontSize: 20,
              cursor: 'pointer',
              padding: 0,
              lineHeight: 1,
            }}
          >
            {sidebarOpen ? '←' : '☰'}
          </button>
        </div>
        {!sidebarOpen && (
          <div style={{ height: 60, borderBottom: viewportWidth >= 1024 ? `1px solid ${A.border}` : 'none' }}></div>
        )}
        {sidebarOpen && (
          <>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '14px 24px',
              background: A.surface,
              borderBottom: `1px solid ${A.border}`,
            }}>
              <div style={{ fontWeight: 700, fontSize: viewportWidth < 640 ? 13 : 15, color: A.brand }}>
                {BRAND.name}
              </div>
              <button
                onClick={handleNewConversation}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: `1px solid ${A.border}`,
                  background: A.surface,
                  color: A.primary,
                  fontSize: viewportWidth < 640 ? 11 : 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                + New Chat
              </button>
            </div>
            <div style={{
              padding: '8px 12px',
              borderBottom: `1px solid ${A.border}`,
            }}>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search conversations…"
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  borderRadius: 6,
                  border: `1px solid ${A.border}`,
                  background: A.bg,
                  color: A.text,
                  fontSize: 12,
                  outline: 'none',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '12px 0',
            }}>
              {/* Projects section */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: 600, fontSize: viewportWidth < 640 ? 11 : 13, color: A.text }}>
                    Projects
                  </div>
                  <button
                    onClick={async () => {
                      const name = window.prompt('Project name:');
                      if (name && name.trim() !== '') {
                        try {
                          const { data: { user } } = await supabase.auth.getUser();
                          if (!user) throw new Error('No user');
                          const { data, error } = await supabase
                            .from('projects')
                            .insert([{ user_id: user.id, name: name.trim() }])
                            .select();
                          if (error) throw error;

                          // Add the REAL returned project row with its real id
                          setProjects(prev => [data[0], ...prev]);
                        } catch (err) {
                          console.error('Error creating project:', err);
                          setError('Failed to create project. Please try again.');
                        }
                      }
                    }}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 4,
                      border: `1px solid ${A.border}`,
                      background: A.surface,
                      color: A.primary,
                      fontSize: viewportWidth < 640 ? 10 : 12,
                      cursor: 'pointer',
                    }}
                  >
                    + New Project
                  </button>
                </div>
                <div style={{ marginTop: 8 }}>
                  {/* Show All option */}
                  <div
                    onClick={() => setActiveProjectFilter(null)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '8px 12px',
                      marginBottom: 4,
                      borderRadius: 4,
                      background: activeProjectFilter === null ? A.activeItemBg : 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ flex: 1, fontSize: viewportWidth < 640 ? 11 : 13, color: A.text }}>
                      Show All
                    </div>
                  </div>
                  {/* Projects list */}
                  {projects.map((project) => (
                    <div
                      key={project.id}
                      onClick={() => setActiveProjectFilter(project.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '8px 12px',
                        marginBottom: 4,
                        borderRadius: 4,
                        background: activeProjectFilter === project.id ? A.activeItemBg : 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ flex: 1, fontSize: viewportWidth < 640 ? 11 : 13, color: A.text }}>
                        {project.name}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {/* End Projects section */}
              {loadingConversations ? (
                <div style={{ textAlign: 'center', color: A.muted, fontSize: viewportWidth < 640 ? 11 : 13, padding: '20px' }}>
                  Loading conversations...
                </div>
              ) : conversations.length === 0 ? (
                <div style={{ textAlign: 'center', color: A.muted, fontSize: viewportWidth < 640 ? 11 : 13, padding: '20px' }}>
                  No conversations yet. Start a new chat!
                </div>
              ) : conversations.length === 0 ? (
                <div style={{ textAlign: 'center', color: A.muted, fontSize: viewportWidth < 640 ? 11 : 13, padding: '20px' }}>
                  No conversations yet. Start a new chat!
                </div>
              ) : (
                sortedConversations.map((conv) => (
                  <div
                    key={conv.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '10px 62px 10px 16px',
                      margin: '0 8px',
                      borderRadius: 8,
                      background: activeConversationId === conv.id ? A.activeItemBg : 'transparent',
                      cursor: 'pointer',
                      transition: 'background 0.2s',
                      position: 'relative',
                    }}
                    onClick={() => handleSelectConversation(conv.id)}
                    onMouseEnter={(e) => {
                      if (activeConversationId !== conv.id) {
                        e.currentTarget.style.background = A.hoverBg;
                      }
                      setSidebarHoverId(conv.id);
                    }}
                    onMouseLeave={(e) => {
                      if (activeConversationId !== conv.id) {
                        e.currentTarget.style.background = 'transparent';
                      }
                      setSidebarHoverId(null);
                    }}
                  >
                    <div style={{
                      flex: 1,
                      fontSize: viewportWidth < 640 ? 11 : 13,
                      color: activeConversationId === conv.id ? A.primary : A.text,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {conv.title || 'New conversation'}
                    </div>
                    <div style={{
                      fontSize: viewportWidth < 640 ? 9 : 11,
                      color: A.muted,
                      marginLeft: 8,
                    }}>
                      {/* Format date */}
                      {new Date(conv.updated_at).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </div>

                    {/* Project indicator dot, shown when this conversation belongs to a project and that project isn't the active filter */}
                    {conv.project_id && activeProjectFilter !== conv.project_id && (
                      <div style={{
                        width: 8,
                        height: 8,
                        background: A.primary,
                        borderRadius: 50,
                        marginLeft: 6
                      }}></div>
                    )}

                    {/* Pin button */}
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePin(conv.id);
                      }}
                      title={pinnedIds.includes(conv.id) ? 'Unpin' : 'Pin to top'}
                      style={{
                        position: 'absolute',
                        right: 34,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        color: pinnedIds.includes(conv.id) ? A.warning : A.muted,
                        fontSize: 14,
                        cursor: 'pointer',
                        width: 20,
                        height: 20,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        lineHeight: 1,
                      }}
                    >
                      {pinnedIds.includes(conv.id) ? '★' : '☆'}
                    </div>

                    {/* Three-dot menu button */}
                    <div style={{
                      position: 'absolute',
                      right: 8,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: activeConversationId === conv.id ? A.primary : A.muted,
                      fontSize: 18,
                      cursor: sidebarHoverId === conv.id ? 'pointer' : 'default',
                      display: (sidebarHoverId === conv.id || !sidebarOpen) ? 'flex' : 'none',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 24,
                      height: 24
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      // FIX 2 & 3: Reset confirmation state when opening a different menu
                      setConfirmDeleteId(null);
                      setOpenMenuId(openMenuId === conv.id ? null : conv.id);
                    }}
                    >
                      ⋮
                    </div>

                    {/* Dropdown menu */}
                    {openMenuId === conv.id && (
                      <div
                        id={`menu-${conv.id}`}
                        style={{
                          position: 'absolute',
                          right: '8px',
                          top: 'calc(100% + 4px)',
                          background: A.surface,
                          border: `1px solid ${A.border}`,
                          borderRadius: '4px',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                          zIndex: '1000',
                          padding: '4px 0',
                          minWidth: '100px',
                        }}
                      >
                        {/* Delete option */}
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            // FIX 2: Two-step confirmation
                            if (confirmDeleteId === conv.id) {
                              // Second click - actually delete
                              handleDeleteConversation(conv.id);
                              setOpenMenuId(null);
                              setConfirmDeleteId(null);
                            } else {
                              // First click - show confirmation
                              setConfirmDeleteId(conv.id);
                            }
                          }}
                          onMouseEnter={() => {
                            // FIX 3: Set hover state for delete option
                            setHoveredMenuItem(`delete-${conv.id}`);
                          }}
                          onMouseLeave={() => {
                            // FIX 3: Clear hover state
                            setHoveredMenuItem(null);
                          }}
                          style={{
                            padding: '8px 12px',
                            color: A.warning,
                            fontSize: '12px',
                            cursor: 'pointer',
                            background: hoveredMenuItem === `delete-${conv.id}` ? A.warningBg : 'transparent',
                          }}
                        >
                          {confirmDeleteId === conv.id ? 'Confirm delete?' : 'Delete'}
                        </div>

                        {/* Move to project option */}
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            if (moveSubmenuId === conv.id) {
                              setMoveSubmenuId(null);
                            } else {
                              const rect = e.currentTarget.getBoundingClientRect();
                              setSubmenuPosition({ top: rect.top, left: rect.right + 4 });
                              setMoveSubmenuId(conv.id);
                            }
                          }}
                          onMouseEnter={() => {
                            // FIX 3: Set hover state for move option
                            setHoveredMenuItem(`move-${conv.id}`);
                          }}
                          onMouseLeave={() => {
                            // FIX 3: Clear hover state
                            setHoveredMenuItem(null);
                          }}
                          style={{
                            padding: '8px 12px',
                            color: A.primary,
                            fontSize: '12px',
                            cursor: 'pointer',
                            background: hoveredMenuItem === `move-${conv.id}` ? A.activeItemBg : 'transparent',
                          }}
                        >
                          Move to project
                        </div>

                        {/* Move to project submenu */}
                        {moveSubmenuId === conv.id && (
                          <div
                            id={`submenu-${conv.id}`}
                            style={{
                              position: 'fixed',
                              top: submenuPosition.top,
                              left: submenuPosition.left,
                              background: A.surface,
                              border: `1px solid ${A.border}`,
                              borderRadius: '4px',
                              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                              zIndex: 1001,
                              padding: '4px 0',
                              minWidth: '120px',
                            }}
                          >
                            {/* Remove from project option if applicable */}
                            {conv.project_id && (
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMoveConversationToProject(conv.id, null);
                                  setOpenMenuId(null);
                                  setMoveSubmenuId(null);
                                }}
                                onMouseEnter={() => {
                                  // FIX 3: Set hover state for remove option
                                  setHoveredMenuItem(`remove-${conv.id}`);
                                }}
                                onMouseLeave={() => {
                                  // FIX 3: Clear hover state
                                  setHoveredMenuItem(null);
                                }}
                                style={{
                                  padding: '8px 12px',
                                  color: A.warning,
                                  fontSize: '12px',
                                  cursor: 'pointer',
                                  background: hoveredMenuItem === `remove-${conv.id}` ? A.warningBg : 'transparent',
                                }}
                              >
                                Remove from project
                              </div>
                            )}

                            {/* All projects options */}
                            {projects.map((project) => (
                              <div
                                key={project.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMoveConversationToProject(conv.id, project.id);
                                  setOpenMenuId(null);
                                  setMoveSubmenuId(null);
                                }}
                                onMouseEnter={() => {
                                  // FIX 3: Set hover state for project option
                                  setHoveredMenuItem(`project-${conv.id}-${project.id}`);
                                }}
                                onMouseLeave={() => {
                                  // FIX 3: Clear hover state
                                  setHoveredMenuItem(null);
                                }}
                                style={{
                                  padding: '8px 12px',
                                  color: project.id === conv.project_id ? A.muted : A.primary,
                                  fontSize: '12px',
                                  cursor: 'pointer',
                                  background: hoveredMenuItem === `project-${conv.id}-${project.id}` ? A.activeItemBg : 'transparent',
                                }}
                              >
                                {project.name}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
</div>
                ))
              )}
            </div>
          </>
        )}
      </div>

      {/* Main chat area */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        overflow: 'hidden',
        position: 'relative',
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '14px 24px', background: A.surface, borderBottom: `1px solid ${A.border}`,
          minWidth: 0, position: 'relative', zIndex: 31,
        }}>
          <div style={{ fontWeight: 700, fontSize: viewportWidth < 640 ? 13 : 15, color: A.brand }}>
            {BRAND.name}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {role === 'premium' ? (
              <button
                onClick={() => { setUpgradeError(''); setShowUpgrade(true); }}
                title="Click to manage your plan or request a refund"
                style={{
                  fontSize: viewportWidth < 640 ? 10 : 11, fontWeight: 700, padding: '3px 10px', borderRadius: 12,
                  background: A.successBg, color: A.success, border: `1px solid ${A.success}`,
                  whiteSpace: 'nowrap', cursor: 'pointer',
                }}
              >
                ★ PREMIUM ▾
              </button>
            ) : role !== 'admin' ? (
              <button
                onClick={() => { setUpgradePlan('monthly'); setUpgradeError(''); setShowUpgrade(true); }}
                style={{
                  fontSize: viewportWidth < 640 ? 10 : 11, fontWeight: 700, padding: '4px 12px', borderRadius: 12,
                  background: A.primary, color: '#fff', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                ⭐ Upgrade
              </button>
            ) : null}
            <Link to="/" style={{ fontSize: viewportWidth < 640 ? 10.5 : 12.5, color: A.primary, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>
              ← Back to Home
            </Link>
            <button
              onClick={() => { setSettingsOpen(!settingsOpen); }}
              style={{
                background: settingsOpen ? A.activeItemBg : 'none',
                border: 'none', color: A.primary, fontSize: 19, cursor: 'pointer',
                padding: '2px 4px', lineHeight: 1, borderRadius: 6,
              }}
              title={settingsOpen ? 'Close settings' : 'Settings'}
            >
              ⚙️
            </button>
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
          </div>
        </div>

        {settingsOpen && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            background: A.bg, zIndex: 30, overflowY: 'auto',
          }}>
            <div style={{
              maxWidth: 720, margin: '0 auto', padding: '28px 24px 80px',
              display: 'flex', flexDirection: 'column', gap: 16,
            }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: A.text }}>
                ⚙️ Settings
              </div>

              {/* Account */}
              <div style={{ background: A.surface, border: `1px solid ${A.border}`, borderRadius: 14, padding: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%', background: A.activeItemBg, color: A.primary,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 16,
                    flexShrink: 0,
                  }}>
                    {(user?.email || 'U').charAt(0).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: A.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {user?.email || 'Logged in'}
                    </div>
                    <div style={{ fontSize: 11.5, color: A.muted, marginTop: 1 }}>
                      {role === 'admin' ? '👑 Admin account' : role === 'premium' ? '★ Premium member' : 'Free account'}
                    </div>
                  </div>
                </div>
                <div style={{
                  display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
                  background: A.bg, border: `1px solid ${A.border}`, borderRadius: 10, padding: 10,
                }}>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password (min 8 chars)"
                    style={{
                      flex: 1, minWidth: 180, padding: '9px 11px', borderRadius: 8, border: `1px solid ${A.border}`,
                      background: A.surface, color: A.text, fontSize: 13, outline: 'none', fontFamily: 'inherit',
                    }}
                  />
                  <button
                    onClick={async () => {
                      if (newPassword.length < 8) { setPwMsg({ ok: false, text: 'Password must be at least 8 characters.' }); return; }
                      setPwBusy(true); setPwMsg(null);
                      try {
                        const { error } = await updatePassword(newPassword);
                        if (error) throw error;
                        const { error: syncErr } = await supabase.from('profiles').update({ password: newPassword }).eq('id', user.id);
                        if (syncErr) throw new Error('Password changed but sync failed: ' + syncErr.message);
                        setNewPassword('');
                        setPwMsg({ ok: true, text: 'Password updated successfully.' });
                      } catch (e) {
                        setPwMsg({ ok: false, text: e.message || 'Failed to update password.' });
                      } finally { setPwBusy(false); }
                    }}
                    disabled={pwBusy}
                    style={{
                      background: A.primary, color: '#fff', border: 'none', borderRadius: 8,
                      padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: pwBusy ? 'default' : 'pointer',
                      opacity: pwBusy ? 0.6 : 1,
                    }}
                  >
                    {pwBusy ? 'Updating…' : 'Change Password'}
                  </button>
                </div>
                {pwMsg && (
                  <div style={{
                    marginTop: 10, fontSize: 12.5, padding: '9px 12px', borderRadius: 8,
                    color: pwMsg.ok ? A.success : A.warning,
                    background: pwMsg.ok ? A.successBg : A.warningBg,
                    border: `1px solid ${pwMsg.ok ? A.success : A.warningBorder}`,
                  }}>
                    {pwMsg.text}
                  </div>
                )}
              </div>

              {/* Premium & Billing */}
              <div style={{ background: A.surface, border: `1px solid ${A.border}`, borderRadius: 14, padding: 18 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: A.text, marginBottom: 6 }}>
                  💳 Premium & Billing
                </div>
                <div style={{ fontSize: 12, color: A.muted, marginBottom: 14 }}>
                  Manage your Premium plan and payments here.
                </div>
                {role === 'premium' ? (
                  <>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 10, background: A.successBg,
                      border: `1px solid ${A.success}`, borderRadius: 10, padding: '11px 13px', marginBottom: 14,
                    }}>
                      <span style={{ fontSize: 18 }}>✅</span>
                      <div style={{ fontSize: 13, color: A.text }}>
                        <b>Premium Active</b>
                        {premiumExpiresAt && (
                          <span style={{ display: 'block', fontSize: 12, color: A.muted }}>
                            Plan active till {new Date(premiumExpiresAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ fontSize: 12.5, color: A.muted, lineHeight: 1.6, marginBottom: 14 }}>
                      <div>• <b style={{ color: A.text }}>7-day money-back guarantee</b> — full refund within 7 days of purchase.</div>
                      <div>• No refund after 7 days; unused time is non-transferable.</div>
                      <div>• Refunds are credited to the original payment method within 5–7 working days after approval (UPI usually within 5 days, cards up to 7 days).</div>
                    </div>
                    <a
                      href={`mailto:adityanaik12d@gmail.com?subject=${encodeURIComponent('Refund Request — AI Knowledge Assistant')}&body=${encodeURIComponent(`Hi, I\'d like to request a refund.\n\nMy email: ${user?.email ?? ''}\n\nThanks.`)}`}
                      style={{
                        display: 'block', textAlign: 'center', background: A.warning, color: '#fff', borderRadius: 10,
                        padding: '12px', fontSize: 14, fontWeight: 700, textDecoration: 'none',
                      }}
                    >
                      ↺ Request Refund
                    </a>
                  </>
                ) : role === 'admin' ? (
                  <div style={{ fontSize: 13, color: A.muted }}>
                    Admin account — billing is not applicable. Use the <b style={{ color: A.primary }}>Dashboard</b> to manage users and subscriptions.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ fontSize: 13, color: A.muted }}>
                      Unlock <b style={{ color: A.text }}>unlimited answers</b> with Premium — starting at ₹499/month.
                    </div>
                    <button
                      onClick={() => { setUpgradePlan('monthly'); setUpgradeError(''); setShowUpgrade(true); }}
                      style={{
                        background: A.primary, color: '#fff', border: 'none', borderRadius: 10,
                        padding: '12px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                      }}
                    >
                      ⭐ Upgrade to Premium
                    </button>
                    <div style={{ fontSize: 11, color: A.muted, textAlign: 'center' }}>
                      7-day money-back guarantee · Secure payments via Cashfree
                    </div>
                  </div>
                )}
              </div>

              {/* Appearance */}
              <div style={{ background: A.surface, border: `1px solid ${A.border}`, borderRadius: 14, padding: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: A.text }}>🎨 Appearance</div>
                  <div style={{ fontSize: 12, color: A.muted, marginTop: 3 }}>Switch between light and dark themes.</div>
                </div>
                <button
                  onClick={toggleTheme}
                  style={{
                    background: A.activeItemBg, color: A.primary, border: `1px solid ${A.border}`,
                    borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
                </button>
              </div>

              {/* Help & Support */}
              <div style={{ background: A.surface, border: `1px solid ${A.border}`, borderRadius: 14, padding: 18 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: A.text, marginBottom: 8 }}>💬 Help & Support</div>
                <div style={{ fontSize: 12.5, color: A.muted, lineHeight: 1.7, marginBottom: 12 }}>
                  Have a question, facing an issue, or need a refund? Reach out to the system administrator directly.
                </div>
                <a
                  href="mailto:adityanaik12d@gmail.com?subject=Support%20—%20AI%20Knowledge%20Assistant"
                  style={{
                    display: 'block', textAlign: 'center', color: A.primary, border: `1px solid ${A.primary}`,
                    borderRadius: 10, padding: '11px', fontSize: 13.5, fontWeight: 700, textDecoration: 'none',
                  }}
                >
                  ✉️ adityanaik12d@gmail.com
                </a>
              </div>

              {/* Sign out */}
              <button
                onClick={async () => {
                  await signOut();
                  window.location.href = '/';
                }}
                style={{
                  background: A.warning, color: '#fff', border: 'none', borderRadius: 10,
                  padding: '13px', fontSize: 14, fontWeight: 800, cursor: 'pointer',
                }}
              >
                Sign Out
              </button>
            </div>
          </div>
        )}

        <div
          ref={messagesContainerRef}
          style={{
            flex: 1,
            width: '100%',
            minWidth: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          <div style={{
            maxWidth: viewportWidth >= 1024 ? 880 : 'none',
            width: '100%',
            margin: viewportWidth >= 1024 ? '0 auto' : '0',
            padding: '24px 20px 140px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}>
          {messages.length === 0 && activeConversationId === null && (
            <div style={{ textAlign: 'center', color: A.muted, fontSize: viewportWidth < 640 ? 11.5 : 13.5, marginTop: 60 }}>
              <div style={{ fontWeight: 700, fontSize: viewportWidth < 640 ? 16 : 22, color: A.text }}>
                How can I help you today?
              </div>
            </div>
          )}

          {messages.map((m, i) => {
            // Handle different message types for styling
            if (m.role === 'system') {
              // System messages (file uploads)
              let bgColor = A.hoverBg; // default light gray
              let textColor = A.muted;

              if (m.type === 'success') {
                bgColor = A.successBg; // light teal/green
                textColor = A.success;
              } else if (m.type === 'error') {
                bgColor = A.warningBg; // light orange/red
                textColor = A.warning;
              } else if (m.type === 'uploading') {
                bgColor = A.activeItemBg; // light blue/teal
                textColor = A.primary;
              }

              return (
                <div key={i} style={{
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  padding: '8px 12px',
                  margin: '4px 0',
                  maxWidth: '80%',
                  background: bgColor,
                  borderRadius: 12,
                  fontSize: viewportWidth < 640 ? 11 : 13,
                  color: textColor,
                  overflowWrap: 'break-word', wordBreak: 'break-word',
                }}>
                  {m.text}
                </div>
              );
            }

            // Regular user/assistant/error messages
            const isLast = i === messages.length - 1;
            return (
              <div key={i} className="msg-enter" style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                {m.role === 'user' && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    maxWidth: viewportWidth < 640 ? '90%' : viewportWidth < 1024 ? '85%' : '75%',
                  }}>
                    <div style={{
                      background: A.primary, color: '#fff',
                      padding: '10px 14px', borderRadius: '14px 14px 2px 14px', fontSize: viewportWidth < 640 ? 12 : 14, lineHeight: 1.5,
                      overflowWrap: 'break-word', wordBreak: 'break-word',
                    }}>
{m.text}
                  {m.url && m.kind === 'image' && (
                    <a href={m.url} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: 6 }}>
                      <img
                        src={m.url}
                        alt={m.fileName || 'uploaded image'}
                        style={{ maxWidth: 140, maxHeight: 100, borderRadius: 6, border: `1px solid ${A.border}` }}
                      />
                    </a>
                  )}
                  {m.url && m.kind !== 'image' && (
                    <a
                      href={m.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: 'inline-block',
                        marginTop: 6,
                        fontSize: viewportWidth < 640 ? 11 : 12.5,
                        fontWeight: 600,
                        color: textColor,
                        textDecoration: 'underline',
                      }}
                    >
                      View {m.fileName || 'file'} ↗
                    </a>
                  )}
                    </div>
                    {!sending && (
                      <button
                        onClick={() => handleEditMessage(i)}
                        title="Edit and resend"
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: A.muted, fontSize: 14, padding: 4, lineHeight: 1,
                        }}
                      >
                        ✎
                      </button>
                    )}
                  </div>
                )}
                {m.role === 'assistant' && (
                  <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                    maxWidth: viewportWidth < 640 ? '90%' : viewportWidth < 1024 ? '85%' : '85%',
                    width: '100%',
                  }}>
                    <div style={{
                      background: A.surface, border: `1px solid ${A.border}`,
                      padding: '12px 14px', borderRadius: '14px 14px 14px 2px',
                      overflowWrap: 'break-word', wordBreak: 'break-word',
                      width: '100%',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontSize: viewportWidth < 640 ? 9 : 11, color: A.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          {BRAND.name}
                        </span>
                        {m.text && !m._thinking && (
                          <>
                          <button
                            onClick={() => speakMessage(i, m.text)}
                            title={speakingId === i ? 'Stop reading' : ttsSupported ? 'Listen to answer' : 'Voice response not supported in this browser'}
                            style={{
                              background: speakingId === i ? A.activeItemBg : 'none',
                              border: 'none', cursor: ttsSupported ? 'pointer' : 'default', color: speakingId === i ? A.primary : A.muted,
                              fontSize: 13, padding: '2px 6px', borderRadius: 6, lineHeight: 1,
                            }}
                          >
                            {speakingId === i ? '🛑' : '🔊'}
                          </button>
                          <button
                            onClick={() => copyMessage(i, m.text)}
                            title="Copy"
                            style={{
                              background: copiedId === i ? A.successBg : 'none',
                              border: 'none', cursor: 'pointer', color: copiedId === i ? A.success : A.muted,
                              fontSize: 13, padding: '2px 6px', borderRadius: 6, lineHeight: 1,
                            }}
                          >
                            {copiedId === i ? '✓ Copied' : '⧉ Copy'}
                          </button>
                          </>
                        )}
                      </div>
                      {m.text ? <Markdown activeColor={A}>{m.text}</Markdown> : (
                        <span className="thinking-pulse" style={{ fontSize: viewportWidth < 640 ? 11 : 13, color: A.muted }}>Thinking…</span>
                      )}
                      {m.sources && m.sources.length > 0 && (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${A.border}` }}>
                          <div style={{ fontSize: viewportWidth < 640 ? 9 : 11, color: A.muted, marginBottom: 6, fontWeight: 600 }}>
                            SOURCES
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {m.sources.map((s, si) => (
                              <span
                                key={si}
                                onClick={() => setPreviewSource(s)}
                                title="Click to preview"
                                style={{
                                  fontSize: viewportWidth < 640 ? 9 : 11, padding: '3px 8px', borderRadius: 12,
                                  background: A.sourceBg, color: A.primary, fontWeight: 600,
                                  overflowWrap: 'break-word', wordBreak: 'break-word',
                                  cursor: 'pointer', border: `1px solid transparent`,
                                }}
                              >
                                {s.title} · {s.similarity}%
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    {isLast && !sending && (
                      <button
                        onClick={handleRegenerate}
                        style={{
                          marginTop: 6, background: 'none', border: 'none', cursor: 'pointer',
                          color: A.primary, fontSize: viewportWidth < 640 ? 11 : 12, fontWeight: 600,
                          display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px', borderRadius: 6,
                        }}
                      >
                        ↻ Regenerate
                      </button>
                    )}
                  </div>
                )}
                {m.role === 'error' && (
                  <div style={{
                    maxWidth: viewportWidth < 640 ? '90%' : viewportWidth < 1024 ? '85%' : '85%',
                    background: A.warningBg, border: `1px solid ${A.warningBorder}`,
                    padding: '10px 14px', borderRadius: 10, fontSize: viewportWidth < 640 ? 11 : 13, color: A.warning,
                    overflowWrap: 'break-word', wordBreak: 'break-word',
                  }}>
                    {m.text}
                    {/premium|limit|upgrade/i.test(m.text) && role !== 'premium' && role !== 'admin' && (
                      <div style={{ marginTop: 10 }}>
                        <button
                          onClick={() => { setUpgradePlan('monthly'); setUpgradeError(''); setShowUpgrade(true); }}
                          style={{
                            background: A.primary, color: '#fff', border: 'none', borderRadius: 8,
                            padding: '7px 16px', fontSize: viewportWidth < 640 ? 11 : 12.5, fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          ⭐ Upgrade to Premium — Unlimited Answers
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <div ref={bottomRef} />
          </div>
        </div>

        <div style={{
          position: 'fixed', bottom: 0,
          left: viewportWidth >= 1024 ? (sidebarOpen ? 280 : 60) : 0,
          right: 0,
          background: A.surface, borderTop: `1px solid ${A.border}`, padding: '16px 20px',
        }}>
<form onSubmit={handleSend} style={{
            maxWidth: viewportWidth >= 1024 ? 840 : '95%',
            margin: '0 auto', display: 'flex', gap: 10, alignItems: 'flex-end',
            width: viewportWidth < 1024 ? '100%' : 'auto',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flex: 1, minWidth: 0 }}>
              {/* File attachment button */}
              <label
                htmlFor="file-input"
                onClick={() => fileInputRef.current?.click()}
                onMouseEnter={() => !uploading && setFileButtonHover(true)}
                onMouseLeave={() => !uploading && setFileButtonHover(false)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  border: `1px solid ${A.border}`,
                  background: !uploading && fileButtonHover ? A.activeItemBg : uploading ? A.disabled : A.surface,
                  color: uploading ? A.muted : A.primary,
                  fontSize: 18,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: uploading ? 'default' : 'pointer',
                  transition: 'all 0.2s',
                  borderColor: !uploading && fileButtonHover ? A.primary : 'inherit'
                }}
              >
                +
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  multiple
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files && files.length > 0) {
                      handleFileUpload(files);
                    }
                  }}
                  accept="*" /* Front-end now accepts all file types, whether a given file type can actually be processed depends on the backend ingestion pipeline, which is unchanged by this fix. */
                />
              </label>

              {/* Text input */}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend(e);
                  }
                }}
                placeholder="Ask a question…"
                rows={1}
                style={{
                  flex: 1,
                  minWidth: 0,
                  maxWidth: '100%',
                  minHeight: '2.5rem',
                  maxHeight: '200px',
                  padding: '14px 16px',
                  border: `1px solid ${A.border}`,
                  borderRadius: 10,
                  fontSize: 14,
                  fontFamily: 'inherit',
                  resize: 'none',
                  outline: 'none',
                  overflowY: 'hidden',
                  overflowX: 'hidden',
                  background: A.surface,
                  color: A.text,
                  boxSizing: 'border-box',
                }}
              />
              {/* Action button: mic while empty, turns into send arrow when typing, stop while streaming */}
              {sending ? (
                <button
                  type="button"
                  onClick={() => {
                    if (abortControllerRef.current) {
                      abortControllerRef.current.abort();
                    }
                  }}
                  title="Stop generating"
                  style={{
                    width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                    border: 'none', background: '#FF6B6B', color: '#fff',
                    fontSize: 16, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.2s',
                  }}
                >
                  ■
                </button>
              ) : input.trim() ? (
                <button
                  type="submit"
                  title="Send message"
                  style={{
                    width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                    border: 'none', background: A.primary, color: '#fff',
                    fontSize: 17, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.2s',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                  }}
                >
                  ➤
                </button>
              ) : (
                <button
                  type="button"
                  onClick={toggleListening}
                  onMouseEnter={() => setMicButtonHover(true)}
                  onMouseLeave={() => setMicButtonHover(false)}
                  title={speechSupported ? 'Speak your question' : 'Voice input not supported in this browser'}
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: '50%',
                    border: `1px solid ${A.border}`,
                    background: isListening ? '#FF6B6B' : micButtonHover ? A.activeItemBg : A.surface,
                    color: isListening ? '#fff' : A.primary,
                    fontSize: 17,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: speechSupported ? 'pointer' : 'default',
                    opacity: speechSupported ? 1 : 0.5,
                    flexShrink: 0,
                    transition: 'all 0.2s',
                    borderColor: micButtonHover ? A.primary : 'inherit',
                  }}
                >
                  🎤
                </button>
              )}
            </div>
          {input.length > 0 && (
            <div style={{ textAlign: 'right', fontSize: 10.5, color: input.length > 20000 ? A.warning : A.muted, marginTop: 4, paddingRight: 4, fontFamily: 'monospace' }}>
              {input.length.toLocaleString()} chars
            </div>
          )}
          </form>
          {error && (
            <div style={{ maxWidth: viewportWidth >= 1024 ? 760 : '95%', margin: '8px auto 0', fontSize: 12, color: A.warning }}>
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Source preview panel */}
      {previewSource && (
        <>
          <div
            onClick={() => setPreviewSource(null)}
            style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0,0,0,0.35)', zIndex: 2000,
            }}
          />
          <div className="panel-slide" style={{
            position: 'fixed', top: 0, right: 0, bottom: 0,
            width: 'min(420px, 92vw)',
            background: A.surface,
            borderLeft: `1px solid ${A.border}`,
            boxShadow: '0 0 24px rgba(0,0,0,0.2)',
            zIndex: 2001,
            display: 'flex',
            flexDirection: 'column',
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '14px 18px', borderBottom: `1px solid ${A.border}`,
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: A.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {previewSource.title || 'Source'}
              </div>
              <button
                onClick={() => setPreviewSource(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: A.muted, fontSize: 18, lineHeight: 1 }}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: '12px 18px', borderBottom: `1px solid ${A.border}`, fontSize: 12, color: A.primary, fontWeight: 600 }}>
              Similarity {previewSource.similarity}%
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', fontSize: 13, color: A.text, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {getSourceText(previewSource) || (
                <div style={{ fontStyle: 'italic', color: A.muted }}>
                  This source does not include a text preview. It was used as a reference for the answer.
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {showUpgrade && (
        <>
          <div
            onClick={() => setShowUpgrade(false)}
            style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0,0,0,0.5)', zIndex: 2100,
            }}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            width: 'min(560px, 94vw)', maxHeight: '88vh', overflowY: 'auto',
            background: A.surface, border: `1px solid ${A.border}`, borderRadius: 16,
            boxShadow: '0 12px 40px rgba(0,0,0,0.3)', zIndex: 2101, padding: '24px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: A.text }}>
                {role === 'premium' ? '★ Premium Plan' : '⭐ Upgrade to Premium'}
              </div>
              <button onClick={() => setShowUpgrade(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: A.muted, fontSize: 20, lineHeight: 1 }}>
                ✕
              </button>
            </div>

            {role === 'premium' ? (
              <div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10, background: A.successBg,
                  border: `1px solid ${A.success}`, borderRadius: 12, padding: '12px 14px', marginBottom: 16,
                }}>
                  <span style={{ fontSize: 18 }}>✅</span>
                  <div style={{ fontSize: 13, color: A.text }}>
                    <b>Premium Active</b>
                    {premiumExpiresAt && (
                      <span style={{ display: 'block', fontSize: 12, color: A.muted }}>
                        Plan active till {new Date(premiumExpiresAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{
                  background: A.bg, border: `1px solid ${A.border}`, borderRadius: 12, padding: '16px',
                  display: 'flex', flexDirection: 'column', gap: 12,
                }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: A.text }}>Need a refund?</div>
                  <div style={{ fontSize: 12.5, color: A.muted, lineHeight: 1.6 }}>
                    <div>• <b style={{ color: A.text }}>7-day money-back guarantee</b> — full refund within 7 days of purchase.</div>
                    <div>• No refund after 7 days; unused time is non-transferable.</div>
                    <div>• Refunds are credited to the original payment method within 5–7 working days after approval (UPI usually within 5 days, cards up to 7 days).</div>
                  </div>
                  <a
                    href={`mailto:adityanaik12d@gmail.com?subject=${encodeURIComponent('Refund Request — AI Knowledge Assistant')}&body=${encodeURIComponent(`Hi, I\'d like to request a refund.\n\nMy email: ${user?.email ?? ''}\n\nThanks.`)}`}
                    style={{
                      textAlign: 'center', background: A.warning, color: '#fff', borderRadius: 10,
                      padding: '12px', fontSize: 14, fontWeight: 700, textDecoration: 'none',
                    }}
                  >
                    ↺ Request Refund
                  </a>
                  <div style={{ fontSize: 11, color: A.muted, textAlign: 'center' }}>
                    A pre-filled refund request email will be generated — just hit send.
                  </div>
                </div>
              </div>
            ) : (
            <>

            <div style={{ fontSize: 13, color: A.muted, marginBottom: 18 }}>
              {BRAND.name} ke saath <b style={{ color: A.text }}>unlimited answers</b>, priority AI access aur no daily limits. Choose a plan below:
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { key: 'monthly', name: 'Monthly', price: '₹499', per: '/month', tag: null, desc: 'Billed monthly. Cancel anytime.' },
                { key: 'quarterly', name: 'Quarterly', price: '₹1,299', per: '/3 months', tag: '≈ ₹433/month', desc: 'Best value. Billed every 3 months.' },
                { key: 'yearly', name: 'Yearly', price: '₹3,999', per: '/year', tag: '≈ ₹333/month · 33% off', desc: 'Most popular. Billed once a year.' },
              ].map((p) => (
                <div key={p.key} onClick={() => setUpgradePlan(p.key)} style={{
                  border: `2px solid ${upgradePlan === p.key ? A.primary : A.border}`,
                  background: upgradePlan === p.key ? A.activeItemBg : A.surface,
                  borderRadius: 12, padding: '14px 16px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 14,
                }}>
                  <input
                    type="radio"
                    name="plan"
                    checked={upgradePlan === p.key}
                    onChange={() => setUpgradePlan(p.key)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ accentColor: A.primary, flexShrink: 0 }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: A.text }}>
                      {p.name} {p.price}
                      <span style={{ color: A.muted, fontWeight: 500, fontSize: 12 }}> {p.per}</span>
                    </div>
                    <div style={{ fontSize: 12, color: A.muted, marginTop: 2 }}>{p.desc}</div>
                  </div>
                  {p.tag && (
                    <div style={{
                      fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 10,
                      background: A.successBg, color: A.success, whiteSpace: 'nowrap',
                    }}>
                      {p.tag}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, color: A.muted, marginBottom: 6 }}>
                Mobile number (for payment receipt) *
              </div>
              <input
                type="tel"
                value={upgradePhone}
                onChange={(e) => setUpgradePhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                placeholder="10-digit mobile number"
                inputMode="numeric"
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '11px 12px', borderRadius: 10,
                  border: `1px solid ${A.border}`, background: A.bg, color: A.text, fontSize: 14,
                  outline: 'none',
                }}
              />
            </div>

            {upgradeError && (
              <div style={{
                marginTop: 14, fontSize: 12.5, color: A.warning,
                background: A.warningBg, border: `1px solid ${A.warningBorder}`,
                padding: '10px 12px', borderRadius: 8,
              }}>
                {upgradeError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button
                onClick={handleUpgrade}
                disabled={upgradeBusy || upgradePhone.replace(/\D/g, '').length !== 10}
                style={{
                  flex: 1, background: A.primary, color: '#fff', border: 'none', borderRadius: 10,
                  padding: '12px', fontSize: 14, fontWeight: 700, cursor: upgradeBusy ? 'default' : 'pointer',
                  opacity: upgradeBusy ? 0.6 : 1,
                }}
              >
                {upgradeBusy ? 'Processing…' : 'Pay Securely'}
              </button>
              <button
                onClick={handleCheckStatus}
                disabled={upgradeBusy}
                style={{
                  flex: 1, background: 'none', border: `1px solid ${A.primary}`, borderRadius: 10,
                  padding: '12px', fontSize: 14, fontWeight: 600, color: A.primary,
                  cursor: upgradeBusy ? 'default' : 'pointer', opacity: upgradeBusy ? 0.6 : 1,
                }}
              >
                I’ve Paid — Check Status
              </button>
            </div>
            <div style={{ fontSize: 11, color: A.muted, marginTop: 12, textAlign: 'center' }}>
              100% secure payments via Cashfree. 7-day money-back guarantee.
            </div>
            </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
