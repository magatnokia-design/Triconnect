import { Routes, Route } from 'react-router-dom'
import LandingPage from '../features/landing/LandingPage'
import LoginPage from '../features/auth/LoginPage'
import SignUpPage from '../features/auth/SignUpPage'
import StudentDashboard from '../features/dashboard/StudentDashboard'
import TeacherDashboard from '../features/dashboard/TeacherDashboard'
import AdminDashboard from '../features/admin/AdminDashboard'
import ClassDetailPage from '../features/classes/ClassDetailPage'
import ProtectedRoute from '../shared/components/ProtectedRoute'
import { useAuthStore } from '../store/authStore'

function AppRoutes() {
  const profile = useAuthStore((state) => state.profile)

  const getDashboard = () => {
    if (profile?.role === 'student') return <StudentDashboard />
    if (profile?.role === 'teacher') return <TeacherDashboard />
    if (profile?.role === 'admin') return <AdminDashboard />
    return <div>Unauthorized</div>
  }

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignUpPage />} />
      <Route path="/dashboard" element={<ProtectedRoute>{getDashboard()}</ProtectedRoute>} />
      <Route path="/admin" element={<ProtectedRoute allowedRoles={['admin']}><AdminDashboard /></ProtectedRoute>} />
      <Route path="/classes/:id" element={<ProtectedRoute><ClassDetailPage /></ProtectedRoute>} />
    </Routes>
  )
}

export default AppRoutes