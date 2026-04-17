import { supabase } from '../../config/supabase'
import { createClassNotification, createUserNotification } from '../notifications/notificationService'

const MESSAGE_LIMIT = 200
const CHAT_BUCKET = 'chat-attachments'

const normalizePathSegment = (value) =>
  String(value || 'file')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')

const buildAttachmentPath = ({ context, file }) => {
  const safeName = normalizePathSegment(file.name)
  return `${context}/${Date.now()}_${safeName}`
}

export const uploadChatAttachment = async ({ classId, threadId, file }) => {
  if (!file) return { data: null, error: { message: 'No attachment selected.' } }

  const context = threadId ? `direct/${threadId}` : `group/${classId}`
  const path = buildAttachmentPath({ context, file })

  const { error: uploadError } = await supabase.storage
    .from(CHAT_BUCKET)
    .upload(path, file)

  if (uploadError) return { data: null, error: uploadError }

  const { data: { publicUrl } } = supabase.storage
    .from(CHAT_BUCKET)
    .getPublicUrl(path)

  return {
    data: {
      attachment_url: publicUrl,
      attachment_name: file.name,
      attachment_type: file.type,
      attachment_size: file.size,
    },
    error: null,
  }
}

export const getGroupMessages = async (classId) => {
  const { data, error } = await supabase
    .from('class_group_messages')
    .select('*')
    .eq('class_id', classId)
    .order('created_at', { ascending: true })
    .limit(MESSAGE_LIMIT)

  return { data: data || [], error }
}

export const sendGroupMessage = async ({ classId, senderId, content, attachment }) => {
  const { data, error } = await supabase
    .from('class_group_messages')
    .insert({
      class_id: classId,
      sender_id: senderId,
      content: content?.trim() || '',
      attachment_url: attachment?.attachment_url || null,
      attachment_name: attachment?.attachment_name || null,
      attachment_type: attachment?.attachment_type || null,
      attachment_size: attachment?.attachment_size || null,
    })
    .select()
    .single()

  if (!error && data) {
    const previewText = (content || '').trim()
    const fallbackBody = attachment?.attachment_name ? `Attachment: ${attachment.attachment_name}` : 'New group message'

    const { error: notificationError } = await createClassNotification({
      classId,
      actorId: senderId,
      type: 'group_chat_message',
      title: 'New class chat message',
      body: previewText || fallbackBody,
      targetPath: `/classes/${classId}?tab=Chat&mode=group`,
      targetParams: {},
      recipients: 'all',
      debounceSeconds: 30,
    })

    if (notificationError) {
      console.warn('Group chat notification failed:', notificationError.message)
    }
  }

  return { data, error }
}

export const getOrCreateDirectThread = async ({ classId, teacherId, studentId }) => {
  const { data: existing, error: existingError } = await supabase
    .from('class_direct_threads')
    .select('*')
    .eq('class_id', classId)
    .eq('teacher_id', teacherId)
    .eq('student_id', studentId)
    .maybeSingle()

  if (existing && !existingError) return { data: existing, error: null }

  const { data: inserted, error: insertError } = await supabase
    .from('class_direct_threads')
    .insert({
      class_id: classId,
      teacher_id: teacherId,
      student_id: studentId,
    })
    .select()
    .single()

  if (!insertError) return { data: inserted, error: null }

  // If another client created the same thread concurrently, fetch the existing one.
  if (insertError.code === '23505') {
    const { data: concurrentRow, error: concurrentError } = await supabase
      .from('class_direct_threads')
      .select('*')
      .eq('class_id', classId)
      .eq('teacher_id', teacherId)
      .eq('student_id', studentId)
      .maybeSingle()

    return { data: concurrentRow, error: concurrentError }
  }

  return { data: null, error: insertError }
}

export const getDirectMessages = async (threadId) => {
  const { data, error } = await supabase
    .from('class_direct_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
    .limit(MESSAGE_LIMIT)

  return { data: data || [], error }
}

export const sendDirectMessage = async ({ threadId, senderId, content, attachment }) => {
  const { data, error } = await supabase
    .from('class_direct_messages')
    .insert({
      thread_id: threadId,
      sender_id: senderId,
      content: content?.trim() || '',
      attachment_url: attachment?.attachment_url || null,
      attachment_name: attachment?.attachment_name || null,
      attachment_type: attachment?.attachment_type || null,
      attachment_size: attachment?.attachment_size || null,
    })
    .select()
    .single()

  if (!error && data) {
    const { data: thread } = await supabase
      .from('class_direct_threads')
      .select('class_id, teacher_id, student_id')
      .eq('id', threadId)
      .maybeSingle()

    if (thread) {
      const recipientId = senderId === thread.teacher_id ? thread.student_id : thread.teacher_id
      const previewText = (content || '').trim()
      const fallbackBody = attachment?.attachment_name ? `Attachment: ${attachment.attachment_name}` : 'New direct message'

      const { error: notificationError } = await createUserNotification({
        recipientId,
        actorId: senderId,
        classId: thread.class_id,
        type: 'direct_chat_message',
        title: 'New direct message',
        body: previewText || fallbackBody,
        targetPath: `/classes/${thread.class_id}?tab=Chat&mode=direct&studentId=${thread.student_id}`,
        targetParams: { threadId },
      })

      if (notificationError) {
        console.warn('Direct chat notification failed:', notificationError.message)
      }
    }
  }

  return { data, error }
}

export const subscribeToGroupMessages = (classId, onMessage) => {
  const channelName = `class-group-${classId}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'class_group_messages',
        filter: `class_id=eq.${classId}`,
      },
      (payload) => onMessage(payload.new)
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}

export const subscribeToDirectMessages = (threadId, onMessage) => {
  const channelName = `class-direct-${threadId}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'class_direct_messages',
        filter: `thread_id=eq.${threadId}`,
      },
      (payload) => onMessage(payload.new)
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}
