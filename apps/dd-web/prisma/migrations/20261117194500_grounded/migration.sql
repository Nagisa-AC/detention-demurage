-- grounded is separate from element state.
-- true: the saved text was found on that page.
-- false: the model returned text that was not found. The text stays so a person can check it.
-- null: nothing was read (suggested_absent or not_applicable).
-- unreadable stays reserved for a conflict or a value that will not parse.

ALTER TABLE "ElementValue" ADD COLUMN "grounded" BOOLEAN;

ALTER TABLE "ElementValue" ADD CONSTRAINT "ElementValue_grounded_check"
  CHECK (
    (state IN ('suggested_absent', 'not_applicable') AND grounded IS NULL)
    OR (state IN ('present', 'unreadable') AND grounded IS NOT NULL)
  );

ALTER TABLE "ChargeLine" ADD COLUMN "grounded" BOOLEAN;
