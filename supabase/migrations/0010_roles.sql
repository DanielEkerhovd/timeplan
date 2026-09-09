-- ============================================================
-- Roller blir en liste laget eier, og tilgang heter det den er.
--
-- To ting skjer her, og de henger sammen:
--
-- 1. Tilgang: 'coach' og 'player' het etter hva folk er. Men knappen styrer hva
--    du får lov til, ikke hvem du er. Nå heter de 'admin' og 'member', og det er
--    likt for alle lag — et brettspillgruppe har ingen «players».
--
-- 2. Roller: lane-posisjonene var låst til League of Legends i en check-constraint.
--    Nå er en rolle bare et navn i lagets egen liste. Coach og Sub er vanlige
--    oppføringer i den lista, ikke noe eget. Flere kan ha samme rolle.
--
-- Ingenting med tider, uker eller aktiviteter er rørt.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tilgang: nye navn på de samme to nivåene
-- ------------------------------------------------------------

-- Verdiene byttes i typen, så alle eksisterende rader følger med av seg selv.
alter type public.member_role rename value 'coach' to 'admin';
alter type public.member_role rename value 'player' to 'member';
alter table public.members alter column role set default 'member';

-- Funksjonene under skrev navnene rett inn og må skrives om.
create or replace function public.is_editor(team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.team_id = team and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  );
$$;

-- join_team la inn 'player' som rolle og må skrives om.
create or replace function public.join_team(invite_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  inv public.invites%rowtype;
  failed int;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;

  select count(*) into failed from public.join_attempts
  where user_id = uid and success = false and attempted_at > now() - interval '1 hour';
  if failed >= 10 then
    raise exception 'too_many_attempts' using errcode = 'check_violation';
  end if;

  select * into inv from public.invites
  where code = upper(btrim(invite_code))
    and expires_at > now()
    and used_count < max_uses
  for update;

  if not found then
    insert into public.join_attempts (user_id, success) values (uid, false);
    return null;
  end if;

  if exists (select 1 from public.members where team_id = inv.team_id and user_id = uid) then
    return inv.team_id;
  end if;

  insert into public.members (team_id, user_id, role) values (inv.team_id, uid, 'member');
  update public.invites set used_count = used_count + 1 where id = inv.id;
  insert into public.join_attempts (user_id, success) values (uid, true);

  return inv.team_id;
end;
$$;

create or replace function public.transfer_ownership(team uuid, new_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.is_owner(team) then
    raise exception 'not_owner' using errcode = 'insufficient_privilege';
  end if;
  if new_owner = uid then
    return;
  end if;
  if not exists (select 1 from public.members where team_id = team and user_id = new_owner) then
    raise exception 'not_a_member' using errcode = 'check_violation';
  end if;
  update public.members set role = 'owner' where team_id = team and user_id = new_owner;
  -- Den gamle eieren blir stående som admin, ikke kastet ned til member.
  update public.members set role = 'admin' where team_id = team and user_id = uid;
end;
$$;

create or replace function public.remove_member(team uuid, member uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  target public.member_role;
begin
  if uid is null or not public.is_editor(team) then
    raise exception 'not_editor' using errcode = 'insufficient_privilege';
  end if;
  if member = uid then
    raise exception 'use_leave_team' using errcode = 'check_violation';
  end if;
  select role into target from public.members where team_id = team and user_id = member;
  if target is null then
    raise exception 'not_a_member' using errcode = 'check_violation';
  end if;
  if target = 'owner' then
    raise exception 'cannot_remove_owner' using errcode = 'insufficient_privilege';
  end if;
  -- Bare eieren kan fjerne en annen admin.
  if target = 'admin' and not public.is_owner(team) then
    raise exception 'not_owner' using errcode = 'insufficient_privilege';
  end if;
  delete from public.members where team_id = team and user_id = member;
end;
$$;

-- ------------------------------------------------------------
-- 2. Rollelista
-- ------------------------------------------------------------

create table public.team_roles (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 24),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  -- Samme navn to ganger i ett lag gir bare forvirring i nedtrekket.
  unique (team_id, name)
);
create index team_roles_team_idx on public.team_roles (team_id, sort);

-- Ingen grense på hvor mange som kan ha samme rolle: to kan dele Entry, tre kan være Sub.
alter table public.members add column role_id uuid references public.team_roles (id) on delete set null;

-- Et lag kan ikke ha uendelig mange roller.
create or replace function public.team_roles_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.team_roles where team_id = new.team_id) >= 20 then
    raise exception 'too_many_roles' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger team_roles_limit
  before insert on public.team_roles
  for each row execute function public.team_roles_limit();

-- En rolle må høre til samme lag som medlemmet.
create or replace function public.members_role_same_team()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role_id is not null and not exists (
    select 1 from public.team_roles r where r.id = new.role_id and r.team_id = new.team_id
  ) then
    raise exception 'role_from_other_team' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger members_role_same_team
  before insert or update of role_id on public.members
  for each row execute function public.members_role_same_team();

-- ------------------------------------------------------------
-- 3. Konverter det som finnes
-- ------------------------------------------------------------

-- Alle lag som eksisterer i dag er League of Legends-lag, så de får den lista.
insert into public.team_roles (team_id, name, sort)
select t.id, v.name, v.sort
from public.teams t
cross join (values
  ('Top', 1), ('Jungle', 2), ('Mid', 3), ('ADC', 4), ('Support', 5), ('Sub', 6), ('Coach', 7)
) as v(name, sort);

-- Gamle posisjoner peker nå på rader i lista.
update public.members m
set role_id = r.id
from public.team_roles r
where r.team_id = m.team_id
  and m.position is not null
  and r.name = case m.position
    when 'top' then 'Top'
    when 'jungle' then 'Jungle'
    when 'mid' then 'Mid'
    when 'bot' then 'ADC'
    when 'support' then 'Support'
    when 'sub' then 'Sub'
    when 'coach' then 'Coach'
  end;

drop policy if exists members_update_position on public.members;
revoke update (position) on public.members from authenticated;
alter table public.members drop column position;

-- ------------------------------------------------------------
-- 4. Hvem får se og endre lista
-- ------------------------------------------------------------

alter table public.team_roles enable row level security;

grant select on public.team_roles to authenticated;
grant insert (team_id, name, sort), update (name, sort), delete on public.team_roles to authenticated;

-- Medlemmer ser lista si. Bare admin og eier endrer den.
create policy team_roles_select on public.team_roles for select to authenticated
  using (public.is_member(team_id));
create policy team_roles_insert on public.team_roles for insert to authenticated
  with check (public.is_editor(team_id));
create policy team_roles_update on public.team_roles for update to authenticated
  using (public.is_editor(team_id)) with check (public.is_editor(team_id));
create policy team_roles_delete on public.team_roles for delete to authenticated
  using (public.is_editor(team_id));

-- Din egen rolle setter du selv; admin setter alles.
grant update (role_id) on public.members to authenticated;
create policy members_update_role_id on public.members for update to authenticated
  using (user_id = auth.uid() or public.is_editor(team_id))
  with check (user_id = auth.uid() or public.is_editor(team_id));

-- ------------------------------------------------------------
-- 5. Nytt lag: lista følger med fra start
-- ------------------------------------------------------------

-- roles er navnene i rekkefølge. Tom liste = laget bruker ikke roller.
create or replace function public.create_team(team_name text, tz text default 'Europe/Oslo', roles text[] default '{}')
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

  -- Maks 20, og tomme navn hoppes over. Rekkefølgen i arrayet blir rekkefølgen i lista.
  insert into public.team_roles (team_id, name, sort)
  select tid, btrim(name), i
  from unnest(roles) with ordinality as t(name, i)
  where btrim(name) <> '' and i <= 20
  on conflict (team_id, name) do nothing;

  return tid;
end;
$$;

-- Den gamle varianten må bort, ellers blir kallet fra appen tvetydig.
drop function if exists public.create_team(text, text);

revoke execute on all functions in schema public from public, anon;
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
