import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { fetchAvailability, fetchTeamSlots, subscribeAvailability, type HoursByDayUser } from './availability'
import { fetchActivityTypes, fetchEvents, type EventWithResponses } from './events'
import { fetchMembers } from './settings'
import { supabase } from './supabase'
import { friendlyError, type ActivityType, type MemberWithProfile, type TeamSlot } from './types'
import { daysOfWeek, shiftWeek, weekId, weekStart, weekStartFromId } from './week'

/**
 * Everything one week of a team needs: the slots, who is free when, the events, the activity
 * types and the members. The week lives in the URL (?week=2026-W37). Live updates refetch,
 * lightly debounced.
 */
export function useWeekData(teamId: string) {
  const [params, setParams] = useSearchParams()
  const monday = useMemo(() => weekStartFromId(params.get('week')), [params])
  const days = useMemo(() => daysOfWeek(monday), [monday])
  const fromKey = days[0].key
  const toKey = days[6].key

  const [slots, setSlots] = useState<TeamSlot[] | null>(null)
  const [types, setTypes] = useState<ActivityType[]>([])
  const [members, setMembers] = useState<MemberWithProfile[] | null>(null)
  const [hours, setHours] = useState<HoursByDayUser>({})
  const [events, setEvents] = useState<EventWithResponses[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Latest hours in a ref so optimistic updates can roll back precisely.
  const hoursRef = useRef(hours)
  useEffect(() => {
    hoursRef.current = hours
  }, [hours])

  const load = useCallback(async () => {
    try {
      const [h, e] = await Promise.all([fetchAvailability(teamId, fromKey, toKey), fetchEvents(teamId, fromKey, toKey)])
      setHours(h)
      setEvents(e)
      setError(null)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoaded(true)
    }
  }, [teamId, fromKey, toKey])

  const loadTeam = useCallback(async () => {
    try {
      const [s, t, m] = await Promise.all([fetchTeamSlots(teamId), fetchActivityTypes(teamId), fetchMembers(teamId)])
      setSlots(s)
      setTypes(t)
      setMembers(m)
    } catch (err) {
      setError(friendlyError(err))
    }
  }, [teamId])

  useEffect(() => {
    void loadTeam()
  }, [loadTeam])

  useEffect(() => {
    setLoaded(false)
    void load()
  }, [load])

  // Availability / events / responses change often: debounce. Team-level tables change rarely.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = subscribeAvailability(teamId, () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void load(), 250)
    })
    const channel = supabase
      .channel(`team:${teamId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_types', filter: `team_id=eq.${teamId}` }, () => void loadTeam())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_slots', filter: `team_id=eq.${teamId}` }, () => void loadTeam())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members', filter: `team_id=eq.${teamId}` }, () => void loadTeam())
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      unsubscribe()
      void supabase.removeChannel(channel)
    }
  }, [teamId, load, loadTeam])

  const goToWeek = useCallback(
    (next: Date) => {
      const id = weekId(next)
      if (id === weekId(weekStart(new Date()))) params.delete('week')
      else params.set('week', id)
      setParams(params, { replace: true })
    },
    [params, setParams],
  )

  const activeTypes = useMemo(() => types.filter((t) => !t.archived), [types])

  return {
    monday,
    days,
    isCurrentWeek: weekId(monday) === weekId(weekStart(new Date())),
    prevWeek: () => goToWeek(shiftWeek(monday, -1)),
    nextWeek: () => goToWeek(shiftWeek(monday, 1)),
    thisWeek: () => goToWeek(weekStart(new Date())),
    slots,
    types,
    activeTypes,
    members,
    hours,
    setHours,
    hoursRef,
    events,
    setEvents,
    loaded,
    error,
    setError,
    reload: load,
    reloadTeam: loadTeam,
  }
}

export type WeekData = ReturnType<typeof useWeekData>
