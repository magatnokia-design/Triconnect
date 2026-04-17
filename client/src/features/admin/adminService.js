import { supabase } from '../../config/supabase'

const DEFAULT_API_BASE_URL = import.meta.env.DEV ? 'http://localhost:5000' : window.location.origin
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, '')

async function getAuthHeader() {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data?.session?.access_token) {
    throw new Error('You must be signed in to access admin APIs.')
  }

  return {
    Authorization: `Bearer ${data.session.access_token}`,
    'Content-Type': 'application/json',
  }
}

async function request(path, options = {}) {
  const headers = await getAuthHeader()
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {}),
    },
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data?.message || 'Admin request failed.')
  }

  return data
}

export const getAdminStats = async () => request('/api/admin/stats')

export const getAdminUsers = async ({ search = '', page = 1, pageSize = 20 } = {}) => {
  const query = new URLSearchParams({
    search,
    page: String(page),
    pageSize: String(pageSize),
  })
  return request(`/api/admin/users?${query.toString()}`)
}

export const updateAdminUser = async (userId, payload) =>
  request(`/api/admin/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })

export const getAdminClasses = async ({ search = '', page = 1, pageSize = 20 } = {}) => {
  const query = new URLSearchParams({
    search,
    page: String(page),
    pageSize: String(pageSize),
  })
  return request(`/api/admin/classes?${query.toString()}`)
}

export const applyClassIntervention = async (classId, payload) =>
  request(`/api/admin/classes/${classId}/intervention`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })

export const getAdminAuditLogs = async ({ page = 1, pageSize = 20, action = '', actorId = '', from = '', to = '' } = {}) => {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    action,
    actorId,
    from,
    to,
  })
  return request(`/api/admin/audit-logs?${query.toString()}`)
}

export const getContentFeed = async ({ limit = 100 } = {}) => {
  const query = new URLSearchParams({ limit: String(limit) })
  return request(`/api/admin/content/feed?${query.toString()}`)
}

export const getContentFlags = async ({ status = '', limit = 100 } = {}) => {
  const query = new URLSearchParams({ status, limit: String(limit) })
  return request(`/api/admin/content/flags?${query.toString()}`)
}

export const createContentFlag = async (payload) =>
  request('/api/admin/content/flags', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const reviewContentFlag = async (flagId, payload) =>
  request(`/api/admin/content/flags/${flagId}/review`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })

export const triggerPasswordReset = async (userId) =>
  request(`/api/admin/support/users/${userId}/password-reset`, { method: 'POST' })

export const resendVerification = async (userId) =>
  request(`/api/admin/support/users/${userId}/resend-verification`, { method: 'POST' })

export const revokeUserSessions = async (userId) =>
  request(`/api/admin/support/users/${userId}/revoke-sessions`, { method: 'POST' })

export const getPlatformHealth = async () => request('/api/admin/platform-health')
