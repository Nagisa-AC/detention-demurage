import { ELEMENT_KEYS, type ElementKey } from "./elements.js";
import {
  invoiceExtractionSchema,
  stitchedInvoiceSchema,
  type InvoiceExtraction,
  type PageExtraction,
  type PrintedChargeLine,
  type PrintedElement,
  type Region,
  type StitchedChargeLine,
  type StitchedInvoice,
  type UnresolvedFragment,
} from "./schema.js";

const LINE_FIELDS = ["container", "charge", "charged_from", "charged_to", "days", "rate", "amount"] as const;
const HEADER_FIELDS = ["invoice_number", "billing_party", "billed_party", "currency"] as const;

type LineField = (typeof LINE_FIELDS)[number];
type HeaderField = (typeof HEADER_FIELDS)[number];
type PrintedFields = Partial<Record<LineField, string>>;

type Fragment = {
  page: number;
  index: number;
  fields: PrintedFields;
};

type Sighting = {
  text: string;
  page: number;
  region?: Region;
};

export class StitchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StitchError";
  }
}

/**
 * Merge extracted pages into one invoice.
 * A split row joins only when the head is the last line on its page and the tail is the first line on the next page.
 * Conflicts and unresolved fragments are returned. They are not thrown.
 */
export function stitch(pages: InvoiceExtraction): StitchedInvoice {
  const parsed = invoiceExtractionSchema.safeParse(pages);
  if (!parsed.success) throw new StitchError("The pages are not an extraction.");
  const ordered = orderPages(parsed.data);
  const lines = ordered.map((page) => page.charge_lines.map((line, index) => toFragment(page.page, index, line)));
  const joined = findJoins(lines);

  const chargeLines: Omit<StitchedChargeLine, "id">[] = [];
  const unresolved: UnresolvedFragment[] = [];
  for (const pageLines of lines) {
    for (const fragment of pageLines) {
      const pair = joined.pairs.get(fragmentKey(fragment));
      if (pair !== undefined) {
        chargeLines.push(splitLine(pair.head, pair.tail));
        continue;
      }
      if (joined.tails.has(fragmentKey(fragment))) continue;
      if (hasText(fragment.fields.container) && hasText(fragment.fields.amount)) {
        chargeLines.push(rowLine(fragment));
        continue;
      }
      unresolved.push(unresolvedFragment(fragment));
    }
  }

  const headers = mergeHeaders(ordered);
  const elements = mergeElements(ordered);
  const result = {
    ...headers.kept,
    elements: elements.kept,
    conflicts: elements.conflicts,
    header_conflicts: headers.conflicts,
    charge_lines: chargeLines.map((line, index) => ({ ...line, id: `ln_${index + 1}` })),
    unresolved,
  };
  const checked = stitchedInvoiceSchema.safeParse(result);
  if (!checked.success) throw new StitchError("Stitch produced a result the schema rejected.");
  return checked.data;
}

function orderPages(pages: readonly PageExtraction[]): PageExtraction[] {
  if (pages.length === 0) throw new StitchError("There are no pages.");
  const ordered = [...pages].sort((left, right) => left.page - right.page);
  const seen = new Set<number>();
  for (const page of ordered) {
    if (seen.has(page.page)) throw new StitchError("A page number is repeated.");
    seen.add(page.page);
  }
  for (let number = 1; number <= ordered.length; number += 1) {
    if (ordered[number - 1]?.page !== number) throw new StitchError(`Page ${number} is missing.`);
  }
  return ordered;
}

function findJoins(lines: readonly (readonly Fragment[])[]): {
  pairs: Map<string, { head: Fragment; tail: Fragment }>;
  tails: Set<string>;
} {
  const pairs = new Map<string, { head: Fragment; tail: Fragment }>();
  const tails = new Set<string>();
  for (let index = 0; index < lines.length - 1; index += 1) {
    const current = lines[index];
    const next = lines[index + 1];
    if (current === undefined || next === undefined || current.length === 0 || next.length === 0) continue;
    const head = current[current.length - 1];
    const tail = next[0];
    if (head === undefined || tail === undefined) continue;
    if (!isHead(head) || !isTail(tail) || fieldsDisagree(head.fields, tail.fields)) continue;
    const merged = mergeFields(head, tail);
    if (!hasText(merged.container) || !hasText(merged.amount)) continue;
    pairs.set(fragmentKey(head), { head, tail });
    tails.add(fragmentKey(tail));
  }
  return { pairs, tails };
}

function isHead(fragment: Fragment): boolean {
  return hasText(fragment.fields.container) && !hasText(fragment.fields.amount);
}

function isTail(fragment: Fragment): boolean {
  return !hasText(fragment.fields.container);
}

function fieldsDisagree(head: PrintedFields, tail: PrintedFields): boolean {
  for (const field of LINE_FIELDS) {
    const left = head[field];
    const right = tail[field];
    if (left !== undefined && right !== undefined && left.trim() !== right.trim()) return true;
  }
  return false;
}

function mergeFields(head: Fragment, tail: Fragment): PrintedFields {
  const merged: PrintedFields = { ...head.fields };
  for (const field of LINE_FIELDS) {
    if (merged[field] === undefined && tail.fields[field] !== undefined) merged[field] = tail.fields[field];
  }
  return merged;
}

function splitLine(head: Fragment, tail: Fragment): Omit<StitchedChargeLine, "id"> {
  const merged = mergeFields(head, tail);
  const line: Omit<StitchedChargeLine, "id"> = {
    container: { text: requireText(head.fields.container), page: head.page },
    amount: { text: requireText(merged.amount), page: sourcePage(head, tail, "amount") },
    placement: { kind: "split", head_page: head.page, tail_page: tail.page },
  };
  for (const field of LINE_FIELDS) {
    if (field === "container" || field === "amount") continue;
    const text = merged[field];
    if (text !== undefined) line[field] = { text, page: sourcePage(head, tail, field) };
  }
  return line;
}

function sourcePage(head: Fragment, tail: Fragment, field: LineField): number {
  return head.fields[field] !== undefined ? head.page : tail.page;
}

function rowLine(fragment: Fragment): Omit<StitchedChargeLine, "id"> {
  const line: Omit<StitchedChargeLine, "id"> = {
    container: { text: requireText(fragment.fields.container), page: fragment.page },
    amount: { text: requireText(fragment.fields.amount), page: fragment.page },
    placement: { kind: "row", page: fragment.page },
  };
  for (const field of LINE_FIELDS) {
    if (field === "container" || field === "amount") continue;
    const text = fragment.fields[field];
    if (text !== undefined) line[field] = { text, page: fragment.page };
  }
  return line;
}

function unresolvedFragment(fragment: Fragment): UnresolvedFragment {
  const kind = hasText(fragment.fields.container) ? "open_head" : "orphan_tail";
  const unresolved: UnresolvedFragment = { kind, page: fragment.page };
  for (const field of LINE_FIELDS) {
    const text = fragment.fields[field];
    if (text !== undefined) unresolved[field] = text;
  }
  return unresolved;
}

function mergeElements(pages: readonly PageExtraction[]): {
  kept: StitchedInvoice["elements"];
  conflicts: StitchedInvoice["conflicts"];
} {
  const seen = new Map<ElementKey, Sighting[]>();
  for (const page of pages) {
    for (const key of ELEMENT_KEYS) {
      const element = page.elements[key];
      if (element === undefined || element.text.trim() === "") continue;
      const sightings = seen.get(key) ?? [];
      sightings.push(sighting(element));
      seen.set(key, sightings);
    }
  }
  const kept: StitchedInvoice["elements"] = {};
  const conflicts: StitchedInvoice["conflicts"] = [];
  for (const key of ELEMENT_KEYS) {
    const sightings = seen.get(key);
    if (sightings === undefined) continue;
    const chosen = choose(sightings);
    if (chosen.conflict) {
      conflicts.push({ key, values: chosen.conflict });
    } else if (chosen.kept !== undefined) {
      kept[key] = chosen.kept.region === undefined
        ? { text: chosen.kept.text, page: chosen.kept.page }
        : { text: chosen.kept.text, page: chosen.kept.page, region: chosen.kept.region };
    }
  }
  return { kept, conflicts };
}

function mergeHeaders(pages: readonly PageExtraction[]): {
  kept: Partial<Record<HeaderField, { text: string; page: number }>>;
  conflicts: StitchedInvoice["header_conflicts"];
} {
  const kept: Partial<Record<HeaderField, { text: string; page: number }>> = {};
  const conflicts: StitchedInvoice["header_conflicts"] = [];
  for (const field of HEADER_FIELDS) {
    const sightings: Sighting[] = [];
    for (const page of pages) {
      const text = page[field];
      if (text === undefined || text.trim() === "") continue;
      sightings.push({ text, page: page.page });
    }
    const chosen = choose(sightings);
    if (chosen.conflict) conflicts.push({ field, values: chosen.conflict });
    else if (chosen.kept !== undefined) kept[field] = { text: chosen.kept.text, page: chosen.kept.page };
  }
  return { kept, conflicts };
}

function choose(sightings: readonly Sighting[]): {
  kept?: Sighting;
  conflict?: { text: string; page: number }[];
} {
  if (sightings.length === 0) return {};
  const texts = new Set(sightings.map((item) => item.text.trim()));
  if (texts.size > 1) {
    return { conflict: sightings.map((item) => ({ text: item.text, page: item.page })) };
  }
  return { kept: sightings.reduce((earliest, item) => (item.page < earliest.page ? item : earliest)) };
}

function sighting(element: PrintedElement): Sighting {
  if (element.region === undefined) return { text: element.text, page: element.page };
  return { text: element.text, page: element.page, region: element.region };
}

function toFragment(page: number, index: number, line: PrintedChargeLine): Fragment {
  const fields: PrintedFields = {};
  for (const field of LINE_FIELDS) {
    const text = line[field];
    if (text !== undefined && text.trim() !== "") fields[field] = text;
  }
  return { page, index, fields };
}

function fragmentKey(fragment: Fragment): string {
  return `${fragment.page}:${fragment.index}`;
}

function hasText(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

function requireText(value: string | undefined): string {
  if (!hasText(value)) throw new StitchError("A resolved line is missing a field.");
  return value;
}
