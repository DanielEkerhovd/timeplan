-- ============================================================
-- Timeplan: grunnmur
-- Alle tabeller, tilgangsregler (RLS) og databasefunksjoner.
--
-- Prinsipp: React er en gjest. Databasen nekter alt som ikke er
-- eksplisitt tillatt, uansett hva som sendes inn.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------
-- Typer
-- ------------------------------------------------------------
-- owner: eier (én per lag). coach: trener, kan redigere planen. player: spiller.
create type public.member_role as enum ('owner', 'coach', 'player');
create type public.day_type as enum ('weekday', 'weekend');
create type public.event_type as enum ('scrim', 'practice', 'match', 'other');
create type public.response_status as enum ('coming', 'not_coming');

-- ------------------------------------------------------------
-- Hjelpefunksjoner for tilfeldige koder
-- Alfabet uten forvekslbare tegn (ingen 0/O, 1/I/L).
-- 32 tegn = 5 bit per tegn. 12 tegn = 60 bit, 10 tegn = 50 bit.
-- ------------------------------------------------------------
create or replace function public.random_code(len int)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(len);
  result text := '';
  i int;
begin
  for i in 0 .. len - 1 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
  end loop;
  return result;
end;
$$;

-- ------------------------------------------------------------
-- Profiler: speiler navn og avatar fra Discord-innloggingen.
-- Vi lagrer aldri Discord-token, bare det som vises i appen.
-- ------------------------------------------------------------
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 400),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  name text;
begin
  name := coalesce(
    nullif(meta ->> 'custom_claims.global_name', ''),
    nullif(meta -> 'custom_claims' ->> 'global_name', ''),
    nullif(meta ->> 'full_name', ''),
    nullif(meta ->> 'name', ''),
    nullif(meta ->> 'preferred_username', ''),
    'Player'
  );
  insert into public.profiles (user_id, display_name, avatar_url, updated_at)
  values (new.id, left(name, 40), left(meta ->> 'avatar_url', 400), now())
  on conflict (user_id) do update
    set display_name = excluded.display_name,
        avatar_url = excluded.avatar_url,
        updated_at = now();
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_auth_user();

create trigger on_auth_user_updated
  after update of raw_user_meta_data on auth.users
  for each row execute function public.handle_auth_user();

-- ------------------------------------------------------------
-- Lag
-- ------------------------------------------------------------
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 40),
  timezone text not null default 'Europe/Oslo' check (char_length(timezone) between 3 and 60),
  created_by uuid references auth.users (id) on delete set null,
  share_slug text not null unique default public.random_code(10),
  share_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null default 'player',
  position text check (position is null or char_length(position) <= 20),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index members_user_idx on public.members (user_id);
-- Lar appen hente medlemmer med profil i ett kall: members.select('*, profile:profiles(*)')
alter table public.members
  add constraint members_profile_fk foreign key (user_id) references public.profiles (user_id) on delete cascade;

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  code text not null unique default public.random_code(12),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  expires_at timestamptz not null default now() + interval '7 days',
  max_uses int not null default 10 check (max_uses between 1 and 100),
  used_count int not null default 0 check (used_count >= 0),
  created_at timestamptz not null default now()
);
create index invites_team_idx on public.invites (team_id);

-- Logg over forsøk på å bruke koder. Brukes til sperring.
create table public.join_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  attempted_at timestamptz not null default now(),
  success boolean not null
);
create index join_attempts_user_time_idx on public.join_attempts (user_id, attempted_at desc);

-- Intervallene spillerne kan velge mellom (knappene).
create table public.team_slots (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  day_type public.day_type not null,
  start_hour int not null check (start_hour between 0 and 23),
  end_hour int not null check (end_hour between 1 and 24),
  sort int not null default 0,
  check (end_hour > start_hour),
  unique (team_id, day_type, start_hour, end_hour)
);

-- Én rad per ledig time. Knappen «19–22» = timene 19, 20, 21.
create table public.availability (
  team_id uuid not null,
  user_id uuid not null default auth.uid(),
  date date not null,
  hour int not null check (hour between 0 and 23),
  primary key (team_id, user_id, date, hour),
  foreign key (team_id, user_id) references public.members (team_id, user_id) on delete cascade
);
create index availability_team_date_idx on public.availability (team_id, date);

-- «Vanlig uke»: mønsteret nye uker fylles fra. weekday: 1 = mandag ... 7 = søndag (ISO).
create table public.default_week (
  team_id uuid not null,
  user_id uuid not null default auth.uid(),
  weekday int not null check (weekday between 1 and 7),
  hour int not null check (hour between 0 and 23),
  primary key (team_id, user_id, weekday, hour),
  foreign key (team_id, user_id) references public.members (team_id, user_id) on delete cascade
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  date date not null,
  start_hour int not null check (start_hour between 0 and 23),
  end_hour int not null check (end_hour between 1 and 24),
  type public.event_type not null default 'practice',
  title text not null check (char_length(title) between 1 and 80),
  opponent text check (opponent is null or char_length(opponent) <= 60),
  note text check (note is null or char_length(note) <= 500),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_hour > start_hour)
);
create index events_team_date_idx on public.events (team_id, date);

create table public.event_responses (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  status public.response_status not null,
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

-- ------------------------------------------------------------
-- Medlemskap-sjekker. security definer så RLS på members ikke
-- kaller seg selv i ring. Stable + search_path tomt.
-- ------------------------------------------------------------
create or replace function public.is_member(team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.team_id = team and m.user_id = auth.uid()
  );
$$;

-- Eier eller trener: kan redigere planen.
create or replace function public.is_editor(team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.team_id = team and m.user_id = auth.uid() and m.role in ('owner', 'coach')
  );
$$;

-- Bare eier: roller, laginnstillinger, sletting.
create or replace function public.is_owner(team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.team_id = team and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

create or replace function public.shares_team_with(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select other = auth.uid() or exists (
    select 1
    from public.members a
    join public.members b on a.team_id = b.team_id
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

-- ------------------------------------------------------------
-- Triggere: grenser og vakter
-- ------------------------------------------------------------

-- Maks 15 medlemmer per lag.
create or replace function public.guard_member_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.members where team_id = new.team_id) >= 15 then
    raise exception 'team_full' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger members_limit before insert on public.members
  for each row execute function public.guard_member_limit();

-- Eieren kan ikke fjernes så lenge laget finnes. Bruk transfer_ownership først.
create or replace function public.guard_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'owner' and exists (select 1 from public.teams where id = old.team_id) then
    raise exception 'owner_cannot_leave' using errcode = 'check_violation';
  end if;
  return old;
end;
$$;
create trigger members_guard_owner before delete on public.members
  for each row execute function public.guard_owner();

-- Maks 5 aktive koder per lag.
create or replace function public.guard_invite_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.invites
      where team_id = new.team_id and expires_at > now() and used_count < max_uses) >= 5 then
    raise exception 'too_many_invites' using errcode = 'check_violation';
  end if;
  if new.expires_at > now() + interval '30 days' then
    raise exception 'invite_too_long' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger invites_limit before insert on public.invites
  for each row execute function public.guard_invite_limit();

-- Datoer maks ett år bakover og framover.
create or replace function public.guard_date_range()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.date < current_date - 365 or new.date > current_date + 365 then
    raise exception 'date_out_of_range' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger availability_date_range before insert or update on public.availability
  for each row execute function public.guard_date_range();
create trigger events_date_range before insert or update on public.events
  for each row execute function public.guard_date_range();

-- Maks 4 aktiviteter per lag per dag (mot søppel).
create or replace function public.guard_event_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.events where team_id = new.team_id and date = new.date) >= 4 then
    raise exception 'too_many_events' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger events_limit before insert on public.events
  for each row execute function public.guard_event_limit();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger events_updated_at before update on public.events
  for each row execute function public.set_updated_at();
create trigger event_responses_updated_at before update on public.event_responses
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- Row Level Security. Standard: nekt alt.
-- ------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.members enable row level security;
alter table public.invites enable row level security;
alter table public.join_attempts enable row level security;
alter table public.team_slots enable row level security;
alter table public.availability enable row level security;
alter table public.default_week enable row level security;
alter table public.events enable row level security;
alter table public.event_responses enable row level security;

-- Ingen får noe via anon-nøkkelen uten innlogging.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;

-- profiles: din egen, og de du deler lag med.
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using (public.shares_team_with(user_id));
create policy profiles_update on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- teams: bare medlemmer ser laget. Eier kan endre navn, tidssone og deling.
-- Opprettelse og sletting går gjennom funksjoner.
grant select on public.teams to authenticated;
grant update (name, timezone, share_enabled) on public.teams to authenticated;
create policy teams_select on public.teams for select to authenticated
  using (public.is_member(id));
create policy teams_update on public.teams for update to authenticated
  using (public.is_owner(id)) with check (public.is_owner(id));

-- members: bare lese. All skriving går gjennom funksjoner.
grant select on public.members to authenticated;
create policy members_select on public.members for select to authenticated
  using (public.is_member(team_id));

-- invites: eier og trener ser og lager. Koden genereres av databasen.
grant select, delete on public.invites to authenticated;
grant insert (team_id, expires_at, max_uses) on public.invites to authenticated;
create policy invites_select on public.invites for select to authenticated
  using (public.is_editor(team_id));
create policy invites_insert on public.invites for insert to authenticated
  with check (public.is_editor(team_id));
create policy invites_delete on public.invites for delete to authenticated
  using (public.is_editor(team_id));

-- join_attempts: ingen tilgang for brukere. Bare join_team skriver her.

-- team_slots: medlemmer leser, eier og trener endrer.
grant select, insert, update, delete on public.team_slots to authenticated;
create policy team_slots_select on public.team_slots for select to authenticated
  using (public.is_member(team_id));
create policy team_slots_write on public.team_slots for all to authenticated
  using (public.is_editor(team_id)) with check (public.is_editor(team_id));

-- availability: medlemmer leser lagets, du skriver bare dine egne.
grant select, delete on public.availability to authenticated;
grant insert (team_id, date, hour) on public.availability to authenticated;
create policy availability_select on public.availability for select to authenticated
  using (public.is_member(team_id));
create policy availability_insert on public.availability for insert to authenticated
  with check (user_id = auth.uid() and public.is_member(team_id));
create policy availability_delete on public.availability for delete to authenticated
  using (user_id = auth.uid());

-- default_week: bare din egen.
grant select, delete on public.default_week to authenticated;
grant insert (team_id, weekday, hour) on public.default_week to authenticated;
create policy default_week_select on public.default_week for select to authenticated
  using (user_id = auth.uid());
create policy default_week_insert on public.default_week for insert to authenticated
  with check (user_id = auth.uid() and public.is_member(team_id));
create policy default_week_delete on public.default_week for delete to authenticated
  using (user_id = auth.uid());

-- events: medlemmer leser, eier og trener skriver.
grant select, delete on public.events to authenticated;
grant insert (team_id, date, start_hour, end_hour, type, title, opponent, note) on public.events to authenticated;
grant update (date, start_hour, end_hour, type, title, opponent, note) on public.events to authenticated;
create policy events_select on public.events for select to authenticated
  using (public.is_member(team_id));
create policy events_insert on public.events for insert to authenticated
  with check (public.is_editor(team_id));
create policy events_update on public.events for update to authenticated
  using (public.is_editor(team_id)) with check (public.is_editor(team_id));
create policy events_delete on public.events for delete to authenticated
  using (public.is_editor(team_id));

-- event_responses: medlemmer ser lagets svar, du skriver bare ditt eget.
grant select, delete on public.event_responses to authenticated;
grant insert (event_id, status) on public.event_responses to authenticated;
grant update (status) on public.event_responses to authenticated;
create policy event_responses_select on public.event_responses for select to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and public.is_member(e.team_id)));
create policy event_responses_insert on public.event_responses for insert to authenticated
  with check (user_id = auth.uid()
    and exists (select 1 from public.events e where e.id = event_id and public.is_member(e.team_id)));
create policy event_responses_update on public.event_responses for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy event_responses_delete on public.event_responses for delete to authenticated
  using (user_id = auth.uid());

-- ------------------------------------------------------------
-- Funksjoner brukerne kaller (rpc). Alle sjekker auth.uid() selv.
-- ------------------------------------------------------------

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

  return tid;
end;
$$;

-- Returnerer lagets id, eller NULL hvis koden er feil/utløpt/oppbrukt.
-- Kaster too_many_attempts etter 10 feil forsøk på en time.
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

  -- Sperring: 10 feil forsøk siste time.
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

  -- Feil kode gir NULL tilbake, ikke en feil. Grunnen: en feil ruller
  -- tilbake hele kallet, og da hadde loggen over forsøk forsvunnet med.
  if not found then
    insert into public.join_attempts (user_id, success) values (uid, false);
    return null;
  end if;

  if exists (select 1 from public.members where team_id = inv.team_id and user_id = uid) then
    return inv.team_id;
  end if;

  insert into public.members (team_id, user_id, role) values (inv.team_id, uid, 'player');
  update public.invites set used_count = used_count + 1 where id = inv.id;
  insert into public.join_attempts (user_id, success) values (uid, true);

  return inv.team_id;
end;
$$;

-- Eier gir eierskapet videre og blir selv trener.
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
  update public.members set role = 'coach' where team_id = team and user_id = uid;
end;
$$;

-- Eier gir eller tar trenerrollen. Kan ikke endre sin egen rolle her.
create or replace function public.set_role(team uuid, member uuid, new_role public.member_role)
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
  if member = uid then
    raise exception 'use_transfer_ownership' using errcode = 'check_violation';
  end if;
  if new_role = 'owner' then
    raise exception 'use_transfer_ownership' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.members where team_id = team and user_id = member) then
    raise exception 'not_a_member' using errcode = 'check_violation';
  end if;
  update public.members set role = new_role where team_id = team and user_id = member;
end;
$$;

-- Eier og trener kan fjerne spillere. Bare eier kan fjerne trenere. Ingen kan fjerne eier.
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
  if target = 'coach' and not public.is_owner(team) then
    raise exception 'not_owner' using errcode = 'insufficient_privilege';
  end if;
  delete from public.members where team_id = team and user_id = member;
end;
$$;

create or replace function public.leave_team(team uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  -- Trigger members_guard_owner stopper eieren.
  delete from public.members where team_id = team and user_id = uid;
end;
$$;

create or replace function public.delete_team(team uuid, confirm_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_owner(team) then
    raise exception 'not_owner' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.teams where id = team and name = btrim(confirm_name)) then
    raise exception 'name_mismatch' using errcode = 'check_violation';
  end if;
  delete from public.teams where id = team;
end;
$$;

create or replace function public.rotate_share_slug(team uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  slug text;
begin
  if auth.uid() is null or not public.is_owner(team) then
    raise exception 'not_owner' using errcode = 'insufficient_privilege';
  end if;
  update public.teams set share_slug = public.random_code(10) where id = team
  returning share_slug into slug;
  return slug;
end;
$$;

-- Hvem kan hele blokken fra start_hour til end_hour en gitt dag?
create or replace function public.available_users(team uuid, on_date date, from_hour int, to_hour int)
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
  having count(*) = to_hour - from_hour;
$$;

-- Nye funksjoner får PUBLIC-execute som standard. Ta det bort, og gi bare til innloggede.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.create_team(text, text) to authenticated;
grant execute on function public.join_team(text) to authenticated;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;
grant execute on function public.set_role(uuid, uuid, public.member_role) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.leave_team(uuid) to authenticated;
grant execute on function public.delete_team(uuid, text) to authenticated;
grant execute on function public.rotate_share_slug(uuid) to authenticated;
grant execute on function public.available_users(uuid, date, int, int) to authenticated;
grant execute on function public.random_code(int) to authenticated; -- brukes av kolonne-defaults
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.is_editor(uuid) to authenticated;
grant execute on function public.is_owner(uuid) to authenticated;
grant execute on function public.shares_team_with(uuid) to authenticated;

-- ------------------------------------------------------------
-- View: antall ledige per intervall per dag.
-- security_invoker gjør at RLS på availability gjelder her også.
-- ------------------------------------------------------------
create view public.slot_counts
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
where s.day_type = case when extract(isodow from d.date) >= 6 then 'weekend'::public.day_type else 'weekday'::public.day_type end;

grant select on public.slot_counts to authenticated;

-- ------------------------------------------------------------
-- Realtime (bare i Supabase; hoppes over lokalt uten publikasjonen)
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.availability, public.events, public.event_responses;
  end if;
end $$;
