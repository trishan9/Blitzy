
import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { asSystem } from "../../db/client";
import { allowMethods, getActor, assertCan } from "../../authz/authorize";
import { requireAuth } from "../../middlewares/auth.middleware";
import {
  processImageUpload, MULTER_LIMITS, serveHeaders, UploadRejected,
} from "../../uploads/image-pipeline";
import { safeFetch, SsrfBlocked } from "../../security/safe-fetch";
import { logger } from "../../observability/logger";
import { uuidv7 } from "uuidv7";

const router = Router();


const upload = multer({
  storage: multer.memoryStorage(),
  limits: MULTER_LIMITS,
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype.startsWith("image/"));
  },
});

const objectStore = new Map<string, { buffer: Buffer; contentType: string }>();

router.post(
  "/products/:productId/images",
  allowMethods("POST"),
  requireAuth,
  upload.single("image"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req)!;
      assertCan(actor, "update", { kind: "product" });
      const pid = z.string().uuid().safeParse(req.params.productId);
      if (!pid.success) { res.status(404).json({ error: "not found" }); return; }
      if (!req.file) { res.status(400).json({ error: "no file" }); return; }

      const processed = await processImageUpload(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );
      objectStore.set(processed.storageKey, {
        buffer: processed.buffer,
        contentType: processed.contentType,
      });

      await asSystem((tx) =>
        tx.execute(sql`
          INSERT INTO product_images (id, product_id, url, position)
          VALUES (${uuidv7()}, ${pid.data}, ${`/api/uploads/${processed.storageKey}`}, 0)
        `)
      );
      await asSystem((tx) =>
        tx.execute(sql`
          INSERT INTO audit_log (id, actor_user_id, action, resource_type, resource_id, metadata)
          VALUES (${uuidv7()}, ${actor.id}, 'UPLOAD_ACCEPTED', 'product', ${pid.data},
                  ${JSON.stringify({ key: processed.storageKey, bytes: processed.bytes })}::jsonb)
        `)
      );

      res.status(201).json({
        storageKey: processed.storageKey,
        width: processed.width,
        height: processed.height,
        originalName: req.file.originalname,
      });
    } catch (e) {
      if (e instanceof UploadRejected) {
        logger.warn({ reason: e.reason }, "upload rejected");
        await asSystem((tx) =>
          tx.execute(sql`
            INSERT INTO audit_log (id, actor_user_id, action, resource_type, metadata)
            VALUES (${uuidv7()}, ${getActor(req)?.id ?? null}, 'UPLOAD_REJECTED', 'product',
                    ${JSON.stringify({ reason: e.reason })}::jsonb)
          `)
        ).catch(() => undefined);
      }
      next(e);
    }
  }
);

const importSchema = z.object({ url: z.string().url().max(2048), productId: z.string().uuid() }).strict();

router.post(
  "/products/image-from-url",
  requireAuth,
  allowMethods("POST"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req)!;
      assertCan(actor, "update", { kind: "product" });
      const parsed = importSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: "invalid request body" }); return; }

      const fetched = await safeFetch(parsed.data.url);

      const processed = await processImageUpload(fetched.body, "imported.jpg", "image/jpeg");
      objectStore.set(processed.storageKey, {
        buffer: processed.buffer, contentType: processed.contentType,
      });
      await asSystem((tx) =>
        tx.execute(sql`
          INSERT INTO product_images (id, product_id, url, position)
          VALUES (${uuidv7()}, ${parsed.data.productId}, ${`/api/uploads/${processed.storageKey}`}, 0)
        `)
      );
      res.status(201).json({ storageKey: processed.storageKey });
    } catch (e) {
      if (e instanceof SsrfBlocked) {
        logger.warn({ reason: e.reason, detail: e.detail }, "SSRF blocked");
        await asSystem((tx) =>
          tx.execute(sql`
            INSERT INTO audit_log (id, actor_user_id, action, resource_type, metadata)
            VALUES (${uuidv7()}, ${getActor(req)?.id ?? null}, 'SSRF_BLOCKED', 'product',
                    ${JSON.stringify({ reason: e.reason })}::jsonb)
          `)
        ).catch(() => undefined);
      }
      next(e);
    }
  }
);

router.post(
  "/images",
  allowMethods("POST"),
  requireAuth,
  upload.array("images", 10),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req)!;
      assertCan(actor, "update", { kind: "product" });
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) { res.status(400).json({ error: "no files" }); return; }

      const images: string[] = [];
      for (const f of files) {
        const processed = await processImageUpload(f.buffer, f.originalname, f.mimetype);
        objectStore.set(processed.storageKey, {
          buffer: processed.buffer,
          contentType: processed.contentType,
        });
        images.push(`/api/uploads/${processed.storageKey}`);
      }

      await asSystem((tx) =>
        tx.execute(sql`
          INSERT INTO audit_log (id, actor_user_id, action, resource_type, metadata)
          VALUES (${uuidv7()}, ${actor.id}, 'UPLOAD_ACCEPTED', 'product',
                  ${JSON.stringify({ count: images.length })}::jsonb)
        `)
      );

      res.status(201).json({ message: "Images uploaded", images });
    } catch (e) { next(e); }
  }
);

router.get("/:key", allowMethods("GET"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = z.string().regex(/^[0-9a-f-]{36}\.webp$/i).safeParse(req.params.key);
    if (!key.success) { res.status(404).json({ error: "not found" }); return; }
    const obj = objectStore.get(key.data);
    if (!obj) { res.status(404).json({ error: "not found" }); return; }
    for (const [h, v] of Object.entries(serveHeaders)) res.setHeader(h, v);
    res.setHeader("Content-Type", obj.contentType);
    res.setHeader("Content-Length", String(obj.buffer.length));
    res.end(obj.buffer);
  } catch (e) { next(e); }
});

export default router;
