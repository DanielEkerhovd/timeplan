# Timeplan

Ukeplan for lag. Medlemmene krysser av kveldene de kan, eier og admin ser hvor alle er ledige, legger inn aktiviteter og deler uka på Discord.

React + Vite + TypeScript + Tailwind i front. Supabase (Postgres, Auth med Discord, Realtime, Edge Functions) bak.

Status: steg 1 (grunnmur og sikkerhet), steg 2 (ukevisningen), steg 3 (ledervisningen), steg 4 (deling på Discord) og steg 5 (innstillinger og lagstyring) er ferdig. Igjen: tidssonehint og drift.

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

Alternativt: åpne filene i `supabase/migrations/` i SQL Editor i Supabase og kjør dem i rekkefølge (`0001_init.sql`, `0002_activity_types.sql`, `0003_positions.sql`, `0004_custom_names.sql`, `0005_share.sql`, `0006_lock_past.sql`, `0007_share_url.sql`).

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

Appen heter **Gather** og bor på `https://www.gatherapp.gg`. Domenet står tre steder utenfor koden, og alle tre må peke på det samme:

- **Vercel → Environment Variables:** `VITE_SHARE_BASE=https://www.gatherapp.gg`. Uten den bygges delingslenkene fra domenet du tilfeldigvis står på.
- **Supabase → Edge Functions secrets:** `APP_URL=https://www.gatherapp.gg`. Den bestemmer bildet, canonical-lenka og hvor et klikk sender folk — og domenet som står nederst i delingsbildet.
- **Supabase → Authentication → URL Configuration:** Site URL og `https://www.gatherapp.gg/**` under Redirect URLs, ellers virker ikke innlogging med Discord på det nye domenet.

Når du legger til tabeller eller funksjoner: legg til tester i `security.sql` i samme commit.
