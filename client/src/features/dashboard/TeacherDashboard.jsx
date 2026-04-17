import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, BookOpen, Users, ClipboardList, Loader2, GraduationCap } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { getTeacherAssignmentCount, getTeacherClasses } from '../classes/classService'
import ClassCard from '../classes/ClassCard'
import CreateClassModal from '../classes/CreateClassModal'
import Logo from '../../shared/components/Logo'
import { supabase } from '../../config/supabase'
import NotificationBell from '../notifications/NotificationBell'

function TeacherDashboard() {
  const { profile, signOut } = useAuthStore()
  const navigate = useNavigate()
  const [classes, setClasses] = useState([])
  const [assignmentCount, setAssignmentCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const [{ data }, assignmentStats] = await Promise.all([
        getTeacherClasses(profile.id),
        getTeacherAssignmentCount(profile.id),
      ])
      setClasses(data || [])
      setAssignmentCount(assignmentStats?.count || 0)
      setLoading(false)
    }

    if (!profile?.id) return

    load()

    const channel = supabase
      .channel(`teacher-dashboard-${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'classes', filter: `teacher_id=eq.${profile.id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assignments', filter: `teacher_id=eq.${profile.id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'class_enrollments' }, load)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [profile?.id])

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const totalStudents = classes.reduce((sum, c) => {
    const count = c.class_enrollments?.[0]?.count ?? 0
    return sum + Number(count)
  }, 0)

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Navbar */}
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
            <button
              onClick={handleSignOut}
              className="text-sm text-gray-500 hover:text-primary font-medium transition"
            >
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
              <p className="text-blue-200 text-sm mt-1">Manage your classes and track student progress.</p>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 bg-white text-primary font-semibold px-5 py-2.5 rounded-xl shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all text-sm self-start md:self-auto"
            >
              <Plus size={18} />
              Create Class
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
          {[
            { label: 'Total Classes', value: classes.length, icon: <BookOpen size={20} />, color: 'text-blue-600 bg-blue-50' },
            { label: 'Total Students', value: totalStudents, icon: <Users size={20} />, color: 'text-indigo-600 bg-indigo-50' },
            { label: 'Assignments', value: assignmentCount, icon: <ClipboardList size={20} />, color: 'text-violet-600 bg-violet-50' },
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

        {/* Classes Section */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-gray-900">My Classes</h2>
          {classes.length > 0 && (
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 text-primary text-sm font-semibold hover:underline"
            >
              <Plus size={15} /> New Class
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin text-primary" size={28} />
          </div>
        ) : classes.length === 0 ? (
          <EmptyState role="teacher" onAction={() => setShowCreate(true)} />
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {classes.map((cls) => (
              <ClassCard
                key={cls.id}
                classData={cls}
                studentCount={cls.class_enrollments?.[0]?.count ?? 0}
                role="teacher"
              />
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateClassModal
          onClose={() => setShowCreate(false)}
          onCreated={(newClass) => setClasses((prev) => [newClass, ...prev])}
        />
      )}
    </div>
  )
}

function EmptyState({ role, onAction }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="bg-blue-50 p-5 rounded-2xl mb-4">
        <GraduationCap size={40} className="text-primary" />
      </div>
      <p className="text-gray-700 font-bold text-lg">No classes yet</p>
      <p className="text-gray-400 text-sm mt-1 mb-6">Create your first class to get started.</p>
      <button
        onClick={onAction}
        className="flex items-center gap-2 bg-primary hover:bg-primary-dark text-white px-6 py-2.5 rounded-xl font-semibold text-sm transition shadow-md"
      >
        <Plus size={16} /> Create Class
      </button>
    </div>
  )
}

export default TeacherDashboard