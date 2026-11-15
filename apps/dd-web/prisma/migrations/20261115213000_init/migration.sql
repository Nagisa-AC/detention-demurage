-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Customer" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "config_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "storage_key" TEXT,
    "duplicate_of_id" UUID,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "billing_party" TEXT NOT NULL,
    "billed_party" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "invoice_date" DATE,
    "due_date" DATE,
    "page_count" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ElementValue" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "element_key" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "text" TEXT,
    "value" TEXT,
    "page" INTEGER,
    "region_x" DECIMAL(10,8),
    "region_y" DECIMAL(10,8),
    "region_w" DECIMAL(10,8),
    "region_h" DECIMAL(10,8),

    CONSTRAINT "ElementValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeLine" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "line_id" TEXT NOT NULL,
    "container" TEXT NOT NULL,
    "charge" TEXT NOT NULL,
    "charged_from" DATE NOT NULL,
    "charged_to" DATE NOT NULL,
    "days" INTEGER NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,

    CONSTRAINT "ChargeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "document_id" UUID,
    "invoice_id" UUID,
    "kind" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "prompt_version" TEXT,
    "model_version" TEXT,
    "schema_version" TEXT,

    CONSTRAINT "ProcessingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "processing_run_id" UUID NOT NULL,
    "rule" TEXT NOT NULL,
    "rule_version" INTEGER NOT NULL,
    "ground" TEXT NOT NULL,
    "citations" JSONB NOT NULL,
    "line_ids" JSONB NOT NULL,
    "expected" TEXT NOT NULL,
    "actual" TEXT NOT NULL,
    "disputable_amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "evidence" JSONB NOT NULL,
    "explain" TEXT NOT NULL,
    "convention" TEXT,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Case" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseLine" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeInvoice" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "issued_on" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_config_id_key" ON "Customer"("config_id");

-- CreateIndex
CREATE INDEX "Document_customer_id_idx" ON "Document"("customer_id");

-- CreateIndex
CREATE INDEX "Document_customer_id_sha256_idx" ON "Document"("customer_id", "sha256");

-- CreateIndex
CREATE INDEX "Invoice_customer_id_idx" ON "Invoice"("customer_id");

-- CreateIndex
CREATE INDEX "Invoice_document_id_idx" ON "Invoice"("document_id");

-- CreateIndex
CREATE INDEX "ElementValue_customer_id_idx" ON "ElementValue"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "ElementValue_invoice_id_element_key_key" ON "ElementValue"("invoice_id", "element_key");

-- CreateIndex
CREATE INDEX "ChargeLine_customer_id_idx" ON "ChargeLine"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "ChargeLine_invoice_id_line_id_key" ON "ChargeLine"("invoice_id", "line_id");

-- CreateIndex
CREATE INDEX "ProcessingRun_customer_id_idx" ON "ProcessingRun"("customer_id");

-- CreateIndex
CREATE INDEX "Finding_customer_id_idx" ON "Finding"("customer_id");

-- CreateIndex
CREATE INDEX "Finding_invoice_id_idx" ON "Finding"("invoice_id");

-- CreateIndex
CREATE INDEX "Case_customer_id_idx" ON "Case"("customer_id");

-- CreateIndex
CREATE INDEX "CaseLine_customer_id_idx" ON "CaseLine"("customer_id");

-- CreateIndex
CREATE INDEX "CaseLine_case_id_idx" ON "CaseLine"("case_id");

-- CreateIndex
CREATE INDEX "Submission_customer_id_idx" ON "Submission"("customer_id");

-- CreateIndex
CREATE INDEX "LedgerEntry_customer_id_idx" ON "LedgerEntry"("customer_id");

-- CreateIndex
CREATE INDEX "FeeInvoice_customer_id_idx" ON "FeeInvoice"("customer_id");

-- CreateIndex
CREATE INDEX "AuditEvent_customer_id_idx" ON "AuditEvent"("customer_id");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_duplicate_of_id_fkey" FOREIGN KEY ("duplicate_of_id") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ElementValue" ADD CONSTRAINT "ElementValue_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ElementValue" ADD CONSTRAINT "ElementValue_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ChargeLine" ADD CONSTRAINT "ChargeLine_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ChargeLine" ADD CONSTRAINT "ChargeLine_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ProcessingRun" ADD CONSTRAINT "ProcessingRun_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ProcessingRun" ADD CONSTRAINT "ProcessingRun_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ProcessingRun" ADD CONSTRAINT "ProcessingRun_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_processing_run_id_fkey" FOREIGN KEY ("processing_run_id") REFERENCES "ProcessingRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CaseLine" ADD CONSTRAINT "CaseLine_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CaseLine" ADD CONSTRAINT "CaseLine_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FeeInvoice" ADD CONSTRAINT "FeeInvoice_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- dd_app is created before this migration. See prisma/create-app-role.sql.
-- Postgres refuses CREATE ROLE inside the transaction Prisma wraps around a migration.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dd_app') THEN
    RAISE EXCEPTION 'dd_app does not exist. Run prisma/create-app-role.sql as the migration owner, then migrate.';
  END IF;
END
$$;

-- confirmed_absent is not a stored element state.
ALTER TABLE "ElementValue" ADD CONSTRAINT "ElementValue_state_check"
  CHECK (state IN ('present', 'unreadable', 'suggested_absent', 'not_applicable'));

ALTER TABLE "ElementValue" ADD CONSTRAINT "ElementValue_page_check"
  CHECK (
    (state IN ('present', 'unreadable') AND page IS NOT NULL)
    OR (state IN ('suggested_absent', 'not_applicable') AND page IS NULL)
  );

ALTER TABLE "ElementValue" ADD CONSTRAINT "ElementValue_text_check"
  CHECK (state <> 'present' OR text IS NOT NULL);

ALTER TABLE "ElementValue" ADD CONSTRAINT "ElementValue_region_check"
  CHECK (
    (region_x IS NULL AND region_y IS NULL AND region_w IS NULL AND region_h IS NULL)
    OR (
      region_x BETWEEN 0 AND 1
      AND region_y BETWEEN 0 AND 1
      AND region_w BETWEEN 0 AND 1
      AND region_h BETWEEN 0 AND 1
    )
  );

ALTER TABLE "Document" ADD CONSTRAINT "Document_sha256_check"
  CHECK (sha256 ~ '^[0-9a-f]{64}$');

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_currency_check"
  CHECK (currency ~ '^[A-Z]{3}$');

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_page_count_check"
  CHECK (page_count >= 1);

ALTER TABLE "ChargeLine" ADD CONSTRAINT "ChargeLine_charge_check"
  CHECK (charge IN ('demurrage', 'detention'));

ALTER TABLE "ChargeLine" ADD CONSTRAINT "ChargeLine_days_check"
  CHECK (days >= 0);

ALTER TABLE "ChargeLine" ADD CONSTRAINT "ChargeLine_money_check"
  CHECK (rate >= 0 AND amount >= 0);

ALTER TABLE "ChargeLine" ADD CONSTRAINT "ChargeLine_currency_check"
  CHECK (currency ~ '^[A-Z]{3}$');

ALTER TABLE "ProcessingRun" ADD CONSTRAINT "ProcessingRun_kind_check"
  CHECK (kind IN ('extract', 'stitch', 'rules'));

ALTER TABLE "Finding" ADD CONSTRAINT "Finding_rule_check"
  CHECK (rule IN ('R1', 'R2', 'R3', 'R4', 'R5', 'manual'));

ALTER TABLE "Finding" ADD CONSTRAINT "Finding_ground_check"
  CHECK (ground IN (
    'missing_information',
    'late_invoice',
    'billing_error',
    'duplicate_charge',
    'unreasonable_charge'
  ));

ALTER TABLE "Finding" ADD CONSTRAINT "Finding_convention_check"
  CHECK (convention IS NULL OR convention IN ('day0', 'day1'));

ALTER TABLE "Finding" ADD CONSTRAINT "Finding_money_check"
  CHECK (disputable_amount >= 0);

ALTER TABLE "Finding" ADD CONSTRAINT "Finding_currency_check"
  CHECK (currency ~ '^[A-Z]{3}$');

ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_currency_check"
  CHECK (currency ~ '^[A-Z]{3}$');

ALTER TABLE "FeeInvoice" ADD CONSTRAINT "FeeInvoice_currency_check"
  CHECK (currency ~ '^[A-Z]{3}$');

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO dd_app', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO dd_app;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dd_app;
REVOKE UPDATE, DELETE ON TABLE "Submission", "LedgerEntry", "AuditEvent" FROM dd_app;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM dd_app;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "_prisma_migrations" FROM dd_app;

-- Tables created by later migrations, by this same owner, get these grants.
-- TRUNCATE is not among them. The three append-only tables are revoked above.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dd_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM dd_app;
