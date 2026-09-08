import { useMemo, type CSSProperties } from 'react'
import { format } from 'date-fns'
import { coversSlot } from '../lib/availability'
import { eventPalette, eventTitle, type EventWithResponses } from '../lib/events'
import type { MyTeam } from '../lib/teams'
import type { MemberWithProfile } from '../lib/types'
import type { WeekData } from '../lib/useWeekData'
import { dayShort, slotLabel, type WeekDay } from '../lib/week'
import EventForm, { type EventDraft } from './EventForm'
import SessionsList from './SessionsList'
import { DotRow, ErrorText, Pill, Spinner } from './ui'

interface Props {
  team: MyTeam
  members: MemberWithProfile[]
  week: WeekData
  /** Controlled from the page header so the desktop "New activity" button can open it too. */
  form: FormState
  setForm: (f: FormState) => void
}

export type FormState = { existing: EventWithResponses | null; draft: EventDraft } | null

interface Cell {
  day: WeekDay
  start: number
  end: number
  /** Who can the whole block, in members order. */
  can: boolean[]
  count: number
  events: EventWithResponses[]
}

/** The owner/coach view: sessions on top, then who is free in every block, and booking. */
export default function TeamOverview({ team, members, week, form, setForm }: Props) {
  const { days, slots, hours, events, loaded, error, reload, types } = week
  const total = members.length

  // Rows are every distinct interval across weekday and weekend slots, sorted by start.
  const rows = useMemo(() => {
    const seen = new Map<string, { start: number; end: number }>()
    for (const s of slots ?? []) seen.set(`${s.start_hour}-${s.end_hour}`, { start: s.start_hour, end: s.end_hour })
    return [...seen.values()].sort((a, b) => a.start - b.start || a.end - b.end)
  }, [slots])

  const grid = useMemo(() => {
    const out: (Cell | null)[][] = []
    for (const row of rows) {
      const cells: (Cell | null)[] = []
      for (const day of days) {
        const type = day.isWeekend ? 'weekend' : 'weekday'
        const exists = (slots ?? []).some((s) => s.day_type === type && s.start_hour === row.start && s.end_hour === row.end)
        if (!exists) {
          cells.push(null)
          continue
        }
        const byUser = hours[day.key] ?? {}
        const can = members.map((m) => coversSlot(byUser[m.user_id], { start_hour: row.start, end_hour: row.end }))
        cells.push({
          day,
          start: row.start,
          end: row.end,
          can,
          count: can.filter(Boolean).length,
          events: events.filter((e) => e.date === day.key && e.start_hour < row.end && e.end_hour > row.start),
        })
      }
      out.push(cells)
    }
    return out
  }, [rows, days, slots, hours, events, members])

  const everyoneCan = useMemo(
    () => grid.flat().filter((c): c is Cell => c !== null && total > 0 && c.count === total && c.events.length === 0),
    [grid, total],
  )

  function openNew(cell: Cell) {
    setForm({ existing: null, draft: { date: cell.day.key, start_hour: cell.start, end_hour: cell.end } })
  }
  function openExisting(e: EventWithResponses) {
    setForm({ existing: e, draft: { date: e.date, start_hour: e.start_hour, end_hour: e.end_hour } })
  }

  if (!slots || !loaded) return <Spinner />

  const cellStyle = (c: Cell): CSSProperties => {
    const all = total > 0 && c.count === total
    const nearly = total > 1 && c.count === total - 1
    return {
      background: all ? '#DCEFE0' : nearly ? '#EAF4EC' : '#F6F5F2',
      border: all ? '1.5px solid #3E9A63' : '1.5px solid transparent',
    }
  }

  const marker = (c: Cell, side: 'top' | 'left') => {
    if (c.events.length === 0) return null
    const style: CSSProperties =
      side === 'top' ? { position: 'absolute', top: 0, left: 0, right: 0, height: 3, display: 'flex' } : { position: 'absolute', top: 0, bottom: 0, left: 0, width: 3, display: 'flex', flexDirection: 'column' }
    return (
      <div style={style}>
        {c.events.map((e) => (
          <div key={e.id} style={{ flex: 1, background: eventPalette(e, types).accent }} />
        ))}
      </div>
    )
  }

  const markerLabel = (c: Cell) => {
    if (c.events.length === 0) return null
    const text = c.events.length === 1 ? eventTitle(c.events[0], types) : `${c.events.length} activities`
    const color = c.events.length === 1 ? eventPalette(c.events[0], types).ink : '#7A7368'
    return (
      <div className="truncate text-[9.5px] font-extrabold" style={{ color }}>
        {text}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:gap-6">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
        <ErrorText>{error}</ErrorText>

        <SessionsList events={events} types={types} members={members} onEdit={openExisting} hint="click a block below to add one" />

        {/* Desktop grid */}
        <div className="hidden min-h-0 flex-1 flex-col gap-2 overflow-auto rounded-[20px] bg-surface p-5 shadow-card lg:flex">
          <div className="grid gap-2" style={{ gridTemplateColumns: '100px repeat(7, minmax(0, 1fr))' }}>
            <div />
            {days.map((d) => (
              <div key={d.key} className="flex flex-col items-center gap-0.5 pb-1.5">
                <span className={`text-xs font-bold ${d.isToday ? 'text-green-ink' : 'text-muted'}`}>{dayShort[d.isoDay - 1]}</span>
                {d.isToday ? (
                  <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-ink text-[13px] font-extrabold text-white">{format(d.date, 'd')}</span>
                ) : (
                  <span className="text-sm font-extrabold">{format(d.date, 'd')}</span>
                )}
              </div>
            ))}
          </div>
          {rows.map((row, ri) => (
            <div key={`${row.start}-${row.end}`} className="grid gap-2" style={{ gridTemplateColumns: '100px repeat(7, minmax(0, 1fr))' }}>
              <div className="flex items-center text-xs font-bold text-muted">{slotLabel(row.start, row.end)}</div>
              {grid[ri].map((c, ci) =>
                c === null ? (
                  <div key={ci} className="h-[78px] rounded-xl border-[1.5px] border-dashed border-[#eceae5]" />
                ) : (
                  <button
                    key={ci}
                    onClick={() => openNew(c)}
                    title={`Book ${dayShort[c.day.isoDay - 1]} ${slotLabel(c.start, c.end)}`}
                    className="relative flex h-[78px] flex-col justify-between overflow-hidden rounded-xl px-3 pb-2.5 pt-2.5 text-left transition hover:brightness-[0.96] hover:ring-2 hover:ring-inset hover:ring-ink/10"
                    style={cellStyle(c)}
                  >
                    {marker(c, 'top')}
                    <div className="text-[15px] font-extrabold leading-none" style={{ color: c.count === total && total > 0 ? '#2F6B45' : '#1C1B19' }}>
                      {c.count}
                      <span className="text-xs font-semibold" style={{ color: c.count === total && total > 0 ? '#7FA88F' : '#9A9690' }}>
                        /{total}
                      </span>
                    </div>
                    {markerLabel(c)}
                    <DotRow can={c.can} size={9} />
                  </button>
                ),
              )}
            </div>
          ))}
          <div className="flex items-center gap-[18px] px-1 pt-2.5 text-xs text-muted">
            <Legend swatch="#DCEFE0" border="#3E9A63" label="Everyone can" />
            <Legend swatch="#EAF4EC" label="All but one" />
            <Legend swatch="#F6F5F2" label="Fewer" />
            <span className="ml-auto text-faint">Click a block to book it</span>
          </div>
        </div>

        {/* Mobile list */}
        <div className="flex flex-col gap-2.5 lg:hidden">
          {days.map((day, di) => {
            const cells = grid.map((r) => r[di]).filter((c): c is Cell => c !== null)
            return (
              <div key={day.key} className="flex flex-col gap-2 rounded-2xl bg-surface p-3.5 shadow-card">
                <div className="flex items-baseline gap-2 px-0.5">
                  <span className={`text-[15px] font-extrabold ${day.isToday ? 'text-green-ink' : ''}`}>{dayShort[day.isoDay - 1]}</span>
                  <span className="text-xs text-muted">{format(day.date, 'd MMM')}</span>
                </div>
                {cells.length === 0 && <div className="text-[13px] text-faint">No time slots.</div>}
                {cells.map((c) => (
                  <button
                    key={c.start}
                    onClick={() => openNew(c)}
                    className="relative flex items-center gap-3 overflow-hidden rounded-xl px-3.5 py-2.5 text-left"
                    style={cellStyle(c)}
                  >
                    {marker(c, 'left')}
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="text-[13px] font-bold">{slotLabel(c.start, c.end)}</div>
                      {markerLabel(c)}
                    </div>
                    <DotRow can={c.can} size={8} />
                    <div className="w-8 text-right text-sm font-extrabold" style={{ color: c.count === total && total > 0 ? '#2F6B45' : '#1C1B19' }}>
                      {c.count}
                      <span className="text-[11px] font-semibold text-faint">/{total}</span>
                    </div>
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      </div>

      {/* Desktop aside */}
      <aside className="hidden w-[300px] shrink-0 flex-col gap-4 lg:flex lg:min-h-0">
        <div className="flex min-h-0 flex-col gap-3.5 rounded-[20px] bg-surface p-5 shadow-card">
          <h2 className="text-[15px] font-extrabold">Everyone can</h2>
          {everyoneCan.length === 0 ? (
            <p className="text-[13px] leading-relaxed text-muted">
              {total === 0 ? 'No players yet.' : 'No block this week where everyone is free and nothing is booked.'}
            </p>
          ) : (
            <div className="-mr-1.5 flex min-h-0 flex-col gap-2 overflow-y-auto pr-1.5">
              {everyoneCan.map((c) => (
                <div key={`${c.day.key}:${c.start}`} className="flex shrink-0 items-center justify-between rounded-xl bg-bg px-3.5 py-3">
                  <div className="flex flex-col gap-px">
                    <div className="text-sm font-bold">
                      {dayShort[c.day.isoDay - 1]} {slotLabel(c.start, c.end)}
                    </div>
                    <div className="text-xs text-muted">
                      {c.count} of {total}
                    </div>
                  </div>
                  <Pill active onClick={() => openNew(c)}>
                    Book
                  </Pill>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      {form && (
        <EventForm
          teamId={team.id}
          types={
            // An archived type stays selectable while editing the booking that uses it.
            form.existing?.type_id && !week.activeTypes.some((t) => t.id === form.existing?.type_id)
              ? [...week.activeTypes, ...types.filter((t) => t.id === form.existing?.type_id)]
              : week.activeTypes
          }
          events={events}
          existing={form.existing}
          draft={form.draft}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null)
            void reload()
          }}
        />
      )}
    </div>
  )
}

function Legend({ swatch, border, label }: { swatch: string; border?: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-3 w-3 rounded" style={{ background: swatch, border: border ? `1.5px solid ${border}` : undefined, boxSizing: 'border-box' }} />
      <span>{label}</span>
    </div>
  )
}
