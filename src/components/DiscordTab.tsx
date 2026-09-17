import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { MyTeam } from "../lib/teams";
import { friendlyError } from "../lib/types";
import {
  createChannel,
  createManagedRole,
  disconnectDiscord,
  DOW_LABELS,
  effectiveChannel,
  fetchChannels,
  fetchDiscordState,
  fetchRoles,
  fetchStatus,
  postWeekNow,
  renameManagedRole,
  sendTestMessage,
  setChannel,
  setPing,
  shortTime,
  startConnect,
  syncManagedRole,
  outboxAction,
  tryAction,
  updateSchedule,
} from "../lib/discord";
import { DiscordApiError } from "../lib/discord";
import type { ChannelKind, DiscordPending, DiscordState, PickerChannel, PickerRole, StatusCheck } from "../lib/discord";
import { Button, Card, Check, Eyebrow, ErrorText, Input, Label, Pill, Spinner, Tip, Toggle, useToast } from "./ui";
import { Dropdown } from "./pickers";
import type { DropdownOption } from "./pickers";

/** Server answers are already in plain words; database errors go through the usual translation. */
const explain = (err: unknown) => (err instanceof DiscordApiError ? err.message : friendlyError(err));

/**
 * Settings → Discord. Three shapes, one after the other:
 *
 *   1. Not connected: one button, three lines on what the bot does.
 *   2. Setup: four questions and a test, one per screen. Starts right after
 *      Discord sends the owner back, and again whenever the week-plan channel
 *      is missing. Leaving halfway keeps what was answered.
 *   3. Connected: status first (it is the part that matters), then the same
 *      choices as editable fields, what the bot sends, the last messages, and
 *      Disconnect at the bottom.
 *
 * Only the owner can change anything here; RLS says so, and the buttons that
 * talk to Discord check it again on the server.
 */
export default function DiscordTab({ team }: { team: MyTeam }) {
  const [state, setState] = useState<DiscordState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const isOwner = team.role === "owner";

  const reload = useCallback(async () => {
    try {
      setState(await fetchDiscordState(team.id));
    } catch (err) {
      setError(explain(err));
    }
  }, [team.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Back from Discord: ?discord=linked|cancelled|no_manage_server|token. Read once, then clean the URL.
  const outcome = params.get("discord");
  useEffect(() => {
    if (!outcome) return;
    if (outcome === "linked") setWizard(true);
    else if (outcome === "no_manage_server") setError("Not connected: you need Manage Server in that Discord server. Ask a server admin to connect it, or pick another server.");
    else if (outcome === "wrong_account") setError("Not connected: that was a different Discord account from the one you signed in to Gather with. Sign in to Discord as yourself and try again.");
    else if (outcome === "token") setError("Discord did not accept the sign-in. Try again.");
    const p = new URLSearchParams(params);
    p.delete("discord");
    setParams(p, { replace: true });
  }, [outcome, params, setParams]);

  async function run(fn: () => Promise<void>, done?: string): Promise<boolean> {
    try {
      await fn();
      setError(null);
      await reload();
      if (done) toast(done);
      return true;
    } catch (err) {
      setError(explain(err));
      return false;
    }
  }

  if (!state) return <Spinner />;

  const hasSchedule = state.channels.some((c) => c.kind === "schedule");
  const showWizard = state.link && isOwner && (wizard || !hasSchedule);

  return (
    <div className="flex flex-col gap-4">
      {!state.link ? (
        <NotConnected team={team} isOwner={isOwner} onConnect={() => run(() => startConnect(team.id))} error={error} />
      ) : showWizard ? (
        <Setup team={team} state={state} run={run} error={error} clearError={() => setError(null)} onDone={() => { setError(null); setWizard(false); }} />
      ) : (
        <Connected team={team} state={state} isOwner={isOwner} run={run} error={error} onRerun={() => { setError(null); setWizard(true); }} />
      )}
    </div>
  );
}

// ---------- 1. Not connected ----------

function NotConnected({ team, isOwner, onConnect, error }: { team: MyTeam; isOwner: boolean; onConnect: () => Promise<boolean>; error: string | null }) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Intro title="Let the bot keep the team posted">
        The week plan lands in a channel of your choice and stays up to date. Changes, new sessions and same-day reminders go where you tell them to.
      </Intro>
      <ErrorText>{error}</ErrorText>
      <Card className="flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-3.5 rounded-[16px] border-[1.5px] border-line bg-bg p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-faint">
                <LockIcon />
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="text-[15px] font-extrabold">Not connected</span>
                <span className="text-[13px] text-muted">
                  {isOwner ? `Takes a minute. You need Manage Server on the Discord server ${team.name} uses.` : "Only the owner can connect the team."}
                </span>
              </div>
            </div>
            {isOwner && (
              <Button
                size="sm"
                className="h-10 shrink-0"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void onConnect().then((ok) => {
                    if (!ok) setBusy(false);
                  });
                }}
              >
                <ChatIcon />
                Connect to Discord
              </Button>
            )}
          </div>
        </div>
        <div className="grid gap-3.5 sm:grid-cols-3">
          <Feature label="Week plan">One message with the whole week, pinned, edited in place when something changes. Reposted with a ping every new week.</Feature>
          <Feature label="Updates">New, moved or cancelled sessions in the posted week, with Join and Can&rsquo;t right on the message.</Feature>
          <Feature label="Reminders">A nudge for anyone who has not marked next week, and a heads-up before a session to the people who said yes.</Feature>
        </div>
        <p className="px-1 text-[13px] text-muted">Availability never leaves the app. The bot only ever posts what is booked.</p>
      </Card>
    </>
  );
}

function Feature({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-[16px] bg-bg p-4">
      <Label>{label}</Label>
      <span className="text-[14px] font-semibold leading-snug">{children}</span>
    </div>
  );
}

// ---------- 2. Setup ----------

type Run = (fn: () => Promise<void>, done?: string) => Promise<boolean>;

const STEPS = ["Connect", "Week plan", "Updates", "Who to ping", "Test"];

function Setup({ team, state, run, error, clearError, onDone }: { team: MyTeam; state: DiscordState; run: Run; error: string | null; clearError: () => void; onDone: () => void }) {
  const schedule = state.channels.find((c) => c.kind === "schedule")?.channel_id ?? null;
  const updates = state.channels.find((c) => c.kind === "updates")?.channel_id ?? null;
  // Pick up where they left off: the first question without an answer.
  const [step, setStep] = useState(schedule ? 3 : 2);
  const [picker, setPicker] = useState<PickerChannel[] | null>(null);
  const [pickErr, setPickErr] = useState<string | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const slug = team.name.toLowerCase().replace(/[^a-z0-9æøå]+/g, "-").replace(/^-+|-+$/g, "");

  useEffect(() => {
    let alive = true;
    fetchChannels(team.id)
      .then((r) => alive && setPicker(r.channels))
      .catch((err) => alive && setPickErr(explain(err)));
    return () => {
      alive = false;
    };
  }, [team.id]);

  useEffect(() => {
    setChoice(step === 2 ? schedule : step === 3 ? (updates ?? "same") : null);
    setNewName(step === 2 ? `${slug}-schedule` : step === 3 ? `${slug}-updates` : "");
  }, [step, schedule, updates, slug]);

  // An error belongs to the step it happened on. Going back or forward clears it.
  useEffect(() => {
    clearError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // A channel made on this step is held here until the step moves on, and
  // joins the list in the same render as the step change. Adding it straight
  // away made it flash into the list a frame before the next step appeared.
  const madeRef = useRef<PickerChannel | null>(null);

  /** "new" means make the channel first, then use it. */
  async function pick(kind: "schedule" | "updates", value: string | null) {
    let id = value;
    if (value === "new") {
      const made = await createChannel(team.id, newName);
      madeRef.current = { id: made.id, name: made.name, canPost: true, canPin: true, taken: false, mine: kind };
      id = made.id;
    }
    await setChannel(team.id, kind, id);
  }

  // Only move on when the save went through. A failed save with a green step
  // number would be a lie the owner finds out about on Sunday evening.
  async function next(fn: () => Promise<void>) {
    setBusy(true);
    const ok = await run(fn);
    const made = madeRef.current;
    madeRef.current = null;
    // These land in one render: the new channel is in the list only once the next step shows.
    if (made) setPicker((p) => (p?.some((c) => c.id === made.id) ? p : [...(p ?? []), made]));
    setBusy(false);
    if (ok) setStep((s) => s + 1);
  }

  return (
    <>
      <Intro title="Set up the bot">Three questions and a test. You can change all of it later.</Intro>
      <ErrorText>{error ?? pickErr}</ErrorText>
      <Card className="flex flex-col gap-5 p-6">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {STEPS.map((label, i) => {
            const n = i + 1;
            const done = n < step;
            const now = n === step;
            return (
              <div key={label} className="flex items-center gap-2">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-extrabold ${
                    done ? "bg-green text-white" : now ? "bg-ink text-on-ink" : "border-[1.5px] border-line text-faint"
                  }`}
                >
                  {done ? <Check size={12} /> : n}
                </span>
                <span className={`text-[13px] font-bold ${now ? "text-ink" : done ? "text-muted" : "text-faint"}`}>{label}</span>
              </div>
            );
          })}
        </div>
        <div className="h-px bg-line-soft" />

        {step === 2 && (
          <Question title="Where do you want the week plan?" lede="The bot posts the week here and keeps it up to date. One message, pinned, always at the bottom of the channel.">
            <ChannelList channels={picker} value={choice} onChange={setChoice} exclude={[]} newName={newName} onNewName={setNewName} />
            <Nav
              busy={busy || !choice || (choice === "new" && newName.trim().length < 2)}
              onNext={() => next(() => pick("schedule", choice))}
            />
          </Question>
        )}

        {step === 3 && (
          <Question title="Where do you want updates?" lede="New sessions, moves, cancellations, reminders. Several messages a week, so pick a channel that can take it.">
            <ChannelList channels={picker} value={choice} onChange={setChoice} exclude={schedule ? [schedule] : []} sameLabel="Same channel as the week plan" newName={newName} onNewName={setNewName} />
            {choice === "same" && <p className="text-[13px] text-muted">Every update pushes the week plan up the channel. Works for small teams with a session or two a week.</p>}
            <Nav
              back={() => setStep(2)}
              busy={busy || !choice || (choice === "new" && newName.trim().length < 2)}
              onNext={() => next(() => pick("updates", choice === "same" ? null : choice))}
            />
          </Question>
        )}

        {step === 4 && (
          <Question title="Who should be pinged?" lede="When the week is up, and when something changes.">
            <PingPicker team={team} link={state.link} run={run} onCreated={() => setStep(5)} />
            <Nav back={() => setStep(3)} busy={busy} onNext={() => setStep(5)} />
          </Question>
        )}

        {step === 5 && (
          <Question title="Send a test message" lede="It posts a short line in the channels you picked. Nothing is scheduled until this has gone through.">
            <TestButton team={team} run={run} onSent={() => setStep(6)} />
            <Nav back={() => setStep(4)} hideNext />
          </Question>
        )}

        {step === 6 && (
          <Question title="All set" lede={`The week plan posts ${DOW_LABELS[(state.schedule?.post_dow ?? 7) - 1]} at ${shortTime(state.schedule?.post_at ?? "20:00")}, in the team's zone. Change it below whenever you like.`}>
            <div className="flex justify-end">
              <Button className="h-11" onClick={onDone}>
                Done
              </Button>
            </div>
          </Question>
        )}
      </Card>
    </>
  );
}

function Question({ title, lede, children }: { title: string; lede: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h3 className="text-[20px] font-extrabold tracking-tight">{title}</h3>
        <p className="max-w-[62ch] text-[14px] leading-relaxed text-muted">{lede}</p>
      </div>
      {children}
    </div>
  );
}

function Nav({ back, onNext, busy, hideNext }: { back?: () => void; onNext?: () => void; busy?: boolean; hideNext?: boolean }) {
  return (
    <>
      <div className="h-px bg-line-soft" />
      <div className="flex items-center justify-between gap-4">
        {back ? (
          <Button variant="ghost" size="sm" onClick={back} className="pl-1.5">
            <Arrow dir="left" />
            Back
          </Button>
        ) : (
          <span />
        )}
        {!hideNext && (
          <Button className="h-11" disabled={busy} onClick={onNext}>
            Continue
            <Arrow dir="right" />
          </Button>
        )}
      </div>
    </>
  );
}

/** The channel rows in the setup: radio, #name, and why a row is grey. */
function ChannelList({
  channels,
  value,
  onChange,
  exclude,
  sameLabel,
  newName,
  onNewName,
}: {
  channels: PickerChannel[] | null;
  value: string | null;
  onChange: (id: string) => void;
  exclude: string[];
  sameLabel?: string;
  newName: string;
  onNewName: (name: string) => void;
}) {
  if (!channels) return <Spinner className="min-h-[120px]" />;
  const rows = channels.filter((c) => !exclude.includes(c.id));
  return (
    <div className="flex flex-col gap-3">
      {/* Wide screens: the server's channels on the left, the other ways on the
          right, "or" standing between them. Narrow: stacked, "or" as a line. */}
      <div className="grid gap-4 md:grid-cols-[minmax(0,1.15fr)_auto_minmax(0,1fr)] md:items-stretch">
        {/* The server's channels scroll inside a box of fixed height, so "create a
            new channel" and the Continue button stay on screen however many
            channels the server has. */}
        <div className="flex max-h-[360px] flex-col gap-2 overflow-y-auto overscroll-contain rounded-[16px] bg-bg p-2">
          {rows.length === 0 && <p className="px-3 py-2 text-[14px] text-muted">No channels the bot can post in yet.</p>}
          {rows.map((c) => {
            const off = c.taken || !c.canPost;
            const on = value === c.id;
            return (
              <button
                key={c.id}
                type="button"
                disabled={off}
                onClick={() => onChange(c.id)}
                className={`flex h-12 shrink-0 items-center justify-between gap-3 rounded-[12px] border-[1.5px] px-3.5 text-left transition ${
                  off ? "border-transparent bg-transparent text-faint" : on ? "border-ink bg-surface" : "border-transparent bg-surface hover:border-line"
                }`}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <Radio on={on} off={off} />
                  <span className="flex min-w-0 items-center gap-1 text-[15px] font-bold">
                    <Hash />
                    <span className="truncate">{c.name}</span>
                  </span>
                </span>
                {c.taken ? <Tag>Used by another team</Tag> : !c.canPost ? <Tag>Bot can&rsquo;t post here</Tag> : null}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3 md:flex-col md:py-2">
          <span className="h-px flex-1 bg-line-soft md:h-auto md:w-px" />
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-faint">or</span>
          <span className="h-px flex-1 bg-line-soft md:h-auto md:w-px" />
        </div>

        <div className="flex flex-col gap-3">
          {/* Make one instead. The name is prefilled from the team; the bot creates it at the top of the server, and it can be dragged into a category afterwards. */}
          <div
            className={`flex flex-col gap-3 rounded-[14px] border-[1.5px] px-4 py-4 transition ${
              value === "new" ? "border-ink bg-surface" : "border-line bg-surface hover:border-faint"
            }`}
          >
            <button type="button" onClick={() => onChange("new")} className="flex items-center gap-3 text-left">
              <Radio on={value === "new"} off={false} />
              <span className="text-[15px] font-bold">Create a new channel</span>
            </button>
            {value === "new" && (
              <div className="flex items-center gap-2 pl-[30px]">
                <span className="text-faint">
                  <Hash />
                </span>
                <Input value={newName} onChange={(e) => onNewName(e.target.value)} className="h-11 text-[15px]" placeholder="channel-name" aria-label="New channel name" />
              </div>
            )}
            <p className="pl-[30px] text-[13px] leading-snug text-muted">The bot makes it at the top of the server. Drag it into a category afterwards if you like.</p>
          </div>
          {sameLabel && (
            <button
              type="button"
              onClick={() => onChange("same")}
              className={`flex min-h-[56px] items-center gap-3 rounded-[14px] border-[1.5px] px-4 py-3 text-left transition ${
                value === "same" ? "border-ink bg-surface" : "border-line bg-surface hover:border-faint"
              }`}
            >
              <Radio on={value === "same"} off={false} />
              <span className="text-[15px] font-bold">{sameLabel}</span>
            </button>
          )}
        </div>
      </div>
      <p className="text-[13px] text-muted">
        Only channels the bot can see are listed. Private channel missing? Let the bot into it on Discord first, then come back here.
      </p>
    </div>
  );
}

function Radio({ on, off }: { on: boolean; off: boolean }) {
  return (
    <span
      className={`box-border h-[18px] w-[18px] shrink-0 rounded-full ${on ? "border-[5px] border-ink" : off ? "border-[1.5px] border-line" : "border-[1.5px] border-dot"}`}
    />
  );
}

/** Members or a role. A role can be one the server already has, or one Gather makes and keeps in step with the team. */
/**
 * Who gets pinged. `onCreated` is the setup's hook: making a role is a clear
 * enough answer that the wizard moves on by itself, no extra Continue.
 */
function PingPicker({ team, link, run, onCreated }: { team: MyTeam; link: DiscordState["link"]; run: Run; onCreated?: () => void }) {
  const [roles, setRoles] = useState<PickerRole[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [roleName, setRoleName] = useState(team.name);
  const [made, setMade] = useState<{ name: string; given: number; missing: number } | null>(null);
  const toast = useToast();

  // Moving away from the role the bot made deletes it on the server; say so.
  async function pingTo(mode: "members" | "role", roleId: string | null) {
    const r = await setPing(team.id, mode, roleId);
    setMade(null);
    if (r.removed) toast(`Removed the @${r.removed} role from the server`);
  }
  const mode = link?.ping_mode ?? "members";
  // The role section is open when the team pings a role, or the owner just asked for it.
  const [open, setOpen] = useState(mode === "role");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetchRoles(team.id)
      .then((r) => alive && setRoles(r.roles))
      .catch(() => alive && setRoles([]));
    return () => {
      alive = false;
    };
  }, [team.id, open]);

  const options: DropdownOption<string>[] = (roles ?? []).map((r) => ({
    value: r.id,
    label: `@${r.name}`,
    dot: r.color ? `#${r.color.toString(16).padStart(6, "0")}` : "#a8a49d",
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {/* The pills follow what was clicked, not what is saved: "A role" is only
            saved once a role is chosen, and the pill should not wait for that. */}
        <Pill
          active={!open}
          onClick={() => {
            setOpen(false);
            if (mode !== "members") void run(() => pingTo("members", null));
          }}
        >
          Everyone on the team
        </Pill>
        <Pill active={open} onClick={() => setOpen(true)}>
          A role
        </Pill>
      </div>
      {!open && <p className="text-[13px] text-muted">Pings each member with a Discord account linked. Nothing to set up on Discord.</p>}
      {open && (
        <div className="flex flex-col gap-3">
          {link?.managed_role && link.ping_role_id ? (
            <>
              {made && (
                <p className="flex items-center gap-2 text-[14px] font-bold text-green-ink">
                  <Check size={14} />
                  Created @{made.name} and gave it to {made.given} player{made.given === 1 ? "" : "s"}
                  {made.missing > 0 && <span className="font-semibold text-muted">· {made.missing} not on the server yet</span>}
                </p>
              )}
              <ManagedRole
                team={team}
                current={options.find((o) => o.value === link.ping_role_id)?.label.replace(/^@/, "") ?? made?.name ?? null}
                run={run}
                options={options.filter((o) => o.value !== link.ping_role_id)}
                rolesLoaded={roles !== null}
                onPick={(id) => pingTo("role", id)}
              />
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label>Use a role the server already has</Label>
                <Dropdown
                  value={link?.ping_role_id ?? ""}
                  options={options}
                  disabled={roles === null}
                  placeholder={roles === null ? "Loading roles…" : roles.length === 0 ? "No roles on the server yet" : "Pick a role"}
                  onChange={(id) => run(() => pingTo("role", id))}
                  search={false}
                />
                <p className="text-[13px] text-muted">A role you manage yourself drifts: new players in Gather do not get it unless someone remembers.</p>
              </div>
              <div className="flex flex-col gap-3 rounded-[14px] border-[1.5px] border-green-dim bg-green-soft/50 p-4">
                <div className="flex flex-col">
                  <span className="text-[14px] font-extrabold">Let Gather make a role for the team</span>
                  <span className="text-[13px] text-muted">Join the team, get the role. The bot keeps it in step.</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-bold text-muted">@</span>
                  <Input value={roleName} onChange={(e) => setRoleName(e.target.value)} className="h-10 text-[14px]" placeholder="Role name" aria-label="Role name" />
                  <Button
                    size="sm"
                    className="h-10 shrink-0"
                    disabled={busy || roleName.trim().length < 1}
                    onClick={() => {
                      setBusy(true);
                      let result: { role: { name: string }; given: number; missing: number } | null = null;
                      void run(async () => {
                        result = await createManagedRole(team.id, roleName.trim());
                      })
                        .then((ok) => {
                          if (!ok || !result) return;
                          setMade({ name: result.role.name, given: result.given, missing: result.missing });
                          toast(`Created @${result.role.name} · given to ${result.given} player${result.given === 1 ? "" : "s"}`);
                          onCreated?.();
                        })
                        .finally(() => setBusy(false));
                    }}
                  >
                    {busy ? (
                      "Creating…"
                    ) : onCreated ? (
                      "Create role and continue"
                    ) : (
                      "Create role"
                    )}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The role the bot made. Its name lives here, not in Server Settings, so the owner never has to guess which @Team is ours. */
function ManagedRole({
  team,
  current,
  run,
  options,
  rolesLoaded,
  onPick,
}: {
  team: MyTeam;
  current: string | null;
  run: Run;
  /** The server's other roles, for switching away from the bot's. */
  options: DropdownOption<string>[];
  rolesLoaded: boolean;
  onPick: (roleId: string) => Promise<void>;
}) {
  const [name, setName] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  useEffect(() => {
    if (current !== null) setName(current);
  }, [current]);
  const changed = current !== null && name.trim() !== current && name.trim().length > 0;
  return (
    <div className="flex flex-col gap-2 rounded-xl border-[1.5px] border-line bg-surface p-3">
      <div className="flex items-center justify-between gap-3 px-1">
        <Label>Team role</Label>
        <Tag>Managed by Gather</Tag>
      </div>
      {switching && (
        <div className="flex flex-col gap-1.5 rounded-[12px] bg-bg p-3">
          <Label>Use a role the server already has</Label>
          <Dropdown
            value=""
            options={options}
            disabled={!rolesLoaded}
            placeholder={!rolesLoaded ? "Loading roles…" : options.length === 0 ? "No other roles on the server" : "Pick a role"}
            search={false}
            onChange={(id) => {
              setBusy(true);
              void run(() => onPick(id)).finally(() => {
                setBusy(false);
                setSwitching(false);
              });
            }}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12.5px] text-muted">
              Picking one removes @{current ?? "the team role"} from the server.
            </span>
            <button type="button" onClick={() => setSwitching(false)} className="text-[13px] font-semibold text-muted hover:text-ink">
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="pl-1 text-[15px] font-bold text-muted">@</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-10 text-[14px]" placeholder={current ?? "Loading…"} aria-label="Team role name" />
        <Button
          variant="secondary"
          size="sm"
          className="h-10 shrink-0"
          disabled={!changed || busy}
          onClick={() => {
            setBusy(true);
            void run(async () => {
              await renameManagedRole(team.id, name.trim());
            }, "Role renamed").finally(() => setBusy(false));
          }}
        >
          Rename
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-[12.5px] text-muted">Switching to everyone or to another role removes this role from the server.</p>
        {!switching && (
          <button type="button" disabled={busy} onClick={() => setSwitching(true)} className="text-[13px] font-semibold text-muted underline-offset-2 hover:text-ink hover:underline disabled:opacity-50">
            Use a server role instead
          </button>
        )}
      </div>
    </div>
  );
}

function TestButton({ team, run, onSent }: { team: MyTeam; run: Run; onSent?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          className="h-10"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setResult(null);
            void run(async () => {
              const r = await sendTestMessage(team.id);
              if (r.failed.length) throw new Error(r.failed.map((f) => f.reason).join(" "));
              setResult(`Sent to ${r.sent} channel${r.sent === 1 ? "" : "s"}.`);
              onSent?.();
            }).finally(() => setBusy(false));
          }}
        >
          <ChatIcon />
          {busy ? "Sending…" : "Send a test message"}
        </Button>
        {result && <span className="text-[13px] font-bold text-green-ink">{result}</span>}
      </div>
    </div>
  );
}

// ---------- 3. Connected ----------

/**
 * The connected view. Two columns with names: Settings (what you change) and
 * Activity (what you look at). Health lives in the header as one line and only
 * opens into a card when something needs fixing. Disconnect sits alone at the
 * bottom, out of the way.
 */
function Connected({ team, state, isOwner, run, error, onRerun }: { team: MyTeam; state: DiscordState; isOwner: boolean; run: Run; error: string | null; onRerun: () => void }) {
  const link = state.link!;
  const health = useHealth(team, state, isOwner);
  const problems = health.checks?.filter((c) => !c.ok) ?? [];
  const last = state.log.find((l) => l.kind === "week_post" && l.ok);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4 px-1">
        <div className="flex flex-col gap-1">
          <Eyebrow>Discord</Eyebrow>
          <h2 className="text-[22px] font-extrabold tracking-tight">The bot is on the team</h2>
          <span className="text-[14px] text-muted">
            Connected to <strong className="text-ink">{link.guild_name ?? "Discord"}</strong>
          </span>
        </div>
        {isOwner && <HealthBox health={health} problems={problems.length} />}
      </div>
      <ErrorText>{error}</ErrorText>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:items-stretch">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="px-1">
            <Eyebrow>Settings</Eyebrow>
          </div>
          {isOwner ? (
            <>
              <ChannelsCard team={team} state={state} run={run} onRerun={onRerun} />
              <PingCard team={team} state={state} run={run} />
              {state.schedule && <SendsCard team={team} state={state} run={run} />}
            </>
          ) : (
            <Card>
              <p className="text-[14px] text-muted">Only the owner can change the bot&rsquo;s settings.</p>
            </Card>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="px-1">
            <Eyebrow>Activity</Eyebrow>
          </div>
          {isOwner && (problems.length > 0 || health.failed) && <ProblemsCard health={health} problems={problems} />}
          <LogCard state={state} last={last} isOwner={isOwner} run={run} />
        </div>
      </div>

      {isOwner && <DisconnectCard team={team} state={state} run={run} />}
    </>
  );
}

interface Health {
  checks: StatusCheck[] | null;
  failed: string | null;
  loading: boolean;
  refresh: () => void;
}

/** The health checks, asked of Discord when the tab opens and whenever the settings change. */
function useHealth(team: MyTeam, state: DiscordState, isOwner: boolean): Health {
  const [checks, setChecks] = useState<StatusCheck[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!isOwner) return;
    let alive = true;
    setLoading(true);
    setFailed(null);
    fetchStatus(team.id)
      .then((r) => {
        if (!alive) return;
        setChecks(r.checks);
      })
      .catch((err) => alive && setFailed(explain(err)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [team.id, tick, state.channels, state.link, isOwner]);

  return { checks, failed, loading, refresh: () => setTick((t) => t + 1) };
}

/**
 * The bot's health, as a small box in the header: a dot, the verdict, how many
 * checks passed, and a button to run them again. Green when every check passes,
 * yellow when something needs fixing. The details live in ProblemsCard.
 */
function HealthBox({ health, problems }: { health: Health; problems: number }) {
  const total = health.checks?.length ?? 0;
  const warn = Boolean(health.failed || problems);
  const tone = warn ? "bg-yellow" : health.checks ? "bg-green" : "bg-dot";
  const verdict = health.loading && !health.checks ? "Checking…" : health.failed ? "Could not check" : problems ? `${problems} thing${problems === 1 ? "" : "s"} to fix` : "All good";
  const sub = health.failed ? health.failed : health.checks ? `${total - problems} of ${total} checks pass` : "Asking Discord";
  return (
    <div className={`flex items-center gap-4 rounded-[14px] py-2.5 pl-4 pr-2.5 ring-1 ${warn ? "bg-yellow-soft ring-yellow/60" : "bg-surface ring-line-soft"}`}>
      <span className={`relative flex h-3 w-3 shrink-0 ${health.loading ? "animate-pulse" : ""}`}>
        <span className={`absolute inset-0 rounded-full ${tone}`} />
      </span>
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="text-[14px] font-extrabold">{verdict}</span>
        <span className={`truncate text-[12.5px] ${warn ? "text-yellow-ink" : "text-muted"}`}>{sub}</span>
      </div>
      <Button size="sm" variant="secondary" onClick={health.refresh} disabled={health.loading} className="ml-2">
        {health.loading ? "Checking…" : "Check again"}
      </Button>
    </div>
  );
}

/** Only on screen when a check fails: what is wrong, and what to do about it. */
function ProblemsCard({ health, problems }: { health: Health; problems: StatusCheck[] }) {
  return (
    <Card className="flex flex-col gap-3 border-[1.5px] border-yellow/60 bg-yellow-soft">
      <h3 className="text-[15px] font-extrabold text-yellow-ink">Needs attention</h3>
      {health.failed && <span className="text-[14px] font-semibold text-red-ink">{health.failed}</span>}
      {problems.map((c) => (
        <div key={c.label} className="flex items-start gap-2.5">
          <span className="mt-px flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-yellow text-white">
            <Bang />
          </span>
          <div className="flex flex-col">
            <span className="text-[14px] font-bold">{c.label}</span>
            {c.fix && <span className="text-[13px] text-yellow-ink">{c.fix}</span>}
          </div>
        </div>
      ))}
    </Card>
  );
}

function ChannelsCard({ team, state, run, onRerun }: { team: MyTeam; state: DiscordState; run: Run; onRerun: () => void }) {
  const [picker, setPicker] = useState<PickerChannel[] | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setPicker(null);
    setPickerError(null);
    fetchChannels(team.id)
      .then((r) => alive && setPicker(r.channels))
      .catch((err) => {
        if (!alive) return;
        setPicker([]);
        setPickerError(explain(err));
      });
    return () => {
      alive = false;
    };
  }, [team.id]);

  // Until Discord has answered with the channel list, the saved id is shown as
  // "Loading…" instead of the placeholder. "Pick a channel" on a channel that
  // is picked is a lie the owner acts on. If the list never comes, the saved
  // channel still shows as saved.
  const saved = (kind: ChannelKind): DropdownOption<string>[] => {
    const id = state.channels.find((c) => c.kind === kind)?.channel_id;
    if (!id) return [];
    if (!picker) return [{ value: id, label: "Loading…", disabled: true }];
    if (!picker.some((c) => c.id === id)) return [{ value: id, label: pickerError ? "Saved channel" : "Saved channel (not found on the server)" }];
    return [];
  };
  const opts = (kind: ChannelKind, inherit: string | null): DropdownOption<string>[] => [
    ...(inherit ? [{ value: "", label: inherit }] : []),
    ...saved(kind),
    ...(picker ?? []).map((c) => ({
      value: c.id,
      label: `#${c.name}`,
      disabled: c.taken || !c.canPost || (c.mine !== null && c.mine !== kind),
      hint: c.taken ? "Used by another team" : !c.canPost ? "Bot can't post here" : c.mine && c.mine !== kind ? `Already your ${c.mine === "schedule" ? "week plan" : c.mine} channel` : undefined,
    })),
  ];
  const value = (kind: ChannelKind) => state.channels.find((c) => c.kind === kind)?.channel_id ?? "";
  const nameOf = (id: string | undefined) => (id && picker ? (picker.find((c) => c.id === id)?.name ?? "channel") : "channel");

  return (
    <Card className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-extrabold">Channels</h3>
        <button type="button" onClick={onRerun} className="text-[13px] font-semibold text-muted hover:text-ink">
          Run setup again
        </button>
      </div>
      <Field label="Week plan">
        <Dropdown value={value("schedule")} options={opts("schedule", null)} placeholder="Pick a channel" search={false} onChange={(id) => run(() => setChannel(team.id, "schedule", id), "Saved")} />
      </Field>
      <Field label="Updates">
        <Dropdown
          value={value("updates")}
          options={opts("updates", `Same as the week plan (#${nameOf(effectiveChannel(state.channels, "schedule")?.id)})`)}
          search={false}
          onChange={(id) => run(() => setChannel(team.id, "updates", id || null), "Saved")}
        />
      </Field>
      <Field label="Reminders">
        <Dropdown
          value={value("reminders")}
          options={opts("reminders", `Same as updates (#${nameOf(effectiveChannel(state.channels, "updates")?.id)})`)}
          search={false}
          onChange={(id) => run(() => setChannel(team.id, "reminders", id || null), "Saved")}
        />
      </Field>
      {pickerError && <p className="text-[13px] text-yellow-ink">Could not load the server&rsquo;s channels: {pickerError}</p>}
    </Card>
  );
}

function PingCard({ team, state, run }: { team: MyTeam; state: DiscordState; run: Run }) {
  const link = state.link!;
  const [syncing, setSyncing] = useState(false);
  return (
    <Card className="flex flex-col gap-3.5">
      <h3 className="text-[15px] font-extrabold">Who gets pinged</h3>
      <div className="rounded-[14px] bg-bg p-3.5">
        <PingPicker team={team} link={link} run={run} />
      </div>
      {link.managed_role && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] text-muted">Gather keeps the role in sync with the team. Join the team, get the role.</p>
          <Button
            variant="ghost"
            size="sm"
            disabled={syncing}
            onClick={() => {
              setSyncing(true);
              void run(async () => {
                const r = await syncManagedRole(team.id);
                if (r.missing) throw new Error(`Gave the role to ${r.given}. ${r.missing} on the team are not in the Discord server yet.`);
              }, "Role is in sync").finally(() => setSyncing(false));
            }}
          >
            Sync now
          </Button>
        </div>
      )}
    </Card>
  );
}

const DOW_OPTIONS: DropdownOption<number>[] = DOW_LABELS.map((label, i) => ({ value: i + 1, label }));
const TIME_OPTIONS: DropdownOption<string>[] = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, "0");
  const m = i % 2 ? "30" : "00";
  return { value: `${h}:${m}`, label: `${h}:${m}` };
});
const HOURS_OPTIONS: DropdownOption<number>[] = [0.5, 1, 2, 3, 6, 12, 24].map((h) => ({ value: h, label: h < 1 ? "30 minutes before" : `${h} hour${h === 1 ? "" : "s"} before` }));
const MODE_OPTIONS: DropdownOption<"channel" | "dm" | "both">[] = [
  { value: "channel", label: "Channel" },
  { value: "dm", label: "DM" },
  { value: "both", label: "DM + channel" },
];

function SendsCard({ team, state, run }: { team: MyTeam; state: DiscordState; run: Run }) {
  const s = state.schedule!;
  const save = (patch: Parameters<typeof updateSchedule>[1]) => run(() => updateSchedule(team.id, patch), "Saved");
  return (
    // Last card in the Settings column: it grows to the column's full height so the
    // two columns end together, and the rows share the extra room evenly.
    <Card className="flex flex-1 flex-col gap-2.5">
      <h3 className="text-[15px] font-extrabold">What the bot sends</h3>
      <SendRow title="Week plan" sub="Posted once a week, then kept up to date." on={s.post_enabled} onToggle={(v) => save({ post_enabled: v })}>
        <Dropdown look="pill" value={s.post_dow} options={DOW_OPTIONS} search={false} onChange={(v) => save({ post_dow: v })} />
        <Dropdown look="pill" value={shortTime(s.post_at)} options={TIME_OPTIONS} search={false} onChange={(v) => save({ post_at: v })} />
        <PostNow team={team} />
      </SendRow>
      <SendRow
        title="Nudge for next week"
        sub="To anyone who hasn\u2019t marked a single hour for next week. Once a week, and not at all if everyone has answered."
        on={s.nudge_enabled}
        onToggle={(v) => save({ nudge_enabled: v })}
      >
        <Dropdown look="pill" value={s.nudge_dow} options={DOW_OPTIONS} search={false} onChange={(v) => save({ nudge_dow: v })} />
        <Dropdown look="pill" value={shortTime(s.nudge_at)} options={TIME_OPTIONS} search={false} onChange={(v) => save({ nudge_at: v })} />
        <Dropdown look="pill" value={s.nudge_mode ?? "channel"} options={MODE_OPTIONS} search={false} onChange={(v) => save({ nudge_mode: v })} />
        <NudgeNow team={team} />
      </SendRow>
      <SendRow
        title="New and changed sessions"
        sub="Only for the week that is posted. New sessions ping the team; moves and cancellations ping the people who had said yes."
        on={s.updates_enabled}
        onToggle={(v) => save({ updates_enabled: v })}
      >
        <Dropdown look="pill" value={s.updates_mode ?? "channel"} options={MODE_OPTIONS} search={false} onChange={(v) => save({ updates_mode: v })} />
      </SendRow>
      <SendRow title="Reminder before a session" sub="To the people who said yes, with Still in / Can’t. Sent once; a moved session gets a new one." on={s.same_day_enabled} onToggle={(v) => save({ same_day_enabled: v })}>
        <Dropdown look="pill" value={Number(s.same_day_hours)} options={HOURS_OPTIONS} search={false} onChange={(v) => save({ same_day_hours: v })} />
        <Dropdown look="pill" value={s.same_day_mode} options={MODE_OPTIONS} search={false} onChange={(v) => save({ same_day_mode: v })} />
      </SendRow>
      <p className="mt-auto text-[13px] text-muted">Times are in the team&rsquo;s zone, {team.timezone}.</p>
    </Card>
  );
}

/**
 * Put the week up now rather than waiting for the chosen evening. A real thing
 * a captain does, so it lives with the setting and not among the tests.
 */
function PostNow({ team }: { team: MyTeam }) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  if (said) return <span className="self-center text-[12.5px] font-bold text-green-ink">{said}</span>;
  return (
    <Pill
      disabled={busy}
      onClick={() => {
        setBusy(true);
        postWeekNow(team.id, "this")
          .then((r) => setSaid(r.action === "posted" ? "Posted." : r.action === "edited" ? "Brought up to date." : r.action === "unchanged" ? "Already current." : `Skipped: ${r.detail ?? "nothing to post"}`))
          .catch((err) => setSaid(explain(err)))
          .finally(() => setBusy(false));
      }}
    >
      {busy ? "Posting\u2026" : "Post now"}
    </Pill>
  );
}

/**
 * "Send it now" for the nudge. The real thing, to real people, so it says who
 * it reached; the scheduled one for that week is then skipped.
 */
function NudgeNow({ team }: { team: MyTeam }) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  if (said) return <span className="self-center text-[12.5px] font-bold text-green-ink">{said}</span>;
  return (
    <Pill
      disabled={busy}
      onClick={() => {
        setBusy(true);
        tryAction(team.id, "nudge_now")
          .then((r) => setSaid(`Asked ${r.missing ?? 0} player${r.missing === 1 ? "" : "s"}.`))
          .catch((err) => setSaid(explain(err)))
          .finally(() => setBusy(false));
      }}
    >
      {busy ? "Sending\u2026" : "Send now"}
    </Pill>
  );
}

/** One thing the bot sends, as an inset row: the darker page tone inside the card gives it an edge. */
function SendRow({ title, sub, on, onToggle, children }: { title: string; sub: string; on: boolean; onToggle: (v: boolean) => void; children?: ReactNode }) {
  return (
    <div className={`flex flex-1 items-center gap-4 rounded-[14px] p-3.5 transition ${on ? "bg-bg" : "bg-bg/60"}`}>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <span className={`text-[14px] font-extrabold ${on ? "" : "text-muted"}`}>{title}</span>
          <span className="text-[13px] leading-snug text-muted">{sub}</span>
        </div>
        {children && on && <div className="flex flex-wrap gap-1.5">{children}</div>}
      </div>
      <Toggle on={on} onChange={onToggle} label={title} size="lg" />
    </div>
  );
}

function LogCard({ state, last, isOwner, run }: { state: DiscordState; last: DiscordState["log"][number] | undefined; isOwner: boolean; run: Run }) {
  const failedDm = state.log.find((l) => !l.ok && l.detail);
  return (
    // Last card in the Activity column: grows to the column's full height, and
    // the list scrolls inside it if the log is longer than the room it has.
    <Card className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-extrabold">Recent messages</h3>
        <span className="text-[13px] text-muted">{state.log.length === 0 ? "" : `Last ${state.log.length}`}</span>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-[14px] bg-bg px-3.5 py-3">
        <span className="text-[13px] font-bold">Week plan on Discord</span>
        <span className="text-[13px] text-muted">{last ? `${last.summary}, ${when(last.at)}` : "Not posted yet"}</span>
      </div>
      {state.pending.length > 0 && (
        <div className="flex flex-col gap-2 rounded-[14px] border-[1.5px] border-yellow/60 bg-yellow-soft p-3">
          <div className="flex items-baseline justify-between gap-3 px-0.5">
            <span className="text-[13px] font-extrabold text-yellow-ink">Waiting to send</span>
            <span className="text-[12.5px] text-yellow-ink">A couple of minutes, so quick edits become one message</span>
          </div>
          {state.pending.map((p) => (
            <PendingRow key={p.id} team={state.link!.team_id} row={p} isOwner={isOwner} run={run} />
          ))}
        </div>
      )}
      {state.log.length === 0 ? (
        <p className="text-[13px] text-muted">Nothing sent yet.</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          {state.log.map((l, i) => (
            <div key={l.id} className={`grid grid-cols-[76px_minmax(0,1fr)_auto] items-center gap-3 py-2.5 ${i ? "border-t border-line-soft" : ""}`}>
              <span className="text-[12px] font-extrabold text-muted">{KIND_LABEL[l.kind]}</span>
              <Tip text={l.detail} wide>
                <span className="truncate text-[14px] font-semibold">{l.summary}</span>
              </Tip>
              <span className="flex items-center gap-2 text-[12px] text-muted">
                {when(l.at)}
                <span className={`flex items-center gap-1.5 font-extrabold ${l.ok ? "text-muted" : "text-red-ink"}`}>
                  <span className={`h-2 w-2 rounded-full ${l.ok ? "bg-green" : "bg-red-ink"}`} />
                  {l.ok ? "Sent" : "Failed"}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
      {failedDm && <p className="mt-auto text-[13px] text-red-ink">{failedDm.detail}</p>}
    </Card>
  );
}

/**
 * One change message still in the queue: what it is about, when it goes, and —
 * for the owner — send it now or drop it. Dropping is the only way to take back
 * a message nobody has seen yet.
 */
function PendingRow({ team, row, isOwner, run }: { team: string; row: DiscordPending; isOwner: boolean; run: Run }) {
  const [busy, setBusy] = useState(false);
  const what = row.payload.after ?? row.payload.before;
  const name = what ? (what.opponent ? `${what.title} vs ${what.opponent}` : what.title) : "a session";
  const due = new Date(row.send_after).getTime();
  const act = (action: "outbox_send" | "outbox_cancel") => {
    setBusy(true);
    void run(() => outboxAction(team, row.id, action).then(() => undefined), action === "outbox_send" ? "Sent" : "Cancelled").finally(() => setBusy(false));
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] bg-surface px-3.5 py-2.5">
      <span className="text-[12px] font-extrabold text-muted">{PENDING_LABEL[row.kind]}</span>
      <Tip text={row.last_error} wide>
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{name}</span>
      </Tip>
      <span className="text-[12px] text-muted">{row.last_error ? "Could not send" : due <= Date.now() ? "Any moment now" : `Goes at ${when(row.send_after)}`}</span>
      {isOwner && (
        <span className="flex gap-1.5">
          <Pill disabled={busy} onClick={() => act("outbox_send")}>
            Send now
          </Pill>
          <Pill disabled={busy} onClick={() => act("outbox_cancel")}>
            Cancel
          </Pill>
        </span>
      )}
    </div>
  );
}

const PENDING_LABEL: Record<DiscordPending["kind"], string> = {
  new: "New",
  changed: "Changed",
  cancelled: "Cancelled",
};

const KIND_LABEL: Record<DiscordState["log"][number]["kind"], string> = {
  week_post: "Week plan",
  update: "Update",
  reminder: "Reminder",
  nudge: "Nudge",
  test: "Test",
  link: "Setup",
};

function DisconnectCard({ team, state, run }: { team: MyTeam; state: DiscordState; run: Run }) {
  const [arm, setArm] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Card className="flex flex-col gap-3 border-[1.5px] border-red-line bg-transparent shadow-none">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-[14px] font-extrabold">Disconnect</span>
          <span className="text-[13px] text-muted">
            Stops all messages{state.link?.managed_role ? " and removes the team role" : ""}. Your channels stay. The bot leaves the server only if no other team uses it there.
          </span>
        </div>
        {!arm ? (
          <Button variant="danger" size="sm" className="h-10 shrink-0" onClick={() => setArm(true)}>
            Disconnect
          </Button>
        ) : (
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" size="sm" onClick={() => setArm(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              size="sm"
              className="h-10"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void run(async () => {
                  const r = await disconnectDiscord(team.id);
                  // The bot leaves only when this was the last team on the server.
                  if (r.leaveError) throw new Error(`Disconnected, but the bot could not leave the server: ${r.leaveError}. It will try again on its own.`);
                  toast(r.left ? "Disconnected. The bot has left the server." : r.remaining > 0 ? `Disconnected. The bot stays for ${r.remaining} other team${r.remaining === 1 ? "" : "s"} on the server.` : "Disconnected.");
                }).finally(() => setBusy(false));
              }}
            >
              Yes, disconnect
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------- bits ----------

function Intro({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-1">
      <Eyebrow>Discord</Eyebrow>
      <h2 className="text-[22px] font-extrabold tracking-tight">{title}</h2>
      <p className="max-w-[62ch] text-[14px] leading-relaxed text-muted">{children}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return <span className="shrink-0 rounded-full bg-surface-2 px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted">{children}</span>;
}

function when(iso: string): string {
  const d = new Date(iso);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  return `${day} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function Hash() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="text-faint">
      <path d="M10 3 8 21M16 3l-2 18M4 9h17M3 15h17" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-5 4v-4A2.5 2.5 0 0 1 4 14.5z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="10" width="16" height="11" rx="3" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function Bang() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
      <path d="M12 7v6M12 16.5v.5" />
    </svg>
  );
}

function Arrow({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === "left" ? "M19 12H5M11 6l-6 6 6 6" : "M5 12h14M13 6l6 6-6 6"} />
    </svg>
  );
}
