import type { AuthUser } from "../lib/jwt.js";

declare module "fastify" {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}

export {};
