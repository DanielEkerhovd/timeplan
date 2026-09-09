-- ============================================================
-- Siste «Player» ut av databasen.
--
-- 0010 byttet tilgangsnivåene til 'admin' og 'member', men reservenavnet
-- i handle_auth_user sto igjen som 'Player'. Det er navnet en ny bruker
-- får når Discord ikke gir oss noe brukbart — og et brettspillag har
-- fortsatt ingen «Player».
--
-- Funksjonen er ellers uendret fra 0004.
-- ============================================================

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
    'Member'
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

-- De som allerede fikk reservenavnet. custom_name = false betyr at de aldri
-- har valgt navn selv, så dette er reservenavnet og ikke noe de har skrevet.
-- (Heter Discord-navnet ditt bokstavelig talt «Player», blir du «Member» her.
-- Du kan sette navnet ditt selv i profilen.)
update public.profiles
set display_name = 'Member', discord_name = 'Member', updated_at = now()
where discord_name = 'Player' and not custom_name;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.replace_with_default_week(uuid, date) to authenticated;
grant execute on function public.clear_week(uuid, date) to authenticated;
grant execute on function public.clear_default_week(uuid) to authenticated;
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
grant execute on function public.random_code(int) to authenticated;
grant execute on function public.rotate_share_slug(uuid) to authenticated;
grant execute on function public.share_week(text, date) to anon, authenticated;
grant execute on function public.week_monday(date) to anon, authenticated;
