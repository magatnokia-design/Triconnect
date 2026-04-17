const express = require('express')
const { supabase } = require('../../shared/config/supabase')
const { authenticateRequest, requireAdmin } = require('../../shared/middleware/auth')

const router = express.Router()

const VALID_ACCOUNT_STATUS = new Set(['active', 'deactivated'])
const VALID_FLAG_STATUS = new Set(['open', 'reviewed', 'dismissed'])

const isMissingColumnError = (error, columnName) => {
  if (!error) return false
  const message = String(error.message || '').toLowerCase()
  return message.includes(`column \"${columnName.toLowerCase()}\"`) || message.includes(`column '${columnName.toLowerCase()}'`)
}

const hasEmbedRelationError = (error, relationName) => {
  if (!error) return false
  const message = String(error.message || '').toLowerCase()
  return message.includes('could not find a relationship') && message.includes(String(relationName || '').toLowerCase())
}

const isMissingTableError = (error, tableName) => {
  if (!error) return false
  if (error.code === '42P01') return true
  const message = String(error.message || '').toLowerCase()
  return message.includes(`relation \"${String(tableName || '').toLowerCase()}\" does not exist`)
}

const safeSearchTerm = (value) => String(value || '').replace(/[,]/g, ' ').trim()

const normalizeDate = (value) => {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

async function insertAuditLog({ actorId, action, targetType, targetId = null, beforeData = null, afterData = null }) {
  if (!actorId || !action || !targetType) return

  const { error } = await supabase
    .from('admin_audit_logs')
    .insert({
      actor_id: actorId,
      action,
      target_type: targetType,
      target_id: targetId,
      before_data: beforeData,
      after_data: afterData,
    })

  if (error && error.code !== '42P01' && error.code !== 'PGRST205') {
    console.warn('Admin audit insert failed:', error.message)
  }
}

router.use(authenticateRequest)
router.use(requireAdmin)

router.get('/stats', async (_req, res) => {
  try {
    const [profilesResult, classesResult, quizzesResult] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('classes').select('id', { count: 'exact', head: true }),
      supabase.from('quizzes').select('id', { count: 'exact', head: true }),
    ])

    if (profilesResult.error) return res.status(500).json({ message: profilesResult.error.message })
    if (classesResult.error) return res.status(500).json({ message: classesResult.error.message })
    if (quizzesResult.error) return res.status(500).json({ message: quizzesResult.error.message })

    return res.json({
      totalUsers: profilesResult.count || 0,
      totalClasses: classesResult.count || 0,
      totalQuizzes: quizzesResult.count || 0,
    })
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to fetch admin stats.' })
  }
})

router.get('/users', async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page || 1), 1)
    const pageSize = Math.min(Math.max(Number(req.query.pageSize || 20), 1), 100)
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1
    const search = safeSearchTerm(req.query.search)

    let query = supabase
      .from('profiles')
      .select('id, full_name, email, student_id, role, account_status, status_reason, status_changed_by, status_changed_at, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to)

    if (search) {
      query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`)
    }

    let { data, error, count } = await query

    if (isMissingColumnError(error, 'account_status')) {
      let fallbackQuery = supabase
        .from('profiles')
        .select('id, full_name, email, student_id, role, created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to)

      if (search) {
        fallbackQuery = fallbackQuery.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`)
      }

      const fallback = await fallbackQuery
      data = (fallback.data || []).map((row) => ({
        ...row,
        account_status: 'active',
        status_reason: null,
        status_changed_by: null,
        status_changed_at: null,
      }))
      error = fallback.error
      count = fallback.count
    }

    if (error) {
      return res.status(500).json({ message: error.message })
    }

    return res.json({
      users: data || [],
      page,
      pageSize,
      total: count || 0,
    })
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to fetch users.' })
  }
})

router.patch('/users/:id', async (req, res) => {
  try {
    const targetUserId = req.params.id
    const { role, account_status: accountStatus, status_reason: statusReason } = req.body || {}

    if (role !== undefined) {
      return res.status(400).json({ message: 'Role changes are disabled. Roles stay as initially assigned.' })
    }

    const updates = {}

    if (accountStatus !== undefined) {
      if (!VALID_ACCOUNT_STATUS.has(accountStatus)) {
        return res.status(400).json({ message: 'Invalid account status.' })
      }
      updates.account_status = accountStatus
      updates.status_reason = statusReason || null
      updates.status_changed_by = req.auth.profile.id
      updates.status_changed_at = new Date().toISOString()
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid update fields provided.' })
    }

    const { data: beforeData, error: beforeError } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, account_status, status_reason, status_changed_by, status_changed_at')
      .eq('id', targetUserId)
      .maybeSingle()

    if (isMissingColumnError(beforeError, 'account_status')) {
      const fallbackBefore = await supabase
        .from('profiles')
        .select('id, full_name, email, role')
        .eq('id', targetUserId)
        .maybeSingle()

      if (fallbackBefore.error || !fallbackBefore.data) {
        return res.status(404).json({ message: 'User profile not found.' })
      }

      if (updates.account_status !== undefined) {
        return res.status(400).json({ message: 'account_status column is missing. Run admin_panel.sql migration first.' })
      }

      return res.status(400).json({ message: 'account_status column is missing. Run admin_panel.sql migration first.' })
    }

    if (beforeError || !beforeData) {
      return res.status(404).json({ message: 'User profile not found.' })
    }

    const { data: afterData, error: updateError } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', targetUserId)
      .select('id, full_name, email, role, account_status, status_reason, status_changed_by, status_changed_at')
      .single()

    if (updateError) {
      return res.status(500).json({ message: updateError.message })
    }

    await insertAuditLog({
      actorId: req.auth.profile.id,
      action: 'update_user_profile',
      targetType: 'profile',
      targetId: targetUserId,
      beforeData,
      afterData,
    })

    return res.json({ user: afterData })
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to update user.' })
  }
})

router.get('/classes', async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page || 1), 1)
    const pageSize = Math.min(Math.max(Number(req.query.pageSize || 20), 1), 100)
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1
    const search = safeSearchTerm(req.query.search)

    let query = supabase
      .from('classes')
      .select('id, name, subject, section, teacher_id, created_at, is_archived, archived_at, archived_by, posting_locked, posting_locked_at, posting_locked_by, class_enrollments(count)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to)

    if (search) {
      query = query.or(`name.ilike.%${search}%,subject.ilike.%${search}%,section.ilike.%${search}%`)
    }

    let { data: classes, error, count } = await query
    let usedFallback = false

    if (error) {
      const canFallback =
        isMissingColumnError(error, 'is_archived')
        || isMissingColumnError(error, 'archived_at')
        || isMissingColumnError(error, 'archived_by')
        || isMissingColumnError(error, 'posting_locked')
        || isMissingColumnError(error, 'posting_locked_at')
        || isMissingColumnError(error, 'posting_locked_by')
        || hasEmbedRelationError(error, 'class_enrollments')

      if (!canFallback) return res.status(500).json({ message: error.message })

      let fallbackQuery = supabase
        .from('classes')
        .select('id, name, subject, section, teacher_id, created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to)

      if (search) {
        fallbackQuery = fallbackQuery.or(`name.ilike.%${search}%,subject.ilike.%${search}%,section.ilike.%${search}%`)
      }

      const fallback = await fallbackQuery
      if (fallback.error) return res.status(500).json({ message: fallback.error.message })

      classes = (fallback.data || []).map((row) => ({
        ...row,
        is_archived: false,
        archived_at: null,
        archived_by: null,
        posting_locked: false,
        posting_locked_at: null,
        posting_locked_by: null,
      }))
      count = fallback.count
      usedFallback = true
    }

    const teacherIds = [...new Set((classes || []).map((item) => item.teacher_id).filter(Boolean))]

    let teacherMap = new Map()
    if (teacherIds.length) {
      const { data: teachers } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', teacherIds)

      teacherMap = new Map((teachers || []).map((teacher) => [teacher.id, teacher]))
    }

    let studentCountByClass = {}
    if (usedFallback && (classes || []).length > 0) {
      const classIds = [...new Set((classes || []).map((row) => row.id))]
      const { data: enrollmentRows } = await supabase
        .from('class_enrollments')
        .select('class_id')
        .in('class_id', classIds)

      studentCountByClass = (enrollmentRows || []).reduce((acc, row) => {
        acc[row.class_id] = (acc[row.class_id] || 0) + 1
        return acc
      }, {})
    }

    const rows = (classes || []).map((row) => ({
      ...row,
      teacher_profile: teacherMap.get(row.teacher_id) || null,
      student_count: usedFallback
        ? Number(studentCountByClass[row.id] || 0)
        : Number(row.class_enrollments?.[0]?.count || 0),
    }))

    return res.json({
      classes: rows,
      page,
      pageSize,
      total: count || 0,
    })
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to fetch classes.' })
  }
})

router.patch('/classes/:id/intervention', async (req, res) => {
  try {
    const classId = req.params.id
    const { action, teacher_id: teacherId } = req.body || {}

    if (!['transfer_owner', 'archive', 'unarchive', 'lock_posting', 'unlock_posting'].includes(action)) {
      return res.status(400).json({ message: 'Invalid intervention action.' })
    }

    const statusColumns = 'is_archived, archived_at, archived_by, posting_locked, posting_locked_at, posting_locked_by'
    const selectColumns = action === 'transfer_owner'
      ? 'id, teacher_id'
      : `id, teacher_id, ${statusColumns}`

    const { data: beforeClass, error: beforeError } = await supabase
      .from('classes')
      .select(selectColumns)
      .eq('id', classId)
      .maybeSingle()

    const archiveColumnsMissing =
      isMissingColumnError(beforeError, 'is_archived')
      || isMissingColumnError(beforeError, 'archived_at')
      || isMissingColumnError(beforeError, 'archived_by')
      || isMissingColumnError(beforeError, 'posting_locked')
      || isMissingColumnError(beforeError, 'posting_locked_at')
      || isMissingColumnError(beforeError, 'posting_locked_by')

    if (archiveColumnsMissing) {
      return res.status(400).json({ message: 'Class archive/locking columns are missing. Run server/src/features/admin/sql/admin_panel.sql in Supabase SQL Editor.' })
    }

    if (beforeError || !beforeClass) {
      return res.status(404).json({ message: 'Class not found.' })
    }

    const updatePayload = {}

    if (action === 'transfer_owner') {
      if (!teacherId) return res.status(400).json({ message: 'teacher_id is required for transfer_owner.' })
      updatePayload.teacher_id = teacherId
    }

    if (action === 'archive') {
      updatePayload.is_archived = true
      updatePayload.archived_at = new Date().toISOString()
      updatePayload.archived_by = req.auth.profile.id
    }

    if (action === 'unarchive') {
      updatePayload.is_archived = false
      updatePayload.archived_at = null
      updatePayload.archived_by = null
    }

    if (action === 'lock_posting') {
      updatePayload.posting_locked = true
      updatePayload.posting_locked_at = new Date().toISOString()
      updatePayload.posting_locked_by = req.auth.profile.id
    }

    if (action === 'unlock_posting') {
      updatePayload.posting_locked = false
      updatePayload.posting_locked_at = null
      updatePayload.posting_locked_by = null
    }

    const { data: updatedClass, error: updateError } = await supabase
      .from('classes')
      .update(updatePayload)
      .eq('id', classId)
      .select(selectColumns)
      .single()

    if (
      isMissingColumnError(updateError, 'is_archived')
      || isMissingColumnError(updateError, 'archived_at')
      || isMissingColumnError(updateError, 'archived_by')
      || isMissingColumnError(updateError, 'posting_locked')
      || isMissingColumnError(updateError, 'posting_locked_at')
      || isMissingColumnError(updateError, 'posting_locked_by')
    ) {
      return res.status(400).json({ message: 'Class archive/locking columns are missing. Run server/src/features/admin/sql/admin_panel.sql in Supabase SQL Editor.' })
    }

    if (updateError) {
      return res.status(500).json({ message: updateError.message })
    }

    await insertAuditLog({
      actorId: req.auth.profile.id,
      action: `class_${action}`,
      targetType: 'class',
      targetId: classId,
      beforeData: beforeClass,
      afterData: updatedClass,
    })

    return res.json({ class: updatedClass })
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to apply class intervention.' })
  }
})

router.get('/audit-logs', async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page || 1), 1)
    const pageSize = Math.min(Math.max(Number(req.query.pageSize || 20), 1), 100)
    const fromIndex = (page - 1) * pageSize
    const toIndex = fromIndex + pageSize - 1

    const actionFilter = safeSearchTerm(req.query.action)
    const actorId = safeSearchTerm(req.query.actorId)
    const fromDate = normalizeDate(req.query.from)
    const toDate = normalizeDate(req.query.to)

    let query = supabase
      .from('admin_audit_logs')
      .select('id, actor_id, action, target_type, target_id, before_data, after_data, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(fromIndex, toIndex)

    if (actionFilter) query = query.ilike('action', `%${actionFilter}%`)
    if (actorId) query = query.eq('actor_id', actorId)
    if (fromDate) query = query.gte('created_at', fromDate)
    if (toDate) query = query.lte('created_at', toDate)

    const { data, error, count } = await query
    if (error) return res.status(500).json({ message: error.message })

    const actorIds = [...new Set((data || []).map((row) => row.actor_id).filter(Boolean))]
    let actorMap = new Map()

    if (actorIds.length) {
      const { data: actors } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', actorIds)

      actorMap = new Map((actors || []).map((actor) => [actor.id, actor]))
    }

    const logs = (data || []).map((row) => ({
      ...row,
      actor_profile: actorMap.get(row.actor_id) || null,
    }))

    return res.json({ logs, total: count || 0, page, pageSize })
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to fetch audit logs.' })
  }
})

router.get('/content/feed', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 250)

    const [modules, assignments, quizzes, groupMessages] = await Promise.all([
      supabase.from('modules').select('id, class_id, teacher_id, title, created_at').order('created_at', { ascending: false }).limit(limit),
      supabase.from('assignments').select('id, class_id, teacher_id, title, status, created_at').order('created_at', { ascending: false }).limit(limit),
      supabase.from('quizzes').select('id, class_id, teacher_id, title, is_published, created_at').order('created_at', { ascending: false }).limit(limit),
      supabase.from('class_group_messages').select('id, class_id, sender_id, content, created_at').order('created_at', { ascending: false }).limit(limit),
    ])

    let directMessagesRows = []
    const directMessages = await supabase
      .from('class_direct_messages')
      .select('id, sender_id, content, created_at, thread_id, class_direct_threads(class_id)')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (!directMessages.error) {
      directMessagesRows = directMessages.data || []
    } else if (hasEmbedRelationError(directMessages.error, 'class_direct_threads')) {
      const fallbackMessages = await supabase
        .from('class_direct_messages')
        .select('id, sender_id, content, created_at, thread_id')
        .order('created_at', { ascending: false })
        .limit(limit)

      if (fallbackMessages.error) {
        return res.status(500).json({ message: fallbackMessages.error.message })
      }

      const threadIds = [...new Set((fallbackMessages.data || []).map((row) => row.thread_id).filter(Boolean))]
      let classByThread = {}

      if (threadIds.length > 0) {
        const { data: threads, error: threadsError } = await supabase
          .from('class_direct_threads')
          .select('id, class_id')
          .in('id', threadIds)

        if (threadsError) {
          return res.status(500).json({ message: threadsError.message })
        }

        classByThread = Object.fromEntries((threads || []).map((thread) => [thread.id, thread.class_id]))
      }

      directMessagesRows = (fallbackMessages.data || []).map((row) => ({
        ...row,
        class_direct_threads: { class_id: classByThread[row.thread_id] || null },
      }))
    } else {
      return res.status(500).json({ message: directMessages.error.message })
    }

    const payload = []

    for (const row of modules.data || []) {
      payload.push({ entity_type: 'module', entity_id: row.id, class_id: row.class_id, actor_id: row.teacher_id, title: row.title, body: null, created_at: row.created_at })
    }

    for (const row of assignments.data || []) {
      payload.push({ entity_type: 'assignment', entity_id: row.id, class_id: row.class_id, actor_id: row.teacher_id, title: row.title, body: row.status || null, created_at: row.created_at })
    }

    for (const row of quizzes.data || []) {
      payload.push({ entity_type: 'quiz', entity_id: row.id, class_id: row.class_id, actor_id: row.teacher_id, title: row.title, body: row.is_published ? 'published' : 'draft', created_at: row.created_at })
    }

    for (const row of groupMessages.data || []) {
      payload.push({ entity_type: 'group_message', entity_id: row.id, class_id: row.class_id, actor_id: row.sender_id, title: 'Group chat message', body: row.content, created_at: row.created_at })
    }

    for (const row of directMessagesRows) {
      payload.push({
        entity_type: 'direct_message',
        entity_id: row.id,
        class_id: row.class_direct_threads?.class_id || null,
        actor_id: row.sender_id,
        title: 'Direct chat message',
        body: row.content,
        created_at: row.created_at,
      })
    }

    payload.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    return res.json({ items: payload.slice(0, limit) })
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to fetch content feed.' })
  }
})

router.get('/content/flags', async (req, res) => {
  try {
    const status = safeSearchTerm(req.query.status)
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 250)

    let query = supabase
      .from('content_flags')
      .select('id, class_id, entity_type, entity_id, reason, details, status, created_by, reviewed_by, review_notes, reviewed_at, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (status) query = query.eq('status', status)

    const { data, error } = await query
    if (isMissingTableError(error, 'content_flags')) {
      return res.status(400).json({ message: 'content_flags table is missing. Run server/src/features/admin/sql/admin_panel.sql in Supabase SQL Editor.' })
    }
    if (error) return res.status(500).json({ message: error.message })

    return res.json({ flags: data || [] })
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to fetch moderation flags.' })
  }
})

router.post('/content/flags', async (req, res) => {
  try {
    const { class_id: classId = null, entity_type: entityType, entity_id: entityId, reason, details = null } = req.body || {}

    if (!entityType || !entityId || !reason) {
      return res.status(400).json({ message: 'entity_type, entity_id, and reason are required.' })
    }

    const { data, error } = await supabase
      .from('content_flags')
      .insert({
        class_id: classId,
        entity_type: entityType,
        entity_id: entityId,
        reason,
        details,
        status: 'open',
        created_by: req.auth.profile.id,
      })
      .select('*')
      .single()

    if (isMissingTableError(error, 'content_flags')) {
      return res.status(400).json({ message: 'content_flags table is missing. Run server/src/features/admin/sql/admin_panel.sql in Supabase SQL Editor.' })
    }
    if (error) return res.status(500).json({ message: error.message })

    await insertAuditLog({
      actorId: req.auth.profile.id,
      action: 'create_content_flag',
      targetType: 'content_flag',
      targetId: data.id,
      beforeData: null,
      afterData: data,
    })

    return res.status(201).json({ flag: data })
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to create content flag.' })
  }
})

router.patch('/content/flags/:id/review', async (req, res) => {
  try {
    const flagId = req.params.id
    const { status, review_notes: reviewNotes = null } = req.body || {}

    if (!VALID_FLAG_STATUS.has(status)) {
      return res.status(400).json({ message: 'Invalid moderation status.' })
    }

    const { data: beforeData, error: beforeError } = await supabase
      .from('content_flags')
      .select('*')
      .eq('id', flagId)
      .maybeSingle()

    if (isMissingTableError(beforeError, 'content_flags')) {
      return res.status(400).json({ message: 'content_flags table is missing. Run server/src/features/admin/sql/admin_panel.sql in Supabase SQL Editor.' })
    }

    if (beforeError || !beforeData) {
      return res.status(404).json({ message: 'Flag not found.' })
    }

    const { data: afterData, error: updateError } = await supabase
      .from('content_flags')
      .update({
        status,
        review_notes: reviewNotes,
        reviewed_by: req.auth.profile.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', flagId)
      .select('*')
      .single()

    if (isMissingTableError(updateError, 'content_flags')) {
      return res.status(400).json({ message: 'content_flags table is missing. Run server/src/features/admin/sql/admin_panel.sql in Supabase SQL Editor.' })
    }
    if (updateError) return res.status(500).json({ message: updateError.message })

    await insertAuditLog({
      actorId: req.auth.profile.id,
      action: 'review_content_flag',
      targetType: 'content_flag',
      targetId: flagId,
      beforeData,
      afterData,
    })

    return res.json({ flag: afterData })
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to review content flag.' })
  }
})

router.post('/support/users/:id/password-reset', async (req, res) => {
  try {
    const userId = req.params.id
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, email')
      .eq('id', userId)
      .maybeSingle()

    if (profileError || !profile?.email) {
      return res.status(404).json({ message: 'User not found.' })
    }

    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email: profile.email,
    })

    if (error) return res.status(500).json({ message: error.message })

    await insertAuditLog({
      actorId: req.auth.profile.id,
      action: 'support_password_reset_link',
      targetType: 'profile',
      targetId: userId,
      beforeData: null,
      afterData: { email: profile.email },
    })

    return res.json({
      message: 'Password reset link generated.',
      action_link: data?.properties?.action_link || null,
    })
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to generate reset link.' })
  }
})

router.post('/support/users/:id/resend-verification', async (req, res) => {
  try {
    const userId = req.params.id
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, email')
      .eq('id', userId)
      .maybeSingle()

    if (profileError || !profile?.email) {
      return res.status(404).json({ message: 'User not found.' })
    }

    const { error } = await supabase.auth.admin.inviteUserByEmail(profile.email)
    if (error) return res.status(500).json({ message: error.message })

    await insertAuditLog({
      actorId: req.auth.profile.id,
      action: 'support_resend_verification',
      targetType: 'profile',
      targetId: userId,
      beforeData: null,
      afterData: { email: profile.email },
    })

    return res.json({ message: 'Verification/invite email sent.' })
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to resend verification.' })
  }
})

router.post('/support/users/:id/revoke-sessions', async (req, res) => {
  try {
    const userId = req.params.id
    const { data, error } = await supabase.rpc('admin_revoke_user_sessions', {
      p_user_id: userId,
    })

    if (error) return res.status(500).json({ message: error.message })

    await insertAuditLog({
      actorId: req.auth.profile.id,
      action: 'support_revoke_sessions',
      targetType: 'profile',
      targetId: userId,
      beforeData: null,
      afterData: { revoked_sessions: data || 0 },
    })

    return res.json({ message: 'Sessions revoked.', revoked_sessions: data || 0 })
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to revoke sessions.' })
  }
})

router.get('/platform-health', async (_req, res) => {
  try {
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    const sevenDaysAgoIso = new Date(now - 7 * day).toISOString()
    const thirtyDaysAgoIso = new Date(now - 30 * day).toISOString()

    const [
      submissions7,
      quizSubs7,
      group7,
      direct7,
      meet7,
      submissions30,
      quizSubs30,
      group30,
      direct30,
      meet30,
      classes,
      modules30,
      assignments30,
      quizzes30,
      meetings30,
      chatGroup30,
      chatDirect30,
      quizzesAll,
      quizSubmissionsAll,
      meetingSessions,
    ] = await Promise.all([
      supabase.from('assignment_submissions').select('student_id').gte('submitted_at', sevenDaysAgoIso),
      supabase.from('quiz_submissions').select('student_id').gte('submitted_at', sevenDaysAgoIso),
      supabase.from('class_group_messages').select('sender_id').gte('created_at', sevenDaysAgoIso),
      supabase.from('class_direct_messages').select('sender_id').gte('created_at', sevenDaysAgoIso),
      supabase.from('meeting_participants').select('user_id').gte('joined_at', sevenDaysAgoIso),
      supabase.from('assignment_submissions').select('student_id').gte('submitted_at', thirtyDaysAgoIso),
      supabase.from('quiz_submissions').select('student_id').gte('submitted_at', thirtyDaysAgoIso),
      supabase.from('class_group_messages').select('sender_id').gte('created_at', thirtyDaysAgoIso),
      supabase.from('class_direct_messages').select('sender_id').gte('created_at', thirtyDaysAgoIso),
      supabase.from('meeting_participants').select('user_id').gte('joined_at', thirtyDaysAgoIso),
      supabase.from('classes').select('id, name'),
      supabase.from('modules').select('class_id').gte('created_at', thirtyDaysAgoIso),
      supabase.from('assignments').select('class_id').gte('created_at', thirtyDaysAgoIso),
      supabase.from('quizzes').select('class_id').gte('created_at', thirtyDaysAgoIso),
      supabase.from('meeting_sessions').select('class_id').gte('started_at', thirtyDaysAgoIso),
      supabase.from('class_group_messages').select('class_id').gte('created_at', thirtyDaysAgoIso),
      supabase
        .from('class_direct_messages')
        .select('thread_id, created_at')
        .gte('created_at', thirtyDaysAgoIso),
      supabase.from('quizzes').select('id'),
      supabase.from('quiz_submissions').select('quiz_id'),
      supabase.from('meeting_sessions').select('id, started_at, ended_at, status'),
    ])

    const active7 = new Set([
      ...(submissions7.data || []).map((row) => row.student_id),
      ...(quizSubs7.data || []).map((row) => row.student_id),
      ...(group7.data || []).map((row) => row.sender_id),
      ...(direct7.data || []).map((row) => row.sender_id),
      ...(meet7.data || []).map((row) => row.user_id),
    ].filter(Boolean)).size

    const active30 = new Set([
      ...(submissions30.data || []).map((row) => row.student_id),
      ...(quizSubs30.data || []).map((row) => row.student_id),
      ...(group30.data || []).map((row) => row.sender_id),
      ...(direct30.data || []).map((row) => row.sender_id),
      ...(meet30.data || []).map((row) => row.user_id),
    ].filter(Boolean)).size

    const directThreadIds = [...new Set((chatDirect30.data || []).map((row) => row.thread_id).filter(Boolean))]
    let classIdByThread = {}

    if (directThreadIds.length > 0) {
      const { data: directThreads } = await supabase
        .from('class_direct_threads')
        .select('id, class_id')
        .in('id', directThreadIds)

      classIdByThread = Object.fromEntries((directThreads || []).map((thread) => [thread.id, thread.class_id]))
    }

    const classActivitySet = new Set([
      ...(modules30.data || []).map((row) => row.class_id),
      ...(assignments30.data || []).map((row) => row.class_id),
      ...(quizzes30.data || []).map((row) => row.class_id),
      ...(meetings30.data || []).map((row) => row.class_id),
      ...(chatGroup30.data || []).map((row) => row.class_id),
      ...(chatDirect30.data || []).map((row) => classIdByThread[row.thread_id] || null),
    ].filter(Boolean))

    const lowActivityClasses = (classes.data || [])
      .filter((row) => !classActivitySet.has(row.id))
      .slice(0, 10)

    const quizIds = new Set((quizzesAll.data || []).map((row) => row.id))
    const quizzesWithSubs = new Set((quizSubmissionsAll.data || []).map((row) => row.quiz_id))
    const failedQuizCount = [...quizIds].filter((quizId) => !quizzesWithSubs.has(quizId)).length
    const failedQuizRate = quizIds.size > 0 ? Number(((failedQuizCount / quizIds.size) * 100).toFixed(2)) : 0

    const sessions = meetingSessions.data || []
    const failedMeetingCount = sessions.filter((session) => {
      const started = new Date(session.started_at).getTime()
      const ended = session.ended_at ? new Date(session.ended_at).getTime() : started
      const durationMinutes = (ended - started) / (60 * 1000)
      return durationMinutes < 2
    }).length
    const failedMeetingRate = sessions.length > 0 ? Number(((failedMeetingCount / sessions.length) * 100).toFixed(2)) : 0

    return res.json({
      activeUsers7d: active7,
      activeUsers30d: active30,
      lowActivityClasses,
      failedQuizRate,
      failedMeetingRate,
    })
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to fetch platform health.' })
  }
})

module.exports = router
