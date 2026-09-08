import { format } from 'date-fns'
import { coversSlot } from '../lib/availability'
import { eventTypeLabel, type EventWithResponses } from '../lib/events'
import type { Profile, ResponseStatus, TeamSlot } from '../lib/types'
import { dayShort, slotLabel, type WeekDay } from '../lib/week'

interface Props {
  day: WeekDay
  slots: TeamSlot[]
  /** Hours the signed-in user has marked free on this day. */
  mine: Set<number> | undefined
  /** For each slot (same order as `slots`): how many teammates can the whole block. */
  counts: number[]
  total: number
  pending: Set<string>
  events: EventWithResponses[]
  userId: string
  members: { user_id: string; profile: Profile | null }[]
  onToggle: (slot: TeamSlot) => void
  onRespond: (event: EventWithResponses, status: ResponseStatus) => void
}

export default function DayCard({ day, slots, mine, counts, total, pending, events, userId, onToggle, onRespond }: Props) {
  const columns = Math.min(Math.max(slots.length, 1), 3)
  return (
    <div className="flex flex-col gap-3 rounded-card bg-surface py-3.5 pl-4 pr-3.5 shadow-card">
      <div className="flex items-center gap-3">
        <div className="flex w-[52px] shrink-0 flex-col whitespace-nowrap">
          <span className={`text-[15px] font-extrabold ${day.isToday ? 'text-green-ink' : ''}`}>{dayShort[day.isoDay - 1]}</span>
          <span className="text-xs text-muted">{format(day.date, 'd MMM')}</span>
        </div>
        {slots.length === 0 ? (
          <span className="text-sm text-faint">No time slots set up for this day.</span>
        ) : (
          <div className="grid flex-1 gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {slots.map((slot, i) => {
              const on = coversSlot(mine, slot)
              const busy = pending.has(`${day.key}:${slot.id}`)
              const everyone = total > 0 && counts[i] === total
              return (
                <button
                  key={slot.id}
                  onClick={() => onToggle(slot)}
                  aria-pressed={on}
                  disabled={busy}
                  className={`flex h-12 flex-col items-center justify-center rounded-xl border-[1.5px] text-[12px] leading-none tracking-tight transition disabled:opacity-60 ${
                    on
                      ? 'border-green bg-green-soft font-bold text-green-ink'
                      : 'border-line bg-surface font-semibold text-ink hover:border-faint'
                  }`}
                >
                  <span>{slotLabel(slot.start_hour, slot.end_hour)}</span>
                  <span className={`mt-1 text-[10px] font-semibold ${everyone ? 'text-green' : on ? 'text-green-ink/70' : 'text-faint'}`}>
                    {counts[i]}/{total}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {events.map((event) => {
        const myResponse = event.responses.find((r) => r.user_id === userId)?.status
        const coming = event.responses.filter((r) => r.status === 'coming').length
        return (
          <div key={event.id} className="flex items-center justify-between gap-2.5 rounded-xl bg-yellow-soft px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="h-2 w-2 shrink-0 rounded-full bg-yellow" />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] font-bold text-yellow-ink">
                  {event.title}
                  {event.opponent ? ` · ${event.opponent}` : ''}
                </span>
                <span className="text-xs text-yellow-ink/80">
                  {eventTypeLabel[event.type]} · {slotLabel(event.start_hour, event.end_hour)} · {coming} coming
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                onClick={() => onRespond(event, 'coming')}
                className={`h-8 rounded-full px-3 text-xs font-bold ${
                  myResponse === 'coming' ? 'bg-ink text-white' : 'bg-surface text-ink hover:bg-surface-2'
                }`}
              >
                Coming
              </button>
              <button
                onClick={() => onRespond(event, 'not_coming')}
                aria-label="Can't make it"
                title="Can't make it"
                className={`flex h-8 w-8 items-center justify-center rounded-full ${
                  myResponse === 'not_coming' ? 'bg-ink text-white' : 'bg-surface text-muted hover:bg-surface-2'
                }`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
