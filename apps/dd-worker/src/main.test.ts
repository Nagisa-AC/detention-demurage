import { SSMClient } from "@aws-sdk/client-ssm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "./main.js";

describe("worker startup", () => {
  const previousHome = process.env.HOME;

  afterEach(() => {
    vi.restoreAllMocks();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  });

  it("sets HOME when it is missing", async () => {
    vi.spyOn(SSMClient.prototype, "send").mockRejectedValue(new Error("stop"));

    delete process.env.HOME;
    await expect(main()).rejects.toThrow("stop");
    expect(process.env.HOME).toBe("/tmp");

    process.env.HOME = "";
    await expect(main()).rejects.toThrow("stop");
    expect(process.env.HOME).toBe("/tmp");
  });
});
