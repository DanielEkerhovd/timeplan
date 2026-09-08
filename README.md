# Timeplan

Ukeplan for lag. Spillerne krysser av kveldene de kan, eier og trener ser hvor alle er ledige, legger inn aktiviteter og deler uka på Discord.

React + Vite + TypeScript + Tailwind i front. Supabase (Postgres, Auth med Discord, Realtime, Edge Functions) bak.

Dette er **steg 1: grunnmur og sikkerhet**. Innlogging, lag, koder, roller og alle tilgangsregler er på plass og testet. Ukevisningen kommer i steg 2.

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

Alternativt: åpne `supabase/migrations/0001_init.sql` i SQL Editor i Supabase og kjør hele fila.

### 4. Appen

```bash
cp .env.example .env.local   # fyll inn URL og anon key fra Project Settings → API
npm install
npm run dev
```

Åpne `http://localhost:5173`, logg inn med Discord, lag et lag.

## Sikkerhetstestene

`supabase/tests/security.sql` er et testskript med fire brukere (eier, trener, spiller og en fremmed fra et annet lag) som prøver alt de ikke skal få lov til, mot hver tabell og hver funksjon. Over 100 sjekker. Alt kjøres i én transaksjon som rulles tilbake, så databasen er uendret etterpå.

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
- **Grenser i databasen:** maks 3 lag per bruker, 15 medlemmer per lag, 5 aktive koder, 4 aktiviteter per dag, datoer innenfor ett år, tekstlengder.
- **Views bruker `security_invoker`** så de ikke hopper over RLS.
- **Nye funksjoner får PUBLIC-execute som standard.** Migrasjonen tar det bort og gir bare til `authenticated`. Husk det når du legger til nye funksjoner.

## Neste steg

Se byggeplanen. Kort: steg 2 er ukevisningen med intervallknappene, steg 3 ledervisningen, steg 4 delingsbildet (Edge Function + Satori), steg 5 innstillinger og lagstyring, steg 6 drift.

Når du legger til tabeller eller funksjoner: legg til tester i `security.sql` i samme commit.
