import type { MiddlewareHandler } from "hono";
import { verifySession } from "../lib/session.js";

declare module "hono" {
  interface ContextVariableMap {
    userId: string;
  }
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const token = header.slice("Bearer ".length);
  const payload = verifySession(token);
  if (!payload) {
    return c.json({ error: "unauthorized" }, 401);
  }
  c.set("userId", payload.userId);
  await next();
};
