import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  fetchAvailability,
  fetchTeamSlots,
  subscribeAvailability,
  type HoursByDayUser,
} from "./availability";
import {
  dayIsOff,
  fetchDayOverrides,
  fetchOffWeekdays,
} from "./closedDays";
import {
  fetchActivityTypes,
  fetchEvents,
  type EventWithResponses,
} from "./events";
import { fetchMembers, fetchTeamRoles } from "./settings";
import { writingNow } from "./writes";
import { supabase } from "./supabase";
import {
  friendlyError,
  type ActivityType,
  type MemberWithProfile,
  type TeamRole,
  type TeamSlot,
} from "./types";
import {
  daysOfWeek,
  shiftWeek,
  toDateKey,
  weekId,
  weekStart,
  weekStartFromId,
  type WeekDay,
} from "./week";

interface WeekPayload {
  hours: HoursByDayUser;
  events: EventWithResponses[];
  /** Unntak fra malen denne uka: dato → er dagen fri. Tom for de aller fleste uker. */
  overrides: Map<string, boolean>;
}

// Stable empties, so an unloaded week does not hand out a fresh object on every render.
const EMPTY_HOURS: HoursByDayUser = {};
const EMPTY_EVENTS: EventWithResponses[] = [];
const EMPTY_OVERRIDES: ReadonlyMap<string, boolean> = new Map<string, boolean>();

/**
 * Everything one week of a team needs: the slots, who is free when, the events, the activity
 * types and the members. The week lives in the URL (?week=2026-W37).
 *
 * Weeks are cached by their Monday, and the weeks on either side are fetched in the background,
 * so stepping back and forth shows the new week straight away instead of blinking through a
 * loading state. A cached week is still refetched quietly, so it never goes stale.
 */
export function useWeekData(teamId: string) {
  const [params, setParams] = useSearchParams();
  const weekParam = params.get("week");
  const monday = useMemo(() => weekStartFromId(weekParam), [weekParam]);
  const days = useMemo(() => daysOfWeek(monday), [monday]);
  const fromKey = days[0].key;

  const [slots, setSlots] = useState<TeamSlot[] | null>(null);
  const [types, setTypes] = useState<ActivityType[]>([]);
  const [members, setMembers] = useState<MemberWithProfile[] | null>(null);
  // Lagets egen rolleliste. Tom liste = laget bruker ikke roller, og da vises ingen rollekolonne.
  const [roles, setRoles] = useState<TeamRole[]>([]);
  // Vekedagene laget normalt har fri. Del av malen, satt i Settings.
  const [offWeekdays, setOffWeekdays] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  // One entry per week, keyed by the Monday. The neighbours are prefetched into the same place.
  const [cache, setCache] = useState<Record<string, WeekPayload>>({});
  const week = cache[fromKey];
  const hours = week?.hours ?? EMPTY_HOURS;
  const events = week?.events ?? EMPTY_EVENTS;
  const overrides = week?.overrides ?? EMPTY_OVERRIDES;
  // The very first load has nothing to show; every later one keeps the old week on screen.
  const loaded = week !== undefined;

  // Optimistic toggles need the newest value without waiting for a render.
  const hoursRef = useRef(hours);
  useEffect(() => {
    hoursRef.current = hours;
  }, [hours]);

  const eventsRef = useRef(events);
  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  const write = useCallback((key: string, next: Partial<WeekPayload>) => {
    setCache((c) => ({
      ...c,
      [key]: {
        ...(c[key] ?? { hours: {}, events: [], overrides: new Map<string, boolean>() }),
        ...next,
      },
    }));
  }, []);

  // Uker som er på vei inn. Uten dette henter vi samme uke om igjen hver gang du
  // blar forbi den, og svarene kan komme i feil rekkefølge.
  const inFlight = useRef(new Set<string>());

  /** Fetch one week into the cache. `quiet` weeks are the prefetched neighbours. */
  const fetchWeek = useCallback(
    async (start: Date, quiet = false) => {
      const week = daysOfWeek(start);
      const mondayKey = week[0].key;
      const to = week[6].key;
      if (quiet && inFlight.current.has(mondayKey)) return;
      inFlight.current.add(mondayKey);
      try {
        const [h, e, ov] = await Promise.all([
          fetchAvailability(teamId, mondayKey, to),
          fetchEvents(teamId, mondayKey, to),
          fetchDayOverrides(teamId, mondayKey, to),
        ]);
        setCache((c) => ({
          ...c,
          [mondayKey]: { hours: h, events: e, overrides: ov },
        }));
        if (!quiet) setError(null);
      } catch (err) {
        if (!quiet) setError(friendlyError(err));
      } finally {
        inFlight.current.delete(mondayKey);
      }
    },
    [teamId],
  );

  const load = useCallback(async () => {
    await fetchWeek(monday);
  }, [fetchWeek, monday]);

  const loadTeam = useCallback(async () => {
    try {
      const [s, t, m, r, off] = await Promise.all([
        fetchTeamSlots(teamId),
        fetchActivityTypes(teamId),
        fetchMembers(teamId),
        fetchTeamRoles(teamId),
        fetchOffWeekdays(teamId),
      ]);
      setSlots(s);
      setTypes(t);
      setMembers(m);
      setRoles(r);
      setOffWeekdays(off);
    } catch (err) {
      setError(friendlyError(err));
    }
  }, [teamId]);

  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);

  // Uka i URL-en, og naboene med det samme, så et steg til siden er ferdig lastet
  // før du trykker. To uker ut til hver side: blar du fort, rekker du ellers å løpe
  // fra hurtiglageret, og da tegnes uka tom før den fylles — det er det som blinker.
  useEffect(() => {
    let cancelled = false;
    void fetchWeek(monday);
    for (const step of [-1, 1]) void fetchWeek(shiftWeek(monday, step), true);
    const timer = setTimeout(() => {
      if (cancelled) return;
      for (const step of [-2, 2]) void fetchWeek(shiftWeek(monday, step), true);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fetchWeek, monday]);

  // Live updates. Anything can change, so refetch the week on screen.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let neighbours: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        // Realtime sender våre egne skrivinger tilbake til oss. Henter vi uka på nytt
        // for hvert trykk, kan et svar som var underveis overskrive trykket du nettopp
        // gjorde. Så mens vi skriver selv, venter vi — andre sine endringer kommer inn
        // med det samme det er ro.
        if (writingNow()) {
          refresh();
          return;
        }
        void fetchWeek(monday);
        // Nabo-ukene holdes varme, men de haster ikke og skal ikke stå i veien.
        if (neighbours) clearTimeout(neighbours);
        neighbours = setTimeout(() => {
          for (const step of [-1, 1])
            void fetchWeek(shiftWeek(monday, step), true);
        }, 1200);
      }, 250);
    };
    const unsubscribe = subscribeAvailability(teamId, refresh);
    const channel = supabase
      .channel(`team:${teamId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "activity_types",
          filter: `team_id=eq.${teamId}`,
        },
        () => void loadTeam(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "team_slots",
          filter: `team_id=eq.${teamId}`,
        },
        () => void loadTeam(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "closed_days",
          filter: `team_id=eq.${teamId}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "teams",
          filter: `id=eq.${teamId}`,
        },
        () => void loadTeam(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "members",
          filter: `team_id=eq.${teamId}`,
        },
        () => void loadTeam(),
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      if (neighbours) clearTimeout(neighbours);
      unsubscribe();
      void supabase.removeChannel(channel);
    };
  }, [teamId, fetchWeek, monday, loadTeam]);

  // Optimistic updates from the views go into the cache for the week on screen.
  const setHours = useCallback(
    (next: HoursByDayUser | ((prev: HoursByDayUser) => HoursByDayUser)) => {
      const value = typeof next === "function" ? next(hoursRef.current) : next;
      write(fromKey, { hours: value });
    },
    [fromKey, write],
  );

  const setEvents = useCallback(
    (
      next:
        | EventWithResponses[]
        | ((prev: EventWithResponses[]) => EventWithResponses[]),
    ) => {
      const value = typeof next === "function" ? next(eventsRef.current) : next;
      write(fromKey, { events: value });
    },
    [fromKey, write],
  );

  const goToWeek = useCallback(
    (next: Date) => {
      const id = weekId(next);
      const p = new URLSearchParams(params);
      if (id === weekId(weekStart(new Date()))) p.delete("week");
      else p.set("week", id);
      setParams(p, { replace: true });
    },
    [params, setParams],
  );

  const activeTypes = useMemo(() => types.filter((t) => !t.archived), [types]);

  // Mandag i inneværende uke. Mønsteret gjelder bare fra og med den, så en uke
  // som er ferdig ikke endrer seg fordi noen endret malen etterpå.
  const thisMondayKey = toDateKey(weekStart(new Date()));
  const isOff = useCallback(
    (day: WeekDay) =>
      dayIsOff(day.key, day.isoDay, overrides, offWeekdays, thisMondayKey),
    [overrides, offWeekdays, thisMondayKey],
  );

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
    roles,
    hours,
    setHours,
    hoursRef,
    overrides,
    offWeekdays,
    isOff,
    events,
    setEvents,
    loaded,
    error,
    setError,
    reload: load,
    reloadTeam: loadTeam,
  };
}

export type WeekData = ReturnType<typeof useWeekData>;
