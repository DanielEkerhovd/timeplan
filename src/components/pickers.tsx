import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { addDays, addMonths, format, isSameDay, isSameMonth, startOfMonth, subMonths } from 'date-fns'
import { zoneDayShift, zoneHourLabel } from '../lib/timezone'
import { fromDateKey, toDateKey, weekStart } from '../lib/week'

// Custom dropdown and date picker so nothing native (browser select / calendar) shows up.

const chevron = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-faint">
    <path d="M6 9l6 6 6-6" />
  </svg>
)

/** Floating panel anchored under (or above) a trigger, positioned with fixed coords so it never gets clipped. */
function Popover({ anchor, onClose, width, children }: { anchor: HTMLElement | null; onClose: () => void; width?: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null)

  useLayoutEffect(() => {
    const r = anchor?.getBoundingClientRect()
    if (!r) return
    const h = ref.current?.offsetHeight ?? 280
    const w = width ?? Math.max(r.width, 160)
    const up = r.bottom + h + 12 > window.innerHeight && r.top - h - 12 > 0
    setPos({ left: Math.min(Math.max(8, r.left), window.innerWidth - w - 8), top: up ? r.top - 6 : r.bottom + 6, up })
  }, [anchor, width])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose()
    }
    // Escape closes just the popover, not the dialog behind it (capture + stop).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        onClose()
      }
    }
    // Scrolling the page behind closes the popover; scrolling inside the list (or the list
    // scrolling its selected row into view on open) must not.
    const onScroll = (e: Event) => {
      if (ref.current?.contains(e.target as Node)) return
      onClose()
    }
    // Capture phase: dialogs stop mousedown from bubbling, and we still need to hear it.
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [anchor, onClose])

  return (
    <div
      ref={ref}
      className="fixed z-[70] rounded-2xl bg-surface p-1.5 shadow-pop ring-1 ring-line"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: width ?? (anchor ? Math.max(anchor.offsetWidth, 160) : 160), transform: pos?.up ? 'translateY(-100%)' : undefined }}
    >
      {children}
    </div>
  )
}

export interface DropdownOption<T extends string | number> {
  value: T
  label: string
  /** Small colour dot in front of the label. */
  dot?: string
  disabled?: boolean
}

interface DropdownProps<T extends string | number> {
  value: T
  options: DropdownOption<T>[]
  onChange: (value: T) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  'aria-label'?: string
  /** 'pill' = small round trigger (rows); 'field' = form field. */
  look?: 'field' | 'pill'
  menuWidth?: number
  /** Search box on top of the list. On by itself only for very long lists (timezones). */
  search?: boolean
}

/** App-styled select. Trigger + floating list, same look as the user menu. */
export function Dropdown<T extends string | number>({ value, options, onChange, placeholder = 'Pick …', disabled, className = '', look = 'field', menuWidth, search, ...rest }: DropdownProps<T>) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const btn = useRef<HTMLButtonElement>(null)
  const current = options.find((o) => o.value === value)
  // Long lists (every timezone in the world) need a way in that is not scrolling.
  const searchable = search ?? options.length > 30
  const q = query.trim().toLowerCase()
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options
  const base =
    look === 'pill'
      ? 'h-8 rounded-full border-[1.5px] border-line bg-surface pl-3 pr-2.5 text-xs font-bold'
      : 'h-12 rounded-xl border-[1.5px] border-line bg-surface pl-4 pr-3 text-[15px] font-semibold'
  return (
    <>
      <button
        ref={btn}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={rest['aria-label']}
        onClick={() => {
          setQuery('')
          setOpen((o) => !o)
        }}
        className={`flex items-center justify-between gap-2 text-left outline-none transition hover:border-faint focus-visible:border-green disabled:opacity-50 ${base} ${className}`}
      >
        <span className={`flex min-w-0 items-center gap-2 truncate ${current ? '' : 'text-faint'}`}>
          {current?.dot && <span className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: current.dot }} />}
          <span className="truncate">{current?.label ?? placeholder}</span>
        </span>
        {chevron}
      </button>
      {open && (
        <Popover anchor={btn.current} onClose={() => setOpen(false)} width={menuWidth}>
          {searchable && (
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="mb-1 h-9 w-full rounded-[10px] bg-surface-2 px-3 text-[13px] font-semibold outline-none placeholder:text-faint"
            />
          )}
          <ul
            role="listbox"
            className="flex max-h-[260px] flex-col overflow-y-auto"
            ref={(el) => el?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })}
          >
            {shown.length === 0 && <li className="px-3 py-2 text-[13px] font-semibold text-faint">Nothing matches</li>}
            {shown.map((o) => {
              const on = o.value === value
              return (
                <li key={String(o.value)}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    disabled={o.disabled}
                    onClick={() => {
                      onChange(o.value)
                      setOpen(false)
                    }}
                    className={`flex h-9 w-full items-center gap-2 rounded-[10px] px-3 text-left text-[13px] font-semibold disabled:opacity-40 ${
                      on ? 'bg-ink text-on-ink' : 'text-ink hover:bg-surface-2'
                    }`}
                  >
                    {o.dot && <span className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: o.dot }} />}
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {on && (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12l5 5L20 7" />
                      </svg>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </Popover>
      )}
    </>
  )
}

/**
 * Hours as dropdown options, e.g. 18 → "18:00". The value stays the team's hour;
 * only the label follows the reader's timezone, so nothing about storage changes.
 */
export function hourOptions(from: number, to: number, diff = 0): DropdownOption<number>[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i).map((h) => {
    const shift = zoneDayShift(h, diff)
    return { value: h, label: `${zoneHourLabel(h, diff)}${shift === 0 ? '' : shift > 0 ? ' +1' : ' −1'}` }
  })
}

interface DatePickerProps {
  /** YYYY-MM-DD */
  value: string
  onChange: (key: string) => void
  className?: string
}

/** App-styled calendar: weeks start on Monday, today ringed, picked day dark. */
export function DatePicker({ value, onChange, className = '' }: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const selected = fromDateKey(value)
  const [month, setMonth] = useState(startOfMonth(selected))
  const btn = useRef<HTMLButtonElement>(null)
  const today = new Date()

  useEffect(() => {
    if (open) setMonth(startOfMonth(selected))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const first = weekStart(month)
  const cells = Array.from({ length: 42 }, (_, i) => addDays(first, i))

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-12 items-center justify-between gap-2 rounded-xl border-[1.5px] border-line bg-surface pl-4 pr-3 text-left text-[15px] font-semibold outline-none transition hover:border-faint focus-visible:border-green ${className}`}
      >
        <span className="truncate">{format(selected, 'EEE d MMM')}</span>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-faint">
          <rect x="3" y="5" width="18" height="16" rx="3" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      </button>
      {open && (
        <Popover anchor={btn.current} onClose={() => setOpen(false)} width={272}>
          <div className="flex flex-col gap-2 p-1.5">
            <div className="flex items-center justify-between">
              <button type="button" onClick={() => setMonth((m) => subMonths(m, 1))} aria-label="Previous month" className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 6l-6 6 6 6" />
                </svg>
              </button>
              <span className="text-sm font-extrabold">{format(month, 'MMMM yyyy')}</span>
              <button type="button" onClick={() => setMonth((m) => addMonths(m, 1))} aria-label="Next month" className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
                <div key={d} className="py-1 text-center text-[10px] font-bold uppercase tracking-[0.06em] text-faint">
                  {d}
                </div>
              ))}
              {cells.map((d) => {
                const picked = isSameDay(d, selected)
                const inMonth = isSameMonth(d, month)
                const isToday = isSameDay(d, today)
                return (
                  <button
                    key={d.toISOString()}
                    type="button"
                    onClick={() => {
                      onChange(toDateKey(d))
                      setOpen(false)
                    }}
                    className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-semibold transition ${
                      picked ? 'bg-ink text-on-ink' : inMonth ? 'text-ink hover:bg-surface-2' : 'text-faint hover:bg-surface-2'
                    } ${isToday && !picked ? 'ring-[1.5px] ring-inset ring-green' : ''}`}
                  >
                    {format(d, 'd')}
                  </button>
                )
              })}
            </div>
            <button
              type="button"
              onClick={() => {
                onChange(toDateKey(today))
                setOpen(false)
              }}
              className="h-8 rounded-[10px] text-[12px] font-bold text-muted hover:bg-surface-2 hover:text-ink"
            >
              Today
            </button>
          </div>
        </Popover>
      )}
    </>
  )
}
