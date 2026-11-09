import { describe, expect, it } from "vitest";
import { unreadable } from "./dates.js";
import { parseContainer } from "./container.js";

describe("parseContainer", () => {
  const accepted = [
    "CSQU3054383",
    "csqu3054383",
    "CSQU 305438 3",
    "  csqu 305438 3  ",
    "CSQU-305438-3",
    "CSQU305438-3",
    "CSQU 305438-3",
    "csqu-305438-3",
    "MSCU1234566",
    "SLLU0000011",
    "SLLU0000027",
    "SLLU0000032",
    "SLLU0000048",
    "SLLU0000053",
    "SLLU0000069",
    "SLLU0000074",
    "SLLU0000080",
    "CSQJ0000010",
    "CSQZ0000010",
  ];

  it("returns the uppercase number with separators removed", () => {
    const expected: Record<string, string> = {
      csqu3054383: "CSQU3054383",
      "CSQU 305438 3": "CSQU3054383",
      "  csqu 305438 3  ": "CSQU3054383",
      "CSQU-305438-3": "CSQU3054383",
      "CSQU305438-3": "CSQU3054383",
      "CSQU 305438-3": "CSQU3054383",
      "csqu-305438-3": "CSQU3054383",
    };
    for (const text of accepted) {
      expect(parseContainer(text), text).toBe(expected[text] ?? text);
    }
  });

  it("returns unreadable for a bad check digit, a suffix, or a hyphenated size code", () => {
    const rejected = [
      "",
      "   ",
      "CSQU3054384",
      "CSQU305438",
      "CSQU30543833",
      "SLLU0000081",
      "CSQU3054383 22G1",
      "CSQU3054383-22G1",
    ];
    for (const text of rejected) {
      expect(parseContainer(text), text).toBe(unreadable);
    }
  });

  it("rejects a passing check digit when the category letter is O", () => {
    expect(parseContainer("CSQO3054380")).toBe(unreadable);
  });
});
