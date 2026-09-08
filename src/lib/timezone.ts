/**
 * Alle klokkeslett i appen er lagets tid. En spiller i en annen sone må få vite det,
 * ellers møter han opp en time feil. Vi regner ut forskjellen for den uka som vises,
 * ikke for i dag, siden sommertid kan skifte mellom dem.
 */

/** Hvor mange minutter sonen ligger foran UTC på et gitt tidspunkt. */
export function zoneOffsetMinutes(timeZone: string, at: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(at);
    const get = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value);
    const asUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour") % 24,
      get("minute"),
      get("second"),
    );
    return Math.round((asUtc - at.getTime()) / 60000);
  } catch {
    // Ukjent sonenavn: da sier vi heller ingenting enn noe feil.
    return null;
  }
}

/** Sonen nettleseren står i. */
export function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "";
  }
}

/**
 * Hvor mange timer lagets tid ligger foran din egen. Positivt tall betyr at laget
 * er foran deg: 20:00 hos laget er 19:00 hos deg når svaret er 1.
 * null når sonene er like, ukjente, eller forskjellen ikke er hele timer.
 */
export function hoursAhead(
  teamZone: string,
  at: Date,
  local = localZone(),
): number | null {
  if (!teamZone || !local || teamZone === local) return null;
  const team = zoneOffsetMinutes(teamZone, at);
  const mine = zoneOffsetMinutes(local, at);
  if (team === null || mine === null) return null;
  const diff = (team - mine) / 60;
  return diff === 0 ? null : diff;
}

/** Klokkeslettet hos deg når laget sier `hour`. Halve timer finnes (India er +5:30). */
export function yourTime(hour: number, diff: number): string {
  const minutes = (((hour - diff) * 60) % 1440 + 1440) % 1440;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Sonen vi skal måle mot: den du har valgt, ellers den maskinen står i. */
export function viewerZone(chosen: string | null | undefined): string {
  return chosen || localZone();
}

/** Alle sonenavn nettleseren kjenner. Eldre nettlesere gir oss ingenting, og da holder vi oss til den ene vi vet om. */
export function allZones(): string[] {
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf;
  try {
    const list = supported?.("timeZone") ?? [];
    return list.length > 0 ? list : [localZone()].filter(Boolean);
  } catch {
    return [localZone()].filter(Boolean);
  }
}

/**
 * Én setning å vise over uka. null når spilleren er i samme sone som laget,
 * og da skal det ikke stå noe i det hele tatt.
 */
export function zoneNote(
  teamZone: string,
  at: Date,
  local = localZone(),
): string | null {
  const diff = hoursAhead(teamZone, at, local);
  if (diff === null) return null;
  const size = Math.abs(diff);
  const unit = size === 1 ? "hour" : "hours";
  const which = diff > 0 ? "ahead of" : "behind";
  return `Times are in ${teamZone}, ${size} ${unit} ${which} you — 20:00 here is ${yourTime(20, diff)} for you.`;
}
