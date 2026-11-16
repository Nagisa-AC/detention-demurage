DROP INDEX "Document_customer_id_sha256_idx";

ALTER TABLE "ProcessingRun" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProcessingRun" ADD COLUMN "lease_token" UUID;
ALTER TABLE "ProcessingRun" ADD COLUMN "leased_at" TIMESTAMPTZ(6);
ALTER TABLE "ProcessingRun" ADD COLUMN "page_records" JSONB;

CREATE UNIQUE INDEX "Document_customer_id_sha256_key" ON "Document"("customer_id", "sha256");
