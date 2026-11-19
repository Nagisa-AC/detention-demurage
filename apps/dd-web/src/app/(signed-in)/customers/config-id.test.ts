import { describe, expect, it } from "vitest";
import { CONFIG_ID, suggestConfigId } from "./config-id";

describe("suggestConfigId", () => {
  it("lowercases the name and joins words with underscores", () => {
    expect(suggestConfigId("Acme Imports")).toBe("acme_imports");
    expect(suggestConfigId("  Harbor Home Goods ")).toBe("harbor_home_goods");
    expect(suggestConfigId("O'Brien & Co.")).toBe("o_brien_co");
    expect(CONFIG_ID.test(suggestConfigId("Acme Imports"))).toBe(true);
  });
});
