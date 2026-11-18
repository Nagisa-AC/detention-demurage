-- A report export is a ProcessingRun the worker claims, next to extract.
-- page_records holds the rules run id, the firm profile version, and the actor.
-- A failure stores one fixed reason. None of this is model text.
ALTER TABLE "ProcessingRun" DROP CONSTRAINT "ProcessingRun_kind_check";
ALTER TABLE "ProcessingRun" ADD CONSTRAINT "ProcessingRun_kind_check"
  CHECK (kind IN ('extract', 'stitch', 'rules', 'report'));
