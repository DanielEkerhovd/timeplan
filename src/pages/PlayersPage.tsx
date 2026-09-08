import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { createInvite, deleteInvite, fetchInvites, inviteIsActive, leaveTeam, removeMember, setRole, transferOwnership } from '../lib/settings'
import type { MyTeam } from '../lib/teams'
import { canEdit, friendlyError, roleLabel, type Invite, type MemberWithProfile } from '../lib/types'
import type { WeekData } from '../lib/useWeekData'
import { Avatar, Button, Card, ErrorText, Eyebrow, Pill, Select, Spinner, useToast } from '../components/ui'

interface Props {
  team: MyTeam
  week: WeekData
  onTeamsChanged: () => Promise<void>
}

/** Members, roles and invite codes. */
export default function PlayersPage({ team, week, onTeamsChanged }: Props) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const editor = canEdit(team.role)
  const isOwner = team.role === 'owner'
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ kind: 'remove' | 'transfer' | 'leave'; userId?: string } | null>(null)

  const members = week.members

  async function run(key: string, fn: () => Promise<void>, done?: string) {
    setBusy(key)
    setError(null)
    try {
      await fn()
      await week.reloadTeam()
      if (done) toast(done)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(null)
      setConfirm(null)
    }
  }

  async function leave() {
    setBusy('leave')
    try {
      await leaveTeam(team.id)
      await onTeamsChanged()
      navigate('/')
    } catch (err) {
      setError(friendlyError(err))
      setBusy(null)
      setConfirm(null)
    }
  }

  if (!members || !user) return <Spinner />

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 lg:overflow-y-auto">
      <div className="hidden flex-col gap-1 lg:flex">
        <Eyebrow>Players</Eyebrow>
        <h1 className="text-[26px] font-extrabold tracking-tight">{team.name}</h1>
      </div>

      <ErrorText>{error}</ErrorText>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <Card className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-extrabold">Members</h2>
          </div>
          <ul className="flex flex-col gap-2">
            {members.map((m) => (
              <MemberRow
                key={m.user_id}
                m={m}
                me={m.user_id === user.id}
                isOwner={isOwner}
                editor={editor}
                busy={busy === m.user_id}
                confirm={confirm?.userId === m.user_id ? confirm.kind : null}
                onAskConfirm={(kind) => setConfirm({ kind, userId: m.user_id })}
                onCancel={() => setConfirm(null)}
                onSetRole={(role) => void run(m.user_id, () => setRole(team.id, m.user_id, role), `${m.profile?.display_name ?? 'Player'} is now ${roleLabel[role].toLowerCase()}`)}
                onRemove={() => void run(m.user_id, () => removeMember(team.id, m.user_id), 'Removed from the team')}
                onTransfer={() =>
                  void run(m.user_id, async () => {
                    await transferOwnership(team.id, m.user_id)
                    await onTeamsChanged()
                  }, 'Ownership transferred')
                }
              />
            ))}
          </ul>
          {!isOwner && (
            <div className="flex items-center justify-between border-t border-line pt-3">
              <span className="text-[13px] text-muted">Leaving removes your availability too.</span>
              {confirm?.kind === 'leave' ? (
                <div className="flex gap-2">
                  <Pill onClick={() => setConfirm(null)}>Stay</Pill>
                  <Pill active onClick={() => void leave()} disabled={busy === 'leave'}>
                    Yes, leave
                  </Pill>
                </div>
              ) : (
                <Pill onClick={() => setConfirm({ kind: 'leave' })}>Leave team</Pill>
              )}
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-5">
          <TeamStats members={members} />
          {editor && <InviteCard teamId={team.id} onError={setError} />}
        </div>
      </div>
    </div>
  )
}

function MemberRow({
  m,
  me,
  isOwner,
  editor,
  busy,
  confirm,
  onAskConfirm,
  onCancel,
  onSetRole,
  onRemove,
  onTransfer,
}: {
  m: MemberWithProfile
  me: boolean
  isOwner: boolean
  editor: boolean
  busy: boolean
  confirm: 'remove' | 'transfer' | 'leave' | null
  onAskConfirm: (kind: 'remove' | 'transfer') => void
  onCancel: () => void
  onSetRole: (role: 'coach' | 'player') => void
  onRemove: () => void
  onTransfer: () => void
}) {
  const name = m.profile?.display_name ?? 'Unknown'
  // Owner manages everyone but themselves. Coaches can only remove players.
  const canManage = !me && (isOwner || (editor && m.role === 'player'))
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl bg-bg px-3 py-2.5">
      <Avatar name={name} url={m.profile?.avatar_url} size={34} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-bold">{name}</span>
        <span className="text-xs text-muted">
          {roleLabel[m.role]}
          {me ? ' · you' : ''}
        </span>
      </div>
      {canManage && confirm === null && (
        <div className="flex flex-wrap items-center gap-1.5">
          {isOwner && m.role === 'player' && (
            <Pill onClick={() => onSetRole('coach')} disabled={busy}>
              Make coach
            </Pill>
          )}
          {isOwner && m.role === 'coach' && (
            <Pill onClick={() => onSetRole('player')} disabled={busy}>
              Make player
            </Pill>
          )}
          {isOwner && (
            <Pill onClick={() => onAskConfirm('transfer')} disabled={busy}>
              Make owner
            </Pill>
          )}
          <button
            onClick={() => onAskConfirm('remove')}
            disabled={busy}
            aria-label={`Remove ${name}`}
            title="Remove from team"
            className="flex h-8 w-8 items-center justify-center rounded-full text-faint hover:bg-red-soft hover:text-red-ink"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      )}
      {confirm === 'remove' && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-muted">Remove {name}?</span>
          <Pill onClick={onCancel}>No</Pill>
          <Pill active onClick={onRemove} disabled={busy}>
            Yes
          </Pill>
        </div>
      )}
      {confirm === 'transfer' && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-muted">Hand the team to {name}? You become a coach.</span>
          <Pill onClick={onCancel}>No</Pill>
          <Pill active onClick={onTransfer} disabled={busy}>
            Yes
          </Pill>
        </div>
      )}
    </li>
  )
}

function InviteCard({ teamId, onError }: { teamId: string; onError: (e: string | null) => void }) {
  const [invites, setInvites] = useState<Invite[] | null>(null)
  const [days, setDays] = useState(7)
  const [uses, setUses] = useState(5)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const load = useCallback(async () => {
    try {
      setInvites(await fetchInvites(teamId))
    } catch (err) {
      onError(friendlyError(err))
    }
  }, [teamId, onError])

  useEffect(() => {
    void load()
  }, [load])

  async function make() {
    setBusy(true)
    try {
      await createInvite(teamId, days, uses)
      await load()
      onError(null)
    } catch (err) {
      onError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    try {
      await deleteInvite(id)
      await load()
    } catch (err) {
      onError(friendlyError(err))
    }
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code)
      toast('Code copied')
    } catch {
      toast(code)
    }
  }

  const active = (invites ?? []).filter(inviteIsActive)
  const spent = (invites ?? []).filter((i) => !inviteIsActive(i))

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-[15px] font-extrabold">Invite codes</h2>
        <p className="text-[13px] leading-relaxed text-muted">
          Share a code on Discord; players enter it under "New team / use a code". Codes expire and have a limited number of uses, so a leaked one cannot be reused forever.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
          Lasts
          <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-10 w-[120px] text-sm">
            <option value={1}>1 day</option>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
          Uses
          <Select value={uses} onChange={(e) => setUses(Number(e.target.value))} className="h-10 w-[110px] text-sm">
            <option value={1}>1</option>
            <option value={5}>5</option>
            <option value={15}>15</option>
          </Select>
        </label>
        <Button size="sm" className="h-10" onClick={() => void make()} disabled={busy || active.length >= 5}>
          New code
        </Button>
      </div>

      {invites === null ? (
        <Spinner className="min-h-[60px]" />
      ) : active.length === 0 ? (
        <p className="text-[13px] text-faint">No active codes.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {active.map((inv) => (
            <li key={inv.id} className="flex items-center gap-3 rounded-xl bg-bg px-3 py-2.5">
              <button onClick={() => void copy(inv.code)} className="font-mono text-[15px] font-bold tracking-[0.12em] hover:text-green-ink" title="Copy">
                {inv.code}
              </button>
              <span className="flex-1 text-xs text-muted">
                {inv.used_count}/{inv.max_uses} used · expires {new Date(inv.expires_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
              </span>
              <Pill onClick={() => void copy(inv.code)}>Copy</Pill>
              <button onClick={() => void remove(inv.id)} aria-label="Delete code" className="flex h-8 w-8 items-center justify-center rounded-full text-faint hover:bg-red-soft hover:text-red-ink">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      {spent.length > 0 && (
        <button onClick={() => void Promise.all(spent.map((i) => deleteInvite(i.id))).then(load)} className="self-start text-xs font-semibold text-muted hover:text-ink">
          Clear {spent.length} expired or used-up code{spent.length === 1 ? '' : 's'}
        </button>
      )}
    </Card>
  )
}

const MAX_SEATS = 15

/** Seats used and the role split, in one compact card. */
function TeamStats({ members }: { members: MemberWithProfile[] }) {
  const coaches = members.filter((m) => m.role === 'coach').length
  const players = members.filter((m) => m.role === 'player').length
  const Stat = ({ n, label }: { n: number; label: string }) => (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[22px] font-extrabold leading-none tracking-tight">{n}</span>
      <span className="text-xs font-semibold text-muted">{label}</span>
    </div>
  )
  return (
    <Card className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[26px] font-extrabold leading-none tracking-tight">{members.length}</span>
          <span className="text-sm font-bold text-faint">/ {MAX_SEATS} seats</span>
        </div>
        <div className="flex gap-4">
          <Stat n={1} label="owner" />
          <Stat n={coaches} label={coaches === 1 ? 'coach' : 'coaches'} />
          <Stat n={players} label={players === 1 ? 'player' : 'players'} />
        </div>
      </div>
      <div className="flex gap-1">
        {Array.from({ length: MAX_SEATS }, (_, i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full ${i < members.length ? 'bg-green' : 'bg-surface-2'}`} />
        ))}
      </div>
    </Card>
  )
}
