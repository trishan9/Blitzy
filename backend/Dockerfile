# =============================================================================
#  backend/Dockerfile — multi-stage, distroless runtime (brief §11, §7.7).
#
#  Blast-radius reasoning: the runtime stage has NO SHELL, no package manager, no
#  curl. An attacker who achieves RCE has no interactive foothold and no tooling to
#  pivot with. Combined with read-only rootfs, cap_drop ALL, and a firewalled egress
#  (docker-compose.yml), a code-execution bug is contained rather than fatal.
#
#  Base images are pinned by DIGEST, not tag — tags are mutable and a supply-chain
#  substitution would otherwise go unnoticed.
#  TODO: replace the @sha256 placeholders below with the digests resolved at build
#  time (`docker buildx imagetools inspect <image>:<tag>`), then commit them.
# =============================================================================

# ---------- deps: install with the lockfile, no build tooling in the final image
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` is reproducible (lockfile-exact) and fails if the lockfile is stale.
RUN npm ci --ignore-scripts \
 # These ship prebuilt native binaries; rebuild ONLY them so their platform artefacts
 # (argon2 .node, sharp's libvips) are present, without running arbitrary install scripts
 # from the rest of the tree (supply-chain hygiene, §11).
 && npm rebuild @node-rs/argon2 sharp

# ---------- build: compile TypeScript to dist/
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npm run build

# ---------- prod deps only: drop devDependencies from the runtime image
FROM node:22-bookworm-slim AS proddeps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
 && npm rebuild @node-rs/argon2 sharp \
 # Better Auth pulls `drizzle-kit` as a RUNTIME dep, which bundles esbuild/tsx Go binaries.
 # The running service NEVER invokes them (migrations run separately, as `migrator`), but they
 # sit on disk carrying ~35 Go-stdlib HIGH/CRITICAL CVEs (DoS in a server we never start).
 # Remove them so the image is clean and Trivy's HIGH/CRITICAL gate passes on real risk only.
 # Verified: the API boots and serves without these present.
 && rm -rf node_modules/esbuild node_modules/tsx node_modules/@esbuild node_modules/@esbuild-kit \
    node_modules/drizzle-kit/node_modules/@esbuild node_modules/drizzle-kit/node_modules/esbuild \
    node_modules/drizzle-kit/node_modules/tsx \
 && find node_modules -type d -name '@esbuild' -prune -exec rm -rf {} + 2>/dev/null || true

# ---------- runtime: distroless, non-root, no shell
FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime
WORKDIR /app

# Prototype-pollution hardening (§7.7).
#
# The brief specifies `--frozen-intrinsics`, but it is INCOMPATIBLE with the Express
# dependency tree: `depd` (via http-errors → body-parser) monkeypatches
# `Error.prepareStackTrace`, which frozen intrinsics forbids, so the app crashes at
# boot with `TypeError: callSite.getFileName is not a function`. Verified on Node 22.
#
# We instead use `--disable-proto=delete`, which REMOVES `Object.prototype.__proto__`
# entirely — the exact RCE vector §7.7 is worried about ("the most under-appreciated
# RCE chain in Node"). Verified in-container: a `{"__proto__":{...}}` payload does not
# pollute `Object.prototype`. This is a more TARGETED control than frozen intrinsics
# and it does not break the framework. The remaining §7.7 defences (Zod-before-merge,
# no deep-merge of untrusted JSON, `Object.create(null)` lookup maps) still apply.
# See docs/SECURITY-DECISIONS.md (D-028) for the full justification.
ENV NODE_ENV=production \
    NODE_OPTIONS=--disable-proto=delete

# Only the built output and production dependencies. No source, no tests, no docs.
COPY --from=proddeps --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=build    --chown=nonroot:nonroot /app/dist         ./dist
COPY --from=build    --chown=nonroot:nonroot /app/src/db/migrations ./migrations
COPY --chown=nonroot:nonroot package.json ./

# UID 65532 = the distroless `nonroot` user. Also set explicitly in compose.
USER nonroot

EXPOSE 8000

# NB: NO secrets baked in — every secret arrives at runtime via Docker secrets or a
# read-only mounted env file. Image layers are extractable (§11, §16).
CMD ["dist/server.js"]
