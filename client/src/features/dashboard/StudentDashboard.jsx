import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, BookOpen, ClipboardList, Trophy, Loader2, GraduationCap, ChevronLeft, ChevronRight } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { getStudentClasses, getStudentAssignmentCount, getStudentLeaderboardRank, getStudentClassProgress } from '../classes/classService'
import ClassCard from '../classes/ClassCard'
import JoinClassModal from '../classes/JoinClassModal'
import Logo from '../../shared/components/Logo'
import { supabase } from '../../config/supabase'
import NotificationBell from '../notifications/NotificationBell'

function StudentDashboard() {
  const { profile, signOut } = useAuthStore()
  const navigate = useNavigate()
  const [enrollments, setEnrollments] = useState([])
  const [assignmentCount, setAssignmentCount] = useState(0)
  const [leaderboardRank, setLeaderboardRank] = useState('—')
  const [classProgress, setClassProgress] = useState([])
  const [selectedProgressClassId, setSelectedProgressClassId] = useState('')
  const [loading, setLoading] = useState(true)
  const [showJoin, setShowJoin] = useState(false)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const [{ data }, { count }, leaderboard, progress] = await Promise.all([
        getStudentClasses(profile.id),
        getStudentAssignmentCount(profile.id),
        getStudentLeaderboardRank(profile.id),
        getStudentClassProgress(profile.id),
      ])

      setEnrollments(data || [])
      setAssignmentCount(count)
      setClassProgress(progress?.data || [])
      if (leaderboard?.rank) {
        setLeaderboardRank(`#${leaderboard.rank}`)
      } else {
        setLeaderboardRank('—')
      }
      setLoading(false)
    }

    if (!profile?.id) return

    load()

    const channel = supabase
      .channel(`student-dashboard-${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'class_enrollments' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assignments' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assignment_submissions' }, load)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [profile?.id])

  useEffect(() => {
    if (!classProgress.length) {
      setSelectedProgressClassId('')
      return
    }

    const stillExists = classProgress.some((item) => item.classId === selectedProgressClassId)
    if (!selectedProgressClassId || !stillExists) {
      setSelectedProgressClassId(classProgress[0].classId)
    }
  }, [classProgress, selectedProgressClassId])

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const selectedProgress = classProgress.find((item) => item.classId === selectedProgressClassId) || classProgress[0] || null
  const selectedProgressIndex = classProgress.findIndex((item) => item.classId === selectedProgress?.classId)

  const selectPreviousProgress = () => {
    if (!classProgress.length || selectedProgressIndex <= 0) return
    setSelectedProgressClassId(classProgress[selectedProgressIndex - 1].classId)
  }

  const selectNextProgress = () => {
    if (!classProgress.length || selectedProgressIndex < 0 || selectedProgressIndex >= classProgress.length - 1) return
    setSelectedProgressClassId(classProgress[selectedProgressIndex + 1].classId)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-100 sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
          <Logo size="sm" />
          <div className="flex items-center gap-4">
            <NotificationBell userId={profile?.id} />
            <div className="hidden md:flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center text-white text-sm font-bold">
                {profile?.full_name?.charAt(0).toUpperCase()}
              </div>
              <span className="text-sm text-gray-700 font-medium">{profile?.full_name}</span>
            </div>
            <button onClick={handleSignOut} className="text-sm text-gray-500 hover:text-primary font-medium transition">
              Sign Out
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Welcome Banner */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-800 rounded-2xl p-6 md:p-8 mb-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-56 h-56 bg-white/5 rounded-full -translate-y-20 translate-x-20" />
          <div className="absolute bottom-0 left-0 w-36 h-36 bg-white/5 rounded-full translate-y-14 -translate-x-14" />
          <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p className="text-blue-200 text-sm font-medium mb-1">Welcome back 👋</p>
              <h1 className="text-2xl md:text-3xl font-bold text-white">{profile?.full_name}</h1>
              <p className="text-blue-200 text-sm mt-1">
                {profile?.student_id && <span className="font-mono">ID: {profile.student_id} · </span>}
                Stay on top of your classes and assignments.
              </p>
            </div>
            <button
              onClick={() => setShowJoin(true)}
              className="flex items-center gap-2 bg-white text-primary font-semibold px-5 py-2.5 rounded-xl shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all text-sm self-start md:self-auto"
            >
              <Plus size={18} /> Join Class
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
          {[
            { label: 'Enrolled Classes', value: enrollments.length, icon: <BookOpen size={20} />, color: 'text-blue-600 bg-blue-50' },
            { label: 'Assignments', value: assignmentCount, icon: <ClipboardList size={20} />, color: 'text-indigo-600 bg-indigo-50' },
            { label: 'Leaderboard Rank', value: leaderboardRank, icon: <Trophy size={20} />, color: 'text-violet-600 bg-violet-50' },
          ].map((stat) => (
            <div key={stat.label} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${stat.color}`}>
                {stat.icon}
              </div>
              <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
              <p className="text-sm text-gray-500 mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Progress */}
        {classProgress.length > 0 && selectedProgress && (
          <div className="bg-white rounded-2xl p-5 md:p-6 shadow-sm border border-gray-100 mb-8">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Progress by Class</h2>
                <p className="text-xs text-gray-500">Quick-switch view for all your subjects</p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={selectPreviousProgress}
                  disabled={selectedProgressIndex <= 0}
                  className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                  aria-label="Previous class progress"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-xs text-gray-500 min-w-[60px] text-center">
                  {selectedProgressIndex + 1} / {classProgress.length}
                </span>
                <button
                  onClick={selectNextProgress}
                  disabled={selectedProgressIndex >= classProgress.length - 1}
                  className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                  aria-label="Next class progress"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
              {classProgress.map((item) => (
                <button
                  key={item.classId}
                  onClick={() => setSelectedProgressClassId(item.classId)}
                  className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                    selectedProgress.classId === item.classId
                      ? 'border-primary bg-blue-50 text-primary'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {item.subject || item.className}
                </button>
              ))}
            </div>

            <div className="rounded-xl border border-gray-100 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{selectedProgress.className}</p>
                  <p className="text-xs text-gray-500">{selectedProgress.subject || 'General'}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-primary">{selectedProgress.completionPct}% complete</p>
                  <p className="text-xs text-gray-500">{selectedProgress.submittedAssignments}/{selectedProgress.totalAssignments} submitted</p>
                </div>
              </div>

              <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${selectedProgress.completionPct}%` }} />
              </div>

              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2">
                  <p className="text-gray-500">Pending</p>
                  <p className="font-semibold text-gray-800 mt-0.5">{selectedProgress.pendingAssignments}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2">
                  <p className="text-gray-500">Quiz Avg</p>
                  <p className="font-semibold text-gray-800 mt-0.5">{selectedProgress.quizAverage === null ? 'No quiz' : `${selectedProgress.quizAverage}%`}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2">
                  <p className="text-gray-500">Quizzes Taken</p>
                  <p className="font-semibold text-gray-800 mt-0.5">{selectedProgress.quizzesTaken}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2">
                  <p className="text-gray-500">Assignments</p>
                  <p className="font-semibold text-gray-800 mt-0.5">{selectedProgress.totalAssignments}</p>
                </div>
              </div>
            </div>

            {classProgress.length > 6 && (
              <p className="text-xs text-gray-400 mt-3">
                Tip: Swipe the class chips to quickly jump across all subjects.
              </p>
            )}
          </div>
        )}

        {/* Classes */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-gray-900">My Classes</h2>
          {enrollments.length > 0 && (
            <button onClick={() => setShowJoin(true)} className="flex items-center gap-1.5 text-primary text-sm font-semibold hover:underline">
              <Plus size={15} /> Join Class
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin text-primary" size={28} />
          </div>
        ) : enrollments.length === 0 ? (
          <EmptyState onAction={() => setShowJoin(true)} />
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {enrollments.map((enrollment) => (
              <ClassCard key={enrollment.id} classData={enrollment.classes} role="student" />
            ))}
          </div>
        )}
      </div>

      {showJoin && (
        <JoinClassModal
          onClose={() => setShowJoin(false)}
          onJoined={(classData) => {
            setEnrollments((prev) => [...prev, { id: Date.now(), classes: classData }])
          }}
        />
      )}
    </div>
  )
}

function EmptyState({ onAction }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="bg-blue-50 p-5 rounded-2xl mb-4">
        <GraduationCap size={40} className="text-primary" />
      </div>
      <p className="text-gray-700 font-bold text-lg">No classes yet</p>
      <p className="text-gray-400 text-sm mt-1 mb-6">Join a class using the code from your teacher.</p>
      <button
        onClick={onAction}
        className="flex items-center gap-2 bg-primary hover:bg-primary-dark text-white px-6 py-2.5 rounded-xl font-semibold text-sm transition shadow-md"
      >
        <Plus size={16} /> Join Class
      </button>
    </div>
  )
}

export default StudentDashboard