-- Sign-in lookup for the customer portal.
-- dd_portal cannot read PortalUser. portal_customer_id is owned by dd_portal_lookup,
-- which can read PortalUser and AuditEvent. dd_portal can only execute the function.
-- The lookup role's policies are not gated by a session setting. A caller cannot
-- open those tables by setting one. If the lookup policy is missing, sign-in is refused,
-- so a hidden disable event cannot pass.
-- dd_portal_reader cannot read PortalUser. It can read Customer only for the signed-in id.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dd_portal_lookup') THEN
    RAISE EXCEPTION 'dd_portal_lookup does not exist. Run prisma/create-portal-lookup-role.sql as the migration owner, then migrate.';
  END IF;
END
$$;

GRANT dd_portal_lookup TO CURRENT_USER;

ALTER TABLE "PortalUser" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Customer" ENABLE ROW LEVEL SECURITY;

CREATE POLICY dd_app_all ON "PortalUser"
  FOR ALL TO dd_app
  USING (true)
  WITH CHECK (true);

CREATE POLICY dd_app_all ON "Customer"
  FOR ALL TO dd_app
  USING (true)
  WITH CHECK (true);

CREATE POLICY dd_portal_lookup_read ON "PortalUser"
  FOR SELECT TO dd_portal_lookup
  USING (true);

CREATE POLICY dd_portal_lookup_read ON "AuditEvent"
  FOR SELECT TO dd_portal_lookup
  USING (true);

CREATE POLICY dd_portal_reader_customer ON "Customer"
  FOR SELECT TO dd_portal_reader
  USING (id = app_customer_id());

GRANT USAGE ON SCHEMA public TO dd_portal_lookup;
GRANT SELECT ON TABLE "PortalUser" TO dd_portal_lookup;
GRANT SELECT ON TABLE "AuditEvent" TO dd_portal_lookup;
GRANT SELECT ON TABLE "Customer" TO dd_portal_reader;

CREATE FUNCTION portal_customer_id(p_sub text) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  found_user uuid;
  found_customer uuid;
  disabled boolean;
BEGIN
  IF p_sub IS NULL OR btrim(p_sub) = '' OR length(p_sub) > 256 THEN
    RETURN NULL;
  END IF;

  -- Fail closed. A missing policy would hide a disable event and let the user in.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy pol
    JOIN pg_catalog.pg_class cls ON cls.oid = pol.polrelid
    JOIN pg_catalog.pg_namespace nsp ON nsp.oid = cls.relnamespace
    JOIN pg_catalog.pg_roles rol ON rol.oid = ANY (pol.polroles)
    WHERE nsp.nspname = 'public'
      AND cls.relname = 'AuditEvent'
      AND pol.polname = 'dd_portal_lookup_read'
      AND rol.rolname = 'dd_portal_lookup'
  ) THEN
    RETURN NULL;
  END IF;

  SELECT "PortalUser".id, "PortalUser".customer_id
    INTO found_user, found_customer
  FROM "PortalUser"
  WHERE "PortalUser".cognito_sub = p_sub;

  IF found_user IS NULL OR found_customer IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM "AuditEvent" e
    WHERE e.customer_id = found_customer
      AND e.action = 'portal_user_disabled'
      AND e.payload->>'portal_user_id' = found_user::text
  ) INTO disabled;

  IF disabled THEN
    RETURN NULL;
  END IF;
  RETURN found_customer;
END
$fn$;

CREATE FUNCTION portal_profile_rows()
RETURNS TABLE (display_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  RETURN QUERY
  SELECT c.display_name::text
  FROM "Customer" c
  WHERE c.id = app_customer_id();
END
$fn$;

GRANT CREATE ON SCHEMA public TO dd_portal_lookup;
GRANT CREATE ON SCHEMA public TO dd_portal_reader;
ALTER FUNCTION portal_customer_id(text) OWNER TO dd_portal_lookup;
ALTER FUNCTION portal_profile_rows() OWNER TO dd_portal_reader;
REVOKE CREATE ON SCHEMA public FROM dd_portal_lookup;
REVOKE CREATE ON SCHEMA public FROM dd_portal_reader;

CREATE VIEW portal_profile WITH (security_invoker = true) AS
SELECT display_name FROM portal_profile_rows();

REVOKE ALL ON FUNCTION portal_customer_id(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION portal_profile_rows() FROM PUBLIC;
REVOKE ALL ON portal_profile FROM PUBLIC;

GRANT EXECUTE ON FUNCTION portal_customer_id(text) TO dd_portal;
GRANT EXECUTE ON FUNCTION portal_profile_rows() TO dd_portal;
GRANT SELECT ON portal_profile TO dd_portal;
