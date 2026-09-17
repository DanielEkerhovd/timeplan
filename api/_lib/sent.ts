// Kvitteringsboka, fra serverens side: skriv ned hver melding boten legger ut,
// og kunne ta dem ned igjen etterpå.
//
// Hele poenget er hvem meldingen hører til. Flere lag kan dele én server, og
// samme kanal: å skanne kanalen etter «meldinger fra boten» ville tatt naboens
// meldinger med. Vi sletter bare id-er vi selv har skrevet ned mot laget.

import { DiscordError, discord, explain } from './discord'
import { db, log } from './supabase'

export type SentKind = 'week_post' | 'update' | 'reminder' | 'nudge' | 'test'

export interface SentRow {
  id: number
  channel_id: string
  message_id: string
  kind: SentKind
  dm: boolean
}

/**
 * Skriv ned en melding som er lagt ut. Feiler dette, er meldingen likevel
 * sendt — den skal ikke telles som en feil overfor laget, den blir bare ikke
 * med i en senere opprydding.
 */
export async function record(teamId: string, channelId: string, messageId: string, kind: SentKind, dm = false): Promise<void> {
  try {
    await db.insert('discord_messages', { team_id: teamId, channel_id: channelId, message_id: messageId, kind, dm })
  } catch (err) {
    console.error('[discord_messages] record', err)
  }
}

/** Meldingen er borte (vi tok den ned selv, eller Discord har den ikke lenger). */
export async function forget(messageId: string): Promise<void> {
  try {
    await db.remove('discord_messages', { message_id: `eq.${messageId}` })
  } catch (err) {
    console.error('[discord_messages] forget', err)
  }
}

/** Legg ut og skriv ned i samme slengen. Gir tilbake meldings-id-en. */
export async function postAndRecord(teamId: string, channelId: string, body: unknown, kind: SentKind, dm = false): Promise<string> {
  const posted = await discord<{ id: string }>('POST', `/channels/${channelId}/messages`, body)
  await record(teamId, channelId, posted.id, kind, dm)
  return posted.id
}

/** Koder som betyr «den er borte uansett»: ingen vits i å prøve igjen. */
const GONE = [10003, 10004, 10008]

export interface WipeResult {
  deleted: number
  remaining: number
  /** Satt når vi måtte stoppe før alt var tatt: en grunn skrevet for folk. */
  stopped: string | null
}

/**
 * Ta ned inntil `limit` meldinger for ett lag, eldste først. Én om gangen:
 * Discord holder sletting av gamle meldinger på et kort bånd, og en bulk-
 * sletting gjelder uansett bare meldinger under to uker.
 *
 * Kallet er laget for å gjentas. Den som ber om det, kaller til `remaining`
 * er 0, så en lang historikk ikke må ryddes innenfor én funksjons levetid.
 */
export async function wipeMessages(teamId: string, limit = 25): Promise<WipeResult> {
  const rows = await db.select<SentRow>('discord_messages', {
    select: 'id,channel_id,message_id,kind,dm',
    team_id: `eq.${teamId}`,
    order: 'sent_at.asc',
    limit: String(limit),
  })
  let deleted = 0
  let stopped: string | null = null
  for (const row of rows) {
    try {
      // Ukeposten er festet. Løsner den ikke, går sletting fint likevel.
      if (row.kind === 'week_post') {
        await discord('DELETE', `/channels/${row.channel_id}/messages/pins/${row.message_id}`).catch(() => undefined)
      }
      await discord('DELETE', `/channels/${row.channel_id}/messages/${row.message_id}`)
      deleted++
    } catch (err) {
      if (err instanceof DiscordError && GONE.includes(err.code)) {
        // Noen har alt slettet den, eller kanalen er borte. Da er den ryddet.
      } else {
        // Mangler rettighet, eller Discord holder igjen: stopp, si fra, og la
        // raden ligge. Eieren fikser og prøver igjen — ingenting er tapt.
        stopped = explain(err)
        break
      }
    }
    await db.remove('discord_messages', { id: `eq.${row.id}`, team_id: `eq.${teamId}` })
    if (row.kind === 'week_post') await db.remove('discord_week_post', { team_id: `eq.${teamId}`, message_id: `eq.${row.message_id}` })
    // Et lite pust: sletting av meldinger eldre enn to uker har sitt eget,
    // strengere bånd hos Discord.
    await new Promise((r) => setTimeout(r, 250))
  }
  const left = await db.select<{ id: number }>('discord_messages', { select: 'id', team_id: `eq.${teamId}`, limit: '1000' })
  if (deleted > 0 || stopped) {
    await log(teamId, 'cleanup', `Removed ${deleted} message${deleted === 1 ? '' : 's'} from Discord`, stopped === null, stopped ?? undefined)
  }
  return { deleted, remaining: left.length, stopped }
}
