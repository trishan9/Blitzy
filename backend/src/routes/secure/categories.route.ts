import { Router, type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { categories } from "../../db/schema";
import { allowMethods, getActor, assertCan } from "../../authz/authorize";

const router = Router();

router.get("/", allowMethods("GET"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    assertCan(getActor(req), "list", { kind: "category" });
    const rows = await db
      .select({
        id: categories.id, name: categories.name, slug: categories.slug,
        imageUrl: categories.imageUrl, description: categories.description,
        isActive: categories.isActive,
        createdAt: categories.createdAt, updatedAt: categories.updatedAt,
      })
      .from(categories)
      .where(eq(categories.isActive, true))
      .limit(200);

    res.json({
      message: "Categories fetched",
      categories: rows.map((c) => ({
        _id: c.id,
        name: c.name,
        slug: c.slug,
        imageUrl: c.imageUrl ?? "",
        description: c.description ?? "",
        isActive: c.isActive,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
    });
  } catch (e) { next(e); }
});

export default router;
