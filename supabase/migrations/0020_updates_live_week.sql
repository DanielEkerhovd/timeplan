-- ============================================================
-- Endringsvarsler, runde 2 del 2: bare for uka som er postet, og DM som valg.
--
-- Tre ting:
--
-- 1. Et varsel bare når uka er «levende». Legger kapteinen inn fem aktiviteter
--    på lørdag, skal ikke det bli fem pinger når søndagsposten uansett
--    annonserer dem. Triggeren skriver nå bare til utboksen når aktiviteten
--    ligger i uka som alt har en post på Discord (`discord_week_post`).
--
-- 2. Laget velger hvordan endringer går ut: kanal, DM eller begge
--    (`discord_schedules.updates_mode`), samme mønster som påminnelsen samme dag.
--
-- 3. Et sted å huske at Discord nekter DM til en person (`profiles.dm_blocked_at`),
--    så vi ikke prøver hver gang. Bare serveren skriver den.
-- ============================================================

alter table public.discord_schedules
  add column if not exists updates_mode text not null default 'channel'
    check (updates_mode in ('channel', 'dm', 'both'));

grant update (post_enabled, post_dow, post_at, nudge_enabled, nudge_dow, nudge_at,
              updates_enabled, updates_mode, same_day_enabled, same_day_hours, same_day_mode)
  on public.discord_schedules to authenticated;

alter table public.profiles
  add column if not exists dm_blocked_at timestamptz;

-- Samme trigger som i 0019, med regelen om levende uke lagt til.
create or replace function public.discord_outbox_on_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  team uuid := coalesce(new.team_id, old.team_id);
  pending record;
  changed boolean;
begin
  -- Alle utganger returnerer OLD: for BEFORE DELETE er det det som lar
  -- slettinga gå videre (null ville stoppet den). AFTER-triggerne bryr seg ikke.
  if not exists (select 1 from public.teams t where t.id = team) then
    return old;
  end if;
  if not exists (
    select 1 from public.discord_links l
    join public.discord_schedules s on s.team_id = l.team_id
    where l.team_id = team and s.updates_enabled
  ) then
    return old;
  end if;

  -- Bare uka som er postet. Alt annet venter på sin egen ukepost.
  if not exists (
    select 1 from public.discord_week_post w
    where w.team_id = team and w.week_start = public.week_monday(coalesce(new.date, old.date))
  ) then
    return old;
  end if;

  select * into pending from public.discord_outbox
   where event_id = coalesce(new.id, old.id) and sent_at is null;

  if tg_op = 'INSERT' then
    insert into public.discord_outbox (team_id, kind, event_id, payload)
    values (team, 'new', new.id, jsonb_build_object('after', public.discord_event_snapshot(new)))
    on conflict (event_id) where sent_at is null do update
      set payload = excluded.payload, send_after = now() + interval '2 minutes';
    return old;
  end if;

  if tg_op = 'UPDATE' then
    changed := new.date is distinct from old.date
      or new.start_hour is distinct from old.start_hour
      or new.end_hour is distinct from old.end_hour
      or new.title is distinct from old.title
      or new.opponent is distinct from old.opponent
      or new.type_id is distinct from old.type_id;
    if not changed then
      return old;
    end if;
    if pending.id is not null and pending.kind = 'new' then
      update public.discord_outbox
         set payload = jsonb_build_object('after', public.discord_event_snapshot(new)),
             send_after = now() + interval '2 minutes'
       where id = pending.id;
      return old;
    end if;
    insert into public.discord_outbox (team_id, kind, event_id, payload)
    values (team, 'changed', new.id, jsonb_build_object(
      'before', coalesce(pending.payload -> 'before', public.discord_event_snapshot(old)),
      'after', public.discord_event_snapshot(new)
    ))
    on conflict (event_id) where sent_at is null do update
      set kind = 'changed', payload = excluded.payload, send_after = now() + interval '2 minutes';
    return old;
  end if;

  if tg_op = 'DELETE' then
    if pending.id is not null and pending.kind = 'new' then
      delete from public.discord_outbox where id = pending.id;
      return old;
    end if;
    insert into public.discord_outbox (team_id, kind, event_id, payload)
    values (team, 'cancelled', old.id, jsonb_build_object(
      'before', coalesce(pending.payload -> 'before', public.discord_event_snapshot(old)),
      'people', public.discord_event_people(old.id)
    ))
    on conflict (event_id) where sent_at is null do update
      set kind = 'cancelled', payload = excluded.payload, send_after = now() + interval '2 minutes';
    return old;
  end if;
  return old;
end;
$$;

-- Discord-id-ene til alle på laget som kan nås, for «ny aktivitet» og for DM.
-- Hopper over dem Discord har nektet DM til den siste måneden.
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
    and (not for_dm or p.dm_blocked_at is null or p.dm_blocked_at < now() - interval '30 days');
$$;

revoke execute on function public.discord_team_people(uuid, boolean) from public, anon, authenticated;
grant execute on function public.discord_team_people(uuid, boolean) to service_role;
