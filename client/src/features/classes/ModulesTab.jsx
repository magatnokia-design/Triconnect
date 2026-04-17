import { useEffect, useState, useRef } from 'react'
import {
  Upload, Trash2, FileText, FileImage, File,
  Loader2, Plus, X, Download, BookOpen, AlertCircle, RefreshCcw
} from 'lucide-react'
import { getModules, uploadModule, deleteModule } from './classService'
import { useAuthStore } from '../../store/authStore'

const ACCEPTED = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.mp4,.txt'

const FILE_ICONS = {
  'application/pdf': <FileText size={20} className="text-red-500" />,
  'image/png': <FileImage size={20} className="text-green-500" />,
  'image/jpeg': <FileImage size={20} className="text-green-500" />,
  'image/gif': <FileImage size={20} className="text-green-500" />,
}

const getFileIcon = (type) => FILE_ICONS[type] || <File size={20} className="text-blue-500" />

const formatSize = (bytes) => {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const formatDate = (date) =>
  new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function ModulesTab({ classId, role }) {
  const { profile } = useAuthStore()
  const [modules, setModules] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showUpload, setShowUpload] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const loadModules = async () => {
    setLoading(true)
    setError('')
    const { data, error: loadError } = await getModules(classId)
    if (loadError) {
      setError(loadError.message || 'Unable to load materials right now.')
      setModules([])
    } else {
      setModules(data || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadModules()
  }, [classId])

  const handleUploaded = (newModule) => {
    setModules((prev) => [newModule, ...prev])
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    await deleteModule(deleteTarget.id, deleteTarget.file_url)
    setModules((prev) => prev.filter((m) => m.id !== deleteTarget.id))
    setDeleting(false)
    setDeleteTarget(null)
  }

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((item) => (
          <div key={item} className="rounded-2xl border border-gray-200 bg-white p-4 animate-pulse">
            <div className="h-4 w-2/3 bg-gray-100 rounded mb-4" />
            <div className="h-10 w-10 bg-gray-100 rounded-xl mb-4" />
            <div className="h-3 w-full bg-gray-100 rounded mb-2" />
            <div className="h-3 w-1/2 bg-gray-100 rounded" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-gray-500">
          {modules.length} material{modules.length !== 1 ? 's' : ''} uploaded
        </p>
        {role === 'teacher' && (
          <button
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-2 bg-primary hover:bg-primary-dark text-white px-4 py-2 rounded-xl text-sm font-semibold transition shadow-sm"
          >
            <Plus size={15} /> Upload Material
          </button>
        )}
      </div>

      {/* Empty State */}
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 flex items-center justify-between gap-3">
          <p className="text-sm text-red-700 inline-flex items-center gap-2"><AlertCircle size={16} /> {error}</p>
          <button
            onClick={loadModules}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-300 text-red-700 text-xs font-semibold hover:bg-red-100"
          >
            <RefreshCcw size={13} /> Retry
          </button>
        </div>
      )}

      {/* Empty State */}
      {!error && modules.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="bg-blue-50 p-4 rounded-2xl mb-4">
            <BookOpen size={32} className="text-primary" />
          </div>
          <p className="text-gray-700 font-semibold">No materials yet</p>
          <p className="text-gray-400 text-sm mt-1">
            {role === 'teacher'
              ? 'Upload files for your students to access.'
              : 'Your teacher has not uploaded any materials yet.'}
          </p>
          {role === 'teacher' && (
            <button
              onClick={() => setShowUpload(true)}
              className="mt-4 flex items-center gap-2 bg-primary hover:bg-primary-dark text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition shadow-md"
            >
              <Plus size={15} /> Upload Material
            </button>
          )}
        </div>
      )}

      {/* Modules List */}
      {modules.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((mod) => (
            <div
              key={mod.id}
              className="group overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
            >
              <div className="bg-gradient-to-r from-sky-50 to-blue-50 px-4 py-3 border-b border-blue-100/60">
                <p className="text-sm font-semibold text-gray-800 line-clamp-2">
                  {mod.title}
                </p>
              </div>

              <div className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-gray-50 rounded-xl border border-gray-100 flex items-center justify-center flex-shrink-0 shadow-sm">
                    {getFileIcon(mod.file_type)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-gray-500 truncate">{mod.file_name}</p>
                    {mod.file_size && (
                      <p className="text-xs text-gray-400 mt-0.5">{formatSize(mod.file_size)}</p>
                    )}
                  </div>
                </div>

                {mod.description && (
                  <p className="mt-3 text-sm text-gray-600 line-clamp-2 min-h-[2.5rem]">{mod.description}</p>
                )}

                {!mod.description && <div className="mt-3 min-h-[2.5rem]" />}

                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-600">
                    Posted {formatDate(mod.created_at)}
                  </span>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <a
                      href={mod.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      download
                      className="p-2 text-gray-400 hover:text-primary hover:bg-blue-50 rounded-lg transition"
                      title="Download"
                    >
                      <Download size={16} />
                    </a>
                    {role === 'teacher' && (
                      <button
                        onClick={() => setDeleteTarget(mod)}
                        className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload Modal */}
      {showUpload && (
        <UploadModal
          classId={classId}
          teacherId={profile.id}
          onClose={() => setShowUpload(false)}
          onUploaded={handleUploaded}
        />
      )}

      {/* Delete Confirm Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Delete Material</h3>
            <p className="text-sm text-gray-500 mb-6">
              Are you sure you want to delete <strong>{deleteTarget.title}</strong>? This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl font-semibold text-sm hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white py-2.5 rounded-xl font-semibold text-sm transition flex items-center justify-center gap-2"
              >
                {deleting ? <><Loader2 size={14} className="animate-spin" /> Deleting...</> : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function UploadModal({ classId, teacherId, onClose, onUploaded }) {
  const [form, setForm] = useState({ title: '', description: '' })
  const [file, setFile] = useState(null)
  const [folderFiles, setFolderFiles] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef()
  const folderRef = useRef()

  const handleFile = (f) => {
    if (f.size > 50 * 1024 * 1024) {
      setError('File size must be under 50MB.')
      return
    }
    setFile(f)
    setFolderFiles([])
    setError('')
    if (!form.title) setForm((prev) => ({ ...prev, title: f.name.replace(/\.[^/.]+$/, '') }))
  }

  const handleFolderSelection = (files) => {
    const selected = Array.from(files || [])
    if (selected.length === 0) return

    setFolderFiles(selected)
    setFile(null)
    setError('')

    if (!form.title) {
      const rootPath = selected[0]?.webkitRelativePath || ''
      const rootFolderName = rootPath.split('/')[0] || 'Folder Upload'
      setForm((prev) => ({ ...prev, title: rootFolderName }))
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.title.trim()) { setError('Title is required.'); return }
    if (!file && folderFiles.length === 0) { setError('Please select a file or folder.'); return }

    setLoading(true)
    const { data, error: err } = await uploadModule({
      classId,
      teacherId,
      title: form.title,
      description: form.description,
      file,
      folderFiles,
    })
    setLoading(false)

    if (err) { setError(err.message); return }

    onUploaded(data)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Upload Material</h2>
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

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Title <span className="text-red-400">*</span>
            </label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Chapter 1 - Introduction"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition placeholder-gray-400"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Optional description..."
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition placeholder-gray-400"
            />
          </div>

          {/* File Drop Zone */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              File <span className="text-red-400">*</span>
            </label>
            <div
              onClick={() => fileRef.current.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition ${
                dragOver
                  ? 'border-primary bg-blue-50'
                  : file
                  ? 'border-green-300 bg-green-50'
                  : 'border-gray-200 hover:border-primary hover:bg-blue-50/30'
              }`}
            >
              {file ? (
                <div className="flex items-center justify-center gap-3">
                  {getFileIcon(file.type)}
                  <div className="text-left">
                    <p className="text-sm font-semibold text-gray-700 truncate max-w-[200px]">{file.name}</p>
                    <p className="text-xs text-gray-400">{formatSize(file.size)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setFile(null) }}
                    className="ml-2 text-gray-400 hover:text-red-500 transition"
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : folderFiles.length > 0 ? (
                <div className="flex items-center justify-center gap-3">
                  <File size={20} className="text-blue-500" />
                  <div className="text-left">
                    <p className="text-sm font-semibold text-gray-700 truncate max-w-[220px]">{folderFiles[0].webkitRelativePath.split('/')[0]}</p>
                    <p className="text-xs text-gray-400">{folderFiles.length} file{folderFiles.length !== 1 ? 's' : ''} will be zipped</p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setFolderFiles([]) }}
                    className="ml-2 text-gray-400 hover:text-red-500 transition"
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <>
                  <Upload size={24} className="text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500 font-medium">Drop file here, browse file, or browse folder</p>
                  <p className="text-xs text-gray-400 mt-1">Folder upload is zipped automatically · Max 50MB per file</p>
                </>
              )}
            </div>
            <div className="mt-2 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => fileRef.current.click()}
                className="text-xs font-semibold text-primary hover:underline"
              >
                Browse file
              </button>
              <span className="text-gray-300">|</span>
              <button
                type="button"
                onClick={() => folderRef.current.click()}
                className="text-xs font-semibold text-primary hover:underline"
              >
                Browse folder
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED}
              className="hidden"
              onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])}
            />
            <input
              ref={folderRef}
              type="file"
              className="hidden"
              directory=""
              webkitdirectory=""
              multiple
              onChange={(e) => handleFolderSelection(e.target.files)}
            />
          </div>

          {/* Actions */}
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
              {loading ? <><Loader2 size={15} className="animate-spin" /> Uploading...</> : 'Upload'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default ModulesTab