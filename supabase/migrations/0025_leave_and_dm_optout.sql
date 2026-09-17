-- To små ting boten manglet.
--
-- 1. Rolla følger medlemskapet. Å bli med i laget gir rolla boten laget; å gå ut
--    skal ta den bort igjen. Basen kan ikke snakke med Discord, så den legger
--    jobben i en kø og klokka gjør den.
--
-- 2. «Ikke send meg DM». Discord sin egen personverninnstilling er det eneste
--    som stopper en DM i dag, og den gjelder hele serveren. Her kan hver spiller
--    si fra selv, uten å stenge for alle andre. De får fortsatt ping i kanalen.

-- ------------------------------------------------------------
-- 1. Kø for rollen
-- ------------------------------------------------------------
create table if not exists public.discord_role_queue (
  id          bigint generated always as identity primary key,
  team_id     uuid not null,
  guild_id    text not null check (guild_id ~ '^[0-9]{5,25}$'),
  role_id     text not null check (role_id ~ '^[0-9]{5,25}$'),
  discord_id  text not null check (discord_id ~ '^[0-9]{5,25}$'),
  at          timestamptz not null default now(),
  attempts    int not null default 0
);
create index if not exists discord_role_queue_at_idx on public.discord_role_queue (at);

-- Serverens kø. Ingen klient har noe her å gjøre.
alter table public.discord_role_queue enable row level security;
grant all on public.discord_role_queue to service_role;
grant usage, select on sequence public.discord_role_queue_id_seq to service_role;

-- Går noen ut av et lag som pinger en rolle boten laget, legges det i køen.
-- Laget og koblinga leses her og ikke i klokka: er laget slettet, er raden borte
-- før vi rekker å spørre.
create or replace function public.discord_role_on_leave()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  l record;
  d text;
begin
  select guild_id, ping_role_id into l
  from public.discord_links
  where team_id = old.team_id and managed_role and ping_role_id is not null;
  if not found then
    return old;
  end if;
  select discord_id into d from public.profiles where user_id = old.user_id;
  if d is null then
    return old;
  end if;
  -- Er personen fortsatt med i et annet lag som pinger samme rolle, skal rolla stå.
  if exists (
    select 1
    from public.members m
    join public.discord_links dl on dl.team_id = m.team_id
    where m.user_id = old.user_id
      and m.team_id <> old.team_id
      and dl.ping_role_id = l.ping_role_id
  ) then
    return old;
  end if;
  insert into public.discord_role_queue (team_id, guild_id, role_id, discord_id)
  values (old.team_id, l.guild_id, l.ping_role_id, d);
  return old;
end;
$$;

drop trigger if exists discord_role_on_leave on public.members;
create trigger discord_role_on_leave
  after delete on public.members
  for each row execute function public.discord_role_on_leave();

-- ------------------------------------------------------------
-- 2. DM av og på, per spiller
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists dm_opt_out boolean not null default false;

grant update (dm_opt_out) on public.profiles to authenticated;

-- discord_team_people er lista boten sender DM til. Den som har sagt nei står
-- fortsatt i kanallista, så de får med seg det som skjer — bare ikke i innboksen.
create or replace function public.discord_team_people(team uuid, for_dm boolean default false)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(p.discord_id order by p.display_name), '[]'::jsonb)
  from public.members m
  join public.profiles p on p.user_id = m.user_id
  where m.team_id = discord_team_people.team
    and p.discord_id is not null
    and (
      not for_dm
      or (
        not p.dm_opt_out
        and (p.dm_blocked_at is null or p.dm_blocked_at < now() - interval '30 days')
      )
    );
$$;

revoke execute on function public.discord_team_people(uuid, boolean) from public, anon, authenticated;
grant execute on function public.discord_team_people(uuid, boolean) to service_role;

-- Utvalget for påminnelser bruker det samme: den som har sagt nei til DM skal
-- ikke få en likevel. Filtreringen ligger i discord_team_people, som
-- påminnelsene allerede spør — her trengs ingen endring.
