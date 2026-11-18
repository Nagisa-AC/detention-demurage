import { describe, expect, it } from "vitest";
import { initials } from "./initials";

describe("initials", () => {
  it("skips punctuation and parenthesized words", () => {
    expect(initials("Harbor Home Goods (synthetic)")).toBe("HH");
    expect(initials("Harbor Home Goods")).toBe("HH");
    expect(initials("Sample Line Logistics")).toBe("SL");
    expect(initials("A.B. Goods")).toBe("AB");
  });

  it("uses the first two letters of a single word", () => {
    expect(initials("Acme")).toBe("AC");
    expect(initials("  ")).toBe("—");
  });
});
