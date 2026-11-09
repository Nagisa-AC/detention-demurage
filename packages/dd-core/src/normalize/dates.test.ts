import { describe, expect, it } from "vitest";
import { addDays, dayCount, parseDate, unreadable, type FormatHint } from "./dates.js";

describe("parseDate", () => {
  const parsed: { text: string; hint?: FormatHint; iso: string }[] = [
    { text: "2026-03-02", iso: "2026-03-02" },
    { text: "  2026-03-02  ", iso: "2026-03-02" },
    { text: "02-MAR-2026", iso: "2026-03-02" },
    { text: "2-mar-2026", iso: "2026-03-02" },
    { text: "2 March 2026", iso: "2026-03-02" },
    { text: "02 march 2026", iso: "2026-03-02" },
    { text: "2 Mar 2026", iso: "2026-03-02" },
    { text: "Mar 2, 2026", iso: "2026-03-02" },
    { text: "March 2, 2026", iso: "2026-03-02" },
    { text: "mar 2 2026", iso: "2026-03-02" },
    { text: "MARCH 2,2026", iso: "2026-03-02" },
    { text: "September 2, 2026", iso: "2026-09-02" },
    { text: "Sep 2, 2026", iso: "2026-09-02" },
    { text: "2024-02-29", iso: "2024-02-29" },
    { text: "02.03.2026", hint: "DMY", iso: "2026-03-02" },
    { text: "02.03.2026", hint: "MDY", iso: "2026-02-03" },
    { text: "03/02/2026", hint: "MDY", iso: "2026-03-02" },
    { text: "03/02/2026", hint: "DMY", iso: "2026-02-03" },
    { text: "13/02/2026", hint: "DMY", iso: "2026-02-13" },
    { text: "02/13/2026", hint: "MDY", iso: "2026-02-13" },
    { text: "3/2/2026", hint: "MDY", iso: "2026-03-02" },
  ];

  it("parses each accepted form to an ISO string", () => {
    for (const entry of parsed) {
      const result = entry.hint === undefined ? parseDate(entry.text) : parseDate(entry.text, entry.hint);
      expect(result, `${entry.text} ${entry.hint ?? ""}`).toBe(entry.iso);
      expect(typeof result).toBe("string");
    }
  });

  it("ignores a hint on an ISO or month-name date", () => {
    expect(parseDate("2026-03-02", "MDY")).toBe("2026-03-02");
    expect(parseDate("2 March 2026", "DMY")).toBe("2026-03-02");
    expect(parseDate("Mar 2, 2026", "MDY")).toBe("2026-03-02");
  });

  it("returns unreadable when the form is missing, ambiguous, or impossible", () => {
    const rejected = [
      "03/02/2026",
      "02.03.2026",
      "13/02/2026",
      "2026-3-2",
      "2026-02-31",
      "2026-02-29",
      "31-APR-2026",
      "02-MARCH-2026",
      "March 2, 26",
      "2026-03-02T00:00:00",
      "2nd March 2026",
      "2 March, 2026",
      "March 32, 2026",
      "",
      "   ",
    ];
    for (const text of rejected) {
      expect(parseDate(text), text).toBe(unreadable);
    }
    expect(parseDate("13/02/2026", "MDY")).toBe(unreadable);
    expect(parseDate("02.13.2026", "DMY")).toBe(unreadable);
  });
});

describe("dayCount and addDays", () => {
  it("counts the start as day 0 or day 1", () => {
    expect(dayCount("2026-03-02", "2026-03-02", "day0")).toBe(0);
    expect(dayCount("2026-03-02", "2026-03-02", "day1")).toBe(1);
    expect(dayCount("2026-03-02", "2026-04-01", "day0")).toBe(30);
    expect(dayCount("2026-03-02", "2026-04-01", "day1")).toBe(31);
    expect(dayCount("2026-03-02", "2026-04-08", "day0")).toBe(37);
    expect(dayCount("2026-03-02", "2026-04-08", "day1")).toBe(38);
    expect(dayCount("2026-04-01", "2026-03-02", "day0")).toBe(-30);
    expect(dayCount("2026-04-01", "2026-03-02", "day1")).toBe(-29);
  });

  it("moves across month ends, year ends, and leap day", () => {
    expect(addDays("2026-03-02", 1)).toBe("2026-03-03");
    expect(addDays("2026-03-31", 1)).toBe("2026-04-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-02-29", 1)).toBe("2024-03-01");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("holds dayCount(a, addDays(a, n), day0) = n", () => {
    const anchors = [
      "2024-02-29",
      "2026-02-28",
      "2026-01-01",
      "2025-12-31",
      "2026-03-31",
      "2026-04-30",
      "1999-12-31",
      "2028-02-29",
    ];
    for (const anchor of anchors) {
      for (let n = -400; n <= 400; n += 1) {
        const shifted = addDays(anchor, n);
        expect(dayCount(anchor, shifted, "day0"), `${anchor} + ${n}`).toBe(n);
        expect(dayCount(anchor, shifted, "day1"), `${anchor} + ${n} day1`).toBe(n + 1);
      }
    }
  });

  it("throws when a date or a day count is not usable", () => {
    expect(() => addDays("2026-02-31", 1)).toThrow(TypeError);
    expect(() => addDays("03/02/2026", 1)).toThrow(TypeError);
    expect(() => addDays("2026-03-02", 1.5)).toThrow(TypeError);
    expect(() => dayCount("03/02/2026", "2026-03-02", "day0")).toThrow(TypeError);
    expect(() => dayCount("2026-03-02", "2026-03-03", "day2" as "day0")).toThrow(TypeError);
  });
});
