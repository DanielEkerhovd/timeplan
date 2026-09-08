-- ============================================================
-- Eget visningsnavn.
--
-- Discord-navnet synkes fortsatt inn (discord_name + avatar), men
-- display_name blir bare overskrevet så lenge du ikke har valgt ditt
-- eget navn (custom_name = false). Navnet gjelder deg i alle lag.
-- ============================================================

alter table public.profiles
  add column discord_name text,
  add column custom_name boolean not null default false;

update public.profiles set discord_name = display_name where discord_name is null;

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
  insert into public.profiles (user_id, display_name, discord_name, avatar_url, updated_at)
  values (new.id, left(name, 40), left(name, 40), left(meta ->> 'avatar_url', 400), now())
  on conflict (user_id) do update
    set discord_name = excluded.discord_name,
        avatar_url = excluded.avatar_url,
        -- Eget navn vinner over Discord.
        display_name = case when public.profiles.custom_name then public.profiles.display_name else excluded.display_name end,
        updated_at = now();
  return new;
end;
$$;

-- Navnet settes via funksjon så custom_name alltid henger sammen med display_name.
revoke update (display_name) on public.profiles from authenticated;

-- NULL eller tomt = tilbake til Discord-navnet.
create or replace function public.set_display_name(new_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  trimmed text := left(btrim(coalesce(new_name, '')), 40);
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  if trimmed = '' then
    update public.profiles
      set display_name = coalesce(discord_name, display_name), custom_name = false, updated_at = now()
      where user_id = uid;
  else
    update public.profiles
      set display_name = trimmed, custom_name = true, updated_at = now()
      where user_id = uid;
  end if;
end;
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.set_display_name(text) to authenticated;
