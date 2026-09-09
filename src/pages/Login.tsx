import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { AvatarStack, Button, DotRow, ErrorText } from '../components/ui'

/**
 * Framsida på gatherapp.gg.
 *
 * Den som lander her vet ikke hva dette er. Så: hva appen gjør, en tegnet uke
 * som viser det på ett blikk, og knappen. Uka er tegnet og ikke et skjermbilde
 * — da følger den lys og mørk modus, og den blir aldri utdatert.
 */
export default function Login() {
  const { user, loading, signInWithDiscord } = useAuth()
  const [error, setError] = useState<string | null>(null)

  if (!loading && user) return <Navigate to="/" replace />

  async function handleLogin() {
    setError(null)
    try {
      await signInWithDiscord()
    } catch {
      setError('Could not reach Discord. Please try again.')
    }
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <div className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col items-center gap-12 px-6 py-14 lg:flex-row lg:items-center lg:gap-16 lg:py-16">
        <div className="flex w-full max-w-[520px] flex-col gap-7">
          {/* Wrap: på de smaleste telefonene faller navnet under merket i stedet
              for å skyve siden bredere enn skjermen. */}
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[20px] bg-ink text-bg shadow-card">
              <Mark />
            </span>
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="text-[30px] font-extrabold tracking-tight">Gatherapp.gg</span>
              <span className="text-[14px] font-semibold text-muted">Planning tool for teams and groups</span>
            </div>
          </div>

          <div className="flex flex-col gap-5">
            <h1 className="text-[34px] font-extrabold leading-[1.1] tracking-tight sm:text-[50px]">When can you play this week?</h1>
            <p className="max-w-[46ch] text-[15px] leading-relaxed text-muted">
              Sick of juggling messages and polls on Discord? Gatherapp.gg keeps track of your group’s availability. Plan activities, like scrims, matches, hangouts or whatever, and share a link to the week on Discord. No signups, no ads, no tracking.
            </p>
            <p className="max-w-[46ch] text-[15px] leading-relaxed text-muted">
              Made for Discord, by people who use Discord. A lot.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <ErrorText>{error}</ErrorText>
            <Button onClick={handleLogin} className="h-[60px] w-full gap-3 text-[16px] sm:w-fit sm:px-9">
              <ChatIcon />
              Sign in with Discord
            </Button>
          </div>
        </div>

        <div className="flex w-full max-w-[520px] flex-col gap-5">
          <WeekPeek />
          {/* Stegene står under bildet: de forklarer det du nettopp så. */}
          <div className="flex flex-col gap-3 px-1">
            <Step n="1" title="Mark your week" body="Tap the blocks you can make. Every tap saves right away." />
            <Step n="2" title="See the overlap" body="The grid counts who can make each block, and points at the ones everybody can." />
            <Step n="3" title="Book it, share it" body="Put a scrim or a match on a block. One link shows the week on Discord as a picture." />
          </div>
        </div>
      </div>

      <footer className="px-6 pb-8 text-center text-[12px] text-faint">Gatherapp.gg · made in Hardanger, Norway</footer>
    </main>
  )
}

/** Ett steg. Nummeret bærer rekkefølgen, så teksten slipper. */
function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-soft text-[12px] font-extrabold text-green-ink">
        {n}
      </span>
      <p className="text-[13px] leading-relaxed text-muted">
        <strong className="font-extrabold text-ink">{title}.</strong> {body}
      </p>
    </div>
  )
}

const peekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
/** Hvor mange på laget som kan ta hver bolk. 5 = alle. */
const peekGrid = [
  [3, 2, 5, 4, 1],
  [4, 3, 4, 4, 2],
  [2, 4, 3, 4, 3],
]
const peekHours = ['18–21', '19–22', '20–23']
/** Fem oppdiktede folk. Avataren lager initialen og fargen selv, fra navnet. */
const peekPeople = ['Daniel', 'Sander', 'Mathias', 'Jonas', 'Emil'].map((n, i) => ({
  user_id: `p${i}`,
  profile: { user_id: `p${i}`, display_name: n, avatar_url: null, discord_name: n, custom_name: false, timezone: null },
}))

/** Uka slik den ser ut inni appen, i miniatyr. Tallene er oppdiktet. */
function WeekPeek() {
  return (
    <div className="flex w-full max-w-[520px] flex-col gap-3 rounded-[22px] bg-surface p-5 shadow-card">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[14px] font-extrabold">Week 37</span>
        <span className="text-xs text-muted">5 of 5 answered</span>
      </div>

      <div className="grid grid-cols-5 gap-1.5">
        {peekDays.map((d) => (
          <span key={d} className="pb-0.5 text-center text-[11px] font-bold text-muted">
            {d}
          </span>
        ))}
        {peekGrid.map((row, r) =>
          row.map((n, c) => {
            const all = n === 5
            return (
              <div
                key={`${r}-${c}`}
                className={`flex flex-col items-center justify-center gap-1 rounded-[10px] border-[1.5px] py-2 ${
                  all ? 'border-green-dim bg-green-soft' : 'border-line-soft bg-bg'
                }`}
              >
                <span className={`text-[10px] font-extrabold tabular-nums ${all ? 'text-green-ink' : 'text-muted'}`}>{peekHours[r]}</span>
                <DotRow can={[0, 1, 2, 3, 4].map((i) => i < n)} dim={!all} />
              </div>
            )
          }),
        )}
      </div>

      <div className="flex items-center gap-2.5 rounded-[12px] bg-green-soft px-3.5 py-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green text-white">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 13l5 5L20 7" />
          </svg>
        </span>
        <span className="text-[13px] font-extrabold text-green-ink">
          Everyone can make Wed 18–21
        </span>
      </div>

      {/* Og så er den booket: samme kortet som står i uka, med de som har sagt ja. */}
      <div
        className="flex items-center gap-3 rounded-[12px] px-3.5 py-3"
        style={{ background: 'var(--act-coral-soft)' }}
      >
        <div className="flex w-9 shrink-0 flex-col items-center leading-none">
          <span className="text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: 'var(--act-coral-sub)' }}>
            Wed
          </span>
          <span className="text-[17px] font-extrabold" style={{ color: 'var(--act-coral-ink)' }}>
            10
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[13px] font-extrabold" style={{ color: 'var(--act-coral-ink)' }}>
            Match <span className="font-bold" style={{ color: 'var(--act-coral-sub)' }}>vs Quack Attack</span>
          </span>
          <span className="text-[11px] font-semibold" style={{ color: 'var(--act-coral-sub)' }}>
            18:00 – 21:00 · all five joined
          </span>
        </div>
        <AvatarStack people={peekPeople} size={26} ring="var(--act-coral-soft)" />
      </div>
    </div>
  )
}

/** Merket. Samme strek som i sidemenyen og på About. */
function Mark() {
  return (
    <svg width="34" height="34" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M44 22a15 15 0 1 0 3 10h-11" />
    </svg>
  )
}

export function ChatIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17H6.5A2.5 2.5 0 0 1 4 14.5z" />
      <circle cx="9" cy="10.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="10.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}
