import type { FastifyInstance } from "fastify";
import { LoginInput } from "@journal/shared";
import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  isSessionValid,
  verifyPassword,
} from "../auth.js";

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const { config, db } = app;

  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { password } = LoginInput.parse(request.body);

      if (!config.AUTH_PASSWORD_HASH) {
        return reply
          .code(503)
          .send({ error: "auth_not_configured", hint: "set AUTH_PASSWORD_HASH" });
      }
      if (!(await verifyPassword(password, config.AUTH_PASSWORD_HASH))) {
        return reply.code(401).send({ error: "invalid_password" });
      }

      const session = createSession(db, config.SESSION_TTL_DAYS);
      return reply
        .setCookie(SESSION_COOKIE, session.id, {
          httpOnly: true,
          sameSite: "lax",
          secure: config.NODE_ENV === "production",
          signed: true,
          path: "/",
          expires: new Date(session.expiresAt),
        })
        .send({ ok: true });
    },
  );

  app.post("/api/auth/logout", async (request, reply) => {
    if (request.sessionId) destroySession(db, request.sessionId);
    return reply.clearCookie(SESSION_COOKIE, { path: "/" }).send({ ok: true });
  });

  app.get("/api/auth/me", async (request) => {
    const raw = request.cookies[SESSION_COOKIE];
    const unsigned = raw ? request.unsignCookie(raw) : null;
    const authenticated =
      unsigned?.valid === true && Boolean(unsigned.value) && isSessionValid(db, unsigned.value);
    return { authenticated, configured: Boolean(config.AUTH_PASSWORD_HASH) };
  });
}
