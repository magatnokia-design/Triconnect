import { useEffect, useState, useRef } from 'react'
import {
  Plus, Loader2, ClipboardList, X, Trash2,
  Download, FileText, ChevronDown, ChevronUp,
  CheckCircle, Clock, AlertCircle, CalendarDays, Award,
  ChevronLeft, ChevronRight
} from 'lucide-react'
import {
  getAssignments, createAssignment, deleteAssignment,
  submitAssignment, getSubmissions, getMySubmission, gradeSubmission, publishAssignmentNow
} from './classService'
import { useAuthStore } from '../../store/authStore'

const formatDate = (date) => {
  if (!date) return 'No due date'
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

const getDueStatus = (dueDate) => {
  if (!dueDate) return null
  const now = new Date()
  const due = new Date(dueDate)
  const diff = due - now
  if (diff < 0) return 'overdue'
  if (diff < 86400000) return 'due-soon'
  return 'upcoming'
}

function AssignmentsTab({ classId, role }) {
  const { profile } = useAuthStore()
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const { data } = await getAssignments(classId, { role })
      setAssignments(data || [])
      setLoading(false)
    }
    load()
  }, [classId, role])

  const handleCreated = (assignment) => {
    setAssignments((prev) => [assignment, ...prev])
  }

  const handleDeleted = (id) => {
    setAssignments((prev) => prev.filter((a) => a.id !== id))
  }

  const handleUpdated = (updatedAssignment) => {
    setAssignments((prev) => prev.map((item) => (item.id === updatedAssignment.id ? updatedAssignment : item)))
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="animate-spin text-primary" size={28} />
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-gray-500">
          {assignments.length} assignment{assignments.length !== 1 ? 's' : ''}
        </p>
        {role === 'teacher' && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-primary hover:bg-primary-dark text-white px-4 py-2 rounded-xl text-sm font-semibold transition shadow-sm"
          >
            <Plus size={15} /> Create Assignment
          </button>
        )}
      </div>

      {/* Empty State */}
      {assignments.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="bg-blue-50 p-4 rounded-2xl mb-4">
            <ClipboardList size={32} className="text-primary" />
          </div>
          <p className="text-gray-700 font-semibold">No assignments yet</p>
          <p className="text-gray-400 text-sm mt-1">
            {role === 'teacher'
              ? 'Create an assignment for your students.'
              : 'No assignments have been posted yet.'}
          </p>
          {role === 'teacher' && (
            <button
              onClick={() => setShowCreate(true)}
              className="mt-4 flex items-center gap-2 bg-primary hover:bg-primary-dark text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition shadow-md"
            >
              <Plus size={15} /> Create Assignment
            </button>
          )}
        </div>
      )}

      {/* Assignment List */}
      {assignments.length > 0 && (
        <div className="space-y-3">
          {assignments.map((assignment) => (
            <AssignmentCard
              key={assignment.id}
              assignment={assignment}
              role={role}
              profile={profile}
              expanded={expanded === assignment.id}
              onToggle={() => setExpanded((prev) => prev === assignment.id ? null : assignment.id)}
              onDeleted={handleDeleted}
              onUpdated={handleUpdated}
            />
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <CreateAssignmentModal
          classId={classId}
          teacherId={profile.id}
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}

function AssignmentCard({ assignment, role, profile, expanded, onToggle, onDeleted, onUpdated }) {
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [submissions, setSubmissions] = useState([])
  const [mySubmission, setMySubmission] = useState(null)
  const [loadingSub, setLoadingSub] = useState(false)
  const [gradingId, setGradingId] = useState(null)
  const [gradeForm, setGradeForm] = useState({ score: '', feedback: '' })
  const [gradeDrafts, setGradeDrafts] = useState({})
  const [gradingError, setGradingError] = useState('')

  const draftStorageKey = `assignment-grade-drafts-${assignment.id}`

  const status = getDueStatus(assignment.due_date)

  const statusBadge = {
    overdue: { label: 'Overdue', class: 'bg-red-50 text-red-600 border-red-100', icon: <AlertCircle size={12} /> },
    'due-soon': { label: 'Due Soon', class: 'bg-orange-50 text-orange-600 border-orange-100', icon: <Clock size={12} /> },
    upcoming: { label: 'Upcoming', class: 'bg-green-50 text-green-600 border-green-100', icon: <Clock size={12} /> },
  }

  useEffect(() => {
    if (!expanded) return
    const load = async () => {
      setLoadingSub(true)
      if (role === 'teacher') {
        const { data } = await getSubmissions(assignment.id)
        setSubmissions(data || [])
      } else {
        const { data } = await getMySubmission(assignment.id, profile.id)
        setMySubmission(data || null)
      }
      setLoadingSub(false)
    }
    load()
  }, [expanded])

  useEffect(() => {
    if (!expanded || role !== 'teacher') return
    try {
      const raw = window.localStorage.getItem(draftStorageKey)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        setGradeDrafts(parsed)
      }
    } catch {
      setGradeDrafts({})
    }
  }, [expanded, role, draftStorageKey])

  const handleDelete = async () => {
    setDeleting(true)
    await deleteAssignment(assignment.id)
    onDeleted(assignment.id)
  }

  const handlePublishNow = async () => {
    setPublishing(true)
    const { data, error } = await publishAssignmentNow(assignment.id)
    setPublishing(false)
    if (error || !data) return
    onUpdated(data)
  }

  const persistDrafts = (nextDrafts) => {
    setGradeDrafts(nextDrafts)
    try {
      if (Object.keys(nextDrafts).length === 0) {
        window.localStorage.removeItem(draftStorageKey)
      } else {
        window.localStorage.setItem(draftStorageKey, JSON.stringify(nextDrafts))
      }
    } catch {
      // Ignore localStorage failures and keep in-memory drafts.
    }
  }

  const loadDraftForSubmission = (submissionId, fallbackSubmission = null) => {
    const draft = gradeDrafts[submissionId]
    if (draft) {
      setGradeForm({
        score: draft.score ?? '',
        feedback: draft.feedback ?? '',
      })
      return
    }

    const fromRow = fallbackSubmission || submissions.find((item) => item.id === submissionId)
    setGradeForm({
      score: fromRow?.score ?? '',
      feedback: fromRow?.feedback ?? '',
    })
  }

  const openGrading = (submissionId, fallbackSubmission = null) => {
    setGradingId(submissionId)
    setGradingError('')
    loadDraftForSubmission(submissionId, fallbackSubmission)
  }

  const updateGradeForm = (patch) => {
    if (!gradingId) return
    const next = { ...gradeForm, ...patch }
    setGradeForm(next)

    const nextDrafts = {
      ...gradeDrafts,
      [gradingId]: {
        score: next.score,
        feedback: next.feedback,
      },
    }
    persistDrafts(nextDrafts)
  }

  const clearDraft = (submissionId) => {
    const nextDrafts = { ...gradeDrafts }
    delete nextDrafts[submissionId]
    persistDrafts(nextDrafts)
  }

  const handleGrade = async (submissionId) => {
    setGradingError('')
    const score = parseInt(gradeForm.score)
    if (isNaN(score) || score < 0 || score > assignment.max_points) {
      setGradingError(`Score must be between 0 and ${assignment.max_points}.`)
      return
    }

    const { error } = await gradeSubmission(submissionId, { score, feedback: gradeForm.feedback })
    if (error) {
      setGradingError(error.message || 'Failed to save grade.')
      return
    }

    setSubmissions((prev) =>
      prev.map((s) => s.id === submissionId ? { ...s, score, feedback: gradeForm.feedback } : s)
    )
    clearDraft(submissionId)
    setGradeForm({ score: '', feedback: '' })

    const currentIndex = submissions.findIndex((item) => item.id === submissionId)
    const nextSubmission = currentIndex >= 0 ? submissions[currentIndex + 1] : null
    if (nextSubmission) {
      openGrading(nextSubmission.id, nextSubmission)
    } else {
      setGradingId(null)
    }
  }

  const gradingIndex = submissions.findIndex((item) => item.id === gradingId)
  const activeSubmission = gradingIndex >= 0 ? submissions[gradingIndex] : null

  const openPreviousSubmission = () => {
    if (gradingIndex <= 0) return
    const prevSubmission = submissions[gradingIndex - 1]
    openGrading(prevSubmission.id, prevSubmission)
  }

  const openNextSubmission = () => {
    if (gradingIndex < 0 || gradingIndex >= submissions.length - 1) return
    const nextSubmission = submissions[gradingIndex + 1]
    openGrading(nextSubmission.id, nextSubmission)
  }

  const applyQuickScore = (pct) => {
    const computed = Math.round((Number(assignment.max_points || 0) * pct) / 100)
    updateGradeForm({ score: String(computed) })
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden transition hover:border-blue-200">
      {/* Card Header */}
      <div
        className="cursor-pointer transition hover:bg-blue-50/20"
        onClick={onToggle}
      >
        <div className="bg-gradient-to-r from-sky-50 to-blue-50 border-b border-blue-100/60 px-4 py-3">
          <div className="flex items-center justify-end gap-3">
            {role === 'teacher' && (
              <span className={`flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${
                assignment.status === 'draft'
                  ? 'bg-gray-50 text-gray-600 border-gray-200'
                  : assignment.status === 'scheduled'
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-100'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-100'
              }`}>
                {assignment.status === 'draft' ? 'Draft' : assignment.status === 'scheduled' ? 'Scheduled' : 'Published'}
              </span>
            )}
            {status && statusBadge[status] && (
              <span className={`flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${statusBadge[status].class}`}>
                {statusBadge[status].icon} {statusBadge[status].label}
              </span>
            )}
          </div>

          <div className="mt-2 flex items-start gap-3">
            <div className="w-10 h-10 bg-white rounded-xl border border-blue-100 flex items-center justify-center flex-shrink-0 shadow-sm">
              <ClipboardList size={18} className="text-primary" />
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-800 line-clamp-2">{assignment.title}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600">
                  <CalendarDays size={12} /> {formatDate(assignment.due_date)}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600">
                  <Award size={12} /> {assignment.max_points} pts
                </span>
              </div>
            </div>

            <div className="pt-1">
              {expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
            </div>
          </div>
        </div>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="p-4 bg-white">
          {/* Description */}
          {assignment.description && (
            <div className="mb-4 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Instructions</p>
              <p className="text-sm text-gray-600">{assignment.description}</p>
            </div>
          )}

          {role === 'teacher' && assignment.status === 'scheduled' && assignment.publish_at && (
            <div className="mb-4 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700 mb-1">Scheduled Post</p>
              <p className="text-sm text-indigo-700">This assignment is set to post on {formatDate(assignment.publish_at)}.</p>
            </div>
          )}

          {loadingSub ? (
            <div className="flex justify-center py-6">
              <Loader2 className="animate-spin text-primary" size={20} />
            </div>
          ) : (
            <>
              {/* TEACHER VIEW */}
              {role === 'teacher' && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                    Submissions ({submissions.length})
                  </p>
                  {submissions.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">No submissions yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {submissions.map((sub) => (
                        <div key={sub.id} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                                {sub.profiles?.full_name?.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-gray-700 truncate">{sub.profiles?.full_name}</p>
                                <p className="text-xs text-gray-400">{formatDate(sub.submitted_at)}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {sub.score !== null && sub.score !== undefined ? (
                                <span className="text-xs font-bold text-green-600 bg-green-50 border border-green-100 px-2 py-1 rounded-lg">
                                  {sub.score}/{assignment.max_points}
                                </span>
                              ) : (
                                <span className="text-xs text-gray-400">Not graded</span>
                              )}
                              {sub.file_url && (
                                <a href={sub.file_url} target="_blank" rel="noopener noreferrer"
                                  className="p-1.5 text-gray-400 hover:text-primary hover:bg-blue-50 rounded-lg transition">
                                  <Download size={14} />
                                </a>
                              )}
                              <button
                                onClick={() => {
                                  openGrading(sub.id, sub)
                                }}
                                className="text-xs text-primary font-semibold hover:underline"
                              >
                                Grade
                              </button>
                            </div>
                          </div>

                          {/* Text submission */}
                          {sub.text_content && (
                            <p className="text-xs text-gray-500 mt-2 bg-white p-2 rounded-lg border border-gray-100">
                              {sub.text_content}
                            </p>
                          )}

                          {/* Grade Form */}
                          {gradingId === sub.id && <div className="mt-3 pt-3 border-t border-gray-100" />}
                        </div>
                      ))}
                    </div>
                  )}

                  {activeSubmission && (
                    <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/50 p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Grading Workspace</p>
                          <p className="text-sm text-gray-700">
                            {activeSubmission.profiles?.full_name || 'Student'} ({gradingIndex + 1} of {submissions.length})
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={openPreviousSubmission}
                            disabled={gradingIndex <= 0}
                            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 disabled:opacity-50"
                          >
                            <ChevronLeft size={13} /> Prev
                          </button>
                          <button
                            onClick={openNextSubmission}
                            disabled={gradingIndex >= submissions.length - 1}
                            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 disabled:opacity-50"
                          >
                            Next <ChevronRight size={13} />
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {[100, 90, 80, 70].map((pct) => (
                          <button
                            key={pct}
                            onClick={() => applyQuickScore(pct)}
                            className="rounded-md border border-blue-200 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                          >
                            {pct}%
                          </button>
                        ))}
                      </div>

                      <div className="flex gap-2">
                        <input
                          type="number"
                          min={0}
                          max={assignment.max_points}
                          value={gradeForm.score}
                          onChange={(e) => updateGradeForm({ score: e.target.value })}
                          placeholder={`Score / ${assignment.max_points}`}
                          className="w-32 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                        <input
                          value={gradeForm.feedback}
                          onChange={(e) => updateGradeForm({ feedback: e.target.value })}
                          placeholder="Feedback (saved as draft while typing)"
                          className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>

                      {gradingError && (
                        <p className="text-xs text-red-600">{gradingError}</p>
                      )}

                      <div className="flex gap-2">
                        <button
                          onClick={() => handleGrade(activeSubmission.id)}
                          className="bg-primary text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-primary-dark transition"
                        >
                          Save Grade
                        </button>
                        <button
                          onClick={() => {
                            setGradingId(null)
                            setGradingError('')
                          }}
                          className="border border-gray-200 text-gray-500 px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-gray-50 transition"
                        >
                          Close
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Delete */}
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    {(assignment.status === 'draft' || assignment.status === 'scheduled') && (
                      <button
                        onClick={handlePublishNow}
                        disabled={publishing}
                        className="mb-3 inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                      >
                        {publishing ? <><Loader2 size={13} className="animate-spin" /> Publishing...</> : 'Post Now'}
                      </button>
                    )}
                    {!deleteConfirm ? (
                      <button
                        onClick={() => setDeleteConfirm(true)}
                        className="flex items-center gap-1.5 text-red-500 text-xs font-semibold hover:underline"
                      >
                        <Trash2 size={13} /> Delete Assignment
                      </button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">Are you sure?</span>
                        <button
                          onClick={handleDelete}
                          disabled={deleting}
                          className="bg-red-500 text-white px-3 py-1 rounded-lg text-xs font-semibold hover:bg-red-600 transition"
                        >
                          {deleting ? 'Deleting...' : 'Yes, Delete'}
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(false)}
                          className="border border-gray-200 text-gray-500 px-3 py-1 rounded-lg text-xs font-semibold hover:bg-gray-50 transition"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {role === 'student' && (
                <StudentSubmission
                  assignment={assignment}
                  studentId={profile.id}
                  mySubmission={mySubmission}
                  onSubmitted={(submission) => setMySubmission(submission)}
                />
              )}

              {/* Assignment attachment */}
              {assignment.file_url && (
                <a
                  href={assignment.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-primary text-sm font-semibold hover:bg-blue-100/60 transition"
                >
                  <FileText size={15} /> {assignment.file_name || 'View Attachment'}
                </a>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function StudentSubmission({ assignment, studentId, mySubmission, onSubmitted }) {
  const [text, setText] = useState(mySubmission?.text_content || '')
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef()

  const isOverdue = assignment.due_date && new Date(assignment.due_date) < new Date()

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!text.trim() && !file) { setError('Please add text or attach a file.'); return }
    setError('')
    setLoading(true)
    const { data, error: err } = await submitAssignment({
      assignmentId: assignment.id,
      studentId,
      textContent: text,
      file,
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    onSubmitted(data)
  }

  if (mySubmission) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-green-600 bg-green-50 border border-green-100 px-4 py-3 rounded-xl">
          <CheckCircle size={16} />
          <span className="text-sm font-semibold">Submitted on {formatDate(mySubmission.submitted_at)}</span>
        </div>

        {mySubmission.text_content && (
          <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
            <p className="text-xs text-gray-400 mb-1">Your answer:</p>
            <p className="text-sm text-gray-700">{mySubmission.text_content}</p>
          </div>
        )}

        {mySubmission.file_url && (
          <a
            href={mySubmission.file_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-primary text-sm font-semibold hover:underline"
          >
            <FileText size={15} /> {mySubmission.file_name || 'View File'}
          </a>
        )}

        {mySubmission.score !== null && mySubmission.score !== undefined && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
            <p className="text-xs text-gray-500 mb-1">Grade</p>
            <p className="text-lg font-bold text-primary">
              {mySubmission.score} / {assignment.max_points}
            </p>
            {mySubmission.feedback && (
              <p className="text-sm text-gray-600 mt-1">{mySubmission.feedback}</p>
            )}
          </div>
        )}

        {(mySubmission.score === null || mySubmission.score === undefined) && (
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
            <p className="text-xs text-amber-700 font-semibold">Awaiting grade</p>
            <p className="text-sm text-amber-700 mt-1">Your submission is in. Your teacher has not graded it yet.</p>
          </div>
        )}

        {mySubmission.feedback && (mySubmission.score === null || mySubmission.score === undefined) && (
          <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3">
            <p className="text-xs text-indigo-700 font-semibold">Teacher feedback</p>
            <p className="text-sm text-indigo-700 mt-1">{mySubmission.feedback}</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {isOverdue && (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-100 px-4 py-3 rounded-xl text-sm">
          <AlertCircle size={15} /> This assignment is past due.
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">Your Answer</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type your answer here..."
          rows={4}
          className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none placeholder-gray-400"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">Attach File (optional)</label>
        <div
          onClick={() => fileRef.current.click()}
          className="border-2 border-dashed border-gray-200 rounded-xl p-4 text-center cursor-pointer hover:border-primary hover:bg-blue-50/30 transition"
        >
          {file ? (
            <div className="flex items-center justify-center gap-2">
              <FileText size={16} className="text-primary" />
              <span className="text-sm text-gray-700">{file.name}</span>
              <button type="button" onClick={(e) => { e.stopPropagation(); setFile(null) }}
                className="text-gray-400 hover:text-red-500 transition">
                <X size={14} />
              </button>
            </div>
          ) : (
            <p className="text-sm text-gray-400">Click to attach a file</p>
          )}
        </div>
        <input ref={fileRef} type="file" className="hidden"
          onChange={(e) => e.target.files[0] && setFile(e.target.files[0])} />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-primary hover:bg-primary-dark disabled:opacity-60 text-white py-2.5 rounded-xl font-semibold text-sm transition shadow-md flex items-center justify-center gap-2"
      >
        {loading ? <><Loader2 size={15} className="animate-spin" /> Submitting...</> : 'Submit Assignment'}
      </button>
    </form>
  )
}

function CreateAssignmentModal({ classId, teacherId, onClose, onCreated }) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    maxPoints: '100',
    dueDate: '',
    publishMode: 'publish_now',
    publishAt: '',
  })
  const [file, setFile] = useState(null)
  const [folderFiles, setFolderFiles] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef()
  const folderRef = useRef()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.title.trim()) { setError('Title is required.'); return }
    if (form.publishMode === 'schedule' && !form.publishAt) {
      setError('Please choose when to post this assignment.')
      return
    }

    if (form.publishMode === 'schedule' && new Date(form.publishAt) <= new Date()) {
      setError('Scheduled post time must be in the future.')
      return
    }

    setLoading(true)
    const { data, error: err } = await createAssignment({
      classId, teacherId,
      title: form.title,
      description: form.description,
      maxPoints: parseInt(form.maxPoints) || 100,
      dueDate: form.dueDate || null,
      file,
      folderFiles,
      publishMode: form.publishMode,
      publishAt: form.publishMode === 'schedule' && form.publishAt ? new Date(form.publishAt).toISOString() : null,
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    onCreated(data)
    onClose()
  }

  const handleFolderSelection = (files) => {
    const selected = Array.from(files || [])
    if (selected.length === 0) return
    setFolderFiles(selected)
    setFile(null)
    if (!form.title) {
      const rootPath = selected[0]?.webkitRelativePath || ''
      const rootFolderName = rootPath.split('/')[0] || 'Folder Upload'
      setForm((prev) => ({ ...prev, title: rootFolderName }))
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Create Assignment</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex gap-2">
              <span>⚠️</span><span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Title <span className="text-red-400">*</span>
            </label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Lab Report 1"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition placeholder-gray-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Description / Instructions</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Instructions for students..."
              rows={3}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition placeholder-gray-400 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Max Points</label>
              <input
                type="number"
                min={1}
                value={form.maxPoints}
                onChange={(e) => setForm({ ...form, maxPoints: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Due Date</label>
              <input
                type="datetime-local"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Posting</label>
              <select
                value={form.publishMode}
                onChange={(e) => setForm({ ...form, publishMode: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition"
              >
                <option value="publish_now">Post now</option>
                <option value="schedule">Schedule</option>
                <option value="draft">Save draft</option>
              </select>
            </div>

            {form.publishMode === 'schedule' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Post On</label>
                <input
                  type="datetime-local"
                  value={form.publishAt}
                  onChange={(e) => setForm({ ...form, publishAt: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition"
                />
              </div>
            )}
          </div>

          {/* File Upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Attachment <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <div
              onClick={() => fileRef.current.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                const f = e.dataTransfer.files[0]
                if (f) setFile(f)
              }}
              className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition ${
                dragOver ? 'border-primary bg-blue-50'
                : (file || folderFiles.length > 0) ? 'border-green-300 bg-green-50'
                : 'border-gray-200 hover:border-primary hover:bg-blue-50/30'
              }`}
            >
              {file ? (
                <div className="flex items-center justify-center gap-2">
                  <FileText size={16} className="text-primary" />
                  <span className="text-sm text-gray-700 truncate max-w-[200px]">{file.name}</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setFile(null) }}
                    className="text-gray-400 hover:text-red-500 transition"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : folderFiles.length > 0 ? (
                <div className="flex items-center justify-center gap-2">
                  <FileText size={16} className="text-primary" />
                  <span className="text-sm text-gray-700 truncate max-w-[220px]">{folderFiles[0].webkitRelativePath.split('/')[0]} ({folderFiles.length} files)</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setFolderFiles([]) }}
                    className="text-gray-400 hover:text-red-500 transition"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <Download size={20} className="text-gray-300 mx-auto mb-1" />
                  <p className="text-sm text-gray-400">Drop file or click to browse</p>
                  <p className="text-xs text-gray-300 mt-0.5">You can also pick a folder (it will be zipped)</p>
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
              accept=".pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg"
              className="hidden"
              onChange={(e) => {
                if (!e.target.files[0]) return
                setFile(e.target.files[0])
                setFolderFiles([])
              }}
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

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl font-semibold text-sm hover:bg-gray-50 transition">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 bg-primary hover:bg-primary-dark disabled:opacity-60 text-white py-2.5 rounded-xl font-semibold text-sm transition shadow-md flex items-center justify-center gap-2">
              {loading
                ? <><Loader2 size={15} className="animate-spin" /> Saving...</>
                : (form.publishMode === 'draft' ? 'Save Draft' : form.publishMode === 'schedule' ? 'Schedule' : 'Post Assignment')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default AssignmentsTab