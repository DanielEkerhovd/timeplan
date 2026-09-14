-- Discord-bot: herding etter sikkerhetsgjennomgang.
--
-- Før kunne eieren skrive kanal-id og rolle-id rett i tabellene. Regexen sa
-- "ser ut som en Discord-id", men ingen sjekket at kanalen eller rolla faktisk
-- hører til serveren laget er koblet til. Da kunne en eier peke laget sitt mot
-- en kanal i en helt annen server boten står i, eller la boten dele ut en
-- vilkårlig rolle til hele laget. Nå går begge deler gjennom serveren, som
-- spør Discord først. Tabellene er lesbare for medlemmer som før.

-- 1. Kanaler: bare service_role skriver.
revoke insert, update, delete on public.discord_channels from authenticated;
drop policy if exists discord_channels_write on public.discord_channels;

-- 2. Ping: bare service_role skriver.
revoke update (ping_mode, ping_role_id) on public.discord_links from authenticated;
revoke update on public.discord_links from authenticated;
drop policy if exists discord_links_update on public.discord_links;

-- 3. "Rolla er vår" gjelder bare rolla boten laget. Byttes rolle-id-en uten at
--    managed_role settes i samme setning, er det en annen rolle, og da eier vi
--    den ikke. Serveren setter begge i samme update når den lager rolla.
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
  if tg_op = 'UPDATE'
     and new.ping_role_id is distinct from old.ping_role_id
     and new.managed_role = old.managed_role then
    new.managed_role := false;
  end if;
  return new;
end;
$$;
