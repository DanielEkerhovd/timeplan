import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { createTeam, joinTeam, setActiveTeamId, takePendingInvite } from '../lib/teams'
import { friendlyError } from '../lib/types'
import { Button, Card, ErrorText, Eyebrow, Input } from '../components/ui'

/** Vises når brukeren er innlogget, men ikke med på noe lag (eller vil lage/bli med i et nytt). */
interface Props {
  hasTeams?: boolean
  /** Kalles etter at et lag er laget eller du har blitt med, så lista over lag hentes på nytt. */
  onTeamsChanged: () => Promise<void>
}

export default function NoTeam({ hasTeams = false, onTeamsChanged }: Props) {
  const navigate = useNavigate()
  const { signOut } = useAuth()

  const [teamName, setTeamName] = useState('')
  // Kom du hit via en invitasjonslenke, men OAuth sendte deg til forsiden i stedet for
  // /join/<kode>, ligger koden igjen her. Da er den ferdig utfylt og du trykker bare Join.
  const [code, setCode] = useState(() => takePendingInvite() ?? '')
  const [busy, setBusy] = useState<'create' | 'join' | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [joinError, setJoinError] = useState<string | null>(null)

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setCreateError(null)
    const name = teamName.trim()
    if (name.length < 2) {
      setCreateError('The team name needs at least 2 characters.')
      return
    }
    setBusy('create')
    try {
      const id = await createTeam(name)
      setActiveTeamId(id)
      await onTeamsChanged()
      navigate(`/team/${id}`, { replace: true })
    } catch (err) {
      setCreateError(friendlyError(err))
    } finally {
      setBusy(null)
    }
  }

  async function handleJoin(e: FormEvent) {
    e.preventDefault()
    setJoinError(null)
    if (code.trim().length < 6) {
      setJoinError('Enter the full code.')
      return
    }
    setBusy('join')
    try {
      const id = await joinTeam(code)
      if (!id) {
        setJoinError('That code is wrong, expired or used up. Ask the person who sent it.')
        return
      }
      setActiveTeamId(id)
      await onTeamsChanged()
      navigate(`/team/${id}`, { replace: true })
    } catch (err) {
      setJoinError(friendlyError(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-5 px-5 pb-10 pt-16">
      <div className="flex flex-col gap-1">
        <Eyebrow>Team Schedule</Eyebrow>
        <h1 className="text-[26px] font-extrabold tracking-tight">
          {hasTeams ? 'New team' : 'You are not on a team yet'}
        </h1>
        <p className="text-[15px] leading-relaxed text-muted">
          Got an invite code from your team? Enter it below. Otherwise, create a new team and invite the others.
        </p>
      </div>

      <Card>
        <form onSubmit={handleJoin} className="flex flex-col gap-3">
          <h2 className="text-[15px] font-extrabold">Join a team</h2>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Invite code, e.g. K7XM2Q9TB4WZ"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={16}
            className="font-mono tracking-[0.12em]"
          />
          <ErrorText>{joinError}</ErrorText>
          <Button type="submit" disabled={busy !== null}>
            {busy === 'join' ? 'Checking …' : 'Join'}
          </Button>
        </form>
      </Card>

      <Card>
        <form onSubmit={handleCreate} className="flex flex-col gap-3">
          <h2 className="text-[15px] font-extrabold">Create a new team</h2>
          <Input
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="Team name"
            maxLength={40}
          />
          <ErrorText>{createError}</ErrorText>
          <Button type="submit" variant="secondary" disabled={busy !== null}>
            {busy === 'create' ? 'Creating …' : 'Create team'}
          </Button>
          <p className="text-[13px] leading-relaxed text-faint">You become the owner and can invite others with a code.</p>
        </form>
      </Card>

      <div className="flex justify-center gap-4 pt-2 text-sm font-semibold text-muted">
        {hasTeams && (
          <button onClick={() => navigate('/')} className="hover:text-ink">
            Back
          </button>
        )}
        <button onClick={() => signOut()} className="hover:text-ink">
          Sign out
        </button>
      </div>
    </main>
  )
}
