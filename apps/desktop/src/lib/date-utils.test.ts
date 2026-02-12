import { describe, it, expect } from "vitest";
import {
  getWeekId,
  getWeekBounds,
  getWeeksInRange,
  getNextWeek,
  getPreviousWeek,
  addDays,
  getSundayOfWeek,
} from "./date-utils";

describe("getWeekId", () => {
  it("returns correct ISO week ID for a date in the middle of the week", () => {
    // Wednesday, January 15, 2025
    const date = new Date(2025, 0, 15);
    expect(getWeekId(date)).toBe("2025-W03");
  });

  it("returns correct week ID for Sunday (start of calendar week)", () => {
    // Sunday, January 12, 2025 is the START of our Sun-Sat week
    // Week bounds for W03 are Sun Jan 12 - Sat Jan 18
    const date = new Date(2025, 0, 12);
    expect(getWeekId(date)).toBe("2025-W03");
  });

  it("returns correct week ID for Saturday (end of calendar week)", () => {
    // Saturday, January 18, 2025
    const date = new Date(2025, 0, 18);
    expect(getWeekId(date)).toBe("2025-W03");
  });

  it("handles year boundary correctly - late December can be week 1 of next year", () => {
    // Monday, December 30, 2024 is in ISO week 1 of 2025
    const date = new Date(2024, 11, 30);
    expect(getWeekId(date)).toBe("2025-W01");
  });

  it("handles year boundary correctly - early January can be week 52/53 of previous year", () => {
    // Wednesday, January 1, 2025 is in ISO week 1 of 2025
    const date = new Date(2025, 0, 1);
    expect(getWeekId(date)).toBe("2025-W01");
  });

  it("handles week 52 of a year", () => {
    // December 25, 2024 is in week 52 of 2024
    const date = new Date(2024, 11, 25);
    expect(getWeekId(date)).toBe("2024-W52");
  });

  it("pads single-digit week numbers with zero", () => {
    // January 6, 2025 is in week 2
    const date = new Date(2025, 0, 6);
    expect(getWeekId(date)).toBe("2025-W02");
  });
});

describe("getWeekBounds", () => {
  it("returns correct Sunday-Saturday bounds for a week ID", () => {
    const { start, end } = getWeekBounds("2025-W03");

    // Start should be Sunday, January 12, 2025
    expect(start.getFullYear()).toBe(2025);
    expect(start.getMonth()).toBe(0); // January
    expect(start.getDate()).toBe(12);
    expect(start.getDay()).toBe(0); // Sunday
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);

    // End should be Saturday, January 18, 2025 at 23:59:59.999
    expect(end.getFullYear()).toBe(2025);
    expect(end.getMonth()).toBe(0); // January
    expect(end.getDate()).toBe(18);
    expect(end.getDay()).toBe(6); // Saturday
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
    expect(end.getSeconds()).toBe(59);
    expect(end.getMilliseconds()).toBe(999);
  });

  it("handles week 1 of a year correctly", () => {
    const { start } = getWeekBounds("2025-W01");

    // Week 1 of 2025 starts on Sunday, December 29, 2024
    expect(start.getFullYear()).toBe(2024);
    expect(start.getMonth()).toBe(11); // December
    expect(start.getDate()).toBe(29);
    expect(start.getDay()).toBe(0); // Sunday
  });

  it("throws error for invalid week ID format", () => {
    expect(() => getWeekBounds("invalid")).toThrow("Invalid week ID format");
    expect(() => getWeekBounds("2025-03")).toThrow("Invalid week ID format");
    expect(() => getWeekBounds("2025-W3")).toThrow("Invalid week ID format");
  });

  it("roundtrips correctly - getWeekId of mid-week date returns same week ID", () => {
    // Note: bounds.start is Sunday, which may be in the previous ISO week
    // (ISO weeks are Mon-Sun, our calendar weeks are Sun-Sat)
    // Use Wednesday (start + 3) which is always in the same ISO week
    const weekId = "2025-W15";
    const { start } = getWeekBounds(weekId);
    const wednesday = addDays(start, 3);
    expect(getWeekId(wednesday)).toBe(weekId);
  });
});

describe("getWeeksInRange", () => {
  it("returns single week for dates within the same week", () => {
    const start = new Date(2025, 0, 13); // Monday
    const end = new Date(2025, 0, 15); // Wednesday
    const weeks = getWeeksInRange(start, end);
    expect(weeks).toEqual(["2025-W03"]);
  });

  it("returns two weeks for dates spanning a week boundary", () => {
    const start = new Date(2025, 0, 17); // Friday of week 3
    const end = new Date(2025, 0, 20); // Monday of week 4
    const weeks = getWeeksInRange(start, end);
    expect(weeks).toEqual(["2025-W03", "2025-W04"]);
  });

  it("returns multiple weeks for a month-long range", () => {
    const start = new Date(2025, 0, 1); // January 1
    const end = new Date(2025, 0, 31); // January 31
    const weeks = getWeeksInRange(start, end);
    // January 2025 spans weeks 1-5
    expect(weeks.length).toBeGreaterThanOrEqual(4);
    expect(weeks[0]).toBe("2025-W01");
  });

  it("handles year boundary correctly", () => {
    const start = new Date(2024, 11, 28); // December 28, 2024
    const end = new Date(2025, 0, 4); // January 4, 2025
    const weeks = getWeeksInRange(start, end);
    expect(weeks).toContain("2024-W52");
    expect(weeks).toContain("2025-W01");
  });

  it("returns empty array for invalid range (end before start)", () => {
    const start = new Date(2025, 0, 15);
    const end = new Date(2025, 0, 10);
    const weeks = getWeeksInRange(start, end);
    expect(weeks).toEqual([]);
  });

  it("handles same day range", () => {
    const date = new Date(2025, 0, 15);
    const weeks = getWeeksInRange(date, date);
    expect(weeks).toEqual(["2025-W03"]);
  });
});

describe("getNextWeek", () => {
  it("returns the next week ID", () => {
    expect(getNextWeek("2025-W03")).toBe("2025-W04");
  });

  it("handles year boundary - week 52 to week 1", () => {
    expect(getNextWeek("2024-W52")).toBe("2025-W01");
  });

  it("handles week 1 to week 2", () => {
    expect(getNextWeek("2025-W01")).toBe("2025-W02");
  });

  it("is inverse of getPreviousWeek", () => {
    const original = "2025-W15";
    const next = getNextWeek(original);
    const backToOriginal = getPreviousWeek(next);
    expect(backToOriginal).toBe(original);
  });
});

describe("getPreviousWeek", () => {
  it("returns the previous week ID", () => {
    expect(getPreviousWeek("2025-W04")).toBe("2025-W03");
  });

  it("handles year boundary - week 1 to week 52 of previous year", () => {
    expect(getPreviousWeek("2025-W01")).toBe("2024-W52");
  });

  it("handles week 2 to week 1", () => {
    expect(getPreviousWeek("2025-W02")).toBe("2025-W01");
  });

  it("is inverse of getNextWeek", () => {
    const original = "2025-W15";
    const prev = getPreviousWeek(original);
    const backToOriginal = getNextWeek(prev);
    expect(backToOriginal).toBe(original);
  });
});

describe("addDays", () => {
  it("adds positive days correctly", () => {
    const date = new Date(2025, 0, 15);
    const result = addDays(date, 5);
    expect(result.getDate()).toBe(20);
  });

  it("subtracts days with negative number", () => {
    const date = new Date(2025, 0, 15);
    const result = addDays(date, -5);
    expect(result.getDate()).toBe(10);
  });

  it("handles month boundary", () => {
    const date = new Date(2025, 0, 30);
    const result = addDays(date, 5);
    expect(result.getMonth()).toBe(1); // February
    expect(result.getDate()).toBe(4);
  });

  it("does not mutate original date", () => {
    const date = new Date(2025, 0, 15);
    const originalTime = date.getTime();
    addDays(date, 5);
    expect(date.getTime()).toBe(originalTime);
  });
});

describe("getSundayOfWeek", () => {
  it("returns same date for Sunday input", () => {
    const sunday = new Date(2025, 0, 12); // Sunday
    const result = getSundayOfWeek(sunday);
    expect(result.getDate()).toBe(12);
    expect(result.getDay()).toBe(0);
  });

  it("returns previous Sunday for mid-week date", () => {
    const wednesday = new Date(2025, 0, 15); // Wednesday
    const result = getSundayOfWeek(wednesday);
    expect(result.getDate()).toBe(12); // Previous Sunday
    expect(result.getDay()).toBe(0);
  });

  it("returns previous Sunday for Saturday", () => {
    const saturday = new Date(2025, 0, 18); // Saturday
    const result = getSundayOfWeek(saturday);
    expect(result.getDate()).toBe(12); // Previous Sunday
    expect(result.getDay()).toBe(0);
  });

  it("normalizes to midnight", () => {
    const dateWithTime = new Date(2025, 0, 15, 14, 30, 45);
    const result = getSundayOfWeek(dateWithTime);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });

  it("does not mutate original date", () => {
    const date = new Date(2025, 0, 15, 14, 30);
    const originalTime = date.getTime();
    getSundayOfWeek(date);
    expect(date.getTime()).toBe(originalTime);
  });
});

describe("getWeekId DST resilience", () => {
  it("returns correct week ID for summer dates (past DST spring-forward)", () => {
    // July 7, 2026 (Tuesday) — deep in summer time (UTC+2 in CET zones)
    // DST spring-forward in March causes getTime()-based arithmetic to lose an hour
    // if not using UTC, leading to off-by-one week IDs.
    const date = new Date(2026, 6, 7);
    expect(getWeekId(date)).toBe("2026-W28");
  });

  it("returns correct week ID near DST spring-forward boundary", () => {
    // March 30, 2025 (Sunday, DST spring-forward day in CET)
    const date = new Date(2025, 2, 30);
    const weekId = getWeekId(date);
    // Verify roundtrip: bounds of this week should contain the date
    const { start, end } = getWeekBounds(weekId);
    expect(date.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(date.getTime()).toBeLessThanOrEqual(end.getTime());
  });

  it("returns correct week ID near DST fall-back boundary", () => {
    // October 26, 2025 (Sunday, DST fall-back day in CET)
    const date = new Date(2025, 9, 26);
    const weekId = getWeekId(date);
    const { start, end } = getWeekBounds(weekId);
    expect(date.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(date.getTime()).toBeLessThanOrEqual(end.getTime());
  });
});

describe("Week calculation consistency", () => {
  it("consecutive days have consistent week boundaries (weeks change on Sunday)", () => {
    // Our calendar uses Sunday-Saturday weeks, so week IDs change on Sunday
    const startDate = new Date(2025, 0, 1);
    let lastWeekId = getWeekId(startDate);
    let lastDayOfWeek = startDate.getDay();

    for (let i = 1; i < 365; i++) {
      const date = addDays(startDate, i);
      const weekId = getWeekId(date);
      const dayOfWeek = date.getDay();

      // Week ID should only change when we cross from Saturday (6) to Sunday (0)
      // (Our weeks end on Saturday and start on Sunday)
      if (weekId !== lastWeekId) {
        expect(dayOfWeek).toBe(0); // Sunday
        expect(lastDayOfWeek).toBe(6); // Previous day was Saturday
      }

      lastWeekId = weekId;
      lastDayOfWeek = dayOfWeek;
    }
  });

  it("getWeeksInRange covers all days in the range", () => {
    const start = new Date(2025, 0, 1);
    const end = new Date(2025, 2, 31); // 3 months
    const weeks = getWeeksInRange(start, end);

    // Verify each day in range is covered by one of the weeks
    let current = new Date(start);
    while (current <= end) {
      const weekId = getWeekId(current);
      expect(weeks).toContain(weekId);
      current = addDays(current, 1);
    }
  });
});
