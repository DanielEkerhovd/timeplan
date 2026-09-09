// Speiler tabellene i supabase/migrations/. Når skjemaet vokser:
// `supabase gen types typescript --local > src/lib/database.types.ts` og bytt til de genererte typene.

/**
 * Tilgang, ikke tittel. Hva folk kalles (Coach, Sub, Duelist) ligger i lagets
 * rolleliste, så det samme nivået fungerer for et LoL-lag og en brettspillgruppe.
 */
export type MemberRole = "owner" | "admin" | "member";

export const roleLabel: Record<MemberRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

/** Eier og admin kan redigere planen. */
export const canEdit = (role: MemberRole) =>
  role === "owner" || role === "admin";
export type DayType = "weekday" | "weekend";
export type ResponseStatus = "coming" | "not_coming";

export type ActivityColor =
  "yellow" | "green" | "coral" | "purple" | "blue" | "teal" | "pink" | "grey";
export const activityColors: ActivityColor[] = [
  "yellow",
  "green",
  "coral",
  "purple",
  "blue",
  "teal",
  "pink",
  "grey",
];

export interface Team {
  id: string;
  name: string;
  timezone: string;
  share_slug: string;
  share_enabled: boolean;
  /** ISO-vekedager (1 = mandag) laget normalt har fri. Del av malen. */
  off_weekdays: number[];
  created_at: string;
}

/** Et navn i lagets egen liste: Top, Duelist, Coach, Sub — hva laget nå bruker. */
export interface TeamRole {
  id: string;
  team_id: string;
  name: string;
  sort: number;
}

export interface Member {
  team_id: string;
  user_id: string;
  role: MemberRole;
  /** Peker inn i lagets rolleliste. Rent kosmetisk; tilgang kommer fra role. */
  role_id: string | null;
  joined_at: string;
}

export interface Profile {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  /** What Discord calls you; display_name follows it until you set your own. */
  discord_name: string | null;
  custom_name: boolean;
  /** Your own zone, used only to explain the team's times. Null until we know it. */
  timezone: string | null;
}

export interface MemberWithProfile extends Member {
  profile: Profile | null;
}

export interface TeamSlot {
  id: string;
  team_id: string;
  day_type: DayType;
  start_hour: number;
  end_hour: number;
  sort: number;
}

export interface Availability {
  team_id: string;
  user_id: string;
  date: string; // YYYY-MM-DD
  hour: number;
}

/** A team-editable activity type (Scrim, Match, VOD review …). The type is the title of the booking. */
export interface ActivityType {
  id: string;
  team_id: string;
  name: string;
  color: ActivityColor;
  ask_opponent: boolean;
  default_hours: number;
  sort: number;
  archived: boolean;
}

/**
 * A booked activity. Either it points at a type (type_id set, title/color null),
 * or it is a custom one with its own title and colour.
 */
export interface TeamEvent {
  id: string;
  team_id: string;
  date: string;
  start_hour: number;
  end_hour: number;
  type_id: string | null;
  title: string | null;
  color: ActivityColor | null;
  opponent: string | null;
  note: string | null;
  created_by: string | null;
  updated_at: string;
}

export interface Invite {
  id: string;
  team_id: string;
  code: string;
  created_by: string | null;
  expires_at: string;
  max_uses: number;
  used_count: number;
  created_at: string;
}

/** Feilkoder databasen kaster (raise exception '<kode>'). */
export const dbErrors = {
  not_authenticated: "You need to sign in first.",
  not_owner: "Only the owner can do this.",
  not_editor: "Only the owner and admins can do this.",
  cannot_remove_owner: "The owner cannot be removed. Transfer ownership first.",
  owner_cannot_leave:
    "Transfer ownership to someone else before leaving the team.",
  use_transfer_ownership: 'Use "Transfer ownership" to change the owner.',
  not_a_member: "That person is not on the team.",
  team_limit: "You cannot create more than 3 teams.",
  team_full: "The team is full (max 15).",
  too_many_invites: "The team already has 5 active invite codes.",
  invite_too_long: "An invite code can last at most 30 days.",
  too_many_attempts: "Too many failed attempts. Try again in an hour.",
  too_many_events: "Max 4 activities per day.",
  too_many_types: "Max 12 activity types. Archive one first.",
  type_not_in_team: "That activity type is not available any more.",
  date_out_of_range: "The date must be within one year.",
  date_in_the_past: "This week is done. You can look, but not change it.",
  date_too_far_ahead: "You can only plan about three months ahead.",
  name_mismatch: "The name does not match.",
  use_leave_team: 'Use "Leave team" to remove yourself.',
  unknown_timezone: "That is not a time zone we know.",
} as const;

/** Gjør en Supabase/Postgres-feil om til en setning folk forstår. */
export function friendlyError(err: unknown): string {
  const msg = (err as { message?: string })?.message ?? String(err);
  for (const [code, text] of Object.entries(dbErrors)) {
    if (msg.includes(code)) return text;
  }
  // team_slots har unique (team_id, day_type, start_hour, end_hour): to like bolker
  // er ikke en feil du har gjort, det er bare ingenting å legge til.
  if (msg.includes("team_slots_team_id_day_type_start_hour_end_hour_key"))
    return "That block is already there.";
  if (msg.includes("events_type_or_title"))
    return "Give the activity a title and a colour, or pick a type.";
  if (msg.includes("row-level security"))
    return "You do not have access to this.";
  if (msg.includes("permission denied"))
    return "You do not have access to this.";
  if (msg.includes("violates foreign key") && msg.includes("events"))
    return "That type is used by a booking. Archive it instead.";
  return "Something went wrong. Please try again.";
}
