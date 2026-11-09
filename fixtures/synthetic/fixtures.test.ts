import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { extractPages, foldText } from "./extract-text.mjs";
import { isValidContainer } from "./iso6346.mjs";
import { ELEMENT_KEYS, LABELS } from "./labels.mjs";

const SPEC_ELEMENT_KEYS = [
  "bl_number",
  "container_number",
  "port_of_discharge",
  "billed_party_basis",
  "invoice_date",
  "invoice_due_date",
  "free_time_days",
  "free_time_start",
  "free_time_end",
  "container_availability_date",
  "earliest_return_date",
  "charged_dates",
  "total_due",
  "applicable_rule",
  "rates",
  "dispute_contact",
  "dispute_info_link",
  "dispute_timeframes",
  "cert_rules_compliance",
  "cert_no_contribution",
] as const;

const CERT_RULES =
  "The charges are consistent with the Federal Maritime Commission's demurrage and detention rules, including 46 CFR part 541 and 46 CFR 545.5.";

const BASIS = "Harbor Home Goods is the consignee named on the bill of lading.";

const root = path.dirname(fileURLToPath(import.meta.url));
const ids = [
  "clean",
  "missing_elements",
  "late_37",
  "free_time_overbill",
  "arithmetic",
  "duplicate_a",
  "duplicate_b",
  "split_row",
] as const;

const DISPUTE = "disputes@sample-line.example";

const carrierNames = [
  "Maersk",
  "Hapag-Lloyd",
  "Hapag",
  "Mediterranean Shipping",
  "COSCO",
  "Evergreen",
  "CMA CGM",
  "Yang Ming",
  "ZIM",
  "Hyundai Merchant Marine",
  "Ocean Network Express",
];

type ElementValue = {
  state: "present" | "suggested_absent" | "not_applicable";
  text?: string;
  page: number | null;
};

type ChargeLine = {
  container: string;
  charge: string;
  charged_from: string;
  charged_to: string;
  days: string;
  rate: string;
  amount: string;
  placement:
    | { kind: "row"; page: number }
    | { kind: "split"; head_page: number; tail_page: number };
};

type Finding = {
  rule: string;
  ground: string;
  disputable_amount?: string;
  currency?: string;
  overlapping_days?: number;
  part?: string;
  citation?: string;
  citations?: string[];
};

type Invoice = {
  id: string;
  invoice_number: string;
  pages: number;
  movement: string;
  reissue_of: null;
  elements: Record<string, ElementValue>;
  charge_lines: ChargeLine[];
  total_due: string;
  expected_findings: Finding[];
  convention_sensitive?: boolean;
  by_convention?: {
    day1: { chargeable_days: number; expected_amount: string; finding: Finding };
    day0: { chargeable_days: number; expected_amount: string; finding: Finding };
  };
  review_cases?: {
    before_review: { rule: string; outcome: string };
    after_review: {
      confirmed_absent: string[];
      finding: Finding;
    };
  };
};

const invoices = new Map<string, Invoice>();
const pageText = new Map<string, string[]>();

function utc(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1);
}

function addDays(iso: string, days: number): string {
  const date = new Date(utc(iso));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function overlapDays(left: ChargeLine, right: ChargeLine): number {
  const start = Math.max(utc(left.charged_from), utc(right.charged_from));
  const end = Math.min(utc(left.charged_to), utc(right.charged_to));
  if (end < start) {
    return 0;
  }
  return (end - start) / 86_400_000 + 1;
}

function readInvoice(id: string): Invoice {
  const file = path.join(root, `${id}.json`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as Invoice;
}

describe("synthetic fixtures", () => {
  it("uses the 541.6 element keys in paragraph order", () => {
    expect(ELEMENT_KEYS).toEqual([...SPEC_ELEMENT_KEYS]);
  });

  beforeAll(async () => {
    for (const id of ids) {
      invoices.set(id, readInvoice(id));
      pageText.set(id, await extractPages(path.join(root, `${id}.pdf`)));
    }
  });

  it("keeps each present value on its page and keeps suggested-absent text off the PDF", () => {
    for (const id of ids) {
      const invoice = invoices.get(id);
      const pages = pageText.get(id);
      expect(invoice).toBeDefined();
      expect(pages).toBeDefined();
      if (!invoice || !pages) {
        continue;
      }
      expect(pages).toHaveLength(invoice.pages);
      const document = foldText(pages.join("\n"));
      expect(Object.keys(invoice.elements)).toEqual([...ELEMENT_KEYS]);
      const earliest = invoice.elements.earliest_return_date;
      expect(earliest?.state).toBe("not_applicable");
      expect(earliest?.page).toBeNull();

      for (const [key, element] of Object.entries(invoice.elements)) {
        const label = LABELS[key] ?? key;
        if (element.state === "present") {
          expect(element.page).toBeGreaterThan(0);
          const page = pages[(element.page ?? 1) - 1] ?? "";
          expect(foldText(page)).toContain(foldText(element.text ?? ""));
        }
        if (element.state === "suggested_absent") {
          expect(element.page).toBeNull();
          expect(document).not.toContain(foldText(label));
          if (element.text !== undefined) {
            expect(document).not.toContain(foldText(element.text));
          }
        }
      }
    }
  });

  it("runs the carrier denylist across fixtures", async () => {
    const fixturesRoot = path.resolve(root, "..");
    const files = fixtureFiles(fixturesRoot);
    const relative = files.map((file) => path.relative(fixturesRoot, file));
    expect(relative).toContain(path.join("config", "harbor_home.yaml"));
    expect(relative).toContain(path.join("synthetic", "clean.pdf"));
    expect(relative.some((file) => file.endsWith(".test.ts"))).toBe(false);

    for (const file of files) {
      const text = file.endsWith(".pdf") ? (await extractPages(file)).join("\n") : fs.readFileSync(file, "utf8");
      const folded = text.toLowerCase();
      for (const name of carrierNames) {
        expect(folded, `${path.relative(fixturesRoot, file)} contains ${name}`).not.toContain(name.toLowerCase());
      }
    }
  });

  it("gives every invoice its own container except the duplicate pair", () => {
    const seen = new Map<string, string[]>();
    for (const id of ids) {
      const invoice = invoices.get(id);
      expect(invoice).toBeDefined();
      if (!invoice) {
        continue;
      }
      const containers = new Set(invoice.charge_lines.map((line) => line.container));
      expect(containers.size).toBe(1);
      const container = invoice.charge_lines[0]?.container ?? "";
      expect(container.startsWith("SLLU")).toBe(true);
      expect(container.startsWith("CSQU")).toBe(false);
      expect(isValidContainer(container)).toBe(true);
      const owners = seen.get(container) ?? [];
      owners.push(id);
      seen.set(container, owners);
    }
    const shared = [...seen.entries()].filter(([, owners]) => owners.length > 1);
    expect(shared).toEqual([["SLLU0000069", ["duplicate_a", "duplicate_b"]]]);
    const earlier = invoices.get("duplicate_a");
    const later = invoices.get("duplicate_b");
    expect(earlier?.elements.bl_number?.text).toBe(later?.elements.bl_number?.text);
    expect(earlier?.elements.free_time_start?.text).toBe(later?.elements.free_time_start?.text);
    expect(earlier?.elements.free_time_end?.text).toBe(later?.elements.free_time_end?.text);
    expect(earlier?.elements.container_availability_date?.text).toBe(
      later?.elements.container_availability_date?.text,
    );
  });

  it("starts charges the day after free time ends, except the overbill and the later duplicate", () => {
    for (const id of ids) {
      const invoice = invoices.get(id);
      if (!invoice) {
        continue;
      }
      const freeEnd = invoice.elements.free_time_end?.text;
      if (freeEnd === undefined) {
        continue;
      }
      const start = invoice.charge_lines[0]?.charged_from;
      if (id === "free_time_overbill" || id === "duplicate_b") {
        expect(start).not.toBe(addDays(freeEnd, 1));
        continue;
      }
      expect(start).toBe(addDays(freeEnd, 1));
    }
  });

  it("finds one R5 overlap, on the later duplicate invoice", () => {
    const findings: { id: string; days: number; amount: string }[] = [];
    const ordered = ids.map((id) => invoices.get(id)).filter((invoice): invoice is Invoice => invoice !== undefined);
    for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
        const left = ordered[leftIndex];
        const right = ordered[rightIndex];
        if (!left || !right || left.reissue_of || right.reissue_of) {
          continue;
        }
        for (const leftLine of left.charge_lines) {
          for (const rightLine of right.charge_lines) {
            if (leftLine.container !== rightLine.container || leftLine.charge !== rightLine.charge) {
              continue;
            }
            const days = overlapDays(leftLine, rightLine);
            if (days <= 0) {
              continue;
            }
            const leftDate = left.elements.invoice_date?.text ?? "";
            const rightDate = right.elements.invoice_date?.text ?? "";
            const later = leftDate > rightDate ? left : right;
            const laterLine = later.id === left.id ? leftLine : rightLine;
            const cents = days * Math.round(Number(laterLine.rate) * 100);
            findings.push({
              id: later.id,
              days,
              amount: (cents / 100).toFixed(2),
            });
          }
        }
      }
    }
    expect(findings).toEqual([{ id: "duplicate_b", days: 3, amount: "600.00" }]);
    expect(invoices.get("duplicate_b")?.expected_findings).toEqual([
      {
        rule: "R5",
        ground: "duplicate_charge",
        overlapping_days: 3,
        disputable_amount: "600.00",
        currency: "USD",
      },
    ]);
  });

  it("records the missing-elements review outcomes", () => {
    const invoice = invoices.get("missing_elements");
    expect(invoice?.review_cases?.before_review).toEqual({ rule: "R1", outcome: "not_evaluable" });
    expect(invoice?.review_cases?.after_review.confirmed_absent).toEqual([
      "free_time_start",
      "free_time_end",
      "cert_rules_compliance",
      "cert_no_contribution",
    ]);
    expect(invoice?.review_cases?.after_review.finding).toEqual({
      rule: "R1",
      ground: "missing_information",
      citations: [
        "46 CFR 541.6(b)(4)",
        "46 CFR 541.6(b)(5)",
        "46 CFR 541.6(e)(1)",
        "46 CFR 541.6(e)(2)",
      ],
      disputable_amount: invoice?.total_due,
      currency: "USD",
    });
    expect(invoice?.expected_findings).toEqual([]);
  });

  it("bills the consignee and certifies rule compliance on the clean invoice", () => {
    for (const id of ids) {
      expect(invoices.get(id)?.elements.billed_party_basis?.text).toBe(BASIS);
    }
    const clean = invoices.get("clean");
    expect(clean?.elements.cert_rules_compliance).toEqual({
      state: "present",
      text: CERT_RULES,
      page: 1,
    });
    const pages = pageText.get("clean") ?? [];
    expect(foldText(pages[0] ?? "")).toContain(foldText(CERT_RULES));
  });

  it("records both free-time conventions and both arithmetic defects", () => {
    const overbill = invoices.get("free_time_overbill");
    expect(overbill?.convention_sensitive).toBe(true);
    expect(overbill?.by_convention?.day1).toEqual({
      chargeable_days: 6,
      expected_amount: "1100.00",
      finding: {
        rule: "R3",
        ground: "billing_error",
        disputable_amount: "500.00",
        currency: "USD",
      },
    });
    expect(overbill?.by_convention?.day0).toEqual({
      chargeable_days: 5,
      expected_amount: "850.00",
      finding: {
        rule: "R3",
        ground: "billing_error",
        disputable_amount: "750.00",
        currency: "USD",
      },
    });
    expect(overbill?.total_due).toBe("1600.00");
    expect(invoices.get("late_37")?.expected_findings[0]?.ground).toBe("late_invoice");
    expect(invoices.get("arithmetic")?.expected_findings).toEqual([
      { rule: "R4", ground: "billing_error", part: "line", disputable_amount: "250.00", currency: "USD" },
      { rule: "R4", ground: "billing_error", part: "total", disputable_amount: "250.00", currency: "USD" },
    ]);
  });

  it("splits one charge row across page 2 and page 3", () => {
    const invoice = invoices.get("split_row");
    const pages = pageText.get("split_row");
    expect(invoice?.pages).toBe(3);
    expect(pages).toHaveLength(3);
    const line = invoice?.charge_lines.find((entry) => entry.placement.kind === "split");
    expect(line?.placement).toEqual({ kind: "split", head_page: 2, tail_page: 3 });
    if (!line || !pages) {
      return;
    }
    expect(foldText(pages[1] ?? "")).toContain(line.container);
    expect(foldText(pages[1] ?? "")).not.toContain(line.amount);
    expect(foldText(pages[2] ?? "")).toContain(line.amount);
    expect(foldText(pages[2] ?? "")).not.toContain(line.container);
    expect(foldText(pages[0] ?? "")).not.toContain(foldText(LABELS.dispute_contact ?? ""));
    expect(foldText(pages[2] ?? "")).toContain(DISPUTE);
  });
});

function fixtureFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...fixtureFiles(full));
    } else if (!entry.name.endsWith(".test.ts")) {
      found.push(full);
    }
  }
  return found;
}
