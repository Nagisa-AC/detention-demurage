import { describe, expect, it } from "vitest";
import { packageId } from "./index.js";

describe("dd-cli", () => {
  it("identifies the package", () => {
    expect(packageId).toBe("dd-cli");
  });
});
