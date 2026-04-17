import { useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { createClass } from './classService'
import { useAuthStore } from '../../store/authStore'

function CreateClassModal({ onClose, onCreated }) {
  const { profile } = useAuthStore()
  const [form, setForm] = useState({ name: '', subject: '', section: '', description: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const validateForm = () => {
    const name = form.name.trim()
    const subject = form.subject.trim()
    const section = form.section.trim()
    const description = form.description.trim()

    if (!name) return 'Class name is required.'
    if (name.length < 3) return 'Class name must be at least 3 characters.'
    if (name.length > 120) return 'Class name must be 120 characters or less.'

    if (subject.length > 40) return 'Subject must be 40 characters or less.'
    if (section.length > 40) return 'Section must be 40 characters or less.'
    if (description.length > 600) return 'Description must be 600 characters or less.'

    if (subject && !/^[a-zA-Z0-9 .,_-]+$/.test(subject)) {
      return 'Subject contains unsupported characters.'
    }

    return null
  }

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value })
    setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)
    const { data, error: err } = await createClass({ ...form, teacherId: profile.id })
    setLoading(false)

    if (err) { setError(err.message); return }

    onCreated(data)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Create New Class</h2>
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
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Class Name <span className="text-red-400">*</span>
            </label>
            <input
              name="name"
              value={form.name}
              onChange={handleChange}
              maxLength={120}
              placeholder="e.g. Introduction to Computing"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition placeholder-gray-400"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Subject</label>
              <input
                name="subject"
                value={form.subject}
                onChange={handleChange}
                maxLength={40}
                placeholder="e.g. CS101"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition placeholder-gray-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Section</label>
              <input
                name="section"
                value={form.section}
                onChange={handleChange}
                maxLength={40}
                placeholder="e.g. BSIT 2-A"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition placeholder-gray-400"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
            <textarea
              name="description"
              value={form.description}
              onChange={handleChange}
              maxLength={600}
              placeholder="Optional class description..."
              rows={3}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition placeholder-gray-400 resize-none"
            />
          </div>

          <p className="text-xs text-gray-400">
            A unique class code will be auto-generated for students to join.
          </p>

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
              {loading ? <><Loader2 size={15} className="animate-spin" /> Creating...</> : 'Create Class'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default CreateClassModal