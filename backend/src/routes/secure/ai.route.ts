
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { asSystem } from "../../db/client";
import { allowMethods, getActor } from "../../authz/authorize";
import { requireAuth } from "../../middlewares/auth.middleware";
import { rateLimit, aiLimiter } from "../../security/rate-limit";
import {
  scanForInjection, redactPii, inputWithinLimit, ScannerUnavailable,
} from "../../ai/injection-scanner";
import {
  buildContextBlock, buildSystemPrompt, makeCanary, canaryLeaked, type RetrievedChunk,
} from "../../ai/context";
import { guardModelOutput } from "../../ai/output-guard";
import { logger, securityEvent } from "../../observability/logger";
import { uuidv7 } from "uuidv7";
import { createHash } from "node:crypto";

const router = Router();

const askSchema = z.object({ question: z.string().trim().min(1).max(2000) }).strict();
const MODEL_ID = () => process.env.AI_MODEL_ID ?? "gpt-4o-mini";

router.post(
  "/assistant",
  allowMethods("POST"),
  requireAuth,
  rateLimit(aiLimiter),
  async (req: Request, res: Response, next: NextFunction) => {
    const actor = getActor(req)!;
    try {
      const parsed = askSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: "invalid request body" }); return; }
      const question = parsed.data.question;

      if (!inputWithinLimit(question)) { res.status(400).json({ error: "question too long" }); return; }

      const userVerdict = await scanForInjection(question);
      if (userVerdict.injection) {
        await audit(actor.id, "PROMPT_INJECTION_DETECTED", { source: "user_input", score: userVerdict.score });
        securityEvent("PROMPT_INJECTION_DETECTED", { actor: actor.id, ip: req.ip, path: req.path, reason: "user_input" });
        res.status(400).json({ error: "your question could not be processed" });
        return;
      }

      const rows = await asSystem((tx) =>
        tx.execute(sql`
          SELECT p.id AS product_id, p.name, p.description,
                 r.id AS review_id, r.comment
          FROM products p
          LEFT JOIN reviews r ON r.product_id = p.id
          WHERE p.is_active = true
          LIMIT 20
        `)
      );

      const chunks: RetrievedChunk[] = [];
      const allowedProductIds = new Set<string>();
      const allowedReviewIds = new Set<string>();
      for (const r of rows.rows as any[]) {
        allowedProductIds.add(r.product_id);
        if (r.description) {
          chunks.push({ source: "product_description", id: r.product_id, text: String(r.description) });
        }
        if (r.review_id && r.comment) {
          allowedReviewIds.add(r.review_id);
          chunks.push({ source: "review", id: r.review_id, text: String(r.comment) });
        }
      }

      for (const c of chunks) {
        const v = await scanForInjection(c.text);
        if (v.injection) {
          await audit(actor.id, "PROMPT_INJECTION_DETECTED", { source: c.source, id: c.id, score: v.score });
          securityEvent("PROMPT_INJECTION_DETECTED", { actor: actor.id, ip: req.ip, path: req.path, reason: `retrieved:${c.source}` });
          chunks.splice(chunks.indexOf(c), 1);
        }
      }

      const canary = makeCanary();
      const systemPrompt = buildSystemPrompt(canary, buildContextBlock(chunks));
      const safeQuestion = await redactPii(question);

      if (process.env.AI_ENABLED !== "true") {
        res.status(503).json({ error: "assistant temporarily unavailable" });
        return;
      }

      const raw = await callModel(MODEL_ID(), systemPrompt, safeQuestion);

      const guarded = guardModelOutput(raw, allowedProductIds, allowedReviewIds);
      if (!guarded.ok) {
        await audit(actor.id, "PROMPT_INJECTION_DETECTED", { stage: "output", reason: guarded.reason });
        securityEvent("PROMPT_INJECTION_DETECTED", { actor: actor.id, ip: req.ip, path: req.path, reason: `output:${guarded.reason}` });
        res.status(502).json({ error: "the assistant returned an unusable response" });
        return;
      }

      if (canaryLeaked(raw, canary)) {
        await audit(actor.id, "CANARY_LEAKED", { severity: "high" });
        securityEvent("CANARY_LEAKED", { actor: actor.id, ip: req.ip, path: req.path, reason: "system-prompt-in-output" });
        logger.error({ actor: actor.id }, "SYSTEM PROMPT CANARY LEAKED");
        res.status(502).json({ error: "the assistant returned an unusable response" });
        return;
      }

      if (guarded.dropped.length > 0) {
        logger.warn({ dropped: guarded.dropped }, "ungrounded ids dropped from assistant output");
      }

      logger.info(
        { promptHash: createHash("sha256").update(question).digest("hex").slice(0, 16), model: MODEL_ID() },
        "ai assistant answered"
      );

      res.json({ ...guarded.response, aiGenerated: true });
    } catch (e) {
      if (e instanceof ScannerUnavailable) {
        res.status(503).json({ error: "the assistant is temporarily unavailable" });
        return;
      }
      next(e);
    }
  }
);

async function audit(actorId: string, action: string, metadata: Record<string, unknown>) {
  await asSystem((tx) =>
    tx.execute(sql`
      INSERT INTO audit_log (id, actor_user_id, action, resource_type, metadata)
      VALUES (${uuidv7()}, ${actorId}, ${action}, 'ai', ${JSON.stringify(metadata)}::jsonb)
    `)
  ).catch(() => undefined);
}

async function callModel(model: string, systemPrompt: string, question: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new ScannerUnavailable();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model, // PINNED from config
      max_tokens: Number(process.env.AI_MAX_TOKENS_PER_REQUEST ?? 2000),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const code = /"code"\s*:\s*"([^"]+)"/.exec(detail)?.[1];
    logger.error({ upstreamStatus: res.status, code }, "AI provider call failed");
    throw new Error(`model call failed: ${res.status}`);
  }
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return body.choices?.[0]?.message?.content ?? "";
}

export default router;
