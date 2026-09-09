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
  setAccess,
  setMemberRole,
} from "../lib/settings";
import { inviteLink, type MyTeam } from "../lib/teams";
import {
  canEdit,
  friendlyError,
  roleLabel,
  type Invite,
  type MemberWithProfile,
  type TeamRole,
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
  const roles = week.roles;

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
    <div className="flex min-h-0 flex-1 flex-col gap-5 lg:-mr-8 lg:overflow-y-auto lg:pr-8">
      <div className="hidden flex-col gap-1 lg:flex">
        <Eyebrow>Members</Eyebrow>
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
                  roles={roles}
                  onSetAccess={(access) =>
                    void run(
                      m.user_id,
                      () => setAccess(team.id, m.user_id, access),
                      `${m.profile?.display_name ?? "They"} is now ${roleLabel[access].toLowerCase()}`,
                    )
                  }
                  onSetRole={(roleId) =>
                    void run(m.user_id, () =>
                      setMemberRole(team.id, m.user_id, roleId),
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

        {editor && (
          <InviteCard
            teamId={team.id}
            onError={setError}
            memberCount={members?.length ?? 0}
          />
        )}
      </div>
    </div>
  );
}

function MemberRow({
  m,
  me,
  isOwner,
  editor,
  roles,
  busy,
  confirm,
  onAskConfirm,
  onCancel,
  onSetAccess,
  onSetRole,
  onRemove,
}: {
  m: MemberWithProfile;
  me: boolean;
  isOwner: boolean;
  editor: boolean;
  roles: TeamRole[];
  busy: boolean;
  confirm: "remove" | "leave" | null;
  onAskConfirm: (kind: "remove") => void;
  onCancel: () => void;
  onSetAccess: (access: "admin" | "member") => void;
  onSetRole: (roleId: string | null) => void;
  onRemove: () => void;
}) {
  const name = m.profile?.display_name ?? "Unknown";
  // The owner manages everyone but themselves. Admins can only remove members.
  const canManage = !me && (isOwner || (editor && m.role === "member"));
  const isOwnerRow = m.role === "owner";
  const roleName = roles.find((r) => r.id === m.role_id)?.name ?? null;
  // Anyone can carry a role, the owner included. Only the team's own list decides the names.
  const showRoles = roles.length > 0;
  const roleEditable = showRoles && (me || editor);

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl bg-bg px-3 py-2.5">
      <Avatar name={name} url={m.profile?.avatar_url} size={34} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5 truncate text-sm font-bold">
          {name}
          {isOwnerRow && (
            <span className="rounded-full bg-green-soft px-2 py-px text-[10px] font-extrabold uppercase tracking-[0.06em] text-green-ink">
              {roleLabel.owner}
            </span>
          )}
        </span>
        <span className="text-xs text-muted">
          {roleName ?? (showRoles ? "No role yet" : roleLabel[m.role])}
          {me ? " · you" : ""}
        </span>
      </div>
      {confirm === null && (
        <div className="flex items-center gap-1.5">
          {/* Column 1: the role from the team's own list. Same slot on every row. */}
          {showRoles && (
            <Dropdown
              value={m.role_id ?? ""}
              options={[
                { value: "", label: "No role" },
                ...roles.map((r) => ({ value: r.id, label: r.name })),
              ]}
              onChange={(v) => onSetRole(v ? String(v) : null)}
              disabled={busy}
              aria-label="Role"
              look="pill"
              placeholder="Role …"
              className={`w-[126px] ${roleEditable ? "" : "pointer-events-none invisible"}`}
            />
          )}

          {/* Column 2: access. Only the owner hands it out, and never on their own row. */}
          <div
            className={`flex gap-0.5 rounded-full bg-surface p-0.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${isOwner && !isOwnerRow ? "" : "pointer-events-none invisible"}`}
            role="radiogroup"
            aria-label="Access"
          >
            {(["member", "admin"] as const).map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={m.role === r}
                disabled={busy || m.role === r}
                onClick={() => onSetAccess(r)}
                className={`h-7 rounded-full px-3 text-xs font-bold transition ${
                  m.role === r ? "bg-ink text-on-ink" : "text-muted hover:text-ink"
                }`}
              >
                {roleLabel[r]}
              </button>
            ))}
          </div>

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
  memberCount,
}: {
  teamId: string;
  onError: (e: string | null) => void;
  /** Endrer seg når noen blir med, og da er «x of y left» utdatert. */
  memberCount: number;
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
  }, [load, memberCount]);

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
        <h2 className="text-[15px] font-extrabold">Invite members</h2>
        <p className="text-[13px] leading-relaxed text-muted">
          Paste the link in Discord. One click, sign in, and they are on the team.
        </p>
      </div>

      {invites === null ? (
        <Spinner className="min-h-[92px]" />
      ) : !first ? (
        <div className="flex flex-col items-start gap-1 rounded-2xl border-[1.5px] border-dashed border-line px-4 py-5">
          <span className="text-sm font-bold">No invite link yet</span>
          <span className="text-[13px] text-muted">Make one below and paste it where your team is.</span>
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

/** Seats used and the access split, in one compact card. */
function TeamStats({ members }: { members: MemberWithProfile[] }) {
  const admins = members.filter((m) => canEdit(m.role)).length;
  const rest = members.length - admins;
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
          <Stat n={admins} label={admins === 1 ? "admin" : "admins"} />
          <Stat n={rest} label={rest === 1 ? "member" : "members"} />
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
