import { supabase } from "./supabase";
import type { ActivityColor } from "./types";

// Everything the public week page needs, from share_week() — no login required.

export interface SharePerson {
  name: string;
  avatar: string | null;
}
export interface ShareEvent {
  title: string;
  opponent: string | null;
  color: ActivityColor;
  start_hour: number;
  end_hour: number;
  people: SharePerson[];
}
export interface ShareDay {
  date: string;
  events: ShareEvent[];
  free: { start_hour: number; end_hour: number }[];
}
export interface ShareWeek {
  team: { name: string; timezone: string };
  week_start: string;
  members: number;
  days: ShareDay[];
}

export async function fetchSharedWeek(
  slug: string,
  mondayKey: string,
): Promise<ShareWeek | null> {
  const { data, error } = await supabase.rpc("share_week", {
    slug,
    week_start: mondayKey,
  });
  if (error) throw error;
  return (data as ShareWeek | null) ?? null;
}

/**
 * The link to paste on Discord. It goes to the app's own domain (/w/<code>), which Vercel
 * rewrites to the Supabase function behind the scenes, so the project URL is never shown
 * and the links survive a change of backend.
 */
export function shareLink(slug: string, weekId: string): string {
  const base = ((import.meta.env.VITE_SHARE_BASE as string | undefined) ?? window.location.origin).replace(/\/$/, "");
  return `${base}/w/${slug}?week=${weekId}`;
}

export async function setShareEnabled(teamId: string, enabled: boolean) {
  const { error } = await supabase
    .from("teams")
    .update({ share_enabled: enabled })
    .eq("id", teamId);
  if (error) throw error;
}

/** Owner only. Old links stop working. */
export async function rotateShareSlug(teamId: string): Promise<string> {
  const { data, error } = await supabase.rpc("rotate_share_slug", {
    team: teamId,
  });
  if (error) throw error;
  return data as string;
}
