import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, FileText, Loader2, MessageCircle, Paperclip, RefreshCcw, Send, Users, Video, X } from 'lucide-react'
import {
  getDirectMessages,
  getGroupMessages,
  getOrCreateDirectThread,
  sendDirectMessage,
  sendGroupMessage,
  subscribeToDirectMessages,
  subscribeToGroupMessages,
  uploadChatAttachment,
} from './chatService'

const CHAT_ATTACHMENT_ACCEPT = 'image/*,video/*,.pdf'

function formatTime(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function appendUniqueMessage(setter, message) {
  setter((prev) => {
    if (prev.some((item) => item.id === message.id)) return prev
    return [...prev, message]
  })
}

function formatFileSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function AttachmentPreview({ message }) {
  if (!message?.attachment_url) return null

  const type = message.attachment_type || ''
  const isImage = type.startsWith('image/')
  const isVideo = type.startsWith('video/')
  const isPdf = type === 'application/pdf' || message.attachment_name?.toLowerCase().endsWith('.pdf')

  return (
    <div className="mt-2 rounded-xl border border-black/10 bg-white/80 p-2">
      {isImage && (
        <a href={message.attachment_url} target="_blank" rel="noopener noreferrer">
          <img
            src={message.attachment_url}
            alt={message.attachment_name || 'Image attachment'}
            className="max-h-48 w-full rounded-lg object-cover"
          />
        </a>
      )}

      {isVideo && (
        <video controls className="max-h-56 w-full rounded-lg" src={message.attachment_url} />
      )}

      {!isImage && !isVideo && (
        <a
          href={message.attachment_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-xs font-semibold text-primary hover:underline"
        >
          {isPdf ? <FileText size={14} /> : <Video size={14} />}
          {message.attachment_name || 'Open attachment'}
        </a>
      )}

      <p className="mt-1 text-[10px] text-gray-500">{formatFileSize(message.attachment_size)}</p>
    </div>
  )
}

function ChatTab({ classId, classData, students, profile, initialMode = 'group', initialStudentId = '' }) {
  const [mode, setMode] = useState(initialMode === 'direct' ? 'direct' : 'group')
  const [groupMessages, setGroupMessages] = useState([])
  const [groupText, setGroupText] = useState('')
  const [groupAttachment, setGroupAttachment] = useState(null)
  const [groupLoading, setGroupLoading] = useState(true)
  const [groupError, setGroupError] = useState('')
  const [groupReloadTick, setGroupReloadTick] = useState(0)

  const [selectedStudentId, setSelectedStudentId] = useState(initialStudentId)
  const [directThread, setDirectThread] = useState(null)
  const [directMessages, setDirectMessages] = useState([])
  const [directText, setDirectText] = useState('')
  const [directAttachment, setDirectAttachment] = useState(null)
  const [directLoading, setDirectLoading] = useState(false)
  const [directError, setDirectError] = useState('')
  const [directReloadTick, setDirectReloadTick] = useState(0)

  const [error, setError] = useState('')

  const [groupSending, setGroupSending] = useState(false)
  const [directSending, setDirectSending] = useState(false)

  const isTeacher = profile?.role === 'teacher'
  const teacherId = classData?.teacher_id

  const studentOptions = useMemo(() => {
    return (students || [])
      .map((enrollment) => ({
        id: enrollment.student_id,
        name: enrollment.profiles?.full_name || enrollment.profiles?.email || 'Student',
      }))
      .filter((student) => Boolean(student.id))
  }, [students])

  useEffect(() => {
    setMode(initialMode === 'direct' ? 'direct' : 'group')
  }, [initialMode])

  useEffect(() => {
    if (initialStudentId) {
      setSelectedStudentId(initialStudentId)
    }
  }, [initialStudentId])

  const profilesById = useMemo(() => {
    const map = {}

    if (teacherId) {
      map[teacherId] = {
        full_name: classData?.profiles?.full_name || 'Teacher',
        role: 'teacher',
      }
    }

    for (const enrollment of students || []) {
      if (!enrollment.student_id) continue
      map[enrollment.student_id] = {
        full_name: enrollment.profiles?.full_name || enrollment.profiles?.email || 'Student',
        role: 'student',
      }
    }

    return map
  }, [classData?.profiles?.full_name, students, teacherId])

  useEffect(() => {
    const loadGroup = async () => {
      setGroupLoading(true)
      setGroupError('')
      const { data, error: loadError } = await getGroupMessages(classId)
      if (loadError) {
        setGroupError(loadError.message || 'Unable to load group chat right now.')
      } else {
        setGroupMessages(data)
      }
      setGroupLoading(false)
    }

    loadGroup()

    const unsubscribe = subscribeToGroupMessages(classId, (newMessage) => {
      appendUniqueMessage(setGroupMessages, newMessage)
    })

    return () => unsubscribe()
  }, [classId, groupReloadTick])

  const resolvedSelectedStudentId = isTeacher
    ? (studentOptions.some((student) => student.id === selectedStudentId)
      ? selectedStudentId
      : (studentOptions[0]?.id || ''))
    : profile?.id

  useEffect(() => {
    const partnerStudentId = resolvedSelectedStudentId

    if (!teacherId || !partnerStudentId) return

    let unsubscribe = null

    const loadDirect = async () => {
      setDirectLoading(true)
      setDirectError('')

      const { data: thread, error: threadError } = await getOrCreateDirectThread({
        classId,
        teacherId,
        studentId: partnerStudentId,
      })

      if (threadError || !thread) {
        setDirectThread(null)
        setDirectMessages([])
        setDirectLoading(false)
        setDirectError(threadError?.message || 'Unable to open direct chat.')
        return
      }

      setDirectThread(thread)

      const { data: messages, error: messageError } = await getDirectMessages(thread.id)
      if (messageError) {
        setDirectError(messageError.message || 'Unable to load direct messages.')
        setDirectMessages([])
      } else {
        setDirectMessages(messages)
      }

      unsubscribe = subscribeToDirectMessages(thread.id, (newMessage) => {
        appendUniqueMessage(setDirectMessages, newMessage)
      })

      setDirectLoading(false)
    }

    loadDirect()

    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [classId, resolvedSelectedStudentId, teacherId, directReloadTick])

  const handleSendGroup = async (e) => {
    e.preventDefault()
    if (!groupText.trim() && !groupAttachment) return

    setGroupSending(true)

    let attachmentPayload = null
    if (groupAttachment) {
      const { data: uploaded, error: uploadError } = await uploadChatAttachment({
        classId,
        file: groupAttachment,
      })

      if (uploadError) {
        setGroupSending(false)
        setError(uploadError.message)
        return
      }

      attachmentPayload = uploaded
    }

    const { data, error: sendError } = await sendGroupMessage({
      classId,
      senderId: profile.id,
      content: groupText,
      attachment: attachmentPayload,
    })

    setGroupSending(false)

    if (sendError) {
      setError(sendError.message)
      return
    }

    appendUniqueMessage(setGroupMessages, data)
    setGroupText('')
    setGroupAttachment(null)
  }

  const handleSendDirect = async (e) => {
    e.preventDefault()
    if ((!directText.trim() && !directAttachment) || !directThread?.id) return

    setDirectSending(true)

    let attachmentPayload = null
    if (directAttachment) {
      const { data: uploaded, error: uploadError } = await uploadChatAttachment({
        classId,
        threadId: directThread.id,
        file: directAttachment,
      })

      if (uploadError) {
        setDirectSending(false)
        setError(uploadError.message)
        return
      }

      attachmentPayload = uploaded
    }

    const { data, error: sendError } = await sendDirectMessage({
      threadId: directThread.id,
      senderId: profile.id,
      content: directText,
      attachment: attachmentPayload,
    })

    setDirectSending(false)

    if (sendError) {
      setError(sendError.message)
      return
    }

    appendUniqueMessage(setDirectMessages, data)
    setDirectText('')
    setDirectAttachment(null)
  }

  const directPartnerName = isTeacher
    ? studentOptions.find((student) => student.id === resolvedSelectedStudentId)?.name || 'Student'
    : profilesById[teacherId]?.full_name || 'Teacher'

  const canOpenDirectThread = Boolean(teacherId && resolvedSelectedStudentId)

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border border-gray-200 rounded-xl p-1 w-fit bg-gray-50">
        <button
          onClick={() => setMode('group')}
          className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${
            mode === 'group' ? 'bg-white text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <span className="inline-flex items-center gap-1.5"><Users size={14} /> Group Chat</span>
        </button>
        <button
          onClick={() => setMode('direct')}
          className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${
            mode === 'direct' ? 'bg-white text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <span className="inline-flex items-center gap-1.5"><MessageCircle size={14} /> 1 on 1</span>
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {mode === 'group' && (
        <div className="rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <p className="text-sm font-semibold text-gray-800">{classData?.subject || 'Class'} Group Chat</p>
            <p className="text-xs text-gray-500">All enrolled students and the teacher can chat here.</p>
          </div>

          <div className="h-80 overflow-y-auto p-4 space-y-3 bg-white">
            {groupLoading ? (
              <div className="h-full flex items-center justify-center text-gray-500">
                <div className="text-center">
                  <Loader2 size={18} className="animate-spin mx-auto" />
                  <p className="text-xs mt-2">Loading class messages...</p>
                </div>
              </div>
            ) : groupError ? (
              <div className="h-full flex items-center justify-center">
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 max-w-sm text-center">
                  <p className="inline-flex items-center gap-2"><AlertCircle size={14} /> {groupError}</p>
                  <button
                    onClick={() => setGroupReloadTick((value) => value + 1)}
                    className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-300 text-xs font-semibold hover:bg-red-100"
                  >
                    <RefreshCcw size={12} /> Retry
                  </button>
                </div>
              </div>
            ) : groupMessages.length === 0 ? (
              <div className="text-center mt-10">
                <p className="text-sm text-gray-500 font-medium">No messages yet</p>
                <p className="text-xs text-gray-400 mt-1">Start the conversation with a question or update.</p>
              </div>
            ) : (
              groupMessages.map((message) => {
                const mine = message.sender_id === profile.id
                const sender = profilesById[message.sender_id]
                return (
                  <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${mine ? 'bg-primary text-white' : 'bg-gray-100 text-gray-800'}`}>
                      {!mine && <p className="text-[11px] font-semibold opacity-80 mb-0.5">{sender?.full_name || 'Member'}</p>}
                      {message.content && <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>}
                      <AttachmentPreview message={message} />
                      <p className={`text-[10px] mt-1 ${mine ? 'text-white/80' : 'text-gray-400'}`}>{formatTime(message.created_at)}</p>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          <form onSubmit={handleSendGroup} className="border-t border-gray-100 p-3 bg-white flex gap-2">
            <input
              value={groupText}
              onChange={(e) => setGroupText(e.target.value)}
              placeholder="Send a message to the class..."
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <label className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-gray-200 px-3 py-2 text-gray-500 hover:bg-gray-50 hover:text-primary">
              <Paperclip size={14} />
              <input
                type="file"
                accept={CHAT_ATTACHMENT_ACCEPT}
                className="hidden"
                onChange={(e) => setGroupAttachment(e.target.files?.[0] || null)}
              />
            </label>
            <button
              type="submit"
              disabled={groupSending}
              className="bg-primary hover:bg-primary-dark text-white rounded-xl px-3 py-2 inline-flex items-center gap-1.5 text-sm font-semibold"
            >
              {groupSending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send
            </button>
          </form>
          {groupAttachment && (
            <div className="px-3 pb-3 -mt-2 bg-white">
              <div className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-700">
                <Paperclip size={12} />
                <span>{groupAttachment.name}</span>
                <button type="button" onClick={() => setGroupAttachment(null)} className="text-gray-400 hover:text-red-500">
                  <X size={12} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {mode === 'direct' && (
        <div className="rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-gray-800">Teacher-Student Direct Chat</p>
              <p className="text-xs text-gray-500">Private conversation for teacher and selected student.</p>
            </div>
            {isTeacher && (
              <select
                value={resolvedSelectedStudentId}
                onChange={(e) => setSelectedStudentId(e.target.value)}
                className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {studentOptions.map((student) => (
                  <option key={student.id} value={student.id}>{student.name}</option>
                ))}
              </select>
            )}
          </div>

          <div className="h-80 overflow-y-auto p-4 space-y-3 bg-white">
            {directLoading ? (
              <div className="h-full flex items-center justify-center text-gray-500">
                <div className="text-center">
                  <Loader2 size={18} className="animate-spin mx-auto" />
                  <p className="text-xs mt-2">Loading direct messages...</p>
                </div>
              </div>
            ) : directError ? (
              <div className="h-full flex items-center justify-center">
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 max-w-sm text-center">
                  <p className="inline-flex items-center gap-2"><AlertCircle size={14} /> {directError}</p>
                  <button
                    onClick={() => setDirectReloadTick((value) => value + 1)}
                    className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-300 text-xs font-semibold hover:bg-red-100"
                  >
                    <RefreshCcw size={12} /> Retry
                  </button>
                </div>
              </div>
            ) : !canOpenDirectThread ? (
              <p className="text-sm text-gray-400 text-center mt-10">No direct chat is available yet. It opens after class enrollment.</p>
            ) : !directThread ? (
              <p className="text-sm text-gray-400 text-center mt-10">Select a student to start chatting.</p>
            ) : directMessages.length === 0 ? (
              <p className="text-sm text-gray-400 text-center mt-10">No messages yet with {directPartnerName}.</p>
            ) : (
              directMessages.map((message) => {
                const mine = message.sender_id === profile.id
                const sender = profilesById[message.sender_id]
                return (
                  <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${mine ? 'bg-primary text-white' : 'bg-gray-100 text-gray-800'}`}>
                      {!mine && <p className="text-[11px] font-semibold opacity-80 mb-0.5">{sender?.full_name || 'Member'}</p>}
                      {message.content && <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>}
                      <AttachmentPreview message={message} />
                      <p className={`text-[10px] mt-1 ${mine ? 'text-white/80' : 'text-gray-400'}`}>{formatTime(message.created_at)}</p>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          <form onSubmit={handleSendDirect} className="border-t border-gray-100 p-3 bg-white flex gap-2">
            <input
              value={directText}
              onChange={(e) => setDirectText(e.target.value)}
              placeholder={`Message ${directPartnerName}...`}
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={!directThread || !canOpenDirectThread}
            />
            <label className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-gray-200 px-3 py-2 text-gray-500 hover:bg-gray-50 hover:text-primary">
              <Paperclip size={14} />
              <input
                type="file"
                accept={CHAT_ATTACHMENT_ACCEPT}
                className="hidden"
                disabled={!directThread || !canOpenDirectThread}
                onChange={(e) => setDirectAttachment(e.target.files?.[0] || null)}
              />
            </label>
            <button
              type="submit"
              disabled={!directThread || !canOpenDirectThread || directSending}
              className="bg-primary hover:bg-primary-dark disabled:opacity-60 text-white rounded-xl px-3 py-2 inline-flex items-center gap-1.5 text-sm font-semibold"
            >
              {directSending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send
            </button>
          </form>
          {directAttachment && (
            <div className="px-3 pb-3 -mt-2 bg-white">
              <div className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-700">
                <Paperclip size={12} />
                <span>{directAttachment.name}</span>
                <button type="button" onClick={() => setDirectAttachment(null)} className="text-gray-400 hover:text-red-500">
                  <X size={12} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ChatTab
