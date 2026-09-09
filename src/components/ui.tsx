import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";
import type { Profile } from "../lib/types";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-[20px] bg-surface p-5 shadow-card ${className}`}>
      {children}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm";
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl font-bold transition disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green whitespace-nowrap";
  const dims =
    size === "sm" ? "h-9 px-3.5 text-[13px]" : "h-12 px-5 text-[15px]";
  const look = {
    primary: "bg-ink text-on-ink hover:opacity-90",
    secondary:
      "border-[1.5px] border-line bg-surface text-ink hover:bg-surface-2",
    ghost: "text-muted hover:bg-surface-2 hover:text-ink",
    danger: "bg-red-soft text-red-ink hover:brightness-95",
  }[variant];
  return (
    <button
      type="button"
      className={`${base} ${dims} ${look} ${className}`}
      {...props}
    />
  );
}

/** Small round pill, like "Join" / "Joined" / "Book" / "Edit". */
export function Pill({
  active = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-bold transition disabled:opacity-50 ${
        active
          ? "bg-ink text-on-ink hover:opacity-90"
          : "border-[1.5px] border-line bg-surface text-ink hover:bg-surface-2"
      } ${className}`}
      {...props}
    />
  );
}

// Tiny class merger: a base class gives way when the caller passes one from the same family
// (h-*, w-*, text-[size], rounded-*, px/pl/pr-*), so `className="h-8 text-xs"` really wins.
const families = [
  /^h-/,
  /^w-/,
  /^text-(\[|xs|sm|base|lg|xl)/,
  /^rounded/,
  /^px-/,
  /^pl-/,
  /^pr-/,
];
function merge(base: string, className: string): string {
  const own = className.split(/\s+/).filter(Boolean);
  const taken = families.filter((f) => own.some((c) => f.test(c)));
  const kept = base.split(/\s+/).filter((c) => !taken.some((f) => f.test(c)));
  return [...kept, ...own].join(" ");
}

const inputBase =
  "h-12 w-full rounded-xl border-[1.5px] border-line bg-surface px-4 text-[15px] font-semibold outline-none placeholder:font-medium placeholder:text-faint focus:border-green";

export function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={merge(inputBase, className)} {...props} />;
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
      {children}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted">
      {children}
    </div>
  );
}

/**
 * Feilen glir inn og ut, som det grønne feltet i uka: samme grep med grid-rows,
 * så høyden animeres uten at vi vet hvor høy teksten blir.
 *
 * To ting må til for at det skal virke begge veier. Inn: den må stå i treet ett
 * bilde med høyde null før vi åpner, ellers har den ingenting å gli fra. Ut:
 * teksten blir stående til den er ferdig ute — ellers ville boksen vært tom mens
 * den lukket seg. Når den er ute, tar vi den ut av treet igjen, så den ikke
 * legger igjen et mellomrom i kolonnen den står i.
 */
export function ErrorText({ children }: { children: ReactNode }) {
  const has = Boolean(children);
  const [mounted, setMounted] = useState(has);
  const [open, setOpen] = useState(false);
  const last = useRef<ReactNode>(children);
  if (has) last.current = children;

  useEffect(() => {
    if (has) {
      setMounted(true);
      // Ett bilde til høyde null, så ett til for å åpne. Gjør vi begge i samme
      // bilde ser nettleseren bare sluttverdien, og det blir ingen overgang.
      let frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => setOpen(true));
      });
      return () => cancelAnimationFrame(frame);
    }
    setOpen(false);
    // Egen klokke i stedet for transitionend: med redusert bevegelse kommer den
    // aldri, og da ville teksten blitt hengende igjen usynlig.
    const done = setTimeout(() => setMounted(false), 220);
    return () => clearTimeout(done);
  }, [has]);

  if (!mounted) return null;

  return (
    <div
      className={`grid transition-all duration-200 ease-out ${
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      }`}
      aria-hidden={!open}
    >
      <div className="overflow-hidden">
        <div className="rounded-xl bg-red-soft px-4 py-3 text-sm font-semibold text-red-ink">
          {has ? children : last.current}
        </div>
      </div>
    </div>
  );
}

export function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-[34px] shrink-0 rounded-full transition ${on ? "bg-green" : "bg-dot"}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? "left-[16px]" : "left-0.5"}`}
      />
    </button>
  );
}

// Soft avatar backgrounds for people without a Discord picture, picked by name so they stay stable.
const avatarTints = [1, 2, 3, 4, 5, 6].map((i) => [`var(--tint-${i}-bg)`, `var(--tint-${i}-fg)`]);

export function initialsOf(name: string): string {
  return (
    name
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

export function Avatar({
  name,
  url,
  size = 40,
  ring,
}: {
  name: string;
  url?: string | null;
  size?: number;
  ring?: string;
}) {
  const tint =
    avatarTints[
      [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % avatarTints.length
    ];
  const style = {
    width: size,
    height: size,
    boxShadow: ring ? `0 0 0 2px ${ring}` : undefined,
  };
  return url ? (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-full object-cover"
      style={style}
    />
  ) : (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-extrabold"
      style={{
        ...style,
        background: tint[0],
        color: tint[1],
        fontSize: Math.max(7, Math.round(size * 0.38)),
      }}
    >
      {initialsOf(name)}
    </div>
  );
}

/** Stacked Discord avatars, the way sessions show who has joined. */
export function AvatarStack({
  people,
  size = 18,
  ring = "var(--color-surface)",
  max = 6,
}: {
  people: { user_id: string; profile: Profile | null }[];
  size?: number;
  ring?: string;
  max?: number;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  if (people.length === 0)
    return (
      <span className="whitespace-nowrap text-[11px] font-semibold text-faint">nobody yet</span>
    );
  return (
    <div className="flex items-center">
      {shown.map((p, i) => (
        <div
          key={p.user_id}
          style={{ marginLeft: i === 0 ? 0 : -Math.round(size / 3) }}
          title={p.profile?.display_name ?? ""}
        >
          <Avatar
            name={p.profile?.display_name ?? "?"}
            url={p.profile?.avatar_url}
            size={size}
            ring={ring}
          />
        </div>
      ))}
      {rest > 0 && (
        <div
          className="flex items-center justify-center rounded-full bg-surface-2 font-bold text-muted"
          style={{
            width: size,
            height: size,
            marginLeft: -Math.round(size / 3),
            fontSize: Math.round(size * 0.4),
            boxShadow: `0 0 0 2px ${ring}`,
          }}
        >
          +{rest}
        </div>
      )}
    </div>
  );
}

/** One dot per teammate; filled = free for the whole block. */
export function DotRow({
  can,
  size = 8,
  dim = false,
}: {
  can: boolean[];
  size?: number;
  dim?: boolean;
}) {
  return (
    <div className="flex" style={{ gap: Math.max(2, size / 2) }}>
      {can.map((on, i) => (
        <span
          key={i}
          className="rounded-full"
          style={{
            width: size,
            height: size,
            background: on ? (dim ? "var(--color-green-dim)" : "var(--color-green)") : "transparent",
            border: on ? "none" : "1.2px solid var(--color-dot)",
            boxSizing: "border-box",
          }}
        />
      ))}
    </div>
  );
}

export function Spinner({
  className = "min-h-[40vh]",
}: {
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-center text-sm font-semibold text-muted ${className}`}
    >
      Loading …
    </div>
  );
}

export function Modal({
  children,
  onClose,
  width = 448,
}: {
  children: ReactNode;
  onClose: () => void;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-[24px] bg-surface p-6 shadow-pop sm:rounded-[24px]"
        style={{ maxWidth: width }}
      >
        {children}
      </div>
    </div>
  );
}

export function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close"
      className="flex h-9 w-9 items-center justify-center rounded-xl text-muted hover:bg-surface-2 hover:text-ink"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      >
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}

export function Check({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}

// ---------- toast ("Saved") ----------

const ToastContext = createContext<(msg: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((m: string) => {
    setMsg(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 1800);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className={`pointer-events-none fixed bottom-20 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[13px] font-bold text-on-ink shadow-card transition-all duration-200 lg:bottom-8 ${
          msg ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
        }`}
      >
        <span className="text-green-soft">
          <Check size={13} />
        </span>
        {msg}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ---------- hover card: who is free in a block ----------

export interface WhoEntry {
  name: string;
  url?: string | null;
  free: boolean;
}

/**
 * Wrap a slot button or grid cell. After a short hover a small card shows who is free
 * for that block and who is not. Mouse only; nothing happens on touch.
 */
export function WhoHover({
  title,
  people,
  children,
  delay = 350,
}: {
  title: string;
  people: WhoEntry[];
  children: ReactNode;
  delay?: number;
}) {
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean } | null>(
    null,
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPos(null);
  };

  const onEnter = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      // The wrapper is display:contents, so measure the trigger itself.
      const r = (
        ref.current?.firstElementChild as HTMLElement | null
      )?.getBoundingClientRect();
      if (!r) return;
      const up = r.bottom + 220 > window.innerHeight;
      setPos({
        x: Math.min(
          Math.max(r.left + r.width / 2, 120),
          window.innerWidth - 120,
        ),
        y: up ? r.top - 8 : r.bottom + 8,
        up,
      });
    }, delay);
  };

  useEffect(() => clear, []);

  const freeCount = people.filter((p) => p.free).length;
  return (
    <div
      ref={ref}
      className="contents"
      onMouseEnter={onEnter}
      onMouseLeave={clear}
      onMouseDown={clear}
    >
      {children}
      {pos && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 w-[220px] rounded-2xl bg-surface p-3.5 shadow-pop ring-1 ring-line"
          style={{
            left: pos.x,
            top: pos.y,
            transform: `translate(-50%, ${pos.up ? "-100%" : "0"})`,
          }}
        >
          <div className="flex items-baseline justify-between pb-2">
            <span className="text-[13px] font-extrabold">{title}</span>
            <span className="text-[11px] font-semibold text-muted">
              {freeCount}/{people.length} free
            </span>
          </div>
          <ul className="flex flex-col gap-1.5">
            {people.map((p) => (
              <li
                key={p.name}
                className={`flex items-center gap-2 ${p.free ? "" : "opacity-50"}`}
              >
                <Avatar name={p.name} url={p.url} size={20} />
                <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                  {p.name}
                </span>
                <span
                  className={`h-2 w-2 rounded-full ${p.free ? "bg-green" : "border border-dot"}`}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
