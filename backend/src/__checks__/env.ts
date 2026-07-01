import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(__dirname, "../../../.env") });
config({ path: resolve(__dirname, "../../.env") });

const MAP: ReadonlyArray<readonly [string, string]> = [
  ["PGPW_MIG", "MIGRATOR_PW"],
  ["PGPW_RW", "APP_RW_PW"],
  ["PGPW_RO", "APP_RO_PW"],
];

for (const [target, source] of MAP) {
  if (!process.env[target] && process.env[source]) process.env[target] = process.env[source];
}
