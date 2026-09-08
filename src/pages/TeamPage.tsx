import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { setActiveTeamId, type MyTeam } from '../lib/teams'
import { canEdit, roleLabel, type Member, type Profile } from '../lib/types'
import { Avatar, Card, Eyebrow, Spinner } from '../components/ui'
import WeekView from '../components/WeekView'

interface MemberWithProfile extends Member {
  profile: Profile | null
}

/**
 * Lagsiden: ukevisningen (steg 2) og medlemslista. Ledervisningen (steg 3) kommer her også.
 */
export default function TeamPage({ teams }: { teams: MyTeam[] }) {
  const { teamId } = useParams()
  const navigate = useNavigate()
  const { user, signOut } = useAuth()

  const team = teams.find((t) => t.id === teamId)

  const [members, setMembers] = useState<MemberWithProfile[] | null>(null)

  useEffect(() => {
    if (!team) return
    setActiveTeamId(team.id)
    setMembers(null)
    let cancelled = false
    supabase
      .from('members')
      .select('*, profile:profiles(*)')
      .eq('team_id', team.id)
      .then(({ data }) => {
        if (cancelled) return
        const rows = (data ?? []) as unknown as MemberWithProfile[]
        rows.sort((a, b) => (a.profile?.display_name ?? '').localeCompare(b.profile?.display_name ?? ''))
        setMembers(rows)
      })
    return () => {
      cancelled = true
    }
  }, [team])

  // Laget finnes ikke for deg (fjernet, slettet, eller feil id): tilbake til lagvelgeren.
  if (!team) return <Navigate to="/" replace />

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-5 px-5 pb-10 pt-12">
      <header className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <Eyebrow>{roleLabel[team.role]}</Eyebrow>
          <h1 className="text-[26px] font-extrabold tracking-tight">{team.name}</h1>
        </div>
        <Avatar
          name={(user?.user_metadata?.full_name as string | undefined) ?? 'You'}
          url={user?.user_metadata?.avatar_url as string | undefined}
        />
      </header>

      {teams.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {teams.map((t) => (
            <button
              key={t.id}
              onClick={() => navigate(`/team/${t.id}`)}
              className={`h-9 rounded-full px-4 text-[13px] font-bold ${
                t.id === team.id ? 'bg-ink text-white' : 'bg-surface text-muted shadow-card hover:text-ink'
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      {user && members !== null && <WeekView team={team} userId={user.id} members={members} />}

      <Card className="flex flex-col gap-3">
        <h2 className="text-[15px] font-extrabold">Members</h2>
        {members === null ? (
          <Spinner />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {members.map((m) => (
              <li key={m.user_id} className="flex items-center gap-3">
                <Avatar name={m.profile?.display_name ?? '?'} url={m.profile?.avatar_url} size={32} />
                <div className="flex flex-col">
                  <span className="text-sm font-bold">{m.profile?.display_name ?? 'Unknown'}</span>
                  <span className="text-xs text-muted">
                    {roleLabel[m.role]}
                    {m.user_id === user?.id ? ' · you' : ''}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        {canEdit(team.role) && (
          <p className="text-[13px] leading-relaxed text-faint">
            As {roleLabel[team.role].toLowerCase()} you can invite with a code and edit the schedule. The settings page
            arrives in step 5.
          </p>
        )}
      </Card>

      <div className="flex justify-center gap-4 pt-2 text-sm font-semibold text-muted">
        <button onClick={() => navigate('/new-team')} className="hover:text-ink">
          New team / use a code
        </button>
        <button onClick={() => signOut()} className="hover:text-ink">
          Sign out
        </button>
      </div>
    </main>
  )
}
