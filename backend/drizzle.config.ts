import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit config. Migrations are generated from src/db/schema.ts and run by
 * the `migrator` role (which owns the schema). The application's `app_rw` role
 * cannot DDL, so it can never be used here. See infra/postgres/db-setup.sql.
 *
 * The connection string comes from MIGRATOR_DATABASE_URL (migrator credentials),
 * distinct from DATABASE_URL (app_rw) used by the running application.
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.MIGRATOR_DATABASE_URL ?? "",
  },
  // Roles are created by infra/postgres/db-setup.sql as SUPERUSER, because `migrator` is
  // deliberately NOCREATEROLE (least privilege). drizzle-kit must therefore NOT emit
  // `CREATE ROLE` into migrations — doing so makes every migration fail with
  // "permission denied to create role". `roles: false` disables role management entirely;
  // the `pgRole()` declarations in schema.ts remain, but only so RLS policies can reference
  // them via `to: appRw`.
  entities: {
    roles: false,
  },
  strict: true,
  verbose: true,
});
