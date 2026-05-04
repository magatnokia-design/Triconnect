const { supabase } = require('../shared/config/supabase')

const HOST_RECONNECT_GRACE_MS = Number(process.env.MEETING_HOST_RECONNECT_GRACE_MS || 30000)

const DEFAULT_METERED_STUN_URLS = ['stun:stun.relay.metered.ca:80']
const DEFAULT_METERED_TURN_URLS = [
  'turn:global.relay.metered.ca:80',
  'turn:global.relay.metered.ca:80?transport=tcp',
  'turn:global.relay.metered.ca:443',
  'turns:global.relay.metered.ca:443?transport=tcp',
]

// meetingId => room state
const rooms = new Map()

const persistence = {
  meeting_sessions: true,
  meeting_participants: true,
  meeting_events: true,
}

function parseList(value, fallback = []) {
  if (!value) return fallback
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function generateMeetingCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

function buildIceServers() {
  const turnUsername = process.env.MEETING_TURN_USERNAME || process.env.METERED_TURN_USERNAME || process.env.METERED_USERNAME
  const turnCredential = process.env.MEETING_TURN_CREDENTIAL || process.env.METERED_TURN_CREDENTIAL || process.env.METERED_CREDENTIAL

  let stunUrls = parseList(process.env.MEETING_STUN_URLS, [])
  let turnUrls = parseList(process.env.MEETING_TURN_URLS, [])

  if (turnUsername && turnCredential) {
    if (!stunUrls.length) stunUrls = DEFAULT_METERED_STUN_URLS
    if (!turnUrls.length) turnUrls = DEFAULT_METERED_TURN_URLS
  }

  if (!stunUrls.length) {
    stunUrls = ['stun:stun.l.google.com:19302']
  }

  const iceServers = []
  if (stunUrls.length) {
    iceServers.push({ urls: stunUrls })
  }

  if (turnUrls.length && turnUsername && turnCredential) {
    iceServers.push({
      urls: turnUrls,
      username: turnUsername,
      credential: turnCredential,
    })
  }

  return iceServers
}

function markTableUnavailable(table, error) {
  if (!error) return
  if (error.code === '42P01') {
    persistence[table] = false
    return
  }
  if (error.code === 'PGRST205') {
    persistence[table] = false
  }
}

async function persistEvent(room, eventType, userId = null, payload = null) {
  if (!room?.sessionId || !persistence.meeting_events) return

  const { error } = await supabase
    .from('meeting_events')
    .insert({
      meeting_session_id: room.sessionId,
      event_type: eventType,
      user_id: userId,
      payload,
      created_at: new Date().toISOString(),
    })

  if (error) {
    markTableUnavailable('meeting_events', error)
  }
}

async function createMeetingSession(room, meetingId, classId, hostUserId) {
  if (!persistence.meeting_sessions) return null

  const { data, error } = await supabase
    .from('meeting_sessions')
    .insert({
      meeting_key: meetingId,
      class_id: classId,
      host_user_id: hostUserId,
      status: 'active',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    markTableUnavailable('meeting_sessions', error)
    return null
  }

  return data?.id || null
}

async function closeMeetingSession(room, status = 'ended') {
  if (!room?.sessionId || !persistence.meeting_sessions) return

  const { error } = await supabase
    .from('meeting_sessions')
    .update({
      status,
      ended_at: new Date().toISOString(),
    })
    .eq('id', room.sessionId)

  if (error) {
    markTableUnavailable('meeting_sessions', error)
  }
}

async function trackParticipantJoin(room, participant) {
  if (!room?.sessionId || !persistence.meeting_participants) return null

  const { data, error } = await supabase
    .from('meeting_participants')
    .insert({
      meeting_session_id: room.sessionId,
      user_id: participant.userId,
      role: participant.role,
      display_name: participant.name,
      joined_at: new Date().toISOString(),
      join_socket_id: participant.socketId,
    })
    .select('id')
    .single()

  if (error) {
    markTableUnavailable('meeting_participants', error)
    return null
  }

  return data?.id || null
}

async function trackParticipantLeave(room, participant, reason) {
  if (!room?.sessionId || !participant?.presenceId || !persistence.meeting_participants) return

  const { error } = await supabase
    .from('meeting_participants')
    .update({
      left_at: new Date().toISOString(),
      left_reason: reason,
      leave_socket_id: participant.socketId,
    })
    .eq('id', participant.presenceId)

  if (error) {
    markTableUnavailable('meeting_participants', error)
  }
}

function publicParticipant(participant) {
  return {
    socketId: participant.socketId,
    userId: participant.userId,
    name: participant.name,
    role: participant.role,
    micOn: participant.micOn,
    camOn: participant.camOn,
    screenOn: participant.screenOn,
    joinedAt: participant.joinedAt,
  }
}

function getRoomParticipants(room, exceptSocketId = null) {
  return Array.from(room.participants.values())
    .filter((p) => p.socketId !== exceptSocketId)
    .map(publicParticipant)
}

function toIso(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

async function canJoinMeeting(classId, userId) {
  if (!classId || !userId) return { allowed: false, role: null, teacherId: null }

  const { data: classData } = await supabase
    .from('classes')
    .select('id, teacher_id')
    .eq('id', classId)
    .single()

  if (!classData) return { allowed: false, role: null, teacherId: null }

  const teacherId = classData.teacher_id || null

  if (teacherId && teacherId === userId) {
    return { allowed: true, role: 'teacher', teacherId }
  }

  const { data: enrollment } = await supabase
    .from('class_enrollments')
    .select('id')
    .eq('class_id', classId)
    .eq('student_id', userId)
    .maybeSingle()

  if (enrollment) {
    return { allowed: true, role: 'student', teacherId }
  }

  return { allowed: false, role: null, teacherId }
}

async function notifyMeetingStarted(classId, teacherId) {
  if (!classId || !teacherId) return

  const { error } = await supabase.rpc('create_class_notification', {
    p_class_id: classId,
    p_actor_id: teacherId,
    p_type: 'meeting_started',
    p_title: 'Class meeting started',
    p_body: 'Your teacher started a live meeting.',
    p_target_path: `/classes/${classId}?tab=Meetings`,
    p_target_params: { classId },
    p_recipients: 'students',
    p_debounce_seconds: 0,
  })

  if (error) {
    console.warn('Meeting notification failed:', error.message)
  }
}

module.exports = function setupMeetingSocket(io) {
  const emitMeetingState = (meetingId, room) => {
    if (!meetingId || !room) return

    io.to(meetingId).emit('meeting:state', {
      meetingId,
      hostSocketId: room.hostSocketId,
      hostUserId: room.hostUserId,
      participantCount: room.participants.size,
      hostReconnectUntil: room.hostReconnectUntil,
      attendanceGraceUntil: toIso(room.attendanceGraceUntil),
      updatedAt: Date.now(),
    })
  }

  const isTeacherHost = (room, socket) => {
    if (!room || !socket) return false
    if (room.hostSocketId !== socket.id) return false
    const participant = room.participants.get(socket.id)
    return participant?.role === 'teacher'
  }

  const clearHostReconnectTimer = (room) => {
    if (!room?.hostReconnectTimer) return
    clearTimeout(room.hostReconnectTimer)
    room.hostReconnectTimer = null
    room.hostReconnectUntil = null
  }

  const tryAutoAssignHost = async (meetingId, room) => {
    const nextTeacher = Array.from(room.participants.values()).find((p) => p.role === 'teacher')

    if (!nextTeacher) {
      room.hostSocketId = null
      clearHostReconnectTimer(room)

      io.to(meetingId).emit('meeting:host-changed', {
        hostSocketId: null,
        hostUserId: room.hostUserId,
      })

      emitMeetingState(meetingId, room)

      await persistEvent(room, 'host_changed', null, {
        hostSocketId: null,
        reason: 'no_teacher_available',
      })
      return
    }

    room.hostSocketId = nextTeacher.socketId
    room.hostUserId = nextTeacher.userId
    clearHostReconnectTimer(room)

    io.to(meetingId).emit('meeting:host-changed', {
      hostSocketId: nextTeacher.socketId,
      hostUserId: nextTeacher.userId,
    })

    emitMeetingState(meetingId, room)

    await persistEvent(room, 'host_changed', nextTeacher.userId, {
      hostSocketId: nextTeacher.socketId,
    })
  }

  const scheduleHostReconnectWindow = (meetingId, room) => {
    clearHostReconnectTimer(room)
    room.hostReconnectUntil = Date.now() + HOST_RECONNECT_GRACE_MS

    io.to(meetingId).emit('meeting:host-reconnecting', {
      graceMs: HOST_RECONNECT_GRACE_MS,
      reconnectUntil: room.hostReconnectUntil,
    })

    emitMeetingState(meetingId, room)

    room.hostReconnectTimer = setTimeout(async () => {
      const activeRoom = rooms.get(meetingId)
      if (!activeRoom) return
      if (activeRoom.hostSocketId) return
      await tryAutoAssignHost(meetingId, activeRoom)
    }, HOST_RECONNECT_GRACE_MS)
  }

  const cleanupSocketFromRoom = async (socket, reason = 'left') => {
    const { meetingId } = socket.data || {}
    if (!meetingId) return

    const room = rooms.get(meetingId)
    if (!room) return

    const participant = room.participants.get(socket.id)
    if (!participant) return

    room.participants.delete(socket.id)
    socket.leave(meetingId)

    await trackParticipantLeave(room, participant, reason)
    await persistEvent(room, 'participant_left', participant.userId, {
      reason,
      socketId: socket.id,
    })

    io.to(meetingId).emit('meeting:participant-left', {
      socketId: socket.id,
      userId: participant.userId,
      reason,
    })

    emitMeetingState(meetingId, room)

    // For abrupt host disconnect, hold reassignment for a grace window.
    if (room.hostSocketId === socket.id) {
      room.hostSocketId = null

      if (reason === 'disconnected') {
        scheduleHostReconnectWindow(meetingId, room)
      } else {
        await tryAutoAssignHost(meetingId, room)
      }
    }

    if (room.participants.size === 0) {
      clearHostReconnectTimer(room)
      await closeMeetingSession(room, 'ended')
      rooms.delete(meetingId)
    }
  }

  io.on('connection', (socket) => {
    socket.on('meeting:join', async (payload = {}) => {
      const {
        meetingId,
        classId,
        userId,
        name,
        micOn,
        camOn,
        screenOn,
      } = payload

      const normalizedMeetingId = String(meetingId || classId || '').trim()
      const normalizedName = String(name || 'Guest').trim() || 'Guest'

      if (!normalizedMeetingId || !classId || !userId) {
        socket.emit('meeting:error', { message: 'Invalid meeting join payload.' })
        return
      }

      const access = await canJoinMeeting(classId, userId)
      if (!access.allowed) {
        socket.emit('meeting:error', { message: 'You are not allowed to join this meeting.' })
        return
      }

      let room = rooms.get(normalizedMeetingId)
      if (!room && access.role !== 'teacher') {
        socket.emit('meeting:error', { message: 'Teacher has not started the meeting yet.' })
        return
      }

      const isNewRoom = !room
      if (!room) {
        room = {
          classId,
          teacherId: access.teacherId || null,
          hostUserId: access.teacherId || null,
          hostSocketId: null,
          participants: new Map(),
          createdAt: Date.now(),
          sessionId: null,
          hostReconnectTimer: null,
          hostReconnectUntil: null,
          attendanceGraceUntil: null,
          attendanceJoinClosed: false,
          notifiedStarted: false,
          meetingCode: null,
        }
        rooms.set(normalizedMeetingId, room)
      }

      if (!room.teacherId && access.teacherId) {
        room.teacherId = access.teacherId
      }

      if (!room.hostUserId && room.teacherId) {
        room.hostUserId = room.teacherId
      }

      if (access.role === 'teacher' && !room.notifiedStarted) {
        await notifyMeetingStarted(classId, userId)
        room.notifiedStarted = true
      }

      if (access.role === 'teacher' && !room.meetingCode) {
        room.meetingCode = generateMeetingCode()
      }

      const providedMeetingCode = String(payload.meetingCode || '').trim()
      if (access.role === 'student') {
        if (!room.meetingCode) {
          socket.emit('meeting:error', { message: 'Meeting code is not set yet.' })
          return
        }
        if (providedMeetingCode !== room.meetingCode) {
          socket.emit('meeting:error', { message: 'Invalid meeting code.' })
          return
        }
      }

      // Replace old connection for the same user if they reconnect.
      for (const [sid, p] of room.participants.entries()) {
        if (p.userId === userId) {
          await trackParticipantLeave(room, p, 'reconnected')
          await persistEvent(room, 'participant_left', userId, {
            reason: 'reconnected',
            socketId: sid,
          })

          room.participants.delete(sid)
          io.to(normalizedMeetingId).emit('meeting:participant-left', {
            socketId: sid,
            userId,
            reason: 'reconnected',
          })

          emitMeetingState(normalizedMeetingId, room)

          const oldSocket = io.sockets.sockets.get(sid)
          if (oldSocket) {
            oldSocket.leave(normalizedMeetingId)
            oldSocket.data.meetingId = null
          }
          break
        }
      }

      const now = Date.now()
      const graceUntilMs = room.attendanceGraceUntil ? new Date(room.attendanceGraceUntil).getTime() : null
      const graceExpired = graceUntilMs !== null && now > graceUntilMs
      if (graceExpired) {
        room.attendanceJoinClosed = true
      }

      if (access.role === 'student' && room.attendanceJoinClosed) {
        socket.emit('meeting:removed', { message: 'Attendance join window is closed for this meeting.' })
        socket.disconnect(true)
        return
      }

      socket.join(normalizedMeetingId)
      socket.data.meetingId = normalizedMeetingId
      socket.data.userId = userId

      const participant = {
        socketId: socket.id,
        userId,
        name: normalizedName,
        role: access.role,
        micOn: typeof micOn === 'boolean' ? micOn : true,
        camOn: typeof camOn === 'boolean' ? camOn : true,
        screenOn: typeof screenOn === 'boolean' ? screenOn : false,
        joinedAt: Date.now(),
        presenceId: null,
      }

      room.participants.set(socket.id, participant)

      const previousHostSocketId = room.hostSocketId

      if (access.role === 'teacher') {
        room.hostSocketId = socket.id
        room.hostUserId = userId
        clearHostReconnectTimer(room)
      }

      if (!room.sessionId) {
        const sessionHostId = room.hostUserId || (access.role === 'teacher' ? userId : null)
        room.sessionId = await createMeetingSession(room, normalizedMeetingId, classId, sessionHostId)
      }

      participant.presenceId = await trackParticipantJoin(room, participant)

      await persistEvent(room, 'participant_joined', userId, {
        socketId: socket.id,
        role: participant.role,
      })

      const isHost = room.hostSocketId === socket.id

      socket.emit('meeting:joined', {
        meetingId: normalizedMeetingId,
        hostSocketId: room.hostSocketId,
        hostUserId: room.hostUserId,
        isHost,
        participants: getRoomParticipants(room, socket.id),
        iceServers: buildIceServers(),
        hostReconnectUntil: room.hostReconnectUntil,
        attendanceGraceUntil: toIso(room.attendanceGraceUntil),
        meetingCode: access.role === 'teacher' ? room.meetingCode : null,
      })

      if (previousHostSocketId !== room.hostSocketId) {
        io.to(normalizedMeetingId).emit('meeting:host-changed', {
          hostSocketId: room.hostSocketId,
          hostUserId: room.hostUserId,
        })
      }

      emitMeetingState(normalizedMeetingId, room)

      socket.to(normalizedMeetingId).emit('meeting:participant-joined', {
        participant: publicParticipant(participant),
      })
    })

    socket.on('meeting:sync-request', () => {
      const { meetingId } = socket.data || {}
      if (!meetingId) return

      const room = rooms.get(meetingId)
      if (!room) return

      socket.emit('meeting:sync-response', {
        meetingId,
        hostSocketId: room.hostSocketId,
        hostUserId: room.hostUserId,
        participants: getRoomParticipants(room),
        hostReconnectUntil: room.hostReconnectUntil,
        attendanceGraceUntil: toIso(room.attendanceGraceUntil),
        iceServers: buildIceServers(),
        serverTime: Date.now(),
      })
    })

    socket.on('meeting:code-set', ({ meetingCode } = {}) => {
      const { meetingId } = socket.data || {}
      if (!meetingId) return

      const room = rooms.get(meetingId)
      if (!room || !isTeacherHost(room, socket)) return

      const nextCode = String(meetingCode || generateMeetingCode()).trim()
      if (!nextCode) return

      room.meetingCode = nextCode
      socket.emit('meeting:code-updated', { meetingCode: nextCode })
    })

    socket.on('meeting:attendance-grace-set', async ({ minutes } = {}) => {
      const { meetingId, userId } = socket.data || {}
      if (!meetingId) return

      const room = rooms.get(meetingId)
      if (!room || !isTeacherHost(room, socket)) return

      const normalizedMinutes = Math.max(0, Math.min(120, Number(minutes || 0)))
      room.attendanceGraceUntil = new Date(Date.now() + (normalizedMinutes * 60 * 1000))
      room.attendanceJoinClosed = false

      io.to(meetingId).emit('meeting:attendance-grace-updated', {
        attendanceGraceUntil: toIso(room.attendanceGraceUntil),
        setBy: userId || null,
      })

      emitMeetingState(meetingId, room)

      await persistEvent(room, 'attendance_grace_set', userId || null, {
        minutes: normalizedMinutes,
        attendanceGraceUntil: toIso(room.attendanceGraceUntil),
      })
    })

    socket.on('meeting:attendance-grace-end', async () => {
      const { meetingId, userId } = socket.data || {}
      if (!meetingId) return

      const room = rooms.get(meetingId)
      if (!room || !isTeacherHost(room, socket)) return

      room.attendanceGraceUntil = new Date()
      room.attendanceJoinClosed = true

      const removeTargets = Array.from(room.participants.values())
        .filter((participant) => participant.role === 'student' && participant.joinedAt > room.attendanceGraceUntil.getTime())

      for (const participant of removeTargets) {
        const targetSocket = io.sockets.sockets.get(participant.socketId)
        if (!targetSocket) continue
        targetSocket.emit('meeting:removed', { message: 'Attendance join window has ended.' })
        await cleanupSocketFromRoom(targetSocket, 'attendance_join_closed')
        targetSocket.data.meetingId = null
      }

      io.to(meetingId).emit('meeting:attendance-grace-updated', {
        attendanceGraceUntil: toIso(room.attendanceGraceUntil),
        setBy: userId || null,
      })

      emitMeetingState(meetingId, room)

      await persistEvent(room, 'attendance_grace_end', userId || null, {
        attendanceGraceUntil: toIso(room.attendanceGraceUntil),
        attendanceJoinClosed: true,
      })
    })

    socket.on('meeting:reaction', ({ emoji } = {}) => {
      const { meetingId, userId } = socket.data || {}
      if (!meetingId || !emoji) return

      const room = rooms.get(meetingId)
      if (!room || !room.participants.has(socket.id)) return

      io.to(meetingId).emit('meeting:reaction', {
        socketId: socket.id,
        userId: userId || null,
        emoji: String(emoji).slice(0, 8),
        at: Date.now(),
      })
    })

    socket.on('meeting:ping', () => {
      const { meetingId } = socket.data || {}
      socket.emit('meeting:pong', {
        meetingId: meetingId || null,
        serverTime: Date.now(),
      })
    })

    socket.on('meeting:leave', async () => {
      await cleanupSocketFromRoom(socket, 'left')
      socket.data.meetingId = null
    })

    socket.on('meeting:end', async () => {
      const { meetingId } = socket.data || {}
      if (!meetingId) return

      const room = rooms.get(meetingId)
      if (!room || !isTeacherHost(room, socket)) return

      clearHostReconnectTimer(room)
      io.to(meetingId).emit('meeting:ended')

      emitMeetingState(meetingId, room)

      await persistEvent(room, 'meeting_ended', socket.data?.userId || null, {
        bySocketId: socket.id,
      })

      for (const participant of room.participants.values()) {
        const participantSocket = io.sockets.sockets.get(participant.socketId)
        if (participantSocket) {
          participantSocket.leave(meetingId)
          participantSocket.data.meetingId = null
        }
        await trackParticipantLeave(room, participant, 'meeting_ended')
      }

      await closeMeetingSession(room, 'ended')
      rooms.delete(meetingId)
    })

    socket.on('meeting:remove-participant', async ({ targetSocketId } = {}) => {
      const { meetingId } = socket.data || {}
      if (!meetingId || !targetSocketId) return

      const room = rooms.get(meetingId)
      if (!room || !isTeacherHost(room, socket)) return

      const targetSocket = io.sockets.sockets.get(targetSocketId)
      if (!targetSocket) return
      if (targetSocket.data?.meetingId !== meetingId) return

      targetSocket.emit('meeting:removed')
      await cleanupSocketFromRoom(targetSocket, 'removed')
      targetSocket.data.meetingId = null

      await persistEvent(room, 'participant_removed', socket.data?.userId || null, {
        targetSocketId,
      })
    })

    socket.on('media:state', ({ micOn, camOn, screenOn } = {}) => {
      const { meetingId } = socket.data || {}
      if (!meetingId) return

      const room = rooms.get(meetingId)
      if (!room) return

      const participant = room.participants.get(socket.id)
      if (!participant) return

      if (typeof micOn === 'boolean') participant.micOn = micOn
      if (typeof camOn === 'boolean') participant.camOn = camOn
      if (typeof screenOn === 'boolean') participant.screenOn = screenOn

      io.to(meetingId).emit('media:state-changed', {
        socketId: socket.id,
        micOn: participant.micOn,
        camOn: participant.camOn,
        screenOn: participant.screenOn,
      })

      persistEvent(room, 'media_state_changed', participant.userId, {
        micOn: participant.micOn,
        camOn: participant.camOn,
        screenOn: participant.screenOn,
      })
    })

    socket.on('webrtc:offer', ({ toSocketId, sdp } = {}) => {
      const { meetingId } = socket.data || {}
      if (!meetingId || !toSocketId || !sdp) return

      const room = rooms.get(meetingId)
      if (!room || !room.participants.has(toSocketId)) return

      io.to(toSocketId).emit('webrtc:offer', {
        fromSocketId: socket.id,
        sdp,
      })
    })

    socket.on('webrtc:answer', ({ toSocketId, sdp } = {}) => {
      const { meetingId } = socket.data || {}
      if (!meetingId || !toSocketId || !sdp) return

      const room = rooms.get(meetingId)
      if (!room || !room.participants.has(toSocketId)) return

      io.to(toSocketId).emit('webrtc:answer', {
        fromSocketId: socket.id,
        sdp,
      })
    })

    socket.on('webrtc:ice-candidate', ({ toSocketId, candidate } = {}) => {
      const { meetingId } = socket.data || {}
      if (!meetingId || !toSocketId || !candidate) return

      const room = rooms.get(meetingId)
      if (!room || !room.participants.has(toSocketId)) return

      io.to(toSocketId).emit('webrtc:ice-candidate', {
        fromSocketId: socket.id,
        candidate,
      })
    })

    socket.on('disconnect', async () => {
      await cleanupSocketFromRoom(socket, 'disconnected')
      socket.data.meetingId = null
    })
  })
}
