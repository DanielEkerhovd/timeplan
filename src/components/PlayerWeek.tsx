import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { applyToggle, coversSlot, planToggle } from "../lib/availability";
import {
  joinEvent,
  leaveEvent,
  hasJoined,
  type EventWithResponses,
} from "../lib/events";
import {
  applyDefaultWeek,
  hasDefaultWeek,
  saveDefaultWeek,
} from "../lib/settings";
import type { MyTeam } from "../lib/teams";
import {
  canEdit,
  friendlyError,
  positionLabel,
  roleLabel,
  type MemberWithProfile,
  type TeamSlot,
} from "../lib/types";
import type { WeekData } from "../lib/useWeekData";
import {
  dayShort,
  slotLabel,
  toDateKey,
  weekId,
  weekLock,
  type WeekDay,
} from "../lib/week";
import SessionsList from "./SessionsList";
import ShareWeekButton from "./ShareWeekButton";
import {
  Avatar,
  Button,
  DotRow,
  ErrorText,
  Spinner,
  WhoHover,
  useToast,
} from "./ui";

interface Props {
  team: MyTeam;
  userId: string;
  members: MemberWithProfile[];
  week: WeekData;
}

/** The player's week: "Planned this week" on top, then the slot buttons for each day. */
export default function PlayerWeek({ team, userId, members, week }: Props) {
  const {
    days,
    slots,
    hours,
    setHours,
    hoursRef,
    events,
    setEvents,
    loaded,
    error,
    setError,
  } = week;
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [hasUsual, setHasUsual] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    hasDefaultWeek(team.id, userId)
      .then((v) => {
        if (!cancelled) setHasUsual(v);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [team.id, userId]);

  const myHourCount = useMemo(
    () => days.reduce((n, d) => n + (hours[d.key]?.[userId]?.size ?? 0), 0),
    [days, hours, userId],
  );

  // Decide once per loaded week whether to show the "not answered" banner, so it does not
  // pop away under your finger on the first tap. It goes when you change week or come back.
  const weekKey = days[0].key;
  const [bannerFor, setBannerFor] = useState<string | null>(null);
  useEffect(() => {
    if (loaded) setBannerFor(myHourCount === 0 ? weekKey : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, weekKey]);

  async function toggle(day: WeekDay, slot: TeamSlot, daySlots: TeamSlot[]) {
    const key = `${day.key}:${slot.id}`;
    if (pending.has(key)) return;
    const before = hoursRef.current;
    const mine = before[day.key]?.[userId];
    const plan = planToggle(mine, slot, daySlots);

    // Optimistic: show the new state right away, roll back if the database says no.
    const next = new Set(mine ?? []);
    plan.add.forEach((h) => next.add(h));
    plan.remove.forEach((h) => next.delete(h));
    setHours({
      ...before,
      [day.key]: { ...(before[day.key] ?? {}), [userId]: next },
    });
    setPending((p) => new Set(p).add(key));
    try {
      await applyToggle(team.id, userId, day.key, plan);
      setError(null);
      toast(
        `Saved · ${dayShort[day.isoDay - 1]} ${slotLabel(slot.start_hour, slot.end_hour)}`,
      );
    } catch (err) {
      setHours(before);
      setError(friendlyError(err));
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(key);
        return n;
      });
    }
  }

  async function toggleJoin(event: EventWithResponses) {
    const previous = events;
    const joined = hasJoined(event, userId);
    setEvents((list) =>
      list.map((e) =>
        e.id === event.id
          ? {
              ...e,
              responses: joined
                ? e.responses.filter((r) => r.user_id !== userId)
                : [
                    ...e.responses.filter((r) => r.user_id !== userId),
                    { user_id: userId, status: "coming" as const },
                  ],
            }
          : e,
      ),
    );
    try {
      if (joined) await leaveEvent(event.id);
      else await joinEvent(event.id);
    } catch (err) {
      setEvents(previous);
      setError(friendlyError(err));
    }
  }

  async function fillUsual() {
    setBusy(true);
    try {
      const n = await applyDefaultWeek(team.id, toDateKey(week.monday));
      await week.reload();
      toast(
        n > 0
          ? `Filled in ${n} hour${n === 1 ? "" : "s"} from your usual week`
          : "Nothing new to add",
      );
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveUsual() {
    setBusy(true);
    try {
      const n = await saveDefaultWeek(team.id, toDateKey(week.monday));
      setHasUsual(n > 0);
      toast(n > 0 ? "Saved as your usual week" : "Usual week cleared");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const answered = useMemo(() => {
    const users = new Set<string>();
    for (const d of days)
      for (const uid of Object.keys(hours[d.key] ?? {})) users.add(uid);
    return users;
  }, [days, hours]);

  if (!slots) return <Spinner />;

  const lock = weekLock(week.monday);
  const showBanner = bannerFor === weekKey && !lock;
  const weekNo = weekId(week.monday).slice(-2).replace(/^0/, "");

  const usualButton = (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => void saveUsual()}
      disabled={busy || myHourCount === 0 || lock !== null}
      className="w-full lg:w-auto"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
        <path d="M17 21v-8H7v8M7 3v5h8" />
      </svg>
      Use as my usual week
    </Button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <ErrorText>{error}</ErrorText>

      {lock && (
        <div className="flex items-center gap-2.5 rounded-2xl bg-surface px-4 py-3 text-[13px] font-semibold text-muted shadow-card">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0"
          >
            <rect x="4" y="10" width="16" height="11" rx="2.5" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
          {lock === "past"
            ? "This week is done. You can look at it, but not change it."
            : "Too far ahead to plan. You can mark your time about three months out."}
        </div>
      )}

      {showBanner && (
        <div className="flex flex-col gap-3 rounded-2xl border-[1.5px] border-green bg-green-soft px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-0.5 text-green-ink">
            <div className="text-sm font-extrabold">
              You haven't answered for week {weekNo} yet
            </div>
            <div className="text-[13px]">
              {hasUsual
                ? "Tap the times you can, or start from your usual week and adjust."
                : "Tap the times you can play. You can pick more than one per day."}
            </div>
          </div>
          {hasUsual && (
            <Button
              size="sm"
              onClick={() => void fillUsual()}
              disabled={busy}
              className="h-[38px]"
            >
              Fill in my usual week
            </Button>
          )}
        </div>
      )}

      {/* Desktop: a 2x2 grid so the two rows line up exactly. Mobile: a plain stack. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:grid-rows-[auto_minmax(0,1fr)] lg:gap-x-6">
        <SessionsList
          events={events}
          types={week.types}
          members={members}
          userId={userId}
          onToggleJoin={(e) => void toggleJoin(e)}
          locked={lock !== null}
          hint={lock ? undefined : "tap to join or leave"}
        />

        <div className="hidden flex-col gap-2.5 rounded-[20px] bg-surface p-5 shadow-card lg:flex">
          <h2 className="text-[15px] font-extrabold">Saved as you go</h2>
          <p className="text-[13px] leading-relaxed text-muted">
            Every tap is saved right away. Nothing to submit.
          </p>
          <div className="mt-auto">{usualButton}</div>
        </div>

        {/* Desktop: 7 columns, with the hint pinned to the bottom of the card */}
        <div className="hidden min-h-0 flex-1 flex-col rounded-[20px] bg-surface p-5 shadow-card lg:flex">
          <h2 className="whitespace-nowrap text-[15px] font-extrabold mb-5">
            Select your availability
          </h2>
          <div className="grid min-h-0 flex-1 grid-cols-7 content-start gap-2.5 overflow-auto">
            {days.map((day) => {
              const daySlots = slots.filter(
                (s) => s.day_type === (day.isWeekend ? "weekend" : "weekday"),
              );
              return (
                <div key={day.key} className="flex min-w-0 flex-col gap-2">
                  <DayHeader day={day} />
                  {daySlots.length === 0 && (
                    <div className="rounded-xl border-[1.5px] border-dashed border-line-soft py-3 text-center text-[11px] text-faint">
                      no slots
                    </div>
                  )}
                  {daySlots.map((slot) => renderSlot(day, slot, daySlots))}
                </div>
              );
            })}
          </div>
          <p className="pt-4 text-[13px] text-muted">
            {lock
              ? "Looking back at what the week looked like."
              : "Tap the times you can play. You can pick more than one per day."}
          </p>
        </div>

        {/* Right column: Players, with the share bar locked to the bottom. */}
        <div className="hidden min-h-0 flex-col gap-4 lg:flex">
          <div className="flex min-h-0 flex-col gap-3.5 rounded-[20px] bg-surface p-5 shadow-card">
            <h2 className="text-[15px] font-extrabold">Players</h2>
            <ul className="flex min-h-0 flex-col gap-2.5 overflow-y-auto">
              {members.map((m) => (
                <li key={m.user_id} className="flex items-center gap-2.5">
                  <Avatar
                    name={m.profile?.display_name ?? "?"}
                    url={m.profile?.avatar_url}
                    size={30}
                  />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-bold">
                      {m.profile?.display_name ?? "Unknown"}
                    </span>
                    <span className="text-[11px] text-muted">
                      {m.position
                        ? positionLabel[m.position]
                        : roleLabel[m.role]}{" "}
                      ·{" "}
                      {m.user_id === userId
                        ? "you"
                        : answered.has(m.user_id)
                          ? "answered"
                          : "not answered"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          {canEdit(team.role) && (
            <ShareWeekButton team={team} className="mt-auto" />
          )}
        </div>
        {/* Mobile: one card per day */}
        <div className="flex flex-col gap-2.5 lg:hidden">
          {days.map((day) => {
            const daySlots = slots.filter(
              (s) => s.day_type === (day.isWeekend ? "weekend" : "weekday"),
            );
            return (
              <div
                key={day.key}
                className="flex items-center gap-2.5 rounded-2xl bg-surface py-3.5 pl-3.5 pr-3 shadow-card"
              >
                <div className="flex w-[46px] shrink-0 flex-col whitespace-nowrap">
                  <span
                    className={`text-[15px] font-extrabold ${day.isToday ? "text-green-ink" : ""}`}
                  >
                    {dayShort[day.isoDay - 1]}
                  </span>
                  <span className="text-xs text-muted">
                    {format(day.date, "d MMM")}
                  </span>
                </div>
                {daySlots.length === 0 ? (
                  <span className="text-sm text-faint">
                    No time slots for this day.
                  </span>
                ) : (
                  <div
                    className="grid flex-1 gap-2"
                    style={{
                      gridTemplateColumns: `repeat(${Math.min(daySlots.length, 3)}, minmax(0, 1fr))`,
                    }}
                  >
                    {daySlots.map((slot) =>
                      renderSlot(day, slot, daySlots, true),
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <p className="px-1 pt-1 text-[13px] text-muted">
            {lock
              ? "Looking back at what the week looked like."
              : "Tap the times you can play. You can pick more than one per day."}
          </p>
          <div className="pt-1">{usualButton}</div>
        </div>
      </div>
    </div>
  );

  function renderSlot(
    day: WeekDay,
    slot: TeamSlot,
    daySlots: TeamSlot[],
    compact = false,
  ) {
    const byUser = hours[day.key] ?? {};
    const on = coversSlot(byUser[userId], slot);
    const can = members.map((m) => coversSlot(byUser[m.user_id], slot));
    const isPending = pending.has(`${day.key}:${slot.id}`);
    return (
      <WhoHover
        key={slot.id}
        title={`${dayShort[day.isoDay - 1]} ${slotLabel(slot.start_hour, slot.end_hour)}`}
        people={members.map((m, i) => ({
          name: m.profile?.display_name ?? "?",
          url: m.profile?.avatar_url,
          free: can[i],
        }))}
      >
        <button
          key={slot.id}
          onClick={() => void toggle(day, slot, daySlots)}
          aria-pressed={on}
          disabled={isPending || lock !== null}
          className={`flex h-18 flex-col items-center justify-center gap-1 rounded-xl border-[1.5px] text-[13px] font-bold leading-none tracking-tight transition disabled:opacity-60 ${
            on
              ? "border-green bg-green-soft text-green-ink"
              : "border-line bg-surface text-ink hover:border-faint"
          } ${compact ? "whitespace-nowrap text-[11px]" : ""} ${lock ? "cursor-default opacity-60" : ""}`}
        >
          <span>{slotLabel(slot.start_hour, slot.end_hour)}</span>
          <DotRow can={can} dim={!on} />
        </button>
      </WhoHover>
    );
  }
}

function DayHeader({ day }: { day: WeekDay }) {
  return (
    <div className="flex flex-col items-center gap-0.5 pb-1">
      <span
        className={`text-xs font-bold ${day.isToday ? "text-green-ink" : "text-muted"}`}
      >
        {dayShort[day.isoDay - 1]}
      </span>
      {day.isToday ? (
        <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-ink text-[13px] font-extrabold text-on-ink">
          {format(day.date, "d")}
        </span>
      ) : (
        <span className="text-[15px] font-extrabold">
          {format(day.date, "d")}
        </span>
      )}
    </div>
  );
}
