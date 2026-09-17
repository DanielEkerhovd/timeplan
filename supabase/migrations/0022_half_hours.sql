-- Halvtimer. Blokker (team_slots), aktiviteter (events) og ledige timer
-- (availability, default_week) kan starte og slutte på halve timer: 19:30–21:00.
--
-- Kolonnene heter fortsatt *_hour og `hour`, men holder nå tall med halve
-- steg: 19.5 er 19:30. Én rad i availability er én halvtime. Det er den minst
-- inngripende veien: alle funksjonene som kopierer timer (vanlig uke, fyll uka,
-- tøm uka) bærer verdien videre uendret, og klienten regnet allerede med
-- desimaltimer for tidssoner som India (+5:30).
--
-- Eksisterende rader: en avkrysset time 19 betydde 19:00–20:00, altså to
-- halvtimer. Raden 19.5 legges til for hver eksisterende rad, så ingen mister
-- noe. Blokker og aktiviteter har hele verdier fra før og trenger ingenting.
--
-- Minste lengde er én time, både for blokker og aktiviteter. Varsler og
-- posttider (discord_schedules) er fortsatt hele timer; de er ikke rørt.

-- ------------------------------------------------------------
-- 1. Kolonnetyper og regler
-- ------------------------------------------------------------
-- View-et leser kolonnene og må vekk før typen kan byttes. Det lages på nytt i steg 3.
drop view if exists public.slot_counts;
drop function if exists public.available_users(uuid, date, int, int);

alter table public.availability
  alter column hour type numeric(3,1) using hour::numeric(3,1);
alter table public.availability drop constraint if exists availability_hour_check;
alter table public.availability
  add constraint availability_hour_check check (hour >= 0 and hour < 24 and hour * 2 = trunc(hour * 2));

alter table public.default_week
  alter column hour type numeric(3,1) using hour::numeric(3,1);
alter table public.default_week drop constraint if exists default_week_hour_check;
alter table public.default_week
  add constraint default_week_hour_check check (hour >= 0 and hour < 24 and hour * 2 = trunc(hour * 2));

alter table public.team_slots
  alter column start_hour type numeric(3,1) using start_hour::numeric(3,1),
  alter column end_hour type numeric(3,1) using end_hour::numeric(3,1);
alter table public.team_slots drop constraint if exists team_slots_start_hour_check;
alter table public.team_slots drop constraint if exists team_slots_end_hour_check;
alter table public.team_slots drop constraint if exists team_slots_check;
alter table public.team_slots
  add constraint team_slots_start_hour_check check (start_hour >= 0 and start_hour < 24 and start_hour * 2 = trunc(start_hour * 2)),
  add constraint team_slots_end_hour_check check (end_hour > 0 and end_hour <= 24 and end_hour * 2 = trunc(end_hour * 2)),
  add constraint team_slots_check check (end_hour - start_hour >= 1);

alter table public.events
  alter column start_hour type numeric(3,1) using start_hour::numeric(3,1),
  alter column end_hour type numeric(3,1) using end_hour::numeric(3,1);
alter table public.events drop constraint if exists events_start_hour_check;
alter table public.events drop constraint if exists events_end_hour_check;
alter table public.events drop constraint if exists events_check;
alter table public.events
  add constraint events_start_hour_check check (start_hour >= 0 and start_hour < 24 and start_hour * 2 = trunc(start_hour * 2)),
  add constraint events_end_hour_check check (end_hour > 0 and end_hour <= 24 and end_hour * 2 = trunc(end_hour * 2)),
  add constraint events_check check (end_hour - start_hour >= 1);

-- ------------------------------------------------------------
-- 2. Eksisterende timer: den andre halvtimen legges til.
--
-- Også i uker som har vært: ellers ville gamle uker vist «ingen ledige», siden
-- available_users nå teller halvtimer. Datovakta fra 0006 stenger skriving i
-- fortida, og den gjelder denne ryddejobben også — derfor av og på rundt den.
-- ------------------------------------------------------------
alter table public.availability disable trigger availability_date_range;

insert into public.availability (team_id, user_id, date, hour)
select team_id, user_id, date, hour + 0.5
from public.availability
where hour = trunc(hour)
on conflict do nothing;

alter table public.availability enable trigger availability_date_range;

insert into public.default_week (team_id, user_id, weekday, hour)
select team_id, user_id, weekday, hour + 0.5
from public.default_week
where hour = trunc(hour)
on conflict do nothing;

-- ------------------------------------------------------------
-- 3. Hvem kan hele blokka: teller halvtimer nå.
-- ------------------------------------------------------------
create or replace function public.available_users(team uuid, on_date date, from_hour numeric, to_hour numeric)
returns setof uuid
language sql
stable
set search_path = ''
as $$
  select a.user_id
  from public.availability a
  where a.team_id = team and a.date = on_date
    and a.hour >= from_hour and a.hour < to_hour
  group by a.user_id
  having count(*) = ((to_hour - from_hour) * 2)::int;
$$;

revoke execute on function public.available_users(uuid, date, numeric, numeric) from public, anon;
grant execute on function public.available_users(uuid, date, numeric, numeric) to authenticated;

create or replace view public.slot_counts
with (security_invoker = true)
as
select
  s.team_id,
  d.date,
  s.start_hour,
  s.end_hour,
  s.sort,
  (select count(*) from public.available_users(s.team_id, d.date, s.start_hour, s.end_hour)) as available_count,
  (select coalesce(array_agg(u), '{}') from public.available_users(s.team_id, d.date, s.start_hour, s.end_hour) u) as user_ids
from public.team_slots s
cross join lateral (
  select distinct a.date from public.availability a where a.team_id = s.team_id
) d
where s.day_type = case when extract(isodow from d.date) >= 6 then 'weekend'::public.day_type else 'weekday'::public.day_type end
  and not coalesce(
    (select o.is_off from public.closed_days o where o.team_id = s.team_id and o.date = d.date),
    d.date >= public.week_monday(current_date)
      and exists (
        select 1 from public.teams t
        where t.id = s.team_id
          and extract(isodow from d.date)::smallint = any (t.off_weekdays)
      )
  );

grant select on public.slot_counts to authenticated;

-- Delt uke: samme regel, i halvtimer.
create or replace function public.share_week(slug text, week_start date)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  t record;
  member_count int;
  result jsonb;
begin
  if slug is null or char_length(slug) > 20 then
    return null;
  end if;

  select id, name, timezone into t
  from public.teams
  where share_slug = slug and share_enabled;
  if not found then
    return null;
  end if;

  -- Uka må være mandag, og innenfor et rimelig vindu.
  if extract(isodow from week_start) <> 1 or week_start < current_date - 365 or week_start > current_date + 365 then
    return null;
  end if;

  select count(*) into member_count from public.members where team_id = t.id;

  select jsonb_build_object(
    'team', jsonb_build_object('name', t.name, 'timezone', t.timezone),
    'week_start', week_start,
    'members', member_count,
    'days', (
      select jsonb_agg(day_json order by d.date)
      from (
        select week_start + g as date from generate_series(0, 6) g
      ) d
      cross join lateral (
        select jsonb_build_object(
          'date', d.date,
          'events', coalesce((
            select jsonb_agg(jsonb_build_object(
              'title', coalesce(ty.name, e.title),
              'opponent', e.opponent,
              'color', coalesce(ty.color, e.color),
              'start_hour', e.start_hour,
              'end_hour', e.end_hour,
              'people', coalesce((
                select jsonb_agg(jsonb_build_object('name', p.display_name, 'avatar', p.avatar_url) order by p.display_name)
                from public.event_responses r
                join public.profiles p on p.user_id = r.user_id
                where r.event_id = e.id and r.status = 'coming'
              ), '[]'::jsonb)
            ) order by e.start_hour)
            from public.events e
            left join public.activity_types ty on ty.id = e.type_id
            where e.team_id = t.id and e.date = d.date
          ), '[]'::jsonb),
          -- Blokker der alle på laget er ledige hele blokka og ingenting er booket.
          'free', coalesce((
            select jsonb_agg(jsonb_build_object('start_hour', s.start_hour, 'end_hour', s.end_hour) order by s.start_hour)
            from public.team_slots s
            where s.team_id = t.id
              and s.day_type = case when extract(isodow from d.date) >= 6 then 'weekend' else 'weekday' end::public.day_type
              and member_count > 0
              -- En dag laget har fri har ingen ledige blokker, uansett hva folk
              -- har krysset av. Unntaket for datoen vinner over mønsteret.
              and not coalesce(
                (select o.is_off from public.closed_days o where o.team_id = t.id and o.date = d.date),
                d.date >= public.week_monday(current_date)
                  and exists (
                    select 1 from public.teams tt
                    where tt.id = t.id
                      and extract(isodow from d.date)::smallint = any (tt.off_weekdays)
                  )
              )
              and not exists (
                select 1 from public.events e
                where e.team_id = t.id and e.date = d.date and e.start_hour < s.end_hour and e.end_hour > s.start_hour
              )
              and (
                select count(*) from public.members m
                where m.team_id = t.id
                  and not exists (
                    select 1 from generate_series(s.start_hour, s.end_hour - 0.5, 0.5) h
                    where not exists (
                      select 1 from public.availability a
                      where a.team_id = t.id and a.user_id = m.user_id and a.date = d.date and a.hour = h
                    )
                  )
              ) = member_count
          ), '[]'::jsonb)
        ) as day_json
      ) x
    )
  ) into result;

  return result;
end;
$$;


-- share_week beholder rettighetene sine (create or replace rører dem ikke).
-- Den nye available_users fikk sine over. Ingen blankorevoke her: det som ble
-- gitt i 0015–0021 skal stå.
