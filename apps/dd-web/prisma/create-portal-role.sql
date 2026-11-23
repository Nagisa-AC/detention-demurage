-- Run once as the migration owner, before `prisma migrate deploy`.
-- Postgres refuses CREATE ROLE inside a migration transaction, so this stays outside it.
-- Set the password in Neon. Do not put a password in this file.
--
-- dd_portal is the customer login. It can read the three portal views and nothing else.
-- dd_portal_reader cannot log in. It owns the view functions, so the customer filter
-- applies without granting dd_portal access to the base tables.
-- The migration owner has to be a member of dd_portal_reader to hand over those functions.

CREATE ROLE dd_portal LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE dd_portal_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT dd_portal_reader TO CURRENT_USER;
