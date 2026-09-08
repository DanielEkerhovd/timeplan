-- ============================================================
-- Aktivitetstyper og egendefinerte aktiviteter
--
-- Typen er tittelen. Scrim, Match og VOD review er lagets egne
-- typer (navn, farge, spør om motstander, standard lengde).
-- «Custom» er en aktivitet uten type: fri tittel + egen farge.
-- Fargen følger aktiviteten overalt.
-- ============================================================

-- Fast palett med 8 myke farger. Nøkkelen lagres, ikke hex-koden.
create type public.activity_color as enum ('yellow', 'green', 'coral', 'purple', 'blue', 'teal', 'pink', 'grey');

create table public.activity_types (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  color public.activity_color not null default 'yellow',
  ask_opponent boolean not null default false,
  default_hours int not null default 3 check (default_hours between 1 and 12),
  sort int not null default 0,
  -- Typer som er i bruk skjules i stedet for å slettes, så gamle bookinger beholder navnet.
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index activity_types_team_idx on public.activity_types (team_id);

-- Maks 12 aktive typer per lag.
create or replace function public.guard_type_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.activity_types where team_id = new.team_id and archived = false) >= 12 then
    raise exception 'too_many_types' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger activity_types_limit before insert on public.activity_types
  for each row execute function public.guard_type_limit();

alter table public.activity_types enable row level security;
revoke all on public.activity_types from anon, authenticated;
grant select on public.activity_types to authenticated;
grant insert (team_id, name, color, ask_opponent, default_hours, sort) on public.activity_types to authenticated;
grant update (name, color, ask_opponent, default_hours, sort, archived) on public.activity_types to authenticated;
grant delete on public.activity_types to authenticated;
create policy activity_types_select on public.activity_types for select to authenticated
  using (public.is_member(team_id));
create policy activity_types_write on public.activity_types for all to authenticated
  using (public.is_editor(team_id)) with check (public.is_editor(team_id));

-- ------------------------------------------------------------
-- Standardtyper: seedes for nye lag, og for lag som finnes fra før.
-- (Må skje før aktivitetene konverteres nedenfor.)
-- ------------------------------------------------------------
create or replace function public.seed_activity_types(team uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.activity_types (team_id, name, color, ask_opponent, default_hours, sort) values
    (team, 'Scrim', 'yellow', true, 3, 1),
    (team, 'Match', 'coral', true, 3, 2),
    (team, 'VOD review', 'purple', false, 2, 3);
$$;
revoke execute on function public.seed_activity_types(uuid) from public, anon, authenticated;

-- Lag som allerede finnes får standardtypene.
do $$
declare t record;
begin
  for t in select id from public.teams loop
    if not exists (select 1 from public.activity_types where team_id = t.id) then
      perform public.seed_activity_types(t.id);
    end if;
  end loop;
end $$;


-- ------------------------------------------------------------
-- events: type_id peker på lagets type. Uten type = custom,
-- da er title og color påkrevd. Den gamle enum-kolonnen fjernes.
-- ------------------------------------------------------------
alter table public.events
  add column type_id uuid references public.activity_types (id) on delete restrict,
  add column color public.activity_color;

alter table public.events alter column title drop not null;

-- Eksisterende aktiviteter: scrim/match blir til lagets Scrim/Match-type,
-- alt annet blir en custom-aktivitet som beholder tittelen sin.
update public.events e
set type_id = t.id, title = null
from public.activity_types t
where t.team_id = e.team_id
  and t.name = case e.type::text when 'scrim' then 'Scrim' when 'match' then 'Match' end;

update public.events
set color = case type::text when 'practice' then 'green'::public.activity_color else 'grey'::public.activity_color end,
    title = coalesce(nullif(title, ''), 'Activity')
where type_id is null;

alter table public.events drop column type;
drop type public.event_type;

alter table public.events add constraint events_type_or_title check (
  (type_id is not null and title is null and color is null)
  or (type_id is null and title is not null and char_length(title) between 1 and 80 and color is not null)
);

-- Typen må tilhøre samme lag som aktiviteten.
create or replace function public.guard_event_type_team()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type_id is null then
    return new;
  end if;
  if not exists (select 1 from public.activity_types t where t.id = new.type_id and t.team_id = new.team_id) then
    raise exception 'type_not_in_team' using errcode = 'check_violation';
  end if;
  -- Arkiverte typer kan ikke velges for nye/omvalgte aktiviteter, men en gammel booking kan fortsatt flyttes.
  if (tg_op = 'INSERT' or new.type_id is distinct from old.type_id)
     and exists (select 1 from public.activity_types t where t.id = new.type_id and t.archived) then
    raise exception 'type_not_in_team' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger events_type_team before insert or update on public.events
  for each row execute function public.guard_event_type_team();

-- Kolonnetilganger: de gamle grants nevnte «type».
revoke insert, update on public.events from authenticated;
grant insert (team_id, date, start_hour, end_hour, type_id, color, title, opponent, note) on public.events to authenticated;
grant update (date, start_hour, end_hour, type_id, color, title, opponent, note) on public.events to authenticated;

create or replace function public.create_team(team_name text, tz text default 'Europe/Oslo')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  tid uuid;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  if (select count(*) from public.teams where created_by = uid) >= 3 then
    raise exception 'team_limit' using errcode = 'check_violation';
  end if;

  insert into public.teams (name, timezone, created_by)
  values (btrim(team_name), tz, uid)
  returning id into tid;

  insert into public.members (team_id, user_id, role) values (tid, uid, 'owner');

  insert into public.team_slots (team_id, day_type, start_hour, end_hour, sort) values
    (tid, 'weekday', 18, 21, 1),
    (tid, 'weekday', 19, 22, 2),
    (tid, 'weekday', 20, 23, 3),
    (tid, 'weekend', 13, 16, 1),
    (tid, 'weekend', 16, 19, 2),
    (tid, 'weekend', 19, 22, 3);

  perform public.seed_activity_types(tid);

  return tid;
end;
$$;

-- ------------------------------------------------------------
-- «Vanlig uke»: to funksjoner så det blir én kall hver vei.
-- ------------------------------------------------------------

-- Lagrer mønsteret fra uka som starter på mandag `week_start` som din vanlige uke.
create or replace function public.save_default_week(team uuid, week_start date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  n int;
begin
  if uid is null or not public.is_member(team) then
    raise exception 'not_a_member' using errcode = 'insufficient_privilege';
  end if;
  delete from public.default_week where team_id = team and user_id = uid;
  insert into public.default_week (team_id, user_id, weekday, hour)
  select team, uid, extract(isodow from a.date)::int, a.hour
  from public.availability a
  where a.team_id = team and a.user_id = uid
    and a.date >= week_start and a.date < week_start + 7;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Fyller uka som starter på `week_start` fra din vanlige uke. Rører ikke timer du allerede har satt.
create or replace function public.apply_default_week(team uuid, week_start date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  n int;
begin
  if uid is null or not public.is_member(team) then
    raise exception 'not_a_member' using errcode = 'insufficient_privilege';
  end if;
  if week_start < current_date - 365 or week_start > current_date + 365 then
    raise exception 'date_out_of_range' using errcode = 'check_violation';
  end if;
  insert into public.availability (team_id, user_id, date, hour)
  select team, uid, week_start + (d.weekday - 1), d.hour
  from public.default_week d
  where d.team_id = team and d.user_id = uid
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.save_default_week(uuid, date) to authenticated;
grant execute on function public.apply_default_week(uuid, date) to authenticated;

-- Realtime på typene også, så fargeendringer slår inn hos alle.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.activity_types;
  end if;
end $$;
