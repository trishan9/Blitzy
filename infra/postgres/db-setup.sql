REVOKE ALL ON SCHEMA public FROM PUBLIC;

SELECT format('CREATE ROLE app_rw LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE', :'rw_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw')\gexec

SELECT format('CREATE ROLE app_ro LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE', :'ro_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_ro')\gexec

SELECT format('CREATE ROLE migrator LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS', :'mig_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migrator')\gexec

ALTER ROLE app_rw SET statement_timeout = '5s';
ALTER ROLE app_rw SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE app_ro SET statement_timeout = '5s';
ALTER ROLE app_ro SET idle_in_transaction_session_timeout = '30s';

ALTER SCHEMA public OWNER TO migrator;
GRANT USAGE ON SCHEMA public TO app_rw, app_ro;

ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
  GRANT SELECT ON TABLES TO app_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_rw;

