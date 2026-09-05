import React, { useState, useEffect } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { LIGHT_COLORS, DARK_COLORS } from '../context/themeColors.js';
import { BRAND } from '../config/brand.js';
import { supabase } from '../lib/supabase.js';

export default function Dashboard() {
  const { user, isAdmin, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const A = theme === 'dark' ? DARK_COLORS : LIGHT_COLORS;
  const [viewportWidth, setViewportWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024);
  const [activeTab, setActiveTab] = useState('Users'); // Users, Documents, Activity Log, Usage
  const [users, setUsers] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [activityLog, setActivityLog] = useState([]);
  const [usageStats, setUsageStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState(new Set());
  const [addUserForm, setAddUserForm] = useState({
    email: '',
    password: '',
    fullName: '',
    role: 'employee',
    department: 'unassigned',
  });
  const [showAddUserForm, setShowAddUserForm] = useState(false); // FIX 2: New state for form visibility
  const [deleteUserConfirm, setDeleteUserConfirm] = useState(null); // userId to confirm deletion
  const [bulkActionConfirm, setBulkActionConfirm] = useState(null); // { action: 'delete' | 'suspend' | 'unsuspend', userIds: Set }
  const [deleteDocumentConfirm, setDeleteDocumentConfirm] = useState(null); // { title, uploaded_by }

  // Responsive viewport width
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const handleResize = () => setViewportWidth(window.innerWidth);
      window.addEventListener('resize', handleResize);
      setViewportWidth(window.innerWidth);
      return () => window.removeEventListener('resize', handleResize);
    }
  }, []);

  // Redirect if not admin (checked after auth loads)
  useEffect(() => {
    if (!authLoading && !isAdmin) {
      navigate('/');
    }
  }, [authLoading, isAdmin, navigate]);

  // Fetch data when tab changes or on initial load
  useEffect(() => {
    if (isAdmin) {
      loadDashboardData();
    }
  }, [activeTab, isAdmin]);

  const loadDashboardData = async () => {
    setLoading(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No session');

      // Fetch users list (needed for multiple tabs)
      const { data: usersData, error: usersError } = await supabase
        .from('profiles')
        .select('id, email, full_name, role, department, suspended, created_at')
        .order('created_at', { ascending: false });
      if (usersError) throw usersError;
      setUsers(usersData);

      // Fetch documents - FIX 1: Use .functions.invoke
      const { data: docsData, error: docsError } = await supabase.functions.invoke('admin', {
        body: { action: 'list_documents' },
      });
      if (docsError) throw docsError;
      setDocuments(docsData?.documents || []);

      // Fetch activity log - FIX 1: Use .functions.invoke
      const { data: logData, error: logError } = await supabase.functions.invoke('admin', {
        body: { action: 'activity_log', limit: 100 },
      });
      if (logError) throw logError;
      setActivityLog(logData?.events || []);

      // Fetch usage stats - FIX 1: Use .functions.invoke
      const { data: statsData, error: statsError } = await supabase.functions.invoke('admin', {
        body: { action: 'usage_stats' },
      });
      if (statsError) throw statsError;
      setUsageStats(statsData?.stats || {});
    } catch (err) {
      console.error('Dashboard load error:', err);
      setError(err.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  // Helper to call admin edge function - FIX 1: Use .functions.invoke
  const callAdminFunction = async (action, body = {}) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No session');

      const { data, error } = await supabase.functions.invoke('admin', {
        body: { action, ...body },
      });

      if (error) throw error;
      return data;
    } catch (err) {
      throw err;
    }
  };

  // User actions
  const handleUpdateUser = async (userId, updates) => {
    try {
      await callAdminFunction('update_user', { userId, ...updates });
      // Update local state optimistically
      setUsers(prev =>
        prev.map(u =>
          u.id === userId ? { ...u, ...updates } : u
        )
      );
    } catch (err) {
      setError(err.message || 'Failed to update user');
      throw err;
    }
  };

  const handleDeleteUser = async (userId) => {
    try {
      await callAdminFunction('delete_user', { userId });
      // Remove from local state
      setUsers(prev => prev.filter(u => u.id !== userId));
      // Clear selection if deleted
      setSelectedUserIds(prev => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    } catch (err) {
      setError(err.message || 'Failed to delete user');
      throw err;
    }
  };

  const handleBulkUpdateUsers = async (updates) => {
    const userIds = Array.from(selectedUserIds);
    if (userIds.length === 0) return;
    try {
      await callAdminFunction('bulk_update_users', { userIds: userIds, ...updates });
      // Refresh user list to get latest data
      await loadDashboardData(); // This will refetch users
      // Clear selection
      setSelectedUserIds(new Set());
    } catch (err) {
      setError(err.message || 'Failed to bulk update users');
      throw err;
    }
  };

  const handleBulkDeleteUsers = async () => {
    const userIds = Array.from(selectedUserIds);
    if (userIds.length === 0) return;
    try {
      const result = await callAdminFunction('bulk_delete_users', { userIds });
      // Refresh user list
      await loadDashboardData();
      // Clear selection
      setSelectedUserIds(new Set());
      return result;
    } catch (err) {
      setError(err.message || 'Failed to bulk delete users');
      throw err;
    }
  };

  const handleAddUser = async () => {
    const { email, password, fullName, role, department } = addUserForm;
    try {
      await callAdminFunction('add_user', {
        email,
        password,
        full_name: fullName || null,
        role,
        department,
      });
      // Reset form
      setAddUserForm({
        email: '',
        password: '',
        fullName: '',
        role: 'employee',
        department: 'unassigned',
      });
      // Refresh user list
      await loadDashboardData();
      // FIX 2: Close form after successful add
      setShowAddUserForm(false);
    } catch (err) {
      setError(err.message || 'Failed to add user');
      throw err;
    }
  };

  // Document actions
  const handleDeleteDocument = async (title, uploaded_by) => {
    try {
      await callAdminFunction('delete_document', { title, uploaded_by });
      // Remove from local state
      setDocuments(prev => prev.filter(d => d.title !== title || d.uploaded_by !== uploaded_by));
    } catch (err) {
      setError(err.message || 'Failed to delete document');
      throw err;
    }
  };

  // Render helpers
  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const resolveUploaderEmail = (uploadedById) => {
    const user = users.find(u => u.id === uploadedById);
    return user ? user.email : uploadedById || 'Unknown';
  };

  // Tab content rendering
  const renderUsersTab = () => {
    if (loading) return <div className="loading">Loading users...</div>;

    return (
      <div style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: 20, color: A.text }}>Users</h2>
          {/* FIX 2: Change onClick to only set showAddUserForm to true */}
          <button
            onClick={() => setShowAddUserForm(true)}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: `1px solid ${A.border}`,
              background: A.surface,
              color: A.primary,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            + Add user
          </button>
        </div>

        {/* Add user form */}
        {/* FIX 2: Change condition to showAddUserForm */}
        {showAddUserForm ? (
          <div style={{ background: A.surface, border: `1px solid ${A.border}`, borderRadius: 8, padding: '16px', marginBottom: '24px' }}>
            <h3 style={{ marginTop: 0, marginBottom: '12px', fontSize: 16, color: A.text }}>Add new user</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: 13, color: A.text }}>Email *</label>
                <input
                  type="email"
                  value={addUserForm.email}
                  onChange={(e) => setAddUserForm(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="user@example.com"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: `1px solid ${A.border}`,
                    borderRadius: 6,
                    fontSize: 13,
                    background: A.bg,
                    color: A.text,
                  }}
                  required
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: 13, color: A.text }}>Password *</label>
                <input
                  type="password"
                  value={addUserForm.password}
                  onChange={(e) => setAddUserForm(prev => ({ ...prev, password: e.target.value }))}
                  placeholder="••••••••"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: `1px solid ${A.border}`,
                    borderRadius: 6,
                    fontSize: 13,
                    background: A.bg,
                    color: A.text,
                  }}
                  required
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: 13, color: A.text }}>Full name</label>
                <input
                  type="text"
                  value={addUserForm.fullName}
                  onChange={(e) => setAddUserForm(prev => ({ ...prev, fullName: e.target.value }))}
                  placeholder="John Doe"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: `1px solid ${A.border}`,
                    borderRadius: 6,
                    fontSize: 13,
                    background: A.bg,
                    color: A.text,
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: 13, color: A.text }}>Role</label>
                <select
                  value={addUserForm.role}
                  onChange={(e) => setAddUserForm(prev => ({ ...prev, role: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: `1px solid ${A.border}`,
                    borderRadius: 6,
                    fontSize: 13,
                    background: A.bg,
                    color: A.text,
                  }}
                >
                  <option value="employee">Employee</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: 13, color: A.text }}>Department</label>
                <select
                  value={addUserForm.department}
                  onChange={(e) => setAddUserForm(prev => ({ ...prev, department: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: `1px solid ${A.border}`,
                    borderRadius: 6,
                    fontSize: 13,
                    background: A.bg,
                    color: A.text,
                  }}
                >
                  <option value="unassigned">Unassigned</option>
                  <option value="IT">IT</option>
                  <option value="CSE">CSE</option>
                  <option value="IT/CSE">IT/CSE</option>
                </select>
              </div>
            </div>
            <div style={{ marginTop: '16px', textAlign: 'right' }}>
              <button
                onClick={handleAddUser}
                disabled ={!addUserForm.email || !addUserForm.password}
                style={{
                  padding: '8px 16px',
                  borderRadius: 6,
                  border: 'none',
                  background: !addUserForm.email || !addUserForm.password ? A.disabled : A.primary,
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: !addUserForm.email || !addUserForm.password ? 'default' : 'pointer',
                }}
              >
                Add user
              </button>
              {/* FIX 2: Also set showAddUserForm to false on Cancel */}
              <button
                onClick={() => {
                  setAddUserForm(prev => ({ ...prev, email: '', password: '', fullName: '', role: 'employee', department: 'unassigned' }));
                  setShowAddUserForm(false);
                }}
                style={{
                  marginLeft: '8px',
                  padding: '8px 16px',
                  borderRadius: 6,
                  border: `1px solid ${A.border}`,
                  background: A.surface,
                  color: A.text,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {/* Bulk actions bar */}
        {selectedUserIds.size > 0 ? (
          <div style={{ background: A.surface, border: `1px solid ${A.border}`, borderRadius: 8, padding: '12px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: A.text }}>
                {selectedUserIds.size} user{selectedUserIds.size > 1 ? 's' : ''} selected
              </span>
              {!bulkActionConfirm ? (
                <>
                  <button
                    onClick={() => setBulkActionConfirm({ action: 'suspend' })}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 4,
                      border: `1px solid ${A.warning}`,
                      background: A.surface,
                      color: A.warning,
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    Suspend
                  </button>
                  <button
                    onClick={() => setBulkActionConfirm({ action: 'unsuspend' })}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 4,
                      border: `1px solid ${A.success}`,
                      background: A.surface,
                      color: A.success,
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    Unsuspend
                  </button>
                  <button
                    onClick={() => setBulkActionConfirm({ action: 'delete' })}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 4,
                      border: `1px solid ${A.warning}`,
                      background: A.surface,
                      color: A.warning,
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    Delete
                  </button>
                </>
              ) : (
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: A.text, lineHeight: 1.5 }}>
                    {bulkActionConfirm.action === 'delete'
                      ? `Delete ${selectedUserIds.size} user${selectedUserIds.size > 1 ? 's' : ''}? This cannot be undone.`
                      : bulkActionConfirm.action === 'suspend'
                        ? `Suspend ${selectedUserIds.size} user${selectedUserIds.size > 1 ? 's' : ''}?`
                        : `Unsuspend ${selectedUserIds.size} user${selectedUserIds.size > 1 ? 's' : ''}?`}
                  </span>
                  <button
                    onClick={() => {
                      if (bulkActionConfirm.action === 'suspend') {
                        handleBulkUpdateUsers({ suspended: true });
                      } else if (bulkActionConfirm.action === 'unsuspend') {
                        handleBulkUpdateUsers({ suspended: false });
                      } else if (bulkActionConfirm.action === 'delete') {
                        handleBulkDeleteUsers();
                      }
                      setBulkActionConfirm(null);
                    }}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 4,
                      border: `1px solid ${bulkActionConfirm.action === 'delete' || bulkActionConfirm.action === 'suspend' ? A.warning : A.success}`,
                      background: bulkActionConfirm.action === 'delete' || bulkActionConfirm.action === 'suspend' ? A.warning : A.success,
                      color: '#fff',
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setBulkActionConfirm(null)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 4,
                      border: `1px solid ${A.border}`,
                      background: A.surface,
                      color: A.text,
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* Users table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${A.border}` }}>
                <th style={{ textAlign: 'left', padding: '12px', fontSize: 14, fontWeight: 600, color: A.text }}>
                  <input
                    type="checkbox"
                    checked={selectedUserIds.size === users.length && users.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        users.forEach(u => selectedUserIds.add(u.id));
                        setSelectedUserIds(new Set(users.map(u => u.id)));
                      } else {
                        setSelectedUserIds(new Set());
                      }
                    }}
                    style={{ marginRight: '8px' }}
                  />
                </th>
                <th style={{ textAlign: 'left', padding: '12px', fontSize: 14, fontWeight: 600, color: A.text }}>Email</th>
                <th style={{ textAlign: 'left', padding: '12px', fontSize: 14, fontWeight: 600, color: A.text }}>Full Name</th>
                <th style={{ textAlign: 'left', padding: '12px', fontSize: 14, fontWeight: 600, color: A.text }}>Role</th>
                <th style={{ textAlign: 'left', padding: '12px', fontSize: 14, fontWeight: 600, color: A.text }}>Department</th>
                <th style={{ textAlign: 'left', padding: '12px', fontSize: 14, fontWeight: 600, color: A.text }}>Suspended</th>
                <th style={{ textAlign: 'left', padding: '12px', fontSize: 14, fontWeight: 600, color: A.text }}>Created</th>
                <th style={{ textAlign: 'left', padding: '12px', fontSize: 14, fontWeight: 600, color: A.text }}>Last Sign In</th>
                <th style={{ textAlign: 'left', padding: '12px', fontSize: 14, fontWeight: 600, color: A.text }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isSelected = selectedUserIds.has(user.id);
                return (
                  <tr
                    key={user.id}
                    style={{ borderBottom: `1px solid ${A.border}`, background: isSelected ? A.activeBg : 'transparent' }}
                  >
                    <td style={{ padding: '12px', verticalAlign: 'middle' }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          const newSet = new Set(selectedUserIds);
                          if (e.target.checked) {
                            newSet.add(user.id);
                          } else {
                            newSet.delete(user.id);
                          }
                          setSelectedUserIds(newSet);
                        }}
                      />
                    </td>
                    <td style={{ padding: '12px', verticalAlign: 'middle', wordBreak: 'break-all', color: A.text }}>{user.email}</td>
                    <td style={{ padding: '12px', verticalAlign: 'middle', color: A.text }}>{user.full_name || '—'}</td>
                    <td style={{ padding: '12px', verticalAlign: 'middle' }}>
                      <select
                        value={user.role}
                        onChange={(e) => handleUpdateUser(user.id, { role: e.target.value })}
                        style={{
                          padding: '4px 8px',
                          border: `1px solid ${A.border}`,
                          borderRadius: 4,
                          fontSize: 12,
                          fontWeight: 500,
                          background: A.bg,
                          color: A.text,
                        }}
                      >
                        <option value="employee">Employee</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td style={{ padding: '12px', verticalAlign: 'middle' }}>
                      <select
                        value={user.department}
                        onChange={(e) => handleUpdateUser(user.id, { department: e.target.value })}
                        style={{
                          padding: '4px 8px',
                          border: `1px solid ${A.border}`,
                          borderRadius: 4,
                          fontSize: 12,
                          fontWeight: 500,
                          background: A.bg,
                          color: A.text,
                        }}
                      >
                        <option value="unassigned">Unassigned</option>
                        <option value="IT">IT</option>
                        <option value="CSE">CSE</option>
                        <option value="IT/CSE">IT/CSE</option>
                      </select>
                    </td>
                    <td style={{ padding: '12px', verticalAlign: 'middle' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={user.suspended}
                          onChange={(e) => handleUpdateUser(user.id, { suspended: e.target.checked })}
                          style={{ width: 14, height: 14 }}
                        />
                        <span style={{ fontSize: 13, color: A.text }}>{user.suspended ? 'Yes' : 'No'}</span>
                      </label>
                    </td>
                    <td style={{ padding: '12px', verticalAlign: 'middle', color: A.text }}>{formatDate(user.created_at)}</td>
                    <td style={{ padding: '12px', verticalAlign: 'middle', color: A.text }}>{formatDate(user.last_sign_in_at)}</td>
                    <td style={{ padding: '12px', verticalAlign: 'middle' }}>
                      {!deleteUserConfirm || deleteUserConfirm !== user.id ? (
                        <button
                          onClick={() => setDeleteUserConfirm(user.id)}
                          style={{
                            padding: '4px 8px',
                            borderRadius: 4,
                            border: `1px solid ${A.warning}`,
                            background: A.surface,
                            color: A.warning,
                            fontSize: 12,
                            fontWeight: 500,
                            cursor: 'pointer',
                          }}
                        >
                          Delete
                        </button>
                      ) : (
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <button
                            onClick={() => {
                              handleDeleteUser(user.id);
                              setDeleteUserConfirm(null);
                            }}
                            style={{
                              padding: '4px 8px',
                              borderRadius: 4,
                              border: `1px solid ${A.warning}`,
                              background: A.warning,
                              color: '#fff',
                              fontSize: 12,
                              fontWeight: 500,
                              cursor: 'pointer',
                            }}
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setDeleteUserConfirm(null)}
                            style={{
                              padding: '4px 8px',
                              borderRadius: 4,
                              border: `1px solid ${A.border}`,
                              background: A.surface,
                              color: A.text,
                              fontSize: 12,
                              fontWeight: 500,
                              cursor: 'pointer',
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan="9" style={{ textAlign: 'center', padding: '24px', color: A.muted }}>
                    No users found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderDocumentsTab = () => {
    if (loading) return <div className="loading">Loading documents...</div>;

    return (
      <div style={{ padding: '24px' }}>
        <h2 style={{ margin: '0 0 16px 0', fontSize: 20, color: A.text }}>Documents</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${A.border}` }}>
                <th style={{ textAlign: 'left', padding: '12px', fontSize: 14, fontWeight: 600, color: A.text }}>Title</th>
                <th style={{ textAlign: 'left', padding: '12px', fontSize: 14, fontWeight: 600, color: A.text }}>Uploaded by</th>
                <th style={{ textAlign: 'left', padding: '12px', fontSize: 14, fontWeight: 600, color: A.text }}>Chunks</th>
                <th style={{ textAlign: 'left', padding: '12px', fontSize: 14, fontWeight: 600, color: A.text }}>Size</th>
                <th style={{ textAlign: 'left', padding: '12px', fontSize: 14, fontWeight: 600, color: A.text }}>First uploaded</th>
                <th style={{ textAlign: 'left', padding: '12px', fontSize: 14, fontWeight: 600, color: A.text }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr
                  key={doc.title}
                  style={{ borderBottom: `1px solid ${A.border}` }}
                >
                  <td style={{ padding: '12px', verticalAlign: 'middle', wordBreak: 'break-all', maxWidth: 300, color: A.text }}>
                    {doc.title}
                  </td>
                  <td style={{ padding: '12px', verticalAlign: 'middle', color: A.text }}>
                    {resolveUploaderEmail(doc.uploaded_by)}
                  </td>
                  <td style={{ padding: '12px', verticalAlign: 'middle', color: A.text }}>{doc.chunkCount?.toLocaleString() || '0'}</td>
                  <td style={{ padding: '12px', verticalAlign: 'middle', color: A.text }}>
                    {(doc.totalChars || 0).toLocaleString()} characters
                  </td>
                  <td style={{ padding: '12px', verticalAlign: 'middle', color: A.text }}>{formatDate(doc.firstUploaded)}</td>
                  <td style={{ padding: '12px', verticalAlign: 'middle' }}>
                    {!deleteDocumentConfirm ||
                     (deleteDocumentConfirm.title !== doc.title || deleteDocumentConfirm.uploaded_by !== doc.uploaded_by) ? (
                      <button
                        onClick={() => setDeleteDocumentConfirm({ title: doc.title, uploaded_by: doc.uploaded_by })}
                        style={{
                          padding: '4px 8px',
                          borderRadius: 4,
                          border: `1px solid ${A.warning}`,
                          background: A.surface,
                          color: A.warning,
                          fontSize: 12,
                          fontWeight: 500,
                          cursor: 'pointer',
                        }}
                      >
                        Delete
                      </button>
                    ) : (
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button
                          onClick={() => {
                            handleDeleteDocument(doc.title, doc.uploaded_by);
                            setDeleteDocumentConfirm(null);
                          }}
                          style={{
                            padding: '4px 8px',
                            borderRadius: 4,
                            border: `1px solid ${A.warning}`,
                            background: A.warning,
                            color: '#fff',
                            fontSize: 12,
                            fontWeight: 500,
                            cursor: 'pointer',
                          }}
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setDeleteDocumentConfirm(null)}
                          style={{
                            padding: '4px 8px',
                            borderRadius: 4,
                            border: `1px solid ${A.border}`,
                            background: A.surface,
                            color: A.text,
                            fontSize: 12,
                            fontWeight: 500,
                            cursor: 'pointer',
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {documents.length === 0 && (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: '24px', color: A.muted }}>
                    No documents found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderActivityLogTab = () => {
    if (loading) return <div className="loading">Loading activity log...</div>;

    return (
      <div style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: 20, color: A.text }}>Activity Log</h2>
          <button
            onClick={loadDashboardData}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: `1px solid ${A.border}`,
              background: A.surface,
              color: A.primary,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Refresh
          </button>
        </div>
        <div style={{ maxHeight: '60vh', overflowY: 'auto', border: `1px solid ${A.border}`, borderRadius: 8 }}>
          {activityLog.map((event) => (
            <div
              key={event.id}
              style={{
                padding: '12px 16px',
                borderBottom: event.id !== activityLog[activityLog.length - 1]?.id ? `1px solid ${A.border}` : 'none',
                background: A.surface,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ fontSize: 13, color: A.muted }}>
                  {new Date(event.created_at).toLocaleString()}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, textTransform: 'capitalize', color: A.text }}>
                  {event.action === 'chat' ? 'Chat' : event.action === 'upload' ? 'Upload' : 'Admin Action'}
                </span>
              </div>
              <div style={{ fontSize: 13, color: A.text, marginBottom: '4px' }}>
                <strong>{resolveUploaderEmail(event.user_id) || 'System'}</strong> performed this action
              </div>
              <div style={{ fontSize: 12, fontWeight: 500, color: A.muted, wordBreak: 'break-all', lineHeight: 1.5 }}>
                {event.detail ? JSON.stringify(event.detail, null, 2).slice(0, 200) + (JSON.stringify(event.detail).length > 200 ? '...' : '') : 'No details'}
              </div>
            </div>
          ))}
          {activityLog.length === 0 && (
            <div style={{ textAlign: 'center', padding: '24px', color: A.muted }}>
              No activity found
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderUsageTab = () => {
    if (loading || !usageStats) return <div className="loading">Loading usage stats...</div>;

    return (
      <div style={{ padding: '24px' }}>
        <h2 style={{ margin: '0 0 24px 0', fontSize: 20, color: A.text }}>Usage Statistics</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          {[
            { label: 'Total Users', value: usageStats.totalUsers?.toLocaleString() || '0' },
            { label: 'Total Conversations', value: usageStats.totalConversations?.toLocaleString() || '0' },
            { label: 'Total Messages', value: usageStats.totalMessages?.toLocaleString() || '0' },
            { label: 'Total Documents', value: usageStats.totalDocuments?.toLocaleString() || '0' },
            { label: 'Total Activity Events', value: usageStats.totalActivityEvents?.toLocaleString() || '0' },
          ].map((stat) => (
            <div
              key={stat.label}
              style={{
                background: A.surface,
                border: `1px solid ${A.border}`,
                borderRadius: 8,
                padding: '20px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 32, fontWeight: 700, color: A.primary, marginBottom: '8px' }}>
                {stat.value}
              </div>
              <div style={{ fontSize: 14, color: A.text }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Main render
  if (authLoading) {
    return <div style={{ textAlign: 'center', padding: '40px' }}>Loading...</div>;
  }

  // Redirect if not admin or not logged in (checked after auth loads)
  if (!user || !isAdmin) {
    // If not logged in, go to login; if logged in but not admin, go to home
    return <Navigate to={!user ? '/login' : '/'} replace />;
  }

  return (
    <div style={{ minHeight: '100vh', background: A.bg, fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '14px 24px', background: A.surface, borderBottom: `1px solid ${A.border}`,
      }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: A.heading }}>
          {BRAND.name}
        </div>
        <Link
          to="/"
          style={{ fontSize: 14, color: A.primary, fontWeight: 600, textDecoration: 'none' }}
        >
          ← Back to Home
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 13, color: A.muted }}>{user?.email}</span>
          {/* FIX 3: Change onClick to call signOut() */}
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

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${A.border}`, background: A.surface }}>
        {[ 'Users', 'Documents', 'Activity Log', 'Usage' ].map((tab) => (
          <div
            key={tab}
            onClick={() => {
              setError('');
              setActiveTab(tab);
            }}
            style={{
              flex: 1,
              padding: '12px 16px',
              textAlign: 'center',
              fontWeight: activeTab === tab ? 600 : 400,
              fontSize: 13,
              color: activeTab === tab ? A.primary : A.muted,
              borderBottom: activeTab === tab ? `2px solid ${A.primary}` : 'transparent',
              cursor: 'pointer',
            }}
          >
            {tab}
          </div>
        ))}
      </div>

      {/* Error message */}
      {error && (
        <div style={{ maxWidth: '800px',
          margin: '16px auto',
          padding: '12px 16px',
          background: A.warningBg,
          border: `1px solid ${A.warningBorder}`,
          borderRadius: 8,
          fontSize: 13,
          color: A.warning,
        }}>
          {error}
        </div>
      )}

      {/* Tab content */}
      <div style={{ maxWidth: '1200px', margin: '24px auto', padding: '0 24px' }}>
        {activeTab === 'Users' && renderUsersTab()}
        {activeTab === 'Documents' && renderDocumentsTab()}
        {activeTab === 'Activity Log' && renderActivityLogTab()}
        {activeTab === 'Usage' && renderUsageTab()}
      </div>
    </div>
  );
}
