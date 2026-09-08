import { useCallback, useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { fetchMyTeams, getActiveTeamId, type MyTeam } from './lib/teams'
import { Spinner } from './components/ui'
import Login from './pages/Login'
import NoTeam from './pages/NoTeam'
import TeamPage from './pages/TeamPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/*" element={<Protected />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

/** Everything behind sign-in. Loads your teams once, and again when you create/join/leave one. */
function Protected() {
  const { user, loading } = useAuth()
  const [teams, setTeams] = useState<MyTeam[] | null>(null)

  const reload = useCallback(async () => {
    if (!user) return
    try {
      setTeams(await fetchMyTeams(user.id))
    } catch {
      setTeams([])
    }
  }, [user])

  useEffect(() => {
    if (user) void reload()
  }, [user, reload])

  if (loading) return <Spinner className="min-h-dvh" />
  if (!user) return <Navigate to="/login" replace />
  if (teams === null) return <Spinner className="min-h-dvh" />

  const active = getActiveTeamId()
  const home = teams.length === 0 ? '/new-team' : `/team/${teams.some((t) => t.id === active) ? active : teams[0].id}`

  return (
    <Routes>
      <Route path="/" element={<Navigate to={home} replace />} />
      <Route path="/new-team" element={<NoTeam hasTeams={teams.length > 0} onTeamsChanged={reload} />} />
      <Route path="/team/:teamId/*" element={<TeamPage teams={teams} onTeamsChanged={reload} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
