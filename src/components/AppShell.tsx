import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useTheme, type ThemePref } from "../lib/theme";
import type { MyTeam } from "../lib/teams";
import { discordNameFrom } from "../lib/discordName";
import { setTimezone } from "../lib/settings";
import { allZones, localZone, viewerZone } from "../lib/timezone";
import { canEdit, friendlyError, roleLabel, type Profile } from "../lib/types";
import ProfileModal from "./ProfileModal";
import { useCopyWeekLink } from "./ShareWeekButton";
import { Dropdown } from "./pickers";
import { Avatar, useToast } from "./ui";

const icons = {
  week: (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  ),
  players: (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M15.5 14.5A5 5 0 0 1 21 19" />
    </svg>
  ),
  settings: (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Tannhjul, ikke sol: dette er innstillinger, ikke lysstyrke.
          Tennene går helt ut i kanten av ruta, mens de andre ikonene stopper
          et stykke inn. Uten nedskaleringen ser dette ett hakk større ut. */}
      <g
        transform="translate(12 12) scale(0.85) translate(-12 -12)"
        strokeWidth="2.1"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6h.08A1.7 1.7 0 0 0 10 3.05V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.08a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
      </g>
    </svg>
  ),
};

interface Props {
  team: MyTeam;
  teams: MyTeam[];
  /** Big title on mobile (desktop pages set their own). */
  mobileTitle: string;
  /** Your profile row, for the name shown and the profile dialog. */
  profile?: Profile | null;
  /** Called after the profile changed, so lists refresh. */
  onProfileChanged?: () => Promise<void>;
  children: ReactNode;
}

/**
 * Full-screen app frame. Desktop: sidebar with Week / Players / Settings, content never scrolls the page
 * (long lists scroll inside their own container). Mobile: header on top, tab bar at the bottom.
 */
export default function AppShell({
  team,
  teams,
  mobileTitle,
  profile,
  onProfileChanged,
  children,
}: Props) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const teamsRef = useRef<HTMLDivElement>(null);
  const mobileTeamsRef = useRef<HTMLDivElement>(null);

  // Close the user menu when clicking anywhere else.
  useEffect(() => {
    if (!menuOpen && !teamsOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !mobileMenuRef.current?.contains(t))
        setMenuOpen(false);
      if (
        !teamsRef.current?.contains(t) &&
        !mobileTeamsRef.current?.contains(t)
      )
        setTeamsOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen, teamsOpen]);
  const { user, signOut } = useAuth();
  const { pref, setPref } = useTheme();
  const navigate = useNavigate();
  const copyShareLink = useCopyWeekLink(team);
  const editor = canEdit(team.role);
  // Profilraden kommer et øyeblikk etter økten. Til den er her bruker vi samme
  // navneregel som basen, ellers blinker kontonavnet forbi før det blir byttet ut.
  const name =
    profile?.display_name ?? discordNameFrom(user?.user_metadata) ?? "You";
  const avatar = user?.user_metadata?.avatar_url as string | undefined;

  const nav = [
    { to: `/team/${team.id}`, end: true, label: "Week", icon: icons.week },
    {
      to: `/team/${team.id}/players`,
      end: false,
      label: "Players",
      icon: icons.players,
    },
    ...(editor
      ? [
          {
            to: `/team/${team.id}/settings`,
            end: false,
            label: "Settings",
            icon: icons.settings,
          },
        ]
      : []),
  ];

  // Ultrawide: the frame stops growing past 3000px and sits in the middle, so the week
  // grid keeps sane column widths instead of stretching across the screen.
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[2440px] lg:h-dvh lg:overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden w-[232px] shrink-0 flex-col justify-between border-r border-line-soft px-5 py-7 lg:flex">
        <div className="flex flex-col gap-7">
          {/* Team switcher: the block is a button when you are on more than one team.
              Egen bakgrunn, så laget du står i er en ting for seg og ikke bare en linje
              til over menyen. Kalenderen er borte — den var samme ikon som Week. */}
          <div ref={teamsRef} className="relative">
            <button
              onClick={() => teams.length > 1 && setTeamsOpen((o) => !o)}
              disabled={teams.length <= 1}
              aria-haspopup={teams.length > 1 ? "menu" : undefined}
              aria-expanded={teamsOpen}
              className={`flex w-full items-center gap-2.5 rounded-[14px] bg-surface px-2 py-2 text-left shadow-card ring-1 ring-line-soft transition ${teams.length > 1 ? "hover:ring-line" : ""}`}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-green-soft text-green-ink">
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {/* Tre folk, den i midten nærmest. */}
                  <circle cx="5" cy="8.5" r="2" />
                  <path d="M2 16a3.4 3.4 0 0 1 3.2-3.4" />
                  <circle cx="19" cy="8.5" r="2" />
                  <path d="M22 16a3.4 3.4 0 0 0-3.2-3.4" />
                  <circle cx="12" cy="9.5" r="3.4" />
                  <path d="M6.4 20.5a5.6 5.6 0 0 1 11.2 0" />
                </svg>
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="truncate text-sm font-extrabold tracking-tight">
                  {team.name}
                </div>
                <div className="text-[11px] text-muted">
                  {teams.length > 1 ? `${teams.length} teams` : "Your team"}
                </div>
              </div>
              {teams.length > 1 && (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0 text-faint"
                >
                  <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />
                </svg>
              )}
            </button>
            {teamsOpen && (
              <div className="absolute left-0 top-full z-40 mt-2 flex w-[210px] flex-col rounded-2xl bg-surface p-1.5 shadow-pop ring-1 ring-line">
                {teams.map((t) => (
                  <MenuItem
                    key={t.id}
                    onClick={() => {
                      setTeamsOpen(false);
                      if (t.id !== team.id) navigate(`/team/${t.id}`);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                    {t.id === team.id && (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="ml-2 shrink-0 text-green"
                      >
                        <path d="M5 12l5 5L20 7" />
                      </svg>
                    )}
                  </MenuItem>
                ))}
                <div className="my-1 border-t border-line" />
                <MenuItem
                  icon={iconJoinTeam}
                  onClick={() => {
                    setTeamsOpen(false);
                    navigate("/new-team");
                  }}
                >
                  Join or create a team
                </MenuItem>
              </div>
            )}
          </div>

          <nav className="flex flex-col gap-1">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `flex h-10 items-center gap-2.5 rounded-[10px] px-3 text-sm ${
                    isActive
                      ? "bg-surface font-bold shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                      : "font-semibold text-muted hover:text-ink"
                  }`
                }
              >
                {n.icon}
                <span>{n.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="flex flex-col gap-3">
          {/* Sharing lives in the week bar; the sidebar keeps just you. */}
          {/* You: name + role. Pencil on hover opens the profile; the block itself opens a small menu. */}
          <div ref={menuRef} className="relative">
            {menuOpen && (
              <div className="absolute bottom-full left-0 mb-2 flex w-[210px] flex-col rounded-2xl bg-surface p-1.5 shadow-pop ring-1 ring-line">
                <ProfilePill
                  onClick={() => {
                    setMenuOpen(false);
                    setProfileOpen(true);
                  }}
                />
                <Appearance pref={pref} setPref={setPref} />
                <TimeZone
                  userId={user?.id}
                  profile={profile}
                  onSaved={onProfileChanged}
                />
                <div className="my-1 border-t border-line" />
                <MenuItem
                  icon={iconJoinTeam}
                  onClick={() => {
                    setMenuOpen(false);
                    navigate("/new-team");
                  }}
                >
                  Join or create a team
                </MenuItem>
                <MenuItem icon={iconSignOut} onClick={() => void signOut()}>
                  Sign out
                </MenuItem>
              </div>
            )}
            <div className="flex items-center gap-2.5 rounded-[10px] px-1.5 py-1.5 hover:bg-surface">
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <Avatar name={name} url={avatar} size={30} />
                <div className="flex min-w-0 flex-col">
                  <div className="truncate text-[13px] font-bold">{name}</div>
                  <div className="text-[11px] text-muted">
                    {roleLabel[team.role]}
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Merket, nederst. Selve navnet er lavmælt, men merket er synlig —
              inne i appen vet du hvor du er, og slagordet hører hjemme der folk
              som ikke kjenner appen kommer inn: innloggingssida og delingslenka. */}
          <div className="flex items-center gap-1.5 border-t border-line-soft px-1 pt-3.5">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] bg-ink text-bg">
              <svg
                width="14"
                height="14"
                viewBox="0 0 64 64"
                fill="none"
                stroke="currentColor"
                strokeWidth="7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M44 22a15 15 0 1 0 3 10h-11" />
              </svg>
            </div>
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="text-[12px] font-extrabold tracking-tight">
                Gatherapp.gg
              </span>
              <span className="whitespace-nowrap text-[9.5px] leading-[1.3] tracking-tight text-muted">
                Planning tool for teams and groups
              </span>
            </div>
            <NavLink
              to={`/team/${team.id}/about`}
              aria-label="About Gatherapp.gg"
              className={({ isActive }) =>
                `ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition ${
                  isActive
                    ? "bg-surface-2 text-ink"
                    : "text-faint hover:bg-surface-2 hover:text-ink"
                }`
              }
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 11v5" />
                <path d="M12 8h.01" />
              </svg>
            </NavLink>
          </div>
        </div>
      </aside>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col lg:min-h-0">
        <header className="relative flex items-center justify-between px-5 pb-3 pt-10 lg:hidden">
          <div className="flex min-w-0 flex-col gap-0.5">
            <button
              onClick={() => teams.length > 1 && setTeamsOpen((o) => !o)}
              disabled={teams.length <= 1}
              className="flex items-center gap-1 truncate text-left text-xs font-bold uppercase tracking-[0.08em] text-muted"
            >
              {team.name}
              {teams.length > 1 && (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              )}
            </button>
            <h1 className="truncate text-[26px] font-extrabold tracking-tight">
              {mobileTitle}
            </h1>
          </div>
          {teamsOpen && (
            <div
              ref={mobileTeamsRef}
              className="absolute left-5 top-[88px] z-40 flex w-[220px] flex-col rounded-2xl bg-surface p-1.5 shadow-pop ring-1 ring-line lg:hidden"
            >
              {teams.map((t) => (
                <MenuItem
                  key={t.id}
                  onClick={() => {
                    setTeamsOpen(false);
                    if (t.id !== team.id) navigate(`/team/${t.id}`);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  {t.id === team.id && (
                    <span className="ml-2 text-green">✓</span>
                  )}
                </MenuItem>
              ))}
              <div className="my-1 border-t border-line" />
              <MenuItem
                icon={iconJoinTeam}
                onClick={() => {
                  setTeamsOpen(false);
                  navigate("/new-team");
                }}
              >
                Join or create a team
              </MenuItem>
            </div>
          )}
          <button
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="You"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <Avatar name={name} url={avatar} size={40} />
          </button>
          {menuOpen && (
            <div
              ref={mobileMenuRef}
              className="absolute right-5 top-[88px] z-40 flex w-[220px] flex-col rounded-2xl bg-surface p-1.5 shadow-pop ring-1 ring-line lg:hidden"
            >
              {editor && (
                <MenuItem
                  onClick={() => {
                    setMenuOpen(false);
                    void copyShareLink();
                  }}
                >
                  Share week on Discord
                </MenuItem>
              )}
              <ProfilePill
                onClick={() => {
                  setMenuOpen(false);
                  setProfileOpen(true);
                }}
              />
              <Appearance pref={pref} setPref={setPref} />
              <TimeZone
                userId={user?.id}
                profile={profile}
                onSaved={onProfileChanged}
              />
              <div className="my-1 border-t border-line" />
              {/* Sidemenyen med merket finnes ikke på mobil, så veien til About går her. */}
              <MenuItem
                icon={iconInfo}
                onClick={() => {
                  setMenuOpen(false);
                  navigate(`/team/${team.id}/about`);
                }}
              >
                About Gatherapp.gg
              </MenuItem>
              <MenuItem
                icon={iconJoinTeam}
                onClick={() => {
                  setMenuOpen(false);
                  navigate("/new-team");
                }}
              >
                Join or create a team
              </MenuItem>
              <MenuItem icon={iconSignOut} onClick={() => void signOut()}>
                Sign out
              </MenuItem>
            </div>
          )}
        </header>

        <main className="flex min-w-0 flex-1 flex-col px-5 pb-24 lg:min-h-0 lg:overflow-hidden lg:px-8 lg:pb-7 lg:pt-7">
          {children}
        </main>

        <nav
          className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line-soft bg-surface/95 backdrop-blur lg:hidden"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-bold ${isActive ? "text-ink" : "text-faint"}`
              }
            >
              {n.icon}
              {n.label}
            </NavLink>
          ))}
        </nav>
      </div>

      {profileOpen && user && (
        <ProfileModal
          profile={profile ?? null}
          avatarUrl={avatar}
          onClose={() => setProfileOpen(false)}
          onSaved={onProfileChanged ?? (async () => {})}
        />
      )}
    </div>
  );
}

function MenuItem({
  onClick,
  icon,
  children,
}: {
  onClick: () => void;
  /** Lite strekikon foran teksten. Laglinjene har ingen — de er navn, ikke handlinger. */
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="flex h-9 w-full items-center gap-2.5 whitespace-nowrap rounded-[10px] px-3 text-left text-[13px] font-semibold text-ink hover:bg-surface-2"
    >
      {icon && <span className="shrink-0 text-faint">{icon}</span>}
      {children}
    </button>
  );
}

const iconJoinTeam = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <path d="M12 8v8M8 12h8" />
  </svg>
);

const iconInfo = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <path d="M12 8h.01" />
  </svg>
);

const iconSignOut = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M10 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4" />
    <path d="M16 16l4-4-4-4M20 12H10" />
  </svg>
);

/**
 * Navnet ditt, som en pille i samme drakt som tema-velgeren under. Den er en
 * knapp og ikke en menylinje fordi den står i samme blokk som innstillingene,
 * med egen overskrift på linje med Appearance og Time zone.
 */
function ProfilePill({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2">
      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-faint">
        Profile
      </span>
      <button
        type="button"
        onClick={onClick}
        className="h-8 w-full rounded-full bg-surface-2 text-[13px] font-bold text-ink transition hover:brightness-95"
      >
        Edit name
      </button>
    </div>
  );
}

/**
 * Sonen din, rett i menyen ved siden av Appearance. Lagrer med en gang du velger,
 * som temaet gjør — ingen Lagre-knapp for én verdi.
 *
 * Selve klokkeslettene i appen er alltid lagets. Denne sier bare hva de er hos deg.
 */
function TimeZone({
  userId,
  profile,
  onSaved,
}: {
  userId?: string;
  profile?: Profile | null;
  onSaved?: () => Promise<void>;
}) {
  const [zone, setZone] = useState(() => viewerZone(profile?.timezone));
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const device = localZone();
  const zones = useMemo(() => {
    const list = allZones();
    // Den lagrede sonen skal stå i lista selv om nettleseren ikke kjenner den.
    if (zone && !list.includes(zone)) list.unshift(zone);
    return list.map((z) => ({ value: z, label: z.replace(/_/g, " ") }));
  }, [zone]);

  async function pick(next: string) {
    const before = zone;
    setZone(next);
    if (!userId || next === before) return;
    setBusy(true);
    try {
      await setTimezone(userId, next);
      await onSaved?.();
      toast(`Times shown in ${next.replace(/_/g, " ")}`);
    } catch (err) {
      setZone(before);
      toast(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-faint">
          Time zone
        </span>
        {zone !== device && (
          <button
            type="button"
            onClick={() => void pick(device)}
            className="text-[11px] font-bold text-green-ink hover:underline"
          >
            Use this device
          </button>
        )}
      </div>
      <Dropdown
        value={zone}
        options={zones}
        onChange={(z) => void pick(z)}
        search
        disabled={busy || !userId}
        className="w-full"
        menuWidth={280}
        aria-label="Your time zone"
      />
    </div>
  );
}

/** Light / Dark / System, inside the user menu. */
function Appearance({
  pref,
  setPref,
}: {
  pref: ThemePref;
  setPref: (p: ThemePref) => void;
}) {
  const options: { value: ThemePref; label: string }[] = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "system", label: "Auto" },
  ];
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2">
      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-faint">
        Appearance
      </span>
      <div
        className="flex gap-0.5 rounded-full bg-surface-2 p-0.5"
        role="radiogroup"
        aria-label="Appearance"
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={pref === o.value}
            onClick={() => setPref(o.value)}
            className={`h-7 flex-1 rounded-full text-xs font-bold transition ${pref === o.value ? "bg-ink text-on-ink" : "text-muted hover:text-ink"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
