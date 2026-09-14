// Step 1 of the setup: "Connect to Discord".
//
// The app asks here with the owner's Supabase session; we answer with the
// Discord authorize URL to send them to. The `state` in that URL is signed and
// carries team + user + expiry, so the callback can trust who started this
// without a cookie.

export const config = { runtime: 'edge' }

import { signState } from '../_lib/crypto'
import { INSTALL_PERMISSIONS } from '../_lib/discord'
import { env, guard, json } from '../_lib/env'
import { requireOwner } from '../_lib/supabase'

export default function handler(req: Request): Promise<Response> {
  return guard(async () => {
    const teamId = new URL(req.url).searchParams.get('team') ?? ''
    const user = await requireOwner(req, teamId)

    const state = await signState(env.stateSecret(), { team: teamId, user: user.id }, 15 * 60)
    const url = new URL('https://discord.com/oauth2/authorize')
    url.searchParams.set('client_id', env.appId())
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('redirect_uri', `${env.appUrl()}/api/discord/callback`)
    // identify + guilds: to read the permissions the person holds in the server they pick.
    // bot + applications.commands: to add the bot and register /week there.
    url.searchParams.set('scope', 'identify guilds bot applications.commands')
    url.searchParams.set('permissions', INSTALL_PERMISSIONS.toString())
    url.searchParams.set('state', state)
    url.searchParams.set('prompt', 'consent')
    return json({ url: url.toString() })
  })
}
