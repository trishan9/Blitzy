import "dotenv/config";
import { createApp } from "./app";
import { logger } from "./observability/logger";
import { redisReady, closeRateLimiter } from "./security/rate-limit";
import { closePool } from "./db/client";

const PORT = Number(process.env.PORT ?? 8000);

async function main() {
  const app = createApp();

  await redisReady;
  logger.info("redis ready");

  const server = app.listen(PORT, () => {
    logger.info({ port: PORT, env: process.env.NODE_ENV }, "api listening");
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    server.close();
    await Promise.allSettled([closeRateLimiter(), closePool()]);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    logger.fatal({ reason }, "unhandled rejection");
    process.exit(1);
  });
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "uncaught exception");
    process.exit(1);
  });
}

void main();
