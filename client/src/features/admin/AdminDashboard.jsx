import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield, Users, BookOpen, ClipboardList, Search, RefreshCw } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import Logo from '../../shared/components/Logo'
import NotificationBell from '../notifications/NotificationBell'
import {
  applyClassIntervention,
  createContentFlag,
  getAdminAuditLogs,
  getAdminClasses,
  getAdminStats,
  getAdminUsers,
  getContentFeed,
  getContentFlags,
  getPlatformHealth,
  resendVerification,
  revokeUserSessions,
  reviewContentFlag,
  triggerPasswordReset,
  updateAdminUser,
} from './adminService'

const PAGE_SIZE = 12

function AdminDashboard() {
  const navigate = useNavigate()
  const { profile, signOut } = useAuthStore()

  const [stats, setStats] = useState({ totalUsers: 0, totalClasses: 0, totalQuizzes: 0 })
  const [statsLoading, setStatsLoading] = useState(true)

  const [userSearch, setUserSearch] = useState('')
  const [users, setUsers] = useState([])
  const [usersTotal, setUsersTotal] = useState(0)
  const [usersPage, setUsersPage] = useState(1)
  const [usersLoading, setUsersLoading] = useState(true)
  const [userActionLoadingId, setUserActionLoadingId] = useState('')

  const [classSearch, setClassSearch] = useState('')
  const [classes, setClasses] = useState([])
  const [classesTotal, setClassesTotal] = useState(0)
  const [classesPage, setClassesPage] = useState(1)
  const [classesLoading, setClassesLoading] = useState(true)

  const [health, setHealth] = useState({
    activeUsers7d: 0,
    activeUsers30d: 0,
    lowActivityClasses: [],
    failedQuizRate: 0,
    failedMeetingRate: 0,
  })
  const [healthLoading, setHealthLoading] = useState(true)

  const [auditLogs, setAuditLogs] = useState([])
  const [auditLoading, setAuditLoading] = useState(true)

  const [contentFeed, setContentFeed] = useState([])
  const [contentFeedLoading, setContentFeedLoading] = useState(true)

  const [contentFlags, setContentFlags] = useState([])
  const [flagsLoading, setFlagsLoading] = useState(true)

  const [error, setError] = useState('')

  const usersMaxPage = useMemo(() => Math.max(Math.ceil(usersTotal / PAGE_SIZE), 1), [usersTotal])
  const classesMaxPage = useMemo(() => Math.max(Math.ceil(classesTotal / PAGE_SIZE), 1), [classesTotal])

  const loadStats = async () => {
    setStatsLoading(true)
    const data = await getAdminStats()
    setStats({
      totalUsers: data.totalUsers || 0,
      totalClasses: data.totalClasses || 0,
      totalQuizzes: data.totalQuizzes || 0,
    })
    setStatsLoading(false)
  }

  const loadUsers = async (page = usersPage, search = userSearch) => {
    setUsersLoading(true)
    const data = await getAdminUsers({ page, pageSize: PAGE_SIZE, search })
    setUsers(data.users || [])
    setUsersTotal(data.total || 0)
    setUsersLoading(false)
  }

  const loadClasses = async (page = classesPage, search = classSearch) => {
    setClassesLoading(true)
    const data = await getAdminClasses({ page, pageSize: PAGE_SIZE, search })
    setClasses(data.classes || [])
    setClassesTotal(data.total || 0)
    setClassesLoading(false)
  }

  const loadPlatformHealth = async () => {
    setHealthLoading(true)
    const data = await getPlatformHealth()
    setHealth({
      activeUsers7d: data.activeUsers7d || 0,
      activeUsers30d: data.activeUsers30d || 0,
      lowActivityClasses: data.lowActivityClasses || [],
      failedQuizRate: data.failedQuizRate || 0,
      failedMeetingRate: data.failedMeetingRate || 0,
    })
    setHealthLoading(false)
  }

  const loadAuditLogs = async () => {
    setAuditLoading(true)
    const data = await getAdminAuditLogs({ page: 1, pageSize: 20 })
    setAuditLogs(data.logs || [])
    setAuditLoading(false)
  }

  const loadContentFeed = async () => {
    setContentFeedLoading(true)
    const data = await getContentFeed({ limit: 80 })
    setContentFeed(data.items || [])
    setContentFeedLoading(false)
  }

  const loadContentFlags = async () => {
    setFlagsLoading(true)
    const data = await getContentFlags({ limit: 80 })
    setContentFlags(data.flags || [])
    setFlagsLoading(false)
  }

  const refreshAll = async () => {
    setError('')
    try {
      await Promise.all([
        loadStats(),
        loadUsers(1, userSearch),
        loadClasses(1, classSearch),
        loadPlatformHealth(),
        loadAuditLogs(),
        loadContentFeed(),
        loadContentFlags(),
      ])
      setUsersPage(1)
      setClassesPage(1)
    } catch (loadError) {
      setError(loadError.message || 'Failed to load admin data.')
      setStatsLoading(false)
      setUsersLoading(false)
      setClassesLoading(false)
      setHealthLoading(false)
      setAuditLoading(false)
      setContentFeedLoading(false)
      setFlagsLoading(false)
    }
  }

  useEffect(() => {
    refreshAll()
  }, [])

  useEffect(() => {
    loadUsers(usersPage, userSearch).catch((loadError) => {
      setError(loadError.message || 'Failed to load users.')
      setUsersLoading(false)
    })
  }, [usersPage])

  useEffect(() => {
    loadClasses(classesPage, classSearch).catch((loadError) => {
      setError(loadError.message || 'Failed to load classes.')
      setClassesLoading(false)
    })
  }, [classesPage])

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const handleSearchUsers = async (event) => {
    event.preventDefault()
    setUsersPage(1)
    try {
      await loadUsers(1, userSearch)
    } catch (loadError) {
      setError(loadError.message || 'Failed to search users.')
    }
  }

  const handleSearchClasses = async (event) => {
    event.preventDefault()
    setClassesPage(1)
    try {
      await loadClasses(1, classSearch)
    } catch (loadError) {
      setError(loadError.message || 'Failed to search classes.')
    }
  }

  const handleToggleStatus = async (user) => {
    setUserActionLoadingId(user.id)
    setError('')

    const nextStatus = user.account_status === 'deactivated' ? 'active' : 'deactivated'
    const reason = prompt(`Reason for ${nextStatus}:`, user.status_reason || '') || ''

    try {
      await updateAdminUser(user.id, { account_status: nextStatus, status_reason: reason })
      await loadUsers(usersPage, userSearch)
      await loadAuditLogs()
    } catch (actionError) {
      setError(actionError.message || 'Failed to update account status.')
    }

    setUserActionLoadingId('')
  }

  const handleSupportAction = async (action, userId) => {
    setUserActionLoadingId(userId)
    setError('')

    try {
      if (action === 'reset') {
        const data = await triggerPasswordReset(userId)
        if (data?.action_link) {
          alert(`Password reset link generated:\n${data.action_link}`)
        } else {
          alert('Password reset flow triggered.')
        }
      }

      if (action === 'verify') {
        await resendVerification(userId)
        alert('Verification/invite email sent.')
      }

      if (action === 'revoke') {
        const data = await revokeUserSessions(userId)
        alert(`Revoked sessions: ${data.revoked_sessions || 0}`)
      }

      await loadAuditLogs()
    } catch (actionError) {
      setError(actionError.message || 'Support action failed.')
    }

    setUserActionLoadingId('')
  }

  const handleClassAction = async (classId, action) => {
    setError('')

    try {
      if (action === 'transfer_owner') {
        const teacherId = prompt('Enter new teacher profile id:')
        if (!teacherId) return
        await applyClassIntervention(classId, { action, teacher_id: teacherId.trim() })
      } else {
        await applyClassIntervention(classId, { action })
      }

      await Promise.all([loadClasses(classesPage, classSearch), loadAuditLogs()])
    } catch (actionError) {
      setError(actionError.message || 'Failed class intervention action.')
    }
  }

  const handleFlagContent = async (item) => {
    const reason = prompt('Flag reason:', 'Needs review')
    if (!reason) return

    try {
      await createContentFlag({
        class_id: item.class_id,
        entity_type: item.entity_type,
        entity_id: item.entity_id,
        reason,
        details: item.body || null,
      })

      await Promise.all([loadContentFlags(), loadAuditLogs()])
    } catch (flagError) {
      setError(flagError.message || 'Failed to create moderation flag.')
    }
  }

  const handleReviewFlag = async (flagId, status) => {
    const reviewNotes = prompt('Review notes (optional):', '') || ''

    try {
      await reviewContentFlag(flagId, { status, review_notes: reviewNotes })
      await Promise.all([loadContentFlags(), loadAuditLogs()])
    } catch (reviewError) {
      setError(reviewError.message || 'Failed to review flag.')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="sticky top-0 z-10 border-b border-gray-100 bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Logo size="sm" />
          <div className="flex items-center gap-3">
            <NotificationBell userId={profile?.id} />
            <div className="hidden items-center gap-2 md:flex">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-dark text-sm font-bold text-white">
                {profile?.full_name?.charAt(0).toUpperCase()}
              </div>
              <span className="text-sm font-medium text-gray-700">{profile?.full_name}</span>
            </div>
            <button onClick={handleSignOut} className="text-sm font-medium text-gray-500 transition hover:text-primary">
              Sign Out
            </button>
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-7xl space-y-8 px-6 py-8">
        <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 p-7 text-white">
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
          <div className="absolute -bottom-10 left-10 h-32 w-32 rounded-full bg-white/10" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-200">System Control</p>
              <h1 className="mt-1 text-2xl font-bold md:text-3xl">Admin Panel</h1>
              <p className="mt-2 text-sm text-slate-200">Manage users, monitor classes, and review platform-wide metrics.</p>
            </div>
            <button
              onClick={refreshAll}
              className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20"
            >
              <RefreshCw size={15} /> Refresh
            </button>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <section className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Total Users" icon={<Users size={18} />} value={stats.totalUsers} loading={statsLoading} />
          <StatCard label="Total Classes" icon={<BookOpen size={18} />} value={stats.totalClasses} loading={statsLoading} />
          <StatCard label="Total Quizzes" icon={<ClipboardList size={18} />} value={stats.totalQuizzes} loading={statsLoading} />
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="inline-flex items-center gap-2 text-lg font-bold text-gray-900"><Shield size={18} /> User Management</h2>
            <form onSubmit={handleSearchUsers} className="flex items-center gap-2">
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-2 top-2.5 text-gray-400" />
                <input
                  value={userSearch}
                  onChange={(event) => setUserSearch(event.target.value)}
                  placeholder="Search users"
                  className="rounded-xl border border-gray-200 py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <button className="rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary-dark">Find</button>
            </form>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-2 py-2">Name</th>
                  <th className="px-2 py-2">Email</th>
                  <th className="px-2 py-2">Role</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {usersLoading ? (
                  <tr><td className="px-2 py-4 text-gray-500" colSpan={5}>Loading users...</td></tr>
                ) : users.length === 0 ? (
                  <tr><td className="px-2 py-4 text-gray-500" colSpan={5}>No users found.</td></tr>
                ) : (
                  users.map((user) => {
                    const status = user.account_status || 'active'
                    const busy = userActionLoadingId === user.id

                    return (
                      <tr key={user.id} className="border-b border-gray-100">
                        <td className="px-2 py-3 font-semibold text-gray-800">{user.full_name || 'Unknown'}</td>
                        <td className="px-2 py-3 text-gray-600">{user.email}</td>
                        <td className="px-2 py-3">
                          <span className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-semibold text-gray-700">
                            {user.role || 'student'}
                          </span>
                        </td>
                        <td className="px-2 py-3">
                          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${status === 'deactivated' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                            {status}
                          </span>
                          {user.status_reason && (
                            <p className="mt-1 text-[11px] text-gray-500">{user.status_reason}</p>
                          )}
                        </td>
                        <td className="px-2 py-3">
                          <div className="flex flex-wrap gap-1">
                            <button
                              onClick={() => handleToggleStatus(user)}
                              disabled={busy}
                              className={`rounded-lg px-3 py-1 text-xs font-semibold text-white ${
                                status === 'deactivated' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-500 hover:bg-red-600'
                              }`}
                            >
                              {busy ? 'Saving...' : (status === 'deactivated' ? 'Reactivate' : 'Deactivate')}
                            </button>
                            <button
                              onClick={() => handleSupportAction('reset', user.id)}
                              disabled={busy}
                              className="rounded-lg border border-blue-200 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50"
                            >
                              Reset Pass
                            </button>
                            <button
                              onClick={() => handleSupportAction('verify', user.id)}
                              disabled={busy}
                              className="rounded-lg border border-indigo-200 px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50"
                            >
                              Resend Verify
                            </button>
                            <button
                              onClick={() => handleSupportAction('revoke', user.id)}
                              disabled={busy}
                              className="rounded-lg border border-amber-200 px-2 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-50"
                            >
                              Revoke Sessions
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          <Pagination page={usersPage} maxPage={usersMaxPage} onPageChange={setUsersPage} />
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-gray-900">Class Oversight</h2>
            <form onSubmit={handleSearchClasses} className="flex items-center gap-2">
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-2 top-2.5 text-gray-400" />
                <input
                  value={classSearch}
                  onChange={(event) => setClassSearch(event.target.value)}
                  placeholder="Search classes"
                  className="rounded-xl border border-gray-200 py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <button className="rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary-dark">Find</button>
            </form>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-2 py-2">Class</th>
                  <th className="px-2 py-2">Subject</th>
                  <th className="px-2 py-2">Teacher</th>
                  <th className="px-2 py-2">Students</th>
                  <th className="px-2 py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {classesLoading ? (
                  <tr><td className="px-2 py-4 text-gray-500" colSpan={5}>Loading classes...</td></tr>
                ) : classes.length === 0 ? (
                  <tr><td className="px-2 py-4 text-gray-500" colSpan={5}>No classes found.</td></tr>
                ) : (
                  classes.map((cls) => (
                    <tr key={cls.id} className="border-b border-gray-100">
                      <td className="px-2 py-3 font-semibold text-gray-800">{cls.name}</td>
                      <td className="px-2 py-3 text-gray-600">{cls.subject || '—'} {cls.section ? `(${cls.section})` : ''}</td>
                      <td className="px-2 py-3 text-gray-600">{cls.teacher_profile?.full_name || cls.teacher_profile?.email || 'Unknown'}</td>
                      <td className="px-2 py-3 text-gray-700">{cls.student_count}</td>
                      <td className="px-2 py-3 text-gray-500">
                        <p>{new Date(cls.created_at).toLocaleDateString()}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <button
                            onClick={() => handleClassAction(cls.id, cls.is_archived ? 'unarchive' : 'archive')}
                            className={`rounded px-2 py-0.5 text-[10px] font-semibold ${cls.is_archived ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}
                          >
                            {cls.is_archived ? 'Unarchive' : 'Archive'}
                          </button>
                          <button
                            onClick={() => handleClassAction(cls.id, cls.posting_locked ? 'unlock_posting' : 'lock_posting')}
                            className={`rounded px-2 py-0.5 text-[10px] font-semibold ${cls.posting_locked ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}
                          >
                            {cls.posting_locked ? 'Unlock Posting' : 'Lock Posting'}
                          </button>
                          <button
                            onClick={() => handleClassAction(cls.id, 'transfer_owner')}
                            className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700"
                          >
                            Transfer Owner
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <Pagination page={classesPage} maxPage={classesMaxPage} onPageChange={setClassesPage} />
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-bold text-gray-900">Platform Health</h3>
            {healthLoading ? (
              <p className="mt-3 text-sm text-gray-500">Loading platform health...</p>
            ) : (
              <div className="mt-3 space-y-2 text-sm text-gray-700">
                <p><strong>Active Users (7d):</strong> {health.activeUsers7d}</p>
                <p><strong>Active Users (30d):</strong> {health.activeUsers30d}</p>
                <p><strong>Failed Quiz Rate:</strong> {health.failedQuizRate}%</p>
                <p><strong>Failed Meeting Rate:</strong> {health.failedMeetingRate}%</p>
                <div>
                  <p className="font-semibold">Low Activity Classes (30d):</p>
                  {(health.lowActivityClasses || []).length === 0 ? (
                    <p className="text-gray-500">No low-activity classes found.</p>
                  ) : (
                    <ul className="mt-1 space-y-1 text-xs text-gray-600">
                      {health.lowActivityClasses.map((cls) => (
                        <li key={cls.id}>{cls.name}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-bold text-gray-900">Audit Logs</h3>
            {auditLoading ? (
              <p className="mt-3 text-sm text-gray-500">Loading audit logs...</p>
            ) : auditLogs.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">No admin actions logged yet.</p>
            ) : (
              <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                {auditLogs.map((log) => (
                  <div key={log.id} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-xs">
                    <p className="font-semibold text-gray-800">{log.action}</p>
                    <p className="text-gray-600">Actor: {log.actor_profile?.full_name || log.actor_profile?.email || log.actor_id}</p>
                    <p className="text-gray-500">{new Date(log.created_at).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-bold text-gray-900">Content Feed</h3>
            {contentFeedLoading ? (
              <p className="mt-3 text-sm text-gray-500">Loading content feed...</p>
            ) : contentFeed.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">No content found.</p>
            ) : (
              <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                {contentFeed.map((item) => (
                  <div key={`${item.entity_type}-${item.entity_id}`} className="rounded-xl border border-gray-100 px-3 py-2 text-xs">
                    <p className="font-semibold text-gray-800">{item.entity_type} · {item.title || 'Untitled'}</p>
                    {item.body && <p className="mt-1 text-gray-600 line-clamp-2">{item.body}</p>}
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-gray-500">{new Date(item.created_at).toLocaleString()}</span>
                      <button
                        onClick={() => handleFlagContent(item)}
                        className="rounded bg-red-100 px-2 py-0.5 font-semibold text-red-700"
                      >
                        Flag
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-bold text-gray-900">Moderation Flags</h3>
            {flagsLoading ? (
              <p className="mt-3 text-sm text-gray-500">Loading moderation flags...</p>
            ) : contentFlags.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">No flags yet.</p>
            ) : (
              <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                {contentFlags.map((flag) => (
                  <div key={flag.id} className="rounded-xl border border-gray-100 px-3 py-2 text-xs">
                    <p className="font-semibold text-gray-800">{flag.entity_type} · {flag.reason}</p>
                    {flag.details && <p className="mt-1 text-gray-600 line-clamp-2">{flag.details}</p>}
                    <p className="mt-1 text-gray-500">Status: {flag.status}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <button onClick={() => handleReviewFlag(flag.id, 'reviewed')} className="rounded bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700">Mark Reviewed</button>
                      <button onClick={() => handleReviewFlag(flag.id, 'dismissed')} className="rounded bg-gray-200 px-2 py-0.5 font-semibold text-gray-700">Dismiss</button>
                      <button onClick={() => handleReviewFlag(flag.id, 'open')} className="rounded bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">Reopen</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function StatCard({ label, icon, value, loading }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-2 inline-flex rounded-xl bg-blue-50 p-2 text-primary">{icon}</div>
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{loading ? '...' : value}</p>
    </div>
  )
}

function Pagination({ page, maxPage, onPageChange }) {
  return (
    <div className="mt-4 flex items-center justify-end gap-2">
      <button
        onClick={() => onPageChange(Math.max(page - 1, 1))}
        disabled={page <= 1}
        className="rounded-lg border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-600 disabled:opacity-50"
      >
        Prev
      </button>
      <span className="text-xs text-gray-500">Page {page} of {maxPage}</span>
      <button
        onClick={() => onPageChange(Math.min(page + 1, maxPage))}
        disabled={page >= maxPage}
        className="rounded-lg border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-600 disabled:opacity-50"
      >
        Next
      </button>
    </div>
  )
}

export default AdminDashboard
