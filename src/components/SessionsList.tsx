import { format } from 'date-fns'
import { eventLabel, eventPalette, hasJoined, joinedUserIds, type EventWithResponses } from '../lib/events'
import type { ActivityType, MemberWithProfile } from '../lib/types'
import { dayShort, fromDateKey, slotLabel } from '../lib/week'
import { AvatarStack, Check, Pill } from './ui'

interface Props {
  events: EventWithResponses[]
  types: ActivityType[]
  members: MemberWithProfile[]
  /** Join / Joined toggle for this user … */
  userId?: string
  onToggleJoin?: (event: EventWithResponses) => void
  /** … or an Edit button (team overview). Both can be shown. */
  onEdit?: (event: EventWithResponses) => void
  hint?: string
  className?: string
}

/** "Planned this week": the sessions, separate from the availability calendar. */
export default function SessionsList({ events, types, members, userId, onToggleJoin, onEdit, hint, className = '' }: Props) {
  const n = events.length
  return (
    <section className={`flex flex-col gap-2.5 rounded-[20px] bg-surface p-4 shadow-card lg:px-5 ${className}`}>
      <div className="flex items-baseline justify-between px-0.5">
        <h2 className="whitespace-nowrap text-[15px] font-extrabold">Planned this week</h2>
        <span className="truncate pl-3 text-right text-xs text-muted">
          {n === 0 ? 'nothing yet' : `${n} session${n === 1 ? '' : 's'}`}
          {hint && n > 0 && <span className="hidden sm:inline"> · {hint}</span>}
        </span>
      </div>
      {n === 0 ? (
        <p className="px-0.5 pb-1 text-[13px] text-faint">Nothing booked this week yet.</p>
      ) : (
        <div className="grid gap-2.5 lg:grid-cols-2">
          {events.map((e) => {
            const p = eventPalette(e, types)
            const joined = userId ? hasJoined(e, userId) : false
            const ids = joinedUserIds(e)
            const people = members.filter((m) => ids.includes(m.user_id))
            const d = fromDateKey(e.date)
            return (
              <div key={e.id} className="flex min-w-0 items-center gap-3 rounded-xl px-3.5 py-3" style={{ background: p.soft }}>
                <div className="flex w-10 shrink-0 flex-col items-center leading-[1.1]">
                  <span className="text-[10px] font-bold uppercase tracking-[0.06em]" style={{ color: p.sub }}>
                    {dayShort[d.getDay() === 0 ? 6 : d.getDay() - 1]}
                  </span>
                  <span className="text-[17px] font-extrabold" style={{ color: p.ink }}>
                    {format(d, 'd')}
                  </span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="truncate text-[13px] font-extrabold" style={{ color: p.ink }}>
                    {eventLabel(e, types)}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="whitespace-nowrap text-xs font-semibold" style={{ color: p.sub }}>
                      {slotLabel(e.start_hour, e.end_hour)}
                    </span>
                    <AvatarStack people={people} ring={p.soft} />
                  </div>
                </div>
                {userId && onToggleJoin && (
                  <Pill active={joined} onClick={() => onToggleJoin(e)} aria-pressed={joined} className="w-[86px] justify-center">
                    {joined && <Check />}
                    {joined ? 'Joined' : 'Join'}
                  </Pill>
                )}
                {onEdit && <Pill onClick={() => onEdit(e)}>Edit</Pill>}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
