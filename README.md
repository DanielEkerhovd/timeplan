# Timeplan

Ukeplan for lag. Spillerne krysser av kveldene de kan, eier og trener ser hvor alle er ledige, legger inn aktiviteter og deler uka på Discord.

React + Vite + TypeScript + Tailwind i front. Supabase (Postgres, Auth med Discord, Realtime, Edge Functions) bak.

Status: steg 1 (grunnmur og sikkerhet), steg 2 (ukevisningen), steg 3 (ledervisningen) og steg 5 (innstillinger og lagstyring) er ferdig, med det endelige designet. Neste er steg 4, delingsbildet til Discord.

## Roller

| Rolle | Kan |
|---|---|
| Eier (`owner`) | Alt. Én per lag. Gir og tar trenerrolle, endrer laginnstillinger, overfører eierskap, sletter laget. |
| Trener (`coach`) | Redigere planen: aktiviteter, intervaller, invitasjonskoder. Fjerne spillere. |
| Spiller (`player`) | Krysse av egen tid, svare på aktiviteter, se laget. |

## Kom i gang

### 1. Supabase-prosjekt

1. Lag et prosjekt på [supabase.com](https://supabase.com). Velg region Frankfurt (eu-central-1).
2. Under **Authentication → Providers → Discord**: slå på. Du trenger Client ID og Client Secret fra steg 2.
3. Under **Authentication → URL Configuration**: sett Site URL til der appen skal bo (f.eks. `https://timeplan.dittdomene.no`), og legg til `http://localhost:5173/**` under Redirect URLs. Bare eksakte adresser her. Dette er den vanligste måten OAuth kan misbrukes på.

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

Alternativt: åpne filene i `supabase/migrations/` i SQL Editor i Supabase og kjør dem i rekkefølge (`0001_init.sql`, `0002_activity_types.sql`, `0003_positions.sql`, `0004_custom_names.sql`).

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

Skjermene følger mockupene. På PC er appen fullskjerm med sidemeny (Week / Players / Settings); lange lister ruller inne i sin egen boks, ikke hele sida. På mobil er det topptekst og fanelinje nederst.

**Week → My week** (alle)
- Uka ligger i URL-en som `?week=2026-W37`. Uten parameter vises inneværende uke.
- «Planned this week» øverst: aktivitetene med dag, tittel, tid og Discord-avatarene til de som er med. Én knapp: Join / Joined. Eier og trener blir med her de også.
- Under: knappene fra `team_slots` (hverdag/helg), sju kolonner på PC og ett kort per dag på mobil. Prikkraden på knappen er én prikk per lagkamerat, fylt = kan hele blokken. Et trykk lagrer med en gang («Saved»-toast); overlappende intervaller håndteres i `src/lib/slots.ts` (enhetstester: `npm test`).
- Har du ikke svart for uka, får du et banner med «Fill in my usual week». «Use this week as my usual week» lagrer mønsteret (`save_default_week` / `apply_default_week`).

**Week → Team overview** (eier og trener, `?view=team`)
- Samme «Planned this week»-kort, med Edit-knapp per aktivitet.
- Rutenettet viser bare hvem som er ledige: antall, prikker, grønn ramme når alle kan. Ligger det en aktivitet i blokka, får cella en tynn stripe øverst i aktivitetens farge og navnet under tallet («2 activities» og delt stripe ved to). Klikk på en blokk for å booke der.
- «Everyone can» til høyre: blokkene der alle er ledige og ingenting er booket. Lista ruller.
- Skjemaet: dato, fra/til, «What» = lagets typer eller Custom. Typer med «Ask for opponent» får et motstanderfelt; Custom får tittel og en av 8 farger. «Shows as» viser resultatet. Overlapper det en annen aktivitet, advarer skjemaet men lar deg booke likevel (maks 4 per dag).

**Players**: du kan sette ditt eget visningsnavn (trykk på navnet ditt nederst i sidemenyen, eller avataren på mobil); det vinner over Discord-navnet i alle lag til du velger «Use Discord name». Medlemmer med rolle (tilgang) og lane-posisjon (Top, Jungle, Mid, Bot, Support, Sub, Coach; bare visning). Du setter din egen posisjon, eier og trener kan sette alle. Eier bytter Coach/Player, overfører eierskap og fjerner folk; trener fjerner spillere; alle andre kan forlate laget. Eier og trener lager invitasjonskoder (varighet og antall bruk).

**Settings** (eier og trener): intervallene for hverdag og helg, aktivitetstypene (navn, farge, spør om motstander, standard lengde; typer i bruk arkiveres i stedet for å slettes), lagnavn, og sletting av laget (bare eier, må skrive lagnavnet).

Aktivitetstyper ligger i `activity_types`. En aktivitet peker enten på en type (`type_id`) eller har egen `title` + `color`; `events_type_or_title` i databasen sørger for at det alltid er akkurat én av dem. Fargen lagres som nøkkel (`yellow`, `blue` …); hex-verdiene ligger i `src/lib/colors.ts`.

Dataene for uka deles mellom sidene gjennom `src/lib/useWeekData.ts` (realtime på `availability`, `events`, `event_responses`, `activity_types`, `team_slots` og `members`).

## Sikkerhetstestene

`supabase/tests/security.sql` er et testskript med fire brukere (eier, trener, spiller og en fremmed fra et annet lag) som prøver alt de ikke skal få lov til, mot hver tabell og hver funksjon. Over 130 sjekker. Alt kjøres i én transaksjon som rulles tilbake, så databasen er uendret etterpå.

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

Se byggeplanen. Igjen: steg 4 delingsbildet (Edge Function + Satori, `share_slug` og «Share week on Discord»-knappen), tidssonehint for spillere i annen sone, og steg 6 drift.

Når du legger til tabeller eller funksjoner: legg til tester i `security.sql` i samme commit.
