import { SSMClient } from "@aws-sdk/client-ssm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "./main.js";

describe("worker startup", () => {
  const previousHome = process.env.HOME;
  const previousTmp = process.env.TMPDIR;

  afterEach(() => {
    vi.restoreAllMocks();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmp;
  });

  it("sets HOME and TMPDIR when they are missing", async () => {
    vi.spyOn(SSMClient.prototype, "send").mockRejectedValue(new Error("stop"));

    delete process.env.HOME;
    delete process.env.TMPDIR;
    await expect(main()).rejects.toThrow("stop");
    expect(process.env.HOME).toBe("/tmp");
    expect(process.env.TMPDIR).toBe("/tmp");

    process.env.HOME = "";
    process.env.TMPDIR = "";
    await expect(main()).rejects.toThrow("stop");
    expect(process.env.HOME).toBe("/tmp");
    expect(process.env.TMPDIR).toBe("/tmp");
  });
});
