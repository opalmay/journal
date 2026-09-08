import { describe, expect, it } from "vitest";
import { addDays, dateKeyFromTimestamp, normalizeTag, timeOfDay } from "@journal/shared";

const TZ = "Europe/Berlin";

describe("dateKeyFromTimestamp", () => {
  it("keeps a late-evening entry on the local day, not the UTC one", () => {
    // 2026-03-01 23:30 local (UTC+1) is 22:30 UTC — same day either way.
    expect(dateKeyFromTimestamp(Date.parse("2026-03-01T22:30:00Z"), TZ)).toBe("2026-03-01");
    // 2026-03-01 00:30 local is 2026-02-28 23:30 UTC — UTC slicing would be wrong.
    expect(dateKeyFromTimestamp(Date.parse("2026-02-28T23:30:00Z"), TZ)).toBe("2026-03-01");
  });

  it("handles the spring DST jump", () => {
    // Berlin springs forward at 02:00 on 2026-03-29.
    expect(dateKeyFromTimestamp(Date.parse("2026-03-29T00:30:00Z"), TZ)).toBe("2026-03-29");
    expect(dateKeyFromTimestamp(Date.parse("2026-03-29T22:30:00Z"), TZ)).toBe("2026-03-30");
    expect(timeOfDay(Date.parse("2026-03-29T00:30:00Z"), TZ)).toBe("01:30");
    expect(timeOfDay(Date.parse("2026-03-29T01:30:00Z"), TZ)).toBe("03:30");
  });

  it("handles the autumn DST fallback", () => {
    expect(dateKeyFromTimestamp(Date.parse("2026-10-24T22:30:00Z"), TZ)).toBe("2026-10-25");
    expect(dateKeyFromTimestamp(Date.parse("2026-10-25T23:30:00Z"), TZ)).toBe("2026-10-26");
  });

  it("respects other timezones", () => {
    const ts = Date.parse("2026-09-08T02:00:00Z");
    expect(dateKeyFromTimestamp(ts, "UTC")).toBe("2026-09-08");
    expect(dateKeyFromTimestamp(ts, "America/Los_Angeles")).toBe("2026-09-07");
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
