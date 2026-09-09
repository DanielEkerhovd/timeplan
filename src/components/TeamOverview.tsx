import { useState, useMemo, type CSSProperties } from "react";
import { format } from "date-fns";
import { useAuth } from "../lib/auth";
import { coversSlot } from "../lib/availability";
import {
  clearDayOverride,
  dayIsOff,
  setDayOverride,
} from "../lib/closedDays";
import {
  eventPalette,
  eventTitle,
  type EventWithResponses,
} from "../lib/events";
import type { MyTeam } from "../lib/teams";
import { friendlyError, type MemberWithProfile } from "../lib/types";
import type { WeekData } from "../lib/useWeekData";
import {
  dayShort,
  toDateKey,
  weekLock,
  weekStart,
  type WeekDay,
} from "../lib/week";
import { useZone } from "../lib/zone";
import EventForm, { type EventDraft } from "./EventForm";
import SessionsList from "./SessionsList";
import ShareWeekButton from "./ShareWeekButton";
import { DotRow, ErrorText, Pill, Spinner, WhoHover } from "./ui";

interface Props {
  team: MyTeam;
  members: MemberWithProfile[];
  week: WeekData;
  /** Controlled from the page header so the desktop "New activity" button can open it too. */
  form: FormState;
  setForm: (f: FormState) => void;
}

export type FormState = {
  existing: EventWithResponses | null;
  draft: EventDraft;
} | null;

interface Cell {
  day: WeekDay;
  start: number;
  end: number;
  /** Who can the whole block, in members order. */
  can: boolean[];
  count: number;
  events: EventWithResponses[];
}

/** The owner/admin view: sessions on top, then who is free in every block, and booking. */
export default function TeamOverview({
  team,
  members,
  week,
  form,
  setForm,
}: Props) {
  const {
    days,
    slots,
    hours,
    events,
    error,
    reload,
    types,
    isOff,
    offWeekdays,
  } = week;
  const zone = useZone();
  const total = members.length;
  const { user } = useAuth();
  // Dagen du holder på å stenge eller åpne. Knappen venter, resten av uka gjør ikke det.
  const [busyDay, setBusyDay] = useState<string | null>(null);

  async function toggleDay(day: WeekDay) {
    if (busyDay || weekLock(week.monday) || !user) return;
    setBusyDay(day.key);
    try {
      const want = !isOff(day);
      // Havner vi på det malen sier likevel, er unntaket overflødig. Da fjerner vi
      // det, så dagen følger laget videre i stedet for å stå fast på et gammelt valg.
      const fromPattern = dayIsOff(
        day.key,
        day.isoDay,
        new Map(),
        offWeekdays,
        toDateKey(weekStart(new Date())),
      );
      if (want === fromPattern) await clearDayOverride(team.id, day.key);
      else await setDayOverride(team.id, day.key, user.id, want);
      await reload();
    } catch (err) {
      week.setError(friendlyError(err));
    } finally {
      setBusyDay(null);
    }
  }

  // Rows are every distinct interval across weekday and weekend slots, sorted by start.
  const rows = useMemo(() => {
    const seen = new Map<string, { start: number; end: number }>();
    for (const s of slots ?? [])
      seen.set(`${s.start_hour}-${s.end_hour}`, {
        start: s.start_hour,
        end: s.end_hour,
      });
    return [...seen.values()].sort(
      (a, b) => a.start - b.start || a.end - b.end,
    );
  }, [slots]);

  const grid = useMemo(() => {
    const out: (Cell | null)[][] = [];
    for (const row of rows) {
      const cells: (Cell | null)[] = [];
      for (const day of days) {
        // En stengt dag har ingen blokker å booke, uansett hva folk har krysset av.
        if (isOff(day)) {
          cells.push(null);
          continue;
        }
        const type = day.isWeekend ? "weekend" : "weekday";
        const exists = (slots ?? []).some(
          (s) =>
            s.day_type === type &&
            s.start_hour === row.start &&
            s.end_hour === row.end,
        );
        if (!exists) {
          cells.push(null);
          continue;
        }
        const byUser = hours[day.key] ?? {};
        const can = members.map((m) =>
          coversSlot(byUser[m.user_id], {
            start_hour: row.start,
            end_hour: row.end,
          }),
        );
        cells.push({
          day,
          start: row.start,
          end: row.end,
          can,
          count: can.filter(Boolean).length,
          events: events.filter(
            (e) =>
              e.date === day.key &&
              e.start_hour < row.end &&
              e.end_hour > row.start,
          ),
        });
      }
      out.push(cells);
    }
    return out;
  }, [rows, days, slots, hours, events, members, isOff]);

  const everyoneCan = useMemo(
    () =>
      grid
        .flat()
        .filter(
          (c): c is Cell =>
            c !== null &&
            total > 0 &&
            c.count === total &&
            c.events.length === 0,
        ),
    [grid, total],
  );

  function openNew(cell: Cell) {
    if (lock) return;
    setForm({
      existing: null,
      draft: { date: cell.day.key, start_hour: cell.start, end_hour: cell.end },
    });
  }
  function openExisting(e: EventWithResponses) {
    if (lock) return;
    setForm({
      existing: e,
      draft: { date: e.date, start_hour: e.start_hour, end_hour: e.end_hour },
    });
  }

  const lock = weekLock(week.monday);

  if (!slots) return <Spinner />;

  const cellStyle = (c: Cell): CSSProperties => {
    const all = total > 0 && c.count === total;
    const nearly = total > 1 && c.count === total - 1;
    return {
      background: all
        ? "var(--color-cell-all)"
        : nearly
          ? "var(--color-cell-nearly)"
          : "var(--color-cell-few)",
      border: all
        ? "1.5px solid var(--color-green)"
        : "1.5px solid transparent",
    };
  };

  const marker = (c: Cell, side: "top" | "left") => {
    if (c.events.length === 0) return null;
    const style: CSSProperties =
      side === "top"
        ? {
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            display: "flex",
          }
        : {
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width: 3,
            display: "flex",
            flexDirection: "column",
          };
    return (
      <div style={style}>
        {c.events.map((e) => (
          <div
            key={e.id}
            style={{ flex: 1, background: eventPalette(e, types).accent }}
          />
        ))}
      </div>
    );
  };

  const markerLabel = (c: Cell) => {
    if (c.events.length === 0) return null;
    const text =
      c.events.length === 1
        ? eventTitle(c.events[0], types)
        : `${c.events.length} activities`;
    const color =
      c.events.length === 1
        ? eventPalette(c.events[0], types).ink
        : "var(--color-muted)";
    return (
      <div className="truncate text-[9.5px] font-extrabold" style={{ color }}>
        {text}
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:gap-6">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
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
              ? "This week is done. You can look at it, but not book or change anything."
              : "Too far ahead to book. You can plan about three months out."}
          </div>
        )}

        <SessionsList
          events={events}
          types={types}
          members={members}
          locked={lock !== null}
          onEdit={lock ? undefined : openExisting}
          hint={lock ? undefined : "click a block below to add one"}
        />

        {/* Desktop grid */}
        <div className="hidden min-h-0 flex-1 flex-col rounded-[20px] bg-surface p-5 shadow-card lg:flex">
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: "100px repeat(7, minmax(0, 1fr))" }}
            >
              <div />
              {days.map((d) => {
                const off = isOff(d);
                return (
                  <div
                    key={d.key}
                    className="group flex flex-col items-center gap-0.5 pb-1.5"
                  >
                    <span
                      className={`text-xs font-bold ${d.isToday && !off ? "text-green-ink" : "text-muted"} ${off ? "opacity-55" : ""}`}
                    >
                      {dayShort[d.isoDay - 1]}
                    </span>
                    {/* Samme boks hver dag, ellers dytter ringen rundt i dag raden ned. */}
                    <span
                      className={`flex h-[26px] min-w-[26px] items-center justify-center rounded-full px-1 font-extrabold ${
                        d.isToday && !off
                          ? "bg-ink text-[13px] text-on-ink"
                          : "text-sm"
                      } ${off ? "opacity-55" : ""}`}
                    >
                      {format(d.date, "d")}
                    </span>
                    {/* Plassen står der hele tiden, så rutenettet ikke hopper når pillen
                        dukker opp. Den vises når du peker på dagen, eller tabber deg dit. */}
                    {!lock && (
                      <button
                        type="button"
                        onClick={() => void toggleDay(d)}
                        disabled={busyDay !== null}
                        aria-pressed={off}
                        className={`mt-1 h-[22px] whitespace-nowrap rounded-full border-[1.5px] px-2.5 text-[11px] font-bold opacity-0 transition focus-visible:opacity-100 disabled:opacity-50 group-hover:opacity-100 ${
                          // Er dagen alt avlyst, står kolonnen grå. Da skal veien tilbake
                          // være det tydeligste i den kolonnen, ikke enda et blekt element.
                          off
                            ? "border-ink bg-ink text-on-ink"
                            : "border-line bg-surface text-muted hover:border-faint hover:text-ink"
                        }`}
                      >
                        {off ? "Open day" : "Cancel day"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {rows.map((row, ri) => (
              <div
                key={`${row.start}-${row.end}`}
                className="grid gap-2"
                style={{
                  gridTemplateColumns: "100px repeat(7, minmax(0, 1fr))",
                }}
              >
                <div className="flex items-center text-xs font-bold text-muted">
                  {zone.label(row.start, row.end)}
                </div>
                {grid[ri].map((c, ci) =>
                  c === null ? (
                    <div
                      key={ci}
                      className="h-[78px] rounded-xl border-[1.5px] border-dashed border-line-soft"
                    />
                  ) : (
                    <WhoHover
                      key={ci}
                      title={`${dayShort[c.day.isoDay - 1]} ${zone.label(c.start, c.end, c.day.isoDay)}`}
                      people={members.map((m, i) => ({
                        name: m.profile?.display_name ?? "?",
                        url: m.profile?.avatar_url,
                        free: c.can[i],
                      }))}
                    >
                      <button
                        onClick={() => openNew(c)}
                        className={`relative flex h-[78px] flex-col justify-between overflow-hidden rounded-xl px-3 pb-2.5 pt-2.5 text-left transition ${lock ? "cursor-default" : "hover:brightness-[0.96] hover:ring-2 hover:ring-inset hover:ring-ink/15"}`}
                        style={cellStyle(c)}
                      >
                        {marker(c, "top")}
                        <div
                          className="text-[15px] font-extrabold leading-none"
                          style={{
                            color:
                              c.count === total && total > 0
                                ? "var(--color-green-ink)"
                                : "var(--color-ink)",
                          }}
                        >
                          {c.count}
                          <span
                            className="text-xs font-semibold"
                            style={{
                              color:
                                c.count === total && total > 0
                                  ? "var(--color-green-dim)"
                                  : "var(--color-faint)",
                            }}
                          >
                            /{total}
                          </span>
                        </div>
                        {markerLabel(c)}
                        <DotRow can={c.can} size={9} />
                      </button>
                    </WhoHover>
                  ),
                )}
              </div>
            ))}
          </div>
          <div className="mt-3 flex shrink-0 items-center gap-[18px] border-t border-line px-1 pt-3 text-xs text-muted">
            <Legend
              swatch="var(--color-cell-all)"
              border="var(--color-green)"
              label="Everyone can"
            />
            <Legend swatch="var(--color-cell-nearly)" label="All but one" />
            <Legend swatch="var(--color-cell-few)" label="Fewer" />
            <span className="ml-auto text-faint">
              {lock
                ? "This week is closed for booking"
                : "Click a block to book it"}
            </span>
          </div>
        </div>

        {/* Mobile list */}
        <div className="flex flex-col gap-2.5 lg:hidden">
          {days.map((day, di) => {
            const cells = grid
              .map((r) => r[di])
              .filter((c): c is Cell => c !== null);
            return (
              <div
                key={day.key}
                className="flex flex-col gap-2 rounded-2xl bg-surface p-3.5 shadow-card"
              >
                <div className="flex items-baseline gap-2 px-0.5">
                  <span
                    className={`text-[15px] font-extrabold ${day.isToday && !isOff(day) ? "text-green-ink" : ""}`}
                  >
                    {dayShort[day.isoDay - 1]}
                  </span>
                  <span className="text-xs text-muted">
                    {format(day.date, "d MMM")}
                  </span>
                  {!lock && (
                    <button
                      type="button"
                      onClick={() => void toggleDay(day)}
                      disabled={busyDay !== null}
                      aria-pressed={isOff(day)}
                      className="ml-auto h-[24px] whitespace-nowrap rounded-full border-[1.5px] border-line px-2.5 text-[11px] font-bold text-muted disabled:opacity-50"
                    >
                      {isOff(day) ? "Open day" : "Cancel day"}
                    </button>
                  )}
                </div>
                {isOff(day) ? (
                  <div className="text-[13px] font-bold text-faint">
                    Off this week.
                  </div>
                ) : (
                  cells.length === 0 && (
                    <div className="text-[13px] text-faint">No time slots.</div>
                  )
                )}
                {cells.map((c) => (
                  <button
                    key={c.start}
                    onClick={() => openNew(c)}
                    className={`relative flex items-center gap-3 overflow-hidden rounded-xl px-3.5 py-2.5 text-left ${lock ? "cursor-default" : ""}`}
                    style={cellStyle(c)}
                  >
                    {marker(c, "left")}
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="text-[13px] font-bold">
                        {zone.label(c.start, c.end, c.day.isoDay)}
                      </div>
                      {markerLabel(c)}
                    </div>
                    <DotRow can={c.can} size={8} />
                    <div
                      className="w-8 text-right text-sm font-extrabold"
                      style={{
                        color:
                          c.count === total && total > 0
                            ? "var(--color-green-ink)"
                            : "var(--color-ink)",
                      }}
                    >
                      {c.count}
                      <span className="text-[11px] font-semibold text-faint">
                        /{total}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Desktop aside */}
      <aside className="hidden w-[300px] shrink-0 flex-col gap-4 lg:flex lg:min-h-0">
        <div className="flex min-h-0 flex-1 flex-col gap-3.5 rounded-[20px] bg-surface p-5 shadow-card">
          <h2 className="text-[15px] font-extrabold">Everyone can</h2>
          {everyoneCan.length === 0 ? (
            <p className="text-[13px] leading-relaxed text-muted">
              {total === 0
                ? "No members yet."
                : "No block this week where everyone is free and nothing is booked."}
            </p>
          ) : (
            <div className="-mr-1.5 flex min-h-0 flex-col gap-2 overflow-y-auto pr-1.5">
              {everyoneCan.map((c) => (
                <div
                  key={`${c.day.key}:${c.start}`}
                  className="flex shrink-0 items-center justify-between rounded-xl bg-bg px-3.5 py-3"
                >
                  <div className="flex flex-col gap-px">
                    <div className="text-sm font-bold">
                      {dayShort[c.day.isoDay - 1]} {zone.label(c.start, c.end, c.day.isoDay)}
                    </div>
                    <div className="text-xs text-muted">
                      {c.count} of {total}
                    </div>
                  </div>
                  {!lock && (
                    <Pill active onClick={() => openNew(c)}>
                      Book
                    </Pill>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Locked to the bottom of the column, whatever the list above does. */}
        <ShareWeekButton team={team} className="mt-auto" />
      </aside>

      {form && (
        <EventForm
          teamId={team.id}
          types={
            // An archived type stays selectable while editing the booking that uses it.
            form.existing?.type_id &&
            !week.activeTypes.some((t) => t.id === form.existing?.type_id)
              ? [
                  ...week.activeTypes,
                  ...types.filter((t) => t.id === form.existing?.type_id),
                ]
              : week.activeTypes
          }
          events={events}
          existing={form.existing}
          draft={form.draft}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}

function Legend({
  swatch,
  border,
  label,
}: {
  swatch: string;
  border?: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="h-3 w-3 rounded"
        style={{
          background: swatch,
          border: border ? `1.5px solid ${border}` : undefined,
          boxSizing: "border-box",
        }}
      />
      <span>{label}</span>
    </div>
  );
}
