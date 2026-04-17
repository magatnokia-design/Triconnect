import { useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { joinClass } from './classService'
import { useAuthStore } from '../../store/authStore'

function JoinClassModal({ onClose, onJoined }) {
  const { profile } = useAuthStore()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!code.trim()) { setError('Please enter a class code.'); return }

    setLoading(true)
    const { classData, error: err } = await joinClass({ code, studentId: profile.id })
    setLoading(false)

    if (err) { setError(err.message); return }

    onJoined(classData)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Join a Class</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex gap-2">
              <span>⚠️</span><span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Class Code</label>
            <input
              value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase()); setError('') }}
              placeholder="e.g. AB3X9Z"
              maxLength={6}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-mono font-semibold tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition placeholder-gray-400 text-center text-lg"
            />
            <p className="text-xs text-gray-400 mt-1.5 text-center">Ask your teacher for the 6-character class code.</p>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl font-semibold text-sm hover:bg-gray-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-primary hover:bg-primary-dark disabled:opacity-60 text-white py-2.5 rounded-xl font-semibold text-sm transition shadow-md flex items-center justify-center gap-2"
            >
              {loading ? <><Loader2 size={15} className="animate-spin" /> Joining...</> : 'Join Class'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default JoinClassModal