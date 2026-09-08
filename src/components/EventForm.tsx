import { useMemo, useState } from "react";
import { palette } from "../lib/colors";
import {
  createEvent,
  deleteEvent,
  eventLabel,
  overlaps,
  updateEvent,
  type EventInput,
  type EventWithResponses,
} from "../lib/events";
import {
  activityColors,
  friendlyError,
  type ActivityColor,
  type ActivityType,
} from "../lib/types";
import { slotLabel } from "../lib/week";
import { Button, CloseButton, ErrorText, Input, Label, Modal } from "./ui";
import { DatePicker, Dropdown, hourOptions } from "./pickers";

export interface EventDraft {
  date: string;
  start_hour: number;
  end_hour: number;
}

interface Props {
  teamId: string;
  types: ActivityType[];
  /** Other activities in the week, for the overlap warning. */
  events: EventWithResponses[];
  existing: EventWithResponses | null;
  draft: EventDraft;
  onClose: () => void;
  onSaved: () => void;
}

const CUSTOM = "custom";

/** Book, edit or delete one activity. The type is the title; Custom has its own title and colour. */
export default function EventForm({
  teamId,
  types,
  events,
  existing,
  draft,
  onClose,
  onSaved,
}: Props) {
  const [date, setDate] = useState(draft.date);
  const [start, setStart] = useState(draft.start_hour);
  const [end, setEnd] = useState(draft.end_hour);
  const [what, setWhat] = useState<string>(
    existing ? (existing.type_id ?? CUSTOM) : (types[0]?.id ?? CUSTOM),
  );
  const [opponent, setOpponent] = useState(existing?.opponent ?? "");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [color, setColor] = useState<ActivityColor>(existing?.color ?? "blue");
  const [confirmOverlap, setConfirmOverlap] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const type = types.find((t) => t.id === what) ?? null;
  const isCustom = what === CUSTOM;
  const previewColor = isCustom ? color : (type?.color ?? "grey");
  const previewTitle = isCustom
    ? title.trim() || "Custom event"
    : (type?.name ?? "");
  const previewLabel =
    opponent.trim() && type?.ask_opponent
      ? `${previewTitle} · ${opponent.trim()}`
      : previewTitle;

  const clashes = useMemo(
    () =>
      events.filter(
        (e) =>
          e.id !== existing?.id &&
          overlaps({ date, start_hour: start, end_hour: end }, e),
      ),
    [events, existing?.id, date, start, end],
  );

  function pickType(id: string) {
    setWhat(id);
    setConfirmOverlap(false);
    const t = types.find((x) => x.id === id);
    if (t) setEnd(Math.min(24, start + t.default_hours));
  }

  function setStartHour(h: number) {
    const length = end - start;
    setStart(h);
    setEnd(Math.min(24, h + Math.max(1, length)));
    setConfirmOverlap(false);
  }

  async function submit() {
    if (end <= start)
      return setError("The activity has to end after it starts.");
    if (isCustom && title.trim().length === 0)
      return setError("Give the activity a title.");
    if (clashes.length > 0 && !confirmOverlap) return setConfirmOverlap(true);
    setBusy(true);
    setError(null);
    const input: EventInput = {
      date,
      start_hour: start,
      end_hour: end,
      type_id: isCustom ? null : what,
      title: isCustom ? title.trim().slice(0, 80) : null,
      color: isCustom ? color : null,
      opponent:
        type?.ask_opponent && opponent.trim()
          ? opponent.trim().slice(0, 60)
          : null,
      note: existing?.note ?? null,
    };
    try {
      if (existing) await updateEvent(existing.id, input);
      else await createEvent(teamId, input);
      onSaved();
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteEvent(existing!.id);
      onSaved();
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex items-start justify-between">
          <div className="flex flex-col">
            <h2 className="text-lg font-extrabold">
              {existing ? "Edit activity" : "New activity"}
            </h2>
            <div className="flex items-center gap-1.5 text-sm text-muted">
              Shows as:
              <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
                <span
                  className="h-[9px] w-[9px] rounded-full"
                  style={{ background: palette[previewColor].accent }}
                />
                {previewLabel}
              </span>
            </div>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        <div className="grid grid-cols-[1.5fr_1fr_1fr] gap-2">
          <div className="flex flex-col gap-1.5">
            <Label>Date</Label>
            <DatePicker
              value={date}
              onChange={(key) => {
                setDate(key);
                setConfirmOverlap(false);
              }}
              className="text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>From</Label>
            <Dropdown
              value={start}
              options={hourOptions(0, 23)}
              onChange={setStartHour}
              className="pl-3 text-sm"
              aria-label="From"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>To</Label>
            <Dropdown
              value={end}
              options={hourOptions(start + 1, 24)}
              onChange={(h) => {
                setEnd(h);
                setConfirmOverlap(false);
              }}
              className="pl-3 text-sm"
              aria-label="To"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>What</Label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {types.map((t) => {
              const on = what === t.id;
              const p = palette[t.color];
              return (
                <button
                  type="button"
                  key={t.id}
                  onClick={() => pickType(t.id)}
                  aria-pressed={on}
                  className="flex h-10 items-center justify-center gap-[6px] truncate rounded-xl border-[1.5px] px-1.5 text-[12.5px] font-bold transition"
                  style={
                    on
                      ? {
                          background: p.soft,
                          borderColor: p.accent,
                          color: p.ink,
                        }
                      : { borderColor: "var(--color-line)", color: "var(--color-muted)" }
                  }
                >
                  <span
                    className="h-[9px] w-[9px] shrink-0 rounded-full"
                    style={{ background: p.accent }}
                  />
                  <span className="truncate">{t.name}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setWhat(CUSTOM);
                setConfirmOverlap(false);
              }}
              aria-pressed={isCustom}
              className={`flex h-10 items-center justify-center gap-[7px] rounded-xl border-[1.5px] text-[13px] font-bold transition ${
                isCustom
                  ? "border-ink bg-surface-2 text-ink"
                  : "border-line text-muted"
              }`}
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              Custom
            </button>
          </div>
        </div>

        {type?.ask_opponent && (
          <div className="flex flex-col gap-1.5">
            <Label>Opponent</Label>
            <Input
              value={opponent}
              onChange={(e) => setOpponent(e.target.value)}
              placeholder="Who are you playing?"
              maxLength={60}
            />
          </div>
        )}

        {isCustom && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Title</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Flex 5v5 night, Clash …"
                maxLength={80}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Colour</Label>
              <div className="flex flex-wrap gap-2">
                {activityColors.map((c) => (
                  <button
                    type="button"
                    key={c}
                    onClick={() => setColor(c)}
                    aria-label={palette[c].label}
                    aria-pressed={color === c}
                    className="h-7 w-7 rounded-full transition"
                    style={{
                      background: palette[c].accent,
                      boxShadow:
                        color === c
                          ? "0 0 0 2px var(--color-surface), 0 0 0 4px var(--color-ink)"
                          : "none",
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {confirmOverlap && clashes.length > 0 && (
          <div className="flex flex-col gap-1 rounded-xl bg-yellow-soft px-4 py-3 text-[13px] text-yellow-ink">
            <div className="font-extrabold">
              Overlaps{" "}
              {clashes
                .map(
                  (c) =>
                    `${eventLabel(c, types)} (${slotLabel(c.start_hour, c.end_hour)})`,
                )
                .join(", ")}
            </div>
            <div>Players can join both. Book anyway?</div>
          </div>
        )}

        <ErrorText>{error}</ErrorText>

        <div className="flex items-center gap-2 pt-1">
          {existing &&
            (confirmDelete ? (
              <Button
                type="button"
                variant="danger"
                onClick={() => void remove()}
                disabled={busy}
              >
                Yes, delete
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
              >
                Delete
              </Button>
            ))}
          <div className="flex-1" />
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {confirmOverlap ? "Book anyway" : existing ? "Save" : "Book it"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
