-- Append-only for dd_app. A change is a new version. The highest version is current.
-- dd_app may SELECT and INSERT. It may not UPDATE, DELETE, or TRUNCATE.

CREATE TABLE "CustomerConfigVersion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerConfigVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerConfigVersion_customer_id_version_key"
  ON "CustomerConfigVersion"("customer_id", "version");

ALTER TABLE "CustomerConfigVersion"
  ADD CONSTRAINT "CustomerConfigVersion_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "Customer"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "CustomerConfigVersion"
  ADD CONSTRAINT "CustomerConfigVersion_version_check"
  CHECK (version >= 1);

REVOKE ALL ON TABLE "CustomerConfigVersion" FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE "CustomerConfigVersion" TO dd_app;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "CustomerConfigVersion" FROM dd_app;
