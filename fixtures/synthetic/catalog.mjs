import { ELEMENT_KEYS } from "./labels.mjs";
import { isValidContainer } from "./iso6346.mjs";

const BILLING_PARTY = "Sample Line Logistics";
const BILLED_PARTY = "Harbor Home Goods";
const PORT = "Port Sample";
const BASIS = "Harbor Home Goods is the consignee named on the bill of lading.";
const RATE_BASIS = "Sample Line Logistics demurrage schedule SL-1";
const DISPUTE_URL = "https://example.com/sample-line/mitigation";
const DISPUTE_TIME =
  "Request a waiver within 30 days. Sample Line Logistics resolves the request within 30 days.";
const DISPUTE_CONTACT = "disputes@sample-line.example";
const CERT_RULES =
  "The charges are consistent with the Federal Maritime Commission's demurrage and detention rules, including 46 CFR part 541 and 46 CFR 545.5.";
const CERT_PERFORMANCE =
  "The billing party's performance did not cause or contribute to these charges.";

const MISSING_FIELDS = [
  "free_time_start",
  "free_time_end",
  "cert_rules_compliance",
  "cert_no_contribution",
];

export const INVOICE_IDS = [
  "clean",
  "missing_elements",
  "late_37",
  "free_time_overbill",
  "arithmetic",
  "duplicate_a",
  "duplicate_b",
  "split_row",
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function utc(iso) {
  const parts = iso.split("-").map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  assert(year !== undefined && month !== undefined && day !== undefined, iso);
  return Date.UTC(year, month - 1, day);
}

function addDays(iso, days) {
  const date = new Date(utc(iso));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function inclusiveDays(from, to) {
  return (utc(to) - utc(from)) / 86_400_000 + 1;
}

function money(days, rate) {
  const cents = Math.round(Number(rate) * 100);
  return ((days * cents) / 100).toFixed(2);
}

function row(container, from, to, rate, placement, amount = money(inclusiveDays(from, to), rate)) {
  return {
    container,
    charge: "demurrage",
    charged_from: from,
    charged_to: to,
    days: String(inclusiveDays(from, to)),
    rate,
    amount,
    placement,
  };
}

function presentFields(input) {
  return {
    bl_number: { text: input.bl },
    container_number: { text: input.container },
    port_of_discharge: { text: PORT },
    billed_party_basis: { text: BASIS },
    invoice_date: { text: input.invoiceDate },
    invoice_due_date: { text: addDays(input.invoiceDate, 30) },
    free_time_days: { text: "5 days" },
    free_time_start: { text: input.freeStart },
    free_time_end: { text: input.freeEnd },
    container_availability_date: { text: input.freeStart },
    charged_dates: { text: `${input.chargedFrom} through ${input.chargedTo}` },
    total_due: { text: `${input.total} USD` },
    applicable_rule: { text: RATE_BASIS },
    rates: { text: input.rateText },
    dispute_contact: { text: DISPUTE_CONTACT, page: input.contactPage ?? 1 },
    dispute_info_link: { text: DISPUTE_URL },
    dispute_timeframes: { text: DISPUTE_TIME },
    cert_rules_compliance: { text: CERT_RULES },
    cert_no_contribution: { text: CERT_PERFORMANCE },
  };
}

function buildInvoice(spec) {
  const absent = new Set(spec.absent ?? []);
  const fields = presentFields(spec);
  if (spec.contactPage) {
    fields.dispute_contact = { text: DISPUTE_CONTACT, page: spec.contactPage };
  }
  const elements = {};
  for (const key of ELEMENT_KEYS) {
    if (key === "earliest_return_date") {
      elements[key] = { state: "not_applicable", page: null };
      continue;
    }
    if (absent.has(key)) {
      const text = spec.absentText?.[key];
      elements[key] = text === undefined
        ? { state: "suggested_absent", page: null }
        : { state: "suggested_absent", page: null, text };
      continue;
    }
    const field = fields[key];
    assert(field !== undefined, `${spec.id} missing ${key}`);
    elements[key] = {
      state: "present",
      text: field.text,
      page: field.page ?? 1,
    };
  }

  const invoice = {
    id: spec.id,
    invoice_number: spec.invoiceNumber,
    pages: spec.pages ?? 1,
    movement: "import",
    currency: "USD",
    billing_party: BILLING_PARTY,
    billed_party: BILLED_PARTY,
    reissue_of: null,
    elements,
    charge_lines: spec.lines,
    total_due: spec.total,
    expected_findings: spec.expectedFindings ?? [],
  };
  if (spec.byConvention) {
    invoice.convention_sensitive = true;
    invoice.by_convention = spec.byConvention;
  }
  if (spec.reviewCases) {
    invoice.review_cases = spec.reviewCases;
  }
  return invoice;
}

const onPage = (page) => ({ kind: "row", page });
const split = { kind: "split", head_page: 2, tail_page: 3 };

const clean = buildInvoice({
  id: "clean",
  invoiceNumber: "SYN-1001",
  container: "SLLU0000011",
  bl: "SYN-BL-1001",
  freeStart: "2026-01-05",
  freeEnd: "2026-01-09",
  chargedFrom: "2026-01-10",
  chargedTo: "2026-01-12",
  invoiceDate: "2026-01-20",
  total: "450.00",
  rateText: "150.00 USD per day",
  lines: [row("SLLU0000011", "2026-01-10", "2026-01-12", "150.00", onPage(1))],
});

const missing = buildInvoice({
  id: "missing_elements",
  invoiceNumber: "SYN-1002",
  container: "SLLU0000027",
  bl: "SYN-BL-1002",
  freeStart: "2026-06-08",
  freeEnd: "2026-06-12",
  chargedFrom: "2026-06-13",
  chargedTo: "2026-06-15",
  invoiceDate: "2026-06-20",
  total: "300.00",
  rateText: "100.00 USD per day",
  absent: MISSING_FIELDS,
  absentText: {
    free_time_end: "2026-06-12",
    cert_rules_compliance: CERT_RULES,
    cert_no_contribution: CERT_PERFORMANCE,
  },
  lines: [row("SLLU0000027", "2026-06-13", "2026-06-15", "100.00", onPage(1))],
  reviewCases: {
    before_review: { rule: "R1", outcome: "not_evaluable" },
    after_review: {
      confirmed_absent: MISSING_FIELDS,
      finding: {
        rule: "R1",
        ground: "missing_information",
        citations: [
          "46 CFR 541.6(b)(4)",
          "46 CFR 541.6(b)(5)",
          "46 CFR 541.6(e)(1)",
          "46 CFR 541.6(e)(2)",
        ],
        disputable_amount: "300.00",
        currency: "USD",
      },
    },
  },
});

const late = buildInvoice({
  id: "late_37",
  invoiceNumber: "SYN-1003",
  container: "SLLU0000032",
  bl: "SYN-BL-1003",
  freeStart: "2026-02-15",
  freeEnd: "2026-02-19",
  chargedFrom: "2026-02-20",
  chargedTo: "2026-03-02",
  invoiceDate: "2026-04-08",
  total: "1100.00",
  rateText: "100.00 USD per day",
  lines: [row("SLLU0000032", "2026-02-20", "2026-03-02", "100.00", onPage(1))],
  expectedFindings: [
    {
      rule: "R2",
      ground: "late_invoice",
      citation: "46 CFR 541.7(a)",
      disputable_amount: "1100.00",
      currency: "USD",
    },
  ],
});

const overbill = buildInvoice({
  id: "free_time_overbill",
  invoiceNumber: "SYN-1004",
  container: "SLLU0000048",
  bl: "SYN-BL-1004",
  freeStart: "2026-02-10",
  freeEnd: "2026-02-14",
  chargedFrom: "2026-02-13",
  chargedTo: "2026-02-20",
  invoiceDate: "2026-02-25",
  total: "1600.00",
  rateText: "150.00 USD per day for the first 4 charged days, then 250.00 USD per day",
  lines: [
    row("SLLU0000048", "2026-02-13", "2026-02-16", "150.00", onPage(1)),
    row("SLLU0000048", "2026-02-17", "2026-02-20", "250.00", onPage(1)),
  ],
  byConvention: {
    day1: {
      chargeable_days: 6,
      expected_amount: "1100.00",
      finding: {
        rule: "R3",
        ground: "billing_error",
        disputable_amount: "500.00",
        currency: "USD",
      },
    },
    day0: {
      chargeable_days: 5,
      expected_amount: "850.00",
      finding: {
        rule: "R3",
        ground: "billing_error",
        disputable_amount: "750.00",
        currency: "USD",
      },
    },
  },
});

const arithmetic = buildInvoice({
  id: "arithmetic",
  invoiceNumber: "SYN-1005",
  container: "SLLU0000053",
  bl: "SYN-BL-1005",
  freeStart: "2026-03-31",
  freeEnd: "2026-04-04",
  chargedFrom: "2026-04-05",
  chargedTo: "2026-04-20",
  invoiceDate: "2026-04-25",
  total: "3450.00",
  rateText: "250.00 USD per day and 145.00 USD per day",
  lines: [
    row("SLLU0000053", "2026-04-05", "2026-04-10", "250.00", onPage(1), "1750.00"),
    row("SLLU0000053", "2026-04-11", "2026-04-20", "145.00", onPage(1)),
  ],
  expectedFindings: [
    {
      rule: "R4",
      ground: "billing_error",
      part: "line",
      disputable_amount: "250.00",
      currency: "USD",
    },
    {
      rule: "R4",
      ground: "billing_error",
      part: "total",
      disputable_amount: "250.00",
      currency: "USD",
    },
  ],
});

const duplicateA = buildInvoice({
  id: "duplicate_a",
  invoiceNumber: "SYN-1006",
  container: "SLLU0000069",
  bl: "SYN-BL-1006",
  freeStart: "2026-02-24",
  freeEnd: "2026-02-28",
  chargedFrom: "2026-03-01",
  chargedTo: "2026-03-10",
  invoiceDate: "2026-03-15",
  total: "2000.00",
  rateText: "200.00 USD per day",
  lines: [row("SLLU0000069", "2026-03-01", "2026-03-10", "200.00", onPage(1))],
});

const duplicateB = buildInvoice({
  id: "duplicate_b",
  invoiceNumber: "SYN-1007",
  container: "SLLU0000069",
  bl: "SYN-BL-1006",
  freeStart: "2026-02-24",
  freeEnd: "2026-02-28",
  chargedFrom: "2026-03-08",
  chargedTo: "2026-03-12",
  invoiceDate: "2026-03-20",
  total: "1000.00",
  rateText: "200.00 USD per day",
  lines: [row("SLLU0000069", "2026-03-08", "2026-03-12", "200.00", onPage(1))],
  expectedFindings: [
    {
      rule: "R5",
      ground: "duplicate_charge",
      overlapping_days: 3,
      disputable_amount: "600.00",
      currency: "USD",
    },
  ],
});

const splitRow = buildInvoice({
  id: "split_row",
  invoiceNumber: "SYN-1008",
  container: "SLLU0000074",
  bl: "SYN-BL-1008",
  freeStart: "2026-05-04",
  freeEnd: "2026-05-08",
  chargedFrom: "2026-05-09",
  chargedTo: "2026-05-17",
  invoiceDate: "2026-05-22",
  total: "900.00",
  rateText: "100.00 USD per day",
  pages: 3,
  contactPage: 3,
  lines: [
    row("SLLU0000074", "2026-05-09", "2026-05-10", "100.00", onPage(2)),
    row("SLLU0000074", "2026-05-11", "2026-05-12", "100.00", onPage(2)),
    row("SLLU0000074", "2026-05-16", "2026-05-17", "100.00", onPage(2)),
    row("SLLU0000074", "2026-05-13", "2026-05-15", "100.00", split),
  ],
});

export const invoices = [
  clean,
  missing,
  late,
  overbill,
  arithmetic,
  duplicateA,
  duplicateB,
  splitRow,
];

function sumAmounts(lines) {
  const cents = lines.reduce((total, line) => total + Math.round(Number(line.amount) * 100), 0);
  return (cents / 100).toFixed(2);
}

for (const invoice of invoices) {
  assert(ELEMENT_KEYS.length === 20, "element key count");
  assert(Object.keys(invoice.elements).length === 20, `${invoice.id} element count`);
  for (const key of ELEMENT_KEYS) {
    assert(Object.hasOwn(invoice.elements, key), `${invoice.id} lacks ${key}`);
  }
  const earliest = invoice.elements.earliest_return_date;
  assert(earliest.state === "not_applicable" && earliest.page === null, invoice.id);
  assert(isValidContainer(invoice.charge_lines[0].container), invoice.id);
  assert(inclusiveDays(
    invoice.elements.free_time_end.state === "present"
      ? invoice.elements.free_time_start.text
      : "2026-06-08",
    invoice.elements.free_time_end.state === "present"
      ? invoice.elements.free_time_end.text
      : "2026-06-12",
  ) === 5, `${invoice.id} free time`);
  assert(!JSON.stringify(invoice.charge_lines).includes("ln_"), invoice.id);
}

assert(sumAmounts(clean.charge_lines) === clean.total_due, "clean total");
assert(sumAmounts(missing.charge_lines) === missing.total_due, "missing total");
assert(sumAmounts(late.charge_lines) === late.total_due, "late total");
assert(inclusiveDays("2026-02-20", "2026-03-02") === 11, "late day count");
assert(sumAmounts(overbill.charge_lines) === "1600.00", "overbill lines");
assert(sumAmounts(arithmetic.charge_lines) === "3200.00", "arithmetic line sum");
assert(arithmetic.total_due === "3450.00", "arithmetic total");
assert(money(6, "250.00") === "1500.00", "arithmetic true product");
assert(sumAmounts(splitRow.charge_lines) === "900.00", "split total");
assert(duplicateA.elements.bl_number.text === duplicateB.elements.bl_number.text, "shared bl");
assert(
  duplicateA.elements.container_availability_date.text
    === duplicateB.elements.container_availability_date.text,
  "shared availability",
);
assert(duplicateA.elements.free_time_start.text === duplicateB.elements.free_time_start.text, "shared start");
assert(duplicateA.elements.free_time_end.text === duplicateB.elements.free_time_end.text, "shared end");
assert(addDays(duplicateA.elements.free_time_end.text, 1) === "2026-03-01", "duplicate start");
assert(missing.review_cases.after_review.finding.disputable_amount === missing.total_due, "r1 amount");

export function serializeInvoice(invoice) {
  return `${JSON.stringify(invoice, null, 2)}\n`;
}
