import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { applyToggle, coversSlot, planToggle } from "../lib/availability";
import {
  joinEvent,
  leaveEvent,
  hasJoined,
  type EventWithResponses,
} from "../lib/events";
import {
  defaultWeekHours,
  replaceWithDefaultWeek,
  roleName,
} from "../lib/settings";
import type { MyTeam } from "../lib/teams";
import {
  canEdit,
  friendlyError,
  roleLabel,
  type MemberWithProfile,
  type TeamSlot,
} from "../lib/types";
import type { WeekData } from "../lib/useWeekData";
import { useZone } from "../lib/zone";
import {
  dayShort,
  toDateKey,
  weekId,
  weekLock,
  type WeekDay,
} from "../lib/week";
import SessionsList from "./SessionsList";
import WeekOptions from "./WeekOptions";
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

/** The member's week: "Planned this week" on top, then the slot buttons for each day. */
export default function PlayerWeek({ team, userId, members, week }: Props) {
  const roles = week.roles;
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
    isOff,
  } = week;
  const zone = useZone();
  // Lagringer som er underveis. Ref-en er fasit i klikkhåndteringen, så et raskt
  // andretrykk ikke leser en gammel render.
  const pendingRef = useRef<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());
  // Trykk som kom mens forrige lagring var underveis, og som skal kjøres etterpå.
  const queued = useRef(new Map<string, () => void>());
  // Timer i malen di. Brukes både i det grønne feltet og i options-stripa.
  const [templateHours, setTemplateHours] = useState<number | null>(null);
  const hasTemplate = templateHours !== null && templateHours > 0;
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    defaultWeekHours(team.id, userId)
      .then((n) => {
        if (!cancelled) setTemplateHours(n);
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

  // Det grønne feltet følger uka: det er der så lenge du ikke har svart, glir bort
  // ved første trykk og kommer tilbake om du tømmer uka igjen. Ingen egen tilstand
  // å holde styr på — det er bare timene dine, sett fra en annen kant.

  async function toggle(day: WeekDay, slot: TeamSlot, daySlots: TeamSlot[]) {
    const key = `${day.key}:${slot.id}`;
    // Trykker du igjen mens forrige lagring pågår, husker vi trykket i stedet for å
    // spise det, og kjører det så snart svaret er tilbake.
    if (pendingRef.current.has(key)) {
      queued.current.set(key, () => void toggle(day, slot, daySlots));
      return;
    }
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
    pendingRef.current.add(key);
    setPending((p) => new Set(p).add(key));
    try {
      await applyToggle(team.id, userId, day.key, plan);
      setError(null);
      toast(
        `Saved · ${dayShort[day.isoDay - 1]} ${zone.label(slot.start_hour, slot.end_hour, day.isoDay)}`,
      );
    } catch (err) {
      setHours(before);
      setError(friendlyError(err));
    } finally {
      pendingRef.current.delete(key);
      setPending((p) => {
        const n = new Set(p);
        n.delete(key);
        return n;
      });
      const next = queued.current.get(key);
      if (next) {
        queued.current.delete(key);
        next();
      }
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

  async function fillFromTemplate() {
    setBusy(true);
    try {
      const n = await replaceWithDefaultWeek(team.id, toDateKey(week.monday));
      await week.reload();
      toast(
        n > 0
          ? `Filled in ${n} hour${n === 1 ? "" : "s"} from your template`
          : "Nothing to fill in",
      );
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
  const showBanner = !lock && loaded && myHourCount === 0;
  const weekNo = weekId(week.monday).slice(-2).replace(/^0/, "");

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

      {/* Alltid montert, så det kan gli begge veier. Sammenslått tar det ingen plass,
          og -mb-4 spiser mellomrommet det ellers ville lagt igjen i kolonnen. */}
      <div
        className={`grid transition-all duration-200 ease-out ${
          showBanner
            ? "grid-rows-[1fr] opacity-100"
            : "-mb-4 grid-rows-[0fr] opacity-0"
        }`}
        aria-hidden={!showBanner}
      >
        <div className="overflow-hidden">
          <div className="flex flex-col gap-3 rounded-2xl border-[1.5px] border-green bg-green-soft px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-0.5 text-green-ink">
              <div className="text-sm font-extrabold">
                You haven't answered for week {weekNo} yet
              </div>
              <div className="text-[13px]">
                {hasTemplate
                  ? "Tap the times you can, or start from your template and adjust."
                  : "Tap the times you can play. You can pick more than one per day."}
              </div>
            </div>
            {hasTemplate && (
              <Button
                size="sm"
                onClick={() => void fillFromTemplate()}
                disabled={busy || !showBanner}
                className="h-[38px]"
              >
                Use my template
              </Button>
            )}
          </div>
        </div>
      </div>

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

        {/* Desktop: 7 kolonner. Options-stripa står nederst i kortet. */}
        <div className="hidden min-h-0 flex-1 flex-col rounded-[20px] bg-surface p-5 shadow-card lg:col-start-1 lg:row-start-2 lg:flex">
          <div className="mb-4 flex flex-col gap-0.5">
            <h2 className="whitespace-nowrap text-[15px] font-extrabold">
              Select your availability
            </h2>
            <p className="text-[13px] text-muted">
              {lock
                ? "Looking back at what the week looked like."
                : "Tap the times you can play. You can pick more than one per day."}
            </p>
          </div>
          {/* Rutenettet ligger midt i kortet så lenge det er plass. Blir det høyere enn
              kortet, blir auto-margene null av seg selv: da står det fast i toppen og
              scroller. (justify-center ville kuttet toppen bort når det renner over.) */}
          <div className="flex min-h-0 flex-1 overflow-y-auto">
            {/* Uke og helg har hver sin plan, og gjerne ulikt antall bolker. De står
                ved siden av hverandre med en strek imellom, og høyden holdes inne i
                hver gruppe — så en fridag fyller akkurat sin egen gruppe. */}
            <div className="my-auto flex w-full items-start gap-3">
              {[days.slice(0, 5), days.slice(5)].map((group, gi) => (
                <Fragment key={gi}>
                  {gi === 1 && (
                    <div className="w-px shrink-0 self-stretch bg-line" />
                  )}
                  <div
                    className="grid min-w-0 gap-2.5"
                    style={{
                      flex: `${group.length} 1 0%`,
                      gridTemplateColumns: `repeat(${group.length}, minmax(0, 1fr))`,
                    }}
                  >
                    {group.map((day) => {
                      const daySlots = slots.filter(
                        (s) =>
                          s.day_type ===
                          (day.isWeekend ? "weekend" : "weekday"),
                      );
                      const off = isOff(day);
                      return (
                        <div
                          key={day.key}
                          className="flex min-w-0 flex-col gap-2"
                        >
                          <DayHeader day={day} off={off} />
                          {off ? (
                            <OffBlock />
                          ) : (
                            <>
                              {daySlots.length === 0 && (
                                <div className="rounded-xl border-[1.5px] border-dashed border-line-soft py-3 text-center text-[11px] text-faint">
                                  no slots
                                </div>
                              )}
                              {daySlots.map((slot) =>
                                renderSlot(day, slot, daySlots),
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Fragment>
              ))}
            </div>
          </div>
          {!lock && (
            <div className="pt-4">
              <WeekOptions
                teamId={team.id}
                mondayKey={toDateKey(week.monday)}
                myHours={myHourCount}
                template={templateHours ?? 0}
                onTemplate={setTemplateHours}
                onChanged={week.reload}
                onToast={toast}
                onError={setError}
              />
            </div>
          )}
        </div>

        {/* Right column: Members, with the share bar locked to the bottom. */}
        <div className="hidden min-h-0 flex-col gap-4 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:flex">
          <div className="flex min-h-0 flex-1 flex-col gap-3.5 rounded-[20px] bg-surface p-5 shadow-card">
            <h2 className="text-[15px] font-extrabold">Members</h2>
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
                      {roleName(m, roles) ?? roleLabel[m.role]} ·{" "}
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
          <p className="px-1 text-[13px] text-muted">
            {lock
              ? "Looking back at what the week looked like."
              : "Tap the times you can play. You can pick more than one per day."}
          </p>
          {days.map((day) => {
            const daySlots = slots.filter(
              (s) => s.day_type === (day.isWeekend ? "weekend" : "weekday"),
            );
            const off = isOff(day);
            return (
              <div
                key={day.key}
                className={`flex items-center gap-2.5 rounded-2xl bg-surface py-3.5 pl-3.5 pr-3 shadow-card ${off ? "opacity-55" : ""}`}
              >
                <div className="flex w-[46px] shrink-0 flex-col whitespace-nowrap">
                  <span
                    className={`text-[15px] font-extrabold ${day.isToday && !off ? "text-green-ink" : ""}`}
                  >
                    {dayShort[day.isoDay - 1]}
                  </span>
                  <span className="text-xs text-muted">
                    {format(day.date, "d MMM")}
                  </span>
                </div>
                {off ? (
                  <span className="text-sm font-bold text-faint">Day off</span>
                ) : daySlots.length === 0 ? (
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
          {!lock && (
            <div className="px-1 pt-1">
              <WeekOptions
                teamId={team.id}
                mondayKey={toDateKey(week.monday)}
                myHours={myHourCount}
                template={templateHours ?? 0}
                onTemplate={setTemplateHours}
                onChanged={week.reload}
                onToast={toast}
                onError={setError}
              />
            </div>
          )}
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
    // Ikke i bruk til å låse knappen lenger; se toggle().
    const isPending = pending.has(`${day.key}:${slot.id}`);
    return (
      <WhoHover
        key={slot.id}
        title={`${dayShort[day.isoDay - 1]} ${zone.label(slot.start_hour, slot.end_hour, day.isoDay)}`}
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
          disabled={lock !== null}
          data-saving={isPending || undefined}
          className={`flex h-18 flex-col items-center justify-center gap-1 rounded-xl border-[1.5px] text-[13px] font-bold leading-none tracking-tight transition disabled:opacity-60 ${
            on
              ? "border-green bg-green-soft text-green-ink"
              : "border-line bg-surface text-ink hover:border-faint"
          } ${compact ? "whitespace-nowrap text-[11px]" : ""} ${lock ? "cursor-default opacity-60" : ""}`}
        >
          <span>{zone.label(slot.start_hour, slot.end_hour, day.isoDay)}</span>
          <DotRow can={can} dim={!on} />
        </button>
      </WhoHover>
    );
  }
}

/** En dag laget har tatt fri. Timene ligger der fortsatt, de er bare ikke i veien. */
function OffBlock() {
  return (
    <div className="flex flex-1 items-center justify-center rounded-xl border-[1.5px] border-dashed border-line-soft text-[12px] font-bold text-faint">
      Day off
    </div>
  );
}

function DayHeader({ day, off = false }: { day: WeekDay; off?: boolean }) {
  return (
    <div
      className={`flex flex-col items-center gap-0.5 pb-1 ${off ? "opacity-55" : ""}`}
    >
      <span
        className={`text-xs font-bold ${day.isToday && !off ? "text-green-ink" : "text-muted"}`}
      >
        {dayShort[day.isoDay - 1]}
      </span>
      {/* Samme boks hver dag, ellers dytter ringen rundt dagens dato kolonnen ned. */}
      <span
        className={`flex h-[26px] min-w-[26px] items-center justify-center rounded-full px-1 font-extrabold ${
          day.isToday && !off ? "bg-ink text-[13px] text-on-ink" : "text-[15px]"
        }`}
      >
        {format(day.date, "d")}
      </span>
    </div>
  );
}
