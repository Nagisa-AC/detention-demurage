import { afterEach, describe, expect, it } from "vitest";
import { saveCustomerSettings } from "./settings";

const savedUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (savedUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedUrl;
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
