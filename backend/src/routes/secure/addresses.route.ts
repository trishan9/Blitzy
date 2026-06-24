
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { withActor } from "../../db/client";
import { addresses } from "../../db/schema";
import { allowMethods, getActor, assertCan } from "../../authz/authorize";
import { requireAuth } from "../../middlewares/auth.middleware";
import { encrypt, decrypt } from "../../security/crypto";
import { uuidv7 } from "uuidv7";

const router = Router();
router.use(requireAuth);

const addressSchema = z
  .object({
    recipientName: z.string().trim().min(1).max(120),
    phone: z.string().trim().min(4).max(32),
    street: z.string().trim().min(1).max(200),
    city: z.string().trim().min(1).max(100),
    state: z.string().trim().min(1).max(100),
    postalCode: z.string().trim().min(1).max(20),
    country: z.string().trim().min(2).max(60),
    isDefault: z.boolean().optional(),
  })
  .strict();

const decode = (row: {
  id: string; recipientNameEncrypted: string; phoneEncrypted: string; streetEncrypted: string;
  city: string; state: string; postalCodeEncrypted: string; country: string; isDefault: boolean;
}) => ({
  _id: row.id,
  recipientName: decrypt(row.recipientNameEncrypted, "pii:address"),
  phone: decrypt(row.phoneEncrypted, "pii:phone"),
  street: decrypt(row.streetEncrypted, "pii:address"),
  city: row.city,
  state: row.state,
  postalCode: decrypt(row.postalCodeEncrypted, "pii:address"),
  country: row.country,
  isDefault: row.isDefault,
});

router.get("/", allowMethods("GET"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req)!;
    assertCan(actor, "list", { kind: "address", ownerId: actor.id });
    const rows = await withActor(actor, (tx) =>
      tx.select({
        id: addresses.id, recipientNameEncrypted: addresses.recipientNameEncrypted,
        phoneEncrypted: addresses.phoneEncrypted, streetEncrypted: addresses.streetEncrypted,
        city: addresses.city, state: addresses.state,
        postalCodeEncrypted: addresses.postalCodeEncrypted, country: addresses.country,
        isDefault: addresses.isDefault,
      }).from(addresses).where(eq(addresses.userId, actor.id)).limit(50)
    );
    res.json({ message: "Addresses fetched", addresses: rows.map(decode) });
  } catch (e) { next(e); }
});

router.post("/", allowMethods("POST"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req)!;
    const parsed = addressSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "invalid request body" }); return; }
    assertCan(actor, "create", { kind: "address", ownerId: actor.id });
    const a = parsed.data;
    const id = uuidv7();

    await withActor(actor, async (tx) => {
      if (a.isDefault) {
        await tx.execute(sql`UPDATE addresses SET is_default = false WHERE user_id = ${actor.id}`);
      }
      await tx.insert(addresses).values({
        id,
        userId: actor.id, // from the SESSION, never the body
        recipientNameEncrypted: encrypt(a.recipientName, "pii:address"),
        phoneEncrypted: encrypt(a.phone, "pii:phone"),
        streetEncrypted: encrypt(a.street, "pii:address"),
        city: a.city,
        state: a.state,
        postalCodeEncrypted: encrypt(a.postalCode, "pii:address"),
        country: a.country,
        isDefault: a.isDefault ?? false,
      });
    });
    res.status(201).json({ message: "Address created", address: { _id: id } });
  } catch (e) { next(e); }
});

router.delete("/:id", allowMethods("DELETE"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req)!;
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) { res.status(404).json({ error: "not found" }); return; }
    assertCan(actor, "delete", { kind: "address", ownerId: actor.id });

    const deleted = await withActor(actor, (tx) =>
      tx.delete(addresses)
        .where(and(eq(addresses.id, id.data), eq(addresses.userId, actor.id)))
        .returning({ id: addresses.id })
    );
    if (deleted.length === 0) { res.status(404).json({ error: "not found" }); return; }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
