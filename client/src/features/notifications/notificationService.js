import { supabase } from '../../config/supabase'

export const fetchNotifications = async (userId, { limit = 30, unreadOnly = false } = {}) => {
  if (!userId) return { data: [], error: { message: 'Missing userId.' } }

  let query = supabase
    .from('notifications')
    .select('*')
    .eq('recipient_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (unreadOnly) {
    query = query.is('read_at', null)
  }

  const { data, error } = await query
  return { data: data || [], error }
}

export const subscribeNotifications = (userId, onChange) => {
  if (!userId) return () => {}

  const channel = supabase
    .channel(`notifications-${userId}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `recipient_id=eq.${userId}`,
      },
      (payload) => {
        if (typeof onChange === 'function') {
          onChange(payload)
        }
      }
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}

export const markNotificationRead = async (notificationId) => {
  if (!notificationId) return { data: null, error: { message: 'Missing notificationId.' } }

  const { data, error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .select()
    .single()

  return { data, error }
}

export const clearNotification = async (notificationId) => {
  if (!notificationId) return { error: { message: 'Missing notificationId.' } }

  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('id', notificationId)

  return { error }
}

export const clearAllNotifications = async (userId) => {
  if (!userId) return { error: { message: 'Missing userId.' } }

  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('recipient_id', userId)

  return { error }
}

export const createClassNotification = async ({
  classId,
  actorId = null,
  type,
  title,
  body = null,
  targetPath,
  targetParams = {},
  recipients = 'students',
  debounceSeconds = 0,
}) => {
  if (!classId || !type || !title || !targetPath) {
    return {
      data: null,
      error: { message: 'Missing required fields for class notification.' },
    }
  }

  const { data, error } = await supabase.rpc('create_class_notification', {
    p_class_id: classId,
    p_actor_id: actorId,
    p_type: type,
    p_title: title,
    p_body: body,
    p_target_path: targetPath,
    p_target_params: targetParams,
    p_recipients: recipients,
    p_debounce_seconds: debounceSeconds,
  })

  return { data, error }
}

export const createUserNotification = async ({
  recipientId,
  actorId = null,
  classId = null,
  type,
  title,
  body = null,
  targetPath,
  targetParams = {},
}) => {
  if (!recipientId || !type || !title || !targetPath) {
    return {
      data: null,
      error: { message: 'Missing required fields for user notification.' },
    }
  }

  const { data, error } = await supabase.rpc('create_user_notification', {
    p_recipient_id: recipientId,
    p_actor_id: actorId,
    p_class_id: classId,
    p_type: type,
    p_title: title,
    p_body: body,
    p_target_path: targetPath,
    p_target_params: targetParams,
  })

  return { data, error }
}
