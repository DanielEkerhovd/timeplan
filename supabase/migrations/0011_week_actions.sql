-- ============================================================
-- To handlinger til for din egen uke: bytt ut, og tøm.
--
-- apply_default_week legger bare til (`on conflict do nothing`), så den kan aldri
-- fjerne noe. Det er riktig for «fyll inn», men appen trenger også et ærlig
-- «sett uka til malen min», og et «tøm uka».
--
-- Begge rører bare dine egne timer, og bare dager du har lov til å skrive på:
-- fra mandag denne uka og tre måneder fram. Fortida er låst som før.
-- ============================================================

-- Setter uka til nøyaktig din vanlige uke. Returnerer hvor mange timer som står igjen etterpå.
create or replace function public.replace_with_default_week(team uuid, week_start date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  first_day date;
  n int;
begin
  if uid is null or not public.is_member(team) then
    raise exception 'not_a_member' using errcode = 'insufficient_privilege';
  end if;
  if week_start <> public.week_monday(week_start) then
    raise exception 'not_a_monday' using errcode = 'check_violation';
  end if;
  -- Dager i fortida står urørt: de kan verken slettes eller fylles.
  first_day := greatest(week_start, public.week_monday(current_date));
  if first_day >= week_start + 7 then
    raise exception 'date_in_the_past' using errcode = 'check_violation';
  end if;
  if week_start > current_date + 92 then
    raise exception 'date_too_far_ahead' using errcode = 'check_violation';
  end if;

  delete from public.availability
  where team_id = team and user_id = uid
    and date >= first_day and date < week_start + 7;

  insert into public.availability (team_id, user_id, date, hour)
  select team, uid, week_start + (d.weekday - 1), d.hour
  from public.default_week d
  where d.team_id = team and d.user_id = uid
    and week_start + (d.weekday - 1) >= first_day
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Tømmer dine egne timer i uka. Returnerer hvor mange som ble fjernet.
create or replace function public.clear_week(team uuid, week_start date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  first_day date;
  n int;
begin
  if uid is null or not public.is_member(team) then
    raise exception 'not_a_member' using errcode = 'insufficient_privilege';
  end if;
  if week_start <> public.week_monday(week_start) then
    raise exception 'not_a_monday' using errcode = 'check_violation';
  end if;
  first_day := greatest(week_start, public.week_monday(current_date));
  if first_day >= week_start + 7 then
    raise exception 'date_in_the_past' using errcode = 'check_violation';
  end if;

  delete from public.availability
  where team_id = team and user_id = uid
    and date >= first_day and date < week_start + 7;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Sletter den vanlige uka di. Returnerer hvor mange timer som lå der.
create or replace function public.clear_default_week(team uuid)
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
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.replace_with_default_week(uuid, date) to authenticated;
grant execute on function public.clear_week(uuid, date) to authenticated;
grant execute on function public.clear_default_week(uuid) to authenticated;
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
grant execute on function public.random_code(int) to authenticated;
grant execute on function public.rotate_share_slug(uuid) to authenticated;
grant execute on function public.share_week(text, date) to anon, authenticated;
grant execute on function public.week_monday(date) to anon, authenticated;
