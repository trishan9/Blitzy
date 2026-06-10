import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["cjs"],
  outDir: "dist",
  clean: true,
  // Do NOT bundle node_modules: native deps (sharp, @node-rs/argon2) and ESM-only deps
  // (better-auth, file-type) are shipped in the runtime image's node_modules and required at
  // runtime. Bundling them is fragile; externalising keeps the output a thin CJS entrypoint.
  skipNodeModulesBundle: true,
  sourcemap: false,
  minify: false,
  target: "node22",
});
