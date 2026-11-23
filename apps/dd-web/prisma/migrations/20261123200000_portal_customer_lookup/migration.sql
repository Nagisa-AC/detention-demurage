-- Sign-in lookup for the customer portal.
-- dd_portal cannot read PortalUser. This function, owned by dd_portal_reader, can.
-- The disabled check must see AuditEvent before app.customer_id is set.
-- If it cannot, it returns nothing and sign-in is refused.

GRANT dd_portal_reader TO CURRENT_USER;

ALTER TABLE "PortalUser" ENABLE ROW LEVEL SECURITY;

CREATE POLICY dd_app_all ON "PortalUser"
  FOR ALL TO dd_app
  USING (true)
  WITH CHECK (true);

-- Open only while the lookup function has asked for it. The views never set this.
CREATE POLICY dd_portal_reader_lookup ON "PortalUser"
  FOR SELECT TO dd_portal_reader
  USING (current_setting('portal.lookup', true) = '1');

CREATE POLICY dd_portal_reader_lookup ON "AuditEvent"
  FOR SELECT TO dd_portal_reader
  USING (current_setting('portal.lookup', true) = '1');

GRANT SELECT ON TABLE "PortalUser" TO dd_portal_reader;
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

  -- A customer filter is not set yet. If one is already set, it can hide the
  -- disable event for a different customer, so refuse instead of guessing.
  IF app_customer_id() IS NOT NULL THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy pol
    JOIN pg_catalog.pg_class cls ON cls.oid = pol.polrelid
    JOIN pg_catalog.pg_namespace nsp ON nsp.oid = cls.relnamespace
    WHERE nsp.nspname = 'public'
      AND cls.relname = 'AuditEvent'
      AND pol.polname = 'dd_portal_reader_lookup'
  ) THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('portal.lookup', '1', true);

  SELECT "PortalUser".id, "PortalUser".customer_id
    INTO found_user, found_customer
  FROM "PortalUser"
  WHERE "PortalUser".cognito_sub = p_sub;

  IF found_user IS NULL OR found_customer IS NULL THEN
    PERFORM set_config('portal.lookup', '', true);
    RETURN NULL;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM "AuditEvent" e
    WHERE e.customer_id = found_customer
      AND e.action = 'portal_user_disabled'
      AND e.payload->>'portal_user_id' = found_user::text
  ) INTO disabled;

  PERFORM set_config('portal.lookup', '', true);

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

GRANT CREATE ON SCHEMA public TO dd_portal_reader;
ALTER FUNCTION portal_customer_id(text) OWNER TO dd_portal_reader;
ALTER FUNCTION portal_profile_rows() OWNER TO dd_portal_reader;
REVOKE CREATE ON SCHEMA public FROM dd_portal_reader;

CREATE VIEW portal_profile WITH (security_invoker = true) AS
SELECT display_name FROM portal_profile_rows();

REVOKE ALL ON FUNCTION portal_customer_id(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION portal_profile_rows() FROM PUBLIC;
REVOKE ALL ON portal_profile FROM PUBLIC;

GRANT EXECUTE ON FUNCTION portal_customer_id(text) TO dd_portal;
GRANT EXECUTE ON FUNCTION portal_profile_rows() TO dd_portal;
GRANT SELECT ON portal_profile TO dd_portal;
