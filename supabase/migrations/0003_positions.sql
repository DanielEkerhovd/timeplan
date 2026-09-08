-- ============================================================
-- Lane-posisjon på medlemmer (Top, Jungle, Mid, Bot, Support, Sub, Coach).
--
-- Rein visning. Tilgang styres fortsatt av role (owner/coach/player).
-- Du kan sette din egen; eier og trener kan sette alle sine.
-- Kolonnen `position` fantes fra 0001, men ingen kunne skrive til den.
-- ============================================================

alter table public.members
  drop constraint if exists members_position_check,
  add constraint members_position_check check (
    position is null or position in ('top', 'jungle', 'mid', 'bot', 'support', 'sub', 'coach')
  );

-- Bare denne ene kolonnen kan oppdateres. role kan fortsatt bare endres via set_role/transfer_ownership.
grant update (position) on public.members to authenticated;

create policy members_update_position on public.members for update to authenticated
  using (user_id = auth.uid() or public.is_editor(team_id))
  with check (user_id = auth.uid() or public.is_editor(team_id));
