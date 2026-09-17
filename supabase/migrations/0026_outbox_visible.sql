-- Køen av endringsmeldinger, synlig i appen.
--
-- «Recent messages» viste bare det som var sendt. Det som venter (to minutter,
-- så en byge med redigeringer blir ett kort) var usynlig: har du nettopp lagt
-- inn en aktivitet og ikke ser noe i Discord, er det ingen måte å vite om det
-- ligger i kø eller om noe er galt. Nå kan laget se køen, og eieren kan sende
-- den med en gang eller kaste den.
--
-- Bare lesing herfra. Å sende og å kaste går gjennom serveren, som sjekker
-- eierskap på nytt før den rører bot-tokenet.

grant select on public.discord_outbox to authenticated;

drop policy if exists discord_outbox_select on public.discord_outbox;
create policy discord_outbox_select on public.discord_outbox for select to authenticated
  using (public.is_member(team_id));
