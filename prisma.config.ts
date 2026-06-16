/**
 * Prisma CLI config (Prisma 7+).
 *
 * In Prisma 7:
 *   - The `datasource` block was removed from schema.prisma. The Migrate
 *     CLI / Studio now read the connection URL from this file instead.
 *   - The CLI no longer auto-loads `.env` (it did in Prisma 6 and earlier).
 *     We explicitly load it here so `env("DATABASE_URL")` resolves.
 *
 * The runtime `PrismaClient` uses a Neon driver adapter — see `src/lib/db.ts`.
 */
import "dotenv/config";
import path from "node:path";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  datasource: {
    url: env("DATABASE_URL"),
  },
});
