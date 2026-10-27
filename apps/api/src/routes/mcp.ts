import type { FastifyInstance, FastifyReply } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMcpServer } from "../mcp/server.js";
import { verifyAccessToken } from "../oauth.js";
import { resourceMetadataUrl } from "./oauth.js";

export async function registerMcpRoutes(app: FastifyInstance): Promise<void> {
  const { db, config } = app;

  // Stateless: every POST gets a fresh server and transport, so there are no
  // sessions to keep and nothing breaks when the machine restarts.
  app.post(
    "/mcp",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const header = request.headers.authorization ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
      if (!token || !verifyAccessToken(db, token)) {
        return reply
          .code(401)
          .header(
            "www-authenticate",
            `Bearer resource_metadata="${resourceMetadataUrl(request)}"` +
              (token ? `, error="invalid_token"` : ""),
          )
          .send({ error: "unauthorized" });
      }

      const server = buildMcpServer(db, config.JOURNAL_TZ);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      reply.raw.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      reply.hijack();
      await transport.handleRequest(request.raw, reply.raw, request.body);
    },
  );

  // No server-initiated stream and no sessions to end.
  const notAllowed = async (_request: unknown, reply: FastifyReply) =>
    reply.code(405).header("allow", "POST").send({ error: "method_not_allowed" });
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);
}
