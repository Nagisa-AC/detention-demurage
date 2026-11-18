import { customerConfigSchema, type CustomerConfig } from "dd-core";
import { describe, expect, it } from "vitest";
import { optionsFromVersions } from "./billing-party";

describe("billing party options", () => {
  it("lists pursue and do-not-pursue from the current version only", () => {
    const older = config(["old_line"], []);
    const current = config(["sample_line", "cobalt_line"], ["northbay_line"]);
    expect(
      optionsFromVersions([
        { version: 2, config: current },
        { version: 1, config: older },
      ]),
    ).toEqual([
      { id: "sample_line", label: "sample_line" },
      { id: "cobalt_line", label: "cobalt_line" },
      { id: "northbay_line", label: "northbay_line (do not pursue)" },
    ]);
  });
});

function config(pursue: string[], skip: string[]): CustomerConfig {
  return customerConfigSchema.parse({
    id: "harbor_home",
    name: "Harbor Home Goods",
    fee_pct: "0.25",
    billed_party_role: "direct",
    nvocc: null,
    authorization: {
      document: "auth.pdf",
      signed_on: "2027-01-10",
      valid_until: "2028-01-10",
      covers: [...pursue, ...skip],
    },
    billing_parties: { pursue, do_not_pursue: skip },
    lookback_from: "2022-06-16",
    retention_days_after_close: 730,
  });
}
