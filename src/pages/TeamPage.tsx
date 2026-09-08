import { useEffect } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { setTimezone } from '../lib/settings'
import { setActiveTeamId, type MyTeam } from '../lib/teams'
import { localZone } from '../lib/timezone'
import { ZoneProvider } from '../lib/zone'
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
  const { user } = useAuth()
  const profile = week.members?.find((m) => m.user_id === user?.id)?.profile ?? null

  useEffect(() => {
    setActiveTeamId(team.id)
  }, [team.id])

  // Første gang: vi vet ikke sonen din, så vi tar den maskinen står i. Du kan endre den i profilen,
  // og da rører vi den aldri igjen. Feiler den, går appen videre som før.
  useEffect(() => {
    if (!user || !profile || profile.timezone) return
    const zone = localZone()
    if (!zone) return
    void setTimezone(user.id, zone)
      .then(week.reloadTeam)
      .catch(() => {})
  }, [user, profile, week.reloadTeam])

  return (
    <ZoneProvider teamZone={team.timezone} yourZone={profile?.timezone} at={week.monday}>
      <ToastProvider>
        <Routes>
          <Route
            path="/"
            element={
              <AppShell
                team={team}
                teams={teams}
                profile={profile}
                onProfileChanged={week.reloadTeam}
                mobileTitle={`Week ${weekId(week.monday).slice(-2).replace(/^0/, '')}`}
              >
                <WeekPage team={team} week={week} />
              </AppShell>
            }
          />
          <Route
            path="/players"
            element={
              <AppShell team={team} teams={teams} profile={profile} onProfileChanged={week.reloadTeam} mobileTitle="Players">
                <PlayersPage team={team} week={week} onTeamsChanged={onTeamsChanged} />
              </AppShell>
            }
          />
          <Route
            path="/settings"
            element={
              canEdit(team.role) ? (
                <AppShell team={team} teams={teams} profile={profile} onProfileChanged={week.reloadTeam} mobileTitle="Settings">
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
    </ZoneProvider>
  )
}
