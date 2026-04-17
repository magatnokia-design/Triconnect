import { useState } from 'react'
import { supabase } from '../../config/supabase'
import { Link, useNavigate } from 'react-router-dom'
import Logo from '../../shared/components/Logo'
import { ArrowLeft, Eye, EyeOff, CheckCircle } from 'lucide-react'
import { getRoleEmailHint, validateRoleBasedAccess } from './authService'

function SignUpPage() {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    fullName: '',
    role: 'student',
    studentId: ''
  })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const navigate = useNavigate()

  const handleChange = (e) => {
    const { name, value } = e.target

    setFormData((prev) => {
      if (name === 'role') {
        return {
          ...prev,
          role: value,
          studentId: value === 'student' ? prev.studentId : ''
        }
      }

      return { ...prev, [name]: value }
    })

    setError('')
  }

  const validate = () => {
    if (!formData.fullName.trim()) return 'Full name is required.'
    const accessCheck = validateRoleBasedAccess({
      email: formData.email,
      role: formData.role,
      studentId: formData.studentId
    })
    if (!accessCheck.ok) return accessCheck.error
    if (formData.password.length < 6)
      return 'Password must be at least 6 characters.'
    if (formData.password !== formData.confirmPassword)
      return 'Passwords do not match.'
    return null
  }

  const handleSignUp = async (e) => {
    e.preventDefault()
    setError('')

    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)

    const accessCheck = validateRoleBasedAccess({
      email: formData.email,
      role: formData.role,
      studentId: formData.studentId
    })

    if (!accessCheck.ok) {
      setLoading(false)
      setError(accessCheck.error)
      return
    }

    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email: accessCheck.normalizedEmail,
        password: formData.password,
        options: {
          data: {
            full_name: formData.fullName.trim(),
            role: formData.role,
            student_id: formData.role === 'student' ? accessCheck.normalizedStudentId : null
          }
        }
      })

      if (signUpError) {
        const lowerMessage = signUpError.message.toLowerCase()

        if (lowerMessage.includes('already registered')) {
          setError('An account with this email already exists. Try logging in.')
          return
        }

        if (signUpError.status === 500 || lowerMessage.includes('database error saving new user')) {
          setError('Signup failed due to account format rules. Student: 1234567890@pampangastateu.edu.ph (email username must match Student ID). Teacher: juandm@pampangastateu.edu.ph (letters only).')
          return
        }

        setError(signUpError.message)
        return
      }

      setSuccess(true)
    } catch (requestError) {
      setError(requestError?.message || 'Unexpected error while creating account.')
    } finally {
      setLoading(false)
    }
  }

  // Success screen
  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-xl border border-blue-50 p-10 w-full max-w-md text-center">
          <CheckCircle className="text-green-500 mx-auto mb-4" size={52} />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Check your email</h2>
          <p className="text-gray-500 text-sm mb-6">
            We sent a verification link to <span className="font-semibold text-gray-700">{formData.email}</span>.
            Please verify your account before logging in.
          </p>
          <button
            onClick={() => navigate('/login')}
            className="w-full bg-primary hover:bg-primary-dark text-white py-2.5 rounded-xl font-semibold text-sm transition shadow-md"
          >
            Go to Login
          </button>
        </div>
      </div>
    )
  }

  const passwordStrength = () => {
    const p = formData.password
    if (!p) return null
    if (p.length < 6) return { label: 'Too short', color: 'bg-red-400', width: 'w-1/4' }
    if (p.length < 8) return { label: 'Weak', color: 'bg-orange-400', width: 'w-2/4' }
    if (p.length < 12) return { label: 'Good', color: 'bg-yellow-400', width: 'w-3/4' }
    return { label: 'Strong', color: 'bg-green-500', width: 'w-full' }
  }

  const strength = passwordStrength()

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">

        {/* Back Button */}
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-gray-500 hover:text-primary transition mb-6 group"
        >
          <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" />
          <span className="text-sm font-medium">Back to Home</span>
        </button>

        <div className="bg-white rounded-2xl shadow-xl border border-blue-50 p-8">

          {/* Header */}
          <div className="flex flex-col items-center mb-8">
            <Logo size="md" />
            <h1 className="text-2xl font-bold text-gray-900 mt-4">Create account</h1>
            <p className="text-sm text-gray-500 mt-1">Join TriConnect with your PSU email</p>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-6 text-sm">
              <span className="mt-0.5">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSignUp} className="space-y-4">

            {/* Full Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Full Name</label>
              <input
                type="text"
                name="fullName"
                value={formData.fullName}
                onChange={handleChange}
                placeholder="Juan Dela Cruz"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition placeholder-gray-400"
                required
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">PSU Email</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder={
                  formData.role === 'student'
                    ? '1234567890@pampangastateu.edu.ph'
                    : 'juandm@pampangastateu.edu.ph'
                }
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition placeholder-gray-400"
                required
              />
              <p className="text-xs text-gray-400 mt-1">{getRoleEmailHint(formData.role)}</p>
            </div>

            {/* Role */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Role</label>
              <select
                name="role"
                value={formData.role}
                onChange={handleChange}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition text-gray-700"
              >
                <option value="student">Student</option>
                <option value="teacher">Teacher</option>
              </select>
            </div>

            {/* Student ID */}
            {formData.role === 'student' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Student ID</label>
                <input
                  type="text"
                  name="studentId"
                  value={formData.studentId}
                  onChange={handleChange}
                  placeholder="1234567890"
                  inputMode="numeric"
                  pattern="[0-9]+"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition placeholder-gray-400"
                  required
                />
              </div>
            )}

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="••••••••"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition placeholder-gray-400"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              {/* Password strength bar */}
              {strength && (
                <div className="mt-2">
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${strength.color} ${strength.width}`} />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{strength.label}</p>
                </div>
              )}
            </div>

            {/* Confirm Password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirm Password</label>
              <div className="relative">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  placeholder="••••••••"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition placeholder-gray-400"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
                >
                  {showConfirm ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              {/* Match indicator */}
              {formData.confirmPassword && (
                <p className={`text-xs mt-1 ${formData.password === formData.confirmPassword ? 'text-green-500' : 'text-red-400'}`}>
                  {formData.password === formData.confirmPassword ? '✓ Passwords match' : '✗ Passwords do not match'}
                </p>
              )}
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary hover:bg-primary-dark disabled:opacity-60 disabled:cursor-not-allowed text-white py-2.5 rounded-xl font-semibold text-sm transition shadow-md hover:shadow-lg mt-1"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Creating Account...
                </span>
              ) : 'Create Account'}
            </button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-6">
            Already have an account?{' '}
            <Link to="/login" className="text-primary font-semibold hover:underline">
              Login
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

export default SignUpPage