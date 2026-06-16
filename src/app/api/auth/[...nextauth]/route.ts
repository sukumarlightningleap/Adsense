/**
 * NextAuth's required API route. Catches /api/auth/* and dispatches to
 * the GET/POST handlers built in src/auth.ts.
 */
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
