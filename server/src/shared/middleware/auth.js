const { supabase } = require('../config/supabase')

function getBearerToken(authHeader = '') {
  const [scheme, token] = String(authHeader).split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null
  return token
}

async function authenticateRequest(req, res, next) {
  try {
    const token = getBearerToken(req.headers.authorization)
    if (!token) {
      return res.status(401).json({ message: 'Missing bearer token.' })
    }

    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data?.user) {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, email, role')
      .eq('id', data.user.id)
      .maybeSingle()

    if (profileError || !profile) {
      return res.status(401).json({ message: 'Unable to resolve user profile.' })
    }

    req.auth = {
      user: data.user,
      profile,
      token,
    }

    return next()
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Authentication failed.' })
  }
}

function requireAdmin(req, res, next) {
  if (!req.auth?.profile) {
    return res.status(401).json({ message: 'Authentication required.' })
  }

  if (req.auth.profile.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required.' })
  }

  return next()
}

module.exports = {
  authenticateRequest,
  requireAdmin,
}
