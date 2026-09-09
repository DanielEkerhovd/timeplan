-- ============================================================
-- Sikkerhetstester
--
-- Fire brukere:
--   eier_a     eier av lag A («Quackers»)
--   trener_a   trener i lag A (kan redigere planen, ikke roller)
--   spiller_a  spiller i lag A
--   fremmed_b  eier av lag B, har ingenting med lag A å gjøre
--
-- Hver test prøver noe som IKKE skal være lov, og feiler høyt
-- hvis databasen lar det skje. Alt kjøres i én transaksjon som
-- rulles tilbake til slutt, så databasen er uendret etterpå.
--
-- Kjør:  npm run test:security      (mot supabase start)
--        npm run test:security:pg   (mot vanlig Postgres med local_stub.sql)
-- ============================================================

\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on

begin;

-- ------------------------------------------------------------
-- Hjelpere (midlertidige, forsvinner ved rollback)
-- ------------------------------------------------------------
create function pg_temp.expect_denied(label text, stmt text) returns void
language plpgsql as $$
begin
  execute stmt;
  raise exception 'FEIL  %  -> gikk gjennom, men skulle vært nektet: %', label, stmt;
exception
  when insufficient_privilege or check_violation or foreign_key_violation or unique_violation or undefined_table then
    raise notice 'ok    %  (nektet: %)', label, sqlerrm;
end $$;

create function pg_temp.expect_count(label text, stmt text, expected bigint) returns void
language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from (' || stmt || ') s' into n;
  if n <> expected then
    raise exception 'FEIL  %  -> fikk % rader, ventet %: %', label, n, expected, stmt;
  end if;
  raise notice 'ok    %  (% rader)', label, n;
end $$;

create function pg_temp.expect_ok(label text, stmt text) returns void
language plpgsql as $$
begin
  execute stmt;
  raise notice 'ok    %', label;
end $$;

create function pg_temp.become(user_id uuid) returns void
language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
$$;

\set eier_a    '00000000-0000-4000-8000-00000000000a'
\set spiller_a '00000000-0000-4000-8000-00000000000b'
\set fremmed_b '00000000-0000-4000-8000-00000000000c'
\set trener_a  '00000000-0000-4000-8000-00000000000d'
\set dato      '2026-09-10'

-- ------------------------------------------------------------
-- Oppsett som superbruker
-- ------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  (:'eier_a',    'eier_a@test.local',    '{"full_name": "Eier A"}'),
  (:'spiller_a', 'spiller_a@test.local', '{"full_name": "Spiller A"}'),
  (:'fremmed_b', 'fremmed_b@test.local', '{"full_name": "Fremmed B"}'),
  (:'trener_a',  'trener_a@test.local',  '{"full_name": "Trener A"}');

select pg_temp.expect_count('profiler lages av trigger', 'select * from public.profiles', 4);

-- ------------------------------------------------------------
-- Eier A lager lag A, en kode med maks 2 bruk, og ledig tid
-- ------------------------------------------------------------
select pg_temp.become(:'eier_a');
set local role authenticated;

select public.create_team('Quackers', 'Europe/Oslo', array['Top', 'Mid', 'Sub']) as team_a \gset
select id as rolle_top from public.team_roles where team_id = :'team_a' and name = 'Top' \gset
select id as rolle_mid from public.team_roles where team_id = :'team_a' and name = 'Mid' \gset
select id as rolle_sub from public.team_roles where team_id = :'team_a' and name = 'Sub' \gset
select pg_temp.expect_count('nytt lag får rollene som ble sendt inn',
  format('select * from public.team_roles where team_id = %L', :'team_a'), 3);
select id as type_scrim from public.activity_types where team_id = :'team_a' and name = 'Scrim' \gset
select pg_temp.expect_count('nytt lag får 3 standardtyper',
  format('select * from public.activity_types where team_id = %L', :'team_a'), 3);
insert into public.invites (team_id, max_uses) values (:'team_a', 2);
select code as code_a from public.invites where team_id = :'team_a' \gset

insert into public.availability (team_id, date, hour) values
  (:'team_a', :'dato', 19), (:'team_a', :'dato', 20), (:'team_a', :'dato', 21);

select pg_temp.expect_count('eier ser eget lag', 'select * from public.teams', 1);
select pg_temp.expect_count('eier ser 6 standardintervaller', 'select * from public.team_slots', 6);
select pg_temp.expect_count('eier ser egen kode', 'select * from public.invites', 1);

-- Eier kan ikke sette user_id på andres vegne (kolonnen er ikke gitt)
select pg_temp.expect_denied('eier kan ikke skrive tilgjengelighet for andre',
  format('insert into public.availability (team_id, user_id, date, hour) values (%L, %L, %L, 18)', :'team_a', :'spiller_a', :'dato'));

-- Eier kan ikke endre share_slug direkte (kolonnen er ikke gitt)
select pg_temp.expect_denied('eier kan ikke sette share_slug selv',
  format('update public.teams set share_slug = %L where id = %L', 'AAAAAAAAAA', :'team_a'));

-- Eier kan ikke skrive rett i members
select pg_temp.expect_denied('eier kan ikke skrive rett i members',
  format('insert into public.members (team_id, user_id, role) values (%L, %L, %L)', :'team_a', :'spiller_a', 'member'));

-- Eier kan ikke forlate laget uten å gi det videre
select pg_temp.expect_denied('eier kan ikke forlate laget',
  format('select public.leave_team(%L)', :'team_a'));

-- Koder: maks 30 dager, maks 5 aktive
select pg_temp.expect_denied('kode kan ikke vare mer enn 30 dager',
  format('insert into public.invites (team_id, expires_at) values (%L, now() + interval ''40 days'')', :'team_a'));
insert into public.invites (team_id) values (:'team_a'), (:'team_a'), (:'team_a'), (:'team_a');
select pg_temp.expect_denied('maks 5 aktive koder per lag',
  format('insert into public.invites (team_id) values (%L)', :'team_a'));
delete from public.invites where team_id = :'team_a' and code <> :'code_a';

-- Maks 3 lag per bruker
select public.create_team('Lag to') as _x \gset
select public.create_team('Lag tre') as _y \gset
select pg_temp.expect_denied('maks 3 lag per bruker', 'select public.create_team(''Lag fire'')');

-- Søppel avvises
select pg_temp.expect_denied('time utenfor 0–23',
  format('insert into public.availability (team_id, date, hour) values (%L, %L, 25)', :'team_a', :'dato'));
select pg_temp.expect_denied('dato mer enn ett år fram',
  format('insert into public.availability (team_id, date, hour) values (%L, current_date + 400, 19)', :'team_a'));
select pg_temp.expect_denied('aktivitet med slutt før start',
  format('insert into public.events (team_id, date, start_hour, end_hour, type_id) values (%L, %L, 21, 19, %L)', :'team_a', :'dato', :'type_scrim'));
select pg_temp.expect_denied('custom-aktivitet med for lang tittel',
  format('insert into public.events (team_id, date, start_hour, end_hour, title, color) values (%L, %L, 19, 22, %L, ''blue'')', :'team_a', :'dato', repeat('x', 81)));
select pg_temp.expect_denied('custom-aktivitet uten farge avvises',
  format('insert into public.events (team_id, date, start_hour, end_hour, title) values (%L, %L, 19, 22, ''Flex'')', :'team_a', :'dato'));
select pg_temp.expect_denied('aktivitet med både type og tittel avvises',
  format('insert into public.events (team_id, date, start_hour, end_hour, type_id, title, color) values (%L, %L, 19, 22, %L, ''Begge'', ''blue'')', :'team_a', :'dato', :'type_scrim'));
select pg_temp.expect_denied('eier kan ikke lage mer enn 12 typer',
  format('insert into public.activity_types (team_id, name) select %L, ''Type '' || g from generate_series(1, 10) g', :'team_a'));

-- En ekte aktivitet til senere tester
insert into public.events (team_id, date, start_hour, end_hour, type_id, opponent)
  values (:'team_a', :'dato', 19, 22, :'type_scrim', 'Nordic Wolves');
select id as event_a from public.events where team_id = :'team_a' and type_id = :'type_scrim' \gset
select pg_temp.expect_ok('custom-aktivitet med tittel og farge',
  format('insert into public.events (team_id, date, start_hour, end_hour, title, color) values (%L, %L, 13, 16, ''Flex 5v5 night'', ''blue'')', :'team_a', :'dato'));

reset role;

-- ------------------------------------------------------------
-- Fremmed B lager lag B og prøver å komme inn i lag A
-- ------------------------------------------------------------
select pg_temp.become(:'fremmed_b');
set local role authenticated;

select public.create_team('Fremmede', 'Europe/Oslo', array['Duelist']) as team_b \gset
select id as rolle_b from public.team_roles where team_id = :'team_b' and name = 'Duelist' \gset

select pg_temp.expect_count('fremmed ser bare sitt eget lag', 'select * from public.teams', 1);
select pg_temp.expect_count('fremmed ser ikke lag A selv med riktig id',
  format('select * from public.teams where id = %L', :'team_a'), 0);
select pg_temp.expect_count('fremmed ser ikke medlemmer i lag A',
  format('select * from public.members where team_id = %L', :'team_a'), 0);
select pg_temp.expect_count('fremmed ser ikke tilgjengelighet i lag A',
  format('select * from public.availability where team_id = %L', :'team_a'), 0);
select pg_temp.expect_count('fremmed ser ikke aktiviteter i lag A',
  format('select * from public.events where team_id = %L', :'team_a'), 0);
select pg_temp.expect_count('fremmed ser ikke intervaller i lag A',
  format('select * from public.team_slots where team_id = %L', :'team_a'), 0);
select pg_temp.expect_count('fremmed ser ikke typene i lag A',
  format('select * from public.activity_types where team_id = %L', :'team_a'), 0);
select pg_temp.expect_denied('fremmed kan ikke bruke lag A sin type på egen aktivitet',
  format('insert into public.events (team_id, date, start_hour, end_hour, type_id) values (%L, %L, 19, 22, %L)', :'team_b', :'dato', :'type_scrim'));
select pg_temp.expect_count('fremmed ser ikke koder i lag A',
  format('select * from public.invites where team_id = %L', :'team_a'), 0);
select pg_temp.expect_count('fremmed ser ikke profilene i lag A',
  format('select * from public.profiles where user_id in (%L, %L)', :'eier_a', :'spiller_a'), 0);
select pg_temp.expect_count('fremmed ser ikke slot_counts for lag A',
  format('select * from public.slot_counts where team_id = %L', :'team_a'), 0);
select pg_temp.expect_count('fremmed får tomt svar fra available_users for lag A',
  format('select * from public.available_users(%L, %L, 19, 22)', :'team_a', :'dato'), 0);

select pg_temp.expect_denied('fremmed kan ikke lese join_attempts', 'select * from public.join_attempts');

select pg_temp.expect_denied('fremmed kan ikke legge seg selv til i lag A',
  format('insert into public.members (team_id, user_id) values (%L, %L)', :'team_a', :'fremmed_b'));
select pg_temp.expect_denied('fremmed kan ikke skrive tilgjengelighet i lag A',
  format('insert into public.availability (team_id, date, hour) values (%L, %L, 19)', :'team_a', :'dato'));
select pg_temp.expect_denied('fremmed kan ikke lage aktivitet i lag A',
  format('insert into public.events (team_id, date, start_hour, end_hour, title, color) values (%L, %L, 19, 22, ''Hack'', ''grey'')', :'team_a', :'dato'));
select pg_temp.expect_denied('fremmed kan ikke lage type i lag A',
  format('insert into public.activity_types (team_id, name) values (%L, ''Hack'')', :'team_a'));
select pg_temp.expect_denied('fremmed kan ikke lage intervall i lag A',
  format('insert into public.team_slots (team_id, day_type, start_hour, end_hour) values (%L, ''weekday'', 10, 13)', :'team_a'));
select pg_temp.expect_denied('fremmed kan ikke lage kode for lag A',
  format('insert into public.invites (team_id) values (%L)', :'team_a'));
select pg_temp.expect_denied('fremmed kan ikke svare på aktivitet i lag A',
  format('insert into public.event_responses (event_id, status) values (%L, ''coming'')', :'event_a'));

-- Oppdatering og sletting mot lag A treffer 0 rader (RLS filtrerer stille)
select pg_temp.expect_ok('fremmed sitt forsøk på å endre navn på lag A treffer ingen rader',
  format('update public.teams set name = ''Hacket'' where id = %L', :'team_a'));
select pg_temp.expect_ok('fremmed sitt forsøk på å slette tilgjengelighet i lag A treffer ingen rader',
  format('delete from public.availability where team_id = %L', :'team_a'));
select pg_temp.expect_ok('fremmed sitt forsøk på å slette aktivitet i lag A treffer ingen rader',
  format('delete from public.events where team_id = %L', :'team_a'));

-- Rollefunksjoner mot lag A
select pg_temp.expect_denied('fremmed kan ikke overføre eierskap i lag A',
  format('select public.transfer_ownership(%L, %L)', :'team_a', :'fremmed_b'));
select pg_temp.expect_denied('fremmed kan ikke sette roller i lag A',
  format('select public.set_role(%L, %L, ''admin'')', :'team_a', :'fremmed_b'));
select pg_temp.expect_denied('fremmed kan ikke fjerne medlemmer i lag A',
  format('select public.remove_member(%L, %L)', :'team_a', :'eier_a'));
select pg_temp.expect_denied('fremmed kan ikke slette lag A',
  format('select public.delete_team(%L, ''Quackers'')', :'team_a'));
select pg_temp.expect_denied('fremmed kan ikke bytte delingslenke for lag A',
  format('select public.rotate_share_slug(%L)', :'team_a'));

-- Gjette koder: feil kode gir NULL (ikke feil, så loggen beholdes). Etter 10 feil: sperring.
do $$
declare i int; r uuid;
begin
  for i in 1 .. 10 loop
    r := public.join_team('FEILKODE' || i);
    if r is not null then
      raise exception 'FEIL  feil kode ble godtatt';
    end if;
  end loop;
  raise notice 'ok    10 feil koder gir null';
end $$;
do $$
begin
  begin
    perform public.join_team('FEILKODE11');
    raise exception 'FEIL  11. forsøk ble ikke sperret';
  exception when check_violation then
    if sqlerrm <> 'too_many_attempts' then
      raise exception 'FEIL  ventet too_many_attempts, fikk %', sqlerrm;
    end if;
    raise notice 'ok    11. forsøk sperres (too_many_attempts)';
  end;
end $$;

reset role;

-- ------------------------------------------------------------
-- Spiller A blir med via koden, og prøver eier-ting
-- ------------------------------------------------------------
select pg_temp.become(:'spiller_a');
set local role authenticated;

select pg_temp.expect_count('spiller blir med via kode (små bokstaver og mellomrom tåles)',
  format('select * from (select public.join_team(%L) as t) j where t is not null', '  ' || lower(:'code_a') || ' '), 1);
select pg_temp.expect_count('spiller ser lag A', format('select * from public.teams where id = %L', :'team_a'), 1);
select pg_temp.expect_count('spiller ser begge medlemmene', format('select * from public.members where team_id = %L', :'team_a'), 2);
select pg_temp.expect_count('spiller ser eierens profil', format('select * from public.profiles where user_id = %L', :'eier_a'), 1);
select pg_temp.expect_count('spiller ser ikke fremmed B sin profil', format('select * from public.profiles where user_id = %L', :'fremmed_b'), 0);
select pg_temp.expect_count('spiller ser eierens tilgjengelighet', format('select * from public.availability where team_id = %L', :'team_a'), 3);
select pg_temp.expect_count('spiller ser ikke koder', 'select * from public.invites', 0);

select pg_temp.expect_ok('spiller skriver egen tilgjengelighet',
  format('insert into public.availability (team_id, date, hour) values (%L, %L, 19), (%L, %L, 20), (%L, %L, 21)', :'team_a', :'dato', :'team_a', :'dato', :'team_a', :'dato'));
select pg_temp.expect_count('slot_counts viser 2 ledige på 19–22',
  format('select * from public.slot_counts where team_id = %L and date = %L and start_hour = 19 and available_count = 2', :'team_a', :'dato'), 1);
select pg_temp.expect_count('slot_counts viser 0 ledige på 18–21',
  format('select * from public.slot_counts where team_id = %L and date = %L and start_hour = 18 and available_count = 0', :'team_a', :'dato'), 1);

-- Roller: lagets egen liste. Spilleren setter sin egen, ikke andres.
select pg_temp.expect_ok('spiller setter egen rolle',
  format('update public.members set role_id = %L where team_id = %L and user_id = %L', :'rolle_mid', :'team_a', :'spiller_a'));
select pg_temp.expect_count('rollen er lagret',
  format('select * from public.members where team_id = %L and user_id = %L and role_id = %L', :'team_a', :'spiller_a', :'rolle_mid'), 1);
select pg_temp.expect_denied('rolle fra et annet lag avvises',
  format('update public.members set role_id = %L where team_id = %L and user_id = %L', :'rolle_b', :'team_a', :'spiller_a'));
select pg_temp.expect_ok('spiller sitt forsøk på å sette eierens rolle treffer ingen rader',
  format('update public.members set role_id = %L where team_id = %L and user_id = %L', :'rolle_sub', :'team_a', :'eier_a'));
select pg_temp.expect_count('eierens rolle er uendret',
  format('select * from public.members where team_id = %L and user_id = %L and role_id is null', :'team_a', :'eier_a'), 1);
select pg_temp.expect_denied('spiller kan ikke lage nye roller',
  format('insert into public.team_roles (team_id, name, sort) values (%L, ''Cheerleader'', 9)', :'team_a'));
select pg_temp.expect_ok('spiller sitt forsøk på å slette en rolle treffer ingen rader',
  format('delete from public.team_roles where id = %L', :'rolle_sub'));
select pg_temp.expect_count('rollen står der fortsatt',
  format('select * from public.team_roles where id = %L', :'rolle_sub'), 1);
select pg_temp.expect_count('spiller ser ikke rollene til et annet lag',
  format('select * from public.team_roles where team_id = %L', :'team_b'), 0);

-- Eget navn: vinner over Discord til du nullstiller
select pg_temp.expect_ok('spiller setter eget navn', 'select public.set_display_name(''  Fabe  '')');
select pg_temp.expect_count('eget navn er lagret (trimmet)',
  format('select * from public.profiles where user_id = %L and display_name = ''Fabe'' and custom_name', :'spiller_a'), 1);
select pg_temp.expect_denied('spiller kan ikke endre navn direkte i tabellen',
  format('update public.profiles set display_name = ''Hack'' where user_id = %L', :'spiller_a'));
reset role;
-- Discord oppdaterer navnet: eget navn skal bli stående
update auth.users set raw_user_meta_data = '{"full_name":"Spiller Nytt"}'::jsonb where id = :'spiller_a';
select pg_temp.expect_count('discord-oppdatering overskriver ikke eget navn (superbruker sjekker)',
  format('select * from public.profiles where user_id = %L and display_name = ''Fabe'' and discord_name = ''Spiller Nytt''', :'spiller_a'), 1);
select pg_temp.become(:'spiller_a');
set local role authenticated;
select pg_temp.expect_ok('spiller går tilbake til discord-navnet', 'select public.set_display_name(null)');
select pg_temp.expect_count('discord-navnet er tilbake',
  format('select * from public.profiles where user_id = %L and display_name = ''Spiller Nytt'' and not custom_name', :'spiller_a'), 1);

-- Egen tidssone: din egen rad, ekte sonenavn, og ingen andres
select pg_temp.expect_ok('spiller setter egen tidssone', 'update public.profiles set timezone = ''Europe/London'' where user_id = auth.uid()');
select pg_temp.expect_count('tidssonen er lagret',
  format('select * from public.profiles where user_id = %L and timezone = ''Europe/London''', :'spiller_a'), 1);
select pg_temp.expect_denied('oppdiktet sone blir avvist',
  'update public.profiles set timezone = ''Mars/Olympus'' where user_id = auth.uid()');
select pg_temp.expect_ok('spiller prøver å sette tidssonen til eieren',
  format('update public.profiles set timezone = ''Asia/Tokyo'' where user_id = %L', :'eier_a'));
select pg_temp.expect_count('eierens tidssone er urørt (RLS traff ingen rader)',
  format('select * from public.profiles where user_id = %L and timezone is null', :'eier_a'), 1);
select pg_temp.expect_ok('tom sone nullstiller', 'update public.profiles set timezone = '''' where user_id = auth.uid()');
select pg_temp.expect_count('sonen er nullstilt',
  format('select * from public.profiles where user_id = %L and timezone is null', :'spiller_a'), 1);

-- Vanlig uke: bytt ut og tøm. Bare dine egne timer, og bare uker som ikke har vært.
select public.week_monday(current_date) as mandag,
       public.week_monday(current_date) + 2 as dato_ikke_mandag,
       public.week_monday(current_date) - 7 as gammel_mandag \gset
insert into public.availability (team_id, date, hour) values
  (:'team_a', :'mandag', 19), (:'team_a', :'mandag', 20);
select pg_temp.expect_ok('spiller lagrer sin vanlige uke',
  format('select public.save_default_week(%L, %L)', :'team_a', :'mandag'));
select pg_temp.expect_ok('spiller bytter uka mot den vanlige uka',
  format('select public.replace_with_default_week(%L, %L)', :'team_a', :'mandag'));
-- Spilleren har allerede 3 timer fra en tidligere test, pluss de 2 her.
select pg_temp.expect_count('timene står der fortsatt etter byttet',
  format('select * from public.availability where team_id = %L and user_id = %L', :'team_a', :'spiller_a'), 5);
select pg_temp.expect_denied('bytte krever mandag',
  format('select public.replace_with_default_week(%L, %L)', :'team_a', :'dato_ikke_mandag'));
select pg_temp.expect_denied('kan ikke bytte ut en uke som har vært',
  format('select public.replace_with_default_week(%L, %L)', :'team_a', :'gammel_mandag'));
select pg_temp.expect_denied('spiller kan ikke tømme uka i et lag han ikke er med i',
  format('select public.clear_week(%L, %L)', :'team_b', :'mandag'));
select pg_temp.expect_ok('spiller tømmer sin egen uke',
  format('select public.clear_week(%L, %L)', :'team_a', :'mandag'));
select pg_temp.expect_count('spillerens timer er borte',
  format('select * from public.availability where team_id = %L and user_id = %L', :'team_a', :'spiller_a'), 0);
select pg_temp.expect_count('eierens timer står urørt',
  format('select * from public.availability where team_id = %L and user_id = %L', :'team_a', :'eier_a'), 3);
select pg_temp.expect_ok('spiller sletter sin vanlige uke',
  format('select public.clear_default_week(%L)', :'team_a'));

select pg_temp.expect_ok('spiller svarer på aktivitet',
  format('insert into public.event_responses (event_id, status) values (%L, ''coming'')', :'event_a'));
select pg_temp.expect_denied('spiller kan ikke svare på vegne av andre',
  format('insert into public.event_responses (event_id, user_id, status) values (%L, %L, ''coming'')', :'event_a', :'eier_a'));

select pg_temp.expect_denied('spiller kan ikke lage aktivitet',
  format('insert into public.events (team_id, date, start_hour, end_hour, type_id) values (%L, %L, 19, 22, %L)', :'team_a', :'dato', :'type_scrim'));
select pg_temp.expect_count('spiller ser lagets typer',
  format('select * from public.activity_types where team_id = %L', :'team_a'), 3);
select pg_temp.expect_denied('spiller kan ikke endre typer',
  format('insert into public.activity_types (team_id, name) values (%L, ''Min type'')', :'team_a'));
select pg_temp.expect_ok('spiller sitt forsøk på å endre en type treffer ingen rader',
  format('update public.activity_types set name = ''Hacket'' where team_id = %L', :'team_a'));
select pg_temp.expect_denied('spiller kan ikke lage kode',
  format('insert into public.invites (team_id) values (%L)', :'team_a'));
select pg_temp.expect_denied('spiller kan ikke endre intervaller',
  format('insert into public.team_slots (team_id, day_type, start_hour, end_hour) values (%L, ''weekday'', 10, 13)', :'team_a'));
select pg_temp.expect_denied('spiller kan ikke endre egen rolle',
  format('update public.members set role = ''owner'' where team_id = %L and user_id = %L', :'team_a', :'spiller_a'));
select pg_temp.expect_denied('spiller kan ikke gi seg selv trenerrolle',
  format('select public.set_role(%L, %L, ''admin'')', :'team_a', :'spiller_a'));
select pg_temp.expect_denied('spiller kan ikke fjerne eieren',
  format('select public.remove_member(%L, %L)', :'team_a', :'eier_a'));
select pg_temp.expect_denied('spiller kan ikke slette laget',
  format('select public.delete_team(%L, ''Quackers'')', :'team_a'));
select pg_temp.expect_ok('spiller sitt forsøk på å endre lagnavn treffer ingen rader',
  format('update public.teams set name = ''Mitt'' where id = %L', :'team_a'));
select pg_temp.expect_ok('spiller sitt forsøk på å slette eierens tilgjengelighet treffer ingen rader',
  format('delete from public.availability where team_id = %L and user_id = %L', :'team_a', :'eier_a'));

reset role;

-- ------------------------------------------------------------
-- Trener A blir med via koden (bruk nr. 2), eier gjør ham til trener
-- ------------------------------------------------------------
select pg_temp.become(:'trener_a');
set local role authenticated;
select pg_temp.expect_count('trener blir med via kode',
  format('select * from (select public.join_team(%L) as t) j where t is not null', :'code_a'), 1);
select pg_temp.expect_denied('som spiller kan han ennå ikke lage aktivitet',
  format('insert into public.events (team_id, date, start_hour, end_hour, type_id) values (%L, %L, 20, 23, %L)', :'team_a', :'dato', :'type_scrim'));
reset role;

select pg_temp.become(:'eier_a');
set local role authenticated;
select pg_temp.expect_denied('eier kan ikke sette noen til eier via set_role',
  format('select public.set_role(%L, %L, ''owner'')', :'team_a', :'trener_a'));
select pg_temp.expect_denied('eier kan ikke endre egen rolle via set_role',
  format('select public.set_role(%L, %L, ''admin'')', :'team_a', :'eier_a'));
select pg_temp.expect_ok('eier gjør trener A til trener',
  format('select public.set_role(%L, %L, ''admin'')', :'team_a', :'trener_a'));
reset role;

select pg_temp.become(:'trener_a');
set local role authenticated;
select pg_temp.expect_ok('trener kan lage aktivitet',
  format('insert into public.events (team_id, date, start_hour, end_hour, type_id) values (%L, %L, 20, 23, %L)', :'team_a', :'dato', :'type_scrim'));
select pg_temp.expect_ok('trener kan lage en ny type',
  format('insert into public.activity_types (team_id, name, color, default_hours) values (%L, ''Clash'', ''teal'', 4)', :'team_a'));
select id as type_clash from public.activity_types where team_id = :'team_a' and name = 'Clash' \gset
select pg_temp.expect_ok('trener booker en Clash-kveld',
  format('insert into public.events (team_id, date, start_hour, end_hour, type_id) values (%L, date %L + 1, 19, 23, %L)', :'team_a', :'dato', :'type_clash'));
select pg_temp.expect_denied('type fra laget kan ikke slettes mens den er i bruk',
  format('delete from public.activity_types where id = %L', :'type_clash'));
select pg_temp.expect_ok('trener kan arkivere en type',
  format('update public.activity_types set archived = true where team_id = %L and name = ''Clash''', :'team_a'));
select pg_temp.expect_ok('aktivitet med arkivert type kan fortsatt flyttes',
  format('update public.events set start_hour = 20 where team_id = %L and type_id = %L', :'team_a', :'type_clash'));
select pg_temp.expect_denied('arkivert type kan ikke brukes på nye aktiviteter',
  format('insert into public.events (team_id, date, start_hour, end_hour, type_id) values (%L, %L, 20, 23, %L)', :'team_a', :'dato', :'type_clash'));
select pg_temp.expect_ok('trener setter rolle på en spiller',
  format('update public.members set role_id = %L where team_id = %L and user_id = %L', :'rolle_top', :'team_a', :'spiller_a'));
select pg_temp.expect_count('spillerens rolle ble endret av treneren',
  format('select * from public.members where team_id = %L and user_id = %L and role_id = %L', :'team_a', :'spiller_a', :'rolle_top'), 1);
select pg_temp.expect_ok('trener legger til en rolle',
  format('insert into public.team_roles (team_id, name, sort) values (%L, ''Analyst'', 9)', :'team_a'));
select pg_temp.expect_denied('samme rollenavn to ganger i ett lag avvises',
  format('insert into public.team_roles (team_id, name, sort) values (%L, ''Analyst'', 10)', :'team_a'));
select pg_temp.expect_ok('to spillere kan ha samme rolle',
  format('update public.members set role_id = %L where team_id = %L and user_id = %L', :'rolle_top', :'team_a', :'trener_a'));
select pg_temp.expect_ok('trener kan lage kode',
  format('insert into public.invites (team_id) values (%L)', :'team_a'));
select pg_temp.expect_ok('trener kan endre intervaller',
  format('insert into public.team_slots (team_id, day_type, start_hour, end_hour) values (%L, ''weekday'', 17, 20)', :'team_a'));
select pg_temp.expect_denied('trener kan ikke gi andre trenerrolle',
  format('select public.set_role(%L, %L, ''admin'')', :'team_a', :'spiller_a'));
select pg_temp.expect_denied('trener kan ikke overføre eierskap',
  format('select public.transfer_ownership(%L, %L)', :'team_a', :'trener_a'));
select pg_temp.expect_denied('trener kan ikke fjerne eieren',
  format('select public.remove_member(%L, %L)', :'team_a', :'eier_a'));
select pg_temp.expect_denied('trener kan ikke slette laget',
  format('select public.delete_team(%L, ''Quackers'')', :'team_a'));
select pg_temp.expect_denied('trener kan ikke bytte delingslenke',
  format('select public.rotate_share_slug(%L)', :'team_a'));
select pg_temp.expect_ok('trener sitt forsøk på å endre lagnavn treffer ingen rader',
  format('update public.teams set name = ''Trenerlaget'' where id = %L', :'team_a'));
select pg_temp.expect_ok('trener kan fjerne en spiller',
  format('select public.remove_member(%L, %L)', :'team_a', :'spiller_a'));
reset role;

-- Spiller A tilbake igjen via en ny kode fra treneren
select pg_temp.become(:'trener_a');
set local role authenticated;
select code as code_t from public.invites where team_id = :'team_a' and created_by = :'trener_a' \gset
reset role;
select pg_temp.become(:'spiller_a');
set local role authenticated;
select pg_temp.expect_count('spiller blir med igjen via trenerens kode',
  format('select * from (select public.join_team(%L) as t) j where t is not null', :'code_t'), 1);
select pg_temp.expect_ok('spiller skriver tilgjengelighet på nytt',
  format('insert into public.availability (team_id, date, hour) values (%L, %L, 19), (%L, %L, 20), (%L, %L, 21)', :'team_a', :'dato', :'team_a', :'dato', :'team_a', :'dato'));
select (date :'dato' - (extract(isodow from date :'dato')::int - 1))::text as mandag \gset
select pg_temp.expect_count('spiller lagrer vanlig uke (3 timer)',
  format('select 1 where public.save_default_week(%L, %L) = 3', :'team_a', :'mandag'), 1);
select pg_temp.expect_count('spiller fyller neste uke fra vanlig uke (3 timer)',
  format('select 1 where public.apply_default_week(%L, date %L + 7) = 3', :'team_a', :'mandag'), 1);
select pg_temp.expect_count('fylling er idempotent (0 nye)',
  format('select 1 where public.apply_default_week(%L, date %L + 7) = 0', :'team_a', :'mandag'), 1);
-- ------------------------------------------------------------
-- Fortida er låst, framtida er begrenset (0006)
-- ------------------------------------------------------------
select pg_temp.expect_denied('kan ikke skrive tilgjengelighet i forrige uke',
  format('insert into public.availability (team_id, date, hour) values (%L, date %L - 7, 19)', :'team_a', :'mandag'));
select pg_temp.expect_denied('kan ikke skrive tilgjengelighet mer enn tre måneder fram',
  format('insert into public.availability (team_id, date, hour) values (%L, current_date + 100, 19)', :'team_a'));
select pg_temp.expect_ok('kan skrive på mandag denne uka selv om den er passert',
  format('insert into public.availability (team_id, date, hour) values (%L, %L, 13) on conflict do nothing', :'team_a', :'mandag'));
select pg_temp.expect_ok('kan skrive to måneder fram',
  format('insert into public.availability (team_id, date, hour) values (%L, current_date + 60, 19) on conflict do nothing', :'team_a'));
select pg_temp.expect_denied('kan ikke fylle vanlig uke inn i fortida',
  format('select public.apply_default_week(%L, date %L - 7)', :'team_a', :'mandag'));
select pg_temp.expect_denied('kan ikke fylle vanlig uke for langt fram',
  format('select public.apply_default_week(%L, date %L + 140)', :'team_a', :'mandag'));
select pg_temp.expect_denied('ingen kan kalle oppryddingen',
  'select public.prune_old_availability()');

-- ------------------------------------------------------------
-- Discord-navnet (0015): hentes fra auth.users, ikke fra klienten
-- ------------------------------------------------------------
select pg_temp.expect_count('refresh henter navnet fra auth.users',
  'select 1 where public.refresh_discord_name() is not null', 1);
select pg_temp.expect_denied('navneregelen er ikke åpen for klienter',
  'select public.discord_name_from(''{}''::jsonb)');

-- ------------------------------------------------------------
-- Stengte dager (0012): eier og admin styrer, alle ser
-- ------------------------------------------------------------
select pg_temp.expect_count('dagen har rader i slot_counts før den stenges',
  format('select 1 from public.slot_counts where team_id = %L and date = %L limit 1', :'team_a', :'dato'), 1);
select pg_temp.expect_denied('medlem kan ikke stenge en dag',
  format('insert into public.closed_days (team_id, date, closed_by) values (%L, %L, %L)', :'team_a', :'dato', :'spiller_a'));
reset role;

select pg_temp.become(:'trener_a');
set local role authenticated;
select pg_temp.expect_denied('admin kan ikke stenge en dag i en annens navn',
  format('insert into public.closed_days (team_id, date, closed_by) values (%L, %L, %L)', :'team_a', :'dato', :'spiller_a'));
select pg_temp.expect_denied('admin kan ikke stenge en dag i fortida',
  format('insert into public.closed_days (team_id, date, closed_by) values (%L, date %L - 7, %L)', :'team_a', :'mandag', :'trener_a'));
select pg_temp.expect_denied('admin kan ikke stenge en dag for langt fram',
  format('insert into public.closed_days (team_id, date, closed_by) values (%L, current_date + 100, %L)', :'team_a', :'trener_a'));
select pg_temp.expect_ok('admin stenger dagen',
  format('insert into public.closed_days (team_id, date, closed_by) values (%L, %L, %L)', :'team_a', :'dato', :'trener_a'));
reset role;

select pg_temp.become(:'spiller_a');
set local role authenticated;
select pg_temp.expect_count('medlemmet ser at dagen er stengt',
  format('select 1 from public.closed_days where team_id = %L and date = %L', :'team_a', :'dato'), 1);
select pg_temp.expect_count('stengt dag er borte fra slot_counts',
  format('select 1 from public.slot_counts where team_id = %L and date = %L', :'team_a', :'dato'), 0);
select pg_temp.expect_count('timene ligger urørt i basen',
  format('select 1 from public.availability where team_id = %L and date = %L and user_id = %L and hour = 19', :'team_a', :'dato', :'spiller_a'), 1);
select pg_temp.expect_ok('medlemmets forsøk på å åpne dagen treffer ingen rader',
  format('delete from public.closed_days where team_id = %L and date = %L', :'team_a', :'dato'));
select pg_temp.expect_count('dagen er fortsatt stengt',
  format('select 1 from public.closed_days where team_id = %L and date = %L', :'team_a', :'dato'), 1);
reset role;

select pg_temp.become(:'fremmed_b');
set local role authenticated;
select pg_temp.expect_count('utenforstående ser ingen stengte dager',
  format('select 1 from public.closed_days where team_id = %L', :'team_a'), 0);
reset role;

select pg_temp.become(:'trener_a');
set local role authenticated;
select pg_temp.expect_ok('admin åpner dagen igjen',
  format('delete from public.closed_days where team_id = %L and date = %L', :'team_a', :'dato'));
reset role;

select pg_temp.become(:'spiller_a');
set local role authenticated;
select pg_temp.expect_count('dagen er tilbake i slot_counts, med timene i behold',
  format('select 1 from public.slot_counts where team_id = %L and date = %L limit 1', :'team_a', :'dato'), 1);
reset role;

-- ------------------------------------------------------------
-- Faste fridager (0014): mønster på laget, unntak per dato
-- ------------------------------------------------------------
select pg_temp.become(:'spiller_a');
set local role authenticated;
select pg_temp.expect_ok('medlemmets forsok pa a sette fast fri treffer ingen rader',
  format('update public.teams set off_weekdays = array[3]::smallint[] where id = %L', :'team_a'));
select pg_temp.expect_count('mønsteret er fortsatt tomt', 
  format('select 1 from public.teams where id = %L and off_weekdays = ''{}''::smallint[]', :'team_a'), 1);
reset role;

select pg_temp.become(:'eier_a');
set local role authenticated;
select pg_temp.expect_denied('eier kan ikke sette en ugyldig vekedag',
  format('update public.teams set off_weekdays = array[0, 9]::smallint[] where id = %L', :'team_a'));
-- Vekedagen til :dato, så testen treffer uansett når den kjøres.
select extract(isodow from date :'dato')::int as dow \gset
select pg_temp.expect_ok('eier setter dagen som fast fri',
  format('update public.teams set off_weekdays = array[%s]::smallint[] where id = %L', :'dow', :'team_a'));
reset role;

select pg_temp.become(:'spiller_a');
set local role authenticated;
select pg_temp.expect_count('fast fri tar dagen ut av slot_counts',
  format('select 1 from public.slot_counts where team_id = %L and date = %L', :'team_a', :'dato'), 0);
select pg_temp.expect_count('timene ligger fortsatt urørt',
  format('select 1 from public.availability where team_id = %L and date = %L and user_id = %L and hour = 19', :'team_a', :'dato', :'spiller_a'), 1);
reset role;

select pg_temp.become(:'trener_a');
set local role authenticated;
select pg_temp.expect_ok('admin åpner den faste fridagen for denne ene uka',
  format('insert into public.closed_days (team_id, date, closed_by, is_off) values (%L, %L, %L, false)', :'team_a', :'dato', :'trener_a'));
reset role;

select pg_temp.become(:'spiller_a');
set local role authenticated;
select pg_temp.expect_count('unntaket vinner over mønsteret',
  format('select 1 from public.slot_counts where team_id = %L and date = %L limit 1', :'team_a', :'dato'), 1);
reset role;

select pg_temp.become(:'trener_a');
set local role authenticated;
select pg_temp.expect_ok('admin fjerner unntaket igjen',
  format('delete from public.closed_days where team_id = %L and date = %L', :'team_a', :'dato'));
reset role;

select pg_temp.become(:'eier_a');
set local role authenticated;
select pg_temp.expect_ok('eier fjerner den faste fridagen',
  format('update public.teams set off_weekdays = ''{}''::smallint[] where id = %L', :'team_a'));

reset role;

-- ------------------------------------------------------------
-- Lagets tidssone (0016): eier kan bytte, og bare til ekte soner
-- ------------------------------------------------------------
select pg_temp.become(:'trener_a');
set local role authenticated;
select pg_temp.expect_ok('admin sitt forsok pa a bytte lagets sone treffer ingen rader',
  format('update public.teams set timezone = ''Asia/Tokyo'' where id = %L', :'team_a'));
select pg_temp.expect_count('sonen er urørt etter admin',
  format('select 1 from public.teams where id = %L and timezone = ''Europe/Oslo''', :'team_a'), 1);
reset role;

select pg_temp.become(:'eier_a');
set local role authenticated;
select pg_temp.expect_denied('oppdiktet sone blir avvist for laget',
  format('update public.teams set timezone = ''Mars/Olympus'' where id = %L', :'team_a'));
select pg_temp.expect_ok('eier bytter lagets sone',
  format('update public.teams set timezone = ''  Asia/Tokyo  '' where id = %L', :'team_a'));
select pg_temp.expect_count('sonen er lagret uten mellomrom rundt',
  format('select 1 from public.teams where id = %L and timezone = ''Asia/Tokyo''', :'team_a'), 1);
select pg_temp.expect_ok('eier setter sonen tilbake',
  format('update public.teams set timezone = ''Europe/Oslo'' where id = %L', :'team_a'));

reset role;

-- Selve navneregelen, kjørt som eier (den er ikke åpen for innloggede).
select pg_temp.expect_count('visningsnavnet på Discord vinner over kontonavnet',
  'select 1 where public.discord_name_from(''{"preferred_username": "fabbiel", "full_name": "fabbiel", "global_name": "Fabe"}''::jsonb) = ''Fabe''', 1);
select pg_temp.expect_count('global_name under custom_claims teller også',
  'select 1 where public.discord_name_from(''{"name": "fabbiel", "custom_claims": {"global_name": "Fabe"}}''::jsonb) = ''Fabe''', 1);
select pg_temp.expect_count('uten noe brukbart blir det Member',
  'select 1 where public.discord_name_from(''{}''::jsonb) = ''Member''', 1);

select pg_temp.become(:'fremmed_b');
set local role authenticated;
select pg_temp.expect_denied('fremmed kan ikke lagre vanlig uke i lag A',
  format('select public.save_default_week(%L, %L)', :'team_a', :'mandag'));
reset role;

-- Koden var maks 2 bruk og er nå oppbrukt: fremmed kan ikke bruke den (og er sperret uansett, så vi nullstiller loggen først)
delete from public.join_attempts where user_id = :'fremmed_b';
select pg_temp.become(:'fremmed_b');
set local role authenticated;
select pg_temp.expect_count('oppbrukt kode gir null', format('select * from (select public.join_team(%L) as t) j where t is not null', :'code_a'), 0);
reset role;

-- ------------------------------------------------------------
-- Deling av uka (share_week): uten innlogging, bare når deling er på
-- ------------------------------------------------------------
select share_slug as slug_a from public.teams where id = :'team_a' \gset
select (date :'dato' - (extract(isodow from date :'dato')::int - 1))::text as mandag \gset
-- Alle tre er ledige lørdag 13–16, så det skal bli en «alle ledige»-blokk
insert into public.availability (team_id, user_id, date, hour)
  select :'team_a', u, date :'dato' + 2, h
  from unnest(array[:'eier_a', :'spiller_a', :'trener_a']::uuid[]) u, generate_series(13, 15) h
  on conflict do nothing;

select set_config('request.jwt.claims', '', true);
set local role anon;
select pg_temp.expect_count('deling av gir null (anon)',
  format('select 1 where public.share_week(%L, %L) is not null', :'slug_a', :'mandag'), 0);
reset role;

select pg_temp.become(:'eier_a');
set local role authenticated;
select pg_temp.expect_ok('eier slår på deling', format('update public.teams set share_enabled = true where id = %L', :'team_a'));
reset role;

select set_config('request.jwt.claims', '', true);
set local role anon;
select pg_temp.expect_count('anon får uka via delingslenka',
  format('select 1 where public.share_week(%L, %L) -> ''team'' ->> ''name'' = ''Quackers''', :'slug_a', :'mandag'), 1);
select pg_temp.expect_count('delingsdata har aktiviteten',
  format('select 1 where jsonb_path_exists(public.share_week(%L, %L), ''$.days[*].events[*] ? (@.title == "Scrim")'')', :'slug_a', :'mandag'), 1);
select pg_temp.expect_count('delingsdata har «alle ledige»-blokka lørdag 13–16',
  format('select 1 where jsonb_path_exists(public.share_week(%L, %L), ''$.days[*].free[*] ? (@.start_hour == 13 && @.end_hour == 16)'')', :'slug_a', :'mandag'), 1);
select pg_temp.expect_count('delingsdata har ingen blokk der bare noen er ledige',
  format('select 1 where jsonb_path_exists(public.share_week(%L, %L), ''$.days[*].free[*] ? (@.start_hour == 19)'')', :'slug_a', :'mandag'), 0);
select pg_temp.expect_count('delingsdata lekker ikke bruker-ider',
  format('select 1 where position(%L in public.share_week(%L, %L)::text) > 0', :'spiller_a', :'slug_a', :'mandag'), 0);
select pg_temp.expect_count('delingskoden er 14 tegn',
  format('select 1 where char_length(%L) = 14', :'slug_a'), 1);
select pg_temp.expect_count('feil slug gir null', format('select 1 where public.share_week(''FEILSLUG99'', %L) is not null', :'mandag'), 0);
select pg_temp.expect_count('en dag som ikke er mandag gir null', format('select 1 where public.share_week(%L, date %L + 1) is not null', :'slug_a', :'mandag'), 0);
select pg_temp.expect_denied('anon kan fortsatt ikke lese teams direkte', 'select * from public.teams');
reset role;

-- ------------------------------------------------------------
-- Eier A: fjerne trener, overføre eierskap, slette
-- ------------------------------------------------------------
select pg_temp.become(:'eier_a');
set local role authenticated;

select pg_temp.expect_count('eieren ser at navnet ikke ble endret',
  format('select * from public.teams where id = %L and name = ''Quackers''', :'team_a'), 1);
select pg_temp.expect_count('eieren ser at tilgjengeligheten fortsatt er der',
  format('select * from public.availability where team_id = %L', :'team_a'), 20);
select pg_temp.expect_count('laget har 3 medlemmer', format('select * from public.members where team_id = %L', :'team_a'), 3);

select pg_temp.expect_ok('eier kan fjerne treneren', format('select public.remove_member(%L, %L)', :'team_a', :'trener_a'));
select pg_temp.expect_denied('kan ikke overføre til en som ikke er medlem',
  format('select public.transfer_ownership(%L, %L)', :'team_a', :'fremmed_b'));
select pg_temp.expect_ok('overfører eierskapet til spiller A',
  format('select public.transfer_ownership(%L, %L)', :'team_a', :'spiller_a'));
select pg_temp.expect_ok('gammel eier er nå trener og kan fortsatt lage aktivitet',
  format('insert into public.events (team_id, date, start_hour, end_hour, title, color) values (%L, %L, 20, 23, ''Ja'', ''pink'')', :'team_a', :'dato'));
select pg_temp.expect_denied('gammel eier kan ikke lenger slette laget',
  format('select public.delete_team(%L, ''Quackers'')', :'team_a'));
select pg_temp.expect_ok('gammel eier kan forlate laget', format('select public.leave_team(%L)', :'team_a'));
select pg_temp.expect_count('etter å ha forlatt laget ser han det ikke lenger',
  format('select * from public.teams where id = %L', :'team_a'), 0);

reset role;

select pg_temp.become(:'spiller_a');
set local role authenticated;
select pg_temp.expect_count('ny eier ser bare seg selv som medlem', format('select * from public.members where team_id = %L', :'team_a'), 1);
select pg_temp.expect_count('tilgjengeligheten til den som forlot laget er borte',
  format('select * from public.availability where team_id = %L', :'team_a'), 11);
select pg_temp.expect_denied('ny eier kan ikke forlate laget', format('select public.leave_team(%L)', :'team_a'));
select pg_temp.expect_denied('ny eier kan ikke slette laget med feil navn',
  format('select public.delete_team(%L, ''Feil navn'')', :'team_a'));
select pg_temp.expect_ok('ny eier sletter laget med riktig navn',
  format('select public.delete_team(%L, ''Quackers'')', :'team_a'));
select pg_temp.expect_count('laget er borte', format('select * from public.teams where id = %L', :'team_a'), 0);
reset role;

select pg_temp.expect_count('alt under laget er borte (superbruker sjekker)',
  format('select * from public.availability where team_id = %L', :'team_a'), 0);
select pg_temp.expect_count('aktivitetene er borte', format('select * from public.events where team_id = %L', :'team_a'), 0);

-- ------------------------------------------------------------
-- Anonym (ikke innlogget) får ingenting
-- ------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
set local role anon;
select pg_temp.expect_denied('anon kan ikke lese teams', 'select * from public.teams');
select pg_temp.expect_denied('anon kan ikke lese availability', 'select * from public.availability');
select pg_temp.expect_denied('anon kan ikke lage lag', 'select public.create_team(''Anon'')');
select pg_temp.expect_denied('anon kan ikke bruke kode', 'select public.join_team(''ABC'')');
reset role;

-- Innlogget, men uten lag
select pg_temp.become(:'fremmed_b');
set local role authenticated;
select pg_temp.expect_count('innlogget uten medlemskap i lag A ser 0 rader i slot_counts', format('select * from public.slot_counts where team_id = %L', :'team_a'), 0);
reset role;

rollback;

\echo
\echo ALLE SIKKERHETSTESTER GIKK GJENNOM
