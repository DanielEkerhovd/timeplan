import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  applyToggle,
  coversSlot,
  fetchAvailability,
  fetchTeamSlots,
  planToggle,
  subscribeAvailability,
  type HoursByDayUser,
} from '../lib/availability'
import { fetchEvents, respondToEvent, type EventWithResponses } from '../lib/events'
import type { MyTeam } from '../lib/teams'
import { friendlyError, type Profile, type ResponseStatus, type TeamSlot } from '../lib/types'
import { daysOfWeek, formatRange, shiftWeek, weekId, weekStart, weekStartFromId, type WeekDay } from '../lib/week'
import { ErrorText, Spinner } from './ui'
import DayCard from './DayCard'

interface Props {
  team: MyTeam
  userId: string
  /** Everyone on the team, so the buttons can show "3 of 5 can". */
  members: { user_id: string; profile: Profile | null }[]
}

export default function WeekView({ team, userId, members }: Props) {
  const [params, setParams] = useSearchParams()
  const monday = useMemo(() => weekStartFromId(params.get('week')), [params])
  const days = useMemo(() => daysOfWeek(monday), [monday])
  const fromKey = days[0].key
  const toKey = days[6].key

  const [slots, setSlots] = useState<TeamSlot[] | null>(null)
  const [hours, setHours] = useState<HoursByDayUser>({})
  const [events, setEvents] = useState<EventWithResponses[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Set<string>>(new Set())

  // Keep the latest hours in a ref so optimistic updates can be rolled back precisely.
  const hoursRef = useRef(hours)
  useEffect(() => {
    hoursRef.current = hours
  }, [hours])

  const load = useCallback(async () => {
    try {
      const [h, e] = await Promise.all([fetchAvailability(team.id, fromKey, toKey), fetchEvents(team.id, fromKey, toKey)])
      setHours(h)
      setEvents(e)
      setError(null)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoaded(true)
    }
  }, [team.id, fromKey, toKey])

  useEffect(() => {
    let cancelled = false
    fetchTeamSlots(team.id)
      .then((s) => {
        if (!cancelled) setSlots(s)
      })
      .catch((err) => setError(friendlyError(err)))
    return () => {
      cancelled = true
    }
  }, [team.id])

  useEffect(() => {
    setLoaded(false)
    void load()
  }, [load])

  // Live updates: someone else pressed a button, or an event was added. Refetch, lightly debounced.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = subscribeAvailability(team.id, () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void load(), 250)
    })
    return () => {
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }, [team.id, load])

  function goToWeek(next: Date) {
    const id = weekId(next)
    const current = weekId(weekStart(new Date()))
    if (id === current) {
      params.delete('week')
    } else {
      params.set('week', id)
    }
    setParams(params, { replace: true })
  }

  async function toggle(day: WeekDay, slot: TeamSlot, daySlots: TeamSlot[]) {
    const key = `${day.key}:${slot.id}`
    if (pending.has(key)) return
    const before = hoursRef.current
    const mine = before[day.key]?.[userId]
    const plan = planToggle(mine, slot, daySlots)

    // Optimistic: show the new state right away, roll back if the database says no.
    const next = new Set(mine ?? [])
    plan.add.forEach((h) => next.add(h))
    plan.remove.forEach((h) => next.delete(h))
    setHours({ ...before, [day.key]: { ...(before[day.key] ?? {}), [userId]: next } })
    setPending((p) => new Set(p).add(key))
    try {
      await applyToggle(team.id, userId, day.key, plan)
      setError(null)
    } catch (err) {
      setHours(before)
      setError(friendlyError(err))
    } finally {
      setPending((p) => {
        const n = new Set(p)
        n.delete(key)
        return n
      })
    }
  }

  async function respond(event: EventWithResponses, status: ResponseStatus) {
    const previous = events
    setEvents((list) =>
      list.map((e) =>
        e.id === event.id
          ? { ...e, responses: [...e.responses.filter((r) => r.user_id !== userId), { user_id: userId, status }] }
          : e,
      ),
    )
    try {
      await respondToEvent(event.id, status)
    } catch (err) {
      setEvents(previous)
      setError(friendlyError(err))
    }
  }

  const answeredCount = useMemo(() => {
    const users = new Set<string>()
    for (const d of days) for (const uid of Object.keys(hours[d.key] ?? {})) users.add(uid)
    return users.size
  }, [days, hours])

  const isCurrentWeek = weekId(monday) === weekId(weekStart(new Date()))

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-[14px] bg-surface px-3 py-2.5 shadow-card">
        <NavButton label="Previous week" onClick={() => goToWeek(shiftWeek(monday, -1))} dir="left" />
        <button
          onClick={() => goToWeek(weekStart(new Date()))}
          className="flex flex-col items-center gap-0.5"
          title="Jump to this week"
        >
          <span className="text-[15px] font-bold">
            Week {weekId(monday).slice(-2).replace(/^0/, '')}
            {isCurrentWeek && <span className="ml-1.5 rounded-full bg-green-soft px-2 py-0.5 text-[10px] font-bold text-green-ink">now</span>}
          </span>
          <span className="text-xs text-muted">
            {formatRange(monday)} · {answeredCount} of {members.length} answered
          </span>
        </button>
        <NavButton label="Next week" onClick={() => goToWeek(shiftWeek(monday, 1))} dir="right" />
      </div>

      <p className="px-1 text-sm leading-relaxed text-muted">Tap the evenings you can play. You can pick more than one per day.</p>

      <ErrorText>{error}</ErrorText>

      {!slots || !loaded ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-2.5">
          {days.map((day) => {
            const daySlots = slots.filter((s) => s.day_type === (day.isWeekend ? 'weekend' : 'weekday'))
            const byUser = hours[day.key] ?? {}
            return (
              <DayCard
                key={day.key}
                day={day}
                slots={daySlots}
                mine={byUser[userId]}
                counts={daySlots.map((s) => members.filter((m) => coversSlot(byUser[m.user_id], s)).length)}
                total={members.length}
                pending={pending}
                events={events.filter((e) => e.date === day.key)}
                userId={userId}
                members={members}
                onToggle={(slot) => void toggle(day, slot, daySlots)}
                onRespond={(event, status) => void respond(event, status)}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}

function NavButton({ label, onClick, dir }: { label: string; onClick: () => void; dir: 'left' | 'right' }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-surface-2 hover:text-ink"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {dir === 'left' ? <path d="M15 6l-6 6 6 6" /> : <path d="M9 6l6 6-6 6" />}
      </svg>
    </button>
  )
}
