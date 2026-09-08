import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-card bg-surface p-5 shadow-card ${className}`}>{children}</div>
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  const base =
    'inline-flex h-12 items-center justify-center gap-2 rounded-xl px-5 text-[15px] font-bold transition disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green'
  const look =
    variant === 'primary'
      ? 'bg-ink text-white hover:bg-black'
      : 'border-[1.5px] border-line bg-surface text-ink hover:bg-surface-2'
  return <button className={`${base} ${look} ${className}`} {...props} />
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`h-12 w-full rounded-xl border-[1.5px] border-line bg-surface px-4 text-[15px] font-semibold outline-none placeholder:font-medium placeholder:text-faint focus:border-green ${className}`}
      {...props}
    />
  )
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted">{children}</div>
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null
  return <div className="rounded-xl bg-red-soft px-4 py-3 text-sm font-semibold text-red-ink">{children}</div>
}

export function Avatar({ name, url, size = 40 }: { name: string; url?: string | null; size?: number }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
  return url ? (
    <img src={url} alt="" width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <div
      className="flex items-center justify-center rounded-full bg-green-soft text-sm font-extrabold text-green-ink"
      style={{ width: size, height: size }}
    >
      {initials || '?'}
    </div>
  )
}

export function Spinner() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-sm font-semibold text-muted">Laster …</div>
  )
}
