import type { FastifyInstance } from "fastify";
import * as repo from "../db/repo.js";

export async function registerTagRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/tags", async () => ({ tags: repo.listTags(app.db) }));
}
