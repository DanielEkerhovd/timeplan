-- ============================================================
-- Lengre delingskode, og lenka går via appens eget domene.
--
-- 10 tegn (49,5 bits) til 14 tegn (69 bits): rundt 700 000 ganger vanskeligere
-- å gjette. Koden skrives aldri av for hånd, så lengden koster ingenting.
-- Eksisterende lag får ny kode; gamle delingslenker slutter å virke, og det er
-- riktig — de var kortere enn vi vil ha dem.
-- ============================================================

alter table public.teams alter column share_slug set default public.random_code(14);

-- share_week() godtok slugs opp til 20 tegn fra før, så den trenger ingen endring.
create or replace function public.rotate_share_slug(team uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare slug text;
begin
  if not public.is_owner(team) then
    raise exception 'not_owner' using errcode = 'insufficient_privilege';
  end if;
  update public.teams set share_slug = public.random_code(14) where id = team
  returning share_slug into slug;
  return slug;
end;
$$;

-- Alle som fortsatt har den korte koden får en ny.
update public.teams set share_slug = public.random_code(14) where char_length(share_slug) < 14;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.rotate_share_slug(uuid) to authenticated;
grant execute on function public.share_week(text, date) to anon, authenticated;
grant execute on function public.week_monday(date) to anon, authenticated;
grant execute on function public.save_default_week(uuid, date) to authenticated;
grant execute on function public.apply_default_week(uuid, date) to authenticated;
grant execute on function public.create_team(text, text) to authenticated;
grant execute on function public.join_team(text) to authenticated;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;
grant execute on function public.set_role(uuid, uuid, public.member_role) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.leave_team(uuid) to authenticated;
grant execute on function public.delete_team(uuid, text) to authenticated;
grant execute on function public.available_users(uuid, date, int, int) to authenticated;
grant execute on function public.set_display_name(text) to authenticated;
grant execute on function public.random_code(int) to authenticated;
