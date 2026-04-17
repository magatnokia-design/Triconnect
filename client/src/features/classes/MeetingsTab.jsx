import { useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  Users,
  Shield,
  UserMinus,
  AlertCircle,
  Maximize2,
  Minimize2,
  RefreshCcw,
  CalendarDays,
  History,
  Download,
} from 'lucide-react'
import { useAuthStore } from '../../store/authStore'

const DEFAULT_API_BASE_URL = import.meta.env.DEV ? 'http://localhost:5000' : window.location.origin
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, '')
const SOCKET_URL = (import.meta.env.VITE_SOCKET_URL || API_BASE_URL).replace(/\/$/, '')
const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]

function buildDisplayName(profile, user) {
  if (profile?.full_name) return profile.full_name
  if (profile?.email) return profile.email
  if (user?.email) return user.email
  return 'Guest'
}

function formatRole(role) {
  return role === 'teacher' ? 'Teacher' : 'Student'
}

function defaultDateInput(dayOffset = 0) {
  const d = new Date()
  d.setDate(d.getDate() + dayOffset)
  return d.toISOString().slice(0, 10)
}

export default function MeetingsTab({ classId }) {
  const { user, profile } = useAuthStore()
  const [joined, setJoined] = useState(false)
  const [isHost, setIsHost] = useState(false)
  const [hostSocketId, setHostSocketId] = useState(null)
  const [hostReconnectUntil, setHostReconnectUntil] = useState(null)
  const [participants, setParticipants] = useState([])
  const [remoteStreams, setRemoteStreams] = useState({})
  const [error, setError] = useState('')
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [screenOn, setScreenOn] = useState(false)
  const [iceServers, setIceServers] = useState(DEFAULT_ICE_SERVERS)
  const [isFullscreenUI, setIsFullscreenUI] = useState(false)
  const [focusTile, setFocusTile] = useState('local')
  const [attendanceSessions, setAttendanceSessions] = useState([])
  const [attendanceLoading, setAttendanceLoading] = useState(false)
  const [attendanceError, setAttendanceError] = useState('')
  const [attendanceView, setAttendanceView] = useState('auto')
  const [selectedHistorySessionId, setSelectedHistorySessionId] = useState(null)
  const [historyFrom, setHistoryFrom] = useState(defaultDateInput(-30))
  const [historyTo, setHistoryTo] = useState(defaultDateInput(0))
  const [exportingCsv, setExportingCsv] = useState(false)
  const [attendanceGraceUntil, setAttendanceGraceUntil] = useState(null)
  const [attendanceGraceMinutes, setAttendanceGraceMinutes] = useState('5')
  const [graceRemainingSeconds, setGraceRemainingSeconds] = useState(0)
  const [connectionStatus, setConnectionStatus] = useState('idle')
  const [connectionDetail, setConnectionDetail] = useState('')

  const socketRef = useRef(null)
  const localVideoRef = useRef(null)
  const localStreamRef = useRef(null)
  const cameraTrackRef = useRef(null)
  const screenTrackRef = useRef(null)
  const peersRef = useRef(new Map())
  const iceServersRef = useRef(DEFAULT_ICE_SERVERS)

  const meetingId = useMemo(() => `class-${classId}`, [classId])
  const isTeacher = profile?.role === 'teacher'

  const myName = useMemo(() => buildDisplayName(profile, user), [profile, user])

  const upsertParticipant = (participant) => {
    setParticipants((prev) => {
      const idx = prev.findIndex((p) => p.socketId === participant.socketId)
      if (idx === -1) return [...prev, participant]
      const next = [...prev]
      next[idx] = { ...next[idx], ...participant }
      return next
    })
  }

  const removeParticipant = (socketId) => {
    setParticipants((prev) => prev.filter((p) => p.socketId !== socketId))
  }

  const setRemoteStream = (socketId, stream) => {
    setRemoteStreams((prev) => ({ ...prev, [socketId]: stream }))
  }

  const clearRemoteStream = (socketId) => {
    setRemoteStreams((prev) => {
      if (!prev[socketId]) return prev
      const copy = { ...prev }
      delete copy[socketId]
      return copy
    })
  }

  const getPeer = (targetSocketId) => peersRef.current.get(targetSocketId)

  const createPeerConnection = (targetSocketId) => {
    const existing = getPeer(targetSocketId)
    if (existing) return existing

    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current })

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current)
      })
    }

    pc.onicecandidate = (event) => {
      if (!event.candidate) return
      socketRef.current?.emit('webrtc:ice-candidate', {
        meetingId,
        toSocketId: targetSocketId,
        candidate: event.candidate,
      })
    }

    pc.ontrack = (event) => {
      const [stream] = event.streams
      if (stream) {
        setRemoteStream(targetSocketId, stream)
      }
    }

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState
      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        pc.close()
        peersRef.current.delete(targetSocketId)
        clearRemoteStream(targetSocketId)
      }
    }

    peersRef.current.set(targetSocketId, pc)
    return pc
  }

  const closePeer = (targetSocketId) => {
    const pc = getPeer(targetSocketId)
    if (!pc) return
    pc.onicecandidate = null
    pc.ontrack = null
    pc.onconnectionstatechange = null
    pc.close()
    peersRef.current.delete(targetSocketId)
    clearRemoteStream(targetSocketId)
  }

  const closeAllPeers = () => {
    for (const socketId of peersRef.current.keys()) {
      closePeer(socketId)
    }
  }

  const replaceOutgoingVideoTrack = async (newTrack) => {
    const tasks = []

    for (const pc of peersRef.current.values()) {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video')
      if (sender) {
        tasks.push(sender.replaceTrack(newTrack))
      }
    }

    await Promise.all(tasks)
  }

  const syncLocalPreview = () => {
    const node = localVideoRef.current
    const stream = localStreamRef.current
    if (!node || !stream) return
    if (node.srcObject !== stream) {
      node.srcObject = stream
    }
    node.muted = true
    node.playsInline = true
    node.play?.().catch(() => {})
  }

  const attachCameraTrack = async (track) => {
    if (!localStreamRef.current || !track) return

    cameraTrackRef.current = track

    for (const pc of peersRef.current.values()) {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video')
      if (sender) {
        await sender.replaceTrack(track)
      } else {
        pc.addTrack(track, localStreamRef.current)
      }
    }

    const existingVideoTrack = localStreamRef.current
      .getVideoTracks()
      .find((t) => t !== track)

    if (existingVideoTrack) {
      localStreamRef.current.removeTrack(existingVideoTrack)
      existingVideoTrack.stop()
    }

    if (!localStreamRef.current.getVideoTracks().includes(track)) {
      localStreamRef.current.addTrack(track)
    }

    track.onended = () => {
      if (screenTrackRef.current) return
      cameraTrackRef.current = null
      setCamOn(false)
      emitMediaState({ camOn: false })
    }

    setCamOn(true)
    emitMediaState({ camOn: true })
    syncLocalPreview()
  }

  const stopLocalMedia = () => {
    if (screenTrackRef.current) {
      screenTrackRef.current.onended = null
      screenTrackRef.current.stop()
      screenTrackRef.current = null
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop())
      localStreamRef.current = null
    }

    cameraTrackRef.current = null

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null
    }
  }

  const leaveMeeting = () => {
    socketRef.current?.emit('meeting:leave', { meetingId })
    socketRef.current?.disconnect()
    socketRef.current = null
    closeAllPeers()
    stopLocalMedia()
    setParticipants([])
    setRemoteStreams({})
    setJoined(false)
    setIsHost(false)
    setHostSocketId(null)
    setHostReconnectUntil(null)
    setScreenOn(false)
    setMicOn(true)
    setCamOn(true)
    setIsFullscreenUI(false)
    setFocusTile('local')
    setIceServers(DEFAULT_ICE_SERVERS)
    iceServersRef.current = DEFAULT_ICE_SERVERS
    setAttendanceGraceUntil(null)
    setConnectionStatus('idle')
    setConnectionDetail('')
  }

  const emitMediaState = (next = {}) => {
    socketRef.current?.emit('media:state', {
      meetingId,
      micOn: next.micOn ?? micOn,
      camOn: next.camOn ?? camOn,
      screenOn: next.screenOn ?? screenOn,
    })
  }

  const createOfferTo = async (targetSocketId) => {
    const pc = createPeerConnection(targetSocketId)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    socketRef.current?.emit('webrtc:offer', {
      meetingId,
      toSocketId: targetSocketId,
      sdp: offer,
    })
  }

  const handleIncomingOffer = async ({ fromSocketId, sdp }) => {
    const pc = createPeerConnection(fromSocketId)
    await pc.setRemoteDescription(new RTCSessionDescription(sdp))
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    socketRef.current?.emit('webrtc:answer', {
      meetingId,
      toSocketId: fromSocketId,
      sdp: answer,
    })
  }

  const handleIncomingAnswer = async ({ fromSocketId, sdp }) => {
    const pc = getPeer(fromSocketId)
    if (!pc) return
    await pc.setRemoteDescription(new RTCSessionDescription(sdp))
  }

  const handleIncomingCandidate = async ({ fromSocketId, candidate }) => {
    const pc = createPeerConnection(fromSocketId)
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate))
    } catch {
      // Ignore malformed or stale candidates.
    }
  }

  const joinMeeting = async () => {
    setError('')
    setConnectionStatus('connecting')
    setConnectionDetail('Connecting to meeting server...')

    try {
      let stream = null
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        setError('Camera is unavailable, joined with audio only.')
      }

      localStreamRef.current = stream
      cameraTrackRef.current = stream.getVideoTracks()[0] || null
      if (cameraTrackRef.current) {
        cameraTrackRef.current.onended = () => {
          if (screenTrackRef.current) return
          cameraTrackRef.current = null
          setCamOn(false)
          emitMediaState({ camOn: false })
        }
      }
      setMicOn(true)
      setCamOn(Boolean(cameraTrackRef.current))
      setScreenOn(false)

      syncLocalPreview()

      const socket = io(SOCKET_URL)
      socketRef.current = socket

      socket.on('connect', () => {
        setConnectionStatus('connected')
        setConnectionDetail('Connected. Meeting is live.')
      })

      socket.on('connect_error', () => {
        setConnectionStatus('reconnecting')
        setConnectionDetail('Network issue detected. Retrying connection...')
      })

      socket.on('disconnect', (reason) => {
        if (reason === 'io client disconnect') return
        setConnectionStatus('reconnecting')
        setConnectionDetail('Disconnected from server. Trying to reconnect...')
      })

      socket.io.on('reconnect_attempt', () => {
        setConnectionStatus('reconnecting')
        setConnectionDetail('Reconnecting to meeting...')
      })

      socket.io.on('reconnect', () => {
        setConnectionStatus('connected')
        setConnectionDetail('Reconnected successfully.')
      })

      socket.io.on('reconnect_failed', () => {
        setConnectionStatus('disconnected')
        setConnectionDetail('Unable to reconnect. Leave and rejoin the meeting.')
      })

      socket.on('meeting:error', ({ message }) => {
        setError(message || 'Unable to join meeting.')
      })

      socket.on('meeting:joined', async ({ participants: existing, isHost: host, hostSocketId: hostSid, hostReconnectUntil: reconnectUntil, iceServers: nextIceServers, attendanceGraceUntil: nextAttendanceGraceUntil }) => {
        setJoined(true)
        setConnectionStatus('connected')
        setConnectionDetail('Connected. Meeting is live.')
        setIsHost(Boolean(host))
        setHostSocketId(hostSid || null)
        setHostReconnectUntil(reconnectUntil || null)
        setAttendanceGraceUntil(nextAttendanceGraceUntil || null)
        setParticipants(existing || [])

        if (Array.isArray(nextIceServers) && nextIceServers.length > 0) {
          setIceServers(nextIceServers)
          iceServersRef.current = nextIceServers
        }

        for (const participant of existing || []) {
          await createOfferTo(participant.socketId)
        }

        emitMediaState({ micOn: true, camOn: Boolean(cameraTrackRef.current), screenOn: false })
      })

      socket.on('meeting:participant-joined', ({ participant }) => {
        if (!participant) return
        upsertParticipant(participant)
      })

      socket.on('meeting:participant-left', ({ socketId }) => {
        if (!socketId) return
        removeParticipant(socketId)
        closePeer(socketId)
      })

      socket.on('meeting:host-changed', ({ hostSocketId: hostSid }) => {
        setHostSocketId(hostSid || null)
        setIsHost(hostSid === socket.id)
        setHostReconnectUntil(null)
      })

      socket.on('meeting:host-reconnecting', ({ reconnectUntil }) => {
        setHostReconnectUntil(reconnectUntil || null)
      })

      socket.on('meeting:state', ({ attendanceGraceUntil: nextGraceUntil }) => {
        setAttendanceGraceUntil(nextGraceUntil || null)
      })

      socket.on('meeting:attendance-grace-updated', ({ attendanceGraceUntil: nextGraceUntil }) => {
        setAttendanceGraceUntil(nextGraceUntil || null)
      })

      socket.on('meeting:ended', () => {
        setError('Meeting has ended.')
        leaveMeeting()
      })

      socket.on('meeting:removed', (payload = {}) => {
        setError(payload?.message || 'You were removed by the host.')
        leaveMeeting()
      })

      socket.on('media:state-changed', ({ socketId, micOn: nextMic, camOn: nextCam, screenOn: nextScreen }) => {
        setParticipants((prev) => prev.map((p) => {
          if (p.socketId !== socketId) return p
          return {
            ...p,
            micOn: typeof nextMic === 'boolean' ? nextMic : p.micOn,
            camOn: typeof nextCam === 'boolean' ? nextCam : p.camOn,
            screenOn: typeof nextScreen === 'boolean' ? nextScreen : p.screenOn,
          }
        }))
      })

      socket.on('webrtc:offer', async (payload) => {
        await handleIncomingOffer(payload)
      })

      socket.on('webrtc:answer', async (payload) => {
        await handleIncomingAnswer(payload)
      })

      socket.on('webrtc:ice-candidate', async (payload) => {
        await handleIncomingCandidate(payload)
      })

      socket.emit('meeting:join', {
        meetingId,
        classId,
        userId: user?.id,
        name: myName,
        role: profile?.role,
        micOn: true,
        camOn: Boolean(cameraTrackRef.current),
        screenOn: false,
      })
    } catch {
      setError('Camera/microphone access is required to join.')
      stopLocalMedia()
    }
  }

  const toggleMic = () => {
    if (!localStreamRef.current) return
    const audioTrack = localStreamRef.current.getAudioTracks()[0]
    if (!audioTrack) return

    const next = !audioTrack.enabled
    audioTrack.enabled = next
    setMicOn(next)
    emitMediaState({ micOn: next })
  }

  const toggleCam = () => {
    const run = async () => {
      if (!localStreamRef.current) return
      const videoTrack = localStreamRef.current.getVideoTracks()[0]

      if (!videoTrack || videoTrack.readyState === 'ended') {
        try {
          const videoOnly = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
          const nextTrack = videoOnly.getVideoTracks()[0]
          if (!nextTrack) {
            setError('Unable to acquire camera track.')
            return
          }
          await attachCameraTrack(nextTrack)
          return
        } catch {
          setError('Camera permission is blocked or unavailable.')
          return
        }
      }

      const next = !videoTrack.enabled
      videoTrack.enabled = next
      setCamOn(next)
      emitMediaState({ camOn: next })
      syncLocalPreview()
    }

    run()
  }

  const stopScreenShare = async () => {
    if (!localStreamRef.current || !screenTrackRef.current || !cameraTrackRef.current) return

    await replaceOutgoingVideoTrack(cameraTrackRef.current)

    localStreamRef.current.removeTrack(screenTrackRef.current)
    localStreamRef.current.addTrack(cameraTrackRef.current)

    syncLocalPreview()

    screenTrackRef.current.onended = null
    screenTrackRef.current.stop()
    screenTrackRef.current = null

    setScreenOn(false)
    emitMediaState({ screenOn: false, camOn })
  }

  const startScreenShare = async () => {
    if (!localStreamRef.current) return

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true })
      const screenTrack = displayStream.getVideoTracks()[0]
      if (!screenTrack) return

      const currentVideoTrack = localStreamRef.current.getVideoTracks()[0] || null
      if (currentVideoTrack && currentVideoTrack !== cameraTrackRef.current) {
        cameraTrackRef.current = currentVideoTrack
      }

      await replaceOutgoingVideoTrack(screenTrack)

      if (currentVideoTrack) {
        localStreamRef.current.removeTrack(currentVideoTrack)
      }
      localStreamRef.current.addTrack(screenTrack)

      syncLocalPreview()

      screenTrackRef.current = screenTrack
      setScreenOn(true)
      setCamOn(true)
      emitMediaState({ screenOn: true, camOn: true })

      screenTrack.onended = () => {
        stopScreenShare()
      }
    } catch {
      setError('Screen share was canceled or blocked by the browser.')
    }
  }

  const toggleScreenShare = async () => {
    if (screenOn) {
      await stopScreenShare()
      return
    }
    await startScreenShare()
  }

  const removeParticipantAsHost = (targetSocketId) => {
    if (!isHost) return
    socketRef.current?.emit('meeting:remove-participant', { targetSocketId })
  }

  const endMeeting = () => {
    if (!isHost) return
    socketRef.current?.emit('meeting:end', { meetingId })
  }

  const setAttendanceGrace = () => {
    if (!isHost) return
    const minutes = Math.max(0, Math.min(120, Number(attendanceGraceMinutes || 0)))
    socketRef.current?.emit('meeting:attendance-grace-set', { minutes })
  }

  const endAttendanceGraceNow = () => {
    if (!isHost) return
    socketRef.current?.emit('meeting:attendance-grace-end')
  }

  const loadAttendance = async () => {
    if (!isTeacher) return

    setAttendanceLoading(true)
    setAttendanceError('')

    try {
      const response = await fetch(`${API_BASE_URL}/api/meetings/classes/${classId}/attendance`)
      if (!response.ok) {
        const fallback = 'Failed to load attendance.'
        let message = fallback
        try {
          const body = await response.json()
          message = body?.message || fallback
        } catch {
          message = fallback
        }
        throw new Error(message)
      }

      const data = await response.json()
      const sessions = data?.sessions || []
      setAttendanceSessions(sessions)
      setSelectedHistorySessionId((prev) => {
        const stillExists = sessions.some((session) => session.id === prev)
        if (stillExists) return prev
        return sessions[0]?.id || null
      })
    } catch (err) {
      setAttendanceError(err.message || 'Failed to load attendance.')
    } finally {
      setAttendanceLoading(false)
    }
  }

  const toggleFullscreenUI = () => {
    setIsFullscreenUI((prev) => !prev)
  }

  const exportAttendanceCsv = async ({ sessionId = null, fromDate = '', toDate = '' } = {}) => {
    setAttendanceError('')
    setExportingCsv(true)

    try {
      const params = new URLSearchParams()
      if (sessionId) {
        params.set('sessionId', sessionId)
      } else {
        if (!fromDate || !toDate) {
          throw new Error('Please choose both From and To dates for range export.')
        }

        const from = new Date(`${fromDate}T00:00:00`)
        const to = new Date(`${toDate}T23:59:59.999`)
        if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
          throw new Error('Invalid date range.')
        }
        if (from > to) {
          throw new Error('From date must be before To date.')
        }

        params.set('from', from.toISOString())
        params.set('to', to.toISOString())
      }

      const response = await fetch(`${API_BASE_URL}/api/meetings/classes/${classId}/attendance/export.csv?${params.toString()}`)

      if (!response.ok) {
        let message = 'Failed to export attendance CSV.'
        try {
          const body = await response.json()
          message = body?.message || message
        } catch {
          // Ignore JSON parse failure on non-JSON response.
        }
        throw new Error(message)
      }

      const blob = await response.blob()
      const objectUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = sessionId
        ? `meeting-attendance-session-${sessionId}.csv`
        : `meeting-attendance-range-${fromDate}-to-${toDate}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(objectUrl)
    } catch (err) {
      setAttendanceError(err.message || 'Failed to export attendance CSV.')
    } finally {
      setExportingCsv(false)
    }
  }

  useEffect(() => {
    return () => {
      leaveMeeting()
    }
    // Intentionally run only on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsFullscreenUI(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!joined) return
    syncLocalPreview()
  }, [joined, isFullscreenUI, focusTile, camOn, screenOn])

  useEffect(() => {
    if (!attendanceGraceUntil) {
      setGraceRemainingSeconds(0)
      return
    }

    const tick = () => {
      const remaining = Math.max(0, Math.floor((new Date(attendanceGraceUntil).getTime() - Date.now()) / 1000))
      setGraceRemainingSeconds(remaining)
    }

    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [attendanceGraceUntil])

  useEffect(() => {
    loadAttendance()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, isTeacher])

  const tiles = [
    {
      key: 'local',
      title: `${myName} (You)`,
      subtitle: formatRole(profile?.role),
      isHost,
      micOn,
      camOn,
      screenOn,
      isLocal: true,
      videoRef: localVideoRef,
      remoteStream: null,
      onRemove: null,
    },
    ...participants.map((participant) => ({
      key: participant.socketId,
      title: participant.name,
      subtitle: formatRole(participant.role),
      isHost: hostSocketId === participant.socketId,
      micOn: participant.micOn,
      camOn: participant.camOn,
      screenOn: participant.screenOn,
      isLocal: false,
      videoRef: null,
      remoteStream: remoteStreams[participant.socketId],
      onRemove: isHost ? () => removeParticipantAsHost(participant.socketId) : null,
    })),
  ]

  const focusTileData = tiles.find((tile) => tile.key === focusTile) || tiles[0]
  const stripTiles = tiles.filter((tile) => tile.key !== focusTileData?.key)
  const selectedHistorySession = attendanceSessions.find((session) => session.id === selectedHistorySessionId) || attendanceSessions[0] || null

  return (
    <div className={isFullscreenUI ? 'fixed inset-0 z-50 bg-slate-950 p-4 md:p-6 overflow-auto' : 'space-y-5'}>
      {!joined ? (
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h3 className="text-lg font-bold text-gray-900">Live Class Meeting</h3>
              <p className="text-sm text-gray-500 mt-1">Join real-time video class with camera, mic, and screen sharing.</p>
            </div>
            <button
              onClick={joinMeeting}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition"
            >
              Join Meeting
            </button>
          </div>

          {error && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 text-red-600 px-3 py-2 text-sm">
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className={`border rounded-2xl shadow-sm p-4 flex items-center justify-between gap-4 flex-wrap ${isFullscreenUI ? 'bg-slate-900/80 border-slate-700 backdrop-blur text-white' : 'bg-white border-gray-100'}`}>
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isFullscreenUI ? 'bg-slate-700 text-slate-100' : 'bg-blue-50 text-blue-700'}`}>
                <Users size={18} />
              </div>
              <div>
                <p className={`text-sm font-semibold ${isFullscreenUI ? 'text-white' : 'text-gray-900'}`}>Meeting in Progress</p>
                <p className={`text-xs ${isFullscreenUI ? 'text-slate-300' : 'text-gray-500'}`}>{participants.length + 1} participant{participants.length + 1 !== 1 ? 's' : ''}</p>
                {hostReconnectUntil && (
                  <p className={`text-xs mt-1 ${isFullscreenUI ? 'text-amber-300' : 'text-amber-700'}`}>
                    Host reconnect window active...
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={toggleMic}
                className={`px-3 py-2 rounded-xl text-sm font-semibold transition flex items-center gap-2 ${micOn ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}
              >
                {micOn ? <Mic size={15} /> : <MicOff size={15} />}
                {micOn ? 'Mic On' : 'Mic Off'}
              </button>

              <button
                onClick={toggleCam}
                className={`px-3 py-2 rounded-xl text-sm font-semibold transition flex items-center gap-2 ${camOn ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}
              >
                {camOn ? <Video size={15} /> : <VideoOff size={15} />}
                {camOn ? 'Cam On' : 'Cam Off'}
              </button>

              <button
                onClick={toggleScreenShare}
                className={`px-3 py-2 rounded-xl text-sm font-semibold transition flex items-center gap-2 ${screenOn ? 'bg-green-50 text-green-700 hover:bg-green-100' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                {screenOn ? <MonitorOff size={15} /> : <Monitor size={15} />}
                {screenOn ? 'Stop Share' : 'Share Screen'}
              </button>

              <button
                onClick={toggleFullscreenUI}
                className={`px-3 py-2 rounded-xl text-sm font-semibold transition flex items-center gap-2 ${isFullscreenUI ? 'bg-slate-700 text-slate-100 hover:bg-slate-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                {isFullscreenUI ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                {isFullscreenUI ? 'Exit Fullscreen' : 'Fullscreen'}
              </button>

              {isHost ? (
                <button
                  onClick={endMeeting}
                  className="px-3 py-2 rounded-xl text-sm font-semibold bg-red-600 hover:bg-red-700 text-white transition flex items-center gap-2"
                >
                  <PhoneOff size={15} />
                  End Meeting
                </button>
              ) : (
                <button
                  onClick={leaveMeeting}
                  className="px-3 py-2 rounded-xl text-sm font-semibold bg-red-50 text-red-600 hover:bg-red-100 transition flex items-center gap-2"
                >
                  <PhoneOff size={15} />
                  Leave
                </button>
              )}
            </div>
          </div>

          {isHost && (
            <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-3 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Attendance Join Timer</p>
                <p className="text-sm text-blue-700">
                  {attendanceGraceUntil && new Date(attendanceGraceUntil) > new Date()
                    ? `Join grace active until ${formatDateTime(attendanceGraceUntil)} (${formatCountdown(graceRemainingSeconds)} remaining).`
                    : 'No active join grace timer. New joiners are evaluated immediately.'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={attendanceGraceMinutes}
                  onChange={(e) => setAttendanceGraceMinutes(e.target.value)}
                  className="w-20 border border-blue-200 rounded-lg px-2.5 py-1.5 text-sm"
                />
                <button
                  onClick={setAttendanceGrace}
                  className="rounded-lg bg-blue-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-blue-700"
                >
                  Start Timer
                </button>
                <button
                  onClick={endAttendanceGraceNow}
                  className="rounded-lg border border-blue-200 bg-white text-blue-700 px-3 py-1.5 text-xs font-semibold hover:bg-blue-100"
                >
                  End Now
                </button>
              </div>
            </div>
          )}

          {(connectionStatus === 'reconnecting' || connectionStatus === 'disconnected') && (
            <div className={`rounded-xl border px-3 py-2 text-sm ${connectionStatus === 'disconnected' ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
              <p className="inline-flex items-center gap-2">
                <AlertCircle size={14} />
                {connectionDetail || (connectionStatus === 'disconnected' ? 'Connection lost. Please rejoin the meeting.' : 'Connection is unstable. Reconnecting...')}
              </p>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 text-red-600 px-3 py-2 text-sm">
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          )}

          <div className={isFullscreenUI ? 'grid lg:grid-cols-[2fr_1fr] gap-4 min-h-[calc(100vh-170px)]' : 'space-y-4'}>
            <VideoTile
              title={focusTileData.title}
              subtitle={focusTileData.subtitle}
              isHost={focusTileData.isHost}
              micOn={focusTileData.micOn}
              camOn={focusTileData.camOn}
              screenOn={focusTileData.screenOn}
              isLocal={focusTileData.isLocal}
              videoRef={focusTileData.videoRef}
              remoteStream={focusTileData.remoteStream}
              onRemove={focusTileData.onRemove}
              large
              onSelect={null}
            />

            <div className={isFullscreenUI ? 'grid auto-rows-min gap-3 overflow-auto pr-1' : 'grid md:grid-cols-2 xl:grid-cols-3 gap-4'}>
              {stripTiles.map((tile) => (
                <VideoTile
                  key={tile.key}
                  title={tile.title}
                  subtitle={tile.subtitle}
                  isHost={tile.isHost}
                  micOn={tile.micOn}
                  camOn={tile.camOn}
                  screenOn={tile.screenOn}
                  isLocal={tile.isLocal}
                  videoRef={tile.videoRef}
                  remoteStream={tile.remoteStream}
                  onRemove={tile.onRemove}
                  onSelect={() => setFocusTile(tile.key)}
                />
              ))}
            </div>
          </div>
        </>
      )}

      {isTeacher && (
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2 mr-2">
                <CalendarDays size={16} className="text-blue-600" />
                <h4 className="text-sm font-bold text-gray-900">Meeting Attendance</h4>
              </div>
              <div className="inline-flex items-center gap-1 rounded-lg border border-gray-200 p-1 bg-gray-50">
                <button
                  onClick={() => setAttendanceView('auto')}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${attendanceView === 'auto' ? 'bg-white text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  Auto Attendance
                </button>
                <button
                  onClick={() => setAttendanceView('history')}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition inline-flex items-center gap-1 ${attendanceView === 'history' ? 'bg-white text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  <History size={12} /> History
                </button>
              </div>
            </div>
            <button
              onClick={loadAttendance}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition"
            >
              <RefreshCcw size={13} className={attendanceLoading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>

          {attendanceError && (
            <div className="m-4 rounded-xl border border-red-100 bg-red-50 text-red-600 px-3 py-2 text-sm">
              {attendanceError}
            </div>
          )}

          {attendanceLoading ? (
            <div className="px-5 py-8 text-sm text-gray-500">Loading attendance...</div>
          ) : attendanceSessions.length === 0 ? (
            <div className="px-5 py-8 text-sm text-gray-500">No meeting sessions yet for this class.</div>
          ) : attendanceView === 'auto' ? (
            <div className="space-y-4 p-4">
              {attendanceSessions.map((session) => (
                <div key={session.id} className="rounded-xl border border-gray-100 overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Session {formatDateTime(session.started_at)}</p>
                      <p className="text-xs text-gray-500">Status: {session.status} · Duration: {formatDuration(session.durationMinutes)}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-semibold">
                      <span className="px-2 py-1 rounded-md bg-emerald-50 text-emerald-700">Present: {session.summary?.present || 0}</span>
                      <span className="px-2 py-1 rounded-md bg-amber-50 text-amber-700">Late: {session.summary?.late || 0}</span>
                      <span className="px-2 py-1 rounded-md bg-rose-50 text-rose-700">Absent: {session.summary?.absent || 0}</span>
                      <span className="px-2 py-1 rounded-md bg-blue-50 text-blue-700">Rate: {Number(session.attendanceRate || 0).toFixed(1)}%</span>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-white border-b border-gray-100 text-gray-500">
                        <tr>
                          <th className="text-left px-4 py-2.5 font-semibold">Student</th>
                          <th className="text-left px-4 py-2.5 font-semibold">First Join</th>
                          <th className="text-left px-4 py-2.5 font-semibold">Last Leave</th>
                          <th className="text-left px-4 py-2.5 font-semibold">Minutes</th>
                          <th className="text-left px-4 py-2.5 font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(session.attendance || []).map((row) => (
                          <tr key={`${session.id}-${row.userId}`} className="border-b border-gray-50 last:border-none">
                            <td className="px-4 py-2.5 text-gray-800">
                              <div className="font-medium">{row.studentName}</div>
                              <div className="text-xs text-gray-400">{row.studentCode || row.email || row.userId}</div>
                            </td>
                            <td className="px-4 py-2.5 text-gray-600">{formatDateTime(row.firstJoinAt)}</td>
                            <td className="px-4 py-2.5 text-gray-600">{formatDateTime(row.lastLeftAt)}</td>
                            <td className="px-4 py-2.5 text-gray-800">{Number(row.totalMinutes || 0).toFixed(2)}</td>
                            <td className="px-4 py-2.5">
                              <span className={`px-2 py-1 rounded-md text-xs font-semibold ${row.status === 'present' ? 'bg-emerald-50 text-emerald-700' : row.status === 'late' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>
                                {row.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 grid lg:grid-cols-[320px_1fr] gap-4">
              <div className="rounded-xl border border-gray-100 overflow-hidden h-fit">
                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Meeting Sessions</p>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={historyFrom}
                      onChange={(e) => setHistoryFrom(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs"
                    />
                    <input
                      type="date"
                      value={historyTo}
                      onChange={(e) => setHistoryTo(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs"
                    />
                  </div>
                  <button
                    onClick={() => exportAttendanceCsv({ fromDate: historyFrom, toDate: historyTo })}
                    disabled={exportingCsv}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                  >
                    <Download size={12} /> {exportingCsv ? 'Exporting...' : 'Export Date Range CSV'}
                  </button>
                </div>
                <div className="max-h-[420px] overflow-y-auto divide-y divide-gray-100">
                  {attendanceSessions.map((session) => {
                    const active = selectedHistorySession?.id === session.id
                    return (
                      <button
                        key={session.id}
                        onClick={() => setSelectedHistorySessionId(session.id)}
                        className={`w-full text-left px-4 py-3 transition ${active ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                      >
                        <p className="text-sm font-semibold text-gray-800">{formatDateTime(session.started_at)}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{formatDuration(session.durationMinutes)} · {session.summary?.present || 0} present · {Number(session.attendanceRate || 0).toFixed(1)}% rate</p>
                      </button>
                    )
                  })}
                </div>
              </div>

              {selectedHistorySession ? (
                <div className="rounded-xl border border-gray-100 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Attendance History Details</p>
                      <p className="text-xs text-gray-500">Session {formatDateTime(selectedHistorySession.started_at)} · {formatDuration(selectedHistorySession.durationMinutes)} · Grace window {Number(selectedHistorySession.graceWindowMin || 0).toFixed(1)}m</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-semibold flex-wrap">
                      <span className="px-2 py-1 rounded-md bg-emerald-50 text-emerald-700">Present: {selectedHistorySession.summary?.present || 0}</span>
                      <span className="px-2 py-1 rounded-md bg-amber-50 text-amber-700">Late: {selectedHistorySession.summary?.late || 0}</span>
                      <span className="px-2 py-1 rounded-md bg-rose-50 text-rose-700">Absent: {selectedHistorySession.summary?.absent || 0}</span>
                      <button
                        onClick={() => exportAttendanceCsv({ sessionId: selectedHistorySession.id })}
                        disabled={exportingCsv}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                      >
                        <Download size={12} /> Session CSV
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-white border-b border-gray-100 text-gray-500">
                        <tr>
                          <th className="text-left px-4 py-2.5 font-semibold">Student</th>
                          <th className="text-left px-4 py-2.5 font-semibold">First Join</th>
                          <th className="text-left px-4 py-2.5 font-semibold">Last Leave</th>
                          <th className="text-left px-4 py-2.5 font-semibold">Minutes</th>
                          <th className="text-left px-4 py-2.5 font-semibold">Coverage</th>
                          <th className="text-left px-4 py-2.5 font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(selectedHistorySession.attendance || []).map((row) => (
                          <tr key={`${selectedHistorySession.id}-${row.userId}`} className="border-b border-gray-50 last:border-none">
                            <td className="px-4 py-2.5 text-gray-800">
                              <div className="font-medium">{row.studentName}</div>
                              <div className="text-xs text-gray-400">{row.studentCode || row.email || row.userId}</div>
                            </td>
                            <td className="px-4 py-2.5 text-gray-600">{formatDateTime(row.firstJoinAt)}</td>
                            <td className="px-4 py-2.5 text-gray-600">{formatDateTime(row.lastLeftAt)}</td>
                            <td className="px-4 py-2.5 text-gray-800">{Number(row.totalMinutes || 0).toFixed(2)}</td>
                            <td className="px-4 py-2.5 text-gray-800">{Number(row.attendanceRatio || 0).toFixed(1)}%</td>
                            <td className="px-4 py-2.5">
                              <span className={`px-2 py-1 rounded-md text-xs font-semibold ${row.status === 'present' ? 'bg-emerald-50 text-emerald-700' : row.status === 'late' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>
                                {row.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function formatDateTime(value) {
  if (!value) return '--'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '--'
  return d.toLocaleString()
}

function formatDuration(minutesValue) {
  const minutes = Number(minutesValue || 0)
  if (minutes <= 0) return '0m'
  if (minutes < 60) return `${minutes.toFixed(0)}m`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return `${h}h ${m}m`
}

function formatCountdown(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds || 0))
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function VideoTile({
  title,
  subtitle,
  isHost,
  micOn,
  camOn,
  screenOn,
  isLocal,
  videoRef,
  remoteStream,
  onRemove,
  large,
  onSelect,
}) {
  const remoteVideoRef = useRef(null)

  useEffect(() => {
    if (!remoteVideoRef.current) return
    remoteVideoRef.current.srcObject = remoteStream || null
    remoteVideoRef.current.play?.().catch(() => {})
  }, [remoteStream])

  useEffect(() => {
    if (!isLocal || !videoRef?.current) return
    videoRef.current.play?.().catch(() => {})
  }, [isLocal, videoRef, camOn, screenOn])

  return (
    <div
      className={`rounded-2xl overflow-hidden border bg-white shadow-sm ${large ? 'border-slate-700' : 'border-gray-100'} ${onSelect ? 'cursor-pointer' : ''}`}
      onClick={onSelect || undefined}
    >
      <div className={`${large ? 'min-h-[56vh] md:min-h-[68vh]' : 'aspect-video'} bg-gray-900 relative`}>
        <video
          ref={isLocal ? videoRef : remoteVideoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className={`w-full h-full object-cover ${camOn || screenOn ? 'opacity-100' : 'opacity-0'}`}
        />

        {!camOn && !screenOn && (
          <div className="absolute inset-0 grid place-items-center text-gray-200 text-sm">
            Camera is off
          </div>
        )}

        <div className="absolute top-2 left-2 flex items-center gap-2">
          {isHost && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-amber-500/90 text-white font-semibold">
              <Shield size={12} />
              Host
            </span>
          )}
          {screenOn && (
            <span className="text-[11px] px-2 py-1 rounded-md bg-green-500/90 text-white font-semibold">
              Sharing
            </span>
          )}
        </div>

        <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2">
          <div className="bg-black/50 text-white px-2 py-1 rounded-md text-xs backdrop-blur flex items-center gap-2">
            <span>{title}</span>
            <span className="text-white/70">•</span>
            <span className="text-white/80">{subtitle}</span>
          </div>

          <div className="flex items-center gap-1">
            <span className={`w-7 h-7 rounded-md grid place-items-center ${micOn ? 'bg-emerald-500/90 text-white' : 'bg-red-500/90 text-white'}`}>
              {micOn ? <Mic size={13} /> : <MicOff size={13} />}
            </span>
            <span className={`w-7 h-7 rounded-md grid place-items-center ${camOn || screenOn ? 'bg-emerald-500/90 text-white' : 'bg-red-500/90 text-white'}`}>
              {camOn || screenOn ? <Video size={13} /> : <VideoOff size={13} />}
            </span>
          </div>
        </div>
      </div>

      {onRemove && (
        <div className="p-2 border-t border-gray-100">
          <button
            onClick={onRemove}
            className="w-full flex items-center justify-center gap-2 text-xs font-semibold rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition px-2 py-2"
          >
            <UserMinus size={13} />
            Remove from meeting
          </button>
        </div>
      )}
    </div>
  )
}
