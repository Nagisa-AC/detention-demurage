-- FirmProfileVersion is append-only for dd_app, same as CustomerConfigVersion.
-- A change is a new version. The highest version is current.
-- ReportExport is append-only too. dd_app may SELECT and INSERT. It may not UPDATE, DELETE, or TRUNCATE.

CREATE TABLE "FirmProfileVersion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version" INTEGER NOT NULL,
    "firm_name" TEXT NOT NULL,
    "city_state" TEXT NOT NULL,
    "reply_to" TEXT NOT NULL,
    "signer_name" TEXT NOT NULL,
    "signer_title" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FirmProfileVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FirmProfileVersion_version_key" ON "FirmProfileVersion"("version");

ALTER TABLE "FirmProfileVersion"
  ADD CONSTRAINT "FirmProfileVersion_version_check"
  CHECK (version >= 1);

INSERT INTO "FirmProfileVersion" (version, firm_name, city_state, reply_to, signer_name, signer_title, created_by)
VALUES (1, 'Tidemark Recovery', 'New Haven, CT', 'disputes@tidemark.example', 'Ibrahim Kebbeh', 'Principal', 'seed');

CREATE TABLE "ReportExport" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "processing_run_id" UUID NOT NULL,
    "firm_profile_id" UUID NOT NULL,
    "report_number" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "settings_version" INTEGER NOT NULL,
    "firm_version" INTEGER NOT NULL,
    "convention" TEXT NOT NULL,
    "pdf_sha256" CHAR(64) NOT NULL,
    "csv_sha256" CHAR(64) NOT NULL,
    "pdf_key" TEXT NOT NULL,
    "csv_key" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportExport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReportExport_report_number_key" ON "ReportExport"("report_number");
CREATE UNIQUE INDEX "ReportExport_series_year_sequence_key" ON "ReportExport"("series", "year", "sequence");
CREATE INDEX "ReportExport_customer_id_idx" ON "ReportExport"("customer_id");

ALTER TABLE "ReportExport"
  ADD CONSTRAINT "ReportExport_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "Customer"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ReportExport"
  ADD CONSTRAINT "ReportExport_processing_run_id_fkey"
  FOREIGN KEY ("processing_run_id") REFERENCES "ProcessingRun"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ReportExport"
  ADD CONSTRAINT "ReportExport_firm_profile_id_fkey"
  FOREIGN KEY ("firm_profile_id") REFERENCES "FirmProfileVersion"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ReportExport"
  ADD CONSTRAINT "ReportExport_convention_check"
  CHECK (convention IN ('day0', 'day1'));

ALTER TABLE "ReportExport"
  ADD CONSTRAINT "ReportExport_sequence_check"
  CHECK (sequence >= 1 AND year >= 2000);

REVOKE ALL ON TABLE "FirmProfileVersion", "ReportExport" FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE "FirmProfileVersion", "ReportExport" TO dd_app;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "FirmProfileVersion", "ReportExport" FROM dd_app;
