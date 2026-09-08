# Edge Functions (steg 4: deling på Discord)

Lenka du limer inn på Discord ser slik ut:

    https://<appen-din>/w/<slug>?week=2026-W37

Den ligger på appens eget domene. `vercel.json` i rota skriver `/w/*` om til funksjonene
her, så Supabase-adressa aldri vises, og lenkene overlever om backend byttes seinere.

- `share` svarer med en liten HTML-side med Open Graph-tagger, så Discord viser forhåndsvisning
  med bilde. Folk som klikker sendes videre til appen (`APP_URL/share/<slug>`).
- `share-image` tegner uka som PNG (1200×630) med Satori + resvg. Samme layout som mockupen.
- `_shared/week.ts` er felles kode. Begge henter data via `share_week()` i databasen, som bare
  svarer for lag med deling på, og aldri avslører hvem som er ledig når.

## Sett opp (én gang)

`supabase/config.toml` ligger allerede i repoet med det som trengs:

```toml
[functions.share]
verify_jwt = false

[functions.share-image]
verify_jwt = false
static_files = ["./functions/share-image/fonts/*.woff", "./functions/share-image/resvg.wasm"]
```

`static_files` er ikke valgfritt. Uten den finner ikke funksjonen fontene eller wasm-en på
Supabase, og bildet svarer 500. Feilmeldingen sier hvilken fil som mangler.

1. Fortell funksjonene hvor appen bor. Dette er ikke valgfritt: `og:image` bygges fra
   `APP_URL`, så uten den peker forhåndsvisninga på Discord tilbake til Supabase-domenet.

   ```bash
   supabase secrets set APP_URL=https://din-app.no
   ```

2. Deploy:

   ```bash
   supabase functions deploy share --no-verify-jwt
   supabase functions deploy share-image --no-verify-jwt
   ```

3. Sjekk at det virker, uten å trenge et lag eller en slug:

   ```bash
   curl -sI "https://<appen-din>/w/_selftest.png"
   ```

   `content-type: image/png` betyr at fonter og wasm er på plass, og at omskrivinga i Vercel virker. Får du 500, viser
   `curl -s` (uten `-I`) hvilken fil som ikke ble funnet. Selvtesten tegner et
   oppdiktet lag og rører ikke databasen.

Første kall etter en kald start bruker et par sekunder på å laste wasm-en. Etterpå er den varm.

## Lokalt

`supabase functions serve --no-verify-jwt --env-file supabase/.env.local` med
`APP_URL=http://localhost:5173` i env-fila. Åpne
`http://127.0.0.1:54321/functions/v1/share-image/_selftest.png`.

Bildet caches i 5 minutter, lenka i 1 minutt. Selvtesten caches ikke. Vil du ha nytt bilde
med en gang på Discord, legg til `&v=2` på lenka.
