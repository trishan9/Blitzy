import { DEMO_FLAG_REGISTRY, enabledFlags } from "./demo-flags";

const active = new Set(enabledFlags().map((f) => f.key));

// eslint-disable-next-line no-console
console.log(`\nDemo / pentest flags (${DEMO_FLAG_REGISTRY.length}) — all default SECURE\n`);
for (const f of DEMO_FLAG_REGISTRY) {
  const mark = active.has(f.key) ? "ON " : "off";
  // eslint-disable-next-line no-console
  console.log(
    `[${mark}] ${f.key.padEnd(26)} ${f.cwe.padEnd(9)} ${f.class.padEnd(42)} ${f.endpoint}`
  );
}
// eslint-disable-next-line no-console
console.log(
  `\n${active.size} enabled. Enable exactly one at a time; the app refuses to start ` +
    `with any flag set unless NODE_ENV!=production && DEMO_MODE=true.\n`
);
