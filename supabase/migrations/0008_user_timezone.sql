-- ============================================================
-- Din egen tidssone.
--
-- Alt i appen står fortsatt i lagets tid — ett rutenett, samme tall for alle.
-- Sonen her brukes bare til å forklare forskjellen for den som sitter et annet
-- sted ("20:00 her er 19:00 hos deg"). Den settes automatisk fra nettleseren
-- første gang, og kan endres i profilen.
--
-- Sonen gjelder deg i alle lag, som navnet.
-- ============================================================

alter table public.profiles
  add column timezone text;

-- Bare ekte IANA-navn. En check-constraint kan ikke slå opp i en tabell,
-- så valideringen ligger i en trigger. Ukjent navn er en feil, ikke noe vi
-- lagrer og oppdager senere når klokkeslettene blir feil.
create or replace function public.profiles_timezone_valid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.timezone is not null then
    new.timezone := btrim(new.timezone);
    if new.timezone = '' then
      new.timezone := null;
    elsif not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
      raise exception 'unknown_timezone' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_timezone_valid
  before insert or update of timezone on public.profiles
  for each row execute function public.profiles_timezone_valid();

-- Egen rad kan oppdateres fra før (policy profiles_update), men kolonnen må åpnes.
grant update (timezone) on public.profiles to authenticated;
