import { useEffect, useState } from 'react'
import { refreshDiscordName, setDisplayName, setDmOptOut } from '../lib/settings'
import { DiscordApiError, sendMyDmTest } from '../lib/discord'
import { friendlyError, type Profile } from '../lib/types'
import { Avatar, Button, CloseButton, ErrorText, Input, Label, Modal, Toggle, useToast } from './ui'

interface Props {
  profile: Profile | null
  avatarUrl?: string | null
  onClose: () => void
  onSaved: () => Promise<void>
}

/**
 * Your profile: the name everyone sees, in every team. Picture comes from Discord.
 * Sonen din står i menyen ved navnet ditt, sammen med tema — den lagrer med en gang,
 * og hører ikke hjemme bak en Lagre-knapp her.
 */
export default function ProfileModal({ profile, avatarUrl, onClose, onSaved }: Props) {
  const [name, setName] = useState(profile?.display_name ?? '')
  // Navnet Discord kjenner deg som nå. Det vi har lagret kan være fra forrige
  // innlogging, så vi spør på nytt når dialogen åpnes.
  const [discord, setDiscord] = useState(profile?.discord_name ?? null)
  const [busy, setBusy] = useState(false)
  const [dmOff, setDmOff] = useState(profile?.dm_opt_out ?? false)
  const [dmTest, setDmTest] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  // Discord-navnet, men bare når det faktisk er et annet navn enn det du heter nå.
  const stored = discord ?? profile?.discord_name ?? null
  const other = stored && stored !== profile?.display_name ? stored : null

  useEffect(() => {
    let cancelled = false
    refreshDiscordName()
      .then((n) => {
        if (!cancelled && n) setDiscord(n)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  async function save(value: string | null) {
    setBusy(true)
    setError(null)
    try {
      // Hent navnet på nytt først, så «bruk Discord-navnet» gir deg det du
      // heter nå og ikke det du het sist du logget inn. Feiler det — for eksempel
      // fordi basen ikke har fått 0015 ennå — er det ikke verdt å stoppe for:
      // da får du navnet vi har lagret fra før, som er det gamle svaret.
      if (value === null) await refreshDiscordName().catch(() => null)
      await setDisplayName(value)
      await onSaved()
      toast(value ? 'Name updated' : `Back to ${discord ?? 'your Discord name'}`)
      onClose()
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} width={400}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) void save(name)
        }}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <Avatar name={profile?.display_name ?? '?'} url={avatarUrl ?? profile?.avatar_url} size={44} />
            <div className="flex flex-col">
              <h2 className="text-lg font-extrabold">Your profile</h2>
              <span className="text-[13px] text-muted">Shown in every team you are on.</span>
            </div>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus placeholder="Your name" />
          {/* Å gå tilbake til Discord-navnet hører til feltet, ikke til knappraden
              nederst: det er en ting du gjør med navnet, ikke med dialogen. */}
          <span className="text-xs text-muted">
            {!profile?.custom_name ? (
              'This is your Discord name. Change it here if you want something else.'
            ) : !other ? (
              // Eget navn, men det er det samme som Discord sier. Da er det
              // ingenting å gå tilbake til, og lenka ville ikke gjort noe.
              'Your own name.'
            ) : (
              <>
                Your own name. Discord calls you {other}.{' '}
                <button
                  type="button"
                  onClick={() => void save(null)}
                  disabled={busy}
                  className="font-bold text-green-ink underline disabled:opacity-50"
                >
                  Use that instead
                </button>
              </>
            )}
          </span>
        </div>

        {/* Boten sin DM, av eller på. Lagres med en gang, som sone og tema —
            det er en bryter, ikke noe du skal trykke Lagre for. */}
        <div className="flex items-center justify-between gap-4 rounded-[14px] bg-bg p-3.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[14px] font-extrabold">Direct messages from the bot</span>
            <span className="text-[13px] leading-snug text-muted">
              {dmOff ? 'Off. You still get the pings in the channel.' : 'Reminders and changes land in your Discord inbox.'}
            </span>
          </div>
          <Toggle
            on={!dmOff}
            label="Direct messages from the bot"
            onChange={(on) => {
              setDmOff(!on)
              setDmOptOut(!on)
                .then(() => toast(on ? 'DMs on' : 'DMs off'))
                .catch((err) => {
                  setDmOff(on)
                  setError(friendlyError(err))
                })
            }}
          />
        </div>
        {/* Discord kan blokkere botens DM-er uten å si fra, og det er per person.
            Da må hver enkelt kunne sjekke sin egen innboks. */}
        {!dmOff && (
          <button
            type="button"
            disabled={busy || dmTest !== null}
            onClick={() => {
              setDmTest('…')
              sendMyDmTest()
                .then(() => setDmTest('Sent. Check your Discord inbox.'))
                .catch((err) => setDmTest(err instanceof DiscordApiError ? err.message : friendlyError(err)))
            }}
            className="-mt-2 self-start px-1 text-[13px] font-semibold text-muted underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
          >
            {dmTest ?? 'Can the bot reach me?'}
          </button>
        )}

        <ErrorText>{error}</ErrorText>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || name.trim().length === 0 || name.trim() === profile?.display_name}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  )
}
