import type { Attendee } from "@cathrin/shared-types";
import { Check, X, HelpCircle, Circle } from "lucide-solid";

const RESPONSE_STATUS_ORDER: Record<string, number> = {
  accepted: 0,
  tentative: 1,
  needsAction: 2,
  declined: 3,
};

export const STATUS_LABELS: Record<string, string> = {
  accepted: "Accepted",
  declined: "Declined",
  tentative: "Maybe",
  needsAction: "No response",
};

export function sortAttendees(attendees: Attendee[]): Attendee[] {
  return [...attendees].sort((a, b) => {
    // Organizer first (even if self)
    if (a.isOrganizer && !b.isOrganizer) return -1;
    if (!a.isOrganizer && b.isOrganizer) return 1;
    // Non-organizer self last
    if (a.isSelf && !b.isSelf) return 1;
    if (!a.isSelf && b.isSelf) return -1;
    // Then by response status
    const aOrder = RESPONSE_STATUS_ORDER[a.responseStatus] ?? 4;
    const bOrder = RESPONSE_STATUS_ORDER[b.responseStatus] ?? 4;
    return aOrder - bOrder;
  });
}

export function ResponseStatusIcon(props: { status: Attendee["responseStatus"] }) {
  switch (props.status) {
    case "accepted":
      return (
        <span class="text-green-600" aria-hidden="true">
          <Check size={12} />
        </span>
      );
    case "declined":
      return (
        <span class="text-red-500" aria-hidden="true">
          <X size={12} />
        </span>
      );
    case "tentative":
      return (
        <span class="text-amber-500" aria-hidden="true">
          <HelpCircle size={12} />
        </span>
      );
    default:
      return (
        <span class="text-fg-disabled" aria-hidden="true">
          <Circle size={12} />
        </span>
      );
  }
}
