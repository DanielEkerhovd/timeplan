import type { ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import type { MyTeam } from '../lib/teams'
import { canEdit, roleLabel } from '../lib/types'
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
  children: ReactNode
}

/**
 * Full-screen app frame. Desktop: sidebar with Week / Players / Settings, content never scrolls the page
 * (long lists scroll inside their own container). Mobile: header on top, tab bar at the bottom.
 */
export default function AppShell({ team, teams, mobileTitle, children }: Props) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const editor = canEdit(team.role)
  const name = (user?.user_metadata?.full_name as string | undefined) ?? (user?.user_metadata?.name as string | undefined) ?? 'You'
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
          <div className="flex items-center gap-2.5 px-1.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.05)] text-green">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="5" width="18" height="16" rx="4" />
                <path d="M3 10h18" />
                <path d="M8 3v4M16 3v4" />
              </svg>
            </div>
            <div className="flex min-w-0 flex-col">
              <div className="truncate text-sm font-extrabold tracking-tight">{team.name}</div>
              <div className="text-[11px] text-muted">Schedule</div>
            </div>
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

          {teams.length > 1 && (
            <div className="flex flex-col gap-1">
              <div className="px-3 text-[11px] font-bold uppercase tracking-[0.08em] text-faint">Teams</div>
              {teams
                .filter((t) => t.id !== team.id)
                .map((t) => (
                  <button
                    key={t.id}
                    onClick={() => navigate(`/team/${t.id}`)}
                    className="flex h-9 items-center truncate rounded-[10px] px-3 text-left text-[13px] font-semibold text-muted hover:text-ink"
                  >
                    {t.name}
                  </button>
                ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5 px-1.5">
            <Avatar name={name} url={avatar} size={30} />
            <div className="flex min-w-0 flex-col">
              <div className="truncate text-[13px] font-bold">{name}</div>
              <div className="text-[11px] text-muted">{roleLabel[team.role]}</div>
            </div>
          </div>
          <div className="flex gap-3 px-1.5 text-xs font-semibold text-muted">
            <button onClick={() => navigate('/new-team')} className="hover:text-ink">
              New team
            </button>
            <button onClick={() => signOut()} className="hover:text-ink">
              Sign out
            </button>
          </div>
        </div>
      </aside>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col lg:min-h-0">
        <header className="flex items-center justify-between px-5 pb-3 pt-10 lg:hidden">
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="truncate text-xs font-bold uppercase tracking-[0.08em] text-muted">{team.name}</div>
            <h1 className="truncate text-[26px] font-extrabold tracking-tight">{mobileTitle}</h1>
          </div>
          <button onClick={() => navigate(`/team/${team.id}/players`)} aria-label="Players">
            <Avatar name={name} url={avatar} size={40} />
          </button>
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
    </div>
  )
}
