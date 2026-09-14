import { supabase } from "./supabase";

// The Discord bot, from the app's side.
//
// Settings the owner changes (channels, ping, times) are written straight to the
// tables under RLS, like every other setting. Anything that has to talk to
// Discord itself (connect, list channels, status, test message, post now,
// managed role, disconnect) goes through /api/discord/* with the session token,
// and the server checks ownership again before it touches the bot token.

export type ChannelKind = "schedule" | "updates" | "reminders";

export interface DiscordLink {
  team_id: string;
  guild_id: string;
  guild_name: string | null;
  ping_mode: "members" | "role";
  ping_role_id: string | null;
  managed_role: boolean;
  created_at: string;
}
export interface DiscordChannel {
  team_id: string;
  kind: ChannelKind;
  channel_id: string;
}
export interface DiscordSchedule {
  team_id: string;
  post_enabled: boolean;
  post_dow: number;
  post_at: string;
  nudge_enabled: boolean;
  nudge_dow: number;
  nudge_at: string;
  updates_enabled: boolean;
  updates_mode: "channel" | "dm" | "both";
  same_day_enabled: boolean;
  same_day_hours: number;
  same_day_mode: "channel" | "dm" | "both";
}
export interface DiscordLogRow {
  id: number;
  kind: "week_post" | "update" | "reminder" | "nudge" | "test" | "link";
  summary: string;
  ok: boolean;
  detail: string | null;
  at: string;
}
export interface DiscordState {
  link: DiscordLink | null;
  channels: DiscordChannel[];
  schedule: DiscordSchedule | null;
  log: DiscordLogRow[];
}

export interface PickerChannel {
  id: string;
  name: string;
  canPost: boolean;
  canPin: boolean;
  taken: boolean;
  mine: ChannelKind | null;
}
export interface StatusCheck {
  ok: boolean;
  label: string;
  fix?: string;
}
export interface PickerRole {
  id: string;
  name: string;
  color: number;
}

export async function fetchDiscordState(teamId: string): Promise<DiscordState> {
  const [link, channels, schedule, log] = await Promise.all([
    supabase.from("discord_links").select("*").eq("team_id", teamId).maybeSingle(),
    supabase.from("discord_channels").select("*").eq("team_id", teamId),
    supabase.from("discord_schedules").select("*").eq("team_id", teamId).maybeSingle(),
    supabase.from("discord_log").select("*").eq("team_id", teamId).order("at", { ascending: false }).limit(10),
  ]);
  for (const r of [link, channels, schedule, log]) if (r.error) throw r.error;
  return {
    link: (link.data as DiscordLink | null) ?? null,
    channels: (channels.data ?? []) as DiscordChannel[],
    schedule: (schedule.data as DiscordSchedule | null) ?? null,
    log: (log.data ?? []) as DiscordLogRow[],
  };
}

// --- Straight to the tables (RLS: owner) ---------------------------------------

export async function setChannel(teamId: string, kind: ChannelKind, channelId: string | null) {
  if (channelId) {
    const { error } = await supabase.from("discord_channels").upsert({ team_id: teamId, kind, channel_id: channelId }, { onConflict: "team_id,kind" });
    if (error) throw error;
  } else {
    const { error } = await supabase.from("discord_channels").delete().eq("team_id", teamId).eq("kind", kind);
    if (error) throw error;
  }
}

export async function setPing(teamId: string, mode: "members" | "role", roleId: string | null) {
  const { error } = await supabase
    .from("discord_links")
    .update({ ping_mode: mode, ping_role_id: mode === "role" ? roleId : null })
    .eq("team_id", teamId);
  if (error) throw error;
}

export async function updateSchedule(teamId: string, patch: Partial<Omit<DiscordSchedule, "team_id">>) {
  const { error } = await supabase.from("discord_schedules").update(patch).eq("team_id", teamId);
  if (error) throw error;
}

// --- Through the server (it holds the bot token) --------------------------------

/** An answer from /api/discord/* that was not ok. The message is already written for people. */
export class DiscordApiError extends Error {}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new DiscordApiError("You are signed out.");
  const res = await fetch(path, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new DiscordApiError(body.error ?? `Request failed (${res.status})`);
  return body;
}

/** Sends the owner to Discord to pick a server. Comes back to Settings → Discord. */
export async function startConnect(teamId: string) {
  const { url } = await api<{ url: string }>(`/api/discord/install?team=${teamId}`);
  window.location.assign(url);
}

export function fetchChannels(teamId: string) {
  return api<{ guild: { id: string; name: string | null }; channels: PickerChannel[] }>(`/api/discord/channels?team=${teamId}`);
}

/** Makes a text channel on the server. Needs Manage Channels on the bot. */
export function createChannel(teamId: string, name: string) {
  return api<{ id: string; name: string }>(`/api/discord/channels?team=${teamId}`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function fetchStatus(teamId: string) {
  return api<{ checks: StatusCheck[] }>(`/api/discord/status?team=${teamId}`);
}

export function fetchRoles(teamId: string) {
  return api<{ roles: PickerRole[] }>(`/api/discord/roles?team=${teamId}`);
}

export function createManagedRole(teamId: string, name: string) {
  return api<{ role: { id: string; name: string }; given: number; missing: number }>(`/api/discord/roles?team=${teamId}`, {
    method: "POST",
    body: JSON.stringify({ action: "create", name }),
  });
}

export function renameManagedRole(teamId: string, name: string) {
  return api<{ role: { id: string; name: string } }>(`/api/discord/roles?team=${teamId}`, {
    method: "POST",
    body: JSON.stringify({ action: "rename", name }),
  });
}

export function syncManagedRole(teamId: string) {
  return api<{ given: number; missing: number }>(`/api/discord/roles?team=${teamId}`, {
    method: "POST",
    body: JSON.stringify({ action: "sync" }),
  });
}

export function sendTestMessage(teamId: string) {
  return api<{ sent: number; failed: { kind: string; reason: string }[] }>("/api/discord/post", {
    method: "POST",
    body: JSON.stringify({ team: teamId, action: "test" }),
  });
}

export function sendTestDm(teamId: string) {
  return api<{ ok: true }>("/api/discord/post", {
    method: "POST",
    body: JSON.stringify({ team: teamId, action: "test_dm" }),
  });
}

export function postWeekNow(teamId: string, which: "this" | "next") {
  return api<{ action: "posted" | "edited" | "unchanged" | "skipped"; detail?: string }>("/api/discord/post", {
    method: "POST",
    body: JSON.stringify({ team: teamId, action: "post", which }),
  });
}

export function disconnectDiscord(teamId: string) {
  return api<{ ok: true; left: boolean; remaining: number }>("/api/discord/post", {
    method: "POST",
    body: JSON.stringify({ team: teamId, action: "disconnect" }),
  });
}

/** The channel a message type actually lands in, after inheritance. */
export function effectiveChannel(channels: DiscordChannel[], kind: ChannelKind): { id: string; inherited: boolean } | null {
  const own = channels.find((c) => c.kind === kind);
  if (own) return { id: own.channel_id, inherited: false };
  if (kind === "reminders") {
    const up = effectiveChannel(channels, "updates");
    return up ? { ...up, inherited: true } : null;
  }
  if (kind === "updates") {
    const s = channels.find((c) => c.kind === "schedule");
    return s ? { id: s.channel_id, inherited: true } : null;
  }
  return null;
}

export const DOW_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** "20:00:00" from Postgres → "20:00" for the picker, and back. */
export const shortTime = (t: string) => t.slice(0, 5);
