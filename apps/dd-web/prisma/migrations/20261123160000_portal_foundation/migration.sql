-- Customer portal foundation.
-- dd_portal and dd_portal_reader are created before this migration. See prisma/create-portal-role.sql.
-- Postgres refuses CREATE ROLE inside the transaction Prisma wraps around a migration.
--
-- The three views are security_invoker, so the caller's privileges apply.
-- Their rows are read by functions owned by dd_portal_reader, which cannot log in.
-- Postgres applies a policy to the named role only, not to a role that inherits it,
-- so dd_portal_reader is on the same customer filter as dd_portal.
-- dd_portal is granted the views and those functions, not the base tables.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dd_portal') THEN
    RAISE EXCEPTION 'dd_portal does not exist. Run prisma/create-portal-role.sql as the migration owner, then migrate.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dd_portal_reader') THEN
    RAISE EXCEPTION 'dd_portal_reader does not exist. Run prisma/create-portal-role.sql as the migration owner, then migrate.';
  END IF;
END
$$;

GRANT dd_portal_reader TO CURRENT_USER;

CREATE TABLE "PortalUser" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "cognito_sub" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalUser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PortalUser_cognito_sub_key" ON "PortalUser"("cognito_sub");
CREATE INDEX "PortalUser_customer_id_idx" ON "PortalUser"("customer_id");

ALTER TABLE "PortalUser"
  ADD CONSTRAINT "PortalUser_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "Customer"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PortalUser"
  ADD CONSTRAINT "PortalUser_cognito_sub_check"
  CHECK (length(btrim(cognito_sub)) > 0);

ALTER TABLE "PortalUser"
  ADD CONSTRAINT "PortalUser_email_check"
  CHECK (length(btrim(email)) > 0);

REVOKE ALL ON TABLE "PortalUser" FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE "PortalUser" TO dd_app;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "PortalUser" FROM dd_app;

-- A missing or invalid setting compares as NULL and returns no rows.
CREATE FUNCTION app_customer_id() RETURNS uuid
LANGUAGE sql
STABLE
AS $fn$
  SELECT CASE
    WHEN current_setting('app.customer_id', true) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN current_setting('app.customer_id', true)::uuid
    ELSE NULL
  END
$fn$;

CREATE FUNCTION portal_currency_cents(records jsonb, convention text, currency text) RETURNS bigint
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT COALESCE(SUM(ROUND((item->>'amount')::numeric * 100)), 0)::bigint
  FROM jsonb_array_elements(COALESCE(records->'total_disputable'->convention, '[]'::jsonb)) AS item
  WHERE item->>'currency' = portal_currency_cents.currency
    AND item->>'amount' ~ '^[0-9]+(\.[0-9]+)?$'
$fn$;

-- The lower total wins. A tie, or totals that disagree across currencies, uses day 1.
CREATE FUNCTION portal_chosen_convention(records jsonb) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  currency text;
  delta bigint;
  sign integer := 0;
  next_sign integer;
BEGIN
  FOR currency IN
    SELECT DISTINCT item->>'currency' AS currency
    FROM (
      SELECT jsonb_array_elements(COALESCE(records->'total_disputable'->'day0', '[]'::jsonb)) AS item
      UNION ALL
      SELECT jsonb_array_elements(COALESCE(records->'total_disputable'->'day1', '[]'::jsonb))
    ) AS totals
    WHERE item->>'currency' IS NOT NULL
    ORDER BY 1
  LOOP
    delta := portal_currency_cents(records, 'day0', currency) - portal_currency_cents(records, 'day1', currency);
    IF delta = 0 THEN
      CONTINUE;
    END IF;
    next_sign := CASE WHEN delta < 0 THEN -1 ELSE 1 END;
    IF sign <> 0 AND sign <> next_sign THEN
      RETURN 'day1';
    END IF;
    sign := next_sign;
  END LOOP;
  IF sign < 0 THEN
    RETURN 'day0';
  END IF;
  RETURN 'day1';
END
$fn$;

ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProcessingRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Finding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReportExport" ENABLE ROW LEVEL SECURITY;

-- dd_app keeps the access it has today. These policies are permissive, so they do not narrow it.
CREATE POLICY dd_app_all ON "Invoice" FOR ALL TO dd_app USING (true) WITH CHECK (true);
CREATE POLICY dd_app_all ON "ProcessingRun" FOR ALL TO dd_app USING (true) WITH CHECK (true);
CREATE POLICY dd_app_all ON "Finding" FOR ALL TO dd_app USING (true) WITH CHECK (true);
CREATE POLICY dd_app_all ON "AuditEvent" FOR ALL TO dd_app USING (true) WITH CHECK (true);
CREATE POLICY dd_app_all ON "ReportExport" FOR ALL TO dd_app USING (true) WITH CHECK (true);

CREATE POLICY dd_portal_customer ON "Invoice"
  FOR SELECT TO dd_portal, dd_portal_reader
  USING (customer_id = app_customer_id());
CREATE POLICY dd_portal_customer ON "ProcessingRun"
  FOR SELECT TO dd_portal, dd_portal_reader
  USING (customer_id = app_customer_id());
CREATE POLICY dd_portal_customer ON "Finding"
  FOR SELECT TO dd_portal, dd_portal_reader
  USING (customer_id = app_customer_id());
CREATE POLICY dd_portal_customer ON "AuditEvent"
  FOR SELECT TO dd_portal, dd_portal_reader
  USING (customer_id = app_customer_id());
CREATE POLICY dd_portal_customer ON "ReportExport"
  FOR SELECT TO dd_portal, dd_portal_reader
  USING (customer_id = app_customer_id());

CREATE FUNCTION portal_invoice_rows()
RETURNS TABLE (invoice_number text, invoice_date date, currency text, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  RETURN QUERY
  SELECT i.invoice_number::text,
         i.invoice_date,
         i.currency::text,
         CASE
           WHEN EXISTS (
             SELECT 1 FROM "ProcessingRun" r
             WHERE r.customer_id = i.customer_id
               AND r.finished_at IS NULL
               AND (
                 r.invoice_id = i.id
                 OR r.document_id = i.document_id
                 OR r.kind IN ('rules', 'report')
               )
           ) THEN 'Being checked'
           WHEN EXISTS (
             SELECT 1 FROM "ProcessingRun" r
             WHERE r.customer_id = i.customer_id
               AND r.kind = 'rules'
               AND r.finished_at IS NOT NULL
               AND r.page_records->>'failed' = 'true'
               AND r.id = (
                 SELECT r2.id FROM "ProcessingRun" r2
                 WHERE r2.customer_id = i.customer_id AND r2.kind = 'rules'
                 ORDER BY r2.started_at DESC, r2.id DESC
                 LIMIT 1
               )
           ) THEN 'Needs attention'
           WHEN i.unresolved IS NOT NULL
             AND jsonb_typeof(i.unresolved) = 'array'
             AND jsonb_array_length(i.unresolved) > 0
           THEN 'Needs attention'
           WHEN EXISTS (
             SELECT 1 FROM "ProcessingRun" r
             WHERE r.customer_id = i.customer_id
               AND r.kind = 'rules'
               AND r.finished_at IS NOT NULL
               AND COALESCE(r.page_records->>'failed', 'false') <> 'true'
               AND EXISTS (
                 SELECT 1
                 FROM jsonb_array_elements_text(COALESCE(r.page_records->'invoice_ids', '[]'::jsonb)) AS listed(invoice_id)
                 WHERE listed.invoice_id = i.id::text
               )
           ) THEN 'Checked'
           ELSE 'Received'
         END::text
  FROM "Invoice" i
  ORDER BY i.invoice_number, i.id;
END
$fn$;

CREATE FUNCTION portal_finding_rows()
RETURNS TABLE (invoice_number text, title text, plain_text text, counted_amount numeric, currency text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  RETURN QUERY
  SELECT i.invoice_number::text,
         CASE f.rule
           WHEN 'R1' THEN 'Missing information'
           WHEN 'R2' THEN 'Late invoice'
           WHEN 'R3' THEN 'Free time'
           WHEN 'R4' THEN 'Arithmetic'
           WHEN 'R5' THEN 'Duplicate charge'
           WHEN 'manual' THEN 'Reviewer note'
           ELSE 'Invoice correction'
         END::text,
         regexp_replace(f.explain, '\mR[1-5]\M', '', 'g')::text,
         (counted.item->>'disputable')::numeric,
         f.currency::text
  FROM "Finding" f
  JOIN "Invoice" i ON i.id = f.invoice_id AND i.customer_id = f.customer_id
  JOIN "ProcessingRun" r ON r.id = f.processing_run_id AND r.customer_id = f.customer_id
  JOIN LATERAL (
    SELECT item
    FROM jsonb_array_elements(COALESCE(r.page_records->'invoices'->portal_chosen_convention(r.page_records), '[]'::jsonb)) AS item
    WHERE item->>'invoice_id' = f.invoice_id::text
      AND item->>'do_not_pursue' IS DISTINCT FROM 'true'
      AND COALESCE(item->>'superseded_by', '') = ''
      AND item->>'disputable' ~ '^[0-9]+(\.[0-9]+)?$'
  ) AS counted ON true
  WHERE r.kind = 'rules'
    AND r.finished_at IS NOT NULL
    AND COALESCE(r.page_records->>'failed', 'false') <> 'true'
    AND f.convention = portal_chosen_convention(r.page_records)
    AND EXISTS (
      SELECT 1 FROM "AuditEvent" e
      WHERE e.customer_id = f.customer_id
        AND e.action = 'results_published'
        AND e.payload->>'processing_run_id' = r.id::text
    )
  ORDER BY i.invoice_number, f.explain, f.id;
END
$fn$;

CREATE FUNCTION portal_report_rows()
RETURNS TABLE (
  report_number text,
  issued_on date,
  total_amount numeric,
  currency text,
  storage_key text,
  csv_key text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  RETURN QUERY
  SELECT re.report_number::text,
         (re.created_at AT TIME ZONE 'America/New_York')::date,
         (total.item->>'amount')::numeric,
         (total.item->>'currency')::text,
         re.pdf_key::text,
         re.csv_key::text
  FROM "ReportExport" re
  JOIN "ProcessingRun" report_run
    ON report_run.id = re.processing_run_id
   AND report_run.customer_id = re.customer_id
  JOIN "ProcessingRun" rules
    ON rules.customer_id = re.customer_id
   AND rules.kind = 'rules'
   AND rules.id::text = report_run.page_records->>'rules_run_id'
  JOIN LATERAL (
    SELECT item
    FROM jsonb_array_elements(COALESCE(rules.page_records->'total_disputable'->re.convention, '[]'::jsonb)) AS item
    WHERE item->>'amount' ~ '^[0-9]+(\.[0-9]+)?$'
      AND item->>'currency' ~ '^[A-Z]{3}$'
    ORDER BY item->>'currency'
    LIMIT 1
  ) AS total ON true
  ORDER BY re.report_number;
END
$fn$;

GRANT CREATE ON SCHEMA public TO dd_portal_reader;
ALTER FUNCTION portal_invoice_rows() OWNER TO dd_portal_reader;
ALTER FUNCTION portal_finding_rows() OWNER TO dd_portal_reader;
ALTER FUNCTION portal_report_rows() OWNER TO dd_portal_reader;
REVOKE CREATE ON SCHEMA public FROM dd_portal_reader;

CREATE VIEW portal_invoice WITH (security_invoker = true) AS
SELECT invoice_number, invoice_date, currency, status FROM portal_invoice_rows();

CREATE VIEW portal_finding WITH (security_invoker = true) AS
SELECT invoice_number, title, plain_text, counted_amount, currency FROM portal_finding_rows();

CREATE VIEW portal_report WITH (security_invoker = true) AS
SELECT report_number, issued_on, total_amount, currency, storage_key, csv_key FROM portal_report_rows();

REVOKE ALL ON FUNCTION app_customer_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION portal_currency_cents(jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION portal_chosen_convention(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION portal_invoice_rows() FROM PUBLIC;
REVOKE ALL ON FUNCTION portal_finding_rows() FROM PUBLIC;
REVOKE ALL ON FUNCTION portal_report_rows() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app_customer_id() TO dd_portal_reader, dd_portal;
GRANT EXECUTE ON FUNCTION portal_currency_cents(jsonb, text, text) TO dd_portal_reader;
GRANT EXECUTE ON FUNCTION portal_chosen_convention(jsonb) TO dd_portal_reader;
GRANT EXECUTE ON FUNCTION portal_invoice_rows() TO dd_portal;
GRANT EXECUTE ON FUNCTION portal_finding_rows() TO dd_portal;
GRANT EXECUTE ON FUNCTION portal_report_rows() TO dd_portal;

GRANT SELECT ON TABLE
  "Invoice", "ProcessingRun", "Finding", "AuditEvent", "ReportExport"
  TO dd_portal_reader;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO dd_portal', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO dd_portal;
GRANT USAGE ON SCHEMA public TO dd_portal_reader;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM dd_portal;
REVOKE ALL ON portal_invoice, portal_finding, portal_report FROM PUBLIC;
GRANT SELECT ON portal_invoice, portal_finding, portal_report TO dd_portal;
