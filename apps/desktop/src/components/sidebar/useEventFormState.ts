import { createSignal, createMemo, createEffect, on, onCleanup, batch } from "solid-js";
import { createListCollection } from "@ark-ui/solid/select";
import {
  isCreating,
  draftStart,
  draftEnd,
  setDraftStart,
  setDraftEnd,
  draftTitle,
  setDraftTitle,
  draftCalendarId,
  setDraftCalendarId,
  draftIsAllDay,
  setDraftIsAllDay,
  draftLocation,
  setDraftLocation,
  draftDescription,
  setDraftDescription,
  draftTransparency,
  setDraftTransparency,
  draftVisibility,
  setDraftVisibility,
  draftReminders,
  setDraftReminders,
  draftColorId,
  setDraftColorId,
  draftConferencing,
  setDraftConferencing,
  draftTimeZone,
  setDraftTimeZone,
  draftAttendees,
  setDraftAttendees,
  getDraftColor,
  shadowStart,
  setShadowStart,
  shadowEnd,
  setShadowEnd,
} from "../../stores/event-creation";
import { CATHRIN_PALETTE } from "../../lib/color-mapping";
import type { CathrinColorKey } from "../../lib/color-mapping";
import { selectedEvent, selectedEventId, deselectEvent } from "../../stores/event-selection";
import { updateEvent, setEvents, events, moveEvent } from "../../stores/events";
import { dragActiveEventId } from "../../stores/event-drag";
import type { EventPatch } from "../../stores/event-types";
import { apiFetch } from "../../lib/api";
import type { ApiCalendarEvent, Attendee } from "@cathrin/shared-types";
import { connectedAccounts } from "../../stores/accounts";
import { startBuffering, isBuffered, getOriginalAttendees, clearBuffer } from "../../stores/buffered-attendees";
import { addPendingNotification } from "../../stores/pending-notifications";
import { parseTimeInput, reinterpretInTimezone, setTimeInTimezone } from "../../lib/format-utils";
import { SYSTEM_TIMEZONE } from "../../constants/calendar";

export type FormMode = "create" | "edit";

type FieldGroup = "time" | "identity" | "attendees" | "content" | "preferences" | "conferencing";

const FIELD_GROUPS: Record<string, FieldGroup> = {
  start: "time", end: "time", isAllDay: "time", timeZone: "time",
  calendarId: "identity",
  title: "content", location: "content", description: "content",
  attendees: "attendees",
  transparency: "preferences", visibility: "preferences", reminders: "preferences", colorId: "preferences",
  conferencing: "conferencing",
};

export function useEventFormState() {
  // Remember timed start/end when switching to all-day so we can restore them
  let savedTimedStart: Date | null = null;
  let savedTimedEnd: Date | null = null;


  // Edit mode: local signals for editing fields
  const [editTitle, setEditTitle] = createSignal("");
  const [editStart, setEditStart] = createSignal<Date | null>(null);
  const [editEnd, setEditEnd] = createSignal<Date | null>(null);
  const [editLocation, setEditLocation] = createSignal("");
  const [editDescription, setEditDescription] = createSignal("");
  const [editIsAllDay, setEditIsAllDay] = createSignal(false);
  const [editCalendarId, setEditCalendarId] = createSignal<string | null>(null);
  const [editTransparency, setEditTransparency] = createSignal<"opaque" | "transparent">("opaque");
  const [editVisibility, setEditVisibility] = createSignal<"default" | "public" | "private">("default");
  const [editReminders, setEditReminders] = createSignal<{ method: "popup"; minutes: number }[]>([]);
  const [editColorId, setEditColorId] = createSignal<CathrinColorKey | null>(null);
  const [editConferencing, setEditConferencing] = createSignal<{ uri: string; label?: string } | null>(null);
  const [editTimeZone, setEditTimeZone] = createSignal<string | undefined>(undefined);
  const [editAttendees, setEditAttendees] = createSignal<Attendee[]>([]);
  const [conferencingLoading, setConferencingLoading] = createSignal(false);

  const mode = createMemo<FormMode>(() => isCreating() ? "create" : "edit");

  // ===========================================================================
  // Autosave infrastructure (edit mode only)
  //
  // The EventForm lives inside <Show when={selectedEventId()}>. When the
  // signal becomes null, Show disposes children (and their effects) BEFORE
  // those effects can react. So the deselection effect below may never fire.
  // We track the active event ID in a plain variable so onCleanup can always
  // flush pending changes even after the signal is null.
  // ===========================================================================
  let pendingPatch: EventPatch = {};
  /** Original values captured before the first pre-mutation of each field. */
  let pendingRollback: EventPatch = {};
  /** Debounce timer for reminder add/remove so rapid changes batch into one PATCH. */
  let reminderFlushTimer: ReturnType<typeof setTimeout> | null = null;
  /** Last selected event ID — survives signal disposal for onCleanup. */
  let activeEditEventId: string | null = null;

  /** Accumulate a field change. Flushed on blur via flushSave(). */
  function scheduleSave(patch: EventPatch): void {
    Object.assign(pendingPatch, patch);
  }

  /** Check if any field in a group has a pending edit. */
  function isGroupDirty(group: FieldGroup): boolean {
    return Object.keys(pendingPatch).some((key) => FIELD_GROUPS[key] === group);
  }

  function flushSave(overrideEventId?: string): void {
    const eventId = overrideEventId ?? activeEditEventId ?? selectedEventId();
    if (!eventId || Object.keys(pendingPatch).length === 0) return;

    const patchToSend = { ...pendingPatch };
    const rollback = Object.keys(pendingRollback).length > 0 ? { ...pendingRollback } : undefined;
    pendingPatch = {};
    pendingRollback = {};
    updateEvent(eventId, patchToSend, rollback).catch((err) =>
      console.error("Failed to save event update:", err)
    );
  }

  // Flush pending save when deselecting (sidebar closes).
  // Note: this effect may be disposed by <Show> before it runs. onCleanup
  // below is the guaranteed fallback using activeEditEventId.
  createEffect(on(selectedEventId, (id, prevId) => {
    if (!id && prevId) {
      if (reminderFlushTimer) { clearTimeout(reminderFlushTimer); reminderFlushTimer = null; }
      flushBufferedAttendees(prevId);
      flushSave(prevId);
    }
  }));

  // Flush on unmount — uses activeEditEventId since selectedEventId() is
  // already null by the time <Show> disposes this component.
  onCleanup(() => {
    if (reminderFlushTimer) { clearTimeout(reminderFlushTimer); reminderFlushTimer = null; }
    if (activeEditEventId) flushBufferedAttendees(activeEditEventId);
    flushSave();
  });

  // Populate edit signals when a *different* event is selected.
  // Track selectedEventId (a primitive) instead of selectedEvent (an object
  // whose reference changes on every setEvents call). This prevents the effect
  // from re-running during live chip updates (e.g. title keystroke → setEvents
  // → new selectedEvent ref → effect would clear pendingPatch mid-edit).
  // events() is read inside the callback which runs in untrack(), so it does
  // not become a dependency.
  createEffect(on(selectedEventId, (id, prevId) => {
    if (!id) return;
    // Flush pending saves for the previous event before switching
    if (prevId && prevId !== id) {
      if (reminderFlushTimer) { clearTimeout(reminderFlushTimer); reminderFlushTimer = null; }
      flushBufferedAttendees(prevId);
      flushSave(prevId);
    }
    activeEditEventId = id;
    const event = events().find((e) => e.id === id);
    if (!event) return;
    pendingPatch = {};
    pendingRollback = {};

    setEditTitle(event.title);
    setEditStart(new Date(event.start));
    setEditEnd(new Date(event.end));
    setEditLocation(event.location ?? "");
    setEditDescription(event.description ?? "");
    setEditIsAllDay(event.isAllDay);
    setEditCalendarId(event.calendarId);
    setEditTransparency(event.transparency ?? "opaque");
    setEditVisibility(event.visibility ?? "default");
    setEditReminders(event.reminders ?? []);
    setEditColorId(event.colorId ?? null);
    setEditConferencing(event.conferencing ?? null);
    setEditTimeZone(event.timeZone);
    setEditAttendees(event.attendees ?? []);
    setConferencingLoading(false);
    savedTimedStart = null;
    savedTimedEnd = null;
  }));

  // Unified sync: push external store changes into form signals, grouped by field.
  // Each group is skipped when the user has pending local edits in that group,
  // preventing external updates from clobbering in-flight user changes.
  // Also handles structural changes (event deleted from store while sidebar open).
  createEffect(() => {
    if (mode() !== "edit") return;
    const id = selectedEventId();
    if (!id) return;
    const event = events().find((e) => e.id === id);
    if (!event) {
      // Event vanished (external deletion, uninvited). Flush pending edits
      // (PATCH will 404 — caught by .catch) and close the sidebar.
      flushSave();
      deselectEvent();
      return;
    }

    const isDragging = dragActiveEventId() === id;

    // Time group: during drag, always sync start/end (drag handler writes to store).
    // Otherwise skip if user has pending time edits.
    if (isDragging || !isGroupDirty("time")) {
      const newStart = new Date(event.start);
      const newEnd = new Date(event.end);
      setEditStart(newStart);
      setEditEnd(newEnd);
      if (!isDragging) {
        setEditIsAllDay(event.isAllDay);
        setEditTimeZone(event.timeZone);
        // Auto-adjust if end <= start (e.g. external change created invalid range)
        if (newEnd <= newStart) {
          setEditEnd(new Date(newStart.getTime() + 3600000));
        }
      }
    }

    // Identity group
    if (!isGroupDirty("identity")) {
      setEditCalendarId(event.calendarId);
    }

    // Content group
    if (!isGroupDirty("content")) {
      setEditTitle(event.title);
      setEditLocation(event.location ?? "");
      setEditDescription(event.description ?? "");
    }

    // Attendees group: skip if dirty or buffered changes
    if (!isGroupDirty("attendees") && !(id && isBuffered(id))) {
      setEditAttendees(event.attendees ?? []);
    }

    // Preferences group
    if (!isGroupDirty("preferences")) {
      setEditTransparency(event.transparency ?? "opaque");
      setEditVisibility(event.visibility ?? "default");
      setEditReminders(event.reminders ?? []);
      setEditColorId(event.colorId ?? null);
    }

    // Conferencing group: skip if dirty or loading
    if (!isGroupDirty("conferencing") && !conferencingLoading()) {
      setEditConferencing(event.conferencing ?? null);
    }
  });

  // Unified accessors — read from the right signal based on mode
  // In edit mode, setters also schedule an autosave
  const title = () => mode() === "create" ? draftTitle() : editTitle();
  const setTitle = (v: string) => {
    if (mode() === "create") { setDraftTitle(v); }
    else {
      // Capture original title before first pre-mutation for rollback
      if (pendingRollback.title === undefined) {
        const event = selectedEvent();
        if (event) pendingRollback.title = event.title;
      }
      setEditTitle(v);
      // Live-update the chip title on the calendar grid
      const eventId = selectedEventId();
      if (eventId) {
        setEvents((prev) => prev.map((e) => e.id === eventId ? { ...e, title: v } : e));
      }
      scheduleSave({ title: v });
    }
  };
  const start = () => mode() === "create" ? draftStart() : editStart();
  const setStart = (v: Date) => {
    if (mode() === "create") { setDraftStart(v); }
    else { setEditStart(v); scheduleSave({ start: v }); }
  };
  const end = () => mode() === "create" ? draftEnd() : editEnd();
  const setEnd = (v: Date) => {
    if (mode() === "create") { setDraftEnd(v); }
    else { setEditEnd(v); scheduleSave({ end: v }); }
  };
  const location = () => mode() === "create" ? draftLocation() : editLocation();
  const setLocation = (v: string) => {
    if (mode() === "create") { setDraftLocation(v); }
    else { setEditLocation(v); scheduleSave({ location: v }); }
  };
  const description = () => mode() === "create" ? draftDescription() : editDescription();
  const setDescription = (v: string) => {
    if (mode() === "create") { setDraftDescription(v); }
    else { setEditDescription(v); scheduleSave({ description: v }); }
  };
  const isAllDay = () => mode() === "create" ? draftIsAllDay() : editIsAllDay();
  const setIsAllDay = (v: boolean) => {
    if (mode() === "create") { setDraftIsAllDay(v); return; }
    setEditIsAllDay(v);
  };
  const calendarId = () => mode() === "create" ? draftCalendarId() : editCalendarId();
  const setCalId = (v: string | null) => {
    if (mode() === "create") {
      setDraftCalendarId(v);
      return;
    }
    // Edit mode: trigger a move operation (separate from autosave)
    const eventId = selectedEventId();
    const currentCalId = editCalendarId();
    if (!eventId || !v || v === currentCalId) return;

    // Find target calendar color
    let targetColor = CATHRIN_PALETTE.graphite;
    for (const acc of connectedAccounts()) {
      const cal = acc.calendars.find((c) => c.id === v);
      if (cal) { targetColor = cal.color; break; }
    }

    setEditCalendarId(v);
    moveEvent(eventId, v, targetColor).catch((err) => {
      console.error("[move] Failed to move event:", err);
      // Rollback the local signal on failure (store already rolls back events signal)
      setEditCalendarId(currentCalId);
    });
  };

  const transparency = () => mode() === "create" ? draftTransparency() : editTransparency();
  const setTransparency = (v: "opaque" | "transparent") => {
    if (mode() === "create") { setDraftTransparency(v); }
    else { setEditTransparency(v); scheduleSave({ transparency: v }); flushSave(); }
  };
  const visibility = () => mode() === "create" ? draftVisibility() : editVisibility();
  const setVisibility = (v: "default" | "public" | "private") => {
    if (mode() === "create") { setDraftVisibility(v); }
    else { setEditVisibility(v); scheduleSave({ visibility: v }); flushSave(); }
  };

  const colorId = (): CathrinColorKey | null => mode() === "create" ? (draftColorId() as CathrinColorKey | null) : editColorId();
  const setColorId = (v: CathrinColorKey | null) => {
    if (mode() === "create") { setDraftColorId(v); }
    else {
      setEditColorId(v);
      // Live-update the chip color on the calendar grid
      const eventId = selectedEventId();
      if (eventId) {
        let newColor: string;
        if (v && CATHRIN_PALETTE[v]) {
          newColor = CATHRIN_PALETTE[v];
        } else {
          // Reset to calendar default: look up from accounts
          const calId = editCalendarId();
          newColor = CATHRIN_PALETTE.graphite;
          if (calId) {
            for (const acc of connectedAccounts()) {
              const cal = acc.calendars.find((c) => c.id === calId);
              if (cal) { newColor = cal.color; break; }
            }
          }
        }
        setEvents((prev) => prev.map((e) => e.id === eventId ? { ...e, color: newColor, colorId: v ?? undefined } : e));
      }
      scheduleSave({ colorId: v }); flushSave();
    }
  };

  const reminders = () => mode() === "create" ? draftReminders() : editReminders();
  function flushRemindersDebounced(): void {
    if (reminderFlushTimer) clearTimeout(reminderFlushTimer);
    reminderFlushTimer = setTimeout(() => {
      reminderFlushTimer = null;
      flushSave();
    }, 300);
  }
  const addReminder = (minutes: number) => {
    const current = reminders();
    if (current.length >= 5 || current.some((r) => r.minutes === minutes)) return;
    const updated = [...current, { method: "popup" as const, minutes }];
    if (mode() === "create") { setDraftReminders(updated); }
    else { setEditReminders(updated); scheduleSave({ reminders: updated }); flushRemindersDebounced(); }
  };
  const removeReminder = (minutes: number) => {
    const updated = reminders().filter((r) => r.minutes !== minutes);
    if (mode() === "create") { setDraftReminders(updated); }
    else { setEditReminders(updated); scheduleSave({ reminders: updated.length > 0 ? updated : null }); flushRemindersDebounced(); }
  };

  const conferencing = () => mode() === "create" ? draftConferencing() : editConferencing();

  const attendees = () => mode() === "create" ? (draftAttendees().length > 0 ? draftAttendees() : undefined) : (editAttendees().length > 0 ? editAttendees() : undefined);

  /** Whether the current user is the organizer (can add/remove attendees) */
  const isOrganizer = createMemo(() => {
    if (mode() === "create") return true;
    const event = selectedEvent();
    if (!event) return false;
    if (event.isReadOnly) return false;
    // If there are attendees, check if self is the organizer
    const self = event.attendees?.find(a => a.isSelf);
    if (self) return !!self.isOrganizer;
    // No attendees yet — user owns this event
    return true;
  });

  // All writable visible calendars for the selector
  // (must be declared before accountEmail which references it)
  const allCalendars = createMemo(() => {
    return connectedAccounts()
      .flatMap((a) =>
        a.calendars
          .filter((c) => c.visible && c.accessRole !== "reader" && c.accessRole !== "freeBusyReader")
          .map((c) => ({ ...c, accountEmail: a.email }))
      );
  });

  // The email of the account that owns the current calendar
  const accountEmail = createMemo(() => {
    const calId = calendarId();
    if (!calId) return null;
    const cal = allCalendars().find((c) => c.id === calId);
    return cal?.accountEmail?.toLowerCase() ?? null;
  });

  /** Compare two attendee lists by email (case-insensitive) to detect net-zero changes. */
  function attendeeSetsEqual(a: Attendee[], b: Attendee[]): boolean {
    const aEmails = new Set(a.map(att => att.email.toLowerCase()));
    const bEmails = new Set(b.map(att => att.email.toLowerCase()));
    if (aEmails.size !== bEmails.size) return false;
    for (const email of aEmails) {
      if (!bEmails.has(email)) return false;
    }
    return true;
  }

  /** After each attendee add/remove, check if changes cancel out (net-zero). */
  function checkNetZero(eventId: string, currentAttendees: Attendee[]): void {
    const original = getOriginalAttendees(eventId);
    if (!original) return;
    if (attendeeSetsEqual(original, currentAttendees)) {
      clearBuffer(eventId);
    }
  }

  /**
   * Mark buffered attendee changes as pending notification when navigating away.
   * Does NOT sync to server — attendee changes stay local-only until the user
   * explicitly confirms (send invite/cancellation) or discards via the popover.
   * The buffer is kept alive so the popover reappears when the user returns.
   */
  function flushBufferedAttendees(eventId: string): void {
    if (!isBuffered(eventId)) return;
    addPendingNotification(eventId);
  }

  function addAttendee(email: string, name?: string): void {
    const current = mode() === "create" ? draftAttendees() : editAttendees();
    if (current.some(a => a.email.toLowerCase() === email.toLowerCase())) return;
    const isSelf = accountEmail() === email.toLowerCase();
    const newAttendee: Attendee = {
      email,
      name,
      responseStatus: isSelf ? "accepted" : "needsAction",
      ...(isSelf && { isOrganizer: true, isSelf: true }),
    };
    const updated = [...current, newAttendee];
    if (mode() === "create") {
      setDraftAttendees(updated);
    } else {
      const eventId = selectedEventId();
      if (eventId) {
        const event = events().find(e => e.id === eventId);
        if (event) startBuffering(eventId, event.attendees ?? []);
      }
      setEditAttendees(updated);
      setEvents((prev) => prev.map((e) => e.id === selectedEventId() ? { ...e, attendees: updated } : e));
      if (eventId) checkNetZero(eventId, updated);
    }
  }

  function removeAttendee(email: string): void {
    const current = mode() === "create" ? draftAttendees() : editAttendees();
    const updated = current.filter(a => a.email.toLowerCase() !== email.toLowerCase());
    if (mode() === "create") {
      setDraftAttendees(updated);
    } else {
      const eventId = selectedEventId();
      if (eventId) {
        const event = events().find(e => e.id === eventId);
        if (event) startBuffering(eventId, event.attendees ?? []);
      }
      setEditAttendees(updated);
      setEvents((prev) => prev.map((e) => e.id === selectedEventId() ? { ...e, attendees: updated.length > 0 ? updated : undefined } : e));
      if (eventId) checkNetZero(eventId, updated);
    }
  }

  /** RSVP: optimistic update + immediate API call. Popover confirms the action. */
  function rsvpAttendee(responseStatus: Attendee["responseStatus"], sendUpdates: "all" | "none" = "none"): void {
    const eventId = selectedEventId();
    if (!eventId) return;
    const event = events().find((e) => e.id === eventId);
    if (!event?.attendees) return;

    const original = event.attendees;

    // Optimistic: update both local form signal and global events signal
    const updated = editAttendees().map(a => a.isSelf ? { ...a, responseStatus } : a);
    setEditAttendees(updated);
    setEvents((prev) =>
      prev.map((e) => e.id === eventId ? { ...e, attendees: updated } : e)
    );

    apiFetch(`/api/events/${encodeURIComponent(event.googleEventId)}/rsvp?calendarId=${encodeURIComponent(event.calendarId)}`, {
      method: "PATCH",
      body: JSON.stringify({ responseStatus, sendUpdates }),
    }).catch((err) => {
      console.error(`[rsvp] Failed:`, err);
      setEditAttendees(original);
      setEvents((prev) =>
        prev.map((e) => e.id === eventId ? { ...e, attendees: original } : e)
      );
    });
  }

  const timeZone = () => mode() === "create" ? draftTimeZone() : editTimeZone();
  const setTimeZone = (v: string | undefined) => {
    const oldTz = timeZone() || SYSTEM_TIMEZONE;
    const newTz = v || SYSTEM_TIMEZONE;

    if (oldTz === newTz) {
      if (mode() === "create") { setDraftTimeZone(v); }
      else { setEditTimeZone(v); scheduleSave({ timeZone: v }); flushSave(); }
      return;
    }

    if (mode() === "create") {
      const s = draftStart();
      const e = draftEnd();
      setDraftTimeZone(v);
      if (s) setDraftStart(reinterpretInTimezone(s, oldTz, newTz));
      if (e) setDraftEnd(reinterpretInTimezone(e, oldTz, newTz));
    } else {
      const s = editStart();
      const e = editEnd();
      setEditTimeZone(v);
      const newStart = s ? reinterpretInTimezone(s, oldTz, newTz) : null;
      const newEnd = e ? reinterpretInTimezone(e, oldTz, newTz) : null;
      if (newStart) setEditStart(newStart);
      if (newEnd) setEditEnd(newEnd);
      const patch: EventPatch = { timeZone: v };
      if (newStart) patch.start = newStart;
      if (newEnd) patch.end = newEnd;
      scheduleSave(patch);
      flushSave();
    }
  };

  /** Add a Google Meet link. In edit mode, PATCHes immediately. In create mode, marks as pending. */
  function addMeetConferencing(): void {
    if (mode() === "create") {
      // Mark pending — resolved server-side during commitCreation
      setDraftConferencing({ uri: "", label: "Google Meet" });
    } else {
      const eventId = selectedEventId();
      if (!eventId) return;
      const event = events().find(e => e.id === eventId);
      if (!event) return;
      setConferencingLoading(true);
      // PATCH the event with a Meet request
      apiFetch<ApiCalendarEvent>(`/api/events/${encodeURIComponent(event.googleEventId)}`, {
        method: "PATCH",
        body: JSON.stringify({ conferencing: { type: "meet" } }),
      })
        .then((updated) => {
          const conf = updated.conferencing ?? null;
          setEditConferencing(conf);
          // Update the events signal so the chip reflects changes
          setEvents((prev) => prev.map((e) => e.id === eventId ? { ...e, conferencing: conf } : e));
        })
        .catch((err) => {
          console.error("[conferencing] Failed to add Meet link:", err);
        })
        .finally(() => setConferencingLoading(false));
    }
  }

  /** Set a manual conferencing URL */
  function setManualConferencing(uri: string): void {
    const conf = { uri };
    if (mode() === "create") {
      setDraftConferencing(conf);
    } else {
      setEditConferencing(conf);
      scheduleSave({ conferencing: conf });
      flushSave();
    }
  }

  /** Remove conferencing */
  function removeConferencing(): void {
    if (mode() === "create") {
      setDraftConferencing(null);
    } else {
      setEditConferencing(null);
      const eventId = selectedEventId();
      if (eventId) {
        setEvents((prev) => prev.map((e) => e.id === eventId ? { ...e, conferencing: null } : e));
      }
      scheduleSave({ conferencing: null });
      flushSave();
    }
  }

  /** The calendar's own color (identity badge — no event override applied). */
  const calendarColor = createMemo(() => {
    const calId = mode() === "create" ? draftCalendarId() : editCalendarId();
    if (calId) {
      for (const acc of connectedAccounts()) {
        const cal = acc.calendars.find((c) => c.id === calId);
        if (cal) return cal.color;
      }
    }
    return CATHRIN_PALETTE.graphite;
  });

  const eventColor = createMemo(() => {
    if (mode() === "create") return getDraftColor();
    // In edit mode, respect the local colorId override
    const overrideKey = editColorId();
    if (overrideKey && CATHRIN_PALETTE[overrideKey]) return CATHRIN_PALETTE[overrideKey];
    // No override: use calendar color
    return calendarColor();
  });

  function beginTimeEdit(): void {
    if (mode() === "create") {
      // Store shadow position (original time before editing)
      setShadowStart(draftStart() ? new Date(draftStart()!) : null);
      setShadowEnd(draftEnd() ? new Date(draftEnd()!) : null);
    }
  }

  /** Apply parsed time to the draft/edit, updating the event chip position live */
  function handleTimeInput(which: "start" | "end", value: string, referenceHour?: number): void {
    const parsed = parseTimeInput(value, referenceHour);
    if (!parsed) return;

    const baseDate = which === "start" ? start()! : end()!;
    const tz = timeZone();

    let newDate: Date;
    if (tz) {
      newDate = setTimeInTimezone(baseDate, parsed.hours, parsed.minutes, tz);
    } else {
      newDate = new Date(baseDate);
      newDate.setHours(parsed.hours, parsed.minutes, 0, 0);
    }

    if (which === "start") {
      setStart(newDate);
      // Auto-adjust end if it's now before or equal to start
      if (end()! <= newDate) {
        const adjusted = new Date(newDate.getTime() + 3600000);
        setEnd(adjusted);
      }
    } else {
      // If end is before start, auto-adjust to start + 1 hour
      if (newDate <= start()!) {
        const adjusted = new Date(start()!.getTime() + 3600000);
        setEnd(adjusted);
      } else {
        setEnd(newDate);
      }
    }
  }

  function finishTimeEdit(): void {
    if (mode() === "create") {
      setShadowStart(null);
      setShadowEnd(null);
    }
    // Flush time changes immediately on blur
    if (mode() === "edit") flushSave();
  }

  function revertTimeEdit(): void {
    if (mode() === "create") {
      // Restore original position from shadow before clearing
      const origStart = shadowStart();
      const origEnd = shadowEnd();
      batch(() => {
        if (origStart) setDraftStart(origStart);
        if (origEnd) setDraftEnd(origEnd);
        setShadowStart(null);
        setShadowEnd(null);
      });
    } else {
      // In edit mode, revert to the selected event's times
      const event = selectedEvent();
      if (event) {
        setEditStart(new Date(event.start));
        setEditEnd(new Date(event.end));
      }
    }
  }

  // In edit mode: only calendars from the same account as the event
  const editCalendars = createMemo(() => {
    if (mode() !== "edit") return allCalendars();
    const calId = editCalendarId();
    if (!calId) return allCalendars();
    // Find which account owns the event's calendar
    const ownerAccount = connectedAccounts().find((a) =>
      a.calendars.some((c) => c.id === calId)
    );
    if (!ownerAccount) return allCalendars();
    return ownerAccount.calendars
      .filter((c) => c.visible && c.accessRole !== "reader" && c.accessRole !== "freeBusyReader")
      .map((c) => ({ ...c, accountEmail: ownerAccount.email }));
  });

  // Whether the calendar picker should be interactive in edit mode
  const canMoveCalendar = createMemo(() => {
    if (mode() !== "edit") return true; // create mode always allows picking
    const event = selectedEvent();
    if (!event) return false;
    if (event.isReadOnly) return false;
    return editCalendars().length > 1;
  });

  const calendarCollection = createMemo(() =>
    createListCollection({
      items: mode() === "edit" ? editCalendars() : allCalendars(),
      itemToValue: (item) => item.id,
      itemToString: (item) => item.name,
    })
  );

  const visibilityCollection = createMemo(() =>
    createListCollection({
      items: [
        { value: "default", label: "Default" },
        { value: "public", label: "Public" },
        { value: "private", label: "Private" },
      ],
      itemToValue: (item) => item.value,
      itemToString: (item) => item.label,
    })
  );

  const transparencyCollection = createMemo(() =>
    createListCollection({
      items: [
        { value: "opaque", label: "Busy" },
        { value: "transparent", label: "Free" },
      ],
      itemToValue: (item) => item.value,
      itemToString: (item) => item.label,
    })
  );

  return {
    mode,
    title,
    setTitle,
    start,
    setStart,
    end,
    setEnd,
    location,
    setLocation,
    description,
    setDescription,
    isAllDay,
    setIsAllDay,
    calendarId,
    setCalId,
    calendarColor,
    eventColor,
    beginTimeEdit,
    handleTimeInput,
    finishTimeEdit,
    transparency,
    setTransparency,
    visibility,
    setVisibility,
    colorId,
    setColorId,
    reminders,
    addReminder,
    removeReminder,
    conferencing,
    attendees,
    isOrganizer,
    accountEmail,
    addAttendee,
    removeAttendee,
    rsvpAttendee,
    timeZone,
    setTimeZone,
    conferencingLoading,
    addMeetConferencing,
    setManualConferencing,
    removeConferencing,
    revertTimeEdit,
    flushSave,
    allCalendars,
    canMoveCalendar,
    calendarCollection,
    visibilityCollection,
    transparencyCollection,
    get savedTimedStart() { return savedTimedStart; },
    set savedTimedStart(v: Date | null) { savedTimedStart = v; },
    get savedTimedEnd() { return savedTimedEnd; },
    set savedTimedEnd(v: Date | null) { savedTimedEnd = v; },
    editStart: editStart as () => Date | null,
    setEditStart,
    editEnd: editEnd as () => Date | null,
    setEditEnd,
    scheduleSave,
  };
}

export type EventFormState = ReturnType<typeof useEventFormState>;
