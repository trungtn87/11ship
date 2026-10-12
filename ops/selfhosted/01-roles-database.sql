-- 01-roles-database.sql — one-time preparation of the self-hosted staging PostgreSQL 17 (M00-VPS-01): the two roles, the
-- database ship11_staging and schema app owned by the migration role. Mirrors "Roles and schema" of
-- ops/runbooks/render-supabase-staging.md section 3, for a plain PostgreSQL instead of Supabase.
--
-- Run ONCE, as the PostgreSQL superuser, on the same machine as the service, through the wrapper that gives the two passwords
-- to psql with the right permissions:
--
--   sudo ops/selfhosted/run-roles-database.sh            # reads /root/ship11-secrets/{migrator,app}.pw as ROOT
--
-- Why a wrapper: psql runs as the OS user "postgres" (peer authentication), which cannot read root-owned secret files, and a
-- backtick inside psql runs in THAT user's shell. So root reads the files, checks them, and streams the two `\set` lines and
-- this file to `psql` through a pipe: the values are never in argv, in a file, in a shell history or in a log. Running this
-- file any other way is supported only if both psql variables migrator_password and app_password are set first.
--
-- Both passwords are validated BEFORE the first CREATE: missing, empty, not 32..128 lower-case hex characters, or identical
-- -> the script raises an error (psql exits with a non-zero status) and nothing has been created. Values are never printed.
--
-- Not idempotent on purpose: CREATE ROLE / CREATE DATABASE fail when they already exist, so a second run stops at the
-- first statement instead of silently resetting a password or a privilege. If an earlier run stopped half way, diagnose
-- with the read-only queries in the runbook; do not reset a password or drop a role to "retry".
--
-- Role model:
--   ship11_migrator  operator role. Owns schema app and every object in it, owns the migration history app.pgmigrations,
--                    runs db:migrate:remote / seed / bootstrap. Never given to the service. NOT a superuser.
--   ship11_app       runtime role. The only credential of the service. No DDL, owns nothing; explicit per-table
--                    privileges are added by 02-runtime-grants.sql. NOT a superuser.
--   postgres         owns the database only; used for nothing else after this script.
--
-- Contains no secret.

\set ON_ERROR_STOP on

-- An unset variable is an error, not a silent skip: RAISE makes psql exit non-zero (ON_ERROR_STOP).
\if :{?migrator_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'refused: the psql variable migrator_password is not set'; END $$;
\endif
\if :{?app_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'refused: the psql variable app_password is not set'; END $$;
\endif

-- The statements below carry the passwords as literals. Keep them out of the server log, including the failing statement that
-- PostgreSQL logs by default on an error such as "role already exists" (superuser-only settings, this session only).
SET log_statement = 'none';
SET log_min_error_statement = 'panic';
SET log_min_duration_statement = -1;

-- Format and distinctness. The comparison happens on the server but only yields a boolean; no value is echoed.
SELECT (:'migrator_password' ~ '^[0-9a-f]{32,128}$'
        AND :'app_password' ~ '^[0-9a-f]{32,128}$'
        AND :'migrator_password' <> :'app_password') AS passwords_ok \gset
\if :passwords_ok
\else
  DO $$ BEGIN RAISE EXCEPTION 'refused: both passwords must be 32..128 lower-case hex characters (openssl rand -hex 24) and differ from each other'; END $$;
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
