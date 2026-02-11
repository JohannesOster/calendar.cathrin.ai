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
  getDraftColor,
  shadowStart,
  setShadowStart,
  shadowEnd,
  setShadowEnd,
} from "../../stores/event-creation";
import { CATHRIN_PALETTE } from "../../lib/color-mapping";
import type { CathrinColorKey } from "../../lib/color-mapping";
import { selectedEvent, selectedEventId } from "../../stores/event-selection";
import { updateEvent, setEvents } from "../../stores/events";
import type { EventPatch } from "../../stores/event-types";
import { apiFetch } from "../../lib/api";
import type { ApiCalendarEvent } from "@cathrin/shared-types";
import { connectedAccounts } from "../../stores/accounts";
import { toTimeText, parseTimeInput } from "../../lib/format-utils";

export type FormMode = "create" | "edit";

export function useEventFormState() {
  // Remember timed start/end when switching to all-day so we can restore them
  let savedTimedStart: Date | null = null;
  let savedTimedEnd: Date | null = null;

  const [editingTime, setEditingTime] = createSignal<"start" | "end" | null>(null);
  const [startTimeText, setStartTimeText] = createSignal("");
  const [endTimeText, setEndTimeText] = createSignal("");

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
  const [conferencingLoading, setConferencingLoading] = createSignal(false);

  const mode = createMemo<FormMode>(() => isCreating() ? "create" : "edit");

  // ===========================================================================
  // Autosave infrastructure (edit mode only)
  // ===========================================================================
  let pendingPatch: EventPatch = {};
  /** Original values captured before the first pre-mutation of each field. */
  let pendingRollback: EventPatch = {};

  /** Accumulate a field change. Flushed on blur via flushSave(). */
  function scheduleSave(patch: EventPatch): void {
    Object.assign(pendingPatch, patch);
  }

  function flushSave(): void {
    const eventId = selectedEventId();
    if (!eventId || Object.keys(pendingPatch).length === 0) return;

    const patchToSend = { ...pendingPatch };
    const rollback = Object.keys(pendingRollback).length > 0 ? { ...pendingRollback } : undefined;
    pendingPatch = {};
    pendingRollback = {};
    updateEvent(eventId, patchToSend, rollback).catch((err) =>
      console.error("Failed to save event update:", err)
    );
  }

  // Flush pending save when deselecting (sidebar closes)
  createEffect(on(selectedEventId, (id, prevId) => {
    if (!id && prevId) {
      flushSave();
    }
  }));

  // Flush on unmount
  onCleanup(() => flushSave());

  // Populate edit signals whenever the selected event changes
  createEffect(on(selectedEvent, (event) => {
    if (!event) return;
    // Clear any pending saves for the previous event
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
    setConferencingLoading(false);
    savedTimedStart = null;
    savedTimedEnd = null;
  }));

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
  const setCalId = (v: string | null) => mode() === "create" ? setDraftCalendarId(v) : setEditCalendarId(v);

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
  const addReminder = (minutes: number) => {
    const current = reminders();
    if (current.length >= 5 || current.some((r) => r.minutes === minutes)) return;
    const updated = [...current, { method: "popup" as const, minutes }];
    if (mode() === "create") { setDraftReminders(updated); }
    else { setEditReminders(updated); scheduleSave({ reminders: updated }); flushSave(); }
  };
  const removeReminder = (minutes: number) => {
    const updated = reminders().filter((r) => r.minutes !== minutes);
    if (mode() === "create") { setDraftReminders(updated); }
    else { setEditReminders(updated); scheduleSave({ reminders: updated.length > 0 ? updated : null }); flushSave(); }
  };

  const conferencing = () => mode() === "create" ? draftConferencing() : editConferencing();

  /** Add a Google Meet link. In edit mode, PATCHes immediately. In create mode, marks as pending. */
  function addMeetConferencing(): void {
    if (mode() === "create") {
      // Mark pending — resolved server-side during commitCreation
      setDraftConferencing({ uri: "", label: "Google Meet" });
    } else {
      const eventId = selectedEventId();
      if (!eventId) return;
      setConferencingLoading(true);
      // PATCH the event with a Meet request
      apiFetch<ApiCalendarEvent>(`/api/events/${encodeURIComponent(eventId)}`, {
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

  const eventColor = createMemo(() => {
    if (mode() === "create") return getDraftColor();
    // In edit mode, respect the local colorId override
    const overrideKey = editColorId();
    if (overrideKey && CATHRIN_PALETTE[overrideKey]) return CATHRIN_PALETTE[overrideKey];
    // No override: use calendar color (not event.color which may have stale override)
    const calId = editCalendarId();
    if (calId) {
      for (const acc of connectedAccounts()) {
        const cal = acc.calendars.find((c) => c.id === calId);
        if (cal) return cal.color;
      }
    }
    return selectedEvent()?.color ?? CATHRIN_PALETTE.graphite;
  });

  function beginTimeEdit(which: "start" | "end"): void {
    if (mode() === "create") {
      // Store shadow position (original time before editing)
      setShadowStart(draftStart() ? new Date(draftStart()!) : null);
      setShadowEnd(draftEnd() ? new Date(draftEnd()!) : null);
    }

    if (which === "start") {
      setStartTimeText(toTimeText(start()!));
    } else {
      setEndTimeText(toTimeText(end()!));
    }
    setEditingTime(which);
  }

  /** Apply parsed time to the draft/edit, updating the event chip position live */
  function applyTimeLive(which: "start" | "end", value: string): void {
    const parsed = parseTimeInput(value);
    if (!parsed) return;

    const baseDate = which === "start" ? start()! : end()!;
    const newDate = new Date(baseDate);
    newDate.setHours(parsed.hours, parsed.minutes, 0, 0);

    if (which === "start") {
      setStart(newDate);
      // Auto-adjust end if it's now before or equal to start
      if (end()! <= newDate) {
        const adjusted = new Date(newDate);
        adjusted.setHours(adjusted.getHours() + 1);
        setEnd(adjusted);
      }
    } else {
      // If end is before start, auto-adjust to start + 1 hour
      if (newDate <= start()!) {
        const adjusted = new Date(start()!);
        adjusted.setHours(adjusted.getHours() + 1);
        setEnd(adjusted);
      } else {
        setEnd(newDate);
      }
    }
  }

  function handleTimeInput(which: "start" | "end", value: string): void {
    if (which === "start") {
      setStartTimeText(value);
    } else {
      setEndTimeText(value);
    }
    applyTimeLive(which, value);
  }

  function finishTimeEdit(): void {
    batch(() => {
      setEditingTime(null);
      if (mode() === "create") {
        setShadowStart(null);
        setShadowEnd(null);
      }
    });
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
        setEditingTime(null);
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
      setEditingTime(null);
    }
  }

  function handleTimeKeyDown(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      finishTimeEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      revertTimeEdit();
    }
  }

  // All visible calendars for the selector
  const allCalendars = createMemo(() => {
    return connectedAccounts()
      .flatMap((a) =>
        a.calendars
          .filter((c) => c.visible)
          .map((c) => ({ ...c, accountEmail: a.email }))
      );
  });

  const calendarCollection = createMemo(() =>
    createListCollection({
      items: allCalendars(),
      itemToValue: (item) => item.id,
      itemToString: (item) => item.name,
    })
  );

  const visibilityCollection = createMemo(() =>
    createListCollection({
      items: [
        { value: "default", label: "Default visibility" },
        { value: "public", label: "Public" },
        { value: "private", label: "Private" },
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
    eventColor,
    editingTime,
    startTimeText,
    endTimeText,
    beginTimeEdit,
    handleTimeInput,
    finishTimeEdit,
    handleTimeKeyDown,
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
    conferencingLoading,
    addMeetConferencing,
    setManualConferencing,
    removeConferencing,
    flushSave,
    allCalendars,
    calendarCollection,
    visibilityCollection,
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
