import { Link } from 'react-router-dom'
import { useState } from 'react'
import Logo from '../../shared/components/Logo'

function LandingPage() {
  const [hoveredCard, setHoveredCard] = useState(null)

  const features = [
    {
      icon: (
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      ),
      title: "Interactive Learning",
      description: "Access modules, quizzes, and assignments in one unified platform",
      color: "from-blue-500 to-blue-600"
    },
    {
      icon: (
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      ),
      title: "Live Virtual Meetings",
      description: "Attend classes online with video conferencing and screen sharing",
      color: "from-indigo-500 to-indigo-600"
    },
    {
      icon: (
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      ),
      title: "Track Your Progress",
      description: "View grades, rankings, and performance analytics in real-time",
      color: "from-purple-500 to-purple-600"
    }
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 overflow-hidden">
      {/* Animated Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-72 h-72 bg-blue-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob"></div>
        <div className="absolute top-40 right-10 w-72 h-72 bg-indigo-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-2000"></div>
      </div>

      {/* Header */}
      {/* Header */}
<nav className="relative container mx-auto px-6 py-6 flex justify-between items-center">
  <div className="transform hover:scale-105 transition-transform duration-300">
    <Logo size="sm" />
  </div>
  <div className="flex gap-3">
    <Link 
      to="/login" 
      className="text-primary hover:text-primary-dark font-semibold px-6 py-2.5 rounded-xl transition-all duration-300 hover:bg-blue-50"
    >
      Login
    </Link>
    <Link 
      to="/signup" 
      className="bg-gradient-to-r from-primary to-primary-dark text-white px-6 py-2.5 rounded-xl hover:shadow-xl transition-all duration-300 transform hover:-translate-y-0.5 font-semibold"
    >
      Sign Up
    </Link>
  </div>
</nav>

      {/* Hero Section */}
      <div className="relative container mx-auto px-6 py-20 text-center">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-6xl md:text-7xl font-extrabold text-gray-900 mb-6 leading-tight animate-fade-in-down">
            Welcome to <br/>
            <span className="bg-gradient-to-r from-primary via-blue-500 to-indigo-600 bg-clip-text text-transparent">
              TriConnect
            </span>
          </h1>
          <p className="text-xl md:text-2xl text-gray-600 mb-12 animate-fade-in-up font-light">
            Modern learning management system for<br/>
            <span className="font-semibold text-primary">Pampanga State University</span>
          </p>

          {/* Features Grid */}
          <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {features.map((feature, index) => (
              <div
                key={index}
                onMouseEnter={() => setHoveredCard(index)}
                onMouseLeave={() => setHoveredCard(null)}
                className={`bg-white/80 backdrop-blur-sm p-8 rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-500 transform hover:-translate-y-3 cursor-pointer ${
                  hoveredCard === index ? 'scale-105' : ''
                }`}
              >
                <div 
                  className={`w-20 h-20 bg-gradient-to-br ${feature.color} rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg transform transition-transform duration-500 ${
                    hoveredCard === index ? 'rotate-12 scale-110' : ''
                  }`}
                >
                  <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {feature.icon}
                  </svg>
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-3">{feature.title}</h3>
                <p className="text-gray-600 leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="relative mt-32 py-8 border-t border-gray-200">
        <div className="container mx-auto px-6 text-center text-gray-600">
          <p className="font-medium">&copy; 2024 TriConnect - Pampanga State University</p>
        </div>
      </footer>

      <style>{`
        @keyframes blob {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(30px, -50px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.9); }
        }
        .animate-blob {
          animation: blob 7s infinite;
        }
        .animation-delay-2000 {
          animation-delay: 2s;
        }
        @keyframes fade-in-down {
          from {
            opacity: 0;
            transform: translateY(-20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes fade-in-up {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in-down {
          animation: fade-in-down 0.8s ease-out;
        }
        .animate-fade-in-up {
          animation: fade-in-up 0.8s ease-out 0.2s both;
        }
      `}</style>
    </div>
  )
}

export default LandingPage