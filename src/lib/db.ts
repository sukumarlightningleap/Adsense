/**
 * Prisma client singleton (Prisma 7 + Neon driver adapter).
 *
 * Two reasons for the singleton:
 *
 *   1. Next.js dev hot-reloads re-import modules every save. Without a
 *      cache, every reload creates a new connection pool and Neon runs
 *      out of connections in ~30s of editing.
 *   2. In production (Vercel serverless), the same client survives across
 *      warm-invocation reuses, avoiding cold-start adapter rebuilds.
 *
 * The Neon WebSocket adapter is used here. It works in Node (server
 * components, server actions, route handlers, scripts) and pools queries
 * efficiently within a single request. For Edge runtime (middleware,
 * edge functions), use `PrismaNeonHttp` instead — but middleware in
 * Adsense only reads the JWT, so it never needs DB access.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

function buildClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and fill in your Neon Postgres URL.",
    );
  }
  const adapter = new PrismaNeon({ connectionString });
  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db = globalForPrisma.prisma ?? buildClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
