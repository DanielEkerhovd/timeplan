import { useMemo, useState } from 'react'
import { setDisplayName, setTimezone } from '../lib/settings'
import { allZones, localZone, viewerZone } from '../lib/timezone'
import { friendlyError, type Profile } from '../lib/types'
import { Dropdown } from './pickers'
import { Avatar, Button, CloseButton, ErrorText, Input, Label, Modal, useToast } from './ui'

interface Props {
  userId: string
  profile: Profile | null
  avatarUrl?: string | null
  onClose: () => void
  onSaved: () => Promise<void>
}

/** Your profile: the name everyone sees, in every team. Picture comes from Discord. */
export default function ProfileModal({ userId, profile, avatarUrl, onClose, onSaved }: Props) {
  const [name, setName] = useState(profile?.display_name ?? '')
  const [zone, setZone] = useState(viewerZone(profile?.timezone))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  const device = localZone()
  // Sonen som er lagret skal alltid stå i lista, også om nettleseren ikke kjenner den.
  const zones = useMemo(() => {
    const list = allZones()
    if (zone && !list.includes(zone)) list.unshift(zone)
    return list.map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))
  }, [zone])

  async function save(value: string | null) {
    setBusy(true)
    setError(null)
    try {
      await setDisplayName(value)
      if (zone !== profile?.timezone) await setTimezone(userId, zone)
      await onSaved()
      toast(value ? 'Name updated' : 'Back to your Discord name')
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
          <span className="text-xs text-muted">
            {profile?.custom_name
              ? `Your own name. Discord calls you ${profile.discord_name ?? 'something else'}.`
              : 'This is your Discord name. Change it here if you want something else.'}
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Your timezone</Label>
          <Dropdown value={zone} options={zones} onChange={setZone} search className="w-full" menuWidth={320} aria-label="Your timezone" />
          <span className="text-xs text-muted">
            Times in the app are always the team's. This is only used to tell you what they are where you are.
            {zone !== device && ' '}
            {zone !== device && (
              <button type="button" className="font-bold text-green-ink underline" onClick={() => setZone(device)}>
                Use this device ({device})
              </button>
            )}
          </span>
        </div>

        <ErrorText>{error}</ErrorText>

        <div className="flex items-center gap-2 pt-1">
          {profile?.custom_name && (
            <Button type="button" variant="ghost" onClick={() => void save(null)} disabled={busy}>
              Use Discord name
            </Button>
          )}
          <div className="flex-1" />
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || name.trim().length === 0 || (name.trim() === profile?.display_name && zone === profile?.timezone)}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  )
}
