-- Purring for neste uke (discord_schedules.nudge_*). På valgt ukedag og
-- klokkeslett finner klokka de på laget som ikke har krysset av én eneste time
-- for neste uke, og ber dem gjøre det — i kanalen, som DM, eller begge.
--
-- Én purring per uke per lag. `discord_nudge` holder hvilken uke som sist ble
-- purret; er den allerede purret, skjer ingenting. Har alle svart, stemples uka
-- uten at noen får melding.

alter table public.discord_schedules
  add column if not exists nudge_mode text not null default 'channel'
  check (nudge_mode in ('channel', 'dm', 'both'));

grant update (nudge_mode) on public.discord_schedules to authenticated;

create table if not exists public.discord_nudge (
  team_id     uuid primary key references public.teams (id) on delete cascade,
  week_start  date not null,
  sent_at     timestamptz not null default now()
);

-- Serverens bok. Klienten har ingenting her å gjøre: loggen viser purringene.
alter table public.discord_nudge enable row level security;
grant all on public.discord_nudge to service_role;

-- Hvem mangler tidene sine for uka? Én rad per medlem uten en eneste avkryssing
-- i uka. `discord_id` er null for dem som ikke har logget inn med Discord —
-- de kan ikke pinges, men skal telles med og nevnes ved navn.
create or replace function public.discord_nudge_missing(team uuid, week_start date)
returns table (name text, discord_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.display_name, p.discord_id
  from public.members m
  join public.profiles p on p.user_id = m.user_id
  where m.team_id = team
    and not exists (
      select 1
      from public.availability a
      where a.team_id = team
        and a.user_id = m.user_id
        and a.date >= week_start
        and a.date < week_start + 7
    )
  order by p.display_name;
$$;

revoke execute on function public.discord_nudge_missing(uuid, date) from public, anon, authenticated;
grant execute on function public.discord_nudge_missing(uuid, date) to service_role;
