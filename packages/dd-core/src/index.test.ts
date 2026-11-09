import { describe, expect, it } from "vitest";
import { packageId } from "./index.js";

describe("dd-core", () => {
  it("identifies the package", () => {
    expect(packageId).toBe("dd-core");
  });
});
