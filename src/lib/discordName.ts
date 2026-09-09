/**
 * Navnet Discord kjenner deg som, lest ut av metadataen i økten.
 *
 * Samme rekkefølge som `discord_name_from()` i basen (0015): visningsnavnet du har
 * satt selv først, kontonavnet til slutt. Grunnen til at den finnes to steder er
 * at appen tegner navnet ditt før profilraden er hentet — tar vi feil der, ser du
 * kontonavnet blinke forbi og bli byttet ut et halvt sekund senere.
 */
export function discordNameFrom(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object') return null
  const m = meta as Record<string, unknown>
  const claims = m.custom_claims
  const nested =
    claims && typeof claims === 'object'
      ? (claims as Record<string, unknown>).global_name
      : undefined
  for (const value of [nested, m.global_name, m.full_name, m.name, m.preferred_username]) {
    if (typeof value === 'string' && value.trim() !== '') return value.slice(0, 40)
  }
  return null
}
