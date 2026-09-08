import { useEffect } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { setActiveTeamId, type MyTeam } from '../lib/teams'
import { canEdit } from '../lib/types'
import { useWeekData } from '../lib/useWeekData'
import { weekId } from '../lib/week'
import AppShell from '../components/AppShell'
import { ToastProvider } from '../components/ui'
import PlayersPage from './PlayersPage'
import SettingsPage from './SettingsPage'
import WeekPage from './WeekPage'

interface Props {
  teams: MyTeam[]
  onTeamsChanged: () => Promise<void>
}

/** One team: the app frame plus the Week / Players / Settings pages. */
export default function TeamPage({ teams, onTeamsChanged }: Props) {
  const { teamId } = useParams()
  const team = teams.find((t) => t.id === teamId)
  // The team is not yours (removed, deleted, or a wrong id): back to the team picker.
  if (!team) return <Navigate to="/" replace />
  return <TeamContent key={team.id} team={team} teams={teams} onTeamsChanged={onTeamsChanged} />
}

function TeamContent({ team, teams, onTeamsChanged }: { team: MyTeam } & Props) {
  const week = useWeekData(team.id)

  useEffect(() => {
    setActiveTeamId(team.id)
  }, [team.id])

  return (
    <ToastProvider>
      <Routes>
        <Route
          path="/"
          element={
            <AppShell team={team} teams={teams} mobileTitle={`Week ${weekId(week.monday).slice(-2).replace(/^0/, '')}`}>
              <WeekPage team={team} week={week} />
            </AppShell>
          }
        />
        <Route
          path="/players"
          element={
            <AppShell team={team} teams={teams} mobileTitle="Players">
              <PlayersPage team={team} week={week} onTeamsChanged={onTeamsChanged} />
            </AppShell>
          }
        />
        <Route
          path="/settings"
          element={
            canEdit(team.role) ? (
              <AppShell team={team} teams={teams} mobileTitle="Settings">
                <SettingsPage team={team} week={week} onTeamsChanged={onTeamsChanged} />
              </AppShell>
            ) : (
              <Navigate to={`/team/${team.id}`} replace />
            )
          }
        />
        <Route path="*" element={<Navigate to={`/team/${team.id}`} replace />} />
      </Routes>
    </ToastProvider>
  )
}

