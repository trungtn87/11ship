-- 01-roles-database.sql — one-time preparation of the self-hosted staging PostgreSQL 17 (M00-VPS-01): the two roles, the
-- database ship11_staging and schema app owned by the migration role. Mirrors "Roles and schema" of
-- ops/runbooks/render-supabase-staging.md section 3, for a plain PostgreSQL instead of Supabase.
--
-- Run ONCE, as the PostgreSQL superuser, on the same machine as the service. The two passwords come from psql variables
-- that you set interactively from protected files, so they never appear in a process list, a shell history or this file:
--
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres
--   postgres=# \set migrator_password `cat /root/ship11-secrets/migrator.pw`
--   postgres=# \set app_password      `cat /root/ship11-secrets/app.pw`
--   postgres=# \i /opt/11ship/releases/<sha>/ops/selfhosted/01-roles-database.sql
--
-- Not idempotent on purpose: CREATE ROLE / CREATE DATABASE fail when they already exist, so a second run stops at the
-- first statement instead of silently resetting a password or a privilege. (CI runs it once on a fresh container.)
--
-- Role model:
--   ship11_migrator  operator role. Owns schema app and every object in it, owns the migration history app.pgmigrations,
--                    runs db:migrate:remote / seed / bootstrap. Never given to the service. NOT a superuser.
--   ship11_app       runtime role. The only credential of the service. No DDL, owns nothing; explicit per-table
--                    privileges are added by 02-runtime-grants.sql. NOT a superuser.
--   postgres         owns the database only; used for nothing else after this script.
--
-- Contains no secret.

\if :{?migrator_password}
\else
  \echo 'refused: set the psql variable migrator_password first (see the header of this file)'
  \quit
\endif
\if :{?app_password}
\else
  \echo 'refused: set the psql variable app_password first (see the header of this file)'
  \quit
\endif

CREATE ROLE ship11_migrator LOGIN PASSWORD :'migrator_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE ship11_app LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

CREATE DATABASE ship11_staging ENCODING 'UTF8';
REVOKE ALL ON DATABASE ship11_staging FROM PUBLIC;
GRANT CONNECT ON DATABASE ship11_staging TO ship11_migrator, ship11_app;
-- Migration 1 runs CREATE SCHEMA IF NOT EXISTS app; PostgreSQL checks CREATE on the database even when the schema already
-- exists, so the migrator needs it (found by the disposable-database test of M00-D1; see render-supabase-staging.md).
GRANT CREATE ON DATABASE ship11_staging TO ship11_migrator;

\connect ship11_staging

REVOKE ALL ON SCHEMA public FROM PUBLIC;
-- The migration tool never creates this schema: it must exist and be owned by the migration role.
CREATE SCHEMA app AUTHORIZATION ship11_migrator;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO ship11_app;

-- Read-only summary: counts and names only.
SELECT current_database() AS database_name,
       (SELECT count(*) FROM pg_roles WHERE rolname IN ('ship11_migrator', 'ship11_app') AND NOT rolsuper) AS non_superuser_roles,
       (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'app') AS schema_app_owner;
