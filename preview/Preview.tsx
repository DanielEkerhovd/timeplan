// Dev-only harness: renders the screens with fake data so they can be screenshotted without Supabase.
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import '../src/index.css'
import { AuthContext } from '../src/lib/auth'
import type { EventWithResponses } from '../src/lib/events'
import type { HoursByDayUser } from '../src/lib/slots'
import type { MyTeam } from '../src/lib/teams'
import type { ActivityType, MemberWithProfile, TeamSlot } from '../src/lib/types'
import type { WeekData } from '../src/lib/useWeekData'
import { daysOfWeek, weekStart } from '../src/lib/week'
import AppShell from '../src/components/AppShell'
import EventForm from '../src/components/EventForm'
import { ToastProvider } from '../src/components/ui'
import PlayersPage from '../src/pages/PlayersPage'
import SettingsPage from '../src/pages/SettingsPage'
import WeekPage from '../src/pages/WeekPage'

const q = new URLSearchParams(location.search)
const screen = q.get('s') ?? 'me'
const role = (q.get('role') ?? 'owner') as MyTeam['role']

const team: MyTeam = { id: 't1', name: 'Playwell Quackers', timezone: 'Europe/Oslo', share_slug: 'abc', share_enabled: true, created_at: '', role }
const names = ['Daniel', 'Sander', 'Mathias', 'Jonas', 'Emil']
const members: MemberWithProfile[] = names.map((n, i) => ({
  team_id: 't1', user_id: `u${i}`, role: i === 0 ? 'owner' : i === 1 ? 'coach' : 'player', position: null, joined_at: '',
  profile: { user_id: `u${i}`, display_name: n, avatar_url: null },
}))
const slots: TeamSlot[] = [
  { id: 's1', team_id: 't1', day_type: 'weekday', start_hour: 18, end_hour: 21, sort: 1 },
  { id: 's2', team_id: 't1', day_type: 'weekday', start_hour: 19, end_hour: 22, sort: 2 },
  { id: 's3', team_id: 't1', day_type: 'weekday', start_hour: 20, end_hour: 23, sort: 3 },
  { id: 's4', team_id: 't1', day_type: 'weekend', start_hour: 13, end_hour: 16, sort: 1 },
  { id: 's5', team_id: 't1', day_type: 'weekend', start_hour: 16, end_hour: 19, sort: 2 },
  { id: 's6', team_id: 't1', day_type: 'weekend', start_hour: 19, end_hour: 22, sort: 3 },
]
const types: ActivityType[] = [
  { id: 'ty1', team_id: 't1', name: 'Scrim', color: 'yellow', ask_opponent: true, default_hours: 3, sort: 1, archived: false },
  { id: 'ty2', team_id: 't1', name: 'Match', color: 'coral', ask_opponent: true, default_hours: 3, sort: 2, archived: false },
  { id: 'ty3', team_id: 't1', name: 'VOD review', color: 'purple', ask_opponent: false, default_hours: 2, sort: 3, archived: false },
]
const monday = weekStart(new Date())
const days = daysOfWeek(monday)
const hours: HoursByDayUser = {}
const set = (d: number, u: number, from: number, to: number) => {
  const byUser = (hours[days[d].key] ??= {})
  const s = (byUser[`u${u}`] ??= new Set<number>())
  for (let h = from; h < to; h++) s.add(h)
}
const answered = q.get('empty') ? [] : [0, 1, 2, 3]
for (const u of answered) {
  set(0, u, 19, 22); set(1, u, 20, 23); set(3, u, 19, 22); set(5, u, 16, 19)
  if (u !== 3) set(2, u, 18, 21)
  if (u < 2) set(4, u, 18, 23)
}
if (!q.get('empty')) { set(0, 4, 19, 22); set(3, 4, 19, 22); set(5, 4, 16, 19); set(1, 4, 20, 23) }
const events: EventWithResponses[] = [
  { id: 'e1', team_id: 't1', date: days[3].key, start_hour: 19, end_hour: 22, type_id: 'ty1', title: null, color: null, opponent: 'Nordic Wolves', note: null, created_by: 'u0', updated_at: '', responses: [0, 1, 2, 3].map((i) => ({ user_id: `u${i}`, status: 'coming' as const })) },
  { id: 'e2', team_id: 't1', date: days[5].key, start_hour: 16, end_hour: 19, type_id: null, title: 'Flex 5v5 night', color: 'blue', opponent: null, note: null, created_by: 'u0', updated_at: '', responses: [1, 2].map((i) => ({ user_id: `u${i}`, status: 'coming' as const })) },
  { id: 'e3', team_id: 't1', date: days[5].key, start_hour: 16, end_hour: 18, type_id: 'ty3', title: null, color: null, opponent: null, note: null, created_by: 'u0', updated_at: '', responses: [] },
]

function useFakeWeek(): WeekData {
  const [h, setHours] = useState(hours)
  const [ev, setEvents] = useState(events)
  const noop = async () => {}
  return {
    monday, days, isCurrentWeek: true, prevWeek: () => {}, nextWeek: () => {}, thisWeek: () => {},
    slots, types, activeTypes: types, members, hours: h, setHours, hoursRef: { current: h }, events: ev, setEvents,
    loaded: true, error: null, setError: () => {}, reload: noop, reloadTeam: noop,
  } as unknown as WeekData
}

function Screen() {
  const week = useFakeWeek()
  const [open, setOpen] = useState(screen === 'form' || screen === 'form-custom')
  const path = screen === 'players' ? '/players' : screen === 'settings' ? '/settings' : '/'
  return (
    <MemoryRouter initialEntries={[`/team/t1${path}${screen === 'team' ? '?view=team' : ''}`]}>
      <Routes>
        <Route
          path="/team/:teamId/*"
          element={
            <ToastProvider>
              <Routes>
                <Route path="/" element={<AppShell team={team} teams={[team]} mobileTitle="Week 37"><WeekPage team={team} week={week} /></AppShell>} />
                <Route path="/players" element={<AppShell team={team} teams={[team]} mobileTitle="Players"><PlayersPage team={team} week={week} onTeamsChanged={async () => {}} /></AppShell>} />
                <Route path="/settings" element={<AppShell team={team} teams={[team]} mobileTitle="Settings"><SettingsPage team={team} week={week} onTeamsChanged={async () => {}} /></AppShell>} />
              </Routes>
              {open && (
                <EventForm teamId="t1" types={types} events={events} existing={null} draft={{ date: days[3].key, start_hour: 19, end_hour: 22 }} onClose={() => setOpen(false)} onSaved={() => setOpen(false)} />
              )}
            </ToastProvider>
          }
        />
      </Routes>
    </MemoryRouter>
  )
}

const user = { id: 'u0', user_metadata: { full_name: 'Daniel', avatar_url: null } }
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthContext.Provider value={{ session: null, user: user as never, loading: false, signInWithDiscord: async () => {}, signOut: async () => {} }}>
      <Screen />
    </AuthContext.Provider>
  </StrictMode>,
)
