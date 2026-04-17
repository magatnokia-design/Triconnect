import { useNavigate } from 'react-router-dom'
import { Users, BookOpen, ArrowRight } from 'lucide-react'

const CLASS_GRADIENTS = [
  'from-blue-500 to-blue-700',
  'from-indigo-500 to-indigo-700',
  'from-violet-500 to-violet-700',
  'from-sky-500 to-sky-700',
  'from-cyan-500 to-cyan-700',
  'from-blue-600 to-indigo-700',
]

const getGradient = (id) => {
  const index = id ? id.charCodeAt(0) % CLASS_GRADIENTS.length : 0
  return CLASS_GRADIENTS[index]
}

function ClassCard({ classData, studentCount, role }) {
  const navigate = useNavigate()
  const gradient = getGradient(classData.id)

  return (
    <div
      onClick={() => navigate(`/classes/${classData.id}`)}
      className="bg-white rounded-2xl shadow-md hover:shadow-xl transition-all duration-300 cursor-pointer group overflow-hidden border border-gray-100 hover:-translate-y-1"
    >
      {/* Color Header */}
      <div className={`bg-gradient-to-r ${gradient} p-5 relative overflow-hidden`}>
        <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -translate-y-8 translate-x-8" />
        <div className="absolute bottom-0 left-0 w-16 h-16 bg-white/10 rounded-full translate-y-6 -translate-x-6" />
        <div className="relative">
          <p className="text-white/80 text-xs font-medium uppercase tracking-wider mb-1">
            {classData.subject || 'General'}
          </p>
          <h3 className="text-white font-bold text-lg leading-tight line-clamp-2">{classData.name}</h3>
          {classData.section && (
            <p className="text-white/70 text-sm mt-1">{classData.section}</p>
          )}
        </div>
      </div>

      {/* Card Body */}
      <div className="p-4">
        {classData.description && (
          <p className="text-gray-500 text-sm line-clamp-2 mb-3">{classData.description}</p>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {role === 'teacher' && (
              <div className="flex items-center gap-1.5 text-gray-400 text-xs">
                <Users size={13} />
                <span>{studentCount ?? 0} students</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-gray-400 text-xs">
              <BookOpen size={13} />
              <span className="font-mono font-semibold text-gray-500">{classData.code}</span>
            </div>
          </div>
          <ArrowRight
            size={16}
            className="text-gray-300 group-hover:text-primary group-hover:translate-x-1 transition-all"
          />
        </div>
      </div>
    </div>
  )
}

export default ClassCard