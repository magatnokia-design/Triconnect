import { BrowserRouter } from 'react-router-dom'
import { useEffect } from 'react'
import AppRoutes from './routes/AppRoutes'
import { useAuthStore } from './store/authStore'

function App() {
  const initialize = useAuthStore((state) => state.initialize)

  useEffect(() => {
    initialize()
  }, [initialize])

  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}

export default App