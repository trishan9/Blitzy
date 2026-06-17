
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "./schema";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5_000,
});

export const db = drizzle(pool, { schema });

export type Actor = {
  id: string;
  role: "USER" | "ADMIN";
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function withActor<T>(
  actor: Actor,
  fn: (tx: Tx) => Promise<T>,
  opts: { isolationLevel?: "read committed" | "repeatable read" | "serializable" } = {}
): Promise<T> {
  return db.transaction(
    async (tx) => {
      await tx.execute(
        sql`select set_config('app.actor_id', ${actor.id}, true),
                   set_config('app.actor_role', ${actor.role}, true),
                   set_config('app.system', '', true)`
      );
      return fn(tx);
    },
    opts.isolationLevel ? { isolationLevel: opts.isolationLevel } : undefined
  );
}

export async function withActorSerializable<T>(
  actor: Actor,
  fn: (tx: Tx) => Promise<T>,
  maxAttempts = 5
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await withActor(actor, fn, { isolationLevel: "serializable" });
    } catch (e) {
      const code = pgErrorCode(e);
      if (code !== "40001" && code !== "40P01") throw e;
      lastErr = e;
      const backoff = Math.min(2 ** attempt, 32) + Math.random() * 10;
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

export async function asSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.actor_id', '', true),
                 set_config('app.actor_role', '', true),
                 set_config('app.system', 'on', true)`
    );
    return fn(tx);
  });
}

export async function withGuestCart<T>(guestCartId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.actor_id', '', true),
                 set_config('app.actor_role', '', true),
                 set_config('app.guest_cart_id', ${guestCartId}, true),
                 set_config('app.system', '', true)`
    );
    return fn(tx);
  });
}

export function pgErrorCode(err: unknown): string | undefined {
  let e: any = err;
  for (let i = 0; i < 5 && e; i++) {
    if (typeof e.code === "string") return e.code;
    e = e.cause;
  }
  return undefined;
}

export async function closePool(): Promise<void> {
  await pool.end();
}
