import { useState } from 'react'
import { setDisplayName } from '../lib/settings'
import { friendlyError, type Profile } from '../lib/types'
import { Avatar, Button, CloseButton, ErrorText, Input, Label, Modal, useToast } from './ui'

interface Props {
  profile: Profile | null
  avatarUrl?: string | null
  onClose: () => void
  onSaved: () => Promise<void>
}

/** Your profile: the name everyone sees, in every team. Picture comes from Discord. */
export default function ProfileModal({ profile, avatarUrl, onClose, onSaved }: Props) {
  const [name, setName] = useState(profile?.display_name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()

  async function save(value: string | null) {
    setBusy(true)
    setError(null)
    try {
      await setDisplayName(value)
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
          <Button type="submit" disabled={busy || name.trim().length === 0 || name.trim() === profile?.display_name}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  )
}
