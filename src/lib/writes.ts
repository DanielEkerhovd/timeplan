/**
 * Holder styr på om vi akkurat nå skriver til databasen selv.
 *
 * Realtime sender endringene våre tilbake til oss. Uten dette svarer appen på sitt eget
 * ekko: hvert trykk utløser en ny henting av uka, og henter du raskere enn du rekker å
 * trykke, kommer et gammelt svar inn og overskriver det du nettopp gjorde. Det er det
 * som kjennes som treghet.
 *
 * Så: mens vi skriver, og et lite øyeblikk etterpå, lar vi vår egen tilstand stå.
 * Endringer fra andre kommer inn med det samme det er ro.
 */

let inFlight = 0;
let settledAt = 0;

export function beginWrite() {
  inFlight += 1;
}

export function endWrite() {
  inFlight = Math.max(0, inFlight - 1);
  settledAt = Date.now();
}

/** Skriver vi nå, eller så nylig at et svar underveis kan være utdatert? */
export function writingNow(quietMs = 700): boolean {
  return inFlight > 0 || Date.now() - settledAt < quietMs;
}

/** Kjører en skriving og teller den med. */
export async function tracked<T>(fn: () => Promise<T>): Promise<T> {
  beginWrite();
  try {
    return await fn();
  } finally {
    endWrite();
  }
}
