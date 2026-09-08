import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { isInviteCode, joinTeam, normalizeInviteCode, setActiveTeamId, setPendingInvite } from '../lib/teams'
import { friendlyError } from '../lib/types'
import { Button, Card, ErrorText, Eyebrow, Spinner } from '../components/ui'
import { ChatIcon } from './Login'

/**
 * Invitasjonslenka: /join/<KODE>. Lagnavnet vises først etter innlogging – å slå opp koden
 * uten pålogging ville gitt hvem som helst en måte å teste koder på uten grensa join_team har.
 *
 * Innmeldingen skjer aldri av seg selv fordi noen bare åpnet lenka. Lenker blir limt i åpne
 * kanaler, og da skal det være ditt eget trykk som melder deg inn. Unntaket er runden om
 * Discord: da trykte du «Sign in with Discord» her et øyeblikk før, og det trykket teller.
 */
export default function JoinPage() {
  const { code: raw = '' } = useParams()
  const code = normalizeInviteCode(raw)
  const valid = isInviteCode(code)

  const navigate = useNavigate()
  const { user, loading, signInWithDiscord } = useAuth()

  // ?code= i adressa betyr at Discord nettopp sendte oss tilbake. supabase-js bytter den
  // koden mot en sesjon og fjerner den fra adressa, så vi må lese den ved første render.
  const [returning] = useState(() => new URLSearchParams(window.location.search).has('code'))
  const [waited, setWaited] = useState(false)

  const [error, setError] = useState<string | null>(
    valid ? null : 'That invite link is not valid. Ask the person who sent it for a new one.',
  )
  const [busy, setBusy] = useState(false)
  const attempted = useRef(false)

  // Vekslingen tar et øyeblikk. Uten dette rekker innloggingskortet å blinke forbi på vei
  // tilbake fra Discord, og trykker noen på knappen der, går de en runde til uten grunn.
  useEffect(() => {
    if (!returning) return
    const t = setTimeout(() => setWaited(true), 8000)
    return () => clearTimeout(t)
  }, [returning])

  async function join() {
    if (attempted.current) return
    attempted.current = true
    setBusy(true)
    setError(null)
    try {
      const id = await joinTeam(code)
      if (!id) {
        setError('That code is wrong, expired or used up. Ask the person who sent it.')
        attempted.current = false
        return
      }
      setPendingInvite(null)
      setActiveTeamId(id)
      navigate(`/team/${id}`, { replace: true })
    } catch (err) {
      setError(friendlyError(err))
      attempted.current = false
    } finally {
      setBusy(false)
    }
  }

  // Kom du rett fra Discord, fullfører vi det du alt hadde satt i gang. Egen vakt, så
  // en feilet innmelding ikke prøves om igjen ved neste render.
  const autoRan = useRef(false)
  useEffect(() => {
    if (!valid || !returning || !user || autoRan.current) return
    autoRan.current = true
    void join()
  })

  async function handleLogin() {
    setError(null)
    // Sikkerhetsnett: står ikke /join/... i Supabase sin Redirect URL-liste havner vi på
    // forsiden i stedet, og da plukker /new-team opp koden herfra.
    setPendingInvite(code)
    try {
      await signInWithDiscord(`/join/${code}`)
    } catch {
      setError('Could not reach Discord. Please try again.')
    }
  }

  // Venter på sesjonen, eller på at koden fra Discord blir vekslet inn.
  if (loading || (returning && !user && !waited && !error)) return <Spinner className="min-h-dvh" />

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-5 px-5 pb-10 pt-16">
      <div className="flex flex-col gap-1">
        <Eyebrow>Gather</Eyebrow>
        <h1 className="text-[26px] font-extrabold tracking-tight">You have been invited to a team</h1>
        <p className="text-[15px] leading-relaxed text-muted">
          {user ? 'One tap and you are on the team.' : 'Sign in with Discord and you are on the team – no code to type in.'}
        </p>
      </div>

      <Card className="flex flex-col gap-3">
        {error ? (
          <>
            <ErrorText>{error}</ErrorText>
            <Button variant="secondary" onClick={() => navigate('/new-team')}>
              Enter a code instead
            </Button>
          </>
        ) : busy || (returning && user) ? (
          <>
            <Spinner className="min-h-[60px]" />
            <p className="text-center text-[13px] text-faint">Joining …</p>
          </>
        ) : user ? (
          <>
            <Button onClick={() => void join()} className="h-[52px] w-full">
              Join the team
            </Button>
            <p className="text-center text-[13px] leading-relaxed text-faint">
              You are signed in. Nothing happens until you tap.
            </p>
          </>
        ) : (
          <>
            <Button onClick={() => void handleLogin()} className="h-[52px] w-full">
              <ChatIcon />
              Sign in with Discord
            </Button>
            <p className="text-center text-[13px] leading-relaxed text-faint">
              We only use your name and avatar from Discord. Nothing is posted on your behalf.
            </p>
          </>
        )}
      </Card>
    </main>
  )
}
