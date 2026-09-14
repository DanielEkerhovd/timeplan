#!/usr/bin/env node
// Registers the bot's slash commands with Discord. Run once after deploy, and
// again whenever a command changes. Reads DISCORD_APP_ID and DISCORD_BOT_TOKEN
// from the environment (or .env.local).
//
//   node scripts/discord-commands.mjs              # global: every server, takes up to an hour to show
//   node scripts/discord-commands.mjs --guild <id> # one server, shows at once (handy while developing)

import { readFileSync } from 'node:fs'

for (const file of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    /* no such file */
  }
}

const appId = process.env.DISCORD_APP_ID
const token = process.env.DISCORD_BOT_TOKEN
if (!appId || !token) {
  console.error('DISCORD_APP_ID and DISCORD_BOT_TOKEN must be set')
  process.exit(1)
}

const guildIdx = process.argv.indexOf('--guild')
const guild = guildIdx > -1 ? process.argv[guildIdx + 1] : null

const commands = [
  {
    name: 'week',
    description: 'Show the team’s week plan',
    // 0 = guild only. In a DM there is no channel to work out the team from.
    contexts: [0],
    options: [
      {
        type: 3,
        name: 'which',
        description: 'This week or next',
        required: false,
        choices: [
          { name: 'This week', value: 'this' },
          { name: 'Next week', value: 'next' },
        ],
      },
    ],
  },
]

const path = guild ? `/applications/${appId}/guilds/${guild}/commands` : `/applications/${appId}/commands`
const res = await fetch(`https://discord.com/api/v10${path}`, {
  method: 'PUT',
  headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(commands),
})
const body = await res.json()
if (!res.ok) {
  console.error(res.status, JSON.stringify(body, null, 2))
  process.exit(1)
}
console.log(`Registered ${body.length} command(s)${guild ? ` in guild ${guild}` : ' globally'}: ${body.map((c) => '/' + c.name).join(', ')}`)
