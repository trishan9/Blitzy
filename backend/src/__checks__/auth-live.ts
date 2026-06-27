
import "./env";
import "dotenv/config";
import { auth } from "../auth/auth";
import { Client } from "pg";

const PG = () =>
  new Client({
    host: process.env.PGHOST ?? "127.0.0.1",
    port: Number(process.env.PGPORT ?? 55433),
    user: "migrator",
    password: process.env.PGPW_MIG,
    database: "ecommerce",
  });

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? pass++ : (fail++, console.log("FAIL:", m)); };

const EMAIL = `alice+${Date.now()}@lab.test`;
const PASSWORD = "correct horse battery staple 4Z!";

async function main() {
  const db = PG();
  await db.connect();
  await db.query("TRUNCATE users, sessions, accounts, verifications, jwks RESTART IDENTITY CASCADE");

  const signUp = await auth.api.signUpEmail({
    body: { email: EMAIL, password: PASSWORD, name: "Alice" },
    asResponse: true,
  });
  ok(signUp.status === 200, `sign-up succeeded (status ${signUp.status})`);

  const userRow = await db.query("SELECT id, email, role, token_version FROM users WHERE email=$1", [EMAIL]);
  ok(userRow.rowCount === 1, "user row written to Postgres");
  const userId = userRow.rows[0]?.id;
  ok(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/i.test(userId ?? ""), `id is UUIDv7 (got ${userId})`);
  ok(userRow.rows[0]?.role === "USER", `role uses our enum value "USER" (got ${userRow.rows[0]?.role})`);
  ok(userRow.rows[0]?.token_version === 0, "tokenVersion column defaulted (revocation lever present)");

  const acct = await db.query("SELECT password FROM accounts WHERE user_id=$1", [userId]);
  const hash: string = acct.rows[0]?.password ?? "";
  ok(hash.length > 0, "credential account row written");
  ok(hash.startsWith("$argon2id$"), `password stored as Argon2id (prefix: ${hash.slice(0, 20)})`);
  ok(hash.includes("m=19456") && hash.includes("t=2") && hash.includes("p=1"),
     "Argon2id params are the configured 19456/2/1");
  ok(!hash.includes(PASSWORD), "plaintext password absent from the hash");
  ok(!hash.startsWith("$2a$") && !hash.startsWith("$2b$"), "not bcrypt (legacy KDF gone)");

  const unverified = await auth.api
    .signInEmail({ body: { email: EMAIL, password: PASSWORD }, asResponse: true })
    .catch((e: any) => e?.response ?? e);
  const unverifiedStatus = (unverified as Response)?.status ?? (unverified as any)?.statusCode;
  ok(unverifiedStatus !== 200, `unverified email CANNOT sign in (status ${unverifiedStatus}) — requireEmailVerification enforced`);

  await db.query("UPDATE users SET email_verified = true WHERE id=$1", [userId]);

  const good = await auth.api.signInEmail({ body: { email: EMAIL, password: PASSWORD }, asResponse: true });
  ok(good.status === 200, `sign-in with correct password succeeds (${good.status})`);
  const setCookie = good.headers.get("set-cookie") ?? "";
  ok(/httponly/i.test(setCookie), "session cookie is HttpOnly (XSS cannot lift it)");
  ok(/samesite=lax/i.test(setCookie), "session cookie is SameSite=Lax");
  ok(!/domain=/i.test(setCookie), "session cookie has NO Domain attribute (blocks sibling-subdomain cookie tossing)");

  const sess = await db.query("SELECT id, user_id, token, expires_at FROM sessions WHERE user_id=$1", [userId]);
  ok(sess.rowCount! >= 1, "session row persisted in Postgres (storeSessionInDatabase honoured)");

  const wrongPw = await auth.api.signInEmail({ body: { email: EMAIL, password: "wrong-password-here" }, asResponse: true })
    .catch((e: any) => e?.response ?? e);
  const noAccount = await auth.api.signInEmail({ body: { email: `nobody+${Date.now()}@lab.test`, password: "wrong-password-here" }, asResponse: true })
    .catch((e: any) => e?.response ?? e);

  const statusA = (wrongPw as Response)?.status ?? (wrongPw as any)?.statusCode;
  const statusB = (noAccount as Response)?.status ?? (noAccount as any)?.statusCode;
  ok(statusA === statusB, `ENUMERATION: wrong-password and unknown-account share a status (${statusA} vs ${statusB})`);

  const bodyA = await safeBody(wrongPw);
  const bodyB = await safeBody(noAccount);
  ok(bodyA === bodyB, `ENUMERATION: identical response bodies ("${bodyA}" vs "${bodyB}")`);
  ok(statusA !== 200, "wrong password does not authenticate");

  const before = await db.query("SELECT count(*)::int AS n FROM sessions WHERE user_id=$1", [userId]);
  await db.query("DELETE FROM sessions WHERE user_id=$1", [userId]);
  const after = await db.query("SELECT count(*)::int AS n FROM sessions WHERE user_id=$1", [userId]);
  ok(before.rows[0].n > 0 && after.rows[0].n === 0,
     "revocation: deleting the session row is possible (immediate revocation lever)");

  const jwksBody: any = await (auth.api as any)
    .getJwks()
    .catch((e: any) => { console.log("  (getJwks error:", e?.message, ")"); return null; });
  if (jwksBody) {
    const keys = jwksBody?.keys ?? [];
    ok(keys.length > 0, "JWKS endpoint serves at least one key");
    ok(keys.some((k: any) => k.crv === "Ed25519" || k.alg === "EdDSA"),
       `JWKS key is EdDSA/Ed25519 (got alg=${keys[0]?.alg} crv=${keys[0]?.crv})`);
    ok(!JSON.stringify(jwksBody).includes("\"d\""),
       "JWKS exposes PUBLIC key only (no private 'd' parameter)");
  } else {
    ok(false, "JWKS endpoint reachable");
  }

  await db.end();
  console.log(`\nBetter Auth RUNTIME: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

async function safeBody(r: any): Promise<string> {
  try {
    if (r instanceof Response) return (await r.clone().text()).slice(0, 200);
    return String(r?.body ?? r?.message ?? "").slice(0, 200);
  } catch { return ""; }
}

main().catch((e) => { console.error("fatal:", e); process.exit(1); });
