import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { palette } from "../lib/colors";
import {
  addActivityType,
  addSlot,
  deleteSlot,
  deleteTeam,
  removeActivityType,
  renameTeam,
  transferOwnership,
  updateActivityType,
  updateSlot,
} from "../lib/settings";
import type { MyTeam } from "../lib/teams";
import {
  activityColors,
  friendlyError,
  type ActivityColor,
  type ActivityType,
  type DayType,
  type TeamSlot,
} from "../lib/types";
import type { WeekData } from "../lib/useWeekData";
import {
  Button,
  Card,
  ErrorText,
  Eyebrow,
  Input,
  Pill,
  Spinner,
  Toggle,
  useToast,
} from "../components/ui";
import { Dropdown, hourOptions } from "../components/pickers";
import { rotateShareSlug, setShareEnabled, shareLink } from "../lib/share";
import { weekId, weekStart } from "../lib/week";
import type { MemberWithProfile } from "../lib/types";

interface Props {
  team: MyTeam;
  week: WeekData;
  onTeamsChanged: () => Promise<void>;
}

/** Time slots, activity types, team name and the danger zone. Owner and coaches. */
export default function SettingsPage({ team, week, onTeamsChanged }: Props) {
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function run(fn: () => Promise<void>, done?: string) {
    try {
      await fn();
      await week.reloadTeam();
      setError(null);
      if (done) toast(done);
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  if (!week.slots) return <Spinner />;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 lg:overflow-y-auto">
      <div className="flex flex-col gap-1">
        <Eyebrow>Settings</Eyebrow>
        <h1 className="hidden text-[26px] font-extrabold tracking-tight lg:block">
          Time slots players can pick
        </h1>
        <p className="max-w-[560px] text-sm leading-relaxed text-muted">
          These are the buttons players see for each day. You can still book
          activities at other times; the app then checks the hours each player
          has marked as free.
        </p>
      </div>

      <ErrorText>{error}</ErrorText>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <SlotsCard
          title="Weekdays"
          subtitle="Monday to Friday"
          dayType="weekday"
          teamId={team.id}
          slots={week.slots}
          run={run}
        />
        <SlotsCard
          title="Weekend"
          subtitle="Saturday and Sunday"
          dayType="weekend"
          teamId={team.id}
          slots={week.slots}
          run={run}
        />
        <TypesCard teamId={team.id} types={week.types} run={run} />
        <TeamCard
          team={team}
          members={week.members ?? []}
          run={run}
          onTeamsChanged={onTeamsChanged}
        />
      </div>
    </div>
  );
}

const lengthOptions = [1, 2, 3, 4, 5, 6].map((h) => ({
  value: h,
  label: `${h} h`,
}));

type Run = (fn: () => Promise<void>, done?: string) => Promise<void>;

function SlotsCard({
  title,
  subtitle,
  dayType,
  teamId,
  slots,
  run,
}: {
  title: string;
  subtitle: string;
  dayType: DayType;
  teamId: string;
  slots: TeamSlot[];
  run: Run;
}) {
  const mine = slots.filter((s) => s.day_type === dayType);
  const [draft, setDraft] = useState<{ start: number; end: number } | null>(
    null,
  );

  return (
    <Card className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-extrabold">{title}</h2>
        <span className="text-xs text-muted">{subtitle}</span>
      </div>
      <div className="flex flex-col gap-2">
        {mine.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-2.5 rounded-xl bg-bg px-3 py-2.5"
          >
            <HourSelect
              value={s.start_hour}
              max={23}
              onChange={(h) =>
                void run(() =>
                  updateSlot(s.id, {
                    start_hour: h,
                    end_hour: Math.max(h + 1, s.end_hour),
                  }),
                )
              }
            />
            <span className="text-[13px] text-muted">to</span>
            <HourSelect
              value={s.end_hour}
              min={s.start_hour + 1}
              max={24}
              onChange={(h) =>
                void run(() => updateSlot(s.id, { end_hour: h }))
              }
            />
            <div className="flex-1" />
            <button
              onClick={() => void run(() => deleteSlot(s.id))}
              aria-label="Remove slot"
              className="flex h-8 w-8 items-center justify-center rounded-[10px] text-faint hover:bg-red-soft hover:text-red-ink"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        ))}
        {mine.length === 0 && !draft && (
          <p className="text-[13px] text-faint">
            No slots — players cannot answer for these days.
          </p>
        )}
        {draft ? (
          <div className="flex items-center gap-2.5 rounded-xl bg-bg px-3 py-2.5">
            <HourSelect
              value={draft.start}
              max={23}
              onChange={(h) =>
                setDraft({ start: h, end: Math.max(h + 1, draft.end) })
              }
            />
            <span className="text-[13px] text-muted">to</span>
            <HourSelect
              value={draft.end}
              min={draft.start + 1}
              max={24}
              onChange={(h) => setDraft({ ...draft, end: h })}
            />
            <div className="flex-1" />
            <Pill onClick={() => setDraft(null)}>Cancel</Pill>
            <Pill
              active
              onClick={() =>
                void run(
                  () =>
                    addSlot(
                      teamId,
                      dayType,
                      draft.start,
                      draft.end,
                      (mine.at(-1)?.sort ?? 0) + 1,
                    ),
                  "Slot added",
                ).then(() => setDraft(null))
              }
            >
              Add
            </Pill>
          </div>
        ) : (
          <button
            onClick={() =>
              setDraft({
                start: dayType === "weekday" ? 18 : 13,
                end: dayType === "weekday" ? 21 : 16,
              })
            }
            className="flex h-10 items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-dot text-[13px] font-bold text-muted hover:border-faint hover:text-ink"
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
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add time slot
          </button>
        )}
      </div>
    </Card>
  );
}

function HourSelect({
  value,
  min = 0,
  max = 24,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (h: number) => void;
}) {
  return (
    <Dropdown
      value={value}
      options={hourOptions(min, max)}
      onChange={onChange}
      className="h-9 w-[108px] pl-3 text-sm"
      menuWidth={120}
    />
  );
}

function TypesCard({
  teamId,
  types,
  run,
}: {
  teamId: string;
  types: ActivityType[];
  run: Run;
}) {
  const active = types.filter((t) => !t.archived);
  const archived = types.filter((t) => t.archived);
  const [adding, setAdding] = useState(false);

  return (
    <Card className="flex flex-col gap-3 lg:col-span-2">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-[15px] font-extrabold">Activity types</h2>
        <p className="text-[13px] leading-relaxed text-muted">
          The type is the name of the booking. Colour follows it everywhere: the
          week, the grid and the Discord image. Custom events pick their own
          title and colour when booked.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {active.map((t) => (
          <TypeRow key={t.id} type={t} run={run} />
        ))}
        {adding ? (
          <NewTypeRow
            onCancel={() => setAdding(false)}
            onAdd={(input) =>
              void run(
                () =>
                  addActivityType(
                    teamId,
                    input,
                    (active.at(-1)?.sort ?? 0) + 1,
                  ),
                "Type added",
              ).then(() => setAdding(false))
            }
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            disabled={active.length >= 12}
            className="flex h-10 items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-dot text-[13px] font-bold text-muted hover:border-faint hover:text-ink disabled:opacity-50"
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
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add type
          </button>
        )}
      </div>
      {archived.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs text-muted">
          <span>Archived:</span>
          {archived.map((t) => (
            <Pill
              key={t.id}
              onClick={() =>
                void run(
                  () => updateActivityType(t.id, { archived: false }),
                  `${t.name} restored`,
                )
              }
              title="Restore"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: palette[t.color].accent }}
              />
              {t.name} · restore
            </Pill>
          ))}
        </div>
      )}
    </Card>
  );
}

function ColorDot({
  color,
  onPick,
}: {
  color: ActivityColor;
  onPick: (c: ActivityColor) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`Colour: ${palette[color].label}`}
        className="h-[22px] w-[22px] shrink-0 rounded-full ring-2 ring-surface"
        style={{ background: palette[color].accent }}
      />
      {open && (
        <div
          className="absolute left-0 top-7 z-10 flex gap-1.5 rounded-xl bg-surface p-2 shadow-card"
          onMouseLeave={() => setOpen(false)}
        >
          {activityColors.map((c) => (
            <button
              key={c}
              onClick={() => {
                onPick(c);
                setOpen(false);
              }}
              aria-label={palette[c].label}
              className="h-6 w-6 rounded-full"
              style={{
                background: palette[c].accent,
                boxShadow:
                  c === color ? "0 0 0 2px var(--color-surface), 0 0 0 3.5px var(--color-ink)" : "none",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TypeRow({ type, run }: { type: ActivityType; run: Run }) {
  const [name, setName] = useState(type.name);
  const [confirm, setConfirm] = useState(false);
  const rename = () => {
    const n = name.trim();
    if (n && n !== type.name)
      void run(() => updateActivityType(type.id, { name: n }));
    else setName(type.name);
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-bg px-3 py-2.5">
      <ColorDot
        color={type.color}
        onPick={(c) =>
          void run(() => updateActivityType(type.id, { color: c }))
        }
      />
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={rename}
        onKeyDown={(e) =>
          e.key === "Enter" && (e.target as HTMLInputElement).blur()
        }
        maxLength={30}
        className="h-9 w-[150px] px-3 text-sm"
      />
      <label className="flex items-center gap-2 text-xs text-muted">
        <Toggle
          on={type.ask_opponent}
          onChange={(v) =>
            void run(() => updateActivityType(type.id, { ask_opponent: v }))
          }
          label="Ask for opponent"
        />
        Ask for opponent
      </label>
      <label className="ml-auto flex items-center gap-2 text-xs text-muted">
        Default
        <Dropdown
          value={type.default_hours}
          options={lengthOptions}
          onChange={(h) =>
            void run(() => updateActivityType(type.id, { default_hours: h }))
          }
          look="pill"
          className="w-[84px]"
          menuWidth={100}
        />
      </label>
      {confirm ? (
        <div className="flex items-center gap-1.5">
          <Pill onClick={() => setConfirm(false)}>Keep</Pill>
          <Pill
            active
            onClick={() =>
              void run(
                () => removeActivityType(type.id),
                `${type.name} removed`,
              )
            }
          >
            Remove
          </Pill>
        </div>
      ) : (
        <button
          onClick={() => setConfirm(true)}
          aria-label="Remove type"
          className="flex h-8 w-8 items-center justify-center rounded-[10px] text-faint hover:bg-red-soft hover:text-red-ink"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}

function NewTypeRow({
  onCancel,
  onAdd,
}: {
  onCancel: () => void;
  onAdd: (input: {
    name: string;
    color: ActivityColor;
    ask_opponent: boolean;
    default_hours: number;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<ActivityColor>("teal");
  const [ask, setAsk] = useState(false);
  const [len, setLen] = useState(3);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border-[1.5px] border-line px-3 py-2.5">
      <ColorDot color={color} onPick={setColor} />
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name"
        maxLength={30}
        autoFocus
        className="h-9 w-[150px] px-3 text-sm"
      />
      <label className="flex items-center gap-2 text-xs text-muted">
        <Toggle on={ask} onChange={setAsk} label="Ask for opponent" />
        Ask for opponent
      </label>
      <label className="ml-auto flex items-center gap-2 text-xs text-muted">
        Default
        <Dropdown
          value={len}
          options={lengthOptions}
          onChange={setLen}
          look="pill"
          className="w-[84px]"
          menuWidth={100}
        />
      </label>
      <Pill onClick={onCancel}>Cancel</Pill>
      <Pill
        active
        disabled={name.trim().length === 0}
        onClick={() =>
          onAdd({
            name: name.trim(),
            color,
            ask_opponent: ask,
            default_hours: len,
          })
        }
      >
        Add
      </Pill>
    </div>
  );
}

function TeamCard({
  team,
  members,
  run,
  onTeamsChanged,
}: {
  team: MyTeam;
  members: MemberWithProfile[];
  run: Run;
  onTeamsChanged: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState(team.name);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [newOwner, setNewOwner] = useState("");
  const others = members.filter((m) => m.role !== "owner");
  const [error, setError] = useState<string | null>(null);
  const isOwner = team.role === "owner";

  async function remove() {
    setError(null);
    try {
      await deleteTeam(team.id, confirmName);
      await onTeamsChanged();
      navigate("/");
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  return (
    <Card className="flex flex-col gap-4 lg:col-span-2">
      <div className="flex flex-col gap-2">
        <h2 className="text-[15px] font-extrabold">Team</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            className="h-10 w-[260px] text-sm"
          />
          <Button
            size="sm"
            className="h-10"
            variant="secondary"
            disabled={name.trim().length < 2 || name.trim() === team.name}
            onClick={() =>
              void run(() => renameTeam(team.id, name), "Team renamed").then(
                onTeamsChanged,
              )
            }
          >
            Rename
          </Button>
        </div>
        <p className="text-[13px] text-muted">
          Times are shown in the team's timezone ({team.timezone}).
        </p>
      </div>

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-sm font-extrabold">Share on Discord</h3>
            <p className="text-[13px] leading-relaxed text-muted">
              Anyone with the link sees booked activities and the blocks where
              everyone is free. Never who is free when.
            </p>
          </div>
          <Toggle
            on={team.share_enabled}
            label="Sharing"
            onChange={(v) =>
              void run(
                () => setShareEnabled(team.id, v),
                v ? "Sharing is on" : "Sharing is off",
              ).then(onTeamsChanged)
            }
          />
        </div>
        {team.share_enabled && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              readOnly
              value={shareLink(team.share_slug, weekId(weekStart(new Date())))}
              className="h-10 w-[360px] max-w-full text-[13px]"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              size="sm"
              variant="secondary"
              className="h-10"
              onClick={() =>
                void navigator.clipboard
                  .writeText(
                    shareLink(team.share_slug, weekId(weekStart(new Date()))),
                  )
                  .then(() => run(async () => {}, "Link copied"))
              }
            >
              Copy
            </Button>
            {isOwner && (
              <Button
                size="sm"
                variant="ghost"
                className="h-10"
                title="Old links stop working"
                onClick={() =>
                  void run(
                    () => rotateShareSlug(team.id).then(() => {}),
                    "New link made · old ones stopped working",
                  ).then(onTeamsChanged)
                }
              >
                New link
              </Button>
            )}
          </div>
        )}
      </div>

      {isOwner && (
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <h3 className="text-sm font-extrabold">Transfer ownership</h3>
          <p className="text-[13px] leading-relaxed text-muted">
            Hand the team to someone else. You become a coach.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Dropdown
              value={newOwner}
              options={others.map((m) => ({
                value: m.user_id,
                label: m.profile?.display_name ?? "Unknown",
              }))}
              onChange={setNewOwner}
              placeholder={
                others.length === 0
                  ? "No one else on the team yet"
                  : "Pick a member …"
              }
              disabled={others.length === 0}
              className="h-10 w-[260px] text-sm"
            />
            <Button
              size="sm"
              variant="secondary"
              className="h-10"
              disabled={!newOwner}
              onClick={() =>
                void run(async () => {
                  await transferOwnership(team.id, newOwner);
                  await onTeamsChanged();
                  navigate(`/team/${team.id}`);
                }, "Ownership transferred")
              }
            >
              Transfer
            </Button>
          </div>
        </div>
      )}

      {isOwner && (
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <h3 className="text-sm font-extrabold text-red-ink">Delete team</h3>
          <p className="text-[13px] leading-relaxed text-muted">
            Removes the team, every member, all availability and all bookings.
            There is no undo.
          </p>
          {deleting ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={`Type "${team.name}" to confirm`}
                className="h-10 w-[260px] text-sm"
              />
              <Button
                size="sm"
                variant="secondary"
                className="h-10"
                onClick={() => setDeleting(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="danger"
                className="h-10"
                disabled={confirmName !== team.name}
                onClick={() => void remove()}
              >
                Delete for good
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              className="h-10 w-fit"
              onClick={() => setDeleting(true)}
            >
              Delete team …
            </Button>
          )}
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </Card>
  );
}
