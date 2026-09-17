-- Lengre logg. «Recent messages» fyller nå hele kolonnen og ruller, så 50 rader
-- per lag var i knappeste laget: en travel uke med ukepost, endringer,
-- påminnelser og purring spiser gjennom det på noen dager. 150 er fortsatt
-- småtteri på disk, og gir historikk nok til å se hva som skjedde forrige uke.
create or replace function public.discord_log_trim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.discord_log
   where team_id = new.team_id
     and id not in (
       select id from public.discord_log
        where team_id = new.team_id
        order by at desc, id desc
        limit 150
     );
  return null;
end;
$$;
