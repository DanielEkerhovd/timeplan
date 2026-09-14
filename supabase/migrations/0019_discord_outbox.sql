-- ============================================================
-- Endringsvarsler til Discord (runde 2, del 1): utboksen.
--
-- Ny, flyttet, endret eller avlyst aktivitet skal bli én melding i lagets
-- oppdateringskanal. Ikke fra triggeren direkte: Discord er nede iblant,
-- rate-limiter, og fem raske redigeringer skal bli én melding, ikke fem.
-- Så triggeren legger en rad i `discord_outbox`, og klokka (cron) sender.
--
-- Én rad per aktivitet som venter. Kommer det en ny endring før rada er sendt,
-- oppdateres rada og ventetida nullstilles (to minutter). Det som ble
-- opprettet og slettet før noen fikk se det, sendes aldri.
--
-- `payload` har alt meldinga trenger, tatt vare på i det øyeblikket det skjedde:
-- en slettet aktivitet finnes ikke lenger når cron kommer, og heller ikke
-- svarene på den (de forsvinner med aktiviteten).
-- ============================================================

create table if not exists public.discord_outbox (
  id           bigint generated always as identity primary key,
  team_id      uuid not null references public.teams (id) on delete cascade,
  kind         text not null check (kind in ('new', 'changed', 'cancelled')),
  -- Ingen fremmednøkkel: aktiviteten kan være slettet, det er hele poenget med 'cancelled'.
  event_id     uuid not null,
  payload      jsonb not null,
  send_after   timestamptz not null default now() + interval '2 minutes',
  attempts     int not null default 0,
  sent_at      timestamptz,
  message_id   text,
  last_error   text,
  created_at   timestamptz not null default now()
);

-- Én ventende rad per aktivitet. Sendte rader blir liggende en stund (loggen
-- og knappene på meldinga slår opp i dem), så det unike gjelder bare ventende.
create unique index if not exists discord_outbox_pending_idx
  on public.discord_outbox (event_id) where sent_at is null;
create index if not exists discord_outbox_due_idx
  on public.discord_outbox (send_after) where sent_at is null;
create index if not exists discord_outbox_message_idx
  on public.discord_outbox (message_id) where message_id is not null;

alter table public.discord_outbox enable row level security;
-- Ingen policy for authenticated: klienten har ingenting her å gjøre. Bare serveren.
grant all on public.discord_outbox to service_role;
grant usage, select on sequence public.discord_outbox_id_seq to service_role;

-- ------------------------------------------------------------
-- Det meldinga trenger om en aktivitet, som jsonb. Navn og farge hentes fra
-- typen om det finnes en; ellers det som står på aktiviteten.
-- ------------------------------------------------------------
create or replace function public.discord_event_snapshot(e public.events)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id,
    'date', e.date,
    'start_hour', e.start_hour,
    'end_hour', e.end_hour,
    'title', coalesce(ty.name, e.title),
    'opponent', e.opponent,
    'color', coalesce(ty.color, e.color)
  )
  from (select 1) x
  left join public.activity_types ty on ty.id = e.type_id;
$$;

-- Discord-id-ene til dem som har sagt ja. Tatt vare på for avlysninger.
create or replace function public.discord_event_people(ev uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(p.discord_id order by p.display_name), '[]'::jsonb)
  from public.event_responses r
  join public.profiles p on p.user_id = r.user_id
  where r.event_id = ev and r.status = 'coming' and p.discord_id is not null;
$$;

-- ------------------------------------------------------------
-- Triggeren. Skriver bare når laget er koblet og har varsler på, og bare for
-- aktiviteter fra mandag denne uka og framover. Fortida er ferdig.
-- ------------------------------------------------------------
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
  -- Under sletting av laget kaskaderer aktivitetene bort; da finnes det ingen
  -- å varsle, og en ny rad mot et lag som er på vei ut ville stoppe slettinga.
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

  if coalesce(new.date, old.date) < public.week_monday(current_date) then
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
      -- Ingen har sett den ennå: fortsatt bare «ny», med de siste opplysningene.
      update public.discord_outbox
         set payload = jsonb_build_object('after', public.discord_event_snapshot(new)),
             send_after = now() + interval '2 minutes'
       where id = pending.id;
      return old;
    end if;
    insert into public.discord_outbox (team_id, kind, event_id, payload)
    values (team, 'changed', new.id, jsonb_build_object(
      -- «Før» er slik det sto da første endring kom, uansett hvor mange som følger.
      'before', coalesce(pending.payload -> 'before', public.discord_event_snapshot(old)),
      'after', public.discord_event_snapshot(new)
    ))
    on conflict (event_id) where sent_at is null do update
      set kind = 'changed', payload = excluded.payload, send_after = now() + interval '2 minutes';
    return old;
  end if;

  if tg_op = 'DELETE' then
    if pending.id is not null and pending.kind = 'new' then
      -- Opprettet og slettet før meldinga gikk: ingenting å si.
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

-- BEFORE delete: svarene må leses før de forsvinner med aktiviteten.
drop trigger if exists discord_outbox_on_event_delete on public.events;
create trigger discord_outbox_on_event_delete
  before delete on public.events
  for each row execute function public.discord_outbox_on_event();

drop trigger if exists discord_outbox_on_event on public.events;
create trigger discord_outbox_on_event
  after insert or update on public.events
  for each row execute function public.discord_outbox_on_event();

-- Sendte rader ryddes etter 14 dager. Kjøres av cron sammen med resten.
create or replace function public.discord_outbox_prune()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.discord_outbox where sent_at < now() - interval '14 days';
$$;

revoke execute on function public.discord_event_snapshot(public.events) from public, anon, authenticated;
revoke execute on function public.discord_event_people(uuid) from public, anon, authenticated;
revoke execute on function public.discord_outbox_on_event() from public, anon, authenticated;
revoke execute on function public.discord_outbox_prune() from public, anon, authenticated;
grant execute on function public.discord_outbox_prune() to service_role;
grant execute on function public.discord_event_people(uuid) to service_role;
