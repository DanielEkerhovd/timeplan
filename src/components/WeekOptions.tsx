import { useState } from "react";
import { clearWeek, replaceWithDefaultWeek, saveDefaultWeek } from "../lib/settings";
import { friendlyError } from "../lib/types";

/**
 * Tre ting du kan gjøre med hele uka di, samlet på én knapp nederst i kortet:
 * lagre uka som mal, sette uka til malen, eller tømme uka.
 *
 * Åpen glir valgene ut fra venstre, ett og ett, og knappen blir til en X. Alt som
 * fjerner noe spør først, i samme stripe — ingen dialog oppå uka du nettopp så på.
 */
interface Props {
  teamId: string;
  mondayKey: string;
  /** Hvor mange timer du har i uka nå. Styrer hva som gir mening å tilby. */
  myHours: number;
  /** Timer i malen din. Eies av siden, så det grønne feltet viser det samme. */
  template: number;
  onTemplate: (hours: number) => void;
  onChanged: () => Promise<void>;
  onToast: (message: string) => void;
  onError: (message: string | null) => void;
}

type Confirm = "use" | "save" | "clear";

export default function WeekOptions({
  teamId,
  mondayKey,
  myHours,
  template,
  onTemplate,
  onChanged,
  onToast,
  onError,
}: Props) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    onError(null);
    try {
      const message = await fn();
      await onChanged();
      onToast(message);
      setConfirm(null);
      setOpen(false);
    } catch (err) {
      onError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const actions = {
    save: () =>
      run(async () => {
        const n = await saveDefaultWeek(teamId, mondayKey);
        onTemplate(n);
        return `Saved as your template · ${n} hour${n === 1 ? "" : "s"}`;
      }),
    use: () =>
      run(async () => {
        const n = await replaceWithDefaultWeek(teamId, mondayKey);
        return `This week is now your template · ${n} hour${n === 1 ? "" : "s"}`;
      }),
    clear: () =>
      run(async () => {
        const n = await clearWeek(teamId, mondayKey);
        return n > 0 ? `Cleared ${n} hour${n === 1 ? "" : "s"}` : "Nothing to clear";
      }),
  };

  const hours = (n: number) => `${n} hour${n === 1 ? "" : "s"}`;

  const question: Record<Confirm, { text: string; yes: string }> = {
    save: {
      text: `Replace your template? You have ${hours(template)} saved, and this week has ${myHours}.`,
      yes: "Save",
    },
    use: {
      text: `Set this week to your template? This removes the ${hours(myHours)} you picked and sets ${template}.`,
      yes: "Use template",
    },
    clear: {
      text: `Clear this week? That removes the ${hours(myHours)} you picked.`,
      yes: "Clear",
    },
  };

  // Rekkefølgen her er rekkefølgen de glir ut i.
  const chips: { key: Confirm; label: string; onClick: () => void; show: boolean }[] = [
    {
      key: "save",
      label: "Save as template",
      // Har du ingen mal fra før er det ingenting å overskrive, så da bare lagrer vi.
      onClick: () => (template > 0 ? setConfirm("save") : void actions.save()),
      show: myHours > 0,
    },
    {
      key: "use",
      label: "Use template",
      onClick: () => (myHours > 0 ? setConfirm("use") : void actions.use()),
      show: template > 0,
    },
    {
      key: "clear",
      label: "Clear week",
      onClick: () => setConfirm("clear"),
      show: myHours > 0,
    },
  ];
  const shown = chips.filter((c) => c.show);

  function toggle() {
    if (open) setConfirm(null);
    setOpen((o) => !o);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={open ? "Close options" : "Options"}
        disabled={busy}
        className={`flex h-9 shrink-0 items-center justify-center rounded-full border-[1.5px] border-line bg-surface text-[13px] font-bold transition-all duration-300 hover:border-faint disabled:opacity-50 ${
          // Åpen er knappen en sirkel. Bredden settes ikke direkte: den følger av
          // padding + ikon (9 + 16 + 9 + kantene ≈ 36 = høyden), så den kan gli.
          open ? "gap-0 px-[9px]" : "gap-2 px-2.5"
        }`}
      >
        <span
          className={`flex h-4 w-4 items-center justify-center transition-transform duration-300 ${open ? "rotate-90" : ""}`}
        >
          {open ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M4 8h10M18 8h2M4 16h4M12 16h8" />
              <circle cx="16" cy="8" r="2" />
              <circle cx="10" cy="16" r="2" />
            </svg>
          )}
        </span>
        {/* Teksten krymper bort når stripa åpner, så knappen blir en rund X. */}
        <span
          className={`overflow-hidden whitespace-nowrap transition-all duration-300 ${open ? "max-w-0 opacity-0" : "max-w-[90px] opacity-100"}`}
        >
          Options
        </span>
      </button>

      {open && confirm && (
        <div className="flex flex-wrap items-center gap-2 [animation:week-option-in_220ms_ease-out_both]">
          <span className="text-[13px] font-semibold">{question[confirm].text}</span>
          <button
            type="button"
            onClick={() => setConfirm(null)}
            disabled={busy}
            className="h-8 shrink-0 rounded-full border-[1.5px] border-line bg-surface px-3 text-xs font-bold hover:border-faint disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void actions[confirm]()}
            disabled={busy}
            className="h-8 shrink-0 rounded-full bg-ink px-3.5 text-xs font-bold text-on-ink disabled:opacity-50"
          >
            {question[confirm].yes}
          </button>
        </div>
      )}

      {open &&
        !confirm &&
        shown.map((c, i) => (
          <button
            key={c.key}
            type="button"
            onClick={c.onClick}
            disabled={busy}
            style={{ animationDelay: `${i * 45}ms` }}
            className="h-8 shrink-0 rounded-full border-[1.5px] border-line bg-surface px-3 text-xs font-bold transition-colors hover:border-faint disabled:opacity-50 [animation:week-option-in_260ms_ease-out_both]"
          >
            {c.label}
          </button>
        ))}
    </div>
  );
}
