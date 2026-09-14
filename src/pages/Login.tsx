import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { AvatarStack, Button, DotRow, ErrorText } from '../components/ui'

/**
 * Framsida på gatherapp.gg.
 *
 * Den som lander her vet ikke hva dette er. Så: hva appen gjør, en kortstokk
 * med tre tegnede kort som viser det på ett blikk (uka, botens ukeplan i
 * Discord, en endringsmelding), og knappen. Kortene er tegnet og ikke
 * skjermbilder — da følger de lys og mørk modus, og de blir aldri utdaterte.
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
              Sick of juggling messages and polls on Discord? Gatherapp.gg keeps track of your group’s availability. Plan activities, like scrims, matches, hangouts or whatever. No signups, no ads, no tracking.
            </p>
            <p className="max-w-[46ch] text-[15px] leading-relaxed text-muted">
              Then let the bot do the talking: it posts the week in your server, keeps it up to date, and tells the people it concerns when something is added, moved or cancelled.
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

        <Deck />
      </div>

      <footer className="px-6 pb-8 text-center text-[12px] text-faint">Gatherapp.gg · made in Hardanger, Norway</footer>
    </main>
  )
}

/** The three cards in the deck, with the steps that explain each. */
const CARDS: { key: string; label: string; card: ReactNode; steps: [string, string][] }[] = [
  {
    key: 'week',
    label: 'The week',
    card: <WeekPeek />,
    steps: [
      ['Mark your week', 'Pick your availability for the week.'],
      ['See the overlap', 'The app shows when everyone can make it.'],
      ['Book it', 'Set up the weekplan and share it on Discord. With link or bot.'],
    ],
  },
  {
    key: 'bot',
    label: 'The bot',
    card: <BotPeek />,
    steps: [
      ['Add the bot', 'Connect Gather to your Discord server.'],
      ['Display the weekplan automatically', 'The bot posts and updates the weekplan in a channel of your choice.'],
      ['Join from Discord', 'Answer events from Discord.'],
    ],
  },
  {
    key: 'updates',
    label: 'The update',
    card: <UpdatePeek />,
    steps: [
      ['Notify the right people', 'Bot keeps track of weekplan and updates users directly.'],
      ['Channel or DM', 'Updates can be sent to a channel and/or as a DM to each player.'],
      ['Automatic updates', 'Updates are posted automatically when the weekplan changes.'],
    ],
  },
]

const ROTATE_MS = 6000

/**
 * The cards, stacked like a deck: the active one on top, the others tucked
 * behind. Turns over on its own every few seconds, waits while the pointer is
 * on it, and any card can be picked by hand. Sits still for people who asked
 * for reduced motion.
 */
function Deck() {
  const [i, setI] = useState(0)
  const [hold, setHold] = useState(false)
  const [still, setStill] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setStill(mq.matches)
    const on = () => setStill(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  useEffect(() => {
    if (hold || still) return
    const t = setInterval(() => setI((n) => (n + 1) % CARDS.length), ROTATE_MS)
    return () => clearInterval(t)
  }, [hold, still, i])

  return (
    <div className="flex w-full max-w-[520px] flex-col gap-5" onPointerEnter={() => setHold(true)} onPointerLeave={() => setHold(false)}>
      {/* All three share one grid cell and stretch to the tallest, so the deck
          never changes height. The ones behind peek out up and to the left,
          and only their transform and opacity move: the top card slides into
          place, the old one slips back. */}
      <div className="grid pl-6 pt-6">
        {CARDS.map((c, n) => {
          const behind = (n - i + CARDS.length) % CARDS.length
          return (
            <div
              key={c.key}
              aria-hidden={behind !== 0}
              className={`relative [grid-area:1/1] overflow-hidden rounded-[22px] transition-transform duration-500 ease-out motion-reduce:transition-none ${
                behind === 0 ? 'z-20' : behind === 1 ? 'z-10' : 'z-0'
              }`}
              style={{
                transform: behind === 0 ? 'none' : `translate(-${behind * 12}px, -${behind * 12}px)`,
                pointerEvents: behind === 0 ? 'auto' : 'none',
              }}
            >
              {c.card}
              {/* Cards stay opaque; the ones behind are dimmed by a veil, so a
                  card coming to the front never shows the old one through it. */}
              <div
                className="pointer-events-none absolute inset-0 bg-bg transition-opacity duration-500 ease-out motion-reduce:transition-none"
                style={{ opacity: behind === 0 ? 0 : behind === 1 ? 0.45 : 0.7 }}
              />
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap gap-1.5 px-1" role="tablist" aria-label="What Gather does">
        {CARDS.map((c, n) => (
          <button
            key={c.key}
            type="button"
            role="tab"
            aria-selected={n === i}
            onClick={() => setI(n)}
            className={`h-8 rounded-full px-3.5 text-[12px] font-extrabold transition ${n === i ? 'bg-ink text-on-ink' : 'bg-surface text-muted shadow-card hover:text-ink'}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Stegene står under kortet: de forklarer det du nettopp så. Alle tre
          settene ligger i samme rute, så blokken er like høy uansett kort og
          ingenting under den hopper; bare det aktive settet er synlig. */}
      <div className="grid px-1">
        {CARDS.map((c, n) => (
          <div
            key={c.key}
            aria-hidden={n !== i}
            className={`flex flex-col gap-3 [grid-area:1/1] transition-opacity duration-300 ease-out motion-reduce:transition-none ${n === i ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
          >
            {c.steps.map(([title, body], k) => (
              <Step key={title} n={String(k + 1)} title={title} body={body} />
            ))}
          </div>
        ))}
      </div>
    </div>
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
    <div className="flex h-full w-full max-w-[520px] flex-col gap-3 rounded-[22px] bg-surface p-5 shadow-card">
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
      <div
        className="flex items-center gap-3 rounded-[12px] px-3.5 py-3"
        style={{ background: 'var(--act-yellow-soft)' }}
      >
        <div className="flex w-9 shrink-0 flex-col items-center leading-none">
          <span className="text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: 'var(--act-yellow-sub)' }}>
            Tue
          </span>
          <span className="text-[17px] font-extrabold" style={{ color: 'var(--act-yellow-ink)' }}>
            9
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[13px] font-extrabold" style={{ color: 'var(--act-yellow-ink)' }}>
            Scrim <span className="font-bold" style={{ color: 'var(--act-yellow-sub)' }}>vs Foxes</span>
          </span>
          <span className="text-[11px] font-semibold" style={{ color: 'var(--act-yellow-sub)' }}>
            20:00 – 23:00 · three joined
          </span>
        </div>
        <AvatarStack people={peekPeople.slice(0, 3)} size={26} ring="var(--act-yellow-soft)" />
      </div>
    </div>
  )
}

// --- The bot's cards, drawn the way Discord shows them --------------------------
//
// Discord is dark whatever the page theme, so the chat panel keeps Discord's own
// greys: that is what makes it read as "this is in Discord" at a glance.

const DC = {
  panel: '#313338',
  card: '#2b2d31',
  line: '#3f4147',
  text: '#dbdee1',
  muted: '#949ba4',
  faint: '#6d6f78',
  chip: '#3b3f6b',
  chipText: '#c9cdfb',
  green: '#3e9a63',
  grey: '#4e5058',
  yellow: '#f0cf7e',
  coral: '#f0a58e',
} as const

/** The chat panel: the bot's avatar and name, then whatever the message is. */
function DiscordFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full w-full max-w-[520px] flex-col gap-2.5 rounded-[22px] p-5 shadow-card" style={{ background: DC.panel, color: DC.text }}>
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white" style={{ background: DC.green }}>
          <svg width="18" height="18" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M44 22a15 15 0 1 0 3 10h-11" />
          </svg>
        </span>
        <div className="flex items-center gap-2 leading-none">
          <span className="text-[14px] font-bold text-white">Gather</span>
          <span className="rounded-[4px] px-1.5 py-[3px] text-[9px] font-extrabold uppercase tracking-wide text-white" style={{ background: '#5865f2' }}>
            App
          </span>
          <span className="text-[11px]" style={{ color: DC.muted }}>
            Today at 20:00
          </span>
        </div>
      </div>
      <div className="pl-12">{children}</div>
    </div>
  )
}

/** A Discord card with the coloured bar down the left, like the bot's real ones. */
function DiscordCard({ accent, children }: { accent: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-[8px] border-l-4 px-3.5 py-3" style={{ background: DC.card, borderColor: accent }}>
      {children}
    </div>
  )
}

function DiscordButtons({ yes, dim }: { yes: string; dim?: boolean }) {
  return (
    <div className="flex gap-2 pt-1">
      <span className="rounded-[4px] px-3.5 py-1.5 text-[12px] font-bold text-white" style={{ background: dim ? DC.grey : DC.green }}>
        {yes}
      </span>
      <span className="rounded-[4px] px-3.5 py-1.5 text-[12px] font-bold text-white" style={{ background: DC.grey }}>
        Can’t
      </span>
    </div>
  )
}

const T = ({ t }: { t: string }) => (
  <span className="rounded-[3px] px-1 py-px" style={{ background: DC.line }}>
    {t}
  </span>
)

/** The week plan as the bot posts it: one message, a card per session, Join on each. */
function BotPeek() {
  return (
    <DiscordFrame>
      <div className="flex flex-col gap-2">
        <DiscordCard accent={DC.green}>
          <div className="flex flex-col gap-0.5">
            <span className="text-[15px] font-extrabold text-white">Quack Attack · Week 38</span>
            <span className="text-[12px]" style={{ color: DC.muted }}>
              14 – 20 September · 2 sessions
            </span>
          </div>
        </DiscordCard>
        <DiscordCard accent={DC.yellow}>
          <span className="text-[14px] font-extrabold text-white">Scrim vs Foxes</span>
          <span className="text-[12px]">
            <strong>Tuesday</strong> <T t="20:00" /> – <T t="23:00" />
            <span style={{ color: DC.muted }}> · Daniel, Sander, Mathias</span>
          </span>
          <DiscordButtons yes="Joined" dim />
        </DiscordCard>
        <DiscordCard accent={DC.coral}>
          <span className="text-[14px] font-extrabold text-white">Match vs Quack Attack</span>
          <span className="text-[12px]">
            <strong>Wednesday</strong> <T t="18:00" /> – <T t="21:00" />
            <span style={{ color: DC.muted }}> · all five in</span>
          </span>
          <DiscordButtons yes="Join" />
        </DiscordCard>
        <span className="pl-1 text-[11px]" style={{ color: DC.faint }}>
          📌 Pinned · kept up to date
        </span>
      </div>
    </DiscordFrame>
  )
}

/** A change: the session moved, and the people who had said yes get a ping. */
function UpdatePeek() {
  return (
    <DiscordFrame>
      <div className="flex flex-col gap-2">
        <DiscordCard accent={DC.yellow}>
          <span className="text-[15px] font-extrabold text-white">Moved · Scrim vs Foxes</span>
          <span className="flex flex-wrap gap-1.5">
            {['Daniel', 'Sander', 'Mathias'].map((n) => (
              <span key={n} className="rounded-[3px] px-1 text-[12px] font-semibold" style={{ background: DC.chip, color: DC.chipText }}>
                @{n}
              </span>
            ))}
          </span>
          <span className="text-[12px]">
            <span className="line-through" style={{ color: DC.muted }}>
              Tuesday 20:00 – 23:00
            </span>{' '}
            → <strong>Wednesday</strong> <T t="20:00" /> – <T t="23:00" />
          </span>
          <DiscordButtons yes="Still in" />
        </DiscordCard>
        <DiscordCard accent={DC.green}>
          <span className="text-[15px] font-extrabold text-white">New · VOD review</span>
          <span>
            <span className="rounded-[3px] px-1 text-[12px] font-semibold" style={{ background: DC.chip, color: DC.chipText }}>
              @Quack Attack
            </span>
          </span>
          <span className="text-[12px]">
            <strong>Thursday</strong> <T t="19:00" /> – <T t="20:00" />
          </span>
          <DiscordButtons yes="Join" />
        </DiscordCard>
        <span className="pl-1 text-[11px]" style={{ color: DC.faint }}>
          In the updates channel, as a DM to each player, or both. The team picks.
        </span>
      </div>
    </DiscordFrame>
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
