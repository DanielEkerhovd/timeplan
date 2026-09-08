-- ============================================================
-- Medlemslista og tidsblokkene skal oppdatere seg av seg selv.
--
-- Appen lyttet allerede på members og team_slots, men tabellene lå ikke i
-- realtime-publikasjonen, så meldingene kom aldri fram. Blir noen med via en
-- invitasjonslenke, måtte de andre laste siden på nytt for å se det.
--
-- Realtime følger RLS: bare de som allerede er med i laget får meldingene,
-- og de ser ikke mer enn de kan lese fra før.
-- ============================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'members'
    ) then
      alter publication supabase_realtime add table public.members;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'team_slots'
    ) then
      alter publication supabase_realtime add table public.team_slots;
    end if;
  end if;
end $$;
