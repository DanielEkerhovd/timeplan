-- ============================================================
-- Discord-bot, grunnmuren (steg 7, runde 1).
--
-- Boten er ikke en prosess som lytter. Den er to HTTP-endepunkt på Vercel
-- (`/api/discord` for slash-kommandoer og knapper, `/api/discord/cron` for
-- det som skal skje til fast tid) pluss tabellene her. Se DISCORD_BOT.md.
--
-- Det som ligger i denne runden:
--   * hvem du er på Discord (`profiles.discord_id`), så boten kan kjenne igjen
--     den som trykker på en knapp
--   * koblinga lag → server (`discord_links`), én per lag
--   * kanalene per meldingstype (`discord_channels`): schedule, updates, reminders.
--     En kanal tilhører nøyaktig ett lag. Det er ikke Discord som krever det,
--     det er sånn det skal settes opp, og sperren fanger feilkoblinga.
--   * tidene (`discord_schedules`)
--   * den levende ukeposten (`discord_week_post`): én melding per lag som
--     redigeres i uka og postes på nytt når uka er ny
--   * loggen (`discord_log`): det Settings viser som «siste meldinger»
--   * `bot_week()`: alt boten trenger for å tegne uka, i ett kall
--
-- Skriving til `discord_week_post` og `discord_log` skjer bare fra serveren
-- (service role). Ingen klient får røre dem. Kanaler, tider og ping-valg
-- skriver eieren rett i tabellene under RLS, som med resten av innstillingene.
--
-- Tilgjengelighet (hvem som er ledig når) er med vilje ikke med i noe av dette.
-- Boten viser bare det som er booket. Det er en beslutning, ikke en forglemmelse.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Discord-id på profilen
--
-- Supabase legger Discord sin bruker-id i `raw_user_meta_data` ved innlogging
-- (`provider_id`, eldre rader har bare `sub`). Vi kopierer den ned på profilen,
-- så boten slipper å lese `auth`-skjemaet hver gang noen trykker Join.
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists discord_id text check (discord_id is null or discord_id ~ '^[0-9]{5,25}$');

-- Én Discord-konto, én profil. Uten dette kunne to profiler dele id, og da
-- ville et knappetrykk kunne bli ført på feil person.
create unique index if not exists profiles_discord_id_idx on public.profiles (discord_id) where discord_id is not null;

create or replace function public.discord_id_from(meta jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(coalesce(meta ->> 'provider_id', meta ->> 'sub'), '')
  where coalesce(meta ->> 'provider_id', meta ->> 'sub') ~ '^[0-9]{5,25}$';
$$;

create or replace function public.handle_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  name text := public.discord_name_from(meta);
  did text := public.discord_id_from(meta);
begin
  insert into public.profiles (user_id, display_name, discord_name, discord_id, avatar_url, updated_at)
  values (new.id, name, name, did, left(meta ->> 'avatar_url', 400), now())
  on conflict (user_id) do update
    set discord_name = excluded.discord_name,
        -- En id vi alt har, mister vi ikke fordi metadataen mangler den én gang.
        discord_id = coalesce(excluded.discord_id, public.profiles.discord_id),
        avatar_url = excluded.avatar_url,
        display_name = case when public.profiles.custom_name then public.profiles.display_name else excluded.display_name end,
        updated_at = now();
  return new;
end;
$$;

-- Alle som alt er logget inn får id-en sin nå, uten å vente på neste innlogging.
update public.profiles p
   set discord_id = public.discord_id_from(coalesce(u.raw_user_meta_data, '{}'::jsonb))
  from auth.users u
 where u.id = p.user_id
   and p.discord_id is null
   and public.discord_id_from(coalesce(u.raw_user_meta_data, '{}'::jsonb)) is not null;

-- ------------------------------------------------------------
-- 2. Koblinga lag → server
-- ------------------------------------------------------------
create table if not exists public.discord_links (
  team_id       uuid primary key references public.teams (id) on delete cascade,
  guild_id      text not null check (guild_id ~ '^[0-9]{5,25}$'),
  guild_name    text check (guild_name is null or char_length(guild_name) <= 100),
  ping_mode     text not null default 'members' check (ping_mode in ('members', 'role')),
  ping_role_id  text check (ping_role_id is null or ping_role_id ~ '^[0-9]{5,25}$'),
  -- Rolla boten selv har laget og holder i takt med laget. Null = eksisterende rolle, eller ingen.
  managed_role  boolean not null default false,
  linked_by     uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);

alter table public.discord_links enable row level security;

-- Medlemmer ser at laget er koblet (og til hvilken server). Eieren velger ping.
-- Selve koblinga og frakoblinga går gjennom serveren: den må snakke med Discord.
grant select on public.discord_links to authenticated;
grant update (ping_mode, ping_role_id) on public.discord_links to authenticated;

drop policy if exists discord_links_select on public.discord_links;
create policy discord_links_select on public.discord_links for select to authenticated
  using (public.is_member(team_id));
drop policy if exists discord_links_update on public.discord_links;
create policy discord_links_update on public.discord_links for update to authenticated
  using (public.is_owner(team_id)) with check (public.is_owner(team_id));

-- Rolle-modus uten rolle gir ingen mening. Sjekken ligger i en trigger og ikke i
-- en constraint fordi serveren setter rolla i et eget steg etter at rolla er laget.
create or replace function public.discord_links_ping_valid()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.ping_mode = 'role' and new.ping_role_id is null then
    raise exception 'ping_role_required' using errcode = 'check_violation';
  end if;
  if new.ping_mode = 'members' then
    new.managed_role := false;
  end if;
  return new;
end;
$$;

drop trigger if exists discord_links_ping_valid on public.discord_links;
create trigger discord_links_ping_valid
  before insert or update on public.discord_links
  for each row execute function public.discord_links_ping_valid();

-- ------------------------------------------------------------
-- 3. Kanaler per meldingstype
-- ------------------------------------------------------------
create table if not exists public.discord_channels (
  team_id     uuid not null references public.teams (id) on delete cascade,
  kind        text not null check (kind in ('schedule', 'updates', 'reminders')),
  channel_id  text not null check (channel_id ~ '^[0-9]{5,25}$'),
  primary key (team_id, kind),
  -- Én kanal, ett lag. Velger admin en kanal et annet lag alt bruker, feiler det
  -- her i stedet for at to lag poster om hverandre.
  unique (channel_id)
);

alter table public.discord_channels enable row level security;
grant select, insert, update, delete on public.discord_channels to authenticated;

drop policy if exists discord_channels_select on public.discord_channels;
create policy discord_channels_select on public.discord_channels for select to authenticated
  using (public.is_member(team_id));
drop policy if exists discord_channels_write on public.discord_channels;
create policy discord_channels_write on public.discord_channels for all to authenticated
  using (public.is_owner(team_id)) with check (public.is_owner(team_id));

-- En kanal kan bare kobles til et lag som faktisk er koblet til en server.
create or replace function public.discord_channels_linked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.discord_links l where l.team_id = new.team_id) then
    raise exception 'team_not_linked' using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists discord_channels_linked on public.discord_channels;
create trigger discord_channels_linked
  before insert or update on public.discord_channels
  for each row execute function public.discord_channels_linked();

-- ------------------------------------------------------------
-- 4. Tidene. Én rad per lag, lages av serveren ved kobling.
--
-- Ukedag er isodow (1 = mandag, 7 = søndag). Klokkeslett er i lagets sone
-- (teams.timezone, 0016). Regelen for hvilken uke som postes: uka som
-- inneholder «i dag + 1 dag» i lagets sone. Søndag kveld gir neste uke,
-- mandag morgen gir denne.
-- ------------------------------------------------------------
create table if not exists public.discord_schedules (
  team_id           uuid primary key references public.teams (id) on delete cascade,
  post_enabled      boolean not null default true,
  post_dow          smallint not null default 7 check (post_dow between 1 and 7),
  post_at           time not null default '20:00',
  nudge_enabled     boolean not null default true,
  nudge_dow         smallint not null default 4 check (nudge_dow between 1 and 7),
  nudge_at          time not null default '20:00',
  updates_enabled   boolean not null default true,
  same_day_enabled  boolean not null default true,
  same_day_hours    numeric(4, 1) not null default 2 check (same_day_hours between 0.5 and 48),
  same_day_mode     text not null default 'channel' check (same_day_mode in ('channel', 'dm', 'both'))
);

alter table public.discord_schedules enable row level security;
grant select on public.discord_schedules to authenticated;
grant update (post_enabled, post_dow, post_at, nudge_enabled, nudge_dow, nudge_at,
              updates_enabled, same_day_enabled, same_day_hours, same_day_mode)
  on public.discord_schedules to authenticated;

drop policy if exists discord_schedules_select on public.discord_schedules;
create policy discord_schedules_select on public.discord_schedules for select to authenticated
  using (public.is_member(team_id));
drop policy if exists discord_schedules_update on public.discord_schedules;
create policy discord_schedules_update on public.discord_schedules for update to authenticated
  using (public.is_owner(team_id)) with check (public.is_owner(team_id));

-- ------------------------------------------------------------
-- 5. Den levende ukeposten og loggen. Bare serveren skriver.
-- ------------------------------------------------------------
create table if not exists public.discord_week_post (
  team_id       uuid primary key references public.teams (id) on delete cascade,
  week_start    date not null,
  channel_id    text not null,
  message_id    text not null,
  -- Hash av innholdet sist vi skrev det. Er den lik, er det ingenting å PATCHe.
  content_hash  text not null,
  posted_at     timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.discord_week_post enable row level security;
grant select on public.discord_week_post to authenticated;
drop policy if exists discord_week_post_select on public.discord_week_post;
create policy discord_week_post_select on public.discord_week_post for select to authenticated
  using (public.is_member(team_id));

create table if not exists public.discord_log (
  id        bigint generated always as identity primary key,
  team_id   uuid not null references public.teams (id) on delete cascade,
  kind      text not null check (kind in ('week_post', 'update', 'reminder', 'nudge', 'test', 'link')),
  summary   text not null check (char_length(summary) <= 200),
  ok        boolean not null,
  -- Feilen i klartekst, slik den vises i Settings. Aldri en rå Discord-kode alene.
  detail    text check (detail is null or char_length(detail) <= 500),
  at        timestamptz not null default now()
);
create index if not exists discord_log_team_at_idx on public.discord_log (team_id, at desc);

alter table public.discord_log enable row level security;
grant select on public.discord_log to authenticated;
drop policy if exists discord_log_select on public.discord_log;
create policy discord_log_select on public.discord_log for select to authenticated
  using (public.is_member(team_id));

-- Loggen vokser. Behold de siste 50 per lag.
create or replace function public.discord_log_trim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.discord_log
   where team_id = new.team_id
     and id not in (
       select id from public.discord_log
        where team_id = new.team_id
        order by at desc, id desc
        limit 50
     );
  return null;
end;
$$;

drop trigger if exists discord_log_trim on public.discord_log;
create trigger discord_log_trim
  after insert on public.discord_log
  for each row execute function public.discord_log_trim();

-- ------------------------------------------------------------
-- 6. bot_week: uka slik boten skal tegne den.
--
-- Bare det som er booket: dag, tid, tittel, farge, og hvem som har sagt ja
-- (med discord_id, så de kan vises som navnechips). Ingen tilgjengelighet.
-- Kjøres som eier og er bare gitt til service_role. Klienten har ingen grunn
-- til å kalle den; den har useWeekData.
-- ------------------------------------------------------------
create or replace function public.bot_week(team uuid, week_start date)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  t record;
  result jsonb;
begin
  select id, name, timezone into t from public.teams where id = team;
  if not found then
    return null;
  end if;
  if extract(isodow from week_start) <> 1 then
    raise exception 'week_start_not_monday' using errcode = 'check_violation';
  end if;

  select jsonb_build_object(
    'team', jsonb_build_object('id', t.id, 'name', t.name, 'timezone', t.timezone),
    'week_start', week_start,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'date', e.date,
        'start_hour', e.start_hour,
        'end_hour', e.end_hour,
        'title', coalesce(ty.name, e.title),
        'opponent', e.opponent,
        'color', coalesce(ty.color, e.color),
        'people', coalesce((
          select jsonb_agg(jsonb_build_object('name', p.display_name, 'discord_id', p.discord_id) order by p.display_name)
          from public.event_responses r
          join public.profiles p on p.user_id = r.user_id
          where r.event_id = e.id and r.status = 'coming'
        ), '[]'::jsonb)
      ) order by e.date, e.start_hour)
      from public.events e
      left join public.activity_types ty on ty.id = e.type_id
      where e.team_id = t.id
        and e.date >= week_start
        and e.date < week_start + 7
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('name', p.display_name, 'discord_id', p.discord_id) order by p.display_name)
      from public.members m
      join public.profiles p on p.user_id = m.user_id
      where m.team_id = t.id
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

-- ------------------------------------------------------------
-- 7. Rettigheter på funksjonene. Nye funksjoner får PUBLIC-execute som
-- standard; det tar vi bort. Bare serveren kaller bot_week.
-- ------------------------------------------------------------
revoke execute on function public.discord_id_from(jsonb) from public, anon, authenticated;
revoke execute on function public.discord_links_ping_valid() from public, anon, authenticated;
revoke execute on function public.discord_channels_linked() from public, anon, authenticated;
revoke execute on function public.discord_log_trim() from public, anon, authenticated;
revoke execute on function public.bot_week(uuid, date) from public, anon, authenticated;
grant execute on function public.bot_week(uuid, date) to service_role;

-- Serveren skriver med service_role. I Supabase har den alt alle grants; mot
-- en vanlig Postgres (testene) må de gis.
grant all on public.discord_links, public.discord_channels, public.discord_schedules,
              public.discord_week_post, public.discord_log to service_role;
grant usage, select on sequence public.discord_log_id_seq to service_role;
