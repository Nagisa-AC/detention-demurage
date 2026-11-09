import { describe, expect, it } from "vitest";
import { packageId } from "./index.js";

describe("dd-extract", () => {
  it("identifies the package", () => {
    expect(packageId).toBe("dd-extract");
  });
});
