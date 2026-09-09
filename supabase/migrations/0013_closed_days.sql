-- ============================================================
-- Dager laget ikke spiller.
--
-- Intervallene (`team_slots`) er malen: de samme tidene hver uke. Men en uke er
-- sjelden helt som malen. Er onsdagen avlyst, skal ikke alle måtte se en kolonne
-- de aldri kommer til å trykke på.
--
-- Én rad = én dato dette laget har tatt bort. Timene folk allerede har krysset av
-- blir liggende urørt: åpner du dagen igjen, er alt som før. Det er derfor dette
-- er en egen tabell og ikke en sletting.
--
-- Eier og admin styrer dette. Alle på laget ser det.
-- ============================================================

create table if not exists public.closed_days (
  team_id uuid not null references public.teams (id) on delete cascade,
  date date not null,
  closed_by uuid not null references auth.users (id) on delete cascade,
  closed_at timestamptz not null default now(),
  primary key (team_id, date)
);

alter table public.closed_days enable row level security;
grant select, delete on public.closed_days to authenticated;
grant insert (team_id, date, closed_by) on public.closed_days to authenticated;

-- drop/create i stedet for bare create: da kan filen kjøres om igjen uten å feile.
drop policy if exists closed_days_select on public.closed_days;
create policy closed_days_select on public.closed_days for select to authenticated
  using (public.is_member(team_id));
drop policy if exists closed_days_insert on public.closed_days;
create policy closed_days_insert on public.closed_days for insert to authenticated
  with check (public.is_editor(team_id) and closed_by = auth.uid());
drop policy if exists closed_days_delete on public.closed_days;
create policy closed_days_delete on public.closed_days for delete to authenticated
  using (public.is_editor(team_id));

-- Samme vindu som for tilgjengelighet: fra mandag denne uka og tre måneder fram.
-- Fortida er ferdig, og å stenge en dag som har vært ville endret historikken.
drop trigger if exists closed_days_date_range on public.closed_days;
create trigger closed_days_date_range
  before insert or update on public.closed_days
  for each row execute function public.guard_date_range();

drop trigger if exists closed_days_no_delete_past on public.closed_days;
create trigger closed_days_no_delete_past
  before delete on public.closed_days
  for each row execute function public.guard_delete_past();

-- Alle på laget skal se det med en gang en dag blir stengt eller åpnet igjen.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'closed_days'
     ) then
    alter publication supabase_realtime add table public.closed_days;
  end if;
end $$;

-- ------------------------------------------------------------
-- Stengte dager skal ikke telle som ledig tid noe sted.
-- ------------------------------------------------------------

-- slot_counts driver rutenettet i Plan week.
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
  and not exists (
    select 1 from public.closed_days c where c.team_id = s.team_id and c.date = d.date
  );

grant select on public.slot_counts to authenticated;

-- Delt uke: en stengt dag har ingen «alle er ledige»-blokker. Bookede aktiviteter
-- vises fortsatt — står det noe i kalenderen den dagen, er det fordi noen ville det.
-- Ellers uendret fra 0005.
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
              -- En stengt dag har ingen ledige blokker, uansett hva folk har krysset av.
              and not exists (
                select 1 from public.closed_days c where c.team_id = t.id and c.date = d.date
              )
              and not exists (
                select 1 from public.events e
                where e.team_id = t.id and e.date = d.date and e.start_hour < s.end_hour and e.end_hour > s.start_hour
              )
              and (
                select count(*) from public.members m
                where m.team_id = t.id
                  and not exists (
                    select 1 from generate_series(s.start_hour, s.end_hour - 1) h
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

revoke execute on all functions in schema public from public, anon;
grant execute on function public.share_week(text, date) to anon, authenticated;
grant execute on function public.week_monday(date) to anon, authenticated;
grant execute on function public.create_team(text, text, text[]) to authenticated;
grant execute on function public.join_team(text) to authenticated;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;
grant execute on function public.set_role(uuid, uuid, public.member_role) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.leave_team(uuid) to authenticated;
grant execute on function public.delete_team(uuid, text) to authenticated;
grant execute on function public.available_users(uuid, date, int, int) to authenticated;
grant execute on function public.set_display_name(text) to authenticated;
grant execute on function public.save_default_week(uuid, date) to authenticated;
grant execute on function public.apply_default_week(uuid, date) to authenticated;
grant execute on function public.replace_with_default_week(uuid, date) to authenticated;
grant execute on function public.clear_week(uuid, date) to authenticated;
grant execute on function public.clear_default_week(uuid) to authenticated;
grant execute on function public.random_code(int) to authenticated;
grant execute on function public.rotate_share_slug(uuid) to authenticated;
