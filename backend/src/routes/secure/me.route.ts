import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withActor } from "../../db/client";
import { users } from "../../db/schema";
import { allowMethods, getActor, assertCan } from "../../authz/authorize";
import { requireAuth } from "../../middlewares/auth.middleware";
import { decryptNullable } from "../../security/crypto";

const router = Router();

const updateMeSchema = z
  .object({ name: z.string().trim().min(1).max(120) })
  .strict();

router.get(
  "/",
  allowMethods("GET"),
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req)!;
      assertCan(actor, "read", { kind: "user", ownerId: actor.id });
      const rows = await withActor(actor, (tx) =>
        tx
          .select({
            id: users.id, name: users.name, email: users.email,
            role: users.role, emailVerified: users.emailVerified,
            phoneEncrypted: users.phoneEncrypted, createdAt: users.createdAt,
          })
          .from(users)
          .where(eq(users.id, actor.id))
          .limit(1)
      );
      if (rows.length === 0) {
        res.status(404).json({ error: "not found" });
        return;
      }
      const u = rows[0];
      res.json({
        id: u.id, name: u.name, email: u.email, role: u.role,
        emailVerified: u.emailVerified, createdAt: u.createdAt,
        phone: decryptNullable(u.phoneEncrypted, "pii:phone"),
      });
    } catch (e) {
      next(e);
    }
  }
);

router.patch(
  "/",
  allowMethods("PATCH"),
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req)!;
      assertCan(actor, "update", { kind: "user", ownerId: actor.id });

      const parsed = updateMeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "invalid request body" });
        return;
      }
      await withActor(actor, (tx) =>
        tx
          .update(users)
          .set({ name: parsed.data.name, updatedAt: new Date() })
          .where(eq(users.id, actor.id))
      );
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  }
);

export default router;
