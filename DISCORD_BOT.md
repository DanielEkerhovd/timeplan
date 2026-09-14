# Discord-bot (steg 7)

Planen, skrevet før koden. Oppsettet står i README under «Discord-bot (steg 7)».

**Status, runde 1 (levert):** kobling, kanaler, ping med rolle boten styrer, den levende ukeposten, `/week`, Join/Can't, status og testmelding i Settings. Fire ting ble annerledes enn planen under:

- Kommandoen heter `/week` (appen er på engelsk), ikke `/timeplan`.
- Discord-id-en ligger på `profiles.discord_id`, ikke på `members`. Den er en egenskap ved personen, ikke ved medlemskapet.
- Klokka er `api/discord/cron.ts` på Vercel, kalt av pg_cron via pg_net. Ingen Edge Function: da bor meldingskoden ett sted.
- Outbox-tabellen er ikke laget ennå. Runde 1 trenger den ikke (ukeposten holdes oppdatert av cron med en innholds-hash). Den kommer med runde 2, sammen med purring, endringsvarsler, påminnelser og DM-fallback.

Kort: boten er ikke en prosess som står og lytter. Den er to HTTP-endepunkt og en kø. Discord ringer oss når noen skriver en slash-kommando, og en cron-jobb i Supabase ringer oss når noe skal sendes ut. Resten av tida kjører ingenting.

## Hvorfor serverless

En vanlig discord.js-bot holder en websocket åpen mot Discord hele døgnet. Det krever en maskin som alltid er på, og det er en ting til å drifte og betale for.

Alt i lista over klarer seg uten den websocketen:

| Vi trenger | Løsning |
|---|---|
| Slash-kommandoer, knapper | Interactions Endpoint: Discord POST-er til oss |
| Poste i kanal | REST-kall til Discord med bot-token |
| DM til spiller | REST: opprett DM-kanal, post melding |
| Faste tider, påminnelser | pg_cron i Supabase som drar køen |

Det vi gir opp: boten kan ikke lese vanlige meldinger i kanalen, ikke vise «online», ikke reagere på at noen blir med i serveren. Ingen av delene trengs her.

Bytter du mening seinere er ikke arbeidet bortkastet. Køen og utsendingslogikken er den samme, bare med en annen prosess som drar den.

## Delene

```
Discord  --POST /api/discord-->  Vercel (verifiser signatur, svar < 3 sek)
                                     |
                                     v
                                 Supabase (RPC)

Supabase: events/availability endres
   -> trigger legger rad i discord_outbox
pg_cron hvert 5. min
   -> Edge Function discord-dispatch
       -> drar outbox, sender via Discord REST, merker sendt
```

**`/api/discord` (Vercel).** Tar imot interaksjoner. To ting er kritiske:

1. Discord signerer hver request med Ed25519. Du må verifisere mot **rå body**, ikke den parsede JSON-en. I Vercel betyr det `export const config = { api: { bodyParser: false } }` og lese streamen selv. Feil signatur skal gi 401. Discord sender med vilje ugyldige requests ved oppsett for å sjekke at du gjør dette.
2. Du har 3 sekunder på å svare. Alt som tar lenger tid: svar `type: 5` (deferred) med en gang, gjør jobben, og PATCH svaret etterpå på `/webhooks/<app_id>/<token>/messages/@original`.

**`discord-dispatch` (Supabase Edge Function).** Ingen offentlig tilgang, kalles bare av cron med service-nøkkel. Henter en bunke fra `discord_outbox`, sender, merker sendt eller teller opp forsøk.

**pg_cron.** README-en nevner den alt for `prune_old_availability()`. Samme mønster her, med `pg_net` for å kalle funksjonen:

```sql
select cron.schedule(
  'discord-dispatch', '*/5 * * * *',
  $$select net.http_post(
      url := 'https://<ref>.supabase.co/functions/v1/discord-dispatch',
      headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_key'))
  )$$
);
```

## Køen

Ikke send til Discord fra en trigger eller fra appen. Legg en rad i en tabell og la dispatcher-en ta resten.

Grunnen: Discord er nede iblant, rate-limiter, og bruker svarer 429. Hvis sendinga henger i samme transaksjon som lagringa, feiler lagringa. Og uten kø har du ingen steder å telle forsøk eller unngå dobbeltsending.

```sql
create table discord_outbox (
  id           bigint generated always as identity primary key,
  team_id      uuid not null references teams(id) on delete cascade,
  kind         text not null,          -- week_post, nudge, event_changed, same_day
  target       text not null,          -- channel | dm
  discord_id   text not null,          -- kanal-id eller discord user-id
  payload      jsonb not null,
  dedupe_key   text unique,            -- hindrer dobbel sending
  send_after   timestamptz not null default now(),
  attempts     int not null default 0,
  sent_at      timestamptz,
  last_error   text
);
create index on discord_outbox (send_after) where sent_at is null;
```

`dedupe_key` er nøkkelen til at ting ikke sendes to ganger. Eksempler:

- ukepost: `week:<team_id>:2026-W37`
- purring: `nudge:<team_id>:2026-W37:<user_id>`
- samme dag: `sameday:<event_id>`
- endret aktivitet: `event:<event_id>:<updated_at>`

Redigerer noen samme aktivitet fem ganger på ett minutt, blir det fem rader med ulik nøkkel. Løsningen er ikke dedupe, det er å vente: sett `send_after = now() + 2 min` og la dispatcher-en hoppe over rader for en aktivitet som har en nyere rad i kø. Da får kanalen én melding om «flyttet fra tirsdag til onsdag», ikke fem.

RLS: `discord_outbox` skal ingen klient røre. Ingen policy, `revoke all from authenticated`. Bare service-rollen leser den.

## Hva en melding kan være

Boten poster ikke bilder. Den bygger meldinger av det Discord har innebygd.

**Ren tekst med markdown.** Fet, kursiv, kode, `# overskrifter`, `- lister`, `> sitat` og `-# liten grå tekst`. Ingen tabeller, ingen farget tekst. Maks 2000 tegn.

**Embeds.** Det klassiske bot-kortet: fargestripe til venstre, tittel, opptil 25 felt (maks 3 i bredden), footer. Stiv layout, 6000 tegn totalt.

**Components V2.** Discords nyere layoutsystem (2025). Meldinga bygges av containere, tekstblokker, skillelinjer, seksjoner og knapper. En container får aksentfarge som en embed, men knapper kan stå ved siden av en bestemt linje, ikke bare i en rad nederst. Grenser: 40 komponenter, 4000 tegn tekst. Slås på med `flags: 1 << 15`, og da kan `content` og `embeds` ikke brukes samtidig. **Det er dette vi bruker.**

**Knapper og menyer.** Opptil 25 knapper per melding. `custom_id` lever evig, så Join på tirsdagsposten virker fortsatt på torsdag.

**Tidsstempler.** `<t:1726340400:t>` vises som `20:00` i **leserens egen tidssone**. Hele posten bygges rundt dette. Alt tidssonearbeidet i appen (0008, 0016) følger med gratis. Samme tag med `:R` gir «om 2 timer». Skriv aldri klokkeslett som ren tekst i en melding, og ikke skriv tidssonen heller. Leseren ser sin egen tid, det er hele poenget.

**Mentions uten ping.** `<@id>` vises som en navnechip. Send `allowed_mentions: { parse: [] }`, så får ingen varsel. Slik viser du «hvem er med» uten å spamme. Skal noen faktisk pinges, listes de eksplisitt i `allowed_mentions.users` eller `.roles`.

### Veggen

**Ingen rutenett.** Det går ikke an å tegne en uke i sju kolonner i en vanlig melding. Ukeposten er en **liste**, ikke en kalender. Når det er akseptert, faller resten på plass.

Ingen egne fonter. Ingen avatarer per linje (én thumbnail per seksjon, og den er ikke verdt det). Ingen bilder uten vedlegg.

### Ukeposten

```
┃ ## Dogs · Uke 38
┃ -# 15. – 21. september
┃ ──────────────────────────────
┃ **Tirsdag** <t:…:t> – <t:…:t>
┃ Scrim mot Foxes                       [ Join ] [ Can't ]
┃ @Per @Kari @Ola  ·  3 med
┃ ──────────────────────────────
┃ **Torsdag** <t:…:t> – <t:…:t>
┃ VOD review                            [ Join ] [ Can't ]
┃ @Per @Kari  ·  2 med
┃ ──────────────────────────────
┃ -# Oppdatert <t:…:R>  ·  Åpne i Gather
```

Ny uke: samme post med `@Dogs` øverst, og den pinger. Endringer i uka: PATCH, stille.

### Oppdateringsmelding

```
┃ **Scrim mot Foxes er flyttet**
┃ ~~Tirsdag <t:…:t>~~ → **Onsdag <t:…:t>**
┃ @Per @Kari @Ola                       [ Fortsatt med ] [ Can't ]
```

Ping bare dem som hadde sagt ja.

### Ikke Discord Scheduled Events

Discord har innebygde arrangementer, og det er fristende å lage ett per aktivitet. Vi gjør det ikke. Appen er kilden til aktivitetene, og boten er koblinga til Discord. Et arrangement i tillegg er en tredje kopi av det samme, med sin egen «Interested»-liste som ikke er Join. Det er rot.

## Kobling lag til server

To steg som er lette å blande sammen: **installere** boten og **koble** et lag.

Installasjonen skjer én gang per Discord-server. Koblinga skjer én gang per lag. Har du fem lag på samme server, installerer du boten én gang og kobler fem ganger.

**Installere.** Eier trykker «Koble til Discord» i Settings. Vi sender ham til Discords install-URL med `scope=bot%20applications.commands`, `permissions` (Send Messages, Embed Links, Attach Files, Manage Messages og Manage Roles, se avsnittene om ukeposten og ping. Ikke Manage Events, vi bruker ikke Discords arrangementer) og `state = <signert token med team_id>`. Han velger server, Discord sender ham tilbake til `/api/discord/installed`, vi verifiserer state og leser `guild_id`.

Er boten alt inne i serveren, hopper Discord rett videre. Det er greit, vi lagrer bare uansett.

**Koble.** Han velger kanaler fra en liste vi henter med `GET /guilds/<id>/channels`. Kanaler i flertall, se neste avsnitt. Ikke la ham skrive inn en kanal-id.

```sql
create table discord_links (
  team_id       uuid primary key references teams(id) on delete cascade,
  guild_id      text not null,
  ping_mode     text not null default 'members',  -- members | role
  ping_role_id  text,
  managed_role  boolean not null default false,
  linked_by     uuid not null references auth.users(id),
  created_at    timestamptz not null default now()
);
```

Ingen kanal her. Den hører hjemme per meldingstype, ikke per lag.

### Hvem får lov til å koble

Uten `unique (guild_id)` mangler jeg beskyttelsen jeg hadde tenkt: hva hindrer et vilkårlig lag i å koble seg til serveren din og poste der?

Svaret er at den som kobler må ha **Manage Server** i den Discord-serveren. Det er den ekte sjekken, og den jeg skulle brukt fra starten. Vi ber om `scope=guilds` i tillegg under install-flyten, leser permission-bitene fra `GET /users/@me/guilds`, og krever `MANAGE_GUILD` (0x20).

Følgen er verdt å si høyt: en lageier i Gather som ikke er admin i Discord-serveren, får ikke koblet. Det er riktig. Han skal ikke kunne få en bot til å poste i en server han ikke styrer.

Sjekk også at boten faktisk ser kanalen han velger. `GET /channels/<id>` som svarer 403 betyr at kanalen er privat og boten ikke har tilgang. Si fra i appen der og da, ikke la det feile stille første gang uka skal postes.

### Flere lag på én server

Hvert lag har sitt eget sett kanaler. Ingenting deles.

```
Dogs                      Foxes
  #dogs-schedule            #foxes-schedule
  #dogs-updates             #foxes-updates
  #dogs-chat                #foxes-chat
```

Kanalene i Gather kobles per lag, så `#dogs-schedule` hører til Dogs og ingenting annet. En melding om Foxes havner aldri der.

Det eneste de to lagene deler er at boten er installert én gang i serveren. Det er hele fordelen med å ligge samme sted, og den holder.

Chat-kanalene rører ikke boten. De er ikke koblet til noe.

Det praktiske som følger av dette:

**Kanalvelgeren må vise hva som er opptatt.** Er kanalen alt koblet til et annet lag, skal den være grå med en merknad. Ikke skriv hvilket lag, bare «brukt av et annet lag i denne serveren». Eier av Dogs har ikke nødvendigvis noe med å vite at Foxes finnes.

**Sjekk at rettighetene stemmer per kanal.** Er `#foxes-schedule` en privat kanal bare Foxes ser, må boten være sluppet inn der spesielt. `GET /channels/<id>` som svarer 403 sier fra med en gang.

Tråder er et alternativ hvis du ikke vil ha tolv kanaler i sidemenyen: én `#schedule` med en tråd per lag. Tråd-id-er er kanal-id-er for Discord, så `discord_channels` tar dem uten endring, og sperren virker like godt på tråder. Ulempen er at tråder arkiveres av seg selv og må vekkes, og at folk må følge tråden for å få varsel.

### Kanaler per meldingstype

En kanal for alt fungerer dårlig, og grunnen er at meldingene har to helt ulike jobber.

Ukeposten er en **visningsflate**. Den skal stå i ro og være lett å finne. Varslene er en **strøm**. De skal komme, bli lest og gli forbi.

Har du fem aktiviteter på en uke, pluss endringer og påminnelser, blir det lett femten meldinger. Ligger de i samme kanal som ukeplanen, er ukeplanen langt oppe i historikken innen onsdag.

Så: én kanal per meldingstype, valgt av admin.

```sql
create table discord_channels (
  team_id     uuid not null references teams(id) on delete cascade,
  kind        text not null,     -- schedule | updates | reminders
  channel_id  text not null,
  primary key (team_id, kind),
  unique (channel_id)
);
```

`unique (channel_id)` betyr at en kanal tilhører nøyaktig ett lag. Ikke fordi Discord krever det, men fordi det er slik det skal settes opp, og fordi sperren fanger feilkoblinga: velger admin `#dogs-updates` for Foxes, får han en feil i appen i stedet for at Dogs plutselig leser om Foxes sine kamper.

Tre typer holder. Flere enn det blir et oppsett ingen orker å fylle ut.

| Type | Hva | Passer i |
|---|---|---|
| `schedule` | Ukeposten, én levende melding | `#schedule` |
| `updates` | Ny, flyttet eller avlyst aktivitet | `#update` |
| `reminders` | Påminnelse samme dag, purring som ikke nådde fram som DM | `#update` |

`reminders` er skilt fra `updates` fordi noen vil ha påminnelser et annet sted enn endringer. Er de ikke satt, faller de tilbake på `updates`, og `updates` faller tilbake på `schedule`. Én kanal er nok til å komme i gang, tre er der hvis du vil ha det.

Boten skal ikke ha `#team chat` som standard noe sted. Den kanalen tilhører folkene.

### Ukeposten som lever

I `#schedule` skal det ligge **én** melding, ikke en ny hver gang noe endrer seg.

Vi tar vare på id-en:

```sql
create table discord_week_post (
  team_id     uuid primary key references teams(id) on delete cascade,
  iso_week    text not null,     -- 2026-W37
  channel_id  text not null,
  message_id  text not null,
  posted_at   timestamptz not null default now()
);
```

**Endring i samme uke:** `PATCH /channels/<ch>/messages/<id>` med nytt bilde og ny tekst. Meldinga står der den står, og innholdet er ferskt.

**Ny uke:** slett den gamle og post en ny. Da havner den nederst i kanalen, der folk ser den, og pingen går ut på nytt. En redigering hadde ikke pinget noen, og ukeplanen er det ene folk skal legge merke til hver uke.

Rekkefølgen betyr noe: **post den nye først, slett den gamle etterpå.**

Snur du på det og posten feiler, står kanalen igjen uten ukeplan i det hele tatt. Feiler slettinga i stedet, ligger det to poster der, og det er en feil folk ser og du kan rydde i. Velg den feilen som er synlig.

Rekkefølgen i praksis:

1. Post ny melding, lagre `message_id`
2. Fest den
3. Løsne og slett den gamle
4. Oppdater raden

Feiler steg 3, logg det og gå videre. Ukeplanen er ute, det var poenget. Neste uke rydder du uansett.

Dette er den eneste faste pingen laget får i `#schedule`. Én i uka. Alt annet som pinger, går til `#update`.

Tre ting som er greie å vite før du bygger dette:

**En redigering pinger ikke.** Discord varsler ingen når en melding endres, selv om den inneholder en mention. Det er akkurat derfor delinga over gir mening: ukeposten er stille og alltid riktig, og varslene som skal nå folk går til `#update`. Hadde alt ligget samme sted, ville halvparten av endringene passert i stillhet.

**Fest posten.** Pin ukeposten, så er den ett klikk unna selv om noen har skrevet i kanalen. Løsne den gamle når du fester den nye, Discord tar maks 50 festede meldinger per kanal. Dette krever **Manage Messages**, som må inn i rettighetene vi ber om ved install. Boten kan slette sine egne meldinger uten den, men ikke feste dem.

**Meldinga kan være borte.** Noen rydder i kanalen, og `message_id` peker på ingenting. Discord svarer `10008 Unknown Message`. Da tømmer du raden og poster på nytt i stedet for å telle opp feil og gi opp.

### Hvilket lag mente han

Kanalen avgjør. `/timeplan` i `#dogs-schedule` gjelder Dogs, alltid, fordi kanalen bare tilhører Dogs.

To tilfeller igjen:

**Kanalen er ikke koblet til noe.** Er brukeren medlem i nøyaktig ett lag i denne serveren, bruk det. Ellers gi ham et valg. Kommandoen får et valgfritt `team`-felt med autocomplete, så slår Discord opp lagene hans mens han skriver.

**Han er ikke medlem i laget kanalen tilhører.** Svar likevel.

Kan han lese kanalen, har Discord alt bestemt at han får se det som står der, og ukeposten står der fra før. Å nekte ham `/timeplan` i den samme kanalen er skuespill, han kan bare rulle opp til den festede posten.

Kanalrettigheter i Discord er tilgangsstyringa. Vi bygger ikke vår egen oppå.

### Hvor grensa faktisk går

Regelen i én setning: **viser du noe kanalen alt viser, holder det at han er i kanalen. Skriver du noe, eller viser du noe som ikke står der, må han være medlem.**

Tre tilfeller der medlemskap må sjekkes:

**Knappene.** Join og Can't skriver til `event_responses`. Interaksjonen kommer fra Discord, ikke fra en innlogget bruker, så RLS hjelper deg ikke. Slå opp discord-id-en i `members` og sjekk laget. Er han ikke medlem: ephemeral avvisning, ingen skriving.

**Alt som viser hvem som er ledig når.** Delingslenka gjør det aldri, og boten skal ikke gjøre det heller. Skulle du seinere lage en `/ledig`-kommando, er den bare for medlemmer, uansett hvilken kanal den kjøres i.

**Kommandoer i DM.** En DM har ingen kanalrettigheter å lene seg på. Enkleste løsning er å skru av DM-bruk på kommandoene (`dm_permission: false`), så er kanalen alltid konteksten. Gjør det fra starten.

### La Discord styre hvem som får bruke kommandoene

Server Settings &rarr; Integrations &rarr; Gather lar admin bestemme hvilke roller og kanaler kommandoene virker i. Det er allerede bygget, det er der admin leter, og det er finere enn noe vi kan lage.

Så: ikke bygg rollestyring for kommandoer i appen. Nevn heller hvor knappen er, i statusfeltet på Discord-fanen.

## Ping

To måter, valgt per lag i Settings.

**Ping medlemmene.** Vi bygger mentions av `discord_user_id` på hvert medlem: `<@123> <@456>`. Krever null oppsett i Discord, treffer nøyaktig riktige folk, og holder seg oppdatert av seg selv når noen blir med i eller forlater laget.

Ulempen er at meldinga blir stygg med 12 spillere, og at du ikke kan skrive «@Lag 1» i en vanlig setning.

**Ping en rolle.** Én mention, `<@&789>`, og folk kan skru av varsler for akkurat den rollen hvis de vil.

Her er det to varianter, og forskjellen betyr noe:

*Eksisterende rolle.* Eier velger en rolle serveren alt har. Enkelt, men rolla og laget i Gather driver fra hverandre. Ny spiller i Gather får ikke rolla automatisk, og han blir aldri pinget. Det er den typen feil ingen oppdager før noen ikke møtte opp.

*Rolle boten styrer.* Boten lager rolla («Gather: Lag 1») ved kobling og holder den i takt med laget. Blir noen med i Gather, får han rolla. Forlater han laget, mister han den. Da er en ping på rolla alltid riktig.

Jeg ville gått for den siste, med den første som utvei for lag som alt har roller de er glade i.

To ting å vite om roller boten styrer:

- Boten trenger **Manage Roles**. Det utvider det vi ber om ved install, så det bør inn fra starten selv om du bygger funksjonen seinere. Å be om nye rettigheter i ettertid betyr at alle må installere på nytt.
- **Rollehierarkiet.** Boten kan bare gi og ta roller som ligger under dens egen høyeste rolle i lista. Discord-admin må dra bot-rolla opp. Dette er den vanligste grunnen til at ting virker for deg og ikke for andre, så meldinga når det feiler (`50013 Missing Permissions`) må si nøyaktig det, ikke bare «noe gikk galt».

Synk rolla ved tre anledninger: når noen blir med i laget, når noen forlater det, og som en opprydding i dispatcher-en én gang i døgnet. Den siste fanger opp folk som ble med i Discord-serveren etter at de ble med i laget.

**Aldri `@everyone` eller `@here`.** Ikke som valg engang. Boten pinger folk som har sagt ja til å være i et lag, ingen andre. En bot som kan pinge hele serveren er en bot admin kaster ut.

## Spiller til discord-bruker

Alle logger inn med Discord alt, så id-en finnes. Den ligger i `auth.users.raw_user_meta_data->>'provider_id'` (eller i `auth.identities`). Migrasjon 0015 gjør noe liknende for navnet, så mønsteret er kjent.

Kopier den ned på medlemmet ved innlogging, ikke slå den opp i `auth`-skjemaet ved hver sending:

```sql
alter table members add column discord_user_id text;
```

Ett hensyn: at noen er i laget ditt i appen betyr ikke at de er i Discord-serveren. Sjekk med `GET /guilds/<id>/members/<user_id>` før du pinger. Er de ikke der, hopp over pingen og bare nevn navnet.

## De fire tingene boten gjør

### 1. Poste uka

Manuelt med `/timeplan` og `/timeplan neste`, og automatisk til fast tid.

Ikke PNG-en. Bildet er delingslenka sitt system, for lag som ikke vil ha bot. Boten bygger meldinga av Discords egne byggeklosser, se avsnittet «Hva en melding kan være» under.

Ukeposten er én container i lagets farge, med en seksjon per aktivitet: dag, tid som `<t:…:t>`, tittel, Join og Can't ved siden av, og navnene på dem som er med som chips uten ping. Fem aktiviteter er rundt 25 komponenter av 40 mulige.

Går `/timeplan` i en annen kanal enn `schedule`, post et vanlig svar der i stedet for å røre den levende posten. Kommandoen er et oppslag, ikke en oppdatering.

Automatikken er en rad i `discord_schedules`:

```sql
create table discord_schedules (
  team_id  uuid primary key references teams(id) on delete cascade,
  post_dow int,          -- 0-6, null = av. Ny uke: slett gammel post, lag ny
  post_at  time,         -- i lagets tidssone (0016)
  nudge_dow int,
  nudge_at  time,
  same_day_hours  numeric,        -- null = av, standard 2
  same_day_mode   text not null default 'channel'   -- channel | dm | both
);
```

Dispatcher-en regner ut i lagets sone, ikke i UTC. Migrasjon 0016 la alt inn `teams.timezone`.

### 2. Purre på tomme uker

Ett kall som svarer «hvem i laget har null avkryssinger for uke N». Kjør det på fast tid, typisk torsdag kveld for neste uke.

DM først. DM-en er personlig og kan ha en knapp rett inn i uka.

> Hei! Ingen tider inne for uke 38 enda. [Legg inn tider]

Faller DM-en (Discord svarer `code: 50007`, «Cannot send messages to this user»), er det ikke en feil. Mange har DM fra servere avslått. Da legger dispatcher-en en ny outbox-rad med `target = channel` og samler alle som ikke fikk DM i én melding med ping:

> @Per @Kari mangler fortsatt tider for uke 38. https://www.gatherapp.gg

Merk deg 50007 på medlemmet (`dm_blocked_at`), så slipper du å prøve DM hver uke for folk du vet ikke tar imot.

### 3. Ny eller endret aktivitet

Trigger på `events` for insert, update og delete. Legg rad i outbox med `send_after = now() + 2 min`, som beskrevet over.

Én melding per endring, i kanalen, med ping bare til dem som alt hadde sagt ja hvis aktiviteten flyttes eller avlyses. Ny aktivitet trenger ingen ping, den dukker uansett opp i neste ukepost.

Knapper på meldinga: **Join** og **Can't**. Knappetrykk kommer inn som en interaksjon med `custom_id`, for eksempel `join:<event_id>`. Vi skriver til `event_responses` og svarer `type: 7` (oppdater meldinga) så avatarradene i meldinga stemmer.

#### Her slutter RLS å hjelpe deg

Verdt å bruke litt plass på, for dette er det ene stedet sikkerheten fungerer helt annerledes enn i resten av appen.

På nettsida sender nettleseren en JWT til Supabase. Postgres leser den, setter `auth.uid()`, og RLS-regelen kjører `is_member(team_id)`. Regelen ligger i databasen, under alt annet. Åpner noen devtools og lager forespørselen for hånd, får han fortsatt ikke skrevet til et lag han ikke er med i.

Discord sender ingen JWT. Det finnes ingen innlogget bruker. Alt du har er en discord-id inne i JSON-en.

For å skrive til `event_responses` i det hele tatt, må endepunktet bruke **service role-nøkkelen**. Og den går utenom RLS fullstendig. Det er det den er til for. Databasen skriver villig vekk det du ber om, for hvilket som helst lag.

Regelen ble ikke svakere. Den kjører bare ikke lenger. Endepunktet ditt er det eneste som står igjen, så det må gjøre jobben RLS gjorde.

```
1. Les discord-id fra interaksjonen
   (member.user.id i en server, user.id i DM)
2. Slå opp aktiviteten på id, og hent team_id FRA DEN RADEN
3. Finn rad i members der
   discord_user_id = den id-en OG team_id = aktivitetens lag
4. Ingen rad?  Ephemeral avvisning, skriv ingenting
5. Rad?        Kall en security definer-funksjon med user_id
```

To detaljer å låse:

**Hent `team_id` fra aktiviteten, aldri fra `custom_id`.** Custom_id er data som har vært en tur ut til Discord og tilbake. Slå opp aktiviteten og les laget fra din egen database.

**Bruk en `security definer`-funksjon, ikke et rått insert med service-nøkkelen.** Samme resultat, men regelen ligger ett sted, den lar seg teste i `security.sql` som alt annet, og service-nøkkelen rører én smal funksjon i stedet for hele tabellen.

Den realistiske feilen er ikke en forfalsket forespørsel, Discord signerer dem. Det er han som ser kanalen, trykker Join på et lag han ikke er med i, og havner i Dogs sin liste. Lite, men galt, og gratis å hindre.

### 4. Samme dag

Cron drar alle aktiviteter som starter om X timer og ikke har `reminder_sent_at`. X i `discord_schedules`, standard 2 timer.

```sql
alter table events add column reminder_sent_at timestamptz;
```

Hvem den går til: de som har sagt ja. Ikke hele laget. Har du ikke tenkt å møte, trenger du ingen påminnelse om det.

Hvordan den går ut velges per lag i Settings:

| Modus | Hva skjer |
|---|---|
| `channel` | Én melding i kanalen med ping til dem som er med |
| `dm` | Én DM til hver av dem |
| `both` | Begge deler |

DM er den som faktisk treffer. Folk har Discord på telefonen og ser ikke nødvendigvis en kanal de har dempet. Kanalping er til gjengjeld synlig for laget, så alle ser hvem som er med.

Tre ting å passe på med DM-modus:

**Fallback.** Er DM blokkert (`50007`), skal han ikke bare miste påminnelsen. Dispatcher-en legger en kanalrad med ping til dem som ikke fikk DM, samlet i én melding. Samme mønster som purringa.

**Én rad per mottaker.** DM betyr at ti spillere blir ti outbox-rader, ikke én. `dedupe_key` blir `sameday:<event_id>:<user_id>`. Med `both` legger du kanalrada i tillegg, med `sameday:<event_id>:channel`.

Ti DM-er er ti kall til Discord. Med taket på 20 rader per kjøring går de ut over to kjøringer, altså opptil fem minutter fra hverandre. For en påminnelse to timer før spiller det ingen rolle. Skulle du seinere ville ha påminnelse ti minutter før, må du heve taket eller kjøre cron oftere.

**Presisjon.** Cron hvert femte minutt betyr at «to timer før» i praksis er mellom 1t 55m og 2t før. Greit nok, men si det i Settings hvis du lar folk sette minutter.

Én ting du ikke skal prøve å løse i første runde: den som sier ja tjue minutter før start, etter at påminnelsen alt er sendt. `reminder_sent_at` er satt, så han får ingenting. Det er riktig oppførsel. Han satt jo nettopp i appen.

Spilleren kan slå av sin egen DM med `dm_same_day` på profilen, som for de andre typene. Da får han kanalpingen hvis laget har `both`, og ellers ingenting. Det er hans valg å ta.

## Rate limits

Discord: rundt 50 requests i sekundet globalt for boten, og egne grenser per kanal (5 meldinger per 5 sekunder). Purrer du 15 spillere blir det 15 DM-kanaler å opprette og 15 meldinger å sende.

Tre regler i dispatcher-en:

- Ta maks 20 rader per kjøring. Resten venter til neste cron.
- Minst ett sekund mellom kall til samme kanal. Grensa er 5 meldinger per 5 sekunder per kanal. Med egne kanaler per lag er dette sjelden et problem, men ny uke betyr post, festing og sletting i rask rekkefølge i samme kanal.
- Spre de faste ukepostene med en forsinkelse på 0 til 4 minutter regnet ut fra `team_id`. Har du fem lag i serveren som alle poster søndag 20:00, er det fem samtidige jobber mot samme bot-token. Samme lag får samme forsinkelse hver uke, så det ser fast ut for brukeren.
- Cache DM-kanal-id-en på medlemmet. Du trenger `POST /users/@me/channels` bare første gang.
- Respekter `X-RateLimit-Remaining` og `Retry-After`. Ved 429: `send_after = now() + retry_after`, ikke prøv på nytt i samme kjøring.

Ved andre feil: eksponentiell backoff på `attempts`, gi opp etter 5. En rad som har gitt opp skal være synlig et sted, ikke bare stille død.

## Tilgjengelighet hører hjemme i appen

Beslutning: **boten viser ingen tilgjengelighet.** Verken hvem som er ledig når, eller hvilke blokker hele laget kan.

Delingslenka (PNG-en) er et eget system for lag som ikke vil ha bot, og den viser «alle kan»-blokker som før. Boten er ikke bygget på den og viser ikke det.

Ukeposten fra boten viser altså bare **bookede aktiviteter**: dag, tid, tittel og navnene på dem som har sagt ja. Det er det hele.

Grunnen er at Discord er et annet slags rom. Ting blir liggende, folk skjermdumper, og en kanal har ofte flere lesere enn du tror. Å legge inn tider skal føles som noe du gjør i appen, for laget, ikke noe som blir stående synlig i en chat.

Én praktisk følge: **skal delingslenka nevnes i en bot-melding, pakk den i vinkelparenteser.** `<https://www.gatherapp.gg/w/abc>` hindrer Discord i å lage embed. Ellers unfurler den til bildet med ledige blokker, rett under en post som ikke skulle vise dem.

Purringa nevner bare at noen mangler tider, aldri hvilke tider andre har lagt inn.

Ingen `/ledig`-kommando. Ikke nå, ikke seinere. Vil du se hvem som kan når, går du inn i appen.

## Dashbord i appen

Alt oppsett bor i appen, ikke i slash-kommandoer. Settings får en Discord-fane.

Men skill mellom to ting som er lette å slå sammen:

| Hvem | Bestemmer |
|---|---|
| Eier og admin | Hva laget **sender**: kanal, ping-modus, hvilke meldingstyper som er på, til hvilke tider |
| Hver spiller | Hvordan han **tar imot**: DM eller bare kanalping |

Grunnen er praktisk. Skal admin huke av hver spiller, må han inn i innstillingene hver gang noen blir med eller slutter. Lar du spilleren velge selv, holder det seg oppdatert av seg selv.

Unntaket er nåbarhet. At en spiller har DM avslått er ikke en preferanse, det er en diagnose, og admin skal se den.

### Oppsettet, første gang

Første gang er ikke et skjema. Det er en rekke spørsmål, ett om gangen, med én ting å velge på hvert steg.

**1. Koble til Discord.**
Knapp som sender til Discords install-side. Han velger server og kommer tilbake. Er boten alt i serveren, går dette på ett sekund.

**2. Hvor vil du ha ukeplanen?**
> Boten legger ut uka her og holder den oppdatert. Én melding, alltid nederst i kanalen, festet.

Liste over tekstkanaler boten ser i serveren. Kanaler et annet lag alt bruker er grå med «brukt av et annet lag». Private kanaler boten ikke ser, står ikke i lista i det hele tatt, med en linje under om at boten må slippes inn i dem først.

**3. Hvor vil du ha oppdateringer?**
> Ny aktivitet, flyttet, avlyst, påminnelser samme dag. Dette blir flere meldinger i uka, så velg en kanal som tåler det.

Samme liste, minus kanalen fra steg 2. Nederst et valg: «Samme kanal som ukeplanen». Det lagrer ingen rad, `updates` arver `schedule`. Legg en setning ved: «Ukeplanen blir skjøvet oppover av hver oppdatering. Fungerer for små lag med få aktiviteter.»

**4. Hvem skal pinges?**
> Når uka er klar og når noe endrer seg.

To kort: «Spillerne i laget» (default, null oppsett) og «En rolle». Velger han rolle: en liste over roller boten ser, pluss «La Gather lage en rolle for laget». Se avsnittet om ping.

**5. Send en testmelding.**
Én knapp. Poster «Gather er koblet til Dogs» i ukeplan-kanalen, og en tilsvarende i oppdateringskanalen hvis den er en annen. Går det bra: grønt, «Ferdig». Går det galt: feilen i klartekst og en «Prøv igjen» på samme steg.

Ikke la ham hoppe over testen. Det er her de fleste oppsettsfeilene viser seg, og det er billigere å finne dem nå enn søndag kveld.

**6. Ferdig.**
Status-sida, slik den ser ut hver gang etterpå. Tidene for ukepost og purring står på standardverdier (søndag 20:00, torsdag 20:00 i lagets sone) og kan endres der.

Tre spørsmål, én test. Det er hele oppsettet. Påminnelseskanalen (`reminders`) spørres det ikke om, den arver `updates` og kan endres i Settings av dem som vil.

Hopper han ut halvveis, lagres det han har svart, og fanen viser hvor han slapp. Ingenting sendes før testen er kjørt.

### Settings, Discord-fanen

**Status øverst.** Dette er den viktigste delen av sida, ikke bryterne under. Fire sjekker som kjøres når sida åpnes:

- Er boten fortsatt i serveren? (`GET /guilds/<id>`)
- Ser den alle kanalene? (`GET /channels/<id>` per type, 403 betyr privat kanal uten tilgang)
- Har den Manage Messages i `schedule`-kanalen, så ukeposten kan festes?
- Ligger bot-rolla over rolla den styrer? (bare når `managed_role`)
- Når gikk siste melding ut, og kom den fram?

Uten dette feiler ting stille. Noen fjerner boten fra serveren i mars, og laget oppdager det i mai når ingen møtte til scrim. Med det står det rødt på sida med en gang, med en setning som sier hva som må gjøres.

**Send testmelding.** En knapp som poster «Test fra Gather» i kanalen. Den er verdt mer enn den ser ut som, både mens du bygger og når en ny lageier setter opp for første gang.

**Kanaler og ping.** De samme valgene som i oppsettet, nå som redigerbare felt: ukeplan-kanal, oppdateringskanal, påminnelseskanal (arver oppdateringer om tom), ping-modus og rolle.

Vis hvor hver meldingstype faktisk havner, regnet ut etter arvereglene, ikke bare hva som er fylt inn. «Påminnelse samme dag &rarr; #update (arvet)» sparer deg for spørsmålet.

**Hva vi sender.** Fire brytere som følger de fire funksjonene, med tidsvelger der det trengs:

- Ukeplan i kanalen &rarr; av/på + ukedag og klokkeslett
- Purring på tomme uker &rarr; av/på + ukedag og klokkeslett
- Ny eller endret aktivitet &rarr; av/på
- Påminnelse samme dag &rarr; av/på + hvor mange timer før + DM, kanal eller begge

Tidene vises i lagets sone (0016), med sonen skrevet ved siden av. Ellers får du spørsmålet «20:00 for hvem?» hver gang.

**Siste meldinger.** Ti siste rader fra `discord_outbox` for laget: type, når, sendt eller feilet. Feilede rader viser grunnen i klartekst, ikke Discords feilkode. `50013` betyr ingenting for en lageier, «boten mangler rettigheter til å endre rolla, dra Gather-rolla over Lag 1 i rollelista» betyr alt.

**Koble fra.** Fjerner koblinga og sletter rolla boten styrer. Spør først.

### Spillerens egne valg

Ligger på profilen, ikke i Settings.

```sql
create table discord_prefs (
  user_id        uuid not null references auth.users(id) on delete cascade,
  team_id        uuid not null references teams(id) on delete cascade,
  dm_nudge       boolean not null default true,
  dm_event       boolean not null default false,
  dm_blocked_at  timestamptz,
  dm_channel_id  text,
  primary key (user_id, team_id)
);
```

Per lag, ikke per bruker. En som er med i tre lag vil gjerne dempe det ene uten å miste de to andre.

Standardverdiene over er et forslag: purring som DM (den er personlig og lett å overse i en kanal), aktivitetsendringer bare i kanalen (der hører de hjemme), påminnelse samme dag som DM hvis laget sender DM.

Merk at spillerens bryter bare kan skru **av**. Sender laget bare i kanalen, får han ingen DM uansett hva som står på profilen hans.

`dm_blocked_at` settes av dispatcher-en når Discord svarer `50007`. Vis det på profilen som en nøytral beskjed, ikke en feil: «Discord slipper ikke gjennom DM fra denne serveren. Du får beskjed i kanalen i stedet.» Med lenke til hvor innstillinga ligger i Discord.

`dm_channel_id` er cache, ikke en innstilling. Den skal ikke vises noe sted.

### Ikke bygg alt med en gang

Fristelsen er en side med tjue brytere. Start med status, kanal, ping og én av/på-bryter per funksjon. Tidsvelgere kan ha faste standardverdier i første runde (søndag 20:00 for uka, torsdag 20:00 for purring) og bli redigerbare når noen spør etter det.

## Rekkefølge

1. **Grunnmur.** `/api/discord` med signaturverifisering og `/ping` som svarer `pong`. Registrer én tom kommando. Få dette grønt før noe annet, ellers feilsøker du to ting samtidig.
2. **Kobling.** Install-flyten, `discord_links`, kanalvelger i Settings.
3. **Poste uka.** `/timeplan` manuelt først. Automatisk post etterpå, da trenger du outbox og cron.
4. **Dashbord.** Status, testknapp, kanal og ping. Bygg det her, før funksjonene under, så har du et sted å slå dem av og på mens du tester.
5. **Purring.** Bygger på outbox. Her møter du DM-fallback for første gang.
6. **Aktivitetsvarsler.** Triggere, utsatt sending, Join-knappen.
7. **Samme dag.** Minst arbeid når resten står.

Steg 1 til 4 er en helg. Steg 5 til 7 er en til.

## Hemmeligheter

| Navn | Hvor | Hva |
|---|---|---|
| `DISCORD_PUBLIC_KEY` | Vercel | Verifisere signatur |
| `DISCORD_BOT_TOKEN` | Vercel + Supabase | Sende meldinger |
| `DISCORD_APP_ID` | begge | Registrere kommandoer, PATCHe svar |
| `DISCORD_CLIENT_SECRET` | Vercel | Install-flyten |
| `SERVICE_ROLE_KEY` | Supabase | Dispatcher mot databasen |

Bot-tokenet er allerede kompromittert hvis det havner i en commit. Discord roterer det automatisk når de finner det på GitHub, men regn med at du må rydde selv.

## Tester

Repo-regelen står i README: nye tabeller og funksjoner får tester i `security.sql` i samme commit.

For dette:

- Et medlem skal ikke kunne lese eller skrive `discord_outbox`. Verken sitt eget lag eller andres.
- Et vanlig medlem skal ikke kunne endre `discord_links` eller `discord_schedules`. Bare eier.
- En spiller skal kunne lese og endre sin egen rad i `discord_prefs`, og ingen andres.
- Funksjonen som svarer på knappetrykk skal avvise en discord-id som ikke er medlem i laget aktiviteten hører til.
- `unique (channel_id)`: lag B skal ikke kunne koble en kanal lag A alt bruker, uansett hvilken type.
- Et medlem i lag A skal ikke kunne lese `discord_channels` eller `discord_links` for lag B, selv om lagene deler Discord-server.
- Join-knappen fra en discord-id som ikke er medlem i laget aktiviteten hører til, skal avvises uten å skrive noe. Oppslag kan være åpne, skriving kan ikke.
- `security definer`-funksjonen bak knappen skal hente laget fra aktiviteten, ikke stole på noe som kommer inn utenfra. Test den med et `event_id` fra et annet lag.
- Å koble et lag skal kreve Manage Server i den Discord-serveren. Dette er ikke en RLS-regel, så det trenger en egen test mot endepunktet, ikke bare i `security.sql`.

I tillegg, utenfor `security.sql`: en enhetstest på at signaturverifiseringen avviser feil signatur. Den er lett å få til å «virke» ved at den slipper alt gjennom.
