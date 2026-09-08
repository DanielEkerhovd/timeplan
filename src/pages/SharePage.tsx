import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { palette } from "../lib/colors";
import { fetchSharedWeek, type ShareWeek } from "../lib/share";
import {
  dayShort,
  daysOfWeek,
  formatRange,
  fromDateKey,
  slotLabel,
  toDateKey,
  weekId,
  weekStartFromId,
} from "../lib/week";
import { Avatar, Button, Spinner } from "../components/ui";

/**
 * Read-only week for anyone with the link. No login. Shows booked activities and the blocks
 * where the whole team is free — never who is free when.
 */
export default function SharePage() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const monday = weekStartFromId(params.get("week"));
  const days = daysOfWeek(monday);
  const [data, setData] = useState<ShareWeek | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetchSharedWeek(slug, toDateKey(monday))
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, params.get("week")]);

  if (data === undefined) return <Spinner className="min-h-dvh" />;

  if (data === null) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-[22px] font-extrabold tracking-tight">
          This link is not active
        </h1>
        <p className="text-sm leading-relaxed text-muted">
          The team has turned sharing off, or the link has been replaced. Ask
          the owner for a new one.
        </p>
        <Link to="/" className="text-sm font-bold text-green-ink">
          Open the app
        </Link>
      </main>
    );
  }

  const number = weekId(monday).slice(-2).replace(/^0/, "");
  const activities = data.days.reduce((n, d) => n + d.events.length, 0);

  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-6 px-5 pb-12 pt-10 lg:px-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted">
            {data.team.name}
          </div>
          <h1 className="text-[34px] font-extrabold leading-none tracking-tight">
            Week {number}
          </h1>
        </div>
        <div className="flex flex-col gap-0.5 sm:items-end">
          <div className="text-lg font-bold">{formatRange(monday)}</div>
          <div className="text-sm text-muted">
            {activities === 0
              ? "Nothing booked yet"
              : `${activities} activit${activities === 1 ? "y" : "ies"} this week`}
          </div>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
        {data.days.map((d, i) => {
          const day = days[i];
          const date = fromDateKey(d.date);
          const empty = d.events.length === 0 && d.free.length === 0;
          return (
            <section
              key={d.date}
              className="flex min-h-[180px] flex-col gap-3 rounded-[18px] bg-surface px-3.5 py-4 shadow-card"
            >
              <div className="flex flex-col">
                <span
                  className={`text-[15px] font-bold ${day?.isToday ? "text-green-ink" : "text-muted"}`}
                >
                  {dayShort[i]}
                </span>
                <span className="text-2xl font-extrabold">
                  {format(date, "d")}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {d.events.map((e, j) => {
                  const p = palette[e.color] ?? palette.grey;
                  return (
                    <div
                      key={j}
                      className="flex flex-col gap-0.5 rounded-xl px-3 py-2.5"
                      style={{ background: p.soft }}
                    >
                      <div
                        className="text-[13px] font-extrabold"
                        style={{ color: p.ink }}
                      >
                        {e.title}
                      </div>
                      {e.opponent && (
                        <div
                          className="text-xs font-semibold"
                          style={{ color: p.sub }}
                        >
                          {e.opponent}
                        </div>
                      )}
                      <div
                        className="whitespace-nowrap text-[13px] font-semibold"
                        style={{ color: p.sub }}
                      >
                        {slotLabel(e.start_hour, e.end_hour)}
                      </div>
                      {e.people.length > 0 && (
                        <div className="flex items-center pt-1">
                          {e.people.map((person, k) => (
                            <div
                              key={k}
                              style={{ marginLeft: k === 0 ? 0 : -7 }}
                              title={person.name}
                            >
                              <Avatar
                                name={person.name}
                                url={person.avatar}
                                size={22}
                                ring={p.soft}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {d.free.map((f, j) => (
                  <div
                    key={`f${j}`}
                    className="flex flex-col gap-0.5 rounded-xl border-[1.5px] border-dashed px-2.5 py-2" style={{ borderColor: "var(--free-border)", background: "var(--free-bg)" }}
                  >
                    <div className="whitespace-nowrap text-[13px] font-bold" style={{ color: "var(--free-ink)" }}>
                      Everyone free
                    </div>
                    <div className="whitespace-nowrap text-[13px] font-semibold" style={{ color: "var(--free-sub)" }}>
                      {slotLabel(f.start_hour, f.end_hour)}
                    </div>
                    <div className="text-[11px] font-semibold" style={{ color: "var(--free-note)" }}>
                      not booked
                    </div>
                  </div>
                ))}
                {empty && (
                  <div className="px-0.5 py-1 text-[13px] font-semibold text-faint">
                    Free
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <footer className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-[13px] text-muted">
          Times are in {data.team.timezone}. Shared from the team's schedule.
        </span>
        <Link to="/">
          <Button variant="secondary" size="sm">
            {user ? "Open the app" : "Sign in to mark your evenings"}
          </Button>
        </Link>
      </footer>
    </main>
  );
}
