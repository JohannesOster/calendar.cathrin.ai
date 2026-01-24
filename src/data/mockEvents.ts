import { createSignal } from "solid-js";
import type { CalendarEvent } from "../components/calendar/CalendarEvent";

// Helper to create dates relative to today
function createDate(dayOffset: number, hours: number, minutes: number = 0): Date {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

// Event color palette
const COLORS = {
  teal: "#80cbc4",
  blue: "#64b5f6",
  purple: "#ba68c8",
  orange: "#ffb74d",
  green: "#81c784",
  pink: "#f48fb1",
};

const initialEvents: CalendarEvent[] = [
  {
    id: "1",
    title: "Sim Modeling Lecture Videos",
    start: createDate(0, 14, 0), // Today 2pm
    end: createDate(0, 16, 0),   // Today 4pm
    color: COLORS.teal,
  },
  {
    id: "2",
    title: "Team Standup",
    start: createDate(0, 9, 30),
    end: createDate(0, 10, 0),
    color: COLORS.blue,
  },
  {
    id: "3",
    title: "Project Review Meeting with Design Team",
    start: createDate(1, 11, 0), // Tomorrow
    end: createDate(1, 12, 30),
    color: COLORS.purple,
  },
  {
    id: "4",
    title: "Lunch with Sarah",
    start: createDate(1, 12, 30),
    end: createDate(1, 13, 30),
    color: COLORS.orange,
  },
  {
    id: "5",
    title: "Code Review",
    start: createDate(2, 15, 0),
    end: createDate(2, 16, 0),
    color: COLORS.green,
  },
  {
    id: "6",
    title: "Weekly Planning Session",
    start: createDate(-1, 10, 0), // Yesterday
    end: createDate(-1, 11, 30),
    color: COLORS.pink,
  },
  {
    id: "7",
    title: "Deep Work Block",
    start: createDate(3, 9, 0),
    end: createDate(3, 12, 0),
    color: COLORS.teal,
  },
  {
    id: "8",
    title: "Client Call",
    start: createDate(0, 16, 30),
    end: createDate(0, 17, 0),
    color: COLORS.purple,
  },
];

const [events, setEvents] = createSignal<CalendarEvent[]>(initialEvents);

export function deleteEvent(id: string): void {
  setEvents((prev) => prev.filter((event) => event.id !== id));
}

export { events };
