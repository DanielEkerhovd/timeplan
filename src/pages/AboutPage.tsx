import type { ReactNode } from "react";
import { Eyebrow, useToast } from "../components/ui";

/**
 * Om appen. Nås fra merket nederst i sidemenyen, og fra brukermenyen på mobil.
 *
 * Sida svarer på tre ting, i den rekkefølgen folk lurer på dem: hva dette gjør,
 * hva andre kan se om deg, og hvem som står bak. Ingen data hentes her.
 */
export default function AboutPage() {
  const toast = useToast();

  async function copy(value: string, what: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast(`${what} copied`);
    } catch {
      window.prompt(`Copy ${what.toLowerCase()}`, value);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:-mr-8 lg:overflow-y-auto lg:pr-8">
      <div className="flex w-full max-w-[1240px] flex-col gap-5">
        {/* Toppen: merket stort én gang, med det appen faktisk gjør ved siden av. */}
        <section className="flex flex-col gap-6 rounded-[20px] bg-surface p-6 shadow-card sm:p-8 lg:flex-row lg:items-center lg:gap-10">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[20px] bg-ink text-bg">
              <svg
                width="34"
                height="34"
                viewBox="0 0 64 64"
                fill="none"
                stroke="currentColor"
                strokeWidth="6.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M44 22a15 15 0 1 0 3 10h-11" />
              </svg>
            </div>
            <div className="flex flex-col leading-tight">
              <Eyebrow>About</Eyebrow>
              <h1 className="text-[30px] font-extrabold tracking-tight">
                Gatherapp.gg
              </h1>
              <span className="text-[13px] text-muted">
                Planning tool for teams and groups
              </span>
            </div>
          </div>
          <p className="max-w-[440px] text-[15px] leading-relaxed text-muted lg:border-l lg:border-line-soft lg:pl-10">
            Keeps track of your group's availability. Plan scrims, matches,
            hangouts or whatever, and share a link to the week on Discord. No
            signups, no ads, no tracking.
          </p>
        </section>

        {/* Fire steg, ett kort hver, så det leses som en flyt og ikke en punktliste. */}
        <section className="flex flex-col gap-3">
          <h2 className="px-1 text-[15px] font-extrabold">How it works</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Step
              n="1"
              title="Mark your week"
              body="Tap the blocks you can make. Every tap saves right away — there is no submit button."
            />
            <Step
              n="2"
              title="See the overlap"
              body="Owners and admins get a grid of how many can make each block, and a list of the ones everybody can."
            />
            <Step
              n="3"
              title="Book it"
              body="Click a block to put a scrim, a match or anything else there. People join with one tap."
            />
            <Step
              n="4"
              title="Share the week"
              body="One link shows what is booked and who joined. Paste it on Discord and it unfolds as an image."
            />
          </div>
        </section>

        <div className="grid gap-3 lg:grid-cols-2">
          {/* Personvern først: det er det folk faktisk lurer på når de blir lagt til. */}
          <Panel
            icon={
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
                <rect x="4" y="10" width="16" height="11" rx="3" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
            }
            title="What others can see"
          >
            <Line
              label="In your team"
              text="Everyone sees who is free when. That is the whole point of the grid."
            />
            <Line
              label="On a shared link"
              text="What is booked, who joined, and the blocks where the whole team is free. Never who is free when, and never anyone's account."
            />
            <Line
              label="The link itself"
              text="A 14-character code from an alphabet of 31 — it cannot be guessed. The owner can replace it at any time, which kills the old one."
            />
            <Line
              label="Your Discord"
              text="We read your name and avatar. Nothing is ever posted on your behalf."
            />
          </Panel>

          <Panel
            icon={
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
                <path d="M8 17l-5-5 5-5M16 7l5 5-5 5" />
              </svg>
            }
            title="Under the hood"
          >
            <div className="flex flex-wrap gap-1.5">
              {[
                "React",
                "TypeScript",
                "Vite",
                "Tailwind",
                "Postgres",
                "Supabase",
                "Discord OAuth",
                "Vercel",
              ].map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-surface-2 px-2.5 py-1 text-[12px] font-bold text-muted"
                >
                  {t}
                </span>
              ))}
            </div>
            <p className="text-[13px] leading-relaxed text-muted">
              Every rule about who may read or write what lives in the database,
              on the rows themselves — not in the app. So it holds even for
              someone who skips the app and talks to the API directly.
            </p>
            <p className="text-[13px] leading-relaxed text-muted">
              The security rules have their own test suite that runs on every
              change: a couple of hundred checks that outsiders stay out and
              members only reach their own team.
            </p>
          </Panel>
        </div>

        {/* Kontakt: to måter, begge ett klikk unna. */}
        <section className="flex flex-col gap-5 rounded-[20px] bg-surface p-6 shadow-card sm:p-7 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex max-w-[460px] flex-col gap-1.5">
            <h2 className="text-[15px] font-extrabold">Who made it</h2>
            <p className="text-[13px] leading-relaxed text-muted">
              Built by{" "}
              <a
                href="https://danielekerhovd.com/"
                target="_blank"
                rel="noreferrer"
                className="font-extrabold text-ink underline decoration-line underline-offset-2 transition hover:decoration-ink"
              >
                Daniel Ekerhovd
              </a>
              , a frontend developer in Norway. Something broken, or missing
              something your team needs? Say so — it goes straight to the person
              writing the code.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <a
              href="mailto:daniel@webvest.no"
              className="flex h-11 items-center gap-2.5 rounded-full bg-ink px-4 text-[13px] font-bold text-on-ink transition hover:brightness-110"
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
                <rect x="3" y="5" width="18" height="14" rx="3" />
                <path d="M3.5 7l8.5 6 8.5-6" />
              </svg>
              daniel@webvest.no
            </a>
            <button
              type="button"
              onClick={() => void copy("fabbiel", "Discord name")}
              title="Copy the Discord name"
              className="flex h-11 items-center gap-2.5 rounded-full border-[1.5px] border-line bg-surface px-4 text-[13px] font-bold transition hover:border-faint"
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="text-[#5865F2]"
              >
                <path d="M19.3 5.6A16.9 16.9 0 0 0 15.1 4.3l-.2.4a15.7 15.7 0 0 1 3.7 1.2 13.6 13.6 0 0 0-11.2 0A15.7 15.7 0 0 1 11.1 4.7L10.9 4.3A16.9 16.9 0 0 0 6.7 5.6 17.6 17.6 0 0 0 3.7 17.4a16.9 16.9 0 0 0 5.1 2.6l.6-1a11.2 11.2 0 0 1-1.7-.8l.4-.3a12.1 12.1 0 0 0 9.8 0l.4.3a11.2 11.2 0 0 1-1.7.8l.6 1a16.9 16.9 0 0 0 5.1-2.6 17.6 17.6 0 0 0-3-11.8ZM9.4 14.7c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.9.9 1.8 2c0 1.1-.8 2-1.8 2Zm5.2 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.9.9 1.8 2c0 1.1-.8 2-1.8 2Z" />
              </svg>
              fabbiel
            </button>
          </div>
        </section>

        <p className="px-1 pb-2 text-[12px] text-faint">
          Gatherapp.gg · made in Hardanger, Norway
        </p>
      </div>
    </div>
  );
}

/** Ett steg i «How it works». Nummeret bærer rekkefølgen, så teksten slipper. */
function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-[18px] bg-surface p-5 shadow-card">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-green-soft text-[13px] font-extrabold text-green-ink">
        {n}
      </span>
      <span className="text-[14px] font-extrabold">{title}</span>
      <span className="text-[13px] leading-relaxed text-muted">{body}</span>
    </div>
  );
}

function Panel({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3.5 rounded-[20px] bg-surface p-6 shadow-card">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-surface-2 text-muted">
          {icon}
        </span>
        <h2 className="text-[15px] font-extrabold">{title}</h2>
      </div>
      {children}
    </div>
  );
}

/** En rad med en kort merkelapp til venstre, så øyet finner tilfellet det leter etter. */
function Line({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-line-soft pt-3 first:border-0 first:pt-0 sm:flex-row sm:gap-4">
      <span className="shrink-0 text-[12px] font-extrabold sm:w-[120px]">
        {label}
      </span>
      <span className="text-[13px] leading-relaxed text-muted">{text}</span>
    </div>
  );
}
