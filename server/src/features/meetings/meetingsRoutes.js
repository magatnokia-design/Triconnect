const express = require('express')
const { supabase } = require('../../shared/config/supabase')

const router = express.Router()

function safeDate(input) {
  if (!input) return null
  const d = new Date(input)
  if (Number.isNaN(d.getTime())) return null
  return d
}

function minutesBetween(start, end) {
  if (!start || !end) return 0
  const ms = Math.max(end.getTime() - start.getTime(), 0)
  return Math.round((ms / 60000) * 100) / 100
}

function clampDate(value, minDate, maxDate) {
  if (!value) return null
  const min = minDate?.getTime?.() || null
  const max = maxDate?.getTime?.() || null
  let ts = value.getTime()
  if (min !== null && ts < min) ts = min
  if (max !== null && ts > max) ts = max
  return new Date(ts)
}

function mergeIntervals(intervals = []) {
  if (!intervals.length) return []

  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime())
  const merged = [sorted[0]]

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i]
    const last = merged[merged.length - 1]
    if (current.start.getTime() <= last.end.getTime()) {
      if (current.end.getTime() > last.end.getTime()) {
        last.end = current.end
      }
      continue
    }
    merged.push(current)
  }

  return merged
}

function parseDateInput(input) {
  if (!input) return null
  const parsed = new Date(input)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

function escapeCsvValue(value) {
  const text = String(value ?? '')
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function toIsoOrEmpty(value) {
  const d = safeDate(value)
  return d ? d.toISOString() : ''
}

function minDate(a, b) {
  if (!a) return b
  if (!b) return a
  return a.getTime() <= b.getTime() ? a : b
}

async function buildAttendanceDataset({
  classId,
  presentMin,
  lateGraceMin,
  presentPct,
  latePct,
  page,
  pageSize,
  from,
  to,
  sessionId,
}) {
  const { data: rosterRows, error: rosterError } = await supabase
    .from('class_enrollments')
    .select('student_id, profiles(id, full_name, email, student_id)')
    .eq('class_id', classId)

  if (rosterError) throw new Error(rosterError.message)

  const roster = (rosterRows || []).map((row) => ({
    userId: row.student_id,
    fullName: row.profiles?.full_name || row.profiles?.email || row.student_id,
    studentCode: row.profiles?.student_id || null,
    email: row.profiles?.email || null,
  }))

  let sessionsQuery = supabase
    .from('meeting_sessions')
    .select('id, meeting_key, class_id, host_user_id, status, started_at, ended_at')
    .eq('class_id', classId)
    .order('started_at', { ascending: false })

  if (from) sessionsQuery = sessionsQuery.gte('started_at', from.toISOString())
  if (to) sessionsQuery = sessionsQuery.lte('started_at', to.toISOString())
  if (sessionId) sessionsQuery = sessionsQuery.eq('id', sessionId)
  if (!sessionId) sessionsQuery = sessionsQuery.range((page - 1) * pageSize, (page * pageSize) - 1)

  const { data: sessions, error: sessionsError } = await sessionsQuery

  if (sessionsError) {
    if (sessionsError.code === '42P01' || sessionsError.code === 'PGRST205') {
      return {
        sessions: [],
        rosterCount: roster.length,
        pagination: { page, pageSize, hasMore: false },
      }
    }
    throw new Error(sessionsError.message)
  }

  if (!sessions?.length) {
    return {
      sessions: [],
      rosterCount: roster.length,
      pagination: { page, pageSize, hasMore: false },
    }
  }

  const sessionIds = sessions.map((s) => s.id)
  const { data: participantRows, error: participantError } = await supabase
    .from('meeting_participants')
    .select('meeting_session_id, user_id, role, display_name, joined_at, left_at')
    .in('meeting_session_id', sessionIds)
    .eq('role', 'student')

  if (participantError) {
    if (participantError.code === '42P01' || participantError.code === 'PGRST205') {
      return {
        sessions: sessions.map((session) => ({
          ...session,
          attendance: [],
          durationMinutes: 0,
          started_at: session.started_at,
          ended_at: session.ended_at,
          attendanceRate: 0,
          summary: {
            totalStudents: roster.length,
            present: 0,
            late: 0,
            absent: roster.length,
          },
        })),
        rosterCount: roster.length,
        pagination: { page, pageSize, hasMore: !sessionId && sessions.length === pageSize },
      }
    }
    throw new Error(participantError.message)
  }

  const sessionLookup = new Map((sessions || []).map((session) => [session.id, session]))

  let graceBySession = new Map()
  const { data: eventRows, error: eventError } = await supabase
    .from('meeting_events')
    .select('meeting_session_id, event_type, payload, created_at')
    .in('meeting_session_id', sessionIds)
    .in('event_type', ['attendance_grace_set', 'attendance_grace_end'])
    .order('created_at', { ascending: true })

  if (!eventError && Array.isArray(eventRows)) {
    graceBySession = new Map()

    for (const event of eventRows) {
      const session = sessionLookup.get(event.meeting_session_id)
      if (!session) continue

      const startedAt = safeDate(session.started_at)
      if (!startedAt) continue

      const state = graceBySession.get(event.meeting_session_id) || { graceUntil: null }
      const payloadUntil = safeDate(event.payload?.attendanceGraceUntil)
      const payloadMinutes = Number(event.payload?.minutes)

      if (event.event_type === 'attendance_grace_set') {
        if (payloadUntil) {
          state.graceUntil = payloadUntil
        } else if (Number.isFinite(payloadMinutes) && payloadMinutes >= 0) {
          state.graceUntil = new Date(new Date(event.created_at).getTime() + (payloadMinutes * 60 * 1000))
        }
      }

      if (event.event_type === 'attendance_grace_end') {
        state.graceUntil = safeDate(event.created_at) || startedAt
      }

      graceBySession.set(event.meeting_session_id, state)
    }
  }

  const bySessionByUser = new Map()

  for (const row of participantRows || []) {
    const session = sessionLookup.get(row.meeting_session_id)
    if (!session) continue

    const startedAt = safeDate(session.started_at)
    const hardEndFallback = startedAt ? new Date(startedAt.getTime() + (4 * 60 * 60 * 1000)) : new Date()
    const sessionEndedAt = safeDate(session.ended_at) || new Date(Math.min(Date.now(), hardEndFallback.getTime()))
    const joinedAt = safeDate(row.joined_at)
    const leftAt = safeDate(row.left_at) || sessionEndedAt

    if (!joinedAt || !startedAt || !sessionEndedAt) continue

    const clippedStart = clampDate(joinedAt, startedAt, sessionEndedAt)
    const clippedEnd = clampDate(leftAt, startedAt, sessionEndedAt)
    if (!clippedStart || !clippedEnd || clippedEnd <= clippedStart) continue

    const key = `${row.meeting_session_id}:${row.user_id}`
    if (!bySessionByUser.has(key)) {
      bySessionByUser.set(key, {
        meetingSessionId: row.meeting_session_id,
        userId: row.user_id,
        intervals: [],
      })
    }

    bySessionByUser.get(key).intervals.push({ start: clippedStart, end: clippedEnd })
  }

  const sessionsWithAttendance = sessions.map((session) => {
    const startedAt = safeDate(session.started_at)
    const hardEndFallback = startedAt ? new Date(startedAt.getTime() + (4 * 60 * 60 * 1000)) : new Date()
    const effectiveEndedAt = safeDate(session.ended_at) || new Date(Math.min(Date.now(), hardEndFallback.getTime()))
    const sessionDurationMin = Math.max(1, minutesBetween(startedAt, effectiveEndedAt))
    const graceState = graceBySession.get(session.id)
    const graceUntil = graceState?.graceUntil ? minDate(graceState.graceUntil, effectiveEndedAt) : null
    const graceWindowMin = graceUntil && startedAt ? Math.max(0, minutesBetween(startedAt, graceUntil)) : 0
    const effectiveLateGraceMin = lateGraceMin + graceWindowMin
    const normalizedAttendance = []

    for (const student of roster) {
      const key = `${session.id}:${student.userId}`
      const aggregate = bySessionByUser.get(key)

      const merged = mergeIntervals(aggregate?.intervals || [])
      const totalMinutes = merged.reduce((sum, interval) => sum + minutesBetween(interval.start, interval.end), 0)
      const roundedMinutes = Math.round(totalMinutes * 100) / 100
      const firstJoinAt = merged[0]?.start || null
      const lastLeftAt = merged.length ? merged[merged.length - 1].end : null
      const joinDelayMin = firstJoinAt && startedAt ? Math.max(0, minutesBetween(startedAt, firstJoinAt)) : 0
      const attendanceRatio = sessionDurationMin > 0 ? (roundedMinutes / sessionDurationMin) : 0

      let status = 'absent'
      if (sessionDurationMin < presentMin) {
        if (roundedMinutes > 0) {
          status = joinDelayMin > effectiveLateGraceMin ? 'late' : 'present'
        }
      } else if (attendanceRatio >= presentPct && roundedMinutes >= presentMin) {
        status = joinDelayMin > effectiveLateGraceMin ? 'late' : 'present'
      } else if (attendanceRatio >= latePct || roundedMinutes > 0) {
        status = joinDelayMin > effectiveLateGraceMin ? 'late' : 'present'
      }

      normalizedAttendance.push({
        userId: student.userId,
        studentName: student.fullName,
        studentCode: student.studentCode,
        email: student.email,
        totalMinutes: roundedMinutes,
        attendanceRatio: Math.round(attendanceRatio * 10000) / 100,
        status,
        firstJoinAt: firstJoinAt ? firstJoinAt.toISOString() : null,
        lastLeftAt: lastLeftAt ? lastLeftAt.toISOString() : null,
        joinDelayMin: Math.round(joinDelayMin * 100) / 100,
        effectiveLateGraceMin: Math.round(effectiveLateGraceMin * 100) / 100,
        graceWindowMin: Math.round(graceWindowMin * 100) / 100,
      })
    }

    const summary = normalizedAttendance.reduce((acc, row) => {
      acc.totalStudents += 1
      if (row.status === 'present') acc.present += 1
      if (row.status === 'late') acc.late += 1
      if (row.status === 'absent') acc.absent += 1
      return acc
    }, { totalStudents: 0, present: 0, late: 0, absent: 0 })

    normalizedAttendance.sort((a, b) => {
      const statusRank = { present: 0, late: 1, absent: 2 }
      if (statusRank[a.status] !== statusRank[b.status]) {
        return statusRank[a.status] - statusRank[b.status]
      }
      return String(a.studentName || '').localeCompare(String(b.studentName || ''))
    })

    return {
      ...session,
      started_at: startedAt ? startedAt.toISOString() : session.started_at,
      ended_at: safeDate(session.ended_at)?.toISOString?.() || null,
      effective_ended_at: effectiveEndedAt ? effectiveEndedAt.toISOString() : null,
      durationMinutes: Math.round(sessionDurationMin * 100) / 100,
      attendanceGraceUntil: graceUntil ? graceUntil.toISOString() : null,
      graceWindowMin: Math.round(graceWindowMin * 100) / 100,
      effectiveLateGraceMin: Math.round(effectiveLateGraceMin * 100) / 100,
      attendanceRate: summary.totalStudents > 0
        ? Math.round(((summary.present + summary.late) / summary.totalStudents) * 10000) / 100
        : 0,
      attendance: normalizedAttendance,
      summary,
    }
  })

  return {
    sessions: sessionsWithAttendance,
    rosterCount: roster.length,
    pagination: {
      page,
      pageSize,
      hasMore: !sessionId && sessions.length === pageSize,
    },
  }
}

router.get('/classes/:classId/attendance', async (req, res) => {
  try {
    const { classId } = req.params
    const presentMin = Number(req.query.presentMin || 10)
    const lateGraceMin = Number(req.query.lateGraceMin || 5)
    const presentPct = Number(req.query.presentPct || 0.75)
    const latePct = Number(req.query.latePct || 0.5)
    const page = Math.max(1, Number(req.query.page || 1))
    const pageSize = Math.min(50, Math.max(5, Number(req.query.pageSize || 20)))
    const from = parseDateInput(req.query.from)
    const to = parseDateInput(req.query.to)
    const sessionId = req.query.sessionId ? String(req.query.sessionId) : null

    const payload = await buildAttendanceDataset({
      classId,
      presentMin,
      lateGraceMin,
      presentPct,
      latePct,
      page,
      pageSize,
      from,
      to,
      sessionId,
    })

    return res.json(payload)
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to fetch attendance.' })
  }
})

router.get('/classes/:classId/attendance/export.csv', async (req, res) => {
  try {
    const { classId } = req.params
    const presentMin = Number(req.query.presentMin || 10)
    const lateGraceMin = Number(req.query.lateGraceMin || 5)
    const presentPct = Number(req.query.presentPct || 0.75)
    const latePct = Number(req.query.latePct || 0.5)
    const from = parseDateInput(req.query.from)
    const to = parseDateInput(req.query.to)
    const sessionId = req.query.sessionId ? String(req.query.sessionId) : null

    let sessions = []

    if (sessionId) {
      const payload = await buildAttendanceDataset({
        classId,
        presentMin,
        lateGraceMin,
        presentPct,
        latePct,
        page: 1,
        pageSize: 1,
        from,
        to,
        sessionId,
      })
      sessions = payload.sessions || []
    } else {
      let page = 1
      const pageSize = 200
      while (true) {
        const payload = await buildAttendanceDataset({
          classId,
          presentMin,
          lateGraceMin,
          presentPct,
          latePct,
          page,
          pageSize,
          from,
          to,
          sessionId: null,
        })

        sessions = sessions.concat(payload.sessions || [])
        if (!payload.pagination?.hasMore) break
        page += 1
      }
    }

    const header = [
      'Session ID',
      'Session Started At',
      'Session Ended At',
      'Session Effective Ended At',
      'Session Duration Minutes',
      'Session Status',
      'Session Attendance Rate %',
      'Student Name',
      'Student Code',
      'Student Email',
      'Student User ID',
      'First Join At',
      'Last Leave At',
      'Minutes Present',
      'Coverage %',
      'Join Delay Minutes',
      'Effective Late Grace Minutes',
      'Configured Grace Window Minutes',
      'Attendance Status',
    ]

    const lines = [header.join(',')]

    for (const session of sessions || []) {
      for (const row of session.attendance || []) {
        const line = [
          escapeCsvValue(session.id),
          escapeCsvValue(toIsoOrEmpty(session.started_at)),
          escapeCsvValue(toIsoOrEmpty(session.ended_at)),
          escapeCsvValue(toIsoOrEmpty(session.effective_ended_at)),
          escapeCsvValue(Number(session.durationMinutes || 0).toFixed(2)),
          escapeCsvValue(session.status || ''),
          escapeCsvValue(Number(session.attendanceRate || 0).toFixed(2)),
          escapeCsvValue(row.studentName || ''),
          escapeCsvValue(row.studentCode || ''),
          escapeCsvValue(row.email || ''),
          escapeCsvValue(row.userId || ''),
          escapeCsvValue(toIsoOrEmpty(row.firstJoinAt)),
          escapeCsvValue(toIsoOrEmpty(row.lastLeftAt)),
          escapeCsvValue(Number(row.totalMinutes || 0).toFixed(2)),
          escapeCsvValue(Number(row.attendanceRatio || 0).toFixed(2)),
          escapeCsvValue(Number(row.joinDelayMin || 0).toFixed(2)),
          escapeCsvValue(Number(row.effectiveLateGraceMin || session.effectiveLateGraceMin || 0).toFixed(2)),
          escapeCsvValue(Number(row.graceWindowMin || session.graceWindowMin || 0).toFixed(2)),
          escapeCsvValue(row.status || ''),
        ]
        lines.push(line.join(','))
      }
    }

    const csv = lines.join('\n')
    const dateTag = new Date().toISOString().slice(0, 10)
    const scopeTag = sessionId ? `session-${sessionId}` : 'range'

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="meeting-attendance-${scopeTag}-${dateTag}.csv"`)
    return res.status(200).send(csv)
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to export attendance CSV.' })
  }
})

module.exports = router
