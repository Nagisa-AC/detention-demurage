-- Pages and unresolved fragments the rules read.
-- NULL means this invoice was saved before those fields were recorded.
-- An empty unresolved array means the stitch left no fragments.
-- Existing rows stay NULL. A requeue writes the values from a fresh read.

ALTER TABLE "Invoice" ADD COLUMN "unresolved" JSONB;

ALTER TABLE "ChargeLine" ADD COLUMN "container_page" INTEGER;
ALTER TABLE "ChargeLine" ADD COLUMN "from_page" INTEGER;
ALTER TABLE "ChargeLine" ADD COLUMN "to_page" INTEGER;
ALTER TABLE "ChargeLine" ADD COLUMN "days_page" INTEGER;
ALTER TABLE "ChargeLine" ADD COLUMN "rate_page" INTEGER;
ALTER TABLE "ChargeLine" ADD COLUMN "amount_page" INTEGER;

ALTER TABLE "ChargeLine" ADD CONSTRAINT "ChargeLine_pages_check"
  CHECK (
    (container_page IS NULL OR container_page >= 1)
    AND (from_page IS NULL OR from_page >= 1)
    AND (to_page IS NULL OR to_page >= 1)
    AND (days_page IS NULL OR days_page >= 1)
    AND (rate_page IS NULL OR rate_page >= 1)
    AND (amount_page IS NULL OR amount_page >= 1)
  );

COMMENT ON COLUMN "ProcessingRun"."page_records" IS
  'Extract runs store a page-status array. A rules run stores the check summary: settings version, invoice ids, not_evaluable, needs_info, and disputable totals per convention. Neither holds model text.';
