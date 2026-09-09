import {
  Fragment,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { palette } from "../lib/colors";
import {
  addActivityType,
  addTeamRole,
  lineupOrder,
  roleName,
  setTeamTimezone,
  deleteTeamRole,
  reorderTeamRoles,
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
  roleLabel,
  type ActivityColor,
  type ActivityType,
  type DayType,
  type TeamRole,
  type TeamSlot,
} from "../lib/types";
import type { WeekData } from "../lib/useWeekData";
import { eventPalette, eventTitle } from "../lib/events";
import {
  Avatar,
  AvatarStack,
  Button,
  Card,
  Check,
  CloseButton,
  DotRow,
  ErrorText,
  Eyebrow,
  Input,
  Label,
  Modal,
  Pill,
  Spinner,
  Toggle,
  useToast,
} from "../components/ui";
import { Dropdown } from "../components/pickers";
import {
  appBase,
  rotateShareSlug,
  setShareEnabled,
  shareImage,
  shareLink,
} from "../lib/share";
import { setOffWeekdays } from "../lib/closedDays";
import { allZones } from "../lib/timezone";
import {
  dayShort,
  formatRange,
  shiftWeek,
  slotLabel,
  weekId,
  weekStart,
} from "../lib/week";
import type { MemberWithProfile } from "../lib/types";

interface Props {
  team: MyTeam;
  week: WeekData;
  onTeamsChanged: () => Promise<void>;
}

/** Time slots, activity types, team name and the danger zone. Owner and admins. */
export default function SettingsPage({ team, week, onTeamsChanged }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const toast = useToast();

  // Fanen ligger i URL-en, så fram og tilbake i nettleseren virker, og du kan
  // sende noen lenka rett til den delen av innstillingene du snakker om.
  const tab = (tabs.find((t) => t.key === params.get("tab"))?.key ??
    "plan") as TabKey;
  function goTab(next: TabKey) {
    const p = new URLSearchParams(params);
    if (next === "plan") p.delete("tab");
    else p.set("tab", next);
    setParams(p, { replace: true });
  }

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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 lg:-mr-8 lg:overflow-y-auto lg:pr-8">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <Eyebrow>Settings</Eyebrow>
          <h1 className="hidden truncate text-[26px] font-extrabold tracking-tight lg:block">
            {team.name}
          </h1>
        </div>
        <div className="flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-[12px] bg-surface p-[3px] shadow-card sm:gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => goTab(t.key)}
              aria-current={tab === t.key ? "page" : undefined}
              // Fem faner på 390 piksler: litt strammere tekst og luft, så de får
              // plass uten å måtte dras sidelengs. Fra sm og opp som før.
              className={`h-9 shrink-0 rounded-[9px] px-2 text-[12px] font-extrabold transition sm:px-3.5 sm:text-[13px] ${
                tab === t.key
                  ? "bg-ink text-on-ink"
                  : "text-muted hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <ErrorText>{error}</ErrorText>

      {tab === "plan" && (
        <WeekPlanTab
          teamId={team.id}
          timezone={team.timezone}
          slots={week.slots}
          off={week.offWeekdays}
          isOwner={team.role === "owner"}
          onTeamsChanged={onTeamsChanged}
          run={run}
        />
      )}

      {tab === "activities" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1 px-1">
            <Eyebrow>Activities</Eyebrow>
            <h2 className="text-[22px] font-extrabold tracking-tight">
              The kinds of session you book
            </h2>
            <p className="max-w-[62ch] text-[14px] leading-relaxed text-muted">
              Colour, opponent and length follow the type everywhere it shows
              up: the week, the grid and the picture you share.
            </p>
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] xl:items-start">
            <TypesCard teamId={team.id} types={week.types} run={run} />
            <TypePreview types={week.types} />
          </div>
        </div>
      )}

      {tab === "roles" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1 px-1">
            <Eyebrow>Roles</Eyebrow>
            <h2 className="text-[22px] font-extrabold tracking-tight">
              The seats your team plays with
            </h2>
            <p className="max-w-[62ch] text-[14px] leading-relaxed text-muted">
              Lanes, positions, Coach, Sub — whatever fits. The order here is
              the order people are listed in, all through the app.
            </p>
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] xl:items-start">
            <RolesCard teamId={team.id} roles={week.roles} run={run} />
            <RolesPreview members={week.members ?? []} roles={week.roles} />
          </div>
        </div>
      )}

      {tab === "sharing" && (
        <SharingTab
          team={team}
          week={week}
          run={run}
          onTeamsChanged={onTeamsChanged}
        />
      )}

      {tab === "team" && (
        <TeamPanel
          team={team}
          members={week.members ?? []}
          roles={week.roles}
          run={run}
          onTeamsChanged={onTeamsChanged}
        />
      )}
    </div>
  );
}

/**
 * Uka slik laget ser den, som redigeringsflate.
 *
 * Øverst dagene med av/på. Under dem bolkene, tegnet på en tidslinje: en solid
 * stolpe per bolk, én linje hver, som du drar i endene. Da ser du formen på
 * kvelden — hvor hullene er, hvor bolkene overlapper — i stedet for å lese tall.
 * Nederst en forhåndsvisning av knappene folk faktisk får.
 */
function WeekPlanTab({
  teamId,
  timezone,
  slots,
  off,
  isOwner,
  onTeamsChanged,
  run,
}: {
  teamId: string;
  timezone: string;
  slots: TeamSlot[];
  off: number[];
  /** Bare eieren endrer formen på uka og sonen laget bruker. */
  isOwner: boolean;
  onTeamsChanged: () => Promise<void>;
  run: Run;
}) {
  const offSet = new Set(off);
  const weekday = slots.filter((s) => s.day_type === "weekday");
  const weekend = slots.filter((s) => s.day_type === "weekend");
  const lanes = Math.max(weekday.length, weekend.length, 1);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div className="flex flex-col gap-1">
          <Eyebrow>Week plan</Eyebrow>
          <h2 className="text-[22px] font-extrabold tracking-tight">
            The template every week starts from
          </h2>
          <p className="max-w-[62ch] text-[14px] leading-relaxed text-muted">
            Days that are off stay off, and the blocks are the buttons everyone
            taps. Change it here and every week ahead follows.
          </p>
        </div>
        <TeamZone
          teamId={teamId}
          timezone={timezone}
          isOwner={isOwner}
          onTeamsChanged={onTeamsChanged}
          run={run}
        />
      </div>

      {/* Dagene. Av her betyr av hver uke — Plan week kan fortsatt åpne én. */}
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
        {[1, 2, 3, 4, 5, 6, 7].map((d) => {
          const on = !offSet.has(d);
          return (
            <button
              key={d}
              type="button"
              disabled={!isOwner}
              aria-pressed={on}
              onClick={() =>
                void run(() =>
                  setOffWeekdays(
                    teamId,
                    on ? [...off, d] : off.filter((x) => x !== d),
                  ),
                )
              }
              title={
                isOwner
                  ? `Turn ${dayShort[d - 1]} ${on ? "off for every week" : "back on"}`
                  : undefined
              }
              className={`group flex flex-col items-center gap-2 rounded-[16px] p-3 ring-1 transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${
                isOwner
                  ? "hover:-translate-y-0.5 active:translate-y-0"
                  : "opacity-60"
              } ${
                on
                  ? `bg-surface shadow-card ring-line-soft ${isOwner ? "hover:shadow-pop hover:ring-line" : ""}`
                  : `bg-surface-2 ring-transparent ${isOwner ? "hover:bg-surface hover:shadow-card hover:ring-line-soft" : ""}`
              }`}
            >
              <span
                className={`text-[14px] font-extrabold transition ${
                  on
                    ? ""
                    : "text-faint line-through group-hover:text-muted group-hover:decoration-transparent"
                }`}
              >
                {dayShort[d - 1]}
              </span>
              {/* Merkelappen sier hva dagen er nå, og hva et klikk gjør når du peker. */}
              <span
                className={`flex h-[22px] items-center rounded-full px-2.5 text-[10px] font-extrabold uppercase tracking-[0.06em] transition ${
                  on
                    ? `bg-green-soft text-green-ink ${isOwner ? "group-hover:bg-ink group-hover:text-on-ink" : ""}`
                    : `bg-dot text-surface ${isOwner ? "group-hover:bg-green-soft group-hover:text-green-ink" : ""}`
                }`}
              >
                {isOwner ? (
                  <>
                    <span className="group-hover:hidden">
                      {on ? "On" : "Off"}
                    </span>
                    <span className="hidden group-hover:inline">
                      {on ? "Turn off" : "Turn on"}
                    </span>
                  </>
                ) : (
                  <span>{on ? "On" : "Off"}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* Ved siden av hverandre, helga litt smalere: den har færre bolker. */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <SlotTimeline
          title="Weekday"
          hint="Mon–Fri"
          dayType="weekday"
          teamId={teamId}
          mine={weekday}
          lanes={lanes}
          run={run}
        />
        <SlotTimeline
          title="Weekend"
          hint="Sat–Sun"
          dayType="weekend"
          teamId={teamId}
          mine={weekend}
          lanes={lanes}
          run={run}
        />
      </div>

      <WeekPreview
        weekday={weekday}
        weekend={weekend}
        off={offSet}
        timezone={timezone}
      />
    </div>
  );
}

/**
 * Linja holder hele døgnet, men viser 18 timer om gangen og glir bortover.
 *
 * Et vindu som regnet seg om etter bolkene gjorde to ting galt: skalaen endret
 * seg mens du dro, så stolpen fulgte ikke hånda, og alt flyttet på seg i det du
 * slapp. Her ligger timene fast i piksler. Trenger du natta, sklir linja dit —
 * av seg selv når du drar mot kanten. Da er hånd og stolpe i takt hele veien.
 */
const DAY: [number, number] = [0, 24];
/** Så mange timer står framme av gangen. Resten er et dra unna. */
const VISIBLE = 18;
/**
 * Smaleste en stolpe får bli: to håndtak (14 px hver med lufta si) og
 * klokkeslettet (49 px) imellom. Da ser en time ut som en hvilken som helst
 * annen bolk. Den dekker litt mer av linja enn timen sin, men venstrekanten
 * står der den skal, og det er den du leser av.
 */
const BAR_MIN = 80;

type SlotDrag = {
  id: string;
  mode: "move" | "start" | "end";
  x: number;
  /** Hvor langt linja var sklidd da du tok tak. Uten den teller vi glidingen dobbelt. */
  scroll: number;
  from: { start: number; end: number };
  /** Skalaen slik den var da du tok tak. Se kommentaren over. */
  pxPerHour: number;
};

function SlotTimeline({
  title,
  hint,
  dayType,
  teamId,
  mine,
  lanes,
  run,
}: {
  title: string;
  hint: string;
  dayType: DayType;
  teamId: string;
  mine: TeamSlot[];
  /** Like mange linjer i begge kortene, så de to står i takt uansett antall bolker. */
  lanes: number;
  run: Run;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<SlotDrag | null>(null);
  // Draget leser seg selv fra refs: rullingen skjer i en animasjonsløkke, og den
  // har ikke noe React-tilstand å lese fra.
  const dragRef = useRef<SlotDrag | null>(null);
  const pointerX = useRef(0);
  const frame = useRef<number | null>(null);
  // Bredda på sjølve linja. Vi treng henne for å vite om klokkeslettet får plass
  // inni stolpen eller må stå utanfor — helga er smalare enn vekedagane.
  const [trackW, setTrackW] = useState(0);
  // Hvilken vei er det mer linje? Styrer de to små pilene i kantene.
  const [more, setMore] = useState({ left: false, right: false });
  // Mens du drar viser vi din egen verdi. Basen får den først når du slipper.
  const [local, setLocal] = useState<{
    id: string;
    start: number;
    end: number;
  } | null>(null);

  const shown = (s: TeamSlot) =>
    local && local.id === s.id
      ? { start: local.start, end: local.end }
      : { start: s.start_hour, end: s.end_hour };

  const [from, to] = DAY;
  const span = to - from;
  const at = (h: number) => ((h - from) / span) * 100;

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const read = () => setTrackW(el.clientWidth);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Start til høyre, altså kveld. Har laget en bolk før klokka seks, står den
  // framme i stedet — ellers hadde du sett en tom linje og lurt på hvor den ble av.
  const parked = useRef(false);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || parked.current || trackW === 0) return;
    parked.current = true;
    const first = Math.min(...mine.map((s) => s.start_hour), 24);
    const early = first < to - VISIBLE;
    el.scrollLeft = early
      ? Math.max(0, (first / span) * trackW - 40)
      : el.scrollWidth;
    setMore(edges(el));
  }, [trackW, mine, span, to]);

  /** Hvor stolpen ligger og hvor brei han er, i piksler. Aldri smalere enn BAR_MIN. */
  function box(start: number, end: number) {
    const x0 = (at(start) / 100) * trackW;
    const x1 = (at(end) / 100) * trackW;
    const width = Math.max(x1 - x0 - 6, BAR_MIN);
    // Bolker helt ute mot midnatt ville stukket utenfor. Da flytter vi dem inn.
    const left = Math.min(Math.max(x0 + 3, 0), Math.max(trackW - width, 0));
    return { left, width };
  }

  function startDrag(
    e: ReactPointerEvent,
    s: TeamSlot,
    mode: SlotDrag["mode"],
  ) {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const w = trackRef.current?.clientWidth ?? 1;
    const next: SlotDrag = {
      id: s.id,
      mode,
      x: e.clientX,
      scroll: scrollRef.current?.scrollLeft ?? 0,
      from: { start: s.start_hour, end: s.end_hour },
      pxPerHour: w / span,
    };
    dragRef.current = next;
    pointerX.current = e.clientX;
    setDrag(next);
    setLocal({ id: s.id, start: s.start_hour, end: s.end_hour });
    frame.current = requestAnimationFrame(edgeScroll);
  }

  /** Regner ut hvor bolken ligger nå. Både hånda og glidingen teller. */
  function applyDrag(clientX: number) {
    const d = dragRef.current;
    if (!d) return;
    const slid = (scrollRef.current?.scrollLeft ?? 0) - d.scroll;
    const step = Math.round((clientX - d.x + slid) / d.pxPerHour);
    const { start, end } = d.from;
    let next = { start, end };
    if (d.mode === "start")
      next = { start: clamp(start + step, 0, end - 1), end };
    else if (d.mode === "end")
      next = { start, end: clamp(end + step, start + 1, 24) };
    else {
      const width = end - start;
      const s2 = clamp(start + step, 0, 24 - width);
      next = { start: s2, end: s2 + width };
    }
    setLocal({ id: d.id, ...next });
  }

  // Drar du bolken helt ut i kanten, sklir linja videre selv. Det er dette som
  // gjør at du når natta uten å slippe taket først.
  function edgeScroll() {
    const el = scrollRef.current;
    if (!dragRef.current || !el) return;
    const box = el.getBoundingClientRect();
    const EDGE = 44;
    const over =
      pointerX.current < box.left + EDGE
        ? pointerX.current - (box.left + EDGE)
        : pointerX.current > box.right - EDGE
          ? pointerX.current - (box.right - EDGE)
          : 0;
    if (over !== 0) {
      const was = el.scrollLeft;
      el.scrollLeft += clamp(over / 3, -14, 14);
      if (el.scrollLeft !== was) applyDrag(pointerX.current);
    }
    frame.current = requestAnimationFrame(edgeScroll);
  }

  function slide(dir: 1 | -1) {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.45, behavior: "smooth" });
  }

  function stopScroll() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }

  // Forsvinner linja mens du drar — du bytter fane, for eksempel — skal ikke
  // løkka bli gående.
  useLayoutEffect(() => () => stopScroll(), []);

  function moveDrag(e: ReactPointerEvent) {
    if (!dragRef.current) return;
    pointerX.current = e.clientX;
    applyDrag(e.clientX);
  }

  function endDrag() {
    dragRef.current = null;
    stopScroll();
    if (!drag || !local) return setDrag(null);
    const changed =
      local.start !== drag.from.start || local.end !== drag.from.end;
    const id = drag.id;
    setDrag(null);
    if (!changed) return setLocal(null);
    // Landet du oppå en bolk som allerede finnes, ville basen svart 409 på det.
    // Da er det ingenting å lagre — vi legger stolpen tilbake der den lå.
    const taken = mine.some(
      (o) =>
        o.id !== id && o.start_hour === local.start && o.end_hour === local.end,
    );
    if (taken) {
      setLocal(null);
      void run(async () => {
        throw new Error("team_slots_team_id_day_type_start_hour_end_hour_key");
      });
      return;
    }
    void run(() =>
      updateSlot(id, { start_hour: local.start, end_hour: local.end }),
    ).then(() => setLocal(null));
  }

  function nudge(s: TeamSlot, mode: "start" | "end", by: number) {
    const next =
      mode === "start"
        ? {
            start: clamp(s.start_hour + by, 0, s.end_hour - 1),
            end: s.end_hour,
          }
        : {
            start: s.start_hour,
            end: clamp(s.end_hour + by, s.start_hour + 1, 24),
          };
    void run(() =>
      updateSlot(s.id, { start_hour: next.start, end_hour: next.end }),
    );
  }

  // Ny bolk legger seg etter den siste. Finnes den allerede, prøver vi en time
  // senere — ellers svarer basen bare 409 og du får en feil for noe du ikke gjorde.
  function add() {
    const last = mine.at(-1);
    const wanted = last
      ? clamp(last.end_hour - 2, 0, 21)
      : dayType === "weekday"
        ? 18
        : 13;
    const free = (start: number) =>
      !mine.some((o) => o.start_hour === start && o.end_hour === start + 3);
    let start = wanted;
    for (let i = 0; i < 24 && !free(start); i++) start = (start + 1) % 22;
    const end = clamp(start + 3, start + 1, 24);
    void run(
      () => addSlot(teamId, dayType, start, end, (last?.sort ?? 0) + 1),
      "Block added",
    );
  }

  return (
    <Card className="flex flex-col gap-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-extrabold">{title}</h2>
        <span className="text-xs text-muted">
          {hint} · {mine.length === 0 ? "no blocks" : "drag the ends"}
        </span>
      </div>

      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={(e) => setMore(edges(e.currentTarget))}
          className={`relative select-none overflow-x-auto overflow-y-hidden overscroll-x-contain rounded-[14px] bg-bg [scrollbar-width:thin] ${
            drag
              ? drag.mode === "move"
                ? "cursor-grabbing"
                : "cursor-ew-resize"
              : ""
          }`}
          style={{ height: 34 + Math.max(mine.length, lanes, 1) * 48 }}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {/* Hele døgnet ligger her; bare 18 timer er framme av gangen. */}
          <div
            className="relative h-full"
            style={{ width: `${(span / VISIBLE) * 100}%` }}
          >
            {/* Egen indre flate med luft i kantene, så første og siste klokkeslett
              ikke blir liggende halvveis utenfor. */}
            {/* Litt mer luft til venstre enn til høyre: står linja parkert på kvelden,
              er det der kanten går, og da skal «06» få stå helt. */}
            <div ref={trackRef} className="absolute inset-y-0 left-5 right-3">
              {Array.from({ length: span + 1 }, (_, i) => from + i).map((h) => (
                <Fragment key={h}>
                  <div
                    className={`absolute bottom-0 top-0 w-px ${h % 6 === 0 ? "bg-line" : "bg-line-soft"}`}
                    style={{ left: `${at(h)}%` }}
                  />
                  {h % 2 === 0 && (
                    <span
                      className="absolute top-1.5 -translate-x-1/2 text-[10px] font-bold text-faint"
                      style={{ left: `${at(h)}%` }}
                    >
                      {String(h % 24).padStart(2, "0")}
                    </span>
                  )}
                </Fragment>
              ))}

              {mine.length === 0 && (
                <span
                  className="absolute bottom-5 right-0 text-center text-[13px] text-faint"
                  style={{ left: `${((span - VISIBLE) / span) * 100}%` }}
                >
                  No blocks yet — nobody can answer for these days.
                </span>
              )}

              {mine.map((s, i) => {
                const v = shown(s);
                const { left, width } = box(v.start, v.end);
                return (
                  <div
                    key={s.id}
                    // Kort overgang: bolkene snapper til hele timer, og uten den
                    // hopper stolpen 60 piksler av gangen i stedet for å gli dit.
                    className={`group absolute flex touch-none items-center justify-between rounded-[12px] bg-ink px-1 text-on-ink shadow-pop transition-[left,width] duration-75 ease-out motion-reduce:transition-none ${
                      drag?.id === s.id ? "cursor-grabbing" : "cursor-grab"
                    }`}
                    style={{ top: 22 + i * 48, height: 40, left, width }}
                    onPointerDown={(e) => startDrag(e, s, "move")}
                  >
                    <Handle
                      label={`Start of ${slotLabel(v.start, v.end)}`}
                      onPointerDown={(e) => startDrag(e, s, "start")}
                      onKeyDown={(e) =>
                        arrowKey(e, (by) => nudge(s, "start", by))
                      }
                    />
                    {/* Teksten ligger midt i stolpen uavhengig av håndtakene. Stolpen er
                        aldri smalere enn den, så her blir ingenting klipt. */}
                    <span className="pointer-events-none absolute inset-x-4 text-center text-[13px] font-extrabold tabular-nums">
                      {hourPair(v.start, v.end)}
                    </span>
                    <Handle
                      label={`End of ${slotLabel(v.start, v.end)}`}
                      onPointerDown={(e) => startDrag(e, s, "end")}
                      onKeyDown={(e) =>
                        arrowKey(e, (by) => nudge(s, "end", by))
                      }
                    />
                    {/* Krysset sitter i hjørnet og stjeler ikke plass fra teksten, så det
                        virker likt på en kort og en lang bolk. På touch, der ingenting kan
                        pekes på, står det alltid. */}
                    <Trash
                      label={`Remove ${slotLabel(v.start, v.end)}`}
                      onClick={() =>
                        void run(() => deleteSlot(s.id), "Block removed")
                      }
                      className="absolute -right-1.5 -top-1.5 border border-line bg-surface text-muted opacity-0 shadow-card transition hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {/* Natta ligger til venstre for det du ser. Pilene sier fra, og tar deg dit
            uten at du må dra en bolk for å komme av sted. */}
        <Nudge
          side="left"
          show={more.left}
          onClick={() => slide(-1)}
          label="Earlier hours"
        />
        <Nudge
          side="right"
          show={more.right}
          onClick={() => slide(1)}
          label="Later hours"
        />
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-3">
        <Button size="sm" className="h-10" onClick={add}>
          + Add a block
        </Button>
        <span className="text-[12px] text-muted">
          Blocks may overlap — people pick the ones that suit them.
        </span>
      </div>
    </Card>
  );
}

/** Hvor mye linje er det igjen hver vei? */
function edges(el: HTMLElement) {
  return {
    left: el.scrollLeft > 4,
    right: el.scrollLeft < el.scrollWidth - el.clientWidth - 4,
  };
}

/** Krysset som fjerner en bolk. Samme knapp inni stolpen og ute ved siden av. */
function Trash({
  label,
  onClick,
  className,
}: {
  label: string;
  onClick: () => void;
  className: string;
}) {
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      aria-label={label}
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[7px] ${className}`}
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      >
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}

/** Den lille pila i kanten av linja. */
function Nudge({
  side,
  show,
  onClick,
  label,
}: {
  side: "left" | "right";
  show: boolean;
  onClick: () => void;
  label: string;
}) {
  if (!show) return null;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`absolute top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface text-muted shadow-card transition hover:text-ink ${
        side === "left" ? "left-1.5" : "right-1.5"
      }`}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={side === "left" ? "M14 6l-6 6 6 6" : "M10 6l6 6-6 6"} />
      </svg>
    </button>
  );
}

/** «18–21». Bolkene er hele timer, så minuttene sier ingenting her — og korte
 *  tall gjør at teksten får plass også i en smal stolpe. */
function hourPair(start: number, end: number) {
  const p = (h: number) => String(h % 24).padStart(2, "0");
  return `${p(start)}–${p(end)}`;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function arrowKey(e: ReactKeyboardEvent, move: (by: number) => void) {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  e.preventDefault();
  move(e.key === "ArrowLeft" ? -1 : 1);
}

/** Draget i enden av en stolpe. Egen knapp, så piltastene virker uten mus. */
function Handle({
  label,
  onPointerDown,
  onKeyDown,
}: {
  label: string;
  onPointerDown: (e: ReactPointerEvent) => void;
  onKeyDown: (e: ReactKeyboardEvent) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={(e) => {
        e.stopPropagation();
        onPointerDown(e);
      }}
      onKeyDown={onKeyDown}
      // Grepet er smalt å se på, men flata du kan ta i strekker seg litt utenfor.
      className="relative h-7 w-2.5 shrink-0 cursor-ew-resize touch-none rounded-full bg-on-ink/30 after:absolute after:inset-y-0 after:-left-1 after:-right-1 after:content-[''] hover:bg-on-ink/55"
    />
  );
}

/** Knappene folk faktisk får. Ingen data — bare formen på uka. */
function WeekPreview({
  weekday,
  weekend,
  off,
  timezone,
}: {
  weekday: TeamSlot[];
  weekend: TeamSlot[];
  off: Set<number>;
  timezone: string;
}) {
  return (
    <Card className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <h2 className="text-[15px] font-extrabold">What everyone will see</h2>
        <span className="text-xs text-muted">
          {timezone.replace(/_/g, " ")} · each member sees it in their own zone
        </span>
      </div>
      {/* Mobil: sju kolonner på 350 piksler gir «18:00 -» på én linje og «21:00»
          på neste. Alle dagene i en gruppe har uansett samme bolker, så der
          viser vi dagene som merkelapper og bolkene én gang. */}
      <div className="flex flex-col gap-3 sm:hidden">
        <PreviewGroup days={[1, 2, 3, 4, 5]} list={weekday} off={off} />
        <PreviewGroup days={[6, 7]} list={weekend} off={off} />
      </div>

      {/* Vekedager og helg er to forskjellige planer. De står ved siden av
          hverandre, men med en strek imellom — og inne i hver gruppe er alle
          kolonnene like høye. */}
      <div className="hidden gap-3 sm:flex sm:flex-row sm:items-start sm:gap-4">
        <PreviewDays days={[1, 2, 3, 4, 5]} list={weekday} off={off} />
        <div className="h-px shrink-0 self-stretch bg-line sm:h-auto sm:w-px" />
        <PreviewDays days={[6, 7]} list={weekend} off={off} />
      </div>
    </Card>
  );
}

/**
 * Sonen laget regner i. Alt i appen står i den — timene i basen er tall, og
 * sonen sier hva tallene betyr. Bytter du sone, flytter ingen tall seg, men
 * 18 blir 18:00 et annet sted. Derfor står det i klartekst før du trykker.
 *
 * Bare eieren får dialogen. Alle andre ser sonen, som før.
 */
function TeamZone({
  teamId,
  timezone,
  isOwner,
  onTeamsChanged,
  run,
}: {
  teamId: string;
  timezone: string;
  isOwner: boolean;
  /** Laget ligger også i lista øverst i appen. Uten denne står gammel sone der til du laster på nytt. */
  onTeamsChanged: () => Promise<void>;
  run: Run;
}) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(timezone);
  const [busy, setBusy] = useState(false);

  const zones = useMemo(() => {
    const list = allZones();
    // Sonen laget faktisk har skal stå i lista selv om nettleseren ikke kjenner den.
    if (!list.includes(timezone)) list.unshift(timezone);
    return list.map((z) => ({ value: z, label: z.replace(/_/g, " ") }));
  }, [timezone]);

  const label = (
    <>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="text-faint"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      {timezone.replace(/_/g, " ")}
      <span className="font-semibold text-muted">team time</span>
    </>
  );

  if (!isOwner)
    return (
      <span className="flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-[12px] font-bold shadow-card">
        {label}
      </span>
    );

  async function save() {
    if (pick === timezone) return setOpen(false);
    setBusy(true);
    await run(() => setTeamTimezone(teamId, pick), "Team time zone changed");
    await onTeamsChanged();
    setBusy(false);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setPick(timezone);
          setOpen(true);
        }}
        title="Change the time zone the team plans in"
        className="flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-[12px] font-bold shadow-card ring-1 ring-transparent transition hover:ring-line"
      >
        {label}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-faint"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <Modal onClose={() => setOpen(false)}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <Eyebrow>Team</Eyebrow>
              <h2 className="text-[19px] font-extrabold">Time zone</h2>
            </div>
            <CloseButton onClick={() => setOpen(false)} />
          </div>

          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            The whole team plans in one zone. Everyone still sees the times
            where they are — this is only what the hours mean.
          </p>

          <div className="mt-4 flex flex-col gap-1.5">
            <Label>Team time zone</Label>
            <Dropdown
              value={pick}
              options={zones}
              onChange={setPick}
              search
              disabled={busy}
              className="w-full"
            />
          </div>

          {pick !== timezone && (
            <p className="mt-3 rounded-xl bg-yellow-soft px-3.5 py-3 text-[13px] leading-relaxed text-yellow-ink">
              Nothing anyone has marked moves. A block at 18:00 stays 18:00 —
              but from now on that means 18:00 in {pick.replace(/_/g, " ")}.
              Change this when the team has moved, not to fix one person's
              clock.
            </p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={busy}>
              {pick === timezone ? "Done" : "Change zone"}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Mobilutgaven: dagene som merkelapper, og bolkene under, én gang. */
function PreviewGroup({
  days,
  list,
  off,
}: {
  days: number[];
  list: TeamSlot[];
  off: Set<number>;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[16px] bg-bg p-3">
      <div className="flex flex-wrap gap-1.5">
        {days.map((d) => {
          const isOff = off.has(d);
          return (
            <span
              key={d}
              className={`rounded-full px-2.5 py-1 text-[12px] font-extrabold ${
                isOff
                  ? "bg-surface-2 text-faint line-through"
                  : "bg-surface text-ink shadow-card"
              }`}
            >
              {dayShort[d - 1]}
            </span>
          );
        })}
      </div>
      {list.length === 0 ? (
        <span className="px-1 py-2 text-[12px] text-faint">
          No blocks — nobody can answer for these days.
        </span>
      ) : (
        list.map((s) => (
          <div
            key={s.id}
            className="flex items-center justify-between rounded-xl border-[1.5px] border-line bg-surface px-3 py-2"
          >
            <span className="text-[13px] font-bold tabular-nums">
              {slotLabel(s.start_hour, s.end_hour)}
            </span>
            <DotRow can={[false, false, false, false, false]} dim />
          </div>
        ))
      )}
    </div>
  );
}

/** Én gruppe dager med samme plan. Alle kolonnene her er like høye. */
function PreviewDays({
  days,
  list,
  off,
}: {
  days: number[];
  list: TeamSlot[];
  off: Set<number>;
}) {
  return (
    <div
      className="grid min-w-0 gap-2"
      style={{
        flex: `${days.length} 1 0%`,
        gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
      }}
    >
      {days.map((d) => {
        const isOff = off.has(d);
        return (
          <div key={d} className="flex min-w-0 flex-col gap-2">
            <span
              className={`pb-0.5 text-center text-xs font-bold ${isOff ? "text-faint" : "text-muted"}`}
            >
              {dayShort[d - 1]}
            </span>
            {isOff ? (
              <div className="flex min-h-[68px] flex-1 items-center justify-center rounded-xl border-[1.5px] border-dashed border-line-soft text-[12px] font-bold text-faint">
                Day off
              </div>
            ) : list.length === 0 ? (
              <div className="flex min-h-[68px] flex-1 items-center justify-center rounded-xl border-[1.5px] border-dashed border-line-soft text-[11px] text-faint">
                no blocks
              </div>
            ) : (
              list.map((s) => (
                <div
                  key={s.id}
                  className="flex h-[68px] flex-col items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-line bg-surface text-[13px] font-bold tabular-nums"
                >
                  {slotLabel(s.start_hour, s.end_hour)}
                  <DotRow can={[false, false, false, false, false]} dim />
                </div>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

type TabKey = "plan" | "activities" | "roles" | "sharing" | "team";

const tabs: { key: TabKey; label: string }[] = [
  { key: "plan", label: "Week plan" },
  { key: "activities", label: "Activities" },
  { key: "roles", label: "Roles" },
  { key: "sharing", label: "Sharing" },
  { key: "team", label: "Team" },
];

/** Hvem som har hvilken rolle. Ren lesning, men det er det du lurer på her. */
/**
 * Lista slik laget faktisk møter den: samme rekkefølgen som i uka, med rollen
 * under navnet. Drar du en rolle opp her, flytter folk seg med en gang.
 */
function RolesPreview({
  members,
  roles,
}: {
  members: MemberWithProfile[];
  roles: TeamRole[];
}) {
  const lineup = lineupOrder(members, roles);
  const unset = members.filter((m) => !m.role_id).length;

  return (
    <Card className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <h2 className="text-[15px] font-extrabold">What everyone will see</h2>
        <span className="text-xs text-muted">the list in the week</span>
      </div>

      {lineup.length === 0 ? (
        <p className="text-[13px] text-faint">
          Nobody on the team yet. Invite someone from the Players page.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {lineup.map((m) => {
            const seat = roleName(m, roles);
            return (
              <li
                key={m.user_id}
                className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 odd:bg-bg"
              >
                <Avatar
                  name={m.profile?.display_name ?? "?"}
                  url={m.profile?.avatar_url}
                  size={30}
                />
                <div className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-[13px] font-bold">
                    {m.profile?.display_name ?? "Unknown"}
                  </span>
                  <span
                    className={`text-[11px] ${seat ? "text-muted" : "text-faint"}`}
                  >
                    {seat ?? "no role yet"}
                  </span>
                </div>
                <span className="ml-auto text-[11px] font-bold text-faint">
                  {roleLabel[m.role]}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col gap-1.5 border-t border-line-soft pt-3 text-[12px] leading-relaxed text-muted">
        {roles.length === 0 ? (
          <p>
            No roles yet, so people are listed by name. Add the seats your team
            uses — lanes, positions, Coach, Sub, whatever fits.
          </p>
        ) : (
          unset > 0 && (
            <p>
              {unset} member{unset === 1 ? " has" : "s have"} no role yet. You
              set that on the Players page.
            </p>
          )
        )}
        <p>
          A role is only a name. Who may change the plan comes from{" "}
          <strong className="text-ink">admin</strong>, not from this list.
        </p>
      </div>
    </Card>
  );
}

const lengthOptions = [1, 2, 3, 4, 5, 6].map((h) => ({
  value: h,
  label: `${h} h`,
}));

type Run = (fn: () => Promise<void>, done?: string) => Promise<void>;

/**
 * Det typen faktisk blir. Én ekte bookingkort per type, med fargen, lengda og
 * motstanderlinja — samme kortet som står i uka og på bildet du deler.
 * Ingen data hentes; dette er formen, ikke uka di.
 */
function TypePreview({ types }: { types: ActivityType[] }) {
  const active = types.filter((t) => !t.archived);
  return (
    <Card className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <h2 className="text-[15px] font-extrabold">
          What a booking looks like
        </h2>
        <span className="text-xs text-muted">in the week, and shared</span>
      </div>

      {active.length === 0 ? (
        <p className="text-[13px] text-faint">
          No types yet. Add one and it shows up here.
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {active.map((t, i) => {
            const p = palette[t.color];
            // Faste tall: dette er en form, ikke en uke. Dagene går rundt så to
            // typer ikke ser ut som samme booking.
            const day = i % 7;
            const start = 18 + (i % 3);
            return (
              <div
                key={t.id}
                className="flex min-w-0 items-center gap-3 rounded-xl px-3.5 py-3"
                style={{ background: p.soft }}
              >
                <div className="flex w-10 shrink-0 flex-col items-center leading-[1.1]">
                  <span
                    className="text-[10px] font-bold uppercase tracking-[0.06em]"
                    style={{ color: p.sub }}
                  >
                    {dayShort[day]}
                  </span>
                  <span
                    className="text-[17px] font-extrabold"
                    style={{ color: p.ink }}
                  >
                    {9 + day}
                  </span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    // Smal skjerm: la teksten bryte. «truncate» er nowrap, og da
                    // blir hele tittelen kortets minstebredde.
                    className="overflow-hidden text-[14px] font-extrabold sm:truncate"
                    style={{ color: p.ink }}
                  >
                    {t.name}
                    {t.ask_opponent && (
                      <span style={{ color: p.sub }}> vs Rival Ducks</span>
                    )}
                  </span>
                  <span className="text-[12px]" style={{ color: p.sub }}>
                    {slotLabel(start, start + t.default_hours)} ·{" "}
                    {t.default_hours} h
                  </span>
                </div>
                <DotRow can={[true, true, false, false, false]} />
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-1.5 border-t border-line-soft pt-3 text-[12px] leading-relaxed text-muted">
        <p>
          <strong className="text-ink">Asks opponent</strong> puts a «who are we
          playing?» field on the booking form. The name lands on the line above.
        </p>
        <p>
          The length is only where the booking starts out. You can change the
          hours on the booking itself.
        </p>
      </div>
    </Card>
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
    <Card className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-extrabold">Activity types</h2>
        <span className="text-xs text-muted">{active.length} of 12</span>
      </div>
      <div className="flex flex-col">
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
            className="mt-2 flex h-9 w-fit items-center gap-1.5 rounded-full border-[1.5px] border-dashed border-dot px-3.5 text-[13px] font-bold text-muted hover:border-faint hover:text-ink disabled:opacity-50"
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
        title="Pick a colour"
        className="h-[22px] w-[22px] shrink-0 rounded-full ring-2 ring-line-soft transition hover:ring-ink"
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
                  c === color
                    ? "0 0 0 2px var(--color-surface), 0 0 0 3.5px var(--color-ink)"
                    : "none",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * En type per rad, med kolonnene i flukt nedover: farge, navn, om den spør etter
 * motstander, og hvor lang den er. Navnet ser ut som tekst til du klikker i det —
 * en rad med tre ulike kontroller i ulike former blir bare støy.
 */
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
    // På mobil brekker raden i to: farge og navn øverst, innstillingene under.
    // Alt på én linje gjør navnefeltet så smalt at det ikke går an å skrive i.
    <div className="group -mx-2 flex flex-wrap items-center gap-2 rounded-xl border-t border-line-soft px-2 py-2 transition first:border-0 hover:border-transparent hover:bg-bg sm:grid sm:grid-cols-[22px_minmax(0,1fr)_auto_auto_32px] sm:gap-2.5">
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
        aria-label="Type name"
        className="h-9 w-full min-w-[130px] flex-1 basis-[calc(100%-30px)] border-transparent bg-transparent px-2 text-sm font-extrabold transition hover:border-line hover:bg-surface focus:border-line focus:bg-surface sm:w-auto sm:basis-auto"
      />
      <button
        type="button"
        onClick={() =>
          void run(() =>
            updateActivityType(type.id, { ask_opponent: !type.ask_opponent }),
          )
        }
        aria-pressed={type.ask_opponent}
        title="Does the booking form ask who you play against?"
        className={`flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-bold transition ${
          type.ask_opponent
            ? "bg-green-soft text-green-ink hover:brightness-95"
            : "bg-surface-2 text-muted hover:text-ink"
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${type.ask_opponent ? "bg-green-ink" : "bg-dot"}`}
        />
        {type.ask_opponent ? "Asks opponent" : "No opponent"}
      </button>
      <Dropdown
        value={type.default_hours}
        options={lengthOptions}
        onChange={(h) =>
          void run(() => updateActivityType(type.id, { default_hours: h }))
        }
        look="pill"
        aria-label="Default length"
        className="h-8 w-[74px] text-xs"
        menuWidth={100}
      />
      {confirm ? (
        <div className="flex w-full items-center justify-end gap-1.5 sm:col-start-3 sm:col-end-6 sm:w-auto">
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
          // Kommer fram når du peker på raden. På touch står det alltid.
          className="flex h-8 w-8 items-center justify-center rounded-[10px] text-faint opacity-0 transition hover:bg-red-soft hover:text-red-ink focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
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

/**
 * Lagets egen rolleliste. Navn, rekkefølge, legg til, fjern.
 * Rekkefølgen her er sorteringen i ukevisningen.
 */
/**
 * Lagets egen rolleliste. Navn, rekkefølge, legg til, fjern.
 * Rekkefølgen her er sorteringen i ukevisningen.
 *
 * Flytting skjer ved å dra i kortet. Mens du drar følger raden fingeren, og en tom
 * luke viser hvor den havner om du slipper. Piltastene gjør det samme uten mus.
 */
function RolesCard({
  teamId,
  roles,
  run,
}: {
  teamId: string;
  roles: TeamRole[];
  run: Run;
}) {
  const [name, setName] = useState("");
  const taken = roles.some(
    (r) => r.name.toLowerCase() === name.trim().toLowerCase(),
  );

  const listRef = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [target, setTarget] = useState(0);
  const [pointerY, setPointerY] = useState(0);

  // Lista uten den raden som blir dratt. Luken settes inn der den havner.
  const rest = drag ? roles.filter((r) => r.id !== drag.role.id) : roles;

  function startDrag(e: ReactPointerEvent, role: TeamRole, index: number) {
    const row = (e.currentTarget as HTMLElement).closest("li");
    const list = listRef.current;
    if (!row || !list) return;
    const rows = [...list.querySelectorAll("li")].map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, height: r.height };
    });
    const box = row.getBoundingClientRect();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({
      role,
      from: index,
      rows,
      grabOffset: e.clientY - box.top,
      left: box.left,
      width: box.width,
      height: box.height,
    });
    setTarget(index);
    setPointerY(e.clientY);
  }

  function moveDrag(e: ReactPointerEvent) {
    if (!drag) return;
    setPointerY(e.clientY);
    // Hvor mange rader (uten den dragde) har midtpunktet sitt over fingeren?
    const centers = drag.rows
      .filter((_, i) => i !== drag.from)
      .map((r) => r.top + r.height / 2);
    setTarget(centers.filter((c) => c < e.clientY).length);
  }

  function endDrag() {
    if (!drag) return;
    const next = roles.filter((r) => r.id !== drag.role.id);
    next.splice(target, 0, drag.role);
    setDrag(null);
    if (next.some((r, i) => r.id !== roles[i].id))
      void run(() => reorderTeamRoles(next), "Order saved");
  }

  /** Piltast opp/ned flytter raden ett hakk. */
  function nudge(index: number, by: number) {
    const to = index + by;
    if (to < 0 || to >= roles.length) return;
    const next = [...roles];
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved);
    void run(() => reorderTeamRoles(next), "Order saved");
  }

  const gap = drag ? (
    <li
      aria-hidden
      className="rounded-xl border-[1.5px] border-dashed border-green bg-green-soft/50"
      style={{ height: drag.height }}
    />
  ) : null;

  return (
    <Card className="flex flex-col gap-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-extrabold">Roles</h2>
        <span className="text-xs text-muted">
          {roles.length === 0 ? "none yet" : `${roles.length} of 20`}
        </span>
      </div>

      {roles.length === 0 ? (
        <p className="text-[13px] text-faint">No roles. Add one below.</p>
      ) : (
        <ul
          ref={listRef}
          className="flex flex-col gap-1"
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={() => setDrag(null)}
        >
          {rest.map((r) => (
            <Fragment key={r.id}>
              {target === rest.indexOf(r) ? gap : null}
              <li className="group flex h-10 items-center gap-2 rounded-[11px] bg-bg px-2 transition hover:bg-surface-2">
                <RoleGrip
                  label={r.name}
                  onPointerDown={(e) => startDrag(e, r, roles.indexOf(r))}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                      e.preventDefault();
                      nudge(roles.indexOf(r), e.key === "ArrowUp" ? -1 : 1);
                    }
                  }}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-bold">
                  {r.name}
                </span>
                <button
                  onClick={() =>
                    void run(() => deleteTeamRole(r.id), "Role removed")
                  }
                  aria-label={`Remove ${r.name}`}
                  title="Anyone with this role keeps their seat, just without a role"
                  // Kommer fram når du peker på raden. På touch står det alltid.
                  className="flex h-7 w-7 items-center justify-center rounded-full text-faint opacity-0 transition hover:bg-red-soft hover:text-red-ink focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  >
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </li>
            </Fragment>
          ))}
          {drag && target >= rest.length ? gap : null}
        </ul>
      )}

      {/* Raden som blir dratt, løftet ut av lista så den kan følge fingeren. */}
      {drag && (
        <div
          className="pointer-events-none fixed z-[80] flex items-center gap-2 rounded-xl bg-surface px-2 py-2 shadow-pop ring-1 ring-line"
          style={{
            left: drag.left,
            top: pointerY - drag.grabOffset,
            width: drag.width,
            height: drag.height,
          }}
        >
          <span className="flex h-7 w-7 items-center justify-center text-muted">
            <GripDots />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-bold">
            {drag.role.name}
          </span>
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-line pt-3.5">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add a role …"
          maxLength={24}
          className="h-10 flex-1 text-sm"
        />
        <Button
          size="sm"
          variant="secondary"
          className="h-10"
          disabled={name.trim().length === 0 || taken || roles.length >= 20}
          onClick={() =>
            void run(
              () => addTeamRole(teamId, name, (roles.at(-1)?.sort ?? 0) + 1),
              "Role added",
            ).then(() => setName(""))
          }
        >
          Add
        </Button>
      </div>
      {taken && (
        <p className="text-[13px] text-muted">
          That role is already in the list.
        </p>
      )}
    </Card>
  );
}

interface Drag {
  role: TeamRole;
  from: number;
  rows: { top: number; height: number }[];
  grabOffset: number;
  left: number;
  width: number;
  height: number;
}

function GripDots() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <circle cx="9" cy="6" r="1.7" />
      <circle cx="15" cy="6" r="1.7" />
      <circle cx="9" cy="12" r="1.7" />
      <circle cx="15" cy="12" r="1.7" />
      <circle cx="9" cy="18" r="1.7" />
      <circle cx="15" cy="18" r="1.7" />
    </svg>
  );
}

function RoleGrip({
  onPointerDown,
  onKeyDown,
  label,
}: {
  onPointerDown: (e: ReactPointerEvent) => void;
  onKeyDown: (e: ReactKeyboardEvent) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      aria-label={`Move ${label}. Use the arrow keys, or drag.`}
      // touch-none: uten denne scroller siden i stedet for at raden blir dratt.
      className="flex h-7 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-faint hover:bg-surface-2 hover:text-muted active:cursor-grabbing"
    >
      <GripDots />
    </button>
  );
}

/**
 * Laget: navn, deling, eierskap — og sletting for seg selv, med rød ramme.
 * Det farligste og det hverdagslige skal ikke ligge i samme boks.
 */
/**
 * Delinga: bryteren, lenka, og hva den faktisk viser.
 *
 * Sida er bygd som en historie ovenfra og ned: hva dette er, bryteren som slår
 * det på, lenka for den uka du vil dele, og bildet folk faktisk får se. Nederst
 * tre kort om hva lenka gir bort — det er spørsmålet alle stiller først.
 */
function SharingTab({
  team,
  week,
  run,
  onTeamsChanged,
}: {
  team: MyTeam;
  week: WeekData;
  run: Run;
  onTeamsChanged: () => Promise<void>;
}) {
  const thisMonday = weekStart(new Date());
  const [step, setStep] = useState(0);
  const [rotating, setRotating] = useState(false);
  const monday = shiftWeek(thisMonday, step);
  const id = weekId(monday);
  const link = shareLink(team.share_slug, id);
  const isOwner = team.role === "owner";
  const on = team.share_enabled;

  // Bildet tegnes med ekte bookinger når uka du står på er den appen har lastet.
  // Bladd bort fra den har vi ingen data, og da tegner vi rammen uten rader.
  const sameWeek = weekId(week.monday) === id;
  const rows = sameWeek
    ? [...week.events]
        .sort(
          (a, b) => a.date.localeCompare(b.date) || a.start_hour - b.start_hour,
        )
        .slice(0, 4)
        .map((e) => ({
          id: e.id,
          date: e.date,
          title: eventTitle(e, week.types),
          opponent: e.opponent,
          accent: eventPalette(e, week.types).ink,
          hours: slotLabel(e.start_hour, e.end_hour),
        }))
    : null;

  function toggle(v: boolean) {
    void run(
      () => setShareEnabled(team.id, v),
      v ? "Sharing is on" : "Sharing is off",
    ).then(onTeamsChanged);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 px-1">
        <Eyebrow>Sharing</Eyebrow>
        <h2 className="text-[22px] font-extrabold tracking-tight">
          Show the week outside the team
        </h2>
        <p className="max-w-[62ch] text-[14px] leading-relaxed text-muted">
          One link per week, for people who are not on the team. Paste it in a
          Discord channel and it unfolds as a picture of the week.
        </p>
      </div>

      {/* Meldinga står med bunnen i flukt med delingsboksen (justify-end i
          previewen), ikke løs oppe i hjørnet. */}
      <Card className="grid gap-7 p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,470px)] lg:p-7">
        <div className="flex min-w-0 flex-col gap-5">
          {/* Bryteren: stor, og den sier hva den slår på. Er den av, er det
              ingenting annet å gjøre her, så da er knappen det eneste du ser. */}
          <div
            className={`flex flex-col gap-3.5 rounded-[16px] border-[1.5px] p-4 transition ${
              on ? "border-green-dim bg-green-soft/50" : "border-line bg-bg"
            }`}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                    on ? "bg-green text-white" : "bg-surface-2 text-faint"
                  }`}
                >
                  {on ? <Check size={16} /> : <LockIcon />}
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="text-[15px] font-extrabold">
                    {on ? "Sharing is on" : "Sharing is off"}
                  </span>
                  <span className="text-[13px] text-muted">
                    {on
                      ? "Anyone with the link can open the week."
                      : isOwner
                        ? "The link answers nothing until you turn it on."
                        : "Only the owner can turn this on."}
                  </span>
                </div>
              </div>
              {/* Bare eieren får skru på delinga — det er basen som bestemmer det,
                  så en admin skal ikke få en bryter som ikke gjør noe. */}
              {!isOwner ? (
                <span className="shrink-0 rounded-full bg-surface-2 px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted">
                  Owner only
                </span>
              ) : on ? (
                <Toggle on onChange={toggle} label="Sharing" />
              ) : (
                <Button
                  size="sm"
                  className="h-10 shrink-0"
                  onClick={() => toggle(true)}
                >
                  Turn on sharing
                </Button>
              )}
            </div>

            {on && (
              <div className="flex flex-col gap-3 border-t border-green-dim/40 pt-3.5">
                {/* Lenka gjelder én uke. Velgeren er så bred som teksten sin,
                    ikke så bred som kortet — pilene skal stå ved uka, ikke i
                    hver sin ende. */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex w-fit items-center gap-0.5 rounded-full bg-surface p-1 shadow-card">
                    <StepButton
                      label="Week before"
                      dir="left"
                      onClick={() => setStep((n) => n - 1)}
                    />
                    <span className="whitespace-nowrap px-1.5 text-[13px] font-extrabold">
                      Week {Number(id.slice(-2))}
                      <span className="font-semibold text-muted">
                        {" · "}
                        {formatRange(monday)}
                      </span>
                    </span>
                    <StepButton
                      label="Week after"
                      dir="right"
                      onClick={() => setStep((n) => n + 1)}
                    />
                  </div>
                  {step === 0 ? (
                    // Datoene står allerede i pilla. På mobil blir denne bare en
                    // løs linje under, så der lar vi den være.
                    <span className="hidden text-[12px] font-bold text-faint sm:inline">
                      this week
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setStep(0)}
                      className="text-[12px] font-bold text-muted underline decoration-line underline-offset-2 hover:text-ink"
                    >
                      Back to this week
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* På mobil er lenka lang og knappen bred: da får de hver sin linje. */}
                  <Input
                    readOnly
                    value={link}
                    aria-label="Link for this week"
                    className="h-11 w-full min-w-0 flex-1 basis-full text-[13px] sm:w-auto sm:basis-auto"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button
                    className="h-11 w-full px-5 sm:w-auto"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(link)
                        .then(() => run(async () => {}, "Link copied"))
                    }
                  >
                    Copy link
                  </Button>
                </div>

                <a
                  href={`/share/${team.share_slug}?week=${id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-9 w-fit items-center gap-2 rounded-full border-[1.5px] border-line bg-surface px-3.5 text-[13px] font-bold transition hover:border-faint"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M14 4h6v6M20 4l-9 9" />
                    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
                  </svg>
                  See it as a guest
                </a>

                {/* Å bytte lenke er sikkerhetsknappen på denne siden: den tar
                    tilbake alt du har delt. Da skal den stå for seg selv, si hva
                    den gjør, og spørre én gang før den gjør det. */}
                {isOwner && (
                  <div className="flex flex-col gap-2.5 rounded-[12px] border-[1.5px] border-line bg-surface p-3">
                    <div className="flex items-start gap-2.5">
                      <span className="mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
                        <svg
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M20 12a8 8 0 1 1-2.5-5.8" />
                          <path d="M20 4v4h-4" />
                        </svg>
                      </span>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-[13px] font-extrabold">
                          Shared it somewhere you regret?
                        </span>
                        <p className="text-[12px] leading-relaxed text-muted">
                          Make a new link and this team starts over on a new
                          code. Every link you have handed out before stops
                          working the second you do it.
                        </p>
                      </div>
                    </div>
                    {rotating ? (
                      <div className="flex flex-wrap items-center gap-2 pl-9">
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-9"
                          onClick={() => setRotating(false)}
                        >
                          Keep this link
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          className="h-9"
                          onClick={() => {
                            setRotating(false);
                            void run(
                              () => rotateShareSlug(team.id).then(() => {}),
                              "New link made · every old one stopped working",
                            ).then(onTeamsChanged);
                          }}
                        >
                          Yes, replace it
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-9 w-fit self-start"
                        onClick={() => setRotating(true)}
                      >
                        Make a new link
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Ny uke = nytt bilde: nøkkelen nullstiller «det gikk ikke» fra forrige. */}
        <DiscordPreview
          key={id}
          on={on}
          link={link}
          teamName={team.name}
          week={id}
          range={formatRange(monday)}
          rows={rows}
          image={shareImage(team.share_slug, id)}
        />
      </Card>

      {/* Spørsmålet alle stiller: hva ser de? Tre svar, ett per kort. */}
      <div className="grid gap-4 md:grid-cols-3">
        <FactCard
          tone="yes"
          title="They see"
          icon={
            <>
              <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
              <circle cx="12" cy="12" r="3" />
            </>
          }
        >
          What is booked that week, who joined it, and the blocks where the
          whole team is free.
        </FactCard>
        <FactCard
          tone="no"
          title="They never see"
          icon={
            <>
              <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
              <path d="M4 4l16 16" />
            </>
          }
        >
          Who is free when. No names against hours, no accounts, and nothing
          about the people who did not join.
        </FactCard>
        <FactCard
          tone="key"
          title="You keep the key"
          icon={
            <>
              <rect x="4" y="10" width="16" height="11" rx="3" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </>
          }
        >
          Turn sharing off and every link goes quiet. Make a new one and the old
          one dies on the spot. The code is 14 characters out of 31, so it
          cannot be guessed.
        </FactCard>
      </div>
    </div>
  );
}

/** Ett tilgangsnivå. Ditt eget er merket, så du ser hvor du selv står. */
function AccessLine({
  level,
  you,
  text,
}: {
  level: string;
  you: boolean;
  text: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-line-soft pt-2.5 first:border-0 first:pt-0">
      <span className="flex items-center gap-2">
        <span className="text-[13px] font-extrabold">{level}</span>
        {you && (
          <span className="rounded-full bg-green-soft px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.06em] text-green-ink">
            You
          </span>
        )}
      </span>
      <span className="text-[12px] leading-relaxed text-muted">{text}</span>
    </div>
  );
}

/** Ett svar om delinga. Ikonet bærer tonen, så teksten slipper å si «husk at». */
function FactCard({
  tone,
  title,
  icon,
  children,
}: {
  tone: "yes" | "no" | "key";
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  const skin =
    tone === "yes"
      ? "bg-green-soft text-green-ink"
      : tone === "no"
        ? "bg-surface-2 text-faint"
        : "bg-surface-2 text-muted";
  return (
    <Card className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] ${skin}`}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {icon}
          </svg>
        </span>
        <h3 className="text-[14px] font-extrabold">{title}</h3>
      </div>
      <p className="text-[13px] leading-relaxed text-muted">{children}</p>
    </Card>
  );
}

/** Hengelåsen i bryteren når delinga er av. */
function LockIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="10" width="16" height="11" rx="3" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/** Pila fram og tilbake i uke-velgeren. */
function StepButton({
  label,
  dir,
  onClick,
}: {
  label: string;
  dir: "left" | "right";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 hover:text-ink"
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={dir === "left" ? "M14 6l-6 6 6 6" : "M10 6l6 6-6 6"} />
      </svg>
    </button>
  );
}

/**
 * Laget selv: navnet, eieren, og knappen som sletter alt. Delinga har sin egen
 * fane — den handler om folk utenfor laget, ikke om laget.
 */
function TeamPanel({
  team,
  members,
  roles,
  run,
  onTeamsChanged,
}: {
  team: MyTeam;
  members: MemberWithProfile[];
  roles: TeamRole[];
  run: Run;
  onTeamsChanged: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState(team.name);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [newOwner, setNewOwner] = useState("");
  const others = members.filter((m) => m.role !== "owner");
  const owner = members.find((m) => m.role === "owner");
  const counts = {
    owner: members.filter((m) => m.role === "owner").length,
    admin: members.filter((m) => m.role === "admin").length,
    member: members.filter((m) => m.role === "member").length,
  };
  const [error, setError] = useState<string | null>(null);
  const isOwner = team.role === "owner";
  // created_at er tom i forhåndsvisningen og kan være rar fra basen: vis den bare når den er en dato.
  const madeAt = new Date(team.created_at);
  const made = Number.isNaN(madeAt.getTime())
    ? null
    : madeAt.toLocaleDateString(undefined, { month: "long", year: "numeric" });

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
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 px-1">
        <Eyebrow>Team</Eyebrow>
        <h2 className="text-[22px] font-extrabold tracking-tight">
          The team itself
        </h2>
        <p className="max-w-[62ch] text-[14px] leading-relaxed text-muted">
          What it is called, who owns it, and who is allowed to change what. The
          link you share has its own tab.
        </p>
      </div>

      {/* Navnet, med laget slik det ser ut i menyen ved siden av. */}
      <Card className="grid gap-6 p-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
        <div className="flex flex-col gap-3">
          <h2 className="text-[15px] font-extrabold">Team name</h2>
          {/* Feltet er så bredt som et lagnavn trenger. Strekker det seg over
              hele kortet, ser det ut som en tom linje som venter på noe annet.
              Bare eieren kan bytte navn, så andre får se det, ikke skrive i det. */}
          {isOwner ? (
            <div className="flex max-w-[420px] flex-wrap items-center gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                aria-label="Team name"
                className="h-11 w-full min-w-0 flex-1 basis-full text-[15px] font-bold sm:w-auto sm:basis-auto"
              />
              <Button
                className="h-11 w-full shrink-0 sm:w-auto"
                variant="secondary"
                disabled={name.trim().length < 2 || name.trim() === team.name}
                onClick={() =>
                  void run(
                    () => renameTeam(team.id, name),
                    "Team renamed",
                  ).then(onTeamsChanged)
                }
              >
                Rename
              </Button>
            </div>
          ) : (
            <span className="flex h-11 max-w-[420px] items-center rounded-xl bg-bg px-4 text-[15px] font-bold">
              {team.name}
            </span>
          )}
          <p className="max-w-[46ch] text-[13px] text-muted">
            Everyone on the team sees this, and so does anyone who opens a
            shared week.
            {isOwner ? "" : " Only the owner can change it."}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:border-l sm:border-line-soft sm:pl-6">
          <h2 className="text-[15px] font-extrabold">On the team</h2>
          <div className="flex items-center gap-3">
            <AvatarStack people={members} size={30} />
            <span className="text-[13px] font-bold">
              {members.length} of 15
            </span>
          </div>
          <p className="text-[13px] text-muted">
            {counts.owner} owner · {counts.admin}{" "}
            {counts.admin === 1 ? "admin" : "admins"} · {counts.member}{" "}
            {counts.member === 1 ? "member" : "members"}
            {made ? ` · made ${made}` : ""}
          </p>
          <button
            type="button"
            onClick={() => navigate(`/team/${team.id}/players`)}
            className="flex h-9 w-fit items-center gap-1.5 rounded-full border-[1.5px] border-line px-3.5 text-[13px] font-bold transition hover:border-faint"
          >
            Invite and manage
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </Card>

      {/* Eier og tilgang: hvem bestemmer, og hva de tre nivåene faktisk gir. */}
      <Card className="grid gap-6 p-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
        <div className="flex flex-col gap-3">
          <h2 className="text-[15px] font-extrabold">Owner</h2>
          <div className="flex items-center gap-2.5">
            <Avatar
              name={owner?.profile?.display_name ?? "?"}
              url={owner?.profile?.avatar_url}
              size={36}
            />
            <div className="flex flex-col leading-tight">
              <span className="text-[14px] font-extrabold">
                {owner?.profile?.display_name ?? "Unknown"}
                {isOwner && (
                  <span className="font-bold text-muted"> · you</span>
                )}
              </span>
              <span className="text-[12px] text-muted">
                Owns the team since it was made
              </span>
            </div>
          </div>
          {isOwner ? (
            <>
              <div className="flex max-w-[420px] flex-wrap items-center gap-2 border-t border-line-soft pt-3">
                <Dropdown
                  value={newOwner}
                  // Navn alene sier lite når laget er stort. Ansiktet og
                  // tilgangen gjør at du treffer riktig person.
                  options={others.map((m) => ({
                    value: m.user_id,
                    label: m.profile?.display_name ?? "Unknown",
                    hint: `${roleName(m, roles) ?? "no role"} · ${roleLabel[m.role]}`,
                    icon: (
                      <Avatar
                        name={m.profile?.display_name ?? "?"}
                        url={m.profile?.avatar_url}
                        size={26}
                      />
                    ),
                  }))}
                  onChange={setNewOwner}
                  separated
                  placeholder={
                    others.length === 0
                      ? "No one else on the team yet"
                      : "Hand the team to …"
                  }
                  disabled={others.length === 0}
                  menuWidth={280}
                  className="h-11 w-full min-w-0 flex-1 basis-full text-sm sm:w-auto sm:basis-auto"
                />
                <Button
                  variant="secondary"
                  className="h-11 w-full shrink-0 sm:w-auto"
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
              <p className="text-[13px] text-muted">
                Hand it over and you keep your seat as an admin. There is only
                ever one owner.
              </p>
            </>
          ) : (
            <p className="border-t border-line-soft pt-3 text-[13px] text-muted">
              Only the owner can rename the team, change the time zone, hand the
              team over or delete it.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2.5 sm:border-l sm:border-line-soft sm:pl-6">
          <h2 className="text-[15px] font-extrabold">Who can do what</h2>
          <AccessLine
            level="Owner"
            you={team.role === "owner"}
            text="Everything an admin can, plus the name, the time zone, the link and this team's life."
          />
          <AccessLine
            level="Admin"
            you={team.role === "admin"}
            text="Sets up the week, books activities, and invites or removes people."
          />
          <AccessLine
            level="Member"
            you={team.role === "member"}
            text="Marks their own hours and joins what is booked."
          />
        </div>
      </Card>

      {/* Sletting: en stripe, ikke et kort. Den skal ikke se ut som noe du gjør ofte. */}
      {isOwner && (
        <div className="flex flex-col gap-2.5 rounded-[16px] border-[1.5px] border-red-line bg-red-soft/40 px-4 py-3.5">
          {deleting ? (
            <>
              <span className="text-[13px] font-extrabold text-red-ink">
                This removes the team, every member, all availability and all
                bookings. There is no undo.
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {/* Navnefeltet tar hele linja på mobil: klemt inn ved siden av to
                    knapper ser du ikke hva du skriver. */}
                <Input
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder={`Type "${team.name}" to confirm`}
                  className="h-10 w-full min-w-0 flex-1 basis-full text-sm sm:w-auto sm:basis-auto"
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
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[13px] text-muted">
                <strong className="text-red-ink">Delete team.</strong>{" "}
                Everything goes: members, availability, bookings. There is no
                undo.
              </span>
              <Button
                size="sm"
                variant="secondary"
                className="h-9 shrink-0"
                onClick={() => setDeleting(true)}
              >
                Delete team …
              </Button>
            </div>
          )}
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </div>
  );
}

/**
 * Meldinga slik den blir seende ut i en kanal.
 *
 * Bildet er det ekte: samme URL Discord henter. Går den ikke gjennom — lokalt,
 * eller før uka er publisert — tegner vi bildet i stedet, med de samme radene
 * som havner i det. Da står det aldri en tom boks her.
 */
function DiscordPreview({
  on,
  link,
  teamName,
  week,
  range,
  rows,
  image,
}: {
  on: boolean;
  link: string;
  teamName: string;
  week: string;
  range: string;
  rows: ShareRow[] | null;
  image: string;
}) {
  const [broken, setBroken] = useState(false);
  const number = Number(week.slice(-2));

  return (
    <div className="flex h-full min-w-0 flex-col justify-end gap-2">
      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-faint">
        In a channel
      </span>
      <div
        className={`rounded-[16px] bg-[#313338] p-3.5 transition ${on ? "" : "opacity-60 saturate-0"}`}
      >
        <div className="flex min-w-0 gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#5865F2] text-[13px] font-extrabold text-white">
            {teamName.slice(0, 1).toUpperCase()}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex items-baseline gap-2">
              <span className="text-[13px] font-bold text-white">You</span>
              <span className="text-[10px] text-[#949ba4]">today</span>
            </span>
            <span className="truncate text-[12px] text-[#00a8fc]">{link}</span>

            <div className="mt-1 flex flex-col gap-1.5 rounded-[6px] border-l-4 border-[#5865F2] bg-[#2b2d31] p-3">
              <span className="text-[13px] font-bold text-[#00a8fc]">
                {teamName} · Week {number}
              </span>
              {on && !broken ? (
                <img
                  src={image}
                  alt=""
                  loading="lazy"
                  onError={() => setBroken(true)}
                  className="w-full rounded-[4px]"
                />
              ) : (
                <SharePicture
                  teamName={teamName}
                  number={number}
                  range={range}
                  rows={on ? rows : null}
                  off={!on}
                />
              )}
            </div>
          </div>
        </div>
      </div>
      <span className="text-[11px] text-faint">
        The picture is made when someone opens the link, so it is never older
        than the week itself.
      </span>
    </div>
  );
}

interface ShareRow {
  id: string;
  date: string;
  title: string;
  opponent: string | null;
  accent: string;
  hours: string;
}

/**
 * Bildet, tegnet i appen. Samme oppsett som det ekte: lagnavn og ukenummer
 * øverst, datoene til høyre, og én rad per booking under.
 */
function SharePicture({
  teamName,
  number,
  range,
  rows,
  off,
}: {
  teamName: string;
  number: number;
  range: string;
  rows: ShareRow[] | null;
  off: boolean;
}) {
  return (
    <div className="flex aspect-[5/3] flex-col justify-between rounded-[4px] bg-[#F6F5F2] p-3 text-[#1C1B19]">
      <div className="flex items-end justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[8px] font-bold uppercase tracking-[0.12em] text-[#6F6C66]">
            {teamName}
          </span>
          <span className="text-[22px] font-extrabold leading-none tracking-tight">
            Week {number}
          </span>
        </div>
        <span className="shrink-0 text-[10px] font-extrabold">{range}</span>
      </div>

      <div className="flex flex-1 flex-col justify-center gap-1.5 py-2">
        {off ? (
          <span className="text-center text-[10px] font-bold text-[#6F6C66]">
            Sharing is off — this link answers nothing.
          </span>
        ) : rows && rows.length > 0 ? (
          rows.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-2 overflow-hidden rounded-[5px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
            >
              <span
                className="h-8 w-[4px] shrink-0"
                style={{ background: r.accent }}
              />
              <span className="flex w-8 shrink-0 flex-col items-center leading-none">
                <span className="text-[7px] font-bold uppercase tracking-[0.1em] text-[#6F6C66]">
                  {
                    dayShort[
                      (new Date(r.date + "T00:00:00Z").getUTCDay() + 6) % 7
                    ]
                  }
                </span>
                <span className="text-[13px] font-extrabold">
                  {Number(r.date.slice(-2))}
                </span>
              </span>
              <span className="min-w-0 flex-1 truncate text-[10px] font-extrabold">
                {r.title}
                {r.opponent && (
                  <span className="font-bold text-[#6F6C66]">
                    {" "}
                    vs {r.opponent}
                  </span>
                )}
              </span>
              <span className="shrink-0 pr-2 text-[9px] font-extrabold tabular-nums">
                {r.hours}
              </span>
            </div>
          ))
        ) : rows ? (
          <div className="flex flex-col rounded-[5px] bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
            <span className="text-[11px] font-extrabold">
              Nothing booked yet
            </span>
            <span className="text-[9px] font-semibold text-[#6F6C66]">
              The picture updates itself when someone books an activity.
            </span>
          </div>
        ) : (
          // Andre uker enn den appen har lastet: vi vet ikke hva som står der.
          [0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-[5px] bg-white px-2 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
            >
              <span className="h-4 w-[4px] shrink-0 rounded-full bg-[#E4E1DA]" />
              <span className="h-2 flex-1 rounded-full bg-[#EDEBE5]" />
              <span className="h-2 w-8 shrink-0 rounded-full bg-[#EDEBE5]" />
            </div>
          ))
        )}
      </div>

      <span className="truncate text-right text-[7px] font-bold text-[#B5B1AA]">
        {appBase().replace(/^https?:\/\//, "")}
      </span>
    </div>
  );
}
