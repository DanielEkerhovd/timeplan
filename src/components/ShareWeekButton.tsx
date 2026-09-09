import { useSearchParams } from "react-router-dom";
import { shareLink } from "../lib/share";
import type { MyTeam } from "../lib/teams";
import { weekId, weekStartFromId } from "../lib/week";
import { useToast } from "./ui";

/** Copies the link for the week you are looking at, ready to paste on Discord. */
export function useCopyWeekLink(team: MyTeam) {
  const [params] = useSearchParams();
  const toast = useToast();
  return async function copyWeekLink() {
    if (!team.share_enabled) {
      // Bare eieren kan slå den på, og bare eier og admin ser Settings i det
      // hele tatt. Da skal ikke alle andre sendes dit.
      toast(
        team.role === "owner"
          ? "Turn on sharing in Settings first"
          : "Sharing is off · ask the owner to turn it on",
      );
      return;
    }
    const link = shareLink(
      team.share_slug,
      weekId(weekStartFromId(params.get("week"))),
    );
    try {
      await navigator.clipboard.writeText(link);
      toast("Link copied · paste it on Discord");
    } catch {
      window.prompt("Copy this link", link);
    }
  };
}

/** Full-width bar, pinned to the bottom of the right-hand column on desktop. */
export default function ShareWeekButton({
  team,
  className = "",
}: {
  team: MyTeam;
  className?: string;
}) {
  const copy = useCopyWeekLink(team);
  return (
    <button
      onClick={() => void copy()}
      title={
        team.share_enabled
          ? "Copy the link for this week"
          : team.role === "owner"
            ? "Sharing is off · turn it on in Settings"
            : "Sharing is off · only the owner can turn it on"
      }
      className={`flex h-11 w-full shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-ink px-3 text-[13px] font-bold text-on-ink hover:opacity-90 ${className}`}
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
        <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
        <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
      </svg>
      Share week on Discord
    </button>
  );
}
