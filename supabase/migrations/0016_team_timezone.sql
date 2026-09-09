-- ============================================================
-- Lagets tidssone kan endres etterpå.
--
-- Kolonnen har vært skrivbar for eieren siden 0001 (kolonne-grant og
-- teams_update), men den hadde bare en lengdesjekk. Et lag som flytter, eller
-- en som skrev feil da laget ble laget, skal ikke ende opp med en sone som
-- ikke finnes — da regner vi klokkeslett feil for alle uten å oppdage det.
--
-- Samme regel som profiles fikk i 0008: bare ekte IANA-navn. En
-- check-constraint kan ikke slå opp i en tabell, så det ligger i en trigger.
--
-- Timene i basen er tall og flytter seg ikke. Det som endrer seg er hva de
-- betyr: 18 er 18:00 i den nye sonen. Det er appen sin jobb å si fra om.
-- ============================================================

create or replace function public.teams_timezone_valid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.timezone := btrim(new.timezone);
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'unknown_timezone' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists teams_timezone_valid on public.teams;
create trigger teams_timezone_valid
  before insert or update of timezone on public.teams
  for each row execute function public.teams_timezone_valid();

-- Funksjonen kalles bare av triggeren, aldri direkte.
revoke execute on function public.teams_timezone_valid() from public, anon, authenticated;
