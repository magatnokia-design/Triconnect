import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Copy, Check, Users, BookOpen, ClipboardList, Video, Loader2, Trash2, MessageSquare, AlertCircle, RefreshCcw } from 'lucide-react'
import { getClassById, getClassStudents, deleteClass } from './classService'
import { useAuthStore } from '../../store/authStore'
import Logo from '../../shared/components/Logo'
import ModulesTab from './ModulesTab'
import AssignmentsTab from './AssignmentsTab'
import QuizzesTab from './QuizzesTab';
import MeetingsTab from './MeetingsTab'
import ChatTab from './ChatTab'


const TABS = ['Students', 'Modules', 'Assignments', 'Quizzes', 'Meetings', 'Chat']
const MEETINGS_TEMP_DISABLED = true

const TAB_BY_QUERY = {
  students: 'Students',
  modules: 'Modules',
  assignments: 'Assignments',
  quizzes: 'Quizzes',
  meetings: 'Meetings',
  chat: 'Chat',
}

const QUERY_BY_TAB = {
  Students: 'students',
  Modules: 'modules',
  Assignments: 'assignments',
  Quizzes: 'quizzes',
  Meetings: 'meetings',
  Chat: 'chat',
}

function ClassDetailPage() {
  const { id } = useParams()
  const classId = id
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { profile, signOut } = useAuthStore()
  const [classData, setClassData] = useState(null)
  const [students, setStudents] = useState([])
  const [activeTab, setActiveTab] = useState('Students')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [copied, setCopied] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  const loadClassData = async () => {
    setLoading(true)
    setLoadError('')
    const { data, error } = await getClassById(id, profile)
    if (error) {
      setLoadError(error.message || 'Unable to load class details.')
    }
    setClassData(data)
    if (data) {
      const { data: s, error: studentError } = await getClassStudents(id)
      if (studentError) {
        setLoadError(studentError.message || 'Unable to load students for this class.')
      }
      setStudents(s || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadClassData()
  }, [id, profile])

  useEffect(() => {
    const tabQuery = (searchParams.get('tab') || '').toLowerCase()
    const nextTab = TAB_BY_QUERY[tabQuery] || 'Students'
    setActiveTab(nextTab)
  }, [searchParams])

  const handleTabChange = (tab) => {
    setActiveTab(tab)

    const next = new URLSearchParams(searchParams)
    next.set('tab', QUERY_BY_TAB[tab] || 'students')

    if (tab !== 'Chat') {
      next.delete('mode')
      next.delete('studentId')
    }

    setSearchParams(next)
  }

  const copyCode = () => {
    navigator.clipboard.writeText(classData.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDelete = async () => {
    const { error } = await deleteClass(id)
    if (!error) navigate('/dashboard')
  }

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const TAB_ICONS = {
    Students: <Users size={15} />,
    Modules: <BookOpen size={15} />,
    Assignments: <ClipboardList size={15} />,
    Quizzes: <ClipboardList size={15} />,
    Meetings: <Video size={15} />,
    Chat: <MessageSquare size={15} />,
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    )
  }

  if (!classData) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-4">
        <p className="text-gray-500 text-lg">Class not found.</p>
        <button onClick={() => navigate('/dashboard')} className="text-primary font-semibold hover:underline">
          Go to Dashboard
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Navbar */}
      <nav className="bg-white border-b border-gray-100 sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
          <Logo size="sm" />
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600 hidden md:block">
              <strong>{profile?.full_name}</strong>
            </span>
            <button onClick={handleSignOut} className="text-sm text-gray-500 hover:text-primary font-medium transition">
              Sign Out
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-8">

        {/* Back */}
        <button
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2 text-gray-500 hover:text-primary transition mb-6 group text-sm font-medium"
        >
          <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
          Back to Dashboard
        </button>

        {/* Class Header Banner */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-800 rounded-2xl p-6 md:p-8 mb-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-48 h-48 bg-white/5 rounded-full -translate-y-16 translate-x-16" />
          <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/5 rounded-full translate-y-12 -translate-x-12" />
          <div className="relative">
            {classData.subject && (
              <span className="inline-block bg-white/20 text-white text-xs font-semibold px-3 py-1 rounded-full mb-3">
                {classData.subject}
              </span>
            )}
            <h1 className="text-2xl md:text-3xl font-bold text-white mb-1">{classData.name}</h1>
            {classData.section && <p className="text-blue-200 text-sm mb-2">{classData.section}</p>}
            {classData.description && (
              <p className="text-blue-100 text-sm max-w-xl">{classData.description}</p>
            )}

            <div className="flex flex-wrap items-center gap-3 mt-4">
              {/* Class Code */}
              <div className="flex items-center gap-2 bg-white/10 backdrop-blur rounded-xl px-4 py-2">
                <span className="text-white/70 text-xs">Class Code:</span>
                <span className="text-white font-mono font-bold tracking-widest text-sm">{classData.code}</span>
                <button
                  onClick={copyCode}
                  className="text-white/70 hover:text-white transition ml-1"
                  title="Copy code"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>

              <div className="flex items-center gap-2 bg-white/10 backdrop-blur rounded-xl px-4 py-2">
                <Users size={14} className="text-white/70" />
                <span className="text-white text-sm font-semibold">{students.length} students</span>
              </div>
            </div>
          </div>
        </div>

        {loadError && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-sm text-red-700 inline-flex items-center gap-2"><AlertCircle size={16} /> {loadError}</p>
            <button
              onClick={loadClassData}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-300 text-red-700 text-xs font-semibold hover:bg-red-100"
            >
              <RefreshCcw size={13} /> Retry
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="bg-white rounded-2xl shadow-md border border-gray-100 overflow-hidden">
          <div className="flex border-b border-gray-100 overflow-x-auto">
            {TABS.map((tab) => (
              (() => {
                const isTemporarilyDisabled = MEETINGS_TEMP_DISABLED && tab === 'Meetings'
                return (
              <button
                key={tab}
                onClick={() => handleTabChange(tab)}
                className={`flex items-center gap-2 px-5 py-4 text-sm font-semibold whitespace-nowrap transition border-b-2 ${
                  activeTab === tab
                    ? 'border-primary text-primary bg-blue-50/50'
                    : `border-transparent text-gray-500 ${isTemporarilyDisabled ? 'opacity-75' : 'hover:text-gray-700 hover:bg-gray-50'}`
                }`}
              >
                {TAB_ICONS[tab]}
                {isTemporarilyDisabled ? 'Meetings (Coming Soon)' : tab}
              </button>
                )
              })()
            ))}
          </div>

         <div className="p-6">
  {activeTab === 'Students' && (
    <StudentsTab students={students} role={profile?.role} classId={id} />
  )}
  {activeTab === 'Modules' && (
    <ModulesTab classId={id} role={profile?.role} />
  )}
  {activeTab === 'Assignments' && (
    <AssignmentsTab classId={id} role={profile?.role} />
  )}
  {activeTab === 'Quizzes' && <QuizzesTab classId={classId} />}
  {activeTab === 'Meetings' && (
    MEETINGS_TEMP_DISABLED ? <ComingSoon tab="Meetings" /> : <MeetingsTab classId={classId} />
  )}
  {activeTab === 'Chat' && (
    <ChatTab
      classId={classId}
      classData={classData}
      students={students}
      profile={profile}
      initialMode={searchParams.get('mode') || 'group'}
      initialStudentId={searchParams.get('studentId') || ''}
    />
  )}
  {activeTab !== 'Students' && activeTab !== 'Modules' && activeTab !== 'Assignments' && activeTab !== 'Quizzes' && activeTab !== 'Meetings' && activeTab !== 'Chat' && (
    <ComingSoon tab={activeTab} />
  )}
</div>
        </div>

        {/* Danger Zone - Teacher Only */}
        {profile?.role === 'teacher' && (
          <div className="mt-6 bg-white rounded-2xl border border-red-100 shadow-sm p-6">
            <h3 className="text-sm font-bold text-red-600 mb-1">Danger Zone</h3>
            <p className="text-xs text-gray-500 mb-4">Deleting this class is permanent and cannot be undone.</p>
            {!deleteConfirm ? (
              <button
                onClick={() => setDeleteConfirm(true)}
                className="flex items-center gap-2 text-red-500 border border-red-200 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-red-50 transition"
              >
                <Trash2 size={15} />
                Delete Class
              </button>
            ) : (
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-600">Are you sure?</span>
                <button
                  onClick={handleDelete}
                  className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition"
                >
                  Yes, Delete
                </button>
                <button
                  onClick={() => setDeleteConfirm(false)}
                  className="border border-gray-200 text-gray-600 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function StudentsTab({ students, role }) {
  if (students.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="bg-blue-50 p-4 rounded-2xl mb-4">
          <Users size={32} className="text-primary" />
        </div>
        <p className="text-gray-700 font-semibold">No students yet</p>
        <p className="text-gray-400 text-sm mt-1">
          {role === 'teacher' ? 'Share the class code for students to join.' : 'No classmates yet.'}
        </p>
      </div>
    )
  }

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">{students.length} enrolled student{students.length !== 1 ? 's' : ''}</p>
      <div className="grid md:grid-cols-2 gap-3">
        {students.map((enrollment) => (
          <div
            key={enrollment.id}
            className="flex items-center gap-3 p-4 bg-gray-50 rounded-xl border border-gray-100"
          >
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
              {enrollment.profiles?.full_name?.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800 truncate">{enrollment.profiles?.full_name}</p>
              <p className="text-xs text-gray-400 truncate">{enrollment.profiles?.student_id || enrollment.profiles?.email}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ComingSoon({ tab }) {
  const isTemporarilyDisabled = tab === 'Meetings'

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="bg-blue-50 p-4 rounded-2xl mb-4">
        <BookOpen size={32} className="text-primary" />
      </div>
      <p className="text-gray-700 font-semibold">{tab} — Coming Soon</p>
      <p className="text-gray-400 text-sm mt-1">
        {isTemporarilyDisabled
          ? 'This feature is temporarily disabled and will be re-enabled later.'
          : 'This feature is currently being built.'}
      </p>
    </div>
  )
}

export default ClassDetailPage