-- Run once as the migration owner, before the first `prisma migrate deploy`.
-- Postgres refuses CREATE ROLE inside a migration transaction, so this stays outside it.
-- Set the password in Neon. Do not put a password in this file.

CREATE ROLE dd_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
