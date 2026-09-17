# Timeplan

Ukeplan for lag. Medlemmene krysser av kveldene de kan, eier og admin ser hvor alle er ledige, legger inn aktiviteter og deler uka på Discord.

React + Vite + TypeScript + Tailwind i front. Supabase (Postgres, Auth med Discord, Realtime, Edge Functions) bak.

Status: steg 1 (grunnmur og sikkerhet), steg 2 (ukevisningen), steg 3 (ledervisningen), steg 4 (deling på Discord), steg 5 (innstillinger og lagstyring) og steg 7 runde 1 (Discord-bot: kobling, ukepost, /week) er ferdig. Igjen: tidssonehint og drift. Boten er ferdig: kobling, ukepost, /week, endringsvarsler, påminnelser og purring.

## Roller

| Rolle | Kan |
|---|---|
| Eier (`owner`) | Alt. Én per lag. Gir og tar admin-tilgang, endrer laginnstillinger, overfører eierskap, sletter laget. |
| Admin (`admin`) | Redigere planen: aktiviteter, intervaller, invitasjonskoder. Fjerne medlemmer. |
| Medlem (`member`) | Krysse av egen tid, svare på aktiviteter, se laget. |

Tilgang er ikke det samme som tittel. Hva folk *kalles* — Top, Mid, Coach, Sub, Duelist — ligger i lagets egen rolleliste (`team_roles`), som eier og admin styrer under Settings.

## Kom i gang

### 1. Supabase-prosjekt

1. Lag et prosjekt på [supabase.com](https://supabase.com). Velg region Frankfurt (eu-central-1).
2. Under **Authentication → Providers → Discord**: slå på. Du trenger Client ID og Client Secret fra steg 2.
3. Under **Authentication → URL Configuration**: sett Site URL til der appen skal bo (f.eks. `https://timeplan.dittdomene.no`), og legg til både `http://localhost:5173/**` og `https://timeplan.dittdomene.no/**` under Redirect URLs. Wildcard-en trengs fordi invitasjonslenker sender deg tilbake til `/join/<kode>` og ikke bare til forsiden; mangler den, havner nye spillere på `/new-team` med koden ferdig utfylt i stedet for rett inn i laget. Bare adresser du eier her — dette er den vanligste måten OAuth kan misbrukes på.

### 2. Discord-app

1. Gå til [discord.com/developers/applications](https://discord.com/developers/applications) og lag en ny application.
2. Under **OAuth2**: kopier Client ID og Client Secret inn i Supabase (steg 1.2).
3. Legg til redirect-URL-en Supabase viser deg (ser ut som `https://xxxx.supabase.co/auth/v1/callback`).

### 3. Kjør migrasjonen

Enklest med [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
npm install -g supabase
supabase login
supabase link --project-ref <prosjekt-ref>
supabase db push
```

Alternativt: åpne filene i `supabase/migrations/` i SQL Editor i Supabase og kjør dem i rekkefølge (`0001_init.sql` … `0020_updates_live_week.sql`).

Har du allerede kjørt 0001? Da kjører du bare `0002_activity_types.sql` (eller `supabase db push`). Den legger til aktivitetstyper, sletter den gamle `type`-kolonnen på `events` og gir alle eksisterende lag typene Scrim, Match og VOD review.

### 4. Appen

```bash
cp .env.example .env.local   # fyll inn URL og anon key fra Project Settings → API
npm install
npm run dev
```

Åpne `http://localhost:5173`, logg inn med Discord, lag et lag.

`npm run preview:ui` åpner skjermene med falske data (uten innlogging), greit for å se på design. Krever fortsatt `.env.local`.

## Slik henger appen sammen

Skjermene følger mockupene. På PC er appen fullskjerm med sidemeny (Week / Members / Settings); lange lister ruller inne i sin egen boks, ikke hele sida. På mobil er det topptekst og fanelinje nederst.

**Week → My week** (alle)
- Uka ligger i URL-en som `?week=2026-W37`. Uten parameter vises inneværende uke.
- «Planned this week» øverst: aktivitetene med dag, tittel, tid og Discord-avatarene til de som er med. Én knapp: Join / Joined. Eier og trener blir med her de også.
- Under: knappene fra `team_slots` (hverdag/helg), sju kolonner på PC og ett kort per dag på mobil. Prikkraden på knappen er én prikk per lagkamerat, fylt = kan hele blokken. Et trykk lagrer med en gang («Saved»-toast); overlappende intervaller håndteres i `src/lib/slots.ts` (enhetstester: `npm test`).
- Har du ikke svart for uka, får du et banner med «Use my template». Options-stripa nederst i kortet har «Save as template», «Use template» og «Clear week» (`save_default_week` / `replace_with_default_week` / `clear_week`); alt som fjerner noe spør først.

**Week → Plan week** (eier og admin, `?view=team`)
- Samme «Planned this week»-kort, med Edit-knapp per aktivitet.
- Rutenettet viser bare hvem som er ledige: antall, prikker, grønn ramme når alle kan. Ligger det en aktivitet i blokka, får cella en tynn stripe øverst i aktivitetens farge og navnet under tallet («2 activities» og delt stripe ved to). Klikk på en blokk for å booke der.
- «Everyone can» til høyre: blokkene der alle er ledige og ingenting er booket. Lista ruller.
- **Cancel day** / **Open day** under datoen (vises når du peker på dagen) tar bort en dag for den uka, eller åpner en fast fridag for én uke. Kolonnen blir grå med «Day off» i My week, dagen forsvinner fra `slot_counts` og fra «alle er ledige» i delingslenka. Timene folk har krysset av blir liggende, så åpner du dagen igjen er alt som før. Bare eier og admin, og bare fra mandag denne uka og tre måneder fram.
- Faste fridager settes i Settings → **Days you play** (bare eier). Mønsteret gjelder framover: endrer du det i dag, blir ikke ukene som har vært grå i ettertid. Regelen står tre steder med samme ordlyd — `slot_counts`, `share_week` og `dayIsOff()` i `src/lib/closedDays.ts`: finnes det et unntak for datoen vinner det, ellers gjelder mønsteret (0013, 0014).
- Skjemaet: dato, fra/til, «What» = lagets typer eller Custom. Typer med «Ask for opponent» får et motstanderfelt; Custom får tittel og en av 8 farger. «Shows as» viser resultatet. Overlapper det en annen aktivitet, advarer skjemaet men lar deg booke likevel (maks 4 per dag).

**Players**: du kan sette ditt eget visningsnavn (trykk på navnet ditt nederst i sidemenyen, eller avataren på mobil); det vinner over Discord-navnet i alle lag til du velger «Use Discord name». Medlemmer med rolle (tilgang) og lane-posisjon (Top, Jungle, Mid, Bot, Support, Sub, Coach; bare visning). Du setter din egen posisjon, eier og trener kan sette alle. Eier bytter Coach/Player, overfører eierskap og fjerner folk; trener fjerner spillere; alle andre kan forlate laget. Eier og trener lager invitasjonskoder (varighet og antall bruk). «Copy link» gir en lenke (`/join/<kode>`) du limer i Discord: mottakeren klikker, logger inn med Discord og står i laget — ingen kode å skrive av. Selve koden kan fortsatt kopieres og tastes inn manuelt på `/new-team`. Lenka viser ikke lagnavnet før du er innlogget; å slå opp koden uten pålogging ville gitt en måte å teste koder på utenom grensa i `join_team` (10 bomskudd per time).

**Deling på Discord** (steg 4): eier slår på deling i Settings. «Share week on Discord» nederst i sidemenyen (eller i menyen på mobil) kopierer lenka for uka du står i. Lenka ligger på appens eget domene (`/w/<kode>`) og skrives om til en Edge Function av `vercel.json`, så Supabase-adressa aldri vises. Funksjonen gir Discord et bilde av uka; se `supabase/functions/README.md` for oppsett. Etter deploy: `curl -sI "https://<appen-din>/w/_selftest.png"` tegner et oppdiktet lag og bekrefter at fonter og wasm kom med. Alle med lenka ser bookede aktiviteter og blokker der alle er ledige, aldri hvem som er ledig når. «New link» (bare eier) gjør gamle lenker døde. Koden er 14 tegn fra et alfabet på 31 (69 bits), så den lar seg ikke gjette. Merk at Discord lagrer bildet sitt eget: en lenke som alt er postet, forsvinner ikke om du bytter kode.

**Låst fortid** (0006): du kan bla bakover og se gamle uker, men ikke endre dem. Skriving er åpen fra mandag i inneværende uke (så du rekker å fikse mandagen på onsdag) og tre måneder fram. Sletting i fortida er stengt på samme måte, men cascade (forlate laget, slette laget) rydder fritt. Gammel tilgjengelighet eldre enn 90 dager slettes av `prune_old_availability()`; den registreres i pg_cron hvis utvidelsen er slått på (Database → Extensions), ellers skjer ingenting og appen virker som før. Aktivitetene blir liggende.

**Mørk modus**: Light / Dark / Auto i brukermenyen nederst i sidemenyen (avataren på mobil). Lagres per nettleser. Alle farger er CSS-variabler i `src/index.css`, med et eget sett for `.dark`.

**Settings** (eier og trener): intervallene for hverdag og helg, aktivitetstypene (navn, farge, spør om motstander, standard lengde; typer i bruk arkiveres i stedet for å slettes), lagnavn, og sletting av laget (bare eier, må skrive lagnavnet).

Aktivitetstyper ligger i `activity_types`. En aktivitet peker enten på en type (`type_id`) eller har egen `title` + `color`; `events_type_or_title` i databasen sørger for at det alltid er akkurat én av dem. Fargen lagres som nøkkel (`yellow`, `blue` …); hex-verdiene ligger i `src/lib/colors.ts`.

Dataene for uka deles mellom sidene gjennom `src/lib/useWeekData.ts` (realtime på `availability`, `events`, `event_responses`, `activity_types`, `team_slots` og `members`).

## Discord-bot (steg 7)

Boten er ikke en prosess som står og lytter. Den er noen HTTP-endepunkt under `api/discord/` på Vercel, pluss tabellene i `0017_discord.sql`. Discord ringer oss når noen skriver `/week` eller trykker Join; pg_cron ringer oss hvert femte minutt for det som skal skje til fast tid. Resten av tida kjører ingenting. Hele tankegangen står i `DISCORD_BOT.md`.

Runde 1 (levert): koble lag til server, velge kanaler, ping (medlemmer eller rolle, gjerne en rolle boten lager og holder i takt), den levende ukeposten i `#schedule` (postes til fast tid med ping, redigeres stille når uka endrer seg, byttes ut når uka er ny), `/week` og Join/Can't-knappene, status og testmelding i Settings → Discord.

Runde 2, del 1 og 2 (levert): varsler ved ny, flyttet, endret eller avlyst aktivitet. En trigger på `events` legger en rad i `discord_outbox` (0019) med to minutters ventetid, så fem raske redigeringer blir én melding; cron sender det som er modent. Bare for uka som alt er postet (0020): endringer i neste uke venter på neste ukepost. Ny aktivitet pinger laget (rolla eller medlemmene), flere på én gang blir ett kort; flytting og avlysning pinger dem som hadde sagt ja. Laget velger kanal, DM eller begge (`updates_mode`); nekter Discord DM til noen (50007) huskes det på profilen (`dm_blocked_at`) og de pinges i kanalen i stedet. «Still in» / «Can't» på kortet skriver samme svar som knappene på ukeposten. Slås av per lag under «What the bot sends».

Runde 2, resten (ikke bygget): purring på tomme uker, påminnelse samme dag, DM med fallback til kanal. Bryterne finnes i Settings, men sender ingenting ennå.

### Oppsett

**1. Discord-appen** (samme app som Supabase bruker til innlogging, [discord.com/developers/applications](https://discord.com/developers/applications)):

- **Bot** → Add Bot (om den ikke finnes) → Reset Token. Det er `DISCORD_BOT_TOKEN`. Ingen privileged intents trengs.
- **General Information** → Public Key er `DISCORD_PUBLIC_KEY`. Application ID er `DISCORD_APP_ID`.
- **General Information** → Interactions Endpoint URL: `https://www.gatherapp.gg/api/discord`. Discord tester adressa med en signert PING og noen med vilje ugyldige forespørsler idet du lagrer, så endepunktet må være deployet med `DISCORD_PUBLIC_KEY` satt først.
- **OAuth2** → Redirects: legg til `https://www.gatherapp.gg/api/discord/callback` ved siden av Supabase-adressa som alt står der.

**2. Miljøvariabler** i Vercel (se `.env.example`, blokken nederst). Ingen av dem har `VITE_`-prefiks; de skal aldri nå klienten. `SUPABASE_SERVICE_ROLE_KEY` går utenom RLS og er grunnen til at endepunktene sjekker eierskap selv før de rører noe.

**3. Migrasjonen** `0017_discord.sql` (`supabase db push`). Den kopierer Discord-id-en til alle som alt er logget inn ned på profilen, så Join-knappen kjenner dem igjen.

**4. Slash-kommandoen**: `node scripts/discord-commands.mjs` (leser `.env.local`). Globalt tar det opptil en time før `/week` vises; `--guild <server-id>` gir den med en gang i én server mens du tester.

**5. Klokka.** Slå på `pg_cron` og `pg_net` under Database → Extensions, og kjør i SQL Editor (bytt ut hemmeligheten):

```sql
select cron.schedule('discord-bot', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://www.gatherapp.gg/api/discord/cron',
    headers := '{"x-cron-secret": "<DISCORD_CRON_SECRET>"}'::jsonb,
    body := '{}'::jsonb
  );
$$);
```

Uten den kommer ukeposten bare når noen trykker «Post this week now». Vercel Cron går også (`Authorization: Bearer` med samme hemmelighet), men på Hobby-planen får den bare kjøre én gang i døgnet.

**6. I appen**: Settings → Discord → Connect to Discord. Den som kobler må ha **Manage Server** i Discord-serveren; det er sjekken som hindrer et fremmed lag i å koble seg til serveren din. Så velger du kanaler, ping og sender en testmelding. Ukeposten går søndag 20:00 i lagets sone til uka som begynner dagen etter; endre det under «What the bot sends».

### Slik henger det sammen

- `api/discord/index.ts` er Interactions Endpoint. Signaturen sjekkes på råbytene før JSON parses. `/week` svarer med uka der kommandoen ble skrevet; kanalen avgjør laget (en kanal tilhører nøyaktig ett lag). Join/Can't skriver til `event_responses` via service role, så **medlemskapet sjekkes i endepunktet**, mot laget aktiviteten hører til, aldri mot noe som står i knappen.
- `api/_lib/message.ts` bygger meldinga av Discords egne blokker (Components V2). Ingen bilder. Klokkeslett som `<t:…>` så alle ser sin egen tid. Navn som chips uten ping; bare den ferske ukeposten pinger, og bare dem laget har valgt.
- `api/_lib/week.ts` eier den levende posten: ny uke = post ny, fest, slett gammel (i den rekkefølgen, så en feil gir to poster og ikke null). Samme uke = PATCH når innholdet har endret seg (hash i `discord_week_post`).
- `api/discord/cron.ts` gjør to ting per lag: poster uka når tida er passert på lagets klokke, og holder den levende posten oppdatert. Begge er idempotente; et tapt eller doblet kall gjør ingen skade.
- Tilgjengelighet (hvem som er ledig når) finnes ikke i noe boten gjør. `bot_week()` gir bare det som er booket. Det er en beslutning.
- Sikkerhetstestene dekker de nye tabellene (bare eier skriver innstillinger, ingen klient skriver ukepost eller logg, to lag kan ikke dele kanal, `bot_week` er bare for serveren). `src/lib/__tests__/discordApi.test.ts` tester signatursjekken, install-state, lagets klokke og selve meldinga.

### Sikkerhetsgjennomgang av boten (0021)

En egen gjennomgang med angriper-briller (uten konto, vanlig medlem, eier av lag A mot lag B, en Discord-bruker med knapper) fant to reelle hull, begge tettet i `0021_discord_hardening.sql` og koden rundt:

- **Kanal-id ble aldri sjekket mot serveren.** Eieren skrev `channel_id` rett i tabellen; regexen sa bare "ser ut som en id". En eier kunne peke laget sitt mot en kanal i en helt annen server boten står i. Nå går kanalvalg gjennom `POST /api/discord/channels {action:'set'}`, som spør Discord om kanalen og krever at den ligger i lagets server og er en tekstkanal. Klienten har ikke lenger skrivetilgang til `discord_channels`. I tillegg sjekkes kanalen én gang til rett før en ny ukepost og før endringsmeldinger sendes.
- **Rolle-id var eier-skrivbar mens `managed_role` sto.** Da kunne "synk rolla" dele ut en vilkårlig rolle (også en annen lags, eller en med rettigheter) til hele laget, og "koble fra" slette den. Nå går rollevalg gjennom `POST /api/discord/roles {action:'pick'}`, som krever at rolla finnes i serveren og ikke er en integrasjonsrolle. En trigger nuller `managed_role` hvis rolle-id-en byttes uten at serveren setter flagget i samme setning. Klienten har ikke lenger skrivetilgang til `discord_links`.

Mindre ting fra samme runde: en brems per lag på knappene i innstillingene (maks 12 handlinger i minuttet, 5 for å lage kanal/rolle), så én eier ikke kan få Discord til å strupe bot-tokenet for alle; 429 fra Discord teller ikke som et forsøk i utboksen; interaksjoner eldre enn fem minutter avvises selv med gyldig signatur; feilmeldinger fra databasen og uventede feil går til loggen, ikke til klienten.

Det som ble sjekket og var i orden: eier-sjekk på hvert endepunkt med lagets id fra forespørselen; ingen filter-injeksjon i PostgREST (alle verdier er regex-sjekket, signerte eller lest fra databasen under constraint); ingen bruker-styrte URL-er mot Discord; OAuth-state med HMAC, utløp og konto-match; cron-hemmelighet i header med konstant-tids sammenlikning; ingen hemmeligheter i svar eller logg; ingen CORS, ingen cookies.

## Køen av endringsmeldinger (0026)

En endring blir ikke sendt med en gang: den ligger to minutter i `discord_outbox`, så en byge med redigeringer blir ett kort. «Recent messages» viser nå det som venter, med hva det gjelder og når det går. Eieren kan sende én med en gang eller kaste den før noen ser den (`outbox_send` / `outbox_cancel`; serveren sjekker at raden hører til laget). Laget kan lese køen, ingen kan skrive i den.

To ting som kunne skjule seg her er rettet samtidig: kunne ikke serveren finne kanalen, ble radene før stemplet som sendt og forsvant — nå venter de og prøver igjen, og bare et slettet lag kaster dem. Og «Send what's waiting now» sier hvorfor det ble null: enten er endringsmeldinger av, eller det er ingenting i kø — og da gjerne fordi uka ikke er postet ennå. Utboks-triggeren fyller bare for uka som faktisk ligger i Discord.

## Purring for neste uke (0024)

På valgt ukedag og klokkeslett (Settings → Discord) finner boten dem som ikke har krysset av én eneste time for neste uke, og ber dem gjøre det — i kanal, som DM, eller begge (`nudge_mode`). Kanalkortet pinger dem vi kan nå og nevner resten ved navn, med «x av y har fylt ut»; DM-en er skrevet til én person, uten mentions. `discord_nudge` holder hvilken uke som sist ble purret, så det skjer én gang per uke; har alle svart, stemples uka uten at noen får melding. `discord_nudge_missing()` (bare service_role) er utvalget. «Send now» ved siden av valgene gjør det samme med én gang, og hopper over den planlagte.

## Påminnelser (0023)

Før en aktivitet sender boten ett kort til dem som har sagt ja, så mange timer før som laget har valgt (Settings → Discord → «Reminder before a session»), i kanal, DM eller begge. `events.reminder_sent_at` gjør at det går én gang; en trigger nullstiller stempelet når aktiviteten flyttes. Klokka henter utvalget fra `discord_reminder_candidates()` (bare service_role) og regner tidspunktet i lagets sone. Eier og trener kan også sende påminnelsen med én gang fra aktivitetens skjema («Send reminder»); da settes stempelet, og den planlagte hoppes over. Knappene på kortet (`rj:`/`rc:`) svarer som Join/Can't og tegner kortet på nytt.

## Halvtimer (0022)

Blokker, aktiviteter og tilgjengelighet kan starte og slutte på halve timer (19:30–21:00), minst én time lange. Kolonnene heter fortsatt `start_hour`, `end_hour` og `hour`, men er `numeric(3,1)` med halve steg: 19.5 er 19:30. Én rad i `availability` (og `default_week`) er én halvtime; migrasjonen la til raden 19.5 for hver gammel rad 19, så ingen mistet noe. `available_users` teller halvtimer, `share_week` går i halve steg, og klienten regnet allerede med desimaltimer (tidssoner som +5:30). Piltastene i bolkredigeringa flytter en halvtime, med Shift en hel. Varsel- og posttider for Discord-boten er fortsatt hele timer.

## Sikkerhetstestene

`supabase/tests/security.sql` er et testskript med fire brukere (eier, trener, spiller og en fremmed fra et annet lag) som prøver alt de ikke skal få lov til, mot hver tabell og hver funksjon. Nesten 150 sjekker. Alt kjøres i én transaksjon som rulles tilbake, så databasen er uendret etterpå.

Mot lokal Supabase (anbefalt):

```bash
supabase start          # starter Postgres, Auth osv. i Docker
supabase db reset       # kjører migrasjonene
npm run test:security
```

Mot en vanlig Postgres uten Supabase (det er dette CI bruker):

```bash
PGHOST=localhost PGUSER=postgres npm run test:security:pg
```

`supabase/tests/local_stub.sql` etterligner det Supabase leverer (auth-skjema, `auth.uid()`, roller) så testene kan kjøre uten Docker. Den skal aldri kjøres mot en ekte Supabase-database.

GitHub Actions (`.github/workflows/security.yml`) kjører testene ved hver push. Rødt bygg = ikke deploy.

## Hvordan sikkerheten henger sammen

- **RLS på alle tabeller, standard nekt.** Hver regel sjekker medlemskap med `is_member(team_id)`, `is_editor(team_id)` eller `is_owner(team_id)`. Riktig UUID uten medlemskap gir null rader, ikke feilmelding.
- **All skriving i `members` går gjennom funksjoner** (`create_team`, `join_team`, `set_role`, `transfer_ownership`, `remove_member`, `leave_team`). Ingen kan endre sin egen rolle.
- **Kolonner du ikke skal røre er ikke gitt.** `user_id` settes av databasen. `share_slug` byttes bare via `rotate_share_slug`.
- **Koder** er 12 tegn (60 bit), utløper, har maks antall bruk, og bare eier/trener kan se dem. Feil kode gir `null` tilbake (ikke feil), så forsøket logges. Etter 10 feil på en time: sperret.
- **Grenser i databasen:** maks 3 lag per bruker, 15 medlemmer per lag, 5 aktive koder, 4 aktiviteter per dag, 12 aktive aktivitetstyper, datoer innenfor ett år, tekstlengder. En type må tilhøre samme lag som aktiviteten (trigger).
- **Views bruker `security_invoker`** så de ikke hopper over RLS.
- **Nye funksjoner får PUBLIC-execute som standard.** Migrasjonen tar det bort og gir bare til `authenticated`. Husk det når du legger til nye funksjoner.

## Neste steg

Igjen: tidssonehint for spillere i annen sone, og steg 6 drift (deploy, redirect-URL-er, GitHub Actions).

Appen heter **Gatherapp.gg** og bor på `https://www.gatherapp.gg`. Domenet står tre steder utenfor koden, og alle tre må peke på det samme:

- **Vercel → Environment Variables:** `VITE_SHARE_BASE=https://www.gatherapp.gg`. Uten den bygges delingslenkene fra domenet du tilfeldigvis står på.
- **Supabase → Edge Functions secrets:** `APP_URL=https://www.gatherapp.gg`. Den bestemmer bildet, canonical-lenka og hvor et klikk sender folk — og domenet som står nederst i delingsbildet.
- **Supabase → Authentication → URL Configuration:** Site URL og `https://www.gatherapp.gg/**` under Redirect URLs, ellers virker ikke innlogging med Discord på det nye domenet.

Når du legger til tabeller eller funksjoner: legg til tester i `security.sql` i samme commit.
