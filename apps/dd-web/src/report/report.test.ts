import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ReviewSql } from "../review-data";
import { enqueueReport, knownFailure } from "./export";
import { exportRefusal, type ExportGate } from "./gate";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const open: ExportGate = {
  firmReady: true,
  hasSettings: true,
  checks: "ok",
  recorded: true,
  checksCurrent: true,
  invoiceCount: 8,
  unapproved: 0,
  pendingDocuments: 0,
};

describe("report export", () => {
  it("refuses the export in each blocked state and does not queue a run", async () => {
    expect(exportRefusal({ ...open, firmReady: false })).toBe("The firm profile is not set.");
    expect(exportRefusal({ ...open, hasSettings: false })).toBe("This customer has no settings.");
    expect(exportRefusal({ ...open, checks: "missing" })).toBe("Checks have not run.");
    expect(exportRefusal({ ...open, checks: "running" })).toBe("Checks are still running.");
    expect(exportRefusal({ ...open, checks: "failed" })).toBe("The latest checks run did not succeed.");
    expect(exportRefusal({ ...open, recorded: false })).toBe("The latest checks run has no per-invoice amounts. Run checks again.");
    expect(exportRefusal({ ...open, checksCurrent: false })).toBe("Checks have not run on every approved invoice. Run checks again.");
    expect(exportRefusal({ ...open, invoiceCount: 0 })).toBe("There are no invoices to report.");
    expect(exportRefusal({ ...open, unapproved: 1 })).toBe("An invoice is not approved.");
    expect(exportRefusal({ ...open, pendingDocuments: 1 })).toBe("An upload is waiting for review.");
    expect(exportRefusal(open)).toBeNull();

    const texts: string[] = [];
    const result = await enqueueReport(
      fakeSql((text) => {
        texts.push(text);
        return text.includes("display_name") ? [{ display_name: "Harbor Home Goods" }] : [];
      }),
      { customerId: "f3b01b7d-8f7a-493a-99ad-a39cb704db3a", actor: "Ada" },
    );
    expect(result).toEqual({ ok: false, reason: "The firm profile is not set." });
    expect(texts.some((text) => text.startsWith("INSERT"))).toBe(false);
  });

  it("shows only a fixed failure sentence", () => {
    expect(knownFailure("nope")).toBe("The report could not be built.");
    expect(knownFailure("The report could not be stored.")).toBe("The report could not be stored.");
    expect(knownFailure("This report is too large to build at once.")).toBe("This report is too large to build at once.");
    const web = fs.readFileSync(path.join(repoRoot, "apps/dd-web/src/report/export.ts"), "utf8");
    expect(web).not.toContain("@react-pdf/renderer");
    expect(web).not.toContain("pdf-lib");
  });

  it("seeds the firm profile in the migration and allows a report run", () => {
    const sql = fs.readFileSync(
      path.join(repoRoot, "apps/dd-web/prisma/migrations/20261118210000_firm_profile_report_export/migration.sql"),
      "utf8",
    );
    expect(sql).toContain("Tidemark Recovery");
    expect(sql).toContain("New Haven, CT");
    expect(sql).toContain("disputes@tidemark.example");
    expect(sql).toContain("Ibrahim Kebbeh");
    expect(sql).toContain("Principal");
    expect(sql).toContain('GRANT SELECT, INSERT ON TABLE "FirmProfileVersion", "ReportExport"');
    expect(sql).toContain('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "FirmProfileVersion", "ReportExport"');
    const kind = fs.readFileSync(
      path.join(repoRoot, "apps/dd-web/prisma/migrations/20261118223000_report_run_kind/migration.sql"),
      "utf8",
    );
    expect(kind).toContain("'report'");
  });
});

function fakeSql(rowsFor: (text: string) => Record<string, unknown>[]): ReviewSql {
  return {
    query: async <T extends Record<string, unknown>>(text: string) => ({ rows: rowsFor(text) as T[] }),
  };
}
