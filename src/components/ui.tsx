import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import type { Profile } from '../lib/types'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[20px] bg-surface p-5 shadow-card ${className}`}>{children}</div>
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'md' | 'sm' }

export function Button({ variant = 'primary', size = 'md', className = '', ...props }: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl font-bold transition disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green whitespace-nowrap'
  const dims = size === 'sm' ? 'h-9 px-3.5 text-[13px]' : 'h-12 px-5 text-[15px]'
  const look = {
    primary: 'bg-ink text-white hover:bg-black',
    secondary: 'border-[1.5px] border-line bg-surface text-ink hover:bg-surface-2',
    ghost: 'text-muted hover:bg-surface-2 hover:text-ink',
    danger: 'bg-red-soft text-red-ink hover:bg-[#f3d3cc]',
  }[variant]
  return <button type="button" className={`${base} ${dims} ${look} ${className}`} {...props} />
}

/** Small round pill, like "Join" / "Joined" / "Book" / "Edit". */
export function Pill({ active = false, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-bold transition disabled:opacity-50 ${
        active ? 'bg-ink text-white hover:bg-black' : 'border-[1.5px] border-line bg-surface text-ink hover:bg-surface-2'
      } ${className}`}
      {...props}
    />
  )
}

/** Full width unless the caller sets its own w-[...] / h-[...]. */
const size = (className: string) => `${/\bw-/.test(className) ? '' : 'w-full '}${/\bh-/.test(className) ? '' : 'h-12 '}`

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`${size(className)}rounded-xl border-[1.5px] border-line bg-surface px-4 text-[15px] font-semibold outline-none placeholder:font-medium placeholder:text-faint focus:border-green ${className}`}
      {...props}
    />
  )
}

export function Select({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`${size(className)}appearance-none rounded-xl border-[1.5px] border-line bg-surface bg-[url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239a9690' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")] bg-[length:16px] bg-[right_10px_center] bg-no-repeat pl-4 pr-8 text-[15px] font-semibold outline-none focus:border-green ${className}`}
      {...props}
    >
      {children}
    </select>
  )
}

export function Label({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">{children}</div>
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted">{children}</div>
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null
  return <div className="rounded-xl bg-red-soft px-4 py-3 text-sm font-semibold text-red-ink">{children}</div>
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-[34px] shrink-0 rounded-full transition ${on ? 'bg-green' : 'bg-[#d6d2cb]'}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? 'left-[16px]' : 'left-0.5'}`} />
    </button>
  )
}

// Soft avatar backgrounds for people without a Discord picture, picked by name so they stay stable.
const avatarTints = [
  ['#D9E7F5', '#2C4F73'],
  ['#DCEFE0', '#2F6B45'],
  ['#FBE3D6', '#8A3F1C'],
  ['#E8E1F5', '#4E3A7A'],
  ['#FFF1C7', '#6B4E00'],
  ['#DDF1EE', '#1F5F58'],
]

export function initialsOf(name: string): string {
  return (
    name
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('') || '?'
  )
}

export function Avatar({ name, url, size = 40, ring }: { name: string; url?: string | null; size?: number; ring?: string }) {
  const tint = avatarTints[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % avatarTints.length]
  const style = { width: size, height: size, boxShadow: ring ? `0 0 0 2px ${ring}` : undefined }
  return url ? (
    <img src={url} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={style} />
  ) : (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-extrabold"
      style={{ ...style, background: tint[0], color: tint[1], fontSize: Math.max(7, Math.round(size * 0.38)) }}
    >
      {initialsOf(name)}
    </div>
  )
}

/** Stacked Discord avatars, the way sessions show who has joined. */
export function AvatarStack({
  people,
  size = 18,
  ring = '#ffffff',
  max = 6,
}: {
  people: { user_id: string; profile: Profile | null }[]
  size?: number
  ring?: string
  max?: number
}) {
  const shown = people.slice(0, max)
  const rest = people.length - shown.length
  if (people.length === 0) return <span className="text-[11px] font-semibold text-faint">nobody yet</span>
  return (
    <div className="flex items-center">
      {shown.map((p, i) => (
        <div key={p.user_id} style={{ marginLeft: i === 0 ? 0 : -Math.round(size / 3) }} title={p.profile?.display_name ?? ''}>
          <Avatar name={p.profile?.display_name ?? '?'} url={p.profile?.avatar_url} size={size} ring={ring} />
        </div>
      ))}
      {rest > 0 && (
        <div
          className="flex items-center justify-center rounded-full bg-surface-2 font-bold text-muted"
          style={{ width: size, height: size, marginLeft: -Math.round(size / 3), fontSize: Math.round(size * 0.4), boxShadow: `0 0 0 2px ${ring}` }}
        >
          +{rest}
        </div>
      )}
    </div>
  )
}

/** One dot per teammate; filled = free for the whole block. */
export function DotRow({ can, size = 6, dim = false }: { can: boolean[]; size?: number; dim?: boolean }) {
  return (
    <div className="flex" style={{ gap: Math.max(2, size / 2) }}>
      {can.map((on, i) => (
        <span
          key={i}
          className="rounded-full"
          style={{
            width: size,
            height: size,
            background: on ? (dim ? '#9CCBAC' : '#3E9A63') : 'transparent',
            border: on ? 'none' : '1.2px solid #CFCBC4',
            boxSizing: 'border-box',
          }}
        />
      ))}
    </div>
  )
}

export function Spinner({ className = 'min-h-[40vh]' }: { className?: string }) {
  return <div className={`flex items-center justify-center text-sm font-semibold text-muted ${className}`}>Loading …</div>
}

export function Modal({ children, onClose, width = 448 }: { children: ReactNode; onClose: () => void; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-6" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-[24px] bg-surface p-6 shadow-[0_24px_48px_rgba(15,12,8,0.16)] sm:rounded-[24px]"
        style={{ maxWidth: width }}
      >
        {children}
      </div>
    </div>
  )
}

export function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-xl text-muted hover:bg-surface-2 hover:text-ink">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  )
}

export function Check({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12l5 5L20 7" />
    </svg>
  )
}

// ---------- toast ("Saved") ----------

const ToastContext = createContext<(msg: string) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const show = useCallback((m: string) => {
    setMsg(m)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setMsg(null), 1800)
  }, [])
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className={`pointer-events-none fixed bottom-20 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[13px] font-bold text-white shadow-card transition-all duration-200 lg:bottom-8 ${
          msg ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
        }`}
      >
        <span className="text-green-soft">
          <Check size={13} />
        </span>
        {msg}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
