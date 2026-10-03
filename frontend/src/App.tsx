import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Login from './pages/Login'
import { AUTH_TOKEN_KEY } from './config'

const Dashboard = lazy(() => import('./pages/Dashboard'))

function RequireAuth({ children }: { children: JSX.Element }) {
  const token = localStorage.getItem(AUTH_TOKEN_KEY)
  return token ? children : <Navigate to="/login" replace />
}

function DashboardLoading() {
  return (
    <main
      role="status"
      aria-live="polite"
      style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 16 }}
    >
      正在加载 Qfund…
    </main>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <Suspense fallback={<DashboardLoading />}>
              <Dashboard />
            </Suspense>
          </RequireAuth>
        }
      />
    </Routes>
  )
}
