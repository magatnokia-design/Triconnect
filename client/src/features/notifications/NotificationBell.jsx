import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Sparkles, Trash2, X } from 'lucide-react'
import {
  clearAllNotifications,
  clearNotification,
  fetchNotifications,
  markNotificationRead,
  subscribeNotifications,
} from './notificationService'

const MAX_ITEMS = 12

function formatTime(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function NotificationBell({ userId }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([])
  const [error, setError] = useState('')

  const unreadCount = useMemo(
    () => items.reduce((count, item) => count + (item.read_at ? 0 : 1), 0),
    [items]
  )

  useEffect(() => {
    if (!userId) return

    let active = true

    const load = async () => {
      setLoading(true)
      setError('')
      const { data } = await fetchNotifications(userId, { limit: MAX_ITEMS })
      if (!active) return
      setItems(data || [])
      setLoading(false)
    }

    load()

    const unsubscribe = subscribeNotifications(userId, () => {
      load()
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [userId])

  const handleOpen = () => {
    setOpen((prev) => !prev)
  }

  const handleNotificationClick = async (notification) => {
    if (!notification?.id) return
    if (!notification.read_at) {
      await markNotificationRead(notification.id)
      setItems((prev) =>
        prev.map((row) => (row.id === notification.id ? { ...row, read_at: new Date().toISOString() } : row))
      )
    }

    setOpen(false)
    navigate(notification.target_path)
  }

  const handleClearOne = async (event, notificationId) => {
    event.stopPropagation()
    setError('')

    const { error: clearError } = await clearNotification(notificationId)
    if (clearError) {
      setError('Unable to clear notification.')
      return
    }

    setItems((prev) => prev.filter((item) => item.id !== notificationId))
  }

  const handleClearAll = async () => {
    if (items.length === 0) return

    setError('')
    const { error: clearError } = await clearAllNotifications(userId)
    if (clearError) {
      setError('Unable to clear all notifications.')
      return
    }

    setItems([])
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleOpen}
        className="relative rounded-xl border border-gray-200 bg-white px-3 py-2 text-gray-600 hover:bg-gray-50 hover:text-primary"
        aria-label="Open notifications"
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[320px] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
          <div className="border-b border-gray-100 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-gray-800">Notifications</p>
              <button
                type="button"
                onClick={handleClearAll}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-500 hover:bg-gray-50 hover:text-red-600"
              >
                <Trash2 size={12} />
                Clear all
              </button>
            </div>
            {!!unreadCount && (
              <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                <Sparkles size={11} />
                {unreadCount} new
              </p>
            )}
            {error && (
              <p className="mt-2 text-xs text-red-600">{error}</p>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <p className="px-4 py-6 text-sm text-gray-500">Loading notifications...</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-500">No notifications yet.</p>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNotificationClick(item)}
                  className={`w-full border-b border-gray-100 px-4 py-3 text-left transition hover:bg-gray-50 ${
                    item.read_at
                      ? 'bg-white'
                      : 'bg-gradient-to-r from-blue-50 to-cyan-50 ring-1 ring-blue-100'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800">{item.title}</p>
                      {!item.read_at && (
                        <span className="mt-1 inline-flex rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                          New
                        </span>
                      )}
                    </div>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(event) => handleClearOne(event, item.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          handleClearOne(event, item.id)
                        }
                      }}
                      className="rounded-lg p-1 text-gray-400 hover:bg-white hover:text-red-500"
                      aria-label="Clear notification"
                    >
                      <X size={13} />
                    </span>
                  </div>
                  {item.body && <p className="mt-1 text-xs text-gray-600 line-clamp-2">{item.body}</p>}
                  <p className="mt-1 text-[11px] text-gray-400">{formatTime(item.created_at)}</p>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default NotificationBell
