import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import {
  createInvite,
  deleteInvite,
  fetchInvites,
  inviteIsActive,
  leaveTeam,
  removeMember,
  setPosition,
  setRole,
} from "../lib/settings";
import { inviteLink, type MyTeam } from "../lib/teams";
import {
  canEdit,
  friendlyError,
  roleLabel,
  type Invite,
  type MemberWithProfile,
  type Position,
  positionLabel,
} from "../lib/types";
import type { WeekData } from "../lib/useWeekData";
import {
  Avatar,
  Button,
  Card,
  ErrorText,
  Eyebrow,
  Pill,
  Spinner,
  useToast,
} from "../components/ui";
import { Dropdown } from "../components/pickers";

interface Props {
  team: MyTeam;
  week: WeekData;
  onTeamsChanged: () => Promise<void>;
}

/** Members, roles and invite codes. */
export default function PlayersPage({ team, week, onTeamsChanged }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const editor = canEdit(team.role);
  const isOwner = team.role === "owner";
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    kind: "remove" | "leave";
    userId?: string;
  } | null>(null);

  const members = week.members;

  async function run(key: string, fn: () => Promise<void>, done?: string) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await week.reloadTeam();
      if (done) toast(done);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  async function leave() {
    setBusy("leave");
    try {
      await leaveTeam(team.id);
      await onTeamsChanged();
      navigate("/");
    } catch (err) {
      setError(friendlyError(err));
      setBusy(null);
      setConfirm(null);
    }
  }

  if (!members || !user) return <Spinner />;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 lg:overflow-y-auto">
      <div className="hidden flex-col gap-1 lg:flex">
        <Eyebrow>Players</Eyebrow>
        <h1 className="text-[26px] font-extrabold tracking-tight">
          {team.name}
        </h1>
      </div>

      <ErrorText>{error}</ErrorText>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-stretch">
        <div className="flex flex-col gap-5">
          <TeamStats members={members} />
          <Card className="flex flex-1 flex-col gap-3">
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
                  onAskConfirm={(kind) =>
                    setConfirm({ kind, userId: m.user_id })
                  }
                  onCancel={() => setConfirm(null)}
                  onSetRole={(role) =>
                    void run(
                      m.user_id,
                      async () => {
                        await setRole(team.id, m.user_id, role);
                        // A coach has no lane; clear it so the list stays tidy.
                        if (role === "coach" && m.position)
                          await setPosition(team.id, m.user_id, null);
                      },
                      `${m.profile?.display_name ?? "Player"} is now ${roleLabel[role].toLowerCase()}`,
                    )
                  }
                  onSetPosition={(p) =>
                    void run(m.user_id, () =>
                      setPosition(team.id, m.user_id, p),
                    )
                  }
                  onRemove={() =>
                    void run(
                      m.user_id,
                      () => removeMember(team.id, m.user_id),
                      "Removed from the team",
                    )
                  }
                />
              ))}
            </ul>
            {!isOwner && (
              <div className="mt-auto flex items-center justify-between border-t border-line pt-3">
                <span className="text-[13px] text-muted">
                  Leaving removes your availability too.
                </span>
                {confirm?.kind === "leave" ? (
                  <div className="flex gap-2">
                    <Pill onClick={() => setConfirm(null)}>Stay</Pill>
                    <Pill
                      active
                      onClick={() => void leave()}
                      disabled={busy === "leave"}
                    >
                      Yes, leave
                    </Pill>
                  </div>
                ) : (
                  <Pill onClick={() => setConfirm({ kind: "leave" })}>
                    Leave team
                  </Pill>
                )}
              </div>
            )}
          </Card>
        </div>

        {editor && <InviteCard teamId={team.id} onError={setError} />}
      </div>
    </div>
  );
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
  onSetPosition,
  onRemove,
}: {
  m: MemberWithProfile;
  me: boolean;
  isOwner: boolean;
  editor: boolean;
  busy: boolean;
  confirm: "remove" | "leave" | null;
  onAskConfirm: (kind: "remove") => void;
  onCancel: () => void;
  onSetRole: (role: "coach" | "player") => void;
  onSetPosition: (position: Position | null) => void;
  onRemove: () => void;
}) {
  const name = m.profile?.display_name ?? "Unknown";
  // Owner manages everyone but themselves. Coaches can only remove players.
  const canManage = !me && (isOwner || (editor && m.role === "player"));
  const isOwnerRow = m.role === "owner";
  // Only players pick a lane. The owner counts as a player unless their seat is set to coach.
  const showLane =
    m.role === "player" || (isOwnerRow && m.position !== "coach");
  const laneEditable = showLane && (me || editor);
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl bg-bg px-3 py-2.5">
      <Avatar name={name} url={m.profile?.avatar_url} size={34} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5 truncate text-sm font-bold">
          {name}
          {m.role !== "player" && (
            <span className="rounded-full bg-green-soft px-2 py-px text-[10px] font-extrabold uppercase tracking-[0.06em] text-green-ink">
              {roleLabel[m.role]}
            </span>
          )}
        </span>
        <span className="text-xs text-muted">
          {m.position
            ? positionLabel[m.position]
            : showLane
              ? "No position yet"
              : roleLabel[m.role]}
          {me ? " · you" : ""}
        </span>
      </div>
      {confirm === null && (
        <div className="flex items-center gap-1.5">
          {/* Column 1: lane. Same slot on every row; hidden but still there when it does not apply. */}
          <Dropdown
            value={m.position ?? ""}
            options={[
              { value: "", label: "No position" },
              ...lanes.map((p) => ({ value: p, label: positionLabel[p] })),
            ]}
            onChange={(v) => onSetPosition((v || null) as Position | null)}
            disabled={busy}
            aria-label="Position"
            look="pill"
            placeholder="Position …"
            className={`w-[118px] ${laneEditable ? "" : "pointer-events-none invisible"}`}
          />

          {/* Column 2: Coach | Player. Role for others (owner only), seat for the owner's own row. */}
          {isOwner && (
            <div
              className="flex gap-0.5 rounded-full bg-surface p-0.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
              role="radiogroup"
              aria-label={isOwnerRow ? "Seat" : "Role"}
            >
              {(["coach", "player"] as const).map((r) => {
                const on = isOwnerRow
                  ? r === "coach"
                    ? m.position === "coach"
                    : m.position !== "coach"
                  : m.role === r;
                return (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={busy || on}
                    onClick={() =>
                      isOwnerRow
                        ? onSetPosition(r === "coach" ? "coach" : null)
                        : onSetRole(r)
                    }
                    className={`h-7 rounded-full px-3 text-xs font-bold transition ${
                      on ? "bg-ink text-on-ink" : "text-muted hover:text-ink"
                    }`}
                  >
                    {roleLabel[r]}
                  </button>
                );
              })}
            </div>
          )}

          {/* Column 3: remove. Placeholder keeps the columns lined up on rows you cannot remove. */}
          {canManage ? (
            <button
              onClick={() => onAskConfirm("remove")}
              disabled={busy}
              aria-label={`Remove ${name}`}
              title="Remove from team"
              className="flex h-8 w-8 items-center justify-center rounded-full text-faint hover:bg-red-soft hover:text-red-ink"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          ) : (
            <span className="h-8 w-8" />
          )}
        </div>
      )}
      {confirm === "remove" && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-muted">
            Remove {name}?
          </span>
          <Pill onClick={onCancel}>No</Pill>
          <Pill active onClick={onRemove} disabled={busy}>
            Yes
          </Pill>
        </div>
      )}
    </li>
  );
}

function InviteCard({
  teamId,
  onError,
}: {
  teamId: string;
  onError: (e: string | null) => void;
}) {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [days, setDays] = useState(7);
  const [uses, setUses] = useState(5);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setInvites(await fetchInvites(teamId));
    } catch (err) {
      onError(friendlyError(err));
    }
  }, [teamId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function make() {
    setBusy(true);
    try {
      await createInvite(teamId, days, uses);
      await load();
      onError(null);
    } catch (err) {
      onError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await deleteInvite(id);
      await load();
    } catch (err) {
      onError(friendlyError(err));
    }
  }

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(done);
    } catch {
      window.prompt("Copy this", text);
    }
  }

  return (
    <InviteCardView
      invites={invites}
      days={days}
      uses={uses}
      busy={busy}
      onDays={setDays}
      onUses={setUses}
      onCreate={() => void make()}
      onDelete={(id) => void remove(id)}
      onCopyLink={(code) =>
        void copy(inviteLink(code), "Link copied · paste it on Discord")
      }
      onCopyCode={(code) => void copy(code, "Code copied")}
      onClearSpent={(ids) =>
        void Promise.all(ids.map((id) => deleteInvite(id))).then(load)
      }
    />
  );
}

const expiryLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

function trash(size = 14) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13" />
    </svg>
  );
}

interface ViewProps {
  invites: Invite[] | null;
  days: number;
  uses: number;
  busy: boolean;
  onDays: (n: number) => void;
  onUses: (n: number) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onCopyLink: (code: string) => void;
  onCopyCode: (code: string) => void;
  onClearSpent: (ids: string[]) => void;
}

/**
 * The invite card, without the data loading — so it can be rendered in the preview harness.
 * The newest code gets the whole width: the link is what people paste, so it is the thing
 * you can see and copy. Older codes sit below as thin rows.
 */
export function InviteCardView({ invites, days, uses, busy, onDays, onUses, onCreate, onDelete, onCopyLink, onCopyCode, onClearSpent }: ViewProps) {
  const active = (invites ?? []).filter(inviteIsActive);
  const spent = (invites ?? []).filter((i) => !inviteIsActive(i));
  const [first, ...rest] = active;

  return (
    <Card className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-[15px] font-extrabold">Invite players</h2>
        <p className="text-[13px] leading-relaxed text-muted">
          Paste the link in Discord. One click, sign in, and they are on the team.
        </p>
      </div>

      {invites === null ? (
        <Spinner className="min-h-[92px]" />
      ) : !first ? (
        <div className="flex flex-col items-start gap-1 rounded-2xl border-[1.5px] border-dashed border-line px-4 py-5">
          <span className="text-sm font-bold">No invite link yet</span>
          <span className="text-[13px] text-muted">Make one below and paste it where your players are.</span>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 rounded-2xl bg-bg p-3.5">
          <div className="flex items-center gap-2">
            <div className="flex h-11 min-w-0 flex-1 items-center rounded-xl bg-surface px-3.5 shadow-[inset_0_0_0_1.5px_var(--color-line)]">
              <span className="truncate text-[13px] font-semibold text-muted">
                {inviteLink(first.code)}
              </span>
            </div>
            <Button className="h-11 shrink-0 px-4 sm:px-5" onClick={() => onCopyLink(first.code)}>
              Copy link
            </Button>
          </div>
          <div className="flex items-center gap-2 pl-1 text-xs text-muted">
            <button onClick={() => onCopyCode(first.code)} className="shrink-0 rounded-md bg-surface px-1.5 py-0.5 font-mono text-[11px] font-bold tracking-[0.1em] text-ink hover:text-green-ink" title="Copy the code on its own">
              {first.code}
            </button>
            <span className="min-w-0 truncate">
              <span className="font-bold text-ink">{first.max_uses - first.used_count} of {first.max_uses} left</span> · expires {expiryLabel(first.expires_at)}
            </span>
            <div className="flex-1" />
            <button onClick={() => onDelete(first.id)} aria-label="Delete this link" className="flex h-7 w-7 items-center justify-center rounded-full text-faint hover:bg-red-soft hover:text-red-ink">
              {trash()}
            </button>
          </div>
        </div>
      )}

      {rest.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {rest.map((inv) => (
            <li key={inv.id} className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-bg">
              <button onClick={() => onCopyCode(inv.code)} className="font-mono text-[13px] font-bold tracking-[0.1em] hover:text-green-ink" title="Copy the code on its own">
                {inv.code}
              </button>
              <span className="hidden min-w-0 flex-1 truncate text-xs text-muted sm:block">
                {inv.max_uses - inv.used_count} of {inv.max_uses} left · expires {expiryLabel(inv.expires_at)}
              </span>
              <div className="flex-1 sm:hidden" />
              <Pill active onClick={() => onCopyLink(inv.code)}>
                Copy link
              </Pill>
              <button onClick={() => onDelete(inv.id)} aria-label="Delete code" className="flex h-7 w-7 items-center justify-center rounded-full text-faint hover:bg-red-soft hover:text-red-ink">
                {trash(13)}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3.5">
        <span className="hidden text-[11px] font-bold uppercase tracking-[0.08em] text-muted sm:inline">New link</span>
        <Dropdown
          value={days}
          options={[
            { value: 1, label: "1 day" },
            { value: 7, label: "7 days" },
            { value: 30, label: "30 days" },
          ]}
          onChange={onDays}
          aria-label="Lasts"
          className="h-9 w-[122px] text-[13px]"
        />
        <Dropdown
          value={uses}
          options={[
            { value: 1, label: "1 use" },
            { value: 5, label: "5 uses" },
            { value: 15, label: "15 uses" },
          ]}
          onChange={onUses}
          aria-label="Uses"
          className="h-9 w-[122px] text-[13px]"
        />
        <div className="flex-1" />
        <Button size="sm" variant="secondary" className="h-9" onClick={onCreate} disabled={busy || active.length >= 5}>
          Make link
        </Button>
      </div>

      {spent.length > 0 && (
        <button onClick={() => onClearSpent(spent.map((i) => i.id))} className="self-start text-xs font-semibold text-muted hover:text-ink">
          Clear {spent.length} expired or used-up code{spent.length === 1 ? "" : "s"}
        </button>
      )}
    </Card>
  );
}

const MAX_SEATS = 15;
// Lanes a player can pick. 'coach' is the owner's seat, not a lane.
const lanes: Position[] = ["top", "jungle", "mid", "bot", "support", "sub"];

/** Seats used and the role split, in one compact card. */
function TeamStats({ members }: { members: MemberWithProfile[] }) {
  const coaches = members.filter(
    (m) => m.role === "coach" || (m.role === "owner" && m.position === "coach"),
  ).length;
  const players = members.length - coaches;
  const Stat = ({ n, label }: { n: number; label: string }) => (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[22px] font-extrabold leading-none tracking-tight">
        {n}
      </span>
      <span className="text-xs font-semibold text-muted">{label}</span>
    </div>
  );
  return (
    <Card className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[26px] font-extrabold leading-none tracking-tight">
            {members.length}
          </span>
          <span className="text-sm font-bold text-faint">
            / {MAX_SEATS} seats
          </span>
        </div>
        <div className="flex gap-4">
          <Stat n={coaches} label={coaches === 1 ? "coach" : "coaches"} />
          <Stat n={players} label={players === 1 ? "player" : "players"} />
        </div>
      </div>
      <div className="flex gap-1">
        {Array.from({ length: MAX_SEATS }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full ${i < members.length ? "bg-green" : "bg-surface-2"}`}
          />
        ))}
      </div>
    </Card>
  );
}
