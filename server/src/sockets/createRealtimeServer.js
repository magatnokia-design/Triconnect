const { Server } = require('socket.io')
const setupQuizSocket = require('./quizSocket')
const setupMeetingSocket = require('./meetingSocket')

function parseCorsOriginPatterns(value) {
  return `${value || ''}`
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function toWildcardRegExp(pattern) {
  const escaped = pattern
    .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    .replace(/\*/g, '.*')

  return new RegExp(`^${escaped}$`, 'i')
}

function createCorsOriginMatcher(corsOriginValue) {
  const patterns = parseCorsOriginPatterns(corsOriginValue)

  if (patterns.length === 0 || patterns.includes('*')) {
    return (_origin, callback) => callback(null, true)
  }

  const exactOrigins = new Set(
    patterns
      .filter((pattern) => !pattern.includes('*'))
      .map((pattern) => pattern.toLowerCase())
  )

  const wildcardMatchers = patterns
    .filter((pattern) => pattern.includes('*'))
    .map((pattern) => toWildcardRegExp(pattern))

  return (origin, callback) => {
    if (!origin) {
      callback(null, true)
      return
    }

    const normalizedOrigin = origin.toLowerCase()
    const isExactMatch = exactOrigins.has(normalizedOrigin)
    const isWildcardMatch = wildcardMatchers.some((matcher) => matcher.test(origin))

    callback(null, isExactMatch || isWildcardMatch)
  }
}

module.exports = function createRealtimeServer(httpServer, options = {}) {
  const io = new Server(httpServer, {
    cors: { origin: createCorsOriginMatcher(options.corsOrigin || '*') },
    path: options.path || '/socket.io',
  })

  setupQuizSocket(io)
  setupMeetingSocket(io)

  return io
}
