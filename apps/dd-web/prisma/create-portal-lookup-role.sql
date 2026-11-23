-- Run once as the migration owner, before `prisma migrate deploy`.
-- create-portal-role.sql was already applied. This adds the sign-in lookup role.
-- No password. This role cannot log in.
--
-- dd_portal_lookup owns portal_customer_id. It can read PortalUser and AuditEvent.
-- dd_portal can execute that function and cannot read those tables.
-- The migration owner has to be a member of this role to hand the function over.

CREATE ROLE dd_portal_lookup NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT dd_portal_lookup TO CURRENT_USER;
