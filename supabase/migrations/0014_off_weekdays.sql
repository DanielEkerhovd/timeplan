-- ============================================================
-- Faste fridager, og unntak fra dem.
--
-- 0013 ga oss `closed_days`: én rad = én dato laget har tatt bort. Det holder
-- for onsdagen som ryker denne uka, men ikke for laget som aldri spiller onsdag.
-- De måtte trykke på nytt hver uke.
--
-- Så nå er det to lag:
--   1. Mønsteret: `teams.off_weekdays` — vekedagene laget normalt har fri.
--      Det er en del av malen, ved siden av intervallene, og settes i Settings.
--   2. Unntaket: en rad i `closed_days` for én dato, med `is_off` som sier
--      hvilken vei unntaket går. Uten fast fri betyr en rad «avlyst denne uka»;
--      med fast fri kan en rad også bety «vi spiller likevel denne uka».
--
-- Regelen er: finnes det et unntak for datoen, gjelder det. Ellers gjelder
-- mønsteret — men bare framover. Endrer du mønsteret i dag, skal ikke de åtte
-- onsdagene som har vært bli grå i ettertid. De ukene er ferdige.
--
-- Timene folk har krysset av blir liggende uansett. Ingenting her sletter data.
-- ============================================================

alter table public.teams
  add column if not exists off_weekdays smallint[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'teams_off_weekdays_valid'
  ) then
    alter table public.teams add constraint teams_off_weekdays_valid check (
      array_length(off_weekdays, 1) is null or (
        array_length(off_weekdays, 1) <= 7
        and off_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
      )
    );
  end if;
end $$;

-- Eier styrer malen, som med navn og tidssone.
grant update (name, timezone, share_enabled, off_weekdays) on public.teams to authenticated;

-- Retningen på unntaket. Gamle rader er avlysninger, som før.
alter table public.closed_days
  add column if not exists is_off boolean not null default true;

grant insert (team_id, date, closed_by, is_off) on public.closed_days to authenticated;
grant update (is_off) on public.closed_days to authenticated;

drop policy if exists closed_days_update on public.closed_days;
create policy closed_days_update on public.closed_days for update to authenticated
  using (public.is_editor(team_id)) with check (public.is_editor(team_id));

-- ------------------------------------------------------------
-- Én regel, brukt overalt.
--
-- Uttrykket står inline i view-et og i share_week i stedet for i en egen
-- funksjon: share_week kjører som eier og er åpen for anon, og en delt
-- hjelpefunksjon måtte da vært security definer — altså en ny måte å spørre
-- om et annet lag på, for den som kjenner en uuid. Ikke verdt det for ett uttrykk.
-- ------------------------------------------------------------

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

-- Delt uke: samme regel som i view-et.
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
