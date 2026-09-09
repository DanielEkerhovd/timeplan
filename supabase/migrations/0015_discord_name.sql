-- ============================================================
-- Discord-navnet, hentet på nytt.
--
-- To ting var galt.
--
-- 1. Navnet ble bare lest når `auth.users` ble skrevet — altså ved innlogging.
--    Bytter du visningsnavn på Discord etterpå, står vårt gamle navn igjen til
--    neste gang tokenet blir fornyet. «Use that instead» ga deg da navnet du
--    hadde da du logget inn, ikke det du heter nå.
--
-- 2. Rekkefølgen tok ikke høyde for at Discord legger visningsnavnet på
--    `global_name` øverst i metadataen også, ikke bare under `custom_claims`.
--    Uten den fikk vi kontonavnet (fabbiel) i stedet for navnet du har satt (Fabe).
--
-- Så: én funksjon som regner ut navnet, brukt både av triggeren og av en ny
-- `refresh_discord_name()` appen kan kalle. Den leser `auth.users` som eier, så
-- navnet kommer fra Discord og ikke fra det klienten påstår.
-- ============================================================

-- Navnet Discord kjenner deg som. Visningsnavnet først, kontonavnet til slutt.
create or replace function public.discord_name_from(meta jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(coalesce(
    nullif(meta -> 'custom_claims' ->> 'global_name', ''),
    nullif(meta ->> 'global_name', ''),
    nullif(meta ->> 'full_name', ''),
    nullif(meta ->> 'name', ''),
    nullif(meta ->> 'preferred_username', ''),
    'Member'
  ), 40);
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
begin
  insert into public.profiles (user_id, display_name, discord_name, avatar_url, updated_at)
  values (new.id, name, name, left(meta ->> 'avatar_url', 400), now())
  on conflict (user_id) do update
    set discord_name = excluded.discord_name,
        avatar_url = excluded.avatar_url,
        -- Eget navn vinner over Discord.
        display_name = case when public.profiles.custom_name then public.profiles.display_name else excluded.display_name end,
        updated_at = now();
  return new;
end;
$$;

-- Henter navnet fra Discord på nytt, uten å vente på neste innlogging.
-- Har du ikke satt ditt eget navn, følger visningsnavnet med. Returnerer navnet.
create or replace function public.refresh_discord_name()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  name text;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  select public.discord_name_from(coalesce(u.raw_user_meta_data, '{}'::jsonb))
    into name
  from auth.users u where u.id = uid;
  if name is null then
    return null;
  end if;
  update public.profiles
     set discord_name = name,
         display_name = case when custom_name then display_name else name end,
         updated_at = now()
   where user_id = uid;
  return name;
end;
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.refresh_discord_name() to authenticated;
grant execute on function public.share_week(text, date) to anon, authenticated;
grant execute on function public.week_monday(date) to anon, authenticated;
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
grant execute on function public.replace_with_default_week(uuid, date) to authenticated;
grant execute on function public.clear_week(uuid, date) to authenticated;
grant execute on function public.clear_default_week(uuid) to authenticated;
grant execute on function public.random_code(int) to authenticated;
grant execute on function public.rotate_share_slug(uuid) to authenticated;
