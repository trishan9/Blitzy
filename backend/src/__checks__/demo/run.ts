
import "../env";
import { spawn } from "node:child_process";
import path from "node:path";

const CLASSES = [
  "NON_ATOMIC_STOCK",
  "DISABLE_CSRF",
  "REFLECT_CORS_ORIGIN",
  "VERBOSE_ERRORS",
  "DISABLE_SSRF_GUARD",
  "TRUST_UPLOAD_MIMETYPE",
  "DISABLE_OUTPUT_SANITISE",
  "DISABLE_SQL_ALLOWLIST",
  "TRUST_CLIENT_TOTAL",
  "MONGO_RAW_FILTER",
];

const EXPLOIT = path.join(__dirname, "exploit.ts");

function runOnce(cls: string, flagOn: boolean): Promise<{ vulnerable: boolean; raw: string }> {
  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = { ...process.env, EXPLOIT: cls };
    if (flagOn) {
      env.DEMO_MODE = "true";
      env[cls] = "true";
    }
    const child = spawn(
      process.execPath,
      ["-r", "ts-node/register/transpile-only", EXPLOIT],
      { env, stdio: ["ignore", "pipe", "ignore"] }
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("close", () => {
      const line = out.split(/\r?\n/).find((l) => l.startsWith("RESULT:"));
      if (!line) return resolve({ vulnerable: false, raw: "NO_RESULT" });
      try {
        const parsed = JSON.parse(line.slice("RESULT:".length));
        resolve({ vulnerable: !!parsed.vulnerable, raw: JSON.stringify(parsed) });
      } catch {
        resolve({ vulnerable: false, raw: line });
      }
    });
  });
}

async function main() {
  let pass = 0, fail = 0;
  const rows: string[] = [];

  for (const cls of CLASSES) {
    const secure = await runOnce(cls, false);
    const insecure = await runOnce(cls, true);

    const controlHolds = !secure.vulnerable;
    const demoWorks = insecure.vulnerable;
    const ok = controlHolds && demoWorks;
    ok ? pass++ : fail++;

    const mark = ok ? "PASS" : "FAIL";
    console.log(
      `[${mark}] ${cls.padEnd(24)} secure=${secure.vulnerable ? "VULN" : "safe"}  ` +
      `insecure=${insecure.vulnerable ? "VULN" : "safe"}`
    );
    if (!ok) {
      console.log(`        secure  : ${secure.raw}`);
      console.log(`        insecure: ${insecure.raw}`);
    }
    rows.push(`| \`${cls}\` | ${controlHolds ? "✅ holds" : "❌ FAILED"} | ${demoWorks ? "✅ exploited" : "❌ no effect"} |`);
  }

  console.log(`\nDemo pairs: ${pass} passed, ${fail} failed\n`);
  console.log("| Flag | Secure (control) | Insecure (demo) |");
  console.log("|---|---|---|");
  rows.forEach((r) => console.log(r));
  process.exit(fail ? 1 : 0);
}

main();
