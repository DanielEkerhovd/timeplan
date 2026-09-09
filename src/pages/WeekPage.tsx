import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { lineupOrder } from "../lib/settings";
import type { MyTeam } from "../lib/teams";
import { canEdit } from "../lib/types";
import { useZone } from "../lib/zone";
import { weekLock } from "../lib/week";
import type { WeekData } from "../lib/useWeekData";
import PlayerWeek from "../components/PlayerWeek";
import TeamOverview, { type FormState } from "../components/TeamOverview";
import WeekNav from "../components/WeekNav";
import { Button, Spinner } from "../components/ui";

/** The Week tab: My week for everyone, Plan week for owner and admins. */
export default function WeekPage({
  team,
  week,
}: {
  team: MyTeam;
  week: WeekData;
}) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const editor = canEdit(team.role);
  const tab: "me" | "team" =
    editor && params.get("view") === "team" ? "team" : "me";
  const [form, setForm] = useState<FormState>(null);

  function setTab(next: "me" | "team") {
    if (next === "team") params.set("view", "team");
    else params.delete("view");
    setParams(params, { replace: true });
  }

  const members = useMemo(
    () => lineupOrder(week.members ?? [], week.roles),
    [week.members, week.roles],
  );

  // Klokkeslettene vises i din sone. Står du et annet sted enn laget, må det stå hvor
  // tallene kommer fra — ellers avtaler to personer «19:00» og møter til hver sin tid.
  const zone = useZone();

  const toggle = editor && (
    <div className="flex w-fit gap-1 rounded-[10px] bg-surface p-[3px] shadow-card lg:w-full">
      <TabButton active={tab === "me"} onClick={() => setTab("me")}>
        My week
      </TabButton>
      <TabButton active={tab === "team"} onClick={() => setTab("team")}>
        <span className="sm:hidden">Plan</span>
        <span className="hidden sm:inline">Plan week</span>
      </TabButton>
    </div>
  );

  // Always in the layout so the toggle never moves; just invisible on My week.
  const locked = weekLock(week.monday) !== null;
  const newActivity = editor && (
    <Button
      variant="secondary"
      size="sm"
      aria-hidden={tab !== "team" || locked}
      tabIndex={tab === "team" && !locked ? 0 : -1}
      className={`h-[38px] ${tab === "team" && !locked ? "" : "pointer-events-none invisible"}`}
      onClick={() => {
        const first = week.slots?.[0];
        const today = week.days.find((d) => d.isToday) ?? week.days[0];
        setForm({
          existing: null,
          draft: {
            date: today.key,
            start_hour: first?.start_hour ?? 19,
            end_hour: first?.end_hour ?? 22,
          },
        });
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
      <span className="hidden sm:inline">New activity</span>
      <span className="sm:hidden">New</span>
    </Button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <WeekNav
        monday={week.monday}
        isCurrentWeek={week.isCurrentWeek}
        onPrev={week.prevWeek}
        onNext={week.nextWeek}
        onToday={week.thisWeek}
        actions={
          editor ? (
            <div className="flex items-center justify-between gap-3">
              {toggle}
              {newActivity}
            </div>
          ) : undefined
        }
        leftActions={newActivity || undefined}
        rightActions={toggle || undefined}
      />
      {zone.diff !== 0 && (
        <p className="rounded-[12px] bg-surface px-3.5 py-2.5 text-[13px] font-semibold text-muted shadow-card">
          Times are shown in your timezone ({zone.yourZone.replace(/_/g, " ")}).
          The team plans in {zone.teamZone.replace(/_/g, " ")}.
        </p>
      )}
      {!user || week.members === null ? (
        <Spinner />
      ) : tab === "team" ? (
        <TeamOverview
          team={team}
          members={members}
          week={week}
          form={form}
          setForm={setForm}
        />
      ) : (
        <PlayerWeek
          team={team}
          userId={user.id}
          members={members}
          week={week}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-8 whitespace-nowrap rounded-lg px-3.5 text-[13px] font-bold sm:px-4 lg:flex-1 ${active ? "bg-ink text-on-ink" : "text-muted hover:text-ink"}`}
    >
      {children}
    </button>
  );
}
