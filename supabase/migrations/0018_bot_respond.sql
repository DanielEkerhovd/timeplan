-- ============================================================
-- Join / Can't fra Discord i ett kall.
--
-- Knappen gikk fem runder til databasen (aktivitet, medlem, lag, skriving,
-- uka på nytt) før den kunne svare Discord. Hver runde er en tur til
-- Frankfurt, og til sammen ble det ett til to sekunder per trykk. Nå er det
-- én funksjon: sjekk medlemskap ut fra discord-id, skriv svaret, gi uka
-- tilbake slik boten skal tegne den.
--
-- Den kjører som eier og er bare gitt til service_role, akkurat som bot_week.
-- Medlemskapet sjekkes her, ikke i endepunktet: laget er aktivitetens lag,
-- personen er den som eier discord-id-en, og ingenting fra knappen stoles på.
--
-- Svaret er jsonb med enten {"error": ...} eller {"week": ..., "event": ...}.
-- ============================================================

create or replace function public.bot_respond(discord_id text, event_id uuid, status public.response_status)
-- Parameternavnene er det endepunktet sender (PostgREST matcher på navn); inne i
-- funksjonen brukes de alltid med prefiks, siden kolonnene heter det samme.
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e record;
  uid uuid;
  monday date;
begin
  select ev.id, ev.team_id, ev.date, t.timezone, coalesce(ty.name, ev.title) as title, ev.opponent
    into e
  from public.events ev
  join public.teams t on t.id = ev.team_id
  left join public.activity_types ty on ty.id = ev.type_id
  where ev.id = bot_respond.event_id;
  if not found then
    return jsonb_build_object('error', 'gone');
  end if;

  select m.user_id into uid
  from public.members m
  join public.profiles p on p.user_id = m.user_id
  where m.team_id = e.team_id and p.discord_id = bot_respond.discord_id;
  if uid is null then
    return jsonb_build_object('error', 'not_member');
  end if;

  -- Samme lås som i appen: fra mandag denne uka, i lagets sone.
  if e.date < public.week_monday((now() at time zone e.timezone)::date) then
    return jsonb_build_object('error', 'past');
  end if;

  insert into public.event_responses as r (event_id, user_id, status, updated_at)
  values (e.id, uid, bot_respond.status, now())
  on conflict on constraint event_responses_pkey do update
    set status = excluded.status, updated_at = now();

  monday := public.week_monday(e.date);
  return jsonb_build_object(
    'week', public.bot_week(e.team_id, monday),
    'event', jsonb_build_object('title', e.title, 'opponent', e.opponent, 'date', e.date)
  );
end;
$$;

revoke execute on function public.bot_respond(text, uuid, public.response_status) from public, anon, authenticated;
grant execute on function public.bot_respond(text, uuid, public.response_status) to service_role;
