import { describe, expect, it } from "vitest";
import {
  addDays,
  dateKeyFromTimestamp,
  formatDayStart,
  isAfterMidnight,
  normalizeTag,
  timeOfDay,
} from "@journal/shared";

const MIDNIGHT = { timeZone: "Europe/Berlin", startHour: 0 };
const BERLIN = { timeZone: "Europe/Berlin", startHour: 4 };

describe("dateKeyFromTimestamp", () => {
  it("keeps a late-evening entry on the local day, not the UTC one", () => {
    // 2026-03-01 23:30 local (UTC+1) is 22:30 UTC — same day either way.
    expect(dateKeyFromTimestamp(Date.parse("2026-03-01T22:30:00Z"), MIDNIGHT)).toBe("2026-03-01");
    // 2026-03-01 00:30 local is 2026-02-28 23:30 UTC — UTC slicing would be wrong.
    expect(dateKeyFromTimestamp(Date.parse("2026-02-28T23:30:00Z"), MIDNIGHT)).toBe("2026-03-01");
  });

  it("hands the small hours back to the day before", () => {
    // 2026-03-01 01:30 local, within the 04:00 boundary.
    expect(dateKeyFromTimestamp(Date.parse("2026-03-01T00:30:00Z"), BERLIN)).toBe("2026-02-28");
    // 03:59 is still the night before; 04:00 starts the new day.
    expect(dateKeyFromTimestamp(Date.parse("2026-03-01T02:59:00Z"), BERLIN)).toBe("2026-02-28");
    expect(dateKeyFromTimestamp(Date.parse("2026-03-01T03:00:00Z"), BERLIN)).toBe("2026-03-01");
    // The evening is untouched.
    expect(dateKeyFromTimestamp(Date.parse("2026-03-01T22:30:00Z"), BERLIN)).toBe("2026-03-01");
  });

  it("crosses a month boundary backwards", () => {
    // 2026-04-01 02:00 local belongs to March.
    expect(dateKeyFromTimestamp(Date.parse("2026-04-01T00:00:00Z"), BERLIN)).toBe("2026-03-31");
  });

  it("handles the spring DST jump", () => {
    // Berlin springs forward at 02:00 on 2026-03-29, so 02:00–02:59 never happens.
    expect(dateKeyFromTimestamp(Date.parse("2026-03-29T00:30:00Z"), MIDNIGHT)).toBe("2026-03-29");
    expect(dateKeyFromTimestamp(Date.parse("2026-03-29T22:30:00Z"), MIDNIGHT)).toBe("2026-03-30");
    expect(timeOfDay(Date.parse("2026-03-29T00:30:00Z"), "Europe/Berlin")).toBe("01:30");
    expect(timeOfDay(Date.parse("2026-03-29T01:30:00Z"), "Europe/Berlin")).toBe("03:30");
    // 01:30 local is before the boundary; 03:30 local is past it.
    expect(dateKeyFromTimestamp(Date.parse("2026-03-29T00:30:00Z"), BERLIN)).toBe("2026-03-28");
    expect(dateKeyFromTimestamp(Date.parse("2026-03-29T01:30:00Z"), BERLIN)).toBe("2026-03-28");
    expect(dateKeyFromTimestamp(Date.parse("2026-03-29T02:30:00Z"), BERLIN)).toBe("2026-03-29");
  });

  it("handles the autumn DST fallback", () => {
    expect(dateKeyFromTimestamp(Date.parse("2026-10-24T22:30:00Z"), MIDNIGHT)).toBe("2026-10-25");
    expect(dateKeyFromTimestamp(Date.parse("2026-10-25T23:30:00Z"), MIDNIGHT)).toBe("2026-10-26");
    // 2026-10-26 01:30 local (UTC+1 again) is still the night of the 25th.
    expect(dateKeyFromTimestamp(Date.parse("2026-10-26T00:30:00Z"), BERLIN)).toBe("2026-10-25");
  });

  it("respects other timezones", () => {
    const ts = Date.parse("2026-09-08T02:00:00Z");
    expect(dateKeyFromTimestamp(ts, { timeZone: "UTC", startHour: 0 })).toBe("2026-09-08");
    expect(dateKeyFromTimestamp(ts, { timeZone: "UTC", startHour: 4 })).toBe("2026-09-07");
    expect(dateKeyFromTimestamp(ts, { timeZone: "America/Los_Angeles", startHour: 0 })).toBe(
      "2026-09-07",
    );
  });
});

describe("isAfterMidnight", () => {
  it("marks only the hours the boundary moved", () => {
    expect(isAfterMidnight(Date.parse("2026-03-01T00:30:00Z"), BERLIN)).toBe(true);
    expect(isAfterMidnight(Date.parse("2026-03-01T22:30:00Z"), BERLIN)).toBe(false);
    expect(isAfterMidnight(Date.parse("2026-03-01T00:30:00Z"), MIDNIGHT)).toBe(false);
  });
});

describe("formatDayStart", () => {
  it("reads as a wall-clock time", () => {
    expect(formatDayStart(4)).toBe("04:00");
    expect(formatDayStart(11)).toBe("11:00");
  });
});

describe("addDays", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  });
});

describe("normalizeTag", () => {
  it("folds case, strips leading hashes, and hyphenates spaces", () => {
    expect(normalizeTag("  #Deep Work ")).toBe("deep-work");
    expect(normalizeTag("Café")).toBe("caf");
    expect(normalizeTag("###")).toBe("");
  });
});
