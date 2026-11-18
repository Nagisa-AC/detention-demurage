import { afterEach, describe, expect, it } from "vitest";
import { feePercent, saveCustomerSettings } from "./settings";

const savedUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (savedUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedUrl;
});

describe("fee percent", () => {
  it("shows the decimal fee as a percent", () => {
    expect(feePercent("0.25")).toBe("25%");
    expect(feePercent("0")).toBe("0%");
    expect(feePercent("1")).toBe("100%");
    expect(feePercent("1.00")).toBe("100%");
    expect(feePercent("0.5")).toBe("50%");
    expect(feePercent("0.125")).toBe("12.5%");
    expect(feePercent("0.025")).toBe("2.5%");
    expect(feePercent("0.250")).toBe("25%");
  });
});

describe("saveCustomerSettings", () => {
  it("stops when the database is not configured", async () => {
    delete process.env.DATABASE_URL;
    const result = await saveCustomerSettings({
      customerId: "1dd5e894-bac7-4ade-8d11-e60da1290c83",
      yaml: "id: harbor_home\n",
      actor: "Ada",
    });
    expect(result).toEqual({
      ok: false,
      problems: [{ path: "document", message: "the database is not configured" }],
    });
  });
});
