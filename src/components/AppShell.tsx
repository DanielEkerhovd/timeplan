import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import type { MyTeam } from '../lib/teams'
import { canEdit, roleLabel, type Profile } from '../lib/types'
import ProfileModal from './ProfileModal'
import { Avatar } from './ui'

const icons = {
  week: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  ),
  players: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M15.5 14.5A5 5 0 0 1 21 19" />
    </svg>
  ),
  settings: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
    </svg>
  ),
}

interface Props {
  team: MyTeam
  teams: MyTeam[]
  /** Big title on mobile (desktop pages set their own). */
  mobileTitle: string
  /** Your profile row, for the name shown and the profile dialog. */
  profile?: Profile | null
  /** Called after the profile changed, so lists refresh. */
  onProfileChanged?: () => Promise<void>
  children: ReactNode
}

/**
 * Full-screen app frame. Desktop: sidebar with Week / Players / Settings, content never scrolls the page
 * (long lists scroll inside their own container). Mobile: header on top, tab bar at the bottom.
 */
export default function AppShell({ team, teams, mobileTitle, profile, onProfileChanged, children }: Props) {
  const [profileOpen, setProfileOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [teamsOpen, setTeamsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const mobileMenuRef = useRef<HTMLDivElement>(null)
  const teamsRef = useRef<HTMLDivElement>(null)
  const mobileTeamsRef = useRef<HTMLDivElement>(null)

  // Close the user menu when clicking anywhere else.
  useEffect(() => {
    if (!menuOpen && !teamsOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!menuRef.current?.contains(t) && !mobileMenuRef.current?.contains(t)) setMenuOpen(false)
      if (!teamsRef.current?.contains(t) && !mobileTeamsRef.current?.contains(t)) setTeamsOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [menuOpen, teamsOpen])
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const editor = canEdit(team.role)
  const name = profile?.display_name ?? (user?.user_metadata?.full_name as string | undefined) ?? (user?.user_metadata?.name as string | undefined) ?? 'You'
  const avatar = user?.user_metadata?.avatar_url as string | undefined

  const nav = [
    { to: `/team/${team.id}`, end: true, label: 'Week', icon: icons.week },
    { to: `/team/${team.id}/players`, end: false, label: 'Players', icon: icons.players },
    ...(editor ? [{ to: `/team/${team.id}/settings`, end: false, label: 'Settings', icon: icons.settings }] : []),
  ]

  return (
    <div className="flex min-h-dvh lg:h-dvh lg:overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden w-[232px] shrink-0 flex-col justify-between border-r border-[#eceae5] px-5 py-7 lg:flex">
        <div className="flex flex-col gap-7">
          {/* Team switcher: the block is a button when you are on more than one team. */}
          <div ref={teamsRef} className="relative">
            <button
              onClick={() => teams.length > 1 && setTeamsOpen((o) => !o)}
              disabled={teams.length <= 1}
              aria-haspopup={teams.length > 1 ? 'menu' : undefined}
              aria-expanded={teamsOpen}
              className={`flex w-full items-center gap-2.5 rounded-[10px] px-1.5 py-1.5 text-left ${teams.length > 1 ? 'hover:bg-surface' : ''}`}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.05)] text-green">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="5" width="18" height="16" rx="4" />
                  <path d="M3 10h18" />
                  <path d="M8 3v4M16 3v4" />
                </svg>
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="truncate text-sm font-extrabold tracking-tight">{team.name}</div>
                <div className="text-[11px] text-muted">{teams.length > 1 ? `${teams.length} teams` : 'Schedule'}</div>
              </div>
              {teams.length > 1 && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-faint">
                  <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />
                </svg>
              )}
            </button>
            {teamsOpen && (
              <div className="absolute left-0 top-full z-40 mt-2 flex w-[210px] flex-col rounded-2xl bg-surface p-1.5 shadow-[0_12px_32px_rgba(28,27,25,0.16)] ring-1 ring-black/5">
                {teams.map((t) => (
                  <MenuItem
                    key={t.id}
                    onClick={() => {
                      setTeamsOpen(false)
                      if (t.id !== team.id) navigate(`/team/${t.id}`)
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                    {t.id === team.id && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="ml-2 shrink-0 text-green">
                        <path d="M5 12l5 5L20 7" />
                      </svg>
                    )}
                  </MenuItem>
                ))}
                <div className="my-1 border-t border-line" />
                <MenuItem
                  onClick={() => {
                    setTeamsOpen(false)
                    navigate('/new-team')
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
                    isActive ? 'bg-surface font-bold shadow-[0_1px_2px_rgba(0,0,0,0.04)]' : 'font-semibold text-muted hover:text-ink'
                  }`
                }
              >
                {n.icon}
                <span>{n.label}</span>
              </NavLink>
            ))}
          </nav>

        </div>

        {/* You: name + role. Pencil on hover opens the profile; the block itself opens a small menu. */}
        <div ref={menuRef} className="relative">
          {menuOpen && (
            <div className="absolute bottom-full left-0 mb-2 flex w-[210px] flex-col rounded-2xl bg-surface p-1.5 shadow-[0_12px_32px_rgba(28,27,25,0.16)] ring-1 ring-black/5">
              <MenuItem
                onClick={() => {
                  setMenuOpen(false)
                  setProfileOpen(true)
                }}
              >
                Edit profile
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setMenuOpen(false)
                  navigate('/new-team')
                }}
              >
                Join or create a team
              </MenuItem>
              <div className="my-1 border-t border-line" />
              <MenuItem onClick={() => void signOut()}>Sign out</MenuItem>
            </div>
          )}
          <div className="flex items-center gap-2.5 rounded-[10px] px-1.5 py-1.5 hover:bg-surface">
            <button onClick={() => setMenuOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left" aria-haspopup="menu" aria-expanded={menuOpen}>
              <Avatar name={name} url={avatar} size={30} />
              <div className="flex min-w-0 flex-col">
                <div className="truncate text-[13px] font-bold">{name}</div>
                <div className="text-[11px] text-muted">{roleLabel[team.role]}</div>
              </div>
            </button>
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
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              )}
            </button>
            <h1 className="truncate text-[26px] font-extrabold tracking-tight">{mobileTitle}</h1>
          </div>
          {teamsOpen && (
            <div ref={mobileTeamsRef} className="absolute left-5 top-[88px] z-40 flex w-[220px] flex-col rounded-2xl bg-surface p-1.5 shadow-[0_12px_32px_rgba(28,27,25,0.16)] ring-1 ring-black/5 lg:hidden">
              {teams.map((t) => (
                <MenuItem
                  key={t.id}
                  onClick={() => {
                    setTeamsOpen(false)
                    if (t.id !== team.id) navigate(`/team/${t.id}`)
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  {t.id === team.id && <span className="ml-2 text-green">✓</span>}
                </MenuItem>
              ))}
              <div className="my-1 border-t border-line" />
              <MenuItem
                onClick={() => {
                  setTeamsOpen(false)
                  navigate('/new-team')
                }}
              >
                Join or create a team
              </MenuItem>
            </div>
          )}
          <button onClick={() => setMenuOpen((o) => !o)} aria-label="You" aria-haspopup="menu" aria-expanded={menuOpen}>
            <Avatar name={name} url={avatar} size={40} />
          </button>
          {menuOpen && (
            <div ref={mobileMenuRef} className="absolute right-5 top-[88px] z-40 flex w-[220px] flex-col rounded-2xl bg-surface p-1.5 shadow-[0_12px_32px_rgba(28,27,25,0.16)] ring-1 ring-black/5 lg:hidden">
              <MenuItem
                onClick={() => {
                  setMenuOpen(false)
                  setProfileOpen(true)
                }}
              >
                Edit profile
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setMenuOpen(false)
                  navigate('/new-team')
                }}
              >
                Join or create a team
              </MenuItem>
              <div className="my-1 border-t border-line" />
              <MenuItem onClick={() => void signOut()}>Sign out</MenuItem>
            </div>
          )}
        </header>

        <main className="flex min-w-0 flex-1 flex-col px-5 pb-24 lg:min-h-0 lg:overflow-hidden lg:px-8 lg:pb-7 lg:pt-7">{children}</main>

        <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-[#eceae5] bg-surface/95 backdrop-blur lg:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-bold ${isActive ? 'text-ink' : 'text-faint'}`
              }
            >
              {n.icon}
              {n.label}
            </NavLink>
          ))}
        </nav>
      </div>

      {profileOpen && (
        <ProfileModal profile={profile ?? null} avatarUrl={avatar} onClose={() => setProfileOpen(false)} onSaved={onProfileChanged ?? (async () => {})} />
      )}
    </div>
  )
}

function MenuItem({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button role="menuitem" onClick={onClick} className="flex h-9 w-full items-center whitespace-nowrap rounded-[10px] px-3 text-left text-[13px] font-semibold text-ink hover:bg-surface-2">
      {children}
    </button>
  )
}
