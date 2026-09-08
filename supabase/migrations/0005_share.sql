-- ============================================================
-- Deling av uka (steg 4).
--
-- share_week(slug, week_start) gir alt delingssida og Discord-bildet trenger,
-- som én JSON, uten innlogging. Den avslører aldri hvem som er ledig når:
-- bare bookede aktiviteter (med hvem som er med) og blokker der ALLE er ledige.
-- Lenka virker bare når eieren har slått på deling (teams.share_enabled).
-- ============================================================

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
