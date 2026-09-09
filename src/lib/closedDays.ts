import { supabase } from './supabase'
import { tracked } from './writes'

/**
 * Unntakene fra malen: én rad per dato laget har gjort noe annet enn vanlig.
 * `is_off` sier hvilken vei — en avlyst dag, eller en fast fridag de spiller likevel.
 *
 * Timene folk har krysset av blir liggende uansett. Ingenting her sletter data.
 * Bare eier og admin skriver; alle på laget leser.
 */
export async function fetchDayOverrides(teamId: string, fromKey: string, toKey: string): Promise<Map<string, boolean>> {
  const { data, error } = await supabase
    .from('closed_days')
    .select('date, is_off')
    .eq('team_id', teamId)
    .gte('date', fromKey)
    .lte('date', toKey)
  if (error) throw error
  const rows = (data ?? []) as { date: string; is_off: boolean }[]
  return new Map(rows.map((r) => [r.date, r.is_off]))
}

/**
 * Setter et unntak for én dato. Slett-så-sett i stedet for upsert: en upsert sender
 * alle kolonnene i UPDATE-en, og vi har bare skriverett på `is_off`.
 */
export async function setDayOverride(teamId: string, dateKey: string, userId: string, isOff: boolean) {
  await tracked(async () => {
    const gone = await supabase.from('closed_days').delete().eq('team_id', teamId).eq('date', dateKey)
    if (gone.error) throw gone.error
    const { error } = await supabase
      .from('closed_days')
      .insert({ team_id: teamId, date: dateKey, closed_by: userId, is_off: isOff })
    if (error) throw error
  })
}

/** Fjerner unntaket, så mønsteret på laget gjelder igjen. */
export async function clearDayOverride(teamId: string, dateKey: string) {
  await tracked(async () => {
    const { error } = await supabase
      .from('closed_days')
      .delete()
      .eq('team_id', teamId)
      .eq('date', dateKey)
    if (error) throw error
  })
}

/**
 * Er dagen fri? Unntaket for datoen vinner; ellers gjelder mønsteret på laget,
 * og bare framover — en uke som er ferdig endrer seg ikke fordi malen gjorde det.
 * Samme regel som i `slot_counts` og `share_week`.
 */
export function dayIsOff(
  dateKey: string,
  isoDay: number,
  overrides: ReadonlyMap<string, boolean>,
  offWeekdays: readonly number[],
  thisMondayKey: string,
): boolean {
  const override = overrides.get(dateKey)
  if (override !== undefined) return override
  return dateKey >= thisMondayKey && offWeekdays.includes(isoDay)
}

/** Vekedagene laget normalt har fri (ISO, 1 = mandag). */
export async function fetchOffWeekdays(teamId: string): Promise<number[]> {
  const { data, error } = await supabase
    .from('teams')
    .select('off_weekdays')
    .eq('id', teamId)
    .single()
  if (error) throw error
  return ((data as { off_weekdays: number[] } | null)?.off_weekdays ?? []).map(Number)
}

/** Eier setter mønsteret. Tom liste = laget spiller alle dager. */
export async function setOffWeekdays(teamId: string, weekdays: number[]) {
  const { error } = await supabase
    .from('teams')
    .update({ off_weekdays: [...weekdays].sort((a, b) => a - b) })
    .eq('id', teamId)
  if (error) throw error
}
