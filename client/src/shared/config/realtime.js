const DEFAULT_API_BASE_URL = import.meta.env.DEV ? 'http://localhost:5000' : window.location.origin
const DEFAULT_PROJECT_SOCKET_URL = 'https://triconnect-realtime.onrender.com'
const PROJECT_HOSTNAMES = new Set(['triconnect.online', 'www.triconnect.online'])

function trimTrailingSlash(value) {
  return `${value || ''}`.replace(/\/$/, '')
}

function normalizePath(path) {
  if (!path) return ''
  return path.startsWith('/') ? path : `/${path}`
}

function getOrigin(urlLike) {
  try {
    return new URL(urlLike).origin
  } catch {
    return ''
  }
}

function getProjectSocketFallbackUrl() {
  if (import.meta.env.DEV) return ''

  const configuredSocketUrl = `${import.meta.env.VITE_SOCKET_URL || ''}`.trim()
  if (configuredSocketUrl) return ''

  const currentHostname = window.location.hostname.toLowerCase()
  const isProjectHostname = PROJECT_HOSTNAMES.has(currentHostname)
    || currentHostname.endsWith('.triconnect.online')
    || currentHostname.endsWith('.vercel.app')
  if (!isProjectHostname) return ''

  return trimTrailingSlash(import.meta.env.VITE_PROJECT_SOCKET_FALLBACK_URL || DEFAULT_PROJECT_SOCKET_URL)
}

export const API_BASE_URL = trimTrailingSlash(import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL)

const projectSocketFallbackUrl = getProjectSocketFallbackUrl()
const configuredSocketUrl = `${import.meta.env.VITE_SOCKET_URL || ''}`.trim()

export const SOCKET_URL = trimTrailingSlash(configuredSocketUrl || projectSocketFallbackUrl || API_BASE_URL)

const socketOrigin = getOrigin(SOCKET_URL)
const currentOrigin = window.location.origin
const isExternalSocketHost = Boolean(socketOrigin) && socketOrigin !== currentOrigin

const defaultSocketPath = import.meta.env.DEV || configuredSocketUrl || isExternalSocketHost
  ? '/socket.io'
  : '/api/socket.io'

export const SOCKET_PATH = normalizePath(import.meta.env.VITE_SOCKET_PATH || defaultSocketPath)

function parseTransports(value) {
  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeTransports(transports = [], { preferPollingFirst = false } = {}) {
  const allowed = new Set(['polling', 'websocket'])
  const normalized = []

  for (const transport of transports) {
    if (!allowed.has(transport)) continue
    if (!normalized.includes(transport)) {
      normalized.push(transport)
    }
  }

  if (preferPollingFirst && normalized.includes('polling') && normalized.includes('websocket')) {
    return ['polling', 'websocket']
  }

  return normalized
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(`${value}`.toLowerCase())
}

function parseNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const isServerlessSameOriginMode = !import.meta.env.DEV && !configuredSocketUrl && !isExternalSocketHost
const isExternalSocketHostMode = !import.meta.env.DEV && isExternalSocketHost

const configuredTransports = normalizeTransports(parseTransports(import.meta.env.VITE_SOCKET_TRANSPORTS), {
  preferPollingFirst: isExternalSocketHostMode,
})

const defaultTransports = configuredTransports.length > 0
  ? configuredTransports
  : (isServerlessSameOriginMode ? ['polling'] : ['polling', 'websocket'])

const defaultReconnectionEnabled = true
const reconnectionEnabled = parseBoolean(import.meta.env.VITE_SOCKET_RECONNECTION, defaultReconnectionEnabled)

const defaultReconnectionAttempts = isServerlessSameOriginMode
  ? 8
  : (isExternalSocketHostMode ? 20 : 5)
const defaultReconnectionDelay = isServerlessSameOriginMode
  ? 500
  : (isExternalSocketHostMode ? 1200 : 1200)
const defaultReconnectionDelayMax = isServerlessSameOriginMode
  ? 1500
  : (isExternalSocketHostMode ? 5000 : 3000)
const defaultSocketTimeoutMs = isExternalSocketHostMode ? 20000 : 10000

const reconnectionAttempts = parseNumber(import.meta.env.VITE_SOCKET_RECONNECTION_ATTEMPTS, defaultReconnectionAttempts)
const reconnectionDelay = parseNumber(import.meta.env.VITE_SOCKET_RECONNECTION_DELAY_MS, defaultReconnectionDelay)
const reconnectionDelayMax = parseNumber(import.meta.env.VITE_SOCKET_RECONNECTION_DELAY_MAX_MS, defaultReconnectionDelayMax)
const socketTimeoutMs = parseNumber(import.meta.env.VITE_SOCKET_TIMEOUT_MS, defaultSocketTimeoutMs)

export const SOCKET_RECONNECTION_ENABLED = reconnectionEnabled

export const SOCKET_OPTIONS = {
  path: SOCKET_PATH,
  transports: defaultTransports,
  upgrade: defaultTransports.includes('websocket'),
  tryAllTransports: true,
  timeout: socketTimeoutMs,
  reconnection: reconnectionEnabled,
  reconnectionAttempts,
  reconnectionDelay,
  reconnectionDelayMax,
  randomizationFactor: 0,
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    })
  } finally {
    window.clearTimeout(timer)
  }
}

export async function warmupRealtimeEndpoint({ attempts = 3, timeoutMs = 12000, retryDelayMs = 450 } = {}) {
  const totalAttempts = Math.max(1, Number(attempts) || 1)
  const requestTimeoutMs = Math.max(1000, Number(timeoutMs) || 12000)
  const baseRetryDelayMs = Math.max(0, Number(retryDelayMs) || 450)

  for (let index = 0; index < totalAttempts; index += 1) {
    try {
      const url = `${SOCKET_URL}${SOCKET_PATH}/?EIO=4&transport=polling&t=warmup-${Date.now()}-${index}`
      const response = await fetchWithTimeout(url, requestTimeoutMs)

      if (response.ok) return true
    } catch {
      // Ignore warmup failures and continue with regular socket connect flow.
    }

    if (index < totalAttempts - 1 && baseRetryDelayMs > 0) {
      await delay(baseRetryDelayMs * (index + 1))
    }
  }

  return false
}

export function getRealtimeConfigHint(feature = 'Realtime features') {
  return `${feature} is currently unavailable. Check VITE_API_BASE_URL, VITE_SOCKET_URL, VITE_SOCKET_PATH, and SOCKET_CORS_ORIGIN deployment settings.`
}
