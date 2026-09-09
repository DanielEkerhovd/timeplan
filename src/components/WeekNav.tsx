import { formatRange, weekId } from '../lib/week'

interface Props {
  monday: Date
  isCurrentWeek: boolean
  subtitle?: string
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  /** Mobile: shown under the week bar. */
  actions?: React.ReactNode
  /** Desktop: next to the prev/today/next selector (e.g. New activity). */
  leftActions?: React.ReactNode
  /** Desktop: in the right-hand column slot, aligned with the aside below (e.g. My week / Plan week). */
  rightActions?: React.ReactNode
}

const arrow = (dir: 'left' | 'right') => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {dir === 'left' ? <path d="M15 6l-6 6 6 6" /> : <path d="M9 6l6 6-6 6" />}
  </svg>
)

/** Week title with prev / today / next. Compact bar on mobile, big heading on desktop. */
export default function WeekNav({ monday, isCurrentWeek, subtitle, onPrev, onNext, onToday, actions, leftActions, rightActions }: Props) {
  const number = weekId(monday).slice(-2).replace(/^0/, '')
  // The badge always takes up its space so the heading never shifts sideways.
  const now = (
    <span className={`ml-1.5 inline-block rounded-full bg-green-soft px-2 py-0.5 text-[10px] font-bold text-green-ink ${isCurrentWeek ? '' : 'invisible'}`}>
      now
    </span>
  )

  return (
    <div className="flex flex-col gap-3">
      {/* Mobile */}
      <div className="flex items-center justify-between rounded-[14px] bg-surface px-3 py-2.5 shadow-card lg:hidden">
        <button onClick={onPrev} aria-label="Previous week" className="flex h-9 w-9 items-center justify-center rounded-[10px] text-muted hover:bg-surface-2">
          {arrow('left')}
        </button>
        <button onClick={onToday} className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-2" title="Jump to this week">
          <span className="text-[15px] font-bold">
            Week {number}
            {now}
          </span>
          <span className="w-full truncate text-center text-xs text-muted">
            {formatRange(monday)}
            {subtitle ? ` · ${subtitle}` : ''}
          </span>
        </button>
        <button onClick={onNext} aria-label="Next week" className="flex h-9 w-9 items-center justify-center rounded-[10px] text-muted hover:bg-surface-2">
          {arrow('right')}
        </button>
      </div>
      {actions && <div className="lg:hidden">{actions}</div>}

      {/* Desktop: title on top, then one row with the selector + actions on the left
          and the view toggle in the right column, lined up with the aside below. */}
      <div className="hidden flex-col gap-3 lg:flex">
        <div className="flex flex-col gap-0.5">
          <h1 className="whitespace-nowrap text-[28px] font-extrabold leading-[1.1] tracking-tight">
            Week {number}
            {now}
          </h1>
          <div className="truncate text-sm text-muted">
            {formatRange(monday)}
            {subtitle ? ` · ${subtitle}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex gap-1 rounded-[10px] bg-surface p-[3px] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              <button onClick={onPrev} aria-label="Previous week" className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink">
                {arrow('left')}
              </button>
              <button onClick={onToday} className="h-8 rounded-lg px-2.5 text-[13px] font-bold hover:bg-surface-2">
                Today
              </button>
              <button onClick={onNext} aria-label="Next week" className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink">
                {arrow('right')}
              </button>
            </div>
            {leftActions}
          </div>
          {rightActions && <div className="flex w-[300px] shrink-0 items-center">{rightActions}</div>}
        </div>
      </div>
    </div>
  )
}
