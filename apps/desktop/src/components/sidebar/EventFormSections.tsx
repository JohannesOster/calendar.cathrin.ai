import { Show, For, createSignal, createMemo } from "solid-js";
import {
  Video,
  MapPin,
  Bell,
  ChevronDown,
  Copy,
  Calendar,
  LoaderCircle,
  Eye,
  EyeOff,
  CircleDot,
  Circle,
  X,
} from "lucide-solid";
import { Select, createListCollection } from "@ark-ui/solid/select";
import { Combobox } from "@ark-ui/solid/combobox";
import { Popover } from "@ark-ui/solid/popover";
import { invoke } from "@tauri-apps/api/core";
import { CATHRIN_PALETTE } from "../../lib/color-mapping";
import type { CathrinColorKey } from "../../lib/color-mapping";
import type { EventFormState } from "./useEventFormState";
import { AttendeeList } from "./AttendeeSection";

export { TimeSection } from "./TimeSection";

interface SectionProps {
  state: EventFormState;
}

export function DetailsSection(props: SectionProps) {
  const s = props.state;

  return (
    <div class="px-3 py-3 border-t border-border space-y-2">
      <AttendeeList
        attendees={s.attendees()}
        isOrganizer={s.isOrganizer()}
        accountEmail={s.accountEmail()}
        mode={s.mode()}
        onAdd={(email, name) => s.addAttendee(email, name)}
        onRemove={(email) => s.removeAttendee(email)}
        onRsvp={(status, sendUpdates) => s.rsvpAttendee(status, sendUpdates)}
      />
      <Show when={s.mode() === "create" || s.isOrganizer()}>
        <ConferencingField state={s} />
      </Show>
      <Show when={s.mode() !== "create" && !s.isOrganizer() && s.conferencing()}>
        {(conf) => (
          <div class="flex items-center gap-2 text-sm px-2 py-2">
            <Video size={14} class="text-fg-muted shrink-0" />
            <span class="flex-1 text-fg truncate">{conferencingLabel(conf())} Link</span>
          </div>
        )}
      </Show>
      <div class="flex items-center gap-2 text-sm rounded px-2 py-2 hover:bg-surface-hover focus-within:bg-surface-hover transition-colors">
        <MapPin size={14} class="text-fg-muted shrink-0" />
        <input
          type="text"
          placeholder="Add location"
          aria-label="Location"
          value={s.location()}
          onInput={(e) => s.setLocation(e.currentTarget.value)}
          onBlur={() => {
            if (s.mode() === "edit") s.flushSave();
          }}
          disabled={s.mode() === "edit" && !s.isOrganizer()}
          class={`flex-1 text-sm text-fg placeholder-fg-disabled bg-transparent outline-none border-none ${
            s.mode() === "edit" && !s.isOrganizer() ? "cursor-default" : ""
          }`}
        />
      </div>
      <Show
        when={s.mode() === "create" || s.canMoveCalendar()}
        fallback={
          <div class="flex items-center gap-x-8 px-2 py-2">
            <Calendar size={14} class="text-fg-muted shrink-0" />
            <span class="flex-1 text-sm text-fg">
              {(() => {
                const id = s.calendarId();
                if (!id) return "No calendar";
                const cal = s.allCalendars().find((c) => c.id === id);
                return cal?.name ?? "Unknown calendar";
              })()}
            </span>
            <div class="w-px h-4 bg-border shrink-0" />
            <ColorSelect state={s} />
          </div>
        }
      >
        <Select.Root
          collection={s.calendarCollection()}
          value={s.calendarId() ? [s.calendarId()!] : []}
          onValueChange={(details) => {
            s.setCalId(details.value[0] ?? null);
          }}
          positioning={{ placement: "bottom-start", sameWidth: true }}
          class="w-full"
        >
          <Select.Control>
            <div class="flex w-full items-center gap-2">
              <Select.Trigger class="flex flex-1 items-center gap-2 text-sm text-fg bg-transparent outline-none border-none cursor-pointer rounded px-2 py-2 hover:bg-surface-hover transition-colors">
                <Calendar size={14} class="text-fg-muted shrink-0" />
                <span class="flex-1 text-left">
                  {(() => {
                    const id = s.calendarId();
                    if (!id) return "Select calendar";
                    const cal = s.allCalendars().find((c) => c.id === id);
                    return cal?.name ?? "Select calendar";
                  })()}
                </span>
                <ChevronDown size={14} class="text-fg-muted shrink-0" />
              </Select.Trigger>
              <div class="w-px h-4 bg-border shrink-0" />
              <ColorSelect state={s} />
            </div>
          </Select.Control>
          <Select.Positioner>
            <Select.Content class="bg-surface border border-border rounded py-1 z-50 max-h-48 overflow-y-auto">
              <For each={s.allCalendars()}>
                {(cal) => (
                  <Select.Item
                    item={cal}
                    class="flex items-center gap-2 px-3 py-1.5 text-xs text-fg cursor-pointer hover:bg-surface-hover data-[highlighted]:bg-surface-hover outline-none"
                  >
                    <div
                      class="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ "background-color": cal.color }}
                    />
                    <Select.ItemText>{cal.name}</Select.ItemText>
                  </Select.Item>
                )}
              </For>
            </Select.Content>
          </Select.Positioner>
          <Select.HiddenSelect />
        </Select.Root>
      </Show>
    </div>
  );
}

export function DescriptionSection(props: SectionProps) {
  const s = props.state;

  return (
    <div class="px-3 py-3 border-t border-border">
      <textarea
        placeholder="Add description"
        aria-label="Description"
        value={s.description()}
        onInput={(e) => {
          s.setDescription(e.currentTarget.value);
          e.currentTarget.style.height = "auto";
          e.currentTarget.style.height =
            Math.min(e.currentTarget.scrollHeight, 160) + "px";
        }}
        onBlur={() => {
          if (s.mode() === "edit") s.flushSave();
        }}
        disabled={s.mode() === "edit" && !s.isOrganizer()}
        class={`w-full text-sm text-fg placeholder-fg-disabled appearance-none outline-none border-none resize-none overflow-hidden rounded px-2 py-1 transition-colors ${
          s.mode() === "edit" && !s.isOrganizer()
            ? "bg-transparent cursor-default"
            : "bg-surface-input hover:bg-surface-hover focus:bg-surface-hover"
        }`}
        rows={2}
      />
    </div>
  );
}

export function CalendarSection(props: SectionProps) {
  const s = props.state;

  return (
    <div class="px-3 py-3 border-t border-border">
      <div class="flex items-center gap-2">
        <div class="w-2/5 shrink-0">
          <Select.Root
            collection={s.transparencyCollection()}
            value={[s.transparency()]}
            onValueChange={(details) => {
              const val = details.value[0];
              if (val === "opaque" || val === "transparent") {
                s.setTransparency(val);
              }
            }}
            positioning={{ placement: "bottom-start" }}
          >
            <Select.Control>
              <Select.Trigger
                aria-label="Free/Busy status"
                class="flex w-full items-center gap-2 text-xs bg-transparent outline-none border-none cursor-pointer rounded px-2 py-2 hover:bg-surface-hover transition-colors text-fg-muted hover:text-fg"
              >
                <Show
                  when={s.transparency() === "opaque"}
                  fallback={<Circle size={14} class="shrink-0" />}
                >
                  <CircleDot size={14} class="shrink-0" />
                </Show>
                <span class="flex-1 text-left">{s.transparency() === "opaque" ? "Busy" : "Free"}</span>
                <ChevronDown size={14} class="text-fg-muted shrink-0" />
              </Select.Trigger>
            </Select.Control>
            <Select.Positioner>
              <Select.Content class="bg-surface border border-border rounded py-1 z-50">
                <For each={s.transparencyCollection().items}>
                  {(item) => (
                    <Select.Item
                      item={item}
                      class="flex items-center gap-2 px-3 py-1.5 text-xs text-fg cursor-pointer hover:bg-surface-hover data-[highlighted]:bg-surface-hover outline-none"
                    >
                      <Select.ItemText>{item.label}</Select.ItemText>
                    </Select.Item>
                  )}
                </For>
              </Select.Content>
            </Select.Positioner>
            <Select.HiddenSelect />
          </Select.Root>
        </div>
        <div class="w-px h-4 bg-border shrink-0" />
        <div class="w-3/5">
          <Select.Root
            collection={s.visibilityCollection()}
            value={[s.visibility()]}
            onValueChange={(details) => {
              const val = details.value[0];
              if (val === "default" || val === "public" || val === "private") {
                s.setVisibility(val);
              }
            }}
            disabled={s.mode() === "edit" && !s.isOrganizer()}
            positioning={{ placement: "bottom-start" }}
          >
            <Select.Control>
              <Select.Trigger
                aria-label="Event visibility"
                class="flex w-full items-center gap-2 text-xs bg-transparent outline-none border-none cursor-pointer rounded px-2 py-2 hover:bg-surface-hover transition-colors text-fg-muted hover:text-fg"
              >
                <Show
                  when={s.visibility() === "private"}
                  fallback={<Eye size={14} class="shrink-0" />}
                >
                  <EyeOff size={14} class="shrink-0" />
                </Show>
                <span class="flex-1 text-left">
                  {s.visibility() === "default"
                    ? "Default"
                    : s.visibility() === "public"
                      ? "Public"
                      : "Private"}
                </span>
                <ChevronDown size={14} class="text-fg-muted shrink-0" />
              </Select.Trigger>
            </Select.Control>
          <Select.Positioner>
            <Select.Content class="bg-surface border border-border rounded z-50">
              {/* Default — separated like color selector's "Calendar default" */}
              <Select.Item
                item={s.visibilityCollection().items[0]}
                class="flex items-center gap-2 px-3 py-1.5 text-xs text-fg cursor-pointer hover:bg-surface-hover data-[highlighted]:bg-surface-hover outline-none"
              >
                <Select.ItemText>Default</Select.ItemText>
              </Select.Item>
              <div class="border-t border-border" />
              <For each={s.visibilityCollection().items.slice(1)}>
                {(item) => (
                  <Select.Item
                    item={item}
                    class="flex items-center gap-2 px-3 py-1.5 text-xs text-fg cursor-pointer hover:bg-surface-hover data-[highlighted]:bg-surface-hover outline-none"
                  >
                    <Select.ItemText>{item.label}</Select.ItemText>
                  </Select.Item>
                )}
              </For>
            </Select.Content>
          </Select.Positioner>
          <Select.HiddenSelect />
        </Select.Root>
        </div>
      </div>
    </div>
  );
}

const MAX_REMINDER_MINUTES = 40320; // 4 weeks — Google Calendar API limit

const REMINDER_PRESETS = [
  { minutes: 5, label: "5 min" },
  { minutes: 10, label: "10 min" },
  { minutes: 15, label: "15 min" },
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "1 hour" },
  { minutes: 1440, label: "1 day" },
];

function formatReminderValue(minutes: number): string {
  if (minutes >= 10080 && minutes % 10080 === 0) return `${minutes / 10080} wk`;
  if (minutes >= 1440) {
    const d = Math.floor(minutes / 1440);
    const remainder = minutes % 1440;
    if (remainder === 0) return `${d} day`;
    return `${d} day ${formatReminderValue(remainder)}`;
  }
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (m === 0) return `${h}hr`;
    return `${h}hr ${m}min`;
  }
  return `${minutes}min`;
}

/** Detect a unit hint from an alpha-only string. */
function detectUnit(alpha: string): string | null {
  // Multi-char patterns first (more specific, avoids false positives)
  if (/we|wk/.test(alpha)) return "w";
  if (/ho|hr/.test(alpha)) return "h";
  if (/da/.test(alpha)) return "d";
  if (/mi/.test(alpha)) return "m";
  // Single char only when it's the only letter (e.g. "2h", "5d")
  if (alpha.length === 1 && /[mhdw]/.test(alpha)) return alpha;
  return null;
}

const UNIT_TO_MINUTES: Record<string, number> = { m: 1, h: 60, d: 1440, w: 10080 };

/**
 * Extract a number and optional unit from fuzzy input.
 * Handles single ("30omin", "2h") and compound ("1h30m", "1h 30") expressions.
 */
function extractReminderParts(text: string): { num: number; unit: string | null; compound: boolean } | null {
  const groups = [...text.matchAll(/(\d+)\s*([a-z]*)/g)];
  if (groups.length === 0) return null;

  // Compound: "1h30m", "1h 30", "2d 12h" — requires at least one explicit unit
  if (groups.length >= 2 && groups.some(([, , u]) => detectUnit(u) !== null)) {
    let total = 0;
    for (const [, digits, unitText] of groups) {
      const n = parseInt(digits, 10);
      if (isNaN(n) || n <= 0) continue;
      const u = detectUnit(unitText) ?? "m";
      total += n * (UNIT_TO_MINUTES[u] ?? 1);
    }
    return total > 0 ? { num: total, unit: "m", compound: true } : null;
  }

  // Single expression: first contiguous digit run + fuzzy unit from all alpha chars
  const num = parseInt(groups[0][1], 10);
  if (num <= 0 || isNaN(num)) return null;
  const alpha = text.replace(/[^a-z]/g, "");
  return { num, unit: detectUnit(alpha), compound: false };
}

function parseReminderInput(input: string): number | null {
  const parts = extractReminderParts(input.trim().toLowerCase());
  if (!parts) return null;
  const { num, unit, compound } = parts;
  const minutes = compound ? num : num * (UNIT_TO_MINUTES[unit ?? "m"] ?? 1);
  return minutes > MAX_REMINDER_MINUTES ? null : minutes;
}

export function RemindersSection(props: SectionProps) {
  const s = props.state;

  return (
    <div class="px-3 py-3 border-t border-border space-y-1">
      <Show when={s.reminders().length < 5}>
        <ReminderCombobox state={s} />
      </Show>
      <Show when={s.reminders().length > 0}>
        <div class="flex flex-col">
          <For each={[...s.reminders()].sort((a, b) => a.minutes - b.minutes)}>
            {(r) => (
              <div
                class="group flex items-center gap-2 pl-[30px] pr-2 py-2 rounded hover:bg-surface-hover transition-colors"
                aria-label={`${formatReminderValue(r.minutes)} before, press delete to remove`}
              >
                <span class="flex-1 text-sm text-fg-muted">
                  {formatReminderValue(r.minutes)} before
                </span>
                <button
                  class="text-fg-muted/0 group-hover:text-fg-muted hover:!text-fg transition-colors cursor-pointer p-0.5"
                  onClick={() => s.removeReminder(r.minutes)}
                  aria-label={`Remove ${formatReminderValue(r.minutes)} before reminder`}
                >
                  <X size={12} />
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

/** Extract a short display label from a conferencing URI */
function conferencingLabel(conf: { uri: string; label?: string }): string {
  if (conf.label) return conf.label;
  if (!conf.uri) return "Conferencing";
  try {
    const url = new URL(conf.uri);
    const host = url.hostname.replace(/^www\./, "");
    if (host.includes("meet.google.com")) return "Google Meet";
    if (host.includes("zoom.us")) return "Zoom";
    if (host.includes("teams.microsoft.com")) return "Microsoft Teams";
    return host;
  } catch {
    return conf.uri;
  }
}

function ConferencingField(props: { state: EventFormState }) {
  const s = props.state;
  const [showUrlInput, setShowUrlInput] = createSignal(false);
  const [urlValue, setUrlValue] = createSignal("");

  function handleAddClick(): void {
    // Auto-generate Meet link (all calendars are Google for now)
    s.addMeetConferencing();
  }

  function handleUrlSubmit(): void {
    const url = urlValue().trim();
    if (!url) {
      setShowUrlInput(false);
      return;
    }
    try {
      new URL(url); // Basic validation
      s.setManualConferencing(url);
      setShowUrlInput(false);
      setUrlValue("");
    } catch {
      // Invalid URL — keep input open
    }
  }

  function handleUrlKeyDown(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      handleUrlSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setShowUrlInput(false);
      setUrlValue("");
    }
  }

  function openUrl(uri: string): void {
    if (!uri) return;
    invoke("open_url", { url: uri }).catch((err) =>
      console.error("[conferencing] Failed to open URL:", err),
    );
  }

  function copyUrl(uri: string): void {
    navigator.clipboard
      .writeText(uri)
      .catch((err) => console.error("[conferencing] Failed to copy URL:", err));
  }

  return (
    <>
      <Show when={s.conferencingLoading()}>
        <div class="flex items-center gap-2 text-sm text-fg-muted px-2 py-2">
          <LoaderCircle size={14} class="shrink-0 animate-spin" />
          <span>Adding Google Meet…</span>
        </div>
      </Show>
      <Show when={!s.conferencingLoading()}>
        <Show
          when={s.conferencing()}
          fallback={
            <Show
              when={showUrlInput()}
              fallback={
                <div class="flex items-center gap-1">
                  <button
                    class="flex flex-1 items-center gap-2 text-sm text-fg-muted cursor-pointer rounded px-2 py-2 hover:text-fg hover:bg-surface-hover transition-colors"
                    onClick={handleAddClick}
                    aria-label="Add Google Meet link"
                  >
                    <Video size={14} class="shrink-0" />
                    <span>Add conferencing</span>
                  </button>
                  <button
                    class="text-xs text-fg-disabled cursor-pointer rounded px-1 hover:text-fg-muted transition-colors"
                    onClick={() => setShowUrlInput(true)}
                    aria-label="Paste a conferencing URL"
                  >
                    URL
                  </button>
                </div>
              }
            >
              <div class="flex items-center gap-2 text-sm px-2">
                <Video size={14} class="text-fg-muted shrink-0" />
                <input
                  type="url"
                  placeholder="Paste conferencing URL"
                  aria-label="Conferencing URL"
                  value={urlValue()}
                  ref={(el) => requestAnimationFrame(() => el.focus())}
                  onInput={(e) => setUrlValue(e.currentTarget.value)}
                  onBlur={handleUrlSubmit}
                  onKeyDown={handleUrlKeyDown}
                  class="flex-1 text-sm text-fg py-2 px-2 placeholder-fg-disabled bg-surface-input outline-none border-none rounded hover:bg-surface-hover focus:bg-surface-hover transition-colors"
                />
                <button>
                  <X size={14} />
                </button>
              </div>
            </Show>
          }
        >
          {(conf) => (
            <div class="flex items-center gap-2 text-sm px-2 py-2">
              <Video size={14} class="text-fg-muted shrink-0" />
              <button
                class="flex-1 text-left text-fg truncate cursor-pointer hover:underline"
                onClick={() => openUrl(conf().uri)}
                disabled={!conf().uri}
                aria-label={`Open ${conferencingLabel(conf())} link`}
              >
                {conferencingLabel(conf())} Link
              </button>
              <Show when={conf().uri}>
                <button
                  class="text-fg-muted hover:text-fg transition-colors cursor-pointer shrink-0"
                  onClick={() => copyUrl(conf().uri)}
                  aria-label="Copy conferencing link"
                >
                  <Copy size={12} />
                </button>
              </Show>
              <button
                class="text-fg-muted hover:text-fg transition-colors cursor-pointer shrink-0"
                onClick={() => s.removeConferencing()}
                aria-label="Remove conferencing"
              >
                <X size={12} />
              </button>
            </div>
          )}
        </Show>
      </Show>
    </>
  );
}

const COLOR_SWATCHES: { key: CathrinColorKey; label: string }[] = [
  { key: "graphite", label: "Graphite" },
  { key: "coral", label: "Coral" },
  { key: "terracotta", label: "Terracotta" },
  { key: "amber", label: "Amber" },
  { key: "sage", label: "Sage" },
  { key: "teal", label: "Teal" },
  { key: "sky", label: "Sky" },
  { key: "slate", label: "Slate" },
  { key: "lavender", label: "Lavender" },
  { key: "plum", label: "Plum" },
  { key: "rose", label: "Rose" },
];

function ColorSelect(props: { state: EventFormState }) {
  const s = props.state;

  const calendarColorKey = createMemo(() => {
    const hex = s.calendarColor();
    const entries = Object.entries(CATHRIN_PALETTE) as [
      CathrinColorKey,
      string,
    ][];
    const match = entries.find(([, v]) => v === hex);
    return match ? match[0] : null;
  });

  const otherSwatches = createMemo(() =>
    COLOR_SWATCHES.filter((sw) => sw.key !== calendarColorKey()),
  );

  const isSelected = (key: CathrinColorKey | null) => s.colorId() === key;

  const ringStyle = (color: string, selected: boolean) => ({
    "background-color": color,
    "box-shadow": selected
      ? `0 0 0 2px var(--color-surface), 0 0 0 3.5px ${color}`
      : undefined,
  });

  return (
    <Popover.Root positioning={{ placement: "bottom-start" }}>
      <Popover.Trigger class="flex items-center gap-1 rounded px-2 min-h-9 hover:bg-surface-hover transition-colors cursor-pointer bg-transparent border-none outline-none shrink-0">
        <div
          class="w-3.5 h-3.5 rounded-full shrink-0"
          style={{ "background-color": s.eventColor() }}
        />
        <ChevronDown size={12} class="text-fg-muted shrink-0" />
      </Popover.Trigger>
      <Popover.Positioner>
        <Popover.Content class="bg-surface border border-border rounded z-50 max-w-[180px]">
          {/* Header — calendar default */}
          <Popover.CloseTrigger
            class="flex items-center gap-2 w-full px-3 py-2 cursor-pointer bg-transparent border-none outline-none hover:bg-surface-hover transition-colors rounded-t"
            onClick={() => s.setColorId(null)}
          >
            <div
              class="w-3.5 h-3.5 rounded-full shrink-0"
              style={ringStyle(s.calendarColor(), isSelected(null))}
            />
            <span class="text-xs text-fg-muted">Calendar default</span>
          </Popover.CloseTrigger>
          {/* Body — palette swatches */}
          <div class="flex items-center gap-x-3 gap-y-3 flex-wrap px-3 pt-3 pb-4 border-t border-border">
            <For each={otherSwatches()}>
              {(swatch) => (
                <Popover.CloseTrigger
                  class="w-3.5 h-3.5 rounded-full cursor-pointer shrink-0 transition-transform hover:scale-125 bg-transparent border-none outline-none"
                  style={ringStyle(
                    CATHRIN_PALETTE[swatch.key],
                    isSelected(swatch.key),
                  )}
                  onClick={() => s.setColorId(swatch.key)}
                />
              )}
            </For>
          </div>
        </Popover.Content>
      </Popover.Positioner>
    </Popover.Root>
  );
}

function ReminderCombobox(props: { state: EventFormState }) {
  const s = props.state;
  let inputRef: HTMLInputElement | undefined;
  const [inputValue, setInputValue] = createSignal("");
  const [query, setQuery] = createSignal("");
  // Only mirror highlighted item into input on explicit navigation (hover/arrow),
  // not when autohighlight fires after typing.
  let userNavigated = false;

  const suggestions = createMemo(() => {
    const parts = extractReminderParts(query().trim().toLowerCase());

    if (parts) {
      const { num, unit, compound } = parts;

      // Compound expression — already resolved to total minutes
      if (compound) {
        return num <= MAX_REMINDER_MINUTES
          ? [{ value: String(num), label: formatReminderValue(num) }]
          : [];
      }

      const allCandidates = [
        { minutes: num, label: `${num} min`, u: "m" },
        { minutes: num * 60, label: `${num} hour${num !== 1 ? "s" : ""}`, u: "h" },
        { minutes: num * 1440, label: `${num} day${num !== 1 ? "s" : ""}`, u: "d" },
        { minutes: num * 10080, label: `${num} week${num !== 1 ? "s" : ""}`, u: "w" },
      ];

      // If a unit was detected, narrow to just that match
      const candidates = unit
        ? allCandidates.filter((c) => c.u === unit)
        : allCandidates;

      return candidates
        .filter((c) => c.minutes <= MAX_REMINDER_MINUTES)
        .map((c) => ({ value: String(c.minutes), label: c.label }));
    }

    return REMINDER_PRESETS.map(
      (p) => ({ value: String(p.minutes), label: p.label }),
    );
  });

  // Ark UI's combobox internally filters items via `itemToString().includes(input)`.
  // Since we already compute the right suggestions ourselves, prepend the raw query
  // so every item passes Ark's matching — prevents it from hiding our pre-filtered items.
  const collection = createMemo(() => {
    const q = query().toLowerCase();
    return createListCollection({
      items: suggestions(),
      itemToValue: (item) => item.value,
      itemToString: (item) => q ? `${q} ${item.label}` : item.label,
    });
  });

  function handleAdd(minutes: number): void {
    if (minutes > 0 && !s.reminders().some((r) => r.minutes === minutes)) {
      s.addReminder(minutes);
    }
    setInputValue("");
    setQuery("");
  }

  return (
    <Combobox.Root
      collection={collection()}
      value={[]}
      allowCustomValue
      openOnClick
      closeOnSelect
      inputBehavior="autohighlight"
      onHighlightChange={(d) => {
        if (d.highlightedValue != null && userNavigated) {
          const item = suggestions().find((i) => i.value === d.highlightedValue);
          if (item) {
            setInputValue(item.label);
            requestAnimationFrame(() => inputRef?.select());
          }
        }
      }}
      inputValue={inputValue()}
      onInputValueChange={(d) => {
        // User typed — reset navigation flag so autohighlight doesn't mirror
        userNavigated = false;

        setInputValue(d.inputValue);
        setQuery(d.inputValue);
      }}
      onValueChange={(details) => {
        const val = details.value[0];
        if (!val) return;
        const minutes = parseReminderInput(val);
        if (minutes) handleAdd(minutes);
      }}
      onOpenChange={(d) => {
        if (!d.open) {
          setInputValue("");
          setQuery("");
        }
      }}
      positioning={{ placement: "bottom-start", sameWidth: true }}
    >
      <Combobox.Control class="flex items-center gap-2 rounded px-2 py-2 hover:bg-surface-hover focus-within:bg-surface-hover transition-colors">
        <Bell size={14} class="text-fg-muted shrink-0" />
        <Combobox.Input
          ref={(el) => { inputRef = el; }}
          placeholder="Reminders"
          aria-label="Reminders"
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowDown") userNavigated = true;
          }}
          class="flex-1 text-sm text-fg placeholder-fg-disabled bg-transparent outline-none border-none cursor-text"
        />
      </Combobox.Control>
      <Combobox.Positioner>
        <Combobox.Content
          class="bg-surface border border-border rounded py-1 z-50 min-w-[160px]"
          onPointerMove={() => { userNavigated = true; }}
        >
          <For each={suggestions()}>
            {(item) => (
              <Combobox.Item
                item={item}
                class="flex items-center px-3 py-1.5 text-xs text-fg cursor-pointer hover:bg-surface-hover data-[highlighted]:bg-surface-hover outline-none"
              >
                <Combobox.ItemText>
                  {item.label}<span class="text-fg-disabled"> before</span>
                </Combobox.ItemText>
              </Combobox.Item>
            )}
          </For>
        </Combobox.Content>
      </Combobox.Positioner>
    </Combobox.Root>
  );
}
