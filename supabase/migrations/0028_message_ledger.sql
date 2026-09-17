-- Kvitteringsboka: én rad per melding boten har lagt ut, og for hvilket lag.
--
-- Hvorfor i det hele tatt: flere lag kan dele én Discord-server, og til og med
-- én kanal. Skal «slett alt boten har lagt ut for dette laget» være trygt, kan
-- vi ikke skanne kanalen og slette alt boten har skrevet — da tar vi naboens
-- meldinger også. Vi kan bare slette meldinger vi selv har skrevet ned at de
-- hører til laget. Derfor denne tabellen, og derfor er den eneste kilden
-- oppryddingen ser på.
--
-- Ingen tilgang for klienten: bare service_role skriver og leser rader. Appen
-- får et tall gjennom discord_message_count() nedenfor.
create table if not exists public.discord_messages (
  id         bigint generated always as identity primary key,
  team_id    uuid not null references public.teams (id) on delete cascade,
  -- Kanalen slik Discord kjenner den. For DM er dette den private kanalen
  -- mellom boten og én person.
  channel_id text not null,
  message_id text not null unique,
  kind       text not null check (kind in ('week_post', 'update', 'reminder', 'nudge', 'test')),
  dm         boolean not null default false,
  sent_at    timestamptz not null default now()
);
create index if not exists discord_messages_team_idx on public.discord_messages (team_id, sent_at);

alter table public.discord_messages enable row level security;
revoke all on public.discord_messages from anon, authenticated;

-- Tallet eieren ser før han bekrefter. Ingen id-er ut til klienten, bare «så
-- mange meldinger står igjen».
create or replace function public.discord_message_count(team uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when public.is_owner(team)
             then (select count(*)::int from public.discord_messages m where m.team_id = team)
           else 0
         end;
$$;
grant execute on function public.discord_message_count(uuid) to authenticated;

-- Loggen skal kunne fortelle at en opprydding skjedde.
alter table public.discord_log drop constraint if exists discord_log_kind_check;
alter table public.discord_log add constraint discord_log_kind_check
  check (kind in ('week_post', 'update', 'reminder', 'nudge', 'test', 'link', 'cleanup'));
