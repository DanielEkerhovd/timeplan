-- ============================================================
-- Fortida er låst, framtida er kortere, og gammel tilgjengelighet ryddes bort.
--
-- Du kan fortsatt BLA bakover og se gamle uker. Du kan bare ikke skrive der.
-- Inneværende uke er alltid åpen, så du kan fikse mandagen når det er onsdag.
-- ============================================================

-- Mandag i uka en dato hører til. Immutable, så den kan brukes i uttrykk.
create or replace function public.week_monday(d date)
returns date
language sql
immutable
set search_path = ''
as $$
  select d - (extract(isodow from d)::int - 1);
$$;

-- Skriving er lov fra og med mandag denne uka, og tre måneder fram.
create or replace function public.guard_date_range()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.date < public.week_monday(current_date) then
    raise exception 'date_in_the_past' using errcode = 'check_violation';
  end if;
  if new.date > current_date + 92 then
    raise exception 'date_too_far_ahead' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- Sletting i fortida er også stengt: ellers kunne du fjerne gamle timer selv om du ikke kan legge dem til.
create or replace function public.guard_delete_past()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Bare direkte sletting. Cascade (forlate laget, slette laget, fjerne medlem)
  -- kjører på større dybde og må få rydde opp fritt.
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  if old.date < public.week_monday(current_date) then
    raise exception 'date_in_the_past' using errcode = 'check_violation';
  end if;
  return old;
end;
$$;
create trigger availability_no_delete_past before delete on public.availability
  for each row execute function public.guard_delete_past();
create trigger events_no_delete_past before delete on public.events
  for each row execute function public.guard_delete_past();

-- apply_default_week skal ikke kunne fylle inn i fortida heller.
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
  if week_start < public.week_monday(current_date) then
    raise exception 'date_in_the_past' using errcode = 'check_violation';
  end if;
  if week_start > current_date + 92 then
    raise exception 'date_too_far_ahead' using errcode = 'check_violation';
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

-- ------------------------------------------------------------
-- Rydding: tilgjengelighet eldre enn 90 dager forsvinner.
-- Aktivitetene blir liggende. De er få, og det er historikken som betyr noe.
-- ------------------------------------------------------------
create or replace function public.prune_old_availability()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare n int;
begin
  -- Triggeren over stopper vanlig sletting i fortida; her er det meningen.
  set local session_replication_role = replica;
  delete from public.availability where date < current_date - 90;
  get diagnostics n = row_count;
  return n;
end;
$$;
-- Bare databasen selv skal kunne rydde.
revoke execute on function public.prune_old_availability() from public, anon, authenticated;
grant execute on function public.week_monday(date) to anon, authenticated;

-- Kjøres av pg_cron hvis den er slått på (Database → Extensions i Supabase).
-- Uten pg_cron skjer ingenting; ryddingen er ikke nødvendig for at appen skal virke.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('prune-availability', '0 4 * * 0', 'select public.prune_old_availability()');
  end if;
end $$;
