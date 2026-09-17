-- Påminnelse før en aktivitet (discord_schedules.same_day_*). Klokka
-- (api/discord/cron.ts) finner aktiviteter som starter innen lagets valgte
-- antall timer, sender et kort til dem som har sagt ja, og stempler raden.
-- Stempelet er det som gjør at en påminnelse går én gang. Flyttes aktiviteten
-- etterpå, nullstilles det, så den nye tida får sin egen påminnelse.

alter table public.events
  add column if not exists reminder_sent_at timestamptz;

-- Bare serveren skriver stempelet. Klienten har kolonnevise grants på events
-- (0002) og får ikke denne. Medlemmer leser den med resten av raden; den sier
-- ikke mer enn "påminnelsen har gått".

create or replace function public.events_reset_reminder()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.date is distinct from old.date or new.start_hour is distinct from old.start_hour then
    new.reminder_sent_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists events_reset_reminder on public.events;
create trigger events_reset_reminder
  before update on public.events
  for each row execute function public.events_reset_reminder();

-- Aktiviteter som kan trenge påminnelse: framover i tid, ikke stemplet, i et lag
-- med boten koblet og påminnelser på. Klokka regner selve tidspunktet (lagets
-- sone) og sender; dette er bare utvalget, så den slipper å lese alle events.
create or replace function public.discord_reminder_candidates()
returns table (
  event_id uuid,
  team_id uuid,
  timezone text,
  team_name text,
  date date,
  start_hour numeric,
  end_hour numeric,
  title text,
  opponent text,
  color text,
  hours_before numeric,
  mode text
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.team_id, t.timezone, t.name,
         e.date, e.start_hour, e.end_hour,
         coalesce(ty.name, e.title), e.opponent, coalesce(ty.color, e.color),
         s.same_day_hours, s.same_day_mode
  from public.events e
  join public.teams t on t.id = e.team_id
  join public.discord_schedules s on s.team_id = e.team_id and s.same_day_enabled
  join public.discord_links l on l.team_id = e.team_id
  left join public.activity_types ty on ty.id = e.type_id
  where e.reminder_sent_at is null
    and e.date between current_date - 1 and current_date + 3;
$$;

revoke execute on function public.discord_reminder_candidates() from public, anon, authenticated;
grant execute on function public.discord_reminder_candidates() to service_role;
